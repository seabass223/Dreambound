# Dreambound: the gatehouse at the Rocks rim where the rope bridge used to start, and the staircase that unfolds from it
# down to the End stack (src/props/gatehouse.js places both; src/world/stacks/rocks.js picks the spot). Executed inside
# dbkit.py's namespace by build_gatehouse.py.
#
# Frame: origin at the doorway's centre on the outer face of the housing (the sill), at the corridor's floor level; y up;
# +z out over the gap (toward End, along the stairs); x across (+x to the LEFT as you look out). The game puts the
# floor a few cm above the highest ground under the corridor and the outer face 0.23 m proud of the rim.
#
# The gatehouse: a reinforced-concrete housing cast on the cliff edge (HW either side of the doorway, HOUSE_D deep, TOP
# tall): a heavy chamfered portal frame round a 2.6 x 3.1 m opening, hazard stripes down its jambs, a projecting header
# with two flood lamps under it, the bay number (B-07) on a steel plaque and louvred vents above, an amber beacon on a
# bracket off the coping, a pipe railing on the roof, conduit to junction boxes, battered buttresses either side; below
# the floor a string course along the rim, then an apron cast down the cliff face, battered back into the rock, with
# rock anchors through it; a bay under the sill (dark, framed, striped) the stairs run out of. Behind it a corridor
# 2.6 m clear, 3.1 m high, open at the back toward the island (a portal frame and its plaque, an apron sloping into the
# ground), its floor level, its walls going down into the ground. The blast doors: two dark steel leaves with big yellow
# chevrons pointing at the seam, rivets, viewports, striped feet, that slide apart into pockets in the housing (parts
# DOOR_L / DOOR_R, pivot at each leaf's centre on the floor; `axis` and `travel` say which way and how far). Inside: the
# back of the doors (stiffeners, locking bars), keep-clear stripes on the floor, a dead control panel with one dim
# indicator, conduit, the door drives, a dead bulkhead lamp, BAY 07 stencilled on the wall. The beacon is part BEACON
# (spun about +y; its dome's brightness round it is in the vertex colour, two lobes, and two light fans turn with it).
#
# The stairs: one steel section (part STAIR, parked out at z = PARK so its AO is its own; its geometry is relative to
# the pivot, i.e. to the section's start) that the game repeats N times from the sill to the End landing: a landing
# (XL long, level) then a flight of K risers (RISE x RUN, open, grating treads with yellow nosings) down to the next
# section's landing; C-channel stringers and landing frame (striped), coupler plates and a hinge pin at its start,
# safety-yellow handrails (1.05 m over the landing, 0.895 m over the nosings, meeting the next section's) on posts, and a
# shallow truss under it. Its far end is (0, -HS, LS).
#
# Materials (one mesh each): 'concrete' (gatehouse_concrete.png + normal, a 2.5 m tile of weathered board-formed
# concrete: boards, panel joints, tie holes, rain streaks), 'floor' (gatehouse_floor.png, trowelled slab concrete, 2.5 m),
# 'steel' (gatehouse_steel.png + normal, dark painted steel, 1 m tile), 'paint' (gatehouse_paint.png + normal, worn
# safety yellow, 1 m), 'stencil' (the same paint, the letters: no AO atlas), 'grating' (gatehouse_grating.png, its holes
# in gatehouse_grating_mask.png, 0.3 m tile; no atlas), 'glass' (viewports, the dead lamp), 'lamp' (flood-lamp lenses),
# 'beacon', 'beam' (light cones: uv.v 0 at the lens to 1 at the end, uv.u round them), 'indicator' (the panel's lamp).
# concrete, floor, steel and paint take the AO atlas gatehouse_ao.png (baked with a stand-in of the ground and the cliff
# round it as the occluder). The painted shapes on the housing and the doors (stripes, chevrons, floor lines) are their
# own meshes, '<material>@decal' (layer 'decal'), which the game draws with a polygon offset.
# Named empties: META (sizes, the stairs' nominal numbers), LAMP_0/1 (lens centres, `aim`),
# BEACON_GLOW, INDICATOR, PANEL. The COLLIDER holds the housing, the corridor walls and floor, the buttresses, the back
# threshold; the game adds the doors' and each section's own.

from contextlib import nullcontext

MODELS = ROOT + '/public/models/'
TMP = os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_gatehouse')

MATS.update({
    'concrete': ((0.55, 0.54, 0.51), 0.9), 'steel': ((0.07, 0.075, 0.08), 0.55), 'paint': ((0.8, 0.55, 0.05), 0.6),
    'grating': ((0.12, 0.12, 0.12), 0.6), 'lamp': ((1.0, 0.9, 0.7), 1.0), 'beacon': ((1.0, 0.5, 0.05), 1.0),
    'beam': ((1.0, 0.9, 0.7), 1.0), 'indicator': ((1.0, 0.2, 0.1), 1.0), 'stencil': ((0.8, 0.55, 0.05), 0.6),
    'floor': ((0.42, 0.41, 0.39), 0.8),
})
# (the grating is open mesh: it neither takes nor casts AO)
# (and the stencilled letters are too fine to take it: they are 'stencil', the yellow paint without the atlas)
NO_BAKE = {'glass', 'lamp', 'beacon', 'beam', 'indicator', 'collider', 'grating', 'stencil'}
BAKE_MATS = {'concrete', 'steel', 'paint', 'floor'}

# ---- the gatehouse
OPEN_HW, OPEN_H = 1.3, 3.1           # the doorway (and corridor): half width, clear height
HW = 3.3                             # housing half width
HOUSE_D = 1.45                       # housing depth (z = -HOUSE_D .. 0)
TOP = 5.0                            # housing roof
APRON_Y = -5.6                       # the apron's foot, down the cliff face
PLINTH_Y = -1.3                      # the housing's base (the rim is about 1.2 m under the floor), a string course over the apron
APRON_BACK = -1.0                    # its back (in the rock)
DOOR_Z, DOOR_T = -0.45, 0.22         # leaves: plane, thickness
LEAF_W, LEAF_Y0, LEAF_Y1 = 1.36, -0.015, 3.24
SLIDE = 1.4                          # how far each leaf slides into its pocket
CORR_Z1 = -6.2                       # the back opening
WALL_T = 0.45
ROOF_Y1 = OPEN_H + 0.45
FOOT = -1.6                          # corridor walls and floor go this far down into the ground
FRAME_W, FRAME_P = 0.55, 0.24        # the portal frame's face width and how far it stands proud
HEAD_Y0, HEAD_Y1, HEAD_P = 3.78, 4.18, 0.7   # the header canopy
BAY = (1.05, -0.5, -0.06, -0.85)     # the stair bay under the sill: half width, bottom, top (the sill plate), depth
BACK_Z = -6.5                        # back of the back portal frame
LAMPS = [(2.05, 3.68, 0.48), (-2.05, 3.68, 0.48)]
BEACON_P = (0.0, TOP + 0.16, 0.26)   # on a bracket off the coping's front, over the plaque

# ---- the stairs (nominal: the game fits them to the measured sill -> End landing exactly)
N = 14
LS, HS = 4.1743, 1.2423              # one section: plan length, drop (measured: sill -> End landing / N)
K = 8                                # risers per flight
RISE = HS / K
RUN = 0.37
XL = LS - (K - 1) * RUN              # the landing
TREAD_HW = 0.86                      # clear between the stringers
STR_X, STR_T, STR_D = 0.9, 0.08, 0.27
RAIL_H = 1.05
PARK = 60.0                          # where the section is built (out of everything's way for its AO)

CON = (1.0, 1.0, 1.0)
STEEL = (1.0, 1.0, 1.0)
BLACK = (0.22, 0.22, 0.22)           # black paint on steel (hazard stripes)
DARK = (0.55, 0.55, 0.58)            # the doors: darker steel


def jit(c, k=0.05):
    f = 1.0 + rng.uniform(-k, k)
    return (c[0] * f, c[1] * f, c[2] * f)


def con_col(co):
    """Large-scale weathering on the concrete (frame coords): damp and darker toward the foot of the apron and the
    ground line, a little greener low down, washed paler just under the coping."""
    y = co[1]
    k = 1.0
    if y < 0.4:
        k *= 0.82 + 0.18 * max(0.0, min(1.0, (y - APRON_Y) / (0.4 - APRON_Y)))
    if y > TOP - 0.5:
        k *= 1.04
    g = 1.0 + (0.03 if y < 0.0 else 0.0)
    return (k * 0.98, k * g, k * 0.95)


def CB(w, h, d, x, y, z, ry=0.0, rx=0.0, rz=0.0, bevel=0.02, tint=CON, col=False, colfn=con_col):
    """A concrete block with chamfered edges (UVs in metres of the 2.5 m tile, v up the faces)."""
    emit(bm_box(w, h, d, bevel, 1), 'concrete', xf(x, y, z, ry, rx, rz), tint, 2.5, None, None, False, 0.0, colfn=colfn)
    if col:
        C(x, y, z, w, h, d, ry)


