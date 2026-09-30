"""Dreambound cabin content. Executed inside build_cabin.py's namespace (see STAGE runner there).

Model origin = center of the dome on the garden ground (y = 0). The cabin interior is authored with its
floor at y = 0 and lifted by FLOOR via set_origin(). Front of everything faces -Z (toward the dome door).
"""

# ============================================================================ dimensions
R_DOME = 14.0
CURB_TOP = 0.3
FLOOR = 0.5
HX = 1.2           # the house (shell, porch, rooms) sits this far along +x in the dome, so its front door and porch
                   # steps are centred on the flagstone walk and the dome door (x = 0); the house is authored as if at 0
W, D, T = 6.5, 4.5, 0.25
IW, ID = W - T, D - T
H, RID = 3.1, 6.3
K = (RID - H) / D
FRONT_OV, BACK_OV, RAKE_OV = 0.25, 0.6, 0.5
DECK = 0.3
PX1 = 2.4          # partition: great room | bed + bath   (x)
PZ2 = -0.3         # partition: bedroom | bath            (z)
PZ0 = -7.0         # porch front edge
DZ = -13.9         # dome door plane
VZ0, VZ1 = -14.85, -12.95   # vestibule outer / inner ends


def roof_y(z):
    return RID - K * abs(z)


def frange(a, b, step):
    x = a
    while x < b:
        yield x
        x += step


def jitter(c, k=0.06):
    f = 1.0 + rng.uniform(-k, k)
    return (c[0] * f, c[1] * f, c[2] * f)


# ============================================================================ small builders
def rounded(mat, w, h, d, r, x, y, z, ry=0.0, rx=0.0, rz=0.0, tint=WHITE, col=False):
    B(mat, w, h, d, x, y, z, ry, rx, rz, tint, bevel=r, seg=3, smooth=True, grain=None, tile=0.3, col=col)


def rug(mat, x0, z0, x1, z1, y=0.0, h=0.012, tint=WHITE):
    BOX(mat, x0, y, z0, x1, y + h, z1, tint=tint, grain=None, fit={0: (x0, x1), 2: (z0, z1), 1: (y, y + h)})


def string_lights(A, Bp, sag=0.35, spacing=0.42):
    A, Bp = Vector(A), Vector(Bp)
    L = (Bp - A).length
    n = max(4, int(L / 0.25))
    pts = []
    for i in range(n + 1):
        t = i / n
        p = A.lerp(Bp, t)
        p.y -= sag * 4 * t * (1 - t)
        pts.append(p)
    TUBE('metal_black', pts, 0.006, 4, tint=BLACK)
    m = max(2, int(L / spacing))
    for i in range(1, m):
        t = i / m
        p = A.lerp(Bp, t)
        p.y -= sag * 4 * t * (1 - t)
        CYL('metal_black', 0.012, 0.012, 0.035, p.x, p.y - 0.022, p.z, 6, tint=BLACK)
        SPH('emissive', 0.03, p.x, p.y - 0.06, p.z, 8, 6)


def lantern_box(x, y, z, s=1.0):
    B('metal_black', 0.17 * s, 0.03 * s, 0.17 * s, x, y + 0.16 * s, z, tint=BLACK)
    B('metal_black', 0.15 * s, 0.02 * s, 0.15 * s, x, y - 0.14 * s, z, tint=BLACK)
    for dx in (-1, 1):
        for dz in (-1, 1):
            B('metal_black', 0.016 * s, 0.3 * s, 0.016 * s, x + dx * 0.068 * s, y, z + dz * 0.068 * s, tint=BLACK)
    B('emissive', 0.11 * s, 0.24 * s, 0.11 * s, x, y + 0.005, z)


def barn_light(x, y, z, facing):
    """Wall barn light; facing = direction the light points (game yaw of the arm)."""
    g = G(x, y, z, facing)
    g.box('metal_black', 0.14, 0.2, 0.03, 0, 0, 0.0, tint=BLACK)
    g.put(bm_tube([(0, 0, 0), (0, 0.08, 0.1), (0, 0.06, 0.24)], 0.012, 6), 'metal_black', 0, 0, 0, tint=BLACK, smooth=True)
    g.put(bm_lathe([(0.0, 0.07), (0.05, 0.07), (0.1, 0.02), (0.13, -0.03), (0.135, -0.035)], 20), 'metal_black', 0, 0.02, 0.28, tint=BLACK, smooth=True)
    g.put(bm_sphere(0.035, 10, 6), 'emissive', 0, 0.0, 0.28)


def globe_pendant(x, y, z, ceil_y, glass=True):
    CYL('metal_black', 0.004, 0.004, ceil_y - y - 0.1, x, (ceil_y + y + 0.1) / 2, z, 4, tint=BLACK)
    CYL('brass', 0.035, 0.035, 0.06, x, y + 0.13, z, 12)
    CYL('brass', 0.07, 0.07, 0.012, x, ceil_y - 0.01, z, 16)
    if glass:
        emit(bm_sphere(0.13, 18, 12), 'glass', xf(x, y, z))
    SPH('emissive', 0.045, x, y, z, 10, 8)


def rattan_pendant(x, y, z, ceil_y, r=0.42):
    CYL('metal_black', 0.004, 0.004, ceil_y - y - 0.1, x, (ceil_y + y) / 2 + 0.1, z, 4, tint=BLACK)
    prof = [(0.03, 0.0), (r * 0.55, -0.06), (r * 0.85, -0.18), (r, -0.34), (r * 1.02, -0.38)]
    emit(bm_lathe(prof, 32), 'fabric', xf(x, y + 0.1, z), RATTAN, 0.08, None, None, True)
    emit(bm_lathe(list(reversed([(p[0] - 0.012, p[1]) for p in prof])), 32), 'fabric', xf(x, y + 0.1, z), mul(RATTAN, 0.7), 0.08, None, None, True)
    SPH('emissive', 0.05, x, y - 0.12, z, 10, 8)


def sconce(x, y, z, facing, shade=True):
    g = G(x, y, z, facing)
    g.cyl('brass', 0.05, 0.05, 0.02, 0, 0, 0.01, 16, rx=PI / 2)
    g.put(bm_tube([(0, 0, 0.02), (0, 0.02, 0.14), (0, 0.08, 0.2)], 0.008, 6), 'brass', 0, 0, 0, smooth=True)
    if shade:
        g.put(bm_cyl(0.075, 0.1, 0.13, 20, caps=False), 'shade', 0, 0.12, 0.2, tint=LINEN, smooth=True)
    g.put(bm_sphere(0.035, 10, 6), 'emissive', 0, 0.1, 0.2)


def books_row(x0, x1, y, z, depth=0.2, axis='x', lean=0.0):
    u = x0
    while u < x1 - 0.03:
        if rng.random() < 0.08:
            u += 0.08
            continue
        t = rng.uniform(0.022, 0.05)
        h = rng.uniform(0.2, 0.32)
        tint = rng.choice([mul(RUST, 0.8), mul(OLIVE, 0.9), CREAM, CHAR, mul(TERRA, 0.9), mul(SAGE, 0.8), SAND, mul(WALNUT, 1.3)])
        if axis == 'x':
            B('painted', t, h, depth, u + t / 2, y + h / 2, z, rz=lean, tint=tint)
        else:
            B('painted', depth, h, t, z, y + h / 2, u + t / 2, rx=lean, tint=tint)
        u += t + 0.003


def book_stack(x, y, z, n=3, ry=0.0):
    for i in range(n):
        h = rng.uniform(0.03, 0.05)
        B('painted', 0.26 - i * 0.02, h, 0.19 - i * 0.012, x, y + i * 0.05 + h / 2, z, ry + rng.uniform(-0.25, 0.25),
          tint=rng.choice([CREAM, mul(RUST, 0.8), CHAR, mul(OLIVE, 0.9), SAND]))


def candle(x, y, z, h=0.12, r=0.028):
    CYL('ceramic', r, r, h, x, y + h / 2, z, 12, tint=LINEN)
    emit(bm_leaf(0.03, 0.012, n=2, fold=0.0), 'emissive', xf(x, y + h + 0.002, z, 0, 0, PI / 2))


def vase(x, y, z, h=0.3, r=0.08, tint=CERAMIC):
    prof = [(0.0, 0.0), (r * 0.8, 0.0), (r, h * 0.25), (r * 0.9, h * 0.7), (r * 0.45, h * 0.9), (r * 0.5, h), (r * 0.4, h)]
    emit(bm_lathe(prof, 18), 'ceramic', xf(x, y, z), tint, 0.3, None, None, True)


def bowl(x, y, z, r=0.14, h=0.07, tint=CERAMIC, mat='ceramic'):
    prof = [(0.0, 0.0), (r * 0.5, 0.0), (r * 0.9, h * 0.6), (r, h), (r * 0.93, h), (r * 0.82, h * 0.55), (r * 0.4, h * 0.12), (0.0, h * 0.12)]
    emit(bm_lathe(prof, 20), mat, xf(x, y, z), tint, 0.3, None, None, True)


def pot(x, y, z, r=0.16, h=0.3, tint=POT, mat='ceramic'):
    prof = [(0.0, 0.0), (r * 0.72, 0.0), (r * 0.9, h * 0.8), (r, h * 0.84), (r, h), (r * 0.9, h), (r * 0.86, h * 0.9), (0.0, h * 0.9)]
    emit(bm_lathe(prof, 20), mat, xf(x, y, z), tint, 0.3, None, None, True)
    CYL('painted', r * 0.86, r * 0.86, 0.01, x, y + h * 0.9 - 0.02, z, 16, tint=SOIL)


def plant_fig(x, y, z, h=1.9, seed=1, pot_tint=CERAMIC):
    r2 = random.Random(seed)
    pot(x, y, z, 0.24, 0.42, pot_tint)
    top = y + h
    TUBE('wood', [(x, y + 0.35, z), (x + 0.04, y + h * 0.45, z - 0.02), (x - 0.02, y + h * 0.75, z + 0.03), (x + 0.02, top - 0.1, z)], 0.028, 6, tint=BARK, r_end=0.012)
    for i in range(46):
        t = r2.uniform(0.35, 1.0)
        py = y + 0.3 + (h - 0.3) * t
        a = r2.uniform(0, 2 * PI)
        rad = 0.05 + 0.08 * math.sin(t * PI)
        L = r2.uniform(0.24, 0.34) * (0.8 + 0.3 * (1 - t))
        emit(bm_leaf(L, L * 0.72, n=4, fold=0.28, droop=0.3), 'leaf',
             xf(x + math.cos(a) * rad, py, z + math.sin(a) * rad, -a, r2.uniform(-0.3, 0.3), r2.uniform(0.15, 0.75)),
             jitter(GREEN, 0.18), smooth=True)
    C(x, y + 0.6, z, 0.5, 1.2, 0.5)


def plant_olive(x, y, z, h=2.1, seed=2, xmin=None):
    """A potted olive: a leaning, slightly twisted trunk, seven scaffold branches, side shoots and twigs, and about
    2,700 narrow leaves in opposite pairs along them, each pair turned a quarter from the last and angled toward
    the tip, dusty sage above, some silvery, some darker. xmin: a wall or window on the -x side; the crown is pruned
    flat short of it (its -x half squashed toward the trunk)."""
    r2 = random.Random(seed)
    pot(x, y, z, 0.3, 0.5, TERRA)
    up = Vector((0, 1, 0))
    base = Vector((x, y + 0.42, z))
    crown = Vector((x + 0.03, y + h * 0.6, z - 0.02))

    def S(p):
        # Prune against the window: pull the -x side of the crown in so nothing reaches past xmin - 0.08.
        if xmin is None or p.x >= x:
            return p
        room = (x - (xmin + 0.08))
        dx = x - p.x
        return Vector((x - room * math.tanh(dx / room), p.y, p.z))

    TUBE('wood', [base.to_tuple(), (x - 0.05, y + 0.8, z + 0.04), (x + 0.01, y + 1.05, z - 0.03), crown.to_tuple()], 0.042, 7,
         tint=mul(BARK, 0.9), r_end=0.026)

    def limb(p0, d, length, r, sides, tint, bend=(0.22, 0.2)):
        pts, p, dd = [p0.copy()], p0.copy(), d.normalized()
        for k in range(4):
            dd = (dd + Vector((r2.uniform(-bend[0], bend[0]), r2.uniform(-0.04, bend[1]), r2.uniform(-bend[0], bend[0])))).normalized()
            p = p + dd * (length / 4)
            pts.append(p.copy())
        pts = [S(q) for q in pts]
        TUBE('wood', [q.to_tuple() for q in pts], r, sides, tint=tint, r_end=r * 0.45)
        return pts

    def along(pts, t):
        # point and tangent a fraction t along a polyline
        segs = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        L = [(b - a).length for a, b in segs]
        total, acc = sum(L), 0.0
        for (a, b), l in zip(segs, L):
            if acc + l >= t * total or (a, b) == segs[-1]:
                u = min(1.0, (t * total - acc) / max(l, 1e-6))
                return a.lerp(b, u), (b - a).normalized(), total
            acc += l

    LEAF = [SAGELEAF, SAGELEAF, SAGELEAF, srgb(96, 112, 80), srgb(150, 160, 138)]

    def leaf(p, d):
        L = r2.uniform(0.085, 0.12)
        n = up - d * d.dot(up)
        n = (n.normalized() if n.length > 1e-3 else Vector((1, 0, 0)))
        n = (n + Vector((r2.uniform(-0.35, 0.35), r2.uniform(-0.2, 0.2), r2.uniform(-0.35, 0.35)))).normalized()
        n = (n - d * d.dot(n)).normalized()
        zb = d.cross(n)
        M = Matrix(((d.x, n.x, zb.x, p.x), (d.y, n.y, zb.y, p.y), (d.z, n.z, zb.z, p.z), (0, 0, 0, 1)))
        c = LEAF[r2.randrange(len(LEAF))]
        f = 1.0 + r2.uniform(-0.1, 0.1)
        emit(bm_leaf(L, L * r2.uniform(0.19, 0.24), n=3, fold=0.12, droop=0.15), 'leaf', M, (c[0] * f, c[1] * f, c[2] * f))

    def leafy(pts, t0, step=0.016):
        # opposite pairs from t0 to the tip, each pair a quarter turn from the last, angled 50-65 deg toward the tip
        _, _, total = along(pts, 0.0)
        k, t = 0, t0
        while t <= 1.0:
            p, tg, _ = along(pts, t)
            side = tg.cross(up if abs(tg.dot(up)) < 0.95 else Vector((1, 0, 0))).normalized()
            if k % 2:
                side = tg.cross(side).normalized()
            a = math.radians(r2.uniform(50, 65))
            for sgn in (1, -1):
                leaf(p, (tg * math.cos(a) + side * (sgn * math.sin(a))).normalized())
            k += 1
            t += step / total
        p, tg, _ = along(pts, 1.0)
        leaf(p, tg)

    n_sc = 7
    a0 = r2.uniform(0, 2 * PI)
    for i in range(n_sc):
        az = a0 + 2 * PI * i / n_sc + r2.uniform(-0.3, 0.3)
        el = math.radians(r2.uniform(35, 62))
        d = Vector((math.cos(az) * math.cos(el), math.sin(el), math.sin(az) * math.cos(el)))
        p0 = crown + Vector((r2.uniform(-0.02, 0.02), r2.uniform(-0.06, 0.04), r2.uniform(-0.02, 0.02)))
        sc = limb(p0, d, r2.uniform(0.45, 0.6), 0.02, 5, mul(BARK, 0.95))
        leafy(sc, 0.6)
        for j in range(4):
            q, tg, _ = along(sc, r2.uniform(0.4, 0.9))
            out = Vector((tg.x, 0, tg.z)).normalized() if Vector((tg.x, 0, tg.z)).length > 1e-3 else Vector((1, 0, 0))
            rot = r2.uniform(-1.0, 1.0)
            sd = (tg + Vector((math.cos(rot) * out.x - math.sin(rot) * out.z, 0.15, math.sin(rot) * out.x + math.cos(rot) * out.z)) * 0.9).normalized()
            sh = limb(q, sd, r2.uniform(0.18, 0.3), 0.009, 4, mul(BARK, 1.05), bend=(0.3, 0.25))
            leafy(sh, 0.25)
            for m in range(4):
                q2, tg2, _ = along(sh, r2.uniform(0.35, 0.95))
                tw = (tg2 + Vector((r2.uniform(-0.9, 0.9), r2.uniform(-0.2, 0.5), r2.uniform(-0.9, 0.9)))).normalized()
                twig = limb(q2, tw, r2.uniform(0.1, 0.18), 0.004, 3, mul(BARK, 1.1), bend=(0.35, 0.3))
                leafy(twig, 0.1)
    # (The olive once tinted its leaves from the build's shared stream; spend the same 300 draws so nothing after it
    # in the build changes.)
    for _ in range(300):
        rng.uniform(-0.12, 0.12)
    C(x, y + 0.6, z, 0.6, 1.2, 0.6)


