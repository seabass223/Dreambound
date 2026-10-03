import * as THREE from 'three';
import { GLTFLoader } from '../render/gltf.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/materials.js';
import { Textures } from '../render/textures.js';
import { atmo, atmoState } from '../render/atmosphere.js';
import { clamp } from '../core/rng.js';
import { rigged, UV_VERT, createRig, collectParts, partIndex } from '../render/rig.js';
import { SCREEN_FRAG, createCrtMessage } from '../render/crt.js';
import { FAR_BAND, mergeable } from '../render/lod.js';
import { createScopeExit } from '../ui/scopeExit.js';
import { createStation } from './observatoryStation.js';
import { makeInspectable } from './inspect.js';
import { SKY_TARGET, VIEW_DROP } from '../world/skyTarget.js';
import { createCoordsPan, coordsFinal, COORDS_LINES } from '../sequences/coordsPan.js';

// The Mountain observatory, modeled in Blender (tools/blender/observatory_design.py): a stucco drum and a
// riveted rotating dome, a refractor on a fork mount, geared handwheels, a periscope eyepiece and a room
// of 70s electronics.
//
// Every moving part (dome, telescope, gears, dial needles, anemometer) is skinned on the GPU: the whole
// building is merged into one mesh per material, each vertex tagged with its part, and the vertex shader
// turns it about the part's pivot and then its parent's. The observatory draws in ~15 calls.

export async function loadObservatory() {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  const [gltf, ao, print] = await Promise.all([
    loader.loadAsync(base + 'observatory.glb'),
    new THREE.TextureLoader().loadAsync(base + 'observatory_ao.png'),
    // The print lying in a filing drawer (see the filing cabinets in placeObservatory).
    new THREE.TextureLoader().loadAsync(base + 'telescope_capture.jpg').catch(() => null),
  ]);
  if (print) { print.colorSpace = THREE.SRGBColorSpace; print.anisotropy = 8; }
  ao.flipY = false;
  ao.channel = 1;
  ao.colorSpace = THREE.NoColorSpace;
  // An atlas of many small charts: mipmapping would bleed neighbouring charts together at a distance.
  ao.generateMipmaps = false;
  ao.minFilter = THREE.LinearFilter;
  // A white patch in the atlas's empty top-left corner, for the parts left out of the bake (the filing drawers, which
  // slide out of their dark case): their second UVs all point at it (WHITE_UV), so they get no occlusion.
  if (typeof document !== 'undefined' && ao.image) {
    const c = document.createElement('canvas');
    c.width = ao.image.width; c.height = ao.image.height;
    const g = c.getContext('2d');
    g.drawImage(ao.image, 0, 0);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 8, 8);
    ao.image = c;
    ao.needsUpdate = true;
  }
  return { gltf, ao, print };
}
const WHITE_UV = [3 / 2048, 3 / 2048];
const DRAWER_TIME = 0.55;   // s for a filing drawer to slide all the way out or in

// Blender materials merged into one game material: [game material, value packed into vertex alpha
// (metalness for 'metal', roughness for 'plain'), color multiplied into the vertex colors].
const MERGE = {
  brass: ['metal', 1.0, 0xe2b467], steel: ['metal', 0.6], metal_black: ['metal', 0.35],
  painted: ['plain', 0.55], leather: ['plain', 0.4], rubber: ['plain', 0.9], ceramic: ['plain', 0.18],
};
const NO_SHADOW = new Set(['glass', 'emissive', 'lamps', 'screen', 'reels', 'poster', 'plate', 'wood_floor']);
// Layers from the Blender build: everything inside the drum fades out as you leave the summit, the weather
// mast and shelter further out. The drum and dome are always drawn.
const LAYER_OUT = { in: [45, 65], near: [110, 140] };
// Rear hatch: how far off the tor top may sit in each axis of the eyepiece for the panel to open (the reticle's
// centring circle has a radius of 0.18 deg, its dashed ring 0.64 deg; see gearing() for how far the mouse turns
// the dome and the tube), and how long the panel takes to swing.
const HATCH_TOL = THREE.MathUtils.degToRad(0.35);
const HATCH_TIME = 1.5;
// The coordinates (the endgame's first step: rocks.exe wants them): the telescope held on SKY_TARGET, within COORDS_TOL
// in each axis (the whole constellation is in the field within ~0.25 deg), with the figure showing, for COORDS_DWELL s.
// Leaving the eyepiece then hands the view to the desk terminal (DESK_SCREEN, the green text one at 108 deg), which
// reads them out (sequences/coordsPan.js): the camera ends square-on to its face, PAN_DIST out, at fov PAN_FOV.
const COORDS_TOL = THREE.MathUtils.degToRad(0.4);
const COORDS_DWELL = 1.0;
const DESK_SCREEN = 1;
const PAN_DIST = 0.6, PAN_FOV = 48;
// The camera's way there from the eyepiece (252 deg), in the drum's polar terms (deg clockwise from the door, model -Z;
// radius; height, the floor at 0.28): up off the eyepiece over the viewer's head, round the back of the pier between it
// and the console (215 deg) at ~2.3 m, above the console and wide of the mount (the pier, its gear ring, the azimuth
// motor and the tube's rear reach out at most 1.25 m up to 3.4 m, however the dome and the tube are turned), then
// (desk.via) down over the chair onto the screen. Checked against the model, the dome and tube in every pose: from an
// eyepiece stance, 0.33 m or more from anything after the first moment until the chair, whose back passes 0.25 m
// behind the camera at the end; nothing in view comes nearer than 0.27 m (the near plane's corners are at 0.2 m).
const PAN_ROUTE = [[236, 1.95, 2.3], [196, 1.6, 2.28], [150, 1.95, 2.18]];

