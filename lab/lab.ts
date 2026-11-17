/**
 * Lab helpers for headless experiments (driven by lab/run.mjs): build a sim
 * for a rule, place stamps, track blobs, and save annotated frames.
 */
import * as R from '../src/rule';
import { Simulation } from '../src/sim';
import { STARTER_STAMPS, compositeOnto, stampBackground, transformStamp, type Stamp } from '../src/stamps';

declare global {
  interface Window {
    __log(line: string): Promise<void>;
    __save(name: string, dataUrl: string): Promise<void>;
    __saveText(name: string, text: string): Promise<void>;
    /** The live viewer (lab/live.mjs): a snapshot of the running field, every __liveEvery steps (0: off). */
    __live?(dataUrl: string, caption: string): Promise<void>;
    __liveEvery?: number;
  }
}
export const log = (...a: unknown[]) => window.__log(a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' '));

let device: GPUDevice | null = null;
export async function gpu() {
  if (!device) {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    device = await a!.requestDevice();
    device.addEventListener('uncapturederror', (e) => log('GPU error:', (e as GPUUncapturedErrorEvent).error.message));
  }
  return device;
}

export interface Lab {
  sim: Simulation;
  rule: R.RuleDef;
  layout: R.Layout;
  globals: Record<string, number>;
  N: number;
  run(steps: number): Promise<void>;
  read(): Promise<{ params: Float32Array; state: Float32Array }>;
  paint(x: number, y: number, w: number, h: number, values: Record<string, number>): Promise<void>;
  place(stamp: Stamp, cx: number, cy: number, t?: { rot?: number; flip?: boolean; overwrite?: boolean }): Promise<void>;
}

const restCache = new Map<string, number[]>();

export async function makeLab(base: R.RuleDef, N: number, globals: Record<string, number> = {}, start: 'rest' | 'initial' = 'rest'): Promise<Lab> {
  const d = await gpu();
  const g = { ...R.defaultGlobals(base), ...globals };
  const key = base.name + JSON.stringify(g);
  let rest = restCache.get(key);
  if (!rest) {
    rest = (await Simulation.relaxRest(d, R.compileRule(base), g, base.rest)) ?? base.rest;
    restCache.set(key, rest);
  }
  const rule = { ...base, rest, restRelaxed: true };
  const c = R.compileRule(rule);
  const sim = new Simulation(d, 'rgba8unorm', N, N, c);
  for (const [k, v] of Object.entries(g)) sim.setGlobal(k, v);
  const f = start === 'rest' ? R.initialField({ ...rule, initial: [] }, N, N, g, 'rest') : R.initialField(rule, N, N, g, 'zero');
  sim.load(f.state, f.params);
  const L = c.layout;
  let stepped = 0, lastLive = 0;
  const lab: Lab = {
    sim, rule, layout: L, globals: g, N,
    async run(steps) {
      const every = window.__liveEvery ?? 0;
      for (let k = 0; k < steps; k += 250) {
        const e = d.createCommandEncoder();
        sim.step(e, Math.min(250, steps - k));
        d.queue.submit([e.finish()]);
        stepped += Math.min(250, steps - k);
        // a snapshot for the live viewer, in the rule's own view
        if (every && stepped - lastLive >= every) {
          lastLive = stepped;
          await d.queue.onSubmittedWorkDone();
          await liveFrame(lab, stepped);
        }
      }
      await d.queue.onSubmittedWorkDone();
    },
    read: () => sim.readRegion(0, 0, N, N),
    async paint(x, y, w, h, values) {
      const { params } = await sim.readRegion(x, y, w, h);
      const P4 = L.P * 4;
      for (const [n, v] of Object.entries(values)) {
        const slot = L.paramNames.indexOf(n);
        if (slot < 0) throw new Error(`${n} isn't paintable`);
        for (let i = 0; i < w * h; i++) params[i * P4 + slot] = v;
      }
      sim.writeRegion(x, y, w, h, params);
    },
    async place(stamp, cx, cy, t = {}) {
      const s = transformStamp(stamp, { rot: t.rot ?? 0, flip: t.flip ?? false });
      const st = R.remapCells(s.state, s.reagents, s.S, L.reagents, L.S, s.w * s.h, (n) => rest![rule.reagents.indexOf(n)] ?? 0);
      const x = Math.round(cx - s.w / 2), y = Math.round(cy - s.h / 2);
      const w = (v: number) => ((v % N) + N) % N;
      if (t.overwrite) return sim.writeRegion(w(x), w(y), s.w, s.h, undefined, st);
      const cur = (await sim.readRegion(w(x), w(y), s.w, s.h)).state;
      sim.writeRegion(w(x), w(y), s.w, s.h, undefined, compositeOnto(cur, st, stampBackground(st, s.w, s.h, L.S, rest!.length), L.S, s.w * s.h));
    },
  };
  return lab;
}

