#!/usr/bin/env python3
"""Writes scenes/schrodinger-soliton-traps.json: four lanes, each sending a soliton east into a round trap
(the rule's trap_d: a shallow well with friction and gain balanced at a standard soliton's power)."""
import json

N, TX, R = 256, 180, 20
LANES = [  # (stamp, speed k, label)
    ('nls-soliton-0-still', 0.04, 'standard, slow'),
    ('nls-soliton-0-still', 0.16, 'standard, fast'),
    ('nls-soliton-weak-0-still', 0.08, 'weak (140)'),
    ('nls-soliton-faint-0-still', 0.08, 'faint (110)'),
]
stamps, sdf, probes = [], [], []
for i, (st, k, label) in enumerate(LANES):
    y = 34 + 62 * i
    stamps.append({'stamp': st, 'x': 40, 'y': y, 'boost': {'kx': k, 'ky': 0, 'phase': 0}})
    sdf.append({'field': 'trap_d', 'x': TX, 'y': y, 'r': R})
    probes.append({'name': label, 'x': TX - 14, 'y': y - 14, 'w': 28, 'h': 28})
scene = {
    'name': 'Schrödinger soliton traps',
    'description': 'Four solitons sent east into round traps (orange): a shallow well with friction, and gain that balances '
                   'at a standard soliton\'s power. Each is slowed, parked in its trap and grown or shrunk to about 710, '
                   'whatever it came in as, if it is strong enough: below about 150 the trap\'s loss wins and it fades. '
                   'Draw your own with the Wall tool and "traps" ticked (a click makes a round one). Tuning: trap_V, '
                   'trap_D (friction), trap_loss, trap_gain, trap_sat.',
    'rule': 'builtin:8', 'size': N, 'start': 'rest', 'stepsPerFrame': 12,
    'stamps': stamps, 'sdf': sdf, 'probes': probes,
    'view': {'reagent': 'n', 'low': 0, 'high': 6, 'tint': 'p', 'tintLow': -3, 'tintHigh': 3},
}
json.dump(scene, open(__file__.rsplit('/', 2)[0] + '/scenes/schrodinger-soliton-traps.json', 'w'), indent=1, ensure_ascii=False)
