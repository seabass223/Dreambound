# Dreambound: the view deck on the Dome stack's west-northwest rim (src/props/deck.js places it; src/world/stacks/dome.js
# picks the spot). Executed inside dbkit.py's namespace by build_deck.py.
#
# Frame: origin at the centre of the deck's footprint on the (levelled) ground, y up, +z toward the view (the deck's
# front edge), +x to the LEFT as you face the view. A low platform of weathered cedar (W x D, its boards' tops TOP above
# the ground) with a picture-frame border and a single step at the back; two Adirondack chairs side by side facing +z
# (copied from the garden's in cabin_design.py, a little finer since they are seen up close from the seat), and a slatted
# end table between them with a small lantern on it.
#
# Materials (one mesh each): 'wood' (every board, the chairs, the table: deck_wood.png, a Blender-baked tile of weathered
# cedar with its normal map, times the vertex tint and the baked AO atlas deck_ao.png), 'metal_black' (screw heads, the
# lantern's frame and bail) and 'emissive' (the lantern's frosted panes). Named empties: CHAIR_i (each chair's frame, `ry`
# its yaw), SEAT_i (the seated eye), STAND_i (where the sitter stands up, on the deck in front of the chair), LANTERN (the
# glow's centre) and META (the deck's size). The COLLIDER holds the platform, the step, the chairs and the table.

MODELS = ROOT + '/public/models/'
TMP = os.path.join(os.environ.get('TEMP', '/tmp'), 'dreambound_deck')

W, D = 3.0, 2.4                    # platform footprint (x, z)
HW, HD = W / 2, D / 2
TOP = 0.2                          # deck surface above the ground
BT = 0.028                         # board thickness
BW = 0.14                          # border board width
GAP = 0.006                        # gap between boards
STEP_W, STEP_D, STEP_TOP = 1.4, 0.34, 0.1
CHAIRS = [(-0.78, -0.22, 0.1), (0.78, -0.22, -0.1)]   # x, z, yaw (toed in a touch)
TABLE = (0.0, -0.08)
TABLE_TOP = 0.5
EYE = (0.0, 1.1, -0.36)            # seated eye in the chair's frame, above the deck (the head against the back slats)
STAND = (0.0, 0.0, 0.78)           # stand-up spot in the chair's frame (in front of it)

WEATHERED = (1.0, 1.0, 1.0)        # the texture carries the colour; tints only vary it
CHAIR_TINT = (1.08, 0.97, 0.88)    # the chairs are a little warmer, less silvered
FASCIA_TINT = (0.78, 0.76, 0.74)


def jitter(c, k=0.06):
    f = 1.0 + rng.uniform(-k, k)
    return (c[0] * f, c[1] * f, c[2] * f)


