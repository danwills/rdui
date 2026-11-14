// U-skate hunt in plain Gray-Scott (Munafo's U-skate world, F 0.062, k ≈ 0.0609):
// drop one seed shape per field (rectangles, discs, half-discs) at a few k,
// track blobs, and report anything that keeps its size while moving steadily.
// With `negative`, the field starts in the excited uniform state (which takes
// over at these parameters) and seeds are holes in it; holes are tracked.
// Candidates' final frames are saved (cand-*.png) and each is captured as a
// stamp (cand-*.json, a box around the blob) for checking and bundling.
import { GRAY_SCOTT } from '../src/rule';
import { stampToJSON } from '../src/stamps';
import { makeLab, runAll, blobs, wrapDelta, saveFrame, capture, log, type Lab, type Blob } from './lab';

type Shape = { kind: 'rect'; w: number; h: number } | { kind: 'disc' | 'half'; r: number };

export default async function (cfg: { N?: number; F?: number; ks?: number[]; steps?: number; every?: number; batch?: number; shapes?: Shape[]; box?: number; g?: Record<string, number>; negative?: boolean }) {
  const N = cfg.N ?? 192, F = cfg.F ?? 0.062, steps = cfg.steps ?? 40000, every = cfg.every ?? 2000, box = cfg.box ?? 48;
  const shapes: Shape[] = cfg.shapes ?? [
    ...[4, 8, 12, 16, 24].flatMap((w) => [4, 8, 12, 16, 24].filter((h) => h >= w).map((h) => ({ kind: 'rect' as const, w, h }))),
    ...[4, 6, 8, 10, 14].map((r) => ({ kind: 'disc' as const, r })),
    ...[6, 8, 10, 14].map((r) => ({ kind: 'half' as const, r })),
  ];
  const jobs = (cfg.ks ?? [0.0607, 0.0609, 0.0611]).flatMap((k) => shapes.map((s) => ({ k, s })));
  const name = (j: { k: number; s: Shape }) => `k${j.k} ${j.s.kind === 'rect' ? `rect ${j.s.w}×${j.s.h}` : `${j.s.kind} r${j.s.r}`}`;
  // holes are tracked as blobs of 0.4 − b
  const view = (st: Float32Array) => {
    if (!cfg.negative) return st;
    const o = st.slice();
    for (let i = 1; i < o.length; i += 4) o[i] = 0.4 - o[i];
    return o;
  };
  let found = 0;
  for (let j0 = 0; j0 < jobs.length; j0 += cfg.batch ?? 16) {
    const batch = jobs.slice(j0, j0 + (cfg.batch ?? 16));
    const labs: { lab: Lab; job: (typeof jobs)[number]; hist: Blob[][] }[] = [];
    for (const job of batch) {
      const lab = await makeLab(GRAY_SCOTT, N, { ...cfg.g, F, k: job.k });
      const { state } = await lab.read(), S4 = lab.layout.S * 4, c = N / 2;
      // the excited uniform state: a·b = F + k, F(1 − a) = (F + k)·b, upper root
      const Fk = F + job.k, bHi = (1 + Math.sqrt(Math.max(0, 1 - (4 * Fk * Fk) / F))) / ((2 * Fk) / F), aHi = Fk / bHi;
      const [bgA, bgB, inA, inB] = cfg.negative ? [aHi, bHi, 1, 0] : [1, 0, 0.5, 0.25];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - c, dy = y + 0.5 - c, s = job.s;
        const inside = s.kind === 'rect' ? Math.abs(dx) < s.w / 2 && Math.abs(dy) < s.h / 2
          : s.kind === 'disc' ? dx * dx + dy * dy < s.r * s.r : dx * dx + dy * dy < s.r * s.r && dx > 0;
        state[(y * N + x) * S4] = inside ? inA : bgA;
        state[(y * N + x) * S4 + 1] = inside ? inB : bgB;
      }
      lab.sim.writeRegion(0, 0, N, N, undefined, state);
      labs.push({ lab, job, hist: [] });
    }
    for (let t = every; t <= steps; t += every) {
      await runAll(labs.map((l) => l.lab), every);
      for (const l of labs) l.hist.push(blobs(view((await l.lab.read()).state), N, 1, 1, cfg.negative ? 0.25 : 0.2));
    }
    for (const l of labs) {
      const last = l.hist[l.hist.length - 1];
      const summary = `${last.length} blobs${last.length ? `, areas ${last.map((b) => b.area).join('/')}` : ''}`;
      // follow each final blob back through the last 6 samples by nearest similar-sized blob
      const cands: string[] = [];
      for (const b of last) {
        const path = [b];
        for (let i = l.hist.length - 2; i >= Math.max(0, l.hist.length - 6); i--) {
          const p = path[path.length - 1];
          let best: Blob | null = null, bd = Infinity;
          for (const q of l.hist[i]) {
            const d = Math.hypot(wrapDelta(q.x, p.x, N), wrapDelta(q.y, p.y, N));
            if (d < bd && q.area > p.area * 0.7 && q.area < p.area * 1.4) { bd = d; best = q; }
          }
          if (!best || bd > N / 4) break;
          path.push(best);
        }
        if (path.length < 6) continue;
        const steps5 = path.slice(0, 5).map((p, i) => [wrapDelta(path[i + 1].x, p.x, N), wrapDelta(path[i + 1].y, p.y, N)]);
        const speeds = steps5.map(([x, y]) => Math.hypot(x, y));
        const areas = path.map((p) => p.area);
        const steady = Math.min(...speeds) > 1 && Math.max(...speeds) < 1.5 * Math.min(...speeds) && Math.max(...areas) < 1.2 * Math.min(...areas);
        if (!steady) continue;
        const [vx, vy] = steps5.reduce((s, v) => [s[0] + v[0], s[1] + v[1]], [0, 0]).map((v) => v / (5 * every));
        const tag = `${name(l.job).replace(/[ ×]/g, '_')}-${cands.length}`;
        cands.push(`mover area ${b.area} elong ${b.elong.toFixed(2)} v=(${(vx * 1000).toFixed(2)}, ${(vy * 1000).toFixed(2)}) px/kstep`);
        found++;
        await saveFrame(`cand-${tag}.png`, l.lab, { ri: 1, lo: 0, hi: 0.4, scale: 2, caption: `${name(l.job)} t=${steps}`, boxes: [{ x: b.x - box / 2, y: b.y - box / 2, w: box, h: box, label: 'skate?' }] });
        const st = await capture(l.lab, b.x, b.y, box, box, `uskate-${tag}`, `U-skate? ${name(l.job)}`);
        await window.__saveText(`cand-${tag}.json`, JSON.stringify(stampToJSON(st)));
      }
      log(`${name(l.job)}: ${summary}${cands.length ? '  ★ ' + cands.join('; ') : ''}`);
      l.lab.sim.destroy();
    }
  }
  log(`${found} candidate movers`);
}
