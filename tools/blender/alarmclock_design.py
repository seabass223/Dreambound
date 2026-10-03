# Dreambound: the ending's alarm clock (src/props/clock.js), a modern bedside clock. Executed inside dbkit.py's
# namespace by build_alarmclock.py.
#
# Frame: centred on the clock's middle, y up, +z out of the face (the clock looks down +z), x to the right as you
# face it. A long pill (a stadium W x H with round ends, D deep) in black gloss, a thin brushed-gunmetal rim round the
# front, a black glass face set a little into the rim, and behind the glass the LEDs: four seven-segment digits (each
# segment a long hexagon with mitred ends, the digits leaning a few degrees), a colon of two dots, small AM and PM
# letters at the right and an alarm bell at the left. A snooze bar along the top, a speaker grille on the back.
#
# Materials (one mesh each): 'body' (the shell), 'rim' (the rim and the snooze bar: alarmclock_brushed.png, a
# brushed-steel tile made here, along u), 'glass' (the face's glass), 'face' (the black well behind the glass, where the
# game draws the LEDs' glow), 'led' (every segment) and 'grille' (the speaker's slots). No AO atlas: the clock floats in
# the dark, and its LEDs light it.
#
# The LEDs carry their id in uv.x: id + s, s in (0, 1) along the segment, and uv.y across it (0..1; 0.5 for the dots,
# letters and the bell, which glow evenly). Ids: digit k (0..3, left to right) segment j (a b c d e f g = 0..6) is
# 7k + j; the colon 28, AM 29, PM 30, the bell 31. The game lights them from uniforms (one shader for all).
# Named empties: META (w, h, d, glass_z, led_z, well_z, ids, and the layout: digit_x[4], digit_h, digit_w, stroke,
# slant, colon_y, am_x, ind_y, bell_x) and FACE (the glass's centre).

import numpy as np

MODELS = ROOT + '/public/models/'

W, H, D = 1.0, 0.3125, 0.15        # the pill: 3.2 : 1, sized so its digits read from a couple of metres
R = H / 2                          # end radius
A = W / 2 - R                      # half the distance between the end circles' centres
ZB, ZF = -D / 2, D / 2             # back, front (the rim's face)
RIM_W = 0.016                      # the rim's width seen from the front
ZR0 = ZF - 0.024                   # where the rim band starts on the sides
ZG = ZF - 0.006                    # the glass
ZW = ZG - 0.012                    # the black well behind it
ZL = ZG - 0.004                    # the LEDs
NS = 28                            # outline points per round end

# Digits (metres on the face): height, width, stroke, the gap between segments, the lean, spacing.
HD, WD, T, GAP = 0.215, 0.108, 0.0255, 0.0035
SLANT = math.tan(math.radians(7.0))
PAIR = WD + 0.032                  # digit pitch within the hours and within the minutes
COLON_GAP = 0.07                   # between the hours and the minutes (edge to edge)
DIGIT_X = [-(COLON_GAP / 2 + WD / 2) - PAIR, -(COLON_GAP / 2 + WD / 2), COLON_GAP / 2 + WD / 2, COLON_GAP / 2 + WD / 2 + PAIR]
ID_COLON, ID_AM, ID_PM, ID_BELL = 28, 29, 30, 31
COLON_Y = 0.048                    # the colon's dots, above and below the middle
AM_X = DIGIT_X[3] + WD / 2 + 0.058  # the AM and PM letters' centres (at y = +-0.032)
BELL_X = DIGIT_X[0] - WD / 2 - 0.058

MATS.update({
    'body': (srgb(16, 17, 19), 0.22), 'rim': (srgb(104, 108, 116), 0.3), 'glass': ((0.004, 0.004, 0.005), 0.04),
    'face': ((0.004, 0.004, 0.005), 0.8), 'led': ((0.028, 0.392, 1.0), 0.5), 'grille': ((0.01, 0.01, 0.011), 0.8),
})
NO_BAKE = {'body', 'rim', 'glass', 'face', 'led', 'grille', 'collider'}
BAKE_MATS = set()


# ============================================================================ outlines
def stadium(d=0.0, n=NS):
    """The pill's outline inset by d, counter-clockwise seen from +z: the right end from -90 to 90 degrees, then the left
    end from 90 to 270. The same point count at every inset, so outlines loft into quads."""
    r = R - d
    pts = []
    for i in range(n + 1):
        t = -PI / 2 + PI * i / n
        pts.append((A + r * math.cos(t), r * math.sin(t)))
    for i in range(n + 1):
        t = PI / 2 + PI * i / n
        pts.append((-A + r * math.cos(t), r * math.sin(t)))
    return pts


def loft(mat, stations, cap_back=False, cap_front=False, tint=WHITE):
    """Rings of the outline at (inset, z) stations, joined in order; quads face outward (or forward, as the inset
    grows)."""
    bm = bmesh.new()
    rings = []
    for (d, z) in stations:
        rings.append([bm.verts.new((x, y, z)) for (x, y) in stadium(d)])
    m = len(rings[0])
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(m):
            l = (k + 1) % m
            bm.faces.new((a[k], a[l], b[l], b[k]))
    if cap_back:
        bm.faces.new(list(reversed(rings[0])))
    if cap_front:
        bm.faces.new(rings[-1])
    emit(bm, mat, tint=tint, smooth=True)


