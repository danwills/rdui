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


def overlays(species, walls=True, seeds=SEEDS, r_seed=R_SEED, noise=None):
    """species: [(name, F, k, cx, cy)], one per b1.. b4 slot used."""
    out = [{'chem': f'a{i}', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'everywhere'}} for i in (1, 2, 3, 4)]
    for i, (_, _, _, cx, cy) in enumerate(species, 1):
        if walls:
            out += [{'chem': 'wall', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 1}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': R_CIRCLE + WALL}},
                    {'chem': 'wall', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 0}, 'shape': {'type': 'circle', 'cx': cx, 'cy': cy, 'r': R_CIRCLE}}]
        if noise:
            # History+Wave's own opening: noise in a and b, here over the circle (noise = its radius)
            disc = {'type': 'circle', 'cx': cx, 'cy': cy, 'r': noise}
            out += [{'chem': f'a{i}', 'op': 'overwrite', 'fill': {'type': 'white_noise', 'low': 0.6, 'high': 0.7001}, 'shape': disc},
                    {'chem': f'b{i}', 'op': 'overwrite', 'fill': {'type': 'white_noise', 'low': -0.2, 'high': 0.42}, 'shape': dict(disc)}]
            continue
        for dx, dy in seeds:
            # small seed spots (a wide uniform seed dies in the spots and worms regimes)
            s = {'type': 'circle', 'cx': round(cx + dx, 4), 'cy': round(cy + dy, 4), 'r': r_seed}
            out += [{'chem': f'a{i}', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 0.5}, 'shape': s},
                    {'chem': f'b{i}', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 0.3}, 'shape': dict(s)}]
    return out


NICHES_VIEW = {'reagent': 'b', 'low': 0, 'high': 0.5, 'tint': 'P_F', 'tintLow': 0.015, 'tintHigh': 0.06}


def scene(fname, name, desc, species, walls=True, extra=None, rule='builtin:16', view=NICHES_VIEW, more=(), **seeding):
    g = {}
    for i, (_, F, k, _, _) in enumerate(species, 1):
        g[f'F{i}'], g[f'k{i}'] = F, k
    sc = {'name': name, 'description': desc, 'rule': rule, 'size': 384, 'start': 'initial', 'stepsPerFrame': 20,
          'globals': {**g, **(extra or {})}, 'initial': overlays(species, walls, **seeding) + list(more),
          'view': view}
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

STRONG_WORMS = ('worms', 0.058, 0.0645)
scene('niches-strong-worms.json', 'Gray-Scott Niches: worms fight back',
      'Balanced four with hungrier worms: k 0.0645 instead of 0.065 (top right, F 0.058), so worms no longer lose ground to the rest. '
      'In open-field duels they took 63-68% of the ground from each of spots (top left, F 0.0367 k 0.0649), small dots (bottom left, '
      '0.026 0.061) and dashes (bottom right, 0.025 0.06) after 60k steps (the old worms held 46-56% against them and lost in the '
      'walled layout). A guess not yet tried in this layout: it may tip the other way. Each circle is walled; open doors with the '
      'Unwall tool (key 8). Tint = local mean feed; view b1…b4 to see one species alone.',
      [(*SPOTS, 0.27, 0.27), (*STRONG_WORMS, 0.73, 0.27), (*DOTS, 0.27, 0.73), (*DASHES, 0.73, 0.73)])

scene('niches-worm-battle.json', 'Gray-Scott Niches: worm battle',
      'Four kinds of worm in the open, no walls, one in each corner: F 0.046 k 0.0655 (top left: worms broken into dots), 0.05 0.065 '
      '(top right), 0.054 0.0655 (bottom left) and 0.058 0.0645 (bottom right: the hungry worms of "worms fight back"). Picked '
      'from duels in the open field against spots and worms, where each held 44-68%; not yet run against each other, a guess. '
      'Tint = local mean feed (from blue-ish F 0.046 to F 0.058); view b1…b4 to see one kind alone.',
      [('worms .046', 0.046, 0.0655, 0.27, 0.27), ('worms .05', 0.05, 0.065, 0.73, 0.27),
       ('worms .054', 0.054, 0.0655, 0.27, 0.73), ('worms .058', 0.058, 0.0645, 0.73, 0.73)], walls=False)


