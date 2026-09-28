# Dreambound: the power tower's catwalk kit, one per giant LED: the DIP-switch box on the catwalk rail (and its sliders),
# the big screw-terminal capacitor bolted to the outside of the lattice, and the small solar panel clamped to a rail.
# Executed inside dbkit.py's namespace by build_tower_kit.py.
#
# Each piece is a part (an empty with its meshes) modelled in its own frame; src/props/powertower.js places each one
# three times (once per LED) and merges them, so the three kits share one texture atlas. The frames:
#   BOX     the switch box. Origin at the centre of its back face, +z out of the door (toward the deck), +x to the
#           viewer's right, y up. It hangs on two flat bars in front of the rails: the top rail's front face is at
#           z = -0.015 with its centre 0.07 above the origin, the knee rail 0.45 below it; the deck is 1.0 below.
#   TAG_i   the enamel tag on the door in the colour of LED i (0 green, 1 yellow, 2 red), in the box's frame.
#   SLIDER  one switch grip, origin on the switch plate's face (the game slides it along y).
#   CAP     the capacitor with its backing channel. Origin at the back of the channel at the lattice's lower member,
#           +z out from the tower, y up; the channel runs 2.72 m up to reach the member above.
#   PANEL   the solar panel on its rail clamp. Origin on top of the rail (which runs along x), +z away from the deck;
#           the panel faces the sky, tilted 30 degrees toward the deck so it's seen from there.
# The switch numbers (face, pitch, travel, the plate's centre) are the game's SWB in src/props/powertower.js.
#
# One lit PBR material: tower_kit_albedo.png (2048), tower_kit_normal.png and tower_kit_orm.png (1024: baked AO,
# roughness, metalness). Like the elevator, the textures are painted in numpy from a baked G-buffer (position, normal,
# kind, part, bevel-edge masks, AO, a few noises), so the wear follows the geometry: the box's enamel is chalky and
# chipped along its edges, grime sits in the seams and along the bottom, rust runs down from its bolts and hinges, the
# switch plate is rubbed bright round the slots, the brackets are galvanised with white rust and heat-tinted welds.

MODELS = ROOT + '/public/models/'
QUICK = os.environ.get('KIT_QUICK') == '1'          # small, noisy bakes for layout work
CACHE = os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_tower_kit')

KIND = {'k_paint': 1, 'k_galv': 2, 'k_weld': 3, 'k_bezel': 4, 'k_slot': 5, 'k_lip': 6, 'k_tag0': 7, 'k_tag1': 8, 'k_tag2': 9,
        'k_grip': 10, 'k_shank': 11, 'k_rubber': 12, 'k_bolt': 13,
        'k_sleeve': 20, 'k_alu': 21, 'k_phenolic': 22, 'k_brass': 23, 'k_chan': 24, 'k_vent': 25,
        'k_cell': 30, 'k_frame': 31, 'k_back': 32, 'k_jbox': 33}
MATS.update({k: ((0.5, 0.5, 0.5), 0.5) for k in KIND})
MATS.update({'k_paint': ((0.26, 0.30, 0.27), 0.6), 'k_galv': ((0.45, 0.45, 0.46), 0.5), 'k_sleeve': ((0.02, 0.03, 0.07), 0.5),
             'k_cell': ((0.02, 0.035, 0.09), 0.1), 'k_grip': ((0.6, 0.16, 0.03), 0.5), 'k_tag0': ((0.03, 0.45, 0.12), 0.3),
             'k_tag1': ((0.85, 0.55, 0.02), 0.3), 'k_tag2': ((0.7, 0.04, 0.02), 0.3), 'k_brass': ((0.45, 0.33, 0.15), 0.4),
             'occ': ((0.3, 0.3, 0.3), 0.8)})
NO_BAKE = {'occ', 'collider'}

# Parts: index (baked into the G-buffer), where each is laid out in the Blender scene (far enough apart that they don't
# occlude one another), and texel density.
PARTS = ['BOX', 'TAG_0', 'TAG_1', 'TAG_2', 'SLIDER', 'CAP', 'PANEL']
PIV = {'BOX': (0.0, 0.0, 0.0), 'TAG_0': (0.0, 0.0, 0.0), 'TAG_1': (-0.8, 0.3, 0.0), 'TAG_2': (-0.8, 0.7, 0.0),
       'SLIDER': (0.7, 0.5, 0.3), 'CAP': (2.0, -1.2, -0.4), 'PANEL': (-1.6, -0.6, 0.4)}
DENS = {'BOX': 1.0, 'TAG_0': 1.0, 'TAG_1': 1.0, 'TAG_2': 1.0, 'SLIDER': 1.0, 'CAP': 0.30, 'PANEL': 0.75}

# ---------------------------------------------------------------- the switch box (src/props/powertower.js SWB)
W, H, D = 0.30, 0.34, 0.10          # body
FACE = 0.112                         # the door's face (slider origin)
MIDY, PITCH, TRAVEL = -0.03, 0.085, 0.045
KNEE, TOPR = -0.45, 0.07             # rail centres relative to the box's centre (deck + 1.0)
DECK = -1.0
BAR_X, BAR_W, BAR_T = 0.17, 0.035, 0.015
PLATE = (-0.13, 0.13, MIDY - 0.1, MIDY + 0.1)   # switch plate x0, x1, y0, y1
PLATE_T = 0.004
TAG = (-0.065, 0.065, 0.097, 0.131)
CONDUIT = (0.08, 0.05)               # conduit x, z
# ---------------------------------------------------------------- the capacitor (CAP frame)
CR, CY0, CY1 = 0.40, -0.35, 0.98     # can radius, bottom, top of the straight side
CH_W, CH_D, CH_T, CH_Y0, CH_Y1 = 0.10, 0.05, 0.007, -0.15, 2.72
BAND_Y = (0.10, 0.80)
BAND_T, BAND_H = 0.012, 0.06
CZ = CH_D + 0.07 + BAND_T + CR       # the can's axis
DISC_Y = 1.165                       # top of the terminal disc
TERM_X = 0.14
# ---------------------------------------------------------------- the solar panel (PANEL frame)
PW, PL, PT = 0.36, 0.28, 0.03        # across, along the slope, frame depth
TILT = math.radians(30)
PC = (0.0, 0.15, 0.13)               # centre of the glass

RUST = []     # (part, (x, y, z), (nx, ny, nz), strength, length): rust runs down from bolts, hinges and screws
WELDS = []    # (part, (x, y, z), radius): heat tint round the welds
PBOX = []     # the box's enamelled pieces: (inverse matrix or None, x0, x1, y0, y1, z0, z1), for chipping along their edges

# ---------------------------------------------------------------- emit helpers (local coordinates inside a part)
CUR = [None]

class inpart:
    """Emit into a part: geometry is written in the part's own frame; dbkit's ORIGIN moves it to the part's spot."""
    def __init__(self, name):
        self.name = name
    def __enter__(self):
        set_origin(*PIV[self.name])
        part(self.name, (0.0, 0.0, 0.0), bake=True)
        self.ctx = into(self.name)
        self.ctx.__enter__()
        CUR[0] = self.name
        return self
    def __exit__(self, *exc):
        self.ctx.__exit__(*exc)
        set_origin(0.0, 0.0, 0.0)
        CUR[0] = None

def rust(p, n, strength=1.0, length=0.08):
    RUST.append((PARTS.index(CUR[0]), tuple(p), tuple(n), strength, length))

def weld(p, r=0.02):
    WELDS.append((PARTS.index(CUR[0]), tuple(p), r))

def emit_uv(kind, bm, M=None, uvd=None, planar=None, smooth=False):
    """Emit a bmesh built in local coordinates, transformed by M. UVs come from uvd (face index -> [(u, v)]) or are
    metric planar projections of the untransformed coordinates along each face's dominant axis (or `planar`)."""
    bm.normal_update()
    bm.faces.index_update()
    if uvd is None:
        uvd = {}
        for f in bm.faces:
            n = f.normal
            ax = planar if planar is not None else max(range(3), key=lambda i: abs(n[i]))
            a, b = [i for i in range(3) if i != ax]
            uvd[f.index] = [(l.vert.co[a], l.vert.co[b]) for l in f.loops]
    if M is not None:
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    emit(bm, kind, None, WHITE, uvface=lambda f: uvd[f.index], smooth=smooth)

DIRS = {'+x': Vector((1, 0, 0)), '-x': Vector((-1, 0, 0)), '+y': Vector((0, 1, 0)), '-y': Vector((0, -1, 0)),
        '+z': Vector((0, 0, 1)), '-z': Vector((0, 0, -1))}

def bbox(kind, x0, x1, y0, y1, z0, z1, bevel=0.0, seg=1, drop=(), M=None):
    """An (optionally bevelled) box from its bounds; drop lists faces that are never seen ('-z', ...)."""
    if kind == 'k_paint' and CUR[0] == 'BOX':
        PBOX.append(([list(r) for r in M.inverted()] if M is not None else None, x0, x1, y0, y1, z0, z1))
    bm = bm_box(x1 - x0, y1 - y0, z1 - z0, bevel, seg)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    if drop:
        bm.normal_update()
        dead = [f for f in bm.faces if any(f.normal.dot(DIRS[d]) > 0.999 for d in drop)]
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='FACES')
    emit_uv(kind, bm, M)

def axis_matrix(p0, p1):
    """Local +z along p0 -> p1, origin at p0."""
    a, b = Vector(p0), Vector(p1)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0))
    x = ref.cross(d).normalized()
    y = d.cross(x)
    return Matrix(((x.x, y.x, d.x, a.x), (x.y, y.y, d.y, a.y), (x.z, y.z, d.z, a.z), (0, 0, 0, 1)))