// A CRT face's frame in the model, fitted to its vertices by their UVs (render/crt.js: mode + u, id + v; the face spans
// 0.02..0.98 of them): its centre, the axes the UVs run along (right, up), the normal out of it and its size (m).
function faceFrame(geos, mode, id) {
  const pts = [], uvs = [];
  for (const g of geos) {
    const p = g.attributes.position, uv = g.attributes.uv;
    if (!uv) continue;
    for (let i = 0; i < p.count; i++) {
      const u = uv.getX(i), v = 1 - uv.getY(i);   // (glTF's flip undone, as UV_VERT does)
      if (Math.floor(u) !== mode || Math.floor(v) !== id) continue;
      pts.push(new THREE.Vector3().fromBufferAttribute(p, i));
      uvs.push([u - mode, v - id]);
    }
  }
  if (pts.length < 3) return null;
  // Least squares: p - mean = gu (u - mean u) + gv (v - mean v).
  const n = pts.length, c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(n);
  const mu = uvs.reduce((s, q) => s + q[0], 0) / n, mv = uvs.reduce((s, q) => s + q[1], 0) / n;
  let suu = 0, suv = 0, svv = 0;
  const bu = new THREE.Vector3(), bv = new THREE.Vector3(), d = new THREE.Vector3();
  pts.forEach((p, i) => {
    const du = uvs[i][0] - mu, dv = uvs[i][1] - mv;
    suu += du * du; suv += du * dv; svv += dv * dv;
    d.subVectors(p, c);
    bu.addScaledVector(d, du); bv.addScaledVector(d, dv);
  });
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const gu = bu.clone().multiplyScalar(svv / det).addScaledVector(bv, -suv / det);
  const gv = bv.clone().multiplyScalar(suu / det).addScaledVector(bu, -suv / det);
  return {
    center: c.clone().addScaledVector(gu, 0.5 - mu).addScaledVector(gv, 0.5 - mv),
    right: gu.clone().normalize(), up: gv.clone().normalize(), normal: new THREE.Vector3().crossVectors(gu, gv).normalize(),
    size: { w: gu.length() * 0.96, h: gv.length() * 0.96 },
  };
}

// Indicator lamps: id and behaviour (0 random, 1 steady, 2 slow beacon, 3 fast chatter) packed in the UVs.
const LAMP_FRAG = /* glsl */ `
float lampOn(vec2 u) {
  float id = floor(u.x), kind = floor(u.y);
  float t = uObsTime;
  if (kind < 0.5) { float period = 0.4 + oh1(id) * 2.6; return step(0.45, oh(vec2(id, floor(t / period + oh1(id + 5.0))))); }
  if (kind < 1.5) return 0.92 + 0.08 * sin(t * 3.0 + id);
  if (kind < 2.5) return pow(0.5 + 0.5 * sin(t * 2.2), 6.0);
  return step(0.5, oh(vec2(id, floor(t * 11.0 + oh1(id) * 3.0))));
}
`;

// Tape reels: an aluminium flange with three windows, spun in the shader; speed wanders and reverses.
const REEL_FRAG = /* glsl */ `
float reelAlpha(vec2 u, out float shade) {
  float id = floor(u.x), right = floor(u.y);
  vec2 q = fract(u) - 0.5;
  float drive = floor(id / 2.0);
  float t = uObsTime;
  float ang = 3.2 * sin(t * 0.21 + drive * 1.9) * 6.0 + 2.4 * sin(t * 0.47 + drive) * 4.0 + t * (1.2 + drive * 0.3) * (right > 0.5 ? 1.1 : 1.0);
  float c = cos(ang), s = sin(ang);
  q = mat2(c, -s, s, c) * q;
  float r = length(q) * 2.0;
  float a = atan(q.y, q.x + 1e-6);
  float sector = fract(a / 2.0943951);
  float window = step(0.3, r) * step(r, 0.84) * step(0.12, sector) * step(sector, 0.6);
  float hubHole = step(r, 0.06);
  shade = 0.85 + 0.15 * sin(r * 60.0) - 0.25 * step(r, 0.16) + 0.1 * step(0.9, r);
  return (1.0 - window) * (1.0 - hubHole) * step(r, 1.0);
}
`;

