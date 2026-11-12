// Natural reflector hunt: capture a stationary soliton from a moreLifelike
// soup, check it persists alone, then fire axis gliders at it across impact
// offsets and record what comes out (and whether the soliton survives).
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampToJSON, type Stamp } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { offsets?: number[]; steps?: number }) {
  const N = 256, c = 128;
  // 1. soup → most isolated still blob
  const soup = await makeLab(GS_HISTORY_WAVE, N, {}, 'initial');
  await soup.run(15000);
  const a = blobs((await soup.read()).state, N, soup.layout.S, 1, 0.2);
  await soup.run(1000);
  const b = blobs((await soup.read()).state, N, soup.layout.S, 1, 0.2);
  const still = b.filter((q) => a.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 1));
  const iso = still.map((q) => ({ q, d: Math.min(...b.filter((o) => o !== q).map((o) => Math.hypot(o.x - q.x, o.y - q.y))) })).sort((x, y) => y.d - x.d)[0];
  log(`soup: ${b.length} blobs, ${still.length} still; most isolated at ${iso.q.x.toFixed(1)},${iso.q.y.toFixed(1)} (nearest ${iso.d.toFixed(0)}px) area ${iso.q.area}`);
  const sol: Stamp = await capture(soup, iso.q.x, iso.q.y, 28, 28, 'starter-soliton-hw', 'HW soliton (still)');
  await window.__saveText('soliton.json', JSON.stringify(stampToJSON(sol)));
  // 2. alone
  const alone = await makeLab(GS_HISTORY_WAVE, N);
  alone.place(sol, c, c);
  for (let t = 0; t < 4; t++) {
    await alone.run(5000);
    const bs = blobs((await alone.read()).state, N, alone.layout.S, 1, 0.2);
    log(`alone t=${(t + 1) * 5000}: ` + bs.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)} a${q.area} pk${q.peak.toFixed(2)}`).join(' '));
  }
  // 3. collisions
  const offsets = cfg.offsets ?? [-16, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 16];
  const runs: { off: number; lab: Lab }[] = [];
  for (const off of offsets) {
    const l = await makeLab(GS_HISTORY_WAVE, N);
    l.place(sol, c, c);
    l.place(STARTERS('starter-glider-hw-axis'), c - 80, c + off);
    runs.push({ off, lab: l });
  }
  const steps = cfg.steps ?? 8000;
  await runAll(runs.map((r) => r.lab), steps - 800);
  const before = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
  await runAll(runs.map((r) => r.lab), 800);
  const out: Record<string, unknown> = {};
  for (const [i, { off, lab }] of runs.entries()) {
    const after = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
    const desc = after.map((q) => {
      const p = before[i].reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m), before[i][0] ?? q);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      return d < 2 ? `still@${q.x.toFixed(0)},${q.y.toFixed(0)}` : `${Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI)}°@${q.x.toFixed(0)},${q.y.toFixed(0)}`;
    });
    out[off] = desc;
    log(`offset ${String(off).padStart(3)}: ${desc.join('  ') || 'nothing left'}`);
    await saveFrame(`hit${off}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `glider → soliton, offset ${off}` });
  }
  return out;
}
