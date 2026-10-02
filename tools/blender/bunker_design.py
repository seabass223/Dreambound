# Dreambound: the survey relay room at the bottom of the Tower's bunker stair (src/world/bunker.js places it, the game's
# src/props/bunkerRoom.js draws it). Executed inside dbkit.py's namespace by build_bunker.py.
#
# ROOM FRAME (the model's coordinates, game axes, +Y up): origin on the room floor in the middle of the stair mouth; +x
# across (bunker frame x), +z toward the elevator (down the stair's direction). The room's inner faces are
# x in [-HW, HW], y in [0, H], z in [0, D]. The stair mouth is the hole |x| < 0.7, y < 2.35 in the front wall (z = 0; the
# game's procedural stair continues behind it); the elevator doorway is |x| < 0.68, y < 2.3 in the back wall (z = D) with a
# 0.3 m reveal back to the elevator's plate at z = D + 0.3 (the plate and its doors are the game's). Nothing here collides:
# the game keeps its own procedural floor/wall/ceiling shell and adds the OBB_n empties for the furniture.
#
# Looking in from the stair: the workbench runs along the +x wall (on your left) on orange drawer pedestals, with the
# terminal (an orange CRT you sit at in the orange chair), the oscilloscope to its right and the desk lamp to its left,
# a corkboard, a bar light and a clock over it; the radar console (a round CRT in a grey-green rack over a low orange
# cabinet) and a tall orange cabinet stand on the -x wall, a trench drain in front of them; a grey-green locker and a
# wire rack flank the stair mouth, which is framed by a steel portal with a warm bar light over it. Three dark enamel
# pendants hang under the steel beams, a spiral-seam aluminium duct crosses under them wall to wall, an orange pipe and
# black conduits run round the walls. The floor is polished concrete, worn and pitted, with worn yellow lines, an inset
# steel plate and hazard hatching at the elevator.
#
# ---------------------------------------------------------------- meshes (bunker_<mat>[@<layer>]; COLOR_0 = vertex colour)
# Every baked mesh has TEXCOORD_1 (three's uv1), the lightmap atlas. Its albedo is texture(UV0) x vertex colour, unlit, times
# the lightmap (below). UV0 per material (glTF v is flipped on export: everything below is as three reads it with every
# texture flipY = false, so no material needs its own flip):
#   wall      cinderblock: UV0 in TILE units (repeat): u along the wall, v up (1 tile = META.wall_tile = 1.6 x 1.2 m,
#             4 blocks x 6 courses, the courses start at the floor). Vertex colour: damp at the foot, soot near the ceiling.
#   floor     polished concrete: UV0 = room metres (x, z) exactly (uv.x = x, uv.y = z). The floor textures are unique to
#             the room: st = ((uv.x - fm.x0) / fm.w, (uv.y - fm.z0) / fm.d) with fm = META.floor_map; the PNG's top row is
#             z = fm.z0 (the stair mouth), its left column x = fm.x0.
#   concrete  ceiling slab, the doorway's reveal: board-formed concrete, UV0 in tile units (1.2 m).
#   steel     beams, portal, frames, grates, shelving, bolts: UV0 in tile units (1 m), random offset per piece.
#   orange    enamel (cabinets, pedestals, CRT and scope housings, chair shell, pipe, case): tile units (0.6 m), v up.
#   green     grey-green enamel (the locker, the radar rack, instruments): tile units (0.6 m), v up.
#   alu       the duct: u = metres along it / 1.2, v = angle round it / 2 pi (the spiral seam is in the texture, and a real
#             seam bead runs over it); the straps and collars: tile units (1.2 m).
#   misc      vertex colour only (keyboard, rubber, papers' backs, mug, boxes, cables, enamel shades, cushions...).
#   decal     bunker_decal.png atlas, plain UV0 (no id packing), x vertex colour.
#   glow      NOT baked, no uv1: bulbs, bar-light diffusers, the lamp bulb, indicator LEDs. Draw vertex colour x a gain
#             (bloom > 1.35) x k. Layers: glow (bulbs and diffusers), glow@led (the small indicator lamps).
#   screen    NOT baked: the scope and radar glass, UV0 packed (mode + u, id + v) as observatory_design.py screen():
#             scope mode 1 id 0, radar mode 2 id 1. The radar glass is round: its rim is at |(fract(uv) - 0.5) * (1.25, 1)|
#             = 0.48, so SCREEN_FRAG's mode 2 fills it exactly. (v is flipped by glTF: un-flip as observatory.js does.)
#   screen@term  the terminal's glass: UV0 0..1 over the glass, u to the right and v up as seen from the front (three's
#             uv.y = 1 - v, so three's uv (0, 0) is the top left corner as seen by the player).
#   cctv@cctv, glow@cctv  CAM 07's housing and its red LED, authored at the ORIGIN (lens at (0,0,0) looking +z, the mount
#             plate behind at -z, y up): not part of the room. Vertex colour (x bunker_steel.png on UV0 tile units if you
#             like). Never drawn in the room.
#
# ---------------------------------------------------------------- textures (public/models/, all flipY = false)
#   bunker_lm.png            2048^2 RGB (1024 in QUICK). Baked light (Cycles diffuse direct + indirect, no albedo) on uv1,
#                            stored (L / META.lm_scale)^(1/3): L = s^3 * lm_scale. NoColorSpace, no mipmaps, linear filter.
#   bunker_env.png           1024 x 512 RGB equirect of the room AS THE GAME DRAWS IT (albedo x L, glow x META.env_glow)
#                            from META.env_pos, stored (R / META.env_scale)^(1/3). Direction d (room frame) -> st =
#                            (atan(d.z, d.x) / 2pi + 0.5, 0.5 - asin(d.y) / pi) with flipY = false (top row = straight up).
#                            For the floor's box-projected reflection, intersect the reflected ray with META.env_box.
#                            The values are in the lightmap's units: multiply by the same gain as the lightmap (and k).
#   bunker_wall.png          1024 x 768 sRGB tile (META.wall_tile), cinderblock;  bunker_wall_normal.png (tangent, +u +v).
#   bunker_floor.png         2048 x 1536 sRGB, unique over META.floor_map: polished concrete, yellow lines, stains.
#   bunker_floor_rough.png   2048 x 1536 grey (NoColorSpace): roughness 0.15-0.3 polished, 0.5-0.7 worn and painted,
#                            0.8-0.95 in pits, joints and dust.
#   bunker_floor_normal.png  1024 x 768 RGB (same mapping), ROOM SPACE: n = normalize(vec3(r, b, g) * 2 - 1) is (x, y, z) in the room
#                            frame (r = x, g = z, b = up). Pits, saw cuts, paint edges.
#   bunker_concrete.png      512^2 sRGB tile (1.2 m): board-formed ceiling concrete.
#   bunker_orange.png        512^2 sRGB tile (0.6 m) + bunker_orange_normal.png: safety-orange enamel chipped to primer,
#                            steel and rust, rust runs down (v).
#   bunker_green.png         512^2 sRGB tile (0.6 m) + bunker_green_normal.png: grey-green enamel, chalky, chipped.
#   bunker_steel.png         512^2 sRGB tile (1 m): raw-ish steel, mill scale and rust (the vertex colour darkens painted
#                            steel; bare worn edges of the enamel use it at full brightness).
#   bunker_alu.png           1024^2 sRGB tile (u 1.2 m along, v once round): brushed spiral-seam aluminium, 4 seams per tile.
#   bunker_decal.png         2048^2 sRGB atlas: the desk top, corkboard and pinned sheets, printouts, clock face, hazard
#                            sticker, meters, labels and stencils (plain UVs).
#
# ---------------------------------------------------------------- empties (extras -> userData), room frame
#   META        hw, d, h, mouth [0.7, 2.35], door [0.68, 2.3], lm_scale, wall_tile, floor_map {x0, z0, w, d}, env_pos,
#               env_box [x0, y0, z0, x1, y1, z1], env_scale, env_glow, gain (suggested lightmap gain at exposure 1),
#               glow_gain (suggested), tiles {mat: metres}.
#   LIGHT_i     power (W, as baked), color [r, g, b] linear, kind 'pendant' | 'bar' | 'lamp' | 'screen' (+ name).
#   TERMINAL    w, h, normal: the terminal glass centre.   SCREEN_SCOPE w, h, normal.   SCREEN_RADAR r, normal.
#   SEAT_EYE    the seated eye (look: the glass centre, yaw/pitch three.js YXZ in the room frame, fov).
#   SEAT_STAND  where the player stands up (floor).   CHAIR  the chair's centre (ry).
#   OBB_n       hx, hz, y0, y1, ry at (cx, 0, cz): furniture collision (physics.addOBB, sideways only).
#   SOUND       the room's hum.   CALL  the elevator call button (callPos: plate-local, for the station).
#   CCTV_LENS   the cctv layer's origin (0, 0, 0); mount: the plate's back-face centre, mount_tilt: the plate's tip (deg).

import contextlib
import numpy as np
from mathutils import noise as mnoise

QUICK = os.environ.get('BUNKER_QUICK') == '1'
SKIPTEX = os.environ.get('BUNKER_SKIPTEX') == '1'
NOPREVIEW = os.environ.get('BUNKER_NOPREVIEW') == '1'
PREVIEW_DIR = os.environ.get('BUNKER_PREVIEW') or os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_bunker')
MODELS = ROOT + '/public/models/'
TMP = os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_bunker_tmp')

MATS.update({
    'wall': (srgb(150, 144, 132), 0.9), 'floor': (srgb(118, 112, 104), 0.3), 'concrete': (srgb(140, 136, 128), 0.9),
    'steel': (srgb(70, 70, 72), 0.5), 'orange': (srgb(205, 92, 30), 0.5), 'green': (srgb(98, 110, 92), 0.6),
    'alu': (srgb(170, 170, 168), 0.35), 'misc': (WHITE, 0.6), 'decal': (WHITE, 0.8), 'glow': ((1.0, 0.7, 0.4), 1.0),
    'screen': ((0.2, 0.4, 1.0), 0.1), 'cctv': (srgb(120, 122, 120), 0.6), 'standin': (srgb(60, 58, 55), 0.9),
})
NO_BAKE = {'glow', 'screen', 'cctv', 'collider'}
BAKE_MATS = {'wall', 'floor', 'concrete', 'steel', 'orange', 'green', 'alu', 'misc', 'decal'}

# ---------------------------------------------------------------- layout (room frame, metres)
HW, D, H = 2.4, 3.6, 3.0
MOUTH_HW, MOUTH_H = 0.7, 2.35
DOOR_HW, DOOR_H = 0.68, 2.3
PLATE_Z = D + 0.3
CALL = (-1.12, 1.15)          # the elevator call button: plate-local (1.12, 1.15) (the plate faces -z, so its +x is room -x)
BEAMS_X = (-1.6, 0.0, 1.6)    # I-beams along z
BEAM_B = 2.84                 # their bottom flange
CHANNELS_Z = (0.55, 3.05)     # cross channels framing into the beams
DUCT_Z, DUCT_Y, DUCT_R = 1.9, 2.55, 0.225
PENDANTS = [(-0.35, 0.95, 2.25), (1.15, 2.75, 2.32), (-1.6, 2.85, 2.40)]   # x, z, shade rim height
DESK = dict(x0=1.65, x1=2.4, z0=0.9, z1=3.3, top=0.76)
PED_A, PED_B = (0.92, 1.42), (2.78, 3.28)                                      # pedestal z spans
TERM = Vector((1.935, 1.07, 2.1))          # terminal glass centre (apex of its bulge)
TERM_W, TERM_H = 0.36, 0.27
CHAIR = (1.25, 2.1)
SEAT_EYE = Vector((1.42, 1.14, 2.1))
SEAT_STAND = (0.55, 0.0, 2.1)
SCOPE_Z = 2.85
RADAR_Z, RADAR_Y, RADAR_R = 1.6, 1.45, 0.165
LOCKER = dict(x0=1.05, x1=1.95, z0=0.02, z1=0.52, h=1.9)
SHELF = dict(x0=-2.35, x1=-1.4, z0=0.03, z1=0.48, h=1.8)
TRENCH = dict(x0=-1.75, x1=-1.45, z0=0.7, z1=3.1)
PLATE = dict(x0=-0.72, x1=0.72, z0=1.15, z1=2.55)
SQDRAIN = (1.3, 0.72, 0.13)                  # x, z, half size
ENV_POS = (0.0, 1.1, 1.8)
FLOOR_MAP = dict(x0=-HW, z0=0.0, w=2 * HW, d=D)
FLOOR_PX = (2048, 1536)

TILE = {'wall': (1.6, 1.2), 'concrete': (1.2, 1.2), 'steel': (1.0, 1.0), 'orange': (0.6, 0.6), 'green': (0.6, 0.6),
        'alu': (1.2, 1.2), 'cctv': (1.0, 1.0), 'standin': (1.0, 1.0)}
GRAIN = {'steel': 'auto', 'alu': 'auto', 'cctv': 'auto'}

# ---------------------------------------------------------------- palette (linear; multiplies the textures)
ENAMEL_DK = srgb(30, 32, 31)          # pendant shades, outside
ENAMEL_WH = srgb(226, 220, 204)       # their insides
LAMPGREEN = srgb(38, 52, 44)
BLACKP = srgb(22, 22, 22)             # conduit, rubber, cable
RUBBER = srgb(28, 27, 26)
CARDBOARD = srgb(150, 112, 74)
CARD_DK = srgb(118, 86, 56)
TAPE = srgb(196, 170, 120)
VINYL = srgb(198, 92, 34)
KEYBASE = srgb(196, 178, 146)
KEYCAP = srgb(66, 58, 50)
KEYCREAM = srgb(214, 202, 176)
PAPER = srgb(226, 220, 204)
REDPAINT = srgb(160, 24, 18)
YELLOW = srgb(222, 170, 30)
CORKWOOD = srgb(120, 84, 52)
GLASSBK = srgb(10, 12, 14)
DARKWET = srgb(12, 12, 11)
PAINTED = mul(WHITE, 0.42)            # steel painted dark grey (beams, columns)
WORN = WHITE                          # bare worn steel
GREYGREEN = (0.86, 0.9, 0.86)         # radar rack: greyer than the locker
BULB = (1.0, 0.82, 0.55)              # glow colours (times the game's glow gain)
BAR = (1.0, 0.86, 0.66)
LED_RED, LED_AMB, LED_GRN = (1.0, 0.12, 0.05), (1.0, 0.55, 0.08), (0.25, 1.0, 0.3)

def D2R(d):
    return math.radians(d)

# ============================================================================ emit helpers
DENS = []        # (bucket key, first vertex, end vertex, factor): lightmap texel density for what was emitted inside dens()
_dens = [1.0]

class dens:
    """Context manager: geometry emitted inside gets f times the lightmap texel density (per unit length)."""
    def __init__(self, f):
        self.f = f
    def __enter__(self):
        self.prev = _dens[0]
        _dens[0] = self.prev * self.f
        return self
    def __exit__(self, *exc):
        _dens[0] = self.prev

def _key(mat):
    return mat if _layer[0] == 'shell' else mat + '@' + _layer[0]

CONST_UV = lambda co, n: (0.5, 0.5)

def put(bm, mat, M=None, tint=WHITE, smooth=False, colfn=None, uvfn=None, uvface=None, ofs=True, var=0.0):
    """Emit a bmesh in one of the room's materials with that material's UV0 convention (see the header)."""
    key = _key(mat)
    b = BUCKETS.get(key)
    n0 = len(b.verts) if b else 0
    if uvfn is not None or uvface is not None:
        emit(bm, mat, M, tint, smooth=smooth, colfn=colfn, uvfn=uvfn, uvface=uvface, var=var)
    elif mat in TILE:
        o = (rng.uniform(0, 1), rng.uniform(0, 1)) if (ofs and mat not in ('wall',)) else None
        emit(bm, mat, M, tint, tile=TILE[mat], grain=GRAIN.get(mat), smooth=smooth, colfn=colfn, uvofs=o, var=var)
    else:
        emit(bm, mat, M, tint, smooth=smooth, colfn=colfn, uvfn=CONST_UV, var=var)
    if _dens[0] != 1.0:
        DENS.append((key, n0, len(BUCKETS[key].verts), _dens[0]))

def cull(bm, fn):
    """Delete faces nobody sees (against a wall, on the floor) so they cost no lightmap texels."""
    bm.normal_update()
    dead = [f for f in bm.faces if fn(f)]
    if dead:
        bmesh.ops.delete(bm, geom=dead, context='FACES')
    return bm

def facing(*dirs):
    ds = [Vector(d).normalized() for d in dirs]
    return lambda f: any(f.normal.dot(d) > 0.9 for d in ds)

def orient(bm, want):
    """Flip faces so their normals agree with want(face_center) -> Vector."""
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.dot(want(f.calc_center_median())) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    bm.normal_update()
    return bm

def quad_facing(pts, want):
    bm = bm_poly(pts)
    return orient(bm, lambda c: Vector(want))

def axis_to(n):
    """Rotation taking +Y to the direction n."""
    return Vector((0, 1, 0)).rotation_difference(Vector(n).normalized()).to_matrix().to_4x4()

def frame_m(o, X, Y, Z=None):
    """4x4 with origin o and columns X, Y, Z (Z = X x Y by default)."""
    X, Y = Vector(X).normalized(), Vector(Y).normalized()
    Z = Vector(Z).normalized() if Z is not None else X.cross(Y)
    return Matrix(((X.x, Y.x, Z.x, o[0]), (X.y, Y.y, Z.y, o[1]), (X.z, Y.z, Z.z, o[2]), (0, 0, 0, 1)))

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

def _wear_split(bm, amount, M):
    """Indices of the bevel faces (normals not along the box's axes) that are worn through to bare steel. The long bevel
    strips are first cut into ~3.5 cm pieces so the wear comes and goes along an edge. Top and front edges wear most."""
    bm.normal_update()
    isbev = lambda f: max(abs(f.normal.x), abs(f.normal.y), abs(f.normal.z)) < 0.97
    edges = set()
    for f in bm.faces:
        if isbev(f):
            for e in f.edges:
                if e.calc_length() > 0.06:
                    edges.add(e)
    groups = {}
    for e in edges:
        groups.setdefault(min(48, int(e.calc_length() / 0.035)), []).append(e)
    for n, es in groups.items():
        es = [e for e in es if e.is_valid]
        if n >= 1 and es:
            bmesh.ops.subdivide_edges(bm, edges=es, cuts=n, use_grid_fill=True)
    bm.normal_update()
    bm.faces.index_update()
    bare = set()
    for f in bm.faces:
        if not isbev(f):
            continue
        c = f.calc_center_median()
        w = M @ c
        nz = mnoise.noise(Vector((w.x * 9.0, w.y * 9.0, w.z * 9.0))) + 0.6 * mnoise.noise(Vector((w.x * 31.0 + 5.0, w.y * 31.0, w.z * 31.0)))
        bias = 0.35 * max(0.0, f.normal.y) + 0.2 * max(0.0, f.normal.z) - 0.25 * max(0.0, -f.normal.y)
        if nz + bias > 0.75 - amount:
            bare.add(f.index)
    return bare

def put_worn(bm, mat, M, tint=WHITE, amount=0.45, bare_tint=WORN, smooth=False):
    """Emit a bevelled box (local coords) in an enamel, its worn edges in bare steel."""
    bare = _wear_split(bm, amount, M)
    if bare:
        bm2 = bm.copy()
        bm2.faces.ensure_lookup_table()
        bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if f.index not in bare], context='FACES')
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in bare], context='FACES')
        if bm2.faces:
            put(bm2, 'steel', M, bare_tint, smooth=smooth)
        else:
            bm2.free()
    put(bm, mat, M, tint, smooth=smooth)

def BX(mat, w, h, d, x, y, z, ry=0.0, rx=0.0, rz=0.0, tint=WHITE, bevel=0.0, seg=1, hide=None, wear=0.0, smooth=False, var=0.0):
    """A box in a room material. hide: directions (world) whose faces are dropped. wear > 0 (enamels) wears the
    bevelled edges through to steel."""
    bm = bm_box(w, h, d, bevel, seg)
    M = xf(x, y, z, ry, rx, rz)
    if hide is not None:
        hs = [hide] if isinstance(hide[0], (int, float)) else list(hide)
        R = M.to_3x3()
        loc = [R.inverted() @ Vector(hh) for hh in hs]
        cull(bm, facing(*loc))
    if wear > 0 and bevel > 0:
        put_worn(bm, mat, M, tint, wear)
    else:
        put(bm, mat, M, tint, smooth=smooth, var=var)

def GB(g, mat, w, h, d, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0, **kw):
    x, y, z = g.p(lx, ly, lz)
    if 'hide' in kw and kw['hide'] is not None:
        hs = [kw['hide']] if isinstance(kw['hide'][0], (int, float)) else list(kw['hide'])
        kw['hide'] = [g.dir(hh) for hh in hs]
    BX(mat, w, h, d, x, y, z, g.ry + ry, rx, rz, **kw)

def GP(g, bm, mat, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0, s=None, **kw):
    x, y, z = g.p(lx, ly, lz)
    put(bm, mat, xf(x, y, z, g.ry + ry, rx, rz, s), **kw)

def GM(g, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0):
    x, y, z = g.p(lx, ly, lz)
    return xf(x, y, z, g.ry + ry, rx, rz)

def _gdir(self, v):
    return (v[0] * self.c + v[2] * self.s, v[1], -v[0] * self.s + v[2] * self.c)
G.dir = _gdir

def lathe(mat, profile, M, segs=24, tint=WHITE, smooth=True, out=True):
    """A lathe about +Y (then M); out: normals away from the axis (else toward it)."""
    bm = bm_lathe(profile, segs)
    orient(bm, (lambda c: Vector((c.x, 0, c.z)) if Vector((c.x, 0, c.z)).length > 1e-6 else Vector((0, 1, 0))) if out
           else (lambda c: -Vector((c.x, 0, c.z)) if Vector((c.x, 0, c.z)).length > 1e-6 else Vector((0, -1, 0))))
    put(bm, mat, M, tint, smooth=smooth)

def tube(mat, pts, r, sides=8, tint=WHITE, rad=None, smooth=True):
    if rad:
        pts = rounded_pts(pts, rad)
    put(bm_tube(pts, r, sides), mat, None, tint, smooth=smooth)

def cylx(mat, r, x0, x1, y, z, segs=16, tint=WHITE, caps=True, smooth=True):
    """Cylinder along x."""
    put(bm_cyl(r, r, x1 - x0, segs, caps), mat, xf((x0 + x1) / 2, y, z, rz=-PI / 2), tint, smooth=lambda n: abs(n.x) < 0.9 if smooth else False)

def cylz(mat, r, z0, z1, x, y, segs=16, tint=WHITE, caps=True, smooth=True):
    put(bm_cyl(r, r, z1 - z0, segs, caps), mat, xf(x, y, (z0 + z1) / 2, rx=PI / 2), tint, smooth=lambda n: abs(n.z) < 0.9 if smooth else False)

def cyly(mat, r, y0, y1, x, z, segs=16, tint=WHITE, caps=True, smooth=True, rt=None):
    put(bm_cyl(r if rt is None else rt, r, y1 - y0, segs, caps), mat, xf(x, (y0 + y1) / 2, z), tint, smooth=lambda n: abs(n.y) < 0.9 if smooth else False)

def cyl_at(mat, r, h, p, n, segs=12, tint=WHITE, caps=True, rt=None):
    """A cylinder of length h from p along n."""
    n = Vector(n).normalized()
    M = Matrix.Translation(Vector(p) + n * (h / 2)) @ axis_to(n)
    put(bm_cyl(r if rt is None else rt, r, h, segs, caps), mat, M, tint, smooth=lambda f: abs(f.dot(n)) < 0.9)

def bolt(p, n, r=0.0095, h=0.008, tint=mul(WHITE, 0.55), washer=True, mat='steel'):
    """A hex bolt head (with a washer) on a face at p, normal n."""
    n = Vector(n).normalized()
    if washer:
        cyl_at(mat, r * 1.45, 0.002, p, n, 12, tint)
    cyl_at(mat, r, h, Vector(p) + n * (0.002 if washer else 0), n, 6, tint)

