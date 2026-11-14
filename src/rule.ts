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
import type { Second } from './spectral';

export const MAX_REAGENTS = 12;
export const MAX_PAINTABLE = 7;

export interface ParamSpec {
  name: string;
  value: number;
  min: number;
  max: number;
}

export type Fill =
  | { type: 'constant'; value: number }
  | { type: 'white_noise'; low: number; high: number }
  /** On a circle: value · ½(1 − tanh((d − r)/edge)), a flat top with a smooth rim `edge` cells wide (default 2). Elsewhere: value. */
  | { type: 'bump'; value: number; edge?: number }
  /**
   * On a circle: a Gaussian wave packet, amp·exp(−d²/2sigma²)·cos(kx·x + ky·y + phase)
   * (sigma in cells, k in radians per cell, relative to the centre), or its
   * sin part with part 'sin'. Covers the circle's r; elsewhere 0.
   */
  | { type: 'packet'; amp: number; sigma: number; kx?: number; ky?: number; phase?: number; part?: 'cos' | 'sin' };
export type Shape =
  | { type: 'everywhere' }
  | { type: 'rectangle'; x0: number; y0: number; x1: number; y1: number } // normalized, y down
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'spots'; count: number; minSize: number; maxSize: number; seed: number }; // cells; same seed → same spots

export interface Overlay {
  /** A reagent, or a paintable parameter or 'wall' (then the overlay paints its per-cell value). */
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
  /** Parameters the explorer varies by default (else the paintable ones). */
  explore?: string[];
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
  view: { reagent: string; low: number; high: number; tint?: string; stepsPerFrame?: number; palette?: number; hueShape?: number; hueOffset?: number };
  /**
   * Membranes: for the listed reagents, neighbours whose `param` value differs
   * (a painted compartment id) are treated as no-flux, like walls but only for
   * those reagents. Compartments then behave as well-mixed "cells".
   */
  membrane?: { param: string; reagents: string[] };
  /**
   * How laplacian (and bilaplacian) are computed: the 9-point and 21-point
   * stencils (default), or by FFT, perfectly isotropic: 'spectral' uses the
   * 9-point stencil's axis response in every direction (explicit-stable like
   * the stencil, so tuned media carry over), 'spectral-exact' uses −|k|²
   * (needs small timesteps). FFT modes need power-of-two grids ≤ 512 and
   * ignore walls and membranes.
   *
   * Spectral modes also offer `kernel_<reagent>`: the reagent convolved with
   * a difference of unit-mass Gaussians, exp(−r²/2σ1²)/2πσ1² − b·(same with σ2),
   * set by the params kernel_sigma, kernel_b (default 0) and kernel_sigma2, in
   * dx units. A σ wider than the field gives the field's mean. Instead of
   * kernel_sigma a rule can have lap_size, a flat disc's radius: σ = lap_size/2
   * (the Gaussian with the disc's spread). A rule can use bilaplacian_ or kernel_, not both.
   *
   * They also offer the exact free Schrödinger step for a complex field
   * ψ = p + iq: `wave_cos_<r>` and `wave_sin_<r>` are the reagent filtered by
   * cos and sin of ½|k|²·timestep, so p' = wave_cos_p + wave_sin_q and
   * q' = wave_cos_q − wave_sin_p is e^{−i|k|²dt/2}ψ̂ (unconditionally stable).
   * They use both spectral channels, so no other spectral operator can join them.
   *
   * And exact diffusion: `heat1_<r>` / `heat2_<r>` are the reagent after
   * diffusing for one timestep with diffusivity heat_D1 / heat_D2 times zoom²
   * (zoom optional, default 1): stable at any zoom, so features can be made
   * as wide as wanted at the same cost per step. Write the step as
   * delta_a = (heat1_a - a)/timestep + reaction(heat1_a, …). Like wave_, this
   * takes both channels.
   */
  laplacian?: 'stencil' | 'spectral' | 'spectral-exact';
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
  /** Set when the step shader reads FFT-computed operators (bindings 5, 6). */
  spectral?: { second: Second; exact: boolean };
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
    ...R, ...R.map((r) => `delta_${r}`), ...R.flatMap((r) => [...STENCIL_OPS, 'kernel', 'wave_cos', 'wave_sin', 'heat1', 'heat2'].map((op) => `${op}_${r}`)),
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

  const spectral = rule.laplacian === 'spectral' || rule.laplacian === 'spectral-exact';
  if (spectral && mem) throw new RuleError('membranes need the stencil Laplacian');
  const kernelSlots = needs('kernel');
  if (kernelSlots.size && !spectral) throw new RuleError(`kernel_ needs laplacian: 'spectral'`);
  if (kernelSlots.size && needs('bilaplacian').size) throw new RuleError(`a rule can use bilaplacian_ or kernel_, not both`);
  if (kernelSlots.size && !rule.params.some((p) => p.name === 'kernel_sigma' || p.name === 'lap_size')) throw new RuleError(`kernel_ needs a 'kernel_sigma' (or 'lap_size') parameter`);
  const cosSlots = needs('wave_cos'), sinSlots = needs('wave_sin');
  const propagator = cosSlots.size + sinSlots.size > 0;
  if (propagator && !spectral) throw new RuleError(`wave_cos_ and wave_sin_ need laplacian: 'spectral'`);
  if (propagator && (lapSlots.size || kernelSlots.size || needs('bilaplacian').size)) throw new RuleError(`wave_cos_/wave_sin_ can't be combined with other spectral operators`);
  const heat1Slots = needs('heat1'), heat2Slots = needs('heat2');
  const heat = heat1Slots.size + heat2Slots.size > 0;
  if (heat && !spectral) throw new RuleError(`heat1_ and heat2_ need laplacian: 'spectral'`);
  if (heat && (propagator || lapSlots.size || kernelSlots.size || needs('bilaplacian').size)) throw new RuleError(`heat1_/heat2_ can't be combined with other spectral operators`);
  if (heat && !rule.params.some((p) => p.name === 'heat_D1')) throw new RuleError(`heat1_/heat2_ need 'heat_D1' (and 'heat_D2') parameters`);
  for (const k of [...sinSlots, ...heat1Slots]) lapSlots.add(k);
  for (const k of [...cosSlots, ...heat2Slots]) kernelSlots.add(k);
  const spectralBilap = spectral && (needs('bilaplacian').size > 0 || kernelSlots.size > 0);
  const L: string[] = [];
  const add = (s: string) => L.push(s);
  // cell: grid spacing relative to full resolution (the app's resolution scale), multiplies dx
  // cell: grid spacing factor; dt: timestep factor (shorter steps on a finer grid)
  add(`struct Info { width: u32, height: u32, cell: f32, dt: f32 };`);
  add(`@group(0) @binding(0) var<uniform> info: Info;`);
  add(`@group(0) @binding(1) var<uniform> g: array<vec4<f32>, ${globalVec4s}>;`);
  add(`@group(0) @binding(2) var<storage, read> params: array<vec4<f32>>;`);
  add(`@group(0) @binding(3) var<storage, read> src: array<vec4<f32>>;`);
  add(`@group(0) @binding(4) var<storage, read_write> dst: array<vec4<f32>>;`);
  if (spectral && lapSlots.size) add(`@group(0) @binding(5) var<storage, read> lapK: array<vec4<f32>>;`);
  if (spectralBilap) add(`@group(0) @binding(6) var<storage, read> bilapK: array<vec4<f32>>;`);
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

