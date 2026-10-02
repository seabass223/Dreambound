"""Dreambound: the Rocks tor, blown apart by rocks.exe (public/models/tor_blast.glb).

Built from the same pieces as tor.glb (tor_design.py's sculpt is reused as is: same remesh, weathering, seeds and
decimation, so below the break the stump is the tor), in tor.glb's convention: vertices relative to (frame.x, 0,
frame.z), game axes, vertex colours (COLOR_0) and box uvs in metres / 4, no materials (the game draws them all with the
stack's cliff material).

  tor_stump       tier 0 (body 0-3) and the fallen boulders (10-13), their tops cut by a jagged fracture surface (a
                  faceted height field: a tilted plane per Voronoi cell, the steps between cells left as broken risers,
                  deeper toward the blast), the new faces fresh pale granite, scorched round the blast, a rubble apron of
                  fragments at its foot (inside the tor's wall outline) and scree on its top; AO baked without the upper
                  tiers, with the stack's ground as an occluder.
  tor_stump_far   the stump decimated (far stand-in).
  tor_far         the intact tor (tor.glb) decimated (far stand-in, same colours).
  tor_chunk_<i>   fragments of the upper tiers (body 4-9): each a random convex cell (a Voronoi-like polytope, cut with
                  bmesh bisect planes and capped) clipped from one sculpted piece, so shards from its skin keep the
                  weathered face and the rest is fresh fracture; the mesh is centred on its centroid (node translation =
                  rest centroid).
  'blast'         ONE animation clip with every chunk's translation + rotation, sampled at 30 fps: frame 0 is the rest
                  pose. Simulated with Blender's Bullet rigid bodies (the stack's cap from tor_src.json's `stack` grid,
                  the stump and the sequoia's trunk passive): each chunk is launched by a pair of motor constraints
                  (linear along its throw, angular about a random axis) live for the first frame only, as Bullet won't
                  take a velocity from an animated->dynamic handover in Blender 5. It runs twice: the second time each
                  chunk's damping ramps up just after its first strike (rock on turf digs in, where Bullet would let a
                  hull roll on for metres); then anything still creeping once down is eased to a stop. Chunk extras:
                  { settle (s: still from then on), lost (thrown over the rim: falling at the end), r (m, from pivot) }.
  tor_boulder_<k> the five thrown boulders (the game's radii r, index-matched): rounded jointed granite blocks weathered
                  as the tor, one fresh fracture face, centred at the origin; extras {r}.
  BLAST           empty, extras { center, charges[5], launch[5], fps, frames, duration, chunks, tor_frame }.

Needs tools/blender/tor_src.json with the `stack` grid (node tools/blender/export_tor.mjs [--stack]) and
public/models/tor.glb (its colours are the intact tor's).

Headless (about a minute):  blender --background --factory-startup --python tools/blender/tor_blast_design.py
  TORB_CACHE=1      reuse the sculpted pieces from the last run (tools/blender/tor_blast_pieces.blend)
  TORB_RENDER=dir   also render previews (the stump from the sequoia camera, blast frames, the boulders) into dir
  TORB_OUT_GLB=...  write the GLB elsewhere
"""
import bpy, bmesh, json, math, os, random, struct, time
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler, noise, kdtree
from mathutils.bvhtree import BVHTree

T_START = time.time()
HERE = r"C:/repos/Dreambound/tools/blender"
ROOT = r"C:/repos/Dreambound"
TD = os.path.join(HERE, 'tor_design.py')
T = {'__name__': 'tor_design', '__file__': TD}
exec(compile(open(TD, encoding='utf-8').read(), TD, 'exec'), T)

OUT_GLB = os.environ.get('TORB_OUT_GLB', os.path.join(ROOT, 'public/models/tor_blast.glb'))
OUT_BLEND = os.path.join(HERE, 'tor_blast.blend')
CACHE = os.path.join(HERE, 'tor_blast_pieces.blend')
TOR_GLB = os.path.join(ROOT, 'public/models/tor.glb')
RENDER_DIR = os.environ.get('TORB_RENDER', '')

src, F = T['src'], T['F']
g2b, b2g, smooth, n3, fbm, ground = T['g2b'], T['b2g'], T['smooth'], T['n3'], T['fbm'], T['ground']
G0 = F['g0']

FPS = 30
FRAMES = 180                 # clip frames 0..FRAMES (6 s)
SUBSTEPS = 20
N_SHARD, N_CORE = 46, 22     # chunks off the upper tiers' skin / from inside them
MAX_EXTENT = 0.95            # longest dimension of a chunk (m)
STUMP_IDS = [0, 1, 2, 3, 10, 11, 12, 13]
UPPER_IDS = [4, 5, 6, 7, 8, 9]
BOULDER_R = [1.15, 1.0, 1.25, 0.95, 1.1]
STUMP_TRIS, STUMP_FAR_TRIS, TOR_FAR_TRIS, BOULDER_TRIS = 60000, 7800, 9800, 3900
FRESH = np.array([0.74, 0.665, 0.62])         # fresh granite: pale, faintly pink (linear, times the rock texture)
SOOT = np.array([0.075, 0.068, 0.062])
rng = random.Random(1979)


def log(*a):
    print(f"[tor_blast {time.time() - T_START:6.1f}s]", *a, flush=True)


# ---------------------------------------------------------------------------------------------------------------------
# Small helpers (Blender coords unless a name says game: game (x, y, z) = Blender (x, -z, y), as g2b / b2g)

def V(gx, gy, gz): return Vector(g2b(gx, gy, gz))
def G(v): return Vector(b2g(v))


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def ob_from_bm(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    return link(bpy.data.objects.new(name, me))


def dup(ob, name):
    o = ob.copy(); o.data = ob.data.copy(); o.name = name; o.data.name = name
    return link(o)


def apply_mod(ob, kind, **props): T['apply_mod'](ob, kind, **props)


def tris(ob): return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate_to(ob, target):
    n = tris(ob)
    if n > target:
        apply_mod(ob, 'DECIMATE', decimate_type='COLLAPSE', ratio=target / n, use_collapse_triangulate=True)
    return tris(ob)


def col_layer(bm):
    return bm.verts.layers.float_color.get('Col') or bm.verts.layers.float_color.new('Col')


def ensure_col(me, rgb=(0.4, 0.4, 0.37)):
    if 'Col' not in me.color_attributes:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        c = np.tile(np.array([*rgb, 1.0]), len(me.vertices))
        ca.data.foreach_set('color', c)
    me.color_attributes.active_color = me.color_attributes['Col']
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def get_cols(me):
    n = len(me.vertices)
    c = np.empty(n * 4); me.color_attributes['Col'].data.foreach_get('color', c)
    return c.reshape(n, 4)


def set_cols(me, c):
    me.color_attributes['Col'].data.foreach_set('color', np.asarray(c, dtype=np.float64).ravel())


def get_co(me):
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co)
    return co.reshape(n, 3)


def bvh_of(obs):
    bm = bmesh.new()
    for ob in obs:
        t = bmesh.new(); t.from_mesh(ob.data); t.transform(ob.matrix_world)
        me = bpy.data.meshes.new('_t'); t.to_mesh(me); t.free()
        bm.from_mesh(me); bpy.data.meshes.remove(me)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def inside(tree, p):
    hit = tree.find_nearest(p)
    return hit[0] is not None and (p - hit[0]).dot(hit[1]) < 0, hit[3] if hit[0] is not None else 1e9


def box_uv(ob): T['box_uv'](ob.data)


def rot_between(a, b): return Vector(a).normalized().rotation_difference(Vector(b).normalized())


def rand_unit(r=rng):
    while True:
        v = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1)))
        if 0.05 < v.length <= 1: return v.normalized()


# ---------------------------------------------------------------------------------------------------------------------
# The blast's layout (game coords, relative to (frame.x, 0, frame.z))

def layout(pieces):
    """Blast centre, the five charges and the five boulders' launch points, from the upper pieces' geometry."""
    up = [pieces[i] for i in (6, 7, 8)]
    pts = np.concatenate([np.stack([get_co(o.data)[:, 0], get_co(o.data)[:, 2], -get_co(o.data)[:, 1]], 1) for o in up])
    c = pts.mean(0)
    center = [round(float(c[0]), 3), round(float(c[1]) - 0.4, 3), round(float(c[2]), 3)]
    tree = bvh_of([pieces[i] for i in UPPER_IDS])

    def surf(az, y, depth, out=0.0):
        """Point on the upper tiers' skin seen from the blast centre's axis at azimuth az and height y, moved `depth`
        into the rock (or `out` outside it)."""
        o = V(center[0], y, center[2]); d = Vector((math.cos(az), -math.sin(az), 0.0))   # game (cos, ., sin) -> blender
        far = o + d * 14
        hit = tree.ray_cast(far, -d, 20)
        if hit[0] is None: return None
        p = hit[0] + d * out - d * depth
        g = G(p)
        return [round(g[0], 3), round(g[1], 3), round(g[2], 3)]

    sp = F['spill']
    # (layout.txt: two in tier 2 at 0.8 m, one in tier 3 at 0.6 m, two in the cap at 0.5 m)
    charges = [surf(sp + 2.3, 14.6, 0.8), surf(sp - 1.9, 14.9, 0.8), surf(sp + 0.6, 16.6, 0.6),
               surf(sp + math.pi - 0.3, 18.3, 0.5), surf(sp + 1.2, 18.7, 0.5)]
    launch = []
    for k, r in enumerate(BOULDER_R):
        az = sp + 0.5 + k * (2 * math.pi / 5) + 0.25 * math.sin(k * 2.1)
        launch.append(surf(az, 17.2 + 0.5 * (k % 3), 0.0, out=0.35 * r))
    return {'center': center, 'charges': charges, 'launch': launch}


