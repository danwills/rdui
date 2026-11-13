// Glider loop, seeded with a relaxed glider: a two-corner "donor" run (long
// run-in, which corner 2 is known to turn) is captured mid-leg between corners
// 1 and 2, halo and all; the copy is placed at the same spot in the full
// four-corner loop, so corner 2 sees exactly the glider it turned before.
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampToJSON } from '../src/stamps';
import { makeLab, runAll, blobs, capture, log, saveFrame, STARTERS, HW_STD, type Lab } from './lab';
import { corners } from './loop';

export default async function (cfg: { L?: number; across?: number; bAng?: number; runIn?: number; at?: number[]; box?: number; soft?: number; steps?: number; N?: number; frames?: boolean }) {
  const N = cfg.N ?? 768, L = cfg.L ?? 441, ac = cfg.across ?? 110, bA = cfg.bAng ?? 72, box = cfg.box ?? 56;
  const setup = async (n: number) => {
    const l = await makeLab(GS_HISTORY_WAVE, N, HW_STD);
    const c = corners(L, N / 2, N / 2, n, ac, bA);
    for (const [j, [x, y]] of c.pts.entries()) await l.place(STARTERS('starter-soliton-hw65'), x, y, { rot: c.rots[j] });
    await runAll([l], 4000);
    return { l, c };
  };
  const donor = await setup(2);
  await donor.l.place(STARTERS('starter-glider-hw65'), donor.c.glider[0] - (cfg.runIn ?? 303), donor.c.glider[1]);
  // run until the glider is the given distances (px past A0.y) down the leg, capturing at each
  const A0 = donor.c.A0, caps: { at: number; cx: number; cy: number; st: ReturnType<typeof stampToJSON> }[] = [];
  const glider = async (lab: Lab, pts: number[][]) => blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2).filter((b) => !pts.some(([x, y]) => Math.hypot(b.x - x, b.y - y) < 6));
  for (const at of cfg.at ?? [330]) {
    for (let k = 0; k < 200; k++) {
      const g = await glider(donor.l, donor.c.pts);
      if (g.length === 1 && g[0].y - A0[1] >= at && g[0].x > A0[0] + 60) {
        const cx = Math.round(g[0].x), cy = Math.round(g[0].y);
        const st = await capture(donor.l, cx, cy, box, box, `starter-glider-hw-relaxed`, 'HW glider (relaxed, heading 90°)', cfg.soft ?? 0.35);
        caps.push({ at, cx, cy, st: stampToJSON(st) });
        log(`captured at y = A0+${(g[0].y - A0[1]).toFixed(1)}, x = A0+${(g[0].x - A0[0]).toFixed(1)}`);
        break;
      }
      await runAll([donor.l], 250);
    }
  }
  donor.l.sim.destroy();
  await window.__saveText('relaxed-glider.json', JSON.stringify(caps.map((c) => c.st)));
  // full loops, one per capture
  const runs: { cap: (typeof caps)[0]; l: Lab; c: ReturnType<typeof corners>; heads: number[]; last: number[] | null; trail: string[] }[] = [];
  for (const cap of caps) {
    const { l, c } = await setup(4);
    const { stampFromJSON } = await import('../src/stamps');
    await l.place(stampFromJSON(cap.st), cap.cx, cap.cy);
    runs.push({ cap, l, c, heads: [], last: null, trail: [] });
  }
  const dt = cfg.frames ? 1500 : 4000;
  let f = 0;
  for (let t = dt; t <= (cfg.steps ?? 280000); t += dt) {
    await runAll(runs.map((r) => r.l), dt);
    if (cfg.frames) await saveFrame(`f${String(f++).padStart(4, '0')}.png`, runs[0].l, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `glider loop, relaxed glider relayed in  t=${t}` });
    for (const r of runs) {
      const g = await glider(r.l, r.c.pts);
      r.trail.push(g.length === 1 ? `${t / 1000}k:(${g[0].x.toFixed(0)},${g[0].y.toFixed(0)})` : `${t / 1000}k:${g.length}`);
      if (g.length !== 1) { r.last = null; continue; }
      if (r.last) {
        let dx = g[0].x - r.last[0], dy = g[0].y - r.last[1];
        dx -= Math.round(dx / N) * N; dy -= Math.round(dy / N) * N;
        const a = (Math.atan2(dy, dx) * 180) / Math.PI, h = ((Math.round(a / 90) * 90) % 360 + 360) % 360;
        if (Math.hypot(dx, dy) > 40 && Math.abs(((a - h + 540) % 360) - 180) < 8 && r.heads.at(-1) !== h) r.heads.push(h);
      }
      r.last = [g[0].x, g[0].y];
    }
    if (t % 40000 === 0) log(`t=${t}: ${runs.map((r) => `cap@${r.cap.at} legs ${r.heads.join('→')}`).join('; ')}`);
  }
  const out = [];
  for (const r of runs) {
    const after = blobs((await r.l.read()).state, N, r.l.layout.S, 1, 0.2);
    const intact = r.c.pts.filter(([x, y]) => after.some((q) => Math.hypot(q.x - x, q.y - y) < 5)).length;
    log(`relay from y=A0+${r.cap.at}: ${intact}/24 intact, ${after.length - intact} movers; axis legs ${r.heads.join(' → ')} (${Math.max(0, r.heads.length - 1)} turns)`);
    await saveFrame(`relay-${r.cap.at}.png`, r.l, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `loop relay ${r.cap.at}: ${r.heads.join('→')}` });
    log(`  trail: ${r.trail.join(' ')}`);
    out.push({ at: r.cap.at, cx: r.cap.cx, cy: r.cap.cy, intact, heads: r.heads, trail: r.trail });
    r.l.sim.destroy();
  }
  return out;
}
