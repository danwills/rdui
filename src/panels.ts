import { el, section, button, type Settings } from './ui';
import { stampThumbnail, type StampLibrary } from './stamps';
import { HISTORY, ProbeSet, type Probe } from './probes';
import { probeColor } from './overlay';

/** Stamp library: thumbnail grid, placement options, import/export. */
export function stampSection(lib: StampLibrary, s: Settings, select: (id: string) => void, io: { export(): void; import(): void }, shownReagent: () => string) {
  const starters = () => {
    const n = lib.addStarters();
    if (!n) alert('All starter stamps are already in your library.');
  };
  const grid = el('div', { class: 'stamps' });
  const empty = el('p', { class: 'hint' }, 'No stamps yet — use Capture (5) and drag over the field.');
  const error = el('p', { class: 'hint error' });
  const thumbs = new Map<string, HTMLCanvasElement>();

  function checkbox(label: string, key: 'placeParams' | 'placeChem') {
    const input = el('input', { type: 'checkbox' });
    input.checked = s[key];
    input.addEventListener('change', () => (s[key] = input.checked));
    return el('label', { class: 'check' }, input, label);
  }

  function render() {
    grid.replaceChildren();
    empty.hidden = lib.stamps.length > 0;
    error.textContent = lib.saveError ?? '';
    for (const st of lib.stamps) {
      const key = `${st.id}:${shownReagent()}`;
      let thumb = thumbs.get(key);
      if (!thumb) thumbs.set(key, (thumb = stampThumbnail(st, 56, shownReagent())));
      const del = button('×', () => lib.remove(st.id), 'delete stamp');
      del.classList.add('del');
      del.addEventListener('click', (e) => e.stopPropagation());
      const name = el('span', { class: 'name' }, st.name);
      const tile = el('div', { class: 'tile', title: `${st.name} · ${st.w}×${st.h} · ${st.rule} · double-click to rename` }, thumb, name, del);
      tile.classList.toggle('active', s.stampId === st.id);
      tile.addEventListener('click', () => select(st.id));
      tile.addEventListener('dblclick', () => {
        const n = prompt('Stamp name', st.name);
        if (n) lib.rename(st.id, n);
      });
      grid.append(tile);
    }
  }

  const node = section('Stamps',
    grid, empty, error,
    el('div', { class: 'checks' }, checkbox('params + walls', 'placeParams'), checkbox('chemistry', 'placeChem')),
    el('p', { class: 'hint' }, 'Q/E rotate · X mirror while placing'),
    el('div', { class: 'buttons' }, button('Export…', io.export), button('Import…', io.import), button('+ Starters', starters, 'add the stamps that ship with rdui')),
  );
  render();
  return { node, render };
}

/** Probe list with live value and sparkline per probe, for the displayed reagent. */
export function probeSection(probes: ProbeSet, shown: () => { index: number; name: string }) {
  const list = el('div', { class: 'probes' });
  const empty = el('p', { class: 'hint' }, 'No probes — use Probe (7) and drag a rectangle.');
  const rows = new Map<number, { value: HTMLElement; spark: HTMLCanvasElement }>();
  const dpr = window.devicePixelRatio || 1;

  function render() {
    list.replaceChildren();
    rows.clear();
    empty.hidden = probes.probes.length > 0;
    for (const p of probes.probes) {
      const swatch = el('span', { class: 'swatch' });
      swatch.style.background = probeColor(p);
      const value = el('span', { class: 'value' });
      const spark = el('canvas', { class: 'spark' });
      spark.width = 120 * dpr;
      spark.height = 26 * dpr;
      const del = button('×', () => {
        probes.remove(p.id);
        render();
      }, 'remove probe');
      del.classList.add('del');
      list.append(el('div', { class: 'probe' }, swatch, el('span', { class: 'name' }, p.name), value, spark, del));
      rows.set(p.id, { value, spark });
    }
    update();
  }

  function drawSpark(c: HTMLCanvasElement, p: Probe) {
    const ctx = c.getContext('2d')!;
    const { width: W, height: H } = c;
    ctx.clearRect(0, 0, W, H);
    if (p.filled < 2) return;
    const series = ProbeSet.series(p, shown().index);
    let lo = Infinity, hi = -Infinity;
    for (const v of series) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    // Autoscale, but don't magnify flat noise into a full-height scribble.
    const span = Math.max(hi - lo, 0.02);
    lo = (lo + hi) / 2 - span / 2;
    ctx.strokeStyle = probeColor(p);
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      const x = (i / (HISTORY - 1)) * W;
      const y = H - 1 - ((v - lo) / span) * (H - 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function update() {
    for (const p of probes.probes) {
      const r = rows.get(p.id);
      if (!r) continue;
      const { index, name } = shown();
      r.value.textContent = `${name} ${p.mean[index].toFixed(3)} ↑${p.max[index].toFixed(2)}`;
      drawSpark(r.spark, p);
    }
  }

  const clear = button('Clear probes', () => {
    probes.clear();
    render();
  });
  const node = section('Probes', list, empty, el('div', { class: 'buttons' }, clear));
  render();
  return { node, render, update };
}
