# Dreambound: the underground hub cavern, its four tunnels, and the generator that powers them.
# Executed inside dbkit.py's namespace by build_cave.py.
#
# Model coordinates: origin at the hub floor centre, +Y up. Angles follow the tunnel spokes' convention
# (direction = (cos a, 0, sin a)). The game places the model at TUNNEL_ORIGIN + (0, -3, 0).
#
# Lighting is baked per power line: each tunnel's lamps (and the lamp over its elevator) bake into their own
# lightmap channel, the generator's always-on lamps into another, plus AO. The game weights those channels by
# the switch states, so no dynamic lights are needed underground.

from mathutils import noise as mnoise
from mathutils.bvhtree import BVHTree

MATS.update({
    'rock': ((0.25, 0.2, 0.16), 0.9), 'paint': ((0.24, 0.28, 0.19), 0.6), 'plain': ((0.45, 0.44, 0.42), 0.6),
    'metal': ((0.3, 0.3, 0.31), 0.4), 'poster': ((0.9, 0.88, 0.8), 0.8),
    'lamps': ((1.0, 0.7, 0.3), 0.4), 'screen': ((0.1, 0.5, 0.4), 0.2),
})
NO_BAKE = {'lamps', 'screen', 'collider'}
BAKE_MATS = {'rock', 'paint', 'plain', 'metal', 'poster'}

LINES = ['tower', 'mountain', 'rocks', 'dome']     # switch order on the panel, left to right
SPOKES = {'dome': (-140, 78, 9, 3), 'rocks': (155, 92, 12, 5), 'mountain': (35, 86, 10, 7), 'tower': (-55, 80, 11, 9)}
R0, WALL_H, TOP = 14.0, 4.6, 9.6         # hub radius at the floor, height of the upright wall, crown height
VA, VB = R0 - 0.6, TOP - WALL_H          # the vault's semi-axes
YC = 1.15                                # tunnel centreline above its floor
TR = 1.9                                 # tunnel radius
GEN_A = 95.0                             # the generator's recess (deg)
BACK_D, REC_TOP = 15.0, 5.0              # recess back wall distance from the centre, recess ceiling
PW0, PD, RI = 13.0, 1.4, 2.35            # tunnel portal: front plane, depth, opening radius
PHW, PTOP, PR = 3.3, 4.6, 4.2            # portal outline: half width, top, corner rounding radius (about the axis)
PLATE_HW, PLATE_H = 1.85, 3.3            # the elevator's front plate (built by the game)

def D(d):
    return math.radians(d)

def dir_of(a_deg):
    a = D(a_deg)
    return Vector((math.cos(a), 0.0, math.sin(a)))

