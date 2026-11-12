/**
 * Rules: named reagents + named parameters + an update formula in Ready's
 * formula language (OpenCL-flavoured), compiled to a WGSL step shader.
 *
 * Semantics follow Ready's formula rules: Laplacians are taken from the old
 * values, the formula runs (it may reassign reagents and set delta_<x>), then
 * x_out = x + timestep * delta_x. The Laplacian is Ready's 9-point
 * "Mehrstellen" stencil (1, 4, -20) / 6, so imported patterns behave the same.
 *
 * Layout on the GPU:
 *   state:  S vec4s per cell (reagents in order, up to 8)
 *   params: P vec4s per cell; flat slot 0 is the wall flag, slots 1.. are the
 *           paintable parameters in order (up to 7)
 *   globals: uniform array of vec4 holding every parameter's global value
 */

export const MAX_REAGENTS = 8;
export const MAX_PAINTABLE = 7;

export interface ParamSpec {
  name: string;
  value: number;
  min: number;
  max: number;
}

export type Fill = { type: 'constant'; value: number } | { type: 'white_noise'; low: number; high: number };
export type Shape =
  | { type: 'everywhere' }
  | { type: 'rectangle'; x0: number; y0: number; x1: number; y1: number } // normalized, y down
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'spots'; count: number; minSize: number; maxSize: number; seed: number }; // cells; same seed → same spots

export interface Overlay {
  chem: string;
  op: 'overwrite' | 'add' | 'subtract' | 'multiply';
  fill: Fill;
  shape: Shape;
}

export interface RuleDef {
  name: string;
  description: string;
  reagents: string[];
  params: ParamSpec[];
  /** Parameter names stored per cell (paintable). Up to 7. */
  paintable: string[];
  formula: string;
  /** Value each reagent relaxes to under Erase / in new walls. */
  rest: number[];
  /** True once `rest` has been replaced by the computed homogeneous steady state. */
  restRelaxed?: boolean;
  /** Seed brush target per reagent (null = leave alone) and noise amplitude. */
  seed: (number | null)[];
  seedNoise: number[];
  initial: Overlay[];
  /** Suggested view: reagent shown, its range, and steps per frame. */
  view: { reagent: string; low: number; high: number; tint?: string; stepsPerFrame?: number };
  /**
   * Membranes: for the listed reagents, neighbours whose `param` value differs
   * (a painted compartment id) are treated as no-flux, like walls but only for
   * those reagents. Compartments then behave as well-mixed "cells".
   */
  membrane?: { param: string; reagents: string[] };
  /** Grid size the rule was authored for (imports). */
  size?: { width: number; height: number };
  /** Where it came from, e.g. a .vti file name. */
  source?: string;
}

export interface Layout {
  reagents: string[];
  /** Per-cell param slot names, slot 0 = 'wall'. */
  paramNames: string[];
  /** vec4s per cell. */
  S: number;
  P: number;
}

export function layoutOf(rule: RuleDef): Layout {
  const paramNames = ['wall', ...rule.paintable];
  return {
    reagents: rule.reagents,
    paramNames,
    S: Math.ceil(rule.reagents.length / 4),
    P: Math.ceil(paramNames.length / 4),
  };
}

const COMP = ['x', 'y', 'z', 'w'];
const slotRef = (arr: string, base: string, i: number) => `${arr}[${base} + ${i >> 2}u].${COMP[i & 3]}`;

// --- formula translation

const FUNCTIONS: Record<string, string> = {
  pow: 'rd_pow', fabs: 'abs', fmin: 'min', fmax: 'max', abs: 'abs', min: 'min', max: 'max',
  clamp: 'clamp', sign: 'sign', exp: 'exp', log: 'log', exp2: 'exp2', log2: 'log2', sqrt: 'sqrt',
  sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', atan2: 'atan2',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', floor: 'floor', ceil: 'ceil', round: 'round',
  mix: 'mix', step: 'step', smoothstep: 'smoothstep', rsqrt: 'inverseSqrt', fmod: 'rd_fmod',
};
const TYPES = new Set(['float', 'float2', 'float4', 'double', 'double4', 'int']);

export class RuleError extends Error {}

