// Track |ψ|² statistics of a Schrödinger scene step by step (instability hunting).
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
import type { Scene } from '../src/scenes';

export default async function (cfg: { scene: string; set?: Record<string, number>; checks: number[]; vortices?: boolean }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const base = R.BUILTIN_RULES[+sc.rule.split(':')[1]];
  const lab = await makeLab({ ...base, initial: sc.initial! }, sc.size ?? 256, { ...sc.globals, ...cfg.set }, 'initial');
  const S4 = lab.layout.S * 4;
  let t = 0;
  for (const c of cfg.checks) {
    if (c > t) { await lab.run(c - t); t = c; }
    const { state } = await lab.read();
    let mn = Infinity, mx = -Infinity, sum = 0, bad = 0, top = 0, topx2 = 0, bot = 0, botx2 = 0, mxs = 0;
    for (let i = 0; i < lab.N * lab.N; i++) { const p = state[i * S4], q = state[i * S4 + 1], I = p * p + q * q; if (!Number.isFinite(I)) { bad++; continue; } mn = Math.min(mn, I); mx = Math.max(mx, I); sum += I;
      const x = (i % lab.N) - lab.N / 2; mxs += I * x; if (i < lab.N * lab.N / 2) { top += I; topx2 += I * x * x; } else { bot += I; botx2 += I * x * x; } }
    // quantised vortices: phase winding round each plaquette (inside the box walls), and how clustered
    // they are: the share whose nearest vortex has the same sign (≈ 0.5 or less if mixed or paired)
    const N = lab.N, ph = (x: number, y: number) => { const j = (y * N + x) * S4; return Math.atan2(state[j + 1], state[j]); };
    const wrap = (d: number) => d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
    const vs: [number, number, number][] = [];
    for (let y = 16; y < N - 17; y++) for (let x = 16; x < N - 17; x++) {
      const a = ph(x, y), b = ph(x + 1, y), c = ph(x + 1, y + 1), d = ph(x, y + 1);
      const w = Math.round((wrap(b - a) + wrap(c - b) + wrap(d - c) + wrap(a - d)) / (2 * Math.PI));
      if (w) vs.push([x, y, w]);
    }
    let same = 0;
    for (const [x, y, w] of vs) { let best = Infinity, sw = 0; for (const [x2, y2, w2] of vs) { const r = Math.hypot(x2 - x, y2 - y); if (r > 0 && r < best) { best = r; sw = w2; } } if (sw === w) same++; }
    if (cfg.vortices) log(`t=${t}: at ${JSON.stringify(vs)}`);
    if (cfg.vortices) log(`t=${t}: vortices +${vs.filter((v) => v[2] > 0).length} −${vs.filter((v) => v[2] < 0).length}, same-sign nearest neighbour ${(same / Math.max(1, vs.length)).toFixed(2)}`);
    await saveFrame(`${cfg.scene}-${t}.png`, lab, { ri: 2, lo: 0, hi: 1.3, scale: 1, caption: `t=${t}` });
    log(`t=${t}: |ψ|² min ${mn.toFixed(3)} max ${mx.toFixed(3)} mean ${(sum / lab.N / lab.N).toFixed(4)} nonfinite ${bad}  mean x ${(mxs / sum).toFixed(1)}  top mass ${top.toFixed(1)} rms x ${Math.sqrt(topx2 / top).toFixed(1)}  bottom mass ${bot.toFixed(1)} rms x ${Math.sqrt(botx2 / bot).toFixed(1)}`);
  }
}
