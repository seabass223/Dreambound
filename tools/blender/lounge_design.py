# Dreambound: the cartographer's lounge, a secret third stop of the Tower elevator below its cave station.
# Executed inside dbkit.py's namespace by build_lounge.py.
#
# Model coordinates: origin at the room's floor centre, +Y up. The elevator opens in the north wall (-Z) and faces
# +Z; the game places the model so STATION sits straight below the Tower's cave station (src/props/lounge.js).
#
# Five materials, one draw call each in the game, all unlit:
#   wood     walnut: panelling, coffers, bookcases, furniture (tiling grain texture, lounge_wood.png)
#   leather  armchairs, the desk's inlay, book spines (tiling grain, lounge_leather.png; colour from the vertices)
#   brass    lamp, pulls, instruments (vertex colour plus a sheen in the game)
#   decal    the printed things, picked by an id packed in the texture u (u = 100 * id + u_local): the map (0), the
#            card (1, plus its dots), the rug (2), the prints atlas (3: two charts and the globe), the floor planks (4,
#            tiled) and plain paper/plaster (9, colour from the vertices)
#   glow     lamp shades and bulbs (vertex colour times a gain; not lightmapped)
# Lighting is static: the desk lamp and two faint sconces are baked with Cycles (full GI) into one RGB lightmap on the
# second UV set (lounge_lm.png).
#
# The map, the card and its dots are painted only when their PNGs are missing (or REPAINT is set), so hand edits to
# public/models/lounge_map.png, lounge_card.png and lounge_card_dots.png survive a rebuild.

from mathutils import noise as mnoise

REPAINT = os.environ.get('LOUNGE_REPAINT') == '1'
QUICK = os.environ.get('LOUNGE_QUICK') == '1'         # small, noisy lightmap for layout work
MODELS = ROOT + '/public/models/'

MATS.update({
    'wood': (srgb(92, 58, 38), 0.5), 'leather': (srgb(110, 40, 30), 0.5), 'brass': (srgb(200, 160, 90), 0.3),
    'decal': (srgb(220, 200, 170), 0.8), 'glow': ((1.0, 0.7, 0.4), 1.0),
})
NO_BAKE = {'glow', 'collider'}
BAKE_MATS = {'wood', 'leather', 'brass', 'decal'}

# ---------------------------------------------------------------- layout
X0, X1, Z0, Z1 = -3.5, 3.5, -3.0, 3.0      # the room's inner faces
H = 3.0                                    # coffer panels
BEAM_Y = 2.82                              # bottom of the ceiling beams
PLATE_Z = Z0 - 0.30                        # the game's elevator plate front (STATION)
BACK_Z = PLATE_Z + 0.17                    # back of the north wall: the doors and their header rail slide behind it
EL_X = 0.0
HOLE_HW, HOLE_H = 0.68, 2.3                # elevator.js HOLE
CALL = (1.12, 1.15)                        # the call button (plate coordinates)
DX, DZ = 0.25, 0.35                        # desk centre
DW, DD, DH = 1.76, 1.06, 0.78              # desk top size and the height of its surface
MAP_W, MAP_H = 0.92, 0.64
MAPC = Vector((DX - 0.03, DH, DZ - 0.06))  # map centre
LAMP = Vector((DX + 0.22, DH, DZ + 0.36))  # desk lamp base
BULB_Y = 0.47                              # bulb above the desk
CARD = 0.09
SHELF_F = 2.62                             # bookcase: shelf fronts, cabinet door fronts
CAB_F = 2.55
SLOT = 100.0
DEC = {'map': 0, 'card': 1, 'rug': 2, 'prints': 3, 'floor': 4, 'plain': 9}
WT = (1.0, 0.35)                           # walnut tile: metres along the grain x across
LT = (0.25, 0.25)                          # leather tile
FLOOR_T = (2.4, 1.2)                       # plank tile
RUG_W, RUG_H = 3.3, 2.3
# The prints atlas (2048 x 1024): planisphere left half, globe top right, stacks profile bottom right.
R_PLANI = (0.0, 0.0, 0.5, 1.0)
R_GLOBE = (0.5, 0.5, 1.0, 1.0)
R_PROFILE = (0.5, 0.0, 1.0, 0.5)

# ---------------------------------------------------------------- palette (linear)
RICH = srgb(255, 240, 228)
DARKW = mul(WHITE, 0.72)
BRASS = srgb(182, 134, 60)
OLDBRASS = srgb(142, 102, 48)
GILT = srgb(204, 154, 66)
OXBLOOD = srgb(128, 38, 32)
MAROON = srgb(104, 32, 38)
CHESTNUT = srgb(138, 74, 42)
COGNAC = srgb(166, 96, 52)
DKBROWN = srgb(78, 48, 32)
TAN = srgb(184, 136, 88)
NAVY = srgb(44, 54, 86)
SLATE = srgb(78, 80, 92)
BLACKL = srgb(34, 30, 28)
VELLUM = srgb(222, 204, 168)
OCHRE = srgb(178, 128, 56)
RUSTB = srgb(146, 60, 34)
PLUM = srgb(78, 40, 56)
PLASTER = srgb(206, 190, 162)
INLAY = srgb(76, 38, 28)                   # the desk's tooled leather
PAGE = srgb(226, 210, 176)
PAPERBACK = srgb(200, 180, 142)
INKGLASS = srgb(30, 24, 22)
CARD_EDGE = srgb(128, 24, 26)
RUG_EDGE = srgb(90, 26, 22)
FRINGE = srgb(214, 198, 164)
SHADE_OUT = (0.7, 0.34, 0.1)              # glow colours (times the game's glow gain)
SHADE_IN = (0.9, 0.58, 0.3)
BULB = (1.0, 0.86, 0.62)
LAMP_RGB = (1.0, 0.72, 0.45)

def D(d):
    return math.radians(d)

# ============================================================================ emit helpers
def ofs():
    return (rng.uniform(0, 6), rng.uniform(0, 6))

PLAIN_UV = lambda co, n: (SLOT * DEC['plain'] + 0.5, 0.5)

def put(bm, mat, M=None, tint=WHITE, smooth=False, colfn=None):
    """Emit a bmesh in one of the lounge materials with that material's UVs."""
    if mat == 'wood':
        emit(bm, 'wood', M, tint, tile=WT, grain='auto', smooth=smooth, uvofs=ofs(), colfn=colfn)
    elif mat == 'leather':
        emit(bm, 'leather', M, tint, tile=LT, grain='auto', smooth=smooth, uvofs=ofs(), colfn=colfn)
    elif mat == 'brass':
        emit(bm, 'brass', M, tint, smooth=smooth, colfn=colfn)
    elif mat == 'plain':
        emit(bm, 'decal', M, tint, smooth=smooth, uvfn=PLAIN_UV, colfn=colfn)
    else:
        raise ValueError(mat)

def cull(bm, fn):
    """Delete faces nobody sees (against a wall, on the floor) so they cost no lightmap texels."""
    bm.normal_update()
    dead = [f for f in bm.faces if fn(f)]
    if dead:
        bmesh.ops.delete(bm, geom=dead, context='FACES')
    return bm

def facing(d):
    d = Vector(d)
    return lambda f: f.normal.dot(d) > 0.9

def BX(mat, w, h, d, x, y, z, ry=0.0, rx=0.0, rz=0.0, tint=WHITE, bevel=0.0, seg=1, hide=None):
    """A box in a lounge material; `hide` is a direction whose faces are dropped (e.g. (0, -1, 0) on the floor)."""
    bm = bm_box(w, h, d, bevel, seg)
    bmesh.ops.transform(bm, matrix=xf(x, y, z, ry, rx, rz), verts=bm.verts)
    if hide is not None:
        cull(bm, facing(hide))
    put(bm, mat, None, tint)

def GB(g, mat, w, h, d, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0, **kw):
    x, y, z = g.p(lx, ly, lz)
    BX(mat, w, h, d, x, y, z, g.ry + ry, rx, rz, **kw)

def GP(g, bm, mat, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0, s=None, **kw):
    x, y, z = g.p(lx, ly, lz)
    put(bm, mat, xf(x, y, z, g.ry + ry, rx, rz, s), **kw)

def lathe(mat, profile, M, segs=20, tint=WHITE, smooth=True):
    put(bm_lathe(profile, segs), mat, M, tint, smooth)

def quad_facing(pts, want):
    bm = bm_poly(pts)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    if bm.faces[0].normal.dot(Vector(want)) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    return bm

def orient(bm, want):
    """Flip faces so their normals agree with want(face_center) -> Vector."""
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.dot(want(f.calc_center_median())) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    return bm

