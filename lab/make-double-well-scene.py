#!/usr/bin/env python3
"""Writes scenes/schrodinger-double-well.json: four double wells (two square wells of V −0.6, 16 cells wide,
4 apart: a two-level system, like one qubit), each started differently with a faint packet so the field stays
nearly linear. Well sizes from a 1D eigenvalue calculation: ground pair split by 0.057 (a full tunnelling
cycle every ~6200 steps), the next level 0.28 higher.

  python3 lab/make-double-well-scene.py
"""
import json, math, os

N, W, GAP, DEPTH = 256, 16, 4, -0.6
AMP, SIGMA = 0.1, 4.5
ROWS = [  # (label, [(well, relative amplitude, phase)])
    ('all in the left well', [('L', 1, 0)]),
    ('split, in phase', [('L', 1 / math.sqrt(2), 0), ('R', 1 / math.sqrt(2), 0)]),
    ('split, opposite phase', [('L', 1 / math.sqrt(2), 0), ('R', 1 / math.sqrt(2), math.pi)]),
    ('split, a quarter turn apart', [('L', 1 / math.sqrt(2), 0), ('R', 1 / math.sqrt(2), math.pi / 2)]),
]
xl = N / 2 - GAP / 2 - W   # left well's left edge
xr = N / 2 + GAP / 2       # right well's left edge
paint = [{'rect': [0, 0, N, N], 'values': {'absorb_d': -50}}]
sdf, initial, probes = [], [], []
for i, (label, parts) in enumerate(ROWS):
    y = 32 + 64 * i
    for x0 in (xl, xr):
        paint.append({'rect': [round(x0), round(y - W / 2), W, W], 'values': {'V': DEPTH}})
    # a pocket free of damping round each pair (damping starts 8 cells inside an absorbing edge's 30)
    sdf.append({'field': 'absorb_d', 'cut': True, 'x': xl, 'y': y, 'x2': xr + W, 'y2': y, 'r': 30})
    for well, a, ph in parts:
        cx = (xl if well == 'L' else xr) + W / 2
        for chem, part in (('p', 'cos'), ('q', 'sin')):
            initial.append({'chem': chem, 'op': 'add', 'fill': {'type': 'packet', 'amp': AMP * a, 'sigma': SIGMA, 'phase': ph, 'part': part},
                            'shape': {'type': 'circle', 'cx': cx / N, 'cy': y / N, 'r': 3 * SIGMA / N}})
    short = ['left only', 'in phase', 'opposite', 'quarter turn'][i]
    probes.append({'name': f'{short} · L', 'x': round(xl), 'y': round(y - W / 2), 'w': W, 'h': W})
    probes.append({'name': f'{short} · R', 'x': round(xr), 'y': round(y - W / 2), 'w': W, 'h': W})

desc = ('Four double wells (blue: two square dips in the potential), each a two-level system like one qubit: '
        'how the wave\'s power is split between the wells, and the phase between the two parts (the colour). '
        'Top: everything starts in the left well and tunnels across and back, a full cycle about every 5800 steps '
        '(watch the probes\' sparklines swap). Second and third: split evenly in phase, or in opposite phase: the two '
        'steady states, which stay put. Bottom: split evenly but a quarter turn apart in phase: the phase difference '
        'drives a flow, so the power piles into one well, comes back even, then piles into the other: the relative '
        'phase and the power split trade off (round the qubit\'s sphere). The waves are kept faint so the field is '
        'almost linear, as quantum mechanics is; stray ripples are soaked up by the absorbing field (red). '
        'Brighter starts behave differently: past a point the power stays stuck in one well (self-trapping), '
        'something real qubits never do.')
scene = {'name': 'Schrödinger double wells (one qubit)', 'description': desc, 'rule': 'builtin:8', 'size': N,
         'start': 'initial', 'initial': initial, 'paint': paint, 'sdf': sdf, 'probes': probes, 'stepsPerFrame': 12,
         'view': {'reagent': 'n', 'low': 0, 'high': AMP ** 2 * 1.2, 'tint': 'p', 'tintLow': -AMP, 'tintHigh': AMP}}
out = os.path.join(os.path.dirname(__file__), '..', 'scenes', 'schrodinger-double-well.json')
json.dump(scene, open(out, 'w'), indent=1, ensure_ascii=False)
print('wrote', out)
