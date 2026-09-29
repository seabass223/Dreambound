import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from './materials.js';

// Distance culling and smooth level-of-detail for the whole world (what Unity calls LOD groups with cross-fade).
//
// Three.js already frustum-culls every object against the camera's field of view; this adds distance. Each
// registered object has distance bands in metres: it fades in across `in` and out across `out`. While any of
// it is inside a band its meshes switch to a dithered variant of their material that discards a growing share
// of pixels by distance (a screen-door fade, no transparency sorting). Once it's fully out it's hidden, so it
// costs no draw calls. A cheaper stand-in that fades in over the same band the detailed version fades out
// over gives a seamless cross-fade: the two dither patterns are exact complements.
//
// Distances are "effective": scaled by the camera's zoom relative to the normal field of view, so the telescope
// (a 3 degree view) sees the full-detail level of things hundreds of metres away, just as screen size would.

export const LOD_REF_FOV = 68;
const lodScale = { value: 1 };

export function lodScaleFor(camera) {
  return Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(LOD_REF_FOV) / 2);
}

const NO_IN = [-2, -1], NO_OUT = [1e7, 2e7];

function injectFade(sh, band) {
  sh.uniforms.uLodBand = band;
  sh.uniforms.uLodScale = lodScale;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLodW;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 lodP = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        lodP = batchingMatrix * lodP;
      #endif
      #ifdef USE_INSTANCING
        lodP = instanceMatrix * lodP;
      #endif
        vLodW = ( modelMatrix * lodP ).xyz; }`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLodW;\nuniform vec4 uLodBand;\nuniform float uLodScale;')
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { float lodD = distance( vLodW, cameraPosition ) * uLodScale;
        float lodT = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
        if ( smoothstep( uLodBand.x, uLodBand.y, lodD ) < 1.0 - lodT ) discard;
        if ( 1.0 - smoothstep( uLodBand.z, uLodBand.w, lodD ) <= lodT ) discard; }`);
}

const variants = new Map();

// The dithered twin of a material for one pair of bands (cached; shared by everything using both).
export function fadeVariant(base, { in: fin = null, out = null } = {}) {
  const b = [...(fin || NO_IN), ...(out || NO_OUT)];
  const key = base.uuid + ':' + b.join(',');
  let v = variants.get(key);
  if (v) return v;
  v = base.clone();
  v.userData = { lodBase: base };
  const band = { value: new THREE.Vector4(...b) };
  const prev = base.onBeforeCompile, prevKey = base.customProgramCacheKey;
  v.onBeforeCompile = (sh, r) => { prev.call(base, sh, r); injectFade(sh, band); };
  v.customProgramCacheKey = () => prevKey.call(base) + '|lod';
  variants.set(key, v);
  return v;
}

// Materials whose look changes at run time (lamps, power, fire) keep their variant in step.
function sync(v) {
  const b = v.userData.lodBase;
  if (!b) return;
  if (b.color) v.color.copy(b.color);
  if (b.emissive) { v.emissive.copy(b.emissive); v.emissiveIntensity = b.emissiveIntensity; }
  v.opacity = b.opacity;
}

const _box = new THREE.Box3(), _cam = new THREE.Vector3();

export class LodSystem {
  constructor(camera) {
    this.camera = camera;
    this.entries = [];
    this.instanced = [];
    this.scale = 1;
  }

  // Everything below `target` fades and hides together. Bands are [start, end] in metres at the normal FOV.
  // fade: false only hides it past the band (for shader materials that fade themselves, e.g. particles).
  add(target, { in: fin = null, out = null, dynamic = false, name = '', fade = true } = {}) {
    const meshes = [];
    target.traverse((o) => {
      if ((o.isMesh || o.isPoints) && o.material && !Array.isArray(o.material) && o.material.visible !== false) meshes.push(o);
    });
    // `stale`: measured again on the first update, once the whole world is assembled and placed: a prop registered
    // before its group was moved into position (the observatory's far stand-in was) would otherwise keep bounds at
    // the origin, and show or hide by its distance from there.
    const e = { target, fin, out, dynamic, name, fade, meshes, base: meshes.map((m) => m.material), sphere: new THREE.Sphere(), state: 2, stale: true };
    this.bounds(e);
    this.entries.push(e);
    return e;
  }

