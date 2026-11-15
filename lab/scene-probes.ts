// Run a scene file as the app loads it (stamps with their boosts, painted rects) and report the
// power inside each of its probe boxes at the given steps, plus every soliton left at the end.
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp } from '../src/stamps';
import type { Scene } from '../src/scenes';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { scene: string; at: number[]; frames?: boolean }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const base = R.BUILTIN_RULES[+sc.rule.split(':')[1]];
  const lab = await makeLab(sc.initial ? { ...base, initial: sc.initial } : base, sc.size!, sc.globals ?? {}, sc.start === 'initial' ? 'initial' : 'rest');
  for (const p of sc.paint ?? []) await lab.paint(p.rect[0], p.rect[1], p.rect[2], p.rect[3], p.values);
  for (const p of sc.stamps ?? []) {
    let st = STARTER_STAMPS.find((s) => s.id === p.stamp)!;
    if (p.boost) st = boostStamp(st, p.boost.phase ?? 0, p.boost.kx, p.boost.ky, 's', 's');
    await lab.place(st, p.x, p.y, { rot: p.rot, flip: p.flip });
  }
  const N = lab.N, S4 = lab.layout.S * 4;
  const I = (st: Float32Array, x: number, y: number) => { const j = ((((y | 0) % N + N) % N) * N + (((x | 0) % N + N) % N)) * S4; return st[j] ** 2 + st[j + 1] ** 2; };
  let t = 0, last: Float32Array | null = null;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    last = state;
    log(`t=${T}  ` + (sc.probes ?? []).map((p) => { let s = 0; for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) s += I(state, x, y); return `${p.name}: ${s.toFixed(0)}`; }).join('  |  '));
    if (cfg.frames) await saveFrame(`${cfg.scene}-${T}.png`, lab, { ri: 2, lo: 0, hi: 6, scale: 1, caption: `t=${T}` });
  }
  const left: string[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = I(last!, x, y); if (v < 1) continue;
    let m = true; for (let dy = -4; dy <= 4 && m; dy++) for (let dx = -4; dx <= 4; dx++) if ((dx || dy) && I(last!, x + dx, y + dy) > v) { m = false; break; }
    if (m) { let p = 0; for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) if (dx * dx + dy * dy <= 144) p += I(last!, x + dx, y + dy); left.push(`(${x},${y}) ${p.toFixed(0)}`); }
  }
  log(`solitons at the end: ${left.join('  ')}`);
}