def prism_bevel(bm, axis_vec, off=0.003):
    """Round the edges of an extrusion that run along it."""
    a = Vector(axis_vec).normalized()
    es = [e for e in bm.edges if abs((e.verts[1].co - e.verts[0].co).normalized().dot(a)) > 0.99]
    if es:
        bmesh.ops.bevel(bm, geom=es, offset=off, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm

def ipoly(b, h, tf, tw, cx=0.0, cy=0.0):
    """An I/H section: flange width b (u), depth h (v)."""
    p = [(-b / 2, -h / 2), (b / 2, -h / 2), (b / 2, -h / 2 + tf), (tw / 2, -h / 2 + tf), (tw / 2, h / 2 - tf), (b / 2, h / 2 - tf),
         (b / 2, h / 2), (-b / 2, h / 2), (-b / 2, h / 2 - tf), (-tw / 2, h / 2 - tf), (-tw / 2, -h / 2 + tf), (-b / 2, -h / 2 + tf)]
    return [(cx + u, cy + v) for (u, v) in p]

def cpoly(b, h, tf, tw, cx=0.0, cy=0.0, flip=False):
    """A channel: web at u = 0..tw, flanges out to u = b (or -b if flip)."""
    s = -1 if flip else 1
    p = [(0, -h / 2), (b, -h / 2), (b, -h / 2 + tf), (tw, -h / 2 + tf), (tw, h / 2 - tf), (b, h / 2 - tf), (b, h / 2), (0, h / 2)]
    return [(cx + s * u, cy + v) for (u, v) in p]

def lpoly(a, b, t):
    return [(0, 0), (a, 0), (a, t), (t, t), (t, b), (0, b)]

def sheet(region, O, U, V, w, h, nu=1, nv=1, lift=None, tint=WHITE, back=None, mat='decal'):
    """A printed sheet from the decal atlas: lower-left corner O, texture u along U and v along V, facing U x V.
    region (u0, v0, u1, v1). lift(s, t) -> (du, dv, dn) curls it. back: a plain colour for its reverse side."""
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
    u0, v0, u1, v1 = region
    def uv(f):
        return [(u0 + l.vert[lay].x * (u1 - u0), v0 + l.vert[lay].y * (v1 - v0)) for l in f.loops]
    bk = None
    if back is not None:
        bk = bm.copy()
        bmesh.ops.reverse_faces(bk, faces=list(bk.faces))
        bk.normal_update()
        for v in bk.verts:
            v.co -= N * 0.0006
    put(bm, mat, None, tint, uvface=uv)
    if bk is not None:
        put(bk, 'misc', None, back)

def label(name, c, n, right, w, h, tint=WHITE, lift=0.0015):
    """A decal from the atlas, centred at c on a face with normal n, its u along `right`."""
    n, right = Vector(n).normalized(), Vector(right).normalized()
    up = n.cross(right)
    O = Vector(c) + n * lift - right * (w / 2) - up * (h / 2)
    sheet(ATLAS[name], O, right, up, w, h, tint=tint)

def grid_sheet(us, vs, P, want, keep=None):
    """A sheet over the grid us x vs (P(u, v) -> point), cells dropped where keep(u0, u1, v0, v1) is false. Shared vertices,
    so a flat sheet comes out as one lightmap island."""
    bm = bmesh.new()
    V = {}
    for i, u in enumerate(us):
        for j, v in enumerate(vs):
            V[i, j] = bm.verts.new(P(u, v))
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            if keep is None or keep(us[i], us[i + 1], vs[j], vs[j + 1]):
                bm.faces.new((V[i, j], V[i + 1, j], V[i + 1, j + 1], V[i, j + 1]))
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    return orient(bm, lambda c: Vector(want))

def steps(a, b, d, extra=()):
    """Sorted breakpoints from a to b about d apart, plus extra (clipped)."""
    n = max(1, int(round((b - a) / d)))
    s = {a + (b - a) * k / n for k in range(n + 1)}
    s.update(e for e in extra if a - 1e-9 <= e <= b + 1e-9)
    out = []
    for v in sorted(s):
        if not out or v - out[-1] > 1e-4:
            out.append(v)
    return out

def nz(x, y, z, f=1.0):
    return mnoise.noise(Vector((x * f, y * f, z * f)))

# ============================================================================ the shell
def wall_col(axis):
    """Vertex colour of the block walls: a damp tide line at the foot, soot toward the ceiling, faint runs down."""
    def f(co):
        u = co.x if axis == 'z' else co.z
        y = co.y
        tide = 0.32 + 0.12 * nz(u, 0.0, 7.1 if axis == 'z' else 3.3, 1.7) + 0.05 * nz(u, 1.0, 2.0, 6.0)
        damp = 1.0 - 0.3 * (1.0 - min(1.0, max(0.0, (y - tide + 0.06) / 0.12)))
        ring = math.exp(-((y - tide - 0.05) / 0.035) ** 2) * 0.06                      # salt at the tide line
        soot = 1.0 - 0.18 * min(1.0, max(0.0, (y - 2.45) / 0.55))
        run = max(0.0, nz(u * 4.0, 0.3, 9.0 if axis == 'z' else 4.0, 1.0)) * 0.22 * min(1.0, (H - y) / 1.2) * (0.4 + 0.6 * max(0.0, nz(u, 5.0, 1.0, 0.8)))
        k = damp * soot * (1.0 - run) + ring
        warm = 1.0 - 0.06 * (1.0 - damp)
        return (min(1.0, k * warm), min(1.0, k), min(1.0, k * (1.0 + 0.02 * (1.0 - damp))))
    return f

def wall_sheet(axis, w, inward, u0, u1, openings, extra_u=()):
    """One block wall as a single sheet: axis 'z' = the wall at z = w running along x, 'x' = at x = w along z."""
    opu = [o[0] for o in openings] + [o[1] for o in openings]
    opv = [o[3] for o in openings]
    us = steps(u0, u1, 0.1, opu + list(extra_u))
    vs = steps(0.0, H, 0.15, opv + [0.06, 0.12, 0.2, 0.28, 0.36, 0.45])
    if axis == 'z':
        P = lambda u, v: (u, v, w)
        want = (0, 0, inward)
    else:
        P = lambda u, v: (w, v, u)
        want = (inward, 0, 0)
    keep = lambda a, b, c, d: not any(o[0] - 1e-6 <= (a + b) / 2 <= o[1] + 1e-6 and (c + d) / 2 <= o[3] for o in openings)
    put(grid_sheet(us, vs, P, want, keep), 'wall', None, WHITE, colfn=wall_col(axis))

def shell():
    # Block walls, floor to ceiling. Front: the stair mouth. Back: the elevator doorway.
    wall_sheet('z', 0.0, 1, -HW, HW, [(-MOUTH_HW, MOUTH_HW, 0.0, MOUTH_H)], extra_u=(-0.95, -0.75, 0.75, 0.95))
    wall_sheet('z', D, -1, -HW, HW, [(-DOOR_HW, DOOR_HW, 0.0, DOOR_H)], extra_u=(-0.8, 0.8))
    wall_sheet('x', -HW, 1, 0.0, D, [])
    wall_sheet('x', HW, -1, 0.0, D, [])
    # The ceiling slab: board-formed concrete, soot over the pendants.
    def soot(co):
        k = 1.0
        for (px, pz, _) in PENDANTS:
            d2 = (co.x - px) ** 2 + (co.z - pz) ** 2
            k -= 0.28 * math.exp(-d2 / 0.18)
        k -= 0.08 * max(0.0, nz(co.x, 0.0, co.z, 0.9))
        return (k, k, k)
    with dens(0.6):
        put(grid_sheet(steps(-HW, HW, 0.3, BEAMS_X), steps(0.0, D, 0.3), lambda u, v: (u, H, v), (0, -1, 0)), 'concrete', None, WHITE, colfn=soot)
    # The doorway's reveal back to the plate: concrete jambs and head, a steel threshold.
    z0, z1 = D, PLATE_Z
    with dens(0.8):
        for s in (-1, 1):
            x = s * DOOR_HW
            put(quad_facing([(x, 0, z0), (x, 0, z1), (x, DOOR_H, z1), (x, DOOR_H, z0)], (-s, 0, 0)), 'concrete', None, mul(WHITE, 0.9))
        put(quad_facing([(-DOOR_HW, DOOR_H, z0), (DOOR_HW, DOOR_H, z0), (DOOR_HW, DOOR_H, z1), (-DOOR_HW, DOOR_H, z1)], (0, -1, 0)), 'concrete', None, mul(WHITE, 0.85))
        put(quad_facing([(-DOOR_HW, 0, z0), (DOOR_HW, 0, z0), (DOOR_HW, 0, z1), (-DOOR_HW, 0, z1)], (0, 1, 0)), 'steel', None, mul(WHITE, 0.7))
    for k in range(9):                                                   # tread bars on the threshold
        x = -DOOR_HW + 0.08 + k * (2 * DOOR_HW - 0.16) / 8
        BX('steel', 0.012, 0.004, 0.26, x, 0.002, (z0 + z1) / 2, tint=mul(WHITE, 0.8), hide=(0, -1, 0))

def floor_sheet():
    """The polished floor: one sheet with holes for the trench drain, the square drain and the inset plate."""
    T, Pl, (sx, sz, sh) = TRENCH, PLATE, SQDRAIN
    holes = [(T['x0'] - 0.02, T['x1'] + 0.02, T['z0'] - 0.02, T['z1'] + 0.02),
             (Pl['x0'] - 0.03, Pl['x1'] + 0.03, Pl['z0'] - 0.03, Pl['z1'] + 0.03),
             (sx - sh - 0.02, sx + sh + 0.02, sz - sh - 0.02, sz + sh + 0.02)]
    xs = steps(-HW, HW, 0.4, [h[0] for h in holes] + [h[1] for h in holes])
    zs = steps(0.0, D, 0.4, [h[2] for h in holes] + [h[3] for h in holes])
    keep = lambda a, b, c, d: not any(h[0] - 1e-6 <= (a + b) / 2 <= h[1] + 1e-6 and h[2] - 1e-6 <= (c + d) / 2 <= h[3] + 1e-6 for h in holes)
    bm = grid_sheet(xs, zs, lambda u, v: (u, 0.0, v), (0, 1, 0), keep)
    # UV0 = room metres as three reads them: Blender v = 1 - z, so glTF's flip gives uv.y = z.
    with dens(1.25):
        put(bm, 'floor', None, WHITE, uvfn=lambda co, n: (co.x, 1.0 - co.z))
    return holes

# ============================================================================ stand-ins (bake and panorama only, not exported)
def standins():
    # The game's procedural stair beyond the mouth: treads rising 0.19 per 0.26, side walls, the sloped ceiling; and the
    # elevator plate behind the doorway. They catch and return light in the bake and fill the panorama's openings.
    for k in range(1, 12):
        z1, z0 = -0.26 * k, -0.26 * (k + 1)
        y = 0.19 * k
        BX('standin', 2 * MOUTH_HW, 0.19, 0.26, 0, y - 0.095, (z0 + z1) / 2 + 0.0, hide=(0, -1, 0))
    zf = -0.26 * 12
    for s in (-1, 1):
        put(quad_facing([(s * MOUTH_HW, -0.1, 0.0), (s * MOUTH_HW, -0.1, zf), (s * MOUTH_HW, MOUTH_H + 3.2, zf), (s * MOUTH_HW, MOUTH_H, 0.0)], (-s, 0, 0)), 'standin')
    put(quad_facing([(-MOUTH_HW, MOUTH_H, 0.0), (MOUTH_HW, MOUTH_H, 0.0), (MOUTH_HW, MOUTH_H - zf * 0.7308, zf), (-MOUTH_HW, MOUTH_H - zf * 0.7308, zf)], (0, -1, 0)), 'standin')
    put(quad_facing([(-MOUTH_HW, 0.0, zf), (MOUTH_HW, 0.0, zf), (MOUTH_HW, MOUTH_H + 3.2, zf), (-MOUTH_HW, MOUTH_H + 3.2, zf)], (0, 0, 1)), 'standin', None, mul(WHITE, 0.6))
    # The lift's doors behind the doorway: two dark steel leaves meeting in the middle, a frame round them.
    for s in (-1, 1):
        put(quad_facing([(s * 0.004, 0.0, PLATE_Z), (s * 0.75, 0.0, PLATE_Z), (s * 0.75, 2.4, PLATE_Z), (s * 0.004, 2.4, PLATE_Z)], (0, 0, -1)), 'standin', None, (0.9, 0.92, 0.95))
    put(quad_facing([(-1.0, 2.4, PLATE_Z - 0.001), (1.0, 2.4, PLATE_Z - 0.001), (1.0, 3.0, PLATE_Z - 0.001), (-1.0, 3.0, PLATE_Z - 0.001)], (0, 0, -1)), 'standin', None, (0.6, 0.6, 0.62))
    put(quad_facing([(-0.004, 0.0, PLATE_Z + 0.002), (0.004, 0.0, PLATE_Z + 0.002), (0.004, 2.4, PLATE_Z + 0.002), (-0.004, 2.4, PLATE_Z + 0.002)], (0, 0, -1)), 'standin', None, (0.05, 0.05, 0.05))

# ============================================================================ steel
def ibeam_z(x, y_bot, z0, z1, b=0.12, h=0.16, tf=0.0105, tw=0.0075, tint=PAINTED):
    bm = bm_prism(ipoly(b, h, tf, tw, x, y_bot + h / 2), z0, z1, 'x')
    prism_bevel(bm, (0, 0, 1), 0.0025)
    if y_bot + h >= H - 1e-4:
        cull(bm, lambda f: f.normal.y > 0.9 and f.calc_center_median().y > H - 1e-3)
    put(bm, 'steel', None, tint)

def structure():
    # Three I-beams along the room under the slab, bearing on the end walls on steel plates with anchor bolts.
    for x in BEAMS_X:
        ibeam_z(x, BEAM_B, 0.0, D)
        for z, nzv in ((0.0, 1), (D, -1)):
            with dens(0.7):
                BX('steel', 0.2, 0.22, 0.012, x, BEAM_B - 0.11, z + nzv * 0.006, tint=PAINTED, bevel=0.002, hide=(0, 0, -nzv))
                for sx in (-1, 1):
                    for yy in (BEAM_B - 0.06, BEAM_B - 0.17):
                        bolt((x + sx * 0.075, yy, z + nzv * 0.012), (0, 0, nzv))
                    BX('steel', 0.008, 0.16 - 0.021, 0.05, x + sx * 0.0075, BEAM_B + 0.08, z + nzv * 0.06, tint=PAINTED)
    # Cross channels framing into the beams' webs on bolted clip angles.
    for z in CHANNELS_Z:
        for (xa, xb) in ((-1.6, 0.0), (0.0, 1.6)):
            x0, x1 = xa + 0.0045, xb - 0.0045
            poly = [(z + u, H - 0.075 + v) for (u, v) in cpoly(0.05, 0.13, 0.009, 0.006, -0.003, 0.0)]
            bm = bm_prism(poly, x0, x1, 'z')
            prism_bevel(bm, (1, 0, 0), 0.002)
            put(bm, 'steel', None, mul(PAINTED, 1.1))
            with dens(0.5):
                for xe, s in ((x0, 1), (x1, -1)):
                    # A clip angle on the beam web, bolted through the channel's web.
                    BX('steel', 0.06, 0.1, 0.007, xe + s * 0.03, H - 0.075, z - 0.0065, tint=mul(PAINTED, 0.9))
                    BX('steel', 0.007, 0.1, 0.05, xe + s * 0.0035, H - 0.075, z - 0.035, tint=mul(PAINTED, 0.9))
                    for yy in (H - 0.105, H - 0.045):
                        bolt((xe + s * 0.035, yy, z - 0.01), (0, 0, -1), r=0.008, h=0.006)
                        bolt((xe + s * 0.008, yy, z - 0.035), (s, 0, 0), r=0.008, h=0.006, washer=False)
    # The portal round the stair mouth: two H columns floor to ceiling and an H lintel over the opening.
    for s in (-1, 1):
        x = s * 0.85
        bm = bm_prism([(x + u, 0.1 + v) for (u, v) in ipoly(0.2, 0.2, 0.012, 0.008)], 0.0, H, 'y')
        prism_bevel(bm, (0, 1, 0), 0.003)
        cull(bm, facing((0, 1, 0), (0, -1, 0)))
        put(bm, 'steel', None, PAINTED)
        with dens(0.6):
            # Base plate on the floor with four anchors, a cap plate under the slab.
            BX('steel', 0.3, 0.016, 0.26, x, 0.008, 0.13, tint=mul(PAINTED, 1.15), bevel=0.003, hide=(0, -1, 0))
            for (dx, dz) in ((-0.11, 0.035), (0.11, 0.035), (-0.11, 0.225), (0.11, 0.225)):
                bolt((x + dx, 0.016, dz), (0, 1, 0), r=0.011, h=0.01)
                cyl_at('steel', 0.006, 0.02, (x + dx, 0.026, dz), (0, 1, 0), 8, mul(WHITE, 0.6))
            BX('steel', 0.26, 0.014, 0.24, x, H - 0.007, 0.12, tint=PAINTED, hide=(0, 1, 0))
        # Hazard bands on the columns' room faces at knee height.
        for k in range(6):
            col = YELLOW if k % 2 == 0 else BLACKP
            BX('misc', 0.2, 0.1, 0.002, x, 0.17 + k * 0.1, 0.2012, tint=col, hide=(0, 0, -1))
    bm = bm_prism([(0.1 + u, MOUTH_H + 0.1 + v) for (u, v) in ipoly(0.2, 0.2, 0.011, 0.008)], -0.738, 0.738, 'z')
    prism_bevel(bm, (1, 0, 0), 0.003)
    put(bm, 'steel', None, PAINTED)
    with dens(0.6):
        for s in (-1, 1):                                                   # end plates bolted to the columns' flanges
            BX('steel', 0.012, 0.2, 0.2, s * 0.744, MOUTH_H + 0.1, 0.1, tint=PAINTED)
            for yy in (MOUTH_H + 0.04, MOUTH_H + 0.16):
                for zz in (0.05, 0.15):
                    bolt((s * 0.738, yy, zz), (-s, 0, 0), r=0.009, h=0.007)

# ============================================================================ the duct, pipes and conduit
def duct():
    R, y, z = DUCT_R, DUCT_Y, DUCT_Z
    x0, x1 = -HW, HW
    segs = 40
    # The tube: open ends (it runs into both walls). UV0: u along it / 1.2, v round it (seam-safe per face).
    bm = bmesh.new()
    nx = 8
    rings = []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        rings.append([bm.verts.new((x, y + R * math.cos(2 * PI * k / segs), z + R * math.sin(2 * PI * k / segs))) for k in range(segs)])
    for i in range(nx):
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][j], rings[i][j]))
    orient(bm, lambda c: Vector((0, c.y - y, c.z - z)))
    def ang(co):
        return (math.atan2(co.z - z, co.y - y) / (2 * PI)) % 1.0
    def uvf(f):
        c = ang(f.calc_center_median())
        out = []
        for l in f.loops:
            a = ang(l.vert.co)
            if a - c > 0.5:
                a -= 1.0
            elif c - a > 0.5:
                a += 1.0
            out.append(((l.vert.co.x - x0) / 1.2, a))
        return out
    put(bm, 'alu', None, WHITE, smooth=True, uvface=uvf)
    with dens(0.5):
        # The spiral seam's lock bead, pitch 0.3 m (the texture's seams: 4 per 1.2 m tile, once round per 0.3 m).
        pts = []
        n = int((x1 - x0) / 0.3 * 28)
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            a = 2 * PI * (x - x0) / 0.3
            pts.append((x, y + (R + 0.0015) * math.cos(a), z + (R + 0.0015) * math.sin(a)))
        put(bm_tube(pts, 0.0042, 5), 'alu', None, mul(WHITE, 0.9), smooth=True)
        # Couplings every 1.2 m with their screws, collars where it meets the walls.
        for xc in (-1.2, 0.0, 1.2):
            bm = bm_ring(R, R + 0.007, -0.03, 0.03, segs)
            put(bm, 'alu', xf(xc, y, z, rz=-PI / 2), mul(WHITE, 0.85), smooth=lambda nn: abs(nn.x) < 0.9)
            for k in range(8):
                a = 2 * PI * (k + 0.5) / 8
                bolt((xc + 0.016, y + (R + 0.007) * math.cos(a), z + (R + 0.007) * math.sin(a)), (0, math.cos(a), math.sin(a)), r=0.005, h=0.003, washer=False, mat='alu')
        for xe, s in ((x0, 1), (x1, -1)):
            bm = bm_ring(R, R + 0.07, -0.004, 0.004, segs)
            put(bm, 'alu', xf(xe + s * 0.004, y, z, rz=-PI / 2), mul(WHITE, 0.7), smooth=lambda nn: abs(nn.x) < 0.9)
            bm = bm_ring(R, R + 0.012, -0.04, 0.04, segs)
            put(bm, 'alu', xf(xe + s * 0.045, y, z, rz=-PI / 2), mul(WHITE, 0.8), smooth=lambda nn: abs(nn.x) < 0.9)
        # Hangers: a strap band round the duct, a clevis bolt over it, a rod up to a clamp on the beam's bottom flange (or to
        # an anchor in the slab near the walls).
        for xh in (-2.05, -1.6, 0.0, 1.6, 2.05):
            bm = bm_ring(R + 0.002, R + 0.007, -0.016, 0.016, segs)
            put(bm, 'steel', xf(xh, y, z, rz=-PI / 2), mul(WHITE, 0.7), smooth=lambda nn: abs(nn.x) < 0.9)
            top = y + R + 0.007
            for s in (-1, 1):
                BX('steel', 0.032, 0.05, 0.004, xh, top + 0.02, z + s * 0.018, tint=mul(WHITE, 0.7))
            cylz('steel', 0.005, z - 0.03, z + 0.03, xh, top + 0.035, 8, mul(WHITE, 0.55))
            onbeam = any(abs(xh - bx) < 1e-6 for bx in BEAMS_X)
            yt = BEAM_B - 0.03 if onbeam else H
            cyly('steel', 0.0055, top + 0.035, yt, xh, z, 8, mul(WHITE, 0.6))
            if onbeam:
                BX('steel', 0.05, 0.03, 0.05, xh, BEAM_B - 0.015, z, tint=mul(WHITE, 0.45), bevel=0.003)   # beam clamp
            else:
                cyly('steel', 0.022, H - 0.012, H, xh, z, 12, mul(WHITE, 0.5))
            for yy in (top + 0.046, yt - 0.012):
                cyl_at('steel', 0.009, 0.008, (xh, yy - 0.004, z), (0, 1, 0), 6, mul(WHITE, 0.5))

def pipes():
    # An orange-red service pipe high along the desk wall, turning along the back wall over the doorway into the far wall,
    # with clips, flanged joints and a gate valve.
    xr = HW - 0.11
    pts = [(xr, 2.9, 0.0), (xr, 2.9, D - 0.1), (xr, 2.74, D - 0.1), (-HW, 2.74, D - 0.1)]
    RED = (1.0, 0.62, 0.55)
    tube('orange', pts, 0.042, 18, RED, rad=0.12)
    with dens(0.6):
        for z in (0.45, 1.35, 2.4, 3.2):
            bm = bm_ring(0.043, 0.05, -0.015, 0.015, 18)
            put(bm, 'steel', xf(xr, 2.9, z, rx=PI / 2), mul(WHITE, 0.55), smooth=lambda nn: abs(nn.z) < 0.9)
            BX('steel', 0.07, 0.014, 0.03, xr + 0.075, 2.9, z, tint=mul(WHITE, 0.5))
        for x in (1.2, 0.0, -1.2, -2.0):
            bm = bm_ring(0.043, 0.05, -0.015, 0.015, 18)
            put(bm, 'steel', xf(x, 2.74, D - 0.1, rz=PI / 2), mul(WHITE, 0.55), smooth=lambda nn: abs(nn.x) < 0.9)
            BX('steel', 0.03, 0.014, 0.07, x, 2.74, D - 0.035, tint=mul(WHITE, 0.5))
        for z in (1.0, 2.9):                                                 # flanged joints with bolts
            bm = bm_ring(0.042, 0.07, -0.009, 0.009, 18)
            put(bm, 'orange', xf(xr, 2.9, z, rx=PI / 2), mul(RED, 0.9), smooth=lambda nn: abs(nn.z) < 0.9)
            for k in range(6):
                a = 2 * PI * k / 6
                cylz('steel', 0.006, z - 0.014, z + 0.014, xr + 0.058 * math.cos(a), 2.9 + 0.058 * math.sin(a), 6, mul(WHITE, 0.5))
        # A gate valve near the stair end: body, bonnet, stem and a red handwheel.
        vz = 0.7
        cylz('orange', 0.055, vz - 0.05, vz + 0.05, xr, 2.9, 18, mul(RED, 0.85))
        cyly('orange', 0.03, 2.76, 2.9, xr, vz, 12, mul(RED, 0.85))
        cyly('steel', 0.007, 2.68, 2.76, xr, vz, 8, mul(WHITE, 0.7))
        put(bm_torus(0.055, 0.007, 20, 6), 'orange', xf(xr, 2.68, vz), (0.75, 0.2, 0.15), smooth=True)
        for k in range(3):
            a = 2 * PI * k / 3
            beam('orange', (xr, 2.68, vz), (xr + 0.052 * math.cos(a), 2.68, vz + 0.052 * math.sin(a)), 0.008, 0.008, tint=(0.75, 0.2, 0.15))

def conduit_run(pts, r=0.012, straps=0.6, tint=BLACKP, wall=None):
    """Black steel conduit along a polyline (rounded bends) with one-hole straps every `straps` metres. wall: the normal of
    the surface the run lies on (the straps press it against it)."""
    with dens(0.7):
        tube('misc', pts, r, 8, tint, rad=0.08)
    with dens(0.4):
        for a, b in zip(pts[:-1], pts[1:]):
            a, b = Vector(a), Vector(b)
            L = (b - a).length
            n = int(L / straps)
            d = (b - a).normalized()
            w = Vector(wall) if wall is not None else (Vector((0, -1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0)))
            side = d.cross(w).normalized()
            for k in range(1, n + 1):
                p = a + (b - a) * (k / (n + 1))
                M = frame_m(p, side, w, d)
                put(bm_box(r * 2 + 0.012, r + 0.004, 0.014), 'steel', M @ Matrix.Translation((0, r * 0.4, 0)), mul(WHITE, 0.55))
                put(bm_box(0.016, 0.004, 0.014), 'steel', M @ Matrix.Translation((r + 0.012, -r + 0.002, 0)), mul(WHITE, 0.5))

def conduits():
    # From the breaker panel up the front wall and along the -x wall to the radar rack.
    cz = 0.035
    conduit_run([(-1.06, 1.86, cz), (-1.06, 2.955, cz), (-HW + 0.035, 2.955, cz), (-HW + 0.035, 2.955, RADAR_Z - 0.2), (-HW + 0.035, 2.0, RADAR_Z - 0.2)], wall=(0, 0, 1))
    conduit_run([(-1.13, 1.86, 0.03), (-1.13, 2.91, 0.03), (-HW + 0.03, 2.91, 0.03), (-HW + 0.03, 2.91, 2.95), (-HW + 0.03, 1.97, 2.95)], r=0.01, wall=(0, 0, 1))
    # The disconnect on the desk wall up to the ceiling and along to the back wall's junction box.
    conduit_run([(HW - 0.035, 1.78, 0.66), (HW - 0.035, 2.96, 0.66), (HW - 0.035, 2.96, D - 0.035), (1.25, 2.96, D - 0.035), (1.25, 2.22, D - 0.035)], wall=(-1, 0, 0))
    # Runs across the slab between the beams.
    conduit_run([(0.8, 2.975, 0.0), (0.8, 2.975, D)], r=0.011, straps=0.9, wall=(0, -1, 0))
    conduit_run([(-0.85, 2.975, 0.0), (-0.85, 2.975, D)], r=0.011, straps=0.9, wall=(0, -1, 0))
    conduit_run([(-0.79, 2.978, 0.0), (-0.79, 2.978, D)], r=0.009, straps=0.9, wall=(0, -1, 0))
    with dens(0.6):
        for (x, z) in ((0.8, 0.07), (-0.82, D - 0.07)):
            BX('steel', 0.12, 0.05, 0.12, x, H - 0.025, z, tint=mul(WHITE, 0.45), bevel=0.004, hide=(0, 1, 0))

# ============================================================================ lights
LIGHTS = []   # (position, power W, colour (linear rgb) or temperature K, kind, name, extra)
UPLIGHTS = [] # (position, power, colour): bake-only fill
# Warm, but not the full orange of a 2700 K blackbody (the game has no white balance; this reads as the reference's amber).
PENDANT_RGB = (1.0, 0.6, 0.3)
BAR_RGB = (1.0, 0.72, 0.45)
LAMP_RGB = (1.0, 0.64, 0.34)

def pendant(x, z, yb, beam_hung=False):
    """An industrial enamel dome: a deep dark bowl, white inside, a rolled rim, a socket housing on a drop rod."""
    M = xf(x, yb, z)
    outer = [(0.212, 0.0), (0.208, 0.012), (0.196, 0.032), (0.178, 0.056), (0.152, 0.084), (0.12, 0.11), (0.088, 0.13),
             (0.062, 0.148), (0.05, 0.162), (0.046, 0.176)]
    inner = [(r - 0.004, y + 0.003) for (r, y) in outer[:-1]] + [(0.0, 0.18)]
    with dens(1.5):
        lathe('misc', outer, M, 36, ENAMEL_DK, out=True)
        lathe('misc', inner, M, 36, ENAMEL_WH, out=False)
    with dens(0.6):
        put(bm_torus(0.21, 0.005, 36, 6), 'misc', M @ Matrix.Translation((0, 0.002, 0)), mul(ENAMEL_DK, 1.1), smooth=True)
        # Porcelain socket inside, the steel socket housing on top, the drop rod and its canopy (or a beam clamp).
        lathe('misc', [(0.0, 0.1), (0.026, 0.1), (0.028, 0.115), (0.026, 0.17), (0.0, 0.17)], M, 16, ENAMEL_WH)
        lathe('misc', [(0.0, 0.176), (0.04, 0.176), (0.044, 0.19), (0.044, 0.245), (0.036, 0.258), (0.016, 0.262), (0.0, 0.262)], M, 20, mul(ENAMEL_DK, 1.3))
        top = BEAM_B - 0.03 if beam_hung else H - 0.012
        cyly('steel', 0.011, yb + 0.262, top, x, z, 10, mul(WHITE, 0.4))
        if beam_hung:
            BX('steel', 0.07, 0.035, 0.07, x, BEAM_B - 0.0175, z, tint=mul(WHITE, 0.45), bevel=0.004)
            cyl_at('steel', 0.009, 0.006, (x, BEAM_B - 0.041, z), (0, 1, 0), 6, mul(WHITE, 0.5))
        else:
            lathe('misc', [(0.0, -0.032), (0.022, -0.032), (0.06, -0.012), (0.064, 0.0), (0.0, 0.0)], xf(x, H, z), 20, mul(ENAMEL_DK, 1.4))
    bulb = Vector((x, yb + 0.105, z))
    put(bm_sphere(0.034, 16, 10), 'glow', xf(bulb.x, bulb.y, bulb.z, s=(1, 1.25, 1)), BULB, smooth=True)
    LIGHTS.append((bulb, 60.0, PENDANT_RGB, 'pendant', 'pendant', {'radius': 0.035}))
    # A little light leaks up through the socket housing's vents (bake only: it warms the slab over each shade).
    UPLIGHTS.append((Vector((x, yb + 0.3, z)), 5.0, PENDANT_RGB))

def bar_light(c, n, right, length=0.6, power=12.0, name='bar', temp=3000):
    """A short warm tube fixture on a wall: a steel channel housing, a frosted diffuser, end caps."""
    c, n, right = Vector(c), Vector(n).normalized(), Vector(right).normalized()
    up = n.cross(right)
    M = frame_m(c, right, up, n)
    with dens(0.8):
        put(bm_box(length + 0.03, 0.07, 0.05, 0.006), 'steel', M @ Matrix.Translation((0, 0, 0.025)), mul(WHITE, 0.6))
        for s in (-1, 1):
            put(bm_box(0.02, 0.06, 0.05, 0.004), 'misc', M @ Matrix.Translation((s * (length / 2 + 0.003), -0.004, 0.055)), BLACKP)
    bm = bm_cyl(0.021, 0.021, length - 0.01, 16, True)
    put(bm, 'glow', M @ Matrix.Translation((0, -0.01, 0.062)) @ Matrix.Rotation(-PI / 2, 4, 'Z'), BAR, smooth=lambda nn: abs(nn.x) < 0.9)
    p = M @ Vector((0, -0.01, 0.084))
    LIGHTS.append((p, power, BAR_RGB, 'bar', name, {'size': [length - 0.04, 0.035], 'normal': list((n * 0.6 - up * 0.8).normalized())}))

def lights():
    for (x, z, yb) in PENDANTS:
        pendant(x, z, yb, beam_hung=abs(x - BEAMS_X[0]) < 1e-6)
    bar_light((0.0, 2.7, 0.0), (0, 0, 1), (1, 0, 0), 0.6, 13.0, 'bar_mouth')

# ============================================================================ the decal atlas layout (painted in bake_all)
ATLAS_PX = 2048
# Fixed regions (x, y, w, h) in atlas pixels from the TOP LEFT (as the PNG looks).
ATLAS_FIXED = {
    'desk': (0, 0, 1536, 480), 'clock': (1536, 0, 256, 256), 'hazard': (1792, 0, 256, 256),
    'ring': (1536, 256, 256, 256), 'meter': (1792, 256, 128, 128), 'meter2': (1920, 256, 128, 128),
    'dial': (1792, 384, 256, 96),
    'cork': (0, 480, 1024, 683), 'bp1': (1024, 480, 512, 362), 'bp2': (1536, 480, 512, 362),
    'chart': (1024, 842, 512, 362), 'roster': (1536, 842, 256, 362), 'photo': (1792, 842, 256, 192),
    'note': (1792, 1034, 128, 128), 'note2': (1920, 1034, 128, 128),
    'print1': (0, 1163, 256, 362), 'print2': (256, 1163, 256, 362), 'print3': (512, 1204, 256, 362),
}
# Plates and labels: name -> (lines, physical w x h in metres, px per metre, style), packed below the fixed regions.
LABELS = {
    'lift': (['LIFT'], (0.42, 0.12), 900, 'plate_white'),
    'relay': (['BUNKER 7', 'SURVEY RELAY'], (0.5, 0.16), 900, 'plate_white'),
    'stair': (['STAIR', '↑', 'SURFACE'], (0.16, 0.26), 900, 'plate_green'),
    'hv': (['DANGER', 'HIGH VOLTAGE'], (0.16, 0.1), 1100, 'danger'),
    'nosmoke': (['NO', 'SMOKING'], (0.2, 0.2), 900, 'nosmoke'),
    'radar': (['RADAR  SR-4'], (0.24, 0.035), 1400, 'plate_black'),
    'term': (['TELEDATA  VT-7'], (0.14, 0.022), 1600, 'plate_black'),
    'scope': (['TEKTRA 465'], (0.1, 0.018), 1600, 'plate_black'),
    'psu': (['DUAL SUPPLY'], (0.1, 0.018), 1600, 'plate_black'),
    'locker': (['12'], (0.05, 0.03), 1600, 'plate_white'),
    'dc': (['MAIN', 'DISCONNECT'], (0.1, 0.05), 1400, 'plate_red'),
    'call': (['CALL'], (0.06, 0.022), 1600, 'plate_black'),
    'case': (['SURVEY KIT 3'], (0.2, 0.045), 1200, 'stencil_black'),
    'cab': (['SPARES'], (0.22, 0.06), 1100, 'stencil_black'),
    'ext': (['FIRE', 'EXTINGUISHER'], (0.16, 0.1), 1100, 'plate_red'),
    'intercom': (['INTERCOM'], (0.1, 0.02), 1600, 'plate_black'),
    'drw0': (['FUSES'], (0.07, 0.025), 1600, 'card'), 'drw1': (['TAPE'], (0.07, 0.025), 1600, 'card'),
    'drw2': (['MANUALS'], (0.07, 0.025), 1600, 'card'), 'drw3': (['SPARES'], (0.07, 0.025), 1600, 'card'),
    'drw4': (['CABLES'], (0.07, 0.025), 1600, 'card'), 'drw5': (['MISC'], (0.07, 0.025), 1600, 'card'),
    'brk': (['1 LIGHTS', '2 RADAR', '3 SCOPE', '4 TERM', '5 HVAC', '6 LIFT'], (0.1, 0.12), 1400, 'card'),
}

def atlas_layout():
    """Atlas regions as Blender UV rects (u0, v0, u1, v1), and their pixel rects (x, y, w, h) from the top left."""
    px = dict(ATLAS_FIXED)
    # Shelf-pack the labels into the space left: x 768..2048 from y 1204, then x 0..768 from y 1566 (under the printouts).
    areas = [dict(x0=768, y0=1204, x1=2048, y1=2048), dict(x0=0, y0=1566, x1=768, y1=2048)]
    for a in areas:
        a.update(cx=a['x0'], sy=a['y0'], sh=0)
    items = sorted(LABELS.items(), key=lambda kv: -int(kv[1][1][1] * kv[1][2]))
    for name, (_l, (w, h), ppm, _s) in items:
        pw, ph = int(math.ceil(w * ppm)) + 4, int(math.ceil(h * ppm)) + 4
        placed = False
        for a in areas:
            cx, sy, sh = a['cx'], a['sy'], a['sh']
            if cx + pw > a['x1']:
                cx, sy, sh = a['x0'], sy + sh, 0
            if sy + ph <= a['y1'] and cx + pw <= a['x1']:
                px[name] = (cx + 2, sy + 2, pw - 4, ph - 4)
                a['cx'], a['sy'], a['sh'] = cx + pw, sy, max(sh, ph)
                placed = True
                break
        if not placed:
            raise RuntimeError('atlas full: ' + name)
    uv = {}
    for k, (x, y, w, h) in px.items():
        # Half a texel in so filtering never reaches a neighbour.
        uv[k] = ((x + 0.5) / ATLAS_PX, 1.0 - (y + h - 0.5) / ATLAS_PX, (x + w - 0.5) / ATLAS_PX, 1.0 - (y + 0.5) / ATLAS_PX)
    return uv, px

ATLAS, ATLAS_RECT = atlas_layout()

# ============================================================================ furniture helpers
def bar_pull(g, lx, ly, lz, length=0.14, vertical=False, tint=mul(WHITE, 0.75)):
    """A steel bar pull on two stand-offs, on a face at lz (local +z out)."""
    for s in (-1, 1):
        ox, oy = (0, s * length / 2) if vertical else (s * length / 2, 0)
        x, y, z = g.p(lx + ox, ly + oy, lz + 0.013)
        cyl_at('steel', 0.006, 0.026, g.p(lx + ox, ly + oy, lz), g.dir((0, 0, 1)), 8, tint)
    if vertical:
        GB(g, 'steel', 0.012, length + 0.024, 0.012, lx, ly, lz + 0.03, tint=tint, bevel=0.004)
    else:
        GB(g, 'steel', length + 0.024, 0.012, 0.012, lx, ly, lz + 0.03, tint=tint, bevel=0.004)

def card_holder(g, lx, ly, lz, name):
    GB(g, 'steel', 0.08, 0.034, 0.003, lx, ly, lz + 0.0015, tint=mul(WHITE, 0.7), bevel=0.001)
    n = Vector(g.dir((0, 0, 1)))
    label(name, g.p(lx, ly, lz + 0.003), n, g.dir((1, 0, 0)), 0.07, 0.025, lift=0.0006)

def louvres(g, mat, lx0, lx1, y0, y1, lz, n, tint=WHITE):
    """Pressed louvres: a row of dark slots, each under a slanted lip."""
    w = lx1 - lx0
    for k in range(n):
        y = y0 + (k + 0.5) * (y1 - y0) / n
        GB(g, 'misc', w, 0.007, 0.002, (lx0 + lx1) / 2, y - 0.003, lz + 0.001, tint=mul(BLACKP, 0.5))
        GB(g, mat, w, 0.013, 0.004, (lx0 + lx1) / 2, y + 0.003, lz + 0.004, rx=-0.7, tint=tint)