/** Capture a w×h stamp centred on (cx, cy). With `soft`, the deviation from
 *  rest fades to zero towards the edge of the inscribed ellipse over the
 *  outer `soft` fraction of its radius, so it composites without edges. */
export async function capture(lab: Lab, cx: number, cy: number, w: number, h: number, id: string, name: string, soft = 0): Promise<Stamp> {
  const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
  const { params, state } = await lab.sim.readRegion(((x % lab.N) + lab.N) % lab.N, ((y % lab.N) + lab.N) % lab.N, w, h);
  const L = lab.layout;
  if (soft > 0) {
    const rest = lab.rule.rest, S4 = L.S * 4;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const r = Math.hypot((i + 0.5 - w / 2) / (w / 2), (j + 0.5 - h / 2) / (h / 2));
      const t = Math.min(1, Math.max(0, (1 - r) / soft)), m = t * t * (3 - 2 * t);
      for (let k = 0; k < rest.length; k++) { const q = (j * w + i) * S4 + k; state[q] = rest[k] + (state[q] - rest[k]) * m; }
    }
  }
  return { id, name, w, h, rule: lab.rule.name, reagents: L.reagents, paramNames: L.paramNames, S: L.S, P: L.P, params, state };
}

/** Step several labs together (one submit per chunk keeps the GPU busy). */
export async function runAll(labs: Lab[], steps: number) {
  const d = await gpu();
  for (let k = 0; k < steps; k += 250) {
    const e = d.createCommandEncoder();
    for (const l of labs) l.sim.step(e, Math.min(250, steps - k));
    d.queue.submit([e.finish()]);
  }
  await d.queue.onSubmittedWorkDone();
}

/** Write chemistry values into a disk (e.g. a seed). */
export async function seedDisk(lab: Lab, cx: number, cy: number, r: number, values: Record<string, number>) {
  const x0 = Math.floor(cx - r), y0 = Math.floor(cy - r), w = Math.ceil(2 * r) + 1;
  const { state } = await lab.sim.readRegion(x0, y0, w, w);
  const S4 = lab.layout.S * 4;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    if ((x0 + x - cx) ** 2 + (y0 + y - cy) ** 2 > r * r) continue;
    for (const [n, v] of Object.entries(values)) state[(y * w + x) * S4 + lab.layout.reagents.indexOf(n)] = v;
  }
  lab.sim.writeRegion(x0, y0, w, w, undefined, state);
}

/** Paint a disk of param values. */
export async function paintDisk(lab: Lab, cx: number, cy: number, r: number, values: Record<string, number>) {
  const x0 = Math.floor(cx - r), y0 = Math.floor(cy - r), w = Math.ceil(2 * r) + 1;
  const { params } = await lab.sim.readRegion(x0, y0, w, w);
  const P4 = lab.layout.P * 4;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    if ((x0 + x - cx) ** 2 + (y0 + y - cy) ** 2 > r * r) continue;
    for (const [n, v] of Object.entries(values)) params[(y * w + x) * P4 + lab.layout.paramNames.indexOf(n)] = v;
  }
  lab.sim.writeRegion(x0, y0, w, w, params);
}

/** Absorbing frame: paint a border band where b can't survive. */
export async function absorber(lab: Lab, band: number, values: Record<string, number> = { k: 0.075 }) {
  const N = lab.N;
  await lab.paint(0, 0, N, band, values);
  await lab.paint(0, N - band, N, band, values);
  await lab.paint(0, band, band, N - 2 * band, values);
  await lab.paint(N - band, band, band, N - 2 * band, values);
}

/** Standard History+Wave medium for natural machinery: solitons bond at ~25 px,
 *  gliders fly, clusters eat/reflect, and faster-fading history calms collisions. */
export const HW_STD = { F: 0.052, k: 0.066, c_damp: 0.0009 };

export const STARTERS = (id: string) => STARTER_STAMPS.find((s) => s.id === id)!;
export const glider = () => STARTERS('starter-glider-hw');

/** elong: ratio of principal axis lengths (1 = round). */
export interface Blob { x: number; y: number; area: number; peak: number; elong: number }