class VBM:
    """A bmesh whose UVs live on its vertices (seams are duplicated vertices), so reorienting faces can't scramble them,
    and whose faces carry their own want-normal and smooth flag."""
    def __init__(self):
        self.bm = bmesh.new()
        self.lu = self.bm.verts.layers.float.new('u')
        self.lv = self.bm.verts.layers.float.new('v')
        self.want, self.smooth = {}, {}
    def v(self, co, u, w):
        vv = self.bm.verts.new(co)
        vv[self.lu], vv[self.lv] = u, w
        return vv
    def f(self, verts, want, smooth):
        fc = self.bm.faces.new(verts)
        self.want[fc] = Vector(want)
        self.smooth[fc] = smooth
        return fc
    def emit(self, kind, M=None):
        bm = self.bm
        bm.normal_update()
        flip = [fc for fc in bm.faces if fc.normal.dot(self.want[fc]) < 0]
        if flip:
            bmesh.ops.reverse_faces(bm, faces=flip)
        flags = [self.smooth[fc] for fc in bm.faces]
        if M is not None:
            bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
        it = iter(flags)
        lu, lv = self.lu, self.lv
        emit(bm, kind, None, WHITE, uvface=lambda fc: [(l.vert[lu], l.vert[lv]) for l in fc.loops], smooth=lambda n: next(it))

def cyl(kind, p0, p1, r, segs=12, caps=(True, True), r1=None, smooth=True, a0=0.0):
    """A cylinder (or frustum, r1 at p1) from p0 to p1; side unwrapped (u round, v along), caps planar."""
    r1 = r if r1 is None else r1
    L = (Vector(p1) - Vector(p0)).length
    g = VBM()
    ra = (r + r1) / 2
    ring0 = [g.v((math.cos(a0 + 2 * PI * i / segs) * r, math.sin(a0 + 2 * PI * i / segs) * r, 0.0), 2 * PI * i / segs * ra, 0.0) for i in range(segs + 1)]
    ring1 = [g.v((math.cos(a0 + 2 * PI * i / segs) * r1, math.sin(a0 + 2 * PI * i / segs) * r1, L), 2 * PI * i / segs * ra, L) for i in range(segs + 1)]
    for i in range(segs):
        am = a0 + 2 * PI * (i + 0.5) / segs
        g.f((ring0[i], ring0[i + 1], ring1[i + 1], ring1[i]), (math.cos(am), math.sin(am), 0.0), smooth)
    for (on, rr, zz, sgn) in ((caps[0], r, 0.0, -1), (caps[1], r1, L, 1)):
        if on and rr > 1e-6:
            c = [g.v((math.cos(a0 + 2 * PI * i / segs) * rr, math.sin(a0 + 2 * PI * i / segs) * rr, zz),
                     math.cos(a0 + 2 * PI * i / segs) * rr, math.sin(a0 + 2 * PI * i / segs) * rr) for i in range(segs)]
            g.f(c, (0, 0, sgn), False)
    g.emit(kind, axis_matrix(p0, p1))

def hexnut(kind, p, axis, r, h):
    """A hex head or nut standing on p along axis (a unit vector)."""
    q = Vector(p) + Vector(axis) * h
    cyl(kind, p, q.to_tuple(), r, 6, (False, True), smooth=False, a0=PI / 6)

def tubel(kind, pts, r, sides=8, caps=True):
    """A tube along a polyline (local coordinates), unwrapped u round, v along."""
    P = [Vector(p) for p in pts]
    g = VBM()
    rings, s_acc = [], 0.0
    for i, p in enumerate(P):
        t = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
        t.normalize()
        ref = Vector((0, 1, 0)) if abs(t.y) < 0.95 else Vector((1, 0, 0))
        Nn = (ref - t * ref.dot(t)).normalized()
        Bn = t.cross(Nn)
        if i:
            s_acc += (P[i] - P[i - 1]).length
        dirs = [Nn * math.cos(2 * PI * j / sides) + Bn * math.sin(2 * PI * j / sides) for j in range(sides + 1)]
        rings.append(([g.v(p + d * r, 2 * PI * j / sides * r, s_acc) for j, d in enumerate(dirs)], dirs, t))
    for (A, dA, _), (Bq, dB, _) in zip(rings[:-1], rings[1:]):
        for j in range(sides):
            g.f((A[j], A[j + 1], Bq[j + 1], Bq[j]), dA[j] + dA[j + 1], True)
    if caps:
        for k, sgn in ((0, -1), (-1, 1)):
            ring, dirs, t = rings[k]
            c = [g.v(v.co, dirs[j].dot(rings[k][1][0]) * r, dirs[j].dot(t.cross(rings[k][1][0])) * r) for j, v in enumerate(ring[:-1])]
            g.f(c, t * sgn, False)
    g.emit(kind)

def lathe(kind, prof, segs=48, c=(0.0, 0.0, 0.0), smooth=True):
    """Surface of revolution about the vertical axis through c: prof [(r, y)] from bottom to top, the surface on the
    right of the profile's direction (outward for a profile climbing the outside). u = angle x the profile's largest
    radius, v = arc length along the profile."""
    rref = max(r for r, _ in prof)
    g = VBM()
    rings, s_acc = [], 0.0
    for i, (r, y) in enumerate(prof):
        if i:
            s_acc += math.hypot(r - prof[i - 1][0], y - prof[i - 1][1])
        rings.append([g.v((c[0] + math.cos(2 * PI * j / segs) * r, c[1] + y, c[2] + math.sin(2 * PI * j / segs) * r), 2 * PI * j / segs * rref, s_acc) for j in range(segs + 1)])
    for i in range(len(prof) - 1):
        dr, dy = prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]
        A, Bq = rings[i], rings[i + 1]
        for j in range(segs):
            am = 2 * PI * (j + 0.5) / segs
            g.f((A[j], A[j + 1], Bq[j + 1], Bq[j]), (math.cos(am) * dy, -dr, math.sin(am) * dy), smooth)
    g.emit(kind)

def disc(kind, c, r, facing=1, segs=48):
    """A flat disc in the plane y = c.y facing +y (facing 1) or -y."""
    g = VBM()
    vs = [g.v((c[0] + math.cos(2 * PI * j / segs) * r, c[1], c[2] + math.sin(2 * PI * j / segs) * r),
              math.cos(2 * PI * j / segs) * r, math.sin(2 * PI * j / segs) * r) for j in range(segs)]
    g.f(vs, (0, facing, 0), False)
    g.emit(kind)

def quad_z(kind, x0, x1, y0, y1, zz):
    """A rectangle in the plane z = zz facing +z."""
    g = VBM()
    g.f([g.v((x0, y0, zz), x0, y0), g.v((x1, y0, zz), x1, y0), g.v((x1, y1, zz), x1, y1), g.v((x0, y1, zz), x0, y1)], (0, 0, 1), False)
    g.emit(kind)

def blob(kind, p, r, s=(1, 1, 1)):
    bm = bm_sphere(r, 8, 6)
    emit_uv(kind, bm, xf(p[0], p[1], p[2], s=s), smooth=lambda n: True)

def bead(kind, p0, p1, r=0.0045):
    """A weld bead: a lumpy, flattened tube from p0 to p1 with rounded ends."""
    a, b = Vector(p0), Vector(p1)
    L = (b - a).length
    k = max(3, int(L / (r * 1.6)))
    t = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(t.y) < 0.95 else Vector((1, 0, 0))
    Nn = (ref - t * ref.dot(t)).normalized()
    Bn = t.cross(Nn)
    g = VBM()
    sides = 6
    rings = []
    for i in range(k + 1):
        q = a + (b - a) * (i / k)
        rr = r * (0.85 + 0.3 * rng.random()) * (0.55 if i in (0, k) else 1.0)
        rings.append([g.v(q + (Nn * math.cos(2 * PI * j / sides) + Bn * math.sin(2 * PI * j / sides)) * rr, 2 * PI * j / sides * r, L * i / k) for j in range(sides + 1)])
    for i in range(k):
        for j in range(sides):
            am = 2 * PI * (j + 0.5) / sides
            g.f((rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]), Nn * math.cos(am) + Bn * math.sin(am), True)
    for ring, sgn in ((rings[0], -1), (rings[-1], 1)):
        c = [g.v(v.co, math.cos(2 * PI * j / sides) * r, math.sin(2 * PI * j / sides) * r) for j, v in enumerate(ring[:-1])]
        g.f(c, t * sgn, True)
    g.emit(kind)
    weld(((a + b) / 2).to_tuple(), max(0.015, L / 2 + 0.01))