def rounded(d0, z0, r, a0, a1, n):
    """Stations round a quarter (or any arc) of radius r centred at (d0, z0) in the (inset, z) plane, angles in
    degrees from +inset toward +z."""
    out = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        out.append((d0 + r * math.cos(a), z0 + r * math.sin(a)))
    return out


# ============================================================================ shell
def build_shell():
    # The body: a soft round over the back, straight sides to the rim.
    rb = 0.042
    back = rounded(rb, ZB + rb, rb, 180, 270, 8)          # from (0, ZB+rb) round to (rb, ZB)
    back = list(reversed(back))                           # back face edge first
    loft('body', back + [(0.0, ZR0)], cap_back=True)
    # The rim: the side band, a small round over its front edge, the face ring, a polished chamfer down to the glass.
    cr = 0.004
    st = [(0.0, ZR0), (0.0, ZF - cr)] + rounded(cr, ZF - cr, cr, 180, 90, 4)[1:]
    st += [(RIM_W - 0.003, ZF), (RIM_W, ZF - 0.003), (RIM_W, ZG)]
    loft('rim', st)
    # The well behind the glass, and the glass.
    loft('face', [(RIM_W, ZG), (RIM_W, ZW)], cap_front=False)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, y, ZW)) for (x, y) in stadium(RIM_W)])
    emit(bm, 'face')
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, y, ZG)) for (x, y) in stadium(RIM_W)])
    emit(bm, 'glass')
    # The snooze bar along the top.
    B('rim', 0.36, 0.012, 0.03, 0.0, R + 0.002, -0.012, bevel=0.005, seg=3, smooth=True)
    # The back: a speaker grille (slots) and a round set button, a little rubber foot strip under it.
    for i in range(7):
        y = -0.045 + i * 0.015
        B('grille', 0.13, 0.0055, 0.004, 0.22, y, ZB - 0.0005, bevel=0.0018)
    CYL('rim', 0.014, 0.014, 0.008, -0.24, 0.02, ZB - 0.002, segs=24, rx=PI / 2)
    CYL('rim', 0.009, 0.009, 0.008, -0.24, -0.035, ZB - 0.002, segs=20, rx=PI / 2)
    B('body', 0.5, 0.006, 0.06, 0.0, -R + 0.0015, 0.0, bevel=0.0025, tint=(0.6, 0.6, 0.6))


# ============================================================================ LEDs
def lean(x, y):
    return (x + y * SLANT, y)


def hexagon(p0, p1, t):
    """A segment from p0 to p1 (centre line), t thick, its ends mitred to points (45 degrees). Returns the outline
    and each point's (along, across) in 0..1."""
    (x0, y0), (x1, y1) = p0, p1
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    nx, ny = -uy, ux
    h = t / 2
    local = [(0.0, 0.0), (h, h), (L - h, h), (L, 0.0), (L - h, -h), (h, -h)]
    pts = [(x0 + ux * s + nx * c, y0 + uy * s + ny * c) for (s, c) in local]
    st = [(s / L, 0.5 + c / t) for (s, c) in local]
    return pts, st


def digit_segments(cx):
    """The seven segments (a b c d e f g) of a digit centred at (cx, 0), as (outline, st) in face coordinates."""
    xs, ys = WD / 2 - T / 2, HD / 2 - T / 2   # the segments' centre lines
    g = GAP
    segs = [
        ((-xs + g, ys), (xs - g, ys)),       # a top
        ((xs, ys - g), (xs, g)),             # b top right
        ((xs, -g), (xs, -ys + g)),           # c bottom right
        ((xs - g, -ys), (-xs + g, -ys)),     # d bottom
        ((-xs, -ys + g), (-xs, -g)),         # e bottom left
        ((-xs, g), (-xs, ys - g)),           # f top left
        ((-xs + g, 0.0), (xs - g, 0.0)),     # g middle
    ]
    out = []
    for (p0, p1) in segs:
        pts, st = hexagon(p0, p1, T)
        out.append(([lean(cx + x, y) for (x, y) in pts], st))
    return out


def led_poly(pts, st, ident):
    """One flat LED face facing +z (wound counter-clockwise whichever way the outline runs)."""
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts, st = pts[::-1], st[::-1]
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, y, ZL)) for (x, y) in pts])
    uvs = [(ident + 0.08 + 0.84 * s, t) for (s, t) in st]
    emit(bm, 'led', uvface=lambda f: uvs)


def led_disc(cx, cy, r, ident, n=20):
    pts = [(cx + r * math.cos(2 * PI * i / n), cy + r * math.sin(2 * PI * i / n)) for i in range(n)]
    led_poly(pts, [(0.5, 0.5)] * n, ident)


