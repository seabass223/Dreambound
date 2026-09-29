# Dreambound: the elevator car, its landing doors and their frame, shared by every elevator end in the game.
# Executed inside dbkit.py's namespace by build_elevator.py.
#
# Plate space (the game's elevator root, src/props/elevator.js): +Y up, the landing faces +Z and the car runs back into
# -Z; the floor is y = 0 and the old plate's front face z = 0. Every placement (the sequoia recess, the lounge doorway,
# the cave stations, the rock end walls on Dome and Tower, the Mountain shed) was built around these numbers, so they
# are kept exactly:
#   the car's inside   |x| < 1.05, 0 < y < 2.6, -2.35 < z < -0.16
#   the doorway        |x| < 0.68, y < 2.3
#   the plate          |x| < 1.85, y < 3.3, back face z = -0.12
#   the leaves         closed with their empties at x = -+0.34; the game slides them 0.70 m apart
# New in front of the old plate face: the leaves run in a 56 mm pocket behind a painted steel faceplate (front z = 0.07)
# with stainless jamb and head casings (front z = 0.10) and a diamond-plate sill (to z = 0.165); all of it fits the
# lounge's pocket (its wall's back is at z = 0.17) and the cave stations' portal posts.
#
# Sealing: closed, nothing of the landing can be seen from inside. The two leaves meet on a recessed rubber astragal,
# rubber seals on the jambs and head reach 6 mm into the leaves' back faces, and a rubber sweep under each leaf reaches
# into the sill; every leaf part is a closed solid. tools/regress/out/elevator_test.mjs raycasts it.
#
# Materials, one draw call per group in the game:
#   x_*   outside, lit PBR: elevator_ext_albedo.png (2048), elevator_ext_normal.png and elevator_ext_orm.png (1024:
#         baked AO, roughness, metalness), all on one packed atlas
#   i_*   the car's inside, unlit: elevator_int_albedo.png (2048) times elevator_int_lm.png (1024), the ceiling lamp
#         baked with Cycles (full GI, doors closed) on the same UVs
#   glow  the lamp's diffuser
# The textures are painted in numpy from a baked "G-buffer" of the atlases (world position, normal, surface kind, a few
# Blender noises), so wear follows the real geometry: water runs down from the head, limescale gathers along the
# bottom and the leaves' meeting edge, wet grime sits in the seams and around the sill, rust blooms round the bolts.

MODELS = ROOT + '/public/models/'
QUICK = os.environ.get('ELEV_QUICK') == '1'          # small, noisy bakes for layout work
CACHE = os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_elevator')

# Surface kinds (painted per texel); the game only sees the x_ / i_ prefix.
KIND = {'x_steel': 1, 'x_paint': 2, 'x_rubber': 3, 'x_tread': 4, 'x_skin': 5, 'x_bolt': 6, 'x_btn_up': 7, 'x_btn_dn': 8,
        'i_panel': 11, 'i_steel': 12, 'i_tread': 13, 'i_rubber': 14, 'i_ceil': 15, 'i_btn': 16}
MATS.update({k: ((0.5, 0.5, 0.5), 0.5) for k in KIND})
MATS.update({'x_steel': ((0.6, 0.6, 0.58), 0.3), 'x_paint': ((0.07, 0.08, 0.08), 0.5), 'x_rubber': ((0.02, 0.02, 0.02), 0.7),
             'i_panel': ((0.23, 0.22, 0.18), 0.6), 'glow': ((1.0, 0.85, 0.6), 1.0)})
NO_BAKE = {'glow', 'collider'}
BAKE_MATS = set(KIND)
DENS = {'shell': 1.0, 'mid': 0.6, 'lo': 0.3, 'min': 0.12}   # texel density per layer, relative

# ---------------------------------------------------------------- layout (metres, plate space)
HW, HH = 0.68, 2.3                          # doorway (elevator.js HOLE)
CHW, CH, CZ0, CZ1 = 1.05, 2.6, -0.16, -2.35  # the car's inside (elevator.js CAR)
PW, PH, PZB = 1.85, 3.3, -0.12              # the plate
LEAF_X, TRAVEL = 0.34, 0.70                 # leaf empties when closed, and how far the game slides them
LZ0, LZ1 = 0.006, 0.050                     # leaf back / front
LY0, LY1 = 0.008, 2.345                     # leaf bottom / top
LX0, LX1 = 0.004, 0.724                     # leaf body edges |x| (closed)
FZ0, FZ1 = 0.056, 0.070                     # faceplate back / front
CAS_X, CAS_Z, HEAD_Y = 0.80, 0.10, 2.44     # casings: outer edge |x|, front z, head top
BASE_Y = -0.12                              # faceplate and sill reach below the floor
SILL_X, SILL_Z = 0.80, 0.165                # sill half width, front (slides under the lounge's brass threshold)
SEAL_X0, SEAL_X1, SEAL_Z0, SEAL_Z1 = 0.676, 0.735, -0.006, 0.012
SEAL_Y1, SEAL_HY = 2.35, 2.296
SILL_TOP = 0.02                             # the sill plate stands this proud of the landing, out past the leaves
SILL_IN = 0.015                             # the sill is inside material up to here (past the leaves' backs, into the sweeps)
CALL = (1.12, 1.15)                         # the call button (the lounge moves it onto its panelling)
CALL_Z = FZ1 + 0.006                        # front of its plate
BTN_R, BEZ_R = 0.019, 0.026
BTNS = {'up': (-0.78, 1.34), 'down': (-0.78, 1.16)}
PANEL = (-0.87, -0.69, 1.04, 1.46)          # the car's button plate (x0, x1, y0, y1), on the front wall
LAMP_Z = (CZ0 + CZ1) / 2
LAMP = (0.0, 2.55, LAMP_Z)                  # diffuser centre
RAIL_Y, RAIL_R, RAIL_OFF = 0.92, 0.019, 0.06
KICK = 0.22                                 # kick plates
BOLTS = []                                  # (x, y) on the faceplate, for the rust blooms

# ---------------------------------------------------------------- emit helpers
def guv(grain):
    """Metric planar UVs with the grain axis along v (the atlas packs without rotating, so every brushed island's grain
    runs along the atlas's v)."""
    def f(co, n):
        ax = max(range(3), key=lambda i: abs(n[i]))
        pl = [i for i in range(3) if i != ax]
        if grain in pl:
            vv = grain
            uu = pl[0] if pl[1] == grain else pl[1]
        else:
            uu, vv = pl
        return (co[uu], co[vv])
    return f

def spec(s):
    return (s, 'shell') if isinstance(s, str) else s

def put(s, bm, grain=1, uvface=None, planar=None):
    """planar: an axis; every face is projected along it, so a small part (a bolt, a button) packs as one island."""
    m, lay = spec(s)
    with layer(lay):
        if uvface:
            emit(bm, m, None, WHITE, uvface=uvface)
        elif planar is not None:
            a, b = [i for i in range(3) if i != planar]
            emit(bm, m, None, WHITE, uvfn=lambda co, n: (co[a], co[b]))
        else:
            emit(bm, m, None, WHITE, uvfn=guv(grain))

def quad(s, pts, n, grain=1):
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    bm.normal_update()
    if f.normal.dot(Vector(n)) < 0:
        bmesh.ops.reverse_faces(bm, faces=[f])
    put(s, bm, grain)

AX = {'x': 0, 'y': 1, 'z': 2}

def rect(s, axis, w, a0, a1, b0, b1, sign, grain=1):
    """Rectangle on the plane <axis> = w facing sign * axis; a, b are the other two axes in x, y, z order."""
    if s is None or a1 - a0 < 1e-6 or b1 - b0 < 1e-6:
        return
    ax = AX[axis]
    o = [i for i in range(3) if i != ax]
    def P(a, b):
        p = [0.0, 0.0, 0.0]
        p[ax], p[o[0]], p[o[1]] = w, a, b
        return tuple(p)
    n = [0, 0, 0]
    n[ax] = sign
    quad(s, [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], n, grain)

FACES = ('+x', '-x', '+y', '-y', '+z', '-z')

def box(faces, x0, x1, y0, y1, z0, z1, grain=1):
    """A box face by face: faces maps '+x', '-x', ... to a material spec (None drops it), or one spec for all six."""
    if not isinstance(faces, dict):
        faces = {k: faces for k in FACES}
    g = faces.get
    rect(g('+x'), 'x', x1, y0, y1, z0, z1, 1, grain)
    rect(g('-x'), 'x', x0, y0, y1, z0, z1, -1, grain)
    rect(g('+y'), 'y', y1, x0, x1, z0, z1, 1, grain)
    rect(g('-y'), 'y', y0, x0, x1, z0, z1, -1, grain)
    rect(g('+z'), 'z', z1, x0, x1, y0, y1, 1, grain)
    rect(g('-z'), 'z', z0, x0, x1, y0, y1, -1, grain)

