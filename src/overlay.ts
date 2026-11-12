import type { Probe, Rect } from './probes';

const PROBE_COLORS = ['#ffcc66', '#66d9ff', '#ff7ab6', '#9dff7a', '#c79bff', '#ff9a5c', '#5cffd6', '#f2f2f2'];

export function probeColor(p: { id: number }) {
  return PROBE_COLORS[(p.id - 1) % PROBE_COLORS.length];
}

export interface Ghost {
  x: number;
  y: number;
  w: number;
  h: number;
  image: HTMLCanvasElement;
}

/** 2D canvas stacked on the WebGPU view for annotations. Coordinates are grid cells. */
export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(gridW: number, gridH: number, probes: Probe[], drag: Rect | null, dragColor: string, ghost: Ghost | null) {
    const { ctx, canvas } = this;
    const sx = canvas.width / gridW;
    const sy = canvas.height / gridH;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1, dpr);
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    ctx.textBaseline = 'bottom';

    if (ghost) {
      ctx.globalAlpha = 0.55;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ghost.image, ghost.x * sx, ghost.y * sy, ghost.w * sx, ghost.h * sy);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffffaa';
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.strokeRect(ghost.x * sx + 0.5, ghost.y * sy + 0.5, ghost.w * sx, ghost.h * sy);
      ctx.setLineDash([]);
    }

    for (const p of probes) {
      const c = probeColor(p);
      ctx.strokeStyle = c;
      ctx.strokeRect(p.x * sx + 0.5, p.y * sy + 0.5, p.w * sx, p.h * sy);
      const label = `${p.name} ${p.v.toFixed(3)}`;
      const tw = ctx.measureText(label).width;
      const ly = p.y * sy > 14 * dpr ? p.y * sy - 2 * dpr : (p.y + p.h) * sy + 13 * dpr;
      ctx.fillStyle = '#000a';
      ctx.fillRect(p.x * sx, ly - 12 * dpr, tw + 6 * dpr, 13 * dpr);
      ctx.fillStyle = c;
      ctx.fillText(label, p.x * sx + 3 * dpr, ly);
    }

    if (drag) {
      ctx.strokeStyle = dragColor;
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.strokeRect(drag.x * sx + 0.5, drag.y * sy + 0.5, drag.w * sx, drag.h * sy);
      ctx.setLineDash([]);
      ctx.fillStyle = dragColor;
      ctx.fillText(`${drag.w}×${drag.h}`, drag.x * sx + 3 * dpr, (drag.y + drag.h) * sy - 3 * dpr);
    }
  }
}
