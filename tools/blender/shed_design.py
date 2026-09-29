# Dreambound: the Mountain shed, the Mountain elevator's upper stop at the foot of the Mountain (src/props/shed.js
# places it; src/world/stacks/mountain.js picks the spot). Executed inside dbkit.py's namespace by build_shed.py.
#
# Frame (the game's shed frame, mountain.js `sm`): origin on the levelled ground at the footprint's centre, y up, +z out
# of the door (along the path), x across. The elevator end (public/models/elevator.glb) stands at EROOT, unrotated, and
# must fit exactly: in the elevator root's frame the car's inside is |x| < 1.05, 0 < y < 2.6, -2.35 < z < -0.16, the
# doorway |x| < 0.68 and 2.3 m high, the plate |x| < 1.85 and 3.3 m high with its back at z = -0.12 (props/elevator.js).
# The plate is nearly as wide as the building, so it is built in as a partition: the side walls' posts frame its edges,
# trim boards cover its edges and head, a tie beam sits over it, and a boarded partition above the beam closes off the
# roof space over the car.
#
# The building: a tall, narrow timber-framed hoist house on a rough-dressed stone plinth. A post-and-girt frame (exposed
# inside), board-and-batten cladding of weathered boards with corner boards and a frieze, a 30 degree gabled roof of
# corrugated galvanised sheets on purlins and rafters with exposed rafter tails, fascia, barge boards and a ridge cap,
# half-round gutters and downpipes (one into a rain barrel). A stone threshold and a flagstone floor, flush with the
# car's floor (y = FL). Double ledged-and-braced doors hooked open, a small four-pane window, louvred gable vents, a
# gooseneck lamp over the door and a pendant inside (lit by the Mountain power line in the game).
#
# Materials. The Blender buckets exist for the atlas's texel density only: 'w_*' become the game's wood material and
# 'h_*' its "hard" material (metal, stone, glass, lamps), so the whole shed is two draw calls. What each surface is (its
# kind) rides on the first UV set as an integer offset of KSTEP per kind, decoded by the game's shader; the UVs
# themselves are metric tiles for the detail textures, with a random offset per piece:
#   shed_wood.png / shed_wood_normal.png     weathered rough-sawn boards (1024, a WOOD_TILE m tile); the normal map's
#                                            blue channel is a paint-flake / lichen noise (the shader rebuilds the z)
#   shed_metal.png / shed_metal_normal.png   galvanised steel (512, METAL_TILE m); blue = rust noise
#   shed_stone.png / shed_stone_normal.png   the plinth's stone (1024, STONE_TILE m); blue = moss and lichen noise
#   shed_atlas.png                           unique per surface on the second UV set (2048): R ambient occlusion,
#                                            G grime (splash-back, rain streaks, dirt in corners, rust runs on wood),
#                                            B weathering (moss and lichen on raw wood and stone, paint loss on painted
#                                            wood, rust on metal); the shader thresholds it against the tiles' noise
# The vertex colours tint each piece (paint, stone, enamel, iron).
#
# Named empties: META (dimensions), PLATE (the elevator root), LAMP_OUT / LAMP_IN (the bulbs), DOOR (the doorway's foot).
# The COLLIDER holds the floor, the threshold, the walls round the doorway, the door leaves, the barrel and the bench.

MODELS = ROOT + '/public/models/'
QUICK = os.environ.get('SHED_QUICK') == '1'
CACHE = os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_shed')

# ---------------------------------------------------------------- the elevator end (props/elevator.js), shed frame
EROOT = (0.0, 0.12, -0.05)
FL = 0.12                                  # floor = the car's floor
PLATE_HW, PLATE_TOP, PLATE_FRONT = 1.85, 3.42, 0.02
SILL_FRONT, CASE_HW = 0.115, 0.87          # the elevator sill's front; its casings' half width
BOLT_TOP = 3.335                           # the faceplate's highest bolt

# ---------------------------------------------------------------- the building
IX, IZ = 1.87, 2.64                        # the frame's inner faces (side walls, end walls)
SD = 0.09                                  # stud depth
OX, OZ = IX + SD, IZ + SD                  # sheathing line (1.96, 2.73)
BT = 0.022                                 # board thickness
FX, FZ = OX + BT, OZ + BT                  # boards' outer faces (1.982, 2.752)
BAT_T, BAT_W = 0.018, 0.055                # battens
TRIM_T = 0.025                             # trim thickness
TP = 3.45                                  # top of the double top plate
TP0 = TP - 0.09
PITCH = math.radians(30.0)
TANP, COSP, SINP = math.tan(PITCH), math.cos(PITCH), math.sin(PITCH)
RD, RW = 0.14, 0.05                        # rafters: depth, width
PD, PW = 0.07, 0.045                       # purlins: depth, width
D0 = RD + PD                               # the sheets' troughs (slope frame D)
TAIL_X = 2.30                              # rafter tails' plumb cut
EAVE_X = 2.38                              # the sheets' drip edge
RAKE_Z = 3.04                              # the sheets' ends over the gables
FLY_Z = (2.955, 3.005)                     # fly rafters
BARGE_Z = (3.005, 3.030)
NWAVE = 80
WAVE, AMP, WSEG = 2 * RAKE_Z / NWAVE, 0.0095, 6   # corrugation: pitch, half depth, segments per wave
TH = 0.0012                                # sheet thickness
LIFT = 2.2 * TH                            # the lapping sheets' lift
PL_TOP, PL_BOT = 0.42, -0.30               # stone plinth
PL_X1, PL_Z1 = FX + 0.05, FZ + 0.05
SILL_Y1 = PL_TOP + 0.07                    # timber sill plate on the plinth
DOOR_HW, DOOR_TOP, HEADER_TOP = 0.80, 2.56, 2.74
LINE_T = 0.025                             # door lining
THRESH_Z = 2.98                            # the threshold's nose
GIRTS = [(0.85, 0.895), (1.355, 1.40), (2.10, 2.145), (2.85, 2.895)]
WIN = (1.30, 1.95, 1.40, 2.10)             # right wall window rough opening: z0, z1, y0, y1
VENT = (0.30, 3.75, 4.23)                  # gable vents: half width, y0, y1
RAFTERS_Z = [-2.705, -2.0675, -1.43, -0.7925, -0.155, 0.417, 0.989, 1.561, 2.133, 2.705]
TIE_Z = (1.014, 1.084)
BEAM_Z, BEAM_H = (-0.13, 0.05), 0.18       # the tie beam over the plate
PART_Z = (-0.13, -0.04)                    # the partition's studs; its boards in front
PURLIN_X = [0.13, 0.59, 1.05, 1.51, 1.97, 2.24]   # purlin centres (horizontal x, on the rafters' top)
HIDDEN_Z = -0.02                           # behind the partition / the plate nothing inside is ever seen
BARREL = (2.40, 2.0, 0.27, 0.84)           # rain barrel: x, z, radius, height
GUT_R = 0.065

# ---------------------------------------------------------------- materials, kinds, tints
KSTEP = 64.0
WOOD_TILE, METAL_TILE, STONE_TILE = 0.75, 0.5, 0.6
BUCKETS_ = ['w_ext', 'w_int', 'w_hid', 'h_roof', 'h_stone', 'h_small']
MATS.update({'w_ext': (srgb(150, 140, 128), 0.85), 'w_int': (srgb(160, 128, 96), 0.85), 'w_hid': (srgb(120, 100, 80), 0.9),
             'h_roof': (srgb(150, 152, 156), 0.5), 'h_stone': (srgb(150, 144, 134), 0.9), 'h_small': (srgb(60, 60, 60), 0.6)})
BAKE_MATS = set(BUCKETS_)
NO_BAKE = {'collider'}
DENS = {'w_ext': 1.0, 'w_int': 0.8, 'w_hid': 0.12, 'h_roof': 0.55, 'h_stone': 0.9, 'h_small': 1.5}
WK = {'raw': 0, 'paint': 1}
HK = {'galv': 0, 'iron': 1, 'stone': 2, 'mortar': 3, 'glass': 4, 'glass_in': 5, 'glow': 6, 'enamel': 7, 'brass': 8,
      'rubber': 9, 'water': 10}

TRIM_C = (0.84, 0.82, 0.80)
FRAME_C = (1.16, 1.0, 0.82)
TEAL = srgb(52, 80, 74)
TEAL_SASH = srgb(60, 88, 80)
GALV_C = (0.9, 0.91, 0.93)
IRON_C = srgb(46, 43, 40)
ENAMEL_OUT = srgb(36, 62, 48)
ENAMEL_IN = srgb(226, 222, 208)
BRASS_C = srgb(176, 136, 70)
GLASS_C = srgb(26, 32, 34)
GLOW_C = (1.0, 0.78, 0.52)
MORTAR_C = srgb(206, 198, 180)
ROPE_C = (1.05, 0.86, 0.6)

RUST = []      # (x, y, z, (nx, ny, nz), strength, length): rust runs down from screws, hinges and brackets
SCREWS = []    # roof screws (x, y, z, side)


def jitter(c, k=0.06):
    f = 1.0 + rng.uniform(-k, k)
    return (c[0] * f, c[1] * f, c[2] * f)


def hue(c, k=0.04):
    return (c[0] * (1 + rng.uniform(-k, k)), c[1] * (1 + rng.uniform(-k, k)), c[2] * (1 + rng.uniform(-k, k)))


# ============================================================================ emit helpers
DIRS = {'+x': Vector((1, 0, 0)), '-x': Vector((-1, 0, 0)), '+y': Vector((0, 1, 0)), '-y': Vector((0, -1, 0)),
        '+z': Vector((0, 0, 1)), '-z': Vector((0, 0, -1))}


def kind_id(kind):
    return WK[kind] if kind in WK else HK[kind]


def tile_of(obj, kind):
    if obj.startswith('w_'):
        return WOOD_TILE
    return STONE_TILE if kind in ('stone', 'mortar') else METAL_TILE


def emit_uv(obj, bm, kind, tint, uvfn, smooth=False):
    """Emit a bmesh (world coordinates) whose UVs come from uvfn(face) -> [(u, v)] in metres; adds the tile scale, a
    random offset and the kind's offset."""
    bm.faces.index_update()
    t = tile_of(obj, kind)
    o = (rng.random(), rng.random())
    du, dv = KSTEP * kind_id(kind) + o[0], o[1]
    uvd = {f.index: [(u / t + du, v / t + dv) for (u, v) in uvfn(f)] for f in bm.faces}
    emit(bm, obj, None, tint, uvface=lambda f: uvd[f.index], smooth=smooth)


def put(obj, bm, M=None, kind='raw', tint=WHITE, grain=None, drop=(), smooth=False):
    """Emit a bmesh built in its own (local) coordinates, transformed by M. UVs are a box projection of the local
    coordinates, u along the grain (the longest local axis unless given). drop: faces never seen, by local normal."""
    bm.normal_update()
    if drop:
        dead = [f for f in bm.faces if any(f.normal.dot(DIRS[d]) > 0.999 for d in drop)]
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='FACES')
        bm.normal_update()
    if not bm.faces:
        bm.free()
        return
    if grain is None:
        lo = [min(v.co[i] for v in bm.verts) for i in range(3)]
        hi = [max(v.co[i] for v in bm.verts) for i in range(3)]
        grain = max(range(3), key=lambda i: hi[i] - lo[i])
    bm.faces.index_update()
    uvl = {}
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        if b == grain:
            a, b = b, a
        uvl[f.index] = [(l.vert.co[a], l.vert.co[b]) for l in f.loops]
    if M is not None:
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    emit_uv(obj, bm, kind, tint, lambda f: uvl[f.index], smooth)


def box(obj, x0, x1, y0, y1, z0, z1, kind='raw', tint=WHITE, bevel=0.0, drop=(), grain=None, M=None):
    if x1 - x0 < 1e-5 or y1 - y0 < 1e-5 or z1 - z0 < 1e-5:
        return
    bm = bm_box(x1 - x0, y1 - y0, z1 - z0, bevel, 1)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    put(obj, bm, M, kind, tint, grain=grain, drop=drop)


def prism(obj, poly, w0, w1, plane, kind='raw', tint=WHITE, grain=None, drop=(), M=None):
    """A 2D polygon extruded between w0..w1 (dbkit.bm_prism's planes: 'x' -> (x, y) along z, 'z' -> (z, y) along x)."""
    put(obj, bm_prism(poly, w0, w1, plane), M, kind, tint, grain=grain, drop=drop)


def quad(obj, pts, want, kind, tint):
    """A single flat face, turned to face `want`."""
    bm = bm_poly(pts)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    if bm.faces[0].normal.dot(Vector(want)) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    put(obj, bm, None, kind, tint)


