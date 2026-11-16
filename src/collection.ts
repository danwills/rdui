/**
 * Dan's Ready collection (lab/vtipack-import.py → public/vti/): rule families, each one
 * Ready rule with many presets (a file's parameters, view and thumbnail).
 * - Loading: a preset is the rule id `vti:<family>:<md5>`: the family's header through the
 *   Ready importer, with the preset's parameters and view on top.
 * - Browsing (openCollection): a zoomable tree, rules → families → clusters of presets with
 *   similar parameters → presets. Tap opens a branch and previews it; drag from one entry
 *   towards another in the same family to blend their parameters, previewed live; Use runs
 *   the preview's values in the main sim.
 */
import { importReady, type ReadyImport } from './ready';
import { compileRule, initialField, type RuleDef } from './rule';
import { Simulation, type ViewOptions } from './sim';
import { growSeed, loadSeed } from './seeds';
import { el, button } from './ui';

const BASE = `${import.meta.env.BASE_URL}vti/`;

export interface Preset {
  name: string;
  path: string;
  md5: string;
  params: Record<string, number>;
  variant: number | null;
  view: { reagent?: string; low?: number; high?: number; stepsPerFrame?: number };
  seed: string | null;
  grid: [number, number] | null;
  thumb: boolean;
}
export interface Family { id: string; name: string; chemicals: number; header: string; representative: string; presets: Preset[] }
interface FamilyEntry { id: string; name: string; label: string; chemicals: number; count: number; thumb: string | null }
interface Index { families: FamilyEntry[]; packs: { id: string; title: string; description: string; members: [string, string][] }[] }

let indexP: Promise<Index> | null = null;
const loadIndex = () => (indexP ??= fetch(`${BASE}families/index.json`).then((r) => r.json()));
const families = new Map<string, Promise<Family>>();
export function loadFamily(id: string) {
  let p = families.get(id);
  if (!p) families.set(id, (p = fetch(`${BASE}families/${id}.json`).then((r) => r.json())));
  return p;
}

/**
 * A preset's start state on a w×h grid, grown from its seed (seeds.ts), one array per reagent
 * of `reagents` (holes where the seed has none); undefined when it has no seed (the rule's
 * initial pattern then starts it, as Ready did).
 */
export async function presetStart(famId: string, md5: string, reagents: string[], w: number, h: number) {
  const fam = await loadFamily(famId);
  const p = fam.presets.find((q) => q.md5 === md5);
  if (!p?.seed) return undefined;
  const seed = await loadSeed(md5);
  if (!seed) return undefined;
  const grown = growSeed(seed, w, h);
  const out: Float32Array[] = [];
  reagents.forEach((r, i) => {
    const k = seed.names.indexOf(r);
    if (k >= 0) out[i] = grown[k];
  });
  return out;
}

/** A preset as a rule: the family's rule with the preset's values (or `params`, e.g. a blend) and view, and its seed grown to start it. */
export async function presetImport(famId: string, md5: string, params?: Record<string, number>): Promise<ReadyImport> {
  const fam = await loadFamily(famId);
  const p = fam.presets.find((q) => q.md5 === md5) ?? fam.presets.find((q) => q.md5 === fam.representative)!;
  const imp = await importReady(fam.header, `${p.name}.vti`);
  const vals = { ...p.params, ...params };
  const rule = imp.rule;
  rule.params = rule.params.map((q) => (vals[q.name] === undefined ? q : { ...q, value: vals[q.name], min: Math.min(q.min, vals[q.name]), max: Math.max(q.max, vals[q.name]) }));
  rule.name = p.name;
  if (p.view.reagent && rule.reagents.includes(p.view.reagent)) rule.view.reagent = p.view.reagent;
  if (p.view.low !== undefined) rule.view.low = p.view.low;
  if (p.view.high !== undefined) rule.view.high = p.view.high;
  if (p.view.stepsPerFrame) rule.view.stepsPerFrame = Math.min(200, Math.max(1, Math.round(p.view.stepsPerFrame)));
  if (p.grid) rule.size = { width: Math.min(1024, p.grid[0]), height: Math.min(1024, p.grid[1]) };
  rule.description = `${p.path} (from Dan's Ready collection; family ${fam.id}, ${fam.presets.length} presets)\n\n${rule.description ?? ''}`;
  const image = rule.size ? await presetStart(famId, p.md5, rule.reagents, rule.size.width, rule.size.height).catch(() => undefined) : undefined;
  return { ...imp, image };
}

