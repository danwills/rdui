// Gray-Scott (zoom) check: exact spectral diffusion at several zooms beside the
// stencil Gray-Scott, same F/k, seeds scaled with the zoom. Zoom 1 should look
// like the stencil rule; larger zooms the same kind of pattern, scaled up.
import { GRAY_SCOTT, GRAY_SCOTT_ZOOM } from '../src/rule';
import { makeLab, runAll, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { N?: number; F?: number; k?: number; zooms?: number[]; steps?: number; every?: number; hsv?: boolean }) {
  const N = cfg.N ?? 256, F = cfg.F ?? 0.0367, k = cfg.k ?? 0.0649;
  const runs: { lab: Lab; name: string; z: number }[] = [
    { lab: await makeLab(GRAY_SCOTT, N, { F, k }), name: 'stencil', z: 1 },
    ...await Promise.all((cfg.zooms ?? [1, 2, 3, 5]).map(async (z) => ({ lab: await makeLab(GRAY_SCOTT_ZOOM, N, { F, k, zoom: z }), name: `zoom ${z}`, z }))),
  ];
  for (const r of runs) {
    const { state } = await r.lab.read(), S4 = r.lab.layout.S * 4, c = N / 2, R = 6 * r.z;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 > R * R) continue;
      state[(y * N + x) * S4] = 0.5;
      state[(y * N + x) * S4 + 1] = 0.25 + 0.05 * Math.sin(x * 1.3 + y * 0.7);
    }
    r.lab.sim.writeRegion(0, 0, N, N, undefined, state);
  }
  let f = 0;
  for (let t = 0; t <= (cfg.steps ?? 20000); t += cfg.every ?? 2000) {
    if (t) await runAll(runs.map((r) => r.lab), cfg.every ?? 2000);
    for (const r of runs) {
      const { state } = await r.lab.read();
      let mx = 0, bad = 0;
      for (let i = 1; i < state.length; i += r.lab.layout.S * 4) { if (!Number.isFinite(state[i])) bad++; else mx = Math.max(mx, state[i]); }
      if (t === (cfg.steps ?? 20000)) log(`${r.name}: max b ${mx.toFixed(3)}${bad ? ` NaN ${bad}` : ''}`);
      await saveFrame(`${r.name.replace(' ', '')}-f${String(f).padStart(4, '0')}.png`, r.lab, cfg.hsv ? { ri: 0, lo: 0.2, hi: 1, ti: 1, tlo: 0, thi: 0.4, hsv: true, scale: 1, caption: `${r.name} t=${t} (HSV: a hue, b sat)` } : { ri: 1, lo: 0, hi: 0.4, scale: 1, caption: `${r.name} t=${t}` });
    }
    f++;
  }
  for (const r of runs) r.lab.sim.destroy();
}
