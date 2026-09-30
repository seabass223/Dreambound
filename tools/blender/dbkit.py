"""Dreambound Blender toolkit: procedural models built from Python, exported as GLB for the game.

Each asset has a small runner (build_cabin.py, build_observatory.py) that execs this file, calls
configure(...) and main(). A design file (cabin_design.py, observatory_design.py) defines build_all().

Everything is authored in GAME coordinates (+Y up) and converted to Blender's Z-up on output. Geometry
is gathered into one mesh per material, so the game draws a whole place in a few dozen draw calls.
Movable parts (doors, a rotating dome, gears) become empties at their pivot with per-material child
meshes. An ambient-occlusion atlas is baked with Cycles onto a second UV set.

Headless:   blender --background --factory-startup --python tools/blender/build_<asset>.py
Live (MCP): STAGE = 'build'   # or 'bake', 'export', 'all'
            exec(open(r'C:/repos/Dreambound/tools/blender/build_<asset>.py').read())
"""
import bpy, bmesh, math, random, os, time
from mathutils import Vector, Matrix

ROOT = r"C:/repos/Dreambound"
PI = math.pi
rng = random.Random(1987)

# Per-asset settings (see configure()).
PREFIX = 'cabin_'
OUT_GLB = ROOT + "/public/models/cabin.glb"
OUT_AO = ROOT + "/public/models/cabin_ao.png"
OUT_BLEND = ROOT + "/tools/blender/cabin.blend"
SCENE = "Dreambound_Cabin"
DESIGN = ROOT + "/tools/blender/cabin_design.py"
AO_SIZE = 2048
UV_METHOD = 'lightmap'
RESULT_TAG = 'CABIN_RESULT'

def configure(asset, prefix, scene, ao_size=2048, uv_method='lightmap'):
    """Point the toolkit at one asset: public/models/<asset>.glb, <asset>_ao.png, tools/blender/<asset>_design.py."""
    global PREFIX, OUT_GLB, OUT_AO, OUT_BLEND, SCENE, DESIGN, AO_SIZE, RESULT_TAG, UV_METHOD
    PREFIX = prefix
    OUT_GLB = ROOT + "/public/models/%s.glb" % asset
    OUT_AO = ROOT + "/public/models/%s_ao.png" % asset
    OUT_BLEND = ROOT + "/tools/blender/%s.blend" % asset
    DESIGN = ROOT + "/tools/blender/%s_design.py" % asset
    SCENE = scene
    AO_SIZE = ao_size
    UV_METHOD = uv_method
    RESULT_TAG = asset.upper() + '_RESULT'

# ============================================================================ coordinates
def g2b(p):
    """Game (x, y-up, z) -> Blender (x, y, z-up). A proper rotation, so winding is preserved."""
    return Vector((p[0], -p[2], p[1]))

def xf(x=0.0, y=0.0, z=0.0, ry=0.0, rx=0.0, rz=0.0, s=None):
    """Transform in game space; rotation order matches three.js 'YXZ'."""
    M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(rz, 4, 'Z')
    if s is not None:
        if isinstance(s, (int, float)):
            s = (s, s, s)
        M = M @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))
    return M

ORIGIN = Vector((0.0, 0.0, 0.0))   # added to everything emitted (house interior uses floor = 0)

def set_origin(x, y, z):
    ORIGIN.x, ORIGIN.y, ORIGIN.z = x, y, z

# ============================================================================ palette (linear RGB)
def srgb(r, g, b):
    f = lambda c: (c / 255.0) / 12.92 if c / 255.0 <= 0.04045 else ((c / 255.0 + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))

WHITE = (1.0, 1.0, 1.0)
OAK = srgb(214, 180, 140)
PINE = srgb(226, 190, 142)
TIMBER = srgb(150, 104, 66)
WALNUT = srgb(104, 68, 44)
CEDAR = srgb(170, 114, 78)
BLACK = srgb(26, 26, 27)
SOOT = srgb(12, 11, 10)
PLASTER = srgb(244, 238, 228)
SAGE = srgb(138, 154, 128)
CREAM = srgb(230, 220, 202)
LINEN = srgb(240, 235, 226)
RUST = srgb(172, 82, 46)
TERRA = srgb(196, 114, 80)
OLIVE = srgb(116, 114, 76)
CHAR = srgb(44, 43, 42)
COGNAC = srgb(156, 88, 46)
POT = srgb(184, 104, 70)
CERAMIC = srgb(238, 236, 230)
GREEN = srgb(66, 100, 50)
DKGREEN = srgb(42, 70, 36)
SAGELEAF = srgb(118, 134, 104)
SAND = srgb(212, 192, 160)
RATTAN = srgb(196, 160, 112)
STONE = WHITE
SOIL = srgb(46, 34, 26)
LAVENDER = srgb(128, 104, 170)
BARK = srgb(84, 62, 46)
ENDGRAIN = srgb(200, 164, 118)

def mul(c, k):
    return (c[0] * k, c[1] * k, c[2] * k)

# ============================================================================ materials
# name: (preview base color, roughness). The game swaps these for its own shaders by name.
MATS = {
    'wood_floor': (OAK, 0.5), 'wood': (TIMBER, 0.7), 'plaster': (PLASTER, 0.95), 'stone': ((0.46, 0.43, 0.39), 0.95),
    'metal_black': (BLACK, 0.45), 'glass': ((0.8, 0.9, 0.95), 0.05), 'brass': ((0.8, 0.6, 0.3), 0.3),
    'leather': (COGNAC, 0.45), 'fabric': (CREAM, 1.0), 'shade': (LINEN, 1.0), 'rug': (TERRA, 1.0),
    'jute': (SAND, 1.0), 'zellige': (CERAMIC, 0.25), 'hex_tile': (TERRA, 0.6), 'ceramic': (CERAMIC, 0.25),
    'marble': ((0.9, 0.9, 0.88), 0.25), 'leaf': (GREEN, 0.7), 'painted': (SAGE, 0.6), 'emissive': ((1.0, 0.8, 0.5), 1.0),
    'embers': ((1.0, 0.4, 0.1), 1.0), 'mirror': ((0.9, 0.9, 0.9), 0.02), 'dome_frame': (BLACK, 0.45),
    'dome_glass': ((0.8, 0.9, 0.95), 0.05), 'flagstone': ((0.5, 0.48, 0.45), 0.9), 'collider': ((1.0, 0.0, 1.0), 1.0),
}
NO_BAKE = {'glass', 'emissive', 'embers', 'dome_frame', 'dome_glass', 'shade', 'collider'}
# Surfaces that receive the baked AO atlas. Small props still cast occlusion onto these; they just don't
# need texels of their own.
BAKE_MATS = {'wood_floor', 'plaster', 'wood', 'stone', 'metal_black', 'zellige', 'hex_tile', 'rug', 'jute', 'marble', 'painted'}

def material(name):
    full = PREFIX + name
    m = bpy.data.materials.get(full)
    if m is None:
        m = bpy.data.materials.new(full)
        try:
            m.use_nodes = True
        except Exception:
            pass
    col, rough = MATS[name]
    p = m.node_tree.nodes.get('Principled BSDF') if m.node_tree else None
    if p:
        p.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1.0)
        p.inputs['Roughness'].default_value = rough
        if name in ('metal_black', 'brass', 'mirror', 'dome_frame'):
            p.inputs['Metallic'].default_value = 0.8
    m.diffuse_color = (col[0], col[1], col[2], 1.0)
    return m