def dented(g, mat, lx, ly, lz, w, h, seed, n=3, depth=0.004, tint=WHITE):
    """A flat panel face (local +z out) with a few shallow dents, as a fine grid."""
    rs = random.Random(seed)
    dd = [(rs.uniform(-w * 0.4, w * 0.4), rs.uniform(-h * 0.4, h * 0.4), rs.uniform(0.025, 0.07), rs.uniform(0.4, 1.0) * depth) for _ in range(n)]
    def P(u, v):
        e = max(0.0, min(1.0, (w / 2 - abs(u)) / 0.04, (h / 2 - abs(v)) / 0.04))
        dz = -sum(d * math.exp(-((u - cu) ** 2 + (v - cv) ** 2) / (r * r)) for (cu, cv, r, d) in dd) * e
        return (u, v, dz)
    bm = grid_sheet(steps(-w / 2, w / 2, 0.035), steps(-h / 2, h / 2, 0.035), P, (0, 0, 1))
    put(bm, mat, GM(g, lx, ly, lz), tint, smooth=True)

def door(g, mat, lx, ly, lz, w, h, t=0.02, seed=0, dents=2, wear=0.5, tint=WHITE):
    """A steel door/drawer front: bevelled edges worn to steel, a (dented) face at lz + t."""
    b = 0.006
    bm = bm_box(w, h, t, b, 1)
    cull(bm, lambda f: f.normal.z > 0.99 or f.normal.z < -0.99)
    put_worn(bm, mat, GM(g, lx, ly, lz + t / 2), tint, wear)
    if dents:
        dented(g, mat, lx, ly, lz + t, w - 2 * b, h - 2 * b, seed, dents, tint=tint)
    else:
        GB(g, mat, w - 2 * b, h - 2 * b, 0.0, lx, ly, lz + t, tint=tint, hide=(0, 0, -1))

def carton(x, y, z, w, h, d, ry=0.0, tint=CARDBOARD, tape=True):
    """A cardboard box: flaps' seam, packing tape along it and down the ends."""
    BX('misc', w, h, d, x, y + h / 2, z, ry, tint=tint, bevel=0.004, var=0.08, hide=(0, -1, 0))
    g = G(x, y, z, ry)
    GB(g, 'misc', w + 0.002, 0.003, 0.004, 0, h + 0.0005, 0, tint=mul(tint, 0.6))
    if tape:
        GB(g, 'misc', w * 0.98, 0.002, 0.05, 0, h + 0.001, 0, tint=TAPE)
        for s in (-1, 1):
            GB(g, 'misc', 0.002, 0.08, 0.05, s * (w / 2 + 0.001), h - 0.04, 0, tint=TAPE)

def knob(p, n, r=0.012, h=0.016, tint=RUBBER, cap=mul(WHITE, 0.7)):
    cyl_at('misc', r, h, p, n, 14, tint)
    cyl_at('steel', r * 0.55, 0.002, Vector(p) + Vector(n).normalized() * h, n, 12, cap)

def led(p, n, col, r=0.005, kind=0):
    with layer('led'):
        cyl_at('glow', r, 0.004, p, n, 10, col)

def toggle(p, n, up=(0, 1, 0)):
    n = Vector(n).normalized()
    cyl_at('steel', 0.007, 0.006, p, n, 10, mul(WHITE, 0.6))
    tip = Vector(p) + n * 0.022 + Vector(up) * 0.008
    put(bm_tube([tuple(Vector(p) + n * 0.005), tuple(tip)], 0.0025, 6), 'steel', None, mul(WHITE, 0.8), smooth=True)

def screen_rect(M, w, h, mode, sid, curve=0.006, nx=10, ny=8):
    """A CRT face (M's local XY, facing +Z) packed (mode + u, id + v) for SCREEN_FRAG."""
    bm = bmesh.new()
    lay = bm.verts.layers.float_vector.new('st')
    grid = []
    for j in range(ny + 1):
        row = []
        for k in range(nx + 1):
            u, v = k / nx, j / ny
            bulge = curve * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
            vv = bm.verts.new(((u - 0.5) * w, (v - 0.5) * h, bulge))
            vv[lay] = Vector((u, v, 0))
            row.append(vv)
        grid.append(row)
    for j in range(ny):
        for k in range(nx):
            bm.faces.new((grid[j][k], grid[j][k + 1], grid[j + 1][k + 1], grid[j + 1][k]))
    uvf = lambda f: [(mode + 0.02 + 0.96 * l.vert[lay].x, sid + 0.02 + 0.96 * l.vert[lay].y) for l in f.loops]
    put(bm, 'screen', M, WHITE, smooth=True, uvface=uvf)

def screen_disc(M, R, mode, sid, curve=0.012, rings=8, segs=40):
    """A round CRT face of radius R (local XY, facing +Z), mapped so SCREEN_FRAG's radar (rim at 0.48) fills it."""
    bm = bmesh.new()
    lay = bm.verts.layers.float_vector.new('st')
    c = bm.verts.new((0, 0, curve))
    c[lay] = Vector((0, 0, 0))
    rs = []
    for i in range(1, rings + 1):
        r = R * i / rings
        ring = []
        for k in range(segs):
            a = 2 * PI * k / segs
            v = bm.verts.new((r * math.cos(a), r * math.sin(a), curve * (1 - (r / R) ** 2)))
            v[lay] = Vector((r * math.cos(a) / R, r * math.sin(a) / R, 0))
            ring.append(v)
        rs.append(ring)
    for k in range(segs):
        bm.faces.new((c, rs[0][k], rs[0][(k + 1) % segs]))
    for i in range(rings - 1):
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new((rs[i][k], rs[i + 1][k], rs[i + 1][j], rs[i][j]))
    orient(bm, lambda p: Vector((0, 0, 1)))
    uvf = lambda f: [(mode + 0.5 + 0.384 * l.vert[lay].x, sid + 0.5 + 0.48 * l.vert[lay].y) for l in f.loops]
    put(bm, 'screen', M, WHITE, smooth=True, uvface=uvf)

def term_glass(M, w, h, curve=0.012, nx=16, ny=12):
    """The terminal's glass in layer 'term': plain UV 0..1, u right, v up seen from the front."""
    bm = bmesh.new()
    lay = bm.verts.layers.float_vector.new('st')
    grid = []
    for j in range(ny + 1):
        row = []
        for k in range(nx + 1):
            u, v = k / nx, j / ny
            bulge = curve * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
            vv = bm.verts.new(((u - 0.5) * w, (v - 0.5) * h, bulge))
            vv[lay] = Vector((u, v, 0))
            row.append(vv)
        grid.append(row)
    for j in range(ny):
        for k in range(nx):
            bm.faces.new((grid[j][k], grid[j][k + 1], grid[j + 1][k + 1], grid[j + 1][k]))
    with layer('term'):
        put(bm, 'screen', M, WHITE, smooth=True, uvface=lambda f: [(l.vert[lay].x, l.vert[lay].y) for l in f.loops])

# ============================================================================ the workbench (+x wall)
def gdesk():
    return G(HW, 0.0, (DESK['z0'] + DESK['z1']) / 2, -PI / 2)      # local +z out of the wall (-x), local +x = room +z

def pedestal(g, l0, l1, seed):
    """An orange heavy-duty drawer pedestal: a shallow, a middle and a deep drawer, pulls and label cards."""
    lx = (l0 + l1) / 2
    w = l1 - l0
    depth = 0.71
    GB(g, 'orange', w, 0.67, depth, lx, 0.05 + 0.335, 0.02 + depth / 2, bevel=0.012, wear=0.55, hide=[(0, 0, -1), (0, -1, 0)])
    GB(g, 'misc', w - 0.03, 0.05, depth - 0.04, lx, 0.025, 0.02 + depth / 2 - 0.01, tint=mul(BLACKP, 1.2), hide=(0, -1, 0))   # plinth
    fz = 0.02 + depth
    GB(g, 'misc', w - 0.02, 0.64, 0.002, lx, 0.05 + 0.33, fz + 0.001, tint=mul(BLACKP, 0.7))
    ys = [(0.07, 0.25), (0.255, 0.475), (0.48, 0.705)][::-1]
    for i, (y0, y1) in enumerate(ys):
        door(g, 'orange', lx, (y0 + y1) / 2, fz + 0.002, w - 0.03, y1 - y0 - 0.008, 0.018, seed * 7 + i, dents=1 if i == 2 else 0, wear=0.6)
        yc = y1 - 0.045 if i < 2 else (y0 + y1) / 2 + 0.06
        bar_pull(g, lx, yc, fz + 0.02, 0.16)
        card_holder(g, lx, yc - 0.045, fz + 0.02, 'drw%d' % ((seed * 3 + i) % 6))

def desk():
    g = gdesk()
    x0, x1 = -1.2, 1.2                              # along the wall (room z = 2.1 + lx)
    dd, top = 0.75, DESK['top']
    # The worn top (decal: a painted, scratched and ringed board) with a black T-moulding edge.
    O = Vector(g.p(x0, top, dd))                     # front-left corner seen from the chair
    sheet(ATLAS['desk'], O, g.dir((1, 0, 0)), g.dir((0, 0, -1)), x1 - x0, dd, nu=8, nv=3)
    with dens(0.7):
        GB(g, 'misc', x1 - x0 + 0.01, 0.04, 0.012, 0, top - 0.02, dd + 0.004, tint=BLACKP, bevel=0.004)
        for s in (-1, 1):
            GB(g, 'misc', 0.012, 0.04, dd, s * (x1 - x0 + 0.012) / 2, top - 0.02, dd / 2, tint=BLACKP, bevel=0.004)
        GB(g, 'misc', x1 - x0, 0.032, dd - 0.01, 0, top - 0.024, dd / 2 - 0.005, tint=mul(CORKWOOD, 0.5), hide=[(0, 1, 0), (0, 0, -1)])
    # Pedestals under its ends, a steel apron and stretcher between them, a modesty panel at the back.
    pedestal(g, PED_A[0] - 2.1, PED_A[1] - 2.1, 1)
    pedestal(g, PED_B[0] - 2.1, PED_B[1] - 2.1, 2)
    a0, a1 = PED_A[1] - 2.1, PED_B[0] - 2.1
    with dens(0.7):
        GB(g, 'steel', a1 - a0, 0.006, 0.05, (a0 + a1) / 2, top - 0.043, dd - 0.05, tint=mul(PAINTED, 1.2))
        GB(g, 'steel', a1 - a0, 0.06, 0.006, (a0 + a1) / 2, top - 0.07, dd - 0.03, tint=mul(PAINTED, 1.2))
        GB(g, 'orange', a1 - a0, 0.45, 0.012, (a0 + a1) / 2, 0.45, 0.03, bevel=0.004, wear=0.3, hide=(0, 0, -1))
        GB(g, 'steel', a1 - a0, 0.03, 0.03, (a0 + a1) / 2, 0.1, 0.4, tint=PAINTED, bevel=0.003)
    # A cable grommet and the terminal's cables down the back to the floor and the wall.
    cyl_at('misc', 0.025, 0.004, g.p(0.02, top + 0.0005, 0.05), (0, 1, 0), 16, BLACKP)
    for k, (lx, r) in enumerate(((0.0, 0.007), (0.025, 0.005), (0.75, 0.005))):
        tube('misc', [g.p(lx, 0.95, 0.12), g.p(lx + 0.02, top + 0.02, 0.06), g.p(lx + 0.02, 0.4, 0.04 + 0.01 * k), g.p(lx + 0.1, 0.02, 0.05 + 0.02 * k), g.p(lx + 0.4 + 0.1 * k, 0.012, 0.03)], r, 6, BLACKP, rad=0.06)
    terminal(g)
    keyboard(g)
    desk_lamp(g)
    scope_stack(g)
    desk_things(g)
    OBB(*desk_obb())

def desk_obb():
    return ((DESK['x0'] + DESK['x1']) / 2, (DESK['z0'] + DESK['z1']) / 2, DESK['x1'] - DESK['x0'] + 0.02, DESK['z1'] - DESK['z0'] + 0.02, 0.0, 1.3)

def terminal(g):
    """The usable terminal: an orange CRT housing with a deep bezel, a tapered back, a chin with its brand, knobs and LED."""
    lz_apex = HW - TERM.x                                  # 0.465
    gy = TERM.y
    ow, top, bot = 0.24, 1.26, 0.8
    fz = lz_apex + 0.005                                   # the bezel's front plane
    hw_o, hh_o = 0.2, 0.155                                # the opening
    gw, gh = TERM_W / 2, TERM_H / 2
    with dens(1.4):
        GB(g, 'orange', 2 * ow, top - bot, 0.28, 0, (top + bot) / 2, fz - 0.032 - 0.14, bevel=0.022, seg=2, wear=0.35, hide=[(0, 0, 1), (0, 0, -1)])
        # The front frame round the opening: one bevelled ring.
        outer = [(-ow, bot - gy), (ow, bot - gy), (ow, top - gy), (-ow, top - gy)]
        inner = [(-hw_o, -hh_o), (hw_o, -hh_o), (hw_o, hh_o), (-hw_o, hh_o)]
        bm = bm_loop_ring(outer, inner, 0.03)
        cull(bm, facing((0, 0, -1)))
        put(bm, 'orange', GM(g, 0, gy, fz - 0.015), WHITE)
        # A rounded lip round the outside of the frame.
        for (a, b) in zip(outer, outer[1:] + outer[:1]):
            put(bm_tube([g.p(a[0], gy + a[1], fz - 0.004), g.p(b[0], gy + b[1], fz - 0.004)], 0.005, 6), 'orange', None, mul(WHITE, 0.95), smooth=True)
        # The bezel's dark sloped lip from the opening down to the glass.
        ez = lz_apex - 0.012                               # the glass's edge plane
        q = [(-hw_o, -hh_o), (hw_o, -hh_o), (hw_o, hh_o), (-hw_o, hh_o)]
        r = [(-gw, -gh), (gw, -gh), (gw, gh), (-gw, gh)]
        for i in range(4):
            j = (i + 1) % 4
            pts = [g.p(q[i][0], gy + q[i][1], fz), g.p(q[j][0], gy + q[j][1], fz), g.p(r[j][0], gy + r[j][1], ez), g.p(r[i][0], gy + r[i][1], ez)]
            put(quad_facing(pts, g.dir((0, 0, 1))), 'misc', None, srgb(58, 52, 46))
    term_glass(GM(g, 0, gy, ez), TERM_W, TERM_H, 0.012)
    with dens(0.8):
        # The tapered back over the tube's neck, vents on top.
        poly = [(-0.2, bot + 0.05), (0.2, bot + 0.05), (0.2, top - 0.03), (-0.2, top - 0.03)]
        bm = bmesh.new()
        f0 = [bm.verts.new((u, v, 0.0)) for (u, v) in poly]
        f1 = [bm.verts.new((u * 0.62, bot + 0.1 + (v - bot - 0.05) * 0.6, -0.13)) for (u, v) in poly]
        bm.faces.new(list(reversed(f1)))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((f0[i], f0[j], f1[j], f1[i]))
        orient(bm, lambda c: Vector((c.x, c.y - (top + bot) / 2, c.z + 0.065)))
        put(bm, 'orange', GM(g, 0, 0, fz - 0.31), mul(WHITE, 0.92))
        for k in range(7):
            GB(g, 'misc', 0.012, 0.002, 0.12, -0.09 + k * 0.03, top + 0.0005, fz - 0.17, tint=mul(BLACKP, 0.6))
        # Swivel stand.
        lathe('misc', [(0.0, 0.0), (0.13, 0.0), (0.13, 0.008), (0.11, 0.016), (0.04, 0.02), (0.035, 0.04), (0.0, 0.04)], GM(g, 0, DESK['top'], fz - 0.2), 24, srgb(52, 46, 40))
    # The chin: brand plate, a power LED, brightness and contrast knobs, a row of speaker slots.
    n = g.dir((0, 0, 1))
    label('term', g.p(-0.13, 0.86, fz), n, g.dir((1, 0, 0)), 0.14, 0.022)
    led(g.p(0.205, 0.848, fz), n, LED_GRN, 0.004)
    knob(g.p(0.13, 0.848, fz), n, 0.011, 0.012)
    knob(g.p(0.165, 0.848, fz), n, 0.011, 0.012)
    nrm = list(g.dir((0, 0, 1)))
    LIGHTS.append((Vector(g.p(0, gy, lz_apex + 0.02)), 3.5, (0.3, 0.55, 1.0), 'screen', 'terminal', {'size': [TERM_W, TERM_H], 'normal': nrm}))
    empty('TERMINAL', tuple(TERM), w=TERM_W, h=TERM_H, normal=[float(c) for c in nrm])

def keyboard(g):
    """A beige terminal keyboard with dark brown keycaps (cream on the alphas' edges), tilted a little toward you."""
    Mk = GM(g, 0, DESK['top'] + 0.018, 0.62, rx=0.07)
    with dens(1.2):
        put(bm_box(0.47, 0.03, 0.19, 0.008), 'misc', Mk, KEYBASE)
        put(bm_box(0.45, 0.004, 0.17, 0.002), 'misc', Mk @ Matrix.Translation((0, 0.015, 0)), mul(KEYBASE, 0.55))
    rows = [(14, 0.0), (14, 0.25), (13, 0.4), (12, 0.6)]
    p = 0.0285
    with dens(0.5):
        for r, (n, off) in enumerate(rows):
            zz = -0.06 + r * p
            for k in range(n):
                xx = -0.2 + (k + off) * p
                edge = k == 0 or k == n - 1
                tint = KEYCREAM if edge or (r == 0 and k > 10) else KEYCAP
                put(bm_box(0.024, 0.012, 0.024, 0.003), 'misc', Mk @ Matrix.Translation((xx, 0.021, zz)) @ Matrix.Rotation(-0.06 * (r - 1.5), 4, 'X'), tint, var=0.05)
        put(bm_box(0.17, 0.012, 0.024, 0.003), 'misc', Mk @ Matrix.Translation((-0.02, 0.021, -0.06 + 4 * p)), KEYCREAM)
        for k in range(3):
            put(bm_box(0.024, 0.012, 0.024, 0.003), 'misc', Mk @ Matrix.Translation((0.14 + k * p, 0.021, -0.06 + 4 * p)), KEYCAP)
    # Its coiled cable off the back toward the terminal.
    pts = []
    for i in range(40):
        t = i / 39
        a = t * 2 * PI * 10
        base = Vector(g.p(0.1 + 0.05 * t, DESK['top'] + 0.012, 0.52 - 0.1 * t))
        pts.append(tuple(base + Vector((0.006 * math.cos(a), 0.006 * math.sin(a) + 0.004, 0))))
    with dens(0.4):
        put(bm_tube(pts, 0.0025, 5), 'misc', None, mul(KEYBASE, 0.6), smooth=True)

def desk_lamp(g):
    """A gooseneck desk lamp: a weighted base, a ribbed neck, a small green enamel shade over the desk's left."""
    bx, bz = -0.86, 0.2
    y0 = DESK['top']
    with dens(1.2):
        lathe('misc', [(0.0, 0.0), (0.075, 0.0), (0.078, 0.008), (0.07, 0.022), (0.03, 0.03), (0.016, 0.04), (0.0, 0.04)], GM(g, bx, y0, bz), 24, LAMPGREEN)
        cyl_at('steel', 0.006, 0.006, g.p(bx + 0.04, y0 + 0.024, bz + 0.03), g.dir((0.6, 0.5, 0.6)), 8, mul(WHITE, 0.7))
    tip = Vector(g.p(bx + 0.18, y0 + 0.48, bz + 0.3))
    pts = rounded_pts([g.p(bx, y0 + 0.035, bz), g.p(bx, y0 + 0.28, bz + 0.02), g.p(bx + 0.06, y0 + 0.46, bz + 0.12), tuple(tip)], 0.1, 8)
    with dens(0.6):
        put(bm_tube(pts, 0.008, 8), 'steel', None, mul(WHITE, 0.6), smooth=True)
        for i in range(2, len(pts) - 1, 2):
            put(bm_tube([pts[i - 1], pts[i]], 0.0092, 8), 'steel', None, mul(WHITE, 0.45), smooth=True)
    # The shade points down and out over the desk's left end.
    dvec = (Vector(g.p(bx + 0.24, y0, bz + 0.42)) - tip).normalized()
    Ms = Matrix.Translation(tip + dvec * 0.03) @ axis_to(-dvec)
    with dens(1.4):
        prof = [(0.082, -0.08), (0.08, -0.07), (0.07, -0.045), (0.05, -0.02), (0.03, -0.005), (0.018, 0.0)]
        lathe('misc', prof, Ms, 28, LAMPGREEN, out=True)
        lathe('misc', [(r - 0.003, y - 0.002) for (r, y) in prof[:-1]] + [(0.0, -0.006)], Ms, 28, ENAMEL_WH, out=False)
        put(bm_torus(0.081, 0.003, 28, 5), 'misc', Ms @ Matrix.Translation((0, -0.078, 0)), mul(LAMPGREEN, 1.2), smooth=True)
    bulb = tip + dvec * 0.075
    put(bm_sphere(0.017, 12, 8), 'glow', xf(bulb.x, bulb.y, bulb.z), BULB, smooth=True)
    LIGHTS.append((bulb, 9.0, LAMP_RGB, 'lamp', 'desk_lamp', {'radius': 0.018, 'dir': list(dvec)}))

def scope_stack(g):
    """The oscilloscope (a small blue CRT, knobs, BNC sockets, a carrying handle) on a bench power supply with two meters."""
    lx = SCOPE_Z - 2.1
    f = 0.42                       # front plane (local z)
    y0 = DESK['top']
    n = g.dir((0, 0, 1))
    right = g.dir((1, 0, 0))
    with dens(1.1):
        # Power supply.
        GB(g, 'green', 0.3, 0.13, 0.3, lx, y0 + 0.065, f - 0.15, tint=GREYGREEN, bevel=0.008, wear=0.35, hide=(0, -1, 0))
        GB(g, 'misc', 0.28, 0.11, 0.004, lx, y0 + 0.065, f + 0.002, tint=srgb(40, 42, 44))
        for k, nm in enumerate(('meter', 'meter2')):
            GB(g, 'misc', 0.07, 0.06, 0.006, lx - 0.1 + k * 0.08, y0 + 0.08, f + 0.004, tint=BLACKP)
            label(nm, g.p(lx - 0.1 + k * 0.08, y0 + 0.08, f + 0.007), n, right, 0.06, 0.05, lift=0.0005)
        for k in range(2):
            knob(g.p(lx + 0.05 + k * 0.045, y0 + 0.085, f + 0.004), n, 0.012, 0.014)
        for k, col in enumerate((srgb(150, 20, 15), BLACKP, srgb(150, 20, 15), BLACKP)):
            cyl_at('misc', 0.006, 0.012, g.p(lx + 0.03 + k * 0.025, y0 + 0.035, f + 0.004), n, 8, col)
        label('psu', g.p(lx - 0.06, y0 + 0.032, f + 0.004), n, right, 0.1, 0.018, lift=0.0006)
        led(g.p(lx + 0.12, y0 + 0.035, f + 0.004), n, LED_RED, 0.004)
        # The scope.
        sy0 = y0 + 0.13
        GB(g, 'green', 0.3, 0.2, 0.34, lx, sy0 + 0.1, f - 0.17, tint=mul(GREYGREEN, 0.95), bevel=0.01, wear=0.4, hide=(0, -1, 0))
        GB(g, 'misc', 0.284, 0.184, 0.004, lx, sy0 + 0.1, f + 0.002, tint=srgb(34, 36, 38))
        # Handle over the top.
        for s in (-1, 1):
            GB(g, 'misc', 0.012, 0.03, 0.03, lx + s * 0.12, sy0 + 0.215, f - 0.17, tint=BLACKP)
        tube('steel', [g.p(lx - 0.12, sy0 + 0.22, f - 0.17), g.p(lx - 0.12, sy0 + 0.24, f - 0.17), g.p(lx + 0.12, sy0 + 0.24, f - 0.17), g.p(lx + 0.12, sy0 + 0.22, f - 0.17)], 0.007, 8, mul(WHITE, 0.7), rad=0.02)
    # The CRT: a square bezel and the glass, on the panel's left.
    cx, cy = lx - 0.06, sy0 + 0.11
    with dens(1.2):
        for (w, h, ox, oy) in ((0.15, 0.012, 0, 0.06), (0.15, 0.012, 0, -0.06), (0.012, 0.132, -0.07, 0), (0.012, 0.132, 0.07, 0)):
            GB(g, 'misc', w, h, 0.012, cx + ox, cy + oy, f + 0.008, tint=srgb(26, 26, 28), bevel=0.002)
    Mg = GM(g, cx, cy, f + 0.004)
    screen_rect(Mg, 0.128, 0.104, 1, 0, 0.004)
    empty('SCREEN_SCOPE', g.p(cx, cy, f + 0.008), w=0.128, h=0.104, normal=[float(c) for c in n])
    LIGHTS.append((Vector(g.p(cx, cy, f + 0.02)), 1.2, (0.3, 0.55, 1.0), 'screen', 'scope', {'size': [0.128, 0.104], 'normal': list(n)}))
    with dens(0.8):
        for (ox, oy, r) in ((0.045, 0.06, 0.011), (0.09, 0.06, 0.011), (0.045, 0.02, 0.009), (0.09, 0.02, 0.009), (0.12, 0.06, 0.008), (0.12, 0.02, 0.008)):
            knob(g.p(lx + ox, sy0 + 0.1 + oy, f + 0.004), n, r, 0.014)
        for ox in (0.045, 0.09):
            cyl_at('steel', 0.006, 0.014, g.p(lx + ox, sy0 + 0.04, f + 0.004), n, 10, mul(WHITE, 0.85))
        toggle(g.p(lx + 0.12, sy0 + 0.04, f + 0.004), n)
        label('scope', g.p(lx - 0.06, sy0 + 0.035, f + 0.004), n, right, 0.1, 0.018, lift=0.0006)
        led(g.p(lx - 0.12, sy0 + 0.035, f + 0.004), n, LED_AMB, 0.004)
        # The probe leads, one off the front and over the desk.
        tube('misc', [g.p(lx + 0.045, sy0 + 0.04, f + 0.018), g.p(lx + 0.03, y0 + 0.03, f + 0.12), g.p(lx - 0.1, y0 + 0.006, f + 0.2), g.p(lx - 0.22, y0 + 0.006, f + 0.18)], 0.0028, 6, srgb(30, 40, 70), rad=0.05)
        tube('misc', [g.p(lx + 0.09, sy0 + 0.04, f + 0.018), g.p(lx + 0.1, y0 + 0.02, f + 0.1), g.p(lx + 0.16, y0 + 0.006, f + 0.24)], 0.0028, 6, BLACKP, rad=0.05)

def mug(p, ry=0.0):
    """A chipped enamel camp mug with cold coffee in it."""
    x, y, z = p
    M = xf(x, y, z, ry)
    with dens(1.0):
        lathe('misc', [(0.0, 0.0), (0.038, 0.0), (0.041, 0.006), (0.042, 0.09), (0.044, 0.095)], M, 24, srgb(214, 210, 196))
        lathe('misc', [(0.044, 0.095), (0.04, 0.094), (0.039, 0.01), (0.0, 0.01)], M, 24, srgb(200, 196, 182), out=False)
        put(bm_torus(0.043, 0.0025, 24, 5), 'misc', M @ Matrix.Translation((0, 0.095, 0)), srgb(30, 40, 90), smooth=True)
        lathe('misc', [(0.0, 0.06), (0.039, 0.06)], M, 24, srgb(24, 14, 8))
        hp = [tuple(M @ Vector((0.04 + 0.024 * math.sin(PI * t / 10), 0.05 + 0.026 * math.cos(PI * t / 10), 0.0))) for t in range(11)]
        put(bm_tube(hp, 0.0055, 6), 'misc', None, srgb(214, 210, 196), smooth=True)

def desk_things(g):
    y0 = DESK['top']
    mug(g.p(0.4, y0, 0.6), 0.6)
    # Printouts, a clipboard with a roster on it, binders, a pencil pot, a sticky note on the terminal's chin.
    def paper(name, lx, lz, a, w=0.21, h=0.297, yo=0.0006, nu=3, nv=4, lift=None):
        c = Vector(g.p(lx, y0 + yo, lz))
        U = Vector(g.dir((math.cos(a), 0, -math.sin(a))))
        V = Vector(g.dir((-math.sin(a), 0, -math.cos(a))))
        O = c - U * (w / 2) - V * (h / 2)
        sheet(ATLAS[name], O, U, V, w, h, nu, nv, lift=lift, back=PAPER)
    paper('print1', -0.42, 0.52, 0.12, lift=lambda s, t: (0, 0, 0.012 * max(0.0, s - 0.75) ** 2 * 16))
    paper('print2', -0.3, 0.46, -0.25, yo=0.0014)
    # Clipboard.
    cx, cz, a = -1.0, 0.5, 0.3
    with dens(0.8):
        GB(g, 'misc', 0.23, 0.004, 0.32, cx, y0 + 0.002, cz, ry=a, tint=srgb(120, 84, 50))
        GB(g, 'steel', 0.12, 0.012, 0.03, cx + math.sin(a) * 0.13, y0 + 0.008, cz + math.cos(a) * -0.13, ry=a, tint=mul(WHITE, 0.8), bevel=0.003)
    paper('roster', cx, cz + 0.01, -a, 0.2, 0.28, yo=0.0045)
    # Binders lying at the far end, a pencil pot.
    for k, col in enumerate((srgb(30, 60, 110), srgb(120, 30, 24), srgb(40, 40, 40))):
        GB(g, 'misc', 0.32, 0.05, 0.27, -1.0 + 0.01 * k, y0 + 0.025 + 0.05 * k + 0.001, 0.2, ry=0.05 * (k - 1), tint=col, bevel=0.004, var=0.05)
    with dens(0.8):
        lathe('misc', [(0.0, 0.0), (0.035, 0.0), (0.035, 0.11), (0.031, 0.11), (0.031, 0.006), (0.0, 0.006)], GM(g, -0.62, y0, 0.12), 18, srgb(60, 70, 64))
        for k in range(6):
            a = k * 1.1
            p0 = Vector(g.p(-0.62 + 0.012 * math.cos(a), y0 + 0.01, 0.12 + 0.012 * math.sin(a)))
            d = Vector(g.dir((0.12 * math.cos(a), 1.0, 0.12 * math.sin(a)))).normalized()
            col = [YELLOW, srgb(30, 30, 30), srgb(160, 30, 20), YELLOW, srgb(40, 80, 140), YELLOW][k]
            cyl_at('misc', 0.0035, 0.16 + 0.015 * (k % 3), p0, d, 6, col)
    # A sticky note on the terminal's chin.
    fz = HW - TERM.x + 0.005
    label('note', g.p(0.035, 0.858, fz + 0.001), g.dir((0, 0, 1)), g.dir((1, 0, 0)), 0.062, 0.062, lift=0.0008)
    # A speaker at the far end and a small transistor radio.
    with dens(0.9):
        GB(g, 'misc', 0.16, 0.22, 0.14, 1.06, y0 + 0.11, 0.18, ry=-0.15, tint=srgb(54, 44, 36), bevel=0.006)
        GB(g, 'misc', 0.13, 0.18, 0.004, 1.06 + 0.07 * math.sin(-0.15) * 0, y0 + 0.11, 0.25, ry=-0.15, tint=srgb(24, 22, 20))

