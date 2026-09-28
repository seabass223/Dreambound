# Dreambound: the Mountain observatory. Executed inside dbkit.py's namespace by build_observatory.py.
#
# Model coordinates: origin at the summit ground, +Y up, the door faces -Z. Placement angles `a` follow
# pol(): a = 0 at -Z (the door), increasing clockwise seen from above (90 deg = +X).
#
# Moving parts carry a `driver` ('yaw' = the dome's rotation, 'pitch' = the telescope's elevation,
# 'wind', 'hatch' = the rear hatch's panel, 1 = shut) and a `ratio`, so the game can turn every gear from those two numbers:
#     part angle about its `axis` = ratio * driver value.
# Meshing gears are phased at rest so their teeth interleave, and their ratios follow the tooth counts.

MATS.update({
    'dome': ((0.86, 0.86, 0.84), 0.45), 'steel': ((0.52, 0.54, 0.56), 0.45), 'tube': ((0.12, 0.22, 0.25), 0.35),
    'plate': ((0.55, 0.56, 0.58), 0.5), 'rubber': ((0.05, 0.05, 0.05), 0.9), 'screen': ((0.1, 0.4, 0.2), 0.2),
    'lamps': ((0.9, 0.3, 0.1), 0.4), 'reels': ((0.7, 0.7, 0.72), 0.4), 'poster': ((0.1, 0.12, 0.25), 0.9),
})
NO_BAKE = {'glass', 'emissive', 'collider', 'screen', 'lamps', 'reels'}
# Every opaque surface gets the AO atlas (moving parts too, baked at rest), so the game can merge
# meshes by material across parts.
BAKE_MATS = {'stone', 'plaster', 'wood_floor', 'plate', 'painted', 'metal_black', 'steel', 'wood', 'brass', 'leather',
             'rubber', 'ceramic', 'dome', 'tube'}

# ---------------------------------------------------------------- palette
DOMEWHITE = srgb(232, 230, 222)
STEELG = srgb(132, 136, 138)
GUNMETAL = srgb(70, 74, 78)
TEAL = srgb(40, 72, 80)
MACHINE = srgb(76, 94, 82)
PUTTY = srgb(214, 204, 182)
BEIGE = srgb(198, 184, 156)
ORANGE70 = srgb(204, 108, 42)
MUSTARD = srgb(198, 152, 52)
OLIVE70 = srgb(112, 114, 72)
BROWN70 = srgb(104, 74, 50)
PANELBLK = srgb(34, 34, 36)
CREAMP = srgb(236, 230, 214)
OXBLOOD = srgb(112, 34, 30)
RED = srgb(176, 36, 30)
CONCRETE = srgb(170, 166, 158)
PINEOLD = srgb(196, 170, 134)
GREEN_P = srgb(60, 200, 110)     # phosphor tints (screens)
AMBER_P = srgb(255, 170, 60)
CYAN_P = srgb(150, 220, 255)

# ---------------------------------------------------------------- dimensions
FL = 0.28                     # interior floor
R_IN, R_OUT = 5.15, 5.5       # drum wall
WALL_TOP = 3.75
DC = 3.9                      # dome sphere centre = dome base height
RD = 5.8                      # dome outer radius
SLIT = 0.95                   # half width of the observing slit
SLIT_END_Z = RD * math.sin(math.radians(25))   # the slit runs 25 deg past the zenith
PIV_Y = 4.3                   # telescope altitude axis
TUBE_F, TUBE_R = 4.4, 1.12    # tube length in front of / behind the axis
DOOR_W, DOOR_H = 0.68, 2.5    # half width, top of the door opening
WINDOWS = (70, 160, 200, 290)  # clerestory windows (deg)
WIN_W, WIN_Y0, WIN_Y1 = 0.36, 2.45, 3.4
# Rear hatch (a puzzle, see build_hatch): a riveted square cut low in the back of the drum. Hatch-local
# coordinates: u to the right and v up as seen from outside, r = distance from the drum axis.
HATCH_A = 180.0                  # deg: straight opposite the door
HATCH_HW = 0.09                  # half width of the square cut
HATCH_Y0 = 0.34                  # its bottom edge (the plinth top is at FL - 0.02)
HATCH_YC = HATCH_Y0 + HATCH_HW
HATCH_PIN = (0.0, HATCH_YC + 0.24)   # the panel's pivot pin, above the cut
HATCH_SWING = math.pi / 2        # to open, the panel hanging from the pin swings up to the right this far
HR_FACE, HR_SLOT1, HR_SLOT0, HR_PLATE = 5.51, 5.47, 5.452, 5.444   # frame face, the panel's slot, the plate face
# Service ladders and the roof station (see build_ladders, build_station). A straight ladder climbs the back of the
# drum from the ground to about half way; a curved one, on the dome, runs on up to a small railed station near the
# crown. They line up only when the telescope points at the Dome stack. The door faces 0.05 rad anticlockwise of that
# (mountain.js: the path's last leg, less 0.05), so pointing home turns the dome that far clockwise of its rest pose,
# and the curved ladder sits that much anticlockwise of the fixed one on the dome.
LAD_A = 245.0                    # deg: the fixed ladder, round the back (the hatch is at 180, windows at 200 and 290)
LAD_LON = LAD_A - math.degrees(0.05)   # deg: the curved ladder's longitude on the dome, clockwise from the slit
LAD_R = 6.04                     # the fixed ladder's rung line from the axis (its rails clear the plinth, 5.95)
LAD_Y = 4.7                      # its top, where the curved ladder starts
LAD_HW = 0.26                    # half the rail spacing (as buildLadder's in src/world/features.js)
LAD_PITCH = 0.3                  # rung spacing
LAD_SO = 0.2                     # the curved ladder's standoff from the dome skin, between its ends
STA_RC, STA_Y = 2.47, 9.58       # the station deck: its centre's distance from the axis along the ladder's meridian; its top
STA_HX, STA_HZ = 0.55, 0.7       # its half width (across) and half depth (along the meridian; +z outward, to the ladder)
STA_IZ, STA_IR = -0.2, 0.25     # the iris set in the deck: centre (station z) and blade radius (the End's door is 1.75)
STA_BTN = (0.16, 0.085)          # the button plate just in front of it: centre (station z) and button spacing
STA_WELL = 0.15                  # depth of the well under the iris (the game lays the telescope's scales on its floor)

def D(d):
    return math.radians(d)

def pol(r, a, y=0.0):
    return (math.sin(a) * r, y, -math.cos(a) * r)

def jitter(c, k=0.06):
    f = 1.0 + rng.uniform(-k, k)
    return (c[0] * f, c[1] * f, c[2] * f)

def region_uv(M, w, h, region):
    """UVs for a flat w x h face in local XY of M, mapped into an atlas region."""
    Mi = M.inverted()
    def f(co, n):
        p = Mi @ co
        return (region[0] + (p.x / w + 0.5) * (region[2] - region[0]), region[1] + (p.y / h + 0.5) * (region[3] - region[1]))
    return f

def quad(w, h, z=0.0):
    """A w x h face in local XY facing +Z."""
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in ((-w / 2, -h / 2, z), (w / 2, -h / 2, z), (w / 2, h / 2, z), (-w / 2, h / 2, z))])
    return bm

def wall_g(a_deg, r, y=FL):
    """Local frame against the drum wall: local +z faces the room centre, +x runs clockwise."""
    a = D(a_deg)
    x, _, z = pol(r, a)
    return G(x, y, z, -a)

SIDES = lambda n: abs(n.y) < 0.5   # smooth curved walls, keep caps flat

