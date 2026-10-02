# Dreambound: the old mine adit in the Mountain's south hillside (src/props/mine.js places it and builds the rock:
# the box cut, the headwall, the bore and its floor, fitted to the ground). Executed inside dbkit.py's namespace by
# build_mine.py. This file is the timber and the things left in it.
#
# Frame: origin on the floor at the portal, in the middle of the opening; y up; +z out of the portal (toward the cut
# and the path), -z into the hill; x across. The rock bore (mine.js) is BORE_HW either side of the axis, its crown
# about ROOF up, from the headwall's face (z = +0.3) to the heading (z = -HEADING).
#
# In it: timber sets (two posts battered in a little, a cap, knee braces) every 1.5 m with lagging boards over the
# caps and, in a few bays, behind the posts; a heavy portal set with boards above its cap; cribbing (stacked logs
# behind posts) retaining both sides of the cut in front of the portal; a narrow-gauge track on the left running out
# of the portal, with a stop block at its end and a rusty ore cart on it, half full of rock; on the right, beyond the
# cart, a workbench (a vise, a toolbox, a hammer, an oil can, the middle of its top left clear: CLUE), a pickaxe leaning
# on it, and over it an enamel-shaded mining lamp on a cable run along the caps from the portal, with a caged bulb
# halfway in; a shovel against the wall, crates and a bucket.
#
# Materials (one mesh each): 'wood' (every timber: mine_wood.png, a baked tile of old dark rough-sawn timber, with its
# normal map), 'rust' (rails, the cart's running gear, tools, fittings: mine_rust.png and its normal map), 'paint' (the
# cart's tub: old green enamel chipped through to rust and streaked: mine_paint.png and its normal map), 'enamel' (the lamp's shade:
# vertex colour only), 'stone' (the ore in the cart: the game's rock), 'emissive' (the bulbs). All but the bulbs take
# the baked AO atlas mine_ao.png. Named empties: META (sizes), LAMP and BULB (the two bulbs), CLUE (the clear spot on
# the bench, for what goes there). The COLLIDER holds the posts, the cribbing, the bench, the cart, the crates.

MODELS = ROOT + '/public/models/'
TMP = os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_mine')

MATS.update({'rust': (srgb(120, 72, 44), 0.8), 'enamel': (WHITE, 0.45), 'paint': (srgb(70, 84, 72), 0.7)})
BAKE_MATS.update({'rust', 'enamel', 'paint'})

BORE_HW = 1.45                     # the rock bore's half width (mine.js)
ROOF = 2.85                        # its crown
HEADING = 10.9                     # the heading's depth
SETS_Z = [-1.8, -3.3, -4.8, -6.3, -7.8, -9.3]
PORTAL_Z = -0.22
POST, POST_X, BATTER = 0.2, 1.17, 0.05
CAP_Y, CAP_H, CAP_W = 2.25, 0.22, 0.22
LAG_Y = CAP_Y + CAP_H              # lagging sits on the caps
TRACK_X, GAUGE = -0.52, 0.6
TRACK_Z = (2.6, -8.95)
CART_Z = -6.95
BENCH = dict(x0=0.5, x1=1.08, z0=-9.12, z1=-7.98, top=0.9)
CUT_Z, CUT_X, CRIB_H0 = 3.6, 2.02, 2.7   # cribbing: out to CUT_Z, at CUT_X, CRIB_H0 tall at the headwall

TIMBER = (1.0, 1.0, 1.0)           # the texture carries the colour
OLD = (0.82, 0.8, 0.78)            # greyer, older boards


def jit(c, k=0.08):
    f = 1.0 + rng.uniform(-k, k)
    return (c[0] * f, c[1] * f, c[2] * f)


def beam2(mat, p0, p1, w, h, tint=TIMBER, bevel=0.012):
    beam(mat, p0, p1, w, h, tint=tint, bevel=bevel)


# ============================================================================ timber
def timber_set(z, heavy=False):
    t = POST + (0.08 if heavy else 0.0)
    ch = CAP_H + (0.08 if heavy else 0.0)
    for s in (-1, 1):
        x0 = s * (POST_X + (0.03 if heavy else 0.0))
        b = BATTER if not heavy else 0.0
        beam2('wood', (x0, -0.05, z), (x0 - s * b, CAP_Y, z), t, t, jit(TIMBER))
        C(x0 - s * b / 2, CAP_Y / 2, z, t, CAP_Y, t)
        if not heavy:   # knee braces
            beam2('wood', (s * (POST_X - 0.08), 1.72, z), (s * 0.72, CAP_Y - 0.06, z), 0.1, 0.12, jit(TIMBER))
    L = (2 * BORE_HW + 0.3) if not heavy else 3.6
    B('wood', L, ch, CAP_W + (0.06 if heavy else 0.0), 0, CAP_Y + ch / 2, z, tint=jit(TIMBER), bevel=0.015, grain=0)
    # blocking wedges over the cap's ends, against the rock
    for s in (-1, 1):
        B('wood', 0.2, 0.1, 0.16, s * 1.05, CAP_Y + ch + 0.05, z, tint=jit(OLD), bevel=0.01, ry=rng.uniform(-0.2, 0.2))


