import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchMaterial } from '../render/materials.js';
import { Textures } from '../render/textures.js';
import { atmo, atmoState } from '../render/atmosphere.js';
import { FAR_BAND, farMaterial, mergeable } from '../render/lod.js';
import { paintingTextures, landscapeTextures } from '../render/painting.js';
import { createFire } from '../render/fire.js';

// Layers from the Blender build (see dbkit.layer): the rooms fade out once you leave the Dome stack, the garden
// and porch life a little further out. The shell (dome, house, roof) is always drawn.
const LAYER_OUT = { in: [55, 75], near: [110, 140] };

// The cabin + geodesic dome are modeled in Blender (tools/blender/build_cabin.py) and exported as one GLB:
// one mesh per material, colors in vertex attributes, an ambient-occlusion atlas on UV set 1, and empties
// that mark doors, lights, wake-up positions and sound sources.

// The room probe only renders objects on this layer (the cabin, the dome terrain, the sky and every light:
// all lights must be on it so both renders share shader programs).
export const PROBE_LAYER = 1;

// Materials whose meshes carry the baked AO atlas (must match BAKE_MATS in the Blender script).
const BAKED = new Set(['wood_floor', 'plaster', 'wood', 'stone', 'metal_black', 'zellige', 'hex_tile', 'rug', 'jute', 'marble', 'painted']);
// Flat or see-through surfaces that would only add sun-shadow draw calls.
const NO_SHADOW = new Set(['glass', 'dome_glass', 'emissive', 'embers', 'wood_floor', 'rug', 'jute', 'hex_tile', 'zellige', 'mirror', 'shade', 'flagstone']);

export async function loadCabin() {
  const loader = new GLTFLoader();
  const [gltf, ao] = await Promise.all([
    loader.loadAsync(import.meta.env.BASE_URL + 'models/cabin.glb'),
    new THREE.TextureLoader().loadAsync(import.meta.env.BASE_URL + 'models/cabin_ao.png'),
  ]);
  ao.flipY = false;               // glTF UV convention
  ao.channel = 1;                 // second UV set (TEXCOORD_1)
  ao.colorSpace = THREE.NoColorSpace;
  // An atlas of many small charts: mipmapping would bleed neighbouring charts together at a distance.
  ao.generateMipmaps = false;
  ao.minFilter = THREE.LinearFilter;
  return { gltf, ao };
}

function makeMaterials(ao, probe) {
  const v2 = (s) => new THREE.Vector2(s, s);
  const std = (o) => patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.8, ...o }));
  // Glossy interior surfaces reflect the room (a probe captured in the great room) instead of the open sky.
  const room = (o) => patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, envMap: probe, ...o }), { indoorEnv: true });
  const oak = Textures.oakPlanks(), grain = Textures.woodGrain(), lime = Textures.limewash(), weave = Textures.weave();
  const zell = Textures.zellige(), hex = Textures.hexTile(), jute = Textures.jute(), rock = Textures.rock();
  const ledge = Textures.ledgestone();
  for (const t of [ledge.map, ledge.normal]) t.repeat.set(0.5, 0.5); // one tile covers ~2.4 m
  const glass = (color, opacity) => patchMaterial(new THREE.MeshPhysicalMaterial({
    color, roughness: 0.03, metalness: 0, transparent: true, opacity, envMapIntensity: 1.5,
    side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true, // thin glass: one pass is plenty
  }));
  const M = {
    wood_floor: room({ map: oak.map, normalMap: oak.normal, normalScale: v2(0.55), roughness: 0.46, envMapIntensity: 0.55 }),
    wood: std({ map: grain.map, normalMap: grain.normal, normalScale: v2(0.4), roughness: 0.72 }),
    plaster: std({ map: lime.map, normalMap: lime.normal, normalScale: v2(0.45), roughness: 0.95 }),
    stone: std({ map: ledge.map, normalMap: ledge.normal, normalScale: v2(1.1), roughness: 0.9 }),
    flagstone: std({ map: rock.map, normalMap: rock.normal, normalScale: v2(0.8), roughness: 0.88, color: 0xe4dccf }),
    metal_black: std({ metalness: 0.5, roughness: 0.42 }),
    brass: room({ color: 0xe0b878, metalness: 1, roughness: 0.28, envMapIntensity: 1.0 }),
    leather: room({ roughness: 0.4, envMapIntensity: 0.7 }),
    fabric: std({ map: weave.map, normalMap: weave.normal, normalScale: v2(0.6), roughness: 1, side: THREE.DoubleSide }),
    shade: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: weave.map, roughness: 1, side: THREE.DoubleSide, emissive: 0xffc38a, emissiveIntensity: 0.5 })),
    rug: std({ map: Textures.rug(), roughness: 1 }),
    jute: std({ map: jute.map, normalMap: jute.normal, normalScale: v2(0.8), roughness: 1 }),
    zellige: room({ map: zell.map, normalMap: zell.normal, normalScale: v2(0.8), roughness: 0.1, envMapIntensity: 0.9 }),
    hex_tile: std({ map: hex.map, normalMap: hex.normal, normalScale: v2(0.8), roughness: 0.62 }),
    ceramic: room({ roughness: 0.18, envMapIntensity: 0.85 }),
    marble: room({ map: Textures.marble().map, roughness: 0.16, envMapIntensity: 0.85 }),
    leaf: std({ roughness: 0.6, side: THREE.DoubleSide }),
    painted: std({ roughness: 0.62 }),
    mirror: room({ color: 0xeeeeee, metalness: 1, roughness: 0.0, envMapIntensity: 1.0 }),
    dome_frame: std({ metalness: 0.6, roughness: 0.4 }),
    glass: glass(0xe3f0f2, 0.12),
    dome_glass: glass(0xd4e8f0, 0.13),
    emissive: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.2) }),
    embers: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.5, 0.08) }),
  };
  for (const k of BAKED) {
    M[k].aoMap = ao;
    M[k].aoMapIntensity = 1.0;
  }
  return M;
}

