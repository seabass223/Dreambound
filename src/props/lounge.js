import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/materials.js';
import { placeSecret } from './loungeSecret.js';
import { makeInspectable } from './inspect.js';

// The cartographer's lounge: the Tower elevator's secret third stop, straight below its cave station (press Down again
// there). Modeled and lit in Blender (tools/blender/lounge_design.py): the desk lamp and two faint sconces are baked
// with Cycles into one RGB lightmap, so everything draws unlit, five calls in all (wood, leather, brass, the printed
// things, the glowing shades).

export const LOUNGE_DEPTH = 150;          // metres below the Tower's cave station
const SLOT = 100;
const GLOBE_GAIN = 0.0021;                // the bulbs' power (W) to the globe's live lighting, matched to the bake beside it                         // decal ids are packed in the texture u: u = SLOT * id + u_local

const FILES = {
  lm: 'lounge_lm.png', wood: 'lounge_wood.png', leather: 'lounge_leather.png', map: 'lounge_map.png', card: 'lounge_card.png',
  dots: 'lounge_card_dots.png', rug: 'lounge_rug.png', prints: 'lounge_prints.png', floor: 'lounge_floor.png',
};

export async function loadLounge() {
  const loader = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  const keys = Object.keys(FILES);
  const [gltf, ...tex] = await Promise.all([loader.loadAsync(base + 'lounge.glb'), ...keys.map((k) => tl.loadAsync(base + FILES[k]))]);
  const T = Object.fromEntries(keys.map((k, i) => [k, tex[i]]));
  for (const [k, t] of Object.entries(T)) {
    t.flipY = false;                      // glTF UVs
    if (k === 'lm') {
      t.colorSpace = THREE.NoColorSpace;
      // An atlas of many small charts: mipmaps would bleed neighbouring charts together.
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      continue;
    }
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (k === 'wood' || k === 'leather' || k === 'floor') t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { gltf, ...T };
}

// ---------------------------------------------------------------- shaders
const VERT = /* glsl */ `
attribute vec2 aLmUv;
varying vec2 vLmUv;
varying vec2 vLUv;
varying vec3 vLP;
varying vec3 vLN;
`;
const FRAG = /* glsl */ `
uniform sampler2D uLm;
uniform float uLmScale, uGain;
uniform vec3 uAmb;
uniform vec3 uLampPos, uLampCol;
varying vec2 vLmUv;
varying vec2 vLUv;
varying vec3 vLP;
varying vec3 vLN;
// Baked light, stored as (L / scale)^(1/3), over a faint warm floor so the darkest corners still read.
vec3 loungeLight() { vec3 s = texture2D(uLm, vLmUv).rgb; return s * s * s * uLmScale * uGain + uAmb; }
// The desk lamp's highlight, kept to where its light reaches (the baked light there is bright).
vec3 lampSpec(vec3 light, float shin) {
  vec3 N = normalize(vLN), V = normalize(cameraPosition - vLP);
  vec3 L = uLampPos - vLP;
  float d = length(L);
  L /= d;
  float reach = clamp(dot(light, vec3(0.3, 0.59, 0.11)) * 1.6, 0.0, 1.0);
  return uLampCol * pow(max(dot(N, normalize(L + V)), 0.0), shin) * max(dot(N, L), 0.0) * reach / (1.0 + d * d * 3.0);
}
`;
// The printed things: the map (0), the card with its dots (1), the rug (2), the prints (3), the floor planks (4, tiled),
// plain paper and plaster (9: the vertex colour alone).
const DECAL = /* glsl */ `
uniform sampler2D uMapT, uCard, uDots, uRug, uPrints, uFloor;
vec3 decal(vec2 uv) {
  float id = floor((uv.x + ${SLOT / 2}.0) / ${SLOT}.0);
  vec2 t = vec2(uv.x - id * ${SLOT}.0, uv.y);
  if (id < 0.5) return texture2D(uMapT, t).rgb;
  if (id < 1.5) { vec4 d = texture2D(uDots, t); return mix(texture2D(uCard, t).rgb, d.rgb, d.a); }
  if (id < 2.5) return texture2D(uRug, t).rgb;
  if (id < 3.5) return texture2D(uPrints, t).rgb;
  if (id < 4.5) return textureGrad(uFloor, fract(t), dFdx(t), dFdy(t)).rgb;
  return vec3(1.0);
}
`;

// patchMaterial (fog, underground) plus the lounge's lighting; `body` rewrites diffuseColor after the vertex colour.
function loungeMaterial(name, U, opts, body, extra = '') {
  const mat = patchMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'lounge_' + name, ...opts }));
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLmUv = aLmUv;
        vLUv = uv;
        vLP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vLN = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG + extra)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + body);
  };
  mat.customProgramCacheKey = () => prevKey.call(mat) + '|lounge_' + name;
  return mat;
}