# ---------------------------------------------------------------- the switch box
def build_box():
    with inpart('BOX'):
        # Body and door (the body's back is against the bars; never seen).
        bbox('k_paint', -W / 2, W / 2, -H / 2, H / 2, 0.0, D, bevel=0.006, seg=2, drop=('-z',))
        bbox('k_paint', -W / 2 + 0.006, W / 2 - 0.006, -H / 2 + 0.006, H / 2 - 0.006, D - 0.001, FACE, bevel=0.003, seg=1, drop=('-z',))
        # Rubber gasket just showing round the door.
        bbox('k_rubber', -W / 2 + 0.004, W / 2 - 0.004, -H / 2 + 0.004, H / 2 - 0.004, D - 0.002, D + 0.003, drop=('-z', '+z'))
        # Rain hood: a sloped sheet with a turned-down lip and cheeks.
        M = xf(0.0, H / 2 + 0.006, -0.004, rx=0.11)
        HD = D + 0.03
        bbox('k_paint', -W / 2 - 0.018, W / 2 + 0.018, 0.0, 0.006, 0.0, HD, bevel=0.002, M=M)
        M2 = M @ Matrix.Translation((0.0, 0.0, HD))
        bbox('k_paint', -W / 2 - 0.018, W / 2 + 0.018, -0.014, 0.006, -0.005, 0.0, bevel=0.002, M=M2)
        for s in (-1, 1):
            bbox('k_paint', s * (W / 2 + 0.013) - 0.0025, s * (W / 2 + 0.013) + 0.0025, -0.024, 0.0, 0.0, HD, bevel=0.0012, M=M)
        for x in (-0.12, -0.04, 0.04, 0.12):
            p = M @ Vector((x, 0.006, 0.03))
            cyl('k_bolt', p.to_tuple(), (p + Vector((0, 0.003, 0))).to_tuple(), 0.004, 8)
            rust(p.to_tuple(), (0, 1, 0), 0.6, 0.0)
        # Hinges on the left (barrel, a leaf on the door and one on the body), each with two screws.
        for y in (-0.105, 0.105):
            cyl('k_galv', (-W / 2 - 0.004, y - 0.026, D + 0.004), (-W / 2 - 0.004, y + 0.026, D + 0.004), 0.0072, 10)
            cyl('k_galv', (-W / 2 - 0.004, y + 0.026, D + 0.004), (-W / 2 - 0.004, y + 0.030, D + 0.004), 0.0042, 8)
            bbox('k_galv', -W / 2 + 0.004, -W / 2 + 0.034, y - 0.022, y + 0.022, FACE, FACE + 0.002, drop=('-z',))
            bbox('k_galv', -W / 2 - 0.002, -W / 2, y - 0.022, y + 0.022, D - 0.034, D + 0.002, drop=('+x',))
            for dy in (-0.012, 0.012):
                q = (-W / 2 + 0.024, y + dy, FACE + 0.002)
                cyl('k_bolt', q, (q[0], q[1], q[2] + 0.0018), 0.0032, 8)
                rust(q, (0, 0, 1), 0.8, 0.07)
            rust((-W / 2 - 0.004, y - 0.028, D + 0.004), (0, 0, 1), 1.2, 0.12)
        # Quarter-turn latch on the right.
        lx, ly = W / 2 - 0.032, 0.114
        cyl('k_galv', (lx, ly, FACE), (lx, ly, FACE + 0.006), 0.013, 16)
        bbox('k_galv', lx - 0.004, lx + 0.004, ly - 0.015, ly + 0.015, FACE + 0.006, FACE + 0.014, bevel=0.0015, drop=('-z',))
        rust((lx, ly - 0.013, FACE + 0.002), (0, 0, 1), 1.0, 0.1)
        # The switch plate, its screws, and a raised lip round each slot; the slot floor is dark.
        x0, x1, y0, y1 = PLATE
        bbox('k_bezel', x0, x1, y0, y1, FACE, FACE + PLATE_T, bevel=0.0015, drop=('-z',))
        for sx in (-1, 1):
            for sy in (-1, 1):
                q = (sx * 0.118, MIDY + sy * 0.088, FACE + PLATE_T)
                cyl('k_bolt', q, (q[0], q[1], q[2] + 0.0015), 0.0035, 10)
                rust(q, (0, 0, 1), 0.7, 0.06)
        zt = FACE + PLATE_T
        for j in range(3):
            x = (j - 1) * PITCH
            ow, oh, iw, ih = 0.015, 0.075, 0.007, 0.06
            bbox('k_lip', x - ow, x - iw, MIDY - oh, MIDY + oh, zt, zt + 0.003, bevel=0.0008, drop=('-z',))
            bbox('k_lip', x + iw, x + ow, MIDY - oh, MIDY + oh, zt, zt + 0.003, bevel=0.0008, drop=('-z',))
            bbox('k_lip', x - iw, x + iw, MIDY + ih, MIDY + oh, zt, zt + 0.003, bevel=0.0008, drop=('-z',))
            bbox('k_lip', x - iw, x + iw, MIDY - oh, MIDY - ih, zt, zt + 0.003, bevel=0.0008, drop=('-z',))
            quad_z('k_slot', x - iw, x + iw, MIDY - ih, MIDY + ih, zt + 0.0002)
        # Mounting ears on the box's sides, bolted to the flat bars.
        for sx in (-1, 1):
            for y in (-0.12, 0.12):
                xa, xb = sorted((sx * W / 2, sx * (BAR_X + BAR_W / 2)))
                bbox('k_paint', xa, xb, y - 0.018, y + 0.018, 0.0, 0.005, bevel=0.0015, drop=('-z',))
                q = (sx * BAR_X, y, 0.005)
                hexnut('k_bolt', q, (0, 0, 1), 0.0075, 0.005)
                rust(q, (0, 0, 1), 1.1, 0.1)
        # Flat bars from below the knee rail to over the top rail, with a strap round the top rail.
        for sx in (-1, 1):
            x = sx * BAR_X
            bbox('k_galv', x - BAR_W / 2, x + BAR_W / 2, KNEE - 0.04, TOPR + 0.028, -BAR_T, 0.0, bevel=0.001)
            # strap: over the rail and down its back, bolted through
            bbox('k_galv', x - 0.015, x + 0.015, TOPR + 0.025, TOPR + 0.029, -0.069, -BAR_T, bevel=0.001)
            bbox('k_galv', x - 0.015, x + 0.015, TOPR - 0.03, TOPR + 0.029, -0.069, -0.065, bevel=0.001)
            hexnut('k_bolt', (x, TOPR - 0.012, -0.069), (0, 0, -1), 0.0075, 0.006)
            # fillet welds down both edges where the bar meets the knee rail, and along the rail's top
            for ex in (-1, 1):
                bead('k_weld', (x + ex * (BAR_W / 2 + 0.002), KNEE - 0.021, -BAR_T - 0.003), (x + ex * (BAR_W / 2 + 0.002), KNEE + 0.021, -BAR_T - 0.003), 0.0042)
            bead('k_weld', (x - BAR_W / 2, KNEE + 0.022, -BAR_T - 0.004), (x + BAR_W / 2, KNEE + 0.022, -BAR_T - 0.004), 0.004)
            # brace from the bar down to the shelf's front, welded at both ends
            a = (x, KNEE + 0.05, 0.004)
            b = (x, -H / 2 - 0.02, D + 0.012)
            cyl('k_galv', a, b, 0.007, 8)
            blob('k_weld', a, 0.011, (1.0, 1.3, 0.8))
            blob('k_weld', b, 0.01, (1.0, 0.8, 1.2))
            weld(a, 0.02)
            weld(b, 0.02)
        # Shelf under the box, welded to the bars.
        bbox('k_galv', -BAR_X - 0.02, BAR_X + 0.02, -H / 2 - 0.012, -H / 2, 0.0, D + 0.022, bevel=0.0015)
        for sx in (-1, 1):
            bead('k_weld', (sx * BAR_X - 0.016, -H / 2 - 0.013, 0.002), (sx * BAR_X + 0.016, -H / 2 - 0.013, 0.002), 0.004)
        # Cable gland under the box and a conduit down to the deck, with a strap to the toe board's foot.
        cx, cz = CONDUIT
        hexnut('k_rubber', (cx, -H / 2 - 0.012, cz), (0, -1, 0), 0.019, 0.008)
        cyl('k_rubber', (cx, -H / 2 - 0.02, cz), (cx, -H / 2 - 0.042, cz), 0.015, 12, r1=0.012)
        cyl('k_galv', (cx, -H / 2 - 0.042, cz), (cx, DECK + 0.012, cz), 0.011, 10, caps=(False, False))
        cyl('k_galv', (cx, DECK + 0.012, cz), (cx, DECK, cz), 0.026, 12, caps=(False, True))
        for y in (-0.62, -0.88):
            bbox('k_galv', cx - 0.016, cx + 0.016, y - 0.008, y + 0.008, cz - 0.014, cz + 0.014, bevel=0.002)
            rust((cx, y - 0.008, cz + 0.014), (0, 0, 1), 0.6, 0.05)

def build_tags():
    for i in range(3):
        with inpart('TAG_%d' % i):
            x0, x1, y0, y1 = TAG
            bbox('k_tag%d' % i, x0, x1, y0, y1, FACE, FACE + 0.0025, bevel=0.0008, drop=('-z',))
            for sx in (-1, 1):
                q = (sx * 0.055, (y0 + y1) / 2, FACE + 0.0025)
                cyl('k_bolt', q, (q[0], q[1], q[2] + 0.0012), 0.0028, 8)
                rust(q, (0, 0, 1), 0.5, 0.03)

def build_slider():
    with inpart('SLIDER'):
        bbox('k_shank', -0.0055, 0.0055, -0.01, 0.01, -0.002, 0.010, drop=('-z',))
        bbox('k_grip', -0.021, 0.021, -0.015, 0.015, 0.008, 0.034, bevel=0.003, seg=2, drop=('-z',))
        bbox('k_grip', 0.021, 0.027, -0.002, 0.002, 0.011, 0.031, bevel=0.0008, drop=('-x',))       # index pointer
        for y in (-0.009, 0.0, 0.009):
            bbox('k_grip', -0.022, 0.022, y - 0.002, y + 0.002, 0.033, 0.037, bevel=0.0012, drop=('-z',))

