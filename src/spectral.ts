import fftWGSL from './shaders/fft.wgsl?raw';
import spectralWGSL from './shaders/spectral.wgsl?raw';

const WG = 8;

/**
 * Spectral Laplacian (and optionally bilaplacian) of a W×H field with S vec4
 * slots per cell, by FFT: pack → FFT rows, columns → multiply by λ(|k|) (and
 * λ²) → inverse. After `encode`, `lap` (and `bilap`) hold the results in the
 * same layout as the state. Perfectly isotropic; ignores walls. λ is exact
 * (−|k|²) or, `matched`, the 9-point stencil's axis response in all directions.
 * W and H must be powers of two, at most 512.
 */
export class Spectral {
  readonly lap: GPUBuffer;
  readonly bilap: GPUBuffer;

  private device: GPUDevice;
  private W: number;
  private H: number;
  private S: number;
  private withBilap: boolean;
  private matched: boolean;
  private im: GPUBuffer;
  private bim: GPUBuffer;
  private info: GPUBuffer;
  private fftInfo: GPUBuffer[] = [];
  private packPipeline: GPUComputePipeline;
  private kmulPipeline: GPUComputePipeline;
  private fftPipelines: GPUComputePipeline[] = [];
  private packGroups: GPUBindGroup[];
  private kmulGroup: GPUBindGroup;
  /** [axis][inverse][pair]: pair 0 is (lap, im), pair 1 is (bilap, bim). */
  private fftGroups: GPUBindGroup[][][] = [];
  private trivial: boolean;

  constructor(device: GPUDevice, W: number, H: number, S: number, withBilap: boolean, states: GPUBuffer[], matched = true) {
    this.device = device;
    this.W = W; this.H = H; this.S = S; this.withBilap = withBilap; this.matched = matched;
    const pow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
    if (!pow2(W) || !pow2(H) || W > 512 || H > 512) throw new Error(`spectral Laplacian needs power-of-two sizes ≤ 512 (got ${W}×${H})`);
    // A 1×1 field (rest relaxation) has zero Laplacian: leave the buffers zeroed.
    this.trivial = W === 1 && H === 1;
    const size = W * H * S * 16;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.lap = device.createBuffer({ size, usage, label: 'lap' });
    this.im = device.createBuffer({ size, usage, label: 'lap-im' });
    this.bilap = device.createBuffer({ size: withBilap ? size : 16, usage, label: 'bilap' });
    this.bim = device.createBuffer({ size: withBilap ? size : 16, usage, label: 'bilap-im' });
    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.info = device.createBuffer({ size: 32, usage: uniform });
    this.setDx(1);

    const spec = device.createShaderModule({ code: spectralWGSL, label: 'spectral' });
    this.packPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: spec, entryPoint: 'pack', constants: { S } } });
    this.kmulPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: spec, entryPoint: 'kmul', constants: { S } } });
    this.packGroups = states.map((src) =>
      device.createBindGroup({
        layout: this.packPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.info } },
          { binding: 1, resource: { buffer: src } },
          { binding: 2, resource: { buffer: this.lap } },
          { binding: 3, resource: { buffer: this.im } },
        ],
      }),
    );
    this.kmulGroup = device.createBindGroup({
      layout: this.kmulPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.info } },
        { binding: 2, resource: { buffer: this.lap } },
        { binding: 3, resource: { buffer: this.im } },
        { binding: 4, resource: { buffer: this.bilap } },
        { binding: 5, resource: { buffer: this.bim } },
      ],
    });
    if (this.trivial) return;

    const fft = device.createShaderModule({ code: fftWGSL, label: 'fft' });
    for (const axis of [0, 1]) {
      const n = axis === 0 ? W : H;
      const pipe = device.createComputePipeline({
        layout: 'auto',
        compute: { module: fft, entryPoint: 'main', constants: { N: n, LOGN: Math.log2(n), S } },
      });
      this.fftPipelines.push(pipe);
      this.fftGroups.push(
        [0, 1].map((inverse) => {
          const u = device.createBuffer({ size: 16, usage: uniform });
          device.queue.writeBuffer(u, 0, new Uint32Array([W, H, axis, inverse]));
          this.fftInfo.push(u);
          return [[this.lap, this.im], [this.bilap, this.bim]].map(([r, i]) =>
            device.createBindGroup({
              layout: pipe.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: u } },
                { binding: 1, resource: { buffer: r } },
                { binding: 2, resource: { buffer: i } },
              ],
            }),
          );
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
  }

  private lines(pass: GPUComputePassEncoder, axis: number, inverse: number, pair: number) {
    pass.setPipeline(this.fftPipelines[axis]);
    pass.setBindGroup(0, this.fftGroups[axis][inverse][pair]);
    pass.dispatchWorkgroups(axis === 0 ? this.H : this.W, this.S);
  }

  destroy() {
    for (const b of [this.lap, this.im, this.bilap, this.bim, this.info, ...this.fftInfo]) b.destroy();
  }
}
