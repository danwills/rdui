import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
/** Bubbles (phi > 0.5, wrapping) as {x, y (down), area, m, px, py} summed over each. */
export function blobs(state: Float32Array, S4: number, W: number, H: number, ix: (r: string) => number) {
  const lab = new Int32Array(W * H).fill(-1), out: { x: number; y: number; area: number; m: number; px: number; py: number }[] = [];
  const phi = ix('phi');
  for (let s = 0; s < W * H; s++) {
    if (lab[s] >= 0 || state[s * S4 + phi] < 0.5) continue;
    const id = out.length, st = [s]; lab[s] = id;
    let n = 0, sx = 0, sy = 0, m = 0, px = 0, py = 0; const x0 = s % W, y0 = (s / W) | 0;
    while (st.length) {
      const c = st.pop()!, x = c % W, y = (c / W) | 0;
      let dx = x - x0, dy = y - y0; if (dx > W / 2) dx -= W; if (dx < -W / 2) dx += W; if (dy > H / 2) dy -= H; if (dy < -H / 2) dy += H;
      n++; sx += dx; sy += dy;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = ((y + ay + H) % H) * W + ((x + ax + W) % W);
        if (lab[q] < 0 && state[q * S4 + phi] >= 0.5) { lab[q] = id; st.push(q); }
      }
    }
    // content and momentum summed over the bubble and its edge (phi > 0.05 near it): use phi-weighted sums over labelled cells
    for (let q = 0; q < W * H; q++) if (lab[q] === id) { m += state[q * S4 + ix('m')]; px += (ix('px') >= 0 ? state[q * S4 + ix('px')] : 0); py += (ix('py') >= 0 ? state[q * S4 + ix('py')] : 0); }
    out.push({ x: (x0 + sx / n + W) % W, y: (y0 + sy / n + H) % H, area: n, m, px, py });
  }
  return out;
}
export default async function (cfg: { rule?: number; set?: Record<string, number>; at: number[]; size?: number; name?: string }) {
  const W = cfg.size ?? 256;
  const r = R.BUILTIN_RULES[cfg.rule ?? 40];
  const rr = cfg.rule === 31 ? { ...r, initial: R.MOMENTUM_BUBBLES.initial.filter((o) => ['phi', 'm', 'u'].includes(o.chem)) } : r;
  const lab = await makeLab(rr, W, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    const b = blobs(state, S4, W, W, ix);
    log(`t=${T} ` + b.map((o) => `(${o.x.toFixed(1)},${o.y.toFixed(1)} A${o.area} m${o.m.toFixed(0)} p${o.px.toFixed(1)},${o.py.toFixed(1)})`).join(' '));
    if (cfg.name) await saveFrame(`${cfg.name}-${T}.png`, lab, { ri: ix('phi'), lo: 0, hi: 1, ti: Math.max(0, ix('px')), tlo: -0.06, thi: 0.06, scale: 2, caption: `${cfg.name} t=${T}` });
  }
}
