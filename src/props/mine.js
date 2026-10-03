import * as THREE from 'three';
import { GLTFLoader } from '../render/gltf.js';
import { materials, patchMaterial } from '../render/materials.js';
import { atmo } from '../render/atmosphere.js';
import { addKeepOut } from '../render/lod.js';
import { fbm3, noise3, smoothstep, clamp } from '../core/rng.js';
import { placeMineNotes } from './mineNotes.js';

// The old mine adit in the Mountain's south hillside, at the foot of the summit cone (world/stacks/mountain.js).
//
// A box cut runs from the flat ground round the cone's foot into the slope, its floor level and its sides steep, to a
// rock headwall with a timber portal in it; behind the portal a drive about 11 m long runs level into the hill under
// timber sets, to the heading. The rock is built here, fitted to the ground: the cut (a shape function on the stack's
// cap), the headwall (a face round the opening and a cap of rock draped over the hillside above it, hiding the hole cut
// in the ground behind the portal), the bore (an irregular tube) and its floor. The timber and what was left in the
// drive are a Blender model (tools/blender/mine_design.py: public/models/mine.glb): the sets and their lagging, the
// portal set, the cribbing retaining the cut, the track and an ore cart, the workbench with its tools, the enamel lamp
// over the bench and a caged bulb halfway in, lit through the shared light pool while the Mountain power line is on.
//
// Frame (the model's): origin on the floor at the portal, in the middle of the opening; +z out of the portal (down the
// cut, away from the summit), -z into the hill; x across.

export const MINE = { th: THREE.MathUtils.degToRad(117.2), rEntry: 53 };   // round the summit, and where the cut starts
const HW = 1.45, SPR = 2.35, ROOF = 2.9;     // the bore: half width, springline, crown (above the floor)
const HEADING = 10.9;                         // the heading's depth (z = -HEADING)
const FACE_Z = 0.25;                          // the headwall's face, round the opening
const FOOT = 0.14;                            // the walls and the heading run this far down under the floor
const HEAD = 3.4;                             // natural ground over the portal, above the floor (sets the portal's depth)
const CUT_HW = 2.0, CUT_SLOPE = 1.7;          // the cut: flat floor half width, its sides' rise per metre
const DRAPE = { x: 2.9, z0: -2.8 };           // the headwall's half width; the ground remade behind it
const HOLE = { x: 1.62, z0: -2.4, z1: 0.32 };   // cut in the cap behind the portal
const CARVE_Z0 = -0.9;                        // the cut runs this far behind the face (hidden in the headwall)
const CLEAR_HW = 5;                           // nothing grows within this of the cut's line
const LIGHT_ON = new THREE.Color(1.5, 1.12, 0.66), LIGHT_OFF = new THREE.Color(0.05, 0.045, 0.04);

