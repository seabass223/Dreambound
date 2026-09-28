import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { materials, foliageMaterial, patchMaterial } from '../render/materials.js';
import { Textures } from '../render/textures.js';
import { mergeParts, mat4 } from './builders.js';
import { InstancedLod } from '../render/lod.js';

// Bend foliage normals outward from the crown so alpha cards shade like a volume.
function roundNormals(geo, cy, upBias = 0.35) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i) - cy, p.getZ(i)).normalize();
    v.y += upBias;
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
}

function pine(seed, lo = false) {
  const r = new Rng(seed);
  const H = 12;
  const trunk = [];
  trunk.push({ geo: new THREE.CylinderGeometry(0.07, 0.3, H, lo ? 4 : 7, lo ? 1 : 4), matrix: mat4(0, H / 2, 0) });
  if (!lo) trunk.push({ geo: new THREE.CylinderGeometry(0.3, 0.45, 0.6, 7), matrix: mat4(0, 0.3, 0) });
  const cards = [];
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, -0.5, 0); // hinge at the top edge
  for (let y = 2.4; y < H - 0.3; y += lo ? r.float(1.3, 1.6) : r.float(0.45, 0.65)) {
    const f = (y - 2.6) / (H - 2.6);
    const len = (3.2 * (1 - f) + 0.6) * (lo ? 1.12 : 1);
    const n = lo ? Math.round(4 + (1 - f) * 2) : Math.round(7 + (1 - f) * 4);
    const off = r.float(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + r.float(-0.2, 0.2);
      const droop = r.float(0.95, 1.25);
      const m = mat4(0, y, 0, a, 1, 1, 1, 0, 0);
      const local = new THREE.Matrix4().makeScale(len * (lo ? 1.1 : 0.75), len, 1).premultiply(new THREE.Matrix4().makeRotationX(-droop));
      m.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(local);
      cards.push({ geo: card, matrix: m });
    }
  }
  // Leader at the top.
  for (let i = 0; i < 2; i++) cards.push({ geo: card, matrix: mat4(0, H + 0.6, 0, i * Math.PI / 2, 1.0, 1.6, 1) });
  const fol = mergeParts(cards);
  roundNormals(fol, H * 0.45, 0.4);
  return { trunk: mergeParts(trunk), foliage: fol, height: H, radius: 0.3, map: 'needles' };
}

function broadleaf(seed, lo = false) {
  const r = new Rng(seed);
  const H = 7.5;
  const trunk = [];
  const clusters = [];
  trunk.push({ geo: new THREE.CylinderGeometry(0.16, 0.26, H * 0.75, 7, 3), matrix: mat4(0, H * 0.375, 0) });
  const quad = new THREE.PlaneGeometry(1.25, 1.25);
  const nB = 6;
  for (let b = 0; b < nB; b++) {
    const a = (b / nB) * Math.PI * 2 + r.float(-0.3, 0.3);
    const y0 = H * r.float(0.35, 0.65);
    const len = r.float(1.8, 2.9);
    const tilt = r.float(0.6, 1.0);
    const ex = Math.cos(a) * Math.sin(tilt) * len, ez = -Math.sin(a) * Math.sin(tilt) * len, ey = Math.cos(tilt) * len;
    const mid = new THREE.Vector3(ex / 2, y0 + ey / 2, ez / 2);
    if (!lo) trunk.push({ geo: new THREE.CylinderGeometry(0.04, 0.1, len, 5), matrix: mat4(mid.x, mid.y, mid.z, a, 1, 1, 1, 0, -tilt).premultiply(new THREE.Matrix4()) });
    clusters.push(new THREE.Vector3(ex, y0 + ey + 0.3, ez));
    clusters.push(new THREE.Vector3(ex * 0.55, y0 + ey * 0.6 + 0.4, ez * 0.55));
  }
  clusters.push(new THREE.Vector3(0, H * 0.95, 0), new THREE.Vector3(0.5, H * 0.8, -0.4));
  const leaves = [];
  for (const c of clusters) {
    const n = lo ? 8 : 11;
    const k = lo ? 1.35 : 1;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(r.float(-1, 1), r.float(-0.7, 0.8), r.float(-1, 1)).normalize().multiplyScalar(r.float(0.3, 1.25));
      leaves.push({ geo: quad, matrix: mat4(c.x + p.x, c.y + p.y, c.z + p.z, r.float(0, 6.28), r.float(0.8, 1.3) * k, r.float(0.8, 1.3) * k, 1, r.float(-1, 1), r.float(-0.6, 0.6)) });
    }
  }
  const fol = mergeParts(leaves);
  roundNormals(fol, H * 0.62, 0.3);
  return { trunk: mergeParts(trunk), foliage: fol, height: H, radius: 0.26, map: 'leaves' };
}