  add(`  let rd_dx = ${dxExpr} * info.cell;`);
  if (lapSlots.size && spectral) {
    for (const k of lapSlots) add(`  let L${k} = lapK[sb + ${k}u];`);
  } else if (lapSlots.size) {
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
    if (spectral && st.op === 'bilaplacian') {
      for (const k of slots) add(`  let ${st.v}${k} = bilapK[sb + ${k}u];`);
      continue;
    }
    for (const k of slots) add(`  var ${st.v}${k} = vec4<f32>(0.0);`);
    st.points.forEach(([dx, dy, w], n) => {
      add(`  let ${st.v}n${n} = cellIndex(x + ${dx}, y + ${dy}); let ${st.v}w${n} = isWall(${st.v}n${n});`);
      for (const k of slots) add(`  ${st.v}${k} += ${w.toFixed(1)} * select(src[${st.v}n${n} * ${S}u + ${k}u], s${k}, ${st.v}w${n});`);
    });
    for (const k of slots) add(`  ${st.v}${k} = ${st.v}${k} / (${st.div.toFixed(1)} * pow(rd_dx, ${st.dxPower.toFixed(1)}));`);
  }

  for (const k of kernelSlots) add(`  let KR${k} = bilapK[sb + ${k}u];`);
  R.forEach((r, i) => {
    add(`  var v_${r} = s${i >> 2}.${COMP[i & 3]};`);
    if (used.has(`kernel_${r}`)) add(`  let v_kernel_${r} = KR${i >> 2}.${COMP[i & 3]};`);
    if (used.has(`wave_cos_${r}`)) add(`  let v_wave_cos_${r} = KR${i >> 2}.${COMP[i & 3]};`);
    if (used.has(`wave_sin_${r}`)) add(`  let v_wave_sin_${r} = L${i >> 2}.${COMP[i & 3]};`);
    if (used.has(`heat1_${r}`)) add(`  let v_heat1_${r} = L${i >> 2}.${COMP[i & 3]};`);
    if (used.has(`heat2_${r}`)) add(`  let v_heat2_${r} = KR${i >> 2}.${COMP[i & 3]};`);
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
    const v = slot > 0 ? slotRef('params', 'pb', slot) : `g[${i >> 2}].${COMP[i & 3]}`;
    add(`  let v_${p.name} = ${v}${p.name === 'timestep' ? ' * info.dt' : ''};`);
  });
  if (!rule.params.some((p) => p.name === 'timestep')) add(`  let v_timestep = info.dt;`);
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
  return { rule, layout, stepWGSL: L.join('\n'), globalIndex, globalVec4s, spectral: spectral ? { second: heat ? 'heat' : propagator ? 'propagator' : kernelSlots.size ? 'kernel' : spectralBilap ? 'bilap' : 'none', exact: rule.laplacian === 'spectral-exact' } : undefined };
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

function packetValue(f: Extract<Fill, { type: 'packet' }>, at: { cx: number; cy: number } | null, x: number, y: number) {
  if (!at) return 0;
  const dx = x + 0.5 - at.cx, dy = y + 0.5 - at.cy;
  const th = (f.kx ?? 0) * dx + (f.ky ?? 0) * dy + (f.phase ?? 0);
  return f.amp * Math.exp(-(dx * dx + dy * dy) / (2 * f.sigma * f.sigma)) * (f.part === 'sin' ? Math.sin(th) : Math.cos(th));
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
function scaleOverlay(o: Overlay, cell: number): Overlay {
  const f = o.fill, sh = o.shape;
  const fill: Fill = f.type === 'packet' ? { ...f, sigma: f.sigma / cell, kx: (f.kx ?? 0) * cell, ky: (f.ky ?? 0) * cell }
    : f.type === 'bump' ? { ...f, edge: (f.edge ?? 2) / cell } : f;
  const shape: Shape = sh.type === 'spots' ? { ...sh, minSize: Math.max(1, Math.round(sh.minSize / cell)), maxSize: Math.max(1, Math.round(sh.maxSize / cell)) } : sh;
  return { ...o, fill, shape };
}

/**
 * The rule's initial field on a w×h grid. `cell` is the grid spacing relative to
 * full resolution (2 at half resolution): sizes given in cells (spots, packet
 * widths and wavenumbers, bump rims) are scaled so the field looks the same.
 */
export function initialField(rule: RuleDef, w: number, h: number, globals: Record<string, number>, base: 'zero' | 'rest' = 'zero', cell = 1) {
  if (cell !== 1) rule = { ...rule, initial: rule.initial.map((o) => scaleOverlay(o, cell)) };
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
    const r = rule.reagents.indexOf(o.chem), pslot = r < 0 ? paramNames.indexOf(o.chem) : -1;
    if (r < 0 && pslot < 0) continue;
    const [arr, stride, slot] = r >= 0 ? [state, S * 4, r] : [params, P * 4, pslot];
    // a smooth bump reaches past the circle's rim, so its tail isn't cut off
    const sh = o.shape, fill = o.fill;
    const bump = fill.type === 'bump' && sh.type === 'circle' ? { cx: sh.cx * w, cy: sh.cy * h, r: sh.r * Math.max(w, h), e: fill.edge ?? 2 } : null;
    const pk = fill.type === 'packet' && sh.type === 'circle' ? { cx: sh.cx * w, cy: sh.cy * h } : null;
    const cellsOf = bump ? shapeCells({ ...sh, r: (bump.r + 4 * bump.e) / Math.max(w, h) } as Shape, w, h, salt) : shapeCells(sh, w, h, salt);
    for (const c of cellsOf) {
      const v =
        fill.type === 'constant' ? fill.value
        : fill.type === 'packet' ? packetValue(fill, pk, c % w, Math.floor(c / w))
        : fill.type === 'bump' ? (bump ? fill.value * 0.5 * (1 - Math.tanh((Math.hypot((c % w) + 0.5 - bump.cx, Math.floor(c / w) + 0.5 - bump.cy) - bump.r) / bump.e)) : fill.value)
        : fill.low + Math.random() * (fill.high - fill.low);
      const k = c * stride + slot;
      switch (o.op) {
        case 'overwrite': arr[k] = v; break;
        case 'add': arr[k] += v; break;
        case 'subtract': arr[k] -= v; break;
        case 'multiply': arr[k] *= v; break;
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

/**
 * Light-sensitive Belousov–Zhabotinsky (two-variable Oregonator, Field & Noyes;
 * Krug et al.). Under strong light (phi) the medium is sub-excitable: a broken
 * wave neither spreads nor dies but travels as a compact fragment, and
 * fragments collide deterministically — the basis of Adamatzky's
 * collision-based computing.
 */
export const OREGONATOR: RuleDef = {
  name: 'Sub-excitable BZ (Oregonator)',
  description:
    'Two-variable Oregonator with illumination phi: delta_u = (u − u² − (f v + phi_e)(u − q)/(u + q))/eps + D_u ∇²u, delta_v = u − v. ' +
    'Near phi ≈ 0.084 the medium is sub-excitable and broken waves travel as compact wave fragments. ' +
    'Size control (Sakurai, Mihaliuk & Showalter 2002): the light follows the excitation, phi_e = phi + K_h·h, where h tracks the ' +
    'field mean of u (or, with a smaller kernel_sigma, a local average) with lag tau_h, so a fragment that grows dims itself back.',
  reagents: ['u', 'v', 'h'],
  params: [
    { name: 'timestep', value: 0.001, min: 0, max: 0.004 },
    { name: 'dx', value: 0.25, min: 0.1, max: 0.5 },
    { name: 'eps', value: 0.022, min: 0.01, max: 0.05 },
    { name: 'f', value: 1.4, min: 0.5, max: 3 },
    { name: 'q', value: 0.002, min: 0.0005, max: 0.01 },
    { name: 'phi', value: 0.079, min: 0, max: 0.15 },
    { name: 'D_u', value: 1, min: 0, max: 2 },
    { name: 'K_h', value: 0, min: 0, max: 5 },
    { name: 'tau_h', value: 1, min: 0.05, max: 20 },
    { name: 'kernel_sigma', value: 10000, min: 1, max: 10000 },
  ],
  paintable: ['phi'],
  // the light term is very stiff near u ≈ 0 (rate ~ (f v + phi) 2q/(u+q)²/eps, up to ~10⁴):
  // it is taken implicitly (linearised backward Euler), which divides the
  // explicit delta by 1 + timestep·A/(u + q)
  formula: `delta_u = ((u - u*u)/eps + D_u*laplacian_u - ((f*v + phi + K_h*h)/eps)*(u - q)/(u + q)) / (1.0 + timestep*((f*v + phi + K_h*h)/eps)/(u + q));
delta_v = u - v;
delta_h = (kernel_u - h)/tau_h;`,
  laplacian: 'spectral',
  size: { width: 256, height: 256 },
  rest: [0.0019, 0.0019, 0.0019],
  seed: [0.9, null, null],
  seedNoise: [0, 0, 0],
  initial: [
    // a broken wave: an excited strip with a refractory strip behind it, so it can only go right
    { chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 0.9 }, shape: { type: 'rectangle', x0: 0.46, y0: 0.4, x1: 0.48, y1: 0.6 } },
    { chem: 'v', op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'rectangle', x0: 0.4, y0: 0.38, x1: 0.46, y1: 0.62 } },
  ],
  view: { reagent: 'u', low: 0, high: 0.8, tint: 'v', stepsPerFrame: 200 },
};

/**
 * Conservative relativistic fields: sine-Gordon (sg) and φ⁴ (phi4) potentials
 * in one rule, stepped symplectically (v first, then u with the new v), so
 * energy is kept and nothing grows or dies numerically. Kinks are domain walls
 * between vacua; breathers and oscillons are long-lived localized pulses.
 */
export const KLEIN_GORDON: RuleDef = {
  name: 'Klein–Gordon (sine-Gordon / φ⁴)',
  description:
    'u_tt = ∇²u − sg sin u − phi4 (u³ − u) − mass u − gamma u_t + nu ∇²u_t, with v = u_t. Reversible when gamma = nu = 0: ' +
    'kinks (walls between vacua), breathers and oscillons (pulsing lumps) that collide without friction.',
  reagents: ['u', 'v'],
  params: [
    { name: 'timestep', value: 0.05, min: 0, max: 0.15 },
    { name: 'dx', value: 0.25, min: 0.1, max: 1 },
    { name: 'sg', value: 1, min: 0, max: 2 },
    { name: 'phi4', value: 0, min: 0, max: 2 },
    { name: 'mass', value: 0, min: -1, max: 1 },
    { name: 'gamma', value: 0, min: 0, max: 0.1 },
    { name: 'nu', value: 0.02, min: 0, max: 0.2 },
  ],
  paintable: ['gamma'],
  // nu: viscosity on v, which damps grid-scale ripples (~k²) and barely touches smooth kinks and breathers
  formula: `delta_v = laplacian_u - sg*sin(u) - phi4*(u*u*u - u) - mass*u - gamma*v + nu*laplacian_v;
delta_u = v + timestep*(laplacian_u - sg*sin(u) - phi4*(u*u*u - u) - mass*u - gamma*v + nu*laplacian_v);`,
  rest: [0, 0],
  seed: [6.2832, null],
  seedNoise: [0, 0],
  initial: [
    { chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 6.2832 }, shape: { type: 'spots', count: 6, minSize: 10, maxSize: 24, seed: 3 } },
  ],
  view: { reagent: 'u', low: -1, high: 7, tint: 'v', stepsPerFrame: 20 },
};

/**
 * Swift–Hohenberg with quadratic and cubic terms (localized spots and patches
 * for slightly negative r) and a slow inhibitor w that u switches on: −kappa·w.
 * When w lags enough (tau large), a resting spot is unstable and drifts off its
 * own inhibition (Krischer–Mikhailov drift bifurcation).
 */
export const SWIFT_HOHENBERG_FB: RuleDef = {
  name: 'Swift–Hohenberg + inhibitor',
  description:
    'delta_u = r u − (∇⁴u + 2∇²u + u) + b u² − u³ − kappa w, delta_w = (u − w)/tau + D_w ∇²w. ' +
    'Localized spots and patches for r slightly below 0; a slow inhibitor (kappa, tau) can set them moving.',
  reagents: ['u', 'w'],
  params: [
    { name: 'timestep', value: 0.002, min: 0, max: 0.004 },
    { name: 'dx', value: 0.55, min: 0.3, max: 1 },
    { name: 'r', value: -0.2, min: -1, max: 0.5 },
    { name: 'b', value: 1.6, min: 0, max: 3 },
    { name: 'kappa', value: 0, min: 0, max: 2 },
    { name: 'tau', value: 10, min: 0.1, max: 100 },
    { name: 'D_w', value: 0.5, min: 0, max: 5 },
  ],
  paintable: ['r', 'kappa'],
  formula: `delta_u = r*u - (bilaplacian_u + 2.0*laplacian_u + u) + b*u*u - u*u*u - kappa*w;
delta_w = (u - w)/tau + D_w*laplacian_w;`,
  rest: [0, 0],
  seed: [1.2, null],
  seedNoise: [0, 0],
  initial: [
    { chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1.2 }, shape: { type: 'spots', count: 8, minSize: 4, maxSize: 8, seed: 5 } },
  ],
  view: { reagent: 'u', low: -0.5, high: 1.5, tint: 'w', stepsPerFrame: 100 },
};

// FHN3 is exported for lab experiments but not listed until its parameters
// are pinned down (spots don't survive on this lattice scaling yet).
// New rules go at the end: scenes refer to built-ins by index.
/**
 * Neural field (Amari / Wilson–Cowan) with spike-frequency adaptation: firing
 * rate u is driven through a Mexican-hat coupling (near excitation, wider
 * inhibition: a difference of Gaussians applied by FFT) and a sigmoid; a slow
 * adaptation a tires active regions out. With little adaptation, localized
 * bumps sit still; with more, they're pushed off their own tired wake and
 * travel, and colliding bumps scatter, merge or annihilate.
 */
export const NEURAL_FIELD: RuleDef = {
  name: 'Neural field (Amari + adaptation)',
  description:
    'delta_u = (−u + f(A·(w ⊗ u) − g·a + I))/tau, f(x) = 1/(1 + exp(−beta (x − theta))), delta_a = (u − a)/tau_a. ' +
    'w = G(kernel_sigma) − kernel_b·G(kernel_sigma2), unit-mass Gaussians: near excitation, wider inhibition.',
  reagents: ['u', 'a'],
  params: [
    { name: 'timestep', value: 0.1, min: 0, max: 0.5 },
    { name: 'dx', value: 0.2, min: 0.05, max: 1 },
    { name: 'A', value: 8, min: 0, max: 20 },
    { name: 'kernel_sigma', value: 1, min: 0.2, max: 5 },
    { name: 'kernel_b', value: 0.9, min: 0, max: 2 },
    { name: 'kernel_sigma2', value: 2, min: 0.2, max: 10 },
    { name: 'theta', value: 1, min: -2, max: 4 },
    { name: 'beta', value: 10, min: 1, max: 50 },
    { name: 'g', value: 0.5, min: 0, max: 5 },
    { name: 'tau', value: 1, min: 0.1, max: 5 },
    { name: 'tau_a', value: 10, min: 1, max: 100 },
    { name: 'I', value: 0, min: -2, max: 2 },
  ],
  paintable: ['I', 'g'],
  formula: `delta_u = (-u + 1.0/(1.0 + exp(-beta*(A*kernel_u - g*a + I - theta))))/tau;
delta_a = (u - a)/tau_a;`,
  laplacian: 'spectral',
  size: { width: 256, height: 256 },
  rest: [0, 0],
  seed: [1, null],
  seedNoise: [0, 0],
  initial: [
    { chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'spots', count: 6, minSize: 6, maxSize: 10, seed: 3 } },
  ],
  view: { reagent: 'u', low: 0, high: 1, tint: 'a', stepsPerFrame: 8 },
};

