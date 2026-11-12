import { PRESETS, DEFAULT_PRESET } from './presets';

export type Tool = 'seed' | 'erase' | 'params' | 'wall';

export interface Settings {
  tool: Tool;
  radius: number;
  strength: number;
  hardness: number;
  feed: number;
  kill: number;
  diffusion: number;
  running: boolean;
  stepsPerFrame: number;
  gridSize: number;
  view: number;
  palette: number;
}

export interface Actions {
  fillParams(): void;
  reset(): void;
  clearChemistry(): void;
  resize(size: number): void;
  stepOnce(): void;
}

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'seed', label: 'Seed', key: '1', hint: 'inject chemical V · right-drag erases' },
  { id: 'erase', label: 'Erase', key: '2', hint: 'reset chemistry to U=1, V=0' },
  { id: 'params', label: 'Params', key: '3', hint: 'paint feed/kill/diffusion · right-click samples' },
  { id: 'wall', label: 'Wall', key: '4', hint: 'no-flux barrier · right-drag removes' },
];

const F_RANGE = [0, 0.1] as const;
const K_RANGE = [0.03, 0.075] as const;

export function defaultSettings(): Settings {
  return {
    tool: 'seed',
    radius: 8,
    strength: 1,
    hardness: 0.6,
    feed: DEFAULT_PRESET.feed,
    kill: DEFAULT_PRESET.kill,
    diffusion: 1,
    running: true,
    stepsPerFrame: 10,
    gridSize: 512,
    view: 0,
    palette: 0,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

function section(title: string, ...children: Node[]) {
  return el('section', {}, el('h2', {}, title), ...children);
}

/** Builds the side panel. Returns `sync()` to refresh widgets after settings change elsewhere. */
export function buildPanel(root: HTMLElement, s: Settings, actions: Actions) {
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

  function select(label: string, key: keyof Settings, options: [number, string][], onChange?: () => void) {
    const sel = el('select');
    for (const [v, name] of options) sel.append(el('option', { value: String(v) }, name));
    sel.addEventListener('change', () => {
      (s[key] as number) = Number(sel.value);
      onChange?.();
    });
    syncers.push(() => (sel.value = String(s[key])));
    return el('label', { class: 'row' }, el('span', {}, label), sel);
  }

  function button(label: string, onClick: () => void, title = '') {
    const b = el('button', { title }, label);
    b.addEventListener('click', onClick);
    return b;
  }

  // Tools
  const toolRow = el('div', { class: 'tools' });
  const toolHint = el('p', { class: 'hint' });
  for (const t of TOOLS) {
    const b = button(t.label, () => {
      s.tool = t.id;
      sync();
    }, `${t.hint} (${t.key})`);
    b.dataset.key = t.key;
    syncers.push(() => b.classList.toggle('active', s.tool === t.id));
    toolRow.append(b);
  }
  syncers.push(() => (toolHint.textContent = TOOLS.find((t) => t.id === s.tool)!.hint));

  // Feed/kill pad
  const pad = buildFKPad(s, sync);
  syncers.push(pad.draw);

  const presetRow = el('div', { class: 'presets' });
  for (const p of PRESETS) {
    const b = button(p.name, () => {
      s.feed = p.feed;
      s.kill = p.kill;
      sync();
    }, p.note);
    syncers.push(() => b.classList.toggle('active', Math.abs(s.feed - p.feed) < 1e-5 && Math.abs(s.kill - p.kill) < 1e-5));
    presetRow.append(b);
  }

  // Run controls
  const runBtn = button('', () => {
    s.running = !s.running;
    sync();
  }, 'space');
  syncers.push(() => (runBtn.textContent = s.running ? 'Pause' : 'Run'));

  root.append(
    el('header', {}, el('h1', {}, 'rdui'), el('span', { class: 'sub' }, 'reaction-diffusion sandbox')),
    section('Tool', toolRow, toolHint,
      slider('radius', 'radius', 1, 80, 1, 0),
      slider('strength', 'strength', 0.02, 1, 0.01, 2),
      slider('hardness', 'hardness', 0, 1, 0.01, 2),
    ),
    section('Parameters', pad.canvas, presetRow,
      slider('feed', 'feed', F_RANGE[0], F_RANGE[1], 0.0001, 4),
      slider('kill', 'kill', K_RANGE[0], K_RANGE[1], 0.0001, 4),
      slider('diffusion', 'diffusion', 0.05, 1.2, 0.01, 2),
      el('div', { class: 'buttons' },
        button('Fill all', actions.fillParams, 'apply feed/kill/diffusion to the whole field (keeps walls) · F'),
        button('Reset', actions.reset, 'new field with these params, random seeds, no walls · R'),
      ),
    ),
    section('Simulation',
      el('div', { class: 'buttons' }, runBtn, button('Step', actions.stepOnce, '.'), button('Clear chem', actions.clearChemistry, 'C')),
      slider('steps/frame', 'stepsPerFrame', 1, 60, 1, 0),
      select('grid', 'gridSize', [[256, '256²'], [512, '512²'], [1024, '1024²'], [2048, '2048²']], () => actions.resize(s.gridSize)),
    ),
    section('View',
      select('show', 'view', [[0, 'V (activator)'], [1, 'U (substrate)'], [2, 'parameter map']]),
      select('palette', 'palette', [[0, 'abyss'], [1, 'ember'], [2, 'mono'], [3, 'spectral']]),
    ),
    el('footer', {}, el('p', { class: 'hint' },
      '1–4 tools · [ ] radius · space run/pause · . step · F fill · R reset · C clear · V cycle view · right-click alt action')),
  );

  sync();
  return { sync };
}

/** A clickable (kill → x, feed → y) map with presets marked. */
function buildFKPad(s: Settings, sync: () => void) {
  const W = 260;
  const H = 170;
  const dpr = window.devicePixelRatio || 1;
  const canvas = el('canvas', { class: 'fkpad', title: 'click/drag to pick feed (y) and kill (x)' });
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d')!;

  const toX = (k: number) => ((k - K_RANGE[0]) / (K_RANGE[1] - K_RANGE[0])) * W;
  const toY = (f: number) => H - ((f - F_RANGE[0]) / (F_RANGE[1] - F_RANGE[0])) * H;

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, W, H);
    // Saddle-node bifurcation curve K = sqrt(F)/2 - F; most interesting patterns live just right of it.
    ctx.strokeStyle = '#2a3140';
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const f = (i / 100) * 0.25;
      const k = Math.sqrt(f) / 2 - f;
      const x = toX(k), y = toY(f);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.font = '10px ui-monospace, monospace';
    for (const p of PRESETS) {
      const x = toX(p.kill), y = toY(p.feed);
      ctx.fillStyle = '#5b6b85';
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7f8ba0';
      ctx.fillText(p.name, x + 4, y - 3);
    }
    const x = toX(s.kill), y = toY(s.feed);
    ctx.strokeStyle = '#ffcc66';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#5b6b85';
    ctx.fillText('kill →', W - 38, H - 4);
    ctx.fillText('feed ↑', 3, 11);
  }

  function pick(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const fx = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    const fy = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
    s.kill = K_RANGE[0] + fx * (K_RANGE[1] - K_RANGE[0]);
    s.feed = F_RANGE[0] + (1 - fy) * (F_RANGE[1] - F_RANGE[0]);
    sync();
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pick(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons & 1) pick(e);
  });

  return { canvas, draw };
}