def plant_snake(x, y, z, seed=3, pot_tint=CHAR):
    r2 = random.Random(seed)
    pot(x, y, z, 0.16, 0.34, pot_tint)
    for i in range(12):
        a = r2.uniform(0, 2 * PI)
        emit(bm_leaf(r2.uniform(0.45, 0.75), 0.075, n=5, fold=0.35), 'leaf',
             xf(x + math.cos(a) * 0.05, y + 0.3, z + math.sin(a) * 0.05, a, 0, PI / 2 - r2.uniform(0.05, 0.28)),
             jitter(DKGREEN, 0.15), smooth=True)
    C(x, y + 0.4, z, 0.35, 0.8, 0.35)


def plant_fern(x, y, z, seed=4, s=1.0):
    r2 = random.Random(seed)
    for i in range(16):
        a = 2 * PI * i / 16 + r2.uniform(-0.15, 0.15)
        emit(bm_leaf(0.55 * s * r2.uniform(0.8, 1.1), 0.16 * s, n=6, fold=0.15, droop=0.7), 'leaf',
             xf(x, y, z, a, 0, r2.uniform(0.5, 0.9)), jitter(GREEN, 0.12), smooth=True)


def trailing_pothos(x, y, z, n=5, seed=5, reach=0.7):
    r2 = random.Random(seed)
    pot(x, y, z, 0.1, 0.14, CERAMIC)
    for v in range(n):
        a = r2.uniform(0, 2 * PI)
        pts = []
        L = r2.uniform(0.3, reach)
        for i in range(8):
            t = i / 7
            pts.append((x + math.cos(a) * (0.08 + 0.08 * t), y + 0.12 - L * t * t, z + math.sin(a) * (0.08 + 0.08 * t)))
        TUBE('leaf', pts, 0.004, 4, tint=DKGREEN)
        for p in pts[1:]:
            emit(bm_leaf(0.06, 0.05, n=3, fold=0.2, droop=0.2), 'leaf', xf(p[0], p[1], p[2], r2.uniform(0, 2 * PI), 0, r2.uniform(-0.6, 0.2)), jitter(GREEN, 0.2))


def eucalyptus(x, y, z, n=6, seed=6):
    r2 = random.Random(seed)
    for s in range(n):
        a = r2.uniform(0, 2 * PI)
        lean = r2.uniform(0.15, 0.45)
        pts = [(x, y, z), (x + math.cos(a) * lean * 0.3, y + 0.3, z + math.sin(a) * lean * 0.3), (x + math.cos(a) * lean * 0.55, y + 0.55, z + math.sin(a) * lean * 0.55)]
        TUBE('leaf', pts, 0.0035, 4, tint=SAGELEAF)
        for i in range(9):
            t = 0.25 + 0.75 * i / 8
            p = Vector(pts[0]).lerp(Vector(pts[2]), t)
            emit(bm_leaf(0.045, 0.042, n=3, fold=0.05), 'leaf', xf(p.x, p.y, p.z, r2.uniform(0, 6.28), r2.uniform(-0.5, 0.5), r2.uniform(-0.3, 0.6)), jitter(SAGELEAF, 0.1))


def pampas(x, y, z, n=5, seed=7, h=0.75):
    r2 = random.Random(seed)
    for s in range(n):
        a = r2.uniform(0, 2 * PI)
        lean = r2.uniform(0.1, 0.35)
        tipx, tipz = x + math.cos(a) * lean * h * 0.5, z + math.sin(a) * lean * h * 0.5
        TUBE('fabric', [(x, y, z), (tipx, y + h, tipz)], 0.003, 4, tint=SAND)
        CYL('fabric', 0.0, 0.045, 0.3, tipx, y + h + 0.1, tipz, 8, rx=math.sin(a) * lean, rz=-math.cos(a) * lean, tint=jitter(CREAM, 0.05))


def throw_folded(x, y, z, w, d, tint, ry=0.0, hang=(0, 0, 0, 0), seed=0):
    emit(bm_blanket(w, d, hang, 0.05, 0.006, seed), 'fabric', xf(x, y, z, ry), tint, 0.25, None, None, True)


# ============================================================================ dome
def ring_piece(mat, r_in, r_out, y0, y1, a0, a1, n, tint=WHITE, tile=1.0):
    bm = bmesh.new()
    rings = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((c * r_in, y0, s * r_in)), bm.verts.new((c * r_out, y0, s * r_out)),
                      bm.verts.new((c * r_out, y1, s * r_out)), bm.verts.new((c * r_in, y1, s * r_in))])
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(4):
            j = (k + 1) % 4
            bm.faces.new((a[k], a[j], b[j], b[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    emit(bm, mat, None, tint, tile, None, None, False, recalc=True)


def build_dome():
    set_origin(0, 0, 0)
    R = R_DOME
    cy = CURB_TOP + 0.15 * R
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=R, matrix=Matrix.Rotation(-PI / 2, 4, 'X'), calc_uvs=False)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(36), 3, 'Y'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, cy, 0), verts=bm.verts)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-4,
                           plane_co=(0, CURB_TOP, 0), plane_no=(0, 1, 0), clear_inner=True)
    DX, DY = 1.3, 3.36

    def cut_door(b):
        for co, no in (((DX, 0, 0), (1, 0, 0)), ((-DX, 0, 0), (1, 0, 0)), ((0, DY, 0), (0, 1, 0))):
            bmesh.ops.bisect_plane(b, geom=b.verts[:] + b.edges[:] + b.faces[:], dist=1e-5, plane_co=co, plane_no=no)
        kill = [f for f in b.faces if (lambda c: abs(c.x) < DX and c.y < DY and c.z < -8)(f.calc_center_median())]
        bmesh.ops.delete(b, geom=kill, context='FACES')

    glass = bm.copy()
    cen = Vector((0, cy, 0))
    for v in glass.verts:
        v.co = cen + (v.co - cen) * ((R - 0.015) / R)
    cut_door(glass)
    emit(glass, 'dome_glass')
    frame = bm.copy()
    bmesh.ops.wireframe(frame, faces=frame.faces[:], thickness=0.1, offset=0.0, use_replace=True,
                        use_boundary=True, use_even_offset=True, use_relative_offset=False)
    cut_door(frame)
    emit(frame, 'dome_frame', tint=BLACK)
    bm.free()

    # Stone curb + steel sill ring, open at the door.
    r0 = math.sqrt(R * R - (cy - CURB_TOP) ** 2)
    front = -PI / 2
    g1 = math.asin(1.28 / r0)
    ring_piece('stone', r0 - 0.34, r0 + 0.3, -0.4, CURB_TOP, front + g1, front + 2 * PI - g1, 120, tint=mul(STONE, 0.95), tile=1.2)
    ring_piece('dome_frame', r0 - 0.07, r0 + 0.07, CURB_TOP, CURB_TOP + 0.08, front + g1, front + 2 * PI - g1, 120, tint=BLACK)

    # Vestibule: cedar-clad cheeks, a flat black roof, steel door frame with side lights and transom.
    for s in (-1, 1):
        BOX('wood', s * 1.2 - 0.07, -0.02, VZ0, s * 1.2 + 0.07, 3.3, VZ1, tint=CEDAR, grain=1, tile=(0.35, 1.2))
        for yy in frange(0.15, 3.25, 0.16):   # horizontal cedar slats on the outside faces
            BOX('wood', s * 1.27 - 0.008 + (0.016 if s > 0 else -0.016), yy, VZ0 + 0.02, s * 1.27 + (0.016 if s > 0 else -0.016) + 0.008, yy + 0.11, VZ1 - 0.02, tint=jitter(CEDAR, 0.08), grain=2)
        BOX('metal_black', s * 1.2 - 0.075, -0.02, VZ0 - 0.02, s * 1.2 + 0.075, 3.3, VZ0 + 0.04, tint=BLACK)
        C(s * 1.2, 1.6, (VZ0 + VZ1) / 2, 0.16, 3.4, VZ1 - VZ0)
        lantern_box(s * 1.36, 2.35, VZ0 + 0.35)
    BOX('metal_black', -1.48, 3.3, VZ0 - 0.25, 1.48, 3.46, VZ1 + 0.2, tint=BLACK)
    BOX('wood', -1.42, 3.27, VZ0 - 0.2, 1.42, 3.3, VZ1 + 0.15, tint=CEDAR, grain=0)
    BOX('flagstone', -1.13, -0.08, VZ0, 1.13, 0.05, VZ1, tint=mul(STONE, 0.8), tile=0.9, col=True)
    # Frame
    fz0, fz1 = DZ - 0.05, DZ + 0.05
    BOX('dome_frame', -0.66, 0.05, fz0, -0.6, 2.52, fz1, tint=BLACK)
    BOX('dome_frame', 0.6, 0.05, fz0, 0.66, 2.52, fz1, tint=BLACK)
    BOX('dome_frame', -1.13, 2.5, fz0, 1.13, 2.58, fz1, tint=BLACK)
    for s in (-1, 1):
        BOX('dome_frame', s * 1.13 - 0.05, 0.05, fz0, s * 1.13 + 0.05, 3.27, fz1, tint=BLACK)
        BOX('dome_frame', min(s * 0.66, s * 1.13), 1.05, fz0 + 0.01, max(s * 0.66, s * 1.13), 1.09, fz1 - 0.01, tint=BLACK)
        x0, x1 = sorted((s * 0.66, s * 1.13))
        emit(bm_poly([(x0, 0.05, DZ), (x1, 0.05, DZ), (x1, 2.5, DZ), (x0, 2.5, DZ)]), 'dome_glass')
        C((x0 + x1) / 2, 1.3, DZ, x1 - x0, 2.6, 0.1)
    emit(bm_poly([(-1.13, 2.58, DZ), (1.13, 2.58, DZ), (1.13, 3.27, DZ), (-1.13, 3.27, DZ)]), 'dome_glass')
    for x in (-0.38, 0.38):
        BOX('dome_frame', x - 0.02, 2.58, fz0 + 0.01, x + 0.02, 3.27, fz1 - 0.01, tint=BLACK)
    rug('jute', -0.5, DZ + 0.15, 0.5, DZ + 0.85, y=0.05)

    # The glass door (hinged at x = -0.6).
    DOORS['DomeDoor'] = {'hinge': Vector((-0.6, 0.05, DZ)), 'buckets': {}}
    _target[0] = DOORS['DomeDoor']['buckets']
    x0, x1, y0, y1 = -0.6, 0.6, 0.06, 2.49
    BOX('dome_frame', x0 + 0.01, y0, DZ - 0.025, x0 + 0.07, y1, DZ + 0.025, tint=BLACK)
    BOX('dome_frame', x1 - 0.07, y0, DZ - 0.025, x1 - 0.01, y1, DZ + 0.025, tint=BLACK)
    BOX('dome_frame', x0 + 0.07, y0, DZ - 0.025, x1 - 0.07, y0 + 0.14, DZ + 0.025, tint=BLACK)
    BOX('dome_frame', x0 + 0.07, y1 - 0.07, DZ - 0.025, x1 - 0.07, y1, DZ + 0.025, tint=BLACK)
    BOX('dome_frame', x0 + 0.07, 1.02, DZ - 0.02, x1 - 0.07, 1.06, DZ + 0.02, tint=BLACK)
    emit(bm_poly([(x0 + 0.07, y0 + 0.14, DZ), (x1 - 0.07, y0 + 0.14, DZ), (x1 - 0.07, y1 - 0.07, DZ), (x0 + 0.07, y1 - 0.07, DZ)]), 'dome_glass')
    for sz in (-1, 1):
        BOX('brass', 0.44, 0.75, DZ + sz * 0.075 - 0.012, 0.465, 1.55, DZ + sz * 0.075 + 0.012)
        for yy in (0.8, 1.5):
            BOX('brass', 0.445, yy - 0.012, min(DZ, DZ + sz * 0.075), 0.46, yy + 0.012, max(DZ, DZ + sz * 0.075))
    _target[0] = None

    # Dome wall collision: a ring of boxes just inside the glass, open at the vestibule.
    n = 72
    rc = r0 - 0.12
    for i in range(n):
        a = 2 * PI * (i + 0.5) / n
        x, z = math.cos(a) * rc, math.sin(a) * rc
        if abs(x) < 1.35 and z < 0:
            continue
        C(x, 1.6, z, 2 * PI * rc / n + 0.08, 3.4, 0.3, -a + PI / 2)
    return r0


