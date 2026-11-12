// Worm spaceship hunt: soups of the fuseWorms family at 512², track elongated
// or large blobs that move steadily, then re-test each alone in a clean 512²
// field. Self-propelling survivors are saved as stamps.
import * as R from '../src/rule';
import { loadBundled } from '../src/ready';
import { stampToJSON } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, type Lab, type Blob } from './lab';

type Case = { name: string; pattern: string; g?: Record<string, number> };

export default async function (cfg: { cases?: Case[]; N?: number; warm?: number }) {
  const N = cfg.N ?? 512, warm = cfg.warm ?? 25000, dt = 400, nf = 8;
  const fw = 'grayscott-historyWave_fuseWorms', wt = 'grayscott-historyWave_fuseWorms-wiggletrains_init';
  const cases: Case[] = cfg.cases ?? [
    { name: 'fuseWorms', pattern: fw }, { name: 'wiggletrains', pattern: wt },
    ...[0.038, 0.04, 0.044, 0.046].map((F) => ({ name: `fuseWorms F=${F}`, pattern: fw, g: { F } })),
  ];
  const found: Record<string, unknown>[] = [];
  const runs: { c: Case; rule: R.RuleDef; lab: Lab; frames: Blob[][] }[] = [];
  for (const c of cases) {
    const rule = (await loadBundled(c.pattern)).rule;
    runs.push({ c, rule, lab: await makeLab(rule, N, c.g ?? {}, 'initial'), frames: [] });
  }
  await runAll(runs.map((r) => r.lab), warm);
  for (let f = 0; f < nf; f++) {
    if (f) await runAll(runs.map((r) => r.lab), dt);
    for (const r of runs) r.frames.push(blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2));
  }
  for (const r of runs) {
    const last = r.frames.at(-1)!;
    // follow each final blob back through nearest neighbours
    const movers: (Blob & { vx: number; vy: number; speed: number })[] = [];
    for (const b of last) {
      let cur = b; const st: [number, number][] = []; let ok = true;
      for (let f = nf - 2; f >= 0; f--) {
        const q = r.frames[f].map((o) => ({ o, d: Math.hypot(((o.x - cur.x + N * 1.5) % N) - N / 2, ((o.y - cur.y + N * 1.5) % N) - N / 2) })).sort((a, z) => a.d - z.d)[0];
        if (!q || q.d > 18 || Math.abs(q.o.area - cur.area) > 0.4 * cur.area + 6) { ok = false; break; }
        st.push([((cur.x - q.o.x + N * 1.5) % N) - N / 2, ((cur.y - q.o.y + N * 1.5) % N) - N / 2]); cur = q.o;
      }
      if (!ok) continue;
      const vx = st.reduce((s, v) => s + v[0], 0) / st.length / dt * 1000, vy = st.reduce((s, v) => s + v[1], 0) / st.length / dt * 1000, speed = Math.hypot(vx, vy);
      if (speed > 1.5) movers.push({ ...b, vx, vy, speed });
    }
    const wormy = movers.filter((m) => m.elong > 1.8 || m.area > 60);
    const big = last.filter((b) => b.elong > 1.8 || b.area > 60).length;
    log(`${r.c.name}: ${last.length} blobs (${big} worm-like), ${movers.length} steady movers, ${wormy.length} worm-like movers` + (wormy.length ? ': ' + wormy.slice(0, 6).map((m) => `[a${m.area} e${m.elong.toFixed(1)} ${m.speed.toFixed(1)}px/k]`).join(' ') : ''));
    await saveFrame(`${r.c.name.replace(/\W+/g, '_')}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.4, scale: 1, caption: r.c.name, boxes: wormy.map((m) => ({ x: m.x - 14, y: m.y - 14, w: 28, h: 28, color: '#ff6688' })) });
    // isolate up to 3 worm-like movers (most isolated first)
    const iso = wormy.map((m) => ({ m, d: Math.min(...last.filter((b) => b.x !== m.x || b.y !== m.y).map((b) => Math.hypot(b.x - m.x, b.y - m.y)), 999) })).sort((a, z) => z.d - a.d).slice(0, 3);
    for (const { m } of iso) {
      const w = Math.min(96, Math.ceil(Math.sqrt(m.area) * m.elong * 2 + 30));
      const id = `worm-${found.length}`;
      const st = await capture(r.lab, m.x, m.y, w, w, id, `${r.c.name} mover a${m.area}`);
      const test = await makeLab(r.rule, N, r.c.g ?? {});
      await test.place(st, N / 2, N / 2);
      await test.run(2000);
      const a0 = blobs((await test.read()).state, N, test.layout.S, 1, 0.2);
      await test.run(20000);
      const a1 = blobs((await test.read()).state, N, test.layout.S, 1, 0.2);
      const big1 = a1.sort((a, z) => z.area - a.area)[0];
      const big0 = a0.sort((a, z) => z.area - a.area)[0];
      const mv = big0 && big1 ? Math.hypot(((big1.x - big0.x + N * 1.5) % N) - N / 2, ((big1.y - big0.y + N * 1.5) % N) - N / 2) / 20 : 0;
      const verdict = !a1.length ? 'died alone' : a1.length === 1 && mv > 1 ? `SELF-PROPELLED ${mv.toFixed(1)}px/k, area ${big1.area}, elong ${big1.elong.toFixed(1)}` : `${a1.length} blobs, largest moved ${mv.toFixed(1)}px/k`;
      log(`   ${id} (a${m.area} e${m.elong.toFixed(1)}): ${verdict}`);
      await saveFrame(`${id}-alone.png`, test, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.4, scale: 1, caption: `${id}: ${verdict}` });
      if (verdict.startsWith('SELF')) {
        found.push({ id, source: r.c.name, g: r.c.g ?? null, speed: mv, area: big1.area, elong: big1.elong });
        await window.__saveText(`${id}.json`, JSON.stringify({ id, source: r.c.name, pattern: r.c.pattern, g: r.c.g ?? null, stamp: stampToJSON(st) }));
      }
      test.sim.destroy();
    }
    r.lab.sim.destroy();
  }
  return found;
}
