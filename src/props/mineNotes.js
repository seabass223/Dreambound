import * as THREE from 'three';
import { patchMaterial } from '../render/materials.js';
import { makeInspectable } from './inspect.js';

// Two papers in the mine adit (props/mine.js), both drawn here on canvas, both to pick up and read (props/inspect.js).
//
// The scrap on the workbench, in its clear middle (the model's CLUE): a torn-off corner of a page with "95, 16"
// pencilled on it, lying a little askew.
//
// The blueprint pinned to the boards of the left wall opposite the bench: an old, tattered, smudged print of the
// Mountain observatory in section. The hill under it; the drum (11 m across, 3.75 m to the wall top) with the front door
// cut through on the left, labelled; the dome (radius 5.8 m) with the observing slit cut out over the zenith; the
// telescope on its pier; the overall height. On the back wall, opposite the door, a small square and, off to one side,
// a warning mark with an arrow to it, and nothing written: the rear hatch is there, and the print doesn't say what
// opens it.
//
// Both in the mine model's frame (`root`: +z out of the portal, x across). Not built headless (no canvas).

const BLUEPRINT = { pos: [-1.272, 1.52, -8.56], size: [0.66, 0.48] };   // on the left wall's lagging, facing into the drive
const SCRAP = { size: [0.15, 0.105] };

// A seeded random stream, so the paper looks the same every time.
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

// Cut a torn edge into a canvas: everything outside a ragged outline (inset `m` px, jagged by `j`) is cleared.
function tear(g, W, H, rnd, m, j, bites = []) {
  const pts = [];
  const side = (x0, y0, x1, y1, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny);
      const d = (rnd() - 0.5) * j + (rnd() < 0.08 ? rnd() * j * 1.5 : 0);
      pts.push([x + (nx / l) * d, y + (ny / l) * d]);
    }
  };
  side(m, m, W - m, m, 60); side(W - m, m, W - m, H - m, 44); side(W - m, H - m, m, H - m, 60); side(m, H - m, m, m, 44);
  g.save();
  g.fillStyle = '#000';   // (opaque: destination-in keeps the paper by the fill's alpha)
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (const b of bites) {   // torn-away pieces and holes: ragged polygons round a point
    g.beginPath();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = b.r * (0.6 + rnd() * 0.6);
      const x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r * (b.flat ?? 1);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
  }
  g.restore();
}

// face: false draws its back (the same paper, the same tear, nothing written).
function scrapTexture(face = true) {
  const W = 600, H = 420, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = rng(951), rText = rng(77), rTear = rng(31);
  g.fillStyle = '#e8dfc8';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5000; i++) { const v = 196 + rnd() * 40; g.fillStyle = `rgba(${v},${v - 10},${v - 30},0.06)`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
  if (!face) { tear(g, W, H, rTear, 14, 22, [{ x: W - 10, y: 10, r: 46 }]); return finish(c); }
  // faint ruled lines and a margin: it was torn from a notebook
  g.strokeStyle = 'rgba(120,140,170,0.35)'; g.lineWidth = 2;
  for (let y = 70; y < H; y += 58) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 3); g.stroke(); }
  g.strokeStyle = 'rgba(190,90,90,0.3)';
  g.beginPath(); g.moveTo(70, 0); g.lineTo(73, H); g.stroke();
  // a thumbprint of grime and a fold
  const gr = g.createRadialGradient(470, 320, 0, 470, 320, 70); gr.addColorStop(0, 'rgba(80,60,40,0.16)'); gr.addColorStop(1, 'rgba(80,60,40,0)');
  g.fillStyle = gr; g.fillRect(380, 230, 180, 180);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 228); g.lineTo(W, 214); g.stroke();
  g.strokeStyle = 'rgba(90,70,50,0.12)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 231); g.lineTo(W, 217); g.stroke();
  // "95, 16" in pencil, pressed hard, gone over twice
  g.save();
  g.translate(W * 0.5, H * 0.47);
  g.rotate(-0.06);
  g.font = 'italic 150px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < 7; k++) {
    g.fillStyle = `rgba(52,50,56,${0.16 + rText() * 0.12})`;
    g.fillText('95, 16', (rText() - 0.5) * 4, (rText() - 0.5) * 4);
  }
  g.restore();
  tear(g, W, H, rTear, 14, 22, [{ x: W - 10, y: 10, r: 46 }]);
  return finish(c);
}

