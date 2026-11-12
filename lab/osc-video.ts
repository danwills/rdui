// Re-run captured oscillators alone in a clean field of their medium and
// record a zoomed close-up; log whether the oscillation survives in isolation.
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampFromJSON } from '../src/stamps';
import { makeLab, blobs, saveFrame, log } from './lab';

export default async function (cfg: { ids: string[]; settle?: number; frames?: number; dt?: number; N?: number; crop?: number }) {
  const N = cfg.N ?? 128, c = N / 2;
  const out: Record<string, unknown> = {};
  for (const id of cfg.ids) {
    const rec = await (await fetch(`/lab/out/oscillators/${id}.json`)).json();
    const lab = await makeLab(GS_HISTORY_WAVE, N, rec.medium);
    await lab.place(stampFromJSON(rec.stamp), c, c);
    await lab.run(cfg.settle ?? 4000);
    const dt = cfg.dt ?? Math.max(20, Math.round(rec.period / 12));
    const peaks: number[] = [];
    for (let f = 0; f < (cfg.frames ?? 72); f++) {
      if (f) await lab.run(dt);
      const bs = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.15, 3);
      const near = bs.filter((b) => Math.hypot(b.x - c, b.y - c) < 20);
      peaks.push(near.reduce((m, b) => Math.max(m, b.peak), 0));
      await saveFrame(`${id}/f${String(f).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.4, scale: 4, caption: `${id}  t+${f * dt}` });
    }
    const amp = Math.max(...peaks) - Math.min(...peaks);
    out[id] = { amp, blobsEnd: (await blobs((await lab.read()).state, N, lab.layout.S, 1, 0.15, 3)).length };
    log(`${id} (soup period ≈${rec.period}): alone peak range ${Math.min(...peaks).toFixed(3)}–${Math.max(...peaks).toFixed(3)} → ${amp > 0.01 ? 'still oscillates' : 'goes quiet alone'}`);
    lab.sim.destroy();
  }
  return out;
}
