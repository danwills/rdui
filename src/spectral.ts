import fftWGSL from './shaders/fft.wgsl?raw';
import spectralWGSL from './shaders/spectral.wgsl?raw';

const WG = 8;

/**
 * Spectral Laplacian (and optionally bilaplacian) of a W×H field with S vec4
 * slots per cell, by FFT: pack slot pairs into complex signals → FFT rows,
 * columns → multiply by λ(|k|) (and λ²) → inverse → unpack. After `encode`,
 * `lap` (and `bilap`) hold the results in the same layout as the state.
 * Perfectly isotropic; ignores walls. λ is exact (−|k|²) or, `matched`, the
 * 9-point stencil's axis response in all directions. W and H must be powers
 * of two, at most 512.
 */
export class Spectral {
  readonly lap: GPUBuffer;
  readonly bilap: GPUBuffer;

  private device: GPUDevice;
  private W: number;
  private H: number;
  private P: number;
  private withBilap: boolean;
  private matched: boolean;
  /** Complex work buffers, P = ceil(S/2) slot pairs per cell. */
  private re: GPUBuffer;
  private im: GPUBuffer;
  private bre: GPUBuffer;
  private bim: GPUBuffer;
  private info: GPUBuffer;
  private fftInfo: GPUBuffer[] = [];
  private twiddles: GPUBuffer[] = [];
  private packPipeline: GPUComputePipeline;
  private kmulPipeline: GPUComputePipeline;
  private unpackPipeline: GPUComputePipeline;
  private fftPipelines: GPUComputePipeline[] = [];
  private packGroups: GPUBindGroup[];
  private kmulGroup: GPUBindGroup;
  private unpackGroup: GPUBindGroup;
  /** [axis][inverse][pair]: pair 0 is (re, im), pair 1 is (bre, bim). */
  private fftGroups: GPUBindGroup[][][] = [];
  private trivial: boolean;

  constructor(device: GPUDevice, W: number, H: number, S: number, withBilap: boolean, states: GPUBuffer[], matched = true) {
    this.device = device;
    this.W = W; this.H = H; this.withBilap = withBilap; this.matched = matched;
    const P = (this.P = Math.ceil(S / 2));
    const pow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
    if (!pow2(W) || !pow2(H) || W > 512 || H > 512) throw new Error(`spectral Laplacian needs power-of-two sizes ≤ 512 (got ${W}×${H})`);
    // A 1×1 field (rest relaxation) has zero Laplacian: leave the buffers zeroed.
    this.trivial = W === 1 && H === 1;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const buf = (slots: number, label: string, used = true) => device.createBuffer({ size: used ? W * H * slots * 16 : 16, usage, label });
    this.lap = buf(S, 'lap');
    this.bilap = buf(S, 'bilap', withBilap);
    this.re = buf(P, 'spectrum-re');
    this.im = buf(P, 'spectrum-im');
    this.bre = buf(P, 'bispectrum-re', withBilap);
    this.bim = buf(P, 'bispectrum-im', withBilap);
    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.info = device.createBuffer({ size: 32, usage: uniform });
    this.setDx(1);

    const spec = device.createShaderModule({ code: spectralWGSL, label: 'spectral' });
    const pipe = (entryPoint: string) => device.createComputePipeline({ layout: 'auto', compute: { module: spec, entryPoint, constants: { S, P } } });
    this.packPipeline = pipe('pack');
    this.kmulPipeline = pipe('kmul');
    this.unpackPipeline = pipe('unpack');
    const group = (p: GPUComputePipeline, entries: [number, GPUBuffer][]) =>
      device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })) });
    this.packGroups = states.map((src) => group(this.packPipeline, [[0, this.info], [1, src], [2, this.re], [3, this.im]]));
    this.kmulGroup = group(this.kmulPipeline, [[0, this.info], [2, this.re], [3, this.im], [4, this.bre], [5, this.bim]]);
    this.unpackGroup = group(this.unpackPipeline, [[0, this.info], [2, this.re], [3, this.im], [4, this.bre], [5, this.bim], [6, this.lap], [7, this.bilap]]);
    if (this.trivial) return;

    const fft = device.createShaderModule({ code: fftWGSL, label: 'fft' });
    for (const axis of [0, 1]) {
      const n = axis === 0 ? W : H;
      const fp = device.createComputePipeline({
        layout: 'auto',
        compute: { module: fft, entryPoint: 'main', constants: { N: n, LOGN: Math.log2(n), S: P, WG: Math.max(1, n / 2) } },
      });
      this.fftPipelines.push(fp);
      // e^{-2πij/n}, j < n/2
      const tw = new Float32Array(Math.max(2, n));
      for (let j = 0; j < n / 2; j++) { tw[2 * j] = Math.cos((2 * Math.PI * j) / n); tw[2 * j + 1] = -Math.sin((2 * Math.PI * j) / n); }
      const twb = device.createBuffer({ size: tw.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(twb, 0, tw);
      this.twiddles.push(twb);
      this.fftGroups.push(
        [0, 1].map((inverse) => {
          const u = device.createBuffer({ size: 16, usage: uniform });
          device.queue.writeBuffer(u, 0, new Uint32Array([W, H, axis, inverse]));
          this.fftInfo.push(u);
          return [[this.re, this.im], [this.bre, this.bim]].map(([r, i]) => group(fp, [[0, u], [1, r], [2, i], [3, twb]]));
        }),
      );
    }
  }

  /** Grid spacing used for the wavenumbers. */
  setDx(dx: number) {
    const buf = new ArrayBuffer(32);
    new Uint32Array(buf).set([this.W, this.H, this.withBilap ? 1 : 0, this.matched ? 1 : 0]);
    new Float32Array(buf).set([dx], 4);
    this.device.queue.writeBuffer(this.info, 0, buf);
  }

  /** Encode the transforms of state buffer `from` (index into `states`) into an open compute pass. */
  encode(pass: GPUComputePassEncoder, from: number) {
    if (this.trivial) return;
    const gx = Math.ceil(this.W / WG), gy = Math.ceil(this.H / WG);
    pass.setPipeline(this.packPipeline);
    pass.setBindGroup(0, this.packGroups[from]);
    pass.dispatchWorkgroups(gx, gy);
    this.lines(pass, 0, 0, 0);
    this.lines(pass, 1, 0, 0);
    pass.setPipeline(this.kmulPipeline);
    pass.setBindGroup(0, this.kmulGroup);
    pass.dispatchWorkgroups(gx, gy);
    for (const pair of this.withBilap ? [0, 1] : [0]) {
      this.lines(pass, 1, 1, pair);
      this.lines(pass, 0, 1, pair);
    }
    pass.setPipeline(this.unpackPipeline);
    pass.setBindGroup(0, this.unpackGroup);
    pass.dispatchWorkgroups(gx, gy);
  }

  private lines(pass: GPUComputePassEncoder, axis: number, inverse: number, pair: number) {
    pass.setPipeline(this.fftPipelines[axis]);
    pass.setBindGroup(0, this.fftGroups[axis][inverse][pair]);
    pass.dispatchWorkgroups(axis === 0 ? this.H : this.W, this.P);
  }

  destroy() {
    for (const b of [this.lap, this.bilap, this.re, this.im, this.bre, this.bim, this.info, ...this.fftInfo, ...this.twiddles]) b.destroy();
  }
}
