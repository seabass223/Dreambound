import * as THREE from 'three';
import { fbm2, noise2 } from '../core/rng.js';
import { materials } from '../render/materials.js';
import { endWallGeometry } from './features.js';
import { PATH_TILE } from './cliffPath.js';

// A cave that goes into a stack's cliff (the Dome's, at the end of its ledge path): an arched mouth in the cliff face and
// a tunnel that bends in from the path to the elevator, instead of a tunnel built out on the ledge under a rock hood.
//
// The stack cuts a window out of its cliff mesh and collider (Stack opts.openings, a few grid cells round the mouth,
// chosen by caveWindow below before the stack is built). The window is filled here by a patch of the same wall
// material: its outer edge is the window's own grid vertices (so it meets the wall with no T-junctions, and with the
// wall's normals, colours and texture coordinates there), its inner edge is the mouth's outline, and the rock between
// is the cliff surface (bilinear over the grid) pushed about into a rough rim. The tunnel's first ring is that same
// outline, vertex for vertex, so the patch and the tunnel close with no seam.

const MOUTH = { halfW: 1.85, spring: 1.5 };   // the arch: half width, and the height its round top starts at (top 3.35)
const NF = 12, NS = 6, NA = 30;                // outline points: along the floor, up each side, over the arch
// The rock round the elevator's plate (|x| < 1.85, 3.3 m high, its face 0.07 m in front of the elevator's root;
// Agent-README.md, "Blender models"): the tunnel's last metre and a half eases from rough rock into a squared reveal a little
// inside the plate's outline, standing `ahead` in front of its face, so the rock laps over the plate's edges (you never
// see the plate's sides) and it reads as set into the rock.
const PLATE_REVEAL = { halfW: 1.82, height: 3.27, from: 0.72, ahead: 0.02 };
// Wall rows the window spans, by default (DEPTHS[4] = 4.6 m .. DEPTHS[8] = 19 m below the rim, where the rim stands at
// the cap's top; a rim lower than that takes its rows down with it). The arch's top must stay well under the top row:
// buildCliffCave warns when it doesn't.
const ROWS = [4, 8];
const SHELL = 0.4, SHELL_ROCK = 0.15;
const TURN_IN = 3;                              // m of tunnel over which its sections turn from the cliff's plane to square          // the shadow shell: m out from the tunnel; m inside the cliff, at the least
const ARCH_CLEAR = 0.8;                         // m of rock the arch keeps under the window's top edge, at the least

// The window for a mouth at `theta`: `cols` grid columns either side of it, between wall rows `rows`.
export function caveWindow(segs, theta, cols = 3, rows = ROWS) {
  const jm = Math.round((((theta / (Math.PI * 2)) % 1 + 1) % 1) * segs);
  return { j0: jm - cols, j1: jm + cols, r0: rows[0], r1: rows[1] };
}

// The mouth's outline, counter-clockwise in (s, y) (s along the wall, toward increasing theta; y above the floor),
// starting at the floor's left end: the flat floor, up the right side, over the arch, down the left side.
function outline() {
  const { halfW: a, spring: hs } = MOUTH, pts = [];
  for (let i = 0; i < NF; i++) pts.push({ s: -a + (2 * a * i) / NF, y: 0, floor: true });
  for (let i = 0; i < NS; i++) pts.push({ s: a, y: (hs * i) / NS });
  for (let i = 0; i < NA; i++) { const t = (Math.PI * i) / NA; pts.push({ s: a * Math.cos(t), y: hs + a * Math.sin(t) }); }
  for (let i = 0; i < NS; i++) pts.push({ s: -a, y: hs - (hs * i) / NS });
  return pts;
}