def tube(obj, pts, r, sides=8, kind='iron', tint=IRON_C, caps=True):
    """A round tube along a polyline (parallel-transported frames, no twist), u along it."""
    P = [Vector(p) for p in pts]
    bm = bmesh.new()
    lu = bm.verts.layers.float.new('u')
    lv = bm.verts.layers.float.new('v')
    rings, acc, prevN = [], 0.0, None
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        if prevN is None:
            ref = Vector((0, 1, 0)) if abs(t.y) < 0.95 else Vector((1, 0, 0))
            N = (ref - t * ref.dot(t)).normalized()
        else:
            N = (prevN - t * prevN.dot(t)).normalized()
        prevN = N
        Bn = t.cross(N)
        if i:
            acc += (P[i] - P[i - 1]).length
        ring = []
        for j in range(sides + 1):
            a = 2 * PI * j / sides
            v = bm.verts.new(p + (N * math.cos(a) + Bn * math.sin(a)) * r)
            v[lu], v[lv] = acc, a * r
            ring.append(v)
        rings.append(ring)
    for A, Bq in zip(rings[:-1], rings[1:]):
        for j in range(sides):
            bm.faces.new((A[j], A[j + 1], Bq[j + 1], Bq[j]))
    if caps:
        bm.faces.new(list(reversed(rings[0][:-1])))
        bm.faces.new(rings[-1][:-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit_uv(obj, bm, kind, tint, lambda f: [(l.vert[lu], l.vert[lv]) for l in f.loops], smooth=lambda n: True)


def lathe(obj, prof, c, segs=16, kind='iron', tint=IRON_C, inward=False, M=None, smooth=True):
    """Surface of revolution about the vertical axis through c: prof [(r, y)]. Faces point away from the axis (toward
    it with inward); flat rings point up (down with inward). u along the profile, v round."""
    bm = bmesh.new()
    lu = bm.verts.layers.float.new('u')
    lv = bm.verts.layers.float.new('v')
    rref = max(r for r, _ in prof)
    rings, acc = [], 0.0
    for i, (r, y) in enumerate(prof):
        if i:
            acc += math.hypot(r - prof[i - 1][0], y - prof[i - 1][1])
        ring = []
        for j in range(segs + 1):
            a = 2 * PI * j / segs
            v = bm.verts.new((math.cos(a) * r, y, math.sin(a) * r))
            v[lu], v[lv] = acc, a * rref
            ring.append(v)
        rings.append(ring)
    for A, Bq in zip(rings[:-1], rings[1:]):
        for j in range(segs):
            try:
                bm.faces.new((A[j], Bq[j], Bq[j + 1], A[j + 1]))
            except ValueError:
                pass
    bm.normal_update()
    sgn = -1 if inward else 1
    flip = []
    for f in bm.faces:
        cc = f.calc_center_median()
        radial = Vector((cc.x, 0, cc.z))
        n = f.normal
        if abs(n.y) > 0.95 or radial.length < 1e-6:
            if n.y * sgn < 0:
                flip.append(f)
        elif n.dot(radial) * sgn < 0:
            flip.append(f)
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    T = Matrix.Translation(Vector(c))
    if M is not None:
        T = M @ T
    bmesh.ops.transform(bm, matrix=T, verts=bm.verts)
    emit_uv(obj, bm, kind, tint, lambda f: [(l.vert[lu], l.vert[lv]) for l in f.loops], smooth=(lambda n: True) if smooth else False)


# ============================================================================ roof geometry (the slope frame)
def yb(x):
    """The rafters' underside line (through the top plate's inner top edge)."""
    return TP + (IX - abs(x)) * TANP


def yrt(x):
    return yb(x) + RD / COSP


def ypt(x):
    return yrt(x) + PD / COSP


YB0 = yb(0.0)


def s2w(side, S, D):
    """Slope frame -> world (x, y): S down the slope from x = 0 on the rafters' underside line, D up out of the roof."""
    return (side * (S * COSP + D * SINP), YB0 - S * SINP + D * COSP)


def w2s(x, y):
    x = abs(x)
    return (x * COSP - (y - YB0) * SINP, x * SINP + (y - YB0) * COSP)


def S_at(x, D):
    """S of the point at horizontal x on the line D = const."""
    return (abs(x) - D * SINP) / COSP


def slope_M(side):
    """Slope-local (S, D, Z') -> world, a proper rotation for both sides (on the left, Z' runs along -z)."""
    ex = (side * COSP, -SINP, 0.0)
    ey = (side * SINP, COSP, 0.0)
    ez = (0.0, 0.0, float(side))
    return Matrix(((ex[0], ey[0], ez[0], 0.0), (ex[1], ey[1], ez[1], YB0), (ex[2], ey[2], ez[2], 0.0), (0, 0, 0, 1)))


def zloc(side, z0, z1):
    """World z range -> the slope frame's Z' range."""
    return (z0, z1) if side > 0 else (-z1, -z0)


def slope_box(obj, side, S0, S1, Da, Db, z0, z1, kind='raw', tint=WHITE, bevel=0.0, drop=(), grain=None):
    a, b = zloc(side, z0, z1)
    box(obj, S0, S1, Da, Db, a, b, kind, tint, bevel, drop, grain, slope_M(side))


def slope_prism(obj, side, poly_sd, z0, z1, kind='raw', tint=WHITE, drop=(), grain=None):
    a, b = zloc(side, z0, z1)
    put(obj, bm_prism(poly_sd, a, b, 'x'), slope_M(side), kind, tint, grain=grain, drop=drop)


# ============================================================================ plinth, threshold, floor
def stone(x0, x1, y0, y1, z0, z1, tint, drop=(), jit=0.005, bevel=0.018, bulge=0.0, axis=None, kind='stone'):
    bm = bm_box(x1 - x0, y1 - y0, z1 - z0, bevel, 1)
    c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    ytop = y1
    for v in bm.verts:
        v.co.x += rng.uniform(-jit, jit)
        v.co.y += rng.uniform(-jit, jit) * 0.6
        v.co.z += rng.uniform(-jit, jit)
        if bulge and axis is not None:
            d = v.co[axis] - c[axis]
            v.co[axis] += math.copysign(rng.uniform(0, bulge), d)
    put('h_stone', bm, None, kind, tint, drop=drop)


def stone_tint():
    r = rng.random()
    if r < 0.2:
        base = (1.08, 1.0, 0.86)       # ochre
    elif r < 0.4:
        base = (0.9, 0.93, 0.98)       # blue-grey
    elif r < 0.5:
        base = (0.8, 0.78, 0.76)       # dark
    else:
        base = (1.0, 0.98, 0.95)
    return hue(jitter(base, 0.08), 0.03)


def lay_course(axis, lo, hi, y0, y1, w0, w1, gaps=(), drop_fn=None, stagger=0.0):
    """Stones along one axis ('x' or 'z') from lo to hi, a course from y0 to y1, the band from w0 to w1 across it."""
    J = 0.012
    cuts, pos = [], lo
    if stagger > 0:
        cuts.append((lo, lo + stagger))
        pos = lo + stagger
    while pos < hi - 1e-4:
        L = rng.uniform(0.28, 0.62)
        if hi - (pos + L) < 0.2:
            L = hi - pos
        cuts.append((pos, pos + L))
        pos += L
    for (a, b) in cuts:
        for (s0, s1) in segments(a, b, gaps):
            if s1 - s0 < 0.06:
                continue
            ya = y0 + J / 2 + rng.uniform(-0.004, 0.004)
            yb_ = y1 - J / 2 + rng.uniform(-0.006, 0.004)
            drop = drop_fn((s0 + s1) / 2) if drop_fn else ()
            if axis == 'x':
                stone(s0 + J / 2, s1 - J / 2, ya, yb_, w0, w1, stone_tint(), drop=drop, bulge=0.006, axis=2)
            else:
                stone(w0, w1, ya, yb_, s0 + J / 2, s1 - J / 2, stone_tint(), drop=drop, bulge=0.006, axis=0)


def build_plinth():
    courses = [(PL_BOT, 0.19), (0.19, PL_TOP)]
    door = [(-DOOR_HW - 0.005, DOOR_HW + 0.005)]
    for ci, (y0, y1) in enumerate(courses):
        for s in (-1, 1):
            # side bands: course 0 runs to the corners, course 1 between the end bands (quoins alternate)
            zl = PL_Z1 if ci == 0 else IZ
            w0, w1 = (IX, PL_X1) if s > 0 else (-PL_X1, -IX)
            hid = (lambda m, s=s: (('-x',) if s > 0 else ('+x',)) if m < -0.2 else ())
            lay_course('z', -zl, zl, y0, y1, w0, w1, drop_fn=hid, stagger=rng.uniform(0, 0.2))
            # end bands: course 0 between the side bands, course 1 to the corners; the doorway in the front one
            xl = IX if ci == 0 else PL_X1
            w0, w1 = (IZ, PL_Z1) if s > 0 else (-PL_Z1, -IZ)
            lay_course('x', -xl, xl, y0, y1, w0, w1, gaps=door if s > 0 else (), drop_fn=None if s > 0 else (lambda m: ('+z',)),
                       stagger=rng.uniform(0, 0.2))
    # mortar behind the stones (seen in the joints)
    m = 0.012
    for s in (-1, 1):
        x0, x1 = (IX + m, PL_X1 - m) if s > 0 else (-PL_X1 + m, -IX - m)
        box('h_stone', x0, x1, PL_BOT, PL_TOP - 0.01, -PL_Z1 + m, PL_Z1 - m, 'mortar', MORTAR_C, drop=('-y',))
        z0, z1 = (IZ + m, PL_Z1 - m) if s > 0 else (-PL_Z1 + m, -IZ - m)
        for (a, b) in (((-IX, -DOOR_HW - 0.005), (DOOR_HW + 0.005, IX)) if s > 0 else ((-IX, IX),)):
            box('h_stone', a, b, PL_BOT, PL_TOP - 0.01, z0, z1, 'mortar', MORTAR_C, drop=('-y',))
    # the threshold: one long slab in the doorway, a step up from the path
    stone(-DOOR_HW + 0.004, DOOR_HW - 0.004, -0.10, FL, IZ, THRESH_Z, hue((0.98, 0.96, 0.92), 0.02), drop=('-y',), jit=0.0015, bevel=0.02)
    # a flat stone under the back downpipe's shoe
    stone(-2.42, -2.1, -0.05, 0.035, -2.36, -2.02, stone_tint(), drop=('-y',), jit=0.004, bevel=0.015)


def build_floor():
    # bedding under the flags (seen in the joints), from the faceplate to the threshold
    for (xa, xb, za) in ((-IX, -CASE_HW - 0.005, PLATE_FRONT + 0.004), (-CASE_HW - 0.005, CASE_HW + 0.005, SILL_FRONT + 0.004),
                         (CASE_HW + 0.005, IX, PLATE_FRONT + 0.004)):
        box('h_stone', xa, xb, 0.02, FL - 0.016, za, IZ, 'mortar', mul(MORTAR_C, 0.7), drop=('-y',))
    rows = [0.62, 0.60, 0.66]
    z = SILL_FRONT + 0.004
    rows.append(IZ - 0.006 - z - sum(rows))
    J = 0.009
    for ri, dz in enumerate(rows):
        z1 = z + dz
        # the first row runs up to the faceplate beside the elevator's sill and casings
        if ri == 0:
            parts = [(-IX, -CASE_HW - 0.005, PLATE_FRONT + 0.004), (-CASE_HW - 0.005, CASE_HW + 0.005, z),
                     (CASE_HW + 0.005, IX, PLATE_FRONT + 0.004)]
        else:
            parts = [(-IX, IX, z)]
        for (xa, xb, zz0) in parts:
            x = xa + 0.004
            while x < xb - 0.01:
                w = rng.uniform(0.5, 0.95)
                if xb - 0.004 - (x + w) < 0.35:
                    w = xb - 0.004 - x
                flag(x + J / 2, x + w - J / 2, zz0 + J / 2, z1 - J / 2)
                x += w
        z = z1


def flag(x0, x1, z0, z1):
    if x1 - x0 < 0.05 or z1 - z0 < 0.05:
        return
    t = hue(jitter((0.92, 0.9, 0.88), 0.07), 0.03)
    bm = bm_box(x1 - x0, 0.08, z1 - z0, 0.01, 1)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    bmesh.ops.translate(bm, vec=(cx, FL - 0.04, cz), verts=bm.verts)
    tx, tz = rng.uniform(-0.003, 0.003), rng.uniform(-0.003, 0.003)
    for v in bm.verts:
        if v.co.y > FL - 0.04:
            v.co.y += tx * (v.co.x - cx) / 0.4 + tz * (v.co.z - cz) / 0.4 - 0.002
            v.co.y = min(v.co.y, FL)
        v.co.x += rng.uniform(-0.002, 0.002)
        v.co.z += rng.uniform(-0.002, 0.002)
    put('h_stone', bm, None, 'stone', t, drop=('-y',))


# ============================================================================ the timber frame (inside)
def build_frame():
    T = lambda: jitter(FRAME_C, 0.05)
    for s in (-1, 1):
        X = (IX, OX) if s > 0 else (-OX, -IX)
        # sill on the plinth and a double top plate, full length
        box('w_int', X[0], X[1], PL_TOP, SILL_Y1, -OZ, OZ, tint=T(), bevel=0.003)
        box('w_int', X[0], X[1], TP0, TP0 + 0.045, -OZ, OZ, tint=T(), bevel=0.003)
        box('w_int', X[0], X[1], TP0 + 0.045, TP, -OZ, OZ, tint=T(), bevel=0.003)
        # posts: at the plate's edge (framing it), mid-landing, and the corner
        for (z0, z1) in ((-0.17, 0.05), (0.95, 1.04), (IZ, OZ)):
            box('w_int', X[0], X[1], SILL_Y1, TP0, z0, z1, tint=T(), bevel=0.004)
        # girts between them (the boards are nailed to these)
        for (y0, y1) in GIRTS:
            for (z0, z1) in ((0.05, 0.95), (1.04, IZ)):
                box('w_int', X[0], X[1], y0, y1, z0, z1, tint=T(), bevel=0.003)
        if s > 0:
            # the window: jamb studs between the sill and head girts
            for (z0, z1) in ((WIN[0] - 0.045, WIN[0]), (WIN[1], WIN[1] + 0.045)):
                box('w_int', X[0], X[1], GIRTS[1][1], GIRTS[2][0], z0, z1, tint=T(), bevel=0.003)
    # the front wall: sill, jamb posts, girts, the door header and cripples over it, top plates
    Z = (IZ, OZ)
    for s in (-1, 1):
        a, b = (DOOR_HW, IX) if s > 0 else (-IX, -DOOR_HW)
        box('w_int', a, b, PL_TOP, SILL_Y1, Z[0], Z[1], tint=T(), bevel=0.003)
        ja, jb = (DOOR_HW, DOOR_HW + 0.09) if s > 0 else (-DOOR_HW - 0.09, -DOOR_HW)
        box('w_int', ja, jb, SILL_Y1, TP0, Z[0], Z[1], tint=T(), bevel=0.004)
        ga, gb = (DOOR_HW + 0.09, IX) if s > 0 else (-IX, -DOOR_HW - 0.09)
        for (y0, y1) in GIRTS:
            box('w_int', ga, gb, y0, y1, Z[0], Z[1], tint=T(), bevel=0.003)
    box('w_int', -DOOR_HW - 0.09, DOOR_HW + 0.09, DOOR_TOP, HEADER_TOP, Z[0], Z[1], tint=T(), bevel=0.004)
    for cx in (-0.45, 0.0, 0.45):
        box('w_int', cx - 0.0225, cx + 0.0225, HEADER_TOP, TP0, Z[0], Z[1], tint=T(), bevel=0.003)
    for (y0, y1) in ((TP0, TP0 + 0.045), (TP0 + 0.045, TP)):
        box('w_int', -IX, IX, y0, y1, Z[0], Z[1], tint=T(), bevel=0.003)
    # the front gable: studs up under the end rafter, the vent's framing
    hw, v0, v1 = VENT
    for cx in (-1.45, -0.9, -(hw + 0.0225), hw + 0.0225, 0.9, 1.45):
        x0, x1 = cx - 0.0225, cx + 0.0225
        prism('w_int', [(x0, TP), (x1, TP), (x1, yb(x1)), (x0, yb(x0))], Z[0], Z[1], 'x', tint=T(), grain=1)
    box('w_int', -hw, hw, v0 - 0.045, v0, Z[0], Z[1], tint=T(), bevel=0.003)
    box('w_int', -hw, hw, v1, v1 + 0.045, Z[0], Z[1], tint=T(), bevel=0.003)
    # the back wall (never seen from inside): its sill and top plate only
    box('w_hid', -IX, IX, PL_TOP, SILL_Y1, -OZ, -IZ, tint=T())
    box('w_hid', -IX, IX, TP0, TP, -OZ, -IZ, tint=T())
    # the tie beam across the landing, and the one over the plate (its head), cut to the roof at their ends
    for (z0, z1, h, drop) in ((TIE_Z[0], TIE_Z[1], 0.16, ()), (BEAM_Z[0], BEAM_Z[1], BEAM_H, ('-z',))):
        topl = [(x, min(TP + h, yrt(x) - 0.004)) for x in [OX - 2 * OX * i / 16 for i in range(17)]]
        prism('w_int', [(-OX, TP), (OX, TP)] + topl, z0, z1, 'x', tint=T(), grain=0, drop=drop)
    # the plate's trims: boards over its side edges and its head, against the faceplate
    for s in (-1, 1):
        a, b = (PLATE_HW - 0.055, IX) if s > 0 else (-IX, -PLATE_HW + 0.055)
        box('w_int', a, b, FL, BOLT_TOP + 0.012, PLATE_FRONT, PLATE_FRONT + 0.022, tint=T(), bevel=0.003, drop=('-z',))
    box('w_int', -IX, IX, BOLT_TOP + 0.012, TP, PLATE_FRONT, PLATE_FRONT + 0.022, tint=T(), bevel=0.003, drop=('-z',))
    # the partition above the beam: studs, boards facing the landing, blocking between the purlins up to the sheets
    ybase = TP + BEAM_H
    for cx in (-1.5, -0.95, -0.4, 0.4, 0.95, 1.5):
        x0, x1 = cx - 0.0225, cx + 0.0225
        prism('w_hid', [(x0, ybase), (x1, ybase), (x1, yrt(x1) - 0.002), (x0, yrt(x0) - 0.002)], PART_Z[0], PART_Z[1], 'x', tint=T(), grain=1)
    boards_across('w_int', PART_Z[1], PART_Z[1] + BT, 0.016, ybase, lambda x: yrt(x) - 0.002, drop=('-z',), tint=FRAME_C)
    # a cover batten over the joint under the ridge board
    box('w_int', -0.035, 0.035, ybase, yb(0.016) - 0.03, PART_Z[1] + BT, PART_Z[1] + BT + 0.018, tint=jitter(FRAME_C, 0.04), bevel=0.003, grain=1)
    blocking(PART_Z[1], PART_Z[1] + BT, 'w_int', FRAME_C, xmax=IX - 0.05)


def boards_across(obj, z0, z1, xmin, y0, top, drop=(), tint=WHITE):
    """Vertical boards in a plane z0..z1 over |x| >= xmin, from y0 up to top(|x|) (sloped), both halves."""
    for s in (-1, 1):
        x = xmin
        while True:
            w = rng.choice((0.19, 0.21, 0.23))
            x1 = x + w
            if top(x1) <= y0 + 0.02:
                xe = x
                while top(xe) > y0 + 0.01:
                    xe += 0.005
                if xe - x > 0.03:
                    board_prism(obj, s, x, xe, y0, top, z0, z1, drop, tint)
                break
            board_prism(obj, s, x, x1 - 0.004, y0, top, z0, z1, drop, tint)
            x = x1


def board_prism(obj, s, x0, x1, y0, top, z0, z1, drop, tint, kind='raw'):
    a, b = (x0, x1) if s > 0 else (-x1, -x0)
    poly = [(a, y0), (b, y0), (b, max(y0 + 0.005, top(abs(b)))), (a, max(y0 + 0.005, top(abs(a))))]
    prism(obj, poly, z0, z1, 'x', kind, jitter(tint, 0.06), grain=1, drop=drop)


def blocking(z0, z1, obj, tint, xmax=OX):
    """Short boards between the purlins, from the rafters' top up to the sheets, closing the roof space in a plane z0..z1."""
    for s in (-1, 1):
        edges = [0.016]
        for xc in PURLIN_X:
            edges += [xc - PW / 2 * COSP, xc + PW / 2 * COSP]
        edges.append(99.0)
        for i in range(0, len(edges) - 1, 2):
            xa, xb = edges[i] + 0.002, min(edges[i + 1] - 0.002, xmax)
            if xb - xa < 0.02:
                continue
            Sa, Sb = S_at(xa, RD), S_at(xb, RD)
            slope_box(obj, s, Sa, Sb, RD, D0 - 0.001, z0, z1, 'raw', jitter(tint, 0.05), grain=0)


# ============================================================================ the roof
def to_sd(poly):
    return [w2s(x, y) for (x, y) in poly]


def build_rafters():
    ridge_x = 0.016
    whole = [(ridge_x, yb(ridge_x)), (IX, TP), (OX, TP), (OX, yb(OX)), (TAIL_X, yb(TAIL_X)), (TAIL_X, yrt(TAIL_X)), (ridge_x, yrt(ridge_x))]
    inner = [(ridge_x, yb(ridge_x)), (IX, TP), (OX, TP), (OX, yrt(OX)), (ridge_x, yrt(ridge_x))]
    tail = [(OX, yb(OX)), (TAIL_X, yb(TAIL_X)), (TAIL_X, yrt(TAIL_X)), (OX, yrt(OX))]
    for zc in RAFTERS_Z:
        z0, z1 = zc - RW / 2, zc + RW / 2
        for s in (-1, 1):
            if zc < HIDDEN_Z:
                slope_prism('w_hid', s, to_sd(inner), z0, z1, tint=jitter(FRAME_C, 0.05), grain=0)
                slope_prism('w_int', s, to_sd(tail), z0, z1, tint=jitter(FRAME_C, 0.05), grain=0)
            else:
                slope_prism('w_int', s, to_sd(whole), z0, z1, tint=jitter(FRAME_C, 0.05), grain=0)
    # fly rafters beyond the gables, hung on the purlins
    fly = [(ridge_x, yb(ridge_x)), (TAIL_X, yb(TAIL_X)), (TAIL_X, yrt(TAIL_X)), (ridge_x, yrt(ridge_x))]
    for (z0, z1) in ((FLY_Z[0], FLY_Z[1]), (-FLY_Z[1], -FLY_Z[0])):
        for s in (-1, 1):
            slope_prism('w_ext', s, to_sd(fly), z0, z1, tint=jitter(TRIM_C, 0.04), grain=0)
    # the ridge board
    box('w_int', -ridge_x, ridge_x, yb(ridge_x) - 0.03, yrt(ridge_x), -FLY_Z[1], FLY_Z[1], tint=jitter(FRAME_C, 0.04), bevel=0.002)
    # purlins on the rafters, running out over the gables to carry the fly rafters
    for s in (-1, 1):
        for xc in PURLIN_X:
            Sc = S_at(xc, RD)
            inside = xc + PW < OX
            cuts = [(-FLY_Z[1], -FZ, 'w_ext'), (-FZ, HIDDEN_Z, 'w_hid' if inside else 'w_int'), (HIDDEN_Z, FZ, 'w_int'), (FZ, FLY_Z[1], 'w_ext')]
            for (za, zb, obj) in cuts:
                slope_box(obj, s, Sc - PW / 2, Sc + PW / 2, RD, D0, za, zb, 'raw', jitter(FRAME_C, 0.04), bevel=0.003, grain=2)
    # bird blocking between the rafters over the side walls
    zs = sorted(RAFTERS_Z)
    for s in (-1, 1):
        for za, zb in zip(zs[:-1], zs[1:]):
            poly = [(OX - 0.005, TP0), (FX, TP0), (FX, yrt(FX) - 0.003), (OX - 0.005, yrt(OX - 0.005) - 0.003)]
            if s < 0:
                poly = [(-x, y) for (x, y) in poly]
            prism('w_ext', poly, za + RW / 2, zb - RW / 2, 'x', tint=jitter(TRIM_C, 0.05), grain=2)
    # and between the purlins over the gable walls
    blocking(OZ, FZ, 'w_ext', TRIM_C)
    blocking(-FZ, -OZ, 'w_ext', TRIM_C)
    # the fascia on the tails; barge boards on the fly rafters, plumb-cut at the apex and the eave
    for s in (-1, 1):
        a, b = (TAIL_X, TAIL_X + TRIM_T) if s > 0 else (-TAIL_X - TRIM_T, -TAIL_X)
        box('w_ext', a, b, yb(TAIL_X) - 0.03, ypt(TAIL_X) - 0.004, -BARGE_Z[1], BARGE_Z[1], tint=jitter(TRIM_C, 0.03), bevel=0.003, grain=2)
        for (z0, z1) in ((BARGE_Z[0], BARGE_Z[1]), (-BARGE_Z[1], -BARGE_Z[0])):
            dt, db = D0 - 0.004, D0 - 0.2
            xe = TAIL_X + TRIM_T
            poly = [(S_at(0.0, dt), dt), (S_at(0.0, db), db), (S_at(xe, db), db), (S_at(xe, dt), dt)]
            slope_prism('w_ext', s, poly, z0, z1, 'raw', jitter(TRIM_C, 0.03), grain=0)


def build_sheets():
    """Corrugated sheets, eight a side, each lapping its neighbour by one wave; alternate sheets lie over the laps."""
    per = 10
    Sa = S_at(0.05, D0)
    Sb = S_at(EAVE_X, D0)
    for s in (-1, 1):
        k, i = 0, 0
        while k < NWAVE:
            sheet(s, k, min(NWAVE, k + per + 1), Sa, Sb, i)
            k += per
            i += 1
    ridge_cap()
    for s in (-1, 1):
        for zs in (-1, 1):
            barge_flashing(s, zs)


def corr(z):
    return AMP * (1 - math.cos(2 * PI * (z + RAKE_Z) / WAVE))


def sheet(side, w0, w1, Sa, Sb, idx):
    """One sheet from wave w0 to w1 (world z increasing), built in the slope frame with explicit windings."""
    lift = (idx % 2) * LIFT
    over = idx % 2 == 1
    lap_first, lap_last = w0 > 0, w1 < NWAVE
    nseg = (w1 - w0) * WSEG
    zw = [-RAKE_Z + (w0 + (w1 - w0) * j / nseg) * WAVE for j in range(nseg + 1)]      # world z
    # local Z' increasing: for the left side (Z' = -z) walk the world z backwards
    order = zw if side > 0 else list(reversed(zw))
    Zl = [z * side for z in order]
    M = slope_M(side)
    bm = bmesh.new()
    lu = bm.verts.layers.float.new('u')
    lv = bm.verts.layers.float.new('v')

    def V(S, D, Zp):
        v = bm.verts.new(M @ Vector((S, D, Zp)))
        v[lu], v[lv] = Zp * side, S
        return v
    Dt = lambda z: D0 + corr(z) + lift + TH
    Db = lambda z: D0 + corr(z) + lift
    zfirst, zlast = zw[0], zw[-1]
    for surf in ('top', 'bot'):
        Dfn = Dt if surf == 'top' else Db
        A = [V(Sa, Dfn(z), Zp) for (z, Zp) in zip(order, Zl)]
        Bq = [V(Sb, Dfn(z), Zp) for (z, Zp) in zip(order, Zl)]
        for j in range(nseg):
            zm = (order[j] + order[j + 1]) / 2
            in_first = lap_first and zm < zfirst + WAVE
            in_last = lap_last and zm > zlast - WAVE
            # in a lap the under-sheet's top and the over-sheet's bottom are never seen
            if surf == 'top' and not over and (in_first or in_last):
                continue
            if surf == 'bot' and over and (in_first or in_last):
                continue
            if surf == 'top':
                bm.faces.new((A[j], A[j + 1], Bq[j + 1], Bq[j]))
            else:
                bm.faces.new((A[j], Bq[j], Bq[j + 1], A[j + 1]))
    # the drip edge (S = Sb, facing +S); the ridge end is under the ridge cap
    for S, out in ((Sb, 1),):
        T_ = [V(S, Dt(z), Zp) for (z, Zp) in zip(order, Zl)]
        B_ = [V(S, Db(z), Zp) for (z, Zp) in zip(order, Zl)]
        for j in range(nseg):
            if out > 0:
                bm.faces.new((T_[j], T_[j + 1], B_[j + 1], B_[j]))
            else:
                bm.faces.new((T_[j], B_[j], B_[j + 1], T_[j + 1]))
    # the two side edges (facing -Z' at the first, +Z' at the last)
    for k, out in ((0, -1), (nseg, 1)):
        z, Zp = order[k], Zl[k]
        a, b, c, d = V(Sa, Db(z), Zp), V(Sb, Db(z), Zp), V(Sb, Dt(z), Zp), V(Sa, Dt(z), Zp)
        bm.faces.new((a, b, c, d) if out > 0 else (a, d, c, b))
    # (the undersides over the car stay: they show through the partition's board gaps and cast the roof's shadow)
    bm.normal_update()
    emit_uv('h_roof', bm, 'galv', jitter(GALV_C, 0.05), lambda f: [(l.vert[lu], l.vert[lv]) for l in f.loops], smooth=lambda n: True)
    # screws on every third crest over each purlin (the lap waves only through the sheet on top; the ridge cap's own
    # screws hold the top purlin's)
    for xc in PURLIN_X[1:]:
        Sc = S_at(xc, RD)
        for w in range(w0, w1):
            if (w + (1 if xc > 1.0 else 0)) % 3:
                continue
            if not over and ((lap_first and w == w0) or (lap_last and w == w1 - 1)):
                continue
            zc = -RAKE_Z + (w + 0.5) * WAVE
            p = M @ Vector((Sc, D0 + 2 * AMP + lift + TH, zc * side))
            n = M.to_3x3() @ Vector((0, 1, 0))
            screw(p, n)
            SCREWS.append((p.x, p.y, p.z, side))


def screw(p, n):
    """A hex-headed roofing screw on a neoprene washer, standing on p along n."""
    n = Vector(n).normalized()
    M = Matrix.Translation(Vector(p)) @ Vector((0, 1, 0)).rotation_difference(n).to_matrix().to_4x4() @ Matrix.Rotation(rng.uniform(0, 1.2), 4, 'Y')
    put('h_small', stud(0.0095, 0.0062, 0.0075, 6), M, 'galv', GALV_C, grain=1)
    RUST.append((p[0], p[1], p[2], tuple(n), 0.7, 0.25))


def stud(r0, r1, h, sides):
    """A small frustum standing on y = 0 (no bottom face): a screw head on its washer, a nail head."""
    bm = bmesh.new()
    lo = [bm.verts.new((math.cos(2 * PI * i / sides) * r0, 0.0, math.sin(2 * PI * i / sides) * r0)) for i in range(sides)]
    hi = [bm.verts.new((math.cos(2 * PI * i / sides) * r1, h, math.sin(2 * PI * i / sides) * r1)) for i in range(sides)]
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(list(reversed(hi)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ridge_cap():
    """A bent cap over the ridge: two legs resting on the crests and a rolled bead along the apex."""
    dcap = D0 + 2 * AMP + LIFT + TH + 0.001
    leg = 0.2
    zt = RAKE_Z + 0.015
    S0 = -dcap * TANP                    # where the leg's underside line crosses x = 0
    for s in (-1, 1):
        slope_box('h_roof', s, S0, S0 + leg, dcap, dcap + TH, -zt, zt, 'galv', jitter(GALV_C, 0.04), grain=2)
    x, y = s2w(1, S0, dcap)
    tube('h_roof', [(0.0, y + 0.004, -zt), (0.0, y + 0.004, zt)], 0.011, 10, 'galv', jitter(GALV_C, 0.04), caps=True)
    for w in range(1, NWAVE, 4):
        zc = -RAKE_Z + (w + 0.5) * WAVE
        for s in (-1, 1):
            M = slope_M(s)
            p = M @ Vector((S0 + leg * 0.62, dcap + TH, zc * s))
            screw(p, M.to_3x3() @ Vector((0, 1, 0)))


def barge_flashing(side, zs):
    """An L of galvanised sheet over the rake: along the sheets' edge and down over the barge board's face."""
    Sa = -D0 * TANP - 0.03
    Sb = S_at(EAVE_X + 0.01, D0)
    dtop = D0 + 2 * AMP + LIFT + TH + 0.0015
    zin, zout = RAKE_Z - 0.10, BARGE_Z[1] + 0.012
    if zs > 0:
        slope_box('h_roof', side, Sa, Sb, dtop, dtop + TH, zin, zout + TH, 'galv', jitter(GALV_C, 0.04), grain=0)
        slope_box('h_roof', side, Sa, Sb, D0 - 0.075, dtop + TH, zout, zout + TH, 'galv', jitter(GALV_C, 0.04), grain=0)
    else:
        slope_box('h_roof', side, Sa, Sb, dtop, dtop + TH, -zout - TH, -zin, 'galv', jitter(GALV_C, 0.04), grain=0)
        slope_box('h_roof', side, Sa, Sb, D0 - 0.075, dtop + TH, -zout - TH, -zout, 'galv', jitter(GALV_C, 0.04), grain=0)


# ============================================================================ gutters and downpipes
def gutter_line(side):
    """The gutter's centre x, its height at the outlet, and the outlet's z (it falls 1:200 toward the outlet)."""
    xc = side * (TAIL_X + TRIM_T + GUT_R + 0.008)
    y_out = ypt(EAVE_X) - 0.07
    out_z = 2.0 if side > 0 else -2.2
    return xc, y_out, out_z


def build_gutters():
    segs = 10
    for s in (-1, 1):
        xc, y0, oz = gutter_line(s)
        za, zb = -BARGE_Z[1] - 0.03, BARGE_Z[1] + 0.03
        yc = lambda z: y0 + abs(z - oz) * 0.005
        bm = bmesh.new()
        lu = bm.verts.layers.float.new('u')
        lv = bm.verts.layers.float.new('v')
        zsamp = sorted(set([za, zb, oz] + [za + (zb - za) * i / 8 for i in range(9)]))
        rings = []
        for z in zsamp:
            ring = []
            for j in range(segs + 1):
                a = PI * j / segs            # 0 at the fascia's lip, PI at the outer lip
                for rr in (GUT_R, GUT_R - 0.0012):
                    v = bm.verts.new((xc - s * rr * math.cos(a), yc(z) - rr * math.sin(a), z))
                    v[lu], v[lv] = z, a * GUT_R
                    ring.append(v)
            rings.append(ring)
        for A, Bq in zip(rings[:-1], rings[1:]):
            for j in range(segs):
                o0, i0, o1, i1 = 2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 3
                bm.faces.new((A[o0], A[o1], Bq[o1], Bq[o0]))
                bm.faces.new((A[i0], Bq[i0], Bq[i1], A[i1]))
            for e in (0, 2 * segs):
                bm.faces.new((A[e], Bq[e], Bq[e + 1], A[e + 1]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        emit_uv('h_roof', bm, 'galv', jitter(GALV_C, 0.05), lambda f: [(l.vert[lu], l.vert[lv]) for l in f.loops], smooth=lambda n: True)
        # end caps (half discs, both faces), the rolled bead along the outer lip
        for z in (za, zb):
            pts = [(xc - s * GUT_R * math.cos(PI * j / segs), yc(z) - GUT_R * math.sin(PI * j / segs), z) for j in range(segs + 1)]
            quad('h_roof', pts, (0, 0, 1 if z > 0 else -1), 'galv', GALV_C)
            quad('h_roof', pts, (0, 0, -1 if z > 0 else 1), 'galv', GALV_C)
        tube('h_roof', [(xc + s * GUT_R, yc(z), z) for z in (za, oz, zb)], 0.0055, 6, 'galv', GALV_C, caps=True)
        # hangers: a strap from the fascia round under the trough every 0.75 m
        for k in range(9):
            z = za + 0.12 + k * (zb - za - 0.24) / 8
            y = yc(z)
            pts = [(s * (TAIL_X + TRIM_T + 0.001), y + 0.012, z)]
            for j in range(0, segs + 1, 2):
                a = PI * j / segs
                pts.append((xc - s * (GUT_R + 0.004) * math.cos(a), y - (GUT_R + 0.004) * math.sin(a), z))
            pts.append((xc + s * (GUT_R + 0.004), y + 0.006, z))
            tube('h_small', pts, 0.0035, 4, 'iron', IRON_C, caps=True)
            RUST.append((s * (TAIL_X + TRIM_T + 0.002), y + 0.012, z, (s, 0, 0), 0.5, 0.15))
        # the outlet under the trough
        yb_ = yc(oz) - GUT_R
        tube('h_roof', [(xc, yb_ + 0.012, oz), (xc, yb_ - 0.05, oz)], 0.036, 10, 'galv', GALV_C, caps=False)
    build_downpipes()


def build_downpipes():
    R = 0.035
    # right: outlet, swan neck to the wall, down the side wall, and a kick out over the rain barrel
    xc, y0, oz = gutter_line(1)
    y = y0 - GUT_R - 0.05
    wx = FX + BAT_T + 0.03 + R
    bx, bz, br, bh = BARREL
    pts = [(xc, y, oz), (xc, y - 0.07, oz), (xc - 0.05, y - 0.18, oz), (wx + 0.04, y - 0.31, oz), (wx, y - 0.40, oz),
           (wx, 1.30, oz), (wx + 0.02, 1.18, oz), (bx - 0.14, 1.05, bz), (bx - 0.07, 1.0, bz)]
    tube('h_roof', pts, R, 10, 'galv', GALV_C, caps=False)
    clips(wx, oz, 1, (2.6, 1.8), R)
    # left, at the back: down to a shoe over a splash stone
    xc, y0, oz = gutter_line(-1)
    y = y0 - GUT_R - 0.05
    wx = -(FX + BAT_T + 0.03 + R)
    pts = [(xc, y, oz), (xc, y - 0.07, oz), (xc + 0.05, y - 0.18, oz), (wx - 0.04, y - 0.31, oz), (wx, y - 0.40, oz),
           (wx, 0.32, oz), (wx - 0.02, 0.22, oz), (wx - 0.1, 0.13, oz)]
    tube('h_roof', pts, R, 10, 'galv', GALV_C, caps=False)
    clips(wx, oz, -1, (2.6, 1.6, 0.7), R)
    C(FX + 0.09, 1.0, BARREL[1], 0.12, 2.0, 0.12)


def clips(wx, z, s, ys, R):
    for y in ys:
        tube('h_small', [(wx + (R + 0.004) * math.cos(a), y, z + (R + 0.004) * math.sin(a)) for a in [2 * PI * i / 10 for i in range(11)]],
             0.004, 4, 'iron', IRON_C, caps=False)
        a, b = sorted((s * FX, wx - s * R))
        box('h_small', a, b, y - 0.012, y + 0.012, z - 0.004, z + 0.004, 'iron', IRON_C)
        RUST.append((wx, y - 0.01, z, (s, 0, 0), 0.6, 0.2))


# ============================================================================ cladding
def segments(v0, v1, holes):
    """[v0, v1] minus the (h0, h1) intervals."""
    out = [(v0, v1)]
    for (h0, h1) in holes:
        nxt = []
        for (a, b) in out:
            if b <= h0 or a >= h1:
                nxt.append((a, b))
            else:
                if a < h0:
                    nxt.append((a, h0))
                if b > h1:
                    nxt.append((h1, b))
        out = nxt
    return [(a, b) for (a, b) in out if b - a > 0.01]


def fill(u0, u1):
    """Board widths filling [u0, u1]."""
    out, u = [], u0
    while u < u1 - 1e-4:
        w = rng.choice((0.19, 0.2, 0.215, 0.23, 0.245))
        if u1 - (u + w) < 0.12:
            w = u1 - u if u1 - u < 0.3 else (u1 - u) / 2
        out.append((u, u + w))
        u += w
    return out


B_BOT = PL_TOP + 0.015
SIDE_TOP = yb(FX) - 0.004
FRIEZE = (SIDE_TOP - 0.15, SIDE_TOP)
LAMP_PLATE = (0.0, 3.08)


def gtop(x):
    """The gable boards' sloped top: the end rafter's top line."""
    return yrt(abs(x)) - 0.003


def build_cladding():
    gap = 0.004
    # ---------------------------------------------------------------- side walls (boards along y, spread over z)
    for s in (-1, 1):
        X0, X1 = (OX, FX) if s > 0 else (-FX, -OX)
        holes = [(WIN[0], WIN[1], WIN[2], WIN[3])] if s > 0 else []
        cuts = sorted(set([-FZ, FZ] + ([WIN[0], WIN[1]] if s > 0 else [])))
        joints = []
        for (a, b) in zip(cuts[:-1], cuts[1:]):
            for (u0, u1) in fill(a, b):
                joints.append(u1)
                vr = [(h[2], h[3]) for h in holes if h[0] < (u0 + u1) / 2 < h[1]]
                for (y0, y1) in segments(B_BOT, SIDE_TOP, vr):
                    drop = (('-x',) if s > 0 else ('+x',)) if u1 < -0.17 else ()
                    box('w_ext', X0, X1, y0, y1, u0 + gap / 2, u1 - gap / 2, 'raw', jitter(WHITE, 0.07), drop=drop, grain=1)
        # battens over the joints (not under the corner boards, the window's casing or the frieze)
        B0, B1 = (FX, FX + BAT_T) if s > 0 else (-FX - BAT_T, -FX)
        for u in joints[:-1]:
            if abs(u) > FZ - 0.13:
                continue
            blocks = [(FRIEZE[0], 9.0)]
            if s > 0 and WIN[0] - 0.11 < u < WIN[1] + 0.11:
                blocks.append((WIN[2] - 0.08, WIN[3] + 0.12))
            for (y0, y1) in segments(B_BOT, FRIEZE[0], blocks):
                box('w_ext', B0, B1, y0, y1, u - BAT_W / 2, u + BAT_W / 2, 'raw', jitter(WHITE, 0.06), bevel=0.003, grain=1)
                nails(s, 'x', B1 if s > 0 else B0, y0, y1, u)
        # the frieze board under the eaves, and the flashing along the boards' foot
        F0, F1 = (FX, FX + TRIM_T) if s > 0 else (-FX - TRIM_T, -FX)
        box('w_ext', F0, F1, FRIEZE[0], FRIEZE[1], -FZ + 0.11, FZ - 0.11, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=2)
        drip(s, 'x')
    # ---------------------------------------------------------------- end walls (boards spread over x, sloped tops)
    hw, v0, v1 = VENT
    for zz in (1, -1):
        Z0, Z1 = (OZ, FZ) if zz > 0 else (-FZ, -OZ)
        holes = [(-hw, hw, v0, v1)]
        if zz > 0:
            holes.append((-DOOR_HW, DOOR_HW, -1.0, DOOR_TOP))
        cuts = sorted(set([-OX, OX, -hw, hw] + ([-DOOR_HW, DOOR_HW] if zz > 0 else [])))
        joints = []
        for (a, b) in zip(cuts[:-1], cuts[1:]):
            for (u0, u1) in fill(a, b):
                joints.append(u1)
                vr = [(h[2], h[3]) for h in holes if h[0] < (u0 + u1) / 2 < h[1]]
                xa, xb = u0 + gap / 2, u1 - gap / 2
                for (y0, y1) in segments(B_BOT, 9.0, vr):
                    if y1 > 8.0:
                        poly = [(xa, y0), (xb, y0), (xb, gtop(xb))] + ([(0.0, gtop(0.0))] if xa < 0 < xb else []) + [(xa, gtop(xa))]
                    else:
                        poly = [(xa, y0), (xb, y0), (xb, y1), (xa, y1)]
                    prism('w_ext', poly, Z0, Z1, 'x', 'raw', jitter(WHITE, 0.07), grain=1, drop=('+z',) if zz < 0 else ())
        B0, B1 = (FZ, FZ + BAT_T) if zz > 0 else (-FZ - BAT_T, -FZ)
        for u in joints[:-1]:
            if abs(u) > OX - 0.13:
                continue
            blocks = []
            if abs(u) < hw + 0.11:
                blocks.append((v0 - 0.1, v1 + 0.1))
            if zz > 0 and abs(u) < DOOR_HW + 0.15:
                blocks.append((-1.0, HEADER_TOP + 0.06))
            if zz > 0 and abs(u - LAMP_PLATE[0]) < 0.16:
                blocks.append((LAMP_PLATE[1] - 0.12, LAMP_PLATE[1] + 0.12))
            for (y0, y1) in segments(B_BOT, 9.0, blocks):
                xa, xb = u - BAT_W / 2, u + BAT_W / 2
                if y1 > 8.0:
                    poly = [(xa, y0), (xb, y0), (xb, gtop(xb) - 0.004), (xa, gtop(xa) - 0.004)]
                    y1 = gtop(u)
                else:
                    poly = [(xa, y0), (xb, y0), (xb, y1), (xa, y1)]
                if y1 - y0 < 0.05:
                    continue
                prism('w_ext', poly, B0, B1, 'x', 'raw', jitter(WHITE, 0.06), grain=1)
                nails(zz, 'z', B1 if zz > 0 else B0, y0, y1, u)
        drip(zz, 'z')
    # a wooden pattress for the lamp's plate
    box('w_ext', -0.12, 0.12, LAMP_PLATE[1] - 0.11, LAMP_PLATE[1] + 0.11, FZ, FZ + BAT_T, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=1)
    # ---------------------------------------------------------------- corner boards
    for s in (-1, 1):
        for zz in (-1, 1):
            # on the end wall's face (covering the side boards' ends), up to the rake; and on the side wall's face
            xa, xb = (FX - 0.125, FX + TRIM_T) if s > 0 else (-FX - TRIM_T, -FX + 0.125)
            za, zb = (FZ, FZ + TRIM_T) if zz > 0 else (-FZ - TRIM_T, -FZ)
            prism('w_ext', [(xa, B_BOT), (xb, B_BOT), (xb, gtop(xb)), (xa, gtop(xa))], za, zb, 'x', 'raw', jitter(TRIM_C, 0.04), grain=1)
            xa, xb = (FX, FX + TRIM_T) if s > 0 else (-FX - TRIM_T, -FX)
            za, zb = (FZ - 0.11, FZ) if zz > 0 else (-FZ, -FZ + 0.11)
            box('w_ext', xa, xb, B_BOT, SIDE_TOP, za, zb, 'raw', jitter(TRIM_C, 0.04), grain=1)


def nails(sgn, axis, face, y0, y1, u):
    """Square nail heads up a batten, one at every girt."""
    for (g0, g1) in GIRTS:
        y = (g0 + g1) / 2 + rng.uniform(-0.01, 0.01)
        if not (y0 + 0.03 < y < y1 - 0.03):
            continue
        uu = u + rng.uniform(-0.006, 0.006)
        if axis == 'x':
            p, n = (face + sgn * 0.0012, y, uu), (sgn, 0, 0)
        else:
            p, n = (uu, y, face + sgn * 0.0012), (0, 0, sgn)
        M = Matrix.Translation(Vector(p)) @ Vector((0, 1, 0)).rotation_difference(Vector(n)).to_matrix().to_4x4() @ Matrix.Rotation(rng.uniform(0, 1.5), 4, 'Y')
        put('h_small', stud(0.0048, 0.004, 0.0025, 4), M, 'iron', mul(IRON_C, rng.uniform(0.8, 1.3)), grain=1)


def drip(s, axis):
    """Galvanised drip flashing along the boards' foot, over the plinth's top, as a thin bent strip."""
    y0 = PL_TOP + 0.022
    path = [(-0.012, y0 + 0.03), (0.0, y0), (0.058, y0 - 0.022), (0.058, y0 - 0.042)]
    under = [(d - 0.0012, y - 0.0012) for (d, y) in path]
    poly = path + list(reversed(under))
    if axis == 'x':
        spans = [(-FZ - 0.03, FZ + 0.03)]
        pp = [(s * (FX + d), y) for (d, y) in poly]
        for (a, b) in spans:
            prism('h_roof', pp, a, b, 'x', 'galv', mul(GALV_C, 0.9), grain=2)
    else:
        spans = [(-FX - 0.03, -DOOR_HW - 0.12), (DOOR_HW + 0.12, FX + 0.03)] if s > 0 else [(-FX - 0.03, FX + 0.03)]
        pp = [(s * (FZ + d), y) for (d, y) in poly]
        for (a, b) in spans:
            prism('h_roof', pp, a, b, 'z', 'galv', mul(GALV_C, 0.9), grain=0)


# ============================================================================ doorway, doors, window, vents
LEAF_W, LEAF_Y0, LEAF_Y1 = 0.80, FL + 0.03, DOOR_TOP - 0.03
HINGE_Z = FZ + TRIM_T + 0.028
OPEN = math.radians(168)


def build_doorway():
    Zc0, Zc1 = FZ, FZ + TRIM_T
    # the door frame lining the opening, standing on the threshold
    for s in (-1, 1):
        a, b = (DOOR_HW - LINE_T, DOOR_HW) if s > 0 else (-DOOR_HW, -DOOR_HW + LINE_T)
        box('w_ext', a, b, FL, DOOR_TOP - LINE_T, IZ, Zc1, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=1)
    box('w_ext', -DOOR_HW, DOOR_HW, DOOR_TOP - LINE_T, DOOR_TOP, IZ, Zc1, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=0)
    # casings, the head casing, and a drip cap with its flashing
    for s in (-1, 1):
        a, b = (DOOR_HW, DOOR_HW + 0.12) if s > 0 else (-DOOR_HW - 0.12, -DOOR_HW)
        box('w_ext', a, b, PL_TOP + 0.01, DOOR_TOP, Zc0, Zc1, 'raw', jitter(TRIM_C, 0.03), bevel=0.004, grain=1)
    box('w_ext', -DOOR_HW - 0.12, DOOR_HW + 0.12, DOOR_TOP, DOOR_TOP + 0.14, Zc0, Zc1, 'raw', jitter(TRIM_C, 0.03), bevel=0.004, grain=0)
    yc = DOOR_TOP + 0.14
    prism('w_ext', [(FZ, yc), (Zc1 + 0.045, yc), (Zc1 + 0.045, yc + 0.012), (FZ, yc + 0.035)], -DOOR_HW - 0.15, DOOR_HW + 0.15, 'z',
          'raw', jitter(TRIM_C, 0.03), grain=2)
    prism('h_roof', [(FZ, yc + 0.035), (FZ, yc + 0.07), (FZ + 0.0012, yc + 0.07), (FZ + 0.0012, yc + 0.0362), (Zc1 + 0.0462, yc + 0.0132),
                     (Zc1 + 0.0462, yc - 0.004), (Zc1 + 0.045, yc - 0.004), (Zc1 + 0.045, yc + 0.012)], -DOOR_HW - 0.155, DOOR_HW + 0.155, 'z',
          'galv', GALV_C, grain=2)
    # the doors: two ledged-and-braced leaves hooked open against the wall
    for s in (-1, 1):
        door_leaf(s)
    # a staple on the right casing with an open padlock hanging from it
    sx, sy, sz = DOOR_HW + 0.07, 1.18, Zc1
    box('h_small', sx - 0.03, sx + 0.006, sy - 0.035, sy + 0.035, sz, sz + 0.003, 'iron', IRON_C)
    tube('h_small', [(sx - 0.012, sy - 0.02, sz), (sx - 0.012, sy - 0.02, sz + 0.02), (sx - 0.012, sy + 0.02, sz + 0.02), (sx - 0.012, sy + 0.02, sz)],
         0.004, 5, 'iron', IRON_C)
    lx, ly, lz = sx - 0.012, sy - 0.075, sz + 0.02
    box('h_small', lx - 0.022, lx + 0.022, ly - 0.028, ly + 0.024, lz - 0.009, lz + 0.009, 'brass', BRASS_C, bevel=0.004)
    tube('h_small', [(lx - 0.012, ly + 0.02, lz), (lx - 0.012, ly + 0.05, lz), (lx - 0.004, sy - 0.018, sz + 0.02),
                     (lx + 0.012, ly + 0.052, lz + 0.004), (lx + 0.012, ly + 0.03, lz + 0.004)], 0.0035, 5, 'iron', mul(IRON_C, 1.6))
    RUST.append((sx - 0.012, sy - 0.035, sz, (0, 0, 1), 0.8, 0.3))
    # the threshold step's collision
    C(0.0, (FL - 0.3) / 2, (IZ + THRESH_Z) / 2, 2 * DOOR_HW, FL + 0.3, THRESH_Z - IZ)


def door_leaf(s):
    """A leaf built closed in the doorway (boards at the front), then swung open about its hinge line to lie back
    against the wall, its ledges and braces facing out."""
    hx = s * (DOOR_HW + 0.03)
    Mh = Matrix.Translation((hx, 0, HINGE_Z)) @ Matrix.Rotation(s * OPEN, 4, 'Y') @ Matrix.Translation((-hx, 0, -HINGE_Z))
    x_edge = hx - s * LEAF_W
    nb = 6
    bw = LEAF_W / nb
    zf0, zf1 = HINGE_Z - 0.022, HINGE_Z
    tint = jitter(TEAL, 0.03)
    for k in range(nb):
        a, b = hx - s * (k * bw + 0.002), hx - s * ((k + 1) * bw - 0.002)
        box('w_ext', min(a, b), max(a, b), LEAF_Y0, LEAF_Y1, zf0, zf1, 'paint', jitter(tint, 0.03), bevel=0.003, grain=1, M=Mh)
    # ledges and braces on the back
    zl0, zl1 = zf0 - 0.026, zf0
    x_in, x_h = hx - s * (LEAF_W - 0.03), hx - s * 0.03
    ledges = [LEAF_Y0 + 0.2, (LEAF_Y0 + LEAF_Y1) / 2, LEAF_Y1 - 0.2]
    for y in ledges:
        box('w_ext', min(x_in, x_h), max(x_in, x_h), y - 0.07, y + 0.07, zl0, zl1, 'paint', jitter(tint, 0.03), bevel=0.004, grain=0, M=Mh)
    for (ya, yb2) in ((ledges[0] + 0.07, ledges[1] - 0.07), (ledges[1] + 0.07, ledges[2] - 0.07)):
        # from low on the hinge side up to high on the latch side
        p0 = Vector((x_h - s * 0.06, ya + 0.02, (zl0 + zl1) / 2))
        p1 = Vector((x_in + s * 0.06, yb2 - 0.02, (zl0 + zl1) / 2))
        d = p1 - p0
        bm = bm_box(d.length, 0.11, zl1 - zl0, 0.004, 1)
        M = Mh @ Matrix.Translation((p0 + p1) / 2) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, 'Z')
        put('w_ext', bm, M, 'paint', jitter(tint, 0.03), grain=0)
    # strap hinges on the front (they end up against the wall), their knuckles and the pintle plates on the casing
    for y in (ledges[0], ledges[2]):
        box('h_small', min(hx, hx - s * 0.5), max(hx, hx - s * 0.5), y - 0.02, y + 0.02, zf1, zf1 + 0.004, 'iron', IRON_C, M=Mh)
        tube('h_small', [(hx, y - 0.045, HINGE_Z), (hx, y + 0.045, HINGE_Z)], 0.011, 8, 'iron', IRON_C)
        a, b = sorted((hx, s * (DOOR_HW + 0.10)))
        box('h_small', a, b, y - 0.055, y - 0.02, FZ + TRIM_T, FZ + TRIM_T + 0.006, 'iron', IRON_C)
        RUST.append((hx, y - 0.055, FZ + TRIM_T + 0.006, (0, 0, 1), 0.9, 0.35))
    # a hook from an eye in the wall to the leaf's wall-side face near its free edge
    tip = Mh @ Vector((x_edge + s * 0.06, 1.2, zf1))
    eye = Vector((s * (DOOR_HW + 0.60), 1.2, FZ + BAT_T + 0.004))
    tube('h_small', [eye, eye + (tip - eye) * 0.5 + Vector((0, 0.012, 0)), tip], 0.004, 5, 'iron', IRON_C)
    RUST.append((eye.x, eye.y, eye.z, (0, 0, 1), 0.6, 0.25))
    # the open leaf's collision
    c = Mh @ Vector(((hx + x_edge) / 2, (LEAF_Y0 + LEAF_Y1) / 2, (zl0 + zf1) / 2))
    C(c.x, c.y, c.z, LEAF_W, LEAF_Y1 - LEAF_Y0, 0.06, s * OPEN)


def build_window():
    z0, z1, y0, y1 = WIN
    xin, xout = IX, FX + 0.02
    fw = 0.045
    t = jitter(TEAL, 0.02)
    # the frame: jambs, head, and a sill sloping out with a nose
    box('w_ext', xin, xout, y0, y1, z0, z0 + fw, 'paint', t, bevel=0.003, grain=1)
    box('w_ext', xin, xout, y0, y1, z1 - fw, z1, 'paint', t, bevel=0.003, grain=1)
    box('w_ext', xin, xout, y1 - fw, y1, z0 + fw, z1 - fw, 'paint', t, bevel=0.003, grain=2)
    prism('w_ext', [(xin, y0), (xout + 0.05, y0 - 0.012), (xout + 0.05, y0 + 0.012), (xout, y0 + 0.042), (xin, y0 + 0.045)],
          z0 - 0.05, z1 + 0.05, 'x', 'paint', t, grain=2)
    # the sash: stiles, rails and a cross of muntins, glass between
    sx0, sx1 = FX - 0.03, FX + 0.005
    st = 0.042
    Z0, Z1, Y0, Y1 = z0 + fw, z1 - fw, y0 + 0.045, y1 - fw
    ts = jitter(TEAL_SASH, 0.02)
    box('w_ext', sx0, sx1, Y0, Y1, Z0, Z0 + st, 'paint', ts, bevel=0.003, grain=1)
    box('w_ext', sx0, sx1, Y0, Y1, Z1 - st, Z1, 'paint', ts, bevel=0.003, grain=1)
    box('w_ext', sx0, sx1, Y0, Y0 + 0.055, Z0 + st, Z1 - st, 'paint', ts, bevel=0.003, grain=2)
    box('w_ext', sx0, sx1, Y1 - st, Y1, Z0 + st, Z1 - st, 'paint', ts, bevel=0.003, grain=2)
    zm, ym = (Z0 + Z1) / 2, (Y0 + 0.055 + Y1 - st) / 2
    box('w_ext', sx0 + 0.004, sx1 - 0.004, Y0 + 0.055, Y1 - st, zm - 0.011, zm + 0.011, 'paint', ts, bevel=0.002, grain=1)
    box('w_ext', sx0 + 0.004, sx1 - 0.004, ym - 0.011, ym + 0.011, Z0 + st, Z1 - st, 'paint', ts, bevel=0.002, grain=2)
    gx = (sx0 + sx1) / 2
    for (za, zb) in ((Z0 + st, zm - 0.011), (zm + 0.011, Z1 - st)):
        for (ya, yb2) in ((Y0 + 0.055, ym - 0.011), (ym + 0.011, Y1 - st)):
            quad('h_small', [(gx + 0.0015, ya, za), (gx + 0.0015, ya, zb), (gx + 0.0015, yb2, zb), (gx + 0.0015, yb2, za)], (1, 0, 0), 'glass', GLASS_C)
            quad('h_small', [(gx - 0.0015, ya, za), (gx - 0.0015, ya, zb), (gx - 0.0015, yb2, zb), (gx - 0.0015, yb2, za)], (-1, 0, 0), 'glass_in', GLASS_C)
    # casing outside with a drip cap on its head, an apron under the sill; a stool inside
    c0, c1 = FX, FX + TRIM_T
    for (za, zb) in ((z0 - 0.08, z0), (z1, z1 + 0.08)):
        box('w_ext', c0, c1, y0, y1 + 0.08, za, zb, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=1)
    box('w_ext', c0, c1, y1, y1 + 0.08, z0, z1, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=2)
    prism('w_ext', [(FX, y1 + 0.08), (c1 + 0.04, y1 + 0.08), (c1 + 0.04, y1 + 0.092), (FX, y1 + 0.112)], z0 - 0.1, z1 + 0.1, 'x', 'raw',
          jitter(TRIM_C, 0.03), grain=2)
    box('w_ext', c0, c1, y0 - 0.07, y0 - 0.012, z0 - 0.06, z1 + 0.06, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=2)
    box('w_int', IX - 0.05, IX, y0, y0 + 0.022, z0 - 0.06, z1 + 0.06, 'raw', jitter(FRAME_C, 0.03), bevel=0.003, grain=2)


def build_vents():
    hw, v0, v1 = VENT
    for zz in (1, -1):
        cz0, cz1 = (FZ, FZ + TRIM_T) if zz > 0 else (-FZ - TRIM_T, -FZ)
        for (xa, xb) in ((-hw - 0.075, -hw), (hw, hw + 0.075)):
            box('w_ext', xa, xb, v0 - 0.075, v1 + 0.075, cz0, cz1, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=1)
        box('w_ext', -hw, hw, v0 - 0.075, v0, cz0, cz1, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=0)
        box('w_ext', -hw, hw, v1, v1 + 0.075, cz0, cz1, 'raw', jitter(TRIM_C, 0.03), bevel=0.003, grain=0)
        li0, li1 = (IZ, FZ) if zz > 0 else (-FZ, -IZ)
        for (xa, xb) in ((-hw, -hw + 0.02), (hw - 0.02, hw)):
            box('w_ext', xa, xb, v0, v1, li0, li1, 'raw', jitter(TRIM_C, 0.03), grain=1)
        box('w_ext', -hw + 0.02, hw - 0.02, v0, v0 + 0.02, li0, li1, 'raw', jitter(TRIM_C, 0.03), grain=0)
        # louvres sloping down and out
        n = 6
        for k in range(n):
            yc = v0 + 0.05 + (v1 - v0 - 0.1) * k / (n - 1)
            M = Matrix.Translation((0, yc, zz * (IZ + FZ) / 2)) @ Matrix.Rotation(zz * math.radians(40), 4, 'X')
            put('w_ext', bm_box(2 * hw - 0.04, 0.012, 0.095, 0.002, 1), M, 'raw', jitter(TRIM_C, 0.04), grain=0)


# ============================================================================ lamps, conduit, fittings
def shade_profile(r, h):
    """An RLM shade: a shallow dome from the rim (y = 0) up to its neck (y = h)."""
    pts = []
    for i in range(8):
        t = i / 7
        pts.append((0.02 + (r - 0.02) * math.sin(t * PI / 2) ** 0.9, h * (1 - t) ** 1.6))
    return list(reversed(pts))


def bulb(c, r):
    prof = [(0.001, -r), (r * 0.6, -r * 0.85), (r * 0.95, -r * 0.4), (r, 0.0), (r * 0.8, r * 0.6), (r * 0.45, r * 1.0), (r * 0.4, r * 1.3)]
    lathe('h_small', prof, c, 12, 'glow', GLOW_C)


def shade(c, r, h, segs):
    prof = shade_profile(r, h)
    lathe('h_small', prof, c, segs, 'enamel', ENAMEL_OUT)
    lathe('h_small', [(rr - 0.0015, y - 0.0015) for (rr, y) in prof], c, segs, 'enamel', ENAMEL_IN, inward=True)
    lathe('h_small', [(r + 0.005, -0.006), (r + 0.005, 0.002), (r - 0.003, 0.004)], c, segs, 'enamel', ENAMEL_OUT)


def build_lamps():
    # outside: a gooseneck over the door, on a round plate on its pattress
    px, py, pz = LAMP_PLATE[0], LAMP_PLATE[1], FZ + BAT_T
    lathe('h_small', [(0.07, 0.0), (0.07, 0.012), (0.055, 0.022), (0.02, 0.026)], (0, 0, 0), 16, 'enamel', ENAMEL_OUT,
          M=Matrix.Translation((px, py, pz)) @ Matrix.Rotation(PI / 2, 4, 'X'))
    rc = 0.19
    cz, cy = pz + 0.12, py - rc
    arc = [(px, py, pz + 0.02), (px, py, cz)] + [(px, cy + rc * math.cos(PI / 2 * i / 8), cz + rc * math.sin(PI / 2 * i / 8)) for i in range(1, 9)]
    arc.append((px, cy - 0.02, cz + rc))
    tube('h_small', arc, 0.013, 8, 'enamel', ENAMEL_OUT)
    top_y, sz_ = cy - 0.02, cz + rc
    sh = 0.13
    shade((px, top_y - sh - 0.01, sz_), 0.17, sh, 24)
    lathe('h_small', [(0.02, 0.0), (0.02, 0.05), (0.016, 0.06)], (px, top_y - 0.075, sz_), 12, 'iron', IRON_C)
    bulb((px, top_y - 0.11, sz_), 0.034)
    empty('LAMP_OUT', (px, top_y - 0.11, sz_))
    RUST.append((px, py - 0.07, pz + 0.01, (0, 0, 1), 0.8, 0.5))
    # its conduit sideways into a box, and through the wall
    tube('h_small', [(px + 0.06, py, pz + 0.012), (0.42, py, pz + 0.012)], 0.011, 6, 'galv', GALV_C)
    box('h_small', 0.42, 0.52, py - 0.05, py + 0.05, pz, pz + 0.05, 'galv', GALV_C, bevel=0.004)
    # inside: a pendant under the tie beam on a cloth cord
    zt = (TIE_Z[0] + TIE_Z[1]) / 2
    ys = 2.93
    lathe('h_small', [(0.045, 0.0), (0.045, 0.006), (0.03, 0.02), (0.01, 0.024)], (0, TP - 0.024, zt), 12, 'enamel', ENAMEL_IN, inward=True)
    tube('h_small', [(0, TP - 0.02, zt), (0, ys + 0.13, zt)], 0.0035, 5, 'rubber', srgb(40, 34, 28))
    shade((0, ys + 0.03, zt), 0.12, 0.09, 20)
    lathe('h_small', [(0.017, 0.0), (0.017, 0.04)], (0, ys + 0.08, zt), 10, 'iron', IRON_C)
    bulb((0, ys + 0.05, zt), 0.03)
    empty('LAMP_IN', (0, ys + 0.05, zt))
    # conduit from the beam along the right wall's top plate and down to a switch by the door
    cz_ = TIE_Z[1] + 0.012
    tube('h_small', [(0.05, TP + 0.02, cz_), (IX - 0.03, TP + 0.02, cz_), (IX - 0.012, TP - 0.03, cz_ + 0.02),
                     (IX - 0.012, TP - 0.05, cz_ + 0.1), (IX - 0.012, TP - 0.05, 2.34), (IX - 0.012, 1.46, 2.34)], 0.01, 6, 'galv', GALV_C)
    box('h_small', IX - 0.06, IX, 1.30, 1.46, 2.29, 2.39, 'galv', GALV_C, bevel=0.005)
    box('h_small', IX - 0.068, IX - 0.06, 1.35, 1.40, 2.33, 2.35, 'iron', IRON_C)


# ============================================================================ the rain barrel, the bench
def build_barrel():
    x, z, r, h = BARREL
    rad = lambda t: r * (0.9 + 0.1 * math.sin(PI * t))
    prof = [(rad(t), h * t) for t in [i / 8 for i in range(9)]]
    lathe('w_ext', prof, (x, 0.0, z), 20, 'raw', mul(jitter(WHITE, 0.03), 0.8))
    lathe('w_ext', [(prof[-1][0], h), (prof[-1][0] - 0.02, h)], (x, 0.0, z), 20, 'raw', mul(WHITE, 0.8))
    lathe('w_ext', [(rr - 0.02, y) for (rr, y) in prof[5:]], (x, 0.0, z), 20, 'raw', mul(WHITE, 0.55), inward=True)
    wr = rad(0.9) - 0.02
    pts = [(x + math.cos(2 * PI * i / 20) * wr, h - 0.07, z + math.sin(2 * PI * i / 20) * wr) for i in range(20)]
    quad('h_small', pts, (0, 1, 0), 'water', srgb(20, 24, 22))
    for t in (0.12, 0.5, 0.88):
        rr = rad(t) + 0.003
        lathe('h_small', [(rr, h * t - 0.022), (rr, h * t + 0.022)], (x, 0.0, z), 20, 'iron', IRON_C)
    C(x, h / 2, z, 2 * r, h, 2 * r)


def build_bench():
    x0, x1 = -IX, -IX + 0.36
    z0, z1 = 0.62, 2.02
    ys = FL + 0.44
    t = lambda: jitter(FRAME_C, 0.05)
    for (a, b) in ((x0 + 0.01, x0 + 0.18), (x0 + 0.19, x1)):
        box('w_int', a, b, ys - 0.035, ys, z0, z1, 'raw', t(), bevel=0.004, grain=2)
    for zc in (z0 + 0.1, z1 - 0.1):
        for xc in (x0 + 0.06, x1 - 0.05):
            box('w_int', xc - 0.025, xc + 0.025, FL, ys - 0.035, zc - 0.025, zc + 0.025, 'raw', t(), bevel=0.003, grain=1)
        box('w_int', x0 + 0.03, x1 - 0.02, FL + 0.12, FL + 0.17, zc - 0.018, zc + 0.018, 'raw', t(), bevel=0.003, grain=0)
    box('w_int', x0 + 0.05, x0 + 0.08, FL + 0.12, FL + 0.17, z0 + 0.1, z1 - 0.1, 'raw', t(), bevel=0.003, grain=2)
    C((x0 + x1) / 2, (FL + ys) / 2, (z0 + z1) / 2, x1 - x0, ys - FL, z1 - z0)
    # a coil of rope on it
    cx, cz = x0 + 0.19, z0 + 0.36
    for k in range(4):
        M = Matrix.Translation((cx, ys + 0.012 + k * 0.021, cz)) @ Matrix.Rotation(rng.uniform(0, PI), 4, 'Y')
        put('w_int', bm_torus(0.11 - k * 0.004, 0.012, 20, 6), M, 'raw', jitter(ROPE_C, 0.04), grain=0, smooth=lambda n: True)


# ============================================================================ collision and meta
def build_colliders():
    # the landing's floor
    C(0.0, (FL - 0.3) / 2, (PLATE_FRONT + IZ) / 2, 2 * IX, FL + 0.3, IZ - PLATE_FRONT)
    H = TP + 0.1
    # walls with the plinth: the side walls, the back, the front either side of the door and over it
    for s in (-1, 1):
        C(s * (IX + PL_X1) / 2, (H - 0.3) / 2, 0.0, PL_X1 - IX, H + 0.3, 2 * PL_Z1)
        C(s * (DOOR_HW + PL_X1) / 2, (H - 0.3) / 2, (IZ + PL_Z1) / 2, PL_X1 - DOOR_HW, H + 0.3, PL_Z1 - IZ)
    C(0.0, (H - 0.3) / 2, -(IZ + PL_Z1) / 2, 2 * PL_X1, H + 0.3, PL_Z1 - IZ)
    C(0.0, (DOOR_TOP + H) / 2, (IZ + PL_Z1) / 2, 2 * DOOR_HW, H - DOOR_TOP, PL_Z1 - IZ)


def build_meta():
    empty('META', (0, 0, 0), ix=IX, iz=IZ, fx=FX, fz=FZ, floor=FL, tp=TP, pitch=math.degrees(PITCH), door_hw=DOOR_HW - LINE_T,
          door_top=DOOR_TOP - LINE_T, plinth=[PL_X1, PL_Z1, PL_TOP], threshold=THRESH_Z, ridge=ypt(0) + 2 * AMP,
          barrel=[BARREL[0], BARREL[1], BARREL[2] + 0.03])
    empty('PLATE', EROOT)
    empty('DOOR', (0.0, FL, FZ + TRIM_T))


# ============================================================================ build
def build_all():
    t0 = time.time()
    RUST.clear()
    SCREWS.clear()
    rng.seed(1987)
    build_plinth()
    build_floor()
    build_frame()
    build_rafters()
    build_sheets()
    build_gutters()
    build_cladding()
    build_doorway()
    build_window()
    build_vents()
    build_lamps()
    build_barrel()
    build_bench()
    build_colliders()
    build_meta()
    stats = realize()
    n_ref = import_reference()
    show_scene()
    tris = {}
    for ob in _scene().objects:
        if ob.type == 'MESH' and not ob.get('noexport') and ob.name != 'COLLIDER':
            tris[ob.name] = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return {'faces': stats, 'tris': tris, 'total_tris': sum(tris.values()), 'rust': len(RUST), 'screws': len(SCREWS),
            'ref_objects': n_ref, 'seconds': round(time.time() - t0, 1)}


def import_reference():
    """The elevator end where the game puts it: an occluder for the bakes and a check on the fit, never exported."""
    for me in list(bpy.data.meshes):
        if me.get('shed_ref') and me.users == 0:
            bpy.data.meshes.remove(me)
    for m in list(bpy.data.materials):
        if m.name.startswith('elev_') and m.users == 0:
            bpy.data.materials.remove(m)
    sc = _scene()
    kw = _override(sc)
    before = set(bpy.data.objects)
    try:
        with bpy.context.temp_override(**kw):
            bpy.ops.import_scene.gltf(filepath=MODELS + 'elevator.glb')
    except Exception as ex:
        print('elevator reference skipped:', ex)
        return 0
    new = [o for o in bpy.data.objects if o not in before]
    off = g2b(EROOT)
    for o in new:
        o['noexport'] = 1
        o['bake'] = 0
        o['shed_ref'] = 1
        if o.name not in sc.objects:
            sc.collection.objects.link(o)
        if o.parent is None:
            o.location = o.location + off
        if o.type == 'MESH':
            o.data['shed_ref'] = 1
    return len(new)


# ============================================================================ detail tiles (Blender procedural shaders)
def _n4(nt, vec, w, scale, detail=4.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '4D'}, Vector=vec, W=w, Scale=scale, Detail=detail,
                Roughness=rough, Distortion=distort).outputs['Fac']


def _vor4(nt, vec, w, scale, feature='F1', rnd=1.0):
    return node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '4D', 'feature': feature}, Vector=vec, W=w, Scale=scale,
                Randomness=rnd)


def _st(nt, vec, w, ku, kv):
    """Stretch the tile's 4D circle coordinates: ku < 1 makes features long along u."""
    v = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=vec, i1=(ku, ku, kv)).outputs[0]
    return v, math_node(nt, 'MULTIPLY', w, kv)


def _mr(nt, v, a, b, lo=0.0, hi=1.0):
    return node(nt, 'ShaderNodeMapRange', props={'clamp': True}, Value=v, **{'From Min': a, 'From Max': b, 'To Min': lo, 'To Max': hi}).outputs[0]


def _mx(nt, fac, a, b):
    m = node(nt, 'ShaderNodeMix', props={'data_type': 'RGBA', 'blend_type': 'MIX'})
    for sock, v in ((0, fac), (6, a), (7, b)):
        if hasattr(v, 'is_output'):
            nt.links.new(v, m.inputs[sock])
        elif isinstance(v, (int, float)):
            m.inputs[sock].default_value = v
        else:
            m.inputs[sock].default_value = (v[0], v[1], v[2], 1.0)
    return m.outputs[2]


def _rp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(fac, r.inputs['Fac'])
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for (pos, col) in stops[1:-1]:
        e = els.new(pos)
        e.color = (*col, 1)
    return r.outputs['Color']


def _m(nt, op, a, b=None):
    return math_node(nt, op, a, b)


def _gray(nt, v):
    return node(nt, 'ShaderNodeCombineColor', Red=v, Green=v, Blue=v).outputs[0]


def _uvu(nt):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    return node(nt, 'ShaderNodeSeparateXYZ', Vector=tc.outputs['UV']).outputs['X']


def wood_fields(nt, vec, w):
    """Rough-sawn, weathered boards, the grain along u: grain lines, fibre streaks, silvering, blotches, checks, knots
    (and the grain's dark halo round them), saw marks across the grain."""
    gv, gw = _st(nt, vec, w, 0.035, 1.0)
    base = _n4(nt, gv, gw, 2.6, 3.0, 0.5, 0.25)
    lines = _mr(nt, _m(nt, 'SINE', _m(nt, 'MULTIPLY', base, 230.0)), 0.1, 1.0)
    fv, fw = _st(nt, vec, w, 0.02, 1.0)
    fibre = _mr(nt, _n4(nt, fv, fw, 60.0, 4.0, 0.6), 0.32, 0.7)
    sv, sw = _st(nt, vec, w, 0.4, 1.0)
    silver = _mr(nt, _n4(nt, sv, sw, 2.4, 5.0, 0.62), 0.3, 0.72)
    blot = _mr(nt, _n4(nt, vec, w, 1.3, 3.0, 0.5), 0.35, 0.68)
    cv, cw = _st(nt, vec, w, 0.02, 1.0)
    crack = _mr(nt, _m(nt, 'ABSOLUTE', _m(nt, 'SUBTRACT', _n4(nt, cv, cw, 3.4, 2.0, 0.5), 0.5)), 0.0, 0.007, 1.0, 0.0)
    crack = _m(nt, 'MULTIPLY', crack, _mr(nt, _n4(nt, vec, w, 1.6, 2.0, 0.5), 0.5, 0.6))
    kv, kw = _st(nt, vec, w, 0.45, 1.0)
    vor = _vor4(nt, kv, kw, 1.25)
    pick = _mr(nt, node(nt, 'ShaderNodeSeparateColor', Color=vor.outputs['Color']).outputs[0], 0.72, 0.76)
    knot = _m(nt, 'MULTIPLY', _mr(nt, vor.outputs['Distance'], 0.075, 0.03), pick)
    halo = _m(nt, 'MULTIPLY', _mr(nt, vor.outputs['Distance'], 0.16, 0.06), pick)
    saw = _m(nt, 'SINE', _m(nt, 'ADD', _m(nt, 'MULTIPLY', _uvu(nt), 2 * PI * 34), _m(nt, 'MULTIPLY', fibre, 2.0)))
    return lines, fibre, silver, blot, crack, knot, halo, saw


def make_wood(nt, vec, w):
    lines, fibre, silver, blot, crack, knot, halo, saw = wood_fields(nt, vec, w)
    col = _rp(nt, silver, [(0.0, srgb(116, 98, 80)), (0.45, srgb(136, 128, 118)), (1.0, srgb(162, 160, 154))])
    col = _mx(nt, _m(nt, 'MULTIPLY', lines, 0.42), col, srgb(80, 72, 64))
    col = _mx(nt, _m(nt, 'MULTIPLY', fibre, 0.3), col, srgb(98, 90, 82))
    col = _mx(nt, _m(nt, 'MULTIPLY', blot, 0.15), col, srgb(112, 104, 96))
    col = _mx(nt, _m(nt, 'MULTIPLY', halo, 0.35), col, srgb(96, 72, 54))
    col = _mx(nt, _m(nt, 'MULTIPLY', knot, 0.9), col, srgb(58, 40, 30))
    col = _mx(nt, _m(nt, 'MULTIPLY', _mr(nt, saw, 0.6, 1.0), 0.06), col, srgb(90, 80, 70))
    return _mx(nt, _m(nt, 'MULTIPLY', crack, 0.9), col, srgb(30, 26, 22))


def make_wood_h(nt, vec, w):
    lines, fibre, silver, blot, crack, knot, halo, saw = wood_fields(nt, vec, w)
    # weathering wears the soft earlywood away: the latewood lines stand proud; checks cut in, knots stand up
    h = _m(nt, 'ADD', 0.5, _m(nt, 'MULTIPLY', lines, 0.14))
    h = _m(nt, 'ADD', h, _m(nt, 'MULTIPLY', fibre, 0.1))
    h = _m(nt, 'ADD', h, _m(nt, 'MULTIPLY', saw, 0.025))
    h = _m(nt, 'ADD', h, _m(nt, 'MULTIPLY', knot, 0.15))
    h = _m(nt, 'SUBTRACT', h, _m(nt, 'MULTIPLY', crack, 0.45))
    return _gray(nt, h)


def make_wood_n(nt, vec, w):
    """Paint-flake / lichen threshold noise: patches elongated along the grain."""
    v, ww = _st(nt, vec, w, 0.14, 1.0)
    a = _n4(nt, v, ww, 6.5, 7.0, 0.62, 0.2)
    b = _n4(nt, vec, w, 2.0, 3.0, 0.5)
    return _gray(nt, _m(nt, 'ADD', _m(nt, 'MULTIPLY', a, 0.8), _m(nt, 'MULTIPLY', b, 0.2)))


def metal_fields(nt, vec, w):
    sp = _vor4(nt, vec, w, 7.0)
    spang = node(nt, 'ShaderNodeSeparateColor', Color=sp.outputs['Color']).outputs[0]
    fine = _n4(nt, vec, w, 55.0, 4.0, 0.6)
    mot = _mr(nt, _n4(nt, vec, w, 2.5, 5.0, 0.6), 0.3, 0.7)
    rv, rw = _st(nt, vec, w, 0.03, 1.0)
    roll = _mr(nt, _n4(nt, rv, rw, 40.0, 2.0, 0.5), 0.3, 0.7)
    dent = _n4(nt, vec, w, 3.5, 3.0, 0.5)
    return spang, fine, mot, roll, dent


def make_metal(nt, vec, w):
    spang, fine, mot, roll, dent = metal_fields(nt, vec, w)
    col = _rp(nt, spang, [(0.0, srgb(122, 124, 128)), (0.5, srgb(136, 138, 142)), (1.0, srgb(152, 154, 156))])
    col = _mx(nt, _m(nt, 'MULTIPLY', mot, 0.4), col, srgb(108, 108, 108))
    col = _mx(nt, _m(nt, 'MULTIPLY', roll, 0.12), col, srgb(120, 122, 126))
    return _mx(nt, _m(nt, 'MULTIPLY', _mr(nt, fine, 0.45, 0.7), 0.15), col, srgb(100, 100, 102))


def make_metal_h(nt, vec, w):
    spang, fine, mot, roll, dent = metal_fields(nt, vec, w)
    h = _m(nt, 'ADD', 0.5, _m(nt, 'MULTIPLY', spang, 0.04))
    h = _m(nt, 'ADD', h, _m(nt, 'MULTIPLY', fine, 0.03))
    h = _m(nt, 'ADD', h, _m(nt, 'MULTIPLY', dent, 0.12))
    return _gray(nt, _m(nt, 'ADD', h, _m(nt, 'MULTIPLY', roll, 0.03)))


def make_metal_n(nt, vec, w):
    """Rust threshold noise: blotches with ragged edges."""
    a = _n4(nt, vec, w, 4.0, 9.0, 0.66, 0.35)
    b = _n4(nt, vec, w, 14.0, 4.0, 0.6)
    return _gray(nt, _m(nt, 'ADD', _m(nt, 'MULTIPLY', a, 0.75), _m(nt, 'MULTIPLY', b, 0.25)))


def stone_fields(nt, vec, w):
    m1 = _mr(nt, _n4(nt, vec, w, 2.2, 6.0, 0.6), 0.28, 0.72)
    m2 = _n4(nt, vec, w, 9.0, 5.0, 0.58)
    sp = _vor4(nt, vec, w, 70.0)
    spc = node(nt, 'ShaderNodeSeparateColor', Color=sp.outputs['Color']).outputs[0]
    dark = _mr(nt, spc, 0.86, 0.9)
    light = _mr(nt, spc, 0.08, 0.04)
    pit = _mr(nt, _vor4(nt, vec, w, 24.0).outputs['Distance'], 0.07, 0.02)
    stain = _mr(nt, _n4(nt, vec, w, 1.4, 3.0, 0.5), 0.58, 0.76)
    return m1, m2, dark, light, pit, stain


def make_stone(nt, vec, w):
    m1, m2, dark, light, pit, stain = stone_fields(nt, vec, w)
    col = _rp(nt, m1, [(0.0, srgb(112, 106, 98)), (0.5, srgb(146, 139, 128)), (1.0, srgb(170, 164, 152))])
    col = _mx(nt, _m(nt, 'MULTIPLY', _mr(nt, m2, 0.3, 0.7), 0.2), col, srgb(128, 124, 118))
    col = _mx(nt, _m(nt, 'MULTIPLY', stain, 0.35), col, srgb(150, 112, 80))
    col = _mx(nt, dark, col, srgb(56, 54, 52))
    col = _mx(nt, _m(nt, 'MULTIPLY', light, 0.8), col, srgb(206, 202, 194))
    return _mx(nt, _m(nt, 'MULTIPLY', pit, 0.5), col, srgb(80, 76, 70))


def make_stone_h(nt, vec, w):
    m1, m2, dark, light, pit, stain = stone_fields(nt, vec, w)
    h = _m(nt, 'ADD', 0.5, _m(nt, 'MULTIPLY', m1, 0.25))
    h = _m(nt, 'ADD', h, _m(nt, 'MULTIPLY', m2, 0.2))
    return _gray(nt, _m(nt, 'SUBTRACT', h, _m(nt, 'MULTIPLY', pit, 0.2)))


def make_stone_n(nt, vec, w):
    """Moss and lichen threshold noise: rosettes and cushions."""
    v = _vor4(nt, vec, w, 5.0).outputs['Distance']
    a = _n4(nt, vec, w, 7.0, 6.0, 0.6, 0.3)
    return _gray(nt, _m(nt, 'ADD', _m(nt, 'MULTIPLY', v, 0.55), _m(nt, 'MULTIPLY', a, 0.45)))


def equalize(a):
    """Rank-transform to a uniform 0..1 distribution (the shader thresholds the atlas against it)."""
    import numpy as np
    flat = a.ravel()
    r = np.empty(flat.size, np.float32)
    r[np.argsort(flat, kind='stable')] = np.linspace(0.0, 1.0, flat.size, dtype=np.float32)
    return r.reshape(a.shape)


def tile_set(name, make, make_h, make_n, size, strength):
    """Bake a detail tile: the albedo (sRGB) and a normal map whose blue channel carries the threshold noise."""
    import numpy as np
    bake_tile(MODELS + 'shed_%s.png' % name, make, size)
    h = bake_tile(os.path.join(CACHE, 'shed_%s_h.png' % name), make_h, size, colorspace='Non-Color')[:, :, 0]
    n = bake_tile(os.path.join(CACHE, 'shed_%s_n.png' % name), make_n, size, colorspace='Non-Color')[:, :, 0]
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * strength
    nn = np.stack([-dx, -dy, np.ones_like(h)], axis=-1)
    nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
    out = nn * 0.5 + 0.5
    out[:, :, 2] = equalize(n)
    save_png(MODELS + 'shed_%s_normal.png' % name, out)


def bake_tiles():
    os.makedirs(CACHE, exist_ok=True)
    t0 = time.time()
    s = 512 if QUICK else 1024
    tile_set('wood', make_wood, make_wood_h, make_wood_n, s, 5.0)
    tile_set('metal', make_metal, make_metal_h, make_metal_n, s // 2, 2.5)
    tile_set('stone', make_stone, make_stone_h, make_stone_n, s, 4.0)
    return round(time.time() - t0, 1)


# ============================================================================ the atlas: unwrap, G-buffer, bakes
BUCKET_ID = {'w_ext': 1, 'w_int': 2, 'w_hid': 3, 'h_roof': 4, 'h_stone': 5, 'h_small': 6}


def mat_of(ob):
    return ob.data.materials[0].name[len(PREFIX):] if ob.type == 'MESH' and ob.data.materials else ''


def targets():
    return [ob for ob in _scene().objects if ob.type == 'MESH' and mat_of(ob) in BUCKET_ID and not ob.get('noexport')]


def unwrap(objs, margin=0.0012):
    """Smart-project every target together, scale each bucket's islands by its density, and pack them into one square.
    Returns the texel density reached per bucket (atlas units per metre)."""
    import numpy as np
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    for ob in objs:
        me = ob.data
        lm = me.uv_layers.get('lightmap') or me.uv_layers.new(name='lightmap')
        me.uv_layers.active = lm
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True,
                                 scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    for ob in objs:
        me = ob.data
        buf = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers['lightmap'].data.foreach_get('uv', buf)
        me.uv_layers['lightmap'].data.foreach_set('uv', buf * DENS[mat_of(ob)])
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', scale=True, margin_method='FRACTION', margin=margin,
                                shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')
    dens = {}
    for ob in objs:
        me = ob.data
        uv = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers['lightmap'].data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        a2, a3 = 0.0, 0.0
        for p in list(me.polygons)[:600]:
            q = uv[list(p.loop_indices)]
            a2 += 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(q[:, 1], np.roll(q[:, 0], -1)))
            a3 += p.area
        dens[mat_of(ob)] = round(math.sqrt(a2 / max(a3, 1e-9)), 5)
    for ob in objs:
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
        ob.data.uv_layers['UVMap'].active_render = True
    return dens


def _clear_nodes(m):
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return nt, nt.nodes.new('ShaderNodeOutputMaterial')


def _game_vec(nt, v):
    sep = node(nt, 'ShaderNodeSeparateXYZ', Vector=v)
    return node(nt, 'ShaderNodeCombineXYZ', X=sep.outputs['X'], Y=sep.outputs['Z'], Z=math_node(nt, 'MULTIPLY', sep.outputs['Y'], -1.0)).outputs[0]


def _noise3(nt, v, scale, detail=4.0, rough=0.55):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '3D'}, Vector=v, Scale=scale, Detail=detail, Roughness=rough).outputs['Fac']


