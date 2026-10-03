"""Dreambound: the picture the Bunker7 terminal shows for REMOTE_TRANSFORM (src/props/terminal.js loads it as asset.mars).
A rover-style photograph of Mars with something in it that somebody has blacked out.

The scene is built here and rendered with Cycles: the camera stands two metres up on a rocky hillside that falls to a
basin; the basin's near floor is a flat of pale rippled dust, then a field of dark ripples and a few dunes, a line of
mesas a kilometre or two off and far hills lost in the haze. The ground is one view-adapted mesh (a polar grid, about
a pixel across at every distance) whose heights come from numpy noise, so the rocks, the track and the pad can ask the
same function; the rocks (pebbles to boulders, tens of thousands) are one merged mesh; the sky is a butterscotch
gradient with a bright aureole round a low sun out of frame to the left (the scene is backlit, shadows run toward the
camera's right); the materials mix in distance haze themselves.

On the flat stands what the box hides: a tall dark slab turned square to the sun, a low annexe beside it with a small
mirror panel on its roof, and a twin-rut vehicle track running down the hillside to its door. The frame is then
developed like a photograph (bloom, a little veiling glare, vignette, sensor noise, a soft-shouldered curve, a touch
desaturated) and the censor's rectangle is painted over the installation: flat black, axis-aligned, its edges on 16 px
multiples (JPEG block edges, so they stay crisp). Round it are left the track running in under its lower edge, the
slab's long straight-edged shadow coming out from under its lower right corner, and past its left side the annexe's
end wall and the panel's glint. No words anywhere.

Headless:   blender --background --factory-startup --python tools/blender/paint_mars.py
Writes public/models/bunker_mars.jpg: 1024 x 768, sRGB, quality 88 (about 130 KB), the box painted in; stored the
ordinary way up (the sky in the file's first rows). About two minutes with the GPU (OptiX).

Options after a "--":   --draft            a quick look: coarser ground, fewer rocks, 32 samples, no supersampling
                        --out PATH         write the picture somewhere else (drafts)
                        --clean PATH       also write a 512-wide PNG of the frame WITHOUT the box (reviewing only:
                                           refused inside the repo, the game must never ship what is under the box)
                        --samples N, --geo F, --super N, --rocks N      tuning: samples, ground density (1.25),
                                           supersampling (2), rock candidates (150000)
"""
import os, sys, math, time
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('bunker_mars', 'mars_', 'Dreambound_Mars')
import numpy as np

OUT = ROOT + "/public/models/bunker_mars.jpg"
W, H = 1024, 768
QUALITY = 88

# ---------------------------------------------------------------- the shot
# Blender axes: +X right, +Y the way the camera looks, +Z up; the origin is the ground under the camera.
HFOV = math.radians(50.0)
CAM_H = 2.0                          # mast height
PITCH = math.radians(1.3)            # nose down: the true horizon sits 47 % from the top, the skyline about 40 %
FOCAL = (W / 2) / math.tan(HFOV / 2)                 # px
SUN_AZ = math.radians(-36.0)         # from the view axis; negative = to the left (ahead-left: the scene is backlit)
SUN_EL = math.radians(15.5)
SUN = (math.sin(SUN_AZ) * math.cos(SUN_EL), math.cos(SUN_AZ) * math.cos(SUN_EL), math.sin(SUN_EL))
SUN_E = 9.0                          # sun irradiance; on level ground the sky adds a little under half as much again
SUN_ANGLE = math.radians(1.0)        # a little wider than the real disc: the dust softens the shadow's edge
SUN_COL = (1.0, 0.93, 0.82)

# Sky (linear radiance): butterscotch overhead, paler at the horizon, a broad bright aureole round the sun.
ZENITH = (0.26, 0.17, 0.095)
HORIZON = (0.50, 0.36, 0.225)
GLOW = (1.0, 0.86, 0.66)
GLOW_WIDE, GLOW_TIGHT = 0.36, 1.3    # x cos^5 and x cos^48 of the angle from the sun
HAZE_L = 6000.0                      # e-folding distance of the dust haze (m)
HAZE_GAIN = 0.92

# The hillside the camera stands on falls DROP metres to the basin floor by FOOT metres out.
FOOT = 46.0
DROP = 8.5
MESA_H = 85.0
FAR_H = 1100.0

# What the box hides. SITE is the slab's foot; E runs along the slab's broad face (square to the sun, so its shadow is
# as wide as it can be), S points from it toward the sun.
SITE = (-8.0, 66.0)
E = (math.cos(SUN_AZ), -math.sin(SUN_AZ))
S = (math.sin(SUN_AZ), math.cos(SUN_AZ))
SLAB = (5.0, 0.9, 5.7)               # along E, along S, tall
ANNEX = (-7.5, -2.9, 3.0, 2.3)       # from, to along E; depth along S; height
PEEK = 0.85                          # metres of the annexe's far end left outside the box
PAD_R = 11.0                         # the levelled pad's radius

# The vehicle track: a cubic from beside the camera to the annexe's door.
GAUGE = 2.3
RUT_W = 0.56
TRACK = [(4.4, 1.0), (1.2, 24.0), (-12.5, 38.0), (SITE[0] - 4.6, SITE[1] - 3.2)]

# Ground colours (linear albedo).
DUST_A = (0.30, 0.165, 0.085)
DUST_B = (0.43, 0.265, 0.145)
FLAT = (0.45, 0.285, 0.16)           # the pale dust of the basin's near floor
SAND = (0.135, 0.085, 0.056)         # the dark basaltic sand of the ripple field
PLATE = (0.40, 0.285, 0.185)         # bedrock plates on the hillside
ROCK_D = (0.075, 0.056, 0.046)
ROCK_L = (0.19, 0.135, 0.10)