def rect_sweep(O, U, V, N, hw, hh, section):
    """A mitred moulding around the rectangle |u| <= hw, |v| <= hh of the plane (O; U, V). section = [(a, n)]: a inward
    from the rectangle's edge, n along N; closed (it runs back along the wall), so the normals come out right."""
    O, U, V, N = Vector(O), Vector(U), Vector(V), Vector(N)
    bm = bmesh.new()
    rings = []
    for (cu, cv) in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)):
        su, sv = -math.copysign(1, cu), -math.copysign(1, cv)
        rings.append([bm.verts.new(O + U * (cu + su * a) + V * (cv + sv * a) + N * n) for (a, n) in section])
    m = len(section)
    for i in range(4):
        A, Bq = rings[i], rings[(i + 1) % 4]
        for k in range(m):
            l = (k + 1) % m
            bm.faces.new((A[k], A[l], Bq[l], Bq[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return cull(bm, facing(-N))

def axis_to(n):
    """Rotation taking +Y to the direction n."""
    return Vector((0, 1, 0)).rotation_difference(Vector(n).normalized()).to_matrix().to_4x4()

def sheet(kind, O, U, V, w, h, rect=(0.0, 0.0, 1.0, 1.0), nu=1, nv=1, lift=None, tint=WHITE, back=None):
    """A printed sheet: lower-left corner O, texture u along U and v along V, facing U x V. lift(s, t) -> (du, dv, dn)
    displaces it (curling paper). back: a plain colour for its reverse side."""
    O, U, V = Vector(O), Vector(U).normalized(), Vector(V).normalized()
    N = U.cross(V)
    bm = bmesh.new()
    lay = bm.verts.layers.float_vector.new('st')
    grid = []
    for i in range(nu + 1):
        col = []
        for j in range(nv + 1):
            s, t = i / nu, j / nv
            du, dv, dn = lift(s, t) if lift else (0.0, 0.0, 0.0)
            v = bm.verts.new(O + U * (s * w + du) + V * (t * h + dv) + N * dn)
            v[lay] = Vector((s, t, 0))
            col.append(v)
        grid.append(col)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    u0, v0, u1, v1 = rect
    def uv(f):
        return [(SLOT * DEC[kind] + u0 + l.vert[lay].x * (u1 - u0), v0 + l.vert[lay].y * (v1 - v0)) for l in f.loops]
    bk = None
    if back is not None:
        bk = bm.copy()
        bmesh.ops.reverse_faces(bk, faces=list(bk.faces))
        bk.normal_update()
        for v in bk.verts:
            v.co -= N * 0.0006
    emit(bm, 'decal', None, tint, uvface=uv)
    if bk is not None:
        put(bk, 'plain', None, back)

# ============================================================================ the room
def floor_and_rug():
    # The floor is one sheet with the plank texture tiled on it, so its lightmap is one seamless island.
    bm = quad_facing([(X0, 0, Z0), (X0, 0, Z1), (X1, 0, Z1), (X1, 0, Z0)], (0, 1, 0))
    emit(bm, 'decal', None, WHITE, uvfn=lambda co, n: (SLOT * DEC['floor'] + co.x / FLOOR_T[0], -co.z / FLOOR_T[1]))
    # Rug: a thick wool rug under the desk; its selvedge and fringe.
    y = 0.009
    sheet('rug', (DX + RUG_W / 2, y, DZ - RUG_H / 2), (-1, 0, 0), (0, 0, 1), RUG_W, RUG_H, nu=6, nv=4)
    x0, x1, z0, z1 = DX - RUG_W / 2, DX + RUG_W / 2, DZ - RUG_H / 2, DZ + RUG_H / 2
    for (a, b, n) in (((x0, z0), (x1, z0), (0, 0, -1)), ((x1, z0), (x1, z1), (1, 0, 0)), ((x1, z1), (x0, z1), (0, 0, 1)), ((x0, z1), (x0, z0), (-1, 0, 0))):
        put(quad_facing([(a[0], 0, a[1]), (b[0], 0, b[1]), (b[0], y, b[1]), (a[0], y, a[1])], n), 'plain', None, RUG_EDGE)
    for side in (-1, 1):
        xe = DX + side * RUG_W / 2
        pts = []
        nf = 46
        for k in range(nf):
            z = z0 + 0.03 + (RUG_H - 0.06) * k / (nf - 1)
            L = 0.075 + 0.012 * math.sin(k * 2.3)
            pts += [(xe, 0.004, z - 0.009), (xe + side * L, 0.002, z - 0.006), (xe + side * L, 0.002, z + 0.006), (xe, 0.004, z + 0.009)]
        put(orient(bm_poly(pts), lambda c: Vector((0, 1, 0))), 'plain', None, FRINGE)

def wall(axis, wf, inward, runs, bays, top=BEAM_Y + 0.01):
    """Walnut panelling on a wall ('x': the wall at z = wf, running along x; 'z': at x = wf). runs: [(u0, u1)] where the
    skirting, dado, chair rail and upper rails run; bays: [(u0, u1, n)] groups of n panels."""
    nrm = (0, 0, inward) if axis == 'x' else (inward, 0, 0)
    P = (lambda u, v, d: (u, v, wf + inward * d)) if axis == 'x' else (lambda u, v, d: (wf + inward * d, v, u))
    back = (0, 0, -inward) if axis == 'x' else (-inward, 0, 0)
    def wbox(ua, ub, va, vb, d0, d1, tint=WHITE, bevel=0.0):
        cu, cv, cd = (ua + ub) / 2, (va + vb) / 2, (d0 + d1) / 2
        x, y, z = P(cu, cv, cd)
        if axis == 'x':
            BX('wood', ub - ua, vb - va, d1 - d0, x, y, z, tint=tint, bevel=bevel, hide=back)
        else:
            BX('wood', d1 - d0, vb - va, ub - ua, x, y, z, tint=tint, bevel=bevel, hide=back)
    for (u0, u1) in runs:
        put(quad_facing([P(u0, -0.02, 0), P(u1, -0.02, 0), P(u1, top, 0), P(u0, top, 0)], nrm), 'wood', None, DARKW)
        wbox(u0, u1, 0.0, 0.19, 0, 0.028, tint=mul(WHITE, 0.8), bevel=0.006)          # skirting
        wbox(u0, u1, 0.19, 0.26, 0, 0.022)
        wbox(u0, u1, 0.80, 0.88, 0, 0.022)
        wbox(u0, u1, 0.88, 0.95, 0, 0.046, bevel=0.012)                               # chair rail
        wbox(u0, u1, 0.95, 1.05, 0, 0.022)
        wbox(u0, u1, 2.50, 2.62, 0, 0.022)
    for (u0, u1, n) in bays:
        bw = (u1 - u0) / n
        for i in range(n + 1):
            u = u0 + i * bw
            a, b = max(u0, u - 0.045), min(u1, u + 0.045)
            wbox(a, b, 0.26, 0.80, 0, 0.022)
            wbox(a, b, 1.05, 2.50, 0, 0.022)
        for i in range(n):
            ua, ub = u0 + i * bw + 0.075, u0 + (i + 1) * bw - 0.075
            wbox(ua, ub, 0.29, 0.77, 0, 0.017, tint=RICH, bevel=0.013)                  # raised fields
            wbox(ua, ub, 1.085, 2.465, 0, 0.017, tint=RICH, bevel=0.013)

def walls():
    # North: the elevator's surround in the middle (see elevator_surround), three bays either side.
    wall('x', Z0, 1, [(X0, -0.98), (0.98, X1)], [(X0, -1.3, 3), (1.3, X1, 3)])
    # West and east: panelled from the north corner to the bookcase.
    wall('z', X0, 1, [(Z0, CAB_F)], [(Z0, CAB_F, 7)])
    wall('z', X1, -1, [(Z0, CAB_F)], [(Z0, CAB_F, 7)])
    # The room's cornice, running across the bookcase's top too.
    zc = (Z0 + SHELF_F) / 2
    sec = [(0.0, 2.6), (0.012, 2.6), (0.012, 2.63), (0.03, 2.65), (0.036, 2.7), (0.07, 2.735), (0.078, 2.78),
           (0.112, 2.8), (0.112, 2.822), (0.0, 2.822)]
    bm = rect_sweep((0, 0, zc), (1, 0, 0), (0, 0, 1), (0, 1, 0), (X1 - X0) / 2, (SHELF_F - Z0) / 2, sec)
    on_wall = lambda f: all(abs(abs(v.co.x) - X1) < 1e-4 or abs(v.co.z - Z0) < 1e-4 or abs(v.co.z - SHELF_F) < 1e-4 for v in f.verts)
    put(cull(bm, lambda f: on_wall(f) or f.normal.y > 0.9), 'wood', None, WHITE)

def elevator_surround():
    """The doorway the game's car and sliding doors sit behind: a pocket for the leaves between the plate and this wall,
    walnut jambs, fluted pilasters and an entablature with a brass floor dial."""
    x0, x1 = EL_X - HOLE_HW, EL_X + HOLE_HW
    # Front face of the wall around the opening, the jambs and the head.
    for poly in wall_pieces(-0.98, 0.98, [(x0, x1, -1.0, HOLE_H)], lambda u: BEAM_Y + 0.01):
        put(quad_facing([(u, v, Z0) for (u, v) in poly], (0, 0, 1)), 'wood', None, DARKW)
    put(quad_facing([(x0, 0, BACK_Z), (x0, 0, Z0), (x0, HOLE_H, Z0), (x0, HOLE_H, BACK_Z)], (1, 0, 0)), 'wood', None, RICH)
    put(quad_facing([(x1, 0, BACK_Z), (x1, 0, Z0), (x1, HOLE_H, Z0), (x1, HOLE_H, BACK_Z)], (-1, 0, 0)), 'wood', None, RICH)
    put(quad_facing([(x0, HOLE_H, BACK_Z), (x1, HOLE_H, BACK_Z), (x1, HOLE_H, Z0), (x0, HOLE_H, Z0)], (0, -1, 0)), 'wood', None, RICH)
    # Brass threshold over the pocket.
    BX('brass', 2 * HOLE_HW, 0.012, Z0 + 0.02 - (BACK_Z - 0.01), EL_X, 0.006, (Z0 + 0.02 + BACK_Z - 0.01) / 2, tint=OLDBRASS, hide=(0, -1, 0))
    for s in (-1, 1):
        cx = EL_X + s * (HOLE_HW + 0.15)
        BX('wood', 0.32, 0.22, 0.05, cx, 0.11, Z0 + 0.025, tint=mul(WHITE, 0.85), bevel=0.008, hide=(0, 0, -1))      # plinth
        BX('wood', 0.28, HOLE_H - 0.22 - 0.1, 0.034, cx, 0.22 + (HOLE_H - 0.32) / 2, Z0 + 0.017, hide=(0, 0, -1))       # shaft
        for k in (-1, 0, 1):                                                                                           # flutes
            BX('wood', 0.035, HOLE_H - 0.5, 0.012, cx + k * 0.075, 0.31 + (HOLE_H - 0.5) / 2, Z0 + 0.036, tint=RICH, bevel=0.005, hide=(0, 0, -1))
        BX('wood', 0.32, 0.1, 0.05, cx, HOLE_H - 0.05, Z0 + 0.025, bevel=0.01, hide=(0, 0, -1))                          # capital
    # Entablature: architrave, frieze, cornice.
    BX('wood', 2.2, 0.08, 0.05, EL_X, HOLE_H + 0.04, Z0 + 0.025, tint=RICH, bevel=0.008, hide=(0, 0, -1))
    BX('wood', 2.14, 0.16, 0.03, EL_X, HOLE_H + 0.16, Z0 + 0.015, hide=(0, 0, -1))
    BX('wood', 2.3, 0.07, 0.085, EL_X, HOLE_H + 0.275, Z0 + 0.0425, tint=RICH, bevel=0.015, seg=2, hide=(0, 0, -1))
    # The floor dial: a brass half-disc with three stops, its needle on the last.
    dc = Vector((EL_X, HOLE_H + 0.1, Z0 + 0.032))
    poly = [(dc.x + math.cos(PI * k / 20) * 0.1, dc.y + math.sin(PI * k / 20) * 0.1) for k in range(21)] + [(dc.x, dc.y)]
    put(cull(bm_prism(poly, Z0 + 0.03, Z0 + 0.034, 'x'), facing((0, 0, -1))), 'brass', None, BRASS)
    for k, a in enumerate((150, 90, 30)):
        r0, r1 = 0.075, 0.093
        p0 = dc + Vector((math.cos(D(a)) * r0, math.sin(D(a)) * r0, 0.002))
        p1 = dc + Vector((math.cos(D(a)) * r1, math.sin(D(a)) * r1, 0.002))
        beam('brass', tuple(p0), tuple(p1), 0.005, 0.002, tint=mul(OLDBRASS, 0.5))
    tip = dc + Vector((math.cos(D(30)) * 0.085, math.sin(D(30)) * 0.085, 0.004))
    beam('brass', tuple(dc + Vector((0, 0, 0.004))), tuple(tip), 0.004, 0.0015, tint=mul(OLDBRASS, 0.45))
    SPH('brass', 0.008, dc.x, dc.y, dc.z + 0.004, 10, 6, tint=BRASS)
    # Escutcheon for the game's call button.
    cx = EL_X + CALL[0]
    BX('brass', 0.1, 0.17, 0.006, cx, CALL[1], Z0 + 0.003, tint=BRASS, bevel=0.003, hide=(0, 0, -1))

def ceiling():
    xs = [X0, -2.1, -0.7, 0.7, 2.1, X1]
    zs = [Z0, -1.5, 0.0, 1.5, Z1]
    edge = lambda k, n: 0.12 if k in (0, n) else 0.1        # beam half-widths (the wall beams are 12 cm)
    with layer('lo'):
        for i in range(5):
            for j in range(4):
                xa, xb = xs[i] + edge(i, 5), xs[i + 1] - edge(i + 1, 5)
                za, zb = zs[j] + edge(j, 4), zs[j + 1] - edge(j + 1, 4)
                put(quad_facing([(xa, H, za), (xb, H, za), (xb, H, zb), (xa, H, zb)], (0, -1, 0)), 'plain', None, PLASTER)
                sec = [(0.0, 0.0), (0.0, -0.035), (0.012, -0.045), (0.03, -0.03), (0.05, -0.012), (0.056, 0.0)]
                bm = rect_sweep(((xa + xb) / 2, H, (za + zb) / 2), (1, 0, 0), (0, 0, 1), (0, -1, 0), (xb - xa) / 2, (zb - za) / 2, sec)
                put(bm, 'wood', None, RICH)
        dep = H - BEAM_Y
        for j, z in enumerate(zs):                          # along x
            hw = edge(j, 4)
            za, zb = (z, z + hw) if j == 0 else (z - hw, z) if j == 4 else (z - hw, z + hw)
            BX('wood', X1 - X0, dep, zb - za, 0, (H + BEAM_Y) / 2, (za + zb) / 2, bevel=0.012 if 0 < j < 4 else 0.0, hide=(0, 1, 0))
        for i, x in enumerate(xs):                          # along z, between the x beams
            hw = edge(i, 5)
            xa, xb = (x, x + hw) if i == 0 else (x - hw, x) if i == 5 else (x - hw, x + hw)
            for j in range(4):
                za, zb = zs[j] + edge(j, 4), zs[j + 1] - edge(j + 1, 4)
                BX('wood', xb - xa, dep - 0.004, zb - za, (xa + xb) / 2, (H + BEAM_Y) / 2 + 0.002, (za + zb) / 2,
                   bevel=0.012 if 0 < i < 5 else 0.0, hide=(0, 1, 0))

# ============================================================================ the bookcase (south wall)
PALETTE = [(OXBLOOD, 4), (MAROON, 3), (CHESTNUT, 4), (DKBROWN, 4), (TAN, 2), (NAVY, 2), (SLATE, 1), (BLACKL, 2),
           (VELLUM, 1.5), (OCHRE, 1), (COGNAC, 2), (RUSTB, 1.5), (PLUM, 1)]

def pick(rs, pal):
    tot = sum(w for _, w in pal)
    r = rs.uniform(0, tot)
    for c, w in pal:
        r -= w
        if r <= 0:
            return c
    return pal[-1][0]

def book(x, y, zf, t, h, d, col, bands, left, right):
    """An upright book on a shelf at height y, its spine at z = zf facing -z (into the room). bands: [(a, b)] gilt bands
    across the spine (fractions of h). left/right: the height from which that side shows above its neighbour."""
    rows = {0.0, 1.0}
    for (a, b) in bands:
        rows |= {a - 0.004, a, b, b + 0.004}
    rows = sorted(r for r in rows if 0.0 <= r <= 1.0)
    gilt = tuple(col[i] * 0.25 + GILT[i] * 0.75 for i in range(3))
    def colfn(co):
        f = (co.y - y) / h
        return gilt if any(a - 1e-6 <= f <= b + 1e-6 for (a, b) in bands) else col
    bm = bmesh.new()
    L = [bm.verts.new((x, y + r * h, zf)) for r in rows]
    R = [bm.verts.new((x + t, y + r * h, zf)) for r in rows]
    for i in range(len(rows) - 1):
        bm.faces.new((L[i], L[i + 1], R[i + 1], R[i]))
    orient(bm, lambda c: Vector((0, 0, -1)))
    put(bm, 'leather', None, WHITE, colfn=colfn)
    # Page block on top, and whichever sides show above the neighbours.
    put(quad_facing([(x + 0.003, y + h - 0.004, zf + 0.004), (x + t - 0.003, y + h - 0.004, zf + 0.004),
                     (x + t - 0.003, y + h - 0.004, zf + d - 0.004), (x + 0.003, y + h - 0.004, zf + d - 0.004)], (0, 1, 0)), 'plain', None, mul(PAGE, 0.85))
    for (xs, ya, n) in ((x, left, -1), (x + t, right, 1)):
        if ya >= h - 0.004:
            continue
        put(quad_facing([(xs, y + ya, zf), (xs, y + h, zf), (xs, y + h, zf + d), (xs, y + ya, zf + d)], (n, 0, 0)), 'leather', None, mul(col, 0.85))

def shelf_row(rs, x0, x1, y, hgap, objects=None):
    """Fill one shelf with books: sets of matching volumes, odd singles, the occasional lying stack and gap."""
    items = []
    x = x0 + rs.uniform(0.004, 0.03)
    run = 0
    cur = None
    while x < x1 - 0.015:
        if run <= 0:
            r = rs.random()
            if r < 0.06 and x1 - x > 0.3:
                items.append(('stack', x, rs.randint(3, 5)))
                x += 0.26 + rs.uniform(0.0, 0.04)
                continue
            if r < 0.1:
                x += rs.uniform(0.05, 0.14)
                cur = None
                continue
            if r < 0.45:
                run = rs.randint(3, 9)
                c = pick(rs, PALETTE)
                h = min(hgap - 0.025, hgap * rs.uniform(0.66, 0.9))
                cur = dict(col=c, h=h, t=rs.uniform(0.028, 0.05), d=rs.uniform(0.17, 0.24),
                           bands=[(0.08, 0.1), (0.84, 0.86)] + ([(0.62, 0.64)] if rs.random() < 0.5 else []))
            else:
                run = 1
                c = pick(rs, PALETTE)
                cur = dict(col=c, h=min(hgap - 0.02, hgap * rs.uniform(0.55, 0.94)), t=rs.uniform(0.016, 0.07),
                           d=rs.uniform(0.13, 0.26), bands=[] if rs.random() < 0.35 else [(0.07, 0.09), (0.86, 0.885)])
        b = dict(cur)
        k = 1.0 + rs.uniform(-0.1, 0.1)
        b['col'] = mul(b['col'], k)
        b['t'] *= rs.uniform(0.85, 1.15)
        if x + b['t'] > x1 - 0.005:
            break
        items.append(('book', x, b))
        x += b['t'] + rs.uniform(0.0, 0.004)
        run -= 1
    zf0 = SHELF_F + 0.012
    books = items
    for i, it in enumerate(books):
        if it[0] == 'stack':
            _, sx, n = it
            yy = y
            for k in range(n):
                t = rs.uniform(0.025, 0.05)
                w = rs.uniform(0.19, 0.25)
                dd = rs.uniform(0.15, 0.22)
                c = mul(pick(rs, PALETTE), rs.uniform(0.9, 1.1))
                cx = sx + 0.13 + rs.uniform(-0.015, 0.015)
                BX('leather', w, t, dd, cx, yy + t / 2, zf0 + dd / 2 + 0.01, ry=rs.uniform(-0.06, 0.06), tint=c, hide=(0, -1, 0))
                yy += t
            continue
        _, bx, b = it
        prev = books[i - 1] if i > 0 else None
        nxt = books[i + 1] if i + 1 < len(books) else None
        left = prev[2]['h'] if prev and prev[0] == 'book' and abs(prev[1] + prev[2]['t'] - bx) < 0.006 else 0.0
        right = nxt[2]['h'] if nxt and nxt[0] == 'book' and abs(bx + b['t'] - nxt[1]) < 0.006 else 0.0
        book(bx, y, zf0 + rs.uniform(0.0, 0.012), b['t'], b['h'], b['d'], b['col'], b['bands'], left, right)

def bookcase():
    rs = random.Random(404)
    nb = 7
    bw = (X1 - X0) / nb
    yl = [0.86, 1.24, 1.6, 1.95, 2.3, 2.62]         # cabinet top, four shelves, top board
    # Cabinets: plinth, doors, ledge.
    BX('wood', X1 - X0, 0.09, Z1 - CAB_F - 0.03, 0, 0.045, (Z1 + CAB_F + 0.03) / 2, tint=mul(WHITE, 0.6), hide=(0, 0, 1))
    BX('wood', X1 - X0, 0.06, Z1 - CAB_F + 0.03, 0, 0.83, (Z1 + CAB_F - 0.03) / 2, tint=RICH, bevel=0.012, seg=2, hide=(0, 0, 1))
    for i in range(nb + 1):
        x = X0 + i * bw
        BX('wood', 0.07, 0.71, 0.02, min(X1 - 0.035, max(X0 + 0.035, x)), 0.445, CAB_F + 0.01, hide=(0, 0, 1))
    for i in range(nb):
        xa = X0 + i * bw + 0.035
        dw = (bw - 0.07) / 2
        for k in range(2):
            cx = xa + dw * (k + 0.5)
            BX('wood', dw - 0.006, 0.66, 0.02, cx, 0.445, CAB_F + 0.01, tint=WHITE, bevel=0.004, hide=(0, 0, 1))
            BX('wood', dw - 0.1, 0.52, 0.012, cx, 0.445, CAB_F - 0.004, tint=RICH, bevel=0.01, hide=(0, 0, 1))
            kx = cx + (dw / 2 - 0.05) * (1 if k == 0 else -1)
            lathe('brass', [(0.0, 0.0), (0.012, 0.0), (0.008, 0.012), (0.011, 0.02), (0.014, 0.028), (0.01, 0.035), (0.0, 0.036)],
                  xf(kx, 0.47, CAB_F - 0.01, rx=-PI / 2), 12, BRASS)
    # Open shelves: back, uprights with a pilaster face, shelves with a lip, and the books.
    put(quad_facing([(X0, yl[0], Z1 - 0.004), (X1, yl[0], Z1 - 0.004), (X1, yl[-1], Z1 - 0.004), (X0, yl[-1], Z1 - 0.004)], (0, 0, -1)), 'wood', None, mul(WHITE, 0.55))
    for i in range(nb + 1):
        x = min(X1 - 0.022, max(X0 + 0.022, X0 + i * bw))
        BX('wood', 0.044, yl[-1] - yl[0], Z1 - SHELF_F, x, (yl[0] + yl[-1]) / 2, (Z1 + SHELF_F) / 2, hide=(0, 0, 1))
        BX('wood', 0.07, yl[-1] - yl[0], 0.014, min(X1 - 0.035, max(X0 + 0.035, x)), (yl[0] + yl[-1]) / 2, SHELF_F - 0.007, tint=RICH, bevel=0.005, hide=(0, 0, 1))
    for y in yl[1:]:
        BX('wood', X1 - X0, 0.024, Z1 - SHELF_F, 0, y - 0.012, (Z1 + SHELF_F) / 2, hide=(0, 0, 1))
        BX('wood', X1 - X0, 0.036, 0.016, 0, y - 0.018, SHELF_F - 0.006, tint=RICH, bevel=0.005, hide=(0, 0, 1))
    specials = {(1, 2): 'charts', (5, 1): 'charts', (3, 4): 'hourglass', (6, 3): 'telescope', (0, 0): 'box', (4, 0): 'clock'}
    for i in range(nb):
        xa, xb = X0 + i * bw + 0.057, X0 + (i + 1) * bw - 0.057
        for r in range(5):
            y0 = yl[r] + (0.0 if r == 0 else 0.0)
            gap = yl[r + 1] - yl[r] - 0.024
            sp = specials.get((i, r))
            if sp:
                xm = shelf_object(sp, xa, xb, y0, gap, rs)
                shelf_row(rs, xm, xb, y0, gap)
            else:
                shelf_row(rs, xa, xb, y0, gap)

def shelf_object(kind, xa, xb, y, gap, rs):
    """Something other than books at the left of a shelf; returns where the books start."""
    zc = SHELF_F + 0.16
    if kind == 'charts':
        # Rolled charts lying front to back, one tied with a ribbon.
        for k, (dx, dy, r) in enumerate(((0.05, 0.0, 0.03), (0.115, 0.0, 0.028), (0.08, 0.052, 0.027), (0.17, 0.0, 0.025))):
            L = 0.3 - k * 0.02
            put(bm_cyl(r, r, L, 18), 'plain', xf(xa + dx, y + r + dy, zc - 0.01, rx=PI / 2), mul(PAPERBACK, 1.0 - 0.06 * k), smooth=True)
            if k == 1:
                put(bm_torus(r + 0.001, 0.003, 18, 5), 'leather', xf(xa + dx, y + r + dy, zc - 0.05, rx=PI / 2), OXBLOOD, smooth=True)
        return xa + 0.22
    if kind == 'hourglass':
        cx = xa + 0.07
        for yy in (0.0, 0.2):
            lathe('wood', [(0.0, yy), (0.055, yy), (0.058, yy + 0.008), (0.055, yy + 0.016), (0.0, yy + 0.016)], xf(cx, y, zc), 20, RICH)
        for k in range(3):
            a = 2 * PI * k / 3
            put(bm_lathe([(0.006, 0.016), (0.008, 0.05), (0.005, 0.1), (0.008, 0.15), (0.006, 0.2)], 8), 'brass', xf(cx + math.cos(a) * 0.043, y, zc + math.sin(a) * 0.043), BRASS, True)
        lathe('plain', [(0.0, 0.016), (0.035, 0.03), (0.036, 0.07), (0.008, 0.108), (0.036, 0.146), (0.035, 0.186), (0.0, 0.2)], xf(cx, y, zc), 20, srgb(196, 184, 160))
        return xa + 0.15
    if kind == 'telescope':
        g = xf(xa + 0.02, y + 0.03, zc, rz=-PI / 2)
        lathe('brass', [(0.0, 0.0), (0.024, 0.0), (0.026, 0.012), (0.024, 0.02), (0.024, 0.13), (0.021, 0.14), (0.021, 0.24), (0.018, 0.25),
                        (0.018, 0.34), (0.016, 0.35), (0.0, 0.352)], g, 18, BRASS)
        put(bm_cyl(0.026, 0.026, 0.1, 18), 'leather', g @ Matrix.Translation((0, 0.075, 0)), DKBROWN, smooth=True)
        return xa + 0.38
    if kind == 'box':
        BX('leather', 0.2, 0.09, 0.16, xa + 0.11, y + 0.045, zc - 0.02, tint=OXBLOOD, bevel=0.004, hide=(0, -1, 0))
        BX('brass', 0.03, 0.02, 0.005, xa + 0.11, y + 0.07, zc - 0.1, tint=BRASS)
        return xa + 0.23
    if kind == 'clock':
        # A brass carriage clock with a cream dial and a carrying handle.
        cx, cz = xa + 0.07, zc - 0.05
        BX('brass', 0.085, 0.12, 0.07, cx, y + 0.06, cz, tint=BRASS, bevel=0.004, hide=(0, -1, 0))
        BX('brass', 0.1, 0.012, 0.085, cx, y + 0.126, cz, tint=OLDBRASS, bevel=0.003)
        put(bm_cyl(0.028, 0.028, 0.002, 24), 'plain', xf(cx, y + 0.07, cz - 0.036, rx=PI / 2), srgb(228, 216, 190), smooth=False)
        beam('brass', (cx, y + 0.07, cz - 0.038), (cx - 0.012, y + 0.083, cz - 0.038), 0.002, 0.001, tint=INKGLASS)
        beam('brass', (cx, y + 0.07, cz - 0.038), (cx + 0.016, y + 0.07, cz - 0.038), 0.0015, 0.001, tint=INKGLASS)
        put(bm_torus(0.03, 0.0025, 14, 5, arc=PI), 'brass', xf(cx, y + 0.132, cz, rx=-PI / 2), BRASS, True)
        return xa + 0.15
    return xa

# ============================================================================ the desk
def turned_leg(x, z, y_top, tint=RICH):
    """A turned walnut leg with a brass cup caster, from the floor to y_top (a square block at the top)."""
    lathe('brass', [(0.0, 0.0), (0.027, 0.0), (0.03, 0.01), (0.03, 0.03), (0.026, 0.035), (0.0, 0.036)], xf(x, 0, z), 16, OLDBRASS)
    s = (y_top - 0.075) / 0.52                     # the profile below was drawn for a 0.595 m leg
    prof = [(0.026, 0.035), (0.024, 0.06), (0.022, 0.1), (0.026, 0.13), (0.033, 0.145), (0.026, 0.16), (0.022, 0.18), (0.028, 0.21),
            (0.044, 0.27), (0.05, 0.31), (0.047, 0.35), (0.036, 0.39), (0.028, 0.42), (0.034, 0.44), (0.034, 0.455), (0.028, 0.47),
            (0.03, 0.49), (0.038, 0.505), (0.038, 0.53)]
    lathe('wood', [(r, 0.035 + (y - 0.035) * s) for (r, y) in prof], xf(x, 0, z), 20, tint)
    top0 = 0.035 + (0.53 - 0.035) * s
    BX('wood', 0.075, y_top - top0, 0.075, x, (top0 + y_top) / 2, z, tint=tint)

def bail_pull(p, n, u, w=0.085):
    """A brass bail pull on a drawer face at p facing n, its length along u."""
    p, n, u = Vector(p), Vector(n).normalized(), Vector(u).normalized()
    v = n.cross(u)
    M = Matrix.Translation(p) @ Matrix(((u.x, v.x, n.x, 0), (u.y, v.y, n.y, 0), (u.z, v.z, n.z, 0), (0, 0, 0, 1)))
    put(bm_box(w, 0.032, 0.004, 0.0015), 'brass', M @ Matrix.Translation((0, 0, 0.002)), BRASS)
    for sgn in (-1, 1):
        put(bm_cyl(0.004, 0.004, 0.018, 8), 'brass', M @ Matrix.Translation((sgn * (w / 2 - 0.012), 0.004, 0.01)) @ Matrix.Rotation(PI / 2, 4, 'X'), OLDBRASS, True)
    # The bail hangs from the posts: half a ring in the face plane, tipped out a little.
    put(bm_torus(w / 2 - 0.012, 0.0032, 16, 6, arc=PI), 'brass',
        M @ Matrix.Translation((0, 0.004, 0.019)) @ Matrix.Rotation(-0.3, 4, 'X') @ Matrix.Rotation(PI / 2, 4, 'X'), BRASS, True)

def desk():
    top_t = 0.036
    ap_h = 0.15
    y_ap = DH - top_t
    with layer('hi'):
        # Top: a walnut slab with a rounded edge and a moulding beneath, a tooled leather inlay.
        BX('wood', DW, top_t, DD, DX, DH - top_t / 2, DZ, tint=RICH, bevel=0.012, seg=3)
        sec = [(0.0, 0.0), (0.0, 0.012), (0.01, 0.018), (0.022, 0.02), (0.03, 0.024), (0.03, 0.0)]
        put(rect_sweep((DX, y_ap, DZ), (1, 0, 0), (0, 0, 1), (0, -1, 0), DW / 2 - 0.03, DD / 2 - 0.03, sec), 'wood', None, RICH)
        ix, iz = DW / 2 - 0.075, DD / 2 - 0.075
        leather(bm_poly_facing([(DX - ix, DH + 0.0006, DZ - iz), (DX + ix, DH + 0.0006, DZ - iz), (DX + ix, DH + 0.0006, DZ + iz), (DX - ix, DH + 0.0006, DZ + iz)], (0, 1, 0)), INLAY)
        for inset, wdt in ((0.012, 0.004), (0.022, 0.0016)):
            a, b = ix - inset, iz - inset
            ring = ((-1, -1), (1, -1), (1, 1), (-1, 1))
            for k in range(4):
                (sx0, sz0), (sx1, sz1) = ring[k], ring[(k + 1) % 4]
                p0 = Vector((DX + sx0 * a, DH + 0.0009, DZ + sz0 * b))
                p1 = Vector((DX + sx1 * a, DH + 0.0009, DZ + sz1 * b))
                d = (p1 - p0).normalized()
                nn = Vector((-d.z, 0, d.x)) * (wdt / 2)
                ext = d * (wdt / 2)
                leather(bm_poly_facing([p0 - ext - nn, p1 + ext - nn, p1 + ext + nn, p0 - ext + nn], (0, 1, 0)), mul(GILT, 0.9))
    # Apron with drawers on both long sides, turned legs.
    BX('wood', DW - 0.1, ap_h, DD - 0.1, DX, y_ap - ap_h / 2, DZ, tint=WHITE, hide=(0, 1, 0))
    lx, lz = DW / 2 - 0.05 - 0.0375, DD / 2 - 0.05 - 0.0375
    for sx in (-1, 1):
        for sz in (-1, 1):
            turned_leg(DX + sx * lx, DZ + sz * lz, y_ap - 0.0)
    widths = [0.44, 0.5, 0.44]
    for side in (-1, 1):
        zf = DZ + side * (DD / 2 - 0.05)
        x = DX - 0.74 + 0.025
        for k, w in enumerate(widths):
            cx = x + w / 2
            cy = y_ap - ap_h / 2
            BX('wood', w, 0.112, 0.016, cx, cy, zf + side * 0.008, tint=RICH, bevel=0.004, hide=(0, 0, -side))
            BX('wood', w - 0.05, 0.07, 0.006, cx, cy, zf + side * 0.018, tint=WHITE, bevel=0.004, hide=(0, 0, -side))
            bail_pull((cx, cy - 0.004, zf + side * 0.021), (0, 0, side), (-side, 0, 0))
            if k == 1:
                BX('brass', 0.02, 0.03, 0.003, cx, cy + 0.03, zf + side * 0.0225, tint=BRASS)
                BX('plain', 0.004, 0.011, 0.001, cx, cy + 0.028, zf + side * 0.0245, tint=INKGLASS)
            x += w + 0.025
        # Cock beads between the drawers and round the apron.
        BX('wood', DW - 0.1, 0.008, 0.01, DX, y_ap - 0.004, zf + side * 0.004, tint=RICH)
        BX('wood', DW - 0.1, 0.008, 0.01, DX, y_ap - ap_h + 0.004, zf + side * 0.004, tint=RICH)
    for sx in (-1, 1):
        # Short ends: a panel.
        xf_ = DX + sx * (DW / 2 - 0.05)
        BX('wood', 0.008, 0.1, DD - 0.3, xf_ + sx * 0.004, y_ap - ap_h / 2, DZ, tint=RICH, bevel=0.003, hide=(-sx, 0, 0))
    desk_things()

def bm_poly_facing(pts, want):
    return quad_facing([tuple(p) for p in pts], want)

def leather(bm, tint):
    put(bm, 'leather', None, tint)

def map_lift(s, t):
    """The map's paper: flat under its weights, the far-left corner (canvas top left) rolling up, a gentle wave."""
    x, y = s * MAP_W, t * MAP_H
    dn = 0.0015 + 0.0012 * math.sin(s * 9.0 + 1.3) * math.sin(t * 7.0)
    du = dv = 0.0
    dirv = Vector((1, -1)).normalized()                  # from the corner into the sheet
    along = Vector((x, y - MAP_H)).dot(dirv)
    past = 0.1 - along                                    # beyond the fold line, toward the corner
    if past > 0:
        R = 0.1
        th = past / R
        back = past - R * math.sin(th)                    # rolling up pulls the paper back toward the fold
        du, dv = dirv.x * back, dirv.y * back
        dn += R * (1 - math.cos(th))
    # The near edge lifts a little between its two weights.
    dn += 0.004 * math.sin(PI * s) * max(0.0, 1 - t / 0.12) ** 2
    return (du, dv, dn)

def desk_things():
    """On the desk: the map with its weights, the card, the lamp, dividers, a pen and ink."""
    with layer('hi'):
        # The map is read from the elevator side (the viewer faces +z): texture u runs to -x, v to +z.
        O = MAPC + Vector((MAP_W / 2, 0.0005, -MAP_H / 2))
        sheet('map', O, (-1, 0, 0), (0, 0, 1), MAP_W, MAP_H, nu=46, nv=32, lift=map_lift, back=PAPERBACK)
        # The card, beside it on the viewer's left in the lamp's pool, turned a little; it reads the same way as the map.
        c = MAPC + Vector((MAP_W / 2 + 0.075, 0, 0.1))
        a = D(8)
        U = Vector((-math.cos(a), 0, math.sin(a)))
        V = Vector((math.sin(a), 0, math.cos(a)))
        card(c, U, V)
    # Weights: a brass paperweight (near left corner), an inkwell (far right), a small book (near right).
    nl = MAPC + Vector((MAP_W / 2 - 0.06, 0, -MAP_H / 2 + 0.06))
    fr = MAPC + Vector((-MAP_W / 2 + 0.07, 0, MAP_H / 2 - 0.07))
    nr = MAPC + Vector((-MAP_W / 2 + 0.09, 0, -MAP_H / 2 + 0.08))
    with layer('hi'):
        lathe('brass', [(0.0, 0.0), (0.042, 0.0), (0.045, 0.006), (0.044, 0.014), (0.038, 0.024), (0.026, 0.034), (0.012, 0.04),
                        (0.01, 0.046), (0.014, 0.054), (0.012, 0.062), (0.0, 0.064)], xf(nl.x, DH + 0.0025, nl.z), 24, BRASS)
        # Inkwell: square dark glass with a hinged brass cap.
        BX('plain', 0.07, 0.05, 0.07, fr.x, DH + 0.0025 + 0.025, fr.z, ry=0.3, tint=INKGLASS, bevel=0.008, seg=2, hide=(0, -1, 0))
        lathe('brass', [(0.0, 0.05), (0.022, 0.05), (0.024, 0.056), (0.02, 0.066), (0.009, 0.072), (0.006, 0.08), (0.0, 0.082)],
              xf(fr.x, DH + 0.0025, fr.z), 16, BRASS)
        # Small book, a blue cloth one.
        BX('leather', 0.13, 0.028, 0.19, nr.x, DH + 0.0025 + 0.014, nr.z, ry=0.12, tint=NAVY, bevel=0.002, hide=(0, -1, 0))
        BX('plain', 0.125, 0.022, 0.186, nr.x - 0.004, DH + 0.0025 + 0.014, nr.z, ry=0.12, tint=mul(PAGE, 0.9), hide=(0, -1, 0))
        # Dividers lying open on the map.
        hp = MAPC + Vector((0.08, 0.004, 0.03))
        for a in (D(200), D(232)):
            tip = hp + Vector((math.cos(a) * 0.15, -0.002, math.sin(a) * 0.15))
            put(bm_tube([tuple(hp), tuple(tip)], 0.0028, 6, r_end=0.0008), 'brass', None, BRASS, True)
        SPH('brass', 0.008, hp.x, hp.y + 0.002, hp.z, 12, 8, tint=BRASS)
        # A pencil.
        q0, q1 = MAPC + Vector((-0.2, 0.0055, 0.16)), MAPC + Vector((-0.02, 0.0055, 0.21))
        put(bm_tube([tuple(q0), tuple(q1)], 0.0035, 6), 'plain', None, srgb(160, 110, 50), False)
        put(bm_tube([tuple(q1), tuple(q1 + (q1 - q0).normalized() * 0.018)], 0.0035, 6, r_end=0.0004), 'plain', None, srgb(200, 170, 130), False)
        # Two books stacked at the far right of the desk.
        br = Vector((DX - DW / 2 + 0.22, DH, DZ + DD / 2 - 0.2))
        BX('leather', 0.26, 0.045, 0.19, br.x, DH + 0.0225, br.z, ry=0.05, tint=OXBLOOD, bevel=0.003, hide=(0, -1, 0))
        BX('leather', 0.23, 0.035, 0.17, br.x + 0.01, DH + 0.045 + 0.0175, br.z, ry=-0.08, tint=DKBROWN, bevel=0.003, hide=(0, -1, 0))
    desk_lamp()

def card(c, U, V):
    """The red card: square, coaster-thick, rounded corners. Its top face is the card texture (dots over it)."""
    h = 0.0018
    r = 0.007
    pts = []
    for (sx, sy) in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        cx, cy = sx * (CARD / 2 - r), sy * (CARD / 2 - r)
        a0 = math.atan2(sy, sx) - PI / 4
        for k in range(6):
            a = a0 + (PI / 2) * k / 5
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    top = [c + U * px + V * py + Vector((0, h, 0)) for (px, py) in pts]
    bm = bm_poly_facing(top, (0, 1, 0))
    lay = bm.verts.layers.float_vector.new('st')
    for v, (px, py) in zip(bm.verts, pts):
        v[lay] = Vector((px / CARD + 0.5, py / CARD + 0.5, 0))
    emit(bm, 'decal', None, WHITE, uvface=lambda f: [(SLOT * DEC['card'] + l.vert[lay].x, l.vert[lay].y) for l in f.loops])
    side = bmesh.new()
    n = len(top)
    tv = [side.verts.new(p) for p in top]
    bv = [side.verts.new(p - Vector((0, h, 0))) for p in top]
    for i in range(n):
        j = (i + 1) % n
        side.faces.new((tv[i], bv[i], bv[j], tv[j]))
    put(orient(side, lambda p: (p - c - Vector((0, p.y - c.y, 0)))), 'plain', None, CARD_EDGE)

def shade_colour(bulb, base, spread=0.09):
    def f(co):
        d = abs(co.y - bulb.y)
        k = 0.42 + 0.58 * math.exp(-(d / spread) ** 2)
        return (base[0] * k, base[1] * k, base[2] * k)
    return f

LIGHTS = []   # (position, power (W), colour, radius, name)

def desk_lamp():
    """The key light: a lathe-turned brass lamp with a stepped base, a baluster column and a tapered fabric shade."""
    x, z, y = LAMP.x, LAMP.z, DH
    M = xf(x, y, z)
    with layer('hi'):
        lathe('brass', [(0.0, 0.0), (0.095, 0.0), (0.095, 0.012), (0.088, 0.016), (0.08, 0.016), (0.078, 0.026), (0.066, 0.03),
                        (0.06, 0.03), (0.058, 0.04), (0.045, 0.048), (0.03, 0.052), (0.022, 0.06), (0.02, 0.08), (0.026, 0.09),
                        (0.031, 0.1), (0.026, 0.11), (0.016, 0.12), (0.013, 0.14), (0.012, 0.2), (0.014, 0.23), (0.02, 0.245),
                        (0.025, 0.26), (0.02, 0.275), (0.013, 0.29), (0.011, 0.33), (0.011, 0.36), (0.017, 0.37), (0.017, 0.385),
                        (0.012, 0.39), (0.018, 0.4), (0.018, 0.435), (0.014, 0.44), (0.0, 0.442)], M, 28, BRASS)
        # Harp and finial.
        for s in (-1, 1):
            pts = [(x + s * 0.016, y + 0.4, z), (x + s * 0.06, y + 0.43, z), (x + s * 0.05, y + 0.52, z), (x + s * 0.02, y + 0.585, z), (x, y + 0.6, z)]
            put(bm_tube(rounded_pts(pts), 0.003, 6), 'brass', None, BRASS, True)
        lathe('brass', [(0.0, 0.595), (0.012, 0.598), (0.014, 0.608), (0.009, 0.616), (0.012, 0.626), (0.0, 0.634)], M, 16, BRASS)
        # Cord off the back of the desk.
        cpts = [(x, y + 0.01, z + 0.09), (x - 0.02, y + 0.004, z + 0.14), (x - 0.03, y + 0.003, DZ + DD / 2 - 0.01), (x - 0.035, y - 0.03, DZ + DD / 2 + 0.03), (x - 0.04, 0.3, DZ + DD / 2 + 0.06), (x - 0.06, 0.005, DZ + DD / 2 + 0.12)]
        put(bm_tube(rounded_pts(cpts), 0.0035, 6), 'plain', None, srgb(70, 30, 24), True)
    bulb = Vector((x, y + BULB_Y, z))
    glow(bm_sphere(0.028, 16, 10), xf(bulb.x, bulb.y, bulb.z, s=(1, 1.15, 1)), BULB, 'bulb')
    # Shade: tapered drum, open top and bottom, with rolled rims. Outer (seen from the room) and inner surfaces.
    y0, y1, r0, r1 = y + 0.36, y + 0.58, 0.205, 0.12
    glow(bm_lathe([(r0 + 0.002, y0 - 0.004), (r0 + 0.004, y0 - 0.004), (r0 + 0.006, y0 + 0.004), (r0, y0 + 0.012), (r1, y1 - 0.01),
                   (r1 + 0.004, y1 - 0.003), (r1 + 0.002, y1 + 0.003), (r1 - 0.002, y1 + 0.003)], 40),
         xf(x, 0, z), (1, 1, 1), 'shade', shade_colour(bulb, SHADE_OUT))
    glow(bm_lathe([(r1 - 0.002, y1 + 0.003), (r1 - 0.004, y1 - 0.003), (r0 - 0.004, y0 + 0.004), (r0 + 0.002, y0 - 0.004)], 40),
         xf(x, 0, z), (1, 1, 1), 'shadein', shade_colour(bulb, SHADE_IN, 0.12))
    LIGHTS.append((bulb, 15.0, LAMP_RGB, 0.026, 'desk'))

def rounded_pts(pts, rad=0.03, n=4):
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        r = min(rad, (b - a).length * 0.45, (c - b).length * 0.45)
        p0 = b + (a - b).normalized() * r
        p2 = b + (c - b).normalized() * r
        for k in range(n + 1):
            t = k / n
            out.append(p0 * (1 - t) ** 2 + b * 2 * t * (1 - t) + p2 * t * t)
    out.append(pts[-1])
    return [tuple(p) for p in out]

def glow(bm, M, tint, part, colfn=None):
    with layer(part):
        emit(bm, 'glow', M, tint, smooth=True, colfn=colfn)

# ============================================================================ seating, tables, instruments
def club_chair(x, z, ry, tint):
    """A leather club chair: rolled arms, a buttoned back, a loose seat cushion, turned feet, brass nailheads."""
    g = G(x, 0, z, ry)
    W, Dp = 0.84, 0.86
    for sx in (-1, 1):
        for sz in (-1, 1):
            px, py, pz = g.p(sx * (W / 2 - 0.08), 0, sz * (Dp / 2 - 0.09))
            lathe('brass', [(0.0, 0.0), (0.02, 0.0), (0.022, 0.012), (0.0, 0.014)], xf(px, 0, pz), 12, OLDBRASS)
            lathe('wood', [(0.02, 0.012), (0.026, 0.025), (0.032, 0.045), (0.028, 0.06), (0.033, 0.07), (0.033, 0.08)], xf(px, 0, pz), 14, RICH)
    GB(g, 'leather', W, 0.32, Dp, 0, 0.08 + 0.16, 0, bevel=0.035, seg=2, tint=tint, hide=(0, -1, 0))
    GB(g, 'leather', W - 0.36, 0.13, Dp - 0.3, 0, 0.4 + 0.06, 0.07, bevel=0.05, seg=3, tint=mul(tint, 1.06))
    for sx in (-1, 1):
        GB(g, 'leather', 0.17, 0.24, Dp - 0.06, sx * (W / 2 - 0.085), 0.4 + 0.1, 0.02, bevel=0.045, seg=3, tint=tint)
        GP(g, bm_cyl(0.095, 0.095, Dp - 0.08, 20), 'leather', sx * (W / 2 - 0.1), 0.6, 0.02, rx=PI / 2, tint=tint, smooth=True)
        # The scroll face at the front of each arm and its nailheads.
        GP(g, bm_cyl(0.1, 0.1, 0.02, 20), 'leather', sx * (W / 2 - 0.1), 0.6, Dp / 2 - 0.05, rx=PI / 2, tint=mul(tint, 0.85), smooth=True)
        with layer('lo'):
            for k in range(14):
                a = PI * 1.25 - k * (PI * 1.5 / 13)
                px, py, pz = g.p(sx * (W / 2 - 0.1) + math.cos(a) * 0.088, 0.6 + math.sin(a) * 0.088, Dp / 2 - 0.038)
                put(bm_sphere(0.006, 6, 4), 'brass', xf(px, py, pz), OLDBRASS, True)
    Mb = xf(*g.p(0, 0.66, -Dp / 2 + 0.12), g.ry, -0.12)
    put(bm_box(W - 0.02, 0.56, 0.2, 0.06, 3), 'leather', Mb, tint)
    put(bm_cyl(0.1, 0.1, W - 0.04, 20), 'leather', Mb @ Matrix.Translation((0, 0.27, -0.01)) @ Matrix.Rotation(PI / 2, 4, 'Z'), tint, smooth=True)
    with layer('lo'):
        for r in range(3):
            for c in range(5 - (r % 2)):
                bx = (c - (4 - (r % 2)) / 2) * 0.13
                by = -0.12 + r * 0.12
                p = Mb @ Vector((bx, by, 0.101))
                put(bm_sphere(0.009, 8, 5), 'leather', xf(p.x, p.y, p.z), mul(tint, 0.55), True)

def captain_chair(x, z, ry):
    """The desk chair: turned splayed legs, a leather seat pad, spindles up to a curved arm rail."""
    g = G(x, 0, z, ry)
    for sx in (-1, 1):
        for sz in (-1, 1):
            px, _, pz = g.p(sx * 0.19, 0, sz * 0.18)
            prof = [(0.018, 0.0), (0.016, 0.05), (0.02, 0.1), (0.016, 0.14), (0.022, 0.16), (0.024, 0.25), (0.02, 0.33), (0.022, 0.4), (0.02, 0.44)]
            lathe('wood', prof, xf(px, 0, pz, g.ry, sz * 0.05, -sx * 0.05), 12, RICH)
    for (a, b) in (((-0.19, 0.18), (0.19, 0.18)), ((-0.19, -0.18), (0.19, -0.18)), ((-0.19, -0.18), (-0.19, 0.18)), ((0.19, -0.18), (0.19, 0.18))):
        p0, p1 = g.p(a[0], 0.17, a[1]), g.p(b[0], 0.17, b[1])
        put(bm_tube([p0, p1], 0.011, 8), 'wood', None, RICH, True)
    GB(g, 'wood', 0.5, 0.045, 0.46, 0, 0.455, 0, bevel=0.018, seg=2, tint=RICH)
    GB(g, 'leather', 0.42, 0.04, 0.38, 0, 0.495, 0.01, bevel=0.018, seg=3, tint=OXBLOOD)
    # Arm rail: a U round the back, reaching forward to the arms.
    pts = []
    for k in range(25):
        a = PI * k / 24
        pts.append(g.p(math.cos(a) * 0.26, 0.74, -math.sin(a) * 0.23 + 0.02))
    pts = [g.p(0.26, 0.72, 0.2)] + pts + [g.p(-0.26, 0.72, 0.2)]
    put(bm_sweep(pts, rect_section(0.05, 0.028, -0.014)), 'wood', None, RICH, True)
    for k in range(9):
        a = PI * (k + 0.5) / 9
        px, _, pz = g.p(math.cos(a) * 0.245, 0, -math.sin(a) * 0.215 + 0.02)
        lathe('wood', [(0.009, 0.47), (0.012, 0.52), (0.008, 0.58), (0.01, 0.66), (0.008, 0.73)], xf(px, 0, pz), 8, RICH)
    for s in (-1, 1):
        px, _, pz = g.p(s * 0.24, 0, 0.18)
        lathe('wood', [(0.012, 0.47), (0.016, 0.52), (0.011, 0.6), (0.013, 0.7)], xf(px, 0, pz), 10, RICH)

def side_table(x, z):
    lathe('wood', [(0.0, 0.615), (0.25, 0.615), (0.262, 0.622), (0.264, 0.632), (0.258, 0.64), (0.0, 0.642)], xf(x, 0, z), 40, RICH)
    lathe('wood', [(0.05, 0.12), (0.058, 0.15), (0.05, 0.19), (0.034, 0.24), (0.03, 0.38), (0.045, 0.44), (0.03, 0.5), (0.038, 0.57),
                   (0.06, 0.6), (0.06, 0.615)], xf(x, 0, z), 20, RICH)
    for k in range(3):
        a = 2 * PI * k / 3 + 0.3
        pts = []
        for i in range(9):
            t = i / 8
            r = 0.04 + 0.25 * t
            y = 0.16 * (1 - t) ** 1.4 + 0.012
            pts.append((x + math.cos(a) * r, y, z + math.sin(a) * r))
        put(bm_sweep(pts, rect_section(0.032, 0.03, -0.015)), 'wood', None, RICH, True)
        e = pts[-1]
        lathe('brass', [(0.0, 0.0), (0.018, 0.0), (0.02, 0.012), (0.0, 0.02)], xf(e[0], 0, e[2]), 10, OLDBRASS)
    # On it: two books, a brass candlestick with an unlit candle, a small dish.
    BX('leather', 0.2, 0.035, 0.15, x + 0.06, 0.642 + 0.0175, z - 0.07, ry=0.4, tint=MAROON, bevel=0.002, hide=(0, -1, 0))
    BX('leather', 0.18, 0.03, 0.13, x + 0.06, 0.642 + 0.035 + 0.015, z - 0.07, ry=0.25, tint=TAN, bevel=0.002, hide=(0, -1, 0))
    lathe('brass', [(0.0, 0.642), (0.05, 0.642), (0.052, 0.65), (0.03, 0.66), (0.012, 0.67), (0.01, 0.72), (0.016, 0.76), (0.01, 0.8),
                    (0.022, 0.81), (0.022, 0.82), (0.012, 0.82)], xf(x - 0.09, 0, z + 0.06), 20, BRASS)
    lathe('plain', [(0.0105, 0.815), (0.0105, 0.93), (0.006, 0.935), (0.0, 0.936)], xf(x - 0.09, 0, z + 0.06), 12, srgb(230, 220, 196))
    lathe('brass', [(0.0, 0.642), (0.05, 0.642), (0.058, 0.655), (0.052, 0.656), (0.042, 0.646), (0.0, 0.646)], xf(x + 0.1, 0, z + 0.1), 24, OLDBRASS)

def globe(x, z, face):
    """A terrestrial globe on a walnut floor stand, in a brass meridian."""
    cy, R = 1.0, 0.24
    for k in range(3):
        a = 2 * PI * k / 3 + face
        pts = []
        for i in range(13):
            t = i / 12
            r = 0.33 + 0.07 * math.sin(PI * t) - 0.02 * t
            pts.append((x + math.cos(a) * r, 0.02 + t * (cy - 0.035), z + math.sin(a) * r))
        put(bm_sweep(pts, rect_section(0.03, 0.036, -0.018), up=lambda p: (p[0] - x, 0.0, p[2] - z)), 'wood', None, RICH, True)
        lathe('brass', [(0.0, 0.0), (0.024, 0.0), (0.026, 0.015), (0.0, 0.024)], xf(pts[0][0], 0, pts[0][2]), 12, OLDBRASS)
        e = Vector(pts[4])
        put(bm_tube([tuple(e), (x, 0.3, z)], 0.012, 8), 'wood', None, RICH, True)
    lathe('wood', [(0.0, 0.26), (0.05, 0.27), (0.055, 0.3), (0.035, 0.34), (0.03, 0.46), (0.04, 0.52), (0.028, 0.58), (0.022, 0.7),
                   (0.03, 0.72), (0.0, 0.73)], xf(x, 0, z), 18, RICH)
    # Horizon ring with its paper band.
    put(bm_ring(0.285, 0.345, cy - 0.014, cy + 0.01, 64), 'wood', xf(x, 0, z), RICH, True)
    bm = bm_ring(0.29, 0.34, cy + 0.0101, cy + 0.0102, 64)
    cull(bm, lambda f: f.normal.y < 0.9)
    put(bm, 'plain', xf(x, 0, z), PAGE)
    # Meridian ring and globe, tilted together.
    T = xf(x, cy, z, face + 0.6) @ Matrix.Rotation(D(23.4), 4, 'Z')
    put(bm_ring(R + 0.018, R + 0.034, -0.005, 0.005, 72), 'brass', T @ Matrix.Rotation(PI / 2, 4, 'X'), BRASS, True)
    lathe('brass', [(0.0, R + 0.03), (0.01, R + 0.03), (0.008, R + 0.05), (0.0, R + 0.055)], T, 10, BRASS)
    globe_sphere(T, R)
    lathe('brass', [(0.0, -R - 0.05), (0.02, -R - 0.045), (0.018, -R - 0.03), (0.0, -R - 0.025)], T, 10, BRASS)

def globe_sphere(T, R, nu=48, nv=24):
    bm = bmesh.new()
    lay = bm.verts.layers.float_vector.new('st')
    grid = []
    for i in range(nu + 1):
        col = []
        lon = -2 * PI * i / nu
        for j in range(nv + 1):
            lat = -PI / 2 + PI * j / nv
            v = bm.verts.new(T @ Vector((math.cos(lat) * math.cos(lon) * R, math.sin(lat) * R, math.cos(lat) * math.sin(lon) * R)))
            v[lay] = Vector((i / nu, j / nv, 0))
            col.append(v)
        grid.append(col)
    for i in range(nu):
        for j in range(nv):
            q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
            if j == 0:
                q = [grid[i][j], grid[i + 1][j + 1], grid[i][j + 1]]
            elif j == nv - 1:
                q = [grid[i][j], grid[i + 1][j], grid[i][j + 1]]
            bm.faces.new(q)
    center = T @ Vector((0, 0, 0))
    orient(bm, lambda c: c - center)
    u0, v0, u1, v1 = R_GLOBE
    emit(bm, 'decal', None, WHITE, smooth=True,
         uvface=lambda f: [(SLOT * DEC['prints'] + u0 + l.vert[lay].x * (u1 - u0), v0 + l.vert[lay].y * (v1 - v0)) for l in f.loops])

def plan_chest():
    """A cartographer's plan chest in the north-west corner: six shallow drawers, rolled charts and a telescope on top."""
    x0, x1, z0, z1 = X0 + 0.05, X0 + 1.25, Z0 + 0.05, Z0 + 0.8
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    top = 0.9
    BX('wood', x1 - x0 - 0.04, 0.08, z1 - z0 - 0.04, cx, 0.04, cz, tint=mul(WHITE, 0.7), hide=(0, -1, 0))
    BX('wood', x1 - x0, top - 0.11, z1 - z0, cx, 0.08 + (top - 0.11) / 2, cz, tint=WHITE, hide=(0, 0, -1))
    BX('wood', x1 - x0 + 0.04, 0.03, z1 - z0 + 0.03, cx, top - 0.015, cz + 0.015, tint=RICH, bevel=0.01, seg=2)
    n = 6
    y = 0.1
    dh = (top - 0.03 - 0.02 - y) / n
    for k in range(n):
        cy = y + dh * (k + 0.5)
        BX('wood', x1 - x0 - 0.04, dh - 0.008, 0.012, cx, cy, z1 + 0.006, tint=RICH, bevel=0.004, hide=(0, 0, -1))
        for s in (-1, 1):
            px = cx + s * 0.34
            lathe('brass', [(0.0, 0.0), (0.014, 0.0), (0.009, 0.01), (0.013, 0.02), (0.016, 0.026), (0.012, 0.032), (0.0, 0.033)], xf(px, cy, z1 + 0.012, rx=PI / 2), 12, BRASS)
        BX('brass', 0.07, 0.035, 0.003, cx, cy, z1 + 0.0135, tint=OLDBRASS)
        BX('plain', 0.06, 0.026, 0.001, cx, cy, z1 + 0.0155, tint=PAGE)
    # On top: rolled charts, one tied, and a brass telescope.
    for k, (dz, r, L) in enumerate(((0.12, 0.035, 0.95), (0.2, 0.03, 0.85), (0.16, 0.028, 0.9))):
        yy = top + r + (0.05 if k == 2 else 0.0)
        put(bm_cyl(r, r, L, 20), 'plain', xf(cx + 0.02 * k, yy, z0 + dz + 0.1, rz=PI / 2), mul(PAPERBACK, 1 - 0.07 * k), smooth=True)
    put(bm_torus(0.036, 0.003, 20, 5), 'leather', xf(cx - 0.2, top + 0.035, z0 + 0.22, rz=PI / 2), OXBLOOD, True)
    g = xf(cx - 0.25, top + 0.03, z1 - 0.18, rz=-PI / 2, ry=0.15)
    lathe('brass', [(0.0, 0.0), (0.03, 0.0), (0.032, 0.015), (0.03, 0.025), (0.03, 0.2), (0.026, 0.21), (0.026, 0.36), (0.022, 0.37),
                    (0.022, 0.5), (0.019, 0.51), (0.0, 0.512)], g, 20, BRASS)
    put(bm_cyl(0.0315, 0.0315, 0.12, 20), 'leather', g @ Matrix.Translation((0, 0.1, 0)), DKBROWN, smooth=True)

def framed(O, U, V, w, h, rect):
    """A chart in a walnut frame with a gilt slip and a cream mat, hung on the wall plane (O centre; U right, V up)."""
    O, U, V = Vector(O), Vector(U), Vector(V)
    N = U.cross(V)
    mat_w = 0.06
    fw = 0.07
    hw, hh = w / 2 + mat_w + fw, h / 2 + mat_w + fw
    sec = [(0.0, 0.0), (0.0, 0.03), (0.012, 0.042), (0.03, 0.045), (0.05, 0.036), (0.062, 0.028), (0.07, 0.022), (0.07, 0.0)]
    put(rect_sweep(O, U, V, N, hw, hh, sec), 'wood', None, RICH)
    slip = [(fw - 0.002, 0.012), (fw - 0.002, 0.022), (fw + 0.006, 0.024), (fw + 0.014, 0.016), (fw + 0.014, 0.012)]
    put(rect_sweep(O + N * 0.0, U, V, N, hw, hh, slip), 'brass', None, GILT)
    mw, mh = w / 2 + mat_w + 0.002, h / 2 + mat_w + 0.002
    put(quad_facing([O - U * mw - V * mh + N * 0.012, O + U * mw - V * mh + N * 0.012, O + U * mw + V * mh + N * 0.012, O - U * mw + V * mh + N * 0.012], N), 'plain', None, srgb(212, 198, 168))
    sheet('prints', O - U * (w / 2) - V * (h / 2) + N * 0.0125, U, V, w, h, rect)

def sconce(O, N, U):
    """A brass wall sconce with a small fabric shade: a faint fill light."""
    O, N, U = Vector(O), Vector(N).normalized(), Vector(U).normalized()
    Rn = axis_to(N)
    lathe('brass', [(0.0, 0.0), (0.046, 0.0), (0.048, 0.005), (0.042, 0.011), (0.028, 0.017), (0.014, 0.024), (0.0, 0.026)], Matrix.Translation(O) @ Rn, 24, BRASS)
    cup = O + N * 0.17 + Vector((0, 0.08, 0))
    arm = rounded_pts([tuple(O + N * 0.02), tuple(O + N * 0.1 - Vector((0, 0.03, 0))), tuple(O + N * 0.17 - Vector((0, 0.02, 0))), tuple(cup - Vector((0, 0.012, 0)))], 0.04)
    put(bm_tube(arm, 0.007, 8), 'brass', None, BRASS, True)
    lathe('brass', [(0.0, -0.014), (0.028, -0.012), (0.034, -0.004), (0.03, 0.0), (0.016, 0.004), (0.014, 0.03), (0.0, 0.032)], Matrix.Translation(cup), 20, BRASS)
    bulb = cup + Vector((0, 0.055, 0))
    glow(bm_sphere(0.018, 12, 8), xf(bulb.x, bulb.y, bulb.z, s=(1, 1.3, 1)), BULB, 'bulb')
    y0, y1, r0, r1 = cup.y + 0.005, cup.y + 0.13, 0.085, 0.055
    glow(bm_lathe([(r0 + 0.003, y0 - 0.003), (r0, y0 + 0.004), (r1, y1 - 0.004), (r1 + 0.002, y1 + 0.002)], 28), xf(cup.x, 0, cup.z), (1, 1, 1), 'shade', shade_colour(bulb, mul(SHADE_OUT, 0.7), 0.05))
    glow(bm_lathe([(r1 - 0.003, y1 + 0.002), (r0 - 0.003, y0 - 0.003)], 28), xf(cup.x, 0, cup.z), (1, 1, 1), 'shadein', shade_colour(bulb, mul(SHADE_IN, 0.7), 0.06))
    LIGHTS.append((bulb, 22.0, (1.0, 0.68, 0.4), 0.018, 'sconce'))
    return bulb

def furniture():
    # Two club chairs facing each other across a side table on the west side, turned a little toward the room.
    club_chair(-2.62, -1.35, D(90) - D(25), CHESTNUT)
    club_chair(-2.62, 0.95, D(90) + D(25), mul(OXBLOOD, 1.15))
    side_table(-3.02, -0.2)
    captain_chair(DX + 0.05, DZ + 0.95, PI)
    globe(2.86, -0.08, 0.4)                     # under the east sconce, between the charts
    plan_chest()
    # East wall: the planisphere and the stacks profile, a sconce between them. West wall: a sconce over the table.
    wx = X1 - 0.026
    framed((wx, 1.62, -1.2), (0, 0, 1), (0, 1, 0), 0.62, 0.62, R_PLANI)
    framed((wx, 1.58, 1.05), (0, 0, 1), (0, 1, 0), 0.9, 0.45, R_PROFILE)
    SCONCES.clear()
    SCONCES.append(sconce((wx, 1.78, -0.07), (-1, 0, 0), (0, 0, 1)))
    SCONCES.append(sconce((X0 + 0.026, 1.78, -0.2), (1, 0, 0), (0, 0, -1)))

SCONCES = []

def colliders():
    # Floor (reaching into the doorway) and ceiling are mesh; everything upright is one of the game's oriented boxes
    # (physics.addOBB), which push the player only sideways. Mesh boxes would lift a player sliding along them or
    # wedged in a corner (the triangle test leans toward a face's diagonal). The elevator adds its own car and doors.
    C(0, -0.15, (Z0 - 0.3 + Z1) / 2, X1 - X0 + 0.6, 0.3, Z1 - Z0 + 0.3)
    C(0, H + 0.15, 0, X1 - X0 + 0.6, 0.3, Z1 - Z0 + 0.6)
    zc, dz = (BACK_Z + Z0 + 0.02) / 2, Z0 + 0.02 - BACK_Z                 # north wall, either side of the doorway
    OBB((X0 - 0.3 - HOLE_HW) / 2, zc, -HOLE_HW - (X0 - 0.3), dz, 0.0, 3.2)
    OBB((HOLE_HW + X1 + 0.3) / 2, zc, X1 + 0.3 - HOLE_HW, dz, 0.0, 3.2)
    OBB(0, (CAB_F + Z1 + 0.3) / 2, X1 - X0 + 0.6, Z1 + 0.3 - CAB_F, 0.0, 3.2)
    OBB(X0 - 0.13, 0, 0.34, Z1 - Z0 + 0.6, 0.0, 3.2)
    OBB(X1 + 0.13, 0, 0.34, Z1 - Z0 + 0.6, 0.0, 3.2)
    OBB(DX, DZ, DW, DD, 0.0, DH)
    OBB(DX + 0.05, (DZ + DD / 2 + DZ + 1.2) / 2, 0.56, DZ + 1.2 - (DZ + DD / 2), 0.0, 0.9)   # desk chair, closing the slot
    for (x, z, ry) in ((-2.62, -1.35, D(65)), (-2.62, 0.95, D(115))):
        OBB(x, z, 0.86, 0.88, 0.0, 1.0, ry)
    # The side table widened to the armchairs, a block behind them: no slots narrower than the player.
    OBB(-3.02, -0.2, 0.56, 1.3, 0.0, 0.7)
    OBB(X0 + 0.25, -0.2, 0.5, 3.6, 0.0, 1.0)
    OBB(2.86, -0.08, 0.72, 0.72, 0.0, 1.4)
    OBB(X0 + 0.65, Z0 + 0.43, 1.25, 0.8, 0.0, 1.0)
    for b in SCONCES:
        OBB(b.x, b.z, 0.36, 0.36, 1.45, 2.15)

_obb = {'n': 0}

def OBB(cx, cz, w, d, y0, y1, ry=0.0):
    """A collision box the game adds as physics.addOBB (floor-relative heights)."""
    empty('OBB_%d' % _obb['n'], (cx, 0.0, cz), hx=w / 2, hz=d / 2, y0=y0, y1=y1, ry=ry)
    _obb['n'] += 1

def build_meta():
    empty('STATION', (EL_X, 0, PLATE_Z), rotY=0.0, callPos=[CALL[0], CALL[1], Z0 - PLATE_Z + 0.02])
    empty('LAMP', tuple(LIGHTS[0][0]))
    empty('SOUND', (0.0, 1.4, 0.3))
    empty('META', (0, 0, 0), bounds=[X0, -0.2, BACK_Z - 0.05, X1, H + 0.2, Z1], lamp=list(LAMP_RGB))

def add_lights():
    sc = _scene()
    for i, (p, power, col, rad, name) in enumerate(LIGHTS):
        ld = bpy.data.lights.new('DB_light_%d' % i, 'POINT')
        ld.energy = power
        ld.shadow_soft_size = rad
        ld.color = col
        ob = bpy.data.objects.new('LIGHT_%s_%d' % (name, i), ld)
        ob.location = g2b(p)
        ob['noexport'] = 1
        sc.collection.objects.link(ob)

def build_all():
    t0 = time.time()
    LIGHTS.clear()
    _obb['n'] = 0
    floor_and_rug()
    walls()
    elevator_surround()
    ceiling()
    bookcase()
    desk()
    furniture()
    colliders()
    build_meta()
    stats = realize()
    add_lights()
    show_scene()
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in _scene().objects if ob.type == 'MESH' and not ob.name.startswith('COLLIDER'))
    return {'materials': stats, 'colliders': len(COLS), 'lights': len(LIGHTS), 'tris': tris, 'seconds': round(time.time() - t0, 1)}

# ============================================================================ textures
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

def _noise4(nt, vec, w, scale, detail=6.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '4D'}, Vector=vec, W=w, Scale=scale,
                Detail=detail, Roughness=rough, Distortion=distort).outputs['Fac']

def _noise3(nt, vec, scale, detail=4.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '3D'}, Vector=vec, Scale=scale,
                Detail=detail, Roughness=rough, Distortion=distort).outputs['Fac']

