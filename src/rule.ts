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
import type { CustomChannel } from './sim';
import type { Second } from './spectral';

export const MAX_REAGENTS = 12;
export const MAX_PAINTABLE = 7;

export interface ParamSpec {
  name: string;
  value: number;
  min: number;
  max: number;
  /**
   * A per-cell signed distance (cells; negative inside) to walls the Wall tool draws, as an
   * SDF union of its strokes. Not painted by the Params brush or Fill all; the outline view
   * draws its zero contour, shifted by the rule's wall_grow.
   */
  distance?: boolean;
}

/** The value a wall distance field holds far from any wall (cells): "at least this far". */
export const FAR = 64;

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
  | { type: 'packet'; amp: number; sigma: number; kx?: number; ky?: number; phase?: number; part?: 'cos' | 'sin' }
  /** On a circle: value·(d/r)², a parabolic bowl (0 at the centre, value at the rim). */
  | { type: 'bowl'; value: number }
  /** Linear from `from` to `to` across the shape's extent along `axis` (a rectangle's, or the whole field's). */
  | { type: 'ramp'; from: number; to: number; axis?: 'x' | 'y' }
  /**
   * A uniform complex field amp·Π tanh(d_i/core)·e^{i·n_i·θ_i} with quantised
   * vortices at (cx, cy) (normalized) of charge n; its real part, or with part
   * 'sin' its imaginary part. Keep the net charge 0 on the wrapping field.
   * With box, the phase comes from mirror images across the field's edges
   * instead (opposite charge in each mirror), so the flow runs along walls
   * there rather than through them: for a fluid held in a box.
   */
  | { type: 'vortices'; amp: number; core: number; list: [number, number, number][]; part?: 'cos' | 'sin'; box?: boolean };
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
  view: { reagent: string; low: number; high: number; tint?: string; stepsPerFrame?: number; palette?: number; hueShape?: number; hueOffset?: number; fleckLow?: number; fleckHigh?: number; fleckGain?: number; custom?: CustomChannel[]; customContrast?: number; customSaturation?: number; customGamma?: number; mode?: 'reagent' | 'params' | 'outlines' };
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
  // Walls are frozen at what they hold (the rest values, as drawn). Next to a sealed wall (flag 1)
  // the stencils use the cell's own value: no flux through it (Neumann). A feed wall (flag 2) is an
  // ordinary neighbour holding its rest values, which diffuse out (Dirichlet). FFT rules can't seal
  // (their Laplacian sees every cell), so all their walls feed, the stencil terms too, to agree.
  add(spectral ? `fn isSealed(c: u32) -> bool { return false; }` : `fn isSealed(c: u32) -> bool { let w = params[c * ${P}u].x; return w > 0.5 && w < 1.5; }`);
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
      add(`  let n${n} = cellIndex(x + ${dx}, y + ${dy}); let nw${n} = isSealed(n${n});`);
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
      add(`  let ${st.v}n${n} = cellIndex(x + ${dx}, y + ${dy}); let ${st.v}w${n} = isSealed(${st.v}n${n});`);
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
    : f.type === 'bump' ? { ...f, edge: (f.edge ?? 2) / cell } : f.type === 'vortices' ? { ...f, core: f.core / cell } : f;
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
        : fill.type === 'bowl' ? bowlValue(fill.value, sh, c % w, Math.floor(c / w), w, h)
        : fill.type === 'ramp' ? rampValue(fill, sh, c % w, Math.floor(c / w), w, h)
        : fill.type === 'vortices' ? vortexValue(fill, c % w, Math.floor(c / w), w, h)
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

function bowlValue(value: number, sh: Shape, x: number, y: number, w: number, h: number) {
  if (sh.type !== 'circle') return value;
  const r = sh.r * Math.max(w, h);
  return value * ((x + 0.5 - sh.cx * w) ** 2 + (y + 0.5 - sh.cy * h) ** 2) / (r * r);
}

function rampValue(fill: { from: number; to: number; axis?: 'x' | 'y' }, sh: Shape, x: number, y: number, w: number, h: number) {
  const along = fill.axis === 'y';
  const u = along ? (y + 0.5) / h : (x + 0.5) / w;
  const [lo, hi] = sh.type === 'rectangle' ? (along ? [sh.y0, sh.y1] : [sh.x0, sh.x1]) : [0, 1];
  const t = Math.min(1, Math.max(0, (u - lo) / Math.max(hi - lo, 1e-9)));
  return fill.from + (fill.to - fill.from) * t;
}

function vortexValue(fill: { amp: number; core: number; list: [number, number, number][]; part?: 'cos' | 'sin'; box?: boolean }, x: number, y: number, w: number, h: number) {
  let re = fill.amp, im = 0;
  for (const [cx, cy, n] of fill.list) {
    // the phase sums the vortex's nearby images: periodic ones, so it wraps
    // smoothly (for net charge 0), or with box mirror images across the edges
    // (charge flipped per mirror); the core depth uses the vortex itself
    let th = 0;
    const d = Math.hypot(x + 0.5 - cx * w, y + 0.5 - cy * h);
    for (let iy = -2; iy <= 2; iy++) for (let ix = -2; ix <= 2; ix++) {
      for (const [sx, sy] of fill.box ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : [[1, 1]]) {
        const px = fill.box ? 2 * ix + sx * cx : cx + ix, py = fill.box ? 2 * iy + sy * cy : cy + iy;
        th += n * sx * sy * Math.atan2(y + 0.5 - py * h, x + 0.5 - px * w);
      }
    }
    const m = Math.tanh(d / fill.core);
    const zr = m * Math.cos(th), zi = m * Math.sin(th);
    [re, im] = [re * zr - im * zi, re * zi + im * zr];
  }
  return fill.part === 'sin' ? im : re;
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
    // keep (k²/2)·timestep < π for every grid mode (k² up to 2(π/dx)², on the diagonal): above 0.02 at dx 0.25
    // the finest ripples turn about π per step, feed off the field and slowly grow (split-step instability)
    { name: 'timestep', value: 0.018, min: 0, max: 0.5 },
    { name: 'dx', value: 0.25, min: 0.05, max: 1 },
    { name: 'g', value: 1, min: -2, max: 4 },
    { name: 's', value: 0.5, min: 0, max: 5 },
    { name: 'gamma', value: 0, min: 0, max: 1 },
    { name: 'V', value: 0, min: -2, max: 2 },
    // walls drawn with the Wall tool, as signed distance fields (cells, negative inside): reflecting
    // ones add wall_V across a 3-cell edge, absorbing ones add damping that fades in from 4 cells
    // outside to full 8 cells in; wall_grow moves every wall's edge out (or in) by that many cells
    { name: 'reflect_d', value: FAR, min: -FAR, max: FAR, distance: true },
    { name: 'absorb_d', value: FAR, min: -FAR, max: FAR, distance: true },
    { name: 'wall_grow', value: 0, min: -8, max: 8 },
    { name: 'wall_V', value: 30, min: 0, max: 60 },
    { name: 'wall_gamma', value: 0.3, min: 0, max: 2 },
    // traps (drawn with the Wall tool, "traps"): a shallow well (trap_V) with friction (trap_D, a diffusion
    // that bleeds off motion) and gain −trap_loss + trap_gain·I − trap_sat·I², balanced at a standard
    // soliton's power (~700): a soliton that comes in is slowed, parked and grown or shrunk to that power;
    // faint ripples die, so an empty trap stays empty
    { name: 'trap_d', value: FAR, min: -FAR, max: FAR, distance: true },
    { name: 'trap_V', value: 0.3, min: 0, max: 2 },
    { name: 'trap_D', value: 0.1, min: 0, max: 0.5 },
    { name: 'trap_loss', value: 0.02, min: 0, max: 0.5 },
    { name: 'trap_gain', value: 0.108, min: 0, max: 0.5 },
    { name: 'trap_sat', value: 0.013, min: 0, max: 0.1 },
  ],
  paintable: ['gamma', 'V', 'reflect_d', 'absorb_d', 'trap_d'],
  explore: ['gamma', 'V'],
  formula: `float P0 = wave_cos_p + wave_sin_q;
float Q0 = wave_cos_q - wave_sin_p;
// in a trap, friction: push back against the free step's change, −β·i·(ψ' − ψ), which damps like
// diffusion trap_D (β = 2·trap_D), cell by cell
float mt = 1.0 - smoothstep(-4.0, 4.0, trap_d - wall_grow);
float b = 2.0*trap_D*mt;
float P = P0 + b*(Q0 - q);
float Q = Q0 - b*(P0 - p);
float I = P*P + Q*Q;
float Vw = V - trap_V*mt + wall_V*(1.0 - smoothstep(-1.5, 1.5, reflect_d - wall_grow));
float gw = gamma + wall_gamma*smoothstep(-8.0, 8.0, wall_grow - absorb_d);
float ph = (g*I/(1.0 + s*I) - Vw)*timestep;
float damp = exp((mt*(trap_gain*I - trap_sat*I*I - trap_loss) - gw)*timestep);
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
  // outlines: painted walls and tracks (V, gamma) show over the wave
  view: { reagent: 'n', low: 0, high: 4, tint: 'p', stepsPerFrame: 12, mode: 'outlines' },
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
 * (gain 2.42) and spread (σ² = ⟨x²⟩ = 19.4). Its dither isn't needed with float state, but its neighbour
 * smoothing and spike filter were also holding down one-cell runaways (flecks): D_micro does that job as a
 * small ordinary diffusion. And
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
    // ordinary nearest-neighbour diffusion, small: the wide kernel alone damps one-cell features no more than
    // big ones, so single cells could run away to the clamp (the flecks); this damps them by k² instead
    { name: 'D_micro', value: 0.02, min: 0, max: 0.08 },
  ],
  paintable: ['F', 'k'],
  laplacian: 'spectral',
  formula: `float La = lap_gain*(kernel_a - a); float Lb = lap_gain*(kernel_b - b); float Lc = lap_gain*(kernel_c - c);