# ---------------------------------------------------------------------------------------------------------------------
# The break: a faceted height field (game coords)

def cell_plane(x, z, scale, seed, amp_off, amp_slope, soft=0.0):
    """A plane per Voronoi cell (scale m): the height at (x, z) on the plane of the cell it's in, eased into the next
    cell's over `soft` m either side of their border (a steep riser rather than a cliff the grid can't hold), and the
    cell's feature point."""
    dist, pts = noise.voronoi(Vector((x / scale, z / scale, seed * 0.37)), distance_metric='DISTANCE')

    def plane(c):
        cx, cz = c[0] * scale, c[1] * scale
        off = n3(c[0] * 3.1, c[1] * 3.1, 1.7, seed)
        sx = n3(c[0] * 2.3, c[1] * 2.3, 4.2, seed + 1)
        sz = n3(c[0] * 2.3, c[1] * 2.3, 6.9, seed + 2)
        return amp_off * off + amp_slope * (sx * (x - cx) + sz * (z - cz))
    h = plane(pts[0])
    if soft > 0:
        w = 0.5 * (1 - smooth(0.0, soft, (dist[1] - dist[0]) * scale * 0.5))
        if w > 0: h = h * (1 - w) + plane(pts[1]) * w
    return h, pts[0]


def hb(x, z, L):
    """Height of the break at (x, z): a crater under the blast, big broken slabs (a tilted plane per large cell, the
    steps between cells left standing as risers), smaller facets on those, a few teeth left standing at the rim."""
    cx, cz = L['center'][0], L['center'][2]
    r = math.hypot(x - cx, z - cz)
    h = 9.15 + 1.25 * smooth(0.5, 7.0, r)
    big, c = cell_plane(x, z, 2.7, 77, 1.5, 0.9, 0.05)
    med, _ = cell_plane(x, z, 1.05, 83, 0.45, 0.6, 0.035)
    tooth = smooth(0.2, 0.5, n3(c[0] * 1.7, c[1] * 1.7, 9.1, 80)) * smooth(3.0, 6.5, r) * 1.3
    grain = 0.05 * fbm(x * 2.2, 0.0, z * 2.2, 3, 81) + 0.015 * n3(x * 9, 0.3, z * 9, 82)
    return h + big + med + tooth + grain


def cutter(L, bounds, step=0.12, top=40.0):
    """Closed solid over the break surface (everything above it), for the boolean."""
    (x0, z0), (x1, z1) = bounds
    nx, nz = int(math.ceil((x1 - x0) / step)) + 1, int(math.ceil((z1 - z0) / step)) + 1
    # (jittered off the grid, so the risers between facets don't come out as regular flutes)
    P = [[None] * nx for _ in range(nz)]
    for j in range(nz):
        for i in range(nx):
            x, z = x0 + i * step, z0 + j * step
            if 0 < i < nx - 1 and 0 < j < nz - 1:
                x += 0.38 * step * n3(i * 0.71, j * 0.71, 0.3, 84); z += 0.38 * step * n3(i * 0.71, j * 0.71, 5.3, 85)
            P[j][i] = V(x, hb(x, z, L), z)
    bm = bmesh.new()
    vs = [[bm.verts.new(P[j][i]) for i in range(nx)] for j in range(nz)]
    for j in range(nz - 1):
        for i in range(nx - 1):
            bm.faces.new((vs[j][i], vs[j + 1][i], vs[j + 1][i + 1], vs[j][i + 1]))
    surf_faces = list(bm.faces)
    bnd = [e for e in bm.edges if e.is_boundary]
    ext = bmesh.ops.extrude_edge_only(bm, edges=bnd)
    for v in [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]: v.co.z = top
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = ob_from_bm(bm, 'cutter')
    bm.free()
    # the break surface alone (same triangles), to tell the fresh faces after the cut
    sbm = bmesh.new()
    sv = [[sbm.verts.new(P[j][i]) for i in range(nx)] for j in range(nz)]
    for j in range(nz - 1):
        for i in range(nx - 1):
            sbm.faces.new((sv[j][i], sv[j + 1][i], sv[j + 1][i + 1], sv[j][i + 1]))
    bmesh.ops.triangulate(sbm, faces=sbm.faces)
    tree = BVHTree.FromBMesh(sbm)
    sbm.free()
    return ob, tree


def boolean_diff(ob, cut):
    for solver in ('MANIFOLD', 'EXACT'):
        o = dup(ob, ob.name + '_try')
        m = o.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cut; m.solver = solver
        bpy.context.view_layer.objects.active = o
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:
            log('boolean', solver, 'failed', e); bpy.data.objects.remove(o); continue
        if len(o.data.polygons) > 100:
            name = ob.name
            bpy.data.objects.remove(ob)
            o.name = name; o.data.name = name
            log(f"  cut {name} ({solver}): {tris(o)} tris")
            return o
        bpy.data.objects.remove(o)
    raise RuntimeError('boolean failed on ' + ob.name)


# ---------------------------------------------------------------------------------------------------------------------
# Colour

def fresh_rgb(gx, gy, gz, tone=0.0):
    """Fresh granite: pale pink-grey, with feldspar-pink and darker biotite-rich patches."""
    a = fbm(gx * 0.9, gy * 0.9, gz * 0.9, 3, 91)
    b = n3(gx * 3.1, gy * 3.1, gz * 3.1, 92)
    c = FRESH * (1 + 0.1 * a + tone)
    c = c + np.array([0.035, 0.0, -0.02]) * smooth(0.0, 0.5, b)          # pink
    c = c * (1 - 0.12 * smooth(0.2, 0.7, -b))                            # grey
    return c


def soot_k(g, L, n_up=1.0, charges=True):
    """0..1 scorch at game point g: a smudge round the blast's axis with rays thrown out from it (on the stump top),
    and close round each charge (on the chunks)."""
    cx, cy, cz = L['center']
    r = math.hypot(g[0] - cx, g[2] - cz)
    ang = math.atan2(g[2] - cz, g[0] - cx)
    ray = smooth(0.55, 0.85, 0.5 + 0.5 * n3(ang * 3.3, r * 0.12, 0.5, 93))
    s = (1 - smooth(0.8, 3.8, r)) * 0.85 + (1 - smooth(2.0, 7.0, r)) * ray * 0.55
    s *= 0.55 + 0.45 * max(0.0, n_up)
    if charges:
        for ch in L['charges']:
            s = max(s, 0.9 * (1 - smooth(0.4, 1.6, math.dist(g, ch))))
    blot = smooth(-0.3, 0.4, n3(g[0] * 1.3, g[1] * 1.3, g[2] * 1.3, 94))
    return min(1.0, s * (0.55 + 0.45 * blot))


def apply_soot(c, k):
    return c * (1 - 0.82 * k) + SOOT * 0.82 * k


# ---------------------------------------------------------------------------------------------------------------------
# Rubble

def rubble_frag(r, size, flat=0.6):
    """An angular fragment: the convex hull of points in a squashed ellipsoid, as ([co], [(i, j, k)])."""
    bm = bmesh.new()
    ax = (size, size * r.uniform(0.55, 0.9), size * r.uniform(flat * 0.6, flat))
    for _ in range(r.randint(9, 15)):
        d = rand_unit(r)
        bm.verts.new((d.x * ax[0], d.y * ax[1], d.z * ax[2]))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.index_update()
    co = [v.co.copy() for v in bm.verts]
    fs = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    return co, fs