/**
 * Translate a Ready formula to WGSL statements. Identifiers become `v_<name>`
 * so user names can't collide with WGSL keywords; `float4 x = ...` declares a
 * local; casts like `(float4)` are dropped.
 */
export function translateFormula(formula: string, known: Set<string>): { code: string; used: Set<string> } {
  let src = formula.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  src = src.replace(/\(\s*(?:float|float2|float4|double|double4|int)\s*\)/g, '');
  const locals = new Set<string>();
  const used = new Set<string>();
  const unknown = new Set<string>();
  const tokens = src.match(/[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:[eE][-+]?\d+)?f?|\.\d+(?:[eE][-+]?\d+)?f?|\S|\s+/g) ?? [];
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!/^[A-Za-z_]/.test(t)) {
      out += /^[\d.]/.test(t) ? t.replace(/f$/, '') + (/[.eE]/.test(t) ? '' : '.0') : t;
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && /^\s+$/.test(tokens[j])) j++;
    const next = tokens[j];
    if (TYPES.has(t)) {
      // declaration: float4 name = ...
      const name = next;
      if (!name || !/^[A-Za-z_]/.test(name)) throw new RuleError(`can't parse declaration after '${t}'`);
      locals.add(name);
      out += 'var';
      continue;
    }
    if (next === '(') {
      const f = FUNCTIONS[t];
      if (!f) throw new RuleError(`unsupported function '${t}'`);
      out += f;
      continue;
    }
    if (!known.has(t) && !locals.has(t)) unknown.add(t);
    used.add(t);
    out += `v_${t}`;
  }
  if (unknown.size) throw new RuleError(`unknown name${unknown.size > 1 ? 's' : ''}: ${[...unknown].join(', ')}`);
  if (/\?/.test(out)) throw new RuleError(`the ?: operator isn't supported; use select() or mix()`);
  return { code: out, used };
}

// --- shader generation

/** Neighbourhood operators a formula can use on any reagent, as in Ready. */
const STENCIL_OPS = ['laplacian', 'bilaplacian', 'x_gradient', 'y_gradient', 'gradient_mag_squared'];

/** Ready's 21-point bilaplacian, RotationallySymmetric5x5(0, 1, 1, -2, -10, 36) / 3. */
const BILAP_5X5 = [
  [0, 1, 1, 1, 0],
  [1, -2, -10, -2, 1],
  [1, -10, 36, -10, 1],
  [1, -2, -10, -2, 1],
  [0, 1, 1, 1, 0],
];

/**
 * Extra stencils (the 9-point Laplacian is generated separately, with
 * membranes). Points are [dx, dy, weight] in rdui's y-down grid; Ready's +y
 * points up, so its y_gradient samples the row above as positive.
 */
const STENCILS: { op: string; v: string; points: [number, number, number][]; div: number; dxPower: number }[] = [
  { op: 'bilaplacian', v: 'BL', div: 3, dxPower: 4, points: BILAP_5X5.flatMap((row, j) => row.map((w, i) => [i - 2, j - 2, w] as [number, number, number])).filter((p) => p[2] !== 0) },
  { op: 'x_gradient', v: 'GX', div: 2, dxPower: 1, points: [[1, 0, 1], [-1, 0, -1]] },
  { op: 'y_gradient', v: 'GY', div: 2, dxPower: 1, points: [[0, -1, 1], [0, 1, -1]] },
];

export interface CompiledRule {
  rule: RuleDef;
  layout: Layout;
  stepWGSL: string;
  /** Index of each param in the globals uniform. */
  globalIndex: Map<string, number>;
  globalVec4s: number;
}

