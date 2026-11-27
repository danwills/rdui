import './style.css';
import { recordSection } from './record';
import { inPageTooltips, noteAt } from './tooltip';
import { Simulation, stableAtAnySpacing, BrushMode, type BrushStroke, type CustomChannel, type ViewOptions } from './sim';
import { buildPanel, defaultSettings, el, fmt, HUE_DEFAULTS, hueOffsetFor, TOOLS, type RuleChoice, type Settings } from './ui';
import { ProbeSet, type Rect } from './probes';
import { StampLibrary, newStampId, stampThumbnail, transformStamp, type Stamp } from './stamps';
import { Overlay, type Ghost } from './overlay';
import { stampSection, probeSection } from './panels';
import { encodeSnapshot, decodeSnapshot, download, pickFile } from './snapshot';
import {
  BUILTIN_RULES, MAX_REAGENTS, RULE_FAMILIES, GRAY_SCOTT, RuleError, compileRule, defaultGlobals, initialField, layoutOf, remapCells,
  type CompiledRule, type RuleDef,
} from './rule';
import { BUNDLED_PATTERNS, importReady, loadBundled } from './ready';
import { SCENES, type Scene } from './scenes';
import { UserRules } from './userRules';
import { SavedScenes } from './saved-scenes';
import { openExplorerPanel } from './explorer';
import { openCollection, presetImport } from './collection';
import { startAnalysis } from './analysis';
import { viewColour } from './palettes';
import { STARTER_STAMPS, boostStamp, compositeOnto, stampBackground } from './stamps';

/** An OKLCH colour (lightness 0-1, chroma, hue in turns) as sRGB 0-1, scaled down to fit if it's out of gamut. */
function oklchToRgb(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos(2 * Math.PI * h), b = C * Math.sin(2 * Math.PI * h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, q = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q];
  const srgb = lin.map((x) => { x = Math.max(0, x); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; });
  const top = Math.max(1, ...srgb);
  return srgb.map((x) => x / top) as [number, number, number];
}

/**
 * The custom palette's starting point: every reagent on (untick the ones that only wash it out). Up to
 * three get orange, cyan and green; more get hues spread round the wheel, dimmed by how many are summed
 * so they don't burn out to white. Low and high are fitted to the field once it has some structure.
 * A rule's view can name reagents to start off (customOff: helpers and hidden fields, like a lava lamp's heat).
 */
function defaultCustom(reagents: string[], off: string[] = [], auto = false): CustomChannel[] {
  const colours: [number, number, number][] = [[1, 0.55, 0.2], [0.2, 0.75, 1], [0.6, 1, 0.3]];
  const m = Math.min(reagents.length, MAX_REAGENTS), dim = Math.min(1, 2.2 / m);
  return Array.from({ length: m }, (_, r) => ({
    on: !off.includes(reagents[r]), low: 0, high: 1, power: 1, ...(auto ? { auto } : {}),
    color: m <= 3 ? colours[r] : oklchToRgb(0.72, 0.15, 0.08 + r / m).map((x) => x * dim) as [number, number, number],
  }));
}

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
  /** Run at `size` whatever the resolution setting (scenes laid out cell by cell: stamps, eaters). */
  exact?: boolean;
}

