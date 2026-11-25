// Probes Lightning 6's nucleation band: node lab/run.mjs _probe6 '{"at":23000}'
import * as R from '../src/rule';
import { makeLab, log } from './lab';
const scenes = import.meta.glob('../scenes/*.json', { eager: true, import: 'default' }) as Record<string, any>;
export default async function (cfg: { at: number; set?: Record<string, number> }) {
  const scene = scenes['../scenes/lightning-6.json'];
  const W = scene.size, base = R.BUILTIN_RULES[+scene.rule.split(':')[1]];
  const lab = await makeLab({ ...base, initial: scene.initial as R.Overlay[] }, W, { ...scene.globals, ...cfg.set }, 'initial');
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  await lab.run(cfg.at);
  const { state } = await lab.read();
  const g = (r: string, x: number, y: number) => state[(y * W + x) * S4 + ix(r)];
  const ph = (cfg.set?.noise_rate ?? 0.0005) * cfg.at;
  let best = { v: -1, x: 0, y: 0 };
  for (let y = 0; y < 40; y++) for (let x = 0; x < W; x++) {
    const wt = 0.5 + (g('w', x, y) - 0.5) * Math.cos(ph) + (g('w2', x, y) - 0.5) * Math.sin(ph);
    if (g('cloud', x, y) > 0.05 && g('cloud', x, y) < 0.4 && wt > best.v) best = { v: wt, x, y };
  }
  log(`best wt ${best.v.toFixed(4)} at (${best.x},${best.y})`);
  let bb = { v: -1, x: 0, y: 0 }, cc = { v: -1, x: 0, y: 0 }, wmx = { v: -1, x: 0, y: 0 };
  for (let y = 0; y < 40; y++) for (let x = 0; x < W; x++) {
    if (g('b', x, y) > bb.v) bb = { v: g('b', x, y), x, y };
    if (g('c', x, y) > cc.v) cc = { v: g('c', x, y), x, y };
    if (g('wm', x, y) > wmx.v) wmx = { v: g('wm', x, y), x, y };
  }
  log(`max b ${bb.v.toFixed(3)} at (${bb.x},${bb.y}); max c ${cc.v.toFixed(3)} at (${cc.x},${cc.y}); max wm ${wmx.v.toFixed(4)} at (${wmx.x},${wmx.y})`);
  const row: string[] = [];
  for (let x = 0; x < W; x += 16) row.push((0.5 + (g('w', x, 13) - 0.5) * Math.cos(ph) + (g('w2', x, 13) - 0.5) * Math.sin(ph)).toFixed(2));
  log('wt along row 13 every 16: ' + row.join(' '));
  for (let y = 0; y < 0; y++) {
    const x = best.x;
    log(`y ${y} cloud ${g('cloud', x, y).toFixed(3)} V ${g('V', x, y).toFixed(3)} wm ${g('wm', x, y).toFixed(4)} charge ${g('charge', x, y).toFixed(3)} c ${g('c', x, y).toFixed(3)} a ${g('a', x, y).toFixed(3)} b ${g('b', x, y).toFixed(3)} busy ${g('busy', x, y).toFixed(3)}`);
  }
}