# ============================================================================ garden
def build_garden():
    set_origin(0, 0, 0)
    # Flagstone path from the vestibule to the porch steps.
    z = VZ1 + 0.25
    i = 0
    while z < PZ0 - 0.95:
        pieces = [(math.sin(i * 1.7) * 0.18, 0.0)] if i % 3 else [(-0.3 + math.sin(i) * 0.05, 0.0), (0.33, 0.02)]
        for (ox, oz) in pieces:
            n = rng.randint(7, 9)
            rr = rng.uniform(0.3, 0.42) if len(pieces) == 1 else rng.uniform(0.24, 0.3)
            poly = [(ox + math.cos(2 * PI * k / n) * rr * rng.uniform(0.78, 1.08), z + oz + math.sin(2 * PI * k / n) * rr * rng.uniform(0.78, 1.08) * 0.85) for k in range(n)]
            emit(bm_prism(poly, -0.02, 0.045, 'y'), 'flagstone', None, jitter(mul(STONE, 0.92), 0.1), 0.8)
        z += 0.72
        i += 1
    # Low lantern bollards along the path.
    for zz in (-12.1, -10.3, -8.5):
        for s in (-1, 1):
            x = s * 1.15
            B('metal_black', 0.09, 0.5, 0.09, x, 0.25, zz, tint=BLACK)
            B('metal_black', 0.2, 0.03, 0.2, x, 0.73, zz, tint=BLACK)
            B('emissive', 0.12, 0.2, 0.12, x, 0.61, zz)
            B('metal_black', 0.15, 0.02, 0.15, x, 0.5, zz, tint=BLACK)
            C(x, 0.4, zz, 0.2, 0.8, 0.2)
    # Cedar planters with lavender, flanking the path near the porch.
    for s in (-1, 1):
        x0, x1 = sorted((s * 1.75, s * 3.7))
        z0, z1 = -9.9, -8.7
        for (a, b, c_, d_) in ((x0, x1, z0, z0 + 0.05), (x0, x1, z1 - 0.05, z1), (x0, x0 + 0.05, z0, z1), (x1 - 0.05, x1, z0, z1)):
            for k, yy in enumerate((0.0, 0.15, 0.3)):
                BOX('wood', a, yy, c_, b, yy + 0.14, d_, tint=jitter(CEDAR, 0.07), grain='auto')
        BOX('painted', x0 + 0.05, 0.0, z0 + 0.05, x1 - 0.05, 0.4, z1 - 0.05, tint=SOIL)
        C((x0 + x1) / 2, 0.22, (z0 + z1) / 2, x1 - x0, 0.45, z1 - z0)
        for cx in frange(x0 + 0.22, x1 - 0.1, 0.32):
            for cz in (z0 + 0.3, z0 + 0.62, z0 + 0.92):
                for k in range(8):
                    a = rng.uniform(0, 2 * PI)
                    lean = rng.uniform(0.05, 0.3)
                    hgt = rng.uniform(0.28, 0.42)
                    bx, bz = cx + rng.uniform(-0.05, 0.05), cz + rng.uniform(-0.05, 0.05)
                    tx, tz = bx + math.cos(a) * lean * hgt, bz + math.sin(a) * lean * hgt
                    TUBE('leaf', [(bx, 0.4, bz), (tx, 0.4 + hgt, tz)], 0.004, 3, tint=SAGELEAF)
                    B('painted', 0.022, 0.09, 0.022, tx, 0.4 + hgt + 0.03, tz, rx=math.sin(a) * lean, rz=-math.cos(a) * lean, tint=jitter(LAVENDER, 0.12))

    # Fire pit ring with gravel, logs and embers; four Adirondack chairs.
    FPZ = 9.3
    CYL('flagstone', 2.6, 2.6, 0.03, 0, 0.012, FPZ, 48, tint=mul(STONE, 0.72), smooth=False, tile=0.45)
    for course, (yy, off) in enumerate(((0.1, 0.0), (0.28, 0.5))):
        n = 16
        for k in range(n):
            a = 2 * PI * (k + off) / n
            rounded('flagstone', 0.34, 0.19, 0.23, 0.06, math.cos(a) * 0.8, yy, FPZ + math.sin(a) * 0.8, ry=-a + PI / 2 + rng.uniform(-0.1, 0.1), tint=jitter(mul(STONE, 0.9), 0.12))
    CYL('flagstone', 0.66, 0.66, 0.04, 0, 0.03, FPZ, 24, tint=mul(SOOT, 2.0), smooth=False)
    for k in range(4):
        a = k * PI / 2 + 0.3
        CYL('wood', 0.06, 0.07, 0.62, math.cos(a) * 0.1, 0.2, FPZ + math.sin(a) * 0.1, 8, ry=-a, rz=1.15, tint=mul(BARK, 0.6), caps=True)
    for k in range(9):
        SPH('embers', rng.uniform(0.04, 0.08), rng.uniform(-0.3, 0.3), 0.07, FPZ + rng.uniform(-0.3, 0.3), 8, 6, s=(1, 0.5, 1))
    C(0, 0.25, FPZ, 1.9, 0.5, 1.9)
    empty('FIRE_pit', (0, 0.4, FPZ))
    for i, ang in enumerate((35, 125, 215, 305)):
        a = math.radians(ang)
        cx, cz = math.cos(a) * 2.1, FPZ + math.sin(a) * 2.1
        ry = math.atan2(-math.cos(a), -math.sin(a))
        adirondack(cx, cz, ry)
        # Sitting (src/props/cabin.js, as on the view deck): the chair, the seated eye against the back slats, and where
        # you stand up, in front of it toward the fire. The chair's local +z (toward the fire) is (sin ry, cos ry).
        fx, fz = math.sin(ry), math.cos(ry)
        empty('PIT_CHAIR_%d' % i, (cx, 0.0, cz), ry=ry)
        empty('PIT_SEAT_%d' % i, (cx - fx * 0.12, 1.08, cz - fz * 0.12))
        empty('PIT_STAND_%d' % i, (cx + fx * 0.75, 0.0, cz + fz * 0.75))
    # Posts carrying festoon lights over the fire pit, strung from the cabin's back eave.
    for s in (-1, 1):
        x = s * 3.8
        BOX('wood', x - 0.08, -0.3, 12.3 - 0.08, x + 0.08, 3.35, 12.3 + 0.08, tint=TIMBER, bevel=0.01)
        C(x, 1.5, 12.3, 0.2, 3.2, 0.2)
    ey = FLOOR + roof_y(D + BACK_OV) - 0.12
    string_lights((-3.2, ey, D + 0.45), (-3.8, 3.25, 12.3), 0.45)
    string_lights((3.2, ey, D + 0.45), (3.8, 3.25, 12.3), 0.45)
    string_lights((-3.8, 3.25, 12.3), (3.8, 3.25, 12.3), 0.55)
    string_lights((-3.2, ey, D + 0.45), (3.8, 3.25, 12.3), 0.7)


def adirondack(x, z, ry):
    g = G(x, 0, z, ry)   # faces local +z
    tint = jitter(mul(CEDAR, 1.05), 0.05)
    for s in (-1, 1):
        g.box('wood', 0.05, 0.36, 0.72, s * 0.31, 0.2, 0.02, rx=0.18, tint=tint)
        g.box('wood', 0.05, 0.62, 0.05, s * 0.31, 0.31, 0.3, tint=tint)
        g.box('wood', 0.14, 0.03, 0.72, s * 0.37, 0.62, 0.08, tint=tint, bevel=0.008)
    for k in range(6):
        g.box('wood', 0.62, 0.02, 0.085, 0, 0.4 - k * 0.02, 0.28 - k * 0.1, tint=tint)
    for k in range(5):
        lx = (k - 2) * 0.12
        g.box('wood', 0.09, 0.95, 0.02, lx, 0.72, -0.34, rx=-0.42, rz=-lx * 0.25, tint=tint, bevel=0.005)
    g.box('wood', 0.64, 0.05, 0.03, 0, 0.62, -0.18, rx=-0.42, tint=tint)
    g.col(0.8, 0.9, 0.9, 0, 0.45, 0.0)


# ============================================================================ cabin shell
FRONT_OPEN = [(-5.6, -3.4, 0.55, 2.65), (-1.95, -0.45, -0.05, 2.87), (0.1, 1.9, 0.85, 2.65), (3.5, 4.7, 1.55, 2.55)]
BACK_OPEN = [(-1.15, 0.15, 1.15, 2.45), (3.4, 5.3, 0.75, 2.6)]
EAST_OPEN = [(-3.3, -1.7, 0.95, 2.35), (1.1, 2.9, 2.6, 3.6)]
CHIMNEY_X = (-4.85, -3.55)