HEROES = [(-4.3, 11.6, 0.95), (-3.2, 12.6, 0.42), (6.6, 14.5, 1.1), (5.3, 13.4, 0.5), (-9.5, 21.0, 1.3), (10.5, 26.0, 0.9), (-0.9, 16.5, 0.36)]

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def _opt(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
DRAFT = '--draft' in ARGS
OUT_PATH = _opt('--out', OUT)
CLEAN_PATH = _opt('--clean')
SAMPLES = int(_opt('--samples', 32 if DRAFT else 160))
GEO = float(_opt('--geo', 0.55 if DRAFT else 1.25))         # terrain density (tuning: --geo, --super, --rocks)
SUPER = int(_opt('--super', 1 if DRAFT else 2))              # render at SUPER x the size and box it down
N_ROCKS = int(_opt('--rocks', 45000 if DRAFT else 150000))


# ---------------------------------------------------------------- noise (numpy; the terrain is a function, so the
# rocks, the track and the pad can ask it for heights)
_rs = np.random.RandomState(1976)
_P = np.concatenate([_rs.permutation(256)] * 2).astype(np.int64)
_ang = _rs.rand(256) * 2 * np.pi
_GX, _GY = np.cos(_ang), np.sin(_ang)
_G3 = _rs.randn(256, 3)
_G3 /= np.linalg.norm(_G3, axis=1, keepdims=True)

def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)

def perlin2(x, y, seed=0):
    x = x + seed * 37.317
    y = y - seed * 19.173
    xi, yi = np.floor(x), np.floor(y)
    xf, yf = x - xi, y - yi
    xi = xi.astype(np.int64) & 255
    yi = yi.astype(np.int64) & 255
    x1, y1 = (xi + 1) & 255, (yi + 1) & 255
    u, v = _fade(xf), _fade(yf)
    def g(ix, iy, dx, dy):
        h = _P[_P[ix] + iy]
        return _GX[h] * dx + _GY[h] * dy
    a, b = g(xi, yi, xf, yf), g(x1, yi, xf - 1, yf)
    c, d = g(xi, y1, xf, yf - 1), g(x1, y1, xf - 1, yf - 1)
    ab = a + u * (b - a)
    return (ab + v * (c + u * (d - c) - ab)) * 1.45

def fbm2(x, y, octaves=4, seed=0, lac=2.07, gain=0.5, ridged=False):
    s, amp, norm, f = 0.0, 1.0, 0.0, 1.0
    for o in range(octaves):
        n = perlin2(x * f, y * f, seed + o * 7)
        if ridged:
            n = 1.0 - 2.0 * np.abs(n)
        s = s + amp * n
        norm += amp
        amp *= gain
        f *= lac
    return s / norm

def perlin3(p):
    pi = np.floor(p)
    pf = p - pi
    pi = pi.astype(np.int64) & 255
    u = _fade(pf)
    c = []
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                h = _P[_P[_P[(pi[..., 0] + dx) & 255] + ((pi[..., 1] + dy) & 255)] + ((pi[..., 2] + dz) & 255)]
                c.append((_G3[h] * (pf - np.array((dx, dy, dz), dtype=np.float64))).sum(-1))
    x00 = c[0] + u[..., 0] * (c[1] - c[0])
    x10 = c[2] + u[..., 0] * (c[3] - c[2])
    x01 = c[4] + u[..., 0] * (c[5] - c[4])
    x11 = c[6] + u[..., 0] * (c[7] - c[6])
    y0 = x00 + u[..., 1] * (x10 - x00)
    y1 = x01 + u[..., 1] * (x11 - x01)
    return (y0 + u[..., 2] * (y1 - y0)) * 1.6

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- the track
def _bezier(P, n=280):
    P = np.array(P, dtype=np.float64)
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * P[0] + 3 * (1 - t) ** 2 * t * P[1] + 3 * (1 - t) * t ** 2 * P[2] + t ** 3 * P[3]

PATH = _bezier(TRACK)

def track_coords(x, y):
    """Signed distance off the track's centreline and the distance along it, for points near it (inf elsewhere)."""
    q = np.full(x.shape, np.inf)
    a = np.zeros(x.shape)
    lo, hi = PATH.min(0) - 3.0, PATH.max(0) + 3.0
    m = (x > lo[0]) & (x < hi[0]) & (y > lo[1]) & (y < hi[1])
    if not m.any():
        return q, a
    xs, ys = x[m], y[m]
    best = np.full(xs.shape, np.inf)
    qq, aa = np.zeros(xs.shape), np.zeros(xs.shape)
    seg = PATH[1:] - PATH[:-1]
    L = np.linalg.norm(seg, axis=1)
    cum = np.concatenate([[0.0], np.cumsum(L)])
    for k in range(len(seg)):
        dx, dy = xs - PATH[k, 0], ys - PATH[k, 1]
        t = np.clip((dx * seg[k, 0] + dy * seg[k, 1]) / (L[k] * L[k]), 0.0, 1.0)
        ex, ey = dx - t * seg[k, 0], dy - t * seg[k, 1]
        d2 = ex * ex + ey * ey
        w = d2 < best
        best = np.where(w, d2, best)
        qq = np.where(w, np.sign(seg[k, 0] * dy - seg[k, 1] * dx) * np.sqrt(d2), qq)
        aa = np.where(w, cum[k] + t * L[k], aa)
    q[m] = qq
    a[m] = aa
    return q, a


# ---------------------------------------------------------------- the ground
WIND = S                              # the wind blows down the sun's azimuth: every crest lies square to the light
PAD_ON = [True]

def _crest(saw, lee):
    """One ripple's profile over its phase 0..1: a steep face on the side away from the sun (it stays in shadow, and it
    faces the camera), a long back toward it."""
    return np.where(saw < lee, sstep(0, 1, saw / lee), sstep(0, 1, (1 - saw) / (1 - lee)))

