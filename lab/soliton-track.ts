// Track a Schrödinger soliton over a long run: its peak, the power near it, and how fast its phase
// turns (rad/step, measured at the peak). Starts from a saved field (.rdui) or a soliton stamp.
import * as R from '../src/rule';
import { decodeSnapshot } from '../src/snapshot';
import { STARTER_STAMPS } from '../src/stamps';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { field?: string; stamp?: string; steps: number; every: number; frames?: number[] }) {
  const lab = await makeLab(R.SATURABLE_NLS, 256);
  if (cfg.field) {
    const snap = decodeSnapshot(await (await fetch(cfg.field)).arrayBuffer());
    for (const [k, v] of Object.entries(snap.header.globals)) lab.sim.setGlobal(k, v);
    lab.sim.load(snap.state, snap.params);
  } else await lab.place(STARTER_STAMPS.find((s) => s.id === cfg.stamp)!, 128, 128);
  const N = lab.N, S4 = lab.layout.S * 4;
  let lastPh = 0, turned = 0, lastT = 0;
  const rates: number[] = [];
  for (let t = 0; t <= cfg.steps; t += cfg.every) {
    if (t) await lab.run(cfg.every);
    const { state } = await lab.read();
    let pk = 0, at = 0, total = 0;
    for (let i = 0; i < N * N; i++) { const I = state[i * S4] ** 2 + state[i * S4 + 1] ** 2; total += I; if (I > pk) { pk = I; at = i; } }
    const cx = at % N, cy = Math.floor(at / N);
    let near = 0;
    for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) if (x * x + y * y < 400) { const j = ((((cy + y) % N) + N) % N) * N + ((((cx + x) % N) + N) % N); near += state[j * S4] ** 2 + state[j * S4 + 1] ** 2; }
    // phase at the peak; unwrap assuming it turns less than π per sample
    const ph = Math.atan2(state[at * S4 + 1], state[at * S4]);
    if (t) { let d = ph - lastPh; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); turned += d; rates.push(d / (t - lastT)); }
    lastPh = ph; lastT = t;
    if (t % (cfg.every * 20) === 0) log(`t=${t}: peak ${pk.toFixed(3)} at (${cx},${cy}), power within r20 ${near.toFixed(1)} of ${total.toFixed(1)}, phase rate ${rates.length ? (rates.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, rates.length)).toFixed(5) : '-'} rad/step`);
    if (cfg.frames?.includes(t)) await saveFrame(`soliton-${t}.png`, lab, { ri: 2, lo: 0, hi: 1.3, scale: 1, caption: `t=${t}` });
  }
  log(`overall phase rate ${(turned / cfg.steps).toFixed(5)} rad/step (period ${((2 * Math.PI * cfg.steps) / Math.abs(turned)).toFixed(0)} steps)`);
}
