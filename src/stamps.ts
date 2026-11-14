/**
 * Stamps: captured rectangles of field (params + walls + chemistry) that can be
 * transformed and placed elsewhere — the unit of reusable contraption.
 */

export interface Stamp {
  id: string;
  name: string;
  w: number;
  h: number;
  /** Rule it was captured from (informational; placement matches by name). */
  rule: string;
  reagents: string[];
  /** Per-cell param names, [0] = 'wall'. */
  paramNames: string[];
  /** vec4s per cell in `state` / `params`. */
  S: number;
  P: number;
  params: Float32Array;
  state: Float32Array;
}

export interface Transform {
  /** Quarter turns clockwise, 0–3. */
  rot: number;
  /** Mirror horizontally (applied before rotation). */
  flip: boolean;
}

export function newStampId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Return a copy of the stamp with the transform baked in. */
export function transformStamp(s: Stamp, t: Transform): Stamp {
  const rot = ((t.rot % 4) + 4) % 4;
  if (rot === 0 && !t.flip) return s;
  const W = rot % 2 ? s.h : s.w;
  const H = rot % 2 ? s.w : s.h;
  const params = new Float32Array(W * H * s.P * 4);
  const state = new Float32Array(W * H * s.S * 4);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const sx = t.flip ? s.w - 1 - x : x;
      let dx: number, dy: number;
      switch (rot) {
        case 0: dx = x; dy = y; break;
        case 1: dx = s.h - 1 - y; dy = x; break;
        case 2: dx = s.w - 1 - x; dy = s.h - 1 - y; break;
        default: dx = y; dy = s.w - 1 - x; break;
      }
      const src = y * s.w + sx;
      const dst = dy * W + dx;
      const ps = s.P * 4, ss = s.S * 4;
      params.set(s.params.subarray(src * ps, src * ps + ps), dst * ps);
      state.set(s.state.subarray(src * ss, src * ss + ss), dst * ss);
    }
  }
  return { ...s, w: W, h: H, params, state };
}

/**
 * A stamp's background: the mean of its border cells per reagent. Usually the
 * rest state, but not for stamps cut from a non-rest background (e.g. U-skates,
 * which are holes in an excited field), so compositing uses this rather than
 * the rule's rest.
 */
export function stampBackground(stamp: Float32Array, w: number, h: number, S: number, n: number): number[] {
  const sum = new Array(n).fill(0);
  let count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) continue;
    for (let r = 0; r < n; r++) sum[r] += stamp[(y * w + x) * S * 4 + r];
    count++;
  }
  return sum.map((v) => v / Math.max(1, count));
}

/**
 * Composite stamp chemistry onto existing chemistry by adding the stamp's
 * deviation from its background: out = current + (stamp − background). A stamp's
 * quiet border adds ~nothing, so overlapping stamps superpose smoothly instead
 * of cutting square seams into each other. `stamp` and `current` share the
 * destination layout (S vec4s per cell); `rest` (the background) is per reagent.
 */
export function compositeOnto(current: Float32Array, stamp: Float32Array, rest: number[], S: number, cells: number) {
  const out = new Float32Array(current);
  for (let i = 0; i < cells; i++) {
    for (let r = 0; r < rest.length; r++) {
      const j = i * S * 4 + r;
      out[j] = current[j] + stamp[j] - rest[r];
    }
  }
  return out;
}

/**
 * Rotate a stamp by any angle (degrees, clockwise on screen), resampling its
 * chemistry bilinearly into a larger square that holds the rotated content.
 * Params and walls use nearest-neighbour; cells that fall outside the source
 * take the nearest edge cell, so a stamp with a quiet border stays quiet.
 * Used to aim gliders: their heading turns with the stamp.
 */
export function rotateStampBy(s: Stamp, degrees: number): Stamp {
  const a = (degrees * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const side = Math.ceil(Math.abs(s.w * c) + Math.abs(s.h * sn)) | 1;
  const W = Math.max(side, Math.ceil(Math.abs(s.w * sn) + Math.abs(s.h * c)) | 1);
  const ss = s.S * 4, ps = s.P * 4;
  const state = new Float32Array(W * W * ss), params = new Float32Array(W * W * ps);
  const cx = (s.w - 1) / 2, cy = (s.h - 1) / 2, oc = (W - 1) / 2;
  const at = (x: number, y: number) => Math.min(s.h - 1, Math.max(0, y)) * s.w + Math.min(s.w - 1, Math.max(0, x));
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      // inverse-rotate the destination cell into source coordinates
      const dx = x - oc, dy = y - oc;
      const sx = cx + c * dx + sn * dy, sy = cy - sn * dx + c * dy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const i00 = at(x0, y0), i10 = at(x0 + 1, y0), i01 = at(x0, y0 + 1), i11 = at(x0 + 1, y0 + 1);
      const dst = y * W + x;
      for (let k = 0; k < ss; k++) {
        state[dst * ss + k] =
          (s.state[i00 * ss + k] * (1 - fx) + s.state[i10 * ss + k] * fx) * (1 - fy) +
          (s.state[i01 * ss + k] * (1 - fx) + s.state[i11 * ss + k] * fx) * fy;
      }
      params.set(s.params.subarray(at(Math.round(sx), Math.round(sy)) * ps, at(Math.round(sx), Math.round(sy)) * ps + ps), dst * ps);
    }
  }
  return { ...s, w: W, h: W, params, state };
}

/**
 * Small preview image: one reagent (by name, else the second) auto-ranged to
 * the stamp's own min/max, walls hatched grey.
 */
