import * as THREE from 'three';
import { GLTFLoader } from '../render/gltf.js';
import { patchMaterial } from '../render/materials.js';
import { atmo } from '../render/atmosphere.js';
import { addKeepOut } from '../render/lod.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInspectable } from './inspect.js';

// The view deck on the Dome stack (tools/blender/deck_design.py): a low weathered-cedar platform with two Adirondack
// chairs facing out over the cloud sea toward the Rocks and the sunset, an end table between them and a small lantern.
// The model's frame: origin at the centre of the footprint on the levelled ground, +z toward the view, y up. Three
// meshes (wood, black metal, the lantern's panes) plus the lantern's glow sprite; one collider of its own ('deck').
//
// Sitting: aim at a chair and press (Space / E / click) to sit in it (Player.sit, player/controller.js); press again or
// walk (W A S D) to stand up in front of it.
//
// The postcard on the end table (POSTCARD; its picture is tools/blender/paint_postcard.py: a close map of one island on
// the lounge's globe, and a written back): press it to hold it up close, move the mouse across to turn it over, press
// again to put it down (props/inspect.js).

const LOD_OUT = [70, 90];
// Seated look limits around the view straight ahead (radians).
const SIT_YAW = THREE.MathUtils.degToRad(100), SIT_PITCH = [THREE.MathUtils.degToRad(-40), THREE.MathUtils.degToRad(35)];
const SKIRT = 0.4;   // the collider's sloped skirt: from the deck's edge down to the ground this far out

export async function loadDeck() {
  const base = import.meta.env.BASE_URL + 'models/';
  const tl = new THREE.TextureLoader();
  const [gltf, ao, wood, normal, postcard] = await Promise.all([
    new GLTFLoader().loadAsync(base + 'deck.glb'),
    tl.loadAsync(base + 'deck_ao.png'), tl.loadAsync(base + 'deck_wood.png'), tl.loadAsync(base + 'deck_wood_normal.png'),
    tl.loadAsync(base + 'postcard.jpg').catch(() => null),
  ]);
  if (postcard) { postcard.colorSpace = THREE.SRGBColorSpace; postcard.anisotropy = 8; }
  ao.flipY = false; ao.channel = 1; ao.colorSpace = THREE.NoColorSpace;
  ao.generateMipmaps = false; ao.minFilter = THREE.LinearFilter;   // an atlas of small charts (see cabin.js)
  for (const t of [wood, normal]) {
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;   // a seamless tile, one repeat per metre
    t.anisotropy = 8;
  }
  wood.colorSpace = THREE.SRGBColorSpace;
  normal.colorSpace = THREE.NoColorSpace;
  return { gltf, ao, wood, normal, postcard };
}

// A soft round falloff for the lantern's glow (a DataTexture, so the headless harness can build it too).
function glowTexture() {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const r = Math.hypot(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(Math.max(0, 1 - r) ** 2.5 * (0.3 + 0.7 * Math.exp(-6 * r)) * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function makeMaterials(asset) {
  const std = (o) => patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, aoMap: asset.ao, envMapIntensity: 0.6, ...o }));
  return {
    wood: std({ map: asset.wood, normalMap: asset.normal, normalScale: new THREE.Vector2(0.9, -0.9), roughness: 0.88 }),
    metal_black: std({ metalness: 0.55, roughness: 0.45 }),
    emissive: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.35, 0.6) }),
  };
}

