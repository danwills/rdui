// Saturable NLS checks: power conservation, free-packet spreading and group
// velocity against the analytic results (g = 0), and soliton stability (g > 0).
import { SATURABLE_NLS, type RuleDef } from '../src/rule';
import { makeLab, log } from './lab';

export default async function (cfg: { N?: number; cases?: { g: number; s?: number; amp: number; sigma: number; kx?: number; dt?: number }[]; steps?: number; every?: number }) {
  const N = cfg.N ?? 256;
  for (const c of cfg.cases ?? [{ g: 0, amp: 1, sigma: 8, kx: 0.3 }, { g: 1, amp: 2, sigma: 6 }, { g: 1, amp: 2, sigma: 6, dt: 0.2 }, { g: 1, amp: 2, sigma: 6, kx: 0.3 }]) {
    const rule: RuleDef = { ...SATURABLE_NLS, initial: [
      { chem: 'p', op: 'add', fill: { type: 'packet', amp: c.amp, sigma: c.sigma, kx: c.kx ?? 0 }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 0.2 } },
      { chem: 'q', op: 'add', fill: { type: 'packet', amp: c.amp, sigma: c.sigma, kx: c.kx ?? 0, part: 'sin' }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 0.2 } },
    ] };
    const dt = c.dt ?? 0.05, dx = 0.25;
    const lab = await makeLab(rule, N, { g: c.g, s: c.s ?? 0.5, timestep: dt }, 'initial');
    const out: string[] = [];
    let p0 = 0;
    for (let t = 0; t <= (cfg.steps ?? 400); t += cfg.every ?? 100) {
      if (t) await lab.run(cfg.every ?? 100);
      const st = (await lab.read()).state, S4 = lab.layout.S * 4;
      let pow = 0, peak = 0, sx = 0;
      for (let i = 0; i < N * N; i++) { const I = st[i * S4] ** 2 + st[i * S4 + 1] ** 2; pow += I; peak = Math.max(peak, I); sx += I * (i % N); }
      if (!t) p0 = pow;
      let line = `t=${(t * dt).toFixed(1)}: power ${(pow / p0).toFixed(6)} peak ${peak.toFixed(3)} x ${(sx / pow).toFixed(2)}`;
      if (c.g === 0) {
        // free 2D Gaussian (unit-mass Schrödinger, ħ=1): |ψ|² peak ∝ 1/(1 + (τ/σ²)²); centre moves at k
        const sig = c.sigma * dx, tau = t * dt, k = (c.kx ?? 0) / dx;
        line += `  [analytic peak ${(c.amp ** 2 / (1 + (tau / sig ** 2) ** 2)).toFixed(3)}, x ${(N / 2 + (k * tau) / dx).toFixed(2)}]`;
      }
      out.push(line);
    }
    log(`g=${c.g} amp=${c.amp} σ=${c.sigma} kx=${c.kx ?? 0} dt=${dt}:\n  ` + out.join('\n  '));
    lab.sim.destroy();
  }
}
