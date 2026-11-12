// Oscillator hunt: soups in a grid of media; after warm-up, track blobs that
// stay put and sample their peak/area densely. Report blobs whose signal
// repeats (autocorrelation peak) with a real amplitude, plus their period.
// Captures each as a stamp so it can be re-tested alone.
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampToJSON } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, type Lab, type Blob } from './lab';

function period(sig: number[]): { lag: number; r: number } {
  const n = sig.length, m = sig.reduce((a, b) => a + b, 0) / n;
  const x = sig.map((v) => v - m), v0 = x.reduce((a, b) => a + b * b, 0);
  if (v0 < 1e-12) return { lag: 0, r: 0 };
  let best = { lag: 0, r: 0 }, dipped = false;
  for (let L = 2; L < n / 2; L++) {
    let s = 0;
    for (let i = 0; i + L < n; i++) s += x[i] * x[i + L];
    const r = (s / v0) * (n / (n - L));
    if (r < 0) dipped = true; // must fall below zero first, so a slow drift doesn't count
    if (dipped && r > best.r) best = { lag: L, r };
  }
  return best;
}

export default async function (cfg: { media?: Record<string, number>[]; Fs?: number[]; ks?: number[]; warm?: number; samples?: number; dt?: number; batch?: number; N?: number }) {
  const N = cfg.N ?? 192, warm = cfg.warm ?? 20000, ns = cfg.samples ?? 120, dt = cfg.dt ?? 100, batch = cfg.batch ?? 14;
  const media: Record<string, number>[] = cfg.media ?? (cfg.Fs ?? [0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06]).flatMap((F) => (cfg.ks ?? [0.055, 0.057, 0.059, 0.061, 0.063, 0.065]).map((k) => ({ F, k })));
  const found: Record<string, unknown>[] = [];
  for (let j = 0; j < media.length; j += batch) {
    const runs: { g: Record<string, number>; lab: Lab; series: { x: number; y: number; peak: number[]; area: number[] }[]; total: number[] }[] = [];
    for (const g of media.slice(j, j + batch)) runs.push({ g, lab: await makeLab(GS_HISTORY_WAVE, N, g, 'initial'), series: [], total: [] });
    await runAll(runs.map((r) => r.lab), warm);
    for (let s = 0; s < ns; s++) {
      if (s) await runAll(runs.map((r) => r.lab), dt);
      for (const r of runs) {
        const { state } = await r.lab.read();
        let tot = 0;
        for (let i = 0; i < N * N; i++) tot += state[i * r.lab.layout.S * 4 + 1];
        r.total.push(tot);
        const bs: Blob[] = blobs(state, N, r.lab.layout.S, 1, 0.15, 3);
        if (s === 0) r.series = bs.map((b) => ({ x: b.x, y: b.y, peak: [b.peak], area: [b.area] }));
        else for (const t of r.series) {
          if (t.peak.length !== s) continue; // lost earlier
          const q = bs.find((b) => Math.hypot(b.x - t.x, b.y - t.y) < 4);
          if (q) { t.peak.push(q.peak); t.area.push(q.area); }
        }
      }
    }
    for (const r of runs) {
      const kept = r.series.filter((t) => t.peak.length === ns);
      const osc = kept.map((t) => {
        const pk = period(t.peak), ar = period(t.area);
        const amp = (Math.max(...t.peak) - Math.min(...t.peak)) / (t.peak.reduce((a, b) => a + b, 0) / ns);
        const best = pk.r >= ar.r ? pk : ar;
        return { ...t, lag: best.lag, r: best.r, amp, aamp: Math.max(...t.area) - Math.min(...t.area) };
      }).filter((o) => o.r > 0.6 && o.lag < ns / 3 && (o.amp > 0.1 || o.aamp >= 8));
      const moving = r.series.length - kept.length;
      const fp = period(r.total);
      if (fp.r > 0.6 && fp.lag < ns / 3) log(`  whole field oscillates: p≈${fp.lag * dt} r ${fp.r.toFixed(2)} range ${Math.min(...r.total).toFixed(0)}–${Math.max(...r.total).toFixed(0)}`);
      const mname = Object.entries(r.g).map(([k, v]) => `${k}=${v}`).join(' ');
      log(`${mname}: ${r.series.length} blobs, ${kept.length} stay put, ${moving} move/vanish, oscillating: ` + (osc.length ? osc.map((o) => `p≈${o.lag * dt} (r ${o.r.toFixed(2)}, amp ${(o.amp * 100).toFixed(0)}%/${o.aamp}c)`).join(' ') : 'none'));
      for (const [i, o] of osc.slice(0, 3).entries()) {
        const id = `osc-${Object.values(r.g).join('_')}-${i}`;
        const st = await capture(r.lab, o.x, o.y, 32, 32, id, `oscillator p≈${o.lag * dt} ${mname}`);
        const rec = { id, medium: r.g, period: o.lag * dt, r: o.r, amp: o.amp, areaAmp: o.aamp, x: o.x, y: o.y, peak: o.peak, area: o.area };
        found.push(rec);
        await window.__saveText(`${id}.json`, JSON.stringify({ ...rec, stamp: stampToJSON(st) }));
      }
      if (osc.length) await saveFrame(`${Object.values(r.g).join('_')}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.4, scale: 2, caption: mname, boxes: osc.map((o) => ({ x: o.x - 8, y: o.y - 8, w: 16, h: 16, color: '#ff6688', label: `${o.lag * dt}` })) });
      r.lab.sim.destroy();
    }
  }
  return found.map(({ peak: _p, area: _a, ...rest }) => rest);
}