def corkboard():
    g = G(HW, 0.0, 1.4, -PI / 2)
    w, h, y0 = 0.9, 0.6, 1.3
    with dens(0.9):
        for (bw, bh, ox, oy) in ((w + 0.06, 0.03, 0, h / 2 + 0.015), (w + 0.06, 0.03, 0, -h / 2 - 0.015), (0.03, h, -w / 2 - 0.015, 0), (0.03, h, w / 2 + 0.015, 0)):
            GB(g, 'misc', bw, bh, 0.025, ox, y0 + h / 2 + oy, 0.0125, tint=CORKWOOD, bevel=0.005, var=0.05, hide=(0, 0, -1))
    sheet(ATLAS['cork'], g.p(-w / 2, y0, 0.012), g.dir((1, 0, 0)), (0, 1, 0), w, h)
    # The pinned sheets, proud of the cork, curling at a corner; drawing pins.
    pins = []
    def pinned(name, cx, cy, w2, h2, a=0.0, curl=0.0):
        U = Vector(g.dir((math.cos(a), 0, 0))) + Vector((0, math.sin(a), 0))
        V = Vector((0, math.cos(a), 0)) - Vector(g.dir((math.sin(a), 0, 0)))
        c = Vector(g.p(cx, y0 + cy, 0.0145))
        O = c - U.normalized() * (w2 / 2) - V.normalized() * (h2 / 2)
        lift = (lambda s, t: (0, 0, curl * max(0.0, (s - 0.7) / 0.3) ** 2 * max(0.0, (t - 0.6) / 0.4))) if curl else None
        sheet(ATLAS[name], O, U, V, w2, h2, 4, 4, lift=lift, back=PAPER)
        pins.append((cx - math.cos(a) * 0 , cy + h2 / 2 - 0.02))
    pinned('bp1', -0.2, 0.36, 0.38, 0.27, 0.03, 0.02)
    pinned('chart', 0.24, 0.38, 0.33, 0.234, -0.05, 0.015)
    pinned('bp2', 0.12, 0.13, 0.3, 0.212, 0.02)
    pinned('roster', -0.33, 0.12, 0.14, 0.2, -0.04)
    pinned('photo', 0.38, 0.1, 0.12, 0.09, 0.08)
    pinned('note2', -0.05, 0.08, 0.07, 0.07, 0.1)
    with dens(0.4):
        for (px_, py_) in pins:
            p = Vector(g.p(px_, y0 + py_, 0.016))
            SPHn = bm_sphere(0.006, 8, 6)
            put(SPHn, 'misc', xf(p.x, p.y, p.z), [srgb(170, 20, 20), srgb(20, 60, 160), srgb(220, 180, 20)][int(px_ * 100) % 3], smooth=True)
    bar_light((HW, 2.0, 1.4), (-1, 0, 0), (0, 0, 1), 0.5, 9.0, 'bar_desk')

def wall_clock():
    g = G(HW, 0.0, 2.62, -PI / 2)
    cy, R = 2.04, 0.15
    with dens(1.0):
        bm = bm_ring(R - 0.004, R + 0.012, 0.0, 0.045, 48)
        put(bm, 'misc', GM(g, 0, cy, 0.0, rx=PI / 2), srgb(30, 30, 30), smooth=lambda nn: abs(nn.y) < 0.9)
        put(bm_torus(R + 0.004, 0.006, 48, 6), 'steel', GM(g, 0, cy, 0.045, rx=PI / 2), mul(WHITE, 0.8), smooth=True)
    sheet(ATLAS['clock'], g.p(-R, cy - R, 0.02), g.dir((1, 0, 0)), (0, 1, 0), 2 * R, 2 * R, 6, 6)
    # Hands at ten past six, the second hand red.
    c = Vector(g.p(0, cy, 0.024))
    for (ang, L, w, col, dz) in ((D2R(-(6 * 30 + 5)), 0.075, 0.009, srgb(20, 20, 20), 0.0), (D2R(-(10 * 6)), 0.115, 0.006, srgb(20, 20, 20), 0.003), (D2R(-(37 * 6)), 0.12, 0.002, srgb(170, 20, 15), 0.006)):
        tipv = Vector(g.dir((math.sin(-ang), 0, 0))) * L + Vector((0, math.cos(-ang) * L, 0))
        beam('misc', tuple(c + Vector(g.dir((0, 0, 1))) * dz), tuple(c + tipv + Vector(g.dir((0, 0, 1))) * dz), w, 0.002, tint=col)
    cyl_at('misc', 0.008, 0.01, c, g.dir((0, 0, 1)), 12, srgb(20, 20, 20))

def wall_boxes():
    # A louvred electrical box behind the scope (the room's fan), and the main disconnect between the locker and the desk.
    g = G(HW, 0.0, 2.95, -PI / 2)
    with dens(0.9):
        GB(g, 'green', 0.34, 0.42, 0.14, 0, 1.6, 0.07, tint=mul(GREYGREEN, 0.95), bevel=0.01, wear=0.4, hide=(0, 0, -1))
        louvres(g, 'green', -0.13, 0.13, 1.45, 1.75, 0.14, 9, mul(GREYGREEN, 0.95))
        for (ox, oy) in ((-0.15, 1.41), (0.15, 1.41), (-0.15, 1.79), (0.15, 1.79)):
            bolt(g.p(ox, oy, 0.14), g.dir((0, 0, 1)), r=0.006, h=0.004, washer=False)
    g = G(HW, 0.0, 0.66, -PI / 2)
    with dens(0.9):
        GB(g, 'green', 0.24, 0.36, 0.14, 0, 1.56, 0.07, tint=mul(GREYGREEN, 0.9), bevel=0.01, wear=0.5, hide=(0, 0, -1))
        GB(g, 'steel', 0.03, 0.04, 0.05, 0.135, 1.6, 0.08, tint=mul(WHITE, 0.5))
        # The handle (down: off).
        beam('misc', g.p(0.15, 1.6, 0.1), g.p(0.15, 1.46, 0.13), 0.022, 0.02, tint=srgb(150, 20, 15))
        label('dc', g.p(0, 1.68, 0.14), g.dir((0, 0, 1)), g.dir((1, 0, 0)), 0.1, 0.05)
    OBB(HW - 0.07, 0.66, 0.16, 0.26, 1.3, 1.8)
    OBB(HW - 0.07, 2.95, 0.16, 0.36, 1.35, 1.85)

# ============================================================================ the chair
def cushion(g, w, h, d, lx, ly, lz, rx, tint):
    """A plump vinyl cushion: a rounded box, its broad faces bowed out a little."""
    bm = bm_box(w, h, d, min(w, h, d) * 0.38, 4)
    flat = d > h                                   # a seat (thin in y) or a back (thin in z)
    t = h if flat else d
    for v in bm.verts:
        c = v.co
        k = max(0.0, (1 - (2 * c.x / w) ** 2) * (1 - (2 * (c.z if flat else c.y) / (d if flat else h)) ** 2))
        if flat and abs(c.y) > t * 0.3:
            c.y += math.copysign(0.012 * k, c.y)
        elif not flat and abs(c.z) > t * 0.3:
            c.z += math.copysign(0.012 * k, c.z)
    put(bm, 'misc', GM(g, lx, ly, lz, rx=rx), tint, smooth=True)

def chair():
    g = G(CHAIR[0], 0.0, CHAIR[1], PI / 2 + 0.12)
    with dens(0.8):
        for k in range(5):
            a = 2 * PI * k / 5 + 0.3
            ca, sa = math.cos(a), math.sin(a)
            p0, p1 = g.p(ca * 0.04, 0.115, sa * 0.04), g.p(ca * 0.3, 0.075, sa * 0.3)
            beam('steel', p0, p1, 0.042, 0.03, tint=mul(WHITE, 0.32), bevel=0.006)
            # A caster: its swivel stem and fork, the twin wheel.
            q = g.p(ca * 0.305, 0.0, sa * 0.305)
            cyl_at('steel', 0.008, 0.02, (q[0], 0.05, q[2]), (0, 1, 0), 8, mul(WHITE, 0.5))
            GB(g, 'misc', 0.03, 0.03, 0.04, ca * 0.31, 0.035, sa * 0.31 - 0.0, ry=-a + PI / 2, tint=RUBBER, bevel=0.005)
            for s in (-1, 1):
                w = Vector(g.dir((-sa, 0, ca))) * (s * 0.012)
                cyl_at('misc', 0.024, 0.01, (q[0] + w.x - w.x * 0.2, 0.025, q[2] + w.z - w.z * 0.2), w.normalized(), 14, mul(RUBBER, 1.3))
        lathe('misc', [(0.0, 0.08), (0.05, 0.08), (0.052, 0.14), (0.034, 0.16), (0.0, 0.16)], GM(g, 0, 0, 0), 18, BLACKP)
        # Gas lift: the black shroud, the chrome piston.
        cyly('misc', 0.028, 0.15, 0.34, *g.p(0, 0, 0)[::2], 16, mul(BLACKP, 1.3))
        cyly('steel', 0.016, 0.34, 0.44, *g.p(0, 0, 0)[::2], 14, WHITE)
        GB(g, 'steel', 0.22, 0.04, 0.24, 0, 0.455, 0.0, tint=mul(WHITE, 0.35), bevel=0.006)
        GB(g, 'misc', 0.012, 0.012, 0.12, 0.13, 0.44, 0.08, ry=0.2, tint=BLACKP, bevel=0.004)
        knob(g.p(0, 0.44, 0.125), g.dir((0, 0, 1)), 0.016, 0.02, BLACKP)
    # The orange shell and its vinyl cushion, worn shiny at the front edge.
    with dens(1.1):
        GB(g, 'orange', 0.46, 0.022, 0.44, 0, 0.482, 0.01, bevel=0.008, wear=0.5)
        cushion(g, 0.47, 0.075, 0.45, 0, 0.53, 0.012, 0.0, VINYL)
        # The back on its steel spine: a padded back on an orange shell.
        tube('steel', [g.p(0, 0.45, -0.1), g.p(0, 0.47, -0.25), g.p(0, 0.62, -0.27), g.p(0, 0.75, -0.25)], 0.014, 8, mul(WHITE, 0.4), rad=0.06)
        GB(g, 'orange', 0.42, 0.37, 0.018, 0, 0.9, -0.262, rx=-0.12, bevel=0.008, wear=0.5)
        cushion(g, 0.43, 0.38, 0.065, 0, 0.905, -0.228, -0.12, VINYL)
    empty('CHAIR', (CHAIR[0], 0.0, CHAIR[1]), ry=PI / 2 + 0.12)
    OBB(CHAIR[0], CHAIR[1], 0.6, 0.6, 0.0, 1.05, 0.12)

# ============================================================================ the -x wall: radar console, tall cabinet
def cabinet_doors(g, mat, x0, x1, y0, y1, fz, n=2, louv=True, seed=0, tint=WHITE):
    """n doors across x0..x1 between y0 and y1 on the front plane fz: louvres low down, vertical bar handles, a gap."""
    GB(g, 'misc', x1 - x0 - 0.01, y1 - y0 - 0.01, 0.002, (x0 + x1) / 2, (y0 + y1) / 2, fz + 0.001, tint=mul(BLACKP, 0.6))
    dw = (x1 - x0) / n
    for i in range(n):
        a, b = x0 + i * dw + 0.004, x0 + (i + 1) * dw - 0.004
        cx = (a + b) / 2
        door(g, mat, cx, (y0 + y1) / 2, fz + 0.002, b - a, y1 - y0 - 0.008, 0.02, seed * 5 + i, dents=2, wear=0.55, tint=tint)
        if louv:
            louvres(g, mat, cx - (b - a) * 0.32, cx + (b - a) * 0.32, y0 + 0.06, y0 + min(0.26, (y1 - y0) * 0.3), fz + 0.022, 7, tint)
        side = 1 if i % 2 == 0 else -1
        hx = b - 0.045 if side > 0 else a + 0.045
        if n == 1:
            hx = b - 0.045
        bar_pull(g, hx, (y0 + y1) / 2 + 0.05, fz + 0.022, min(0.16, (y1 - y0) * 0.4), vertical=True)
        # Hinges on the outer edges.
        ex = a + 0.004 if (side > 0 or n == 1) else b - 0.004
        for yy in (y0 + 0.12, y1 - 0.12):
            cyly('steel', 0.006, yy - 0.04, yy + 0.04, *g.p(ex, 0, fz + 0.012)[::2], 8, mul(WHITE, 0.6))

def radar_console():
    g = G(-HW, 0.0, RADAR_Z, PI / 2)            # local +z out of the wall (+x), local +x = room -z
    n = Vector(g.dir((0, 0, 1)))
    right = Vector(g.dir((1, 0, 0)))
    # The low orange cabinet under it.
    with dens(1.0):
        GB(g, 'orange', 1.2, 0.76, 0.55, 0, 0.06 + 0.38, 0.275, bevel=0.012, wear=0.55, hide=[(0, 0, -1), (0, -1, 0), (0, 0, 1)])
        GB(g, 'misc', 1.17, 0.06, 0.5, 0, 0.03, 0.25, tint=mul(BLACKP, 1.2), hide=(0, -1, 0))
        cabinet_doors(g, 'orange', -0.6, 0.6, 0.06, 0.8, 0.55, 2, True, 3)
        GB(g, 'steel', 1.24, 0.03, 0.58, 0, 0.835, 0.29, tint=mul(WHITE, 0.4), bevel=0.004, hide=(0, 0, -1))
    # The rack console: a sloped control desk, an upright panel with the round radar CRT, side cheeks, a vented top.
    gx0, gx1 = -0.5, 0.5
    y0, ys, y1 = 0.85, 1.02, 1.98
    with dens(1.1):
        GB(g, 'green', 1.0, y1 - ys, 0.4, 0, (ys + y1) / 2, 0.2, tint=GREYGREEN, bevel=0.012, wear=0.4, hide=(0, 0, -1))
        # Sloped control desk: a prism from the wall out to 0.52 at the front lip.
        poly = [(0.0, y0), (0.52, y0), (0.52, y0 + 0.05), (0.4, ys + 0.04), (0.0, ys + 0.04)]
        bm = bm_prism(poly, gx0, gx1, 'z')
        put(bm, 'green', GM(g, 0, 0, 0, ry=-PI / 2) @ Matrix.Rotation(PI, 4, 'Y') @ Matrix.Translation((0, 0, 0)), mul(GREYGREEN, 0.95))
    # (The prism's 'z' plane puts u along z; the extra turns lay it along the wall, its slope facing the room.)
    slope_n = (Vector(g.dir((0, 0, 1))) * 0.12 / 0.155 + Vector((0, 1, 0)) * 0.1 / 0.155).normalized()
    # Controls on the slope: rotary switches, toggles and lamps.
    for k in range(5):
        u = -0.36 + k * 0.18
        t = 0.45
        p = Vector(g.p(u, y0 + 0.05 + (ys + 0.04 - y0 - 0.05) * t, 0.52 - 0.12 * t))
        knob(p + slope_n * 0.002, slope_n, 0.016, 0.018, RUBBER)
        if k % 2 == 0:
            toggle(p + Vector(g.dir((0.07, 0, 0))) + slope_n * 0.002, slope_n)
        led(p + Vector(g.dir((-0.06, 0, 0))) + Vector((0, 0.035, 0)), slope_n, [LED_GRN, LED_AMB, LED_RED, LED_GRN, LED_AMB][k], 0.006)
    # The radar CRT: a thick round bezel with a bearing ring and a short hood.
    cy, fz = RADAR_Y, 0.4
    M0 = GM(g, 0, cy, fz, rx=PI / 2)        # +Y -> out of the panel
    with dens(1.3):
        put(bm_ring(RADAR_R, RADAR_R + 0.055, 0.0, 0.03, 48), 'misc', M0, srgb(36, 38, 36), smooth=lambda nn: abs(nn.y) < 0.9)
        put(bm_ring(RADAR_R + 0.042, RADAR_R + 0.052, 0.03, 0.06, 48), 'misc', M0, srgb(30, 32, 30), smooth=lambda nn: abs(nn.y) < 0.9)
        for k in range(4):
            a = PI / 4 + k * PI / 2
            bolt(g.p(math.cos(a) * (RADAR_R + 0.035), cy + math.sin(a) * (RADAR_R + 0.035), fz + 0.03), n, r=0.006, h=0.004, washer=False)
    # The bearing ring's printed scale on the bezel face (a square decal under the ring's opening is hidden by the glass).
    sheet(ATLAS['ring'], g.p(-(RADAR_R + 0.05), cy - (RADAR_R + 0.05), fz + 0.0305), right, (0, 1, 0), 2 * (RADAR_R + 0.05), 2 * (RADAR_R + 0.05), 1, 1)
    Mg = frame_m(g.p(0, cy, fz + 0.012), right, (0, 1, 0), n)
    screen_disc(Mg, RADAR_R, 2, 1, 0.014)
    empty('SCREEN_RADAR', g.p(0, cy, fz + 0.026), r=RADAR_R, normal=[float(c) for c in n])
    LIGHTS.append((Vector(g.p(0, cy, fz + 0.05)), 2.5, (0.3, 0.55, 1.0), 'screen', 'radar', {'size': [2 * RADAR_R, 2 * RADAR_R], 'normal': list(n), 'disc': True}))
    # Either side: meters, rotary switches, a row of lamps; the plate.
    for s in (-1, 1):
        ox = s * 0.36
        GB(g, 'misc', 0.09, 0.08, 0.008, ox, 1.72, fz + 0.004, tint=BLACKP)
        label('meter' if s < 0 else 'meter2', g.p(ox, 1.72, fz + 0.008), n, right, 0.078, 0.07, lift=0.0005)
        for k in range(3):
            knob(g.p(ox, 1.5 - k * 0.12, fz), n, 0.017 - 0.002 * k, 0.02)
        for k in range(4):
            led(g.p(ox - 0.045 + k * 0.03, 1.2, fz), n, [LED_GRN, LED_AMB, LED_GRN, LED_RED][(k + (s > 0)) % 4], 0.0055)
    label('radar', g.p(0, 1.88, fz), n, right, 0.24, 0.035)
    for k in range(9):
        GB(g, 'misc', 0.06, 0.002, 0.012, -0.32 + k * 0.08, y1 + 0.0005, 0.2, tint=mul(BLACKP, 0.6))
    # Angle brackets to the wall, the cable bundle up to the conduit, a receiver on a shelf above.
    for s in (-1, 1):
        GB(g, 'steel', 0.006, 0.12, 0.12, s * 0.45, y1 + 0.06, 0.06, tint=PAINTED)
    with dens(0.6):
        for k in range(3):
            tube('misc', [g.p(0.3 + 0.015 * k, y1, 0.1), g.p(0.3 + 0.015 * k, y1 + 0.05, 0.06), g.p(0.2 + 0.015 * k, 2.95 - 0.02 * k, 0.03 + 0.01 * k)], 0.006, 6, BLACKP, rad=0.05)
        GB(g, 'steel', 0.5, 0.012, 0.28, -0.1, 2.06, 0.14, tint=PAINTED, bevel=0.003)
        for s in (-1, 1):
            GB(g, 'steel', 0.006, 0.1, 0.2, -0.1 + s * 0.22, 2.0, 0.1, tint=PAINTED)
        GB(g, 'misc', 0.36, 0.17, 0.24, -0.12, 2.066 + 0.085, 0.13, tint=srgb(48, 46, 42), bevel=0.008)
        GB(g, 'misc', 0.34, 0.15, 0.004, -0.12, 2.151, 0.251, tint=srgb(30, 30, 30))
        label('dial', g.p(-0.17, 2.17, 0.254), n, right, 0.2, 0.075, lift=0.0005)
        for k in range(2):
            knob(g.p(0.0 + k * 0.04, 2.13, 0.254), n, 0.012, 0.014)
        led(g.p(0.02, 2.2, 0.254), n, LED_AMB, 0.004)
        tube('misc', [g.p(-0.12, 2.32, 0.2), g.p(-0.12, 2.36, 0.2), g.p(-0.2, 2.4, 0.18)], 0.003, 6, mul(WHITE, 0.6), rad=0.02)     # its whip aerial
    OBB(-HW + 0.3, RADAR_Z, 0.62, 1.26, 0.0, 2.3)

def tall_cabinet():
    g = G(-HW, 0.0, 2.8, PI / 2)
    with dens(0.9):
        GB(g, 'orange', 0.9, 1.88, 0.5, 0, 0.06 + 0.94, 0.25, bevel=0.012, wear=0.55, hide=[(0, 0, -1), (0, -1, 0), (0, 0, 1)])
        GB(g, 'misc', 0.87, 0.06, 0.46, 0, 0.03, 0.23, tint=mul(BLACKP, 1.2), hide=(0, -1, 0))
        cabinet_doors(g, 'orange', -0.45, 0.45, 0.06, 1.94, 0.5, 2, True, 7)
    n, right = g.dir((0, 0, 1)), g.dir((1, 0, 0))
    label('cab', g.p(0, 1.66, 0.522), n, right, 0.22, 0.06)
    # A padlocked hasp.
    with dens(0.5):
        GB(g, 'steel', 0.05, 0.02, 0.012, 0.0, 1.0, 0.528, tint=mul(WHITE, 0.6))
        lathe('misc', [(0.0, -0.02), (0.016, -0.02), (0.018, -0.012), (0.018, 0.012), (0.0, 0.016)], GM(g, 0.0, 0.97, 0.535, rx=PI / 2), 12, srgb(160, 130, 40))
    # On top: a toolbox and a carton.
    with dens(0.8):
        GB(g, 'misc', 0.42, 0.18, 0.2, -0.12, 1.94 + 0.09, 0.2, ry=0.1, tint=srgb(120, 30, 24), bevel=0.01)
        tube('misc', [g.p(-0.25, 2.12, 0.2), g.p(-0.25, 2.17, 0.2), g.p(0.0, 2.17, 0.22), g.p(0.0, 2.12, 0.22)], 0.008, 8, BLACKP, rad=0.02)
    carton(*g.p(0.24, 1.94, 0.26), 0.34, 0.18, 0.4, ry=g.ry + 0.2, tint=CARD_DK)
    OBB(-HW + 0.27, 2.8, 0.56, 0.94, 0.0, 2.3)

# ============================================================================ the front wall: locker, rack, cases, breaker panel
def locker():
    L = LOCKER
    g = G((L['x0'] + L['x1']) / 2, 0.0, L['z0'], 0.0)
    w, d, h = L['x1'] - L['x0'], L['z1'] - L['z0'], L['h']
    tint = WHITE
    with dens(1.0):
        GB(g, 'green', w, h - 0.08, d, 0, 0.08 + (h - 0.08) / 2, d / 2, tint=tint, bevel=0.012, wear=0.5, hide=[(0, 0, -1), (0, -1, 0), (0, 0, 1)])
        GB(g, 'misc', w - 0.04, 0.08, d - 0.04, 0, 0.04, d / 2 - 0.01, tint=mul(BLACKP, 1.3), hide=(0, -1, 0))
        GB(g, 'green', w + 0.016, 0.02, d + 0.016, 0, h + 0.01, d / 2, tint=tint, bevel=0.006, wear=0.6)
    fz = d
    n, right = g.dir((0, 0, 1)), g.dir((1, 0, 0))
    GB(g, 'misc', w - 0.02, h - 0.1, 0.002, 0, 0.08 + (h - 0.1) / 2, fz + 0.001, tint=mul(BLACKP, 0.6))
    for i, s in enumerate((-1, 1)):
        cx = s * w / 4
        dw = w / 2 - 0.012
        door(g, 'green', cx, 0.09 + (h - 0.12) / 2, fz + 0.002, dw, h - 0.13, 0.02, 40 + i, dents=4, wear=0.55, tint=tint)
        louvres(g, 'green', cx - dw * 0.3, cx + dw * 0.3, h - 0.42, h - 0.18, fz + 0.022, 6, tint)
        louvres(g, 'green', cx - dw * 0.3, cx + dw * 0.3, 0.2, 0.4, fz + 0.022, 5, tint)
        # The lift latch: a recessed cup with a lever, a padlock eye; hinge pins on the outer edge.
        lx = cx - s * (dw / 2 - 0.05)
        GB(g, 'steel', 0.04, 0.12, 0.012, lx, 1.05, fz + 0.026, tint=mul(WHITE, 0.55), bevel=0.003)
        GB(g, 'steel', 0.026, 0.07, 0.022, lx, 1.04, fz + 0.04, tint=mul(WHITE, 0.75), bevel=0.004)
        ex = cx + s * (dw / 2 - 0.002)
        for yy in (0.3, h - 0.3):
            cyly('steel', 0.006, yy - 0.05, yy + 0.05, *g.p(ex, 0, fz + 0.016)[::2], 8, mul(WHITE, 0.6))
        label('locker', g.p(cx, h - 0.1, fz + 0.022), n, right, 0.05, 0.03)
    # A padlock through the right door's eye, a hazard sticker, a hard hat and a carton on top.
    with dens(0.5):
        lathe('misc', [(0.0, -0.022), (0.02, -0.022), (0.022, -0.012), (0.022, 0.014), (0.0, 0.018)], GM(g, w / 4 - (w / 2 - 0.012) / 2 + 0.05, 0.96, fz + 0.05, rx=PI / 2), 12, srgb(170, 140, 40))
        put(bm_torus(0.012, 0.003, 12, 5, arc=PI), 'steel', GM(g, w / 4 - (w / 2 - 0.012) / 2 + 0.05, 0.98, fz + 0.05, rx=PI / 2) @ Matrix.Rotation(PI / 2, 4, 'Z'), mul(WHITE, 0.7), smooth=True)
    label('hazard', g.p(w / 4, 1.42, fz + 0.022), n, right, 0.16, 0.16)
    with dens(0.8):
        lathe('misc', [(0.0, 0.11), (0.08, 0.105), (0.11, 0.07), (0.125, 0.025), (0.13, 0.012), (0.17, 0.008), (0.17, 0.0), (0.0, 0.0)], GM(g, -0.2, h + 0.02, 0.22, ry=0.3) @ Matrix.Diagonal((1.0, 1.0, 1.18, 1.0)), 28, YELLOW)
    carton(*g.p(0.17, h + 0.02, 0.24), 0.4, 0.26, 0.36, ry=-0.12, tint=CARD_DK)
    OBB((L['x0'] + L['x1']) / 2, (L['z1']) / 2, w + 0.04, L['z1'] + 0.02, 0.0, 2.3)

def wire_rack():
    S = SHELF
    g = G((S['x0'] + S['x1']) / 2, 0.0, S['z0'], 0.0)
    w, d, h = S['x1'] - S['x0'], S['z1'] - S['z0'], S['h']
    chrome = mul(WHITE, 0.85)
    with dens(0.5):
        for sx in (-1, 1):
            for sz in (0.012, d - 0.012):
                cyly('steel', 0.012, 0.0, h, *g.p(sx * (w / 2 - 0.012), 0, sz)[::2], 10, chrome)
                cyly('misc', 0.016, 0.0, 0.02, *g.p(sx * (w / 2 - 0.012), 0, sz)[::2], 10, BLACKP)
        for ys in (0.15, 0.6, 1.05, 1.5, h - 0.02):
            for zz in (0.012, d - 0.012):
                GB(g, 'steel', w - 0.024, 0.008, 0.008, 0, ys, zz, tint=chrome)
                GB(g, 'steel', w - 0.024, 0.006, 0.006, 0, ys - 0.025, zz, tint=chrome)
            for sx in (-1, 1):
                GB(g, 'steel', 0.008, 0.008, d - 0.024, sx * (w / 2 - 0.012), ys, d / 2, tint=chrome)
            nw = int(w / 0.03)
            for k in range(1, nw):
                GB(g, 'steel', 0.004, 0.004, d - 0.03, -w / 2 + k * w / nw, ys + 0.004, d / 2, tint=chrome)
    # What's on it: cartons, a plastic bin, cable coils, binders, paint tins, a spare valve radio.
    with dens(0.8):
        carton(*g.p(-0.24, 0.155, 0.22), 0.4, 0.3, 0.38, ry=0.04)
        carton(*g.p(0.2, 0.155, 0.22), 0.36, 0.22, 0.38, ry=-0.06, tint=CARD_DK)
        carton(*g.p(0.22, 0.38, 0.22), 0.3, 0.16, 0.32, ry=0.1, tape=False)
        GB(g, 'misc', 0.36, 0.2, 0.36, -0.22, 0.605 + 0.1, 0.22, tint=srgb(40, 70, 120), bevel=0.012)
        for k in range(3):
            put(bm_torus(0.1, 0.018, 20, 8), 'misc', GM(g, 0.2, 0.62 + k * 0.034, 0.22), [BLACKP, srgb(150, 30, 20), BLACKP][k], smooth=True)
        for k in range(6):
            GB(g, 'misc', 0.05, 0.3, 0.26, -0.33 + k * 0.055, 1.055 + 0.15, 0.2, ry=0.02 * (k - 3), tint=[srgb(30, 60, 110), srgb(120, 30, 24), srgb(40, 40, 40), srgb(30, 80, 50), srgb(30, 60, 110), srgb(170, 140, 50)][k], bevel=0.004, var=0.06)
        for k in range(3):
            cyly('misc', 0.075, 1.055, 1.055 + 0.15, *g.p(0.12 + k * 0.1, 0, 0.12 + 0.12 * (k % 2))[::2], 18, [srgb(120, 120, 116), srgb(150, 60, 30), srgb(120, 120, 116)][k])
        GB(g, 'misc', 0.42, 0.22, 0.26, 0.0, 1.505 + 0.11, 0.2, tint=srgb(60, 44, 32), bevel=0.01)
        GB(g, 'misc', 0.3, 0.1, 0.004, -0.02, 1.62, 0.332, tint=srgb(196, 176, 130))
        knob(g.p(0.16, 1.62, 0.332), g.dir((0, 0, 1)), 0.016, 0.014)
        carton(*g.p(-0.02, h - 0.016, 0.22), 0.5, 0.2, 0.4, ry=0.05, tint=CARD_DK)
    OBB((S['x0'] + S['x1']) / 2, (S['z1']) / 2, w + 0.06, S['z1'] + 0.04, 0.0, 2.1)

def cases():
    """Two rugged equipment cases stacked by the rack: a dark one, an orange one on top, latches and handles."""
    g = G(-2.07, 0.0, 0.76, PI / 2 + 0.06)
    def case(mat, w, h, d, y0, tint, seed):
        with dens(0.9):
            GB(g, mat, w, h, d, 0, y0 + h / 2, 0, tint=tint, bevel=0.02, seg=2, wear=0.45 if mat == 'orange' else 0.0, hide=(0, -1, 0))
            GB(g, mat, w + 0.006, 0.014, d + 0.006, 0, y0 + h * 0.62, 0, tint=mul(tint, 0.85), bevel=0.005)          # lid seam
            for s in (-1, 1):
                GB(g, 'misc', 0.04, 0.05, 0.02, s * w * 0.3, y0 + h * 0.62, d / 2 + 0.01, tint=BLACKP, bevel=0.005)  # latches
                GB(g, 'steel', 0.026, 0.03, 0.006, s * w * 0.3, y0 + h * 0.62, d / 2 + 0.022, tint=mul(WHITE, 0.7), bevel=0.002)
            tube('misc', [g.p(-0.08, y0 + h + 0.004, 0), g.p(-0.07, y0 + h + 0.03, 0), g.p(0.07, y0 + h + 0.03, 0), g.p(0.08, y0 + h + 0.004, 0)], 0.011, 8, BLACKP, rad=0.02)
            for s in (-1, 1):
                for t in (-1, 1):
                    GB(g, 'misc', 0.05, h * 0.3, 0.05, s * (w / 2 - 0.02), y0 + h * 0.15 + (0.0 if t < 0 else h * 0.7), t * (d / 2 - 0.02), tint=mul(BLACKP, 1.4), bevel=0.01)
    case('misc', 0.56, 0.36, 0.38, 0.0, srgb(44, 50, 40), 1)
    case('orange', 0.48, 0.3, 0.32, 0.36, WHITE, 2)
    label('case', g.p(0.0, 0.36 + 0.2, 0.161), g.dir((0, 0, 1)), g.dir((1, 0, 0)), 0.2, 0.045)
    OBB(-2.07, 0.76, 0.46, 0.62, 0.0, 0.75, 0.06)

