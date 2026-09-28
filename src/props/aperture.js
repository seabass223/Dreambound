import * as THREE from 'three';
import { materials } from '../render/materials.js';
import { mergeParts, mat4 } from '../world/builders.js';

const N = 9;

// Blade i of an iris of `radius`, in its pivot's frame (the pivot sits on the rim at angle 2πi/N): a curved leaf from
// the rim to near the centre, extruded downward. k scales its thickness and tip for a small door. Blade i is blade 0
// turned by 2πi/N about the centre, which createIris relies on.
function bladeGeometry(radius, i, k = 1) {
  const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1.35) / N) * Math.PI * 2;
  const P = new THREE.Vector2(Math.cos(a0) * radius, Math.sin(a0) * radius);
  const Q = new THREE.Vector2(Math.cos(a1) * radius * 1.02, Math.sin(a1) * radius * 1.02);
  const tip = new THREE.Vector2(Math.cos(a0 + 1.3) * 0.12 * k, Math.sin(a0 + 1.3) * 0.12 * k);
  // Shape in pivot-local coords.
  const s = new THREE.Shape();
  const rel = (v) => v.clone().sub(P);
  s.moveTo(0, 0);
  const q = rel(Q), t = rel(tip);
  s.quadraticCurveTo(q.x * 0.55 + t.x * 0.1, q.y * 0.55 + t.y * 0.1, q.x, q.y);
  s.lineTo(t.x, t.y);
  s.quadraticCurveTo(t.x * 0.4, t.y * 0.4 + 0.05 * k, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.025 * k, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(Math.PI / 2); // shape (x, y) -> world (x, z), extruded downward
  return { geo: mergeParts([{ geo: g }]), P };
}

// How far each blade swings about its pivot, eased: 0 shut, 1 open.
const swing = (v) => v * v * (3 - 2 * v) * 1.45;

// Recessed iris door: N overlapping blades pivoting on the rim, like a rusty camera aperture.
export function createAperture(ctx, { center, radius = 1.75, parent, batcher, collider }) {
  const M = materials();
  const group = new THREE.Group();
  group.position.copy(center);
  parent.add(group);
  const bladeY = -0.2;

  // Rim ring + recessed collar
  batcher.add(new THREE.TorusGeometry(radius + 0.02, 0.07, 6, 48).rotateX(Math.PI / 2), M.metal, mat4(center.x, center.y - 0.04, center.z));
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

  // Blades
  const blades = [];
  const bladeMat = M.metal;
  for (let i = 0; i < N; i++) {
    const { geo, P } = bladeGeometry(radius, i);
    const pivot = new THREE.Group();
    pivot.position.set(P.x, bladeY + i * 0.005, P.y);
    const blade = new THREE.Mesh(geo, bladeMat);
    blade.castShadow = true; blade.receiveShadow = true;
    pivot.add(blade);
    group.add(pivot);
    blades.push(pivot);
  }

  // Walkable while closed.
  collider.addGeometry(new THREE.CircleGeometry(radius + 0.05, 24).rotateX(-Math.PI / 2), mat4(center.x, center.y + bladeY + 0.03, center.z));

  let open = 0;
  const api = {
    group,
    center,
    get open() { return open; },
    set(v) {
      open = v;
      blades.forEach((b) => { b.rotation.y = swing(v); });
    },
  };
  api.set(0);
  return api;
}

// The same iris scaled down to `radius` (blades only: its rim and well are modelled with whatever holds it), as one
// instanced mesh, so a small door costs one draw call. `frame` places its centre (y up) in the parent's space; the
// blades sit a little below it, as the End door's do.
export function createIris({ radius, parent, frame, material = materials().metal }) {
  const k = radius / 1.75;
  const mesh = new THREE.InstancedMesh(bladeGeometry(radius, 0, k).geo, material, N);
  mesh.name = 'iris';
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  let open = 0;
  const api = {
    mesh,
    get open() { return open; },
    set(v) {
      open = v;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        m.copy(frame).multiply(mat4(Math.cos(a0) * radius, (-0.2 + i * 0.005) * k, Math.sin(a0) * radius, swing(v) - a0));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
  api.set(0);
  // Open blades reach about 1.9 radii from the centre.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3().setFromMatrixPosition(frame), radius * 2);
  parent.add(mesh);
  return api;
}
