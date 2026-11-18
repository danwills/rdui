import type { Overlay } from './rule';
/**
 * Scenes: small declarative setups (rule, painted regions, walls, placed
 * stamps, probes, view) kept as JSON in /scenes, loadable from the Rule menu.
 */

export interface Scene {
  name: string;
  description?: string;
  /** Rule choice id, e.g. "builtin:1" or "pattern:<name>". */
  rule: string;
  size?: number;
  /** Override global parameter values (e.g. a different medium). */
  globals?: Record<string, number>;
  /** Override the rule's paintable params. */
  paintable?: string[];
  /** "rest" = clean field at the rule's rest state; "initial" = its generator. */
  start?: 'rest' | 'initial';
  /** Replace the rule's initial generator (shapes of constant or noise values per reagent); used with start "initial". */
  initial?: Overlay[];
  /** Param values per rect [x, y, w, h]; unlisted paintables keep their global value. */
  paint?: { rect: [number, number, number, number]; values: Record<string, number> }[];
  walls?: [number, number, number, number][];
  /**
   * Distance-field walls (rules with reflect_d / absorb_d), drawn as the Wall tool draws them: a disc
   * of radius r at (x, y), or a line of that half-width on to (x2, y2). Cells.
   */
  sdf?: { field: 'absorb_d' | 'reflect_d' | 'trap_d'; x: number; y: number; x2?: number; y2?: number; r: number; cut?: boolean }[];
  /**
   * Stamps by id (bundled starter packs or the user's library), centred at x, y.
   * Only their chemistry is placed unless `params` is set (then their painted
   * params and walls come too). `boost` multiplies a wave stamp's ψ = p + iq by e^{i(phase + kx·x + ky·y)}
   * (after rot/flip): it sets off in direction (kx, ky), radians per cell, its phase turned by `phase`.
   */
  stamps?: { stamp: string; x: number; y: number; rot?: number; flip?: boolean; params?: boolean; boost?: { kx: number; ky: number; phase?: number } }[];
  /** `hold`: the probe keeps the highest reading since Restart (for a soliton that only passes through); `round`: it measures the disc inscribed in its rect. */
  probes?: { name: string; x: number; y: number; w: number; h: number; hold?: boolean; round?: boolean }[];
  view?: { reagent?: string; low?: number; high?: number; tint?: string; tintLow?: number; tintHigh?: number };
  stepsPerFrame?: number;
}

const files = import.meta.glob('../scenes/*.json', { eager: true, import: 'default' }) as Record<string, Scene>;

export const SCENES = Object.entries(files)
  .map(([path, scene]) => ({ id: path.split('/').pop()!.replace(/\.json$/, ''), scene }))
  .sort((a, b) => a.scene.name.localeCompare(b.scene.name, undefined, { numeric: true }));