def smooth01(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def cyl_uv(R, tile=1.0):
    """UVs for curved walls: arc length around the axis (u) and height (v); flat faces use x/z."""
    def f(co, n):
        if abs(n.y) > 0.7:
            return (co.x / tile, co.z / tile)
        a = math.atan2(co.x, -co.z)
        an = math.atan2(n.x, -n.z)
        if a - an > PI:
            a -= 2 * PI
        elif an - a > PI:
            a += 2 * PI
        return (a * R / tile, co.y / tile)
    return f

def dome_uv(co, n):
    """Dome paint UVs: one texture tile per gore (15 deg) and per 1.15 m course up the meridian."""
    d = Vector((co.x, co.y - DC, co.z))
    L = max(d.length, 1e-6)
    a = math.atan2(d.x, -d.z)
    an = math.atan2(n.x, -n.z)
    if a - an > PI:
        a -= 2 * PI
    elif an - a > PI:
        a += 2 * PI
    lat = math.asin(max(-1.0, min(1.0, d.y / L)))
    return (a / D(15), lat * RD / 1.15)

def gear_phase(Na, ma, phia, beta, Nb, internal=False):
    """Rest rotation for gear B meshing with gear A (A's teeth at 2*pi*k/Na + phia). beta is the direction
    from A's centre to B's centre in A's plane. Keeps the teeth interleaved at rest."""
    pa = 2 * PI / Na
    f = (beta - phia) / pa
    delta = (f - round(f)) * pa
    ra, rb = ma * Na / 2, ma * Nb / 2
    if internal:
        gap = beta - delta * ra / rb
    else:
        gap = beta + PI + delta * ra / rb
    return gap - PI / Nb

def gear_at(bm, mat, M, phase, tint=WHITE, uvofs=None):
    """Emit a gear built in the XY plane (axis +Z) with rest rotation `phase` about its axis, then M."""
    emit(bm, mat, M @ Matrix.Rotation(phase, 4, 'Z'), tint, 0.3, None, None, False, uvofs=uvofs)

def local_uv(Minv, scale, ofs=(0.0, 0.0), center=(0.5, 0.5), region=None):
    """UVs from a flat local frame: (x, y) local / scale + centre. region=(u0, v0, u1, v1) remaps 0..1."""
    def f(co, n):
        p = Minv @ co
        u, v = p.x / scale + center[0], p.y / scale + center[1]
        if region:
            u = region[0] + u * (region[2] - region[0])
            v = region[1] + v * (region[3] - region[1])
        return (u + ofs[0], v + ofs[1])
    return f

# Atlas regions of the 'poster' texture (u0, v0, u1, v1), matched in src/render/textures.js.
REG_CHART = (0.0, 0.0, 0.62, 1.0)
REG_DIAL = (0.64, 0.64, 1.0, 1.0)
REG_METER = (0.64, 0.42, 1.0, 0.62)
REG_PAPER = (0.64, 0.0, 1.0, 0.4)

_ids = {'lamp': 0, 'screen': 0, 'reel': 0}

def lamp(x, y, z, tint, M=None, size=0.022, kind=0):
    """An indicator lamp. The game blinks each one from its id (u) and kind (v: 0 random, 1 steady,
    2 slow beacon, 3 fast chatter)."""
    i = _ids['lamp']
    _ids['lamp'] += 1
    bm = bm_box(size, size, size * 0.6)
    Mx = (M or Matrix.Identity(4)) @ Matrix.Translation((x, y, z))
    emit(bm, 'lamps', Mx, tint, uvfn=lambda co, n: (0.5, 0.5), uvofs=(i, kind))

def screen(M, w, h, mode, tint, curve=0.0):
    """A CRT face (local XY, facing +Z) of w x h. mode picks the content (see observatory.js)."""
    i = _ids['screen']
    _ids['screen'] += 1
    nx, ny = 10, 8
    bm = bmesh.new()
    grid = []
    for j in range(ny + 1):
        row = []
        for k in range(nx + 1):
            u, v = k / nx, j / ny
            x, y = (u - 0.5) * w, (v - 0.5) * h
            bulge = curve * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
            row.append(bm.verts.new((x, y, bulge)))
        grid.append(row)
    for j in range(ny):
        for k in range(nx):
            bm.faces.new((grid[j][k], grid[j][k + 1], grid[j + 1][k + 1], grid[j + 1][k]))
    Minv = M.inverted()
    def uv(co, n):
        p = Minv @ co
        return (0.02 + 0.96 * (p.x / w + 0.5), 0.02 + 0.96 * (p.y / h + 0.5))
    emit(bm, 'screen', M, tint, uvfn=uv, uvofs=(mode, i), smooth=True)

def reel(M, r, speed_kind):
    """A tape-reel flange (local XY, facing +Z). The game spins its spokes in the shader."""
    i = _ids['reel']
    _ids['reel'] += 1
    bm = bmesh.new()
    n = 32
    c = bm.verts.new((0, 0, 0))
    ring = [bm.verts.new((math.cos(2 * PI * k / n) * r, math.sin(2 * PI * k / n) * r, 0)) for k in range(n)]
    for k in range(n):
        bm.faces.new((c, ring[k], ring[(k + 1) % n]))
    Minv = M.inverted()
    emit(bm, 'reels', M, WHITE, uvfn=local_uv(Minv, 2 * r), uvofs=(i, speed_kind))

def Mg(g, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0):
    """World matrix of a point in a G frame (with extra local rotations)."""
    x, y, z = g.p(lx, ly, lz)
    return xf(x, y, z, g.ry + ry, rx, rz)

def hatch_rot(n=4):
    """Hatch-local (u, v, r) -> model: local +Z (r) is the wall's outward normal at HATCH_A, +X the viewer's right."""
    return Matrix.Rotation(PI - D(HATCH_A), n, 'Y')

def hatch_m(u, v, r, rx=0.0, rz=0.0):
    return hatch_rot() @ Matrix.Translation((u, v, r)) @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(rz, 4, 'Z')

# ============================================================================ base, drum, door, windows
def build_shell():
    set_origin(0, 0, 0)
    # Stone plinth with a ledge, and a step up to the door.
    emit(bm_ring(R_OUT - 0.2, R_OUT + 0.45, -0.35, FL - 0.02, 96), 'stone', None, WHITE, 1.2, uvfn=cyl_uv(R_OUT + 0.45, 1.2), smooth=SIDES)
    BOX('stone', -0.95, -0.25, -(R_OUT + 0.98), 0.95, 0.14, -(R_OUT + 0.4), tile=1.0, col=True)
    for i in range(48):
        a = 2 * PI * (i + 0.5) / 48
        x, _, z = pol(R_OUT + 0.22, a)
        C(x, (-0.35 + FL - 0.02) / 2, z, 2 * PI * (R_OUT + 0.22) / 48 + 0.05, FL - 0.02 + 0.35, 0.5, -a)
    # Floor: old pine boards, a checker-plate ring around the pier.
    emit(bm_cyl(R_IN + 0.08, R_IN + 0.08, FL, 96), 'wood_floor', xf(0, FL / 2, 0), PINEOLD, (2.4, 1.2), 0)
    emit(bm_ring(0.78, 1.65, FL - 0.01, FL + 0.012, 64), 'plate', None, WHITE, 0.6)
    for (w, d) in ((10.2, 2.0), (9.0, 5.0), (7.0, 7.4), (5.0, 9.0), (2.0, 10.2)):
        C(0, FL / 2 - 0.2, 0, w, FL + 0.4, d)

    # Drum wall: stucco over a ring, cut for the door and the clerestory windows.
    bm = bm_ring(R_IN, R_OUT, FL - 0.02, WALL_TOP, 144)
    cuts = [((DOOR_W, 0, 0), (1, 0, 0)), ((-DOOR_W, 0, 0), (1, 0, 0)), ((0, DOOR_H, 0), (0, 1, 0)),
            ((0, WIN_Y0, 0), (0, 1, 0)), ((0, WIN_Y1, 0), (0, 1, 0))]
    for wa in WINDOWS:
        a = D(wa)
        t = Vector((math.cos(a), 0, math.sin(a)))
        cuts += [(tuple(t * WIN_W), tuple(t)), (tuple(-t * WIN_W), tuple(t))]
    for co, no in cuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=co, plane_no=no)
    # The rear hatch's square cut, through the outer skin only (build_hatch lines it). Only the faces round it are
    # cut, not whole loops round the drum.
    Rh = hatch_rot(3)
    tu = Rh @ Vector((1, 0, 0))
    for co, no in ((tuple(tu * HATCH_HW), tuple(tu)), (tuple(-tu * HATCH_HW), tuple(tu)),
                   ((0, HATCH_Y0, 0), (0, 1, 0)), ((0, HATCH_Y0 + 2 * HATCH_HW, 0), (0, 1, 0))):
        fs = []
        for f in bm.faces:
            hl = Rh.transposed() @ f.calc_center_median()
            if hl.z > (R_IN + R_OUT) / 2 and abs(hl.x) < 0.3 and hl.y < WIN_Y0:
                fs.append(f)
        geom = fs + list({e for f in fs for e in f.edges}) + list({v for f in fs for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.x) < DOOR_W and c.y < DOOR_H and c.z < 0:
            kill.append(f)
            continue
        hl = Rh.transposed() @ c
        if abs(hl.x) < HATCH_HW and HATCH_Y0 < c.y < HATCH_Y0 + 2 * HATCH_HW and hl.z > (R_IN + R_OUT) / 2:
            kill.append(f)
            continue
        for wa in WINDOWS:
            a = D(wa)
            t = Vector((math.cos(a), 0, math.sin(a)))
            rd = Vector((math.sin(a), 0, -math.cos(a)))
            if abs(c.dot(t)) < WIN_W and WIN_Y0 < c.y < WIN_Y1 and c.dot(rd) > 0:
                kill.append(f)
                break
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    # Weathering: darker toward the ground and under each window.
    def weather(co):
        k = 0.8 + 0.2 * smooth01(0.2, 1.4, co.y)
        a = math.atan2(co.x, -co.z)
        for wa in WINDOWS:
            da = abs((a - D(wa) + PI) % (2 * PI) - PI) * R_OUT
            if da < WIN_W + 0.05 and co.y < WIN_Y0:
                k *= 1.0 - 0.07 * (1 - smooth01(0, WIN_W + 0.05, da)) * smooth01(0.4, WIN_Y0, co.y)
        return (k, k * 0.99, k * 0.97)
    emit(bm, 'plaster', None, CREAMP, 1.6, uvfn=cyl_uv(R_OUT, 1.6), colfn=weather, smooth=SIDES)
    # Belt course and the cornice the dome rides on.
    emit(bm_ring(R_OUT - 0.01, R_OUT + 0.06, 2.22, 2.3, 144), 'plaster', None, mul(CREAMP, 0.95), 1.6, uvfn=cyl_uv(R_OUT, 1.6), smooth=SIDES)
    emit(bm_ring(R_IN + 0.05, R_OUT + 0.14, WALL_TOP, WALL_TOP + 0.07, 144), 'steel', None, GUNMETAL, 0.5, uvfn=cyl_uv(R_OUT, 0.5), smooth=SIDES)
    emit(bm_ring(R_OUT + 0.1, R_OUT + 0.16, WALL_TOP - 0.12, WALL_TOP + 0.07, 144), 'steel', None, GUNMETAL, 0.5, uvfn=cyl_uv(R_OUT, 0.5), smooth=SIDES)
    # Wall colliders (gap at the door).
    for i in range(60):
        a = 2 * PI * (i + 0.5) / 60
        x, _, z = pol((R_IN + R_OUT) / 2, a)
        if abs(x) < DOOR_W + 0.1 and z < 0:
            continue
        C(x, 2.0, z, 2 * PI * (R_IN + R_OUT) / 2 / 60 + 0.06, 4.0, R_OUT - R_IN + 0.05, -a)

    # Door frame, threshold, lintel; the riveted steel door stands open against the wall.
    zi, zo = -(R_IN - 0.08), -(R_OUT + 0.06)
    for s in (-1, 1):
        BOX('metal_black', s * DOOR_W - 0.05, FL - 0.02, zo, s * DOOR_W + 0.05, DOOR_H + 0.06, zi, tint=BLACK)
        BOX('metal_black', s * (DOOR_W + 0.05), FL + 0.4, zo - 0.03, s * (DOOR_W + 0.12), FL + 0.43, zo + 0.02, tint=BLACK)
    BOX('metal_black', -DOOR_W - 0.05, DOOR_H - 0.04, zo, DOOR_W + 0.05, DOOR_H + 0.1, zi, tint=BLACK)
    BOX('steel', -DOOR_W, FL - 0.03, zo - 0.02, DOOR_W, FL + 0.012, zi, tint=GUNMETAL)
    hinge = Vector((DOOR_W + 0.06, 0, -(R_OUT + 0.08)))
    u = Vector((0.42, 0, -1)).normalized()
    beam('painted', tuple(hinge + Vector((0, FL + 0.03 + 1.1, 0))), tuple(hinge + u * 1.34 + Vector((0, FL + 0.03 + 1.1, 0))), 0.07, 2.18, OXBLOOD)
    mid = hinge + u * 0.67
    nrm = Vector((-u.z, 0, u.x))
    for side in (-1, 1):
        pc = mid + nrm * side * 0.04 + Vector((0, FL + 1.55, 0))
        emit(bm_torus(0.17, 0.022, 28, 6), 'brass', xf(pc.x, pc.y, pc.z, math.atan2(u.x, u.z) + PI / 2, PI / 2, 0), WHITE, 1.0, None, None, True)
        for k in range(10):   # rivet rows along the leaf edges
            for e in (-0.6, 0.6):
                rp = mid + u * e + nrm * side * 0.038 + Vector((0, FL + 0.2 + k * 0.2, 0))
                SPH('painted', 0.013, rp.x, rp.y, rp.z, 6, 4, tint=mul(OXBLOOD, 0.8))
    pc = mid + Vector((0, FL + 1.55, 0))
    emit(bm_cyl(0.16, 0.16, 0.012, 24), 'glass', xf(pc.x, pc.y, pc.z, math.atan2(u.x, u.z), 0, PI / 2))
    lp = hinge + u * 1.2 + nrm * 0.07 + Vector((0, FL + 1.1, 0))
    B('metal_black', 0.03, 0.26, 0.04, lp.x, lp.y, lp.z, math.atan2(u.x, u.z), tint=BLACK)
    C(*(hinge + u * 0.67 + Vector((0, 1.3, 0))), 1.4, 2.6, 0.12, math.atan2(u.x, u.z) + PI / 2)
    # Canopy over the door, on two brackets, and a caged lamp.
    emit(bm_prism([(-(R_OUT + 0.02), 2.98), (-(R_OUT + 0.95), 2.84), (-(R_OUT + 0.95), 2.9), (-(R_OUT + 0.02), 3.04)], -1.05, 1.05, 'z'), 'metal_black', None, BLACK)
    for s in (-1, 1):
        emit(bm_prism([(-(R_OUT - 0.02), 2.95), (-(R_OUT + 0.8), 2.86), (-(R_OUT - 0.02), 2.45)], s * 0.95 - 0.02, s * 0.95 + 0.02, 'z'), 'metal_black', None, BLACK)
    CYL('metal_black', 0.07, 0.09, 0.05, 0, 2.78, -(R_OUT + 0.25), 12, tint=BLACK)
    SPH('emissive', 0.05, 0, 2.7, -(R_OUT + 0.25), 10, 8)
    emit(bm_torus(0.07, 0.006, 16, 4), 'metal_black', xf(0, 2.7, -(R_OUT + 0.25)), BLACK)
    emit(bm_torus(0.07, 0.006, 16, 4), 'metal_black', xf(0, 2.7, -(R_OUT + 0.25), 0, 0, PI / 2), BLACK)

    # Clerestory windows: steel frames, stone sills, three lights each.
    for wa in WINDOWS:
        g = wall_g(wa, (R_IN + R_OUT) / 2)
        dep = R_OUT - R_IN + 0.12
        for s in (-1, 1):
            g.box('metal_black', 0.07, WIN_Y1 - WIN_Y0 + 0.1, dep, s * WIN_W, (WIN_Y0 + WIN_Y1) / 2, 0, tint=BLACK)
        g.box('metal_black', 2 * WIN_W + 0.14, 0.08, dep, 0, WIN_Y1 + 0.02, 0, tint=BLACK)
        g.box('stone', 2 * WIN_W + 0.3, 0.07, dep + 0.2, 0, WIN_Y0 - 0.02, -0.08, tint=WHITE)
        for k in (1, 2):
            g.box('metal_black', 2 * WIN_W, 0.025, 0.04, 0, WIN_Y0 + (WIN_Y1 - WIN_Y0) * k / 3, 0, tint=BLACK)
        x0, y0, z0 = g.p(-WIN_W, WIN_Y0, 0)
        x1, y1, z1 = g.p(WIN_W, WIN_Y1, 0)
        emit(bm_poly([(x0, WIN_Y0, z0), (x1, WIN_Y0, z1), (x1, WIN_Y1, z1), (x0, WIN_Y1, z0)]), 'glass')

    # Internal ring gear on the wall top: the dome's drive pinions roll around it.
    emit(bm_gear(RING_N, RING_M, 0.08, 0, internal=True, outer_r=R_IN + 0.12), 'steel', xf(0, WALL_TOP + 0.045, 0, 0, -PI / 2, 0), GUNMETAL, 0.4)
    # Bogie wheels carrying the dome.
    for i in range(16):
        a = 2 * PI * (i + 0.5) / 16
        x, _, z = pol(R_OUT - 0.1, a)
        CYL('steel', 0.07, 0.07, 0.06, x, WALL_TOP + 0.15, z, 14, ry=-a, rz=PI / 2, tint=STEELG)
        for sd in (-1, 1):
            q = pol(R_OUT - 0.1, a + sd * 0.012)
            B('steel', 0.02, 0.1, 0.12, q[0], WALL_TOP + 0.12, q[2], -a, tint=GUNMETAL)

# ============================================================================ rotating dome
RING_N, RING_M = 200, 0.05            # static internal ring gear on the wall top (pitch r = 5.0)
DRIVE_N = 14                          # dome drive pinions
AZ_RING_N, AZ_M, AZ_PIN_N = 64, 0.025, 16    # pier azimuth gear and its pinion
SECTOR_N, SECTOR_M, ALT_PIN_N = 66, 0.03, 14  # telescope altitude sector and its pinion

def in_slit(p, margin=0.0):
    return abs(p.x) < SLIT + margin and p.z < SLIT_END_Z

def sphere_pt(r, lon, lat):
    """lon: 0 at -Z, clockwise from above; lat: 0 at the base, 90 deg at the zenith."""
    return Vector((math.sin(lon) * math.cos(lat) * r, DC + math.sin(lat) * r, -math.cos(lon) * math.cos(lat) * r))

def build_dome():
    set_origin(0, 0, 0)
    part('Dome', (0, DC, 0), axis=(0, 1, 0), driver='yaw', ratio=1.0)
    with into('Dome'):
        # Shell: outer skin (paint + rivets) and an inner skin a few cm inside, both cut by the slit.
        for (r, inner) in ((RD, False), (RD - 0.05, True)):
            bm = bmesh.new()
            nl, nt = 96, 26
            rows = []
            for j in range(nt + 1):
                lat = (PI / 2 - 0.004) * j / nt
                rows.append([bm.verts.new(sphere_pt(r, 2 * PI * i / nl, lat)) for i in range(nl)])
            for j in range(nt):
                for i in range(nl):
                    k = (i + 1) % nl
                    bm.faces.new((rows[j][i], rows[j][k], rows[j + 1][k], rows[j + 1][i]))
            top = bm.verts.new((0, DC + r, 0))
            for i in range(nl):
                bm.faces.new((rows[nt][i], rows[nt][(i + 1) % nl], top))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            for co, no in (((SLIT, 0, 0), (1, 0, 0)), ((-SLIT, 0, 0), (1, 0, 0)), ((0, 0, SLIT_END_Z), (0, 0, 1))):
                bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=co, plane_no=no)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if in_slit(f.calc_center_median())], context='FACES')
            if inner:
                bmesh.ops.reverse_faces(bm, faces=bm.faces)
            emit(bm, 'dome', None, mul(DOMEWHITE, 0.82 if inner else 1.0), uvfn=dome_uv, smooth=True)
        # Skirt covering the joint with the drum, and the base ring girder inside.
        emit(bm_ring(RD - 0.07, RD + 0.03, DC - 0.28, DC + 0.1, 128), 'dome', None, mul(DOMEWHITE, 0.92), uvfn=dome_uv, smooth=SIDES)
        emit(bm_ring(R_OUT - 0.2, RD - 0.1, DC + 0.08, DC + 0.32, 128), 'steel', None, GUNMETAL, 0.5, uvfn=cyl_uv(RD, 0.5), smooth=SIDES)
        # Outer ribs along the gore seams, cut short by the slit.
        for k in range(24):
            lon = D(15 * k)
            pts = []
            for j in range(0, 60):
                p = sphere_pt(RD, lon, D(88.5) * j / 59)
                if in_slit(p, 0.14):
                    break
                pts.append(p)
            if len(pts) > 2:
                emit(bm_sweep(pts, rect_section(0.07, 0.045), up=lambda p: (p - Vector((0, DC, 0))).normalized()), 'dome', None, mul(DOMEWHITE, 0.95), uvfn=dome_uv)
        # Latitude bands.
        for lat_d in (32, 60):
            lat = D(lat_d)
            rho = RD * math.cos(lat)
            a0 = math.asin(min(1.0, (SLIT + 0.14) / rho)) if rho > SLIT + 0.14 else 0.0
            pts = [sphere_pt(RD, a0 + (2 * PI - 2 * a0) * i / 90, lat) for i in range(91)]
            pts = [p for p in pts if not in_slit(p, 0.14)]
            emit(bm_sweep(pts, rect_section(0.06, 0.04), up=lambda p: (p - Vector((0, DC, 0))).normalized()), 'dome', None, mul(DOMEWHITE, 0.95), uvfn=dome_uv)
        # Slit arches: box girders on both sides, through the shell, over the top and down the back
        # (the shutter's rails).
        rho = math.sqrt((RD + 0.1) ** 2 - SLIT ** 2)
        for s in (-1, 1):
            x = s * (SLIT + 0.07)
            pts = [Vector((x, DC + math.sin(t) * rho, -math.cos(t) * rho)) for t in [PI * i / 72 for i in range(73)]]
            up = lambda p: Vector((0, p.y - DC, p.z)).normalized()
            emit(bm_sweep(pts, [(-0.07, -0.42), (0.07, -0.42), (0.07, 0.24), (-0.07, 0.24)], up=up), 'steel', None, mul(DOMEWHITE, 0.9), 0.5)
            emit(bm_sweep(pts, [(-0.1, 0.24), (0.1, 0.24), (0.1, 0.28), (-0.1, 0.28)], up=up), 'steel', None, GUNMETAL, 0.5)
        # The upper shutter, rolled back over the rear of the dome, with its ribs and a beacon.
        rs = RD + 0.42
        bm = bmesh.new()
        nx, na = 10, 18
        a0, a1 = D(116), D(170)
        grid = []
        for j in range(na + 1):
            t = a0 + (a1 - a0) * j / na
            row = []
            for i in range(nx + 1):
                x = -SLIT - 0.2 + (2 * SLIT + 0.4) * i / nx
                rr = math.sqrt(rs * rs - x * x)
                row.append(bm.verts.new((x, DC + math.sin(t) * rr, -math.cos(t) * rr)))
            grid.append(row)
        for j in range(na):
            for i in range(nx):
                bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.04)
        emit(bm, 'dome', None, mul(DOMEWHITE, 0.97), uvfn=dome_uv, smooth=True)
        for t in (D(122), D(143), D(164)):
            pts = []
            for i in range(13):
                x = -SLIT - 0.2 + (2 * SLIT + 0.4) * i / 12
                rr = math.sqrt((rs + 0.02) ** 2 - x * x)
                pts.append(Vector((x, DC + math.sin(t) * rr, -math.cos(t) * rr)))
            emit(bm_sweep(pts, rect_section(0.07, 0.05), up=lambda p: Vector((0, p.y - DC, p.z)).normalized()), 'dome', None, mul(DOMEWHITE, 0.9), uvfn=dome_uv)
        bp = Vector((0, DC + math.sin(D(118)) * (rs + 0.05), -math.cos(D(118)) * (rs + 0.05)))
        CYL('metal_black', 0.05, 0.06, 0.12, bp.x, bp.y + 0.06, bp.z, 10, tint=BLACK)
        lamp(bp.x, bp.y + 0.16, bp.z, srgb(255, 40, 30), size=0.07, kind=2)

        # Inner arch ribs (I-sections) and the drive motors on the base ring.
        for k in range(12):
            lon = D(30 * k + 15)
            pts = []
            for j in range(0, 40):
                p = sphere_pt(RD - 0.06, lon, D(86) * j / 39)
                if in_slit(p, 0.2):
                    break
                pts.append(p)
            if len(pts) > 2:
                up = lambda p: (Vector((0, DC, 0)) - p).normalized()
                emit(bm_sweep(pts, [(-0.07, 0.0), (0.07, 0.0), (0.07, 0.03), (0.015, 0.03), (0.015, 0.15), (0.07, 0.15), (0.07, 0.18), (-0.07, 0.18), (-0.07, 0.15), (-0.015, 0.15), (-0.015, 0.03), (-0.07, 0.03)], up=up), 'steel', None, GUNMETAL, 0.5)
        pr = RING_M * RING_N / 2 - RING_M * DRIVE_N / 2
        for i, lon_d in enumerate((140, 220)):
            lon = D(lon_d)
            name = part('DomeDrive%d' % (i + 1), pol(pr, lon, WALL_TOP + 0.045), parent='Dome', axis=(0, 1, 0), driver='yaw', ratio=-RING_N / DRIVE_N)
            # Rest phase against the static ring (gear local angle alpha -> game (cos a, 0, -sin a)).
            x, _, z = pol(pr, lon)
            beta = math.atan2(-z, x)
            ph = gear_phase(RING_N, RING_M, 0.0, beta, DRIVE_N, internal=True)
            with into(name):
                gx, gy, gz = pol(pr, lon, WALL_TOP + 0.045)
                gear_at(bm_gear(DRIVE_N, RING_M, 0.08, 0.05), 'steel', xf(gx, gy, gz, 0, -PI / 2, 0), ph, STEELG)
                CYL('steel', 0.1, 0.1, 0.1, gx, gy + 0.08, gz, 14, tint=GUNMETAL)
            # Motor + gearbox hanging from the ring girder.
            g = wall_g(lon_d, pr, 0.0)
            g.box('painted', 0.34, 0.26, 0.3, 0, WALL_TOP + 0.3, 0.0, tint=MACHINE, bevel=0.02)
            g.cyl('painted', 0.13, 0.13, 0.46, 0.0, WALL_TOP + 0.58, 0.0, 16, tint=MACHINE)
            g.cyl('steel', 0.14, 0.14, 0.03, 0.0, WALL_TOP + 0.82, 0.0, 16, tint=GUNMETAL)
            g.box('steel', 0.26, 0.06, RD - pr - 0.2, 0, WALL_TOP + 0.44, -(RD - pr) / 2 + 0.05, tint=GUNMETAL)
            for sx in (-1, 1):
                g.cyl('metal_black', 0.018, 0.018, 0.3, sx * 0.1, WALL_TOP + 0.62, 0.14, 6, tint=BLACK)

        # ---- telescope mount (rides with the dome) ----
        CYL('steel', 0.74, 0.74, 0.13, 0, 2.385, 0, 48, tint=GUNMETAL)
        CYL('steel', 0.76, 0.76, 0.03, 0, 2.33, 0, 48, tint=STEELG)
        BOX('steel', -0.72, 2.45, -0.52, 0.72, 2.6, 0.52, tint=GUNMETAL, bevel=0.02)
        for s in (-1, 1):
            x0, x1 = s * 0.58, s * 0.7
            emit(bm_prism([(-0.5, 2.6), (0.5, 2.6), (0.22, PIV_Y + 0.24), (-0.22, PIV_Y + 0.24)], min(x0, x1), max(x0, x1), 'z'), 'steel', None, GUNMETAL, 0.4)
            emit(bm_prism([(-0.62, 2.6), (-0.5, 2.6), (-0.5, 3.1)], min(x0, x1) + 0.03, max(x0, x1) - 0.03, 'z'), 'steel', None, GUNMETAL, 0.4)
            emit(bm_prism([(0.5, 2.6), (0.62, 2.6), (0.5, 3.1)], min(x0, x1) + 0.03, max(x0, x1) - 0.03, 'z'), 'steel', None, GUNMETAL, 0.4)
            CYL('steel', 0.17, 0.17, 0.2, s * 0.64, PIV_Y, 0, 24, rz=PI / 2, tint=STEELG)
            CYL('brass', 0.12, 0.12, 0.22, s * 0.64, PIV_Y, 0, 20, rz=PI / 2)
            for k in range(8):   # bolt heads around the bearing
                a = 2 * PI * k / 8
                SPH('steel', 0.018, s * 0.755, PIV_Y + math.sin(a) * 0.145, math.cos(a) * 0.145, 6, 4, tint=GUNMETAL)
        # Azimuth pinion bracket + motor, meshing with the pier's ring gear.
        az_r = AZ_M * (AZ_RING_N + AZ_PIN_N) / 2
        BOX('steel', 0.5, 2.3, -0.12, az_r + 0.12, 2.36, 0.12, tint=GUNMETAL)
        CYL('painted', 0.1, 0.1, 0.3, az_r, 2.52, 0, 16, tint=MACHINE)
        CYL('steel', 0.11, 0.11, 0.03, az_r, 2.68, 0, 16, tint=GUNMETAL)
        name = part('AzPinion', (az_r, 2.24, 0), parent='Dome', axis=(0, 1, 0), driver='yaw', ratio=AZ_RING_N / AZ_PIN_N)
        ph = gear_phase(AZ_RING_N, AZ_M, 0.0, 0.0, AZ_PIN_N)   # pinion sits at local angle 0 (+X)
        with into(name):
            gear_at(bm_gear(AZ_PIN_N, AZ_M, 0.07, 0.03), 'steel', xf(az_r, 2.24, 0, 0, -PI / 2, 0), ph, STEELG)
            CYL('steel', 0.03, 0.03, 0.18, az_r, 2.32, 0, 10, tint=GUNMETAL)
        # Altitude pinion on the outside of the right fork arm, below the axis.
        sec_r = SECTOR_M * SECTOR_N / 2
        pin_r = SECTOR_M * ALT_PIN_N / 2
        py = PIV_Y - (sec_r + pin_r)
        name = part('AltPinion', (0.84, py, 0), parent='Dome', axis=(-1, 0, 0), driver='pitch', ratio=SECTOR_N / ALT_PIN_N)
        ph = gear_phase(SECTOR_N, SECTOR_M, 0.0, -PI / 2, ALT_PIN_N)
        with into(name):
            gear_at(bm_gear(ALT_PIN_N, SECTOR_M, 0.06, 0.03), 'steel', xf(0.84, py, 0, -PI / 2), ph, STEELG)
            CYL('steel', 0.035, 0.035, 0.26, 0.8, py, 0, 10, rz=PI / 2, tint=GUNMETAL)
        B('painted', 0.11, 0.3, 0.3, 0.745, py - 0.02, 0, tint=MACHINE, bevel=0.015)
        CYL('painted', 0.09, 0.09, 0.2, 0.7, py - 0.38, 0.05, 14, rz=PI / 2, tint=MACHINE)