export function compileRule(rule: RuleDef): CompiledRule {
  if (rule.reagents.length < 1 || rule.reagents.length > MAX_REAGENTS) throw new RuleError(`rules need 1–${MAX_REAGENTS} reagents`);
  if (rule.paintable.length > MAX_PAINTABLE) throw new RuleError(`at most ${MAX_PAINTABLE} paintable parameters`);
  for (const p of rule.paintable) if (!rule.params.some((q) => q.name === p)) throw new RuleError(`paintable '${p}' isn't a parameter`);

  const layout = layoutOf(rule);
  const { S, P } = layout;
  const R = rule.reagents;
  const mem = rule.membrane;
  if (mem && !rule.params.some((p) => p.name === mem.param)) throw new RuleError(`membrane param '${mem.param}' isn't a parameter`);
  const memSlot = mem ? layout.paramNames.indexOf(mem.param) : -1;
  const known = new Set<string>([
    ...R, ...R.map((r) => `delta_${r}`), ...R.flatMap((r) => STENCIL_OPS.map((op) => `${op}_${r}`)),
    ...rule.params.map((p) => p.name), 'timestep',
  ]);
  const { code, used } = translateFormula(rule.formula, known);

  const globalIndex = new Map<string, number>();
  rule.params.forEach((p, i) => globalIndex.set(p.name, i));
  const globalVec4s = Math.max(1, Math.ceil(rule.params.length / 4));

  const lapSlots = new Set<number>();
  R.forEach((r, i) => used.has(`laplacian_${r}`) && lapSlots.add(i >> 2));
  // other stencils: which state slots need each one
  const needs = (op: string) => {
    const set = new Set<number>();
    R.forEach((r, i) => {
      if (used.has(`${op}_${r}`) || (op.endsWith('_gradient') && used.has(`gradient_mag_squared_${r}`))) set.add(i >> 2);
    });
    return set;
  };
  const dxIndex = rule.params.findIndex((p) => p.name === 'dx');
  const dxSlot = layout.paramNames.indexOf('dx');
  const dxExpr = dxSlot > 0 ? slotRef('params', 'pb', dxSlot) : dxIndex >= 0 ? `g[${dxIndex >> 2}].${COMP[dxIndex & 3]}` : '1.0';

  const L: string[] = [];
  const add = (s: string) => L.push(s);
  add(`struct Info { width: u32, height: u32, _p0: u32, _p1: u32 };`);
  add(`@group(0) @binding(0) var<uniform> info: Info;`);
  add(`@group(0) @binding(1) var<uniform> g: array<vec4<f32>, ${globalVec4s}>;`);
  add(`@group(0) @binding(2) var<storage, read> params: array<vec4<f32>>;`);
  add(`@group(0) @binding(3) var<storage, read> src: array<vec4<f32>>;`);
  add(`@group(0) @binding(4) var<storage, read_write> dst: array<vec4<f32>>;`);
  add(`fn cellIndex(x: i32, y: i32) -> u32 {
  let w = i32(info.width); let h = i32(info.height);
  return u32(((y + h) % h) * w + ((x + w) % w));
}`);
  add(`fn isWall(c: u32) -> bool { return params[c * ${P}u].x > 0.5; }`);
  add(`// OpenCL-style pow: negative bases work for integer exponents.
fn rd_pow(x: f32, y: f32) -> f32 {
  if (x > 0.0) { return pow(x, y); }
  if (x == 0.0) { return select(0.0, 1.0, y == 0.0); }
  if (fract(y) == 0.0) { let r = pow(-x, y); return select(r, -r, fract(y * 0.5) != 0.0); }
  return pow(x, y);
}
fn rd_fmod(x: f32, y: f32) -> f32 { return x - y * trunc(x / y); }`);
  add(`@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= info.width || gid.y >= info.height) { return; }
  let x = i32(gid.x); let y = i32(gid.y);
  let ci = cellIndex(x, y);
  let sb = ci * ${S}u;
  let pb = ci * ${P}u;`);
  for (let k = 0; k < S; k++) add(`  let s${k} = src[sb + ${k}u];`);
  add(`  if (isWall(ci)) {`);
  for (let k = 0; k < S; k++) add(`    dst[sb + ${k}u] = s${k};`);
  add(`    return;\n  }`);

  // Membrane-gated components per state slot.
  const gated = new Map<number, boolean[]>();
  if (mem) {
    for (const r of mem.reagents) {
      const i = R.indexOf(r);
      if (i < 0) throw new RuleError(`membrane reagent '${r}' isn't a reagent`);
      const m = gated.get(i >> 2) ?? [false, false, false, false];
      m[i & 3] = true;
      gated.set(i >> 2, m);
    }
  }
  const memValue = (cell: string) =>
    memSlot > 0 ? slotRef('params', `${cell} * ${P}u`, memSlot) : `g[${(rule.params.findIndex((p) => p.name === mem!.param)) >> 2}].${COMP[rule.params.findIndex((p) => p.name === mem!.param) & 3]}`;

  add(`  let rd_dx = ${dxExpr};`);
  if (lapSlots.size) {
    if (mem) add(`  let myCell = ${memValue('ci')};`);
    for (const k of lapSlots) {
      add(`  var L${k} = -20.0 * s${k};`);
      const g = gated.get(k);
      if (g) add(`  let gate${k} = vec4<bool>(${g.join(', ')});`);
    }
    const nbs: [number, number, number][] = [
      [1, 0, 4], [-1, 0, 4], [0, 1, 4], [0, -1, 4], [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
    ];
    nbs.forEach(([dx, dy, w], n) => {
      add(`  let n${n} = cellIndex(x + ${dx}, y + ${dy}); let nw${n} = isWall(n${n});`);
      if (mem) add(`  let other${n} = abs(${memValue(`n${n}`)} - myCell) > 0.5;`);
      for (const k of lapSlots) {
        const cond = gated.get(k) ? `vec4<bool>(nw${n}) | (vec4<bool>(other${n}) & gate${k})` : `nw${n}`;
        add(`  L${k} += ${w.toFixed(1)} * select(src[n${n} * ${S}u + ${k}u], s${k}, ${cond});`);
      }
    });
    for (const k of lapSlots) add(`  L${k} = L${k} / (6.0 * rd_dx * rd_dx);`);
  }
  for (const st of STENCILS) {
    const slots = needs(st.op);
    if (!slots.size) continue;
    for (const k of slots) add(`  var ${st.v}${k} = vec4<f32>(0.0);`);
    st.points.forEach(([dx, dy, w], n) => {
      add(`  let ${st.v}n${n} = cellIndex(x + ${dx}, y + ${dy}); let ${st.v}w${n} = isWall(${st.v}n${n});`);
      for (const k of slots) add(`  ${st.v}${k} += ${w.toFixed(1)} * select(src[${st.v}n${n} * ${S}u + ${k}u], s${k}, ${st.v}w${n});`);
    });
    for (const k of slots) add(`  ${st.v}${k} = ${st.v}${k} / (${st.div.toFixed(1)} * pow(rd_dx, ${st.dxPower.toFixed(1)}));`);
  }

  R.forEach((r, i) => {
    add(`  var v_${r} = s${i >> 2}.${COMP[i & 3]};`);
    add(`  var v_delta_${r} = 0.0;`);
    if (used.has(`laplacian_${r}`)) add(`  let v_laplacian_${r} = L${i >> 2}.${COMP[i & 3]};`);
    const c = `${i >> 2}.${COMP[i & 3]}`;
    const gm = used.has(`gradient_mag_squared_${r}`);
    for (const st of STENCILS) if (used.has(`${st.op}_${r}`) || (gm && st.op.endsWith('_gradient'))) add(`  let v_${st.op}_${r} = ${st.v}${c};`);
    if (gm) add(`  let v_gradient_mag_squared_${r} = v_x_gradient_${r} * v_x_gradient_${r} + v_y_gradient_${r} * v_y_gradient_${r};`);
  });
  rule.params.forEach((p, i) => {
    if (!used.has(p.name) && p.name !== 'timestep') return;
    const slot = layout.paramNames.indexOf(p.name);
    add(slot > 0 ? `  let v_${p.name} = ${slotRef('params', 'pb', slot)};` : `  let v_${p.name} = g[${i >> 2}].${COMP[i & 3]};`);
  });
  if (!rule.params.some((p) => p.name === 'timestep')) add(`  let v_timestep = 1.0;`);
  add(`  // --- formula`);
  add(code.split('\n').map((l) => '  ' + l.trim()).filter((l) => l.trim()).join('\n'));
  add(`  // ---`);
  for (let k = 0; k < S; k++) {
    const comps = [0, 1, 2, 3].map((c) => {
      const r = R[k * 4 + c];
      return r ? `v_${r} + v_timestep * v_delta_${r}` : '0.0';
    });
    add(`  dst[sb + ${k}u] = vec4<f32>(${comps.join(', ')});`);
  }
  add(`}`);
  return { rule, layout, stepWGSL: L.join('\n'), globalIndex, globalVec4s };
}

// --- initial state

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cell indices covered by a shape. */
function shapeCells(shape: Shape, w: number, h: number, salt: number): number[] {
  const out: number[] = [];
  switch (shape.type) {
    case 'everywhere':
      for (let i = 0; i < w * h; i++) out.push(i);
      break;
    case 'rectangle': {
      const x0 = Math.floor(Math.min(shape.x0, shape.x1) * w), x1 = Math.ceil(Math.max(shape.x0, shape.x1) * w);
      const y0 = Math.floor(Math.min(shape.y0, shape.y1) * h), y1 = Math.ceil(Math.max(shape.y0, shape.y1) * h);
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) out.push(y * w + x);
      break;
    }
    case 'circle': {
      const r = shape.r * Math.max(w, h), cx = shape.cx * w, cy = shape.cy * h;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) out.push(y * w + x);
      break;
    }
    case 'spots': {
      const rnd = mulberry32(shape.seed ^ salt);
      for (let n = 0; n < shape.count; n++) {
        const r = shape.minSize + Math.floor(rnd() * (shape.maxSize - shape.minSize + 1));
        const cx = Math.floor(rnd() * w), cy = Math.floor(rnd() * h);
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) out.push(((cy + y + h) % h) * w + ((cx + x + w) % w));
      }
      break;
    }
  }
  return out;
}

