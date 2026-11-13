// Time the parts of the spectral Laplacian on their own: pack+kmul only, row
// FFTs, column FFTs, and the whole transform, at a few sizes and slot counts.
import { Spectral } from '../src/spectral';
import { gpu, log } from './lab';

export default async function (cfg: { sizes?: number[]; S?: number[]; reps?: number }) {
  const d = await gpu(), reps = cfg.reps ?? 300;
  for (const N of cfg.sizes ?? [256, 512]) for (const S of cfg.S ?? [1, 2]) {
    const st = [0, 1].map(() => d.createBuffer({ size: N * N * S * 16, usage: GPUBufferUsage.STORAGE }));
    const sp = new Spectral(d, N, N, S, false, st) as unknown as { encode: (p: GPUComputePassEncoder, f: number) => void; lines: (p: GPUComputePassEncoder, a: number, i: number, q: number) => void; destroy: () => void };
    const time = async (f: (p: GPUComputePassEncoder) => void) => {
      const run = async (n: number) => { const e = d.createCommandEncoder(); const p = e.beginComputePass(); for (let i = 0; i < n; i++) f(p); p.end(); d.queue.submit([e.finish()]); await d.queue.onSubmittedWorkDone(); };
      await run(10);
      const t0 = performance.now(); await run(reps); return ((performance.now() - t0) / reps) * 1000;
    };
    const full = await time((p) => sp.encode(p, 0));
    const rows = await time((p) => sp.lines(p, 0, 0, 0));
    const cols = await time((p) => sp.lines(p, 1, 0, 0));
    log(`${N}² S=${S}: full ${full.toFixed(0)} µs; one row pass ${rows.toFixed(0)} µs, one column pass ${cols.toFixed(0)} µs (full = 4 passes + pack + kmul)`);
    sp.destroy(); st.forEach((b) => b.destroy());
  }
}
