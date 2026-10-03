import { GLTFLoader as ThreeGLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as THREE from 'three';

// The game's glTF loader: three's, able to read models a deploy has compressed (tools/deploy, EXT_meshopt_compression,
// and KHR_mesh_quantization when the meshes were rounded). Rounded positions and normals arrive as normalized integers;
// they're turned back into floats here, so every model reaches the game in the same form whichever way it was shipped
// (the code reading vertices, colliders, merges by material, assumes Float32). Models as built load as before.
export class GLTFLoader extends ThreeGLTFLoader {
  constructor(manager) {
    super(manager);
    this.setMeshoptDecoder(MeshoptDecoder);
  }

  parse(data, path, onLoad, onError) {
    super.parse(data, path, (gltf) => { floatAttributes(gltf.scene); onLoad(gltf); }, onError);
  }
}

function floatAttributes(root) {
  root.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    for (const name of ['position', 'normal']) {
      const a = g.attributes[name];
      if (!a || a.array instanceof Float32Array) continue;
      const out = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
    }
  });
}