def terrain(x, y):
    """Height and the shader's masks (dark sand, bedrock plate, track rut, the pale flat) at ground points x, y (1-D)."""
    r = np.hypot(x, y)
    wx = x + 11.0 * fbm2(x / 75, y / 75, 3, seed=1)
    wy = y + 11.0 * fbm2(x / 75, y / 75, 3, seed=2)

    # The hillside: an even fall to the basin floor (even, so no brow hides the slope below it), rounding out at its foot.
    t = (wy + 0.10 * wx - 3.0) / (FOOT - 3.0)
    z = -DROP * (t - np.logaddexp(0.0, 7.0 * (t - 1.0)) / 7.0)
    # The basin: broad swells, then the ground climbing slowly toward the mesas.
    z += 0.9 * fbm2(x / 170, y / 170, 4, seed=3) * sstep(40, 140, r)
    z += 22.0 * sstep(450, 2600, r) + 6.0 * fbm2(x / 900, y / 900, 4, seed=4) * sstep(200, 900, r)
    # The mesa line: flat caps over a cliff and a talus apron, strongest between one and two and a half kilometres.
    band = sstep(600, 1100, r) * (1.0 - 0.75 * sstep(2600, 5200, r))
    m = fbm2(wx / 560, wy / 760, 4, seed=5) + 0.045 * fbm2(x / 170, y / 170, 3, seed=9, ridged=True) + 0.42 * band - 0.34
    cap = 0.62 * sstep(0.0, 0.05, m) + 0.38 * sstep(0.13, 0.17, m)          # a bench, then the cap
    talus = sstep(-0.22, 0.02, m)
    z += band * MESA_H * (0.6 * cap + 0.4 * talus * talus) * (0.75 + 0.5 * fbm2(x / 1500, y / 1500, 2, seed=6))
    z += band * 5.0 * fbm2(x / 160, y / 160, 4, seed=8, ridged=True) * talus * (1.0 - cap)
    # Far hills, mostly haze by the time they reach the camera.
    far = sstep(5200, 15000, r)
    z += far * FAR_H * (0.35 + 0.65 * (0.5 + 0.5 * fbm2(wx / 8200, wy / 8200, 6, seed=7, ridged=True)))

    sand = np.zeros(x.shape)
    plate = np.zeros(x.shape)
    track = np.zeros(x.shape)
    # The basin's near floor is a flat of pale smooth dust (the installation stands on it); the dark ripples begin beyond.
    hs = wy + 0.10 * wx
    flat = sstep(FOOT - 13, FOOT + 3, hs) * (1.0 - sstep(105, 170, hs))

    # The ripple field on the basin floor: long asymmetric crests square to the wind, a second finer set riding them.
    md = r < 1000
    if md.any():
        xd, yd, rd = x[md], y[md], r[md]
        foot = sstep(80, 125, hs[md] + 16.0 * fbm2(xd / 60, yd / 60, 2, seed=21))
        field = sstep(-0.22, 0.22, fbm2(wx[md] / 150, wy[md] / 150, 3, seed=22) + 0.30 * foot - 0.12)
        field = field * foot * (1.0 - sstep(520, 950, rd))
        u = xd * WIND[0] + yd * WIND[1] + 5.5 * fbm2(xd / 38, yd / 38, 3, seed=23) + 0.22 * xd * WIND[1]
        ph = u / (7.5 * (1.0 + 0.22 * fbm2(xd / 120, yd / 120, 2, seed=28)))
        prof = _crest(ph - np.floor(ph), 0.27)
        amp = 0.62 * np.clip(0.55 + 0.75 * fbm2(xd / 40, yd / 40, 3, seed=24), 0.08, 1.2)
        dz = field * amp * prof
        ph2 = (u + 0.5 * fbm2(xd / 5, yd / 5, 2, seed=25)) / 1.05
        dz += field * 0.05 * _crest(ph2 - np.floor(ph2), 0.32) * (1.0 - sstep(45, 110, rd))
        # ... and on the flat, low ripples in patches (they give the shadow and the track something to lie across).
        fl = flat[md]
        if fl.any():
            ph3 = (u + 0.9 * fbm2(xd / 7, yd / 7, 2, seed=29)) / 1.7
            patch = sstep(-0.25, 0.35, fbm2(xd / 19, yd / 19, 3, seed=30))
            dz += fl * (1.0 - field) * 0.045 * patch * _crest(ph3 - np.floor(ph3), 0.34) * (1.0 - sstep(120, 190, rd))
        # ... and out past them a few real dunes, the same dark sand heaped metres high.
        big = sstep(170, 330, hs[md]) * (1.0 - sstep(650, 980, rd)) * sstep(-0.2, 0.25, fbm2(wx[md] / 240, wy[md] / 240, 3, seed=35))
        ph4 = (u + 16.0 * fbm2(xd / 95, yd / 95, 2, seed=36)) / 64.0
        prof4 = _crest(ph4 - np.floor(ph4), 0.3)
        dz += big * 3.8 * prof4 * np.clip(0.6 + 0.8 * fbm2(xd / 120, yd / 120, 2, seed=37), 0.15, 1.3)
        z[md] += dz
        sand[md] = np.maximum(field * (0.55 + 0.45 * prof), big * (0.45 + 0.55 * prof4))

    # The near ground: lumps, bedrock in thin stepped plates where it shows through, drifts of sand between.
    mn = r < 110
    if mn.any():
        xn, yn, rn = x[mn], y[mn], r[mn]
        res = 1.0 - sstep(45, 105, rn)                       # what the mesh can still resolve
        drift = np.maximum(sstep(0.05, 0.42, fbm2(xn / 8.5, yn / 8.5, 3, seed=26)), flat[mn]) * (1.0 - sand[mn])
        lump = fbm2(xn / 2.4, yn / 2.4, 4, seed=31)
        pl = sstep(-0.05, 0.3, fbm2(xn / 5.5, yn / 5.5, 3, seed=32)) * (1.0 - drift) * (1.0 - sand[mn])
        st = 0.075
        qv = (lump * 0.30 + 0.06 * fbm2(xn / 0.7, yn / 0.7, 2, seed=34)) / st
        terr = (np.floor(qv) + sstep(0.78, 1.0, qv - np.floor(qv))) * st
        dz = res * ((1.0 - pl) * lump * 0.11 * (1.0 - 0.6 * drift) + pl * terr)
        dz += res * 0.02 * fbm2(xn / 0.42, yn / 0.42, 3, seed=33) * (1.0 - 0.7 * drift) * (1.0 - sstep(20, 50, rn))
        # fine ripples on the drifts
        u = xn * WIND[0] + yn * WIND[1] + 0.25 * fbm2(xn / 1.6, yn / 1.6, 2, seed=27)
        dz += drift * 0.011 * np.sin(u * 2 * np.pi / 0.16) * (1.0 - sstep(14, 30, rn))
        z[mn] += dz
        plate[mn] = pl * res
        sand[mn] = np.maximum(sand[mn], drift * 0.55 * (1.0 - flat[mn]))

    # The levelled pad under the installation.
    dp = np.hypot(x - SITE[0] + 2.0 * E[0], y - SITE[1] + 2.0 * E[1])
    k = sstep(PAD_R + 6.0, PAD_R - 2.0, dp)
    if PAD_ON[0] and k.any():
        z = z * (1 - k) + SITE_Z[0] * k
        sand *= (1 - 0.6 * k)

    # The track: two ruts pressed in, a low berm thrown up each side, cleat bars across each while the mesh can hold them.
    q, a = track_coords(x, y)
    mt = np.abs(q) < GAUGE / 2 + RUT_W + 0.4
    if mt.any():
        qt, at, rt = q[mt], a[mt], r[mt]
        dq = np.abs(np.abs(qt) - GAUGE / 2)
        rut = sstep(RUT_W / 2 + 0.05, RUT_W / 2 - 0.05, dq)
        berm = np.exp(-((dq - RUT_W / 2 - 0.08) / 0.07) ** 2)
        cle = sstep(-0.2, 0.2, np.sin(at * 2 * np.pi / 0.26 + np.sign(qt) * 1.3)) * (1.0 - sstep(14, 32, rt))
        z[mt] += -0.05 * rut + 0.022 * berm + 0.016 * rut * cle
        track[mt] = rut
    return z, sand, plate, track, flat

