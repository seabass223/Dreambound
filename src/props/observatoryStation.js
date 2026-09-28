import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ColliderBuilder, mat4 } from '../world/builders.js';
import { patchMaterial } from '../render/materials.js';
import { clamp, smoothstep } from '../core/rng.js';
import { createIris } from './aperture.js';
import { SKY_TARGET, AZ_SCALE, ALT_SCALE, yawToAz, pitchToAlt } from '../world/skyTarget.js';

// The Mountain observatory's service ladders and roof station, modelled in tools/blender/observatory_design.py
// (build_ladders, build_station). A straight ladder climbs the back of the drum to about half way; a curved one on the
// dome runs on up to a small railed deck near the crown. They meet only when the telescope points at the Dome stack,
// and only then can you climb from one to the other and stand on the deck: its collision exists only then (nobody
// can turn the dome from up there). In the deck's floor is a small iris, shut; pressing the three buttons in front of
// it in order opens it, showing the telescope's two scales with brass pointers at SKY_TARGET.

// How far off the aligned yaw (rad) the ladders still meet. At the limit the rungs are 0.22 m apart sideways at the
// joint and the climber is eased across; one mouse count on the dome's handwheel turns it 0.09 deg.
const LADDER_TOL = THREE.MathUtils.degToRad(2);
// The buttons to press, in order: 0 green (left as you face the iris from the ladder), 1 yellow, 2 red.
export const STATION_ORDER = [0, 1, 2];
const OPEN_TIME = 0.7;          // s for the blades to fly open
const FEET_OUT = 0.28;          // the climber's feet ride this far off the rung line (a straight ladder's 0.5 - 0.22)
const SEAM = 0.6;               // m of the curved ladder over which the climber is eased onto it from the fixed one
const PRESS = 0.009;            // how far a button goes in
const BUTTON_COLORS = [0x2f9e44, 0xe8b400, 0xc92a2a];
// The telescope's scales on the well floor: a compass ring (heading) and a straight altitude scale inside it.
const RING = { inner: 0.175, outer: 0.235 };
const BAR = { half: 0.02, len: 0.28 };

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pol = (r, a, y = 0) => new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * r);   // model angles: 0 at -Z (the door), clockwise
const Y = new THREE.Vector3(0, 1, 0);