def _mapr(nt, v, a, b, lo=0.0, hi=1.0):
    return node(nt, 'ShaderNodeMapRange', props={'clamp': True}, Value=v, **{'From Min': a, 'From Max': b, 'To Min': lo, 'To Max': hi}).outputs[0]

def _stretch(nt, vec, w, ku, kv):
    v = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=vec, i1=(ku, ku, kv)).outputs[0]
    return v, math_node(nt, 'MULTIPLY', w, kv)

def _scale(nt, col, k):
    return node(nt, 'ShaderNodeVectorMath', props={'operation': 'SCALE'}, i0=col, Scale=k).outputs[0]

def make_walnut(nt, vec, w):
    # Walnut: long wavy grain lines, darker streaks, soft figure and fine pores; the grain runs along u.
    gv, gw = _stretch(nt, vec, w, 0.1, 1.0)
    base = _noise4(nt, gv, gw, 2.2, 3.0, 0.5, 0.3)
    lines = math_node(nt, 'SINE', math_node(nt, 'MULTIPLY', base, 70.0))
    lines = _mapr(nt, lines, 0.55, 1.0)
    fv, fw = _stretch(nt, vec, w, 0.25, 1.0)
    figure = _noise4(nt, fv, fw, 1.6, 4.0, 0.6)
    streak = _mapr(nt, _noise4(nt, gv, gw, 5.0, 4.0, 0.6), 0.45, 0.72)
    pv, pw = _stretch(nt, vec, w, 0.06, 1.0)
    pores = _mapr(nt, _noise4(nt, pv, pw, 60.0, 2.0, 0.5), 0.55, 0.75)
    col = _ramp(nt, figure, [(0.25, (0.066, 0.033, 0.017)), (0.5, (0.13, 0.068, 0.035)), (0.75, (0.2, 0.112, 0.06))])
    col = _mix(nt, math_node(nt, 'MULTIPLY', lines, 0.45), col, (0.035, 0.018, 0.01))
    col = _mix(nt, math_node(nt, 'MULTIPLY', streak, 0.35), col, (0.04, 0.02, 0.012))
    return _mix(nt, math_node(nt, 'MULTIPLY', pores, 0.25), col, (0.03, 0.016, 0.009))