/** Connected components (4-neighbour, toroidal) of reagent `ri` above `thr`; centroids unwrapped. */
export function blobs(state: Float32Array, N: number, S: number, ri: number, thr: number, minArea = 4): Blob[] {
  const on = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) on[i] = state[i * S * 4 + ri] > thr ? 1 : 0;
  const label = new Int32Array(N * N).fill(-1);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < N * N; i++) {
    if (!on[i] || label[i] >= 0) continue;
    const id = out.length;
    const ox = i % N, oy = (i / N) | 0;
    let sx = 0, sy = 0, sw = 0, area = 0, peak = 0, sxx = 0, syy = 0, sxy = 0;
    label[i] = id;
    stack.push(i);
    // track unwrapped offsets relative to the seed cell
    const off = new Map<number, [number, number]>([[i, [0, 0]]]);
    while (stack.length) {
      const j = stack.pop()!;
      const [jx, jy] = off.get(j)!;
      const v = state[j * S * 4 + ri];
      sx += jx * v; sy += jy * v; sw += v; area++; peak = Math.max(peak, v);
      sxx += jx * jx * v; syy += jy * jy * v; sxy += jx * jy * v;
      const x = j % N, y = (j / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = ((y + dy + N) % N) * N + ((x + dx + N) % N);
        if (on[k] && label[k] < 0) { label[k] = id; off.set(k, [jx + dx, jy + dy]); stack.push(k); }
      }
    }
    const mx = sx / sw, my = sy / sw;
    const cxx = sxx / sw - mx * mx, cyy = syy / sw - my * my, cxy = sxy / sw - mx * my;
    const tr = (cxx + cyy) / 2, det = Math.sqrt(Math.max(0, ((cxx - cyy) / 2) ** 2 + cxy * cxy));
    const elong = Math.sqrt((tr + det) / Math.max(1e-6, tr - det));
    if (area >= minArea) out.push({ x: (((ox + mx) % N) + N) % N, y: (((oy + my) % N) + N) % N, area, peak, elong });
    else out.push({ x: NaN, y: NaN, area: 0, peak: 0, elong: 1 });
  }
  return out.filter((b) => b.area > 0);
}

/** Minimal-image displacement on a torus. */
export const wrapDelta = (a: number, b: number, N: number) => ((b - a + N * 1.5) % N) - N / 2;

const PAL: [number, number, number][] = [[5, 8, 14], [20, 40, 90], [40, 130, 170], [240, 220, 140], [255, 255, 255]];
function pal(t: number) {
  t = Math.max(0, Math.min(1, t)) * (PAL.length - 1);
  const i = Math.min(PAL.length - 2, Math.floor(t)), f = t - i;
  return PAL[i].map((c, k) => c + (PAL[i + 1][k] - c) * f);
}

/**
 * Save a frame: reagent `ri` in [lo, hi], optionally hue-tinted by reagent `ti`
 * in [tlo, thi], with param-map outlines and labelled boxes.
 */
/** As the app's fleck palettes (render.wgsl): (a, b, c) as RGB → (V, S, H) or (L, C, h) shown as RGB. */
function fleck([R, G, B]: [number, number, number], mode: 'hsv' | 'oklch', shape: number, offset: number): [number, number, number] {
  const shapeHue = (h: number) => {
    const v = Math.max(-1, Math.min(1, Math.max(0, Math.min(1, h)) * 2 - 1));
    const m = 0.5 + 0.5 * v / Math.sqrt(1 + (shape - 1) * v * v) + offset;
    return m - Math.floor(m);
  };
  let t: [number, number, number];
  if (mode === 'oklch') {
    const [r, g, b] = [R, G, B].map((x) => Math.max(0, x));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const h = Math.atan2(Bb, A) / (2 * Math.PI);
    t = [L, Math.hypot(A, Bb) / 0.32, shapeHue(h - Math.floor(h))];
  } else {
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
    let h = 0;
    if (d > 1e-9) h = mx === R ? ((G - B) / d) / 6 : mx === G ? (2 + (B - R) / d) / 6 : (4 + (R - G) / d) / 6;
    t = [mx, d / (mx + 1e-5), shapeHue(h - Math.floor(h))];
  }
  return t.map((x) => 255 * Math.max(0, Math.min(1, x))) as [number, number, number];
}

/** The live viewer's snapshot: the rule's view reagent over its range, tinted by its tint (over the tint's own range). */
async function liveFrame(lab: Lab, t: number) {
  const v = lab.rule.view, ri = Math.max(0, lab.layout.reagents.indexOf(v.reagent));
  const ti = v.tint ? lab.layout.reagents.indexOf(v.tint) : -1;
  let tlo = 0, thi = 1;
  if (ti >= 0) {
    const { state } = await lab.read(), S4 = lab.layout.S * 4;
    tlo = Infinity; thi = -Infinity;
    for (let i = 0; i < lab.N * lab.N; i++) { const x = state[i * S4 + ti]; if (x < tlo) tlo = x; if (x > thi) thi = x; }
    if (thi - tlo < 1e-6) thi = tlo + 1;
  }
  const url = await renderFrame(lab, { ri, lo: v.low, hi: v.high, ...(ti >= 0 ? { ti, tlo, thi } : {}), scale: 2 });
  await window.__live!(url, `${lab.rule.name}  t=${t}`);
}

