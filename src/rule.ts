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

/** Most reagents a rule may have: the brush, smooth and render shaders' per-reagent arrays hold this many (in vec4s of 4). */
export const MAX_REAGENTS = 32;
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

/** Tooltips for parameter names most rules share (Ready's patterns too), where a rule gives none of its own. */
export const PARAM_HINTS: Record<string, string> = {
  timestep: 'How far each step moves time on: higher runs faster, but too high and the sim blows up',
  dx: 'The grid spacing: smaller makes features more cells across (finer, and slower to evolve)',
  D_a: 'How fast a spreads (diffuses): higher makes bigger, softer features',
  D_b: 'How fast b spreads (diffuses): higher makes bigger, softer features',
  D_c: 'How fast c spreads (diffuses)',
  F: 'Feed rate: how fast fresh a flows in (and b drains away); with k it picks the pattern (spots, stripes, waves…)',
  k: 'Kill rate: how fast b dies off; with F it picks the pattern (spots, stripes, waves…)',
};

/** A parameter's tooltip: the rule's own hint, else the shared one, else its range. */
export function paramHint(rule: RuleDef, spec: ParamSpec): string {
  return rule.paramHints?.[spec.name] ?? PARAM_HINTS[spec.name] ?? `${spec.name} (${spec.min} to ${spec.max})`;
}

/** The value a wall distance field holds far from any wall (cells): "at least this far". */
export const FAR = 64;

export type Fill =
  | { type: 'constant'; value: number }
  | { type: 'white_noise'; low: number; high: number }
  /**
   * On a circle: value · ½(1 − tanh((d − r)/edge)), a flat top with a smooth rim `edge` cells wide (default 2). Elsewhere: value.
   * With wrap, distances wrap round the field's edges as the simulation does, so a bump near an edge carries on
   * across it rather than being cut off there.
   */
  | { type: 'bump'; value: number; edge?: number; wrap?: boolean }
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
  /** Tooltips for the parameters, by name: what each does here (shared names fall back to PARAM_HINTS). */
  paramHints?: Record<string, string>;
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
  view: { reagent: string; low: number; high: number; tint?: string; stepsPerFrame?: number; palette?: number; hueShape?: number; hueOffset?: number; fleckLow?: number; fleckHigh?: number; fleckGain?: number; custom?: CustomChannel[]; customContrast?: number; customSaturation?: number; customGamma?: number; customOff?: string[]; customAuto?: boolean; mode?: 'reagent' | 'params' | 'outlines' };
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
  /** The formula is a whole step (a map, as Ready kernel rules are), so it is never split into substeps at small feature sizes. */
  discrete?: boolean;
  /**
   * The reagents holding a momentum (x, y; y up, as the gradients) and, optionally, the mass it moves (velocity is
   * momentum over mass): the Push tool sets the momentum to mass × speed along a drag (right-drag brakes it to 0).
   */
  momentum?: { x: string; y: string; mass?: string; speed: number; /** a reagent holding the momentum's size, set with it */ size?: string };
  /**
   * A parameter (not paintable) setting how far the single neighbours (north_a …) reach: each becomes the mean of a
   * box of cells that far away, so a hand-written stencil acts on features that many times larger (1 = the cells next door).
   */
  reach?: string;
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


/**
 * Single neighbours (rdui's own, not Ready's), as they look on screen: north_a is a in the cell above, and so on, for
 * hand-written stencils (ports of Ready kernel rules). A wall neighbour reads as the cell itself, as in the others.
 */
const NEIGHBOURS: [string, number, number][] = [
  ['north', 0, -1], ['north_east', 1, -1], ['east', 1, 0], ['south_east', 1, 1],
  ['south', 0, 1], ['south_west', -1, 1], ['west', -1, 0], ['north_west', -1, -1],
];

/** Neighbourhood operators a formula can use on any reagent, as in Ready (plus the single neighbours). */
const STENCIL_OPS = ['laplacian', 'bilaplacian', 'x_gradient', 'y_gradient', 'gradient_mag_squared', ...NEIGHBOURS.map((n) => n[0])];

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
  ...NEIGHBOURS.map(([op, dx, dy]) => ({ op, v: `Q${op.split('_').map((w) => w[0].toUpperCase()).join('')}`, div: 1, dxPower: 0, points: [[dx, dy, 1]] as [number, number, number][] })),
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
  // with a reach, each single neighbour is the mean of a box of cells reach away (2·⌊reach/2⌋+1 wide), so the
  // stencil sees features reach times larger; one pass over the area adds each cell to every box it falls in
  const reachI = rule.reach ? rule.params.findIndex((p) => p.name === rule.reach) : -1;
  if (rule.reach && (reachI < 0 || rule.paintable.includes(rule.reach))) throw new RuleError(`reach '${rule.reach}' must be an unpainted parameter`);
  const wide = reachI >= 0 ? STENCILS.filter((st) => NEIGHBOURS.some((n) => n[0] === st.op) && needs(st.op).size) : [];
  if (wide.length) {
    const slots = [...new Set(wide.flatMap((st) => [...needs(st.op)]))];
    add(`  let rd_R = max(1, i32(round(g[${reachI >> 2}].${COMP[reachI & 3]}))); let rd_h = rd_R / 2; let rd_E = rd_R + rd_h;`);
    for (const st of wide) for (const k of slots) add(`  var ${st.v}${k} = vec4<f32>(0.0);`);
    add(`  for (var j = -rd_E; j <= rd_E; j++) { for (var i = -rd_E; i <= rd_E; i++) {`);
    add(`    let rn = cellIndex(x + i, y + j); let rw = isSealed(rn);`);
    for (const k of slots) add(`    let rv${k} = select(src[rn * ${S}u + ${k}u], s${k}, rw);`);
    for (const st of wide) {
      const [, dx, dy] = NEIGHBOURS.find((n) => n[0] === st.op)!;
      add(`    if (abs(i - ${dx} * rd_R) <= rd_h && abs(j - ${dy} * rd_R) <= rd_h) { ${slots.map((k) => `${st.v}${k} += rv${k};`).join(' ')} }`);
    }
    add(`  } }`);
    add(`  let rd_box = f32((2 * rd_h + 1) * (2 * rd_h + 1));`);
    for (const st of wide) for (const k of slots) add(`  ${st.v}${k} = ${st.v}${k} / rd_box;`);
  }
  for (const st of STENCILS) {
    const slots = needs(st.op);
    if (!slots.size || wide.includes(st)) continue;
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
    const wrap = bump && fill.type === 'bump' && fill.wrap;
    // (distances from the bump's middle, wrapping round the field's edges for a wrapping bump)
    const dist = (x: number, y: number) => {
      let dx = x + 0.5 - bump!.cx, dy = y + 0.5 - bump!.cy;
      if (wrap) { dx -= w * Math.round(dx / w); dy -= h * Math.round(dy / h); }
      return Math.hypot(dx, dy);
    };
    const cellsOf = wrap ? [...Array(w * h).keys()].filter((c) => dist(c % w, Math.floor(c / w)) <= bump!.r + 4 * bump!.e)
      : bump ? shapeCells({ ...sh, r: (bump.r + 4 * bump.e) / Math.max(w, h) } as Shape, w, h, salt) : shapeCells(sh, w, h, salt);
    for (const c of cellsOf) {
      const v =
        fill.type === 'constant' ? fill.value
        : fill.type === 'packet' ? packetValue(fill, pk, c % w, Math.floor(c / w))
        : fill.type === 'bump' ? (bump ? fill.value * 0.5 * (1 - Math.tanh((dist(c % w, Math.floor(c / w)) - bump.r) / bump.e)) : fill.value)
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
  paramHints: {
    D: 'Scales both diffusion rates here: paint lower to slow spreading in a region',
  },
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
  paramHints: {
    a_pow: 'Power on a in the reaction a^a_pow·b^b_pow: higher makes the reaction need more a',
    b_pow: 'Power on b in the reaction a^a_pow·b^b_pow (classic Gray-Scott is 2)',
    a_to_c: 'How much a adds to the history trail c each step',
    b_to_c: 'How much b adds to the history trail c each step: higher lays down trails faster',
    c_damp: 'How fast the history trail c fades: higher forgets sooner',
    D_c: 'How fast the history trail c spreads out to neighbours',
    c_pow: 'Power that reshapes c each step: above 1 pushes faint trail down, below 1 lifts it',
    c_pow_norm: 'Scale c is measured against when its power is applied: the level left unchanged by c_pow',
    c_clamp_min: 'Lowest value the history trail c is allowed to reach',
    c_clamp_max: 'Highest value the history trail c is allowed to reach',
    c_to_k: 'How much the history trail c adds to the kill rate k',
    c_to_F: 'How much the history trail c adds to the feed rate F (negative: trails starve the feed)',
    c_to_a: 'How much the history trail c adds straight to a each step',
    c_to_b: 'How much the history trail c adds straight to b each step',
    c_to_Da: 'How much the history trail c adds to a\'s diffusion rate',
    c_to_Db: 'How much the history trail c adds to b\'s diffusion rate',
    a_to_wave: 'How hard a pushes on the wave d each step',
    b_to_wave: 'How hard b pushes on the wave d each step: higher makes stronger wakes',
    c_to_wave: 'How hard the history trail c pushes on the wave d each step',
    wave_diffusion: 'How fast the wave spreads: higher makes faster, wider ripples',
    wave_damp: 'Wave height kept each step: 1 keeps it all, lower makes wakes die out sooner',
    wave_power: 'Power applied to the wave height each step: below 1 lifts small ripples and squashes big ones',
    wave_DC_value: 'Resting level of the wave d: the wave feeds back only by how far d sits from this',
    wave_clamp: 'Largest height the wave may reach either side of its resting level',
    wave_to_F: 'How much the wave height adds to the feed rate F',
    wave_to_k: 'How much the wave height adds to the kill rate k',
    wave_to_Da: 'How much the wave height adds to a\'s diffusion rate',
    wave_to_Db: 'How much the wave height adds to b\'s diffusion rate',
    wave_to_a: 'How much the wave height adds straight to a each step',
    wave_to_b: 'How much the wave height adds straight to b each step',
    wave_to_c: 'How much the wave height adds to the history trail c each step',
  },
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
  paramHints: {
    a_pow: 'Power on a in the reaction a^a_pow·b^b_pow: higher makes the reaction need more a',
    b_pow: 'Power on b in the reaction a^a_pow·b^b_pow (classic Gray-Scott is 2)',
    a_to_c: 'How much a adds to the history trail c each step',
    b_to_c: 'How much b adds to the history trail c each step: higher lays down trails faster',
    c_damp: 'How fast the history trail c fades: higher forgets sooner',
    D_c: 'How fast the history trail c spreads out to neighbours',
    c_pow: 'Power that reshapes c each step: above 1 pushes faint trail down, below 1 lifts it',
    c_pow_norm: 'Scale c is measured against when its power is applied: the level left unchanged by c_pow',
    c_clamp_min: 'Lowest value the history trail c is allowed to reach',
    c_clamp_max: 'Highest value the history trail c is allowed to reach',
    c_to_k: 'How much the history trail c adds to the kill rate k',
    c_to_F: 'How much the history trail c adds to the feed rate F (negative: trails starve the feed)',
    c_to_a: 'How much the history trail c adds straight to a each step',
    c_to_b: 'How much the history trail c adds straight to b each step',
    c_to_Da: 'How much the history trail c adds to a\'s diffusion rate',
    c_to_Db: 'How much the history trail c adds to b\'s diffusion rate',
    a_to_wave: 'How hard a pushes on the wave d each step',
    b_to_wave: 'How hard b pushes on the wave d each step: higher makes stronger wakes',
    c_to_wave: 'How hard the history trail c pushes on the wave d each step',
    wave_diffusion: 'How fast the wave spreads: higher makes faster, wider ripples',
    wave_damp: 'Wave height kept each step: 1 keeps it all, lower makes wakes die out sooner',
    wave_power: 'Power applied to the wave height each step: below 1 lifts small ripples and squashes big ones',
    wave_DC_value: 'Resting level of the wave d: the wave feeds back only by how far d sits from this',
    wave_clamp: 'Largest height the wave may reach either side of its resting level',
    wave_to_F: 'How much the wave height adds to the feed rate F',
    wave_to_k: 'How much the wave height adds to the kill rate k',
    wave_to_Da: 'How much the wave height adds to a\'s diffusion rate',
    wave_to_Db: 'How much the wave height adds to b\'s diffusion rate',
    wave_to_a: 'How much the wave height adds straight to a each step',
    wave_to_b: 'How much the wave height adds straight to b each step',
    wave_to_c: 'How much the wave height adds to the history trail c each step',
    cell: 'Compartment id to paint: memory m mixes within one id but can\'t cross into another',
    D_m: 'How fast memory m mixes within its compartment',
    m_gain: 'How strongly memory m snaps to 0 or 1: higher settles a compartment faster',
    m_theta: 'Tipping point for memory m: pushed past it, a compartment flips on, short of it falls back off',
    b_to_m: 'Paint to make b write memory: above 0 sets a compartment on, below 0 resets it',
  },
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
  paramHints: {
    mu: 'Growth drive: above 0 patterns grow from noise, higher makes them stronger',
    beta: 'Strength of the quadratic terms: higher favours spots (hexagons) over stripes',
  },
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
  paramHints: {
    eps: 'How much faster u reacts than v: lower makes sharper, quicker excitation fronts',
    f: 'How strongly the recovery variable v inhibits u: higher makes waves harder to start',
    q: 'Small offset in the inhibition term that sets u\'s resting floor',
    phi: 'Light level: higher inhibits more; near 0.084 broken waves travel as compact fragments',
    D_u: 'How fast u spreads: higher makes faster, wider waves',
    K_h: 'How much the light follows the excitation: higher dims a growing fragment back to size',
    tau_h: 'How slowly the size feedback h follows u: higher means a longer lag',
    kernel_sigma: 'Width of the area h averages u over: large means the whole field, small means local',
  },
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
  paramHints: {
    sg: 'Strength of the sine-Gordon pull towards multiples of 2π: higher makes stiffer, narrower kinks',
    phi4: 'Strength of the φ⁴ pull towards u = ±1: higher makes stiffer walls between them',
    mass: 'Pull of u back towards 0: positive makes a restoring force, negative pushes u away',
    gamma: 'Friction on motion: higher slows everything down; 0 loses no energy',
    nu: 'Damping of fine grid-scale ripples, barely touching smooth kinks and breathers',
  },
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
  paramHints: {
    r: 'Growth drive: above 0 patterns fill the field, slightly below 0 they stay as separate spots',
    b: 'Strength of the quadratic term: higher favours spots and lets them persist at lower r',
    kappa: 'How hard the inhibitor w pushes u down: higher can set spots moving',
    tau: 'How slowly the inhibitor w follows u: higher lags more and makes spots drift',
    D_w: 'How fast the inhibitor w spreads',
  },
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
  paramHints: {
    A: 'Overall coupling strength: higher makes activity excite its neighbours more',
    kernel_sigma: 'Reach of the nearby excitation: higher makes bigger bumps',
    kernel_b: 'Strength of the wider inhibition relative to excitation: higher keeps bumps more apart',
    kernel_sigma2: 'Reach of the wider inhibition around each bump',
    theta: 'Firing threshold: higher needs more input before a region turns on',
    beta: 'Sharpness of the firing switch: higher makes on/off more abrupt',
    g: 'How strongly tiredness a suppresses firing: higher makes bumps move or die out',
    tau: 'Response time of the firing rate u: higher reacts more slowly',
    tau_a: 'How slowly tiredness a builds up and wears off',
    I: 'Steady outside input: positive helps regions fire, negative holds them back',
  },
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
  paramHints: {
    g: 'Strength of self-focusing: higher pulls light into tighter solitons, negative spreads it',
    s: 'Saturation: higher caps the self-focusing at lower intensity, giving wider, softer solitons',
    gamma: 'Absorption: paint above 0 to soak up light, as at sponge borders',
    V: 'Potential to paint: low guides and traps solitons, high reflects them',
    reflect_d: 'Distance field of drawn reflecting walls (drawn with the Wall tool, not set by hand)',
    absorb_d: 'Distance field of drawn absorbing walls (drawn with the Wall tool, not set by hand)',
    wall_grow: 'Moves every drawn wall\'s edge out (positive) or in (negative) by this many cells',
    wall_V: 'Height of reflecting walls: higher bounces stronger solitons',
    wall_gamma: 'How strongly absorbing walls soak up light',
    trap_d: 'Distance field of drawn traps (drawn with the Wall tool, not set by hand)',
    trap_V: 'Depth of the well inside traps: deeper holds solitons more firmly',
    trap_D: 'Friction inside traps: higher slows and parks incoming solitons faster',
    trap_loss: 'Steady loss inside traps that kills faint ripples, so an empty trap stays empty',
    trap_gain: 'Gain inside traps that grows with intensity, feeding a parked soliton',
    trap_sat: 'Cap on trap gain at high intensity: higher settles trapped solitons at lower power',
  },
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
  paramHints: {
    heat_D1: 'Diffusion rate of a (before zoom scaling)',
    heat_D2: 'Diffusion rate of b (before zoom scaling)',
    zoom: 'Feature size: higher makes the same patterns larger and smoother, but slower to form',
  },
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
  paramHints: {
    D_c: 'How fast c spreads through the wide kernel',
    c_to_F: 'How much c changes the feed where it lies: negative lowers it',
    c_to_k: 'How much c changes the kill where it lies: positive raises it',
    c_to_Da: 'How much c speeds up a\'s spreading where it lies',
    c_to_Db: 'How much c speeds up b\'s spreading where it lies',
    c_damp: 'How fast c decays: higher forgets where b has been sooner',
    b_to_c: 'How fast b makes c: higher builds the trail of c quicker',
    lap_size: 'Radius of the wide smoothing kernel in cells: patterns scale with it',
    lap_gain: 'Strength of the wide kernel\'s diffusion: higher spreads all three faster',
    D_micro: 'Small ordinary diffusion on top that smooths away single-cell runaways (the flecks)',
  },
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
  paramHints: {
    F_gain: 'How far the dF field moves feed per unit of b: negative pushes it the other way',
    F_mem: 'Memory of the dF field in steps: higher averages over longer and changes slower',
    F_reach: 'How many cells the dF field spreads over its memory: high makes halos, low trails',
    F_diff: 'How much empty space (1 - a - b) adds to b as the dF field\'s source',
    k_gain: 'How far the dk field moves kill per unit of b: negative pushes it the other way',
    k_mem: 'Memory of the dk field in steps: higher averages over longer and changes slower',
    k_reach: 'How many cells the dk field spreads over its memory: high makes halos, low trails',
    k_diff: 'How much empty space (1 - a - b) adds to b as the dk field\'s source',
    Da_gain: 'How far the dDa field moves a\'s diffusion per unit of b: negative pushes it the other way',
    Da_mem: 'Memory of the dDa field in steps: higher averages over longer and changes slower',
    Da_reach: 'How many cells the dDa field spreads over its memory: high makes halos, low trails',
    Da_diff: 'How much empty space (1 - a - b) adds to b as the dDa field\'s source',
    Db_gain: 'How far the dDb field moves b\'s diffusion per unit of b: negative pushes it the other way',
    Db_mem: 'Memory of the dDb field in steps: higher averages over longer and changes slower',
    Db_reach: 'How many cells the dDb field spreads over its memory: high makes halos, low trails',
    Db_diff: 'How much empty space (1 - a - b) adds to b as the dDb field\'s source',
    F_forget: 'Makes the extra feed drain faster the smaller it is, giving boom-and-bust; 0 lets it die out',
    F_ref: 'Size of dF at which the F_forget drain stops: smaller dF than this drains away',
  },
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
  paramHints: {
    F_gain: 'How far the uF field shifts feed: negative pushes it the other way',
    F_mem: 'Memory of the uF field in steps: higher changes slower',
    F_reach: 'How many cells the uF field spreads over its memory',
    F_diff: 'How much empty space (1 - a - b) adds to b as the uF field\'s source',
    k_gain: 'How far the uk field shifts kill: negative pushes it the other way',
    k_mem: 'Memory of the uk field in steps: higher changes slower',
    k_reach: 'How many cells the uk field spreads over its memory',
    k_diff: 'How much empty space (1 - a - b) adds to b as the uk field\'s source',
    Da_gain: 'How far the uDa field shifts a\'s diffusion: negative pushes it the other way',
    Da_mem: 'Memory of the uDa field in steps: higher changes slower',
    Da_reach: 'How many cells the uDa field spreads over its memory',
    Da_diff: 'How much empty space (1 - a - b) adds to b as the uDa field\'s source',
    Db_gain: 'How far the uDb field shifts b\'s diffusion: negative pushes it the other way',
    Db_mem: 'Memory of the uDb field in steps: higher changes slower',
    Db_reach: 'How many cells the uDb field spreads over its memory',
    Db_diff: 'How much empty space (1 - a - b) adds to b as the uDb field\'s source',
    F_to_F: 'How much the uF field excites itself: above 1 it can flip and hold on or off; negative calms it',
    k_to_F: 'How much the uk field drives the uF field: positive excites, negative inhibits',
    Da_to_F: 'How much the uDa field drives the uF field: positive excites, negative inhibits',
    Db_to_F: 'How much the uDb field drives the uF field: positive excites, negative inhibits',
    F_to_k: 'How much the uF field drives the uk field: positive excites, negative inhibits',
    k_to_k: 'How much the uk field excites itself: above 1 it can flip and hold on or off; negative calms it',
    Da_to_k: 'How much the uDa field drives the uk field: positive excites, negative inhibits',
    Db_to_k: 'How much the uDb field drives the uk field: positive excites, negative inhibits',
    F_to_Da: 'How much the uF field drives the uDa field: positive excites, negative inhibits',
    k_to_Da: 'How much the uk field drives the uDa field: positive excites, negative inhibits',
    Da_to_Da: 'How much the uDa field excites itself: above 1 it can flip and hold on or off; negative calms it',
    Db_to_Da: 'How much the uDb field drives the uDa field: positive excites, negative inhibits',
    F_to_Db: 'How much the uF field drives the uDb field: positive excites, negative inhibits',
    k_to_Db: 'How much the uk field drives the uDb field: positive excites, negative inhibits',
    Da_to_Db: 'How much the uDa field drives the uDb field: positive excites, negative inhibits',
    Db_to_Db: 'How much the uDb field excites itself: above 1 it can flip and hold on or off; negative calms it',
  },
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
  paramHints: {
    F: 'Feed carried by brush seeds and the opening spots, so new lineages founded here take it on',
    k: 'Kill carried by brush seeds and the opening spots, so new lineages founded here take it on',
    trait_eps: 'Small stand-in amount of b so feed and kill fall back to the painted values where there is no b',
    seed_bank: 'How much of the painted feed and kill mixes into every new b: 0 is pure inheritance',
  },
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
  paramHints: {
    F: 'Feed carried by brush seeds and the opening spots, so new lineages founded here take it on',
    k: 'Kill carried by brush seeds and the opening spots, so new lineages founded here take it on',
    trait_eps: 'Small stand-in amount of b so feed and kill fall back to the painted values where there is no b',
    seed_bank: 'How much of the painted feed and kill mixes into every new b: 0 is pure inheritance',
  },
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
  paramHints: {
    F: 'Feed for a where there is no b (where there is b, the species\' own feeds take over)',
    F1: 'Feed of species 1 (by default spots): its b\'s death includes it, and a is fed at it where species 1 is',
    k1: 'Kill of species 1 (by default spots): higher makes species 1 die faster',
    F2: 'Feed of species 2 (by default worms): its b\'s death includes it, and a is fed at it where species 2 is',
    k2: 'Kill of species 2 (by default worms): higher makes species 2 die faster',
    F3: 'Feed of species 3 (by default maze): its b\'s death includes it, and a is fed at it where species 3 is',
    k3: 'Kill of species 3 (by default maze): higher makes species 3 die faster',
    F4: 'Feed of species 4 (by default curly): its b\'s death includes it, and a is fed at it where species 4 is',
    k4: 'Kill of species 4 (by default curly): higher makes species 4 die faster',
    cross: 'How readily two different species reproduce together: 0 only with their own kind, 1 as plain Gray-Scott',
    eps: 'Small stand-in amount of b so a\'s feed falls back to the painted F where there is no b',
  },
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
  paramHints: {
    F1: 'Feed of species 1 (by default spots): refills its own food a1 and adds to its death rate',
    k1: 'Kill of species 1 (by default spots): higher makes species 1 die faster',
    F2: 'Feed of species 2 (by default worms): refills its own food a2 and adds to its death rate',
    k2: 'Kill of species 2 (by default worms): higher makes species 2 die faster',
    F3: 'Feed of species 3 (by default maze): refills its own food a3 and adds to its death rate',
    k3: 'Kill of species 3 (by default maze): higher makes species 3 die faster',
    F4: 'Feed of species 4 (by default curly): refills its own food a4 and adds to its death rate',
    k4: 'Kill of species 4 (by default curly): higher makes species 4 die faster',
    interfere: 'How much overlapping species raise each other\'s death rate: higher keeps them apart',
    interfere1: 'How hard species 1 hits the others where they overlap: below 1 a strong grower can share',
    interfere2: 'How hard species 2 hits the others where they overlap: below 1 a strong grower can share',
    interfere3: 'How hard species 3 hits the others where they overlap: below 1 a strong grower can share',
    interfere4: 'How hard species 4 hits the others where they overlap: below 1 a strong grower can share',
    territory: 'How much each species\' food dip raises the others\' death rate, so a sparse pattern can hold its ground',
  },
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
  paramHints: {
    F1: 'Feed of species 1: refills its own food a1 and adds to its death rate',
    k1: 'Kill of species 1: higher makes species 1 die faster',
    F2: 'Feed of species 2: refills its own food a2 and adds to its death rate',
    k2: 'Kill of species 2: higher makes species 2 die faster',
    F3: 'Feed of species 3: refills its own food a3 and adds to its death rate',
    k3: 'Kill of species 3: higher makes species 3 die faster',
    F4: 'Feed of species 4: refills its own food a4 and adds to its death rate',
    k4: 'Kill of species 4: higher makes species 4 die faster',
    interfere: 'How much overlapping species raise each other\'s death rate: higher keeps them apart',
    interfere1: 'How hard species 1 hits the others where they overlap: below 1 a strong grower can share',
    interfere2: 'How hard species 2 hits the others where they overlap: below 1 a strong grower can share',
    interfere3: 'How hard species 3 hits the others where they overlap: below 1 a strong grower can share',
    interfere4: 'How hard species 4 hits the others where they overlap: below 1 a strong grower can share',
    history1: 'How much the history c shifts species 1\'s feed and kill: above 1 its own trails hold it back',
    history2: 'How much the history c shifts species 2\'s feed and kill: above 1 its own trails hold it back',
    history3: 'How much the history c shifts species 3\'s feed and kill: above 1 its own trails hold it back',
    history4: 'How much the history c shifts species 4\'s feed and kill: above 1 its own trails hold it back',
    wave1: 'How much the wave shifts species 1\'s feed, kill, diffusion and b: below 1 it keeps nearer its own',
    wave2: 'How much the wave shifts species 2\'s feed, kill, diffusion and b: below 1 it keeps nearer its own',
    wave3: 'How much the wave shifts species 3\'s feed, kill, diffusion and b: below 1 it keeps nearer its own',
    wave4: 'How much the wave shifts species 4\'s feed, kill, diffusion and b: below 1 it keeps nearer its own',
    b_to_c: 'How fast all species\' b lays down the history c',
    c_damp: 'How fast the history c fades: higher forgets sooner',
    D_c: 'How fast the history c spreads',
    c_to_k: 'How much the history c shifts every species\' kill (times history1..4)',
    c_to_F: 'How much the history c shifts every species\' feed (times history1..4): negative lowers it',
    b_to_wave: 'How hard all species\' b rings the wave',
    wave_diffusion: 'How fast the wave travels outwards',
    wave_damp: 'How much of the wave survives each step: lower dies away sooner',
    wave_power: 'Power the wave\'s height is raised to each step: below 1 big waves shrink faster',
    wave_DC_value: 'The wave\'s resting level: species feel only how far it is above or below this',
    wave_clamp: 'Largest the wave can swing away from its resting level',
    wave_to_F: 'How much the wave shifts every species\' feed (times wave1..4)',
    wave_to_k: 'How much the wave shifts every species\' kill (times wave1..4): negative lowers it on crests',
    wave_to_Da: 'How much the wave changes the foods\' diffusion (times wave1..4)',
    wave_to_Db: 'How much the wave changes the species\' diffusion (times wave1..4)',
    wave_to_b: 'How much the wave adds b directly, shared by species (times wave1..4): negative removes it on crests',
  },
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
  paramHints: {
    D_a: 'How fast the feed chemical a spreads',
    D_b: 'How fast the membrane chemical b spreads',
    D_m: 'How fast content spreads inside a bubble',
    F: 'Gray-Scott feed rate, refilling a; shapes the membrane ring',
    k_edge: 'Gray-Scott kill rate for the membrane; set near the edge where rings stop growing',
    chi: 'How fast content pressure carries the membrane out (or in, once content is diluted)',
    soft: 'Caps the pressure, so the membrane can\'t be pushed faster than it follows',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    seal: 'How leaky the membrane is to content; raise it to let content seep through',
  },
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content spreads inside a bubble',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    repel: 'How hard bubbles of different kinds push each other back where they overlap',
  },
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content spreads inside a bubble',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_h: 'How far the blur h, used to spot gaps between bubbles, spreads',
    h_decay: 'How fast the blur h follows phi; lower makes it spread wider and respond slower',
    repel: 'How hard a narrow gap between two bubbles pushes both edges back',
    gap_margin: 'How far h must sit above phi before a gap pushes back; raise it to act only in tighter gaps',
  },
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content spreads inside a bubble',
    m_inward: 'How strongly content is drawn in with a retreating edge, so a shrinking bubble keeps it',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_h: 'How far the blur h, used to spot gaps between bubbles, spreads',
    h_decay: 'How fast the blur h follows phi; lower makes it spread wider and respond slower',
    drain: 'How fast a narrow gap between facing edges is emptied, keeping islands apart',
    gap_margin: 'How far h must sit above a half before a gap is drained; raise it to drain only tighter gaps',
  },
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content spreads inside a bubble',
    m_inward: 'How strongly content is drawn in with a retreating edge, so a shrinking bubble keeps it',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
  },
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
 */