/**
 * Saturable nonlinear Schrödinger equation (light in a saturable medium):
 * i ψ_t = −½∇²ψ − g·|ψ|²/(1 + s|ψ|²)·ψ + V·ψ, ψ = p + iq. Split-step: the dispersion
 * is applied exactly by FFT (wave_cos/wave_sin), then the nonlinearity as an
 * exact local phase rotation; both keep |ψ|, so any timestep is stable and
 * the total power is conserved (gamma, paintable, absorbs for sponge borders).
 * V, paintable, is a potential: wells guide and trap, barriers reflect.
 * Self-focusing balances dispersion in 2D solitons ("light bullets"); saturation
 * stops them collapsing. n shows the intensity |ψ|².
 */
export const SATURABLE_NLS: RuleDef = {
  name: 'Saturable Schrödinger (NLS)',
  description:
    'i ψ_t = −½∇²ψ − g·I/(1 + s·I)·ψ + V·ψ, I = |ψ|², ψ = p + iq, by exact split steps (FFT dispersion, local phase rotation). ' +
    'V is a paintable potential (a refractive-index landscape): low V guides and traps solitons, high V reflects them. ' +
    'Conservative: solitons collide elastically, merge, repel or swap power depending on their relative phase. gamma absorbs.',
  reagents: ['p', 'q', 'n'],
  params: [
    { name: 'timestep', value: 0.05, min: 0, max: 0.5 },
    { name: 'dx', value: 0.25, min: 0.05, max: 1 },
    { name: 'g', value: 1, min: -2, max: 4 },
    { name: 's', value: 0.5, min: 0, max: 5 },
    { name: 'gamma', value: 0, min: 0, max: 1 },
    { name: 'V', value: 0, min: -2, max: 2 },
  ],
  paintable: ['gamma', 'V'],
  formula: `float P = wave_cos_p + wave_sin_q;
float Q = wave_cos_q - wave_sin_p;
float I = P*P + Q*Q;
float ph = (g*I/(1.0 + s*I) - V)*timestep;
float damp = exp(-gamma*timestep);
float P2 = damp*(P*cos(ph) - Q*sin(ph));
float Q2 = damp*(P*sin(ph) + Q*cos(ph));
delta_p = (P2 - p)/timestep;
delta_q = (Q2 - q)/timestep;
delta_n = (P2*P2 + Q2*Q2 - n)/timestep;`,
  laplacian: 'spectral',
  size: { width: 256, height: 256 },
  rest: [0, 0, 0],
  seed: [1, null, null],
  seedNoise: [0, 0, 0],
  initial: [
    { chem: 'p', op: 'add', fill: { type: 'packet', amp: 2, sigma: 6 }, shape: { type: 'circle', cx: 0.35, cy: 0.5, r: 0.12 } },
    { chem: 'p', op: 'add', fill: { type: 'packet', amp: 2, sigma: 6 }, shape: { type: 'circle', cx: 0.65, cy: 0.5, r: 0.12 } },
  ],
  view: { reagent: 'n', low: 0, high: 4, tint: 'p', stepsPerFrame: 4 },
};