def smooth01(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def ang_diff(a, b):
    return abs((a - b + 180.0) % 360.0 - 180.0)

# ---------------------------------------------------------------- palette (linear)
ROCK_T = srgb(236, 226, 214)
PAINT_T = WHITE
STEEL = srgb(104, 106, 108)
DARKSTEEL = srgb(50, 50, 52)
CHROME = srgb(206, 206, 210)
BLACKP = srgb(22, 22, 22)
YELLOW = srgb(226, 176, 30)
CONCRETE = srgb(150, 144, 134)
CREAMP = srgb(236, 230, 214)
COPPER = srgb(176, 100, 60)

# ============================================================================ helpers
# Lightmap layout: the rock's and the pipes' own UVs are authored in metres, one island per unwrapped piece, and become the
# lightmap UVs (dbkit packs them). Pieces get far-apart offsets so they never join into one island.
_isl = {'k': 0}

def island():
    _isl['k'] += 1
    return _isl['k'] * 400.0

def rock_col(co):
    k = 0.8 + 0.3 * (mnoise.fractal(co * 0.21, 0.6, 2.0, 3) * 0.5 + 0.5)
    return (k, k * 0.98, k * 0.95)

def floor_col(co):
    k = 0.72 + 0.22 * (mnoise.fractal(co * 0.3 + Vector((7, 0, 3)), 0.6, 2.0, 3) * 0.5 + 0.5)
    return (k, k * 0.97, k * 0.93)

def rounded(pts, rad=0.22, n=3):
    """Round the corners of a polyline (conduits bend, they don't kink)."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        la, lc = (b - a).length, (c - b).length
        if la < 1e-6 or lc < 1e-6:
            continue
        r = min(rad, la * 0.45, lc * 0.45)
        p0 = b + (a - b).normalized() * r
        p2 = b + (c - b).normalized() * r
        for k in range(n + 1):
            t = k / n
            out.append(p0 * (1 - t) ** 2 + b * 2 * t * (1 - t) + p2 * t * t)
    out.append(pts[-1])
    return out

def tube(mat, pts, r, sides=8, tint=DARKSTEEL, seg_len=8.0):
    """A round tube along a polyline with lightmap-ready UVs: length x circumference, cut every seg_len metres."""
    pts = [Vector(p) for p in pts]
    bm = bm_tube(pts, r, sides)
    lay = bm.verts.layers.int.new('gid')
    for idx, v in enumerate(bm.verts):
        v[lay] = idx
    acc = [0.0]
    for k in range(1, len(pts)):
        acc.append(acc[-1] + (pts[k] - pts[k - 1]).length)
    circ = 2 * PI * r / sides
    offs = {}
    def uv(f):
        ids = [l.vert[lay] for l in f.loops]
        ii, jj = [g // sides for g in ids], [g % sides for g in ids]
        if max(jj) - min(jj) > 1:
            jj = [sides if j == 0 else j for j in jj]
        off = offs.setdefault(int(acc[min(ii)] // seg_len), island())
        return [(acc[i] + off, j * circ) for i, j in zip(ii, jj)]
    emit(bm, mat, None, tint, smooth=True, uvface=uv)

def conduit(pts, r=0.045, tint=DARKSTEEL):
    tube('metal', rounded(pts), r, 8, tint=tint)

def Mg(g, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0):
    x, y, z = g.p(lx, ly, lz)
    return xf(x, y, z, g.ry + ry, rx, rz)

def quad(w, h, z=0.0):
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in ((-w / 2, -h / 2, z), (w / 2, -h / 2, z), (w / 2, h / 2, z), (-w / 2, h / 2, z))])
    return bm

def face_uv(M, w, h):
    """UVs 0..1 across a w x h quad placed by M."""
    Mi = M.inverted()
    def f(co, n):
        p = Mi @ co
        return (p.x / w + 0.5, p.y / h + 0.5)
    return f

def orient(bm, want):
    """Flip faces so their normals agree with want(face_center) -> Vector."""
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.dot(want(f.calc_center_median())) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    return bm

_lid = {'n': 0}

def lamp_at(p, kind, size=0.045):
    """An emissive bulb. The game lights it by kind: 1 steady, 0 random, 3 chatter, 10+i switch i's
    bulb, 20+i power line i's lamps."""
    i = _lid['n']
    _lid['n'] += 1
    emit(bm_sphere(size, 10, 7), 'lamps', Matrix.Translation(p), WHITE, uvfn=lambda co, n: (0.5, 0.5), uvofs=(i, kind))

LIGHTS = []   # (position, energy, group)

def bulb_fixture(p, group, power=30.0, shade=True):
    """A caged bulb, optionally under a small enamel shade. group: a line name or 'hub'."""
    p = Vector(p)
    kind = 1 if group == 'hub' else 20 + LINES.index(group)
    lamp_at(p, kind, size=0.055)
    for k in range(3):
        emit(bm_torus(0.085, 0.006, 16, 4), 'plain', Matrix.Translation(p) @ Matrix.Rotation(k * PI / 3, 4, 'Y') @ Matrix.Rotation(PI / 2, 4, 'X'), DARKSTEEL)
    emit(bm_torus(0.086, 0.007, 16, 4), 'plain', Matrix.Translation(p + Vector((0, -0.02, 0))), DARKSTEEL)
    if shade:
        emit(bm_lathe([(0.17, 0.05), (0.16, 0.06), (0.07, 0.12), (0.03, 0.14)], 16), 'paint', Matrix.Translation(p), mul(PAINT_T, 0.9), smooth=True)
        emit(bm_lathe([(0.028, 0.132), (0.068, 0.115), (0.155, 0.06), (0.168, 0.052)], 16), 'plain', Matrix.Translation(p), CREAMP, smooth=True)
    LIGHTS.append((p.copy(), power, group))

def stalactite(base, h, w, seed, down):
    bm = bm_cyl(0.0, 1.0, 1.0, 7, caps=False)
    lay = bm.verts.layers.int.new('gid')
    for idx, v in enumerate(bm.verts):
        v[lay] = idx
    off, cw, hh = island(), 2 * PI * w / 7, h * 1.05
    def uv(f):
        ids = [l.vert[lay] for l in f.loops]
        bots = [i for i in ids if i < 7]
        if max(bots) - min(bots) > 1:
            bots = [7 if i == 0 else i for i in bots]
        mid = (min(bots) + 0.5) * cw
        out, b = [], iter(bots)
        for i in ids:
            out.append((mid + off, hh) if i == 7 else (next(b) * cw + off, 0.0))
        return out
    for v in bm.verts:
        n = mnoise.noise(Vector((v.co.x * 2 + seed, v.co.y * 3, v.co.z * 2))) * 0.18
        v.co.x *= 1 + n
        v.co.z *= 1 + n
    S = Matrix.Diagonal((w, h, w, 1.0)) @ Matrix.Translation((0, 0.5, 0))
    M = Matrix.Translation(base) @ (Matrix.Rotation(PI, 4, 'X') if down else Matrix.Identity(4)) @ S
    emit(bm, 'rock', M, mul(ROCK_T, 0.95), smooth=True, uvface=uv)

# ============================================================================ the hub's rock
def wall_noise(p):
    return mnoise.fractal(p * 0.16, 0.55, 2.0, 4)

def hub_point(a_deg, y):
    """The hub's rock surface at angle a (deg) and height y."""
    d = dir_of(a_deg)
    if y <= WALL_H:
        E = d * (R0 - (y / WALL_H) * 0.6) + Vector((0, y, 0))
        N = d.copy()
        top_k = 1.0
    else:
        phi = math.asin(min(0.9995, (y - WALL_H) / VB))
        E = d * (VA * math.cos(phi)) + Vector((0, y, 0))
        N = (d * (math.cos(phi) / VA) + Vector((0, math.sin(phi) / VB, 0))).normalized()
        top_k = min(1.0, VA * math.cos(phi) / 4.0 + 0.3)
    calm = 1.0
    for (sa, *_r) in SPOKES.values():
        calm = min(calm, 0.15 + 0.85 * smooth01(13, 30, ang_diff(a_deg, sa)))
    calm = min(calm, 0.2 + 0.8 * smooth01(19, 34, ang_diff(a_deg, GEN_A)))
    amp = (0.65 + 0.85 * smooth01(WALL_H - 1, TOP, y)) * calm * top_k
    p = E + N * (wall_noise(E) * amp)
    # The generator's recess: a flat back wall BACK_D out, up to REC_TOP.
    da = ang_diff(a_deg, GEN_A)
    if da < 24 and y < REC_TOP + 0.8:
        hd = Vector((p.x, 0, p.z))
        rh = hd.length
        hd.normalize()
        plane = BACK_D / max(0.2, math.cos(D(da)))
        k = (1 - smooth01(17.0, 20.5, da)) * (1 - smooth01(REC_TOP, REC_TOP + 0.7, y))
        rh = rh + (max(rh, plane) - rh) * k
        p = Vector((hd.x * rh, p.y, hd.z * rh))
    return p

def wall_normal(a_deg, y):
    """Unit vector pointing from the rock into the hub at (a, y)."""
    p = hub_point(a_deg, y)
    t1 = hub_point(a_deg + 0.5, y) - p
    t2 = hub_point(a_deg, y + 0.1) - p
    n = t2.cross(t1).normalized()
    if n.dot(Vector((-p.x, 0, -p.z))) < 0:
        n = -n
    return n

def in_mouth(c, pad=0.0):
    for (sa, *_r) in SPOKES.values():
        d = dir_of(sa)
        along = c.dot(d)
        perp = (c - d * along - Vector((0, YC, 0))).length
        if along > R0 - 3 and perp < 2.9 + pad:
            return True
    return False

def build_hub():
    set_origin(0, 0, 0)
    bm = bmesh.new()
    na = 144
    ys = [-0.3 + (WALL_H + 0.3) * j / 14 for j in range(15)]
    ys += [WALL_H + VB * math.sin(D(84.0 * j / 20)) for j in range(1, 21)]
    lay = bm.verts.layers.int.new('gid')
    grid = [[bm.verts.new(hub_point(360.0 * i / na, y)) for i in range(na)] for y in ys]
    for j, row in enumerate(grid):
        for i, v in enumerate(row):
            v[lay] = j * na + i
    top = bm.verts.new((0, TOP + wall_noise(Vector((0, TOP, 0))) * 0.4, 0))
    top[lay] = -1
    for j in range(len(grid) - 1):
        for i in range(na):
            k = (i + 1) % na
            bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][k], grid[j][k]))
    for i in range(na):
        bm.faces.new((grid[-1][i], top, grid[-1][(i + 1) % na]))
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if in_mouth(f.calc_center_median())], context='FACES')
    orient(bm, lambda c: Vector((0, 3.0, 0)) - c)
    bvh = BVHTree.FromBMesh(bm)
    # Unwrap: the wall and the lower vault as eight 45 degree sectors (angle x height along the profile), the
    # crown as a disc seen from above.
    nominal = [Vector((R0 - (y / WALL_H) * 0.6 if y <= WALL_H else VA * math.cos(math.asin(min(1.0, (y - WALL_H) / VB))), y)) for y in ys]
    rowv = [0.0]
    for j in range(1, len(ys)):
        rowv.append(rowv[-1] + (nominal[j] - nominal[j - 1]).length)
    JV = 24
    cap_off, sec_off, seg = island(), [island() for _ in range(8)], 2 * PI * R0 / na
    def hub_uv(f):
        ids = [l.vert[lay] for l in f.loops]
        if -1 in ids or max(g // na for g in ids) > JV:
            return [(l.vert.co.x + cap_off, l.vert.co.z) for l in f.loops]
        cols = [g % na for g in ids]
        if max(cols) - min(cols) > 1:
            cols = [c + na if c == 0 else c for c in cols]
        off = sec_off[(min(cols) // (na // 8)) % 8]
        return [(c * seg + off, rowv[g // na]) for c, g in zip(cols, ids)]
    emit(bm, 'rock', None, ROCK_T, 1.8, colfn=rock_col, smooth=True, uvface=hub_uv)
    # Floor: a gently uneven disc reaching under the rock all round (and into the recess).
    bm = bmesh.new()
    rings, segs = 18, 144
    centre = bm.verts.new((0, 0.0, 0))
    prev = None
    for j in range(1, rings + 1):
        ring = []
        for i in range(segs):
            a = 360.0 * i / segs
            w = hub_point(a, -0.3)
            rout = Vector((w.x, 0, w.z)).length + 0.35       # just past the foot of the wall
            rr = rout * (j / rings) ** 0.9
            p = dir_of(a) * rr
            p.y = mnoise.fractal(p * 0.35, 0.5, 2.0, 3) * 0.035
            ring.append(bm.verts.new(p))
        if prev is None:
            for i in range(segs):
                bm.faces.new((centre, ring[(i + 1) % segs], ring[i]))
        else:
            for i in range(segs):
                k = (i + 1) % segs
                bm.faces.new((prev[i], prev[k], ring[k], ring[i]))
        prev = ring
    orient(bm, lambda c: Vector((0, 1, 0)))
    foff = island()
    emit(bm, 'rock', None, ROCK_T, 1.8, colfn=floor_col, smooth=True, uvfn=lambda co, n: (co.x + foff, co.z))
    # Stalactites and stalagmites, clear of the mouths, the recess and the walkways.
    r = random.Random(11)
    placed = 0
    for i in range(400):
        if placed >= 110:
            break
        a = r.uniform(0, 360)
        dd = r.uniform(2.5, R0 - 1.2)
        p = dir_of(a) * dd
        lane = False
        for (sa, *_x) in SPOKES.values():
            dv = dir_of(sa)
            along = p.dot(dv)
            if along > 0 and (p - dv * along).length < 3.3:
                lane = True
        dg = dir_of(GEN_A)
        along = p.dot(dg)
        if along > 0 and (p - dg * along).length < 5.5:
            lane = True
            if dd > 6.5:
                continue                  # keep the view of the generator clear
        if i % 3 != 2:
            hit = bvh.ray_cast(Vector((p.x, 3.0, p.z)), Vector((0, 1, 0)), 20.0)
            if hit[0] is None:
                continue
            ceil = hit[0].y
            room = ceil - 2.9 if lane or dd < 6 else ceil - 1.2
            if room < 0.4:
                continue
            h = min(room, r.uniform(0.5, 2.6))
            stalactite(Vector((p.x, ceil + 0.3, p.z)), h + 0.3, (h + 0.3) * r.uniform(0.1, 0.17), r.random() * 1000, down=True)
            placed += 1
        elif not lane and 5.0 < dd < R0 - 1.6:
            h = r.uniform(0.4, 1.9)
            stalactite(Vector((p.x, -0.05, p.z)), h, h * r.uniform(0.22, 0.34), r.random() * 1000, down=False)
            C(p.x, h * 0.35, p.z, h * 0.42, h * 0.7, h * 0.42)
            placed += 1

# ============================================================================ tunnel portals
def portal_shape(n=64):
    """(inner, outer) points in portal coords (u across, v up), swept over the top from floor to floor."""
    th0 = math.asin(-YC / RI)
    angs = [th0 + (PI - 2 * th0) * k / n for k in range(n + 1)]
    side_v = math.sqrt(PR ** 2 - PHW ** 2)                  # where the rounding meets the sides
    top_u = math.sqrt(PR ** 2 - (PTOP - YC) ** 2)           # ... and the top
    for extra in (math.atan2(-YC, PHW), math.atan2(side_v, PHW), math.atan2(PTOP - YC, top_u)):
        angs += [extra, PI - extra]
    angs = sorted(set(round(a, 6) for a in angs))
    inner, outer = [], []
    for a in angs:
        c, s = math.cos(a), math.sin(a)
        t = PR
        if abs(c) > 1e-6:
            t = min(t, PHW / abs(c))
        if s > 1e-6:
            t = min(t, (PTOP - YC) / s)
        if s < -1e-6:
            t = min(t, YC / -s)
        inner.append((c * RI, YC + s * RI))
        outer.append((c * t, YC + s * t))
    return inner, outer

def build_portal(name):
    set_origin(0, 0, 0)
    d = dir_of(SPOKES[name][0])
    sd = Vector((-d.z, 0, d.x))
    P = lambda u, v, w: d * (PW0 + w) + sd * u + Vector((0, v, 0))
    inner, outer = portal_shape()
    n = len(inner)
    bm = bmesh.new()
    fi = [bm.verts.new(P(u, v, 0)) for (u, v) in inner]
    fo = [bm.verts.new(P(u, v, 0)) for (u, v) in outer]
    bi = [bm.verts.new(P(u, v, PD)) for (u, v) in inner]
    bo = [bm.verts.new(P(u, v, PD)) for (u, v) in outer]
    for i in range(n - 1):
        j = i + 1
        for quad_ in ((fi[i], fo[i], fo[j], fi[j]), (bi[j], bo[j], bo[i], bi[i]), (fi[j], bi[j], bi[i], fi[i])):
            try:
                bm.faces.new(quad_)
            except ValueError:
                pass
        if outer[i][1] > 0.01 or outer[j][1] > 0.01:
            bm.faces.new((fo[i], bo[i], bo[j], fo[j]))
    # Front faces look at the hub, the back faces down the tunnel; the opening's sides look at its axis.
    def want(c):
        w = (c - d * PW0).dot(d)
        rel = c - d * c.dot(d) - Vector((0, YC, 0))
        if w < 0.02:
            return -d
        if w > PD - 0.02:
            return d
        return -rel if rel.length < RI + 0.05 else rel
    orient(bm, want)
    emit(bm, 'plain', None, CONCRETE, 1.2)
    # A steel arch set on the face, a hazard header, and a collar collider each side.
    a0 = math.asin(-YC / (RI + 0.06))
    arc = [P(math.cos(a) * (RI + 0.06), YC + math.sin(a) * (RI + 0.06), -0.06)
           for a in [a0 + (PI - 2 * a0) * k / 40 for k in range(41)]]
    ctr = lambda p: (p - d * p.dot(d) - Vector((0, YC, 0))).normalized()
    emit(bm_sweep(arc, rect_section(0.16, 0.24, -0.12), up=ctr), 'plain', None, STEEL)
    ry = math.atan2(-d.x, -d.z)
    Mh = Matrix.Translation(P(0, YC + RI + 0.4, -0.02)) @ Matrix.Rotation(ry, 4, 'Y')
    emit(bm_box(2.6, 0.26, 0.04), 'plain', Mh, YELLOW)
    for k in range(9):
        x = -1.2 + k * 0.27
        emit(bm_prism([(x, -0.13), (x + 0.1, -0.13), (x + 0.2, 0.13), (x + 0.1, 0.13)], 0.02, 0.025, 'x'), 'plain', Mh, BLACKP)
    for s_ in (-1, 1):
        c = P(s_ * 2.9, 1.6, PD / 2)
        C(c.x, c.y, c.z, 1.1, 3.2, PD, ry)
    # The line's lamp over the mouth: from the hub you can see which tunnels are live.
    beam('plain', tuple(P(-0.9, 4.42, 0.02)), tuple(P(-0.9, 4.42, -0.45)), 0.05, 0.05, DARKSTEEL)
    beam('plain', tuple(P(-0.9, 4.44, -0.42)), tuple(P(-0.9, 4.32, -0.42)), 0.03, 0.03, DARKSTEEL)
    bulb_fixture(P(-0.9, 4.2, -0.42), name, power=40.0)

# ============================================================================ tunnels
STATIONS = {}
TUNNEL = {}

def catmull(pts, spacing):
    """Uniform Catmull-Rom through pts, resampled every `spacing` metres: [(point, tangent, s)]."""
    P = [pts[0] + (pts[0] - pts[1])] + list(pts) + [pts[-1] + (pts[-1] - pts[-2])]
    dense = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(24):
            t = k / 24
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    dense.append(pts[-1].copy())
    acc = [0.0]
    for i in range(1, len(dense)):
        acc.append(acc[-1] + (dense[i] - dense[i - 1]).length)
    total = acc[-1]
    n = max(2, int(total / spacing))
    out, j = [], 0
    for k in range(n + 1):
        s = total * k / n
        while j < len(acc) - 2 and acc[j + 1] < s:
            j += 1
        u = (s - acc[j]) / max(1e-6, acc[j + 1] - acc[j])
        p = dense[j].lerp(dense[j + 1], u)
        t = (dense[min(j + 1, len(dense) - 1)] - dense[j]).normalized()
        out.append((p, t, s))
    return out

def spoke_curve(name):
    a, length, wiggle, seed = SPOKES[name]
    d = dir_of(a)
    side = Vector((-d.z, 0, d.x))
    r = random.Random(seed)
    pts = []
    n = 7
    for i in range(n + 1):
        t = i / n
        along = R0 - 0.7 + t * (length - R0)
        w = 0.0 if i in (0, 1, n) else math.sin(t * PI * 2.2 + seed) * wiggle * (0.6 + r.random() * 0.4)
        y = YC + (0.0 if i <= 1 else math.sin(t * PI * 1.7 + seed) * 1.4)
        pts.append(d * along + side * w + Vector((0, y, 0)))
    pts[0] = d * (PW0 + 0.1) + Vector((0, YC, 0))
    end = pts[-1]
    back = pts[-2] - end
    back.y = 0
    back.normalize()
    pts.insert(n, end + back * 6.0)                         # straight final approach to the elevator
    pts.insert(1, d * (R0 + 2.5) + Vector((0, YC, 0)))      # leave the hub square to the wall
    return catmull(pts, 0.6)

def frame_at(t):
    s = t.cross(Vector((0, 1, 0)))
    if s.length < 1e-4:
        s = Vector((1, 0, 0))
    s.normalize()
    return s, s.cross(t).normalized()

def _axis_dir(samples, cc):
    best, bd = None, 1e9
    for (c, t, s) in samples[::2]:
        dd = (c - cc).length_squared
        if dd < bd:
            bd, best = dd, (c, t)
    c, t = best
    v = c - cc
    return v - t * v.dot(t)

def build_tunnel(name):
    set_origin(0, 0, 0)
    samples = spoke_curve(name)
    total = samples[-1][2]
    seed = SPOKES[name][3]
    radial = 18
    off = Vector((seed * 13.1, 0, 0))
    rows = []
    for (c, t, s) in samples:
        sd, up = frame_at(t)
        flare = 1.0 + 0.4 * (1 - smooth01(0.0, 3.0, s)) + 0.75 * smooth01(total - 6.5, total - 0.6, s)
        calm = smooth01(1.5, 5.0, s) * (1 - 0.7 * smooth01(total - 7.0, total - 2.0, s))
        sink = 0.06 * (1 - smooth01(2.5, 4.0, s))
        rows.append((c, t, s, sd, up, flare, calm, sink))
    def wall_r(row, a):
        c, t, s, sd, up, flare, calm, sink = row
        dirv = sd * math.cos(a) + up * math.sin(a)
        p0 = c + dirv * TR * flare
        return TR * flare + mnoise.fractal(p0 * 0.35 + off, 0.55, 2.0, 3) * 0.34 * calm, dirv
    bm = bmesh.new()
    lay = bm.verts.layers.int.new('gid')
    rings = []
    for i, row in enumerate(rows):
        c = row[0]
        fl = c.y - YC - row[7]
        ring = []
        for j in range(radial):
            rr, dirv = wall_r(row, 2 * PI * j / radial)
            p = c + dirv * rr
            if p.y < fl:
                p.y = fl + mnoise.noise(p * 0.8) * 0.02
            v = bm.verts.new(p)
            v[lay] = i * radial + j
            ring.append(v)
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(radial):
            k = (j + 1) % radial
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
    orient(bm, lambda cc: _axis_dir(samples, cc))
    bvh = BVHTree.FromBMesh(bm)
    ring_last = [v.co.copy() for v in rings[-1]]
    # Unwrap: length along the tunnel x distance around it, cut into ~14 m islands.
    circ = [2 * PI * TR * row[5] / radial for row in rows]
    offs = {}
    def tun_uv(f):
        ids = [l.vert[lay] for l in f.loops]
        ii, jj = [g // radial for g in ids], [g % radial for g in ids]
        if max(jj) - min(jj) > 1:
            jj = [radial if j == 0 else j for j in jj]
        off = offs.setdefault(min(ii) // 24, island())
        return [(samples[i][2] + off, j * circ[i]) for i, j in zip(ii, jj)]
    emit(bm, 'rock', None, ROCK_T, 1.8, colfn=rock_col, smooth=True, uvface=tun_uv)
    # Station: the elevator plate stands in the end wall, facing back up the tunnel.
    c_end, t_end = samples[-1][0], samples[-1][1]
    back = -t_end
    back.y = 0
    back.normalize()
    plate = Vector((c_end.x, c_end.y - YC, c_end.z))
    rot = math.atan2(back.x, back.z)
    STATIONS[name] = (plate, rot)
    g = G(plate.x, plate.y, plate.z, rot)            # local +z looks back up the tunnel
    Mw = xf(plate.x, plate.y, plate.z, rot)
    Mi = Mw.inverted()
    # End wall: a band from the last rock ring in to the plate's rectangle (hidden behind the plate).
    hw, hh = PLATE_HW + 0.07, PLATE_H + 0.1
    bm2 = bmesh.new()
    ov, iv = [], []
    for co in ring_last:
        lp = Mi @ co
        ang = math.atan2(lp.y - hh * 0.5, lp.x)
        dx, dy = math.cos(ang), math.sin(ang)
        k = min(hw / max(1e-6, abs(dx)), (hh * 0.5) / max(1e-6, abs(dy)))
        ov.append(bm2.verts.new(Mw @ Vector((lp.x, lp.y, -0.06))))
        iv.append(bm2.verts.new(Mw @ Vector((dx * k, hh * 0.5 + dy * k, -0.06))))
    for i in range(len(ov)):
        k = (i + 1) % len(ov)
        try:
            bm2.faces.new((ov[i], ov[k], iv[k], iv[i]))
        except ValueError:
            pass
    fwd = (Mw.to_3x3() @ Vector((0, 0, 1))).normalized()
    orient(bm2, lambda cc: fwd)
    eoff = island()
    emit(bm2, 'rock', None, mul(ROCK_T, 0.9), 1.8, colfn=rock_col, uvfn=lambda co, n: ((Mi @ co).x + eoff, (Mi @ co).y))
    # Steel portal round the plate, a junction box where the conduit ends, a lamp over the door.
    for sx in (-1, 1):
        g.box('plain', 0.2, PLATE_H + 0.22, 0.24, sx * (PLATE_HW + 0.07), (PLATE_H + 0.22) / 2, 0.0, tint=STEEL)
    g.box('plain', 2 * PLATE_HW + 0.5, 0.22, 0.26, 0, PLATE_H + 0.11, 0.0, tint=STEEL)
    hazard_band(g, -PLATE_HW - 0.17, PLATE_HW + 0.17, PLATE_H + 0.11, 0.13, h=0.16, depth=0.01)
    jx = PLATE_HW + 0.62
    g.box('paint', 0.44, 0.58, 0.2, jx, 2.2, 0.06, tint=PAINT_T, bevel=0.02)
    g.box('plain', 0.3, 0.05, 0.02, jx, 2.0, 0.17, tint=YELLOW)
    lamp_at(Vector(g.p(jx, 2.38, 0.17)), 20 + LINES.index(name), size=0.028)
    g.box('plain', 0.14, 0.1, 0.34, 0, PLATE_H + 0.45, 0.12, tint=DARKSTEEL)
    bulb_fixture(g.p(0, PLATE_H + 0.3, 0.34), name, power=22.0)
    empty('DOORLAMP_' + name, g.p(0, PLATE_H + 0.3, 0.6))
    TUNNEL[name] = (samples, rows, wall_r, bvh, g, jx)
    # A few stalactites along the way, hanging from the actual ceiling.
    r = random.Random(seed * 7)
    for idx in range(10, len(samples) - 14, 9):
        if r.random() < 0.55:
            c, t, s = samples[idx]
            sd, up = frame_at(t)
            o = c + sd * r.uniform(-0.9, 0.9)
            hit = bvh.ray_cast(o, Vector((0, 1, 0)), 6.0)
            if hit[0] is None:
                continue
            room = hit[0].y - (c.y - YC) - 2.9
            if room < 0.25:
                continue
            h = min(room, r.uniform(0.25, 0.8))
            stalactite(hit[0] + Vector((0, 0.2, 0)), h + 0.2, (h + 0.2) * 0.2, r.random() * 1000, down=True)

# ============================================================================ generator
GEN = {}

def hazard_band(g, x0, x1, y, z, h=0.12, depth=0.02):
    g.box('plain', x1 - x0, h, depth, (x0 + x1) / 2, y, z, tint=YELLOW)
    x = x0 + 0.05
    while x + 0.22 < x1:
        poly = [(0.0, -h / 2), (0.1, -h / 2), (0.2, h / 2), (0.1, h / 2)]
        g.put(bm_prism(poly, 0.0, 0.004, 'x'), 'plain', x, y, z + depth / 2, tint=BLACKP)
        x += 0.24

def rivets(g, xs, ys, z, r=0.012, tint=DARKSTEEL):
    for x in xs:
        for y in ys:
            g.put(bm_sphere(r, 6, 4), 'plain', x, y, z, tint=tint)

def danger_sign(M, size=0.5):
    """High-voltage warning: a black-edged yellow triangle with a black lightning bolt, on a small plate."""
    s = size
    tri = lambda k, z: [(-0.5 * s * k, -0.289 * s * k, z), (0.5 * s * k, -0.289 * s * k, z), (0.0, 0.577 * s * k, z)]
    emit(bm_box(s * 1.1, s * 1.0, 0.012), 'plain', M @ Matrix.Translation((0, 0.03 * s, -0.004)), DARKSTEEL)
    emit(bm_poly(tri(1.0, 0.004)), 'plain', M, BLACKP)
    emit(bm_poly(tri(0.8, 0.007)), 'plain', M @ Matrix.Translation((0, -0.012 * s, 0)), YELLOW)
    bolt = [(0.06, 0.34), (-0.13, 0.0), (0.0, 0.0), (-0.07, -0.26), (0.14, 0.06), (0.02, 0.06), (0.12, 0.34)]
    emit(bm_poly([(x * s * 0.8, (y - 0.05) * s * 0.8, 0.01) for (x, y) in bolt]), 'plain', M, BLACKP)

def drum_patch(g, x0, x1, dy, dz, r, a0, a1, tint=DARKSTEEL, t=0.02):
    """A curved plate on the drum (axis along local x) from angle a0 to a1 (0 faces out of the recess, + is up)."""
    bm = bmesh.new()
    n = 16
    rows = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        rows.append([bm.verts.new((x, dy + math.sin(a) * rr, dz + math.cos(a) * rr)) for (x, rr) in ((x0, r), (x1, r), (x1, r + t), (x0, r + t))])
    for i in range(n):
        A, B_ = rows[i], rows[i + 1]
        for k in range(4):
            l = (k + 1) % 4
            bm.faces.new((A[k], A[l], B_[l], B_[k]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit(bm, 'plain', Mg(g, 0, 0, 0), tint)

def build_generator():
    set_origin(0, 0, 0)
    d = dir_of(GEN_A)
    o = d * BACK_D
    g = G(o.x, 0.0, o.z, math.atan2(-d.x, -d.z))     # local +z looks into the hub, +x to the viewer's right
    GEN['g'] = g
    # Concrete frame of the recess: pilasters and a lintel.
    for sx in (-1, 1):
        g.box('plain', 0.36, 4.85, 1.45, sx * 4.63, 4.85 / 2, 0.62, tint=CONCRETE, bevel=0.02, col=True)
    g.box('plain', 9.62, 0.55, 0.6, 0, 4.575, 1.05, tint=CONCRETE, bevel=0.02)
    hazard_band(g, -4.45, 4.45, 4.36, 1.36, h=0.12, depth=0.01)
    # Concrete plinth with a hazard edge.
    g.box('plain', 8.9, 0.2, 2.1, 0.0, 0.1, 1.05, tint=CONCRETE, col=True)
    hazard_band(g, -4.4, 4.4, 0.1, 2.1, h=0.12)
    # ---- the generator drum (viewer's left) ----
    dx0, dx1, dy, dz, dr = -4.05, -0.95, 1.4, 1.2, 1.08
    emit(bm_cyl(dr, dr, dx1 - dx0, 48), 'paint', Mg(g, (dx0 + dx1) / 2, dy, dz, 0, 0, PI / 2), PAINT_T, smooth=True)
    for k in range(7):   # cooling bands
        xk = dx0 + 0.3 + k * (dx1 - dx0 - 0.6) / 6
        emit(bm_cyl(dr + 0.035, dr + 0.035, 0.07, 48), 'paint', Mg(g, xk, dy, dz, 0, 0, PI / 2), mul(PAINT_T, 0.8), smooth=True)
    # End cap with a louvred grille and a ring of bolts.
    emit(bm_cyl(dr + 0.05, dr + 0.05, 0.14, 48), 'paint', Mg(g, dx0 - 0.02, dy, dz, 0, 0, PI / 2), mul(PAINT_T, 0.75), smooth=True)
    for k in range(11):
        yy = dy - 0.75 + k * 0.15
        w = 2 * math.sqrt(max(0.0, (dr - 0.18) ** 2 - (yy - dy) ** 2))
        if w > 0.1:
            g.box('plain', 0.03, 0.08, w, dx0 - 0.1, yy, dz, rx=0.5, tint=DARKSTEEL)
    for k in range(18):
        a = 2 * PI * k / 18
        g.put(bm_sphere(0.028, 6, 4), 'plain', dx0 - 0.1, dy + math.sin(a) * (dr - 0.06), dz + math.cos(a) * (dr - 0.06), tint=STEEL)
    # Curved inspection plate with rivets, lifting eyes, cradle feet, the coupling into the cabinet.
    drum_patch(g, -3.2, -1.7, dy, dz, dr, -0.35, 0.45, tint=mul(DARKSTEEL, 0.85), t=0.022)
    for a in (-0.3, 0.4):
        for x in (-3.12, -2.86, -2.6, -2.34, -2.08, -1.82):
            g.put(bm_sphere(0.016, 6, 4), 'plain', x, dy + math.sin(a) * (dr + 0.024), dz + math.cos(a) * (dr + 0.024), tint=STEEL)
    for x in (dx0 + 0.55, dx1 - 0.45):
        g.box('plain', 0.2, 0.6, 1.7, x, 0.5, dz, tint=DARKSTEEL, bevel=0.02)
        emit(bm_torus(0.08, 0.022, 12, 6), 'plain', Mg(g, x, dy + dr + 0.1, dz) @ Matrix.Rotation(PI / 2, 4, 'X'), STEEL)
    emit(bm_cyl(0.62, 0.62, 0.34, 32), 'paint', Mg(g, dx1 + 0.12, dy, dz - 0.25, 0, 0, PI / 2), mul(PAINT_T, 0.7), smooth=True)
    emit(bm_cyl(0.3, 0.3, 0.3, 24), 'plain', Mg(g, dx1 + 0.3, dy, dz - 0.25, 0, 0, PI / 2), DARKSTEEL, smooth=True)
    C(*g.p((dx0 + dx1) / 2, 1.3, dz), dx1 - dx0 + 0.4, 2.6, 2.3, g.ry)
    danger_sign(Mg(g, -1.55, dy + 0.38, dz + dr * math.cos(0.36) + 0.02, 0, -0.36), 0.44)
    # Exhaust stack out of the drum into the rock.
    tube('metal', rounded([g.p(-3.4, dy + 0.9, dz - 0.3), g.p(-3.4, 3.4, dz - 0.3), g.p(-3.4, 3.9, 0.6), g.p(-3.4, 5.4, 0.05)], 0.3), 0.13, 12, tint=mul(COPPER, 0.6))
    # ---- the control cabinet (viewer's right) ----
    cx0, cx1, cy0, cy1, cz = -0.75, 4.05, 0.2, 3.3, 0.66
    g.box('paint', cx1 - cx0, cy1 - cy0, cz, (cx0 + cx1) / 2, (cy0 + cy1) / 2, cz / 2, tint=PAINT_T, bevel=0.02, col=True)
    g.box('paint', cx1 - cx0 + 0.1, 0.1, cz + 0.08, (cx0 + cx1) / 2, cy1 + 0.05, cz / 2, tint=mul(PAINT_T, 0.8))
    rivets(g, [cx0 + 0.08 + k * 0.3 for k in range(17)], [cy1 - 0.07, cy0 + 0.07], cz + 0.005)
    rivets(g, [cx0 + 0.06, cx1 - 0.06], [cy0 + 0.35 + k * 0.33 for k in range(9)], cz + 0.005)
    # CRT scope with a heavy bezel.
    sx, sy, sw, sh = 0.55, 2.5, 1.3, 0.9
    g.box('plain', sw + 0.26, sh + 0.24, 0.12, sx, sy, cz + 0.05, tint=DARKSTEEL, bevel=0.03)
    screen_quad(Mg(g, sx, sy, cz + 0.112), sw, sh)
    rivets(g, [sx - sw / 2 - 0.07, sx + sw / 2 + 0.07], [sy - sh / 2 - 0.06, sy + sh / 2 + 0.06], cz + 0.115, tint=STEEL)
    for k in range(3):   # knobs under the scope
        g.cyl('plain', 0.05, 0.055, 0.06, sx - 0.4 + k * 0.4, sy - sh / 2 - 0.25, cz + 0.03, 16, rx=PI / 2, tint=BLACKP)
    # Four analog meters (2 x 2) with needles the game drives.
    for k in range(4):
        mx = 2.12 + (k % 2) * 0.9
        my = 2.82 - (k // 2) * 0.7
        g.box('plain', 0.8, 0.62, 0.1, mx, my, cz + 0.04, tint=BLACKP, bevel=0.02)
        Mf = Mg(g, mx, my, cz + 0.095)
        Mq = Mf @ Matrix.Translation((0, 0.02, 0))
        emit(quad(0.66, 0.46), 'poster', Mq, WHITE, uvfn=face_uv(Mq, 0.66, 0.46))
        piv = Mf @ Vector((0, -0.17, 0.012))
        axis = (Mf.to_3x3() @ Vector((0, 0, 1))).normalized()
        name = part('Needle%d' % k, tuple(piv), axis=tuple(axis), driver='m%d' % k)
        with into(name):
            emit(bm_prism([(-0.006, -0.03), (0.006, -0.03), (0.0015, 0.33), (-0.0015, 0.33)], 0.0, 0.003, 'x'), 'plain', Mf @ Matrix.Translation((0, -0.17, 0.012)), BLACKP)
            emit(bm_cyl(0.018, 0.018, 0.012, 12), 'plain', Mf @ Matrix.Translation((0, -0.17, 0.02)) @ Matrix.Rotation(PI / 2, 4, 'X'), BLACKP)
    # Indicator lamp strip.
    g.box('plain', 3.3, 0.26, 0.05, 1.35, 1.72, cz + 0.02, tint=DARKSTEEL)
    for k, kind in enumerate((1, 0, 3, 0, 3, 1)):
        lx = -0.05 + k * 0.56
        g.cyl('plain', 0.065, 0.065, 0.05, lx, 1.72, cz + 0.06, 20, rx=PI / 2, tint=STEEL)
        lamp_at(Vector(g.p(lx, 1.72, cz + 0.085)), kind, size=0.045)
    # Switch panel: four heavy toggles, a small bulb above each. No markings.
    GEN['switches'] = []
    for k in range(4):
        sx_ = -0.25 + k * 0.8
        g.box('plain', 0.64, 1.02, 0.06, sx_, 1.0, cz + 0.02, tint=mul(DARKSTEEL, 1.25), bevel=0.015)
        rivets(g, [sx_ - 0.27, sx_ + 0.27], [0.55, 1.45], cz + 0.055, tint=STEEL)
        g.cyl('plain', 0.055, 0.055, 0.05, sx_, 1.36, cz + 0.07, 16, rx=PI / 2, tint=STEEL)
        lamp_at(Vector(g.p(sx_, 1.36, cz + 0.09)), 10 + k, size=0.04)
        g.box('plain', 0.22, 0.4, 0.1, sx_, 0.92, cz + 0.08, tint=CHROME, bevel=0.02)
        piv = Vector(g.p(sx_, 0.92, cz + 0.13))
        ax = Vector((g.c, 0, -g.s))
        name = part('Lever%d' % k, tuple(piv), axis=tuple(ax), driver='sw%d' % k)
        with into(name):
            Ml = Mg(g, sx_, 0.92, cz + 0.13)
            emit(bm_box(0.1, 0.1, 0.08, 0.01), 'metal', Ml, CHROME)
            emit(bm_cyl(0.026, 0.034, 0.3, 12), 'metal', Ml @ Matrix.Translation((0, 0, 0.17)) @ Matrix.Rotation(PI / 2, 4, 'X'), CHROME, smooth=True)
            emit(bm_sphere(0.052, 14, 10), 'metal', Ml @ Matrix.Translation((0, 0, 0.33)), CHROME, smooth=True)
        GEN['switches'].append(g.p(sx_, 0.95, cz + 0.25))
    # Louvred vent (lower right) and a second warning sign.
    g.box('plain', 0.74, 1.0, 0.05, 3.55, 1.0, cz + 0.02, tint=DARKSTEEL)
    for k in range(10):
        g.box('plain', 0.64, 0.035, 0.05, 3.55, 0.58 + k * 0.09, cz + 0.05, rx=0.6, tint=BLACKP)
    danger_sign(Mg(g, 3.55, 1.95, cz + 0.02), 0.36)
    hazard_band(g, cx0, cx1, 0.3, cz + 0.02, h=0.1)
    # Pipes into the rock.
    for (x, r_, top, tint) in ((3.75, 0.08, 4.1, COPPER), (3.45, 0.05, 4.4, DARKSTEEL), (-0.45, 0.06, 4.2, COPPER)):
        tube('metal', rounded([g.p(x, cy1 + 0.1, 0.3), g.p(x, top - 0.4, 0.3), g.p(x, top, 0.12), g.p(x, top + 1.0, -0.2)], 0.15), r_, 10, tint=tint)
    # Junction box on top, from which the four lines leave.
    g.box('paint', 1.7, 0.42, 0.44, 1.5, cy1 + 0.31, 0.26, tint=mul(PAINT_T, 0.9), bevel=0.02)
    GEN['exits'] = {}
    for k, name in enumerate(['mountain', 'tower', 'dome', 'rocks']):
        GEN['exits'][name] = (0.9 + k * 0.4, Vector(g.p(0.9 + k * 0.4, cy1 + 0.5, 0.26)))
    # Lamps: one under the lintel over the panel, two on the back wall (always on).
    g.box('plain', 0.12, 0.3, 0.12, 1.6, 4.15, 1.05, tint=DARKSTEEL)
    bulb_fixture(g.p(1.6, 3.9, 1.12), 'hub', power=55.0)
    for x in (-2.4, 4.3):
        g.box('plain', 0.22, 0.3, 0.1, x, 3.7, 0.05, tint=DARKSTEEL)
        g.cyl('plain', 0.03, 0.03, 0.2, x, 3.7, 0.2, 8, rx=PI / 2, tint=DARKSTEEL)
        bulb_fixture(g.p(x, 3.63, 0.34), 'hub', power=40.0, shade=False)
    empty('GEN_sound', g.p(-2.5, 1.4, 1.6))
    empty('GEN_center', g.p(1.0, 1.6, 2.5))

def screen_quad(M, w, h):
    nx, ny = 10, 8
    bm = bmesh.new()
    grid = []
    for j in range(ny + 1):
        row = []
        for k in range(nx + 1):
            u, v = k / nx, j / ny
            bulge = 0.025 * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
            row.append(bm.verts.new(((u - 0.5) * w, (v - 0.5) * h, bulge)))
        grid.append(row)
    for j in range(ny):
        for k in range(nx):
            bm.faces.new((grid[j][k], grid[j][k + 1], grid[j + 1][k + 1], grid[j + 1][k]))
    Mi = M.inverted()
    def uv(co, n):
        p = Mi @ co
        return (p.x / w + 0.5, p.y / h + 0.5)
    emit(bm, 'screen', M, WHITE, uvfn=uv, smooth=True)

# ============================================================================ conduits and tunnel lamps
# Lines that pass another tunnel's portal run above the one that ends there.
HEIGHT = {'mountain': 4.95, 'tower': 5.12, 'dome': 5.12, 'rocks': 4.95}

def wall_run(a0, a1, h, step=2.5):
    """Conduit points along the hub wall at height h from angle a0 to a1 (the short way), with brackets."""
    delta = ((a1 - a0 + 180) % 360) - 180
    n = max(2, int(abs(delta) / step))
    pts = []
    for i in range(n + 1):
        a = a0 + delta * i / n
        w = hub_point(a, h)
        nn = wall_normal(a, h)
        q = w + nn * 0.14
        for da in (-step * 0.5, -step * 0.25, step * 0.25, step * 0.5):    # clear the rock between samples
            w2 = hub_point(a + da, h)
            q = q + nn * max(0.0, (w2 - q).dot(nn) + 0.08)
        pts.append(q)
        if i % 2 == 1:
            beam('plain', tuple(q), tuple(w - nn * 0.1), 0.03, 0.05, DARKSTEEL)
    return pts

def build_conduits():
    set_origin(0, 0, 0)
    g = GEN['g']
    for name in LINES:
        sa = SPOKES[name][0]
        h = HEIGHT[name]
        lx_e, e = GEN['exits'][name]
        side = -1 if ((sa - GEN_A + 180) % 360) - 180 < 0 else 1    # -1: toward smaller angles (the viewer's left)
        lx_side = 4.22 * side
        path = [e, Vector(g.p(lx_e, h, 0.14)), Vector(g.p(lx_side, h, 0.14)), Vector(g.p(lx_side, h, 1.35))]
        d = dir_of(sa)
        sd = Vector((-d.z, 0, d.x))                 # the portal's +u faces larger angles
        arrive = 1 if side < 0 else -1
        path += wall_run(GEN_A + side * 22.0, sa + arrive * 17.0, h)
        P = lambda u, v, w: d * (PW0 + w) + sd * u + Vector((0, v, 0))
        path += [P(arrive * 3.1, h, -0.1), P(2.05, h, -0.1), P(2.05, 2.8, -0.1), P(1.72, 2.5, -0.1), P(1.72, 2.5, 1.2)]
        # Down the tunnel along its upper right wall.
        samples, rows, wall_r, bvh, gs, jx = TUNNEL[name]
        A_C = D(35.0)
        tpts = []
        for idx in range(3, len(rows) - 4, 3):
            rmin = min(wall_r(rows[k], A_C)[0] for k in range(max(0, idx - 2), min(len(rows), idx + 3)))
            c, dirv = rows[idx][0], wall_r(rows[idx], A_C)[1]
            if rows[idx][2] < 2.2:
                continue
            q = c + dirv * (rmin - 0.1)
            tpts.append(q)
            if (idx // 3) % 3 == 0:
                w = c + dirv * wall_r(rows[idx], A_C)[0]
                beam('plain', tuple(q), tuple(w + dirv * 0.1), 0.03, 0.05, DARKSTEEL)
        end = Vector(gs.p(jx, 2.49, 0.06))
        path += tpts[:-1] + [Vector(gs.p(jx, 3.3, 0.3)), end]
        conduit(path)
        # Lamps near the ceiling every ~9.5 m, hung from a stem into the rock.
        A_L = D(72.0)
        next_fix = 6.0
        total = samples[-1][2]
        for idx, row in enumerate(rows):
            s = row[2]
            if s < next_fix or s > total - 7.0:
                continue
            next_fix += 9.5
            rmin = min(wall_r(rows[k], A_L)[0] for k in range(max(0, idx - 2), min(len(rows), idx + 3)))
            c, dirv = row[0], wall_r(row, A_L)[1]
            lamp = c + dirv * (rmin - 0.5)
            wpt = c + dirv * (wall_r(row, A_L)[0] + 0.1)
            beam('plain', tuple(lamp + Vector((0, 0.14, 0))), tuple(wpt), 0.022, 0.022, DARKSTEEL)
            bulb_fixture(lamp, name, power=24.0)
    # Hub lamps: caged bulkheads on the walls between the tunnels, and a pendant over the centre.
    for a in (0.0, 190.0, 262.0, 128.0):
        w = hub_point(a, 3.2)
        nn = wall_normal(a, 3.2)
        nn.y = 0
        nn.normalize()
        gl = G(w.x, 0, w.z, math.atan2(nn.x, nn.z))
        gl.box('plain', 0.24, 0.34, 0.5, 0, 3.2, -0.12, tint=DARKSTEEL)
        bulb_fixture(gl.p(0, 3.12, 0.24), 'hub', power=80.0, shade=False)
    pend = Vector((0, 6.3, 0))
    TUBE('plain', [(0, TOP + 0.5, 0), (0, 6.45, 0)], 0.015, 5, tint=DARKSTEEL)
    emit(bm_lathe([(0.4, 0.02), (0.36, 0.06), (0.12, 0.24), (0.05, 0.28)], 24), 'paint', Matrix.Translation(pend), mul(PAINT_T, 0.9), smooth=True)
    emit(bm_lathe([(0.04, 0.27), (0.11, 0.23), (0.35, 0.06), (0.39, 0.03)], 24), 'plain', Matrix.Translation(pend), CREAMP, smooth=True)
    lamp_at(pend + Vector((0, 0.1, 0)), 1, size=0.09)
    LIGHTS.append((pend + Vector((0, 0.04, 0)), 520.0, 'hub'))

def build_meta():
    for name, (p, rot) in STATIONS.items():
        empty('STATION_' + name, tuple(p), rotY=rot)
    for k, p in enumerate(GEN['switches']):
        empty('SWITCH_%d' % k, p)
    empty('META', (0, 0, 0), lines=LINES, hubR=R0, top=TOP)

def add_lights():
    sc = _scene()
    for i, (p, power, group) in enumerate(LIGHTS):
        ld = bpy.data.lights.new('DB_light_%d' % i, 'POINT')
        ld.energy = power
        ld.shadow_soft_size = 0.05
        ld.color = (1.0, 0.8, 0.58)
        ob = bpy.data.objects.new('LIGHT_%s_%d' % (group, i), ld)
        ob.location = g2b(p)
        ob['group'] = group
        ob['noexport'] = 1
        sc.collection.objects.link(ob)

def build_all():
    t0 = time.time()
    _lid['n'] = 0
    _isl['k'] = 0
    for dct in (STATIONS, GEN, TUNNEL):
        dct.clear()
    LIGHTS.clear()
    build_hub()
    for name in LINES:
        build_portal(name)
        build_tunnel(name)
    build_generator()
    build_conduits()
    build_meta()
    stats = realize()
    add_lights()
    show_scene()
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in _scene().objects if ob.type == 'MESH')
    return {'materials': stats, 'colliders': len(COLS), 'lights': len(LIGHTS), 'lamps': _lid['n'], 'tris': tris,
            'seconds': round(time.time() - t0, 1)}

def bake_all():
    """Textures (tileable rock, worn paint, grime, from procedural shaders) and the per-line lightmaps."""
    t0 = time.time()
    out = {}
    bake_tile(ROOT + '/public/models/cave_rock.png', make_rock, 1024)
    bake_tile(ROOT + '/public/models/cave_paint.png', make_paint, 1024)
    bake_tile(ROOT + '/public/models/cave_grime.png', make_grime, 512)
    out['textures_s'] = round(time.time() - t0, 1)
    sc = _scene()
    groups = {n: [] for n in LINES + ['hub']}
    for ob in sc.objects:
        if ob.type == 'LIGHT' and ob.get('group') in groups:
            groups[ob['group']].append(ob)
    chans = [(n, groups[n]) for n in LINES] + [('hub', groups['hub']), ('ao', 'AO')]
    lm = bake_lightmaps(chans, [ROOT + '/public/models/cave_lm0.png', ROOT + '/public/models/cave_lm1.png'], size=2048, samples=256,
                        authored={'rock', 'metal'}, blur=(1, 6, 15, 20, 15, 6, 1))
    meta = sc.objects.get('META')
    if meta is not None:
        for n, s in lm['scales'].items():
            meta['lm_' + n] = s
    out['lightmaps'] = lm
    out['seconds'] = round(time.time() - t0, 1)
    return out

# ============================================================================ procedural textures (tileable)
def _mix(nt, fac, a, b, blend='MIX'):
    m = node(nt, 'ShaderNodeMix', props={'data_type': 'RGBA', 'blend_type': blend})
    for sock, v in ((0, fac), (6, a), (7, b)):
        if hasattr(v, 'is_output'):
            nt.links.new(v, m.inputs[sock])
        elif isinstance(v, (int, float)):
            m.inputs[sock].default_value = v
        else:
            m.inputs[sock].default_value = (v[0], v[1], v[2], 1.0)
    return m.outputs[2]

def _ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(fac, r.inputs['Fac'])
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for (pos, col) in stops[1:-1]:
        e = els.new(pos)
        e.color = (*col, 1)
    return r.outputs['Color']

def _noise(nt, vec, w, scale, detail=6.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '4D'}, Vector=vec, W=w, Scale=scale,
                Detail=detail, Roughness=rough, Distortion=distort).outputs['Fac']

def _mapr(nt, v, a, b):
    return node(nt, 'ShaderNodeMapRange', props={'clamp': True}, Value=v, **{'From Min': a, 'From Max': b}).outputs[0]

def _stretch(nt, vec, w, ku, kv):
    """Scale the torus coordinates: ku stretches features along u, kv along v (still seamless)."""
    v = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=vec, i1=(ku, ku, kv)).outputs[0]
    return v, math_node(nt, 'MULTIPLY', w, kv)

def make_rock(nt, vec, w):
    # Weathered cave rock: broad tonal blotches, mottling, a net of fine fractures and grain.
    blotch = _noise(nt, vec, w, 1.1, 5.0, 0.55, 0.6)
    mottle = _noise(nt, vec, w, 4.0, 8.0, 0.6)
    grain = _noise(nt, vec, w, 26.0, 4.0, 0.6)
    wob = _noise(nt, vec, w, 6.0, 3.0, 0.5)
    edge = node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '4D', 'feature': 'DISTANCE_TO_EDGE'},
                Vector=vec, W=w, Scale=1.7).outputs['Distance']
    crack = _mapr(nt, math_node(nt, 'ADD', edge, math_node(nt, 'MULTIPLY', wob, 0.06)), 0.03, 0.06)
    body = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', blotch, 0.7), math_node(nt, 'MULTIPLY', mottle, 0.3))
    col = _ramp(nt, body, [(0.3, (0.1, 0.085, 0.07)), (0.45, (0.24, 0.2, 0.16)), (0.58, (0.36, 0.31, 0.25)),
                           (0.7, (0.33, 0.31, 0.29)), (0.82, (0.5, 0.45, 0.38))])
    shade = math_node(nt, 'MULTIPLY', math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', crack, 0.16), 0.84),
                      math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', grain, 0.45), 0.78))
    comb = node(nt, 'ShaderNodeCombineColor', Red=shade, Green=shade, Blue=shade).outputs[0]
    return _mix(nt, 1.0, col, comb, 'MULTIPLY')

def make_paint(nt, vec, w):
    # 1970s olive enamel: worn to primer and steel at chips, rust blooms, and vertical grime streaks.
    n1 = _noise(nt, vec, w, 1.6, 6.0, 0.6, 0.2)
    rust = _mapr(nt, _noise(nt, vec, w, 2.2, 10.0, 0.68), 0.53, 0.66)
    chips = _mapr(nt, _noise(nt, vec, w, 6.0, 6.0, 0.72), 0.6, 0.64)
    fine = _noise(nt, vec, w, 16.0, 6.0, 0.6)
    sv, sw = _stretch(nt, vec, w, 4.0, 0.25)
    streak = _mapr(nt, _noise(nt, sv, sw, 1.5, 4.0, 0.6), 0.45, 0.75)
    paint = _mix(nt, n1, (0.075, 0.085, 0.045), (0.15, 0.165, 0.085))
    paint = _mix(nt, math_node(nt, 'MULTIPLY', streak, 0.55), paint, (0.05, 0.045, 0.035))
    metal = _mix(nt, chips, paint, (0.26, 0.25, 0.23))
    rc = _mix(nt, fine, (0.13, 0.05, 0.02), (0.36, 0.14, 0.05))
    return _mix(nt, rust, metal, rc)

def make_grime(nt, vec, w):
    n1 = _noise(nt, vec, w, 2.0, 8.0, 0.62)
    n2 = _noise(nt, vec, w, 9.0, 6.0, 0.6)
    stain = _mapr(nt, _noise(nt, vec, w, 1.2, 4.0, 0.5), 0.5, 0.75)
    v = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', n1, 0.22), math_node(nt, 'MULTIPLY', n2, 0.12))
    v = math_node(nt, 'SUBTRACT', math_node(nt, 'ADD', v, 0.66), math_node(nt, 'MULTIPLY', stain, 0.18))
    return node(nt, 'ShaderNodeCombineColor', Red=v, Green=v, Blue=v).outputs[0]
