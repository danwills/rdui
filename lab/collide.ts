// Glider collision catalog: head-on and right-angle crossings at a range of
// offsets; report what comes out (count, headings, speeds) and save a frame.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, absorber, blobs, saveFrame, log, STARTERS, type Lab, type Blob } from './lab';

const G = () => STARTERS('starter-glider-hw-axis');
const heading = (a: Blob, b: Blob) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

export default async function (cfg: { kind?: 'headon' | 'cross' | 'chase'; offsets?: number[]; steps?: number }) {
  const N = 256, c = 128, kind = cfg.kind ?? 'headon', steps = cfg.steps ?? 12000;
  const offsets = cfg.offsets ?? [0, 2, 4, 6, 8, 10, 12, 16];
  const labs: { off: number; lab: Lab }[] = [];
  for (const off of offsets) {
    const lab = await makeLab(GS_HISTORY_WAVE, N);
    await absorber(lab, 8, { k: 0.072 });
    await lab.place(G(), c - 70, c);
    if (kind === 'headon') await lab.place(G(), c + 70, c + off, { rot: 2 });
    else if (kind === 'cross') await lab.place(G(), c + off, c - 70, { rot: 1 });
    else await lab.place(G(), c - 20, c + off); // chase: same direction, ahead (meets only if speeds differ)
    labs.push({ off, lab });
  }
  const out: Record<string, unknown> = {};
  await runAll(labs.map((l) => l.lab), steps - 800);
  const before = await Promise.all(labs.map(async (l) => blobs((await l.lab.read()).state, N, l.lab.layout.S, 1, 0.2)));
  await runAll(labs.map((l) => l.lab), 800);
  for (const [i, { off, lab }] of labs.entries()) {
    const after = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
    const desc = after.map((b) => {
      const p = before[i].reduce((m, q) => (Math.hypot(q.x - b.x, q.y - b.y) < Math.hypot(m.x - b.x, m.y - b.y) ? q : m), before[i][0] ?? b);
      const v = (Math.hypot(b.x - p.x, b.y - p.y) / 800) * 1000;
      return { x: Math.round(b.x), y: Math.round(b.y), area: b.area, speed: +v.toFixed(1), heading: v > 2 ? Math.round(heading(p, b)) : null };
    });
    out[off] = desc;
    log(`${kind} offset ${String(off).padStart(3)}: ${after.length} blob(s) ` + desc.map((d) => `[${d.x},${d.y} a${d.area} ${d.heading === null ? 'still' : `${d.speed}px/k → ${d.heading}°`}]`).join(' '));
    await saveFrame(`${kind}-${off}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `${kind} ${off}` });
  }
  return out;
}