export async function saveFrame(name: string, lab: Lab, o: Parameters<typeof renderFrame>[1]) {
  const url = await renderFrame(lab, o);
  await window.__save(name, url);
  if (window.__live) await window.__live(url, o.caption ?? name);
}

/** A frame of the field: reagent ri (lo-hi) in the lab palette, optionally tinted, as an image data URL. */
export async function renderFrame(
  lab: Lab, o: { ri: number; lo: number; hi: number; ti?: number; tlo?: number; thi?: number; scale?: number; caption?: string; boxes?: { x: number; y: number; w: number; h: number; label?: string; color?: string }[]; outline?: string; hsv?: boolean; rgb?: [number, number, number]; fleck?: 'hsv' | 'oklch'; hueShape?: number; hueOffset?: number },
) {
  const { state, params } = await lab.read();
  const N = lab.N, S4 = lab.layout.S * 4, P4 = lab.layout.P * 4, sc = o.scale ?? 2;
  const img = new ImageData(N, N);
  const oslot = o.outline ? lab.layout.paramNames.indexOf(o.outline) : -1;
  for (let i = 0; i < N * N; i++) {
    const v = (state[i * S4 + o.ri] - o.lo) / (o.hi - o.lo);
    let [r, g, b] = pal(v);
    if (o.rgb) {
      // three reagents (lo-hi each) as red, green and blue, the edges (where each is mid-way) brightened
      const u = o.rgb.map((k) => Math.max(0, Math.min(1, (state[i * S4 + k] - o.lo) / (o.hi - o.lo))));
      const e = Math.max(...u.map((x) => 4 * x * (1 - x)));
      [r, g, b] = u.map((x) => 30 + 150 * x + 75 * e) as [number, number, number];
    } else if (o.fleck) {
      // as the app: with no third reagent, c → 9.1·b (where the shader's c settles)
      const b1 = state[i * S4 + 1], c = lab.layout.reagents.length > 2 ? state[i * S4 + 2] : Math.min(1, Math.max(0, 9.1 * b1));
      [r, g, b] = fleck([state[i * S4], b1, c], o.fleck, o.hueShape ?? 1, o.hueOffset ?? 0);
    } else if (o.hsv) {
      // as the app's HSV palette: ri → hue, ti → saturation, full value
      const h = Math.max(0, Math.min(1, v)), s = o.ti === undefined ? 1 : Math.max(0, Math.min(1, (state[i * S4 + o.ti] - o.tlo!) / (o.thi! - o.tlo!)));
      [r, g, b] = [1, 2 / 3, 1 / 3].map((d) => {
        const k = Math.abs(((h + d) % 1) * 6 - 3);
        return 255 * (1 + s * (Math.max(0, Math.min(1, k - 1)) - 1));
      }) as [number, number, number];
    } else if (o.ti !== undefined) {
      const t = Math.max(0, Math.min(1, (state[i * S4 + o.ti] - o.tlo!) / (o.thi! - o.tlo!)));
      // blend toward a hue ramp (blue → green → orange) by t
      const h: [number, number, number] = t < 0.5 ? [40, 90 + 300 * t, 200 - 200 * t] : [40 + 420 * (t - 0.5), 240, 100 - 160 * (t - 0.5)];
      const k = 0.25 + 0.6 * t;
      r = r * (1 - k) + h[0] * k; g = g * (1 - k) + h[1] * k; b = b * (1 - k) + h[2] * k;
    }
    if (params[i * P4] > 0.5) [r, g, b] = [90, 90, 100];
    else if (oslot > 0) {
      const x = i % N, y = (i / N) | 0, me = params[i * P4 + oslot];
      const nb = [((y * N) + (x + 1) % N), (((y + 1) % N) * N + x)].some((j) => Math.abs(params[j * P4 + oslot] - me) > 1e-6);
      if (nb) [r, g, b] = [r * 0.5 + 90, g * 0.5 + 90, b * 0.5 + 100];
    }
    img.data.set([r, g, b, 255], i * 4);
  }
  const c = document.createElement('canvas');
  c.width = N * sc;
  const bar = o.caption ? 22 : 0;
  c.height = N * sc + bar;
  const x = c.getContext('2d')!;
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = N;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  x.fillStyle = '#0d0f14';
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true;
  x.drawImage(tmp, 0, bar, N * sc, N * sc);
  x.font = '13px monospace';
  if (o.caption) { x.fillStyle = '#ffcc66'; x.fillText(o.caption, 6, 15); }
  for (const b of o.boxes ?? []) {
    x.strokeStyle = b.color ?? '#ffcc66';
    x.strokeRect(b.x * sc + 0.5, b.y * sc + bar + 0.5, b.w * sc, b.h * sc);
    if (b.label) { x.fillStyle = b.color ?? '#ffcc66'; x.fillText(b.label, b.x * sc + 2, b.y * sc + bar - 3); }
  }
  return c.toDataURL('image/png');
}