def breaker_panel():
    g = G(-1.15, 0.0, 0.0, 0.0)
    n, right = g.dir((0, 0, 1)), g.dir((1, 0, 0))
    with dens(1.0):
        GB(g, 'green', 0.34, 0.5, 0.12, 0, 1.6, 0.06, tint=mul(GREYGREEN, 0.9), bevel=0.01, wear=0.5, hide=(0, 0, -1))
        door(g, 'green', 0, 1.6, 0.12, 0.3, 0.46, 0.012, 77, dents=1, wear=0.6, tint=mul(GREYGREEN, 0.9))
        GB(g, 'steel', 0.02, 0.06, 0.02, 0.12, 1.6, 0.142, tint=mul(WHITE, 0.6), bevel=0.004)
        for yy in (1.42, 1.78):
            cyly('steel', 0.005, yy - 0.03, yy + 0.03, *g.p(-0.152, 0, 0.13)[::2], 8, mul(WHITE, 0.6))
    label('hv', g.p(0, 1.74, 0.133), n, right, 0.16, 0.1)
    label('brk', g.p(-0.06, 1.52, 0.133), n, right, 0.1, 0.12)
    OBB(-1.15, 0.08, 0.36, 0.18, 1.3, 1.9)
    # A NO SMOKING plate between the panel and the column, the stair sign on the column.
    label('nosmoke', (-1.15, 2.2, 0.0015), (0, 0, 1), (1, 0, 0), 0.2, 0.2)
    with dens(0.5):
        BX('steel', 0.174, 0.274, 0.004, 0.85, 1.75, 0.2032, tint=mul(WHITE, 0.6))
    label('stair', (0.85, 1.75, 0.2052), (0, 0, 1), (1, 0, 0), 0.16, 0.26)

def front_wall_extras():
    """A PA horn high over the locker, an air grille over the rack."""
    # The horn: a driver can and a flared bell on a U bracket, aimed down into the room.
    base = Vector((1.55, 2.5, 0.0))
    aim = (Vector((0.4, 1.3, 2.2)) - (base + Vector((0, 0, 0.18)))).normalized()
    with dens(0.8):
        BX('steel', 0.08, 0.12, 0.012, base.x, base.y, 0.006, tint=PAINTED, hide=(0, 0, -1))
        for s in (-1, 1):
            BX('steel', 0.008, 0.035, 0.16, base.x + s * 0.045, base.y, 0.09, tint=PAINTED)
        c = base + Vector((0, 0, 0.17))
        M = Matrix.Translation(c) @ axis_to(aim)
        lathe('green', [(0.0, -0.09), (0.045, -0.09), (0.05, -0.08), (0.05, -0.02), (0.03, 0.0), (0.03, 0.05), (0.06, 0.12), (0.1, 0.18), (0.112, 0.2), (0.108, 0.205)], M, 28, mul(GREYGREEN, 0.8))
        lathe('misc', [(0.104, 0.2), (0.06, 0.13), (0.03, 0.07), (0.0, 0.06)], M, 28, srgb(26, 26, 24), out=False)
        cyl_at('steel', 0.01, 0.1, c, Vector((1, 0, 0)), 8, PAINTED)
    tube('misc', [tuple(base + Vector((0.0, -0.06, 0.02))), tuple(base + Vector((0.05, -0.2, 0.025))), (1.06, 2.955, 0.035)], 0.005, 6, BLACKP, rad=0.05)
    # The grille: a steel frame with louvre blades over a dark duct opening.
    gx, gy, gw, gh = -1.85, 2.42, 0.4, 0.26
    with dens(0.8):
        put(quad_facing([(gx - gw / 2, gy - gh / 2, 0.002), (gx + gw / 2, gy - gh / 2, 0.002), (gx + gw / 2, gy + gh / 2, 0.002), (gx - gw / 2, gy + gh / 2, 0.002)], (0, 0, 1)), 'misc', None, srgb(10, 10, 10))
        for (w, h, ox, oy) in ((gw + 0.04, 0.025, 0, gh / 2 + 0.0125), (gw + 0.04, 0.025, 0, -gh / 2 - 0.0125), (0.025, gh, -gw / 2 - 0.0125, 0), (0.025, gh, gw / 2 + 0.0125, 0)):
            BX('steel', w, h, 0.022, gx + ox, gy + oy, 0.011, tint=mul(WHITE, 0.55), bevel=0.003, hide=(0, 0, -1))
        for k in range(9):
            BX('steel', gw, 0.022, 0.003, gx, gy - gh / 2 + 0.018 + k * (gh - 0.03) / 8, 0.012, rx=-0.75, tint=mul(WHITE, 0.5))
        for (ox, oy) in ((-gw / 2 - 0.0125, -gh / 2 - 0.0125), (gw / 2 + 0.0125, -gh / 2 - 0.0125), (-gw / 2 - 0.0125, gh / 2 + 0.0125), (gw / 2 + 0.0125, gh / 2 + 0.0125)):
            bolt((gx + ox, gy + oy, 0.022), (0, 0, 1), r=0.005, h=0.003, washer=False)

# ============================================================================ the back wall
def back_wall():
    n = (0, 0, -1)
    right = (-1, 0, 0)
    # The doorway's steel frame, hazard-striped, and the sign over it.
    with dens(0.9):
        fw, fd = 0.09, 0.03
        for s in (-1, 1):
            BX('steel', fw, DOOR_H + fw, fd, s * (DOOR_HW + fw / 2), (DOOR_H + fw) / 2, D - fd / 2, tint=mul(WHITE, 0.5), bevel=0.004, hide=(0, 0, 1))
        BX('steel', 2 * DOOR_HW + 2 * fw, fw, fd, 0, DOOR_H + fw / 2, D - fd / 2, tint=mul(WHITE, 0.5), bevel=0.004, hide=(0, 0, 1))
    # Hazard stripes painted on the frame's face (diagonal yellow and black bands).
    def stripes(x0, x1, y0, y1, z):
        """Diagonal yellow and black bands over a rectangle of the frame's face (facing -z)."""
        w, k, t = 0.06, 0, -(x1 - x0) - 0.06
        rect = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        while t < (y1 - y0) + (x1 - x0):
            band = clip_band(rect, 0.0, 0.0, t, t + w)
            if len(band) >= 3:
                put(orient(bm_poly([(px_, py_, z) for (px_, py_) in band]), lambda c: Vector((0, 0, -1))), 'misc', None, YELLOW if k % 2 == 0 else BLACKP)
            t += w
            k += 1
    zf = D - fd - 0.0006
    stripes(-DOOR_HW - fw, -DOOR_HW, 0.0, DOOR_H + fw, zf)
    stripes(DOOR_HW, DOOR_HW + fw, 0.0, DOOR_H + fw, zf)
    stripes(-DOOR_HW, DOOR_HW, DOOR_H, DOOR_H + fw, zf)
    label('lift', (0.0, DOOR_H + fw + 0.12, D - 0.0015), n, right, 0.42, 0.12)
    label('relay', (-1.75, 2.15, D - 0.0015), n, right, 0.5, 0.16)
    # The call button's escutcheon (the game's button sits 2 cm proud of the wall) and its label.
    with dens(0.6):
        BX('steel', 0.1, 0.17, 0.006, CALL[0], CALL[1], D - 0.003, tint=mul(WHITE, 0.7), bevel=0.003, hide=(0, 0, 1))
        for yy in (CALL[1] - 0.07, CALL[1] + 0.07):
            bolt((CALL[0], yy, D - 0.006), n, r=0.004, h=0.003, washer=False)
    label('call', (CALL[0], CALL[1] - 0.11, D - 0.0015), n, right, 0.06, 0.022)
    empty('CALL', (CALL[0], CALL[1], D), callPos=[-CALL[0], CALL[1], round(PLATE_Z - D + 0.02, 4)])
    # An old wall intercom left of the call button.
    g = G(-1.75, 0.0, D, PI)
    with dens(0.9):
        GB(g, 'misc', 0.17, 0.26, 0.07, 0, 1.45, 0.035, tint=srgb(64, 66, 62), bevel=0.01, hide=(0, 0, -1))
        GB(g, 'misc', 0.05, 0.22, 0.05, 0.06, 1.46, 0.09, tint=srgb(30, 30, 30), bevel=0.018, seg=2)
        for k in range(4):
            GB(g, 'misc', 0.07, 0.004, 0.002, -0.03, 1.36 + k * 0.012, 0.0705, tint=srgb(20, 20, 20))
        knob(g.p(-0.03, 1.53, 0.07), g.dir((0, 0, 1)), 0.012, 0.012)
        tube('misc', [g.p(0.06, 1.35, 0.09), g.p(0.07, 1.2, 0.1), g.p(0.0, 1.1, 0.09), g.p(-0.05, 1.25, 0.075), g.p(-0.06, 1.35, 0.07)], 0.004, 6, srgb(30, 30, 30), rad=0.05)
    label('intercom', g.p(-0.03, 1.6, 0.0705), g.dir((0, 0, 1)), g.dir((1, 0, 0)), 0.1, 0.02)
    # The fire extinguisher on its bracket by the desk's end, and the junction box the conduit drops into.
    g = G(1.25, 0.0, D, PI)
    with dens(0.9):
        GB(g, 'steel', 0.06, 0.25, 0.012, 0, 0.65, 0.006, tint=PAINTED)
        GB(g, 'steel', 0.16, 0.03, 0.12, 0, 0.36, 0.08, tint=PAINTED)
        lathe('misc', [(0.0, 0.0), (0.07, 0.0), (0.074, 0.02), (0.074, 0.4), (0.06, 0.44), (0.025, 0.46), (0.0, 0.46)], GM(g, 0, 0.375, 0.085), 24, REDPAINT)
        lathe('steel', [(0.0, 0.46), (0.018, 0.46), (0.02, 0.5), (0.012, 0.52), (0.0, 0.52)], GM(g, 0, 0.375, 0.085), 12, mul(WHITE, 0.6))
        GB(g, 'steel', 0.11, 0.012, 0.025, -0.03, 0.375 + 0.53, 0.085, ry=0.2, tint=mul(WHITE, 0.6), bevel=0.003)
        tube('misc', [g.p(0.02, 0.88, 0.1), g.p(0.08, 0.85, 0.12), g.p(0.085, 0.6, 0.15), g.p(0.07, 0.45, 0.15)], 0.009, 8, BLACKP, rad=0.05)
        cyl_at('misc', 0.018, 0.012, g.p(-0.035, 0.875, 0.11), g.dir((0, 0, 1)), 14, srgb(220, 214, 200))
    label('ext', g.p(0.0, 1.06, 0.0015), g.dir((0, 0, 1)), g.dir((1, 0, 0)), 0.16, 0.1)
    OBB(1.25, D - 0.09, 0.2, 0.2, 0.0, 1.0)
    g = G(1.25, 0.0, D, PI)
    with dens(0.8):
        GB(g, 'green', 0.18, 0.22, 0.1, 0, 2.1, 0.05, tint=mul(GREYGREEN, 0.85), bevel=0.008, wear=0.4, hide=(0, 0, -1))
        for (ox, oy) in ((-0.07, 2.01), (0.07, 2.01), (-0.07, 2.19), (0.07, 2.19)):
            bolt(g.p(ox, oy, 0.1), g.dir((0, 0, 1)), r=0.005, h=0.003, washer=False)

def clip_band(poly, x0, y0, a, b):
    """The part of a convex polygon where a <= (y - y0) - (x - x0) <= b."""
    def clip(P, f):
        out = []
        for i in range(len(P)):
            p, q = P[i], P[(i + 1) % len(P)]
            fp, fq = f(p), f(q)
            if fp >= 0:
                out.append(p)
            if (fp >= 0) != (fq >= 0):
                t = fp / (fp - fq)
                out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
        return out
    P = clip(poly, lambda p: (p[1] - y0) - (p[0] - x0) - a)
    if len(P) < 3:
        return []
    return clip(P, lambda p: b - ((p[1] - y0) - (p[0] - x0)))

# ============================================================================ the floor: drains and the inset plate
def recess_box(x0, x1, z0, z1, depth, wall_tint, bottom_tint, bottom_mat='misc'):
    """The walls and bottom of a pit under the floor (normals inward)."""
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    bm = bm_box(x1 - x0, depth, z1 - z0)
    bmesh.ops.translate(bm, vec=(cx, -depth / 2, cz), verts=bm.verts)
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    bm.normal_update()
    top = [f for f in bm.faces if f.normal.y < -0.9]
    bmesh.ops.delete(bm, geom=top, context='FACES')
    bot = bm.copy()
    cull(bm, lambda f: f.normal.y > 0.9)
    cull(bot, lambda f: f.normal.y < 0.9)
    put(bm, 'concrete', None, wall_tint)
    put(bot, bottom_mat, None, bottom_tint)

def rim(x0, x1, z0, z1, wlip=0.022, leg=0.03, tint=mul(WHITE, 0.55)):
    """An angle-iron rim round a floor opening: the top flange flush with the floor, the leg down inside."""
    for (a0, a1, b0, b1) in ((x0 - wlip, x1 + wlip, z0 - wlip, z0), (x0 - wlip, x1 + wlip, z1, z1 + wlip), (x0 - wlip, x0, z0, z1), (x1, x1 + wlip, z0, z1)):
        put(quad_facing([(a0, 0.0, b0), (a1, 0.0, b0), (a1, 0.0, b1), (a0, 0.0, b1)], (0, 1, 0)), 'steel', None, tint)
    for (p, q, nn) in ((((x0, z0), (x1, z0)), None, (0, 0, 1)), (((x0, z1), (x1, z1)), None, (0, 0, -1)), (((x0, z0), (x0, z1)), None, (1, 0, 0)), (((x1, z0), (x1, z1)), None, (-1, 0, 0))):
        (ax, az), (bx, bz) = p
        put(quad_facing([(ax, 0.0, az), (bx, 0.0, bz), (bx, -leg, bz), (ax, -leg, az)], nn), 'steel', None, mul(tint, 0.8))

def trench_drain():
    T = TRENCH
    x0, x1, z0, z1 = T['x0'], T['x1'], T['z0'], T['z1']
    with dens(0.7):
        rim(x0, x1, z0, z1, 0.02)
        recess_box(x0, x1, z0, z1, 0.16, mul(WHITE, 0.45), DARKWET)
        # A film of standing water in the channel's bottom, and a slot outlet at the far end.
        put(quad_facing([(x0, -0.13, z0), (x1, -0.13, z0), (x1, -0.13, z1), (x0, -0.13, z1)], (0, 1, 0)), 'misc', None, srgb(16, 18, 20))
    # The grating: four 0.6 m sections of bearing bars and crossbars, seated 4 mm below the floor.
    with dens(0.35):
        nseg = 4
        L = (z1 - z0) / nseg
        for k in range(nseg):
            a, b = z0 + k * L + 0.004, z0 + (k + 1) * L - 0.004
            for xx in (x0 + 0.006, x1 - 0.006, (x0 + x1) / 2):
                BX('steel', 0.006, 0.028, b - a, xx, -0.018, (a + b) / 2, tint=mul(WHITE, 0.42))
            nb = int((b - a) / 0.024)
            for j in range(nb + 1):
                z = a + 0.006 + j * (b - a - 0.012) / nb
                BX('steel', x1 - x0 - 0.012, 0.022, 0.005, (x0 + x1) / 2, -0.015, z, tint=mul(WHITE, 0.38), hide=(0, -1, 0))

def square_drain():
    x, z, h = SQDRAIN
    with dens(0.7):
        rim(x - h, x + h, z - h, z + h, 0.018)
        recess_box(x - h, x + h, z - h, z + h, 0.12, mul(WHITE, 0.4), DARKWET)
    with dens(0.5):
        for k in range(9):
            xx = x - h + 0.012 + k * (2 * h - 0.024) / 8
            BX('steel', 0.008, 0.02, 2 * h - 0.01, xx, -0.014, z, tint=mul(WHITE, 0.35), hide=(0, -1, 0))
        BX('steel', 2 * h - 0.01, 0.02, 0.01, x, -0.014, z, tint=mul(WHITE, 0.35), hide=(0, -1, 0))

def floor_plate():
    """The inset steel plate: flush, in an angle frame, countersunk bolts at its corners and two lifting slots."""
    P = PLATE
    x0, x1, z0, z1 = P['x0'], P['x1'], P['z0'], P['z1']
    with dens(0.8):
        rim(x0, x1, z0, z1, 0.03, 0.04, mul(WHITE, 0.6))
        # The plate itself (5 mm gap all round), with its slots cut.
        g0, g1 = 0.005, 0.005
        px0, px1, pz0, pz1 = x0 + g0, x1 - g0, z0 + g1, z1 - g1
        slots = [((x0 + x1) / 2 - 0.07, (x0 + x1) / 2 + 0.07, pz0 + 0.07, pz0 + 0.1), ((x0 + x1) / 2 - 0.07, (x0 + x1) / 2 + 0.07, pz1 - 0.1, pz1 - 0.07)]
        xs = steps(px0, px1, 0.4, [s[0] for s in slots] + [s[1] for s in slots])
        zs = steps(pz0, pz1, 0.4, [s[2] for s in slots] + [s[3] for s in slots])
        keep = lambda a, b, c, d: not any(s[0] - 1e-6 <= (a + b) / 2 <= s[1] + 1e-6 and s[2] - 1e-6 <= (c + d) / 2 <= s[3] + 1e-6 for s in slots)
        put(grid_sheet(xs, zs, lambda u, v: (u, -0.0005, v), (0, 1, 0), keep), 'steel', None, mul(WHITE, 0.62))
        for s in slots:
            recess_box(s[0], s[1], s[2], s[3], 0.012, mul(WHITE, 0.25), mul(BLACKP, 0.5))
        # The gap: a dark strip below the plate's edge.
        put(quad_facing([(x0, -0.01, z0), (x1, -0.01, z0), (x1, -0.01, z1), (x0, -0.01, z1)], (0, 1, 0)), 'misc', None, mul(BLACKP, 0.4))
    with dens(0.4):
        for (bx, bz) in ((px0 + 0.04, pz0 + 0.04), (px1 - 0.04, pz0 + 0.04), (px0 + 0.04, pz1 - 0.04), (px1 - 0.04, pz1 - 0.04), ((x0 + x1) / 2, pz0 + 0.04), ((x0 + x1) / 2, pz1 - 0.04)):
            cyl_at('steel', 0.011, 0.0012, (bx, -0.0005, bz), (0, 1, 0), 12, mul(WHITE, 0.45))
            BX('misc', 0.012, 0.0008, 0.003, bx, 0.0007, bz, ry=0.4 + bx, tint=BLACKP)

# ============================================================================ CAM 07 (the cctv layer, authored at the origin)
def cctv():
    """A weathered grey CCTV housing for the sequoia: lens at the origin looking +z, sun hood, swivel bracket and a mount
    plate behind (-z) with two strap slots; a cable loop; a red tally LED."""
    GREY = srgb(132, 134, 130)
    def weather(co):
        k = 1.0 - 0.25 * max(0.0, -co.y / 0.1) - 0.12 * max(0.0, nz(co.x * 3, co.y * 3, co.z * 3, 4.0))
        return (k, k * 1.01, k * 0.98)
    with layer('cctv'):
        # Body.
        bm = bm_box(0.11, 0.1, 0.27, 0.01, 2)
        put(bm, 'cctv', xf(0, 0, -0.175), GREY, colfn=weather)
        put(bm_box(0.118, 0.012, 0.012, 0.003), 'cctv', xf(0, 0, -0.04), mul(GREY, 0.9))
        put(bm_box(0.118, 0.012, 0.012, 0.003), 'cctv', xf(0, 0, -0.3), mul(GREY, 0.9))
        # Front window ring and the lens (dark glass, a bright rim).
        put(bm_ring(0.032, 0.04, -0.04, 0.0, 28), 'cctv', xf(0, 0, 0, rx=PI / 2), mul(GREY, 0.7), smooth=lambda nn: abs(nn.y) < 0.9)
        put(bm_cyl(0.032, 0.032, 0.002, 28), 'cctv', xf(0, 0, -0.008, rx=PI / 2), GLASSBK, smooth=False)
        put(bm_torus(0.02, 0.003, 20, 5), 'cctv', xf(0, 0, -0.006, rx=PI / 2), srgb(60, 80, 110), smooth=True)
        # Sun hood: a bent sheet over the top running past the lens.
        prof = [(-0.07, -0.02), (-0.066, 0.0), (-0.05, 0.012), (0.05, 0.012), (0.066, 0.0), (0.07, -0.02)]
        hood = bm_prism([(u, 0.058 + v) for (u, v) in prof], -0.33, 0.06, 'x')
        put(hood, 'cctv', None, mul(GREY, 1.05), colfn=weather)
        # Bracket: a swivel under the body, an arm back to a knuckle on the mount plate. The plate is tipped TILT deg about
        # its back face's centre (MNT: the point rocks.js hiddenCam() sets on the bark, so the lens stays where it was) to
        # hang flush on the bark while the lens looks down at the tor: hiddenCam() pitches it 22 deg down from 12 m up
        # the trunk, and the bark there leans back another 3.4 deg. Re-aim the camera and this wants re-measuring.
        TILT = 25.4
        MNT = (0.0, -0.05, -0.476)
        tip = Matrix.Translation(MNT) @ Matrix.Rotation(math.radians(-TILT), 4, 'X') @ Matrix.Translation(-Vector(MNT))
        put(bm_cyl(0.02, 0.02, 0.03, 16), 'cctv', xf(0, -0.065, -0.2), mul(GREY, 0.75))
        put(bm_box(0.03, 0.03, 0.215, 0.004), 'cctv', xf(0, -0.09, -0.3075), mul(GREY, 0.75))
        put(bm_cyl(0.016, 0.016, 0.05, 12), 'cctv', xf(0, -0.09, -0.415, rz=PI / 2), mul(GREY, 0.7))
        put(bm_box(0.04, 0.14, 0.03, 0.004), 'cctv', tip @ xf(0, -0.06, -0.45), mul(GREY, 0.75))
        put(bm_box(0.16, 0.24, 0.012, 0.004), 'cctv', tip @ xf(0, -0.05, -0.47), mul(GREY, 0.8), colfn=weather)
        for s in (-1, 1):
            put(bm_box(0.02, 0.05, 0.004), 'cctv', tip @ xf(s * 0.06, -0.05, -0.464), srgb(20, 20, 20))
            put(bm_cyl(0.007, 0.007, 0.01, 6), 'cctv', tip @ xf(s * 0.05, 0.04, -0.46, rx=PI / 2), mul(GREY, 0.6))
            put(bm_cyl(0.007, 0.007, 0.01, 6), 'cctv', tip @ xf(s * 0.05, -0.14, -0.46, rx=PI / 2), mul(GREY, 0.6))
        # The cable: out of the back, a drip loop beside the arm, up into the plate.
        into = tuple(tip @ Vector((0.03, -0.1, -0.462)))
        put(bm_tube(rounded_pts([(0, 0.0, -0.31), (0, -0.02, -0.35), (0.03, -0.13, -0.37), (0.035, -0.14, -0.4), into], 0.03), 0.006, 6), 'cctv', None, srgb(22, 22, 22), smooth=True)
    with layer('cctv'):
        put(bm_sphere(0.004, 8, 6), 'glow', xf(0.038, 0.028, -0.002), LED_RED, smooth=True)
    empty('CCTV_LENS', (0.0, 0.0, 0.0), look=[0.0, 0.0, 1.0], up=[0.0, 1.0, 0.0], mount=list(MNT), mount_tilt=TILT)

# ============================================================================ metadata
_obb = {'n': 0}

def OBB(cx, cz, w, d, y0, y1, ry=0.0):
    """A collision box the game adds as physics.addOBB (floor-relative heights)."""
    empty('OBB_%d' % _obb['n'], (cx, 0.0, cz), hx=w / 2, hz=d / 2, y0=y0, y1=y1, ry=ry)
    _obb['n'] += 1

def build_meta():
    for s in (-1, 1):
        OBB(s * 0.85, 0.1, 0.22, 0.22, 0.0, H)
    empty('SOUND', (0.9, 1.6, 2.1))
    d = (TERM - SEAT_EYE).normalized()
    yaw = math.atan2(-d.x, -d.z)
    pitch = math.asin(max(-1.0, min(1.0, d.y)))
    empty('SEAT_EYE', tuple(SEAT_EYE), look=list(TERM), yaw=yaw, pitch=pitch, fov=40.0)
    empty('SEAT_STAND', SEAT_STAND, yaw=yaw)
    for i, (p, power, col, kind, name, extra) in enumerate(LIGHTS):
        empty('LIGHT_%d' % i, tuple(p), power=power, color=list(light_rgb(col)), kind=kind, light=name, **{k: v for k, v in extra.items()})
    empty('META', (0, 0, 0), hw=HW, d=D, h=H, mouth=[MOUTH_HW, MOUTH_H], door=[DOOR_HW, DOOR_H], wall_tile=list(TILE['wall']),
          floor_map=dict(FLOOR_MAP), env_pos=list(ENV_POS), env_box=[-HW, 0.0, 0.0, HW, H, D], plate_z=PLATE_Z,
          tiles={k: list(v) for k, v in TILE.items() if k in ('wall', 'concrete', 'steel', 'orange', 'green', 'alu')},
          lm_scale=1.0, env_scale=1.0, env_glow=GLOW_GAIN, gain=GAIN, glow_gain=GLOW_GAIN)

GAIN = 1.0           # the lightmap gain the previews use (overwritten in bake_all's META)
GLOW_GAIN = 3.0

def blackbody(t):
    """Linear RGB of a blackbody at t kelvin, normalised to max 1 (Tanner Helland's fit, linearised)."""
    t = t / 100.0
    r = 255.0 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255.0 if t >= 66 else (0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    c = srgb(max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
    m = max(c)
    return (c[0] / m, c[1] / m, c[2] / m)

def light_rgb(col):
    return blackbody(col) if isinstance(col, (int, float)) else tuple(col)

def add_lights():
    """Cycles lights for the bake (not exported): points in the bulbs, rectangles for the bars and screens."""
    sc = _scene()
    for i, (p, power, col) in enumerate(UPLIGHTS):
        ld = bpy.data.lights.new('DB_uplight_%d' % i, 'POINT')
        ld.shadow_soft_size = 0.03
        ld.energy = power
        ld.color = col
        ob = bpy.data.objects.new('UPLIGHT_%d' % i, ld)
        ob.location = g2b(p)
        ob['noexport'] = 1
        sc.collection.objects.link(ob)
    for i, (p, power, col, kind, name, extra) in enumerate(LIGHTS):
        if kind in ('pendant', 'lamp'):
            ld = bpy.data.lights.new('DB_light_%d' % i, 'POINT')
            ld.shadow_soft_size = extra.get('radius', 0.03)
        else:
            ld = bpy.data.lights.new('DB_light_%d' % i, 'AREA')
            sx, sy = extra['size']
            if extra.get('disc'):
                ld.shape = 'DISK'
                ld.size = sx
            else:
                ld.shape = 'RECTANGLE'
                ld.size, ld.size_y = sx, sy
        ld.energy = power
        ld.color = light_rgb(col)
        ob = bpy.data.objects.new('LIGHT_%s_%d' % (name, i), ld)
        ob.location = g2b(p)
        if ld.type == 'AREA':
            nn = g2b(extra['normal'])
            # Area lights shine down their local -Z; their local +Y should be the room's up (or +x for a ceiling-facing one).
            up = g2b((0, 1, 0))
            z = -nn.normalized()
            x = up.cross(z)
            if x.length < 1e-6:
                x = Vector((1, 0, 0))
            x.normalize()
            y = z.cross(x)
            ob.matrix_world = Matrix(((x.x, y.x, z.x, ob.location.x), (x.y, y.y, z.y, ob.location.y), (x.z, y.z, z.z, ob.location.z), (0, 0, 0, 1)))
        ob['noexport'] = 1
        sc.collection.objects.link(ob)

def build_all():
    t0 = time.time()
    LIGHTS.clear()
    UPLIGHTS.clear()
    DENS.clear()
    _dens[0] = 1.0
    _obb['n'] = 0
    shell()
    floor_sheet()
    standins()
    structure()
    duct()
    pipes()
    conduits()
    lights()
    desk()
    corkboard()
    wall_clock()
    wall_boxes()
    chair()
    radar_console()
    tall_cabinet()
    locker()
    wire_rack()
    cases()
    breaker_panel()
    front_wall_extras()
    back_wall()
    trench_drain()
    square_drain()
    floor_plate()
    cctv()
    build_meta()
    stats = realize()
    sc = _scene()
    for nm in ('COLLIDER', PREFIX + 'standin'):
        ob = sc.objects.get(nm)
        if ob is not None:
            ob['noexport'] = 1
            if nm == 'COLLIDER':
                ob.hide_render = True
    add_lights()
    show_scene()
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in sc.objects if ob.type == 'MESH' and not ob.get('noexport'))
    return {'materials': stats, 'lights': len(LIGHTS), 'obbs': _obb['n'], 'tris': tris, 'seconds': round(time.time() - t0, 1)}

# ============================================================================ textures (numpy; arrays in Blender row order: row 0 = bottom)
def write_png(path, a):
    """An 8-bit PNG from a float array already encoded to 0..1 (HxW grey, HxWx3 RGB or HxWx4 RGBA), row 0 at the bottom.
    Each row gets the PNG filter that packs it best (zlib level 9)."""
    import zlib, struct
    a = np.clip(np.asarray(a, np.float32), 0.0, 1.0)
    b8 = (a * 255.0 + 0.5).astype(np.uint8)[::-1]
    if b8.ndim == 2:
        ct, ch = 0, 1
        b8 = b8[:, :, None]
    else:
        ch = b8.shape[2]
        ct = {3: 2, 4: 6}[ch]
    h, w = b8.shape[:2]
    raw = b8.reshape(h, w * ch).astype(np.int16)
    prev = np.vstack([np.zeros((1, w * ch), np.int16), raw[:-1]])
    left = np.hstack([np.zeros((h, ch), np.int16), raw[:, :-ch]])
    ul = np.hstack([np.zeros((h, ch), np.int16), prev[:, :-ch]])
    p = left + prev - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - prev), np.abs(p - ul)
    pred = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, prev, ul))
    fs = np.stack([raw, raw - left, raw - prev, raw - ((left + prev) >> 1), raw - pred]) & 0xFF
    cost = np.abs(np.where(fs > 127, fs - 256, fs)).astype(np.int64).sum(axis=2)
    best = cost.argmin(axis=0)
    rows = fs[best, np.arange(h)].astype(np.uint8)
    data = np.hstack([best.astype(np.uint8)[:, None], rows]).tobytes()
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ct, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

def enc_srgb(a):
    a = np.clip(a, 0, None)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)

def lin(c):
    """sRGB 0-255 triple -> linear numpy colour."""
    return np.array(srgb(*c), np.float32)

def fblur(a, sx, sy=None, theta=0.0):
    """Periodic gaussian blur (sigmas in px, x along columns), optionally rotated by theta (radians, from +x)."""
    sy = sx if sy is None else sy
    Hh, Ww = a.shape
    fy = np.fft.fftfreq(Hh)[:, None]
    fx = np.fft.rfftfreq(Ww)[None, :]
    c, s = math.cos(theta), math.sin(theta)
    u = fx * c + fy * s
    v = -fx * s + fy * c
    g = np.exp(-2.0 * (PI ** 2) * ((u * sx) ** 2 + (v * sy) ** 2))
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=a.shape).astype(np.float32)

def blob(Hh, Ww, sx, sy=None, seed=0, theta=0.0):
    r = np.random.default_rng(seed)
    a = fblur(r.standard_normal((Hh, Ww)).astype(np.float32), sx, sy, theta)
    return a / (a.std() + 1e-9)

