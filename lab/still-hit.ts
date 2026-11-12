// Collisions against a still soliton in a medium where it's truly stable.
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampToJSON } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { F?: number; k?: number; offsets?: number[]; steps?: number; frames?: boolean }) {
  const N = 256, c = 128, g = { F: cfg.F ?? 0.054, k: cfg.k ?? 0.065 };
  // settle the soliton in this medium and re-capture its native shape
  const s0 = await makeLab(GS_HISTORY_WAVE, N, g);
  await s0.place(STARTERS('starter-soliton-hw65'), c, c);
  await s0.run(20000);
  const [sb] = blobs((await s0.read()).state, N, s0.layout.S, 1, 0.2);
  const sol = await capture(s0, sb.x, sb.y, 28, 28, `soliton-F${g.F}-k${g.k}`, `HW soliton F=${g.F} k=${g.k}`);
  await window.__saveText('soliton.json', JSON.stringify(stampToJSON(sol)));
  // settle a glider too (its shape adjusts to the medium)
  const g0 = await makeLab(GS_HISTORY_WAVE, N, g);
  await g0.place(STARTERS('starter-glider-hw-axis'), 40, c);
  await g0.run(6000);
  const [gb] = blobs((await g0.read()).state, N, g0.layout.S, 1, 0.2);
  const gl = await capture(g0, gb.x - 2, gb.y, 24, 24, `glider-F${g.F}-k${g.k}`, `HW glider F=${g.F} k=${g.k}`);
  await window.__saveText('glider.json', JSON.stringify(stampToJSON(gl)));
  log(`soliton at ${sb.x.toFixed(1)},${sb.y.toFixed(1)} area ${sb.area}; glider heading check y=${gb.y.toFixed(2)}`);

  const offsets = cfg.offsets ?? [-14, -12, -10, -8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14];
  const runs: { off: number; lab: Lab }[] = [];
  for (const off of offsets) {
    const l = await makeLab(GS_HISTORY_WAVE, N, g);
    await l.place(sol, c, c);
    await l.place(gl, c - 80, c + off);
    runs.push({ off, lab: l });
  }
  const steps = cfg.steps ?? 9000;
  await runAll(runs.map((r) => r.lab), steps - 800);
  const before = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
  await runAll(runs.map((r) => r.lab), 800);
  const out: Record<string, unknown> = {};
  for (const [i, { off, lab }] of runs.entries()) {
    const after = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
    const desc = after.map((q) => {
      const p = before[i].reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m), before[i][0] ?? q);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      return d < 2 ? `still@${q.x.toFixed(0)},${q.y.toFixed(0)}` : `${Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI)}°`;
    });
    out[off] = desc;
    log(`offset ${String(off).padStart(3)}: ${desc.join('  ') || 'nothing left'}`);
    await saveFrame(`hit${off}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `glider → still soliton, offset ${off}` });
  }
  return out;
}
