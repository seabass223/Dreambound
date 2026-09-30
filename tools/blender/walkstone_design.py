"""Dreambound: limestone stepping stones (the Home stack's path from the dome door round to the deck track; the game
lays them: src/world/walkway.js). Built with dbkit.py by build_walkstones.py.

Seven stones, each in a layer of its own ('s0'..'s6'), all centred on the origin: weathered flags split from a bed of
limestone, so their outlines are a few straight-ish breaks with chipped edges between, their rims rounded off by the
weather, their tops a little domed and uneven. From a big slab to two small ones. y = 0 is the rim; the top rises to
about 1.5 cm over it and the body runs 9 cm down (the game sinks them nearly flush with the ground).

Textures (one seamless 1 m tile, the stones' UVs are metres across their tops): walkstone_albedo.png (buff and grey
limestone, mottled, with pits, a scatter of shell fragments and crusts of lichen), walkstone_normal.png and
walkstone_rough.png (worn smooth on top, with a little sheen; rough in the pits and the lichen).
"""
MODELS = ROOT + '/public/models/'
TMP = os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_walkstones')

MATS.update({'limestone': ((0.72, 0.69, 0.62), 0.7)})
NO_BAKE.add('limestone')

# (half length, width / length, corners, seed): big to small.
STONES = [(0.33, 0.78, 6, 11), (0.29, 0.88, 7, 12), (0.26, 0.7, 5, 13), (0.24, 0.92, 6, 14), (0.21, 0.8, 6, 15),
          (0.16, 0.85, 5, 16), (0.13, 0.9, 5, 17)]
DEPTH = 0.09

def outline(a, aspect, n, rs):
    """An angular outline: n corners round an ellipse (their angles and radii jittered), the straight-ish breaks between
    them bowed and chipped a little, as (x, z) points in order round it."""
    b = a * aspect
    ph = rs.uniform(0, 2 * PI)
    corners = []
    for k in range(n):
        t = ph + 2 * PI * (k + rs.uniform(-0.3, 0.3)) / n
        f = rs.uniform(0.86, 1.06)
        corners.append((a * math.cos(t) * f, b * math.sin(t) * f))
    pts = []
    for k in range(n):
        (x0, z0), (x1, z1) = corners[k], corners[(k + 1) % n]
        L = math.hypot(x1 - x0, z1 - z0)
        nx, nz = (z1 - z0) / L, -(x1 - x0) / L                  # outward, for a counter-clockwise outline
        m = max(3, int(L / 0.045))
        bow = rs.uniform(-0.01, 0.018)                          # a break is rarely dead straight
        for j in range(m):
            t = j / m
            chip = 0.0 if j == 0 else rs.uniform(-0.009, 0.004)
            s = bow * math.sin(PI * t) + chip
            pts.append((x0 + (x1 - x0) * t + nx * s, z0 + (z1 - z0) * t + nz * s))
    return pts