def rubble(stump_tree, ground_tree, L, rOut, bouls):
    """Fragments at the stump's foot (inside the walls' outline) and scree on its broken top, as one mesh."""
    r = random.Random(7)
    bm = bmesh.new()
    cl = col_layer(bm)
    placed = []

    def place(x, z, size, kind):
        o = Vector((x, -z, 60.0))
        hs = stump_tree.ray_cast(o, Vector((0, 0, -1)), 100)
        hg = ground_tree.ray_cast(o, Vector((0, 0, -1)), 100)
        hit = hs if (hs[0] is not None and (hg[0] is None or hs[0].z > hg[0].z)) else hg
        if hit[0] is None: return False
        on_rock = hit is hs
        if kind == 'top' and not (on_rock and hit[1].z > 0.55 and G(hit[0])[1] > G0 + 2.0): return False
        if kind == 'foot' and on_rock and (hit[1].z < 0.75 or G(hit[0])[1] > ground(x, z) + 0.8): return False
        for (px, pz, ps) in placed:
            if math.hypot(px - x, pz - z) < (ps + size) * 0.8: return False
        co, fs = rubble_frag(r, size, flat=0.55 if kind == 'top' else 0.7)
        q = Euler((r.uniform(-0.4, 0.4), r.uniform(-0.4, 0.4), r.uniform(0, 6.3))).to_quaternion()
        up = Vector((0, 0, 1))
        q = rot_between(up, hit[1].lerp(up, 0.5)) @ q
        co = [q @ v for v in co]
        zmin = min(v.z for v in co)
        h = max(v.z for v in co) - zmin
        co = [v + hit[0] - Vector((0, 0, zmin + h * r.uniform(0.15, 0.35))) for v in co]
        # colour: most are fresh (thrown off the break), some weathered skin, scorched near the blast
        fresh = r.random() < (0.8 if kind == 'top' else 0.6)
        tone = r.uniform(-0.08, 0.06)
        vs = []
        for p in co:
            g = G(p)
            c = fresh_rgb(*g, tone) if fresh else np.array([0.36, 0.36, 0.33]) * (1 + tone + 0.1 * n3(g[0] * 4, g[1] * 4, g[2] * 4, 95))
            c = apply_soot(c, soot_k(g, L, 1.0, False) * (0.9 if kind == 'top' else 0.5))
            v = bm.verts.new(p); v[cl] = (*c, 1.0); vs.append(v)
        for f in fs:
            try: bm.faces.new([vs[i] for i in f])
            except ValueError: pass
        placed.append((x, z, size))
        return True

    # the foot: just inside the outline the walls are fitted to (rockpiles.js outline/fitWalls), toward the rock
    n_foot = 0
    for _ in range(5000):
        if n_foot >= 140: break
        th = r.uniform(0, 2 * math.pi)
        size = 0.09 + 0.4 * r.random() ** 2.0
        if r.random() < 0.82:
            ro = r_at(rOut, th) - size * 0.9 - 0.25 * r.random() ** 0.5
            x, z = ro * math.cos(th), ro * math.sin(th)
        else:
            b = r.choice(bouls)
            ro = r_at(b['r'], th) - size * 0.9 - 0.2 * r.random()
            x, z = b['cx'] + ro * math.cos(th), b['cz'] + ro * math.sin(th)
        if not inside_outline(x, z, size, rOut, bouls): continue
        if place(x, z, size, 'foot'): n_foot += 1
    # the broken top
    n_top = 0
    cx, cz = L['center'][0], L['center'][2]
    for _ in range(2600):
        if n_top >= 85: break
        th = r.uniform(0, 2 * math.pi); d = 8.5 * math.sqrt(r.random())
        size = 0.08 + 0.3 * r.random() ** 2 if r.random() > 0.14 else r.uniform(0.35, 0.65)   # and some big blocks
        if place(cx + d * math.cos(th), cz + d * math.sin(th), size, 'top'): n_top += 1
    ob = ob_from_bm(bm, 'rubble')
    bm.free()
    log(f"  rubble: {n_foot} at the foot, {n_top} on top, {tris(ob)} tris")
    return ob


# The tor's outline as rockpiles.js works it out (outline(): furthest reach per angle of the procedural blocks' vertices
# in the BAND -0.3..3 m above the ground, spread one bin each way), round the tor's centre and each fallen boulder.
BAND = (-0.3, 3.0)


def outline_of(blocks, cx, cz, K):
    r = np.zeros(K)
    for b in blocks:
        p = b['pos']
        for i in range(0, len(p), 3):
            x, y, z = p[i], p[i + 1], p[i + 2]
            h = y - ground(x, z)
            if h < BAND[0] or h > BAND[1]: continue
            d = math.hypot(x - cx, z - cz)
            k = int(round((math.atan2(z - cz, x - cx) / (2 * math.pi) + 1) * K)) % K
            r[k] = max(r[k], d)
    full = np.array([max(r[(k - 1) % K], r[k], r[(k + 1) % K]) for k in range(K)])
    out = full.copy()
    for k in range(K):
        if full[k] > 0: out[k] = full[k] + 0.03; continue
        a = b = 1
        while a < K and full[(k - a) % K] == 0: a += 1
        while b < K and full[(k + b) % K] == 0: b += 1
        out[k] = max(full[(k - a) % K], full[(k + b) % K]) + 0.03
    return out


def r_at(rOut, ang):
    K = len(rOut); f = ((ang / (2 * math.pi)) % 1.0) * K; i = int(math.floor(f)) % K
    t = f - math.floor(f)
    return rOut[i] * (1 - t) + rOut[(i + 1) % K] * t


def inside_outline(x, z, size, rOut, bouls):
    if math.hypot(x, z) + size * 0.8 <= r_at(rOut, math.atan2(z, x)) + 0.05: return True
    for b in bouls:
        if math.hypot(x - b['cx'], z - b['cz']) + size * 0.8 <= r_at(b['r'], math.atan2(z - b['cz'], x - b['cx'])) + 0.05: return True
    return False


# ---------------------------------------------------------------------------------------------------------------------
# Chunks

def clip_cell(src_bm, planes, fresh_layer):
    """src_bm (closed) intersected with the half-spaces (co, no) (keep the side the normal points away from)."""
    bm = src_bm.copy()
    fl = bm.faces.layers.int[fresh_layer]
    for co, no in planes:
        if not bm.verts: break
        r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
                                   plane_co=co, plane_no=no, clear_outer=True)
        bnd = [e for e in bm.edges if e.is_boundary]
        if bnd:
            new = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)['faces']
            for f in new: f[fl] = 1
    return bm