def lagging(z0, z1, missing=0.12):
    """Boards along the drive over the caps between two sets."""
    n = 12
    for i in range(n):
        if rng.random() < missing:
            continue
        x = -1.3 + (i + 0.5) * 2.6 / n + rng.uniform(-0.015, 0.015)
        y = LAG_Y + 0.022 + rng.uniform(-0.01, 0.01)
        B('wood', 2.6 / n - 0.03, 0.04, abs(z1 - z0) + 0.2 + rng.uniform(-0.05, 0.05), x, y, (z0 + z1) / 2,
          tint=jit(OLD, 0.12), bevel=0.006, grain=2, rx=rng.uniform(-0.02, 0.02))


def wall_lagging(side, z0, z1):
    x = side * (POST_X + POST / 2 + 0.03)
    for i in range(8):
        y = 0.25 + i * 0.26
        if rng.random() < 0.15:
            continue
        B('wood', 0.035, 0.22, abs(z1 - z0) + 0.2, x, y, (z0 + z1) / 2, tint=jit(OLD, 0.12), bevel=0.005, grain=2,
          rz=rng.uniform(-0.03, 0.03))


def portal():
    timber_set(PORTAL_Z, heavy=True)
    # boards stood on the portal cap up to the headwall's lip
    for i in range(9):
        x = -1.6 + (i + 0.5) * 3.2 / 9
        h = 0.55 + rng.uniform(-0.04, 0.04)
        B('wood', 3.2 / 9 - 0.025, h, 0.05, x, CAP_Y + CAP_H + 0.08 + h / 2, PORTAL_Z + 0.1, tint=jit(OLD, 0.1), bevel=0.006, grain=1)
    C(0, CAP_Y + 0.6, PORTAL_Z, 3.4, 0.9, 0.35)


def cribbing():
    """Logs stacked behind posts along both sides of the cut, stepping down away from the portal."""
    for s in (-1, 1):
        x = s * CUT_X
        for k, zc in enumerate((0.3, 1.45, 2.6, CUT_Z)):
            h = CRIB_H0 * (1 - 0.8 * (zc - 0.3) / (CUT_Z - 0.3)) + 0.25
            CYL('wood', 0.09, 0.1, h + 0.3, x - s * 0.02, (h + 0.3) / 2 - 0.3, zc, segs=9, tint=jit(OLD))
        r = 0.1
        y = r - 0.05
        while y < CRIB_H0 + 0.2:
            # this log reaches out as far as the stack is still that tall
            zmax = 0.3 + (1 - (y - 0.1) / (CRIB_H0 * 1.0 + 0.2)) * (CUT_Z - 0.3) / 0.8
            zmax = min(CUT_Z + 0.25, zmax)
            if zmax > 0.6:
                p0 = (x + s * 0.2, y, 0.05)
                p1 = (x + s * 0.2 + rng.uniform(-0.02, 0.02), y, zmax)
                emit(bm_cyl(r, r * 0.95, zmax - 0.05, 9, True), 'wood', xf((p0[0] + p1[0]) / 2, y, (0.05 + zmax) / 2, 0, PI / 2),
                     jit(OLD, 0.12), 1.0, 1, None, True)
            y += 2 * r - 0.01
            r = rng.uniform(0.09, 0.115)
        C(x + s * 0.2, CRIB_H0 / 2, (0.05 + CUT_Z) / 2, 0.3, CRIB_H0, CUT_Z)


# ============================================================================ track and cart
def track():
    z0, z1 = TRACK_Z
    z = z0
    while z > z1:
        B('wood', 1.0, 0.08, 0.13, TRACK_X + rng.uniform(-0.03, 0.03), 0.01, z, ry=rng.uniform(-0.05, 0.05),
          tint=jit(OLD, 0.15), bevel=0.01, grain=0)
        z -= 0.55 + rng.uniform(-0.05, 0.05)
    for s in (-1, 1):
        x = TRACK_X + s * GAUGE / 2
        B('rust', 0.045, 0.02, z0 - z1, x, 0.06, (z0 + z1) / 2)      # foot
        B('rust', 0.018, 0.05, z0 - z1, x, 0.095, (z0 + z1) / 2)     # web
        B('rust', 0.04, 0.025, z0 - z1, x, 0.13, (z0 + z1) / 2)      # head
    # stop block at the end
    B('wood', 0.9, 0.22, 0.24, TRACK_X, 0.2, z1 - 0.05, tint=jit(OLD), bevel=0.02, grain=0)
    C(TRACK_X, 0.15, z1 - 0.05, 0.9, 0.3, 0.24)


def _tub_frame(y, wb, db, wt, dt, h):
    """Half width and half depth of the tapered tub at height y above its floor."""
    k = min(max(y / h, 0.0), 1.0)
    return (wb + (wt - wb) * k) / 2, (db + (dt - db) * k) / 2


