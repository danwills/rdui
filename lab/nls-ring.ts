// Soliton on a ring waveguide in the saturable NLS: V = −V0 in a smooth annulus
// (radius R, half-width w, cells) around the centre; a soliton starts on the
// ring heading tangentially with wavenumber k. Logs its radius and the angle
// it has covered (laps) over time, per setting.
import { SATURABLE_NLS, type RuleDef, type Overlay } from '../src/rule';
import { makeLab, runAll, blobs, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { sets: { V0: number; k: number; R?: number; w?: number; edge?: number }[]; N?: number; steps?: number; every?: number; frames?: boolean }) {
  const N = cfg.N ?? 256, c = N / 2;
  const runs: { lab: Lab; set: (typeof cfg.sets)[number]; hist: string[]; turned: number; prev?: number; rmin: number; rmax: number }[] = [];
  for (const set of cfg.sets) {
    const R = set.R ?? 70, w = set.w ?? 8, e = set.edge ?? 2;
    const ring: Overlay[] = [
      { chem: 'V', op: 'add', fill: { type: 'bump', value: -set.V0, edge: e }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: (R + w) / N } },
      { chem: 'V', op: 'add', fill: { type: 'bump', value: set.V0, edge: e }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: (R - w) / N } },
    ];
    // start at the ring's east point heading south (clockwise on screen)
    const sol: Overlay[] = (['cos', 'sin'] as const).map((part, i) => ({
      chem: i ? 'q' : 'p', op: 'add', fill: { type: 'packet', amp: 2.2, sigma: 7, ky: set.k, part }, shape: { type: 'circle', cx: (c + R) / N, cy: 0.5, r: 0.1 },
    }));
    const rule: RuleDef = { ...SATURABLE_NLS, initial: [...ring, ...sol] };
    runs.push({ lab: await makeLab(rule, N, {}, 'initial'), set, hist: [], turned: 0, rmin: Infinity, rmax: 0 });
  }
  let f = 0;
  for (let t = cfg.every ?? 500; t <= (cfg.steps ?? 20000); t += cfg.every ?? 500) {
    await runAll(runs.map((r) => r.lab), cfg.every ?? 500);
    for (const [i, r] of runs.entries()) {
      const st = (await r.lab.read()).state;
      const b = blobs(st, N, r.lab.layout.S, 2, 1).sort((x, y) => y.area - x.area)[0];
      if (!b) { r.hist.push(`${t / 1000}k:gone`); continue; }
      const a = (Math.atan2(b.y - c, b.x - c) * 180) / Math.PI, rad = Math.hypot(b.x - c, b.y - c);
      if (r.prev !== undefined) r.turned += ((a - r.prev + 540) % 360) - 180;
      r.prev = a; r.rmin = Math.min(r.rmin, rad); r.rmax = Math.max(r.rmax, rad);
      if (t % ((cfg.every ?? 500) * 4) === 0) r.hist.push(`${t / 1000}k:r${rad.toFixed(0)} ${(r.turned / 360).toFixed(2)}laps`);
      if (cfg.frames && i === 0) await saveFrame(`f${String(f).padStart(4, '0')}.png`, r.lab, { ri: 2, lo: 0, hi: 5, scale: 1, caption: `V0=${r.set.V0} k=${r.set.k} t=${t}` });
    }
    f++;
  }
  for (const r of runs) log(`V0 ${r.set.V0} k ${r.set.k} R ${r.set.R ?? 70}: radius ${r.rmin.toFixed(0)}–${r.rmax.toFixed(0)}  ${r.hist.join(' ')}`);
}
