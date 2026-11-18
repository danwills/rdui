import { PRESETS } from './presets';
import { F_RANGE, K_RANGE, LOUPE_ZOOM, drawMap, drawMarkers, mapFrame, onMapLoaded, openFKMap, openLoupe } from './fkmap';
import { paramHint, type RuleDef } from './rule';
import type { CustomChannel } from './sim';
import { PALETTES, paletteCss } from './palettes';
import { ladder, onLadderClaim } from './ladder';
import { openColourPicker } from './colourpick';

export type Tool = 'seed' | 'erase' | 'params' | 'wall' | 'unwall' | 'smooth' | 'capture' | 'stamp' | 'probe';

/** Fleck palettes' default hue shape and offset (Dan's picks), the offset per palette: HSV fleck (5), OKLCH fleck (6). */
export const HUE_DEFAULTS = { shape: 1.2, offset: 0.6, offsets: { 5: 0.48, 6: 0.6 } as Record<number, number> };
export const hueOffsetFor = (palette: number) => HUE_DEFAULTS.offsets[palette] ?? HUE_DEFAULTS.offset;

export interface Settings {
  tool: Tool;
  radius: number;
  strength: number;
  /** Each tool's own last radius, strength, hardness and shape (the app swaps them over when the tool changes). */
  toolBrush: Record<string, Partial<Pick<Settings, 'radius' | 'strength' | 'hardness' | 'brushShape'>>>;
  hardness: number;
  /** Brush values for the rule's paintable params. */
  paint: Record<string, number>;
  /** What the F/k map and presets set: the brush values, or the background (unpainted cells). */
  fkTarget: 'brush' | 'background';
  running: boolean;
  stepsPerFrame: number;
  /** Whether loading a rule or scene sets steps/frame (untick to keep your own). */
  ruleSpeed: boolean;
  /** In rules with a paintable potential V, the Wall tool paints reflecting walls of high V instead. */
  wallsReflect: boolean;
  /** In rules with a paintable damping gamma, the Wall tool paints absorbing walls instead (reflect wins if both). */
  wallsAbsorb: boolean;
  /** In rules with traps (trap_d), the Wall tool draws traps instead. */
  wallsTrap: boolean;
  /** Ordinary walls: feeding (hold the rest values, which diffuse out) rather than sealed. */
  wallsFeed: boolean;
  /** Draw walls over the field (they still work when hidden). */
  showWalls: boolean;
  /** Show the stats line (fps, steps/s, size, rule, hovered values) over the sim's top left. */
  showStats: boolean;
  /** Custom palette: how many seconds new colours take to blend in (0 = at once). */
  colourBlend: number;
  /** Custom palette: randomise by itself every wanderEvery seconds. */
  customWander: boolean;
  wanderEvery: number;
  /** How the painting tools draw: freehand, a straight line (press → release), or a circle (centre → radius). */
  brushShape: 'free' | 'line' | 'circle';
  gridSize: number;
  /** Fraction of full resolution the sim runs at (1, ½, ¼, ⅛). */
  resScale: number;
  /** Feature size relative to the rule's own (grid spacing = 1/featureSize); above 1, stencil rules take (featureSize)² shorter steps per step. */
  featureSize: number;
  viewMode: 'reagent' | 'params' | 'outlines';
  /** Displayed reagent index and its range. */
  reagent: number;
  low: number;
  high: number;
  /** Reagent index tinting the display (hidden reagents), or -1. */
  tint: number;
  tintLow: number;
  tintHigh: number;
  tintStrength: number;
  palette: number;
  /** Fleck palettes: hue contrast and shift. */
  hueShape: number;
  hueOffset: number;
  /** Fleck palettes: the range a, b and c are mapped through before becoming colour. */
  fleckLow: number;
  fleckHigh: number;
  fleckGain: number;
  customContrast: number;
  customSaturation: number;
  customGamma: number;
  /** Custom palette: room left above each fitted channel's 99th percentile, as a share of its range (peaks show below full, so overlaps don't burn out). */
  customHeadroom: number;
  /** Custom palette (7): per reagent, fitted, powered, coloured and summed. */
  custom: CustomChannel[];
  stampId: string | null;
  stampRot: number;
  stampFlip: boolean;
  placeParams: boolean;
  placeChem: boolean;
  /** List stamps captured in other rules (other reagents) too. */
  showAllStamps: boolean;
}

export interface Actions {
  fillParams(): void;
  reset(): void;
  /** Reload the current rule or scene from scratch, as if picked from the menu. */
  restart(): void;
  clearChemistry(): void;
  clearAll(): void;
  resize(size: number): void;
  stepOnce(): void;
  saveField(): void;
  saveScene(): void;
  deleteSavedScene(): void;
  loadField(): void;
  selectRule(id: string): void;
  importRule(): void;
  saveRule(): void;
  deleteRule(): void;
  exportRule(): void;
  explore(): void;
  /** Dan's Ready collection: a tree of presets to browse and blend. */
  collection(): void;
  setGlobal(name: string, value: number): void;
  togglePaintable(name: string): void;
  /** Set the rule's base values for paintable params and retune every cell still holding the old ones. */
  setBackground(values: Record<string, number>): void;
  /** Hide/show the panel (the sim alone, centred, fullscreen). */
  toggleUI(mode?: 'whole' | 'fill' | 'split'): void;
  /** Apply s.featureSize to the running sim. */
  setFeatureSize(): void;
  /** Fleck palettes: set the fleck range from the field's values. */
  fitFleckRange(): void;
  /** Custom palette: fit each reagent's low and high to the field. */
  fitCustom(only?: number): void;
  /** Custom palette: new colours and powers that work together. */
  randomiseCustom(): void;
}

/** What the panel needs to know about the current rule. */
export interface RuleContext {
  rule(): RuleDef;
  globals(): Record<string, number>;
  choices(): RuleChoice[];
  /** Whether the current rule is one of "My rules". */
  isUserRule(): boolean;
  currentId(): string;
  warnings(): string[];
  note(): string;
  /** Whether feature sizes above 1 are stable for the current rule. */
  bigFeatures(): boolean;
}

