"""Dreambound: the Rocks tor, resculpted as weathered granite (public/models/tor.glb).

The layout is the game's own: tools/blender/export_tor.mjs writes the procedural tor's blocks and fallen boulders
(src/world/rockpiles.js buildTor) to tor_src.json, and this script sculpts each one in place, so the footprint,
height, the spring basin on top, the notch and the chute the waterfall runs down all stay exactly where they are
(the game still takes its walls and the water's path from the procedural blocks).

Per piece: closed and voxel-remeshed, then displaced along its normal by what weathers granite into a tor:
  - two sets of vertical joints at right angles (the master joints that split a tor into blocks), opening and closing
    along their length;
  - horizontal sheet joints (the pseudo-bedding that makes a tor look stacked), wavy, their depth varying round the
    block;
  - rain runnels down the upper edges of the sides, and weathering pans (shallow bowls) on flat tops;
  - broad lumps and a fine grain.
None of it touches the chute face, the notch, the spring basin or anything below the ground. Then it's decimated to
the game's budget, coloured (the procedural colours: lichen, moss, the wet chute and the basin's algae, taken from
the nearest procedural vertex, darkened in the joints), given baked ambient occlusion (with the stack's ground as an
occluder), box-mapped uvs in metres / 4 (the cliff texture's tile), and joined into one mesh whose `tor_frame` extra
records the layout it was made from (the game uses it only while that matches).

Headless:  blender --background --factory-startup --python tools/blender/tor_design.py
"""
import bpy, bmesh, json, math, os
import numpy as np
from mathutils import Vector, noise, kdtree

HERE = r"C:/repos/Dreambound/tools/blender"
SRC = os.path.join(HERE, 'tor_src.json')
OUT_GLB = os.environ.get('TOR_OUT_GLB', r"C:/repos/Dreambound/public/models/tor.glb")    # (override: a test build)
OUT_BLEND = os.environ.get('TOR_OUT_BLEND', os.path.join(HERE, 'tor.blend'))

VOXEL = 0.06          # remesh resolution (m)
TARGET_TRIS = 90000   # the whole tor after decimation
TILE = 4.0            # metres per cliff-texture tile (rockpiles.js TILE)
AO_DIST, AO_SAMPLES, AO_LO = 1.6, 64, 0.42

src = json.load(open(SRC))
F = src['frame']
SP = F['spill']
SX, SZ = math.cos(SP), math.sin(SP)       # out through the notch (game x, z)
TX, TZ = -SZ, SX                          # across it
POOL = (F['pool'][0] - F['x'], F['pool'][1] - F['z'])
G0, YW, RP, UFOOT, LEAN = F['g0'], F['yW'], F['rp'], F['uFoot'], F['lean']
UPOOL = POOL[0] * SX + POOL[1] * SZ
RW = RP - 0.15

GR = src['ground']
GH = np.array(GR['h'], dtype=np.float64).reshape(GR['n'], GR['n'])


def ground(x, z):
    fx = (x - GR['x0']) / GR['step']; fz = (z - GR['z0']) / GR['step']
    i = min(max(int(math.floor(fx)), 0), GR['n'] - 2); j = min(max(int(math.floor(fz)), 0), GR['n'] - 2)
    tx = min(max(fx - i, 0.0), 1.0); tz = min(max(fz - j, 0.0), 1.0)
    h0 = GH[j, i] * (1 - tx) + GH[j, i + 1] * tx
    h1 = GH[j + 1, i] * (1 - tx) + GH[j + 1, i + 1] * tx
    return h0 * (1 - tz) + h1 * tz


# game (x, y up, z) <-> Blender (x, -z, y): a rotation, so windings are kept
def g2b(x, y, z): return (x, -z, y)
def b2g(v): return (v[0], v[2], -v[1])


def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def n3(x, y, z, seed=0.0):
    return noise.noise(Vector((x + seed * 17.13, y - seed * 5.71, z + seed * 11.37)), noise_basis='PERLIN_ORIGINAL')


def fbm(x, y, z, oct, seed=0.0):
    s, a, f, norm = 0.0, 1.0, 1.0, 0.0
    for _ in range(oct):
        s += a * n3(x * f, y * f, z * f, seed); norm += a; a *= 0.5; f *= 2.03
    return s / norm


# ---- masks: what must not move ----
def face_u(y): return UFOOT - (y - G0) * LEAN


