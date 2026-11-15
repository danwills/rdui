// Does every imported family (public/vti/families, from lab/vtipack-import.py) import, compile and run?
// For each: Ready import of its header, then each of up to `per` presets' params for `steps` steps
// from the rule's initial pattern at 128²: NaN/Inf counts and whether anything moves.
//   node lab/run.mjs families-check '{"steps":500,"per":3}'
import { importReady } from '../src/ready';
import { makeLab, log } from './lab';

export default async function (cfg: { steps?: number; per?: number; only?: string[] }) {
  const index = await (await fetch('/vti/families/index.json')).json();
  const tally = { ok: 0, nan: 0, still: 0, failed: 0 };
  for (const fam of index.families as { id: string; name: string; count: number }[]) {
    if (cfg.only && !cfg.only.includes(fam.id)) continue;
    const f = await (await fetch(`/vti/families/${fam.id}.json`)).json();
    let imp;
    try {
      imp = await importReady(f.header, `${fam.id}.vti`);
    } catch (e) {
      tally.failed++;
      log(`${fam.id} ${fam.name} (${fam.count}): IMPORT FAILED ${(e as Error).message}`);
      continue;
    }
    const picks = [f.presets.find((p: { md5: string }) => p.md5 === f.representative), ...f.presets].filter((p, i, a) => a.indexOf(p) === i).slice(0, cfg.per ?? 3);
    const res: string[] = [];
    let worst = 'ok';
    for (const p of picks) {
      try {
        const lab = await makeLab(imp.rule, 128, p.params, 'initial');
        const S4 = lab.layout.S * 4, R = imp.rule.reagents.length;
        const before = (await lab.read()).state.slice();
        await lab.run(cfg.steps ?? 500);
        const { state } = await lab.read();
        let bad = 0, moved = 0;
        for (let i = 0; i < 128 * 128; i++) for (let r = 0; r < R; r++) {
          const v = state[i * S4 + r];
          if (!Number.isFinite(v)) bad++;
          else if (Math.abs(v - before[i * S4 + r]) > 1e-4) moved++;
        }
        const tag = bad ? 'nan' : moved < 10 ? 'still' : 'ok';
        if (tag !== 'ok' && worst !== 'nan') worst = tag;
        res.push(`${tag}${bad ? ` ${bad}` : ''}`);
        lab.sim.destroy();
      } catch (e) {
        worst = 'nan';
        res.push(`ERR ${(e as Error).message.slice(0, 80)}`);
      }
    }
    tally[worst as 'ok']++;
    log(`${fam.id} ${fam.name} (${fam.count}) [${imp.rule.reagents.length} chem${imp.warnings.length ? `; ${imp.warnings.length} warn` : ''}]: ${res.join(', ')}`);
  }
  log(`TALLY ${JSON.stringify(tally)}`);
}
