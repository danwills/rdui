// Straight to wormhood, take 2: learn the full chemistry (all reagents)
// inside and around worms in a soup, then seed lines that carry it.
import { loadBundled } from '../src/ready';
import { makeLab, runAll, blobs, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { lengths?: number[]; halo?: number[]; steps?: number }) {
  const N = 256, c = 128;
  const rule = (await loadBundled('grayscott-historyWave_fuseWorms')).rule;
  const soup = await makeLab(rule, N, {}, 'initial');
  await soup.run(25000);
  const { state } = await soup.read();
  const L = soup.layout, S4 = L.S * 4, R = L.reagents, ib = R.indexOf('b');
  // classify cells: worm core (b>0.3 in an elongated blob) vs background far from any b
  const bs = blobs(state, N, L.S, 1, 0.2).filter((b) => b.elong > 2.5);
  const core = R.map(() => 0), bg = R.map(() => 0); let nc = 0, nb = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * S4;
    const near = bs.some((b) => Math.hypot(b.x - x, b.y - y) < 20);
    if (state[i + ib] > 0.3 && near) { R.forEach((_, r) => (core[r] += state[i + r])); nc++; }
    else if (near && state[i + ib] < 0.05) { R.forEach((_, r) => (bg[r] += state[i + r])); nb++; }
  }
  const cm = core.map((v) => v / nc), hm = bg.map((v) => v / nb);
  log(`worm core: ${R.map((r, k) => `${r}=${cm[k].toFixed(3)}`).join(' ')}`);
  log(`worm surroundings: ${R.map((r, k) => `${r}=${hm[k].toFixed(3)}`).join(' ')}`);
  soup.sim.destroy();
  const jobs = (cfg.lengths ?? [20, 40, 80]).flatMap((len) => (cfg.halo ?? [0, 8, 16]).map((h) => ({ len, h })));
  const runs: { len: number; h: number; lab: Lab; hist: string[] }[] = [];
  for (const j of jobs) {
    const l = await makeLab(rule, N, {});
    const w = j.len + 2 * j.h, hh = 3 + 2 * j.h, x0 = Math.round(c - w / 2), y0 = Math.round(c - hh / 2);
    const { state: st } = await l.sim.readRegion(x0, y0, w, hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const inCore = x >= j.h && x < j.h + j.len && y >= j.h && y < j.h + 3;
      const src = inCore ? cm : hm;
      R.forEach((r, k) => { if (inCore || r !== 'a' && r !== 'b') st[(y * w + x) * S4 + k] = src[k]; });
    }
    l.sim.writeRegion(x0, y0, w, hh, undefined, st);
    runs.push({ ...j, lab: l, hist: [] });
  }
  const steps = cfg.steps ?? 30000;
  for (let t = 0; t < steps; t += steps / 6) {
    await runAll(runs.map((r) => r.lab), steps / 6);
    for (const r of runs) {
      const b = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).sort((p, q) => q.area - p.area);
      r.hist.push(b.length ? `${b.length}:a${b[0].area}/e${b[0].elong.toFixed(1)}` : '0');
    }
  }
  for (const r of runs) {
    log(`line ${r.len}, halo ${r.h}: ${r.hist.join('  ')}`);
    await saveFrame(`line${r.len}-h${r.h}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 3, tlo: 0, thi: 0.35, scale: 2, caption: `line ${r.len} halo ${r.h}` });
    r.lab.sim.destroy();
  }
}