/**
 * Gray-Scott with exact spectral diffusion: each step diffuses a and b exactly
 * (heat1_/heat2_, by FFT) and then reacts. Stable at any zoom, so the same
 * chemistry plays out zoom times larger (zoom² wider diffusion), at one cost
 * per step whatever the zoom.
 */
export const GRAY_SCOTT_ZOOM: RuleDef = {
  name: 'Gray-Scott (zoom)',
  description: 'Gray-Scott with exact diffusion by FFT: zoom scales every feature up (diffusion × zoom²) and stays stable at any zoom, '
    + 'so the same patterns play out larger and smoother, at higher resolution. Each step diffuses exactly, then reacts. Bigger features '
    + 'take longer to form (roughly zoom² more steps to cross the field), so raise steps/frame. Seed with a wide brush. Grid at most 512².',
  reagents: ['a', 'b'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.5 },
    { name: 'heat_D1', value: 0.3, min: 0, max: 1 },
    { name: 'heat_D2', value: 0.15, min: 0, max: 1 },
    { name: 'zoom', value: 3, min: 0.5, max: 12 },
    { name: 'F', value: GS_PRESET_F, min: 0, max: 0.1 },
    { name: 'k', value: GS_PRESET_K, min: 0.03, max: 0.075 },
  ],
  paintable: ['F', 'k'],
  laplacian: 'spectral',
  formula: `float A = heat1_a; float B = heat2_b;
delta_a = (A - a)/timestep - A*B*B + F*(1.0 - A);
delta_b = (B - b)/timestep + A*B*B - (F + k)*B;`,
  rest: [1, 0],
  seed: [0.5, 0.25],
  seedNoise: [0, 0.25],
  initial: [
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'spots', count: 10, minSize: 12, maxSize: 26, seed: 1 } },
    { chem: 'b', op: 'overwrite', fill: { type: 'white_noise', low: 0.25, high: 0.35 }, shape: { type: 'spots', count: 10, minSize: 12, maxSize: 26, seed: 1 } },
  ],
  view: { reagent: 'b', low: 0, high: 0.4, stepsPerFrame: 20 },
  size: { width: 512, height: 512 },
};

/**
 * Dan's GrayScottHSVFleck shader as a rule: Gray-Scott plus a third chemical c,
 * made by b and decaying slowly, that lowers the feed, raises the kill and
 * speeds a's diffusion. The shader's wide Laplacian (a flat disc of radius 9,
 * weight 0.02 per cell, halved) is replaced by its smooth equivalent through
 * the FFT: lap_gain·(Gaussian blur − field), with the disc's total weight
 * (gain 2.42) and spread (σ² = ⟨x²⟩ = 19.4). Its 8-bit storage workarounds
 * (neighbour smoothing, spike filter, dither) aren't needed with float state, but
 * its clamp to [0, 1] is kept: it's part of the dynamics (c would otherwise climb
 * to ~9 and a's diffusion with it, past stability).
 */
