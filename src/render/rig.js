import * as THREE from 'three';

// GPU rigging for models built with tools/blender/dbkit.py: a whole building is merged into one mesh per material,
// each vertex tagged with its movable part (aPart), and the vertex shader turns it about the part's pivot and then
// its parent's (up to three levels). Uniform arrays hold every part's pivot, angle, axis and parent.

export const RIG_N = 24;

export const RIG_VERT = /* glsl */ `
attribute float aPart;
uniform vec4 uRigP[${RIG_N}];   // pivot xyz, angle
uniform vec4 uRigA[${RIG_N}];   // axis xyz, parent index
vec3 rigRot(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
vec3 rigPoint(vec3 p) {
  int id = int(aPart + 0.5);
  for (int i = 0; i < 3; i++) { if (id <= 0) break; vec4 P = uRigP[id], A = uRigA[id]; p = rigRot(p - P.xyz, A.xyz, P.w) + P.xyz; id = int(A.w + 0.5); }
  return p;
}
vec3 rigDir(vec3 n) {
  int id = int(aPart + 0.5);
  for (int i = 0; i < 3; i++) { if (id <= 0) break; n = rigRot(n, uRigA[id].xyz, uRigP[id].w); id = int(uRigA[id].w + 0.5); }
  return n;
}
`;

export function rigged(mat, rig, extra = null) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uRigP = rig.uRigP;
    sh.uniforms.uRigA = rig.uRigA;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_VERT)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = rigDir(objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = rigPoint(transformed);');
    if (extra) extra(sh);
  };
  const tag = extra ? mat.name || 'x' : '';
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|rig' + tag;
  return mat;
}

// Shared varying for the animated materials: the model's UVs pack an id in the integer part.
// fragCode (the material's own functions) goes after these declarations.
export const UV_VERT = (sh, fragCode) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vObsUv;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvObsUv = vec2(uv.x, 1.0 - uv.y);');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vObsUv;
uniform float uObsTime;
uniform float uObsK;
float oh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float oh1(float x) { return oh(vec2(x, x * 0.37 + 11.3)); }
` + fragCode);
};

export function createRig() {
  return {
    uRigP: { value: Array.from({ length: RIG_N }, () => new THREE.Vector4()) },
    uRigA: { value: Array.from({ length: RIG_N }, () => new THREE.Vector4()) },
  };
}

// Find the parts in a loaded glTF scene (nodes with a `driver` extra) and fill the rig. Returns
// { parts: [null, {name, driver, ratio, pivot, axis, parent}], partOf: Map(node -> index), nodes: {name: node} }.
export function collectParts(src, rig, label = 'model') {
  const parts = [null];
  const partOf = new Map();
  const nodes = {};
  src.traverse((o) => {
    if (o.name) nodes[o.name] = o;
    const ud = o.userData;
    if (!ud || !ud.driver) return;
    let p = o.parent, parent = 0;
    while (p) { if (partOf.has(p)) { parent = partOf.get(p); break; } p = p.parent; }
    const i = parts.length;
    const pivot = o.getWorldPosition(new THREE.Vector3());
    const axis = new THREE.Vector3(...ud.axis).normalize();
    parts.push({ name: o.name, driver: ud.driver, ratio: ud.ratio, pivot, axis, parent });
    partOf.set(o, i);
    rig.uRigP.value[i].set(pivot.x, pivot.y, pivot.z, 0);
    rig.uRigA.value[i].set(axis.x, axis.y, axis.z, parent);
  });
  if (parts.length > RIG_N) console.warn(label + ': too many parts', parts.length);
  return { parts, partOf, nodes };
}

// The part a mesh node belongs to (0 = static).
export function partIndex(o, partOf) {
  let p = o.parent;
  while (p) { if (partOf.has(p)) return partOf.get(p); p = p.parent; }
  return 0;
}