// root: the observatory; nodes: its GLB's named nodes; st: ctx.state.observatory; domeAngle(yaw): the dome's turn
// (about the model's +Y, from its rest pose) at a telescope yaw; center: the observatory's position.
export function createStation(ctx, { root, nodes, st, doorAngle, domeAngle, center }) {
  const lad = nodes.LADDER?.userData, sta = nodes.STATION?.userData;
  if (!lad?.path || !sta?.iris) { console.warn('observatory: no LADDER / STATION in the model'); return null; }
  const rad = THREE.MathUtils.degToRad;
  const lon = rad(lad.lon), fixedA = rad(lad.fixedA);
  // The yaw that stands the curved ladder (lon clockwise from the slit) over the fixed one (fixedA clockwise from the
  // door). The design puts it on the Dome stack; say so if the world has moved.
  const yawAlign = doorAngle + fixedA - lon;
  const home = ctx.stacks?.dome;
  if (home && Math.abs(wrap(yawAlign - Math.atan2(home.cz - center.z, home.cx - center.x))) > rad(0.25)) {
    console.warn('observatory: the ladders meet away from the Dome stack; see LAD_LON in observatory_design.py');
  }
  st.stationOpen = false;

  // ---- frames: model (dome at rest) -> world, for the dome at the aligned pose (MA) and as it stands (cur)
  const _r = new THREE.Matrix4();
  const domeMatrix = (yaw, out) => out.copy(root.matrixWorld).multiply(_r.makeRotationY(domeAngle(yaw)));
  const MA = domeMatrix(yawAlign, new THREE.Matrix4());
  const cur = MA.clone();
  // The station deck: origin at the centre of its top, +z outward to the ladder, x across (right as you face the iris).
  const F = new THREE.Matrix4().compose(nodes.STATION.getWorldPosition(new THREE.Vector3()), new THREE.Quaternion().setFromAxisAngle(Y, sta.ry), new THREE.Vector3(1, 1, 1));
  const SW = new THREE.Matrix4(), SWi = new THREE.Matrix4(), outW = new THREE.Vector3();
  const [, , irisZ, irisR] = sta.iris;
  const [btnY, btnZ, btnTilt, btnGap] = sta.btn;
  const [wellY] = sta.well;
  let aligned = false, lastAng = NaN;

  // ---- ladders
  // Fixed: an ordinary ladder from the ground; at its top, while the ladders meet, you climb on onto the curved one.
  const fixed = {
    base: root.localToWorld(pol(lad.rf - 0.22, fixedA)), n: pol(1, fixedA).transformDirection(root.matrixWorld),
    height: lad.yb, width: 0.7, zone: 'surface', fromAbove: false,
    onTop: (p) => { if (!aligned) return false; p.attach(dome, 1e-3); return true; },
  };
  const fixedTop = fixed.base.clone().addScaledVector(fixed.n, 0.5).setY(fixed.base.y + fixed.height);
  // Curved: the feet ride a polyline FEET_OUT off the rung line (exported from Blender in the ladder's meridian plane),
  // parametrised by distance along it.
  const P = [], S = [0], pts = lad.path, np = pts.length / 2;
  for (let i = 0; i < np; i++) {
    const j0 = Math.max(0, i - 1), j1 = Math.min(np - 1, i + 1);
    const tr = pts[2 * j1] - pts[2 * j0], ty = pts[2 * j1 + 1] - pts[2 * j0 + 1], l = Math.hypot(tr, ty);
    P.push(pol(pts[2 * i] + (ty / l) * FEET_OUT, lon, pts[2 * i + 1] - (tr / l) * FEET_OUT));   // outward normal (ty, -tr)
    if (i) S.push(S[i - 1] + P[i].distanceTo(P[i - 1]));
  }
  const seam = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const dome = {
    base: pol(pts[0], lon, pts[1]).applyMatrix4(MA), n: pol(1, lon).transformDirection(MA),
    height: S[np - 1], width: 0.7, zone: 'surface', enabled: false,
    path(h, out, tan) {
      let i = 0;
      while (i < np - 2 && S[i + 1] < h) i++;
      out.lerpVectors(P[i], P[i + 1], clamp((h - S[i]) / (S[i + 1] - S[i]), 0, 1)).applyMatrix4(cur);
      // Within the tolerance the dome's ladder may stand a little to the side of the fixed one's top: ease across.
      if (h < SEAM) out.addScaledVector(seam, 1 - smoothstep(0, SEAM, h));
      if (tan) tan.subVectors(P[i + 1], P[i]).transformDirection(cur);
      return out;
    },
    // From the deck: stand at the opening facing out, look down over the bars and press forward.
    grab(p, a) {
      if (!aligned || a.y <= 0 || p.pitch > -0.3) return null;
      const q = _a.copy(p.feet).applyMatrix4(SWi);
      if (q.z < sta.hz - 0.55 || Math.abs(q.x) > 0.3 || Math.abs(q.y) > 0.4) return null;
      p.forward(_b);
      return (_b.x * outW.x + _b.z * outW.z) / Math.hypot(_b.x, _b.z) > 0.3 ? S[np - 1] - 0.3 : null;
    },
    // Over the top onto the deck.
    onTop(p) {
      if (!aligned) return false;
      p.feet.set(0, 0.03, sta.hz - 0.4).applyMatrix4(SW);
      letGo(p);
      return true;
    },
    // Down onto the fixed ladder, or (if the dome was turned under you) let go.
    onBottom(p) {
      if (aligned) p.attach(fixed, fixed.height - 1e-3);
      else letGo(p);
      return true;
    },
  };
  const letGo = (p) => { p.mode = 'walk'; p.ladder = null; p.onGround = false; p.vel.set(0, 0, 0); p.lastGroundY = p.feet.y; };
  ctx.physics.ladders.push(fixed, dome);

  // ---- the deck's collision at the aligned pose: a slab and a closed ring of rail walls (across the ladder's opening
  // too, like the power tower's catwalk). Added last of all colliders (finish), and on only while the ladders meet.
  const colB = new ColliderBuilder('observatory-station');
  const WA = new THREE.Matrix4().multiplyMatrices(MA, F);
  const box = (x, y, z, w, h, d) => colB.addGeometry(new THREE.BoxGeometry(w, h, d), WA.clone().multiply(mat4(x, y, z)));
  box(0, -0.05, 0, sta.hx * 2, 0.1, sta.hz * 2);
  for (const s of [-1, 1]) {
    box(s * (sta.hx - 0.03), 0.6, 0, 0.06, 1.3, sta.hz * 2);
    box(0, 0.6, s * (sta.hz - 0.03), sta.hx * 2, 1.3, 0.06);
  }
  let stationCol = null;

  // ---- moving bits, turning with the dome (in its rest frame): the iris blades, the button caps and the scales. Each
  // is one draw call, all gone beyond 55 m; the scales are drawn only once the iris is open.
  const spin = new THREE.Group();
  spin.name = 'observatory-station';
  root.add(spin);
  const bits = new THREE.Group();
  spin.add(bits);
  const at = (x, y, z) => F.clone().multiply(mat4(x, y, z));
  const iris = createIris({ radius: irisR, parent: bits, frame: at(0, 0, irisZ) });
  const FB = at(0, btnY, btnZ).multiply(new THREE.Matrix4().makeRotationX(btnTilt));   // the sloped button face, +y out of it
  const capMat = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0, name: 'station-buttons' }));
  const caps = new THREE.InstancedMesh(buttonGeometry(), capMat, 3);
  caps.name = 'station-buttons';
  const pressT = [0, 0, 0], depth = [0, 0, 0];
  const _m = new THREE.Matrix4();
  const placeCaps = () => {
    for (let i = 0; i < 3; i++) caps.setMatrixAt(i, _m.copy(FB).multiply(mat4((i - 1) * btnGap, -depth[i], 0)));
    caps.instanceMatrix.needsUpdate = true;
  };
  BUTTON_COLORS.forEach((c, i) => caps.setColorAt(i, new THREE.Color(c)));
  placeCaps();
  caps.computeBoundingSphere();
  bits.add(caps);
  // Scales: the ring's 0 points at true north when the ladders meet (you can look up from it along the pointer).
  const north = new THREE.Vector3(0, 0, 1).transformDirection(new THREE.Matrix4().copy(WA).invert());
  const dial = dialMesh(Math.atan2(north.x, -north.z));
  dial.matrixAutoUpdate = false;
  dial.matrix.copy(at(0, wellY + 0.0005, irisZ));
  dial.visible = false;
  bits.add(dial);
  ctx.lod?.add(bits, { out: [40, 55], dynamic: true, name: 'observatory-station' });

  // Invisible pick boxes over the buttons (outside the LOD group, so they stay pickable).
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const items = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(btnGap * 0.98, 0.05, 0.07), proxyMat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(FB).multiply(mat4((i - 1) * btnGap, 0.012, 0));
    spin.add(m);
    const it = ctx.interact.add({ name: 'station-button:' + ['green', 'yellow', 'red'][i], meshes: [m], range: 2.2, exact: true, onPress: () => press(i) });
    it.enabled = false;
    return it;
  });

  // ---- the buttons and the iris
  const worldOf = (M, out = new THREE.Vector3()) => out.setFromMatrixPosition(M).applyMatrix4(cur);
  let seq = 0, openT = 0, scrape = null;
  const press = (i) => {
    pressT[i] = 0.16;
    const pos = worldOf(_m.copy(FB).multiply(mat4((i - 1) * btnGap, 0, 0)));
    if (st.stationOpen || i === STATION_ORDER[seq]) {
      ctx.audio?.play('click', { pos });
      if (!st.stationOpen && ++seq === STATION_ORDER.length) open();
    } else {
      seq = i === STATION_ORDER[0] ? 1 : 0;           // a wrong button starts over (from itself, if it comes first)
      ctx.audio?.play('switch', { pos, rate: 0.45 });  // a dull click
    }
  };
  const open = () => {
    if (st.stationOpen) return;
    st.stationOpen = true;
    dial.visible = true;
    scrape = ctx.audio?.loop('scrape', { pos: worldOf(at(0, 0, irisZ)) }) ?? null;
  };

  const update = (dt) => {
    const ang = domeAngle(st.yaw);
    if (ang !== lastAng) {
      lastAng = ang;
      spin.rotation.y = ang;
      domeMatrix(st.yaw, cur);
      SW.multiplyMatrices(cur, F);
      SWi.copy(SW).invert();
      outW.set(0, 0, 1).transformDirection(SW);
    }
    aligned = Math.abs(wrap(st.yaw - yawAlign)) < LADDER_TOL * (aligned ? 1.2 : 1);   // a little hysteresis
    if (aligned) seam.copy(fixedTop).sub(_a.copy(P[0]).applyMatrix4(cur));
    else seam.set(0, 0, 0);
    dome.enabled = aligned;
    if (stationCol) stationCol.enabled = aligned;
    for (const it of items) it.enabled = aligned;
    let moved = false;
    for (let i = 0; i < 3; i++) {
      if (pressT[i] <= 0 && depth[i] === 0) continue;
      pressT[i] = Math.max(0, pressT[i] - dt);
      depth[i] = PRESS * Math.min(1, pressT[i] / 0.06);   // in at once, out over the last 60 ms
      moved = true;
    }
    if (moved) placeCaps();
    if (st.stationOpen && openT < 1) {
      openT = Math.min(1, openT + dt / OPEN_TIME);
      iris.set(openT);
      if (openT === 1) {
        scrape?.stop(); scrape = null;
        ctx.audio?.play('switch', { pos: worldOf(at(0, 0, irisZ)), rate: 0.7 });   // the blades hit their stops
      }
    }
  };

  // Console helpers (screenshots, tests): align() turns the dome (and telescope) the short way round to where the
  // ladders meet; the station applies it on the next frame.
  const ladder = {
    target: yawAlign, tolerance: LADDER_TOL, fixed, dome,
    aligned: () => aligned,
    align: () => { st.yaw += wrap(yawAlign - st.yaw); return st.yaw; },
  };
  const station = {
    order: STATION_ORDER, press, open,
    button: (i) => worldOf(_m.copy(FB).multiply(mat4((i - 1) * btnGap, 0, 0))),
    iris: () => worldOf(at(0, 0, irisZ)),
    deck: (x = 0, z = 0) => new THREE.Vector3(x, 0, z).applyMatrix4(SW),
    items,
  };
  const finish = () => {
    stationCol = ctx.physics.addCollider(colB.build(), 'surface');
    stationCol.enabled = aligned;
  };
  return { update, finish, ladder, station };
}