def _pass(nt, which, mname):
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    gp = _game_vec(nt, geo.outputs['Position'])
    if which == 'P':
        return node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY_ADD'}, i0=gp, i1=(0.1, 0.1, 0.1), i2=(0.5, 0.5, 0.5)).outputs[0]
    if which == 'N':
        gn = _game_vec(nt, geo.outputs['True Normal'])
        return node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY_ADD'}, i0=gn, i1=(0.5, 0.5, 0.5), i2=(0.5, 0.5, 0.5)).outputs[0]
    if which == 'K':
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'UVMap'
        u = node(nt, 'ShaderNodeSeparateXYZ', Vector=uvn.outputs['UV']).outputs['X']
        k = math_node(nt, 'FLOOR', math_node(nt, 'DIVIDE', math_node(nt, 'ADD', u, KSTEP / 2), KSTEP))
        return node(nt, 'ShaderNodeCombineXYZ', X=BUCKET_ID.get(mname, 0) / 16.0, Y=math_node(nt, 'DIVIDE', k, 16.0), Z=1.0).outputs[0]
    if which == 'A':
        # rain streaks (tall and thin), mottling, big blotches
        a = _noise3(nt, node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=gp, i1=(40.0, 1.2, 40.0)).outputs[0], 1.0, 3.0, 0.5)
        b = _noise3(nt, gp, 9.0, 5.0, 0.55)
        c = _noise3(nt, gp, 1.3, 4.0, 0.6)
        return node(nt, 'ShaderNodeCombineXYZ', X=a, Y=b, Z=c).outputs[0]
    if which == 'E':
        tn = geo.outputs['True Normal']
        outs = []
        for r in (0.004, 0.012):
            bv = node(nt, 'ShaderNodeBevel', props={'samples': 16}, Radius=r)
            dp = node(nt, 'ShaderNodeVectorMath', props={'operation': 'DOT_PRODUCT'}, i0=bv.outputs['Normal'], i1=tn).outputs['Value']
            outs.append(math_node(nt, 'SUBTRACT', 1.0, dp))
        return node(nt, 'ShaderNodeCombineXYZ', X=outs[0], Y=outs[1], Z=0.0).outputs[0]
    raise ValueError(which)


