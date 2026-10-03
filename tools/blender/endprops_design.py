# Dreambound: the End stack's last props (src/props/pedestal.js places them; src/world/stacks/end.js picks the spot).
# Executed inside dbkit.py's namespace by build_endprops.py.
#
# The pedestal. Frame: origin on the axis at the top of its steel bezel, y up, +z toward the player coming from the
# landing (the button panel faces that way), x across. A square hole in the cap (the game cuts it: META hole_half) holds
# a steel bezel flush round it ('BEZEL', a part, so the game can lay it on the ground's slope: a flange with
# countersunk bolts, a skirt down into the earth, a short collar down the opening) and below it a plumb, dark square
# shaft, SHAFT deep. Out of the shaft stands the column ('COLUMN', a part, so the game sinks it whole): a darker plinth,
# a polished band, the gunmetal shaft of the column with a black glass strip down its front and vents at the back, and
# a cap cut at SLOPE toward the front carrying a black glass panel, a polished ring, and a chrome collar round the red
# domed button ('BUTTON', a part inside COLUMN, pressed along its axis).
#
# The light shafts ('SHAFTS', a part in its own frame: origin at the centre of the End aperture, on the cap): long
# tapered open cones rising and splaying out of the pit, uv.x = beam index + the fraction round it, v along the beam
# (glTF's v: 1 at the base .. 0 at the top; the game turns it round), the vertex colour (weight, phase, 1) per beam.
# The game draws them with its own shader.
#
# Materials: 'steel' (the bezel: endprops_steel.png, a worn-steel tile made here, with its normal map, and the AO
# atlas endprops_ao.png), 'shaft' and 'collar' (the shaft's lining and the bezel's collar, their tint falling to black
# with depth; the bolts' sockets), 'paint' (the column's gunmetal paint), 'panel' (black glass), 'chrome', 'button'
# (red), 'beam' (the light shafts).
# Named empties: META (sizes), TOP (the cap's centre, at rest), BUTTON_TOP (the dome's crown), HIT (the press volume's
# centre; hit_w, hit_h, hit_d).

import numpy as np

MODELS = ROOT + '/public/models/'

HC = 0.17                    # the column's half width
CH = 0.028                   # its vertical edges' chamfer
OPEN = 0.21                  # the bezel's opening (half): the column slides through it
FLANGE = 0.37                # the flange's outer edge (half)
SKIRT = 0.4                  # the skirt down into the earth (half), under the flange's chamfer
HOLE = 0.31                  # the hole cut in the cap (half): hidden under the flange
COLLAR = -0.14               # the bezel's collar reaches this far down the opening
SHAFT = 2.1                  # the shaft's depth below the bezel's top
WALL = 0.03                  # its lining's thickness
BASE = -0.32                 # the column's foot (in the shaft at rest)
TOP_F = 0.94                 # the cap's front edge above the bezel
SLOPE = math.radians(30)     # the cap's tilt toward the front
SINK = 1.72                  # how far the column sinks (its top ends half a metre down, in the dark)
PLINTH = (0.183, 0.12)       # the plinth's half width and its top

MATS.update({
    'steel': (srgb(122, 120, 116), 0.55), 'shaft': (srgb(30, 30, 31), 0.9), 'collar': (srgb(30, 30, 31), 0.9),
    'paint': (srgb(46, 51, 58), 0.45),
    'panel': (srgb(8, 9, 10), 0.12), 'chrome': (srgb(214, 218, 224), 0.1), 'button': (srgb(170, 18, 12), 0.25),
    'beam': ((1.0, 0.9, 0.7), 1.0),
})
NO_BAKE = {'chrome', 'button', 'beam', 'collider'}
BAKE_MATS = {'steel', 'shaft', 'collar', 'paint', 'panel'}


def top_y(z):
    """The cap's plane (its underside, on the column) at depth z."""
    return TOP_F + (HC - z) * math.tan(SLOPE)


def octagon(h, c):
    """A square of half width h with its corners chamfered by c, counter-clockwise seen from above (x, z)."""
    return [(h, -h + c), (h, h - c), (h - c, h), (-h + c, h), (-h, h - c), (-h, -h + c), (-h + c, -h), (h - c, -h)]