def make_leather(nt, vec, w):
    # Near-neutral grain (the vertex colour carries the hue): pebbling, creases and a soft mottle.
    peb = node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '4D', 'feature': 'F1'}, Vector=vec, W=w, Scale=34.0).outputs['Distance']
    crease = node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '4D', 'feature': 'DISTANCE_TO_EDGE'}, Vector=vec, W=w, Scale=9.0).outputs['Distance']
    mott = _noise4(nt, vec, w, 2.5, 5.0, 0.6)
    k = math_node(nt, 'ADD', 0.72, math_node(nt, 'MULTIPLY', _mapr(nt, peb, 0.05, 0.5), 0.14))
    k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'ADD', 0.8, math_node(nt, 'MULTIPLY', _mapr(nt, crease, 0.0, 0.05), 0.2)))
    k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'ADD', 0.86, math_node(nt, 'MULTIPLY', mott, 0.28)))
    return node(nt, 'ShaderNodeCombineColor', Red=math_node(nt, 'MULTIPLY', k, 1.02), Green=k, Blue=math_node(nt, 'MULTIPLY', k, 0.96)).outputs[0]

def srgb_enc(a):
    import numpy as np
    a = np.clip(a, 0, None)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)

def save_rgba(path, rgba):
    """Write an HxWx4 array (row 0 at the bottom, colour already encoded) to a PNG with alpha."""
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

