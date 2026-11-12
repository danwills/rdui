import stepWGSL from './shaders/step.wgsl?raw';
import brushWGSL from './shaders/brush.wgsl?raw';
import renderWGSL from './shaders/render.wgsl?raw';

export const BrushMode = {
  Seed: 0,
  Erase: 1,
  Params: 2,
  Wall: 3,
  Unwall: 4,
} as const;
export type BrushMode = (typeof BrushMode)[keyof typeof BrushMode];

export interface BrushStroke {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
  mode: BrushMode;
  strength: number;
  hardness: number;
  feed: number;
  kill: number;
  diffusion: number;
}

export interface CellSample {
  x: number;
  y: number;
  u: number;
  v: number;
  feed: number;
  kill: number;
  diffusion: number;
  wall: boolean;
}

export const ViewMode = { V: 0, U: 1, Params: 2 } as const;
export type ViewMode = (typeof ViewMode)[keyof typeof ViewMode];

const WG = 8;

/**
 * GPU Gray-Scott field with per-cell (feed, kill, diffusionScale, wall) parameters.
 * State is ping-ponged between two storage buffers; params live in one buffer
 * that only brushes write to.
 */
export class Simulation {
  readonly width: number;
  readonly height: number;
  du = 1.0;
  dv = 0.5;
  dt = 1.0;

  private device: GPUDevice;
  private state: [GPUBuffer, GPUBuffer];
  private params: GPUBuffer;
  private current = 0;

  private simUniform: GPUBuffer;
  private sizeUniform: GPUBuffer;
  private brushUniform: GPUBuffer;
  private viewUniform: GPUBuffer;

  private stepPipeline: GPUComputePipeline;
  private brushPipeline: GPUComputePipeline;
  private renderPipeline: GPURenderPipeline;

  private stepGroups: [GPUBindGroup, GPUBindGroup];
  private brushGroups: [GPUBindGroup, GPUBindGroup];
  private renderGroups: [GPUBindGroup, GPUBindGroup];

  private probeBuffer: GPUBuffer;
  private probeBusy = false;