export const PF_BUBBLES_5: RuleDef = {
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content spreads inside a bubble',
    m_inward: 'How strongly content is drawn in with a retreating edge, so a shrinking bubble keeps it',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
  },
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and heat spread inside a bubble',
    m_inward: 'How strongly content and heat are drawn in with a retreating edge, so a shrinking bubble keeps them',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    buoy: 'How strongly warm bubbles rise and cool ones sink',
    gx: 'Sideways part of gravity\'s direction',
    gy: 'Up-down part of gravity\'s direction; -1 is down',
    heat: 'How fast painted warmth heats a bubble (or cools it, where warmth is negative)',
    T_leak: 'How fast a bubble\'s heat fades back toward neutral',
    T_max: 'Caps the temperature that drives buoyancy, so hotter bubbles don\'t move faster',
  },
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
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T', customOff: ['Tphi', 'warmth'] },
};

/**
 * Phase-field Bubbles 7 (lava lamp, even heating): version 6, with the warmth heating or cooling only a bubble's solid inside
 * (φ over a half), its heat spreading out to the edge from there. In version 6 it acted out into the edge's faint tail too,
 * where heat mixes slowest: tail cells overheated (or overcooled), were pushed hardest, and budded off as dots.
 */
export const PF_BUBBLES_7: RuleDef = {
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and heat spread inside a bubble',
    m_inward: 'How strongly content and heat are drawn in with a retreating edge, so a shrinking bubble keeps them',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    buoy: 'How strongly warm bubbles rise and cool ones sink',
    gx: 'Sideways part of gravity\'s direction',
    gy: 'Up-down part of gravity\'s direction; -1 is down',
    heat: 'How fast painted warmth heats a bubble (or cools it, where warmth is negative)',
    T_leak: 'How fast a bubble\'s heat fades back toward neutral',
    T_max: 'Caps the temperature that drives buoyancy, so hotter bubbles don\'t move faster',
  },
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
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T', customOff: ['Tphi', 'warmth'] },
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and heat spread inside a bubble',
    m_inward: 'How strongly content and heat are drawn in with a retreating edge, so a shrinking bubble keeps them',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    buoy: 'How strongly warm bubbles rise and cool ones sink',
    gx: 'Sideways part of gravity\'s direction',
    gy: 'Up-down part of gravity\'s direction; -1 is down',
    heat: 'How fast painted warmth heats a bubble (or cools it, where warmth is negative)',
    T_leak: 'How fast a bubble\'s heat fades back toward neutral',
    T_max: 'Caps the temperature that drives buoyancy, so hotter bubbles don\'t move faster',
  },
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
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T', customOff: ['Tphi', 'warmth'] },
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
 */
export const PF_BUBBLES_9: RuleDef = {
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and heat spread inside a bubble',
    m_inward: 'How strongly content and heat are drawn in with a retreating edge, so a shrinking bubble keeps them',
    leak: 'How much content seeps through the open lamp; lets small bubbles slowly lose content to big ones',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    buoy: 'How strongly warm bubbles rise and cool ones sink',
    gx: 'Sideways part of gravity\'s direction',
    gy: 'Up-down part of gravity\'s direction; -1 is down',
    heat: 'How fast painted warmth heats a bubble (or cools it, where warmth is negative)',
    T_leak: 'How fast a bubble\'s heat fades back toward neutral',
    T_max: 'Caps the temperature that drives buoyancy, so hotter bubbles don\'t move faster',
  },
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
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T', customOff: ['Tphi', 'warmth'] },
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
 */
export const PF_BUBBLES_10: RuleDef = {
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and heat spread inside a bubble',
    m_inward: 'How strongly content and heat are drawn in with a retreating edge, so a shrinking bubble keeps them',
    leak: 'How much content seeps through the open lamp; lets small bubbles slowly lose content to big ones',
    steer: 'How strongly edges move toward open space and back from nearby bubbles',
    move_max: 'Top speed for an edge moved by buoyancy and steering; faster leaves a bubble\'s content behind',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    buoy: 'How strongly warm bubbles rise and cool ones sink',
    gx: 'Sideways part of gravity\'s direction',
    gy: 'Up-down part of gravity\'s direction; -1 is down',
    heat: 'How fast painted warmth heats a bubble (or cools it, where warmth is negative)',
    T_leak: 'How fast a bubble\'s heat fades back toward neutral',
    T_max: 'Caps the temperature that drives buoyancy, so hotter bubbles don\'t move faster',
  },
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
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T', customOff: ['Tphi', 'warmth'] },
};