def make_chunks(upper, L, stump_hb):
    """Seeds on and in the upper tiers, each cut out as a random convex cell; returns [(ob, game centroid, volume)]."""
    tree = bvh_of(upper)
    trees = [bvh_of([o]) for o in upper]
    # area-weighted skin samples that are on the visible skin (inside no other upper piece)
    cand = []
    for pi, o in enumerate(upper):
        me = o.data
        for p in me.polygons:
            cand.append((p.area, pi, Vector(p.center), Vector(p.normal)))
    areas = np.array([c[0] for c in cand]); areas /= areas.sum()
    seeds = []
    r = random.Random(4242)
    picks = np.random.default_rng(4242).choice(len(cand), size=6000, p=areas)
    for idx in picks:
        if len([s for s in seeds if s['kind'] == 'shard']) >= N_SHARD: break
        _, pi, c, n = cand[idx]
        if any(inside(trees[j], c + n * 0.02)[0] for j in range(len(upper)) if j != pi): continue
        size = r.uniform(0.2, 0.38)
        p = c - n * size * 0.35
        g = G(p)
        if g[1] - 1.3 * size < stump_hb(g[0], g[2]) + 0.12: continue
        if any((p - s['p']).length < (size + s['size']) * 1.25 + 0.15 for s in seeds): continue
        seeds.append({'kind': 'shard', 'pi': pi, 'p': p, 'n': n, 'size': size})
    # cores: inside a piece, at least a little under its skin
    allco = np.concatenate([get_co(o.data) for o in upper])
    bmin, bmax = Vector(allco.min(0)), Vector(allco.max(0))
    for _ in range(20000):
        if len([s for s in seeds if s['kind'] == 'core']) >= N_CORE: break
        p = Vector((r.uniform(bmin.x, bmax.x), r.uniform(bmin.y, bmax.y), r.uniform(bmin.z, bmax.z)))
        size = r.uniform(0.22, 0.36)
        pi = None
        for j in range(len(upper)):
            ins, d = inside(trees[j], p)
            if ins and d > size * 0.9: pi = j; break
        if pi is None: continue
        g = G(p)
        if g[1] - 1.3 * size < stump_hb(g[0], g[2]) + 0.12: continue
        if any((p - s['p']).length < (size + s['size']) * 1.25 + 0.15 for s in seeds): continue
        seeds.append({'kind': 'core', 'pi': pi, 'p': p, 'n': None, 'size': size})
    log(f"  chunk seeds: {sum(s['kind'] == 'shard' for s in seeds)} shards, {sum(s['kind'] == 'core' for s in seeds)} cores")

    src_bms = []
    for o in upper:
        b = bmesh.new(); b.from_mesh(o.data); b.faces.layers.int.new('fresh')
        src_bms.append(b)
    out = []
    for si, s in enumerate(seeds):
        size, p = s['size'], s['p']
        # a random convex cell, flattened along one axis (granite breaks blocky and platy)
        flat = rand_unit(r); squash = r.uniform(0.55, 0.85)
        planes = []
        for ax in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))):      # crop first: cheap
            for sg in (1, -1): planes.append((p + ax * sg * size * 1.25, ax * sg))
        for _ in range(r.randint(13, 17)):
            n = rand_unit(r)
            k = 1 - (1 - squash) * abs(n.dot(flat))
            planes.append((p + n * size * r.uniform(0.72, 1.1) * k, n))
        bm = clip_cell(src_bms[s['pi']], planes, 'fresh')
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        if len(bm.faces) < 8 or not all(e.is_manifold for e in bm.edges):
            bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
        vol = bm.calc_volume(signed=False) if bm.faces else 0.0
        ext = max(((a.co - b.co).length for a in bm.verts for b in bm.verts), default=0.0) if len(bm.verts) < 400 else 9.0
        if vol < 0.012 or ext > MAX_EXTENT:
            bm.free(); continue
        fl = bm.faces.layers.int['fresh']
        bmesh.ops.triangulate(bm, faces=bm.faces)
        # conchoidal relief on the fresh faces: poke each and push its centre in or out a little
        fresh = [f for f in bm.faces if f[fl]]
        if fresh:
            pk = bmesh.ops.poke(bm, faces=[f for f in fresh if f.calc_area() > 0.004])
            bm.normal_update()
            for v in pk['verts']:
                nrm = v.link_faces[0].normal.copy() if v.link_faces else Vector()
                v.co += nrm * r.uniform(-0.05, 0.035) * size
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # hard edges: between fresh and weathered faces, and between fresh facets at an angle
        sharp = [e for e in bm.edges if len(e.link_faces) == 2 and
                 (e.link_faces[0][fl] != e.link_faces[1][fl] or (e.link_faces[0][fl] and e.calc_face_angle(0) > 0.5))]
        bmesh.ops.split_edges(bm, edges=sharp)
        cl = col_layer(bm)
        tone = r.uniform(-0.07, 0.05)
        cen0 = Vector()
        sooty = 1.0 if r.random() < 0.7 else 0.3
        for f in bm.faces:
            if not f[fl]: continue
            for v in f.verts:
                g = G(v.co)
                ch = min(math.dist(G(v.co + cen0), q) for q in L['charges'])
                c = apply_soot(fresh_rgb(*g, tone), 0.9 * (1 - smooth(0.5, 1.7, ch)) * sooty)
                v[cl] = (*c, 1.0)
        # centroid (of the solid) -> origin
        cen = Vector(); vt = 0.0
        for f in bm.faces:
            a, b, c = (v.co for v in f.verts[:3])
            dv = a.dot(b.cross(c)) / 6.0
            cen += (a + b + c) * (dv / 4.0); vt += dv
        cen = cen / vt if abs(vt) > 1e-9 else sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
        for v in bm.verts: v.co -= cen
        rad = max(v.co.length for v in bm.verts)
        name = f'tor_chunk_{len(out)}'
        ob = ob_from_bm(bm, name)
        bm.free()
        ob.location = cen
        ob.data.shade_smooth()
        ensure_col(ob.data)
        # box uvs as the tor's at its rest place (so the texture doesn't jump at the swap), then carried with it
        ob.data.transform(Matrix.Translation(cen)); box_uv(ob); ob.data.transform(Matrix.Translation(-cen))
        out.append({'ob': ob, 'vol': vol, 'rad': rad, 'kind': s['kind'], 'cen': cen.copy(), 'ext': ext})
    for b in src_bms: b.free()
    ex = np.array([c['ext'] for c in out])
    log(f"  chunks: {len(out)}, {sum(tris(c['ob']) for c in out)} tris, size (longest) median {np.median(ex):.2f} m max {ex.max():.2f} m,"
        f" volume {sum(c['vol'] for c in out):.1f} m3")
    return out


# ---------------------------------------------------------------------------------------------------------------------
# Rigid bodies

def stack_ground():
    """The Rocks cap as a mesh: tor_src.json's fine grid round the tor, the coarse `stack` grid elsewhere, no faces past
    the rim (so chunks thrown over it fall)."""
    S = src.get('stack')
    if not S: raise RuntimeError("tor_src.json has no `stack` grid: run node tools/blender/export_tor.mjs --stack")
    GR = src['ground']
    off = G0 - 5
    SH = np.array([np.nan if v is None else v for v in S['h']], dtype=np.float64).reshape(S['n'], S['n'])
    FH = np.array(GR['h'], dtype=np.float64).reshape(GR['n'], GR['n'])

    def coarse(x, z):
        fx = (x - S['x0']) / S['step']; fz = (z - S['z0']) / S['step']
        i, j = int(math.floor(fx)), int(math.floor(fz))
        if i < 0 or j < 0 or i >= S['n'] - 1 or j >= S['n'] - 1: return None
        q = SH[j:j + 2, i:i + 2]
        if np.isnan(q).any(): return None
        tx, tz = fx - i, fz - j
        return (q[0, 0] * (1 - tx) + q[0, 1] * tx) * (1 - tz) + (q[1, 0] * (1 - tx) + q[1, 1] * tx) * tz

    def fine(x, z):
        fx = (x - GR['x0']) / GR['step']; fz = (z - GR['z0']) / GR['step']
        i, j = int(round(fx)), int(round(fz))
        if abs(fx - i) > 1e-6 or abs(fz - j) > 1e-6 or i < 0 or j < 0 or i >= GR['n'] or j >= GR['n']: return False
        h = FH[j, i]
        return None if abs(h - off) < 1e-3 else h

    step = 0.5
    x0, z0 = S['x0'], S['z0']
    n = int((S['n'] - 1) * S['step'] / step) + 1
    H = np.full((n, n), np.nan)
    for j in range(n):
        for i in range(n):
            x, z = x0 + i * step, z0 + j * step
            h = fine(x, z)
            if h is False: h = coarse(x, z)
            if h is not None: H[j, i] = h - 0.03          # a touch low: debris settles into the grass, never floats
    bm = bmesh.new()
    vid = {}
    for j in range(n):
        for i in range(n):
            if not np.isnan(H[j, i]): vid[(i, j)] = bm.verts.new(V(x0 + i * step, H[j, i], z0 + j * step))
    for j in range(n - 1):
        for i in range(n - 1):
            q = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
            if all(k in vid for k in q): bm.faces.new([vid[k] for k in q])
    bmesh.ops.triangulate(bm, faces=bm.faces)
    ob = ob_from_bm(bm, 'stack_ground')
    bm.free()

    def height(x, z):
        fx, fz = (x - x0) / step, (z - z0) / step
        i, j = int(math.floor(fx)), int(math.floor(fz))
        if i < 0 or j < 0 or i >= n - 1 or j >= n - 1: return None
        q = H[j:j + 2, i:i + 2]
        if np.isnan(q).any(): return None
        tx, tz = fx - i, fz - j
        return (q[0, 0] * (1 - tx) + q[0, 1] * tx) * (1 - tz) + (q[1, 0] * (1 - tx) + q[1, 1] * tx) * tz + 0.03
    return ob, height


def sequoia_collider():
    s = src.get('sequoia')
    if not s: return None
    bm = bmesh.new()
    for y in (0.0, 4.0, 10.0, 18.0, 26.0, 34.0):
        rr = 3.4 if y <= 4 else 3.4 - 1.9 * ((y - 4) / 31) ** 1.1
        for k in range(16):
            a = k / 16 * 2 * math.pi
            bm.verts.new(V(s['x'] + rr * math.cos(a), s['y'] - 1 + y, s['z'] + rr * math.sin(a)))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    ob = ob_from_bm(bm, 'sequoia_collider')
    bm.free()
    return ob