def keep(x, y, z):
    """1 where the sculpt may displace, 0 on the chute face, the notch, the basin and below the ground."""
    u = x * SX + z * SZ; w = abs(x * TX + z * TZ)
    chute = (1 - smooth(1.9, 2.6, w)) * smooth(face_u(y) - 2.1, face_u(y) - 1.4, u)
    notch = (1 - smooth(1.9, 2.6, w)) * smooth(UPOOL - 0.4, UPOOL + 0.2, u) * smooth(YW - 1.4, YW - 0.8, y)
    rho = math.hypot(x - POOL[0], z - POOL[1])
    basin = (1 - smooth(RP + 0.5, RP + 1.1, rho)) * smooth(YW - 1.4, YW - 0.8, y)
    under = smooth(-0.35, 0.05, y - ground(x, z))
    return (1 - max(chute, notch, basin)) * under


# ---- the sculpt ----
J1 = SP + 0.42                                 # the master joint sets, square to each other, skewed off the spill line
D1 = (math.cos(J1), math.sin(J1)); D2 = (-D1[1], D1[0])


def joint_set(x, y, z, d, spacing, phase, seed):
    """Distance (m) to the nearest joint plane of a set, and that joint's depth along its length (0-1)."""
    q = x * d[0] + z * d[1] + 0.35 * n3(x * 0.18, y * 0.1, z * 0.18, seed)
    k = (q + phase) / spacing
    idx = math.floor(k + 0.5)
    dist = abs(k - idx) * spacing
    open_ = smooth(-0.25, 0.35, n3(idx * 3.1, y * 0.22, (x * d[1] - z * d[0]) * 0.22, seed + 2))
    return dist, open_


def displace(x, y, z, nx, ny, nz, blk):
    side = 1 - smooth(0.55, 0.85, abs(ny))
    top = smooth(0.8, 0.95, ny)
    d = 0.0
    groove = 0.0
    # broad lumps and grain
    d += 0.06 * fbm(x * 0.32, y * 0.32, z * 0.32, 3, blk['seed'])
    d += 0.014 * n3(x * 6.5, y * 6.5, z * 6.5, blk['seed'] + 9)
    # sheet joints: the block's sides weathered into a stack of rounded slabs (flat in the middle, rounding off into
    # each parting), the partings wavy and opening and closing round the block
    if side > 0:
        yy = y + 0.18 * n3(x * 0.3, 0.0, z * 0.3, blk['seed'] + 3)
        # slabs of uneven thickness (the spacing wanders with height), each parting its own depth: some wide open,
        # some barely there
        k = (yy - blk['y0']) / blk['pitch'] + blk['phase'] + 0.55 * n3(blk['seed'] * 0.7, yy * 0.45, 0.31, blk['seed'] + 12)
        t = abs(k - math.floor(k) - 0.5) * 2                     # 0 mid-slab, 1 at a parting
        part = math.floor(k + 0.5)
        strength = 0.15 + 0.85 * smooth(-0.35, 0.35, n3(part * 1.73, blk['seed'] * 0.53, 0.77, 13))
        op = strength * (0.4 + 0.6 * smooth(-0.35, 0.3, n3(x * 0.25, y * 0.12, z * 0.25, blk['seed'] + 4)))
        depth = blk['sheet'] * op * (0.8 + 0.4 * (0.5 + 0.5 * n3(x * 0.7, y * 0.7, z * 0.7, blk['seed'] + 6)))
        prof = t ** 3 + 0.5 * smooth(0.88, 1.0, t)               # rounded slab edge, then the dark crack itself
        d -= side * depth * prof
        groove = max(groove, side * op * smooth(0.8, 1.0, t))
        # rain runnels down the top metre of the sides
        near_top = 1 - smooth(0.15, 1.3, blk['ytop'] - y)
        if near_top > 0:
            r = 1 - abs(n3(x * 3.2, y * 0.3, z * 3.2, blk['seed'] + 7))
            d -= side * near_top * 0.05 * r ** 6
    # master joints: clefts with rounded shoulders on the sides, cracks across the tops
    for dvec, spc, ph, sd in ((D1, 3.4, 0.7, 31), (D2, 4.3, 1.9, 47)):
        dist, op = joint_set(x, y, z, dvec, spc, ph, sd)
        wdt = 0.06 + 0.05 * (0.5 + 0.5 * n3(x * 0.5, y * 0.5, z * 0.5, sd + 5))
        crack = (1 - smooth(0.0, wdt, dist)) * op
        sh = (1 - smooth(wdt, wdt + 0.5, dist)) ** 2 * op
        d -= side * (0.34 * crack + 0.1 * sh) * blk['joint'] + top * (0.12 * crack + 0.04 * sh)
        groove = max(groove, crack * (side + top * 0.6))
    # weathering pans on the flat tops
    if top > 0:
        dists, pts = noise.voronoi(Vector((x / 1.4, z / 1.4, blk['seed'] * 0.37)), distance_metric='DISTANCE')
        cell = pts[0]
        gate = smooth(0.15, 0.45, n3(cell[0] * 2.7, cell[1] * 2.7, 0.5, blk['seed'] + 8))
        pan = (1 - smooth(0.18, 0.42, dists[0])) * gate
        d -= top * 0.08 * pan
        groove = max(groove, 0.4 * pan * top)
    return d, groove


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_from_soup(name, pos):
    bm = bmesh.new()
    vs = [bm.verts.new(g2b(pos[i], pos[i + 1], pos[i + 2])) for i in range(0, len(pos), 3)]
    for i in range(0, len(vs), 3):
        try: bm.faces.new((vs[i], vs[i + 1], vs[i + 2]))
        except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)          # the bases are bottomless: close them for the remesh
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_mod(ob, kind, **props):
    m = ob.modifiers.new(kind.lower(), kind)
    for k, v in props.items(): setattr(m, k, v)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)