# ============================================================================ geometry buckets
class Bucket:
    __slots__ = ('verts', 'faces', 'uvs', 'cols', 'smooth')

    def __init__(self):
        self.verts, self.faces, self.uvs, self.cols, self.smooth = [], [], [], [], []

BUCKETS = {}      # material -> Bucket (static geometry)
DOORS = {}        # movable part name -> {'hinge': pivot Vector, 'buckets': {mat: Bucket}, 'parent', 'props', 'bake'}
COLS = []         # collider boxes: (cx, cy, cz, w, h, d, ry)
EMPTIES = []      # (name, (x, y, z), props)
_target = [None]  # when set to a dict, emit() writes there instead of BUCKETS (door parts)
_layer = ['shell']  # visibility layer that emit() writes into (see layer())

def part(name, pivot, parent=None, axis=None, bake=True, **props):
    """Declare a movable part: an empty at `pivot` (game coords) whose child meshes the game can rotate.
    `parent` nests it under another part (e.g. the telescope tube inside the dome); `axis` (game coords,
    at rest) is stored for the game to spin it about. Emit geometry into it with `with into(name): ...`."""
    if axis is not None:
        props['axis'] = [float(axis[0]), float(axis[1]), float(axis[2])]
    DOORS[name] = {'hinge': Vector(pivot) + ORIGIN, 'buckets': {}, 'parent': parent, 'props': props, 'bake': bake}
    return name

class into:
    """Context manager: emit() writes into the named part instead of the static buckets."""
    def __init__(self, name):
        self.name = name
    def __enter__(self):
        self.prev = _target[0]
        _target[0] = DOORS[self.name]['buckets']
        return self
    def __exit__(self, *exc):
        _target[0] = self.prev

class layer:
    """Context manager: geometry emitted inside goes to a named visibility layer. The game draws the default
    'shell' (structure, silhouette) at any distance and culls the others with a dithered fade: 'in' (interiors)
    once you leave the area, 'near' (small exterior details) further out. Each (material, layer) becomes its
    own mesh, named '<material>@<layer>' with a 'layer' extra."""
    def __init__(self, name):
        self.name = name
    def __enter__(self):
        self.prev = _layer[0]
        _layer[0] = self.name
        return self
    def __exit__(self, *exc):
        _layer[0] = self.prev

def _bucket(mat):
    tb = BUCKETS if _target[0] is None else _target[0]
    key = mat if _layer[0] == 'shell' else mat + '@' + _layer[0]
    b = tb.get(key)
    if b is None:
        b = tb[key] = Bucket()
    return b

def _uv(p, n, tile, grain, fit):
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    if ax >= ay and ax >= az:
        a, b = 2, 1
    elif ay >= az:
        a, b = 0, 2
    else:
        a, b = 0, 1
    if grain is not None and grain == b:
        a, b = b, a
    if fit is not None:
        lo_a, hi_a = fit[a]
        lo_b, hi_b = fit[b]
        return ((p[a] - lo_a) / max(1e-6, hi_a - lo_a), (p[b] - lo_b) / max(1e-6, hi_b - lo_b))
    tu, tv = (tile, tile) if not isinstance(tile, tuple) else tile
    return (p[a] / tu, p[b] / tv)

def emit(bm, mat, M=None, tint=WHITE, tile=1.0, grain=None, fit=None, smooth=False, var=0.0, recalc=False, uvfn=None, uvofs=None, colfn=None, uvface=None):
    """Append a bmesh (game coords) to the material bucket. grain: 'auto' | 0 | 1 | 2 | None.
    uvfn(co, normal) -> (u, v) overrides the box projection; uvofs (du, dv) is added to every UV (the game
    uses integer UV offsets to tell screens, lamps and reels apart inside one mesh). colfn(co) -> (r, g, b)
    gives a per-vertex tint (weathering, height fades), multiplied by `tint`. smooth may be a function of
    the face normal (e.g. smooth curved walls, flat caps). uvface(face) -> [(u, v) per loop] authors a whole
    face's UVs at once (unwraps that need to know which vertex is which, via a bmesh layer)."""
    if M is not None:
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    if ORIGIN.length_squared > 0:
        bmesh.ops.translate(bm, vec=ORIGIN, verts=bm.verts)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    if grain == 'auto':
        lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
        for v in bm.verts:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i]); hi[i] = max(hi[i], v.co[i])
        ext = hi - lo
        grain = max(range(3), key=lambda i: ext[i])
    b = _bucket(mat)
    bm.verts.index_update()
    base = len(b.verts)
    b.verts.extend([v.co.copy() for v in bm.verts])
    k = 1.0 + (rng.uniform(-var, var) if var else 0.0)
    c = (tint[0] * k, tint[1] * k, tint[2] * k, 1.0)
    for f in bm.faces:
        b.faces.append([base + l.vert.index for l in f.loops])
        n = f.normal
        fuv = uvface(f) if uvface else None
        for li, l in enumerate(f.loops):
            uv = fuv[li] if fuv else uvfn(l.vert.co, n) if uvfn else _uv(l.vert.co, n, tile, grain, fit)
            if uvofs:
                uv = (uv[0] + uvofs[0], uv[1] + uvofs[1])
            b.uvs.append(uv)
            if colfn:
                cc = colfn(l.vert.co)
                b.cols.append((c[0] * cc[0], c[1] * cc[1], c[2] * cc[2], 1.0))
            else:
                b.cols.append(c)
        b.smooth.append(smooth(n) if callable(smooth) else smooth)
    bm.free()

def C(cx, cy, cz, w, h, d, ry=0.0):
    """Collider box (center, size, yaw) in game coords."""
    COLS.append((cx + ORIGIN.x, cy + ORIGIN.y, cz + ORIGIN.z, w, h, d, ry))

def empty(name, p, **props):
    EMPTIES.append((name, (p[0] + ORIGIN.x, p[1] + ORIGIN.y, p[2] + ORIGIN.z), props))

# ============================================================================ primitives (centered, game coords)
def bm_box(w, h, d, bevel=0.0, seg=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, h, d), verts=bm.verts)
    if bevel > 0:
        off = min(bevel, w * 0.45, h * 0.45, d * 0.45)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=off, offset_type='OFFSET', segments=seg,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm

def bm_cyl(rt, rb, h, segs=16, caps=True):
    bm = bmesh.new()
    top, bot = [], []
    for i in range(segs):
        a = 2 * PI * i / segs
        c, s = math.cos(a), math.sin(a)
        bot.append(bm.verts.new((c * rb, -h / 2, s * rb)))
        if rt > 1e-6:
            top.append(bm.verts.new((c * rt, h / 2, s * rt)))
    if rt > 1e-6:
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((bot[i], top[i], top[j], bot[j]))
        if caps:
            bm.faces.new([bm.verts.new(v.co) for v in reversed(top)])
    else:
        apex = bm.verts.new((0, h / 2, 0))
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((bot[i], apex, bot[j]))
    if caps and rb > 1e-6:
        bm.faces.new([bm.verts.new(v.co) for v in bot])
    return bm