def build_shell():
    set_origin(HX, FLOOR, 0)
    # Foundation + floor
    BOX('stone', -W - 0.06, -FLOOR - 0.05, -D - 0.06, W + 0.06, -0.05, D + 0.06, tint=mul(STONE, 0.92), tile=1.3)
    BOX('wood_floor', -W + 0.06, -0.05, -ID, IW, 0.0, ID, tint=OAK, tile=(2.4, 1.2), grain=0, col=True)

    top_h = lambda u: H
    top_in = lambda u: roof_y(ID) + 0.012
    top_gable = lambda u: roof_y(u) - 0.004

    # Front + back walls: black board sheathing, plaster inside, real battens outside.
    for (zo, inward, ops) in ((-D, 1, FRONT_OPEN), (D, -1, BACK_OPEN)):
        wall_layer('x', zo, zo + inward * 0.1, -W, W, ops, top_h, 'wood', BLACK, (0.3, 1.8), 1)
        wall_layer('x', zo + inward * 0.1, zo + inward * T, -W, W, ops, top_in, 'plaster', PLASTER, 2.0, None, collide=True)
        for u in frange(-W + 0.18, W - 0.1, 0.4):
            if inward < 0 and CHIMNEY_X[0] - 0.05 < u < CHIMNEY_X[1] + 0.05:
                continue
            for poly in wall_pieces(u - 0.028, u + 0.028, ops, lambda _: H - 0.02):
                emit(bm_prism(poly, zo - inward * 0.045, zo, 'x'), 'wood', None, BLACK, (0.3, 1.8), 1)
        for o in ops:
            if o[2] < 0:
                continue
            wg = zo + inward * 0.12
            cols = 3 if o[1] - o[0] > 2.0 else 2
            rows = 2 if o[3] - o[2] > 1.4 else 1
            window('x', wg, inward, o[0], o[1], o[2], o[3], cols, rows, inner_face=zo + inward * T)
    # East gable wall.
    wall_layer('z', W - 0.1, W, -ID, ID, EAST_OPEN, top_gable, 'wood', BLACK, (0.3, 1.8), 1, breaks=(0.0,))
    wall_layer('z', W - T, W - 0.1, -ID, ID, EAST_OPEN, top_gable, 'plaster', PLASTER, 2.0, None, breaks=(0.0,), collide=True)
    for u in frange(-ID + 0.18, ID - 0.1, 0.4):
        for poly in wall_pieces(u - 0.028, u + 0.028, EAST_OPEN, lambda uu: roof_y(uu) - 0.03, breaks=(0.0,)):
            emit(bm_prism(poly, W, W + 0.045, 'z'), 'wood', None, BLACK, (0.3, 1.8), 1)
    for o in EAST_OPEN:
        window('z', W - 0.12, -1, o[0], o[1], o[2], o[3], 3 if o[1] - o[0] > 1.7 else 2, 1 if o[3] - o[2] < 1.2 else 2, inner_face=W - T)
    # Corner boards. On the glass (west) gable they wrap the whole wall thickness, so the plaster's end is hidden.
    for sx in (-1, 1):
        for sz in (-1, 1):
            if sx < 0:
                z0, z1 = sorted((sz * (D + 0.06), sz * (D - T - 0.03)))
                BOX('wood', -W - 0.06, -0.05, z0, -W + 0.06, roof_y(D - T) + 0.02, z1, tint=BLACK, grain=1)
            else:
                BOX('wood', sx * W - 0.06, -0.05, sz * D - 0.06, sx * W + 0.06, H, sz * D + 0.06, tint=BLACK, grain=1)

    # West gable: floor-to-peak glass in a black steel grid.
    XG = -W + 0.12
    zs = [-ID + i * (2 * ID / 8) for i in range(9)]
    BOX('metal_black', -W + 0.03, -0.05, -ID, -W + 0.21, 0.07, ID, tint=BLACK)
    for i, z in enumerate(zs):
        wd = 0.09 if i in (0, 8) else 0.055
        BOX('metal_black', XG - 0.06, 0.07, z - wd / 2, XG + 0.06, roof_y(z) - 0.02, z + wd / 2, tint=BLACK)
    BOX('metal_black', XG - 0.045, 2.58, -ID, XG + 0.045, 2.64, ID, tint=BLACK)
    for s in (-1, 1):
        poly = [(s * ID, roof_y(ID)), (0, RID), (0, RID - 0.1), (s * ID, roof_y(ID) - 0.1)]
        emit(bm_prism(poly, XG - 0.06, XG + 0.06, 'z'), 'metal_black', None, BLACK)
    for i in range(8):
        za, zb = zs[i], zs[i + 1]
        emit(bm_poly([(XG, 0.07, za), (XG, 0.07, zb), (XG, 2.58, zb), (XG, 2.58, za)]), 'glass')
        emit(bm_poly([(XG, 2.64, za), (XG, 2.64, zb), (XG, roof_y(zb) - 0.1, zb), (XG, roof_y(za) - 0.1, za)]), 'glass')
    C(-W + 0.12, 1.7, 0, 0.24, 3.6, 2 * ID)

    # ---- roof ----
    for s in (-1, 1):
        ov = FRONT_OV if s < 0 else BACK_OV
        ze = s * (D + ov)
        ye = roof_y(ze)
        emit(bm_prism([(0, RID), (ze, ye), (ze, ye + DECK), (0, RID + DECK)], -W - RAKE_OV, W + RAKE_OV, 'z'), 'wood', None, BLACK, 1.0, 0)
        emit(bm_prism([(0, RID + DECK), (ze, ye + DECK), (ze, ye + DECK + 0.03), (0, RID + DECK + 0.03)], -W - RAKE_OV - 0.02, W + RAKE_OV + 0.02, 'z'), 'metal_black', None, mul(BLACK, 0.9))
        for x in frange(-W - RAKE_OV + 0.2, W + RAKE_OV - 0.1, 0.46):
            emit(bm_prism([(0, RID + DECK + 0.03), (ze, ye + DECK + 0.03), (ze, ye + DECK + 0.075), (0, RID + DECK + 0.075)], x - 0.012, x + 0.012, 'z'), 'metal_black', None, mul(BLACK, 1.1))
        # Interior plank ceiling
        emit(bm_prism([(0, RID - 0.004), (s * ID, roof_y(ID) - 0.004), (s * ID, roof_y(ID) - 0.03), (0, RID - 0.03)], -W + 0.06, IW, 'z'), 'wood_floor', None, PINE, (2.2, 0.9), 0)
        # Cedar soffit under the eave
        emit(bm_prism([(s * D, roof_y(D) - 0.001), (ze, ye - 0.001), (ze, ye - 0.025), (s * D, roof_y(D) - 0.025)], -W - RAKE_OV, W + RAKE_OV, 'z'), 'wood', None, CEDAR, 1.0, 0)
        # Gutter + downspouts
        TUBE('metal_black', [(-W - RAKE_OV, ye + 0.03, ze + s * 0.07), (W + RAKE_OV, ye + 0.03, ze + s * 0.07)], 0.065, 10, tint=BLACK)
        for sx in (-1, 1):
            x = sx * (W + RAKE_OV - 0.15)
            if s < 0 and sx < 0:
                continue   # the porch roof is under the front-left eave
            TUBE('metal_black', [(x, ye, ze + s * 0.07), (x, ye - 0.25, ze + s * 0.02), (x, -FLOOR + 0.05, ze + s * 0.02)], 0.04, 8, tint=BLACK)
    BOX('metal_black', -W - RAKE_OV - 0.02, RID + DECK + 0.02, -0.16, W + RAKE_OV + 0.02, RID + DECK + 0.1, 0.16, tint=BLACK)
    # Rake soffits under the gable overhangs
    zf, zb = -(D + FRONT_OV), D + BACK_OV
    yf, yb = roof_y(zf), roof_y(zb)
    chev = [(zf, yf - 0.001), (0, RID - 0.001), (zb, yb - 0.001), (zb, yb - 0.025), (0, RID - 0.025), (zf, yf - 0.025)]
    emit(bm_prism(chev, W, W + RAKE_OV, 'z'), 'wood', None, CEDAR, 1.0, 0)
    emit(bm_prism(chev, -W - RAKE_OV, -W, 'z'), 'wood', None, CEDAR, 1.0, 0)

    # ---- exposed trusses (great room) + ridge beams ----
    for x in (-4.15, -1.45, 1.2):
        B('wood', 0.2, 0.28, 2 * ID, x, roof_y(ID) - 0.17, 0, tint=TIMBER, bevel=0.012, grain=2)
        for s in (-1, 1):
            poly = [(s * ID, roof_y(ID) - 0.03), (0, RID - 0.03), (0, RID - 0.3), (s * ID, roof_y(ID) - 0.3)]
            emit(bm_prism(poly, x - 0.09, x + 0.09, 'z'), 'wood', None, TIMBER, (1.0, 0.3), 2)
            beam('wood', (x, H + 0.1, s * 0.12), (x, roof_y(2.2) - 0.25, s * 2.2), 0.14, 0.14, TIMBER, 0.01)
            for (pz, py) in ((s * (ID - 0.25), H + 0.02), (s * 0.12, H + 0.08)):
                for sx in (-1, 1):
                    B('metal_black', 0.012, 0.26, 0.3, x + sx * 0.106, py, pz, tint=BLACK)
        B('wood', 0.2, RID - 0.3 - H, 0.2, x, (H + RID - 0.3) / 2, 0, tint=TIMBER, bevel=0.01, grain=1)
        for sx in (-1, 1):
            B('metal_black', 0.012, 0.42, 0.34, x + sx * 0.106, H + 0.02, 0, tint=BLACK)
            for (by, bz) in ((H - 0.06, -0.09), (H - 0.06, 0.09), (H + 0.12, 0.0)):
                CYL('metal_black', 0.018, 0.018, 0.02, x + sx * 0.116, by, bz, 8, rz=PI / 2, tint=BLACK)
    B('wood', PX1 - 0.06 - (-W + 0.14), 0.36, 0.22, (PX1 - 0.06 + (-W + 0.14)) / 2, RID - 0.03 - 0.18, 0, tint=TIMBER, bevel=0.012, grain=0)
    B('wood', IW - (PX1 + 0.06), 0.3, 0.2, (IW + PX1 + 0.06) / 2, RID - 0.03 - 0.15, 0, tint=TIMBER, bevel=0.012, grain=0)

    # ---- interior partitions ----
    DOOR_BED = (0.55, 1.45, -0.05, 2.2)
    DOOR_BATH = (-1.55, -0.7, -0.05, 2.2)
    wall_layer('z', PX1 - 0.06, PX1 + 0.06, -ID, ID, [DOOR_BED, DOOR_BATH], lambda u: roof_y(u) - 0.02, 'plaster', PLASTER, 2.0, None, breaks=(0.0,), collide=True)
    wall_layer('x', PZ2 - 0.06, PZ2 + 0.06, PX1 + 0.06, IW, [], lambda u: roof_y(PZ2 - 0.06) - 0.02, 'plaster', PLASTER, 2.0, None, collide=True)
    for (u0, u1, _, _) in (DOOR_BED, DOOR_BATH):
        BOX('wood', PX1 - 0.085, -0.0, u0 - 0.07, PX1 + 0.085, 2.19, u0 + 0.02, tint=WALNUT, grain=1)
        BOX('wood', PX1 - 0.085, -0.0, u1 - 0.02, PX1 + 0.085, 2.19, u1 + 0.07, tint=WALNUT, grain=1)
        BOX('wood', PX1 - 0.085, 2.17, u0 - 0.07, PX1 + 0.085, 2.3, u1 + 0.07, tint=WALNUT, grain=2)
    # Bedroom door, standing open into the bedroom.
    BOX('wood', PX1 + 0.085, 0.01, 1.4, PX1 + 0.085 + 0.86, 2.16, 1.445, tint=WALNUT, grain=1)
    for sz in (-1, 1):
        SPH('brass', 0.028, PX1 + 0.085 + 0.76, 1.0, 1.4225 + sz * 0.045, 10, 8)
    C(PX1 + 0.53, 1.1, 1.42, 0.86, 2.2, 0.06)
    # Bath: sliding barn door on the great-room side, parked beside the opening.
    BOX('metal_black', PX1 - 0.1, 2.34, -2.85, PX1 - 0.075, 2.38, -0.45, tint=BLACK)
    for zz in (-2.55, -1.85):
        CYL('metal_black', 0.045, 0.045, 0.02, PX1 - 0.12, 2.3, zz, 16, rz=PI / 2, tint=BLACK)
    for k in range(6):
        BOX('wood', PX1 - 0.15, 0.03, -2.72 + k * 0.17, PX1 - 0.11, 2.24, -2.72 + (k + 1) * 0.17 - 0.004, tint=jitter(WALNUT, 0.08), grain=1)
    BOX('metal_black', PX1 - 0.17, 0.95, -1.8, PX1 - 0.15, 1.35, -1.78, tint=BLACK)

    # ---- front door assembly ----
    wg = -D + 0.13
    for (x0, x1, y0, y1) in ((-1.97, -1.91, -0.05, 2.87), (-0.49, -0.43, -0.05, 2.87), (-0.905, -0.855, -0.05, 2.43), (-1.91, -0.49, 2.4, 2.45), (-1.95, -0.45, 2.82, 2.89)):
        BOX('metal_black', x0, y0, wg - 0.06, x1, y1, wg + 0.06, tint=BLACK)
    emit(bm_poly([(-0.855, 0.0, wg), (-0.49, 0.0, wg), (-0.49, 2.4, wg), (-0.855, 2.4, wg)]), 'glass')
    emit(bm_poly([(-1.91, 2.45, wg), (-0.49, 2.45, wg), (-0.49, 2.82, wg), (-1.91, 2.82, wg)]), 'glass')
    C(-0.67, 1.2, wg, 0.44, 2.4, 0.1)
    BOX('metal_black', -1.95, -0.05, -D - 0.01, -0.45, 0.008, -ID, tint=BLACK)
    DOORS['FrontDoor'] = {'hinge': Vector((-1.91, 0, wg)) + ORIGIN, 'buckets': {}}   # (ORIGIN: the house's HX shift and FLOOR)
    _target[0] = DOORS['FrontDoor']['buckets']
    for k in range(5):
        x0 = -1.905 + k * 0.198
        BOX('wood', x0 + 0.002, 0.012, wg - 0.028, x0 + 0.196, 2.39, wg + 0.028, tint=jitter(CEDAR, 0.05), grain=1)
    for sz in (-1, 1):
        BOX('metal_black', -1.08, 0.7, wg + sz * 0.075 - 0.011, -1.058, 1.7, wg + sz * 0.075 + 0.011, tint=BLACK)
        for yy in (0.76, 1.64):
            BOX('metal_black', -1.075, yy - 0.01, min(wg, wg + sz * 0.075), -1.063, yy + 0.01, max(wg, wg + sz * 0.075), tint=BLACK)
    _target[0] = None
    with layer('near'):
        barn_light(-2.3, 2.2, -D - 0.02, PI)
        barn_light(-0.1, 2.2, -D - 0.02, PI)

    # ---- porch (centered on the door opening) ----
    PXL, PXR = -5.6, 3.2
    z = PZ0
    while z < -D - 0.01:
        BOX('wood', PXL, -0.16, z + 0.004, PXR, -0.1, min(z + 0.14, -D) - 0.004, tint=jitter(CEDAR, 0.06), grain=0)
        z += 0.14
    C((PXL + PXR) / 2, -0.35, (PZ0 - D) / 2, PXR - PXL, 0.5, -D - PZ0)
    BOX('stone', PXL, -FLOOR - 0.05, PZ0, PXR, -0.16, PZ0 + 0.28, tint=mul(STONE, 0.9), tile=1.2)
    for x0 in (PXL, PXR - 0.28):
        BOX('stone', x0, -FLOOR - 0.05, PZ0, x0 + 0.28, -0.16, -D, tint=mul(STONE, 0.9), tile=1.2)
    SX0, SX1 = -2.35, -0.05
    for (y1, z0, z1) in ((-0.23, PZ0 - 0.32, PZ0), (-0.36, PZ0 - 0.64, PZ0 - 0.32)):
        BOX('wood', SX0, -FLOOR - 0.02, z0, SX1, y1, z1, tint=jitter(CEDAR, 0.04), grain=0, col=True)
    posts = (-5.4, -2.6, 0.2, 3.0)
    pz = PZ0 + 0.15
    for x in posts:
        BOX('wood', x - 0.1, -0.1, pz - 0.1, x + 0.1, 2.1, pz + 0.1, tint=TIMBER, bevel=0.012, grain=1, col=True)
        BOX('metal_black', x - 0.13, -0.1, pz - 0.13, x + 0.13, 0.02, pz + 0.13, tint=BLACK)
        for sx in (-1, 1):
            if (x == posts[0] and sx < 0) or (x == posts[-1] and sx > 0):
                continue
            beam('wood', (x + sx * 0.06, 1.62, pz), (x + sx * 0.5, 2.16, pz), 0.1, 0.1, TIMBER, 0.006)
    BOX('wood', PXL, 2.1, pz - 0.12, PXR, 2.44, pz + 0.12, tint=TIMBER, bevel=0.012, grain=0)
    py0, py1, pzf = H - 0.25, 2.5, PZ0 - 0.3
    emit(bm_prism([(-D, py0), (pzf, py1), (pzf, py1 - 0.12), (-D, py0 - 0.12)], PXL - 0.2, PXR + 0.2, 'z'), 'wood', None, BLACK, 1.0, 0)
    emit(bm_prism([(-D, py0), (pzf, py1), (pzf, py1 + 0.025), (-D, py0 + 0.025)], PXL - 0.22, PXR + 0.22, 'z'), 'metal_black', None, mul(BLACK, 0.9))
    for x in frange(PXL - 0.05, PXR + 0.2, 0.46):
        emit(bm_prism([(-D, py0 + 0.025), (pzf, py1 + 0.025), (pzf, py1 + 0.065), (-D, py0 + 0.065)], x - 0.012, x + 0.012, 'z'), 'metal_black', None, mul(BLACK, 1.1))
    emit(bm_prism([(-D, py0 - 0.121), (pzf, py1 - 0.121), (pzf, py1 - 0.145), (-D, py0 - 0.145)], PXL - 0.2, PXR + 0.2, 'z'), 'wood', None, CEDAR, 1.0, 0)
    TUBE('metal_black', [(PXL - 0.2, py1 + 0.02, pzf - 0.07), (PXR + 0.2, py1 + 0.02, pzf - 0.07)], 0.06, 10, tint=BLACK)
    with layer('near'):
        for i in range(len(posts) - 1):
            string_lights((posts[i], 2.08, pz - 0.12), (posts[i + 1], 2.08, pz - 0.12), 0.28)
        # Porch life: rocking chairs, a swing, planters, a doormat.
        rocker(1.45, -5.7, PI + 0.25)
        rocker(2.55, -5.55, PI - 0.3)
        B('wood', 0.36, 0.42, 0.36, 2.0, 0.11, -5.35, tint=WALNUT, bevel=0.01, col=True)
        lantern_box(2.0, 0.49, -5.35, 0.8)
        porch_swing(-4.0, -5.85)
        # Set back from the posts (and clear of the swing) so neither pots nor fronds touch the timber.
        for (fx, seed) in ((-2.5, 11), (0.1, 12)):
            plant_fern(fx, 0.45, -6.15, seed=seed)
            pot(fx, -0.1, -6.15, 0.24, 0.55, TERRA)
            C(fx, 0.3, -6.15, 0.5, 0.8, 0.5)
        rug('jute', -1.75, -D - 0.75, -0.65, -D - 0.12, y=-0.1)

    # ---- chimney (outside) ----
    BOX('stone', CHIMNEY_X[0], -FLOOR - 0.05, D, CHIMNEY_X[1], 7.2, D + 0.85, tint=mul(STONE, 0.95), tile=1.2)
    BOX('metal_black', CHIMNEY_X[0] - 0.06, 7.2, D - 0.06, CHIMNEY_X[1] + 0.06, 7.28, D + 0.91, tint=BLACK)
    CYL('metal_black', 0.11, 0.11, 0.4, (CHIMNEY_X[0] + CHIMNEY_X[1]) / 2, 7.48, D + 0.42, 12, tint=BLACK)
    CYL('metal_black', 0.2, 0.2, 0.03, (CHIMNEY_X[0] + CHIMNEY_X[1]) / 2, 7.72, D + 0.42, 12, tint=BLACK)
    C((CHIMNEY_X[0] + CHIMNEY_X[1]) / 2, 1.0, D + 0.42, CHIMNEY_X[1] - CHIMNEY_X[0], 3.0, 0.85)

    # ---- woodpile against the back wall ----
    x0, x1 = 0.55, 3.15
    for x in (x0, x1):
        BOX('metal_black', x - 0.02, -FLOOR, D + 0.08, x + 0.02, -FLOOR + 1.45, D + 0.1, tint=BLACK)
        BOX('metal_black', x - 0.02, -FLOOR, D + 0.52, x + 0.02, -FLOOR + 1.45, D + 0.54, tint=BLACK)
    BOX('metal_black', x0, -FLOOR, D + 0.08, x1, -FLOOR + 0.03, D + 0.54, tint=BLACK)
    yy = -FLOOR + 0.12
    row = 0
    while yy < -FLOOR + 1.38:
        x = x0 + 0.1 + (0.09 if row % 2 else 0.0)
        while x < x1 - 0.08:
            r_ = rng.uniform(0.07, 0.095)
            emit(bm_cyl(r_, r_, 0.44, 8, caps=False), 'wood', xf(x, yy, D + 0.31, 0, PI / 2, 0), jitter(BARK, 0.15), 1.0, None, None, True)
            for sz in (-1, 1):
                emit(bm_poly([(x + math.cos(2 * PI * k / 8) * r_, yy + math.sin(2 * PI * k / 8) * r_, D + 0.31 + sz * 0.22) for k in (range(8) if sz > 0 else reversed(range(8)))]), 'wood', None, jitter(ENDGRAIN, 0.1))
            x += r_ * 2 + 0.005
        yy += 0.165
        row += 1
    C((x0 + x1) / 2, -FLOOR + 0.7, D + 0.31, x1 - x0, 1.45, 0.5)


def rocker(x, z, ry):
    g = G(x, -0.1, z, ry)
    R_ = 1.1
    for s in (-1, 1):
        arc = [g.p(s * 0.24, 0.02 + R_ - R_ * math.cos(ph), R_ * math.sin(ph)) for ph in [(-0.34 + 0.68 * k / 12) for k in range(13)]]
        TUBE('painted', arc, 0.02, 6, tint=BLACK)
        g.box('painted', 0.035, 0.42, 0.035, s * 0.24, 0.3, 0.2, tint=BLACK)
        g.box('painted', 0.035, 1.0, 0.035, s * 0.24, 0.55, -0.2, rx=-0.12, tint=BLACK)
        g.box('painted', 0.06, 0.03, 0.5, s * 0.26, 0.64, 0.02, tint=BLACK)
    g.box('painted', 0.52, 0.04, 0.46, 0, 0.44, 0.0, tint=BLACK)
    for k in range(7):
        g.box('painted', 0.018, 0.5, 0.018, -0.2 + k * 0.066, 0.78, -0.23, rx=-0.14, tint=BLACK)
    g.box('painted', 0.52, 0.05, 0.04, 0, 1.04, -0.27, rx=-0.14, tint=BLACK)
    g.put(bm_box(0.44, 0.06, 0.4, 0.025, 3), 'fabric', 0, 0.49, 0.02, tint=CREAM, smooth=True, tile=0.3)
    g.col(0.6, 1.0, 0.8, 0, 0.5, 0.0)