async function init() {
  inPageTooltips();
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const overlayCanvas = document.querySelector<HTMLCanvasElement>('#overlay')!;
  const stage = document.querySelector<HTMLElement>('#stage')!;
  const app = document.querySelector<HTMLElement>('#app')!;
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
  const LAST_RULE_KEY = 'rdui.lastRule';
  let warnings: string[] = [];
  let note = ''; // shown under the rule picker (scene description)
  let globals: Record<string, number> = defaultGlobals(rule);
  for (const n of rule.paintable) s.paint[n] = globals[n];
  s.custom = defaultCustom(rule.reagents, rule.view.customOff, rule.view.customAuto);
  let customFor = ''; // the rule or scene the custom palette was set up for
  // the last session's settings (all but running), rule and its parameters, kept in this browser: everything but the field
  const SESSION_KEY = 'rdui.session';
  type Session = { ruleId: string; settings: Partial<Settings>; globals: Record<string, number> };
  let session: Session | null = null;
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    // storage blocked or garbled: start afresh
  }
  const sessionSettings = () => {
    const { running: _, ...rest } = s;
    return rest;
  };
  if (session?.settings) {
    const defs = defaultSettings();
    // a phone's GPU share remembered at the old default (0.75) takes the phone's own (all of it)
    if (session.settings.gpuShare === 0.75) session.settings.gpuShare = defs.gpuShare;
    // only known keys of the right type (a setting renamed since is left at its default)
    for (const [k, v] of Object.entries(session.settings)) if (k in defs && k !== 'running' && typeof v === typeof (defs as unknown as Record<string, unknown>)[k]) (s as unknown as Record<string, unknown>)[k] = v;
  }
  let sessionSaved = '';
  let sessionT = 0;
  function saveSession() {
    const json = JSON.stringify({ ruleId, settings: sessionSettings(), globals } satisfies Session);
    if (json === sessionSaved) return;
    sessionSaved = json;
    try {
      localStorage.setItem(SESSION_KEY, json);
    } catch {
      // storage blocked: nothing is remembered
    }
  }
  addEventListener('pagehide', saveSession);
  // the custom palette as shown: eases toward s.custom over about s.colourBlend seconds
  let shownCustom: CustomChannel[] = structuredClone(s.custom);
  let shownGrade = [s.customContrast, s.customSaturation, s.customGamma];
  let blendT = performance.now();
  let wanderT = performance.now(); // when wander last randomised
  // and once first fitted, one randomise (new colours and powers): the default look
  let customAutoRandomise = true;
  /*
   * Custom palette ranges that follow the field. Each channel can have a target low/high that its range eases toward
   * (span in log, so a range shrinking from 1 to 1e-7 glides), written by: a channel's auto, which refits it a few times
   * a second for good; a randomise (🎲); and, after its channels are set up afresh, settling: every channel follows the
   * field until the ranges stop moving (under SETTLE_RATE of their span per second, over SETTLE_WINDOW), then holds.
   * Low or high changed by anything else (a slider, Fit) drops the target, and stops that channel settling.
   * Followed ranges have a memory (customMemory, seconds): the target widens at once to take in the field's new extremes
   * but shrinks back towards the field's own range only over that long, so a field that comes and goes in cycles (the
   * mud cracks' weather) keeps steady colours instead of the fit chasing every swing. This is fit v2 (customFit); v1
   * follows the field as it is, and v3 adds the rule's fit floors (see floored).
   */
  const FIT_EVERY = 250, FIT_TAU = 1.2, SETTLE_WINDOW = 2, SETTLE_RATE = 0.05, SETTLE_MAX = 60;
  let fits: { target?: [number, number]; wrote?: [number, number]; touched?: boolean; held?: { lo: number; hi: number; t: number } }[] = [];
  let settle: { t0: number; hist: { t: number; v: ([number, number] | null)[] }[]; rate: number; worst?: string; end?: string } | null = { t0: performance.now(), hist: [], rate: Infinity };
  let fitBusy = false, fitT = 0, fitEaseT = performance.now(), rangeSyncT = 0;
  let compiled: CompiledRule = compileRule(rule);
  let sim = new Simulation(device, format, s.gridSize, s.gridSize, compiled);
  // the field's full-resolution size; the sim runs at full × s.resScale. Separately,
  // feature size sets the grid spacing (cellScale = 1/featureSize): features, seeds
  // and the brush grow with it (so resolution ½ + feature size ½ shows the same picture)
  let full = { width: s.gridSize, height: s.gridSize };
  let cellScale = 1;
  // outline colours by rank: traps take gamma's (orange) slot once one has been drawn
  let trapsDrawn = false;

  const probes = new ProbeSet(device);
  const stamps = new StampLibrary();
  s.stampId = stamps.stamps[0]?.id ?? null;
  const overlay = new Overlay(overlayCanvas);

  const strokes: BrushStroke[] = []; // resolved at input time so later tool changes don't affect them
  let pendingSteps = 0;
  let lastFrameT = performance.now(), stepCarry = 0;
  // sharing the GPU: one frame's work in flight at a time, and the steps scaled by `throttle` so the GPU is busy with
  // ours (submit to done, which counts others' work queued ahead too) for at most gpuShare of the time
  let gpuBusy = false, busyMs = 0, busyT = performance.now(), throttle = 1, gpuUse = 0;
  // no steps while a scene is being set up: its stamps go down one GPU read at a time, and solitons meant to
  // meet in phase must all start on the same step (one frame apart is ~30° of phase for a standard soliton)
  let settingUp = false;

  const userRules = new UserRules();
  const savedScenes = new SavedScenes();
  await savedScenes.load();
  /** The menu group of a bundled Ready pattern: Dan's orbits ones together. */
  const patternGroup = (name: string) => (name.startsWith('orbits') ? 'Orbits' : 'Ready patterns');
  const familyOf = (ruleId: string) => {
    if (ruleId.startsWith('user:')) return 'My rules';
    if (ruleId.startsWith('pattern:')) return patternGroup(ruleId.slice(8));
    if (ruleId.startsWith('vti:')) return 'Ready collection';
    if (!ruleId.startsWith('builtin:')) return 'My rules';
    const r = BUILTIN_RULES[Number(ruleId.slice(8))];
    return RULE_FAMILIES.find(([, rs]) => rs.includes(r))?.[0] ?? 'Other media';
  };
  // rules in family order, then each scene under its rule's family
  const ruleChoices = (): RuleChoice[] => [
    ...userRules.rules.map((u) => ({ id: `user:${u.id}`, label: u.rule.name, group: 'My rules' })),
    ...RULE_FAMILIES.flatMap(([fam, rs]) => rs.map((r) => ({ id: `builtin:${BUILTIN_RULES.indexOf(r)}`, label: r.name, group: fam }))),
    ...BUNDLED_PATTERNS.map((p) => ({ id: `pattern:${p.name}`, label: p.name, group: patternGroup(p.name) })),
    // a preset from the collection (its browser opens with Collection…): only the one running
    ...(ruleId.startsWith('vti:') ? [{ id: ruleId, label: rule.name, group: 'Ready collection' }] : []),
    ...SCENES.map((sc) => ({ id: `scene:${sc.id}`, label: sc.scene.name, group: familyOf(sc.scene.rule), rule: sc.scene.rule })),
    ...savedScenes.scenes.map((sc) => ({ id: `saved:${sc.id}`, label: `★ ${sc.name}`, group: familyOf(sc.base), rule: sc.base })),
  ];

  /** The rule the current field runs: a scene's or saved scene's own rule id, else the current id. */
  function baseRuleId() {
    if (ruleId.startsWith('scene:')) return SCENES.find((x) => x.id === ruleId.slice(6))?.scene.rule ?? ruleId;
    if (ruleId.startsWith('saved:')) return savedScenes.get(ruleId.slice(6))?.base ?? ruleId;
    return ruleId;
  }

  // the view and painting settings a saved scene keeps
  const SAVED_VIEW = ['reagent', 'low', 'high', 'tint', 'tintLow', 'tintHigh', 'tintStrength', 'palette', 'hueShape', 'hueOffset', 'fleckLow', 'fleckHigh', 'fleckGain', 'custom', 'customContrast', 'customSaturation', 'customGamma', 'customHeadroom', 'viewMode', 'stepsPerFrame', 'paint'] as const;

  /** Save the whole field (rule, params, walls, chemistry, probes) and view as a scene in this browser. */
  async function saveScene() {
    const name = prompt('Name for the scene (saved in this browser; Rules menu, ★)', `${rule.name} ${new Date().toLocaleString()}`);
    if (!name) return;
    const { params, state } = await sim.readRegion(0, 0, sim.width, sim.height);
    const L = sim.layout;
    const data = encodeSnapshot({
      header: { width: sim.width, height: sim.height, probes: probes.toJSON(), rule, globals, reagents: L.reagents, paramNames: L.paramNames, S: L.S, P: L.P },
      params, state,
    });
    const view = Object.fromEntries(SAVED_VIEW.map((k) => [k, structuredClone(s[k])]));
    try {
      const sc = await savedScenes.add({ name, base: baseRuleId(), data, view });
      ruleId = `saved:${sc.id}`;
      history.replaceState(history.state, '', `#rule=${encodeURIComponent(ruleId)}`); // the link, without a history entry (Back belongs to the views)
      ui.rebuildRule();
    } catch (e) {
      alert(`Couldn't save the scene: ${(e as Error).message}`);
    }
  }

  async function loadSavedScene(id: string) {
    const sc = savedScenes.get(id.slice(6));
    if (!sc) throw new Error('not in your saved scenes any more');
    const snap = decodeSnapshot(await sc.data.arrayBuffer());
    const h = snap.header;
    const ok = await applyRule(h.rule, {
      field: { state: snap.state, params: snap.params, reagents: h.reagents, paramNames: h.paramNames, S: h.S, P: h.P },
      size: { width: h.width, height: h.height }, globals: h.globals, id,
    });
    if (!ok) return;
    probes.load(h.probes ?? []);
    probePanel.render();
    const v = sc.view as Partial<Settings>;
    for (const k of SAVED_VIEW) if (v[k] !== undefined && (k !== 'stepsPerFrame' || s.ruleSpeed)) (s as unknown as Record<string, unknown>)[k] = v[k];
    note = `Saved ${new Date(sc.created).toLocaleString()} from ${h.rule.name}.`;
    ui.rebuildRule();
  }

  async function deleteSavedScene() {
    const sc = savedScenes.get(ruleId.slice(6));
    if (!ruleId.startsWith('saved:') || !sc || !confirm(`Delete the saved scene "${sc.name}" from this browser?`)) return;
    await savedScenes.remove(sc.id);
    await selectRule(sc.base);
  }

  /**
   * The current rule as a stand-alone rule: parameter values (globals, with any
   * `values` overriding them) and the current view baked in, its initial pattern
   * generator kept; its rest state is relaxed again for the new values.
   */
  function ruleSnapshot(name: string, values: Record<string, number> = {}): RuleDef {
    const g = { ...globals, ...values };
    const r: RuleDef = {
      ...clone(rule),
      name,
      params: rule.params.map((p) => ({ ...p, value: g[p.name], min: Math.min(p.min, g[p.name]), max: Math.max(p.max, g[p.name]) })),
      view: {
        ...rule.view,
        reagent: rule.reagents[s.reagent], low: s.low, high: s.high,
        tint: s.tint >= 0 ? rule.reagents[s.tint] : undefined,
        stepsPerFrame: s.stepsPerFrame, palette: s.palette, hueShape: s.hueShape, hueOffset: s.hueOffset, fleckLow: s.fleckLow, fleckHigh: s.fleckHigh, fleckGain: s.fleckGain, custom: structuredClone(s.custom), customContrast: s.customContrast, customSaturation: s.customSaturation, customGamma: s.customGamma, customHeadroom: s.customHeadroom,
      },
      size: { ...full },
    };
    delete r.restRelaxed;
    return r;
  }

  /** The fleck range from the field: the 2nd to 98th percentile of a, b and c together (a strided sample of the middle 512²). */
  async function fitFleckRange() {
    const w = Math.min(512, sim.width), h = Math.min(512, sim.height);
    const { state } = await sim.readRegion((sim.width - w) >> 1, (sim.height - h) >> 1, w, h);
    const S4 = sim.layout.S * 4, R = Math.min(3, rule.reagents.length), v: number[] = [];
    for (let i = 0; i < w * h; i += 7) for (let r = 0; r < R; r++) {
      const x = state[i * S4 + r];
      if (Number.isFinite(x)) v.push(x);
    }
    if (!v.length) return;
    v.sort((p, q) => p - q);
    const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.floor(v.length * 0.98)];
    s.fleckLow = lo;
    s.fleckHigh = hi > lo ? hi : lo + 1e-3;
    ui.sync();
  }

  /** Custom palette: each reagent's low and high from its 1st to 99th percentile (a strided sample of the middle 512²). */
  /** Each reagent's values, sorted (a strided sample of the middle 512²; non-finite ones left out). */
  async function reagentSamples(): Promise<number[][]> {
    const w = Math.min(512, sim.width), h = Math.min(512, sim.height);
    const { state } = await sim.readRegion((sim.width - w) >> 1, (sim.height - h) >> 1, w, h);
    const S4 = sim.layout.S * 4;
    return s.custom.map((_, r) => {
      const v: number[] = [];
      for (let i = 0; i < w * h; i += 7) if (Number.isFinite(state[i * S4 + r])) v.push(state[i * S4 + r]);
      return v.sort((p, q) => p - q);
    });
  }
  /** A channel's 1st-99th percentile (plus headroom), or null if (nearly) uniform for its size (Smoke lives at ~1e-7). */
  function fitRange(v: number[]): [number, number] | null {
    if (!v.length) return null;
    const lo = v[Math.floor(v.length * 0.01)], hi = v[Math.floor(v.length * 0.99)];
    // the high end leaves headroom above the field's peaks, so they (and reagents overlapping) don't burn out
    return hi - lo > 1e-4 * Math.max(Math.abs(lo), Math.abs(hi)) && hi - lo > 1e-30 ? [lo, hi + s.customHeadroom * (hi - lo)] : null;
  }
  /**
   * Fit v3: a range no narrower than the rule's fit floor for that reagent, widened about its middle, or upwards from
   * its low end when that's at or just above 0 (a reagent that's never negative).
   */
  function floored(r: number, range: [number, number]): [number, number] {
    const floor = s.customFit >= 3 ? rule.fitFloor?.[rule.reagents[r]] : undefined;
    const [lo, hi] = range;
    if (!floor || hi - lo >= floor) return range;
    if (lo >= 0 && lo < floor) return [lo, lo + floor];
    const mid = (lo + hi) / 2;
    return [mid - floor / 2, mid + floor / 2];
  }
  /** Fits a custom channel's low and high to its 1st-99th percentile at once; false if (nearly) uniform. */
  function fitChannel(c: CustomChannel, v: number[]) {
    const f = fitRange(v);
    if (!f) return false;
    [c.low, c.high] = f;
    return true;
  }
  /** Custom palette: fit every reagent's low and high to the field now, or just reagent `only` (yours from then on: it stops settling). */
  async function fitCustom(only?: number) {
    const samples = await reagentSamples();
    s.custom.forEach((c, r) => {
      if (only !== undefined && r !== only) return;
      if (fitChannel(c, samples[r])) fits[r] = { touched: true };
    });
    ui.sync();
  }
  /** Fresh channels: follow the field until their ranges settle. */
  function startSettling() {
    settle = { t0: performance.now(), hist: [], rate: Infinity };
    fits = [];
  }
  /** Writes a channel's range (remembering it, to tell when something else changes it). */
  function writeRange(r: number, lo: number, hi: number) {
    const c = s.custom[r];
    c.low = lo;
    c.high = hi;
    (fits[r] ??= {}).wrote = [lo, hi];
  }
  /** Each frame: a range something else changed loses its target (and stops settling); the rest ease toward theirs. */
  function easeRanges() {
    const t = performance.now(), dt = Math.min(0.25, (t - fitEaseT) / 1000);
    fitEaseT = t;
    const k = 1 - Math.exp(-dt / FIT_TAU);
    if (fits.some((f) => f?.target) && t - rangeSyncT > 250) { rangeSyncT = t; ui.sync(); } // the sliders follow, a few times a second
    s.custom.forEach((c, r) => {
      const f = fits[r];
      if (!f) return;
      if (f.wrote && (c.low !== f.wrote[0] || c.high !== f.wrote[1])) {
        f.target = undefined;
        f.wrote = undefined;
        f.touched = true;
        return;
      }
      if (!f.target) return;
      const [tl, th] = f.target, span = c.high - c.low, ts = th - tl;
      const mid = (c.low + c.high) / 2 + ((tl + th) / 2 - (c.low + c.high) / 2) * k;
      const w = span > 0 && ts > 0 ? Math.exp(Math.log(span) + (Math.log(ts) - Math.log(span)) * k) : span + (ts - span) * k;
      if (Math.abs(mid - (tl + th) / 2) < 1e-3 * ts && Math.abs(w - ts) < 1e-3 * ts) { writeRange(r, tl, th); f.target = undefined; }
      else writeRange(r, mid - w / 2, mid + w / 2);
    });
  }
  /** A few times a second, while anything follows the field: new targets from it, and how settling is going. */
  async function fitTick() {
    if (fitBusy) return;
    fitBusy = true;
    try {
      const samples = await reagentSamples();
      const now = performance.now(), ranges = samples.map(fitRange);
      const settling = !!settle && !settle.end;
      s.custom.forEach((c, r) => {
        const f = (fits[r] ??= {});
        let range = ranges[r];
        if (!range || !(c.auto || (settling && !f.touched))) { f.held = undefined; return; }
        // the remembered extremes: out at once, back in over customMemory
        const h = s.customFit >= 2 ? f.held : undefined, back = h && s.customMemory > 0 ? 1 - Math.exp(-(now - h.t) / 1000 / s.customMemory) : 1;
        f.held = !h ? { lo: range[0], hi: range[1], t: now } : {
          lo: range[0] < h.lo ? range[0] : h.lo + (range[0] - h.lo) * back,
          hi: range[1] > h.hi ? range[1] : h.hi + (range[1] - h.hi) * back,
          t: now,
        };
        range = ranges[r] = floored(r, [f.held.lo, f.held.hi]); // (settling watches these too)
        // a range never fitted (still 0 to 1) takes the field's at once
        if (!f.wrote && c.low === 0 && c.high === 1) { writeRange(r, ...range); f.target = undefined; }
        else f.target = range;
      });
      if (settling && settle) {
        const age = (now - settle.t0) / 1000;
        if (ranges.some(Boolean)) {
          if (customAutoRandomise) { customAutoRandomise = false; await randomiseCustom(false); }
          settle.hist.push({ t: now, v: ranges });
          while (settle.hist.length > 2 && now - settle.hist[1].t > 2 * SETTLE_WINDOW * 1000) settle.hist.shift(); // (one kept from before: slow frames)
          if (now - settle.hist[0].t >= 1.8 * SETTLE_WINDOW * 1000) {
            // how fast the shown channels' ranges drift (hidden ones are fitted along the way but don't hold it up): each channel's mean range over the last window against the one before (a busy
            // field jitters about a steady range, which averages out), the most any end moved per second as a share of its span
            const mid = now - SETTLE_WINDOW * 1000;
            const mean = (r: number, late: boolean) => {
              const vs = settle!.hist.filter((h) => (h.t >= mid) === late && h.v[r]).map((h) => h.v[r]!);
              return vs.length ? [vs.reduce((a, v) => a + v[0], 0) / vs.length, vs.reduce((a, v) => a + v[1], 0) / vs.length] : null;
            };
            const rates = ranges.map((_, r) => {
              const a = mean(r, true), b = mean(r, false);
              return a && b && s.custom[r]?.on ? (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])) / Math.max(a[1] - a[0], b[1] - b[0]) / SETTLE_WINDOW : 0;
            });
            settle.rate = Math.max(0, ...rates);
            settle.worst = rule.reagents[rates.indexOf(settle.rate)] ?? '';
            if (settle.rate < SETTLE_RATE) settle.end = `settled after ${age.toFixed(1)} s`;
          }
        }
        if (!settle.end && age > SETTLE_MAX) settle.end = `stopped after ${SETTLE_MAX} s, still moving ${(settle.rate * 100).toFixed(0)}%/s (most: ${settle.worst})`;
      }
    } finally {
      fitBusy = false;
    }
  }
  /** For the stats line: how the custom palette's ranges are following the field. */
  function fitInfo() {
    if (s.palette !== 7) return '';
    const auto = s.custom.map((c, r) => (c.auto ? rule.reagents[r] : '')).filter(Boolean);
    const st = !settle ? '' : settle.end ?? `settling ${((performance.now() - settle.t0) / 1000).toFixed(1)} s${Number.isFinite(settle.rate) ? `, moving ${(settle.rate * 100).toFixed(0)}%/s (most: ${settle.worst})` : ''}`;
    return [st && `colour ranges: ${st}`, auto.length ? `auto: ${auto.join(' ')}` : ''].filter(Boolean).join(' · ');
  }
  /**
   * Custom palette: new colours and powers for the reagents switched on, chosen to work together, each refitted to the
   * field first.
   * Colours: hues spread evenly round the wheel from a random start (a little jitter), at a fixed
   * perceptual lightness and chroma (OKLCH), dimmed by how many are summed so they don't burn out
   * to white (true colours: raised to 1/exponent first, so they show as picked). Powers: from each reagent's own spread in the field, so its median cell lands at a
   * random 20-45% of its colour (sparse reagents don't vanish, dense ones don't flood), jittered.
   */
  async function randomiseCustom(refit = true) {
    const samples = await reagentSamples();
    if (!s.custom.some((c) => c.on)) s.custom.forEach((c, r) => (c.on = r < 3));
    const on = s.custom.map((c, r) => [c, r] as const).filter(([c]) => c.on);
    const n = on.length, h0 = Math.random(), dim = Math.min(1, 2.2 / n);
    const order = on.map((_, i) => i).sort(() => Math.random() - 0.5);
    on.forEach(([c, r], i) => {
      const v = samples[r];
      // the field's range as it is now (a flat one keeps the range it had): taken at once if never fitted, else eased to
      const fitted = refit || (c.low === 0 && c.high === 1) ? fitRange(v) : null, range = fitted && floored(r, fitted);
      if (range && c.low === 0 && c.high === 1) writeRange(r, ...range);
      else if (range) (fits[r] ??= {}).target = range;
      const [low, high] = fits[r]?.target ?? [c.low, c.high];
      const hue = h0 + order[i] / n + (Math.random() - 0.5) * (0.12 / n);
      // (true colours: raised to 1/exponent here, so the exponent brings them back to the colour picked)
      const pre = s.customTrueColours ? 1 / s.customGamma : 1;
      c.color = oklchToRgb(0.72 + (Math.random() - 0.5) * 0.12, 0.15, hue).map((x) => x ** pre * dim) as [number, number, number];
      const tMed = v.length ? Math.min(1, Math.max(0, (v[v.length >> 1] - low) / (high - low || 1))) : 0.5;
      const target = 0.2 + Math.random() * 0.25;
      const p = tMed > 0.01 && tMed < 0.99 ? Math.log(target) / Math.log(tMed) : Math.exp((Math.random() - 0.5) * 1.6);
      c.power = Math.min(4, Math.max(0.25, p * Math.exp((Math.random() - 0.5) * 0.5)));
    });
    ui.sync();
  }

  /** Dan's Ready collection (collection.ts); the main sim pauses while it's open. */
  async function openCollectionPanel() {
    const wasRunning = s.running;
    s.running = false;
    ui.sync();
    let current;
    // from the collection, or a Ready file (bundled or opened) the collection finds by its file name
    const file = /^(pattern|file):/.test(ruleId) ? ruleId.replace(/^\w+:/, '').split('/').pop()!.replace(/\.vti$/i, '') : undefined;
    if (ruleId.startsWith('vti:') || file) {
      const w = Math.min(256, sim.width), h = Math.min(256, sim.height);
      current = { famId: file ? '' : ruleId.split(':')[1], md5: file ? undefined : ruleId.split(':')[2], file, params: { ...globals }, section: { w, h, state: (await sim.readRegion(Math.floor((sim.width - w) / 2), Math.floor((sim.height - h) / 2), w, h)).state } };
    }
    let reopened = false;
    openCollection({
      device, format, view: viewOptions, current,
      use: (famId, md5, values) => {
        reopened = true;
        // the same family: just the values, on the running field; another: load it first
        const live = ruleId.startsWith(`vti:${famId}:`);
        void (live ? Promise.resolve() : selectRule(`vti:${famId}:${md5}`)).then(() => {
          if (!ruleId.startsWith(`vti:${famId}:`)) return; // it didn't load (selectRule said why)
          for (const [k, v] of Object.entries(values)) {
            if (!(k in globals)) continue;
            globals[k] = v;
            sim.setGlobal(k, v);
          }
          s.running = true;
          ui.rebuildRule();
          ui.sync();
          // the preview carries on as the main view, filling the screen (Back brings the panel)
          if (!app.classList.contains('ui-hidden')) toggleUI('fill');
        });
      },
      onClose: () => {
        if (reopened) return;
        s.running = wasRunning;
        ui.sync();
      },
    });
  }

  /** The explorer (explorer.ts) on the current rule; the main sim pauses while it's open. */
  async function openExplorer() {
    const wasRunning = s.running;
    s.running = false;
    ui.sync();
    // a piece from the middle of the field, for the explorer's sims to start from
    const w = Math.min(256, sim.width), h = Math.min(256, sim.height);
    const section = { w, h, state: (await sim.readRegion(Math.floor((sim.width - w) / 2), Math.floor((sim.height - h) / 2), w, h)).state };
    openExplorerPanel({
      device, format, rule, globals: { ...globals }, section,
      // Paint mode: the current tool's stroke into an explore sim (tools that need the main sim's
      // param layout, or aren't strokes, seed instead)
      brush: (target, ax, ay, bx, by, alt) => {
        const tool = s.tool === 'erase' || s.tool === 'wall' || s.tool === 'unwall' || s.tool === 'smooth' ? s.tool : 'seed';
        const mode = tool === 'erase' ? BrushMode.Erase : tool === 'wall' ? (alt ? BrushMode.Unwall : BrushMode.Wall)
          : tool === 'unwall' ? (alt ? BrushMode.Wall : BrushMode.Unwall) : tool === 'smooth' ? BrushMode.Smooth
          : alt ? BrushMode.Erase : BrushMode.Seed;
        const fft = rule.laplacian === 'spectral' || rule.laplacian === 'spectral-exact';
        target.brush({ ax, ay, bx, by, mode, radius: s.radius / cellScale, strength: s.strength, hardness: s.hardness, paint: [],
          ...(mode === BrushMode.Wall ? { base: s.wallsFeed || fft ? 2 : 1 } : {}), ...(mode === BrushMode.Smooth ? { clear: alt } : {}) });
      },
      view: viewOptions,
      stepsPerFrame: () => s.stepsPerFrame,
      cell: cellScale,
      use: (values) => {
        const bg: Record<string, number> = {};
        for (const [k, v] of Object.entries(values)) {
          if (rule.paintable.includes(k)) bg[k] = v;
          else {
            globals[k] = v;
            sim.setGlobal(k, v);
          }
        }
        if (Object.keys(bg).length) setBackground(bg);
        ui.rebuildRule();
      },
      save: (values) => void saveRuleAs(values),
      onClose: () => {
        s.running = wasRunning;
        ui.sync();
      },
    });
  }

  async function saveRuleAs(values?: Record<string, number>) {
    const name = prompt('Name for the new rule', `${rule.name.replace(/ \(saved.*\)$/, '')} (saved)`);
    if (!name) return;
    const u = userRules.add(ruleSnapshot(name, values));
    if (userRules.saveError) alert(userRules.saveError);
    await selectRule(`user:${u.id}`);
  }

  // (wall distance fields, and params ticked off in Paint Values, get -1e38: the Params brush and Fill all leave them alone)
  const paintValues = () => rule.paintable.map((n) => (rule.params.find((p) => p.name === n)?.distance || s.paintSkip?.[n] ? -1e38 : s.paint[n] ?? globals[n]));
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
    const f = initialField(rule, w, h, globals, 'zero', cellScale);
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
    // a loaded field or imported image comes at its own resolution: run it as given
    const fixed = (o.field !== 'initial' && o.field !== 'carry') || !!o.image || !!o.exact;
    if (o.size) full = fixed ? { width: o.size.width / s.resScale, height: o.size.height / s.resScale } : o.size;
    const scale = o.field === 'carry' ? sim.width / full.width : s.resScale;
    const width = Math.max(8, Math.round(full.width * scale));
    const height = Math.max(8, Math.round(full.height * scale));
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
    cellScale = 1 / s.featureSize;
    sim.setCellScale(cellScale);
    for (const [k, v] of Object.entries(globals)) sim.setGlobal(k, v);

    if (!o.keepView) s.paint = {};
    for (const n of rule.paintable) s.paint[n] ??= globals[n];
    // the Seed tool starts out painting the rule's seed
    if (!o.keepView) s.seedPaint = {};
    rule.reagents.forEach((r, i) => (s.seedPaint[r] ??= { on: rule.seed[i] !== null && rule.seed[i] !== undefined, value: rule.seed[i] ?? rule.rest[i] ?? 0 }));

    trapsDrawn = false;
    if (carried) {
      const f = remapField(carried, width * height);
      sim.load(f.state, f.params);
      const ts = sim.layout.paramNames.indexOf('trap_d'), P4 = sim.layout.P * 4;
      if (ts >= 0) for (let i = ts; i < f.params.length; i += P4) if (f.params[i] < 100) { trapsDrawn = true; break; }
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
      if (rule.view.stepsPerFrame && s.ruleSpeed) s.stepsPerFrame = rule.view.stepsPerFrame;
      // a rule may ask for a palette; leaving one that only it suits goes back to the default (custom)
      if (rule.view.palette !== undefined) s.palette = rule.view.palette;
      else if (s.palette === 5 || s.palette === 6) s.palette = 7;
      s.hueShape = rule.view.hueShape ?? HUE_DEFAULTS.shape;
      s.hueOffset = rule.view.hueOffset ?? hueOffsetFor(s.palette);
      // the fleck range: a rule's own, else 0 to 1 for rules made for the fleck palettes (their
      // look as it was), else the rule's display range (Ready patterns' values go well past 0 to 1)
      s.fleckLow = rule.view.fleckLow ?? (rule.view.palette === 5 || rule.view.palette === 6 ? 0 : Math.min(rule.view.low, 0));
      s.fleckHigh = rule.view.fleckHigh ?? (rule.view.palette === 5 || rule.view.palette === 6 ? 1 : Math.max(rule.view.high, s.fleckLow + 1e-3));
      s.fleckGain = rule.view.fleckGain ?? 1;
      // the custom palette is set up afresh only for a new rule or scene: reloading the same one (a resize,
      // a reset) keeps its colours
      if (ruleId !== customFor) {
        s.custom = rule.view.custom ? structuredClone(rule.view.custom) : defaultCustom(rule.reagents, rule.view.customOff, rule.view.customAuto);
        if (!rule.view.custom) { startSettling(); customAutoRandomise = true; }
        s.customContrast = rule.view.customContrast ?? 1.2;
        s.customSaturation = rule.view.customSaturation ?? 1;
        s.customGamma = rule.view.customGamma ?? 2;
        s.customHeadroom = rule.view.customHeadroom ?? 0.25;
      }
      s.viewMode = rule.view.mode ?? 'reagent';
    }
    s.reagent = Math.min(s.reagent, rule.reagents.length - 1);
    if (s.custom.length !== Math.min(rule.reagents.length, MAX_REAGENTS)) { s.custom = defaultCustom(rule.reagents, rule.view.customOff, rule.view.customAuto); startSettling(); customAutoRandomise = true; }
    if (s.tint >= rule.reagents.length) s.tint = -1;
    customFor = ruleId;
    if (full.width === full.height) s.gridSize = full.width;

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

  async function loadScene(id: string, sc: Scene, size?: { width: number; height: number }) {
    settingUp = true;
    try {
      await setUpScene(id, sc, size);
    } finally {
      settingUp = false;
    }
  }

  /** Set up a scene, at its own size or (unless it's laid out cell by cell) at `want`, its layout scaled to fit. */
  async function setUpScene(id: string, sc: Scene, want?: { width: number; height: number }) {
    let r: RuleDef;
    let imp: Awaited<ReturnType<typeof loadBundled>> | null = null;
    if (sc.rule.startsWith('builtin:')) r = clone(BUILTIN_RULES[Number(sc.rule.slice(8))]);
    else {
      imp = await loadBundled(sc.rule.slice(8));
      r = imp.rule;
    }
    // a scene's paintable list keeps the rule's wall distance fields (drawn with the Wall tool)
    if (sc.paintable) {
      const base = r;
      r = { ...r, paintable: [...sc.paintable, ...base.paintable.filter((n) => base.params.find((p) => p.name === n)?.distance && !sc.paintable!.includes(n))] };
    }
    if (sc.initial) r = { ...r, initial: sc.initial };
    const own = sc.size ? { width: sc.size, height: sc.size } : r.size;
    // (the size its layout is in: its own, else the default grid's)
    const laid = own ?? { width: 512, height: 512 };
    // stamps and eaters sit at exact cells (and a soliton stamp is a set number of cells across), so such
    // a scene runs at its own size whatever the resolution or grid
    const exact = !!(sc.stamps?.length || sc.sdf?.length);
    const resized = !!want && (want.width !== laid.width || want.height !== laid.height);
    const size = want && !exact ? want : own;
    const warn = [...(imp?.warnings ?? []), ...(exact && (s.resScale !== 1 || resized) ? [`This scene runs at its own size (${laid.width}², full resolution): it is laid out cell by cell.`] : [])];
    const ok = await applyRule(r, { field: 'initial', id, globals: { ...defaultGlobals(r), ...sc.globals }, size, image: imp?.image, warnings: warn, exact });
    if (!ok) return;
    // the scene's layout (in its own size's cells) scaled to the cells the sim has (another grid size, or resolution)
    const kx = sim.width / laid.width, ky = sim.height / laid.height, kr = Math.sqrt(kx * ky);
    const box = ([x, y, w, h]: number[]) => [Math.round(x * kx), Math.round(y * ky), Math.max(1, Math.round(w * kx)), Math.max(1, Math.round(h * ky))];
    if (sc.start === 'rest') sim.clearChemistry();
    // Each rect changes only the params it lists, so rects can be layered.
    for (const p of sc.paint ?? []) {
      const [x, y, w, h] = box(p.rect);
      const { params } = await sim.readRegion(x, y, w, h);
      const P4 = sim.layout.P * 4;
      for (const [n, v] of Object.entries(p.values)) {
        const slot = sim.layout.paramNames.indexOf(n);
        if (slot < 1) {
          warnings.push(`scene paints "${n}", which isn't paintable here`);
          continue;
        }
        for (let i = 0; i < w * h; i++) params[i * P4 + slot] = v;
      }
      sim.writeRegion(x, y, w, h, params);
    }
    for (const [x, y, w, h] of (sc.walls ?? []).map(box)) {
      sim.brush({ ax: x, ay: y + h / 2, bx: x + w, by: y + h / 2, radius: h / 2, mode: BrushMode.Wall, strength: 1, hardness: 1, paint: paintValues() });
    }
    for (const w of sc.sdf ?? []) {
      const slot = sim.layout.paramNames.indexOf(w.field);
      if (slot < 0) {
        warnings.push(`scene wall field "${w.field}" isn't in this rule`);
        continue;
      }
      if (w.field === 'trap_d' && !w.cut) trapsDrawn = true;
      sim.brush({ ax: w.x * kx, ay: w.y * ky, bx: (w.x2 ?? w.x) * kx, by: (w.y2 ?? w.y) * ky, radius: w.r * kr, mode: BrushMode.Sdf, strength: 1, hardness: 1, paint: paintValues(), slot, clear: false, base: w.cut ? -1 : 1 });
    }
    for (const p of sc.stamps ?? []) {
      const base = stamps.get(p.stamp) ?? STARTER_STAMPS.find((st) => st.id === p.stamp);
      if (!base) {
        warnings.push(`scene stamp "${p.stamp}" not found`);
        continue;
      }
      let st = transformStamp(base, { rot: p.rot ?? 0, flip: p.flip ?? false });
      if (p.boost) st = boostStamp(st, p.boost.phase ?? 0, p.boost.kx, p.boost.ky, st.id, st.name);
      const f = remapField(st, st.w * st.h);
      const [ox, oy] = stampOrigin(st, Math.round(p.x * kx), Math.round(p.y * ky));
      await compositeStamp(ox, oy, st.w, st.h, f.state, p.params ? f.params : undefined);
    }
    probes.load((sc.probes ?? []).map((q) => { const [x, y, w, h] = box([q.x, q.y, q.w, q.h]); return { ...q, x, y, w, h }; }));
    probePanel.render();
    const v = sc.view ?? {};
    if (v.reagent) s.reagent = Math.max(0, rule.reagents.indexOf(v.reagent));
    if (v.low !== undefined) s.low = v.low;
    if (v.high !== undefined) s.high = v.high;
    if (v.tint !== undefined) s.tint = rule.reagents.indexOf(v.tint);
    if (v.tintLow !== undefined) s.tintLow = v.tintLow;
    if (v.tintHigh !== undefined) s.tintHigh = v.tintHigh;
    if (sc.stepsPerFrame && s.ruleSpeed) s.stepsPerFrame = sc.stepsPerFrame;
    note = sc.description ?? '';
    ui.rebuildRule();
  }

  async function selectRule(id: string) {
    // a rule with just one scene opens as that scene (most only start properly as their scene sets them up)
    const only = id.startsWith('builtin:') ? SCENES.filter((x) => x.scene.rule === id) : [];
    if (only.length === 1) id = `scene:${only[0].id}`;
    try {
      if (id.startsWith('scene:')) {
        const sc = SCENES.find((x) => x.id === id.slice(6));
        if (sc) await loadScene(id, sc.scene);
      } else if (id.startsWith('builtin:')) {
        const r = clone(BUILTIN_RULES[Number(id.slice(8))]);
        await applyRule(r, { field: 'initial', id, globals: defaultGlobals(r), size: r.size });
      } else if (id.startsWith('user:')) {
        const u = userRules.get(id.slice(5));
        if (!u) throw new Error('not in My rules any more');
        const r = clone(u.rule);
        await applyRule(r, { field: 'initial', id, globals: defaultGlobals(r), size: r.size });
      } else if (id.startsWith('saved:')) {
        await loadSavedScene(id);
      } else if (id.startsWith('vti:')) {
        const [, fam, md5] = id.split(':');
        const imp = await presetImport(fam, md5);
        await applyRule(imp.rule, { field: 'initial', id, globals: defaultGlobals(imp.rule), size: imp.rule.size, image: imp.image, warnings: imp.warnings });
      } else if (id.startsWith('pattern:')) {
        const imp = await loadBundled(id.slice(8));
        await applyRule(imp.rule, { field: 'initial', id, globals: defaultGlobals(imp.rule), size: imp.rule.size, image: imp.image, warnings: imp.warnings });
      }
      history.replaceState(history.state, '', `#rule=${encodeURIComponent(id)}`);
      try {
        localStorage.setItem(LAST_RULE_KEY, id);
      } catch {
        // storage blocked: the app just opens on the default next time
      }
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
  }, () => rule.reagents[s.reagent], () => rule);
  stamps.onChange = () => {
    stampPanel.render(); // also moves the selection off deleted or unlisted stamps
  };

  // recording: the recorder steps the sim itself, so the main loop holds still meanwhile
  let heldRunning = false;
  // (dev: set through window.rdui.eachFrame, e.g. lab/record-app.mjs's erase strokes)
  let recordEachFrame: ((frame: number, total: number) => void | Promise<void>) | null = null;
  const recordPanel = recordSection({
    device, sim: () => sim, view: viewOptions, stepsPerFrame: () => s.stepsPerFrame, name: () => rule.name, reagents: () => rule.reagents,
    eachFrame: (i, n) => recordEachFrame?.(i, n),
    hold: (on) => {
      if (on) {
        heldRunning = s.running;
        s.running = false;
      } else if (heldRunning) s.running = true;
      ui.sync();
    },
  });
  const probePanel = probeSection(probes, () => ({ index: s.reagent, name: rule.reagents[s.reagent] }));
  probes.onSample = probePanel.update;

  /** Start the rule or scene over (and look out for a blow-up afresh). */
  function restart() {
    blowSim = null;
    probes.resetHolds();
    if (/^(scene|saved|builtin|user|pattern):/.test(ruleId)) void selectRule(ruleId);
    else {
      const f = initialData(sim.width, sim.height);
      sim.load(f.state, f.params);
    }
  }
  // the field blowing up (Inf or NaN anywhere): checked twice a second while running, and a note over the sim offers a
  // restart or a pause (once per blow-up: it stays away for that field once answered)
  const blowNote = el('div', { class: 'blow-note', hidden: '' });
  stage.append(blowNote);
  let blowSim: Simulation | null = null; // the sim the note was shown (or answered) for
  const hideBlow = () => (blowNote.hidden = true);
  function showBlow() {
    blowSim = sim;
    const btn = (label: string, f: () => void) => {
      const b = el('button', {}, label);
      b.addEventListener('click', () => { hideBlow(); f(); });
      return b;
    };
    blowNote.replaceChildren(
      el('div', {}, 'The field has blown up (Inf or NaN): a parameter or brush has taken it past what the rule can hold. Step back and restart?'),
      el('div', { class: 'buttons' },
        btn('Restart', restart),
        btn('Pause', () => { s.running = false; ui.sync(); }),
        btn('Keep going', () => {}),
      ),
    );
    blowNote.hidden = false;
  }
  const ui = buildPanel(panel, s, {
    fillParams: () => sim.fillParams(paintValues()),
    reset: () => {
      blowSim = null;
      const f = initialData(sim.width, sim.height);
      sim.load(f.state, f.params);
    },
    restart,
    clearChemistry: () => sim.clearChemistry(),
    clearAll: () => {
      // a blank field: rest chemistry, no walls, every param at its global value
      const f = initialField({ ...rule, initial: [] }, sim.width, sim.height, globals, 'rest', cellScale);
      sim.load(f.state, f.params);
    },
    // a scene is loaded again (its stamps, walls and probes too); anything else restarts from the rule's pattern
    resize: (size) => (ruleId.startsWith('scene:') ? loadScene(ruleId, SCENES.find((x) => x.id === ruleId.slice(6))!.scene, { width: size, height: size }) : ruleId.startsWith('saved:') ? selectRule(ruleId) : applyRule(rule, { field: 'initial', size: { width: size, height: size }, keepView: true })),
    stepOnce: () => {
      s.running = false;
      pendingSteps++;
      ui.sync();
    },
    saveField,
    saveScene: () => void saveScene(),
    deleteSavedScene: () => void deleteSavedScene(),
    loadField,
    selectRule,
    importRule: async () => {
      const f = await pickFile('.vti,.json,application/json');
      if (!f) return;
      try {
        if (f.name.endsWith('.json')) {
          const added = userRules.import(await f.text());
          await selectRule(`user:${added[0].id}`);
          return;
        }
        const imp = await importReady(await f.text(), f.name);
        await applyRule(imp.rule, { field: 'initial', id: `file:${f.name}`, globals: defaultGlobals(imp.rule), size: imp.rule.size, image: imp.image, warnings: imp.warnings });
      } catch (e) {
        alert(`Couldn't import ${f.name}: ${(e as Error).message}`);
      }
    },
    saveRule: () => void saveRuleAs(),
    deleteRule: () => {
      const id = ruleId.slice(5);
      if (!ruleId.startsWith('user:') || !confirm(`Delete "${rule.name}" from My rules?`)) return;
      userRules.remove(id);
      void selectRule('builtin:0');
    },
    exportRule: () => {
      const u = userRules.get(ruleId.slice(5));
      if (u) download(new Blob([JSON.stringify(u.rule, null, 2)], { type: 'application/json' }), `${u.rule.name.replace(/[^\w-]+/g, '_')}.rdui-rule.json`);
    },
    explore: () => void openExplorer(),
    collection: () => void openCollectionPanel(),
    fitFleckRange: () => void fitFleckRange(),
    fitCustom: (only?: number) => void fitCustom(only),
    randomiseCustom: () => void randomiseCustom(),
    setGlobal: (name, v) => {
      globals[name] = v;
      sim.setGlobal(name, v);
    },
    setBackground,
    setFeatureSize: () => {
      cellScale = 1 / s.featureSize;
      sim.setCellScale(cellScale);
    },
    toggleUI: (mode?: 'whole' | 'fill' | 'split') => toggleUI(mode),
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
    isUserRule: () => ruleId.startsWith('user:'),
    currentId: () => ruleId,
    warnings: () => warnings,
    note: () => note,
    bigFeatures: () => stableAtAnySpacing(compiled),
  }, [stampPanel.node, probePanel.node, recordPanel.node]);

  if (import.meta.env.DEV) {
    Object.assign(window, {
      rdui: {
        get sim() { return sim; }, get rule() { return rule; }, get globals() { return globals; },
        settings: s, probes, stamps, applyRule, selectRule, get ruleId() { return ruleId; }, get hover() { return hover; }, sync: () => ui.sync(),
        BrushMode, set eachFrame(f: typeof recordEachFrame) { recordEachFrame = f; },
      },
    });
  }
  // The installed app (a production build) runs offline from the service worker's cache.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('service worker not registered', e));
  }

  /**
   * The background (unpainted) values of paintable params are their globals: the
   * initial field is filled from them. Changing them retunes every non-wall cell
   * still holding all the old values, read back and rewritten on the CPU; while a
   * rewrite is in flight, further changes (a drag on the F/k map) just queue up.
   */
  let bgBusy = false;
  let bgQueued: Record<string, number> | null = null;
  function setBackground(values: Record<string, number>) {
    bgQueued = { ...bgQueued, ...values };
    if (!bgBusy) void flushBackground();
  }
  async function flushBackground() {
    bgBusy = true;
    while (bgQueued) {
      const values = bgQueued;
      bgQueued = null;
      const target = sim;
      const names = Object.keys(values).filter((n) => rule.paintable.includes(n));
      const old = names.map((n) => Math.fround(globals[n]));
      for (const n of names) {
        globals[n] = values[n];
        sim.setGlobal(n, values[n]);
      }
      const { params } = await target.readRegion(0, 0, target.width, target.height);
      if (target !== sim) continue; // the rule changed meanwhile
      const P4 = target.layout.P * 4;
      const slots = names.map((n) => target.layout.paramNames.indexOf(n));
      let changed = 0;
      for (let i = 0; i < params.length; i += P4) {
        if (params[i] !== 0 || !slots.every((sl, j) => params[i + sl] === old[j])) continue;
        slots.forEach((sl, j) => (params[i + sl] = values[names[j]]));
        changed++;
      }
      if (changed) target.writeRegion(0, 0, target.width, target.height, params);
    }
    bgBusy = false;
    ui.sync();
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

  // --- canvas sizing: keep the grid's aspect, as large as the stage allows, at device resolution;
  // filling (the narrow ⛶), as large as covers the stage, the rest cropped
  function fit() {
    const r = stage.getBoundingClientRect();
    const filling = app.classList.contains('fill');
    // split: the sim gets the first 55% of the stage's longer side (the analysis the rest)
    const split = app.classList.contains('split');
    const bw = split && r.width > r.height ? r.width * 0.55 : r.width, bh = split && r.width <= r.height ? r.height * 0.55 : r.height;
    const scale = filling
      ? Math.min(Math.max(r.width / sim.width, r.height / sim.height), 4096 / (window.devicePixelRatio || 1) / Math.max(sim.width, sim.height))
      : Math.min((bw - (split ? 8 : 24)) / sim.width, (bh - (split ? 8 : 24)) / sim.height);
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

  // hide/show the panel (H, or the ⛶ buttons): the sim alone, fullscreen where allowed; centred
  // whole, filling the screen (cropped), or split with live analysis (analysis.ts). Back (or Esc,
  // leaving fullscreen) brings the panel back: a history entry catches Back where fullscreen isn't granted.
  const analysisCanvas = document.createElement('canvas');
  analysisCanvas.className = 'analysis';
  stage.append(analysisCanvas);
  let analysis: ReturnType<typeof startAnalysis> | null = null;
  function toggleUI(mode: 'whole' | 'fill' | 'split' = 'whole') {
    const hide = !app.classList.contains('ui-hidden');
    app.classList.toggle('ui-hidden', hide);
    app.classList.toggle('fill', hide && mode === 'fill');
    app.classList.toggle('split', hide && mode === 'split');
    analysis?.stop();
    analysis = hide && mode === 'split' ? startAnalysis(analysisCanvas, {
      sim: () => sim, reagents: () => rule.reagents, shown: () => s.reagent,
      colour: (val) => (s.viewMode === 'params' ? null : viewColour({ palette: s.palette, reagent: s.reagent, low: s.low, high: s.high, custom: shownCustom, grade: shownGrade }, val)),
    }) : null;
    if (hide) {
      history.pushState({ rduiHidden: true }, '');
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (history.state?.rduiHidden) history.back();
    }
    fit();
  }
  window.addEventListener('popstate', () => app.classList.contains('ui-hidden') && toggleUI());
  document.addEventListener('fullscreenchange', () => !document.fullscreenElement && app.classList.contains('ui-hidden') && toggleUI());

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
    if (s.placeChem) void compositeStamp(ox, oy, g.stamp.w, g.stamp.h, g.state, s.placeParams ? g.params : undefined);
    else sim.writeRegion(ox, oy, g.stamp.w, g.stamp.h, g.params);
  }

  /**
   * Add a stamp's chemistry as a deviation from its background (current + stamp − background),
   * so overlapping stamps superpose instead of cutting square seams.
   */
  async function compositeStamp(x: number, y: number, w: number, h: number, state: Float32Array, params?: Float32Array) {
    const W = sim.width, H = sim.height;
    const ox = ((x % W) + W) % W, oy = ((y % H) + H) % H;
    const target = sim;
    const cur = await target.readRegion(ox, oy, w, h);
    if (target !== sim) return; // the rule changed while reading
    sim.writeRegion(ox, oy, w, h, params, compositeOnto(cur.state, state, stampBackground(state, w, h, sim.layout.S, rule.rest.length), sim.layout.S, w * h));
  }

  async function captureStamp(r: Rect) {
    const { params, state } = await sim.readRegion(r.x, r.y, r.w, r.h);
    const L = sim.layout;
    const stamp: Stamp = {
      id: newStampId(), name: `stamp ${stamps.stamps.length + 1}`, w: r.w, h: r.h,
      rule: rule.name, formula: rule.formula, reagents: L.reagents, paramNames: L.paramNames, S: L.S, P: L.P, params, state,
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

  // (x0, y0: where it started)
  // (pts: the path's last few points, which the spline runs through, drawn one point behind)
  let drag: { x: number; y: number; alt: boolean; x0: number; y0: number; pts: [number, number, number][] } | null = null;

  /**
   * The piece of a centripetal Catmull-Rom spline from p1 to p2 (p0 before, p3 after), as brush strokes: as many
   * straight bits as keep it within ~0.2 cells of the curve (1 where it's straight). Centripetal, so it never
   * overshoots into loops at sharp turns.
   */
  function splineStrokes(p0: number[], p1: number[], p2: number[], p3: number[], alt: boolean): BrushStroke[] {
    const knot = (a: number[], b: number[]) => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-3);
    const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const lerp = (a: number[], b: number[], ta: number, tb: number, t: number): [number, number] =>
      [a[0] + ((b[0] - a[0]) * (t - ta)) / (tb - ta), a[1] + ((b[1] - a[1]) * (t - ta)) / (tb - ta)];
    // Barry and Goldman's pyramid
    const at = (u: number): [number, number] => {
      const t = t1 + (t2 - t1) * u;
      const a1 = lerp(p0, p1, 0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
      return lerp(lerp(a1, a2, 0, t2, t), lerp(a2, a3, t1, t3, t), t1, t2, t);
    };
    const m = at(0.5), dev = Math.hypot(m[0] - (p1[0] + p2[0]) / 2, m[1] - (p1[1] + p2[1]) / 2);
    const n = Math.min(16, Math.max(1, Math.ceil(Math.sqrt(dev / 0.2))));
    // the finger's speed over this piece (cells per ms), for a fluid's push to go with it, as a paddle does
    const ms = p2[2] - p1[2], speed = ms > 0 ? Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / ms : undefined;
    const out: BrushStroke[] = [];
    let a = p1;
    for (let k = 1; k <= n; k++) {
      const b = k === n ? p2 : at(k / n);
      // (in the sim's own time: cells per ms over sim time per ms; paused, the rule's own speed)
      const pushSpeed = speed !== undefined && simPerMs > 1e-6 ? speed / simPerMs : undefined;
      out.push(...toBrush(a[0], a[1], b[0], b[1], alt).map((st) => ((st.mode === BrushMode.Stir || st.mode === BrushMode.Jet) && pushSpeed !== undefined ? { ...st, pushSpeed } : st)));
      a = b;
    }
    return out;
  }
  /** A new point on a freehand drag: draws the spline's piece up to the point before it. */
  function dragTo(x: number, y: number, t: number) {
    const d = drag!, pts = d.pts, last = pts[pts.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) < 0.5) return; // (closer than half a cell: wait for more)
    pts.push([x, y, t]);
    if (pts.length > 4) pts.shift();
    if (pts.length >= 3) {
      const n = pts.length;
      strokes.push(...splineStrokes(pts[Math.max(0, n - 4)], pts[n - 3], pts[n - 2], pts[n - 1], d.alt));
    }
    d.x = x;
    d.y = y;
  }
  /** The drag's last piece (up to where it ended), on letting go. */
  function dragEnd() {
    const d = drag;
    if (!d || d.pts.length < 2) return;
    const n = d.pts.length;
    strokes.push(...splineStrokes(d.pts[Math.max(0, n - 3)], d.pts[n - 2], d.pts[n - 1], d.pts[n - 1], d.alt));
  }
  let rectDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** A line or circle being dragged out (brushShape), painted on release. */
  let shapeDrag: { kind: 'line' | 'circle'; x0: number; y0: number; x1: number; y1: number; alt: boolean } | null = null;
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
    if (s.brushShape !== 'free') {
      shapeDrag = { kind: s.brushShape, x0: x, y0: y, x1: x, y1: y, alt };
      return;
    }
    drag = { x, y, alt, x0: x, y0: y, pts: [[x, y, e.timeStamp]] };
    strokes.push(...toBrush(x, y, x, y, alt));
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toGrid(e);
    hover = [x, y];
    if (rectDrag) {
      [rectDrag.x1, rectDrag.y1] = clampToGrid(x, y);
      return;
    }
    if (shapeDrag) {
      shapeDrag.x1 = x;
      shapeDrag.y1 = y;
      return;
    }
    if (!drag) return;
    // every sample the pointer took since the last event (phones take 120-240 a second; events come once a frame)
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) dragTo(...toGrid(ev), ev.timeStamp);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.alt && s.tool === 'smooth') smoothNudge(e.clientX, e.clientY);
    if (drag) dragEnd();
    drag = null;
    if (shapeDrag) {
      const d = shapeDrag;
      shapeDrag = null;
      if (d.kind === 'line') strokes.push(...toBrush(d.x0, d.y0, d.x1, d.y1, d.alt));
      else {
        // a ring of short segments round the centre, about 2 cells each
        const R = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
        const n = Math.max(12, Math.ceil((2 * Math.PI * R) / 2));
        for (let i = 0; i < n; i++) {
          const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
          strokes.push(...toBrush(d.x0 + R * Math.cos(a0), d.y0 + R * Math.sin(a0), d.x0 + R * Math.cos(a1), d.y0 + R * Math.sin(a1), d.alt));
        }
      }
      return;
    }
    const r = dragRect();
    rectDrag = null;
    if (!r) return;
    if (s.tool === 'probe') {
      // with the circle shape, a round probe (the disc inscribed in the dragged rect)
      if (probes.add(r, undefined, false, s.brushShape === 'circle')) probePanel.render();
    } else if (s.tool === 'capture' && r.w >= 2 && r.h >= 2) {
      captureStamp(r);
    }
  });
  canvas.addEventListener('pointercancel', () => {
    drag = null;
    shapeDrag = null;
    rectDrag = null;
  });
  canvas.addEventListener('pointerleave', () => (hover = null));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    s.radius = Math.min(1e6, Math.max(1, Math.round(s.radius * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    ui.sync();
  }, { passive: false });

  // Smooth's left-drag only rounds off walls and blurs painted params: after a few left-drags on a field with neither
  // (it changes nothing to see), a note by the pointer suggests the right-drag, which blurs the pattern; once per rule
  let smoothLeft = 0, smoothHinted = '';
  async function smoothNudge(x: number, y: number) {
    if (smoothHinted === ruleId || ++smoothLeft < 3) return;
    smoothLeft = 0;
    const { params } = await sim.readRegion(0, 0, sim.width, sim.height);
    const P4 = sim.layout.P * 4, np = rule.paintable.length;
    for (let i = 0; i < params.length; i += P4) {
      if (params[i] > 0.5) return; // a wall
      for (let k = 1; k <= np; k++) if (params[i + k] !== params[k]) return; // painted params
    }
    smoothHinted = ruleId;
    noteAt(x, y, 'Left-drag smooths walls and painted parameters, and there are none here. Right-drag to blur the pattern itself.');
  }

  async function eyedrop(x: number, y: number) {
    const c = await sim.probe(Math.floor(x), Math.floor(y));
    if (!c || c.wall) return;
    rule.paintable.forEach((n, i) => (s.paint[n] = c.params[i + 1]));
    ui.sync();
  }

  /** The brush strokes for a segment of the current tool (cutting walls makes one per wall distance field). */
  function toBrush(ax: number, ay: number, bx: number, by: number, alt: boolean): BrushStroke[] {
    let mode: BrushMode;
    switch (s.tool) {
      case 'erase': mode = BrushMode.Erase; break;
      case 'params': mode = BrushMode.Params; break;
      case 'wall': mode = alt ? BrushMode.Unwall : BrushMode.Wall; break;
      case 'unwall': mode = alt ? BrushMode.Wall : BrushMode.Unwall; break;
      case 'smooth': mode = BrushMode.Smooth; break;
      // (a wavefunction fluid: a drag shoves it, a line launches a vortex pair along it)
      case 'push': mode = rule.momentum ? BrushMode.Push : rule.stir ? BrushMode.Stir : rule.vortexPush ? (s.brushShape === 'line' ? BrushMode.Pair : BrushMode.Jet) : BrushMode.Seed; break;
      default: mode = alt ? BrushMode.Erase : BrushMode.Seed; break;
    }
    // wave media: the Wall tool draws reflecting or absorbing walls into the rule's wall distance fields
    // (SDF union; Unwall or right-drag cuts them out); the rule turns distance into potential or damping
    const names = layoutOf(rule).paramNames;
    const field = s.wallsReflect && names.includes('reflect_d') ? 'reflect_d' : s.wallsAbsorb && names.includes('absorb_d') ? 'absorb_d'
      : s.wallsTrap && names.includes('trap_d') ? 'trap_d' : null;
    if ((s.tool === 'wall' || s.tool === 'unwall') && field) {
      const up = (s.tool === 'wall') !== alt;
      const sdf = (f: string): BrushStroke => ({
        ax, ay, bx, by, mode: BrushMode.Sdf, radius: s.radius / cellScale, strength: 1, hardness: 1, paint: paintValues(),
        slot: names.indexOf(f), clear: up && f === 'reflect_d', base: up ? 1 : -1,
      });
      // drawing adds the ticked kind of wall; cutting removes both kinds
      if (up && field === 'trap_d') trapsDrawn = true;
      return up ? [sdf(field)] : ['reflect_d', 'absorb_d', 'trap_d'].filter((f) => names.includes(f)).map(sdf);
    }
    // ordinary walls: sealed, or feeding (FFT rules' walls always feed: see isSealed in rule.ts)
    const fft = rule.laplacian === 'spectral' || rule.laplacian === 'spectral-exact';
    return [{
      ax, ay, bx, by, mode,
      radius: s.radius / cellScale, strength: s.strength, hardness: s.hardness,
      paint: paintValues(),
      seed: rule.reagents.map((r, i) => { const sp = s.seedPaint[r]; return sp ? (sp.on ? sp.value : null) : rule.seed[i] ?? null; }),
      ...(mode === BrushMode.Wall ? { base: s.wallsFeed || fft ? 2 : 1 } : {}),
      ...(mode === BrushMode.Smooth || mode === BrushMode.Push || mode === BrushMode.Stir ? { clear: alt } : {}),
    }];
  }

  // --- keyboard
  // A menu keeps focus after a choice, which would swallow the tool and view keys: let it go.
  document.addEventListener('change', (e) => { if (e.target instanceof HTMLSelectElement) e.target.blur(); });
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
    // a step of 15% (at least a cell), so big brushes don't take a hundred presses
    else if (e.key === '[') s.radius = Math.max(1, Math.min(s.radius - 1, Math.round(s.radius / 1.15)));
    else if (e.key === ']') s.radius = Math.min(1e6, Math.max(s.radius + 1, Math.round(s.radius * 1.15)));
    else if (e.key === 'f') sim.fillParams(paintValues());
    else if (e.key === 'r') { const f = initialData(sim.width, sim.height); sim.load(f.state, f.params); }
    else if (e.key === 'c') sim.clearChemistry();
    else if (e.key === 'v') s.reagent = (s.reagent + 1) % n;
    else if (e.key === 't') s.tint = s.tint + 1 >= n ? -1 : s.tint + 1;
    else if (e.key === 'q') s.stampRot = (s.stampRot + 3) % 4;
    else if (e.key === 'e') s.stampRot = (s.stampRot + 1) % 4;
    else if (e.key === 'x') s.stampFlip = !s.stampFlip;
    else if (e.key === 'h') toggleUI();
    else if (e.key === 'Escape') { drag = null; rectDrag = null; }
    else return;
    ui.sync();
    if (e.key === 'v') { probePanel.update(); stampPanel.render(); }
    if (e.key === 'q' || e.key === 'e' || e.key === 'x') stampPanel.render();
  });

  const colourRank = (n: string) => (trapsDrawn ? ['absorb_d', 'reflect_d', 'V', 'trap_d'] : ['absorb_d', 'reflect_d', 'V', 'gamma']).indexOf(n) >>> 0;

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
      hueShape: s.hueShape,
      hueOffset: s.hueOffset,
      fleckLow: s.fleckLow,
      fleckHigh: s.fleckHigh,
      fleckGain: s.fleckGain,
      ...blendedCustom(),
      showWalls: s.showWalls,
      // param map / outline colours go red, green, blue, orange in this order: absorbing walls red, reflecting
      // walls green, potential V blue, damping gamma (or traps, once drawn) orange, whatever order a scene lists them in
      paramSlots: [...rule.paintable].sort((a, b) => colourRank(a) - colourRank(b)).slice(0, 4).map((n) => {
        const spec = rule.params.find((p) => p.name === n)!;
        return { slot: layoutOf(rule).paramNames.indexOf(n), min: spec.min, max: spec.max, distance: !!spec.distance, base: spec.distance ? globals.wall_grow ?? 0 : globals[n] };
      }),
    };
  }

  // --- frame loop
  let frames = 0;
  let frameNo = 0;
  let stepsDone = 0;
  // how fast sim time goes, per ms of real time (eased): to turn a drag's speed into the sim's own
  let simPerMs = 0;
  let lastStat = performance.now();
  let stats = '';

  /**
   * The custom palette eased toward its settings (colours, fits, powers and grading), so new colours
   * blend in over about s.colourBlend seconds rather than jumping; a reagent switched on or off fades
   * in or out. A change of reagents snaps.
   */
  function blendedCustom() {
    const t = performance.now(), dt = (t - blendT) / 1000;
    blendT = t;
    const k = s.colourBlend > 0 ? 1 - Math.exp((-3 * dt) / s.colourBlend) : 1;
    if (shownCustom.length !== s.custom.length) shownCustom = structuredClone(s.custom);
    const ease = (a: number, b: number) => a + (b - a) * k;
    shownCustom = shownCustom.map((c, r) => {
      const to = s.custom[r];
      // a channel switched off keeps its fit and fades its colour to black
      const col = to.color.map((x) => (to.on ? x : 0));
      return { on: c.on || to.on, low: to.low, high: to.high, power: ease(c.power, to.power), color: c.color.map((x, i) => ease(c.on ? x : 0, col[i])) as [number, number, number] };
    }).map((c, r) => (!s.custom[r].on && Math.max(...c.color) < 1e-3 ? { ...c, on: false } : c));
    shownGrade = [s.customContrast, s.customSaturation, s.customGamma].map((x, i) => ease(shownGrade[i], x));
    return { custom: shownCustom, customContrast: shownGrade[0], customSaturation: shownGrade[1], customGamma: shownGrade[2] };
  }

  let brushTool = s.tool; // the tool the brush settings belong to
  function frame() {
    // the last frame's work isn't done yet: wait, rather than queue more behind it
    if (gpuBusy) { requestAnimationFrame(frame); return; }
    // each tool keeps its own brush (radius, strength, hardness, shape): changing tool (button, key or stamp) puts the
    // old one's away and brings the new one's back, so a small seed and a big erase are a tool switch apart
    if (s.tool !== brushTool) {
      s.toolBrush[brushTool] = { radius: s.radius, strength: s.strength, hardness: s.hardness, brushShape: s.brushShape };
      Object.assign(s, s.toolBrush[s.tool] ?? {});
      brushTool = s.tool;
      ui.sync();
    }
    // wander: a randomise every wanderEvery seconds, while the custom palette shows
    if (!s.customWander || s.palette !== 7 || customAutoRandomise) wanderT = performance.now();
    else if (performance.now() - wanderT > s.wanderEvery * 1000) {
      wanderT = performance.now();
      void randomiseCustom(false); // new colours and powers; the ranges stay
    }
    sim.brushAll(strokes.splice(0));

    const enc = device.createCommandEncoder();
    // steps per frame means per 1/60 s: phones raise the refresh rate (to 120 Hz) while touched,
    // which made painting run the sim faster. Never more per frame than set, so slow frames don't pile up.
    const t = performance.now();
    const elapsed = Math.max(0, t - lastFrameT);
    lastFrameT = t;
    if (t - busyT > 250) {
      gpuUse = busyMs / (t - busyT);
      // ease the steps down when over the share, back up (to all of steps/frame) when under
      throttle = s.gpuShare >= 1 ? 1 : Math.min(1, Math.max(0.01, throttle * Math.min(1.25, Math.max(0.5, s.gpuShare / Math.max(gpuUse, 1e-3)))));
      busyMs = 0;
      busyT = t;
    }
    const due = s.running ? Math.min(s.stepsPerFrame, s.stepsPerFrame * throttle * elapsed / (1000 / 60) + stepCarry) : 0;
    // (whole cycles only, for a rule that takes turns at passes)
    const cycle = rule.stepCycle ?? 1, run = Math.floor(due / cycle) * cycle;
    stepCarry = s.running ? due - run : 0;
    const n = settingUp ? 0 : run + pendingSteps * cycle;
    pendingSteps = 0;
    sim.step(enc, n);
    stepsDone += n;
    if (elapsed > 0 && elapsed < 250) simPerMs += ((n * (globals.timestep ?? 1)) / (rule.stepCycle ?? 1) / elapsed - simPerMs) * 0.1; // (a cycle of passes is one timestep)
    sim.render(enc, ctx.getCurrentTexture().createView(), canvas.width, canvas.height, viewOptions());
    device.queue.submit([enc.finish()]);
    gpuBusy = true;
    const sent = performance.now();
    void device.queue.onSubmittedWorkDone().then(() => { busyMs += performance.now() - sent; gpuBusy = false; });

    if (++frameNo % PROBE_SAMPLE_EVERY === 0) probes.sample(sim);

    let ghost: Ghost | null = null;
    if (s.tool === 'stamp' && hover) {
      const g = placedStamp();
      if (g) {
        const [x, y] = stampOrigin(g.stamp, hover[0], hover[1]);
        ghost = { x, y, w: g.stamp.w, h: g.stamp.h, image: g.image };
      }
    }
    const shape = shapeDrag && { ...shapeDrag, r: s.radius / cellScale };
    overlay.draw(sim.width, sim.height, probes.probes, s.reagent, dragRect(), s.tool === 'probe' ? '#ffcc66' : '#66d9ff', ghost, shape);

    frames++;
    const now = performance.now();
    if (now - lastStat > 500) {
      const dt = (now - lastStat) / 1000;
      stats = `${(frames / dt).toFixed(0)} fps · ${(stepsDone / dt).toFixed(0)} steps/s · GPU ${(gpuUse * 100).toFixed(0)}%${throttle < 0.99 ? ` (eased to ${(throttle * 100).toFixed(0)}% of steps/frame)` : ''} · ${sim.width}×${sim.height} · ${rule.name}`;
      if (s.running && blowSim !== sim) {
        const checked = sim;
        void checked.blownUp().then((bad) => { if (bad && checked === sim && blowSim !== sim) showBlow(); });
      }
      if (blowSim !== sim) hideBlow(); // a new field (restart, rule change, resize) clears the note
      const fi = fitInfo();
      if (fi) stats += `\n${fi}`;
      frames = stepsDone = 0;
      lastStat = now;
    }
    if (s.palette === 7) {
      easeRanges();
      if (now - fitT > FIT_EVERY && ((settle && !settle.end) || s.custom.some((c) => c.auto))) { fitT = now; void fitTick(); }
    }
    readout.hidden = !s.showStats;
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
    if (now - sessionT > 1000) { sessionT = now; saveSession(); }
    requestAnimationFrame(frame);
  }

  // the address's rule, else the one picked last time (the installed app always opens at its start address)
  let last = '';
  try {
    last = localStorage.getItem(LAST_RULE_KEY) ?? '';
  } catch {
    // storage blocked
  }
  const wanted = [decodeURIComponent(location.hash.match(/rule=([^&]+)/)?.[1] ?? ''), last].find((id) => id && ruleChoices().some((c) => c.id === id));
  if (wanted) await selectRule(wanted);
  else await applyRule(rule, { field: 'initial', id: ruleId });
  // the same rule as last time: its view, colours, brush and parameters as they were (loading it set the rule's own)
  if (session && session.ruleId === ruleId) {
    const defs = defaultSettings();
    for (const [k, v] of Object.entries(session.settings ?? {})) if (k in defs && k !== 'running' && typeof v === typeof (defs as unknown as Record<string, unknown>)[k]) (s as unknown as Record<string, unknown>)[k] = v;
    s.reagent = Math.min(s.reagent, rule.reagents.length - 1);
    if (s.tint >= rule.reagents.length) s.tint = -1;
    if (s.custom.length !== Math.min(rule.reagents.length, MAX_REAGENTS)) s.custom = defaultCustom(rule.reagents, rule.view.customOff, rule.view.customAuto);
    else { settle = null; fits = []; customAutoRandomise = false; }
    shownCustom = structuredClone(s.custom);
    shownGrade = [s.customContrast, s.customSaturation, s.customGamma];
    const saved = Object.entries(session.globals ?? {}).filter(([k, v]) => rule.params.some((p) => p.name === k) && typeof v === 'number' && v !== globals[k]);
    const painted = Object.fromEntries(saved.filter(([k]) => rule.paintable.includes(k)));
    for (const [k, v] of saved) if (!(k in painted)) { globals[k] = v; sim.setGlobal(k, v); }
    if (Object.keys(painted).length) setBackground(painted);
    cellScale = 1 / s.featureSize;
    sim.setCellScale(cellScale);
    ui.rebuildRule();
    ui.sync();
  }
  requestAnimationFrame(frame);
}

init();