export function placeObservatory(ctx, asset, { center, doorAngle, collider }) {
  const { gltf, ao, print } = asset;
  const src = gltf.scene;
  src.updateMatrixWorld(true);

  // ---- placement: model -Z (the door) faces the path's arrival angle ----
  const root = new THREE.Group();
  root.position.copy(center);
  root.rotation.y = Math.atan2(-Math.cos(doorAngle), -Math.sin(doorAngle));
  ctx.surface.add(root);
  root.updateMatrixWorld(true);

  // ---- parts ----
  const rig = createRig();
  const { parts, partOf, nodes } = collectParts(src, rig, 'observatory');

  // ---- geometry: bake node transforms, tag parts, merge by game material ----
  const groups = {};
  const colliderM = new THREE.Matrix4();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material?.name || '').replace(/^obs_/, '');
    if (o.name === 'COLLIDER' || name === 'collider') {
      collider.addGeometry(o.geometry, colliderM.multiplyMatrices(root.matrixWorld, o.matrixWorld));
      return;
    }
    const part = partIndex(o, partOf);
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    const [key, packed, tint] = MERGE[name] || [name, null];
    if (packed !== null) {
      const col = g.attributes.color;
      const c = new THREE.Color(tint ?? 0xffffff);   // linear
      for (let i = 0; i < n; i++) col.setXYZW(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b, packed);
    }
    const layer = o.userData.layer || 'shell';
    (groups[key + '@' + layer] ||= []).push(g);
  });

  // ---- materials ----
  const oak = Textures.oakPlanks(), grain = Textures.woodGrain(), lime = Textures.limewash();
  const ledge = Textures.ledgestone(), panels = Textures.domePanels(), tread = Textures.treadPlate();
  const brushed = Textures.brushed();
  for (const t of [ledge.map, ledge.normal]) t.repeat.set(0.5, 0.5);
  const v2 = (s) => new THREE.Vector2(s, s);
  const timeU = { value: 0 }, kU = { value: 1 };
  const std = (o, extra) => rigged(patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.8, ...o })), rig, extra);
  const withObsUniforms = (fn) => (sh) => { sh.uniforms.uObsTime = timeU; sh.uniforms.uObsK = kU; fn(sh); };
  // The desk terminal's coordinates readout (see desk, below): drawn once now, shown by the screens' own program, its
  // canvas shaped like that screen's face so the glyphs aren't stretched.
  const deskFace = faceFrame(Object.entries(groups).filter(([k]) => k.startsWith('screen@')).flatMap(([, g]) => g), 0, DESK_SCREEN);
  const msg = createCrtMessage(COORDS_LINES, deskFace ? { aspect: deskFace.size.w / deskFace.size.h } : {});
  const M = {
    metal: std({ map: brushed.map, roughness: 1, metalness: 1, name: 'metal' }, (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vColor.a;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.55, 0.3, vColor.a);');
    }),
    plain: std({ map: lime.map, roughness: 1, metalness: 0, name: 'plain' }, (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vColor.a;');
    }),
    dome: std({ map: panels.map, normalMap: panels.normal, normalScale: v2(0.9), roughness: 0.5, metalness: 0.2 }),
    tube: std({ map: panels.map, normalMap: panels.normal, normalScale: v2(0.6), roughness: 0.32, metalness: 0.3, envMapIntensity: 1.1 }),
    steel: null,
    plate: std({ map: tread.map, normalMap: tread.normal, normalScale: v2(1.0), roughness: 0.42, metalness: 0.75 }),
    stone: std({ map: ledge.map, normalMap: ledge.normal, normalScale: v2(1.1), roughness: 0.9 }),
    plaster: std({ map: lime.map, normalMap: lime.normal, normalScale: v2(0.6), roughness: 0.93 }),
    wood_floor: std({ map: oak.map, normalMap: oak.normal, normalScale: v2(0.55), roughness: 0.6 }),
    wood: std({ map: grain.map, normalMap: grain.normal, normalScale: v2(0.4), roughness: 0.6 }),
    poster: std({ map: Textures.obsAtlas(), roughness: 0.85, vertexColors: false }),
    glass: rigged(patchMaterial(new THREE.MeshPhysicalMaterial({
      color: 0xdfeaf0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 1.4,
      side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true,
    })), rig),
    emissive: rigged(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 1.3) }), rig),
    screen: rigged(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'screen' }), rig, withObsUniforms((sh) => {
      Object.assign(sh.uniforms, msg.uniforms);
      UV_VERT(sh, msg.frag + SCREEN_FRAG);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = crt(vObsUv, vColor.rgb) * uObsK;');
    })),
    lamps: rigged(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'lamps' }), rig, withObsUniforms((sh) => {
      UV_VERT(sh, LAMP_FRAG);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vColor.rgb * mix(0.05, 2.4, lampOn(vObsUv)) * uObsK;');
    })),
    reels: std({ roughness: 0.35, metalness: 0.8, name: 'reels', side: THREE.DoubleSide }, withObsUniforms((sh) => {
      UV_VERT(sh, REEL_FRAG);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n{ float sh_; if (reelAlpha(vObsUv, sh_) < 0.5) discard; diffuseColor.rgb *= sh_; }');
    })),
  };
  const depth = rigged(new THREE.MeshDepthMaterial(), rig);
  const shell = [];

  for (const [group, geos] of Object.entries(groups)) {
    const [key, layer] = group.split('@');
    const mat = M[key];
    if (!mat) { console.warn('observatory: no material for', key); continue; }
    // Meshes left out of the AO bake (no second UVs) in a group with baked ones: point them at the atlas's white patch.
    if (geos.some((g) => g.attributes.uv1)) {
      for (const g of geos) {
        if (g.attributes.uv1) continue;
        const n = g.attributes.position.count, uv = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { uv[i * 2] = WHITE_UV[0]; uv[i * 2 + 1] = WHITE_UV[1]; }
        g.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
      }
    }
    const geo = mergeGeometries(geos, false);
    if (!geo) { console.warn('observatory: could not merge', key); continue; }
    // One sphere around the whole building: the tube and dome move far from their rest pose.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3.5, 0), 9.5);
    if (geo.attributes.uv1 && mat.isMeshStandardMaterial) { mat.aoMap = ao; mat.aoMapIntensity = 1; }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !NO_SHADOW.has(key);
    mesh.receiveShadow = key !== 'emissive' && key !== 'lamps' && key !== 'screen';
    mesh.customDepthMaterial = depth;
    if (key === 'glass') mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    // Its world matrix now (a static mesh never flags itself for update): the LOD bounds below read it, and
    // without this they sat at the model origin, so the interior and the 'near' details were always culled.
    mesh.updateMatrixWorld(true);
    if (LAYER_OUT[layer]) ctx.lod.add(mesh, { out: LAYER_OUT[layer], name: 'observatory@' + layer });
    else if (mergeable(mesh)) shell.push(mesh);
  }
  // From other stacks: the drum and dome as one merged, AO-shaded stand-in (rigged, so the dome still turns).
  const far = rigged(patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.7, name: 'obs_far' })), rig);
  const farMesh = ctx.lod.addFarProxy(shell, { parent: root, band: FAR_BAND, material: far, name: 'observatory', keep: ['aPart'], aoTexture: ao });
  farMesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3.5, 0), 9.5);

  // ---- the desk terminal that reads out the coordinates (sequences/coordsPan.js), in the world: its face (fitted to
  // the model's screen), the cinematic's waypoints and last place, and its readout (the message on the screen, or null
  // for its stock scrolling text). null if the model has no such screen (then there is no cinematic).
  const desk = (() => {
    const f = deskFace;
    if (!f) return null;
    const screen = root.localToWorld(f.center.clone());
    const normal = f.normal.clone().transformDirection(root.matrixWorld);
    const at = (d, h) => screen.clone().addScaledVector(normal, d).setY(screen.y + h);
    const D = THREE.MathUtils.DEG2RAD;
    const drum = ([a, r, y]) => root.localToWorld(new THREE.Vector3(Math.sin(a * D) * r, y, -Math.cos(a * D) * r));
    return {
      screen, normal, size: f.size, fov: PAN_FOV,
      end: at(PAN_DIST, 0),
      // Round the pier, then over the chair (its back stands ~0.3 m behind the last place, a little under the screen's
      // centre): just clear of it, so the last drop onto the screen's normal (and the tilt up to square-on that goes
      // with it, the view being on the screen) is short and gentle.
      via: [...PAN_ROUTE.map(drum), at(PAN_DIST + 0.8, 0.6), at(PAN_DIST + 0.35, 0.3)],
      text: (rows, cursor = null, lit = 1) => {
        if (!rows) { msg.hide(); return; }
        msg.show(DESK_SCREEN);
        msg.set(rows, cursor, lit);
      },
    };
  })();

  // ---- interior lighting (shared light pool) and the interior mask ----
  const meta = nodes.META?.userData || {};
  const wp = (name) => nodes[name] ? root.localToWorld(nodes[name].getWorldPosition(new THREE.Vector3())) : null;
  atmo.uObsA.value.set(center.x, center.z, meta.rIn ?? 5.15, center.y + (meta.floorY ?? 0.28));
  atmo.uObsB.value.set(center.y + (meta.wallTop ?? 3.75), center.y + (meta.domeC ?? 3.9), meta.domeR ?? 5.8, 1);
  let k = 1;
  const lights = [];
  for (const [name, node] of Object.entries(nodes)) {
    if (!name.startsWith('LIGHT_')) continue;
    const ud = node.userData, power = ud.power || 4;
    const flick = name === 'LIGHT_racks';
    lights.push({
      pos: wp(name), color: new THREE.Color(...(ud.color || [1, 0.8, 0.55])), distance: ud.distance || 6,
      intensity: () => power * 1.15 * k * (flick ? 0.95 + 0.05 * Math.sin(timeU.value * 31) : 1),
    });
  }
  ctx.lightPool.add({ center: center.clone().setY(center.y + 2), radius: 12, lights });
  for (const n of ['SOUND_electronics', 'SOUND_desk']) if (nodes[n]) ctx.audio?.registerEmitter?.('electronics', wp(n), 'surface');

  // ---- state, drivers, controls ----
  // coords: the constellation has been read (the one place it is kept: core/save.js, rocks.exe's gate and the desk's
  // readout all go by it).
  const st = ctx.state.observatory = { yaw: doorAngle + Math.PI * 0.2, pitch: 0.22, hatch: 0, coords: false };
  const pivotY = meta.pivotY ?? 4.3, tubeFront = meta.tubeFront ?? 4.4;
  // Dome angle (about local +Y) that points the slit (local -Z) at world angle yaw; tracked continuously.
  const slitAngle = (yaw) => Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) - root.rotation.y;
  const yaw0 = st.yaw, psi0 = slitAngle(st.yaw);
  const domeAngle = (yaw) => psi0 - (yaw - yaw0);
  let wind = 0, shut = 1, doorS = 0;   // doorS: the front door, 0 shut (as built) .. 1 swung open against the wall   // shut: the rear hatch's panel (built open in Blender, so 1 swings it shut)
  const drawerOpen = {};   // 'drawer<i>': 0 shut .. 1 out (see the filing cabinets below)
  const apply = () => {
    const val = { yaw: domeAngle(st.yaw), pitch: st.pitch, wind, hatch: shut, door: doorS };
    for (let i = 1; i < parts.length; i++) {
      const P = parts[i], v = (val[P.driver] ?? drawerOpen[P.driver] ?? 0) * P.ratio;
      if (P.slide) rig.uRigT.value[i].set(P.slide.x * v, P.slide.y * v, P.slide.z * v, 0);
      else rig.uRigP.value[i].w = v;
    }
  };
  apply();

  let yawVel = 0, pitchVel = 0, tick = 0, rumble = null;
  const pier = root.localToWorld(new THREE.Vector3(0, 2.5, 0));
  const turn = (dy, dp) => {
    st.yaw += dy;
    const before = st.pitch;
    st.pitch = clamp(st.pitch + dp, 0.04, 1.15);
    dp = st.pitch - before;
    yawVel = Math.abs(dy); pitchVel = Math.abs(dp);
    tick += Math.abs(dy) * 6 + Math.abs(dp) * 16;
    if (tick > 0.35) { tick = 0; ctx.audio?.play('gearTick', { pos: consoleSound }); }
    apply();
  };

  // Invisible pick proxies: the merged meshes can't tell a handwheel from a wall.
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxy = (geo, pos, axis) => {
    const m = new THREE.Mesh(geo, proxyMat);
    m.position.copy(pos);
    if (axis) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    root.add(m);
    m.updateMatrixWorld(true);
    return m;
  };
  const wheelProxy = (name) => {
    const p = parts.find((q) => q && q.name === name);
    return proxy(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 16), p.pivot.clone().addScaledVector(p.axis, 0.34).add(new THREE.Vector3(0, 0.12, 0)), p.axis);
  };
  const azProxy = wheelProxy('AzWheel'), altProxy = wheelProxy('AltWheel');
  const consoleSound = root.localToWorld(parts.find((q) => q && q.name === 'AzWheel').pivot.clone().lerp(parts.find((q) => q && q.name === 'AltWheel').pivot, 0.5));
  const viewerProxy = proxy(new THREE.BoxGeometry(0.42, 0.42, 0.5), nodes.Viewer.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.6, 0)));
  const player = () => ctx.player;
  const controls = {};
  // Mouse counts (one frame's worth) to gear travel: slow movements turn the wheels finely, a quick sweep turns
  // them at full rate. At the handwheels a count turns the dome 0.023 deg slowly, up to 0.09 deg in a sweep (the tube
  // 0.017 to 0.07 deg); at the eyepiece, whose view is only 3.2 deg wide, a tenth of that.
  const gearing = (m, full) => m * full * (0.25 + 0.75 * Math.min(1, Math.abs(m) / 16));
  controls.az = ctx.interact.add({
    name: 'observatory:az-wheel', meshes: [azProxy], range: 2.4,
    onPress: () => { player().lookHandler = (mx) => turn(-gearing(mx, 0.0016), 0); },
    onRelease: () => { player().lookHandler = null; },
  });
  controls.alt = ctx.interact.add({
    name: 'observatory:alt-wheel', meshes: [altProxy], range: 2.4,
    onPress: () => { player().lookHandler = (mx, my) => turn(0, -gearing(my, 0.0012)); },
    onRelease: () => { player().lookHandler = null; },
  });

  // ---- looking through the telescope: the view follows the tube; the tube only moves by the gears ----
  let viewing = false;
  const cam = ctx.camera;
  const baseFov = cam.fov;
  const pivotW = root.localToWorld(new THREE.Vector3(0, pivotY, 0));
  const scopeView = () => {
    const dir = new THREE.Vector3(Math.cos(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.sin(st.yaw) * Math.cos(st.pitch));
    cam.position.copy(pivotW).addScaledVector(dir, tubeFront + 0.3);
    // The optics look a little below the tube axis so the cliffs of distant stacks can be reached.
    const vp = st.pitch - VIEW_DROP;
    const view = new THREE.Vector3(Math.cos(st.yaw) * Math.cos(vp), Math.sin(vp), Math.sin(st.yaw) * Math.cos(vp));
    cam.up.set(0, 1, 0);
    cam.lookAt(cam.position.clone().add(view));
    ctx.fx.scopeAz = st.yaw;
    ctx.fx.scopeAlt = st.pitch;
  };
  const exitButton = typeof document !== 'undefined' && document.head && document.body ? createScopeExit(() => exitView()) : null;
  const exitView = () => {
    if (!viewing) return;
    viewing = false;
    exitButton?.show(false);
    ctx.fx.scope = 0;
    ctx.scopeFogMul = 1;
    cam.fov = baseFov; cam.updateProjectionMatrix();
    player().cameraControlled = true;
    player().lookHandler = null;
    player().canMove = true;
    // The view back at the eye at once (left from the updater, this frame would be drawn from the tube's mouth).
    player().updateCamera?.(0);
    ctx.audio?.play('click', {});
    // The coordinates just read: the desk's readout plays from here next frame (startPan). Until then the player is
    // held where they stand, so a teleport (Travel) is told from a step.
    if (panPending) {
      panFrom = player().feet.clone();
      player().canMove = false;
      player().lookHandler = HOLD;
    }
  };
  // The coordinates: the telescope held on SKY_TARGET (tested as the rear hatch tests its aim) while the constellation
  // shows (render/constellation.js: dusk and night). Set once; the readout waits for the player to leave the eyepiece.
  let coordsDwell = 0, panPending = false, panFrom = null, pan = null;
  const HOLD = () => {};
  const watchSky = (dt) => {
    if (st.coords) return;
    const across = Math.abs(Math.atan2(Math.sin(st.yaw - SKY_TARGET.yaw), Math.cos(st.yaw - SKY_TARGET.yaw))) * Math.cos(SKY_TARGET.pitch - VIEW_DROP);
    const up = Math.abs(st.pitch - SKY_TARGET.pitch);
    const C = ctx.constellation, shows = !!C?.points.visible && C.points.material.uniforms.uVis.value > 0.5;
    coordsDwell = across < COORDS_TOL && up < COORDS_TOL && shows ? coordsDwell + dt : 0;
    if (coordsDwell < COORDS_DWELL) return;
    st.coords = true;
    panPending = !!desk;
    ctx.audio?.play('coordsBeep', { pos: desk?.screen ?? pier, kind: 'tick' });   // across the room, the desk stirs
  };
  // The frame after leaving the eyepiece with the coordinates read: the cinematic, unless the player has gone (Travel)
  // or is back at the eyepiece (then it waits for the next time they leave).
  const startPan = () => {
    const p = player(), from = panFrom;
    panFrom = null;
    if (p.lookHandler === HOLD) { p.lookHandler = null; p.canMove = true; }
    if (viewing) return;
    panPending = false;
    if (p.feet.distanceTo(from) > 0.3) return;   // (the readout simply shows: see readout)
    const seq = createCoordsPan(ctx, { desk });
    if (ctx.startSequence?.(seq)) pan = seq;
  };
  // The desk's readout: the cinematic drives it while it runs; otherwise it shows once the coordinates are in (at once
  // from a restored save) and the cinematic isn't still to come.
  const readout = () => {
    if (pan && !pan.done) return;
    pan = null;
    if (desk && st.coords && !panPending) { const r = coordsFinal(timeU.value); desk.text(r.rows, r.cursor, r.lit); }
    else if (msg.shown) msg.hide();
  };
  controls.viewer = ctx.interact.add({
    name: 'observatory:eyepiece', meshes: [viewerProxy], range: 2.3,
    onPress: () => {
      if (viewing) return exitView();
      viewing = true;
      exitButton?.show(true);
      ctx.fx.scope = 1;
      ctx.scopeFogMul = 0.3;   // good optics cut through the haze
      cam.fov = 3.2; cam.updateProjectionMatrix();
      player().cameraControlled = false;
      player().canMove = false;
      // At the eyepiece the handwheels are within reach: the mouse turns them, finely, and the view goes the way
      // the mouse does (right turns the dome right, up raises the tube).
      player().lookHandler = (mx, my) => { if (mx || my) turn(gearing(mx, 0.00016), -gearing(my, 0.00012)); };
      ctx.audio?.play('click', {});
    },
  });
  ctx.exitScope = exitView;

  // ---- the bench at the summit's edge: press it to sit (like the deck chairs, props/deck.js), looking out over the
  // clouds toward the Dome and Rocks stacks; press again, or walk, to stand up in front of it.
  if (nodes.BENCH && nodes.BENCH_SEAT && nodes.BENCH_STAND) {
    root.updateMatrixWorld(true);
    // (The empties hold positions in the observatory's frame; they aren't in the scene.)
    const eye = root.localToWorld(nodes.BENCH_SEAT.position.clone()), stand = root.localToWorld(nodes.BENCH_STAND.position.clone());
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.55), new THREE.MeshBasicMaterial({ visible: false }));
    hit.name = 'observatory:bench';
    hit.position.copy(nodes.BENCH.position).setY(nodes.BENCH.position.y + 0.4);
    hit.rotation.y = nodes.BENCH.userData.ry ?? 0;
    root.add(hit);
    hit.updateMatrixWorld(true);
    const seat = {
      name: 'observatory:bench', eye, stand,
      yaw: Math.atan2(-(stand.x - eye.x), -(stand.z - eye.z)),   // looking out over the front of the bench
      yawRange: THREE.MathUtils.degToRad(100), pitchMin: THREE.MathUtils.degToRad(-40), pitchMax: THREE.MathUtils.degToRad(35),
      onSit: () => ctx.audio?.play('step', { surface: 'wood', pos: eye }),
      onStand: () => ctx.audio?.play('step', { surface: 'grass', pos: stand }),
    };
    ctx.interact.add({ name: seat.name, meshes: [hit], range: 2.6, exact: true, zone: 'surface', onPress: () => ctx.player?.sit(seat) });
  }

  // ---- the rear hatch (a puzzle): a riveted square cut at chest height in the back of the drum. When the dome and the
  // telescope both point at the top of the Rocks tor, the curved panel behind it swings aside and shows a yellow
  // plate with three screws; aim elsewhere and it swings back. ----
  const hatchPart = parts.find((q) => q && q.driver === 'hatch');
  const hatchPos = hatchPart ? root.localToWorld(hatchPart.pivot.clone()) : pier;
  let aim = null, goal = 0, scrape = null;
  // Yaw and pitch that put the tor top on the eyepiece's crosshair. The eyepiece rides 4.7 m out along the tube,
  // so solve by fixed-point iteration (it settles in a few steps at 600 m).
  const target = () => {
    const top = ctx.stacks.rocks?.torTop;
    if (aim || !top) return aim;
    const eye = new THREE.Vector3(), d = new THREE.Vector3();
    let yaw = 0, pitch = 0;
    for (let i = 0; i < 8; i++) {
      eye.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(tubeFront + 0.3).add(pivotW);
      d.subVectors(top, eye);
      yaw = Math.atan2(d.z, d.x);
      pitch = Math.asin(d.y / d.length()) + VIEW_DROP;
    }
    return (aim = { yaw, pitch });
  };
  const updateHatch = (dt) => {
    if (!hatchPart || !target()) return;
    // How far (rad) the tor top sits off the crosshair, across (yaw wraps; narrower when looking up or down) and up.
    const across = Math.abs(Math.atan2(Math.sin(st.yaw - aim.yaw), Math.cos(st.yaw - aim.yaw))) * Math.cos(aim.pitch - VIEW_DROP);
    const up = Math.abs(st.pitch - aim.pitch);
    const tol = HATCH_TOL * (goal ? 1.2 : 1);   // a little hysteresis, so it can't chatter on the edge
    goal = across < tol && up < tol ? 1 : 0;
    if (st.hatch === goal) return;
    scrape ||= ctx.audio?.loop('scrape', { pos: hatchPos }) ?? null;
    st.hatch = goal ? Math.min(1, st.hatch + dt / HATCH_TIME) : Math.max(0, st.hatch - dt / HATCH_TIME);
    shut = 1 - st.hatch * st.hatch * (3 - 2 * st.hatch);
    if (st.hatch === goal) {
      scrape?.stop(); scrape = null;
      ctx.audio?.play('switch', { pos: hatchPos, rate: 0.5 });   // the panel clunks home
    }
  };
  // Console helper (screenshots): aim the dome and the telescope at the tor top; the panel follows in 1.5 s.
  const hatch = {
    target, tolerance: HATCH_TOL,
    align: () => {
      if (!target()) return null;
      st.yaw += Math.atan2(Math.sin(aim.yaw - st.yaw), Math.cos(aim.yaw - st.yaw));   // the short way round
      st.pitch = aim.pitch;
      return aim;
    },
    // Put the panel at `v` (0 shut .. 1 open) at once (restoring a saved game, core/save.js).
    set: (v) => {
      st.hatch = clamp(v, 0, 1);
      shut = 1 - st.hatch * st.hatch * (3 - 2 * st.hatch);
      apply();
    },
  };

  // ---- the front door: shut until you open it. A click (on the leaf, wherever it stands) swings it out against the
  // wall, or back shut; while it is mostly shut it blocks the doorway. ----
  const doorPart = parts.find((q) => q && q.driver === 'door');
  let doorOpen = 0, doorGoal = 0, updateDoor = () => {};
  if (doorPart) {
    const hinge = doorPart.pivot, fl = meta.floorY ?? 0.28;
    // A click target that turns with the leaf: the rig's rotation about +Y at the hinge, from the leaf built shut
    // along -X (see the design's DOOR_OPEN).
    const swing = new THREE.Group();
    swing.position.copy(hinge);
    root.add(swing);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.14), new THREE.MeshBasicMaterial({ visible: false }));
    leaf.position.set(-0.7, fl + 1.13, 0);
    swing.add(leaf);
    const wc = root.localToWorld(new THREE.Vector3(hinge.x - 0.7, 0, hinge.z));
    const blocker = ctx.physics.addOBB({ x: wc.x, z: wc.z, hx: 0.75, hz: 0.1, ry: root.rotation.y, y0: center.y - 0.5, y1: center.y + 3, zone: 'surface' });
    const soundPos = root.localToWorld(new THREE.Vector3(hinge.x - 0.7, fl + 1.2, hinge.z));
    ctx.interact.add({
      name: 'observatory:door', meshes: [leaf], range: 2.7,
      onPress: () => { doorGoal = doorGoal ? 0 : 1; ctx.audio?.play(doorGoal ? 'hingeOpen' : 'hingeClose', { pos: soundPos }); },
    });
    updateDoor = (dt) => {
      if (doorOpen === doorGoal) return;
      doorOpen = doorGoal > doorOpen ? Math.min(1, doorOpen + dt / 1.4) : Math.max(0, doorOpen - dt / 1.4);
      doorS = doorOpen * doorOpen * (3 - 2 * doorOpen);
      swing.rotation.y = doorS * doorPart.ratio;
      swing.updateMatrixWorld(true);
      blocker.enabled = doorOpen < 0.3;
    };
  }

  // ---- service ladders up the back and the roof station (props/observatoryStation.js): they meet, and the station
  // can be stood on, only while the telescope points at the Dome stack. ----
  const station = createStation(ctx, { root, nodes, st, doorAngle, domeAngle, center });

  // ---- the filing cabinets: press a drawer to slide it out on its runners, again to push it shut (parts
  // 'Drawer<i>', driven by drawerOpen). One holds a print (PAPER): press it to hold it up to the light, again to put
  // it back. ----
  const drawerHit = new THREE.BoxGeometry(0.44, 0.3, 0.06), drawers = [];
  for (let i = 0; nodes['DRAWER_' + i]; i++) {
    const n = nodes['DRAWER_' + i], u = n.userData;
    const at = n.position.clone(), out = new THREE.Vector3(...(u.slide ?? [0, 0, 1])).normalize();
    const hit = proxy(drawerHit, at);
    hit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
    const d = { i, at, out, travel: u.travel ?? 0.42, hit, x: 0, target: 0 };
    drawers.push(d);
    ctx.interact.add({
      name: 'observatory:drawer:' + i, meshes: [hit], range: 2.2, exact: true,
      onPress: () => {
        if (paper && paper.drawer === i && paper.mode !== 'rest') return;   // (the print is out: put it back first)
        d.target = d.target > 0.5 ? 0 : 1;
        ctx.audio?.play('drawer', { pos: root.localToWorld(d.at.clone()), open: d.target > 0.5, dur: DRAWER_TIME * Math.abs(d.target - d.x) });
      },
    });
  }
  // The print: the photo on its face, plain paper behind, lying across the folders at PAPER. Press it (with its drawer
  // out) to hold it up close, lit a little, and again to put it back (props/inspect.js); it rides in and out with its
  // drawer.
  let paper = null;
  if (nodes.PAPER && print) {
    const u = nodes.PAPER.userData, size = u.size ?? 0.21;
    const group = new THREE.Group();
    group.name = 'observatory-print';
    const front = new THREE.Mesh(new THREE.PlaneGeometry(size, size), patchMaterial(new THREE.MeshStandardMaterial({
      map: print, roughness: 0.82, emissive: 0xffffff, emissiveMap: print, emissiveIntensity: 0, name: 'observatory-print',
    })));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(size, size), patchMaterial(new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9, name: 'observatory-print-back' })));
    back.rotation.y = Math.PI;
    back.position.z = -0.0006;
    group.add(front, back);
    // Lying on its back: the face up, turned ry, tipped a little along its length.
    const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (u.tilt ?? 0), u.ry ?? 0, 0, 'YXZ'));
    const restP = nodes.PAPER.position.clone();
    group.position.copy(restP);
    group.quaternion.copy(restQ);
    front.castShadow = back.castShadow = false;
    root.add(group);
    const drawer = u.drawer ?? 0;
    const inspect = makeInspectable(ctx, {
      object: group, parent: root, meshes: [front, back], name: 'observatory:print', glow: { material: front.material, amount: 0.22 },
      canLift: () => !drawers[drawer] || drawers[drawer].x >= 0.9,   // only when its drawer is out
      rest: (outP, outQ) => {
        const d = drawers[drawer];
        outP.copy(restP);
        if (d) outP.addScaledVector(d.out, (drawerOpen['drawer' + d.i] ?? 0) * d.travel);   // riding in its drawer
        outQ.copy(restQ);
      },
    });
    paper = { group, front, drawer, restP, restQ, inspect, get mode() { return inspect.mode(); } };
  }
  ctx.updaters.push((dt) => {
    for (const d of drawers) {
      if (d.x !== d.target) d.x = d.target > d.x ? Math.min(d.target, d.x + dt / DRAWER_TIME) : Math.max(d.target, d.x - dt / DRAWER_TIME);
      const e = d.x * d.x * (3 - 2 * d.x);                   // eased: a pull, a glide, a soft stop
      drawerOpen['drawer' + d.i] = e;
      d.hit.position.copy(d.at).addScaledVector(d.out, e * d.travel);
      d.hit.updateMatrixWorld(true);
    }
    paper?.inspect.update(dt);
  });

  ctx.updaters.push((dt) => {
    timeU.value = atmo.uTime.value;
    k = (1 + atmo.uNight.value * 0.3) / Math.max(0.5, atmoState.exposure);
    kU.value = 1.25 * k;
    M.emissive.color.setRGB(3.2 * k, 2.3 * k, 1.3 * k);
    wind += dt * (2.5 + 1.5 * Math.sin(timeU.value * 0.07) + Math.sin(timeU.value * 0.31));
    updateHatch(dt);
    updateDoor(dt);
    apply();
    station?.update(dt);
    if (panFrom) startPan();
    if (viewing) {
      scopeView();
      watchSky(dt);
      const a = ctx.input.axis();
      if (a.x || a.y || ctx.input.keys.has('Escape')) exitView();
    }
    readout();
    const moving = yawVel + pitchVel > 1e-5;
    if (moving && !rumble) rumble = ctx.audio?.loop('domeRumble', { pos: pier });
    if (!moving && rumble) { rumble.stop(); rumble = null; }
    yawVel = 0; pitchVel = 0;
  });

  // Console helpers (screenshots, the dev tour): aim at the constellation as hatch.align does the tor top; replay the
  // desk's cinematic from where the player stands (in the observatory).
  const sky = {
    target: SKY_TARGET, tolerance: COORDS_TOL,
    align: () => {
      st.yaw += Math.atan2(Math.sin(SKY_TARGET.yaw - st.yaw), Math.cos(SKY_TARGET.yaw - st.yaw));
      st.pitch = SKY_TARGET.pitch;
      apply();
      return SKY_TARGET;
    },
  };
  if (desk) {
    desk.play = () => {
      if (viewing || (pan && !pan.done)) return false;   // (at the eyepiece its updater would keep the camera)
      const seq = createCoordsPan(ctx, { desk });
      if (!ctx.startSequence?.(seq)) return false;
      pan = seq;
      return true;
    };
  }

  return {
    root, st, parts, controls, viewing: () => viewing, hatch, drawers, print: paper, ladder: station?.ladder, station: station?.station, finish: () => station?.finish(),
    coordsSeen: () => !!st.coords, sky, desk, coordsPan: () => pan,
  };
}