def disc_stack(s, x, y, z, layers, facing, segs=16):
    """Coaxial cylinders along z (a bolt, a button): layers [(radius, depth)] from the mounting face outward; facing +1
    builds toward +z, -1 toward -z. Only the visible faces: sides and each step's outward face."""
    zc = z
    bmall = bmesh.new()
    for i, (r, d) in enumerate(layers):
        z0, z1 = zc, zc + facing * d
        bm = bmesh.new()
        a = [bm.verts.new((x + math.cos(2 * PI * k / segs) * r, y + math.sin(2 * PI * k / segs) * r, z0)) for k in range(segs)]
        b = [bm.verts.new((x + math.cos(2 * PI * k / segs) * r, y + math.sin(2 * PI * k / segs) * r, z1)) for k in range(segs)]
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new((a[k], a[j], b[j], b[k]))
        bm.faces.new(b)
        orient(bm, lambda c, x=x, y=y: Vector((c.x - x, c.y - y, 0.0)) if abs(c.z - z1) > 1e-7 else Vector((0, 0, facing)))
        me = bpy.data.meshes.new('DB_tmp_disc')
        bm.to_mesh(me)
        bm.free()
        bmall.from_mesh(me)
        bpy.data.meshes.remove(me)
        zc = z1
    put(s, bmall, planar=2)

def orient(bm, want):
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.dot(want(f.calc_center_median())) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    return bm

def tube(s, pts, r, sides=10):
    """A tube along a polyline with one unwrapped island (u around, v along: the grain runs along the tube)."""
    bm = bmesh.new()
    ls = bm.verts.layers.float.new('s')
    la = bm.verts.layers.float.new('a')
    P = [Vector(p) for p in pts]
    n = len(P)
    rings, s_acc = [], 0.0
    for i, p in enumerate(P):
        t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        t.normalize()
        ref = Vector((0, 1, 0)) if abs(t.y) < 0.95 else Vector((1, 0, 0))
        N = (ref - t * ref.dot(t)).normalized()
        B = t.cross(N)
        if i:
            s_acc += (P[i] - P[i - 1]).length
        ring = []
        for j in range(sides + 1):
            a = 2 * PI * j / sides
            v = bm.verts.new(p + (N * math.cos(a) + B * math.sin(a)) * r)
            v[ls], v[la] = s_acc, a * r
            ring.append(v)
        rings.append(ring)
    for A, Bq in zip(rings[:-1], rings[1:]):
        for j in range(sides):
            bm.faces.new((A[j], A[j + 1], Bq[j + 1], Bq[j]))
    # Faces point away from the path: compare with the nearest path point.
    flip = []
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        q = min(P, key=lambda pp: (pp - c).length)
        if f.normal.dot(c - q) < 0:
            flip.append(f)
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    put(s, bm, uvface=lambda f: [(l.vert[la], l.vert[ls]) for l in f.loops])

def rounded(pts, rad=0.06, n=4):
    """Round a polyline's corners with short arcs."""
    out = [Vector(pts[0])]
    for i in range(1, len(pts) - 1):
        a, b, c = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1])
        d0, d1 = (a - b).normalized(), (c - b).normalized()
        p0, p1 = b + d0 * rad, b + d1 * rad
        for k in range(n + 1):
            t = k / n
            out.append((p0 * (1 - t) + b * t) * (1 - t) + (b * (1 - t) + p1 * t) * t)
    out.append(Vector(pts[-1]))
    return out

# ---------------------------------------------------------------- the car's inside
def car_inside():
    rect('i_tread', 'y', 0.0, -CHW, CHW, CZ1, CZ0, 1, 0)             # floor
    rect('i_tread', 'y', 0.0, -HW, HW, CZ0, SILL_IN, 1, 0)           # the threshold's inner half, on under the leaves
    rect(('i_ceil', 'mid'), 'y', CH, -CHW, CHW, CZ1, CZ0, -1, 0)
    rect('i_panel', 'x', -CHW, 0.0, CH, CZ1, CZ0, 1)
    rect('i_panel', 'x', CHW, 0.0, CH, CZ1, CZ0, -1)
    rect('i_panel', 'z', CZ1, -CHW, CHW, 0.0, CH, 1)
    rect('i_panel', 'z', CZ0, -CHW, -HW, 0.0, CH, -1)                # front wall, round the doorway
    rect('i_panel', 'z', CZ0, HW, CHW, 0.0, CH, -1)
    rect('i_panel', 'z', CZ0, -HW, HW, HH, CH, -1)
    # The doorway's stainless liner, through the wall to the leaves.
    rect('i_steel', 'x', -HW, 0.0, HH, CZ0, 0.0, 1)
    rect('i_steel', 'x', HW, 0.0, HH, CZ0, 0.0, -1)
    rect('i_steel', 'y', HH, -HW, HW, CZ0, 0.0, -1, 0)
    # Kick plates, 3 mm proud.
    k, t = KICK, 0.003
    box({'+x': 'i_steel', '+y': ('i_steel', 'lo')}, -CHW, -CHW + t, 0.0, k, CZ1, CZ0, 2)
    box({'-x': 'i_steel', '+y': ('i_steel', 'lo')}, CHW - t, CHW, 0.0, k, CZ1, CZ0, 2)
    box({'+z': 'i_steel', '+y': ('i_steel', 'lo')}, -CHW, CHW, 0.0, k, CZ1, CZ1 + t, 0)
    box({'-z': 'i_steel', '+y': ('i_steel', 'lo'), '+x': ('i_steel', 'lo')}, -CHW, -HW, 0.0, k, CZ0 - t, CZ0, 0)
    box({'-z': 'i_steel', '+y': ('i_steel', 'lo'), '-x': ('i_steel', 'lo')}, HW, CHW, 0.0, k, CZ0 - t, CZ0, 0)
    # Handrail round the sides and back, returning into the side walls, on three brackets.
    o = RAIL_OFF
    zf = -0.62
    path = [(-CHW, RAIL_Y, zf), (-CHW + o, RAIL_Y, zf), (-CHW + o, RAIL_Y, CZ1 + o), (CHW - o, RAIL_Y, CZ1 + o), (CHW - o, RAIL_Y, zf), (CHW, RAIL_Y, zf)]
    tube(('i_steel', 'mid'), rounded(path, 0.05, 5), RAIL_R, 12)
    for (bx, bz, nx, nz) in ((-CHW, -1.45, 1, 0), (CHW, -1.45, -1, 0), (0.0, CZ1, 0, 1)):
        p0 = Vector((bx, RAIL_Y, bz))
        p1 = p0 + Vector((nx, 0, nz)) * o
        tube('i_steel', [p0, p1], 0.008, 8)          # (full density: slivers would bake black)
        # wall rose
        if nx:
            bm = bm_cyl(0.028, 0.028, 0.006, 16)
            bmesh.ops.transform(bm, matrix=xf(bx + nx * 0.003, RAIL_Y, bz, rz=PI / 2), verts=bm.verts)
        else:
            bm = bm_cyl(0.028, 0.028, 0.006, 16)
            bmesh.ops.transform(bm, matrix=xf(bx, RAIL_Y, bz + 0.003, rx=PI / 2), verts=bm.verts)
        cull_back = Vector((-nx, 0, -nz))
        bm.normal_update()
        dead = [f for f in bm.faces if f.normal.dot(cull_back) > 0.9]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        put('i_steel', bm, 1)
    # Button plate and the Up / Down buttons, to the right of the door when facing out.
    x0, x1, y0, y1 = PANEL
    box({'-z': 'i_steel', '+x': ('i_steel', 'lo'), '-x': ('i_steel', 'lo'), '+y': ('i_steel', 'lo'), '-y': ('i_steel', 'lo')},
        x0, x1, y0, y1, CZ0 - 0.006, CZ0, 1)
    # The bezels are fixed; each cap is its own part so the game can push it in (and light it) when pressed.
    for k, (bx, by) in BTNS.items():
        disc_stack('i_btn', bx, by, CZ0 - 0.006, [(BEZ_R, 0.004)], -1, 20)
        part('BTN_cap_' + k, (bx, by, CZ0 - 0.006 - 0.014), bake=True)
        with into('BTN_cap_' + k):
            disc_stack('i_btn', bx, by, CZ0 - 0.010, [(BTN_R, 0.010)], -1, 20)
    # Ceiling lamp: an enamelled housing, an opal diffuser and a two-bar guard.
    lx, lz = 0.33, 0.17
    dx, dz = 0.29, 0.13
    y0, y1 = LAMP[1], CH
    box({'+x': ('i_ceil', 'lo'), '-x': ('i_ceil', 'lo'), '+z': ('i_ceil', 'lo'), '-z': ('i_ceil', 'lo')}, -lx, lx, y0, y1, LAMP_Z - lz, LAMP_Z + lz, 0)
    rect(('i_ceil', 'lo'), 'y', y0, -lx, lx, LAMP_Z - lz, LAMP_Z - dz, -1, 0)
    rect(('i_ceil', 'lo'), 'y', y0, -lx, lx, LAMP_Z + dz, LAMP_Z + lz, -1, 0)
    rect(('i_ceil', 'lo'), 'y', y0, -lx, -dx, LAMP_Z - dz, LAMP_Z + dz, -1, 0)
    rect(('i_ceil', 'lo'), 'y', y0, dx, lx, LAMP_Z - dz, LAMP_Z + dz, -1, 0)
    rect('glow', 'y', y0 + 0.0003, -dx, dx, LAMP_Z - dz, LAMP_Z + dz, -1, 0)
    for zb in (LAMP_Z - 0.05, LAMP_Z + 0.05):
        box({'-y': ('i_steel', 'lo'), '+z': ('i_steel', 'lo'), '-z': ('i_steel', 'lo')}, -dx - 0.02, dx + 0.02, y0 - 0.008, y0 - 0.004, zb - 0.002, zb + 0.002, 0)
    for sx in (-1, 1):
        for zb in (LAMP_Z - 0.05, LAMP_Z + 0.05):
            box(('i_steel', 'lo'), sx * (dx + 0.02) - 0.003, sx * (dx + 0.02) + 0.003, y0 - 0.008, y0, zb - 0.003, zb + 0.003)