// ---------------------------------------------------------------- placement
// below: the Tower's cave station { pos, rotY }; the lounge's own station ends up straight under it. hide: the cave's root,
// not drawn while the lounge is.
export function placeLounge(ctx, asset, { below, group, collider, hide = null }) {
  const src = asset.gltf.scene;
  src.updateMatrixWorld(true);
  const nodes = {};
  src.traverse((o) => { if (o.name) nodes[o.name] = o; });
  const stL = nodes.STATION.position.clone();
  const root = new THREE.Group();
  root.name = 'lounge';
  root.rotation.y = below.rotY;
  root.position.copy(below.pos).add(new THREE.Vector3(0, -LOUNGE_DEPTH, 0)).sub(stL.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), below.rotY));
  group.add(root);
  root.updateMatrixWorld(true);

  // ---- geometry: merged per material; the COLLIDER boxes become collision ----
  const groups = {};
  const globeParts = { globe_tilt: {}, globe_spin: {} };   // the globe's moving parts, by layer then material
  const secretParts = {};                                  // the bookcase's secret door, by material
  const drawerParts = {};                                  // the desk's opening drawer, by material
  const m4 = new THREE.Matrix4();
  src.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.startsWith('COLLIDER')) {
      collider.addGeometry(o.geometry, m4.multiplyMatrices(root.matrixWorld, o.matrixWorld));
      return;
    }
    const name = (o.material?.name || '').replace(/^lounge_/, '');
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.attributes.uv1) { g.setAttribute('aLmUv', g.attributes.uv1); g.deleteAttribute('uv1'); }
    for (const k of Object.keys(g.attributes)) if (k.startsWith('uv') && k !== 'uv') g.deleteAttribute(k);
    const lay = o.userData?.layer ?? o.name.split('@')[1]?.replace(/[._]\d+$/, '');
    if (lay in globeParts) (globeParts[lay][name] ||= []).push(g);
    else if (lay === 'secret') (secretParts[name] ||= []).push(g);
    else if (lay === 'drawer') (drawerParts[name] ||= []).push(g);
    else (groups[name] ||= []).push(g);
  });

  const meta = nodes.META?.userData || {};
  const wp = (n) => root.localToWorld(nodes[n].getWorldPosition(new THREE.Vector3()));
  const lampPos = wp('LAMP');
  const U = {
    uLm: { value: asset.lm }, uLmScale: { value: meta.lm_scale ?? 1 }, uGain: { value: 1.3 }, uAmb: { value: new THREE.Color(0.03, 0.022, 0.015) },
    uLampPos: { value: lampPos }, uLampCol: { value: new THREE.Color(...(meta.lamp ?? [1, 0.72, 0.45])) },
  };
  const M = {
    // Varnished walnut and waxed leather catch a soft highlight of the lamp.
    wood: loungeMaterial('wood', U, { map: asset.wood }, 'vec3 lt = loungeLight(); diffuseColor.rgb = diffuseColor.rgb * lt + lampSpec(lt, 36.0) * 0.12;'),
    leather: loungeMaterial('leather', U, { map: asset.leather }, 'vec3 lt = loungeLight(); diffuseColor.rgb = diffuseColor.rgb * lt + lampSpec(lt, 14.0) * 0.06;'),
    // Brass: its colour lit, a highlight of the lamp and a sheen toward grazing angles.
    brass: loungeMaterial('brass', U, {}, `vec3 lt = loungeLight();
      vec3 bN = normalize(vLN), bV = normalize(cameraPosition - vLP);
      float fres = pow(1.0 - abs(dot(bN, bV)), 3.0);
      diffuseColor.rgb = diffuseColor.rgb * (lt * (0.75 + 1.2 * fres) + lampSpec(lt, 60.0) * 3.0);`),
    decal: loungeMaterial('decal', {
      ...U, uMapT: { value: asset.map }, uCard: { value: asset.card }, uDots: { value: asset.dots }, uRug: { value: asset.rug },
      uPrints: { value: asset.prints }, uFloor: { value: asset.floor },
    }, {}, 'diffuseColor.rgb *= decal(vLUv) * loungeLight();', DECAL),
    // Lamp shades and bulbs glow (bright enough to bloom); nothing lights them.
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, name: 'lounge_glow', color: new THREE.Color(2.6, 2.6, 2.6) }),
  };
  for (const [key, geos] of Object.entries(groups)) {
    const mat = M[key];
    if (!mat) { console.warn('lounge: no material for', key); continue; }
    const geo = mergeGeometries(geos, false);
    if (!geo) { console.warn('lounge: could not merge', key); continue; }
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.name = 'lounge_' + key;
    root.add(mesh);
  }

  // ---- the globe: two transforms, so it never gimbal-locks. The stand's frame (GLOBE: its centre, turned ry) holds
  // the tilt, about the frame's z (the meridian slides through the horizon ring); inside it the spin, about the polar
  // axis (the tilted y). Hold press on the ball and move the mouse: across spins it (and it coasts on a little when you
  // let go), up and down tilts the axis, between upright and 60 degrees. Its parts were modelled in their rest pose
  // (baked there, so the stand keeps their shadow); here they are moved into the frames, and lit by the room's bulbs
  // as they turn (a baked lightmap would turn with them).
  // ---- the secret: the bookcase's two east bays swing back into a passage to another elevator (props/loungeSecret.js),
  // opened by pressing the island on the globe that the deck's postcard shows ----
  const secret = nodes.SECRET ? placeSecret(ctx, { root, group, node: nodes.SECRET, parts: secretParts, M, collider }) : null;
  const globe = nodes.GLOBE ? placeGlobe(ctx, { root, group, node: nodes.GLOBE, parts: globeParts, U, asset, nodes, wp, secret }) : null;
  // ---- the desk's drawer: press it to slide it out, a note in it ----
  const drawer = nodes.DESK_DRAWER ? placeDeskDrawer(ctx, { root, parts: drawerParts, M, node: nodes.DESK_DRAWER, note: nodes.DESK_NOTE }) : null;

  // ---- the elevator's stop, sound, the lamp on the (standard-material) elevator doors ----
  const sn = nodes.STATION;
  const station = { pos: wp('STATION'), rotY: below.rotY + (sn.userData.rotY ?? 0), callPos: sn.userData.callPos };
  const b = meta.bounds ?? [-3.5, -0.2, -3.2, 3.5, 3.2, 3];
  const box = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
  const inv = root.matrixWorld.clone().invert();
  const q = new THREE.Vector3();
  const inside = (p) => box.containsPoint(q.copy(p).applyMatrix4(inv));
  const center = root.localToWorld(box.getCenter(new THREE.Vector3()));
  ctx.lightPool.add({
    center: center.clone(), radius: 5,
    lights: [{ pos: lampPos.clone(), color: new THREE.Color(1, 0.72, 0.45), distance: 10, intensity: () => 5 }, ...(secret?.lights ?? [])],
  });
  // Registered once the world is built (world/index.js), so the lounge's collision and sound come after everything
  // else's. Walls and furniture collide as oriented boxes (sideways pushes only; see lounge_design.py colliders()).
  const finish = () => {
    ctx.deferCollider(collider, 'tunnel');
    const floorY = root.position.y;
    for (const [name, n] of Object.entries(nodes)) {
      if (!name.startsWith('OBB_')) continue;
      const u = n.userData, c = wp(name);
      ctx.physics.addOBB({ x: c.x, z: c.z, hx: u.hx, hz: u.hz, ry: below.rotY + (u.ry ?? 0), y0: floorY + u.y0, y1: floorY + u.y1, zone: 'tunnel' });
    }
    if (nodes.SOUND) ctx.audio?.registerEmitter?.('roomtone', wp('SOUND'), 'tunnel');
  };

  // Only drawn near it: from the cave station 150 m up it's gone (render/lod.js). While it is drawn, the cave above
  // isn't: nothing of it can be seen from down here.
  ctx.lod?.add(root, { out: [40, 55], fade: false, name: 'lounge' });
  ctx.updaters.push(() => { if (hide) hide.visible = !root.visible; });

  return { root, station, inside, center, lampPos, uniforms: U, finish, globe, secret, drawer };
}