// The print: Prussian-blue ground, white lines, the drawing at `S` px per metre round the drum's axis.
// face: false draws its back (the paper, pale where the print's blue soaked through, the same tear).
function blueprintTexture(face = true) {
  const W = 2048, H = 1490, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = rng(1871), rTear = rng(4433);
  const tatter = () => tear(g, W, H, rTear, 26, 40, [
    { x: 0, y: H, r: 210, flat: 0.8 }, { x: W, y: 0, r: 90 },
    { x: 64, y: 64, r: 14 }, { x: W - 64, y: 64, r: 16 }, { x: W * 0.62, y: H, r: 60, flat: 2.2 },
  ]);
  if (!face) {
    g.fillStyle = '#c9d3dc'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26000; i++) { const v = 150 + rnd() * 90; g.fillStyle = `rgba(${v},${v + 8},${v + 20},0.05)`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
    tatter();
    return finish(c);
  }
  // the ground: uneven, sun-faded toward the edges
  g.fillStyle = '#1f4f8e';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W, y = rnd() * H, r = 120 + rnd() * 420;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() < 0.55;
    gr.addColorStop(0, light ? 'rgba(120,160,210,0.10)' : 'rgba(10,30,70,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const edge = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  edge.addColorStop(0, 'rgba(160,190,220,0)'); edge.addColorStop(1, 'rgba(170,195,215,0.35)');
  g.fillStyle = edge; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26000; i++) { const v = rnd() < 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},0.035)`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }

  // ---- the drawing (section through the door and the hatch), metres to px
  const S = 108, ox = W * 0.47, oy = H * 0.8;   // the floor's centre
  const X = (m) => ox + m * S, Y = (m) => oy - m * S;
  const ink = (a = 0.9) => `rgba(236,244,255,${a})`;
  const line = (pts, w = 3, a = 0.9, dash = null) => {
    g.save(); g.strokeStyle = ink(a); g.lineWidth = w; g.lineJoin = 'round'; if (dash) g.setLineDash(dash);
    g.beginPath();
    pts.forEach(([x, y], i) => { const jx = (rnd() - 0.5) * 1.2, jy = (rnd() - 0.5) * 1.2; i ? g.lineTo(X(x) + jx, Y(y) + jy) : g.moveTo(X(x) + jx, Y(y) + jy); });
    g.stroke(); g.restore();
  };
  const text = (s, x, y, size = 30, a = 0.85, align = 'center', rot = 0) => {
    g.save(); g.translate(X(x), Y(y)); g.rotate(rot); g.font = `${size}px "Courier New", Courier, monospace`; g.fillStyle = ink(a);
    g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, 0, 0); g.restore();
  };
  const arrowHead = (x, y, ang, s = 16) => {
    g.save(); g.fillStyle = ink(0.9); g.translate(X(x), Y(y)); g.rotate(ang);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-s, -s * 0.45); g.lineTo(-s, s * 0.45); g.closePath(); g.fill(); g.restore();
  };
  const dim = (x0, y0, x1, y1, label, off, vertical = false) => {   // a dimension line with ticks and its figure
    const ax = vertical ? off : 0, ay = vertical ? 0 : off;
    line([[x0 + ax, y0 + ay], [x1 + ax, y1 + ay]], 2, 0.75);
    line([[x0, y0], [x0 + ax * 1.15, y0 + ay * 1.15]], 1.5, 0.5); line([[x1, y1], [x1 + ax * 1.15, y1 + ay * 1.15]], 1.5, 0.5);
    const a = Math.atan2(-(y1 - y0), x1 - x0);
    arrowHead(x1 + ax, y1 + ay, a, 12); arrowHead(x0 + ax, y0 + ay, a + Math.PI, 12);
    if (vertical) text(label, (x0 + x1) / 2 + ax - 0.18, (y0 + y1) / 2 + ay, 28, 0.85, 'center', -Math.PI / 2);
    else text(label, (x0 + x1) / 2 + ax, (y0 + y1) / 2 + ay + 0.2, 28);
  };
  // the hill: the summit's plateau falling away, hatched under it
  const hill = [];
  for (let m = -8.4; m <= 8.4; m += 0.3) hill.push([m, -0.02 - Math.max(0, Math.abs(m) - 6.2) ** 1.6 * 0.45]);
  line(hill, 3.5, 0.85);
  for (let m = -8.2; m <= 8.2; m += 0.42) { const h = -0.02 - Math.max(0, Math.abs(m) - 6.2) ** 1.6 * 0.45; line([[m, h], [m - 0.3, h - 0.35]], 1.5, 0.35); }
  // the drum in section: the front wall (left) cut by the door, the back wall (right) whole; the floor
  const RI = 5.15, RO = 5.5, FL = 0.28, TOP = 3.75, DOOR = 2.5, HY0 = 1.26, HY1 = 1.44, DC = 3.9, RD = 5.8;
  line([[-RO, 0], [-RO, -0.0], [-RI, 0]], 3);
  line([[-RO, DOOR], [-RO, TOP], [-RI, TOP], [-RI, DOOR], [-RO, DOOR]], 3);                      // over the door
  line([[-RO, 0], [-RO, 0.12]], 3); line([[-RI, 0], [-RI, 0.12]], 3);
  line([[RO, 0], [RO, TOP], [RI, TOP], [RI, 0]], 3);                                              // the back wall
  line([[-RI, FL], [RI, FL]], 2.5, 0.8);
  for (let m = -RI; m < RI; m += 0.35) line([[m, FL], [m + 0.2, FL - 0.18]], 1.2, 0.3);
  // section hatching in the walls
  for (const [x0, y0, y1] of [[-RO, DOOR, TOP], [RO - 0.35, 0, TOP]]) for (let y = y0 + 0.12; y < y1; y += 0.18) line([[x0, y], [x0 + 0.35, y + 0.15]], 1.2, 0.4);
  // the dome: an arc on the wall top, the slit cut out over the zenith (its edges dashed on through the opening)
  const arc = (a0, a1, r = RD, dash = null, w = 3.5) => { const pts = []; for (let a = a0; a <= a1 + 1e-6; a += 0.02) pts.push([Math.cos(a) * r, DC + Math.sin(a) * r]); line(pts, w, 0.9, dash); };
  const s0 = Math.PI / 2 - 0.42, s1 = Math.PI / 2 + 0.17;   // the slit, back over the top from the front
  arc(0, s0); arc(s1, Math.PI);
  arc(s0, s1, RD, [14, 12], 2);
  arc(0, s0, RD - 0.22, null, 1.8); arc(s1, Math.PI, RD - 0.22, null, 1.8);
  line([[-RO - 0.1, DC], [RO + 0.1, DC]], 1.6, 0.55, [22, 10, 4, 10]);                            // the dome's base ring
  // the telescope on its pier, aimed up through the slit (dashed: behind the cut)
  line([[-0.35, FL], [-0.25, 3.2], [0.25, 3.2], [0.35, FL]], 2.5, 0.75);
  const pa = Math.PI / 2 - 0.16, px = 0, py = 4.3;
  line([[px - Math.cos(pa) * 1.12, py - Math.sin(pa) * 1.12], [px + Math.cos(pa) * 4.4, py + Math.sin(pa) * 4.4]], 9, 0.55, [18, 10]);
  // the door: an arrow and its name
  line([[-RO - 2.6, 1.0], [-RO - 0.25, 1.0]], 2.5, 0.9);
  arrowHead(-RO - 0.2, 1.0, 0, 18);
  text('FRONT DOOR', -RO - 2.7, 1.45, 34, 0.9, 'left');
  // the hatch: a small square on the back wall's outer face, as big as the real one (0.18 m), blank paper in the
  // wall's hatching, and a mark pointing at it, nothing more
  {
    const hs = (HY1 - HY0) * S, hx = X(RO) - hs, hy = Y(HY1);
    const [pr, pg, pb] = g.getImageData(X(RO + 0.3) | 0, Y((HY0 + HY1) / 2) | 0, 1, 1).data;
    g.save(); g.fillStyle = `rgb(${pr},${pg},${pb})`; g.fillRect(hx, hy, hs, hs);
    g.strokeStyle = ink(0.95); g.lineWidth = 3; g.strokeRect(hx, hy, hs, hs);
    g.strokeStyle = 'rgba(255,212,40,0.95)'; g.lineWidth = 4; g.strokeRect(hx - 5, hy - 5, hs + 10, hs + 10);   // ringed in yellow, to catch the eye
    g.restore();
  }
  const mx = RO + 2.1, my = 2.55;
  g.save(); g.translate(X(mx), Y(my)); g.strokeStyle = ink(0.95); g.lineWidth = 5;
  g.beginPath(); g.moveTo(0, -62); g.lineTo(56, 40); g.lineTo(-56, 40); g.closePath(); g.stroke();
  g.font = 'bold 74px "Courier New", Courier, monospace'; g.fillStyle = ink(0.95); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 0, 8);
  g.restore();
  const cur = [];
  for (let t = 0; t <= 1; t += 0.05) cur.push([mx - 0.45 + (RO + 0.14 - (mx - 0.45)) * t, my - 0.7 + (HY0 + 0.09 - (my - 0.7)) * t - Math.sin(t * Math.PI) * 0.45]);
  line(cur, 3, 0.95);
  arrowHead(RO + 0.04, HY0 + 0.09, Math.PI + 0.35, 22);
  // dimensions
  dim(-RO, -1.25, RO, -1.25, '11.00 m', 0);
  dim(RO, 0, RO, TOP, '3.75 m', 0.75, true);
  dim(-RO, 0, -RO, DOOR, '2.50', -0.75, true);
  line([[0, DC], [Math.cos(Math.PI * 0.8) * RD, DC + Math.sin(Math.PI * 0.8) * RD]], 1.6, 0.6);
  text('R 5.80', -2.6, 5.4, 28, 0.85, 'center', 0.62);
  dim(Math.cos(s1) * (RD + 0.5), DC + Math.sin(s1) * (RD + 0.5), Math.cos(s0) * (RD + 0.5), DC + Math.sin(s0) * (RD + 0.5), 'SLIT 1.90', 0);
  dim(-RO - 3.5, 0, -RO - 3.5, DC + RD, '9.70 m', 0, true);
  // the title block
  const tx = W - 600, ty = H - 205;
  g.strokeStyle = ink(0.8); g.lineWidth = 3; g.strokeRect(tx, ty, 560, 170);
  g.beginPath(); g.moveTo(tx, ty + 62); g.lineTo(tx + 560, ty + 62); g.moveTo(tx + 330, ty + 62); g.lineTo(tx + 330, ty + 170); g.stroke();
  g.font = 'bold 36px "Courier New", Courier, monospace'; g.fillStyle = ink(0.9); g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('OBSERVATORY - SECTION A-A', tx + 18, ty + 32);
  g.font = '26px "Courier New", Courier, monospace';
  g.fillText('SCALE 1:50', tx + 18, ty + 95); g.fillText('SHEET 3 OF 7', tx + 18, ty + 135);
  g.fillText('DRN.  R.H.', tx + 348, ty + 95); g.fillText('CHK.', tx + 348, ty + 135);
  g.font = '24px "Courier New", Courier, monospace'; g.fillStyle = ink(0.55);
  g.fillText('ALL DIMENSIONS IN METRES', 60, H - 60);
  g.strokeStyle = ink(0.6); g.lineWidth = 2; g.strokeRect(36, 36, W - 72, H - 72);

  // ---- age: smudges, a coffee ring, grime from hands, folds, a water stain
  for (let i = 0; i < 18; i++) {
    const x = rnd() * W, y = rnd() * H, r = 40 + rnd() * 160;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rnd() < 0.5 ? '20,30,50' : '60,70,90'},${0.12 + rnd() * 0.16})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.save(); g.translate(x, y); g.scale(1.6, 0.7); g.rotate(rnd()); g.fillRect(-r, -r, 2 * r, 2 * r); g.restore();
  }
  g.save(); g.strokeStyle = 'rgba(90,70,40,0.32)'; g.lineWidth = 9; g.beginPath(); g.ellipse(W * 0.2, H * 0.24, 120, 112, 0.3, 0.2, Math.PI * 1.85); g.stroke();
  g.strokeStyle = 'rgba(90,70,40,0.15)'; g.lineWidth = 22; g.beginPath(); g.ellipse(W * 0.2, H * 0.24, 112, 104, 0.3, 0, Math.PI * 2); g.stroke(); g.restore();
  const water = g.createRadialGradient(W * 0.78, H * 0.18, 30, W * 0.78, H * 0.18, 260);
  water.addColorStop(0, 'rgba(150,170,190,0.0)'); water.addColorStop(0.85, 'rgba(150,170,190,0.18)'); water.addColorStop(0.9, 'rgba(70,60,40,0.3)'); water.addColorStop(1, 'rgba(70,60,40,0)');
  g.fillStyle = water; g.fillRect(W * 0.78 - 270, H * 0.18 - 270, 540, 540);
  for (const [x0, y0, x1, y1] of [[W / 2 + 6, 0, W / 2 - 4, H], [0, H / 2 - 5, W, H / 2 + 7]]) {   // folds
    g.strokeStyle = 'rgba(210,225,240,0.28)'; g.lineWidth = 4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(10,20,40,0.25)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0 + 4, y0 + 4); g.lineTo(x1 + 4, y1 + 4); g.stroke();
  }
  // tattered: ragged edges, a corner gone, nail holes torn at the top, a rip in the bottom edge
  tatter();
  return finish(c);
}

function finish(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Paper doesn't blaze: picked up, a sheet turns square to the bench's lamp half a metre away on its way to your face,
// and lit straight on from that close it burned out white for a moment. Its lit colour (before tone mapping) eases
// over a knee toward a ceiling instead, which leaves it as it was everywhere it already read well, the held pose too.
const PAPER_KNEE = 0.75, PAPER_CEIL = 1.0;
function paperCap(m) {
  const base = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `{
      float pk = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
      if (pk > ${PAPER_KNEE.toFixed(3)}) {
        float over = pk - ${PAPER_KNEE.toFixed(3)}, room = ${(PAPER_CEIL - PAPER_KNEE).toFixed(3)};
        outgoingLight *= (${PAPER_KNEE.toFixed(3)} + over / (1.0 + over / room)) / pk;
      }
    }
    #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => key() + '|paper';
  return m;
}