def ore_cart(z):
    """A side-plate ore car: a tapered riveted steel tub (rolled rim, corner angles, straps and a band, an end door on
    two hinges with a latch) on a channel-iron frame with axle boxes, four spoked, flanged wheels, oak bumpers with a
    coupling and a link at each end, a grab handle, and a heaped load of broken rock. The tub is painted steel gone to
    rust (the 'paint' tile); the running gear bare rusted iron."""
    g = G(TRACK_X, 0.0, z, 0.0)
    IRON = (0.62, 0.56, 0.52)          # bare iron, darker than the rust tile alone
    PAINT = (1.0, 1.0, 1.0)
    WR, AXZ = 0.15, 0.34               # wheel radius, axle offsets along the car
    YA = 0.13 + WR                     # axle height: wheels on the railheads
    # ---- running gear
    for az in (-AXZ, AXZ):
        for sx in (-1, 1):
            x = sx * GAUGE / 2
            g.cyl('rust', WR, WR, 0.05, x, YA, az, segs=20, rz=PI / 2, tint=IRON, caps=False)                 # tread
            g.cyl('rust', WR - 0.028, WR - 0.028, 0.045, x, YA, az, segs=20, rz=PI / 2, tint=mul(IRON, 0.8), caps=False)   # rim inside
            g.cyl('rust', WR + 0.022, WR + 0.022, 0.014, x - sx * 0.03, YA, az, segs=20, rz=PI / 2, tint=IRON)  # flange
            g.cyl('rust', 0.045, 0.045, 0.09, x, YA, az, segs=10, rz=PI / 2, tint=mul(IRON, 0.9))               # hub
            for k in range(6):                                                                              # spokes
                a = k * PI / 3 + (0.3 if az > 0 else 0.0)
                cy, cz = math.sin(a) * (WR - 0.07), math.cos(a) * (WR - 0.07)
                g.box('rust', 0.022, 0.024, WR - 0.05, x, YA + cy, az + cz, rx=-a, tint=mul(IRON, 0.85))
            # axle box bolted to the frame outside the wheel
            g.box('rust', 0.07, 0.12, 0.13, sx * (GAUGE / 2 + 0.085), YA + 0.01, az, tint=mul(IRON, 0.95))
            g.box('rust', 0.08, 0.02, 0.17, sx * (GAUGE / 2 + 0.085), YA + 0.075, az, tint=mul(IRON, 0.9))
        g.cyl('rust', 0.024, 0.024, GAUGE + 0.2, 0, YA, az, segs=8, rz=PI / 2, tint=mul(IRON, 0.8))              # axle
    # the frame: two channels along the car, two across at the ends
    for sx in (-1, 1):
        x = sx * (GAUGE / 2 + 0.085)
        g.box('rust', 0.07, 0.1, 1.22, x, YA + 0.13, 0, tint=IRON)
        g.box('rust', 0.02, 0.1, 1.22, x - sx * 0.03, YA + 0.13, 0, tint=mul(IRON, 0.9))
    for ez in (-0.58, 0.58):
        g.box('rust', 0.86, 0.1, 0.07, 0, YA + 0.13, ez, tint=IRON)
    # oak bumpers, iron-shod, with a drawbar, a coupling pin and a link
    for sz in (-1, 1):
        ez = sz * 0.66
        g.box('wood', 0.7, 0.16, 0.1, 0, YA + 0.13, ez, tint=jit(OLD), bevel=0.012)
        g.box('rust', 0.72, 0.02, 0.105, 0, YA + 0.215, ez, tint=IRON)
        g.box('rust', 0.72, 0.02, 0.105, 0, YA + 0.045, ez, tint=IRON)
        g.box('rust', 0.09, 0.07, 0.12, 0, YA + 0.13, ez + sz * 0.1, tint=mul(IRON, 0.9))
        g.cyl('rust', 0.014, 0.014, 0.13, 0, YA + 0.13, ez + sz * 0.13, segs=8, tint=mul(IRON, 0.8))
        g.put(bm_torus(0.045, 0.011, 12, 6), 'rust', 0, YA + 0.08, ez + sz * 0.17, rx=PI / 2 + 0.5, ry=PI / 2, tint=mul(IRON, 0.8))
    # ---- the tub
    y0, h = YA + 0.19, 0.6
    wb, db, wt, dt = 0.72, 1.0, 0.94, 1.26
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in [(-wb / 2, 0, -db / 2), (wb / 2, 0, -db / 2), (wb / 2, 0, db / 2), (-wb / 2, 0, db / 2),
                                     (-wt / 2, h, -dt / 2), (wt / 2, h, -dt / 2), (wt / 2, h, dt / 2), (-wt / 2, h, dt / 2)]]
    for f in [(0, 1, 2, 3), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.012)
    g.put(bm, 'paint', 0, y0, 0, tint=PAINT, tile=0.9)
    fr = lambda y: _tub_frame(y, wb, db, wt, dt, h)
    # rolled rim: a round bar round the top edge
    hx, hz = fr(h)
    rim = [Vector(g.p(sx * (hx + 0.012), y0 + h + 0.01, sz * (hz + 0.012))) for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1))]
    for a2, b2 in zip(rim, rim[1:]):
        TUBE('paint', [a2, b2], 0.018, 8, tint=mul(PAINT, 0.9))
    # corner angles, bottom to top
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        bx, bz = fr(0)
        tx, tz = fr(h)
        beam('paint', g.p(sx * (bx + 0.008), y0 + 0.01, sz * (bz + 0.008)), g.p(sx * (tx + 0.008), y0 + h - 0.01, sz * (tz + 0.008)),
             0.05, 0.05, tint=mul(PAINT, 0.85))
    # a band round the middle and straps up the sides, riveted
    rivets = []

    def strap(p0, p1, n):
        beam('paint', p0, p1, 0.055, 0.012, tint=mul(PAINT, 0.88))
        for i in range(n):
            t = (i + 0.5) / n
            rivets.append(tuple(p0[j] + (p1[j] - p0[j]) * t for j in range(3)))
    ym = h * 0.5
    mx, mz = fr(ym)
    for sx in (-1, 1):   # long sides: band and two straps
        strap(g.p(sx * (mx + 0.014), y0 + ym, -mz), g.p(sx * (mx + 0.014), y0 + ym, mz), 12)
        for sz in (-0.5, 0.5):
            strap(g.p(sx * (fr(0.03)[0] + 0.014), y0 + 0.03, sz * fr(0.03)[1]), g.p(sx * (fr(h - 0.04)[0] + 0.014), y0 + h - 0.04, sz * fr(h - 0.04)[1]), 6)
    for sz in (-1, 1):   # ends: band
        strap(g.p(-mx, y0 + ym, sz * (mz + 0.014)), g.p(mx, y0 + ym, sz * (mz + 0.014)), 7)
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):   # rivets down the corner angles
        for i in range(6):
            yy = 0.05 + i * (h - 0.1) / 5
            cx, cz = fr(yy)
            rivets.append(g.p(sx * (cx + 0.032), y0 + yy, sz * (cz + 0.004)))
    for r in rivets:
        SPH('paint', 0.009, r[0], r[1], r[2], 6, 4, tint=mul(PAINT, 0.8))
    # the end door on the +z end: a plate a little proud, two hinge straps and knuckles along the top, a latch
    door = bmesh.new()
    dvs = [door.verts.new(p) for p in [(-fr(0.08)[0] + 0.05, 0.08, fr(0.08)[1] + 0.02), (fr(0.08)[0] - 0.05, 0.08, fr(0.08)[1] + 0.02),
                                        (fr(h - 0.06)[0] - 0.05, h - 0.06, fr(h - 0.06)[1] + 0.02), (-fr(h - 0.06)[0] + 0.05, h - 0.06, fr(h - 0.06)[1] + 0.02)]]
    door.faces.new(dvs)
    bmesh.ops.solidify(door, geom=list(door.faces), thickness=0.01)
    g.put(door, 'paint', 0, y0, 0, tint=mul(PAINT, 0.95), tile=0.9)
    for sx in (-0.22, 0.22):
        beam('rust', g.p(sx, y0 + h - 0.05, fr(h - 0.05)[1] + 0.035), g.p(sx, y0 + 0.14, fr(0.14)[1] + 0.035), 0.045, 0.01, tint=IRON)
        g.cyl('rust', 0.018, 0.018, 0.1, sx, y0 + h - 0.03, fr(h)[1] + 0.03, segs=8, rz=PI / 2, tint=IRON)
    g.cyl('rust', 0.009, 0.009, fr(h)[0] * 2 + 0.06, 0, y0 + h - 0.03, fr(h)[1] + 0.03, segs=6, rz=PI / 2, tint=mul(IRON, 0.8))   # hinge pin
    g.box('rust', 0.5, 0.03, 0.03, 0, y0 + 0.1, fr(0.1)[1] + 0.05, tint=IRON)                                     # latch bar
    g.box('rust', 0.03, 0.08, 0.04, 0.27, y0 + 0.1, fr(0.1)[1] + 0.05, tint=mul(IRON, 0.85))                      # its keeper
    # a grab handle on the other end
    hz0 = -(fr(h - 0.12)[1] + 0.02)
    TUBE('rust', [Vector(g.p(-0.2, y0 + h - 0.12, hz0)), Vector(g.p(-0.2, y0 + h - 0.12, hz0 - 0.06)), Vector(g.p(0.2, y0 + h - 0.12, hz0 - 0.06)),
                  Vector(g.p(0.2, y0 + h - 0.12, hz0))], 0.013, 6, tint=IRON)
    # heaped with broken rock, higher in the middle
    for i in range(34):
        u, v = rng.uniform(-1, 1), rng.uniform(-1, 1)
        r = rng.uniform(0.06, 0.12)
        mound = 1 - 0.5 * (u * u + v * v)
        g.put(bm_sphere(r, 7, 5), 'stone', u * (wt / 2 - 0.1), y0 + h - 0.16 + 0.2 * mound + rng.uniform(-0.03, 0.03), v * (dt / 2 - 0.12),
              ry=rng.uniform(0, PI), rx=rng.uniform(-0.4, 0.4), s=(1.0, rng.uniform(0.55, 0.85), rng.uniform(0.75, 1.25)),
              tint=jit((0.85, 0.83, 0.8), 0.18), tile=4.0)
    g.col(0.98, 1.1, 1.45, 0, 0.55, 0)