// Paintings (render/painting.js), in tools/blender/cabin_design.py's coordinates (the canvas centre, y above the
// floor) with the yaw that turns the picture's face (local +z) into the room:
//   kitchen:   on the great room's side of the partition wall (its face is at x = PX1 - 0.06), centred between the
//              bedroom door's casing (z 1.52) and the pantry tower (z 3.59): the one long clear stretch of wall in the
//              great room. It faces west down the whole room, the kitchen lamp is 3 m away, and the island in front
//              of it stops 1 m short and below its bottom edge.
//   landscape: over the hearth, where a round mirror used to hang, centred on the chimney breast (x -5.25..-3.15,
//              its face at z = Z0 = 3.55) and the mantel (x -5.05..-3.35, top 1.72). The frame (1.37 x 0.89 m)
//              clears the mantel by 21 cm and the truss tie beam crossing the chimney (underside 2.97) by 15 cm; the
//              candles and the vase stand in front of it (see build_fireplace).
// Each hangs 3 mm off its wall.
const PAINTINGS = [
  { name: 'Painting', pos: [2.34 - 0.003, 1.6, 2.555], yaw: -Math.PI / 2, w: 0.8, h: 0.8, rail: 0.045, textures: paintingTextures },
  { name: 'Landscape', pos: [-4.2, 2.375, 3.55 - 0.003], yaw: Math.PI, w: 1.28, h: 0.8, rail: 0.05, textures: landscapeTextures },
];