export const GS_FLECK: RuleDef = {
  name: 'Gray-Scott + c (fleck)',
  description: 'Dan\'s GrayScottHSVFleck: Gray-Scott with a third chemical c that b produces and that decays slowly; c lowers the feed, '
    + 'raises the kill and speeds a\'s diffusion, so where b has been the medium changes. A wide, smooth Laplacian: lap_size is '
    + 'its radius in cells (the shader\'s 9), and features scale with it; lap_gain is its strength. A long timestep. Shown in the HSV fleck palette: (a, b, c) as an RGB colour, re-expressed as '
    + '(value, saturation, hue); try the OKLCH fleck palette and the hue shape/offset sliders too. Seed with a wide brush (radius 10+): '
    + 'small seeds die at this scale (roughly: seed radius ≥ lap_size).'
    + ' Lively for F 0.009–0.019, k 0.046–0.056 (the shader\'s mouse range).',
  reagents: ['a', 'b', 'c'],
  params: [
    { name: 'timestep', value: 3, min: 0, max: 4 },
    { name: 'D_a', value: 0.08, min: 0, max: 0.2 },
    { name: 'D_b', value: 0.04, min: 0, max: 0.2 },
    { name: 'D_c', value: 0.03, min: 0, max: 0.2 },
    { name: 'F', value: 0.014, min: 0, max: 0.1 },
    { name: 'k', value: 0.051, min: 0.03, max: 0.075 },
    { name: 'c_to_F', value: -0.004, min: -0.02, max: 0.02 },
    { name: 'c_to_k', value: 0.002, min: -0.02, max: 0.02 },
    { name: 'c_to_Da', value: 0.03, min: -0.1, max: 0.1 },
    { name: 'c_to_Db', value: 0, min: -0.1, max: 0.1 },
    { name: 'c_damp', value: 0.0055, min: 0, max: 0.05 },
    { name: 'b_to_c', value: 0.05, min: 0, max: 0.2 },
    { name: 'lap_size', value: 8.82, min: 2, max: 40 },
    { name: 'lap_gain', value: 2.42, min: 0.5, max: 5 },
  ],
  paintable: ['F', 'k'],
  laplacian: 'spectral',
  formula: `float La = lap_gain*(kernel_a - a); float Lb = lap_gain*(kernel_b - b); float Lc = lap_gain*(kernel_c - c);
float Fc = F + c_to_F*c; float kc = k + c_to_k*c; float r = a*b*b;
float da = (D_a + c*c_to_Da)*La - r + Fc*(1.0 - a);
float db = (D_b + c*c_to_Db)*Lb + r - (Fc + kc)*b;
float dc = -c*c_damp + b*b_to_c + D_c*Lc;
// the shader's state lives in a colour buffer: every step is clamped to [0, 1]
delta_a = (clamp(a + da*timestep, 0.0, 1.0) - a)/timestep;
delta_b = (clamp(b + db*timestep, 0.0, 1.0) - b)/timestep;
delta_c = (clamp(c + dc*timestep, 0.0, 1.0) - c)/timestep;`,
  rest: [1, 0, 0],
  seed: [0.5, 0.25, 0],
  seedNoise: [0, 0.25, 0],
  initial: [
    // (the shader starts white, a = b = c = 1, but that collapses uniformly and takes
    // seeds with it; seeds sized for the wide Laplacian, 16–30 px, take off instead)
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'spots', count: 14, minSize: 16, maxSize: 30, seed: 3 } },
    { chem: 'b', op: 'overwrite', fill: { type: 'white_noise', low: 0.2, high: 0.4 }, shape: { type: 'spots', count: 14, minSize: 16, maxSize: 30, seed: 3 } },
  ],
  view: { reagent: 'b', low: 0, high: 0.4, stepsPerFrame: 10, palette: 5 },
  size: { width: 512, height: 512 },
};

/**
 * Dan's metaGrayScott (Ready, grayscott-djw/metaGrayScott*.vti) with its 24 raw
 * numbers re-expressed per meta field as four controls. Each field (dF, dk, dDa,
 * dDb) holds its parameter's offset directly: a moving average, over X_mem steps,
 * of the source b + X_diff·(1 − a − b), times X_gain, spread X_reach cells in
 * that time (D = reach²/mem). The raw rule maps exactly onto these (see
 * lab/meta.ts metaFromRaw); Dan's powF becomes F_forget (others are 1 in his tunes).
 */
export const META_GS: RuleDef = {
  name: 'Meta Gray-Scott (meta controls)',
  description: 'Dan\'s metaGrayScott: Gray-Scott whose F, k, D_a and D_b are offset by four extra fields (dF dk dDa dDb) that '
    + 'remember where b has been. Each field has four controls: gain (how far it moves its parameter per unit of source), '
    + 'mem (its memory in steps), reach (how far it spreads in that time, in cells) and diff (how much (1−a−b) adds to b as its source). '
    + 'Regional fields (reach 20–40) make halos and territories; local ones (reach ~1) leave imprints and trails. '
    + 'F_forget (Dan\'s powF − 1) makes the F field forget faster the lower it is (rate F_forget·ln(F_ref/|dF|) per step): '
    + 'after a die-off the extra feed drains fast and growth restarts, which is what gives the default its boom-and-bust cycles; '
    + 'at 0 it dies out instead. '
    + 'D_a + dDa above about 1.5 is beyond what the solver can step at timestep 0.2 and blows up.',
  reagents: ['a', 'b', 'dF', 'dk', 'dDa', 'dDb'],
  params: [
    { name: 'timestep', value: 0.2, min: 0, max: 0.4 },
    { name: 'D_a', value: 0.8, min: 0, max: 1.2 },
    { name: 'D_b', value: 0.4, min: 0, max: 0.8 },
    { name: 'F', value: 0.059, min: 0, max: 0.1 },
    { name: 'k', value: 0.065, min: 0.03, max: 0.075 },
    { name: 'F_gain', value: 12.48, min: -20, max: 30 },
    { name: 'F_mem', value: 200000, min: 1000, max: 400000 },
    { name: 'F_reach', value: 37.4, min: 0.3, max: 80 },
    { name: 'F_diff', value: 0.4, min: -2, max: 2 },
    { name: 'F_forget', value: 0.00005, min: 0, max: 0.0003 },
    { name: 'F_ref', value: 0.24, min: 0.01, max: 1 },
    { name: 'k_gain', value: -0.0715, min: -0.5, max: 0.5 },
    { name: 'k_mem', value: 6250, min: 1000, max: 400000 },
    { name: 'k_reach', value: 1.118, min: 0.3, max: 80 },
    { name: 'k_diff', value: -0.909, min: -2, max: 2 },
    { name: 'Da_gain', value: 5.46, min: -10, max: 15 },
    { name: 'Da_mem', value: 10000, min: 1000, max: 400000 },
    { name: 'Da_reach', value: 18.9, min: 0.3, max: 80 },
    { name: 'Da_diff', value: 1.286, min: -2, max: 2 },
    { name: 'Db_gain', value: 2.487, min: -10, max: 15 },
    { name: 'Db_mem', value: 86957, min: 1000, max: 400000 },
    { name: 'Db_reach', value: 0.659, min: 0.3, max: 80 },
    { name: 'Db_diff', value: 0.1818, min: -2, max: 2 },
  ],
  paintable: ['F', 'k'],
  explore: ['F_gain', 'k_gain', 'Da_gain', 'Db_gain'],
  formula: `float d = 1.0 - a - b;
// per step: a moving average of gain·source over mem steps, diffusing reach²/mem per step (kept explicit-stable)
delta_dF = ((F_gain*(b + F_diff*d) - dF)/F_mem + min(F_reach*F_reach/F_mem, 0.2)*laplacian_dF
  + dF*(pow(max(abs(dF), 1e-12)/F_ref, F_forget) - 1.0))/timestep;
delta_dk = ((k_gain*(b + k_diff*d) - dk)/k_mem + min(k_reach*k_reach/k_mem, 0.2)*laplacian_dk)/timestep;
delta_dDa = ((Da_gain*(b + Da_diff*d) - dDa)/Da_mem + min(Da_reach*Da_reach/Da_mem, 0.2)*laplacian_dDa)/timestep;
delta_dDb = ((Db_gain*(b + Db_diff*d) - dDb)/Db_mem + min(Db_reach*Db_reach/Db_mem, 0.2)*laplacian_dDb)/timestep;
float Fx = F + dF;
delta_a = (D_a + dDa)*laplacian_a - a*b*b + Fx*(1.0 - a);
delta_b = (D_b + dDb)*laplacian_b + a*b*b - (Fx + k + dk)*b;`,
  rest: [1, 0, 0, 0, 0, 0],
  seed: [0.5, 0.25, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0],
  initial: [
    // as Dan's generator: noise in b over a rectangle (his a = 1 − b there; here a is noise too)
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    { chem: 'a', op: 'overwrite', fill: { type: 'white_noise', low: 0, high: 1 }, shape: { type: 'rectangle', x0: 0.2, y0: 0.5, x1: 0.4, y1: 0.8 } },
    { chem: 'b', op: 'overwrite', fill: { type: 'white_noise', low: 0, high: 1 }, shape: { type: 'rectangle', x0: 0.2, y0: 0.5, x1: 0.4, y1: 0.8 } },
  ],
  view: { reagent: 'b', low: 0, high: 0.8, tint: 'dDa', stepsPerFrame: 333 },
  size: { width: 512, height: 512 },
};