# ============================================================================ telescope
def build_tube():
    set_origin(0, 0, 0)
    part('Tube', (0, PIV_Y, 0), parent='Dome', axis=(1, 0, 0), driver='pitch', ratio=1.0)
    # Tube axis runs along -Z at rest; build along +Y and turn with Rx(-90 deg).
    R = lambda: xf(0, PIV_Y, 0, 0, -PI / 2, 0)
    def tube_uv(co, n):
        p = Vector((co.x, co.y - PIV_Y, co.z))
        if abs(n.z) > 0.8:
            return (p.x, p.y)
        a = math.atan2(p.x, p.y)
        an = math.atan2(n.x, n.y)
        if a - an > PI:
            a -= 2 * PI
        elif an - a > PI:
            a += 2 * PI
        return (a * 0.37 / 0.9, -p.z / 0.9)
    with into('Tube'):
        prof = [(0.0, -TUBE_R - 0.05), (0.22, -TUBE_R - 0.05), (0.33, -TUBE_R + 0.06), (0.34, -TUBE_R + 0.1),
                (0.35, 0.0), (0.37, TUBE_F - 1.1)]
        emit(bm_lathe(prof, 40), 'tube', R(), TEAL, uvfn=tube_uv, smooth=True)
        emit(bm_lathe([(0.37, TUBE_F - 1.12), (0.44, TUBE_F - 1.1), (0.44, TUBE_F), (0.425, TUBE_F), (0.425, TUBE_F - 1.02)], 40), 'tube', R(), mul(TEAL, 0.9), uvfn=tube_uv, smooth=True)
        # Objective: a dark lens behind glass, in a brass cell.
        emit(bm_cyl(0.37, 0.37, 0.01, 40), 'metal_black', R() @ Matrix.Translation((0, TUBE_F - 1.05, 0)), mul(BLACK, 0.4))
        emit(bm_cyl(0.37, 0.37, 0.01, 40), 'glass', R() @ Matrix.Translation((0, TUBE_F - 1.03, 0)))
        emit(bm_torus(0.4, 0.035, 40, 8), 'brass', R() @ Matrix.Translation((0, TUBE_F - 1.02, 0)), WHITE, 1.0, None, None, True)
        emit(bm_torus(0.44, 0.022, 40, 6), 'brass', R() @ Matrix.Translation((0, TUBE_F, 0)), WHITE, 1.0, None, None, True)
        # Brass bands.
        for y in (-0.95, -0.45, 1.2, 2.3, TUBE_F - 1.12):
            rr = 0.35 + 0.02 * max(0.0, y) / TUBE_F + 0.018
            emit(bm_cyl(rr, rr, 0.07, 40), 'brass', R() @ Matrix.Translation((0, y, 0)), WHITE, 1.0, None, None, True)
        # Cradle ring and trunnions (the right one carries the altitude sector).
        emit(bm_cyl(0.42, 0.42, 0.38, 40), 'steel', R(), GUNMETAL, 0.5)
        for s in (-1, 1):
            CYL('steel', 0.1, 0.1, 0.22 if s < 0 else 0.5, s * (0.5 if s < 0 else 0.64), PIV_Y, 0, 16, rz=PI / 2, tint=STEELG)
        # Altitude sector gear: arc from straight down toward the rear (local XY -> game ZY via Ry(-90)).
        sec_r = SECTOR_M * SECTOR_N / 2
        Ms = xf(0.84, PIV_Y, 0, -PI / 2)
        emit(bm_sector_gear(SECTOR_N, SECTOR_M, 0.06, sec_r - 0.13, D(-104), D(-10)), 'brass', Ms, WHITE, 0.3)
        for a_d in (-100, -57, -14):
            a = D(a_d)
            p0 = Ms @ Vector((math.cos(a) * 0.1, math.sin(a) * 0.1, 0))
            p1 = Ms @ Vector((math.cos(a) * (sec_r - 0.12), math.sin(a) * (sec_r - 0.12), 0))
            beam('brass', tuple(p0), tuple(p1), 0.035, 0.05, WHITE)
        emit(bm_cyl(0.13, 0.13, 0.08, 24), 'brass', Ms @ Matrix.Rotation(PI / 2, 4, 'X'), WHITE, 1.0, None, None, True)
        # Rear: end cap, focuser, star diagonal, eyepiece, and a 70s photometer box with its cable.
        zr = TUBE_R + 0.05
        CYL('brass', 0.075, 0.075, 0.34, 0, PIV_Y, zr + 0.15, 20, rx=PI / 2)
        CYL('brass', 0.085, 0.085, 0.05, 0, PIV_Y, zr + 0.05, 20, rx=PI / 2)
        for s in (-1, 1):
            CYL('brass', 0.03, 0.03, 0.1, s * 0.12, PIV_Y, zr + 0.08, 12, rz=PI / 2)
            CYL('metal_black', 0.045, 0.045, 0.04, s * 0.18, PIV_Y, zr + 0.08, 16, rz=PI / 2, tint=BLACK)
        B('metal_black', 0.14, 0.14, 0.14, 0, PIV_Y, zr + 0.38, tint=BLACK, bevel=0.01)
        CYL('brass', 0.035, 0.035, 0.16, 0, PIV_Y + 0.14, zr + 0.38, 16)
        CYL('rubber', 0.045, 0.04, 0.05, 0, PIV_Y + 0.24, zr + 0.38, 16, tint=BLACK)
        B('painted', 0.28, 0.2, 0.3, 0, PIV_Y + 0.47, 0.75, tint=PUTTY, bevel=0.015)
        B('steel', 0.2, 0.1, 0.06, 0, PIV_Y + 0.36, 0.75, tint=GUNMETAL)
        for k in range(3):
            lamp(-0.08 + k * 0.08, PIV_Y + 0.47, 0.905, srgb(255, 150, 40) if k != 1 else srgb(80, 255, 90), kind=1 + (k == 2) * 2)
        TUBE('rubber', [(0.12, PIV_Y + 0.45, 0.62), (0.26, PIV_Y + 0.4, 0.45), (0.36, PIV_Y + 0.2, 0.3), (0.4, PIV_Y + 0.02, 0.15)], 0.018, 6, tint=BLACK)
        # Finder scope on two rings.
        fy = PIV_Y + 0.56
        CYL('brass', 0.07, 0.07, 1.5, 0, fy, -1.3, 20, rx=PI / 2)
        CYL('brass', 0.085, 0.07, 0.25, 0, fy, -2.1, 20, rx=PI / 2)
        CYL('metal_black', 0.02, 0.02, 0.12, 0, fy, -0.5, 10, rx=PI / 2, tint=BLACK)
        for zz in (-1.8, -0.8):
            emit(bm_torus(0.085, 0.014, 20, 6), 'steel', xf(0, fy, zz, 0, PI / 2, 0), GUNMETAL)
            B('steel', 0.03, 0.17, 0.05, 0, PIV_Y + 0.43, zz, tint=GUNMETAL)
        # Counterweights under the rear.
        CYL('steel', 0.025, 0.025, 0.75, 0, PIV_Y - 0.5, 0.8, 10, rx=PI / 2, tint=STEELG)
        B('steel', 0.05, 0.22, 0.05, 0, PIV_Y - 0.44, 0.5, tint=GUNMETAL)
        for zz in (0.92, 1.08):
            CYL('steel', 0.13, 0.13, 0.12, 0, PIV_Y - 0.5, zz, 24, rx=PI / 2, tint=GUNMETAL)

# ============================================================================ pier, floor gear, console
def build_pier():
    set_origin(0, 0, 0)
    part('Interior', (0, 0, 0), bake=True)
    with into('Interior'):
        emit(bm_cyl(0.6, 0.72, 1.86, 8), 'plaster', xf(0, FL + 0.93, 0, D(22.5)), CONCRETE, 0.8)
        CYL('steel', 0.86, 0.86, 0.08, 0, FL + 1.9, 0, 48, tint=GUNMETAL)
        CYL('steel', 0.74, 0.74, 0.05, 0, FL + 1.84, 0, 32, tint=STEELG)
        for k in range(16):
            a = 2 * PI * k / 16
            SPH('steel', 0.022, math.cos(a) * 0.8, FL + 1.945, math.sin(a) * 0.8, 6, 4, tint=GUNMETAL)
        C(0, FL + 1.0, 0, 1.25, 2.1, 1.25)
        C(0, FL + 1.0, 0, 1.25, 2.1, 1.25, PI / 4)
    # Static azimuth ring gear on the pier head.
    emit(bm_gear(AZ_RING_N, AZ_M, 0.08, 0.62), 'steel', xf(0, 2.24, 0, 0, -PI / 2, 0), STEELG, 0.4)

CONSOLE_A, CONSOLE_R = 215.0, 3.35
AZ_TURNS, ALT_TURNS = 6.0, 16.0    # handwheel turns per radian of dome / telescope