# ============================================================================ the bench and the tools
def workbench():
    b = BENCH
    x0, x1, z0, z1, top = b['x0'], b['x1'], b['z0'], b['z1'], b['top']
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    for i in range(4):   # top planks, along z
        w = (x1 - x0) / 4
        B('wood', w - 0.008, 0.05, z0 - z1 + 0.12, x0 + w * (i + 0.5), top - 0.025, cz, tint=jit(TIMBER, 0.1), bevel=0.006, grain=2)
    for x in (x0 + 0.05, x1 - 0.05):
        for z in (z0 + 0.06, z1 - 0.06):
            B('wood', 0.08, top - 0.05, 0.08, x, (top - 0.05) / 2, z, tint=jit(TIMBER), bevel=0.008)
    B('wood', x1 - x0, 0.03, z1 - z0 - 0.1, cx, 0.22, cz, tint=jit(OLD), bevel=0.005, grain=2)        # shelf
    B('wood', 0.03, 0.25, z1 - z0 + 0.12, x1 + 0.01, top + 0.12, cz, tint=jit(OLD), bevel=0.005, grain=2)   # back board
    for zz in (z0 + 0.06, z1 - 0.06):   # rails
        B('wood', x1 - x0 - 0.1, 0.07, 0.04, cx, 0.5, zz, tint=jit(OLD), bevel=0.005, grain=0)
    C(cx, top / 2, cz, x1 - x0, top, z1 - z0 + 0.12)
    g = G(cx, top, cz, 0.0)
    # a vise at the inner end
    g.box('rust', 0.14, 0.1, 0.16, -0.12, 0.05, -0.47, tint=(0.55, 0.5, 0.48))
    g.box('rust', 0.16, 0.08, 0.03, -0.12, 0.12, -0.39, tint=(0.55, 0.5, 0.48))
    g.cyl('rust', 0.012, 0.012, 0.3, -0.12, 0.1, -0.35, segs=6, rx=PI / 2)
    # a wooden toolbox at the outer end, its handle a bar between gable ends
    g.box('wood', 0.3, 0.14, 0.5, -0.02, 0.07, 0.34, ry=0.08, tint=jit(OLD), bevel=0.006)
    for dz in (-0.24, 0.24):
        g.box('wood', 0.02, 0.14, 0.06, -0.02, 0.2, 0.34 + dz, ry=0.08, tint=jit(OLD))
    g.cyl('wood', 0.012, 0.012, 0.5, -0.02, 0.26, 0.34, segs=6, rx=PI / 2, ry=0.08)
    # a hammer and an oil can
    g.cyl('wood', 0.013, 0.015, 0.34, 0.12, 0.016, 0.02, segs=6, rx=PI / 2, ry=0.5)
    g.box('rust', 0.035, 0.035, 0.12, 0.12 + 0.08, 0.02, 0.02 - 0.14, ry=0.5 + PI / 2, tint=(0.45, 0.42, 0.4))
    g.cyl('rust', 0.045, 0.05, 0.1, -0.16, 0.05, 0.02, segs=12, tint=(0.7, 0.55, 0.35))
    g.cyl('rust', 0.006, 0.012, 0.12, -0.16, 0.14, -0.03, segs=6, rx=0.6)
    empty('CLUE', g.p(-0.02, 0.0, -0.1), ry=0.0, size=[0.36, 0.34])