// A push-button cap, turned: a short skirt and a domed top, 4 mm down in its cup.
function buttonGeometry() {
  const pts = [[0.02, -0.004], [0.02, 0.009], [0.019, 0.013], [0.015, 0.0165], [0.008, 0.018], [0.0005, 0.0183]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 24);
}

// The telescope's scales on the well floor, as one mesh: a raised compass ring for the heading (AZ_SCALE) and a raised
// bar for the tube's elevation (ALT_SCALE), engraved from a canvas, with a brass pointer at SKY_TARGET on each.
// north: the ring angle (clockwise from the far side, seen from above) where heading 0 goes.
function dialMesh(north) {
  const D = RING.outer + 0.015, N = 1024, px = (m) => (m / (2 * D)) * N;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d');
  // Canvas up is the far side of the well (-z), right is +x.
  c.fillStyle = '#a4a8ac';
  c.fillRect(0, 0, N, N);
  c.fillStyle = '#c9a060';
  c.fillRect(N - 24, 0, 24, 24);                     // a brass patch for the pointers
  c.translate(N / 2, N / 2);
  c.strokeStyle = c.fillStyle = '#18191b';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineCap = 'butt';
  // Ring: ticks along its inner edge, where the pointer points; numbers upright to its outer edge.
  for (let v = AZ_SCALE.min; v < AZ_SCALE.max; v += AZ_SCALE.minor) {
    const big = v % AZ_SCALE.major === 0;
    c.save();
    c.rotate(north + (v * Math.PI) / 180);
    c.lineWidth = big ? 4 : 2;
    c.beginPath(); c.moveTo(0, -px(RING.inner)); c.lineTo(0, -px(RING.inner + (big ? 0.019 : 0.011))); c.stroke();
    if (big) { c.font = `bold ${Math.round(px(0.016))}px sans-serif`; c.fillText(String(v), 0, -px(RING.inner + 0.036)); }
    c.restore();
  }
  c.lineWidth = 3;
  for (const r of [RING.inner + 0.0015, RING.outer - 0.003]) { c.beginPath(); c.arc(0, 0, px(r), 0, Math.PI * 2); c.stroke(); }
  // Bar: 0 at the near end, ticks along its right edge, numbers on the left.
  const altZ = (v) => BAR.len / 2 - ((v - ALT_SCALE.min) / (ALT_SCALE.max - ALT_SCALE.min)) * BAR.len;
  for (let v = ALT_SCALE.min; v <= ALT_SCALE.max; v += ALT_SCALE.minor) {
    const big = v % ALT_SCALE.major === 0, y = px(altZ(v));
    c.lineWidth = big ? 4 : 2;
    c.beginPath(); c.moveTo(px(BAR.half), y); c.lineTo(px(BAR.half - (big ? 0.015 : 0.008)), y); c.stroke();
    if (big) { c.font = `bold ${Math.round(px(0.012))}px sans-serif`; c.fillText(String(v), px(-BAR.half * 0.4), y); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  // Shapes in (x, -z); extruded, then stood up so the extrusion runs up +y.
  const ring = new THREE.Shape().absarc(0, 0, RING.outer, 0, Math.PI * 2, false);
  ring.holes.push(new THREE.Path().absarc(0, 0, RING.inner, 0, Math.PI * 2, true));
  const bar = new THREE.Shape([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector2(x * BAR.half, y * BAR.len / 2 + 0.006 * y)));
  const scales = new THREE.ExtrudeGeometry([ring, bar], { depth: 0.003, bevelEnabled: false, curveSegments: 64 });
  // Pointers: brass triangles on the floor, touching each scale at the target.
  const g = north + (yawToAz(SKY_TARGET.yaw) * Math.PI) / 180;
  const d = new THREE.Vector2(Math.sin(g), Math.cos(g)), s = new THREE.Vector2(Math.cos(g), -Math.sin(g));   // in (x, -z)
  const tri = (apex, back, side) => new THREE.Shape([apex, apex.clone().add(back).add(side), apex.clone().add(back).sub(side)]);
  const zt = altZ(clamp(pitchToAlt(SKY_TARGET.pitch), ALT_SCALE.min, ALT_SCALE.max));
  const pointers = new THREE.ExtrudeGeometry([
    tri(d.clone().multiplyScalar(RING.inner - 0.001), d.clone().multiplyScalar(-0.024), s.clone().multiplyScalar(0.009)),
    tri(new THREE.Vector2(BAR.half + 0.001, -zt), new THREE.Vector2(0.024, 0), new THREE.Vector2(0, 0.009)),
  ], { depth: 0.004, bevelEnabled: false });
  for (const geo of [scales, pointers]) geo.rotateX(-Math.PI / 2);
  // UVs: the tops of the scales map the canvas; their sides a plain steel corner; the pointers the brass patch.
  const uv = scales.attributes.uv, pos = scales.attributes.position;
  for (const grp of scales.groups) {             // per shape: its caps (material 0), then its sides
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      if (grp.materialIndex === 0) uv.setXY(i, 0.5 + pos.getX(i) / (2 * D), 0.5 - pos.getZ(i) / (2 * D));
      else uv.setXY(i, 0.004, 0.996);
    }
  }
  const puv = pointers.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, 0.99, 0.99);
  const geo = mergeGeometries([scales, pointers], false);
  geo.clearGroups();
  // Satin, not polished: the well faces the sky, and a mirror finish flares in the sun.
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ map: tex, metalness: 0.35, roughness: 0.55, name: 'station-scales' }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'station-scales';
  mesh.receiveShadow = true;
  return mesh;
}