def prism(mat, outline, y0, y1, tint=WHITE):
    """An upright prism over an (x, z) outline from y0 to y1 (numbers, or functions of z: slanted ends)."""
    at = lambda y, z: y(z) if callable(y) else y
    bm = bmesh.new()
    bot = [bm.verts.new((x, at(y0, z), z)) for (x, z) in outline]
    tv = [bm.verts.new((x, at(y1, z), z)) for (x, z) in outline]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], tv[j], tv[i]))
    bm.faces.new(list(reversed(tv)))
    bm.faces.new(bot)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit(bm, mat, tint=tint)


def plane_frame(lx, lz, up=0.0):
    """A transform onto the slope the cap sits on (the column's top): local x across, local y along its normal, local z
    down the slope toward the front; (lx, lz) in the plane from the middle, `up` off it."""
    return xf(0.0, top_y(0.0), 0.0, rx=SLOPE) @ xf(lx, up, lz)


CAP_T = 0.022                # the cap's thickness


# ============================================================================ bezel and shaft
def tube_in(half, y0, y1, mat, colfn=None):
    """The four walls of a square shaft (half width `half`) from y0 down to y1, facing in."""
    for (ax, s) in ((0, 1), (0, -1), (2, 1), (2, -1)):
        if ax == 0:
            pts = [(s * half, y0, -half), (s * half, y0, half), (s * half, y1, half), (s * half, y1, -half)]
        else:
            pts = [(-half, y0, s * half), (half, y0, s * half), (half, y1, s * half), (-half, y1, s * half)]
        bm = bmesh.new()
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        bm.normal_update()
        inward = Vector((-s, 0, 0)) if ax == 0 else Vector((0, 0, -s))
        if f.normal.dot(inward) < 0:
            f.normal_flip()
        emit(bm, mat, colfn=colfn, tile=0.5)


# Down the shaft the lining darkens to black.
DARK = lambda co: (lambda k: (k, k, k))(0.02 + 0.98 * (1.0 - min(1.0, max(0.0, -co[1] / 0.7))) ** 2)


def build_bezel():
    # The bezel is a part ('BEZEL'), so the game can lay it on the ground's slope (a few degrees on the End's cap): the
    # flange, its bolts and a short collar under it. The deep shaft stays plumb (the column sinks straight down it);
    # its top overlaps the collar's foot, a little wider, so they meet however the bezel leans.
    part('BEZEL', (0, 0, 0))
    with into('BEZEL'):
        def ring(h0, h1, y0, y1, mat, tint=WHITE):
            """A square frame band from half width h0 (at height y0) to h1 (at y1): one quad per side, mitred corners
            (each quad faces up and out, or in toward the opening for the inner chamfer: by the corners' order)."""
            bm = bmesh.new()
            c0 = [(h0, h0), (-h0, h0), (-h0, -h0), (h0, -h0)]
            c1 = [(h1, h1), (-h1, h1), (-h1, -h1), (h1, -h1)]
            a = [bm.verts.new((x, y0, z)) for (x, z) in c0]
            b = [bm.verts.new((x, y1, z)) for (x, z) in c1]
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new((a[i], a[j], b[j], b[i]))
            emit(bm, mat, tint=tint, recalc=False)
        # The flange: its top at y = 0, the inner edge chamfered into the opening, the outer edge chamfered down to a
        # skirt into the earth.
        ring(OPEN + 0.012, FLANGE - 0.02, 0.0, 0.0, 'steel')
        ring(OPEN, OPEN + 0.012, -0.012, 0.0, 'steel')
        ring(FLANGE - 0.02, SKIRT, 0.0, -0.03, 'steel')
        ring(SKIRT, SKIRT, -0.03, -0.2, 'steel', tint=(0.7, 0.68, 0.66))
        # Bolts: countersunk heads round the flange, each with its hex socket.
        for (bx, bz) in [(-0.29, -0.29), (0.29, -0.29), (0.29, 0.29), (-0.29, 0.29), (0.0, -0.29), (0.29, 0.0), (0.0, 0.29), (-0.29, 0.0)]:
            emit(bm_cyl(0.017, 0.019, 0.004, 14), 'steel', xf(bx, 0.0015, bz), tint=(0.82, 0.8, 0.78), smooth=True)
            B('collar', 0.022, 0.0012, 0.004, bx, 0.0036, bz, ry=0.6)
        # The collar: the opening's walls down to COLLAR.
        tube_in(OPEN, -0.012, COLLAR, 'collar', DARK)
    # The shaft's lining (plumb), its floor, and guide rails in its corners (the column rides them).
    tube_in(OPEN + 0.006, COLLAR + 0.04, -SHAFT, 'shaft', DARK)
    bm = bmesh.new()
    h = OPEN + 0.006
    bm.faces.new([bm.verts.new((x, -SHAFT, z)) for (x, z) in [(-h, -h), (-h, h), (h, h), (h, -h)]])
    emit(bm, 'shaft', colfn=DARK, recalc=False)
    for (gx, gz) in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
        B('shaft', 0.03, SHAFT + COLLAR - 0.02, 0.03, gx * (OPEN - 0.006), (COLLAR - SHAFT) / 2 - 0.01, gz * (OPEN - 0.006), ry=PI / 4)