/**
 * Build the initial state and per-cell params for a rule on a w×h grid.
 * Like Ready, reagents start at 0 and the overlays are applied on top; pass
 * `base: 'rest'` to start from the rule's rest state instead (a clean field).
 */
export function initialField(rule: RuleDef, w: number, h: number, globals: Record<string, number>, base: 'zero' | 'rest' = 'zero') {
  const { S, P, paramNames } = layoutOf(rule);
  const state = new Float32Array(w * h * S * 4);
  const params = new Float32Array(w * h * P * 4);
  const cells = w * h;
  for (let i = 0; i < cells; i++) {
    if (base === 'rest') rule.rest.forEach((v, r) => (state[i * S * 4 + r] = v));
    paramNames.forEach((n, k) => (params[i * P * 4 + k] = k === 0 ? 0 : globals[n]));
  }
  // Spots overlays share positions per reset when they share a seed; vary between resets.
  const salt = Math.floor(Math.random() * 2 ** 31);
  for (const o of rule.initial) {
    const r = rule.reagents.indexOf(o.chem);
    if (r < 0) continue;
    for (const c of shapeCells(o.shape, w, h, salt)) {
      const v = o.fill.type === 'constant' ? o.fill.value : o.fill.low + Math.random() * (o.fill.high - o.fill.low);
      const k = c * S * 4 + r;
      switch (o.op) {
        case 'overwrite': state[k] = v; break;
        case 'add': state[k] += v; break;
        case 'subtract': state[k] -= v; break;
        case 'multiply': state[k] *= v; break;
      }
    }
  }
  return { state, params };
}