def porch_ceiling_y(z):
    # underside of the porch roof (house coords): slopes from the wall (z = -D) to the front
    return (H - 0.25 - 0.145) + ((2.5 - 0.145) - (H - 0.25 - 0.145)) * ((-D - z) / (-D - (PZ0 - 0.3)))


def porch_swing(x, z):
    g = G(x, -0.1, z, PI)
    top = porch_ceiling_y(z) + 0.1
    for k in range(6):
        g.box('wood', 1.5, 0.025, 0.07, 0, 0.5, -0.2 + k * 0.08, tint=jitter(CEDAR, 0.05))
    for k in range(5):
        g.box('wood', 1.5, 0.08, 0.025, 0, 0.62 + k * 0.1, -0.28, rx=-0.15, tint=jitter(CEDAR, 0.05))
    for s in (-1, 1):
        g.box('wood', 0.05, 0.3, 0.5, s * 0.77, 0.66, 0.0, tint=CEDAR)
        g.box('wood', 0.07, 0.03, 0.55, s * 0.77, 0.82, 0.0, tint=CEDAR)
        a = g.p(s * 0.72, 0.84, 0.18)
        b = g.p(s * 0.72, top, 0.0)
        TUBE('metal_black', [a, b], 0.008, 4, tint=BLACK)
        a = g.p(s * 0.72, 0.84, -0.26)
        TUBE('metal_black', [a, b], 0.008, 4, tint=BLACK)
    g.put(bm_box(1.4, 0.07, 0.44, 0.03, 3), 'fabric', 0, 0.55, 0.02, tint=CREAM, smooth=True, tile=0.3)
    for s, tint in ((-1, RUST), (1, OLIVE)):
        g.put(bm_box(0.36, 0.34, 0.12, 0.05, 3), 'fabric', s * 0.5, 0.78, -0.18, rx=-0.25, ry=s * 0.15, tint=tint, smooth=True, tile=0.3)
    g.col(1.6, 1.0, 0.7, 0, 0.5, 0.0)


# ============================================================================ interior
def build_fireplace():
    FX0, FX1 = -5.25, -3.15
    Z0, ZM, Z1 = 3.55, 3.9, ID + 0.01
    OP = [(-4.7, -3.7, 0.4, 1.2)]
    wall_layer('x', Z0, ZM, FX0, FX1, OP, lambda u: roof_y(Z0) + 0.02, 'stone', STONE, 1.1, None)
    wall_layer('x', ZM, Z1, FX0, FX1, [], lambda u: roof_y(ZM) + 0.02, 'stone', STONE, 1.1, None)
    C((FX0 + FX1) / 2, 1.7, (Z0 + Z1) / 2, FX1 - FX0, 3.4, Z1 - Z0)
    BOX('stone', -4.7, 0.4, ZM - 0.01, -3.7, 1.2, ZM, tint=mul(SOOT, 2.5))
    # The firebox floor: 1 cm proud of the opening's sill and the hearth (all at 0.4, where they fought), out to the front.
    BOX('stone', -4.7, 0.38, Z0, -3.7, 0.41, ZM, tint=mul(SOOT, 3.0))
    BOX('stone', -4.7, 1.18, Z0 + 0.02, -3.7, 1.2, ZM, tint=mul(SOOT, 3.0))
    # Raised hearth (seat height), mantel beam
    BOX('stone', -5.65, 0.0, Z0 - 0.62, -2.75, 0.4, Z0 + 0.01, tint=mul(STONE, 0.78), tile=0.9, col=True)
    BOX('wood', -5.05, 1.5, Z0 - 0.26, -3.35, 1.72, Z0 + 0.03, tint=mul(TIMBER, 0.85), bevel=0.012, grain=0)
    # Andirons, logs, embers
    for x in (-4.45, -3.95):
        BOX('metal_black', x - 0.015, 0.4, Z0 + 0.08, x + 0.015, 0.52, Z0 + 0.3, tint=BLACK)
    for (lx, ly, rz) in ((-4.2, 0.53, 0.05), (-4.25, 0.64, -0.08), (-4.12, 0.62, 0.12)):
        CYL('wood', 0.06, 0.065, 0.62, lx, ly, Z0 + 0.2, 8, rz=PI / 2 + rz, tint=mul(BARK, 0.55))
    for k in range(10):
        SPH('embers', rng.uniform(0.03, 0.06), rng.uniform(-4.5, -3.9), 0.43, Z0 + rng.uniform(0.1, 0.3), 8, 6, s=(1, 0.5, 1))
    empty('FIRE_hearth', (-4.2, 0.7, Z0 + 0.2))
    # Mantel styling. A landscape painting hangs above (hangPainting in src/props/cabin.js: frame x -4.885..-3.515,
    # y 1.93..2.82, face 6.3 cm off the stone), so the vase stands forward of it and its stems lean into the room.
    for (x, h) in ((-4.95, 0.22), (-4.85, 0.14), (-3.5, 0.18)):
        candle(x, 1.72, Z0 - 0.12, h)
    vase(-3.85, 1.72, Z0 - 0.15, 0.3, 0.07, mul(TERRA, 1.0))
    eucalyptus(-3.85, 1.98, Z0 - 0.15, 7, seed=115)
    # Spare split logs stacked on the hearth's end, a 4-3-2 pyramid, ends a little ragged (the same nine tint draws as
    # the log holder they used to lie in, so nothing after them in the build changes).
    k = 0
    for row, n in enumerate((4, 3, 2)):
        for i in range(n):
            x = -3.05 + (i - (n - 1) / 2) * 0.125 + ((k * 5) % 3 - 1) * 0.004
            CYL('wood', 0.06, 0.06, 0.52, x, 0.46 + row * 0.104, Z0 - 0.3 + ((k * 7) % 5 - 2) * 0.012, 7, rx=PI / 2, tint=jitter(BARK, 0.12))
            k += 1


def sofa(x, z, ry, length=2.5):
    g = G(x, 0, z, ry)
    L = length
    g.box('wood', L, 0.06, 0.95, 0, 0.1, 0, tint=WALNUT)
    for sx in (-1, 1):
        for sz in (-1, 1):
            g.box('wood', 0.05, 0.1, 0.05, sx * (L / 2 - 0.08), 0.04, sz * 0.4, tint=WALNUT)
    g.put(bm_box(L, 0.22, 0.95, 0.05, 3), 'leather', 0, 0.24, 0, tint=COGNAC, smooth=True, tile=0.4)
    g.put(bm_box(L, 0.52, 0.22, 0.08, 3), 'leather', 0, 0.55, -0.37, tint=mul(COGNAC, 0.95), smooth=True, tile=0.4)
    for sx in (-1, 1):
        g.put(bm_box(0.2, 0.42, 0.95, 0.08, 3), 'leather', sx * (L / 2 - 0.1), 0.5, 0, tint=mul(COGNAC, 0.97), smooth=True, tile=0.4)
    n = 3
    cw = (L - 0.4) / n
    for i in range(n):
        lx = -L / 2 + 0.2 + cw * (i + 0.5)
        g.put(bm_box(cw - 0.02, 0.16, 0.7, 0.06, 3), 'leather', lx, 0.42, 0.1, tint=jitter(COGNAC, 0.03), smooth=True, tile=0.4)
        g.put(bm_box(cw - 0.04, 0.46, 0.2, 0.08, 3), 'leather', lx, 0.72, -0.22, rx=-0.12, tint=jitter(COGNAC, 0.03), smooth=True, tile=0.4)
    # Throw pillows. The cream one rests in front of the olive (they overlap across; at one depth their faces fought).
    for (lx, y, z, tint, rz) in ((-L / 2 + 0.45, 0.72, -0.08, OLIVE, 0.12), (-L / 2 + 0.72, 0.7, 0.04, CREAM, -0.06), (L / 2 - 0.45, 0.72, -0.08, RUST, -0.1)):
        g.put(bm_box(0.44, 0.44, 0.13, 0.07, 3), 'fabric', lx, y, z, rx=-0.28, rz=rz, tint=tint, smooth=True, tile=0.3)
    g.put(bm_blanket(0.42, 0.95, (0, 0, 0.02, 0.35), 0.05, 0.008, 3), 'fabric', L / 2 - 0.1, 0.735, -0.02, tint=mul(CREAM, 0.95), tile=0.25, smooth=True)
    g.col(L, 0.9, 0.95, 0, 0.45, 0)


def bm_arc_solid(section, th0, th1, segs):
    """A closed (r, y) cross-section swept about the y axis from th0 to th1, with both ends capped: a solid arc."""
    bm = bmesh.new()
    rings = []
    for i in range(segs + 1):
        th = th0 + (th1 - th0) * i / segs
        c, s_ = math.cos(th), math.sin(th)
        rings.append([bm.verts.new((c * r, y, s_ * r)) for (r, y) in section])
    n = len(section)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(n):
            j = (k + 1) % n
            bm.faces.new((a[k], b[k], b[j], a[j]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def swivel_chair(x, z, ry, tint=CREAM):
    g = G(x, 0, z, ry)
    g.cyl('metal_black', 0.22, 0.25, 0.04, 0, 0.02, 0, 24, tint=BLACK)
    g.put(bm_box(0.78, 0.28, 0.74, 0.12, 3), 'fabric', 0, 0.3, 0.02, tint=tint, smooth=True, tile=0.25)
    # The tub back and arms: a closed wall section swept round the back (z <= ~0.12) and capped at the arm ends, so
    # it is solid from every side (it was an open lathe with its front cut away, hollow at the arm ends).
    back = bm_arc_solid([(0.36, 0.0), (0.4, 0.2), (0.39, 0.42), (0.34, 0.46), (0.3, 0.44), (0.31, 0.22), (0.27, 0.02)],
                        PI - 0.3, 2 * PI + 0.3, 24)
    g.put(back, 'fabric', 0, 0.42, 0.02, tint=tint, smooth=True, tile=0.25)
    g.put(bm_box(0.6, 0.12, 0.56, 0.05, 3), 'fabric', 0, 0.49, 0.06, tint=jitter(tint, 0.02), smooth=True, tile=0.25)
    g.col(0.8, 0.8, 0.8, 0, 0.4, 0)


def two_sided(bm, t):
    """A sheet with a back: a copy of its faces, t below (local -y) and facing the other way, joined along the rim."""
    bm.normal_update()
    top = list(bm.faces)
    ret = bmesh.ops.duplicate(bm, geom=top)
    back = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMFace)]
    bmesh.ops.translate(bm, vec=(0, -t, 0), verts=list({v for f in back for v in f.verts}))
    bmesh.ops.reverse_faces(bm, faces=back)
    return bm


def sling_chair(x, z, ry):
    g = G(x, 0, z, ry)
    for sx in (-1, 1):
        g.put(bm_tube([(sx * 0.3, 0.0, 0.32), (sx * 0.3, 0.45, 0.3), (sx * 0.3, 0.45, -0.3), (sx * 0.3, 0.0, -0.32)], 0.018, 6), 'wood', 0, 0, 0, tint=WALNUT, smooth=True)
        g.put(bm_tube([(sx * 0.3, 0.45, -0.3), (sx * 0.3, 0.85, -0.42)], 0.018, 6), 'wood', 0, 0, 0, tint=WALNUT, smooth=True)
    # The seat and back slings, two-sided (a single sheet vanished from behind).
    g.put(two_sided(bm_blanket(0.56, 0.62, (0, 0, 0, 0), 0.05, 0.004, 5), 0.006), 'leather', 0, 0.32, 0.02, rx=0.12, tint=COGNAC, tile=0.4, smooth=True)
    g.put(two_sided(bm_blanket(0.56, 0.44, (0, 0, 0, 0), 0.05, 0.004, 6), 0.006), 'leather', 0, 0.6, -0.34, rx=1.2, tint=COGNAC, tile=0.4, smooth=True)
    g.col(0.7, 0.8, 0.7, 0, 0.4, 0)


def arc_lamp(x, z, ry):
    g = G(x, 0, z, ry)
    g.box('stone', 0.34, 0.06, 0.34, 0, 0.03, 0, tint=mul(STONE, 0.4))
    pts = [g.p(0, 0.06, 0), g.p(0, 1.2, 0.05), g.p(0, 1.85, 0.45), g.p(0, 1.9, 0.95), g.p(0, 1.78, 1.35)]
    TUBE('metal_black', pts, 0.014, 6, tint=BLACK)
    g.put(bm_lathe([(0.0, 0.14), (0.05, 0.14), (0.14, 0.06), (0.2, -0.02), (0.21, -0.04)], 24), 'metal_black', 0, 1.62, 1.38, tint=BLACK, smooth=True)
    g.put(bm_sphere(0.05, 10, 8), 'emissive', 0, 1.6, 1.38)
    g.col(0.35, 1.8, 0.35, 0, 0.9, 0)


def table_lamp(x, y, z, tint=CERAMIC):
    vase(x, y, z, 0.3, 0.1, tint)
    CYL('brass', 0.008, 0.008, 0.16, x, y + 0.36, z, 6)
    emit(bm_cyl(0.13, 0.17, 0.2, 24, caps=False), 'shade', xf(x, y + 0.52, z), LINEN, 1.0, None, None, True)
    SPH('emissive', 0.035, x, y + 0.46, z, 10, 6)