const WEATHER_FIELDS = ['F', 'k', 'Da', 'Db'];
/** Defaults: the weather search's #53 (the F field turns turbulent by itself; b makes spots and short worms). */
const WEATHER_DEFAULTS: Record<string, number> = {"F": 0.05539, "k": 0.06528, "F_gain": 0.1487, "F_mem": 51940.0, "F_reach": 2.288, "F_diff": 0.2683, "F_to_F": 0.0, "k_to_F": -0.4404, "Da_to_F": 1.478, "Db_to_F": 0.2748, "k_gain": 0.009507, "k_mem": 82850.0, "k_reach": 1.404, "k_diff": 0.04701, "F_to_k": 2.742, "k_to_k": -2.046, "Da_to_k": 1.105, "Db_to_k": 0.0, "Da_gain": 1.003, "Da_mem": 5138.0, "Da_reach": 0.7529, "Da_diff": 1.414, "F_to_Da": 0.0, "k_to_Da": 0.7135, "Da_to_Da": -2.776, "Db_to_Da": 1.068, "Db_gain": 0.2967, "Db_mem": 2071.0, "Db_reach": 1.343, "Db_diff": 0.507, "F_to_Db": 1.398, "k_to_Db": -2.28, "Da_to_Db": 0.0, "Db_to_Db": -0.5631};

/**
 * Gray-Scott Weather: Meta Gray-Scott's four fields given dynamics of their own.
 * Fields are dimensionless (uX ~ b), each a moving average over X_mem steps of
 * b + X_diff·(1 − a − b) plus the saturated fields, Σ Y_to_X·tanh(uY), spread
 * X_reach cells; X_gain turns uX into its parameter's offset. With every
 * coupling 0 it is Meta Gray-Scott (with F_forget 0).
 */
export const WEATHER_GS: RuleDef = {
  name: 'Gray-Scott Weather',
  description: 'Gray-Scott over four fields that have weather of their own. As in Meta Gray-Scott, fields uF uk uDa uDb remember where b has been '
    + '(X_mem steps, spreading X_reach cells, fed by b + X_diff·(1−a−b)) and offset F, k, D_a, D_b by X_gain·uX. Here they also drive each other '
    + 'through Y_to_X couplings (field Y into field X, via tanh(uY), so they saturate): positive couplings excite, negative ones inhibit; X_to_X '
    + 'makes a field self-exciting (bistable when above 1). Fields with different memories or reaches that excite and inhibit each other '
    + 'can oscillate, travel or pattern by themselves, and the Gray-Scott layer rides on that weather. Every coupling 0 = Meta Gray-Scott.',
  reagents: ['a', 'b', 'uF', 'uk', 'uDa', 'uDb'],
  params: [
    { name: 'timestep', value: 0.2, min: 0, max: 0.4 },
    { name: 'D_a', value: 0.8, min: 0, max: 1.2 },
    { name: 'D_b', value: 0.4, min: 0, max: 0.8 },
    { name: 'F', value: WEATHER_DEFAULTS.F, min: 0, max: 0.1 },
    { name: 'k', value: WEATHER_DEFAULTS.k, min: 0.03, max: 0.075 },
    ...WEATHER_FIELDS.flatMap((X) => [
      { name: `${X}_gain`, value: WEATHER_DEFAULTS[`${X}_gain`] ?? 0, min: X === 'k' ? -0.3 : -3, max: X === 'k' ? 0.3 : 3 },
      { name: `${X}_mem`, value: WEATHER_DEFAULTS[`${X}_mem`] ?? 20000, min: 1000, max: 300000 },
      { name: `${X}_reach`, value: WEATHER_DEFAULTS[`${X}_reach`] ?? 5, min: 0.3, max: 60 },
      { name: `${X}_diff`, value: WEATHER_DEFAULTS[`${X}_diff`] ?? 0, min: -2, max: 2 },
    ]),
    ...WEATHER_FIELDS.flatMap((X) => WEATHER_FIELDS.map((Y) => ({ name: `${Y}_to_${X}`, value: WEATHER_DEFAULTS[`${Y}_to_${X}`] ?? 0, min: -4, max: 4 }))),
  ],
  paintable: ['F', 'k'],
  explore: WEATHER_FIELDS.flatMap((X) => WEATHER_FIELDS.map((Y) => `${Y}_to_${X}`)),
  formula: `float d = 1.0 - a - b;
float tF = tanh(uF); float tk = tanh(uk); float tDa = tanh(uDa); float tDb = tanh(uDb);
${WEATHER_FIELDS.map((X) => `delta_u${X} = ((b + ${X}_diff*d + ${WEATHER_FIELDS.map((Y) => `${Y}_to_${X}*t${Y}`).join(' + ')} - u${X})/${X}_mem
  + min(${X}_reach*${X}_reach/${X}_mem, 0.2)*laplacian_u${X})/timestep;`).join('\n')}
float Fx = F + F_gain*uF;
delta_a = (D_a + Da_gain*uDa)*laplacian_a - a*b*b + Fx*(1.0 - a);
delta_b = (D_b + Db_gain*uDb)*laplacian_b + a*b*b - (Fx + k + k_gain*uk)*b;`,
  rest: [1, 0, 0, 0, 0, 0],
  seed: [0.5, 0.25, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0],
  initial: META_GS.initial,
  view: { reagent: 'b', low: 0, high: 0.8, tint: 'uF', stepsPerFrame: 333 },
  size: { width: 256, height: 256 },
};

/**
 * Gray-Scott Lineages: each b molecule carries its own feed and kill, inherited
 * by the b it makes (a + 2b → 3b) and lost when it decays. Tracked as trait mass
 * q = b·P, which diffuses with b, is made with new b at the parents' trait and
 * decays with b (the conservative form: stable at sharp trait edges). t is the
 * tagged b, the b made by reproduction; untagged b (brush seeds, the opening
 * spots) carry the painted F, k, so painting chooses which lineage a new spot
 * founds; seed_bank mixes that much of the painted traits into all new b (0:
 * pure inheritance). trait_eps only stands in for b's traits where there is no
 * b (the feed there). P_F, P_k show the traits.
 */