/**
 * Phase-field Bubbles 11 (lava lamp, swaying): version 9, with each bubble swaying gently side to side as it goes, as lava
 * lamp blobs do, so they rarely meet head-on and jam (version 10's steering couldn't get them past each other). Each carries
 * a slow oscillator (vx, vw), turning at sway_rate, held at unit size (a Stuart-Landau oscillator, so it neither dies out nor
 * grows) and spread through its inside, so the whole bubble sways together and cells it moves into take up its phase; its
 * sideways drift is vx. Bubbles start at their own phases (the scene's), so they sway out of step. Outside bubbles it fades.
 * (Room for it: the view-only membrane field is gone.) Measured: too slow to matter; below the speed at which a bubble
 * keeps its content, a sway moves it only a few cells each way (head-on: 12 cells apart sideways in 400k steps, still jammed).
 */
export const PF_BUBBLES_11: RuleDef = {
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and heat spread inside a bubble',
    m_inward: 'How strongly content and heat are drawn in with a retreating edge, so a shrinking bubble keeps them',
    leak: 'How much content seeps through the open lamp; lets small bubbles slowly lose content to big ones',
    sway: 'How strongly each bubble sways side to side as it goes',
    sway_rate: 'How fast each bubble\'s sway swings back and forth',
    D_sway: 'How evenly the sway spreads through a bubble, so it sways as one',
    move_max: 'Top speed for an edge moved by buoyancy and sway; faster leaves a bubble\'s content behind',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    buoy: 'How strongly warm bubbles rise and cool ones sink',
    gx: 'Sideways part of gravity\'s direction',
    gy: 'Up-down part of gravity\'s direction; -1 is down',
    heat: 'How fast painted warmth heats a bubble (or cools it, where warmth is negative)',
    T_leak: 'How fast a bubble\'s heat fades back toward neutral',
    T_max: 'Caps the temperature that drives buoyancy, so hotter bubbles don\'t move faster',
  },
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
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T', customOff: ['Tphi', 'warmth', 'vx', 'vw'] },
};

/**
 * Phase-field Bubbles 12 (lava lamp, swirling): version 9, with the bubbles carried by a gentle swirling flow as well as
 * buoyancy, so they wander and slip round each other rather than meeting head-on and jamming (version 10's steering
 * couldn't get them past, and version 11's sway was too slow to matter). The flow is curl noise: the curl of a stream
 * function psi, (dpsi/dy, -dpsi/dx), which only swirls (nothing piles up or thins out), set by the scene and paintable.
 * psi slides slowly sideways (psi_drift), so the swirls change as it goes. A bubble is carried by tilting its edge out
 * where it faces along the flow and in where it faces against it; with buoyancy, capped below the speed at which a bubble
 * leaves its content behind.
 */
export const PF_BUBBLES_12: RuleDef = {
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and heat spread inside a bubble',
    m_inward: 'How strongly content and heat are drawn in with a retreating edge, so a shrinking bubble keeps them',
    leak: 'How much content seeps through the open lamp; lets small bubbles slowly lose content to big ones',
    swirl: 'How strongly the swirling flow carries bubbles along',
    psi_drift: 'How fast the swirl pattern slides sideways, so the swirls change over time',
    move_max: 'Top speed for an edge moved by buoyancy and swirl; faster leaves a bubble\'s content behind',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    buoy: 'How strongly warm bubbles rise and cool ones sink',
    gx: 'Sideways part of gravity\'s direction',
    gy: 'Up-down part of gravity\'s direction; -1 is down',
    heat: 'How fast painted warmth heats a bubble (or cools it, where warmth is negative)',
    T_leak: 'How fast a bubble\'s heat fades back toward neutral',
    T_max: 'Caps the temperature that drives buoyancy, so hotter bubbles don\'t move faster',
  },
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
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T', customOff: ['Tphi', 'warmth', 'psi'] },
};

/**
 * Phase-field Bubbles 13 (lava lamp, swirling, dots warm too): version 12, with the warmth heating or cooling wherever there's
 * bubble (φ over 0.1), as in version 6. Since version 7 it acted only on a bubble's solid inside (φ over a half, fully from
 * 0.9), which small soft dots barely have, so they kept whatever temperature they budded off with: hot dots stuck at the
 * top, cold ones at the bottom.
 */
export const PF_BUBBLES_13: RuleDef = {
  name: 'Phase-field Bubbles 13 (lava lamp, swirling, dots warm too)',
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
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and heat spread inside a bubble',
    m_inward: 'How strongly content and heat are drawn in with a retreating edge, so a shrinking bubble keeps them',
    leak: 'How much content seeps through the open lamp; lets small bubbles slowly lose content to big ones',
    swirl: 'How strongly the swirling flow carries bubbles along',
    psi_drift: 'How fast the swirl pattern slides sideways, so the swirls change over time',
    move_max: 'Top speed for an edge moved by buoyancy and swirl; faster leaves a bubble\'s content behind',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    buoy: 'How strongly warm bubbles rise and cool ones sink',
    gx: 'Sideways part of gravity\'s direction',
    gy: 'Up-down part of gravity\'s direction; -1 is down',
    heat: 'How fast painted warmth heats a bubble (or cools it, where warmth is negative)',
    T_leak: 'How fast a bubble\'s heat fades back toward neutral',
    T_max: 'Caps the temperature that drives buoyancy, so hotter bubbles don\'t move faster',
  },
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
// heat: spread inside and pulled in at a retreating edge, as content; heated or cooled by the warmth wherever there's
// bubble (phi over 0.1: dots too, which a solid-inside-only rule passed by), leaking slowly toward 0 (neutral)
delta_T = D_m*0.5*(laplacian_gT + g*laplacian_T - T*laplacian_g) - m_inward*0.5*(laplacian_Tphi - phi*laplacian_T + T*laplacian_phi) + smoothstep(0.05, 0.15, phi)*heat*warmth - g*T_leak*T;
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
  view: { reagent: 'phi', low: 0, high: 1, tint: 'T', customOff: ['Tphi', 'warmth', 'psi'] },
};

/**
 * Dan's Smoke (Ready, Patterns/Smoke, rule "Flux-Curl"): an OpenCL kernel rule, ported by hand with the single-neighbour
 * operators. (a, b) is a vector field; each step it grows a little (amp), spreads a along x and b along y (ws), is pushed
 * by the Laplacian of c, and is turned by an angle set by its own curl, cs·sign(curl)·|curl|^sp. c is minus its
 * divergence; d is only for viewing (Ready's names: the kernel calls c p and d c). Ready's y axis points up, so its north is rdui's south (and so on): the stencils
 * are mirrored to match, so a pattern runs as it did there. smoothMonoid is the later version: the Laplacian push
 * follows the vector's direction (cos θ, sin θ) instead of the signs of a and b, and a and b are clamped to ±1.
 */
const smokeFormula = (smooth: boolean) => `// Ready's kernel, with its north/south swapped for rdui's y-down screen
float s2 = 0.70710678;
float curl = south_a - north_a - east_b + west_b + s2*(south_west_a + south_west_b) + s2*(south_east_a - south_east_b)
  + s2*(north_west_b - north_west_a) - s2*(north_east_b + north_east_a);
float turn = cs*sign(curl)*pow(fabs(curl), sp);
float wds = 2.0 + 4.0*s2;
float wa = west_a + east_a + s2*(north_west_a + north_east_a + south_east_a + south_west_a) - wds*a;
float wb = north_b + south_b + s2*(north_west_b + north_east_b + south_east_b + south_west_b) - wds*b;
float lap_c = (4.0*(north_c + south_c + east_c + west_c) + north_east_c + north_west_c + south_east_c + south_west_c - 20.0*c)/6.0;
float c2 = north_b - south_b - east_a + west_a + s2*(south_west_a - south_west_b) - s2*(south_east_a + south_east_b)
  + s2*(north_west_a + north_west_b) + s2*(north_east_b - north_east_a);
${smooth
    ? `float mag = sqrt(a*a + b*b);
float th = atan2(b, a);
float ta = amp*a + ws*wa - lps*cos(th)*lap_c + lps2*mag*cos(th)*c2;
float tb = amp*b + ws*wb - lps*sin(th)*lap_c + lps2*mag*sin(th)*c2;`
    : `float ta = amp*a + ws*wa - lps*sign(a)*lap_c + lps2*a*c2;
float tb = amp*b + ws*wb - lps*sign(b)*lap_c + lps2*b*c2;`}
float a2 = ta*cos(turn) - tb*sin(turn);
float b2 = ta*sin(turn) + tb*cos(turn);
${smooth ? `a2 = clamp(a2, -1.0, 1.0);
b2 = clamp(b2, -1.0, 1.0);
` : ''}float d2 = d_gain*(west_a + east_a + north_b + south_b + 2.0*s2*(north_west_a + north_west_b + south_east_a + south_east_b));
delta_a = (a2 - a)/timestep;
delta_b = (b2 - b)/timestep;
delta_c = (c2 - c)/timestep;
delta_d = (d2 - d)/timestep;`;

const SMOKE_HINTS: Record<string, string> = {
  cs: 'How hard the vector field turns where it curls: higher swirls more tightly',
  ws: 'How fast a spreads along x and b along y: higher smooths the smoke more',
  amp: 'Growth per step: above 1 the field strengthens until the turning and spreading hold it',
  sp: 'Power on the curl in the turning angle: low turns almost evenly wherever there is curl, high only where it is strong',
  lps: 'How hard the field is pushed by the Laplacian of c (its divergence): higher makes sharper ridges',
  lps2: 'How much the field grows (or, negative, shrinks) where it converges',
  d_gain: 'Scale of d, the viewing channel (it doesn\'t act back): the smoke fades to tiny values, so it is shown magnified',
};

export const SMOKE: RuleDef = {
  name: 'Smoke (Flux-Curl)',
  description:
    'Dan\'s Smoke from Ready (a kernel rule, ported): a vector field (a, b) that grows a little each step, spreads a along x and b '
    + 'along y, is pushed by the Laplacian of its divergence c, and turns by an angle set by its own curl. Swirls of smoke roll up '
    + 'and wind round each other. Exact to the Ready kernel (Ready\'s y up, mirrored for rdui), not scaled by cell size.',
  reagents: ['a', 'b', 'c', 'd'],
  params: [
    { name: 'cs', value: 0.256, min: 0, max: 1 },
    { name: 'ws', value: 0.128, min: 0, max: 0.2 },
    { name: 'amp', value: 1.001, min: 0.99, max: 1.01 },
    { name: 'sp', value: 0.2, min: 0, max: 2 },
    { name: 'lps', value: 0.04, min: 0, max: 0.1 },
    { name: 'lps2', value: -0.01, min: -0.1, max: 0.1 },
    { name: 'd_gain', value: 1e6, min: 0, max: 1e7 },
  ],
  paramHints: SMOKE_HINTS,
  paintable: ['cs', 'amp'],
  discrete: true,
  formula: smokeFormula(false),
  size: { width: 1024, height: 512 },
  rest: [0, 0, 0, 0],
  seed: [1, 1, null, null],
  seedNoise: [0, 0, 0, 0],
  initial: (['a', 'b'] as const).map((chem): Overlay => ({ chem, op: 'overwrite', fill: { type: 'white_noise', low: -1, high: 1 }, shape: { type: 'everywhere' } })),
  // as Ready showed it (its d): the smoke settles at a ~ 1e-7, magnified by d_gain; the custom palette's ranges follow it (auto)
  view: { reagent: 'd', low: -1.5, high: 4, stepsPerFrame: 3, customAuto: true },
};

export const SMOKE_SMOOTH: RuleDef = {
  ...SMOKE,
  name: 'Smoke (smooth monoid)',
  description:
    'Dan\'s later Smoke from Ready (smoke-smooth_monoid, ported): as Flux-Curl, but the push from the Laplacian of c follows the '
    + 'vector\'s direction rather than the signs of a and b, so it has no favoured axes, and a and b are clamped to ±1.',
  params: SMOKE.params.map((p) => p.name === 'lps' ? { ...p, value: 0.034 } : p.name === 'lps2' ? { ...p, value: -0.08 } : p),
  formula: smokeFormula(true),
  view: { reagent: 'd', low: -300, high: 300, stepsPerFrame: 3, customAuto: true },
};

export const SMOKE_WIDE: RuleDef = {
  ...SMOKE,
  name: 'Smoke (wide)',
  description:
    'Smoke (Flux-Curl) on a wider neighbourhood: each of the kernel\'s eight neighbours is the mean of a box of cells reach '
    + 'away, so the smoke\'s features come out about reach times larger. The cell\'s own value is still its own, so the finest '
    + 'grain is damped as before. At reach 1 it is the original rule exactly.',
  params: [...SMOKE.params, { name: 'reach', value: 4, min: 1, max: 12 }],
  paramHints: { ...SMOKE_HINTS, reach: 'How far the neighbours reach, in cells (each the mean of a box about that wide): features grow about in proportion; 1 is the original' },
  reach: 'reach',
  view: { reagent: 'd', low: -4, high: 4, stepsPerFrame: 3, customAuto: true },
};

/**
 * Smoke stirring Gray-Scott (a hybrid, Dan's idea): the Smoke kernel (a, b, c, d as in SMOKE) runs alongside Gray-Scott
 * (u, v) and a history h of v. The smoke stirs the chemistry: u and v are carried along its flow's direction (normalised,
 * so it works at any smoke amplitude) at `stir` cells a step. The chemistry feeds the smoke: its growth rises where v is
 * (v_to_amp) and where v has been (h_to_amp), so smoke breeds round the spots and their trails. The smoke is clamped
 * to ±smoke_clamp so the feedback can't run away. Ready's y is up, the smoke's b is down the screen: the flow is (a, b)
 * in rdui's y-down terms, and rdui's y_gradient points up.
 */
export const SMOKE_GS: RuleDef = {
  name: 'Smoke + Gray-Scott',
  description:
    'A hybrid: the Smoke kernel stirs Gray-Scott, and Gray-Scott feeds the smoke. u and v are carried along the smoke\'s flow '
    + '(its direction, at `stir` cells a step); where v is, and where it has been (the history h), the smoke grows faster '
    + '(v_to_amp, h_to_amp), so smoke breeds round the spots and their trails and stirs them in turn. The smoke is the wide '
    + 'kind (reach), so its flow is coherent over several spots.',
  reagents: ['a', 'b', 'c', 'd', 'u', 'v', 'h'],
  params: [
    ...SMOKE.params,
    { name: 'reach', value: 4, min: 1, max: 12 },
    { name: 'smoke_clamp', value: 1, min: 0.01, max: 10 },
    { name: 'D_u', value: 0.3, min: 0, max: 0.37 },
    { name: 'D_v', value: 0.15, min: 0, max: 0.37 },
    { name: 'F', value: 0.0367, min: 0, max: 0.1 },
    { name: 'k', value: 0.0649, min: 0.03, max: 0.075 },
    { name: 'stir', value: 0.2, min: 0, max: 1 },
    { name: 'v_to_amp', value: 0.01, min: -0.05, max: 0.05 },
    { name: 'h_gain', value: 0.01, min: 0, max: 0.1 },
    { name: 'h_decay', value: 0.002, min: 0, max: 0.05 },
    { name: 'D_h', value: 0.05, min: 0, max: 0.3 },
    { name: 'h_to_amp', value: 0, min: -0.05, max: 0.05 },
  ],
  paramHints: {
    ...SMOKE_HINTS,
    reach: 'How far the smoke\'s neighbours reach, in cells (as Smoke (wide)): its swirls, and the flow that stirs the chemistry, come out about that many times larger',
    smoke_clamp: 'Most the smoke (a and b) may reach: keeps the chemistry\'s feedback from running away',
    D_u: 'How fast the substrate u spreads', D_v: 'How fast the activator v spreads',
    F: 'Gray-Scott feed: how fast u is topped up (and v washed out)', k: 'Gray-Scott kill: how fast v decays',
    stir: 'How fast the smoke carries u and v along its flow, in cells a step: 0 leaves Gray-Scott unstirred',
    v_to_amp: 'How much v speeds the smoke\'s growth: smoke breeds round the spots (negative: spots smother it)',
    h_gain: 'How fast v builds up the history h', h_decay: 'How fast the history h fades', D_h: 'How fast the history h spreads',
    h_to_amp: 'How much the history h speeds the smoke\'s growth: smoke breeds along the spots\' trails',
  },
  paintable: ['F', 'k', 'stir'],
  discrete: true,
  reach: 'reach',
  formula: `float amp_l = amp + v_to_amp*v + h_to_amp*h;
${smokeFormula(false).replace(/amp\*/g, 'amp_l*').replace('float d2 =', 'a2 = clamp(a2, -smoke_clamp, smoke_clamp);\nb2 = clamp(b2, -smoke_clamp, smoke_clamp);\nfloat d2 =')}
// the chemistry, carried along the smoke's flow (a right, b down; rdui's y_gradient points up): its direction averaged
// over the nine boxes the neighbours are (reach wide), so it's coherent across a spot rather than flipping cell to cell
float ma = a + north_a + north_east_a + east_a + south_east_a + south_a + south_west_a + west_a + north_west_a;
float mb = b + north_b + north_east_b + east_b + south_east_b + south_b + south_west_b + west_b + north_west_b;
float fl = sqrt(ma*ma + mb*mb) + 1e-30;
float fx = stir*ma/fl;
float fy = stir*mb/fl;
delta_u = D_u*laplacian_u - u*v*v + F*(1.0 - u) - (fx*x_gradient_u - fy*y_gradient_u);
delta_v = D_v*laplacian_v + u*v*v - (F + k)*v - (fx*x_gradient_v - fy*y_gradient_v);
delta_h = h_gain*v - h_decay*h + D_h*laplacian_h;`,
  size: { width: 512, height: 512 },
  rest: [0, 0, 0, 0, 1, 0, 0],
  seed: [null, null, null, null, 0.5, 0.25, null],
  seedNoise: [0, 0, 0, 0, 0, 0.25, 0],
  initial: [
    ...(['a', 'b'] as const).map((chem): Overlay => ({ chem, op: 'overwrite', fill: { type: 'white_noise', low: -1, high: 1 }, shape: { type: 'everywhere' } })),
    { chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    { chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'spots', count: 40, minSize: 3, maxSize: 8, seed: 1 } },
    { chem: 'v', op: 'overwrite', fill: { type: 'white_noise', low: 0.25, high: 0.35 }, shape: { type: 'spots', count: 40, minSize: 3, maxSize: 8, seed: 1 } },
  ],
  view: { reagent: 'v', low: 0, high: 0.4, tint: 'd', stepsPerFrame: 4, customOff: ['a', 'b', 'c', 'h'] },
};