/** A Rules menu entry: a rule, or (with `rule`, the id of the rule it runs) a scene; group = its family. */
export interface RuleChoice { id: string; label: string; group: string; rule?: string }

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'seed', label: 'Seed', key: '1', hint: 'inject the rule\'s seed chemistry · right-drag erases' },
  { id: 'erase', label: 'Erase', key: '2', hint: 'reset reagents to their rest values' },
  { id: 'params', label: 'Params', key: '3', hint: 'paint the paintable parameters · right-click samples' },
  { id: 'wall', label: 'Wall', key: '4', hint: 'no-flux barrier · right-drag removes' },
  { id: 'unwall', label: 'Unwall', key: '8', hint: 'remove walls (e.g. open a door)' },
  { id: 'smooth', label: 'Smooth', key: '9', hint: 'round off walls and blur painted params · right-drag blurs the pattern too · walls thinner than about a sixth of the brush go · strength 0.5 is one full pass a dab, up to 8 at 1' },
  { id: 'capture', label: 'Capture', key: '5', hint: 'drag a rectangle to capture it as a stamp' },
  { id: 'stamp', label: 'Stamp', key: '6', hint: 'click to place the selected stamp · Q/E rotate · X mirror' },
  { id: 'probe', label: 'Probe', key: '7', hint: 'drag a rectangle to measure it · right-click a probe removes it' },
];

export function defaultSettings(): Settings {
  return {
    tool: 'seed',
    radius: 42,
    strength: 1,
    toolBrush: {},
    hardness: 0.6,
    paint: {},
    fkTarget: 'background',
    running: true,
    stepsPerFrame: 10,
    ruleSpeed: true,
    wallsReflect: true,
    wallsAbsorb: false,
    wallsTrap: false,
    wallsFeed: false,
    showWalls: true,
    showStats: false,
    colourBlend: 7,
    customWander: false,
    wanderEvery: 30,
    brushShape: 'free',
    gridSize: 512,
    resScale: 1,
    featureSize: 1,
    viewMode: 'reagent',
    reagent: 1,
    low: 0,
    high: 0.4,
    tint: -1,
    tintLow: 0,
    tintHigh: 1,
    tintStrength: 0.8,
    palette: 7,
    hueShape: HUE_DEFAULTS.shape,
    hueOffset: HUE_DEFAULTS.offset,
    fleckLow: 0,
    fleckHigh: 1,
    fleckGain: 1,
    customContrast: 1.2,
    customSaturation: 1,
    customGamma: 2.5,
    customHeadroom: 0.25,
    custom: [],
    stampId: null,
    stampRot: 0,
    stampFlip: false,
    placeParams: false, // stamps place chemistry only unless asked: no hidden painting
    placeChem: true,
    showAllStamps: false,
  };
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

export function section(title: string, ...children: Node[]) {
  return el('section', {}, el('h2', {}, title), ...children);
}

const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'by', 'in', 'on', 'and', 'or', 'as', 'at', 'for', 'per', 'vs']);
/**
 * Labels in Title Case: each word capitalised, except small ones mid-label, units in brackets ("(s)")
 * and names with underscores or capitals inside (parameter and reagent names keep their own case).
 */
export function titleCase(s: string) {
  return s.replace(/[A-Za-z][\w']*/g, (w: string, at: number) =>
    (at > 0 && SMALL_WORDS.has(w)) || s[at - 1] === '(' || /[A-Z0-9_]/.test(w.slice(1)) ? w : w[0].toUpperCase() + w.slice(1));
}

/** A button; its label in Title Case unless `raw` (names: parameters, presets). */
export function button(label: string, onClick: () => void, title = '', raw = false) {
  const b = el('button', { title }, raw ? label : titleCase(label));
  b.addEventListener('click', onClick);
  return b;
}

/** Compact number formatting for parameter values of any magnitude. */
export function fmt(v: number) {
  if (v === undefined || !Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000 || a < 0.001) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}

/**
 * A labelled range slider plus an editable number. `range` can grow when a
 * typed value falls outside it.
 */
/** Says in a row's tooltip that a middle click puts its default back. */
const resetTip = (row: HTMLElement) => (row.title = row.title ? `${row.title} · middle-click: default` : 'middle-click: default');

/** Middle-click puts a row's value back to its default, for rows without a value ladder (which does this itself). */
function middleReset(row: HTMLElement, reset: () => void) {
  resetTip(row);
  const stop = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
  row.addEventListener('mousedown', stop);
  row.addEventListener('mouseup', stop);
  row.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    reset();
  });
}

function valueRow(label: string, get: () => number, set: (v: number) => void, range: [number, number], extra?: Node, title = label, def?: () => number) {
  const input = el('input', { type: 'range', step: 'any' });
  const num = el('input', { type: 'text', class: 'num', inputmode: 'decimal' });
  const lo = () => Math.min(range[0], get());
  const hi = () => Math.max(range[1], get());
  const refresh = () => {
    input.min = String(lo());
    input.max = String(hi());
    input.value = String(get());
    if (document.activeElement !== num) num.value = fmt(get());
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    num.value = fmt(get());
  });
  num.addEventListener('change', () => {
    const v = Number(num.value);
    if (Number.isFinite(v)) set(v);
    refresh();
  });
  num.addEventListener('keydown', (e) => e.stopPropagation());
  refresh();
  const row = el('label', { class: 'row param', title }, el('span', {}, label), input, num);
  if (extra) row.append(extra);
  ladder(row, { get, set: (v) => { set(v); refresh(); }, range, reset: def && (() => { set(def()); refresh(); }) });
  if (def) resetTip(row);
  return { row, refresh };
}

/** Builds the side panel. Returns `sync()` to refresh widgets and `rebuildRule()` after a rule change. */
/**
 * Sliders don't change by accident (Dan: scrolling past them kept ruining runs). A touch on a
 * slider changes nothing until it's clearly meant: a sideways drag, or a tap (lifted within a few
 * pixels of where it landed: the value where it was tapped). A swipe up or down (the panel
 * scrolling) or a gesture the browser takes over puts the value back. The mouse works as usual,
 * and the wheel never changes a number field. For every slider on the page.
 */
let guarded = false;
export function guardSliders() {
  if (guarded) return;
  guarded = true;
  let touch: { el: HTMLInputElement; value: string; x: number; y: number; ok: boolean; far: boolean; wanted?: string } | null = null;
  onLadderClaim(() => (touch = null)); // the value ladder has the gesture: not a tap, nothing to undo
  const isRange = (t: EventTarget | null): t is HTMLInputElement => t instanceof HTMLInputElement && t.type === 'range';
  const undo = () => {
    if (touch && !touch.ok && touch.el.value !== touch.value) touch.el.value = touch.value;
    touch = null;
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !isRange(e.target)) return;
    touch = { el: e.target, value: e.target.value, x: e.clientX, y: e.clientY, ok: false, far: false };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!touch || touch.ok) return;
    const dx = Math.abs(e.clientX - touch.x), dy = Math.abs(e.clientY - touch.y);
    if (dx > 6 || dy > 6) touch.far = true;
    if (dx > 10 && dx > 2 * dy) {
      touch.ok = true;
      touch.el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (dy > 8) undo();
  }, true);
  document.addEventListener('pointerup', () => {
    if (touch && !touch.ok && !touch.far) {
      // a tap: the value where it landed (as the browser set it, else from the position)
      const el = touch.el, r = el.getBoundingClientRect();
      const lo = Number(el.min || 0), hi = Number(el.max || 100), f = Math.min(1, Math.max(0, (touch.x - r.left) / Math.max(1, r.width)));
      touch.ok = true;
      el.value = touch.wanted ?? String(lo + f * (hi - lo));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (touch?.ok) touch.el.dispatchEvent(new Event('change', { bubbles: true }));
    undo();
  }, true);
  document.addEventListener('pointercancel', undo, true);
  // until the gesture is a sideways drag, the slider's own events don't reach the app
  for (const type of ['input', 'change']) document.addEventListener(type, (e) => {
    if (!touch || touch.ok || e.target !== touch.el) return;
    e.stopImmediatePropagation();
    touch.wanted = touch.el.value;
    touch.el.value = touch.value;
  }, true);
  document.addEventListener('wheel', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'number' && document.activeElement === e.target) e.target.blur();
  }, { capture: true, passive: true });
}