export const LINEAGE_FORMULA = `float wild = max(b - t, 0.0);
// the traits feed and kill act with; trait_eps fills in the painted values where there is no b
float ib = 1.0/(b + trait_eps);
float PF = (q_F + (wild + trait_eps)*F)*ib;
float Pk = (q_k + (wild + trait_eps)*k)*ib;
// the traits new b inherits: its parents' (tagged q/b, untagged b the paint), plus seed_bank of the paint
float bank = seed_bank + 1e-9;
float ih = 1.0/(b + bank);
float HF = (q_F + (wild + bank)*F)*ih;
float Hk = (q_k + (wild + bank)*k)*ih;
float made = a*b*b;
float kill = PF + Pk;
delta_t = D_b*laplacian_t + made - kill*t;
delta_q_F = D_b*laplacian_q_F + made*HF - kill*q_F;
delta_q_k = D_b*laplacian_q_k + made*Hk - kill*q_k;
delta_P_F = (PF - P_F)/timestep;
delta_P_k = (Pk - P_k)/timestep;
delta_a = D_a*laplacian_a - made + PF*(1.0 - a);
delta_b = D_b*laplacian_b + made - kill*b;`;

export const GS_LINEAGES: RuleDef = {
  name: 'Gray-Scott Lineages',
  description: 'Gray-Scott where the feed and kill belong to the spots: every b molecule carries a trait (shown in P_F, P_k) that the b it '
    + 'makes inherits, so spots keep their own F and k as they move, and pass them on when they split. Traits travel as trait mass '
    + '(q_F, q_k) that diffuses with b and is made and lost along with it; t is the b made by reproduction. Brush seeds and the opening '
    + 'spots carry the painted F and k, so painting chooses which lineage a new spot founds; spots then carry it into other regions. '
    + 'seed_bank (0 = pure inheritance) mixes that much of the local paint into every new b. '
    + 'Paint two areas with different F/k and watch the lineages compete (tint by P_F).',
  reagents: ['a', 'b', 't', 'q_F', 'q_k', 'P_F', 'P_k'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.5 },
    { name: 'D_a', value: 0.3, min: 0, max: 0.37 },
    { name: 'D_b', value: 0.15, min: 0, max: 0.37 },
    { name: 'F', value: GS_PRESET_F, min: 0, max: 0.1 },
    { name: 'k', value: GS_PRESET_K, min: 0.03, max: 0.075 },
    { name: 'trait_eps', value: 0.001, min: 0.0001, max: 0.05 },
    { name: 'seed_bank', value: 0, min: 0, max: 0.05 },
  ],
  paintable: ['F', 'k'],
  formula: LINEAGE_FORMULA,
  rest: [1, 0, 0, 0, 0, GS_PRESET_F, GS_PRESET_K],
  seed: [0.5, 0.25, null, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0, 0],
  initial: GRAY_SCOTT.initial,
  view: { reagent: 'b', low: 0, high: 0.4, tint: 'P_F' },
};

/**
 * Founder traits for Gray-Scott Selection: a 4×4 grid spanning the band of F/k
 * where spots keep dying and being reborn (lab/turnover.ts: below it they die,
 * above it they settle into calm crowds or stripes). Across: along the band (F
 * 0.013–0.021, k following it); down: across the band (k +0…0.003). Every blend
 * of them stays inside the band.
 */
export function selectionTrait(ix: number, iy: number): [number, number] {
  const F = 0.013 + (0.008 * ix) / 3;
  return [F, 0.0485 + (F - 0.013) + 0.001 * iy];
}

/** The founders as tagged b and trait mass q = b·P in the initial spots (b = 0.3 there), 0 elsewhere. */
const SELECTION_SPOTS = { type: 'spots' as const, count: 48, minSize: 3, maxSize: 8, seed: 2 };
const SELECTION_FOUNDERS: Overlay[] = [
  { chem: 't', op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: SELECTION_SPOTS },
  { chem: 'q_F', op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: SELECTION_SPOTS },
  { chem: 'q_k', op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: SELECTION_SPOTS },
  ...[0, 1, 2, 3].flatMap((ix) => [0, 1, 2, 3].flatMap((iy): Overlay[] => {
    const shape = { type: 'rectangle' as const, x0: ix / 4, y0: iy / 4, x1: (ix + 1) / 4, y1: (iy + 1) / 4 };
    return [
      { chem: 'q_F', op: 'multiply', fill: { type: 'constant', value: selectionTrait(ix, iy)[0] }, shape },
      { chem: 'q_k', op: 'multiply', fill: { type: 'constant', value: selectionTrait(ix, iy)[1] }, shape },
    ];
  })),
];

/**
 * Gray-Scott Selection: Gray-Scott with lineages in a regime with turnover
 * (Pearson ε: spots keep dying and being reborn), started from a grid of
 * founder lineages (tagged b with their trait mass in the opening spots), with
 * Gray-Scott Lineages' formula. No mutation and no randomness.
 */
export const GS_SELECTION: RuleDef = {
  name: 'Gray-Scott Selection',
  description: 'Spots that carry their own feed and kill, in a regime where they keep dying and being reborn (Pearson ε), started from a '
    + '4×4 grid of founder lineages spanning the band where that churn happens (feed and kill rise together across, kill rises down; every '
    + 'blend of them stays in the band). The tint (P_F) is each spot\'s own feed. b carries its trait as a '
    + 'trait mass (q_F, q_k) that diffuses and is made and lost along with b, so every new spot inherits the traits of the spots that made it; '
    + 'lineages that replicate and survive better take over the others\' squares, and where lineages merge their traits blend into hybrids. '
    + 'Nothing random: variation comes only from the founders, the blending and the chaos of the turnover. Seeding with the brush founds '
    + 'a lineage with the painted F and k.',
  reagents: ['a', 'b', 't', 'q_F', 'q_k', 'P_F', 'P_k'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.5 },
    { name: 'D_a', value: 0.3, min: 0, max: 0.37 },
    { name: 'D_b', value: 0.15, min: 0, max: 0.37 },
    { name: 'F', value: 0.017, min: 0, max: 0.1 },
    { name: 'k', value: 0.0535, min: 0.03, max: 0.075 },
    { name: 'trait_eps', value: 0.001, min: 0.0001, max: 0.05 },
    { name: 'seed_bank', value: 0, min: 0, max: 0.05 },
  ],
  paintable: ['F', 'k'],
  formula: LINEAGE_FORMULA,
  rest: [1, 0, 0, 0, 0, 0.017, 0.0535],
  // a seeded spot founds a lineage with the painted traits
  seed: [0.5, 0.25, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0],
  initial: [
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: SELECTION_SPOTS },
    { chem: 'b', op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: SELECTION_SPOTS },
    ...SELECTION_FOUNDERS,
  ],
  view: { reagent: 'b', low: 0, high: 0.5, tint: 'P_F' },
};

/** Gray-Scott Species' founders: spots, worms, maze, curly (the heredity scene's four behaviours). */
export const SPECIES_TRAITS: [number, number][] = [[0.0367, 0.0649], [0.058, 0.065], [0.029, 0.057], [0.018, 0.051]];

/**
 * Gray-Scott Species: particulate rather than blending inheritance. Each species
 * is its own molecule b1..b4 with its own feed and kill (F1, k1, ...), and
 * a + b_i + b_j makes a copy of one parent, so a species is never diluted: it
 * can only gain or lose ground. cross scales reactions between different species
 * (0, the default: only same-species pairs reproduce; 1: as plain Gray-Scott,
 * where the species with the lowest F + k takes every mixed cell). a's feed is
 * the local b-weighted mean of the species' F, or the painted F where there is
 * no b. b (total) and P_F (mean feed) are for display.
 */
