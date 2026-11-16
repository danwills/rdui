// Three equal Schrödinger solitons meeting at the field's centre: A from above heading `spread`°
// down, C (the constant) straight along the middle, B from below heading `spread`° up; each with
// phase 0 or π (`bits` "abc", 1 = π). Does the pair that agrees merge into a heavy soliton carrying
// their phase while the odd one is pushed away (a majority gate, as the parametron's)? Reports each
// outgoing soliton: heading, power, and phase at its centre. Flipping every bit flips every phase
// and changes nothing else (the equation is symmetric under ψ → −ψ), so cases 000, 100, 010, 001
// are enough: what matters is that the heavy output leaves the same way with the same phase in all four.
//   node lab/run.mjs nls-majority '{"bits":"001","spread":10,"k":0.04}'
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp } from '../src/stamps';
import { makeLab, log } from './lab';

interface Spot { x: number; y: number; power: number; cx: number; cy: number }

function spots(state: Float32Array, N: number, S4: number, thr = 1, r = 14): Spot[] {
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
    if (!out.some((o) => Math.hypot(o.cx - x, o.cy - y) < r)) out.push({ x: x + sx / p, y: y + sy / p, power: p, cx: x, cy: y });
  }
  return out;
}

export default async function (cfg: { bits: string; spread: number; k: number; N?: number; d?: number; after?: number; g?: number }) {
  const N = cfg.N ?? 512, d = cfg.d ?? 110, base = STARTER_STAMPS.find((s) => s.id === 'nls-soliton-0-still')!;
  const lab = await makeLab(R.SATURABLE_NLS, N, cfg.g ? { g: cfg.g } : {});
  const S4 = lab.layout.S * 4, c = N / 2, h = (cfg.spread * Math.PI) / 180;
  const speed = (cfg.k * lab.globals.timestep) / lab.globals.dx ** 2;
  const ph = (i: number) => (cfg.bits[i] === '1' ? Math.PI : 0);
  // A above (screen y up = smaller y) heading down-right; B below heading up-right; C straight on
  await lab.place(boostStamp(base, ph(0), cfg.k * Math.cos(h), cfg.k * Math.sin(h), 'a', 'a'), c - d * Math.cos(h), c - d * Math.sin(h));
  await lab.place(boostStamp(base, ph(1), cfg.k * Math.cos(h), -cfg.k * Math.sin(h), 'b', 'b'), c - d * Math.cos(h), c + d * Math.sin(h));
  await lab.place(boostStamp(base, ph(2), cfg.k, 0, 'c', 'c'), c - d, c);
  const meet = Math.round(d / speed), after = cfg.after ?? Math.round(90 / speed);
  await lab.run(meet + after - 1000);
  const s1 = spots((await lab.read()).state, N, S4);
  await lab.run(1000);
  const { state } = await lab.read();
  const s2 = spots(state, N, S4).sort((p, q) => q.power - p.power);
  const desc = s2.map((b) => {
    const o = s1.reduce((m, a) => (Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(m.x - b.x, m.y - b.y) ? a : m), s1[0]);
    const vx = (b.x - o.x) / 1000, vy = (b.y - o.y) / 1000;
    const i = (b.cy * N + b.cx) * S4, phase = (Math.atan2(state[i + 1], state[i]) * 180) / Math.PI;
    return `heading ${((Math.atan2(-vy, vx) * 180) / Math.PI).toFixed(1)}° power ${b.power.toFixed(0)} phase ${phase.toFixed(0)}°`;
  });
  log(`bits ${cfg.bits} spread ±${cfg.spread}° k ${cfg.k}${cfg.g ? ` g ${cfg.g}` : ''}: ${desc.join(' | ') || 'nothing left'}`);
}
