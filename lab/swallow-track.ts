// Where the pieces of a swallow go: the NAND gate's A=1 B=1 case (A and B merge, the merged soliton swallows the
// slow clock at P2), laid out as in scenes/schrodinger-nand.json, in an open field. Tracks every soliton over
// `min` power after the swallow and reports each piece's power, speed and heading (anticlockwise from east, y up),
// relative to P2, for the given g, clock timing and phase.
//   node lab/run.mjs swallow-track '{"g":1.005,"cLate":-300}'
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

export default async function (cfg: { g?: number; cLate?: number; cPhase?: number; cHead?: number; cK?: number; every?: number; span?: number; min?: number }) {
  const N = 512, h = (15 * Math.PI) / 180, k = 0.08, d = 66, L = 130;
  const cHead = ((cfg.cHead ?? 120) * Math.PI) / 180, cK = cfg.cK ?? 0.04;
  const lab = await makeLab(R.SATURABLE_NLS, N, cfg.g ? { g: cfg.g } : {});
  const base = STARTER_STAMPS.find((s) => s.id === 'nls-soliton-0-still')!;
  const S4 = lab.layout.S * 4, per = lab.globals.timestep / lab.globals.dx ** 2;
  const v = k * per, vc = cK * per;
  const P1 = { x: 150, y: 256 }, P2 = { x: P1.x + L, y: P1.y };
  const tMeet = d / v + L / (0.96 * v) + (cfg.cLate ?? -300);
  const D = vc * tMeet;
  const put = (x: number, y: number, head: number, kk: number, ph: number) => lab.place(boostStamp(base, ph, kk * Math.cos(head), -kk * Math.sin(head), 's', 's'), x, y);
  await put(P1.x - d * Math.cos(h), P1.y + d * Math.sin(h), h, k, 0);
  await put(P1.x - d * Math.cos(h), P1.y - d * Math.sin(h), -h, k, 0);
  await put(P2.x - D * Math.cos(cHead), P2.y + D * Math.sin(cHead), cHead, cK, cfg.cPhase ?? 0);
  const every = cfg.every ?? 2000, span = cfg.span ?? 10000, min = cfg.min ?? 100;
  let t = Math.round(tMeet + 1500); // just after the swallow
  await lab.run(t);
  const snap = async () => (spots((await lab.read()).state, N, S4)).filter((s) => s.power > min).map((s) => ({ ...s, x: s.x - P2.x, y: P2.y - s.y }));
  const first = await snap();
  let prev = first;
  const lines: string[] = [];
  for (let dt = every; dt <= span; dt += every) {
    await lab.run(every);
    const cur = await snap();
    lines.push(`+${dt}: ` + cur.map((c) => `(${c.x.toFixed(0)},${c.y.toFixed(0)}) ${c.power.toFixed(0)}`).join('  '));
    prev = cur;
  }
  // per piece: from where it was just after the swallow to where it is at the end (nearest-power match)
  const fin = prev.map((c) => {
    const s = first.reduce((a, b) => (Math.abs(b.power - c.power) < Math.abs(a.power - c.power) ? b : a), first[0]);
    const dx = c.x - s.x, dy = c.y - s.y;
    return `piece ${c.power.toFixed(0)} at (${c.x.toFixed(0)},${c.y.toFixed(0)}) from P2: ${(Math.hypot(dx, dy) / span).toFixed(4)} cells/step heading ${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(0)}°`;
  });
  log(`g ${cfg.g ?? 1}, clock ${cfg.cLate ?? -300} steps late, phase ${cfg.cPhase ?? 0}: just after swallow ${first.map((c) => `(${c.x.toFixed(0)},${c.y.toFixed(0)}) ${c.power.toFixed(0)}`).join('  ')}\n  ${lines.join('\n  ')}\n  => ${fin.join(' | ')}`);
}
