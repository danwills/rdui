// node lab/run.mjs gap-ring '{"steps":20000}'
// Gap-junction step 2: a ring worm (a band painted with worm params, in dead medium) through a junction disc painted
// with bistable blob params (step 1: F 0.06, k ~0.057), wider than the worm. Four rings: band half-width 3 / 5, junction
// started on (filled) / off. Does the ring hold as one worm, the blob stay on, and an off junction stay off (a gap)?
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { steps?: number; worm?: [number, number]; blob?: [number, number]; jr?: number; R?: number; cases?: [number, boolean][] }) {
  const N = 512, Q = 256, ringR = cfg.R ?? 80, jr = cfg.jr ?? 14;
  const [wF, wk] = cfg.worm ?? [0.078, 0.061], [bF, bk] = cfg.blob ?? [0.06, 0.057];
  const l = await makeLab(R.GRAY_SCOTT, N, {}, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, iF = l.layout.paramNames.indexOf('F'), ik = l.layout.paramNames.indexOf('k');
  const ia = l.layout.reagents.indexOf('a'), ib = l.layout.reagents.indexOf('b');
  const cases = cfg.cases ?? [[3, true], [3, false], [5, true], [5, false]];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const q = (y >= Q ? 2 : 0) + (x >= Q ? 1 : 0), [hw, on] = cases[q];
    const dx = (x % Q) - Q / 2 + 0.5, dy = (y % Q) - Q / 2 + 0.5, rr = Math.hypot(dx, dy);
    const band = Math.abs(rr - ringR) <= hw, jd = Math.hypot(dx - ringR, dy), junc = jd <= jr;
    const i = y * N + x;
    params[i * P4 + iF] = junc ? bF : band ? wF : wF;
    params[i * P4 + ik] = junc ? bk : band ? wk : 0.075;
    const fill = junc ? on : band;
    state[i * S4 + ia] = fill ? 0.4 : 1;
    state[i * S4 + ib] = fill ? 0.3 : 0;
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  const total = cfg.steps ?? 20000;
  for (let n = 0; n <= total; n += total / 4) {
    if (n) await l.run(total / 4);
    const { state: s } = await l.read();
    const report = cases.map(([hw, on], q) => {
      const ox = (q % 2) * Q + Q / 2, oy = Math.floor(q / 2) * Q + Q / 2;
      // the junction's mean b, and the ring: b on its centre line every 2°, the gaps (b < 0.05) outside the junction
      let jn = 0, js = 0;
      for (let y = -jr; y <= jr; y++) for (let x = -jr; x <= jr; x++) if (x * x + y * y <= jr * jr) { jn++; js += s[((oy + y) * N + ox + ringR + x) * S4 + ib]; }
      let gaps = 0, lo = 1;
      for (let a = 0; a < 360; a += 2) {
        const t = (a * Math.PI) / 180, px = Math.round(ox + ringR * Math.cos(t)), py = Math.round(oy + ringR * Math.sin(t));
        if (Math.hypot(px - ox - ringR, py - oy) <= jr + 2) continue;
        // (the most b across the band at this angle: the worm may sit off-centre)
        let best = 0;
        for (let d = -hw; d <= hw; d++) best = Math.max(best, s[(Math.round(oy + (ringR + d) * Math.sin(t)) * N + Math.round(ox + (ringR + d) * Math.cos(t))) * S4 + ib]);
        if (best < 0.05) gaps++;
        lo = Math.min(lo, best);
      }
      return `hw${hw} ${on ? 'on ' : 'off'}: junction b ${(js / jn).toFixed(2)}, ring gaps ${gaps}/~170 (weakest ${lo.toFixed(2)})`;
    });
    log(`step ${n}: ${report.join(' | ')}`);
  }
  await saveFrame('ring.png', l, { ri: ib, lo: 0, hi: 0.4, scale: 1, caption: cases.map(([h, o]) => `hw${h} ${o ? 'on' : 'off'}`).join(' | ') });
}