function shrub(seed) {
  const r = new Rng(seed);
  const quad = new THREE.PlaneGeometry(0.9, 0.9);
  const leaves = [];
  for (let i = 0; i < 16; i++) {
    const p = new THREE.Vector3(r.float(-1, 1), r.float(0, 1), r.float(-1, 1)).multiplyScalar(0.7);
    leaves.push({ geo: quad, matrix: mat4(p.x, 0.45 + p.y * 0.6, p.z, r.float(0, 6.28), r.float(0.8, 1.2), 1, 1, r.float(-0.8, 0.8)) });
  }
  const fol = mergeParts(leaves);
  roundNormals(fol, 0.2, 0.5);
  const trunk = mergeParts([{ geo: new THREE.CylinderGeometry(0.03, 0.05, 0.5, 4), matrix: mat4(0, 0.25, 0) }]);
  return { trunk, foliage: fol, height: 1.2, radius: 0, map: 'leaves' };
}

// Trees swap to a stand-in with a quarter of the cards across FAR; shrubs just fade out across SHRUB.
const FAR = [100, 130], SHRUB = [45, 65];
const SPECIES = {
  pine: { make: () => pine(3), makeLo: () => pine(3, true), sway: 0.0011, flutter: 0.004, tint: 0xd8e8d0 },
  broadleaf: { make: () => broadleaf(7), makeLo: () => broadleaf(7, true), sway: 0.002, flutter: 0.012, tint: 0xffffff },
  shrub: { make: () => shrub(9), sway: 0.05, flutter: 0.02, tint: 0xe0f0c8 },
};

// Collects tree placements from every stack, then builds one level-of-detail set per species: full trees (which
// cast shadows) near the camera, low-card stand-ins further out, cross-faded.
export class Forest {
  constructor() {
    this.items = { pine: [], broadleaf: [], shrub: [] };
    this.rng = new Rng(404);
  }

  add(species, x, y, z, scale = 1, rotY = this.rng.float(0, Math.PI * 2)) {
    this.items[species].push({ x, y, z, scale, rotY });
  }

  radiusOf(species) { return species === 'pine' ? 0.3 : species === 'broadleaf' ? 0.26 : 0; }

  // The foliage's reach at scale 1: for each 0.5 m of height, the widest the crown gets there (from the actual cards,
  // plus a margin for the sway), as [{ y0, y1, r }]. For keeping crowns clear of things, e.g. the dome's glass.
  footprint(species) {
    const cache = (this._footprints ||= {});
    if (cache[species]) return cache[species];
    const p = SPECIES[species].make().foliage.attributes.position, bands = [];
    for (let i = 0; i < p.count; i++) {
      const k = Math.max(0, Math.floor(p.getY(i) / 0.5)), r = Math.hypot(p.getX(i), p.getZ(i));
      bands[k] = Math.max(bands[k] ?? 0, r);
    }
    return (cache[species] = bands.map((r, k) => ({ y0: k * 0.5, y1: k * 0.5 + 0.5, r: r + 0.25 })).filter((b) => b.r > 0));
  }

  build(parent, lod) {
    const M = materials();
    const dummy = new THREE.Object3D();
    for (const [name, list] of Object.entries(this.items)) {
      if (!list.length) continue;
      const sp = SPECIES[name];
      const g = sp.make();
      const map = Textures[g.map]();
      const folMat = foliageMaterial(map, sp.sway, sp.flutter, sp.tint);
      folMat.alphaToCoverage = true;
      const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45 });
      const matrices = new Float32Array(list.length * 16), colors = new Float32Array(list.length * 3);
      list.forEach((t, i) => {
        dummy.position.set(t.x, t.y - 0.1, t.z);
        dummy.rotation.set(0, t.rotY, 0);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        dummy.matrix.toArray(matrices, i * 16);
        const h = this.rng.float(0.8, 1.15);
        colors.set([h * this.rng.float(0.92, 1.05), h, h * this.rng.float(0.85, 1.0)], i * 3);
      });
      const parts = (t) => [{ geometry: t.trunk, material: M.bark }, { geometry: t.foliage, material: folMat, colored: true }];
      const levels = sp.makeLo
        ? [{ parts: parts(g), out: FAR, castShadow: true }, { parts: parts(sp.makeLo()), in: FAR, castShadow: false, receiveShadow: false }]
        : [{ parts: parts(g), out: SHRUB, castShadow: true }];
      const il = lod.addInstanced(new InstancedLod(parent, { name: 'trees:' + name, matrices, colors, levels, step: 6, cell: 48 }));
      il.levels[0].meshes[1].customDepthMaterial = depthMat;
    }
  }
}