// The desk's opening drawer (the chair side's left one; layer 'drawer' in lounge_design.py): its front, pull and box,
// built pulled out by DESK_DRAWER.travel (so the bake lit its inside), are moved back in to start shut. Press its front
// to slide it out, again to push it in. A note lies in it (DESK_NOTE), one typed line: REMOTE_TRANSFORM; with the drawer
// out, press the note to hold it up to read (props/inspect.js), again to put it back. It rides in and out with the drawer.
const DESK_DRAWER_TIME = 0.5;
function placeDeskDrawer(ctx, { root, parts, M, node, note }) {
  const u = node.userData, travel = u.travel ?? 0.3;
  const group = new THREE.Group();
  group.name = 'lounge-desk-drawer';
  for (const [key, geos] of Object.entries(parts)) {
    const mat = M[key], geo = mat && mergeGeometries(geos, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'lounge_drawer_' + key;
    group.add(mesh);
  }
  root.add(group);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(u.w ?? 0.44, 0.12, 0.06), new THREE.MeshBasicMaterial({ visible: false }));
  hit.name = 'lounge:desk-drawer';
  hit.position.copy(node.position).add(new THREE.Vector3(0, 0, 0.02));
  group.add(hit);
  let x = 0, target = 0, e = 0;                  // 0 shut .. 1 out (x linear, e eased)
  const place = () => { group.position.z = (e - 1) * travel; group.updateMatrixWorld(true); };
  place();
  ctx.interact.add({
    name: 'lounge:desk-drawer', meshes: [hit], range: 2.2, exact: true, zone: 'tunnel',
    onPress: () => {
      if (paper && paper.mode() !== 'rest') return;   // (the note is out: put it back first)
      target = target > 0.5 ? 0 : 1;
      ctx.audio?.play('drawer', { pos: root.localToWorld(node.position.clone()), open: target > 0.5, dur: DESK_DRAWER_TIME * Math.abs(target - x) });
    },
  });

  // The note: card stock, typed, lying face up in the drawer.
  let paper = null;
  if (note) {
    const n = note.userData, w = n.w ?? 0.2, h = n.h ?? 0.14;
    const tex = noteTexture();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), patchMaterial(new THREE.MeshStandardMaterial({
      // (Dim: the lamp's light pool casts no shadow, and in the drawer, under the desk's top, the card sits in the shade
      // the baked wood round it shows; held up, its glow brings it to the light.)
      name: 'lounge-note', map: tex, color: tex ? 0x4a4640 : 0x46423c, roughness: 0.88, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0,
    })));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), patchMaterial(new THREE.MeshStandardMaterial({ name: 'lounge-note-back', color: 0x45403a, roughness: 0.9 })));
    back.rotation.y = Math.PI;
    back.position.z = -0.0005;
    const obj = new THREE.Group();
    obj.name = 'lounge-note';
    obj.add(front, back);
    root.add(obj);
    const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, n.ry ?? 0, 0, 'YXZ'));
    const restP0 = note.position.clone();
    const inspect = makeInspectable(ctx, {
      object: obj, parent: root, meshes: [front, back], name: 'lounge:note', hold: 0.24, glow: { material: front.material, amount: 0.3 },
      canLift: () => e >= 0.9,
      rest: (outP, outQ) => { outP.copy(restP0); outP.z += (e - 1) * travel; outQ.copy(restQ); },
    });
    paper = inspect;
  }
  ctx.updaters.push((dt) => {
    if (x !== target) {
      x = target > x ? Math.min(target, x + dt / DESK_DRAWER_TIME) : Math.max(target, x - dt / DESK_DRAWER_TIME);
      e = x * x * (3 - 2 * x);
      place();
    }
    paper?.update(dt);
  });
  return { group, note: paper, isOpen: () => target > 0.5, set(o) { target = x = o ? 1 : 0; e = x; place(); } };
}