def pickaxe(x, z, lean, ry):
    """Leaning against something at (x, z): the handle's foot on the floor, the head up top."""
    L = 0.92
    g = G(x, 0.0, z, ry)
    top = (0.0, L * math.cos(lean), -L * math.sin(lean))
    emit(bm_cyl(0.017, 0.02, L, 8, True), 'wood', xf(*g.p(top[0] / 2, top[1] / 2, top[2] / 2), g.ry, -lean), jit(TIMBER), 1.0, 1, None, True)
    hx, hy, hz = g.p(*top)
    # the head: two curved picks from an eye
    pts = []
    for i in range(9):
        t = (i / 8) * 2 - 1
        pts.append(Vector((hx + t * 0.3 * g.c, hy - 0.06 * t * t + 0.02, hz - t * 0.3 * g.s)))
    TUBE('rust', pts, 0.024, 6, tint=(0.5, 0.46, 0.44), r_end=0.006)
    SPH('rust', 0.035, hx, hy, hz, 8, 6, tint=(0.5, 0.46, 0.44))


def shovel(x, z, lean, ry):
    L = 1.05
    g = G(x, 0.0, z, ry)
    blade = g.p(0, 0.18, 0)
    top = g.p(0, 0.18 + L * math.cos(lean), -L * math.sin(lean))
    TUBE('wood', [Vector(blade), Vector(top)], 0.017, 6, tint=jit(TIMBER))
    g.put(bm_box(0.24, 0.3, 0.012), 'rust', 0, 0.15, 0.02, rx=-lean * 0.6, tint=(0.55, 0.45, 0.38))
    TUBE('wood', [Vector(top) + Vector((-0.07 * g.c, 0, 0.07 * g.s)), Vector(top) + Vector((0.07 * g.c, 0, -0.07 * g.s))], 0.014, 6)