  // A far stand-in for a group of meshes: merged into one vertex-coloured mesh (see bakeFar) that cross-fades
  // in across `band` as the originals fade out. Returns the proxy mesh.
  addFarProxy(sources, { parent, band, material, name = 'far', keep = [], aoTexture = null }) {
    const geo = bakeFar(sources, parent, { keep, aoTexture });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    for (const m of sources) this.add(m, { out: band, name });
    this.add(mesh, { in: band, name: name + ':far' });
    return mesh;
  }

  addInstanced(il) {
    this.instanced.push(il);
    return il;
  }

  bounds(e) {
    e.target.updateWorldMatrix(true, true);
    _box.setFromObject(e.target);
    if (_box.isEmpty()) _box.setFromCenterAndSize(e.target.getWorldPosition(_cam), _cam.set(0, 0, 0));
    _box.getBoundingSphere(e.sphere);
  }

  update() {
    const cam = this.camera;
    const s = (this.scale = lodScale.value = lodScaleFor(cam));
    _cam.setFromMatrixPosition(cam.matrixWorld);
    for (const e of this.entries) {
      if (e.dynamic || e.stale) { this.bounds(e); e.stale = false; }
      const d = e.sphere.center.distanceTo(_cam);
      const near = Math.max(0, d - e.sphere.radius) * s, far = (d + e.sphere.radius) * s;
      let st = 2;                                                     // 0 hidden, 1 fading, 2 solid
      if ((e.out && near >= e.out[1]) || (e.fin && far <= e.fin[0])) st = 0;
      else if ((e.out && far > e.out[0]) || (e.fin && near < e.fin[1])) st = 1;
      if (st !== e.state) this.apply(e, st);
      if (st === 1 && e.fade) for (const m of e.meshes) sync(m.material);
    }
    for (const il of this.instanced) il.update(_cam, s);
  }

  apply(e, st) {
    e.state = st;
    e.target.visible = st > 0;
    if (e.fade) e.meshes.forEach((m, i) => { m.material = st === 1 ? fadeVariant(e.base[i], { in: e.fin, out: e.out }) : e.base[i]; });
  }

  // (Every dithered twin is compiled, uploaded and drawn once before the player wakes: see render/preload.js.)

  // Dev: what's drawn and what isn't.
  report() {
    const by = { solid: 0, fading: 0, hidden: 0 };
    for (const e of this.entries) by[['hidden', 'fading', 'solid'][e.state]]++;
    return { ...by, instanced: this.instanced.map((il) => il.report()) };
  }
}

// Volumes no instanced scatter may be drawn in: elevator cars (grass sown over the Mountain shed's floor grew up through
// its car). Register them before the scatter is built (world/index.js builds it last).
const keepOut = [];
export function addKeepOut(matrixWorld, box) { keepOut.push({ inv: matrixWorld.clone().invert(), box }); }
const _ko = new THREE.Vector3();
const keptOut = (x, y, z) => keepOut.some((k) => k.box.containsPoint(_ko.set(x, y, z).applyMatrix4(k.inv)));

