#!/usr/bin/env python3
"""Write the Schrödinger NOT chain scene (scenes/schrodinger-not-chain.json): two soliton NOT gates in a
row, so gate 1's output drives gate 2, wall-free; A = 1 in the top half, A = 0 in the bottom half.

  Gate 1: input A (heading 0°) and clock C1 (heading 30°) start the same distance D from P, so they
          arrive in phase: with A they merge (one heavy soliton heading 15°); without, C1 carries on
          at 30°: that's NOT A.
  Gate 2: NOT A meets clock C2 (heading 0°) at Q, S cells on along its path; C2 starts D + S from Q,
          so they arrive in phase: with NOT A they merge; without, C2 reaches the output box.
          Output = NOT(NOT A) = A.
Merges need the two solitons within ~4° of phase (lab notes); equal travel times give that.
Checked with lab/scene-probes.ts.

  python3 lab/make-not-chain-scene.py
"""
import json, math, os

N = 512
PER = 0.018 / 0.25 ** 2
K = 0.08
V = K * PER                 # cells per step
D, S = 50, 220              # start distance from each meeting point; P to Q
TAIL = 100                  # cells C2 goes past Q before the output box


def boost(deg, phase=0.0):
    r = math.radians(deg)
    return {'kx': round(K * math.cos(r), 5), 'ky': round(-K * math.sin(r), 5), 'phase': phase}


def at(o, deg, dist):
    r = math.radians(deg)
    return (o[0] + dist * math.cos(r), o[1] - dist * math.sin(r))


def sol(p, deg):
    return {'stamp': 'nls-soliton-0-still', 'x': round(p[0], 2), 'y': round(p[1], 2), 'boost': boost(deg)}


stamps, probes = [], []
for a, oy in ((1, 0), (0, 256)):
    P = (115, oy + 190)
    Q = at(P, 30, S)
    if a: stamps.append(sol(at(P, 180, D), 0))                 # A, heading east
    stamps.append(sol(at(P, 210, D), 30))                      # C1, from the lower left
    stamps.append(sol(at(Q, 180, D + S), 0))                   # C2, from the left
    mid = at(P, 30, S / 2)
    out = at(Q, 0, TAIL)
    probes.append({'name': f'NOT A = {1 - a}', 'x': round(mid[0] - 14), 'y': round(mid[1] - 14), 'w': 28, 'h': 28})
    probes.append({'name': f'out = {a}', 'x': round(out[0] - 14), 'y': round(out[1] - 14), 'w': 28, 'h': 28})

T_END = round((D + S + TAIL) / V)
desc = (f'Two soliton NOT gates in a row, no walls: the output of the first drives the second, so the signal is inverted '
        f'twice and comes out as it went in. Top half: input A = 1; bottom half: A = 0. Gate 1: input A (heading east) and a '
        f'clock soliton (from the lower left, 30° to it) start the same distance from where their paths cross, so they arrive in '
        f'phase: if A is there they merge into one heavier soliton heading between them; if not, the clock carries on, '
        f'through the "NOT A" box. Gate 2 does the same with that signal and a second clock (from the left): if NOT A arrives they '
        f'merge, if not the second clock reaches the "out" box. So out = NOT(NOT A) = A: a soliton in the top out box, none in '
        f'the bottom. The boxes are probes; the output arrives after about {T_END} steps ({T_END / 8 / 60:.0f} s at 8 steps '
        f'per frame and 60 fps). Merges need the two solitons in phase to within about 4°, so the clocks start exactly as far '
        f'from their meeting points as the signals they meet. The merges also throw off a small fragment. This is the step a '
        f'computer needs: one gate\'s output is a soliton like its inputs, good enough to drive the next gate.')

scene = {'name': 'Schrödinger NOT chain', 'description': desc, 'rule': 'builtin:8', 'size': N, 'start': 'rest',
         'stepsPerFrame': 8, 'paintable': ['V', 'gamma'], 'stamps': stamps, 'probes': probes,
         'view': {'reagent': 'n', 'low': 0, 'high': 6, 'tint': 'p', 'tintLow': -3, 'tintHigh': 3}}
with open(os.path.join(os.path.dirname(__file__), '..', 'scenes', 'schrodinger-not-chain.json'), 'w') as f:
    json.dump(scene, f, indent=2, ensure_ascii=False)
print(f'wrote schrodinger-not-chain (output at step {T_END})')
