import * as THREE from 'three';
import { Textures } from '../render/textures.js';
import { patchMaterial } from '../render/materials.js';
import { mat4, mergeParts } from '../world/builders.js';

// An old 70s twin-bell alarm clock in burnt-orange enamel, hands at seven o'clock.
export function createClock() {
  const group = new THREE.Group();
  const enamel = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xc4561c, roughness: 0.35, metalness: 0.1, vertexColors: true }));
  const chrome = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.15, metalness: 1, vertexColors: true }));
  const faceMat = patchMaterial(new THREE.MeshStandardMaterial({ map: Textures.clockFace(), roughness: 0.6, emissive: 0xfff2d0, emissiveIntensity: 0.12, emissiveMap: Textures.clockFace() }));
  const glassMat = patchMaterial(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.12, depthWrite: false }));

  const R = 0.2, D = 0.11;
  const body = mergeParts([
    { geo: new THREE.CylinderGeometry(R, R, D, 40, 1), matrix: mat4(0, 0, 0, 0, 1, 1, 1, Math.PI / 2) },
    { geo: new THREE.CylinderGeometry(R * 0.35, R * 0.35, 0.03, 20), matrix: mat4(0, 0, -D / 2 - 0.015, 0, 1, 1, 1, Math.PI / 2) },
  ]);
  group.add(new THREE.Mesh(body, enamel));
  const trim = mergeParts([
    { geo: new THREE.TorusGeometry(R, 0.014, 8, 40), matrix: mat4(0, 0, D / 2) },
    { geo: new THREE.TorusGeometry(R, 0.01, 8, 40), matrix: mat4(0, 0, -D / 2) },
    // Bells on top
    ...[-1, 1].map((s) => ({ geo: new THREE.SphereGeometry(0.09, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), matrix: mat4(s * 0.12, R + 0.07, 0, 0, 1, 1, 1, 0, -s * 0.45) })),
    ...[-1, 1].map((s) => ({ geo: new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), matrix: mat4(s * 0.1, R + 0.02, 0, 0, 1, 1, 1, 0, -s * 0.45) })),
    // Hammer between the bells
    { geo: new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), matrix: mat4(0, R + 0.05, 0) },
    { geo: new THREE.SphereGeometry(0.018, 10, 8), matrix: mat4(0, R + 0.11, 0) },
    // Legs
    ...[-1, 1].map((s) => ({ geo: new THREE.CylinderGeometry(0.012, 0.022, 0.09, 8), matrix: mat4(s * 0.12, -R - 0.02, 0, 0, 1, 1, 1, 0, s * 0.4) })),
    // Carry handle
    { geo: new THREE.TorusGeometry(0.07, 0.008, 6, 20, Math.PI), matrix: mat4(0, R + 0.16, 0, Math.PI / 2) },
    // Winding keys on the back
    { geo: new THREE.BoxGeometry(0.06, 0.02, 0.005), matrix: mat4(-0.06, 0.03, -D / 2 - 0.04) },
    { geo: new THREE.BoxGeometry(0.06, 0.02, 0.005), matrix: mat4(0.06, -0.03, -D / 2 - 0.04) },
  ]);
  group.add(new THREE.Mesh(trim, chrome));
  const face = new THREE.Mesh(new THREE.CircleGeometry(R * 0.93, 40), faceMat);
  face.position.z = D / 2 + 0.002;
  group.add(face);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(R * 0.95, 24, 8, 0, Math.PI * 2, 0, 0.5), glassMat);
  glass.rotation.x = Math.PI / 2;
  glass.position.z = D / 2 - 0.05;
  group.add(glass);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.scale.setScalar(1.6);
  return group;
}