/** Copy cells between layouts, matching reagents/params by name; missing ones get `fallback`. */
export function remapCells(src: Float32Array, srcNames: string[], srcStride: number, dstNames: string[], dstStride: number, cells: number, fallback: (name: string) => number) {
  const dst = new Float32Array(cells * dstStride * 4);
  const map = dstNames.map((n) => srcNames.indexOf(n));
  const fb = dstNames.map(fallback);
  for (let i = 0; i < cells; i++) {
    for (let k = 0; k < dstNames.length; k++) {
      dst[i * dstStride * 4 + k] = map[k] >= 0 ? src[i * srcStride * 4 + map[k]] : fb[k];
    }
  }
  return dst;
}

/** Slider range guess for a parameter value with no declared range. */
export function guessRange(v: number): [number, number] {
  if (v === 0) return [-0.05, 0.05];
  return v > 0 ? [0, v * 2] : [v * 2, 0];
}

// --- built-in rules

const GS_PRESET_F = 0.0367;
const GS_PRESET_K = 0.0649;

export const GRAY_SCOTT: RuleDef = {
  name: 'Gray-Scott',
  description: 'Classic two-reagent Gray-Scott. a is the substrate, b the activator. D scales both diffusion rates per cell.',
  reagents: ['a', 'b'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.5 },
    { name: 'D_a', value: 0.3, min: 0, max: 0.37 },
    { name: 'D_b', value: 0.15, min: 0, max: 0.37 },
    { name: 'F', value: GS_PRESET_F, min: 0, max: 0.1 },
    { name: 'k', value: GS_PRESET_K, min: 0.03, max: 0.075 },
    { name: 'D', value: 1, min: 0.05, max: 1.2 },
  ],
  paintable: ['F', 'k', 'D'],
  formula: `delta_a = D * D_a * laplacian_a - a*b*b + F*(1.0 - a);
delta_b = D * D_b * laplacian_b + a*b*b - (F + k)*b;`,
  rest: [1, 0],
  seed: [0.5, 0.25],
  seedNoise: [0, 0.25],
  initial: [
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'spots', count: 12, minSize: 3, maxSize: 8, seed: 1 } },
    { chem: 'b', op: 'overwrite', fill: { type: 'white_noise', low: 0.25, high: 0.35 }, shape: { type: 'spots', count: 12, minSize: 3, maxSize: 8, seed: 1 } },
  ],
  view: { reagent: 'b', low: 0, high: 0.4 },
};