def FLOOR(x0, y0, z0, x1, y1, z1, col=False):
    """A floor slab: trowelled concrete (gatehouse_floor.png, no formwork marks), UVs in metres of its 2.5 m tile."""
    x0, x1 = min(x0, x1), max(x0, x1)
    z0, z1 = min(z0, z1), max(z0, z1)
    emit(bm_box(x1 - x0, y1 - y0, z1 - z0, 0.0), 'floor', xf((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), WHITE, 2.5, None, None, False)
    if col:
        C((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0)


def CBOX(x0, y0, z0, x1, y1, z1, **kw):
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    z0, z1 = min(z0, z1), max(z0, z1)
    CB(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, **kw)


def SB(w, h, d, x, y, z, ry=0.0, rx=0.0, rz=0.0, bevel=0.006, tint=STEEL, mat='steel'):
    emit(bm_box(w, h, d, bevel, 1), mat, xf(x, y, z, ry, rx, rz), tint, 1.0, None, None, False)


def SBOX(x0, y0, z0, x1, y1, z1, **kw):
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    z0, z1 = min(z0, z1), max(z0, z1)
    SB(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, **kw)


def prism(mat, poly, w0, w1, plane, tint=CON, tile=2.5, colfn=None, M=None):
    emit(bm_prism(poly, w0, w1, plane), mat, M, tint, tile, None, None, False, colfn=colfn)


def pipe(pts, r, mat='steel', tint=STEEL, sides=10):
    emit(bm_tube([Vector(p) for p in pts], r, sides), mat, None, tint, 1.0, None, None, True)


def rounded(pts, r, n=4):
    """A polyline with its corners rounded (radius r, n segments each): for pipes and rails."""
    if len(pts) < 3:
        return [Vector(p) for p in pts]
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d0, d1 = (b - a), (c - b)
        l0, l1 = d0.length, d1.length
        d0.normalize(); d1.normalize()
        t = min(r, l0 * 0.45, l1 * 0.45)
        p0, p1 = b - d0 * t, b + d1 * t
        for k in range(n + 1):
            s = k / n
            out.append((p0 * (1 - s) + b * s) * (1 - s) + (b * (1 - s) + p1 * s) * s)
    out.append(P[-1])
    return out


# Painted shapes stand only 2-4 mm off their faces: in the game's 24-bit depth buffer they would fight them from about
# 60 m out (End, looking back), so on the housing and the doors they go to their own '@decal' meshes, which the game
# draws with a polygon offset. (The stairs' few are only seen close: they stay in the section's own meshes.)
DECAL_LAYER = [True]


def decal(mat, poly, O, U, V, N, off=0.004, tint=WHITE, thick=0.0):
    """A flat painted shape (2D polygon in (u, v), CCW) on a face: O + U u + V v, raised `off` along N."""
    O, U, V, N = Vector(O), Vector(U), Vector(V), Vector(N)
    area = sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(len(poly)))
    if area < 0:
        poly = list(reversed(poly))
    pts = [O + U * u + V * v + N * off for (u, v) in poly]
    if U.cross(V).dot(N) < 0:
        pts = list(reversed(pts))
    with (layer('decal') if DECAL_LAYER[0] else nullcontext()):
        if thick > 0:
            bm = bmesh.new()
            top = [bm.verts.new(p) for p in pts]
            bot = [bm.verts.new(p - N * thick) for p in pts]
            bm.faces.new(top)
            m = len(pts)
            for i in range(m):
                j = (i + 1) % m
                bm.faces.new((bot[i], bot[j], top[j], top[i]))
            emit(bm, mat, None, tint, 1.0, None, None, False)
        else:
            emit(bm_poly(pts), mat, None, tint, 1.0, None, None, False)


def clip_poly(poly, x0, x1, y0, y1):
    """Sutherland-Hodgman: a convex polygon clipped to a rectangle."""
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out
    def ix(a, b, x):
        t = (x - a[0]) / (b[0] - a[0]); return (x, a[1] + (b[1] - a[1]) * t)
    def iy(a, b, y):
        t = (y - a[1]) / (b[1] - a[1]); return (a[0] + (b[0] - a[0]) * t, y)
    p = poly
    for (inside, inter) in ((lambda q: q[0] >= x0, lambda a, b: ix(a, b, x0)), (lambda q: q[0] <= x1, lambda a, b: ix(a, b, x1)),
                            (lambda q: q[1] >= y0, lambda a, b: iy(a, b, y0)), (lambda q: q[1] <= y1, lambda a, b: iy(a, b, y1))):
        if not p:
            return []
        p = clip(p, inside, inter)
    return p


def hazard(O, U, V, N, L, Wd, period=0.32, off=0.004, flip=False, thick=0.0):
    """Yellow and black diagonal stripes over the rectangle [0, L] x [0, Wd] of a face (45 degrees)."""
    h = period / 2
    s = -1.0 if flip else 1.0
    k0 = int(math.floor((-Wd - 1.0) / h)) - 1
    k1 = int(math.ceil((L + Wd + 1.0) / h)) + 1
    for k in range(k0, k1):
        a, b = k * h, (k + 1) * h
        if s > 0:
            quad = [(a, 0), (b, 0), (b + Wd, Wd), (a + Wd, Wd)]
        else:
            quad = [(a + Wd, 0), (b + Wd, 0), (b, Wd), (a, Wd)]
        poly = clip_poly(quad, 0.0, L, 0.0, Wd)
        if len(poly) < 3:
            continue
        if k % 2 == 0:
            decal('paint', poly, O, U, V, N, off, jit(WHITE, 0.04), thick)
        else:
            decal('steel', poly, O, U, V, N, off, BLACK, thick)


def rivets(pts, N, r=0.017, h=0.012, mat='steel', tint=STEEL):
    """Domed rivet heads standing on a face with normal N (an axis: (1,0,0), (0,0,1), ...)."""
    n = Vector(N)
    for p in pts:
        bm = bm_lathe([(r, 0.0), (r, h * 0.35), (r * 0.75, h * 0.8), (r * 0.35, h), (0.0, h)], 6)
        # lathe axis is +y: turn it onto N
        if abs(n.y) > 0.9:
            R = Matrix.Identity(4) if n.y > 0 else Matrix.Rotation(PI, 4, 'X')
        else:
            axis = Vector((0, 1, 0)).cross(n).normalized()
            R = Matrix.Rotation(math.acos(max(-1, min(1, n.y))), 4, axis)
        emit(bm, mat, Matrix.Translation(Vector(p)) @ R, tint, 1.0, None, None, True)


def louvre(O, U, V, N, w, h, slats=6):
    """A louvred steel vent on a face: a frame standing proud, a dark backing, angled slats between."""
    O, U, V, N = Vector(O), Vector(U), Vector(V), Vector(N)
    Rm = Matrix(((U.x, V.x, N.x, 0), (U.y, V.y, N.y, 0), (U.z, V.z, N.z, 0), (0, 0, 0, 1)))
    t = 0.05
    def box_at(u0, u1, v0, v1, n0, n1, tint=STEEL):
        c = O + U * ((u0 + u1) / 2) + V * ((v0 + v1) / 2) + N * ((n0 + n1) / 2)
        emit(bm_box(u1 - u0, v1 - v0, n1 - n0, 0.004), 'steel', Matrix.Translation(c) @ Rm, tint, 1.0, None, None, False)
    box_at(-w / 2, w / 2, -h / 2, -h / 2 + t, 0.0, 0.07)
    box_at(-w / 2, w / 2, h / 2 - t, h / 2, 0.0, 0.07)
    box_at(-w / 2, -w / 2 + t, -h / 2 + t, h / 2 - t, 0.0, 0.07)
    box_at(w / 2 - t, w / 2, -h / 2 + t, h / 2 - t, 0.0, 0.07)
    box_at(-w / 2 + t, w / 2 - t, -h / 2 + t, h / 2 - t, 0.001, 0.008, (0.1, 0.1, 0.1))     # dark behind the slats
    sp = (h - 2 * t) / slats
    for i in range(slats):
        v = -h / 2 + t + sp * (i + 0.5)
        c = O + V * v + N * 0.035
        emit(bm_box(w - 2 * t, sp * 1.2, 0.006, 0.0), 'steel', Matrix.Translation(c) @ Rm @ Matrix.Rotation(-0.7, 4, 'X'),
             (0.85, 0.85, 0.85), 1.0, None, None, False)


_FONTS = {}


def text_polys(s, size, path='C:/Windows/Fonts/STENCIL.TTF', res=5):
    """Glyph triangles of `s` (Blender FONT curve -> mesh), in metres, the baseline's left end at (0, 0); and its width."""
    cu = bpy.data.curves.new('DB_txt', 'FONT')
    cu.body = s
    f = _FONTS.get(path)
    if f is None:
        try:
            f = bpy.data.fonts.load(path, check_existing=True)
        except Exception:
            f = None
        _FONTS[path] = f
    if f:
        cu.font = f
    cu.size = size
    cu.resolution_u = res
    cu.fill_mode = 'BOTH'
    ob = bpy.data.objects.new('DB_txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    tris = [[(me.vertices[i].co.x, me.vertices[i].co.y) for i in p.vertices] for p in me.polygons]
    xs = [v.co.x for v in me.vertices]
    w = (max(xs) - min(xs)) if xs else 0.0
    x0 = min(xs) if xs else 0.0
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    return [[(x - x0, y) for (x, y) in t] for t in tris], w


def stencil(s, size, centre, U, V, N, mat='stencil', tint=WHITE, off=0.004):
    """Text painted on a face, centred on `centre` (its cap height about `size` * 0.7)."""
    tris, w = text_polys(s, size)
    U, V = Vector(U), Vector(V)
    O = Vector(centre) - U * (w / 2) - V * (size * 0.35)
    bm = bmesh.new()
    N_ = Vector(N)
    for t in tris:
        pts = [O + U * u + V * v + N_ * off for (u, v) in t]
        if U.cross(V).dot(N_) < 0:
            pts = list(reversed(pts))
        bm.faces.new([bm.verts.new(p) for p in pts])
    emit(bm, mat, None, tint, 1.0, None, None, False)


# ============================================================================ the housing
def housing():
    x0, x1 = OPEN_HW, HW
    zdf, zdb = DOOR_Z + DOOR_T / 2 + 0.03, DOOR_Z - DOOR_T / 2 - 0.03     # the door band (leaves and pockets)
    po = x0 + SLIDE + 0.12                                               # the pockets' far end
    # Piers either side of the doorway, from the floor to the roof: a front skin and a back skin with the leaves'
    # pocket between them (open only toward the doorway), and its far end.
    for s in (-1, 1):
        CBOX(s * x0, -0.06, zdf, s * x1, TOP, 0.0)
        CBOX(s * x0, -0.06, -HOUSE_D, s * x1, TOP, zdb)
        CBOX(s * po, -0.06, zdb, s * x1, TOP, zdf)
        CBOX(s * x0, LEAF_Y1 + 0.03, zdb, s * po, TOP, zdf)                              # pocket top
        SBOX(s * x0, LEAF_Y1 - 0.02, zdb + 0.005, s * po, LEAF_Y1 + 0.035, zdf - 0.005, tint=(0.4, 0.4, 0.4))   # its rail
        C(s * (x0 + x1) / 2, TOP / 2, -HOUSE_D / 2, x1 - x0, TOP, HOUSE_D)
    # the head over the doorway, in front of and behind the door band; the leaves run up into a slot between
    CBOX(-x0 - 0.01, OPEN_H, zdf, x0 + 0.01, TOP, 0.0)
    CBOX(-x0 - 0.01, OPEN_H, -HOUSE_D, x0 + 0.01, TOP, zdb)
    CBOX(-x0 - 0.01, LEAF_Y1 + 0.03, zdb, x0 + 0.01, TOP, zdf)
    # roof coping, a little proud all round
    CBOX(-HW - 0.08, TOP, -HOUSE_D - 0.08, HW + 0.08, TOP + 0.16, 0.1, bevel=0.03)
    # Below the floor down to the rim: the housing's base with the stair bay cut into it under the sill, and its footing
    # behind on the cap; a string course along the rim; under it the apron cast down the cliff face, battered back into
    # the rock.
    bw, by0, by1, bd = BAY
    for s in (-1, 1):
        CBOX(s * bw, PLINTH_Y, APRON_BACK, s * HW, -0.06, 0.0)
    CBOX(-bw, PLINTH_Y, APRON_BACK, bw, by0, 0.0)
    CBOX(-bw, by0, APRON_BACK, bw, by1, bd)                                          # the bay's back
    CBOX(-HW, PLINTH_Y, -HOUSE_D, HW, -0.06, APRON_BACK)
    poly = [(-0.12, PLINTH_Y - 0.2), (0.16, PLINTH_Y - 0.2), (0.16, PLINTH_Y + 0.02), (0.02, PLINTH_Y + 0.12), (-0.12, PLINTH_Y + 0.12)]
    emit(bm_prism(poly, -HW - 0.02, HW + 0.02, 'z'), 'concrete', None, CON, 2.5, None, None, False, colfn=con_col)
    poly = [(APRON_BACK, PLINTH_Y - 0.15), (-0.02, PLINTH_Y - 0.15), (-0.62, APRON_Y), (APRON_BACK, APRON_Y)]
    emit(bm_prism(poly, -HW + 0.05, HW - 0.05, 'z'), 'concrete', None, (0.9, 0.9, 0.88), 2.5, None, None, False, colfn=con_col)
    # rock anchors through the apron: square bearing plates with a nut, on the battered face
    batter = 0.6 / (APRON_Y - PLINTH_Y + 0.15)
    for y, xs_ in ((-2.5, (-2.2, -1.1, 0.0, 1.1, 2.2)), (-4.1, (-1.65, -0.55, 0.55, 1.65))):
        for x in xs_:
            zf = -0.02 + (y - (PLINTH_Y - 0.15)) * batter
            M = xf(x, y, zf, 0.0, math.atan(batter), 0.0)
            emit(bm_box(0.2, 0.2, 0.025, 0.006), 'steel', M, (1.5, 1.45, 1.4), 1.0, None, None, False)
            emit(bm_cyl(0.03, 0.03, 0.05, 6), 'steel', M @ xf(0, 0, 0.025, 0, PI / 2, 0), (1.3, 1.3, 1.3), 1.0, None, None, False)
    # Floors at the floor's level: the steel sill over the bay (to the door band), the track in the door band, the
    # concrete floor behind the doors.
    SBOX(-x0 - 0.02, -0.06, zdf, x0 + 0.02, 0.0, 0.025, tint=(0.75, 0.75, 0.75))
    SBOX(-x0, -0.075, zdb, x0, -0.055, zdf, tint=(0.12, 0.12, 0.12))
    for z in (zdb, zdf):
        SBOX(-x0, -0.06, z - 0.02, x0, 0.0, z + 0.02, tint=(0.5, 0.5, 0.5))
    FLOOR(-x0 - 0.01, -0.06, -HOUSE_D, x0 + 0.01, 0.0, zdb - 0.02)
    C(0, -0.6, -HOUSE_D / 2, 2 * HW, 1.2, HOUSE_D)
    C(0, (APRON_Y - 1.2) / 2, APRON_BACK / 2, 2 * HW, -1.2 - APRON_Y, -APRON_BACK)


def bay():
    """The slot under the sill the stairs run out of: dark inside, a steel frame round its mouth, rails on its floor."""
    bw, by0, by1, bd = BAY
    SBOX(-bw - 0.06, by0 - 0.05, -0.0, bw + 0.06, by0 + 0.015, 0.03)                 # the mouth's bottom angle
    for s in (-1, 1):
        SBOX(s * bw - 0.06, by0 - 0.05, -0.0, s * bw + 0.06, by1, 0.03)               # its sides
    for x in (-0.9, 0.9):                                                           # guide rails
        SBOX(x - 0.04, by0, bd + 0.02, x + 0.04, by0 + 0.09, -0.02, tint=(0.5, 0.5, 0.5))
    SBOX(-bw + 0.02, by0 + 0.02, bd - 0.02, bw - 0.02, by1 - 0.02, bd + 0.01, tint=(0.12, 0.12, 0.12))
    # hazard stripes on the sill's front edge (the bay's lintel), and on the apron under the bay's mouth
    hazard((-bw - 0.06, by1, 0.025), (1, 0, 0), (0, 1, 0), (0, 0, 1), 2 * bw + 0.12, -by1, 0.24, off=0.002)
    hazard((-bw - 0.06, by0 - 0.3, 0.0), (1, 0, 0), (0, 1, 0), (0, 0, 1), 2 * bw + 0.12, 0.24, 0.4, off=0.003)


def portal_frame():
    """The heavy frame standing proud round the doorway (jambs and head), chamfered into the opening and on its outer
    edge, hazard stripes down the jambs, a steel liner on the opening's arrises."""
    fw, fp = FRAME_W, FRAME_P
    ch, co = 0.18, 0.06   # the reveal chamfer, the outer edge's
    yt = OPEN_H + fw
    for s in (-1, 1):
        xi, xo = s * OPEN_HW, s * (OPEN_HW + fw)
        poly = [(xi, 0.0), (xi + s * ch, fp), (xo - s * co, fp), (xo, fp - co), (xo, -0.02), (xi, -0.02)]
        emit(bm_prism(poly, -0.06, yt, 'y'), 'concrete', None, CON, 2.5, None, None, False, colfn=con_col)
        lo = min(xi + s * ch, xo - s * co)
        hazard((lo, 0.04, fp), (1, 0, 0), (0, 1, 0), (0, 0, 1), fw - ch - co, OPEN_H - 0.1, 0.36, off=0.003, flip=(s < 0))
        # its foot: a chamfered block on the plinth
        CBOX(xi + s * 0.02, -0.06, -0.02, xo + s * 0.04, 0.0, fp + 0.04, bevel=0.01)
    poly = [(OPEN_H, 0.0), (OPEN_H + ch, fp), (yt - co, fp), (yt, fp - co), (yt, -0.02), (OPEN_H, -0.02)]
    emit(bm_prism([(q[1], q[0]) for q in poly], -OPEN_HW - fw + 0.001, OPEN_HW + fw - 0.001, 'z'), 'concrete', None, CON, 2.5, None, None, False, colfn=con_col)
    # mitred corners: the head's ends over the jambs' tops
    for s in (-1, 1):
        CBOX(s * (OPEN_HW + 0.02), OPEN_H + ch, -0.02, s * (OPEN_HW + fw), yt, fp - 0.002, bevel=0.0)
    # steel liner on the opening's arrises (heavy angles), bolted
    for s in (-1, 1):
        SBOX(s * OPEN_HW - 0.04, 0.0, -0.32, s * OPEN_HW + 0.012, OPEN_H, 0.03, tint=(0.55, 0.55, 0.55))
        rivets([(s * (OPEN_HW - 0.04), y, -0.15) for y in (0.4, 1.2, 2.0, 2.8)], (-s, 0, 0), r=0.016, h=0.01)
    SBOX(-OPEN_HW - 0.04, OPEN_H - 0.012, -0.32, OPEN_HW + 0.04, OPEN_H + 0.04, 0.03, tint=(0.55, 0.55, 0.55))


def header():
    """The projecting canopy over the frame, carrying the flood lamps and the beacon; plaque, vents and conduit above."""
    y0, y1, p = HEAD_Y0, HEAD_Y1, HEAD_P
    xh = 2.45
    # canopy with a chamfered underside front edge
    poly = [(y0 + 0.12, p), (y1, p), (y1, -0.02), (y0, -0.02), (y0, p - 0.12)]
    emit(bm_prism([(q[1], q[0]) for q in poly], -xh, xh, 'z'), 'concrete', None, CON, 2.5, None, None, False, colfn=con_col)
    # hazard band along its front face
    hazard((-xh + 0.05, y0 + 0.14, p), (1, 0, 0), (0, 1, 0), (0, 0, 1), 2 * xh - 0.1, 0.16, 0.36, off=0.003)
    # drip groove (a dark slot under the front edge)
    SBOX(-xh + 0.05, y0 - 0.005, p - 0.2, xh - 0.05, y0 + 0.004, p - 0.17, tint=(0.15, 0.15, 0.15))
    # flood lamps: a bracket from the underside, a yoke, the lamp body tilted down toward the stairs
    for (lx, ly, lz) in LAMPS:
        pitch = 0.5
        SBOX(lx - 0.05, ly, lz - 0.05, lx + 0.05, y0 + 0.01, lz + 0.05)                 # stem
        for s in (-1, 1):
            SBOX(lx + s * 0.25 - 0.015, ly - 0.18, lz - 0.03, lx + s * 0.25 + 0.015, ly + 0.02, lz + 0.03)   # yoke arms
        SBOX(lx - 0.265, ly + 0.0, lz - 0.04, lx + 0.265, ly + 0.03, lz + 0.04)
        M = xf(lx, ly - 0.16, lz, 0.0, pitch, 0.0)
        body = bm_box(0.46, 0.32, 0.22, 0.03)
        emit(body, 'steel', M, (0.75, 0.75, 0.75), 1.0, None, None, False)
        # cooling fins on the back
        for i in range(5):
            emit(bm_box(0.42, 0.014, 0.07, 0.0), 'steel', M @ xf(0, -0.12 + i * 0.06, -0.14), (0.7, 0.7, 0.7), 1.0, None, None, False)
        # bezel and lens (the lens faces the lamp's +z, i.e. out and down)
        emit(bm_box(0.46, 0.32, 0.03, 0.012), 'steel', M @ xf(0, 0, 0.12), (0.5, 0.5, 0.5), 1.0, None, None, False)
        emit(bm_box(0.38, 0.24, 0.012, 0.0), 'lamp', M @ xf(0, 0, 0.132), WHITE, 1.0, None, None, False)
        # a guard grille over the lens
        for i in range(4):
            emit(bm_box(0.008, 0.26, 0.008, 0.0), 'steel', M @ xf(-0.135 + i * 0.09, 0, 0.145), (0.4, 0.4, 0.4), 1.0, None, None, False)
        aim = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
        cen = M @ Vector((0, 0, 0.14))
        empty('LAMP_%d' % LAMPS.index((lx, ly, lz)), tuple(cen), aim=[aim.x, aim.y, aim.z])
        # the light cone: v along the beam (0 at the lens), opening out over 9 m
        beam_cone(cen, aim, 0.16, 1.5, 9.0)
    # The beacon: a base on the canopy, a guard cage, the amber dome (part BEACON, spun by the game).
    bx, by, bz = BEACON_P
    CYL('steel', 0.15, 0.16, 0.06, bx, by + 0.03, bz, segs=16, tint=(0.4, 0.4, 0.4))
    SBOX(bx - 0.18, by - 0.03, 0.08, bx + 0.18, by, bz + 0.17, tint=(0.55, 0.55, 0.55))          # bracket plate
    for sx in (-1, 1):
        beam('steel', Vector((bx + sx * 0.1, by - 0.03, bz + 0.1)), Vector((bx + sx * 0.1, by - 0.32, 0.11)), 0.03, 0.03, (0.55, 0.55, 0.55))
    part('BEACON', (bx, by + 0.06, bz), axis=(0, 1, 0))
    with into('BEACON'):
        prof = [(0.0, 0.0), (0.13, 0.0), (0.13, 0.04), (0.126, 0.15), (0.11, 0.22), (0.07, 0.265), (0.0, 0.28)]
        bm = bm_lathe([(r, y) for (r, y) in prof], 24)
        emit(bm, 'beacon', xf(bx, by + 0.06, bz), WHITE, 1.0, None, None, True,
             colfn=lambda co: (lambda a: (a, a, a))(0.12 + 0.88 * abs(math.cos(math.atan2(co[2] - bz, co[0] - bx))) ** 4))
        # two light fans thrown out of it (they turn with it)
        for s in (-1, 1):
            beam_cone(Vector((bx + s * 0.12, by + 0.2, bz)), Vector((s, -0.02, 0)), 0.07, 1.0, 7.0)
    empty('BEACON_GLOW', (bx, by + 0.22, bz))
    for i in range(4):   # cage bars
        a = i * PI / 2 + PI / 4
        pipe([(bx + math.cos(a) * 0.155, by + 0.06, bz + math.sin(a) * 0.155), (bx + math.cos(a) * 0.155, by + 0.29, bz + math.sin(a) * 0.155),
              (bx + math.cos(a) * 0.05, by + 0.37, bz + math.sin(a) * 0.05)], 0.007, sides=5)
    CYL('steel', 0.04, 0.04, 0.02, bx, by + 0.375, bz, segs=10)
    # the bay plaque (B-07) on the upper wall, louvred vents either side, conduit from the lamps
    py = 4.6
    SBOX(-0.9, py - 0.3, -0.0, 0.9, py + 0.3, 0.05, tint=(0.35, 0.35, 0.37))
    rivets([(x, y, 0.05) for x in (-0.84, 0.84) for y in (py - 0.24, py + 0.24)], (0, 0, 1), r=0.014, h=0.01)
    stencil('B-07', 0.56, (0.0, py, 0.05), (1, 0, 0), (0, 1, 0), (0, 0, 1), off=0.003)
    for s in (-1, 1):
        louvre((s * 2.2, 4.6, 0.0), (1, 0, 0), (0, 1, 0), (0, 0, 1), 0.9, 0.5)
    # conduit: from each lamp's stem back along the canopy's top, down the piers to junction boxes
    for s in (-1, 1):
        lx = s * 1.95
        pts = [(lx, y1 + 0.02, 0.35), (lx, y1 + 0.05, 0.05), (s * 2.95, y1 + 0.05, 0.05), (s * 2.95, 1.25, 0.05)]
        pipe(rounded(pts, 0.12), 0.022)
        SBOX(s * 2.95 - 0.13, 0.95, 0.0, s * 2.95 + 0.13, 1.25, 0.11, tint=(0.6, 0.6, 0.62))
        rivets([(s * 2.95 + dx, 1.1 + dy, 0.11) for dx in (-0.1, 0.1) for dy in (-0.12, 0.12)], (0, 0, 1), r=0.009, h=0.006)
        pipe(rounded([(s * 2.95, 0.95, 0.05), (s * 2.95, 0.55, 0.05), (s * 2.95, 0.4, -0.3)], 0.1), 0.022)
        for y in (0.6, 2.0, 3.0):   # pipe clips
            SBOX(s * 2.95 - 0.04, y - 0.02, 0.0, s * 2.95 + 0.04, y + 0.02, 0.085, tint=(0.5, 0.5, 0.5))
    # cable from the beacon
    pipe(rounded([(0.12, by - 0.01, bz), (0.3, by - 0.05, 0.14), (0.3, by - 0.25, 0.12), (0.3, by - 0.3, 0.02)], 0.06), 0.012)


def beam_cone(origin, aim, r0, r1, length, segs=20):
    """An open cone along `aim` from `origin` (radius r0) to `length` (r1): the light's volume. uv.v runs 0..1 along it,
    uv.u round it."""
    o, a = Vector(origin), Vector(aim).normalized()
    ref = Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((1, 0, 0))
    u = a.cross(ref).normalized()
    w = a.cross(u).normalized()
    bm = bmesh.new()
    rings = []
    nr = 6
    for i in range(nr + 1):
        t = i / nr
        r = r0 + (r1 - r0) * t
        c = o + a * (length * t)
        rings.append([bm.verts.new(c + (u * math.cos(2 * PI * j / segs) + w * math.sin(2 * PI * j / segs)) * r) for j in range(segs + 1)])
    for i in range(nr):
        for j in range(segs):
            bm.faces.new((rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]))
    # uv from the ring and the segment (through a vertex lookup)
    vt = {}
    for i in range(nr + 1):
        for j in range(segs + 1):
            vt[rings[i][j]] = (j / segs, i / nr)
    emit(bm, 'beam', None, WHITE, 1.0, None, None, True, uvface=lambda f: [vt.get(l.vert, (0, 0)) for l in f.loops])


def buttresses():
    """Battered buttresses either side of the housing, from its roof down past the rim, their feet tapering back into
    the cliff face."""
    front = [(TOP - 0.15, -0.6), (-0.4, 0.42), (-2.6, 0.5), (-6.4, -0.75)]          # (y, z) down the sloping front
    def front_z(y):
        for (ya, za), (yb, zb) in zip(front, front[1:]):
            if yb <= y <= ya:
                return za + (zb - za) * (ya - y) / (ya - yb)
        return front[-1][1]
    for s in (-1, 1):
        x0, x1 = s * HW, s * (HW + 0.85)
        poly = [(-HOUSE_D, TOP - 0.15), (-0.6, TOP - 0.15), (0.42, -0.4), (0.5, -2.6), (-0.75, -6.4), (APRON_BACK, -6.4),
                (APRON_BACK, PLINTH_Y), (-HOUSE_D, PLINTH_Y)]
        emit(bm_prism(poly, min(x0, x1), max(x0, x1), 'z'), 'concrete', None, CON, 2.5, None, None, False, colfn=con_col)
        # a cap stone on its top, chamfered
        CBOX(x0, TOP - 0.15, -HOUSE_D - 0.04, x1 + s * 0.04, TOP + 0.05, -0.56, bevel=0.03)
        C(s * (HW + 0.42), (TOP - 1.4) / 2, -0.7, 0.85, TOP + 1.2, 1.5)
        # weep holes: short steel pipe stubs out of the face
        for y in (1.6, -1.0, -3.0):
            CYL('steel', 0.035, 0.035, 0.12, s * (HW + 0.42), y, front_z(y) - 0.02, segs=8, rx=PI / 2, tint=(0.25, 0.25, 0.25))


def roof_railing():
    """Pipe railing round the housing roof's front and sides."""
    y = TOP + 0.16
    h = 1.0
    xs = [-HW + 0.05, -HW / 3, HW / 3, HW - 0.05]
    zf = 0.0
    zb = -HOUSE_D + 0.05
    posts = [(x, zf) for x in xs] + [(-HW + 0.05, -0.75), (-HW + 0.05, zb), (HW - 0.05, -0.75), (HW - 0.05, zb)]
    for (x, z) in posts:
        CYL('steel', 0.024, 0.024, h, x, y + h / 2, z, segs=8)
        SBOX(x - 0.06, y, z - 0.06, x + 0.06, y + 0.012, z + 0.06)   # base plates
    for hh, r in ((h, 0.026), (h * 0.5, 0.02)):
        pts = [(-HW + 0.05, y + hh, zb), (-HW + 0.05, y + hh, zf), (HW - 0.05, y + hh, zf), (HW - 0.05, y + hh, zb)]
        pipe(rounded(pts, 0.1), r)
    SBOX(-HW + 0.05, y, zf - 0.005, HW - 0.05, y + 0.1, zf + 0.005, tint=(0.8, 0.8, 0.8))   # toe board


def corridor():
    """The corridor behind the housing: walls into the ground, the floor slab, the roof, the back portal and apron."""
    zf, zb = -HOUSE_D, CORR_Z1
    xi, xo = OPEN_HW, OPEN_HW + WALL_T
    for s in (-1, 1):
        CBOX(min(s * xi, s * xo), FOOT, zb, max(s * xi, s * xo), ROOF_Y1, zf + 0.02, col=True)
    CBOX(-xo, OPEN_H, zb, xo, ROOF_Y1, zf + 0.02)                          # roof slab
    CBOX(-xo - 0.06, ROOF_Y1, zb - 0.06, xo + 0.06, ROOF_Y1 + 0.12, zf + 0.04, bevel=0.025)   # roof coping
    FLOOR(-xi - 0.01, -0.35, zb, xi + 0.01, 0.0, zf + 0.02, col=True)   # floor slab
    # the floor's skirt down into the ground under the slab (closing the plinth under the corridor)
    CBOX(-xi, FOOT, zb + 0.1, xi, -0.35, zb + 0.4)
    # back portal frame, a little proud of the corridor walls, and the back apron sloping into the ground
    fz0, fz1 = BACK_Z, zb
    for s in (-1, 1):
        CBOX(min(s * xi, s * (xo + 0.2)), FOOT, fz0, max(s * xi, s * (xo + 0.2)), ROOF_Y1 + 0.25, fz1 + 0.01, bevel=0.03, col=True)
    CBOX(-xo - 0.2, OPEN_H, fz0, xo + 0.2, ROOF_Y1 + 0.25, fz1 + 0.01, bevel=0.03)
    FLOOR(-xi - 0.01, -0.35, fz0, xi + 0.01, 0.0, fz1 + 0.01, col=True)
    poly = [(fz0, 0.0), (fz0, -0.4), (fz0 - 1.2, -0.55), (fz0 - 1.2, -0.14)]
    emit(bm_prism([(z, y) for (z, y) in poly], -xi - 0.15, xi + 0.15, 'z'), 'concrete', None, (0.92, 0.92, 0.9), 2.5, None, None, False, colfn=con_col)
    # a kerb of steel along the threshold with stripes, and the plaque over the back opening
    SBOX(-xi, -0.02, fz0 - 0.01, xi, 0.004, fz0 + 0.07, tint=(0.6, 0.6, 0.6))
    hazard((xi, OPEN_H + 0.04, fz0 - 0.002), (-1, 0, 0), (0, 1, 0), (0, 0, -1), 2 * xi, 0.2, 0.36, off=0.002)
    SBOX(-0.48, OPEN_H + 0.33, fz0 - 0.05, 0.48, OPEN_H + 0.65, fz0, tint=(0.35, 0.35, 0.37))
    stencil('B-07', 0.27, (0.0, OPEN_H + 0.49, fz0 - 0.05), (-1, 0, 0), (0, 1, 0), (0, 0, -1), off=0.003)
    rivets([(x, y, fz0 - 0.05) for x in (-0.43, 0.43) for y in (OPEN_H + 0.38, OPEN_H + 0.6)], (0, 0, -1), r=0.011, h=0.008)
    # outside: vents high on both walls, conduit along the eaves into the housing
    for s in (-1, 1):
        louvre((s * xo, 2.4, -4.6), (0, 0, -s), (0, 1, 0), (s, 0, 0), 0.7, 0.42, slats=5)
        pipe(rounded([(s * (xo + 0.05), 2.95, BACK_Z + 0.3), (s * (xo + 0.05), 2.95, -HOUSE_D - 0.05), (s * (xo + 0.05), 2.95, -HOUSE_D + 0.0)], 0.1), 0.025)
        for z in (-2.2, -3.6, -5.0):
            SBOX(s * (xo + 0.005), 2.92, z - 0.03, s * (xo + 0.08), 2.98, z + 0.03, tint=(0.5, 0.5, 0.5))
    # A plinth band where the walls meet the ground (rough, darker).
    for s in (-1, 1):
        CBOX(min(s * xo, s * (xo + 0.06)), FOOT, zb, max(s * xo, s * (xo + 0.06)), 0.25, zf, bevel=0.01, tint=(0.82, 0.82, 0.8))


def interior():
    """Inside: the floor's markings, a dead control panel with one dim indicator, conduit, a dead bulkhead lamp."""
    xi = OPEN_HW
    # keep-clear stripes on the floor in front of the doors
    hazard((-xi + 0.02, 0.0, DOOR_Z - DOOR_T / 2 - 0.08), (1, 0, 0), (0, 0, -1), (0, 1, 0), 2 * xi - 0.04, 0.5, 0.4, off=0.002)
    for z in (-1.9, -5.9):
        decal('paint', [(0, 0), (2 * xi - 0.3, 0), (2 * xi - 0.3, 0.07), (0, 0.07)], (-xi + 0.15, 0.0, z), (1, 0, 0), (0, 0, -1), (0, 1, 0), off=0.002)
    for s in (-1, 1):
        decal('paint', [(0, 0), (0.07, 0), (0.07, 4.0), (0, 4.0)], (s * (xi - 0.15) - (0.07 if s > 0 else 0.0), 0.0, -1.9), (1, 0, 0), (0, 0, -1), (0, 1, 0), off=0.002)
    # control panel on the +x wall near the doors
    px, pz = xi, -1.6
    SBOX(px - 0.16, 0.95, pz - 0.32, px, 1.75, pz + 0.32, tint=(0.62, 0.64, 0.6))
    SBOX(px - 0.17, 1.42, pz - 0.24, px - 0.155, 1.66, pz + 0.24, tint=(0.08, 0.09, 0.09), mat='steel')   # dead screen
    SBOX(px - 0.175, 1.39, pz - 0.27, px - 0.16, 1.69, pz - 0.24, tint=(0.4, 0.4, 0.4))
    SBOX(px - 0.175, 1.39, pz + 0.24, px - 0.16, 1.69, pz + 0.27, tint=(0.4, 0.4, 0.4))
    for i, (bz, col) in enumerate(((-0.17, (0.25, 0.04, 0.03)), (-0.05, (0.05, 0.18, 0.05)), (0.07, (0.35, 0.3, 0.05)))):
        CYL('steel', 0.028, 0.032, 0.03, px - 0.175, 1.2, pz + bz, segs=12, rz=PI / 2, tint=col)
        CYL('steel', 0.038, 0.038, 0.012, px - 0.165, 1.2, pz + bz, segs=12, rz=PI / 2, tint=(0.5, 0.5, 0.5))
    CYL('steel', 0.03, 0.03, 0.04, px - 0.18, 1.05, pz + 0.18, segs=10, rz=PI / 2, tint=(0.6, 0.6, 0.6))   # key switch
    SBOX(px - 0.2, 1.045, pz + 0.165, px - 0.19, 1.055, pz + 0.195, tint=(0.3, 0.3, 0.3))
    # the indicator: one small lamp, dim (the panel has no power)
    CYL('steel', 0.022, 0.022, 0.02, px - 0.17, 1.2, pz + 0.2, segs=10, rz=PI / 2, tint=(0.4, 0.4, 0.4))
    CYL('indicator', 0.014, 0.014, 0.012, px - 0.185, 1.2, pz + 0.2, segs=10, rz=PI / 2)
    empty('INDICATOR', (px - 0.19, 1.2, pz + 0.2))
    empty('PANEL', (px - 0.17, 1.5, pz))
    # a label over the panel
    SBOX(px - 0.01, 1.8, pz - 0.2, px, 1.9, pz + 0.2, tint=(0.75, 0.6, 0.1), mat='paint')
    # conduit from the panel up to the ceiling and along it to the doors' drive
    pipe(rounded([(px - 0.05, 1.75, pz), (px - 0.05, 3.0, pz), (px - 0.05, 3.0, -1.1), (px - 0.4, 3.05, -0.9)], 0.1), 0.025)
    pipe(rounded([(-px + 0.05, 0.75, -5.6), (-px + 0.05, 2.98, -5.6), (-px + 0.05, 2.98, -1.0)], 0.12), 0.03)
    SBOX(-px, 0.45, -5.75, -px + 0.14, 0.78, -5.45, tint=(0.6, 0.62, 0.6))
    for z in (-2.0, -3.5, -5.0):
        SBOX(-px, 2.94, z - 0.03, -px + 0.09, 3.02, z + 0.03, tint=(0.5, 0.5, 0.5))
    # the bay number stencilled on the bare wall opposite the panel
    stencil('BAY 07', 0.34, (-xi, 2.15, -3.4), (0, 0, -1), (0, 1, 0), (1, 0, 0), off=0.003)
    hazard((-xi, 1.82, -4.35), (0, 0, 1), (0, 1, 0), (1, 0, 0), 1.9, 0.1, 0.24, off=0.003)
    # a dead bulkhead lamp in a cage on the ceiling, half way in
    lz = -3.8
    CYL('steel', 0.14, 0.15, 0.06, 0.0, OPEN_H - 0.03, lz, segs=16, tint=(0.5, 0.5, 0.5))
    CYL('glass', 0.11, 0.11, 0.06, 0.0, OPEN_H - 0.09, lz, segs=16)
    for i in range(6):
        a = i * PI / 3
        pipe([(math.cos(a) * 0.13, OPEN_H - 0.05, lz + math.sin(a) * 0.13), (math.cos(a) * 0.12, OPEN_H - 0.15, lz + math.sin(a) * 0.12), (0, OPEN_H - 0.17, lz)], 0.005, sides=4)
    # the door drive housings over the pockets (inside, at the head)
    for s in (-1, 1):
        SBOX(s * 0.2, 2.92, DOOR_Z - DOOR_T / 2 - 0.5, s * 1.25, 3.08, DOOR_Z - DOOR_T / 2 - 0.12, tint=(0.55, 0.56, 0.55))


# ============================================================================ the doors
def leaf(side):
    """One leaf (side +1: +x, -1: -x), shut, emitted into its part; the face toward +z (out) carries the chevrons."""
    name = 'DOOR_L' if side > 0 else 'DOOR_R'
    x0, x1 = (0.0, side * LEAF_W) if side > 0 else (side * LEAF_W, 0.0)
    xs0, xs1 = min(x0, x1) - (0.02 if side < 0 else 0.0), max(x0, x1) + (0.02 if side > 0 else 0.0)
    cx = (xs0 + xs1) / 2
    part(name, (cx, 0.0, DOOR_Z), axis=(side, 0, 0), travel=SLIDE)
    zf, zb = DOOR_Z + DOOR_T / 2, DOOR_Z - DOOR_T / 2
    with into(name):
        # the leaf's body: a thick plate with a raised outer panel (bevelled), dark steel
        SBOX(xs0, LEAF_Y0, zb, xs1, LEAF_Y1, zf - 0.03, tint=DARK, bevel=0.01)
        ox0, ox1 = xs0 + (0.07 if side < 0 else 0.0), xs1 - (0.07 if side > 0 else 0.0)
        SBOX(ox0 + 0.05, 0.1, zf - 0.035, ox1 - 0.05, OPEN_H - 0.05, zf, tint=DARK, bevel=0.018)
        # the meeting edge: a stepped rubber seal (black) along the seam
        SBOX(0.0, LEAF_Y0 + 0.02, zf - 0.034, side * 0.025, OPEN_H + 0.1, zf + 0.006, tint=(0.05, 0.05, 0.05))
        # chevrons pointing at the seam (">" on the +x leaf seen from outside points to -x... both point inward)
        ua, ub, w, h = 0.16, 0.95, 0.32, 0.5
        for c in (2.25, 0.98):
            # (in the leaf's face: u = distance from the seam, v up); x = -side * u? No: the +x leaf has its seam at x=0
            # and runs to +x, so u = x * side.
            arm1 = [(ua, c), (ub, c + h), (ub + w, c + h), (ua + w, c)]
            arm2 = [(ua + w, c), (ub + w, c - h), (ub, c - h), (ua, c)]
            for arm in (arm1, arm2):
                poly = [(side * u, v) for (u, v) in arm]
                poly = clip_poly(poly, min(ox0, ox1) + 0.06, max(ox0, ox1) - 0.06, 0.12, OPEN_H - 0.08)
                if len(poly) >= 3:
                    decal('paint', poly, (0, 0, zf), (1, 0, 0), (0, 1, 0), (0, 0, 1), off=0.003, thick=0.002)
        # hazard stripes along the foot of the leaf
        hazard((xs0 + 0.02, LEAF_Y0 + 0.02, zf - 0.03), (1, 0, 0), (0, 1, 0), (0, 0, 1), xs1 - xs0 - 0.04, 0.1, 0.3, off=0.002, flip=(side < 0))
        # a viewport near the seam at eye height: a thick steel ring, dark armoured glass
        vx = side * 0.42
        vy = 1.68
        for (bw_, bh_, dx, dy) in ((0.3, 0.04, 0, 0.08), (0.3, 0.04, 0, -0.08), (0.04, 0.2, 0.13, 0), (0.04, 0.2, -0.13, 0)):
            emit(bm_box(bw_, bh_, 0.045, 0.008), 'steel', xf(vx + dx, vy + dy, zf + 0.0), (0.7, 0.7, 0.7), 1.0, None, None, False)
        emit(bm_box(0.24, 0.14, 0.01, 0.0), 'glass', xf(vx, vy, zf + 0.002), WHITE, 1.0, None, None, False)
        rivets([(vx + dx, vy + dy, zf + 0.0225) for dx in (-0.125, 0.125) for dy in (-0.075, 0.075)], (0, 0, 1), r=0.01, h=0.007)
        # rivets round the raised panel
        pts = []
        for i in range(9):
            y = 0.2 + i * (OPEN_H - 0.4) / 8
            pts += [(ox0 + 0.09, y, zf), (ox1 - 0.09, y, zf)]
        for i in range(1, 5):
            x = ox0 + 0.09 + i * (ox1 - ox0 - 0.18) / 5
            pts += [(x, 0.2, zf), (x, OPEN_H - 0.2, zf)]
        rivets(pts, (0, 0, 1))
        # The back: stiffener ribs (horizontal channels and an edge frame), a locking bar housing at the seam.
        for y in (0.45, 1.25, 2.05, 2.85):
            SBOX(xs0 + 0.06, y - 0.05, zb - 0.09, xs1 - 0.06, y + 0.05, zb, tint=(0.8, 0.8, 0.82))
        for x in ((xs0 + 0.06, xs0 + 0.16), (xs1 - 0.16, xs1 - 0.06)):
            SBOX(x[0], 0.1, zb - 0.07, x[1], OPEN_H - 0.05, zb, tint=(0.8, 0.8, 0.82))
        sx = 0.0 + side * 0.24
        SBOX(sx - 0.07, 1.0, zb - 0.16, sx + 0.07, 1.5, zb, tint=(0.6, 0.6, 0.6))
        CYL('steel', 0.025, 0.025, 1.2, sx, 1.25, zb - 0.12, segs=8, tint=(0.75, 0.75, 0.75))
        hazard((xs0 + 0.2, 1.62, zb - 0.002), (1, 0, 0), (0, 1, 0), (0, 0, -1), xs1 - xs0 - 0.4, 0.12, 0.24, off=0.002)


# ============================================================================ the stairs
def stair_profile():
    """Nosings (z, y) of the flight: the landing's front edge and every tread's front edge (section-local)."""
    return [(XL + j * RUN, -j * RISE) for j in range(K)]


def tread_uv(co, n):
    return (co[0] / 0.3, co[2] / 0.3)


def grating_plate(x0, x1, z0, z1, y, t=0.03):
    """A grating panel (the open mesh is the texture's alpha): top and bottom faces, thin solid edges."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1))]
    bm.faces.new((v[0], v[3], v[2], v[1]))
    w = [bm.verts.new(p) for p in ((x0, y - t, z0), (x1, y - t, z0), (x1, y - t, z1), (x0, y - t, z1))]
    bm.faces.new((w[0], w[1], w[2], w[3]))
    emit(bm, 'grating', None, WHITE, 1.0, None, None, False, uvfn=tread_uv)


def channel_z(x, z0, z1, ytop, d, t, outward, tint=STEEL):
    """A C-channel running along z at x, its web outward (toward +x when outward > 0), top at ytop, depth d."""
    s = 1 if outward > 0 else -1
    SBOX(x - t / 2, ytop - d, z0, x + t / 2, ytop, z1, tint=tint, bevel=0.003)
    SBOX(min(x, x - s * 0.06), ytop - 0.012, z0, max(x, x - s * 0.06), ytop, z1, tint=tint, bevel=0.002)
    SBOX(min(x, x - s * 0.06), ytop - d, z0, max(x, x - s * 0.06), ytop - d + 0.012, z1, tint=tint, bevel=0.002)


def sloped(x0, x1, za, ya, zb, yb, d, tint=STEEL, mat='steel', bevel=0.003):
    """A beam from (za, ya) to (zb, yb) in the z-y plane, x0..x1 wide, `d` deep measured vertically, top on the line."""
    bm = bm_prism([(za, ya), (zb, yb), (zb, yb - d), (za, ya - d)], x0, x1, 'z')
    emit(bm, mat, None, tint, 1.0, None, None, False)


def stair_section():
    """One section (section-local coords, its start at the origin), emitted into part STAIR."""
    nos = stair_profile()
    zl = XL
    # ---- landing: side channels, end channel at the joint, cross bearers, grating deck, kick plates, a striped nosing
    for s in (-1, 1):
        channel_z(s * STR_X, 0.0, zl, 0.0, 0.2, STR_T, s)
        # coupler plates at the joint (bolted over the previous flight's stringer foot)
        SBOX(s * (STR_X + 0.04), -0.3, -0.1, s * (STR_X + 0.055), -0.07, 0.22, tint=(0.75, 0.75, 0.75))
        rivets([(s * (STR_X + 0.055), y, z) for y in (-0.24, -0.13) for z in (-0.04, 0.15)], (s, 0, 0), r=0.015, h=0.011)
    SBOX(-STR_X, -0.2, 0.0, STR_X, 0.0, 0.07, tint=(0.9, 0.9, 0.9))                      # end channel
    for z in (0.5, 1.05):
        SBOX(-STR_X + 0.03, -0.14, z - 0.03, STR_X - 0.03, -0.035, z + 0.03, tint=(0.8, 0.8, 0.8))
    grating_plate(-TREAD_HW, TREAD_HW, 0.07, zl - 0.06, 0.0)
    for s in (-1, 1):
        SBOX(s * (TREAD_HW + 0.0) - 0.004, 0.0, 0.02, s * (TREAD_HW) + 0.004, 0.1, zl, tint=(0.95, 0.95, 0.95))
    # hazard stripes on the outer faces of the landing's side channels
    for s in (-1, 1):
        hazard((s * (STR_X + 0.04), -0.19, 0.08 if s > 0 else zl - 0.08), (0, 0, 1 if s > 0 else -1), (0, 1, 0), (s, 0, 0), zl - 0.16, 0.17, 0.26, off=0.003)
    # nosing angle at the landing's front edge (painted yellow)
    SBOX(-TREAD_HW, -0.05, zl - 0.06, TREAD_HW, 0.004, zl, mat='paint', tint=WHITE)
    # ---- flight: stringers along the nosing line, treads between them
    slope = RISE / RUN
    for s in (-1, 1):
        x0, x1 = s * STR_X - STR_T / 2, s * STR_X + STR_T / 2
        # stringer web: a parallelogram from the landing's end down to the foot, its top 5 cm over the nosing line
        za, ya = zl - 0.05, 0.05
        zb = LS
        yb = ya - (zb - za) * slope
        # (its bottom edge runs parallel to its top, cut level at the foot, beside the next landing's end)
        zc = za + (ya - STR_D - (-HS - 0.13)) / slope
        poly = [(za, ya), (zb, yb), (zb, -HS - 0.13), (min(zc, zb - 0.02), -HS - 0.13), (za, ya - STR_D)]
        emit(bm_prism(poly, min(x0, x1), max(x0, x1), 'z'), 'steel', None, STEEL, 1.0, None, None, False)
        # its flanges (outward), top and bottom
        xo = s * (STR_X + STR_T / 2)
        lo, hi = min(xo, xo + s * 0.055), max(xo, xo + s * 0.055)
        sloped(lo, hi, za, ya, zb, yb, 0.012)
        sloped(lo, hi, za, ya - STR_D + 0.012, min(zc, zb - 0.02), -HS - 0.13 + 0.012, 0.012)
    # treads: grating with a carrier angle each side (bolted to the stringer) and a yellow nosing
    for j in range(K - 1):
        zt0, zt1 = nos[j][0], nos[j][0] + RUN
        y = -(j + 1) * RISE
        grating_plate(-TREAD_HW + 0.01, TREAD_HW - 0.01, zt0 + 0.005, zt1 - 0.035, y)
        SBOX(-TREAD_HW + 0.01, y - 0.05, zt1 - 0.06, TREAD_HW - 0.01, y + 0.004, zt1 - 0.0, mat='paint', tint=WHITE)
        SBOX(-TREAD_HW + 0.01, y - 0.045, zt0 + 0.0, TREAD_HW - 0.01, y - 0.03, zt0 + 0.03, tint=(0.8, 0.8, 0.8))
        for s in (-1, 1):
            SBOX(s * TREAD_HW - 0.03 * s - 0.015, y - 0.07, zt0 + 0.01, s * TREAD_HW - 0.03 * s + 0.015, y - 0.0, zt1 - 0.01, tint=(0.85, 0.85, 0.85))
            rivets([(s * (STR_X + STR_T / 2), y - 0.04, z) for z in (zt0 + 0.08, zt1 - 0.1)], (s, 0, 0), r=0.013, h=0.01)
    # ---- the truss under it: a bottom chord each side from under the joint to where it meets the stringer, posts and
    # diagonals up to the landing frame and the stringer, cross bracing between the two sides
    c0 = (0.06, -0.38)
    c_slope = (HS - 0.38 - 0.0) / LS
    chord = lambda z: c0[1] - (z - c0[0]) * c_slope
    za = zl - 0.05
    ya = 0.05
    str_bot = lambda z: (ya - STR_D) - (z - za) * slope if z > za else -0.2
    # where the chord meets the stringer's underside
    zm = za + ((ya - STR_D) - chord(za)) / (slope - c_slope) if slope != c_slope else LS
    zm = min(zm, LS - 0.3)
    nodes = [c0[0], 0.55, 1.1, zl - 0.05]
    z = zl - 0.05
    while z + 0.55 < zm - 0.05:
        z += 0.55
        nodes.append(z)
    nodes.append(zm)
    for s in (-1, 1):
        x = s * (STR_X - 0.0)
        # chord: a square tube
        a, b = Vector((x, chord(c0[0]), c0[0])), Vector((x, chord(zm) + 0.02, zm))
        beam('steel', a, b, 0.07, 0.07, STEEL, 0.006)
        # posts (verticals) and diagonals
        top = lambda z: (-0.2 if z <= zl else str_bot(z))
        for i, zn in enumerate(nodes[:-1]):
            beam('steel', Vector((x, chord(zn), zn)), Vector((x, top(zn), zn)), 0.05, 0.05, STEEL, 0.004)
            zn1 = nodes[i + 1]
            if i % 2 == 0:
                beam('steel', Vector((x, chord(zn), zn)), Vector((x, top(zn1), zn1)), 0.04, 0.04, STEEL, 0.004)
            else:
                beam('steel', Vector((x, top(zn), zn)), Vector((x, chord(zn1), zn1)), 0.04, 0.04, STEEL, 0.004)
        # gusset where the chord meets the stringer
        SBOX(x - 0.005, chord(zm) - 0.06, zm - 0.18, x + 0.005, chord(zm) + 0.12, zm + 0.06, tint=(0.75, 0.75, 0.75))
    # cross bracing between the two trusses (under the landing and the upper flight)
    for (za_, zb_) in ((c0[0], 1.1), (1.1, zl - 0.05)):
        for (p, q) in (((-STR_X, za_), (STR_X, zb_)), ((STR_X, za_), (-STR_X, zb_))):
            beam('steel', Vector((p[0], chord(p[1]) + 0.04, p[1])), Vector((q[0], chord(q[1]) + 0.04, q[1])), 0.035, 0.035, STEEL, 0.0)
    for zn in (c0[0], 1.1, zl - 0.05):
        beam('steel', Vector((-STR_X, chord(zn), zn)), Vector((STR_X, chord(zn), zn)), 0.05, 0.05, STEEL, 0.004)
    # the joint's hinge pin across under the deck at the start (it rides in the previous section's foot)
    CYL('steel', 0.04, 0.04, 2 * STR_X + 0.18, 0.0, -0.28, 0.0, segs=12, rz=PI / 2, tint=(0.65, 0.65, 0.65))
    for s in (-1, 1):
        CYL('steel', 0.065, 0.065, 0.03, s * (STR_X + 0.1), -0.28, 0.0, segs=12, rz=PI / 2, tint=(0.7, 0.7, 0.7))
    # ---- handrails: horizontal over the landing, down along the flight (0.895 m over the nosings), meeting the next
    # section's landing rail at its height; posts on the frame and the stringers; a mid rail
    z_in = LS - HS / slope                 # where the sloped rail leaves the landing's height
    for s in (-1, 1):
        x = s * STR_X
        for (hh, r) in ((RAIL_H, 0.024), (RAIL_H * 0.5, 0.017)):
            pts = [(x, hh, 0.0), (x, hh, z_in), (x, hh - HS, LS)]
            if hh < RAIL_H:
                pts = [(x, hh, 0.0), (x, hh, z_in), (x, hh - HS, LS - 0.06)]
            emit(bm_tube(rounded(pts, 0.25, 6), r, 10), 'paint', None, WHITE, 1.0, None, None, True)
        # (the flight's last post stands back from its foot: the next section's first is just past the joint)
        posts = [0.07, (zl * 0.5), zl - 0.08, (zl + LS) * 0.5 - 0.05, LS - 0.5]
        for zp in posts:
            yb = 0.0 if zp <= zl else (0.05 - (zp - (zl - 0.05)) * slope)
            yt = RAIL_H if zp <= z_in else RAIL_H - (zp - z_in) * slope
            SBOX(x - 0.025, yb, zp - 0.025, x + 0.025, yt - 0.01, zp + 0.025, tint=(0.95, 0.95, 0.95), bevel=0.004)
            SBOX(x - 0.045, yb, zp - 0.045, x + 0.045, yb + 0.012, zp + 0.045, tint=(0.8, 0.8, 0.8))


# ============================================================================ build
def build_all():
    housing()
    bay()
    portal_frame()
    header()
    buttresses()
    roof_railing()
    corridor()
    interior()
    leaf(1)
    leaf(-1)
    # the stairs: one section, built at z = PARK (its AO is its own), relative to its pivot (the section's start)
    set_origin(0.0, 0.0, PARK)
    part('STAIR', (0.0, 0.0, 0.0), bake=True)
    DECAL_LAYER[0] = False
    with into('STAIR'):
        stair_section()
    DECAL_LAYER[0] = True
    set_origin(0.0, 0.0, 0.0)
    empty('META', (0, 0, 0), open_hw=OPEN_HW, open_h=OPEN_H, hw=HW, house_d=HOUSE_D, top=TOP, door_z=DOOR_Z, door_t=DOOR_T,
          leaf_w=LEAF_W, slide=SLIDE, corr_z1=CORR_Z1, back_z=BACK_Z, apron_y=APRON_Y, roof_y=ROOF_Y1, foot=FOOT,
          wall_t=WALL_T, bay=list(BAY), n=N, ls=LS, hs=HS, k=K, rise=RISE, run=RUN, xl=XL, park=PARK, front=0.23)
    return realize()


# ============================================================================ textures
def _mix(nt, fac, a, b):
    m = node(nt, 'ShaderNodeMix', props={'data_type': 'RGBA', 'blend_type': 'MIX'})
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


def _noise4(nt, vec, w, scale, detail=6.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '4D'}, Vector=vec, W=w, Scale=scale,
                Detail=detail, Roughness=rough, Distortion=distort).outputs['Fac']


def _vor4(nt, vec, w, scale, feature='F1', out='Distance', rand=1.0):
    n = node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '4D', 'feature': feature}, Vector=vec, W=w, Scale=scale, Randomness=rand)
    return n.outputs[out]


def _mapr(nt, v, a, b, lo=0.0, hi=1.0):
    return node(nt, 'ShaderNodeMapRange', props={'clamp': True}, Value=v, **{'From Min': a, 'From Max': b, 'To Min': lo, 'To Max': hi}).outputs[0]


def _stretch(nt, vec, w, ku, kv):
    v = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=vec, i1=(ku, ku, kv)).outputs[0]
    return v, math_node(nt, 'MULTIPLY', w, kv)


def _uvsep(nt):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs[0])
    return sep.outputs['X'], sep.outputs['Y']


def _lines(nt, coord, count, width, soft=0.0):
    """1 on thin lines at coord = k / count (coord in 0..1, wrapping), else 0."""
    f = math_node(nt, 'FRACT', math_node(nt, 'MULTIPLY', coord, float(count)))
    d = math_node(nt, 'MINIMUM', f, math_node(nt, 'SUBTRACT', 1.0, f))
    return _mapr(nt, d, width * count + soft, width * count, 0.0, 1.0)


def concrete_fields(nt, vec, w):
    """Board-formed concrete on a 2.5 m tile (v up the wall): (board lines, panel joints, tie holes, streaks, stain, pits)."""
    u, v = _uvsep(nt)
    boards = _lines(nt, v, 16, 0.0012, 0.0015)                                   # 0.156 m boards
    joints = math_node(nt, 'MAXIMUM', _lines(nt, u, 2, 0.0012, 0.001), _lines(nt, v, 2, 0.0012, 0.001))
    # tie holes: a dot at every 0.625 m
    tu = math_node(nt, 'FRACT', math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', u, 4.0), 0.5))
    tv = math_node(nt, 'FRACT', math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', v, 4.0), 0.5))
    du = math_node(nt, 'SUBTRACT', tu, 0.5)
    dv = math_node(nt, 'SUBTRACT', tv, 0.5)
    rr = math_node(nt, 'SQRT', math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', du, du), math_node(nt, 'MULTIPLY', dv, dv)))
    ties = _mapr(nt, rr, 0.035, 0.02)
    sv, sw = _stretch(nt, vec, w, 6.0, 0.25)                                     # rain streaks run down (along v)
    streak = _mapr(nt, _noise4(nt, sv, sw, 3.0, 4.0, 0.55), 0.5, 0.78)
    stain = _mapr(nt, _noise4(nt, vec, w, 1.6, 5.0, 0.6), 0.3, 0.75)
    pits = _mapr(nt, _vor4(nt, vec, w, 55.0), 0.12, 0.03)
    grain = _noise4(nt, vec, w, 38.0, 3.0, 0.6)
    return boards, joints, ties, streak, stain, pits, grain


def make_concrete(nt, vec, w):
    boards, joints, ties, streak, stain, pits, grain = concrete_fields(nt, vec, w)
    col = _ramp(nt, stain, [(0.0, srgb(168, 164, 154)), (0.45, srgb(146, 143, 135)), (0.8, srgb(122, 120, 114)), (1.0, srgb(110, 108, 102))])
    col = _mix(nt, math_node(nt, 'MULTIPLY', _mapr(nt, grain, 0.35, 0.65), 0.25), col, srgb(176, 172, 162))
    col = _mix(nt, math_node(nt, 'MULTIPLY', streak, 0.65), col, srgb(84, 82, 76))
    col = _mix(nt, math_node(nt, 'MULTIPLY', boards, 0.22), col, srgb(104, 102, 96))
    col = _mix(nt, math_node(nt, 'MULTIPLY', joints, 0.5), col, srgb(84, 82, 78))
    col = _mix(nt, math_node(nt, 'MULTIPLY', pits, 0.6), col, srgb(70, 68, 64))
    return _mix(nt, ties, col, srgb(40, 38, 36))


def make_concrete_height(nt, vec, w):
    boards, joints, ties, streak, stain, pits, grain = concrete_fields(nt, vec, w)
    h = math_node(nt, 'ADD', 0.5, math_node(nt, 'MULTIPLY', grain, 0.08))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', boards, 0.06))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', joints, 0.12))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', pits, 0.15))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', ties, 0.3))
    return node(nt, 'ShaderNodeCombineColor', Red=h, Green=h, Blue=h).outputs[0]


def steel_fields(nt, vec, w):
    """Dark painted steel: (wear: scratched through to bright metal, rust spots, rust streaks down, grime)."""
    sv, sw = _stretch(nt, vec, w, 1.0, 0.04)                                     # scratches run along u
    scratch = _mapr(nt, _noise4(nt, sv, sw, 9.0, 3.0, 0.5), 0.66, 0.7)
    sparse = _mapr(nt, _noise4(nt, vec, w, 2.0, 2.0, 0.5), 0.5, 0.62)
    scratch = math_node(nt, 'MULTIPLY', scratch, sparse)
    rustspot = _mapr(nt, _noise4(nt, vec, w, 6.0, 6.0, 0.65, 0.3), 0.64, 0.72)
    rv, rw = _stretch(nt, vec, w, 4.0, 0.15)
    rstreak = math_node(nt, 'MULTIPLY', _mapr(nt, _noise4(nt, rv, rw, 3.0, 3.0, 0.5), 0.55, 0.78), _mapr(nt, _noise4(nt, vec, w, 1.2, 2.0, 0.5), 0.45, 0.6))
    grime = _mapr(nt, _noise4(nt, vec, w, 2.5, 5.0, 0.6), 0.35, 0.75)
    fine = _noise4(nt, vec, w, 60.0, 2.0, 0.5)
    return scratch, rustspot, rstreak, grime, fine


def make_steel(nt, vec, w):
    scratch, rustspot, rstreak, grime, fine = steel_fields(nt, vec, w)
    col = _ramp(nt, grime, [(0.0, srgb(78, 82, 82)), (0.5, srgb(64, 67, 68)), (1.0, srgb(48, 50, 50))])
    col = _mix(nt, math_node(nt, 'MULTIPLY', _mapr(nt, fine, 0.4, 0.6), 0.15), col, srgb(90, 94, 94))
    col = _mix(nt, math_node(nt, 'MULTIPLY', rstreak, 0.5), col, srgb(96, 60, 38))
    col = _mix(nt, rustspot, col, srgb(104, 58, 32))
    return _mix(nt, scratch, col, srgb(150, 150, 146))


def make_steel_height(nt, vec, w):
    scratch, rustspot, rstreak, grime, fine = steel_fields(nt, vec, w)
    h = math_node(nt, 'ADD', 0.5, math_node(nt, 'MULTIPLY', fine, 0.05))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', scratch, 0.12))
    h = math_node(nt, 'ADD', h, math_node(nt, 'MULTIPLY', rustspot, 0.12))
    return node(nt, 'ShaderNodeCombineColor', Red=h, Green=h, Blue=h).outputs[0]


def paint_fields(nt, vec, w):
    """Worn safety yellow on steel: (bare: chipped through, streaks of grime down, the paint's fade, scuffs)."""
    chips = _noise4(nt, vec, w, 6.0, 6.0, 0.68, 0.2)
    bare = _mapr(nt, chips, 0.58, 0.63)
    wear = _mapr(nt, _noise4(nt, vec, w, 1.5, 3.0, 0.5), 0.4, 0.8)
    bare = math_node(nt, 'MAXIMUM', bare, math_node(nt, 'MULTIPLY', _mapr(nt, chips, 0.5, 0.6), wear))
    sv, sw = _stretch(nt, vec, w, 3.0, 0.12)
    streak = _mapr(nt, _noise4(nt, sv, sw, 4.0, 3.0, 0.5), 0.5, 0.75)
    fade = _mapr(nt, _noise4(nt, vec, w, 2.2, 4.0, 0.55), 0.3, 0.7)
    scuff = _mapr(nt, _noise4(nt, vec, w, 30.0, 2.0, 0.5), 0.6, 0.75)
    return bare, streak, fade, scuff


def make_paint(nt, vec, w):
    bare, streak, fade, scuff = paint_fields(nt, vec, w)
    paint = _mix(nt, fade, srgb(222, 168, 22), srgb(204, 160, 52))
    paint = _mix(nt, math_node(nt, 'MULTIPLY', scuff, 0.3), paint, srgb(176, 140, 60))
    paint = _mix(nt, math_node(nt, 'MULTIPLY', streak, 0.45), paint, srgb(110, 86, 40))
    under = srgb(52, 50, 48)
    return _mix(nt, bare, paint, under)


def make_paint_height(nt, vec, w):
    bare, streak, fade, scuff = paint_fields(nt, vec, w)
    h = math_node(nt, 'SUBTRACT', 0.55, math_node(nt, 'MULTIPLY', bare, 0.22))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', scuff, 0.04))
    return node(nt, 'ShaderNodeCombineColor', Red=h, Green=h, Blue=h).outputs[0]


def floor_fields(nt, vec, w):
    """Trowelled slab concrete: (burnish mottle, stains, speckle, hairline cracks)."""
    mott = _mapr(nt, _noise4(nt, vec, w, 2.2, 5.0, 0.6), 0.3, 0.75)
    stain = _mapr(nt, _noise4(nt, vec, w, 1.1, 4.0, 0.65, 0.6), 0.6, 0.75)
    speck = _mapr(nt, _noise4(nt, vec, w, 70.0, 2.0, 0.5), 0.62, 0.72)
    cell = _vor4(nt, vec, w, 2.4, 'DISTANCE_TO_EDGE')
    crack = math_node(nt, 'MULTIPLY', _mapr(nt, cell, 0.004, 0.0), _mapr(nt, _noise4(nt, vec, w, 3.0, 2.0, 0.5), 0.5, 0.58))
    return mott, stain, speck, crack


def make_floor(nt, vec, w):
    mott, stain, speck, crack = floor_fields(nt, vec, w)
    col = _ramp(nt, mott, [(0.0, srgb(140, 137, 130)), (0.5, srgb(122, 120, 114)), (1.0, srgb(104, 102, 98))])
    col = _mix(nt, math_node(nt, 'MULTIPLY', stain, 0.5), col, srgb(70, 66, 60))
    col = _mix(nt, math_node(nt, 'MULTIPLY', speck, 0.3), col, srgb(158, 154, 146))
    return _mix(nt, math_node(nt, 'MULTIPLY', crack, 0.8), col, srgb(52, 50, 48))


def grating_fields(nt, vec, w):
    """Bar grating on a 0.3 m tile: bearing bars along u every 30 mm (lines of constant v), cross rods across them every
    100 mm (lines of constant u). Returns (solid 0/1, bar shading, dirt)."""
    u, v = _uvsep(nt)
    bars = _lines(nt, v, 10, 0.0085, 0.004)            # 5 mm bars
    rods = _lines(nt, u, 3, 0.006, 0.004)              # 3.6 mm rods
    solid = math_node(nt, 'MAXIMUM', bars, rods)
    # rounded-looking bar tops: brighter in the middle of each bar
    f = math_node(nt, 'FRACT', math_node(nt, 'MULTIPLY', v, 10.0))
    d = math_node(nt, 'MINIMUM', f, math_node(nt, 'SUBTRACT', 1.0, f))
    shade = _mapr(nt, d, 0.0, 0.0085 * 10, 1.0, 0.55)
    dirt = _mapr(nt, _noise4(nt, vec, w, 3.0, 4.0, 0.6), 0.35, 0.8)
    return solid, shade, dirt


def make_grating(nt, vec, w):
    solid, shade, dirt = grating_fields(nt, vec, w)
    col = _mix(nt, dirt, srgb(118, 120, 118), srgb(78, 74, 66))
    col = _mix(nt, math_node(nt, 'SUBTRACT', 1.0, shade), col, srgb(52, 52, 50))
    # the holes are dark (what a far, solid grating averages to)
    return _mix(nt, solid, srgb(14, 14, 14), col)


def make_grating_mask(nt, vec, w):
    solid, shade, dirt = grating_fields(nt, vec, w)
    return node(nt, 'ShaderNodeCombineColor', Red=solid, Green=solid, Blue=solid).outputs[0]


def bake_ground_proxy():
    """The ground round the gatehouse (the cap rising from the rim to the floor's level 6 m back, the cliff face under
    the rim), as the AO bake's occluder in place of dbkit's flat plane (which would sit across the gap)."""
    sc = _scene()
    old = sc.objects.get('BAKE_ground')
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    verts, faces = [], []
    def q(a, b, c, d):
        base = len(verts)
        verts.extend([tuple(g2b(p)) for p in (a, b, c, d)])
        faces.append((base, base + 1, base + 2, base + 3))
    S = 30.0
    ground = lambda z: -1.2 + (min(0.0, max(-6.2, z)) - (-0.3)) / (-6.2 + 0.3) * 1.13 if z > -6.2 else -0.05
    zs = [-0.3, -1.5, -3.0, -4.5, -6.2, -30.0]
    for a, b in zip(zs, zs[1:]):
        q((-S, ground(a), a), (S, ground(a), a), (S, ground(b), b), (-S, ground(b), b))
    q((-S, -40.0, -0.45), (S, -40.0, -0.45), (S, -1.2, -0.3), (-S, -1.2, -0.3))
    me = bpy.data.meshes.new('DB_bake_ground')
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new('BAKE_ground', me)
    ob['noexport'] = 1
    sc.collection.objects.link(ob)


def bake_all():
    t0 = time.time()
    os.makedirs(TMP, exist_ok=True)
    out = {}
    bake_tile(MODELS + 'gatehouse_concrete.png', make_concrete, 1024)
    h = bake_tile(os.path.join(TMP, 'gh_concrete_h.png'), make_concrete_height, 1024, colorspace='Non-Color')
    normal_from_height(MODELS + 'gatehouse_concrete_normal.png', h[:, :, 0], strength=6.0)
    bake_tile(MODELS + 'gatehouse_steel.png', make_steel, 512)
    h = bake_tile(os.path.join(TMP, 'gh_steel_h.png'), make_steel_height, 512, colorspace='Non-Color')
    normal_from_height(MODELS + 'gatehouse_steel_normal.png', h[:, :, 0], strength=3.0)
    bake_tile(MODELS + 'gatehouse_paint.png', make_paint, 512)
    h = bake_tile(os.path.join(TMP, 'gh_paint_h.png'), make_paint_height, 512, colorspace='Non-Color')
    normal_from_height(MODELS + 'gatehouse_paint_normal.png', h[:, :, 0], strength=4.0)
    bake_tile(MODELS + 'gatehouse_floor.png', make_floor, 1024)
    bake_tile(MODELS + 'gatehouse_grating.png', make_grating, 512)
    bake_tile(MODELS + 'gatehouse_grating_mask.png', make_grating_mask, 512, colorspace='Non-Color')
    out['textures_s'] = round(time.time() - t0, 1)
    bake_ground_proxy()
    out['ao'] = bake_ao(samples=128, distance=1.2)
    out['seconds'] = round(time.time() - t0, 1)
    return out
