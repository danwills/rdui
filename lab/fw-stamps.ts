// fuseWorms stamp set: (1) lone gliders captured from a soup with their
// reagent halo and a soft mask, verified alone; (2) worm-chemistry lines and
// rings, checked for staying worms; each good one is saved as a stamp.
import { loadBundled } from '../src/ready';
import { stampToJSON, type Stamp } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, type Lab, type Blob } from './lab';

const PAT = 'grayscott-historyWave_fuseWorms';
const CORE: Record<string, number> = { a: 0.407, b: 0.359, c: 0.363, d: 0.205, e: -0.002 };
const wrapD = (a: number, b: number, N: number) => ((a - b + N * 1.5) % N) - N / 2;

export default async function (cfg: { sizes?: number[]; radii?: number[]; lengths?: number[]; steps?: number; g?: Record<string, number>; skipGliders?: boolean }) {
  const rule = (await loadBundled(PAT)).rule;
  const saved: Record<string, unknown>[] = [];
  const keep = async (st: Stamp, note: string) => { saved.push({ ...stampToJSON(st), note }); await window.__saveText('stamps.json', JSON.stringify(saved)); };

  // (1) gliders from a soup
  if (!cfg.skipGliders) {
  const N = 512, soup = await makeLab(rule, N, {}, 'initial');
  await soup.run(25000);
  const A = blobs((await soup.read()).state, N, soup.layout.S, 1, 0.2);
  await soup.run(300);
  const B = blobs((await soup.read()).state, N, soup.layout.S, 1, 0.2);
  const cands = B.map((b) => {
    const p = A.map((o) => ({ o, d: Math.hypot(wrapD(b.x, o.x, N), wrapD(b.y, o.y, N)) })).sort((u, v) => u.d - v.d)[0];
    const iso = Math.min(...B.filter((o) => o !== b).map((o) => Math.hypot(wrapD(b.x, o.x, N), wrapD(b.y, o.y, N))));
    return { b, v: p ? p.d / 0.3 : 0, iso, h: p ? Math.atan2(wrapD(b.y, p.o.y, N), wrapD(b.x, p.o.x, N)) : 0 };
  }).filter((q) => q.v > 8 && q.v < 30 && q.b.elong < 2.2 && q.b.area < 90).sort((u, v) => v.iso - u.iso).slice(0, 4);
  log(`soup: ${B.length} blobs, ${cands.length} isolated glider candidates (isolation ${cands.map((q) => q.iso.toFixed(0)).join(', ')} px)`);
  const tests: { lab: Lab; st: Stamp; size: number; ci: number }[] = [];
  for (const [ci, q] of cands.entries()) for (const size of cfg.sizes ?? [24, 40, 56]) {
    // centre slightly behind the glider so the box holds its wake
    const st = await capture(soup, q.b.x - Math.cos(q.h) * size / 6, q.b.y - Math.sin(q.h) * size / 6, size, size, `fw-glider-${ci}-${size}`, `fuseWorms glider (${size}px soft halo)`, 0.35);
    const l = await makeLab(rule, 256, {});
    await l.place(st, 128, 128);
    tests.push({ lab: l, st, size, ci });
  }
  await runAll(tests.map((t) => t.lab), 1000);
  const t0 = await Promise.all(tests.map(async (t) => blobs((await t.lab.read()).state, 256, t.lab.layout.S, 1, 0.2)));
  await runAll(tests.map((t) => t.lab), 15000);
  for (const [i, t] of tests.entries()) {
    const b1 = blobs((await t.lab.read()).state, 256, t.lab.layout.S, 1, 0.2);
    const ok = t0[i].length === 1 && b1.length === 1;
    const v = ok ? Math.hypot(wrapD(b1[0].x, t0[i][0].x, 256), wrapD(b1[0].y, t0[i][0].y, 256)) / 15 : 0;
    log(`glider ${t.ci} box ${t.size}: ${t0[i].length}→${b1.length} blobs${ok ? `, ${v.toFixed(1)} px/k` : ''}`);
    if (ok && v > 5) await keep(t.st, `flies alone at ${v.toFixed(1)} px/k`);
    t.lab.sim.destroy();
  }
  soup.sim.destroy();
  }

  // (2) worm-chemistry lines and rings, soft-edged
  const M = 256, c = 128, steps = cfg.steps ?? 60000;
  const shapes = [
    ...(cfg.lengths ?? [30, 40, 50]).map((L) => ({ name: `line ${L}`, w: L + 16, h: 19, inside: (x: number, y: number) => Math.abs(x) <= L / 2 && Math.abs(y) <= 1.5 })),
    ...(cfg.radii ?? [12, 18, 25, 35, 50]).map((R) => ({ name: `ring r${R}`, w: 2 * R + 16, h: 2 * R + 16, inside: (x: number, y: number) => Math.abs(Math.hypot(x, y) - R) <= 1.5 })),
  ];
  const runs: { name: string; lab: Lab; st: Stamp; hist: string[] }[] = [];
  for (const sh of shapes) {
    const l = await makeLab(rule, M, cfg.g ?? {});
    const R = l.layout.reagents, S4 = l.layout.S * 4, x0 = Math.round(c - sh.w / 2), y0 = Math.round(c - sh.h / 2);
    const { state } = await l.sim.readRegion(x0, y0, sh.w, sh.h);
    for (let j = 0; j < sh.h; j++) for (let i = 0; i < sh.w; i++) {
      const x = i + 0.5 - sh.w / 2, y = j + 0.5 - sh.h / 2;
      if (sh.inside(x, y)) R.forEach((r, k) => { if (r in CORE) state[(j * sh.w + i) * S4 + k] = CORE[r]; });
    }
    l.sim.writeRegion(x0, y0, sh.w, sh.h, undefined, state);
    const st = await capture(l, c, c, sh.w, sh.h, `fw-${sh.name.replace(' ', '-')}`, `fuseWorms worm seed: ${sh.name}`);
    runs.push({ name: sh.name, lab: l, st, hist: [] });
  }
  for (let t = 0; t < steps; t += steps / 6) {
    await runAll(runs.map((r) => r.lab), steps / 6);
    for (const r of runs) {
      const b: Blob[] = blobs((await r.lab.read()).state, M, r.lab.layout.S, 1, 0.2).sort((p, q) => q.area - p.area);
      r.hist.push(b.length ? `${b.length}:a${b.reduce((s, q) => s + q.area, 0)}` : '0');
    }
  }
  for (const r of runs) {
    log(`${r.name}: blobs:total-area ${r.hist.join('  ')}`);
    await saveFrame(`${r.name.replace(' ', '-')}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 3, tlo: 0, thi: 0.35, scale: 2, caption: `${r.name} after ${steps}` });
    const last = r.hist.slice(-3).map((h) => (h === '0' ? ['0', 'a0'] : h.split(':')));
    const steady = last[0][0] !== '0' && last.every((q) => q[0] === last[0][0]) && last.every((q) => Math.abs(+q[1].slice(1) - +last[0][1].slice(1)) < 0.1 * +last[0][1].slice(1));
    if (steady) await keep(r.st, `${r.name}: settles into ${last[0][0]} blob(s), steady`);
    r.lab.sim.destroy();
  }
  return saved.map((s) => ({ id: s.id, note: s.note }));
}