float Fc = F + c_to_F*c; float kc = k + c_to_k*c; float r = a*b*b;
float da = (D_a + c*c_to_Da)*La + D_micro*laplacian_a - r + Fc*(1.0 - a);
float db = (D_b + c*c_to_Db)*Lb + D_micro*laplacian_b + r - (Fc + kc)*b;
float dc = -c*c_damp + b*b_to_c + D_c*Lc + D_micro*laplacian_c;
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
  view: { reagent: 'b', low: 0, high: 0.4, stepsPerFrame: 2, palette: 5 },
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
 * others), and each species' food dip (1 − a_i), which spreads round its
 * pattern, raises the others' death rate too (territory), so a sparse pattern
 * can hold the ground between its spots. An established patch holds its ground
 * and invaders must win at the border. b (total) and P_F (local mean feed) are for display.
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
    { name: 'interfere', value: 0.3, min: 0, max: 4 },
    // how hard each species hits the others where they overlap (times interfere): below 1, a strong grower can share
    ...[1, 2, 3, 4].map((i) => ({ name: `interfere${i}`, value: 1, min: 0, max: 3 })),
    { name: 'territory', value: 0, min: 0, max: 1 },
  ],
  paintable: [],
  explore: ['interfere', 'F1', 'F2', 'F3', 'F4'],
  formula: `float bt = b1 + b2 + b3 + b4;
// the others' pressure on each species: their b, each weighted by how hard it hits (interfere1..4)
float hit = interfere1*b1 + interfere2*b2 + interfere3*b3 + interfere4*b4;
// each species' food dip (1 - a_i) spreads round it and marks its ground against the others
float dt_ = (1.0 - a1) + (1.0 - a2) + (1.0 - a3) + (1.0 - a4);
delta_a1 = D_a*laplacian_a1 - a1*b1*b1 + F1*(1.0 - a1);
delta_a2 = D_a*laplacian_a2 - a2*b2*b2 + F2*(1.0 - a2);
delta_a3 = D_a*laplacian_a3 - a3*b3*b3 + F3*(1.0 - a3);
delta_a4 = D_a*laplacian_a4 - a4*b4*b4 + F4*(1.0 - a4);
delta_b1 = D_b*laplacian_b1 + a1*b1*b1 - (F1 + k1 + interfere*(hit - interfere1*b1) + territory*(dt_ - (1.0 - a1)))*b1;
delta_b2 = D_b*laplacian_b2 + a2*b2*b2 - (F2 + k2 + interfere*(hit - interfere2*b2) + territory*(dt_ - (1.0 - a2)))*b2;
delta_b3 = D_b*laplacian_b3 + a3*b3*b3 - (F3 + k3 + interfere*(hit - interfere3*b3) + territory*(dt_ - (1.0 - a3)))*b3;
delta_b4 = D_b*laplacian_b4 + a4*b4*b4 - (F4 + k4 + interfere*(hit - interfere4*b4) + territory*(dt_ - (1.0 - a4)))*b4;
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

/**
 * Gray-Scott Bubbles: Gray-Scott at the edge of its ring regime (F 0.058, k just under 0.0645), where a
 * disk of b hollows into a round membrane round an empty inside, and neighbouring membranes press flat
 * against each other without merging (its stripes repel). Alone, such a ring grows forever and buckles;
 * here a bubble also holds content m, which spreads freely inside but hardly through the membrane
 * (its diffusion is gated by e^(−b/seal), as ∇·(g∇m)). The content's concentration sets the
 * membrane's k: crowded (small bubble), k below the edge and it grows; as it grows the content thins, and
 * at the target concentration k reaches the edge and growth stops. So a bubble's size is its content ÷
 * target: like osmotic pressure, a feedback the bubble runs itself. k never goes past the edge, where a
 * membrane dies.
 */
/**
 * History+Wave Niches' species: four that each hold about the same share of a 256² field (0.1-1.2% of it alive,
 * the sparse life of History+Wave; denser species such as Niches' spots and worms die in their own history) with
 * feeds far apart, for distinct tints. Found by trying sets; with these all four were still there at 40k steps.
 */
const HW_NICHES_TRAITS: [number, number][] = [[0.042, 0.06], [0.05, 0.062], [0.058, 0.0635], [0.066, 0.065]];
export const GS_HW_NICHES: RuleDef = {
  name: 'GS History+Wave Niches',
  description: 'Gray-Scott Niches (four species, each with its own feed and kill F1, k1 … F4, k4, and its own food a1 … a4, '
    + 'competing for space where they overlap: interfere) inside GS History+Wave\'s medium: one history c, laid down by every '
    + 'species\' b, and one damped wave d, e, rung by them, both shared, and both shifting every species\' feed, kill and '
    + 'diffusion as in History+Wave. So each species lives in the trails and wakes of all the others. Life here is sparse, as in '
    + 'History+Wave: by default four species with feeds 0.042 to 0.066 that each keep a small share (all four still there '
    + 'after 40k steps). The brush seeds species 1. View c (the history) tinted by P_F (the local mean feed, kept where life '
    + 'has gone, so trails show who made them), or b1…b4 one at a time.',
  reagents: ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4', 'c', 'd', 'e', 'P_F'],
  params: [
    ...([
      ['timestep', 1], ['D_a', 0.164], ['D_b', 0.082],
      ...HW_NICHES_TRAITS.flatMap(([F, k], i) => [[`F${i + 1}`, F], [`k${i + 1}`, k]]),
      ['interfere', 0.3], ['interfere1', 1], ['interfere2', 1], ['interfere3', 1], ['interfere4', 1],
      ['history1', 1], ['history2', 1], ['history3', 1], ['history4', 1],
      ['wave1', 1], ['wave2', 1], ['wave3', 1], ['wave4', 1],
      ['b_to_c', 0.005], ['c_damp', 0.0005], ['D_c', 0.01], ['c_to_k', 0.001], ['c_to_F', -0.03],
      ['b_to_wave', 0.01], ['wave_diffusion', 7e-5], ['wave_damp', 0.9993], ['wave_power', 0.9997], ['wave_DC_value', 0.37],
      ['wave_clamp', 4], ['wave_to_F', 0.0033], ['wave_to_k', -0.009], ['wave_to_Da', 0.05], ['wave_to_Db', 0.03], ['wave_to_b', -0.0055],
    ] as [string, number][]).map(([name, v]) => {
      const [min, max] = /^F\d$/.test(name) ? [0, 0.1] : /^k\d$/.test(name) ? [0.03, 0.075] : name === 'interfere' ? [0, 4] : /^(interfere|history|wave)\d$/.test(name) ? [0, 3] : name === 'c_damp' ? [0, 0.01] : guessRange(v);
      return { name, value: v, min, max };
    }),
  ],
  paintable: [],
  explore: ['interfere', 'c_to_F', 'wave_to_F', 'b_to_wave'],
  formula: `float bt = b1 + b2 + b3 + b4;
