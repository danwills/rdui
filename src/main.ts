import './style.css';
import { Simulation, BrushMode, type BrushStroke, type ViewMode } from './sim';
import { buildPanel, defaultSettings, TOOLS, type Settings } from './ui';
import { ProbeSet, type Rect } from './probes';
import { StampLibrary, newStampId, stampThumbnail, transformStamp, type Stamp } from './stamps';
import { Overlay, type Ghost } from './overlay';
import { stampSection, probeSection } from './panels';
import { encodeSnapshot, decodeSnapshot, download, pickFile } from './snapshot';

const RECT_TOOLS = new Set(['capture', 'probe']);
const PROBE_SAMPLE_EVERY = 3; // frames

async function init() {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const overlayCanvas = document.querySelector<HTMLCanvasElement>('#overlay')!;
  const stage = document.querySelector<HTMLElement>('#stage')!;
  const readout = document.querySelector<HTMLElement>('#readout')!;
  const panel = document.querySelector<HTMLElement>('#panel')!;

  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    stage.innerHTML = `<div class="nogpu"><h2>WebGPU unavailable</h2>
      <p>rdui needs WebGPU. On Linux, try Chrome/Chromium with <code>--enable-unsafe-webgpu --enable-features=Vulkan</code>,
      or Firefox Nightly with <code>dom.webgpu.enabled</code>.</p></div>`;
    return;
  }
  const device = await adapter.requestDevice();
  device.lost.then((info) => console.error(`GPU device lost (${info.reason}) at ${performance.now().toFixed(0)}ms:`, info.message));
  device.addEventListener('uncapturederror', (e) => console.error((e as GPUUncapturedErrorEvent).error.message));

  const ctx = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const s: Settings = defaultSettings();
  let sim = new Simulation(device, format, s.gridSize, s.gridSize);
  sim.reset(s.feed, s.kill, s.diffusion);

  const probes = new ProbeSet(device);
  const stamps = new StampLibrary();
  s.stampId = stamps.stamps[0]?.id ?? null;
  const overlay = new Overlay(overlayCanvas);

  if (import.meta.env.DEV) Object.assign(window, { rdui: { get sim() { return sim; }, settings: s, probes, stamps, get hover() { return hover; } } });

  // Resolved at input time so tool/brush changes before the next frame don't affect queued strokes.
  const strokes: BrushStroke[] = [];
  let pendingSteps = 0;

  function replaceSim(w: number, h: number) {
    sim.destroy();
    sim = new Simulation(device, format, w, h);
    probes.clear();
    probePanel.render();
    fit();
  }

  // --- side panel
  const stampPanel = stampSection(stamps, s, (id) => {
    s.stampId = id;
    s.tool = 'stamp';
    stampPanel.render();
    ui.sync();
  }, {
    export: () => download(new Blob([stamps.export()], { type: 'application/json' }), 'rdui-stamps.json'),
    import: async () => {
      const f = await pickFile('.json,application/json');
      if (!f) return;
      try {
        stamps.import(await f.text());
      } catch (e) {
        alert(`Could not import stamps: ${(e as Error).message}`);
      }
    },
  });
  stamps.onChange = () => {
    if (!stamps.get(s.stampId)) s.stampId = stamps.stamps[0]?.id ?? null;
    stampPanel.render();
  };

  const probePanel = probeSection(probes);
  probes.onSample = probePanel.update;

  const ui = buildPanel(panel, s, {
    fillParams: () => sim.fillParams(s.feed, s.kill, s.diffusion),
    reset: () => sim.reset(s.feed, s.kill, s.diffusion),
    clearChemistry: () => sim.clearChemistry(),
    resize: (size) => {
      replaceSim(size, size);
      sim.reset(s.feed, s.kill, s.diffusion);
    },
    stepOnce: () => {
      s.running = false;
      pendingSteps++;
      ui.sync();
    },
    saveField,
    loadField,
  }, [stampPanel.node, probePanel.node]);

  async function saveField() {
    const { params, state } = await sim.readRegion(0, 0, sim.width, sim.height);
    const blob = encodeSnapshot({ header: { width: sim.width, height: sim.height, probes: probes.toJSON() }, params, state });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    download(blob, `rdui-${sim.width}x${sim.height}-${stamp}.rdui`);
  }

  async function loadField() {
    const f = await pickFile('.rdui');
    if (!f) return;
    try {
      const snap = decodeSnapshot(await f.arrayBuffer());
      const { width, height } = snap.header;
      if (width !== sim.width || height !== sim.height) {
        replaceSim(width, height);
        if (width === height) s.gridSize = width;
      }
      sim.writeRegion(0, 0, width, height, snap.params, snap.state);
      probes.load(snap.header.probes ?? []);
      probePanel.render();
      ui.sync();
    } catch (e) {
      alert(`Could not load field: ${(e as Error).message}`);
    }
  }

  // --- canvas sizing: keep the grid's aspect, as large as the stage allows, at device resolution
  function fit() {
    const r = stage.getBoundingClientRect();
    const scale = Math.min((r.width - 24) / sim.width, (r.height - 24) / sim.height);
    const w = Math.max(1, Math.floor(sim.width * scale));
    const h = Math.max(1, Math.floor(sim.height * scale));
    const dpr = window.devicePixelRatio || 1;
    for (const c of [canvas, overlayCanvas]) {
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
    }
  }
  new ResizeObserver(fit).observe(stage);
  fit();

  // --- stamp placement helpers
  let ghostCache: { key: string; stamp: Stamp; image: HTMLCanvasElement } | null = null;
  function placedStamp() {
    const base = stamps.get(s.stampId);
    if (!base) return null;
    const key = `${base.id}:${s.stampRot}:${s.stampFlip}`;
    if (ghostCache?.key !== key) {
      const stamp = transformStamp(base, { rot: s.stampRot, flip: s.stampFlip });
      ghostCache = { key, stamp, image: stampThumbnail(stamp, Math.max(stamp.w, stamp.h)) };
    }
    return ghostCache;
  }
  const stampOrigin = (st: Stamp, x: number, y: number) => [Math.round(x - st.w / 2), Math.round(y - st.h / 2)];

  function placeStamp(x: number, y: number) {
    const g = placedStamp();
    if (!g || (!s.placeParams && !s.placeChem)) return;
    const [ox, oy] = stampOrigin(g.stamp, x, y);
    sim.writeRegion(ox, oy, g.stamp.w, g.stamp.h, s.placeParams ? g.stamp.params : undefined, s.placeChem ? g.stamp.state : undefined);
  }

  async function captureStamp(r: Rect) {
    const { params, state } = await sim.readRegion(r.x, r.y, r.w, r.h);
    const stamp: Stamp = { id: newStampId(), name: `stamp ${stamps.stamps.length + 1}`, w: r.w, h: r.h, params, state };
    s.stampRot = 0;
    s.stampFlip = false;
    s.stampId = stamp.id;
    stamps.add(stamp);
    s.tool = 'stamp';
    ui.sync();
  }

  // --- pointer → grid coordinates
  const toGrid = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * sim.width, ((e.clientY - r.top) / r.height) * sim.height];
  };
  const clampToGrid = (x: number, y: number): [number, number] => [
    Math.min(Math.max(x, 0), sim.width),
    Math.min(Math.max(y, 0), sim.height),
  ];

  let drag: { x: number; y: number; alt: boolean } | null = null;
  let rectDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let hover: [number, number] | null = null;

  const dragRect = (): Rect | null => {
    if (!rectDrag) return null;
    const x = Math.floor(Math.min(rectDrag.x0, rectDrag.x1));
    const y = Math.floor(Math.min(rectDrag.y0, rectDrag.y1));
    const x2 = Math.ceil(Math.max(rectDrag.x0, rectDrag.x1));
    const y2 = Math.ceil(Math.max(rectDrag.y0, rectDrag.y1));
    return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = toGrid(e);
    const alt = e.button === 2;
    if (alt && s.tool === 'params') {
      eyedrop(x, y);
      return;
    }
    if (s.tool === 'probe' && alt) {
      const p = probes.hit(x, y);
      if (p) {
        probes.remove(p.id);
        probePanel.render();
      }
      return;
    }
    if (s.tool === 'stamp') {
      if (alt) {
        s.tool = 'seed';
        ui.sync();
      } else {
        placeStamp(x, y);
      }
      return;
    }
    if (RECT_TOOLS.has(s.tool)) {
      if (alt) return;
      const [cx, cy] = clampToGrid(x, y);
      rectDrag = { x0: cx, y0: cy, x1: cx, y1: cy };
      return;
    }
    drag = { x, y, alt };
    strokes.push(toBrush(x, y, x, y, alt));
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toGrid(e);
    hover = [x, y];
    if (rectDrag) {
      [rectDrag.x1, rectDrag.y1] = clampToGrid(x, y);
      return;
    }
    if (!drag) return;
    strokes.push(toBrush(drag.x, drag.y, x, y, drag.alt));
    drag.x = x;
    drag.y = y;
  });
  canvas.addEventListener('pointerup', () => {
    drag = null;
    const r = dragRect();
    rectDrag = null;
    if (!r) return;
    if (s.tool === 'probe') {
      if (probes.add(r)) probePanel.render();
    } else if (s.tool === 'capture' && r.w >= 2 && r.h >= 2) {
      captureStamp(r);
    }
  });
  canvas.addEventListener('pointercancel', () => {
    drag = null;
    rectDrag = null;
  });
  canvas.addEventListener('pointerleave', () => (hover = null));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    s.radius = Math.min(80, Math.max(1, Math.round(s.radius * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    ui.sync();
  }, { passive: false });

  async function eyedrop(x: number, y: number) {
    const c = await sim.probe(Math.floor(x), Math.floor(y));
    if (!c || c.wall) return;
    s.feed = c.feed;
    s.kill = c.kill;
    s.diffusion = c.diffusion;
    ui.sync();
  }

  function toBrush(ax: number, ay: number, bx: number, by: number, alt: boolean): BrushStroke {
    let mode: BrushMode;
    switch (s.tool) {
      case 'erase': mode = BrushMode.Erase; break;
      case 'params': mode = BrushMode.Params; break;
      case 'wall': mode = alt ? BrushMode.Unwall : BrushMode.Wall; break;
      default: mode = alt ? BrushMode.Erase : BrushMode.Seed; break;
    }
    return {
      ax, ay, bx, by, mode,
      radius: s.radius, strength: s.strength, hardness: s.hardness,
      feed: s.feed, kill: s.kill, diffusion: s.diffusion,
    };
  }

  // --- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') saveField();
      else if (e.key === 'o') loadField();
      else return;
      e.preventDefault();
      return;
    }
    const tool = TOOLS.find((t) => t.key === e.key);
    if (tool) s.tool = tool.id;
    else if (e.key === ' ') { s.running = !s.running; e.preventDefault(); }
    else if (e.key === '.') { s.running = false; pendingSteps++; }
    else if (e.key === '[') s.radius = Math.max(1, s.radius - 1);
    else if (e.key === ']') s.radius = Math.min(80, s.radius + 1);
    else if (e.key === 'f') sim.fillParams(s.feed, s.kill, s.diffusion);
    else if (e.key === 'r') sim.reset(s.feed, s.kill, s.diffusion);
    else if (e.key === 'c') sim.clearChemistry();
    else if (e.key === 'v') s.view = (s.view + 1) % 3;
    else if (e.key === 'q') s.stampRot = (s.stampRot + 3) % 4;
    else if (e.key === 'e') s.stampRot = (s.stampRot + 1) % 4;
    else if (e.key === 'x') s.stampFlip = !s.stampFlip;
    else if (e.key === 'Escape') { drag = null; rectDrag = null; }
    else return;
    ui.sync();
  });

  // --- frame loop
  let frames = 0;
  let frameNo = 0;
  let stepsDone = 0;
  let lastStat = performance.now();
  let stats = '';

  function frame() {
    // Brushes are submitted before this frame's encoder so they bind the current state buffer.
    for (const b of strokes.splice(0)) sim.brush(b);

    const enc = device.createCommandEncoder();
    const n = (s.running ? s.stepsPerFrame : 0) + pendingSteps;
    pendingSteps = 0;
    sim.step(enc, n);
    stepsDone += n;
    sim.render(enc, ctx.getCurrentTexture().createView(), canvas.width, canvas.height, s.view as ViewMode, s.palette);
    device.queue.submit([enc.finish()]);

    if (++frameNo % PROBE_SAMPLE_EVERY === 0) probes.sample(sim);

    let ghost: Ghost | null = null;
    if (s.tool === 'stamp' && hover) {
      const g = placedStamp();
      if (g) {
        const [x, y] = stampOrigin(g.stamp, hover[0], hover[1]);
        ghost = { x, y, w: g.stamp.w, h: g.stamp.h, image: g.image };
      }
    }
    overlay.draw(sim.width, sim.height, probes.probes, dragRect(), s.tool === 'probe' ? '#ffcc66' : '#66d9ff', ghost);

    frames++;
    const now = performance.now();
    if (now - lastStat > 500) {
      const dt = (now - lastStat) / 1000;
      stats = `${(frames / dt).toFixed(0)} fps · ${(stepsDone / dt).toFixed(0)} steps/s · ${sim.width}×${sim.height}`;
      frames = stepsDone = 0;
      lastStat = now;
    }
    if (hover && frameNo % 4 === 0) {
      sim.probe(Math.floor(hover[0]), Math.floor(hover[1])).then((c) => {
        if (!c) return;
        readout.textContent =
          `${stats}\n(${c.x}, ${c.y})  u ${c.u.toFixed(3)}  v ${c.v.toFixed(3)}` +
          (c.wall ? '  wall' : `\nF ${c.feed.toFixed(4)}  k ${c.kill.toFixed(4)}  D× ${c.diffusion.toFixed(2)}`);
      });
    } else if (!hover) {
      readout.textContent = stats;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

init();