def _atlas_image(size, name='DB_shedbake'):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    return img


def bake_emit(objs, size, which, samples=1):
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    img = _atlas_image(size)
    for m in {s.material for ob in objs for s in ob.material_slots if s.material}:
        nt, out = _clear_nodes(m)
        em = node(nt, 'ShaderNodeEmission', Color=_pass(nt, which, m.name[len(PREFIX):]), Strength=1.0)
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img
        nt.nodes.active = tn
    _cycles(sc, samples)
    sc.cycles.use_denoising = False
    sc.cycles.filter_width = 0.01 if samples == 1 else 1.5
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True, target='IMAGE_TEXTURES', uv_layer='lightmap')
    sc.cycles.filter_width = 1.5
    return _np_image(img)[:, :, :3].copy()


def bake_occlusion(objs, size, samples, distance):
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    img = _atlas_image(size)
    for m in {s.material for ob in objs for s in ob.material_slots if s.material}:
        nt, out = _clear_nodes(m)
        bs = node(nt, 'ShaderNodeBsdfDiffuse', Color=(0.8, 0.8, 0.8, 1.0))
        nt.links.new(bs.outputs[0], out.inputs['Surface'])
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img
        nt.nodes.active = tn
    _cycles(sc, samples)
    if sc.world is None:
        sc.world = bpy.data.worlds.new('DB_world')
    sc.world.light_settings.distance = distance
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.bake(type='AO', margin=0, use_clear=True, target='IMAGE_TEXTURES', uv_layer='lightmap')
    return _np_image(img)[:, :, :3].mean(axis=2)