/** Smoke's kernel with its reagents renamed (a, b, c, d → the given four), for hybrids whose other half uses those names. */
function renamedSmoke(smooth: boolean, [x, y, div, view]: [string, string, string, string]) {
  const to: Record<string, string> = { a: x, b: y, c: div, d: view };
  return smokeFormula(smooth)
    .replace(/\b(delta|north|north_east|east|south_east|south|south_west|west|north_west)_([abcd])\b/g, (_, op, r) => `${op}_${to[r]}`)
    .replace(/\b([abcd])\b/g, (r) => to[r]);
}

/**
 * Smoke stirring GS History+Wave (a hybrid, Dan's idea): wide smoke (sx, sy; its divergence sdiv, its view sview) runs
 * alongside Dan's History+Wave Gray-Scott (a, b, history c, wave d with velocity e; its formula and parameter names
 * as in GS_HISTORY_WAVE). The smoke stirs: a, b and the history c are carried along its flow (averaged over the reach
 * boxes so it's coherent across a feature), so trails are swept like smoke. The chemistry feeds the smoke: its growth
 * rises with b, with the history c, and with the wave's displacement from its rest (b_to_smoke, c_to_smoke,
 * wave_to_smoke). Smoke clamped to ±smoke_clamp.
 */
export const SMOKE_HW: RuleDef = {
  name: 'Smoke + GS History+Wave',
  description:
    'A hybrid: wide smoke stirs Dan\'s GS History+Wave, and it feeds the smoke. The chemistry (a, b) and its history '
    + 'trail c are carried along the smoke\'s flow (stir, stir_c), so trails are swept like smoke; the smoke grows faster '
    + 'with b, with the history and with the wave (b_to_smoke, c_to_smoke, wave_to_smoke). The smoke\'s own reagents are '
    + 'sx, sy (its flow), sdiv and sview.',
  reagents: ['a', 'b', 'c', 'd', 'e', 'sx', 'sy', 'sdiv', 'sview'],
  params: [
    ...GS_HISTORY_WAVE.params,
    ...SMOKE.params.map((p) => (p.name === 'd_gain' ? { ...p, name: 'sview_gain' } : p)),
    { name: 'reach', value: 3, min: 1, max: 12 },
    { name: 'smoke_clamp', value: 1, min: 0.01, max: 10 },
    { name: 'stir', value: 0.2, min: 0, max: 1 },
    { name: 'stir_c', value: 1, min: 0, max: 2 },
    { name: 'stir_smooth', value: 1, min: 0, max: 2 },
    { name: 'b_to_smoke', value: 0.01, min: -0.05, max: 0.05 },
    { name: 'c_to_smoke', value: 0, min: -0.05, max: 0.05 },
    { name: 'wave_to_smoke', value: 0, min: -0.05, max: 0.05 },
  ],
  paramHints: {
    ...GS_HISTORY_WAVE.paramHints,
    ...Object.fromEntries(Object.entries(SMOKE_HINTS).map(([k, v]) => [k === 'd_gain' ? 'sview_gain' : k, v.replace(/\bd\b/g, 'sview')])),
    reach: 'How far the smoke\'s neighbours reach, in cells (as Smoke (wide)): its swirls, and the flow that stirs, come out about that many times larger',
    smoke_clamp: 'Most the smoke (sx and sy) may reach: keeps the chemistry\'s feedback from running away',
    stir: 'How fast the smoke carries a, b and the history along its flow, in cells a step: 0 leaves the chemistry unstirred',
    stir_c: 'How much of the stirring the history c gets (1: as much as a and b; 0: trails stay where they were laid)',
    stir_smooth: 'Smooths the stirred history as it moves (1: as much as an upwind scheme would): damps fine ripples the stirring can leave, at the cost of some sharpness',
    b_to_smoke: 'How much b speeds the smoke\'s growth: smoke breeds round the spots',
    c_to_smoke: 'How much the history c speeds the smoke\'s growth: smoke breeds along the trails',
    wave_to_smoke: 'How much the wave (its displacement from rest) speeds the smoke\'s growth: smoke rides the wakes',
  },
  paintable: ['F', 'k', 'stir'],
  discrete: true,
  reach: 'reach',
  formula: `${GS_HISTORY_WAVE.formula}
// the smoke, its growth raised by the chemistry
float amp_l = amp + b_to_smoke*b + c_to_smoke*c + wave_to_smoke*(d - wave_DC_value);
${renamedSmoke(false, ['sx', 'sy', 'sdiv', 'sview']).replace(/amp\*/g, 'amp_l*').replace(/d_gain/g, 'sview_gain').replace('float d2 =', 'a2 = clamp(a2, -smoke_clamp, smoke_clamp);\nb2 = clamp(b2, -smoke_clamp, smoke_clamp);\nfloat d2 =')}
// the chemistry and its history, carried along the smoke's flow (sx right, sy down; rdui's y_gradient points up), its
// direction averaged over the nine reach boxes so it's coherent across a feature
float ma = sx + north_sx + north_east_sx + east_sx + south_east_sx + south_sx + south_west_sx + west_sx + north_west_sx;
float mb = sy + north_sy + north_east_sy + east_sy + south_east_sy + south_sy + south_west_sy + west_sy + north_west_sy;
float fl = sqrt(ma*ma + mb*mb) + 1e-30;
float fx = stir*ma/fl;
float fy = stir*mb/fl;
delta_a = delta_a - (fx*x_gradient_a - fy*y_gradient_a);
delta_b = delta_b - (fx*x_gradient_b - fy*y_gradient_b);
delta_c = delta_c - stir_c*(fx*x_gradient_c - fy*y_gradient_c) + stir_smooth*0.5*stir*stir_c*laplacian_c;`,
  size: { width: 256, height: 256 },
  rest: [0.65, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [0.5, 0.25, null, null, null, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0, 0, 0, 0],
  initial: [
    ...GS_HISTORY_WAVE.initial,
    ...(['sx', 'sy'] as const).map((chem): Overlay => ({ chem, op: 'overwrite', fill: { type: 'white_noise', low: -1, high: 1 }, shape: { type: 'everywhere' } })),
  ],
  view: { reagent: 'c', low: 0, high: 1, tint: 'b', stepsPerFrame: 10, customOff: ['d', 'e', 'sx', 'sy', 'sdiv', 'sview'] },
};

/**
 * Smoke with a history of its strength (Dan's idea, step one; then SMOKE_HISTORY_WAVE): the Smoke kernel (a, b, c, d) and h,
 * which builds up where the smoke is strong (its magnitude |(a, b)|, magnified by mag_gain as d is, since smoke lives at
 * ~1e-7), fades and spreads. h can feed back: speeding the smoke's growth (h_to_amp) or its turning (h_to_cs). Reach as
 * Smoke (wide), 1 by default (the plain kernel).
 */
function smokeHistory(wave: boolean, cap = false): RuleDef {
  const waveFormula = wave
    ? `
// a damped wave (displacement w, velocity wv) the smoke's strength drives; w moves with the new velocity (as in
// GS History+Wave), which keeps it stable for wave_c2 up to 0.5
delta_wv = wave_c2*laplacian_w - wave_damp*wv - wave_spring*w + m_to_wave*m;
delta_w = wv + delta_wv;`
    : '';
  return {
    name: (wave ? 'Smoke + History + Wave' : 'Smoke + History') + (cap ? ' 2' : ''),
    description:
      'Smoke with a history h of its strength: h builds up where the smoke is strong (its magnitude, magnified by mag_gain), '
      + 'fades and spreads, so it shows where the smoke has been. h can feed back on the smoke\'s growth (h_to_amp) and turning (h_to_cs).'
      + (wave ? ' A damped wave (w, its velocity wv), driven by the smoke\'s strength (m_to_wave), spreads out from it, and can '
        + 'feed back on its growth (wave_to_amp).' : ''),
    reagents: ['a', 'b', 'c', 'd', 'h', ...(wave ? ['w', 'wv'] : [])],
    params: [
      ...SMOKE.params,
      { name: 'reach', value: 1, min: 1, max: 12 },
      { name: 'smoke_clamp', value: 10, min: 0.01, max: 10 },
      { name: 'mag_gain', value: 1e6, min: 0, max: 1e7 },
      ...(cap ? [{ name: 'm_cap', value: 5e4, min: 1, max: 1e6 }] : []),
      { name: 'h_gain', value: 0.01, min: 0, max: 0.1 },
      { name: 'h_decay', value: 0.01, min: 0, max: 0.1 },
      { name: 'D_h', value: 0.05, min: 0, max: 0.3 },
      { name: 'h_half', value: 1, min: 0.01, max: 100 },
      { name: 'h_to_amp', value: 0, min: -0.002, max: 0.002 },
      { name: 'h_to_cs', value: 0, min: -1, max: 2 },
      { name: 'h_twist', value: 0, min: -0.5, max: 0.5 },
      { name: 'h_push', value: 0, min: -1, max: 1 },
      ...(wave ? [
        { name: 'wave_c2', value: 0.2, min: 0, max: 0.5 },
        { name: 'wave_damp', value: 0.002, min: 0, max: 0.05 },
        { name: 'wave_spring', value: 0.001, min: 0, max: 0.05 },
        { name: 'm_to_wave', value: 0.001, min: 0, max: 0.01 },
        { name: 'wave_to_amp', value: 0, min: -0.01, max: 0.01 },
      ] : []),
    ],
    paramHints: {
      ...SMOKE_HINTS,
      reach: 'How far the smoke\'s neighbours reach, in cells (as Smoke (wide)): 1 is the plain kernel; larger makes larger smoke',
      smoke_clamp: 'Most the smoke (a and b) may reach: keeps feedback from running away',
      ...(cap ? { m_cap: 'Most the magnified strength may count for: the random start is ~1e6, far stronger than smoke runs, and would kick the history and wave hard (the wave then rings for ~3500 steps)' } : {}),
      mag_gain: 'How much the smoke\'s strength is magnified before the history (and wave) take it up: smoke lives at ~1e-7',
      h_gain: 'How fast the smoke\'s strength builds up the history h',
      h_decay: 'How fast the history h fades',
      D_h: 'How fast the history h spreads',
      h_half: 'The history at which its feedback is half on: the feedback uses h/(h + h_half), from 0 to 1, so it can\'t run away',
      h_to_amp: 'How much the history speeds the smoke\'s growth (negative: slows it where the smoke has been). amp is ~1.001, so small values matter',
      h_to_cs: 'How much the history changes the smoke\'s turning: cs times (1 + h_to_cs·hn)',
      h_twist: 'Turns the flow by this angle (radians a step) where the history is: old trails curl the smoke one way (negative: the other)',
      h_push: 'Pushes the flow down the history\'s slope, away from where the smoke has been (negative: towards it, so it follows its trails)',
      ...(wave ? {
        wave_c2: 'Wave speed squared: higher spreads the wave faster (above 0.5 it goes unstable)',
        wave_damp: 'How fast the wave dies away',
        wave_spring: 'Pulls the wave back to 0: the smoke\'s strength only ever pushes it one way, so without this it drifts up for ever',
        m_to_wave: 'How hard the smoke\'s strength drives the wave',
        wave_to_amp: 'How much the wave\'s displacement speeds (or, negative, slows) the smoke\'s growth, saturating (w/(1 + |w|)): the smoke rides its own wakes',
      } : {}),
    },
    paintable: ['cs', 'amp'],
    discrete: true,
    reach: 'reach',
    formula: `// the smoke's strength, magnified (it lives at ~1e-7)
float m = ${cap ? 'min(mag_gain*sqrt(a*a + b*b), m_cap)' : 'mag_gain*sqrt(a*a + b*b)'};
// the history's feedback, saturating (0 to 1) so it can't run away
float hn = h/(fabs(h) + h_half);
float amp_l = amp + h_to_amp*hn${wave ? ' + wave_to_amp*w/(1.0 + fabs(w))' : ''};
float cs_l = cs*(1.0 + h_to_cs*hn);
${smokeFormula(false).replace(/amp\*/g, 'amp_l*').replace(/\bcs\*/g, 'cs_l*')
    .replace('float a2 =', '// pushed down the history\'s slope (a right, b down; rdui\'s y_gradient points up), in the smoke\'s own tiny units\nta = ta - h_push*x_gradient_h/mag_gain;\ntb = tb + h_push*y_gradient_h/mag_gain;\nturn = turn + h_twist*hn;\nfloat a2 =')
    .replace('float d2 =', 'a2 = clamp(a2, -smoke_clamp, smoke_clamp);\nb2 = clamp(b2, -smoke_clamp, smoke_clamp);\nfloat d2 =')}
// its history: built up by its strength, fading and spreading
delta_h = h_gain*m - h_decay*h + D_h*laplacian_h;${waveFormula}`,
    size: { width: 512, height: 512 },
    rest: [0, 0, 0, 0, 0, ...(wave ? [0, 0] : [])],
    seed: [1, 1, null, null, null, ...(wave ? [null, null] : [])],
    seedNoise: [0, 0, 0, 0, 0, ...(wave ? [0, 0] : [])],
    initial: SMOKE.initial,
    view: { reagent: 'h', low: 0, high: 1, stepsPerFrame: 3, customAuto: true, customOff: ['a', 'b', 'c', ...(wave ? ['wv'] : [])] },
  };
}
export const SMOKE_HISTORY = smokeHistory(false);
export const SMOKE_HISTORY_WAVE = smokeHistory(true);
/** As SMOKE_HISTORY_WAVE, with the magnified strength capped (m_cap) so the random start doesn't set the wave ringing. */
export const SMOKE_HISTORY_WAVE_2 = smokeHistory(true, true);

/**
 * Momentum Bubbles (contraptions, step one; Dan's idea): Phase-field Bubbles 13's bubbles without heat or swirl, each
 * carrying a momentum p = (px, py) (a complex number px + i·py; y up, as the gradients), kept in and spread inside as its
 * content and heat are (gated px, py and pulled in with a retreating edge). Nothing hidden: a bubble moves because of
 * what it holds, at velocity p/m (momentum over content), so bubbles that join add their momenta and go at their
 * content-weighted mean velocity. It moves as buoyancy moved the lava lamp's: the edge tilted out where it faces along
 * the velocity, in where it faces away, capped at move_max (faster, a bubble leaves its content behind). p_drag slows
 * every bubble alike (0: they go for ever).
 */
export const MOMENTUM_BUBBLES: RuleDef = {
  name: 'Momentum Bubbles',
  description: 'Bubbles that carry momentum. Each holds a momentum p = (px, py) (think px + i·py; y up) spread through it '
    + 'as its content m is, and moves at velocity p/m: so nothing is hidden, a bubble goes because of what it holds, and '
    + 'two that join add their momenta. Otherwise as Phase-field Bubbles 13 without heat: the edge moves by curvature and '
    + 'content pressure, bubbles eat a substrate u and keep a gap rather than merge. Seed paints a still bubble; '
    + 'scenes stamp moving ones. View phi tinted by px.',
  reagents: ['phi', 'm', 'u', 'g', 'gm', 'mphi', 'px', 'py', 'gpx', 'gpy', 'pxphi', 'pyphi'],
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
    { name: 'p_gain', value: 1, min: 0, max: 4 },
    { name: 'move_max', value: 0.014, min: 0, max: 0.1 },
    { name: 'p_drag', value: 0, min: 0, max: 0.001 },
  ],
  paramHints: {
    D_phi: 'How fast phi spreads; higher gives wider, softer bubble edges',
    well: 'How strongly cells settle fully inside or outside a bubble; higher gives sharper edges',
    D_m: 'How fast content and momentum spread inside a bubble',
    m_inward: 'How strongly content and momentum are drawn in with a retreating edge, so a moving bubble keeps them',
    leak: 'How much content (and momentum) seeps through the open sea; lets small bubbles slowly lose content to big ones',
    pressure: 'How hard content above target pushes the edge out (content below target pulls it in)',
    target: 'Content level a bubble settles at; raise it for smaller bubbles',
    D_u: 'How fast the substrate spreads',
    u_feed: 'How fast substrate is fed back toward 1 everywhere',
    u_eat: 'How fast bubbles eat the substrate inside them',
    u_edge: 'Substrate an edge needs to advance freely; below this the edge is held back',
    starve: 'How hard an edge short of substrate is held back; higher keeps neighbours further apart',
    u_supply: 'Substrate needed for content to push the edge out at full strength; less substrate pushes less',
    p_gain: 'How far a bubble\'s velocity (p/m) tilts its edge: how fast a given momentum moves it',
    move_max: 'Top speed (as edge tilt); above ~0.015 a bubble leaves its content behind in a trail of dots',
    p_drag: 'How fast every bubble\'s momentum fades: 0 and they go for ever',
  },
  paintable: [],
  momentum: { x: 'px', y: 'py', mass: 'm', speed: 0.06 },
  formula: `// the drive at the edge, as Phase-field Bubbles 13: content pressure (pushing out only with substrate, pulling in
// always), held back where the substrate is short (between two bubbles), on the edge proper only (phi over 0.1)
float P = pressure*(m - target)*smoothstep(0.05, 0.15, phi);
// Momentum moves the edge: the velocity p/m dotted with the outward normal (-grad phi/|grad phi|; y up, as p), so the
// front grows and the back shrinks; on the edge proper only, capped at move_max
float gl = sqrt(x_gradient_phi*x_gradient_phi + y_gradient_phi*y_gradient_phi);
float edge_on = smoothstep(0.05, 0.15, phi)/max(gl, 0.02);
float mm = max(m, 0.1);
float move = clamp(-p_gain*(x_gradient_phi*px + y_gradient_phi*py)/mm*edge_on, -move_max, move_max);
float lambda = clamp(max(P, 0.0)*min(u/u_supply, 1.0) + min(P, 0.0) - starve*max(u_edge - u, 0.0) + move, -0.45, 0.45);
delta_phi = D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);
delta_u = D_u*laplacian_u + u_feed*(1.0 - u) - u_eat*phi*u;
// content: spread inside, held in at the edge, drawn up phi's slope with a retreating edge (both summing to zero)
delta_m = D_m*0.5*(laplacian_gm + g*laplacian_m - m*laplacian_g) - m_inward*0.5*(laplacian_mphi - phi*laplacian_m + m*laplacian_phi);
delta_g = (max(smoothstep(0.02, 0.5, phi), leak) - g)/timestep;
delta_gm = (g*m - gm)/timestep;
delta_mphi = (m*phi - mphi)/timestep;
// momentum: carried exactly as content is (so it goes where the content goes, and adds when bubbles join), fading by p_drag
delta_px = D_m*0.5*(laplacian_gpx + g*laplacian_px - px*laplacian_g) - m_inward*0.5*(laplacian_pxphi - phi*laplacian_px + px*laplacian_phi) - p_drag*px;
delta_py = D_m*0.5*(laplacian_gpy + g*laplacian_py - py*laplacian_g) - m_inward*0.5*(laplacian_pyphi - phi*laplacian_py + py*laplacian_phi) - p_drag*py;
delta_gpx = (g*px - gpx)/timestep;
delta_gpy = (g*py - gpy)/timestep;
delta_pxphi = (px*phi - pxphi)/timestep;
delta_pyphi = (py*phi - pyphi)/timestep;`,
  rest: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [1, 3, null, null, null, null, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  initial: [
    { chem: 'u', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    // three bubbles: still, going right, going up-left
    ...([[0.5, 0.5, 0, 0], [0.25, 0.3, 0.06, 0], [0.75, 0.75, -0.04, 0.04]] as const).flatMap(([cx, cy, vx, vy]): Overlay[] => [
      { chem: 'phi', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'circle', cx, cy, r: 0.05 } },
      { chem: 'm', op: 'overwrite', fill: { type: 'constant', value: 10 }, shape: { type: 'circle', cx, cy, r: 0.05 } },
      { chem: 'px', op: 'overwrite', fill: { type: 'constant', value: vx * 10 }, shape: { type: 'circle', cx, cy, r: 0.05 } },
      { chem: 'py', op: 'overwrite', fill: { type: 'constant', value: vy * 10 }, shape: { type: 'circle', cx, cy, r: 0.05 } },
    ]),
  ],
  size: { width: 256, height: 256 },
  // (custom palette exponent 1: dots, gates and faint channels all show; higher hides them)
  view: { reagent: 'phi', low: 0, high: 1, tint: 'px', stepsPerFrame: 200, customGamma: 1, customOff: ['g', 'gm', 'mphi', 'gpx', 'gpy', 'pxphi', 'pyphi'] },
};

/**
 * Momentum Bubbles 2 (carried insides): version 1, with a bubble's content and momentum carried along at its velocity
 * p/m (carry), conservatively: content by the flux g·p (content times velocity is p), momentum by g·p·p/m, both gated by
 * g so nothing is carried out into the sea. The front gains content and pushes out, the back runs short and pulls in:
 * the bubble goes because its insides go, not only by its edge's tilt, and can go faster without leaving dots.
 * Central differences from the neighbours (rdui's north is up, as y in p).
 */
export const MOMENTUM_BUBBLES_2: RuleDef = {
  ...MOMENTUM_BUBBLES,
  name: 'Momentum Bubbles 2 (carried insides)',
  description: MOMENTUM_BUBBLES.description.replace('Bubbles that carry momentum.', 'Bubbles that carry momentum, their insides carried along with them (carry).'),
  params: [...MOMENTUM_BUBBLES.params, { name: 'carry', value: 1, min: 0, max: 4 }],
  paramHints: {
    ...MOMENTUM_BUBBLES.paramHints,
    carry: 'How fast a bubble\'s content and momentum are carried along at its velocity (p/m): the front fills and pushes out, the back empties and pulls in, so the bubble goes because its insides go. 0 is version 1 (only the edge\'s tilt moves it)',
  },
  formula: MOMENTUM_BUBBLES.formula
    .replace('delta_m = D_m', `// carried along at the velocity p/m inside the bubble: content by the flux g·p, momentum by g·p·p/m (central differences;
// north is up, as y in p)
float ie = east_g/max(east_m, 0.1);
float iw = west_g/max(west_m, 0.1);
float in_ = north_g/max(north_m, 0.1);
float is_ = south_g/max(south_m, 0.1);
float div_m = 0.5*(east_g*east_px - west_g*west_px) + 0.5*(north_g*north_py - south_g*south_py);
float div_px = 0.5*(east_px*east_px*ie - west_px*west_px*iw) + 0.5*(north_px*north_py*in_ - south_px*south_py*is_);
float div_py = 0.5*(east_py*east_px*ie - west_py*west_px*iw) + 0.5*(north_py*north_py*in_ - south_py*south_py*is_);
delta_m = -carry*div_m + D_m`)
    .replace('delta_px = D_m', 'delta_px = -carry*div_px + D_m')
    .replace('delta_py = D_m', 'delta_py = -carry*div_py + D_m'),
};

/**
 * Momentum Bubbles 3 (carried whole): version 2, with the bubble itself (phi) carried along at its velocity too
 * (carry_phi), so its back edge goes as fast as its front rather than trailing a soft comet tail. Upwind differences (each
 * cell takes from the side the flow comes from): central ones ripple at a sharp edge, and the well grows ripples into droplets.
 * Content and momentum go donor-cell too, ungated, so they go where phi goes. ~75x version 1's speed; bubbles that meet
 * join, adding their momenta. The edge tilt (p_gain) is off by default.
 */
export const MOMENTUM_BUBBLES_3: RuleDef = {
  ...MOMENTUM_BUBBLES_2,
  name: 'Momentum Bubbles 3 (carried whole)',
  view: { ...MOMENTUM_BUBBLES.view, stepsPerFrame: 20 },
  description: MOMENTUM_BUBBLES.description.replace('Bubbles that carry momentum.', 'Bubbles that carry momentum, carried along whole, insides (carry) and edge (carry_phi).'),
  // the edge's tilt (p_gain) is off: carried whole, the bubble needs no other push
  params: [...MOMENTUM_BUBBLES_2.params.map((p) => (p.name === 'p_gain' ? { ...p, value: 0 } : p)), { name: 'carry_phi', value: 1, min: 0, max: 4 }],
  paramHints: {
    ...MOMENTUM_BUBBLES_2.paramHints,
    carry_phi: 'How fast the bubble itself (phi) is carried along at its velocity: 1 keeps its back edge up with its insides, so it leaves no tail; 0 leaves only the insides carried',
  },
  formula: MOMENTUM_BUBBLES.formula
    .replace('delta_phi = D_phi*laplacian_phi', `// the velocity p/m (y up, as p), here and next door
float vx = px/max(m, 0.1);
float vy = py/max(m, 0.1);
float evx = east_px/max(east_m, 0.1);
float wvx = west_px/max(west_m, 0.1);
float nvy = north_py/max(north_m, 0.1);
float svy = south_py/max(south_m, 0.1);
// the bubble carried along at it, upwind
float adv = max(vx, 0.0)*(phi - west_phi) + min(vx, 0.0)*(east_phi - phi) + max(vy, 0.0)*(phi - south_phi) + min(vy, 0.0)*(north_phi - phi);
delta_phi = -carry_phi*adv + D_phi*laplacian_phi`)
    .replace('delta_m = D_m', `// content and momentum carried at it, through each cell's faces, each face taking from the cell the flow comes from
// (donor cell): the totals are kept exactly, and the content goes where phi goes (gating by g stranded it at the back,
// where phi had gone and g closed)
float div_m = max(vx, 0.0)*m + min(evx, 0.0)*east_m - max(wvx, 0.0)*west_m - min(vx, 0.0)*m + max(vy, 0.0)*m + min(nvy, 0.0)*north_m - max(svy, 0.0)*south_m - min(vy, 0.0)*m;
float div_px = max(vx, 0.0)*px + min(evx, 0.0)*east_px - max(wvx, 0.0)*west_px - min(vx, 0.0)*px + max(vy, 0.0)*px + min(nvy, 0.0)*north_px - max(svy, 0.0)*south_px - min(vy, 0.0)*px;
float div_py = max(vx, 0.0)*py + min(evx, 0.0)*east_py - max(wvx, 0.0)*west_py - min(vx, 0.0)*py + max(vy, 0.0)*py + min(nvy, 0.0)*north_py - max(svy, 0.0)*south_py - min(vy, 0.0)*py;
delta_m = -carry*div_m + D_m`)
    .replace('delta_px = D_m', 'delta_px = -carry*div_px + D_m')
    .replace('delta_py = D_m', 'delta_py = -carry*div_py + D_m'),
};

/**
 * Momentum Bubbles 4 (speed limit): version 3, with each part of the velocity p/m capped at ±v_max. The carrying is
 * only stable while the content's spreading and the flow together move under a cell a step (4·D_m + |vx| + |vy| ≤ 1,
 * so |vx| + |vy| ≤ 0.2 at D_m 0.2): pushed harder (Push at strength 5 is 0.3 px a step), version 3 blows up.
 */
export const MOMENTUM_BUBBLES_4: RuleDef = {
  ...MOMENTUM_BUBBLES_3,
  name: 'Momentum Bubbles 4 (speed limit)',
  params: [...MOMENTUM_BUBBLES_3.params, { name: 'v_max', value: 0.1, min: 0, max: 0.2 }],
  paramHints: {
    ...MOMENTUM_BUBBLES_3.paramHints,
    v_max: 'Top speed, in cells a step, across and up (each): pushed past it a bubble goes no faster (and keeps the extra momentum). Above ~0.1 with D_m 0.2 the carrying can go unstable',
  },
  formula: MOMENTUM_BUBBLES_3.formula.replace(/= (\w+)\/max\((\w+), 0\.1\);/g, '= clamp($1/max($2, 0.1), -v_max, v_max);'),
};

/**
 * Momentum Bubbles 5 (shoving): version 4, with each bubble's momentum pushed up the substrate's slope (u_push·g·grad u,
 * y up): towards fresh substrate, away from crowding. A bubble alone has substrate all round, so the pushes cancel;
 * between two pressed together it's eaten from both sides, so each is shoved away from the other (they bounce), and a
 * crowd that has eaten its substrate down is flung apart when it's let out. It doesn't work: a bubble eats its own
 * substrate, so u is low inside and higher just outside every edge, and the push drags the whole edge outward, tearing
 * the bubble (0.03 and up) rather than moving it. See version 6.
 */
export const MOMENTUM_BUBBLES_5: RuleDef = {
  ...MOMENTUM_BUBBLES_4,
  name: 'Momentum Bubbles 5 (shoving)',
  params: [...MOMENTUM_BUBBLES_4.params, { name: 'u_push', value: 0.01, min: 0, max: 0.1 }],
  paramHints: {
    ...MOMENTUM_BUBBLES_4.paramHints,
    u_push: 'How hard a bubble is pushed toward fresh substrate: bubbles pressed together (eating the gap between them) shove each other apart',
  },
  formula: MOMENTUM_BUBBLES_4.formula
    .replace('delta_px = -carry*div_px', 'delta_px = u_push*g*x_gradient_u - carry*div_px')
    .replace('delta_py = -carry*div_py', 'delta_py = u_push*g*y_gradient_u - carry*div_py'),
};

/**
 * Momentum Bubbles 6 (shoving, from starved sea): version 4, with each bubble's momentum pushed away from starved sea:
 * outside bubbles (1 − phi), where the substrate is below what an edge needs (u_edge), s = (1 − phi)·max(u_edge − u, 0),
 * and the push is down its slope (−u_push·g·grad s, y up, from the neighbours). Round a lone bubble the sea is fed (s
 * is 0), so nothing pushes; in the gap between two pressed together it's eaten from both sides, so each is shoved away.
 * (Version 5 pushed up u's own slope, which is steep at every edge, and tore bubbles apart.) It doesn't work either:
 * head-on bubbles still merge at 0.1, and break up above it; even apart they lose content faster than without it, so
 * the sea right round a lone bubble is starved too (below u_edge), and the push still acts on every edge.
 */
export const MOMENTUM_BUBBLES_6: RuleDef = {
  ...MOMENTUM_BUBBLES_4,
  name: 'Momentum Bubbles 6 (shoving)',
  params: [...MOMENTUM_BUBBLES_4.params, { name: 'u_push', value: 0.1, min: 0, max: 1 }],
  paramHints: {
    ...MOMENTUM_BUBBLES_4.paramHints,
    u_push: 'How hard bubbles are shoved away from starved sea (substrate below u_edge outside bubbles, as in the gap between two pressed together): they bounce rather than smoosh',
  },
  formula: MOMENTUM_BUBBLES_4.formula
    .replace('delta_px = -carry*div_px', `// starved sea, here and next door, and the push down its slope
float sE = (1.0 - east_phi)*max(u_edge - east_u, 0.0);
float sW = (1.0 - west_phi)*max(u_edge - west_u, 0.0);
float sN = (1.0 - north_phi)*max(u_edge - north_u, 0.0);
float sS = (1.0 - south_phi)*max(u_edge - south_u, 0.0);
delta_px = -u_push*g*0.5*(sE - sW) - carry*div_px`)
    .replace('delta_py = -carry*div_py', 'delta_py = -u_push*g*0.5*(sN - sS) - carry*div_py'),
};

/**
 * Momentum Bubbles 7 (bag): version 4's bubbles, and bags: a second kind of phase field B, with its own content mb held
 * in and spread as a bubble's is (so its area follows its content), still (no momentum). Where the two kinds overlap
 * each is pushed out (repel, as Phase-field Bubbles 2's kinds), so bubbles dock against a bag rather than merge with it.
 * Stamped as a ring, a bag can only get bigger round by getting thinner, and a phase field can't hold a film much
 * thinner than its edge: bubbles crowded inside should stretch it until it tears (the test this version is for).
 * Crowded bubbles can't push (short of substrate), so crowd (their excess content, spread a few cells) presses the bag
 * via squeeze. Found: bag content 4 holds 16 bubbles (ring ~18 cells thick, squeeze barely dents it); content 2-2.5
 * makes a thin ring that breaks into four arcs at the diagonals by ~5000 steps with or without squeeze (the grid
 * pinches thin diagonal films), so it doesn't burst from fullness yet. Content at target (1) collapses.
 */
export const MOMENTUM_BUBBLES_7: RuleDef = {
  ...MOMENTUM_BUBBLES_4,
  name: 'Momentum Bubbles 7 (bag)',
  description: MOMENTUM_BUBBLES_4.description + ' Bags (B, with content mb): a second kind, still, that bubbles dock against '
    + 'rather than merge with; a ring of it holds bubbles in, and stretched thin enough it tears.',
  reagents: [...MOMENTUM_BUBBLES_4.reagents, 'B', 'mb', 'gb', 'gmb', 'mbB', 'crowd'],
  params: [
    ...MOMENTUM_BUBBLES_4.params,
    { name: 'repel', value: 1, min: 0, max: 4 },
    { name: 'bag_pressure', value: 0.3, min: 0, max: 2 },
    { name: 'bag_target', value: 1, min: 0.1, max: 4 },
    { name: 'squeeze', value: 0.05, min: 0, max: 0.5 },
    { name: 'crowd_rate', value: 0.01, min: 0.001, max: 0.1 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_4.paramHints,
    repel: 'How hard bubbles and bags push each other out where they overlap: they dock rather than merge',
    bag_pressure: 'How hard a bag\'s content above bag_target pushes its edge out (below, pulls it in): how firmly it keeps its area',
    bag_target: 'Content level a bag settles at: its area is its content over this',
    crowd_rate: 'How fast the crowd signal follows the bubbles\' squash, and fades: lower spreads it further (about sqrt(0.2/crowd_rate) cells)',
    squeeze: 'How much harder squashed bubbles (content over target: crowded, they can\'t grow) push on a bag: a full bag is stretched, and thinned, by the crowd inside',
  },
  rest: [...MOMENTUM_BUBBLES_4.rest, 0, 0, 0, 0, 0, 0],
  seed: [...MOMENTUM_BUBBLES_4.seed, null, null, null, null, null, null],
  seedNoise: [...MOMENTUM_BUBBLES_4.seedNoise, 0, 0, 0, 0, 0, 0],
  initial: [MOMENTUM_BUBBLES_4.initial[0]],
  formula: MOMENTUM_BUBBLES_4.formula
    .replace('delta_phi = -carry_phi*adv + D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda);',
      '// (pushed out where a bag is, so bubbles dock against bags)\ndelta_phi = -carry_phi*adv + D_phi*laplacian_phi + well*phi*(1.0 - phi)*(phi - 0.5 + lambda) - repel*phi*B*B;')
    .replace('delta_u =', `// bags: a second kind, still; their content mb holds their area (pressure), spread and held in as a bubble's; pushed out
// where a bubble is
// and tilted in where squashed bubbles press (crowded bubbles can't push each other, short of substrate, but their
// content piles up over target): crowd is that excess, spread a few cells out (across the gap a bubble keeps from a bag)
// and fading; squeeze lets it press on the bag, in the clamped tilt, so it stays stable
float lambda_b = clamp(bag_pressure*(mb - bag_target)*smoothstep(0.05, 0.15, B) - squeeze*crowd, -0.45, 0.45);
delta_crowd = 0.2*laplacian_crowd + crowd_rate*(phi*max(m - target, 0.0) - crowd);
delta_B = D_phi*laplacian_B + well*B*(1.0 - B)*(B - 0.5 + lambda_b) - repel*B*phi*phi;
delta_mb = D_m*0.5*(laplacian_gmb + gb*laplacian_mb - mb*laplacian_gb) - m_inward*0.5*(laplacian_mbB - B*laplacian_mb + mb*laplacian_B);
delta_gb = (max(smoothstep(0.02, 0.5, B), leak) - gb)/timestep;
delta_gmb = (gb*mb - gmb)/timestep;
delta_mbB = (mb*B - mbB)/timestep;
delta_u =`),
  view: { ...MOMENTUM_BUBBLES_4.view, customOff: [...MOMENTUM_BUBBLES_4.view.customOff!, 'mb', 'gb', 'gmb', 'mbB'] },
};

/**
 * Momentum Bubbles 8 (aim): version 4, with aim: a still field a = (ax, ay) (y up; stamped by scenes, like warmth in the
 * lava lamp) that reprograms bubbles passing through. Where it is, a bubble's momentum swings toward the same size
 * along a's direction (|p|·â, at aim_rate·|a|): it keeps its speed and turns, however it came in, so it leaves the way
 * a points (a corner). aim_drag bleeds momentum there too (scaled by |a|): slow bubbles stall in it, fast ones get through.
 * Found: a corner turns a dot from 0° to −90° cleanly, but it keeps only ~1/3 of its momentum (the turned front and
 * unturned back average inside the bubble, and vectors pointing different ways shrink when averaged); sharper turns
 * (aim_rate 0.5) keep less (~1/6).
 */
export const MOMENTUM_BUBBLES_8: RuleDef = {
  ...MOMENTUM_BUBBLES_4,
  name: 'Momentum Bubbles 8 (aim)',
  description: MOMENTUM_BUBBLES_4.description + ' Aim (ax, ay; y up): still regions that turn bubbles passing through toward '
    + 'their direction, keeping their speed (aim_drag slows them there too, so slow ones stall).',
  reagents: [...MOMENTUM_BUBBLES_4.reagents, 'ax', 'ay'],
  params: [
    ...MOMENTUM_BUBBLES_4.params,
    { name: 'aim_rate', value: 0.05, min: 0, max: 0.5 },
    { name: 'aim_drag', value: 0, min: 0, max: 0.05 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_4.paramHints,
    aim_rate: 'How fast a bubble in an aim region turns toward its direction (per step, times the aim\'s strength |a|): high turns it sharply as it enters',
    aim_drag: 'How fast a bubble in an aim region loses momentum (times |a|): slow ones stall there, fast ones get through',
  },
  rest: [...MOMENTUM_BUBBLES_4.rest, 0, 0],
  seed: [...MOMENTUM_BUBBLES_4.seed, null, null],
  seedNoise: [...MOMENTUM_BUBBLES_4.seedNoise, 0, 0],
  formula: MOMENTUM_BUBBLES_4.formula
    .replace('delta_px = -carry*div_px', `// aim: the momentum turned toward the aim's direction, keeping its size; bled by aim_drag
float al = sqrt(ax*ax + ay*ay);
float pl = sqrt(px*px + py*py);
float tx = pl*ax/max(al, 1e-6);
float ty = pl*ay/max(al, 1e-6);
delta_px = aim_rate*al*(tx - px) - aim_drag*al*px - carry*div_px`)
    .replace('delta_py = -carry*div_py', 'delta_py = aim_rate*al*(ty - py) - aim_drag*al*py - carry*div_py')
    .replace(/$/, '\n// the aim regions: still, as stamped\ndelta_ax = 0.0;\ndelta_ay = 0.0;'),
  view: { ...MOMENTUM_BUBBLES_4.view, customOff: [...MOMENTUM_BUBBLES_4.view.customOff!, 'ay'] },
};

/**
 * Momentum Bubbles 9 (speed kept): version 8, with the momentum's size carried as a reagent of its own, s (a bubble's
 * speed, as content: s = m·|v|), carried and spread as content is, so it moves and joins with the bubble. p is rescaled
 * toward s along its own direction (renorm): directions averaging inside a bubble (its front turned by an aim region,
 * its back not yet) no longer shrink it, so a corner keeps the speed. Aim turns p toward s along a. When bubbles meet
 * head on their p cancels but their s adds; s eases toward |p| (s_relax), so such a collision still loses speed, slowly.
 * Push sets s with p. Found: the corner keeps the speed (momentum 124 in, 146 out). Moving bubbles still go soft and
 * stretch (their content ends up in a widening rim, ~14% in the sea), as in versions 3 and 4, losing ~1/3 of what's
 * inside in 3000 steps at 0.06 px a step; m_floor (the velocity's content floor) isn't the cause.
 */
export const MOMENTUM_BUBBLES_9: RuleDef = {
  ...MOMENTUM_BUBBLES_8,
  name: 'Momentum Bubbles 9 (speed kept)',
  description: MOMENTUM_BUBBLES_8.description + ' The speed s (the momentum\'s size, carried as content is) keeps a turned bubble going as fast.',
  reagents: [...MOMENTUM_BUBBLES_8.reagents, 's', 'gs', 'sphi'],
  params: [
    ...MOMENTUM_BUBBLES_8.params,
    { name: 'renorm', value: 0.1, min: 0, max: 1 },
    { name: 's_relax', value: 0.001, min: 0, max: 0.05 },
    { name: 'm_floor', value: 0.1, min: 0.0001, max: 0.5 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_8.paramHints,
    renorm: 'How fast the momentum is rescaled to the speed s along its own direction: directions mixing inside a bubble don\'t slow it',
    m_floor: 'Content below which a cell\'s velocity (p/m) is reckoned as if it had this much: too high and a bubble\'s thin tail moves slower than the bubble and is left behind (a wake)',
    s_relax: 'How fast the speed s eases toward the momentum\'s actual size: where momenta cancel (head-on collisions) the speed fades at this rate',
  },
  rest: [...MOMENTUM_BUBBLES_8.rest, 0, 0, 0],
  seed: [...MOMENTUM_BUBBLES_8.seed, null, null, null],
  seedNoise: [...MOMENTUM_BUBBLES_8.seedNoise, 0, 0, 0],
  momentum: { ...MOMENTUM_BUBBLES_8.momentum!, size: 's' },
  formula: MOMENTUM_BUBBLES_8.formula.replace(/max\((\w+), 0\.1\)/g, 'max($1, m_floor)')
    .replace('float tx = pl*ax/max(al, 1e-6);\nfloat ty = pl*ay/max(al, 1e-6);', `float tx = s*ax/max(al, 1e-6);
float ty = s*ay/max(al, 1e-6);
// and rescaled to the speed s along its own direction
float rx = s*px/max(pl, 1e-3) - px;
float ry = s*py/max(pl, 1e-3) - py;`)
    .replace('delta_px = aim_rate*al*(tx - px)', 'delta_px = renorm*rx + aim_rate*al*(tx - px)')
    .replace('delta_py = aim_rate*al*(ty - py)', 'delta_py = renorm*ry + aim_rate*al*(ty - py)')
    .replace(/$/, `
// the speed: carried, spread and held in as content is; easing toward the momentum's size
float div_s = max(vx, 0.0)*s + min(evx, 0.0)*east_s - max(wvx, 0.0)*west_s - min(vx, 0.0)*s + max(vy, 0.0)*s + min(nvy, 0.0)*north_s - max(svy, 0.0)*south_s - min(vy, 0.0)*s;
delta_s = -carry*div_s + D_m*0.5*(laplacian_gs + g*laplacian_s - s*laplacian_g) - m_inward*0.5*(laplacian_sphi - phi*laplacian_s + s*laplacian_phi) + s_relax*(pl - s);
delta_gs = (g*s - gs)/timestep;
delta_sphi = (s*phi - sphi)/timestep;`),
  view: { ...MOMENTUM_BUBBLES_8.view, customOff: [...MOMENTUM_BUBBLES_8.view.customOff!, 'gs', 'sphi'] },
};

/**
 * Momentum Bubbles 10 (catch and launch): version 9, with aim regions driving a bubble toward a target velocity rather
 * than turning it: a is the exit velocity (aim_speed·a: its direction where to go, its length how fast; Dan's complex
 * number). Motion off the aim's direction is braked (brake), whichever way a bubble came from; along it, a bubble going
 * faster than the target is braked too, and one going slower is pushed (accel, gently). With accel gentler than brake a
 * bubble is caught first and launched after, so it leaves the same way at the same speed however it came in. Inside a
 * region the speed s follows the bubble's actual speed (its rescaling of p is off there). Found: a dot heading right
 * into a region aimed down is caught at the region's edge and leaves straight down at 0.06 (momentum 124 in, 124
 * out); one going right at 0.1 through a region aimed right leaves at 0.065. Afterwards dots still soften (as version 9).
 */
export const MOMENTUM_BUBBLES_10: RuleDef = {
  ...MOMENTUM_BUBBLES_9,
  name: 'Momentum Bubbles 10 (catch and launch)',
  description: MOMENTUM_BUBBLES_9.description.replace(/ Aim \(ax, ay; y up\):.*?stall\)\./, ' Aim (ax, ay; y up): still regions that set the velocity of bubbles passing through: '
    + 'motion off its direction is braked, motion along it brought to aim_speed × |a|, so bubbles are caught and launched.'),
  params: [
    ...MOMENTUM_BUBBLES_9.params.filter((q) => q.name !== 'aim_rate' && q.name !== 'aim_drag'),
    { name: 'aim_speed', value: 0.06, min: 0, max: 0.1 },
    { name: 'brake', value: 0.05, min: 0, max: 0.5 },
    { name: 'accel', value: 0.005, min: 0, max: 0.1 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_9.paramHints,
    aim_speed: 'Exit speed (cells a step) for an aim of length 1: a region sends bubbles along a at aim_speed × |a|',
    brake: 'How fast a region brakes motion off its direction, and motion along it that\'s too fast',
    accel: 'How fast a region pushes a bubble going too slowly along its direction up to speed: gentler than brake, so bubbles are caught before they\'re launched',
  },
  formula: MOMENTUM_BUBBLES_9.formula
    .replace('float rx = s*px/max(pl, 1e-3) - px;', `// aim: the target velocity aim_speed·a (y up); in a region (on, from |a|), motion off its direction braked, along it
// braked if too fast, pushed (accel) if too slow
float on = min(al/0.1, 1.0);
float ux = ax/max(al, 1e-6);
float uy = ay/max(al, 1e-6);
float along = px*ux + py*uy;
float perpx = px - along*ux;
float perpy = py - along*uy;
float dal = along - m*aim_speed*al;
float d_along = -(brake*max(dal, 0.0) + accel*min(dal, 0.0));
float rx = s*px/max(pl, 1e-3) - px;`)
    .replace('delta_px = renorm*rx + aim_rate*al*(tx - px) - aim_drag*al*px - carry*div_px', 'delta_px = (1.0 - on)*renorm*rx + on*(-brake*perpx + d_along*ux) - carry*div_px')
    .replace('delta_py = renorm*ry + aim_rate*al*(ty - py) - aim_drag*al*py - carry*div_py', 'delta_py = (1.0 - on)*renorm*ry + on*(-brake*perpy + d_along*uy) - carry*div_py')
    .replace('+ s_relax*(pl - s);', '+ s_relax*(pl - s) + on*brake*(pl - s);'),
};

/**
 * Momentum Bubbles 11 (track): version 10, with aim (|a|, a region's strength) kept as a reagent to see by: the custom
 * palette shows it however the regions point (ax, ay go negative). For the square track: four regions at a square's
 * corners, each launching the dots it catches on to the next. Found: a dot of radius 0.05 (~13 cells) laps a 77-cell
 * square in ~7000 steps keeping ~87% of its content, about 2.5 laps before it's too soft; one of 0.03 comes apart
 * before the second gate (small dots soften much faster), though its content still goes round as a cloud.
 */
export const MOMENTUM_BUBBLES_11: RuleDef = {
  ...MOMENTUM_BUBBLES_10,
  name: 'Momentum Bubbles 11 (track)',
  reagents: [...MOMENTUM_BUBBLES_10.reagents, 'aim'],
  rest: [...MOMENTUM_BUBBLES_10.rest, 0],
  seed: [...MOMENTUM_BUBBLES_10.seed, null],
  seedNoise: [...MOMENTUM_BUBBLES_10.seedNoise, 0],
  formula: MOMENTUM_BUBBLES_10.formula + '\n// the regions\' strength, to see them by\ndelta_aim = (al - aim)/timestep;',
  view: { ...MOMENTUM_BUBBLES_10.view, customOff: [...MOMENTUM_BUBBLES_10.view.customOff!.filter((r) => r !== 'ay'), 'ax', 'ay', 's', 'py'] },
};

/**
 * Momentum Bubbles 12 (soft gates): version 11, with a gate's soft edge gripping more gently rather than aiming
 * slower. Before, the target speed was aim_speed·|a| while the grip was full from |a| = 0.1, so a bubble crossing a
 * gate's soft edge (|a| fading from 1 to 0) was braked toward almost nothing, losing about half its speed at each gate
 * on the track. Now |a| (up to 1) sets the grip (every rate times it), and the target speed is aim_speed, faster only
 * for |a| over 1. Found: on the round-gate track a dot keeps ~0.05 px a step round three corners (~5000 steps), but it
 * clips each gate's edge rather than going through it, so only part of it turns: it shears into a sausage at each
 * corner and tears at the third. Bubbles need to turn as a whole (momentum shared across a bubble faster).
 */
export const MOMENTUM_BUBBLES_12: RuleDef = {
  ...MOMENTUM_BUBBLES_11,
  name: 'Momentum Bubbles 12 (soft gates)',
  formula: MOMENTUM_BUBBLES_11.formula
    .replace('float on = min(al/0.1, 1.0);', '// the grip: up to 1 with |a| (a soft edge grips gently); the target speed aim_speed, faster for |a| over 1\nfloat on = min(al, 1.0);')
    .replace('float dal = along - m*aim_speed*al;', 'float dal = along - m*aim_speed*max(al, 1.0);'),
  paramHints: {
    ...MOMENTUM_BUBBLES_11.paramHints,
    aim_speed: 'Exit speed (cells a step): a region sends bubbles along a at aim_speed (faster where |a| is over 1; where it\'s under 1, as at a soft edge, it grips more gently)',
  },
};

/**
 * Momentum Bubbles 13 (trap): version 12, with a trap that collects bubbles and lets them go once it's full enough. The
 * trap (a still field, stamped as a smooth round hill) brakes everything in it whichever way it's going (trap_brake)
 * and draws it in up its slope (trap_pull), so bubbles slow, drift inward and stop. It senses how full it is: sense
 * eases toward phi inside it while spreading fast within it (and not out of it), so each cell holds about the whole
 * trap's share of bubble. full is a switch with two settled states: thrown once the share passes about full_at, and
 * back only once it falls below again. While full the trap lets go (no braking or pull) and any aim stamped inside it
 * (held off until then) launches what it collected. Found (Contraptions 14): three dots run a Hilbert track into the
 * trap and merge there; at full_at 0.6 it flips once all three are in (~58000 steps), launches the blob east (round
 * the frame into the first gate), flips back, and the blob runs the curve again and is caught again (~128000): a
 * repeating collect-and-release. A piece (~1/4) stays behind at each release.
 */
export const MOMENTUM_BUBBLES_13: RuleDef = {
  ...MOMENTUM_BUBBLES_12,
  name: 'Momentum Bubbles 13 (trap)',
  reagents: [...MOMENTUM_BUBBLES_12.reagents, 'trap', 'sense', 'tsense', 'full'],
  rest: [...MOMENTUM_BUBBLES_12.rest, 0, 0, 0, 0],
  seed: [...MOMENTUM_BUBBLES_12.seed, null, null, null, null],
  seedNoise: [...MOMENTUM_BUBBLES_12.seedNoise, 0, 0, 0, 0],
  params: [
    ...MOMENTUM_BUBBLES_12.params,
    { name: 'trap_brake', value: 0.003, min: 0, max: 0.05 },
    { name: 'trap_pull', value: 0.001, min: 0, max: 0.01 },
    { name: 'D_sense', value: 0.2, min: 0, max: 0.24 },
    { name: 'sense_rate', value: 0.0002, min: 0, max: 0.005 },
    { name: 'full_at', value: 0.25, min: 0, max: 1 },
    { name: 'full_gain', value: 20, min: 1, max: 100 },
    { name: 'full_rate', value: 0.02, min: 0, max: 0.2 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_12.paramHints,
    trap_brake: 'How fast a trap brakes whatever is in it, whichever way it\'s going (times the trap\'s strength)',
    trap_pull: 'How hard a trap draws bubbles in, up its slope toward its middle',
    D_sense: 'How fast what a trap senses spreads through it (not out of it): faster makes every cell hold the whole trap\'s share',
    sense_rate: 'How fast a trap\'s sense follows the bubbles in it: slower averages over more of the trap',
    full_at: 'The share of a trap filled with bubble at which it switches to full and lets go',
    full_gain: 'How sharply the full switch responds: it throws at about full_at + 0.5/full_gain and goes back at about full_at − 0.5/full_gain',
    full_rate: 'How fast the full switch flips once thrown',
  },
  formula: MOMENTUM_BUBBLES_12.formula
    .replace('float on = min(al, 1.0);', `// the trap: holding (until full), it brakes and draws in; any aim inside it (the release) acts once it's full
float hold = trap*(1.0 - full);
float on = min(al, 1.0)*(1.0 - hold);`)
    .replace('delta_px = (1.0 - on)*renorm*rx', 'delta_px = (1.0 - on)*(1.0 - hold)*renorm*rx - trap_brake*hold*px + trap_pull*hold*m*x_gradient_trap')
    .replace('delta_py = (1.0 - on)*renorm*ry', 'delta_py = (1.0 - on)*(1.0 - hold)*renorm*ry - trap_brake*hold*py + trap_pull*hold*m*y_gradient_trap')
    .replace('+ on*brake*(pl - s);', '+ on*brake*(pl - s) - trap_brake*hold*s;')
    + `
// the trap: still, as stamped
delta_trap = 0.0;
// what it senses: the share of it the bubbles fill, spread fast within it (and not out of it), so each cell holds about
// the whole trap's share
delta_sense = D_sense*0.5*(laplacian_tsense + trap*laplacian_sense - sense*laplacian_trap) + sense_rate*trap*(phi - sense);
delta_tsense = (trap*sense - tsense)/timestep;
// full: a switch settling at 0 or 1, thrown once the share passes full_at, back once it falls below
float lam = clamp(full_gain*(sense - full_at), -0.6, 0.6);
// (and nudged off 0 or 1 once the share is past either way, as those are resting points too)
delta_full = full_rate*trap*(full*(1.0 - full)*(full - 0.5 + lam) + max(lam - 0.5, 0.0)*(1.0 - full) + min(lam + 0.5, 0.0)*full);`,
  view: { ...MOMENTUM_BUBBLES_12.view, customOff: [...MOMENTUM_BUBBLES_12.view.customOff!, 'tsense', 'sense'] },
};

/**
 * Momentum Bubbles 14 (drawing trap): version 13, with a trap's release (any aim stamped inside it) held off wherever
 * the trap reaches at all (from 0.05 of its strength) until it's full, rather than in proportion to its strength: so a
 * trap can be a smooth hill all the way to its middle, whose slope (and so its pull) reaches everywhere in it, drawing
 * bubbles to its middle, without its release acting on the faint outskirts. Pull stronger (trap_pull 0.002).
 */
export const MOMENTUM_BUBBLES_14: RuleDef = {
  ...MOMENTUM_BUBBLES_13,
  name: 'Momentum Bubbles 14 (drawing trap)',
  params: MOMENTUM_BUBBLES_13.params.map((q) => (q.name === 'trap_pull' ? { ...q, value: 0.002 } : q)),
  formula: MOMENTUM_BUBBLES_13.formula.replace(
    'float on = min(al, 1.0)*(1.0 - hold);',
    '// (the release held off wherever the trap reaches, until it\'s full)\nfloat on = min(al, 1.0)*(1.0 - smoothstep(0.0, 0.05, trap)*(1.0 - full));',
  ),
};

/**
 * Momentum Bubbles 15 (funnel trap): version 14, with a trap that steers rather than brakes and pulls. Before, its
 * braking and its pull both faded with its strength, so bubbles that slowed near a trap's faint edge sat there. Now,
 * everywhere it reaches (from 0.02 of its strength), a trap brings bubbles toward a velocity up its slope (to its
 * middle) at trap_speed, easing to nothing at its middle (trap_speed·(1 − trap)), at rate trap_brake: a funnel that
 * draws in whatever is near and stops it in the middle, whichever way it came. Inside any region or trap the speed s
 * follows the bubble's actual speed quickly (at renorm), so what leaves one keeps the speed it leaves with. All a trap
 * does happens where it reaches (reach: from 0.01 of its strength): its sense spreads evenly over all of that and its
 * switch is thrown across all of it, so when it's full the whole of it lets go (before, its faint edge never heard,
 * and held a launched blob back). And a full trap uses up what it sensed (sense_drain), so it closes again once its
 * batch has left rather than staying open while dots stream through, and counts afresh. It counts over all it reaches
 * (small dots don't clump in its middle but keep apart round it, each starving the next), slowly enough (sense_rate
 * 0.0003) that the count spreads evenly over it; and it's a floodgate: it opens once the count passes full_at and stays open until it falls
 * to empty_at, so a passing dot's bump can't open a patch of it, and once open it lets all it gathered go.
 */
export const MOMENTUM_BUBBLES_15: RuleDef = {
  ...MOMENTUM_BUBBLES_14,
  name: 'Momentum Bubbles 15 (funnel trap)',
  reagents: [...MOMENTUM_BUBBLES_14.reagents, 'reach'],
  rest: [...MOMENTUM_BUBBLES_14.rest, 0],
  seed: [...MOMENTUM_BUBBLES_14.seed, null],
  seedNoise: [...MOMENTUM_BUBBLES_14.seedNoise, 0],
  view: { ...MOMENTUM_BUBBLES_14.view, customOff: [...MOMENTUM_BUBBLES_14.view.customOff!, 'reach'] },
  params: [
    ...MOMENTUM_BUBBLES_14.params.filter((q) => q.name !== 'trap_pull').map((q) => (q.name === 'trap_brake' ? { ...q, value: 0.005 } : q.name === 'sense_rate' ? { ...q, value: 0.0003 } : q.name === 'full_gain' ? { ...q, value: 100, max: 3000 } : q)),
    { name: 'trap_speed', value: 0.02, min: 0, max: 0.1 },
    { name: 'sense_drain', value: 0.0005, min: 0, max: 0.01 },
    { name: 'empty_at', value: 0.004, min: 0, max: 1 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_14.paramHints,
    trap_brake: 'How fast a trap brings what\'s in it to its funnel velocity (in toward its middle, easing to nothing there), whichever way it was going',
    trap_speed: 'How fast a trap draws bubbles in toward its middle at its edge (cells a step): it eases to nothing at the middle',
    empty_at: 'Once open, a trap stays open until its count falls to this (below full_at): a floodgate, letting all it gathered go',
    sense_drain: 'How fast a full trap uses up what it sensed: it closes again once what it let go has left (rather than staying open while dots stream through), and counts afresh',
  },
  formula: MOMENTUM_BUBBLES_14.formula
    .replace('float hold = trap*(1.0 - full);', `float hold = reach*(1.0 - full);
// the funnel: in up the trap's slope, trap_speed at its edge, easing to nothing at its middle
float tg = sqrt(x_gradient_trap*x_gradient_trap + y_gradient_trap*y_gradient_trap);
float fv = m*trap_speed*(1.0 - min(trap, 1.0))/max(tg, 1e-6);`)
    .replace('- trap_brake*hold*px + trap_pull*hold*m*x_gradient_trap', '+ trap_brake*hold*(fv*x_gradient_trap - px)')
    .replace('- trap_brake*hold*py + trap_pull*hold*m*y_gradient_trap', '+ trap_brake*hold*(fv*y_gradient_trap - py)')
    // (and inside any region or trap, s follows the bubble's actual speed quickly, so a bubble keeps the speed it
    // leaves with: following at brake, slow now, a blob launched from a trap left with s near 0 and renorm stopped it)
    .replace('+ on*brake*(pl - s) - trap_brake*hold*s;', '+ max(on, hold)*renorm*(pl - s);')
    // (everything a trap does, where it reaches: its sense spread evenly over it and its switch thrown across all of it,
    // so when it's full the whole of it lets go: before, its faint edge never heard and held a launched blob back)
    .replace('float on = min(al, 1.0)*(1.0 - smoothstep(0.0, 0.05, trap)*(1.0 - full));', 'float on = min(al, 1.0)*(1.0 - reach*(1.0 - full));')
    .replace('D_sense*0.5*(laplacian_tsense + trap*laplacian_sense - sense*laplacian_trap)', 'D_sense*0.5*(laplacian_tsense + reach*laplacian_sense - sense*laplacian_reach)')
    .replace('delta_tsense = (trap*sense - tsense)/timestep;', 'delta_tsense = (reach*sense - tsense)/timestep;')
    // (and what it sensed used up while it's full, so it closes once its batch has left, and counts afresh)
    // (counted over all it reaches, rim too: small dots don't clump in its middle but keep apart round it, each starving
    // the next; slowly enough that the count spreads over it evenly)
    .replace('+ sense_rate*trap*(phi - sense);', '+ sense_rate*reach*(phi - sense) - sense_drain*full*sense;')
    // (a floodgate: it opens once the count passes full_at and stays open until it falls to empty_at, so a dot's
    // passing bump can't open it, and once open it lets all go)
    .replace('float lam = clamp(full_gain*(sense - full_at), -0.6, 0.6);', 'float lam = clamp(full_gain*(sense - full_at + (full_at - empty_at)*clamp(full, 0.0, 1.0)), -0.6, 0.6);')
    .replace('delta_full = full_rate*trap*(', 'delta_full = full_rate*reach*(')
    + `
// where the trap reaches (from 0.01 of its strength)
delta_reach = (smoothstep(0.0, 0.01, trap) - reach)/timestep;`,
};

/**
 * Momentum Bubbles 16 (capacitor): version 12, with a trap that soaks dots up rather than holding them (small dots
 * can't be held: stopped, they dissolve or drift apart). A trap (a still field, stamped as a smooth hill) draws bubbles
 * in gently (a funnel: in up its slope at trap_speed, easing to nothing in its middle, at rate trap_brake), and its
 * middle soaks up what reaches it (absorb): their content becomes charge, which is never lost and spreads evenly over
 * the trap and its exit (a second still field, stamped where the trap lets go), so it keeps a natural total. Once the
 * charge passes about full_at, a countdown (timer) runs in its middle; when it's done the trap fires (full, a latch
 * thrown in the middle and spreading over all of it and its exit): its charge becomes content at the exit, filled out as a bubble and already moving along the exit's aim (ax, ay) at launch,
 * until the charge falls to empty_at, when it closes and counts afresh. Also from version 15: in a region or trap the
 * speed s follows the bubble's actual speed quickly, so a bubble keeps the speed it leaves with.
 */
export const MOMENTUM_BUBBLES_16: RuleDef = {
  ...MOMENTUM_BUBBLES_12,
  name: 'Momentum Bubbles 16 (capacitor)',
  reagents: [...MOMENTUM_BUBBLES_12.reagents, 'trap', 'exit', 'reach', 'charge', 'tcharge', 'timer', 'full', 'tfull'],
  rest: [...MOMENTUM_BUBBLES_12.rest, 0, 0, 0, 0, 0, 0, 0, 0],
  seed: [...MOMENTUM_BUBBLES_12.seed, null, null, null, null, null, null, null, null],
  seedNoise: [...MOMENTUM_BUBBLES_12.seedNoise, 0, 0, 0, 0, 0, 0, 0, 0],
  params: [
    ...MOMENTUM_BUBBLES_12.params,
    { name: 'trap_brake', value: 0.005, min: 0, max: 0.05 },
    { name: 'trap_speed', value: 0.01, min: 0, max: 0.1 },
    { name: 'absorb', value: 0.01, min: 0, max: 0.1 },
    { name: 'D_charge', value: 0.2, min: 0, max: 0.24 },
    { name: 'full_at', value: 0.03, min: 0, max: 1 },
    { name: 'empty_at', value: 0.004, min: 0, max: 1 },
    { name: 'count_rate', value: 0.001, min: 0, max: 0.02 },
    { name: 'full_gain', value: 1000, min: 1, max: 3000 },
    { name: 'full_rate', value: 0.02, min: 0, max: 0.2 },
    { name: 'emit_rate', value: 0.05, min: 0, max: 0.2 },
    { name: 'emit_phi', value: 0.05, min: 0, max: 0.2 },
    { name: 'launch', value: 0.05, min: 0, max: 0.1 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_12.paramHints,
    trap_brake: 'How fast a trap brings what\'s in it to its funnel velocity (in toward its middle, easing to nothing there), whichever way it was going',
    trap_speed: 'How fast a trap draws bubbles in toward its middle at its edge (cells a step): it eases to nothing at the middle',
    absorb: 'How fast a trap\'s middle soaks up the bubbles that reach it, their content becoming its charge',
    D_charge: 'How fast a trap\'s charge spreads over it (and its exit, and nowhere else)',
    full_at: 'The charge (per cell, spread over the trap) at which a trap starts its countdown to fire: about 0.007 a dot on the Hilbert circuits',
    empty_at: 'Once firing, a trap keeps letting its charge out until it falls to this',
    count_rate: 'How fast a charged trap counts down to firing (about 1/count_rate steps)',
    full_gain: 'How sharply a firing trap closes as its charge falls to empty_at',
    full_rate: 'How fast a trap\'s full latch flips',
    emit_rate: 'How fast a firing trap lets its charge out at its exit, as content',
    emit_phi: 'How fast that content is filled out as a bubble',
    launch: 'How fast (cells a step) what a trap lets out leaves along its exit\'s aim',
  },
  formula: `// the trap (version 16, capacitor): where it reaches (tin; not over its exit) it holds bubbles in a gentle funnel until
// it fires; its middle soaks them up into charge; firing, its charge comes out at its exit as a moving bubble
float tin = smoothstep(0.0, 0.01, trap);
float hold = tin*(1.0 - full)*(1.0 - min(2.0*exit, 1.0));
float soak = absorb*smoothstep(0.3, 0.6, trap)*(1.0 - full);
float emit = emit_rate*full*exit;
float tgl = sqrt(x_gradient_trap*x_gradient_trap + y_gradient_trap*y_gradient_trap);
float fv = m*trap_speed*(1.0 - min(trap, 1.0))/max(tgl, 1e-6);
` + MOMENTUM_BUBBLES_12.formula
    .replace('delta_phi = -carry_phi*adv', 'delta_phi = -soak*phi + emit_phi*full*exit*smoothstep(0.5, 2.0, m)*(1.0 - phi) - carry_phi*adv')
    .replace('delta_m = -carry*div_m', 'delta_m = -soak*m + emit*charge - carry*div_m')
    .replace('float on = min(al, 1.0);', '// (and the gates held off where the trap holds)\nfloat on = min(al, 1.0)*(1.0 - hold);')
    .replace('delta_px = (1.0 - on)*renorm*rx', 'delta_px = (1.0 - on)*(1.0 - hold)*renorm*rx + trap_brake*hold*(fv*x_gradient_trap - px) - soak*px + emit*charge*launch*ax')
    .replace('delta_py = (1.0 - on)*renorm*ry', 'delta_py = (1.0 - on)*(1.0 - hold)*renorm*ry + trap_brake*hold*(fv*y_gradient_trap - py) - soak*py + emit*charge*launch*ay')
    .replace('+ on*brake*(pl - s);', '+ max(on, hold)*renorm*(pl - s) - soak*s + emit*charge*launch;')
    + `
// the trap and its exit: still, as stamped; reach: where either is
delta_trap = 0.0;
delta_exit = 0.0;
delta_reach = (smoothstep(0.0, 0.01, trap + exit) - reach)/timestep;
// the charge: what it soaked up, spread over all it reaches (and not out of it), let out at the exit when firing
delta_charge = D_charge*0.5*(laplacian_tcharge + reach*laplacian_charge - charge*laplacian_reach) + soak*m - emit*charge;
delta_tcharge = (reach*charge - tcharge)/timestep;
// the countdown, and the decision, in the trap's middle only (where the charge gathers): up while charged past full_at
// (not firing), back down while not; reset by firing
float core = smoothstep(0.3, 0.6, trap);
float charged = smoothstep(0.8*full_at, 1.2*full_at, charge);
delta_timer = core*(count_rate*charged*(1.0 - full)*(1.0 - timer) - count_rate*(1.0 - charged)*timer - 0.01*full*timer);
// full: a latch, thrown in the middle when the countdown's done and let go when the charge has fallen to empty_at
// (nudged off 0 and 1, which are resting points too), spreading from there over all the trap reaches and its exit, so
// they all follow the middle (deciding everywhere, the exit, drained of charge first, never fired)
float lam = clamp(mix(20.0*(timer - 0.9), full_gain*(charge - empty_at), clamp(full, 0.0, 1.0)), -0.6, 0.6);
delta_full = D_charge*0.5*(laplacian_tfull + reach*laplacian_full - full*laplacian_reach) + full_rate*core*(full*(1.0 - full)*(full - 0.5 + lam) + max(lam - 0.5, 0.0)*(1.0 - full) + min(lam + 0.5, 0.0)*full);
delta_tfull = (reach*full - tfull)/timestep;`,
  view: { ...MOMENTUM_BUBBLES_12.view, customOff: [...MOMENTUM_BUBBLES_12.view.customOff!, 'reach', 'tcharge', 'tfull'] },
};

/**
 * Momentum Bubbles 17 (gathering trap): version 15, with a trap that gathers dots into one and lets it go whole. Small
 * dots stopped in a trap faded or kept apart (each starving the next of substrate), so the trap feeds substrate
 * (trap_feed) and draws them firmly to its middle, where they touch and join. It counts what's in its middle (where the
 * joined blob sits), decides there (a floodgate: open past full_at, closed again at empty_at), and the decision spreads
 * from its middle over all of it, so it lets go as a whole (deciding everywhere, its rim, holding less, lagged).
 */
export const MOMENTUM_BUBBLES_17: RuleDef = {
  ...MOMENTUM_BUBBLES_15,
  name: 'Momentum Bubbles 17 (gathering trap)',
  reagents: [...MOMENTUM_BUBBLES_15.reagents, 'tfull'],
  rest: [...MOMENTUM_BUBBLES_15.rest, 0],
  seed: [...MOMENTUM_BUBBLES_15.seed, null],
  seedNoise: [...MOMENTUM_BUBBLES_15.seedNoise, 0],
  params: [
    ...MOMENTUM_BUBBLES_15.params.map((q) => (q.name === 'trap_speed' ? { ...q, value: 0.02 } : q)),
    { name: 'trap_feed', value: 0.05, min: 0, max: 0.5 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_15.paramHints,
    trap_feed: 'How fast a trap feeds substrate to what it holds, so small dots in it neither fade nor starve each other apart, and join',
    full_at: 'The share of a trap\'s middle filled with bubble at which it opens and lets go',
  },
  formula: MOMENTUM_BUBBLES_15.formula
    .replace('delta_u = D_u*laplacian_u', '// (fed in a trap)\ndelta_u = trap_feed*trap*(1.0 - u) + D_u*laplacian_u')
    // (counted in its middle, where the joined blob sits)
    .replace('+ sense_rate*reach*(phi - sense) - sense_drain*full*sense;', '+ sense_rate*smoothstep(0.5, 0.8, trap)*(phi - sense) - sense_drain*full*sense;')
    .replace('delta_full = full_rate*reach*(', 'delta_full = D_sense*0.5*(laplacian_tfull + reach*laplacian_full - full*laplacian_reach) + full_rate*smoothstep(0.5, 0.8, trap)*(')
    + '\n// (the decision, made in the middle, spread over all the trap)\ndelta_tfull = (reach*full - tfull)/timestep;',
  view: { ...MOMENTUM_BUBBLES_15.view, customOff: [...MOMENTUM_BUBBLES_15.view.customOff!, 'tfull'] },
};

/**
 * Momentum Bubbles 18 (launching trap): version 17, with a cleaner launch. In 17 the decision spread out from the
 * trap's middle by diffusion, taking thousands of steps to reach its rim, so a launched blob was still held and drawn
 * back there, stalled at the exit, tore, and gathered everything still arriving (asked for ~5 dots, it let go ~12). Here
 * the decision (opened) floods out from the middle over all the trap within a few dozen steps (each cell the most open of
 * its neighbours, less a little), so all of it lets go at once. What it launches is marked free, the mark carried with
 * the bubble: while it lasts the trap neither holds nor draws it back, so the trap can shut again as soon as it has
 * left the middle (its count falling faster than it rises, sense_fall), braking harder (trap_brake 0.01) what comes
 * next, and the mark wears off once the bubble is out of the trap's reach (free_decay).
 */
export const MOMENTUM_BUBBLES_18: RuleDef = {
  ...MOMENTUM_BUBBLES_17,
  name: 'Momentum Bubbles 18 (launching trap)',
  reagents: [...MOMENTUM_BUBBLES_17.reagents, 'opened', 'free', 'gfree'],
  rest: [...MOMENTUM_BUBBLES_17.rest, 0, 0, 0],
  seed: [...MOMENTUM_BUBBLES_17.seed, null, null, null],
  seedNoise: [...MOMENTUM_BUBBLES_17.seedNoise, 0, 0, 0],
  params: [
    ...MOMENTUM_BUBBLES_17.params.map((q) => (q.name === 'trap_brake' ? { ...q, value: 0.01 } : q)),
    { name: 'sense_fall', value: 0.02, min: 0, max: 0.1 },
    { name: 'free_decay', value: 0.01, min: 0, max: 0.1 },
  ],
  paramHints: {
    ...MOMENTUM_BUBBLES_17.paramHints,
    sense_fall: 'How fast a trap\'s count falls once its middle empties (faster than it rises, so it shuts soon after letting go)',
    free_decay: 'How fast the free mark wears off a launched bubble once it\'s out of the trap\'s reach (inside it, 1/20 of this)',
  },
  view: { ...MOMENTUM_BUBBLES_17.view, customOff: [...MOMENTUM_BUBBLES_17.view.customOff!, 'gfree'] },
  formula: MOMENTUM_BUBBLES_17.formula
    // (held and released by opened, the decision flooded out from the middle)
    // (and a bubble marked free, launched, not held)
    .replace('float hold = reach*(1.0 - full);', 'float fr = min(free, 1.0);\nfloat hold = reach*(1.0 - opened)*(1.0 - fr);')
    .replace('float on = min(al, 1.0)*(1.0 - reach*(1.0 - full));', 'float on = min(al, 1.0)*(1.0 - reach*(1.0 - opened)*(1.0 - fr));')
    // (counted in its middle, rising at sense_rate, falling at sense_fall)
    .replace('+ sense_rate*smoothstep(0.5, 0.8, trap)*(phi - sense)', '+ smoothstep(0.5, 0.8, trap)*(sense_rate*max(phi - sense, 0.0) + sense_fall*min(phi - sense, 0.0))')
    + `
// opened: the decision, made in the middle (full there), flooding out over all the trap within a few dozen steps (each
// cell the most open of its neighbours, less a little), and ebbing as fast once the middle closes
delta_opened = (reach*max(smoothstep(0.5, 0.8, trap)*smoothstep(0.5, 0.9, full), max(max(north_opened, south_opened), max(east_opened, west_opened)) - 0.01) - opened)/timestep;
// free: marked on what an open trap launches, carried with the bubble (upwind, as phi) and spread through it as content
// is (held in at its edge: wiped at the edge, it drained out of a blob in ~70 steps), wearing off at free_decay once out
// of the trap's reach (1/20 of that in it)
float advf = max(vx, 0.0)*(free - west_free) + min(vx, 0.0)*(east_free - free) + max(vy, 0.0)*(free - south_free) + min(vy, 0.0)*(north_free - free);
delta_free = -carry_phi*advf + D_m*0.5*(laplacian_gfree + g*laplacian_free - free*laplacian_g) + 0.05*opened*smoothstep(0.3, 0.7, phi)*(1.0 - free) - free_decay*(1.0 - 0.95*reach)*free;
delta_gfree = (g*free - gfree)/timestep;`,
};

/**
 * Mud cracking: a drying layer stuck to its bed, as phase-field fracture (Francfort–Marigo / Bourdin; the AT1
 * threshold form of Pham et al.). Moisture m evaporates and the layer wants to shrink by shrink·(1 − m); its
 * displacement (ux, uy) relaxes towards balance against a spring to the bed (grip), so stress builds as it dries.
 * Damage d (0 intact, 1 cracked) grows where the stored stretch energy beats the toughness, never heals, and softens
 * the layer by g = (1 − d)², relieving the stress beside a crack: later cracks run into earlier ones at right angles.
 * The stress (sxx, syy, sxy) is kept as reagents so its divergence can be taken with the same gradients as the strain
 * (so the force is the energy's own, and cracks don't creep open); stab adds smoothing against the chequered modes
 * those gradients can't see, which would otherwise draw cracks along the diagonals (still seen with strong grip). q is a fixed disorder in toughness, so cracks start at weak spots. Cracks are smooth bands about crack_width cells wide.
 */
export const MUD_CRACKS: RuleDef = {
  name: 'Mud cracks',
  description:
    'A drying layer on a bed, as phase-field fracture: moisture m dries (dry), the layer shrinks with it (shrink), its displacement ux, uy ' +
    'relaxes against the stress and a spring to the bed (grip), and damage d grows where the stretch energy beats the toughness (AT1), ' +
    'softening the layer by (1 − d)². Cracks form in sequence, later ones meeting earlier ones at right angles. Paint dry to dry it ' +
    'where you like, grip to change the polygons\' size (stronger grip, smaller polygons) and toughness to make it harder to crack.',
  reagents: ['m', 'd', 'ux', 'uy', 'sxx', 'syy', 'sxy', 'q'],
  params: [
    { name: 'timestep', value: 0.08, min: 0, max: 0.15 },
    { name: 'dx', value: 1, min: 0.5, max: 2 },
    { name: 'dry', value: 0.0001, min: 0, max: 0.001 },
    { name: 'D_m', value: 0.3, min: 0, max: 1 },
    { name: 'shrink', value: 0.12, min: 0, max: 0.3 },
    { name: 'grip', value: 0.001, min: 0, max: 0.02 },
    { name: 'toughness', value: 0.04, min: 0.005, max: 0.2 },
    { name: 'crack_width', value: 1, min: 0.6, max: 4 },
    { name: 'crack_rate', value: 10, min: 0, max: 40 },
    { name: 'lam', value: 1, min: 0, max: 3 },
    { name: 'mu', value: 1, min: 0.2, max: 3 },
    { name: 'stab', value: 1.5, min: 0, max: 3 },
    { name: 'wet_cracks', value: 4, min: 0, max: 20 },
  ],
  paramHints: {
    dry: 'How fast the moisture evaporates (paint it to dry some places first; slower drying, longer straighter cracks)',
    D_m: 'How fast moisture spreads through the layer',
    shrink: 'How much the layer shrinks when fully dry',
    grip: 'The spring tying the layer to its bed: stronger grip, smaller polygons',
    toughness: 'How much stretch energy a crack takes (times the fixed disorder q)',
    crack_width: 'The width of a crack, in cells',
    crack_rate: 'How fast damage grows once over the threshold',
    lam: 'Lamé λ: resistance to change in area',
    mu: 'Shear modulus: resistance to change in shape',
    stab: 'Extra smoothing of the displacement: keeps the grid from going chequered and cracks from favouring the diagonals',
    wet_cracks: 'How much faster a crack dries than intact layer',
  },
  paintable: ['dry', 'grip', 'toughness'],
  explore: ['grip', 'toughness', 'shrink'],
  formula: `float4 mm = clamp(m, 0.0, 1.0);
float4 e0 = shrink*(1.0 - mm);
float4 ax = x_gradient_ux + e0;
float4 ay = y_gradient_uy + e0;
float4 exy = 0.5*(x_gradient_uy + y_gradient_ux);
float4 tr = ax + ay;
float4 g = (1.0 - d)*(1.0 - d) + 0.001;
delta_sxx = (g*(lam*tr + 2.0*mu*ax) - sxx)/timestep;
delta_syy = (g*(lam*tr + 2.0*mu*ay) - syy)/timestep;
delta_sxy = (g*2.0*mu*exy - sxy)/timestep;
delta_ux = x_gradient_sxx + y_gradient_sxy + stab*mu*g*laplacian_ux - grip*ux;
delta_uy = x_gradient_sxy + y_gradient_syy + stab*mu*g*laplacian_uy - grip*uy;
float4 trp = max(tr, 0.0);
float4 H = 0.5*lam*trp*trp + mu*(ax*ax + ay*ay + 2.0*exy*exy);
float4 drive = 2.0*(1.0 - d)*H - toughness*q*(0.375/crack_width - 0.75*crack_width*laplacian_d);
delta_d = min(crack_rate*max(drive, 0.0), (1.0 - d)/timestep);
delta_m = D_m*laplacian_m - dry*mm*(1.0 + wet_cracks*d);
delta_q = 0.0;`,
  rest: [1, 0, 0, 0, 0, 0, 0, 1],
  seed: [1, 0, null, null, null, null, null, null],
  seedNoise: [0, 0, 0, 0, 0, 0, 0, 0],
  initial: [
    { chem: 'm', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
    { chem: 'q', op: 'overwrite', fill: { type: 'white_noise', low: 0.85, high: 1.15 }, shape: { type: 'everywhere' } },
  ],
  view: { reagent: 'd', low: 0, high: 1, stepsPerFrame: 200 },
};

export const BUILTIN_RULES = [GRAY_SCOTT, GS_HISTORY_WAVE, GS_HW_MEMORY, PHYLLOTAXIS, OREGONATOR, KLEIN_GORDON, SWIFT_HOHENBERG_FB, NEURAL_FIELD, SATURABLE_NLS, GRAY_SCOTT_ZOOM, GS_FLECK, META_GS, WEATHER_GS, GS_LINEAGES, GS_SELECTION, GS_SPECIES, GS_NICHES, GS_HW_NICHES, GS_BUBBLES, PF_BUBBLES, PF_BUBBLES_1, PF_BUBBLES_3, PF_BUBBLES_4, PF_BUBBLES_5, PF_BUBBLES_6, PF_BUBBLES_7, PF_BUBBLES_8, PF_BUBBLES_9, PF_BUBBLES_10, PF_BUBBLES_11, PF_BUBBLES_12, PF_BUBBLES_13, SMOKE, SMOKE_SMOOTH, SMOKE_WIDE, SMOKE_GS, SMOKE_HW, SMOKE_HISTORY, SMOKE_HISTORY_WAVE, SMOKE_HISTORY_WAVE_2, MOMENTUM_BUBBLES, MOMENTUM_BUBBLES_2, MOMENTUM_BUBBLES_3, MOMENTUM_BUBBLES_4, MOMENTUM_BUBBLES_5, MOMENTUM_BUBBLES_6, MOMENTUM_BUBBLES_7, MOMENTUM_BUBBLES_8, MOMENTUM_BUBBLES_9, MOMENTUM_BUBBLES_10, MOMENTUM_BUBBLES_11, MOMENTUM_BUBBLES_12, MOMENTUM_BUBBLES_13, MOMENTUM_BUBBLES_14, MOMENTUM_BUBBLES_15, MOMENTUM_BUBBLES_16, MOMENTUM_BUBBLES_17, MOMENTUM_BUBBLES_18, MUD_CRACKS];

/** The Rules menu's families, in menu order (each built-in rule in one; scenes join their rule's family). */
export const RULE_FAMILIES: [string, RuleDef[]][] = [
  ['Gray-Scott', [GRAY_SCOTT, GRAY_SCOTT_ZOOM, GS_FLECK, GS_BUBBLES]],
  ['Bubbles', [PF_BUBBLES_1, PF_BUBBLES, PF_BUBBLES_3, PF_BUBBLES_4, PF_BUBBLES_5, PF_BUBBLES_6, PF_BUBBLES_7, PF_BUBBLES_8, PF_BUBBLES_9, PF_BUBBLES_10, PF_BUBBLES_11, PF_BUBBLES_12, PF_BUBBLES_13]],
  ['History + Wave', [GS_HISTORY_WAVE, GS_HW_MEMORY]],
  ['Parameters as fields', [META_GS, WEATHER_GS]],
  ['Heredity', [GS_LINEAGES, GS_SELECTION, GS_SPECIES, GS_NICHES, GS_HW_NICHES]],
  ['Waves & solitons', [SATURABLE_NLS, KLEIN_GORDON]],
  ['Smoke', [SMOKE, SMOKE_SMOOTH, SMOKE_WIDE, SMOKE_HISTORY, SMOKE_HISTORY_WAVE, SMOKE_HISTORY_WAVE_2, SMOKE_GS, SMOKE_HW]],
  ['Contraptions', [MOMENTUM_BUBBLES, MOMENTUM_BUBBLES_2, MOMENTUM_BUBBLES_3, MOMENTUM_BUBBLES_4, MOMENTUM_BUBBLES_5, MOMENTUM_BUBBLES_6, MOMENTUM_BUBBLES_7, MOMENTUM_BUBBLES_8, MOMENTUM_BUBBLES_9, MOMENTUM_BUBBLES_10, MOMENTUM_BUBBLES_11, MOMENTUM_BUBBLES_12, MOMENTUM_BUBBLES_13, MOMENTUM_BUBBLES_14, MOMENTUM_BUBBLES_15, MOMENTUM_BUBBLES_16, MOMENTUM_BUBBLES_17, MOMENTUM_BUBBLES_18]],
  ['Other media', [OREGONATOR, NEURAL_FIELD, SWIFT_HOHENBERG_FB, PHYLLOTAXIS, MUD_CRACKS]],
];

export function defaultGlobals(rule: RuleDef): Record<string, number> {
  return Object.fromEntries(rule.params.map((p) => [p.name, p.value]));
}
