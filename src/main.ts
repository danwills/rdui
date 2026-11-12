import './style.css';
import { Simulation, BrushMode, type BrushStroke, type ViewMode } from './sim';
import { buildPanel, defaultSettings, TOOLS, type Settings } from './ui';

interface PendingStroke {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  alt: boolean;
}

async function init() {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
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
  if (import.meta.env.DEV) Object.assign(window, { rdui: { get sim() { return sim; }, settings: s } });

  const strokes: PendingStroke[] = [];
  let pendingSteps = 0;

  const ui = buildPanel(panel, s, {
    fillParams: () => sim.fillParams(s.feed, s.kill, s.diffusion),
    reset: () => sim.reset(s.feed, s.kill, s.diffusion),
    clearChemistry: () => sim.clearChemistry(),
    resize: (size) => {
      sim.destroy();
      sim = new Simulation(device, format, size, size);
      sim.reset(s.feed, s.kill, s.diffusion);
    },
    stepOnce: () => {
      s.running = false;
      pendingSteps++;
      ui.sync();
    },
  });

  // --- canvas sizing: square, as large as the stage allows, at device resolution
  function fit() {
    const r = stage.getBoundingClientRect();
    const side = Math.floor(Math.min(r.width, r.height) - 24);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = canvas.style.height = `${side}px`;
    canvas.width = canvas.height = Math.max(1, Math.floor(side * dpr));
  }
  new ResizeObserver(fit).observe(stage);
  fit();

  // --- pointer → grid coordinates
  const toGrid = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * sim.width, ((e.clientY - r.top) / r.height) * sim.height];
  };

  let drag: { x: number; y: number; alt: boolean } | null = null;
  let hover: [number, number] | null = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = toGrid(e);
    const alt = e.button === 2;
    if (alt && s.tool === 'params') {
      eyedrop(x, y);
      return;
    }
    drag = { x, y, alt };
    strokes.push({ ax: x, ay: y, bx: x, by: y, alt });
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toGrid(e);
    hover = [x, y];
    if (!drag) return;
    strokes.push({ ax: drag.x, ay: drag.y, bx: x, by: y, alt: drag.alt });
    drag.x = x;
    drag.y = y;
  });
  const endDrag = () => (drag = null);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
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

  function toBrush(p: PendingStroke): BrushStroke {
    let mode: BrushMode;
    switch (s.tool) {
      case 'seed': mode = p.alt ? BrushMode.Erase : BrushMode.Seed; break;
      case 'erase': mode = BrushMode.Erase; break;
      case 'params': mode = BrushMode.Params; break;
      case 'wall': mode = p.alt ? BrushMode.Unwall : BrushMode.Wall; break;
    }
    return {
      ...p, mode,
      radius: s.radius, strength: s.strength, hardness: s.hardness,
      feed: s.feed, kill: s.kill, diffusion: s.diffusion,
    };
  }

  // --- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
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
    else return;
    ui.sync();
  });

  // --- frame loop
  let frames = 0;
  let stepsDone = 0;
  let lastStat = performance.now();
  let stats = '';

  function frame() {
    // Brushes are submitted before this frame's encoder so they bind the current state buffer.
    for (const p of strokes.splice(0)) sim.brush(toBrush(p));

    const enc = device.createCommandEncoder();
    const n = (s.running ? s.stepsPerFrame : 0) + pendingSteps;
    pendingSteps = 0;
    sim.step(enc, n);
    stepsDone += n;
    sim.render(enc, ctx.getCurrentTexture().createView(), canvas.width, canvas.height, s.view as ViewMode, s.palette);
    device.queue.submit([enc.finish()]);

    frames++;
    const now = performance.now();
    if (now - lastStat > 500) {
      const dt = (now - lastStat) / 1000;
      stats = `${(frames / dt).toFixed(0)} fps · ${(stepsDone / dt).toFixed(0)} steps/s · ${sim.width}²`;
      frames = stepsDone = 0;
      lastStat = now;
    }
    if (hover && frames % 4 === 0) {
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