# ---------------------------------------------------------------- flat painting (Cycles, orthographic, emission only)
class Sketch:
    """Vector art on a W x H canvas (metres of the real object), meshes coloured per vertex. Higher z draws on top."""

    def __init__(self, W, H, seed=0):
        self.W, self.H = W, H
        self.v, self.f, self.c = [], [], []
        self.rs = random.Random(seed)

    def poly(self, pts, col, z=0.0):
        a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
        if a < 0:
            pts = list(reversed(pts))
        b = len(self.v)
        self.v.extend((p[0], p[1], z) for p in pts)
        self.c.extend([col] * len(pts))
        self.f.append(list(range(b, b + len(pts))))

    def stroke(self, pts, w, col, z=0.001, closed=False):
        P = [Vector((p[0], p[1])) for p in pts]
        if closed:
            P.append(P[0].copy())
        n = len(P)
        if n < 2:
            return
        wf = w if callable(w) else (lambda t, w=w: w)
        L = [0.0]
        for i in range(1, n):
            L.append(L[-1] + (P[i] - P[i - 1]).length)
        tot = max(L[-1], 1e-9)
        b = len(self.v)
        for i in range(n):
            if closed and i in (0, n - 1):
                d = P[1] - P[-2]
            else:
                d = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
            if d.length < 1e-12:
                d = Vector((1, 0))
            d.normalize()
            nrm = Vector((-d.y, d.x)) * (wf(L[i] / tot) / 2)
            l, r = P[i] + nrm, P[i] - nrm
            self.v += [(l.x, l.y, z), (r.x, r.y, z)]
            self.c += [col, col]
        for i in range(n - 1):
            self.f.append([b + 2 * i, b + 2 * i + 1, b + 2 * i + 3, b + 2 * i + 2])

    def line(self, a, b, w, col, z=0.001):
        self.stroke([a, b], w, col, z)

    def circle(self, cx, cy, r, w, col, z=0.001, n=None):
        n = n or max(24, int(r * 1500))
        self.stroke([(cx + math.cos(2 * PI * k / n) * r, cy + math.sin(2 * PI * k / n) * r) for k in range(n)], w, col, z, closed=True)

    def disc(self, cx, cy, r, col, z=0.001, n=None):
        n = n or max(10, int(r * 1500))
        self.poly([(cx + math.cos(2 * PI * k / n) * r, cy + math.sin(2 * PI * k / n) * r) for k in range(n)], col, z)

    def rect(self, x0, y0, x1, y1, w, col, z=0.001):
        for (a, b) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            d = Vector(b) - Vector(a)
            e = d.normalized() * (w / 2)
            self.line(tuple(Vector(a) - e), tuple(Vector(b) + e), w, col, z)

    def dashed(self, pts, w, col, dash, gap, z=0.001, closed=False):
        P = [Vector(p) for p in pts] + ([Vector(pts[0])] if closed else [])
        seg, on, left = [P[0]], True, dash
        for i in range(1, len(P)):
            a, b = P[i - 1], P[i]
            L = (b - a).length
            t = 0.0
            while L - t > left:
                t += left
                q = a + (b - a) * (t / L)
                seg.append(q)
                if on:
                    self.stroke([tuple(s) for s in seg], w, col, z)
                on = not on
                seg = [q]
                left = gap if not on else dash
            left -= L - t
            seg.append(b)
        if on and len(seg) > 1:
            self.stroke([tuple(s) for s in seg], w, col, z)

def wobble(pts, amp, freq, seed=0.0):
    out = []
    for (x, y) in pts:
        n1 = mnoise.noise(Vector((x * freq, y * freq, seed)))
        n2 = mnoise.noise(Vector((x * freq + 17.3, y * freq - 4.1, seed)))
        out.append((x + n1 * amp, y + n2 * amp))
    return out