def crates():
    for (x, y, z, s, ry) in ((0.72, 0.0, -10.2, 0.5, 0.12), (0.62, 0.5, -10.25, 0.42, -0.2), (-0.95, 0.0, -10.35, 0.45, 0.35)):
        g = G(x, y, z, ry)
        for i in range(4):   # slats on each side
            for side in range(4):
                a = side * PI / 2
                w = s / 4 - 0.01
                off = -s / 2 + (i + 0.5) * s / 4
                ox, oz = math.sin(a) * (s / 2 - 0.01), math.cos(a) * (s / 2 - 0.01)
                tx, tz = math.cos(a) * off, -math.sin(a) * off
                g.box('wood', 0.02 if side % 2 else w, s - 0.02, w if side % 2 else 0.02, ox + tx, s / 2, oz + tz, tint=jit(OLD, 0.12))
        g.box('wood', s - 0.02, 0.02, s - 0.02, 0, s - 0.01, 0, tint=jit(OLD, 0.1))
        g.box('wood', s - 0.04, 0.02, s - 0.04, 0, 0.01, 0, tint=jit(OLD, 0.1))
        for cx in (-1, 1):
            for cz in (-1, 1):
                g.box('wood', 0.045, s, 0.045, cx * (s / 2 - 0.02), s / 2, cz * (s / 2 - 0.02), tint=jit(TIMBER))
        g.col(s, s, s, 0, s / 2, 0)


def bucket(x, z):
    CYL('rust', 0.15, 0.12, 0.3, x, 0.15, z, segs=16, tint=(0.62, 0.52, 0.42), caps=False)
    CYL('rust', 0.12, 0.12, 0.01, x, 0.01, z, segs=16, tint=(0.5, 0.42, 0.36))
    pts = [Vector((x - 0.15, 0.3, z)), Vector((x - 0.08, 0.42, z)), Vector((x, 0.45, z)), Vector((x + 0.08, 0.42, z)), Vector((x + 0.15, 0.3, z))]
    TUBE('rust', pts, 0.006, 5)


# ============================================================================ lamps and cable
def mine_lamp(x, y, z):
    """An enamel reflector on a drop from the lagging: the bulb's centre at (x, y, z)."""
    TUBE('rust', [Vector((x, LAG_Y + 0.02, z)), Vector((x, y + 0.2, z))], 0.006, 5, tint=(0.2, 0.2, 0.2))
    CYL('rust', 0.03, 0.03, 0.08, x, y + 0.16, z, segs=10, tint=(0.35, 0.33, 0.3))
    # the shade: a shallow cone, green outside and white inside
    emit(bm_cyl(0.045, 0.2, 0.13, 20, False), 'enamel', xf(x, y + 0.07, z), srgb(46, 78, 58), 1.0, None, None, True)
    inner = bm_cyl(0.043, 0.195, 0.125, 20, False)
    bmesh.ops.reverse_faces(inner, faces=inner.faces)
    emit(inner, 'enamel', xf(x, y + 0.066, z), srgb(232, 230, 220), 1.0, None, None, True)
    SPH('emissive', 0.04, x, y, z, 12, 8)
    empty('LAMP', (x, y, z))


def caged_bulb(x, y, z):
    TUBE('rust', [Vector((x, CAP_Y - 0.01, z)), Vector((x, y + 0.12, z))], 0.006, 5, tint=(0.2, 0.2, 0.2))
    CYL('rust', 0.028, 0.028, 0.06, x, y + 0.09, z, segs=10, tint=(0.35, 0.33, 0.3))
    for k in range(4):
        a = (k + 0.5) * PI / 2
        TUBE('rust', [Vector((x + math.cos(a) * 0.035, y + 0.07, z + math.sin(a) * 0.035)),
                      Vector((x + math.cos(a) * 0.05, y, z + math.sin(a) * 0.05)),
                      Vector((x + math.cos(a) * 0.02, y - 0.07, z + math.sin(a) * 0.02))], 0.004, 4, tint=(0.3, 0.28, 0.26))
    SPH('emissive', 0.032, x, y, z, 10, 8)
    empty('BULB', (x, y, z))


def cable(points):
    TUBE('rust', [Vector(p) for p in points], 0.008, 5, tint=(0.12, 0.12, 0.12))


# ============================================================================ build
LAMP_P = (0.62, 1.95, -8.55)
BULB_P = (0.35, 1.98, -4.05)


def build_all():
    portal()
    for z in SETS_Z:
        timber_set(z)
    zs = [PORTAL_Z] + SETS_Z
    for a, b in zip(zs, zs[1:]):
        lagging(a, b, missing=0.08)
    lagging(SETS_Z[-1], -HEADING + 0.5, missing=0.35)
    wall_lagging(-1, -3.3, -4.8)
    wall_lagging(1, -1.8, -3.3)
    wall_lagging(-1, -7.8, -9.3)
    cribbing()
    track()
    ore_cart(CART_Z)
    workbench()
    pickaxe(1.0, -9.35, 0.3, 0.2)
    shovel(-1.18, -5.4, 0.22, -PI / 2 + 0.2)
    crates()
    bucket(0.85, -7.55)
    mine_lamp(*LAMP_P)
    caged_bulb(*BULB_P)
    # the cable: down through a gap in the lagging a metre in from the portal (from wherever it comes over the roof),
    # then along under the caps (sagging between them) to the bulb and the lamp
    gx = -1.3 + 8 * 2.6 / 12                      # (the gap between the eighth and ninth lagging boards)
    pts = [(gx, LAG_Y + 0.2, -1.0), (gx, LAG_Y - 0.02, -1.05), (0.35, CAP_Y - 0.1, -1.45), (0.35, CAP_Y - 0.03, SETS_Z[0])]
    for i, z in enumerate(SETS_Z[1:], 1):
        pts += [(0.35, CAP_Y - 0.1, (SETS_Z[i - 1] + z) / 2), (0.35, CAP_Y - 0.03, z)]
    pts += [(0.5, CAP_Y - 0.08, -8.2), (LAMP_P[0], CAP_Y - 0.03, LAMP_P[2])]
    cable(pts)
    empty('META', (0, 0, 0), bore_hw=BORE_HW, roof=ROOF, heading=HEADING, cut_z=CUT_Z, cut_x=CUT_X, crib_h=CRIB_H0,
          sets=[PORTAL_Z] + SETS_Z, cap_y=CAP_Y, track_x=TRACK_X, track_z=list(TRACK_Z))
    return realize()