FONTS = ['C:/Windows/Fonts/bahnschrift.ttf', 'C:/Windows/Fonts/arialbd.ttf']


def text_led(s, x, y, size, ident):
    """Text as LED geometry (Bahnschrift, else Arial Bold, else Blender's own face), centred at (x, y), letters `size`
    tall (the font's em), lit evenly."""
    cu = bpy.data.curves.new('DB_clock_txt', 'FONT')
    cu.body = s
    for p in FONTS:
        if os.path.exists(p):
            try:
                cu.font = bpy.data.fonts.load(p, check_existing=True)
                break
            except Exception:
                pass
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.space_character = 1.08
    cu.resolution_u = 6
    ob = bpy.data.objects.new('DB_clock_txt', cu)
    sc = bpy.context.scene
    sc.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    # (The curve lies in its object's XY plane facing +Z: read as the face's x, y, facing +z.)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=(x, y, ZL), verts=bm.verts)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    emit(bm, 'led', uvfn=lambda co, n: (ident + 0.5, 0.5))
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)


def bell(cx, cy, s, ident):
    """A small alarm bell, `s` tall: a round crown over straight shoulders flaring to a wide lip, a knob on top and the
    clapper hanging under the lip."""
    half = [(0.0, 0.5), (0.1, 0.49), (0.19, 0.46), (0.25, 0.41), (0.28, 0.34), (0.3, 0.24), (0.31, 0.12), (0.33, 0.0),
            (0.36, -0.1), (0.41, -0.19), (0.47, -0.26), (0.52, -0.3), (0.53, -0.36)]
    prof = half + [(-x, y) for (x, y) in reversed(half[1:])]
    pts = [(cx + px * s, cy + py * s) for (px, py) in prof]
    led_poly(pts, [(0.5, 0.5)] * len(pts), ident)
    led_disc(cx, cy - 0.47 * s, 0.09 * s, ident, 14)
    led_disc(cx, cy + 0.55 * s, 0.06 * s, ident, 10)


def build_leds():
    for k, cx in enumerate(DIGIT_X):
        for j, (pts, st) in enumerate(digit_segments(cx)):
            led_poly(pts, st, 7 * k + j)
    for cy in (COLON_Y, -COLON_Y):
        x, y = lean(0.0, cy)
        led_disc(x, y, 0.0115, ID_COLON)
    text_led('AM', AM_X, 0.032, 0.034, ID_AM)
    text_led('PM', AM_X, -0.032, 0.034, ID_PM)
    bell(BELL_X, 0.0, 0.052, ID_BELL)


# ============================================================================ brushed steel tile
def wrap_blur(a, r, axis):
    """Box blur of radius r (pixels) along an axis, wrapping round (the tile stays seamless)."""
    out = np.zeros_like(a)
    for k in range(-r, r + 1):
        out += np.roll(a, k, axis=axis)
    return out / (2 * r + 1)


def brushed_tile(path, n=256):
    """Brushed metal: fine streaks along u (repeated blurs of white noise along x, a little across), a few long
    scratches, and a slow sheen variation. Grey, about 0.55 to 0.8."""
    g = np.random.default_rng(7)
    a = g.random((n, n)).astype(np.float32)
    for _ in range(3):
        a = wrap_blur(a, 24, 1)
    a = wrap_blur(a, 1, 0)
    a = (a - a.mean()) / (a.std() + 1e-6)
    big = g.random((8, 8)).astype(np.float32)
    big = np.kron(big, np.ones((n // 8, n // 8), np.float32))
    for _ in range(2):
        big = wrap_blur(wrap_blur(big, n // 16, 0), n // 16, 1)
    v = 0.66 + 0.06 * a + 0.08 * (big - big.mean()) / (big.std() + 1e-6)
    for _ in range(40):                        # scratches: thin bright lines along u
        row = g.integers(0, n)
        x0, L = g.integers(0, n), g.integers(n // 6, n // 2)
        idx = (np.arange(L) + x0) % n
        v[row, idx] += 0.08 * g.random()
    v = np.clip(v, 0, 1)
    save_png(path, np.stack([v, v, v], axis=-1), colorspace='sRGB')


# ============================================================================ entry points
def build_all():
    build_shell()
    build_leds()
    # (the layout too: the game's glow behind the glass is drawn from it)
    empty('META', (0, 0, 0), w=W, h=H, d=D, glass_z=ZG, led_z=ZL, well_z=ZW, ids=32, digit_x=DIGIT_X, digit_h=HD,
          digit_w=WD, stroke=T, slant=SLANT, colon_y=COLON_Y, am_x=AM_X, ind_y=0.032, bell_x=BELL_X)
    empty('FACE', (0, 0, ZG))
    stats = realize()
    bpy.data.objects['COLLIDER']['noexport'] = 1     # (nothing to collide with: it floats)
    return stats


def bake_all():
    t0 = time.time()
    brushed_tile(MODELS + 'alarmclock_brushed.png')
    return {'textures_s': round(time.time() - t0, 1)}