/** Dan Wills' Gray-Scott with History and Wave, "moreLifelike" parameters, from Ready. */
export const GS_HISTORY_WAVE: RuleDef = {
  name: 'GS History+Wave',
  description:
    'Gray-Scott in a, b, with a diffusing summed history in c and a damped wave equation in d (displacement) and e (velocity). ' +
    'c and d feed back into F, k, the diffusion rates and the reagents. Moving features leave trails (c) and wakes (d). ' +
    'Parameters from Dan Wills\' "moreLifelike" Ready pattern.',
  reagents: ['a', 'b', 'c', 'd', 'e'],
  params: [
    ['timestep', 1], ['D_a', 0.164], ['D_b', 0.082], ['k', 0.063], ['F', 0.054], ['a_pow', 1], ['b_pow', 2],
    ['a_to_c', 0], ['b_to_c', 0.005], ['c_damp', 0.0005], ['D_c', 0.01], ['c_pow', 1], ['c_pow_norm', 1],
    ['c_clamp_min', 0], ['c_clamp_max', 1], ['c_to_k', 0.001], ['c_to_F', -0.03], ['c_to_a', 0], ['c_to_b', 0],
    ['c_to_Da', 0], ['c_to_Db', 0], ['a_to_wave', 0], ['b_to_wave', 0.01], ['c_to_wave', 0],
    ['wave_diffusion', 7e-5], ['wave_damp', 0.9993], ['wave_power', 0.9997], ['wave_DC_value', 0.37],
    ['wave_clamp', 22], ['wave_to_F', 0.0033], ['wave_to_k', -0.009], ['wave_to_Da', 0.05], ['wave_to_Db', 0.03],
    ['wave_to_a', 0], ['wave_to_b', -0.0055], ['wave_to_c', 0],
  ].map(([name, value]) => {
    const v = value as number;
    const [min, max] = name === 'F' ? [0, 0.1] : name === 'k' ? [0.03, 0.075] : name === 'c_damp' ? [0, 0.01] : guessRange(v);
    return { name: name as string, value: v, min, max };
  }),
  paintable: ['F', 'k', 'c_damp'],
  formula: `delta_a = (D_a + c*c_to_Da + (d-wave_DC_value)*wave_to_Da) * laplacian_a - pow(a,(float4)a_pow)*pow(b,(float4)b_pow) + (F + c_to_F*c + (d-wave_DC_value)*wave_to_F)*(1.0f-a) + c*c_to_a + (d-wave_DC_value)*wave_to_a;
delta_b = (D_b  + c*c_to_Db + (d-wave_DC_value)*wave_to_Db) * laplacian_b + pow(a,(float4)a_pow)*pow(b,(float4)b_pow) - ((F + c_to_F*c + (d-wave_DC_value)*wave_to_F)+(k + c*c_to_k + (d-wave_DC_value)*wave_to_k))*b + c*c_to_b + (d-wave_DC_value)*wave_to_b;
delta_c = -c*c_damp + a*a_to_c + b*b_to_c + (d-wave_DC_value)*wave_to_c + D_c * laplacian_c;
c = clamp( pow( (float4)( fabs(c)/c_pow_norm ), (float4)c_pow )*c_pow_norm, c_clamp_min, c_clamp_max );
d = wave_DC_value + clamp( sign(d-wave_DC_value) * pow( (float4)( fabs(d-wave_DC_value) * wave_damp), (float4)wave_power ) + a * a_to_wave + b * b_to_wave + c * c_to_wave, -wave_clamp, wave_clamp);
delta_e = (laplacian_d) * wave_diffusion;
delta_d = e + delta_e;`,
  rest: [0.65, 0, 0, 0, 0],
  seed: [0.5, 0.25, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0],
  initial: [
    { chem: 'a', op: 'overwrite', fill: { type: 'white_noise', low: 0.6, high: 0.7001 }, shape: { type: 'everywhere' } },
    { chem: 'b', op: 'overwrite', fill: { type: 'white_noise', low: -0.2, high: 0.42 }, shape: { type: 'rectangle', x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 } },
  ],
  view: { reagent: 'c', low: 0, high: 1, tint: 'b', stepsPerFrame: 20 },
  size: { width: 256, height: 256 },
};