/** Tooltips for the panel's own controls, by the setting each one sets. */
const SETTING_HINTS: Partial<Record<keyof Settings, string>> = {
  reagent: 'which reagent the palette colours',
  low: 'the value shown as the bottom of the palette',
  high: 'the value shown as the top of the palette',
  tint: 'a second reagent that shifts the colour (none: off)',
  tintLow: 'the tint reagent\'s value that tints not at all',
  tintHigh: 'the tint reagent\'s value that tints fully',
  tintStrength: 'how strongly the tint shows: 0 none, 1 full',
  hueShape: 'fleck palettes: hue contrast (1 = even; higher packs the hues toward the ends)',
  hueOffset: 'fleck palettes: turns every hue round the wheel',
  fleckLow: 'fleck palettes: the value of a, b and c shown as none',
  fleckHigh: 'fleck palettes: the value of a, b and c shown as full',
  fleckGain: 'fleck palettes: scales lightness and colourfulness (below 1: less washed out)',
  colourBlend: 'custom palette: seconds new colours take to blend in (0 = at once)',
  wanderEvery: 'custom palette: seconds between wander\'s randomises',
  customHeadroom: 'custom palette: room left above each reagent\'s brightest values when its range is fitted (Auto, settling, Fit, 🎲), as a share of its range: 0.25 shows the brightest 1% at 80%, so overlapping reagents don\'t burn out to white; takes effect at the next fit',
  customGamma: 'custom palette: the summed colour raised to this power first (above 1 darkens the mid-tones)',
  customContrast: 'custom palette: contrast about mid-grey (1 = as is)',
  customSaturation: 'custom palette: colourfulness (0 grey, 1 as is, above 1 more vivid)',
  viewMode: 'what the field shows: the reagents, the reagents with painted params outlined, or the painted params alone',
  radius: 'brush radius, in screen pixels · [ and ] · drag past the end or type for more: bigger than the field covers all of it',
  strength: 'how much each dab moves the field toward the target: 1 sets it outright, lower builds up gradually (down to 1e-7, for fields with tiny values); negative pushes away from it',
  hardness: 'the brush edge: 1 sharp, 0 soft and fading out',
  brushShape: 'freehand strokes, straight lines, or circles',
  stepsPerFrame: 'simulation steps run each frame (per 1/60 s): more is faster, if the GPU keeps up',
  gridSize: 'the field\'s size in cells (bigger is more detail and slower); the field starts over',
  resScale: 'run on fewer cells than the grid (faster, coarser); the field starts over',
  featureSize: 'how big features are, in cells: above 1× the same pattern spans more cells (finer looking, slower)',
};