# ---------------------------------------------------------------- the seals, pocket and landing frame
def seals():
    for s in (-1, 1):
        xa, xb = sorted((s * SEAL_X0, s * SEAL_X1))
        inner, outer = ('+x', '-x') if s < 0 else ('-x', '+x')
        box({inner: 'i_rubber', '-z': 'i_rubber', '+z': ('x_rubber', 'lo'), outer: ('x_rubber', 'lo')},
            xa, xb, -0.004, SEAL_Y1, SEAL_Z0, SEAL_Z1)
    box({'-y': 'i_rubber', '-z': 'i_rubber', '+z': ('x_rubber', 'lo'), '+y': ('x_rubber', 'lo')},
        -SEAL_X1, SEAL_X1, SEAL_HY, SEAL_Y1, SEAL_Z0, SEAL_Z1, 0)

def pocket():
    lo, mn = ('x_paint', 'lo'), ('x_paint', 'min')
    # Plate front (the pocket's back), round the doorway.
    rect(lo, 'z', 0.0, -PW, -HW, 0.0, PH, 1)
    rect(lo, 'z', 0.0, HW, PW, 0.0, PH, 1)
    rect(lo, 'z', 0.0, -HW, HW, HH, PH, 1)
    # Faceplate back (the pocket's front), and the pocket's floor, ceiling and ends.
    rect(lo, 'z', FZ0, -PW, -HW, 0.0, PH, -1)
    rect(lo, 'z', FZ0, HW, PW, 0.0, PH, -1)
    rect(lo, 'z', FZ0, -HW, HW, HH, PH, -1)
    rect(lo, 'y', 0.0, -PW, -SILL_X, 0.0, FZ0, 1, 0)
    rect(lo, 'y', 0.0, SILL_X, PW, 0.0, FZ0, 1, 0)
    rect(mn, 'y', PH, -PW, PW, 0.0, FZ0, -1, 0)
    rect(mn, 'x', -PW, 0.0, PH, 0.0, FZ0, 1)
    rect(mn, 'x', PW, 0.0, PH, 0.0, FZ0, -1)

def bolt(x, y, z=FZ1):
    BOLTS.append((x, y))
    disc_stack('x_bolt', x, y, z, [(0.016, 0.0025), (0.011, 0.007)], 1, 6)

def landing():
    mid, mn = ('x_paint', 'mid'), ('x_paint', 'min')
    # Faceplate front, round the casings and the sill: one face (one atlas island, so no texture seams on it).
    quad(mid, [(-PW, BASE_Y, FZ1), (-CAS_X, BASE_Y, FZ1), (-CAS_X, HEAD_Y, FZ1), (CAS_X, HEAD_Y, FZ1), (CAS_X, BASE_Y, FZ1),
               (PW, BASE_Y, FZ1), (PW, PH, FZ1), (-PW, PH, FZ1)], (0, 0, 1))
    # Edges and the plate's back, round the car.
    rect(mn, 'y', PH, -PW, PW, PZB, FZ1, 1, 0)
    rect(mn, 'x', -PW, BASE_Y, PH, PZB, FZ1, -1)
    rect(mn, 'x', PW, BASE_Y, PH, PZB, FZ1, 1)
    rect(mn, 'y', BASE_Y, -PW, PW, PZB, FZ1, -1, 0)
    cw, ct, cb, cz = CHW + 0.02, CH + 0.02, -0.02, CZ1 - 0.02
    rect(mn, 'z', PZB, -PW, -cw, BASE_Y, PH, -1)
    rect(mn, 'z', PZB, cw, PW, BASE_Y, PH, -1)
    rect(mn, 'z', PZB, -cw, cw, ct, PH, -1)
    rect(mn, 'z', PZB, -cw, cw, BASE_Y, cb, -1)
    # The car's outer skin (only ever seen if a placement's rock doesn't quite cover it).
    sk = ('x_skin', 'min')
    rect(sk, 'x', -cw, cb, ct, cz, PZB, -1)
    rect(sk, 'x', cw, cb, ct, cz, PZB, 1)
    rect(sk, 'y', ct, -cw, cw, cz, PZB, 1, 0)
    rect(sk, 'y', cb, -cw, cw, cz, PZB, -1, 0)
    rect(sk, 'z', cz, -cw, cw, cb, ct, -1)
    # Stainless jamb and head casings; the leaves run behind them.
    for s in (-1, 1):
        xa, xb = sorted((s * HW, s * CAS_X))
        inner, outer = ('+x', '-x') if s < 0 else ('-x', '+x')
        box({'+z': 'x_steel', inner: 'x_steel'}, xa, xb, 0.0, HH, FZ0, CAS_Z)
        rect(('x_steel', 'mid'), 'x', s * CAS_X, 0.0, HH, FZ1, CAS_Z, s)
        # brush gasket along the casing's inner edge, just clear of the leaf faces
        ga, gb = sorted((s * (HW - 0.012), s * HW))
        box({inner: ('x_rubber', 'lo'), '+z': ('x_rubber', 'lo'), '-z': ('x_rubber', 'lo')}, ga, gb, 0.0, HH - 0.012, LZ1 + 0.001, FZ0 + 0.008)
    box({'+z': 'x_steel', '-y': 'x_steel', '+x': ('x_steel', 'mid'), '-x': ('x_steel', 'mid')}, -CAS_X, CAS_X, HH, HEAD_Y, FZ0, CAS_Z, 0)
    rect(('x_steel', 'mid'), 'y', HH, -CAS_X, -HW, FZ1, CAS_Z, -1, 0)
    rect(('x_steel', 'mid'), 'y', HH, HW, CAS_X, FZ1, CAS_Z, -1, 0)
    box({'-y': ('x_rubber', 'lo'), '+z': ('x_rubber', 'lo'), '-z': ('x_rubber', 'lo')}, -HW, HW, HH - 0.012, HH, LZ1 + 0.001, FZ0 + 0.008, 0)
    # Drip cap over the head: a ledge with a turned-down lip, to shed the water off the doors.
    dz = 0.135
    box({'+y': ('x_steel', 'mid'), '-y': ('x_steel', 'mid'), '+z': ('x_steel', 'mid'), '+x': ('x_steel', 'lo'), '-x': ('x_steel', 'lo')},
        -0.86, 0.86, HEAD_Y, HEAD_Y + 0.012, FZ1, dz, 0)
    box({'+z': ('x_steel', 'mid'), '-z': ('x_steel', 'mid'), '-y': ('x_steel', 'lo'), '+x': ('x_steel', 'lo'), '-x': ('x_steel', 'lo')},
        -0.86, 0.86, HEAD_Y - 0.018, HEAD_Y, dz - 0.006, dz, 0)
    # Sill: diamond plate from the leaves' track out to the nosing.
    # The leaves run in a track flush with the car floor; in front of them the plate steps up SILL_TOP (so it reads
    # above the rock, earth or boards each landing has, which lie within a centimetre of the car's floor).
    zr = LZ1 + 0.004
    rect(('x_tread', 'lo'), 'y', 0.0, -SILL_X, SILL_X, SILL_IN, zr, 1, 0)
    rect(('x_tread', 'lo'), 'y', 0.0, -SILL_X, -HW, 0.0, SILL_IN, 1, 0)
    rect(('x_tread', 'lo'), 'y', 0.0, HW, SILL_X, 0.0, SILL_IN, 1, 0)
    rect(('x_steel', 'lo'), 'z', zr, -SILL_X, SILL_X, 0.0, SILL_TOP, -1, 0)
    rect('x_tread', 'y', SILL_TOP, -SILL_X, SILL_X, zr, SILL_Z, 1, 0)
    rect(('x_steel', 'mid'), 'z', SILL_Z, -SILL_X, SILL_X, BASE_Y, SILL_TOP, 1, 0)
    rect(('x_steel', 'mid'), 'x', -SILL_X, BASE_Y, SILL_TOP, FZ1, SILL_Z, -1)
    rect(('x_steel', 'mid'), 'x', SILL_X, BASE_Y, SILL_TOP, FZ1, SILL_Z, 1)
    rect(mn, 'y', BASE_Y, -SILL_X, SILL_X, FZ1, SILL_Z, -1, 0)
    # The call button's plate.
    cx, cy = CALL
    box({'+z': 'x_steel', '+x': ('x_steel', 'lo'), '-x': ('x_steel', 'lo'), '+y': ('x_steel', 'lo'), '-y': ('x_steel', 'lo')},
        cx - 0.045, cx + 0.045, cy - 0.075, cy + 0.075, FZ1, CALL_Z)
    for sx in (-1, 1):
        for sy in (-1, 1):
            disc_stack('x_bolt', cx + sx * 0.031, cy + sy * 0.061, CALL_Z, [(0.0042, 0.0018)], 1, 8)
    # Bolts: round the faceplate's edge and beside the casings.
    for y in (0.08, 0.52, 0.96, 1.40, 1.84, 2.28, 2.72, 3.20):
        for s in (-1, 1):
            bolt(s * 1.77, y)
    for x in (-1.32, -0.88, -0.44, 0.0, 0.44, 0.88, 1.32):
        bolt(x, 3.20)
    for y in (0.16, 0.86, 1.56, 2.20):
        for s in (-1, 1):
            if not (s > 0 and abs(y - CALL[1]) < 0.3):
                bolt(s * 0.90, y)
    for s in (-1, 1):
        bolt(s * 1.30, -0.05)

