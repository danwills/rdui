// metaGrayScott: convert Dan's raw Ready parameters to META_GS's meta controls.
// Raw, per field X (source weights bToX, diffToX; effect XEffect; decay XDecay; diffusion D_X):
//   x ← D_X·∇²x + (1 − XDecay·decayAmp)·x + timestep·ctrlAmp·(diffToX·(1−a−b) + bToX·b),
//   param offset = XEffect·x.
// As a moving average of the offset itself: mem = 1/(XDecay·decayAmp),
// gain = XEffect·timestep·ctrlAmp·bToX·mem, diff = diffToX/bToX, reach = √(D_X·mem).
const RAW = [
  { X: 'F', eff: 'fEffect', decay: 'fDecay', D: 'D_F', b: 'bToF', d: 'diffToF' },
  { X: 'k', eff: 'kEffect', decay: 'kDecay', D: 'D_k', b: 'bToK', d: 'diffToK' },
  { X: 'Da', eff: 'daEffect', decay: 'daDecay', D: 'D_Da', b: 'bToDa', d: 'diffToDa' },
  { X: 'Db', eff: 'dbEffect', decay: 'dbDecay', D: 'D_Db', b: 'bToDb', d: 'diffToDb' },
];

export function metaFromRaw(r: Record<string, number>) {
  const out: Record<string, number> = { timestep: r.timestep, D_a: r.D_a, D_b: r.D_b, F: r.F, k: r.k };
  for (const f of RAW) {
    const mem = 1 / (r[f.decay] * r.decayAmp);
    out[`${f.X}_mem`] = mem;
    out[`${f.X}_gain`] = r[f.eff] * r.timestep * r.ctrlAmp * r[f.b] * mem;
    out[`${f.X}_diff`] = r[f.d] / r[f.b];
    out[`${f.X}_reach`] = Math.sqrt(r[f.D] * mem);
  }
  // x ← x^powF in raw units (x = dF/fEffect): extra forgetting, zero at |dF| = |fEffect|
  out.F_forget = (r.powF ?? 1) - 1;
  out.F_ref = Math.abs(r.fEffect);
  return out;
}