def ground_plane():
    sc = _scene()
    g = sc.objects.get('BAKE_ground')
    if g is None:
        me = bpy.data.meshes.new('DB_bake_ground')
        s = 30.0
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        g = bpy.data.objects.new('BAKE_ground', me)
        g['noexport'] = 1
        sc.collection.objects.link(g)
    g.hide_render = False
    return g


def plain_materials():
    for m in bpy.data.materials:
        if not m.name.startswith(PREFIX):
            continue
        key = m.name[len(PREFIX):]
        if key not in MATS:
            continue
        nt, out = _clear_nodes(m)
        p = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(p.outputs[0], out.inputs['Surface'])
        col, rough = MATS[key]
        p.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1.0)
        p.inputs['Roughness'].default_value = rough


def bake_all():
    import numpy as np, json
    t0 = time.time()
    os.makedirs(CACHE, exist_ok=True)
    out = {'tiles_s': bake_tiles()}
    objs = targets()
    t1 = time.time()
    out['density'] = unwrap(objs)
    out['unwrap_s'] = round(time.time() - t1, 1)
    S = 1024 if QUICK else 2048
    out['texels_per_m'] = {k: round(v * S) for k, v in out['density'].items()}
    G = {}
    t1 = time.time()
    for w in ('P', 'N', 'K', 'A'):
        G[w] = bake_emit(objs, S, w).astype(np.float32)
    G['E'] = bake_emit(objs, S, 'E', samples=4 if QUICK else 8).astype(np.float32)
    out['gbuffer_s'] = round(time.time() - t1, 1)
    t1 = time.time()
    g = ground_plane()
    G['aoS'] = bake_occlusion(objs, S, 32 if QUICK else 128, 0.3).astype(np.float32)
    G['aoL'] = bake_occlusion(objs, S, 32 if QUICK else 160, 2.5).astype(np.float32)
    g.hide_render = True
    out['ao_s'] = round(time.time() - t1, 1)
    np.savez_compressed(os.path.join(CACHE, 'gbuf.npz'), **G)
    with open(os.path.join(CACHE, 'sources.json'), 'w') as f:
        json.dump({'rust': RUST, 'screws': SCREWS}, f)
    t1 = time.time()
    out['paint'] = paint(G)
    out['paint_s'] = round(time.time() - t1, 1)
    plain_materials()
    out['seconds'] = round(time.time() - t0, 1)
    return out


