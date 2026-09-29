"""Dreambound: the iris diaphragm used by the End stack's door and the observatory roof station (src/props/aperture.js).

Headless:   blender --background --factory-startup --python tools/blender/iris_design.py

A real iris diaphragm (camera lenses, iris doors): N thin curved blades, each turning on a pivot pin fixed in a
stationary ring round the opening; a second, rotating actuator ring carries a pin per blade that slides in a straight
cam slot cut in the blade near its pivot, so turning the ring swings every blade about its pivot at once. The blades lap
over one another like shingles; their inner edges bound the opening.

Everything here is for an opening of radius 1 (the game scales it). The blade is a curved triangle: a leading edge from
its pivot (on a circle of radius RP) curving in to a tip just past the centre, a trailing edge from the next blade's
pivot (plus an overlap) to the same tip, and a band outside the rim that carries the pivot and the slot. Shut, the N
blades are a pinwheel that covers the whole opening with every blade over its neighbour on one side; open, each has
swung PSI_MAX about its pivot and lies wholly outside the opening, inside a housing of radius REACH. On the way the
opening is a clean 12-sided polygon with slightly curved sides, as in a lens, never a star: the neighbours stay lapped.
The numbers were chosen by a numerical search (coverage when shut, no slits part open, clearance when open, smallest
housing), all rechecked here on the mesh's own triangles.

Each blade is a shallow ramp (its height falls across its width by RAMP), so where two blades overlap the leading one
is always the higher: every blade lies over its neighbour on one side and under the other, all the way round, as real
blades do (they are slightly bent), with no seam where the pattern has to break.

Exports public/models/iris.glb: 'Blade' (one blade, in its pivot's frame: the pivot at the origin, shut), 'Base' (the
stationary ring with its pivot pins), 'Actuator' (the rotating ring with its drive pins), and 'IRIS_META' (extras: n,
rp, psiMax, dir, reach, y0, beta[] — the actuator ring's angle for blade swings 0..psiMax, from the slot geometry).
Game coordinates: +Y up, the iris in the XZ plane; angles run from +X toward +Z.
"""
import bpy, bmesh, math, os, json, mathutils
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) if '__file__' in globals() else 'C:/repos/Dreambound'
OUT = os.path.join(ROOT, 'public', 'models', 'iris.glb')

N = 12                    # blades
RP = 1.10                 # pivot circle
DELTA = math.radians(10)  # each blade laps this far over the next, at the rim
EPS = 0.15                # the tip reaches this far past the centre
SAG = -0.04               # edge curvature (the arcs bow this much of their chord, toward the blade's leading side).
                          # Nearly straight: the more the edges bow, the further neighbours part as they swing, and
                          # the opening grows slits between them (a star, not a polygon); see check().
BOSS = 0.07               # the band outside the rim that carries the pivot and the slot
DIR = -1                  # opening turns each blade clockwise (seen from above) about its pivot
PSI_MAX = math.radians(67.5)   # a little past the 65.4 deg at which every blade has cleared the opening
RAMP = 0.012              # height fall across a blade (opening radii)
THICK = 0.006             # blade thickness
Y0 = -0.11                # the blades' top, below the iris's plane (under a door's face plate)
W = 2 * math.pi / N + DELTA


def arc(p, q, sag, n):
    p, q = np.array(p, float), np.array(q, float)
    d = q - p
    L = np.linalg.norm(d)
    nrm = np.array([-d[1], d[0]]) / L
    m = (p + q) / 2 + nrm * sag * L * 2
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p + 2 * (1 - t) * t * m + t ** 2 * q


P = np.array([RP, 0.0])
P2 = np.array([RP * math.cos(W), RP * math.sin(W)])
TC = np.array([EPS * math.cos(W + math.pi), EPS * math.sin(W + math.pi)])
NT, NJ = 30, 10
LEAD, TRAIL = arc(P, TC, SAG, NT), arc(P2, TC, SAG, NT)


def rim(frac, r):
    a = frac * W
    return np.array([r * math.cos(a), r * math.sin(a)])


