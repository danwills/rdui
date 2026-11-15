// The soliton stamp for the Saturable Schrödinger rule (stamps/nls-solitons.json): relax a Gaussian
// into a true soliton (absorbing border takes the radiation it sheds), capture it at phase 0, and
// save it flagged variants: 'soliton', which the app expands into every phase and heading
// (solitonVariants in src/stamps.ts). Checks the derived phase-0 stamps' velocities.
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp, stampToJSON } from '../src/stamps';
import { makeLab, capture, log } from './lab';

const N = 256, W = 56;
const sponge = (g: number, w: number): R.Overlay[] => [[0, 0, 1, w], [0, 1 - w, 1, 1], [0, 0, w, 1], [1 - w, 0, 1, 1]].map(([x0, y0, x1, y1]) =>
  ({ chem: 'gamma', op: 'overwrite', fill: { type: 'constant', value: g }, shape: { type: 'rectangle', x0, y0, x1, y1 } }) as R.Overlay);

function centroid(state: Float32Array, n: number, S4: number) {
  let m = 0, mx = 0, my = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const j = (y * n + x) * S4, I = state[j] ** 2 + state[j + 1] ** 2; m += I; mx += I * x; my += I * y; }
  return { x: mx / m, y: my / m, m };
}

export default async function () {
  const packet = (part: 'cos' | 'sin'): R.Overlay => ({ chem: part === 'cos' ? 'p' : 'q', op: 'add', fill: { type: 'packet', amp: 2.2, sigma: 7, kx: 0, ky: 0, part }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 0.1 } } as R.Overlay);
  const initial = [...sponge(0.02, 0.1), ...sponge(0.08, 0.06), ...sponge(0.3, 0.03), packet('cos'), packet('sin')];
  const lab = await makeLab({ ...R.SATURABLE_NLS, initial }, N, {}, 'initial');
  const S4 = lab.layout.S * 4;
  await lab.run(6000);
  const c = centroid((await lab.read()).state, N, S4);
  log(`relaxed soliton at (${c.x.toFixed(2)}, ${c.y.toFixed(2)}), power ${c.m.toFixed(1)}`);
  const base = await capture(lab, c.x + 0.5, c.y + 0.5, W, W, 'x', 'x', 0.15);
  // centre phase → 0, and clear the captured params (stamps place chemistry; params only if asked)
  const ci = ((W / 2) * W + W / 2) * S4;
  const th0 = Math.atan2(base.state[ci + 1], base.state[ci]);
  base.params.fill(0);

  const still = boostStamp(base, -th0, 0, 0, 'nls-soliton', 'still · phase 0');
  // check the app's derived stamps (STARTER_STAMPS expands the saved base into every phase and heading)
  const derived = STARTER_STAMPS.filter((s) => s.id.startsWith('nls-soliton-0-'));
  for (const s of derived.length ? derived : [still]) {
    const v = await makeLab(R.SATURABLE_NLS, N);
    await v.place(s, N / 2, N / 2);
    const a = centroid((await v.read()).state, N, S4);
    await v.run(1000);
    const b = centroid((await v.read()).state, N, S4);
    log(`${s.name}: moved (${(b.x - a.x).toFixed(1)}, ${(b.y - a.y).toFixed(1)}) in 1000 steps, power ${a.m.toFixed(0)} → ${b.m.toFixed(0)}`);
  }
  await window.__saveText('nls-solitons.json', JSON.stringify([{ ...stampToJSON(still), variants: 'soliton' }]));
}