// Many small instanced things (grass, pebbles, trees). Each level keeps only the instances inside its distance
// range, re-gathered from a grid as the camera moves, so far instances cost nothing; a cheaper level can take
// over across a cross-fade band. A level is { parts: [{ geometry, material, colored }], in, out, max, zoom,
// castShadow, receiveShadow }: `max` culls without a fade (for materials that fade on their own), and
// `zoom: false` measures real distance instead of zoomed (grass never needs the telescope). sort: true draws the
// nearest instances first, so big overlapping ones (trees) fill the depth buffer near to far and the cards behind
// them fail the depth test before they are shaded.
export class InstancedLod {
  constructor(parent, { name = 'instances', matrices, colors = null, levels, step = 5, cell = 24, sort = false }) {
    this.name = name;
    this.n = matrices.length / 16;
    this.matrices = matrices;
    this.colors = colors;
    this.step = step;
    if (sort) { this.ids = new Uint32Array(this.n); this.d2 = new Float32Array(this.n); this.byDist = (a, b) => this.d2[a] - this.d2[b]; }
    this.pos = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) { this.pos[i * 3] = matrices[i * 16 + 12]; this.pos[i * 3 + 1] = matrices[i * 16 + 13]; this.pos[i * 3 + 2] = matrices[i * 16 + 14]; }
    // Uniform grid over x/z for range queries.
    this.cell = cell;
    this.grid = new Map();
    this.skip = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) {
      if (keepOut.length && keptOut(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2])) { this.skip[i] = 1; continue; }
      const k = this.key(Math.floor(this.pos[i * 3] / cell), Math.floor(this.pos[i * 3 + 2] / cell));
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(i);
    }
    this.levels = levels.map((L) => {
      const lo = L.in ? L.in[0] : 0;
      const hi = L.out ? L.out[1] : L.max ?? Infinity;
      const meshes = L.parts.map((p) => {
        const mat = L.in || L.out ? fadeVariant(p.material, { in: L.in, out: L.out }) : p.material;
        const m = new THREE.InstancedMesh(p.geometry, mat, this.n);
        m.count = 0;
        m.visible = false;
        m.castShadow = !!L.castShadow;
        m.receiveShadow = L.receiveShadow ?? true;
        m.name = name;
        if (p.colored && colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3);
        parent.add(m);
        return m;
      });
      return { ...L, lo, hi, meshes, zoom: L.zoom !== false, count: 0 };
    });
    this.at = new THREE.Vector3(1e9, 0, 0);
    this.atScale = 0;
  }

  key(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }

  update(cam, scale) {
    if (cam.distanceTo(this.at) < this.step && Math.abs(scale - this.atScale) < this.atScale * 0.1) return;
    this.at.copy(cam);
    this.atScale = scale;
    const P = this.pos;
    for (const L of this.levels) {
      const s = L.zoom ? scale : 1;
      const margin = this.step * 1.5;
      const lo = Math.max(0, L.lo / s - margin), hi = L.hi / s + margin;   // in real metres
      const lo2 = lo * lo, hi2 = hi * hi;
      let n = 0;
      const put = (i, k) => {
        for (const m of L.meshes) {
          m.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), k * 16);
          if (m.instanceColor) m.instanceColor.array.set(this.colors.subarray(i * 3, i * 3 + 3), k * 3);
        }
      };
      const take = (i) => {
        if (this.skip[i]) return;
        const dx = P[i * 3] - cam.x, dy = P[i * 3 + 1] - cam.y, dz = P[i * 3 + 2] - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < lo2 || d2 > hi2) return;
        if (this.ids) { this.d2[i] = d2; this.ids[n++] = i; return; }
        put(i, n++);
      };
      if (hi < 1e6 && hi / this.cell < 40) {
        const x0 = Math.floor((cam.x - hi) / this.cell), x1 = Math.floor((cam.x + hi) / this.cell);
        const z0 = Math.floor((cam.z - hi) / this.cell), z1 = Math.floor((cam.z + hi) / this.cell);
        for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
          const list = this.grid.get(this.key(ix, iz));
          if (list) for (const i of list) take(i);
        }
      } else {
        for (let i = 0; i < this.n; i++) take(i);
      }
      if (this.ids) {
        const ids = this.ids.subarray(0, n).sort(this.byDist);
        for (let k = 0; k < n; k++) put(ids[k], k);
      }
      L.count = n;
      for (const m of L.meshes) {
        m.count = n;
        m.visible = n > 0;
        if (!n) continue;
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, n * 16);
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) {
          m.instanceColor.clearUpdateRanges();
          m.instanceColor.addUpdateRange(0, n * 3);
          m.instanceColor.needsUpdate = true;
        }
        // Bounds: everything gathered lies within `hi` of the camera (cheaper than measuring every instance).
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const r = Math.min(hi, 5000) + m.geometry.boundingSphere.radius * 1.5;
        (m.boundingSphere ||= new THREE.Sphere()).set(cam, r);
      }
    }
  }

  report() {
    return { name: this.name, total: this.n, drawn: this.levels.map((L) => L.count) };
  }
}

