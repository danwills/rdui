import { ProbeSet, type Probe, type Rect } from './probes';

const PROBE_COLORS = ['#ffcc66', '#66d9ff', '#ff7ab6', '#9dff7a', '#c79bff', '#ff9a5c', '#5cffd6', '#f2f2f2'];

export function probeColor(p: { id: number }) {
  return PROBE_COLORS[(p.id - 1) % PROBE_COLORS.length];
}

/** A line or circle being dragged out with a painting tool (grid cells; r = the brush radius). */
export interface ShapePreview {
  kind: 'line' | 'circle';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
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

  draw(gridW: number, gridH: number, probes: Probe[], reagent: number, drag: Rect | null, dragColor: string, ghost: Ghost | null, shape: ShapePreview | null = null) {
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
      if (p.round) {
        ctx.beginPath();
        ctx.ellipse((p.x + p.w / 2) * sx, (p.y + p.h / 2) * sy, (p.w / 2) * sx, (p.h / 2) * sy, 0, 0, 2 * Math.PI);
        ctx.stroke();
      } else ctx.strokeRect(p.x * sx + 0.5, p.y * sy + 0.5, p.w * sx, p.h * sy);
      // the label stays inside the field (shifted left if it would run off the right), and goes onto two
      // lines, name and value, when it's wider than its box and a quarter of the field (so neighbours don't overlap)
      const value = `${p.hold ? 'held ' : ''}${ProbeSet.reading(p, reagent).toFixed(3)}`;
      const one = `${p.name} ${value}`;
      const lines = ctx.measureText(one).width <= Math.max(p.w * sx, canvas.width / 4) ? [one] : [p.name, value];
      const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const lh = 13 * dpr, bh = lh * lines.length;
      const top = p.y * sy > bh + 2 * dpr ? p.y * sy - 2 * dpr - bh : (p.y + p.h) * sy + 2 * dpr;
      const lx = Math.max(0, Math.min(p.x * sx, canvas.width - tw - 6 * dpr));
      ctx.fillStyle = '#000a';
      ctx.fillRect(lx, top, tw + 6 * dpr, bh);
      ctx.fillStyle = c;
      lines.forEach((l, i) => ctx.fillText(l, lx + 3 * dpr, top + lh * (i + 1) - 3 * dpr));
    }

    if (shape) {
      // the band the brush will cover, and the path it follows
      const path = () => {
        ctx.beginPath();
        if (shape.kind === 'line') {
          ctx.moveTo(shape.x0 * sx, shape.y0 * sy);
          ctx.lineTo(shape.x1 * sx, shape.y1 * sy);
        } else {
          const R = Math.hypot(shape.x1 - shape.x0, shape.y1 - shape.y0);
          ctx.ellipse(shape.x0 * sx, shape.y0 * sy, R * sx, R * sy, 0, 0, 2 * Math.PI);
        }
      };
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffffff33';
      ctx.lineWidth = 2 * shape.r * sx;
      path();
      ctx.stroke();
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      path();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
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
