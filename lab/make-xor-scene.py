#!/usr/bin/env python3
"""Write the Schrödinger phase XOR scene (scenes/schrodinger-phase-xor.json): four soliton XOR gates
in a 2×2 grid, one per input pair (00, 01 / 10, 11), the bits stored in phase (0 → phase 0, 1 → π).

Each gate (measured in lab/nls-crossing.ts, angle 45°, k 0.08): A (heading +22.5°) and B (−22.5°) meet at P.
  Same phase (equal bits): they merge into one soliton (~1180) going on at about −4°, 0.93× the speed.
  Opposite phase (different bits): they pass through each other unchanged (~670 each, ±22.4°).
  The same with the inputs started 220 cells back. Not with one input 300 steps (7 cells) late: the
  inputs must arrive together. (The 10° slow crossing first tried was an artefact: its inputs started 17
  cells apart and interacted from birth.)
So the side boxes get solitons exactly when the bits differ: XOR. Nothing else in the field acts.
Units: timestep 0.018, dx 0.25, so a soliton moves k·0.288 cells per step.

  python3 lab/make-xor-scene.py [--bare]   (--bare: no traps, boxes or absorbing field, to measure paths)
"""
import json, math, os, sys

N = 512
DT, DX = 0.018, 0.25
PER = DT / DX ** 2
H = math.radians(22.5)                 # input half-angle
K = 0.08
D = 110                                # A/B start distance from P
OUT = math.radians(22.4)               # measured pass-through heading
SAME = math.radians(-3.9)              # merged heading (y up)
SAME_SPEED, SIDE_SPEED = 0.93, 1.0     # fractions of the input speed
TAIL = 4300                            # steps after the meeting until the outputs reach their boxes
TRAP_LOSS = 0.08                       # traps keep only what arrives near full strength (see the description)
W = 24                                 # corridor half-width
BARE = '--bare' in sys.argv

v = K * PER
T_MEET = D / v
T_END = round(T_MEET + TAIL)


def boost(head, k, phase=0.0):
    return {'kx': round(k * math.cos(head), 5), 'ky': round(-k * math.sin(head), 5), 'phase': phase}


def gate(qx, qy, a, b):
    p = (qx + 115, qy + 128)
    st = [
        {'stamp': 'nls-soliton-0-still', 'x': round(p[0] - D * math.cos(H), 2), 'y': round(p[1] + D * math.sin(H), 2), 'boost': boost(H, K, math.pi * a)},
        {'stamp': 'nls-soliton-0-still', 'x': round(p[0] - D * math.cos(H), 2), 'y': round(p[1] - D * math.sin(H), 2), 'boost': boost(-H, K, math.pi * b)},
    ]
    if BARE: return st, [], [], p
    same = (p[0] + SAME_SPEED * v * TAIL * math.cos(SAME), p[1] - SAME_SPEED * v * TAIL * math.sin(SAME))
    up = (p[0] + SIDE_SPEED * v * TAIL * math.cos(OUT), p[1] - SIDE_SPEED * v * TAIL * math.sin(OUT))
    down = (up[0], 2 * p[1] - up[1])
    x = 1 if a != b else 0
    probes = [
        {'name': f'A={a} B={b}: merged', 'x': round(same[0] - 16), 'y': round(same[1] - 16), 'w': 32, 'h': 32, 'hold': True, 'round': True},
        {'name': f'A={a} B={b} ↑ (A⊕B={x}: {"both" if x else "not both"})', 'x': round(up[0] - 14), 'y': round(up[1] - 14), 'w': 28, 'h': 28, 'hold': True, 'round': True},
        {'name': f'A={a} B={b} ↓', 'x': round(down[0] - 14), 'y': round(down[1] - 14), 'w': 28, 'h': 28, 'hold': True, 'round': True},
    ]
    cut = lambda x0, y0, x1, y1, r=W: {'field': 'absorb_d', 'cut': True, 'x': round(x0, 1), 'y': round(y0, 1), 'x2': round(x1, 1), 'y2': round(y1, 1), 'r': r}
    sdf = [{'field': 'trap_d', 'x': round(c[0], 1), 'y': round(c[1], 1), 'r': 14} for c in (same, up, down)]
    for sgn in (1, -1):
        sdf.append(cut(p[0] - D * math.cos(H), p[1] + sgn * D * math.sin(H), *p))
    for c in (same, up, down):
        sdf.append(cut(*p, *c))
        sdf.append(cut(*c, *c, 30))
    return st, probes, sdf, p


stamps, probes, sdf = [], [], []
for (a, b), (qx, qy) in zip(((0, 0), (0, 1), (1, 0), (1, 1)), ((0, 0), (256, 0), (0, 256), (256, 256))):
    s, pr, e, _ = gate(qx, qy, a, b)
    stamps += s
    probes += pr
    sdf += e

desc = (f'Four XOR gates where a bit is a soliton\'s phase, not whether it is there: 0 is phase 0, 1 is phase π (the colour shows phase). '
        f'One gate per input pair (top left A=0 B=0, top right 0 1, bottom left 1 0, bottom right 1 1). In each, A (from lower left) '
        f'and B (upper left) come in on paths 45° apart and cross. Different bits pass straight through each other, unchanged, '
        f'into the two side boxes: the output is 1 when both side boxes hold a soliton. Equal bits attract: here they merge into one '
        f'heavy soliton that goes on into the middle box. Measured in the lab, opposite phases pass through cleanly whatever the speed '
        f'and with the nonlinearity changed ±2%, but the merge is fickle: change the nonlinearity by 1% (as a phone\'s GPU nearly '
        f'can) and an equal pair may instead split unevenly, a big piece into the lower box and a small one towards the upper. So '
        f'the reading is both-or-not: only a clean pass-through fills both. The traps (orange) are set to keep only what arrives '
        f'near full strength (trap_loss {TRAP_LOSS}, up from 0.02) and park it there; a fragment fades. Everything off the gates\' '
        f'paths absorbs (red). The inputs must arrive together, within about a cell, as in any billiard-ball logic. '
        f'Answers by about step {T_END} ({T_END / 8 / 60:.0f} s at 8 steps per frame). Try: change g a little in the rule and run it '
        f'again, or pause at the start and erase an input to see a lone soliton go by.')
scene = {'name': 'Schrödinger phase XOR' + (' (bare)' if BARE else ''), 'description': desc, 'rule': 'builtin:8', 'size': N, 'start': 'rest',
         'stepsPerFrame': 8, 'globals': {'trap_loss': TRAP_LOSS}, 'stamps': stamps, 'probes': probes, 'sdf': sdf,
         'view': {'reagent': 'n', 'low': 0, 'high': 6, 'tint': 'p', 'tintLow': -3, 'tintHigh': 3}}
if not BARE: scene['paint'] = [{'rect': [0, 0, N, N], 'values': {'absorb_d': -50}}]
out = os.path.join(os.path.dirname(__file__), '..', 'scenes', 'schrodinger-phase-xor' + ('-bare' if BARE else '') + '.json')
with open(out, 'w') as f:
    json.dump(scene, f, indent=2, ensure_ascii=False)
print('wrote', out, f'(meet at step {T_MEET:.0f}, check at {T_END})')