# ============================================================================ the column
def build_column():
    part('COLUMN', (0, 0, 0), axis=(0, -1, 0), sink=SINK)
    with into('COLUMN'):
        # The plinth, a polished band over it, the column, a second band under the cap.
        prism('paint', octagon(PLINTH[0], CH + 0.006), BASE, PLINTH[1], tint=(0.78, 0.78, 0.8))
        prism('chrome', octagon(HC + 0.006, CH + 0.002), PLINTH[1], PLINTH[1] + 0.012)
        prism('paint', octagon(HC, CH), PLINTH[1] + 0.012, lambda z: top_y(z) - 0.03)
        prism('chrome', octagon(HC + 0.004, CH + 0.001), lambda z: top_y(z) - 0.03, top_y)
        # The cap: a slab on the slope, overhanging a little all round.
        cap = bm_box(2 * (HC + 0.008), CAP_T, 2 * (HC + 0.008) / math.cos(SLOPE), bevel=0.006, seg=2)
        emit(cap, 'paint', plane_frame(0, 0, CAP_T / 2), tint=(1.08, 1.08, 1.1))
        # Black glass panel on the cap, a polished ring, and the button's collar.
        pw = 0.27
        emit(bm_box(pw, 0.003, pw / math.cos(SLOPE) * 0.92, bevel=0.0012), 'panel', plane_frame(0, 0, CAP_T + 0.0015))
        emit(bm_torus(0.106, 0.0028, 48, 8), 'chrome', plane_frame(0, 0, CAP_T + 0.003), smooth=True)
        emit(bm_ring(0.049, 0.07, 0.003, 0.018, 48), 'chrome', plane_frame(0, 0, CAP_T), smooth=lambda n: abs(n.y) < 0.9)
        emit(bm_torus(0.0595, 0.0075, 48, 10), 'chrome', plane_frame(0, 0, CAP_T + 0.018), smooth=True)
        # Front: a black glass strip down the column; back: vents.
        y0, y1 = 0.22, top_y(HC) - 0.1
        B('panel', 0.05, y1 - y0, 0.004, 0.0, (y0 + y1) / 2, HC + 0.0015, bevel=0.0015)
        for i in range(7):
            y = 0.42 + i * 0.045
            B('panel', 0.2, 0.012, 0.004, 0.0, y, -HC - 0.0015, bevel=0.0015)
        # Small fixing screws at the strip's ends.
        for y in (y0 - 0.03, y1 + 0.03):
            emit(bm_cyl(0.007, 0.007, 0.003, 10), 'chrome', xf(0.0, y, HC + 0.0012, rx=PI / 2), smooth=True)
    # The button: a red dome in the collar, pressed along the cap's normal.
    nrm = (0.0, math.cos(SLOPE), math.sin(SLOPE))
    pv = plane_frame(0, 0, CAP_T + 0.004) @ Vector((0, 0, 0))
    part('BUTTON', tuple(pv), parent='COLUMN', axis=tuple(-c for c in nrm), travel=0.009)
    with into('BUTTON'):
        dome = bmesh.new()
        bmesh.ops.create_uvsphere(dome, u_segments=32, v_segments=12, radius=0.046)
        bmesh.ops.delete(dome, geom=[v for v in dome.verts if v.co.z < -1e-4], context='VERTS')   # (z up here)
        bmesh.ops.scale(dome, vec=(1.0, 1.0, 0.62), verts=dome.verts)
        bmesh.ops.rotate(dome, cent=(0, 0, 0), matrix=Matrix.Rotation(-PI / 2, 3, 'X'), verts=dome.verts)  # z up -> y up
        emit(dome, 'button', plane_frame(0, 0, CAP_T + 0.004), smooth=True)
        emit(bm_cyl(0.046, 0.046, 0.012, 32), 'button', plane_frame(0, 0, CAP_T - 0.002), smooth=lambda n: abs(n.y) < 0.9)
    crown = plane_frame(0, 0, CAP_T + 0.004 + 0.046 * 0.62) @ Vector((0, 0, 0))
    centre = plane_frame(0, 0, CAP_T) @ Vector((0, 0, 0))
    empty('TOP', tuple(centre))
    empty('BUTTON_TOP', tuple(crown))
    empty('HIT', (0.0, 0.98, 0.0), hit_w=0.44, hit_h=0.44, hit_d=0.44)


