/**
 * The Gray-Scott (kill → x, feed ↑ y) map: drawing shared by the panel's small
 * pad, the magnifier shown while dragging on it, and the full map. The backdrop
 * is a real simulation of the region (lab/gs-map.ts: 2048², every cell its own
 * F and k, 40k steps; b shown): a 1024² overview plus 4×4 tiles of 512² at full
 * resolution, loaded when a zoomed view needs them. Over it go the uniform
 * state's saddle-node and Hopf curves, Pearson's classes and rdui's presets.
 */
import mapUrl from './assets/gs-map.webp';
import { PEARSON, PRESETS } from './presets';
import { el, button, type Settings } from './ui';

export const F_RANGE = [0, 0.1] as const;
export const K_RANGE = [0.03, 0.075] as const;

const mapImage = new Image();
mapImage.src = mapUrl;

// full-resolution tiles: t<x><y>.webp, x rightward (k), y downward (falling F)
const TILES = 4;
const tileUrls = import.meta.glob('./assets/gs-map-tiles/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const tileImages = new Map<string, HTMLImageElement>();
let tileLoaded: (() => void) | null = null;
function tile(tx: number, ty: number) {
  const key = `${tx}${ty}`;
  let im = tileImages.get(key);
  if (!im) {
    const url = tileUrls[`./assets/gs-map-tiles/t${key}.webp`];
    if (!url) return null;
    tileImages.set(key, (im = new Image()));
    im.addEventListener('load', () => tileLoaded?.(), { once: true });
    im.src = url;
  }
  return im.complete && im.naturalWidth ? im : null;
}

/** Where to draw: a W×H box showing the window k ∈ kv, F ∈ Fv (default: the whole map). */
export interface MapFrame {
  W: number;
  H: number;
  kv: readonly [number, number];
  Fv: readonly [number, number];
  toX(k: number): number;
  toY(f: number): number;
}

export function mapFrame(W: number, H: number, kv: readonly [number, number] = K_RANGE, Fv: readonly [number, number] = F_RANGE): MapFrame {
  return {
    W, H, kv, Fv,
    toX: (k) => ((k - kv[0]) / (kv[1] - kv[0])) * W,
    toY: (f) => H - ((f - Fv[0]) / (Fv[1] - Fv[0])) * H,
  };
}

/** A W×H window zoomed `zoom`× about (F, k). */
export function zoomFrame(W: number, H: number, F: number, k: number, zoom: number) {
  const hk = (K_RANGE[1] - K_RANGE[0]) / zoom / 2, hF = ((F_RANGE[1] - F_RANGE[0]) / zoom / 2) * (H / W);
  return mapFrame(W, H, [k - hk, k + hk], [F - hF, F + hF]);
}

/** F, k under a point given as 0–1 fractions of the box. */
export function pickFK(fx: number, fy: number): [number, number] {
  const c = (v: number) => Math.min(Math.max(v, 0), 1);
  return [F_RANGE[0] + (1 - c(fy)) * (F_RANGE[1] - F_RANGE[0]), K_RANGE[0] + c(fx) * (K_RANGE[1] - K_RANGE[0])];
}

/** k on the Hopf curve of the non-trivial uniform state (trace k − v² = 0, v = √k), for F ≤ 1/16. */
function hopfK(F: number) {
  // F(1 − u) = (F + k)v with u = (F + k)/√k: bisect on the root just left of the saddle-node
  const g = (k: number) => F * (1 - (F + k) / Math.sqrt(k)) - (F + k) * Math.sqrt(k);
  let lo = Math.sqrt(F) / 2 - F, hi = lo;
  lo = Math.max(lo * 0.3, 1e-4);
  if (g(lo) * g(hi) > 0) return NaN;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (g(lo) * g(m) <= 0) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}

/**
 * Draw the backdrop (simulated map, dimmed by `dim`), curves, and labels. `big`
 * adds Pearson's classes, axis ticks and the curve names.
 */
export function drawMap(ctx: CanvasRenderingContext2D, f: MapFrame, o: { dim: number; big: boolean; guides: boolean }) {
  const { W, H, toX, toY } = f;
  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(0, 0, W, H);
  // the map's own extent in this frame
  const x0 = toX(K_RANGE[0]), x1 = toX(K_RANGE[1]), y0 = toY(F_RANGE[1]), y1 = toY(F_RANGE[0]);
  ctx.globalAlpha = 1 - o.dim;
  ctx.imageSmoothingQuality = 'high';
  if (mapImage.complete && mapImage.naturalWidth) ctx.drawImage(mapImage, x0, y0, x1 - x0, y1 - y0);
  // zoomed past the overview's resolution: the visible full-resolution tiles over it
  if ((x1 - x0) * (window.devicePixelRatio || 1) > mapImage.naturalWidth * 1.2) {
    const tw = (x1 - x0) / TILES, th = (y1 - y0) / TILES;
    for (let ty = 0; ty < TILES; ty++) for (let tx = 0; tx < TILES; tx++) {
      const X = x0 + tx * tw, Y = y0 + ty * th;
      if (X > W || Y > H || X + tw < 0 || Y + th < 0) continue;
      const im = tile(tx, ty);
      if (im) ctx.drawImage(im, X, Y, tw + 0.5, th + 0.5);
    }
  }
  ctx.globalAlpha = 1;
  if (!o.guides) return;
  const curve = (pts: [number, number][], style: string, dash: number[]) => {
    ctx.strokeStyle = style;
    ctx.setLineDash(dash);
    ctx.lineWidth = o.big ? 1.5 : 1;
    ctx.beginPath();
    pts.forEach(([k, F], i) => (i ? ctx.lineTo(toX(k), toY(F)) : ctx.moveTo(toX(k), toY(F))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  // saddle-node: k = √F/2 − F (patterns live just right of it); Hopf: left of it, meeting at F = k = 1/16
  const sn: [number, number][] = [], hopf: [number, number][] = [];
  for (let i = 0; i <= 200; i++) {
    const F = (i / 200) * 0.25;
    sn.push([Math.sqrt(F) / 2 - F, F]);
    if (F > 0.0005 && F <= 0.0625) {
      const k = hopfK(F);
      if (Number.isFinite(k)) hopf.push([k, F]);
    }
  }
  curve(sn, o.big ? 'rgba(255,255,255,0.75)' : '#2a3140', []);
  if (o.big) curve(hopf, 'rgba(255,255,255,0.6)', [6, 4]);

  ctx.font = `${o.big ? 12 : 10}px ui-monospace, monospace`;
  ctx.textBaseline = 'alphabetic';
  const label = (x: number, y: number, text: string, fill: string, dot: string, r: number) => {
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(text, x + r + 2, y - 3);
    ctx.fillStyle = fill;
    ctx.fillText(text, x + r + 2, y - 3);
  };
  if (o.big) {
    ctx.font = 'bold 15px ui-serif, Georgia, serif';
    for (const p of PEARSON) label(toX(p.kill), toY(p.feed), p.name, '#ff9b9b', '#ff6b6b', 3);
    ctx.font = '12px ui-monospace, monospace';
  }
  for (const p of PRESETS) label(toX(p.kill), toY(p.feed), p.name, o.big ? '#cfe3ff' : '#7f8ba0', o.big ? '#8fb8ff' : '#5b6b85', o.big ? 3 : 2.5);

  if (o.big) {
    // axis ticks and curve names
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    const t = (s: string, x: number, y: number) => {
      ctx.strokeText(s, x, y);
      ctx.fillText(s, x, y);
    };
    // ~6 ticks per axis at a round step, inset from the edges
    const ticks = (lo: number, hi: number, put: (v: number, s: string) => void) => {
      const raw = (hi - lo) / 6, p = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map((m) => m * p).find((m) => m >= raw)!;
      const dec = Math.max(0, -Math.floor(Math.log10(step)));
      for (let v = Math.ceil(lo / step) * step; v < hi; v += step) put(v, v.toFixed(dec));
    };
    ticks(f.kv[0] + (f.kv[1] - f.kv[0]) * 0.06, f.kv[1] - (f.kv[1] - f.kv[0]) * 0.1, (v, s) => t(s, toX(v) - 16, H - 6));
    ticks(f.Fv[0] + (f.Fv[1] - f.Fv[0]) * 0.04, f.Fv[1] - (f.Fv[1] - f.Fv[0]) * 0.06, (v, s) => t(s, 6, toY(v) + 4));
    t('kill k →', W - 70, H - 22);
    t('feed F ↑', 6, 16);
    if (f.kv[0] === K_RANGE[0] && f.kv[1] === K_RANGE[1]) {
      const snF = 0.012, hF = 0.03;
      t('saddle-node', toX(Math.sqrt(snF) / 2 - snF) + 6, toY(snF));
      t('Hopf', toX(hopfK(hF)) - 40, toY(hF));
    }
  } else {
    ctx.fillStyle = '#5b6b85';
    ctx.fillText('kill →', W - 38, H - 4);
    ctx.fillText('feed ↑', 3, 11);
  }
}

/** Brush (ring) and background (dot) markers; the active target drawn bright. */
export function drawMarkers(ctx: CanvasRenderingContext2D, f: MapFrame, s: Settings, bg: Record<string, number>, scale = 1) {
  ctx.globalAlpha = s.fkTarget === 'background' ? 1 : 0.5;
  ctx.fillStyle = '#66d9ff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(f.toX(bg.k), f.toY(bg.F), 3.5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = s.fkTarget === 'brush' ? 1 : 0.5;
  ctx.strokeStyle = '#ffcc66';
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.arc(f.toX(s.paint.k), f.toY(s.paint.F), 5 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

/** Re-run `then` once the backdrop image has loaded (the first draw may come before). */
export function onMapLoaded(then: () => void) {
  if (mapImage.complete) return;
  mapImage.addEventListener('load', then, { once: true });
}

/**
 * The magnifier shown while dragging on the small pad: the map zoomed `ZOOM`×
 * about the value being picked (which stays at its centre, the map moving under
 * it), in the largest stretch of screen beside the simulation so the sim stays
 * in view. Gone when the finger lifts.
 */
export const LOUPE_ZOOM = 4;
export function openLoupe(s: Settings, background: () => Record<string, number>) {
  const W = window.innerWidth, H = window.innerHeight;
  const vr = document.querySelector('#viewport')?.getBoundingClientRect();
  // candidate regions clear of the sim: left, right, above, below it
  const regions = vr ? [[0, 0, vr.left, H], [vr.right, 0, W - vr.right, H], [0, 0, W, vr.top], [0, vr.bottom, W, H - vr.bottom]] : [[0, 0, W, H]];
  let [rx, ry, rw, rh] = regions.reduce((a, b) => (Math.min(b[2], b[3]) > Math.min(a[2], a[3]) ? b : a));
  if (Math.min(rw, rh) < 180) [rx, ry, rw, rh] = [0, 0, W, H]; // no room beside it: cover the middle
  const size = Math.floor(Math.min(rw, rh, 720) - 16);
  const dpr = window.devicePixelRatio || 1;
  const canvas = el('canvas', { class: 'fkloupe-canvas' });
  canvas.width = canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = `${size}px`;
  const readout = el('div', { class: 'fkloupe-readout' });
  const root = el('div', { class: 'fkloupe' }, canvas, readout);
  root.style.left = `${rx + (rw - size) / 2}px`;
  root.style.top = `${ry + (rh - size) / 2}px`;
  document.body.append(root);
  const ctx = canvas.getContext('2d')!;

  function draw() {
    const bg = background();
    const [F, k] = s.fkTarget === 'brush' ? [s.paint.F, s.paint.k] : [bg.F, bg.k];
    const frame = zoomFrame(size, size, F, k, LOUPE_ZOOM);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, frame, { dim: 0, big: true, guides: true });
    drawMarkers(ctx, frame, s, bg, 1.6);
    // crosshair on the value being picked
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    const c = size / 2;
    ctx.beginPath();
    ctx.moveTo(c - 14, c); ctx.lineTo(c - 5, c); ctx.moveTo(c + 5, c); ctx.lineTo(c + 14, c);
    ctx.moveTo(c, c - 14); ctx.lineTo(c, c - 5); ctx.moveTo(c, c + 5); ctx.lineTo(c, c + 14);
    ctx.stroke();
    readout.textContent = `${s.fkTarget} F ${F.toFixed(4)} k ${k.toFixed(4)}`;
  }
  tileLoaded = draw;
  draw();
  return {
    draw,
    close() {
      tileLoaded = null;
      root.remove();
    },
  };
}

/**
 * The full-screen map: click or drag to pick (F, k) into whatever the switch
 * targets, hover for a readout; Esc, ✕ or a tap outside closes it.
 */
export function openFKMap(s: Settings, background: () => Record<string, number>, set: (F: number, k: number) => void, onClose: () => void) {
  const dpr = window.devicePixelRatio || 1;
  const size = Math.floor(Math.min(window.innerWidth - 24, window.innerHeight - 110, 1100));
  const canvas = el('canvas', { class: 'fkmap-canvas' });
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  const frame = mapFrame(size, size);
  const readout = el('span', { class: 'fkmap-readout' });
  let guides = true;
  let hover: [number, number] | null = null;

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, frame, { dim: 0, big: true, guides });
    drawMarkers(ctx, frame, s, background(), 1.6);
    const bg = background();
    const hv = hover ? `  ·  pointer F ${hover[0].toFixed(4)} k ${hover[1].toFixed(4)}` : '';
    readout.textContent = `${s.fkTarget === 'brush' ? 'brush' : 'background'} F ${(s.fkTarget === 'brush' ? s.paint.F : bg.F).toFixed(4)} k ${(s.fkTarget === 'brush' ? s.paint.k : bg.k).toFixed(4)}${hv}`;
  }
  onMapLoaded(draw);

  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return pickFK((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    set(...at(e));
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    hover = at(e);
    if (e.buttons & 1) set(...hover);
    draw();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    draw();
  });

  const close = () => {
    root.remove();
    window.removeEventListener('keydown', onKey);
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  const targetBtns = (['brush', 'background'] as const).map((id) => {
    const b = button(id === 'brush' ? 'Brush' : 'Background', () => {
      s.fkTarget = id;
      targetBtns.forEach((x, i) => x.classList.toggle('active', (i ? 'background' : 'brush') === s.fkTarget));
      draw();
    }, id === 'brush' ? 'clicks set the Params brush values' : 'clicks set the unpainted background');
    b.classList.toggle('active', s.fkTarget === id);
    return b;
  });
  const guideBtn = button('Guides', () => {
    guides = !guides;
    guideBtn.classList.toggle('active', guides);
    draw();
  }, 'curves and labels');
  guideBtn.classList.add('active');
  const root = el('div', { class: 'fkmap' },
    el('div', { class: 'fkmap-box' },
      el('div', { class: 'fkmap-bar' }, el('span', {}, 'sets'), ...targetBtns, guideBtn, readout, button('✕', close, 'close · Esc')),
      canvas,
      el('p', { class: 'hint' }, 'A real Gray-Scott run with F and k varying across the field (b shown). Solid: saddle-node, dashed: Hopf. Red: Pearson\'s classes (Munafo\'s examples), blue: presets.'),
    ),
  );
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) close();
  });
  document.body.append(root);
  draw();
  return { draw, close };
}
