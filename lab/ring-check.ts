// Run a ring track scene and follow its solitons: their distance from the centre, power, and the
// angle each has gone round (laps), to check they stay on the track.
import * as R from '../src/rule';
import type { Scene } from '../src/scenes';
import { makeLab, log } from './lab';

export default async function (cfg: { scene: string; steps: number; every: number }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const N = sc.size!;
  const lab = await makeLab({ ...R.SATURABLE_NLS, initial: sc.initial! }, N, sc.globals ?? {}, 'initial');
  const S4 = lab.layout.S * 4, c = N / 2;
  const turned = [0, 0], last: number[] = [];
  for (let t = 0; t <= cfg.steps; t += cfg.every) {
    if (t) await lab.run(cfg.every);
    const { state } = await lab.read();
    // the two brightest well-separated peaks
    const I = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) I[i] = state[i * S4] ** 2 + state[i * S4 + 1] ** 2;
    const order = Array.from(I.keys()).sort((a, b) => I[b] - I[a]);
    const peaks: number[] = [];
    for (const i of order) { if (peaks.length === 2) break; if (peaks.every((j) => Math.hypot((i % N) - (j % N), ((i / N) | 0) - ((j / N) | 0)) > 20)) peaks.push(i); }
    // keep each soliton's label: order the peaks by nearness to the first one's last angle
    const angOf = (i: number) => Math.atan2(((i / N) | 0) + 0.5 - c, (i % N) + 0.5 - c);
    const off = (i: number) => Math.abs(Math.atan2(Math.sin(angOf(i) - (last[0] ?? 0)), Math.cos(angOf(i) - (last[0] ?? 0))));
    peaks.sort((a, b) => off(a) - off(b));
    const desc = peaks.map((i, k) => {
      const x = (i % N) + 0.5 - c, y = ((i / N) | 0) + 0.5 - c, ang = Math.atan2(y, x);
      if (last[k] !== undefined) { let d = ang - last[k]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); turned[k] += d; }
      last[k] = ang;
      let p = 0;
      for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) if (dx * dx + dy * dy <= 196) p += I[((((i / N) | 0) + dy + N) % N) * N + (((i % N) + dx + N) % N)];
      return `r ${Math.hypot(x, y).toFixed(1)} power ${p.toFixed(0)} peak ${I[i].toFixed(1)}`;
    });
    if (t % (cfg.every * 10) === 0) log(`t=${t}: ${desc.join(' | ')}  laps ${turned.map((v) => (v / (2 * Math.PI)).toFixed(2)).join(', ')}`);
  }
}