// Instanced grass tufts that fade out with distance from the camera; only the tufts within reach are drawn.
export class Meadow {
  constructor() { this.items = []; this.rng = new Rng(77); }

  add(x, y, z, s = 1) { this.items.push(x, y, z, s); }

  build(parent, lod) {
    const n = this.items.length / 4;
    if (!n) return;
    const tex = Textures.grass();
    const q1 = new THREE.PlaneGeometry(0.7, 0.5); q1.translate(0, 0.25, 0);
    const q2 = q1.clone().rotateY(Math.PI / 2);
    const q3 = q1.clone().rotateY(Math.PI / 4);
    const geo = mergeParts([{ geo: q1 }, { geo: q2 }, { geo: q3 }]);
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: 0xb8c49a, envMapIntensity: 0.5 });
    mat.alphaToCoverage = true;
    patchMaterial(mat, { wind: { sway: 0.5, flutter: 0.01 }, fadeDist: 48 });
    const dummy = new THREE.Object3D();
    const matrices = new Float32Array(n * 16), colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [x, y, z, s] = this.items.slice(i * 4, i * 4 + 4);
      dummy.position.set(x, y - 0.03, z);
      dummy.rotation.set(0, this.rng.float(0, 6.28), 0);
      dummy.scale.set(s, s * this.rng.float(0.7, 1.3), s);
      dummy.updateMatrix();
      dummy.matrix.toArray(matrices, i * 16);
      const k = this.rng.float(0.7, 1.15);
      colors.set([k * this.rng.float(0.9, 1.2), k, k * 0.85], i * 3);
    }
    // The material fades the tufts out by 48 m on its own; beyond that they aren't drawn at all.
    return lod.addInstanced(new InstancedLod(parent, {
      name: 'grass', matrices, colors, step: 4, cell: 16,
      levels: [{ parts: [{ geometry: geo, material: mat, colored: true }], max: 50, zoom: false, castShadow: false }],
    }));
  }
}

// Tall seeding grass, 0.6-1.1 m: three crossed cards per clump that bend much harder in the wind than the tufts.
// Like the tufts they fade out on their own (by TALL_FAR m) and aren't drawn past it, cast no shadows and have no collision.
const TALL_FAR = 55;
export class TallGrass {
  constructor() { this.items = []; this.rng = new Rng(91); }

  // h: height in metres; gold: 0 green to 1 ripe straw.
  add(x, y, z, h = 0.9, gold = 0.5) { this.items.push(x, y, z, h, gold); }

  build(parent, lod) {
    const n = this.items.length / 5;
    if (!n) return;
    const tex = Textures.tallGrass();
    // A unit-tall clump; two rows of quads up each card so the bend curves.
    const cards = [0, 1, 2].map((k) => {
      const q = new THREE.PlaneGeometry(1.05, 1, 1, 2);
      q.translate(0, 0.5, 0);
      return { geo: q.rotateY((k * Math.PI) / 3) };
    });
    const geo = mergeParts(cards);
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    // Lambert: about half the cost of standard shading here, and fill is what tall cards cost.
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xa9a58f });
    mat.alphaToCoverage = true;
    // Both faces keep the upward normal: a flipped back face would light the clump from below and turn it dark.
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;');
    };
    // The tip moves 0.3 m per unit of wind push (a gust is about 1.5), 2.4x the tufts'. Dithered out across 41-55 m.
    const far = TALL_FAR;
    patchMaterial(mat, { wind: { sway: 0.3 }, fadeDist: far });
    const key = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => key() + '|up';
    const dummy = new THREE.Object3D();
    const matrices = new Float32Array(n * 16), colors = new Float32Array(n * 3);
    const green = [0.84, 0.96, 0.7], straw = [1.08, 0.96, 0.7];
    for (let i = 0; i < n; i++) {
      const [x, y, z, h, gold] = this.items.slice(i * 5, i * 5 + 5);
      dummy.position.set(x, y - 0.04, z);
      dummy.rotation.set(0, this.rng.float(0, 6.28), 0);
      const w = h * this.rng.float(0.85, 1.25);
      dummy.scale.set(w, h, w);
      dummy.updateMatrix();
      dummy.matrix.toArray(matrices, i * 16);
      const k = this.rng.float(0.8, 1.1);
      for (let c = 0; c < 3; c++) colors[i * 3 + c] = k * (green[c] + (straw[c] - green[c]) * gold);
    }
    return lod.addInstanced(new InstancedLod(parent, {
      name: 'tallgrass', matrices, colors, step: 4, cell: 16,
      levels: [{ parts: [{ geometry: geo, material: mat, colored: true }], max: far + 2, zoom: false, castShadow: false }],
    }));
  }
}