def simulate(chunks, L, colliders, height):
    sc = bpy.context.scene
    sc.render.fps = FPS
    if sc.rigidbody_world is None: bpy.ops.rigidbody.world_add()
    rw = sc.rigidbody_world
    rw.substeps_per_frame = SUBSTEPS
    rw.solver_iterations = 30
    rw.use_split_impulse = True
    rw.point_cache.frame_start = 1
    rw.point_cache.frame_end = FRAMES + 2
    rbc = bpy.data.collections.new('RBConstraints'); sc.collection.children.link(rbc)
    rw.constraints = rbc

    def add_rb(ob, kind, shape, **kw):
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.rigidbody.object_add(type=kind)
        rb = ob.rigid_body
        rb.collision_shape = shape
        for k, v in kw.items(): setattr(rb, k, v)
        return rb

    for ob, fr, rs in colliders:
        add_rb(ob, 'PASSIVE', 'MESH' if ob.name != 'sequoia_collider' else 'CONVEX_HULL',
               friction=fr, restitution=rs, use_margin=True, collision_margin=0.0)
    anchor = link(bpy.data.objects.new('anchor', bpy.data.meshes.new('anchor')))
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=0.2); bm.to_mesh(anchor.data); bm.free()
    anchor.location = (0, 0, -500)
    rb = add_rb(anchor, 'PASSIVE', 'BOX')
    rb.collision_collections[0] = False; rb.collision_collections[19] = True

    r = random.Random(31337)
    cen = V(*L['center'])
    st = src.get('stack_centre') or (-300.0 - F['x'], 175.0 - F['z'])
    inland = V(st[0], 0, st[1]).normalized()
    throws = []
    for c in chunks:
        ob = c['ob']
        add_rb(ob, 'ACTIVE', 'CONVEX_HULL', mass=max(0.5, c['vol'] * 2650), friction=1.0, restitution=0.45,
               linear_damping=0.08, angular_damping=0.55, use_margin=True, collision_margin=0.01,
               use_deactivation=True, deactivate_linear_velocity=0.3, deactivate_angular_velocity=0.5)
        # the throw: away from the blast's heart, lifted, a little scatter; the nearer the faster
        d = ob.location - cen
        dist = d.length
        d.z *= 0.7
        # (biased a little toward the open island, away from the west rim the tor stands near, and the camera)
        dirv = (d.normalized() * 0.7 + Vector((0, 0, r.uniform(0.6, 1.3))) + rand_unit(r) * 0.28 + inland * 0.3).normalized()
        if dirv.z < 0.2: dirv.z = 0.2; dirv.normalize()
        speed = (8 + 14 * r.random() ** 3.2) * (1.15 - 0.3 * smooth(1.0, 6.0, dist)) * (1.1 if c['kind'] == 'core' else 1.0)
        speed = min(22.0, max(8.0, speed))
        spin = r.uniform(5, 16) * (0.45 / max(0.2, c['rad'])) ** 0.5
        axis = rand_unit(r)
        for a, lin, ang in ((dirv, speed, 0.0), (axis, 0.0, spin)):
            e = link(bpy.data.objects.new(ob.name + '_motor', None)); rbc.objects.link(e)
            e.location = ob.location
            e.rotation_mode = 'QUATERNION'; e.rotation_quaternion = rot_between((1, 0, 0), a)
            if e.rigid_body_constraint is None:            # (linking it into the constraints collection adds one)
                bpy.ops.object.select_all(action='DESELECT')
                bpy.context.view_layer.objects.active = e
                bpy.ops.rigidbody.constraint_add(type='MOTOR')
            k = e.rigid_body_constraint
            k.type = 'MOTOR'
            k.object1, k.object2 = ob, anchor
            k.disable_collisions = True
            if lin: k.use_motor_lin, k.motor_lin_target_velocity, k.motor_lin_max_impulse = True, lin, 1e6
            if ang: k.use_motor_ang, k.motor_ang_target_velocity, k.motor_ang_max_impulse = True, ang, 1e6
            k.enabled = True; k.keyframe_insert('enabled', frame=1); k.keyframe_insert('enabled', frame=2)
            k.enabled = False; k.keyframe_insert('enabled', frame=3)
        throws.append((speed, spin))

    # run it: clip frame f = Blender frame f + 1 (frame 1 is the rest pose, the motors fire during 1 -> 2)
    n = len(chunks)
    loc = np.zeros((FRAMES + 1, n, 3)); rot = np.zeros((FRAMES + 1, n, 4))

    def run(tag):
        for f in range(FRAMES + 1):
            sc.frame_set(f + 1)
            for i, c in enumerate(chunks):
                m = c['ob'].matrix_world
                loc[f, i] = m.translation
                q = m.to_quaternion()
                rot[f, i] = (q.w, q.x, q.y, q.z)
            if f % 60 == 0: log(f"  sim {tag} frame {f}")
    run('free')
    # Second pass: rocks landing on turf and grit dig in and stop where Bullet would let them tumble and roll on for
    # metres, so once a chunk first strikes the ground or the stump its damping ramps up (the flight is unchanged).
    stree = bvh_of([colliders[1][0]])
    hits = []
    for i, c in enumerate(chunks):
        hit = None
        for f in range(3, FRAMES):
            a = (loc[f + 1, i] - 2 * loc[f, i] + loc[f - 1, i]) * FPS * FPS - np.array([0, 0, -9.81])
            if np.linalg.norm(a) < 60: continue                       # (an impulse: > 2 m/s change in a frame)
            p = Vector(loc[f, i]); g = G(p)
            h = height(g[0], g[2])
            near = stree.find_nearest(p, c['rad'] + 0.5)[0] is not None or (h is not None and g[1] - h < c['rad'] + 0.5)
            if near: hit = f; break
        hits.append(hit)
        if hit is None: continue
        rb = c['ob'].rigid_body
        f0 = hit + 1 + 8                                                # (Blender frame of the impact, then a bounce)
        for path, lo_, hi_ in (('linear_damping', rb.linear_damping, 0.5), ('angular_damping', rb.angular_damping, 0.88)):
            setattr(rb, path, lo_); rb.keyframe_insert(path, frame=f0)
            setattr(rb, path, hi_); rb.keyframe_insert(path, frame=f0 + 24)
        rb.friction = rb.friction                                       # (resets the cache)
    log(f"  first impacts: {sum(h is not None for h in hits)} chunks, median {np.median([h for h in hits if h is not None]) / FPS:.2f} s")
    sc.frame_set(1)
    run('damped')
    # rest pose exactly at frame 0, quaternions continuous
    for i, c in enumerate(chunks):
        loc[0, i] = c['cen']; rot[0, i] = (1, 0, 0, 0)
        for f in range(1, FRAMES + 1):
            if np.dot(rot[f, i], rot[f - 1, i]) < 0: rot[f, i] *= -1
    sp = np.array([t[0] for t in throws])
    log(f"  launch speeds {sp.min():.1f}..{sp.max():.1f} m/s (median {np.median(sp):.1f})")

    # tidy: remove the sim (the constraints first: freeing a body a constraint still holds crashes Bullet)
    sc.frame_set(1)
    for o in list(rbc.objects): bpy.data.objects.remove(o)
    bpy.data.collections.remove(rbc)
    bpy.context.view_layer.update()
    for ob in [c['ob'] for c in chunks] + [o for o, _, _ in colliders] + [anchor]:
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.ops.rigidbody.object_remove()
    bpy.ops.rigidbody.world_remove()
    bpy.data.objects.remove(anchor)

    # Bring the stragglers to rest: once a chunk is down (touching, slow for a few frames) it eases to a stop over
    # ~0.15 s instead of creeping on (Bullet has no rolling resistance, so a hull rocks and rolls down any slope).
    def touching(i, f, pad):
        p = Vector(loc[f, i]); g = G(p); h = height(g[0], g[2])
        return stree.find_nearest(p, chunks[i]['rad'] + pad)[0] is not None or (h is not None and g[1] - h < chunks[i]['rad'] + pad)

    def speeds(i, f):
        v = np.linalg.norm(loc[f, i] - loc[f - 1, i]) * FPS
        w = 2 * math.acos(min(1.0, abs(float(np.dot(rot[f, i], rot[f - 1, i]))))) * FPS
        return v, w
    eased = 0
    for i, c in enumerate(chunks):
        if hits[i] is None: continue
        fs = None
        for f in range(hits[i] + 6, FRAMES - 3):
            if all(speeds(i, k)[0] < 0.9 and speeds(i, k)[1] < 2.5 and touching(i, k, 0.12) for k in range(f, f + 4)):
                fs = f; break
        if fs is None:                     # still creeping at the end: stop it over the last half second
            fs = next((f for f in range(FRAMES - 24, FRAMES - 3)
                       if all(speeds(i, k)[0] < 1.5 and touching(i, k, 0.25) for k in range(f, f + 3))), None)
        if fs is None: continue
        v0 = (loc[fs, i] - loc[fs - 1, i]) * FPS
        q0, q1 = Quaternion(rot[fs - 1, i]), Quaternion(rot[fs, i])
        dq = q0.rotation_difference(q1)
        axis, ang = dq.axis, dq.angle
        if ang > math.pi: ang -= 2 * math.pi
        tau = 0.12
        for f in range(fs + 1, FRAMES + 1):
            k = tau * (1 - math.exp(-(f - fs) / FPS / tau))
            loc[f, i] = loc[fs, i] + v0 * k
            q = Quaternion(axis, ang * FPS * k) @ q1
            rot[f, i] = (q.w, q.x, q.y, q.z)
            if np.dot(rot[f, i], rot[f - 1, i]) < 0: rot[f, i] *= -1
        eased += 1
    log(f"  eased to rest: {eased}")

    # settle times; the lost (thrown over the rim)
    info = []
    for i, c in enumerate(chunks):
        g = G(Vector(loc[-1, i]))
        h = height(g[0], g[2])
        lost = bool(h is None or g[1] < h - 1.0)
        moving = 0
        for f in range(1, FRAMES + 1):
            dp = np.linalg.norm(loc[f, i] - loc[f - 1, i])
            dq = 2 * math.acos(min(1.0, abs(float(np.dot(rot[f, i], rot[f - 1, i])))))
            if dp > 0.004 or dq > 0.012: moving = f
        if not lost and moving >= FRAMES - 1:
            log(f"    {c['ob'].name} still moving at the end: {np.linalg.norm(loc[-1, i] - loc[-2, i]) * FPS:.2f} m/s at {g[0]:.1f},{g[1]:.1f},{g[2]:.1f}")
        if not lost:
            for f in range(moving + 1, FRAMES + 1): loc[f, i] = loc[moving, i]; rot[f, i] = rot[moving, i]
        info.append({'lost': lost, 'settle': round(moving / FPS, 3), 'end': [round(v, 3) for v in g]})
    still = [i for i, x in enumerate(info) if not x['lost'] and x['settle'] >= FRAMES / FPS - 0.05]
    dd = np.array([math.hypot(x['end'][0], x['end'][2]) for x in info if not x['lost']])
    log(f"  rest distance from the tor's centre: median {np.median(dd):.1f} m, 90% {np.percentile(dd, 90):.1f} m, max {dd.max():.1f} m;"
        f" on the stump: {sum(1 for x in info if not x['lost'] and x['end'][1] > G0 + 1.5)}")
    log(f"  settled: {sum(1 for x in info if not x['lost'])} on the stack (median {np.median([x['settle'] for x in info if not x['lost']]):.2f} s,"
        f" still moving at the end: {len(still)}), lost over the rim: {sum(x['lost'] for x in info)}")
    return loc, rot, info