# ---------------------------------------------------------------- the leaves
def leaves():
    for name, s in (('LEAF_L', -1), ('LEAF_R', 1)):
        part(name, (s * LEAF_X, 0.0, 0.0), side=s, travel=TRAVEL, bake=True)
        with into(name):
            xa, xb = sorted((s * LX0, s * LX1))
            inner, outer = ('+x', '-x') if s < 0 else ('-x', '+x')
            box({'+z': 'x_steel', '-z': 'i_steel', '+y': ('x_steel', 'lo'), outer: ('x_steel', 'lo')},
                xa, xb, LY0, LY1, LZ0, LZ1)
            ze0, ze1 = (0.010, 0.046) if s < 0 else (0.012, 0.044)
            sz0, sz1 = (0.012, 0.044) if s < 0 else (0.014, 0.042)
            # Its bottom: behind the sweep it's seen from inside, in front of it from outside.
            rect('i_steel', 'y', LY0, xa, xb, LZ0, sz0, -1, 0)
            rect(('x_steel', 'lo'), 'y', LY0, xa, xb, sz1, LZ1, -1, 0)
            # The body's edge in the meeting seam: seen from inside (behind the astragal) and from outside (in front of it).
            xe = s * LX0
            rect('i_steel', 'x', xe, LY0, LY1, LZ0, ze0, -s)
            rect(('x_steel', 'lo'), 'x', xe, LY0, LY1, ze1, LZ1, -s)
            # Rubber astragal: each leaf's reaches past the centre line into the other's, at different depths so no
            # two faces are coplanar.
            ra, rb = sorted((s * LX0, -s * 0.005))
            box({'+z': 'x_rubber', '-z': 'i_rubber', '+y': ('x_rubber', 'lo'), '-y': 'i_rubber', outer: None, inner: ('x_rubber', 'lo')},
                ra, rb, LY0, LY1, ze0, ze1)
            # Sweep under the leaf, down into the sill's track.
            wa, wb = sorted((s * (LX1 - 0.004), -s * 0.005))
            box({'+z': ('x_rubber', 'lo'), '-z': 'i_rubber', outer: ('x_rubber', 'lo'), inner: 'i_rubber'},    # its tip shows under the other leaf
                wa, wb, -0.006, LY0 + 0.002, sz0, sz1)

# ---------------------------------------------------------------- the call button (placed by the game)
def call_buttons():
    cx, cy = CALL
    for name, mat, up in (('BTN_call_up', 'x_btn_up', 1), ('BTN_call_down', 'x_btn_dn', -1)):
        part(name, (cx, cy, CALL_Z + 0.014), arrow=up, bake=True)
        with into(name):
            disc_stack(mat, cx, cy, CALL_Z, [(BEZ_R, 0.005), (BTN_R, 0.011)], 1, 20)

def build_meta():
    empty('META', (0, 0, 0), car=[CHW, CH, CZ0, CZ1], hole=[HW, HH], plate=[PW, PH, PZB], leaf=[LEAF_X, TRAVEL],
          face=[FZ0, FZ1, CAS_Z], sill=[SILL_X, SILL_Z], seal=[SEAL_X0, SEAL_X1, SEAL_Z0, SEAL_Z1, SEAL_HY, SEAL_Y1])
    for k, (bx, by) in BTNS.items():
        empty('BTN_' + k, (bx, by, CZ0 - 0.006 - 0.014))
    empty('CALL', (CALL[0], CALL[1], CALL_Z + 0.014))
    empty('LAMP', LAMP)

def build_all():
    t0 = time.time()
    BOLTS.clear()
    car_inside()
    seals()
    pocket()
    landing()
    leaves()
    call_buttons()
    build_meta()
    stats = realize()
    sc = _scene()
    col = sc.objects.get('COLLIDER')
    if col is not None:
        bpy.data.objects.remove(col, do_unlink=True)
    show_scene()
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in sc.objects if ob.type == 'MESH')
    return {'materials': stats, 'tris': tris, 'bolts': len(BOLTS), 'seconds': round(time.time() - t0, 1)}

# ============================================================================ atlases
def mat_of(ob):
    return ob.data.materials[0].name[len(PREFIX):] if ob.type == 'MESH' and ob.data.materials else ''

def group(prefix):
    return [ob for ob in _scene().objects if ob.type == 'MESH' and mat_of(ob).startswith(prefix)]

def pack_atlas(objs, margin=0.006):
    """Scale each object's metric UVs by its layer's density, then pack every island of the set into one square,
    unrotated (so brushed grain stays along v). Returns texels per metre at density 1 (per unit of UV)."""
    import numpy as np
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    area3 = 0.0
    for ob in objs:
        d = DENS.get(ob.get('layer', 'shell'), 1.0)
        ob.pass_index = int(round(d * 100))
        me = ob.data
        buf = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers['UVMap'].data.foreach_get('uv', buf)
        me.uv_layers['UVMap'].data.foreach_set('uv', buf * d)
    # a reference: one metre in UV before packing
    ref = objs[0]
    uvs0 = np.empty(len(ref.data.loops) * 2, dtype=np.float32)
    ref.data.uv_layers['UVMap'].data.foreach_get('uv', uvs0)
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=False, scale=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')
    uvs1 = np.empty_like(uvs0)
    ref.data.uv_layers['UVMap'].data.foreach_get('uv', uvs1)
    # uniform scale: compare the spread of the reference's first polygon
    poly = ref.data.polygons[0]
    li = list(poly.loop_indices)
    a0 = uvs0.reshape(-1, 2)[li]
    a1 = uvs1.reshape(-1, 2)[li]
    return float(np.linalg.norm(a1[1] - a1[0]) / max(1e-9, np.linalg.norm(a0[1] - a0[0])))   # atlas units per metre at density 1

def _clear_nodes(m):
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return nt, nt.nodes.new('ShaderNodeOutputMaterial')

def _game_pos(nt):
    """World position in game coordinates (x, y up, z)."""
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = node(nt, 'ShaderNodeSeparateXYZ', Vector=geo.outputs['Position'])
    return node(nt, 'ShaderNodeCombineXYZ', X=sep.outputs['X'], Y=sep.outputs['Z'], Z=math_node(nt, 'MULTIPLY', sep.outputs['Y'], -1.0)).outputs[0], geo

def _vmul(nt, v, k):
    return node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=v, i1=k).outputs[0]

def _noise(nt, v, scale, detail=4.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '3D'}, Vector=v, Scale=scale, Detail=detail,
                Roughness=rough, Distortion=distort).outputs['Fac']

