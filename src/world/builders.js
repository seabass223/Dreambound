import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export function mat4(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _s.set(sx, sy, sz));
}

// Normalizes a geometry so everything in a batch shares position/normal/uv/color and is indexed.
function normalize(geo, color) {
  const g = geo;
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.color) {
    const c = new Float32Array(n * 3);
    const col = color || new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  } else if (g.attributes.color.itemSize === 4) {
    const src = g.attributes.color, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = src.getX(i); c[i * 3 + 1] = src.getY(i); c[i * 3 + 2] = src.getZ(i); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  // Force a uniform index type across the batch.
  if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
  g.clearGroups();
  return g;
}

// Collects static geometry and merges it into one mesh per material.
export class Batcher {
  constructor() { this.groups = new Map(); }

  add(geo, material, matrix = null, color = null) {
    const g = normalize(geo.clone(), color && new THREE.Color(color));
    if (matrix) g.applyMatrix4(matrix);
    if (!this.groups.has(material)) this.groups.set(material, []);
    this.groups.get(material).push(g);
    return g;
  }

  build(parent, { cast = true, receive = true, name = 'batch' } = {}) {
    const meshes = [];
    for (const [material, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      mesh.name = name;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}

// Collects invisible world-space collision geometry and builds a BVH for it.
export class ColliderBuilder {
  constructor(name) { this.name = name; this.geos = []; }

  addGeometry(geo, matrix = null) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position.clone());
    if (geo.index) g.setIndex(geo.index.clone());
    if (matrix) g.applyMatrix4(matrix);
    if (g.index) g = g.toNonIndexed();
    this.geos.push(g);
  }

  addBox(x, y, z, w, h, d, ry = 0) {
    this.addGeometry(new THREE.BoxGeometry(w, h, d), mat4(x, y, z, ry));
  }

  // Open cylinder wall (optionally with an angular gap), axis vertical, base at y.
  addCylinder(x, y, z, r, h, segs = 12, thetaStart = 0, thetaLength = Math.PI * 2, capped = false) {
    const g = new THREE.CylinderGeometry(r, r, h, segs, 1, !capped, thetaStart, thetaLength);
    this.addGeometry(g, mat4(x, y + h / 2, z));
  }

  build() {
    if (!this.geos.length) return null;
    let merged = mergeGeometries(this.geos, false);
    merged = mergeVertices(merged, 1e-3);
    const bvh = new MeshBVH(merged, { targetLeafSize: 8 });
    merged.computeBoundingBox();
    return { name: this.name, bvh, geometry: merged, box: merged.boundingBox.clone().expandByScalar(4) };
  }
}

// Merge a list of { geo, matrix, color } parts into one normalized geometry.
export function mergeParts(parts) {
  const geos = parts.map(({ geo, matrix, color }) => {
    const g = normalize(geo.clone(), color && new THREE.Color(color));
    if (matrix) g.applyMatrix4(matrix);
    return g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}