# ---------------------------------------------------------------- the capacitor
def build_cap():
    with inpart('CAP'):
        # Backing channel: web against the lattice, flanges outward.
        bbox('k_chan', -CH_W / 2, CH_W / 2, CH_Y0, CH_Y1, 0.0, CH_T, bevel=0.001)
        for s in (-1, 1):
            xa, xb = sorted((s * CH_W / 2, s * (CH_W / 2 - CH_T)))
            bbox('k_chan', xa, xb, CH_Y0, CH_Y1, CH_T, CH_D, bevel=0.001, drop=('-z',))
        for y in (CH_Y0 + 0.08, CH_Y1 - 0.08):
            for s in (-1, 1):
                q = (s * 0.022, y, CH_T)
                hexnut('k_bolt', q, (0, 0, 1), 0.013, 0.01)
                rust(q, (0, 0, 1), 1.3, 0.35)
        c = (0.0, 0.0, CZ)
        # The can: aluminium base, a sleeve up the side and over the groove and shoulder, aluminium rim.
        lathe('k_alu', [(0.0, CY0 + 0.012), (0.33, CY0 + 0.006), (CR - 0.012, CY0), (CR - 0.002, CY0 + 0.004), (CR, CY0 + 0.018)], 48, c)
        lathe('k_sleeve', [(CR, CY0 + 0.018), (CR + 0.002, CY0 + 0.026), (CR + 0.002, CY1), (CR - 0.012, CY1 + 0.016), (CR - 0.012, CY1 + 0.026),
                           (CR + 0.002, CY1 + 0.042), (CR + 0.002, 1.105), (CR - 0.006, 1.125), (CR - 0.022, 1.136)], 48, c)
        lathe('k_alu', [(CR - 0.022, 1.136), (CR - 0.034, 1.144), (0.362, 1.146), (0.362, 1.14)], 48, c, smooth=True)
        # Phenolic terminal disc.
        lathe('k_phenolic', [(0.362, 1.14), (0.36, DISC_Y - 0.004), (0.356, DISC_Y)], 48, c)
        disc('k_phenolic', (0.0, DISC_Y, CZ), 0.356, 1, 48)
        # Screw terminals (+ at +x, - at -x): brass boss, washer, ring lug with its crimp barrel, nut, stud.
        for s in (1, -1):
            x = s * TERM_X
            b0 = (x, DISC_Y, CZ)
            cyl('k_brass', b0, (x, DISC_Y + 0.02, CZ), 0.05, 20, (False, True))
            cyl('k_brass', (x, DISC_Y + 0.02, CZ), (x, DISC_Y + 0.024, CZ), 0.036, 20, (False, True))
            cyl('k_brass', (x, DISC_Y + 0.024, CZ), (x, DISC_Y + 0.031, CZ), 0.031, 20, (False, True))
            bbox('k_brass', min(x, x + s * 0.05), max(x, x + s * 0.05), DISC_Y + 0.024, DISC_Y + 0.031, CZ - 0.016, CZ + 0.016, drop=())
            cyl('k_brass', (x + s * 0.045, DISC_Y + 0.0275, CZ), (x + s * 0.095, DISC_Y + 0.0275, CZ), 0.017, 12)
            hexnut('k_brass', (x, DISC_Y + 0.031, CZ), (0, 1, 0), 0.03, 0.022)
            cyl('k_bolt', (x, DISC_Y + 0.053, CZ), (x, DISC_Y + 0.075, CZ), 0.012, 12)
        # Pressure vent plug.
        cyl('k_vent', (0.0, DISC_Y, CZ + 0.2), (0.0, DISC_Y + 0.012, CZ + 0.2), 0.03, 16)
        cyl('k_vent', (0.0, DISC_Y + 0.012, CZ + 0.2), (0.0, DISC_Y + 0.018, CZ + 0.2), 0.022, 16)
        # Clamp bands on standoff brackets, each tightened by a bolt through two ears at the back.
        for yb in BAND_Y:
            prof = [(CR + 0.002, yb - BAND_H / 2), (CR + BAND_T, yb - BAND_H / 2), (CR + BAND_T, yb + BAND_H / 2), (CR + 0.002, yb + BAND_H / 2)]
            lathe('k_galv', prof, 48, c, smooth=False)
            zb = CZ - CR - BAND_T
            bbox('k_chan', -0.034, 0.034, yb - 0.035, yb + 0.035, CH_D, zb + 0.004, bevel=0.002, drop=())
            bead('k_weld', (-0.034, yb - 0.036, CH_D + 0.002), (0.034, yb - 0.036, CH_D + 0.002), 0.004)
            bead('k_weld', (-0.034, yb + 0.036, CH_D + 0.002), (0.034, yb + 0.036, CH_D + 0.002), 0.004)
            for s in (-1, 1):
                bbox('k_galv', s * 0.037 - 0.003, s * 0.037 + 0.003, yb - BAND_H / 2, yb + BAND_H / 2, zb - 0.024, zb + 0.012, bevel=0.001)
            cyl('k_bolt', (-0.062, yb, zb - 0.008), (0.062, yb, zb - 0.008), 0.007, 10)
            for s in (-1, 1):
                hexnut('k_bolt', (s * 0.04, yb, zb - 0.008), (s, 0, 0), 0.012, 0.009)
                rust((s * 0.049, yb - 0.012, zb - 0.008), (s, 0, 0), 1.2, 0.2)
            # the band's weep of rust down the sleeve at its back
            rust((0.0, yb - BAND_H / 2, CZ - CR - 0.002), (0, 0, -1), 0.6, 0.25)

# ---------------------------------------------------------------- the solar panel
def panel_matrix():
    n = Vector((0.0, math.cos(TILT), -math.sin(TILT)))
    v = Vector((0.0, math.sin(TILT), math.cos(TILT)))
    u = Vector((-1.0, 0.0, 0.0))            # (u, v, n) right-handed, so the panel's faces keep their winding
    c = Vector(PC)
    return Matrix(((u.x, v.x, n.x, c.x), (u.y, v.y, n.y, c.y), (u.z, v.z, n.z, c.z), (0, 0, 0, 1)))

def build_panel():
    with inpart('PANEL'):
        # Saddle on the rail and two U-bolts round it, nuts on top.
        bbox('k_galv', -0.035, 0.035, 0.0, 0.012, -0.034, 0.034, bevel=0.002)
        for x in (-0.024, 0.024):
            pts = [(x, 0.012, -0.03)]
            for k in range(13):
                a = PI * k / 12
                pts.append((x, -0.025 - math.sin(a) * 0.033, -0.03 * math.cos(a)))
            pts.append((x, 0.012, 0.03))
            tubel('k_galv', pts, 0.0035, 8)
            for z in (-0.03, 0.03):
                hexnut('k_bolt', (x, 0.012, z), (0, 1, 0), 0.0065, 0.006)
                rust((x, 0.012, z + (0.0065 if z > 0 else -0.0065)), (0, 0, 1 if z > 0 else -1), 0.9, 0.06)
        # Post up to the tilt hinge, and the hinge's ears and bolt under the panel.
        M = panel_matrix()
        hinge = M @ Vector((0.0, 0.0, -0.052))
        cyl('k_galv', (0.0, 0.012, 0.0), hinge.to_tuple(), 0.012, 4, a0=PI / 4, smooth=False)
        blob('k_weld', (0.0, 0.014, 0.0), 0.014, (1.2, 0.5, 1.2))
        weld((0.0, 0.014, 0.0), 0.025)
        for s in (-1, 1):
            e = M @ Vector((s * 0.016, 0.0, -0.035))
            bbox('k_galv', -0.003, 0.003, -0.02, 0.02, -0.03, 0.0, bevel=0.001, M=Matrix.Translation(e) @ M.to_3x3().to_4x4())
        cyl('k_bolt', (M @ Vector((-0.028, 0.0, -0.052))).to_tuple(), (M @ Vector((0.028, 0.0, -0.052))).to_tuple(), 0.005, 8)
        # The panel, built in its own plane (u across, v up the slope, n out of the glass) and tilted into place.
        hu, hv, fw = PW / 2, PL / 2, 0.018
        z0, z1 = -PT + 0.008, 0.004            # frame back and lip, relative to the glass
        bbox('k_cell', -hu + fw, hu - fw, -hv + fw, hv - fw, -0.004, 0.0, drop=('-z', '+x', '-x', '+y', '-y'), M=M)
        bbox('k_back', -hu + fw, hu - fw, -hv + fw, hv - fw, z0 + 0.004, z0 + 0.006, drop=('+z', '+x', '-x', '+y', '-y'), M=M)
        for (xa, xb, ya, yb) in ((-hu, hu, hv - fw, hv), (-hu, hu, -hv, -hv + fw), (-hu, -hu + fw, -hv + fw, hv - fw), (hu - fw, hu, -hv + fw, hv - fw)):
            bbox('k_frame', xa, xb, ya, yb, z0, z1, bevel=0.0015, M=M)
        # Junction box on the back, and its gland.
        jb = (0.0, 0.06, z0 - 0.012)
        bbox('k_jbox', -0.035, 0.035, 0.035, 0.085, z0 - 0.024, z0, bevel=0.003, M=M)
        g0 = M @ Vector((0.035, 0.06, z0 - 0.012))
        g1 = M @ Vector((0.05, 0.06, z0 - 0.012))
        cyl('k_rubber', g0.to_tuple(), g1.to_tuple(), 0.007, 10)
        PANEL_META['jbox'] = [g1.x, g1.y, g1.z]

PANEL_META = {}

# ---------------------------------------------------------------- occluders for the AO bake (never exported)
def build_occluders():
    ox, oy, oz = PIV['BOX']
    B('occ', 1.4, 0.05, 0.05, ox, oy + TOPR, oz - 0.04)
    B('occ', 1.4, 0.04, 0.04, ox, oy + KNEE, oz - 0.04)
    B('occ', 1.4, 0.1, 0.015, ox, oy + DECK + 0.05, oz - 0.04)
    B('occ', 1.4, 0.02, 0.8, ox, oy + DECK - 0.01, oz + 0.3)
    px, py, pz = PIV['PANEL']
    B('occ', 0.9, 0.05, 0.05, px, py - 0.025, pz)

def build_meta():
    empty('META', (0, 0, 0), swb=[W, H, D, FACE, MIDY, PITCH, TRAVEL], cap=[CR, CZ, CY0, DISC_Y, CH_Y0, CH_Y1, CH_D],
          termP=[TERM_X + 0.095, DISC_Y + 0.0275, CZ], termN=[-TERM_X - 0.095, DISC_Y + 0.0275, CZ],
          jbox=PANEL_META.get('jbox', [0, 0, 0]), parts=PARTS)

