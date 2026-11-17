// Bubble hunt: a collection preset (fam, md5) started empty, a few seeds put down, frames saved as
// they grow. seeds 'disks': disks of seed values (the rule's seed, else a=0.5 b=0.25); 'vortex': a
// phase winding in (a, b) round each point (for Ginzburg-Landau, whose cells grow round spiral cores).
// Is each seed one bubble with a membrane, does it keep a size, do neighbours touch without merging?
//   node lab/run.mjs bubble-try '{"fam":"f011","md5":"e2af...","seeds":"vortex","ri":2,"lo":0.15,"hi":0.38}'
import { importReady } from '../src/ready';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { fam: string; md5: string; N?: number; seeds: 'disks' | 'vortex'; at: number[]; ri: number; lo: number; hi: number; r?: number; tag: string; set?: Record<string, number>; start?: 'rest' | 'initial' }) {
  const f = await (await fetch(`/vti/families/${cfg.fam}.json`)).json();
  const p = f.presets.find((q: { md5: string }) => q.md5 === cfg.md5);
  const imp = await importReady(f.header, `${p.name}.vti`);
  const N = cfg.N ?? 256;
  const lab = await makeLab(imp.rule, N, { ...p.params, ...cfg.set }, cfg.start ?? 'rest');
  const S4 = lab.layout.S * 4, r = cfg.r ?? 10;
  const pts = [[0.3, 0.35], [0.62, 0.3], [0.45, 0.68], [0.75, 0.72]].map(([x, y]) => [x * N, y * N]);
  const { state } = await lab.read();
  const seed = imp.rule.seed ?? [];
  for (const [cx, cy] of pts) for (let y = -2 * r; y <= 2 * r; y++) for (let x = -2 * r; x <= 2 * r; x++) {
    const d = Math.hypot(x, y), i = ((((cy + y) | 0) * N) + ((cx + x) | 0)) * S4;
    if (cfg.seeds === 'disks') {
      if (d > r) continue;
      state[i] = seed[0] ?? 0.5; state[i + 1] = seed[1] ?? 0.25;
    } else {
      // amplitude rising from 0 at the core, phase winding once
      const amp = Math.tanh(d / 4) * Math.exp(-((d / (2 * r)) ** 4)), th = Math.atan2(y, x);
      state[i] += amp * Math.cos(th) * 0.5; state[i + 1] += amp * Math.sin(th) * 0.5;
    }
  }
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    await saveFrame(`${cfg.tag}-${String(T).padStart(6, '0')}.png`, lab, { ri: cfg.ri, lo: cfg.lo, hi: cfg.hi, scale: 1, caption: `${cfg.tag} t=${T}` });
  }
  log(`${cfg.tag}: ${imp.rule.reagents.join(',')} done`);
}
