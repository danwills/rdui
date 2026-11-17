# Scattered bubble positions on a wrapping field, coloured with three kinds so no two near neighbours (that will meet as
# they grow, within reach x spacing) share one: python3 lab/foam-layout.py N count spacing seed [reach] -> JSON [[x, y, kind], ...]
import json, math, random, sys
N, count, spacing, seed = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
reach = float(sys.argv[5]) if len(sys.argv) > 5 else 1.7
rng = random.Random(seed)
def dist(a, b):
    dx = abs(a[0] - b[0]); dy = abs(a[1] - b[1])
    return math.hypot(min(dx, N - dx), min(dy, N - dy))
for attempt in range(2000):
    pts = []
    for _ in range(20000):
        p = (rng.uniform(0, N), rng.uniform(0, N))
        if all(dist(p, q) >= spacing for q in pts): pts.append(p)
        if len(pts) == count: break
    if len(pts) < count: continue
    near = [[j for j in range(count) if j != i and dist(pts[i], pts[j]) < reach * spacing] for i in range(count)]
    kinds = [-1] * count
    def colour(i):
        if i == count: return True
        for k in rng.sample(range(3), 3):
            if all(kinds[j] != k for j in near[i]):
                kinds[i] = k
                if colour(i + 1): return True
        kinds[i] = -1
        return False
    if colour(0):
        print(json.dumps([[round(x), round(y), k] for (x, y), k in zip(pts, kinds)]))
        break
else:
    sys.exit('no colouring found')