def blade_top():
    """Grid of the blade's upper surface (2D points and their across-fraction), rows from the outer band to the tip."""
    rows = []
    # The band outside the rim, from the outer edge in to the rim (reaching back past the pivot a little).
    for r in (RP + BOSS, RP + BOSS * 0.5):
        rows.append([(rim(-0.06 + 1.06 * j / NJ, r), j / NJ) for j in range(NJ + 1)])
    # The body: between the leading and trailing edges, corrected onto the rim arc at the rim.
    for k in range(NT):
        t = k / (NT - 1)
        row = []
        for j in range(NJ + 1):
            f = j / NJ
            p = LEAD[k] * (1 - f) + TRAIL[k] * f
            chord = P * (1 - f) + P2 * f
            p = p + (rim(f, RP) - chord) * (1 - t) ** 2
            row.append((p, f))
        rows.append(row)
    return rows


def pip(poly, pts):
    x, y = pts[:, 0], pts[:, 1]
    inside = np.zeros(len(pts), bool)
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        c = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1)
        inside ^= c
    return inside


def rot(pts, c, a):
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    return (pts - c) @ R.T + c


def outline():
    rows = blade_top()
    left = [rows[k][0][0] for k in range(len(rows))]
    right = [rows[k][-1][0] for k in range(len(rows))][::-1]
    return np.array(left + right[:-1] + [rows[0][j][0] for j in range(NJ, -1, -1)])


