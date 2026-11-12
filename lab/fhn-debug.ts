import { FHN3 } from '../src/rule';
import { makeLab, seedDisk, log } from './lab';
export default async function (cfg: Record<string, number>) {
  const N = 96, c = 48;
  const l = await makeLab(FHN3, N, cfg);
  log('rest', l.rule.rest, 'globals', JSON.stringify(l.globals));
  await seedDisk(l, c, c, 8, { u: 1 });
  for (let t = 0; t <= 8000; t += 1000) {
    if (t) await l.run(1000);
    const { state } = await l.read();
    const at = (x: number, y: number) => Array.from(state.slice((y * N + x) * 4, (y * N + x) * 4 + 3)).map((v) => v.toFixed(3)).join(',');
    log(`t=${t} centre ${at(c, c)}  edge ${at(c + 7, c)}  bg ${at(2, 2)}`);
  }
}