// A sheet: a slightly wavy plane (its face +z) with the drawing in front and plain paper behind, ragged by alpha.
function sheet(w, h, tex, back, { wave = 0.004, curl = 0, seed = 1 } = {}) {
  const geo = new THREE.PlaneGeometry(w, h, 16, 12);
  const p = geo.attributes.position, r = rng(seed);
  const ph = r() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const u = x / w + 0.5, v = y / h + 0.5;
    let z = wave * Math.sin(u * 7 + ph) * Math.sin(v * 5 + ph * 0.7);
    const k = Math.max(0, (u - 0.72) / 0.28) * Math.max(0, (0.28 - v) / 0.28);
    z += curl * 0.15 * Math.min(w, h) * k * k;                                // a lower corner lifting off it
    p.setZ(i, z);
  }
  geo.computeVertexNormals();
  const mat = (map) => paperCap(patchMaterial(new THREE.MeshStandardMaterial({
    map, alphaTest: 0.5, roughness: 0.92, metalness: 0, envMapIntensity: 0.35, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0,
  })));
  const front = new THREE.Mesh(geo, mat(tex));
  const backMesh = new THREE.Mesh(geo.clone().rotateY(Math.PI).translate(0, 0, -0.0005), mat(back));
  // (the back's uvs mirrored, so its tear lines up with the front's)
  backMesh.geometry.attributes.uv.array.forEach((_, i, a) => { if (i % 2 === 0) a[i] = 1 - a[i]; });
  for (const m of [front, backMesh]) { m.castShadow = true; m.receiveShadow = true; }
  const obj = new THREE.Group();
  obj.add(front, backMesh);
  return { obj, front, back: backMesh };
}

