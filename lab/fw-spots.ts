// Still spots in a fuseWorms medium: seed disks of worm chemistry, see which
// settle into one stable round blob; save the seed of each stable one.
import { loadBundled } from '../src/ready';
import { stampToJSON, type Stamp } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, type Lab } from './lab';

const CORE: Record<string, number> = { a: 0.407, b: 0.359, c: 0.363, d: 0.205, e: -0.002 };

export default async function (cfg: { g?: Record<string, number>; radii?: number[]; steps?: number }) {
  const N = 128, c = 64, g = cfg.g ?? { F: 0.048, k: 0.0639, wave_to_k: 0.004, wave_to_F: 0.018 };
  const rule = (await loadBundled('grayscott-historyWave_fuseWorms')).rule;
  const runs: { r: number; lab: Lab; st: Stamp; hist: string[] }[] = [];
  for (const r of cfg.radii ?? [2, 3, 4, 5, 6, 8]) {
    const l = await makeLab(rule, N, g), s = 2 * r + 12, x0 = c - s / 2;
    const { state } = await l.sim.readRegion(x0, x0, s, s);
    const R = l.layout.reagents, S4 = l.layout.S * 4;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (Math.hypot(i + 0.5 - s / 2, j + 0.5 - s / 2) <= r) R.forEach((n, k) => { if (n in CORE) state[(j * s + i) * S4 + k] = CORE[n]; });
    l.sim.writeRegion(x0, x0, s, s, undefined, state);
    runs.push({ r, lab: l, st: await capture(l, c, c, s, s, `fw-spot-r${r}`, `fuseWorms still spot seed r${r}`), hist: [] });
  }
  const steps = cfg.steps ?? 60000;
  for (let t = 0; t < 6; t++) {
    await runAll(runs.map((q) => q.lab), steps / 6);
    for (const q of runs) {
      const b = blobs((await q.lab.read()).state, N, q.lab.layout.S, 1, 0.2);
      q.hist.push(b.length ? `${b.length}:a${b[0].area}/e${b[0].elong.toFixed(1)}@${Math.hypot(b[0].x - c, b[0].y - c).toFixed(0)}` : '0');
    }
  }
  const saved = [];
  for (const q of runs) {
    log(`disk r${q.r}: ${q.hist.join('  ')}`);
    const last = q.hist.slice(-3);
    if (last.every((h) => h.startsWith('1:')) && new Set(last.map((h) => h.split('/')[0])).size <= 2) saved.push(stampToJSON(q.st));
    await saveFrame(`r${q.r}.png`, q.lab, { ri: 1, lo: 0, hi: 0.5, ti: 3, tlo: 0, thi: 0.35, scale: 2, caption: `disk r${q.r}` });
    q.lab.sim.destroy();
  }
  await window.__saveText('spots.json', JSON.stringify(saved));
  return saved.map((s) => s.id);
}
