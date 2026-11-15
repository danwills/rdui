// The fleck palettes through the real render shader (offscreen), at different fleck ranges:
// renders a pattern's field and saves PNGs.
//   node lab/run.mjs fleck-range '{"name":"orbits-constellations_epochs","steps":2000}'
import { loadBundled } from '../src/ready';
import { makeLab, log } from './lab';
import type { ViewOptions } from '../src/sim';

export default async function (cfg: { name: string; steps?: number; ranges?: [number, number][] }) {
  const imp = await loadBundled(cfg.name);
  const N = imp.rule.size!.width;
  const lab = await makeLab(imp.rule, N, {}, 'initial');
  const S4 = lab.layout.S * 4;
  if (imp.image) {
    const { params, state } = await lab.read();
    imp.image.forEach((img, r) => { for (let i = 0; i < N * N; i++) state[i * S4 + r] = img[i]; });
    lab.sim.load(state, params);
  }
  await lab.run(cfg.steps ?? 1000);
  // the fitted range: 2nd-98th percentile of a, b, c, as the app's "fit fleck range"
  const { state } = await lab.read();
  const v: number[] = [];
  for (let i = 0; i < N * N; i += 7) for (let r = 0; r < Math.min(3, imp.rule.reagents.length); r++) v.push(state[i * S4 + r]);
  v.sort((p, q) => p - q);
  const fit: [number, number] = [v[Math.floor(v.length * 0.02)], v[Math.floor(v.length * 0.98)]];
  log(`fitted range ${fit[0].toFixed(3)} .. ${fit[1].toFixed(3)}`);
  const device = lab.sim.device;
  const tex = device.createTexture({ size: [N, N], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const row = Math.ceil((N * 4) / 256) * 256;
  for (const [label, range] of [['0..1', [0, 1]], ['fitted', fit], ...(cfg.ranges ?? []).map((r) => [`${r[0]}..${r[1]}`, r])] as [string, [number, number]][]) {
    for (const palette of [5, 6]) {
      const view: ViewOptions = { mode: 'reagent', palette, reagent: 0, low: 0, high: 1, tint: -1, tintLow: 0, tintHigh: 1, tintStrength: 0, hueShape: 1.2, hueOffset: palette === 5 ? 0.48 : 0.6, paramSlots: [], fleckLow: range[0], fleckHigh: range[1] };
      const enc = device.createCommandEncoder();
      lab.sim.render(enc, tex.createView(), N, N, view);
      const buf = device.createBuffer({ size: row * N, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: row }, [N, N]);
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(buf.getMappedRange());
      const img = new ImageData(N, N);
      for (let y = 0; y < N; y++) img.data.set(src.subarray(y * row, y * row + N * 4), y * N * 4);
      buf.destroy();
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      const c = document.createElement('canvas');
      c.width = c.height = N;
      c.getContext('2d')!.putImageData(img, 0, 0);
      const name = `${cfg.name}-${palette === 5 ? 'hsv' : 'oklch'}-${label.replace(/[^\w.-]/g, '_')}.png`;
      await window.__save(name, c.toDataURL('image/png'));
      log(`saved ${name}`);
    }
  }
}