export function buildPanel(root: HTMLElement, s: Settings, actions: Actions, rc: RuleContext, extraSections: Node[] = []) {
  guardSliders();
  const syncers: (() => void)[] = [];
  const sync = () => syncers.forEach((f) => f());

  function slider(label: string, key: keyof Settings, min: number, max: number, step: number, digits: number, onChange?: () => void, def = () => defaultSettings()[key] as number) {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const out = el('output');
    input.addEventListener('input', () => {
      (s[key] as number) = Number(input.value);
      out.textContent = Number(input.value).toFixed(digits);
      onChange?.();
      sync();
    });
    syncers.push(() => {
      input.value = String(s[key]);
      out.textContent = (s[key] as number).toFixed(digits);
    });
    const row = el('label', { class: 'row', title: SETTING_HINTS[key] ?? label }, el('span', {}, titleCase(label)), input, out);
    ladder(row, {
      get: () => s[key] as number,
      set: (v) => { (s[key] as number) = v; onChange?.(); sync(); },
      range: [min, max], clamp: [min, max],
      reset: () => { (s[key] as number) = def(); onChange?.(); sync(); },
    });
    resetTip(row);
    return row;
  }

  /**
   * An integer slider on a log scale from 1 to `max` (fine at the low end); dragging
   * on past the right end keeps going up the same scale (to `limit`), and the box
   * takes any value typed.
   */
  function logSlider(label: string, key: 'stepsPerFrame' | 'radius', max: number, limit: number, reset: () => number) {
    const input = el('input', { type: 'range', min: '0', max: '1', step: 'any' });
    const num = el('input', { type: 'text', class: 'num', inputmode: 'numeric' });
    const L = Math.log(max);
    const put = (v: number) => {
      s[key] = Math.min(limit, Math.max(1, Math.round(v)));
      sync();
    };
    input.addEventListener('input', () => put(Math.exp(Number(input.value) * L)));
    // past the right end: the input clamps, so follow the pointer ourselves
    input.addEventListener('pointermove', (e) => {
      if (!(e.buttons & 1)) return;
      const r = input.getBoundingClientRect();
      if (e.clientX > r.right) put(max * Math.exp(((e.clientX - r.right) / r.width) * L));
    });
    input.addEventListener('pointerdown', (e) => input.setPointerCapture(e.pointerId));
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (Number.isFinite(v)) put(v);
      sync();
    });
    num.addEventListener('keydown', (e) => e.stopPropagation());
    num.addEventListener('focus', () => num.select()); // typing replaces the value
    syncers.push(() => {
      input.value = String(Math.min(1, Math.log(Math.max(1, s[key])) / L));
      if (document.activeElement !== num) num.value = String(s[key]);
    });
    const row = el('label', { class: 'row log', title: SETTING_HINTS[key] ?? label }, el('span', {}, titleCase(label)), input, num);
    middleReset(row, () => put(reset()));
    return row;
  }

  function checkbox(label: string, key: 'ruleSpeed' | 'wallsReflect' | 'wallsAbsorb' | 'wallsTrap' | 'wallsFeed' | 'showWalls' | 'showStats' | 'customWander', title: string, then?: () => void) {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => { s[key] = input.checked; then?.(); });
    syncers.push(() => (input.checked = s[key]));
    return el('label', { class: 'check', title }, input, titleCase(label));
  }

  /**
   * Brush strength: its size on a log slider from 1e-7 to 1 (Smoke lives at ~1e-7, so its brush must be that light),
   * ± flips its sign (negative pushes away from the target: seed the opposite way, erase exaggerates, smooth sharpens),
   * and the box takes any value from -1 to 1.
   */
  function strengthRow() {
    const MIN = -7;
    const input = el('input', { type: 'range', min: String(MIN), max: '0', step: 'any' });
    const num = el('input', { type: 'text', class: 'num', inputmode: 'decimal' });
    const flip = button('±', () => { s.strength = -s.strength; sync(); }, 'flip the sign: negative pushes away from the target (seeds the opposite way, erase exaggerates, smooth sharpens)');
    flip.classList.add('mini');
    const put = (v: number) => {
      s.strength = Math.max(-1, Math.min(1, v));
      sync();
    };
    input.addEventListener('input', () => put((s.strength < 0 ? -1 : 1) * 10 ** Number(input.value)));
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (Number.isFinite(v)) put(v);
      sync();
    });
    num.addEventListener('keydown', (e) => e.stopPropagation());
    num.addEventListener('focus', () => num.select());
    syncers.push(() => {
      input.value = String(Math.max(MIN, Math.log10(Math.abs(s.strength) || 10 ** MIN)));
      if (document.activeElement !== num) num.value = fmt(s.strength);
      flip.classList.toggle('on', s.strength < 0);
      row.classList.toggle('negative', s.strength < 0);
    });
    const row = el('label', { class: 'row strength', title: SETTING_HINTS.strength ?? 'strength' }, el('span', {}, 'Strength'), input, num, flip);
    ladder(row, { get: () => s.strength, set: put, range: [0, 1], clamp: [-1, 1], reset: () => put(defaultSettings().strength) });
    resetTip(row);
    return row;
  }

  function select(label: string, key: keyof Settings, options: () => [number | string, string][], onChange?: () => void) {
    const sel = el('select');
    const fill = () => {
      sel.replaceChildren(...options().map(([v, name]) => el('option', { value: String(v) }, name)));
    };
    fill();
    sel.addEventListener('change', () => {
      const cur = s[key];
      (s[key] as number | string) = typeof cur === 'number' ? Number(sel.value) : sel.value;
      onChange?.();
      sync();
    });
    syncers.push(() => (sel.value = String(s[key])));
    return { row: el('label', { class: 'row', title: SETTING_HINTS[key] ?? label }, el('span', {}, titleCase(label)), sel), fill };
  }

  /** The palette: a button showing the current one, opening a grid of every palette with its preview. */
  function palettePicker() {
    const choose = (id: number) => {
      s.palette = id;
      // custom: fit the reagents' ranges to the field on first choosing it for this rule
      if (s.palette === 7 && s.custom.every((c) => c.low === 0 && c.high === 1)) actions.fitCustom();
      // a fleck palette starts from its own hue offset
      if (s.palette === 5 || s.palette === 6) s.hueOffset = hueOffsetFor(s.palette);
      // HSV wants a second reagent for the saturation: default to the other one
      const n = rc.rule().reagents.length;
      if (s.palette === 4 && s.tint < 0 && n > 1) {
        s.tint = s.reagent === 0 ? 1 : 0;
        s.tintStrength = 1;
      }
      sync();
    };
    const swatch = el('span', { class: 'pal-swatch' });
    const name = el('span', { class: 'pal-name' });
    const btn = el('button', { class: 'pal-button', title: 'choose a palette' }, swatch, name);
    syncers.push(() => {
      const p = PALETTES.find((q) => q.id === s.palette) ?? PALETTES[0];
      swatch.style.background = paletteCss(p.id, s.custom);
      name.textContent = p.name;
      btn.title = p.title;
    });
    btn.addEventListener('click', () => {
      // tiles apply at once and the grid stays open: Enter, ✕ or a tap outside keep the choice,
      // Esc puts back what was there when it opened
      const was = { palette: s.palette, hueOffset: s.hueOffset, tint: s.tint, tintStrength: s.tintStrength, custom: structuredClone(s.custom) };
      // Back closes it too (keeping the choice): it has a history entry while open
      const close = (popped = false) => {
        sheet.remove();
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('popstate', onPop);
        if (!popped && history.state?.rduiPalette) history.back();
      };
      const onPop = () => close(true);
      history.pushState({ rduiPalette: true }, '');
      window.addEventListener('popstate', onPop);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          Object.assign(s, structuredClone(was));
          sync();
        } else if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        close();
      };
      const groups = [...new Set(PALETTES.map((p) => p.group))];
      const grid = el('div', { class: 'pal-grid' }, ...groups.flatMap((g) => [
        el('div', { class: 'pal-group' }, g),
        ...PALETTES.filter((p) => p.group === g).map((p) => {
          const tile = el('button', { class: 'pal-tile' + (p.id === s.palette ? ' active' : ''), title: p.title },
            el('span', { class: 'pal-swatch', style: `background: ${paletteCss(p.id, s.custom)}` }), el('span', { class: 'pal-name' }, p.name));
          tile.addEventListener('click', () => {
            choose(p.id);
            grid.querySelectorAll('.pal-tile.active').forEach((t) => t.classList.remove('active'));
            tile.classList.add('active');
            tile.blur(); // so Enter means "keep", not "press this tile again"
          });
          return tile;
        }),
      ]));
      const sheet = el('div', { class: 'pal-sheet' }, el('div', { class: 'pal-panel' },
        el('div', { class: 'pal-head' }, el('span', {}, 'Palette'), el('span', { class: 'pal-hint' }, 'Enter keeps · Esc cancels'),
          (() => { const x = el('button', { title: 'done: keep the chosen palette' }, '✕'); x.addEventListener('click', () => close()); return x; })()), grid));
      sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
      document.addEventListener('keydown', onKey, true);
      document.body.append(sheet);
      grid.querySelector('.active')?.scrollIntoView({ block: 'center' });
    });
    return el('label', { class: 'row' }, el('span', {}, 'Palette'), btn);
  }

  function rangeRow(label: string, key: 'low' | 'high' | 'tintLow' | 'tintHigh' | 'fleckLow' | 'fleckHigh', range: [number, number]) {
    // the rule's view range for low and high, the usual tint range; the fleck range has no simple default
    const v = () => rc.rule().view;
    const def = { low: () => v().low, high: () => v().high, tintLow: () => 0, tintHigh: () => (s.tint >= 0 ? 0.4 : 1) }[key as string];
    const r = valueRow(titleCase(label), () => s[key], (x) => (s[key] = x), range, undefined, SETTING_HINTS[key] ?? label, def);
    syncers.push(r.refresh);
    return r.row;
  }

  // --- tools
  const toolRow = el('div', { class: 'tools' });
  const toolHint = el('p', { class: 'hint' });
  // only for rules with wall distance fields (the Schrödinger rule, where real walls leak)
  // (one or the other: ticking one unticks the other)
  const reflectBox = checkbox('walls reflect', 'wallsReflect', 'the Wall tool draws walls of high potential (wall_V) that waves bounce off; untick both for ordinary walls', () => { if (s.wallsReflect) s.wallsAbsorb = s.wallsTrap = false; sync(); });
  const absorbBox = checkbox('walls absorb', 'wallsAbsorb', "the Wall tool draws damping (wall_gamma, fading in gently so it doesn't reflect) that soaks waves up", () => { if (s.wallsAbsorb) s.wallsReflect = s.wallsTrap = false; sync(); });
  const trapBox = checkbox('traps', 'wallsTrap', 'the Wall tool draws traps (click for a round one): a shallow well with friction and gain that catches a soliton, parks it and sets it to the standard power', () => { if (s.wallsTrap) s.wallsReflect = s.wallsAbsorb = false; sync(); });
  // ordinary walls (rules without wall distance fields): sealed, or feeding fresh rest values
  const feedBox = checkbox('walls feed', 'wallsFeed', 'the Wall tool draws walls that hold the rest values (for Gray-Scott a = 1, b = 0: fresh substrate) and let them diffuse out, instead of sealed walls nothing crosses. Feed walls show green. FFT rules always feed: their diffusion can\'t be sealed');
  // in both Tool and View, kept in step
  const showWallsBox = () => checkbox('show walls', 'showWalls', 'untick to hide walls (they still work, just unseen)', sync);
  const wallBoxes = el('div', { class: 'checks' }, reflectBox, absorbBox, trapBox, feedBox, showWallsBox());
  syncers.push(() => {
    const r = rc.rule(), p = r.paintable;
    const fft = r.laplacian === 'spectral' || r.laplacian === 'spectral-exact';
    const sdf = p.includes('reflect_d') || p.includes('absorb_d');
    reflectBox.style.display = p.includes('reflect_d') ? '' : 'none';
    absorbBox.style.display = p.includes('absorb_d') ? '' : 'none';
    trapBox.style.display = p.includes('trap_d') ? '' : 'none';
    feedBox.style.display = sdf ? 'none' : '';
    const fb = feedBox.querySelector('input');
    if (fb) {
      fb.disabled = fft;
      if (fft) fb.checked = true;
    }
    wallBoxes.style.display = '';
  });
  for (const t of TOOLS) {
    const b = button(t.label, () => {
      s.tool = t.id;
      sync();
    }, `${t.hint} (${t.key})`);
    syncers.push(() => b.classList.toggle('active', s.tool === t.id));
    toolRow.append(b);
  }
  syncers.push(() => (toolHint.textContent = TOOLS.find((t) => t.id === s.tool)!.hint));

  // --- rule section (rebuilt when the rule changes)
  // Two menus: the family, then its rules, each followed by its own scenes (indented under it).
  const familySel = el('select', { class: 'rule-select', title: 'rule family' });
  const ruleSel = el('select', { class: 'rule-select', title: 'rule, or one of its scenes (indented under it)' });
  let shownFamily = '';
  function fillRules() {
    const all = rc.choices(), cur = rc.currentId();
    const here = all.find((c) => c.id === cur);
    const family = here?.group ?? (shownFamily || 'Imported');
    shownFamily = family;
    const families = [...new Set(all.map((c) => c.group))];
    if (!families.includes(family)) families.push(family);
    familySel.replaceChildren(...families.map((f) => el('option', { value: f }, f)));
    familySel.value = family;
    const rules = all.filter((c) => !c.rule && c.group === family);
    const scenes = all.filter((c) => c.rule && c.group === family);
    const ruleId = here?.rule ?? cur;
    const opts: HTMLOptionElement[] = [];
    const sceneOpt = (c: RuleChoice) => el('option', { value: c.id }, `\u00a0\u00a0\u00a0\u00a0${c.label}`);
    for (const r of rules) {
      opts.push(el('option', { value: r.id }, r.label));
      opts.push(...scenes.filter((c) => c.rule === r.id).map(sceneOpt));
    }
    // the current rule if it isn't one of the family's (an imported or edited one), with its scenes
    if (!rules.some((c) => c.id === ruleId)) {
      opts.push(el('option', { value: ruleId }, rc.rule().source ?? rc.rule().name));
      opts.push(...scenes.filter((c) => c.rule === ruleId).map(sceneOpt));
    }
    // scenes whose rule isn't listed here
    const placed = new Set(opts.map((o) => o.value));
    opts.push(...scenes.filter((c) => !placed.has(c.id)).map(sceneOpt));
    ruleSel.replaceChildren(...opts);
    ruleSel.value = cur;
  }
  fillRules();
  familySel.addEventListener('change', () => {
    const first = rc.choices().find((c) => !c.rule && c.group === familySel.value);
    if (first) actions.selectRule(first.id);
  });
  ruleSel.addEventListener('change', () => actions.selectRule(ruleSel.value));
  const ruleBody = el('div');
  let ruleSyncers: (() => void)[] = [];
  syncers.push(() => ruleSyncers.forEach((f) => f()));

  function rebuildRule() {
    const rule = rc.rule();
    const globals = rc.globals();
    ruleSyncers = [];
    fillRules();

    const nodes: Node[] = [];
    const warn = rc.warnings();
    if (warn.length) nodes.push(el('p', { class: 'hint error' }, warn.join(' · ')));
    if (rc.note()) nodes.push(el('p', { class: 'note' }, rc.note()));
    if (rule.description) {
      nodes.push(el('details', { class: 'desc' }, el('summary', {}, `${rule.name} · ${rule.reagents.join(' ')}`), el('p', {}, rule.description)));
    }
    nodes.push(el('div', { class: 'buttons' },
      button('Explore…', actions.explore, 'a grid of variants of this rule, and a live map over any two parameters'),
      button('Collection…', actions.collection, 'Dan\'s Ready patterns: rules and their presets as a tree; drag between entries to blend them'),
      button('Save as rule…', actions.saveRule, 'keep this rule with its current parameter values and view under "My rules"'),
      ...(rc.isUserRule() ? [button('Export', actions.exportRule, 'download this rule as a .json file'), button('Delete', actions.deleteRule, 'remove it from My rules')] : []),
    ));

    // Paintable params: brush values.
    const paintBox = el('div', { class: 'paintable' });
    const hasFK = rule.paintable.includes('F') && rule.paintable.includes('k');
    if (hasFK) {
      // the map and presets set either the brush or the background (what unpainted cells hold)
      const target = () => (s.fkTarget === 'brush' ? s.paint : globals);
      const setFK = (F: number, k: number) => {
        if (s.fkTarget === 'brush') {
          s.paint.F = F;
          s.paint.k = k;
        } else actions.setBackground({ F, k });
        sync();
      };
      const pad = buildFKPad(s, () => globals, setFK);
      ruleSyncers.push(pad.draw);
      const targetRow = el('div', { class: 'presets fk-target' }, el('span', { class: 'hint' }, 'Map Sets'));
      for (const [id, label, hint] of [['brush', 'Brush', 'the values the Params tool paints'], ['background', 'Background', 'the unpainted field: every cell still at the old base values follows (painted areas and walls stay); Reset starts from it too']] as const) {
        const b = button(label, () => {
          s.fkTarget = id;
          sync();
        }, hint);
        ruleSyncers.push(() => b.classList.toggle('active', s.fkTarget === id));
        targetRow.append(b);
      }
      targetRow.append(button('Map ⤢', () => openFKMap(s, () => globals, setFK, sync), 'the whole map, with Pearson\'s classes and the bifurcation curves'));
      const presetRow = el('div', { class: 'presets' });
      for (const p of PRESETS) {
        const b = button(p.name, () => setFK(p.feed, p.kill), p.note, true);
        ruleSyncers.push(() => b.classList.toggle('active', Math.abs(target().F - p.feed) < 1e-5 && Math.abs(target().k - p.kill) < 1e-5));
        presetRow.append(b);
      }
      const bgReadout = el('p', { class: 'hint' });
      ruleSyncers.push(() => (bgReadout.textContent = `background F ${globals.F.toFixed(4)} · k ${globals.k.toFixed(4)}`));
      paintBox.append(pad.canvas, targetRow, presetRow, bgReadout);
    }
    for (const name of rule.paintable) {
      const spec = rule.params.find((p) => p.name === name)!;
      if (spec.distance) continue; // drawn with the Wall tool
      const unpaint = button('✕', () => actions.togglePaintable(name), 'stop painting this parameter (make it global)');
      unpaint.classList.add('mini');
      const r = valueRow(name, () => s.paint[name], (v) => {
        s.paint[name] = v;
        sync();
      }, [spec.min, spec.max], unpaint, `${paramHint(rule, spec)} · painted with the Params tool`, () => spec.value);
      ruleSyncers.push(r.refresh);
      paintBox.append(r.row);
    }
    if (!rule.paintable.length) paintBox.append(el('p', { class: 'hint' }, 'No paintable parameters — use 🖌 on a global one below.'));

    // Walls drawn as distance fields: how far to grow (or shrink) them, and their strengths.
    const WALL_PARAMS = ['wall_grow', 'wall_V', 'wall_gamma'];
    const wallBox = el('div', { class: 'globals' });
    for (const spec of rule.params) {
      if (!WALL_PARAMS.includes(spec.name)) continue;
      const r = valueRow(spec.name, () => globals[spec.name], (v) => {
        globals[spec.name] = v;
        actions.setGlobal(spec.name, v);
      }, [spec.min, spec.max], undefined, paramHint(rule, spec), () => spec.value);
      wallBox.append(r.row);
    }

    // Global params: live sliders.
    const globalBox = el('div', { class: 'globals' });
    for (const spec of rule.params) {
      if (rule.paintable.includes(spec.name) || WALL_PARAMS.includes(spec.name)) continue;
      const paint = button('🖌', () => actions.togglePaintable(spec.name), 'make this parameter paintable per cell');
      paint.classList.add('mini');
      const r = valueRow(spec.name, () => globals[spec.name], (v) => {
        globals[spec.name] = v;
        actions.setGlobal(spec.name, v);
      }, [spec.min, spec.max], paint, paramHint(rule, spec), () => spec.value);
      globalBox.append(r.row);
    }

    nodes.push(
      el('h3', {}, 'Paint Values'), paintBox,
      el('div', { class: 'buttons' },
        button('Fill all', actions.fillParams, 'apply the paint values to the whole field (keeps walls) · F'),
        button('Reset', actions.reset, 'regenerate the initial pattern · R'),
        button('Clear all', actions.clearAll, 'a blank field: chemistry at rest, painted params and walls removed (Clear chem keeps them)'),
      ),
      ...(wallBox.childElementCount ? [el('h3', { title: 'walls drawn with the Wall tool (walls reflect / walls absorb): wall_grow moves every edge out (or in, below 0) by that many cells' }, 'Walls'), wallBox] : []),
      el('details', { class: 'globals-wrap', open: '' }, el('summary', {}, `Global Parameters (${globalBox.childElementCount})`), globalBox),
    );
    ruleBody.replaceChildren(...nodes);
    viewReagent.fill();
    viewTint.fill();
    featureSel.fill();
    sync();
  }

  // --- run controls
  const runBtn = button('', () => {
    s.running = !s.running;
    sync();
  }, 'space');
  syncers.push(() => (runBtn.textContent = s.running ? 'Pause' : 'Run'));

  // --- view
  const reagentOptions = (): [number, string][] => rc.rule().reagents.map((r, i) => [i, r]);
  const viewReagent = select('show', 'reagent', reagentOptions);
  // fleck palettes only: the range a, b and c are mapped through before becoming colour
  const fleckRows = el('div', {},
    rangeRow('fleck low', 'fleckLow', [-1, 1]),
    rangeRow('fleck high', 'fleckHigh', [0, 2]),
    slider('intensity', 'fleckGain', 0.05, 1.5, 0.01, 2),
    el('div', { class: 'buttons' }, button('fit fleck range', actions.fitFleckRange, 'set the fleck range from the field: from the 2nd to the 98th percentile of a, b and c together')));
  syncers.push(() => (fleckRows.style.display = s.palette === 5 || s.palette === 6 ? '' : 'none'));

  const viewTint = select('tint by', 'tint', () => [[-1, 'none'], ...reagentOptions()]);
  // only shown where they do something: tint for the one-reagent palettes (not fleck or custom),
  // hue shape and offset for the fleck palettes
  const tintRows = el('div', {}, viewTint.row,
    rangeRow('tint low', 'tintLow', [-1, 1]),
    rangeRow('tint high', 'tintHigh', [-1, 2]),
    slider('tint mix', 'tintStrength', 0, 1, 0.01, 2));
  const hueRows = el('div', {},
    slider('hue shape', 'hueShape', 0.1, 4, 0.01, 2),
    slider('hue offset', 'hueOffset', 0, 1, 0.01, 2));
  // the shown reagent and its range: not for custom (each reagent has its own there)
  const showRows = el('div', {}, viewReagent.row, rangeRow('low', 'low', [-1, 1]), rangeRow('high', 'high', [-1, 2]));
  syncers.push(() => {
    showRows.style.display = s.palette === 7 ? 'none' : '';
    const fleck = s.palette === 5 || s.palette === 6;
    tintRows.style.display = fleck || s.palette === 7 ? 'none' : '';
    hueRows.style.display = fleck ? '' : 'none';
  });

  // the custom palette's eyedropper pauses the sim while it's picking (and only then)
  let heldForDropper = false;
  const holdForDropper = (on: boolean) => {
    if (on && s.running) {
      heldForDropper = true;
      s.running = false;
    } else if (!on && heldForDropper) {
      heldForDropper = false;
      s.running = true;
    }
    sync();
  };

  // custom palette only: per reagent, on/off, colour, low, high, power (rebuilt for each rule)
  const customBox = el('div', {});
  const gradeRows = el('div', {}, slider('blend (s)', 'colourBlend', 0, 10, 0.1, 1),
    el('div', { class: 'checks' }, checkbox('wander', 'customWander', 'randomise the colours by themselves every so often (each blending in over blend)')),
    slider('every (s)', 'wanderEvery', 1, 60, 0.5, 1), slider('headroom', 'customHeadroom', 0, 2, 0.01, 2), slider('exponent', 'customGamma', 0.2, 4, 0.01, 2, undefined, () => rc.rule().view.customGamma ?? 2.5),
      slider('contrast', 'customContrast', 0.5, 3, 0.01, 2, undefined, () => rc.rule().view.customContrast ?? 1.2),
      slider('saturation', 'customSaturation', 0, 3, 0.01, 2, undefined, () => rc.rule().view.customSaturation ?? 1));
  let customKey = '';
  const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  const fillCustom = () => {
    const names = rc.rule().reagents;
    const key = names.join() + ':' + s.custom.length;
    if (key === customKey) return;
    customKey = key;
    const refreshers: (() => void)[] = [];
    const rows: Node[] = [];
    names.slice(0, 12).forEach((name, r) => {
      const ch = () => s.custom[r];
      if (!ch()) return;
      const on = el('input', { type: 'checkbox' });
      on.addEventListener('change', () => (ch().on = on.checked));
      const colour = el('button', { class: 'swatch', title: `${name}'s colour (its contribution at full strength)` });
      colour.addEventListener('click', () => openColourPicker(colour, ch().color, (c) => {
        ch().color = c;
        colour.style.background = toHex(c);
      }, holdForDropper));
      const lo = valueRow('Low', () => ch().low, (v) => (ch().low = v), [-1, 1], undefined, `${name}'s value that shows no colour`, () => 0);
      const hi = valueRow('High', () => ch().high, (v) => (ch().high = v), [0, 2], undefined, `${name}'s value that shows its full colour`, () => 1);
      const pw = valueRow('Power', () => ch().power, (v) => (ch().power = Math.max(0.05, v)), [0.1, 4], undefined, `${name}'s curve from low to high: above 1 shows only its peaks, below 1 lifts the faint parts`, () => 1);
      const auto = el('input', { type: 'checkbox' });
      auto.addEventListener('change', () => { ch().auto = auto.checked; });
      refreshers.push(() => { on.checked = ch().on; auto.checked = !!ch().auto; colour.style.background = toHex(ch().color); lo.refresh(); hi.refresh(); pw.refresh(); });
      const fit = button('fit', () => actions.fitCustom(r), `fit ${name}'s low and high to the field (1st to 99th percentile)`);
      fit.classList.add('mini');
      rows.push(el('div', { class: 'custom-channel' }, el('label', { class: 'check' }, on, name), el('span', { class: 'custom-tools' }, el('label', { class: 'check mini-check', title: `${name}'s low and high follow the field all the time, smoothly (1st to 99th percentile, eased over a second or so): for values that keep drifting` }, auto, 'Auto'), fit, colour)), lo.row, hi.row, pw.row);
    });
    customBox.replaceChildren(
      el('div', { class: 'buttons' },
        button('🎲 randomise', actions.randomiseCustom, 'new colours and powers for the reagents switched on: hues spread round the wheel, powers from each reagent\'s spread in the field'),
        button('enable all', () => { s.custom.slice(0, names.length).forEach((c) => c && (c.on = true)); customRefresh(); }, 'switch every reagent on'),
        button('fit all', () => actions.fitCustom(), "set every reagent's low and high from the field: its 1st to 99th percentile")),
      gradeRows,
      ...rows);
    customRefresh = () => refreshers.forEach((f) => f());
  };
  let customRefresh = () => {};
  syncers.push(() => {
    customBox.style.display = s.palette === 7 ? '' : 'none';
    if (s.palette !== 7) return;
    fillCustom();
    customRefresh();
  });

  const importBtn = button('Import…', actions.importRule, 'load a Ready formula pattern (.vti) or a saved rdui rule (.json)');
  // feature size: ¼–1 for any rule, up to 4 where the rule's diffusion is exact (stable at any size)
  // shown while a saved scene is loaded
  const deleteSceneBtn = button('Delete saved scene', actions.deleteSavedScene, 'remove the current ★ scene from this browser');
  syncers.push(() => (deleteSceneBtn.style.display = rc.currentId().startsWith('saved:') ? '' : 'none'));
  const featureSel = select('feature size', 'featureSize', () => [
    [0.125, '⅛'], [0.25, '¼'], [0.5, '½'], [1, '1×'], ...(rc.bigFeatures() ? [[2, '2×'], [4, '4×']] as [number, string][] : [[2, '2× (4× slower)'], [4, '4× (16× slower)']] as [number, string][]),
  ], actions.setFeatureSize);

  root.append(
    el('header', {}, el('h1', {}, 'rdui'), el('span', { class: 'sub' }, 'reaction-diffusion sandbox'), el('span', { class: 'sub build' }, __BUILD__), button('🎲', () => { s.palette = 7; actions.randomiseCustom(); }, 'new colours: randomise the custom palette (switching to it if another is showing)'), button('⟲', () => actions.restart(), 'restart: start this rule or scene over'), button('⛶', () => actions.toggleUI(), 'hide the panel: just the sim, fullscreen · H (Back or Esc returns)'),
      Object.assign(button('', () => actions.toggleUI('fill'), 'hide the panel and fill the screen with the sim (cropped, no black bars) · Back or Esc returns'), { className: 'narrow', innerHTML: '<span>⛶</span>' }),
      button('◧', () => actions.toggleUI('split'), 'hide the panel: the sim and live analysis (3D histogram, histograms, history) side by side, or stacked on a phone · Back or Esc returns')),
    section('Tool', toolRow, toolHint, wallBoxes,
      // past 80 by dragging on or typing: a brush bigger than the field covers all of it
      logSlider('radius', 'radius', 80, 1e6, () => defaultSettings().radius),
      strengthRow(),
      slider('hardness', 'hardness', 0, 1, 0.01, 2),
      select('shape', 'brushShape', () => [['free', 'freehand'], ['line', 'line (press, drag to the end)'], ['circle', 'circle (press the centre, drag out)']]).row,
    ),
    section('Rule', el('div', { class: 'rule-row' }, familySel, importBtn), el('div', { class: 'rule-row' }, ruleSel), ruleBody),
    section('Simulation',
      el('div', { class: 'buttons' }, runBtn, button('Step', actions.stepOnce, '.'), button('Restart', actions.restart, 'start the rule or scene over from scratch: its own parameters, opening, paint and stamps (Reset keeps your parameters)'), button('Clear chem', actions.clearChemistry, 'C')),
      logSlider('steps/frame', 'stepsPerFrame', 64, 5000, () => rc.rule().view.stepsPerFrame ?? defaultSettings().stepsPerFrame), // the rule's own speed, else the app's
      checkbox('rules set steps/frame', 'ruleSpeed', 'untick to keep your own steps/frame when you load a rule or scene (e.g. to watch a fast one start slowly)'),
      select('grid', 'gridSize', () => [[128, '128²'], [256, '256²'], [512, '512²'], [1024, '1024²'], [2048, '2048²']], () => actions.resize(s.gridSize)).row,
      select('resolution', 'resScale', () => [[1, 'full'], [0.5, '½'], [0.25, '¼'], [0.125, '⅛']], () => actions.resize(s.gridSize)).row,
      featureSel.row,
      el('div', { class: 'buttons' },
        button('Save field…', actions.saveField, 'download the rule, params, walls, chemistry and probes · ctrl+S'),
        button('Load field…', actions.loadField, 'ctrl+O'),
      ),
      el('div', { class: 'buttons' },
        button('Save scene…', actions.saveScene, 'keep the whole field as it is now (chemistry, walls, painted params, probes, view) as a scene in this browser: Rules menu, ★ under its family'),
        deleteSceneBtn,
      ),
    ),
    section('View',
      select('mode', 'viewMode', () => [['reagent', 'reagent'], ['outlines', 'reagent + param outlines'], ['params', 'parameter map']]).row,
      el('div', { class: 'checks' }, showWallsBox(), checkbox('show stats', 'showStats', 'show the stats line over the sim (fps, steps/s, size, rule, and the values under the pointer); never shown fullscreen')),
      showRows,
      tintRows,
      hueRows,
      fleckRows,
      customBox,
      palettePicker(),
    ),
    ...extraSections,
    el('footer', {}, el('p', { class: 'hint' },
      '1–7 tools · [ ] radius · space run/pause · . step · F fill · R reset · C clear · V cycle reagent · T cycle tint · H hide panel · right-click alt action · Esc cancel · hold the middle button on a slider (or long-press it) for a value ladder: up/down picks the step, left/right drags')),
  );

  // the sections as tabs under the header: one at a time, the last one chosen remembered
  const TAB_KEY = 'rdui.panelTab';
  const sections = [...root.querySelectorAll<HTMLElement>(':scope > section')];
  const names = sections.map((sec) => sec.querySelector('h2')?.textContent ?? '');
  let current = names[0];
  try { const t = localStorage.getItem(TAB_KEY); if (t && names.includes(t)) current = t; } catch { /* no storage */ }
  const tabButtons = names.map((n) => button(n, () => showTab(n), `show ${n}`));
  const tabBar = el('nav', { class: 'tabs' }, ...tabButtons);
  root.querySelector(':scope > header')?.after(tabBar);
  function showTab(n: string) {
    current = n;
    try { localStorage.setItem(TAB_KEY, n); } catch { /* no storage */ }
    sections.forEach((sec, i) => (sec.style.display = names[i] === n ? '' : 'none'));
    tabButtons.forEach((b, i) => b.classList.toggle('active', names[i] === n));
    root.scrollTop = 0;
  }
  showTab(current);

  rebuildRule();
  return { sync, rebuildRule };
}

