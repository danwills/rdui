// Build U-skate-like hole structures in U-skate world (excited background,
// holes = the trivial state a 1, b 0): a U-shaped hole arc cupping negatons,
// after Munafo's gallery. Several geometries × k side by side; frames, plus
// each hole cluster's centroid over time to see what moves.
import { GRAY_SCOTT } from '../src/rule';
import { stampToJSON } from '../src/stamps';
import { makeLab, runAll, saveFrame, blobs, capture, log, type Lab } from './lab';

/** Geometry in units of the negaton spacing s: dots (hole discs) and arcs (hole strokes). */
interface Geo { name: string; dots: [number, number][]; arc?: { r: number; from: number; to: number }; line?: [number, number, number, number][] }

const GEOS: Geo[] = [
  // the small U-skate: a half-ring opening right with a dot in its mouth
  { name: 'U1', arc: { r: 1, from: 90, to: 270 }, dots: [[0, 0]] },
  { name: 'U2', arc: { r: 1, from: 90, to: 270 }, dots: [[0.2, 0], [1.1, -0.6], [1.1, 0.6]] },
  { name: 'U0', arc: { r: 1, from: 90, to: 270 }, dots: [] },
  // long U: a hairpin with a row of dots inside (gallery row 2)
  { name: 'long', arc: { r: 1, from: 90, to: 270 }, line: [[0, -1, 2, -1], [0, 1, 2, 1]], dots: [[0, 0], [1, 0], [2, 0], [2.9, -0.9], [2.9, 0.9]] },
];

export default async function (cfg: { ks?: number[]; s?: number; N?: number; steps?: number; every?: number; geos?: string[]; D?: number; hole?: number; width?: number; capture?: string }) {
  const N = cfg.N ?? 128, s = cfg.s ?? 9, F = 0.062, holeR = cfg.hole ?? 2.5, width = cfg.width ?? 2.5;
  const ks = cfg.ks ?? [0.0606, 0.0607, 0.0608, 0.0609];
  const geos = GEOS.filter((g) => !cfg.geos || cfg.geos.includes(g.name));
  const runs: { lab: Lab; k: number; geo: Geo; path: string[] }[] = [];
  for (const geo of geos) for (const k of ks) {
    const lab = await makeLab(GRAY_SCOTT, N, { F, k, D: cfg.D ?? 1 });
    const Fk = F + k, bHi = (1 + Math.sqrt(Math.max(0, 1 - (4 * Fk * Fk) / F))) / ((2 * Fk) / F), aHi = Fk / bHi;
    const { state } = await lab.read(), c = N / 2;
    const hole = (x: number, y: number) => {
      const px = c + x * s, py = c + y * s, r2 = holeR * holeR;
      return (X: number, Y: number) => (X - px) ** 2 + (Y - py) ** 2 < r2;
    };
    const tests: ((X: number, Y: number) => boolean)[] = geo.dots.map(([x, y]) => hole(x, y));
    if (geo.arc) {
      const { r, from, to } = geo.arc;
      tests.push((X, Y) => {
        const dx = X - c, dy = Y - c, d = Math.hypot(dx, dy), a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        return Math.abs(d - r * s) < width && a >= from && a <= to;
      });
    }
    for (const [x0, y0, x1, y1] of geo.line ?? []) tests.push((X, Y) => {
      const ax = c + x0 * s, ay = c + y0 * s, bx = c + x1 * s, by = c + y1 * s;
      const t = Math.max(0, Math.min(1, ((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      return Math.hypot(X - ax - t * (bx - ax), Y - ay - t * (by - ay)) < width;
    });
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const inside = tests.some((f) => f(x + 0.5, y + 0.5));
      state[(y * N + x) * 4] = inside ? 1 : aHi;
      state[(y * N + x) * 4 + 1] = inside ? 0 : bHi;
    }
    lab.sim.writeRegion(0, 0, N, N, undefined, state);
    runs.push({ lab, k, geo, path: [] });
  }
  // holes as blobs of 0.4 − b; one centroid for all of them (the cluster)
  const where = async (lab: Lab) => {
    const st = (await lab.read()).state.slice();
    for (let i = 1; i < st.length; i += 4) st[i] = 0.4 - st[i];
    const bl = blobs(st, N, 1, 1, 0.25);
    if (!bl.length) return { n: 0, x: NaN, y: NaN, area: 0 };
    const area = bl.reduce((a, b) => a + b.area, 0);
    // circular mean so wrapping clusters stay together
    const ang = (v: number) => (2 * Math.PI * v) / N;
    const m = (f: (b: (typeof bl)[number]) => number) => {
      const sx = bl.reduce((a, b) => a + b.area * Math.cos(ang(f(b))), 0), sy = bl.reduce((a, b) => a + b.area * Math.sin(ang(f(b))), 0);
      return (((Math.atan2(sy, sx) / (2 * Math.PI)) * N) + N) % N;
    };
    return { n: bl.length, x: m((b) => b.x), y: m((b) => b.y), area };
  };
  let f = 0;
  for (let t = 0; t <= (cfg.steps ?? 40000); t += cfg.every ?? 4000) {
    if (t) await runAll(runs.map((r) => r.lab), cfg.every ?? 4000);
    for (const r of runs) {
      const w = await where(r.lab);
      r.path.push(`${t / 1000}k:${w.n}h/${w.area}px@(${w.x.toFixed(1)},${w.y.toFixed(1)})`);
      await saveFrame(`${r.geo.name}-k${r.k}-f${String(f).padStart(4, '0')}.png`, r.lab, { ri: 1, lo: 0, hi: 0.4, scale: 2, caption: `${r.geo.name} k=${r.k} t=${t}` });
    }
    f++;
  }
  for (const r of runs) {
    log(`${r.geo.name} k=${r.k}: ${r.path.join(' ')}`);
    if (cfg.capture === `${r.geo.name}@${r.k}`) {
      const w = await where(r.lab), st = await capture(r.lab, w.x, w.y, 48, 48, `uskate-${r.geo.name}`, `U-skate (${r.geo.name}, k=${r.k})`);
      await window.__saveText(`uskate-${r.geo.name}.json`, JSON.stringify(stampToJSON(st)));
    }
    r.lab.sim.destroy();
  }
}