// Places both in `root` (the mine model's group). clueNode: the model's CLUE empty. Returns their inspectors.
export function placeMineNotes(ctx, root, clueNode) {
  if (typeof document === 'undefined') return null;
  const out = {};
  // the scrap, face up on the bench, a little askew
  if (clueNode) {
    const { obj, front, back } = sheet(SCRAP.size[0], SCRAP.size[1], scrapTexture(), scrapTexture(false), { wave: 0.002, curl: 0.4, seed: 5 });
    obj.name = 'mine:scrap';
    root.add(obj);
    const restP = clueNode.position.clone().add(new THREE.Vector3(0.02, 0.002, 0.03));
    // face up, its top toward the wall behind the bench (+x), so it reads from in front of the bench; a little askew
    const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, -Math.PI / 2 + 0.3, 0, 'YXZ'));
    obj.position.copy(restP); obj.quaternion.copy(restQ);
    out.scrap = Object.assign(makeInspectable(ctx, {
      object: obj, parent: root, meshes: [front, back], name: 'mine:scrap', hold: 0.2, turn: true,
      glow: { material: front.material, amount: 0.12 },
      rest: (p, q) => { p.copy(restP); q.copy(restQ); },
    }), { front, back });
  }
  // the blueprint, pinned to the left wall's boards
  {
    const [w, h] = BLUEPRINT.size;
    const { obj, front, back } = sheet(w, h, blueprintTexture(), blueprintTexture(false), { wave: 0.006, curl: 0.5, seed: 9 });
    obj.name = 'mine:blueprint';
    root.add(obj);
    const restP = new THREE.Vector3(...BLUEPRINT.pos);
    const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0.025, 'YXZ'));   // face +x, into the drive
    obj.position.copy(restP); obj.quaternion.copy(restQ);
    // nails at its top corners, left in the boards when it's taken down
    const nailGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8).rotateZ(Math.PI / 2);
    const nailMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.7, roughness: 0.5 }));
    for (const s of [-1, 1]) {
      const n = new THREE.Mesh(nailGeo, nailMat);
      n.position.copy(restP).add(new THREE.Vector3(0.006, h / 2 - 0.022, s * (w / 2 - 0.022)));
      root.add(n);
    }
    out.blueprint = Object.assign(makeInspectable(ctx, {
      object: obj, parent: root, meshes: [front, back], name: 'mine:blueprint', hold: 0.46,
      glow: { material: front.material, amount: 0.1 },
      rest: (p, q) => { p.copy(restP); q.copy(restQ); },
    }), { front, back });
  }
  // (held up to the light, both faces glow alike: turned over, the back faces away from the lamp too)
  ctx.updaters.push((dt) => {
    for (const s of [out.scrap, out.blueprint]) if (s) { s.update(dt); s.back.material.emissiveIntensity = s.front.material.emissiveIntensity; }
  });
  return out;
}
