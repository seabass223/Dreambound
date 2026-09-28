import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/materials.js';
import { rigged, UV_VERT, createRig, collectParts, partIndex } from '../render/rig.js';

// The underground hub, its four tunnels and the generator that powers them, modeled in Blender
// (tools/blender/cave_design.py). Four power lines run from the generator to the four elevators; the switch
// panel turns each line's lamps (and its elevator) on and off.
//
// The lighting is baked into two lightmaps, one channel per line plus the generator's own lamps and AO, and
// the shaders weight those channels by the line states, so switching a line is instant and needs no lights.
// All materials are unlit; the whole place draws in 7 calls.

export const LINES = ['tower', 'mountain', 'rocks', 'dome'];   // panel order, left to right

export async function loadCave() {
  const loader = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  const [gltf, lm0, lm1, rock, paint, grime] = await Promise.all([
    loader.loadAsync(base + 'cave.glb'),
    ...['cave_lm0.png', 'cave_lm1.png', 'cave_rock.png', 'cave_paint.png', 'cave_grime.png'].map((f) => tl.loadAsync(base + f)),
  ]);
  for (const t of [lm0, lm1]) {
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    // An atlas of many small charts: mipmaps would bleed neighbouring charts together at a distance.
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  for (const t of [rock, paint, grime]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return { gltf, lm0, lm1, rock, paint, grime };
}

// ---------------------------------------------------------------- shaders
const LIGHT_VERT = /* glsl */ `
attribute vec2 aLmUv;
varying vec2 vLmUv;
varying vec3 vCaveP;
varying vec3 vCaveN;
`;
const LIGHT_FRAG = /* glsl */ `
uniform sampler2D uLm0, uLm1, uTex;
uniform vec4 uScale, uLine;
uniform float uHubS, uGain, uAmb, uTexScale;
varying vec2 vLmUv;
varying vec3 vCaveP;
varying vec3 vCaveN;
// Channels: lm0 = (tower, mountain, rocks), lm1 = (dome, generator lamps, AO); light is stored sqrt-encoded.
vec3 caveLight() {
  vec3 a = texture2D(uLm0, vLmUv).rgb;
  vec3 b = texture2D(uLm1, vLmUv).rgb;
  a *= a;
  float L = dot(a * uScale.xyz, uLine.xyz) + b.r * b.r * uScale.w * uLine.w + b.g * b.g * uHubS;
  return vec3(1.0, 0.76, 0.52) * L * uGain + vec3(0.55, 0.62, 0.75) * uAmb * b.b;
}
vec3 triplanar(sampler2D t, float s) {
  vec3 w = pow(abs(normalize(vCaveN)), vec3(8.0));
  w /= w.x + w.y + w.z;
  vec3 p = vCaveP * s;
  return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
}
`;

// Lamps by kind (packed in the UVs): 0 random, 1 steady, 3 chatter, 10+i switch i's bulb, 20+i line i's lamps.
const LAMP_FRAG = /* glsl */ `
uniform vec4 uLine, uSw;
float pick4(vec4 v, float i) { return i < 0.5 ? v.x : i < 1.5 ? v.y : i < 2.5 ? v.z : v.w; }
vec3 lampGlow(vec2 u) {
  float id = floor(u.x), kind = floor(u.y);
  float t = uObsTime;
  if (kind > 19.5) return vec3(1.0, 0.8, 0.55) * mix(0.02, 2.2, pick4(uLine, kind - 20.0));
  if (kind > 9.5) return vec3(1.0, 0.5, 0.14) * mix(0.025, 3.0, pick4(uSw, kind - 10.0));
  float v;
  if (kind < 0.5) { float period = 0.5 + oh1(id) * 2.5; v = step(0.4, oh(vec2(id, floor(t / period + oh1(id + 5.0))))); }
  else if (kind < 1.5) v = 0.94 + 0.06 * sin(t * 3.0 + id);
  else v = step(0.5, oh(vec2(id, floor(t * 9.0 + oh1(id) * 3.0))));
  vec3 c = kind > 0.5 && kind < 1.5 ? vec3(1.0, 0.82, 0.58) : (oh1(id) < 0.5 ? vec3(0.35, 1.0, 0.3) : vec3(1.0, 0.22, 0.12));
  return c * mix(0.04, 2.4, v);
}
`;

// The generator's oscilloscope: a sine trace whose amplitude drops as lines load the generator.
const SCOPE_FRAG = /* glsl */ `
uniform float uAmp;
vec3 scope(vec2 p) {
  float t = uObsTime;
  vec2 g = abs(fract(p * vec2(10.0, 8.0) + 0.5) - 0.5) / vec2(10.0, 8.0);
  float grid = 0.1 * (1.0 - smoothstep(0.0, 0.0025, min(g.x, g.y)));
  grid += 0.1 * (1.0 - smoothstep(0.0, 0.003, min(abs(p.x - 0.5), abs(p.y - 0.5))));
  float w = 6.2831853 * 2.5;
  float A = 0.36 * uAmp;
  float ph = p.x * w - t * 4.0;
  float y = 0.5 + A * sin(ph) + 0.004 * sin(p.x * 173.0 + t * 31.0);
  float slope = A * w * cos(ph);
  float d = abs(p.y - y) / sqrt(1.0 + slope * slope);
  float trace = exp(-pow(d * 180.0, 2.0)) * 1.6 + exp(-pow(d * 40.0, 2.0)) * 0.35;
  float scan = 0.85 + 0.15 * sin(p.y * 380.0);
  float vig = smoothstep(0.78, 0.3, length((p - 0.5) * vec2(1.05, 1.25)));
  float flick = 0.96 + 0.04 * sin(t * 61.0);
  return vec3(0.3, 1.0, 0.55) * (0.035 + grid + trace) * scan * vig * flick;
}
`;

// Meter faces: cream card, an arc of ticks, a red band at the top of the scale. No numbers.
function meterFace() {
  const W = 256, H = 180;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(W / 2, H * 0.6, 20, W / 2, H * 0.6, W * 0.7);
  grd.addColorStop(0, '#ece3c8'); grd.addColorStop(1, '#c9bc98');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const px = W / 2, py = H - H * 0.087, R = 112;
  const at = (deg, r) => [px + Math.sin(deg * Math.PI / 180) * r, py - Math.cos(deg * Math.PI / 180) * r];
  g.lineWidth = 7; g.strokeStyle = '#b3261e';
  g.beginPath(); g.arc(px, py, R - 6, (-90 + 32) * Math.PI / 180, (-90 + 48) * Math.PI / 180); g.stroke();
  g.strokeStyle = '#2f6b3a';
  g.beginPath(); g.arc(px, py, R - 6, (-90 - 10) * Math.PI / 180, (-90 + 10) * Math.PI / 180); g.stroke();
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 1.6;
  g.beginPath(); g.arc(px, py, R, (-90 - 48) * Math.PI / 180, (-90 + 48) * Math.PI / 180); g.stroke();
  for (let a = -48; a <= 48.1; a += 4) {
    const major = Math.round(a) % 12 === 0;
    const [x0, y0] = at(a, R), [x1, y1] = at(a, R + (major ? 13 : 7));
    g.lineWidth = major ? 2.4 : 1.2;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.fillStyle = '#222'; g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill();
  // A little age.
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(90,70,40,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- placement
export function placeCave(ctx, asset, { origin, group, collider }) {
  const { gltf, lm0, lm1 } = asset;
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.position.copy(origin);
  group.add(root);
  root.updateMatrixWorld(true);

  const rig = createRig();
  const { parts, partOf, nodes } = collectParts(src, rig, 'cave');

  // ---- geometry: bake node transforms, tag parts, merge by material; the rock doubles as the collider ----
  const groups = {};
  const cm = new THREE.Matrix4();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material?.name || '').replace(/^cave_/, '');
    if (o.name.startsWith('COLLIDER') || name === 'collider') {
      collider.addGeometry(o.geometry, cm.multiplyMatrices(root.matrixWorld, o.matrixWorld));
      return;
    }
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (name === 'rock') collider.addGeometry(g, root.matrixWorld);
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(partIndex(o, partOf)), 1));
    if (g.attributes.uv1) { g.setAttribute('aLmUv', g.attributes.uv1); g.deleteAttribute('uv1'); }
    for (const k of Object.keys(g.attributes)) if (k.startsWith('uv') && k !== 'uv') g.deleteAttribute(k);
    (groups[name] ||= []).push(g);
  });

  // ---- materials ----
  const meta = nodes.META?.userData || {};
  const time = { value: 0 }, one = { value: 1 };
  const U = {
    uLm0: { value: lm0 }, uLm1: { value: lm1 },
    uScale: { value: new THREE.Vector4(meta.lm_tower ?? 1, meta.lm_mountain ?? 1, meta.lm_rocks ?? 1, meta.lm_dome ?? 1) },
    uHubS: { value: meta.lm_hub ?? 1 },
    uLine: { value: new THREE.Vector4() },
    uSw: { value: new THREE.Vector4() },
    uGain: { value: 2.6 }, uAmb: { value: 0.07 },
    uAmp: { value: 1 },
  };
  const lit = (name, tex, scale, albedo) => rigged(patchMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'cave_' + name })), rig, (sh) => {
    Object.assign(sh.uniforms, U, { uTex: { value: tex }, uTexScale: { value: scale }, uObsTime: time, uObsK: one });
    if (name === 'poster') UV_VERT(sh, '');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + LIGHT_VERT)
      .replace('transformed = rigPoint(transformed);', `transformed = rigPoint(transformed);
        vLmUv = aLmUv;
        vCaveP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCaveN = rigDir(normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LIGHT_FRAG)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = ${albedo} * vColor.rgb * caveLight();`);
  });
  const M = {
    rock: lit('rock', asset.rock, 0.42, 'triplanar(uTex, uTexScale)'),
    paint: lit('paint', asset.paint, 0.9, 'triplanar(uTex, uTexScale)'),
    plain: lit('plain', asset.grime, 0.7, '(triplanar(uTex, uTexScale) * 1.15)'),
    // Steel: grime plus a cheap sheen toward grazing angles.
    metal: lit('metal', asset.grime, 1.3, '(triplanar(uTex, uTexScale) * (0.7 + 1.1 * pow(1.0 - abs(dot(normalize(vCaveN), normalize(cameraPosition - vCaveP))), 3.0)))'),
    poster: lit('poster', meterFace(), 1, 'texture2D(uTex, vObsUv).rgb'),
    lamps: rigged(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'cave_lamps' }), rig, (sh) => {
      Object.assign(sh.uniforms, { uLine: U.uLine, uSw: U.uSw, uObsTime: time, uObsK: one });
      UV_VERT(sh, LAMP_FRAG);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vColor.rgb * lampGlow(vObsUv);');
    }),
    screen: rigged(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'cave_screen' }), rig, (sh) => {
      Object.assign(sh.uniforms, { uAmp: U.uAmp, uObsTime: time, uObsK: one });
      UV_VERT(sh, SCOPE_FRAG);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = scope(vObsUv);');
    }),
  };
  for (const [key, geos] of Object.entries(groups)) {
    const mat = M[key];
    if (!mat) { console.warn('cave: no material for', key); continue; }
    const geo = mergeGeometries(geos, false);
    if (!geo) { console.warn('cave: could not merge', key); continue; }
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.name = 'cave_' + key;
    root.add(mesh);
  }

  // ---- markers ----
  const wp = (name) => nodes[name] ? root.localToWorld(nodes[name].getWorldPosition(new THREE.Vector3())) : null;
  const stations = {};
  for (const line of LINES) {
    const n = nodes['STATION_' + line];
    if (!n) continue;
    stations[line] = { pos: wp('STATION_' + line), rotY: n.userData.rotY ?? 0, doorLamp: wp('DOORLAMP_' + line) };
  }

  // ---- power: the switches, the lines, the elevators ----
  const sw = ctx.state.switches = [false, false, false, true];    // the Dome line is live when you first come down
  ctx.power = {};
  const level = [0, 0, 0, 0];     // lamp brightness per line (flickers as it comes up)
  const since = [9, 9, 9, 9];     // seconds since each line switched on
  const lever = [0, 0, 0, 0];
  const syncPower = () => LINES.forEach((l, i) => { ctx.power[l] = sw[i]; });
  syncPower();
  const leverParts = LINES.map((_, i) => parts.findIndex((q) => q && q.driver === 'sw' + i));
  const needleParts = [0, 1, 2, 3].map((i) => parts.findIndex((q) => q && q.driver === 'm' + i));
  sw.forEach((on, i) => { lever[i] = on ? -0.6 : 0.6; since[i] = 9; });

  const proxyGeo = new THREE.BoxGeometry(0.5, 0.75, 0.6);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const switches = [];
  for (let i = 0; i < 4; i++) {
    const p = wp('SWITCH_' + i);
    if (!p) continue;
    const m = new THREE.Mesh(proxyGeo, proxyMat);
    m.position.copy(p);
    m.rotation.y = Math.atan2(-Math.cos(Math.PI * 95 / 180), -Math.sin(Math.PI * 95 / 180));
    group.add(m);
    switches[i] = ctx.interact.add({
      name: 'generator-switch:' + i, meshes: [m], range: 2.6, exact: true,
      onPress: () => {
        sw[i] = !sw[i];
        since[i] = 0;
        syncPower();
        ctx.audio?.play('breaker', { pos: p, on: sw[i] });
        ctx.onSwitches?.(sw);
      },
    });
  }

  // While a line is live, its door lamp lights the elevator's (standard-material, metal) plate and doors. The
  // pool light sits out in front of the plate, where the baked lamp's light on the tunnel floor would bounce from.
  for (const [i, line] of LINES.entries()) {
    const st = stations[line];
    if (!st) continue;
    const back = new THREE.Vector3(Math.sin(st.rotY), 0, Math.cos(st.rotY));
    ctx.lightPool.add({
      center: st.pos.clone(), radius: 8,
      lights: [{ pos: st.pos.clone().addScaledVector(back, 2.2).setY(st.pos.y + 2.5), color: new THREE.Color(1, 0.8, 0.6), distance: 11, intensity: () => level[i] * 8 }],
    });
  }

  const genPos = wp('GEN_sound');
  if (genPos) ctx.audio?.registerEmitter?.('generator', genPos, 'tunnel');

  let t = 0, amp = 1;
  ctx.updaters.push((dt) => {
    if (!group.visible) return;
    t += dt;
    time.value = t;
    let nOn = 0;
    for (let i = 0; i < 4; i++) {
      since[i] += dt;
      if (sw[i]) {
        nOn++;
        // Filament lamps catching: a few quick stutters, then full.
        const s = since[i];
        level[i] = s > 0.35 ? 1 : (Math.sin(s * 90 + i) > -0.2 ? 0.55 + 0.45 * Math.random() : 0.12);
      } else {
        level[i] = 0;
      }
      lever[i] += ((sw[i] ? -0.6 : 0.6) - lever[i]) * Math.min(1, dt * 28);
      if (leverParts[i] > 0) rig.uRigP.value[leverParts[i]].w = lever[i];
    }
    U.uLine.value.set(level[0], level[1], level[2], level[3]);
    U.uSw.value.set(+sw[0], +sw[1], +sw[2], +sw[3]);
    amp += (1 - 0.2 * nOn - amp) * Math.min(1, dt * 3);
    U.uAmp.value = amp;
    if (ctx.audio) ctx.audio.genLoad = nOn / 4;
    // Meters: voltage sags and current climbs with load; everything trembles with the engine.
    const jit = (k) => Math.sin(t * (7.1 + k * 2.3)) * 0.012 + Math.sin(t * (23.0 + k)) * 0.006;
    const needles = [
      -0.12 + (1 - amp) * 0.4 + jit(0),
      0.72 - nOn * 0.33 + jit(1),
      -0.02 + Math.sin(t * 0.4) * 0.03 + jit(2),
      0.35 - nOn * 0.08 + Math.sin(t * 0.07) * 0.05 + jit(3),
    ];
    needles.forEach((a, k) => { if (needleParts[k] > 0) rig.uRigP.value[needleParts[k]].w = a; });
  });

  return { root, stations, switches, power: ctx.power, genPos, center: wp('GEN_center'), uniforms: U };
}