def fbm(Hh, Ww, s0, octaves=5, gain=0.55, seed=0, aniso=1.0, theta=0.0):
    out = np.zeros((Hh, Ww), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(0.4, s0 / (2 ** o))
        out += amp * blob(Hh, Ww, s * aniso, s, seed * 131 + o * 17, theta)
        tot += amp * amp
        amp *= gain
    return out / math.sqrt(tot)

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def worley(Hh, Ww, nx, ny, seed, jitter=0.9):
    """Periodic cellular noise: (F1 distance px, F2 distance px, id 0..1 of the nearest point)."""
    r = np.random.default_rng(seed)
    cw, ch = Ww / nx, Hh / ny
    jx = (r.random((ny, nx)) - 0.5) * jitter
    jy = (r.random((ny, nx)) - 0.5) * jitter
    ids = r.random((ny, nx)).astype(np.float32)
    yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32) + 0.5
    cy = np.floor(yy / ch).astype(np.int32)
    cx = np.floor(xx / cw).astype(np.int32)
    f1 = np.full((Hh, Ww), 1e9, np.float32)
    f2 = np.full((Hh, Ww), 1e9, np.float32)
    fid = np.zeros((Hh, Ww), np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ky, kx = cy + dy, cx + dx
            my, mx = ky % ny, kx % nx
            px = (kx + 0.5 + jx[my, mx]) * cw
            py = (ky + 0.5 + jy[my, mx]) * ch
            d = np.hypot(xx - px, yy - py)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            fid = np.where(closer, ids[my, mx], fid)
            f1 = np.where(closer, d, f1)
    return f1, f2, fid

def seg_dist(xx, yy, pts):
    """Distance (same units as xx, yy) to a polyline."""
    d = np.full(xx.shape, 1e9, np.float32)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy + 1e-12
        t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1)
        d = np.minimum(d, np.hypot(xx - ax - t * vx, yy - ay - t * vy))
    return d

def rect_dist(xx, yy, x0, y0, x1, y1):
    """Signed distance to an axis-aligned rectangle (negative inside)."""
    dx = np.maximum(x0 - xx, xx - x1)
    dy = np.maximum(y0 - yy, yy - y1)
    out = np.hypot(np.maximum(dx, 0), np.maximum(dy, 0))
    inside = np.minimum(np.maximum(dx, dy), 0)
    return out + inside

def scratches(Hh, Ww, n, seed, lmin, lmax, width=0.7, bias_dir=None, spread=PI, wrap=True):
    """Thin anti-aliased line segments (0..1 coverage), random directions (or round bias_dir +- spread)."""
    r = random.Random(seed)
    out = np.zeros((Hh, Ww), np.float32)
    for _ in range(n):
        x0, y0 = r.uniform(0, Ww), r.uniform(0, Hh)
        a = r.uniform(-PI, PI) if bias_dir is None else bias_dir + r.uniform(-spread, spread)
        L = r.uniform(lmin, lmax)
        bend = r.uniform(-0.15, 0.15)
        w = width * r.uniform(0.6, 1.4)
        k = r.uniform(0.3, 1.0)
        pts = []
        for i in range(6):
            t = i / 5
            aa = a + bend * (t - 0.5)
            pts.append((x0 + math.cos(aa) * L * t, y0 + math.sin(aa) * L * t))
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        bx0, bx1 = int(min(xs) - 3), int(max(xs) + 4)
        by0, by1 = int(min(ys) - 3), int(max(ys) + 4)
        yy, xx = np.mgrid[by0:by1, bx0:bx1].astype(np.float32) + 0.5
        d = seg_dist(xx, yy, pts)
        cov = np.clip(w + 0.5 - d, 0, 1) * k
        if wrap:
            ri = np.arange(by0, by1) % Hh
            ci = np.arange(bx0, bx1) % Ww
            out[np.ix_(ri, ci)] = np.maximum(out[np.ix_(ri, ci)], cov)
        else:
            a0, a1 = max(0, by0), min(Hh, by1)
            b0, b1 = max(0, bx0), min(Ww, bx1)
            if a1 > a0 and b1 > b0:
                out[a0:a1, b0:b1] = np.maximum(out[a0:a1, b0:b1], cov[a0 - by0:a1 - by0, b0 - bx0:b1 - bx0])
    return out

