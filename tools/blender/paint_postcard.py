"""Dreambound: the postcard on the view deck's end table (src/props/deck.js), painted with the lounge design's paint
helpers. Its front is a close map of one island on the lounge globe (the small one at the map's east edge, 52 N), in the
globe's own colours, redrawn at the card's resolution from the same shader (lounge_design.globe_colour) rather than
cropped from the globe's 1024-wide texture; its back is card stock with a divider, address lines, a stamp, a postmark
and a few lines of illegible handwriting (no words: nothing in the world is written to be read).

Headless:   blender --background --factory-startup --python tools/blender/paint_postcard.py
Writes public/models/postcard.jpg: the front above, the back below, each CARD_PX pixels, sRGB.
"""
import os, math, random
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('lounge', 'lounge_', 'Dreambound_Lounge')
exec(compile(open(DESIGN, encoding='utf-8').read(), DESIGN, 'exec'))   # its paint helpers (nothing is built)
import numpy as np

CW, CH = 0.14, 0.09                  # the card (m): about 5.5 x 3.5 in
CARD_PX = (1400, 900)                # each side, 10 px per mm
BORDER = 0.006                       # the front's white border round the map
# The map's window on the globe (map u along from its west edge, v up from the south pole): centred on the island,
# 0.1 of the map tall (18 degrees of latitude) and as wide as the card's window needs (it runs on past u = 1, round
# the globe's seam, which the shader takes in its stride).
ISLAND_UV = (0.962, 0.793)
WIN_V = 0.1
SHARP = 9.0                          # the coast's edge and ink line, narrowed for the card's zoom (about 15 x the globe's)
OUT = ROOT + "/public/models/postcard.jpg"
STOCK = (0.6, 0.52, 0.38)            # card stock (linear): aged cream, dark enough to hold its contrast in daylight
INKBLUE = (0.06, 0.07, 0.16)
POSTMARK = (0.2, 0.18, 0.24)


def front():
    pw, ph = CARD_PX
    mw, mh = CW - 2 * BORDER, CH - 2 * BORDER
    win_u = WIN_V * (mw / mh) / 2    # the map is 2:1 (u spans twice the distance v does)
    u0, v0 = ISLAND_UV[0] - win_u / 2, ISLAND_UV[1] - WIN_V / 2

    def make(nt, pos, uv):
        m = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=uv, i1=(win_u, WIN_V, 1.0)).outputs[0]
        m = node(nt, 'ShaderNodeVectorMath', props={'operation': 'ADD'}, i0=m, i1=(u0, v0, 0.0)).outputs[0]
        return globe_colour(nt, pos, m, sharp=SHARP, detail=8.0)
    mpx = (round(pw * mw / CW), round(ph * mh / CH))
    mp = render_shader(mw, mh, mpx[0], mpx[1], make, samples=32)
    stock = render_shader(CW, CH, pw, ph, paper(STOCK, 2.3, CW, CH, stain=0.45, edge=0.003))
    # The graticule where it crosses the window (every 15 degrees, as on the globe), and a keyline round the map.
    sk = Sketch(CW, CH, 5)
    X = lambda u: BORDER + (u - u0) / win_u * mw
    Y = lambda v: BORDER + (v - v0) / WIN_V * mh
    for k in range(20, 28):
        u = k / 24
        if u0 < u < u0 + win_u:
            sk.line((X(u), BORDER), (X(u), CH - BORDER), 0.0002, SEPIA)
    for k in range(1, 12):
        v = k / 12
        if v0 < v < v0 + WIN_V:
            sk.line((BORDER, Y(v)), (CW - BORDER, Y(v)), 0.0002, SEPIA)
    sk.stroke([(BORDER, BORDER), (CW - BORDER, BORDER), (CW - BORDER, CH - BORDER), (BORDER, CH - BORDER)], 0.00035, INK, closed=True)
    ink = render_sketch(sk, pw, ph, samples=16)
    # The map printed on the stock: its paper grain shows through a little.
    out = stock.copy()
    y0, x0 = round(ph * BORDER / CH), round(pw * BORDER / CW)
    grain = stock[y0:y0 + mpx[1], x0:x0 + mpx[0]] / np.array(STOCK)
    out[y0:y0 + mpx[1], x0:x0 + mpx[0]] = mp * (0.8 + 0.2 * grain)
    return out * ink


def handwriting(sk, x0, y, x1, rs, h=0.0017):
    """A line of illegible cursive from x0 to x1 on baseline y: words of joined letters, each a loop or an arch of its own
    width and height (the odd tall one), leaning right."""
    x = x0
    while x < x1 - 0.004:
        pts = []
        cx = x
        for i in range(rs.randint(2, 7)):
            kind = rs.random()
            w = rs.uniform(0.0011, 0.0019)
            hh = h * (rs.uniform(1.9, 2.4) if kind < 0.18 else rs.uniform(0.75, 1.1))
            loop = rs.uniform(0.25, 0.75) if kind < 0.6 else rs.uniform(-0.1, 0.15)   # a loop (e, l, o) or an arch (n, m)
            for s in range(1, 15):
                t = s / 14 * 2 * PI
                px = cx + w * t / (2 * PI) - loop * w * 0.5 * math.sin(t)
                py = y + hh * 0.5 * (1 - math.cos(t))
                pts.append((px + (py - y) * 0.32, py))              # the lean
            cx += w
        if pts[-1][0] > x1:
            break
        pts.insert(0, (x - 0.0004, y + 0.0002))
        sk.stroke(pts, lambda f: 0.00021 * (0.7 + 0.3 * math.sin(f * 11 + 1)), INKBLUE)
        x = cx + rs.uniform(0.0018, 0.003)