SITE_Z = [0.0]

def ground_z(x, y):
    return terrain(np.atleast_1d(np.asarray(x, dtype=np.float64)), np.atleast_1d(np.asarray(y, dtype=np.float64)))[0]


# ---------------------------------------------------------------- meshes
def make_mesh(name, co, faces, smooth=True):
    me = bpy.data.meshes.new(name)
    nf, k = faces.shape
    me.vertices.add(len(co))
    me.vertices.foreach_set('co', np.ascontiguousarray(co, dtype=np.float32).ravel())
    me.loops.add(nf * k)
    me.loops.foreach_set('vertex_index', np.ascontiguousarray(faces, dtype=np.int32).ravel())
    me.polygons.add(nf)
    me.polygons.foreach_set('loop_start', np.arange(0, nf * k, k, dtype=np.int32))
    me.update(calc_edges=True)
    if smooth:
        me.polygons.foreach_set('use_smooth', np.ones(nf, dtype=bool))
    return me

def set_attr(me, name, values):
    a = me.attributes.new(name, 'FLOAT', 'POINT')
    a.data.foreach_set('value', np.ascontiguousarray(values, dtype=np.float32))

PHI0, PHI1 = math.radians(-36.0), math.radians(33.0)       # the wedge of ground the frame (and its shadows) needs
R0, R1 = 2.2, 42000.0

def build_terrain(sc, mat):
    ncol = int(1100 * GEO)
    rr = [R0]
    while rr[-1] < R1:
        k = 0.0030 + 0.0055 * float(sstep(math.log(250.0), math.log(2500.0), math.log(rr[-1])))
        rr.append(rr[-1] * (1.0 + k / GEO))
    rr = np.array(rr)
    R, PH = np.meshgrid(rr, np.linspace(PHI0, PHI1, ncol), indexing='ij')
    x, y = (R * np.sin(PH)).ravel(), (R * np.cos(PH)).ravel()
    z, sand, plate, track, flat = terrain(x, y)
    nr = len(rr)
    v0 = (np.arange(nr - 1)[:, None] * ncol + np.arange(ncol - 1)[None, :]).ravel()
    faces = np.stack([v0, v0 + 1, v0 + ncol + 1, v0 + ncol], axis=-1)
    me = make_mesh('MARS_ground', np.stack([x, y, z], axis=-1), faces)
    set_attr(me, 'sand', sand)
    set_attr(me, 'plate', plate)
    set_attr(me, 'track', track)
    set_attr(me, 'flat', flat)
    me.materials.append(mat)
    ob = bpy.data.objects.new('MARS_ground', me)
    sc.collection.objects.link(ob)
    return {'rings': nr, 'cols': ncol, 'quads': len(faces)}

def _ico(sub):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    bm.verts.index_update()
    v = np.array([p.co[:] for p in bm.verts], dtype=np.float64)
    f = np.array([[q.index for q in face.verts] for face in bm.faces], dtype=np.int64)
    bm.free()
    return v, f