/**
 * History+Wave plus a bistable memory reagent m (Schlögl cubic, stable at 0 and
 * 1, threshold m_theta). m diffuses quickly but can't cross membranes between
 * different painted `cell` ids, so each compartment is a well-mixed memory
 * cell that is either on or off as a whole. Gliders write to it through b:
 * paint b_to_m > 0 for a "set" zone, < 0 for a "reset" zone. m is a pure
 * observer here — it doesn't feed back into a..e.
 */
export const GS_HW_MEMORY: RuleDef = {
  ...GS_HISTORY_WAVE,
  name: 'GS History+Wave+Memory',
  description:
    'GS History+Wave with a sixth reagent m: a bistable memory (stable at 0 and 1) that mixes within painted compartments ' +
    '(cell id) but cannot cross between them. Gliders passing through b_to_m > 0 set a compartment; b_to_m < 0 resets it. ' +
    'A memory cell holds its state indefinitely, and decays back if pushed only part-way.',
  reagents: ['a', 'b', 'c', 'd', 'e', 'm'],
  params: [
    ...GS_HISTORY_WAVE.params,
    { name: 'cell', value: 0, min: 0, max: 8 },
    { name: 'D_m', value: 0.3, min: 0, max: 0.37 },
    { name: 'm_gain', value: 0.01, min: 0, max: 0.05 },
    { name: 'm_theta', value: 0.45, min: 0, max: 1 },
    { name: 'b_to_m', value: 0, min: -0.1, max: 0.1 },
  ],
  paintable: ['F', 'k', 'cell', 'b_to_m'],
  formula: GS_HISTORY_WAVE.formula + `
delta_m = D_m * laplacian_m + m_gain * m * (1.0 - m) * (m - m_theta) + b * b_to_m;
m = clamp(m, -1.0, 2.0);`,
  membrane: { param: 'cell', reagents: ['m'] },
  rest: [...GS_HISTORY_WAVE.rest, 0],
  seed: [...GS_HISTORY_WAVE.seed, null],
  seedNoise: [...GS_HISTORY_WAVE.seedNoise, 0],
  view: { reagent: 'b', low: 0, high: 0.5, tint: 'm', stepsPerFrame: 40 },
};

/**
 * Three-component FitzHugh–Nagumo (Purwins, Bode, Schenk et al.): an activator
 * u with a local inhibitor v and a long-range inhibitor w. Its localized spots
 * behave like particles: they can sit still, travel (slow v: large tau),
 * breathe (slow w: large theta), scatter, bind and annihilate. `rate` scales
 * the reactions so a spot is several cells wide on the lattice.
 * Status: parameters from memory of the paper; spots don't survive yet.
 */