# ============================================================================ platform
def build_platform():
    y = TOP - BT / 2
    # Border boards: front and back run the full width, the sides between them.
    for zc in (HD - BW / 2, -HD + BW / 2):
        B('wood', W + 0.03, BT, BW, 0, y, zc, tint=jitter(WEATHERED, 0.06), bevel=0.004)
    for xc in (HW - BW / 2, -HW + BW / 2):
        B('wood', BW, BT, D - 2 * BW - GAP * 2, xc, y, 0, tint=jitter(WEATHERED, 0.06), bevel=0.004)
    # Field boards along x between the side borders; some are two lengths butted over the middle joist.
    x0, x1 = -HW + BW + GAP, HW - BW - GAP
    z0, z1 = -HD + BW + GAP, HD - BW - GAP
    n = 14
    bw = (z1 - z0 - (n - 1) * GAP) / n
    boards = []
    for i in range(n):
        zc = z0 + bw / 2 + i * (bw + GAP)
        boards.append(zc)
        if i % 3 == 1:
            split = rng.choice((-0.6, 0.0, 0.6))
            B('wood', split - x0 - GAP / 2, BT, bw, (x0 + split - GAP / 2) / 2, y, zc, tint=jitter(WEATHERED, 0.08), bevel=0.003)
            B('wood', x1 - split - GAP / 2, BT, bw, (x1 + split + GAP / 2) / 2, y, zc, tint=jitter(WEATHERED, 0.08), bevel=0.003)
        else:
            B('wood', x1 - x0, BT, bw, (x0 + x1) / 2, y, zc, tint=jitter(WEATHERED, 0.08), bevel=0.003)
    # Joists under the boards (seen through the gaps), rim joists and a two-board fascia down into the ground.
    joists = [-1.2, -0.6, 0.0, 0.6, 1.2]
    for jx in joists:
        B('wood', 0.045, 0.14, D - 0.08, jx, TOP - BT - 0.07, 0, tint=mul(FASCIA_TINT, 0.8))
    for (w, d, xc, zc) in ((W - 0.02, 0.035, 0, HD - 0.03), (W - 0.02, 0.035, 0, -HD + 0.03),
                           (0.035, D - 0.02, HW - 0.03, 0), (0.035, D - 0.02, -HW + 0.03, 0)):
        yb = -0.35
        yt = TOP - BT - 0.001
        B('wood', w, yt - yb, d, xc, (yt + yb) / 2, zc, tint=jitter(FASCIA_TINT, 0.05), bevel=0.003)
    # Screw heads: two per board over every joist.
    for zc in boards:
        for jx in joists:
            for dz in (-0.035, 0.035):
                B('metal_black', 0.008, 0.002, 0.008, jx + rng.uniform(-0.003, 0.003), TOP + 0.0005, zc + dz, tint=BLACK)
    for zc in (HD - BW / 2, -HD + BW / 2):
        for jx in joists + [-HW + 0.05, HW - 0.05]:
            B('metal_black', 0.008, 0.002, 0.008, jx, TOP + 0.0005, zc, tint=BLACK)
    # The step at the back: two treads on a riser and two stringer blocks.
    sz = -HD - STEP_D / 2
    for k, dz in enumerate((-0.085, 0.085)):
        B('wood', STEP_W, BT, 0.16, 0, STEP_TOP - BT / 2, sz + dz, tint=jitter(WEATHERED, 0.08), bevel=0.003)
    B('wood', STEP_W - 0.04, STEP_TOP - BT + 0.3, 0.03, 0, (STEP_TOP - BT - 0.3) / 2, -HD - STEP_D + 0.03, tint=jitter(FASCIA_TINT, 0.05))
    for sx in (-1, 1):
        B('wood', 0.05, STEP_TOP - BT + 0.3, STEP_D - 0.05, sx * (STEP_W / 2 - 0.1), (STEP_TOP - BT - 0.3) / 2, sz + 0.02, tint=mul(FASCIA_TINT, 0.8))
    for dz in (-0.085, 0.085):
        for sx in (-1, 1):
            B('metal_black', 0.008, 0.002, 0.008, sx * (STEP_W / 2 - 0.1), STEP_TOP + 0.0005, sz + dz, tint=BLACK)
    # Collision: the platform and the step (the game adds a sloped skirt so it can be walked onto from any side).
    C(0, (TOP - 0.3) / 2, 0, W, TOP + 0.3, D)
    C(0, (STEP_TOP - 0.3) / 2, sz, STEP_W, STEP_TOP + 0.3, STEP_D)
    empty('META', (0, TOP, 0), w=W, d=D, top=TOP, step_w=STEP_W, step_d=STEP_D, step_top=STEP_TOP)