def build_living():
    # Layered rugs: vintage wool over jute.
    rug('jute', -6.0, -2.55, -2.45, 2.5, h=0.008, tint=WHITE)
    rug('rug', -5.75, -2.1, -2.7, 2.2, y=0.008, tint=WHITE)
    sofa(-4.25, -0.35, 0.0)
    # Round walnut drum coffee table
    CYL('wood', 0.56, 0.56, 0.06, -4.25, 0.4, 1.05, 40, tint=WALNUT, smooth=False, grain=0)
    for yy in (0.1, 0.26):
        CYL('wood', 0.44, 0.44, 0.14, -4.25, yy, 1.05, 32, tint=mul(WALNUT, 0.85), smooth=False)
    C(-4.25, 0.22, 1.05, 1.1, 0.45, 1.1)
    book_stack(-4.45, 0.43, 0.9, 3, 0.3)
    bowl(-4.0, 0.43, 1.2, 0.15, 0.07, mul(CERAMIC, 0.9))
    candle(-4.2, 0.43, 1.35, 0.1, 0.035)
    plant_snake(-4.05, 0.43, 0.8, seed=31, pot_tint=CERAMIC)
    swivel_chair(-5.7, 1.05, PI / 2 + 0.25, CREAM)
    sling_chair(-2.75, 1.25, -PI / 2 - 0.2)
    throw_folded(-5.7, 0.62, 1.1, 0.4, 0.5, mul(LINEN, 0.97), 0.3, (0.0, 0.2, 0.0, 0.0), 9)   # sheepskin-ish throw
    arc_lamp(-6.05, 0.1, 0.35)
    # Side table + lamp at the sofa's end
    CYL('wood', 0.22, 0.22, 0.04, -2.72, 0.56, -0.35, 24, tint=WALNUT, smooth=False)
    # (Its foot stands on the wool rug, whose top is 0.02 up.)
    CYL('metal_black', 0.015, 0.015, 0.52, -2.72, 0.29, -0.35, 6, tint=BLACK)
    CYL('metal_black', 0.18, 0.18, 0.015, -2.72, 0.0275, -0.35, 20, tint=BLACK)
    table_lamp(-2.72, 0.58, -0.35, mul(TERRA, 1.0))
    C(-2.72, 0.3, -0.35, 0.45, 0.6, 0.45)
    # Console behind the sofa
    BOX('wood', -5.3, 0.74, -1.2, -3.2, 0.78, -0.92, tint=WALNUT, grain=0)
    for x in (-5.25, -3.25):
        for zz in (-1.17, -0.95):
            BOX('metal_black', x - 0.015, 0.0, zz - 0.015, x + 0.015, 0.74, zz + 0.015, tint=BLACK)
    BOX('wood', -5.25, 0.18, -1.18, -3.25, 0.2, -0.94, tint=WALNUT, grain=0)
    C(-4.25, 0.4, -1.06, 2.1, 0.8, 0.3)
    table_lamp(-4.9, 0.78, -1.06, CERAMIC)
    books_row(-4.2, -3.7, 0.78, -1.06, 0.18)
    vase(-3.45, 0.78, -1.06, 0.26, 0.07, CHAR)
    pampas(-3.45, 1.0, -1.06, 5, 23, 0.55)
    for (bx, t) in ((-4.8, RATTAN), (-3.8, mul(RATTAN, 0.85))):
        bowl(bx, 0.2, -1.06, 0.2, 0.26, t, 'fabric')
    # Reading corner by the front window
    swivel_chair(-4.6, -3.25, 0.35, mul(OLIVE, 1.15))
    CYL('wood', 0.2, 0.2, 0.03, -5.35, 0.5, -3.55, 24, tint=WALNUT, smooth=False)
    CYL('wood', 0.03, 0.03, 0.5, -5.35, 0.25, -3.55, 8, tint=WALNUT)
    candle(-5.3, 0.515, -3.5, 0.1)
    book_stack(-5.4, 0.515, -3.6, 2, 0.4)
    C(-5.35, 0.25, -3.55, 0.4, 0.5, 0.4)
    plant_fig(-5.85, 0.0, -3.85, 1.95, seed=41)
    plant_olive(-5.92, 0.0, 2.45, 2.05, seed=42, xmin=-W + 0.12)
    # Blanket ladder leaning on the back wall, between the chimney breast (x -3.15) and the counter's end (x -2.28)
    LX = -2.72
    for sx in (-1, 1):
        beam('wood', (LX + sx * 0.22, 0.02, 3.85), (LX + sx * 0.22, 1.75, 4.15), 0.04, 0.03, WALNUT)
    for k in range(5):
        t = 0.12 + k * 0.2
        B('wood', 0.44, 0.03, 0.03, LX, 0.02 + 1.73 * t, 3.85 + 0.3 * t, tint=WALNUT)
    throw_folded(LX, 1.05, 4.0, 0.36, 0.05, RUST, 0.0, (0, 0, 0.35, 0.3), 12)
    throw_folded(LX, 1.44, 4.07, 0.38, 0.05, mul(CREAM, 0.95), 0.0, (0, 0, 0.3, 0.25), 13)
    C(LX, 0.8, 4.0, 0.55, 1.6, 0.45)


def wishbone_chair(x, z, ry):
    g = G(x, 0, z, ry)
    tint = mul(OAK, 0.9)
    for sx in (-1, 1):
        g.cyl('wood', 0.017, 0.015, 0.45, sx * 0.21, 0.225, 0.19, 8, tint=tint)
        g.put(bm_tube([(sx * 0.2, 0.0, -0.2), (sx * 0.21, 0.45, -0.19), (sx * 0.2, 0.72, -0.14)], 0.017, 6), 'wood', 0, 0, 0, tint=tint, smooth=True)
    g.box('wood', 0.46, 0.03, 0.44, 0, 0.45, 0, tint=tint)
    g.put(bm_box(0.4, 0.035, 0.38, 0.012, 2), 'fabric', 0, 0.47, 0.0, tint=SAND, smooth=True, tile=0.08)
    g.put(bm_torus(0.21, 0.016, 24, 6, arc=PI), 'wood', 0, 0.72, -0.02, ry=PI, tint=tint, smooth=True)
    g.put(bm_tube([(0, 0.47, -0.2), (0, 0.6, -0.21), (-0.07, 0.72, -0.22)], 0.012, 6), 'wood', 0, 0, 0, tint=tint, smooth=True)
    g.put(bm_tube([(0, 0.6, -0.21), (0.07, 0.72, -0.22)], 0.012, 6), 'wood', 0, 0, 0, tint=tint, smooth=True)
    g.col(0.5, 0.9, 0.5, 0, 0.45, 0)


def build_dining():
    rug('jute', -0.55, -3.95, 2.2, -0.75, h=0.008, tint=mul(WHITE, 0.95))
    cx, cz = 1.0, -2.3
    # Live-edge walnut slab
    n = 18
    edge = []
    for i in range(n + 1):
        t = i / n
        edge.append((cx - 1.05 + 2.1 * t, cz - 0.47 - 0.035 * math.sin(t * 7.1 + 1.0) - 0.02 * math.sin(t * 17.0)))
    back = []
    for i in range(n, -1, -1):
        t = i / n
        back.append((cx - 1.05 + 2.1 * t, cz + 0.47 + 0.03 * math.sin(t * 6.3 + 2.0) + 0.02 * math.sin(t * 15.0)))
    emit(bm_prism(edge + back, 0.72, 0.775, 'y'), 'wood', None, WALNUT, (1.4, 0.4), 0)
    for sx in (-1, 1):
        lx = cx + sx * 0.82
        for (a, b) in (((lx, 0.0, cz - 0.36), (lx, 0.72, cz - 0.3)), ((lx, 0.0, cz + 0.36), (lx, 0.72, cz + 0.3))):
            beam('metal_black', a, b, 0.05, 0.03, BLACK)
        B('metal_black', 0.05, 0.03, 0.66, lx, 0.705, cz, tint=BLACK)
        B('metal_black', 0.05, 0.03, 0.78, lx, 0.015, cz, tint=BLACK)
    C(cx, 0.38, cz, 2.1, 0.78, 0.95)
    for (dx, dz, ry) in ((-0.5, -0.72, 0.0), (0.5, -0.72, 0.0), (-0.5, 0.72, PI), (0.5, 0.72, PI), (-1.35, 0.0, PI / 2)):
        wishbone_chair(cx + dx, cz + dz, ry + rng.uniform(-0.08, 0.08))
    vase(cx, 0.775, cz, 0.32, 0.09, mul(CERAMIC, 0.95))
    eucalyptus(cx, 1.05, cz, 8, seed=51)
    for (dx, h) in ((-0.5, 0.26), (-0.42, 0.2), (0.45, 0.24)):
        CYL('brass', 0.03, 0.04, 0.02, cx + dx, 0.785, cz + 0.05, 10)
        candle(cx + dx, 0.795, cz + 0.05, h, 0.018)
    bowl(cx + 0.7, 0.775, cz - 0.1, 0.16, 0.08, mul(WALNUT, 1.4), 'wood')
    rattan_pendant(cx, 1.95, cz, roof_y(cz) - 0.03, 0.45)


def build_entry():
    BOX('wood', -3.3, 0.42, -ID + 0.02, -2.15, 0.46, -ID + 0.4, tint=WALNUT, grain=0)
    for x in (-3.25, -2.2):
        BOX('wood', x - 0.025, 0.0, -ID + 0.04, x + 0.025, 0.42, -ID + 0.38, tint=WALNUT)
    C(-2.72, 0.23, -ID + 0.21, 1.15, 0.46, 0.4)
    for (bx, t) in ((-3.0, RATTAN), (-2.45, mul(RATTAN, 0.85))):
        bowl(bx, 0.0, -ID + 0.21, 0.19, 0.26, t, 'fabric')
    B('wood', 1.2, 0.09, 0.025, -2.72, 1.72, -ID + 0.012, tint=WALNUT)
    for k in range(5):
        x = -3.2 + k * 0.24
        B('metal_black', 0.018, 0.018, 0.08, x, 1.72, -ID + 0.06, rx=-0.35, tint=BLACK)
    # coats, a scarf, a hat
    rounded('fabric', 0.34, 0.9, 0.12, 0.05, -3.2, 1.25, -ID + 0.1, rx=0.05, tint=CHAR)
    rounded('fabric', 0.32, 0.75, 0.11, 0.05, -2.72, 1.32, -ID + 0.1, rx=0.05, tint=mul(OLIVE, 0.9))
    rounded('fabric', 0.1, 0.7, 0.04, 0.02, -2.48, 1.37, -ID + 0.08, tint=RUST)
    emit(bm_lathe([(0.0, 0.14), (0.08, 0.14), (0.09, 0.03), (0.17, 0.02), (0.18, 0.0), (0.0, 0.0)], 20), 'fabric', xf(-2.25, 1.66, -ID + 0.14, 0, -1.3, 0), mul(SAND, 0.85), 0.2, None, None, True)
    rug('rug', -2.1, -ID + 0.05, -0.3, -ID + 1.1, h=0.01)


def build_kitchen():
    Z1 = ID
    Z0 = ID - 0.62
    KX0, KX1 = -2.25, 1.35
    SINK = (-0.92, -0.08)
    RANGE = (0.45, 1.25)
    # toe kick, cabinet boxes, shaker fronts, knobs
    BOX('painted', KX0, 0.0, Z0 + 0.07, KX1, 0.1, Z1, tint=mul(SAGE, 0.6))
    for (a, b) in ((KX0, SINK[0]), (SINK[0], SINK[1]), (SINK[1], RANGE[0])):
        BOX('painted', a, 0.1, Z0, b, 0.9, Z1, tint=SAGE, grain=None)
    C((KX0 + KX1) / 2, 0.47, (Z0 + Z1) / 2, KX1 - KX0, 0.95, Z1 - Z0)
    x = KX0 + 0.02
    while x < RANGE[0] - 0.1:
        w_ = 0.44
        if SINK[0] - 0.02 < x + w_ / 2 < SINK[1] + 0.02:
            x += 0.44
            continue
        x1 = min(x + w_, RANGE[0] - 0.02)
        for (a, b, c_, d_) in ((x, x1, 0.14, 0.2), (x, x1, 0.8, 0.86), (x, x + 0.06, 0.2, 0.8), (x1 - 0.06, x1, 0.2, 0.8)):
            BOX('painted', a, c_, Z0 - 0.02, b, d_, Z0, tint=mul(SAGE, 1.06))
        SPH('brass', 0.017, x1 - 0.06, 0.74, Z0 - 0.035, 10, 8)
        x = x1 + 0.02
    # marble counters (split around the sink)
    for (a, b) in ((KX0 - 0.03, SINK[0]), (SINK[1], RANGE[0])):
        BOX('marble', a, 0.9, Z0 - 0.03, b, 0.94, Z1, tile=1.2)
    BOX('marble', RANGE[1], 0.9, Z0 - 0.03, KX1 + 0.03, 0.94, Z1, tile=1.2)
    # Apron-front sink + bridge faucet
    BOX('ceramic', SINK[0], 0.6, Z0 - 0.04, SINK[1], 0.945, Z0 + 0.02, tint=CERAMIC)
    BOX('ceramic', SINK[0], 0.6, Z0 + 0.02, SINK[0] + 0.03, 0.945, Z1 - 0.12, tint=CERAMIC)
    BOX('ceramic', SINK[1] - 0.03, 0.6, Z0 + 0.02, SINK[1], 0.945, Z1 - 0.12, tint=CERAMIC)
    BOX('ceramic', SINK[0], 0.6, Z1 - 0.15, SINK[1], 0.945, Z1 - 0.12, tint=CERAMIC)
    BOX('ceramic', SINK[0] + 0.03, 0.62, Z0 + 0.02, SINK[1] - 0.03, 0.65, Z1 - 0.15, tint=mul(CERAMIC, 0.85))
    BOX('marble', SINK[0], 0.9, Z1 - 0.12, SINK[1], 0.94, Z1, tile=1.2)
    fx = (SINK[0] + SINK[1]) / 2
    for s in (-1, 1):
        CYL('brass', 0.016, 0.016, 0.12, fx + s * 0.12, 1.0, Z1 - 0.07, 10)
        CYL('brass', 0.022, 0.022, 0.03, fx + s * 0.12, 1.08, Z1 - 0.07, 10, rz=PI / 2)
    B('brass', 0.26, 0.022, 0.022, fx, 1.06, Z1 - 0.07)
    TUBE('brass', [(fx, 1.06, Z1 - 0.07), (fx, 1.3, Z1 - 0.09), (fx, 1.33, Z1 - 0.22), (fx, 1.22, Z1 - 0.32)], 0.012, 8)
    # Range (black) with brass knobs, plaster hood
    BOX('metal_black', RANGE[0], 0.0, Z0 - 0.02, RANGE[1], 0.93, Z1, tint=mul(BLACK, 0.8))
    BOX('metal_black', RANGE[0] + 0.03, 0.93, Z0 + 0.02, RANGE[1] - 0.03, 0.95, Z1 - 0.02, tint=mul(BLACK, 0.6))
    for (bx, bz) in ((-0.2, -0.13), (0.2, -0.13), (-0.2, 0.15), (0.2, 0.15)):
        CYL('metal_black', 0.09, 0.09, 0.02, (RANGE[0] + RANGE[1]) / 2 + bx, 0.965, (Z0 + Z1) / 2 + bz, 16, tint=mul(BLACK, 1.5))
    for k in range(5):
        CYL('brass', 0.022, 0.022, 0.03, RANGE[0] + 0.1 + k * 0.15, 0.84, Z0 - 0.035, 12, rx=PI / 2)
    B('brass', 0.6, 0.02, 0.02, (RANGE[0] + RANGE[1]) / 2, 0.7, Z0 - 0.06)
    BOX('metal_black', RANGE[0] + 0.05, 0.15, Z0 - 0.025, RANGE[1] - 0.05, 0.66, Z0 - 0.02, tint=mul(BLACK, 1.2))
    C((RANGE[0] + RANGE[1]) / 2, 0.47, (Z0 + Z1) / 2, RANGE[1] - RANGE[0], 0.95, Z1 - Z0)
    hx = (RANGE[0] + RANGE[1]) / 2
    hood = bm_prism([(-0.52, 0.0), (0.52, 0.0), (0.3, 0.62), (-0.3, 0.62)], -0.52 + 0.0, 0.0, 'x')
    emit(hood, 'plaster', xf(hx, 1.66, Z1, 0, 0, 0), PLASTER, 2.0, None)
    BOX('plaster', hx - 0.3, 2.28, Z1 - 0.34, hx + 0.3, roof_y(Z1 - 0.3), Z1, tint=PLASTER)
    BOX('wood', hx - 0.55, 1.62, Z1 - 0.55, hx + 0.55, 1.68, Z1, tint=WALNUT, grain=0)
    BOX('brass', hx - 0.45, 1.6, Z1 - 0.47, hx + 0.45, 1.62, Z1 - 0.44)
    # Zellige backsplash (around the window) and behind the range
    wall_layer('x', Z1 - 0.012, Z1, KX0, KX1, [(-1.15, 0.15, 1.15, 2.45)], lambda u: 1.7 if u < RANGE[0] - 0.05 or u > RANGE[1] + 0.05 else 1.62, 'zellige', WHITE, 0.8, None, breaks=(RANGE[0] - 0.05, RANGE[1] + 0.05))
    # Pantry / panel fridge tower
    BOX('painted', 1.4, 0.0, Z0 - 0.02, 2.28, 2.4, Z1, tint=SAGE)
    for (a, b) in ((1.43, 1.83), (1.85, 2.25)):
        for (c_, d_, e_, f_) in ((a, b, 0.1, 0.16), (a, b, 2.28, 2.34), (a, a + 0.06, 0.16, 2.28), (b - 0.06, b, 0.16, 2.28)):
            BOX('painted', c_, e_, Z0 - 0.04, d_, f_, Z0 - 0.02, tint=mul(SAGE, 1.06))
    for x in (1.79, 1.89):
        B('brass', 0.018, 0.5, 0.018, x, 1.2, Z0 - 0.075)
        for yy in (0.97, 1.43):
            B('brass', 0.012, 0.012, 0.035, x, yy, Z0 - 0.055)
    C(1.84, 1.2, (Z0 + Z1) / 2, 0.88, 2.4, Z1 - Z0 + 0.04)
    # Open walnut shelves with dishes, jars and a trailing plant
    for yy in (1.5, 1.9):
        BOX('wood', KX0 + 0.05, yy - 0.035, Z1 - 0.28, -1.28, yy, Z1, tint=WALNUT, grain=0)
        x = KX0 + 0.12
        while x < -1.36:
            r_ = rng.random()
            if r_ < 0.35:
                for k in range(rng.randint(3, 6)):
                    CYL('ceramic', 0.11, 0.1, 0.015, x + 0.05, yy + 0.008 + k * 0.016, Z1 - 0.14, 20, tint=rng.choice([CERAMIC, mul(SAND, 1.05), mul(SAGE, 1.2)]), smooth=False)
                x += 0.26
            elif r_ < 0.7:
                h = rng.uniform(0.14, 0.24)
                CYL('glass', 0.05, 0.05, h, x, yy + h / 2, Z1 - 0.14, 14)
                CYL('painted', 0.045, 0.045, h * 0.6, x, yy + h * 0.3 + 0.005, Z1 - 0.14, 12, tint=rng.choice([SAND, mul(TERRA, 1.1), mul(BARK, 1.2), CREAM]))
                CYL('wood', 0.052, 0.052, 0.025, x, yy + h + 0.012, Z1 - 0.14, 14, tint=WALNUT)
                x += 0.13
            else:
                bowl(x + 0.02, yy, Z1 - 0.14, 0.09, 0.06, rng.choice([CERAMIC, mul(TERRA, 1.1)]))
                x += 0.2
    trailing_pothos(-2.1, 1.9, Z1 - 0.13, 5, seed=61, reach=0.75)
    # Island: walnut base with shaker panels, butcher-block top, three stools, globe pendants
    IX0, IX1, IZ0, IZ1 = -1.3, 1.3, 1.8, 2.7
    BOX('wood', IX0, 0.1, IZ0, IX1, 0.9, IZ1, tint=WALNUT, grain=0)
    BOX('painted', IX0 + 0.05, 0.0, IZ0 + 0.05, IX1 - 0.05, 0.1, IZ1 - 0.05, tint=mul(BLACK, 1.5))
    for k in range(4):
        a = IX0 + 0.04 + k * 0.645
        for (c_, d_, e_, f_) in ((a, a + 0.6, 0.14, 0.2), (a, a + 0.6, 0.8, 0.86), (a, a + 0.06, 0.2, 0.8), (a + 0.54, a + 0.6, 0.2, 0.8)):
            BOX('wood', c_, e_, IZ1, d_, f_, IZ1 + 0.02, tint=mul(WALNUT, 1.12), grain=None)
    BOX('wood', IX0 - 0.05, 0.9, IZ0 - 0.3, IX1 + 0.05, 0.96, IZ1 + 0.04, tint=mul(OAK, 0.85), grain=0, tile=(1.0, 0.25))
    C(0, 0.48, (IZ0 + IZ1) / 2, IX1 - IX0, 0.96, IZ1 - IZ0)
    for x in (-0.8, 0.0, 0.8):
        stool(x, IZ0 - 0.55)
        globe_pendant(x, 2.05, (IZ0 + IZ1) / 2, roof_y((IZ0 + IZ1) / 2) - 0.03)
    bowl(-0.5, 0.96, 2.3, 0.18, 0.09, CERAMIC)
    for k in range(6):
        SPH('painted', 0.045, -0.5 + math.cos(k * 1.1) * 0.08, 1.03, 2.3 + math.sin(k * 1.1) * 0.08, 10, 8, tint=rng.choice([mul(RUST, 1.2), srgb(214, 150, 40), srgb(120, 150, 60)]))
    B('wood', 0.42, 0.025, 0.28, 0.45, 0.975, 2.35, ry=0.2, tint=mul(OAK, 1.05), bevel=0.008)
    vase(0.9, 0.96, 2.4, 0.22, 0.07, CERAMIC)
    eucalyptus(0.9, 1.15, 2.4, 5, seed=62)
    rug('rug', -1.3, 2.9, 0.4, 3.45, h=0.01)