// A mitred walnut frame with a pale slip round a w x h canvas: one mesh, vertex-coloured. rail is the frame's width.
function frameGeometry(w, h, rail) {
  const walnut = new THREE.Color(0x4a3325), slip = new THREE.Color(0xb59a74);
  // Profile (offset out from the canvas edge, height off the wall, tone of the segment that starts there): the slip
  // rising from the canvas (overlapping its edge by 5 mm), a bevel, the flat face, a rounded-off outer edge and the
  // side back to the wall.
  const e0 = -0.005, e1 = e0 + rail;
  const prof = [[e0, 0.034, slip], [e0, 0.048, slip], [e0 + 0.012, 0.056, walnut], [e1 - 0.008, 0.06, walnut], [e1, 0.053, walnut], [e1, 0]];
  const sides = [[0, 1, 1, 0], [1, 0, 0, -1], [0, -1, -1, 0], [-1, 0, 0, 1]];   // outward (nx, ny), along (tx, ty)
  const pos = [], nor = [], uv = [], col = [];
  sides.forEach(([nx, ny, tx, ty], k) => {
    const hn = nx ? w / 2 : h / 2, ht = tx ? w / 2 : h / 2;   // half-extents across and along this rail
    let arc = 0;
    for (let i = 0; i < prof.length - 1; i++) {
      const [d0, z0, tone] = prof[i], [d1, z1] = prof[i + 1];
      const len = Math.hypot(d1 - d0, z1 - z0);
      // Outward normal of this segment in the profile plane: its direction turned a quarter to the left.
      const nd = -(z1 - z0) / len, nz = (d1 - d0) / len;
      const N = new THREE.Vector3(nx * nd, ny * nd, nz);
      // Mitred: at offset e the rail sits hn + e out and runs ht + e either way along its tangent.
      const q = (e, z, s) => new THREE.Vector3(nx * (hn + e) + tx * s * (ht + e), ny * (hn + e) + ty * s * (ht + e), z);
      const quad = [[q(d0, z0, -1), -(ht + d0), arc], [q(d0, z0, 1), ht + d0, arc], [q(d1, z1, 1), ht + d1, arc + len], [q(d1, z1, -1), -(ht + d1), arc + len]];
      const e1v = quad[1][0].clone().sub(quad[0][0]), e2v = quad[2][0].clone().sub(quad[0][0]);
      const tri = e1v.cross(e2v).dot(N) > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const j of tri) {
        const [p, s, t] = quad[j];
        pos.push(p.x, p.y, p.z); nor.push(N.x, N.y, N.z);
        uv.push(s * 1.4 + k * 0.37, t * 1.4 + k * 0.21);   // grain runs along each rail
        col.push(tone.r, tone.g, tone.b);
      }
      arc += len;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Each painting is canvas + frame: two meshes, two draw calls, no shadows or collider (they stand 6 cm proud of
// the wall). The frames share one material. Culled with the rooms.
function hangPaintings(ctx, root, floorY, envMap) {
  const grain = Textures.woodGrain();
  const frameMat = patchMaterial(new THREE.MeshStandardMaterial({
    vertexColors: true, map: grain.map, normalMap: grain.normal, normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.48, envMap, envMapIntensity: 0.5, name: 'painting_frame',
  }), { indoorEnv: true });
  for (const P of PAINTINGS) {
    const { map, normal } = P.textures();
    // Matte oil on canvas: the normal map carries the brushwork and the weave.
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.h), patchMaterial(new THREE.MeshStandardMaterial({
      map, normalMap: normal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.78, envMapIntensity: 0.5, name: 'painting',
    })));
    canvas.position.z = 0.034;
    const g = new THREE.Group();
    g.name = P.name;
    g.userData.layer = 'in';
    g.add(canvas, new THREE.Mesh(frameGeometry(P.w, P.h, P.rail), frameMat));
    g.position.set(P.pos[0], floorY + P.pos[1], P.pos[2]);
    g.rotation.y = P.yaw;
    root.add(g);
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      o.matrixAutoUpdate = false;
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; }
    });
    ctx.lod.add(g, { out: LAYER_OUT.in, name: 'cabin@in' });
  }
}

// The two fires (render/fire.js), placed from the GLB's sound empties and sized to what tools/blender/cabin_design.py
// builds round them (design units; the interior sits on FLOOR, so the empties carry the floor height):
//   hearth: FIRE_hearth is (-4.2, hearth top + 0.3, Z0 + 0.2) in a firebox x -4.7..-3.7, 0.8 m tall above the
//           hearth top, z Z0 (the opening) .. ZM (the back, 0.35 m in); logs on andirons, embers on the floor.
//   pit:    FIRE_pit is (0, 0.4, 9.3) over an ash bed (top 0.07) inside a stone ring (inner radius ~0.68, top 0.37),
//           a log teepee to 0.45, embers to 0.3 from the centre.
// Each flame box stands on its fire's floor; the hearth's stops under the lintel and just behind the opening.
const FIRES = {
  hearth: { node: 'FIRE_hearth', floor: -0.29, size: [0.84, 0.76, 0.28], z: -0.03, out: LAYER_OUT.in, sparks: 14, rise: 0.75, rate: 0.5,
    noise: [2.6, 1.6, 1.8], speed: 1.6, tongue: 0.45, density: 13, lift: 0.4, mag: 1.6, warp: 0.3, smoke: 0.3,
    // In front of the opening, in the room: the back of the chimney never sees it.
    light: { offset: [0, 0.1, -0.45], color: [1.0, 0.52, 0.2], distance: 7, power: 5.5 } },
  pit: { node: 'FIRE_pit', floor: -0.33, size: [0.95, 1.25, 0.95], z: 0, out: [60, 80], sparks: 28, rise: 1.9, rate: 0.6,
    noise: [2.0, 1.4, 2.0], speed: 1.5, tongue: 0.35, density: 5, lift: 0.2, mag: 1.7, heat: 0.9, warp: 0.35, smoke: 0.5,
    light: { offset: [0, 0.65, 0], color: [1.0, 0.55, 0.22], distance: 10, power: 9 } },
};

