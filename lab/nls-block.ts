// Blocking: can a present input stop a clock, whatever its phase? A slow clock (light by default) heads east
// through X; a standard input crosses its path at `angle` (degrees: the input's heading relative to the clock's,
// measured anticlockwise), arriving at X `dt` steps after the clock does, with phase `phase` (degrees).
// After `tail` steps: is there still a soliton over `alive` power where the clock would be? (blocked = no)
// Runs every combination of the listed values, in one session.
//   node lab/run.mjs nls-block '{"angle":[60,90,120],"phase":[0,90,180,270],"dt":[0]}'
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp } from '../src/stamps';
import { makeLab, log } from './lab';

interface Spot { x: number; y: number; power: number }
function spots(state: Float32Array, N: number, S4: number, thr = 0.3, r = 12): Spot[] {
  const I = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) I[i] = state[i * S4] ** 2 + state[i * S4 + 1] ** 2;
  const at = (x: number, y: number) => I[((y + N) % N) * N + ((x + N) % N)];
  const out: Spot[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = I[y * N + x];
    if (v < thr) continue;
    let max = true;
    for (let dy = -4; dy <= 4 && max; dy++) for (let dx = -4; dx <= 4; dx++) if ((dx || dy) && at(x + dx, y + dy) > v) { max = false; break; }
    if (!max) continue;
    let p = 0, sx = 0, sy = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) { const w = at(x + dx, y + dy); p += w; sx += w * dx; sy += w * dy; }
    if (!out.some((o) => Math.hypot(o.x - x, o.y - y) < r)) out.push({ x: x + sx / p, y: y + sy / p, power: p });
  }
  return out;
}

export default async function (cfg: { angle?: number[]; phase?: number[]; dt?: number[]; clock?: string; cK?: number; k?: number; lead?: number; tail?: number; alive?: number; N?: number }) {
  const N = cfg.N ?? 256, cK = cfg.cK ?? 0.04, k = cfg.k ?? 0.08, lead = cfg.lead ?? 3000, tail = cfg.tail ?? 4000, alive = cfg.alive ?? 150;
  const clock = STARTER_STAMPS.find((s) => s.id === `nls-soliton-${cfg.clock ?? 'light'}-0-still`)!;
  const input = STARTER_STAMPS.find((s) => s.id === 'nls-soliton-0-still')!;
  const X = { x: N / 2, y: N / 2 };
  const rows: string[] = [];
  for (const angle of cfg.angle ?? [90]) for (const phase of cfg.phase ?? [0]) for (const dt of cfg.dt ?? [0]) {
    const lab = await makeLab(R.SATURABLE_NLS, N);
    const S4 = lab.layout.S * 4, per = lab.globals.timestep / lab.globals.dx ** 2;
    const vc = cK * per, v = k * per, a = (angle * Math.PI) / 180;
    // clock: at X after `lead` steps; input: at X after lead + dt steps (headings anticlockwise, y up)
    await lab.place(boostStamp(clock, 0, cK, 0, 'c', 'c'), X.x - vc * lead, X.y);
    const ti = lead + dt;
    await lab.place(boostStamp(input, (phase * Math.PI) / 180, k * Math.cos(a), -k * Math.sin(a), 'i', 'i'), X.x - v * ti * Math.cos(a), X.y + v * ti * Math.sin(a));
    await lab.run(lead + tail);
    const s = spots((await lab.read()).state, N, S4).filter((p) => p.power > 50);
    const want = { x: X.x + vc * tail, y: X.y };
    const d = (p: Spot) => Math.hypot(((p.x - want.x + N * 1.5) % N) - N / 2, ((p.y - want.y + N * 1.5) % N) - N / 2);
    const there = s.filter((p) => d(p) < 15 && p.power > alive);
    rows.push(`angle ${angle}° phase ${phase}° dt ${dt}: ${there.length ? `clock PASSES (${there[0].power.toFixed(0)})` : 'BLOCKED'}   pieces ${s.map((p) => `(${(p.x - X.x).toFixed(0)},${(X.y - p.y).toFixed(0)}) ${p.power.toFixed(0)}`).join('  ')}`);
    log(rows[rows.length - 1]);
  }
}
