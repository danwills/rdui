/**
 * The Gray-Scott (kill → x, feed ↑ y) map: drawing shared by the panel's small
 * pad and the full-screen map it opens. The backdrop is a real simulation of the
 * region (lab/gs-map.ts: every cell its own F and k, run 40k steps; b shown),
 * with the uniform state's saddle-node and Hopf curves, Pearson's classes and
 * rdui's presets over it.
 */
import mapUrl from './assets/gs-map.webp';
import { PEARSON, PRESETS } from './presets';
import { el, button, type Settings } from './ui';

export const F_RANGE = [0, 0.1] as const;
export const K_RANGE = [0.03, 0.075] as const;

const mapImage = new Image();
mapImage.src = mapUrl;

/** Where to draw: a W×H box, F/k ↔ pixels. */
export interface MapFrame {
  W: number;
  H: number;
  toX(k: number): number;
  toY(f: number): number;
}

export function mapFrame(W: number, H: number): MapFrame {
  return {
    W, H,
    toX: (k) => ((k - K_RANGE[0]) / (K_RANGE[1] - K_RANGE[0])) * W,
    toY: (f) => H - ((f - F_RANGE[0]) / (F_RANGE[1] - F_RANGE[0])) * H,
  };
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
  if (mapImage.complete && mapImage.naturalWidth) {
    ctx.globalAlpha = 1 - o.dim;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mapImage, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
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
    for (let i = 1; i < 9; i++) t((0.03 + i * 0.005).toFixed(3), toX(0.03 + i * 0.005) - 16, H - 6);
    for (let i = 1; i < 10; i++) t((i / 100).toFixed(2), 6, toY(i / 100) + 4);
    t('kill k →', W - 70, H - 22);
    t('feed F ↑', 6, 16);
    const snF = 0.012, hF = 0.03;
    t('saddle-node', toX(Math.sqrt(snF) / 2 - snF) + 6, toY(snF));
    t('Hopf', toX(hopfK(hF)) - 40, toY(hF));
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
