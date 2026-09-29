import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials, patchMaterial } from '../render/materials.js';
import { atmo } from '../render/atmosphere.js';
import { mat4, mergeParts } from '../world/builders.js';
import { buildLadder } from '../world/features.js';
import { TOWER_SEQUENCE, SEQ_PULSE, SEQ_REST, towerSolved } from '../world/towerPuzzle.js';

const _up = new THREE.Vector3(0, 1, 0);
const _cam = new THREE.Vector3();

// The lattice is laid out in design units and built at this scale (height and footprint); the catwalk and
// ladder are in plain metres, since people don't scale.
const S = 1.2;

// The LEDs breathe: one slow swell in and out every BREATH seconds (see buildPowerTower). Their glow is a saturated
// emissive kept low enough that the tone mapping doesn't bleach it, plus a soft additive halo: anything bright enough to
// pass the bloom's threshold comes out nearly white.
const BREATH = 3;
const LED_GLOW = [[0.0, 1.0, 0.18], [1.0, 0.5, 0.0], [1.0, 0.0, 0.04]];   // green, yellow, red
const LED_PEAK = [0.5, 0.5, 0.65];    // full emissive per LED
const LED_FLOOR = 0.015;              // the faintest glow between breaths
const HALO = 0.75;                    // the halo's full opacity

// A soft round falloff for the halos (built here, not drawn on a canvas, so the headless harness can build it too).
let haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const r = Math.hypot(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(Math.max(0, 1 - r) ** 3 * (0.35 + 0.65 * Math.exp(-5 * r)) * 255);
    }
  }
  haloTex = new THREE.DataTexture(data, N, N);
  haloTex.magFilter = haloTex.minFilter = THREE.LinearFilter;
  haloTex.needsUpdate = true;
  return haloTex;
}

function member(a, b, t = 0.16) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, b.clone().sub(a).normalize());
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  return { geo: g, matrix: m };
}

// ---- The catwalk kit, one per LED (tools/blender/tower_kit_design.py): the DIP-switch box on the rail with its
// sliders, the big capacitor bolted to the outside of the lattice, and the small solar panel clamped to a rail. Each is
// modelled once in its own frame and placed three times here; they share one atlas (albedo, normal, AO/roughness/metal).
//
// Switch box frame: origin at the centre of its back face, +z out of the door toward the deck, +x to the viewer's
// right. SWB.y is that centre's height above the deck (chest height: the model's BOX_Y, its mounting built to suit);
// face, pitch, travel and midY are the model's switch plate.
const SWB = { y: 1.3, w: 0.3, h: 0.34, d: 0.1, bar: 0.015, face: 0.112, midY: -0.03, pitch: 0.085, travel: 0.045 };
export const TOWER_SWITCH_POS = ['top', 'center', 'bottom'];

const KIT_FILES = { albedo: 'tower_kit_albedo.png', normal: 'tower_kit_normal.png', orm: 'tower_kit_orm.png' };

export async function loadTowerKit() {
  const tl = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  const keys = Object.keys(KIT_FILES);
  const [gltf, ...tex] = await Promise.all([new GLTFLoader().loadAsync(base + 'tower_kit.glb'), ...keys.map((k) => tl.loadAsync(base + KIT_FILES[k]))]);
  const T = Object.fromEntries(keys.map((k, i) => [k, tex[i]]));
  for (const [k, t] of Object.entries(T)) {
    t.flipY = false;                                  // glTF UVs
    t.colorSpace = k === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
  }
  return { gltf, ...T };
}