def stone(i):
    a, aspect, n, seed = STONES[i]
    rs = random.Random(seed)
    out = outline(a, aspect, n, rs)
    cx = sum(p[0] for p in out) / len(out)
    cz = sum(p[1] for p in out) / len(out)
    out = [(x - cx, z - cz) for (x, z) in out]
    def inset(pts, d):
        res = []
        for (x, z) in pts:
            r = math.hypot(x, z) or 1.0
            k = max(0.0, (r - d) / r)
            res.append((x * k, z * k))
        return res
    # Rings from the buried base up over the weathered rim to the domed top: (inset, height, jitter).
    rings = [(-0.02, -DEPTH, 0.0), (0.0, -0.03, 0.002), (0.004, -0.008, 0.002), (0.013, 0.002, 0.0015),
             (0.03, 0.008, 0.0015), (0.06, 0.011, 0.002), (a * 0.45, 0.014, 0.002)]
    bm = bmesh.new()
    rows = []
    for (d, y, j) in rings:
        row = []
        for (x, z) in inset(out, d):
            row.append(bm.verts.new((x, y + rs.uniform(-j, j), z)))
        rows.append(row)
    top = bm.verts.new((rs.uniform(-0.01, 0.01), 0.015 + rs.uniform(-0.002, 0.002), rs.uniform(-0.01, 0.01)))
    m = len(out)
    for r in range(len(rows) - 1):
        lo, hi = rows[r], rows[r + 1]
        for k in range(m):
            bm.faces.new((lo[k], lo[(k + 1) % m], hi[(k + 1) % m], hi[k]))
    for k in range(m):
        bm.faces.new((rows[-1][k], rows[-1][(k + 1) % m], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Faces point out: if the top fan faces down, flip everything.
    f = next(f for f in bm.faces if top in f.verts)
    f.normal_update()
    if f.normal.y < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    # Stained by the soil below the rim; the top clean.
    col = lambda co: tuple(0.45 + 0.55 * min(1.0, max(0.0, (co.y + 0.03) / 0.035)) for _ in range(3))
    ou, ov = rs.uniform(0, 1), rs.uniform(0, 1)
    with layer('s%d' % i):
        emit(bm, 'limestone', smooth=True, uvfn=lambda co, nrm: (co.x + ou, -co.z + ov), colfn=col)

def build_all():
    for i in range(len(STONES)):
        stone(i)
    return realize()


# ============================================================================ the limestone tile
def _mix(nt, fac, a, b):
    mx = node(nt, 'ShaderNodeMix', props={'data_type': 'RGBA', 'blend_type': 'MIX'})
    for sock, v in ((0, fac), (6, a), (7, b)):
        if hasattr(v, 'is_output'):
            nt.links.new(v, mx.inputs[sock])
        elif isinstance(v, (int, float)):
            mx.inputs[sock].default_value = v
        else:
            mx.inputs[sock].default_value = (v[0], v[1], v[2], 1.0)
    return mx.outputs[2]

def _ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(fac, r.inputs['Fac'])
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for (pos, c) in stops[1:-1]:
        e = els.new(pos)
        e.color = (*c, 1)
    return r.outputs['Color']

def _noise4(nt, vec, w, scale, detail=6.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '4D'}, Vector=vec, W=w, Scale=scale,
                Detail=detail, Roughness=rough, Distortion=distort).outputs['Fac']

def _vor4(nt, vec, w, scale, feature='F1', rand=1.0):
    return node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '4D', 'feature': feature}, Vector=vec, W=w,
                Scale=scale, Randomness=rand)

def _mapr(nt, v, a, b, lo=0.0, hi=1.0):
    return node(nt, 'ShaderNodeMapRange', props={'clamp': True}, Value=v, **{'From Min': a, 'From Max': b, 'To Min': lo, 'To Max': hi}).outputs[0]

def lime_fields(nt, vec, w):
    """The stone's fields, each 0..1: mottle, grey weathering, pits (pores and bigger solution pits), shell fragments,
    lichen crusts (and which kind), worn smooth."""
    mottle = _noise4(nt, vec, w, 2.6, 7.0, 0.62, 0.5)
    grey = _mapr(nt, _noise4(nt, vec, w, 1.4, 4.0, 0.55, 0.8), 0.46, 0.64)
    pores = math_node(nt, 'MULTIPLY', _mapr(nt, _vor4(nt, vec, w, 130.0).outputs['Distance'], 0.1, 0.03),
                      _mapr(nt, _noise4(nt, vec, w, 6.0, 2.0), 0.35, 0.55))
    pits = math_node(nt, 'MULTIPLY', _mapr(nt, _vor4(nt, vec, w, 24.0).outputs['Distance'], 0.12, 0.05),
                     _mapr(nt, _noise4(nt, vec, w, 3.0, 2.0), 0.42, 0.56))
    pits = math_node(nt, 'MAXIMUM', pits, math_node(nt, 'MULTIPLY', pores, 0.8))
    sv = _vor4(nt, vec, w, 14.0, 'F1')
    shells = math_node(nt, 'MULTIPLY', _mapr(nt, sv.outputs['Distance'], 0.1, 0.05),
                       _mapr(nt, node(nt, 'ShaderNodeSeparateColor', Color=sv.outputs['Color']).outputs[0], 0.78, 0.84))
    # Lichen: round crusts, in clusters.
    lv = _vor4(nt, vec, w, 9.0, 'F1')
    rad = math_node(nt, 'MULTIPLY', node(nt, 'ShaderNodeSeparateColor', Color=lv.outputs['Color']).outputs[1], 0.35)
    crust = _mapr(nt, math_node(nt, 'SUBTRACT', lv.outputs['Distance'], rad), 0.0, -0.04)
    lichen = math_node(nt, 'MULTIPLY', crust, _mapr(nt, _noise4(nt, vec, w, 1.7, 3.0), 0.46, 0.58))
    kind = node(nt, 'ShaderNodeSeparateColor', Color=lv.outputs['Color']).outputs[2]
    worn = _mapr(nt, _noise4(nt, vec, w, 1.8, 3.0, 0.5), 0.4, 0.6)
    return mottle, grey, pits, shells, lichen, worn, kind