# ============================================================================ the light shafts
def cone(i, base, axis, L, rb, rt, weight, phase, segs=16, rows=11):
    """An open tapered cone (beam i) from `base` along `axis` for L, radius rb to rt; uv.x = i + round, uv.y along.
    Closed round: the seam's vertices are shared (only the faces' UVs jump there), so its smooth normals run on across
    it (split there, the game's view-angle edge showed a hard line down every beam)."""
    a = Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
    p = a.cross(ref).normalized()
    q = a.cross(p).normalized()
    bm = bmesh.new()
    rows_v = []
    ts = [(k / rows) ** 1.35 for k in range(rows + 1)]
    for t in ts:
        c = Vector(base) + a * (t * L)
        r = rb + (rt - rb) * t
        rows_v.append([bm.verts.new(c + (p * math.cos(2 * PI * j / segs) + q * math.sin(2 * PI * j / segs)) * r) for j in range(segs)])
    fuv = []
    for k in range(rows):
        A, Bq = rows_v[k], rows_v[k + 1]
        for j in range(segs):
            j1 = (j + 1) % segs
            bm.faces.new((A[j], A[j1], Bq[j1], Bq[j]))      # facing out
            u0, u1 = i + 0.02 + 0.96 * j / segs, i + 0.02 + 0.96 * (j + 1) / segs
            fuv.append([(u0, ts[k]), (u1, ts[k]), (u1, ts[k + 1]), (u0, ts[k + 1])])
    bm.faces.index_update()
    emit(bm, 'beam', tint=(weight, phase, 1.0), smooth=True, uvface=lambda f: fuv[f.index])


OPENING = 1.6                # the aperture's clear opening (its rim ring starts at 1.66): every beam stays inside it


def inside(rc, y0, tilt, L, rb, rt):
    """rc, pulled in if need be so the beam's section where it comes up through the cap (y = 0, an ellipse on the lean)
    stays inside the opening: none rises out of the paving."""
    s = -y0 / math.cos(tilt)
    reach = rc + -y0 * math.tan(tilt) + (rb + (rt - rb) * s / L) / math.cos(tilt)
    return rc - max(0.0, reach - OPENING)


def build_shafts():
    part('SHAFTS', (0, 0, 0), bake=False)
    g = random.Random(4242)
    with into('SHAFTS'):
        k = 0
        y0 = -1.4                                  # the bases, down in the pit (hidden, and faded out)
        # A broad, faint core straight up.
        cone(k, (0, y0, 0), (0, 1, 0), 58.0, 0.95, 3.4, 0.4, 0.0, segs=20); k += 1
        # The main beams round the opening, leaning out.
        n = 8
        for j in range(n):
            phi = 2 * PI * j / n + g.uniform(-0.22, 0.22)
            rc = g.uniform(0.7, 1.2)
            tilt = math.radians(g.uniform(7, 19))
            twist = math.radians(g.uniform(-5, 5))
            out = Vector((math.cos(phi + twist), 0, math.sin(phi + twist)))
            axis = (out * math.sin(tilt) + Vector((0, 1, 0)) * math.cos(tilt))
            L = g.uniform(28, 46)
            rb = g.uniform(0.24, 0.44)
            rt = rb + L * math.tan(math.radians(g.uniform(1.1, 2.6)))
            rc = inside(rc, y0, tilt, L, rb, rt)
            cone(k, (math.cos(phi) * rc, y0, math.sin(phi) * rc), tuple(axis), L, rb, rt, g.uniform(0.65, 1.0), g.random()); k += 1
        # Thin bright glints between them, leaning further.
        for j in range(5):
            phi = 2 * PI * (j + 0.5) / 5 + g.uniform(-0.3, 0.3)
            rc = g.uniform(0.5, 1.35)
            tilt = math.radians(g.uniform(13, 27))
            out = Vector((math.cos(phi), 0, math.sin(phi)))
            axis = out * math.sin(tilt) + Vector((0, 1, 0)) * math.cos(tilt)
            L = g.uniform(17, 30)
            rb = g.uniform(0.07, 0.12)
            rt = rb + L * math.tan(math.radians(0.7))
            rc = inside(rc, y0, tilt, L, rb, rt)
            cone(k, (math.cos(phi) * rc, y0, math.sin(phi) * rc), tuple(axis), L, rb, rt, g.uniform(0.45, 0.7), g.random(), segs=10, rows=8); k += 1
    return k