// Each part's meshes merged into one geometry in the part's own frame, the shared material, and the model's numbers.
let kitShared = null;
function towerKit(asset) {
  if (kitShared) return kitShared;
  const scene = asset.gltf.scene;
  scene.updateMatrixWorld(true);
  const nodes = {};
  scene.traverse((o) => { if (o.name) nodes[o.name] = o; });
  const m4 = new THREE.Matrix4();
  const geo = (name) => {
    const root = nodes[name];
    const inv = root.matrixWorld.clone().invert();
    const list = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = new THREE.BufferGeometry();
      for (const a of ['position', 'normal', 'uv']) g.setAttribute(a, o.geometry.attributes[a].clone());
      g.setIndex(o.geometry.index.clone());
      list.push(g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld)));
    });
    const g = mergeGeometries(list, false);
    g.computeBoundingSphere();
    return g;
  };
  const mat = patchMaterial(new THREE.MeshStandardMaterial({
    name: 'tower_kit', map: asset.albedo, normalMap: asset.normal, normalScale: new THREE.Vector2(1, -1),   // green flipped for glTF UVs
    roughnessMap: asset.orm, metalnessMap: asset.orm, aoMap: asset.orm, roughness: 1, metalness: 1,
  }));
  const meta = nodes.META?.userData ?? {};
  kitShared = {
    box: geo('BOX'), tags: [0, 1, 2].map((i) => geo('TAG_' + i)), slider: geo('SLIDER'), cap: geo('CAP'), panel: geo('PANEL'),
    mat,
    // Where the leads leave the capacitor's terminals (ring-lug barrels, pointing out along x) and the panel's gland.
    termP: new THREE.Vector3(...(meta.termP ?? [0.235, 1.1925, 0.532])),
    termN: new THREE.Vector3(...(meta.termN ?? [-0.235, 1.1925, 0.532])),
    jbox: new THREE.Vector3(...(meta.jbox ?? [0.05, 0.13, 0.1])),
  };
  return kitShared;
}

// A cable along a smooth path through `pts` (tower-local), into the tower's batch as dark rubber.
function cable(batcher, material, m, pts, r) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len / 0.12)), r, r > 0.01 ? 8 : 5, false);
  batcher.add(g, material, m, 0x161616);
}

