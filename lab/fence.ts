// Natural containment: rings of still solitons (k = 0.065 medium). Check the
// ring holds by itself, then fire gliders outward from the centre in many
// directions: eaten, bouncing inside, escaped, or ring broken?
import { GS_HISTORY_WAVE } from '../src/rule';
import { rotateStampBy } from '../src/stamps';
import { makeLab, runAll, blobs, saveFrame, log, STARTERS, type Lab } from './lab';

type P = { x: number; y: number };

function ring(c: number, R: number, s: number, phase = 0): P[] {
  const n = Math.round((2 * Math.PI * R) / s);
  return Array.from({ length: n }, (_, i) => {
    const a = ((i + phase) / n) * 2 * Math.PI;
    return { x: c + R * Math.cos(a), y: c + R * Math.sin(a) };
  });
}

const DESIGNS: Record<string, (c: number) => P[]> = {
  'single s14': (c) => ring(c, 70, 14),
  'single s16': (c) => ring(c, 70, 16),
  'double s18': (c) => [...ring(c, 66, 18), ...ring(c, 80, 18 * (80 / 66), 0.5)],
  'double s22': (c) => [...ring(c, 64, 22), ...ring(c, 80, 22 * (80 / 64), 0.5)],
};

export default async function (cfg: { designs?: string[]; angles?: number[]; settle?: number; steps?: number; frames?: boolean }) {
  const N = 256, c = 128, g = { F: 0.054, k: 0.065 };
  const sol = STARTERS('starter-soliton-hw65'), gl = STARTERS('starter-glider-hw65');
  const names = cfg.designs ?? Object.keys(DESIGNS);
  const angles = cfg.angles ?? Array.from({ length: 24 }, (_, i) => i * 15);
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const pts = DESIGNS[name](c);
    // 1. does the ring hold on its own?
    const alone = await makeLab(GS_HISTORY_WAVE, N, g);
    for (const p of pts) alone.place(sol, p.x, p.y);
    await alone.run(cfg.settle ?? 30000);
    const ab = blobs((await alone.read()).state, N, alone.layout.S, 1, 0.2);
    const held = pts.filter((p) => ab.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < 5)).length;
    log(`${name}: ${pts.length} solitons; alone after ${cfg.settle ?? 30000} steps: ${ab.length} blobs, ${held} within 5 px of their spot`);
    await saveFrame(`${name.replace(' ', '_')}-alone.png`, alone, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `${name} alone` });
    alone.sim.destroy();
    // 2. gliders from the centre
    const runs: { a: number; lab: Lab }[] = [];
    for (const a of angles) {
      const l = await makeLab(GS_HISTORY_WAVE, N, g);
      for (const p of pts) l.place(sol, p.x, p.y);
      l.place(rotateStampBy(gl, a), c, c);
      runs.push({ a, lab: l });
    }
    const steps = cfg.steps ?? 16000;
    await runAll(runs.map((r) => r.lab), steps);
    const res: string[] = [];
    for (const r of runs) {
      const bs = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
      const intact = pts.filter((p) => bs.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < 6)).length;
      const extra = bs.filter((b) => !pts.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < 6));
      const outside = extra.filter((b) => Math.hypot(b.x - c, b.y - c) > 90).length;
      const inside = extra.filter((b) => Math.hypot(b.x - c, b.y - c) < 55).length;
      const verdict = outside ? 'ESCAPED' : intact < pts.length - 1 ? `damaged (${pts.length - intact} lost)` : inside ? 'inside' : extra.length ? 'in-ring' : 'eaten';
      res.push(`${r.a}°:${verdict}`);
      if (cfg.frames) await saveFrame(`${name.replace(' ', '_')}-a${r.a}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `${name} ${r.a}° ${verdict}` });
      r.lab.sim.destroy();
    }
    out[name] = res;
    log(`  ${res.join('  ')}`);
  }
  return out;
}