// --- the tree

interface Node {
  label: string;
  children: Node[];
  /** Loaded lazily: a family's clusters come when it's opened. */
  famId?: string;
  famEntry?: FamilyEntry;
  preset?: Preset;
  /** Mean parameters of the presets under it (in its family), for previews and blends. */
  params?: Record<string, number>;
  thumb?: string | null;
  count: number;
  open: boolean;
  // layout (world units)
  x: number;
  y: number;
}

const node = (label: string, extra: Partial<Node> = {}): Node => ({ label, children: [], count: 1, open: false, x: 0, y: 0, ...extra });

/** `text` cut to `maxW` pixels with the ellipsis in the middle (names often differ only at the end). */
function midEllipsis(g: CanvasRenderingContext2D, text: string, maxW: number) {
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const k = (lo + hi + 1) >> 1, a = Math.ceil(k / 2);
    if (g.measureText(`${text.slice(0, a)}…${text.slice(text.length - (k - a))}`).width <= maxW) lo = k;
    else hi = k - 1;
  }
  const a = Math.ceil(lo / 2);
  return `${text.slice(0, a)}…${text.slice(text.length - (lo - a))}`;
}

/** Longest common prefix, trimmed back to a word boundary. */
function commonName(names: string[]) {
  let p = names[0] ?? '';
  for (const n of names) while (!n.startsWith(p)) p = p.slice(0, -1);
  const cut = Math.max(p.lastIndexOf('_'), p.lastIndexOf('-'), p.lastIndexOf('/'));
  return (cut > 3 ? p.slice(0, cut) : p).replace(/[-_/]+$/, '');
}

function mean(presets: Preset[]) {
  const out: Record<string, number> = {}, n: Record<string, number> = {};
  for (const p of presets) for (const [k, v] of Object.entries(p.params)) {
    out[k] = (out[k] ?? 0) + v;
    n[k] = (n[k] ?? 0) + 1;
  }
  for (const k in out) out[k] /= n[k];
  return out;
}

/**
 * A family's presets as a tree of parameter similarity: average-linkage clustering on
 * the parameters (each scaled by its range in the family, logarithmically where it's positive
 * and spans more than 20×), merges of about the same height then flattened into one node.
 */
/** One preset per set of parameter values (many differ only in their starting state): the first with a seed and a thumbnail, else the first. */
function distinct(presets: Preset[]) {
  const by = new Map<string, Preset>();
  for (const p of presets) {
    const key = Object.keys(p.params).sort().map((k) => `${k}=${Number(p.params[k].toPrecision(6))}`).join(',');
    const had = by.get(key);
    if (!had || (!(had.seed && had.thumb) && p.seed && p.thumb)) by.set(key, p);
  }
  return presets.filter((p) => [...by.values()].includes(p));
}

function clusterFamily(fam: Family): Node[] {
  const ps = distinct(fam.presets);
  const names = [...new Set(ps.flatMap((p) => Object.keys(p.params)))];
  const scale = names.map((k) => {
    const v = ps.map((p) => p.params[k]).filter((x) => x !== undefined);
    const lo = Math.min(...v), hi = Math.max(...v);
    const log = lo > 0 && hi / lo > 20;
    const f = (x: number) => (log ? Math.log(x) : x);
    const span = f(hi) - f(lo) || 1;
    const mid = v.length ? v[v.length >> 1] : 0;
    return (x: number | undefined) => (f(x ?? mid) - f(lo)) / span;
  });
  const vec = ps.map((p) => names.map((k, i) => scale[i](p.params[k])));
  const leaf = (i: number): Node => node(ps[i].name, { preset: ps[i], params: ps[i].params, thumb: ps[i].thumb ? ps[i].md5 : null, famId: fam.id });
  type C = { members: number[]; node: Node; h: number };
  let cs: C[] = ps.map((_, i) => ({ members: [i], node: leaf(i), h: 0 }));
  const d = (a: number, b: number) => vec[a].reduce((s, x, k) => s + Math.abs(x - vec[b][k]), 0) / Math.max(1, names.length);
  const D = new Map<string, number>();
  const cd = (a: C, b: C) => {
    const key = a.members[0] < b.members[0] ? `${a.members[0]}|${b.members[0]}` : `${b.members[0]}|${a.members[0]}`;
    let v = D.get(key);
    if (v === undefined) {
      v = 0;
      for (const i of a.members) for (const j of b.members) v += d(i, j);
      v /= a.members.length * b.members.length;
      D.set(key, v);
    }
    return v;
  };
  while (cs.length > 1) {
    let best = Infinity, bi = 0, bj = 1;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const v = cd(cs[i], cs[j]);
      if (v < best) [best, bi, bj] = [v, i, j];
    }
    const a = cs[bi], b = cs[bj];
    const members = [...a.members, ...b.members];
    // a child merged at nearly this height joins this node rather than nesting
    const kids = [a, b].flatMap((c) => (c.node.children.length && c.h >= best * 0.7 ? c.node.children : [c.node]));
    const sub = members.map((i) => ps[i]);
    const n = node(commonName(sub.map((p) => p.name)) || `${members.length} presets`, { children: kids, params: mean(sub), famId: fam.id, count: members.length, thumb: sub.find((p) => p.thumb)?.md5 ?? null });
    for (const k of [a, b]) D.forEach((_, key) => key.split('|').includes(String(k.members[0])) && D.delete(key));
    cs = cs.filter((_, i) => i !== bi && i !== bj);
    cs.push({ members, node: n, h: best });
  }
  const tops = cs[0].node.children.length ? cs[0].node.children : [cs[0].node];
  relabel(tops, commonName(ps.map((p) => p.name)));
  return tops;
}