float w = d - wave_DC_value;
// the others' pressure on each species: their b, each weighted by how hard it hits (interfere1..4)
float hit = interfere1*b1 + interfere2*b2 + interfere3*b3 + interfere4*b4;
// each species' share of the wave's push on b (safe where b is near zero, or a little below it)
float bs = max(bt, 0.01);
float share1 = max(b1, 0.0)/bs;
float share2 = max(b2, 0.0)/bs;
float share3 = max(b3, 0.0)/bs;
float share4 = max(b4, 0.0)/bs;
// the shared medium's shifts to each species' feed, kill and diffusion: the history's part scaled by history1..4 (how
// much it feels where life has been: above 1, a species that floods is held back by its own trails), the wave's by
// wave1..4 (below 1, a species keeps nearer its own feed and kill, as worms need)
// (capped: with four species ringing it the wave can run large, and a negative kill lets b grow without end;
// diffusion kept within what the explicit step can take)
float cF = c_to_F*c;
float ck = c_to_k*c;
float wF = wave_to_F*w;
float wk = wave_to_k*w;
float dF1 = clamp(cF*history1 + wF*wave1, -0.03, 0.03);
float dk1 = clamp(ck*history1 + wk*wave1, -0.03, 0.03);
float Da1 = clamp(D_a + wave_to_Da*w*wave1, 0.0, 0.24);
float Db1 = clamp(D_b + wave_to_Db*w*wave1, 0.0, 0.24);
float dF2 = clamp(cF*history2 + wF*wave2, -0.03, 0.03);
float dk2 = clamp(ck*history2 + wk*wave2, -0.03, 0.03);
float Da2 = clamp(D_a + wave_to_Da*w*wave2, 0.0, 0.24);
float Db2 = clamp(D_b + wave_to_Db*w*wave2, 0.0, 0.24);
float dF3 = clamp(cF*history3 + wF*wave3, -0.03, 0.03);
float dk3 = clamp(ck*history3 + wk*wave3, -0.03, 0.03);
float Da3 = clamp(D_a + wave_to_Da*w*wave3, 0.0, 0.24);
float Db3 = clamp(D_b + wave_to_Db*w*wave3, 0.0, 0.24);
float dF4 = clamp(cF*history4 + wF*wave4, -0.03, 0.03);
float dk4 = clamp(ck*history4 + wk*wave4, -0.03, 0.03);
float Da4 = clamp(D_a + wave_to_Da*w*wave4, 0.0, 0.24);
float Db4 = clamp(D_b + wave_to_Db*w*wave4, 0.0, 0.24);
delta_a1 = Da1*laplacian_a1 - a1*b1*b1 + (F1 + dF1)*(1.0 - a1);
delta_a2 = Da2*laplacian_a2 - a2*b2*b2 + (F2 + dF2)*(1.0 - a2);
delta_a3 = Da3*laplacian_a3 - a3*b3*b3 + (F3 + dF3)*(1.0 - a3);
delta_a4 = Da4*laplacian_a4 - a4*b4*b4 + (F4 + dF4)*(1.0 - a4);
delta_b1 = Db1*laplacian_b1 + a1*b1*b1 - (F1 + k1 + dF1 + dk1 + interfere*(hit - interfere1*b1))*b1 + wave_to_b*w*wave1*share1;
delta_b2 = Db2*laplacian_b2 + a2*b2*b2 - (F2 + k2 + dF2 + dk2 + interfere*(hit - interfere2*b2))*b2 + wave_to_b*w*wave2*share2;
delta_b3 = Db3*laplacian_b3 + a3*b3*b3 - (F3 + k3 + dF3 + dk3 + interfere*(hit - interfere3*b3))*b3 + wave_to_b*w*wave3*share3;
delta_b4 = Db4*laplacian_b4 + a4*b4*b4 - (F4 + k4 + dF4 + dk4 + interfere*(hit - interfere4*b4))*b4 + wave_to_b*w*wave4*share4;
// history and wave as History+Wave's (c clamped to 0-1; d damped, rung by b, clamped, then moved by e), written as
// increments that land on those values
delta_c = clamp(c - c*c_damp + bt*b_to_c + D_c*laplacian_c, 0.0, 1.0) - c;
delta_e = laplacian_d*wave_diffusion;
delta_d = wave_DC_value + clamp(sign(w)*pow(abs(w)*wave_damp, wave_power) + bt*b_to_wave, -wave_clamp, wave_clamp) - d + e + delta_e;
// the tint: the local mean feed where there's life, kept where it has gone, so trails show who made them
delta_P_F = min(bt*20.0, 1.0)*((F1*b1 + F2*b2 + F3*b3 + F4*b4)/max(bt, 1e-4) - P_F)/timestep;`,
  rest: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0.37, 0, 0], // the wave at its DC value, so walls and Erase don't kick it
  seed: [0.5, null, null, null, 0.25, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0, 0, 0],
  initial: [
    ...[1, 2, 3, 4].map((i): Overlay => ({ chem: `a${i}`, op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } })),
    ...[1, 2, 3, 4].flatMap((i): Overlay[] => [
      { chem: `a${i}`, op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'spots', count: 10, minSize: 4, maxSize: 8, seed: 10 + i } },
      { chem: `b${i}`, op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: { type: 'spots', count: 10, minSize: 4, maxSize: 8, seed: 10 + i } },
    ]),
    // the wave at rest (its DC value), not kicked from 0
    { chem: 'd', op: 'overwrite', fill: { type: 'constant', value: 0.37 }, shape: { type: 'everywhere' } },
  ],
  view: { reagent: 'c', low: 0, high: 1, tint: 'P_F', stepsPerFrame: 20 },
};

export const GS_BUBBLES: RuleDef = {
  name: 'Gray-Scott Bubbles (content, work in progress)',
  description: 'Bubbles with membranes that dock. Gray-Scott at the edge of its ring regime: a seeded disk hollows into a round '
    + 'membrane, and neighbouring membranes press flat against each other without merging. Each bubble also holds content (m), '
    + 'which spreads inside but is held in by the membrane; the thinner the content, the closer the membrane\'s k to the edge where '
    + 'growth stops (k_edge). So a bubble grows until its content is down to target, and its size is the content it was seeded '
    + 'with ÷ target: the brush seeds content × the area it paints, so a bubble settles at about √content × the brush radius. '
    + 'View b for the membranes, tinted by m.',
  reagents: ['a', 'b', 'm', 'g', 'gm', 'p'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.5 },
    { name: 'D_a', value: 0.3, min: 0, max: 0.37 },
    { name: 'D_b', value: 0.15, min: 0, max: 0.37 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.3 },
    { name: 'F', value: 0.058, min: 0.04, max: 0.07 },
    { name: 'k_edge', value: 0.0645, min: 0.06, max: 0.066 },
    { name: 'chi', value: 0.05, min: 0, max: 0.2 },
    { name: 'soft', value: 0.2, min: 0.02, max: 1 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'seal', value: 0.03, min: 0.01, max: 0.2 },
  ],
  paintable: [],
  formula: `// pressure p: osmotic, the content's excess over the ambient solution outside (at target). The membrane
// is carried down its gradient (a and b advected at velocity -chi grad p, so the stripe moves as a whole):
// out while the content is crowded, in once it's diluted
delta_a = D_a*laplacian_a - a*b*b + F*(1.0 - a) + chi*(x_gradient_a*x_gradient_p + y_gradient_a*y_gradient_p);
delta_b = D_b*laplacian_b + a*b*b - (F + k_edge)*b + chi*(x_gradient_b*x_gradient_p + y_gradient_b*y_gradient_p);
// (capped at soft either way: the membrane can't be pushed faster than the stripe follows)
// content pushes out (m), tension (target, wherever there is content) pulls in: they balance at m = target
delta_p = (soft*tanh((m - target*min(m/(0.05*target), 1.0))/soft) - p)/timestep;
// content spreads inside, the membrane holds it in: div(g grad m), g = exp(-b/seal), written as
// (lap(g m) + g lap m - m lap g)/2, which sums to exactly zero over the grid (no content made or lost)
// and moves with the membrane (advected at the same velocity, conservatively): a growing bubble pushes the
// solution outside ahead of it rather than swallowing it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) + chi*(x_gradient_m*x_gradient_p + y_gradient_m*y_gradient_p + m*laplacian_p);
delta_g = (exp(-b/seal) - g)/timestep;
delta_gm = (g*m - gm)/timestep;`,
  rest: [1, 0, 0, 1, 0, 0],
  seed: [0.5, 0.25, 4, null, null, null],
  seedNoise: [0, 0.05, 0, 0, 0, 0],
  initial: [
    { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
  ],
  view: { reagent: 'b', low: 0, high: 0.4, tint: 'm' },
};

/**
 * Phase-field Bubbles 2 (three kinds): each bubble is a region of phase φ = 1 in a sea of φ = 0, its edge an Allen-Cahn interface. That
 * interface moves by its own curvature (bulges pulled back, dents pushed out), so a membrane stays smooth and round rather
 * than buckling. Each holds content m, spread inside and held in (its diffusion gated by φ, conservatively); the content's
 * concentration over a target pushes the edge out (osmotic), against the curvature's surface tension pulling it in. A
 * bubble grows until its content is diluted down near target, so its size follows its content. A single φ can't keep
 * neighbours apart (once their faint tails touch, the gap fills in), so there are three kinds, φ1-3, each pushed out where
 * another is: different kinds dock, while two of the same kind that meet merge.
 */
export const PF_BUBBLES: RuleDef = {
  name: 'Phase-field Bubbles 2 (three kinds)',
  description: 'Bubbles as phase fields: φ is 1 inside, 0 outside, and its edge moves by its own curvature (so it smooths '
    + 'bulges and dents rather than buckling) and by the pressure of the content m inside (its excess over target). A bubble '
    + 'grows until its content is diluted to near target, so its size follows its content. Three kinds (φ1-3), each pushed out '
    + 'where another is: neighbours of different kinds dock into a foam, two of the same kind merge. Seed paints a kind-1 '
    + 'bubble (content 3); Paint can set phi2 or phi3 and its m.',
  reagents: ['phi1', 'phi2', 'phi3', 'm1', 'm2', 'm3', 'g1', 'g2', 'g3', 'gm1', 'gm2', 'gm3'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.2, min: 0, max: 0.24 },
    { name: 'well', value: 0.05, min: 0.005, max: 0.2 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'repel', value: 0.1, min: 0, max: 1 },
  ],
  paintable: [],
  formula: `// three kinds of bubble (phases 1-3; a foam can be coloured with three so no two neighbours match), each with its content