export function buildCliffCave(ctx, stack, { theta, floorY, window: win, travel = -1, length = 5.6, batcher, collider, seed = 1 }) {
  const M = materials();
  const G = stack.wallGrid, W = G.W, segs = G.segs;
  const TAU = Math.PI * 2;
  theta = ((theta % TAU) + TAU) % TAU;   // as caveWindow picked the window's columns
  const col = (j) => ((j % segs) + segs) % segs;
  const vi = (ri, j) => ri * W + col(j);
  const thetaOf = (j) => (j / segs) * TAU;                   // unwrapped: j may run below 0 or past segs
  // Wall frame at the mouth.
  const rhat = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
  const that = new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta));
  const th0 = thetaOf(Math.round((theta / TAU) * segs));    // the window's centre column, near theta
  const thm = th0 + ((((theta - th0) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  const Rm = stack.wallRadius(theta, floorY + 1.6) ?? stack.cliffRadius(theta, stack.top - floorY, stack.edgeR(theta));
  const sOf = (th) => (th - thm) * Rm;
  const thOf = (s) => thm + s / Rm;

  // ---- the cliff surface over the window: bilinear in the grid cell holding (theta, y) ----
  const gv = (ri, j, arr, k) => arr[vi(ri, j) * (arr === G.uv ? 2 : 3) + k];
  const surface = (th, y) => {
    const cf = (th / TAU) * segs;
    let j = Math.floor(cf);
    j = Math.min(win.j1 - 1, Math.max(win.j0, j));
    const fx = THREE.MathUtils.clamp(cf - j, 0, 1);
    const rowY = (ri) => gv(ri, j, G.pos, 1) * (1 - fx) + gv(ri, j + 1, G.pos, 1) * fx;
    let ri = win.r0;
    while (ri < win.r1 - 1 && rowY(ri + 1) > y) ri++;
    const fy = THREE.MathUtils.clamp((rowY(ri) - y) / (rowY(ri) - rowY(ri + 1)), 0, 1);
    const lerp4 = (arr, k) => {
      const a = gv(ri, j, arr, k), b = gv(ri, j + 1, arr, k), c = gv(ri + 1, j, arr, k), d = gv(ri + 1, j + 1, arr, k);
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    };
    // The cell's column pair can differ a little in unwrapped theta from the texture's u at the θ = 0 seam; windows
    // here never cross it (the Dome's is round at 3.8 rad).
    return {
      p: new THREE.Vector3(lerp4(G.pos, 0), y, lerp4(G.pos, 2)),
      c: [lerp4(G.col, 0), lerp4(G.col, 1), lerp4(G.col, 2)],
      uv: [lerp4(G.uv, 0), lerp4(G.uv, 1)],
    };
  };

  // ---- the window's edge: its own grid vertices, counter-clockwise in (s, y) from the bottom-left corner ----
  const edge = [];
  const pushGrid = (ri, j) => edge.push({ ri, j, s: sOf(thetaOf(j)), y: gv(ri, j, G.pos, 1) });
  for (let j = win.j0; j < win.j1; j++) pushGrid(win.r1, j);             // bottom, left to right
  for (let ri = win.r1; ri > win.r0; ri--) pushGrid(ri, win.j1);         // right side, going up
  for (let j = win.j1; j > win.j0; j--) pushGrid(win.r0, j);             // top, right to left
  for (let ri = win.r0; ri < win.r1; ri++) pushGrid(ri, win.j0);         // left side, going down

  // ---- the mouth, and rings of rock out to the window's edge ----
  const O = outline();
  const N = O.length;
  const C = { s: 0, y: floorY + 1.6 };                                   // the rings' centre in (s, y)
  // Varies slowly round the outline (fast changes fold the first metre of the tunnel into spikes).
  const jag = (i, k) => noise2(i * 0.16 + k, seed * 0.37, seed + 41);
  const mouth = O.map((o, i) => {
    // The mouth's rim is broken rock: pushed out a little from the arch, never into the floor.
    const r = o.floor ? 0 : 0.24 * jag(i, 0) + 0.06 * jag(i * 2.1, 9);   // ragged, in and out
    const dx = o.s - C.s, dy = floorY + o.y - C.y, L = Math.hypot(dx, dy) || 1;
    return { s: o.s + (dx / L) * r * 0.8, y: floorY + (o.floor ? 0 : o.y + (dy / L) * r * 0.6), floor: !!o.floor };
  });
  // Where the ray from the centre through a mouth point meets the window's edge.
  const hitEdge = (p) => {
    const dx = p.s - C.s, dy = p.y - C.y;
    let best = Infinity;
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], b = edge[(k + 1) % edge.length];
      const ex = b.s - a.s, ey = b.y - a.y, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.s - C.s) * ey - (a.y - C.y) * ex) / den, u = ((a.s - C.s) * dy - (a.y - C.y) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    return { s: C.s + dx * best, y: C.y + dy * best };
  };
  const out = mouth.map(hitEdge);
  // The window must hold the whole mouth with rock to spare: an arch reaching up past its top row stands in front of the
  // cliff above it (the cliff isn't cut there), a sliver of rim and tunnel crossing the wall.
  const archTop = Math.max(...mouth.map((m) => m.y)) + 0.25;   // (and the tunnel's rough ceiling just inside it)
  const topEdge = Math.min(...edge.filter((e) => e.ri === win.r0 && Math.abs(e.s) < MOUTH.halfW + 2).map((e) => e.y));
  if (topEdge - archTop < ARCH_CLEAR) console.warn(`cliffCave: the arch (top ${archTop.toFixed(2)}) is within ${ARCH_CLEAR} m of the window's top edge (${topEdge.toFixed(2)}); open the window a row higher (caveWindow rows)`);
  const TS = [0, 0.1, 0.24, 0.42, 0.62, 0.8];
  const pos = [], cols = [], uvs = [], nrmFix = new Map(), idx = [];
  const put = (p, c, uv) => { pos.push(p.x, p.y, p.z); cols.push(c[0], c[1], c[2]); uvs.push(uv[0], uv[1]); return pos.length / 3 - 1; };
  const P = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const rings = TS.map((t, k) => mouth.map((m, i) => {
    const s = m.s + (out[i].s - m.s) * t, y = m.y + (out[i].y - m.y) * t;
    const f = surface(thOf(s), y);
    // Rough rock, strongest near the mouth and gone by the window's edge; a rim bulging out at the mouth itself.
    const below = y < floorY - 0.05;
    const w = Math.pow(1 - t / 0.8 * 0.95, 1.4) * (below ? 0.35 : 1);
    // (Kept near the wall's own plane: the wall material maps along it, so steep bulges would smear its texture.)
    const rock = (0.2 * fbm2(s * 0.55 + 3.1, y * 0.55, 4, seed + 43) + 0.07 * noise2(s * 2.1, y * 2.1, seed + 44)) * w;
    const rim = m.floor && k === 0 ? 0 : 0.1 * Math.exp(-t * 12) * (1 + 0.5 * jag(i, 5));
    f.p.addScaledVector(rhat, rock + rim);
    if (m.floor && k === 0) f.p.y = floorY;
    // A little darker round the mouth, as rock is where the light doesn't reach.
    const dk = 1 - 0.28 * Math.exp(-t * 6);
    return put(f.p, f.c.map((v) => v * dk), f.uv);
  }));
  const edgeIdx = edge.map((e) => {
    const i = vi(e.ri, e.j);
    const k = put(new THREE.Vector3(G.pos[i * 3], G.pos[i * 3 + 1], G.pos[i * 3 + 2]), [G.col[i * 3], G.col[i * 3 + 1], G.col[i * 3 + 2]], [G.uv[i * 2], G.uv[i * 2 + 1]]);
    nrmFix.set(k, [G.nrm[i * 3], G.nrm[i * 3 + 1], G.nrm[i * 3 + 2]]);
    return k;
  });
  // Faces point out of the cliff (toward rhat).
  const tri = (a, b, c, facing) => {
    const A = P(a), n = new THREE.Vector3().crossVectors(P(b).sub(A), P(c).sub(A));
    if (n.dot(facing) < 0) idx.push(a, c, b); else idx.push(a, b, c);
  };
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < N; i++) {
      const a = rings[k][i], b = rings[k][(i + 1) % N], c = rings[k + 1][i], d = rings[k + 1][(i + 1) % N];
      tri(a, b, d, rhat); tri(a, d, c, rhat);
    }
  }
  // Zip the last ring to the window's edge vertices, walking both by angle round the centre.
  const ang = (p) => Math.atan2(p.y - C.y, p.s - C.s);
  const last = rings[rings.length - 1];
  const la = mouth.map((m, i) => ang({ s: m.s + (out[i].s - m.s) * TS[TS.length - 1], y: m.y + (out[i].y - m.y) * TS[TS.length - 1] }));
  const ea = edge.map(ang);
  const unwrapFrom = (arr, start) => { const r = []; let prev = arr[start]; for (let n = 0; n < arr.length; n++) { let v = arr[(start + n) % arr.length]; while (v < prev - 1e-9) v += Math.PI * 2; r.push(v); prev = v; } return r; };
  // Start both at the smallest angle.
  const i0 = la.indexOf(Math.min(...la)), e0 = ea.indexOf(Math.min(...ea));
  const LA = unwrapFrom(la, i0), EA = unwrapFrom(ea, e0);
  let i = 0, e = 0;
  while (i < N || e < edge.length) {
    const li = last[(i0 + i) % N], ln = last[(i0 + i + 1) % N], ei = edgeIdx[(e0 + e) % edge.length], en = edgeIdx[(e0 + e + 1) % edge.length];
    const nextL = i < N ? LA[i + 1] ?? LA[0] + Math.PI * 2 : Infinity, nextE = e < edge.length ? EA[e + 1] ?? EA[0] + Math.PI * 2 : Infinity;
    if (nextL <= nextE) { tri(li, ln, ei, rhat); i++; } else { tri(li, en, ei, rhat); e++; }
  }
  const patch = new THREE.BufferGeometry();
  patch.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  patch.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  patch.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  patch.setIndex(idx);
  patch.computeVertexNormals();
  const pn = patch.attributes.normal;
  for (const [k, n] of nrmFix) pn.setXYZ(k, n[0], n[1], n[2]);   // the wall's own normals where they meet it
  const patchMesh = new THREE.Mesh(patch, stack.wallMaterial);
  patchMesh.receiveShadow = true;
  patchMesh.name = 'cliff-cave-mouth';
  stack.group.add(patchMesh);
  collider.addGeometry(patch);

  // ---- the tunnel: the mouth's ring, then sections along a path that bends in from the ledge to the elevator ----
  const T = that.clone().multiplyScalar(travel);             // the way the path was going
  const inward = rhat.clone().negate();
  const A0 = surface(thm, C.y).p;
  const d0 = T.clone().multiplyScalar(0.55).addScaledVector(inward, 0.84).normalize();
  const d1 = T.clone().multiplyScalar(0.18).addScaledVector(inward, 1).normalize();
  const axis = new THREE.CatmullRomCurve3([A0, A0.clone().addScaledVector(d0, length * 0.45), A0.clone().addScaledVector(d0, length * 0.45).addScaledVector(d1, length * 0.55)], false, 'centripetal');
  const L = axis.getLength();
  const tpos = [], tcol = [], tuv = [], tidx = [];
  const tput = (p, k, u, v) => { tpos.push(p.x, p.y, p.z); tcol.push(k, k * 0.97, k * 0.94); tuv.push(u, v); return tpos.length / 3 - 1; };
  const TP = (i) => new THREE.Vector3(tpos[i * 3], tpos[i * 3 + 1], tpos[i * 3 + 2]);
  // Texture v runs round the outline in metres (one tile per 2 m, as along the tunnel), not stretched once round it.
  const vArc = [0];
  for (let i = 1; i < N; i++) vArc.push(vArc[i - 1] + Math.hypot(O[i].s - O[i - 1].s, O[i].y - O[i - 1].y));
  const trings = [rings[0].map((pi, i) => tput(P(pi), 0.78, 0, vArc[i] / 2))];
  const nT = Math.max(8, Math.ceil(L / 0.35));
  // Where the ray from the section's centre through an outline point meets the plate's reveal (s, height above floor).
  const cy = C.y - floorY, RW = PLATE_REVEAL.halfW, RH = PLATE_REVEAL.height;
  const toReveal = (o) => {
    const dx = o.s, dy = o.y - cy;
    let t = Infinity;
    if (Math.abs(dx) > 1e-6) t = Math.min(t, RW / Math.abs(dx));
    if (dy > 1e-6) t = Math.min(t, (RH - cy) / dy); else if (dy < -1e-6) t = Math.min(t, cy / -dy);
    return { s: dx * t, y: o.floor ? 0 : cy + dy * t };
  };
  const a = new THREE.Vector3(), tg = new THREE.Vector3(), side = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  for (let k = 1; k <= nT; k++) {
    const u = k / nT;
    axis.getPointAt(u, a); axis.getTangentAt(u, tg); tg.y = 0; tg.normalize();
    // Near the mouth the sections turn from the cliff's plane (the mouth's own) to square across the tunnel: set square
    // at once, a section's corner on the side it bends toward would stand out in front of the cliff for the first metre
    // (a fin of tunnel wall outside the rock, seen from the path as a hood with no outside). Turned too quickly, a
    // section's edge on the other side overtakes the next section's, and the wall folds (every other triangle facing
    // away, slits of sky): over TURN_IN each section turns a few degrees, well inside that.
    tg.lerpVectors(inward, tg, THREE.MathUtils.smoothstep(u * L, 0, TURN_IN)).normalize();
    side.crossVectors(UP, tg).normalize();
    // Rough walls; the floor stays flat.
    // Toward the plate, the rock eases into its reveal (and smooths out).
    const b = THREE.MathUtils.smoothstep(u, PLATE_REVEAL.from, 1);
    // The reveal's top corners are square: the outline points nearest them go to them.
    const rv = O.map(toReveal);
    for (const sx of [-1, 1]) {
      let best = -1, bd = Infinity;
      rv.forEach((r, i) => { const d = Math.hypot(r.s - sx * RW, r.y - RH); if (!O[i].floor && d < bd) { bd = d; best = i; } });
      if (best >= 0) rv[best] = { s: sx * RW, y: RH };
    }
    trings.push(O.map((o, i) => {
      // Broken rock: broad lumps, crags and chips (the floor stays flat); strongest a little way in from the mouth.
      const w = o.floor ? 0 : (0.6 + 0.4 * Math.min(1, u * 3)) * (1 - 0.8 * b);
      const n = (0.28 * noise2(u * L * 0.55 + i * 0.15, i * 0.09, seed + 45) + 0.14 * noise2(u * L * 1.6 + i * 0.45, 2.7, seed + 46)
        + 0.06 * noise2(u * L * 4.2 + i * 1.2, 5.1, seed + 47) + 0.025 * noise2(u * L * 11 + i * 3.1, 8.3, seed + 48)) * w;
      const dx = o.s - C.s, dy = o.y + floorY - C.y, Ln = Math.hypot(dx, dy) || 1;
      const r = rv[i];
      const s1 = o.s + (dx / Ln) * n, y1 = o.floor ? 0 : o.y + (dy / Ln) * n;
      const p = a.clone().addScaledVector(side, s1 + (r.s - s1) * b);
      p.y = floorY + (o.floor ? 0 : y1 + (r.y - y1) * b);
      // Shaded into the corner where the rock meets the plate (the light there is close, and a lit flat sleeve read
      // as a pale band down the plate's side).
      const ao = 0.45 + 0.55 * THREE.MathUtils.smoothstep(L * (1 - u), 0.0, 0.6);
      return tput(p, (0.78 - 0.4 * u) * ao, u * L / 2, vArc[i] / 2);
    }));
  }
  // The floor (between floor points) is paved like the path, in a separate mesh (materials().path, mapped in world x/z
  // at the path's scale, so the paving runs on into the cave with no seam).
  const floorIdx = [];
  const isFloor = (i) => O[i].floor && (O[(i + 1) % N].floor || (i + 1) % N === NF);
  let folds = 0;
  for (let k = 0; k < trings.length - 1; k++) {
    for (let i = 0; i < N; i++) {
      const q0 = trings[k][i], q1 = trings[k][(i + 1) % N], q2 = trings[k + 1][i], q3 = trings[k + 1][(i + 1) % N];
      {
        // A fold: the section's two triangles, as laid out (before each is turned to face in), facing opposite ways.
        const A = TP(q0), n1 = new THREE.Vector3().crossVectors(TP(q1).sub(A), TP(q3).sub(A)), n2 = new THREE.Vector3().crossVectors(TP(q3).sub(A), TP(q2).sub(A));
        if (n1.dot(n2) < 0) folds++;
      }
      if (isFloor(i)) {
        // Each triangle wound to face up.
        for (const [x, y, z] of [[q0, q1, q3], [q0, q3, q2]]) {
          const A = TP(x), n = new THREE.Vector3().crossVectors(TP(y).sub(A), TP(z).sub(A));
          if (n.y < 0) floorIdx.push(x, z, y); else floorIdx.push(x, y, z);
        }
        continue;
      }
      for (const [x, y, z] of [[q0, q1, q3], [q0, q3, q2]]) {
        const A = TP(x), n = new THREE.Vector3().crossVectors(TP(y).sub(A), TP(z).sub(A));
        // Inward-facing: toward the tunnel's centre line at this section.
        const sec = axis.getPointAt(k / (trings.length - 1)); const toC = new THREE.Vector3(sec.x, floorY + 1.6, sec.z).sub(A);
        if (n.dot(toC) < 0) tidx.push(x, z, y); else tidx.push(x, y, z);
      }
    }
  }
  if (folds) console.warn(`cliffCave: ${folds} folded wall quads in the tunnel (sections turning too quickly, TURN_IN)`);
  const tunnel = new THREE.BufferGeometry();
  tunnel.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
  tunnel.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tunnel.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  tunnel.setIndex(tidx);
  collider.addGeometry(tunnel);
  // Smooth-shaded over fine, layered relief (the rock's own normal map does the grain): big flat facets read as a
  // 1990s game, not as rock.
  tunnel.computeVertexNormals();
  batcher.add(tunnel, M.stone);

  // ---- a shadow shell: the tunnel again, SHELL m further out, where that is all inside the rock ----
  // The sun's shadow of the tunnel's walls is cast from those walls' own surface, and the sun's depth bias (about
  // 16 cm) lets through anything within that of its caster: a low sun lit a strip of floor along the foot of the wall
  // on its side, as if through the rock. The cliff itself casts no shadow. This shell, a tube round the tunnel facing in
  // like it (so it casts, and from outside it is never seen), holds the shadow's depth well out from the floor. It is
  // hidden behind the tunnel's own walls, and starts only where its every point is inside the cliff.
  const shellPos = [], shellIdx = [];
  let k0 = -1;
  const secC = (k) => axis.getPointAt(k / (trings.length - 1)).setY(floorY + 1.6);
  const inRock = (p) => {
    const th = Math.atan2(p.z - stack.cz, p.x - stack.cx), wr = stack.wallRadius(th, p.y);
    return wr != null && Math.hypot(p.x - stack.cx, p.z - stack.cz) < wr - SHELL_ROCK;
  };
  const shellRings = trings.map((ring, k) => {
    const c = secC(k);
    const pts = ring.map((vi) => { const p = TP(vi); return p.add(p.clone().sub(c).normalize().multiplyScalar(SHELL)); });
    return pts;
  });
  for (let k = 1; k < shellRings.length; k++) {
    if (!shellRings[k].every(inRock)) { k0 = -1; continue; }
    if (k0 < 0) k0 = k;
  }
  if (k0 > 0 && k0 < shellRings.length - 1) {
    const base = (k) => (k - k0) * N;
    for (let k = k0; k < shellRings.length; k++) for (const p of shellRings[k]) shellPos.push(p.x, p.y, p.z);
    const SP = (i) => new THREE.Vector3(shellPos[i * 3], shellPos[i * 3 + 1], shellPos[i * 3 + 2]);
    for (let k = k0; k < shellRings.length - 1; k++) {
      const c = secC(k);
      for (let i = 0; i < N; i++) {
        const q0 = base(k) + i, q1 = base(k) + (i + 1) % N, q2 = base(k + 1) + i, q3 = base(k + 1) + (i + 1) % N;
        for (const [x, y, z] of [[q0, q1, q3], [q0, q3, q2]]) {
          const A = SP(x), n = new THREE.Vector3().crossVectors(SP(y).sub(A), SP(z).sub(A));
          if (n.dot(c.clone().sub(A)) < 0) shellIdx.push(x, z, y); else shellIdx.push(x, y, z);
        }
      }
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(shellPos, 3));
    shell.setAttribute('color', new THREE.Float32BufferAttribute(new Array(shellPos.length).fill(0.2), 3));
    shell.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((shellPos.length / 3) * 2).fill(0), 2));
    shell.setIndex(shellIdx);
    shell.computeVertexNormals();
    batcher.add(shell, M.stone);
  }
  const floorPos = [], floorUv = [], fIdx = [];
  const remap = new Map();
  for (const v of floorIdx) {
    if (!remap.has(v)) { const p = TP(v); remap.set(v, floorPos.length / 3); floorPos.push(p.x, p.y, p.z); floorUv.push(p.x / PATH_TILE, p.z / PATH_TILE); }
    fIdx.push(remap.get(v));
  }
  const floor = new THREE.BufferGeometry();
  floor.setAttribute('position', new THREE.Float32BufferAttribute(floorPos, 3));
  floor.setAttribute('uv', new THREE.Float32BufferAttribute(floorUv, 2));
  floor.setIndex(fIdx);
  floor.computeVertexNormals();
  batcher.add(floor, M.path);
  collider.addGeometry(floor);

  // ---- the elevator's end wall at the tunnel's end, facing back out ----
  const end = axis.getPointAt(1);
  axis.getTangentAt(1, tg); tg.y = 0; tg.normalize();
  const platePos = new THREE.Vector3(end.x, floorY, end.z).addScaledVector(tg, 0.07 + PLATE_REVEAL.ahead);
  const plateRot = Math.atan2(-tg.x, -tg.z);
  batcher.add(endWallGeometry(platePos, plateRot), M.stone, null, 0x6a6560);
  // Light: the caged bulb over the elevator (world/stacks/dome.js addCaveBulb, 2.75 m up the plate) lights the rock
  // round it, warmly and falling off down the tunnel; a faint fill part way out. The shared point-light pool
  // (render/lightpool.js) takes them while you are nearer this cave than any other lit interior.
  const live = () => (ctx.power?.dome === false ? 0 : 1);
  const bulb = platePos.clone().addScaledVector(tg, -1.1).setY(floorY + 2.5);   // (out from the plate: no hot spot on it)
  const mid = axis.getPointAt(0.45).setY(floorY + 2.2);
  ctx.lightPool?.add({
    center: axis.getPointAt(0.5), radius: 4,
    lights: [
      { pos: bulb, color: new THREE.Color(1, 0.8, 0.58), distance: 7.5, intensity: () => 4.5 * live() },
      { pos: mid, color: new THREE.Color(1, 0.84, 0.66), distance: 4.5, intensity: () => 1.2 * live() },
    ],
  });
  return { platePos, plateRot, mouth: surface(thm, floorY).p, axis, rhat, that, shellFrom: k0 > 0 ? (k0 / (trings.length - 1)) * L : null };
}