# ============================================================================ textures
def wrap_blur(a, r, axis):
    out = np.zeros_like(a)
    for k in range(-r, r + 1):
        out += np.roll(a, k, axis=axis)
    return out / (2 * r + 1)


def smooth_noise(g, n, cells):
    """Tileable value noise: a random grid of `cells`, smoothly upsampled (wrapping)."""
    c = g.random((cells, cells)).astype(np.float32)
    x = np.arange(n) * cells / n
    i0 = np.floor(x).astype(int); f = x - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    rows = c[i0][:, i0] * (1 - f)[None, :] + c[i0][:, i1] * f[None, :]
    rows2 = c[i1][:, i0] * (1 - f)[None, :] + c[i1][:, i1] * f[None, :]
    return rows * (1 - f)[:, None] + rows2 * f[:, None]


def steel_tiles(n=512):
    """Worn steel: fine grain, faint cross-hatched scratches, darker blotches (grime, old wear), as a colour tile
    (about 0.38..0.62 grey) and its height for the normal map."""
    g = np.random.default_rng(23)
    fine = g.random((n, n)).astype(np.float32)
    fine = wrap_blur(wrap_blur(fine, 1, 0), 1, 1)
    blot = 0.55 * smooth_noise(g, n, 6) + 0.3 * smooth_noise(g, n, 13) + 0.15 * smooth_noise(g, n, 29)
    h = 0.5 + 0.18 * (fine - 0.5)
    scr = np.zeros((n, n), np.float32)
    for _ in range(260):                               # scratches in two families of directions
        ang = g.choice([0.35, 2.1]) + g.normal(0, 0.12)
        L = int(g.integers(n // 16, n // 3))
        x0, y0 = g.random() * n, g.random() * n
        t = np.arange(L)
        xs = ((x0 + np.cos(ang) * t) % n).astype(int); ys = ((y0 + np.sin(ang) * t) % n).astype(int)
        scr[ys, xs] = np.maximum(scr[ys, xs], g.random() * 0.8 + 0.2)
    scr = wrap_blur(scr, 1, 0) * 0.6 + scr * 0.4
    col = 0.5 + 0.06 * (fine - 0.5) - 0.16 * (blot - blot.mean()) / (blot.std() + 1e-6) * 0.5 + 0.055 * scr
    col = np.clip(col, 0.2, 0.85)
    rgb = np.stack([col * 1.0, col * 0.985, col * 0.96], axis=-1)
    height = h - 0.15 * scr - 0.08 * blot
    return rgb, height


# ============================================================================ entry points
def build_all():
    build_bezel()
    build_column()
    beams = build_shafts()
    empty('META', (0, 0, 0), hole_half=HOLE, open_half=OPEN, flange_half=FLANGE, skirt_half=SKIRT, col_half=HC,
          shaft=SHAFT, sink=SINK, top_front=TOP_F, slope=SLOPE, beams=beams)
    stats = realize()
    bpy.data.objects['COLLIDER']['noexport'] = 1     # (the game gives the column a box of its own)
    return stats


def bake_all():
    t0 = time.time()
    rgb, height = steel_tiles()
    save_png(MODELS + 'endprops_steel.png', np.clip(rgb, 0, 1))     # (the values as stored: the game reads it as sRGB)
    normal_from_height(MODELS + 'endprops_steel_normal.png', height, strength=3.0)
    out = {'textures_s': round(time.time() - t0, 1)}
    # The occluding ground just under the bezel's top (dbkit's own would lie in its face, and shade it in blotches).
    sc = _scene()
    if sc.objects.get('BAKE_ground') is None:
        gme = bpy.data.meshes.new('DB_bake_ground')
        g = 40.0
        gme.from_pydata([(-g, -g, -0.004), (g, -g, -0.004), (g, g, -0.004), (-g, g, -0.004)], [], [(0, 1, 2, 3)])
        ground = bpy.data.objects.new('BAKE_ground', gme)
        ground['noexport'] = 1
        sc.collection.objects.link(ground)
    out['ao'] = bake_ao(samples=128, distance=0.5)
    out['seconds'] = round(time.time() - t0, 1)
    return out