// ---------------------------------------------------------------- far stand-ins
// Where far stand-ins take over (buildings, each stack's props).
export const FAR_BAND = [150, 190];

let farMat = null;
export function farMaterial() {
  return (farMat ||= patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, envMapIntensity: 0.6, name: 'far' })));
}

// Opaque, lit meshes can be merged into a stand-in; glass, glowing and shader-animated ones stay as they are.
export function mergeable(m) {
  const mat = m.material;
  return m.isMesh && !m.isInstancedMesh && mat && !Array.isArray(mat) && mat.visible !== false && !mat.transparent && !mat.alphaTest
    && (mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial) && !mat.emissiveMap
    && !(mat.emissive && mat.emissiveIntensity * Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b) > 0.2);
}
// Average colour of a texture (linear), from a small downscaled copy. Cached per texture.
const avgCache = new WeakMap();
function averageColor(tex) {
  if (!tex || !tex.image) return null;
  let c = avgCache.get(tex);
  if (c) return c;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(tex.image, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  c = new THREE.Color(r / n / 255, gg / n / 255, b / n / 255);
  if (tex.colorSpace === THREE.SRGBColorSpace) c.convertSRGBToLinear();
  avgCache.set(tex, c);
  return c;
}

// Pixels of a baked AO atlas, for sampling into vertex colours.
function atlasSampler(tex, size = 1024) {
  if (!tex || !tex.image) return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(tex.image, 0, 0, size, size);
  const d = g.getImageData(0, 0, size, size).data;
  // flipY is off for the atlases (glTF convention): v runs down the image.
  return (u, v) => d[(Math.min(size - 1, Math.max(0, Math.floor(v * size))) * size + Math.min(size - 1, Math.max(0, Math.floor(u * size)))) * 4] / 255;
}

// Merge meshes into one geometry in `parent`'s space, with each vertex coloured by what it looked like: vertex
// colour x material colour x average texture colour x baked AO. `keep` lists extra attributes to carry over
// (the observatory's part index, so the far dome still turns).
export function bakeFar(sources, parent, { keep = [], aoTexture = null } = {}) {
  parent.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3();
  const ao = atlasSampler(aoTexture);
  const geos = [];
  const tmp = new THREE.Color(), v = new THREE.Vector3();
  for (const src of sources) {
    const g0 = src.geometry, mat = src.material;
    m4.multiplyMatrices(inv, src.matrixWorld);
    n3.getNormalMatrix(m4);
    const n = g0.attributes.position.count;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const P = g0.attributes.position, N = g0.attributes.normal, C = mat.vertexColors ? g0.attributes.color : null;
    const U1 = mat.aoMap ? g0.attributes.uv1 : null;
    const base = (mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1));
    const tex = averageColor(mat.map);
    if (tex) base.multiply(tex);
    if (mat.metalness > 0.3) base.multiplyScalar(1 - 0.5 * mat.metalness);   // metals are dark without their reflections
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m4);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      if (N) { v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize(); nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z; }
      tmp.copy(base);
      if (C) tmp.multiply({ r: C.getX(i), g: C.getY(i), b: C.getZ(i) });
      if (ao && U1) tmp.multiplyScalar(ao(U1.getX(i), U1.getY(i)));
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of keep) if (g0.attributes[k]) g.setAttribute(k, g0.attributes[k].clone());
    const idx = g0.index ? g0.index.array : Uint32Array.from({ length: n }, (_, i) => i);
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  merged.computeBoundingSphere();
  return merged;
}