def handwheel(name, M, r, phase_drive):
    """A spoked brass handwheel with a crank, built in local XY (axis +Z, facing the operator)."""
    with into(name):
        emit(bm_torus(r, 0.017, 40, 8), 'brass', M @ Matrix.Rotation(PI / 2, 4, 'X'), WHITE, 1.0, None, None, True)
        for k in range(5):
            a = 2 * PI * k / 5 + phase_drive
            p0 = M @ Vector((math.cos(a) * 0.035, math.sin(a) * 0.035, -0.012))
            p1 = M @ Vector((math.cos(a) * (r - 0.012), math.sin(a) * (r - 0.012), 0.0))
            emit(bm_tube([tuple(p0), tuple((p0 + p1) / 2 + (M.to_3x3() @ Vector((0, 0, -0.006)))), tuple(p1)], 0.011, 6), 'brass', None, WHITE, 1.0, None, None, True)
        emit(bm_cyl(0.042, 0.045, 0.07, 20), 'brass', M @ Matrix.Rotation(PI / 2, 4, 'X'), WHITE, 1.0, None, None, True)
        emit(bm_cyl(0.022, 0.022, 0.02, 12), 'steel', M @ Matrix.Translation((0, 0, 0.045)) @ Matrix.Rotation(PI / 2, 4, 'X'), GUNMETAL)
        # Crank handle on the rim: a pin and a turned walnut grip.
        a = phase_drive + PI / 5
        hp = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        emit(bm_cyl(0.008, 0.008, 0.05, 8), 'steel', M @ Matrix.Translation(hp + Vector((0, 0, 0.025))) @ Matrix.Rotation(PI / 2, 4, 'X'), STEELG)
        emit(bm_lathe([(0.0, 0.0), (0.016, 0.0), (0.021, 0.03), (0.018, 0.07), (0.014, 0.095), (0.0, 0.1)], 14), 'wood', M @ Matrix.Translation(hp + Vector((0, 0, 0.045))) @ Matrix.Rotation(PI / 2, 4, 'X'), WALNUT, 0.2, None, None, True)

def gear_train(prefix, g, x0, side, driver, turns):
    """Handwheel -> pinion -> 40T gear + 12T pinion -> 36T gear, on the console's front plate.
    Ratios chain from the handwheel: angle = ratio * driver."""
    m = 0.008
    hy = 0.5
    zf = 0.235                               # front plate face
    ax = Vector((math.sin(g.ry), 0, math.cos(g.ry)))
    # Stage 0: handwheel + 12T pinion on one shaft.
    hub = Vector(g.p(x0, hy, 0))
    part(prefix + 'Wheel', tuple(hub), axis=tuple(ax), driver=driver, ratio=turns)
    handwheel(prefix + 'Wheel', Mg(g, x0, hy, 0.44), 0.2, 0.0)
    with into(prefix + 'Wheel'):
        gear_at(bm_gear(12, m, 0.03, 0.012), 'brass', Mg(g, x0, hy, zf + 0.05), 0.0, WHITE)
        emit(bm_cyl(0.012, 0.012, 0.22, 10), 'steel', Mg(g, x0, hy, zf + 0.12, 0, PI / 2), STEELG)
    # Stage 1: 40T meshing the pinion, compound 12T in front of it.
    b1 = D(100 if side < 0 else 80)
    c1 = (x0 + math.cos(b1) * m * 26, hy + math.sin(b1) * m * 26)
    ph1 = gear_phase(12, m, 0.0, b1, 40)
    part(prefix + 'Gear1', g.p(c1[0], c1[1], 0), axis=tuple(ax), driver=driver, ratio=-turns * 12 / 40)
    b2 = 0.0 if side < 0 else PI
    ph1b = 0.0
    with into(prefix + 'Gear1'):
        gear_at(bm_gear(40, m, 0.025, 0.1), 'brass', Mg(g, c1[0], c1[1], zf + 0.05), ph1, WHITE)
        for k in range(6):   # spokes inside the rim
            a = ph1 + 2 * PI * k / 6
            p0 = Mg(g, c1[0], c1[1], zf + 0.05) @ Vector((math.cos(a) * 0.02, math.sin(a) * 0.02, 0))
            p1 = Mg(g, c1[0], c1[1], zf + 0.05) @ Vector((math.cos(a) * 0.105, math.sin(a) * 0.105, 0))
            beam('brass', tuple(p0), tuple(p1), 0.014, 0.018, WHITE)
        emit(bm_cyl(0.028, 0.028, 0.05, 16), 'brass', Mg(g, c1[0], c1[1], zf + 0.06, 0, PI / 2), WHITE, 1.0, None, None, True)
        gear_at(bm_gear(12, m, 0.03, 0.012), 'brass', Mg(g, c1[0], c1[1], zf + 0.1), ph1b, WHITE)
        emit(bm_cyl(0.01, 0.01, 0.16, 8), 'steel', Mg(g, c1[0], c1[1], zf + 0.07, 0, PI / 2), STEELG)
    # Stage 2: 36T meshing the compound pinion, driving the output shaft into the console.
    c2 = (c1[0] + math.cos(b2) * m * 24, c1[1] + math.sin(b2) * m * 24)
    ph2 = gear_phase(12, m, ph1b, b2, 36)
    part(prefix + 'Gear2', g.p(c2[0], c2[1], 0), axis=tuple(ax), driver=driver, ratio=turns * 12 / 40 * 12 / 36)
    with into(prefix + 'Gear2'):
        gear_at(bm_gear(36, m, 0.025, 0.02), 'brass', Mg(g, c2[0], c2[1], zf + 0.1), ph2, WHITE)
        for k in range(4):
            a = ph2 + 2 * PI * k / 4 + 0.3
            SPH('steel', 0.009, *(Mg(g, c2[0], c2[1], zf + 0.115) @ Vector((math.cos(a) * 0.06, math.sin(a) * 0.06, 0))), 6, 4, tint=GUNMETAL)
        emit(bm_cyl(0.022, 0.022, 0.04, 14), 'brass', Mg(g, c2[0], c2[1], zf + 0.12, 0, PI / 2), WHITE, 1.0, None, None, True)
    # Bearing bosses on the plate for all three shafts.
    for (bx, by) in ((x0, hy), c1, c2):
        g.cyl('brass', 0.03, 0.034, 0.03, bx, by, zf + 0.012, 16, rx=PI / 2)

def on_panel(Mp, lx, lz, lift=0.026):
    """Frame on the sloped console panel: +Z is the panel normal, +Y runs up the slope."""
    return Mp @ Matrix.Translation((lx, lift, lz)) @ Matrix.Rotation(-PI / 2, 4, 'X')

def dial(name, Mp, lx, lz, driver, ratio):
    """Round gauge on the sloped panel: brass bezel, face from the poster atlas, a red needle part."""
    M = on_panel(Mp, lx, lz)
    emit(bm_cyl(0.085, 0.085, 0.02, 32), 'metal_black', M @ Matrix.Rotation(PI / 2, 4, 'X'), BLACK)
    face = bmesh.new()
    n = 32
    c = face.verts.new((0, 0, 0.011))
    ring = [face.verts.new((math.cos(2 * PI * k / n) * 0.072, math.sin(2 * PI * k / n) * 0.072, 0.011)) for k in range(n)]
    for k in range(n):
        face.faces.new((c, ring[k], ring[(k + 1) % n]))
    emit(face, 'poster', M, WHITE, uvfn=local_uv(M.inverted(), 0.144, region=REG_DIAL))
    emit(bm_torus(0.078, 0.009, 32, 6), 'brass', M @ Matrix.Translation((0, 0, 0.012)) @ Matrix.Rotation(PI / 2, 4, 'X'), WHITE, 1.0, None, None, True)
    axis = M.to_3x3() @ Vector((0, 0, 1))
    part(name, tuple(M @ Vector((0, 0, 0.018))), axis=tuple(axis), driver=driver, ratio=ratio)
    with into(name):
        emit(bm_prism([(-0.004, -0.012), (0.004, -0.012), (0.0015, 0.062), (-0.0015, 0.062)], 0.0, 0.003, 'x'), 'painted', M @ Matrix.Translation((0, 0, 0.016)), RED)
        emit(bm_cyl(0.008, 0.008, 0.006, 12), 'brass', M @ Matrix.Translation((0, 0, 0.02)) @ Matrix.Rotation(PI / 2, 4, 'X'), WHITE)

def build_console():
    a = D(CONSOLE_A)
    x, _, z = pol(CONSOLE_R, a)
    g = G(x, FL, z, PI - a)      # local +z faces the operator (away from the pier)
    with into('Interior'):
        for s in (-1, 1):
            g.put(bm_prism([(-0.32, 0.0), (0.32, 0.0), (0.25, 0.1), (0.21, 0.94), (-0.24, 0.94), (-0.28, 0.1)], s * 0.72 - 0.035, s * 0.72 + 0.035, 'z'), 'painted', 0, 0, 0, tint=MACHINE)
        g.box('painted', 1.4, 0.8, 0.46, 0, 0.52, -0.03, tint=MACHINE, bevel=0.02)
        g.box('painted', 1.44, 0.1, 0.52, 0, 0.1, -0.02, tint=mul(MACHINE, 0.8))
        g.box('metal_black', 1.4, 0.64, 0.02, 0, 0.6, 0.225, tint=PANELBLK)
        for s in (-1, 1):
            for yy in (0.33, 0.87):
                g.cyl('brass', 0.012, 0.012, 0.012, s * 0.66, yy, 0.24, 8, rx=PI / 2)
        # Sloped instrument panel on top.
        tilt = D(28)
        g.put(bm_box(1.5, 0.05, 0.56, 0.01), 'painted', 0, 0.97, 0.0, rx=tilt, tint=MACHINE)
        g.put(bm_box(1.3, 0.012, 0.42, 0.0), 'metal_black', 0, 0.998, 0.0, rx=tilt, tint=PANELBLK)
        Mp = Mg(g, 0, 0.97, 0, 0, tilt)
        for k in range(7):
            lamp(0, 0, 0, [srgb(255, 60, 40), srgb(255, 180, 40), srgb(80, 255, 110)][k % 3], M=on_panel(Mp, -0.27 + k * 0.09, -0.12, 0.012), kind=[0, 1, 3][k % 3])
        for k in range(4):
            M = on_panel(Mp, -0.2 + k * 0.13, 0.13, 0.006)
            emit(bm_box(0.03, 0.05, 0.02), 'metal_black', M, BLACK)
            emit(bm_cyl(0.006, 0.004, 0.06, 6), 'steel', M @ Matrix.Translation((0, 0.008, 0.03)) @ Matrix.Rotation(0.5 - PI / 2, 4, 'X'), STEELG)
        g.col(1.55, 1.05, 0.62, 0, 0.52, 0)
    Mp = Mg(g, 0, 0.97, 0, 0, D(28))
    dial('AzNeedle', Mp, -0.38, -0.02, 'yaw', -1.0)
    dial('AltNeedle', Mp, 0.38, -0.02, 'pitch', -2.2)
    gear_train('Az', g, -0.38, -1, 'yaw', AZ_TURNS)
    gear_train('Alt', g, 0.38, 1, 'pitch', ALT_TURNS)
    with into('Interior'):
        # Armored conduit from the console to the pier, along the floor.
        p0 = Vector(g.p(0, 0.05, -0.2))
        pts = [p0, p0 * 0.75 + Vector((0, 0.0, 0)), Vector((p0.x * 0.35, FL + 0.04, p0.z * 0.35)), Vector((p0.x * 0.22, FL + 0.3, p0.z * 0.22))]
        pts[1].y = FL + 0.035
        TUBE('rubber', [tuple(p) for p in pts], 0.035, 8, tint=BLACK)

def build_viewer():
    """The periscope eyepiece: a brass column with training handles and a hooded eyepiece. Pressing it
    looks through the telescope."""
    a = D(236)
    x, _, z = pol(3.72, a)
    g = G(x, FL, z, PI - a)       # local +z faces the operator
    part('Viewer', g.p(0, 0, 0))
    with into('Viewer'):
        g.cyl('steel', 0.2, 0.24, 0.05, 0, 0.025, 0, 24, tint=GUNMETAL)
        for k in range(6):
            aa = 2 * PI * k / 6
            g.put(bm_sphere(0.014, 6, 4), 'steel', math.cos(aa) * 0.19, 0.055, math.sin(aa) * 0.19, tint=STEELG)
        g.cyl('brass', 0.065, 0.075, 1.42, 0, 0.76, 0, 24)
        for yy in (0.12, 0.5, 0.9, 1.32):
            g.cyl('brass', 0.082, 0.082, 0.03, 0, yy, 0, 24)
        g.cyl('metal_black', 0.1, 0.1, 0.08, 0, 1.2, 0, 24, tint=BLACK)          # azimuth collar
        for k in range(24):
            aa = 2 * PI * k / 24
            g.put(bm_box(0.004, 0.03 if k % 6 else 0.05, 0.006), 'brass', math.sin(aa) * 0.101, 1.2, math.cos(aa) * 0.101, ry=aa)
        # Head: prism housing, eyepiece + eyecup toward the operator, objective hood toward the pier.
        g.box('metal_black', 0.26, 0.2, 0.32, 0, 1.58, 0.0, tint=PANELBLK, bevel=0.025)
        g.box('brass', 0.28, 0.02, 0.34, 0, 1.48, 0.0)
        g.box('brass', 0.28, 0.02, 0.34, 0, 1.68, 0.0)
        g.cyl('brass', 0.05, 0.05, 0.12, 0, 1.63, 0.21, 20, rx=PI / 2)
        g.put(bm_lathe([(0.0, 0.0), (0.045, 0.0), (0.06, 0.05), (0.062, 0.08), (0.048, 0.085)], 20), 'rubber', 0, 1.63, 0.27, rx=PI / 2, tint=BLACK)
        g.put(bm_cyl(0.034, 0.034, 0.004, 20), 'glass', 0, 1.63, 0.335, rx=PI / 2)
        g.put(bm_lathe([(0.07, 0.0), (0.085, 0.14), (0.09, 0.15)], 20), 'metal_black', 0, 1.62, -0.16, rx=-PI / 2 - 0.35, tint=BLACK)
        g.put(bm_cyl(0.068, 0.068, 0.004, 20), 'glass', 0, 1.62 + 0.14 * math.sin(0.35), -0.16 - 0.14 * math.cos(0.35), rx=-PI / 2 - 0.35)
        # Knurled focusing wheel on top and training handles on both sides.
        g.cyl('steel', 0.055, 0.055, 0.03, 0, 1.71, 0.02, 24, tint=STEELG)
        for k in range(24):
            aa = 2 * PI * k / 24
            g.put(bm_box(0.006, 0.03, 0.006), 'steel', math.cos(aa) * 0.056, 1.71, 0.02 + math.sin(aa) * 0.056, tint=GUNMETAL)
        for s in (-1, 1):
            pts = [g.p(s * 0.13, 1.56, 0.02), g.p(s * 0.2, 1.56, 0.02), g.p(s * 0.24, 1.53, 0.02)]
            TUBE('steel', pts, 0.016, 8, tint=STEELG)
            g.put(bm_lathe([(0.0, 0.0), (0.022, 0.0), (0.026, 0.03), (0.024, 0.11), (0.018, 0.13), (0.0, 0.13)], 14), 'rubber', s * 0.24, 1.53, 0.02, rz=s * PI / 2, tint=BLACK)
        # A small lit reticle window and a tag lamp.
        lamp(0, 0, 0, srgb(255, 170, 60), M=Mg(g, 0.08, 1.6, 0.165), size=0.02, kind=1)
        g.col(0.5, 1.8, 0.5, 0, 0.9, 0)
    # Relay conduit to the pier (the optics run through it).
    with into('Interior'):
        p0 = Vector(g.p(0, 0.05, -0.1))
        TUBE('steel', [tuple(p0), (p0.x * 0.8, FL + 0.03, p0.z * 0.8), (p0.x * 0.3, FL + 0.03, p0.z * 0.3), (p0.x * 0.19, FL + 0.25, p0.z * 0.19)], 0.03, 8, tint=STEELG)
    empty('VIEWER_eye', g.p(0, 1.63, 0.45))