export function stampThumbnail(s: Stamp, maxSide = 72, reagent = 'b'): HTMLCanvasElement {
  const img = new ImageData(s.w, s.h);
  let r = s.reagents.indexOf(reagent);
  if (r < 0) r = Math.min(1, s.reagents.length - 1);
  const ss = s.S * 4, ps = s.P * 4, wallSlot = s.paramNames.indexOf('wall');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s.w * s.h; i++) {
    const v = s.state[i * ss + r];
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = hi - lo > 1e-6 ? hi - lo : 1;
  for (let i = 0; i < s.w * s.h; i++) {
    const wall = wallSlot >= 0 && s.params[i * ps + wallSlot] > 0.5;
    const v = (s.state[i * ss + r] - lo) / span;
    let cr: number, cg: number, cb: number;
    if (wall) {
      const stripe = ((i % s.w) + Math.floor(i / s.w)) % 4 < 2;
      cr = cg = cb = stripe ? 90 : 110;
    } else {
      cr = 10 + v * 200;
      cg = 14 + v * 220;
      cb = 30 + v * 225;
    }
    img.data.set([cr, cg, cb, 255], i * 4);
  }
  const src = document.createElement('canvas');
  src.width = s.w;
  src.height = s.h;
  src.getContext('2d')!.putImageData(img, 0, 0);

  const scale = maxSide / Math.max(s.w, s.h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(s.w * scale));
  c.height = Math.max(1, Math.round(s.h * scale));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// --- serialization

function f32ToB64(a: Float32Array) {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToF32(s: string) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

interface StampJSON {
  id: string;
  name: string;
  w: number;
  h: number;
  params: string;
  state: string;
  // absent in v1 stamps (Gray-Scott u,v / feed,kill,diffusion,wall)
  rule?: string;
  reagents?: string[];
  paramNames?: string[];
  S?: number;
  P?: number;
}

export function stampToJSON(s: Stamp): StampJSON {
  return {
    id: s.id, name: s.name, w: s.w, h: s.h, rule: s.rule, reagents: s.reagents, paramNames: s.paramNames, S: s.S, P: s.P,
    params: f32ToB64(s.params), state: f32ToB64(s.state),
  };
}

export function stampFromJSON(j: StampJSON): Stamp {
  const cells = j.w * j.h;
  let state = b64ToF32(j.state);
  if (!j.reagents) {
    // v1: 2 floats per cell → one vec4
    const s4 = new Float32Array(cells * 4);
    for (let i = 0; i < cells; i++) s4.set(state.subarray(i * 2, i * 2 + 2), i * 4);
    state = s4;
  }
  const s: Stamp = {
    id: j.id || newStampId(), name: j.name, w: j.w, h: j.h,
    rule: j.rule ?? 'Gray-Scott',
    reagents: j.reagents ?? ['a', 'b'],
    paramNames: j.paramNames ?? ['F', 'k', 'D', 'wall'],
    S: j.S ?? 1,
    P: j.P ?? 1,
    params: b64ToF32(j.params),
    state,
  };
  if (s.params.length !== cells * s.P * 4 || s.state.length !== cells * s.S * 4) throw new Error(`stamp ${j.name}: bad size`);
  return s;
}

// --- library

const STORAGE_KEY = 'rdui.stamps.v1';

const bundledPacks = import.meta.glob('../stamps/*.json', { eager: true, import: 'default' }) as Record<string, StampJSON[]>;

/** Stamps shipped with rdui (stamps/*.json), by id. */
export const STARTER_STAMPS: Stamp[] = Object.values(bundledPacks).flat().map(stampFromJSON);

/** Ordered collection of stamps, persisted to localStorage when possible. */
export class StampLibrary {
  stamps: Stamp[] = [];
  onChange?: () => void;
  /** Set when the last save failed (e.g. quota). */
  saveError: string | null = null;

  constructor() {
    let stored = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.stamps = (JSON.parse(raw) as StampJSON[]).map(stampFromJSON);
        stored = true;
      }
    } catch (e) {
      console.warn('could not load stamp library', e);
    }
    if (!stored) this.stamps = STARTER_STAMPS.map((s) => ({ ...s }));
  }

  get(id: string | null) {
    return this.stamps.find((s) => s.id === id);
  }

  /** Add any starter stamps not already in the library; returns how many were added. */
  addStarters() {
    const have = new Set(this.stamps.map((s) => s.id));
    const missing = STARTER_STAMPS.filter((s) => !have.has(s.id));
    this.stamps.push(...missing.map((s) => ({ ...s })));
    if (missing.length) this.changed();
    return missing.length;
  }

  add(s: Stamp) {
    this.stamps.push(s);
    this.changed();
  }

  remove(id: string) {
    this.stamps = this.stamps.filter((s) => s.id !== id);
    this.changed();
  }

  rename(id: string, name: string) {
    const s = this.get(id);
    if (!s) return;
    s.name = name;
    this.changed();
  }

  /** Merge stamps from an exported library file; returns how many were added. */
  import(json: string) {
    const list = (JSON.parse(json) as StampJSON[]).map(stampFromJSON);
    const have = new Set(this.stamps.map((s) => s.id));
    let added = 0;
    for (const s of list) {
      if (have.has(s.id)) s.id = newStampId();
      this.stamps.push(s);
      added++;
    }
    this.changed();
    return added;
  }

  export() {
    return JSON.stringify(this.stamps.map(stampToJSON));
  }

  private changed() {
    try {
      localStorage.setItem(STORAGE_KEY, this.export());
      this.saveError = null;
    } catch (e) {
      this.saveError = 'stamp library too large for browser storage — export it to keep it';
      console.warn(e);
    }
    this.onChange?.();
  }
}