function lightFires(ctx, nodes) {
  const out = {};
  let seed = 1;
  for (const [name, F] of Object.entries(FIRES)) {
    const { node: nodeName, floor, z, size, light, ...tuning } = F;
    const node = nodes[nodeName];
    if (!node) continue;
    const base = node.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, floor, z));
    out[name] = createFire(ctx, {
      ...tuning, name: 'fire:' + name, base, size: new THREE.Vector3(...size), parent: ctx.surface, seed: seed++, probe: PROBE_LAYER,
      light: { ...light, offset: new THREE.Vector3(...light.offset).sub(new THREE.Vector3(0, floor, z)) },   // offsets are from the empty
    });
  }
  return out;
}

// A small cube-map probe re-rendered one face per frame while the player is near the cabin, so glossy
// interior surfaces (mirrors, tile, marble, the oak floor) reflect the room as the light changes.
function createProbe(ctx, pos) {
  const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.1, 150, rt);
  cam.layers.set(PROBE_LAYER);
  cam.position.copy(pos);
  let face = 0, wait = 0;
  const probe = {
    texture: rt.texture,
    update(dt, active) {
      const r = ctx.renderer;
      if (face === 0) { wait -= dt; if (wait > 0 || !active) return; }
      if (cam.coordinateSystem !== r.coordinateSystem) {
        cam.coordinateSystem = r.coordinateSystem;
        cam.updateCoordinateSystem();
        cam.updateMatrixWorld(true);
      }
      const prev = r.getRenderTarget(), auto = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false; // reuse this frame's sun shadow map
      r.setRenderTarget(rt, face);
      r.render(ctx.scene, cam.children[face]);
      r.setRenderTarget(prev);
      r.shadowMap.autoUpdate = auto;
      if (++face === 6) { face = 0; wait = 3; rt.texture.needsPMREMUpdate = true; }
    },
  };
  // The preloader (render/preload.js) captures all six faces once: the cube target is allocated on its first render
  // and its PMREM on the first draw after, which would otherwise happen as you wake up in the cabin.
  (ctx.prewarm ||= []).push(() => { face = 0; wait = 0; for (let i = 0; i < 6; i++) probe.update(0, true); wait = 0; });
  return probe;
}

