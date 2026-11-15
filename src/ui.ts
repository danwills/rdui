import { PRESETS } from './presets';
import { F_RANGE, K_RANGE, LOUPE_ZOOM, drawMap, drawMarkers, mapFrame, onMapLoaded, openFKMap, openLoupe } from './fkmap';
import type { RuleDef } from './rule';

export type Tool = 'seed' | 'erase' | 'params' | 'wall' | 'unwall' | 'capture' | 'stamp' | 'probe';

/** Fleck palettes' default hue shape and offset (Dan's pick: works for both HSV and OKLCH). */
export const HUE_DEFAULTS = { shape: 1.2, offset: 0.6 };

export interface Settings {
  tool: Tool;
  radius: number;
  strength: number;
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
  setGlobal(name: string, value: number): void;
  togglePaintable(name: string): void;
  /** Set the rule's base values for paintable params and retune every cell still holding the old ones. */
  setBackground(values: Record<string, number>): void;
  /** Hide/show the panel (the sim alone, centred, fullscreen). */
  toggleUI(): void;
  /** Apply s.featureSize to the running sim. */
  setFeatureSize(): void;
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
  { id: 'capture', label: 'Capture', key: '5', hint: 'drag a rectangle to capture it as a stamp' },
  { id: 'stamp', label: 'Stamp', key: '6', hint: 'click to place the selected stamp · Q/E rotate · X mirror' },
  { id: 'probe', label: 'Probe', key: '7', hint: 'drag a rectangle to measure it · right-click a probe removes it' },
];