# ============================================================================ textures
def _mix(nt, fac, a, b):
    m = node(nt, 'ShaderNodeMix', props={'data_type': 'RGBA', 'blend_type': 'MIX'})
    for sock, v in ((0, fac), (6, a), (7, b)):
        if hasattr(v, 'is_output'):
            nt.links.new(v, m.inputs[sock])
        elif isinstance(v, (int, float)):
            m.inputs[sock].default_value = v
        else:
            m.inputs[sock].default_value = (v[0], v[1], v[2], 1.0)
    return m.outputs[2]

def _ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(fac, r.inputs['Fac'])
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for (pos, col) in stops[1:-1]:
        e = els.new(pos)
        e.color = (*col, 1)
    return r.outputs['Color']

def _noise4(nt, vec, w, scale, detail=6.0, rough=0.55, distort=0.0):
    return node(nt, 'ShaderNodeTexNoise', props={'noise_dimensions': '4D'}, Vector=vec, W=w, Scale=scale,
                Detail=detail, Roughness=rough, Distortion=distort).outputs['Fac']

def _mapr(nt, v, a, b, lo=0.0, hi=1.0):
    return node(nt, 'ShaderNodeMapRange', props={'clamp': True}, Value=v, **{'From Min': a, 'From Max': b, 'To Min': lo, 'To Max': hi}).outputs[0]

def _stretch(nt, vec, w, ku, kv):
    v = node(nt, 'ShaderNodeVectorMath', props={'operation': 'MULTIPLY'}, i0=vec, i1=(ku, ku, kv)).outputs[0]
    return v, math_node(nt, 'MULTIPLY', w, kv)