export function placeCabin(ctx, asset, { origin, collider }) {
  const { gltf, ao } = asset;
  const root = gltf.scene;
  root.position.copy(origin);
  ctx.surface.add(root);
  root.updateMatrixWorld(true);
  const probe = createProbe(ctx, new THREE.Vector3(0.4, 1.9, 0.2).add(origin));
  const M = makeMaterials(ao, probe.texture);
  const noAO = new Map();
  const nodes = {};
  const drop = [];
  const layered = [];
  root.traverse((o) => {
    if (o.name) nodes[o.name] = o;
    if (!o.isMesh) return;
    const name = (o.material?.name || '').replace(/^cabin_/, '');
    if (o.name === 'COLLIDER' || name === 'collider') {
      collider.addGeometry(o.geometry, o.matrixWorld);
      drop.push(o);
      return;
    }
    let m = M[name];
    if (!m) return;
    if (m.aoMap && !o.geometry.attributes.uv1) {
      // Safety: never sample the atlas on a mesh without the second UV set.
      if (!noAO.has(name)) { const c = m.clone(); c.aoMap = null; c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; noAO.set(name, c); }
      m = noAO.get(name);
    }
    o.material = m;
    o.castShadow = !NO_SHADOW.has(name);
    o.receiveShadow = !['emissive', 'embers'].includes(name);
    if (name === 'glass' || name === 'dome_glass') o.renderOrder = 2;
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    o.layers.enable(PROBE_LAYER);
    if (LAYER_OUT[o.userData.layer]) layered.push(o);
  });
  drop.forEach((o) => o.parent.remove(o));
  for (const o of layered) ctx.lod.add(o, { out: LAYER_OUT[o.userData.layer], name: 'cabin@' + o.userData.layer });
  // From other stacks the shell (dome frame, house, roof, porch) is one merged, AO-shaded stand-in; the glass
  // stays so the dome still reads as glass.
  const shell = [];
  root.traverse((o) => { if (o.isMesh && !LAYER_OUT[o.userData.layer] && mergeable(o)) shell.push(o); });
  ctx.lod.addFarProxy(shell, { parent: root, band: FAR_BAND, material: farMaterial(), name: 'cabin', aoTexture: ao });

  const meta = nodes.META?.userData || {};
  const O = origin;
  hangPaintings(ctx, root, meta.floorY ?? 0.5, probe.texture);
  atmo.uIntA.value.set(O.x + meta.intX0, O.z + meta.intZ0, O.x + meta.intX1, O.z + meta.intZ1);
  atmo.uIntB.value.set(O.y + meta.floorY, O.y + meta.eaveY, O.y + meta.ridgeY, O.z);

  // ---- doors ----
  const door = (node, width, openAngle, sound) => {
    if (!node) return;
    node.matrixAutoUpdate = true;
    const p = node.getWorldPosition(new THREE.Vector3());
    const blocker = ctx.physics.addOBB({ x: p.x + width / 2, z: p.z, hx: width / 2, hz: 0.07, ry: 0, y0: p.y - 0.6, y1: p.y + 2.6, zone: 'surface' });
    const meshes = [];
    node.traverse((o) => { if (o.isMesh) { meshes.push(o); o.matrixAutoUpdate = true; } });
    let open = 0, target = 0;
    const soundPos = p.clone().setY(p.y + 1.2);
    ctx.interact.add({
      name: 'cabin:' + node.name, meshes, range: 2.7,
      onPress: () => { target = target ? 0 : 1; ctx.audio?.play(target ? sound[0] : sound[1], { pos: soundPos }); },
    });
    ctx.updaters.push((dt) => {
      if (open === target) return;
      open = target > open ? Math.min(1, open + dt / 1.3) : Math.max(0, open - dt / 1.3);
      const s = open * open * (3 - 2 * open);
      node.rotation.y = s * openAngle;
      blocker.enabled = open < 0.3;
    });
  };
  door(nodes.FrontDoor, 0.97, -1.6, ['hingeOpen', 'hingeClose']);
  door(nodes.DomeDoor, 1.2, -1.5, ['hingeOpen', 'hingeClose']);

  // ---- lights: warm interior point lights (from the shared pool), brighter after dark. The firelight is the
  // fires' own (below), so the lamps hold steady. ----
  let k = 1;
  const lights = [];
  for (const [name, node] of Object.entries(nodes)) {
    if (!name.startsWith('LIGHT_')) continue;
    const ud = node.userData, power = ud.power || 5;
    lights.push({
      pos: node.getWorldPosition(new THREE.Vector3()), color: new THREE.Color(...(ud.color || [1, 0.75, 0.5])),
      distance: ud.distance || 8, intensity: () => power * 1.2 * k,
    });
  }
  ctx.lightPool.add({ center: origin.clone(), radius: (meta.domeR || 14) + 4, lights });
  const fires = lightFires(ctx, nodes);
  ctx.updaters.push(() => {
    const night = atmo.uNight.value;
    // The ember meshes (hearth and pit share the material) glow with the hearth's flicker.
    const flicker = 0.88 * (fires.hearth?.flicker ?? 1);
    // The camera exposes up by ~3x at night; divide it back out so lamps look the same all day (a touch
    // brighter after dark) instead of blowing out the room.
    k = (1 + night * 0.3) / Math.max(0.5, atmoState.exposure);
    M.emissive.color.setRGB(3.2 * k, 2.2 * k, 1.2 * k);
    M.shade.emissiveIntensity = 0.55 * k;
    M.embers.color.setRGB(2.0 * flicker * k, 0.5 * flicker * k, 0.08 * k);   // glowing red-orange, not white
  });

  const near = (p) => Math.hypot(p.x - origin.x, p.z - origin.z) < (meta.domeR || 14) + 6 && Math.abs(p.y - origin.y) < 12;
  ctx.updaters.push((dt) => probe.update(dt, !!ctx.player && near(ctx.player.feet)));

  // ---- sounds ----
  const wp = (n) => nodes[n]?.getWorldPosition(new THREE.Vector3());
  if (nodes.FIRE_hearth) ctx.audio?.registerEmitter?.('fire', wp('FIRE_hearth'), 'surface');
  if (nodes.FIRE_pit) ctx.audio?.registerEmitter?.('firepit', wp('FIRE_pit'), 'surface');

  // ---- where you wake up ----
  const wake = {
    bed: wp('WAKE_bed'),
    bedYaw: nodes.WAKE_bed?.userData.yaw ?? 0,
    stand: wp('WAKE_stand'),
    standYaw: nodes.WAKE_stand?.userData.yaw ?? 0,
  };
  const x0 = O.x + meta.houseX0, x1 = O.x + meta.houseX1, z0 = O.z + meta.houseZ0, z1 = O.z + meta.houseZ1;
  const inside = (p) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 && p.y > O.y - 0.3 && p.y < O.y + meta.ridgeY;
  return { root, wake, inside, meta, domeR: meta.domeR || 14 };
}
