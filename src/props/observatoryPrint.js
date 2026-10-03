import * as THREE from 'three';

// The back of the observatory's print (props/observatory.js: turn it over in your hands): a black and white drawing of
// the observatory, drawn here on canvas. Above, an elevation through the service ladder: the drum, the dome and its
// slit, the fixed ladder up the wall and the curved one on over the dome to the roof station, with an arrow to it.
// Below, a plan: the front door at the top, and the ladder marked where it stands round the back (`ladderDeg`
// clockwise from the door, the model's LADDER.fixedA). Not built headless (no canvas).

// The building, metres (tools/blender/observatory_design.py): the drum's outer radius and wall top, the dome's centre
// height and radius, the fixed ladder's rung line and top, the station deck's centre (from the axis, and its top).
const RO = 5.5, TOP = 3.75, DC = 3.9, RD = 5.8, LAD_R = 6.04, LAD_Y = 4.7, STA_R = 2.47, STA_Y = 9.58, STA_HZ = 0.7;

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

export function printBackTexture(ladderDeg = 245) {
  const W = 1024, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = rng(613);
  // the paper, a little uneven
  g.fillStyle = '#e8e2d4';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { const v = 170 + rnd() * 60; g.fillStyle = `rgba(${v},${v - 6},${v - 18},0.06)`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
  const ink = (a = 0.9) => `rgba(26,26,30,${a})`;
  g.lineJoin = g.lineCap = 'round';

  // A drawing at S px per metre round (ox, oy); y up.
  const pen = (S, ox, oy) => {
    const X = (m) => ox + m * S, Y = (m) => oy - m * S;
    const line = (pts, w = 2.5, a = 0.9, dash = null) => {
      g.save(); g.strokeStyle = ink(a); g.lineWidth = w; if (dash) g.setLineDash(dash);
      g.beginPath();
      pts.forEach(([x, y], i) => { const jx = (rnd() - 0.5) * 0.8, jy = (rnd() - 0.5) * 0.8; i ? g.lineTo(X(x) + jx, Y(y) + jy) : g.moveTo(X(x) + jx, Y(y) + jy); });
      g.stroke(); g.restore();
    };
    const text = (s, x, y, size = 22, align = 'center', bold = false) => {
      g.save(); g.font = `${bold ? 'bold ' : ''}${size}px "Courier New", Courier, monospace`; g.fillStyle = ink(0.9);
      g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, X(x), Y(y)); g.restore();
    };
    const head = (x, y, ang, s = 18) => {   // an arrow head at (x, y), pointing along ang (canvas radians)
      g.save(); g.fillStyle = ink(0.95); g.translate(X(x), Y(y)); g.rotate(ang);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-s, -s * 0.42); g.lineTo(-s, s * 0.42); g.closePath(); g.fill(); g.restore();
    };
    return { X, Y, line, text, head };
  };

  // ---- the elevation, through the ladder (the front to the left)
  {
    const { line, text, head } = pen(47, 420, 610);
    // the ground, hatched under it
    line([[-8.2, 0], [9.6, 0]], 3);
    for (let m = -8; m <= 9.4; m += 0.5) line([[m, 0], [m - 0.3, -0.3]], 1.2, 0.4);
    // the drum, and the door in its front
    line([[-RO, 0], [-RO, TOP], [RO, TOP], [RO, 0]], 3);
    line([[-RO, 2.5], [-RO - 0.22, 2.5], [-RO - 0.22, 0]], 2, 0.8);
    text('DOOR', -RO - 1.5, 1.3, 20);
    // the dome on the wall top, and the slit over the zenith (dashed)
    const arc = (a0, a1, r, w = 3, dash = null, a = 0.9) => {
      const pts = [];
      for (let t = a0; t <= a1 + 1e-6; t += 0.03) pts.push([Math.cos(t) * r, DC + Math.sin(t) * r]);
      line(pts, w, a, dash);
    };
    const s0 = Math.PI / 2 - 0.17, s1 = Math.PI / 2 + 0.42;
    arc(0, s0, RD); arc(s1, Math.PI, RD);
    arc(s0, s1, RD, 1.8, [9, 8], 0.7);
    line([[-RO - 0.1, DC], [RO + 0.1, DC]], 1.4, 0.5, [16, 8, 3, 8]);
    // the roof station: its deck on legs, the railing, the control panel on its inner rail
    const d0 = STA_R - STA_HZ, d1 = STA_R + STA_HZ;
    line([[d0, STA_Y], [d1, STA_Y]], 3);
    for (const x of [d0, d1]) line([[x, STA_Y], [x, STA_Y + 1.05]], 2);
    line([[d0, STA_Y + 1.05], [d1, STA_Y + 1.05]], 2);
    line([[d0 + 0.1, STA_Y], [d0 + 0.1, DC + Math.sqrt(RD * RD - (d0 + 0.1) ** 2)]], 1.6, 0.7);
    line([[d1 - 0.1, STA_Y], [d1 - 0.1, DC + Math.sqrt(RD * RD - (d1 - 0.1) ** 2)]], 1.6, 0.7);
    line([[d0 - 0.25, STA_Y + 1.0], [d0 + 0.12, STA_Y + 1.75]], 4);
    // the ladders: the fixed one up the wall, the curved one over the dome to the deck; rails and rungs
    line([[LAD_R - 0.13, 0], [LAD_R - 0.13, LAD_Y]], 2.2); line([[LAD_R + 0.13, 0], [LAD_R + 0.13, LAD_Y + 0.1]], 2.2);
    for (let y = 0.3; y < LAD_Y; y += 0.3) line([[LAD_R - 0.13, y], [LAD_R + 0.13, y]], 1.5, 0.8);
    const aTop = Math.acos((d1 + 0.05) / (RD + 0.2)), a0 = Math.asin((LAD_Y - DC) / (RD + 0.2));
    arc(a0, aTop, RD + 0.07, 2.2); arc(a0, aTop, RD + 0.33, 2.2);
    for (let t = a0 + 0.05; t < aTop; t += 0.05) line([[Math.cos(t) * (RD + 0.07), DC + Math.sin(t) * (RD + 0.07)], [Math.cos(t) * (RD + 0.33), DC + Math.sin(t) * (RD + 0.33)]], 1.5, 0.8);
    // the arrow to it, and its name
    const cur = [];
    for (let t = 0; t <= 1.001; t += 0.05) cur.push([9.3 + (LAD_R + 0.75 - 9.3) * t, 6.6 + (2.6 - 6.6) * t + Math.sin(t * Math.PI) * 0.55]);
    line(cur, 3.5, 0.95);
    head(LAD_R + 0.45, 2.42, Math.PI - 0.55, 22);
    text('SERVICE', 9.15, 7.55, 24, 'center', true);
    text('LADDER', 9.15, 7.05, 24, 'center', true);
    text('ROOF STATION', d1 + 0.5, STA_Y + 1.55, 18, 'left');
  }

  // ---- the plan (from above, the door at the top): the drum, the dome inside it, the door and the ladder
  {
    const S = 21, P = pen(S, 275, 815), { X, Y, line, text, head } = P;
    const ring = (r, w, a, dash = null) => { const pts = []; for (let t = 0; t <= Math.PI * 2 + 0.01; t += 0.08) pts.push([Math.cos(t) * r, Math.sin(t) * r]); line(pts, w, a, dash); };
    ring(RO, 3, 0.9); ring(RO - 0.35, 1.6, 0.7); ring(2.4, 1.4, 0.5, [8, 7]);
    // (model angles: 0 at the door, clockwise from above; the page's up is the door's way)
    const at = (deg, r) => { const a = (deg * Math.PI) / 180; return [Math.sin(a) * r, Math.cos(a) * r]; };
    g.fillStyle = '#e8e2d4'; g.fillRect(X(-0.75), Y(RO + 0.3), 1.5 * S, 0.7 * S);   // the door: a gap in the wall
    line([[-0.75, RO - 0.36], [-0.75, RO + 0.05]], 2.5); line([[0.75, RO - 0.36], [0.75, RO + 0.05]], 2.5);
    text('DOOR', 0, RO + 1.0, 18);
    // the ladder: a filled mark against the wall, its run on over the dome, and an arrow in to it
    const [lx, ly] = at(ladderDeg, LAD_R);
    g.save(); g.fillStyle = ink(0.95); g.translate(X(lx), Y(ly)); g.rotate(Math.atan2(-ly, lx) + Math.PI / 2); g.fillRect(-0.45 * S, -0.22 * S, 0.9 * S, 0.44 * S); g.restore();
    line([at(ladderDeg, RO), at(ladderDeg, STA_R + STA_HZ)], 4, 0.75, [5, 4]);
    const [sx, sy] = at(ladderDeg, STA_R);
    g.save(); g.strokeStyle = ink(0.9); g.lineWidth = 2; g.translate(X(sx), Y(sy)); g.rotate(Math.atan2(-ly, lx)); g.strokeRect(-0.7 * S, -0.55 * S, 1.4 * S, 1.1 * S); g.restore();
    const [tx, ty] = at(ladderDeg, LAD_R + 3.1), [hx, hy] = at(ladderDeg, LAD_R + 0.7);
    line([[tx, ty], [hx, hy]], 3.5, 0.95);
    head(hx, hy, Math.atan2(-(hy - ty), hx - tx), 20);
    text('LADDER', tx, ty - 0.9, 20, 'center', true);
    text('PLAN', 0, -RO - 1.6, 20, 'center', true);
  }

  // ---- the title block and the border
  const tx = W - 470, ty = H - 190;
  g.strokeStyle = ink(0.8); g.lineWidth = 2.5; g.strokeRect(tx, ty, 420, 130);
  g.beginPath(); g.moveTo(tx, ty + 50); g.lineTo(tx + 420, ty + 50); g.stroke();
  g.font = 'bold 25px "Courier New", Courier, monospace'; g.fillStyle = ink(0.9); g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('OBSERVATORY - ROOF ACCESS', tx + 14, ty + 26);
  g.font = '19px "Courier New", Courier, monospace';
  g.fillText('ELEVATION ON LADDER, AND PLAN', tx + 14, ty + 76); g.fillText('SHEET 5 OF 7      SCALE 1:100', tx + 14, ty + 106);
  g.strokeStyle = ink(0.55); g.lineWidth = 2; g.strokeRect(30, 30, W - 60, H - 60);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