def build_rocks(sc, mat):
    """Rocks of every size from pebbles to boulders, as one mesh: lumpy spheres cut by a few random planes (so they
    come out angular), flattened, half sunk. Candidates are spread evenly over the picture (log-uniform in distance)
    with sizes on a power law from the smallest the camera can make out there; the bigger a rock looks, the finer
    its mesh."""
    rs = np.random.RandomState(7)
    n = N_ROCKS
    phi = rs.uniform(PHI0, PHI1, n)
    r = np.exp(rs.uniform(math.log(4.5), math.log(520.0), n))
    x, y = r * np.sin(phi), r * np.cos(phi)
    dmin = np.maximum(0.028, r * 0.0021)
    d = dmin * (1.0 - rs.rand(n)) ** (-1.0 / 1.55)
    _, sand, _, _, flat = terrain(x, y)
    # Where they lie: in fields, thin on the sand and the flat, none in the ruts or on the pad. Big rocks are rare (the
    # count falls off exponentially with size), so the far ground carries only the odd boulder.
    fieldn = fbm2(x / 16, y / 16, 3, seed=41)
    thin = sstep(0.25, 0.95, flat + 0.45 * fieldn)
    keep = rs.rand(n) < np.clip(0.6 + 0.9 * fieldn, 0.1, 1.0) * (1.0 - 0.88 * np.clip(sand * 1.5, 0, 1)) * (1.0 - 0.9 * thin)
    keep &= rs.rand(n) < np.exp(-(d - 0.028) / 0.30)
    keep &= d < 1.7
    q, a = track_coords(x, y)
    keep &= ~(np.abs(q) < GAUGE / 2 + RUT_W / 2 + 0.5 * d + 0.1)
    keep &= np.hypot(x - SITE[0] + 2.0 * E[0], y - SITE[1] + 2.0 * E[1]) > PAD_R + 1.0
    x, y, d = x[keep], y[keep], d[keep]
    for (hx, hy, hd) in HEROES:                           # a few placed by hand, to frame the foreground
        x, y, d = np.append(x, hx), np.append(y, hy), np.append(d, hd)
    r = np.hypot(x, y)
    z = terrain(x, y)[0]
    n = len(x)
    px = d / r * FOCAL                                     # size on the picture
    lod = np.where(px < 7, 1, np.where(px < 45, 2, np.where(px < 220, 3, 4)))
    cos_, faces_, tone_ = [], [], []
    base = 0
    for sub in (1, 2, 3, 4):
        idx = np.nonzero(lod == sub)[0]
        if not len(idx):
            continue
        V, F = _ico(sub)
        m = len(idx)
        P = np.repeat(V[None, :, :], m, axis=0)                       # m x nv x 3
        off = rs.uniform(0, 200, (m, 1, 3))
        n1 = perlin3(P * 1.15 + off)
        n2 = perlin3(P * 2.9 + off + 31.7) if sub > 1 else 0.0
        P = P * (1.0 + 0.34 * n1 + 0.10 * n2)[..., None]
        for k in range(9):
            nk = rs.randn(m, 3)
            nk /= np.linalg.norm(nk, axis=1, keepdims=True)
            dk = rs.uniform(0.36, 0.9, m)
            e = np.maximum((P * nk[:, None, :]).sum(-1) - dk[:, None], 0.0)
            P = P - e[..., None] * nk[:, None, :]
        if sub > 2:
            P = P * (1.0 + 0.035 * perlin3(P * 7.0 + off))[..., None]
        half = d[idx] / 2
        sx = half * rs.uniform(0.85, 1.25, m)
        sy = half * rs.uniform(0.6, 1.0, m)
        sz = half * rs.uniform(0.38, 0.85, m)
        yaw = rs.uniform(0, 2 * np.pi, m)
        tilt = rs.uniform(-0.25, 0.25, m)
        X, Y, Z = P[..., 0] * sx[:, None], P[..., 1] * sy[:, None], P[..., 2] * sz[:, None]
        Y, Z = Y * np.cos(tilt)[:, None] - Z * np.sin(tilt)[:, None], Y * np.sin(tilt)[:, None] + Z * np.cos(tilt)[:, None]
        c, s = np.cos(yaw)[:, None], np.sin(yaw)[:, None]
        X, Y = X * c - Y * s, X * s + Y * c
        bury = rs.uniform(0.12, 0.5, m)
        X += x[idx][:, None]
        Y += y[idx][:, None]
        Z += (z[idx] + sz * (1.0 - 2.0 * bury))[:, None]
        nv = V.shape[0]
        cos_.append(np.stack([X, Y, Z], axis=-1).reshape(-1, 3))
        faces_.append((F[None, :, :] + (base + np.arange(m) * nv)[:, None, None]).reshape(-1, 3))
        tone_.append(np.repeat(rs.rand(m) ** 1.6, nv))
        base += m * nv
    co, faces, tone = np.concatenate(cos_), np.concatenate(faces_), np.concatenate(tone_)
    me = make_mesh('MARS_rocks', co, faces)
    try:
        me.set_sharp_from_angle(angle=math.radians(34.0))
    except Exception as ex:
        print('rocks: no sharp edges:', ex)
    set_attr(me, 'tone', tone)
    me.materials.append(mat)
    ob = bpy.data.objects.new('MARS_rocks', me)
    sc.collection.objects.link(ob)
    return {'rocks': n, 'tris': len(faces), 'by_lod': [int((lod == k).sum()) for k in (1, 2, 3, 4)]}

def _box(sc, name, centre, size, yaw, mat):
    """A box standing on centre (x, y, z of its foot), size (along its own x, along its own y, tall), turned by yaw."""
    lx, ly, lz = size[0] / 2, size[1] / 2, size[2]
    c, s = math.cos(yaw), math.sin(yaw)
    v = []
    for (px, py, pz) in ((-lx, -ly, 0), (lx, -ly, 0), (lx, ly, 0), (-lx, ly, 0), (-lx, -ly, lz), (lx, -ly, lz), (lx, ly, lz), (-lx, ly, lz)):
        v.append((centre[0] + px * c - py * s, centre[1] + px * s + py * c, centre[2] + pz))
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return np.array(v)

def site_point(e, s=0.0, z=0.0):
    return np.array((SITE[0] + E[0] * e + S[0] * s, SITE[1] + E[1] * e + S[1] * s, SITE_Z[0] + z))

def build_site(sc, dark, mirror):
    """What the box hides: the slab, the annexe beside it on the sun's side, and on the annexe's roof at its far end a
    small panel turned to throw the sun at the camera. Returns the corner sets the box is fitted to."""
    yaw = math.atan2(E[1], E[0])
    slab = _box(sc, 'MARS_slab', site_point(0.0, 0.0, -0.3), (SLAB[0], SLAB[1], SLAB[2] + 0.3), yaw, dark)
    e0, e1, depth, tall = ANNEX
    annex = _box(sc, 'MARS_annex', site_point((e0 + e1) / 2, 0.0, -0.3), (e1 - e0, depth, tall + 0.3), yaw, dark)
    # The panel: its normal bisects the directions to the sun and to the camera.
    pc = site_point(e0 + 0.55, -0.2, tall + 0.75)
    cam = np.array((0.0, 0.0, CAM_Z[0]))
    tocam = (cam - pc) / np.linalg.norm(cam - pc)
    nrm = tocam + np.array(SUN)
    nrm /= np.linalg.norm(nrm)
    ax = np.cross(nrm, (0, 0, 1.0))
    ax /= np.linalg.norm(ax)
    ay = np.cross(nrm, ax)
    hw, hh = 0.3, 0.22
    v = [tuple(pc + ax * a * hw + ay * b * hh) for (a, b) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    me = bpy.data.meshes.new('MARS_panel')
    me.from_pydata(v, [], [(0, 1, 2, 3)])
    me.materials.append(mirror)
    sc.collection.objects.link(bpy.data.objects.new('MARS_panel', me))
    post = _box(sc, 'MARS_post', pc - np.array((0, 0, 0.8)) + nrm * -0.06, (0.1, 0.1, 0.8), yaw, dark)
    return slab, annex


# ---------------------------------------------------------------- shaders
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

def _noise(nt, vec, scale, detail=4.0, rough=0.55):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '3D'}, Vector=vec, Scale=scale, Detail=detail, Roughness=rough).outputs['Fac']