def build_all():
    t0 = time.time()
    RUST.clear()
    WELDS.clear()
    PBOX.clear()
    rng.seed(1987)
    build_box()
    build_tags()
    build_slider()
    build_cap()
    build_panel()
    build_occluders()
    build_meta()
    stats = realize()
    sc = _scene()
    col = sc.objects.get('COLLIDER')
    if col is not None:
        bpy.data.objects.remove(col, do_unlink=True)
    for ob in sc.objects:
        if ob.type == 'MESH' and mat_of(ob) == 'occ':
            ob['noexport'] = 1
    show_scene()
    tris = {}
    for ob in sc.objects:
        if ob.type == 'MESH' and not ob.get('noexport'):
            k = ob.parent.name if ob.parent else ob.name
            tris[k] = tris.get(k, 0) + sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return {'materials': stats, 'tris': tris, 'rust': len(RUST), 'welds': len(WELDS), 'seconds': round(time.time() - t0, 1)}

# ============================================================================ atlas + G-buffer
def mat_of(ob):
    return ob.data.materials[0].name[len(PREFIX):] if ob.type == 'MESH' and ob.data.materials else ''

def targets():
    return [ob for ob in _scene().objects if ob.type == 'MESH' and mat_of(ob) in KIND and ob.parent is not None]

def pack_atlas(objs, margin=0.004):
    """Scale each object's metric UVs by its part's density and pack every island into one square. Returns
    atlas units per metre at density 1. Each object's pass index carries its part and density for the G-buffer."""
    import numpy as np
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    for ob in objs:
        pn = ob.parent.name
        d = DENS[pn]
        ob.pass_index = PARTS.index(pn) * 128 + int(round(d * 100))
        me = ob.data
        buf = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers['UVMap'].data.foreach_get('uv', buf)
        me.uv_layers['UVMap'].data.foreach_set('uv', buf * d)
    def uv_area(ob):
        uv = np.empty(len(ob.data.loops) * 2, dtype=np.float32)
        ob.data.uv_layers['UVMap'].data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        a = 0.0
        for poly in ob.data.polygons:
            q = uv[list(poly.loop_indices)]
            a += 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(q[:, 1], np.roll(q[:, 0], -1)))
        return a
    ref = max(objs, key=lambda o: sum(p.area for p in o.data.polygons))
    a0 = uv_area(ref)
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', scale=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')
    return float(math.sqrt(uv_area(ref) / max(1e-12, a0)))

def _clear_nodes(m):
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return nt, nt.nodes.new('ShaderNodeOutputMaterial')

def _game_vec(nt, v):
    sep = node(nt, 'ShaderNodeSeparateXYZ', Vector=v)
    return node(nt, 'ShaderNodeCombineXYZ', X=sep.outputs['X'], Y=sep.outputs['Z'], Z=math_node(nt, 'MULTIPLY', sep.outputs['Y'], -1.0)).outputs[0]

def _vmul(nt, v, k):
    return node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=v, i1=k).outputs[0]

def _noise(nt, v, scale, detail=4.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '3D'}, Vector=v, Scale=scale, Detail=detail,
                Roughness=rough, Distortion=distort).outputs['Fac']

def _pass_color(nt, which, mname):
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    gp = _game_vec(nt, geo.outputs['Position'])
    if which == 'P':
        return node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY_ADD'}, i0=gp, i1=(0.125, 0.125, 0.125), i2=(0.5, 0.5, 0.5)).outputs[0]
    if which == 'N':
        gn = _game_vec(nt, geo.outputs['True Normal'])
        return node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY_ADD'}, i0=gn, i1=(0.5, 0.5, 0.5), i2=(0.5, 0.5, 0.5)).outputs[0]
    if which == 'K':
        oi = nt.nodes.new('ShaderNodeObjectInfo')
        return node(nt, 'ShaderNodeCombineXYZ', X=KIND.get(mname, 0) / 64.0, Y=math_node(nt, 'DIVIDE', oi.outputs['Object Index'], 1024.0), Z=0.0).outputs[0]
    if which == 'A':
        # streaks (tall, thin), mottle, blotches
        a = _noise(nt, _vmul(nt, gp, (90.0, 2.0, 90.0)), 1.0, 3.0, 0.5)
        b = _noise(nt, gp, 60.0, 6.0, 0.55)
        c = _noise(nt, gp, 7.0, 4.0, 0.6)
        return node(nt, 'ShaderNodeCombineXYZ', X=a, Y=b, Z=c).outputs[0]
    if which == 'B':
        v = node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '3D', 'feature': 'F1'}, Vector=gp, Scale=160.0).outputs['Distance']
        f = _noise(nt, gp, 180.0, 4.0, 0.6)
        g = _noise(nt, gp, 22.0, 8.0, 0.62, 0.5)
        return node(nt, 'ShaderNodeCombineXYZ', X=v, Y=f, Z=g).outputs[0]
    if which == 'E':
        # Convex and concave edges: how far a bevelled normal (three radii) leans off the true one.
        tn = geo.outputs['True Normal']
        outs = []
        for r in (0.0025, 0.006, 0.02):
            bv = node(nt, 'ShaderNodeBevel', props={'samples': 16}, Radius=r)
            dp = node(nt, 'ShaderNodeVectorMath', props={'operation': 'DOT_PRODUCT'}, i0=bv.outputs['Normal'], i1=tn).outputs['Value']
            outs.append(math_node(nt, 'SUBTRACT', 1.0, dp))
        return node(nt, 'ShaderNodeCombineXYZ', X=outs[0], Y=outs[1], Z=outs[2]).outputs[0]
    raise ValueError(which)

