// Runs a scene and prints reagents along a row: node lab/run.mjs _row '{"scene":"...","at":40000,"y":476,"x":[470,511,4],"show":[...]}'
import * as R from '../src/rule';
import { makeLab, log } from './lab';
const scenes = import.meta.glob('../scenes/*.json', { eager: true, import: 'default' }) as Record<string, any>;
export default async function (cfg: { scene: string; at: number; y: number; x: [number, number, number]; show: string[] }) {
  const scene = scenes[`../scenes/${cfg.scene}.json`];
  const W = scene.size, base = R.BUILTIN_RULES[+scene.rule.split(':')[1]];
  const lab = await makeLab({ ...base, initial: scene.initial as R.Overlay[] }, W, { ...scene.globals }, 'initial');
  await lab.run(cfg.at);
  const { state } = await lab.read();
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  log('x    ' + cfg.show.map((r) => r.padStart(8)).join(''));
  for (let x = cfg.x[0]; x <= cfg.x[1]; x += cfg.x[2]) {
    const c = ((cfg.y * W + ((x + W) % W)) * S4);
    log(String(x).padEnd(5) + cfg.show.map((r) => state[c + ix(r)].toFixed(3).padStart(8)).join(''));
  }
}
