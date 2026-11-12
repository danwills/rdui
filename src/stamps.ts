/**
 * Stamps: captured rectangles of field (params + walls + chemistry) that can be
 * transformed and placed elsewhere — the unit of reusable contraption.
 */

export interface Stamp {
  id: string;
  name: string;
  w: number;
  h: number;
  /** 4 floats per cell: feed, kill, diffusionScale, wall. */
  params: Float32Array;
  /** 2 floats per cell: u, v. */
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
  const params = new Float32Array(W * H * 4);
  const state = new Float32Array(W * H * 2);
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
      params.set(s.params.subarray(src * 4, src * 4 + 4), dst * 4);
      state.set(s.state.subarray(src * 2, src * 2 + 2), dst * 2);
    }
  }
  return { ...s, w: W, h: H, params, state };
}

/** Small preview image: chemistry brightness over a dim parameter-map tint, walls hatched grey. */
export function stampThumbnail(s: Stamp, maxSide = 72): HTMLCanvasElement {
  const img = new ImageData(s.w, s.h);
  for (let i = 0; i < s.w * s.h; i++) {
    const f = s.params[i * 4], k = s.params[i * 4 + 1], d = s.params[i * 4 + 2], wall = s.params[i * 4 + 3];
    const v = Math.min(1, s.state[i * 2 + 1] * 2.5);
    let r: number, g: number, b: number;
    if (wall > 0.5) {
      const stripe = ((i % s.w) + Math.floor(i / s.w)) % 4 < 2;
      r = g = b = stripe ? 90 : 110;
    } else {
      const tr = (f / 0.1) * 60, tg = ((k - 0.03) / 0.045) * 60, tb = (d / 1.2) * 60;
      r = tr + v * 200;
      g = tg + v * 220;
      b = tb + 20 + v * 235;
    }
    img.data.set([r, g, b, 255], i * 4);
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
}

export function stampToJSON(s: Stamp): StampJSON {
  return { id: s.id, name: s.name, w: s.w, h: s.h, params: f32ToB64(s.params), state: f32ToB64(s.state) };
}

export function stampFromJSON(j: StampJSON): Stamp {
  const s = { id: j.id || newStampId(), name: j.name, w: j.w, h: j.h, params: b64ToF32(j.params), state: b64ToF32(j.state) };
  if (s.params.length !== s.w * s.h * 4 || s.state.length !== s.w * s.h * 2) throw new Error(`stamp ${j.name}: bad size`);
  return s;
}

// --- library

const STORAGE_KEY = 'rdui.stamps.v1';

/** Ordered collection of stamps, persisted to localStorage when possible. */
export class StampLibrary {
  stamps: Stamp[] = [];
  onChange?: () => void;
  /** Set when the last save failed (e.g. quota). */
  saveError: string | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.stamps = (JSON.parse(raw) as StampJSON[]).map(stampFromJSON);
    } catch (e) {
      console.warn('could not load stamp library', e);
    }
  }

  get(id: string | null) {
    return this.stamps.find((s) => s.id === id);
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