export const FHN3: RuleDef = {
  name: 'Three-component FHN',
  description:
    'Three-component FitzHugh–Nagumo after Schenk, Or-Guil, Bode & Purwins (1997): activator u, local inhibitor v, long-range inhibitor w. ' +
    'Spots are dissipative solitons: still, travelling (raise tau), or breathing (raise theta), and they collide like particles.',
  reagents: ['u', 'v', 'w'],
  params: [
    { name: 'timestep', value: 0.02, min: 0, max: 0.05 },
    { name: 'D_u', value: 1, min: 0, max: 2 },
    { name: 'D_v', value: 0, min: 0, max: 10 },
    { name: 'D_w', value: 8.76, min: 0, max: 15 },
    { name: 'rate', value: 0.04, min: 0.005, max: 0.2 },
    { name: 'lambda', value: 2, min: 0, max: 4 },
    { name: 'kappa1', value: -6.92, min: -10, max: 0 },
    { name: 'kappa3', value: 1, min: 0, max: 4 },
    { name: 'kappa4', value: 8.5, min: 0, max: 15 },
    { name: 'tau', value: 1, min: 0.1, max: 100 },
    { name: 'theta', value: 0.5, min: 0.1, max: 20 },
  ],
  paintable: ['tau', 'theta', 'kappa1'],
  formula: `delta_u = D_u * laplacian_u + rate * (lambda*u - u*u*u - kappa3*v - kappa4*w + kappa1);
delta_v = (D_v * laplacian_v + rate * (u - v)) / tau;
delta_w = (D_w * laplacian_w + rate * (u - w)) / theta;`,
  rest: [-0.8, -0.8, -0.8],
  seed: [1, null, null],
  seedNoise: [0, 0, 0],
  initial: [
    { chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'spots', count: 10, minSize: 4, maxSize: 6, seed: 3 } },
  ],
  view: { reagent: 'u', low: -1, high: 1.2, tint: 'w', stepsPerFrame: 100 },
};

/**
 * Pennybacker & Newell's single-field phyllotaxis model (auxin transport):
 * a Swift–Hohenberg-type equation with quadratic gradient terms. Ported from
 * Ready's Pennybacker2013 kernel (there a hand-written OpenCL kernel).
 */
export const PHYLLOTAXIS: RuleDef = {
  name: 'Phyllotaxis (Pennybacker)',
  description:
    'Single-reagent phyllotaxis model of auxin transport after Pennybacker & Newell (2013): ' +
    'delta_a = mu a − (∇⁴a + 2∇²a + a) − β/3 (|∇a|² + 2a∇²a) − a³. Spots (hexagons), stripes or mixtures depending on mu and β.',
  reagents: ['a'],
  params: [
    { name: 'timestep', value: 0.002, min: 0, max: 0.003 },
    { name: 'dx', value: 0.55, min: 0.3, max: 1 },
    { name: 'mu', value: 0.001, min: -0.2, max: 0.5 },
    { name: 'beta', value: 3, min: 0, max: 6 },
  ],
  paintable: ['mu', 'beta'],
  formula: `delta_a = mu*a - (bilaplacian_a + 2.0*laplacian_a + a) - (beta/3.0)*(gradient_mag_squared_a + 2.0*a*laplacian_a) - a*a*a;`,
  rest: [0],
  seed: [1],
  seedNoise: [0],
  initial: [
    { chem: 'a', op: 'overwrite', fill: { type: 'white_noise', low: -0.1, high: 0.1 }, shape: { type: 'everywhere' } },
  ],
  view: { reagent: 'a', low: -0.6, high: 1.2, stepsPerFrame: 100 },
};

// FHN3 is exported for lab experiments but not listed until its parameters
// are pinned down (spots don't survive on this lattice scaling yet).
export const BUILTIN_RULES = [GRAY_SCOTT, GS_HISTORY_WAVE, GS_HW_MEMORY, PHYLLOTAXIS];

export function defaultGlobals(rule: RuleDef): Record<string, number> {
  return Object.fromEntries(rule.params.map((p) => [p.name, p.value]));
}