def stool(x, z):
    CYL('wood', 0.19, 0.19, 0.04, x, 0.66, z, 24, tint=mul(WALNUT, 1.1), smooth=False)
    for k in range(4):
        a = k * PI / 2 + PI / 4
        beam('metal_black', (x + math.cos(a) * 0.12, 0.64, z + math.sin(a) * 0.12), (x + math.cos(a) * 0.2, 0.0, z + math.sin(a) * 0.2), 0.022, 0.022, BLACK)
    emit(bm_torus(0.17, 0.009, 24, 5), 'metal_black', xf(x, 0.24, z), BLACK, 1.0, None, None, True)
    C(x, 0.33, z, 0.4, 0.66, 0.4)


def build_bedroom():
    BX0, BX1 = 4.05, 6.2
    BZC = 2.05
    BW = 1.75
    rug('jute', 3.3, 0.35, 6.2, 3.75, h=0.008)
    # Platform bed in walnut with a channel-tufted linen headboard
    BOX('painted', BX0 + 0.1, 0.0, BZC - BW / 2 + 0.1, BX1 - 0.05, 0.08, BZC + BW / 2 - 0.1, tint=mul(BLACK, 1.4))
    BOX('wood', BX0, 0.08, BZC - BW / 2 - 0.04, BX1, 0.36, BZC + BW / 2 + 0.04, tint=WALNUT, bevel=0.01, grain=0)
    C((BX0 + BX1) / 2, 0.32, BZC, BX1 - BX0, 0.64, BW + 0.1)
    BOX('wood', IW - 0.1, 0.0, BZC - BW / 2 - 0.12, IW, 1.42, BZC + BW / 2 + 0.12, tint=WALNUT, grain=1)
    nch = 6
    for k in range(nch):
        z0 = BZC - BW / 2 - 0.05 + k * (BW + 0.1) / nch
        rounded('fabric', 0.12, 1.02, (BW + 0.1) / nch - 0.012, 0.05, IW - 0.16, 0.9, z0 + (BW + 0.1) / nch / 2, tint=mul(LINEN, 0.95))
    rounded('fabric', BX1 - BX0 - 0.1, 0.24, BW - 0.06, 0.06, (BX0 + BX1) / 2 - 0.02, 0.48, BZC, tint=LINEN)
    # Duvet, turned back at the head, spilling over the sides
    throw_folded(BX0 + 0.8, 0.62, BZC, 1.55, BW - 0.05, mul(CREAM, 1.02), 0.0, (0.28, 0.0, 0.3, 0.3), 31)
    throw_folded(BX0 + 1.62, 0.66, BZC, 0.2, BW - 0.02, mul(LINEN, 1.0), 0.0, (0.02, 0.02, 0.28, 0.28), 32)
    # Rust throw across the foot
    throw_folded(BX0 + 0.32, 0.685, BZC, 0.5, BW + 0.02, RUST, 0.0, (0.25, 0.0, 0.3, 0.3), 33)
    # Pillows: euro shams, sleeping pillows, a lumbar
    for s in (-1, 1):
        rounded('fabric', 0.16, 0.6, 0.62, 0.1, IW - 0.3, 0.9, BZC + s * 0.42, rz=-0.2, tint=mul(LINEN, 0.97))
        rounded('fabric', 0.16, 0.44, 0.66, 0.1, IW - 0.48, 0.78, BZC + s * 0.4, rz=-0.35, tint=mul(CREAM, 0.95))
    rounded('fabric', 0.14, 0.3, 0.6, 0.08, IW - 0.62, 0.74, BZC, rz=-0.3, tint=TERRA)
    # Nightstands + swing-arm sconces
    for (nz, hint) in ((BZC - BW / 2 - 0.38, True), (BZC + BW / 2 + 0.38, False)):
        BOX('wood', IW - 0.55, 0.0, nz - 0.25, IW - 0.02, 0.56, nz + 0.25, tint=WALNUT, bevel=0.008, col=True)
        BOX('wood', IW - 0.56, 0.28, nz - 0.22, IW - 0.555, 0.5, nz + 0.22, tint=mul(WALNUT, 1.25))
        SPH('brass', 0.016, IW - 0.575, 0.39, nz, 8, 6)
        sconce(IW - 0.01, 1.35, nz, -PI / 2)
        if hint:
            # A pale ring in the dust where an alarm clock used to stand.
            emit(bm_torus(0.085, 0.004, 24, 4), 'painted', xf(IW - 0.26, 0.5605, nz + 0.05, 0, 0, 0, (1, 0.12, 1)), mul(SAND, 1.25))
            CYL('glass', 0.032, 0.029, 0.11, IW - 0.4, 0.615, nz - 0.12, 14)
            book_stack(IW - 0.3, 0.56, nz - 0.12, 1, 0.4)
        else:
            book_stack(IW - 0.3, 0.56, nz, 2, -0.3)
            vase(IW - 0.35, 0.56, nz + 0.12, 0.16, 0.05, mul(TERRA, 1.1))
    # Bench at the foot of the bed
    rounded('fabric', 0.42, 0.1, 1.4, 0.04, BX0 - 0.35, 0.44, BZC, tint=mul(OLIVE, 1.2))
    for sz in (-1, 1):
        for sx in (-1, 1):
            B('wood', 0.04, 0.4, 0.04, BX0 - 0.35 + sx * 0.16, 0.2, BZC + sz * 0.62, tint=WALNUT)
    C(BX0 - 0.35, 0.25, BZC, 0.45, 0.5, 1.4)
    # Dresser + round mirror + pampas
    DX0, DX1, DZ0, DZ1 = PX1 + 0.06, PX1 + 0.56, 2.65, 4.05
    BOX('wood', DX0, 0.08, DZ0, DX1, 0.92, DZ1, tint=WALNUT, grain=2, col=True)
    for k in range(3):
        for (za, zb) in ((DZ0 + 0.03, (DZ0 + DZ1) / 2 - 0.01), ((DZ0 + DZ1) / 2 + 0.01, DZ1 - 0.03)):
            BOX('wood', DX1, 0.12 + k * 0.26, za, DX1 + 0.015, 0.36 + k * 0.26, zb, tint=mul(WALNUT, 1.18), grain=2)
            B('brass', 0.02, 0.018, 0.14, DX1 + 0.025, 0.3 + k * 0.26, (za + zb) / 2)
    for sz in (DZ0 + 0.06, DZ1 - 0.06):
        B('wood', 0.04, 0.08, 0.04, DX0 + 0.25, 0.04, sz, tint=WALNUT)
    emit(bm_torus(0.4, 0.02, 40, 8), 'brass', xf(PX1 + 0.08, 1.62, (DZ0 + DZ1) / 2, 0, 0, PI / 2), WHITE, 1.0, None, None, True)
    emit(bm_cyl(0.395, 0.395, 0.01, 40), 'mirror', xf(PX1 + 0.075, 1.62, (DZ0 + DZ1) / 2, 0, 0, PI / 2))
    vase(DX0 + 0.25, 0.92, DZ1 - 0.25, 0.34, 0.08, CERAMIC)
    pampas(DX0 + 0.25, 1.22, DZ1 - 0.25, 6, 71, 0.75)
    book_stack(DX0 + 0.25, 0.92, DZ0 + 0.35, 3, 0.2)
    trailing_pothos(DX0 + 0.25, 0.92, (DZ0 + DZ1) / 2, 4, seed=72, reach=0.45)
    # Sheer linen curtains on a black rod at the back window
    BOX('metal_black', 3.2, 2.72, ID - 0.1, 5.5, 2.74, ID - 0.08, tint=BLACK)
    for (a, b) in ((3.15, 3.65), (5.05, 5.55)):
        n = 10
        pts = []
        for i in range(n + 1):
            x = a + (b - a) * i / n
            pts.append((x, ID - 0.14 + 0.04 * math.sin(i * PI / 2)))
        bm = bmesh.new()
        top = [bm.verts.new((x, 2.7, z)) for (x, z) in pts]
        bot = [bm.verts.new((x, 0.02, z)) for (x, z) in pts]
        for i in range(n):
            bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
        emit(bm, 'fabric', None, mul(LINEN, 0.98), 0.25, None, None, True)
    plant_snake(2.8, 0.0, 0.08, seed=73, pot_tint=TERRA)
    # Where you wake up, and where you stand
    empty('WAKE_bed', (BX1 - 0.5, 0.72, BZC), yaw=PI / 2)
    sx, sz = 4.3, 0.45
    dx, dz = PX1 - sx, 1.0 - sz
    empty('WAKE_stand', (sx, 0.02, sz), yaw=math.atan2(-dx, -dz))


def pipe(pts, r, mat='brass', tint=WHITE, sides=16, r_end=None):
    """Round tube along a path in a plane of constant x (fixed frame, so no twist where the path turns vertical)."""
    bm = bmesh.new()
    P = [Vector(p) for p in pts]
    n = len(P)
    rings = []
    for i, p in enumerate(P):
        t = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized()
        N = Vector((1, 0, 0))
        N = (N - t * N.dot(t)).normalized()
        Bn = t.cross(N)
        rr = r if r_end is None else r + (r_end - r) * i / max(1, n - 1)
        rings.append([bm.verts.new(p + (N * math.cos(2 * PI * j / sides) + Bn * math.sin(2 * PI * j / sides)) * rr) for j in range(sides)])
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            bm.faces.new((a[j], a[k], b[k], b[j]))
    emit(bm, mat, None, tint, 1.0, None, None, True)