def _mapr(nt, v, a, b, lo=0.0, hi=1.0):
    return node(nt, 'ShaderNodeMapRange', props={'clamp': True}, Value=v, **{'From Min': a, 'From Max': b, 'To Min': lo, 'To Max': hi}).outputs[0]

def _scale(nt, col, k):
    return node(nt, 'ShaderNodeVectorMath', props={'operation': 'SCALE'}, i0=col, Scale=k).outputs[0]

def sky_nodes(nt, d):
    """The sky's radiance in unit direction d (above the horizon; below it, the horizon's)."""
    z = node(nt, 'ShaderNodeSeparateXYZ', Vector=d).outputs['Z']
    hf = math_node(nt, 'POWER', math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MAXIMUM', z, 0.0), clamp=True), 5.0)
    base = _mix(nt, hf, ZENITH, HORIZON)
    c = node(nt, 'ShaderNodeVectorMath', props={'operation': 'DOT_PRODUCT'}, i0=d, i1=SUN).outputs['Value']
    c = math_node(nt, 'MAXIMUM', c, 0.0)
    g = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', math_node(nt, 'POWER', c, 5.0), GLOW_WIDE),
                  math_node(nt, 'MULTIPLY', math_node(nt, 'POWER', c, 48.0), GLOW_TIGHT))
    return node(nt, 'ShaderNodeVectorMath', props={'operation': 'ADD'}, i0=base, i1=_scale(nt, GLOW, g)).outputs[0]

def _finish(nt, bsdf, haze=True):
    """Close a material: the surface, seen by the camera through HAZE_L of dust lit like the horizon behind it."""
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if not haze:
        nt.links.new(bsdf, out.inputs['Surface'])
        return
    inc = node(nt, 'ShaderNodeNewGeometry').outputs['Incoming']
    sep = node(nt, 'ShaderNodeSeparateXYZ', Vector=_scale(nt, inc, -1.0))
    flat = node(nt, 'ShaderNodeCombineXYZ', X=sep.outputs['X'], Y=sep.outputs['Y'], Z=0.03).outputs[0]
    d = node(nt, 'ShaderNodeVectorMath', props={'operation': 'NORMALIZE'}, i0=flat).outputs[0]
    dist = node(nt, 'ShaderNodeCameraData').outputs['View Distance']
    f = math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'EXPONENT', math_node(nt, 'MULTIPLY', dist, -1.0 / HAZE_L)))
    f = math_node(nt, 'MULTIPLY', f, node(nt, 'ShaderNodeLightPath').outputs['Is Camera Ray'])
    em = node(nt, 'ShaderNodeEmission', Color=sky_nodes(nt, d), Strength=HAZE_GAIN)
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(f, mx.inputs[0])
    nt.links.new(bsdf, mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs['Surface'])

def _material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    return mat, mat.node_tree

def ground_material():
    mat, nt = _material('MARS_ground')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    pos = geo.outputs['Position']
    att = lambda n: node(nt, 'ShaderNodeAttribute', props={'attribute_name': n}).outputs['Fac']
    sand, plate, track, flat = att('sand'), att('plate'), att('track'), att('flat')
    broad = _noise(nt, pos, 0.055, 5.0)
    mid = _noise(nt, pos, 0.8, 5.0)
    fine = _noise(nt, pos, 11.0, 4.0, 0.6)
    grain = _noise(nt, pos, 70.0, 2.0, 0.7)
    col = _mix(nt, _mapr(nt, broad, 0.3, 0.72), DUST_A, DUST_B)
    col = _mix(nt, _mapr(nt, mid, 0.42, 0.75, 0.0, 0.5), col, DUST_B)
    col = _mix(nt, math_node(nt, 'MULTIPLY', plate, _mapr(nt, mid, 0.3, 0.6, 0.35, 0.8)), col, PLATE)
    sv2 = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=pos, i1=(0.11, 0.035, 0.1)).outputs[0]
    streak = _noise(nt, sv2, 1.0, 4.0, 0.6)                 # wind streaks, drawn out down the view
    col = _mix(nt, math_node(nt, 'MULTIPLY', flat, _mapr(nt, streak, 0.3, 0.7, 0.35, 0.9)), col, FLAT)
    col = _mix(nt, _mapr(nt, sand, 0.05, 0.75), col, SAND)
    # Pebbles and gravel too small to model: Voronoi cells whose point lies near the surface.
    v1 = node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '3D', 'feature': 'F1'}, Vector=pos, Scale=2.3).outputs['Distance']
    v2 = node(nt, 'ShaderNodeTexVoronoi', props={'voronoi_dimensions': '3D', 'feature': 'F1'}, Vector=pos, Scale=8.5).outputs['Distance']
    peb = math_node(nt, 'MAXIMUM', _mapr(nt, v1, 0.17, 0.235, 1.0, 0.0), _mapr(nt, v2, 0.14, 0.2, 1.0, 0.0))
    clear = math_node(nt, 'MULTIPLY', _mapr(nt, sand, 0.1, 0.6, 1.0, 0.12), math_node(nt, 'SUBTRACT', 1.0, track, clamp=True))
    clear = math_node(nt, 'MULTIPLY', clear, _mapr(nt, flat, 0.0, 1.0, 1.0, 0.1))
    peb = math_node(nt, 'MULTIPLY', peb, clear)
    col = _mix(nt, peb, col, ROCK_L)
    col = _scale(nt, col, _mapr(nt, fine, 0.25, 0.75, 0.84, 1.14))
    col = _scale(nt, col, _mapr(nt, track, 0.0, 1.0, 1.0, 0.5))
    # Strata on anything steep (the mesas' cliffs): bands of lighter and darker rock by height.
    slope = math_node(nt, 'SUBTRACT', 1.0, node(nt, 'ShaderNodeSeparateXYZ', Vector=geo.outputs['True Normal']).outputs['Z'])
    sv = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=pos, i1=(0.0025, 0.0025, 0.22)).outputs[0]
    strata = _noise(nt, sv, 1.0, 3.0, 0.6)
    col = _mix(nt, _mapr(nt, slope, 0.08, 0.4), col, _scale(nt, col, _mapr(nt, strata, 0.3, 0.7, 0.5, 1.2)))
    # Relief below the mesh: grain, gravel, and the sand's finest ripples.
    wv = node(nt, 'ShaderNodeVectorMath', props={'operation': 'DOT_PRODUCT'}, i0=pos, i1=(WIND[0], WIND[1], 0.0)).outputs['Value']
    wv = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', wv, 2 * PI / 0.085), math_node(nt, 'MULTIPLY', mid, 9.0))
    rip = math_node(nt, 'MULTIPLY', math_node(nt, 'SINE', wv), math_node(nt, 'MULTIPLY', sand, 0.0035))
    h = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', fine, 0.012), math_node(nt, 'MULTIPLY', grain, 0.003))
    h = math_node(nt, 'ADD', h, math_node(nt, 'MULTIPLY', peb, 0.022))
    h = math_node(nt, 'ADD', h, rip)
    bump = node(nt, 'ShaderNodeBump', Height=h, Distance=1.0, Strength=1.0).outputs[0]
    bsdf = node(nt, 'ShaderNodeBsdfDiffuse', Color=col, Roughness=0.6, Normal=bump).outputs[0]
    _finish(nt, bsdf)
    return mat

