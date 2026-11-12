// Map the three-component FHN medium: seed one spot, see whether it dies,
// sits, travels, breathes, splits or spreads, across tau / theta / kappa1.
import { FHN3 } from '../src/rule';
import { makeLab, runAll, blobs, seedDisk, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { media?: Record<string, number>[]; taus?: number[]; thetas?: number[]; k1s?: number[]; rate?: number; steps?: number; N?: number; batch?: number; seedR?: number }) {
  const N = cfg.N ?? 160, c = N / 2, steps = cfg.steps ?? 60000, batch = cfg.batch ?? 16;
  const jobs: Record<string, number>[] = cfg.media ?? (cfg.k1s ?? [-6.92]).flatMap((kappa1) => (cfg.taus ?? [1, 4, 16, 48]).flatMap((tau) => (cfg.thetas ?? [0.5, 2, 8]).map((theta) => ({ kappa1, tau, theta, rate: cfg.rate ?? 0.04 }))));
  const res: Record<string, unknown>[] = [];
  for (let j = 0; j < jobs.length; j += batch) {
    const runs: { g: Record<string, number>; lab: Lab; track: { n: number; x: number; y: number; peak: number; area: number }[] }[] = [];
    for (const g of jobs.slice(j, j + batch)) {
      const l = await makeLab(FHN3, N, g);
      await seedDisk(l, c, c, cfg.seedR ?? 5, { u: 1 });
      runs.push({ g, lab: l, track: [] });
    }
    const dt = steps / 60;
    for (let t = 0; t < steps; t += dt) {
      await runAll(runs.map((r) => r.lab), dt);
      for (const r of runs) {
        const bs = blobs((await r.lab.read()).state, N, r.lab.layout.S, 0, 0, 2);
        const b = bs.sort((a, q) => q.area - a.area)[0];
        r.track.push({ n: bs.length, x: b?.x ?? NaN, y: b?.y ?? NaN, peak: b?.peak ?? 0, area: bs.reduce((s, q) => s + q.area, 0) });
      }
    }
    for (const r of runs) {
      const tr = r.track, late = tr.slice(30);
      const nEnd = tr.at(-1)!.n, areaEnd = tr.at(-1)!.area;
      let dist = 0;
      for (let i = 1; i < late.length; i++) if (late[i].n === 1 && late[i - 1].n === 1) dist += Math.hypot(((late[i].x - late[i - 1].x + N * 1.5) % N) - N / 2, ((late[i].y - late[i - 1].y + N * 1.5) % N) - N / 2);
      const speed = (dist / (dt * (late.length - 1))) * 1000;
      const areas = late.map((q) => q.area), amp = (Math.max(...areas) - Math.min(...areas)) / Math.max(1, areas.reduce((a, b) => a + b, 0) / areas.length);
      const kind = nEnd === 0 ? 'dies' : areaEnd > 0.3 * N * N ? 'spreads' : nEnd > 1 ? `splits→${nEnd}` : speed > 0.5 ? `TRAVELS ${speed.toFixed(1)}px/k` : amp > 0.15 ? `BREATHES (area ±${(amp * 50).toFixed(0)}%)` : `still (area ${areaEnd})`;
      res.push({ ...r.g, kind });
      log(`${Object.entries(r.g).map(([k, v]) => `${k}=${v}`).join(' ')}: ${kind}`);
      await saveFrame(`${Object.values(r.g).join('_')}.png`, r.lab, { ri: 0, lo: -1, hi: 1.2, ti: 2, tlo: -1, thi: 0.5, scale: 1, caption: `${kind}` });
      r.lab.sim.destroy();
    }
  }
  return res;
}