export async function loadMine() {
  const base = import.meta.env.BASE_URL + 'models/';
  const tl = new THREE.TextureLoader();
  const [gltf, ao, wood, woodN, rust, rustN, paint, paintN] = await Promise.all([
    new GLTFLoader().loadAsync(base + 'mine.glb'),
    ...['mine_ao.png', 'mine_wood.png', 'mine_wood_normal.png', 'mine_rust.png', 'mine_rust_normal.png', 'mine_paint.png', 'mine_paint_normal.png'].map((f) => tl.loadAsync(base + f)),
  ]);
  ao.flipY = false; ao.channel = 1; ao.colorSpace = THREE.NoColorSpace;
  ao.generateMipmaps = false; ao.minFilter = THREE.LinearFilter;   // an atlas of small charts (see cabin.js)
  for (const t of [wood, woodN, rust, rustN, paint, paintN]) { t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  wood.colorSpace = rust.colorSpace = paint.colorSpace = THREE.SRGBColorSpace;
  woodN.colorSpace = rustN.colorSpace = paintN.colorSpace = THREE.NoColorSpace;
  return { gltf, ao, wood, woodN, rust, rustN, paint, paintN };
}

// The frame, from the stack before it is built: it pushes the cut (a shape function), the hole behind the portal and
// the cut floor's colour onto the stack. Returns { x, y, z, ry, m, near(x, z), inside(p), local(x, z) }.
export function mineFrame(stack, { sx, sz }) {
  const out = new THREE.Vector3(Math.cos(MINE.th), 0, Math.sin(MINE.th));   // from the summit, out of the portal
  const ry = Math.atan2(out.x, out.z);                                        // local +z = out
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (r) => [sx + out.x * r, sz + out.z * r];
  const nat = (x, z) => stack.heightAtAnalytic(x, z);
  const yF = nat(...at(MINE.rEntry)) + 0.08;
  // The portal goes in until the hill stands HEAD over the floor there.
  let rP = MINE.rEntry;
  for (let r = MINE.rEntry; r > MINE.rEntry - 15; r -= 0.05) { rP = r; if (nat(...at(r)) - yF >= HEAD) break; }
  const [x, z] = at(rP);
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, yF, z);
  const toWorld = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const local = (wx, wz) => { const dx = wx - x, dz = wz - z; return [dx * c - dz * s, dx * s + dz * c]; };
  const cutLen = MINE.rEntry - rP + 1.2;

  // The hill as it was (before the cut), over the headwall and the drive, relative to the floor.
  const G = { x0: -DRAPE.x - 1, z0: -HEADING - 1.5, step: 0.25 };
  G.nx = Math.ceil((2 * (DRAPE.x + 1)) / G.step) + 1; G.nz = Math.ceil((HEADING + 1.5 + 1) / G.step) + 1;
  const gh = new Float32Array(G.nx * G.nz);
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) gh[j * G.nx + i] = nat(...toWorld(G.x0 + i * G.step, G.z0 + j * G.step)) - yF;
  const ground = (lx, lz) => {
    const fx = clamp((lx - G.x0) / G.step, 0, G.nx - 1.001), fz = clamp((lz - G.z0) / G.step, 0, G.nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = gh[j * G.nx + i] * (1 - tx) + gh[j * G.nx + i + 1] * tx, b = gh[(j + 1) * G.nx + i] * (1 - tx) + gh[(j + 1) * G.nx + i + 1] * tx;
    return a * (1 - tz) + b * tz;
  };
  let cover = Infinity;
  for (let lz = -1.2; lz > -HEADING - 0.3; lz -= 0.25) for (const lx of [-HW - 0.2, 0, HW + 0.2]) cover = Math.min(cover, ground(lx, lz) - ROOF);
  if (cover < 0.35) console.warn(`mine: only ${cover.toFixed(2)} m of hill over the drive`);

  // The cut: a level floor (falling a little toward its mouth), steep sides, out to the flat ground.
  const cutAt = (lx, lz) => {
    if (lz < CARVE_Z0 || lz > cutLen + 6) return Infinity;
    if (lz < FACE_Z && Math.abs(lx) > DRAPE.x - 0.3) return Infinity;   // (behind the face only as wide as the headwall)
    return -0.012 * Math.max(lz, 0) + Math.max(0, Math.abs(lx) - CUT_HW) * CUT_SLOPE + Math.max(0, lz - cutLen) * 0.8 + Math.max(0, CARVE_Z0 + 0.35 - lz) * 4;
  };
  stack.shapeFns.push((wx, wz, h) => {
    const [lx, lz] = local(wx, wz);
    if (Math.abs(lx) > 12 || lz < -2 || lz > cutLen + 8) return h;
    return Math.min(h, yF + cutAt(lx, lz));
  });
  stack.capHoles.push({ x, z, ry, x0: -HOLE.x, x1: HOLE.x, z0: HOLE.z0, z1: HOLE.z1 });
  // The cut's floor: trodden earth and grit.
  const dirt = new THREE.Color(0.2, 0.17, 0.13);
  stack.colorFns.push((wx, wz, h, col) => {
    const [lx, lz] = local(wx, wz);
    if (lz < -1 || lz > cutLen + 2 || Math.abs(lx) > CUT_HW + 1) return;
    col.lerp(dirt, (1 - smoothstep(CUT_HW - 0.3, CUT_HW + 0.6, Math.abs(lx))) * (1 - smoothstep(cutLen - 0.5, cutLen + 1.5, lz)) * 0.8);
  });

  // Where nothing may grow (the cut, the headwall, the drive), and where you are in the drive.
  const near = (wx, wz, margin = 0) => {
    const [lx, lz] = local(wx, wz);
    return Math.abs(lx) < CLEAR_HW + margin && lz > -HEADING - 1 - margin && lz < cutLen + 1.5 + margin;
  };
  const inside = (p) => {
    const [lx, lz] = local(p.x, p.z);
    return Math.abs(lx) < HW + 0.2 && lz < FACE_Z && lz > -HEADING - 0.3 && p.y > yF - 0.5 && p.y < yF + ROOF;
  };
  return { x, y: yF, z, ry, m, ground, cutLen, near, inside, local, toWorld };
}