def rock_material():
    mat, nt = _material('MARS_rock')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    pos = geo.outputs['Position']
    tone = node(nt, 'ShaderNodeAttribute', props={'attribute_name': 'tone'}).outputs['Fac']
    n1 = _noise(nt, pos, 5.0, 5.0, 0.6)
    n2 = _noise(nt, pos, 38.0, 3.0, 0.65)
    col = _scale(nt, _mix(nt, tone, ROCK_D, ROCK_L), _mapr(nt, n1, 0.25, 0.75, 0.7, 1.3))
    up = node(nt, 'ShaderNodeSeparateXYZ', Vector=geo.outputs['Normal']).outputs['Z']
    dusty = _mapr(nt, math_node(nt, 'ADD', up, math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', n1, 0.5), 0.9)), 0.35, 0.95, 0.0, 0.8)
    col = _mix(nt, dusty, col, DUST_A)
    h = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', n1, 0.02), math_node(nt, 'MULTIPLY', n2, 0.004))
    bump = node(nt, 'ShaderNodeBump', Height=h, Distance=1.0, Strength=1.0).outputs[0]
    bsdf = node(nt, 'ShaderNodeBsdfDiffuse', Color=col, Roughness=0.5, Normal=bump).outputs[0]
    _finish(nt, bsdf)
    return mat

def metal_material(name, colour, metallic, rough):
    mat, nt = _material(name)
    p = node(nt, 'ShaderNodeBsdfPrincipled', Metallic=metallic, Roughness=rough)
    p.inputs['Base Color'].default_value = (colour[0], colour[1], colour[2], 1.0)
    _finish(nt, p.outputs[0], haze=False)
    return mat

def build_world(sc):
    w = bpy.data.worlds.new('MARS_sky')
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    d = node(nt, 'ShaderNodeVectorMath', props={'operation': 'NORMALIZE'}, i0=nt.nodes.new('ShaderNodeTexCoord').outputs['Generated']).outputs[0]
    bg = node(nt, 'ShaderNodeBackground', Color=sky_nodes(nt, d), Strength=1.0)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    sc.world = w


# ---------------------------------------------------------------- camera
CAM_Z = [CAM_H]

def project(p):
    """World points (n x 3) -> picture coordinates (x right, y down from the top), in final pixels."""
    p = np.atleast_2d(np.asarray(p, dtype=np.float64))
    dy, dz = p[:, 1], p[:, 2] - CAM_Z[0]
    depth = dy * math.cos(PITCH) - dz * math.sin(PITCH)
    up = dy * math.sin(PITCH) + dz * math.cos(PITCH)
    return np.stack([W / 2 + FOCAL * p[:, 0] / depth, H / 2 - FOCAL * up / depth], axis=-1)

def build_camera(sc):
    cd = bpy.data.cameras.new('MARS_cam')
    cd.sensor_fit = 'HORIZONTAL'
    cd.sensor_width = 36.0
    cd.lens = 18.0 / math.tan(HFOV / 2)
    cd.clip_start, cd.clip_end = 0.2, 100000.0
    cam = bpy.data.objects.new('MARS_cam', cd)
    cam.location = (0.0, 0.0, CAM_Z[0])
    cam.rotation_euler = (math.radians(90.0) - PITCH, 0.0, 0.0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sd = bpy.data.lights.new('MARS_sun', 'SUN')
    sd.energy = SUN_E
    sd.color = SUN_COL
    sd.angle = SUN_ANGLE
    sun = bpy.data.objects.new('MARS_sun', sd)
    # A sun lamp shines along its -Z: turn that to point away from the sun.
    sun.rotation_euler = Vector(SUN).to_track_quat('Z', 'Y').to_euler()
    sc.collection.objects.link(sun)


# ---------------------------------------------------------------- the redaction box
def fit_box(slab, annex):
    """The censor's rectangle (x0, y0, x1, y1 in picture pixels, y down): over the slab and the annexe, all but the
    annexe's last PEEK metres; its bottom edge just under their feet, so their shadows run out from beneath it. Edges
    on multiples of 16 (JPEG block edges), width held to 12-18 % of the frame."""
    e0, e1, depth, tall = ANNEX
    cut = np.array([site_point(e0 + PEEK, s, zz) for s in (-depth / 2, depth / 2) for zz in (0.0, tall)])
    ps, pa, pc = project(slab), project(annex), project(cut)
    x0 = pc[:, 0].min()
    x1 = ps[:, 0].max() + 9.0
    y0 = ps[:, 1].min() - 12.0
    y1 = max(ps[:, 1].max(), pa[:, 1].max()) + 2.0
    x0, x1 = int(round(x0 / 16.0)) * 16, int(math.ceil(x1 / 16.0)) * 16
    y0, y1 = int(math.floor(y0 / 16.0)) * 16, int(round(y1 / 16.0)) * 16
    while x1 - x0 > 0.18 * W:
        x1 -= 16
    while x1 - x0 < 0.12 * W:
        x1 += 16
    return x0, y0, x1, y1


# ---------------------------------------------------------------- the photograph
def _gauss(a, sigma):
    n = max(1, int(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-n, n + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(a, ((n, n), (0, 0), (0, 0)), mode='edge')
    a = sum(pad[i:i + a.shape[0]] * k[i] for i in range(2 * n + 1))
    pad = np.pad(a, ((0, 0), (n, n), (0, 0)), mode='edge')
    return sum(pad[:, i:i + a.shape[1]] * k[i] for i in range(2 * n + 1))

def srgb_enc(a):
    a = np.clip(a, 0, None)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)

EXPOSURE = 1.25

def develop(a):
    """Scene-linear render (rows bottom-up, SUPER x the size) -> the finished frame, sRGB-encoded, rows bottom-up."""
    if SUPER > 1:
        h, w = a.shape[0] // SUPER, a.shape[1] // SUPER
        a = a.reshape(h, SUPER, w, SUPER, 3).mean(axis=(1, 3))
    a = a * EXPOSURE
    # The lens: glints bloom, the frame's bright side veils a little, the corners fall off.
    hot = np.clip(a - 1.15, 0.0, 5.0)
    a = np.minimum(a, 4.0) + 0.4 * _gauss(hot, 1.6) + 0.22 * _gauss(hot, 6.0)
    a = a * 0.92 + 0.08 * _gauss(a, 30.0)
    a = _gauss(a, 0.55)
    yy, xx = np.mgrid[0:H, 0:W]
    rad = np.hypot((xx - W / 2 + 0.5) / (W / 2), (yy - H / 2 + 0.5) / (W / 2)) / math.hypot(1.0, H / W)
    a = a * (1.0 - 0.28 * rad ** 2.4)[..., None]
    # The sensor: shot and read noise, mostly luminance.
    rs = np.random.RandomState(1976)
    lum = a @ np.array((0.2126, 0.7152, 0.0722))
    sig = 0.0045 + 0.014 * np.sqrt(np.clip(lum, 0, 1))
    a = a + (rs.randn(H, W, 1) * 0.8 + rs.randn(H, W, 3) * 0.45) * sig[..., None]
    # The film curve: straight to 0.6, a soft shoulder above; a touch less colour than the eye would want.
    a = np.clip(a, 0, None)
    a = np.where(a < 0.6, a, 0.6 + 0.4 * (1.0 - np.exp(-(a - 0.6) / 0.4)))
    lum = (a @ np.array((0.2126, 0.7152, 0.0722)))[..., None]
    a = lum + (a - lum) * 0.9
    return np.clip(srgb_enc(a), 0, 1)

def save_image(path, rgb, fmt, quality=QUALITY):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new('DB_mars_out', w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'          # (as stored: the pixels are already sRGB)
    out = np.ones((h, w, 4), dtype=np.float32)
    out[:, :, :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == 'JPEG':
        img.save(quality=quality)
    else:
        img.save()
    bpy.data.images.remove(img)

def render(sc):
    _cycles(sc, SAMPLES)
    c = sc.cycles
    c.max_bounces, c.diffuse_bounces, c.glossy_bounces = 4, 3, 2
    c.transmission_bounces = c.volume_bounces = 0
    c.caustics_reflective = c.caustics_refractive = False
    c.sample_clamp_indirect = 6.0
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02 if DRAFT else 0.008
    try:
        c.use_denoising = True
        c.denoiser = 'OPENIMAGEDENOISE'
    except Exception as ex:
        print('denoiser:', ex)
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.resolution_x, sc.render.resolution_y = W * SUPER, H * SUPER
    sc.render.resolution_percentage = 100
    bpy.ops.render.render(scene=sc.name)
    path = os.path.join(bpy.app.tempdir, 'db_mars.exr')
    bpy.data.images['Render Result'].save_render(path, scene=sc)
    im = bpy.data.images.load(path)
    a = _np_image(im)[:, :, :3].astype(np.float64)
    bpy.data.images.remove(im)
    try:
        os.remove(path)
    except OSError:
        pass
    return a


def main_mars():
    t0 = time.time()
    if CLEAN_PATH and os.path.abspath(CLEAN_PATH).replace('\\', '/').lower().startswith(os.path.abspath(ROOT).replace('\\', '/').lower() + '/'):
        raise SystemExit('--clean must point outside the repo: the game never ships the frame without its box')
    sc = _scene()
    _clear_scene(sc)
    CAM_Z[0] = float(ground_z(0.0, 0.0)[0]) + CAM_H
    PAD_ON[0] = False
    SITE_Z[0] = float(np.median(ground_z(SITE[0] + np.array((-6.0, -2.0, 2.0, 0.0)), SITE[1] + np.array((-3.0, 0.0, 1.0, -5.0)))))
    PAD_ON[0] = True
    info = {'terrain': build_terrain(sc, ground_material())}
    info['rocks'] = build_rocks(sc, rock_material())
    slab, annex = build_site(sc, metal_material('MARS_dark', (0.035, 0.036, 0.04), 0.4, 0.5), metal_material('MARS_mirror', (0.95, 0.95, 0.95), 1.0, 0.09))
    build_world(sc)
    build_camera(sc)
    box = fit_box(slab, annex)
    info['build_s'] = round(time.time() - t0, 1)
    t1 = time.time()
    a = render(sc)
    info['render_s'] = round(time.time() - t1, 1)
    frame = develop(a)
    if CLEAN_PATH:
        os.makedirs(os.path.dirname(os.path.abspath(CLEAN_PATH)), exist_ok=True)
        small = frame.reshape(H // 2, 2, W // 2, 2, 3).mean(axis=(1, 3))
        save_image(CLEAN_PATH, small, 'PNG')
    x0, y0, x1, y1 = box
    frame[H - y1:H - y0, x0:x1, :] = 0.0                     # (rows run bottom-up)
    os.makedirs(os.path.dirname(os.path.abspath(OUT_PATH)), exist_ok=True)
    save_image(OUT_PATH, frame, 'JPEG')
    info.update({'box': box, 'box_frac': (round((x1 - x0) / W, 3), round((y1 - y0) / H, 3)), 'file': OUT_PATH,
                 'bytes': os.path.getsize(OUT_PATH), 'cam_z': round(CAM_Z[0], 2), 'site_z': round(SITE_Z[0], 2),
                 'site_px': [round(float(v)) for v in project(site_point(0.0))[0]], 'samples': SAMPLES})
    print('MARS_RESULT', info)

main_mars()
