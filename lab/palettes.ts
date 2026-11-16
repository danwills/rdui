// Colour maps and the custom palette through the real render shader (offscreen): a pattern's
// field in each, saved as PNGs.
//   node lab/run.mjs palettes '{"name":"orbits-crystals-accretion5","steps":300,"maps":["CET-L08","CET-R3"]}'
import { loadBundled } from '../src/ready';
import { COLORMAP_NAMES } from '../src/colormaps';
import { gpu, makeLab, log } from './lab';
import type { CustomChannel, ViewOptions } from '../src/sim';

export default async function (cfg: { name: string; steps?: number; maps?: string[] }) {
  const imp = await loadBundled(cfg.name);
  const N = imp.rule.size!.width;
  const lab = await makeLab(imp.rule, N, {}, 'initial');
  const S4 = lab.layout.S * 4;
  if (imp.image) {
    const { params, state } = await lab.read();
    imp.image.forEach((img, r) => { for (let i = 0; i < N * N; i++) state[i * S4 + r] = img[i]; });
    lab.sim.load(state, params);
  }
  await lab.run(cfg.steps ?? 300);
  // custom: each reagent fitted to its 1st-99th percentile, as the app's "fit ranges"
  const { state } = await lab.read();
  const colours: [number, number, number][] = [[1, 0.55, 0.2], [0.2, 0.75, 1], [0.6, 1, 0.3], [1, 0.3, 0.85]];
  const custom: CustomChannel[] = imp.rule.reagents.slice(0, 12).map((_, r) => {
    const v: number[] = [];
    for (let i = 0; i < N * N; i += 7) v.push(state[i * S4 + r]);
    v.sort((p, q) => p - q);
    return { on: r < 3, low: v[Math.floor(v.length * 0.01)], high: v[Math.floor(v.length * 0.99)], power: 1, color: colours[r % 4] };
  });
  const device = await gpu();
  const tex = device.createTexture({ size: [N, N], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const row = Math.ceil((N * 4) / 256) * 256;
  const r0 = imp.rule.reagents.indexOf(imp.rule.view.reagent);
  const shots: [string, number][] = [['custom', 7], ...(cfg.maps ?? ['CET-L08', 'CET-R3']).map((m): [string, number] => [m, 100 + COLORMAP_NAMES.indexOf(m)])];
  for (const [label, palette] of shots) {
    const view: ViewOptions = { mode: 'reagent', palette, reagent: Math.max(0, r0), low: imp.rule.view.low, high: imp.rule.view.high, tint: -1, tintLow: 0, tintHigh: 1, tintStrength: 0, hueShape: 1, hueOffset: 0, paramSlots: [], custom };
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
    await window.__save(`${cfg.name}-${label}.png`, c.toDataURL('image/png'));
    log(`saved ${label}`);
  }
}
