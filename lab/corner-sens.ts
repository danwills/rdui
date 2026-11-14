// How a single corner (A line3 @aAng, B line3 @bAng at A + B_REL + bShift)
// maps input errors to output errors: a relaxed glider (captured travelling
// at 90°, rotated to head east) comes in on lane y = A.y + lane, shifted
// sideways by `lat` and along by `along`; we fit the exit line's x at
// y = A + 300 and its heading. A self-correcting corner has spread(out) <
// spread(in).
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampFromJSON, stampToJSON } from '../src/stamps';
type StampJSON = ReturnType<typeof stampToJSON>;
import { makeLab, runAll, blobs, log, STARTERS, HW_STD, type Lab } from './lab';
import { clusterPts } from './reflect-ring';

export default async function (cfg: { aAng?: number; bAng?: number; aShape?: string; bShape?: string; bShift?: [number, number]; lane?: number; lats?: number[]; alongs?: number[]; rot?: number; N?: number; steps?: number; tag?: string; round?: boolean }) {
  const N = cfg.N ?? 640, A = [160, 160];
  const relaxed = stampFromJSON(((await (await fetch('/lab/fixtures/relaxed-glider-hw.json')).json()) as StampJSON[])[0]);
  const B = [A[0] + 123.1 + (cfg.bShift?.[0] ?? 0), A[1] + 156.2 + (cfg.bShift?.[1] ?? 0)];
  // `round`: every soliton on a whole pixel, so 90° rotated copies are exact
  const pts = [
    ...clusterPts(cfg.aShape ?? 'line3', cfg.aAng ?? 30).map(([x, y]) => [A[0] + x, A[1] + y]),
    ...clusterPts(cfg.bShape ?? 'line3', cfg.bAng ?? 72).map(([x, y]) => [B[0] + x, B[1] + y]),
  ].map(([x, y]) => (cfg.round ? [Math.round(x), Math.round(y)] : [x, y]));
  const jobs = (cfg.lats ?? [-1, -0.5, 0, 0.5, 1]).flatMap((lat) => (cfg.alongs ?? [0, 1, 2, 3]).map((along) => ({ lat, along })));
  const runs: { lat: number; along: number; lab: Lab; trail: number[][] }[] = [];
  for (const j of jobs) {
    const l = await makeLab(GS_HISTORY_WAVE, N, HW_STD);
    for (const [x, y] of pts) await l.place(STARTERS('starter-soliton-hw65'), x, y);
    runs.push({ ...j, lab: l, trail: [] });
  }
  await runAll(runs.map((r) => r.lab), 4000);
  const x0 = A[0] + Math.min(...clusterPts(cfg.aShape ?? 'line3', cfg.aAng ?? 30).map((p) => p[0])) - 140;
  for (const r of runs) await r.lab.place(relaxed, x0 - r.along, A[1] + (cfg.lane ?? -4) + r.lat, { rot: cfg.rot ?? 3 });
  for (let t = 2000; t <= (cfg.steps ?? 56000); t += 2000) {
    await runAll(runs.map((r) => r.lab), 2000);
    for (const r of runs) {
      const g = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).filter((b) => !pts.some(([x, y]) => Math.hypot(b.x - x, b.y - y) < 6));
      if (g.length === 1) r.trail.push([t, g[0].x, g[0].y]);
    }
  }
  const out = [];
  for (const r of runs) {
    const tr = r.trail;
    const first = tr[0] ? `start heading ${((Math.atan2(tr[1][2] - tr[0][2], tr[1][1] - tr[0][1]) * 180) / Math.PI).toFixed(0)}°` : 'no glider';
    const far = tr.filter(([, , y]) => y > A[1] + 230 && y < N - 30);
    let res = `${first}; no exit (last ${tr.at(-1)?.slice(1).map((v) => v.toFixed(0)).join(',') ?? '-'})`;
    let xAt: number | null = null, head: number | null = null;
    if (far.length >= 3) {
      const my = far.reduce((m, p) => m + p[2], 0) / far.length, mx = far.reduce((m, p) => m + p[1], 0) / far.length;
      const b = far.reduce((m, p) => m + (p[2] - my) * (p[1] - mx), 0) / far.reduce((m, p) => m + (p[2] - my) ** 2, 0);
      xAt = mx + b * (A[1] + 300 - my) - A[0]; head = 90 - (Math.atan(b) * 180) / Math.PI;
      res = `exit x(A+300) = A+${xAt.toFixed(2)}, heading ${head.toFixed(2)}°`;
    }
    log(`${cfg.tag ?? ''} lat ${r.lat >= 0 ? '+' : ''}${r.lat} along ${r.along}: ${res}`);
    out.push({ lat: r.lat, along: r.along, xAt, head });
    r.lab.sim.destroy();
  }
  const ok = out.filter((o) => o.xAt !== null);
  if (ok.length) {
    const xs = ok.map((o) => o.xAt!), hs = ok.map((o) => o.head!);
    log(`${cfg.tag ?? ''} SUMMARY: ${ok.length}/${out.length} exit; x spread ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} px (mean ${(xs.reduce((a, b) => a + b) / xs.length).toFixed(2)}), heading ${Math.min(...hs).toFixed(2)}–${Math.max(...hs).toFixed(2)}°`);
  } else log(`${cfg.tag ?? ''} SUMMARY: 0/${out.length} exit`);
  return out;
}