def bake_emit(objs, size, which, margin=0, samples=1):
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    img = bpy.data.images.get('DB_gbuf')
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new('DB_gbuf', size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    for m in {s.material for ob in objs for s in ob.material_slots if s.material}:
        nt, out = _clear_nodes(m)
        c = _pass_color(nt, which, m.name[len(PREFIX):])
        em = node(nt, 'ShaderNodeEmission', Color=c, Strength=1.0)
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img
        nt.nodes.active = tn
    _cycles(sc, samples)
    sc.cycles.use_denoising = False
    sc.cycles.filter_width = 0.01 if samples == 1 else 1.5      # point-sampled (ids must not blend across islands)
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.bake(type='EMIT', margin=margin, use_clear=True, target='IMAGE_TEXTURES')
    sc.cycles.filter_width = 1.5
    return _np_image(img)[:, :, :3].copy()

def gbuffer(objs, size):
    """Per-texel position, face normal, kind/part/density, edges and noises (Blender orientation: row 0 at the bottom).
    Everything is baked without a margin (one object's margin would overwrite another's islands in the shared image);
    paint() dilates its results into the gutters instead."""
    import numpy as np
    out = {}
    for w in ('P', 'N', 'K', 'A', 'B'):
        t0 = time.time()
        out[w] = bake_emit(objs, size, w).astype(np.float32)
        print('KIT pass', w, round(time.time() - t0, 1), 's')
    t0 = time.time()
    out['E'] = bake_emit(objs, size, 'E', samples=4 if QUICK else 8).astype(np.float32)
    print('KIT pass E', round(time.time() - t0, 1), 's')
    out['P'] = (out['P'] - 0.5) * 8.0
    out['N'] = out['N'] * 2.0 - 1.0
    out['cover'] = (out['K'][:, :, 0] > 0.0).astype(np.float32)
    return out

def bake_ao_atlas(objs, size, samples, distance):
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    img = bpy.data.images.get('DB_ao')
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new('DB_ao', size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
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
        bpy.ops.object.bake(type='AO', margin=0, use_clear=True, target='IMAGE_TEXTURES')
    return _np_image(img)[:, :, :3].mean(axis=2)

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
    out = {}
    os.makedirs(CACHE, exist_ok=True)
    objs = targets()
    s = pack_atlas(objs)
    S = 1024 if QUICK else 2048
    out['px_per_m'] = round(s * S, 1)
    t1 = time.time()
    G = gbuffer(objs, S)
    out['gbuffer_s'] = round(time.time() - t1, 1)
    t1 = time.time()
    G['ao'] = bake_ao_atlas(objs, S // 2, 32 if QUICK else 160, 0.12).astype(np.float32)
    G['cav'] = bake_ao_atlas(objs, S // 2, 32 if QUICK else 128, 0.015).astype(np.float32)
    out['ao_s'] = round(time.time() - t1, 1)
    np.savez_compressed(os.path.join(CACHE, 'gbuf.npz'), **G, px=s * S)
    with open(os.path.join(CACHE, 'sources.json'), 'w') as f:
        json.dump({'rust': RUST, 'welds': WELDS, 'pbox': PBOX}, f)
    paint(G, s * S)
    plain_materials()
    for ob in _scene().objects:
        if ob.type == 'MESH':
            for ca in list(ob.data.color_attributes):
                ob.data.color_attributes.remove(ca)
    out['seconds'] = round(time.time() - t0, 1)
    return out

def paint_only():
    """Repaint the textures from the cached G-buffer (KIT_PAINT=1): no rebuild, no rebake, no export."""
    import numpy as np, json
    G = dict(np.load(os.path.join(CACHE, 'gbuf.npz')))
    src = json.load(open(os.path.join(CACHE, 'sources.json')))
    RUST[:] = [tuple(tuple(x) if isinstance(x, list) else x for x in r) for r in src['rust']]
    WELDS[:] = [tuple(tuple(x) if isinstance(x, list) else x for x in w) for w in src['welds']]
    PBOX[:] = [tuple(b) for b in src.get('pbox', [])]
    paint(G, float(G['px']))
    return {'painted': True}

# ============================================================================ painting (numpy)
def _ss(a, b, x):
    import numpy as np
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)

def _mixc(col, c, t):
    import numpy as np
    return col + (np.asarray(c, dtype=np.float32) - col) * t[..., None]

def _boxblur(a, r, axis):
    import numpy as np
    n = a.shape[axis]
    c = np.cumsum(a, axis=axis, dtype=np.float64)
    zero = np.zeros_like(np.take(c, [0], axis=axis))
    c = np.concatenate([zero, c], axis=axis)
    hi = np.clip(np.arange(n) + r + 1, 0, n)
    lo = np.clip(np.arange(n) - r, 0, n)
    shp = [1] * a.ndim
    shp[axis] = n
    return ((np.take(c, hi, axis=axis) - np.take(c, lo, axis=axis)) / (hi - lo).reshape(shp)).astype(np.float32)

def _srgb(a):
    import numpy as np
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)

def _normal_map(h, mpt):
    """Tangent-space normal (OpenGL convention, Blender's UV orientation) from a height field in metres; mpt = metres per
    texel. The game flips green (normalScale.y = -1) for its glTF UVs."""
    import numpy as np
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * mpt)
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) / (2 * mpt)
    n = np.stack([-dx, -dy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def _dilate(a, m, n=24):
    """Grow the covered texels (mask m) of a (HxW or HxWxC) out into the gutters, n texels, averaging neighbours."""
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

def _box_edge(x, y, z, boxes, tol=0.0025):
    """Distance along the surface to the nearest edge of whichever of the boxes the point lies on (9 if none)."""
    import numpy as np
    d = np.full(x.shape, 9.0, np.float32)
    for (Mi, x0, x1, y0, y1, z0, z1) in boxes:
        if Mi is None:
            qx, qy, qz = x, y, z
        else:
            qx = Mi[0][0] * x + Mi[0][1] * y + Mi[0][2] * z + Mi[0][3]
            qy = Mi[1][0] * x + Mi[1][1] * y + Mi[1][2] * z + Mi[1][3]
            qz = Mi[2][0] * x + Mi[2][1] * y + Mi[2][2] * z + Mi[2][3]
        dd = np.stack([np.minimum(qx - x0, x1 - qx), np.minimum(qy - y0, y1 - qy), np.minimum(qz - z0, z1 - qz)])
        inside = (dd > -tol).all(axis=0)
        srt = np.sort(np.abs(dd), axis=0)
        ok = inside & (srt[0] < tol)
        d = np.where(ok, np.minimum(d, srt[1]), d)
    return d

def _up(a, H):
    """A half-resolution map up to full resolution."""
    import numpy as np
    if a.shape[0] == H:
        return a
    k = H // a.shape[0]
    return np.kron(a, np.ones((k, k), np.float32))

def paint(G, px_per_m):
    import numpy as np
    P, N, K, A, B, E = G['P'], G['N'], G['K'], G['A'], G['B'], G['E']
    H, Wd = P.shape[:2]
    kind = np.rint(K[..., 0] * 64).astype(np.int32)
    pidx = np.rint(K[..., 1] * 1024).astype(np.int32)
    part = pidx // 128
    dens = np.clip((pidx % 128) / 100.0, 0.05, 1.0)
    mpt = 1.0 / (px_per_m * dens)
    piv = np.array([PIV[p] for p in PARTS], np.float32)
    L = P - piv[np.clip(part, 0, len(PARTS) - 1)]
    x, y, z = L[..., 0], L[..., 1], L[..., 2]
    nx, ny, nz = N[..., 0], N[..., 1], N[..., 2]
    sA, mA, bA = A[..., 0], A[..., 1], A[..., 2]
    vB, fB, gB = B[..., 0], B[..., 1], B[..., 2]
    e1, e2, e3 = E[..., 0], E[..., 1], E[..., 2]
    cover = G['cover'] > 0
    hr = lambda a: a.reshape(H // 2, 2, Wd // 2, 2).mean(axis=(1, 3))
    cover_h = hr(cover.astype(np.float32)) > 0.2
    aoh = _blur(_dilate(G['ao'], cover_h, 8), (1, 2, 1))
    ao = np.clip(_up(aoh, H), 0, 1)
    cav = np.clip(_up(_blur(_dilate(G['cav'], cover_h, 8), (1, 2, 1)), H), 0, 1)
    K_ = lambda n: kind == KIND[n]
    paint_, galv, weldk, bezel, slot, lip = K_('k_paint'), K_('k_galv'), K_('k_weld'), K_('k_bezel'), K_('k_slot'), K_('k_lip')
    grip, shank, rubber, boltk = K_('k_grip'), K_('k_shank'), K_('k_rubber'), K_('k_bolt')
    sleeve, alu, phen, brass, chan, vent = K_('k_sleeve'), K_('k_alu'), K_('k_phenolic'), K_('k_brass'), K_('k_chan'), K_('k_vent')
    cell, frame, back, jbox = K_('k_cell'), K_('k_frame'), K_('k_back'), K_('k_jbox')
    tags = [K_('k_tag%d' % i) for i in range(3)]
    tag = tags[0] | tags[1] | tags[2]
    f32 = lambda m: m.astype(np.float32)
    vert = f32(np.abs(ny) < 0.5)
    top = f32(ny > 0.7)
    # convex edges (the bevel leans off the face while the cavity AO stays open) and concave creases
    convex = np.clip(e2 * 3.5, 0, 1) * _ss(0.55, 0.85, cav)
    fine_edge = np.clip(e1 * 4.0, 0, 1) * _ss(0.55, 0.85, cav)
    crease = 1.0 - _ss(0.35, 0.8, cav)

    alb = np.zeros((H, Wd, 3), np.float32)
    rough = np.full((H, Wd), 0.6, np.float32)
    metal = np.zeros((H, Wd), np.float32)
    hgt = np.zeros((H, Wd), np.float32)

    def base(mask, col, r, m, var=0.08):
        k = 1.0 + var * (mA - 0.5) * 2 + var * 0.6 * (bA - 0.5)
        alb[mask] = np.asarray(col, np.float32)[None, :] * k[mask][:, None]
        rough[mask] = r if np.isscalar(r) else r[mask]
        metal[mask] = m

    # ---- bare metals first: they show through wherever a coating wears away
    steel_c = np.array([0.30, 0.295, 0.285], np.float32)
    rust_c = np.array([0.23, 0.085, 0.03], np.float32)
    rust_dk = np.array([0.09, 0.035, 0.015], np.float32)
    grime_c = np.array([0.045, 0.04, 0.032], np.float32)
    # galvanised: dull zinc with spangle, white rust in the hollows, red rust on the edges
    spang = _ss(0.1, 0.35, vB) * 0.5 + 0.5
    base(galv, [0.17, 0.172, 0.176], 0.55, 0.8, 0.14)
    alb[galv] *= (0.85 + 0.3 * spang[galv])[:, None]
    rough[galv] = (0.5 + 0.2 * (1 - spang) + 0.12 * (mA - 0.5))[galv]
    wr = galv * np.clip(crease * 0.8 + _ss(0.55, 0.75, bA) * 0.5, 0, 1) * _ss(0.3, 0.6, fB + 0.3 * crease)
    alb = _mixc(alb, [0.34, 0.34, 0.32], wr * 0.7)
    rough = rough + (0.9 - rough) * wr
    metal = metal * (1 - wr * 0.85)
    hgt += wr * 6e-5 * fB
    # weld metal: dark, lumpy, rust-spotted
    base(weldk, [0.16, 0.15, 0.14], 0.75, 0.7, 0.2)
    hgt += weldk * (np.sin(fB * 40.0) * 1.5e-4 + mA * 2e-4)
    base(boltk, [0.22, 0.22, 0.225], 0.55, 0.8, 0.1)
    base(shank, [0.42, 0.42, 0.42], 0.35, 1.0, 0.05)
    base(rubber, [0.022, 0.022, 0.024], 0.8, 0.0, 0.1)
    hgt += rubber * (mA - 0.5) * 4e-5

    # ---- the box's enamel: a faded grey-green, chalky up top, chipped along its edges and corners
    ec = np.array([0.085, 0.112, 0.090], np.float32)
    base(paint_, ec, 0.55, 0.0, 0.14)
    chalk = paint_ * np.clip(top * 0.7 + _ss(-0.05, 0.2, y) * 0.35, 0, 1) * (0.5 + 0.5 * bA)
    alb = _mixc(alb, [0.21, 0.23, 0.20], chalk * 0.5)
    # rain: dark runs down every upright face from under the hood and the top edge, some rust-tinted
    rrun = paint_ * vert * _ss(0.45, 0.72, _boxblur(sA, 2, 1)) * _ss(-0.2, 0.14, y + (fB - 0.5) * 0.1) * (0.6 + 0.5 * gB)
    rrun = np.clip(rrun, 0, 1)
    alb = _mixc(alb, [0.03, 0.028, 0.022], rrun * 0.75)
    alb = _mixc(alb, [0.12, 0.06, 0.03], rrun * _ss(0.6, 0.8, bA) * 0.5)
    rough = rough + (0.8 - rough) * rrun * 0.5
    rough = rough + (0.85 - rough) * chalk
    hgt += paint_ * (mA - 0.5) * 3e-5                              # orange peel
    chip_n = mA * 0.6 + fB * 0.4
    ped = np.full((H, Wd), 9.0, np.float32)
    pm = paint_ & (part == 0)
    if PBOX and pm.any():
        ped[pm] = _box_edge(x[pm], y[pm], z[pm], PBOX)
    band = 0.006 + 0.022 * _ss(0.3, 0.75, bA)                    # some edges barely touched, some eaten well in
    edge = np.clip(_ss(band, 0.0, ped) * 0.8 + convex * 0.6, 0, 1)
    chip = _ss(0.6, 0.72, edge * 0.75 + chip_n * 0.5) * paint_
    # the corners get the worst of it
    corner = pm * _ss(0.05, 0.0, np.hypot(np.abs(x) - W / 2, np.abs(y) - H / 2))
    chip = np.clip(chip + _ss(0.5, 0.65, corner * 0.6 + chip_n * 0.5) * pm, 0, 1)
    # scattered chips on the door face (knocks, tools) and scratches round the latch
    knock = paint_ * _ss(0.86, 0.9, gB * 0.9 + mA * 0.4) * f32(nz > 0.9)
    chip = np.clip(chip + knock, 0, 1)
    halo = np.clip(_boxblur(_boxblur(chip, 3, 0), 3, 1) * 2.5, 0, 1) * paint_ * (1 - chip)   # rust creeping under the paint
    alb = _mixc(alb, rust_c * 0.9, halo * 0.45)
    core = chip * _ss(0.4, 0.7, fB)                                 # bright steel at the fresh ones, rust at the old
    alb = _mixc(alb, rust_c, chip * (1 - core))
    alb = _mixc(alb, steel_c, core)
    rough = rough + (0.8 - rough) * chip * (1 - core) - 0.2 * core
    metal = metal + (1 - metal) * core * 0.9
    hgt -= chip * 8e-5

    # ---- tags: enamel in the LED's colour, crazed and chipped
    tag_cols = [[0.02, 0.28, 0.07], [0.62, 0.36, 0.015], [0.48, 0.03, 0.015]]
    for i, m in enumerate(tags):
        base(m, tag_cols[i], 0.3, 0.0, 0.06)
    tfade = tag * (0.3 + 0.4 * _ss(0.3, 0.8, bA))
    alb = alb * (1 - 0.25 * tfade)[..., None] + np.array([0.12, 0.12, 0.11], np.float32) * (0.25 * tfade)[..., None]
    tx0, tx1, ty0, ty1 = TAG
    tedge = np.minimum(np.minimum(x - tx0, tx1 - x), np.minimum(y - ty0, ty1 - y))
    tchip = tag * f32(nz > 0.9) * _ss(0.62, 0.72, _ss(0.006, 0.0, tedge) * 0.6 + mA * 0.35 + fB * 0.2)
    tchip = np.maximum(tchip, tag * f32(nz <= 0.9) * _ss(0.5, 0.7, mA))
    alb = _mixc(alb, [0.03, 0.03, 0.03], tchip)
    rough = rough + (0.7 - rough) * tchip

    # ---- the switch plate: black enamel rubbed through round the slots, notches in white paint
    base(bezel, [0.035, 0.035, 0.036], 0.45, 0.0, 0.08)
    base(lip, [0.30, 0.30, 0.30], 0.35, 1.0, 0.1)
    base(slot, [0.012, 0.012, 0.012], 0.9, 0.0, 0.2)
    dslot = np.full((H, Wd), 9.0, np.float32)
    for j in range(3):
        sx = (j - 1) * PITCH
        dslot = np.minimum(dslot, np.maximum(np.abs(x - sx) - 0.015, np.abs(y - MIDY) - 0.075))
    bz = bezel | lip
    rub = bz * _ss(0.006, 0.0, dslot + (mA - 0.5) * 0.006) * _ss(0.4, 0.65, fB * 0.5 + sA * 0.5 + 0.2)
    px0, px1, py0, py1 = PLATE
    pedge = np.minimum(np.minimum(x - px0, px1 - x), np.minimum(y - py0, py1 - y))
    rub = np.clip(rub + bezel * _ss(0.004, 0.0, pedge) * _ss(0.4, 0.6, fB), 0, 1) * bz * 0.85
    alb = _mixc(alb, steel_c * 1.1, rub * bezel)
    rough = rough + (0.3 - rough) * rub * bezel
    metal = metal + (1 - metal) * rub * bezel
    # vertical scuffs along each slot where fingers push the grips
    for j in range(3):
        sx = (j - 1) * PITCH
        sc = bezel * _ss(0.02, 0.008, np.abs(x - sx)) * _ss(0.09, 0.05, np.abs(y - MIDY)) * _ss(0.5, 0.8, sA) * 0.6
        alb = _mixc(alb, steel_c, sc)
        metal = metal + (1 - metal) * sc
    # notches: white ticks right of each slot at top, centre and bottom (the centre one longer)
    tick = np.zeros((H, Wd), np.float32)
    for j in range(3):
        sx = (j - 1) * PITCH
        for k in (-1, 0, 1):
            ln = 0.016 if k == 0 else 0.010
            tick = np.maximum(tick, f32((x > sx + 0.019) & (x < sx + 0.019 + ln) & (np.abs(y - (MIDY + k * TRAVEL)) < 0.0028)))
    tick *= bezel * f32(nz > 0.9) * (1 - _ss(0.72, 0.9, fB * 0.6 + mA * 0.6))    # worn patchy
    alb = _mixc(alb, [0.62, 0.60, 0.54], tick)
    rough = rough + (0.6 - rough) * tick
    metal = metal * (1 - tick)
    hgt += tick * 3e-5

    # ---- the slider grips: orange enamel worn to steel on the ribs and edges, a white index pointer
    base(grip, [0.55, 0.13, 0.025], 0.45, 0.0, 0.06)
    gw = grip * _ss(0.55, 0.75, np.clip(e1 * 2.0, 0, 1) * 0.6 + fB * 0.45)
    ptr = grip * f32(x > 0.0205)
    alb = _mixc(alb, [0.7, 0.68, 0.62], ptr)
    alb = _mixc(alb, steel_c * 1.2, gw * (1 - ptr))
    metal = metal + (1 - metal) * gw * (1 - ptr)
    rough = rough + (0.3 - rough) * gw * (1 - ptr)

    # ---- the capacitor: a navy sleeve, sun-faded and streaked, with a pale polarity stripe of dashes on the - side;
    # aluminium ends gone chalky with oxide; a phenolic disc with + and - moulded in; brass terminals tarnished green.
    ang = np.arctan2(x, z - CZ)                                     # 0 facing out from the tower
    base(sleeve, [0.009, 0.013, 0.03], 0.42, 0.0, 0.1)
    stripe_a = -0.75                                                # the - side, turned out toward the viewer
    da = np.abs(np.angle(np.exp(1j * (ang - stripe_a))))
    stripe = sleeve * _ss(0.2, 0.185, da) * f32((y > CY0 + 0.03) & (y < CY1))
    dash = stripe * _ss(0.11, 0.1, da) * f32(np.abs(((y - CY0) / 0.16) % 1.0 - 0.5) < 0.07)
    alb = _mixc(alb, [0.24, 0.25, 0.25], stripe)
    alb = _mixc(alb, [0.02, 0.025, 0.04], dash)
    # sun on the top half and on the side facing out: faded and chalky
    sun = sleeve * np.clip(_ss(0.2, 1.1, y) * 0.6 + _ss(-0.3, 1.0, np.cos(ang)) * 0.3, 0, 1) * (0.6 + 0.4 * bA)
    alb = _mixc(alb, [0.05, 0.055, 0.07], sun * 0.55)
    rough = rough + (0.75 - rough) * sun
    # grime running down from the shoulder and the bands, heaviest in streaks
    streak = _ss(0.55, 0.8, _boxblur(sA, 2, 1)) * (0.4 + 0.6 * _ss(0.3, 0.7, fB))
    run = sleeve * streak * np.clip(_ss(0.2, 1.05, y) + 0.5 * _ss(0.2, 0.0, np.minimum(np.abs(y - (BAND_Y[0] - 0.03)), np.abs(y - (BAND_Y[1] - 0.03)))), 0, 1)
    alb = _mixc(alb, grime_c, run * 0.6)
    rough = rough + (0.85 - rough) * run * 0.6
    # the sleeve lifting at its bottom edge, bare aluminium showing through tears
    peel = sleeve * _ss(CY0 + 0.12, CY0 + 0.03, y + (mA - 0.5) * 0.08) * _ss(0.45, 0.6, gB + 0.2)
    alb = _mixc(alb, [0.42, 0.42, 0.41], peel)
    metal = metal + (1 - metal) * peel
    rough = rough + (0.5 - rough) * peel
    hgt += sleeve * ((fB - 0.5) * 2e-5 + peel * 2e-4) + sleeve * _ss(0.6, 0.9, _boxblur(sA, 1, 0)) * 3e-5
    base(alu, [0.26, 0.26, 0.255], 0.5, 1.0, 0.06)
    ox = alu * np.clip(_ss(0.5, 0.75, mA * 0.6 + vB * 0.8) + crease * 0.6, 0, 1)
    alb = _mixc(alb, [0.45, 0.45, 0.43], ox * 0.8)
    rough = rough + (0.9 - rough) * ox
    metal = metal * (1 - ox * 0.8)
    hgt += alu * (np.sin(np.hypot(x, z - CZ) * 900.0) * 1e-5 + ox * 6e-5)       # spun rings, oxide crust
    base(phen, [0.045, 0.028, 0.018], 0.55, 0.0, 0.1)
    rx_, rz_ = x, z - CZ
    plus = f32(((np.abs(rx_ - TERM_X) < 0.022) & (np.abs(rz_ + 0.11) < 0.005)) | ((np.abs(rx_ - TERM_X) < 0.005) & (np.abs(rz_ + 0.11) < 0.022)))
    minus = f32((np.abs(rx_ + TERM_X) < 0.022) & (np.abs(rz_ + 0.11) < 0.005))
    mark = phen * f32(ny > 0.9) * np.clip(plus + minus, 0, 1)
    alb = _mixc(alb, [0.5, 0.48, 0.42], mark * (0.7 + 0.3 * mA))
    hgt += mark * 2e-4
    dust = phen * f32(ny > 0.9) * _ss(0.3, 0.7, bA) * 0.5
    alb = _mixc(alb, [0.16, 0.14, 0.11], dust)
    rough = rough + (0.9 - rough) * dust
    base(brass, [0.42, 0.30, 0.12], 0.4, 1.0, 0.08)
    verd = brass * np.clip(crease * 1.2 + _ss(0.55, 0.8, mA) * 0.6, 0, 1)
    alb = _mixc(alb, [0.16, 0.30, 0.24], verd * 0.8)
    alb = _mixc(alb, [0.12, 0.09, 0.05], brass * _ss(0.4, 0.7, bA) * 0.6)     # dark tarnish
    rough = rough + (0.85 - rough) * verd
    metal = metal * (1 - verd * 0.9)
    base(vent, [0.28, 0.035, 0.02], 0.7, 0.0, 0.1)
    # the channel and brackets: the tower's own dark paint, rust bleeding through
    base(chan, [0.075, 0.075, 0.078], 0.6, 0.3, 0.1)
    cchip = chan * _ss(0.5, 0.7, np.clip(convex * 1.2 + fine_edge, 0, 1) * 0.8 + mA * 0.5)
    crust = chan * np.clip(cchip + _ss(0.62, 0.8, bA * 0.7 + gB * 0.5) * 0.8, 0, 1)
    alb = _mixc(alb, rust_c, crust)
    rough = rough + (0.85 - rough) * crust
    metal = metal * (1 - crust)
    hgt += crust * (gB - 0.3) * 3e-4

    # ---- the solar panel: blue polycrystalline cells with silver busbars behind glass, dust along the low edge
    base(cell, [0.022, 0.036, 0.085], 0.06, 0.0, 0.0)
    Mi = panel_matrix().inverted()
    # cell coordinates in the panel plane (u across, v up the slope)
    pu = Mi[0][0] * x + Mi[0][1] * y + Mi[0][2] * z + Mi[0][3]
    pv = Mi[1][0] * x + Mi[1][1] * y + Mi[1][2] * z + Mi[1][3]
    ncol, nrow = 4, 3
    cw = (PW - 0.036 - 0.004) / ncol
    chh = (PL - 0.036 - 0.004) / nrow
    cu = (pu + (PW - 0.036) / 2 - 0.002) / cw
    cv = (pv + (PL - 0.036) / 2 - 0.002) / chh
    fu, fv = cu - np.floor(cu), cv - np.floor(cv)
    inside = cell * f32((cu > 0) & (cu < ncol) & (cv > 0) & (cv < nrow))
    gap = cell * np.clip(f32((fu < 0.03) | (fu > 0.97) | (fv < 0.03) | (fv > 0.97)) + (1 - inside), 0, 1)
    flake = _ss(0.0, 0.25, vB) * 0.5 + 0.5 * mA
    ccol = np.array([0.028, 0.05, 0.13], np.float32)
    alb = np.where(cell[..., None], ccol[None, None, :] * (0.75 + 0.5 * flake)[..., None], alb)
    bus = inside * (1 - gap) * f32((np.abs(fu - 0.33) < 0.012) | (np.abs(fu - 0.67) < 0.012))
    alb = _mixc(alb, [0.5, 0.5, 0.5], bus * 0.85)
    alb = _mixc(alb, [0.55, 0.55, 0.53], gap * 0.9)
    edge_v = pv + PL / 2                                           # height above the low (deck-side) edge
    pdust = cell * np.clip(_ss(0.06, 0.0, edge_v - 0.018) * 0.9 + _ss(0.5, 0.8, bA * 0.6 + gB * 0.5) * 0.35 + _ss(0.02, 0.0, (PW / 2 - 0.018) - np.abs(pu)) * 0.25, 0, 1)
    alb = _mixc(alb, [0.22, 0.20, 0.16], pdust * 0.7)
    rough = rough + (0.7 - rough) * pdust
    spots = cell * _ss(0.78, 0.84, gB * 0.5 + vB * 0.8) * 0.6
    alb = _mixc(alb, [0.3, 0.29, 0.26], spots)
    rough = rough + (0.6 - rough) * spots
    base(frame, [0.30, 0.30, 0.31], 0.42, 1.0, 0.06)
    fgr = frame * np.clip(crease * 0.9 + _ss(0.5, 0.8, bA) * 0.4, 0, 1)
    alb = _mixc(alb, grime_c * 2.0, fgr * 0.6)
    rough = rough + (0.8 - rough) * fgr
    metal = metal * (1 - fgr * 0.7)
    base(back, [0.55, 0.55, 0.52], 0.7, 0.0, 0.1)
    alb = _mixc(alb, grime_c * 3, back * _ss(0.4, 0.8, bA) * 0.5)
    base(jbox, [0.03, 0.03, 0.032], 0.6, 0.0, 0.1)

    # ---- welds: heat-tint rings on the metal round them (straw to blue), rust on the bead
    for (pi_, p, r) in WELDS:
        m = (part == pi_) & ~weldk
        d = np.sqrt((x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2)
        t = m * _ss(r * 1.4, r * 0.4, d)
        if not t.any():
            continue
        alb = _mixc(alb, [0.26, 0.19, 0.09], t * 0.5 * (galv | chan))
        alb = _mixc(alb, [0.07, 0.08, 0.14], t * _ss(0.6, 0.9, t) * 0.4 * (galv | chan))
    wrust = weldk * _ss(0.4, 0.7, mA * 0.6 + gB * 0.6)
    alb = _mixc(alb, rust_c, wrust * 0.8)
    rough = rough + (0.85 - rough) * wrust

    # ---- rust runs from bolts, screws and hinges: a bloom at the source and a tapering streak down the face
    rmask = np.zeros((H, Wd), np.float32)
    for (pi_, p, n, st, ln) in RUST:
        n = np.asarray(n, np.float32)
        dx, dy, dz = x - p[0], y - p[1], z - p[2]
        near = (part == pi_) & (np.abs(dx) < 0.08) & (np.abs(dz) < 0.08) & (dy < 0.03) & (dy > -max(ln, 0.02) - 0.02)
        if not near.any():
            continue
        idx = np.nonzero(near)
        ddx, ddy, ddz = dx[idx], dy[idx], dz[idx]
        dist = np.sqrt(ddx ** 2 + ddy ** 2 + ddz ** 2)
        bloom = _ss(0.016, 0.004, dist) * (0.6 + 0.6 * mA[idx])
        if ln > 0:
            face = (np.abs(ddx * n[0] + ddz * n[2]) < 0.006) & (np.abs(ny[idx]) < 0.5)
            hor = np.sqrt(np.maximum(ddx ** 2 + ddz ** 2 - (ddx * n[0] + ddz * n[2]) ** 2, 0.0))
            drop = np.clip(-ddy / ln, 0, 1)
            wid = 0.003 + 0.007 * drop
            wob = (fB[idx] - 0.5) * 0.004
            tail = face * (ddy < 0.004) * _ss(wid, wid * 0.2, hor + wob) * (1 - drop) ** 1.2 * (0.5 + 0.7 * _ss(0.4, 0.7, sA[idx]))
        else:
            tail = 0.0
        rmask[idx] = np.maximum(rmask[idx], np.clip((bloom + tail) * st, 0, 1))
    # drips off the hood's lip down the door and its switch plate, where water gathers along the lip's rusted edge
    rr = np.random.default_rng(7)
    door = (part == 0) & (paint_ | bezel) & f32(nz > 0.9).astype(bool) & (z > D + 0.005)
    for hx in rr.uniform(-W / 2 + 0.02, W / 2 - 0.02, 9):
        drop = np.clip((H / 2 - 0.004 - y) / rr.uniform(0.08, 0.3), 0, 1)
        wid = 0.0025 + 0.006 * drop
        tail = door * _ss(wid, wid * 0.2, np.abs(x - hx + (fB - 0.5) * 0.004)) * (1 - drop) ** 1.5 * (y < H / 2 - 0.004)
        rmask = np.maximum(rmask, tail * rr.uniform(0.35, 0.8))
    rmask *= f32(~(weldk | rubber | cell | tag | slot)) + tag * 0.35
    rcol = rust_c[None, None, :] + (rust_dk - rust_c)[None, None, :] * _ss(0.5, 1.0, rmask)[..., None]
    alb = alb + (rcol - alb) * (rmask * 0.85)[..., None]
    rough = rough + (0.85 - rough) * rmask
    metal = metal * (1 - rmask * 0.9)
    hgt += rmask * 6e-5 * (0.5 + gB)

    # ---- grime: in every crease, along the bottom of the box and its hood's underside, splash near the deck
    g = np.clip(crease * 0.9, 0, 1) * (0.6 + 0.6 * gB)
    boxy = (part == 0) & ~(slot | rubber)
    g = g + boxy * _ss(-0.08, -0.17, y) * vert * _ss(0.3, 0.7, bA) * 0.7
    g = g + boxy * _ss(-0.7, -1.0, y) * 0.6 * (0.5 + gB)
    g = g + boxy * f32(ny < -0.7) * 0.4
    g = g + boxy * f32(nz > 0.9) * _ss(-0.1, -0.165, y + (bA - 0.5) * 0.04) * 0.55      # dirt splashed up the door's foot
    g *= f32(~(cell | slot))
    g = np.clip(g, 0, 1)
    alb = _mixc(alb, grime_c, g * 0.7)
    rough = rough + (0.85 - rough) * g * 0.6
    metal = metal * (1 - g * 0.6)
    dirt = f32(~(cell | tag | slot)) * _ss(0.35, 0.8, gB * 0.7 + bA * 0.5) * 0.35
    alb = _mixc(alb, grime_c, dirt)
    rough = rough + (0.85 - rough) * dirt * 0.5
    # AO into the albedo a little (the game's aoMap does the rest)
    alb = alb * (0.85 + 0.15 * ao)[..., None]

    # ---- output
    alb = _dilate(np.clip(alb, 0.0, 1.0), cover)
    rough = _dilate(np.clip(rough, 0.04, 1.0), cover)
    metal = _dilate(np.clip(metal, 0.0, 1.0), cover)
    hgt = _dilate(hgt, cover)
    mpt = _dilate(mpt, cover, 4)
    save_png(MODELS + 'tower_kit_albedo.png', _srgb(alb))
    nm = _normal_map(hgt, mpt) * 2.0 - 1.0
    nm = np.stack([hr(nm[..., c]) for c in range(3)], axis=-1)
    nm /= np.linalg.norm(nm, axis=-1, keepdims=True) + 1e-6
    save_png(MODELS + 'tower_kit_normal.png', nm * 0.5 + 0.5)
    orm = np.stack([np.clip(_dilate(aoh, cover_h, 24), 0, 1), hr(rough), hr(metal)], axis=-1)
    save_png(MODELS + 'tower_kit_orm.png', orm)