/**
 * The small (kill → x, feed ↑ y) map in the panel: the simulated map dimmed
 * behind presets and the brush/background markers. Pressing picks and shows a
 * magnifier for fine dragging (fkmap.ts).
 */
function buildFKPad(s: Settings, background: () => Record<string, number>, set: (F: number, k: number) => void) {
  const W = 260;
  const H = 170;
  const dpr = window.devicePixelRatio || 1;
  const canvas = el('canvas', { class: 'fkpad', title: 'hold to magnify the map about the current feed (y) and kill (x); drag to move them finely' });
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d')!;
  const frame = mapFrame(W, H);

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, frame, { dim: 0.55, big: false, guides: true });
    drawMarkers(ctx, frame, s, background());
  }
  onMapLoaded(draw);

  // Press: show the magnifier about the current value (wherever the press is:
  // nothing changes yet); drag: move the value at the magnifier's scale (fine
  // control); lift: the magnifier goes. The big map picks values directly. A touch
  // has to be held still for HOLD_MS first, so swiping over the pad still
  // scrolls the panel; a mouse press engages at once.
  const HOLD_MS = 300;
  const SLOP = 8;
  let drag: { x: number; y: number; F: number; k: number; loupe: ReturnType<typeof openLoupe> } | null = null;
  let pending: { id: number; x: number; y: number; timer: number } | null = null;
  const cancelPending = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };
  const end = () => {
    cancelPending();
    drag?.loupe.close();
    drag = null;
  };
  const engage = (id: number, x: number, y: number) => {
    pending = null;
    canvas.setPointerCapture(id);
    const cur = s.fkTarget === 'background' ? background() : s.paint;
    drag = { x, y, F: cur.F, k: cur.k, loupe: openLoupe(s, background) };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return engage(e.pointerId, e.clientX, e.clientY);
    cancelPending();
    const { pointerId: id, clientX: x, clientY: y } = e;
    pending = { id, x, y, timer: window.setTimeout(() => {
      navigator.vibrate?.(15);
      engage(id, x, y);
    }, HOLD_MS) };
  });
  // once engaged, the drag belongs to the map, not the panel's scroll
  canvas.addEventListener('touchmove', (e) => drag && e.cancelable && e.preventDefault(), { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > SLOP) cancelPending();
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const dk = ((e.clientX - drag.x) / r.width) * (K_RANGE[1] - K_RANGE[0]) / LOUPE_ZOOM;
    const dF = (-(e.clientY - drag.y) / r.height) * (F_RANGE[1] - F_RANGE[0]) / LOUPE_ZOOM;
    const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(Math.max(v, lo), hi);
    set(clamp(drag.F + dF, F_RANGE), clamp(drag.k + dk, K_RANGE));
    drag.loupe.draw();
  });
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return { canvas, draw };
}