# ============================================================================ chairs (after cabin_design.adirondack)
def adirondack(i, x, z, ry):
    """After cabin_design.adirondack, reworked for close viewing: the side stringers slope from the front legs to the
    deck (they are the back legs), the seat slats sit on them, the back slats fan up from the seat's rear, and the broad
    arms run from the front legs back to the back brace with rounded fronts."""
    g = G(x, TOP, z, ry)   # faces local +z
    tint = jitter(CHAIR_TINT, 0.04)
    z0, y0, z1, y1 = 0.37, 0.33, -0.52, 0.065          # stringer centre line, front to back
    slope = math.atan2(y0 - y1, z0 - z1)
    sy = lambda zz: y1 + (zz - z1) * math.tan(slope)  # stringer centre height at zz
    lean, tl = -0.42, math.tan(0.42)
    zb, yb = -0.215, 0.225                             # the back slats' foot
    bz = lambda yy: zb - (yy - yb) * tl                # the back's plane (slat centre) at height yy
    for s in (-1, 1):
        L = math.hypot(z0 - z1, y0 - y1)
        g.box('wood', 0.04, 0.12, L, s * 0.285, (y0 + y1) / 2, (z0 + z1) / 2, rx=-slope, tint=tint, bevel=0.006)
        g.box('wood', 0.05, 0.6, 0.05, s * 0.33, 0.3, 0.31, tint=tint, bevel=0.006)                    # front legs
        az0, az1 = bz(0.6) - 0.02, 0.35
        g.box('wood', 0.14, 0.024, az1 - az0, s * 0.37, 0.612, (az0 + az1) / 2, tint=tint, bevel=0.007)  # arms
        g.put(bm_cyl(0.07, 0.07, 0.024, 16), 'wood', s * 0.37, 0.612, az1, tint=tint, smooth=lambda n: abs(n.y) < 0.5)
        g.box('wood', 0.03, 0.09, 0.07, s * 0.345, 0.555, 0.3, tint=tint, bevel=0.004)                   # corbels
    # Seat slats on the stringers, following their slope.
    for k in range(6):
        zz = 0.3 - k * 0.095
        g.box('wood', 0.62, 0.02, 0.08, 0, sy(zz) + 0.07, zz, rx=-slope, tint=jitter(tint, 0.03), bevel=0.005)
    g.box('wood', 0.62, 0.07, 0.025, 0, sy(0.35) + 0.035, 0.36, tint=tint, bevel=0.005)   # front apron
    # Back slats fanning out, the middle ones tallest, so the top reads as an arc.
    for k in range(5):
        lx = (k - 2) * 0.12
        L = (0.86, 0.93, 0.96, 0.93, 0.86)[k]
        g.box('wood', 0.09, L, 0.02, lx, yb + L / 2 * math.cos(lean), zb - L / 2 * math.sin(-lean),
              rx=lean, rz=-lx * 0.25, tint=jitter(tint, 0.03), bevel=0.006)
    # Braces behind the slats: under the arms' back ends (carrying them) and near the top.
    g.box('wood', 0.8, 0.06, 0.03, 0, 0.575, bz(0.575) - 0.025, tint=tint, bevel=0.005)
    g.box('wood', 0.52, 0.05, 0.025, 0, 0.93, bz(0.93) - 0.023, rx=lean, tint=tint, bevel=0.005)
    g.box('wood', 0.56, 0.05, 0.025, 0, 0.3, bz(0.3) - 0.023, rx=lean, tint=tint, bevel=0.005)
    g.col(0.8, 0.9, 0.95, 0, 0.45, -0.05)
    empty('CHAIR_%d' % i, g.p(0, 0, 0), ry=ry)
    empty('SEAT_%d' % i, g.p(*EYE))
    empty('STAND_%d' % i, g.p(*STAND))


