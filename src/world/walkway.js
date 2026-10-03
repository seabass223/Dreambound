import * as THREE from 'three';
import { GLTFLoader } from '../render/gltf.js';
import { patchMaterial } from '../render/materials.js';
import { Rng, noise2 } from '../core/rng.js';

// Limestone stepping stones laid along a path over a stack's cap (the Home stack's, from the trail at the dome door
// round the dome to the deck track: world/stacks/dome.js; the Rocks stack's, from the creek to the petroglyph:
// world/stacks/rocks.js). The stones are modelled in Blender
// (tools/blender/walkstone_design.py: seven weathered flags, big to small, with a seamless limestone tile: albedo, normal
// and roughness, worn smooth on top so they catch a little light). Here they're laid one after another with grass
// between, meandering a little either side of the line, each turned its own way, now and then a small one beside a
// big one, nearly flush with the ground and tilted with it; over the last few metres they get smaller and further
// apart, running out into the deck track. All in the stack's batch: one draw call.

const FILES = { albedo: 'walkstone_albedo.png', normal: 'walkstone_normal.png', rough: 'walkstone_rough.png' };

export async function loadWalkstones() {
  const base = import.meta.env.BASE_URL + 'models/';
  const tl = new THREE.TextureLoader();
  const keys = Object.keys(FILES);
  const [gltf, ...tex] = await Promise.all([new GLTFLoader().loadAsync(base + 'walkstone.glb'), ...keys.map((k) => tl.loadAsync(base + FILES[k]))]);
  const T = Object.fromEntries(keys.map((k, i) => [k, tex[i]]));
  for (const [k, t] of Object.entries(T)) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;                                    // (UVs are the stones' own: metres across their tops)
    t.colorSpace = k === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
  }
  return { gltf, ...T };
}

let material = null;
function stoneMaterial(asset) {
  // Worn limestone: its roughness map runs from a smooth, faintly glossy top to rough pits and lichen.
  return (material ||= patchMaterial(new THREE.MeshStandardMaterial({
    name: 'walkstone', vertexColors: true, map: asset.albedo, normalMap: asset.normal, normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: asset.rough, roughness: 1, metalness: 0, envMapIntensity: 0.9,
  })));
}

// The seven stones, as { geo, r (their mean reach) }, biggest first.
function variants(asset) {
  const out = [];
  asset.gltf.scene.updateMatrixWorld(true);
  asset.gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const lay = o.userData?.layer ?? o.name.split('@')[1] ?? '';
    const k = /^s(\d+)$/.exec(lay);
    if (!k) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', o.geometry.attributes.position.clone());
    g.setAttribute('normal', o.geometry.attributes.normal.clone());
    g.setAttribute('uv', o.geometry.attributes.uv.clone());
    // Colours as plain floats (the export may pack them), three per vertex.
    const src = o.geometry.attributes.color, n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = src ? src.getX(i) : 1; c[i * 3 + 1] = src ? src.getY(i) : 1; c[i * 3 + 2] = src ? src.getZ(i) : 1; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setIndex(o.geometry.index.clone());
    g.applyMatrix4(o.matrixWorld);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    out[+k[1]] = { geo: g, r: ((bb.max.x - bb.min.x) + (bb.max.z - bb.min.z)) / 4 };
  });
  return out.filter(Boolean);
}

