import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/materials.js';

// The cartographer's lounge: the Tower elevator's secret third stop, straight below its cave station (press Down again
// there). Modeled and lit in Blender (tools/blender/lounge_design.py): the desk lamp and two faint sconces are baked
// with Cycles into one RGB lightmap, so everything draws unlit, five calls in all (wood, leather, brass, the printed
// things, the glowing shades).

export const LOUNGE_DEPTH = 150;          // metres below the Tower's cave station
const SLOT = 100;                         // decal ids are packed in the texture u: u = SLOT * id + u_local

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
    (groups[name] ||= []).push(g);
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
    lights: [{ pos: lampPos.clone(), color: new THREE.Color(1, 0.72, 0.45), distance: 10, intensity: () => 5 }],
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

  return { root, station, inside, center, lampPos, uniforms: U, finish };
}
