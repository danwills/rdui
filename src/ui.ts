import { PRESETS } from './presets';
import { F_RANGE, K_RANGE, LOUPE_ZOOM, drawMap, drawMarkers, mapFrame, onMapLoaded, openFKMap, openLoupe, pickFK } from './fkmap';
import type { RuleDef } from './rule';

export type Tool = 'seed' | 'erase' | 'params' | 'wall' | 'capture' | 'stamp' | 'probe';

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
  gridSize: number;
  viewMode: 'reagent' | 'params';
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
  clearChemistry(): void;
  resize(size: number): void;
  stepOnce(): void;
  saveField(): void;
  loadField(): void;
  selectRule(id: string): void;
  importRule(): void;
  setGlobal(name: string, value: number): void;
  togglePaintable(name: string): void;
  /** Set the rule's base values for paintable params and retune every cell still holding the old ones. */
  setBackground(values: Record<string, number>): void;
}

/** What the panel needs to know about the current rule. */
export interface RuleContext {
  rule(): RuleDef;
  globals(): Record<string, number>;
  choices: { id: string; label: string; group: string }[];
  currentId(): string;
  warnings(): string[];
  note(): string;
}

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'seed', label: 'Seed', key: '1', hint: 'inject the rule\'s seed chemistry · right-drag erases' },
  { id: 'erase', label: 'Erase', key: '2', hint: 'reset reagents to their rest values' },
  { id: 'params', label: 'Params', key: '3', hint: 'paint the paintable parameters · right-click samples' },
  { id: 'wall', label: 'Wall', key: '4', hint: 'no-flux barrier · right-drag removes' },
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
    gridSize: 512,
    viewMode: 'reagent',
    reagent: 1,
    low: 0,
    high: 0.4,
    tint: -1,
    tintLow: 0,
    tintHigh: 1,
    tintStrength: 0.8,
    palette: 0,
    hueShape: 1,
    hueOffset: 0,
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
  const ruleSel = el('select', { class: 'rule-select' });
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const c of rc.choices) {
    let g = groups.get(c.group);
    if (!g) {
      g = el('optgroup', { label: c.group });
      groups.set(c.group, g);
      ruleSel.append(g);
    }
    g.append(el('option', { value: c.id }, c.label));
  }
  ruleSel.addEventListener('change', () => actions.selectRule(ruleSel.value));
  const ruleBody = el('div');
  let ruleSyncers: (() => void)[] = [];
  syncers.push(() => ruleSyncers.forEach((f) => f()));

  function rebuildRule() {
    const rule = rc.rule();
    const globals = rc.globals();
    ruleSyncers = [];
    if (![...ruleSel.options].some((o) => o.value === rc.currentId())) {
      ruleSel.append(el('option', { value: rc.currentId() }, rule.source ?? rule.name));
    }
    ruleSel.value = rc.currentId();

    const nodes: Node[] = [];
    const warn = rc.warnings();
    if (warn.length) nodes.push(el('p', { class: 'hint error' }, warn.join(' · ')));
    if (rc.note()) nodes.push(el('p', { class: 'note' }, rc.note()));
    if (rule.description) {
      nodes.push(el('details', { class: 'desc' }, el('summary', {}, `${rule.name} · ${rule.reagents.join(' ')}`), el('p', {}, rule.description)));
    }

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

    // Global params: live sliders.
    const globalBox = el('div', { class: 'globals' });
    for (const spec of rule.params) {
      if (rule.paintable.includes(spec.name)) continue;
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
      ),
      el('details', { class: 'globals-wrap' }, el('summary', {}, `Global parameters (${rule.params.length - rule.paintable.length})`), globalBox),
    );
    ruleBody.replaceChildren(...nodes);
    viewReagent.fill();
    viewTint.fill();
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

  const importBtn = button('Import .vti…', actions.importRule, 'load a Ready formula pattern');

  root.append(
    el('header', {}, el('h1', {}, 'rdui'), el('span', { class: 'sub' }, 'reaction-diffusion sandbox'), el('span', { class: 'sub build' }, __BUILD__)),
    section('Tool', toolRow, toolHint,
      slider('radius', 'radius', 1, 80, 1, 0),
      slider('strength', 'strength', 0.02, 1, 0.01, 2),
      slider('hardness', 'hardness', 0, 1, 0.01, 2),
    ),
    section('Rule', el('div', { class: 'rule-row' }, ruleSel, importBtn), ruleBody),
    section('Simulation',
      el('div', { class: 'buttons' }, runBtn, button('Step', actions.stepOnce, '.'), button('Clear chem', actions.clearChemistry, 'C')),
      slider('steps/frame', 'stepsPerFrame', 1, 200, 1, 0),
      select('grid', 'gridSize', () => [[128, '128²'], [256, '256²'], [512, '512²'], [1024, '1024²'], [2048, '2048²']], () => actions.resize(s.gridSize)).row,
      el('div', { class: 'buttons' },
        button('Save field…', actions.saveField, 'download the rule, params, walls, chemistry and probes · ctrl+S'),
        button('Load field…', actions.loadField, 'ctrl+O'),
      ),
    ),
    ...extraSections,
    section('View',
      select('mode', 'viewMode', () => [['reagent', 'reagent'], ['params', 'parameter map']]).row,
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
  const canvas = el('canvas', { class: 'fkpad', title: 'press to pick feed (y) and kill (x); drag for fine control on the magnified map' });
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

  // Press: pick the value under the finger and show the magnifier; drag: move it
  // at the magnifier's scale (fine control); lift: the magnifier goes.
  let drag: { x: number; y: number; F: number; k: number; loupe: ReturnType<typeof openLoupe> } | null = null;
  const end = () => {
    drag?.loupe.close();
    drag = null;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect();
    const [F, k] = pickFK((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    set(F, k);
    drag = { x: e.clientX, y: e.clientY, F, k, loupe: openLoupe(s, background) };
  });
  canvas.addEventListener('pointermove', (e) => {
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