def make_lime(nt, vec, w):
    mottle, grey, pits, shells, lichen, worn, kind = lime_fields(nt, vec, w)
    col = _ramp(nt, mottle, [(0.28, srgb(158, 150, 132)), (0.45, srgb(190, 181, 160)), (0.62, srgb(212, 204, 185)), (0.75, srgb(200, 194, 178))])
    col = _mix(nt, math_node(nt, 'MULTIPLY', grey, 0.6), col, srgb(128, 126, 121))
    fine = _mapr(nt, _noise4(nt, vec, w, 70.0, 2.0, 0.5), 0.5, 0.75)
    col = _mix(nt, math_node(nt, 'MULTIPLY', fine, 0.2), col, srgb(110, 102, 90))
    fleck = _mapr(nt, _noise4(nt, vec, w, 160.0, 1.0, 0.5), 0.66, 0.72)
    col = _mix(nt, math_node(nt, 'MULTIPLY', fleck, 0.6), col, srgb(62, 58, 52))
    col = _mix(nt, math_node(nt, 'MULTIPLY', shells, 0.75), col, srgb(236, 231, 216))
    col = _mix(nt, math_node(nt, 'MULTIPLY', pits, 0.9), col, srgb(72, 66, 56))
    # Lichen: mostly pale grey-green, some yellow-orange, a few near black.
    lcol = _ramp(nt, kind, [(0.0, srgb(58, 58, 52)), (0.18, srgb(58, 58, 52)), (0.2, srgb(186, 190, 170)), (0.78, srgb(186, 190, 170)),
                            (0.8, srgb(204, 158, 82)), (1.0, srgb(204, 158, 82))])
    return _mix(nt, math_node(nt, 'MULTIPLY', lichen, 0.85), col, lcol)

def make_lime_height(nt, vec, w):
    mottle, grey, pits, shells, lichen, worn, kind = lime_fields(nt, vec, w)
    h = math_node(nt, 'ADD', 0.5, math_node(nt, 'MULTIPLY', mottle, 0.25))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', pits, 0.35))
    h = math_node(nt, 'ADD', h, math_node(nt, 'MULTIPLY', shells, 0.06))
    h = math_node(nt, 'ADD', h, math_node(nt, 'MULTIPLY', lichen, 0.05))
    h = math_node(nt, 'ADD', h, math_node(nt, 'MULTIPLY', _noise4(nt, vec, w, 40.0, 3.0, 0.6), 0.05))
    return node(nt, 'ShaderNodeCombineColor', Red=h, Green=h, Blue=h).outputs[0]

def make_lime_rough(nt, vec, w):
    """Roughness: worn smooth (a little sheen) on the broad tops, rough in the pits and under the lichen."""
    mottle, grey, pits, shells, lichen, worn, kind = lime_fields(nt, vec, w)
    r = math_node(nt, 'SUBTRACT', 0.74, math_node(nt, 'MULTIPLY', worn, 0.26))
    r = math_node(nt, 'ADD', r, math_node(nt, 'MULTIPLY', pits, 0.25))
    r = math_node(nt, 'ADD', r, math_node(nt, 'MULTIPLY', lichen, 0.2))
    r = math_node(nt, 'MINIMUM', r, 0.98)
    return node(nt, 'ShaderNodeCombineColor', Red=r, Green=r, Blue=r).outputs[0]

def bake_all():
    t0 = time.time()
    os.makedirs(TMP, exist_ok=True)
    bake_tile(MODELS + 'walkstone_albedo.png', make_lime, 1024)
    h = bake_tile(os.path.join(TMP, 'walkstone_height.png'), make_lime_height, 1024, colorspace='Non-Color')
    normal_from_height(MODELS + 'walkstone_normal.png', h[:, :, 0], strength=6.0)
    bake_tile(MODELS + 'walkstone_rough.png', make_lime_rough, 512, colorspace='Non-Color')
    return {'textures_s': round(time.time() - t0, 1)}
