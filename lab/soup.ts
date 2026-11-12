// Spaceship hunt: run soups (each rule's own initial pattern) in Dan's
// History-Wave patterns and in F/k variants of the glider medium; track blobs
// that move steadily, then re-test each kind alone in a clean field. Survivors
// that keep moving are spaceships; they're saved as stamps.
import * as R from '../src/rule';
import { BUNDLED_PATTERNS, loadBundled } from '../src/ready';
import { stampToJSON } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, type Lab, type Blob } from './lab';

interface Mover { x: number; y: number; vx: number; vy: number; speed: number; area: number; peak: number }

function track(frames: Blob[][], dt: number, N: number): Mover[] {
  // follow each blob of the last frame backwards through nearest neighbours
  const out: Mover[] = [];
  for (const b of frames.at(-1)!) {
    let cur = b, ok = true;
    const steps: [number, number][] = [];
    for (let f = frames.length - 2; f >= 0; f--) {
      const near = frames[f].map((q) => ({ q, d: Math.hypot(((q.x - cur.x + N * 1.5) % N) - N / 2, ((q.y - cur.y + N * 1.5) % N) - N / 2) })).sort((a, c) => a.d - c.d)[0];
      if (!near || near.d > 14) { ok = false; break; }
      steps.push([((cur.x - near.q.x + N * 1.5) % N) - N / 2, ((cur.y - near.q.y + N * 1.5) % N) - N / 2]);
      cur = near.q;
    }
    if (!ok) continue;
    const vx = steps.reduce((s, v) => s + v[0], 0) / steps.length / dt * 1000, vy = steps.reduce((s, v) => s + v[1], 0) / steps.length / dt * 1000;
    const speed = Math.hypot(vx, vy);
    // steady: every step roughly the same displacement
    const steady = steps.every((v) => Math.hypot(v[0] * 1000 / dt - vx, v[1] * 1000 / dt - vy) < 0.35 * speed + 0.5);
    if (speed > 2 && steady) out.push({ x: b.x, y: b.y, vx, vy, speed, area: b.area, peak: b.peak });
  }
  return out;
}

export default async function (cfg: { only?: string[]; warm?: number; N?: number; variants?: boolean }) {
  const N = cfg.N ?? 256, warm = cfg.warm ?? 15000, dt = 300, nf = 8;
  const cases: { name: string; rule: R.RuleDef; g?: Record<string, number> }[] = [];
  for (const { name: p } of BUNDLED_PATTERNS) if (!cfg.only || cfg.only.includes(p)) cases.push({ name: p, rule: (await loadBundled(p)).rule });
  if (cfg.variants !== false && !cfg.only)
    for (const F of [0.05, 0.052, 0.056, 0.058]) for (const k of [0.061, 0.062, 0.064, 0.065]) cases.push({ name: `HW F=${F} k=${k}`, rule: R.GS_HISTORY_WAVE, g: { F, k } });
  const found: Record<string, unknown>[] = [];
  for (let i = 0; i < cases.length; i += 8) {
    const batch: { c: (typeof cases)[0]; lab: Lab }[] = [];
    for (const c of cases.slice(i, i + 8)) batch.push({ c, lab: await makeLab(c.rule, N, c.g ?? {}, 'initial') });
    await runAll(batch.map((b) => b.lab), warm);
    const frames: Blob[][][] = batch.map(() => []);
    for (let f = 0; f < nf; f++) {
      if (f) await runAll(batch.map((b) => b.lab), dt);
      for (const [j, b] of batch.entries()) frames[j].push(blobs((await b.lab.read()).state, N, b.lab.layout.S, 1, 0.2));
    }
    for (const [j, { c, lab }] of batch.entries()) {
      const movers = track(frames[j], dt, N);
      const total = frames[j].at(-1)!.length;
      // group by speed (0.5 px/k bins) and area (6-cell bins)
      const kinds = new Map<string, Mover[]>();
      for (const m of movers) {
        const key = `${(Math.round(m.speed * 2) / 2).toFixed(1)}px/k a~${Math.round(m.area / 6) * 6}`;
        kinds.set(key, [...(kinds.get(key) ?? []), m]);
      }
      log(`${c.name}: ${total} blobs, ${movers.length} steady movers` + (kinds.size ? ' — ' + [...kinds].map(([k, v]) => `${k}×${v.length}`).join(', ') : ''));
      await saveFrame(`${c.name.replace(/[^\w.=-]+/g, '_')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.4, scale: 1, caption: c.name, boxes: movers.map((m) => ({ x: m.x - 8, y: m.y - 8, w: 16, h: 16, color: '#ff6688' })) });
      // isolate one example of each kind in a clean field of the same rule
      for (const [key, ms] of kinds) {
        const m = ms.sort((a, b) => b.peak - a.peak)[0];
        // crowded neighbours make a bad capture; prefer the most isolated
        const iso = ms.map((q) => ({ q, d: Math.min(...frames[j].at(-1)!.filter((b) => b.x !== q.x || b.y !== q.y).map((b) => Math.hypot(b.x - q.x, b.y - q.y)), 999) })).sort((a, b) => b.d - a.d)[0]?.q ?? m;
        const w = 32;
        const st = await capture(lab, iso.x - (iso.vx / iso.speed) * 4, iso.y - (iso.vy / iso.speed) * 4, w, w, `ship-${found.length}`, `${c.name} ${key}`);
        const test = await makeLab(c.rule, N, c.g ?? {});
        test.place(st, N / 2, N / 2);
        await test.run(1000);
        const a0 = blobs((await test.read()).state, N, test.layout.S, 1, 0.2);
        await test.run(6000);
        const a1 = blobs((await test.read()).state, N, test.layout.S, 1, 0.2);
        const single = a0.length === 1 && a1.length === 1;
        const mv = single ? Math.hypot(((a1[0].x - a0[0].x + N * 1.5) % N) - N / 2, ((a1[0].y - a0[0].y + N * 1.5) % N) - N / 2) / 6 : 0;
        const verdict = !a1.length ? 'died alone' : single && mv > 2 ? `SPACESHIP ${mv.toFixed(1)}px/k` : single ? 'stopped' : `became ${a1.length} blobs`;
        log(`   ${key}: ${verdict}`);
        if (verdict.startsWith('SPACESHIP')) {
          const rec = { id: st.id, source: c.name, globals: c.g ?? null, speedAlone: mv, area: a1[0].area, peak: a1[0].peak, kind: key };
          found.push(rec);
          await window.__saveText(`${st.id}.json`, JSON.stringify({ ...rec, stamp: stampToJSON(st) }));
          await saveFrame(`${st.id}-alone.png`, test, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.4, scale: 1, caption: `${st.id}: ${c.name} ${mv.toFixed(1)}px/k` });
        }
        test.sim.destroy();
      }
      lab.sim.destroy();
    }
  }
  return found;
}