// ---------------------------------------------------------------------------------------------------------------
// The rock: the bore's outline at depth lz (displaced, in the frame), from the left floor corner over the crown to
// the right one.
function profile() {
  const pts = [];
  for (let i = 0; i < 5; i++) pts.push([-HW, (i / 5) * SPR]);
  for (let i = 0; i <= 14; i++) { const a = Math.PI - (i / 14) * Math.PI; pts.push([HW * Math.cos(a), SPR + (ROOF - SPR) * Math.sin(a)]); }
  for (let i = 4; i >= 0; i--) pts.push([HW, (i / 5) * SPR]);
  return pts;
}
function outline(lz) {
  const O = [0, 1.3];
  return profile().map(([px, py]) => {
    let nx = px - O[0], ny = py - O[1];
    const l = Math.hypot(nx, ny); nx /= l; ny /= l;
    const d = 0.05 + 0.11 * fbm3(px * 0.8, py * 0.8, lz * 0.8, 3, 71) + 0.04 * noise3(px * 2.6, py * 2.6, lz * 2.6, 72);
    const floorK = smoothstep(0, 0.35, py);   // the floor corners stay under the floor
    return new THREE.Vector3(px + nx * d * (0.3 + 0.7 * floorK), py === 0 ? -FOOT : Math.max(0, py + ny * d * floorK), lz);
  });
}

function geometry(pos, idx, uv, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A grid of rows x cols vertices from f(i, j) -> Vector3, quads wound so their front faces `facing` (a function of the
// vertex, or a vector), world-scaled uvs from uvf(p) and a colour from colf(p).
function grid(rows, cols, f, uvf, colf, flip = false) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const p = f(i, j);
    pos.push(p.x, p.y, p.z);
    uv.push(...uvf(p));
    const k = colf(p);
    col.push(k[0], k[1], k[2]);
  }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c2 = a + cols, d = c2 + 1;
    if (flip) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2);
  }
  return geometry(pos, idx, uv, col);
}