def tub_filler(x, z):
    """Floor-mounted brass tub filler: domed escutcheon, riser, mixing body with two cross handles,
    a gooseneck spout reaching over the tub rim (toward -z) and a hand shower in a cradle."""
    AGED = mul(WHITE, 0.82)
    lathe = lambda prof, y0, segs=28: emit(bm_lathe(prof, segs), 'brass', xf(x, y0, z), AGED, 1.0, None, None, True)
    # Escutcheon, riser with collars, mixing body.
    # (bm_lathe faces outward only when the profile climbs in y: every profile here runs bottom to top.)
    lathe([(0.07, 0.0), (0.066, 0.01), (0.052, 0.022), (0.03, 0.03), (0.0, 0.03)], 0.0)
    lathe([(0.02, 0.0), (0.026, 0.02), (0.024, 0.05), (0.02, 0.07), (0.019, 0.7), (0.0, 0.7)], 0.02)
    for cy in (0.08, 0.66):
        lathe([(0.0, 0.0), (0.028, 0.0), (0.03, 0.01), (0.028, 0.02), (0.0, 0.02)], cy)
    lathe([(0.0, 0.0), (0.024, 0.0), (0.034, 0.02), (0.036, 0.1), (0.032, 0.13), (0.024, 0.15), (0.017, 0.16), (0.0, 0.16)], 0.72)
    # Hot / cold cross handles on short stems out either side of the body.
    for sx, cap in ((-1, (0.75, 0.12, 0.1)), (1, (0.12, 0.25, 0.7))):
        hx = x + sx * 0.075
        CYL('brass', 0.011, 0.013, 0.05, x + sx * 0.05, 0.8, z, 14, rz=PI / 2, tint=AGED)
        CYL('brass', 0.017, 0.017, 0.016, hx, 0.8, z, 16, rz=PI / 2, tint=AGED)
        for k in range(4):
            a = k * PI / 2 + PI / 4
            dy, dz = math.sin(a), math.cos(a)
            TUBE('brass', [(hx, 0.8, z), (hx, 0.8 + dy * 0.045, z + dz * 0.045)], 0.005, 8, tint=AGED, r_end=0.004)
            SPH('brass', 0.008, hx, 0.8 + dy * 0.047, z + dz * 0.047, 10, 6, tint=AGED)
        CYL('ceramic', 0.011, 0.011, 0.006, hx + sx * 0.009, 0.8, z, 16, rz=PI / 2, tint=CERAMIC)
        CYL('painted', 0.004, 0.004, 0.002, hx + sx * 0.0125, 0.8, z, 10, rz=PI / 2, tint=cap)
    # Gooseneck: rises from the body, arcs over and drops toward the tub; flared aerator at the tip.
    R, top = 0.2, 0.98
    path = [(x, 0.87, z), (x, 0.93, z), (x, top, z)]
    for k in range(1, 25):
        th = PI * k / 24
        path.append((x, top + R * math.sin(th), z - R + R * math.cos(th)))
    path.append((x, top - 0.05, z - 2 * R))
    pipe(path, 0.0135, tint=AGED)
    lathe([(0.0, -0.032), (0.013, -0.032), (0.0165, -0.03), (0.016, -0.012), (0.0135, 0.0)], top - 0.05, 20)
    emit(bm_lathe([(0.0, 0.0), (0.012, 0.0), (0.0, 0.0005)], 16), 'metal_black', xf(x, top - 0.0825, z - 2 * R), BLACK, 1.0, None, None, True)
    # Hand shower resting upright in a cradle on the back (+z) of the riser, hose looping from the body.
    cz = z + 0.045
    B('brass', 0.03, 0.012, 0.04, x, 0.52, z + 0.03, tint=AGED)
    TUBE('brass', [(x - 0.018, 0.52, cz + 0.005), (x - 0.018, 0.56, cz + 0.012)], 0.004, 8, tint=AGED)
    TUBE('brass', [(x + 0.018, 0.52, cz + 0.005), (x + 0.018, 0.56, cz + 0.012)], 0.004, 8, tint=AGED)
    lathe_h = lambda prof, y0: emit(bm_lathe(prof, 24), 'brass', xf(x, y0, cz + 0.012), AGED, 1.0, None, None, True)
    lathe_h([(0.0, 0.0), (0.012, 0.0), (0.014, 0.02), (0.013, 0.18), (0.02, 0.2), (0.034, 0.23), (0.036, 0.245), (0.0, 0.25)], 0.46)
    emit(bm_lathe([(0.0, 0.0), (0.033, 0.0), (0.0, 0.001)], 24), 'metal_black', xf(x, 0.7105, cz + 0.012), mul(BLACK, 1.4), 1.0, None, None, True)
    hose = [(x, 0.76, z + 0.03), (x, 0.74, z + 0.09), (x, 0.55, z + 0.14), (x, 0.3, z + 0.15), (x, 0.2, z + 0.11),
            (x, 0.24, z + 0.07), (x, 0.36, cz + 0.02), (x, 0.44, cz + 0.013), (x, 0.46, cz + 0.012)]
    # Catmull-Rom through the hose's control points, so it hangs in a smooth loop rather than kinks.
    H = [Vector(p) for p in hose]
    H = [H[0]] + H + [H[-1]]
    smooth = []
    for i in range(1, len(H) - 2):
        p0, p1, p2, p3 = H[i - 1], H[i], H[i + 1], H[i + 2]
        for k in range(6):
            t = k / 6
            smooth.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    smooth.append(H[-2])
    pipe(smooth, 0.0065, tint=mul(AGED, 0.85), sides=10)
    C(x, 0.5, z + 0.02, 0.12, 1.0, 0.14)


def build_bath():
    X0, X1, Z0, Z1 = PX1 + 0.06, IW, -ID, PZ2 - 0.06
    BOX('hex_tile', X0, 0.0, Z0, X1, 0.006, Z1, tile=1.0)
    # Zellige wainscot and the full-height shower corner
    wall_layer('z', X1 - 0.012, X1, Z0, Z1, [], lambda u: 0.9, 'zellige', mul(SAGE, 1.35), 0.8, None)
    wall_layer('x', Z1 - 0.012, Z1, X0, X1, [], lambda u: 1.3, 'zellige', mul(SAGE, 1.35), 0.8, None)
    wall_layer('z', X0, X0 + 0.012, Z0, Z1, [(-1.55, -0.7, -0.05, 2.2)], lambda u: 2.3 if u < -3.0 else 1.3, 'zellige', mul(SAGE, 1.35), 0.8, None, breaks=(-3.0,))
    wall_layer('x', Z0, Z0 + 0.012, X0, X1, [(3.5, 4.7, 1.55, 2.55)], lambda u: 2.3 if u < 3.72 else 1.3, 'zellige', mul(SAGE, 1.35), 0.8, None, breaks=(3.72,))
    # Cap rails; the partition one stops at the door casing (-1.62 .. -0.63) on either side.
    for (a, b, c_, d_, h) in ((X0, X1, Z1 - 0.03, Z1 - 0.012, 1.3), (X0 + 0.012, X0 + 0.03, -3.0, -1.62, 1.3), (X0 + 0.012, X0 + 0.03, -0.63, Z1, 1.3)):
        BOX('wood', a, h, c_, b, h + 0.03, d_, tint=WALNUT)
    # Freestanding tub under the east window, and a floor-mounted filler
    tub = bm_lathe([(0.0, 0.0), (0.28, 0.0), (0.34, 0.06), (0.38, 0.2), (0.405, 0.4), (0.42, 0.5), (0.43, 0.54), (0.415, 0.56),
                    (0.39, 0.555), (0.375, 0.5), (0.355, 0.32), (0.32, 0.14), (0.25, 0.07), (0.0, 0.06)], 40)
    emit(tub, 'ceramic', xf(5.55, 0.006, -2.5, 0, 0, 0, (0.95, 1.0, 2.05)), CERAMIC, 0.4, None, None, True)
    C(5.55, 0.3, -2.5, 0.85, 0.6, 1.8)
    tub_filler(5.55, -1.5)
    B('wood', 0.9, 0.03, 0.22, 5.55, 0.58, -2.4, tint=WALNUT)
    candle(5.4, 0.595, -2.42, 0.1)
    book_stack(5.72, 0.595, -2.4, 1, 0.2)
    rug('fabric', 4.55, -3.0, 5.0, -2.1, h=0.012, tint=mul(LINEN, 0.95))
    # Walk-in shower: black-framed glass, rain head
    SXL, SZF = 3.1, -3.0
    BOX('metal_black', X0 + 0.012, 0.0, SZF - 0.02, SXL, 2.3, SZF + 0.02, tint=BLACK)
    emit(bm_poly([(X0 + 0.04, 0.02, SZF), (SXL - 0.03, 0.02, SZF), (SXL - 0.03, 2.27, SZF), (X0 + 0.04, 2.27, SZF)]), 'glass')
    for (a, b, c_, d_) in ((X0 + 0.012, SXL, 2.26, 2.3), (X0 + 0.012, SXL, 0.0, 0.03), (SXL - 0.03, SXL, 0.0, 2.3)):
        BOX('metal_black', a, c_, SZF - 0.022, b, d_, SZF + 0.022, tint=BLACK)
    C((X0 + SXL) / 2, 1.1, SZF, SXL - X0, 2.3, 0.05)
    TUBE('metal_black', [(X0 + 0.5, 2.25, Z0 + 0.012), (X0 + 0.5, 2.25, Z0 + 0.45)], 0.015, 8, tint=BLACK)
    CYL('metal_black', 0.14, 0.14, 0.015, X0 + 0.5, 2.23, Z0 + 0.45, 24, tint=BLACK)
    CYL('metal_black', 0.04, 0.04, 0.03, X0 + 0.5, 1.2, Z0 + 0.03, 16, rx=PI / 2, tint=BLACK)
    # Floating double vanity on the bedroom wall, vessel sinks, round mirrors, sconces
    VX0, VX1 = 3.3, 5.3
    VZ = Z1
    BOX('wood', VX0, 0.42, VZ - 0.5, VX1, 0.84, VZ, tint=WALNUT, bevel=0.006, grain=0, col=True)
    for k in range(4):
        a = VX0 + 0.02 + k * 0.495
        BOX('wood', a, 0.46, VZ - 0.515, a + 0.48, 0.8, VZ - 0.5, tint=mul(WALNUT, 1.15), grain=1)
        B('brass', 0.12, 0.015, 0.015, a + 0.24, 0.76, VZ - 0.53)
    BOX('marble', VX0 - 0.02, 0.84, VZ - 0.52, VX1 + 0.02, 0.875, VZ, tile=1.2)
    for sx in (3.8, 4.8):
        bowl(sx, 0.875, VZ - 0.26, 0.2, 0.14, CERAMIC)
        TUBE('brass', [(sx, 1.12, VZ), (sx, 1.12, VZ - 0.18)], 0.012, 8)
        for k in (-1, 1):
            CYL('brass', 0.025, 0.025, 0.03, sx + k * 0.12, 1.2, VZ - 0.015, 12, rx=PI / 2)
        emit(bm_torus(0.33, 0.017, 36, 6), 'brass', xf(sx, 1.66, VZ - 0.02, 0, PI / 2, 0), WHITE, 1.0, None, None, True)
        emit(bm_cyl(0.325, 0.325, 0.008, 36), 'mirror', xf(sx, 1.66, VZ - 0.012, 0, PI / 2, 0))
    for sx in (VX0 - 0.05, 4.3, VX1 + 0.05):
        CYL('brass', 0.05, 0.05, 0.02, sx, 1.7, VZ - 0.01, 16, rx=PI / 2)
        TUBE('brass', [(sx, 1.7, VZ - 0.02), (sx, 1.72, VZ - 0.12)], 0.008, 6)
        emit(bm_sphere(0.075, 16, 10), 'glass', xf(sx, 1.82, VZ - 0.13))
        SPH('emissive', 0.03, sx, 1.8, VZ - 0.13, 8, 6)
    vase(4.3, 0.875, VZ - 0.2, 0.18, 0.05, mul(TERRA, 1.1))
    eucalyptus(4.3, 1.04, VZ - 0.2, 4, seed=81)
    # Toilet on the partition wall
    tz = -2.3
    emit(bm_lathe([(0.0, 0.0), (0.12, 0.0), (0.16, 0.2), (0.2, 0.38), (0.19, 0.41), (0.0, 0.41)], 20), 'ceramic', xf(X0 + 0.42, 0.006, tz, 0, 0, 0, (1.25, 1, 1.0)), CERAMIC, 0.4, None, None, True)
    rounded('ceramic', 0.2, 0.36, 0.44, 0.04, X0 + 0.12, 0.62, tz, tint=CERAMIC)
    C(X0 + 0.32, 0.4, tz, 0.64, 0.8, 0.46)
    # Towel ladder + towels, plants
    for sz in (-1, 1):
        beam('wood', (X1 - 0.3, 0.02, -0.95 + sz * 0.2), (X1 - 0.05, 1.7, -0.95 + sz * 0.2), 0.035, 0.03, WALNUT)
    for k in range(5):
        t = 0.15 + k * 0.18
        B('wood', 0.03, 0.03, 0.42, X1 - 0.3 + 0.25 * t, 0.02 + 1.68 * t, -0.95, tint=WALNUT)
    throw_folded(X1 - 0.16, 1.1, -0.95, 0.06, 0.36, mul(SAND, 1.05), 0.0, (0.25, 0.3, 0.0, 0.0), 82)
    C(X1 - 0.2, 0.8, -0.95, 0.4, 1.6, 0.5)
    plant_fern(5.95, 0.745, -3.95, seed=83, s=0.6)   # from the soil (pot top 0.77, soil 0.745)
    pot(5.95, 0.52, -3.95, 0.15, 0.25, CERAMIC)
    B('wood', 0.34, 0.5, 0.34, 5.95, 0.26, -3.95, tint=WALNUT, bevel=0.01, col=True)
    B('wood', 0.3, 0.3, 0.3, 4.75, 0.15, -3.6, tint=WALNUT, bevel=0.01, col=True)
    for k in range(3):
        B('fabric', 0.24, 0.05, 0.2, 4.75, 0.33 + k * 0.055, -3.6, tint=rng.choice([mul(SAND, 1.05), LINEN, mul(SAGE, 1.3)]), bevel=0.015, seg=2, smooth=True)


# ============================================================================ lights, meta
def build_meta():
    set_origin(HX, FLOOR, 0)
    empty('LIGHT_living', (-4.2, 2.6, 0.6), color=[1.0, 0.72, 0.45], power=7.0, distance=9.0)
    empty('LIGHT_kitchen', (0.3, 2.5, 0.6), color=[1.0, 0.76, 0.5], power=6.0, distance=8.5)
    empty('LIGHT_bed', (4.4, 2.3, 2.0), color=[1.0, 0.7, 0.45], power=4.5, distance=6.5)
    empty('LIGHT_bath', (4.4, 2.3, -2.3), color=[1.0, 0.8, 0.6], power=3.5, distance=6.0)
    set_origin(0, 0, 0)
    empty('META', (0, 0, 0), floorY=FLOOR, intX0=HX - W + 0.12, intX1=HX + IW, intZ0=-ID, intZ1=ID,
          eaveY=FLOOR + roof_y(ID), ridgeY=FLOOR + RID, domeR=R_DOME, houseX0=HX - W, houseX1=HX + W, houseZ0=-D, houseZ1=D,
          doorX=HX - 1.43, doorZ=-D + 0.13, domeDoorZ=DZ, houseDX=HX)


def build_all():
    for d in (BUCKETS, DOORS):
        d.clear()
    COLS.clear()
    EMPTIES.clear()
    rng.seed(1987)
    t0 = time.time()
    build_dome()
    with layer('near'):
        build_garden()
    build_shell()
    set_origin(HX, FLOOR, 0)
    with layer('in'):
        build_fireplace()
        build_living()
        build_dining()
        build_entry()
        build_kitchen()
        build_bedroom()
        build_bath()
    build_meta()
    set_origin(0, 0, 0)
    stats = realize()
    # The plaster walls are built strip by strip round the doors and windows: welded into connected surfaces, each flat
    # wall unwraps as one lightmap island and bakes without seams between its strips.
    for ob in _scene().objects:
        if ob.type == 'MESH' and ob.name.startswith(PREFIX + 'plaster'):
            weld_tjunctions(ob)
    show_scene()
    tris = 0
    for ob in _scene().objects:
        if ob.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return {'materials': stats, 'colliders': len(COLS), 'empties': len(EMPTIES), 'tris': tris, 'seconds': round(time.time() - t0, 1)}