// The note's face: cream card stock with a faint tooth, one typed line (a typewriter's uneven strike), a little off
// square. Drawn to a canvas (no text anywhere else in the world is meant to be read; this one is). Headless: none.
function noteTexture() {
  if (typeof document === 'undefined') return null;
  const W = 1024, H = 717, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ece3cf';
  g.fillRect(0, 0, W, H);
  // Tooth and a little foxing.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) { const v = 200 + rnd() * 40; g.fillStyle = `rgba(${v},${v - 12},${v - 34},0.05)`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
  for (let i = 0; i < 6; i++) { const r = 8 + rnd() * 22; const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, 'rgba(150,110,60,0.10)'); gr.addColorStop(1, 'rgba(150,110,60,0)'); g.save(); g.translate(rnd() * W, rnd() * H); g.fillStyle = gr; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore(); }
  // The line, typed: each letter struck a little differently.
  const text = 'REMOTE_TRANSFORM';
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(-0.012);
  g.font = 'bold 74px "Courier New", Courier, monospace';
  g.textBaseline = 'middle';
  const adv = g.measureText('M').width, x0 = -(adv * text.length) / 2;
  for (let i = 0; i < text.length; i++) {
    const k = 0.72 + rnd() * 0.28;
    g.fillStyle = `rgba(28,26,34,${k.toFixed(2)})`;
    g.fillText(text[i], x0 + i * adv + (rnd() - 0.5) * 2, (rnd() - 0.5) * 3);
  }
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const GLOBE_TILT = [0, THREE.MathUtils.degToRad(60)];   // the axis's tilt from upright, as far as it will go each way
const GLOBE_LIGHT = /* glsl */ `
uniform vec3 uGLPos[3];
uniform vec3 uGLCol[3];
// The room's bulbs on a surface that moves: Lambert with the inverse-square fall-off, over the room's floor light.
vec3 globeLight() {
  vec3 N = normalize(vLN), acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 L = uGLPos[i] - vLP;
    float d2 = dot(L, L);
    acc += uGLCol[i] * max(dot(N, L * inversesqrt(d2)), 0.0) / (d2 + 0.04);
  }
  return acc + uAmb * 4.0;
}
`;