/** Clusters named by what sets them apart: their shared name past the parent's, or their most common word the parent doesn't share. */
function relabel(nodes: Node[], parent: string) {
  const leaves = (n: Node): string[] => (n.preset ? [n.preset.name] : n.children.flatMap(leaves));
  const words = (s: string) => s.split(/[-_/.\s]+/).filter((w) => w.length > 1);
  const parentWords = new Set(words(parent));
  for (const n of nodes) {
    if (n.preset) continue;
    const names = leaves(n);
    const shared = commonName(names);
    let label = shared.length > parent.length + 2 ? shared.slice(parent.length).replace(/^[-_/]+/, '') : '';
    if (!label) {
      const tally = new Map<string, number>();
      for (const nm of names) for (const w of new Set(words(nm))) if (!parentWords.has(w)) tally.set(w, (tally.get(w) ?? 0) + 1);
      label = [...tally.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([w]) => w).join(' · ') || `${names.length} presets`;
    }
    n.label = label;
    relabel(n.children, shared.length > parent.length ? shared : parent);
  }
}

// --- the panel

export interface CollectionEnv {
  device: GPUDevice;
  format: GPUTextureFormat;
  view(): ViewOptions;
  /** The family the main sim is running (if it's from the collection), and a piece of its state to start previews from. */
  /** famId '' with `file`: a Ready file loaded some other way, found by its file name (no .vti). */
  current?: { famId: string; md5?: string; file?: string; params?: Record<string, number>; section: { w: number; h: number; state: Float32Array } };
  /** Run the preview's preset (and values) in the main sim, filling the screen. */
  use(famId: string, md5: string, params: Record<string, number>): void;
  onClose(): void;
}

const ROW = 64, COL = 330, THUMB = 52;