def timber_fields(nt, vec, w):
    """Old rough-sawn mine timber, the grain along u: (grain lines, staining, checks, saw marks)."""
    gv, gw = _stretch(nt, vec, w, 0.08, 1.0)
    base = _noise4(nt, gv, gw, 2.0, 3.0, 0.5, 0.45)
    lines = _mapr(nt, math_node(nt, 'SINE', math_node(nt, 'MULTIPLY', base, 58.0)), 0.3, 1.0)
    mv, mw = _stretch(nt, vec, w, 0.4, 1.0)
    stain = _mapr(nt, _noise4(nt, mv, mw, 2.6, 5.0, 0.65), 0.3, 0.72)
    cv, cw = _stretch(nt, vec, w, 0.03, 1.0)
    crack = _noise4(nt, cv, cw, 3.4, 2.0, 0.5)
    crack = _mapr(nt, math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', crack, 0.5)), 0.0, 0.012, 1.0, 0.0)
    sparse = _mapr(nt, _noise4(nt, vec, w, 1.3, 2.0, 0.5), 0.5, 0.6)
    sv, sw = _stretch(nt, vec, w, 1.0, 0.02)
    saw = _mapr(nt, math_node(nt, 'SINE', math_node(nt, 'MULTIPLY', _noise4(nt, sv, sw, 1.0, 1.0, 0.3), 90.0)), 0.6, 1.0)
    return lines, stain, math_node(nt, 'MULTIPLY', crack, sparse), saw


def make_timber(nt, vec, w):
    lines, stain, crack, saw = timber_fields(nt, vec, w)
    col = _ramp(nt, stain, [(0.0, srgb(118, 88, 62)), (0.5, srgb(96, 76, 58)), (1.0, srgb(70, 62, 54))])
    col = _mix(nt, math_node(nt, 'MULTIPLY', lines, 0.38), col, srgb(52, 40, 30))
    col = _mix(nt, math_node(nt, 'MULTIPLY', saw, 0.12), col, srgb(130, 104, 80))
    pv, pw = _stretch(nt, vec, w, 0.05, 1.0)
    fine = _mapr(nt, _noise4(nt, pv, pw, 40.0, 2.0, 0.5), 0.45, 0.7)
    col = _mix(nt, math_node(nt, 'MULTIPLY', fine, 0.2), col, srgb(62, 50, 40))
    return _mix(nt, math_node(nt, 'MULTIPLY', crack, 0.9), col, srgb(24, 19, 15))


def make_timber_height(nt, vec, w):
    lines, stain, crack, saw = timber_fields(nt, vec, w)
    h = math_node(nt, 'ADD', 0.5, math_node(nt, 'MULTIPLY', lines, -0.25))
    h = math_node(nt, 'ADD', h, math_node(nt, 'MULTIPLY', saw, 0.12))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', crack, 0.4))
    return node(nt, 'ShaderNodeCombineColor', Red=h, Green=h, Blue=h).outputs[0]


def rust_fields(nt, vec, w):
    a = _noise4(nt, vec, w, 7.0, 6.0, 0.62, 0.25)
    b = _noise4(nt, vec, w, 24.0, 4.0, 0.6)
    pits = _mapr(nt, _noise4(nt, vec, w, 60.0, 2.0, 0.5), 0.62, 0.75)
    scale = _mapr(nt, a, 0.4, 0.66)
    return scale, b, pits


def make_rust(nt, vec, w):
    scale, b, pits = rust_fields(nt, vec, w)
    col = _ramp(nt, scale, [(0.0, srgb(58, 48, 42)), (0.4, srgb(84, 56, 40)), (0.75, srgb(118, 70, 40)), (1.0, srgb(104, 58, 34))])
    col = _mix(nt, math_node(nt, 'MULTIPLY', b, 0.3), col, srgb(52, 36, 28))
    return _mix(nt, math_node(nt, 'MULTIPLY', pits, 0.55), col, srgb(36, 24, 18))


def make_rust_height(nt, vec, w):
    scale, b, pits = rust_fields(nt, vec, w)
    h = math_node(nt, 'ADD', 0.5, math_node(nt, 'MULTIPLY', scale, 0.2))
    h = math_node(nt, 'ADD', h, math_node(nt, 'MULTIPLY', b, 0.12))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', pits, 0.3))
    return node(nt, 'ShaderNodeCombineColor', Red=h, Green=h, Blue=h).outputs[0]


def paint_fields(nt, vec, w):
    """Old enamel on steel, v down the plates: (bare: chipped through to rust 0..1, streaks 0..1, the rust's mottle)."""
    chips = _noise4(nt, vec, w, 5.0, 6.0, 0.68, 0.2)
    bare = _mapr(nt, chips, 0.54, 0.6)                       # hard-edged chips
    wear = _mapr(nt, _noise4(nt, vec, w, 1.6, 3.0, 0.5), 0.35, 0.75)
    bare = math_node(nt, 'MAXIMUM', bare, math_node(nt, 'MULTIPLY', _mapr(nt, chips, 0.44, 0.58), wear))
    sv, sw = _stretch(nt, vec, w, 3.0, 0.12)                 # streaks run down (along v)
    streak = _mapr(nt, _noise4(nt, sv, sw, 4.0, 3.0, 0.5), 0.5, 0.72)
    mott = _noise4(nt, vec, w, 22.0, 4.0, 0.6)
    return bare, streak, mott


def make_paint(nt, vec, w):
    bare, streak, mott = paint_fields(nt, vec, w)
    fade = _mapr(nt, _noise4(nt, vec, w, 2.2, 4.0, 0.55), 0.3, 0.7)
    paint = _mix(nt, fade, srgb(58, 74, 62), srgb(86, 98, 84))           # faded green enamel, chalky where it's worn
    paint = _mix(nt, math_node(nt, 'MULTIPLY', streak, 0.55), paint, srgb(92, 58, 38))   # rust bleeding down it
    rust = _ramp(nt, mott, [(0.0, srgb(60, 40, 30)), (0.5, srgb(112, 64, 36)), (1.0, srgb(78, 48, 32))])
    return _mix(nt, bare, paint, rust)


def make_paint_height(nt, vec, w):
    bare, streak, mott = paint_fields(nt, vec, w)
    h = math_node(nt, 'SUBTRACT', 0.55, math_node(nt, 'MULTIPLY', bare, 0.25))
    h = math_node(nt, 'ADD', h, math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', mott, bare), 0.12))
    return node(nt, 'ShaderNodeCombineColor', Red=h, Green=h, Blue=h).outputs[0]


def bake_all():
    t0 = time.time()
    os.makedirs(TMP, exist_ok=True)
    out = {}
    bake_tile(MODELS + 'mine_wood.png', make_timber, 1024)
    h = bake_tile(os.path.join(TMP, 'mine_wood_h.png'), make_timber_height, 1024, colorspace='Non-Color')
    normal_from_height(MODELS + 'mine_wood_normal.png', h[:, :, 0], strength=5.0)
    bake_tile(MODELS + 'mine_rust.png', make_rust, 512)
    h = bake_tile(os.path.join(TMP, 'mine_rust_h.png'), make_rust_height, 512, colorspace='Non-Color')
    normal_from_height(MODELS + 'mine_rust_normal.png', h[:, :, 0], strength=3.0)
    bake_tile(MODELS + 'mine_paint.png', make_paint, 512)
    h = bake_tile(os.path.join(TMP, 'mine_paint_h.png'), make_paint_height, 512, colorspace='Non-Color')
    normal_from_height(MODELS + 'mine_paint_normal.png', h[:, :, 0], strength=4.0)
    out['textures_s'] = round(time.time() - t0, 1)
    out['ao'] = bake_ao(samples=96, distance=0.7)
    out['seconds'] = round(time.time() - t0, 1)
    return out