def bm_sphere(r, u=12, v=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    return bm

def bm_torus(R, r, su=24, sv=8, arc=2 * PI):
    closed = arc >= 2 * PI - 1e-6
    bm = bmesh.new()
    nu = su if closed else su + 1
    rings = []
    for i in range(nu):
        u = arc * i / su
        cu, snu = math.cos(u), math.sin(u)
        ring = []
        for j in range(sv):
            vv = 2 * PI * j / sv
            rr = R + r * math.cos(vv)
            ring.append(bm.verts.new((cu * rr, r * math.sin(vv), snu * rr)))
        rings.append(ring)
    for i in range(su):
        a, b = rings[i], rings[(i + 1) % nu]
        for j in range(sv):
            k = (j + 1) % sv
            bm.faces.new((a[j], a[k], b[k], b[j]))
    return bm

def bm_lathe(profile, segs=24):
    bm = bmesh.new()
    rings = []
    for (r, y) in profile:
        rings.append([bm.verts.new((math.cos(2 * PI * i / segs) * r, y, math.sin(2 * PI * i / segs) * r)) for i in range(segs)])
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            try:
                bm.faces.new((a[i], b[i], b[j], a[j]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return bm

def bm_tube(points, r, sides=6, r_end=None):
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    n = len(pts)
    rings = []
    ref0 = Vector((0, 1, 0))
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
        if t.length < 1e-9:
            t = Vector((0, 0, 1))
        t.normalize()
        ref = ref0 if abs(t.dot(ref0)) < 0.95 else Vector((1, 0, 0))
        N = (ref - t * ref.dot(t)).normalized()
        B = t.cross(N)
        rr = r if r_end is None else r + (r_end - r) * i / max(1, n - 1)
        rings.append([bm.verts.new(p + (N * math.cos(2 * PI * j / sides) + B * math.sin(2 * PI * j / sides)) * rr) for j in range(sides)])
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            bm.faces.new((a[j], a[k], b[k], b[j]))
    return bm

def bm_prism(poly, w0, w1, plane):
    """Extrude a 2D polygon [(u, v)] between w0..w1.
    plane 'x': (u, v, w) = (x, y, z); 'z': (u, v, w) = (z, y, x); 'y' (horizontal): (u, v, w) = (x, z, y)."""
    if plane == 'x':
        mp = lambda u, v, w: (u, v, w)
    elif plane == 'z':
        mp = lambda u, v, w: (w, v, u)
    else:
        mp = lambda u, v, w: (u, w, v)
    bm = bmesh.new()
    fr = [bm.verts.new(mp(u, v, w0)) for (u, v) in poly]
    bk = [bm.verts.new(mp(u, v, w1)) for (u, v) in poly]
    bm.faces.new(fr)
    bm.faces.new(list(reversed(bk)))
    m = len(poly)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((fr[i], fr[j], bk[j], bk[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def bm_poly(points):
    """A single flat face from 3D points (game coords)."""
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in points])
    return bm

def bm_ring(r0, r1, y0, y1, segs=64, a0=0.0, a1=2 * PI):
    """Thick annulus (or arc of one) around +Y: inner radius r0, outer r1, from y0 to y1.
    Angles follow the placement convention used by the designs: a -> (sin a, -cos a), a = 0 at -Z."""
    bm = bmesh.new()
    full = abs(a1 - a0 - 2 * PI) < 1e-6
    n = segs if full else segs + 1
    P = lambda r, a, y: (math.sin(a) * r, y, -math.cos(a) * r)
    rings = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / segs
        rings.append([bm.verts.new(P(r0, a, y0)), bm.verts.new(P(r1, a, y0)), bm.verts.new(P(r1, a, y1)), bm.verts.new(P(r0, a, y1))])
    m = segs if full else segs
    for i in range(m):
        A, Bq = rings[i], rings[(i + 1) % n]
        for k in range(4):
            l = (k + 1) % 4
            bm.faces.new((A[k], A[l], Bq[l], Bq[k]))
    if not full:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def gear_profile(teeth, module, internal=False, a0=None, a1=None):
    """Tooth outline in the XY plane (gear axis = +Z), counter-clockwise, as [(x, y)].
    Pitch radius = module * teeth / 2. Flanks taper like an involute (wide root, narrow tip).
    internal=True puts the teeth on the inside of a ring. a0..a1 (radians) keeps only that arc."""
    r = module * teeth / 2.0
    if internal:
        ra, rf = r - module, r + 1.25 * module
    else:
        ra, rf = r + module, r - 1.25 * module
    half = PI / (2 * teeth)
    flank = [(rf, half * 1.3), ((rf + r) / 2, half * 1.13), (r, half), ((r + ra) / 2, half * 0.8), (ra, half * 0.55)]
    centers = [2 * PI * k / teeth for k in range(teeth)]
    if a0 is not None:
        centers = sorted(a0 + (c - a0) % (2 * PI) for c in centers)
        centers = [c for c in centers if c - half * 1.3 >= a0 - 1e-9 and c + half * 1.3 <= a1 + 1e-9]
    pts = []
    for c in centers:
        for (rad, h) in flank:
            pts.append((math.cos(c - h) * rad, math.sin(c - h) * rad))
        for (rad, h) in reversed(flank):
            pts.append((math.cos(c + h) * rad, math.sin(c + h) * rad))
    return pts

def bm_loop_ring(outer, inner, w, closed=True):
    """Solid between two loops in the XY plane with the same point count (outer CCW), extruded
    over z = -w/2 .. w/2. closed=False caps the two ends (an arc band, e.g. a sector gear)."""
    bm = bmesh.new()
    n = len(outer)
    of = [bm.verts.new((x, y, w / 2)) for (x, y) in outer]
    ob = [bm.verts.new((x, y, -w / 2)) for (x, y) in outer]
    inf = [bm.verts.new((x, y, w / 2)) for (x, y) in inner]
    inb = [bm.verts.new((x, y, -w / 2)) for (x, y) in inner]
    m = n if closed else n - 1
    for i in range(m):
        j = (i + 1) % n
        bm.faces.new((of[i], of[j], inf[j], inf[i]))
        bm.faces.new((ob[i], inb[i], inb[j], ob[j]))
        bm.faces.new((ob[i], ob[j], of[j], of[i]))
        bm.faces.new((inf[i], inf[j], inb[j], inb[i]))
    if not closed:
        bm.faces.new((of[0], inf[0], inb[0], ob[0]))
        bm.faces.new((of[-1], ob[-1], inb[-1], inf[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def bm_gear(teeth, module, width, bore, internal=False, outer_r=None):
    """Spur gear in the XY plane, axis +Z, centred on the origin. External gears are a toothed ring
    down to `bore` (use it as the rim radius for spoked gears); internal gears are a ring of radius
    outer_r with the teeth pointing in."""
    prof = gear_profile(teeth, module, internal)
    circ = lambda rad: [(math.cos(math.atan2(y, x)) * rad, math.sin(math.atan2(y, x)) * rad) for (x, y) in prof]
    if internal:
        return bm_loop_ring(circ(outer_r), prof, width)
    return bm_loop_ring(prof, circ(bore), width)

def bm_sector_gear(teeth, module, width, rim_in, a0, a1):
    """Toothed arc band (a sector of a spur gear) between angles a0..a1, axis +Z."""
    prof = gear_profile(teeth, module, False, a0, a1)
    inner = [(math.cos(math.atan2(y, x)) * rim_in, math.sin(math.atan2(y, x)) * rim_in) for (x, y) in prof]
    return bm_loop_ring(prof, inner, width, closed=False)

def bm_sweep(points, section, up=(0, 1, 0), closed=False, caps=True):
    """Sweep a 2D cross-section [(s, t)] along a polyline. s runs along side = tangent x up, t along
    the up direction (projected square to the tangent). `up` is a vector or a function of the point.
    Good for rails, arch ribs, cable trays and trim that follows a curve."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        if closed:
            t = pts[(i + 1) % n] - pts[(i - 1) % n]
        else:
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t.normalize()
        u = Vector(up(p) if callable(up) else up)
        sd = t.cross(u)
        if sd.length < 1e-6:
            sd = t.cross(Vector((1, 0, 0)))
        sd.normalize()
        nu = sd.cross(t).normalized()
        rings.append([bm.verts.new(p + sd * a + nu * b) for (a, b) in section])
    m = len(section)
    for i in range(n if closed else n - 1):
        A, Bq = rings[i], rings[(i + 1) % n]
        for k in range(m):
            l = (k + 1) % m
            bm.faces.new((A[k], A[l], Bq[l], Bq[k]))
    if caps and not closed:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def rect_section(w, h, t0=0.0):
    """Rectangle w (side) x h (up) for bm_sweep, starting t0 above the path."""
    return [(-w / 2, t0), (w / 2, t0), (w / 2, t0 + h), (-w / 2, t0 + h)]

def bm_leaf(length, width, n=4, fold=0.2, droop=0.0, tip=1.0):
    """Leaf along +x, blade in the xz plane (normal +y), slightly V-folded along the midrib."""
    bm = bmesh.new()
    mid, lft, rgt = [], [], []
    for i in range(n + 1):
        t = i / n
        x = t * length
        y = -droop * t * t * length
        w = width * 0.5 * (math.sin(PI * min(1.0, t * (1.0 + 0.15 * tip))) ** 0.8)
        mid.append(bm.verts.new((x, y + fold * w, 0)))
        if 0 < i < n:
            lft.append(bm.verts.new((x, y, -w)))
            rgt.append(bm.verts.new((x, y, w)))
    for side, sign in ((lft, 1), (rgt, -1)):
        for i in range(n):
            a, b = mid[i], mid[i + 1]
            if i == 0:
                f = (a, b, side[0]) if sign > 0 else (a, side[0], b)
            elif i == n - 1:
                f = (a, b, side[i - 1]) if sign > 0 else (a, side[i - 1], b)
            else:
                f = (a, b, side[i], side[i - 1]) if sign > 0 else (a, side[i - 1], side[i], b)
            bm.faces.new(f)
    return bm

def bm_blanket(w, d, hang=(0, 0, 0, 0), res=0.07, amp=0.012, seed=0):
    """A draped sheet: flat top w x d at y=0, hanging down by hang=(-x, +x, -z, +z)."""
    r2 = random.Random(seed)
    ph = [r2.uniform(0, 6.28) for _ in range(6)]
    x0, x1 = -w / 2 - hang[0], w / 2 + hang[1]
    z0, z1 = -d / 2 - hang[2], d / 2 + hang[3]
    nx = max(2, int((x1 - x0) / res)); nz = max(2, int((z1 - z0) / res))
    bm = bmesh.new()
    grid = []
    for i in range(nx + 1):
        row = []
        for j in range(nz + 1):
            x = x0 + (x1 - x0) * i / nx
            z = z0 + (z1 - z0) * j / nz
            ox = max(0.0, -w / 2 - x, x - w / 2)
            oz = max(0.0, -d / 2 - z, z - d / 2)
            o = max(ox, oz)
            px = max(-w / 2 - 0.02, min(w / 2 + 0.02, x)) if ox > 0 else x
            pz = max(-d / 2 - 0.02, min(d / 2 + 0.02, z)) if oz > 0 else z
            wav = math.sin(x * 9 + ph[0]) * 0.5 + math.sin(z * 7 + ph[1]) * 0.5 + math.sin((x + z) * 13 + ph[2]) * 0.3
            y = -o + amp * wav * (1.0 if o == 0 else 0.4)
            if o > 0:
                bulge = 0.012 * math.sin(o * 12 + ph[3] + x * 5 + z * 5)
                if ox >= oz:
                    px += math.copysign(bulge, x)
                else:
                    pz += math.copysign(bulge, z)
            row.append(bm.verts.new((px, y, pz)))
        grid.append(row)
    for i in range(nx):
        for j in range(nz):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    return bm

# ============================================================================ placement helpers
def B(mat, w, h, d, x, y, z, ry=0.0, rx=0.0, rz=0.0, tint=WHITE, bevel=0.0, seg=1, tile=1.0, grain='auto',
      smooth=False, var=0.0, col=False, fit=None):
    emit(bm_box(w, h, d, bevel, seg), mat, xf(x, y, z, ry, rx, rz), tint, tile, grain, fit, smooth, var)
    if col:
        C(x, y, z, w, h, d, ry)

def BOX(mat, x0, y0, z0, x1, y1, z1, **kw):
    B(mat, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, **kw)

def CYL(mat, rt, rb, h, x, y, z, segs=16, ry=0.0, rx=0.0, rz=0.0, tint=WHITE, caps=True, smooth=True, tile=1.0, grain=None, col=False):
    emit(bm_cyl(rt, rb, h, segs, caps), mat, xf(x, y, z, ry, rx, rz), tint, tile, grain, None, smooth)
    if col:
        C(x, y, z, max(rt, rb) * 2, h, max(rt, rb) * 2)

def SPH(mat, r, x, y, z, u=12, v=8, tint=WHITE, s=None, ry=0.0, rx=0.0, rz=0.0):
    emit(bm_sphere(r, u, v), mat, xf(x, y, z, ry, rx, rz, s), tint, 1.0, None, None, True)

def TUBE(mat, pts, r, sides=6, tint=WHITE, r_end=None):
    emit(bm_tube(pts, r, sides, r_end), mat, None, tint, 1.0, None, None, True)

def beam(mat, p0, p1, w, h, tint=WHITE, bevel=0.0, up=(0, 1, 0)):
    """Box from p0 to p1 (centers), cross-section w x h."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    L = d.length
    f = d.normalized()
    upv = Vector(up)
    if abs(f.dot(upv)) > 0.98:
        upv = Vector((1, 0, 0))
    xa = upv.cross(f).normalized()
    ya = f.cross(xa)
    R = Matrix(((xa.x, ya.x, f.x, 0), (xa.y, ya.y, f.y, 0), (xa.z, ya.z, f.z, 0), (0, 0, 0, 1)))
    M = Matrix.Translation((a + b) / 2) @ R
    emit(bm_box(w, h, L, bevel), mat, M, tint, 1.0, 'auto')

class G:
    """A local frame on the floor: position + yaw. Local +z is the object's front."""

    def __init__(self, x, y, z, ry=0.0):
        self.x, self.y, self.z, self.ry = x, y, z, ry
        self.c, self.s = math.cos(ry), math.sin(ry)

    def p(self, lx, ly, lz):
        return (self.x + lx * self.c + lz * self.s, self.y + ly, self.z - lx * self.s + lz * self.c)

    def put(self, bm, mat, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0, s=None, **kw):
        x, y, z = self.p(lx, ly, lz)
        emit(bm, mat, xf(x, y, z, self.ry + ry, rx, rz, s), **kw)

    def box(self, mat, w, h, d, lx, ly, lz, ry=0.0, rx=0.0, rz=0.0, tint=WHITE, bevel=0.0, seg=1, smooth=False, tile=1.0, grain='auto', col=False):
        x, y, z = self.p(lx, ly, lz)
        B(mat, w, h, d, x, y, z, self.ry + ry, rx, rz, tint, bevel, seg, tile, grain, smooth, col=col)

    def cyl(self, mat, rt, rb, h, lx, ly, lz, segs=16, rx=0.0, rz=0.0, ry=0.0, tint=WHITE, caps=True, smooth=True):
        x, y, z = self.p(lx, ly, lz)
        CYL(mat, rt, rb, h, x, y, z, segs, self.ry + ry, rx, rz, tint, caps, smooth)

    def col(self, w, h, d, lx, ly, lz):
        x, y, z = self.p(lx, ly, lz)
        C(x, y, z, w, h, d, self.ry)

# ============================================================================ walls
def wall_pieces(u0, u1, openings, top, breaks=()):
    """Polygons covering [u0,u1] x [bottom, top(u)] minus rectangular openings (ou0, ou1, ov0, ov1).
    top is a function of u; the bottom is -0.05 (just below the floor surface)."""
    base = -0.05
    xs = {u0, u1}
    for o in openings:
        xs.update((max(u0, min(u1, o[0])), max(u0, min(u1, o[1]))))
    for bk in breaks:
        if u0 < bk < u1:
            xs.add(bk)
    xs = sorted(xs)
    polys = []
    for i in range(len(xs) - 1):
        a, b = xs[i], xs[i + 1]
        if b - a < 1e-4:
            continue
        m = (a + b) / 2
        holes = sorted([(o[2], o[3]) for o in openings if o[0] - 1e-6 <= m <= o[1] + 1e-6])
        v = base
        for (h0, h1) in holes:
            if h0 > v + 1e-4:
                polys.append([(a, v), (b, v), (b, h0), (a, h0)])
            v = max(v, h1)
        ta, tb = top(a), top(b)
        if min(ta, tb) > v + 1e-4:
            polys.append([(a, v), (b, v), (b, tb), (a, ta)])
    return polys

def wall_layer(axis, w0, w1, u0, u1, openings, top, mat, tint, tile=1.0, grain=None, breaks=(), collide=False):
    for poly in wall_pieces(u0, u1, openings, top, breaks):
        emit(bm_prism(poly, min(w0, w1), max(w0, w1), axis), mat, None, tint, tile, grain)
        if collide:
            us = [p[0] for p in poly]; vs = [p[1] for p in poly]
            cu, cv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
            cw = (w0 + w1) / 2
            if axis == 'x':
                C(cu, cv, cw, max(us) - min(us), max(vs) - min(vs), abs(w1 - w0))
            else:
                C(cw, cv, cu, abs(w1 - w0), max(vs) - min(vs), max(us) - min(us))

def ubox(mat, axis, u0, u1, v0, v1, w0, w1, **kw):
    """Axis-aligned box in wall coordinates (u along the wall, v up, w through the wall)."""
    wa, wb = min(w0, w1), max(w0, w1)
    if axis == 'x':
        BOX(mat, u0, v0, wa, u1, v1, wb, **kw)
    else:
        BOX(mat, wa, v0, u0, wb, v1, u1, **kw)

def window(axis, wg, inward, u0, u1, v0, v1, cols=2, rows=1, sill_w=None, inner_face=None, top_fn=None):
    """Black steel window set in a wall. wg = glass plane (w coordinate). inward = +1/-1 toward the room."""
    e = 0.02
    fw, fd = 0.055, 0.11                                    # perimeter frame face width / depth
    ubox('metal_black', axis, u0 - e, u0 + fw, v0 - e, v1 + e, wg - fd / 2, wg + fd / 2)
    ubox('metal_black', axis, u1 - fw, u1 + e, v0 - e, v1 + e, wg - fd / 2, wg + fd / 2)
    ubox('metal_black', axis, u0 + fw, u1 - fw, v0 - e, v0 + fw, wg - fd / 2, wg + fd / 2)
    ubox('metal_black', axis, u0 + fw, u1 - fw, v1 - fw, v1 + e, wg - fd / 2, wg + fd / 2)
    md = 0.07
    for i in range(1, cols):
        u = u0 + (u1 - u0) * i / cols
        ubox('metal_black', axis, u - 0.018, u + 0.018, v0 + fw, v1 - fw, wg - md / 2, wg + md / 2)
    for j in range(1, rows):
        v = v0 + (v1 - v0) * j / rows
        ubox('metal_black', axis, u0 + fw, u1 - fw, v - 0.016, v + 0.016, wg - md / 2 + 0.004, wg + md / 2 - 0.004)
    pts = [(u0 + fw, v0 + fw), (u1 - fw, v0 + fw), (u1 - fw, v1 - fw), (u0 + fw, v1 - fw)]
    P = [(u, v, wg) if axis == 'x' else (wg, v, u) for (u, v) in pts]
    emit(bm_poly(P), 'glass')
    # Deep interior sill in walnut, and a slim black exterior sill.
    if inner_face is not None and v0 > 0.3:
        ubox('wood', axis, u0 - 0.05, u1 + 0.05, v0 - 0.04, v0 - e, inner_face - inward * 0.02, inner_face + inward * 0.07, tint=WALNUT)

# ============================================================================ output
def _mesh_from_bucket(name, b, offset=None):
    me = bpy.data.meshes.new('DB_' + name)
    verts = [tuple(g2b(v - offset if offset is not None else v)) for v in b.verts]
    me.from_pydata(verts, [], b.faces)
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', [c for p in b.uvs for c in p])
    ca = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    ca.data.foreach_set('color', [c for col in b.cols for c in col])
    me.color_attributes.active_color = ca
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass
    me.polygons.foreach_set('use_smooth', b.smooth)
    me.update()
    return me

def _collider_mesh():
    verts, faces = [], []
    for (cx, cy, cz, w, h, d, ry) in COLS:
        base = len(verts)
        c, s = math.cos(ry), math.sin(ry)
        for (sx, sy, sz) in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
            lx, ly, lz = sx * w / 2, sy * h / 2, sz * d / 2
            verts.append(tuple(g2b((cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c))))
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)):
            faces.append([base + i for i in f])
    me = bpy.data.meshes.new('DB_collider')
    me.from_pydata(verts, [], faces)
    me.update()
    return me

def _scene():
    sc = bpy.data.scenes.get(SCENE)
    if sc is None:
        if bpy.app.background:
            # Headless: reuse the startup scene so operator context and our objects agree.
            sc = bpy.context.scene
            sc.name = SCENE
        else:
            sc = bpy.data.scenes.new(SCENE)
    return sc

def _clear_scene(sc):
    for ob in list(sc.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.name.startswith('DB_') and me.users == 0:
            bpy.data.meshes.remove(me)

def weld_tjunctions(ob, eps=1e-4, sharp_deg=30.0):
    """Join an object's separately built faces into one connected surface: merge coincident vertices, then split every
    edge at any vertex lying along it (a T-junction, where one wall strip's corner meets the middle of its neighbour's
    edge) and merge again. A flat wall built from strips then comes out of the lightmap unwrap as a single island, so
    its baked AO has no seams between the strips. Edges between faces more than sharp_deg apart are marked sharp, so
    welding never smooths shading across a corner. Corner data (UVs, colours) carries over."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=eps)
    for _ in range(8):
        cell = 0.5
        grid = {}
        for v in bm.verts:
            grid.setdefault((int(v.co.x // cell), int(v.co.y // cell), int(v.co.z // cell)), []).append(v)
        splits = {}
        for e in bm.edges:
            a, b = e.verts[0].co, e.verts[1].co
            d = b - a
            L = d.length
            if L < 4 * eps:
                continue
            lo = [min(a[i], b[i]) - eps for i in range(3)]
            hi = [max(a[i], b[i]) + eps for i in range(3)]
            best = None
            for gx in range(int(lo[0] // cell), int(hi[0] // cell) + 1):
                for gy in range(int(lo[1] // cell), int(hi[1] // cell) + 1):
                    for gz in range(int(lo[2] // cell), int(hi[2] // cell) + 1):
                        for v in grid.get((gx, gy, gz), ()):
                            if v in e.verts:
                                continue
                            t = (v.co - a).dot(d) / (L * L)
                            if t * L < 2 * eps or (1 - t) * L < 2 * eps:
                                continue
                            if (a + d * t - v.co).length < eps and (best is None or t < best[0]):
                                best = (t, v)
            if best:
                splits[e] = best
        if not splits:
            break
        for e, (t, v) in splits.items():
            if not e.is_valid:
                continue
            ne, nv = bmesh.utils.edge_split(e, e.verts[0], t)
            nv.co = v.co.copy()
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=eps)
    cos_sharp = math.cos(math.radians(sharp_deg))
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.link_faces[0].normal.dot(e.link_faces[1].normal) < cos_sharp:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def realize():
    """Turn the gathered buckets into Blender objects in the asset scene."""
    sc = _scene()
    _clear_scene(sc)
    link = sc.collection.objects.link
    stats = {}
    for key, b in BUCKETS.items():
        if not b.faces:
            continue
        mat, _, lay = key.partition('@')
        me = _mesh_from_bucket(key, b)
        me.materials.append(material(mat))
        ob = bpy.data.objects.new(PREFIX + key, me)
        ob['bake'] = 1 if mat in BAKE_MATS else 0
        if lay:
            ob['layer'] = lay
        link(ob)
        stats[key] = len(b.faces)
    roots = {}
    for dname, dd in DOORS.items():   # parents are declared before their children
        hinge = dd['hinge']
        root = bpy.data.objects.new(dname, None)
        root.empty_display_type = 'ARROWS'
        root.empty_display_size = 0.3
        par = dd.get('parent')
        if par:
            root.parent = roots[par]
            root.location = g2b(hinge - DOORS[par]['hinge'])
        else:
            root.location = g2b(hinge)
        for k, v in dd.get('props', {}).items():
            root[k] = v
        link(root)
        roots[dname] = root
        for key, b in dd['buckets'].items():
            if not b.faces:
                continue
            mat, _, lay = key.partition('@')
            me = _mesh_from_bucket(dname + '_' + key, b, offset=Vector(hinge))
            me.materials.append(material(mat))
            ob = bpy.data.objects.new(dname + '_' + key, me)
            ob.parent = root
            ob['bake'] = 1 if (mat in BAKE_MATS and dd.get('bake', True)) else 0
            if lay:
                ob['layer'] = lay
            link(ob)
            stats[key] = stats.get(key, 0) + len(b.faces)
    cme = _collider_mesh()
    cme.materials.append(material('collider'))
    cob = bpy.data.objects.new('COLLIDER', cme)
    cob.display_type = 'WIRE'
    cob.hide_render = True
    cob['bake'] = 0
    link(cob)
    for (name, p, props) in EMPTIES:
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'PLAIN_AXES'
        e.empty_display_size = 0.25
        e.location = g2b(p)
        for k, v in props.items():
            e[k] = v
        link(e)
    return stats

def _ctx():
    """(window, area, region) when running with a UI; (None, None, None) in background mode."""
    wm = bpy.context.window_manager
    if bpy.app.background or wm is None or not wm.windows:
        return None, None, None
    win = wm.windows[0]
    area = next((a for a in win.screen.areas if a.type == 'VIEW_3D'), None)
    region = next((r for r in area.regions if r.type == 'WINDOW'), None) if area else None
    return win, area, region

def _override(sc):
    win, area, region = _ctx()
    kw = dict(scene=sc, view_layer=sc.view_layers[0])
    if win and area:
        win.scene = sc
        kw.update(window=win, area=area, region=region, view_layer=win.view_layer)
    return kw

def show_scene():
    win, area, region = _ctx()
    if not win:
        return
    win.scene = _scene()
    sp = area.spaces.active
    sp.shading.type = 'SOLID'
    sp.shading.color_type = 'VERTEX'
    sp.shading.light = 'STUDIO'
    sp.shading.show_cavity = True
    sp.shading.show_shadows = True
    sp.clip_end = 400
    sp.overlay.show_extras = False

def look(target, yaw_deg, pitch_deg, dist, lens=None):
    """Aim the 3D viewport. target in game coords."""
    win, area, region = _ctx()
    r3 = area.spaces.active.region_3d
    r3.view_perspective = 'PERSP'
    r3.view_location = g2b(target)
    from mathutils import Euler
    r3.view_rotation = Euler((math.radians(90 - pitch_deg), 0, math.radians(yaw_deg)), 'XYZ').to_quaternion()
    r3.view_distance = dist
    if lens:
        area.spaces.active.lens = lens

# ============================================================================ bake + export
def bake_ao(size=None, samples=96, distance=1.1):
    size = size or AO_SIZE
    t0 = time.time()
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    for ob in sc.objects:
        if ob.type == 'MESH' and ob.data.materials and ob.parent is None:
            ob['bake'] = 1 if ob.data.materials[0].name[len(PREFIX):] in BAKE_MATS else 0
    targets = [ob for ob in sc.objects if ob.type == 'MESH' and ob.get('bake')]
    # Glass, lights and see-through shells shouldn't occlude; everything else still casts AO.
    hidden = []
    for ob in sc.objects:
        if ob.type != 'MESH' or ob.hide_render:
            continue
        mname = ob.data.materials[0].name[len(PREFIX):] if ob.data.materials else ''
        if mname in NO_BAKE:
            ob.hide_render = True
            hidden.append(ob)
    # Occluding ground under everything (kept but never exported: deleting objects mid-run upset the depsgraph).
    ground = sc.objects.get('BAKE_ground')
    if ground is None:
        gme = bpy.data.meshes.new('DB_bake_ground')
        s = 40.0
        gme.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        ground = bpy.data.objects.new('BAKE_ground', gme)
        ground['noexport'] = 1
        sc.collection.objects.link(ground)
    ground.hide_render = False
    for ob in sc.objects:
        if ob.type == 'MESH' and not ob.get('bake') and ob.data.uv_layers.get('lightmap'):
            ob.data.uv_layers.remove(ob.data.uv_layers['lightmap'])
    for ob in targets:
        me = ob.data
        lm = me.uv_layers.get('lightmap') or me.uv_layers.new(name='lightmap')
        me.uv_layers.active = lm
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in targets)
        vl.objects.active = targets[0]
        if UV_METHOD == 'smart':
            # Islands of connected, similarly facing faces, all objects packed into one atlas. Better for
            # models with many cut or sliver faces than per-face charts.
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0,
                                     correct_aspect=True, scale_to_bounds=False)
            bpy.ops.object.mode_set(mode='OBJECT')
        else:
            # One shared atlas for every target (per-face charts sized by area).
            bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False,
                                     PREF_BOX_DIV=48, PREF_MARGIN_DIV=0.06)
    t_uv = time.time() - t0
    img = bpy.data.images.get(PREFIX + 'ao')
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(PREFIX + 'ao', size, size, alpha=False, float_buffer=False)
    mats = set()
    for ob in targets:
        for slot in ob.material_slots:
            if slot.material:
                mats.add(slot.material)
    nodes_added = []
    for m in mats:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.name = 'AO_BAKE'
        m.node_tree.nodes.active = n
        n.select = True
        nodes_added.append((m, n))
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prev_dev = prefs.compute_device_type
    try:
        prefs.compute_device_type = 'OPTIX'
        prefs.refresh_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
    except Exception:
        pass
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new('DB_world')
    sc.world.light_settings.distance = distance
    sc.render.bake.margin = 8
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob in targets)
        vl.objects.active = targets[0]
        bpy.ops.object.bake(type='AO', margin=8, use_clear=True, target='IMAGE_TEXTURES')
    t_bake = time.time() - t0 - t_uv
    # Soften sampling noise with a small blur (islands have an 8px margin).
    try:
        import numpy as np
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        a = px.reshape(size, size, 4)[:, :, 0]
        k = np.array([1, 4, 6, 4, 1], dtype=np.float32); k /= k.sum()
        pad = np.pad(a, 2, mode='edge')
        h = sum(pad[:, i:i + size] * k[i] for i in range(5))
        v = sum(h[i:i + size, :] * k[i] for i in range(5))
        v = np.clip(v, 0, 1)
        out = np.stack([v, v, v, np.ones_like(v)], axis=-1).ravel()
        img.pixels.foreach_set(out)
    except Exception as ex:
        print('AO blur skipped:', ex)
    img.filepath_raw = OUT_AO
    img.file_format = 'PNG'
    img.save()
    for (m, n) in nodes_added:
        m.node_tree.nodes.remove(n)
    for ob in targets:
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
        ob.data.uv_layers['UVMap'].active_render = True
    for ob in hidden:
        ob.hide_render = False
    ground.hide_render = True
    ground.hide_viewport = True
    if not bpy.app.background:
        try:
            prefs.compute_device_type = prev_dev
        except Exception:
            pass
    return {'targets': len(targets), 'uv_s': round(t_uv, 1), 'bake_s': round(t_bake, 1), 'file': OUT_AO}

def export_glb():
    sc = _scene()
    kw = _override(sc)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(not ob.get('noexport'))
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, use_active_scene=True, export_extras=True,
                                  export_yup=True, export_apply=False, export_texcoords=True, export_normals=True,
                                  export_tangents=False, export_materials='EXPORT', export_vertex_color='ACTIVE',
                                  export_all_vertex_colors=False, export_cameras=False, export_lights=False,
                                  export_image_format='NONE')
    try:
        bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=not bpy.app.background)
    except Exception as ex:
        print('blend save skipped:', ex)
    return {'glb': OUT_GLB, 'bytes': os.path.getsize(OUT_GLB)}

# ============================================================================ multi-channel lightmaps
def _cycles(sc, samples):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'OPTIX'
        prefs.refresh_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
    except Exception:
        pass
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.render.bake.margin = 8

def _np_image(img):
    import numpy as np
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)

def _blur(a, taps=(1, 4, 6, 4, 1)):
    import numpy as np
    k = np.array(taps, dtype=np.float32); k /= k.sum()
    r = len(k) // 2
    n = a.shape[0]
    pad = np.pad(a, r, mode='edge')
    h = sum(pad[:, i:i + n] * k[i] for i in range(len(k)))
    return sum(h[i:i + n, :] * k[i] for i in range(len(k)))

def save_png(path, rgb, colorspace='Non-Color'):
    """Write an HxWx3 float array (0..1) to a PNG."""
    import numpy as np
    h, w = rgb.shape[:2]
    name = 'DB_out_' + os.path.basename(path)
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    out = np.ones((h, w, 4), dtype=np.float32)
    out[:, :, :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)

def bake_lightmaps(channels, out_paths, size=2048, samples=192, ao_distance=1.0, ao_samples=64, authored=(), blur=(1, 4, 6, 4, 1)):
    """Bake lighting (no albedo) into a shared atlas on the 'lightmap' UV set, one channel per light group, so the
    game can switch groups on and off. channels: [(name, [light objects] | 'AO')]. Channels are packed three per
    PNG (out_paths), each light channel normalised to its 99th percentile and sqrt-encoded; AO stays linear.
    authored: materials whose own UVs (in metres, one island per unwrapped piece) are already a good lightmap
    layout; everything else is smart-projected. All islands are then scaled to one texel density and packed.
    Returns {name: scale}: the linear light value that a stored 1.0 decodes to."""
    import numpy as np
    t0 = time.time()
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    targets = [ob for ob in sc.objects if ob.type == 'MESH' and ob.get('bake')]
    hidden = []
    for ob in sc.objects:
        if ob.type != 'MESH' or ob.hide_render:
            continue
        mname = ob.data.materials[0].name[len(PREFIX):] if ob.data.materials else ''
        if mname in NO_BAKE:
            ob.hide_render = True
            hidden.append(ob)
    for ob in sc.objects:
        if ob.type == 'MESH' and not ob.get('bake') and ob.data.uv_layers.get('lightmap'):
            ob.data.uv_layers.remove(ob.data.uv_layers['lightmap'])
    import numpy as np
    mat_of = lambda ob: ob.data.materials[0].name[len(PREFIX):] if ob.data.materials else ''
    own = [ob for ob in targets if ob.parent is None and mat_of(ob) in authored]   # static geometry only
    for ob in targets:
        me = ob.data
        me.uv_layers.active = me.uv_layers.get('lightmap') or me.uv_layers.new(name='lightmap')
        if ob in own:
            buf = np.empty(len(me.loops) * 2, dtype=np.float32)
            me.uv_layers['UVMap'].data.foreach_get('uv', buf)
            me.uv_layers['lightmap'].data.foreach_set('uv', buf)
    rest = [ob for ob in targets if ob not in own]

    def uv_area(obs):
        a = 0.0
        for ob in obs:
            uv = ob.data.uv_layers['lightmap'].data
            for poly in ob.data.polygons:
                pts = [uv[i].uv for i in poly.loop_indices]
                for k in range(1, len(pts) - 1):
                    a += abs((pts[k] - pts[0]).cross(pts[k + 1] - pts[0])) / 2
        return a
    with bpy.context.temp_override(**kw):
        if rest:
            for ob in sc.objects:
                ob.select_set(ob in rest)
            vl.objects.active = rest[0]
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.002, area_weight=0.0,
                                     correct_aspect=True, scale_to_bounds=False)
            bpy.ops.object.mode_set(mode='OBJECT')
            # Smart project works at one scale for everything it packs; bring the authored (metre) UVs to it.
            s = math.sqrt(uv_area(rest) / max(1e-9, sum(p.area for ob in rest for p in ob.data.polygons)))
            for ob in own:
                me = ob.data
                buf = np.empty(len(me.loops) * 2, dtype=np.float32)
                me.uv_layers['lightmap'].data.foreach_get('uv', buf)
                me.uv_layers['lightmap'].data.foreach_set('uv', buf * s)
        for ob in sc.objects:
            ob.select_set(ob in targets)
        vl.objects.active = targets[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', margin_method='FRACTION', margin=0.001,
                                shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')
    fill = uv_area(targets)
    t_uv = time.time() - t0
    img = bpy.data.images.get('DB_lightbake')
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new('DB_lightbake', size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    mats = {slot.material for ob in targets for slot in ob.material_slots if slot.material}
    added = []
    for m in mats:
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
        bg.inputs['Strength'].default_value = 0.0     # underground: no sky
    lights = [ob for ob in sc.objects if ob.type == 'LIGHT']
    data, scales, times = {}, {}, {}
    for name, group in channels:
        t1 = time.time()
        with bpy.context.temp_override(**kw):
            for ob in sc.objects:
                ob.select_set(ob in targets)
            vl.objects.active = targets[0]
            if group == 'AO':
                _cycles(sc, ao_samples)
                sc.world.light_settings.distance = ao_distance
                bpy.ops.object.bake(type='AO', margin=8, use_clear=True, target='IMAGE_TEXTURES')
            else:
                _cycles(sc, samples)
                for L in lights:
                    L.hide_render = L not in group
                bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=8, use_clear=True,
                                    target='IMAGE_TEXTURES')
        a = _np_image(img)[:, :, :3].mean(axis=2)
        a = _blur(a, blur)
        if group == 'AO':
            data[name] = np.clip(a, 0, 1)
        else:
            lit = a[a > 1e-5]
            scale = float(np.percentile(lit, 99.0)) if lit.size else 1.0
            scales[name] = scale
            data[name] = np.sqrt(np.clip(a / scale, 0, 1))
        times[name] = round(time.time() - t1, 1)
    for L in lights:
        L.hide_render = False
    names = [n for n, _ in channels]
    for i, path in enumerate(out_paths):
        chans = [data[n] if n else np.zeros((size, size), np.float32) for n in (names[i * 3:i * 3 + 3] + [None, None, None])[:3]]
        save_png(path, np.stack(chans, axis=-1))
    for (m, n) in added:
        m.node_tree.nodes.remove(n)
    for ob in targets:
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
        ob.data.uv_layers['UVMap'].active_render = True
    for ob in hidden:
        ob.hide_render = False
    return {'targets': len(targets), 'uv_s': round(t_uv, 1), 'uv_fill': round(fill, 3), 'bake_s': times, 'scales': scales}

# ============================================================================ tileable procedural textures
def tile_coords(nt):
    """Seamless 4D coordinates for a UV square: (cos 2pi u, sin 2pi u, cos 2pi v) and W = sin 2pi v. Feed them to
    4D Noise / Voronoi nodes and the result tiles perfectly in both directions."""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs[0])
    def trig(src, fn):
        a = nt.nodes.new('ShaderNodeMath'); a.operation = 'MULTIPLY'; a.inputs[1].default_value = 2 * PI
        nt.links.new(src, a.inputs[0])
        b = nt.nodes.new('ShaderNodeMath'); b.operation = fn
        nt.links.new(a.outputs[0], b.inputs[0])
        return b.outputs[0]
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(trig(sep.outputs['X'], 'COSINE'), comb.inputs['X'])
    nt.links.new(trig(sep.outputs['X'], 'SINE'), comb.inputs['Y'])
    nt.links.new(trig(sep.outputs['Y'], 'COSINE'), comb.inputs['Z'])
    return comb.outputs[0], trig(sep.outputs['Y'], 'SINE')

def node(nt, kind, *, props=None, **inputs):
    """Create a shader node; inputs are values or sockets (by input name or index 'i0', 'i1')."""
    n = nt.nodes.new(kind)
    for k, v in (props or {}).items():
        setattr(n, k, v)
    for k, v in inputs.items():
        sock = n.inputs[int(k[1:])] if k[0] == 'i' and k[1:].isdigit() else n.inputs[k]
        if hasattr(v, 'is_output'):
            nt.links.new(v, sock)
        else:
            sock.default_value = v
    return n

def math_node(nt, op, a, b=None, clamp=False):
    n = node(nt, 'ShaderNodeMath', props={'operation': op, 'use_clamp': clamp}, i0=a, **({} if b is None else {'i1': b}))
    return n.outputs[0]

def bake_tile(path, make, size=1024, colorspace='sRGB', samples=4):
    """Bake a procedural material onto a unit UV square (EMIT) and save it. make(nt, vec, w) returns the colour or
    float socket to bake. Returns the image as a numpy array (HxWx3, linear)."""
    import numpy as np
    sc = _scene()
    kw = _override(sc)
    vl = kw['view_layer']
    plane = sc.objects.get('TILE_plane')
    if plane is None:
        me = bpy.data.meshes.new('DB_tile_plane')
        me.from_pydata([(0, 0, -50), (1, 0, -50), (1, 1, -50), (0, 1, -50)], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', [0, 0, 1, 0, 1, 1, 0, 1])
        plane = bpy.data.objects.new('TILE_plane', me)
        plane['noexport'] = 1
        sc.collection.objects.link(plane)
    mat = bpy.data.materials.get('DB_tile_mat') or bpy.data.materials.new('DB_tile_mat')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    vec, w = tile_coords(nt)
    out_sock = make(nt, vec, w)
    em = node(nt, 'ShaderNodeEmission', Color=out_sock, Strength=1.0)
    mo = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], mo.inputs['Surface'])
    plane.data.materials.clear()
    plane.data.materials.append(mat)
    img = bpy.data.images.get('DB_tilebake')
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new('DB_tilebake', size, size, alpha=False, float_buffer=True)
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = img
    nt.nodes.active = tn
    plane.hide_render = False
    _cycles(sc, samples)
    with bpy.context.temp_override(**kw):
        for ob in sc.objects:
            ob.select_set(ob == plane)
        vl.objects.active = plane
        bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True, target='IMAGE_TEXTURES')
    a = _np_image(img)[:, :, :3].copy()
    plane.hide_render = True
    if colorspace == 'sRGB':
        enc = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.clip(a, 0, None), 1 / 2.4) - 0.055)
        save_png(path, enc)
    else:
        save_png(path, a)
    return a

def normal_from_height(path, h, strength=4.0):
    """Tangent-space normal map (wrap-around gradients) from a tileable height field."""
    import numpy as np
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    save_png(path, n * 0.5 + 0.5)


# ============================================================================ stage runner
def reset():
    """Forget everything gathered so far (a live Blender session keeps globals between runs)."""
    BUCKETS.clear(); DOORS.clear(); COLS.clear(); EMPTIES.clear()
    _target[0] = None
    _layer[0] = 'shell'
    ORIGIN.zero()
    rng.seed(1987)

def run(stage):
    globals().pop('bake_all', None)
    exec(compile(open(DESIGN, encoding='utf-8').read(), DESIGN, 'exec'), globals())
    if stage in ('build', 'all'):
        reset()
    if stage == 'build':
        return build_all()
    if stage == 'bake':
        return bake_all() if 'bake_all' in globals() else bake_ao()
    if stage == 'export':
        return export_glb()
    if stage == 'all':
        out = {'build': build_all()}
        out['bake'] = bake_all() if 'bake_all' in globals() else bake_ao()
        out['export'] = export_glb()
        return out
    raise ValueError('unknown stage ' + str(stage))

def main(g):
    """Called by a runner: STAGE in the runner's globals (live session), or everything when headless."""
    if 'STAGE' in g:
        return run(g['STAGE'])
    if bpy.app.background:
        import json
        t0 = time.time()
        out = run('all')
        out['total_s'] = round(time.time() - t0, 1)
        print(RESULT_TAG + ' ' + json.dumps(out, default=repr))
        return out