// for each: the drive at its edge, its content's pressure (excess over target), capped so the double well keeps two phases
float lambda1 = clamp(pressure*(m1 - target), -0.45, 0.45);
float lambda2 = clamp(pressure*(m2 - target), -0.45, 0.45);
float lambda3 = clamp(pressure*(m3 - target), -0.45, 0.45);
// Allen-Cahn: diffusion and a double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature, so
// bulges are pulled back and dents pushed out (no buckling); lambda tilts the well, moving it out (lambda > 0) or in. Where
// two kinds overlap each is pushed out (repel), so neighbours dock against each other and never merge
delta_phi1 = D_phi*laplacian_phi1 + well*phi1*(1.0 - phi1)*(phi1 - 0.5 + lambda1) - repel*phi1*(phi2*phi2 + phi3*phi3);
delta_phi2 = D_phi*laplacian_phi2 + well*phi2*(1.0 - phi2)*(phi2 - 0.5 + lambda2) - repel*phi2*(phi1*phi1 + phi3*phi3);
delta_phi3 = D_phi*laplacian_phi3 + well*phi3*(1.0 - phi3)*(phi3 - 0.5 + lambda3) - repel*phi3*(phi1*phi1 + phi2*phi2);
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (exactly 0 below 0.3, so phi's faint
// tail outside doesn't let it seep away), written as (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid
// (no content made or lost)
delta_m1 = D_m*0.5*(laplacian_gm1 + g1*laplacian_m1 - m1*laplacian_g1);
delta_m2 = D_m*0.5*(laplacian_gm2 + g2*laplacian_m2 - m2*laplacian_g2);
delta_m3 = D_m*0.5*(laplacian_gm3 + g3*laplacian_m3 - m3*laplacian_g3);
delta_g1 = (smoothstep(0.3, 0.7, phi1) - g1)/timestep;
delta_g2 = (smoothstep(0.3, 0.7, phi2) - g2)/timestep;
delta_g3 = (smoothstep(0.3, 0.7, phi3) - g3)/timestep;
delta_gm1 = (g1*m1 - gm1)/timestep;
delta_gm2 = (g2*m2 - gm2)/timestep;
delta_gm3 = (g3*m3 - gm3)/timestep;`,
  rest: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, null, null, 3, null, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [],
  // custom colours: the three kinds as coral, green and blue; content and the helper fields off
  view: {
    reagent: 'phi1', low: 0, high: 1, palette: 7, customContrast: 1.1, customSaturation: 1, customGamma: 1,
    custom: [[1, 0.42, 0.35], [0.4, 0.85, 0.35], [0.35, 0.55, 1]].map((color) => ({ on: true, low: 0, high: 1, power: 1, color }))
      .concat(Array.from({ length: 9 }, () => ({ on: false, low: 0, high: 1, power: 1, color: [0.5, 0.5, 0.5] }))) as RuleDef['view']['custom'],
  },
};

/**
 * Phase-field Bubbles 1 (one phase): the first phase-field version, kept to compare. One phase φ for every bubble, its edge
 * an Allen-Cahn interface moving by its curvature (no buckling) and pushed out by its content's pressure; content m held in
 * by a smooth step in φ. Neighbours are meant to be kept apart by h, a short blur of φ that sits above φ in a narrow gap
 * between two bubbles, pushing both edges back; but once their faint tails touch the gap fills in and they merge (version
 * 2 fixes that with three kinds).
 */
export const PF_BUBBLES_1: RuleDef = {
  name: 'Phase-field Bubbles 1 (one phase)',
  description: 'The first phase-field bubbles, kept to compare: one phase φ for all bubbles, 1 inside and 0 outside, its edge '
    + 'moving by its own curvature (so it smooths bulges rather than buckling) and by the pressure of the content m inside. A '
    + 'lone bubble settles at a size its content sets; but two that meet merge (the gap push, repel, isn\'t enough). Seed '
    + 'paints a bubble (content 3). View mem (the membrane) tinted by m.',
  reagents: ['phi', 'm', 'h', 'g', 'gm', 'mem'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.2, min: 0, max: 0.24 },
    { name: 'well', value: 0.05, min: 0.005, max: 0.2 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_h', value: 0.2, min: 0, max: 0.24 },
    { name: 'h_decay', value: 0.02, min: 0.002, max: 0.5 },
    { name: 'repel', value: 2, min: 0, max: 8 },
    { name: 'gap_margin', value: 0.08, min: 0, max: 0.5 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure out (its excess over target), crowding in: in a narrow gap between two
// bubbles the blur h sits well above phi (at a lone edge, or inside, it tracks phi); capped so the double well always keeps
// two phases
float lambda = clamp(pressure*(m - target) - repel*max(h - phi - gap_margin, 0.0), -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (exactly 0 below 0.3, so phi's
// faint tail outside doesn't let it seep away), written as (lap(g m) + g lap m - m lap g)/2, which sums to zero over the
// grid (no content made or lost)
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g);
// h: phi blurred over a few cells (relaxes to the local phi, spreads); a narrow gap between two bubbles stays high
delta_h = D_h*laplacian_h + h_decay*(phi - h);
delta_g = (smoothstep(0.3, 0.7, phi) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;`,
  rest: [0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0],
  initial: [],
  view: { reagent: 'mem', low: 0, high: 1, tint: 'm' },
};

/**
 * Phase-field Bubbles 3 (islands stay islands): one phase φ as in version 1, aiming for no two islands ever joining, whatever
 * they are (two bubbles meeting, or the halves of one that's been cut). The halves of a cut stay two; bubbles still growing
 * fast into each other can still merge (the blur h, taking ~50 steps to respond, lags a fast front). Version 1's gap push only tilted the double well, which is
 * weak beside diffusion, and its edges were about 10 cells wide, so two within about 12 cells filled the gap between them
 * even with nothing pushing. Here the edge is sharper (a stronger well, less diffusion: about 4 cells, so gaps of 8 hold
 * by themselves; any sharper and it pins to the grid, bubbles staying rectangles), and a gap is drained directly: outside (φ low) where the blur h is above a half, which only happens
 * where edges face each other, φ is pulled down at a rate beating diffusion, so the gap holds and the bubbles dock.
 */