// Places the deck at `pos` (its footprint's centre on the ground) turned by `rotY` (its +z, the view, then points along
// (sin rotY, cos rotY)). Returns { root, on(feet), inside(x, z, margin), seats }.
export function placeDeck(ctx, asset, { pos, rotY, parent }) {
  const root = new THREE.Group();
  root.name = 'deck';
  root.position.copy(pos);
  root.rotation.y = rotY;
  parent.add(root);
  root.updateMatrixWorld(true);

  const M = makeMaterials(asset);
  const empties = {};
  let colliderGeo = null;
  const meshes = [];
  asset.gltf.scene.updateMatrixWorld(true);
  asset.gltf.scene.traverse((o) => {
    if (o.isMesh) {
      if (o.name === 'COLLIDER') { colliderGeo = o.geometry.clone().applyMatrix4(o.matrixWorld); return; }
      meshes.push(o);
    } else if (o !== asset.gltf.scene && !o.isMesh) {
      empties[o.name] = o;
    }
  });
  for (const o of meshes) {
    const key = (o.material?.name || '').replace(/^deck_/, '');
    const mat = M[key];
    if (!mat) continue;
    const mesh = new THREE.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), mat);
    mesh.name = 'deck:' + key;
    mesh.castShadow = key !== 'emissive';
    mesh.receiveShadow = key !== 'emissive';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  const E = (name) => empties[name]?.position.clone() ?? new THREE.Vector3();
  const meta = empties.META?.userData ?? {};
  const W = meta.w ?? 3, D = meta.d ?? 2.4, TOP = meta.top ?? 0.2;
  const stepD = meta.step_d ?? 0.34;

  // The lantern's glow: a small additive sprite, stronger as the light goes.
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(1.0, 0.62, 0.3), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: 0.4,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.name = 'deck:glow';
  glow.position.copy(E('LANTERN'));
  glow.scale.setScalar(0.55);
  root.add(glow);
  ctx.updaters.push(() => { if (root.visible) glowMat.opacity = 0.12 + 0.6 * atmo.uNight.value; });

  // Collision: the model's boxes (platform, step, chairs, table) and a sloped skirt all round, so the deck can be
  // walked onto from any side (the step alone would be the only way up a 20 cm edge). Its own collider: adding to the
  // stack's would reshuffle that one's BVH (see tools/regress).
  const col = ctx.lateCollider('deck');
  if (colliderGeo) col.addGeometry(colliderGeo, root.matrixWorld);
  {
    const hw = W / 2, hd = D / 2, o = SKIRT, y0 = -0.08;
    const top = [[-hw, TOP, -hd], [hw, TOP, -hd], [hw, TOP, hd], [-hw, TOP, hd]];
    const bot = [[-hw - o, y0, -hd - o], [hw + o, y0, -hd - o], [hw + o, y0, hd + o], [-hw - o, y0, hd + o]];
    const p = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      p.push(...top[i], ...bot[i], ...bot[j], ...top[i], ...bot[j], ...top[j]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    col.addGeometry(g, root.matrixWorld);
  }

  // No instanced scatter (grass tufts) may show through the boards.
  addKeepOut(root.matrixWorld, new THREE.Box3(new THREE.Vector3(-W / 2 - 0.05, -1, -D / 2 - stepD - 0.05), new THREE.Vector3(W / 2 + 0.05, 1.5, D / 2 + 0.05)));

  // The chairs: a hit box over each seat and back (aim at it), the seated eye, and where you stand up.
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitGeo = new THREE.BoxGeometry(0.78, 0.75, 0.85);
  const viewYaw = rotY + Math.PI;   // the player's yaw that looks along the deck's +z
  const seats = [];
  for (let i = 0; i < 2; i++) {
    const chair = empties['CHAIR_' + i];
    if (!chair) continue;
    const ry = chair.userData.ry ?? 0;
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.name = 'deck:chair:' + i;
    hit.position.copy(chair.position);
    hit.position.y += 0.5;
    hit.rotation.y = ry;
    root.add(hit);
    hit.updateMatrixWorld(true);
    const seat = {
      name: 'deck:chair:' + i,
      eye: root.localToWorld(E('SEAT_' + i)),
      stand: root.localToWorld(E('STAND_' + i)),
      yaw: viewYaw + ry,
      yawRange: SIT_YAW, pitchMin: SIT_PITCH[0], pitchMax: SIT_PITCH[1],
      onSit: () => ctx.audio.play('step', { surface: 'wood', pos: seat.eye }),
      onStand: () => ctx.audio.play('step', { surface: 'wood', pos: seat.stand }),
    };
    seats.push(seat);
    ctx.interact.add({
      name: seat.name, meshes: [hit], range: 2.6, exact: true, zone: 'surface',
      onPress: () => ctx.player?.sit(seat),
    });
  }

  const postcard = placePostcard(ctx, asset, root, empties.POSTCARD);

  ctx.lod.add(root, { out: LOD_OUT, name: 'deck' });

  const inv = root.matrixWorld.clone().invert();
  const _p = new THREE.Vector3();
  // Deck-local footprint tests: inside(x, z, margin) for the scatter keep-outs, on(feet) for footsteps.
  const inside = (x, z, margin = 0) => {
    _p.set(x, pos.y, z).applyMatrix4(inv);
    return Math.abs(_p.x) < W / 2 + margin && _p.z < D / 2 + margin && _p.z > -D / 2 - stepD - margin;
  };
  const on = (feet) => inside(feet.x, feet.z, 0.05) && feet.y > pos.y + 0.06 && feet.y < pos.y + TOP + 0.3;
  return { root, seats, inside, on, postcard, local: (x, z) => _p.set(x, pos.y, z).applyMatrix4(inv).clone() };
}

const POSTCARD_HOLD = 0.2;   // m in front of the eye: its edges stay outside the near plane (0.12) as it turns over

// The postcard: one mesh, its face (the top half of postcard.jpg) and its back (the bottom half) back to back, lying face
// up at POSTCARD with the top of its picture toward the view, so it reads the right way up from behind the chairs.
function placePostcard(ctx, asset, root, node) {
  if (!node || !asset.postcard) return null;
  const [w, h] = node.userData.size ?? [0.14, 0.09];
  const side = (v0, flip) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * 0.5);
    if (flip) { g.rotateY(Math.PI); g.translate(0, 0, -0.0004); }
    return g;
  };
  const mat = patchMaterial(new THREE.MeshStandardMaterial({
    map: asset.postcard, roughness: 0.86, envMapIntensity: 0.5, emissive: 0xffffff, emissiveMap: asset.postcard, emissiveIntensity: 0, name: 'deck-postcard',
  }));
  const card = new THREE.Mesh(mergeGeometries([side(0.5, false), side(0, true)]), mat);
  card.name = 'deck:postcard';
  card.receiveShadow = true;
  root.add(card);
  const restP = node.position.clone();
  const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, (node.userData.ry ?? 0) + Math.PI, 0, 'YXZ'));
  card.position.copy(restP);
  card.quaternion.copy(restQ);
  const inspect = makeInspectable(ctx, {
    object: card, parent: root, meshes: [card], name: 'deck:postcard', hold: POSTCARD_HOLD, turn: true,
    // Held up to catch the light: a touch by day, more after dark (the deck is out in the dusk and the night).
    glow: { material: mat, amount: () => 0.03 + 0.06 * atmo.uNight.value },
    rest: (outP, outQ) => { outP.copy(restP); outQ.copy(restQ); },
  });
  ctx.updaters.push((dt) => inspect.update(dt));
  return { card, inspect };
}