// Returns { on(x, z, margin): on (or within margin of) a stone, stones: [{ x, z, r }] }.
// keepOff: { x, z, r }: no stone's centre nearer than r to (x, z) (the dome's curb); one that would be is pushed out.
// skip(x, z): true leaves a stone out there (on rock, in the water).
export function buildWalkway(stack, path, batcher, asset, { fade = 6, seed = 1, keepOff = null, skip = null } = {}) {
  const none = { on: () => false, stones: [] };
  if (!asset?.gltf) return none;
  const V = variants(asset);
  if (!V.length) return none;
  const mat = stoneMaterial(asset);
  const rng = new Rng(seed);
  const stones = [];
  const ground = (x, z) => stack.heightAt(x, z) ?? stack.heightAtAnalytic(x, z);
  const tx = new THREE.Vector3(), tz = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Matrix4(), q = new THREE.Quaternion();
  const m = new THREE.Matrix4(), e = new THREE.Euler(), sv = new THREE.Vector3(), at = new THREE.Vector3();
  const pick = (weights) => { let s = weights.reduce((a, w) => a + w, 0) * rng.next(); for (let i = 0; i < weights.length; i++) if ((s -= weights[i]) <= 0) return i; return weights.length - 1; };

  const lay = (vi, x, z, sc, yaw) => {
    const v = V[Math.min(vi, V.length - 1)];
    if (keepOff) {
      const dx = x - keepOff.x, dz = z - keepOff.z, d = Math.hypot(dx, dz);
      if (d < keepOff.r) { x = keepOff.x + (dx / d) * keepOff.r; z = keepOff.z + (dz / d) * keepOff.r; }
    }
    if (skip?.(x, z)) return;
    // The ground's tilt under it, from four samples.
    const s = 0.3, ca = Math.cos(yaw), sa = Math.sin(yaw);
    tx.set(ca * 2 * s, ground(x + ca * s, z - sa * s) - ground(x - ca * s, z + sa * s), -sa * 2 * s).normalize();
    tz.set(sa * 2 * s, ground(x + sa * s, z + ca * s) - ground(x - sa * s, z - ca * s), ca * 2 * s).normalize();
    n.crossVectors(tz, tx).normalize();
    tz.crossVectors(tx, n).normalize();
    b.makeBasis(tx, n, tz);
    q.setFromRotationMatrix(b).multiply(new THREE.Quaternion().setFromEuler(e.set(rng.float(-0.02, 0.02), 0, rng.float(-0.02, 0.02))));
    // Settled in: the rim at the ground or just proud of it, the domed top 1.5-2.5 cm over it (any lower and the grass-
    // coloured ground swallows all but the crown, and they read as pale chips).
    at.set(x, ground(x, z) + rng.float(0.002, 0.01), z);
    m.compose(at, q, sv.set(sc, sc * rng.float(0.9, 1.1), sc));
    const g = v.geo.clone();
    const uv = g.attributes.uv, du = rng.next(), dv = rng.next();
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
    const c = g.attributes.color, k = rng.float(0.5, 0.7), warm = rng.float(0.97, 1.04);
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * k * warm, c.getY(i) * k, c.getZ(i) * k * (2 - warm));
    batcher.add(g, mat, m);
    stones.push({ x, z, r: v.r * sc });
  };

  const fadeFrom = path.total - fade;
  let t = 0.25;
  while (t < path.total - 0.2) {
    const f = t > fadeFrom ? (t - fadeFrom) / fade : 0;   // 0 .. 1 over the run-out
    const vi = f > 0 ? pick([0, 1, 2, 3, 3, 3, 2]) : pick([3, 3, 3, 3, 2, 1, 0.5]);
    const sc = rng.float(0.9, 1.12) * (1 - 0.25 * f);
    const reach = V[Math.min(vi, V.length - 1)].r * sc * 0.9;
    const tc = t + reach;
    const p = path.pointAt(tc), len = Math.hypot(p.dx, p.dz) || 1;
    const dx = p.dx / len, dz = p.dz / len, sx = dz, sz = -dx;
    // A little either side of the line, slowly, and a little more at random.
    const off = 0.3 * noise2(tc * 0.22, 0.5, seed + 3) + rng.float(-0.1, 0.1);
    lay(vi, p.x + sx * off, p.z + sz * off, sc, Math.atan2(dx, dz) + rng.float(-0.8, 0.8));
    // Now and then a small one beside it.
    if (f < 0.5 && rng.next() < 0.2) {
      const vj = pick([0, 0, 0, 0, 1, 2, 2]), sj = rng.float(0.85, 1.05), side = off > 0 ? -1 : 1;
      const o2 = off + side * (reach + V[Math.min(vj, V.length - 1)].r * sj + rng.float(0.05, 0.14)), a2 = rng.float(-0.15, 0.15);
      lay(vj, p.x + sx * o2 + dx * a2, p.z + sz * o2 + dz * a2, sj, rng.float(0, Math.PI * 2));
    }
    // Grass between them, a stride or so; now and then a longer gap (a stone sunk out of sight); wider toward the end.
    const gap = rng.next() < 0.14 ? rng.float(0.7, 1.1) : rng.float(0.24, 0.52);
    t = tc + reach + gap * (1 + 1.4 * f);
  }

  return {
    stones,
    on(x, z, margin = 0.05) {
      for (const s of stones) if ((x - s.x) ** 2 + (z - s.z) ** 2 < (s.r + margin) ** 2) return true;
      return false;
    },
  };
}