def _pass_color(nt, which, mname):
    gp, geo = _game_pos(nt)
    if which == 'P':
        return node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY_ADD'}, i0=gp, i1=(0.125, 0.125, 0.125), i2=(0.5, 0.5, 0.5)).outputs[0]
    if which == 'N':
        n = geo.outputs['True Normal']
        sep = node(nt, 'ShaderNodeSeparateXYZ', Vector=n)
        gn = node(nt, 'ShaderNodeCombineXYZ', X=sep.outputs['X'], Y=sep.outputs['Z'], Z=math_node(nt, 'MULTIPLY', sep.outputs['Y'], -1.0)).outputs[0]
        return node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY_ADD'}, i0=gn, i1=(0.5, 0.5, 0.5), i2=(0.5, 0.5, 0.5)).outputs[0]
    if which == 'K':
        oi = nt.nodes.new('ShaderNodeObjectInfo')
        return node(nt, 'ShaderNodeCombineXYZ', X=KIND.get(mname, 0) / 32.0, Y=math_node(nt, 'DIVIDE', oi.outputs['Object Index'], 100.0), Z=0.0).outputs[0]
    if which == 'A':
        # streaks (tall, thin), mottle, blotches
        a = _noise(nt, _vmul(nt, gp, (60.0, 1.3, 60.0)), 1.0, 3.0, 0.5)
        b = _noise(nt, gp, 28.0, 6.0, 0.55)
        c = _noise(nt, gp, 2.2, 4.0, 0.55)
        return node(nt, 'ShaderNodeCombineXYZ', X=a, Y=b, Z=c).outputs[0]
    if which == 'B':
        v = node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '3D', 'feature': 'F1'}, Vector=gp, Scale=70.0).outputs['Distance']
        f = _noise(nt, _vmul(nt, gp, (180.0, 3.5, 180.0)), 1.0, 2.0, 0.5)
        g = _noise(nt, gp, 9.0, 8.0, 0.6, 0.6)
        return node(nt, 'ShaderNodeCombineXYZ', X=v, Y=f, Z=g).outputs[0]
    raise ValueError(which)

def bake_emit(objs, size, which, margin=24):
    import numpy as np
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
    _cycles(sc, 1)
    sc.cycles.use_denoising = False
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.bake(type='EMIT', margin=margin, use_clear=True, target='IMAGE_TEXTURES')
    return _np_image(img)[:, :, :3].copy()

def gbuffer(objs, size):
    """Per-texel world position, face normal, kind and density, and six noise channels (Blender orientation: row 0 is
    the bottom of the image)."""
    import numpy as np
    cover = None
    out = {}
    for w in ('P', 'N', 'K', 'A', 'B'):
        out[w] = bake_emit(objs, size, w).astype(np.float32)
    out['P'] = (out['P'] - 0.5) * 8.0
    out['N'] = out['N'] * 2.0 - 1.0
    # coverage: texels whose centre is on a triangle (a zero-margin bake of the kind pass)
    cov = bake_emit(objs, size, 'K', margin=0)
    out['cover'] = (cov[:, :, 0] > 0.0).astype(np.float32)
    return out

def bake_ao_atlas(objs, size, samples, distance):
    import numpy as np
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
    hidden = [ob for ob in sc.objects if ob.type == 'MESH' and mat_of(ob) == 'glow' and not ob.hide_render]
    for ob in hidden:
        ob.hide_render = True
    _cycles(sc, samples)
    if sc.world is None:
        sc.world = bpy.data.worlds.new('DB_world')
    sc.world.light_settings.distance = distance
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.bake(type='AO', margin=16, use_clear=True, target='IMAGE_TEXTURES')
    for ob in hidden:
        ob.hide_render = False
    a = _np_image(img)[:, :, :3].mean(axis=2)
    return _blur(a, (1, 2, 1))

