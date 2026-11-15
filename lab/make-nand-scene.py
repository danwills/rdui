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
TAIL = 6000                            # steps after the meeting until the output check (puts the trap 73 cells past P2)
W = 24                                 # corridor half-width
BUMP = 0.004                           # height of the speed filter's potential bump (see gate())
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
    probe = {'name': f'A={a} B={b} → {0 if a and b else 1}', 'x': round(ox - 14), 'y': round(oy - 14), 'w': 28, 'h': 28, 'hold': True, 'round': True}
    # a trap in the box (the rule's trap_d) parks the output soliton there and sets it to the standard power
    eat = [{'field': 'trap_d', 'x': round(ox % N, 1), 'y': round(oy % N, 1), 'r': 14}]
    # the field is all absorbing (painted below); cut out corridors W cells either side of the paths the
    # gate uses, the same for every input pair: A and B up to P1, the merged path P1 to P2, the clock's path
    # through P2 to its trap, and room round the trap. Whatever leaves a corridor (a lone input after P1, the
    # merged soliton after the swallow, a stray fragment, wherever it goes) is soaked up. (Damping starts
    # 8 cells outside a wall's edge, so solitons on the paths keep 16 cells clear of it.)
    cut = lambda x, y, x2, y2, r=W: {'field': 'absorb_d', 'cut': True, 'x': round(x, 1), 'y': round(y, 1), 'x2': round(x2, 1), 'y2': round(y2, 1), 'r': r}
    for sgn in (1, -1):
        eat.append(cut(p1[0] - D * math.cos(H), p1[1] + sgn * D * math.sin(H), *p1))
    eat.append(cut(*p1, *p2))
    eat.append(cut(p2[0] - DC * math.cos(CHEAD), p2[1] + DC * math.sin(CHEAD), ox, oy))
    eat.append(cut(ox, oy, ox, oy, 30))
    # a speed filter between P2 and the trap: a low potential bump across the clock's corridor. The heavy remnant
    # of a swallow creeps off along about the clock's path at ~0.003 cells/step (kinetic energy ~0.0008 per unit
    # power) and bounces back off it; the clock (0.0115 cells/step: 0.0128, 0.0096 across the band's 30° slant)
    # goes over. Conservative: nothing is lost either way
    bx, by = p2[0] + 45 * math.cos(CHEAD), p2[1] - 45 * math.sin(CHEAD)
    bump = {'rect': [round(bx - 36), round(by - 4), 72, 8], 'values': {'V': BUMP}}
    return st, probe, eat, bump


stamps, probes, eaters, bumps = [], [], [], []
for (a, b), (qx, qy) in zip(((0, 0), (0, 1), (1, 0), (1, 1)), ((0, 0), (256, 0), (0, 256), (256, 256))):
    s, p, e, bp = gate(qx, qy, a, b)
    bumps.append(bp)
    stamps += s
    probes.append(p)
    eaters += e

desc = (f'Four NAND gates made only of colliding solitons, no walls: one per input pair, so the truth table plays out at once '
        f'(top left A=0 B=0, top right 0 1, bottom left 1 0, bottom right 1 1). A bit is a soliton present (1) or absent (0). '
        f'Inputs A (from lower left) and B (upper left) are sent in phase on paths 30° apart: alone, each carries on; together they '
        f'attract and merge into one heavy soliton heading east (that is A AND B). The slow clock soliton (lower right, always sent) '
        f'crosses that path: if the merged soliton is there it swallows the clock, otherwise the clock goes on into the output box '
        f'(NOT). So the box gets a soliton unless both inputs are 1: NAND, which can build any logic. The clocks reach the boxes '
        f'after about {T_END} steps ({T_END / 12 / 60:.0f} s at 12 steps per frame and 60 fps). Each box holds a trap (orange '
        f'circle) that catches the output soliton and keeps it there at the standard power, so the answer stays: a soliton '
        f'sitting in the box is a 1, an empty box a 0 (the boxes are probes, holding their highest reading too). In the lab a single gate gave the same answers with the '
        f'clock up to 600 steps early or late, and at any clock phase. Built on Fredkin and Toffoli\'s billiard-ball computer (1982), with solitons '
        f'for balls. Everything outside the gates\' paths is absorbing (red): a lone input once past P1, the merged soliton '
        f'after the swallow and any stray fragment are soaked up wherever they go, so nothing wraps round into the other gates '
        f'or wanders into a trap. The faint blue band before each trap is a low bump in the potential: the clock has the speed to '
        f'cross it, the slow heavy remnant of a swallow does not and bounces back. Try: pause at the start and erase an input (or the clock) to see that gate change its answer.')

scene = {'name': 'Schrödinger NAND gates', 'description': desc, 'rule': 'builtin:8', 'size': N, 'start': 'rest',
         'stepsPerFrame': 12, 'paint': [{'rect': [0, 0, N, N], 'values': {'absorb_d': -50}}, *bumps], 'stamps': stamps, 'sdf': eaters, 'probes': probes,
         'view': {'reagent': 'n', 'low': 0, 'high': 6, 'tint': 'p', 'tintLow': -3, 'tintHigh': 3}}
out = os.path.join(os.path.dirname(__file__), '..', 'scenes', 'schrodinger-nand.json')
with open(out, 'w') as f:
    json.dump(scene, f, indent=2, ensure_ascii=False)
print('wrote', out, f'(check at step {T_END})')
