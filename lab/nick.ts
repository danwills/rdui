// Nick test: in copies of one fuseWorms soup, erase (fade to rest) a soft
// disk at one end of a different straight worm in each copy; count small
// movers near that worm afterwards versus an un-nicked control copy.
import { loadBundled } from '../src/ready';
import { makeLab, runAll, blobs, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { g?: Record<string, number>; maxWorms?: number; r?: number; steps?: number }) {
  const N = 512, rule = (await loadBundled('grayscott-historyWave_fuseWorms')).rule, g = cfg.g ?? {};
  const soup = await makeLab(rule, N, g, 'initial');
  await soup.run(25000);
  const A = blobs((await soup.read()).state, N, soup.layout.S, 1, 0.2);
  await soup.run(2000);
  const snap = await soup.read();
  const L = soup.layout, S4 = L.S * 4, ib = L.reagents.indexOf('b'), rest = soup.rule.rest;
  const B = blobs(snap.state, N, L.S, 1, 0.2);
  // steady straight worms: elongated, nearly same place and area 2000 steps ago, away from the edges
  const worms = B.filter((b) => b.elong > 5 && b.area > 120 && b.x > 60 && b.x < N - 60 && b.y > 60 && b.y < N - 60 &&
    A.some((a) => Math.hypot(a.x - b.x, a.y - b.y) < 3 && Math.abs(a.area - b.area) < 0.15 * b.area)).slice(0, cfg.maxWorms ?? 10);
  log(`soup: ${B.length} blobs, ${worms.length} steady straight worms`);
  const bAt = (x: number, y: number) => snap.state[(y * N + x) * S4 + ib];
  const jobs: { lab: Lab; w?: (typeof worms)[0]; end?: [number, number] }[] = [];
  const mk = async () => { const l = await makeLab(rule, N, g); l.sim.load(new Float32Array(snap.state), new Float32Array(snap.params)); return l; };
  jobs.push({ lab: await mk() });
  const r = cfg.r ?? 5;
  for (const w of worms) {
    // flood-fill this worm's pixels from its nearest b>0.2 pixel, take the pixel farthest from the centroid as one end
    const seen = new Set<number>(), stack: number[] = [];
    let best = -1, bd = 1e9;
    for (let y = Math.round(w.y) - 4; y <= Math.round(w.y) + 4; y++) for (let x = Math.round(w.x) - 4; x <= Math.round(w.x) + 4; x++) if (bAt(x, y) > 0.2 && Math.hypot(x - w.x, y - w.y) < bd) { bd = Math.hypot(x - w.x, y - w.y); best = y * N + x; }
    if (best < 0) continue;
    stack.push(best); seen.add(best);
    let end: [number, number] = [w.x, w.y], far = 0;
    while (stack.length) {
      const p = stack.pop()!, x = p % N, y = (p / N) | 0, d = Math.hypot(x - w.x, y - w.y);
      if (d > far) { far = d; end = [x, y]; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = (y + dy) * N + x + dx; if (!seen.has(q) && bAt(x + dx, y + dy) > 0.2) { seen.add(q); stack.push(q); } }
    }
    const l = await mk();
    const x0 = Math.round(end[0] - 2 * r), y0 = Math.round(end[1] - 2 * r), s = 4 * r + 1;
    const { state } = await l.sim.readRegion(x0, y0, s, s);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const d = Math.hypot(i - 2 * r, j - 2 * r), t = Math.min(1, Math.max(0, (2 * r - d) / r)), m = t * t * (3 - 2 * t);
      for (let k = 0; k < rest.length; k++) { const q = (j * s + i) * S4 + k; state[q] = rest[k] + (state[q] - rest[k]) * (1 - m); }
    }
    l.sim.writeRegion(x0, y0, s, s, undefined, state);
    jobs.push({ lab: l, w, end });
  }
  const steps = cfg.steps ?? 12000, nT = 4;
  const counts = jobs.map(() => [] as number[]);
  const small = (b: { area: number; elong: number }) => b.area < 90 && b.elong < 2.2;
  for (let t = 0; t < nT; t++) {
    await runAll(jobs.map((j) => j.lab), steps / nT);
    for (const [i, j] of jobs.entries()) if (i) {
      const near = async (lab: Lab) => blobs((await lab.read()).state, N, L.S, 1, 0.2).filter((b) => small(b) && Math.hypot(b.x - j.w!.x, b.y - j.w!.y) < 70).length;
      counts[i].push((await near(j.lab)) - (await near(jobs[0].lab)));
    }
  }
  const res = [];
  for (const [i, j] of jobs.entries()) if (i) {
    const fin = blobs((await j.lab.read()).state, N, L.S, 1, 0.2);
    const still = fin.some((b) => Math.hypot(b.x - j.w!.x, b.y - j.w!.y) < 15 && b.elong > 3);
    log(`worm ${i} (a${j.w!.area} e${j.w!.elong.toFixed(1)}), nicked at (${j.end![0]},${j.end![1]}): extra small blobs nearby vs control ${counts[i].map((c) => (c >= 0 ? '+' : '') + c).join(' ')}; worm ${still ? 'still there' : 'gone'}`);
    res.push({ i, extra: counts[i], still });
    await saveFrame(`nick-${i}.png`, j.lab, { ri: 1, lo: 0, hi: 0.5, ti: 3, tlo: 0, thi: 0.35, scale: 1, caption: `worm ${i} nicked`, boxes: [{ x: j.w!.x - 70, y: j.w!.y - 70, w: 140, h: 140, color: '#ff6688' }, { x: j.end![0] - 5, y: j.end![1] - 5, w: 10, h: 10, color: '#ffffff' }] });
  }
  await saveFrame('control.png', jobs[0].lab, { ri: 1, lo: 0, hi: 0.5, ti: 3, tlo: 0, thi: 0.35, scale: 1, caption: 'control' });
  return res;
}