def _paint_scene(samples=16):
    sc = bpy.data.scenes.get('DB_paint') or bpy.data.scenes.new('DB_paint')
    for ob in list(sc.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    _cycles(sc, samples)
    sc.cycles.max_bounces = 0
    sc.cycles.use_denoising = False
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.resolution_percentage = 100
    w = bpy.data.worlds.get('DB_paint_world') or bpy.data.worlds.new('DB_paint_world')
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (1, 1, 1, 1)
    bg.inputs['Strength'].default_value = 1.0
    sc.world = w
    return sc

def _paint_render(sc, W, H, pw, ph):
    import numpy as np
    cd = bpy.data.cameras.get('DB_paint_cam') or bpy.data.cameras.new('DB_paint_cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = max(W, H)
    cd.clip_start, cd.clip_end = 0.1, 100
    cam = bpy.data.objects.new('DB_paint_cam', cd)
    cam.location = (W / 2, H / 2, 10)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = pw, ph
    bpy.ops.render.render(scene=sc.name)
    path = os.path.join(bpy.app.tempdir, 'db_paint.exr')
    bpy.data.images['Render Result'].save_render(path, scene=sc)
    im = bpy.data.images.load(path)
    a = _np_image(im)[:, :, :3].copy()
    bpy.data.images.remove(im)
    try:
        os.remove(path)
    except OSError:
        pass
    return a

def render_sketch(sk, pw, ph, samples=16):
    """Render the sketch over white; returns HxWx3 linear (row 0 at the bottom)."""
    sc = _paint_scene(samples)
    me = bpy.data.meshes.new('DB_sketch')
    me.from_pydata(sk.v, [], sk.f)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', [x for c in sk.c for x in (c[0], c[1], c[2], 1.0)])
    mat = bpy.data.materials.get('DB_ink') or bpy.data.materials.new('DB_ink')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    at = node(nt, 'ShaderNodeAttribute', props={'attribute_name': 'Col'})
    em = node(nt, 'ShaderNodeEmission', Color=at.outputs['Color'], Strength=1.0)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    me.materials.append(mat)
    ob = bpy.data.objects.new('DB_sketch', me)
    sc.collection.objects.link(ob)
    a = _paint_render(sc, sk.W, sk.H, pw, ph)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    return a

def render_shader(W, H, pw, ph, make, samples=16):
    """Render a procedural emission shader across a W x H plane; make(nt, pos, uv) -> colour socket, pos in metres."""
    sc = _paint_scene(samples)
    me = bpy.data.meshes.new('DB_shader_plane')
    me.from_pydata([(0, 0, 0), (W, 0, 0), (W, H, 0), (0, H, 0)], [], [(0, 1, 2, 3)])
    uvl = me.uv_layers.new(name='UVMap')
    uvl.data.foreach_set('uv', [0, 0, 1, 0, 1, 1, 0, 1])
    mat = bpy.data.materials.get('DB_paintshader') or bpy.data.materials.new('DB_paintshader')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    pos = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=tc.outputs['UV'], i1=(W, H, 1.0)).outputs[0]
    col = make(nt, pos, tc.outputs['UV'])
    em = node(nt, 'ShaderNodeEmission', Color=col, Strength=1.0)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    me.materials.append(mat)
    ob = bpy.data.objects.new('DB_shader_plane', me)
    sc.collection.objects.link(ob)
    a = _paint_render(sc, W, H, pw, ph)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    return a

def paper(base=(0.6, 0.47, 0.3), seed=0.0, W=1.0, H=1.0, crease=(), stain=1.0, edge=0.03):
    """Aged paper: mottling, fibres, tide-mark stains, foxing, darkened edges and fold creases."""
    def make(nt, pos, uv):
        p = node(nt, 'ShaderNodeVectorMath', props={'operation': 'ADD'}, i0=pos, i1=(seed, seed * 0.7, seed * 1.3)).outputs[0]
        big = _noise3(nt, p, 3.0, 4.0, 0.55)
        fib = _noise3(nt, node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=p, i1=(1.0, 4.0, 1.0)).outputs[0], 90.0, 2.0, 0.5)
        st = _mapr(nt, _noise3(nt, p, 1.4, 3.0, 0.5, 0.4), 0.56, 0.72)
        tide = _mapr(nt, math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', _noise3(nt, p, 1.4, 3.0, 0.5, 0.4), 0.56)), 0.0, 0.012, 1.0, 0.0)
        fox_d = node(nt, 'ShaderNodeTexVoronoi', props={'feature': 'F1'}, Vector=p, Scale=45.0).outputs['Distance']
        fox = math_node(nt, 'MULTIPLY', _mapr(nt, fox_d, 0.06, 0.02), _mapr(nt, _noise3(nt, p, 5.0, 2.0), 0.58, 0.66))
        sep = node(nt, 'ShaderNodeSeparateXYZ', Vector=uv)
        ex = math_node(nt, 'MINIMUM', math_node(nt, 'MULTIPLY', sep.outputs['X'], W), math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', 1.0, sep.outputs['X']), W))
        ey = math_node(nt, 'MINIMUM', math_node(nt, 'MULTIPLY', sep.outputs['Y'], H), math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', 1.0, sep.outputs['Y']), H))
        ed = _mapr(nt, math_node(nt, 'MINIMUM', ex, ey), 0.0, edge, 0.62, 1.0)
        k = math_node(nt, 'ADD', 0.9, math_node(nt, 'MULTIPLY', big, 0.16))
        k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'ADD', 0.95, math_node(nt, 'MULTIPLY', fib, 0.08)))
        k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', st, 0.16 * stain)))
        k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', tide, 0.12 * stain)))
        k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', fox, 0.35 * stain)))
        k = math_node(nt, 'MULTIPLY', k, ed)
        for (axis, at) in crease:
            c = sep.outputs['X'] if axis == 'x' else sep.outputs['Y']
            L = W if axis == 'x' else H
            d = math_node(nt, 'ABSOLUTE', math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', c, at), L))
            k = math_node(nt, 'MULTIPLY', k, _mapr(nt, d, 0.0, 0.004, 0.8, 1.0))
        col = node(nt, 'ShaderNodeCombineColor', Red=base[0], Green=base[1], Blue=base[2]).outputs[0]
        # Stains lean brown, not grey.
        col = _mix(nt, math_node(nt, 'MULTIPLY', st, 0.4 * stain), col, (base[0] * 0.85, base[1] * 0.7, base[2] * 0.5))
        return _scale(nt, col, k)
    return make

def save_srgb(path, lin):
    save_png(path, srgb_enc(lin))

# ---------------------------------------------------------------- the map of the five stacks
STACKS = {    # src/config.js (End sits beyond Rocks along its bridge heading)
    'dome': (0.0, 0.0, 58.0), 'rocks': (-300.0, 175.0, 50.0), 'mountain': (285.0, 245.0, 72.0), 'tower': (95.0, -335.0, 48.0),
}
def _end():
    dx, dz = -0.34, 0.94
    L = math.hypot(dx, dz)
    dx, dz = dx / L, dz / L
    d = 50.0 + 58.0 + 18.0
    return (-300.0 + dx * d, 175.0 + dz * d, 18.0)
STACKS['end'] = _end()

INK = (0.07, 0.045, 0.028)
SEPIA = (0.3, 0.2, 0.12)
FADED = (0.46, 0.35, 0.24)
WASH = (0.9, 0.78, 0.6)
REDINK = (0.45, 0.1, 0.05)

def coast(rs, cx, cy, R, n=160, rough=0.08, seed=0.0):
    ph = [rs.uniform(0, 6.28) for _ in range(4)]
    pts = []
    for k in range(n):
        a = 2 * PI * k / n
        f = 1 + rough * (0.5 * math.sin(3 * a + ph[0]) + 0.3 * math.sin(5 * a + ph[1]) + 0.2 * math.sin(9 * a + ph[2]))
        f += rough * 0.6 * mnoise.noise(Vector((math.cos(a) * 3 + seed, math.sin(a) * 3, seed)))
        pts.append((cx + math.cos(a) * R * f, cy + math.sin(a) * R * f))
    return pts

def paint_map(path):
    W, H = MAP_W, MAP_H
    sk = Sketch(W, H, 11)
    rs = sk.rs
    m, m2 = 0.02, 0.028
    # Border: a heavy outer rule, a hairline inside, and a degree band of alternating blocks between them.
    sk.rect(m, m, W - m, H - m, 0.0014, INK, 0.003)
    sk.rect(m2, m2, W - m2, H - m2, 0.0006, INK, 0.003)
    for (a, b, horiz) in (((m, m), (W - m, m), True), ((m, H - m2), (W - m, H - m2), True), ((m, m), (m, H - m), False), ((W - m2, m), (W - m2, H - m), False)):
        L = (b[0] - a[0]) if horiz else (b[1] - a[1])
        n = int(L / 0.02)
        for k in range(1, n - 1, 2):
            if horiz:
                sk.poly([(a[0] + k * 0.02, a[1]), (a[0] + (k + 1) * 0.02, a[1]), (a[0] + (k + 1) * 0.02, a[1] + 0.008), (a[0] + k * 0.02, a[1] + 0.008)], SEPIA, 0.002)
            else:
                sk.poly([(a[0], a[1] + k * 0.02), (a[0] + 0.008, a[1] + k * 0.02), (a[0] + 0.008, a[1] + (k + 1) * 0.02), (a[0], a[1] + (k + 1) * 0.02)], SEPIA, 0.002)
    for (cx, cy) in ((m, m), (W - m2, m), (m, H - m2), (W - m2, H - m2)):
        sk.poly([(cx, cy), (cx + 0.008, cy), (cx + 0.008, cy + 0.008), (cx, cy + 0.008)], INK, 0.0025)
    ix0, iy0, ix1, iy1 = m2 + 0.002, m2 + 0.002, W - m2 - 0.002, H - m2 - 0.002
    # Where things go: the stacks on the left two thirds, true to their positions and sizes.
    s = 0.00064
    xs = [v[0] for v in STACKS.values()]
    zs = [v[1] for v in STACKS.values()]
    wx0, wx1 = min(x - STACKS[k][2] for k, x in zip(STACKS, xs)), max(x + STACKS[k][2] for k, x in zip(STACKS, xs))
    wz0, wz1 = min(z - STACKS[k][2] for k, z in zip(STACKS, zs)), max(z + STACKS[k][2] for k, z in zip(STACKS, zs))
    cxw, czw = (wx0 + wx1) / 2, (wz0 + wz1) / 2
    ox, oy = 0.335, 0.335
    P = lambda x, z: (ox + (x - cxw) * s, oy - (z - czw) * s)       # north (-z) up
    rose = (0.775, 0.415)
    cart = (0.775, 0.155, 0.1, 0.06)
    # Rhumb lines from the rose, faint, under everything.
    for k in range(32):
        a = 2 * PI * k / 32
        d = Vector((math.cos(a), math.sin(a)))
        ts = []
        for (lim, comp, sgn) in ((ix1, 0, 1), (ix0, 0, -1), (iy1, 1, 1), (iy0, 1, -1)):
            if d[comp] * sgn > 1e-6:
                ts.append((lim - rose[comp]) / d[comp])
        t = min(ts)
        sk.line((rose[0] + d.x * 0.09, rose[1] + d.y * 0.09), (rose[0] + d.x * t, rose[1] + d.y * t), 0.00028 if k % 2 else 0.0004, FADED if k % 4 else SEPIA, 0.0004)
    def in_land(x, y, pad=1.25):
        for (sx, sz, r) in STACKS.values():
            px, py = P(sx, sz)
            if math.hypot(x - px, y - py) < r * s * pad:
                return True
        return False
    def free(x, y):
        return (ix0 + 0.02 < x < ix1 - 0.02 and iy0 + 0.02 < y < iy1 - 0.02 and not in_land(x, y, 1.45)
                and math.hypot(x - rose[0], y - rose[1]) > 0.105 and not (abs(x - cart[0]) < cart[2] + 0.02 and abs(y - cart[1]) < cart[3] + 0.02)
                and not (x < 0.2 and y < 0.085))
    # The cloud sea: scalloped cloud banks and wave strokes.
    placed = 0
    tries = 0
    while placed < 16 and tries < 600:
        tries += 1
        x, y = rs.uniform(ix0, ix1), rs.uniform(iy0, iy1)
        L = rs.uniform(0.035, 0.07)
        if not all(free(x + dx, y + dy) for dx in (-L / 2, 0, L / 2) for dy in (0, 0.012)):
            continue
        placed += 1
        n = max(3, int(L / 0.012))
        base = []
        for k in range(n):
            r = L / n / 2 * rs.uniform(0.9, 1.25)
            c = (x - L / 2 + (k + 0.5) * L / n, y + r * 0.2)
            arc = [(c[0] + math.cos(PI - PI * t / 10) * r, c[1] + math.sin(PI - PI * t / 10) * r * 1.1) for t in range(11)]
            sk.stroke(arc, 0.0005, SEPIA, 0.001)
        sk.stroke(wobble([(x - L / 2 - 0.004, y), (x, y - 0.0015), (x + L / 2 + 0.004, y)], 0.0008, 60), 0.0004, FADED, 0.001)
        sk.poly([(x - L / 2, y), (x + L / 2, y), (x + L / 2, y + 0.007), (x - L / 2, y + 0.007)], (0.97, 0.94, 0.9), 0.0006)
    for _ in range(600):
        x, y = rs.uniform(ix0, ix1), rs.uniform(iy0, iy1)
        if not free(x, y):
            continue
        L = rs.uniform(0.012, 0.028)
        pts = [(x + t * L, y + 0.0012 * math.sin(t * 2 * PI * 1.5)) for t in [i / 10 for i in range(11)]]
        if free(x + L, y):
            sk.stroke(pts, 0.00028, FADED, 0.0008)
    # The stacks: a wash, the coastline, hachured cliffs, the rim, and a glyph for what stands on each.
    for name, (sx, sz, r) in STACKS.items():
        cx, cy = P(sx, sz)
        R = r * s
        pts = coast(rs, cx, cy, R, 180, 0.07, seed=len(name))
        sk.poly(pts, WASH, 0.0002)
        sk.stroke(wobble(pts, 0.0003, 90, len(name)), 0.0008, INK, 0.0015, closed=True)
        for k in range(int(R * 5200)):
            a = 2 * PI * (k + rs.uniform(-0.3, 0.3)) / int(R * 5200)
            i = int(a / (2 * PI) * len(pts)) % len(pts)
            e = Vector(pts[i])
            d = (e - Vector((cx, cy))).normalized()
            shade = 0.5 + 0.5 * math.cos(a - D(-45))                 # heavier on the south-east
            L = R * (0.1 + 0.12 * shade) * rs.uniform(0.7, 1.1)
            sk.line(tuple(e - d * 0.0008), tuple(e - d * (0.0008 + L)), 0.00024 + 0.0002 * shade, SEPIA, 0.0012)
        sk.dashed([(cx + math.cos(2 * PI * k / 90) * R * 0.74, cy + math.sin(2 * PI * k / 90) * R * 0.74) for k in range(90)], 0.0003, SEPIA, 0.002, 0.0015, 0.0012, closed=True)
        # Stipple in the clouds just off the cliffs.
        for _ in range(int(R * 9000)):
            a = rs.uniform(0, 2 * PI)
            rr = R * (1.08 + rs.random() ** 2 * 0.35)
            px, py = cx + math.cos(a) * rr, cy + math.sin(a) * rr
            if not in_land(px, py, 1.06):
                sk.disc(px, py, rs.uniform(0.00022, 0.0004), SEPIA, 0.0009, 6)
        glyph(sk, name, cx, cy, R)
    # The bridge from Rocks out to End.
    (rx, rz, rr), (ex, ez, er) = STACKS['rocks'], STACKS['end']
    a, b = Vector(P(rx, rz)), Vector(P(ex, ez))
    d = (b - a).normalized()
    nn = Vector((-d.y, d.x)) * 0.0016
    a1, b1 = a + d * (rr * s * 0.92), b - d * (er * s * 0.9)
    sk.line(tuple(a1 + nn), tuple(b1 + nn), 0.0004, INK, 0.0016)
    sk.line(tuple(a1 - nn), tuple(b1 - nn), 0.0004, INK, 0.0016)
    L = (b1 - a1).length
    for k in range(int(L / 0.0025)):
        q = a1 + d * (k * 0.0025 + 0.001)
        sk.line(tuple(q + nn), tuple(q - nn), 0.00025, INK, 0.0016)
    compass_rose(sk, rose[0], rose[1], 0.075)
    cartouche(sk, *cart)
    # Scale bar: five blocks of 20 m.
    bx, by = 0.055, 0.052
    seg = 20.0 * s
    for k in range(5):
        sk.poly([(bx + k * seg, by), (bx + (k + 1) * seg, by), (bx + (k + 1) * seg, by + 0.004), (bx + k * seg, by + 0.004)], INK if k % 2 == 0 else (1, 1, 1), 0.002)
    sk.rect(bx, by, bx + 5 * seg, by + 0.004, 0.0004, INK, 0.0022)
    for k in range(6):
        sk.line((bx + k * seg, by + 0.004), (bx + k * seg, by + 0.007), 0.0003, INK, 0.0022)
    paper_a = render_shader(W, H, 2048, 1424, paper((0.6, 0.46, 0.28), 3.7, W, H, crease=(('x', 0.5), ('y', 0.5)), stain=1.5, edge=0.045))
    ink = render_sketch(sk, 2048, 1424)
    save_srgb(path, paper_a * ink)

def glyph(sk, name, cx, cy, R):
    w = 0.0005
    if name == 'dome':
        # The cabin's geodesic dome and the garden.
        r = 0.006
        pts = [(cx + math.cos(PI * k / 12) * r, cy + math.sin(PI * k / 12) * r) for k in range(13)]
        sk.stroke(pts, w, INK, 0.002)
        sk.line((cx - r * 1.3, cy), (cx + r * 1.3, cy), w, INK, 0.002)
        for k in range(1, 3):
            sk.stroke([(cx + math.cos(PI * t / 8) * r, cy + math.sin(PI * t / 8) * r * k / 3) for t in range(9)], 0.0003, INK, 0.002)
        sk.line((cx, cy), (cx, cy + r), 0.0003, INK, 0.002)
    elif name == 'tower':
        # The pylon: tapering legs, a cross-arm, a lamp on top.
        h, bw = 0.02, 0.006
        sk.line((cx - bw, cy - h * 0.45), (cx - 0.0012, cy + h * 0.55), w, INK, 0.002)
        sk.line((cx + bw, cy - h * 0.45), (cx + 0.0012, cy + h * 0.55), w, INK, 0.002)
        sk.line((cx - 0.011, cy + h * 0.3), (cx + 0.011, cy + h * 0.3), w, INK, 0.002)
        for k in range(4):
            y0 = cy - h * 0.45 + k * h * 0.2
            t0, t1 = k * 0.2, (k + 1) * 0.2
            xa, xb = cx - bw + (bw - 0.0012) * t0, cx + bw - (bw - 0.0012) * t1
            sk.line((xa, y0), (xb, y0 + h * 0.2), 0.00025, INK, 0.002)
        sk.disc(cx, cy + h * 0.58, 0.0012, REDINK, 0.0021)
    elif name == 'mountain':
        for (dx, dy, k) in ((-0.012, -0.004, 1.0), (0.004, 0.004, 1.3), (0.016, -0.008, 0.8), (-0.004, -0.014, 0.7)):
            hh = 0.009 * k
            pts = [(cx + dx - hh, cy + dy), (cx + dx, cy + dy + hh), (cx + dx + hh, cy + dy)]
            sk.stroke(pts, w, INK, 0.002)
            for t in range(4):
                q = (cx + dx + hh * (0.2 + 0.18 * t), cy + dy + hh * (0.8 - 0.18 * t))
                sk.line(q, (q[0] - 0.0012, q[1] - hh * 0.25), 0.00025, INK, 0.002)
        ox, oy = cx + 0.006, cy + 0.017
        sk.rect(ox - 0.004, oy - 0.003, ox + 0.004, oy + 0.001, 0.0004, INK, 0.002)
        sk.stroke([(ox + math.cos(PI * t / 10) * 0.004, oy + 0.001 + math.sin(PI * t / 10) * 0.004) for t in range(11)], 0.0004, INK, 0.002)
    elif name == 'rocks':
        # The sequoia, the tor and the creek running to the eastern lip.
        tx, ty = cx - 0.008, cy + 0.004
        sk.line((tx, ty - 0.008), (tx, ty + 0.014), 0.0006, INK, 0.002)
        for k in range(5):
            yy = ty + 0.012 - k * 0.004
            ww = 0.002 + k * 0.0012
            sk.stroke([(tx - ww, yy - 0.003), (tx, yy), (tx + ww, yy - 0.003)], 0.0004, INK, 0.002)
        for (dx, dy, r) in ((0.012, -0.004, 0.0028), (0.016, -0.002, 0.002), (0.014, -0.008, 0.0022)):
            sk.circle(cx + dx, cy + dy, r, 0.0004, INK, 0.002, 16)
        pts = [(cx + 0.014 + t * R * 0.95, cy - 0.006 + 0.002 * math.sin(t * 14)) for t in [i / 30 for i in range(31)]]
        sk.stroke(pts, 0.0005, SEPIA, 0.002)
    elif name == 'end':
        sk.circle(cx, cy, 0.0035, 0.0005, INK, 0.002, 24)
        sk.disc(cx, cy, 0.0011, INK, 0.002, 10)

def compass_rose(sk, cx, cy, R):
    sk.circle(cx, cy, R * 1.09, 0.0007, INK, 0.003)
    sk.circle(cx, cy, R * 1.15, 0.0004, INK, 0.003)
    for k in range(72):
        a = 2 * PI * k / 72
        r0, r1 = R * 1.09, R * (1.15 if k % 2 == 0 else 1.12)
        sk.line((cx + math.cos(a) * r0, cy + math.sin(a) * r0), (cx + math.cos(a) * r1, cy + math.sin(a) * r1), 0.0003, INK, 0.003)
    sk.disc(cx, cy, R * 1.09, (1, 1, 1), 0.0025)
    sk.circle(cx, cy, R * 0.42, 0.0005, SEPIA, 0.0032)
    order = sorted(range(16), key=lambda k: 0 if k % 4 == 0 else 1 if k % 2 == 0 else 2, reverse=True)
    for rank, k in enumerate(order):
        a = PI / 2 - 2 * PI * k / 16
        L = R if k % 4 == 0 else R * 0.68 if k % 2 == 0 else R * 0.46
        hw = 0.011 if k % 4 == 0 else 0.0075 if k % 2 == 0 else 0.0055
        d = Vector((math.cos(a), math.sin(a)))
        nrm = Vector((-d.y, d.x))
        c = Vector((cx, cy))
        tip = c + d * L
        base_l, base_r = c + nrm * hw + d * hw * 0.2, c - nrm * hw + d * hw * 0.2
        z = 0.0034 + rank * 0.00005
        dark = REDINK if (k % 4 == 0 and k in (0, 8)) else INK
        sk.poly([tuple(c), tuple(tip), tuple(base_l)], dark, z)
        sk.poly([tuple(c), tuple(base_r), tuple(tip)], (1, 1, 1), z)
        sk.stroke([tuple(c), tuple(base_r), tuple(tip), tuple(base_l), tuple(c)], 0.00045, INK, z + 0.00002)
    sk.disc(cx, cy, 0.0028, (1, 1, 1), 0.0045)
    sk.circle(cx, cy, 0.0028, 0.0005, INK, 0.0046, 20)
    sk.disc(cx, cy, 0.001, INK, 0.0047, 8)
    # A fleur-de-lis on north.
    ny = cy + R * 1.2
    for (dx, rot) in ((0.0, 0.0), (-0.004, 0.6), (0.004, -0.6)):
        pts = []
        for t in range(13):
            u = t / 12
            wdt = 0.0022 * math.sin(PI * u) * (1.0 if dx == 0 else 0.8)
            ln = 0.012 if dx == 0 else 0.008
            pts.append((u * ln, wdt))
        pts += [(u * (0.012 if dx == 0 else 0.008), -0.0022 * math.sin(PI * u) * (1.0 if dx == 0 else 0.8)) for u in [t / 12 for t in range(12, -1, -1)]]
        ca, sa = math.cos(PI / 2 + rot), math.sin(PI / 2 + rot)
        sk.poly([(cx + dx + x * ca - y * sa, ny + x * sa + y * ca) for (x, y) in pts], REDINK, 0.005)
    sk.line((cx - 0.006, ny + 0.002), (cx + 0.006, ny + 0.002), 0.0012, REDINK, 0.0051)

def cartouche(sk, cx, cy, hw, hh):
    """An empty cartouche: a double-ruled plaque with scrolled ends (room for a legend, later)."""
    sk.poly([(cx - hw, cy - hh), (cx + hw, cy - hh), (cx + hw, cy + hh), (cx - hw, cy + hh)], (0.97, 0.93, 0.86), 0.002)
    sk.rect(cx - hw, cy - hh, cx + hw, cy + hh, 0.0009, INK, 0.0025)
    sk.rect(cx - hw + 0.004, cy - hh + 0.004, cx + hw - 0.004, cy + hh - 0.004, 0.0004, INK, 0.0025)
    for s in (-1, 1):
        pts = []
        for k in range(60):
            t = k / 59
            a = t * 3.2 * PI
            r = 0.014 * (1 - t * 0.85)
            pts.append((cx + s * (hw + 0.004 + r * math.cos(a) * 0.9), cy + r * math.sin(a) * s))
        sk.stroke(pts, lambda t: 0.0011 * (1 - t) + 0.0003, INK, 0.0026)
    top = [(cx + t * hw * 0.9, cy + hh + 0.004 + 0.004 * math.sin(PI * (t + 1) / 2) ** 2) for t in [i / 20 - 1 for i in range(41)]]
    sk.stroke(top, 0.0006, INK, 0.0026)
    sk.disc(cx, cy + hh + 0.009, 0.0016, REDINK, 0.0027)

# ---------------------------------------------------------------- the rug
def paint_rug(path):
    W, H = RUG_W, RUG_H
    sk = Sketch(W, H, 21)
    FIELD, DK, CR, RU, OC, CH = srgb(128, 30, 28), srgb(56, 28, 22), srgb(214, 194, 156), srgb(170, 76, 40), srgb(186, 138, 62), srgb(42, 30, 26)
    sk.poly([(0, 0), (W, 0), (W, H), (0, H)], FIELD, 0.0)
    sk.poly([(0, 0), (W, 0), (W, H), (0, H)], DK, 0.001)
    sk.poly([(0.035, 0.035), (W - 0.035, 0.035), (W - 0.035, H - 0.035), (0.035, H - 0.035)], CR, 0.002)
    sk.poly([(0.05, 0.05), (W - 0.05, 0.05), (W - 0.05, H - 0.05), (0.05, H - 0.05)], DK, 0.003)
    sk.poly([(0.27, 0.27), (W - 0.27, 0.27), (W - 0.27, H - 0.27), (0.27, H - 0.27)], CR, 0.004)
    sk.poly([(0.285, 0.285), (W - 0.285, 0.285), (W - 0.285, H - 0.285), (0.285, H - 0.285)], RU, 0.005)
    sk.poly([(0.31, 0.31), (W - 0.31, 0.31), (W - 0.31, H - 0.31), (0.31, H - 0.31)], FIELD, 0.006)
    # Main border: a meandering vine with rosettes.
    def border_path(inset):
        return [(inset, inset), (W - inset, inset), (W - inset, H - inset), (inset, H - inset)]
    mid = 0.16
    per = 2 * (W - 2 * mid) + 2 * (H - 2 * mid)
    n = int(per / 0.19)
    corners = border_path(mid)
    def at(t):
        t %= per
        for i in range(4):
            a, b = Vector(corners[i]), Vector(corners[(i + 1) % 4])
            L = (b - a).length
            if t <= L:
                return a + (b - a) * (t / L), (b - a).normalized()
            t -= L
        return Vector(corners[0]), Vector((1, 0))
    vine = []
    for k in range(int(per / 0.01)):
        t = k * 0.01
        p, d = at(t)
        nn = Vector((-d.y, d.x))
        vine.append(tuple(p + nn * 0.045 * math.sin(2 * PI * t / 0.19)))
    sk.stroke(vine, 0.016, OC, 0.0035, closed=True)
    for k in range(n):
        p, d = at(k * per / n)
        rosette(sk, p.x, p.y, 0.055, CR, RU, DK, 0.0036)
        for s in (-1, 1):
            q = p + Vector((-d.y, d.x)) * s * 0.07 + d * 0.095
            sk.poly([(q.x, q.y + 0.016), (q.x + 0.012, q.y), (q.x, q.y - 0.016), (q.x - 0.012, q.y)], CR, 0.0036)
    # Field: a lattice of small motifs, the central medallion with pendants, corner spandrels.
    for i in range(-8, 9):
        for j in range(-6, 7):
            x = W / 2 + i * 0.18 + (0.09 if j % 2 else 0.0)
            y = H / 2 + j * 0.15
            if not (0.4 < x < W - 0.4 and 0.4 < y < H - 0.4):
                continue
            if ((x - W / 2) / 0.78) ** 2 + ((y - H / 2) / 0.58) ** 2 < 1.0:
                continue
            if min(x - 0.31, W - 0.31 - x) < 0.36 and min(y - 0.31, H - 0.31 - y) < 0.3:
                continue
            c = (CR, OC, DK)[(i + j) % 3]
            sk.poly([(x, y + 0.028), (x + 0.02, y), (x, y - 0.028), (x - 0.02, y)], c, 0.007)
            sk.poly([(x, y + 0.01), (x + 0.007, y), (x, y - 0.01), (x - 0.007, y)], FIELD if c != FIELD else CR, 0.0071)
    cx, cy = W / 2, H / 2
    def lozenge(a, b, k=0.6):
        pts = []
        for t in range(64):
            ang = 2 * PI * t / 64
            c, s = math.cos(ang), math.sin(ang)
            r = 1.0 / (abs(c) ** (1 / k) + abs(s) ** (1 / k)) ** k
            pts.append((cx + c * r * a, cy + s * r * b))
        return pts
    sk.poly(lozenge(0.74, 0.54), CR, 0.008)
    sk.poly(lozenge(0.71, 0.51), DK, 0.0081)
    sk.poly(lozenge(0.52, 0.36, 0.8), RU, 0.0082)
    sk.poly(lozenge(0.49, 0.33, 0.8), FIELD, 0.0083)
    rosette(sk, cx, cy, 0.2, CR, OC, DK, 0.009, petals=12)
    rosette(sk, cx, cy, 0.09, DK, CR, RU, 0.0095, petals=8)
    for s in (-1, 1):
        px = cx + s * 0.85
        sk.poly([(px - s * 0.1, cy + 0.07), (px + s * 0.03, cy + 0.07), (px + s * 0.1, cy), (px + s * 0.03, cy - 0.07), (px - s * 0.1, cy - 0.07)], DK, 0.008)
        rosette(sk, px, cy, 0.045, CR, RU, DK, 0.0085)
    for (sx, sy) in ((0.31, 0.31), (W - 0.31, 0.31), (0.31, H - 0.31), (W - 0.31, H - 0.31)):
        dx, dy = (1 if sx < W / 2 else -1), (1 if sy < H / 2 else -1)
        pts = [(sx, sy)] + [(sx + dx * math.cos(PI / 2 * t / 16) * 0.42, sy + dy * math.sin(PI / 2 * t / 16) * 0.3) for t in range(17)]
        sk.poly(pts, DK, 0.0075)
        pts2 = [(sx, sy)] + [(sx + dx * math.cos(PI / 2 * t / 16) * 0.36, sy + dy * math.sin(PI / 2 * t / 16) * 0.25) for t in range(17)]
        sk.poly(pts2, RU, 0.0076)
        rosette(sk, sx + dx * 0.13, sy + dy * 0.1, 0.05, CR, OC, DK, 0.0077)
    design = render_sketch(sk, 1536, 1070)
    def wool(nt, pos, uv):
        knots = _noise3(nt, node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=pos, i1=(1.0, 1.0, 1.0)).outputs[0], 260.0, 2.0, 0.5)
        abrash = _noise3(nt, node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=pos, i1=(0.15, 6.0, 1.0)).outputs[0], 1.2, 2.0, 0.5)
        wear = _mapr(nt, _noise3(nt, pos, 0.9, 3.0, 0.5), 0.55, 0.75)
        k = math_node(nt, 'ADD', 0.82, math_node(nt, 'MULTIPLY', knots, 0.28))
        k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'ADD', 0.9, math_node(nt, 'MULTIPLY', abrash, 0.18)))
        col = node(nt, 'ShaderNodeCombineColor', Red=k, Green=k, Blue=k).outputs[0]
        # Wear lightens and greys the pile a little.
        return _mix(nt, math_node(nt, 'MULTIPLY', wear, 0.25), col, (1.15, 1.05, 0.95))
    w = render_shader(W, H, 1536, 1070, wool)
    save_srgb(path, design * w)

