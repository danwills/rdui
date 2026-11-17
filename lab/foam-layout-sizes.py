# Mixed-size bubble layout on a wrapping field: groups of (count, expected settled radius), biggest placed first, each
# kept clear of the others by their expected radii; coloured with three kinds so no two that will meet (gap under `reach`
# cells once grown) share one. python3 lab/foam-layout-sizes.py N seed reach R1:n1 R2:n2 ... -> JSON [[x, y, R, kind], ...]
import json, math, random, sys
N, seed, reach = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3])
groups = [tuple(map(float, g.split(':'))) for g in sys.argv[4:]]
rng = random.Random(seed)
def dist(a, b):
    dx = abs(a[0] - b[0]); dy = abs(a[1] - b[1])
    return math.hypot(min(dx, N - dx), min(dy, N - dy))
for attempt in range(500):
    pts = []
    ok = True
    for R, n in groups:
        for _ in range(int(n)):
            for _ in range(5000):
                p = (rng.uniform(0, N), rng.uniform(0, N), R)
                # start far enough apart that each has room to reach most of its size
                if all(dist(p, q) >= 0.8 * (R + q[2]) for q in pts): pts.append(p); break
            else: ok = False
    if not ok: continue
    n = len(pts)
    near = [[j for j in range(n) if j != i and dist(pts[i], pts[j]) < pts[i][2] + pts[j][2] + reach] for i in range(n)]
    kinds = [-1] * n
    def colour(i):
        if i == n: return True
        for k in rng.sample(range(3), 3):
            if all(kinds[j] != k for j in near[i]):
                kinds[i] = k
                if colour(i + 1): return True
        kinds[i] = -1
        return False
    if colour(0):
        print(json.dumps([[round(x), round(y), R, k] for (x, y, R), k in zip(pts, kinds)]))
        break
else:
    sys.exit('no layout found')