def keyframe(chunks, loc, rot):
    """One action 'blast', a slot per chunk, a key per frame (linear)."""
    from bpy_extras import anim_utils
    act = bpy.data.actions.new('blast')
    frames = np.arange(FRAMES + 1, dtype=np.float64)
    for i, c in enumerate(chunks):
        ob = c['ob']
        ob.rotation_mode = 'QUATERNION'
        ob.location = Vector(loc[0, i]); ob.rotation_quaternion = Quaternion(rot[0, i])
        ad = ob.animation_data_create()
        slot = act.slots.new(id_type='OBJECT', name=ob.name)
        ad.action = act
        ad.action_slot = slot
        cb = anim_utils.action_ensure_channelbag_for_slot(act, slot)
        for path, arr, nd in (('location', loc[:, i], 3), ('rotation_quaternion', rot[:, i], 4)):
            for k in range(nd):
                fc = cb.fcurves.new(path, index=k)
                fc.keyframe_points.add(len(frames))
                co = np.empty(len(frames) * 2); co[0::2] = frames; co[1::2] = arr[:, k]
                fc.keyframe_points.foreach_set('co', co)
                fc.keyframe_points.foreach_set('interpolation', [1] * len(frames))      # LINEAR
                fc.update()
    return act


# ---------------------------------------------------------------------------------------------------------------------
# Boulders

def boulder(k, r):
    """A block thrown off the upper tiers: rounded and jointed as the tor's blocks, weathered and coloured as they are,
    one fresh fracture face where it tore off."""
    R = random.Random(500 + k)
    a, b, c = r * R.uniform(0.97, 1.03), r * R.uniform(0.86, 0.93), r * 0.85
    pe = R.uniform(3.0, 3.8)
    taper, lean = R.uniform(0.04, 0.12), R.uniform(-0.12, 0.12)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=72, v_segments=36, radius=1.0)
    ox, oy, oz = R.uniform(-40, 40), R.uniform(-5, 5), R.uniform(-40, 40)
    for v in bm.verts:
        d = v.co.normalized()
        t = (abs(d.x / a) ** pe + abs(d.y / b) ** pe + abs(d.z / c) ** pe) ** (-1 / pe)
        lump = 1 + 0.06 * fbm(d.x * 1.3 + ox, d.y * 1.3 + oy, d.z * 1.3 + oz, 3, 600 + k)
        v.co = d * t * lump
        if v.co.z < 0: v.co.z *= 1 - 0.1 * smooth(0.0, 1.0, -v.co.z / c)        # a flatter bed
        v.co.x *= 1 - taper * v.co.z / c; v.co.y *= 1 - taper * 0.7 * v.co.z / c   # narrower up top, and leaning
        v.co.x += lean * v.co.z
    # the fresh face: a plane taking a slice off one side, where it tore off the tor
    az = R.uniform(0, 2 * math.pi)
    fn = Vector((math.cos(az), math.sin(az), R.uniform(-0.2, 0.35))).normalized()
    fd = r * R.uniform(0.5, 0.6)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=fn * fd, plane_no=fn, clear_outer=True)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    ob = ob_from_bm(bm, f'tor_boulder_{k}')
    bm.free()
    apply_mod(ob, 'REMESH', mode='VOXEL', voxel_size=0.026, use_smooth_shade=True)
    me = ob.data
    co = get_co(me)
    nor = np.empty(len(co) * 3); me.vertices.foreach_get('normal', nor); nor = nor.reshape(-1, 3)
    blk = {'seed': 40.1 + k * 3.7, 'ytop': c, 'y0': -c + R.uniform(0.2, 0.6),
           'pitch': 1.1 + 0.4 * R.random(), 'phase': R.random(), 'sheet': 0.06, 'joint': 0.6}
    tone, warm = R.uniform(-0.04, 0.03), R.uniform(0.0, 1.0)
    ca_ = R.uniform(0, math.pi)
    cdir = (math.cos(ca_), math.sin(ca_))
    col = np.zeros((len(co), 4)); col[:, 3] = 1
    for i in range(len(co)):
        p = Vector(co[i]); n = Vector(nor[i])
        sd = p.dot(fn) - fd                                      # 0 on the fresh face
        gx, gy, gz = b2g(p); nx, ny, nz = b2g(n)
        if sd > -0.01 and n.dot(fn) > 0.55:
            # conchoidal ripples and grain on the fracture
            q = p - fn * p.dot(fn)
            d = -0.03 * fbm(q.x * 2.2 + ox, q.y * 2.2, q.z * 2.2 + oz, 3, 700 + k) - 0.008 * n3(q.x * 9, q.y * 9, q.z * 9, 701)
            co[i] += nor[i] * d
            cc = fresh_rgb(gx + ox, gy, gz + oz, 0.04)
            col[i, :3] = apply_soot(cc, 0.3 * smooth(0.25, 0.7, n3(q.x * 1.5, q.y * 1.5, q.z * 1.5, 702)))
            continue
        # weathered: the tor's own weathering (sheet joints, master joints, runnels, pans, grain) on a patch of it, and
        # at the boulder's own scale lumps, pitting and a crack or two
        d, groove = T['displace'](gx + ox, gy + oy, gz + oz, nx, ny, nz, blk)
        d += 0.05 * r * fbm(gx * 1.6 + ox, gy * 1.6 + oy, gz * 1.6 + oz, 3, 730 + k) + 0.012 * n3(gx * 10 + ox, gy * 10, gz * 10 + oz, 731 + k)
        dc, op = T['joint_set'](gx + ox, gy + oy, gz + oz, cdir, 1.7, 0.5, 740 + k)
        crack = (1 - smooth(0.0, 0.035, dc)) * op
        d -= 0.06 * crack + 0.025 * (1 - smooth(0.035, 0.3, dc)) ** 2 * op
        groove = max(groove, crack)
        edge = smooth(0.0, 0.07, -sd)                            # crisp where the fracture meets the skin
        co[i] += nor[i] * d * edge
        # colour: the tor's palette (rockpiles.js rockColor): grey granite, lichen on what faces up, darker beneath,
        # rain streaks down the sides
        l = 0.43 + tone + 0.06 * n3(gx * 0.4 + ox, gy * 0.4, gz * 0.4 + oz, 750 + k) + 0.03 * n3(gx * 1.9 + ox, gy * 1.9, gz * 1.9 + oz, 751 + k)
        cc = np.array([l * (1 + 0.06 * warm), l * (1 + 0.01 * warm), l * (1 - 0.06 * warm)])
        up = smooth(0.3, 0.85, ny)
        if up > 0:
            li = up * smooth(0.05, 0.3, fbm(gx * 1.1 + ox, gy * 1.1, gz * 1.1 + oz, 2, 752 + k)) * 0.75
            cc = cc * (1 - li) + np.array([0.7, 0.7, 0.62]) * li
            ly = up * smooth(0.45, 0.7, n3(gx * 2.2 + ox, gy * 2.2, gz * 2.2 + oz, 753 + k)) * 0.5
            cc = cc * (1 - ly) + np.array([0.64, 0.6, 0.4]) * ly
        streak = smooth(0.15, 0.55, n3(math.atan2(gz, gx) * r * 1.4, gy * 0.3, 0.5, 754 + k)) * (1 - abs(ny)) * 0.2
        cc = cc * (1 - 0.42 * smooth(-0.05, -0.6, ny)) * (1 - streak)
        col[i, :3] = cc * (1 - 0.42 * min(groove * edge, 1.0))
    me.vertices.foreach_set('co', co.ravel()); me.update()
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); ca.data.foreach_set('color', col.ravel())
    decimate_to(ob, BOULDER_TRIS)
    me.shade_smooth()
    ob['r'] = r
    return ob