function buildRock(stack, F, batcher, collider) {
  const M = materials();
  const TILE = 4;
  const rockCol = (base) => (p) => {
    const n = 0.06 * noise3(p.x * 0.9, p.y * 0.9, p.z * 0.9, 73) + 0.03 * noise3(p.x * 3, p.y * 3, p.z * 3, 74);
    const k = base + n;
    return [k * 1.03, k, k * 0.95];
  };
  // Darker the deeper in (the drive only gets what the lamps give it).
  const deep = (p) => 0.5 - 0.14 * smoothstep(0, 4, -p.z);
  const geos = [];

  // The bore: rings from the face to the heading, arc-length uvs round it.
  const DZ = 0.3, nRing = Math.ceil((HEADING + FACE_Z) / DZ) + 1;
  const rings = [];
  for (let i = 0; i < nRing; i++) rings.push(outline(FACE_Z - Math.min(i * DZ, HEADING + FACE_Z)));
  const nP = rings[0].length;
  const arc = [0];
  for (let j = 1; j < nP; j++) arc.push(arc[j - 1] + rings[0][j].distanceTo(rings[0][j - 1]));
  geos.push(grid(nRing, nP, (i, j) => rings[i][j], (p) => [0, p.z / TILE], (p) => rockCol(deep(p))(p), true));
  {   // arc length round it for u
    const g = geos[geos.length - 1], uv = g.attributes.uv;
    for (let i = 0; i < nRing; i++) for (let j = 0; j < nP; j++) uv.setX(i * nP + j, arc[j] / TILE);
  }
  // The heading: the last ring closed with a rough fan, bulging a little toward you.
  {
    // (the ring's loop closed along the floor, from the right corner back to the left one)
    const ring = rings[nRing - 1], c0 = new THREE.Vector3(0, 1.1, -HEADING);
    const last = [...ring];
    for (let f = 1; f < 6; f++) last.push(ring[nP - 1].clone().lerp(ring[0], f / 6));
    last.push(ring[0].clone());
    const nL = last.length;
    const pos = [], uv = [], col = [], idx = [];
    const K = 5;
    for (let k = 0; k <= K; k++) for (let j = 0; j < nL; j++) {
      const t = k / K, p = last[j].clone().lerp(c0, t);
      p.z += 0.25 * Math.sin(t * Math.PI * 0.5) + 0.12 * fbm3(p.x * 1.1, p.y * 1.1, 3, 2, 75) * (t > 0 && t < 1 ? 1 : 0);
      pos.push(p.x, p.y, p.z); uv.push(p.x / TILE, p.y / TILE);
      const kc = rockCol(0.34)(p); col.push(...kc);
    }
    for (let k = 0; k < K; k++) for (let j = 0; j < nL - 1; j++) {
      const a = k * nL + j, b = a + 1, c2 = a + nL, d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
    geos.push(geometry(pos, idx, uv, col));
  }
  // The floor: grit and rubble, a little humped, under the walls' feet. It spans the hole cut in the cap (a little
  // wider than the bore): narrower, it left a slot along each side of the hole between the face and the hole's front
  // edge, where nothing stood over the cut-away ground and you could see down through the island.
  {
    const nx = 13, nz = Math.ceil((HEADING + 0.5 + 0.3) / 0.3) + 1, FW = Math.max(HW + 0.12, HOLE.x + 0.08);
    geos.push(grid(nz, nx, (i, j) => {
      const lz = 0.5 - Math.min(i * 0.3, HEADING + 0.5 + 0.2), lx = -FW + (j / (nx - 1)) * (2 * FW);
      const y = 0.02 + 0.035 * fbm3(lx * 1.6, 0, lz * 1.6, 2, 76) + 0.03 * Math.max(0, noise3(lx * 5, 1, lz * 5, 77)) - 0.02 * (1 - Math.abs(lx) / HW);
      return new THREE.Vector3(lx, Math.max(y, 0.005) - (lz > FACE_Z + 0.05 ? (lz - FACE_Z) * 0.06 : 0), lz);
    }, (p) => [p.x / TILE, p.z / TILE], (p) => {
      const k = 0.3 + 0.05 * noise3(p.x * 2, 0, p.z * 2, 78) - 0.08 * smoothstep(0, 5, -p.z);
      return [k * 1.1, k * 0.98, k * 0.86];
    }));
  }

  // A shadow shell (as the Dome's cliff cave's): the sun's shadow of the bore is cast from its own walls, and the depth
  // bias let a thin line of sunlight onto the floor along the foot of the walls and the heading, as if from under it.
  // This tube, SHELL further out all round (closed under the floor and behind the heading), facing in like the bore
  // so it casts and is never seen, holds the shadow's depth well away from the floor. It starts just behind the face (it
  // is culled from outside and hidden by the walls from inside, so it can run under the drape over the hole too: started
  // behind the hole, the first 2.7 m of the drive kept the line of light along the foot of its walls).
  {
    const SHELL = 0.45, O = [0, 1.3];
    const loop = profile().map(([px, py]) => {
      const dx = px - O[0], dy = py - O[1], l = Math.hypot(dx, dy);
      return [px + (dx / l) * SHELL, Math.max(py + (dy / l) * SHELL, -0.6)];
    });
    loop[0][1] = loop[loop.length - 1][1] = -0.6;
    for (let f = 1; f < 4; f++) loop.push([HW + SHELL - (f / 4) * 2 * (HW + SHELL), -0.6]);   // under the floor, right to left
    const n = loop.length, zs = [];
    for (let lz = FACE_Z - 0.15; lz > -HEADING - SHELL; lz -= 0.6) zs.push(lz);
    zs.push(-HEADING - SHELL - 0.1);
    const pos = [], idx = [];
    for (const lz of zs) for (const [x, y] of loop) pos.push(x, y, lz);
    const at = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const inward = (a, b, c, lz) => {   // wind each triangle to face the bore's axis
      const A = at(a), nrm = new THREE.Vector3().crossVectors(at(b).sub(A), at(c).sub(A));
      return nrm.dot(new THREE.Vector3(O[0], O[1], lz).sub(A)) >= 0 ? [a, b, c] : [a, c, b];
    };
    for (let k = 0; k < zs.length - 1; k++) for (let j = 0; j < n; j++) {
      const a = k * n + j, b = k * n + (j + 1) % n, c2 = a + n, d = b + n, mz = (zs[k] + zs[k + 1]) / 2;
      idx.push(...inward(a, b, d, mz), ...inward(a, d, c2, mz));
    }
    // behind the heading: the last ring closed on its centre, facing back into the drive
    const cEnd = pos.length / 3, zEnd = zs[zs.length - 1];
    pos.push(O[0], O[1], zEnd);
    for (let j = 0; j < n; j++) {
      const a = (zs.length - 1) * n + j, b = (zs.length - 1) * n + (j + 1) % n;
      const t = [cEnd, a, b], A = at(cEnd), nrm = new THREE.Vector3().crossVectors(at(a).sub(A), at(b).sub(A));
      idx.push(...(nrm.z > 0 ? t : [cEnd, b, a]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0.2), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    batcher.add(g, M.stone, F.m);   // (M.stone is single-sided: its shadow is drawn from the back faces, which face out)
  }

  // The headwall's face round the opening: a band from the outline at the face out to the edge of the rock (the drape's
  // front above, the cut's sides and floor below), bulging forward a little and leaning back toward its top.
  const top = (lx) => F.ground(lx, FACE_Z) + 0.05;
  const inner = outline(FACE_Z);
  const O = new THREE.Vector2(0, 1.3), X = DRAPE.x, yb = -0.45;
  // (It reaches past the drape's edges as far out as the drape's sides fall (0.9 m), closing off the front of the low
  // ground under them: stopping at the edges, a ray could slip in beside the face, under a side, to the hole.)
  const outer = inner.map((p) => {
    const d = new THREE.Vector2(p.x - O.x, p.y - O.y).normalize();
    let s = 0.1;
    for (; s < 30; s += 0.02) {
      const qx = O.x + d.x * s, qy = O.y + d.y * s;
      if (Math.abs(qx) >= X + 0.9 || qy <= yb || qy >= top(qx)) break;
    }
    return new THREE.Vector3(O.x + d.x * s, O.y + d.y * s, FACE_Z);
  });
  // ...and the outline point nearest each top corner sits right on it, so the edge turns the corner there rather than
  // cutting across it (the points are ~0.5 m apart, and a chord across the corner left a gap however far out it went).
  for (const sx of [-1, 1]) {
    const cx = sx * (X + 0.9), C = new THREE.Vector3(cx, top(cx), FACE_Z), a = Math.atan2(C.y - O.y, C.x - O.x);
    let best = -1, bd = Infinity;
    outer.forEach((q, j) => { const d = Math.abs(Math.atan2(Math.sin(Math.atan2(q.y - O.y, q.x - O.x) - a), Math.cos(Math.atan2(q.y - O.y, q.x - O.x) - a))); if (d < bd) { bd = d; best = j; } });
    outer[best].copy(C);
  }
  const ROWS = 9;
  const faceGeo = grid(ROWS, nP, (i, j) => {
    const t = (i / (ROWS - 1)) ** 1.4;
    const p = inner[j].clone().lerp(outer[j], t);
    const bulge = Math.sin(t * Math.PI) * (0.12 + 0.16 * fbm3(p.x * 0.7, p.y * 0.7, 5, 2, 79));
    p.z = FACE_Z + bulge + 0.08 * noise3(p.x * 2.2, p.y * 2.2, 6, 80) * Math.sin(t * Math.PI);   // (its edges meet the bore and the ground)
    return p;
  }, (p) => [p.x / TILE, p.y / TILE], (p) => rockCol(0.5)(p), false);
  geos.push(faceGeo);

  // Behind the face the hill is made again over the hole and the cut's end: ground in the cap's own material, uvs and
  // colours (from its nearest vertex), where the cap is, or where the hill was before the cut, 5 cm proud of it.
  const drape = (() => {
    const cap = stack.capGeo, P = cap.attributes.position, Cc = cap.attributes.color;
    const nearIdx = [];
    for (let i = 0; i < P.count; i++) if (Math.hypot(P.getX(i) - F.x, P.getZ(i) - F.z) < 9) nearIdx.push(i);
    const nx = Math.round((2 * X) / 0.3) + 1, nz = Math.round((FACE_Z - DRAPE.z0) / 0.25) + 1;
    const pos = [], uv = [], col = [], idx = [];
    for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
      const lz = FACE_Z - i * ((FACE_Z - DRAPE.z0) / (nz - 1)), lx = -X + j * ((2 * X) / (nx - 1));
      const [wx, wz] = F.toWorld(lx, lz);
      const y = Math.max((stack.heightAt(wx, wz) ?? -Infinity) - F.y, i === 0 ? top(lx) - 0.05 : F.ground(lx, lz)) + 0.05;
      pos.push(lx, y, lz);
      uv.push(wx * 0.22, wz * 0.22);
      // (its colour from the hill a little further back: the cut's steep, rock-coloured sides are right under its front)
      const [cx, cz] = F.toWorld(lx, Math.min(lz, -1.4));
      let best = -1, bd = Infinity;
      for (const k of nearIdx) { const d = (P.getX(k) - cx) ** 2 + (P.getZ(k) - cz) ** 2; if (d < bd) { bd = d; best = k; } }
      col.push(Cc.getX(best), Cc.getY(best), Cc.getZ(best));
    }
    for (let i = 0; i < nz - 1; i++) for (let j = 0; j < nx - 1; j++) {
      const a = i * nx + j, b = a + 1, c2 = a + nx, d = c2 + 1;
      idx.push(a, b, c2, b, d, c2);
    }
    // Its sides closed: the cut lowers the ground behind the face up to the drape's edges, so without these a gap ran in
    // under each side edge to the hole, and at a glancing angle you saw through the hill. Each side falls away from the
    // edge, outward and down to just under the hill's surface there, so it reads as more of the slope, not a wall.
    for (const j of [0, nx - 1]) {
      const base = pos.length / 3, out = j ? 1 : -1;
      for (let i = 0; i < nz; i++) {
        const k = i * nx + j, lx = pos[k * 3], y = pos[k * 3 + 1], lz = pos[k * 3 + 2];
        const ox = lx + out * 0.9, [wx, wz] = F.toWorld(ox, lz);
        const yb = Math.min(y, (stack.heightAt(wx, wz) ?? y) - F.y) - 0.25;
        pos.push(lx, y, lz, ox, yb, lz);
        uv.push(uv[k * 2], uv[k * 2 + 1], wx * 0.22, wz * 0.22);   // (the top shares the drape edge's uv, so no seam)
        col.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2], col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
      }
      for (let i = 0; i < nz - 1; i++) {
        const t0 = base + i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
        if (out > 0) idx.push(t0, b0, t1, b0, b1, t1);   // facing out and up, like the slope it continues
        else idx.push(t0, t1, b0, b0, t1, b1);
      }
    }
    return geometry(pos, idx, uv, col);
  })();
  batcher.add(drape, materials().cap, F.m);
  collider.addGeometry(drape, F.m);

  // All in the frame; into the stack's batch and the mine's collider.
  const toW = F.m;
  for (const g of geos) {
    batcher.add(g, M.cliff, toW);
    collider.addGeometry(g, toW);
  }
}

// ---------------------------------------------------------------------------------------------------------------
function glowTexture() {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r = Math.hypot(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
    const k = (j * N + i) * 4;
    data[k] = data[k + 1] = data[k + 2] = 255;
    data[k + 3] = Math.round(Math.max(0, 1 - r) ** 2.5 * (0.3 + 0.7 * Math.exp(-6 * r)) * 255);
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function makeMaterials(asset) {
  const R = materials();
  const std = (o) => patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, aoMap: asset.ao, envMapIntensity: 0.5, ...o }));
  return {
    wood: std({ name: 'mine-wood', map: asset.wood, normalMap: asset.woodN, normalScale: new THREE.Vector2(1, -1), roughness: 0.92 }),
    rust: std({ name: 'mine-rust', map: asset.rust, normalMap: asset.rustN, normalScale: new THREE.Vector2(0.8, -0.8), roughness: 0.82, metalness: 0.35 }),
    paint: std({ name: 'mine-paint', map: asset.paint, normalMap: asset.paintN, normalScale: new THREE.Vector2(0.8, -0.8), roughness: 0.72, metalness: 0.2 }),
    enamel: std({ name: 'mine-enamel', roughness: 0.4 }),
    stone: std({ name: 'mine-stone', map: R.cliff.map, normalMap: R.cliff.normalMap, roughness: 0.95 }),
    emissive: new THREE.MeshBasicMaterial({ name: 'mine-bulb', color: LIGHT_ON.clone() }),
  };
}

