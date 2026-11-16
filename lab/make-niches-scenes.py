#!/usr/bin/env python3
"""Write Gray-Scott Niches scenes (builtin:16): species seeded in walled circles (the heredity test, as
lab/heredity.ts heredityInitial) or in the open. Line-ups chosen from duels (lab/niches-duel.ts): two
species seeded in opposite halves of an open field, each one's share of the living b over 60k steps.

  python3 lab/make-niches-scenes.py
"""
import json, os

R_CIRCLE, R_SEED, WALL = 0.17, 0.012, 0.012
SEEDS = [(0, 0), (0.07, 0.02), (-0.06, 0.05), (-0.03, -0.07), (0.04, -0.06), (0.02, 0.09)]
HERE = os.path.dirname(__file__)


def overlays(species, walls=True):
    """species: [(name, F, k, cx, cy)], one per b1.. b4 slot used."""
    out = [{'chem': f'a{i}', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}} for i in (1, 2, 3, 4)]
    for i, (_, _, _, cx, cy) in enumerate(species, 1):
        if walls:
            out += [{'chem': 'wall', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': R_CIRCLE + WALL}},
                    {'chem': 'wall', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 0}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': R_CIRCLE}}]
        for dx, dy in SEEDS:
            # small seed spots (a wide uniform seed dies in the spots and worms regimes)
            s = {'type': 'circle', 'cx': round(cx + dx, 4), 'cy': round(cy + dy, 4), 'r': R_SEED}
            out += [{'chem': f'a{i}', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 0.5}, 'shape': s},
                    {'chem': f'b{i}', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 0.3}, 'shape': dict(s)}]
    return out


def scene(fname, name, desc, species, walls=True, extra=None):
    g = {}
    for i, (_, F, k, _, _) in enumerate(species, 1):
        g[f'F{i}'], g[f'k{i}'] = F, k
    sc = {'name': name, 'description': desc, 'rule': 'builtin:16', 'size': 384, 'start': 'initial', 'stepsPerFrame': 20,
          'globals': {**g, **(extra or {})}, 'initial': overlays(species, walls),
          'view': {'reagent': 'b', 'low': 0, 'high': 0.5, 'tint': 'P_F', 'tintLow': 0.015, 'tintHigh': 0.06}}
    with open(os.path.join(HERE, '..', 'scenes', fname), 'w') as f:
        json.dump(sc, f, indent=2, ensure_ascii=False)
    print('wrote', fname)


SPOTS, WORMS = ('spots', 0.0367, 0.0649), ('worms', 0.058, 0.065)

scene('niches-spots-worms.json', 'Gray-Scott Niches: spots meet worms',
      'Two species of Gray-Scott Niches in the open, no walls: spots (left, F 0.0367 k 0.0649) and worms (right, F 0.058 k 0.065), '
      'each seeded as a few small spots and each living on its own food, so they compete only for space (interfere 0.3: where they '
      'overlap, each raises the other\'s death rate). They are evenly matched (in the lab, by territory: spots 68% at 20k steps, then 52%, 48% by 60k), so '
      'rather than one taking over, their fronts meet and they intermingle: dividing spots push in between the worms and worms thread '
      'through the spots. Tint = local mean feed (spots and worms feed differently); view b1 or b2 to see one species alone.',
      [(*SPOTS, 0.3, 0.5), (*WORMS, 0.7, 0.5)], walls=False)


DOTS, DASHES = ('dots', 0.026, 0.061), ('dashes', 0.025, 0.06)
scene('niches-balanced.json', 'Gray-Scott Niches: balanced four',
      'The heredity test of Gray-Scott Niches with four evenly matched species, so none simply takes over: spots (top left, F 0.0367 k '
      '0.0649), worms (top right, 0.058 0.065), small hexagonal dots (bottom left, 0.026 0.061) and short dashes (bottom right, 0.025 '
      '0.06). In the first heredity scene maze and curly took nearly everything (in duels they hold 76-98% against spots or worms); '
      'these were picked from 16 Gray-Scott regimes by duels in the open field, each species seeded in one half: every pairing of these '
      'four ended between 45% and 59% of the ground after 60k steps. Each circle is walled; open doors with the Unwall tool (key 8) and '
      'watch the borders. Tint = local mean feed, which tells the species apart; view b1…b4 to see one alone.',
      [(*SPOTS, 0.27, 0.27), (*WORMS, 0.73, 0.27), (*DOTS, 0.27, 0.73), (*DASHES, 0.73, 0.73)])
