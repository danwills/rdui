#!/usr/bin/env python3
"""Write the Schrödinger NAND scene (scenes/schrodinger-nand.json): four wall-free soliton NAND gates
in a 2×2 grid, one per input pair (00, 01 / 10, 11), so the truth table plays out at once.

Each gate (measured in lab/nls-nand.ts, checked as laid out here by lab/nls-nand-scene.ts):
  AND: A (heading +15°) and B (−15°), in phase, wavenumber K, meet at P1 and merge into one heavy
       soliton heading east; either alone carries on at ±15°.
  NOT: the clock C (always sent; slow, heading 120°) crosses the merged soliton's path at P2, a
       little early: hit, it's swallowed; alone, it goes on to the output box.
Units: timestep 0.018, dx 0.25, so a soliton moves k·0.288 cells per step.

  python3 lab/make-nand-scene.py
"""
import json, math, os

N = 512
DT, DX = 0.018, 0.25
PER = DT / DX ** 2                     # cells per step per unit wavenumber
H = math.radians(15)                   # input half-angle
K, KC = 0.08, 0.04                     # input and clock wavenumbers
D, L = 66, 130                         # A/B start distance from P1; P1 to P2 (a lone A or B passes 0.26·L from P2: keep it over ~30)
CHEAD = math.radians(120)              # clock heading
EARLY = 300                            # clock arrives this many steps early (lone B passes nearer a late clock)
TAIL = 3000                            # steps after the meeting until the output check
MERGED = 0.96                          # merged soliton's speed / the inputs'

v, vc = K * PER, KC * PER
T_MEET = D / v + L / (MERGED * v) - EARLY
T_END = round(T_MEET + EARLY + TAIL)
DC = vc * T_MEET


def boost(head, k, phase=0.0):
    # headings anticlockwise from east, y up; the screen's y points down
    return {'kx': round(k * math.cos(head), 5), 'ky': round(-k * math.sin(head), 5), 'phase': phase}


def gate(qx, qy, a, b):
    p1 = (qx + 70, qy + 120)
    p2 = (p1[0] + L, p1[1])
    st = []
    if a: st.append({'stamp': 'nls-soliton-0-still', 'x': round(p1[0] - D * math.cos(H), 2), 'y': round(p1[1] + D * math.sin(H), 2), 'boost': boost(H, K)})
    if b: st.append({'stamp': 'nls-soliton-0-still', 'x': round(p1[0] - D * math.cos(H), 2), 'y': round(p1[1] - D * math.sin(H), 2), 'boost': boost(-H, K)})
    st.append({'stamp': 'nls-soliton-0-still', 'x': round(p2[0] - DC * math.cos(CHEAD), 2), 'y': round(p2[1] + DC * math.sin(CHEAD), 2), 'boost': boost(CHEAD, KC)})
    ox = p2[0] + vc * (EARLY + TAIL) * math.cos(CHEAD)
    oy = p2[1] - vc * (EARLY + TAIL) * math.sin(CHEAD)
    probe = {'name': f'A={a} B={b} → {0 if a and b else 1}', 'x': round(ox - 14), 'y': round(oy - 14), 'w': 28, 'h': 28}
    return st, probe


stamps, probes = [], []
for (a, b), (qx, qy) in zip(((0, 0), (0, 1), (1, 0), (1, 1)), ((0, 0), (256, 0), (0, 256), (256, 256))):
    s, p = gate(qx, qy, a, b)
    stamps += s
    probes.append(p)

desc = (f'Four NAND gates made only of colliding solitons, no walls: one per input pair, so the truth table plays out at once '
        f'(top left A=0 B=0, top right 0 1, bottom left 1 0, bottom right 1 1). A bit is a soliton present (1) or absent (0). '
        f'Inputs A (from lower left) and B (upper left) are sent in phase on paths 30° apart: alone, each carries on; together they '
        f'attract and merge into one heavy soliton heading east (that is A AND B). The slow clock soliton (lower right, always sent) '
        f'crosses that path: if the merged soliton is there it swallows the clock, otherwise the clock goes on into the output box '
        f'(NOT). So the box gets a soliton unless both inputs are 1: NAND, which can build any logic. The clocks reach the boxes '
        f'after about {T_END} steps ({T_END / 12 / 60:.0f} s at 12 steps per frame and 60 fps; the boxes are probes, so their readout '
        f'shows the power arriving). In the lab a single gate gave the same answers with the '
        f'clock up to 600 steps early or late, and at any clock phase. Built on Fredkin and Toffoli\'s billiard-ball computer (1982), with solitons '
        f'for balls. Try: pause at the start and erase an input (or the clock) to see that gate change its answer.')

scene = {'name': 'Schrödinger NAND gates', 'description': desc, 'rule': 'builtin:8', 'size': N, 'start': 'rest',
         'stepsPerFrame': 12, 'paintable': ['V', 'gamma'], 'stamps': stamps, 'probes': probes,
         'view': {'reagent': 'n', 'low': 0, 'high': 6, 'tint': 'p', 'tintLow': -3, 'tintHigh': 3}}
out = os.path.join(os.path.dirname(__file__), '..', 'scenes', 'schrodinger-nand.json')
with open(out, 'w') as f:
    json.dump(scene, f, indent=2, ensure_ascii=False)
print('wrote', out, f'(check at step {T_END})')
