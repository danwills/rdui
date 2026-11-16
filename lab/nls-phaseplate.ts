// A phase plate for phase-coded soliton bits: a strip of potential V, L cells wide, across a soliton's
// path (heading east at wavenumber k). Inside a well its phase turns faster (and it speeds up), so it
// comes out with its phase shifted and a little ahead. Compared with the same soliton crossing nothing:
// Δx, how far ahead it is (launch it that much further back to arrive in step), and Δφ, its phase
// shift once so launched (the centre phase difference: the field just translates). Δφ = π: a NOT.
//   node lab/run.mjs nls-phaseplate '{"V":-0.01,"L":60,"k":0.08}'
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp } from '../src/stamps';
import { makeLab, log } from './lab';

async function run(cfg: { V: number; L: number; k: number; edge?: number }, plate: boolean) {
  const N = 512, base = STARTER_STAMPS.find((s) => s.id === 'nls-soliton-0-still')!;
  const lab = await makeLab(R.SATURABLE_NLS, N, {});
  const S4 = lab.layout.S * 4;
  if (plate) {
    // soft edges: the depth ramps over `edge` cells each side, so the soliton isn't kicked
    const e = cfg.edge ?? 8;
    for (let i = 0; i < e; i++) {
      const v = (cfg.V * (i + 0.5)) / e;
      await lab.paint(200 + i, 0, 1, N, { V: v });
      await lab.paint(200 + e + cfg.L - 1 - i + e, 0, 1, N, { V: v });
    }
    await lab.paint(200 + e, 0, cfg.L, N, { V: cfg.V });
  }
  await lab.place(boostStamp(base, 0, cfg.k, 0, 's', 's'), 100, N / 2);
  const speed = (cfg.k * lab.globals.timestep) / lab.globals.dx ** 2;
  await lab.run(Math.round(300 / speed));
  const { state } = await lab.read();
  // the brightest cell near the middle row, and the power-weighted centre round it
  let best = 0, bx = 0, by = 0;
  for (let y = N / 2 - 30; y < N / 2 + 30; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * S4, v = state[i] ** 2 + state[i + 1] ** 2;
    if (v > best) [best, bx, by] = [v, x, y];
  }
  let p = 0, sx = 0;
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const i = ((((by + dy) % N) + N) % N * N + ((((bx + dx) % N) + N) % N)) * S4, w = state[i] ** 2 + state[i + 1] ** 2;
    p += w; sx += w * dx;
  }
  const xc = bx + sx / p;
  // phase at the centre: interpolate the plane wave from the nearest cell
  const i = (by * N + bx) * S4;
  const ph = Math.atan2(state[i + 1], state[i]) + cfg.k * (xc - bx) * lab.globals.dx;
  return { xc, ph, p };
}

export default async function (cfg: { V: number; L: number; k: number; edge?: number }) {
  const free = await run(cfg, false), plate = await run(cfg, true);
  let d = plate.ph - free.ph;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  log(`V ${cfg.V} L ${cfg.L} k ${cfg.k}: Δx ${(plate.xc - free.xc).toFixed(1)} cells, Δφ ${((d * 180) / Math.PI).toFixed(0)}°, power ${free.p.toFixed(0)} → ${plate.p.toFixed(0)}`);
}