# ============================================================================ end table + lantern
def end_table(x, z):
    g = G(x, TOP, z, 0.0)
    tint = jitter(CHAIR_TINT, 0.05)
    s = 0.44
    for (lx, lz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        g.box('wood', 0.045, TABLE_TOP - 0.022, 0.045, lx * (s / 2 - 0.035), (TABLE_TOP - 0.022) / 2, lz * (s / 2 - 0.035), tint=tint, bevel=0.005)
    for lz in (-1, 1):
        g.box('wood', s - 0.07, 0.06, 0.022, 0, TABLE_TOP - 0.052, lz * (s / 2 - 0.035), tint=tint, bevel=0.004)
        g.box('wood', s - 0.07, 0.04, 0.022, 0, 0.13, lz * (s / 2 - 0.035), tint=tint, bevel=0.004)
    n = 4
    sw = (s - (n - 1) * 0.012) / n
    for k in range(n):
        g.box('wood', sw, 0.022, s, -s / 2 + sw / 2 + k * (sw + 0.012), TABLE_TOP - 0.011, 0, tint=jitter(tint, 0.04), bevel=0.004)
    for k in range(3):
        g.box('wood', s - 0.1, 0.018, 0.1, 0, 0.159, -0.12 + k * 0.12, tint=jitter(tint, 0.04), bevel=0.003)
    g.col(s, TABLE_TOP, s, 0, TABLE_TOP / 2, 0)
    lantern(g, 0.03, TABLE_TOP, -0.03)


def lantern(g, lx, ly, lz):
    """A small carriage lantern (after cabin_design.lantern_box): a base, four corner posts round frosted panes, a
    pyramid roof with a cap and a bail handle."""
    h = 0.15                                  # pane height
    g.box('metal_black', 0.12, 0.016, 0.12, lx, ly + 0.008, lz, tint=BLACK, bevel=0.003)
    g.box('metal_black', 0.1, 0.008, 0.1, lx, ly + 0.02, lz, tint=BLACK)
    for dx in (-1, 1):
        for dz in (-1, 1):
            g.box('metal_black', 0.012, h + 0.012, 0.012, lx + dx * 0.046, ly + 0.024 + h / 2, lz + dz * 0.046, tint=BLACK)
    g.box('emissive', 0.084, h, 0.084, lx, ly + 0.024 + h / 2, lz)
    yt = ly + 0.024 + h
    g.box('metal_black', 0.114, 0.01, 0.114, lx, yt + 0.005, lz, tint=BLACK)
    g.put(bm_cyl(0.008, 0.085, 0.05, 4), 'metal_black', lx, yt + 0.035, lz, ry=PI / 4, tint=BLACK, smooth=False)
    g.cyl('metal_black', 0.012, 0.012, 0.02, lx, yt + 0.068, lz, 10, tint=BLACK)
    g.put(bm_torus(0.035, 0.004, 16, 6, arc=PI), 'metal_black', lx, yt + 0.078, lz, rx=-PI / 2, tint=BLACK, smooth=True)
    empty('LANTERN', g.p(lx, ly + 0.024 + h / 2, lz))


def build_all():
    build_platform()
    for i, (x, z, ry) in enumerate(CHAIRS):
        adirondack(i, x, z, ry)
    end_table(*TABLE)
    return realize()


# ============================================================================ textures
# Node helpers, after lounge_design.py.
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


def cedar_fields(nt, vec, w):
    """Weathered cedar, the grain along u: returns (grain lines 0..1, silvering 0..1, checks 0..1 (1 = open crack))."""
    gv, gw = _stretch(nt, vec, w, 0.08, 1.0)
    base = _noise4(nt, gv, gw, 2.4, 3.0, 0.5, 0.35)
    lines = _mapr(nt, math_node(nt, 'SINE', math_node(nt, 'MULTIPLY', base, 64.0)), 0.35, 1.0)
    mv, mw = _stretch(nt, vec, w, 0.35, 1.0)
    silver = _mapr(nt, _noise4(nt, mv, mw, 2.2, 5.0, 0.62), 0.32, 0.68)
    cv, cw = _stretch(nt, vec, w, 0.03, 1.0)
    crack = _noise4(nt, cv, cw, 3.2, 2.0, 0.5)
    crack = _mapr(nt, math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', crack, 0.5)), 0.0, 0.009, 1.0, 0.0)
    sparse = _mapr(nt, _noise4(nt, vec, w, 1.4, 2.0, 0.5), 0.52, 0.62)
    return lines, silver, math_node(nt, 'MULTIPLY', crack, sparse)


def make_cedar(nt, vec, w):
    lines, silver, crack = cedar_fields(nt, vec, w)
    col = _ramp(nt, silver, [(0.0, srgb(152, 104, 72)), (0.45, srgb(150, 120, 96)), (1.0, srgb(164, 156, 146))])
    col = _mix(nt, math_node(nt, 'MULTIPLY', lines, 0.42), col, srgb(84, 64, 50))
    pv, pw = _stretch(nt, vec, w, 0.05, 1.0)
    fine = _mapr(nt, _noise4(nt, pv, pw, 40.0, 2.0, 0.5), 0.45, 0.7)
    col = _mix(nt, math_node(nt, 'MULTIPLY', fine, 0.18), col, srgb(96, 80, 68))
    return _mix(nt, math_node(nt, 'MULTIPLY', crack, 0.85), col, srgb(38, 30, 26))


def make_cedar_height(nt, vec, w):
    lines, silver, crack = cedar_fields(nt, vec, w)
    # Weathering wears the soft earlywood away, so the grain lines stand proud; checks cut in.
    h = math_node(nt, 'ADD', 0.5, math_node(nt, 'MULTIPLY', lines, -0.28))
    h = math_node(nt, 'SUBTRACT', h, math_node(nt, 'MULTIPLY', crack, 0.35))
    return node(nt, 'ShaderNodeCombineColor', Red=h, Green=h, Blue=h).outputs[0]


def bake_all():
    t0 = time.time()
    os.makedirs(TMP, exist_ok=True)
    out = {}
    bake_tile(MODELS + 'deck_wood.png', make_cedar, 1024)
    h = bake_tile(os.path.join(TMP, 'deck_height.png'), make_cedar_height, 1024, colorspace='Non-Color')
    normal_from_height(MODELS + 'deck_wood_normal.png', h[:, :, 0], strength=5.0)
    out['textures_s'] = round(time.time() - t0, 1)
    out['ao'] = bake_ao(samples=128, distance=0.6)
    out['seconds'] = round(time.time() - t0, 1)
    return out
