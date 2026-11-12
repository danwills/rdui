// Toggle hunt: bound soliton clusters (25 px bonds) hit by a passing glider.
// Wanted: glider survives, cluster survives with the same members, but its
// arrangement changes (moved/rotated) — then test whether a pass from the
// other side restores it.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, saveFrame, log, STARTERS, type Lab, type Blob } from './lab';

const D = 25, H = D * Math.sqrt(3) / 2;
const CLUSTERS: Record<string, [number, number][]> = {
  'pair—': [[-D / 2, 0], [D / 2, 0]],
  'pair|': [[0, -D / 2], [0, D / 2]],
  'pair/': [[-D / 2 / Math.SQRT2, D / 2 / Math.SQRT2], [D / 2 / Math.SQRT2, -D / 2 / Math.SQRT2]],
  'tri▲': [[0, -H * 2 / 3], [-D / 2, H / 3], [D / 2, H / 3]],
  'tri▶': [[-H / 3, -D / 2], [-H / 3, D / 2], [H * 2 / 3, 0]],
};

export default async function (cfg: { media?: Record<string, number>[]; offsets?: number[]; clusters?: string[]; steps?: number }) {
  const N = 192, c = 96;
  const media = cfg.media ?? [{ F: 0.052, k: 0.066 }, { F: 0.05, k: 0.065 }];
  const offsets = cfg.offsets ?? Array.from({ length: 21 }, (_, i) => -30 + 3 * i);
  const names = cfg.clusters ?? Object.keys(CLUSTERS);
  const steps = cfg.steps ?? 14000;
  const hits: Record<string, unknown>[] = [];
  for (const g of media) {
    for (const name of names) {
      const runs: { off: number; lab: Lab }[] = [];
      for (const off of offsets) {
        const l = await makeLab(GS_HISTORY_WAVE, N, g);
        for (const [x, y] of CLUSTERS[name]) await l.place(STARTERS('starter-soliton-hw65'), c + x, c + y);
        runs.push({ off, lab: l });
      }
      await runAll(runs.map((r) => r.lab), 3000); // settle the cluster first
      const before = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
      for (const r of runs) await r.lab.place(STARTERS('starter-glider-hw65'), c - 75, c + r.off);
      await runAll(runs.map((r) => r.lab), steps - 600);
      const mid = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
      await runAll(runs.map((r) => r.lab), 600);
      const line: string[] = [];
      for (const [i, r] of runs.entries()) {
        const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
        const stills: Blob[] = [], movers: number[] = [];
        for (const q of after) {
          const p = mid[i].reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m), mid[i][0] ?? q);
          if (Math.hypot(q.x - p.x, q.y - p.y) < 3) stills.push(q); else movers.push(Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI));
        }
        const b0 = before[i];
        let tag = '·';
        if (stills.length === b0.length && movers.length === 1) {
          // displacement of each original member to its nearest still
          const disp = b0.map((p) => Math.min(...stills.map((q) => Math.hypot(q.x - p.x, q.y - p.y))));
          const maxD = Math.max(...disp);
          tag = maxD > 3 ? `CHANGED ${maxD.toFixed(0)}px` : 'pass';
          if (maxD > 3) {
            hits.push({ medium: g, cluster: name, off: r.off, maxDisp: maxD, glider: movers[0], before: b0.map((p) => [p.x, p.y]), after: stills.map((p) => [p.x, p.y]) });
            await saveFrame(`${g.F}-${g.k}-${name}-o${r.off}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `${name} off ${r.off}: moved ${maxD.toFixed(0)}px`, boxes: b0.map((p) => ({ x: p.x - 3, y: p.y - 3, w: 6, h: 6, color: '#ff6688' })) });
          }
        } else if (movers.length === 0 && stills.length === b0.length) tag = 'eat';
        else tag = `${stills.length}s/${movers.length}m`;
        line.push(`${r.off}:${tag}`);
        r.lab.sim.destroy();
      }
      log(`F=${g.F} k=${g.k} ${name}: ${line.join('  ')}`);
    }
  }
  return hits;
}
