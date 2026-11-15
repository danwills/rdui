#!/usr/bin/env python3
"""Write the Schrödinger ring track scenes (scenes/nls-ring.json at 256, nls-ring-128.json at 128):
a circular channel of V = −0.6, 16 cells wide, with two solitons chasing each other round it half a lap
apart. No absorbing border: the field wraps, so light shed by the solitons stays in play.

  python3 lab/make-ring-scenes.py
"""
import json, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'scenes')
WIDTH, DEPTH = 16, 0.6          # channel width (cells) and depth
K = 0.2                         # the solitons' wavenumber (radians per cell): 0.058 cells per step


def ring(fname, name, N, rc, laps):
    ro, ri = (rc + WIDTH / 2) / N, (rc - WIDTH / 2) / N
    init = [{'chem': 'V', 'op': 'add', 'fill': {'type': 'bump', 'value': -DEPTH, 'edge': 2}, 'shape': {'type': 'circle', 'cx': 0.5, 'cy': 0.5, 'r': ro}},
            {'chem': 'V', 'op': 'add', 'fill': {'type': 'bump', 'value': DEPTH, 'edge': 2}, 'shape': {'type': 'circle', 'cx': 0.5, 'cy': 0.5, 'r': ri}}]
    for side, ky in ((1, K), (-1, -K)):
        for chem, part in (('p', 'cos'), ('q', 'sin')):
            init.append({'chem': chem, 'op': 'add', 'fill': {'type': 'packet', 'amp': 2.2, 'sigma': 7, 'kx': 0, 'ky': ky, 'part': part},
                         'shape': {'type': 'circle', 'cx': 0.5 + side * rc / N, 'cy': 0.5, 'r': 24 / N}})
    desc = (f'Saturable nonlinear Schrödinger equation with a painted potential V: a ring-shaped channel of low V (a circular optical '
            f'waveguide, depth {DEPTH}, {WIDTH} cells wide, radius {rc} cells in a {N}×{N} field) guides solitons round and round. Two '
            f'solitons chase each other clockwise, half a lap apart. {laps} No absorbing border: the field wraps round, so the little '
            f'light the solitons shed stays in play. (Sent head-on at this speed they don\'t pass cleanly: a collision can split off a '
            f'third soliton.) Things to try: paint V (the params brush) to add tracks: negative V is a channel, positive V a wall that '
            f'bounces solitons; paint a blob of positive V across the ring to make a reflector, or a gap to see one escape; the seed '
            f'brush adds light, and a slow blob dropped on the track gets caught by it.')
    sc = {'name': name, 'description': desc, 'rule': 'builtin:8', 'size': N, 'start': 'initial', 'stepsPerFrame': 24,
          'paintable': ['V', 'gamma'], 'initial': init,
          'view': {'reagent': 'n', 'low': 0, 'high': 5, 'tint': 'p', 'tintLow': -2.5, 'tintHigh': 2.5}}
    with open(os.path.join(OUT, fname + '.json'), 'w') as f:
        json.dump(sc, f, indent=2, ensure_ascii=False)
    print('wrote', fname)


# laps measured with lab/ring-check.ts (60k steps, both solitons, still on the track and holding ~675 power)
ring('nls-ring', 'Schrödinger ring track', 256, 92, 'In the lab they ran 5.6 laps in 60k steps without leaving the track.')
ring('nls-ring-128', 'Schrödinger ring track (128)', 128, 44, 'In the lab they ran 10 laps in 60k steps without leaving the track.')