def back():
    pw, ph = CARD_PX
    stock = render_shader(CW, CH, pw, ph, paper(STOCK, 6.1, CW, CH, stain=0.7, edge=0.003))
    sk = Sketch(CW, CH, 11)
    rs = random.Random(1911)
    # Divider, and the address lines to its right.
    sk.line((CW * 0.54, 0.012), (CW * 0.54, CH - 0.014), 0.0003, SEPIA)
    for k in range(4):
        sk.line((CW * 0.58, 0.014 + k * 0.0105), (CW - 0.008, 0.014 + k * 0.0105), 0.00016, SEPIA)
    # The stamp, top right: a perforated edge, a red ground, a cream vignette with a little globe on it.
    sx0, sx1, sy0, sy1 = CW - 0.027, CW - 0.008, CH - 0.03, CH - 0.007
    sk.poly([(sx0, sy0), (sx1, sy0), (sx1, sy1), (sx0, sy1)], (0.97, 0.95, 0.9), 0.001)
    sk.poly([(sx0 + 0.0012, sy0 + 0.0012), (sx1 - 0.0012, sy0 + 0.0012), (sx1 - 0.0012, sy1 - 0.0012), (sx0 + 0.0012, sy1 - 0.0012)], (0.5, 0.14, 0.1), 0.002)
    sk.poly([(sx0 + 0.0028, sy0 + 0.0028), (sx1 - 0.0028, sy0 + 0.0028), (sx1 - 0.0028, sy1 - 0.0028), (sx0 + 0.0028, sy1 - 0.0028)], (0.88, 0.8, 0.64), 0.003)
    gx, gy, gr = (sx0 + sx1) / 2, (sy0 + sy1) / 2 + 0.0008, 0.0052
    sk.circle(gx, gy, gr, 0.0003, (0.5, 0.14, 0.1), 0.004)
    for f in (-0.55, 0.0, 0.55):
        sk.line((gx - gr * math.sqrt(1 - f * f), gy + gr * f), (gx + gr * math.sqrt(1 - f * f), gy + gr * f), 0.0002, (0.5, 0.14, 0.1), 0.004)
    sk.stroke([(gx + gr * 0.45 * math.sin(2 * PI * k / 40), gy + gr * math.cos(2 * PI * k / 40)) for k in range(41)], 0.0002, (0.5, 0.14, 0.1), 0.004)
    sk.line((gx, gy - gr), (gx, gy + gr), 0.0002, (0.5, 0.14, 0.1), 0.004)
    step = 0.0019
    for k in range(int((sx1 - sx0) / step) + 1):
        for yy in (sy0, sy1):
            sk.disc(sx0 + k * step, yy, 0.00062, (1, 1, 1), 0.005)
    for k in range(int((sy1 - sy0) / step) + 1):
        for xx in (sx0, sx1):
            sk.disc(xx, sy0 + k * step, 0.00062, (1, 1, 1), 0.005)
    # The postmark over the stamp's left edge, and its cancelling waves across it.
    px, py = sx0 - 0.002, (sy0 + sy1) / 2 - 0.001
    sk.circle(px, py, 0.0092, 0.00028, POSTMARK, 0.006)
    sk.circle(px, py, 0.0064, 0.0002, POSTMARK, 0.006)
    sk.line((px - 0.0058, py), (px + 0.0058, py), 0.0002, POSTMARK, 0.006)
    for k in range(4):
        yy = py - 0.0045 + k * 0.003
        sk.stroke([(px + 0.0105 + t * 0.0003, yy + 0.0007 * math.sin(t * 0.55)) for t in range(80) if px + 0.0105 + t * 0.0003 < CW - 0.004], 0.00022, POSTMARK, 0.006)
    # A few lines of writing on the left, and a name-and-place on the address lines.
    for k in range(6):
        handwriting(sk, 0.009, CH - 0.02 - k * 0.0095, CW * 0.52 - (0.02 if k == 5 else 0.004), rs)
    for k in range(3):
        handwriting(sk, CW * 0.6, 0.0142 + (3 - k) * 0.0105 - 0.0105, CW - 0.012 - k * 0.012, rs, h=0.0015)
    ink = render_sketch(sk, pw, ph, samples=16)
    return stock * ink


def save_jpg(path, rgb, quality=88):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new('DB_postcard', w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    out = np.ones((h, w, 4), dtype=np.float32)
    out[:, :, :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = path
    img.file_format = 'JPEG'
    img.save(quality=quality)          # (as stored: no view transform, unlike save_render)
    bpy.data.images.remove(img)


f, b = front(), back()
card = np.concatenate([b, f], axis=0)          # rows run bottom-up: the back below, the front above
save_jpg(OUT, srgb_enc(card))
print('POSTCARD_RESULT', OUT, card.shape)
