import './style.css';
import { Simulation, BrushMode, type BrushStroke, type ViewOptions } from './sim';
import { buildPanel, defaultSettings, fmt, TOOLS, type Settings } from './ui';
import { ProbeSet, type Rect } from './probes';
import { StampLibrary, newStampId, stampThumbnail, transformStamp, type Stamp } from './stamps';
import { Overlay, type Ghost } from './overlay';
import { stampSection, probeSection } from './panels';
import { encodeSnapshot, decodeSnapshot, download, pickFile } from './snapshot';
import {
  BUILTIN_RULES, GRAY_SCOTT, RuleError, compileRule, defaultGlobals, initialField, layoutOf, remapCells,
  type CompiledRule, type RuleDef,
} from './rule';
import { BUNDLED_PATTERNS, importReady, loadBundled } from './ready';
import { SCENES, type Scene } from './scenes';
import { STARTER_STAMPS } from './stamps';

const RECT_TOOLS = new Set(['capture', 'probe']);
const PROBE_SAMPLE_EVERY = 3; // frames

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Field contents in some layout, to be remapped by name into the current one. */
interface FieldData {
  state: Float32Array;
  params: Float32Array;
  reagents: string[];
  paramNames: string[];
  S: number;
  P: number;
}

interface ApplyOptions {
  globals?: Record<string, number>;
  size?: { width: number; height: number };
  /** 'initial' = run the rule's generator; 'carry' = keep the current field; or explicit data. */
  field: 'initial' | 'carry' | FieldData;
  /** Per-reagent starting images (y-down), overriding the generator. */
  image?: Float32Array[];
  /** Keep the current view settings (used when only paintability changes). */
  keepView?: boolean;
  id?: string;
  warnings?: string[];
}

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
  device.lost.then((info) => {
    console.error(`GPU device lost (${info.reason}):`, info.message);
    readout.textContent = 'GPU device lost — reload the page';
  });
  device.addEventListener('uncapturederror', (e) => console.error((e as GPUUncapturedErrorEvent).error.message));

  const ctx = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const s: Settings = defaultSettings();

  // --- rule state
  let rule: RuleDef = clone(GRAY_SCOTT);
  let ruleId = 'builtin:0';
  let warnings: string[] = [];
  let note = ''; // shown under the rule picker (scene description)
  let globals: Record<string, number> = defaultGlobals(rule);
  for (const n of rule.paintable) s.paint[n] = globals[n];
  let compiled: CompiledRule = compileRule(rule);
  let sim = new Simulation(device, format, s.gridSize, s.gridSize, compiled);

  const probes = new ProbeSet(device);
  const stamps = new StampLibrary();
  s.stampId = stamps.stamps[0]?.id ?? null;
  const overlay = new Overlay(overlayCanvas);

  const strokes: BrushStroke[] = []; // resolved at input time so later tool changes don't affect them
  let pendingSteps = 0;

  const ruleChoices = [
    ...BUILTIN_RULES.map((r, i) => ({ id: `builtin:${i}`, label: r.name, group: 'Built-in' })),
    ...BUNDLED_PATTERNS.map((p) => ({ id: `pattern:${p.name}`, label: p.name, group: 'Ready patterns' })),
    ...SCENES.map((sc) => ({ id: `scene:${sc.id}`, label: sc.scene.name, group: 'Scenes' })),
  ];

  const paintValues = () => rule.paintable.map((n) => s.paint[n] ?? globals[n]);
  const restOf = (name: string) => rule.rest[rule.reagents.indexOf(name)] ?? 0;
  const paramFallback = (name: string) => (name === 'wall' ? 0 : s.paint[name] ?? globals[name] ?? 0);

  /** Remap field data from any layout into the current rule's layout. */
  function remapField(d: FieldData, cells: number) {
    const L = sim.layout;
    return {
      state: remapCells(d.state, d.reagents, d.S, L.reagents, L.S, cells, restOf),
      params: remapCells(d.params, d.paramNames, d.P, L.paramNames, L.P, cells, paramFallback),
    };
  }

  function initialData(w: number, h: number, image?: Float32Array[]) {
    const f = initialField(rule, w, h, globals);
    if (image) {
      const S4 = layoutOf(rule).S * 4;
      image.forEach((img, r) => img.forEach((v, i) => (f.state[i * S4 + r] = v)));
    }
    return f;
  }

  /** Switch to a (possibly modified) rule, rebuilding the simulation. */
  async function applyRule(nextRule: RuleDef, o: ApplyOptions) {
    let next = nextRule;
    let nextCompiled: CompiledRule;
    try {
      nextCompiled = compileRule(next);
    } catch (e) {
      alert(`Can't use rule "${next.name}": ${e instanceof RuleError ? e.message : e}`);
      return false;
    }
    const width = o.size?.width ?? sim.width;
    const height = o.size?.height ?? sim.height;
    let carried: FieldData | null = null;
    if (o.field === 'carry') {
      const { state, params } = await sim.readRegion(0, 0, sim.width, sim.height);
      carried = { state, params, ...sim.layout };
    } else if (o.field !== 'initial') {
      carried = o.field;
    }

    if (!next.restRelaxed) {
      const g = { ...defaultGlobals(next), ...(o.globals ?? {}) };
      const rest = await Simulation.relaxRest(device, nextCompiled, g, next.rest);
      if (rest) {
        next = { ...next, rest, restRelaxed: true };
        nextCompiled = { ...nextCompiled, rule: next };
      }
      else console.warn(`${next.name}: no steady state found from`, next.rest);
    }

    const sizeChanged = width !== sim.width || height !== sim.height;
    sim.destroy();
    rule = next;
    compiled = nextCompiled;
    if (o.id) ruleId = o.id;
    warnings = o.warnings ?? [];
    if (!o.keepView) note = '';
    globals = { ...defaultGlobals(rule), ...(o.globals ?? globals) };
    for (const k of Object.keys(globals)) if (!rule.params.some((p) => p.name === k)) delete globals[k];
    sim = new Simulation(device, format, width, height, compiled);
    for (const [k, v] of Object.entries(globals)) sim.setGlobal(k, v);

    if (!o.keepView) s.paint = {};
    for (const n of rule.paintable) s.paint[n] ??= globals[n];

    if (carried) {
      const f = remapField(carried, width * height);
      sim.load(f.state, f.params);
    } else {
      const f = initialData(width, height, o.image);
      sim.load(f.state, f.params);
    }

    if (!o.keepView) {
      s.reagent = Math.max(0, rule.reagents.indexOf(rule.view.reagent));
      s.low = rule.view.low;
      s.high = rule.view.high;
      s.tint = rule.view.tint ? rule.reagents.indexOf(rule.view.tint) : -1;
      s.tintLow = 0;
      s.tintHigh = s.tint >= 0 ? 0.4 : 1;
      if (rule.view.stepsPerFrame) s.stepsPerFrame = rule.view.stepsPerFrame;
    }
    s.reagent = Math.min(s.reagent, rule.reagents.length - 1);
    if (s.tint >= rule.reagents.length) s.tint = -1;
    if (width === height) s.gridSize = width;

    // Probe rects stay valid on the same grid; their histories restart either way.
    if (sizeChanged) probes.clear();
    else probes.load(probes.toJSON());
    ghostCache = null;
    probePanel.render();
    stampPanel.render();
    ui.rebuildRule();
    fit();
    return true;
  }

  async function loadScene(id: string, sc: Scene) {
    let r: RuleDef;
    let imp: Awaited<ReturnType<typeof loadBundled>> | null = null;
    if (sc.rule.startsWith('builtin:')) r = clone(BUILTIN_RULES[Number(sc.rule.slice(8))]);
    else {
      imp = await loadBundled(sc.rule.slice(8));
      r = imp.rule;
    }
    if (sc.paintable) r = { ...r, paintable: sc.paintable };
    const size = sc.size ? { width: sc.size, height: sc.size } : r.size;
    const ok = await applyRule(r, { field: 'initial', id, globals: defaultGlobals(r), size, image: imp?.image, warnings: imp?.warnings });
    if (!ok) return;
    if (sc.start === 'rest') sim.clearChemistry();
    for (const p of sc.paint ?? []) {
      const [x, y, w, h] = p.rect;
      const values = rule.paintable.map((n) => p.values[n] ?? globals[n]);
      const params = new Float32Array(w * h * sim.layout.P * 4);
      for (let i = 0; i < w * h; i++) values.forEach((v, k) => (params[i * sim.layout.P * 4 + 1 + k] = v));
      sim.writeRegion(x, y, w, h, params);
    }
    for (const [x, y, w, h] of sc.walls ?? []) {
      sim.brush({ ax: x, ay: y + h / 2, bx: x + w, by: y + h / 2, radius: h / 2, mode: BrushMode.Wall, strength: 1, hardness: 1, paint: paintValues() });
    }
    for (const p of sc.stamps ?? []) {
      const base = stamps.get(p.stamp) ?? STARTER_STAMPS.find((st) => st.id === p.stamp);
      if (!base) {
        warnings.push(`scene stamp "${p.stamp}" not found`);
        continue;
      }
      const st = transformStamp(base, { rot: p.rot ?? 0, flip: p.flip ?? false });
      const f = remapField(st, st.w * st.h);
      const [ox, oy] = stampOrigin(st, p.x, p.y);
      sim.writeRegion(ox, oy, st.w, st.h, f.params, f.state);
    }
    probes.load(sc.probes ?? []);
    probePanel.render();
    const v = sc.view ?? {};
    if (v.reagent) s.reagent = Math.max(0, rule.reagents.indexOf(v.reagent));
    if (v.low !== undefined) s.low = v.low;
    if (v.high !== undefined) s.high = v.high;
    if (v.tint !== undefined) s.tint = rule.reagents.indexOf(v.tint);
    if (v.tintLow !== undefined) s.tintLow = v.tintLow;
    if (v.tintHigh !== undefined) s.tintHigh = v.tintHigh;
    if (sc.stepsPerFrame) s.stepsPerFrame = sc.stepsPerFrame;
    note = sc.description ?? '';
    ui.rebuildRule();
  }

  async function selectRule(id: string) {
    try {
      if (id.startsWith('scene:')) {
        const sc = SCENES.find((x) => x.id === id.slice(6));
        if (sc) await loadScene(id, sc.scene);
      } else if (id.startsWith('builtin:')) {
        const r = clone(BUILTIN_RULES[Number(id.slice(8))]);
        await applyRule(r, { field: 'initial', id, globals: defaultGlobals(r), size: r.size });
      } else if (id.startsWith('pattern:')) {
        const imp = await loadBundled(id.slice(8));
        await applyRule(imp.rule, { field: 'initial', id, globals: defaultGlobals(imp.rule), size: imp.rule.size, image: imp.image, warnings: imp.warnings });
      }
      location.hash = `rule=${encodeURIComponent(id)}`;
    } catch (e) {
      alert(`Couldn't load ${id}: ${(e as Error).message}`);
      ui.rebuildRule();
    }
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
  }, () => rule.reagents[s.reagent]);
  stamps.onChange = () => {
    if (!stamps.get(s.stampId)) s.stampId = stamps.stamps[0]?.id ?? null;
    stampPanel.render();
  };

  const probePanel = probeSection(probes, () => ({ index: s.reagent, name: rule.reagents[s.reagent] }));
  probes.onSample = probePanel.update;

  const ui = buildPanel(panel, s, {
    fillParams: () => sim.fillParams(paintValues()),
    reset: () => {
      const f = initialData(sim.width, sim.height);
      sim.load(f.state, f.params);
    },
    clearChemistry: () => sim.clearChemistry(),
    resize: (size) => applyRule(rule, { field: 'initial', size: { width: size, height: size }, keepView: true }),
    stepOnce: () => {
      s.running = false;
      pendingSteps++;
      ui.sync();
    },
    saveField,
    loadField,
    selectRule,
    importRule: async () => {
      const f = await pickFile('.vti');
      if (!f) return;
      try {
        const imp = await importReady(await f.text(), f.name);
        await applyRule(imp.rule, { field: 'initial', id: `file:${f.name}`, globals: defaultGlobals(imp.rule), size: imp.rule.size, image: imp.image, warnings: imp.warnings });
      } catch (e) {
        alert(`Couldn't import ${f.name}: ${(e as Error).message}`);
      }
    },
    setGlobal: (name, v) => {
      globals[name] = v;
      sim.setGlobal(name, v);
    },
    togglePaintable: (name) => {
      const paintable = rule.paintable.includes(name) ? rule.paintable.filter((n) => n !== name) : [...rule.paintable, name];
      if (paintable.length > 7) {
        alert('At most 7 parameters can be paintable.');
        return;
      }
      applyRule({ ...rule, paintable }, { field: 'carry', keepView: true });
    },
  }, {
    rule: () => rule,
    globals: () => globals,
    choices: ruleChoices,
    currentId: () => ruleId,
    warnings: () => warnings,
    note: () => note,
  }, [stampPanel.node, probePanel.node]);

  if (import.meta.env.DEV) {
    Object.assign(window, {
      rdui: {
        get sim() { return sim; }, get rule() { return rule; }, get globals() { return globals; },
        settings: s, probes, stamps, applyRule, selectRule, get hover() { return hover; },
      },
    });
  }

  async function saveField() {
    const { params, state } = await sim.readRegion(0, 0, sim.width, sim.height);
    const L = sim.layout;
    const blob = encodeSnapshot({
      header: {
        width: sim.width, height: sim.height, probes: probes.toJSON(), rule, globals,
        reagents: L.reagents, paramNames: L.paramNames, S: L.S, P: L.P,
      },
      params, state,
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    download(blob, `rdui-${rule.name.replace(/\W+/g, '_')}-${sim.width}x${sim.height}-${stamp}.rdui`);
  }

  async function loadField() {
    const f = await pickFile('.rdui');
    if (!f) return;
    try {
      const snap = decodeSnapshot(await f.arrayBuffer());
      const h = snap.header;
      const r = h.rule ?? clone(GRAY_SCOTT);
      const ok = await applyRule(r, {
        field: { state: snap.state, params: snap.params, reagents: h.reagents, paramNames: h.paramNames, S: h.S, P: h.P },
        size: { width: h.width, height: h.height },
        globals: h.globals ?? defaultGlobals(r),
        id: `file:${f.name}`,
      });
      if (!ok) return;
      probes.load(h.probes ?? []);
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

  // --- stamp placement helpers: transform, then remap into the current layout by name
  let ghostCache: { key: string; stamp: Stamp; image: HTMLCanvasElement; state: Float32Array; params: Float32Array } | null = null;
  function placedStamp() {
    const base = stamps.get(s.stampId);
    if (!base) return null;
    const key = `${base.id}:${s.stampRot}:${s.stampFlip}:${s.reagent}`;
    if (ghostCache?.key !== key) {
      const stamp = transformStamp(base, { rot: s.stampRot, flip: s.stampFlip });
      const f = remapField(stamp, stamp.w * stamp.h);
      ghostCache = { key, stamp, image: stampThumbnail(stamp, Math.max(stamp.w, stamp.h), rule.reagents[s.reagent]), ...f };
    }
    return ghostCache;
  }
  const stampOrigin = (st: Stamp, x: number, y: number) => [Math.round(x - st.w / 2), Math.round(y - st.h / 2)];

  function placeStamp(x: number, y: number) {
    const g = placedStamp();
    if (!g || (!s.placeParams && !s.placeChem)) return;
    const [ox, oy] = stampOrigin(g.stamp, x, y);
    sim.writeRegion(ox, oy, g.stamp.w, g.stamp.h, s.placeParams ? g.params : undefined, s.placeChem ? g.state : undefined);
  }

  async function captureStamp(r: Rect) {
    const { params, state } = await sim.readRegion(r.x, r.y, r.w, r.h);
    const L = sim.layout;
    const stamp: Stamp = {
      id: newStampId(), name: `stamp ${stamps.stamps.length + 1}`, w: r.w, h: r.h,
      rule: rule.name, reagents: L.reagents, paramNames: L.paramNames, S: L.S, P: L.P, params, state,
    };
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
    rule.paintable.forEach((n, i) => (s.paint[n] = c.params[i + 1]));
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
      paint: paintValues(),
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
    const n = rule.reagents.length;
    const tool = TOOLS.find((t) => t.key === e.key);
    if (tool) s.tool = tool.id;
    else if (e.key === ' ') { s.running = !s.running; e.preventDefault(); }
    else if (e.key === '.') { s.running = false; pendingSteps++; }
    else if (e.key === '[') s.radius = Math.max(1, s.radius - 1);
    else if (e.key === ']') s.radius = Math.min(80, s.radius + 1);
    else if (e.key === 'f') sim.fillParams(paintValues());
    else if (e.key === 'r') { const f = initialData(sim.width, sim.height); sim.load(f.state, f.params); }
    else if (e.key === 'c') sim.clearChemistry();
    else if (e.key === 'v') s.reagent = (s.reagent + 1) % n;
    else if (e.key === 't') s.tint = s.tint + 1 >= n ? -1 : s.tint + 1;
    else if (e.key === 'q') s.stampRot = (s.stampRot + 3) % 4;
    else if (e.key === 'e') s.stampRot = (s.stampRot + 1) % 4;
    else if (e.key === 'x') s.stampFlip = !s.stampFlip;
    else if (e.key === 'Escape') { drag = null; rectDrag = null; }
    else return;
    ui.sync();
    if (e.key === 'v') { probePanel.update(); stampPanel.render(); }
  });

  function viewOptions(): ViewOptions {
    return {
      mode: s.viewMode,
      palette: s.palette,
      reagent: s.reagent,
      low: s.low,
      high: s.high,
      tint: s.tint,
      tintLow: s.tintLow,
      tintHigh: s.tintHigh,
      tintStrength: s.tintStrength,
      paramSlots: rule.paintable.slice(0, 3).map((n, i) => {
        const spec = rule.params.find((p) => p.name === n)!;
        return { slot: i + 1, min: spec.min, max: spec.max };
      }),
    };
  }

  // --- frame loop
  let frames = 0;
  let frameNo = 0;
  let stepsDone = 0;
  let lastStat = performance.now();
  let stats = '';

  function frame() {
    for (const b of strokes.splice(0)) sim.brush(b);

    const enc = device.createCommandEncoder();
    const n = (s.running ? s.stepsPerFrame : 0) + pendingSteps;
    pendingSteps = 0;
    sim.step(enc, n);
    stepsDone += n;
    sim.render(enc, ctx.getCurrentTexture().createView(), canvas.width, canvas.height, viewOptions());
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
    overlay.draw(sim.width, sim.height, probes.probes, s.reagent, dragRect(), s.tool === 'probe' ? '#ffcc66' : '#66d9ff', ghost);

    frames++;
    const now = performance.now();
    if (now - lastStat > 500) {
      const dt = (now - lastStat) / 1000;
      stats = `${(frames / dt).toFixed(0)} fps · ${(stepsDone / dt).toFixed(0)} steps/s · ${sim.width}×${sim.height} · ${rule.name}`;
      frames = stepsDone = 0;
      lastStat = now;
    }
    if (hover && frameNo % 4 === 0) {
      sim.probe(Math.floor(hover[0]), Math.floor(hover[1])).then((c) => {
        if (!c) return;
        const chem = rule.reagents.map((r, i) => `${r} ${fmt(c.state[i])}`).join('  ');
        const prm = rule.paintable.map((p, i) => `${p} ${fmt(c.params[i + 1])}`).join('  ');
        readout.textContent = `${stats}\n(${c.x}, ${c.y})  ${chem}` + (c.wall ? '  wall' : prm ? `\n${prm}` : '');
      });
    } else if (!hover) {
      readout.textContent = stats;
    }
    requestAnimationFrame(frame);
  }

  const wanted = decodeURIComponent(location.hash.match(/rule=([^&]+)/)?.[1] ?? '');
  if (wanted && ruleChoices.some((c) => c.id === wanted)) await selectRule(wanted);
  else await applyRule(rule, { field: 'initial', id: ruleId });
  requestAnimationFrame(frame);
}

init();
