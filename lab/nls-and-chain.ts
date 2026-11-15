// Run a two-gate soliton chain, AND = NOT(NAND(A, B)), laid out by lab/plan-and-chain.py, for all four
// inputs: reports what reaches the output spot at the end, and the solitons left in the field.
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp } from '../src/stamps';
import { makeLab, log, saveFrame } from './lab';

interface Plan { A: number[]; B: number[]; C1: number[]; C2: number[]; h1: number; h2: number; out: number[]; Tend: number; T3: number }

export default async function (cfg: { plan: Plan; cases?: string[]; frames?: number[]; c2Phase?: number; extra?: number }) {
  const g = cfg.plan, N = 512, k = 0.08;
  const base = STARTER_STAMPS.find((s) => s.id === 'nls-soliton-0-still')!;
  for (const bits of cfg.cases ?? ['00', '01', '10', '11']) {
    const lab = await makeLab(R.SATURABLE_NLS, N);
    const S4 = lab.layout.S * 4;
    const put = (p: number[], deg: number, ph = 0) => { const r = (deg * Math.PI) / 180; return lab.place(boostStamp(base, ph, k * Math.cos(r), -k * Math.sin(r), 's', 's'), p[0], p[1]); };
    if (bits[0] === '1') await put(g.A, 15);
    if (bits[1] === '1') await put(g.B, -15);
    await put(g.C1, g.h1);
    await put(g.C2, g.h2, cfg.c2Phase ?? 0);
    const T = Math.round(g.Tend + (cfg.extra ?? 0));
    let t = 0;
    for (const f of [...(cfg.frames ?? []), T].sort((a, b) => a - b)) {
      await lab.run(f - t); t = f;
      if (f !== T || cfg.frames?.includes(T)) await saveFrame(`chain-${bits}-${f}.png`, lab, { ri: 2, lo: 0, hi: 6, scale: 1, caption: `A=${bits[0]} B=${bits[1]} t=${f}` });
    }
    const { state } = await lab.read();
    const I = (x: number, y: number) => { const j = ((((y | 0) + N) % N) * N + (((x | 0) + N) % N)) * S4; return state[j] ** 2 + state[j + 1] ** 2; };
    let box = 0;
    for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) if (x * x + y * y <= 196) box += I(g.out[0] + x, g.out[1] + y);
    // every soliton left: local maxima over 1
    const left: string[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = I(x, y);
      if (v < 1) continue;
      let m = true;
      for (let dy = -4; dy <= 4 && m; dy++) for (let dx = -4; dx <= 4; dx++) if ((dx || dy) && I(x + dx, y + dy) > v) { m = false; break; }
      if (m) { let p = 0; for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) if (dx * dx + dy * dy <= 144) p += I(x + dx, y + dy); left.push(`(${x},${y}) ${p.toFixed(0)}`); }
    }
    log(`A=${bits[0]} B=${bits[1]}: power at the output ${box.toFixed(0)} → ${box > 300 ? 1 : 0}   [t=${T}; left: ${left.join(' ')}]`);
  }
}
