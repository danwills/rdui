#!/usr/bin/env python3
"""Plan a two-gate soliton chain, AND = NOT(NAND(A, B)), in a periodic N×N field by straight-line
kinematics, and search for the layout with the most clearance between solitons not meant to meet.

Gate 1 (NAND): A (+15°) and B (−15°) merge at P1 into M (heading 0°, speed 0.96v); clock C1 (heading
H1) crosses M's path at P2 = P1 + (L, 0), arriving EARLY steps before M. M swallows C1; otherwise C1
carries on: that's x, gate 1's output.
Gate 2 (NOT): clock C2 (heading H1 ± 30°) meets x at P3 = P2 + s·(heading H1), in phase; they merge
into a heavy soliton (bisector, 0.96v) and C2's own path stays empty. With no x, C2 reaches the output.
All light solitons move at v; every soliton starts at t = 0.

The clearance check covers each case's actual paths until the output time; meetings that are meant
to happen (A–B at P1, M–C1 at P2, x–C2 at P3) and anything after them are left out; the blob from
M swallowing C1 (case 11) is followed as a slow heavy soliton with their summed momentum.

  python3 lab/plan-and-chain.py [seed]     prints the best layout as JSON
"""
import json, math, random, sys

N = 512
PER = 0.018 / 0.25 ** 2
K = 0.08
V = K * PER                 # cells per step
VM = 0.96 * V               # merged soliton
H = math.radians(15)
D_AB = 66                   # A/B start distance from P1
EARLY = 300
TAIL = 7000                 # output check this long after gate 2 (the merged soliton leaves only 15° off C2's path)
CLEAR = 45


def wrapd(ax, ay, bx, by):
    dx = (ax - bx + N / 2) % N - N / 2
    dy = (ay - by + N / 2) % N - N / 2
    return math.hypot(dx, dy)


def unit(deg):
    # heading anticlockwise from east, y up -> screen (y down)
    r = math.radians(deg)
    return math.cos(r), -math.sin(r)


def layout(p1x, p1y, L, s, h1, side):
    """Positions and timings; side = +1 or −1 picks C2's heading h1 + side·30."""
    h2 = h1 + side * 30
    P1 = (p1x, p1y)
    P2 = (p1x + L, p1y)
    T1 = D_AB / V
    T2 = T1 + L / VM                         # M reaches P2
    tc1 = T2 - EARLY                         # C1 reaches P2
    u1 = unit(h1)
    C1 = (P2[0] - u1[0] * V * tc1, P2[1] - u1[1] * V * tc1)
    P3 = (P2[0] + u1[0] * s, P2[1] + u1[1] * s)
    T3 = tc1 + s / V                         # x reaches P3
    u2 = unit(h2)
    C2 = (P3[0] - u2[0] * V * T3, P3[1] - u2[1] * V * T3)
    A = (P1[0] - D_AB * math.cos(H), P1[1] + D_AB * math.sin(H))
    B = (P1[0] - D_AB * math.cos(H), P1[1] - D_AB * math.sin(H))
    Tend = T3 + TAIL
    out = (P3[0] + u2[0] * V * TAIL, P3[1] + u2[1] * V * TAIL)
    return dict(P1=P1, P2=P2, P3=P3, T1=T1, T2=T2, tc1=tc1, T3=T3, Tend=Tend, A=A, B=B, C1=C1, C2=C2,
                h1=h1, h2=h2, out=out, L=L, s=s)


def paths(g, a, b):
    """Each soliton's position as a function of t for one case (None once it's gone / merged)."""
    uA, uB, u1, u2 = unit(15), unit(-15), unit(g['h1']), unit(g['h2'])
    P = {}
    lin = lambda o, u, v, t0=0: (lambda t: (o[0] + u[0] * v * (t - t0), o[1] + u[1] * v * (t - t0)))
    if a: P['A'] = (lin(g['A'], uA, V), 0, g['T1'] if b else 1e9)
    if b: P['B'] = (lin(g['B'], uB, V), 0, g['T1'] if a else 1e9)
    if a and b:
        P['M'] = (lin(g['P1'], (1, 0), VM, g['T1']), g['T1'], g['T2'])
        # M swallowing C1 (clean only for C1 at 40–45°, lab/nls-nand.ts): measured heading 16° at M's speed
        um = unit(16)
        P['MC'] = (lin(g['P2'], um, VM, g['T2']), g['T2'] + 600, 1e9)
        P['C1'] = (lin(g['C1'], u1, V), 0, g['tc1'])
        P['C2'] = (lin(g['C2'], u2, V), 0, 1e9)
    else:
        P['C1'] = (lin(g['C1'], u1, V), 0, g['T3'])        # merges with C2 at P3
        P['C2'] = (lin(g['C2'], u2, V), 0, g['T3'])
        bis = math.radians((g['h1'] + g['h2']) / 2)
        P['X'] = (lin(g['P3'], (math.cos(bis), -math.sin(bis)), VM, g['T3']), g['T3'] + 600, 1e9)
    return P


MEANT = {('A', 'B'), ('C1', 'M'), ('C1', 'C2'), ('C1', 'MC'), ('M', 'MC'), ('C2', 'X'), ('C1', 'X')}


def clearance(g):
    worst = (1e9, '')
    for a, b in ((0, 0), (0, 1), (1, 0), (1, 1)):
        P = paths(g, a, b)
        names = sorted(P)
        for t in range(0, int(g['Tend']) + 1, 100):
            live = {n: P[n][0](t) for n in names if P[n][1] <= t <= P[n][2]}
            for i, n in enumerate(names):
                for m in names[i + 1:]:
                    if n in live and m in live and (n, m) not in MEANT and (m, n) not in MEANT:
                        d = wrapd(*live[n], *live[m])
                        if d < worst[0]: worst = (d, f'{a}{b} {n}-{m} t={t}')
            # the output box must stay clear of everything but C2 (case 11)
            for n, pos in live.items():
                if n != 'C2' and t > g['Tend'] - 1500:
                    d = wrapd(*pos, *g['out'])
                    if d < worst[0]: worst = (d, f'{a}{b} {n} near output t={t}')
    return worst


if __name__ == '__main__':
    random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
    best = None
    for _ in range(3000):
        # C1 at 42.5°: the middle of the clean-swallow window
        g = layout(random.uniform(0, N), random.uniform(0, N), random.uniform(160, 260), random.uniform(80, 220),
                   42.5, random.choice([1, -1]))
        c = clearance(g)
        if not best or c[0] > best[0][0]: best = (c, g)
    c, g = best
    print(f'clearance {c[0]:.1f} cells (tightest: {c[1]})', file=sys.stderr)
    print(json.dumps({k: (round(v, 2) if isinstance(v, float) else [round(x, 2) for x in v] if isinstance(v, tuple) else v) for k, v in g.items()}))
