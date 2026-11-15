// Two equal Schrödinger solitons whose straight paths cross at `angle` degrees (meeting at the
// field's centre), with relative phase `phase` (radians); or one alone (`solo`). Reports each
// soliton afterwards: where it is, its heading and speed, and its power. Billiard-ball logic
// (lab notes for the NAND scene) needs a clean, repeatable deflection with power and speed kept.
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp } from '../src/stamps';
import { makeLab, log } from './lab';

interface Spot { x: number; y: number; power: number }

/** Solitons: local maxima of |ψ|² above thr, with the power within r of each. */
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
    if (!out.some((o) => Math.hypot(o.x - x, o.y - y) < r)) out.push({ x: x + sx / p, y: y + sy / p, power: p });
  }
  return out;
}

// `late`: B starts that many steps further back along its path (arrives late); `g`: the rule's nonlinearity
export default async function (cfg: { angle: number; k: number; phase?: number; solo?: boolean; N?: number; d?: number; after?: number; rot?: number; late?: number; g?: number }) {
  const N = cfg.N ?? 512, d = cfg.d ?? 110, base = STARTER_STAMPS.find((s) => s.id === 'nls-soliton-0-still')!;
  const lab = await makeLab(R.SATURABLE_NLS, N, cfg.g ? { g: cfg.g } : {});
  const S4 = lab.layout.S * 4, c = N / 2, h = (cfg.angle / 2) * (Math.PI / 180);
  const speed = (cfg.k * lab.globals.timestep) / lab.globals.dx ** 2; // cells per step
  // A comes in from the lower left heading up-right, B from the upper left heading down-right
  // the whole set-up turned `rot` degrees anticlockwise (the merged soliton then heads that way)
  const r = ((cfg.rot ?? 0) * Math.PI) / 180;
  const turn = (dx: number, dy: number) => [dx * Math.cos(r) + dy * Math.sin(r), -dx * Math.sin(r) + dy * Math.cos(r)];
  const mk = (dx: number, dy: number, kx: number, ky: number) => { const [x, y] = turn(dx, dy), [tx, ty] = turn(kx, ky); return { x: c + x, y: c + y, kx: tx, ky: ty }; };
  const A = mk(-d * Math.cos(h), d * Math.sin(h), cfg.k * Math.cos(h), -cfg.k * Math.sin(h));
  const dB = d + speed * (cfg.late ?? 0);
  const B = mk(-dB * Math.cos(h), -dB * Math.sin(h), cfg.k * Math.cos(h), cfg.k * Math.sin(h));
  await lab.place(boostStamp(base, 0, A.kx, A.ky, 'a', 'a'), A.x, A.y);
  if (!cfg.solo) await lab.place(boostStamp(base, cfg.phase ?? Math.PI, B.kx, B.ky, 'b', 'b'), B.x, B.y);
  const meet = Math.round(d / speed), after = cfg.after ?? Math.round(80 / speed);
  await lab.run(meet + after - 1000);
  const s1 = spots((await lab.read()).state, N, S4);
  await lab.run(1000);
  const s2 = spots((await lab.read()).state, N, S4);
  const desc = s2.map((b) => {
    const o = s1.reduce((m, a) => (Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(m.x - b.x, m.y - b.y) ? a : m), s1[0]);
    const vx = (b.x - o.x) / 1000, vy = (b.y - o.y) / 1000;
    // heading: degrees anticlockwise from east (screen y points down)
    return `at (${(b.x - c).toFixed(0)},${(c - b.y).toFixed(0)}) heading ${((Math.atan2(-vy, vx) * 180) / Math.PI).toFixed(1)}° speed ${(Math.hypot(vx, vy) / speed).toFixed(2)}× power ${b.power.toFixed(0)}`;
  });
  log(`${cfg.g ? `g ${cfg.g}: ` : ''}${cfg.late ? `B ${cfg.late} steps late: ` : ''}${cfg.rot ? `turned ${cfg.rot}°: ` : ''}angle ${cfg.angle}° k ${cfg.k} ${cfg.solo ? 'solo' : `phase ${((cfg.phase ?? Math.PI) / Math.PI).toFixed(2)}π`}: in at ±${(cfg.angle / 2).toFixed(1)}° (A heading ${(cfg.angle / 2).toFixed(1)}°, B ${(-cfg.angle / 2).toFixed(1)}°), ${meet} steps to meet; after ${meet + after}: ${desc.join(' | ') || 'nothing left'}`);
}