// Builds the rock (into the stack's batch) and places the model. Returns { root, inside(p), clue, frame }.
export function buildMine(ctx, stack, asset, F, { batcher }) {
  const collider = ctx.lateCollider('mine');
  buildRock(stack, F, batcher, collider);

  // Sky light cut inside the drive, and no tree's leaves in it (materials.js mineMask).
  atmo.uMineA.value.set(Math.cos(F.ry), Math.sin(F.ry), F.x, F.z);
  atmo.uMineB.value.set(F.y, ROOF + 0.15, HEADING + 0.4, 1);
  // Nothing instanced (grass, pebbles, trees) in the cut, the headwall or the drive.
  addKeepOut(F.m, new THREE.Box3(new THREE.Vector3(-CLEAR_HW, -1.5, -HEADING - 1), new THREE.Vector3(CLEAR_HW, 6, F.cutLen + 1)));

  if (!asset) return { root: null, inside: F.inside, clue: null, frame: F };
  const root = new THREE.Group();
  root.name = 'mine';
  root.applyMatrix4(F.m);
  ctx.surface.add(root);
  root.updateMatrixWorld(true);

  const M = makeMaterials(asset);
  const empties = {};
  let colliderGeo = null;
  asset.gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  asset.gltf.scene.traverse((o) => {
    if (o.isMesh) {
      if (o.name === 'COLLIDER') { colliderGeo = o.geometry.clone().applyMatrix4(o.matrixWorld); return; }
      meshes.push(o);
    } else if (o !== asset.gltf.scene) empties[o.name] = o;
  });
  for (const o of meshes) {
    const key = (o.material?.name || '').replace(/^mine_/, '');
    const mat = M[key];
    if (!mat) continue;
    const mesh = new THREE.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), mat);
    mesh.name = 'mine:' + key;
    mesh.castShadow = key !== 'emissive';
    mesh.receiveShadow = key !== 'emissive';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  if (colliderGeo) collider.addGeometry(colliderGeo, root.matrixWorld);
  const E = (name) => empties[name]?.position.clone() ?? null;

  // The lamps: the enamel one over the bench and the caged bulb halfway in, on the Mountain power line.
  const live = () => !ctx.power || ctx.power.mountain !== false;
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1, 0.72, 0.42), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.22 });
  const lampP = E('LAMP'), bulbP = E('BULB');
  for (const [p, s] of [[lampP, 0.32], [bulbP, 0.24]]) {
    if (!p) continue;
    const g = new THREE.Sprite(glowMat);
    g.position.copy(p); g.scale.setScalar(s); g.name = 'mine:glow';
    root.add(g);
  }
  let on = -1;
  ctx.updaters.push(() => {
    const k = live() ? 1 : 0;
    if (k === on) return;
    on = k;
    M.emissive.color.copy(k ? LIGHT_ON : LIGHT_OFF);
    glowMat.opacity = k ? 0.22 : 0;
  });
  const warm = new THREE.Color(1, 0.8, 0.58);
  const lights = [];
  // (the lights hang a little under the bulbs, so they don't blaze on the shade's white inside and the cage)
  const under = (p, d) => root.localToWorld(p.clone().add(new THREE.Vector3(0, -d, 0)));
  if (lampP) lights.push({ pos: under(lampP, 0.16), color: warm, distance: 7.5, intensity: () => (live() ? 4.2 : 0) });
  if (bulbP) lights.push({ pos: under(bulbP, 0.1), color: warm, distance: 5.5, intensity: () => (live() ? 2.2 : 0) });
  ctx.lightPool?.add({ center: new THREE.Vector3(0, 1.4, -5).applyMatrix4(F.m), radius: 7, lights });

  ctx.lod.add(root, { out: [70, 90], name: 'mine' });
  const clueNode = empties.CLUE;
  // the scrap with the clue on the bench, the observatory's blueprint on the wall (props/mineNotes.js)
  const notes = placeMineNotes(ctx, root, clueNode);
  const clue = clueNode ? { pos: root.localToWorld(clueNode.position.clone()), ry: F.ry + (clueNode.userData.ry ?? 0), size: clueNode.userData.size ?? [0.36, 0.34] } : null;
  return { root, inside: F.inside, clue, notes, frame: F };
}
