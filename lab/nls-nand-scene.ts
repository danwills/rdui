// Run the NAND scene as laid out (scenes/schrodinger-nand.json) and report each output box: the
// power of solitons in it at the end (lab/make-nand-scene.py says when), plus every soliton left.
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp } from '../src/stamps';
import type { Scene } from '../src/scenes';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { at: number[]; frames?: boolean }) {
  const sc: Scene = await (await fetch('/scenes/schrodinger-nand.json')).json();
  const lab = await makeLab(R.SATURABLE_NLS, sc.size!, sc.globals ?? {});
  for (const p of sc.stamps!) {
    const b = p.boost!;
    await lab.place(boostStamp(STARTER_STAMPS.find((s) => s.id === p.stamp)!, b.phase ?? 0, b.kx, b.ky, 's', 's'), p.x, p.y);
  }
  const N = lab.N, S4 = lab.layout.S * 4;
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    const box = sc.probes!.map((p) => {
      let pw = 0;
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) { const j = (((y + N) % N) * N + ((x + N) % N)) * S4; pw += state[j] ** 2 + state[j + 1] ** 2; }
      return `${p.name}: ${pw.toFixed(0)}`;
    });
    log(`t=${t}  ${box.join('  |  ')}`);
    if (cfg.frames) await saveFrame(`nand-scene-${t}.png`, lab, { ri: 2, lo: 0, hi: 6, scale: 1, caption: `t=${t}` });
  }
}