def bake_lamp(objs, size, samples, albedo_path):
    """Full GI from the ceiling lamp (an area light the size of its diffuser) into the inside's atlas, doors closed."""
    import numpy as np
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    alb = bpy.data.images.load(albedo_path, check_existing=False)
    alb.colorspace_settings.name = 'sRGB'
    alb.alpha_mode = 'CHANNEL_PACKED'     # its alpha is the game's highlight mask, not coverage (Cycles would premultiply)
    img = bpy.data.images.get('DB_lm')
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new('DB_lm', size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    for ob in sc.objects:
        if ob.type != 'MESH':
            continue
        for sl in ob.material_slots:
            m = sl.material
            if m is None or m.get('_lmset'):
                continue
            m['_lmset'] = 1
            nt, out = _clear_nodes(m)
            name = m.name[len(PREFIX):]
            if name.startswith('i_'):
                t = node(nt, 'ShaderNodeTexImage', props={'image': alb})
                uvn = node(nt, 'ShaderNodeUVMap', props={'uv_map': 'UVMap'}).outputs['UV']
                nt.links.new(uvn, t.inputs['Vector'])
                bs = node(nt, 'ShaderNodeBsdfDiffuse', Color=t.outputs['Color'])
                tn = nt.nodes.new('ShaderNodeTexImage')
                tn.image = img
                nt.nodes.active = tn
            else:
                bs = node(nt, 'ShaderNodeBsdfDiffuse', Color=(0.25, 0.25, 0.25, 1.0))
            nt.links.new(bs.outputs[0], out.inputs['Surface'])
    for ob in sc.objects:
        if ob.type == 'MESH':
            for sl in ob.material_slots:
                if sl.material and '_lmset' in sl.material:
                    del sl.material['_lmset']
    hidden = [ob for ob in sc.objects if ob.type == 'MESH' and mat_of(ob) == 'glow' and not ob.hide_render]
    for ob in hidden:
        ob.hide_render = True
    ld = bpy.data.lights.get('DB_lamp') or bpy.data.lights.new('DB_lamp', 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size, ld.size_y = 0.58, 0.26
    ld.energy = 60.0
    ld.color = (1.0, 0.8, 0.58)
    lo = sc.objects.get('DB_lamp') or bpy.data.objects.new('DB_lamp', ld)
    if lo.name not in sc.collection.objects:
        sc.collection.objects.link(lo)
    lo.location = g2b((LAMP[0], LAMP[1] - 0.004, LAMP[2]))
    lo.rotation_euler = (0.0, 0.0, 0.0)          # area lights shine down their -Z: game -Y
    lo['noexport'] = 1
    lo.hide_render = False
    if sc.world is None:
        sc.world = bpy.data.worlds.new('DB_world')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Strength'].default_value = 0.0
    _cycles(sc, samples)
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 6
    sc.cycles.sample_clamp_indirect = 4.0
    t0 = time.time()
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in objs)
        vl.objects.active = objs[0]
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=16, use_clear=True, target='IMAGE_TEXTURES')
    secs = time.time() - t0
    for ob in hidden:
        ob.hide_render = False
    lo.hide_render = True
    a = _np_image(img)[:, :, :3].copy()
    a = np.stack([_blur(a[:, :, c], (1, 2, 1)) for c in range(3)], axis=-1)
    lit = a.max(axis=2)
    lit = lit[lit > 1e-6]
    scale = float(np.percentile(lit, 99.9)) if lit.size else 1.0
    save_png(MODELS + 'elevator_int_lm.png', np.cbrt(np.clip(a / scale, 0, 1)))
    bpy.data.images.remove(alb)
    return scale, round(secs, 1)

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
    import numpy as np
    t0 = time.time()
    out = {}
    os.makedirs(CACHE, exist_ok=True)
    ext, inn = group('x_'), group('i_')
    s_ext = pack_atlas(ext)
    s_int = pack_atlas(inn)
    ES, IS = (1024, 1024) if QUICK else (2048, 2048)
    out['ext_px_per_m'] = round(s_ext * ES, 1)
    out['int_px_per_m'] = round(s_int * IS, 1)
    t1 = time.time()
    ge = gbuffer(ext, ES)
    gi = gbuffer(inn, IS)
    out['gbuffer_s'] = round(time.time() - t1, 1)
    t1 = time.time()
    ge['ao'] = bake_ao_atlas(ext, ES // 2, 32 if QUICK else 128, 0.35).astype(np.float32)
    out['ao_s'] = round(time.time() - t1, 1)
    np.savez_compressed(os.path.join(CACHE, 'ext.npz'), **ge, px=s_ext * ES)
    np.savez_compressed(os.path.join(CACHE, 'int.npz'), **gi, px=s_int * IS)
    with open(os.path.join(CACHE, 'bolts.json'), 'w') as f:
        import json
        json.dump(BOLTS, f)
    paint_ext(ge, s_ext * ES)
    paint_int(gi, s_int * IS)
    t1 = time.time()
    scale, secs = bake_lamp(inn, IS // 2, 64 if QUICK else 1024, MODELS + 'elevator_int_albedo.png')
    out['lm_s'] = secs
    out['lm_scale'] = scale
    meta = _scene().objects.get('META')
    if meta is not None:
        meta['lm_scale'] = scale
    plain_materials()
    # The game draws its own materials: drop the vertex colours so the GLB carries only what it uses.
    for ob in _scene().objects:
        if ob.type == 'MESH':
            for ca in list(ob.data.color_attributes):
                ob.data.color_attributes.remove(ca)
    out['seconds'] = round(time.time() - t0, 1)
    return out

def paint_only():
    """Repaint the textures from the cached G-buffers (ELEV_PAINT=1): no rebuild, no rebake, no export."""
    import numpy as np, json
    ge = dict(np.load(os.path.join(CACHE, 'ext.npz')))
    gi = dict(np.load(os.path.join(CACHE, 'int.npz')))
    BOLTS[:] = [tuple(b) for b in json.load(open(os.path.join(CACHE, 'bolts.json')))]
    paint_ext(ge, float(ge['px']))
    paint_int(gi, float(gi['px']))
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

def _grain(H, W, seed, along=20, across=0):
    """Brushed grain: noise smeared along v (image rows)."""
    import numpy as np
    r = np.random.default_rng(seed)
    g = r.standard_normal((H, W)).astype(np.float32)
    for _ in range(2):
        g = _boxblur(g, along, 0)
    if across:
        g = _boxblur(g, across, 1)
    g2 = r.standard_normal((H, W)).astype(np.float32)
    g2 = _boxblur(_boxblur(g2, along * 6, 0), 3, 1)
    g = g / (g.std() + 1e-6) + 0.6 * g2 / (g2.std() + 1e-6)
    return g / (g.std() + 1e-6)

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

def _tread(a, b, pitch=0.032, lx=0.012, ly=0.0028, hgt=0.0014):
    """Diamond (chequer) plate: raised lozenges alternating +-45 degrees on a square grid (in plane coords a, b, metres).
    Returns (height 0..hgt, top mask)."""
    import numpy as np
    ua, ub = a / pitch, b / pitch
    ia, ib = np.floor(ua), np.floor(ub)
    fa, fb = ua - ia - 0.5, ub - ib - 0.5
    alt = ((ia + ib) % 2) * 2 - 1
    c, s = 0.7071, 0.7071 * alt
    pa = (fa * c + fb * s) * pitch
    pb = (-fa * s + fb * c) * pitch
    q = (pa / lx) ** 2 + (pb / ly) ** 2
    prof = np.clip(1.0 - q, 0.0, 1.0)
    top = _ss(0.15, 0.55, prof)
    return hgt * np.sqrt(prof) * _ss(0.0, 0.25, prof), top

def _arrow_mask(lx, ly, up, size=0.010):
    """A filled arrowhead with a short shaft, in button-local metres."""
    import numpy as np
    y = ly * up
    tri = (y < size) & (y > -size * 0.1) & (np.abs(lx) < (size - y) * 0.9)
    shaft = (np.abs(lx) < size * 0.28) & (y <= -size * 0.1 + 1e-9) & (y > -size * 1.05)
    return (tri | shaft).astype(np.float32)

def paint_ext(G, px_per_m):
    import numpy as np
    P, N, K, A, B = G['P'], G['N'], G['K'], G['A'], G['B']
    H, W = P.shape[:2]
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    nx, ny, nz = N[..., 0], N[..., 1], N[..., 2]
    kind = np.rint(K[..., 0] * 32).astype(np.int32)
    dens = np.clip(K[..., 1], 0.05, 1.0)
    mpt = 1.0 / (px_per_m * dens)                         # metres per texel
    sA, mA, bA = A[..., 0], A[..., 1], A[..., 2]
    vB, fB, gB = B[..., 0], B[..., 1], B[..., 2]
    ao = G['ao']
    grain = _grain(H, W, 11, along=int(max(4, H / 100)))
    vert = (np.abs(ny) < 0.5).astype(np.float32)
    front = (nz > 0.9).astype(np.float32)
    steel = (kind == 1) | (kind == 7) | (kind == 8)
    paint, rubber, tread, skin, boltk = kind == 2, kind == 3, kind == 4, kind == 5, kind == 6
    leafs = steel & (np.abs(z - LZ1) < 0.004) & (np.abs(x) < LX1 + 0.01) & (y < LY1 + 0.01) & (y > LY0 - 0.01)

    alb = np.zeros((H, W, 3), np.float32)
    rough = np.full((H, W), 0.5, np.float32)
    metal = np.zeros((H, W), np.float32)
    hgt = np.zeros((H, W), np.float32)

    # ---- base surfaces
    # brushed stainless: a slightly warm steel, the grain in albedo, roughness and a few microns of relief
    st = np.array([0.53, 0.52, 0.50], np.float32)
    k = 1.0 + 0.035 * grain + 0.05 * (mA - 0.5)
    alb[steel] = (st[None, :] * k[steel][:, None])
    # (roughness varies only a little: the highlight's strength goes as 1 / roughness^4)
    rough[steel] = (0.44 + 0.008 * grain + 0.03 * (mA - 0.5) + 0.02 * (bA - 0.5))[steel]
    metal[steel] = 1.0
    hgt[steel] = (grain * 4e-6)[steel]
    # painted steel: a dark slate-green enamel with a little orange peel
    pc = np.array([0.058, 0.070, 0.068], np.float32)
    kp = 1.0 + 0.10 * (mA - 0.5) + 0.12 * (bA - 0.5)
    alb[paint] = pc[None, :] * kp[paint][:, None]
    rough[paint] = (0.46 + 0.10 * (bA - 0.5))[paint]
    hgt[paint] = ((mA - 0.5) * 4e-5)[paint]
    # rubber
    alb[rubber] = np.array([0.021, 0.021, 0.022], np.float32)
    rough[rubber] = (0.72 + 0.08 * (mA - 0.5))[rubber]
    hgt[rubber] = ((mA - 0.5) * 3e-5)[rubber]
    # galvanised skin
    gc = np.array([0.30, 0.31, 0.32], np.float32)
    alb[skin] = gc[None, :] * (1 + 0.25 * (bA - 0.5))[skin][:, None]
    rough[skin] = 0.55
    metal[skin] = 0.7
    # bolts: dull, weathered galvanising (a glossier finish read as glinting studs under the tunnel lights);
    # the rust comes later
    alb[boltk] = np.array([0.34, 0.34, 0.35], np.float32)
    rough[boltk] = 0.9
    metal[boltk] = 0.18
    # sill: aluminium chequer plate, the lozenge tops polished by feet where people walk
    th, ttop = _tread(x, z)
    walk = _ss(0.75, 0.35, np.abs(x)) * tread
    ac = np.array([0.50, 0.50, 0.49], np.float32)
    alb[tread] = (ac[None, :] * (1 + 0.06 * (mA - 0.5))[tread][:, None])
    alb = _mixc(alb, [0.66, 0.66, 0.64], (ttop * walk * 0.7) * tread)
    rough[tread] = (0.62 + 0.08 * (mA - 0.5) - 0.2 * ttop * walk)[tread]
    metal[tread] = 1.0
    hgt[tread] = th[tread]

    # ---- the call button's arrows (black enamel in the cap)
    for kk, up in ((7, 1), (8, -1)):
        m = (kind == kk) & (nz > 0.9) & (np.hypot(x - CALL[0], y - CALL[1]) < BTN_R - 0.001)
        am = _arrow_mask(x - CALL[0], y - CALL[1], up) * m
        alb = _mixc(alb, [0.02, 0.02, 0.02], am)
        rough = rough + (0.45 - rough) * am
        rough = np.where(kind == kk, np.maximum(rough, 0.58), rough)   # a satin button: no hot glint off the landing lamps
        metal = metal * (1 - am)
        hgt = hgt - am * 2e-4

    # ---- moisture: condensation runs down the doors and the faceplate. Soft tracks (the streak noise, widened
    # across), strongest just under the head and the drip cap where the drops gather, some ending partway down.
    trk = _boxblur(sA, 3, 1)
    run = _ss(0.60, 0.80, trk) * (0.55 + 0.45 * _ss(0.3, 0.7, fB)) * vert
    stop = y - (1.0 + 1.6 * bA)                            # where a run gives out
    run *= _ss(0.0, -0.25, stop) * 0.6 + 0.4 * _ss(1.6, 2.3, y)
    wetm = run * (steel | paint).astype(np.float32)
    alb = alb * (1.0 - np.where(paint, 0.20, 0.04) * wetm)[..., None]
    rough = rough - np.where(paint, 0.14, 0.02) * wetm
    # a run's end leaves a dried drop mark
    endm = wetm * _ss(0.12, 0.0, np.abs(stop + 0.02)) * _ss(0.4, 0.8, mA)
    alb = _mixc(alb, [0.50, 0.49, 0.45], endm * 0.35)
    rough = rough + 0.2 * endm

    # ---- limescale: a chalky film along the bottom (splash and standing water) with a dried tide line above it, up
    # the leaves' meeting edge, crusted in the lowest few centimetres; rust-tinted where it's thickest
    # (Kept low and dark: a tall pale band read as a grey stripe along the foot of every plate.)
    edgey = 0.09 + 0.05 * (bA - 0.5) + 0.02 * (mA - 0.5)
    film = 1.0 - _ss(edgey - 0.10, edgey, y)
    tide = _ss(0.014, 0.0, np.abs(y - (edgey + 0.06 + 0.02 * (gB - 0.5)))) * 0.08 * _ss(0.35, 0.65, bA)
    meet = leafs * _ss(0.04, 0.006, np.abs(x)) * (1.0 - _ss(0.1, 1.3, y + 0.3 * (bA - 0.5))) * 0.9
    tex = _ss(0.2, 0.8, 0.6 * mA + 0.4 * bA) * 0.7 + 0.3
    crust = (1.0 - _ss(0.0, 0.07, y)) * _ss(0.3, 0.1, vB)
    scale_m = np.clip(np.maximum(np.maximum(film * tex * 0.9, tide), meet * tex * 0.85) + crust * 0.4, 0, 1)
    scale_m *= (steel | paint | rubber | tread).astype(np.float32)
    scale_m *= np.where(tread, _ss(0.0012, 0.0, th) * (1 - walk * 0.7) * _ss(0.06, 0.16, z) * 0.8, 1.0)   # on the sill only in the valleys, out front
    lime = np.array([0.46, 0.45, 0.41], np.float32)
    iron = np.array([0.36, 0.28, 0.18], np.float32)
    lc = lime[None, None, :] + (iron - lime)[None, None, :] * (crust * 0.6 + (1 - _ss(0.0, 0.05, y)) * 0.3)[..., None]
    alb = alb + (lc - alb) * (scale_m * 0.45)[..., None]
    rough = rough + (0.88 - rough) * scale_m * 0.6
    metal = metal * (1 - scale_m)
    hgt = hgt + scale_m * 1.2e-4 * tex + crust * 3e-4 * (0.5 + mA)

    # ---- wet grime in the seams and round the sill
    seam = np.zeros((H, W), np.float32)
    seam += leafs * _ss(0.02, 0.004, np.abs(x))                                      # the astragal
    seam += leafs * _ss(0.05, 0.012, y)                                               # the leaves' bottoms
    seam += steel * (np.abs(np.abs(x) - HW) < 0.012) * _ss(0.3, 0.0, y) * front      # casing feet
    seam += tread * (_ss(0.05, 0.0, np.abs(z - (LZ0 + LZ1) / 2) - 0.02))              # the leaves' track
    seam += tread * _ss(0.035, 0.0, SILL_Z - z) * 0.6                                 # the nosing
    seam += tread * _ss(0.0009, 0.0, th) * 0.85                                       # valleys
    seam += paint * _ss(0.12, 0.0, y + (gB - 0.5) * 0.08) * 0.8                       # faceplate foot
    seam += (steel & (np.abs(z - SILL_Z) < 0.003)) * _ss(0.0, -0.1, y) * 0.7          # nosing face
    grime = np.clip(seam * (0.55 + 0.9 * (gB - 0.3)), 0, 1)
    gc = np.array([0.034, 0.030, 0.024], np.float32)
    alb = _mixc(alb, gc, grime * 0.85)
    rough = rough + (0.38 - rough) * grime
    metal = metal * (1 - grime * 0.9)

    # ---- rust blooms round the bolts, and short rust tails below them
    rust = np.zeros((H, W), np.float32)
    on_face = paint & (z > FZ1 - 0.003)
    for (bx, by) in BOLTS:
        dx, dy = x - bx, y - by
        d = np.hypot(dx, dy)
        near = d < 0.2
        if not near.any():
            continue
        r = 0.016 + 0.012 * mA + 0.006 * (gB - 0.5)
        rust += near * _ss(r + 0.004, r - 0.008, d)
        tailw = 0.004 + 0.004 * (1 - np.clip(-dy / 0.14, 0, 1))
        rust += near * (dy < 0) * _ss(tailw, 0.0, np.abs(dx + (fB - 0.5) * 0.004)) * _ss(0.14, 0.02, -dy) * 0.7
    rust = np.clip(rust * (0.6 + 0.8 * bA), 0, 1) * on_face
    rc = np.array([0.20, 0.075, 0.026], np.float32)
    rust_b = rust * (0.7 + 0.3 * mA)
    alb = _mixc(alb, rc, rust_b * 0.9)
    rough = rough + (0.82 - rough) * rust_b
    metal = metal * (1 - rust_b)
    hgt = hgt + rust_b * 1.2e-4 * (0.5 + gB)
    # the bolt heads themselves weather patchily
    bb = boltk * _ss(0.6, 0.85, mA + 0.3 * bA)
    alb = _mixc(alb, rc, bb * 0.7)
    rough = rough + (0.8 - rough) * bb
    metal = metal * (1 - bb * 0.8)

    # ---- output
    alb = np.clip(alb, 0.0, 1.0)
    rough = np.clip(rough, 0.05, 1.0)
    metal = np.clip(metal, 0.0, 1.0)
    save_png(MODELS + 'elevator_ext_albedo.png', _srgb(alb))
    # Normal and ORM at half resolution (the albedo carries the fine detail): AO (baked), roughness, metalness.
    hr = lambda a: a.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
    nm = _normal_map(hgt, mpt) * 2.0 - 1.0
    nm = np.stack([hr(nm[..., c]) for c in range(3)], axis=-1)
    nm /= np.linalg.norm(nm, axis=-1, keepdims=True) + 1e-6
    save_png(MODELS + 'elevator_ext_normal.png', nm * 0.5 + 0.5)
    aoh = ao if ao.shape[0] == H // 2 else (hr(ao) if ao.shape[0] == H else np.kron(ao, np.ones((H // 2 // ao.shape[0],) * 2, np.float32)))
    # The big painted faceplate only wants broad occlusion (under the drip cap, round the sill): soften its AO so small
    # bake steps don't draw lines across it.
    pnt = hr(paint.astype(np.float32)) > 0.99
    aoh = np.where(pnt, _boxblur(_boxblur(aoh, 6, 0), 6, 1), aoh)
    orm = np.stack([np.clip(aoh, 0, 1), hr(rough), hr(metal)], axis=-1)
    save_png(MODELS + 'elevator_ext_orm.png', orm)

def paint_int(G, px_per_m):
    import numpy as np
    P, N, K, A, B = G['P'], G['N'], G['K'], G['A'], G['B']
    H, W = P.shape[:2]
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    nx, ny, nz = N[..., 0], N[..., 1], N[..., 2]
    kind = np.rint(K[..., 0] * 32).astype(np.int32)
    dens = np.clip(K[..., 1], 0.05, 1.0)
    mpt = 1.0 / (px_per_m * dens)
    sA, mA, bA = A[..., 0], A[..., 1], A[..., 2]
    vB, fB, gB = B[..., 0], B[..., 1], B[..., 2]
    grain = _grain(H, W, 5, along=int(max(4, H / 100)))
    panel, steel, tread, rubber, ceil, btn = (kind == k for k in (11, 12, 13, 14, 15, 16))
    alb = np.zeros((H, W, 3), np.float32)
    hgt = np.zeros((H, W), np.float32)
    shine = np.zeros((H, W), np.float32)          # alpha: how much the game adds a lamp highlight (metal)

    # ---- wall panels: warm grey enamel, flush seams and a rivet row either side of each
    side = np.abs(nx) > 0.9
    back = (nz > 0.9) & (z < CZ1 + 0.01)
    fr = (nz < -0.9) & (z > CZ0 - 0.01)
    a = np.where(side, z, x)                      # along the wall
    # (no seams in the corners: a half groove there would catch the lamp like a crack of light)
    seams_side = [CZ1 + 0.73, CZ1 + 1.46]
    seams_back = [-0.35, 0.35]
    seams_front = [-HW, HW]
    rows = [KICK, 1.42]
    da = np.full((H, W), 9.0, np.float32)
    for (mask, seams) in ((side, seams_side), (back, seams_back), (fr, seams_front)):
        for s in seams:
            da = np.where(mask, np.minimum(da, np.abs(a - s)), da)
    dy = np.full((H, W), 9.0, np.float32)
    for r in rows:
        dy = np.minimum(dy, np.abs(y - r))
    dseam = np.minimum(da, dy)
    groove = _ss(0.0035, 0.0012, dseam)
    # rivets 25 mm off each seam, 110 mm apart
    riv = np.zeros((H, W), np.float32)
    rr = 0.0055
    on_v = np.abs(da - 0.025) < rr * 1.5
    pv = np.abs(((y - 0.03) / 0.11) - np.round((y - 0.03) / 0.11)) * 0.11
    riv = np.maximum(riv, on_v * np.sqrt(np.clip(1 - (np.hypot(da - 0.025, pv) / rr) ** 2, 0, 1)))
    on_h = np.abs(dy - 0.025) < rr * 1.5
    ph = np.abs(((a - 0.03) / 0.11) - np.round((a - 0.03) / 0.11)) * 0.11
    riv = np.maximum(riv, on_h * np.sqrt(np.clip(1 - (np.hypot(dy - 0.025, ph) / rr) ** 2, 0, 1)))
    riv *= (y > KICK + 0.01)
    pcol = np.array([0.175, 0.168, 0.148], np.float32)
    kp = 1.0 + 0.07 * (mA - 0.5) + 0.10 * (bA - 0.5)
    alb[panel] = pcol[None, :] * kp[panel][:, None]
    alb = _mixc(alb, pcol * 0.35, groove * panel)
    hgt += panel * (riv * 0.0018 - groove * 0.0008)
    alb = _mixc(alb, pcol * 1.1, riv * panel * 0.5)
    # damp: a darker tide along the floor, faint runs from the ceiling seams, rust spots at a few low rivets
    damp = panel * (1 - _ss(0.05, 0.6, y + (bA - 0.5) * 0.3)) * 0.45
    alb = alb * (1 - damp)[..., None]
    runs = panel * _ss(0.6, 0.78, _boxblur(sA, 2, 1)) * _ss(0.3, 0.8, fB) * _ss(1.0, 2.5, y) * 0.18
    alb = alb * (1 - runs)[..., None]
    rspot = panel * (riv > 0.05) * _ss(0.55, 0.8, gB) * _ss(1.2, 0.3, y)
    halo = panel * _ss(0.012, 0.0, np.minimum(np.hypot(da - 0.025, pv), np.hypot(dy - 0.025, ph))) * _ss(0.6, 0.85, gB) * _ss(1.0, 0.25, y)
    alb = _mixc(alb, [0.17, 0.07, 0.03], np.clip(rspot * 0.8 + halo * 0.5, 0, 1))

    # ---- stainless: kick plates, handrail, liner, the leaves' inside faces, the button plate
    st = np.array([0.36, 0.355, 0.345], np.float32)
    k = 1.0 + 0.05 * grain + 0.10 * (mA - 0.5) + 0.08 * (bA - 0.5)
    alb[steel] = st[None, :] * k[steel][:, None]
    shine += steel * 1.0
    # scuffs on the kick plates (horizontal, from boots and trolleys)
    kick = steel & (y < KICK + 0.002) & (np.abs(ny) < 0.5)
    sc = _ss(0.62, 0.8, fB) * _ss(0.25, 0.02, y)
    alb = _mixc(alb, st * 0.75, kick * sc * 0.5)
    # water on the leaves' inside and the liner: a few runs, scale at the foot
    runs_s = steel * vert_mask(ny) * _ss(0.55, 0.75, sA) * _ss(0.25, 0.75, fB) * 0.10
    alb = alb * (1 - runs_s)[..., None]
    foot = steel * (1 - _ss(0.0, 0.18, y + (mA - 0.5) * 0.08)) * _ss(0.3, 0.75, mA) * (np.abs(ny) < 0.5)
    alb = _mixc(alb, [0.50, 0.48, 0.42], foot * 0.6)
    shine *= (1 - foot)

    # ---- the floor: galvanised chequer plate, polished on the tops in the middle; aluminium on the threshold
    th, ttop = _tread(x, z)
    wear = _ss(1.0, 0.2, np.hypot(x * 1.2, (z + 1.0) * 0.8)) * 0.8 + 0.2
    thr = z > CZ0 - 0.001
    fc = np.where(thr[..., None], np.array([0.46, 0.46, 0.45], np.float32), np.array([0.26, 0.26, 0.255], np.float32))
    alb[tread] = (fc * (1 + 0.08 * (mA - 0.5))[..., None])[tread]
    alb = _mixc(alb, fc * 1.55, ttop * wear * tread * 0.55)
    valley = tread * _ss(0.0006, 0.0, th)
    edge_d = np.minimum(CHW - np.abs(x), np.where(thr, 9.0, np.minimum(z - CZ1, CZ0 - z)))
    dirt = valley * (0.3 + 0.35 * _ss(0.3, 0.0, edge_d)) * (0.5 + 0.6 * gB)
    alb = _mixc(alb, [0.035, 0.032, 0.027], np.clip(dirt, 0, 1) * 0.8)
    scl = tread * _ss(0.12, 0.0, edge_d) * _ss(0.3, 0.7, mA) * valley
    alb = _mixc(alb, [0.42, 0.40, 0.35], scl * 0.35)
    hgt += tread * th
    shine += tread * ttop * 0.6

    # ---- rubber
    alb[rubber] = np.array([0.022, 0.022, 0.023], np.float32)
    # ---- ceiling: off-white enamel, a vent of slots toward the back, faint damp rings in the corners
    cc = np.array([0.46, 0.44, 0.40], np.float32)
    alb[ceil] = cc[None, :] * (1 + 0.06 * (mA - 0.5))[ceil][:, None]
    top = ceil & (ny < -0.9) & (y > CH - 0.01)
    vz = z - (CZ1 + 0.35)
    slot = top & (np.abs(vz) < 0.09) & (np.abs(x) < 0.32) & (np.abs(((x + 0.32) / 0.04) % 1 - 0.5) < 0.25)
    alb = _mixc(alb, [0.02, 0.02, 0.02], slot.astype(np.float32) * 0.9)
    hgt -= slot * 0.002
    cr = top * _ss(0.55, 0.0, np.minimum(CHW - np.abs(x), np.minimum(z - CZ1, CZ0 - z))) * _ss(0.4, 0.7, bA) * 0.25
    alb = _mixc(alb, [0.30, 0.26, 0.19], cr)
    # ---- buttons: stainless caps with black arrows
    alb[btn] = st[None, :] * (1 + 0.03 * grain[btn])[:, None]
    shine += btn * 1.0
    for (bx, by), up in ((BTNS['up'], 1), (BTNS['down'], -1)):
        m = btn & (nz < -0.9) & (np.hypot(x - bx, y - by) < BTN_R - 0.001)
        am = _arrow_mask(-(x - bx), y - by, up) * m
        alb = _mixc(alb, [0.02, 0.02, 0.02], am)
        shine *= (1 - am)
        hgt -= am * 2e-4

    # ---- relief, lit by the lamp (the inside is drawn unlit, so its bumps are shaded into the albedo)
    lamp = np.array(LAMP, np.float32)
    # surface tangents from the position buffer (zero in the gutters, where nothing is shaded)
    Pu = (np.roll(P, -1, axis=1) - np.roll(P, 1, axis=1)) * 0.5
    Pv = (np.roll(P, -1, axis=0) - np.roll(P, 1, axis=0)) * 0.5
    lu = np.linalg.norm(Pu, axis=-1)
    lv = np.linalg.norm(Pv, axis=-1)
    ok = (lu > 1e-5) & (lv > 1e-5) & (np.abs(lu - lv) < 0.3 * np.maximum(lu, lv))
    hu = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * 0.5
    hv = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * 0.5
    Tu = Pu / np.maximum(lu, 1e-6)[..., None] ** 2
    Tv = Pv / np.maximum(lv, 1e-6)[..., None] ** 2
    grad = Tu * hu[..., None] + Tv * hv[..., None]
    grad = np.where(ok[..., None], grad, 0)
    Np = N - grad
    Np /= np.linalg.norm(Np, axis=-1, keepdims=True) + 1e-6
    L = lamp[None, None, :] - P
    L /= np.linalg.norm(L, axis=-1, keepdims=True) + 1e-6
    d0 = np.clip((N * L).sum(-1), 0.0, 1.0)
    d1 = np.clip((Np * L).sum(-1), 0.0, 1.0)
    shade = np.clip((d1 + 0.12) / (d0 + 0.12), 0.35, 1.35)
    alb = alb * (1 + (shade - 1) * 0.85)[..., None]
    alb = np.clip(alb, 0, 1)
    rgba = np.concatenate([_srgb(alb), np.clip(shine, 0, 1)[..., None]], axis=-1)
    _save_rgba(MODELS + 'elevator_int_albedo.png', rgba)

def vert_mask(ny):
    import numpy as np
    return (np.abs(ny) < 0.5).astype(np.float32)

def _save_rgba(path, rgba):
    import numpy as np
    h, w = rgba.shape[:2]
    name = 'DB_out_' + os.path.basename(path)
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