def source_colours():
    """KD-tree over every procedural vertex (all blocks and boulders) and their baked colours, for the transfer."""
    allp, allc = [], []
    for b in src['blocks']:
        p, c = b['pos'], b['col']
        for i in range(0, len(p), 3): allp.append(g2b(p[i], p[i + 1], p[i + 2])); allc.append((c[i], c[i + 1], c[i + 2]))
    kd = kdtree.KDTree(len(allp))
    for i, v in enumerate(allp): kd.insert(v, i)
    kd.balance()
    return kd, allc


def sculpt_piece(bi, b, kd, allc):
    """One block or boulder of tor_src.json, closed, remeshed, weathered and coloured, as object `tor_{kind}_{bi}`."""
    ob = mesh_from_soup(f"tor_{b['kind']}_{bi}", b['pos'])
    apply_mod(ob, 'REMESH', mode='VOXEL', voxel_size=VOXEL if b['kind'] == 'body' else VOXEL * 0.8, use_smooth_shade=True)
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(n, 3)
    nor = np.empty(n * 3); me.vertices.foreach_get('normal', nor); nor = nor.reshape(n, 3)
    ys = co[:, 2]
    body = b['kind'] == 'body'
    blk = {'seed': 1.7 + bi * 2.3, 'ytop': float(ys.max()), 'y0': G0,
           'pitch': 0.7 + 0.4 * (0.5 + 0.5 * math.sin(bi * 12.9898)), 'phase': (bi * 0.618) % 1.0,
           'sheet': 0.22 if body else 0.03, 'joint': 1.0 if body else 0.4}
    col = np.zeros((n, 4)); col[:, 3] = 1
    for i in range(n):
        gx, gy, gz = b2g(co[i]); nx, ny, nz = b2g(nor[i])
        kp = keep(gx, gy, gz)
        d, groove = displace(gx, gy, gz, nx, ny, nz, blk) if kp > 0 else (0.0, 0.0)
        d *= kp; groove *= kp
        co[i] += nor[i] * d
        _, j, _ = kd.find(Vector(co[i]))
        c = allc[j]
        k = 1 - 0.42 * min(groove, 1.0)
        col[i, :3] = (c[0] * k, c[1] * k, c[2] * k)
    me.vertices.foreach_set('co', co.ravel())
    me.update()
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', col.ravel())
    print(f"  {ob.name}: {len(me.polygons)} faces")
    return ob