# GS History+Wave Niches (builtin:17): its own four species, sparse as History+Wave's life is, so each circle
# starts as History+Wave's own opening does, with noise (seed spots mostly died); the wave starts at rest
# the rule's own four, but the fourth at F 0.062 k 0.062: F 0.066 (k 0.065 or 0.066) died in its circle
HW = [('hw .042', 0.042, 0.06), ('hw .05', 0.05, 0.062), ('hw .058', 0.058, 0.0635), ('hw .062', 0.062, 0.062)]
scene('hw-niches-circles.json', 'GS History+Wave Niches: walled circles',
      'GS History+Wave Niches\' four species, each in its own walled circle as in the Niches heredity scenes: F 0.042 k 0.06 '
      '(top left: gliders that leave trails), 0.05 0.062 (top right), 0.058 0.0635 (bottom left) and 0.062 0.062 (bottom right), '
      'the last three building colonies of glowing blobs. Each circle starts as History+Wave\'s own opening does, with noise. '
      'All four were still there at 40k steps. The history and wave are shared, but the walls keep them apart until you open '
      'doors with the Unwall tool (key 8): then watch who crosses. View c (the history) tinted by P_F (who made each trail); '
      'b1…b4 to see one species alone.',
      [(*HW[0], 0.27, 0.27), (*HW[1], 0.73, 0.27), (*HW[2], 0.27, 0.73), (*HW[3], 0.73, 0.73)],
      rule='builtin:17', noise=0.12,
      view={'reagent': 'c', 'low': 0, 'high': 1, 'tint': 'P_F', 'tintLow': 0.04, 'tintHigh': 0.068},
      more=[{'chem': 'd', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 0.37}, 'shape': {'type': 'everywhere'}}])

# no walls, four behaviours from a map of the medium (lab/hw-niches-map.ts: one species alone on a feed/kill grid),
# then nudged in the scene until all four were still there at 80k steps (worms at k 0.055, then 0.057, took over)
HW_OPEN = [('gliders', 0.038, 0.057), ('spot rings', 0.05, 0.062), ('spot chains', 0.062, 0.058), ('blobs', 0.07, 0.06)]
scene('hw-niches-open.json', 'GS History+Wave Niches: four behaviours',
      'GS History+Wave Niches with four species that behave differently, in the open, no walls: gliders that roam the whole '
      'field leaving branching trails (top left, F 0.038 k 0.057), and three that hold ground: rings of spots (top right, 0.05 '
      '0.062), chains of spots (bottom left, 0.062 0.058; worms when alone) and big yellow blobs (bottom right, 0.07 0.06; '
      'straight rods when alone). Picked from a map of what one species alone does across feed and kill, then balanced: all '
      'four were still there at 80k steps, gliders and chains trading ground. Each starts as a patch of noise, as '
      'History+Wave\'s own opening does. View c (the history) tinted by P_F (who made each trail); b1…b4 to see one alone.',
      [(*HW_OPEN[0], 0.27, 0.27), (*HW_OPEN[1], 0.73, 0.27), (*HW_OPEN[2], 0.27, 0.73), (*HW_OPEN[3], 0.73, 0.73)],
      walls=False, rule='builtin:17', noise=0.12,
      view={'reagent': 'c', 'low': 0, 'high': 1, 'tint': 'P_F', 'tintLow': 0.03, 'tintHigh': 0.072},
      more=[{'chem': 'd', 'op': 'overwrite', 'fill': {'type': 'constant', 'value': 0.37}, 'shape': {'type': 'everywhere'}}])