def rosette(sk, cx, cy, r, c1, c2, c3, z, petals=8):
    for k in range(petals):
        a = 2 * PI * k / petals
        pts = []
        for t in range(9):
            u = t / 8
            w = math.sin(PI * u) * r * 0.32
            L = u * r
            pts.append((L, w))
        pts += [(u * r, -math.sin(PI * u) * r * 0.32) for u in [t / 8 for t in range(8, -1, -1)]]
        ca, sa = math.cos(a), math.sin(a)
        sk.poly([(cx + x * ca - y * sa, cy + x * sa + y * ca) for (x, y) in pts], c1, z)
    sk.disc(cx, cy, r * 0.42, c2, z + 0.00003, 20)
    sk.disc(cx, cy, r * 0.18, c3, z + 0.00006, 14)

# ---------------------------------------------------------------- the prints: planisphere, stacks profile, globe
def paint_prints(path):
    import numpy as np
    out = np.zeros((1024, 2048, 3), np.float32)
    out[:, 0:1024] = paint_planisphere()
    out[512:1024, 1024:2048] = paint_globe()
    out[0:512, 1024:2048] = paint_profile()
    save_srgb(path, out)

def paint_planisphere():
    W = H = 0.62
    sk = Sketch(W, H, 31)
    rs = sk.rs
    c = (W / 2, H / 2)
    sk.rect(0.02, 0.02, W - 0.02, H - 0.02, 0.0014, INK, 0.003)
    sk.rect(0.027, 0.027, W - 0.027, H - 0.027, 0.0005, INK, 0.003)
    R = 0.25
    sk.circle(c[0], c[1], R, 0.0012, INK, 0.003)
    sk.circle(c[0], c[1], R + 0.012, 0.0006, INK, 0.003)
    for k in range(120):
        a = 2 * PI * k / 120
        r1 = R + (0.012 if k % 5 == 0 else 0.006)
        sk.line((c[0] + math.cos(a) * R, c[1] + math.sin(a) * R), (c[0] + math.cos(a) * r1, c[1] + math.sin(a) * r1), 0.0004, INK, 0.003)
    for rr in (0.08, 0.16):
        sk.dashed([(c[0] + math.cos(2 * PI * k / 120) * rr, c[1] + math.sin(2 * PI * k / 120) * rr) for k in range(120)], 0.0004, SEPIA, 0.004, 0.003, 0.002, closed=True)
    for k in range(12):
        a = 2 * PI * k / 12
        sk.line(c, (c[0] + math.cos(a) * R, c[1] + math.sin(a) * R), 0.0003, FADED, 0.0015)
    ec = (c[0] + 0.04, c[1] - 0.02)
    sk.dashed([(ec[0] + math.cos(2 * PI * k / 160) * 0.19, ec[1] + math.sin(2 * PI * k / 160) * 0.19) for k in range(160)], 0.0006, REDINK, 0.006, 0.003, 0.0022, closed=True)
    stars = []
    for _ in range(420):
        rr = R * math.sqrt(rs.random()) * 0.97
        a = rs.uniform(0, 2 * PI)
        mag = rs.random() ** 3
        stars.append((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, mag))
    for (x, y, mag) in stars:
        r = 0.0006 + mag * 0.0028
        sk.disc(x, y, r, INK, 0.004, 10)
        if mag > 0.5:
            for a in (0, PI / 2, PI / 4, 3 * PI / 4):
                L = r * (2.6 if a in (0, PI / 2) else 1.7)
                sk.line((x - math.cos(a) * L, y - math.sin(a) * L), (x + math.cos(a) * L, y + math.sin(a) * L), 0.0004, INK, 0.0041)
    bright = [s for s in stars if s[2] > 0.15]
    for _ in range(14):
        cur = rs.choice(bright)
        chain = [cur]
        for _ in range(rs.randint(3, 6)):
            near = sorted((s for s in bright if s not in chain), key=lambda s: math.hypot(s[0] - cur[0], s[1] - cur[1]))[:3]
            if not near:
                break
            cur = rs.choice(near)
            if math.hypot(cur[0] - chain[-1][0], cur[1] - chain[-1][1]) > 0.07:
                break
            chain.append(cur)
        for a, b in zip(chain, chain[1:]):
            sk.line(a[:2], b[:2], 0.0004, SEPIA, 0.0035)
    for (x, y, dx, dy) in ((0.027, 0.027, 1, 1), (W - 0.027, 0.027, -1, 1), (0.027, H - 0.027, 1, -1), (W - 0.027, H - 0.027, -1, -1)):
        for rr in (0.05, 0.058):
            sk.stroke([(x + dx * math.cos(PI / 2 * t / 16) * rr, y + dy * math.sin(PI / 2 * t / 16) * rr) for t in range(17)], 0.0005, INK, 0.003)
    sun = (0.055, H - 0.055)
    sk.disc(sun[0], sun[1], 0.009, REDINK, 0.004)
    for k in range(16):
        a = 2 * PI * k / 16
        sk.line((sun[0] + math.cos(a) * 0.011, sun[1] + math.sin(a) * 0.011), (sun[0] + math.cos(a) * (0.017 if k % 2 else 0.021), sun[1] + math.sin(a) * (0.017 if k % 2 else 0.021)), 0.0005, INK, 0.004)
    moon = (W - 0.055, H - 0.055)
    sk.disc(moon[0], moon[1], 0.01, INK, 0.004)
    sk.disc(moon[0] + 0.004, moon[1] + 0.002, 0.009, (1, 1, 1), 0.0041)
    base = render_shader(W, H, 1024, 1024, paper((0.64, 0.5, 0.32), 7.1, W, H, stain=0.8))
    return base * render_sketch(sk, 1024, 1024)

def paint_profile():
    W, H = 0.9, 0.45
    sk = Sketch(W, H, 41)
    rs = sk.rs
    sk.rect(0.015, 0.015, W - 0.015, H - 0.015, 0.0012, INK, 0.006)
    sk.rect(0.021, 0.021, W - 0.021, H - 0.021, 0.0005, INK, 0.006)
    sx = 0.8 / 760.0
    sy = 0.00095
    cloud_y = 0.07
    top_y = lambda top: cloud_y + (top + 320.0) * sy
    X = lambda x: 0.45 + (x + 20.0) * sx
    order = sorted(STACKS.items(), key=lambda kv: kv[1][1])          # far (north, -z) first
    for depth, (name, (x, z, r)) in enumerate(order):
        top = {'dome': 0.0, 'rocks': 6.0, 'mountain': 2.0, 'tower': 8.0, 'end': -10.0}[name]
        xl, xr, yt = X(x - r), X(x + r), top_y(top)
        fade = 1.0 - 0.5 * (1 - depth / (len(order) - 1))
        rough = lambda y, ph: 0.007 * mnoise.fractal(Vector((y * 30, depth * 3.1, ph)), 0.6, 2.0, 4) + 0.01 * (1 - (y - cloud_y) / (yt - cloud_y)) ** 2
        left = [(xl - rough(y, 1.0), y) for y in [cloud_y + (yt - cloud_y) * t / 60 for t in range(61)]]
        topl = [(xl + (xr - xl) * t / 20, yt + 0.003 * mnoise.noise(Vector((t * 0.7, depth, 9.0)))) for t in range(1, 20)]
        right = [(xr + rough(y, 5.0), y) for y in [yt - (yt - cloud_y) * t / 60 for t in range(61)]]
        outline = left + topl + right
        z = 0.001 + depth * 0.001
        wash = tuple(1 - (1 - c) * fade for c in WASH)
        sk.poly(outline, wash, z)
        sk.stroke(outline, 0.0008, INK, z + 0.0004)
        for k in range(int((xr - xl) / 0.0022 * 0.4)):
            hx = xr - 0.004 - k * 0.0022
            sk.line((hx, cloud_y + 0.004), (hx, yt - 0.004 - 0.006 * rs.random()), 0.0003, SEPIA if fade > 0.7 else FADED, z + 0.0002)
        for k in range(int((yt - cloud_y) / 0.012)):
            # Strata: broken horizontal bedding lines, and the odd ledge.
            yy = cloud_y + 0.006 + k * 0.012 + rs.uniform(-0.003, 0.003)
            xx = xl + rs.uniform(0.0, 0.3) * (xr - xl)
            while xx < xr - 0.01:
                L = rs.uniform(0.008, 0.03)
                sk.stroke([(xx + L * t / 6, yy + 0.0012 * math.sin(t + k)) for t in range(7)], 0.00035, SEPIA, z + 0.0002)
                xx += L + rs.uniform(0.004, 0.02)
        cx = X(x)
        if name == 'dome':
            sk.stroke([(cx + math.cos(PI * t / 12) * 0.008, yt + math.sin(PI * t / 12) * 0.008) for t in range(13)], 0.0005, INK, z + 0.0005)
        elif name == 'tower':
            sk.line((cx - 0.006, yt), (cx - 0.001, yt + 0.05), 0.0005, INK, z + 0.0005)
            sk.line((cx + 0.006, yt), (cx + 0.001, yt + 0.05), 0.0005, INK, z + 0.0005)
            sk.line((cx - 0.013, yt + 0.035), (cx + 0.013, yt + 0.035), 0.0005, INK, z + 0.0005)
            sk.disc(cx, yt + 0.052, 0.0015, REDINK, z + 0.0006)
        elif name == 'mountain':
            sk.stroke([(cx - 0.05, yt), (cx - 0.01, yt + 0.022), (cx + 0.02, yt + 0.012), (cx + 0.05, yt)], 0.0006, INK, z + 0.0005)
            sk.stroke([(cx - 0.012 + math.cos(PI * t / 10) * 0.005, yt + 0.024 + math.sin(PI * t / 10) * 0.005) for t in range(11)], 0.0005, INK, z + 0.0005)
        elif name == 'rocks':
            sk.line((cx - 0.01, yt), (cx - 0.01, yt + 0.045), 0.0008, INK, z + 0.0005)
            for k in range(6):
                yy = yt + 0.045 - k * 0.006
                ww = 0.002 + k * 0.0016
                sk.stroke([(cx - 0.01 - ww, yy - 0.004), (cx - 0.01, yy), (cx - 0.01 + ww, yy - 0.004)], 0.0005, INK, z + 0.0005)
            sk.stroke([(cx + 0.02 + math.cos(PI * t / 8) * 0.008, yt + math.sin(PI * t / 8) * 0.012) for t in range(9)], 0.0005, INK, z + 0.0005)
    # Cloud sea along the bottom: rows of scallops.
    for row in range(3):
        y = cloud_y - row * 0.016
        x = 0.025 + (row % 2) * 0.01
        while x < W - 0.03:
            r = rs.uniform(0.008, 0.014)
            sk.poly([(x + math.cos(PI * t / 12) * r, y + math.sin(PI * t / 12) * r * 0.8) for t in range(13)] + [(x - r, y - 0.01), (x + r, y - 0.01)], (1, 1, 1), 0.01 + row * 0.001)
            sk.stroke([(x + math.cos(PI * t / 12) * r, y + math.sin(PI * t / 12) * r * 0.8) for t in range(13)], 0.0005, SEPIA, 0.0105 + row * 0.001)
            x += r * 1.7
    sun = (0.35, H - 0.075)
    sk.circle(sun[0], sun[1], 0.014, 0.0006, INK, 0.01)
    for k in range(12):
        a = 2 * PI * k / 12
        sk.line((sun[0] + math.cos(a) * 0.018, sun[1] + math.sin(a) * 0.018), (sun[0] + math.cos(a) * 0.026, sun[1] + math.sin(a) * 0.026), 0.0005, INK, 0.01)
    for _ in range(5):
        bx, by = rs.uniform(0.15, 0.75), rs.uniform(0.36, 0.41)
        sk.stroke([(bx - 0.005, by + 0.002), (bx, by), (bx + 0.005, by + 0.002)], 0.0004, INK, 0.01)
    base = render_shader(W, H, 1024, 512, paper((0.66, 0.52, 0.34), 9.3, W, H, stain=0.8))
    return base * render_sketch(sk, 1024, 512)