export function defaultSettings(): Settings {
  return {
    tool: 'seed',
    radius: 8,
    strength: 1,
    hardness: 0.6,
    paint: {},
    fkTarget: 'background',
    running: true,
    stepsPerFrame: 10,
    ruleSpeed: true,
    wallsReflect: true,
    wallsAbsorb: false,
    wallsTrap: false,
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
    palette: 0,
    hueShape: HUE_DEFAULTS.shape,
    hueOffset: HUE_DEFAULTS.offset,
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

export function button(label: string, onClick: () => void, title = '') {
  const b = el('button', { title }, label);
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
function valueRow(label: string, get: () => number, set: (v: number) => void, range: [number, number], extra?: Node) {
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
  const row = el('label', { class: 'row param', title: label }, el('span', {}, label), input, num);
  if (extra) row.append(extra);
  return { row, refresh };
}

/** Builds the side panel. Returns `sync()` to refresh widgets and `rebuildRule()` after a rule change. */
export function buildPanel(root: HTMLElement, s: Settings, actions: Actions, rc: RuleContext, extraSections: Node[] = []) {
  const syncers: (() => void)[] = [];
  const sync = () => syncers.forEach((f) => f());

  function slider(label: string, key: keyof Settings, min: number, max: number, step: number, digits: number, onChange?: () => void) {
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
    return el('label', { class: 'row' }, el('span', {}, label), input, out);
  }

  /**
   * An integer slider on a log scale from 1 to `max` (fine at the low end); dragging
   * on past the right end keeps going up the same scale (to `limit`), and the box
   * takes any value typed.
   */
  function logSlider(label: string, key: 'stepsPerFrame', max: number, limit: number) {
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
    return el('label', { class: 'row log' }, el('span', {}, label), input, num);
  }

  function checkbox(label: string, key: 'ruleSpeed' | 'wallsReflect' | 'wallsAbsorb' | 'wallsTrap', title: string, then?: () => void) {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => { s[key] = input.checked; then?.(); });
    syncers.push(() => (input.checked = s[key]));
    return el('label', { class: 'check', title }, input, label);
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
    return { row: el('label', { class: 'row' }, el('span', {}, label), sel), fill };
  }

  function rangeRow(label: string, key: 'low' | 'high' | 'tintLow' | 'tintHigh', range: [number, number]) {
    const r = valueRow(label, () => s[key], (v) => (s[key] = v), range);
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
  const wallBoxes = el('div', { class: 'checks' }, reflectBox, absorbBox, trapBox);
  syncers.push(() => {
    const p = rc.rule().paintable;
    reflectBox.style.display = p.includes('reflect_d') ? '' : 'none';
    absorbBox.style.display = p.includes('absorb_d') ? '' : 'none';
    trapBox.style.display = p.includes('trap_d') ? '' : 'none';
    wallBoxes.style.display = p.includes('reflect_d') || p.includes('absorb_d') ? '' : 'none';
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
  // Three menus: the family, its rules, and its scenes.
  const familySel = el('select', { class: 'rule-select', title: 'rule family' });
  const ruleSel = el('select', { class: 'rule-select', title: 'rule' });
  const sceneSel = el('select', { class: 'rule-select', title: 'scenes for this family' });
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
    ruleSel.replaceChildren(...rules.map((c) => el('option', { value: c.id }, c.label)));
    const ruleId = here?.rule ?? cur;
    if (!rules.some((c) => c.id === ruleId)) ruleSel.append(el('option', { value: ruleId }, rc.rule().source ?? rc.rule().name));
    ruleSel.value = ruleId;
    const scenes = all.filter((c) => c.rule && c.group === family);
    sceneSel.replaceChildren(el('option', { value: '' }, scenes.length ? `scenes (${scenes.length})…` : 'no scenes'),
      ...scenes.map((c) => el('option', { value: c.id }, c.label)));
    sceneSel.disabled = !scenes.length;
    sceneSel.value = here?.rule ? cur : '';
  }
  fillRules();
  familySel.addEventListener('change', () => {
    const first = rc.choices().find((c) => !c.rule && c.group === familySel.value);
    if (first) actions.selectRule(first.id);
  });
  ruleSel.addEventListener('change', () => actions.selectRule(ruleSel.value));
  sceneSel.addEventListener('change', () => { if (sceneSel.value) actions.selectRule(sceneSel.value); });
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
      const targetRow = el('div', { class: 'presets fk-target' }, el('span', { class: 'hint' }, 'map sets'));
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
        const b = button(p.name, () => setFK(p.feed, p.kill), p.note);
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
      }, [spec.min, spec.max], unpaint);
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
      }, [spec.min, spec.max]);
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
      }, [spec.min, spec.max], paint);
      globalBox.append(r.row);
    }

    nodes.push(
      el('h3', {}, 'Paint values'), paintBox,
      el('div', { class: 'buttons' },
        button('Fill all', actions.fillParams, 'apply the paint values to the whole field (keeps walls) · F'),
        button('Reset', actions.reset, 'regenerate the initial pattern · R'),
        button('Clear all', actions.clearAll, 'a blank field: chemistry at rest, painted params and walls removed (Clear chem keeps them)'),
      ),
      ...(wallBox.childElementCount ? [el('h3', { title: 'walls drawn with the Wall tool (walls reflect / walls absorb): wall_grow moves every edge out (or in, below 0) by that many cells' }, 'Walls'), wallBox] : []),
      el('details', { class: 'globals-wrap' }, el('summary', {}, `Global parameters (${globalBox.childElementCount})`), globalBox),
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
  const viewTint = select('tint by', 'tint', () => [[-1, 'none'], ...reagentOptions()]);

  const importBtn = button('Import…', actions.importRule, 'load a Ready formula pattern (.vti) or a saved rdui rule (.json)');
  // feature size: ¼–1 for any rule, up to 4 where the rule's diffusion is exact (stable at any size)
  // shown while a saved scene is loaded
  const deleteSceneBtn = button('Delete saved scene', actions.deleteSavedScene, 'remove the current ★ scene from this browser');
  syncers.push(() => (deleteSceneBtn.style.display = rc.currentId().startsWith('saved:') ? '' : 'none'));
  const featureSel = select('feature size', 'featureSize', () => [
    [0.125, '⅛'], [0.25, '¼'], [0.5, '½'], [1, '1×'], ...(rc.bigFeatures() ? [[2, '2×'], [4, '4×']] as [number, string][] : [[2, '2× (4× slower)'], [4, '4× (16× slower)']] as [number, string][]),
  ], actions.setFeatureSize);

  root.append(
    el('header', {}, el('h1', {}, 'rdui'), el('span', { class: 'sub' }, 'reaction-diffusion sandbox'), el('span', { class: 'sub build' }, __BUILD__), button('⛶', actions.toggleUI, 'hide the panel: just the sim, fullscreen · H')),
    section('Tool', toolRow, toolHint, wallBoxes,
      slider('radius', 'radius', 1, 80, 1, 0),
      slider('strength', 'strength', 0.02, 1, 0.01, 2),
      slider('hardness', 'hardness', 0, 1, 0.01, 2),
      select('shape', 'brushShape', () => [['free', 'freehand'], ['line', 'line (press, drag to the end)'], ['circle', 'circle (press the centre, drag out)']]).row,
    ),
    section('Rule', el('div', { class: 'rule-row' }, familySel, importBtn), el('div', { class: 'rule-row' }, ruleSel), el('div', { class: 'rule-row' }, sceneSel), ruleBody),
    section('Simulation',
      el('div', { class: 'buttons' }, runBtn, button('Step', actions.stepOnce, '.'), button('Restart', actions.restart, 'start the rule or scene over from scratch: its own parameters, opening, paint and stamps (Reset keeps your parameters)'), button('Clear chem', actions.clearChemistry, 'C')),
      logSlider('steps/frame', 'stepsPerFrame', 64, 5000),
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
    ...extraSections,
    section('View',
      select('mode', 'viewMode', () => [['reagent', 'reagent'], ['outlines', 'reagent + param outlines'], ['params', 'parameter map']]).row,
      viewReagent.row,
      rangeRow('low', 'low', [-1, 1]),
      rangeRow('high', 'high', [-1, 2]),
      viewTint.row,
      rangeRow('tint low', 'tintLow', [-1, 1]),
      rangeRow('tint high', 'tintHigh', [-1, 2]),
      slider('tint mix', 'tintStrength', 0, 1, 0.01, 2),
      slider('hue shape', 'hueShape', 0.1, 4, 0.01, 2),
      slider('hue offset', 'hueOffset', 0, 1, 0.01, 2),
      select('palette', 'palette', () => [[0, 'abyss'], [1, 'ember'], [2, 'mono'], [3, 'spectral'], [4, 'HSV: show → hue, tint → sat'], [5, 'HSV fleck: a b c → V S H'], [6, 'OKLCH fleck: a b c → L C h']], () => {
        // HSV wants a second reagent for the saturation: default to the other one
        const n = rc.rule().reagents.length;
        if (s.palette === 4 && s.tint < 0 && n > 1) {
          s.tint = s.reagent === 0 ? 1 : 0;
          s.tintStrength = 1;
        }
      }).row,
    ),
    el('footer', {}, el('p', { class: 'hint' },
      '1–7 tools · [ ] radius · space run/pause · . step · F fill · R reset · C clear · V cycle reagent · T cycle tint · H hide panel · right-click alt action · Esc cancel')),
  );

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