  constructor(device: GPUDevice, format: GPUTextureFormat, width: number, height: number) {
    this.device = device;
    this.width = width;
    this.height = height;
    const cells = width * height;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

    this.state = [
      device.createBuffer({ size: cells * 8, usage: storage, label: 'state0' }),
      device.createBuffer({ size: cells * 8, usage: storage, label: 'state1' }),
    ];
    this.params = device.createBuffer({ size: cells * 16, usage: storage, label: 'params' });

    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.simUniform = device.createBuffer({ size: 32, usage: uniform });
    this.sizeUniform = device.createBuffer({ size: 16, usage: uniform });
    this.brushUniform = device.createBuffer({ size: 48, usage: uniform });
    this.viewUniform = device.createBuffer({ size: 32, usage: uniform });
    device.queue.writeBuffer(this.sizeUniform, 0, new Uint32Array([width, height, 0, 0]));

    this.probeBuffer = device.createBuffer({
      size: 24,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.stepPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: stepWGSL, label: 'step' }), entryPoint: 'main' },
    });
    this.brushPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: brushWGSL, label: 'brush' }), entryPoint: 'main' },
    });
    const renderModule = device.createShaderModule({ code: renderWGSL, label: 'render' });
    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    const stepGroup = (from: number) =>
      device.createBindGroup({
        layout: this.stepPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.simUniform } },
          { binding: 1, resource: { buffer: this.params } },
          { binding: 2, resource: { buffer: this.state[from] } },
          { binding: 3, resource: { buffer: this.state[1 - from] } },
        ],
      });
    this.stepGroups = [stepGroup(0), stepGroup(1)];

    const brushGroup = (cur: number) =>
      device.createBindGroup({
        layout: this.brushPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.brushUniform } },
          { binding: 1, resource: { buffer: this.sizeUniform } },
          { binding: 2, resource: { buffer: this.params } },
          { binding: 3, resource: { buffer: this.state[cur] } },
        ],
      });
    this.brushGroups = [brushGroup(0), brushGroup(1)];

    const renderGroup = (cur: number) =>
      device.createBindGroup({
        layout: this.renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.viewUniform } },
          { binding: 1, resource: { buffer: this.params } },
          { binding: 2, resource: { buffer: this.state[cur] } },
        ],
      });
    this.renderGroups = [renderGroup(0), renderGroup(1)];
  }

  /** Fill every cell with the same params, clearing walls and resetting chemistry. */
  reset(feed: number, kill: number, diffusion = 1.0, seeds = 12) {
    const cells = this.width * this.height;
    const p = new Float32Array(cells * 4);
    for (let i = 0; i < cells; i++) p.set([feed, kill, diffusion, 0], i * 4);
    this.device.queue.writeBuffer(this.params, 0, p);

    const s = new Float32Array(cells * 2);
    for (let i = 0; i < cells; i++) s[i * 2] = 1;
    for (let n = 0; n < seeds; n++) {
      const r = 3 + Math.floor(Math.random() * 6);
      const cx = Math.floor(Math.random() * this.width);
      const cy = Math.floor(Math.random() * this.height);
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++) {
          const i = ((cy + y + this.height) % this.height) * this.width + ((cx + x + this.width) % this.width);
          s[i * 2] = 0.5;
          s[i * 2 + 1] = 0.25 + Math.random() * 0.1;
        }
    }
    this.device.queue.writeBuffer(this.state[this.current], 0, s);
  }

  /** Replace params everywhere except walls are kept. Done on the GPU via a giant brush. */
  fillParams(feed: number, kill: number, diffusion: number) {
    const d = Math.hypot(this.width, this.height);
    this.brush({
      ax: this.width / 2, ay: this.height / 2, bx: this.width / 2, by: this.height / 2,
      radius: d, mode: BrushMode.Params, strength: 1, hardness: 1,
      feed, kill, diffusion,
    });
  }

  clearChemistry() {
    const s = new Float32Array(this.width * this.height * 2);
    for (let i = 0; i < s.length; i += 2) s[i] = 1;
    this.device.queue.writeBuffer(this.state[this.current], 0, s);
  }

  brush(b: BrushStroke) {
    const buf = new ArrayBuffer(48);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = b.ax; f[1] = b.ay; f[2] = b.bx; f[3] = b.by;
    f[4] = b.radius;
    u[5] = b.mode;
    f[6] = b.strength;
    f[7] = b.hardness;
    f[8] = b.feed; f[9] = b.kill; f[10] = b.diffusion; f[11] = Math.random() * 1000;
    this.device.queue.writeBuffer(this.brushUniform, 0, buf);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.brushPipeline);
    pass.setBindGroup(0, this.brushGroups[this.current]);
    pass.dispatchWorkgroups(Math.ceil(this.width / WG), Math.ceil(this.height / WG));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** Encode `n` simulation steps into the given encoder. */
  step(enc: GPUCommandEncoder, n: number) {
    if (n <= 0) return;
    const buf = new ArrayBuffer(32);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u[0] = this.width; u[1] = this.height;
    f[2] = this.du; f[3] = this.dv; f[4] = this.dt;
    this.device.queue.writeBuffer(this.simUniform, 0, buf);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.stepPipeline);
    const gx = Math.ceil(this.width / WG);
    const gy = Math.ceil(this.height / WG);
    for (let i = 0; i < n; i++) {
      pass.setBindGroup(0, this.stepGroups[this.current]);
      pass.dispatchWorkgroups(gx, gy);
      this.current = 1 - this.current;
    }
    pass.end();
  }

  render(enc: GPUCommandEncoder, target: GPUTextureView, canvasW: number, canvasH: number, mode: ViewMode, palette: number) {
    const buf = new ArrayBuffer(32);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u[0] = this.width; u[1] = this.height;
    f[2] = canvasW; f[3] = canvasH;
    u[4] = mode; u[5] = palette;
    this.device.queue.writeBuffer(this.viewUniform, 0, buf);

    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderGroups[this.current]);
    pass.draw(3);
    pass.end();
  }

  /** Read back one cell. Resolves to null if a probe is already in flight. */
  async probe(x: number, y: number): Promise<CellSample | null> {
    if (this.probeBusy || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    this.probeBusy = true;
    try {
      const i = y * this.width + x;
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.state[this.current], i * 8, this.probeBuffer, 0, 8);
      enc.copyBufferToBuffer(this.params, i * 16, this.probeBuffer, 8, 16);
      this.device.queue.submit([enc.finish()]);
      await this.probeBuffer.mapAsync(GPUMapMode.READ);
      const d = new Float32Array(this.probeBuffer.getMappedRange().slice(0));
      this.probeBuffer.unmap();
      return { x, y, u: d[0], v: d[1], feed: d[2], kill: d[3], diffusion: d[4], wall: d[5] > 0.5 };
    } catch {
      return null; // device lost or sim destroyed mid-read
    } finally {
      this.probeBusy = false;
    }
  }

  destroy() {
    for (const b of [...this.state, this.params, this.simUniform, this.sizeUniform, this.brushUniform, this.viewUniform, this.probeBuffer]) {
      b.destroy();
    }
  }
}