def sculpt_all():
    """Every piece sculpted, then decimated together to TARGET_TRIS (one ratio for all, so each keeps its share)."""
    kd, allc = source_colours()
    pieces = [sculpt_piece(bi, b, kd, allc) for bi, b in enumerate(src['blocks'])]
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in pieces)   # (the remesh makes quads)
    ratio = min(1.0, TARGET_TRIS / total)
    for ob in pieces:
        apply_mod(ob, 'DECIMATE', decimate_type='COLLAPSE', ratio=ratio, use_collapse_triangulate=True)
        ob.data.shade_smooth()
    print(f"remeshed {total} triangles -> {sum(len(o.data.polygons) for o in pieces)} after decimation")
    return pieces


def ground_object(name='ground'):
    """The stack's ground round the tor (tor_src.json's grid) as a mesh: the AO bake's occluder."""
    gme = bpy.data.meshes.new(name)
    N = GR['n']
    verts = [g2b(GR['x0'] + i * GR['step'], float(GH[j, i]), GR['z0'] + j * GR['step']) for j in range(N) for i in range(N)]
    faces = [(j * N + i, j * N + i + 1, (j + 1) * N + i + 1, (j + 1) * N + i) for j in range(N - 1) for i in range(N - 1)]
    gme.from_pydata(verts, [], faces); gme.update()
    gob = bpy.data.objects.new(name, gme); bpy.context.scene.collection.objects.link(gob)
    return gob


def bake_ao(pieces, dist=AO_DIST, samples=AO_SAMPLES, lo=AO_LO, gamma=1.2):
    """Cycles AO baked to the pieces' vertices and multiplied into their 'Col' (lo + (1 - lo) ao^gamma); whatever else
    is visible in the scene occludes. lo may also be {object name: per-vertex lo} (others get AO_LO)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    world = bpy.data.worlds.new('w'); sc.world = world
    world.light_settings.distance = dist
    mat = bpy.data.materials.new('rock'); mat.use_nodes = True
    for ob in pieces:
        ob.data.materials.append(mat)
        ao = ob.data.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        ob.data.color_attributes.active_color = ao
    sc.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.select_all(action='DESELECT')
    for ob in pieces: ob.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.bake(type='AO')
    for ob in pieces:
        me = ob.data
        n = len(me.vertices)
        c = np.empty(n * 4); me.color_attributes['Col'].data.foreach_get('color', c); c = c.reshape(n, 4)
        a = np.empty(n * 4); me.color_attributes['AO'].data.foreach_get('color', a); a = a.reshape(n, 4)[:, 0]
        lv = lo.get(ob.name, AO_LO) if isinstance(lo, dict) else lo
        k = lv + (1 - lv) * np.clip(a, 0, 1) ** gamma
        c[:, :3] *= k[:, None]
        me.color_attributes['Col'].data.foreach_set('color', c.ravel())
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        me.materials.clear()
    bpy.data.materials.remove(mat)


def box_uv(me):
    """Box-mapped uvs in metres / TILE (game axes, strata horizontal), as the cliff texture is tiled."""
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        nx, ny, nz = b2g(poly.normal)
        ax = max((abs(nx), 0), (abs(ny), 1), (abs(nz), 2))[1]
        for li in poly.loop_indices:
            gx, gy, gz = b2g(me.vertices[me.loops[li].vertex_index].co)
            uv.data[li].uv = ((gz, gy) if ax == 0 else (gx, gz) if ax == 1 else (gx, gy))
            uv.data[li].uv = (uv.data[li].uv[0] / TILE, uv.data[li].uv[1] / TILE)
    return uv


def join(pieces, name):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in pieces: ob.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob


def main():
    clear_scene()
    pieces = sculpt_all()
    # ---- ambient occlusion, with the stack's ground round the tor as an occluder ----
    gob = ground_object()
    bake_ao(pieces)
    # ---- one mesh, box-mapped uvs (metres / TILE, strata horizontal) ----
    tor = join(pieces, 'tor')
    me = tor.data
    box_uv(me)
    tor['tor_frame'] = json.dumps(F)
    bpy.data.objects.remove(gob)

    bpy.ops.object.select_all(action='DESELECT')
    tor.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_extras=True,
                              export_materials='NONE', export_vertex_color='ACTIVE', export_normals=True,
                              export_texcoords=True, export_yup=True, export_apply=False)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    print(f"tor: {len(me.polygons)} triangles, {len(me.vertices)} vertices -> {OUT_GLB}")


# Run directly. tor_blast_design.py execs this file under another __name__ to reuse the sculpt without building tor.glb.
if __name__ == '__main__':
    main()
