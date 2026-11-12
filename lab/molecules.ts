// Molecule census: random groups of 3–6 solitons (spacings 18–32 px) in the
// fence medium, settled for a long time. Group the stable end states by shape
// (sorted bond lengths); flag any that drift as a whole (self-propelled).
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampToJSON } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, STARTERS, type Lab, type Blob } from './lab';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export default async function (cfg: { F?: number; k?: number; trials?: number; settle?: number; batch?: number; seed?: number }) {
  const N = 160, c = 80, g = { F: cfg.F ?? 0.052, k: cfg.k ?? 0.066 };
  const trials = cfg.trials ?? 48, batch = cfg.batch ?? 16, settle = cfg.settle ?? 80000;
  const R = rng(cfg.seed ?? 7);
  const kinds = new Map<string, { count: number; moving: number; example?: string }>();
  for (let j = 0; j < trials; j += batch) {
    const runs: { lab: Lab; n: number }[] = [];
    for (let t = j; t < Math.min(trials, j + batch); t++) {
      const n = 3 + Math.floor(R() * 4);
      // grow a random connected group: each new soliton 18–32 px from a random existing one, not closer than 16 to any
      const pts: [number, number][] = [[c, c]];
      while (pts.length < n) {
        const [px, py] = pts[Math.floor(R() * pts.length)];
        const a = R() * 2 * Math.PI, d = 18 + R() * 14;
        const q: [number, number] = [px + d * Math.cos(a), py + d * Math.sin(a)];
        if (pts.every(([x, y]) => Math.hypot(x - q[0], y - q[1]) >= 16) && Math.hypot(q[0] - c, q[1] - c) < 45) pts.push(q);
      }
      const l = await makeLab(GS_HISTORY_WAVE, N, g);
      for (const [x, y] of pts) await l.place(STARTERS('starter-soliton-hw65'), x, y);
      runs.push({ lab: l, n });
    }
    await runAll(runs.map((r) => r.lab), settle);
    const b0 = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
    await runAll(runs.map((r) => r.lab), 10000);
    for (const [i, r] of runs.entries()) {
      const b1: Blob[] = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
      if (!b1.length) { r.lab.sim.destroy(); continue; }
      const cx = b1.reduce((s, b) => s + b.x, 0) / b1.length, cy = b1.reduce((s, b) => s + b.y, 0) / b1.length;
      const c0x = b0[i].reduce((s, b) => s + b.x, 0) / Math.max(1, b0[i].length), c0y = b0[i].reduce((s, b) => s + b.y, 0) / Math.max(1, b0[i].length);
      const drift = b0[i].length === b1.length ? Math.hypot(cx - c0x, cy - c0y) : NaN;
      // shape key: sorted bond lengths (pairs < 34 px) rounded to 2 px, plus count
      const bonds: number[] = [];
      for (let a = 0; a < b1.length; a++) for (let b = a + 1; b < b1.length; b++) { const d = Math.hypot(b1[a].x - b1[b].x, b1[a].y - b1[b].y); if (d < 34) bonds.push(Math.round(d / 2) * 2); }
      const key = `${b1.length} solitons, bonds [${bonds.sort((x, y) => x - y).join(',')}]`;
      const k = kinds.get(key) ?? { count: 0, moving: 0 };
      k.count++;
      if (drift > 2) k.moving++;
      if (!k.example) {
        const id = `mol-${kinds.size}`;
        k.example = id;
        const xs = b1.map((b) => b.x), ys = b1.map((b) => b.y);
        const w = Math.ceil(Math.max(...xs) - Math.min(...xs) + 30), h = Math.ceil(Math.max(...ys) - Math.min(...ys) + 30);
        const st = await capture(r.lab, (Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, w, h, id, `molecule: ${key}`);
        await window.__saveText(`${id}.json`, JSON.stringify({ key, medium: g, drift, stamp: stampToJSON(st) }));
        await saveFrame(`${id}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `${id}: ${key}${drift > 2 ? ` drifting ${drift.toFixed(1)}px/10k` : ''}` });
      }
      kinds.set(key, k);
      r.lab.sim.destroy();
    }
    log(`after ${Math.min(trials, j + batch)} trials: ${kinds.size} distinct end states`);
  }
  const list = [...kinds].sort((a, b) => b[1].count - a[1].count);
  for (const [key, k] of list) log(`${k.example}: ${key} ×${k.count}${k.moving ? ` (${k.moving} drifting)` : ''}`);
  return list;
}