// A tall lattice power-line tower with a trussed cross-arm and three giant breathing LEDs on top. A steel ladder
// climbs the inside of the body to a grated catwalk laid in the cross-arm, which runs under all three LEDs, each with
// its kit (switch box, capacitor, solar panel).
export function buildPowerTower(ctx, { base, rotY = 0, batcher, collider }) {
  const M = materials();
  const parts = [];
  const V = (x, y, z) => new THREE.Vector3(x * S, y * S, z * S);
  const bar = (a, b, t) => parts.push(member(a, b, t * S));
  const levels = [0, 3.6, 7.4, 11.2, 15, 18.6, 22.2, 25.6, 28.8, 31, 33, 35.6, 38.4, 41];
  const hw = (y) => (y <= 31 ? 1.55 + 4.1 * Math.pow(1 - y / 31, 1.35) : THREE.MathUtils.lerp(1.55, 0.35, (y - 31) / 10));
  const corners = (y) => { const w = hw(y); return [V(-w, y, -w), V(w, y, -w), V(w, y, w), V(-w, y, w)]; };
  const armY0 = 31, armY1 = 33.2, span = 11.5;
  const ledColors = [0x2bd96b, 0xffc930, 0xff3a2a];
  for (let i = 0; i < levels.length; i++) {
    const c = corners(levels[i]);
    const t = levels[i] < 20 ? 0.22 : 0.16;
    for (let k = 0; k < 4; k++) bar(c[k], c[(k + 1) % 4], t * 0.7);
    if (i === 0) continue;
    const p = corners(levels[i - 1]);
    for (let k = 0; k < 4; k++) {
      bar(p[k], c[k], t * 1.3);
      // X-bracing on every face, except where the catwalk passes through the body (faces 1 and 3 are +x and -x).
      if (levels[i - 1] === armY0 && k % 2 === 1) continue;
      bar(p[k], c[(k + 1) % 4], t * 0.6);
      bar(p[(k + 1) % 4], c[k], t * 0.6);
    }
    // Plan bracing every other level
    if (i % 2 === 0) { bar(c[0], c[2], 0.1); bar(c[1], c[3], 0.1); }
  }
  // Peak
  const top = V(0, 44, 0);
  for (const c of corners(41)) bar(c, top, 0.12);
  // Mounting plate for the yellow LED on the peak.
  parts.push({ geo: new THREE.BoxGeometry(1.6 * S, 0.14 * S, 1.6 * S), matrix: mat4(0, 44.05 * S, 0) });

  // Cross-arm truss at the waist.
  for (const z of [-0.9, 0.9]) {
    bar(V(-span, armY1, z), V(span, armY1, z), 0.2);
    bar(V(-span + 1.6, armY0, z * 0.6), V(span - 1.6, armY0, z * 0.6), 0.18);
    bar(V(-span, armY1, z), V(-span + 1.6, armY0, z * 0.6), 0.16);
    bar(V(span, armY1, z), V(span - 1.6, armY0, z * 0.6), 0.16);
    for (let x = -span + 1.6, k = 0; x < span - 1.6; x += 1.45, k++) {
      const x2 = Math.min(span - 1.6, x + 1.45);
      bar(V(k % 2 ? x : x2, armY0, z * 0.6), V(k % 2 ? x2 : x, armY1, z), 0.1);
    }
  }
  for (let x = -span; x <= span; x += 2.3) bar(V(x, armY1, -0.9), V(x, armY1, 0.9), 0.1);
  // Small ground-wire arms near the peak.
  bar(V(-4.2, 39.2, 0), V(4.2, 39.2, 0), 0.14);
  bar(V(-4.2, 39.2, 0), V(-0.6, 38.4, 0), 0.1);
  bar(V(4.2, 39.2, 0), V(0.6, 38.4, 0), 0.1);

  // ---- Catwalk: grating on the arm's bottom chords, from under one arm LED, through the body (under the peak
  // LED), to under the other. Everything below is in metres in the tower's frame.
  const m = mat4(base.x, base.y, base.z, rotY);
  const tipX = (span - 1.6) * S;                   // arm LEDs stand over the ends of the bottom chords
  const deckY = armY0 * S + 0.17;                  // grating top, resting on the chords
  const dw = 0.62, dl = tipX + 0.22;               // deck half-width and half-length
  const ladderX = 0.25 * S, ladderZ = -0.68;       // under a web node, so no diagonal crosses the climb
  const gap = [ladderX - 0.36, ladderX + 0.36];    // opening in the -z rail where the ladder arrives
  const box = (w, h, d, x, y, z, color) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), matrix: mat4(x, y, z), color });
  // Grating: a dark under-plate with bearing bars along the deck and cross rods over it.
  box(dl * 2, 0.02, dw * 2, 0, deckY - 0.05, 0, 0x3c3934);
  for (let z = -dw + 0.04; z <= dw - 0.04 + 1e-6; z += (dw * 2 - 0.08) / 12) box(dl * 2, 0.04, 0.025, 0, deckY - 0.02, z);
  for (let x = -dl + 0.1; x < dl; x += 0.25) box(0.02, 0.015, dw * 2, x, deckY - 0.013, 0);
  // Cross bearers under the grating at the chord nodes.
  for (let x = -tipX; x <= tipX + 1e-6; x += tipX / 7) box(0.08, 0.14, 1.52, x, armY0 * S + 0.03, 0);
  // Rails: posts, a top rail at 1.07 m, a knee rail and a toe board, split around the ladder opening.
  const run = (x0, x1, z) => {
    const L = x1 - x0, cx = (x0 + x1) / 2;
    box(L, 0.05, 0.05, cx, deckY + 1.07, z);
    box(L, 0.04, 0.04, cx, deckY + 0.55, z);
    box(L, 0.1, 0.015, cx, deckY + 0.05, z);
    const n = Math.max(1, Math.round(L / 1.45));
    for (let i = 0; i <= n; i++) box(0.05, 1.07, 0.05, x0 + (L * i) / n, deckY + 0.535, z);
  };
  const edge = dw - 0.03;
  run(-dl + 0.03, dl - 0.03, edge);
  run(-dl + 0.03, gap[0], -edge);
  run(gap[1], dl - 0.03, -edge);
  for (const sx of [-1, 1]) {
    const x = sx * (dl - 0.03);
    box(0.05, 0.05, dw * 2 - 0.06, x, deckY + 1.07, 0);
    box(0.04, 0.04, dw * 2 - 0.06, x, deckY + 0.55, 0);
    box(0.015, 0.1, dw * 2 - 0.06, x, deckY + 0.05, 0);
  }
  // Safety bars across the ladder opening (you get on by looking down over them, like any ladder top).
  box(gap[1] - gap[0], 0.05, 0.05, ladderX, deckY + 1.0, -edge, 0xc9a227);
  box(gap[1] - gap[0], 0.05, 0.05, ladderX, deckY + 0.55, -edge, 0xc9a227);

  // The kit under each LED (see towerKit): a switch box on the inside of the +z rail (the -z one has the ladder
  // opening at the centre), a capacitor on the outside of the -z side (toward the path up and the Dome), clamped to a
  // channel that spans two of the lattice's members, and a solar panel on a rail: on the end rails for the arm LEDs,
  // beside the ladder's arrival for the peak's.
  const swBoxX = [-tipX + 0.05, 0, tipX - 0.05];   // as the LEDs (green, yellow, red); ends clear of the corner posts
  const swFrames = swBoxX.map((x) => mat4(x, deckY + SWB.y, edge - 0.025 - SWB.bar, Math.PI));
  const railTop = deckY + 1.095;
  const panelFrames = [mat4(-(dl - 0.03), railTop, 0, -Math.PI / 2), mat4(-0.6, railTop, -edge, Math.PI), mat4(dl - 0.03, railTop, 0, Math.PI / 2)];
  const y0 = armY0 * S, y1 = armY1 * S;
  const chordZ = [0.6 * 0.9 * S + 0.09 * S, 0.9 * S + 0.1 * S];       // outer faces of the arm's bottom and top chords
  const bodyZ = [hw(armY0) * S + 0.056 * S, hw(33) * S + 0.056 * S];  // and of the body's rings at 31 and 33
  const capX = 10.9;
  const capFrames = [mat4(-capX, y0, -chordZ[1], Math.PI), mat4(-0.9, y0, -bodyZ[0], Math.PI), mat4(capX, y0, -chordZ[1], Math.PI)];
  const strut = (x, y, za, zb) => box(0.07, 0.07, zb - za, x, y, -(za + zb) / 2);
  for (const sx of [-1, 1]) {
    strut(sx * capX, y0, chordZ[0], chordZ[1]);                                        // channel foot to the bottom chord
    box(0.12, 0.012, 0.3, sx * capX, y1 + 0.1 * S + 0.006, -(chordZ[1] - 0.1));             // clip over the top chord
  }
  strut(-0.9, 33 * S, bodyZ[1], bodyZ[0]);                                             // the peak's: channel top to ring 33

  const frame = mergeParts(parts);
  frame.applyMatrix4(m);
  batcher.add(frame, M.darkMetal, null, 0x8a8480);

  // Catwalk collision: the deck is one walkable slab, the rails a closed ring of walls (across the ladder opening
  // too), so there is no gap to slip through and no edge to walk off.
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
  const slab = (x, y, z, w, h, d) => { const p = P(x, y, z); collider.addBox(p.x, p.y, p.z, w, h, d, rotY); };
  slab(0, deckY - 0.05, 0, dl * 2, 0.1, dw * 2);
  for (const s of [-1, 1]) {
    slab(0, deckY + 0.55, s * edge, dl * 2, 1.3, 0.06);
    slab(s * (dl - 0.03), deckY + 0.55, 0, 0.06, 1.3, dw * 2);
  }

  // Ladder up the inside of the body, from the ground to the catwalk's -z edge.
  const ladderBase = P(ladderX, 0, ladderZ);
  const out = new THREE.Vector3(0, 0, -1).applyAxisAngle(_up, rotY);
  // Getting on from the top needs you to face the opening, not just look down while walking past it.
  buildLadder(ctx, { base: ladderBase, n: out, height: deckY, batcher, material: M.darkMetal, topFacing: -0.5 });
  // Its stringers stop you walking through it at the bottom (the climb itself is kinematic).
  slab(ladderX, (deckY - 0.1) / 2, ladderZ - 0.22, 0.64, deckY - 0.1, 0.12);

  // Concrete footings and leg collision.
  const w0 = hw(0) * S;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p = new THREE.Vector3(sx * w0, 0, sz * w0).applyMatrix4(m);
    // Deep enough to meet the apron where it starts to fall away under the wider base.
    batcher.add(new THREE.BoxGeometry(1.1 * S, 1.2, 1.1 * S), M.plaster, mat4(p.x, base.y - 0.1, p.z, rotY), 0x9a948a);
    collider.addBox(p.x, base.y + 2 * S, p.z, 1.1 * S, 4.5 * S, 1.1 * S, rotY);
  }

  // Green and red sit on the arm's two branches; yellow crowns the peak, clear of the lattice.
  const leds = [];
  const ledSpots = [[-span + 1.6, armY1 + 0.1], [0, 44.0], [span - 1.6, armY1 + 0.1]];
  ledSpots.forEach(([x, y], i) => {
    const col = new THREE.Color(ledColors[i]);
    const glow = new THREE.Color(...LED_GLOW[i]);
    const mat = patchMaterial(new THREE.MeshPhysicalMaterial({
      color: col.clone().multiplyScalar(0.55), roughness: 0.18, metalness: 0, transmission: 0, clearcoat: 1, clearcoatRoughness: 0.1,
      emissive: glow, emissiveIntensity: 0, transparent: true, opacity: 0.92, vertexColors: true,
    }));
    const r = 1.05;
    const lens = mergeParts([
      { geo: new THREE.CylinderGeometry(r, r, 2.1, 32), matrix: mat4(0, 1.05 + 0.12, 0) },
      { geo: new THREE.SphereGeometry(r, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), matrix: mat4(0, 2.1 + 0.12, 0) },
      { geo: new THREE.CylinderGeometry(r * 1.13, r * 1.13, 0.24, 32), matrix: mat4(0, 0.12, 0) },
    ]);
    const mesh = new THREE.Mesh(lens, mat);
    mesh.position.copy(P(x * S, y * S, 0));
    mesh.rotation.y = rotY;
    mesh.scale.setScalar(S);
    mesh.castShadow = true;
    ctx.surface.add(mesh);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
    }));
    halo.name = 'tower-led-halo';
    halo.position.copy(P(x * S, y * S + 1.35, 0));
    halo.scale.setScalar(12);
    ctx.surface.add(halo);
    // Only the red LED (i = 2) breathes at the start; a puzzle lights the others by raising their `level`.
    leds.push({ mesh, mat, halo, color: col, level: i === 2 ? 1 : 0, peak: LED_PEAK[i] });
  });
  ctx.towerLEDs = leds;

  // Breathing: all three swell from dark to a soft glow and back over BREATH seconds, in step (an ease in and out,
  // squared so it lingers dark and blooms quickly). A puzzle can dim or silence one through its `level` (0..1).
  // Solved (every switch box set to TOWER_SOLUTION, world/towerPuzzle.js) with the Tower line powered, the LEDs
  // instead flash TOWER_SEQUENCE, one pulse a second (a dark gap between pulses, so repeats of a colour read as
  // separate flashes), then stay dark for SEQ_REST seconds, and repeat. Changing a switch or cutting the power puts
  // them straight back to the red breathing.
  let breath = 0, seqT = -1;
  const seqLen = TOWER_SEQUENCE.length * SEQ_PULSE + SEQ_REST;
  const glow = [0, 0, 0];
  ctx.updaters.push((dt) => {
    breath = (breath + dt / BREATH) % 1;
    const on = !!ctx.power?.tower && towerSolved(ctx.state.towerSwitches);
    if (on) seqT = seqT < 0 ? 0 : (seqT + dt) % seqLen; else seqT = -1;
    if (seqT >= 0) {
      glow.fill(0);
      const i = Math.floor(seqT / SEQ_PULSE);
      if (i < TOWER_SEQUENCE.length) {
        const u = seqT / SEQ_PULSE - i;
        glow[TOWER_SEQUENCE[i]] = THREE.MathUtils.smoothstep(u, 0, 0.08) * (1 - THREE.MathUtils.smoothstep(u, 0.62, 0.78));
      }
    } else {
      const b = 0.5 - 0.5 * Math.cos(breath * Math.PI * 2);
      const k = LED_FLOOR + (1 - LED_FLOOR) * b * b;
      for (let i = 0; i < 3; i++) glow[i] = leds[i].level * k;
    }
    ctx.camera?.getWorldPosition(_cam);
    // The halos glow only against a darkening sky (by day they'd be pale discs).
    const dusk = THREE.MathUtils.smoothstep(-atmo.uSunDir.value.y, -0.12, 0.08);
    leds.forEach((l, i) => {
      l.mat.emissiveIntensity = l.peak * glow[i];
      // The halo is for seeing it from afar: close by, the lens fills the view and a halo would drown it.
      const near = ctx.camera ? THREE.MathUtils.smoothstep(_cam.distanceTo(l.halo.position), 8, 40) : 1;
      l.halo.material.opacity = HALO * glow[i] * near * dusk;
      l.halo.visible = l.halo.material.opacity > 0.004;
    });
  });
  // For tests and the console: whether the sequence is showing, and how far into it (s).
  ctx.towerSequence = { active: () => seqT >= 0, time: () => seqT, length: seqLen };

  // ---- The kits: per LED one near mesh (box, tag, panel; gone beyond ~36 m, so not from the ground), and one mesh for
  // all three capacitors, drawn at any distance. The leads are cables in the tower's batch.
  const kit = ctx.towerKitAsset ? towerKit(ctx.towerKitAsset) : null;
  if (kit) {
    const placed = (g, F) => g.clone().applyMatrix4(m.clone().multiply(F));
    swFrames.forEach((F, i) => {
      const g = mergeGeometries([placed(kit.box, F), placed(kit.tags[i], F), placed(kit.panel, panelFrames[i])], false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, kit.mat);
      mesh.name = 'tower-kit:' + i;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      ctx.surface.add(mesh);
      ctx.lod?.add(mesh, { out: [30, 36], name: 'tower-kit:' + i });
    });
    const cg = mergeGeometries(capFrames.map((F) => placed(kit.cap, F)), false);
    cg.computeBoundingSphere();
    const caps = new THREE.Mesh(cg, kit.mat);
    caps.name = 'tower-capacitors';
    caps.castShadow = true;
    caps.receiveShadow = true;
    caps.matrixAutoUpdate = false;
    ctx.surface.add(caps);

    // Two leads from each capacitor's terminals up into its LED's base ring (the peak's run up the body's -z face), and
    // a thin one from each panel's junction box along the toe board to the capacitor's - terminal.
    const L = (F, v) => v.clone().applyMatrix4(F);
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const ringR = 1.05 * 1.13 * S, ringY = 0.14 * S;
    // A point on LED i's base ring, `a` round from -z toward +x, dr outside its surface.
    const ringAt = (i, a, dr) => V3(ledSpots[i][0] * S + Math.sin(a) * (ringR + dr), ledSpots[i][1] * S + ringY, -Math.cos(a) * (ringR + dr));
    capFrames.forEach((F, i) => {
      const leads = [[kit.termP, 1], [kit.termN, -1]].map(([t, s]) => ({ p0: L(F, t), p1: L(F, t.clone().add(V3(s * 0.08, 0, 0))) }));
      if (i === 1) {
        leads.forEach(({ p0, p1 }, k) => {
          const pts = [p0, p1, V3(p1.x, p1.y + 0.4, p1.z + 0.08)];
          for (const yd of [33, 34.6, 36.2, 37.8, 39.4, 41]) {
            const f = (yd - 33) / 8;
            pts.push(V3(k ? THREE.MathUtils.lerp(-0.7, -0.07, f) : THREE.MathUtils.lerp(-1.1, -0.17, f), yd * S, -(hw(yd) * S + 0.18)));
          }
          const x = k ? -0.04 : -0.14;
          pts.push(V3(x, 42.6 * S, -(0.35 * (44 - 42.6) / 3 * S + 0.24)), V3(x, 43.55 * S, -1.05), V3(x, 44 * S - 0.02, -(ringR - 0.18)), V3(x, 44 * S + 0.06, -(ringR - 0.18)));
          cable(batcher, M.plaster, m, pts, 0.024);
        });
      } else {
        // The lead from the inner terminal takes the ring point further in, so the two never cross.
        const side = Math.sign(leads[0].p0.x);
        const inner = Math.abs(leads[0].p0.x) < Math.abs(leads[1].p0.x) ? 0 : 1;
        leads.forEach(({ p0, p1 }, k) => {
          const a = -side * (k === inner ? 0.58 : 0.3);
          const q = ringAt(i, a, 0.18), e = ringAt(i, a, -0.04);
          const mid = V3((p1.x + q.x) / 2, (p1.y + q.y) / 2 + 0.35, (p1.z + q.z) / 2);
          cable(batcher, M.plaster, m, [p0, p1, V3(p1.x, p1.y + 0.3, p1.z + 0.04), mid, q, e], 0.024);
        });
      }
    });
    panelFrames.forEach((F, i) => {
      const j = L(F, kit.jbox), n = L(capFrames[i], kit.termN.clone().add(V3(0.06, 0.012, 0)));
      const up = V3(n.x, n.y + 0.12, n.z + 0.25);
      let pts;
      if (i === 1) {
        pts = [j, V3(j.x + 0.01, deckY + 0.8, -edge - 0.07), V3(-0.62, deckY + 0.1, -edge - 0.05), V3(-0.64, deckY + 0.15, -1.5), V3(-0.68, deckY + 0.6, -2.2), up, n];
      } else {
        // Under the end's top rail to the corner post, down its outside, and along the -z toe board.
        const sx = Math.sign(j.x), ex = sx * (dl + 0.012), pz = -edge - 0.035;
        pts = [j, V3(ex, deckY + 1.02, j.z * 0.5), V3(ex, deckY + 1.02, -edge + 0.1), V3(ex, deckY + 0.9, pz), V3(ex, deckY + 0.15, pz),
          V3(sx * (dl - 0.2), deckY + 0.1, pz - 0.005), V3(sx * (capX + 0.3), deckY + 0.1, pz - 0.01), V3(sx * (capX + 0.15), deckY + 0.45, -1.1), up, n];
      }
      cable(batcher, M.plaster, m, pts, 0.006);
    });
  }

  // ---- Sliders: nine in one instanced mesh (one draw call, gone beyond 55 m), and one invisible hit area over each
  // box's panel. A press moves the slider in the column you aim at one notch toward your aim: above its grip's
  // middle, up; below, down. At the end of its travel it goes back toward the centre, so every press moves it.
  const state = ctx.state.towerSwitches = swFrames.map(() => ['center', 'center', 'center']);
  const offset = (v) => (1 - TOWER_SWITCH_POS.indexOf(v)) * SWB.travel;
  const sliders = new THREE.InstancedMesh(kit ? kit.slider : new THREE.BoxGeometry(0.042, 0.03, 0.026).translate(0, 0, 0.021), kit ? kit.mat : M.darkMetal, 9);
  sliders.name = 'tower-switches';
  sliders.receiveShadow = true;
  const boxW = swFrames.map((F) => m.clone().multiply(F));          // box frame to world
  const boxInv = boxW.map((B) => B.clone().invert());
  const colX = (j) => (j - 1) * SWB.pitch;
  const cur = new Float32Array(9), _mm = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
  const setSlider = (k) => sliders.setMatrixAt(k, _mm.copy(boxW[Math.floor(k / 3)]).multiply(mat4(colX(k % 3), SWB.midY + cur[k], SWB.face)));
  const gripAt = (b, j) => new THREE.Vector3(colX(j), SWB.midY + offset(state[b][j]), SWB.face + 0.021).applyMatrix4(boxW[b]);
  // Where the view ray crosses the grips' mid-depth, in the box's frame (null if it runs along the face).
  const aimAt = (b) => {
    const cam = ctx.camera;
    if (!cam) return null;
    cam.getWorldPosition(_o).applyMatrix4(boxInv[b]);
    cam.getWorldDirection(_d).transformDirection(boxInv[b]);
    if (_d.z > -0.05) return null;
    return _o.addScaledVector(_d, (SWB.face + 0.021 - _o.z) / _d.z);
  };
  const hitGeo = new THREE.BoxGeometry(0.25, 0.17, 0.04), hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const items = boxW.map((B, b) => {
    for (let j = 0; j < 3; j++) { cur[b * 3 + j] = offset(state[b][j]); setSlider(b * 3 + j); }
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.matrixAutoUpdate = false;
    hit.matrix.copy(B).multiply(mat4(0, SWB.midY, SWB.face + 0.02));
    hit.name = 'tower-switches-hit-' + b;
    ctx.surface.add(hit);
    hit.updateMatrixWorld(true);
    return ctx.interact.add({
      name: 'tower-switches:' + b, meshes: [hit], range: 2.2, exact: true,
      onPress: () => {
        const p = aimAt(b);
        if (!p) return;
        const j = THREE.MathUtils.clamp(Math.round(p.x / SWB.pitch) + 1, 0, 2);
        const i = TOWER_SWITCH_POS.indexOf(state[b][j]);
        let n = i + (p.y > SWB.midY + offset(state[b][j]) ? -1 : 1);
        if (n < 0 || n > 2) n = 1;
        set(b, j, TOWER_SWITCH_POS[n]);
        ctx.audio?.play('click', { pos: gripAt(b, j) });
        ctx.onTowerSwitches?.(state);
      },
    });
  });
  sliders.instanceMatrix.needsUpdate = true;
  sliders.computeBoundingSphere();
  ctx.surface.add(sliders);
  // (Its bounds span the whole catwalk: this hides it from the ground, like the boxes.)
  ctx.lod?.add(sliders, { out: [22, 26], name: 'tower-switches' });
  let moving = false;
  const set = (b, j, v) => { if (TOWER_SWITCH_POS.includes(v)) { state[b][j] = v; moving = true; } };
  ctx.updaters.push((dt) => {
    if (!moving) return;
    moving = false;
    for (let k = 0; k < 9; k++) {
      const t = offset(state[Math.floor(k / 3)][k % 3]), d = t - cur[k];
      if (d === 0) continue;
      // A quick ease into the detent.
      cur[k] = Math.abs(d) < 0.0005 ? t : cur[k] + d * Math.min(1, dt * 20);
      moving ||= cur[k] !== t;
      setSlider(k);
    }
    sliders.instanceMatrix.needsUpdate = true;
  });
  // For puzzles: set(box, switch, 'top' | 'center' | 'bottom') moves a slider without the click or the hook.
  ctx.towerSwitches = { set, items, gripAt };
  return { leds };
}