def paint_globe():
    """An antique globe (equirectangular): pale seas, lands in soft rose, ochre and cream, a graticule and the ecliptic."""
    def make(nt, pos, uv):
        sep = node(nt, 'ShaderNodeSeparateXYZ', Vector=uv)
        lon = math_node(nt, 'MULTIPLY', sep.outputs['X'], -2 * PI)
        lat = math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', sep.outputs['Y'], 0.5), PI)
        cl = math_node(nt, 'COSINE', lat)
        d = node(nt, 'ShaderNodeCombineXYZ', X=math_node(nt, 'MULTIPLY', cl, math_node(nt, 'COSINE', lon)),
                 Y=math_node(nt, 'SINE', lat), Z=math_node(nt, 'MULTIPLY', cl, math_node(nt, 'SINE', lon))).outputs[0]
        d2 = node(nt, 'ShaderNodeVectorMath', props={'operation': 'ADD'}, i0=d, i1=(3.1, 1.7, 0.4)).outputs[0]
        land = _noise3(nt, d2, 1.3, 5.0, 0.55, 0.3)
        mask = _mapr(nt, land, 0.53, 0.535)
        coastl = _mapr(nt, math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', land, 0.5325)), 0.0, 0.004, 1.0, 0.0)
        region = _noise3(nt, node(nt, 'ShaderNodeVectorMath', props={'operation': 'ADD'}, i0=d, i1=(9.0, 2.0, 5.0)).outputs[0], 2.0, 2.0, 0.5)
        lc = _ramp(nt, region, [(0.3, (0.62, 0.36, 0.26)), (0.5, (0.7, 0.54, 0.3)), (0.7, (0.74, 0.64, 0.46))])
        sea = node(nt, 'ShaderNodeCombineColor', Red=0.6, Green=0.5, Blue=0.34).outputs[0]
        fine = _noise3(nt, d, 18.0, 3.0, 0.5)
        col = _mix(nt, mask, sea, lc)
        col = _mix(nt, math_node(nt, 'MULTIPLY', coastl, 0.8), col, (0.12, 0.07, 0.04))
        return _scale(nt, col, math_node(nt, 'ADD', 0.9, math_node(nt, 'MULTIPLY', fine, 0.16)))
    base = render_shader(2.0, 1.0, 1024, 512, make)
    sk = Sketch(2.0, 1.0, 51)
    for k in range(25):
        x = 2.0 * k / 24
        sk.line((x, 0), (x, 1), 0.0035 if k % 6 == 0 else 0.0018, SEPIA, 0.001)
    for k in range(1, 12):
        y = k / 12
        sk.line((0, y), (2, y), 0.004 if k == 6 else 0.0018, SEPIA, 0.001)
    for yy in (0.5 + 23.4 / 180, 0.5 - 23.4 / 180):
        sk.dashed([(0, yy), (2, yy)], 0.002, SEPIA, 0.02, 0.012, 0.0012)
    sk.dashed([(2.0 * t / 200, 0.5 + 23.4 / 180 * math.sin(2 * PI * t / 200)) for t in range(201)], 0.004, REDINK, 0.03, 0.015, 0.0013)
    return base * render_sketch(sk, 1024, 512)

# ---------------------------------------------------------------- the card and its dots, the floor
def paint_card(path, dots_path):
    import numpy as np
    n = 256
    rs = np.random.default_rng(7)
    base = np.array(srgb(150, 22, 26), np.float32)
    noise = rs.normal(0, 1, (n, n)).astype(np.float32)
    noise = _blur(noise, (1, 2, 1)) * 0.05 + _blur(_blur(rs.normal(0, 1, (n, n)).astype(np.float32), (1, 4, 6, 4, 1)), (1, 4, 6, 4, 1)) * 0.1
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    edge = np.minimum(np.minimum(xx, n - 1 - xx), np.minimum(yy, n - 1 - yy))
    k = (1 + noise) * np.clip(0.8 + edge / 12, 0, 1)
    card = base[None, None, :] * k[:, :, None]
    if REPAINT or not os.path.exists(path):
        save_srgb(path, card)
    # Dots: black, top left, top right and middle bottom (rows run bottom-up here), on transparent.
    rgba = np.zeros((n, n, 4), np.float32)
    rgba[:, :, :3] = 0.035
    a = np.zeros((n, n), np.float32)
    for (u, v) in ((0.22, 0.78), (0.78, 0.78), (0.5, 0.22)):
        d = np.hypot(xx + 0.5 - u * n, yy + 0.5 - v * n) - 0.085 * n
        a = np.maximum(a, np.clip(0.5 - d, 0, 1))
    rgba[:, :, 3] = a
    if REPAINT or not os.path.exists(dots_path):
        save_rgba(dots_path, rgba)

def paint_floor(path, wood):
    """Plank tile (2.4 x 1.2 m, 8 rows) cut from the walnut texture: staggered joints, per-board tone, dark seams."""
    import numpy as np
    pw, ph = 1536, 768
    ppm = pw / FLOOR_T[0]
    rows = 8
    rh = ph // rows
    rs = random.Random(77)
    out = np.zeros((ph, pw, 3), np.float32)
    tw = wood.shape[1]
    th = wood.shape[0]
    xs = np.arange(pw, dtype=np.float32) / ppm
    for r in range(rows):
        # Two or three boards around the tile (it repeats), starting anywhere.
        lens = [rs.uniform(0.6, 1.4) for _ in range(rs.randint(2, 3))]
        lens = [L * FLOOR_T[0] / sum(lens) for L in lens]
        j0 = rs.uniform(0, FLOOR_T[0])
        yy = np.arange(rh, dtype=np.float32) / ppm
        for L in lens:
            tone = rs.uniform(0.8, 1.15)
            warm = rs.uniform(0.95, 1.08)
            ou, ov = rs.uniform(0, 1), rs.uniform(0, 1)
            lx = (xs - j0) % FLOOR_T[0]
            sel = lx < L
            tu = ((lx[None, sel] / WT[0] + ou) * tw).astype(np.int32) % tw
            tv = ((yy[:, None] / WT[1] + ov) * th).astype(np.int32) % th
            patch = wood[tv, tu] * tone
            patch[:, :, 0] *= warm * 1.12
            patch[:, :, 2] *= 0.92
            end = np.minimum(lx[sel], L - lx[sel]) * ppm
            patch *= np.clip(0.35 + end / 3.0, 0, 1)[None, :, None]
            out[r * rh:(r + 1) * rh, sel] = patch
            j0 += L
        seam = np.minimum(np.arange(rh), rh - 1 - np.arange(rh)).astype(np.float32)
        out[r * rh:(r + 1) * rh] *= np.clip(0.35 + seam / 2.5, 0, 1)[:, None, None]
    save_srgb(path, out)

# ============================================================================ bake
def bake_materials(lm_img=None, preview=False, gain=1.0, glow_gain=4.0, amb=(0.0, 0.0, 0.0)):
    """Blender materials that match the game's albedo (textures x vertex colours). For the bake everything is diffuse and
    the shades translucent; preview=True makes them emit albedo x lightmap instead (what the game draws)."""
    imgs = {}
    def img(name, cs='sRGB'):
        if name not in imgs:
            im = bpy.data.images.load(MODELS + name, check_existing=True)
            im.colorspace_settings.name = cs
            imgs[name] = im
        return imgs[name]
    def tex(nt, name, vec, ext='REPEAT'):
        n = node(nt, 'ShaderNodeTexImage', props={'image': img(name), 'extension': ext}, Vector=vec)
        return n
    out = {}
    for key in ('wood', 'leather', 'brass', 'decal', 'glow'):
        m = bpy.data.materials.get(PREFIX + key)
        if m is None:
            continue
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        col = node(nt, 'ShaderNodeAttribute', props={'attribute_name': 'Col'}).outputs['Color']
        uvn = node(nt, 'ShaderNodeUVMap', props={'uv_map': 'UVMap'}).outputs['UV']
        if key == 'wood':
            alb = _mix(nt, 1.0, tex(nt, 'lounge_wood.png', uvn).outputs['Color'], col, 'MULTIPLY')
        elif key == 'leather':
            alb = _mix(nt, 1.0, tex(nt, 'lounge_leather.png', uvn).outputs['Color'], col, 'MULTIPLY')
        elif key == 'brass':
            alb = col
        elif key == 'glow':
            alb = col
        else:
            sep = node(nt, 'ShaderNodeSeparateXYZ', Vector=uvn)
            idv = math_node(nt, 'FLOOR', math_node(nt, 'DIVIDE', math_node(nt, 'ADD', sep.outputs['X'], SLOT / 2), SLOT))
            lu = math_node(nt, 'SUBTRACT', sep.outputs['X'], math_node(nt, 'MULTIPLY', idv, SLOT))
            lv = node(nt, 'ShaderNodeCombineXYZ', X=lu, Y=sep.outputs['Y']).outputs[0]
            res = node(nt, 'ShaderNodeCombineColor', Red=1.0, Green=1.0, Blue=1.0).outputs[0]
            for (k, fname) in ((0, 'lounge_map.png'), (1, 'lounge_card.png'), (2, 'lounge_rug.png'), (3, 'lounge_prints.png'), (4, 'lounge_floor.png')):
                c = tex(nt, fname, lv).outputs['Color']
                if k == 1:
                    dn = tex(nt, 'lounge_card_dots.png', lv)
                    c = _mix(nt, dn.outputs['Alpha'], c, (0.035, 0.035, 0.035))
                sel = node(nt, 'ShaderNodeMath', props={'operation': 'COMPARE'}, i0=idv, i1=float(k), i2=0.25).outputs[0]
                res = _mix(nt, sel, res, c)
            alb = _mix(nt, 1.0, res, col, 'MULTIPLY')
        if preview:
            if key == 'glow':
                em = node(nt, 'ShaderNodeEmission', Color=alb, Strength=glow_gain)
            else:
                lmuv = node(nt, 'ShaderNodeUVMap', props={'uv_map': 'lightmap'}).outputs['UV']
                lt = node(nt, 'ShaderNodeTexImage', props={'image': lm_img, 'interpolation': 'Linear', 'extension': 'EXTEND'}, Vector=lmuv).outputs['Color']
                lin = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=lt, i1=lt).outputs[0]
                lin = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=lin, i1=lt).outputs[0]
                lin = _scale(nt, lin, gain)
                lin = node(nt, 'ShaderNodeVectorMath', props={'operation': 'ADD'}, i0=lin, i1=amb).outputs[0]
                em = node(nt, 'ShaderNodeEmission', Color=_mix(nt, 1.0, alb, lin, 'MULTIPLY'), Strength=1.0)
            nt.links.new(em.outputs[0], o.inputs['Surface'])
        elif key == 'glow':
            # A parchment shade: most of what reaches it passes through, warmed.
            tr = node(nt, 'ShaderNodeBsdfTranslucent', Color=(1.0, 0.74, 0.44, 1.0))
            df = node(nt, 'ShaderNodeBsdfDiffuse', Color=(0.8, 0.6, 0.4, 1.0))
            mx = node(nt, 'ShaderNodeMixShader', Fac=0.75, i1=df.outputs[0], i2=tr.outputs[0])
            nt.links.new(mx.outputs[0], o.inputs['Surface'])
        else:
            bs = node(nt, 'ShaderNodeBsdfDiffuse', Color=alb)
            nt.links.new(bs.outputs[0], o.inputs['Surface'])
        out[key] = m
    return out

def simple_materials():
    for key in ('wood', 'leather', 'brass', 'decal', 'glow', 'collider'):
        m = bpy.data.materials.get(PREFIX + key)
        if m is None:
            continue
        m.node_tree.nodes.clear()
        p = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        o = m.node_tree.nodes.new('ShaderNodeOutputMaterial')
        m.node_tree.links.new(p.outputs[0], o.inputs['Surface'])
        col, rough = MATS[key]
        p.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1.0)
        p.inputs['Roughness'].default_value = rough

def lightmap_uvs(size):
    """Second UV set: smart-projected, then packed, with the desk's things at twice and the ceiling and small hardware
    at half the texel density of everything else (scaling the mesh while unwrapping)."""
    import numpy as np
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    targets = [ob for ob in sc.objects if ob.type == 'MESH' and ob.get('bake')]
    k = {'hi': 2.0, 'lo': 0.5}
    for ob in targets:
        me = ob.data
        me.uv_layers.active = me.uv_layers.get('lightmap') or me.uv_layers.new(name='lightmap')
        f = k.get(ob.get('layer', ''), 1.0)
        if f != 1.0:
            me.transform(Matrix.Scale(f, 4))
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in targets)
        vl.objects.active = targets[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    for ob in targets:
        f = k.get(ob.get('layer', ''), 1.0)
        if f != 1.0:
            ob.data.transform(Matrix.Scale(1.0 / f, 4))
    fatten_islands(targets, size)
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in targets)
        vl.objects.active = targets[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', margin_method='FRACTION', margin=0.0025, shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')
    for ob in targets:
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
        ob.data.uv_layers['UVMap'].active_render = True
    return targets

def _islands(bm, uv):
    """Faces grouped into UV islands (faces sharing a vertex at the same UV)."""
    parent = list(range(len(bm.faces)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    bm.faces.index_update()
    seen = {}
    for f in bm.faces:
        for l in f.loops:
            key = (l.vert.index, round(l[uv].uv.x, 7), round(l[uv].uv.y, 7))
            g = seen.get(key)
            if g is None:
                seen[key] = f.index
            else:
                ra, rb = find(g), find(f.index)
                if ra != rb:
                    parent[ra] = rb
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())

def fatten_islands(targets, size, min_px=3.0, fill=0.55):
    """Stretch islands thinner than min_px texels (tubes, lathe steps, gilt lines): the baker only writes texels whose
    centres fall inside a triangle, so a sliver would come out black."""
    area = 0.0
    for ob in targets:
        uv = ob.data.uv_layers['lightmap'].data
        for poly in ob.data.polygons:
            pts = [uv[i].uv for i in poly.loop_indices]
            for j in range(1, len(pts) - 1):
                area += abs((pts[j] - pts[0]).cross(pts[j + 1] - pts[0])) / 2
    k = math.sqrt(fill / max(area, 1e-9))              # the pack's likely scale
    m = min_px / size / k
    n = 0
    for ob in targets:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        uv = bm.loops.layers.uv['lightmap']
        for faces in _islands(bm, uv):
            loops = [l for f in faces for l in f.loops]
            xs = [l[uv].uv.x for l in loops]
            ys = [l[uv].uv.y for l in loops]
            w, h = max(xs) - min(xs), max(ys) - min(ys)
            sx = min(40.0, m / w) if w < m else 1.0
            sy = min(40.0, m / h) if h < m else 1.0
            if sx == 1.0 and sy == 1.0:
                continue
            n += 1
            cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
            for l in loops:
                p = l[uv].uv
                l[uv].uv = (cx + (p.x - cx) * sx, cy + (p.y - cy) * sy)
        bm.to_mesh(ob.data)
        bm.free()
    return n

def bake_light(targets, size, samples):
    """Full GI from the lamps (DIFFUSE direct + indirect, no albedo) into one float image; cube-root encoded PNG."""
    import numpy as np
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    hidden = []
    for ob in sc.objects:
        if ob.type == 'MESH' and not ob.hide_render and (ob.get('layer') in ('bulb', 'shadein') or ob.name.startswith('COLLIDER')):
            ob.hide_render = True
            hidden.append(ob)
    img = bpy.data.images.get('DB_lightbake')
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new('DB_lightbake', size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    added = []
    for ob in targets:
        ob.data.uv_layers.active = ob.data.uv_layers['lightmap']
    for m in {s.material for ob in targets for s in ob.material_slots if s.material}:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        m.node_tree.nodes.active = n
        n.select = True
        added.append((m, n))
    if sc.world is None:
        sc.world = bpy.data.worlds.new('DB_world')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Strength'].default_value = 0.0
    _cycles(sc, samples)
    sc.cycles.max_bounces = 10
    sc.cycles.diffuse_bounces = 8
    sc.cycles.transmission_bounces = 8
    sc.cycles.sample_clamp_indirect = 4.0
    sc.render.bake.margin = 6
    try:
        sc.render.bake.margin_type = 'ADJACENT_FACES'
    except Exception:
        pass
    t0 = time.time()
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in targets)
        vl.objects.active = targets[0]
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, use_clear=True, target='IMAGE_TEXTURES')
    secs = time.time() - t0
    a = _np_image(img)[:, :, :3].copy()
    for (m, n) in added:
        m.node_tree.nodes.remove(n)
    for ob in targets:
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
    for ob in hidden:
        ob.hide_render = False
    # A light blur (islands are 5 px apart), then store (L / scale)^(1/3): plenty of steps in the dark corners.
    a = np.stack([_blur(a[:, :, c], (1, 2, 1)) for c in range(3)], axis=-1)
    lit = a.max(axis=2)
    lit = lit[lit > 1e-6]
    scale = float(np.percentile(lit, 99.9)) if lit.size else 1.0
    enc = np.cbrt(np.clip(a / scale, 0, 1))
    save_png(MODELS + 'lounge_lm.png', enc)
    return scale, round(secs, 1), round(float((a.max(axis=2) > 1e-7).mean()), 3)

def bake_all():
    import numpy as np
    t0 = time.time()
    out = {}
    wood = bake_tile(MODELS + 'lounge_wood.png', make_walnut, 1024)
    bake_tile(MODELS + 'lounge_leather.png', make_leather, 512)
    paint_floor(MODELS + 'lounge_floor.png', wood)
    if REPAINT or not os.path.exists(MODELS + 'lounge_map.png'):
        paint_map(MODELS + 'lounge_map.png')
    paint_card(MODELS + 'lounge_card.png', MODELS + 'lounge_card_dots.png')
    paint_rug(MODELS + 'lounge_rug.png')
    paint_prints(MODELS + 'lounge_prints.png')
    out['textures_s'] = round(time.time() - t0, 1)
    size = 1024 if QUICK else 2048
    targets = lightmap_uvs(size)
    bake_materials()
    scale, secs, cover = bake_light(targets, size, 96 if QUICK else 1600)
    out['lm_cover'] = cover
    out['bake_s'] = secs
    out['lm_scale'] = scale
    meta = _scene().objects.get('META')
    if meta is not None:
        meta['lm_scale'] = scale
    simple_materials()
    out['seconds'] = round(time.time() - t0, 1)
    return out

# ============================================================================ preview renders (what the game draws)
def aces(c, exposure):
    import numpy as np
    c = c * (exposure / 0.6)
    A = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]], np.float32)
    B = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]], np.float32)
    c = c @ A.T
    a = c * (c + 0.0245786) - 0.000090537
    b = c * (0.983729 * c + 0.4329510) + 0.238081
    c = (a / b) @ B.T
    return np.clip(c, 0, 1)

def preview_all(outdir, gain=1.0, glow_gain=4.0, exposure=1.35, views=None, size=(1600, 900), samples=24, amb=(0.03, 0.022, 0.015)):
    """Render views with the game's shading (albedo x lightmap x gain, glow x gain, ACES at the underground exposure)."""
    import numpy as np
    sc = _scene()
    meta = sc.objects.get('META')
    scale = float(meta.get('lm_scale', 1.0)) if meta else 1.0
    lm = bpy.data.images.load(MODELS + 'lounge_lm.png', check_existing=True)
    lm.colorspace_settings.name = 'Non-Color'
    bake_materials(lm, preview=True, gain=gain * scale, glow_gain=glow_gain, amb=amb)
    for ob in sc.objects:
        if ob.name.startswith('COLLIDER') or ob.name.startswith('BAKE_') or ob.name.startswith('TILE_'):
            ob.hide_render = True
    _cycles(sc, samples)
    sc.cycles.max_bounces = 0
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    if sc.world:
        bg = sc.world.node_tree.nodes.get('Background')
        if bg:
            bg.inputs['Strength'].default_value = 0.0
    cd = bpy.data.cameras.get('DB_prev') or bpy.data.cameras.new('DB_prev')
    cam = sc.objects.get('DB_prev') or bpy.data.objects.new('DB_prev', cd)
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam['noexport'] = 1
    sc.camera = cam
    os.makedirs(outdir, exist_ok=True)
    paths = []
    for (name, eye, target, lens) in views:
        e, t = g2b(eye), g2b(target)
        cam.location = e
        cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
        cd.lens = lens
        cd.clip_start = 0.02
        bpy.ops.render.render(scene=sc.name)
        path = os.path.join(bpy.app.tempdir, 'db_prev.exr')
        bpy.data.images['Render Result'].save_render(path, scene=sc)
        im = bpy.data.images.load(path)
        a = _np_image(im)[:, :, :3].copy()
        bpy.data.images.remove(im)
        out = os.path.join(outdir, name + '.png')
        save_png(out, srgb_enc(aces(a, exposure)))
        paths.append(out)
    return paths
