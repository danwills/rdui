// Place a captured U-skate stamp into a fresh excited U-skate-world field (a few
// angles, degrees clockwise) and check it glides: hole-cluster centroid, area and heading.
import { GRAY_SCOTT } from '../src/rule';
import { stampFromJSON, rotateStampBy } from '../src/stamps';
import { makeLab, runAll, blobs, wrapDelta, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { stamp: string; k?: number; angles?: number[]; N?: number; steps?: number; every?: number }) {
  const N = cfg.N ?? 160, F = 0.062, k = cfg.k ?? 0.0609;
  const st = stampFromJSON(await (await fetch(cfg.stamp)).json());
  const Fk = F + k, bHi = (1 + Math.sqrt(1 - (4 * Fk * Fk) / F)) / ((2 * Fk) / F), aHi = Fk / bHi;
  const runs: { lab: Lab; rot: number; path: { x: number; y: number; area: number }[] }[] = [];
  for (const rot of cfg.angles ?? [0, 90, 30, 45]) {
    const lab = await makeLab(GRAY_SCOTT, N, { F, k });
    const { state } = await lab.read();
    for (let i = 0; i < N * N; i++) { state[i * 4] = aHi; state[i * 4 + 1] = bHi; }
    lab.sim.writeRegion(0, 0, N, N, undefined, state);
    await lab.place(rot ? rotateStampBy(st, rot) : st, N / 2, N / 2);
    runs.push({ lab, rot, path: [] });
  }
  const hole = async (lab: Lab) => {
    const s = (await lab.read()).state.slice();
    for (let i = 1; i < s.length; i += 4) s[i] = 0.4 - s[i];
    const bl = blobs(s, N, 1, 1, 0.25).sort((a, b) => b.area - a.area);
    return bl.length ? { x: bl[0].x, y: bl[0].y, area: bl[0].area, n: bl.length } : { x: NaN, y: NaN, area: 0, n: 0 };
  };
  for (let t = 0; t <= (cfg.steps ?? 40000); t += cfg.every ?? 5000) {
    if (t) await runAll(runs.map((r) => r.lab), cfg.every ?? 5000);
    for (const r of runs) {
      const h = await hole(r.lab);
      r.path.push(h);
      if (t === (cfg.steps ?? 40000)) await saveFrame(`rot${r.rot}.png`, r.lab, { ri: 1, lo: 0, hi: 0.4, scale: 2, caption: `${r.rot}° t=${t}` });
    }
  }
  for (const r of runs) {
    // sum per-sample moves (each well under N/2), skipping the first two while it settles
    const p = r.path;
    let dx = 0, dy = 0;
    for (let i = 3; i < p.length; i++) { dx += wrapDelta(p[i - 1].x, p[i].x, N); dy += wrapDelta(p[i - 1].y, p[i].y, N); }
    const n = (p.length - 3) * (cfg.every ?? 5000);
    log(`${r.rot}°: areas ${p.map((q) => q.area).join(' ')}; heading ${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}°, speed ${((1000 * Math.hypot(dx, dy)) / n).toFixed(2)} px/kstep`);
  }
}