def area2(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def ear_clip(pts):
    """Triangles (index triples, counter-clockwise) filling the simple polygon pts. Each step clips the best-shaped ear
    (the largest smallest angle), so there are no needle slivers along the long curved edges. Blender's own n-gon fill
    is not used: on this long, thin, curved outline it left triangles that bridge the concave inner edge."""
    n = len(pts)
    idx = list(range(n))
    if sum(area2(np.zeros(2), pts[i], pts[(i + 1) % n]) for i in range(n)) < 0:
        idx.reverse()
    tris = []

    def inside(p, a, b, c):
        return area2(a, b, p) > -1e-12 and area2(b, c, p) > -1e-12 and area2(c, a, p) > -1e-12

    def min_angle(a, b, c):
        best = math.pi
        for p, q, r in ((a, b, c), (b, c, a), (c, a, b)):
            u, v = q - p, r - p
            best = min(best, math.acos(max(-1.0, min(1.0, u @ v / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-15)))))
        return best

    while len(idx) > 3:
        m = len(idx)
        best, bk = -1.0, None
        for k in range(m):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % m]
            a, b, c = pts[i0], pts[i1], pts[i2]
            if area2(a, b, c) <= 1e-12:
                continue
            if any(inside(pts[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            q = min_angle(a, b, c)
            if q > best:
                best, bk = q, k
        if bk is None:
            # only straight runs left: drop a vertex that lies on its neighbours' line
            bk = min(range(m), key=lambda k: abs(area2(pts[idx[k - 1]], pts[idx[k]], pts[idx[(k + 1) % m]])))
            idx.pop(bk)
            continue
        tris.append((idx[bk - 1], idx[bk], idx[(bk + 1) % m]))
        idx.pop(bk)
    tris.append(tuple(idx))
    # A fill of a simple polygon covers exactly its area; anything more is a triangle outside it.
    poly_a = abs(sum(area2(np.zeros(2), pts[i], pts[(i + 1) % n]) for i in range(n))) / 2
    tri_a = sum(abs(area2(pts[a], pts[b], pts[c])) for a, b, c in tris) / 2
    assert abs(tri_a - poly_a) < 1e-9 * max(1.0, poly_a) + 1e-9, f'blade fill {tri_a} != outline {poly_a}'
    return tris


def pit(tris, pts, q):
    """Points q inside any of the triangles."""
    hit = np.zeros(len(q), bool)
    for a, b, c in tris:
        A, B, C = pts[a], pts[b], pts[c]
        d1 = (B[0] - A[0]) * (q[:, 1] - A[1]) - (B[1] - A[1]) * (q[:, 0] - A[0])
        d2 = (C[0] - B[0]) * (q[:, 1] - B[1]) - (C[1] - B[1]) * (q[:, 0] - B[0])
        d3 = (A[0] - C[0]) * (q[:, 1] - C[1]) - (A[1] - C[1]) * (q[:, 0] - C[0])
        hit |= ((d1 >= 0) & (d2 >= 0) & (d3 >= 0)) | ((d1 <= 0) & (d2 <= 0) & (d3 <= 0))
    return hit


def outline_pts():
    """The blade's outline as the mesh has it: (point, across-fraction) round the lead edge, the trail edge and the band."""
    rows = blade_top()
    lead = [(rows[k][0][0], 0.0) for k in range(len(rows))]
    trail = [(rows[k][-1][0], 1.0) for k in range(len(rows))][::-1]
    outer = [(rows[0][j][0], rows[0][j][1]) for j in range(NJ, -1, -1)]
    clean = []
    for p, f in lead + trail[1:] + outer[1:-1]:
        if not clean or np.linalg.norm(p - clean[-1][0]) > 1e-6:
            clean.append((p, f))
    if np.linalg.norm(clean[0][0] - clean[-1][0]) < 1e-6:
        clean.pop()
    return clean


def check():
    poly = outline()
    clean = outline_pts()
    pts = np.array([p for p, _ in clean])
    tris = ear_clip(pts)
    g = np.stack(np.meshgrid(np.linspace(-1, 1, 161), np.linspace(-1, 1, 161)), -1).reshape(-1, 2)
    g = g[np.hypot(g[:, 0], g[:, 1]) < 0.999]
    cov = np.zeros(len(g), bool)
    for i in range(N):
        # the mesh's own triangles, not just its outline
        cov |= pit(tris, rot(pts, np.zeros(2), 2 * math.pi * i / N), g)
    uncovered = int((~cov).sum())
    # Part open, the opening must be one clean (curved-sided) polygon: blade inside the convex hull of the uncovered
    # points is a slit between neighbours or a tip in the hole. Curved sides alone leave well under 1%.
    slit = 0.0
    for f in np.linspace(0.1, 0.9, 9):
        cov = np.zeros(len(g), bool)
        for i in range(N):
            cov |= pit(tris, rot(rot(pts, P, DIR * f * PSI_MAX), np.zeros(2), 2 * math.pi * i / N), g)
        hole = g[~cov]
        if len(hole) < 3:
            continue
        h = hull(hole)
        inside = np.ones(len(g), bool)
        for k in range(len(h)):
            a, b = h[k], h[(k + 1) % len(h)]
            inside &= (b[0] - a[0]) * (g[:, 1] - a[1]) - (b[1] - a[1]) * (g[:, 0] - a[0]) >= -1e-9
        slit = max(slit, float((inside & cov).sum() / max(1, inside.sum())))
    dense = np.concatenate([poly[i] + (poly[(i + 1) % len(poly)] - poly[i]) * np.linspace(0, 1, 8, endpoint=False)[:, None] for i in range(len(poly))])
    reach, clear = 0, None
    for psi in np.linspace(0, PSI_MAX, 64):
        q = rot(dense, P, DIR * psi)
        r = np.hypot(q[:, 0], q[:, 1])
        reach = max(reach, r.max())
        if clear is None and r.min() >= 1.0:
            clear = psi
    open_min = np.hypot(*rot(dense, P, DIR * PSI_MAX).T).min()
    return {'uncovered': uncovered, 'slit': slit, 'reach': float(reach), 'clearsAt': math.degrees(clear or -1), 'openMinR': float(open_min)}


def hull(q):
    """Convex hull (counter-clockwise) of 2D points."""
    q = q[np.lexsort((q[:, 1], q[:, 0]))]
    def half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and area2(h[-2], h[-1], p) <= 0:
                h.pop()
            h.append(p)
        return h
    lo, up = half(q), half(q[::-1])
    return lo[:-1] + up[:-1]


# ---- the actuator: a pin per blade, riding in a straight slot cut in the blade's band ----
SLOT_C = rim(0.42, RP + BOSS * 0.5)                       # the slot's middle (shut), in the band
SLOT_D = SLOT_C / np.linalg.norm(SLOT_C)                   # running radially (as the blade stands shut)


def pin_at(psi):
    """Where the actuator pin must be when the blade has swung psi: the rotated slot's line meets the pin circle."""
    c = rot(SLOT_C[None], P, DIR * psi)[0]
    d = rot(SLOT_D[None], np.zeros(2), DIR * psi)[0]
    ra = np.linalg.norm(SLOT_C)
    # |c + s d| = ra, nearest s to 0
    b, cc = 2 * c @ d, c @ c - ra * ra
    s = min([(-b + math.sqrt(max(0.0, b * b - 4 * cc))) / 2, (-b - math.sqrt(max(0.0, b * b - 4 * cc))) / 2], key=abs)
    return c + s * d


BETA = []
for f in np.linspace(0, 1, 17):
    p0, p1 = pin_at(0.0), pin_at(f * PSI_MAX)
    BETA.append(math.atan2(p1[1], p1[0]) - math.atan2(p0[1], p0[0]))


# ---- meshes (Blender Z up: game (x, y, z) = Blender (x, -z... ) -> use (x, -v, h) for game (u, h, v)) ----
def g2b(u, v, h):
    return (u, -v, h)


def blade_mesh():
    """The blade as a solid: its outline filled with ear_clip's triangles (a grid between the two edges folds over near
    the tip, where they cross), the top ramped by the across-fraction of each outline point, the bottom THICK below,
    and walls."""
    clean = outline_pts()
    tris = ear_clip(np.array([p for p, _ in clean]))
    bm = bmesh.new()
    top = [bm.verts.new(g2b(p[0] - P[0], p[1] - P[1], Y0 - RAMP * f)) for (p, f) in clean]
    bot = [bm.verts.new(g2b(p[0] - P[0], p[1] - P[1], Y0 - RAMP * f - THICK)) for (p, f) in clean]
    for a, b, c in tris:
        bm.faces.new((top[a], top[b], top[c]))
        bm.faces.new((bot[c], bot[b], bot[a]))
    n = len(clean)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[j], top[i], bot[i], bot[j]))
    # Face the top up, the bottom down and the walls out (a thin solid confuses recalc_face_normals).
    tops, bots = set(top), set(bot)
    cx = sum((v.co for v in top), mathutils.Vector()) / len(top)
    bm.normal_update()
    flip = []
    for f in bm.faces:
        vs = set(f.verts)
        if vs <= tops:
            want = f.normal.z > 0
        elif vs <= bots:
            want = f.normal.z < 0
        else:
            c = f.calc_center_median()
            out = mathutils.Vector((c.x - cx.x, c.y - cx.y, 0))
            want = f.normal.dot(out) >= 0
        if not want:
            flip.append(f)
    bmesh.ops.reverse_faces(bm, faces=flip)
    return bm


def ring_mesh(r0, r1, h0, h1, pins, pin_r, pin_h, segs=96):
    bm = bmesh.new()
    def cyl(cx, cy, r, z0, z1, n, cap=True):
        a = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z0)) for i in range(n)]
        b = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z1)) for i in range(n)]
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
        if cap:
            bm.faces.new(b)
            bm.faces.new(a[::-1])
        return a, b
    oa, ob = cyl(0, 0, r1, h0, h1, segs, False)
    ia, ib = cyl(0, 0, r0, h0, h1, segs, False)
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((ob[i], ob[j], ib[j], ib[i]))
        bm.faces.new((oa[j], oa[i], ia[i], ia[j]))
    for (x, y) in pins:
        cyl(x, y, pin_r, h1, h1 + pin_h, 12)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def to_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    res = check()
    print('IRIS_CHECK', json.dumps(res))
    assert res['uncovered'] == 0, 'blades leave a gap when shut'
    assert res['openMinR'] >= 1.0, 'blades still in the opening when open'
    assert res['slit'] < 0.012, 'the opening parts into a star (slits between blades) on the way'
    to_object('Blade', blade_mesh())
    pivots = [g2b(RP * math.cos(2 * math.pi * i / N), RP * math.sin(2 * math.pi * i / N), 0)[:2] for i in range(N)]
    base_top = Y0 - RAMP - THICK - 0.004
    to_object('Base', ring_mesh(RP - 0.06, res['reach'] + 0.04, base_top - 0.01, base_top, pivots, 0.016, 0.03))
    ra = float(np.linalg.norm(SLOT_C))
    drive = [g2b(*(rot(SLOT_C[None], np.zeros(2), 2 * math.pi * i / N)[0]), 0)[:2] for i in range(N)]
    to_object('Actuator', ring_mesh(ra - 0.03, ra + 0.03, base_top - 0.022, base_top - 0.012, drive, 0.012, 0.0))
    meta = bpy.data.objects.new('IRIS_META', None)
    bpy.context.scene.collection.objects.link(meta)
    for k, v in {'n': N, 'rp': RP, 'psiMax': PSI_MAX, 'dir': DIR, 'reach': res['reach'], 'y0': Y0, 'beta': BETA,
                 'uncovered': res['uncovered'], 'slit': res['slit'], 'clearsAt': res['clearsAt']}.items():
        meta[k] = v
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_apply=True, export_yup=True)
    print('IRIS_RESULT', json.dumps({'file': OUT, **res, 'beta_end_deg': math.degrees(BETA[-1])}))


if __name__ == '__main__' or bpy.app.background:
    build()