def paint_only():
    """Repaint the atlas from the cached G-buffer (SHED_PAINT=1): no rebuild, no rebake, no export."""
    import numpy as np, json
    G = dict(np.load(os.path.join(CACHE, 'gbuf.npz')))
    src = json.load(open(os.path.join(CACHE, 'sources.json')))
    RUST[:] = [tuple(tuple(x) if isinstance(x, list) else x for x in r) for r in src['rust']]
    SCREWS[:] = [tuple(s) for s in src['screws']]
    return paint(G)


# ============================================================================ painting the atlas (numpy)
def _ss(a, b, x):
    import numpy as np
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _dilate(a, m, n=16):
    """Grow the covered texels (mask m) out into the gutters, n texels, averaging neighbours."""
    import numpy as np
    a = a.copy()
    m = m.astype(bool).copy()
    for _ in range(n):
        acc = np.zeros_like(a)
        cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            mm = np.roll(m, (dy, dx), (0, 1))
            aa = np.roll(a, (dy, dx), (0, 1))
            acc += aa * (mm[..., None] if a.ndim == 3 else mm)
            cnt += mm
        new = (~m) & (cnt > 0)
        if not new.any():
            break
        a[new] = acc[new] / (cnt[new][:, None] if a.ndim == 3 else cnt[new])
        m |= new
    return a