export const GS_SPECIES: RuleDef = {
  name: 'Gray-Scott Species',
  description: 'Gray-Scott with four species of b instead of one, each with its own feed and kill (F1, k1 … F4, k4; by default spots, '
    + 'worms, maze and curly). New b is always a copy of a parent, so species never blend: unlike Lineages, where overlapping traits '
    + 'average out, each species keeps its own F and k and its own pattern, and can only win or lose ground. cross sets how readily '
    + 'two different species reproduce together: 0 (default) = only with their own kind, so species hold territories; 1 = as plain '
    + 'Gray-Scott, where the species with the lowest death rate (F + k) takes over every mixed cell and soon the whole field. '
    + 'The paintable F is only the feed where there is no b. The brush seeds species 1. View b (total) tinted by P_F (local mean feed), '
    + 'or view b1…b4 one at a time.',
  reagents: ['a', 'b1', 'b2', 'b3', 'b4', 'b', 'P_F'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.5 },
    { name: 'D_a', value: 0.3, min: 0, max: 0.37 },
    { name: 'D_b', value: 0.15, min: 0, max: 0.37 },
    { name: 'F', value: 0.03, min: 0, max: 0.1 },
    ...SPECIES_TRAITS.flatMap(([F, k], i) => [
      { name: `F${i + 1}`, value: F, min: 0, max: 0.1 },
      { name: `k${i + 1}`, value: k, min: 0.03, max: 0.075 },
    ]),
    { name: 'cross', value: 0, min: 0, max: 1 },
    { name: 'eps', value: 0.001, min: 0.0001, max: 0.05 },
  ],
  paintable: ['F'],
  explore: ['cross', 'F1', 'F2', 'F3', 'F4'],
  formula: `float bt = b1 + b2 + b3 + b4;
float Fx = (F1*b1 + F2*b2 + F3*b3 + F4*b4 + eps*F)/(bt + eps);
delta_b1 = D_b*laplacian_b1 + a*b1*(b1 + cross*(bt - b1)) - (F1 + k1)*b1;
delta_b2 = D_b*laplacian_b2 + a*b2*(b2 + cross*(bt - b2)) - (F2 + k2)*b2;
delta_b3 = D_b*laplacian_b3 + a*b3*(b3 + cross*(bt - b3)) - (F3 + k3)*b3;
delta_b4 = D_b*laplacian_b4 + a*b4*(b4 + cross*(bt - b4)) - (F4 + k4)*b4;
float made = a*(b1*b1 + b2*b2 + b3*b3 + b4*b4 + cross*(bt*bt - b1*b1 - b2*b2 - b3*b3 - b4*b4));
delta_a = D_a*laplacian_a - made + Fx*(1.0 - a);
delta_b = (bt - b)/timestep;
delta_P_F = (Fx - P_F)/timestep;`,
  rest: [1, 0, 0, 0, 0, 0, 0.03],
  seed: [0.5, 0.25, null, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0, 0],
  initial: [
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    ...[1, 2, 3, 4].flatMap((i): Overlay[] => [
      { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'spots', count: 4, minSize: 3, maxSize: 6, seed: 10 + i } },
      { chem: `b${i}`, op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: { type: 'spots', count: 4, minSize: 3, maxSize: 6, seed: 10 + i } },
    ]),
  ],
  view: { reagent: 'b', low: 0, high: 0.5, tint: 'P_F' },
};

/**
 * Gray-Scott Niches: four species b1..b4 as in Gray-Scott Species, but each
 * lives on its own food a1..a4 (fed at its own F), so there is no single
 * ranking by who survives on least food. They compete for space instead:
 * where species overlap each raises the others' death rate (interfere · b_i ·
 * others). An established patch holds its ground and invaders must win at the
 * border. b (total) and P_F (local mean feed) are for display.
 */
export const GS_NICHES: RuleDef = {
  name: 'Gray-Scott Niches',
  description: 'Four species of b, each with its own feed and kill (F1, k1 … F4, k4; by default spots, worms, maze and curly) and, '
    + 'unlike Gray-Scott Species, its own food (a1 … a4). With no shared food there is no single winner by who lives on least; '
    + 'instead species compete for space: where they overlap, each raises the others\' death rate (interfere). A patch keeps its '
    + 'ground unless a neighbour wins at the border, and species never blend. The brush seeds species 1. View b (total) tinted by '
    + 'P_F, or view b1…b4 one at a time.',
  reagents: ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4', 'b', 'P_F'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.5 },
    { name: 'D_a', value: 0.3, min: 0, max: 0.37 },
    { name: 'D_b', value: 0.15, min: 0, max: 0.37 },
    ...SPECIES_TRAITS.flatMap(([F, k], i) => [
      { name: `F${i + 1}`, value: F, min: 0, max: 0.1 },
      { name: `k${i + 1}`, value: k, min: 0.03, max: 0.075 },
    ]),
    { name: 'interfere', value: 1, min: 0, max: 4 },
  ],
  paintable: [],
  explore: ['interfere', 'F1', 'F2', 'F3', 'F4'],
  formula: `float bt = b1 + b2 + b3 + b4;
delta_a1 = D_a*laplacian_a1 - a1*b1*b1 + F1*(1.0 - a1);
delta_a2 = D_a*laplacian_a2 - a2*b2*b2 + F2*(1.0 - a2);
delta_a3 = D_a*laplacian_a3 - a3*b3*b3 + F3*(1.0 - a3);
delta_a4 = D_a*laplacian_a4 - a4*b4*b4 + F4*(1.0 - a4);
delta_b1 = D_b*laplacian_b1 + a1*b1*b1 - (F1 + k1 + interfere*(bt - b1))*b1;
delta_b2 = D_b*laplacian_b2 + a2*b2*b2 - (F2 + k2 + interfere*(bt - b2))*b2;
delta_b3 = D_b*laplacian_b3 + a3*b3*b3 - (F3 + k3 + interfere*(bt - b3))*b3;
delta_b4 = D_b*laplacian_b4 + a4*b4*b4 - (F4 + k4 + interfere*(bt - b4))*b4;
delta_b = (bt - b)/timestep;
delta_P_F = ((F1*b1 + F2*b2 + F3*b3 + F4*b4)/(bt + 1e-4) - P_F)/timestep;`,
  rest: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
  seed: [0.5, null, null, null, 0.25, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0],
  initial: [
    ...[1, 2, 3, 4].map((i): Overlay => ({ chem: `a${i}`, op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } })),
    ...[1, 2, 3, 4].flatMap((i): Overlay[] => [
      { chem: `a${i}`, op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'spots', count: 4, minSize: 3, maxSize: 6, seed: 10 + i } },
      { chem: `b${i}`, op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: { type: 'spots', count: 4, minSize: 3, maxSize: 6, seed: 10 + i } },
    ]),
  ],
  view: { reagent: 'b', low: 0, high: 0.5, tint: 'P_F' },
};

export const BUILTIN_RULES = [GRAY_SCOTT, GS_HISTORY_WAVE, GS_HW_MEMORY, PHYLLOTAXIS, OREGONATOR, KLEIN_GORDON, SWIFT_HOHENBERG_FB, NEURAL_FIELD, SATURABLE_NLS, GRAY_SCOTT_ZOOM, GS_FLECK, META_GS, WEATHER_GS, GS_LINEAGES, GS_SELECTION, GS_SPECIES, GS_NICHES];

export function defaultGlobals(rule: RuleDef): Record<string, number> {
  return Object.fromEntries(rule.params.map((p) => [p.name, p.value]));
}
