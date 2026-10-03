import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials, patchMaterial } from '../render/materials.js';
import { makeRockGeometry } from './features.js';
import { noise2, Rng } from '../core/rng.js';

// Where the Rocks boulders have to go (world/rockPuzzle.js), marked on the ground once rocks.exe has blown the tor:
// a patch of bare earth at each target, as if the blast had scoured them, so the puzzle is a matter of pushing each
// boulder onto a patch rather than matching the constellation by eye. Each patch follows the ground, its turf torn
// back round a ragged edge, darker where the soil was turned, a few loose stones on it, a little larger than a boulder;
// the grass and flowers that grew there go with it.
//
// Before the blast there is nothing (the meshes are built and drawn once, unseen, so their shaders are ready). reveal()
// brings them in: after `delay` s fading in over FADE s as the blast's dust settles (rockThrow's launch), or at once
// (a saved game after the blast: releaseInstant). Two draw calls (the earth, the stones), no collision.

const R = 2.3;      // the bare earth's radius (the catch is 2.5 m; a boulder's footprint about 1.2-1.6 m)
const EDGE = 0.55;  // how far the torn edge reaches past it
const FADE = 2.5;

function alphaTexture() {
  const N = 256, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1;
    const r = Math.hypot(x, y), a = Math.atan2(y, x);
    // a ragged rim: the edge wanders with angle, and a few tongues of torn turf reach in
    const rim = R / (R + EDGE) * (0.97 + 0.07 * Math.sin(a * 5 + 1.3) + 0.05 * Math.sin(a * 11 + 0.4) + 0.04 * noise2(Math.cos(a) * 3, Math.sin(a) * 3, 71));
    const v = Math.min(1, Math.max(0, (rim - r) / 0.09 + 0.5));
    const k = (j * N + i) * 4;
    data[k] = data[k + 1] = data[k + 2] = Math.round(v * 255);
    data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// targets: [{ x, z }] (world). Returns { reveal({ delay, instant }), revealed(), meshes }.
export function createTargetMarks(ctx, stack, targets) {
  const M = materials();
  const RINGS = 12, SEGS = 48, Rmax = R + EDGE;
  const earthGeos = [], stoneGeos = [];
  const rng = new Rng(4242);
  const dirt = new THREE.Color(0.115, 0.085, 0.058), turned = new THREE.Color(0.072, 0.054, 0.038), dry = new THREE.Color(0.17, 0.135, 0.095);
  const c = new THREE.Color();
  for (const [ti, t] of targets.entries()) {
    const pos = [], uv = [], uv1 = [], col = [], idx = [];
    for (let r = 0; r <= RINGS; r++) {
      const rr = (r / RINGS) * Rmax;
      const n = r === 0 ? 1 : SEGS;
      for (let s = 0; s < n; s++) {
        const a = (s / SEGS) * Math.PI * 2;
        const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
        const x = t.x + lx, z = t.z + lz;
        const y = (stack.heightAt(x, z) ?? 0) + 0.02;
        pos.push(x, y, z);
        uv.push(x * 0.22, z * 0.22);                       // the cap's own tiling, so the earth has its grain
        uv1.push(0.5 + lx / (2 * Rmax), 0.5 + lz / (2 * Rmax));
        // bare earth, darker in a ring where the turf was turned back, paler scuffs
        const ring = Math.exp(-(((rr - R * 0.92) / 0.35) ** 2));
        const scuff = Math.max(0, noise2(x * 0.9, z * 0.9, 80 + ti));
        c.copy(dirt).lerp(turned, ring * 0.8).lerp(dry, scuff * 0.45);
        const v = 0.92 + 0.16 * noise2(x * 3.1, z * 3.1, 90 + ti);
        col.push(c.r * v, c.g * v, c.b * v);
      }
    }
    const ringStart = (r) => (r === 0 ? 0 : 1 + (r - 1) * SEGS);
    for (let s = 0; s < SEGS; s++) idx.push(0, ringStart(1) + ((s + 1) % SEGS), ringStart(1) + s);
    for (let r = 1; r < RINGS; r++) {
      for (let s = 0; s < SEGS; s++) {
        const a = ringStart(r) + s, b = ringStart(r) + ((s + 1) % SEGS), c2 = ringStart(r + 1) + s, d = ringStart(r + 1) + ((s + 1) % SEGS);
        idx.push(a, b, c2, b, d, c2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    earthGeos.push(g);
    // a few loose stones on it, half sunk
    for (let k = 0; k < 7; k++) {
      const a = rng.float(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * R * 0.95, s = rng.float(0.05, 0.14);
      const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
      const sg = makeRockGeometry(700 + ti * 10 + k, 1).toNonIndexed();
      sg.scale(s, s * 0.6, s * rng.float(0.8, 1.3));
      sg.rotateY(rng.float(0, Math.PI * 2));
      sg.translate(x, (stack.heightAt(x, z) ?? 0) + s * 0.15, z);
      for (const key of Object.keys(sg.attributes)) if (key !== 'position' && key !== 'normal') sg.deleteAttribute(key);
      sg.computeVertexNormals();
      stoneGeos.push(sg);
    }
  }
  const alpha = alphaTexture();
  alpha.channel = 1;
  const earthMat = patchMaterial(new THREE.MeshStandardMaterial({
    name: 'rock-target-earth', map: M.cap.map, vertexColors: true, alphaMap: alpha, transparent: true, opacity: 0, depthWrite: false,
    roughness: 1, metalness: 0, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  const earth = new THREE.Mesh(mergeGeometries(earthGeos), earthMat);
  earth.name = 'rock-targets';
  earth.receiveShadow = true;
  earth.renderOrder = 1;
  const stoneMat = patchMaterial(new THREE.MeshStandardMaterial({ name: 'rock-target-stones', color: 0x5f5a54, roughness: 0.95, transparent: true, opacity: 0 }));
  const stones = new THREE.Mesh(mergeGeometries(stoneGeos), stoneMat);
  stones.name = 'rock-target-stones';
  stones.castShadow = false; stones.receiveShadow = true;
  ctx.surface.add(earth, stones);

  let shown = false, t0 = 0, clock = 0, cleared = false;
  // the grass and flowers on a patch go when it shows (trees stand clear of the targets anyway, and keep their colliders)
  const inPatch = (x, z) => targets.some((t) => (x - t.x) ** 2 + (z - t.z) ** 2 < (R * 0.95) ** 2);
  const clearFlora = () => {
    if (cleared) return;
    cleared = true;
    ctx.lod?.hideInstancesWhere?.((x, y, z) => inPatch(x, z), (name) => !name.startsWith('trees:'));
  };
  // (visible at build so the preload draws and compiles them; hidden from the first frame until revealed)
  ctx.updaters.push((dt) => {
    clock += dt;
    const k = !shown ? 0 : Math.min(1, Math.max(0, (clock - t0) / FADE));
    earth.visible = stones.visible = k > 0;
    earthMat.opacity = k;
    stoneMat.opacity = k;
    stoneMat.transparent = k < 1;
    if (k > 0.3) clearFlora();
  });
  return {
    meshes: [earth, stones],
    revealed: () => shown,
    reveal({ delay = 0, instant = false } = {}) {
      if (shown) return;
      shown = true;
      t0 = instant ? clock - FADE : clock + delay;
      if (instant) clearFlora();
    },
  };
}