export const PF_BUBBLES_3: RuleDef = {
  name: 'Phase-field Bubbles 3 (islands stay islands)',
  description: 'Bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside (its excess over target), so a bubble\'s '
    + 'size follows its content. Where two edges face each other across a narrow gap, the gap is drained (drain), so '
    + 'a bubble cut in two (Erase across it) stays two, each rounding up at the size its half of the content sets, docked '
    + 'along a flat wall. Work in progress: bubbles still growing fast into each other can still merge. Seed paints a '
    + 'bubble (content 3). View mem (the membrane) tinted by m.',
  reagents: ['phi', 'm', 'h', 'g', 'gm', 'mphi', 'mem'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_h', value: 0.2, min: 0, max: 0.24 },
    { name: 'h_decay', value: 0.02, min: 0.002, max: 0.5 },
    { name: 'drain', value: 6, min: 0, max: 12 },
    { name: 'gap_margin', value: 0.05, min: 0, max: 0.5 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure out (its excess over target), capped so the double well keeps two phases
float lambda = clamp(pressure*(m - target), -0.45, 0.45);
// a gap: outside (phi low) yet the blur h above a half: only where edges face each other across it does h add up past
// a half outside them (at a lone edge h reaches a half only at the edge itself); none at all where phi is over a half,
// so it can't eat into a bubble (where h is near 1 too)
float gap = max(h - 0.5 - gap_margin, 0.0)*(1.0 - smoothstep(0.1, 0.5, phi));
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in; and a gap is drained directly (not through the well, which
// diffusion from both sides would beat), so islands never join
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda) - drain*gap*phi;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (exactly 0 below 0.3, so phi's
// faint tail outside doesn't let it seep away), written as (lap(g m) + g lap m - m lap g)/2, which sums to zero over the
// grid (no content made or lost)
// and drawn up phi's slope (flux m_inward m grad phi, as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero),
// so content at a retreating edge goes in with it rather than being stranded outside (which drained a shrinking
// bubble, so it shrank further, until it was gone)
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
// h: phi blurred over a few cells (relaxes to the local phi, spreads); a narrow gap between two bubbles stays high
delta_h = D_h*laplacian_h + h_decay*(phi - h);
delta_g = (smoothstep(0.3, 0.7, phi) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;`,
  rest: [0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0],
  initial: [],
  view: { reagent: 'mem', low: 0, high: 1, tint: 'm' },
};

/**
 * Phase-field Bubbles 4 (substrate): version 3's phase field and content, with Gray-Scott's way of keeping membranes apart in
 * place of a gap detector. Bubbles eat a substrate u, fed in from outside, and an edge needs substrate to advance: where it
 * runs short of a lone edge's share (u_edge) the edge is held back. Between two bubbles facing each other the substrate is
 * eaten from both sides, so both edges are held back across the gap, the edges themselves feeling it, not just the gap's
 * middle (version 3's drain acted only there, too late: the edges, still pushed out by full content pressure, ran together).
 * Measured: area in proportion to content (3, 6, 12 from one stamp: 3389, 6877, 13841 cells); a cut bubble stays two; 23
 * stamped bubbles end as 22, round and apart. Starve harder (8) and the bubbles finger and break up (the diffusion-limited
 * growth that makes Gray-Scott membranes buckle); cram them (content 8 in the foam) and pressure wins, merging them.
 */
export const PF_BUBBLES_4: RuleDef = {
  name: 'Phase-field Bubbles 4 (substrate)',
  description: 'Bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back, so neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Work in progress: crammed (lots of content) they still merge. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'mem'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure out (its excess over target); held back where the substrate is short of a lone
// edge's share (between two bubbles, eaten from both sides); capped so the double well keeps two phases
float lambda = clamp(pressure*(m - target) - starve*max(u_edge - u, 0.0), -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
delta_g = (smoothstep(0.02, 0.5, phi) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;`,
  rest: [0, 0, 1, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'mem', low: 0, high: 1, tint: 'm' },
};

/**
 * Phase-field Bubbles 5 (fed pressure): version 4, with the content's outward push needing substrate too. In version 4 a
 * crammed bubble's pressure beat the starving and neighbours merged; here the push out is scaled by the substrate at the
 * edge (u over u_supply, up to 1), so an edge facing a neighbour across a depleted gap can't be pushed into it however
 * crammed the bubble. Pulling in (pressure below target) is never held back.
 */export const PF_BUBBLES_5: RuleDef = {
  name: 'Phase-field Bubbles 5 (fed pressure)',
  description: 'Bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back; and the content\'s push out needs substrate too, so even crammed '
    + 'bubbles can\'t be pushed into each other: neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'mem'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
    { name: 'u_supply', value: 0.3, min: 0.01, max: 1 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure (its excess over target), its push out scaled by the substrate there (u over
// u_supply, up to 1: no pushing into a depleted gap, however crammed), its pull in never held back; held back further
// where the substrate is short of a lone edge's share (between two bubbles, eaten from both sides); capped so the double
// well keeps two phases. Content pushes only where phi is already an edge (over 0.1): the little that seeps into phi's faint
// tail outside would otherwise grow specks there
float P = pressure*(m - target)*smoothstep(0.05, 0.15, phi);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0), -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
delta_g = (smoothstep(0.02, 0.5, phi) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;`,
  rest: [0, 0, 1, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'mem', low: 0, high: 1, tint: 'm' },
};

/**
 * Phase-field Bubbles 6 (lava lamp): version 5's bubbles, each also carrying heat T, held in and spread evenly like its
 * content (so a bubble has one temperature, and its heat goes where it goes). Warm bubbles rise and cool ones sink: φ is
 * moved by tilting its edge out where it faces the way it's going and in where it faces away (buoy·T), its content and
 * heat following (they spread into the cells it opens and are drawn in from those it leaves). The environment, warmth (static, paintable), heats a bubble where it's
 * positive and cools it where it's negative, and heat leaks away slowly everywhere: a heater at the bottom, a cooler at
 * the top, and bubbles rise, cool, sink, warm, and rise again. A moving bubble's front starves as it nears another (the
 * substrate between them eaten from both sides), so they bump rather than merge.
 * Work in progress: warm bubbles rise, but deform into cups as they go and leave faint trails. Found on the way: carrying φ
 * by advection rippled ahead of the sharp edge and the well grew the ripples into droplets (hence the edge tilt); heating
 * faster than heat mixes through a bubble (~4500 steps across 30 cells) pulls its warm part away from the rest.
 */
export const PF_BUBBLES_6: RuleDef = {
  name: 'Phase-field Bubbles 6 (lava lamp)',
  description: 'A lava lamp of bubbles. Each carries heat T (one temperature per bubble) and is buoyant: warm ones rise, '
    + 'cool ones sink (buoy; gravity along gx, gy, y up: (0, −1) is down). Warmth (paintable) heats a bubble where it\'s positive and cools it '
    + 'where negative, and heat leaks away slowly (T_leak): with a heater at the bottom and a cooler at the top they '
    + 'circulate. Work in progress: rising bubbles deform into cups and leave faint trails. As in version 5: bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back; and the content\'s push out needs substrate too, so even crammed '
    + 'bubbles can\'t be pushed into each other: neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'mem', 'T', 'gT', 'Tphi', 'warmth'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
    { name: 'u_supply', value: 0.3, min: 0.01, max: 1 },
    { name: 'buoy', value: 0.3, min: 0, max: 0.45 },
    { name: 'gx', value: 0, min: -1, max: 1 },
    { name: 'gy', value: -1, min: -1, max: 1 },
    { name: 'heat', value: 0.0003, min: 0, max: 0.005 },
    { name: 'T_leak', value: 0.00003, min: 0, max: 0.001 },
    { name: 'T_max', value: 1, min: 0.1, max: 4 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure (its excess over target), its push out scaled by the substrate there (u over
// u_supply, up to 1: no pushing into a depleted gap, however crammed), its pull in never held back; held back further
// where the substrate is short of a lone edge's share (between two bubbles, eaten from both sides); capped so the double
// well keeps two phases. Content pushes only where phi is already an edge (over 0.1): the little that seeps into phi's faint
// tail outside would otherwise grow specks there
float P = pressure*(m - target)*smoothstep(0.05, 0.15, phi);
// And buoyancy moves the edge: tilted out where it faces the way the bubble's going (warm: against gravity gx, gy, y up
// as the gradients, so (0, -1) is down; cool: with it), in where it faces away: the front grows, the back shrinks, so
// the bubble moves, its edge keeping its shape (carrying phi along instead rippled ahead of a sharp edge, and the well
// grew the ripples into droplets). Where it faces: grad phi points in, so -grad phi/|grad phi| is the outward normal.
float Tb = clamp(T, -T_max, T_max);
float gl = sqrt(x_gradient_phi*x_gradient_phi + y_gradient_phi*y_gradient_phi);
// (only on the edge proper, phi over 0.1: in its faint tail the direction is noise, and the push grew droplets there)
float facing = -(x_gradient_phi*(-gx) + y_gradient_phi*(-gy))/max(gl, 0.02)*smoothstep(0.05, 0.15, phi);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0) + buoy*Tb*facing, -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
delta_g = (smoothstep(0.02, 0.5, phi) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;
// heat: spread inside and pulled in at a retreating edge, as content; heated or cooled by the warmth where the bubble is,
// leaking slowly toward 0 (neutral, neither rising nor sinking)
delta_T = D_m*0.5*(laplacian_gT + g*laplacian_T - T*laplacian_g) - m_inward*0.5*(laplacian_Tphi - phi*laplacian_T + T*laplacian_phi) + g*(heat*warmth - T_leak*T);
delta_gT = (g*T - gT)/timestep;
delta_Tphi = (T*phi - Tphi)/timestep;
// the environment: still, as painted
delta_warmth = 0.0;`,
  rest: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T' },
};

/**
 * Phase-field Bubbles 7 (lava lamp, even heating): version 6, with the warmth heating or cooling only a bubble's solid inside
 * (φ over a half), its heat spreading out to the edge from there. In version 6 it acted out into the edge's faint tail too,
 * where heat mixes slowest: tail cells overheated (or overcooled), were pushed hardest, and budded off as dots.
 */export const PF_BUBBLES_7: RuleDef = {
  name: 'Phase-field Bubbles 7 (lava lamp, even heating)',
  description: 'A lava lamp of bubbles. Each carries heat T (one temperature per bubble) and is buoyant: warm ones rise, '
    + 'cool ones sink (buoy; gravity along gx, gy, y up: (0, −1) is down). Warmth (paintable) heats a bubble where it\'s positive and cools it '
    + 'where negative, and heat leaks away slowly (T_leak): with a heater at the bottom and a cooler at the top they '
    + 'circulate. Work in progress: rising bubbles deform into cups and leave faint trails. As in version 5: bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back; and the content\'s push out needs substrate too, so even crammed '
    + 'bubbles can\'t be pushed into each other: neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'mem', 'T', 'gT', 'Tphi', 'warmth'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
    { name: 'u_supply', value: 0.3, min: 0.01, max: 1 },
    { name: 'buoy', value: 0.3, min: 0, max: 0.45 },
    { name: 'gx', value: 0, min: -1, max: 1 },
    { name: 'gy', value: -1, min: -1, max: 1 },
    { name: 'heat', value: 0.0003, min: 0, max: 0.005 },
    { name: 'T_leak', value: 0.00003, min: 0, max: 0.001 },
    { name: 'T_max', value: 1, min: 0.1, max: 4 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure (its excess over target), its push out scaled by the substrate there (u over
// u_supply, up to 1: no pushing into a depleted gap, however crammed), its pull in never held back; held back further
// where the substrate is short of a lone edge's share (between two bubbles, eaten from both sides); capped so the double
// well keeps two phases. Content pushes only where phi is already an edge (over 0.1): the little that seeps into phi's faint
// tail outside would otherwise grow specks there
float P = pressure*(m - target)*smoothstep(0.05, 0.15, phi);
// And buoyancy moves the edge: tilted out where it faces the way the bubble's going (warm: against gravity gx, gy, y up
// as the gradients, so (0, -1) is down; cool: with it), in where it faces away: the front grows, the back shrinks, so
// the bubble moves, its edge keeping its shape (carrying phi along instead rippled ahead of a sharp edge, and the well
// grew the ripples into droplets). Where it faces: grad phi points in, so -grad phi/|grad phi| is the outward normal.
float Tb = clamp(T, -T_max, T_max);
float gl = sqrt(x_gradient_phi*x_gradient_phi + y_gradient_phi*y_gradient_phi);
// (only on the edge proper, phi over 0.1: in its faint tail the direction is noise, and the push grew droplets there)
float facing = -(x_gradient_phi*(-gx) + y_gradient_phi*(-gy))/max(gl, 0.02)*smoothstep(0.05, 0.15, phi);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0) + buoy*Tb*facing, -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
delta_g = (smoothstep(0.02, 0.5, phi) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;
// heat: spread inside and pulled in at a retreating edge, as content; heated or cooled by the warmth on the bubble's solid
// inside only (phi over a half; out in the edge's tail, where heat mixes slowest, it overheated cells that budded off as
// dots), leaking slowly toward 0 (neutral, neither rising nor sinking)
delta_T = D_m*0.5*(laplacian_gT + g*laplacian_T - T*laplacian_g) - m_inward*0.5*(laplacian_Tphi - phi*laplacian_T + T*laplacian_phi) + smoothstep(0.5, 0.9, phi)*heat*warmth - g*T_leak*T;
delta_gT = (g*T - gT)/timestep;
delta_Tphi = (T*phi - Tphi)/timestep;
// the environment: still, as painted
delta_warmth = 0.0;`,
  rest: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T' },
};

/**
 * Phase-field Bubbles 8 (lava lamp, no dots): version 7, with content and buoyancy pushing only on a real edge (φ over
 * 0.3, fully from 0.5). Moving bubbles leave a little content behind, and where φ's faint tail met it the push (from φ
 * 0.1 in versions 5-7) grew dots out of nothing, in rows across the open lamp. But an edge advances through cells below a
 * half, which this no longer pushes: the bubbles froze (version 9 goes another way).
 */
export const PF_BUBBLES_8: RuleDef = {
  name: 'Phase-field Bubbles 8 (lava lamp, no dots)',
  description: 'A lava lamp of bubbles. Each carries heat T (one temperature per bubble) and is buoyant: warm ones rise, '
    + 'cool ones sink (buoy; gravity along gx, gy, y up: (0, −1) is down). Warmth (paintable) heats a bubble where it\'s positive and cools it '
    + 'where negative, and heat leaks away slowly (T_leak): with a heater at the bottom and a cooler at the top they '
    + 'circulate. Work in progress: rising bubbles deform into cups and leave faint trails. As in version 5: bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back; and the content\'s push out needs substrate too, so even crammed '
    + 'bubbles can\'t be pushed into each other: neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'mem', 'T', 'gT', 'Tphi', 'warmth'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
    { name: 'u_supply', value: 0.3, min: 0.01, max: 1 },
    { name: 'buoy', value: 0.3, min: 0, max: 0.45 },
    { name: 'gx', value: 0, min: -1, max: 1 },
    { name: 'gy', value: -1, min: -1, max: 1 },
    { name: 'heat', value: 0.0003, min: 0, max: 0.005 },
    { name: 'T_leak', value: 0.00003, min: 0, max: 0.001 },
    { name: 'T_max', value: 1, min: 0.1, max: 4 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure (its excess over target), its push out scaled by the substrate there (u over
// u_supply, up to 1: no pushing into a depleted gap, however crammed), its pull in never held back; held back further
// where the substrate is short of a lone edge's share (between two bubbles, eaten from both sides); capped so the double
// well keeps two phases. Content pushes only on a real edge (phi over 0.3, fully from 0.5): content left behind by moving
// bubbles, met by phi's faint tail, would otherwise grow dots out of nothing
float P = pressure*(m - target)*smoothstep(0.3, 0.5, phi);
// And buoyancy moves the edge: tilted out where it faces the way the bubble's going (warm: against gravity gx, gy, y up
// as the gradients, so (0, -1) is down; cool: with it), in where it faces away: the front grows, the back shrinks, so
// the bubble moves, its edge keeping its shape (carrying phi along instead rippled ahead of a sharp edge, and the well
// grew the ripples into droplets). Where it faces: grad phi points in, so -grad phi/|grad phi| is the outward normal.
float Tb = clamp(T, -T_max, T_max);
float gl = sqrt(x_gradient_phi*x_gradient_phi + y_gradient_phi*y_gradient_phi);
// (only on a real edge, phi over 0.3: in its faint tail the direction is noise, and the push grew droplets there)
float facing = -(x_gradient_phi*(-gx) + y_gradient_phi*(-gy))/max(gl, 0.02)*smoothstep(0.3, 0.5, phi);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0) + buoy*Tb*facing, -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
delta_g = (smoothstep(0.02, 0.5, phi) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;
// heat: spread inside and pulled in at a retreating edge, as content; heated or cooled by the warmth on the bubble's solid
// inside only (phi over a half; out in the edge's tail, where heat mixes slowest, it overheated cells that budded off as
// dots), leaking slowly toward 0 (neutral, neither rising nor sinking)
delta_T = D_m*0.5*(laplacian_gT + g*laplacian_T - T*laplacian_g) - m_inward*0.5*(laplacian_Tphi - phi*laplacian_T + T*laplacian_phi) + smoothstep(0.5, 0.9, phi)*heat*warmth - g*T_leak*T;
delta_gT = (g*T - gT)/timestep;
delta_Tphi = (T*phi - Tphi)/timestep;
// the environment: still, as painted
delta_warmth = 0.0;`,
  rest: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T' },
};

/**
 * Phase-field Bubbles 9 (lava lamp, ripening): version 7, with content seeping very slowly through the open lamp (its gate
 * never fully shut: leak). Moving bubbles leave a little content behind, and where φ's faint tail met it the push grew dots
 * out of nothing; seeping, it thins out below target, where it pulls rather than pushes, and finds its way back into
 * bubbles. A bubble's own content stays in (the inward pull at its edge). And small bubbles, whose content is under more
 * pressure, slowly lose it to bigger ones and dissolve, as small droplets do in an emulsion (Ostwald ripening). Measured:
 * in the lively lamp the dots still come (20 bubbles to about 50-60 islands, leak 0.002-0.03), budding off bubbles with their
 * own content rather than growing from stray content. Tried and taken out: evaporating content over a threshold, which took
 * the big bubbles too.
 */export const PF_BUBBLES_9: RuleDef = {
  name: 'Phase-field Bubbles 9 (lava lamp, ripening)',
  description: 'A lava lamp of bubbles. Each carries heat T (one temperature per bubble) and is buoyant: warm ones rise, '
    + 'cool ones sink (buoy; gravity along gx, gy, y up: (0, −1) is down). Warmth (paintable) heats a bubble where it\'s positive and cools it '
    + 'where negative, and heat leaks away slowly (T_leak): with a heater at the bottom and a cooler at the top they '
    + 'circulate. Work in progress: rising bubbles deform into cups and leave faint trails. As in version 5: bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back; and the content\'s push out needs substrate too, so even crammed '
    + 'bubbles can\'t be pushed into each other: neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'mem', 'T', 'gT', 'Tphi', 'warmth'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'leak', value: 0.002, min: 0, max: 0.05 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
    { name: 'u_supply', value: 0.3, min: 0.01, max: 1 },
    { name: 'buoy', value: 0.3, min: 0, max: 0.45 },
    { name: 'gx', value: 0, min: -1, max: 1 },
    { name: 'gy', value: -1, min: -1, max: 1 },
    { name: 'heat', value: 0.0003, min: 0, max: 0.005 },
    { name: 'T_leak', value: 0.00003, min: 0, max: 0.001 },
    { name: 'T_max', value: 1, min: 0.1, max: 4 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure (its excess over target), its push out scaled by the substrate there (u over
// u_supply, up to 1: no pushing into a depleted gap, however crammed), its pull in never held back; held back further
// where the substrate is short of a lone edge's share (between two bubbles, eaten from both sides); capped so the double
// well keeps two phases. Content pushes only where phi is already an edge (over 0.1): the little that seeps into phi's faint
// tail outside would otherwise grow specks there
float P = pressure*(m - target)*smoothstep(0.05, 0.15, phi);
// And buoyancy moves the edge: tilted out where it faces the way the bubble's going (warm: against gravity gx, gy, y up
// as the gradients, so (0, -1) is down; cool: with it), in where it faces away: the front grows, the back shrinks, so
// the bubble moves, its edge keeping its shape (carrying phi along instead rippled ahead of a sharp edge, and the well
// grew the ripples into droplets). Where it faces: grad phi points in, so -grad phi/|grad phi| is the outward normal.
float Tb = clamp(T, -T_max, T_max);
float gl = sqrt(x_gradient_phi*x_gradient_phi + y_gradient_phi*y_gradient_phi);
// (only on the edge proper, phi over 0.1: in its faint tail the direction is noise, and the push grew droplets there)
float facing = -(x_gradient_phi*(-gx) + y_gradient_phi*(-gy))/max(gl, 0.02)*smoothstep(0.05, 0.15, phi);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0) + buoy*Tb*facing, -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
// (never fully shut: leak lets content seep through the open lamp, very slowly)
delta_g = (max(smoothstep(0.02, 0.5, phi), leak) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;
// heat: spread inside and pulled in at a retreating edge, as content; heated or cooled by the warmth on the bubble's solid
// inside only (phi over a half; out in the edge's tail, where heat mixes slowest, it overheated cells that budded off as
// dots), leaking slowly toward 0 (neutral, neither rising nor sinking)
delta_T = D_m*0.5*(laplacian_gT + g*laplacian_T - T*laplacian_g) - m_inward*0.5*(laplacian_Tphi - phi*laplacian_T + T*laplacian_phi) + smoothstep(0.5, 0.9, phi)*heat*warmth - g*T_leak*T;
delta_gT = (g*T - gT)/timestep;
delta_Tphi = (T*phi - Tphi)/timestep;
// the environment: still, as painted
delta_warmth = 0.0;`,
  rest: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T' },
};

/**
 * Phase-field Bubbles 10 (lava lamp, slipping past): version 9, with bubbles steering round each other. Each bit of edge is
 * tilted out a little where the substrate rises outward (open space ahead) and in where it falls (a neighbour near, the
 * substrate between them eaten from both sides). A lone bubble feels it evenly all round, so it doesn't move; one meeting
 * another head-on is turned toward the more open side, slipping past rather than pushing; crowded ones ease apart. Motion
 * (buoyancy and steering together) is capped below the speed at which a bubble leaves its content behind.
 * Measured (lab/pf-headon.ts, a warm bubble below a cool one): it doesn't slip them past. At steer 0.3 they jam, drifting
 * apart sideways 16 cells in 400k steps (version 9: 6); at 1-3 they stop short and hover. Each bubble's own halo of eaten
 * substrate dominates (the substrate rises outward all round its edge, so steering mostly pushes out evenly, like more
 * pressure); a neighbour is only a slight lopsidedness in it.
 */export const PF_BUBBLES_10: RuleDef = {
  name: 'Phase-field Bubbles 10 (lava lamp, slipping past)',
  description: 'A lava lamp of bubbles. Each carries heat T (one temperature per bubble) and is buoyant: warm ones rise, '
    + 'cool ones sink (buoy; gravity along gx, gy, y up: (0, −1) is down). Warmth (paintable) heats a bubble where it\'s positive and cools it '
    + 'where negative, and heat leaks away slowly (T_leak): with a heater at the bottom and a cooler at the top they '
    + 'circulate. Work in progress: rising bubbles deform into cups and leave faint trails. As in version 5: bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back; and the content\'s push out needs substrate too, so even crammed '
    + 'bubbles can\'t be pushed into each other: neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'mem', 'T', 'gT', 'Tphi', 'warmth'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'leak', value: 0.002, min: 0, max: 0.05 },
    { name: 'steer', value: 0.3, min: 0, max: 2 },
    { name: 'move_max', value: 0.02, min: 0, max: 0.1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
    { name: 'u_supply', value: 0.3, min: 0.01, max: 1 },
    { name: 'buoy', value: 0.3, min: 0, max: 0.45 },
    { name: 'gx', value: 0, min: -1, max: 1 },
    { name: 'gy', value: -1, min: -1, max: 1 },
    { name: 'heat', value: 0.0003, min: 0, max: 0.005 },
    { name: 'T_leak', value: 0.00003, min: 0, max: 0.001 },
    { name: 'T_max', value: 1, min: 0.1, max: 4 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure (its excess over target), its push out scaled by the substrate there (u over
// u_supply, up to 1: no pushing into a depleted gap, however crammed), its pull in never held back; held back further
// where the substrate is short of a lone edge's share (between two bubbles, eaten from both sides); capped so the double
// well keeps two phases. Content pushes only where phi is already an edge (over 0.1): the little that seeps into phi's faint
// tail outside would otherwise grow specks there
float P = pressure*(m - target)*smoothstep(0.05, 0.15, phi);
// And buoyancy moves the edge: tilted out where it faces the way the bubble's going (warm: against gravity gx, gy, y up
// as the gradients, so (0, -1) is down; cool: with it), in where it faces away: the front grows, the back shrinks, so
// the bubble moves, its edge keeping its shape (carrying phi along instead rippled ahead of a sharp edge, and the well
// grew the ripples into droplets). Where it faces: grad phi points in, so -grad phi/|grad phi| is the outward normal.
float Tb = clamp(T, -T_max, T_max);
float gl = sqrt(x_gradient_phi*x_gradient_phi + y_gradient_phi*y_gradient_phi);
// (only on the edge proper, phi over 0.1: in its faint tail the direction is noise, and the push grew droplets there)
float facing = -(x_gradient_phi*(-gx) + y_gradient_phi*(-gy))/max(gl, 0.02)*smoothstep(0.05, 0.15, phi);
// Steering: tilted out where the substrate rises outward (open space), in where it falls (a neighbour near), along the
// outward normal -grad phi/|grad phi|, on the edge proper only; with buoyancy, capped at move_max (faster, a bubble leaves
// its content behind)
float open_ahead = -(x_gradient_phi*x_gradient_u + y_gradient_phi*y_gradient_u)/max(gl, 0.02)*smoothstep(0.05, 0.15, phi);
float move = clamp(buoy*Tb*facing + steer*open_ahead, -move_max, move_max);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0) + move, -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
// (never fully shut: leak lets content seep through the open lamp, very slowly)
delta_g = (max(smoothstep(0.02, 0.5, phi), leak) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;
// heat: spread inside and pulled in at a retreating edge, as content; heated or cooled by the warmth on the bubble's solid
// inside only (phi over a half; out in the edge's tail, where heat mixes slowest, it overheated cells that budded off as
// dots), leaking slowly toward 0 (neutral, neither rising nor sinking)
delta_T = D_m*0.5*(laplacian_gT + g*laplacian_T - T*laplacian_g) - m_inward*0.5*(laplacian_Tphi - phi*laplacian_T + T*laplacian_phi) + smoothstep(0.5, 0.9, phi)*heat*warmth - g*T_leak*T;
delta_gT = (g*T - gT)/timestep;
delta_Tphi = (T*phi - Tphi)/timestep;
// the environment: still, as painted
delta_warmth = 0.0;`,
  rest: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T' },
};

/**
 * Phase-field Bubbles 11 (lava lamp, swaying): version 9, with each bubble swaying gently side to side as it goes, as lava
 * lamp blobs do, so they rarely meet head-on and jam (version 10's steering couldn't get them past each other). Each carries
 * a slow oscillator (vx, vw), turning at sway_rate, held at unit size (a Stuart-Landau oscillator, so it neither dies out nor
 * grows) and spread through its inside, so the whole bubble sways together and cells it moves into take up its phase; its
 * sideways drift is vx. Bubbles start at their own phases (the scene's), so they sway out of step. Outside bubbles it fades.
 * (Room for it: the view-only membrane field is gone.) Measured: too slow to matter; below the speed at which a bubble
 * keeps its content, a sway moves it only a few cells each way (head-on: 12 cells apart sideways in 400k steps, still jammed).
 */export const PF_BUBBLES_11: RuleDef = {
  name: 'Phase-field Bubbles 11 (lava lamp, swaying)',
  description: 'A lava lamp of bubbles. Each carries heat T (one temperature per bubble) and is buoyant: warm ones rise, '
    + 'cool ones sink (buoy; gravity along gx, gy, y up: (0, −1) is down). Warmth (paintable) heats a bubble where it\'s positive and cools it '
    + 'where negative, and heat leaks away slowly (T_leak): with a heater at the bottom and a cooler at the top they '
    + 'circulate. Work in progress: rising bubbles deform into cups and leave faint trails. As in version 5: bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back; and the content\'s push out needs substrate too, so even crammed '
    + 'bubbles can\'t be pushed into each other: neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'T', 'gT', 'Tphi', 'warmth', 'vx', 'vw'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'leak', value: 0.002, min: 0, max: 0.05 },
    { name: 'sway', value: 0.01, min: 0, max: 0.05 },
    { name: 'sway_rate', value: 0.00013, min: 0, max: 0.002 },
    { name: 'D_sway', value: 0.2, min: 0, max: 0.24 },
    { name: 'move_max', value: 0.022, min: 0, max: 0.1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
    { name: 'u_supply', value: 0.3, min: 0.01, max: 1 },
    { name: 'buoy', value: 0.3, min: 0, max: 0.45 },
    { name: 'gx', value: 0, min: -1, max: 1 },
    { name: 'gy', value: -1, min: -1, max: 1 },
    { name: 'heat', value: 0.0003, min: 0, max: 0.005 },
    { name: 'T_leak', value: 0.00003, min: 0, max: 0.001 },
    { name: 'T_max', value: 1, min: 0.1, max: 4 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure (its excess over target), its push out scaled by the substrate there (u over
// u_supply, up to 1: no pushing into a depleted gap, however crammed), its pull in never held back; held back further
// where the substrate is short of a lone edge's share (between two bubbles, eaten from both sides); capped so the double
// well keeps two phases. Content pushes only where phi is already an edge (over 0.1): the little that seeps into phi's faint
// tail outside would otherwise grow specks there
float P = pressure*(m - target)*smoothstep(0.05, 0.15, phi);
// And buoyancy moves the edge: tilted out where it faces the way the bubble's going (warm: against gravity gx, gy, y up
// as the gradients, so (0, -1) is down; cool: with it), in where it faces away: the front grows, the back shrinks, so
// the bubble moves, its edge keeping its shape (carrying phi along instead rippled ahead of a sharp edge, and the well
// grew the ripples into droplets). Where it faces: grad phi points in, so -grad phi/|grad phi| is the outward normal.
float Tb = clamp(T, -T_max, T_max);
float gl = sqrt(x_gradient_phi*x_gradient_phi + y_gradient_phi*y_gradient_phi);
// (only on the edge proper, phi over 0.1: in its faint tail the direction is noise, and the push grew droplets there)
float facing = -(x_gradient_phi*(-gx) + y_gradient_phi*(-gy))/max(gl, 0.02)*smoothstep(0.05, 0.15, phi);
// Sway: the edge tilted out where it faces the way the bubble is swaying (its outward normal's x, times vx), in where
// it faces away; with buoyancy, capped at move_max (faster, a bubble leaves its content behind)
float nx = -x_gradient_phi/max(gl, 0.02)*smoothstep(0.05, 0.15, phi);
float move = clamp(buoy*Tb*facing + sway*vx*nx, -move_max, move_max);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0) + move, -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
// (never fully shut: leak lets content seep through the open lamp, very slowly)
delta_g = (max(smoothstep(0.02, 0.5, phi), leak) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the sway: an oscillator turning at sway_rate, held at unit size inside a bubble, spread through it (so the whole bubble
// sways together, and cells it moves into take up its phase); outside, it fades
float r2 = vx*vx + vw*vw;
delta_vx = g*(D_sway*laplacian_vx - sway_rate*vw + 0.002*(1.0 - r2)*vx) - (1.0 - g)*0.01*vx;
delta_vw = g*(D_sway*laplacian_vw + sway_rate*vx + 0.002*(1.0 - r2)*vw) - (1.0 - g)*0.01*vw;
// heat: spread inside and pulled in at a retreating edge, as content; heated or cooled by the warmth on the bubble's solid
// inside only (phi over a half; out in the edge's tail, where heat mixes slowest, it overheated cells that budded off as
// dots), leaking slowly toward 0 (neutral, neither rising nor sinking)
delta_T = D_m*0.5*(laplacian_gT + g*laplacian_T - T*laplacian_g) - m_inward*0.5*(laplacian_Tphi - phi*laplacian_T + T*laplacian_phi) + smoothstep(0.5, 0.9, phi)*heat*warmth - g*T_leak*T;
delta_gT = (g*T - gT)/timestep;
delta_Tphi = (T*phi - Tphi)/timestep;
// the environment: still, as painted
delta_warmth = 0.0;`,
  rest: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null, null, null, null, 1, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T' },
};

/**
 * Phase-field Bubbles 12 (lava lamp, swirling): version 9, with the bubbles carried by a gentle swirling flow as well as
 * buoyancy, so they wander and slip round each other rather than meeting head-on and jamming (version 10's steering
 * couldn't get them past, and version 11's sway was too slow to matter). The flow is curl noise: the curl of a stream
 * function psi, (dpsi/dy, -dpsi/dx), which only swirls (nothing piles up or thins out), set by the scene and paintable.
 * psi slides slowly sideways (psi_drift), so the swirls change as it goes. A bubble is carried by tilting its edge out
 * where it faces along the flow and in where it faces against it; with buoyancy, capped below the speed at which a bubble
 * leaves its content behind.
 */export const PF_BUBBLES_12: RuleDef = {
  name: 'Phase-field Bubbles 12 (lava lamp, swirling)',
  description: 'A lava lamp of bubbles. Each carries heat T (one temperature per bubble) and is buoyant: warm ones rise, '
    + 'cool ones sink (buoy; gravity along gx, gy, y up: (0, −1) is down). Warmth (paintable) heats a bubble where it\'s positive and cools it '
    + 'where negative, and heat leaks away slowly (T_leak): with a heater at the bottom and a cooler at the top they '
    + 'circulate. Work in progress: rising bubbles deform into cups and leave faint trails. As in version 5: bubbles as one phase field φ (1 inside, 0 outside), whose edges move by their own curvature (smoothing '
    + 'bulges rather than buckling) and by the pressure of the content m inside, so size follows content. As in Gray-Scott, '
    + 'bubbles eat a substrate u fed in from outside, and an edge needs substrate to advance: between two bubbles it\'s '
    + 'eaten from both sides, holding both edges back; and the content\'s push out needs substrate too, so even crammed '
    + 'bubbles can\'t be pushed into each other: neighbours keep a gap rather than merging, and a bubble cut in two '
    + '(Erase across it) stays two. Seed paints a bubble '
    + '(content 3). View mem (the membrane) tinted by m; u shows the substrate.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'mem', 'T', 'gT', 'Tphi', 'warmth', 'psi'],
  params: [
    { name: 'timestep', value: 1, min: 0, max: 1.2 },
    { name: 'D_phi', value: 0.1, min: 0, max: 0.24 },
    { name: 'well', value: 0.2, min: 0.005, max: 1 },
    { name: 'D_m', value: 0.2, min: 0, max: 0.24 },
    { name: 'm_inward', value: 0.2, min: 0, max: 1 },
    { name: 'leak', value: 0.002, min: 0, max: 0.05 },
    { name: 'swirl', value: 0.25, min: 0, max: 2 },
    { name: 'psi_drift', value: 0.0005, min: 0, max: 0.01 },
    { name: 'move_max', value: 0.022, min: 0, max: 0.1 },
    { name: 'pressure', value: 0.3, min: 0, max: 2 },
    { name: 'target', value: 1, min: 0.1, max: 4 },
    { name: 'D_u', value: 0.2, min: 0, max: 0.24 },
    { name: 'u_feed', value: 0.01, min: 0.001, max: 0.1 },
    { name: 'u_eat', value: 0.3, min: 0, max: 1 },
    { name: 'u_edge', value: 0.15, min: 0, max: 1 },
    { name: 'starve', value: 3, min: 0, max: 20 },
    { name: 'u_supply', value: 0.3, min: 0.01, max: 1 },
    { name: 'buoy', value: 0.3, min: 0, max: 0.45 },
    { name: 'gx', value: 0, min: -1, max: 1 },
    { name: 'gy', value: -1, min: -1, max: 1 },
    { name: 'heat', value: 0.0003, min: 0, max: 0.005 },
    { name: 'T_leak', value: 0.00003, min: 0, max: 0.001 },
    { name: 'T_max', value: 1, min: 0.1, max: 4 },
  ],
  paintable: [],
  formula: `// the drive at the edge: content pressure (its excess over target), its push out scaled by the substrate there (u over
// u_supply, up to 1: no pushing into a depleted gap, however crammed), its pull in never held back; held back further
// where the substrate is short of a lone edge's share (between two bubbles, eaten from both sides); capped so the double
// well keeps two phases. Content pushes only where phi is already an edge (over 0.1): the little that seeps into phi's faint
// tail outside would otherwise grow specks there
float P = pressure*(m - target)*smoothstep(0.05, 0.15, phi);
// And buoyancy moves the edge: tilted out where it faces the way the bubble's going (warm: against gravity gx, gy, y up
// as the gradients, so (0, -1) is down; cool: with it), in where it faces away: the front grows, the back shrinks, so
// the bubble moves, its edge keeping its shape (carrying phi along instead rippled ahead of a sharp edge, and the well
// grew the ripples into droplets). Where it faces: grad phi points in, so -grad phi/|grad phi| is the outward normal.
float Tb = clamp(T, -T_max, T_max);
float gl = sqrt(x_gradient_phi*x_gradient_phi + y_gradient_phi*y_gradient_phi);
// (only on the edge proper, phi over 0.1: in its faint tail the direction is noise, and the push grew droplets there)
float facing = -(x_gradient_phi*(-gx) + y_gradient_phi*(-gy))/max(gl, 0.02)*smoothstep(0.05, 0.15, phi);
// The swirl: the flow (dpsi/dy, -dpsi/dx), the edge tilted out where it faces along it (its outward normal
// -grad phi/|grad phi| dotted with the flow), in where it faces against it; on the edge proper only; with buoyancy, capped
// at move_max (faster, a bubble leaves its content behind)
float edge_on = smoothstep(0.05, 0.15, phi)/max(gl, 0.02);
float along = -(x_gradient_phi*y_gradient_psi - y_gradient_phi*x_gradient_psi)*edge_on;
float move = clamp(buoy*Tb*facing + swirl*along, -move_max, move_max);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0) + move, -0.45, 0.45);
// Allen-Cahn: diffusion and the double well (stable at 0 and 1) make an edge a few cells wide that moves by its curvature;
// lambda tilts the well, moving it out (lambda > 0) or in
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
// the substrate: fed toward 1, eaten inside bubbles, spreading
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content spreads inside, held in at the edge: div(g grad m), g a smooth step in phi (0 below 0.02: open a little into
// the edge's outer tail, so the inward pull below has diffusion to damp it there, else it rings into a checkerboard), as
// (lap(g m) + g lap m - m lap g)/2, which sums to zero over the grid; and drawn up phi's slope (flux m_inward m grad phi,
// as (lap(m phi) - phi lap m + m lap phi)/2, also summing to zero), so content at a retreating edge goes in with it
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
// (never fully shut: leak lets content seep through the open lamp, very slowly)
delta_g = (max(smoothstep(0.02, 0.5, phi), leak) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// the membrane, for the view: where phi crosses
delta_mem = (4.0*phi*(1.0 - phi) - mem)/timestep;
// heat: spread inside and pulled in at a retreating edge, as content; heated or cooled by the warmth on the bubble's solid
// inside only (phi over a half; out in the edge's tail, where heat mixes slowest, it overheated cells that budded off as
// dots), leaking slowly toward 0 (neutral, neither rising nor sinking)
delta_T = D_m*0.5*(laplacian_gT + g*laplacian_T - T*laplacian_g) - m_inward*0.5*(laplacian_Tphi - phi*laplacian_T + T*laplacian_phi) + smoothstep(0.5, 0.9, phi)*heat*warmth - g*T_leak*T;
delta_gT = (g*T - gT)/timestep;
delta_Tphi = (T*phi - Tphi)/timestep;
// the environment: still, as painted
delta_warmth = 0.0;
// the swirls' stream function, sliding slowly sideways (so the swirls change as it goes)
delta_psi = -psi_drift*x_gradient_psi;`,
  rest: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [{ chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } }],
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T' },
};

export const BUILTIN_RULES = [GRAY_SCOTT, GS_HISTORY_WAVE, GS_HW_MEMORY, PHYLLOTAXIS, OREGONATOR, KLEIN_GORDON, SWIFT_HOHENBERG_FB, NEURAL_FIELD, SATURABLE_NLS, GRAY_SCOTT_ZOOM, GS_FLECK, META_GS, WEATHER_GS, GS_LINEAGES, GS_SELECTION, GS_SPECIES, GS_NICHES, GS_HW_NICHES, GS_BUBBLES, PF_BUBBLES, PF_BUBBLES_1, PF_BUBBLES_3, PF_BUBBLES_4, PF_BUBBLES_5, PF_BUBBLES_6, PF_BUBBLES_7, PF_BUBBLES_8, PF_BUBBLES_9, PF_BUBBLES_10, PF_BUBBLES_11, PF_BUBBLES_12];

/** The Rules menu's families, in menu order (each built-in rule in one; scenes join their rule's family). */
export const RULE_FAMILIES: [string, RuleDef[]][] = [
  ['Gray-Scott', [GRAY_SCOTT, GRAY_SCOTT_ZOOM, GS_FLECK, GS_BUBBLES]],
  ['Bubbles', [PF_BUBBLES_1, PF_BUBBLES, PF_BUBBLES_3, PF_BUBBLES_4, PF_BUBBLES_5, PF_BUBBLES_6, PF_BUBBLES_7, PF_BUBBLES_8, PF_BUBBLES_9, PF_BUBBLES_10, PF_BUBBLES_11, PF_BUBBLES_12]],
  ['History + Wave', [GS_HISTORY_WAVE, GS_HW_MEMORY]],
  ['Parameters as fields', [META_GS, WEATHER_GS]],
  ['Heredity', [GS_LINEAGES, GS_SELECTION, GS_SPECIES, GS_NICHES, GS_HW_NICHES]],
  ['Waves & solitons', [SATURABLE_NLS, KLEIN_GORDON]],
  ['Other media', [OREGONATOR, NEURAL_FIELD, SWIFT_HOHENBERG_FB, PHYLLOTAXIS]],
];

export function defaultGlobals(rule: RuleDef): Record<string, number> {
  return Object.fromEntries(rule.params.map((p) => [p.name, p.value]));
}
