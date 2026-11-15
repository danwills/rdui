#!/usr/bin/env python3
"""Writes scenes/schrodinger-two-qubits.json: two 2×2 grids of wells, each a classical picture of two qubits.
The potential is V(x) + V(y): two vertical stripes (a double well across: qubit 1, left/right) plus two
horizontal ones (a double well down: qubit 2, top/bottom), −0.6 each, so the four crossings are −1.2. Being a
sum, tunnelling across and tunnelling down go on independently (like gates on separate qubits), with the
double-well scene's timing (a full swap and back about every 5800 steps).
Left grid: power in the top row (a product state: qubit 2 'top' whatever qubit 1). Right grid: power in
top-left and bottom-right only (the shape of a Bell state: it can't be written as a column pattern times a row
pattern).

  python3 lab/make-two-qubit-scene.py
"""
import json, math, os

N, W, GAP, DEPTH = 256, 16, 4, -0.6
AMP, SIGMA, ARM = 0.1, 4.5, 56          # packet; how far the stripes run out from the centre (into the absorbing field)
GRIDS = [  # (centre x, short name, [(well, relative amplitude, phase)])
    (64, 'row', [('TL', 1 / math.sqrt(2), 0), ('TR', 1 / math.sqrt(2), 0)]),
    (192, 'Bell', [('TL', 1 / math.sqrt(2), 0), ('BR', 1 / math.sqrt(2), 0)]),
]
cy = N / 2
lo, hi = -GAP / 2 - W, GAP / 2          # each well's near edge offset (left/top well starts at lo, right/bottom at hi)
paint = [{'rect': [0, 0, N, N], 'values': {'absorb_d': -50}}]
sdf, initial, probes = [], [], []
for cx, short, parts in GRIDS:
    for o in (lo, hi):
        paint.append({'rect': [round(cx + o), round(cy - ARM), W, 2 * ARM], 'values': {'V': DEPTH}})      # vertical stripe
        paint.append({'rect': [round(cx - ARM), round(cy + o), 2 * ARM, W], 'values': {'V': DEPTH}})      # horizontal stripe
    for ox in (lo, hi):
        for oy in (lo, hi):
            paint.append({'rect': [round(cx + ox), round(cy + oy), W, W], 'values': {'V': 2 * DEPTH}})   # crossings: the sum
    sdf.append({'field': 'absorb_d', 'cut': True, 'x': cx, 'y': cy, 'r': 40})
    centre = {'TL': (lo, lo), 'TR': (hi, lo), 'BL': (lo, hi), 'BR': (hi, hi)}
    for well, a, ph in parts:
        ox, oy = centre[well]
        for chem, part in (('p', 'cos'), ('q', 'sin')):
            initial.append({'chem': chem, 'op': 'add', 'fill': {'type': 'packet', 'amp': AMP * a, 'sigma': SIGMA, 'phase': ph, 'part': part},
                            'shape': {'type': 'circle', 'cx': (cx + ox + W / 2) / N, 'cy': (cy + oy + W / 2) / N, 'r': 3 * SIGMA / N}})
    for well, (ox, oy) in centre.items():
        probes.append({'name': f'{short} · {well}', 'x': round(cx + ox), 'y': round(cy + oy), 'w': W, 'h': W})

desc = ('Two qubits, pictured classically: each 2×2 grid of wells (blue) is left/right for qubit 1 and top/bottom for '
        'qubit 2, so the four wells are the four combinations 00, 01, 10, 11. The potential is a double well across '
        'plus a double well down, so the two qubits tunnel independently, as if each had its own gate. Left: power in '
        'the top row, a product state (qubit 2 is "top", qubit 1 is an even mix): the whole row tunnels down and back '
        'together. Right: power in top-left and bottom-right only, the shape of a Bell state, the classic entangled '
        'pair: it can\'t be written as a column pattern times a row pattern. It swaps to the other diagonal and back, but '
        'never becomes a row or a column: whatever qubit 1 does, qubit 2 does too (steps that act on one qubit at a '
        'time can never untangle it, or tangle a product state). What a classical field can\'t do: here both "qubits" '
        'are features of one wave in one place, so there is no spooky distance; and n qubits would need 2ⁿ wells '
        '(4 here, about a million for 20), the cost real qubits don\'t pay.')
scene = {'name': 'Schrödinger two qubits (product and Bell)', 'description': desc, 'rule': 'builtin:8', 'size': N,
         'start': 'initial', 'initial': initial, 'paint': paint, 'sdf': sdf, 'probes': probes, 'stepsPerFrame': 12,
         'view': {'reagent': 'n', 'low': 0, 'high': AMP ** 2 * 1.2, 'tint': 'p', 'tintLow': -AMP, 'tintHigh': AMP}}
out = os.path.join(os.path.dirname(__file__), '..', 'scenes', 'schrodinger-two-qubits.json')
json.dump(scene, open(out, 'w'), indent=1, ensure_ascii=False)
print('wrote', out)
