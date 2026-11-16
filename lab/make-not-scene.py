#!/usr/bin/env python3
"""Write the Schrödinger phase NOT scene (scenes/schrodinger-phase-not.json): a phase plate as a NOT gate
for phase-coded bits (0 → phase 0, 1 → phase π), read with the phase XOR crossing.

Each gate: input A (heading east) crosses a reference R (always phase 0, heading −45°) at P, as in the
phase XOR scene (lab/make-xor-scene.py, there turned 22.5°): different phases pass straight through each
other into both side boxes, so both boxes fill exactly when A reads 1. In the bottom row A first crosses a
phase plate: a strip of shallow well (V = PLATE_V, PLATE_L cells, soft edges) across its path, where its
phase turns faster. Measured in lab/nls-phaseplate.ts: V −0.038 over 60 cells turns it half a turn (π),
power unchanged (671 → 671), and it comes out 17.5 cells ahead, so A is launched that much further back.

  python3 lab/make-not-scene.py
"""
import json, math, os

N = 512
DT, DX = 0.018, 0.25
PER = DT / DX ** 2
K = 0.08
D = 170                                # R and (uncompensated) A start distance from P
GAP = 60                               # the plate's far edge, cells before P (R's path must clear it)
PLATE_V, PLATE_L, EDGE = -0.038, 60, 8
AHEAD = 17.5                           # cells the plate puts A ahead
SIDE_A, SIDE_R = 0.0, math.radians(-45)   # pass-through headings (y up)
MERGED = math.radians(-26.4)           # equal phases: merged heading
TAIL = 3500                            # steps from the meeting to the boxes
TRAP_LOSS = 0.08
W = 24

v = K * PER
T_MEET = D / v
T_END = round(T_MEET + TAIL)


def boost(head, phase=0.0):
    return {'kx': round(K * math.cos(head), 5), 'ky': round(-K * math.sin(head), 5), 'phase': phase}


def at(p, head, dist):  # screen point dist cells from p along heading (y up)
    return (p[0] + dist * math.cos(head), p[1] - dist * math.sin(head))


def gate(qx, qy, a, plate):
    p = (qx + 200, qy + 140)
    a0 = at(p, math.pi, D + (AHEAD if plate else 0))
    r0 = at(p, math.radians(135), D)
    st = [{'stamp': 'nls-soliton-0-still', 'x': round(a0[0], 2), 'y': round(a0[1], 2), 'boost': boost(0, math.pi * a)},
          {'stamp': 'nls-soliton-0-still', 'x': round(r0[0], 2), 'y': round(r0[1], 2), 'boost': boost(math.radians(-45))}]
    out = v * TAIL
    sa, sr, sm = at(p, SIDE_A, out), at(p, SIDE_R, out), at(p, MERGED, 0.93 * out)
    reads = 1 - a if plate else a
    label = f'NOT A, A={a}' if plate else f'A={a}'
    probes = [{'name': f'{label} → {reads}: ' + ('both' if reads else 'not both') + ' (A side)', 'x': round(sa[0] - 14), 'y': round(sa[1] - 14), 'w': 28, 'h': 28, 'hold': True, 'round': True},
              {'name': f'{label}: R side', 'x': round(sr[0] - 14), 'y': round(sr[1] - 14), 'w': 28, 'h': 28, 'hold': True, 'round': True}]
    cut = lambda x0, y0, x1, y1, r=W: {'field': 'absorb_d', 'cut': True, 'x': round(x0, 1), 'y': round(y0, 1), 'x2': round(x1, 1), 'y2': round(y1, 1), 'r': r}
    sdf = [{'field': 'trap_d', 'x': round(c[0], 1), 'y': round(c[1], 1), 'r': 14} for c in (sa, sr)]
    sdf += [cut(*a0, *p), cut(*r0, *p)]
    for c in (sa, sr, sm):
        sdf.append(cut(*p, *c))
    for c in (sa, sr):
        sdf.append(cut(*c, *c, 30))
    paint = []
    if plate:
        # the plate across A's path, its far edge GAP cells before P; soft edges ramp the depth
        x1 = p[0] - GAP
        x0 = x1 - PLATE_L - 2 * EDGE
        y0 = round(p[1] - 22)
        for i in range(EDGE):
            vv = round(PLATE_V * (i + 0.5) / EDGE, 5)
            paint.append({'rect': [round(x0) + i, y0, 1, 44], 'values': {'V': vv}})
            paint.append({'rect': [round(x0) + 2 * EDGE + PLATE_L - 1 - i, y0, 1, 44], 'values': {'V': vv}})
        paint.append({'rect': [round(x0) + EDGE, y0, PLATE_L, 44], 'values': {'V': PLATE_V}})
    return st, probes, sdf, paint


stamps, probes, sdf, paint = [], [], [], [{'rect': [0, 0, N, N], 'values': {'absorb_d': -50}}]
for (a, plate), (qx, qy) in zip(((0, True), (1, True)), ((0, 0), (0, 256))):
    s, pr, e, pt = gate(qx, qy, a, plate)
    stamps += s; probes += pr; sdf += e; paint += pt

desc = (f'A NOT gate for bits stored in phase (0 is phase 0, 1 is phase π; the colour shows phase): a phase plate. In each half, '
        f'an input A (from the left; top A=0, bottom A=1) crosses a reference soliton R (from the upper left, always 0) as in the '
        f'phase XOR scene, where different phases pass straight through each other and fill both boxes, so both boxes full reads 1. '
        f'But first A crosses the faint strip across its path: a shallow well in the potential (V {PLATE_V}, {PLATE_L} cells), '
        f'where a soliton\'s phase turns faster than outside. It is just deep enough to add half a turn, π: 0 becomes 1 and 1 becomes '
        f'0, so the top half (A=0) fills both boxes and the bottom (A=1) does not. Nothing else changes: measured in the lab, the '
        f'soliton keeps all its power and comes out {AHEAD} cells ahead (it speeds up in the well), so it starts that much further '
        f'back. It is the optical phase plate, using nothing but how the Schrödinger equation\'s phase answers to the potential. '
        f'The plate ends {GAP} cells before the crossing so R\'s path clears it. Answers by about step {T_END} '
        f'({T_END / 8 / 60:.0f} s at 8 steps per frame); the traps (orange) keep only what arrives near full strength. Try: erase '
        f'the plate (paint V back to 0) and the answers swap.')
scene = {'name': 'Schrödinger phase NOT', 'description': desc, 'rule': 'builtin:8', 'size': N, 'start': 'rest',
         'stepsPerFrame': 8, 'globals': {'trap_loss': TRAP_LOSS}, 'paint': paint, 'stamps': stamps, 'sdf': sdf, 'probes': probes,
         'view': {'reagent': 'n', 'low': 0, 'high': 6, 'tint': 'p', 'tintLow': -3, 'tintHigh': 3}}
out = os.path.join(os.path.dirname(__file__), '..', 'scenes', 'schrodinger-phase-not.json')
with open(out, 'w') as f:
    json.dump(scene, f, indent=2, ensure_ascii=False)
print('wrote', out, f'(meet at step {T_MEET:.0f}, check at {T_END})')
