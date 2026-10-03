import * as THREE from 'three';
import { GLTFLoader } from '../render/gltf.js';
import { materials, patchMaterial } from '../render/materials.js';
import { mergeParts, mat4 } from '../world/builders.js';

// The iris diaphragm (tools/blender/iris_design.py): one blade, the stationary ring with its pivot pins and the
// actuator ring with its drive pins, for an opening of radius 1, and how far the ring turns as the blades swing.
// Loaded before the world is built (main.js; the regression harness parses the same file).
let IRIS = null;
export function setIrisAsset(gltf) {
  const geo = {};
  let meta = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (o.isMesh) geo[o.name] = o;
    if (o.name === 'IRIS_META') meta = o.userData;
  });
  // (Through mergeParts: the shared materials read vertex colours and uvs, which the model doesn't carry. With each
  // mesh's own transform: a deploy that rounds the meshes, tools/deploy quantize, puts their offset and scale there.)
  const prep = (o) => {
    const m = mergeParts([{ geo: o.geometry, matrix: o.matrixWorld, color: 0xffffff }]);
    const p = m.attributes.position, uv = m.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.8, p.getZ(i) * 0.8);   // the metal's grain, from above
    return m;
  };
  IRIS = { blade: prep(geo.Blade), base: prep(geo.Base), actuator: prep(geo.Actuator), meta };
  return IRIS;
}
export async function loadIris() {
  return setIrisAsset(await new GLTFLoader().loadAsync(import.meta.env.BASE_URL + 'models/iris.glb'));
}

// Recessed iris door: the iris diaphragm (createIris below) over a pit, with a riveted rim, like a rusty camera aperture.
export function createAperture(ctx, { center, radius = 1.75, parent, batcher, collider }) {
  const M = materials();
  const group = new THREE.Group();
  group.position.copy(center);
  parent.add(group);
  const bladeY = -0.2;

  // Rim ring + recessed collar, and a flat steel bezel just above the blades that hides their pivots and outer ends.
  batcher.add(new THREE.TorusGeometry(radius + 0.02, 0.07, 6, 48).rotateX(Math.PI / 2), M.metal, mat4(center.x, center.y - 0.04, center.z));
  batcher.add(new THREE.RingGeometry(radius - 0.09, radius + 0.14, 64, 1).rotateX(-Math.PI / 2), M.metal, mat4(center.x, center.y - 0.1, center.z));
  // Rivets around the rim
  const rivet = new THREE.SphereGeometry(0.035, 6, 4);
  const rparts = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    rparts.push({ geo: rivet, matrix: mat4(center.x + Math.cos(a) * (radius + 0.14), center.y - 0.02, center.z + Math.sin(a) * (radius + 0.14)) });
  }
  batcher.add(mergeParts(rparts), M.metal);

  // Pit below the blades
  const pitDepth = 3.5;
  const pit = new THREE.CylinderGeometry(radius, radius * 0.9, pitDepth + 0.3, 32, 4, true);
  const idx = pit.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  pit.computeVertexNormals();
  const pn = pit.attributes.normal;
  for (let i = 0; i < pn.count; i++) pn.setXYZ(i, -pn.getX(i), -pn.getY(i), -pn.getZ(i));
  batcher.add(pit, M.darkMetal, mat4(center.x, center.y + 0.04 - (pitDepth + 0.3) / 2, center.z), 0x4a4440);
  batcher.add(new THREE.CircleGeometry(radius * 0.9, 32).rotateX(-Math.PI / 2), M.darkMetal, mat4(center.x, center.y - 0.26 - pitDepth, center.z), 0x2a2622);

  // The blades (their tops about 0.19 m under the rim; they swing out under the paving).
  const iris = createIris({ radius, parent: group, frame: new THREE.Matrix4(), material: M.metal });
  iris.mesh.castShadow = true;

  // Walkable while closed.
  collider.addGeometry(new THREE.CircleGeometry(radius + 0.05, 24).rotateX(-Math.PI / 2), mat4(center.x, center.y + bladeY + 0.03, center.z));

  let open = 0;
  const api = {
    group,
    center,
    get open() { return open; },
    set(v) {
      open = v;
      iris.set(v);
    },
  };
  api.set(0);
  return api;
}

// An iris diaphragm of opening `radius` (tools/blender/iris_design.py), as a real one works: N curved blades, each turning
// on its own pivot pin in a stationary ring, all swung at once by an actuator ring whose pins ride in a slot in each
// blade. Shut, the blades cover the opening with no gaps (every blade over its neighbour on one side and under the other);
// open, every blade lies outside the opening, within `reach` radii of the centre. The blades are one instanced mesh
// (one draw call); the rings are hidden behind whatever holds the iris (a door's face, the End stack's paving) but turn
// with it all the same. `frame` places the centre (y up) in the parent's space; the blades sit just below it.
export function createIris({ radius, parent, frame, material = materials().metal }) {
  const I = IRIS, n = I.meta.n, beta = I.meta.beta;
  const mesh = new THREE.InstancedMesh(I.blade, bladeMaterial(material), n);
  mesh.name = 'iris';
  mesh.receiveShadow = true;
  const S = new THREE.Matrix4().makeScale(radius, radius, radius);
  const place = (geo, name) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.matrixAutoUpdate = false;
    m.matrix.copy(frame).multiply(S);
    parent.add(m);
    return m;
  };
  place(I.base, 'iris-base');
  const ring = place(I.actuator, 'iris-actuator');
  const m = new THREE.Matrix4(), r = new THREE.Matrix4(), t = new THREE.Matrix4(), sw = new THREE.Matrix4();
  let open = 0;
  const api = {
    mesh,
    reach: I.meta.reach * radius,
    get open() { return open; },
    set(v) {
      open = v;
      const f = v * v * (3 - 2 * v);                        // eased
      const psi = f * I.meta.psiMax;
      sw.makeRotationY(-I.meta.dir * psi);                  // the blade about its pivot (the design's angles run x -> z)
      for (let i = 0; i < n; i++) {
        r.makeRotationY(-(i / n) * Math.PI * 2);
        t.makeTranslation(I.meta.rp * radius, 0, 0);
        m.copy(frame).multiply(r).multiply(t).multiply(sw).multiply(S);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      // The actuator ring's turn for this swing, from the slot geometry (a table over the swing).
      const x = f * (beta.length - 1), k = Math.min(beta.length - 2, Math.floor(x));
      const b = beta[k] + (beta[k + 1] - beta[k]) * (x - k);
      ring.matrix.copy(frame).multiply(r.makeRotationY(-b)).multiply(S);
    },
  };
  api.set(0);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3().setFromMatrixPosition(frame), radius * (I.meta.reach + 0.1));
  parent.add(mesh);
  return api;
}

// The blades are one stamped part, but each has its own wear: the metal's texture shifted per instance. (With the same
// patch of rust on every blade, the shut iris showed a twelve-armed star where the tips meet.) One material per base
// material, shared by every iris.
const bladeMats = new Map();
function bladeMaterial(base) {
  if (!bladeMats.has(base)) {
    const m = base.clone();
    m.name = (base.name || 'metal') + '-iris';
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_INSTANCING
        { vec2 io = vec2(float(gl_InstanceID) * 0.371, float(gl_InstanceID) * 0.613);
          #ifdef USE_MAP
          vMapUv += io;
          #endif
          #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv += io;
          #endif
        }
        #endif`);
    };
    patchMaterial(m);   // after: it runs the uv shift first, then adds the fog and lighting as for every material
    m.customProgramCacheKey = () => 'db:n:iris';
    bladeMats.set(base, m);
  }
  return bladeMats.get(base);
}