# ---------------------------------------------------------------------------------------------------------------------

def sculpted_pieces():
    if os.environ.get('TORB_CACHE') and os.path.exists(CACHE):
        bpy.ops.wm.open_mainfile(filepath=CACHE)
        log('pieces from the cache')
    else:
        T['clear_scene']()
        T['sculpt_all']()
        bpy.ops.wm.save_as_mainfile(filepath=CACHE, copy=True)
        log('pieces sculpted')
    pieces = {}
    for ob in bpy.data.objects:
        if ob.name.startswith('tor_'): pieces[int(ob.name.rsplit('_', 1)[1])] = ob
    return pieces


def import_tor():
    """tor.glb as built: the intact tor's AO'd colours, and tor_far's source."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=TOR_GLB)
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    ob = new[0]
    for o in list(bpy.data.objects):
        if o not in before and o is not ob: bpy.data.objects.remove(o)
    ob.parent = None
    ob.matrix_world = Matrix.Identity(4)
    me = ob.data
    ca = me.color_attributes[0]
    if ca.domain != 'POINT' or ca.data_type != 'FLOAT_COLOR':
        bpy.context.view_layer.objects.active = ob
        me.color_attributes.active_color = ca
        bpy.ops.geometry.color_attribute_convert(domain='POINT', data_type='FLOAT_COLOR')
        ca = me.color_attributes.active_color
    ca.name = 'Col'
    for o in me.uv_layers[:]: me.uv_layers.remove(o)
    me.materials.clear()
    ob.name = 'tor_intact'; me.name = 'tor_intact'
    return ob


def take_colours(dst, src_ob):
    """Copy the intact tor's colours onto a piece (its vertices are the same as tor.glb's, nearest wins)."""
    sco = get_co(src_ob.data); sc = get_cols(src_ob.data)
    kd = kdtree.KDTree(len(sco))
    for i, v in enumerate(sco): kd.insert(v, i)
    kd.balance()
    co = get_co(dst.data); c = get_cols(dst.data)
    far = 0
    for i in range(len(co)):
        _, j, d = kd.find(co[i])
        c[i] = sc[j]
        if d > 1e-3: far += 1
    set_cols(dst.data, c)
    return far


def main():
    pieces = sculpted_pieces()
    sc = bpy.context.scene
    L = layout(pieces)
    log('blast', json.dumps(L))
    intact = import_tor()
    gob = T['ground_object']('ground_ao')

    # ---- the stump: tier 0 and the fallen boulders, cut by the break ----
    stump_parts = [pieces[i] for i in STUMP_IDS]
    body0 = [pieces[i] for i in (0, 1, 2, 3)]
    xs = [v for o in body0 for v in (min(b[0] for b in o.bound_box), max(b[0] for b in o.bound_box))]
    zs = [v for o in body0 for v in (min(-b[1] for b in o.bound_box), max(-b[1] for b in o.bound_box))]
    cut, brk = cutter(L, ((min(xs) - 0.6, min(zs) - 0.6), (max(xs) + 0.6, max(zs) + 0.6)))
    for i in (0, 1, 2, 3):
        pieces[i] = boolean_diff(pieces[i], cut)
    bpy.data.objects.remove(cut)
    stump_parts = [pieces[i] for i in STUMP_IDS]
    ao_lo = {}                    # fresh faces take less AO (they're pale and lit into the cracks)
    # fresh faces: on the break surface
    for o in stump_parts[:4]:
        me = o.data
        co = get_co(me)
        on = np.zeros(len(co), bool)
        for i in range(len(co)):
            hit = brk.find_nearest(Vector(co[i]), 0.01)
            on[i] = hit[0] is not None and hit[3] < 0.004
        c = get_cols(me) if 'Col' in me.color_attributes else None
        if c is None or c.shape[0] != len(co):
            ensure_col(me); c = get_cols(me)
        # a face is fresh if all its corners are on the break: its vertices take the fresh colour
        fresh_v = np.zeros(len(co), bool)
        for p in me.polygons:
            if all(on[v] for v in p.vertices):
                for v in p.vertices: fresh_v[v] = True
        tones = {}
        for i in range(len(co)):
            g = b2g(co[i])
            if fresh_v[i]:
                cell = cell_plane(g[0], g[2], 1.05, 83, 0, 0)[1]
                key = (round(cell[0], 3), round(cell[1], 3))
                tone = tones.setdefault(key, rng.uniform(-0.06, 0.06))
                cc = fresh_rgb(*g, tone)
            else:
                cc = c[i, :3]
            k = soot_k(g, L, 1.0 if fresh_v[i] else 0.4, False) * (1.0 if fresh_v[i] else 0.6 * smooth(G0 + 2.0, G0 + 3.6, g[1]))
            c[i, :3] = apply_soot(np.array(cc), k)
        set_cols(me, c)
        ao_lo[o.name] = np.where(fresh_v, 0.6, 0.42)
        log(f"  {o.name}: {fresh_v.sum()} fresh vertices of {len(co)}")

    # rubble round its foot (inside the outline the walls are fitted to) and on top
    blocks = src['blocks']
    rOut = outline_of([b for b in blocks if b['kind'] == 'body'], 0.0, 0.0, 96)
    bouls = []
    for b in blocks[F['nBody']:]:
        p = np.array(b['pos']).reshape(-1, 3)
        cx, cz = float((p[:, 0].min() + p[:, 0].max()) / 2), float((p[:, 2].min() + p[:, 2].max()) / 2)
        bouls.append({'cx': cx, 'cz': cz, 'r': outline_of([b], cx, cz, 32)})
    stump_tree = bvh_of(stump_parts)
    ground_tree = bvh_of([gob])
    rub = rubble(stump_tree, ground_tree, L, rOut, bouls)

    # AO: without the upper tiers, with the ground
    for o in stump_parts: ensure_col(o.data)
    for o in (intact,) + tuple(pieces[i] for i in UPPER_IDS): o.hide_render = True
    ao_lo[rub.name] = np.full(len(rub.data.vertices), 0.55)
    T['bake_ao'](stump_parts + [rub], lo=ao_lo)
    stump = T['join'](stump_parts + [rub], 'tor_stump')
    log(f"  stump joined: {tris(stump)} tris")
    n = decimate_to(stump, STUMP_TRIS)
    stump.data.shade_smooth()
    box_uv(stump)
    log(f"tor_stump: {n} tris")

    # ---- far stand-ins ----
    far = dup(intact, 'tor_far')
    for k in list(far.keys()): del far[k]
    log(f"tor_far: {decimate_to(far, TOR_FAR_TRIS)} tris")
    far.data.shade_smooth(); box_uv(far)
    sfar = dup(stump, 'tor_stump_far')
    for o in sfar.data.uv_layers[:]: sfar.data.uv_layers.remove(o)
    log(f"tor_stump_far: {decimate_to(sfar, STUMP_FAR_TRIS)} tris")
    sfar.data.shade_smooth(); box_uv(sfar)

    # ---- chunks off the upper tiers, with the intact tor's colours ----
    upper = [pieces[i] for i in UPPER_IDS]
    for o in upper:
        ensure_col(o.data)
        far_n = take_colours(o, intact)
        if far_n: log(f"  {o.name}: {far_n} vertices without an exact match in tor.glb")
    chunks = make_chunks(upper, L, lambda x, z: hb(x, z, L))
    for o in upper: bpy.data.objects.remove(o)

    # ---- the sim ----
    ground_rb, height = stack_ground()
    seq = sequoia_collider()
    coll_stump = dup(stump, 'stump_collider')
    decimate_to(coll_stump, 25000)
    colliders = [(ground_rb, 1.4, 0.5), (coll_stump, 0.8, 0.65)] + ([(seq, 0.7, 0.4)] if seq else [])
    for o in (stump, far, sfar, intact, gob): o.hide_render = True
    loc, rot, info = simulate(chunks, L, colliders, height)
    for i, c in enumerate(chunks):
        c['ob']['settle'] = float(info[i]['settle'])
        c['ob']['lost'] = info[i]['lost']
        c['ob']['r'] = round(c['rad'], 3)
    act = keyframe(chunks, loc, rot)
    for o in colliders: bpy.data.objects.remove(o[0])

    # ---- boulders ----
    bould = [boulder(k, r) for k, r in enumerate(BOULDER_R)]
    # AO: each on its own, sunk as the game sits them (centre 0.35 r above the ground)
    for o in bould + [c['ob'] for c in chunks] + [stump, far, sfar]: o.hide_render = True
    for k, o in enumerate(bould):
        o.hide_render = False
        pl = link(bpy.data.objects.new('_bed', bpy.data.meshes.new('_bed')))
        bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=4 * BOULDER_R[k]); bm.to_mesh(pl.data); bm.free()
        pl.location = (0, 0, -0.35 * BOULDER_R[k])
        T['bake_ao']([o], dist=0.9, samples=48, lo=0.5)
        bpy.data.objects.remove(pl)
        box_uv(o)
        o.hide_render = True
        log(f"{o.name}: {tris(o)} tris")

    # ---- BLAST ----
    e = link(bpy.data.objects.new('BLAST', None))
    e.location = V(*L['center'])
    e['center'] = L['center']; e['charges'] = json.dumps(L['charges']); e['launch'] = json.dumps(L['launch'])
    e['fps'] = FPS; e['frames'] = FRAMES; e['duration'] = FRAMES / FPS; e['chunks'] = len(chunks)
    e['tor_frame'] = json.dumps(F)

    # ---- export ----
    sc.frame_start, sc.frame_end, sc.frame_current = 0, FRAMES, 0
    sc.render.fps = FPS
    keep = [stump, sfar, far, e] + [c['ob'] for c in chunks] + bould
    for o in list(bpy.data.objects):
        if o not in keep: bpy.data.objects.remove(o)
    for a in list(bpy.data.actions):
        if a.name != 'blast': bpy.data.actions.remove(a)
    for o in keep:
        if o.type == 'MESH':
            o.data.materials.clear()
            ensure_col(o.data)
    bpy.ops.object.select_all(action='DESELECT')
    for o in keep: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_extras=True,
                              export_materials='NONE', export_vertex_color='ACTIVE', export_normals=True,
                              export_texcoords=True, export_yup=True, export_apply=False,
                              export_animations=True, export_animation_mode='ACTIONS', export_merge_animation='ACTION',
                              export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=False,
                              export_anim_slide_to_zero=False, export_frame_range=True, export_bake_animation=False)
    fix_glb(OUT_GLB, {'BLAST': {'center': L['center'], 'charges': L['charges'], 'launch': L['launch'], 'fps': FPS,
                                'frames': FRAMES, 'duration': FRAMES / FPS, 'chunks': len(chunks), 'tor_frame': json.dumps(F)}})
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    log(f"-> {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1e6:.2f} MB), {len(chunks)} chunks, built in {time.time() - T_START:.0f} s")
    print('TOR_BLAST_RESULT', json.dumps({'chunks': len(chunks), 'mb': round(os.path.getsize(OUT_GLB) / 1e6, 2),
                                          'seconds': round(time.time() - T_START), 'lost': sum(x['lost'] for x in info)}))
    if RENDER_DIR:
        render_previews(stump, chunks, bould, loc, rot, L)


def fix_glb(path, extras):
    """Make sure there is exactly one clip named 'blast' (merging if the exporter split it) and no scale channels, and
    write the BLAST extras as real arrays."""
    with open(path, 'rb') as fh: data = fh.read()
    magic, ver, total = struct.unpack_from('<III', data, 0)
    jl, jt = struct.unpack_from('<II', data, 12)
    js = json.loads(data[20:20 + jl].decode('utf-8'))
    rest = data[20 + jl:]
    for nd in js['nodes']:
        if nd.get('name') in extras: nd['extras'] = extras[nd['name']]
    anims = js.get('animations', [])
    ch, sm = [], []
    for a in anims:
        base = len(sm)
        sm.extend(a['samplers'])
        for c in a['channels']:
            if c['target']['path'] == 'scale': continue
            c = dict(c); c['sampler'] += base; ch.append(c)
    # drop unused samplers (scale) by reindexing
    used = sorted({c['sampler'] for c in ch})
    remap = {o: n for n, o in enumerate(used)}
    for c in ch: c['sampler'] = remap[c['sampler']]
    js['animations'] = [{'name': 'blast', 'channels': ch, 'samplers': [sm[o] for o in used]}]
    out = json.dumps(js, separators=(',', ':')).encode('utf-8')
    out += b' ' * ((4 - len(out) % 4) % 4)
    blob = struct.pack('<II', len(out), 0x4E4F534A) + out + rest
    with open(path, 'wb') as fh: fh.write(struct.pack('<III', magic, ver, 12 + len(blob)) + blob)
    log(f"  glb: {len(anims)} animation(s) -> 1 'blast', {len(ch)} channels")


# ---------------------------------------------------------------------------------------------------------------------
# Previews (Cycles): the stump from the sequoia camera, the blast, the boulders

def render_previews(stump, chunks, bould, loc, rot, L):
    os.makedirs(RENDER_DIR, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.6
    w = bpy.data.worlds.new('sky'); sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.5, 0.65, 0.95, 1); bg.inputs[1].default_value = 0.45
    sun = link(bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')))
    sun.data.energy = 3.2; sun.data.angle = 0.02
    sun.rotation_euler = Euler((math.radians(50), math.radians(10), math.radians(200)))

    def vc_mat(name, tex=True, base=None):
        m = bpy.data.materials.new(name); m.use_nodes = True
        nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = 0.92
        if base is not None:
            bsdf.inputs['Base Color'].default_value = base
            return m
        at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'Col'
        mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 40; nz.inputs['Detail'].default_value = 8
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (0.62, 0.62, 0.62, 1)
        ramp.color_ramp.elements[1].position = 0.65; ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(at.outputs['Color'], mul.inputs[6]); nt.links.new(ramp.outputs['Color'], mul.inputs[7])
        nt.links.new(mul.outputs[2], bsdf.inputs['Base Color'])
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25
        nt.links.new(nz.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        return m

    rock = vc_mat('rock')
    grass = vc_mat('grass', base=(0.16, 0.22, 0.08, 1))
    gnd, _ = stack_ground()
    gnd.data.materials.append(grass)
    for o in [stump] + [c['ob'] for c in chunks] + bould:
        o.data.materials.clear(); o.data.materials.append(rock)
    stump.hide_render = False
    for o in bould: o.hide_render = True

    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    sc.camera = cam
    cam.data.sensor_fit = 'VERTICAL'

    def look(pos_g, at_g, fov):
        cam.location = V(*pos_g)
        d = V(*at_g) - cam.location
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam.data.angle_y = math.radians(fov)

    def shot(name):
        sc.render.filepath = os.path.join(RENDER_DIR, name)
        bpy.ops.render.render(write_still=True)
        log('  rendered', name)

    fx, fz = F['x'], F['z']
    seqcam = ((-316.2 - fx, 18.2, 187.1 - fz), (-329.3 - fx, 12.5, 191.6 - fz), 72)

    def pose(f):
        sc.frame_set(f)

    for c in chunks: c['ob'].hide_render = True
    stump.hide_render = True
    tor = import_tor(); tor.data.materials.append(rock)
    look(*seqcam); shot('tor_intact_cam.png')
    bpy.data.objects.remove(tor)
    stump.hide_render = False
    look(*seqcam); shot('tor_stump_cam.png')
    look((8.0, 19.5, 10.0), (0.5, 9.8, -0.5), 50); shot('tor_stump_top.png')
    look((-14.0, 9.0, -12.0), (0.0, 8.0, 0.0), 55); shot('tor_stump_back.png')
    for c in chunks: c['ob'].hide_render = False
    for f in (0, 3, 8, 16, 30, 60, 180):
        pose(f)
        look(*seqcam); shot(f'tor_blast_f{f:03d}.png')
    pose(180)
    look((30.0, 30.0, -30.0), (4.0, 6.0, 2.0), 60); shot('tor_blast_end_wide.png')
    # the far stand-ins, side by side from a distance (intact far | stump far | stump near)
    for c in chunks: c['ob'].hide_render = True
    fars = [o for o in bpy.data.objects if o.name in ('tor_far', 'tor_stump_far')]
    for o in fars:
        o.hide_render = False; o.data.materials.clear(); o.data.materials.append(rock)
        o.location = V(0, 0, -24 if o.name == 'tor_far' else 24)
    look((75.0, 22.0, 0.0), (0.0, 10.0, 0.0), 32); shot('tor_far.png')
    for o in fars: o.hide_render = True
    # boulders in a row
    stump.hide_render = True; gnd.hide_render = True
    for c in chunks: c['ob'].hide_render = True
    for k, o in enumerate(bould):
        o.hide_render = False
        o.location = V(-6 + k * 3.0, 0.35 * BOULDER_R[k], 30.0)
    pl = link(bpy.data.objects.new('_pl', bpy.data.meshes.new('_pl')))
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30); bm.to_mesh(pl.data); bm.free()
    pl.location = V(0, 0, 30); pl.data.materials.append(grass)
    look((0.0, 4.2, 20.0), (0.0, 0.3, 30.0), 42); shot('tor_boulders.png')
    sun.rotation_euler = Euler((math.radians(50), math.radians(10), math.radians(20)))
    look((0.0, 3.6, 40.0), (0.0, 0.3, 30.0), 42); shot('tor_boulders_back.png')


main()
