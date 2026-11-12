// Record the glider building blocks side by side: head-on annihilation,
// head-on scatter, right-angle merge, and a bounce off a painted k band.
import { GS_HISTORY_WAVE } from '../src/rule';
import { rotateStampBy } from '../src/stamps';
import { makeLab, runAll, absorber, saveFrame, STARTERS, type Lab } from './lab';

export default async function (cfg: { steps?: number; every?: number }) {
  const N = 256, c = 128, G = () => STARTERS('starter-glider-hw-axis');
  const make = async () => { const l = await makeLab(GS_HISTORY_WAVE, N); await absorber(l, 6, { k: 0.072 }); return l; };
  const scenes: { name: string; lab: Lab; band?: boolean }[] = [];
  let l = await make(); l.place(G(), c - 70, c); l.place(G(), c + 70, c, { rot: 2 }); scenes.push({ name: 'head-on: annihilate', lab: l });
  l = await make(); l.place(G(), c - 70, c); l.place(G(), c + 70, c + 10, { rot: 2 }); scenes.push({ name: 'head-on, offset 10: scatter', lab: l });
  l = await make(); l.place(G(), c - 70, c); l.place(G(), c, c - 70, { rot: 1 }); scenes.push({ name: 'right angle: merge → 45°', lab: l });
  l = await make(); await l.paint(0, 170, N, 6, { k: 0.072 });
  l.place(rotateStampBy(G(), 35), 128 - 100 * Math.cos(0.61), 170 - 100 * Math.sin(0.61)); scenes.push({ name: 'painted k band: mirror', lab: l, band: true });
  const steps = cfg.steps ?? 9000, every = cfg.every ?? 150;
  for (let t = 0, f = 0; t <= steps; t += every, f++) {
    if (t) await runAll(scenes.map((s) => s.lab), every);
    for (const [i, s] of scenes.entries())
      await saveFrame(`s${i}-f${String(f).padStart(4, '0')}.png`, s.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: s.name, boxes: s.band ? [{ x: 0, y: 170, w: N, h: 6, color: '#cc5566' }] : [] });
  }
}