def tangent_normal(h, ppm, k=1.0):
    """Tangent-space normal map (R +u, G +v: Blender rows up) from a periodic height field in metres; ppm = px per metre."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * (ppm / 2) * k
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * (ppm / 2) * k
    n = np.stack([-dx, -dy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def run_down(src, length, rows_down=True):
    """Smear a mask downward (toward row 0), fading over `length` px: rust and grime runs."""
    out = src.copy()
    decay = math.exp(-1.0 / max(1.0, length))
    Hh = src.shape[0]
    for _pass in range(2):                       # twice round, so it wraps
        acc = out[-1].copy()
        for r in range(Hh - 1, -1, -1):
            acc = np.maximum(out[r], acc * decay)
            out[r] = acc
    return out

# ---------------------------------------------------------------- cinderblock
def tex_wall():
    W_, H_ = 1024, 768
    ppm = W_ / TILE['wall'][0]                       # 640 px per metre
    yy, xx = np.mgrid[0:H_, 0:W_].astype(np.float32) + 0.5
    course = np.floor(yy / 128.0).astype(np.int32)
    off = (course % 2) * 128.0
    bxp = (xx + off) % 256.0
    blk = (np.floor((xx + off) / 256.0).astype(np.int32) % 4) + course * 4
    byp = yy % 128.0
    # Wobbly joint edges.
    wob = fbm(H_, W_, 6, 3, seed=11) * 1.1
    de = np.minimum(np.minimum(bxp, 256 - bxp), np.minimum(byp, 128 - byp)) + wob
    jw = 3.3
    mortar = sstep(jw + 0.8, jw - 0.6, de)
    r = np.random.default_rng(5)
    tone = (1.0 + r.normal(0, 0.07, 24)).astype(np.float32)[blk]
    hue = r.normal(0, 0.02, (24, 3)).astype(np.float32)[blk]
    tilt = r.normal(0, 1, (24, 2)).astype(np.float32)[blk]
    # Spalls along the arrises: chipped where a noise runs high, wider at the corners.
    chipn = fbm(H_, W_, 10, 3, seed=21)
    chipw = np.clip(chipn * 7.0 - 3.5, 0, 14) + np.clip(fbm(H_, W_, 3, 2, seed=22) * 2.0, 0, 3)
    corner = np.minimum(np.minimum(bxp, 256 - bxp), 30) + np.minimum(np.minimum(byp, 128 - byp), 30)
    chipw = chipw + np.clip(18 - corner, 0, 18) * 0.3 * (chipn > 0.2)
    chip = sstep(0.0, 1.5, chipw - (de - jw)) * (1 - mortar)
    # Pores and aggregate in the faces.
    f1, f2, fid = worley(H_, W_, 160, 120, 31)
    pore = sstep(1.6, 0.4, f1 / (0.4 + fid * 1.2)) * (fid > 0.78)
    f1b, _f2b, fidb = worley(H_, W_, 64, 48, 32)
    bigpore = sstep(2.2, 0.8, f1b / (0.6 + fidb * 2.0)) * (fidb > 0.9)
    grain = fbm(H_, W_, 1.2, 2, seed=33)
    mott = fbm(H_, W_, 24, 4, seed=34)
    grime = fbm(H_, W_, 90, 4, seed=35)
    runs = blob(H_, W_, 3, 70, seed=36)
    base = lin((142, 138, 128))
    col = base[None, None, :] * tone[:, :, None] * (1 + hue)
    col *= (1 + 0.05 * mott)[:, :, None] * (1 + 0.04 * grain)[:, :, None]
    col = col * (1 - 0.3 * pore[:, :, None]) * (1 - 0.4 * bigpore[:, :, None])
    chipc = lin((126, 120, 110)) * (1 + 0.08 * grain)[:, :, None]
    col = col * (1 - chip[:, :, None]) + chipc * chip[:, :, None]
    mcol = lin((162, 157, 146))[None, None, :] * (1 + 0.07 * fbm(H_, W_, 1.0, 2, seed=37))[:, :, None]
    mcol = mcol * (1 - 0.4 * sstep(jw + 1.0, 0.0, de))[:, :, None]                 # the joint's shadowed middle
    col = col * (1 - mortar[:, :, None]) + mcol * mortar[:, :, None]
    col *= (1 - 0.12 * sstep(0.2, 1.6, grime))[:, :, None]
    col *= (1 - 0.06 * sstep(0.8, 2.2, runs))[:, :, None]
    # Height (metres): faces a little proud and tilted, joints tooled concave and 4 mm back, chips and pores.
    h = 0.0006 * (tilt[:, :, 0] * (bxp / 256 - 0.5) + tilt[:, :, 1] * (byp / 128 - 0.5))
    h += 0.00025 * mott
    h -= 0.004 * mortar + 0.0025 * mortar * sstep(jw, 0, de)
    h -= 0.004 * chip
    h -= 0.0015 * pore + 0.003 * bigpore
    write_png(MODELS + 'bunker_wall.png', enc_srgb(col))
    write_png(MODELS + 'bunker_wall_normal.png', tangent_normal(h, ppm, 0.8))
    return col

# ---------------------------------------------------------------- board-formed concrete (the slab)
def tex_concrete():
    N = 512
    ppm = N / TILE['concrete'][0]
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) + 0.5
    bw = N / 8.0                                                            # 15 cm boards along u
    board = np.floor(yy / bw).astype(np.int32)
    by = yy % bw
    r = np.random.default_rng(7)
    tone = (1 + r.normal(0, 0.05, 8)).astype(np.float32)[board]
    grainc = np.zeros((N, N), np.float32)
    for k in range(8):
        g = blob(N, N, 40, 0.8, seed=100 + k)
        grainc = np.where(board == k, g, grainc)
    seam = sstep(1.6, 0.0, np.minimum(by, bw - by))
    f1, _f2, fid = worley(N, N, 90, 90, 41)
    pore = sstep(1.4, 0.3, f1 / (0.5 + fid)) * (fid > 0.85)
    stain = fbm(N, N, 60, 4, seed=42)
    ties = np.zeros((N, N), np.float32)
    for (tx, ty) in ((0.25, 0.25 + 1 / 16), (0.75, 0.75 + 1 / 16)):
        d = np.hypot((xx - tx * N + N / 2) % N - N / 2, (yy - ty * N + N / 2) % N - N / 2)
        ties = np.maximum(ties, sstep(7, 5, d))
    col = lin((142, 138, 129))[None, None, :] * tone[:, :, None] * (1 + 0.05 * grainc)[:, :, None]
    col *= (1 - 0.18 * seam)[:, :, None] * (1 - 0.5 * pore)[:, :, None] * (1 - 0.6 * ties)[:, :, None]
    col *= (1 - 0.15 * sstep(0.3, 1.8, stain))[:, :, None]
    write_png(MODELS + 'bunker_concrete.png', enc_srgb(col))

# ---------------------------------------------------------------- enamels: orange (cabinets) and grey-green (locker, instruments)
def tex_enamel(name, base, thr, seed, fade_col, streak_k=1.0, scr_n=40):
    N = 512
    ppm = N / TILE[name][0]
    c1 = fbm(N, N, 3.5, 4, seed=seed)
    c2 = fbm(N, N, 22, 3, seed=seed + 1)
    chipf = c1 * 0.6 + c2 * 0.8
    chip = sstep(thr, thr + 0.12, chipf)                                   # hard-edged chips
    primer = sstep(thr - 0.22, thr - 0.08, chipf) * (1 - chip)              # a primer rim round each
    rustf = fbm(N, N, 3, 3, seed=seed + 2)
    rust_in = chip * sstep(-0.4, 0.6, rustf)
    sc = scratches(N, N, scr_n, seed + 3, 8, 60, 0.5)
    sc2 = scratches(N, N, scr_n // 3, seed + 4, 20, 140, 0.7, bias_dir=0.0, spread=0.4)
    scr = np.maximum(sc * 0.7, sc2)
    streak_src = (rust_in * 0.9 + primer * 0.1) * (blob(N, N, 2.0, 2.0, seed=seed + 5) > -0.3)
    streak = run_down(streak_src * 0.7, 45) * sstep(-0.6, 1.2, blob(N, N, 1.6, 40, seed=seed + 6)) * streak_k
    fade = sstep(-0.2, 1.8, fbm(N, N, 70, 4, seed=seed + 7))
    dirt = sstep(0.0, 2.0, fbm(N, N, 30, 5, seed=seed + 8))
    peel = fbm(N, N, 0.8, 2, seed=seed + 9)
    col = np.array(base, np.float32)[None, None, :] * (1 + 0.03 * peel)[:, :, None]
    col = col * (1 - 0.35 * fade[:, :, None]) + np.array(fade_col, np.float32)[None, None, :] * 0.35 * fade[:, :, None]
    rust = lin((96, 52, 28)) * (1 + 0.25 * fbm(N, N, 1.5, 3, seed=seed + 10))[:, :, None]
    steel = lin((88, 88, 86)) * (1 + 0.1 * fbm(N, N, 2, 2, seed=seed + 11))[:, :, None]
    prim = lin((118, 112, 104))
    col = col * (1 - primer[:, :, None]) + prim * primer[:, :, None]
    bare = steel * (1 - sstep(-0.4, 0.6, rustf)[:, :, None]) + rust * sstep(-0.4, 0.6, rustf)[:, :, None]
    col = col * (1 - chip[:, :, None]) + bare * chip[:, :, None]
    col = col * (1 - 0.4 * streak[:, :, None]) + lin((110, 58, 30)) * 0.4 * streak[:, :, None]
    col = col * (1 - 0.4 * scr[:, :, None] * (1 - chip[:, :, None])) + lin((150, 146, 140)) * 0.4 * scr[:, :, None] * (1 - chip[:, :, None])
    col *= (1 - 0.16 * dirt)[:, :, None]
    h = -0.00015 * chip - 0.00005 * primer - 0.00004 * scr + 0.00001 * peel + 0.00008 * rust_in * rustf
    write_png(MODELS + 'bunker_%s.png' % name, enc_srgb(col))
    write_png(MODELS + 'bunker_%s_normal.png' % name, tangent_normal(h, ppm, 4.0))
    return col

# ---------------------------------------------------------------- steel
def tex_steel():
    N = 512
    ppm = N / TILE['steel'][0]
    scale = sstep(0.4, 1.2, fbm(N, N, 18, 4, seed=51)) * 0.32
    bloom = sstep(1.5, 2.3, fbm(N, N, 10, 4, seed=52)) * 0.7
    spots = sstep(2.1, 2.8, fbm(N, N, 3, 3, seed=53)) * 0.8
    sc = scratches(N, N, 50, 54, 6, 60, 0.5)
    roll = blob(N, N, 60, 1.2, seed=55)
    col = lin((96, 95, 92))[None, None, :] * (1 + 0.05 * roll)[:, :, None]
    col = col * (1 - scale[:, :, None]) + lin((52, 56, 62)) * scale[:, :, None]
    rust = lin((112, 64, 36)) * (1 + 0.2 * fbm(N, N, 1.5, 2, seed=56))[:, :, None]
    rr = np.clip(bloom * 0.8 + spots, 0, 1)
    col = col * (1 - rr[:, :, None]) + rust * rr[:, :, None]
    col = col * (1 - 0.35 * sc[:, :, None]) + lin((150, 150, 146)) * 0.35 * sc[:, :, None]
    col *= (1 - 0.15 * sstep(0.2, 2.0, fbm(N, N, 40, 4, seed=57)))[:, :, None]
    write_png(MODELS + 'bunker_steel.png', enc_srgb(col))

# ---------------------------------------------------------------- spiral-seam aluminium
def tex_alu():
    N = 1024
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) + 0.5
    f = 4.0 * xx / N - yy / N
    ph = f - np.round(f)
    dpx = np.abs(ph) * N / math.sqrt(17.0)
    sgn = np.sign(ph)
    seam = sstep(7.0, 4.0, dpx)                                            # the lock seam's band
    crease = sstep(1.4, 0.0, np.abs(dpx - 5.0)) * (sgn < 0)                # a dark fold on one side
    catch = sstep(1.6, 0.0, np.abs(dpx - 3.0)) * (sgn > 0)                 # a bright edge on the other
    theta = math.atan2(4.0, 1.0)
    brush = blob(N, N, 120, 0.6, seed=61, theta=theta) * 0.6 + blob(N, N, 30, 0.5, seed=62, theta=theta) * 0.4
    oxid = sstep(0.4, 1.8, fbm(N, N, 50, 4, seed=63))
    dirt = sstep(0.6, 2.2, fbm(N, N, 25, 4, seed=64))
    seamdirt = sstep(14, 0, dpx) * 0.5
    col = lin((186, 186, 182))[None, None, :] * (1 + 0.07 * brush)[:, :, None]
    col = col * (1 - 0.25 * oxid[:, :, None]) + lin((190, 190, 184)) * 0.25 * oxid[:, :, None]
    col *= (1 - 0.12 * dirt)[:, :, None] * (1 - 0.14 * seamdirt)[:, :, None]
    col *= (1 + 0.05 * seam)[:, :, None]
    col *= (1 - 0.3 * crease)[:, :, None]
    col = np.minimum(col * (1 + 0.3 * catch)[:, :, None], 1.0)
    write_png(MODELS + 'bunker_alu.png', enc_srgb(col))

# ---------------------------------------------------------------- the polished floor (unique to the room)
def floor_coords():
    W_, H_ = FLOOR_PX
    ppm = W_ / FLOOR_MAP['w']
    rows, cols = np.mgrid[0:H_, 0:W_].astype(np.float32) + 0.5
    x = FLOOR_MAP['x0'] + cols / ppm
    z = FLOOR_MAP['z0'] + FLOOR_MAP['d'] - rows / ppm           # row 0 (Blender bottom) = the back wall
    return x, z, ppm

YLINES = [  # (x0, z0, x1, z1): painted yellow strips (room metres)
    (-1.0875, 0.12, -1.0125, 3.0), (1.0125, 0.12, 1.0875, 3.0),                 # walkway, mouth to the hazard zone
    (1.525, 0.86, 1.6, 3.36),                                                    # along the bench's foot
]
PLATE_BORDER = (PLATE['x0'] - 0.1, PLATE['z0'] - 0.1, PLATE['x1'] + 0.1, PLATE['z1'] + 0.1, 0.06)
HAZARD = (-0.95, 3.06, 0.95, 3.57)

def tex_floor():
    t0 = time.time()
    x, z, ppm = floor_coords()
    H_, W_ = x.shape
    px = 1.0 / ppm
    S = lambda m: m * ppm                                         # metres -> px (for blur sigmas)
    # Wear paths: where people walk (mouth to lift, to the chair, the radar, the locker, the call button).
    paths = [[(0.0, 0.0), (0.05, 1.2), (-0.05, 2.6), (0.0, 3.6)], [(0.05, 1.3), (0.7, 1.9), (0.95, 2.15)], [(0.0, 1.0), (-0.9, 1.45), (-1.35, 1.6)],
             [(0.0, 0.35), (0.9, 0.62), (1.35, 0.75)], [(0.0, 2.9), (-0.8, 3.15), (-1.05, 3.3)], [(0.9, 2.15), (1.25, 2.1)]]
    dmin = np.full(x.shape, 1e9, np.float32)
    for pth in paths:
        dmin = np.minimum(dmin, seg_dist(x, z, pth))
    wear = np.exp(-(dmin / 0.32) ** 2) * (0.75 + 0.25 * fbm(H_, W_, S(0.15), 3, seed=71))
    wear = np.clip(wear, 0, 1)
    # Distance to the walls (dust settles there) and furniture footprints (dirt under them).
    dwall = np.minimum(np.minimum(x + HW, HW - x), np.minimum(z, D - z))
    dust = np.exp(-dwall / 0.07) * (0.7 + 0.3 * fbm(H_, W_, S(0.05), 3, seed=72))
    feet = [(DESK['x0'] - 0.02, DESK['z0'], HW, DESK['z1']), (-HW, 1.0, -1.85, 2.2), (-HW, 2.35, -1.9, 3.25), (LOCKER['x0'], 0, LOCKER['x1'], LOCKER['z1']),
            (SHELF['x0'], 0, SHELF['x1'], SHELF['z1']), (-HW, 0.55, -1.8, 0.95)]
    under = np.zeros(x.shape, np.float32)
    for (a0, b0, a1, b1) in feet:
        under = np.maximum(under, sstep(0.06, -0.04, rect_dist(x, z, a0, b0, a1, b1)))
    # Base concrete: warm grey paste, trowel clouds, mottling, sand, and the cut aggregate polishing exposes.
    clouds = fbm(H_, W_, S(0.5), 4, seed=73)
    mott = fbm(H_, W_, S(0.05), 4, seed=74)
    sand = fbm(H_, W_, 0.7, 2, seed=75)
    col = lin((126, 120, 110))[None, None, :] * (1 + 0.07 * clouds + 0.035 * mott + 0.014 * sand)[:, :, None]
    f1, _f2, fid = worley(H_, W_, int(W_ / 9), int(H_ / 9), 76, 1.0)
    stone_r = 1.3 + fid * 2.6
    stone = sstep(stone_r + 0.6, stone_r - 0.6, f1)
    expose = sstep(-0.8, 1.0, fbm(H_, W_, S(0.3), 3, seed=77)) * 0.38
    rr = np.random.default_rng(78)
    pal = np.array([srgb(92, 90, 88), srgb(150, 144, 132), srgb(120, 104, 88), srgb(70, 68, 66), srgb(168, 160, 150), srgb(132, 96, 78)], np.float32)
    sc = pal[(fid * 977).astype(np.int32) % len(pal)]
    a = (stone * expose)[:, :, None]
    col = col * (1 - a) + sc * a
    # Trowel arcs: faint swirls in tone and sheen.
    arcs = np.zeros(x.shape, np.float32)
    r2 = random.Random(79)
    for _ in range(26):
        cx, cz, rad = r2.uniform(-2.6, 2.6), r2.uniform(-0.2, 3.8), r2.uniform(0.35, 1.0)
        d = np.abs(np.hypot(x - cx, z - cz) - rad)
        arcs += np.exp(-(d / 0.05) ** 2) * sstep(rad + 0.5, rad, np.hypot(x - cx, z - cz)) * r2.uniform(0.3, 1.0)
    arcs = np.clip(arcs, 0, 1)
    col *= (1 + 0.03 * arcs)[:, :, None]
    # The wear itself: the polish ground off, dirt ground in, a little greyer.
    col = col * (1 - 0.16 * wear[:, :, None]) + lin((96, 92, 86)) * 0.1 * wear[:, :, None]
    col = col * (1 - 0.25 * under[:, :, None])
    # Pitting: where the polish has gone (the wear paths, damp near the drains and the mouth, patches elsewhere).
    dtrench = rect_dist(x, z, TRENCH['x0'], TRENCH['z0'], TRENCH['x1'], TRENCH['z1'])
    dsq = rect_dist(x, z, SQDRAIN[0] - SQDRAIN[2], SQDRAIN[1] - SQDRAIN[2], SQDRAIN[0] + SQDRAIN[2], SQDRAIN[1] + SQDRAIN[2])
    damp = np.exp(-np.maximum(dtrench, 0) / 0.35) + np.exp(-np.maximum(dsq, 0) / 0.3) + np.exp(-np.maximum(z, 0) / 0.5) * 0.6
    pz = np.clip(sstep(0.3, 1.4, fbm(H_, W_, S(0.25), 4, seed=80)) * 0.9 + wear * 0.75 + damp * 0.5 + dust * 0.3, 0, 1)
    f1p, _f2p, fidp = worley(H_, W_, int(W_ / 5), int(H_ / 5), 81, 1.0)
    pit_r = 0.45 + fidp * 1.3
    pits = sstep(pit_r + 0.5, pit_r - 0.4, f1p) * (fidp * 1.7 < pz * pz + 0.05)
    f1s, _f2s, fids = worley(H_, W_, int(W_ / 40), int(H_ / 40), 82, 1.0)
    spall_r = 3.0 + fids * 6.0 * (0.6 + 0.4 * fbm(H_, W_, 4, 2, seed=83))
    spalls = sstep(spall_r + 1.0, spall_r - 1.0, f1s) * (fids > 0.93 - 0.25 * pz * wear)
    col = col * (1 - 0.62 * pits[:, :, None])
    col = col * (1 - spalls[:, :, None]) + lin((112, 106, 98)) * (1 + 0.15 * sand)[:, :, None] * spalls[:, :, None]
    # Saw-cut control joints (x = +-1.25, z = 1.8), chipped and dirt-filled, never across the plate.
    joints = np.zeros(x.shape, np.float32)
    jn = fbm(H_, W_, 3, 2, seed=84)
    for (kind, v, lo, hi) in (('x', -1.25, 0.0, D), ('x', 1.25, 0.0, D), ('z', 1.8, -HW, HW)):
        dd = np.abs((x if kind == 'x' else z) - v)
        along = z if kind == 'x' else x
        span = (along > lo) & (along < hi)
        w = 0.0022 + 0.0018 * np.clip(jn, 0, 2)
        joints = np.maximum(joints, sstep(w + px, w - px * 0.5, dd) * span)
    joints *= (rect_dist(x, z, PLATE['x0'] - 0.06, PLATE['z0'] - 0.06, PLATE['x1'] + 0.06, PLATE['z1'] + 0.06) > 0)
    joints *= (rect_dist(x, z, TRENCH['x0'] - 0.03, TRENCH['z0'] - 0.03, TRENCH['x1'] + 0.03, TRENCH['z1'] + 0.03) > 0)
    col = col * (1 - 0.75 * joints[:, :, None])
    # Stains: oil under the bench and chair, by the locker and the lift; rust round steel at the floor; tide marks by the drains.
    oil = np.zeros(x.shape, np.float32)
    for (ox, oz, r, k) in ((1.55, 1.15, 0.22, 0.9), (1.05, 2.35, 0.3, 0.6), (1.45, 0.62, 0.16, 0.8), (-1.65, 1.35, 0.25, 0.7), (0.35, 3.3, 0.2, 0.5),
                           (-0.25, 0.6, 0.12, 0.6), (-1.95, 2.9, 0.2, 0.7), (0.6, 1.0, 0.09, 0.5)):
        e = np.exp(-(((x - ox) ** 2 + (z - oz) ** 2) / (r * r)))
        oil = np.maximum(oil, sstep(0.25, 0.6, e * (0.6 + 0.6 * fbm(H_, W_, S(0.06), 3, seed=int(ox * 100 + oz * 10) % 997))) * k)
    col = col * (1 - 0.45 * oil[:, :, None]) * (1 - 0.15 * oil[:, :, None] * np.array([0.0, 0.2, 0.5], np.float32)[None, None, :])
    rust = np.zeros(x.shape, np.float32)
    for (a0, b0, a1, b1, r) in ((TRENCH['x0'] - 0.02, TRENCH['z0'] - 0.02, TRENCH['x1'] + 0.02, TRENCH['z1'] + 0.02, 0.05),
                                (PLATE['x0'] - 0.03, PLATE['z0'] - 0.03, PLATE['x1'] + 0.03, PLATE['z1'] + 0.03, 0.04),
                                (SQDRAIN[0] - SQDRAIN[2] - 0.02, SQDRAIN[1] - SQDRAIN[2] - 0.02, SQDRAIN[0] + SQDRAIN[2] + 0.02, SQDRAIN[1] + SQDRAIN[2] + 0.02, 0.06),
                                (-1.0, 0.0, -0.7, 0.26, 0.05), (0.7, 0.0, 1.0, 0.26, 0.05)):
        d = rect_dist(x, z, a0, b0, a1, b1)
        rust = np.maximum(rust, np.exp(-np.maximum(d, 0) / r) * (d > -0.001) * sstep(-0.5, 1.2, fbm(H_, W_, S(0.03), 3, seed=85)))
    col = col * (1 - 0.4 * rust[:, :, None]) + lin((120, 64, 30)) * 0.4 * rust[:, :, None]
    tide = np.zeros(x.shape, np.float32)
    for (dd, r0) in ((dtrench, 0.22), (dsq, 0.2)):
        for k, rr_ in enumerate((r0, r0 * 1.6, r0 * 0.6)):
            wv = rr_ + 0.05 * fbm(H_, W_, S(0.08), 3, seed=86 + k)
            tide = np.maximum(tide, np.exp(-((dd - wv) / 0.006) ** 2) * (0.7 - 0.2 * k))
    col = col * (1 - 0.12 * tide[:, :, None])
    # Chair casters: arcs of black rubber in front of the bench.
    marks = np.zeros(x.shape, np.float32)
    r3 = random.Random(87)
    for _ in range(26):
        cx, cz = CHAIR[0] + r3.uniform(-0.25, 0.15), CHAIR[1] + r3.uniform(-0.25, 0.25)
        rad = r3.uniform(0.22, 0.34)
        a0 = r3.uniform(0, 2 * PI)
        span = r3.uniform(0.4, 1.4)
        ang = np.arctan2(z - cz, x - cx)
        da = (ang - a0 + PI) % (2 * PI) - PI
        m = np.exp(-((np.hypot(x - cx, z - cz) - rad) / 0.004) ** 2) * (np.abs(da) < span / 2) * r3.uniform(0.2, 0.6)
        marks = np.maximum(marks, m)
    col = col * (1 - 0.5 * marks[:, :, None])
    # Dust along the walls.
    col = col * (1 - 0.3 * dust[:, :, None]) + lin((150, 144, 132)) * 0.3 * dust[:, :, None]
    # Micro scratches in the polish along the walkway.
    scr = scratches(H_, W_, 900, 88, 20, 180, 0.45, wrap=False) * (0.3 + 0.7 * wear)
    col = col * (1 - 0.12 * scr[:, :, None]) + lin((160, 156, 148)) * 0.12 * scr[:, :, None]
    # ---- yellow paint: lines, the plate's border, hazard hatching at the lift; worn and chipped
    edge_n = fbm(H_, W_, 1.5, 2, seed=89) * 0.0012
    paint = np.zeros(x.shape, np.float32)
    for (a0, b0, a1, b1) in YLINES:
        paint = np.maximum(paint, sstep(px * 0.7, -px * 0.7, rect_dist(x, z, a0, b0, a1, b1) + edge_n))
    bx0, bz0, bx1, bz1, bw = PLATE_BORDER
    ring = rect_dist(x, z, bx0, bz0, bx1, bz1)
    paint = np.maximum(paint, sstep(px * 0.7, -px * 0.7, np.abs(ring + bw / 2) - bw / 2 + edge_n))
    hx0, hz0, hx1, hz1 = HAZARD
    hz_in = sstep(px * 0.7, -px * 0.7, rect_dist(x, z, hx0, hz0, hx1, hz1) + edge_n)
    border = sstep(px * 0.7, -px * 0.7, np.abs(rect_dist(x, z, hx0, hz0, hx1, hz1) + 0.025) - 0.025 + edge_n)
    diag = ((x - z) / 0.1) % 2.0
    stripe_y = sstep(0.03, 0.0, np.abs(((x - z) % 0.2) - 0.05) - 0.05 + edge_n * 3) * hz_in
    blackp = hz_in * (1 - stripe_y) * (1 - border)
    paint = np.maximum(paint, np.maximum(border, stripe_y))
    # Chips and wear through the paint: more on the walked lines, edges first.
    chipn = fbm(H_, W_, 2.2, 4, seed=90) * 0.7 + fbm(H_, W_, S(0.04), 3, seed=91) * 0.6
    keep = sstep(0.55 - 0.8 * wear - 0.2 * pz, 0.75 - 0.8 * wear - 0.2 * pz, -chipn + 0.6)
    yel = paint * keep
    blk = blackp * sstep(0.45 - 0.7 * wear, 0.65 - 0.7 * wear, -chipn + 0.55)
    ycol = lin((214, 166, 30))[None, None, :] * (1 - 0.18 * sstep(0.0, 2.0, fbm(H_, W_, S(0.04), 4, seed=92)))[:, :, None]
    ycol *= (1 - 0.35 * wear * 0.6)[:, :, None]
    col = col * (1 - yel[:, :, None]) + ycol * yel[:, :, None]
    col = col * (1 - blk[:, :, None]) + lin((26, 25, 24)) * blk[:, :, None]
    col = col * (1 - 0.35 * pits[:, :, None] * (yel + blk)[:, :, None])
    col = np.clip(col, 0, 1)
    # ---- roughness
    sheen = fbm(H_, W_, S(0.4), 4, seed=93)
    rgh = 0.2 + 0.035 * sheen - 0.03 * arcs
    rgh = rgh + (0.62 - rgh) * wear * 0.75
    rgh = rgh + (0.8 - rgh) * pz * 0.45
    rgh = rgh + (0.62 - rgh) * under
    rgh = rgh + 0.35 * dust
    rgh = np.where(yel + blk > 0.5, 0.52 + 0.08 * sand + 0.15 * wear, rgh)
    rgh = rgh * (1 - oil) + 0.1 * oil
    rgh = rgh + 0.12 * tide + 0.2 * marks + 0.15 * scr
    rgh = np.maximum(rgh, 0.95 * pits)
    rgh = np.maximum(rgh, 0.92 * np.maximum(joints, spalls))
    rgh = np.clip(rgh, 0.08, 0.98)
    # ---- height (metres) -> room-space normals
    # (Written at half resolution: the roughness map carries the pits' fine detail, this their dimples and the cuts.)
    hgt = 0.0003 * fblur(clouds, 3) - 0.0012 * pits - 0.003 * spalls - 0.008 * joints + 0.00025 * (yel + blk)
    hgt = 0.25 * (hgt[0::2, 0::2] + hgt[1::2, 0::2] + hgt[0::2, 1::2] + hgt[1::2, 1::2])
    hp = ppm / 2
    dhx = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * (hp / 2)
    dhr = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * (hp / 2)       # per row up = toward -z
    dhz = -dhr
    n = np.stack([-dhx, np.ones_like(hgt), -dhz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    write_png(MODELS + 'bunker_floor.png', enc_srgb(col))
    write_png(MODELS + 'bunker_floor_rough.png', rgh)
    write_png(MODELS + 'bunker_floor_normal.png', np.stack([n[:, :, 0], n[:, :, 2], n[:, :, 1]], axis=-1) * 0.5 + 0.5)
    return round(time.time() - t0, 1)

# ---------------------------------------------------------------- the decal atlas: numpy grounds, vector ink and type rendered by Cycles
BLENDER_FONTS = os.path.join(os.path.dirname(bpy.app.binary_path), '%d.%d' % bpy.app.version[:2], 'datafiles', 'fonts')
FONT_FILES = {   # first that loads wins (the Windows faces, else Blender's own)
    'sans': ['C:/Windows/Fonts/arialbd.ttf', BLENDER_FONTS + '/Inter.woff2'],
    'din': ['C:/Windows/Fonts/bahnschrift.ttf', 'C:/Windows/Fonts/arialbd.ttf', BLENDER_FONTS + '/Inter.woff2'],
    'mono': ['C:/Windows/Fonts/consola.ttf', BLENDER_FONTS + '/DejaVuSansMono.woff2'],
    'monob': ['C:/Windows/Fonts/consolab.ttf', BLENDER_FONTS + '/DejaVuSansMono.woff2'],
    'hand': ['C:/Windows/Fonts/Inkfree.ttf', 'C:/Windows/Fonts/segoepr.ttf', BLENDER_FONTS + '/Inter.woff2'],
    'stencil': ['C:/Windows/Fonts/STENCIL.TTF', 'C:/Windows/Fonts/impact.ttf', BLENDER_FONTS + '/Inter.woff2'],
}
_fonts = {}

def font(kind):
    if kind in _fonts:
        return _fonts[kind]
    f = None
    for p in FONT_FILES[kind]:
        try:
            if os.path.exists(p):
                f = bpy.data.fonts.load(p, check_existing=True)
                break
        except Exception:
            f = None
    _fonts[kind] = f
    return f

class Ink:
    """Vector art and type over the atlas (pixel units, origin at the bottom left), coloured per vertex; higher z on top."""

    def __init__(self):
        self.v, self.f, self.c, self.texts = [], [], [], []

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
        b = len(self.v)
        for i in range(n):
            if closed and i in (0, n - 1):
                d = P[1] - P[-2]
            else:
                d = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
            if d.length < 1e-9:
                d = Vector((1, 0))
            d.normalize()
            nrm = Vector((-d.y, d.x)) * (w / 2)
            l, r = P[i] + nrm, P[i] - nrm
            self.v += [(l.x, l.y, z), (r.x, r.y, z)]
            self.c += [col, col]
        for i in range(n - 1):
            self.f.append([b + 2 * i, b + 2 * i + 1, b + 2 * i + 3, b + 2 * i + 2])

    def line(self, a, b, w, col, z=0.001):
        self.stroke([a, b], w, col, z)

    def circle(self, cx, cy, r, w, col, z=0.001, n=None):
        n = n or max(24, int(r * 1.5))
        self.stroke([(cx + math.cos(2 * PI * k / n) * r, cy + math.sin(2 * PI * k / n) * r) for k in range(n)], w, col, z, closed=True)

    def disc(self, cx, cy, r, col, z=0.001, n=None):
        n = n or max(10, int(r * 1.5))
        self.poly([(cx + math.cos(2 * PI * k / n) * r, cy + math.sin(2 * PI * k / n) * r) for k in range(n)], col, z)

    def rect(self, x0, y0, x1, y1, w, col, z=0.001):
        for (a, b) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            d = Vector(b) - Vector(a)
            e = d.normalized() * (w / 2)
            self.line(tuple(Vector(a) - e), tuple(Vector(b) + e), w, col, z)

    def box(self, x0, y0, x1, y1, col, z=0.0):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], col, z)

    def dashed(self, pts, w, col, dash, gap, z=0.001):
        P = [Vector(p) for p in pts]
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

    def text(self, s, x, y, size, col, kind='sans', z=0.01, align='CENTER', rot=0.0, valign='CENTER', space=1.0):
        self.texts.append((s, x, y, size, col, kind, z, align, rot, valign, space))

    def scribble(self, x0, y, x1, h, col, w=1.2, seed=0, z=0.01):
        """A line of illegible handwriting."""
        r = random.Random(seed)
        x = x0
        pts = []
        while x < x1:
            pts.append((x, y + r.uniform(-0.5, 0.5) * h))
            x += r.uniform(0.25, 0.6) * h
            if r.random() < 0.12 and len(pts) > 2:
                self.stroke(pts, w, col, z)
                pts = []
                x += h * 0.6
        if len(pts) > 1:
            self.stroke(pts, w, col, z)

def wobble(pts, amp, freq, seed=0.0):
    out = []
    for (x, y) in pts:
        n1 = mnoise.noise(Vector((x * freq, y * freq, seed)))
        n2 = mnoise.noise(Vector((x * freq + 17.3, y * freq - 4.1, seed)))
        out.append((x + n1 * amp, y + n2 * amp))
    return out

def render_ink(ink, N):
    """Render the ink over black and over white; returns (premultiplied rgb, alpha), HxWx3 / HxW, row 0 at the bottom."""
    sc = bpy.data.scenes.get('DB_paint') or bpy.data.scenes.new('DB_paint')
    for ob in list(sc.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    _cycles(sc, 16)
    sc.cycles.max_bounces = 0
    sc.cycles.use_denoising = False
    try:
        sc.cycles.filter_width = 1.0
    except Exception:
        pass
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.resolution_x = sc.render.resolution_y = N
    sc.render.resolution_percentage = 100
    w = bpy.data.worlds.get('DB_paint_world') or bpy.data.worlds.new('DB_paint_world')
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    sc.world = w
    me = bpy.data.meshes.new('DB_ink')
    me.from_pydata(ink.v, [], ink.f)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', [x for c in ink.c for x in (c[0], c[1], c[2], 1.0)])
    def emis_mat(name, col=None):
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        if col is None:
            c = node(nt, 'ShaderNodeAttribute', props={'attribute_name': 'Col'}).outputs['Color']
        else:
            c = (col[0], col[1], col[2], 1.0)
        em = node(nt, 'ShaderNodeEmission', Color=c, Strength=1.0)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        return mat
    me.materials.append(emis_mat('DB_ink'))
    ob = bpy.data.objects.new('DB_ink', me)
    sc.collection.objects.link(ob)
    mats = {}
    for i, (s, x, y, size, col, kind, z, align, rot, valign, space) in enumerate(ink.texts):
        cu = bpy.data.curves.new('DB_txt_%d' % i, 'FONT')
        cu.body = s
        f = font(kind)
        if f is not None:
            cu.font = f
        cu.size = size
        cu.align_x = align
        cu.align_y = valign
        cu.space_character = space
        key = tuple(round(v, 4) for v in col)
        if key not in mats:
            mats[key] = emis_mat('DB_txtmat_%d' % len(mats), col)
        cu.materials.append(mats[key])
        to = bpy.data.objects.new('DB_txt_%d' % i, cu)
        to.location = (x, y, z)
        to.rotation_euler = (0, 0, rot)
        sc.collection.objects.link(to)
    cd = bpy.data.cameras.get('DB_ink_cam') or bpy.data.cameras.new('DB_ink_cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = N
    cd.clip_start, cd.clip_end = 0.1, 100
    cam = bpy.data.objects.new('DB_ink_cam', cd)
    cam.location = (N / 2, N / 2, 10)
    sc.collection.objects.link(cam)
    sc.camera = cam
    res = []
    for bgv in (0.0, 1.0):
        bg.inputs['Color'].default_value = (bgv, bgv, bgv, 1)
        bg.inputs['Strength'].default_value = 1.0
        bpy.ops.render.render(scene=sc.name)
        path = os.path.join(bpy.app.tempdir, 'db_ink.exr')
        bpy.data.images['Render Result'].save_render(path, scene=sc)
        im = bpy.data.images.load(path)
        res.append(_np_image(im)[:, :, :3].copy())
        bpy.data.images.remove(im)
    for o in list(sc.objects):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Curve):
            bpy.data.curves.remove(data)
    bpy.data.meshes.remove(me)
    blk, wht = res
    alpha = np.clip(1.0 - (wht - blk).mean(axis=2), 0.0, 1.0)
    return np.clip(blk, 0, None), alpha

def paper_ground(Hh, Ww, base, seed, stain=1.0, edge=6.0, fold=()):
    """Aged paper: mottling, fibres, foxing, a darker edge and fold creases."""
    big = fbm(Hh, Ww, max(4, Ww / 6), 4, seed=seed)
    fib = blob(Hh, Ww, 0.6, 3.0, seed=seed + 1)
    fox = sstep(1.8, 2.6, fbm(Hh, Ww, 2.5, 3, seed=seed + 2))
    yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32) + 0.5
    ed = np.minimum(np.minimum(xx, Ww - xx), np.minimum(yy, Hh - yy))
    k = (1 + 0.05 * big + 0.008 * fib) * (1 - 0.25 * fox * stain) * (0.8 + 0.2 * sstep(0, edge, ed))
    col = np.array(base, np.float32)[None, None, :] * k[:, :, None]
    col = col * (1 - 0.12 * stain * sstep(0.5, 2.0, big)[:, :, None] * np.array([0.0, 0.25, 0.55], np.float32)[None, None, :])
    for (axis, at) in fold:
        d = np.abs((xx / Ww if axis == 'x' else yy / Hh) - at) * (Ww if axis == 'x' else Hh)
        col *= (0.86 + 0.14 * sstep(0.0, 2.0, d))[:, :, None]
        col *= (1 + 0.06 * np.exp(-((d - 2.5) / 1.5) ** 2))[:, :, None]
    return col

def grime(Hh, Ww, seed, k=0.2, s=8.0):
    return (1 - k * sstep(0.2, 2.0, fbm(Hh, Ww, s, 4, seed=seed)))[:, :, None]

INKBLUE = srgb(24, 34, 80)
INKBLK = srgb(18, 18, 20)
PENCIL = srgb(70, 70, 74)
WHITEINK = (0.86, 0.9, 0.97)

def paint_atlas(path):
    t0 = time.time()
    N = ATLAS_PX
    bg = np.full((N, N, 3), 0.2, np.float32)
    ink = Ink()
    def R(name):
        x, y, w, h = ATLAS_RECT[name]
        return x, N - y - h, x + w, N - y               # Blender pixel rect: x0, y0 (bottom), x1, y1
    def ground(name, arr):
        x0, y0, x1, y1 = R(name)
        bg[y0:y1, x0:x1] = arr
    def ground_mul(name, k):
        x0, y0, x1, y1 = R(name)
        bg[y0:y1, x0:x1] *= k

    # ---- the desk top (u along the bench, v from its front edge to the wall), 640 px/m
    x0, y0, x1, y1 = R('desk')
    Ww, Hh = x1 - x0, y1 - y0
    ppm = Ww / 2.4
    yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32) + 0.5
    zc, xc = DESK['z0'] + xx / ppm, DESK['x0'] + yy / ppm          # room z along, room x across (0 = the front edge)
    lam = lin((150, 146, 134)) * (1 + 0.04 * fbm(Hh, Ww, 30, 4, seed=201))[:, :, None] * (1 + 0.008 * blob(Hh, Ww, 1.0, 1.0, seed=202))[:, :, None]
    rest = np.exp(-(((zc - 2.1) / 0.32) ** 2 + ((xc - 1.73) / 0.07) ** 2)) + 0.6 * np.exp(-(((zc - 1.55) / 0.3) ** 2 + ((xc - 1.75) / 0.1) ** 2))
    lam = lam * (1 + 0.09 * rest[:, :, None]) * (1 - 0.06 * rest[:, :, None] * np.array([0.0, 0.1, 0.4], np.float32)[None, None, :])
    edge = np.exp(-yy / 10.0) + np.exp(-(Hh - yy) / 18.0)
    lam *= (1 - 0.22 * edge)[:, :, None]
    sc_ = scratches(Hh, Ww, 260, 203, 6, 90, 0.5, wrap=False)
    lam = lam * (1 - 0.35 * sc_[:, :, None]) + lin((176, 172, 162)) * 0.35 * sc_[:, :, None]
    dsc = scratches(Hh, Ww, 60, 204, 10, 60, 0.6, wrap=False)
    lam *= (1 - 0.25 * dsc)[:, :, None]
    for (rz, rx, r, k) in ((2.5, 1.8, 0.043, 0.5), (2.47, 1.83, 0.044, 0.3), (1.25, 1.9, 0.04, 0.35), (2.95, 1.75, 0.045, 0.25)):
        d = np.abs(np.hypot(zc - rz, xc - rx) - r)
        ang = np.arctan2(xc - rx, zc - rz)
        cof = k * np.exp(-(d / 0.0018) ** 2) * (0.55 + 0.45 * np.sin(ang * 2 + rz * 7))
        lam = lam * (1 - cof[:, :, None] * np.array([0.35, 0.55, 0.75], np.float32)[None, None, :])
    for (bz, bx2, r, col_) in ((1.6, 2.15, 0.03, (0.05, 0.06, 0.12)), (2.7, 2.25, 0.012, (0.04, 0.03, 0.02))):
        e = np.exp(-(((zc - bz) ** 2 + (xc - bx2) ** 2) / (r * r))) * sstep(-0.3, 0.6, fbm(Hh, Ww, 4, 3, seed=205))
        lam = lam * (1 - 0.8 * e[:, :, None]) + np.array(col_, np.float32)[None, None, :] * 0.8 * e[:, :, None]
    ground('desk', lam)
    for k in range(5):
        ink.scribble(x0 + 120 + k * 7, y0 + 330 - k * 22, x0 + 330 + k * 18, 7, PENCIL, 1.0, seed=300 + k)
    ink.text('x = 41.2', x0 + 1180, y0 + 120, 22, PENCIL, 'hand', rot=0.08)
    ink.text('brg 133?', x0 + 1210, y0 + 90, 20, PENCIL, 'hand', rot=0.05)
    ink.stroke(wobble([(x0 + 1170 + 70 * math.cos(a / 10), y0 + 105 + 30 * math.sin(a / 10)) for a in range(64)], 1.5, 0.05, 3), 1.2, PENCIL)

    # ---- the corkboard, 1138 px/m: cork granules, pin holes, pale ghosts of sheets long gone; a calendar and a card on it
    x0, y0, x1, y1 = R('cork')
    Ww, Hh = x1 - x0, y1 - y0
    f1, _f2, fid = worley(Hh, Ww, Ww // 3, Hh // 3, 210, 1.0)
    cork = lin((168, 118, 70))[None, None, :] * (0.75 + 0.5 * fid)[:, :, None] * (1 - 0.25 * sstep(1.0, 0.0, f1))[:, :, None]
    cork *= (1 + 0.08 * fbm(Hh, Ww, 40, 3, seed=211))[:, :, None]
    yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32) + 0.5
    r2 = random.Random(212)
    for _ in range(7):
        gx, gy, gw, gh = r2.uniform(0, Ww), r2.uniform(0, Hh), r2.uniform(80, 300), r2.uniform(80, 260)
        m = sstep(3, -3, rect_dist(xx, yy, gx, gy, gx + gw, gy + gh))
        cork = cork * (1 + 0.12 * m[:, :, None])
    for _ in range(140):
        hx, hy = r2.uniform(0, Ww), r2.uniform(0, Hh)
        m = np.exp(-((xx - hx) ** 2 + (yy - hy) ** 2) / 1.8)
        cork *= (1 - 0.7 * m)[:, :, None]
    ground('cork', cork)
    cx_, cy_ = x0 + 70, y0 + 120
    ink.box(cx_, cy_, cx_ + 200, cy_ + 250, (0.78, 0.74, 0.66), 0.002)
    ink.box(cx_, cy_ + 200, cx_ + 200, cy_ + 250, srgb(150, 40, 30), 0.003)
    ink.text('SEPT 1979', cx_ + 100, cy_ + 225, 26, (0.92, 0.9, 0.86), 'din', z=0.012)
    for i in range(6):
        for j in range(7):
            ink.rect(cx_ + 10 + j * 26, cy_ + 12 + i * 30, cx_ + 10 + (j + 1) * 26, cy_ + 12 + (i + 1) * 30, 1.0, (0.3, 0.3, 0.3), 0.004)
            n_ = i * 7 + j - 4
            if 1 <= n_ <= 30:
                ink.text(str(n_), cx_ + 23 + j * 26, cy_ + 12 + (5 - i) * 30 + 20, 10, (0.15, 0.15, 0.15), 'sans', z=0.012)
    ink.circle(cx_ + 10 + 4 * 26 + 13, cy_ + 12 + (5 - 2) * 30 + 15, 13, 2.0, srgb(170, 20, 20), 0.013)
    bx_, by_ = x0 + 760, y0 + 520
    ink.box(bx_, by_, bx_ + 170, by_ + 95, (0.85, 0.83, 0.78), 0.002)
    ink.text('C. MARCH', bx_ + 85, by_ + 62, 20, INKBLK, 'din', z=0.01)
    ink.text('field survey', bx_ + 85, by_ + 35, 14, (0.3, 0.3, 0.3), 'sans', z=0.01)

    # ---- blueprint: the bunker's plan, white on Prussian blue
    x0, y0, x1, y1 = R('bp1')
    Ww, Hh = x1 - x0, y1 - y0
    blue = paper_ground(Hh, Ww, lin((26, 56, 116)), 220, 0.6, 10, (('x', 0.5), ('y', 0.5)))
    ground('bp1', blue)
    s = 64.0
    ox, oy = x0 + 80, y0 + 70
    def P_(px_, pz_):
        return (ox + (px_ + 2.4) * s * 0.55, oy + pz_ * s * 0.55)
    W_ = WHITEINK
    for (a, b) in (((-2.4, 0), (-0.7, 0)), ((0.7, 0), (2.4, 0)), ((2.4, 0), (2.4, 3.6)), ((2.4, 3.6), (0.68, 3.6)), ((-0.68, 3.6), (-2.4, 3.6)), ((-2.4, 3.6), (-2.4, 0))):
        ink.line(P_(*a), P_(*b), 3.0, W_)
    for k in range(9):
        ink.line(P_(-0.7, -0.08 - k * 0.14), P_(0.7, -0.08 - k * 0.14), 1.0, W_)
    ink.line(P_(-0.7, 0), P_(-0.7, -1.3), 1.4, W_)
    ink.line(P_(0.7, 0), P_(0.7, -1.3), 1.4, W_)
    ink.rect(*P_(-0.9, 3.6), *P_(0.9, 4.3), 1.5, W_)
    ink.line(P_(-0.9, 3.6), P_(0.9, 4.3), 1.0, W_)
    ink.line(P_(-0.9, 4.3), P_(0.9, 3.6), 1.0, W_)
    ink.rect(*P_(1.65, 0.9), *P_(2.4, 3.3), 1.2, W_)
    ink.rect(*P_(-2.4, 1.0), *P_(-1.85, 2.2), 1.2, W_)
    ink.dashed([P_(-2.4, -0.25), P_(2.4, -0.25)], 0.9, W_, 6, 4)
    ink.text('4800', P_(0, -0.32)[0], P_(0, -0.32)[1] - 6, 12, W_, 'mono')
    ink.dashed([P_(2.6, 0), P_(2.6, 3.6)], 0.9, W_, 6, 4)
    ink.text('3600', P_(2.75, 1.8)[0], P_(2.75, 1.8)[1], 12, W_, 'mono', rot=PI / 2)
    ink.text('UP', P_(0, -0.8)[0], P_(0, -0.8)[1], 12, W_, 'mono')
    ink.text('LIFT', P_(0, 3.95)[0], P_(0, 3.95)[1], 12, W_, 'mono')
    ink.rect(x0 + 330, y0 + 14, x1 - 14, y0 + 84, 1.5, W_)
    ink.text('BUNKER 7  LEVEL -1', x0 + 418, y0 + 64, 13, W_, 'monob')
    ink.text('SURVEY RELAY', x0 + 418, y0 + 44, 12, W_, 'mono')
    ink.text('DWG 7-104  REV B', x0 + 418, y0 + 25, 11, W_, 'mono')
    ink.rect(x0 + 8, y0 + 8, x1 - 8, y1 - 8, 2.0, W_)

    # ---- schematic: the sweep generator, ink on cream
    x0, y0, x1, y1 = R('bp2')
    Ww, Hh = x1 - x0, y1 - y0
    ground('bp2', paper_ground(Hh, Ww, lin((224, 214, 188)), 230, 1.0, 6, (('y', 0.5),)))
    K = INKBLUE
    def resistor(xa, ya, xb, yb):
        n_ = 7
        pts = [(xa, ya)]
        for i in range(1, n_):
            t = i / n_
            px_, py_ = xa + (xb - xa) * t, ya + (yb - ya) * t
            off = 6 * (1 if i % 2 else -1)
            pts.append((px_ + (0 if xa != xb else off), py_ + (off if xa != xb else 0)))
        pts.append((xb, yb))
        ink.stroke(pts, 1.4, K)
    def cap(xc, yc, horiz=True):
        if horiz:
            ink.line((xc - 9, yc - 3), (xc + 9, yc - 3), 1.6, K)
            ink.line((xc - 9, yc + 3), (xc + 9, yc + 3), 1.6, K)
        else:
            ink.line((xc - 3, yc - 9), (xc - 3, yc + 9), 1.6, K)
            ink.line((xc + 3, yc - 9), (xc + 3, yc + 9), 1.6, K)
    def gnd(xc, yc):
        for i, w_ in enumerate((12, 8, 4)):
            ink.line((xc - w_, yc - i * 4), (xc + w_, yc - i * 4), 1.4, K)
    bx, by = x0 + 40, y0 + 90
    ink.line((bx, by + 200), (bx + 420, by + 200), 1.4, K)
    ink.text('+12V', bx - 6, by + 214, 11, K, 'mono')
    resistor(bx + 60, by + 200, bx + 60, by + 120)
    ink.text('R4 10K', bx + 92, by + 160, 10, K, 'mono')
    ink.circle(bx + 140, by + 100, 22, 1.4, K)
    ink.line((bx + 60, by + 120), (bx + 60, by + 100), 1.4, K)
    ink.line((bx + 60, by + 100), (bx + 128, by + 100), 1.4, K)
    ink.line((bx + 150, by + 116), (bx + 150, by + 200), 1.4, K)
    ink.line((bx + 150, by + 84), (bx + 150, by + 40), 1.4, K)
    gnd(bx + 150, by + 34)
    cap(bx + 230, by + 100, False)
    ink.line((bx + 150, by + 100), (bx + 227, by + 100), 1.4, K)
    ink.line((bx + 233, by + 100), (bx + 320, by + 100), 1.4, K)
    ink.text('C2 .1u', bx + 230, by + 124, 10, K, 'mono')
    resistor(bx + 320, by + 100, bx + 320, by + 30)
    gnd(bx + 320, by + 24)
    ink.line((bx + 320, by + 100), (bx + 400, by + 100), 1.4, K)
    ink.circle(bx + 404, by + 100, 4, 1.4, K)
    ink.text('SWEEP OUT', bx + 404, by + 116, 10, K, 'mono')
    for (jx, jy) in ((bx + 60, by + 200), (bx + 150, by + 200), (bx + 150, by + 100), (bx + 320, by + 100)):
        ink.disc(jx, jy, 3.2, K)
    ink.circle(bx + 20, by + 60, 4, 1.4, K)
    ink.line((bx + 24, by + 60), (bx + 60, by + 60), 1.4, K)
    ink.line((bx + 60, by + 60), (bx + 60, by + 100), 1.4, K)
    ink.text('PROBE B', bx + 20, by + 44, 10, K, 'mono')
    ink.rect(x1 - 200, y0 + 12, x1 - 12, y0 + 60, 1.2, K)
    ink.text('SWEEP GEN  REV C', x1 - 106, y0 + 42, 11, K, 'monob')
    ink.text('SR-4 / 7', x1 - 106, y0 + 24, 10, K, 'mono')
    ink.rect(x0 + 6, y0 + 6, x1 - 6, y1 - 6, 1.2, K)

    # ---- the radar coverage chart
    x0, y0, x1, y1 = R('chart')
    Ww, Hh = x1 - x0, y1 - y0
    ground('chart', paper_ground(Hh, Ww, lin((226, 220, 196)), 240, 0.8, 6))
    cx_, cy_ = x0 + 200, y0 + 175
    for k in range(1, 5):
        ink.circle(cx_, cy_, 38 * k, 1.1 if k < 4 else 1.8, srgb(90, 60, 50))
        ink.text('%d' % k, cx_ + 38 * k - 6, cy_ + 6, 9, srgb(90, 60, 50), 'mono')
    for k in range(12):
        a = k * PI / 6
        ink.line((cx_ + math.cos(a) * 10, cy_ + math.sin(a) * 10), (cx_ + math.cos(a) * 158, cy_ + math.sin(a) * 158), 0.8, srgb(90, 60, 50))
        brg = (90 - k * 30) % 360
        ink.text('%03d' % brg, cx_ + math.cos(a) * 170, cy_ + math.sin(a) * 170, 9, srgb(90, 60, 50), 'mono')
    coast = wobble([(cx_ + math.cos(a / 30 * 2 * PI) * 70 * (1 + 0.25 * math.sin(a / 30 * 6 * PI)), cy_ + math.sin(a / 30 * 2 * PI) * 55) for a in range(31)], 8, 0.04, 9)
    ink.stroke(coast, 1.6, srgb(40, 60, 110), closed=True)
    ink.disc(cx_, cy_, 3, srgb(160, 20, 20))
    for (bx_, by_) in ((cx_ + 22, cy_ + 30), (cx_ - 110, cy_ - 80), (cx_ + 30, cy_ - 40)):
        ink.line((bx_ - 5, by_ - 5), (bx_ + 5, by_ + 5), 1.4, PENCIL)
        ink.line((bx_ - 5, by_ + 5), (bx_ + 5, by_ - 5), 1.4, PENCIL)
    ink.text('???', cx_ + 44, cy_ - 40, 14, PENCIL, 'hand')
    ink.text('SR-4 COVERAGE', x1 - 80, y1 - 26, 12, INKBLK, 'monob')
    ink.text('RANGE KM', x1 - 80, y1 - 44, 10, INKBLK, 'mono')

    # ---- the shift roster
    x0, y0, x1, y1 = R('roster')
    Ww, Hh = x1 - x0, y1 - y0
    ground('roster', paper_ground(Hh, Ww, lin((230, 226, 210)), 250, 0.7, 5))
    ink.text('SHIFT ROSTER', x0 + Ww / 2, y1 - 26, 15, INKBLK, 'monob')
    ink.text('SEPTEMBER', x0 + Ww / 2, y1 - 44, 11, INKBLK, 'mono')
    for i in range(11):
        ink.line((x0 + 14, y1 - 60 - i * 26), (x1 - 14, y1 - 60 - i * 26), 0.8, srgb(110, 130, 170))
    ink.line((x0 + 70, y1 - 60), (x0 + 70, y1 - 320), 0.8, srgb(170, 60, 60))
    for i in range(10):
        ink.text('%02d' % (9 + i), x0 + 42, y1 - 76 - i * 26, 11, INKBLK, 'mono')
        ink.scribble(x0 + 80, y1 - 72 - i * 26, x0 + 80 + 60 + (i * 37) % 80, 7, INKBLUE, 1.1, seed=260 + i)
    ink.line((x0 + 78, y1 - 154), (x1 - 30, y1 - 146), 1.4, srgb(160, 20, 20))

    # ---- the photo: the big tree and the tor, from the camera's test
    x0, y0, x1, y1 = R('photo')
    Ww, Hh = x1 - x0, y1 - y0
    yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32) + 0.5
    ph = np.clip(0.75 - 0.4 * (yy / Hh) ** 0.8, 0, 1)
    tor = (yy < 70 + 50 * np.exp(-((xx - 80) / 40) ** 2) + 10 * fbm(Hh, Ww, 6, 3, seed=270))
    ph = np.where(tor, 0.18 + 0.05 * fbm(Hh, Ww, 2, 3, seed=271), ph)
    trunk = (np.abs(xx - 200 - 6 * np.sin(yy / 30)) < 22 - yy * 0.03)
    ph = np.where(trunk, 0.08 + 0.03 * blob(Hh, Ww, 0.6, 6, seed=272), ph)
    ph = np.where(yy < 30, 0.12, ph)
    ph = ph * (1 + 0.08 * blob(Hh, Ww, 0.7, 0.7, seed=273))
    border = (np.minimum(np.minimum(xx, Ww - xx), np.minimum(yy, Hh - yy)) < 12)
    photo = np.where(border[:, :, None], np.array(lin((222, 218, 206)))[None, None, :], np.stack([ph, ph * 0.97, ph * 0.9], -1) * 0.8)
    ground('photo', photo)
    ink.text('cam07 test', x0 + 64, y0 + 6, 9, INKBLUE, 'hand', valign='BOTTOM_BASELINE')

    # ---- sticky notes
    for nm, txt, col_, sd in (('note', ['radar', '+2.1\u00b0'], INKBLUE, 280), ('note2', ['COFFEE', '!!'], srgb(150, 20, 20), 281)):
        x0, y0, x1, y1 = R(nm)
        Ww, Hh = x1 - x0, y1 - y0
        ground(nm, paper_ground(Hh, Ww, lin((236, 210, 82)), sd, 0.3, 3))
        for i, t in enumerate(txt):
            ink.text(t, x0 + Ww / 2, y1 - 42 - i * 36, 26, col_, 'hand', rot=-0.06)

    # ---- printouts: dot matrix on green bar, a typed memo, a plotted trace
    x0, y0, x1, y1 = R('print1')
    Ww, Hh = x1 - x0, y1 - y0
    pg = paper_ground(Hh, Ww, lin((230, 230, 222)), 290, 0.4, 4)
    yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32) + 0.5
    bar = ((yy // 24) % 2 == 0) & (xx > 22) & (xx < Ww - 22)
    pg = np.where(bar[:, :, None], pg * np.array([0.86, 0.95, 0.86], np.float32)[None, None, :], pg)
    for side in (11, Ww - 11):
        for k in range(int(Hh / 24) + 1):
            m = np.hypot(xx - side, yy - (k * 24 + 12)) < 4
            pg = np.where(m[:, :, None], pg * 0.35, pg)
    ground('print1', pg)
    lines_ = ['SWEEPD 212 LOG', '', 'T+0012 BRG 041 RNG 0.6 SM', 'T+0340 BRG 210 RNG 3.9 LG', 'T+0911 BRG 133 RNG 0.7 --',
              'DRIFT +2.1 DEG', 'GAIN 0.82', '', 'SCOPED 214', 'PROBE B NOISY', 'PROBE B NOISY', 'PROBE B NOISY', '', 'CAM07D 230 LINK UP']
    for i, t in enumerate(lines_):
        ink.text(t, x0 + 30, y1 - 30 - i * 21, 11.5, srgb(40, 40, 52), 'mono', align='LEFT')
    x0, y0, x1, y1 = R('print2')
    Ww, Hh = x1 - x0, y1 - y0
    ground('print2', paper_ground(Hh, Ww, lin((228, 224, 210)), 291, 0.8, 4, (('y', 0.33), ('y', 0.66))))
    ink.text('MEMO', x0 + 30, y1 - 34, 18, INKBLK, 'monob', align='LEFT')
    ink.text('TO: ALL SHIFTS', x0 + 30, y1 - 58, 10, INKBLK, 'mono', align='LEFT')
    ink.text('RE: THE LIFT', x0 + 30, y1 - 74, 10, INKBLK, 'mono', align='LEFT')
    for i in range(10):
        ink.scribble(x0 + 30, y1 - 104 - i * 18, x1 - 30 - (i * 23) % 70, 5, srgb(50, 50, 56), 1.4, seed=292 + i)
    ink.text('- maint.', x1 - 70, y0 + 40, 14, INKBLUE, 'hand')
    x0, y0, x1, y1 = R('print3')
    Ww, Hh = x1 - x0, y1 - y0
    ground('print3', paper_ground(Hh, Ww, lin((230, 228, 218)), 293, 0.5, 4))
    gx0, gy0, gx1, gy1 = x0 + 24, y0 + 60, x1 - 24, y0 + 260
    for i in range(11):
        ink.line((gx0 + i * (gx1 - gx0) / 10, gy0), (gx0 + i * (gx1 - gx0) / 10, gy1), 0.6, srgb(150, 170, 150))
    for i in range(9):
        ink.line((gx0, gy0 + i * (gy1 - gy0) / 8), (gx1, gy0 + i * (gy1 - gy0) / 8), 0.6, srgb(150, 170, 150))
    rr_ = random.Random(294)
    tr = [(gx0 + t * (gx1 - gx0) / 120, (gy0 + gy1) / 2 + 60 * math.sin(t / 7.0) * 0.7 + rr_.uniform(-14, 14)) for t in range(121)]
    ink.stroke(tr, 1.3, srgb(30, 40, 110))
    ink.text('PROBE B   1 ms/div', x0 + Ww / 2, y1 - 40, 11, INKBLK, 'mono')
    ink.text('noisy', gx1 - 40, gy1 + 14, 14, srgb(150, 20, 20), 'hand')

    # ---- the clock face
    x0, y0, x1, y1 = R('clock')
    Ww, Hh = x1 - x0, y1 - y0
    yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32) + 0.5
    rr = np.hypot(xx - Ww / 2, yy - Hh / 2) / (Ww / 2)
    face = lin((236, 232, 218))[None, None, :] * (1 - 0.15 * rr ** 3)[:, :, None] * (1 + 0.03 * fbm(Hh, Ww, 20, 3, seed=300))[:, :, None]
    ground('clock', face)
    cx_, cy_, R0 = x0 + Ww / 2, y0 + Hh / 2, Ww / 2
    for k in range(60):
        a = PI / 2 - k * 2 * PI / 60
        L = 0.12 if k % 5 == 0 else 0.05
        ink.line((cx_ + math.cos(a) * R0 * 0.92, cy_ + math.sin(a) * R0 * 0.92), (cx_ + math.cos(a) * R0 * (0.92 - L), cy_ + math.sin(a) * R0 * (0.92 - L)), 4.0 if k % 5 == 0 else 1.6, INKBLK)
    for k in range(1, 13):
        a = PI / 2 - k * 2 * PI / 12
        ink.text(str(k), cx_ + math.cos(a) * R0 * 0.66, cy_ + math.sin(a) * R0 * 0.66, 22, INKBLK, 'din')
    ink.text('MASTER', cx_, cy_ + R0 * 0.32, 11, srgb(60, 60, 60), 'din')

    # ---- the hazard sticker: a yellow triangle with its black border and a !, on a white backing
    x0, y0, x1, y1 = R('hazard')
    Ww, Hh = x1 - x0, y1 - y0
    ground('hazard', paper_ground(Hh, Ww, lin((232, 230, 222)), 310, 0.3, 4))
    tri = [(x0 + 20, y0 + 36), (x1 - 20, y0 + 36), (x0 + Ww / 2, y1 - 30)]
    ink.poly(tri, srgb(18, 18, 18), 0.002)
    cxt, cyt = sum(p[0] for p in tri) / 3, sum(p[1] for p in tri) / 3
    ink.poly([(cxt + (p[0] - cxt) * 0.8, cyt + (p[1] - cyt) * 0.8) for p in tri], srgb(232, 180, 20), 0.004)
    ink.box(x0 + Ww / 2 - 8, y0 + 100, x0 + Ww / 2 + 8, y0 + 168, srgb(18, 18, 18), 0.006)
    ink.disc(x0 + Ww / 2, y0 + 80, 9, srgb(18, 18, 18), 0.006)

    # ---- the radar's bearing ring (595 px/m: the decal is 2 (R + 0.05) across)
    x0, y0, x1, y1 = R('ring')
    Ww, Hh = x1 - x0, y1 - y0
    ground('ring', np.full((Hh, Ww, 3), srgb(34, 36, 34), np.float32) * (1 + 0.05 * fbm(Hh, Ww, 5, 3, seed=320))[:, :, None])
    cx_, cy_ = x0 + Ww / 2, y0 + Hh / 2
    sc_ = Ww / (2 * (RADAR_R + 0.05))
    r0_, r1_ = (RADAR_R + 0.008) * sc_, (RADAR_R + 0.022) * sc_
    for k in range(72):
        a = PI / 2 - k * 2 * PI / 72
        L = r1_ if k % 3 == 0 else r0_ + (r1_ - r0_) * 0.5
        ink.line((cx_ + math.cos(a) * r0_, cy_ + math.sin(a) * r0_), (cx_ + math.cos(a) * L, cy_ + math.sin(a) * L), 1.6 if k % 3 == 0 else 1.0, (0.85, 0.85, 0.8))
        if k % 9 == 0:
            ink.text('%d' % (k * 5), cx_ + math.cos(a) * (RADAR_R + 0.036) * sc_, cy_ + math.sin(a) * (RADAR_R + 0.036) * sc_, 9, (0.85, 0.85, 0.8), 'din', rot=a - PI / 2)

    # ---- meters and the receiver's dial
    for nm, unit, ang, sd in (('meter', 'VOLTS', 0.55, 330), ('meter2', 'mA', 1.2, 331)):
        x0, y0, x1, y1 = R(nm)
        Ww, Hh = x1 - x0, y1 - y0
        ground(nm, paper_ground(Hh, Ww, lin((226, 220, 200)), sd, 0.4, 3))
        cx_, cy_ = x0 + Ww / 2, y0 + 22
        for k in range(11):
            a = PI * 0.8 - k * PI * 0.6 / 10
            L = 0.75 if k % 5 == 0 else 0.84
            ink.line((cx_ + math.cos(a) * 88, cy_ + math.sin(a) * 88), (cx_ + math.cos(a) * 88 * L, cy_ + math.sin(a) * 88 * L), 1.6, INKBLK)
        ink.stroke([(cx_ + math.cos(PI * 0.8 - t * PI * 0.6 / 20) * 88, cy_ + math.sin(PI * 0.8 - t * PI * 0.6 / 20) * 88) for t in range(21)], 1.2, INKBLK)
        ink.stroke([(cx_ + math.cos(PI * 0.8 - t * PI * 0.12 / 6) * 80, cy_ + math.sin(PI * 0.8 - t * PI * 0.12 / 6) * 80) for t in range(7)], 3.0, srgb(160, 30, 20))
        ink.line((cx_, cy_), (cx_ + math.cos(ang) * 92, cy_ + math.sin(ang) * 92), 1.6, srgb(20, 20, 20), 0.01)
        ink.text(unit, cx_, cy_ + 34, 13, INKBLK, 'din')
    x0, y0, x1, y1 = R('dial')
    Ww, Hh = x1 - x0, y1 - y0
    ground('dial', np.full((Hh, Ww, 3), srgb(30, 26, 18), np.float32) * (1 + 0.06 * fbm(Hh, Ww, 8, 3, seed=340))[:, :, None])
    for k in range(31):
        xk = x0 + 18 + k * (Ww - 36) / 30
        ink.line((xk, y0 + 40), (xk, y0 + (62 if k % 5 == 0 else 52)), 1.2, srgb(220, 190, 120))
        if k % 5 == 0:
            ink.text(str(88 + k // 5 * 4), xk, y0 + 74, 12, srgb(220, 190, 120), 'din')
    ink.line((x0 + 150, y0 + 10), (x0 + 150, y1 - 8), 2.4, srgb(230, 80, 20), 0.01)
    ink.text('MW  SW  FM', x0 + Ww / 2, y0 + 20, 10, srgb(220, 190, 120), 'din')

    # ---- plates and labels
    styles = {
        'plate_green': (lin((34, 62, 44)), (0.9, 0.9, 0.86), 'din'), 'plate_white': (lin((226, 222, 208)), INKBLK, 'din'),
        'plate_black': (lin((22, 22, 22)), (0.78, 0.78, 0.74), 'din'), 'plate_red': (lin((150, 22, 16)), (0.92, 0.9, 0.86), 'din'),
        'danger': (lin((232, 182, 20)), INKBLK, 'sans'), 'nosmoke': (lin((232, 230, 222)), srgb(170, 20, 20), 'sans'),
        'stencil_black': (lin((200, 92, 30)), srgb(22, 22, 22), 'stencil'), 'card': (lin((232, 228, 214)), INKBLUE, 'hand'),
    }
    for name, (lines_, (wm, hm), ppm_, style) in LABELS.items():
        x0, y0, x1, y1 = R(name)
        Ww, Hh = x1 - x0, y1 - y0
        bgc, fg, kind = styles[style]
        if style in ('card', 'nosmoke'):
            ground(name, paper_ground(Hh, Ww, bgc, hash(name) % 997, 0.4, 3))
        else:
            ground(name, np.full((Hh, Ww, 3), bgc, np.float32) * (1 + 0.05 * fbm(Hh, Ww, 6, 3, seed=hash(name) % 991))[:, :, None])
        if style.startswith('plate') or style == 'danger':
            ink.rect(x0 + 4, y0 + 4, x1 - 4, y1 - 4, max(1.5, Hh * 0.04), fg if style != 'danger' else INKBLK)
            if Hh > 40 and Ww > 120:
                for (sx_, sy_) in ((x0 + 10, y0 + 10), (x1 - 10, y0 + 10), (x0 + 10, y1 - 10), (x1 - 10, y1 - 10)):
                    ink.disc(sx_, sy_, max(2.0, Hh * 0.035), (0.35, 0.35, 0.33), 0.004)
        if style == 'nosmoke':
            cx_, cy_, rr_ = x0 + Ww / 2, y0 + Hh * 0.6, Hh * 0.28
            ink.box(cx_ - rr_ * 0.6, cy_ - rr_ * 0.12, cx_ + rr_ * 0.5, cy_ + rr_ * 0.12, INKBLK, 0.002)
            ink.box(cx_ + rr_ * 0.5, cy_ - rr_ * 0.12, cx_ + rr_ * 0.62, cy_ + rr_ * 0.12, srgb(200, 80, 20), 0.002)
            ink.circle(cx_, cy_, rr_, rr_ * 0.18, fg, 0.004)
            ink.line((cx_ - rr_ * 0.7, cy_ + rr_ * 0.7), (cx_ + rr_ * 0.7, cy_ - rr_ * 0.7), rr_ * 0.18, fg, 0.005)
            ink.text('NO SMOKING', cx_, y0 + Hh * 0.14, Hh * 0.11, INKBLK, 'sans')
            continue
        n_ = len(lines_)
        if style == 'card' and n_ > 1:
            for i, t in enumerate(lines_):
                ink.text(t, x0 + 10, y1 - (i + 0.8) * Hh / (n_ + 0.3), Hh / (n_ + 1.2), fg, 'hand', align='LEFT')
            continue
        size = min(Hh * (0.62 if n_ == 1 else 0.75 / n_), Ww / max(1.0, max(len(t) for t in lines_) * 0.62))
        for i, t in enumerate(lines_):
            yl = y0 + Hh / 2 + (n_ - 1) * size * 0.6 - i * size * 1.2
            if name == 'stair' and t == '\u2191':
                ax_, ay_ = x0 + Ww / 2, yl
                ink.poly([(ax_ - size * 0.5, ay_ - size * 0.05), (ax_ + size * 0.5, ay_ - size * 0.05), (ax_, ay_ + size * 0.55)], fg, 0.01)
                ink.box(ax_ - size * 0.16, ay_ - size * 0.6, ax_ + size * 0.16, ay_, fg, 0.01)
                continue
            ink.text(t, x0 + Ww / 2, yl, size, fg if style != 'danger' or i else srgb(170, 20, 20), kind, rot=-0.03 if style == 'card' else 0.0)

    rgb, alpha = render_ink(ink, N)
    out = bg * (1 - alpha[:, :, None]) + rgb
    # Age it all a little: grime, and scratches through the plates. The unused space stays flat (it packs to nothing).
    out *= grime(N, N, 350, 0.12, 12)
    scr = scratches(N, N, 1400, 351, 4, 40, 0.5)
    out = out * (1 - 0.3 * scr[:, :, None]) + 0.3 * scr[:, :, None] * 0.6
    used = np.zeros((N, N), bool)
    for name in ATLAS_RECT:
        x0, y0, x1, y1 = R(name)
        used[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2] = True
    out = np.where(used[:, :, None], out, 0.2)
    write_png(path, enc_srgb(np.clip(out, 0, 1)))
    return round(time.time() - t0, 1)

# ============================================================================ lightmap UVs
def bake_targets():
    sc = _scene()
    return [ob for ob in sc.objects if ob.type == 'MESH' and ob.get('bake') and not ob.get('noexport')]

def lightmap_uvs(size):
    """Second UV set: smart-projected with the per-part texel densities (dens()), thin islands fattened, then packed."""
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    targets = bake_targets()
    saved = {}
    for ob in targets:
        me = ob.data
        me.uv_layers.active = me.uv_layers.get('lightmap') or me.uv_layers.new(name='lightmap')
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        saved[ob.name] = co.copy()
        co = co.reshape(-1, 3)
        key = ob.name[len(PREFIX):]
        for (k, v0, v1, f) in DENS:
            if k == key and v1 > v0:
                c = co[v0:v1]
                m = c.mean(axis=0)
                co[v0:v1] = m + (c - m) * f
        me.vertices.foreach_set('co', co.ravel())
        me.update()
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in targets)
        vl.objects.active = targets[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    for ob in targets:
        ob.data.vertices.foreach_set('co', saved[ob.name])
        ob.data.update()
    nfat = fatten_islands(targets, size)
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
    return targets, nfat

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
    """Stretch islands thinner than min_px texels: the baker only writes texels whose centres fall inside a triangle."""
    area = 0.0
    for ob in targets:
        uv = ob.data.uv_layers['lightmap'].data
        for poly in ob.data.polygons:
            pts = [uv[i].uv for i in poly.loop_indices]
            for j in range(1, len(pts) - 1):
                area += abs((pts[j] - pts[0]).cross(pts[j + 1] - pts[0])) / 2
    k = math.sqrt(fill / max(area, 1e-9))
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
            sx = min(40.0, m / max(w, 1e-9)) if w < m else 1.0
            sy = min(40.0, m / max(h, 1e-9)) if h < m else 1.0
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

# ============================================================================ materials for the bake and the previews
TEXMATS = {'wall': 'bunker_wall.png', 'concrete': 'bunker_concrete.png', 'steel': 'bunker_steel.png', 'orange': 'bunker_orange.png',
           'green': 'bunker_green.png', 'alu': 'bunker_alu.png', 'cctv': 'bunker_steel.png'}
SCREEN_RGB = (0.06, 0.16, 0.7)          # the screens' average glow in the panorama and previews (blue, not teal)

def build_materials(mode='bake', lm_img=None, gain=1.0, glow_gain=GLOW_GAIN, amb=(0.0, 0.0, 0.0), grey=False):
    """mode 'bake': diffuse albedo (texture x vertex colour) for the light bake's bounces. 'env' / 'preview': what the game
    draws, emitted: albedo x lightmap^3 x lm_scale x gain (+ amb), glow x glow_gain, screens blue; 'preview' also gives the
    floor its glossy reflection (rough map, room-space normals) so the polished concrete reads as it will in the game.
    grey: albedo 0.5 everywhere (to check the lightmap alone)."""
    imgs = {}
    def img(name, cs='sRGB'):
        k = (name, cs)
        if k not in imgs:
            im = bpy.data.images.load(MODELS + name, check_existing=False)
            im.colorspace_settings.name = cs
            imgs[k] = im
        return imgs[k]
    for key in ('wall', 'floor', 'concrete', 'steel', 'orange', 'green', 'alu', 'misc', 'decal', 'glow', 'screen', 'cctv', 'standin'):
        m = bpy.data.materials.get(PREFIX + key)
        if m is None:
            continue
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        col = node(nt, 'ShaderNodeAttribute', props={'attribute_name': 'Col'}).outputs['Color']
        uvn = node(nt, 'ShaderNodeUVMap', props={'uv_map': 'UVMap'}).outputs['UV']
        if key in TEXMATS:
            t = node(nt, 'ShaderNodeTexImage', props={'image': img(TEXMATS[key]), 'extension': 'REPEAT'}, Vector=uvn).outputs['Color']
            alb = _mix(nt, 1.0, t, col, 'MULTIPLY')
        elif key == 'floor':
            fm = FLOOR_MAP
            st = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY_ADD'}, i0=uvn, i1=(1 / fm['w'], 1 / fm['d'], 0.0),
                      i2=(-fm['x0'] / fm['w'], (fm['d'] - 1 + fm['z0']) / fm['d'], 0.0)).outputs[0]
            t = node(nt, 'ShaderNodeTexImage', props={'image': img('bunker_floor.png'), 'extension': 'EXTEND'}, Vector=st).outputs['Color']
            alb = _mix(nt, 1.0, t, col, 'MULTIPLY')
        elif key == 'decal':
            t = node(nt, 'ShaderNodeTexImage', props={'image': img('bunker_decal.png'), 'extension': 'EXTEND'}, Vector=uvn).outputs['Color']
            alb = _mix(nt, 1.0, t, col, 'MULTIPLY')
        elif key == 'standin':
            alb = _mix(nt, 1.0, col, (0.24, 0.23, 0.21), 'MULTIPLY')
        else:
            alb = col
        if grey and key not in ('glow', 'screen', 'cctv', 'standin'):
            alb = (0.5, 0.5, 0.5, 1.0)
        if mode == 'bake':
            if key in ('glow', 'screen', 'cctv'):
                sh = node(nt, 'ShaderNodeEmission', Color=alb, Strength=0.0).outputs[0]
            else:
                sh = node(nt, 'ShaderNodeBsdfDiffuse', Color=alb).outputs[0]
            nt.links.new(sh, o.inputs['Surface'])
            continue
        if key == 'glow':
            em = node(nt, 'ShaderNodeEmission', Color=alb, Strength=glow_gain).outputs[0]
        elif key == 'screen':
            wv = node(nt, 'ShaderNodeTexWave', props={'wave_type': 'BANDS', 'bands_direction': 'Y'}, Vector=uvn, Scale=60.0).outputs['Fac']
            k = math_node(nt, 'ADD', 0.35, math_node(nt, 'MULTIPLY', wv, 0.65))
            em = node(nt, 'ShaderNodeEmission', Color=(SCREEN_RGB[0], SCREEN_RGB[1], SCREEN_RGB[2], 1.0), Strength=k).outputs[0]
        elif key == 'cctv':
            em = node(nt, 'ShaderNodeEmission', Color=alb, Strength=0.0).outputs[0]
        elif key == 'standin':
            # Lit from above, roughly: treads brighter than risers and walls.
            up = node(nt, 'ShaderNodeSeparateXYZ', Vector=node(nt, 'ShaderNodeNewGeometry').outputs['Normal']).outputs['Z']
            k = math_node(nt, 'MULTIPLY', math_node(nt, 'ADD', 0.45, math_node(nt, 'MULTIPLY', up, 0.55)), STAND_L * gain)
            em = node(nt, 'ShaderNodeEmission', Color=alb, Strength=k).outputs[0]
        else:
            lmuv = node(nt, 'ShaderNodeUVMap', props={'uv_map': 'lightmap'}).outputs['UV']
            lt = node(nt, 'ShaderNodeTexImage', props={'image': lm_img, 'interpolation': 'Linear', 'extension': 'EXTEND'}, Vector=lmuv).outputs['Color']
            l3 = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=lt, i1=lt).outputs[0]
            l3 = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=l3, i1=lt).outputs[0]
            l3 = node(nt, 'ShaderNodeVectorMath', props={'operation': 'SCALE'}, i0=l3, Scale=gain).outputs[0]
            l3 = node(nt, 'ShaderNodeVectorMath', props={'operation': 'ADD'}, i0=l3, i1=amb).outputs[0]
            em = node(nt, 'ShaderNodeEmission', Color=_mix(nt, 1.0, alb, l3, 'MULTIPLY'), Strength=1.0).outputs[0]
            if key == 'floor' and mode == 'preview':
                fm = FLOOR_MAP
                st = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY_ADD'}, i0=uvn, i1=(1 / fm['w'], 1 / fm['d'], 0.0),
                          i2=(-fm['x0'] / fm['w'], (fm['d'] - 1 + fm['z0']) / fm['d'], 0.0)).outputs[0]
                rg = node(nt, 'ShaderNodeTexImage', props={'image': img('bunker_floor_rough.png', 'Non-Color'), 'extension': 'EXTEND'}, Vector=st).outputs['Color']
                rgf = node(nt, 'ShaderNodeSeparateColor', Color=rg).outputs[0]
                nm = node(nt, 'ShaderNodeTexImage', props={'image': img('bunker_floor_normal.png', 'Non-Color'), 'extension': 'EXTEND'}, Vector=st).outputs['Color']
                sep = node(nt, 'ShaderNodeSeparateColor', Color=nm)
                f2 = lambda s_: math_node(nt, 'SUBTRACT', math_node(nt, 'MULTIPLY', s_, 2.0), 1.0)
                nx_, nzr, ny_ = f2(sep.outputs[0]), f2(sep.outputs[1]), f2(sep.outputs[2])
                # The map is room space (r = x, g = z, b = up); Blender's is (x, -z, y).
                nb = node(nt, 'ShaderNodeCombineXYZ', X=nx_, Y=math_node(nt, 'MULTIPLY', nzr, -1.0), Z=ny_).outputs[0]
                nb = node(nt, 'ShaderNodeVectorMath', props={'operation': 'NORMALIZE'}, i0=nb).outputs[0]
                fr = node(nt, 'ShaderNodeFresnel', IOR=1.5, Normal=nb).outputs[0]
                k = math_node(nt, 'MULTIPLY', fr, math_node(nt, 'SUBTRACT', 1.15, rgf, clamp=True))
                gw = node(nt, 'ShaderNodeCombineColor', Red=k, Green=k, Blue=k).outputs[0]
                glc = node(nt, 'ShaderNodeBsdfGlossy', props={'distribution': 'GGX'}, Color=gw, Roughness=rgf, Normal=nb).outputs[0]
                em = node(nt, 'ShaderNodeAddShader', i0=em, i1=glc).outputs[0]
        nt.links.new(em, o.inputs['Surface'])

STAND_L = 0.012       # the stand-ins' light (the stair beyond the mouth, the lift's doors), in lightmap units / lm_scale

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

def simple_materials():
    for key in list(MATS.keys()):
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

# ============================================================================ the light bake
def hide_unbaked():
    """Hide what neither emits nor occludes in the bake: glow, screens, the cctv, the collider."""
    sc = _scene()
    hidden = []
    for ob in sc.objects:
        if ob.type != 'MESH' or ob.hide_render:
            continue
        mname = ob.data.materials[0].name[len(PREFIX):] if ob.data.materials else ''
        if mname in NO_BAKE or ob.name.startswith('COLLIDER') or ob.get('layer') == 'cctv':
            ob.hide_render = True
            hidden.append(ob)
    return hidden

def bake_light(targets, size, samples):
    """Full GI from the lamps (DIFFUSE direct + indirect, no albedo) into one float image; cube-root encoded PNG."""
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    hidden = hide_unbaked()
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
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.sample_clamp_indirect = 4.0
    sc.cycles.use_denoising = False
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
    write_png(MODELS + 'bunker_lm.png', enc)
    return scale, round(secs, 1), round(float((a.max(axis=2) > 1e-7).mean()), 3)

# ============================================================================ renders: the panorama and the previews
def _render_exr(sc, name='db_render'):
    path = os.path.join(bpy.app.tempdir, name + '.exr')
    bpy.ops.render.render(scene=sc.name)
    bpy.data.images['Render Result'].save_render(path, scene=sc)
    im = bpy.data.images.load(path)
    a = _np_image(im)[:, :, :3].copy()
    bpy.data.images.remove(im)
    try:
        os.remove(path)
    except OSError:
        pass
    return a

def _render_setup(sc, samples, bounces, size):
    _cycles(sc, samples)
    sc.cycles.max_bounces = bounces
    sc.cycles.diffuse_bounces = 0
    sc.cycles.glossy_bounces = bounces
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 0
    sc.cycles.sample_clamp_indirect = 0.0
    try:
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    if sc.world:
        bg = sc.world.node_tree.nodes.get('Background')
        if bg:
            bg.inputs['Strength'].default_value = 0.0
    hid = []
    for ob in sc.objects:
        if ob.type == 'MESH' and (ob.name.startswith('COLLIDER') or ob.get('layer') == 'cctv') and not ob.hide_render:
            ob.hide_render = True
            hid.append(ob)
    for ob in sc.objects:
        if ob.type == 'LIGHT':
            ob.hide_render = True
            hid.append(ob)
    return hid

def _camera(sc):
    cd = bpy.data.cameras.get('DB_prev') or bpy.data.cameras.new('DB_prev')
    cam = sc.objects.get('DB_prev') or bpy.data.objects.new('DB_prev', cd)
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam['noexport'] = 1
    sc.camera = cam
    return cam, cd

def render_env(lm_img, lm_scale, size, glow_gain, samples, write=True):
    """The room as the game draws it in lightmap units (gain 1; the glow at glow_gain), an equirect from ENV_POS:
    u = atan2(z, x) / 2pi + 0.5, the top row straight up."""
    sc = _scene()
    build_materials('env', lm_img, gain=lm_scale, glow_gain=glow_gain, amb=(0.0, 0.0, 0.0))
    hid = _render_setup(sc, samples, 0, size)
    cam, cd = _camera(sc)
    cd.type = 'PANO'
    cd.panorama_type = 'EQUIRECTANGULAR'
    cd.clip_start = 0.01
    cam.location = g2b(ENV_POS)
    cam.rotation_euler = g2b((1.0, 0.0, 0.0)).to_track_quat('-Z', 'Y').to_euler()
    a = _render_exr(sc, 'db_env')
    cd.type = 'PERSP'
    for ob in hid:
        ob.hide_render = False
    L = a.max(axis=2)
    med = float(np.median(L))
    scale = float(min(L.max(), max(np.percentile(L, 99.9), med * 400.0)))
    if write:
        write_png(MODELS + 'bunker_env.png', np.cbrt(np.clip(a / scale, 0, 1)))
    return scale, med, float(np.percentile(L, 90))

def aces(c, exposure):
    c = c * (exposure / 0.6)
    A = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]], np.float32)
    B = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]], np.float32)
    c = c @ A.T
    a = c * (c + 0.0245786) - 0.000090537
    b = c * (0.983729 * c + 0.4329510) + 0.238081
    c = (a / b) @ B.T
    return np.clip(c, 0, 1)

def preview_views():
    e = SEAT_EYE
    return [
        ('bunker_stair', (0.0, 1.78, -0.32), (0.05, 1.05, 3.6), 15.0, (1600, 900)),
        ('bunker_ref', (-0.55, 1.62, 3.38), (0.75, 0.85, 0.55), 13.0, (900, 1600)),
        ('bunker_seat', tuple(e), tuple(TERM), 28.0, (1600, 900)),
        ('bunker_radar', (1.35, 1.62, 0.85), (-2.3, 1.15, 2.2), 16.0, (1600, 900)),
        ('bunker_lift', (0.9, 1.66, 0.45), (-0.5, 1.15, 3.6), 16.0, (1600, 900)),
        ('bunker_floor', (0.2, 0.55, 0.1), (-0.3, 0.0, 3.0), 18.0, (1600, 900)),
    ]

def preview_all(lm_img, lm_scale, gain, outdir, grey=False, views=None, exposure=1.0, samples=None):
    """Render views with the game's shading (albedo x lightmap x gain, glow x gain, the floor's reflection, ACES)."""
    sc = _scene()
    build_materials('preview', lm_img, gain=lm_scale * gain, glow_gain=GLOW_GAIN, amb=(0.003, 0.0025, 0.002), grey=grey)
    cam, cd = _camera(sc)
    cd.type = 'PERSP'
    os.makedirs(outdir, exist_ok=True)
    paths = []
    for (name, eye, target, lens, size) in (views or preview_views()):
        hid = _render_setup(sc, samples or (24 if QUICK else 128), 2, size)
        e, t = g2b(eye), g2b(target)
        cam.location = e
        cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
        cd.lens = lens
        cd.sensor_fit = 'AUTO'
        cd.clip_start = 0.02
        a = _render_exr(sc, 'db_prev')
        for ob in hid:
            ob.hide_render = False
        out = os.path.join(outdir, name + ('_grey' if grey else '') + '.png')
        write_png(out, enc_srgb(aces(a, exposure)))
        paths.append(out)
    return paths

# ============================================================================ bake_all
def bake_all():
    t0 = time.time()
    out = {}
    os.makedirs(TMP, exist_ok=True)
    if not SKIPTEX or not os.path.exists(MODELS + 'bunker_floor.png'):
        tt = time.time()
        tex_wall()
        tex_concrete()
        tex_enamel('orange', srgb(222, 108, 32), 1.75, 400, srgb(226, 150, 96), 0.7, 40)
        tex_enamel('green', srgb(96, 110, 92), 1.8, 500, srgb(150, 158, 140), 0.6, 30)
        tex_steel()
        tex_alu()
        out['floor_s'] = tex_floor()
        out['atlas_s'] = paint_atlas(MODELS + 'bunker_decal.png')
        out['textures_s'] = round(time.time() - tt, 1)
    size = 1024 if QUICK else 2048
    tt = time.time()
    targets, nfat = lightmap_uvs(size)
    out['uv_s'] = round(time.time() - tt, 1)
    out['fattened'] = nfat
    build_materials('bake')
    scale, secs, cover = bake_light(targets, size, 64 if QUICK else 2000)
    out.update(lm_scale=scale, bake_s=secs, lm_cover=cover, lm_size=size)
    lm = bpy.data.images.load(MODELS + 'bunker_lm.png', check_existing=False)
    lm.colorspace_settings.name = 'Non-Color'
    tt = time.time()
    # The suggested gain: the room's median radiance (as a small panorama sees it) lands at ENV_TARGET. Then the panorama
    # proper, its glow at GLOW_GAIN / gain so that (stored x gain) is what the game draws.
    _s, med0, _p = render_env(lm, scale, (256, 128), GLOW_GAIN, 16, write=False)
    gain = ENV_TARGET / max(1e-9, med0)
    env_size = (512, 256) if QUICK else (1024, 512)
    env_scale, env_med, env_p90 = render_env(lm, scale, env_size, GLOW_GAIN / gain, 16 if QUICK else 128)
    out.update(env_scale=env_scale, env_median=round(env_med, 5), env_s=round(time.time() - tt, 1), gain=gain)
    meta = _scene().objects.get('META')
    if meta is not None:
        meta['lm_scale'] = scale
        meta['env_scale'] = env_scale
        meta['gain'] = gain
        meta['env_glow'] = GLOW_GAIN
        meta['glow_gain'] = GLOW_GAIN
    if not NOPREVIEW:
        tt = time.time()
        out['previews'] = preview_all(lm, scale, gain, PREVIEW_DIR)
        out['previews'] += preview_all(lm, scale, gain, PREVIEW_DIR, grey=True, views=preview_views()[:2], samples=32)
        out['preview_s'] = round(time.time() - tt, 1)
    simple_materials()
    out['seconds'] = round(time.time() - t0, 1)
    return out

ENV_TARGET = 0.045