def _blur3(a, m):
    """A small blur that stays inside the covered texels."""
    import numpy as np
    w = m.astype(np.float32)
    acc = a * w
    cnt = w.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        acc += np.roll(a * w, (dy, dx), (0, 1))
        cnt += np.roll(w, (dy, dx), (0, 1))
    return np.where(m, acc / np.maximum(cnt, 1e-6), a)


def paint(G):
    import numpy as np
    P = (G['P'] - 0.5) * 10.0
    N = G['N'] * 2.0 - 1.0
    K, A, E = G['K'], G['A'], G['E']
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    nx, ny, nz = N[..., 0], N[..., 1], N[..., 2]
    cover = K[..., 2] > 0.5
    bucket = np.rint(K[..., 0] * 16).astype(np.int32)
    kind = np.rint(K[..., 1] * 16).astype(np.int32)
    streak, mot, blot = A[..., 0], A[..., 1], A[..., 2]
    edge = np.clip(E[..., 0] * 3.0 + E[..., 1] * 1.5, 0, 1)
    aoS = np.clip(G['aoS'], 0, 1)
    aoL = np.clip(G['aoL'], 0, 1)
    f32 = lambda m: np.asarray(m).astype(np.float32)
    wood = (bucket >= 1) & (bucket <= 3)
    hard = bucket >= 4
    raw, painted = wood & (kind == 0), wood & (kind == 1)
    K_ = lambda name: hard & (kind == HK[name])
    galv, iron, stone_, mortar = K_('galv'), K_('iron'), K_('stone'), K_('mortar')
    glass, glass_in, glow, enamel, brass = K_('glass'), K_('glass_in'), K_('glow'), K_('enamel'), K_('brass')
    ax, az = np.abs(x), np.abs(z)
    yroof = TP + (IX - ax) * TANP + (RD + PD) / COSP
    inside = (ax < OX + 0.001) & (az < OZ + 0.001) & (y > FL - 0.02) & (y < yroof + 0.03)
    roof_top = (bucket == BUCKET_ID['h_roof']) & (ny > 0.2) & (y > TP - 0.3)
    inside &= ~roof_top
    ext = ~inside
    vert = f32(np.abs(ny) < 0.5)
    up = f32(ny > 0.6)
    side_wall = f32(ext & (np.abs(nx) > 0.7) & (np.abs(ny) < 0.5))
    end_wall = f32(ext & (np.abs(nz) > 0.7) & (np.abs(ny) < 0.5))
    # how much rain a wall face gets: under the eaves the upper side walls stay dry
    wet = side_wall * _ss(3.2, 1.0, y) + end_wall * (0.55 + 0.45 * _ss(3.6, 0.8, y))
    splash = f32(ext) * _ss(1.05, 0.0, y)
    damp = np.clip(-x / 2.0, 0, 1) * 0.5 + np.clip(-z / 2.8, 0, 1) * 0.5      # the uphill side and the back
    streaks = _ss(0.52, 0.78, streak)

    # ---- G: grime
    g = 0.05 + 0.08 * mot
    g += splash * 0.55 * (0.55 + 0.45 * blot)
    g += (side_wall + end_wall) * wet * streaks * 0.4
    g += 0.35 * np.clip(1.0 - aoS, 0, 1)
    g += f32(inside) * 0.08 * (1.0 - aoL)
    g += f32(roof_top) * _ss(1.2, 2.35, ax) * 0.25 * (0.5 + blot)
    floor = hard & (y < FL + 0.01) & (y > FL - 0.03) & (ny > 0.8) & (((ax < IX) & (z > 0.0) & (z < IZ)) | ((ax < DOOR_HW) & (z >= IZ - 0.01) & (z < THRESH_Z + 0.02)))
    g += f32(floor) * (0.08 + 0.3 * _ss(0.55, 1.5, ax) + 0.15 * _ss(1.2, 2.6, z))
    # rain running off the window sill
    zc, hw_, ytop = (WIN[0] + WIN[1]) / 2, (WIN[1] - WIN[0]) / 2 + 0.05, WIN[2] - 0.01
    g += side_wall * f32(x > 0) * _ss(hw_ + 0.03, hw_ - 0.05, np.abs(z - zc)) * _ss(ytop, ytop - 0.6, y) * f32(y < ytop) * streaks * 0.35
    # rust runs down from iron (hinges, brackets, the lamp)
    runs = np.zeros(x.shape, np.float32)
    for (rx, ry, rz, n, st, ln) in RUST:
        if ln <= 0:
            continue
        sel = (np.abs(x - rx) < 0.06) & (np.abs(z - rz) < 0.06) & (y < ry + 0.02) & (y > ry - ln - 0.02) & cover
        if not sel.any():
            continue
        idx = np.nonzero(sel)
        n = np.asarray(n, np.float32)
        dx, dy, dz = x[idx] - rx, y[idx] - ry, z[idx] - rz
        along = dx * n[0] + dz * n[2]
        hor = np.sqrt(np.maximum(dx * dx + dz * dz - along * along, 0.0))
        drop = np.clip(-dy / ln, 0, 1)
        wid = 0.004 + 0.012 * drop
        tail = _ss(wid, wid * 0.2, hor + (mot[idx] - 0.5) * 0.006) * (1 - drop) ** 1.3 * f32(np.abs(ny[idx]) < 0.5)
        bloom = _ss(0.02, 0.005, np.sqrt(dx * dx + dy * dy + dz * dz))
        runs[idx] = np.maximum(runs[idx], np.clip((tail * 0.8 + bloom) * st, 0, 1))
    g += f32(wood) * runs * 0.6
    g = np.where(glass | glass_in, 0.4 + 0.35 * mot + 0.35 * _ss(WIN[2] + 0.25, WIN[2] + 0.05, y), g)
    g = np.where(glow, 0.0, g)
    g = np.clip(g, 0, 1)

    # ---- B: weathering (moss and lichen on raw wood and stone; paint loss; rust)
    b = np.zeros(x.shape, np.float32)
    b += f32(raw & ext) * (0.02 + 0.3 * _ss(1.1, 0.45, y) * vert * (0.4 + blot) + 0.3 * up + 0.12 * damp * vert)
    loss = 0.04 + 0.14 * mot + 0.4 * _ss(0.75, 0.14, y) + 0.4 * edge + 0.06 * f32(ext) + 0.16 * _ss(0.45, 0.8, blot)
    b = np.where(painted, np.clip(loss, 0, 1) * np.where(inside, 0.6, 1.0), b)
    moss = f32(ext) * (0.08 + 0.45 * up + 0.3 * _ss(0.3, 0.0, y) + 0.2 * damp) * (0.45 + blot)
    b = np.where(stone_ | mortar, moss * np.where(mortar, 0.8, 1.0), b)
    b = np.where(floor, 0.02, b)
    rust = 0.03 + 0.14 * blot + 0.05 * mot
    sheet_no = np.floor((z + RAKE_Z) / (10 * WAVE)) + 17 * f32(x > 0)
    sheet_var = np.mod(np.sin(sheet_no * 12.9898) * 43758.5453, 1.0)
    rust += f32(roof_top) * (0.2 * _ss(1.4, 2.36, ax) * (0.4 + blot) + 0.14 * sheet_var)
    laps = np.full(x.shape, 9.0, np.float32)
    for k in range(1, 8):
        laps = np.minimum(laps, np.abs(z - (-RAKE_Z + (k * 10 + 0.5) * WAVE)))
    rust += f32(roof_top) * _ss(0.05, 0.0, laps) * 0.25 * (0.5 + blot)
    rust += f32(bucket == BUCKET_ID['h_roof']) * f32(ax > TAIL_X) * 0.16          # gutters and their hangers
    rust += f32(bucket == BUCKET_ID['h_roof']) * f32((ax < 0.25) & (y > yroof - 0.05)) * 0.2   # the ridge cap
    rust = np.where(f32(ny < -0.3) * f32(inside) > 0, 0.05 + 0.04 * blot, rust)
    # screws: a bloom round each head and a streak down the slope
    sr = np.zeros(x.shape, np.float32)
    rt = np.nonzero(roof_top & cover)
    xr, zr = x[rt], z[rt]
    for (sx, sy, sz, side) in SCREWS:
        sel = (np.abs(zr - sz) < 0.03) & (np.abs(xr) > abs(sx) - 0.02) & (np.abs(xr) < abs(sx) + 0.45)
        if not sel.any():
            continue
        ii = np.nonzero(sel)[0]
        d_along = np.abs(xr[ii]) - abs(sx)
        dz_ = np.abs(zr[ii] - sz)
        ln = 0.12 + 0.3 * (((int(sx * 997) * 31 + int(sz * 991)) % 100) / 100.0)
        drop = np.clip(d_along / ln, 0, 1)
        tail = _ss(0.004 + 0.01 * drop, 0.001, dz_) * (1 - drop) ** 1.2 * f32(d_along > 0)
        bloom = _ss(0.018, 0.006, np.sqrt(d_along ** 2 + dz_ ** 2))
        sr[rt[0][ii], rt[1][ii]] = np.maximum(sr[rt[0][ii], rt[1][ii]], np.clip(tail * 0.7 + bloom, 0, 1))
    rust += sr * 0.6
    b = np.where(galv, np.clip(rust, 0, 1), b)
    b = np.where(iron, np.clip(0.22 + 0.3 * blot + 0.1 * mot, 0, 1), b)
    b = np.where(enamel, np.clip(0.015 + 0.07 * blot, 0, 1), b)
    b = np.where(brass, np.clip(0.35 + 0.3 * blot, 0, 1), b)
    b = np.where(glass | glass_in | glow, 0.0, b)
    b = np.where(hard & ~(glass | glass_in | glow), np.maximum(b, runs * 0.8), b)

    # ---- R: occlusion (the near creases, and the enclosure, gently)
    ao = np.clip(aoS, 0, 1) ** 0.7 * (0.72 + 0.28 * aoL)
    ao = np.where(glow, 1.0, ao)

    out = np.stack([ao, g, b], axis=-1).astype(np.float32)
    for c in range(3):
        out[..., c] = _blur3(out[..., c], cover)
    out = _dilate(out, cover, 12)
    save_png(MODELS + 'shed_atlas.png', out)
    return {'covered': round(float(cover.mean()), 3), 'ao_mean': round(float(ao[cover].mean()), 3),
            'grime_mean': round(float(g[cover].mean()), 3), 'weather_mean': round(float(b[cover].mean()), 3)}