function placeGlobe(ctx, { root, group, node, parts, U, asset, nodes, wp, secret }) {
  const u = node.userData;
  const frame = new THREE.Group();
  frame.name = 'lounge-globe';
  frame.position.copy(node.position);
  frame.rotation.y = u.ry ?? 0;
  const tiltNode = new THREE.Group(), spinNode = new THREE.Group();
  tiltNode.rotation.z = u.tilt ?? 0;
  frame.add(tiltNode);
  tiltNode.add(spinNode);
  root.add(frame);
  frame.updateMatrixWorld(true);
  // Model space -> the rest pose's local frame (the stand's turn, then the tilt; the spin starts at 0).
  const rest = new THREE.Matrix4().makeRotationY(u.ry ?? 0).multiply(new THREE.Matrix4().makeRotationZ(u.tilt ?? 0)).setPosition(node.position);
  const toLocal = rest.clone().invert();

  // Up to three bulbs (the desk lamp and the two sconces), in world space.
  const lights = Object.keys(nodes).filter((n) => /^LIGHT_\d+$/.test(n)).sort().slice(0, 3);
  const GU = {
    ...U,
    uGLPos: { value: [0, 1, 2].map((i) => (lights[i] ? wp(lights[i]) : new THREE.Vector3(0, -1000, 0))) },
    uGLCol: { value: [0, 1, 2].map((i) => {
      const d = lights[i] ? nodes[lights[i]].userData : null;
      return d ? new THREE.Color(...(d.color ?? [1, 0.7, 0.45])).multiplyScalar((d.power ?? 20) * GLOBE_GAIN) : new THREE.Color(0, 0, 0);
    }) },
  };
  const decalU = {
    uMapT: { value: asset.map }, uCard: { value: asset.card }, uDots: { value: asset.dots }, uRug: { value: asset.rug },
    uPrints: { value: asset.prints }, uFloor: { value: asset.floor },
  };
  const mats = {
    brass: loungeMaterial('globe_brass', GU, {}, `vec3 lt = globeLight();
      vec3 bN = normalize(vLN), bV = normalize(cameraPosition - vLP);
      float fres = pow(1.0 - abs(dot(bN, bV)), 3.0);
      diffuseColor.rgb = diffuseColor.rgb * (lt * (0.75 + 1.2 * fres) + lampSpec(lt, 60.0) * 3.0);`, GLOBE_LIGHT),
    decal: loungeMaterial('globe_decal', { ...GU, ...decalU }, {}, 'diffuseColor.rgb *= decal(vLUv) * globeLight();', DECAL + GLOBE_LIGHT),
  };
  const addParts = (byMat, parent) => {
    for (const [key, geos] of Object.entries(byMat)) {
      const mat = mats[key];
      if (!mat) { console.warn('lounge globe: no material for', key); continue; }
      const geo = mergeGeometries(geos, false);
      geo.applyMatrix4(toLocal);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'lounge_globe_' + key;
      parent.add(mesh);
    }
  };
  addParts(parts.globe_tilt, tiltNode);
  addParts(parts.globe_spin, spinNode);

  // Hold press on it and move the mouse. The pick sphere is outside the LOD group, so it stays pickable.
  const R = u.radius ?? 0.24;
  const pick = new THREE.Mesh(new THREE.SphereGeometry(R + 0.05, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  pick.name = 'lounge-globe-pick';
  pick.position.copy(frame.getWorldPosition(new THREE.Vector3()));
  group.add(pick);
  pick.updateMatrixWorld(true);
  const state = { spin: 0, tilt: u.tilt ?? 0, vel: 0, held: false };
  let restSpin = 0;   // the spin it rests at (set below: the island toward the wall)
  // The island on the deck's postcard (the small one at the globe map's east edge, 52 N): a press on its land opens the
  // bookcase (props/loungeSecret.js). Its box on the map (s along the map from its west edge, t up from the south pole)
  // and, where the page can read the texture, the atlas's pixels over that box, to tell land from sea.
  const ISLAND = { s: [0.94, 0.985], t: [0.755, 0.83] };
  const ball = spinNode.children.find((m) => m.name === 'lounge_globe_decal');
  const _rc = new THREE.Raycaster(), _c0 = new THREE.Vector2(0, 0);
  let land = null;
  const img = asset.prints?.image;
  if (typeof document !== 'undefined' && img?.width) {
    try {
      const W = img.width, H = img.height;
      const x0 = Math.floor((0.5 + ISLAND.s[0] * 0.5) * W), x1 = Math.ceil((0.5 + ISLAND.s[1] * 0.5) * W);
      const y0 = Math.floor((0.5 - ISLAND.t[1] * 0.5) * H), y1 = Math.ceil((0.5 - ISLAND.t[0] * 0.5) * H);
      const cv = document.createElement('canvas');
      cv.width = x1 - x0; cv.height = y1 - y0;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height);
      land = { data: g.getImageData(0, 0, cv.width, cv.height).data, x0, y0, w: cv.width, h: cv.height, W, H };
    } catch { land = null; }
  }
  const SEA = [201, 185, 156];   // the globe's sea (sRGB); land, coast and ink are all well off it
  const onIsland = () => {
    if (!ball) return false;
    _rc.setFromCamera(_c0, ctx.camera);
    const h = _rc.intersectObject(ball, false)[0];
    if (!h?.uv) return false;
    const ms = ((h.uv.x % SLOT) - 0.5) * 2, mt = (0.5 - h.uv.y) * 2;   // the globe's region of the prints atlas
    if (ms < ISLAND.s[0] || ms > ISLAND.s[1] || mt < ISLAND.t[0] || mt > ISLAND.t[1]) return false;
    if (!land) return true;
    const px = Math.floor((h.uv.x % SLOT) * land.W) - land.x0, py = Math.floor(h.uv.y * land.H) - land.y0;
    if (px < 0 || py < 0 || px >= land.w || py >= land.h) return false;
    const k = (py * land.w + px) * 4, d = land.data;
    return Math.abs(d[k] - SEA[0]) + Math.abs(d[k + 1] - SEA[1]) + Math.abs(d[k + 2] - SEA[2]) > 26;
  };
  const apply = () => { spinNode.rotation.y = state.spin; tiltNode.rotation.z = state.tilt; };
  let lastDt = 1 / 60;
  // The island only counts as a deliberate click on it: pressed with the globe at rest, released without dragging (the
  // mouse moved under CLICK_SLOP pixels while held), the reticle still on the island. A press that lands on it while
  // spinning the globe, or a drag that starts on it, just turns the globe.
  const CLICK_SLOP = 8, AT_REST = 0.25;   // px of mouse travel; spin speed (rad/s) below which the globe is at rest
  const click = { armed: false, moved: 0 };
  const turn = (mx, my) => {
    click.moved += Math.abs(mx) + Math.abs(my);
    const ds = mx * 0.006;
    state.spin += ds;
    state.vel = state.vel * 0.6 + (ds / lastDt) * 0.4;   // for the coast when you let go
    state.tilt = THREE.MathUtils.clamp(state.tilt + my * 0.004, GLOBE_TILT[0], GLOBE_TILT[1]);
    apply();
  };
  ctx.interact.add({
    name: 'lounge:globe', meshes: [pick], range: 2.2, zone: 'tunnel',
    onPress: () => {
      click.armed = !!secret && Math.abs(state.vel) < AT_REST && onIsland();
      click.moved = 0;
      state.held = true;
      state.vel = 0;
      ctx.player.lookHandler = turn;
    },
    onRelease: () => {
      state.held = false;
      if (ctx.player.lookHandler === turn) ctx.player.lookHandler = null;
      // the island, clicked: the bookcase opens (and the globe stays put)
      if (click.armed && click.moved < CLICK_SLOP && onIsland() && secret.trigger()) state.vel = 0;
      click.armed = false;
    },
  });
  // Let go mid-spin and it coasts, slowing on its bearings.
  ctx.updaters.push((dt) => {
    if (dt > 0) lastDt = dt;
    if (state.held) { state.vel *= Math.exp(-dt * 6); return; }   // (held still, the flick dies away)
    if (Math.abs(state.vel) < 0.01) { state.vel = 0; return; }
    state.spin += state.vel * dt;
    state.vel *= Math.exp(-dt * 1.4);
    apply();
  });
  // At rest the island faces the wall behind the globe (it stands too close to it to walk round), so it has to be
  // found by turning the globe. Its direction on the ball: the mean of the ball's vertices nearest it on the map.
  const islandDir = (() => {
    const g = ball?.geometry;
    if (!g?.attributes.uv) return null;
    const P = g.attributes.position, UV = g.attributes.uv;
    const iu = 0.5 + ((ISLAND.s[0] + ISLAND.s[1]) / 2) * 0.5, iv = 0.5 - ((ISLAND.t[0] + ISLAND.t[1]) / 2) * 0.5;   // in the atlas
    const near = [];
    for (let i = 0; i < UV.count; i++) {
      const d = Math.hypot((UV.getX(i) % SLOT) - iu, UV.getY(i) - iv);
      near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const v = new THREE.Vector3();
    for (const [d, i] of near.slice(0, 4)) v.add(new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)).multiplyScalar(1 / (d + 1e-4)));
    return v.normalize();
  })();
  if (islandDir) {
    // The spin that shows it least to anyone standing in the room: over a grid of the places you can stand (in from the
    // walls, out of the globe's stand), the most squarely any of them sees it, made as small as it can be (one turn only
    // moves it round its latitude, so from beside the globe near the wall it can still be glimpsed, edge-on).
    const g0 = node.position, eyes = [];
    for (let x = -3.2; x <= 3.2; x += 0.2) for (let z = -2.7; z <= 2.3; z += 0.2) {
      if (Math.abs(x - g0.x) < 0.66 && Math.abs(z - g0.z) < 0.66) continue;
      eyes.push(root.localToWorld(new THREE.Vector3(x, 1.66, z)));
    }
    const c = frame.getWorldPosition(new THREE.Vector3()), n = new THREE.Vector3(), q = new THREE.Vector3(), R0 = u.radius ?? 0.24;
    let best = Infinity;
    for (let k = 0; k < 360; k++) {
      state.spin = (k / 360) * Math.PI * 2;
      apply();
      frame.updateMatrixWorld(true);
      n.copy(islandDir).transformDirection(spinNode.matrixWorld);
      let worst = -1;
      for (const e of eyes) worst = Math.max(worst, q.copy(e).sub(c).addScaledVector(n, -R0).normalize().dot(n));
      if (worst < best) { best = worst; restSpin = state.spin; }
    }
    state.spin = restSpin;
  }
  apply();
  return {
    frame, tiltNode, spinNode, state, restSpin,
    set(spin, tilt) { state.spin = spin; if (tilt != null) state.tilt = THREE.MathUtils.clamp(tilt, GLOBE_TILT[0], GLOBE_TILT[1]); state.vel = 0; apply(); },
  };
}
