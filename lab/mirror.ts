// Painted high-k band as a mirror: fire gliders at it at a range of angles;
// report outgoing heading (or absorbed).
import { GS_HISTORY_WAVE } from '../src/rule';
import { rotateStampBy } from '../src/stamps';
import { makeLab, runAll, blobs, saveFrame, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { angles?: number[]; ks?: number[]; band?: number }) {
  const N = 256, band = cfg.band ?? 6;
  const angles = cfg.angles ?? [10, 20, 30, 45, 60, 75];
  const out: Record<string, unknown> = {};
  for (const kv of cfg.ks ?? [0.066, 0.069, 0.072]) {
    const runs: { ang: number; lab: Lab }[] = [];
    for (const ang of angles) {
      const lab = await makeLab(GS_HISTORY_WAVE, N);
      await lab.paint(0, 170, N, band, { k: kv });
      // start so that the glider would hit the band near x = 128
      const r = 100;
      const a = (ang * Math.PI) / 180;
      lab.place(rotateStampBy(STARTERS('starter-glider-hw-axis'), ang), 128 - r * Math.cos(a), 170 - r * Math.sin(a));
      runs.push({ ang, lab });
    }
    const T = Math.round((100 / 19.2) * 1000);
    await runAll(runs.map((x) => x.lab), T + 3000);
    const b0 = await Promise.all(runs.map(async (x) => blobs((await x.lab.read()).state, N, x.lab.layout.S, 1, 0.2)));
    await runAll(runs.map((x) => x.lab), 1500);
    const line: string[] = [];
    for (const [i, { ang, lab }] of runs.entries()) {
      const b1 = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
      const desc = b1.map((b) => {
        const p = b0[i].reduce((m, q) => (Math.hypot(q.x - b.x, q.y - b.y) < Math.hypot(m.x - b.x, m.y - b.y) ? q : m), b0[i][0] ?? b);
        return Math.hypot(b.x - p.x, b.y - p.y) > 5 ? `${Math.round((Math.atan2(b.y - p.y, b.x - p.x) * 180) / Math.PI)}°` : 'still';
      });
      out[`${kv}/${ang}`] = desc;
      line.push(`${ang}°→${desc.join(',') || '✕'}`);
      await saveFrame(`k${kv}-a${ang}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `k=${kv} in at ${ang}°`, boxes: [{ x: 0, y: 170, w: N, h: band, color: '#aa5555' }] });
    }
    log(`band k=${kv}: ${line.join('  ')}`);
  }
  return out;
}