export function openCollection(env: CollectionEnv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = el('canvas', { class: 'coll-canvas' });
  const g = canvas.getContext('2d')!;
  // the preview fills the background (cropped to cover it); the tree is drawn over it, opaque on
  // the left and fading out to the right
  const pv = el('canvas', { class: 'coll-preview' });
  const readout = el('div', { class: 'coll-readout' }, 'Loading the collection…');
  const root = el('div', { class: 'coll' },
    el('div', { class: 'explore-bar' }, el('strong', {}, 'Ready collection'),
      button('Restart', () => restartPreview(), 'start the preview again from its seed'),
      button('Fit', () => fitView(), 'zoom to show the whole tree'),
      button('Cancel', () => close(false), 'close without changing the main sim'),
      button('✕ Close', () => close(true), 'close: what the preview shows becomes the main sim, filling the screen (Back or Esc too)')),
    el('div', { class: 'coll-main' }, pv, canvas, readout));
  document.body.append(root);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close(true);
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  // Back closes it, like ✕ (an entry pushed now, taken back if it closes another way)
  history.pushState({ rduiCollection: true }, '');
  const onPop = () => close(true, true);
  window.addEventListener('popstate', onPop);
  function sizePreview() {
    const r = pv.getBoundingClientRect();
    const side = Math.min(1024, Math.floor(Math.max(r.width, r.height, 64) * dpr));
    if (pv.width !== side) pv.width = pv.height = side;
  }

  // --- view transform: screen = (world - pan) * zoom
  let zoom = 1, panX = -20, panY = -20;
  const toScreen = (x: number, y: number): [number, number] => [(x - panX) * zoom, (y - panY) * zoom];
  const toWorld = (sx: number, sy: number): [number, number] => [sx / zoom + panX, sy / zoom + panY];

  // --- the tree
  const top = node('Ready collection', { open: true });
  let visible: Node[] = [];
  function layout() {
    visible = [];
    let row = 0;
    const walk = (n: Node, depth: number) => {
      n.x = depth * COL;
      visible.push(n);
      if (n.open && n.children.length) {
        for (const c of n.children) walk(c, depth + 1);
        n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2;
      } else n.y = row++ * ROW;
    };
    walk(top, 0);
  }
  async function toggle(n: Node) {
    if (n.famEntry && !n.children.length) {
      readout.textContent = `Loading ${n.famEntry.name} (${n.famEntry.count})…`;
      const fam = await loadFamily(n.famEntry.id);
      n.children = clusterFamily(fam);
      n.params = mean(fam.presets);
    }
    if (!n.children.length) return;
    n.open = !n.open;
    layout();
    draw();
  }

  const thumbs = new Map<string, HTMLImageElement>();
  function thumbImg(md5: string) {
    let im = thumbs.get(md5);
    if (!im) {
      thumbs.set(md5, (im = new Image()));
      im.onload = () => draw();
      im.src = `${BASE}thumbs/${md5}.webp`;
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  // --- blending state
  let previewKey: { famId: string; md5: string; params: Record<string, number> } | null = null;
  let blend: { a: Node; b: Node | null; t: number; px: number; py: number } | null = null;
  // selected: what the preview is running; hover: what a click would pick (outlined, its name shown)
  let selected: Node | null = null, hover: Node | null = null;

  function draw() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const fade = g.createLinearGradient(0, 0, W, 0);
    fade.addColorStop(0, 'rgba(11,12,16,0.94)');
    fade.addColorStop(0.35, 'rgba(11,12,16,0.85)');
    fade.addColorStop(0.75, 'rgba(11,12,16,0.15)');
    fade.addColorStop(1, 'rgba(11,12,16,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, W, H);
    // links
    g.strokeStyle = 'rgba(140,160,190,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (const n of visible) if (n.open) for (const c of n.children) {
      const [x0, y0] = toScreen(n.x, n.y), [x1, y1] = toScreen(c.x, c.y);
      if (Math.max(y0, y1) < -50 || Math.min(y0, y1) > H + 50) continue;
      const xm = (x0 + x1) / 2;
      g.moveTo(x0, y0);
      g.bezierCurveTo(xm, y0, xm, y1, x1, y1);
    }
    g.stroke();
    // nodes
    const s = Math.min(1.6, zoom);
    const font = Math.max(9, 12 * Math.min(1.3, zoom));
    g.font = `${font}px ui-monospace, monospace`;
    g.textBaseline = 'middle';
    for (const n of visible) {
      const [x, y] = toScreen(n.x, n.y);
      if (y < -ROW * zoom || y > H + ROW * zoom || x > W + 20 || x < -COL * zoom) continue;
      const leafish = !n.open || !n.children.length;
      const tw = leafish && n.thumb && zoom > 0.25 ? THUMB * s : 0;
      if (tw) {
        const im = thumbImg(n.thumb!);
        if (im) g.drawImage(im, x, y - tw / 2, tw, tw);
        else {
          g.fillStyle = '#1b1e26';
          g.fillRect(x, y - tw / 2, tw, tw);
        }
      } else {
        g.fillStyle = n.preset ? '#ffcc66' : '#66d9ff';
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
      }
      const hl = blend && (n === blend.a || n === blend.b);
      if (hl) {
        g.strokeStyle = n === blend!.a ? '#ffcc66' : '#66d9ff';
        g.lineWidth = 2;
        g.strokeRect(x - 2, y - (tw || 8) / 2 - 2, (tw || 8) + 4, (tw || 8) + 4);
      }
      const maxW = COL * zoom - tw - 14;
      const label = n.preset ? n.label : `${n.label}${n.count > 1 ? `  (${n.count})` : ''}${!n.children.length && !n.famEntry ? '' : n.open ? '' : ' ▸'}`;
      const t = maxW > 20 && (zoom > 0.18 || !leafish || n === selected) ? midEllipsis(g, label, maxW) : '';
      if (n === selected || n === hover) {
        // a box round the thumbnail and label: filled and bright for the one running, an outline for the one under the pointer
        const bh = Math.max(tw || 8, font) + 8, bw = (tw || 8) + (t ? 12 + g.measureText(t).width : 0) + 8;
        g.beginPath();
        g.roundRect(x - 4, y - bh / 2, bw, bh, 5);
        if (n === selected) {
          g.fillStyle = 'rgba(255,204,102,0.22)';
          g.fill();
          g.strokeStyle = '#ffcc66';
          g.lineWidth = 2.5;
        } else {
          g.strokeStyle = 'rgba(255,255,255,0.85)';
          g.lineWidth = 1.5;
        }
        g.stroke();
      }
      if (t) {
        g.fillStyle = n === selected ? '#ffe2a8' : n.preset ? 'rgba(255,255,255,0.8)' : '#9fd8ff';
        g.fillText(t, x + (tw || 8) + 6, y);
      }
      if (n === selected) {
        // a ▶ tag before it: this is running
        g.fillStyle = '#ffcc66';
        g.beginPath();
        g.moveTo(x - 16, y - 7);
        g.lineTo(x - 7, y);
        g.lineTo(x - 16, y + 7);
        g.fill();
      }
    }
    if (hover && !blend) {
      // what a click would do, and the full name (middle-ellipsised to fit the screen), above the entry
      const [x, y] = toScreen(hover.x, hover.y);
      const branch = hover.children.length || hover.famEntry;
      const action = hover === selected || !hover.params ? (branch ? (hover.open ? 'collapse' : 'open') : 'running') : 'preview';
      const name = hover.preset ? hover.preset.path : hover.label;
      g.font = `12px ui-monospace, monospace`;
      const txt = `${midEllipsis(g, name, Math.min(560, W - 40) - g.measureText(`  ${action}`).width)}  ${action}`;
      const w = g.measureText(txt).width + 14, h = 22;
      const bx = Math.max(6, Math.min(W - w - 6, x - 4)), by = y - (hover.thumb && zoom > 0.25 ? (THUMB * s) / 2 : 8) - h - 8;
      g.fillStyle = 'rgba(20,22,30,0.95)';
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(bx, by < 4 ? y + 18 : by, w, h, 4);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.fillText(txt, bx + 7, (by < 4 ? y + 18 : by) + h / 2);
    }
    if (blend) {
      const [ax, ay] = toScreen(blend.a.x, blend.a.y);
      g.strokeStyle = '#ffcc66';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(ax, ay);
      if (blend.b) {
        const [bx, by] = toScreen(blend.b.x, blend.b.y);
        g.lineTo(bx, by);
      } else g.lineTo(blend.px, blend.py);
      g.stroke();
      g.setLineDash([]);
    }
  }

  function fitView() {
    if (!visible.length) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const xs = visible.map((n) => n.x), ys = visible.map((n) => n.y);
    const w = Math.max(...xs) - Math.min(...xs) + COL, h = Math.max(...ys) - Math.min(...ys) + ROW;
    zoom = Math.min(1.2, Math.max(0.02, Math.min(W / w, H / h)));
    panX = Math.min(...xs) - 10 / zoom;
    panY = Math.min(...ys) - ROW / 2 - (H / zoom - h) / 2;
    draw();
  }

  // --- the preview: one sim of the family being looked at
  const ctx = pv.getContext('webgpu')!;
  ctx.configure({ device: env.device, format: env.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
  let pvSim: { sim: Simulation; rule: RuleDef; famId: string; spf: number; view: Partial<ViewOptions> } | null = null;
  let tex: GPUTexture | null = null;
  const PN = 256;
  let raf = 0;
  let building: Promise<void> | null = null;
  async function preview(famId: string, md5: string, params: Record<string, number>, restart = false) {
    previewKey = { famId, md5, params };
    if (pvSim && pvSim.famId === famId && !restart) {
      for (const [k, v] of Object.entries(params)) pvSim.sim.setGlobal(k, v);
      return;
    }
    if (building) await building;
    building = (async () => {
      pvSim?.sim.destroy();
      pvSim = null;
      const imp = await presetImport(famId, md5, params);
      const rule = imp.rule;
      const compiled = compileRule(rule);
      const sim = new Simulation(env.device, env.format, PN, PN, compiled);
      const globals = Object.fromEntries(rule.params.map((p) => [p.name, p.value]));
      for (const [k, v] of Object.entries(globals)) sim.setGlobal(k, v);
      const f = initialField(rule, PN, PN, globals, 'zero', 1);
      const cur = env.current;
      const S4p = compiled.layout.S * 4;
      // from the main sim when it's running this family, else from the preset's seed
      const grown = cur && cur.famId === famId ? undefined : await presetStart(famId, md5, rule.reagents, PN, PN).catch(() => undefined);
      grown?.forEach((img, r) => { for (let i = 0; i < PN * PN; i++) f.state[i * S4p + r] = img[i]; });
      if (closed) {
        sim.destroy();
        return;
      }
      if (cur && cur.famId === famId) {
        const S4 = compiled.layout.S * 4, sec = cur.section;
        const ox = Math.max(0, (sec.w - PN) >> 1), oy = Math.max(0, (sec.h - PN) >> 1);
        for (let y = 0; y < PN; y++) for (let x = 0; x < PN; x++) {
          const j = (((y + oy) % sec.h) * sec.w + ((x + ox) % sec.w)) * S4;
          f.state.set(sec.state.subarray(j, j + S4), (y * PN + x) * S4);
        }
      }
      sim.load(f.state, f.params);
      pvSim = { sim, rule, famId, spf: rule.view.stepsPerFrame ?? 10, view: { reagent: Math.max(0, rule.reagents.indexOf(rule.view.reagent)), low: rule.view.low, high: rule.view.high } };
    })();
    await building;
    building = null;
  }
  function restartPreview() {
    if (previewKey) void preview(previewKey.famId, previewKey.md5, previewKey.params, true);
  }
  function loop() {
    sizePreview();
    if (pvSim) {
      if (!tex || tex.width !== pv.width) {
        tex?.destroy();
        tex = env.device.createTexture({ size: [pv.width, pv.height], format: env.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      }
      const enc = env.device.createCommandEncoder();
      pvSim.sim.step(enc, Math.min(60, pvSim.spf));
      pvSim.sim.render(enc, tex.createView(), tex.width, tex.height, { ...env.view(), mode: 'reagent', tint: -1, paramSlots: [], ...pvSim.view } as ViewOptions);
      enc.copyTextureToTexture({ texture: tex }, { texture: ctx.getCurrentTexture() }, [tex.width, tex.height]);
      env.device.queue.submit([enc.finish()]);
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function describe(n: Node) {
    return n.preset ? `${n.preset.path}${n.preset.seed ? '' : ' (no seed: left out of the Enki packs)'}` : `${n.label} · ${n.count} preset${n.count > 1 ? 's' : ''}`;
  }
  function show(n: Node) {
    if (!n.famId || !n.params) return;
    const md5 = n.preset?.md5 ?? firstPreset(n)?.md5;
    if (!md5) return;
    void preview(n.famId, md5, n.params);
    selected = n;
    draw();
    readout.textContent = `▶ Running in the preview: ${describe(n)}\n✕ Close (or Esc) runs it in the main sim. Tap again to collapse or open a branch; drag from one entry to another in the same family to blend them.`;
  }
  const firstPreset = (n: Node): Preset | undefined => n.preset ?? n.children.map(firstPreset).find(Boolean);
  const famOf = (n: Node) => n.famId ?? n.famEntry?.id;


  // --- pointers: drag empty space to pan, pinch or wheel to zoom, tap an entry to open and
  // preview it, drag from an entry to blend towards the nearest other entry of its family
  const pts = new Map<number, { x: number; y: number }>();
  let press: { id: number; x: number; y: number; n: Node | null; moved: boolean } | null = null;
  let pinch: { d: number; cx: number; cy: number; zoom: number; wx: number; wy: number } | null = null;
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function hit(x: number, y: number) {
    let best: Node | null = null, bd = Math.max(10, Math.min(30, (ROW * zoom) / 2));
    for (const n of visible) {
      const [sx, sy] = toScreen(n.x, n.y);
      const tw = (!n.open || !n.children.length) && n.thumb && zoom > 0.25 ? THUMB * Math.min(1.6, zoom) : 8;
      const dx = x < sx ? sx - x : x > sx + tw + COL * zoom * 0.6 ? x - (sx + tw + COL * zoom * 0.6) : 0;
      const d = Math.hypot(dx, y - sy);
      if (d < bd) [bd, best] = [d, n];
    }
    return best;
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const [wx, wy] = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom, wx, wy };
      press = null;
      blend = null;
      return;
    }
    press = { id: e.pointerId, x: p.x, y: p.y, n: hit(p.x, p.y), moved: false };
    setHover(press.n); // a touch shows what it will pick while it's down
  });
  const setHover = (n: Node | null) => {
    if (n === hover) return;
    hover = n;
    canvas.style.cursor = n ? 'pointer' : '';
    draw();
  };
  canvas.addEventListener('pointerleave', () => setHover(null));
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === 'mouse') { const p = local(e); setHover(hit(p.x, p.y)); }
      return;
    }
    const p = local(e);
    const last = pts.get(e.pointerId)!;
    pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      zoom = Math.min(4, Math.max(0.02, (pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d));
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      panX = pinch.wx - cx / zoom;
      panY = pinch.wy - cy / zoom;
      draw();
      return;
    }
    if (!press || press.id !== e.pointerId) return;
    if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) < 6) return;
    press.moved = true;
    setHover(null);
    const a = press.n;
    if (a && famOf(a) && a.params) {
      // blend: towards the nearest other entry of a's family; t by distance to each
      let b: Node | null = null, bd = Infinity;
      for (const n of visible) {
        if (n === a || famOf(n) !== famOf(a) || !n.params) continue;
        const [sx, sy] = toScreen(n.x, n.y);
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d < bd) [bd, b] = [d, n];
      }
      const [ax, ay] = toScreen(a.x, a.y);
      const da = Math.hypot(ax - p.x, ay - p.y);
      const t = b ? Math.min(1, Math.max(0, da / (da + bd))) : 0;
      blend = { a, b, t, px: p.x, py: p.y };
      if (b) {
        const mix: Record<string, number> = { ...a.params };
        for (const [k, v] of Object.entries(b.params!)) mix[k] = (a.params[k] ?? v) * (1 - t) + v * t;
        const md5 = a.preset?.md5 ?? firstPreset(a)?.md5;
        if (md5) void preview(famOf(a)!, md5, mix);
        readout.textContent = `Blend ${Math.round((1 - t) * 100)}% ${a.label}\n  + ${Math.round(t * 100)}% ${b.label}\nUse runs it in the main sim.`;
      }
      draw();
    } else {
      panX -= (p.x - last.x) / zoom;
      panY -= (p.y - last.y) / zoom;
      draw();
    }
  });
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (press && press.id === e.pointerId) {
      if (!press.moved && press.n) {
        // the first tap previews; a tap on the one already running opens or collapses it
        const n = press.n;
        if (n === selected || !n.famId || !n.params) void toggle(n).then(() => show(n));
        else show(n);
      }
      press = null;
      if (e.pointerType !== 'mouse') setHover(null);
      if (blend) {
        blend = null;
        draw();
      }
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = { x: e.offsetX, y: e.offsetY };
    const [wx, wy] = toWorld(p.x, p.y);
    zoom = Math.min(4, Math.max(0.02, zoom * Math.exp(-e.deltaY * 0.0015)));
    panX = wx - p.x / zoom;
    panY = wy - p.y / zoom;
    draw();
  }, { passive: false });
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);

  /** Closes; with `use`, what the preview shows becomes the main sim. `popped`: Back did it. */
  let closed = false;
  function close(use: boolean, popped = false) {
    if (closed) return;
    closed = true;
    // the page first, so it goes whatever the cleanup does
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', onPop);
    if (!popped && history.state?.rduiCollection) history.replaceState(null, '');
    cancelAnimationFrame(raf);
    try {
      ro.disconnect();
      pvSim?.sim.destroy();
      tex?.destroy();
      ctx.unconfigure();
    } catch (e) {
      console.warn('collection cleanup', e);
    }
    if (use && previewKey) env.use(previewKey.famId, previewKey.md5, previewKey.params);
    env.onClose();
  }

  // --- start: the rules (families grouped by name), the current family opened
  void loadIndex().then(async (idx) => {
    const byName = new Map<string, FamilyEntry[]>();
    for (const f of idx.families) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
    top.children = [...byName.entries()]
      .sort((a, b) => b[1].reduce((s, f) => s + f.count, 0) - a[1].reduce((s, f) => s + f.count, 0))
      .map(([name, fs]) => {
        const kids = fs.map((f) => node(`${f.label} · ${f.chemicals} chem`, { famEntry: f, famId: f.id, count: f.count, thumb: f.thumb }));
        return kids.length === 1
          ? { ...kids[0], label: `${name}: ${kids[0].label}` }
          : node(name, { children: kids, count: kids.reduce((s, k) => s + k.count, 0), thumb: fs[0].thumb });
      });
    // everything open from the start. The current family first, so the view goes straight to the
    // entry nearest the current rule; the rest load meanwhile and open round it (it stays put on screen)
    const fams = top.children.flatMap((n) => (n.famEntry ? [n] : n.children));
    const leaves = (n: Node): Node[] => (n.preset ? [n] : n.children.flatMap(leaves));
    const openAll = (n: Node) => { if (n.children.length) { n.open = true; n.children.forEach(openAll); } };
    const fill = async (n: Node) => {
      if (n.children.length) return;
      const fam = await loadFamily(n.famEntry!.id);
      if (n.children.length) return;
      n.children = clusterFamily(fam);
      n.params = mean(fam.presets);
      n.count = leaves(n).length;
      openAll(n);
    };
    for (const n of top.children) if (!n.famEntry) n.open = true;
    top.open = true;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    zoom = 0.8;
    panX = -20 / zoom;
    panY = -ROW / 2;
    const cur = env.current;
    if (cur && !cur.famId && cur.file) {
      // which family has it: the families' lists (quick; clustering waits)
      const lists = await Promise.all(fams.map((n) => loadFamily(n.famEntry!.id)));
      // the same name (a _djw suffix aside), else the preset with the same parameters nearest in value
      const base = (name: string) => name.split('/').pop()!.replace(/\.vti$/i, '').replace(/_djw$/, '').toLowerCase();
      const want = base(cur.file), keys = Object.keys(cur.params ?? {}).sort().join();
      const near = (p: Preset) => Object.entries(cur.params ?? {}).reduce((s, [k, v]) => s + Math.abs((p.params[k] ?? v) - v) / (Math.abs(v) + Math.abs(p.params[k] ?? v) + 1e-9), 0);
      let best: [number, Preset] | null = null;
      lists.forEach((f, i) => f.presets.forEach((p) => {
        const score = base(p.path) === want ? -1 : Object.keys(p.params).sort().join() === keys ? near(p) : Infinity;
        if (score < (best?.[0] ?? Infinity)) { best = [score, p]; cur.famId = fams[i].famEntry!.id; }
      }));
      if (best) cur.md5 = (best as [number, Preset])[1].md5;
      if (closed) return;
    }
    const fnode = cur && fams.find((n) => n.famEntry?.id === cur.famId);
    let anchor: Node | null = null, exact = false;
    if (fnode) {
      await fill(fnode);
      if (closed) return;
      // the preset itself, else the one with the nearest parameters (each difference relative to its size)
      const dist = (p: Preset) => Object.entries(cur.params ?? {}).reduce((s, [k, v]) => (p.params[k] === undefined ? s : s + Math.abs(p.params[k] - v) / (Math.abs(v) + Math.abs(p.params[k]) + 1e-9)), 0);
      const ls = leaves(fnode);
      anchor = ls.find((n) => n.preset!.md5 === cur.md5) ?? ls.reduce<Node | null>((b, n) => (!b || dist(n.preset!) < dist(b.preset!) ? n : b), null) ?? fnode;
      exact = anchor.preset?.md5 === cur.md5 || (!!anchor.preset && dist(anchor.preset) < 1e-6);
      layout();
      panY = anchor.y - H / 2 / zoom;
      panX = Math.max(-20 / zoom, anchor.x - W * 0.55 / zoom);
      selected = anchor;
      if (cur.params && anchor.preset) void preview(cur.famId, anchor.preset.md5, cur.params);
    } else layout();
    draw();
    readout.textContent = `Loading ${idx.families.length} rules…`;
    await Promise.all(fams.map(fill));
    if (closed) return;
    for (const n of top.children) if (!n.famEntry) n.count = n.children.reduce((s, c) => s + c.count, 0);
    const before = anchor && toScreen(anchor.x, anchor.y);
    layout();
    if (anchor && before) {
      panX = anchor.x - before[0] / zoom;
      panY = anchor.y - before[1] / zoom;
    }
    draw();
    readout.textContent = `${anchor ? `▶ Running: ${describe(anchor)}${exact ? '' : ' (nearest)'}\n` : ''}${idx.families.length} rules, ${fams.reduce((s, n) => s + n.count, 0)} distinct presets from Dan's Ready patterns (repeats that differ only in their starting state left out). Tap to open; pinch or scroll to zoom; drag empty space to move.`;
  });
}