# ============================================================================ electronics
def rack(g, kind, idx):
    """A 70s equipment cabinet in local frame g (front +z, 0.6 wide, 2.0 tall, 0.64 deep)."""
    frame = [PUTTY, BEIGE][idx % 2]
    accent = [ORANGE70, MUSTARD, OLIVE70, ORANGE70, BROWN70][idx % 5]
    g.box('painted', 0.6, 1.96, 0.64, 0, 0.98, 0, tint=frame, bevel=0.01)
    g.box('painted', 0.62, 0.05, 0.66, 0, 1.985, 0, tint=BROWN70)
    g.box('metal_black', 0.58, 0.08, 0.02, 0, 0.05, 0.315, tint=BLACK)
    for k in range(7):   # louvred vents at the bottom
        g.box('painted', 0.46, 0.012, 0.03, 0, 0.18 + k * 0.035, 0.32, rx=-0.5, tint=mul(frame, 0.8))
    front = 0.322
    if kind == 'tape':
        g.box('painted', 0.54, 0.88, 0.02, 0, 1.46, front, tint=mul(PANELBLK, 1.2))
        for s in (-1, 1):
            cx = s * 0.135
            g.cyl('rubber', 0.1, 0.1, 0.02, cx, 1.66, front + 0.012, 28, rx=PI / 2, tint=BROWN70)
            reel(Mg(g, cx, 1.66, front + 0.026), 0.125, 0 if s < 0 else 1)
            g.cyl('steel', 0.022, 0.022, 0.03, cx, 1.66, front + 0.03, 12, rx=PI / 2, tint=STEELG)
        for (gx, gy) in ((0.0, 1.46), (-0.05, 1.36), (0.05, 1.36)):
            g.cyl('steel', 0.018, 0.018, 0.03, gx, gy, front + 0.02, 12, rx=PI / 2, tint=STEELG)
        g.box('metal_black', 0.18, 0.06, 0.02, 0, 1.28, front + 0.012, tint=BLACK)
        for s in (-1, 1):   # vacuum column windows
            g.box('painted', 0.08, 0.28, 0.012, s * 0.18, 1.2, front + 0.012, tint=mul(PANELBLK, 0.6))
        g.put(bm_box(0.54, 0.62, 0.008), 'glass', 0, 1.56, front + 0.06, tint=WHITE)
        for k in range(5):
            lamp(-0.16 + k * 0.08, 1.06, front + 0.014, [srgb(80, 255, 110), srgb(255, 180, 40), srgb(255, 60, 40)][k % 3], M=g_m(g), kind=[3, 1, 0, 3, 0][k])
        g.box('painted', 0.54, 0.24, 0.02, 0, 0.82, front, tint=accent)
        for k in range(4):
            g.cyl('metal_black', 0.022, 0.022, 0.03, -0.18 + k * 0.12, 0.82, front + 0.02, 12, rx=PI / 2, tint=BLACK)
    elif kind == 'lamps':
        g.box('metal_black', 0.54, 0.5, 0.02, 0, 1.64, front, tint=PANELBLK)
        cols = [srgb(255, 60, 40), srgb(255, 180, 40), srgb(80, 255, 110), srgb(255, 250, 220)]
        for r_ in range(8):
            for c_ in range(7):
                lamp(-0.21 + c_ * 0.07, 1.46 + r_ * 0.05, front + 0.014, cols[(r_ // 2) % 4], M=g_m(g), kind=0 if (r_ + c_) % 3 else 3)
        g.box('painted', 0.54, 0.3, 0.02, 0, 1.2, front, tint=accent)
        for r_ in range(2):
            for c_ in range(8):
                p = Mg(g, -0.21 + c_ * 0.06, 1.14 + r_ * 0.12, front + 0.012)
                emit(bm_box(0.018, 0.028, 0.012), 'metal_black', p, BLACK)
                emit(bm_cyl(0.004, 0.003, 0.03, 6), 'steel', p @ Matrix.Translation((0, 0.008 * (1 if (r_ + c_ * 3) % 2 else -1), 0.018)) @ Matrix.Rotation(0.5 if (r_ + c_ * 3) % 2 else -0.5, 4, 'X') @ Matrix.Rotation(PI / 2, 4, 'X'), STEELG)
        meters(g, 0.82, front, 2)
    elif kind == 'crt':
        g.box('painted', 0.54, 0.62, 0.02, 0, 1.58, front, tint=mul(PANELBLK, 1.3))
        g.box('painted', 0.4, 0.34, 0.06, 0, 1.64, front + 0.02, tint=GUNMETAL, bevel=0.02)
        screen(Mg(g, 0, 1.64, front + 0.052), 0.32, 0.26, 2, CYAN_P, 0.012)
        for k in range(5):
            g.cyl('metal_black', 0.02, 0.02, 0.03, -0.2 + k * 0.1, 1.38, front + 0.02, 12, rx=PI / 2, tint=BLACK)
            g.box('painted', 0.004, 0.012, 0.004, -0.2 + k * 0.1, 1.392, front + 0.036, tint=WHITE)
        meters(g, 1.1, front, 2)
        g.box('painted', 0.54, 0.28, 0.02, 0, 0.8, front, tint=accent)
    elif kind == 'patch':
        g.box('metal_black', 0.54, 0.44, 0.02, 0, 1.64, front, tint=PANELBLK)
        jacks = []
        for r_ in range(6):
            for c_ in range(10):
                jx, jy = -0.225 + c_ * 0.05, 1.47 + r_ * 0.066
                g.cyl('brass', 0.008, 0.008, 0.012, jx, jy, front + 0.014, 8, rx=PI / 2)
                jacks.append((jx, jy))
        colors = [srgb(190, 40, 30), srgb(230, 190, 40), srgb(40, 90, 180), srgb(20, 20, 20), srgb(230, 230, 220)]
        for k in range(9):
            a_ = jacks[(k * 7 + 3) % 60]
            b_ = jacks[(k * 13 + 17) % 60]
            p0 = Vector(g.p(a_[0], a_[1], front + 0.03))
            p1 = Vector(g.p(b_[0], b_[1], front + 0.03))
            sag = 0.08 + 0.05 * (k % 3)
            out = Vector(g.p(0, 0, 0.05)) - Vector(g.p(0, 0, 0))
            pts = []
            for i in range(9):
                t = i / 8
                q = p0.lerp(p1, t) + out * (math.sin(PI * t) * 0.8)
                q.y -= sag * math.sin(PI * t)
                pts.append(tuple(q))
            TUBE('rubber', pts, 0.006, 5, tint=colors[k % 5])
        for c_ in range(4):
            lamp(-0.18 + c_ * 0.12, 1.36, front + 0.014, srgb(255, 180, 40), M=g_m(g), kind=0)
        g.box('painted', 0.54, 0.46, 0.02, 0, 1.02, front, tint=accent)
        meters(g, 1.02, front + 0.01, 3)
    g.col(0.62, 2.0, 0.66, 0, 1.0, 0)

def g_m(g):
    return xf(g.x, g.y, g.z, g.ry)

def meters(g, y, front, n):
    """A row of rectangular panel meters (face from the atlas, black needle)."""
    for k in range(n):
        lx = (k - (n - 1) / 2) * 0.17
        M = Mg(g, lx, y, front + 0.02)
        emit(bm_box(0.15, 0.1, 0.03), 'metal_black', M, BLACK)
        emit(quad(0.13, 0.08, 0.016), 'poster', M, WHITE, uvfn=region_uv(M, 0.13, 0.08, REG_METER))
        ang = (k * 0.7 + 0.3) % 1.2 - 0.6
        emit(bm_box(0.002, 0.06, 0.002), 'metal_black', M @ Matrix.Translation((0, -0.035, 0.019)) @ Matrix.Rotation(-ang, 4, 'Z') @ Matrix.Translation((0, 0.03, 0)), BLACK)

def crt_monitor(g, lx, ly, lz, ry, mode, tint, w=0.46, h=0.4):
    """A boxy 70s terminal monitor: putty case, tapered back, bezel and a curved phosphor face."""
    M = Mg(g, lx, ly, lz, ry)
    emit(bm_box(w, h, 0.34, 0.03, 2), 'painted', M, PUTTY)
    emit(bm_prism([(-w * 0.35, -h * 0.35), (w * 0.35, -h * 0.35), (w * 0.3, h * 0.3), (-w * 0.3, h * 0.3)], -0.17, -0.42, 'x'), 'painted', M, mul(PUTTY, 0.9))
    emit(bm_box(w * 0.86, h * 0.78, 0.02), 'metal_black', M @ Matrix.Translation((0, h * 0.04, 0.168)), mul(PANELBLK, 0.7))
    screen(M @ Matrix.Translation((0, h * 0.04, 0.18)), w * 0.76, h * 0.64, mode, tint, 0.015)
    for k in range(3):
        emit(bm_cyl(0.012, 0.012, 0.02, 10), 'metal_black', M @ Matrix.Translation((w * 0.32 + 0.0 - k * 0.03, -h * 0.42, 0.17)) @ Matrix.Rotation(PI / 2, 4, 'X'), BLACK)
    lamp(0, 0, 0, srgb(80, 255, 110), M=M @ Matrix.Translation((-w * 0.38, -h * 0.42, 0.172)), size=0.012, kind=1)

def keyboard(g, lx, ly, lz, ry):
    M = Mg(g, lx, ly, lz, ry)
    emit(bm_box(0.5, 0.04, 0.2, 0.01), 'painted', M @ Matrix.Rotation(0.08, 4, 'X'), BEIGE)
    for r_ in range(4):
        for c_ in range(12):
            tint = BROWN70 if c_ in (0, 11) or r_ == 3 else mul(PUTTY, 0.95)
            wdt = 0.03 if not (r_ == 3 and 3 <= c_ <= 8) else 0.03
            emit(bm_box(wdt, 0.016, 0.03, 0.003), 'painted', M @ Matrix.Rotation(0.08, 4, 'X') @ Matrix.Translation((-0.2 + c_ * 0.0365, 0.024, -0.06 + r_ * 0.038)), tint)

def chair(x, z, ry, tint):
    g = G(x, FL, z, ry)
    for k in range(5):
        a = 2 * PI * k / 5
        p1 = g.p(math.cos(a) * 0.3, 0.07, math.sin(a) * 0.3)
        beam('metal_black', g.p(0, 0.09, 0), p1, 0.035, 0.03, BLACK)
        SPH('rubber', 0.028, p1[0], FL + 0.03, p1[2], 8, 6, tint=BLACK)
    g.cyl('steel', 0.025, 0.025, 0.36, 0, 0.27, 0, 10, tint=STEELG)
    g.cyl('metal_black', 0.045, 0.045, 0.12, 0, 0.14, 0, 12, tint=BLACK)
    g.box('leather', 0.48, 0.09, 0.46, 0, 0.49, 0, tint=tint, bevel=0.035, seg=2, smooth=True)
    g.box('leather', 0.44, 0.5, 0.08, 0, 0.84, -0.24, rx=-0.12, tint=tint, bevel=0.035, seg=2, smooth=True)
    g.box('metal_black', 0.05, 0.3, 0.03, 0, 0.6, -0.23, rx=-0.1, tint=BLACK)
    for s in (-1, 1):
        g.box('metal_black', 0.04, 0.03, 0.3, s * 0.25, 0.66, -0.02, tint=BLACK)
        g.box('metal_black', 0.03, 0.14, 0.03, s * 0.25, 0.58, 0.1, tint=BLACK)
    g.col(0.55, 1.0, 0.55, 0, 0.5, 0)

def desk_section(a_deg, i):
    g = wall_g(a_deg, 4.38)
    # Desk: laminate top with a walnut edge band, a drawer pedestal, the console riser at the back.
    g.box('painted', 1.26, 0.04, 0.76, 0, 0.74, 0.0, tint=BEIGE)
    g.box('wood', 1.28, 0.05, 0.03, 0, 0.735, 0.385, tint=WALNUT, grain=0)
    g.box('painted', 0.42, 0.72, 0.7, (-0.4 if i % 2 else 0.4), 0.36, 0.0, tint=[ORANGE70, OLIVE70, MUSTARD][i % 3], bevel=0.01)
    for k in range(3):
        g.box('metal_black', 0.18, 0.015, 0.012, (-0.4 if i % 2 else 0.4), 0.18 + k * 0.22, 0.356, tint=BLACK)
    g.box('painted', 0.03, 0.72, 0.7, (0.6 if i % 2 else -0.6), 0.36, 0.0, tint=BROWN70)
    g.box('painted', 1.2, 0.5, 0.02, 0, 0.45, -0.33, tint=BROWN70)
    g.box('painted', 1.2, 0.12, 0.34, 0, 0.82, -0.2, tint=mul(BROWN70, 1.1), bevel=0.01)
    g.col(1.3, 1.2, 0.8, 0, 0.6, 0)
    return g

def build_electronics():
    set_origin(0, 0, 0)
    with into('Interior'):
        # Rack bank against the wall (right of the door).
        kinds = ['lamps', 'tape', 'tape', 'crt', 'patch']
        for i, kd in enumerate(kinds):
            rack(wall_g(34 + i * 8.0, R_IN - 0.35), kd, i)
        # Main desk: three sections along the wall with terminals, a scope and a guider screen.
        gs = [desk_section(a_, i) for i, a_ in enumerate((108, 124, 140))]
        crt_monitor(gs[0], 0.05, 1.08, -0.2, 0, 0, GREEN_P)
        keyboard(gs[0], 0.05, 0.765, 0.16, 0)
        crt_monitor(gs[1], -0.25, 1.08, -0.2, 0.12, 4, CYAN_P)
        keyboard(gs[1], -0.2, 0.765, 0.16, 0.1)
        M = Mg(gs[1], 0.36, 1.01, -0.2)
        emit(bm_box(0.32, 0.26, 0.36, 0.01), 'painted', M, mul(GUNMETAL, 1.3))
        screen(M @ Matrix.Translation((-0.04, 0.02, 0.182)), 0.16, 0.13, 1, GREEN_P, 0.0)
        for k in range(4):
            emit(bm_cyl(0.012, 0.012, 0.02, 10), 'metal_black', M @ Matrix.Translation((0.11, 0.08 - k * 0.05, 0.18)) @ Matrix.Rotation(PI / 2, 4, 'X'), BLACK)
        crt_monitor(gs[2], 0.3, 1.08, -0.2, -0.12, 3, AMBER_P)
        keyboard(gs[2], 0.25, 0.765, 0.16, -0.08)
        # A telephone, papers, a mug, a gooseneck desk lamp.
        g = gs[2]
        g.box('painted', 0.2, 0.08, 0.22, -0.4, 0.8, 0.1, tint=ORANGE70, bevel=0.02)
        g.put(bm_tube([(-0.08, 0, 0), (-0.06, 0.04, 0), (0.06, 0.04, 0), (0.08, 0, 0)], 0.018, 8), 'painted', -0.4, 0.86, 0.1, tint=ORANGE70)
        for k in range(3):
            M = Mg(gs[k], [-0.45, 0.45, -0.15][k], 0.762 + 0.002 * k, 0.08, 0.2 * k - 0.2)
            Mf = M @ Matrix.Rotation(-PI / 2, 4, 'X')
            emit(quad(0.21, 0.296), 'poster', Mf, WHITE, uvfn=region_uv(Mf, 0.21, 0.296, REG_PAPER))
        g = gs[0]
        g.put(bm_lathe([(0.0, 0.0), (0.04, 0.0), (0.042, 0.1), (0.038, 0.1), (0.036, 0.004), (0.0, 0.004)], 16), 'ceramic', -0.42, 0.76, 0.12, tint=CREAMP)
        g.cyl('metal_black', 0.07, 0.08, 0.02, 0.5, 0.77, -0.05, 16, tint=BLACK)
        TUBE('metal_black', [g.p(0.5, 0.78, -0.05), g.p(0.5, 1.1, -0.05), g.p(0.45, 1.3, 0.05), g.p(0.38, 1.3, 0.18)], 0.01, 6, tint=BLACK)
        g.put(bm_lathe([(0.02, 0.0), (0.05, -0.03), (0.09, -0.12), (0.095, -0.13)], 16), 'painted', 0.38, 1.33, 0.18, rx=-0.4, tint=ORANGE70, smooth=True)
        SPH('emissive', 0.025, *g.p(0.38, 1.27, 0.2), 8, 6)
        chair(*pol(3.72, D(112))[::2], PI - D(112) + 0.25, ORANGE70)
        chair(*pol(3.65, D(136))[::2], PI - D(136) - 0.4, BROWN70)

        # Star chart between the rear windows, filing cabinets and a low shelf of binders.
        g = wall_g(180, R_IN - 0.03)
        g.box('wood', 1.06, 1.56, 0.03, 0, 1.8, 0.0, tint=WALNUT)
        M = Mg(g, 0, 1.8, 0.017)
        emit(quad(1.0, 1.5), 'poster', M, WHITE, uvfn=region_uv(M, 1.0, 1.5, REG_CHART))
        for (w_, h_, x_, y_) in ((1.08, 0.025, 0, 2.58), (1.08, 0.025, 0, 1.02), (0.025, 1.58, -0.53, 1.8), (0.025, 1.58, 0.53, 1.8)):
            g.box('metal_black', w_, h_, 0.04, x_, y_, 0.01, tint=BLACK)
        g2 = wall_g(180, R_IN - 0.22)
        g2.box('wood', 1.2, 0.8, 0.38, 0, 0.4, 0, tint=WALNUT)
        for k in range(14):
            bw = 0.06 + 0.02 * (k % 3)
            g2.box('painted', 0.05, 0.3, 0.26, -0.5 + k * 0.075, 0.95, 0.02, rz=0.0 if k % 5 else 0.12, tint=[ORANGE70, OLIVE70, BROWN70, MUSTARD, CREAMP][k % 5])
        g2.col(1.2, 1.2, 0.4, 0, 0.6, 0)
        for a_ in (166, 194):
            g = wall_g(a_, R_IN - 0.3)
            g.box('painted', 0.46, 1.32, 0.6, 0, 0.66, 0, tint=OLIVE70, bevel=0.01)
            for k in range(4):
                g.box('painted', 0.42, 0.28, 0.02, 0, 0.2 + k * 0.31, 0.3, tint=mul(OLIVE70, 1.08))
                g.box('steel', 0.12, 0.02, 0.03, 0, 0.3 + k * 0.31, 0.32, tint=STEELG)
            g.col(0.5, 1.4, 0.62, 0, 0.7, 0)

        # Workbench with a receiver, parts bins, a small scope screen and a stool.
        for a_ in (282, 300):
            g = wall_g(a_, R_IN - 0.4)
            g.box('wood', 1.3, 0.06, 0.66, 0, 0.9, 0, tint=OAK, grain=0)
            for sx in (-1, 1):
                for sz in (-1, 1):
                    g.box('metal_black', 0.04, 0.88, 0.04, sx * 0.6, 0.44, sz * 0.28, tint=BLACK)
            g.box('metal_black', 1.2, 0.03, 0.56, 0, 0.2, 0, tint=BLACK)
            g.box('wood', 1.3, 0.03, 0.26, 0, 1.55, -0.2, tint=OAK, grain=0)
            for sx in (-1, 1):
                g.box('metal_black', 0.03, 0.2, 0.2, sx * 0.55, 1.45, -0.22, tint=BLACK)
            for k in range(8):
                g.box('painted', 0.12, 0.1, 0.18, -0.52 + k * 0.15, 1.62, -0.2, tint=[srgb(40, 90, 180), srgb(190, 40, 30), MUSTARD, srgb(40, 90, 180)][k % 4], bevel=0.008)
            g.col(1.35, 1.0, 0.7, 0, 0.5, 0)
        g = wall_g(282, R_IN - 0.4)
        g.box('painted', 0.62, 0.26, 0.36, 0.1, 1.06, -0.08, tint=mul(GUNMETAL, 1.4), bevel=0.01)
        g.box('metal_black', 0.58, 0.22, 0.01, 0.1, 1.06, 0.105, tint=PANELBLK)
        for k in range(2):
            Mm = Mg(g, -0.05 + k * 0.17, 1.1, 0.1)
            emit(bm_box(0.15, 0.1, 0.02), 'metal_black', Mm, BLACK)
            emit(quad(0.13, 0.08, 0.011), 'poster', Mm, WHITE, uvfn=region_uv(Mm, 0.13, 0.08, REG_METER))
        for k in range(3):
            g.cyl('metal_black', 0.03, 0.03, 0.03, 0.25 + k * 0.05 - 0.05, 0.98, 0.11, 14, rx=PI / 2, tint=BLACK)
        lamp(0, 0, 0, srgb(255, 60, 40), M=Mg(g, -0.15, 0.98, 0.11), kind=1)
        g = wall_g(300, R_IN - 0.4)
        crt_monitor(g, 0.25, 1.1, -0.1, -0.2, 1, GREEN_P, 0.34, 0.3)
        g.box('painted', 0.3, 0.12, 0.2, -0.3, 0.99, 0.05, tint=MUSTARD, bevel=0.01)
        g.cyl('metal_black', 0.04, 0.05, 0.1, -0.1, 0.98, 0.1, 12, tint=BLACK)
        x_, _, z_ = pol(4.15, D(292))
        CYL('wood', 0.17, 0.17, 0.04, x_, FL + 0.66, z_, 20, tint=OAK)
        for k in range(3):
            aa = 2 * PI * k / 3
            beam('metal_black', (x_ + math.cos(aa) * 0.06, FL + 0.64, z_ + math.sin(aa) * 0.06), (x_ + math.cos(aa) * 0.2, FL, z_ + math.sin(aa) * 0.2), 0.025, 0.025, BLACK)
        C(x_, FL + 0.35, z_, 0.4, 0.7, 0.4)

        # Electrical panel by the door, fire extinguisher on the other side.
        g = wall_g(24, R_IN - 0.08)
        g.box('painted', 0.5, 0.72, 0.14, 0, 1.55, 0, tint=mul(GUNMETAL, 1.5), bevel=0.01)
        g.box('steel', 0.04, 0.12, 0.03, 0.18, 1.55, 0.08, tint=STEELG)
        g.cyl('steel', 0.03, 0.03, 1.2, 0.1, 2.5, -0.02, 8, tint=STEELG)
        x_, _, z_ = pol(R_IN - 0.18, D(338))
        CYL('painted', 0.075, 0.075, 0.5, x_, FL + 0.55, z_, 16, tint=RED)
        SPH('painted', 0.075, x_, FL + 0.8, z_, 12, 6, tint=RED)
        CYL('metal_black', 0.025, 0.025, 0.12, x_, FL + 0.9, z_, 10, tint=BLACK)

        # Overhead cable tray around the wall, with cables and hangers; drops to the equipment.
        a0, a1 = D(30), D(330)
        path = [pol(4.86, a0 + (a1 - a0) * i / 96, 3.18) for i in range(97)]
        U = [(-0.15, 0.0), (0.15, 0.0), (0.15, 0.1), (0.13, 0.1), (0.13, 0.02), (-0.13, 0.02), (-0.13, 0.1), (-0.15, 0.1)]
        emit(bm_sweep(path, U, up=(0, 1, 0)), 'steel', None, STEELG, 0.5, smooth=SIDES)
        for (dr, dy, tnt) in ((-0.07, 0.045, BLACK), (0.0, 0.05, GUNMETAL), (0.07, 0.042, srgb(40, 40, 44))):
            TUBE('rubber', [pol(4.86 + dr, a0 + (a1 - a0) * i / 48, 3.18 + dy) for i in range(49)], 0.022, 6, tint=tnt)
        for i in range(13):
            a_ = a0 + (a1 - a0) * i / 12
            p = pol(4.86, a_, 3.18)
            B('metal_black', 0.03, 0.5, 0.03, p[0], 3.5, p[2], tint=BLACK)
            q = pol(R_IN - 0.02, a_, 3.66)
            beam('metal_black', (p[0], 3.72, p[2]), (q[0], 3.72, q[2]), 0.03, 0.03, BLACK)
        for (a_, y_end, r_end) in ((52, FL + 2.0, 4.8), (124, FL + 0.98, 4.6), (290, FL + 1.7, 4.9)):
            a_ = D(a_)
            p0 = Vector(pol(4.86, a_, 3.16))
            p1 = Vector(pol(r_end, a_, y_end))
            pts = [tuple(p0.lerp(p1, t) + Vector((0, -0.12 * math.sin(PI * t), 0))) for t in (0, 0.25, 0.5, 0.75, 1.0)]
            TUBE('rubber', pts, 0.028, 6, tint=BLACK)

        # Gooseneck wall lamps with enamel shades.
        for a_ in (58, 124, 212, 292):
            g = wall_g(a_, R_IN - 0.02)
            g.box('metal_black', 0.12, 0.16, 0.02, 0, 2.86, 0.01, tint=BLACK)
            TUBE('metal_black', [g.p(0, 2.9, 0.02), g.p(0, 3.02, 0.2), g.p(0, 2.98, 0.42), g.p(0, 2.9, 0.5)], 0.014, 6, tint=BLACK)
            g.put(bm_lathe([(0.02, 0.0), (0.04, -0.02), (0.13, -0.1), (0.14, -0.11)], 20), 'painted', 0, 2.92, 0.5, tint=srgb(52, 76, 60), smooth=True)
            g.put(bm_lathe([(0.138, -0.108), (0.126, -0.1), (0.036, -0.022), (0.018, -0.004)], 20), 'painted', 0, 2.92, 0.5, tint=CREAMP, smooth=True)
            SPH('emissive', 0.035, *g.p(0, 2.84, 0.5), 10, 8)

    # Interior lights (the game assigns its shared point lights here when you're close).
    for (nm, a_, r_, y_, col, pw, dist) in (('LIGHT_desk', 124, 4.1, 2.9, [1.0, 0.78, 0.52], 4.0, 6.5),
                                            ('LIGHT_racks', 55, 4.2, 2.8, [0.85, 0.92, 1.0], 3.2, 6.0),
                                            ('LIGHT_console', 214, 3.9, 2.9, [1.0, 0.76, 0.5], 4.0, 6.5),
                                            ('LIGHT_bench', 292, 4.3, 2.8, [1.0, 0.8, 0.55], 3.2, 6.0)):
        empty(nm, pol(r_, D(a_), y_), color=col, power=pw, distance=dist)
    empty('SOUND_electronics', pol(4.3, D(62), 1.3))
    empty('SOUND_desk', pol(4.0, D(124), 1.1))

# ============================================================================ outside
def build_outside():
    set_origin(0, 0, 0)
    # Weather mast with a spinning cup anemometer and a vane.
    x, _, z = pol(7.4, D(122))
    CYL('steel', 0.18, 0.2, 0.08, x, 0.04, z, 16, tint=GUNMETAL)
    CYL('steel', 0.035, 0.045, 4.4, x, 2.2, z, 10, tint=STEELG)
    for k in range(3):
        a = 2 * PI * k / 3 + 0.3
        TUBE('steel', [(x, 3.2, z), (x + math.cos(a) * 1.6, 0.02, z + math.sin(a) * 1.6)], 0.006, 4, tint=STEELG)
    B('painted', 0.18, 0.22, 0.12, x, 1.4, z + 0.06, tint=CREAMP, bevel=0.01)
    part('Anemometer', (x, 4.45, z), axis=(0, 1, 0), driver='wind', ratio=1.0)
    with into('Anemometer'):
        CYL('steel', 0.03, 0.03, 0.1, x, 4.45, z, 10, tint=STEELG)
        for k in range(3):
            a = 2 * PI * k / 3
            cx, cz = x + math.cos(a) * 0.26, z + math.sin(a) * 0.26
            beam('steel', (x, 4.47, z), (cx, 4.47, cz), 0.012, 0.012, STEELG)
            emit(bm_lathe([(0.0, 0.0), (0.05, 0.01), (0.07, 0.05), (0.072, 0.06)], 12), 'painted', xf(cx, 4.47, cz, -a, 0, PI / 2), CREAMP, 1.0, None, None, True)
    B('steel', 0.02, 0.02, 0.5, x, 4.1, z + 0.1, tint=STEELG)
    emit(bm_prism([(0.0, 0.0), (0.2, 0.06), (0.2, -0.06)], -0.005, 0.005, 'y'), 'steel', xf(x, 4.1, z + 0.35), STEELG)
    C(x, 1.5, z, 0.25, 3.0, 0.25)
    # Louvred instrument shelter on legs.
    x, _, z = pol(7.2, D(98))
    g = G(x, 0, z, -D(98))
    for sx in (-1, 1):
        for sz in (-1, 1):
            g.box('wood', 0.05, 1.2, 0.05, sx * 0.24, 0.6, sz * 0.2, tint=CREAMP)
    g.box('wood', 0.62, 0.05, 0.52, 0, 1.2, 0, tint=CREAMP)
    g.box('wood', 0.66, 0.06, 0.56, 0, 1.78, 0, tint=CREAMP)
    for k in range(10):
        for (sx, sz, ry_) in ((0, 0.25, 0), (0, -0.25, 0), (0.3, 0, PI / 2), (-0.3, 0, PI / 2)):
            w_ = 0.58 if ry_ == 0 else 0.48
            g.box('wood', w_, 0.012, 0.05, sx, 1.24 + k * 0.05, sz, ry=ry_, rx=0.6, tint=CREAMP)
    g.col(0.7, 1.9, 0.6, 0, 0.95, 0)
    # A bench by the door, looking out over the clouds.
    x, _, z = pol(6.7, D(36))
    g = G(x, 0, z, PI - D(36))
    for k in range(4):
        g.box('wood', 1.5, 0.035, 0.09, 0, 0.44, -0.16 + k * 0.105, tint=jitter(TIMBER, 0.06), grain=0)
    for sx in (-1, 1):
        g.box('metal_black', 0.05, 0.44, 0.38, sx * 0.62, 0.22, 0, tint=BLACK)
    g.col(1.5, 0.5, 0.45, 0, 0.25, 0)

# ============================================================================ rear hatch
def hatch_quads(quads, mat, tint):
    """Emit hatch-local quads [(corners, local normal)], each turned to face its normal."""
    bm = bmesh.new()
    for pts, n in quads:
        a, b, c = (Vector(p) for p in pts[:3])
        if (b - a).cross(c - a).dot(Vector(n)) < 0:
            pts = pts[::-1]
        bm.faces.new([bm.verts.new(p) for p in pts])
    emit(bm, mat, hatch_rot(), tint, 0.3)

def box_in(u0, u1, v0, v1, r0, r1, ends=True, hole=None):
    """A hatch-local box seen from inside: its four sides and (ends) its r0/r1 faces, less a hole (u0, u1, v0, v1)."""
    q = [([(u0, v0, r0), (u0, v1, r0), (u0, v1, r1), (u0, v0, r1)], (1, 0, 0)),
         ([(u1, v0, r0), (u1, v1, r0), (u1, v1, r1), (u1, v0, r1)], (-1, 0, 0)),
         ([(u0, v0, r0), (u1, v0, r0), (u1, v0, r1), (u0, v0, r1)], (0, 1, 0)),
         ([(u0, v1, r0), (u1, v1, r0), (u1, v1, r1), (u0, v1, r1)], (0, -1, 0))]
    if ends:
        rects = [(u0, u1, v0, v1)]
        if hole:
            hu0, hu1, hv0, hv1 = hole
            rects = [(u0, u1, v0, hv0), (u0, u1, hv1, v1), (u0, hu0, hv0, hv1), (hu1, u1, hv0, hv1)]
        for r, nz in ((r0, 1), (r1, -1)):
            for (a0, a1, b0, b1) in rects:
                q.append(([(a0, b0, r), (a1, b0, r), (a1, b1, r), (a0, b1, r)], (0, 0, nz)))
    return q

def bm_curved_plate(w, h, t, R, n=8):
    """A w x h plate, t thick, facing +Z, bent about the vertical to follow a drum of radius R behind it."""
    bm = bmesh.new()
    cols = []
    for i in range(n + 1):
        x = -w / 2 + w * i / n
        dz = -x * x / (2 * R)
        cols.append([bm.verts.new((x, y, dz + z)) for (y, z) in ((-h / 2, t / 2), (h / 2, t / 2), (h / 2, -t / 2), (-h / 2, -t / 2))])
    for i in range(n):
        A, Bq = cols[i], cols[i + 1]
        for k in range(4):
            l = (k + 1) % 4
            bm.faces.new((A[k], A[l], Bq[l], Bq[k]))
    bm.faces.new(cols[0])
    bm.faces.new(list(reversed(cols[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

HATCH_YELLOW = srgb(255, 204, 0)

def build_hatch():
    """The rear hatch: a riveted square cut low in the back of the drum (HATCH_A). Behind it a curved panel
    hangs from a pin and covers it; when the dome and the telescope both point at the top of the Rocks tor the
    game swings the panel up out of the way (part 'Hatch', driver 'hatch'), showing a yellow plate with three
    screws. The panel is authored open, so the plate's AO bakes uncovered: the game holds hatch = 1 (shut) at
    rest. The sleeve and the panel's slot are shell, so the wall never shows a hole into the room; the frame,
    panel and plate are small details in the 'near' layer."""
    set_origin(0, 0, 0)
    hw, y0, yc = HATCH_HW, HATCH_Y0, HATCH_YC
    y1 = y0 + 2 * hw
    pu, pv = HATCH_PIN
    rp = (HR_SLOT0 + HR_SLOT1) / 2
    lining = mul(GUNMETAL, 0.55)
    # Sleeve through the stucco (from just behind the frame, so their walls don't fight), the slot the panel turns in
    # (clear of its whole swing), a short sleeve to the plate.
    hatch_quads(box_in(-hw, hw, y0, y1, HR_SLOT1, HR_FACE - 0.0145, ends=False), 'metal_black', lining)
    hatch_quads(box_in(-0.155, 0.41, 0.285, 0.82, HR_SLOT0, HR_SLOT1, hole=(-hw, hw, y0, y1)), 'metal_black', lining)
    hatch_quads(box_in(-hw, hw, y0, y1, HR_PLATE - 0.004, HR_SLOT0, ends=False), 'metal_black', lining)

    with layer('near'):
        # Riveted steel frame, a raised bead round the cut.
        sq = lambda h, lo=None: [(-h, -(lo or h)), (h, -(lo or h)), (h, h), (-h, h)]
        # Its bottom band runs down to the plinth, over the sliver of stucco left under the cut.
        emit(bm_loop_ring(sq(hw + 0.06, yc - (FL - 0.02) - 0.002), sq(hw), 0.014), 'steel', hatch_m(0, yc, HR_FACE - 0.007), mul(GUNMETAL, 0.95), 0.3)
        emit(bm_loop_ring(sq(hw + 0.009), sq(hw), 0.02), 'steel', hatch_m(0, yc, HR_FACE - 0.004), GUNMETAL, 0.3)
        s = hw + 0.03
        rivets = [(k * 0.06, sy * s) for k in (-2, -1, 0, 1, 2) for sy in (-1, 1)] + [(sx * s, k * 0.06) for k in (-1, 0, 1) for sx in (-1, 1)]
        for (ru, rv) in rivets:
            emit(bm_sphere(0.0095, 8, 5), 'steel', hatch_m(ru, yc + rv, HR_FACE - 0.002), mul(STEELG, 0.85), smooth=True)

        # The yellow plate (paint worn to steel at its edges) and its three screws: top left, centre, right middle.
        n, w = 10, 0.2
        bm = bmesh.new()
        g = [[bm.verts.new((-w / 2 + w * i / n, -w / 2 + w * j / n, 0)) for i in range(n + 1)] for j in range(n + 1)]
        for j in range(n):
            for i in range(n):
                bm.faces.new((g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]))
        Mp = hatch_m(0, yc, HR_PLATE)
        Mpi = Mp.inverted()
        bare = mul(STEELG, 0.8)
        def worn(co):
            p = Mpi @ co
            k = 0.3 * (1 - smooth01(0.0, 0.02, w / 2 - max(abs(p.x), abs(p.y))))
            k = min(1.0, k + 0.04 * max(0.0, math.sin(p.x * 157 + math.sin(p.y * 91) * 2.3)))
            f = 0.96 + 0.04 * math.sin(p.y * 211 + p.x * 37)
            return tuple((HATCH_YELLOW[i] * (1 - k) + bare[i] * k) * f for i in range(3))
        emit(bm, 'painted', Mp, WHITE, 0.3, colfn=worn)
        for (su, sv, ang) in ((-0.05, 0.05, 0.4), (0.0, 0.0, 1.9), (0.05, 0.0, -0.7)):
            emit(bm_cyl(0.0075, 0.009, 0.004, 14), 'steel', hatch_m(su, yc + sv, HR_PLATE + 0.002, rx=PI / 2), mul(STEELG, 0.9), 0.3, smooth=True)
            emit(bm_box(0.015, 0.0022, 0.002), 'metal_black', hatch_m(su, yc + sv, HR_PLATE + 0.0042, rz=ang), BLACK)
        # The pin the panel turns on.
        emit(bm_cyl(0.009, 0.009, HR_SLOT1 - HR_SLOT0, 10), 'steel', hatch_m(pu, pv, rp, rx=PI / 2), STEELG, 0.3, smooth=True)

    # The panel: a curved plate on a tongue up to its hub, built shut and turned open about the pin.
    part('Hatch', tuple(hatch_rot() @ Vector((pu, pv, rp))), axis=tuple(hatch_rot(3) @ Vector((0, 0, 1))), driver='hatch', ratio=-HATCH_SWING)
    T_open = Matrix.Translation((pu, pv, 0)) @ Matrix.Rotation(HATCH_SWING, 4, 'Z') @ Matrix.Translation((-pu, -pv, 0))
    Mo = lambda M: hatch_rot() @ T_open @ M
    dull = mul(STEELG, 0.7)
    streak = lambda co: (0.85 + 0.15 * math.sin(co.x * 71 + co.y * 13),) * 3
    with layer('near'), into('Hatch'):
        emit(bm_curved_plate(0.26, 0.26, 0.008, rp), 'steel', Mo(Matrix.Translation((0, yc, rp))), dull, 0.3, colfn=streak)
        emit(bm_box(0.07, pv - yc - 0.12, 0.008), 'steel', Mo(Matrix.Translation((pu, (yc + 0.12 + pv) / 2, rp))), dull, 0.3)
        emit(bm_cyl(0.03, 0.03, 0.012, 16), 'steel', Mo(Matrix.Translation((pu, pv, rp)) @ Matrix.Rotation(PI / 2, 4, 'X')), mul(STEELG, 0.8), 0.3)

# ============================================================================ service ladders and the roof station
def ladder_path(step=0.1):
    """The curved ladder's rung line in its meridian plane, as (r, y) points every `step` m of arc, from the fixed
    ladder's top to just below the station deck's outer edge: straight up off the fixed ladder at first, then onto
    brackets LAD_SO off the dome, then out on longer ones to meet the deck (which is flat, so its outer edge stands
    well clear of the dome). Returns the points and the length."""
    pb = math.atan2(LAD_Y - DC, LAD_R)
    tr, ty = STA_RC + STA_HZ + 0.05, STA_Y - 0.07
    pt = math.atan2(ty - DC, tr)
    r0, r1 = RD + LAD_SO, math.hypot(tr, ty - DC)
    def rho(p):
        sb = smooth01(pb, pb + D(12), p)
        return LAD_R / math.cos(p) * (1 - sb) + r0 * sb + (r1 - r0) * smooth01(pt - D(22), pt, p)
    fine = [Vector((rho(p) * math.cos(p), DC + rho(p) * math.sin(p))) for p in (pb + (pt - pb) * i / 3000 for i in range(3001))]
    out, s, want = [fine[0]], 0.0, step
    for a, b in zip(fine[:-1], fine[1:]):
        d = (b - a).length
        while s + d >= want:
            out.append(a.lerp(b, (want - s) / d))
            want += step
        s += d
    if (fine[-1] - out[-1]).length > 1e-4:
        out.append(fine[-1])
    return out, s

def mer(r, y, side=0.0):
    """A point in the curved ladder's meridian plane (r from the axis, height y), `side` metres across it (clockwise)."""
    L = D(LAD_LON)
    return Vector((math.sin(L) * r + math.cos(L) * side, y, -math.cos(L) * r + math.sin(L) * side))

def station_g():
    """The station deck's frame: origin at the centre of its top, +z outward along the ladder's meridian, x across."""
    x, _, z = pol(STA_RC, D(LAD_LON))
    return G(x, STA_Y, z, PI - D(LAD_LON))

def bm_disk(r, n=32, up=True):
    """A flat round face in the XZ plane facing +Y (or -Y)."""
    bm = bmesh.new()
    vs = [bm.verts.new((math.cos(2 * PI * k / n) * r, 0, math.sin(2 * PI * k / n) * r)) for k in range(n)]
    bm.faces.new(vs[::-1] if up else vs)
    return bm

def build_ladders():
    """The fixed ladder up the back of the drum (static) and the curved one on the dome (part of it, so it turns with
    it). Rails are shell; rungs, brackets and standoffs are 'near' details. The game climbs them (src/props/
    observatoryStation.js): the fixed one is an ordinary ladder whose top leads on to the curved one when they meet."""
    set_origin(0, 0, 0)
    rail = rect_section(0.02, 0.065, -0.0325)      # flat bar: 2 cm across, 6.5 cm deep
    # ---- fixed: from the ground to LAD_Y on three pairs of brackets. The dome's skirt overhangs the drum above the
    # top pair, so nothing reaches the wall higher up (and the rails end just under the curved ladder's foot).
    x, _, z = pol(LAD_R, D(LAD_A))
    g = G(x, 0.0, z, PI - D(LAD_A))                 # local +z outward, x across
    back = -(LAD_R - R_OUT) - 0.01                  # the wall behind the rails
    for s in (-1, 1):
        g.box('steel', 0.02, LAD_Y - 0.02, 0.065, s * LAD_HW, (LAD_Y - 0.02) / 2, 0, tint=STEELG)
    with layer('near'):
        y = LAD_Y - 0.15                            # rungs keep their pitch across the joint
        while y > 0.2:
            g.put(bm_tube([(-LAD_HW, 0, 0), (LAD_HW, 0, 0)], 0.016, 8), 'steel', 0, y, 0, tint=STEELG, smooth=True)
            y -= LAD_PITCH
        for yb in (0.95, 2.05, 3.45):
            for s in (-1, 1):
                g.box('steel', 0.02, 0.05, -back, s * LAD_HW, yb, back / 2, tint=mul(STEELG, 0.9))
                g.box('steel', 0.1, 0.14, 0.012, s * LAD_HW, yb, back + 0.006, tint=mul(STEELG, 0.85))   # wall plate
                for dy in (-0.045, 0.045):
                    g.cyl('steel', 0.009, 0.009, 0.012, s * LAD_HW + s * 0.03, yb + dy, back + 0.016, 8, rx=PI / 2, tint=GUNMETAL)
        for s in (-1, 1):
            g.box('steel', 0.09, 0.012, 0.11, s * LAD_HW, 0.006, 0, tint=GUNMETAL)      # foot plates
    # Stringers and brackets as one block, so you can't walk through it or between it and the wall (the climb
    # itself is kinematic). Head high only: nothing up there to stand on.
    g.col(0.62, 2.4, 0.06 - back, 0, 1.2, (back + 0.06) / 2)

    # ---- curved: on the dome, from the fixed ladder's top to the station.
    path, total = ladder_path()
    S = [0.0]
    for a, b in zip(path[:-1], path[1:]):
        S.append(S[-1] + (b - a).length)
    def at(sv):
        i = 0
        while i < len(S) - 2 and S[i + 1] < sv:
            i += 1
        return path[i].lerp(path[i + 1], (sv - S[i]) / (S[i + 1] - S[i]))
    C0 = Vector((0, DC, 0))
    radial = lambda q: (q - C0).normalized()
    top = path[-1]
    with into('Dome'):
        for s in (-1, 1):
            emit(bm_sweep([mer(p.x, p.y, s * LAD_HW) for p in path], rail, up=radial), 'steel', None, STEELG)
            # Grab bars up past the deck edge.
            TUBE('steel', [tuple(mer(top.x, top.y - 0.02, s * LAD_HW)), tuple(mer(top.x, STA_Y + 1.05, s * LAD_HW))], 0.017, 8, tint=STEELG)
            SPH('steel', 0.022, *mer(top.x, STA_Y + 1.05, s * LAD_HW), 8, 6, tint=STEELG)
        with layer('near'):
            sv, k = 0.15, 0
            while sv < total - 0.08:
                c = at(sv)
                TUBE('steel', [tuple(mer(c.x, c.y, -LAD_HW)), tuple(mer(c.x, c.y, LAD_HW))], 0.016, 8, tint=STEELG)
                # Standoffs to the skin every third rung, and under the top one.
                if k % 3 == 0 or sv + LAD_PITCH >= total - 0.08:
                    for s in (-1, 1):
                        R = mer(c.x, c.y, s * LAD_HW)
                        n = radial(R)
                        K = C0 + n * (RD + 0.004)
                        beam('steel', tuple(R - n * 0.03), tuple(K), 0.024, 0.04, mul(STEELG, 0.9), up=tuple(n.cross(Vector((0, 1, 0))) if abs(n.y) < 0.99 else (1, 0, 0)))
                        beam('steel', tuple(K + n * 0.006), tuple(K - n * 0.004), 0.07, 0.07, mul(STEELG, 0.85))   # foot pad
                sv += LAD_PITCH
                k += 1
    empty('LADDER', (0, 0, 0), fixedA=LAD_A, lon=LAD_LON, rf=LAD_R, yb=LAD_Y, hw=LAD_HW, path=[float(c) for p in path for c in (p.x, p.y)])

def build_station():
    """A small railed deck near the crown of the dome, at the head of the curved ladder (part of the dome, clear of the
    slit's girders by 0.2 m). An iris like the End's door but much smaller is set in its floor, with a plate of three
    push buttons in front of it; the game turns the blades and pushes the buttons (src/props/observatoryStation.js).
    Under the iris is a shallow well; the game lays the telescope's two scales and their pointers on its floor."""
    set_origin(0, 0, 0)
    g = station_g()
    hx, hz = STA_HX, STA_HZ
    M0 = xf(g.x, g.y, g.z, g.ry)
    C0 = Vector((0, DC, 0))
    def skin(lx, lz):
        """The dome under a deck point, as a model point and its height relative to the deck top."""
        x, _, z = g.p(lx, 0, lz)
        y = DC + math.sqrt(RD * RD - x * x - z * z)
        return Vector((x, y, z)), y - STA_Y
    ex, ez, op = hx - 0.03, hz - 0.03, 0.33        # railing line, and the half width of the ladder's opening
    with into('Dome'):
        # Tread-plate deck with a round hole for the iris: quads between the hole and the edge, on rays that include
        # the four corners. Top and underside.
        cz, ri = STA_IZ, STA_IR + 0.012
        corners = [math.atan2(sz_ - cz, sx_) % (2 * PI) for (sx_, sz_) in ((hx, hz), (-hx, hz), (-hx, -hz), (hx, -hz))]
        angs = sorted(set([round(2 * PI * k / 40, 9) for k in range(40)] + [round(a, 9) for a in corners]))
        def edge(a):
            dx, dz = math.cos(a), math.sin(a)
            t = hx / abs(dx) if abs(dx) > 1e-9 else 1e9
            if dz > 1e-9:
                t = min(t, (hz - cz) / dz)
            elif dz < -1e-9:
                t = min(t, (-hz - cz) / dz)
            return (dx * t, cz + dz * t)
        for y0, up in ((0.0, True), (-0.012, False)):
            bm = bmesh.new()
            inner = [bm.verts.new((math.cos(a) * ri, y0, cz + math.sin(a) * ri)) for a in angs]
            outer = [bm.verts.new((edge(a)[0], y0, edge(a)[1])) for a in angs]
            for k in range(len(angs)):
                j = (k + 1) % len(angs)
                f = (inner[k], inner[j], outer[j], outer[k])
                bm.faces.new(f if up else f[::-1])
            emit(bm, 'plate', M0, mul(STEELG, 1.6), 0.5)       # (the pier's ring is white: it's indoors)
        # Edge frame under the plate, railing posts and the top rail (the silhouette).
        for s in (-1, 1):
            g.box('steel', 2 * hx, 0.05, 0.04, 0, -0.037, s * (hz - 0.02), tint=GUNMETAL)
            g.box('steel', 0.04, 0.05, 2 * hz - 0.08, s * (hx - 0.02), -0.037, 0, tint=GUNMETAL)
        for (lx, lz) in ((-ex, -ez), (ex, -ez), (-ex, ez), (ex, ez), (-op, ez), (op, ez), (-ex, 0), (ex, 0), (0, -ez)):
            g.box('steel', 0.035, 1.07, 0.035, lx, 0.535, lz, tint=STEELG)
        def runs(y, h, w, mat='steel', tint=STEELG):
            for s in (-1, 1):
                g.box(mat, w, h, 2 * ez, s * ex, y, 0, tint=tint)                          # sides
                g.box(mat, ex - op, h, w, s * (ex + op) / 2, y, ez, tint=tint)              # outer end, either side of the opening
            g.box(mat, 2 * ex, h, w, 0, y, -ez, tint=tint)                                   # inner end
        runs(1.05, 0.04, 0.04)
        with layer('near'):
            runs(0.55, 0.03, 0.03)
            runs(0.05, 0.1, 0.012, tint=mul(STEELG, 0.9))                                   # toe boards
            # Safety bars across the opening (like the power tower's): you get on by looking down over them.
            for yb in (0.55, 1.0):
                g.box('painted', 2 * op, 0.045, 0.045, 0, yb, ez, tint=HATCH_YELLOW)
            # Legs to the dome, longer toward the outer edge, with pads on the skin and cross braces.
            legs = {}
            for lz in (-hz + 0.06, -0.25, 0.25, hz - 0.05):
                for s in (-1, 1):
                    lx = s * (hx - 0.05)
                    K, y0 = skin(lx, lz)
                    legs[(s, lz)] = y0
                    g.box('steel', 0.035, -0.062 - y0 + 0.01, 0.035, lx, (-0.062 + y0 - 0.01) / 2, lz, tint=GUNMETAL)
                    n = (K - C0).normalized()
                    beam('steel', tuple(K + n * 0.006), tuple(K - n * 0.004), 0.08, 0.08, GUNMETAL)
            lz = hz - 0.05
            for s in (-1, 1):
                beam('steel', g.p(s * (hx - 0.05), -0.08, lz), g.p(-s * (hx - 0.05), legs[(-s, lz)] + 0.06, lz), 0.03, 0.012, GUNMETAL)
                beam('steel', g.p(s * (hx - 0.05), -0.08, 0.25), g.p(s * (hx - 0.05), legs[(s, lz)] + 0.06, lz), 0.012, 0.03, GUNMETAL)
            # The iris: a rim bead and rivets on the deck, the blade housing under the plate (the open blades slide
            # into it) and the well below.
            Mi = M0 @ Matrix.Translation((0, 0, STA_IZ))
            emit(bm_torus(STA_IR + 0.014, 0.01, 40, 6), 'steel', Mi @ Matrix.Translation((0, -0.004, 0)), STEELG, smooth=True)
            for k in range(18):
                a = 2 * PI * (k + 0.5) / 18
                emit(bm_sphere(0.0065, 6, 4), 'steel', Mi @ Matrix.Translation((math.cos(a) * (STA_IR + 0.042), 0.0, math.sin(a) * (STA_IR + 0.042))), mul(STEELG, 0.9), smooth=True)
            # (The open blades reach 1.9 radii from the centre.)
            emit(bm_ring(STA_IR, STA_IR * 1.92, -0.05, -0.045, 48), 'metal_black', Mi, PANELBLK)
            wall = bm_cyl(STA_IR, STA_IR, STA_WELL - 0.05, 40, caps=False)
            bmesh.ops.reverse_faces(wall, faces=wall.faces)
            emit(wall, 'metal_black', Mi @ Matrix.Translation((0, -(STA_WELL + 0.05) / 2, 0)), PANELBLK, smooth=SIDES)
            emit(bm_cyl(STA_IR + 0.004, STA_IR + 0.004, STA_WELL - 0.044, 40, caps=False), 'metal_black', Mi @ Matrix.Translation((0, -(STA_WELL + 0.056) / 2, 0)), GUNMETAL, smooth=SIDES)
            emit(bm_disk(STA_IR + 0.004, 40, up=False), 'metal_black', Mi @ Matrix.Translation((0, -STA_WELL - 0.006, 0)), GUNMETAL)
            emit(bm_disk(STA_IR, 40), 'metal_black', Mi @ Matrix.Translation((0, -STA_WELL, 0)), mul(PANELBLK, 0.8))
            # The button plate: a low steel wedge sloping toward you, three bezels and cups (the game adds the caps).
            bz, bsp = STA_BTN
            z0, z1, hb, hf = bz - 0.06, bz + 0.06, 0.075, 0.04
            emit(bm_prism([(z0, 0.0), (z1, 0.0), (z1, hf), (z0, hb)], -0.16, 0.16, 'z'), 'painted', M0, mul(GUNMETAL, 0.8))
            alpha = math.atan2(hb - hf, z1 - z0)
            Mf = M0 @ Matrix.Translation((0, (hb + hf) / 2, bz)) @ Matrix.Rotation(alpha, 4, 'X')
            for k in (-1, 0, 1):
                emit(bm_torus(0.027, 0.005, 24, 6), 'steel', Mf @ Matrix.Translation((k * bsp, 0.001, 0)), STEELG, smooth=True)
                emit(bm_cyl(0.023, 0.023, 0.004, 20), 'metal_black', Mf @ Matrix.Translation((k * bsp, 0.001, 0)), BLACK)
            for (sx_, sz_) in ((-0.14, -0.045), (0.14, -0.045), (-0.14, 0.045), (0.14, 0.045)):
                emit(bm_cyl(0.006, 0.006, 0.004, 8), 'steel', Mf @ Matrix.Translation((sx_, 0.001, sz_)), GUNMETAL, smooth=True)
    empty('STATION', g.p(0, 0, 0), ry=g.ry, hx=hx, hz=hz, iris=[0.0, 0.0, STA_IZ, STA_IR],
          btn=[(hb + hf) / 2, bz, alpha, bsp], well=[-STA_WELL, STA_IR])

def bake_all():
    """AO as usual, then the rear hatch's small parts borrow texels from bigger surfaces: at ~10 texels per metre
    its rivets and frame get islands too small to bake (they come out black). The frame, bead and rivets read the
    stucco just above the hatch; the screws, and the panel, read the plate texel they sit on. (The panel was
    baked open, shut away inside the wall; shut, it hangs just in front of the plate.) The ladders and the roof station
    do the same (borrow_ladder_ao)."""
    out = bake_ao()
    sc = _scene()
    out['ladder_ao'] = borrow_ladder_ao(sc)
    plate, steel, panel, plaster =(sc.objects.get(n) for n in (PREFIX + 'painted@near', PREFIX + 'steel@near', 'Hatch_steel@near', PREFIX + 'plaster'))
    if not (plate and steel and panel and plaster):
        return out
    for vl in sc.view_layers:
        vl.update()
    Rinv = hatch_rot().inverted()
    def local(ob, co):     # Blender world -> hatch-local
        w = ob.matrix_world @ co
        return Rinv @ Vector((w.x, w.z, -w.y))
    def loops(ob):
        me = ob.data
        return [(li, local(ob, me.vertices[l.vertex_index].co)) for li, l in enumerate(me.loops)]
    lm = plate.data.uv_layers['lightmap']
    spots = [(p.x, p.y, tuple(lm.data[li].uv)) for li, p in loops(plate)
             if abs(p.z - HR_PLATE) < 1e-3 and abs(p.x) < 0.1001 and abs(p.y - HATCH_YC) < 0.1001]
    under = lambda p: min(spots, key=lambda t: (t[0] - p.x) ** 2 + (t[1] - p.y) ** 2)[2]
    # The stucco face beside and above the hatch (it runs up to the belt course), read about the frame's height:
    # inside its island, and near the ground, which is what darkens the frame.
    face = min(plaster.data.polygons, key=lambda f: (local(plaster, f.center) - Vector((0.16, 1.2, R_OUT))).length)
    lw = plaster.data.uv_layers['lightmap']
    corners = sorted(((local(plaster, plaster.data.vertices[plaster.data.loops[li].vertex_index].co).y, lw.data[li].uv.copy()) for li in face.loop_indices), key=lambda t: t[0])
    lo, hi = corners[:2], corners[-2:]
    ylo, yhi = (lo[0][0] + lo[1][0]) / 2, (hi[0][0] + hi[1][0]) / 2
    t = max(0.05, min(0.95, (HATCH_YC + 0.25 - ylo) / (yhi - ylo)))
    wall = tuple(((lo[0][1] + lo[1][1]) / 2).lerp((hi[0][1] + hi[1][1]) / 2, t))
    ls = steel.data.uv_layers['lightmap']
    for li, p in loops(steel):
        if abs(p.x) > 0.2 or abs(p.y - HATCH_YC) > 0.2:
            continue
        if p.z > R_OUT - 0.01:
            ls.data[li].uv = wall
        elif HR_PLATE - 1e-3 < p.z < HR_SLOT0:
            ls.data[li].uv = under(p)
    pu, pv = HATCH_PIN
    shut = Matrix.Translation((pu, pv, 0)) @ Matrix.Rotation(-HATCH_SWING, 4, 'Z') @ Matrix.Translation((-pu, -pv, 0))
    lp = panel.data.uv_layers['lightmap']
    for li, p in loops(panel):
        lp.data[li].uv = under(shut @ p)
    out['hatch_ao'] = {'plate_points': len(spots), 'wall_uv': [round(c, 4) for c in wall]}
    return out

def borrow_ao(img, targets, donors):
    """Point every target face's lightmap UVs at the texel of the nearest donor face (a big, well-baked surface):
    thin rails, rungs and small fittings get islands under a texel wide, which bake black or catch a neighbour's
    margin. targets / donors: [(object, face filter(game point, game normal, area))]. Returns (targets, donors)."""
    from mathutils.kdtree import KDTree
    import numpy as np
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[:, :, 0]
    game = lambda v: Vector((v.x, v.z, -v.y))
    faces = lambda ob, keep: [(f, game(ob.matrix_world @ f.center), game(ob.matrix_world.to_3x3() @ f.normal).normalized())
                              for f in ob.data.polygons if keep(game(ob.matrix_world @ f.center), game(ob.matrix_world.to_3x3() @ f.normal).normalized(), f.area)]
    pts, uvs = [], []
    for ob, keep in donors:
        lm = ob.data.uv_layers['lightmap']
        for f, p, n in faces(ob, keep):
            uv = sum((lm.data[li].uv for li in f.loop_indices), Vector((0, 0))) / len(f.loop_indices)
            if px[min(H - 1, int(uv.y * H)), min(W - 1, int(uv.x * W))] > 0.12:   # really baked
                pts.append(p)
                uvs.append(uv.copy())
    if not pts:
        return (0, 0)
    tree = KDTree(len(pts))
    for i, p in enumerate(pts):
        tree.insert(p, i)
    tree.balance()
    n = 0
    for ob, keep in targets:
        lm = ob.data.uv_layers['lightmap']
        for f, p, _ in faces(ob, keep):
            uv = uvs[tree.find(p)[1]]
            for li in f.loop_indices:
                lm.data[li].uv = uv
            n += 1
    return (n, len(pts))

def borrow_ladder_ao(sc):
    """The ladders' and the station's small parts read the drum wall behind the fixed ladder, the dome skin under the
    curved one and under the station, or the deck plate (everything on and in the deck)."""
    img = bpy.data.images.get(PREFIX + 'ao')
    ob = lambda name: sc.objects.get(name)
    if not img or not ob('Dome_plate'):
        return None
    for vl in sc.view_layers:
        vl.update()
    C0 = Vector((0, DC, 0))
    wrap = lambda a: (a + PI) % (2 * PI) - PI
    ang = lambda p: math.atan2(p.x, -p.z)
    g = station_g()
    def local(p):                      # model -> station frame
        dx, dz = p.x - g.x, p.z - g.z
        return Vector((dx * g.c - dz * g.s, p.y - g.y, dx * g.s + dz * g.c))
    def on_deck(p, margin=0.1):
        q = local(p)
        return abs(q.x) < STA_HX + margin and -STA_HZ - margin < q.z < STA_HZ + margin and -0.9 < q.y < 1.2
    fixed = lambda r0: lambda p, n, a: abs(wrap(ang(p) - D(LAD_A))) < 0.1 and r0 < math.hypot(p.x, p.z) < 6.2 and p.y < LAD_Y + 0.05
    L = D(LAD_LON)
    side = lambda p: p.x * math.cos(L) + p.z * math.sin(L)
    # (r > 2.9: the slit's girder crosses the ladder's meridian nearer the axis, above the deck's inner edge.)
    curved = lambda p, n, a: (abs(side(p)) < 0.33 and abs(wrap(ang(p) - L)) < 0.6 and (p - C0).length > RD - 0.02
                              and math.hypot(p.x, p.z) > 2.9 and p.y > LAD_Y - 0.1 and not on_deck(p, 0.02))
    above = lambda p, n, a: on_deck(p) and local(p).y > -0.2 and (local(p).y > -0.015 or math.hypot(local(p).x, local(p).z - STA_IZ) < STA_IR + 0.02)
    below = lambda p, n, a: on_deck(p) and not above(p, n, a)
    skin = lambda da: lambda p, n, a: abs(wrap(ang(p) - L)) < da and n.dot((p - C0).normalized()) > 0.9 and (p - C0).length > RD - 0.01
    out = {}
    out['fixed'] = borrow_ao(img, [(ob(PREFIX + 'steel'), fixed(5.9)), (ob(PREFIX + 'steel@near'), fixed(5.45))],
                             [(ob(PREFIX + 'plaster'), lambda p, n, a: abs(wrap(ang(p) - D(LAD_A))) < 0.3 and 0.3 < p.y < 3.6
                               and math.hypot(p.x, p.z) > R_OUT - 0.02 and n.dot(Vector((p.x, 0, p.z)).normalized()) > 0.9)])
    near = [ob(n) for n in ('Dome_steel@near', 'Dome_metal_black@near', 'Dome_painted@near') if ob(n)]
    out['curved'] = borrow_ao(img, [(o, curved) for o in near + [ob('Dome_steel')]], [(ob('Dome_dome'), skin(0.4))])
    out['deck'] = borrow_ao(img, [(o, above) for o in near + [ob('Dome_steel')]],
                            [(ob('Dome_plate'), lambda p, n, a: n.y > 0.9 and on_deck(p, 0.0))])
    out['under'] = borrow_ao(img, [(o, below) for o in near + [ob('Dome_steel')]], [(ob('Dome_dome'), skin(0.9))])
    return out

def build_meta():
    empty('META', (0, 0, 0), floorY=FL, rIn=R_IN, rOut=R_OUT, wallTop=WALL_TOP, domeC=DC, domeR=RD,
          pivotY=PIV_Y, tubeFront=TUBE_F, doorHalf=DOOR_W)

def build_all():
    t0 = time.time()
    _ids.update(lamp=0, screen=0, reel=0)
    build_shell()
    build_dome()
    with layer('in'):
        build_tube()
        build_pier()
        build_console()
        build_viewer()
        build_electronics()
    with layer('near'):
        build_outside()
    build_hatch()
    build_ladders()
    build_station()
    build_meta()
    stats = realize()
    show_scene()
    tris = 0
    for ob in _scene().objects:
        if ob.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return {'materials': stats, 'colliders': len(COLS), 'empties': len(EMPTIES), 'parts': len(DOORS),
            'lamps': _ids['lamp'], 'screens': _ids['screen'], 'reels': _ids['reel'], 'tris': tris,
            'seconds': round(time.time() - t0, 1)}
