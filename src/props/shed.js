import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/materials.js';
import { addKeepOut } from '../render/lod.js';
import { atmo } from '../render/atmosphere.js';

// The Mountain shed (tools/blender/shed_design.py): the Mountain elevator's upper stop, a tall timber hoist house on a
// stone plinth at the mountain's foot. Board-and-batten walls on an exposed post-and-girt frame, a corrugated iron roof
// on rafters and purlins, gutters, double doors hooked open, a window, gable vents, a lamp over the door and a pendant
// inside. The elevator end (props/elevator.js) stands in it at the model's PLATE empty, framed as a partition.
//
// The model's frame is mountain.js's shed frame: origin on the levelled ground at the footprint's centre, +z out of the
// door. Two draw calls: every wooden surface is one mesh ('w_*' buckets), everything else (galvanised and black iron,
// stone and mortar, glass, enamel, the bulbs) the other ('h_*'). What each surface is rides on its first UV as an
// integer offset of KSTEP per kind; the shaders below decode it. The atlas on the second UV holds the baked ambient
// occlusion (R), grime (G) and weathering (B: lichen and moss, paint loss, rust), thresholded against a noise in each
// detail tile's normal map (blue; the normal's z is rebuilt from x and y). After dark the lamp over the door has a
// soft additive glow (a sprite, as the deck's lantern; no light), drawn only at night and with the power on.

const KSTEP = 64.0;
const FILES = {
  atlas: 'shed_atlas.png', wood: 'shed_wood.png', woodN: 'shed_wood_normal.png', metal: 'shed_metal.png',
  metalN: 'shed_metal_normal.png', stone: 'shed_stone.png', stoneN: 'shed_stone_normal.png',
};
const GLOW_ON = 3.0, GLOW_OFF = 0.03;   // the bulbs, with and without the Mountain line's power

export async function loadShed() {
  const base = import.meta.env.BASE_URL + 'models/';
  const tl = new THREE.TextureLoader();
  const keys = Object.keys(FILES);
  const [gltf, ...tex] = await Promise.all([new GLTFLoader().loadAsync(base + 'shed.glb'), ...keys.map((k) => tl.loadAsync(base + FILES[k]))]);
  const T = Object.fromEntries(keys.map((k, i) => [k, tex[i]]));
  for (const [k, t] of Object.entries(T)) {
    t.flipY = false;                                  // glTF UVs
    if (k === 'atlas') {
      // Small charts on a shared atlas: mipmaps would bleed their neighbours in (see cabin.js).
      t.channel = 1;
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
    } else {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;      // seamless tiles
      t.anisotropy = 8;
      t.colorSpace = k.endsWith('N') ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    }
  }
  return { gltf, ...T };
}

// A soft round falloff for the lamp's glow (a DataTexture, so the headless harness can build it too).
function glowTexture() {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const r = Math.hypot(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(Math.max(0, 1 - r) ** 2.2 * (0.35 + 0.65 * Math.exp(-5 * r)) * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- materials
// Shared by both shaders: the atlas sample, the kind, and the replacements for three's map / roughness / metalness /
// normal-map / emissive chunks.
const HEAD = /* glsl */ `
  vec4 shA = texture2D( aoMap, vAoMapUv );
  float shKind = floor( vMapUv.x / ${KSTEP.toFixed(1)} + 0.5 );
  float shRough = 0.9, shMetal = 0.0, shNS = 1.0;
  vec3 shEmit = vec3( 0.0 );
  vec3 shNm;
`;
const cover = (amount, noise, soft = '0.07') => `smoothstep( -${soft}, ${soft}, ${amount} - ${noise} )`;

function tail(sh) {
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <color_fragment>', '')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = shRough;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = shMetal;')
    .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps
      .replaceAll('texture2D( normalMap, vNormalMapUv ).xyz', 'shNm')
      .replace('#if defined( USE_PACKED_NORMALMAP )', '#if 1')      // z from x and y: blue is the tile's noise
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * shNS;'))
    .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += shEmit;');
}

// Weathered boards: raw wood (tinted by the vertex colour) with lichen where the atlas says; painted wood (the vertex
// colour is the paint) worn back to the wood; grime over both.
function woodMaterial(T) {
  const mat = new THREE.MeshStandardMaterial({
    name: 'shed_wood', vertexColors: true, map: T.wood, normalMap: T.woodN, normalScale: new THREE.Vector2(0.9, -0.9),
    aoMap: T.atlas, roughness: 0.88, metalness: 0, envMapIntensity: 0.6,
  });
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', HEAD + /* glsl */ `
      vec4 shN4 = texture2D( normalMap, vNormalMapUv );
      shNm = shN4.xyz;
      float shNoise = shN4.b;
      vec3 shTex = texture2D( map, vMapUv ).rgb;
      float shLum = dot( shTex, vec3( 0.3, 0.59, 0.11 ) );
      vec3 shCol;
      if ( shKind > 0.5 ) {
        // paint, flaking along the grain; where it holds it fills the grain and takes a little sheen
        float keep = smoothstep( -0.07, 0.07, shNoise - shA.b );
        vec3 paint = vColor.rgb * ( 0.78 + 1.2 * shLum );
        shCol = mix( shTex * vec3( 0.92, 0.9, 0.86 ), paint, keep );
        shRough = mix( 0.88, 0.66, keep );
        shNS = mix( 1.0, 0.4, keep );
      } else {
        shCol = shTex * vColor.rgb;
        // lichen crusts: grey-green, with a few yellow-orange rosettes
        float li = ${cover('shA.b', 'shNoise', '0.06')};
        vec3 lc = mix( vec3( 0.16, 0.17, 0.12 ), vec3( 0.30, 0.31, 0.25 ), smoothstep( 0.3, 0.7, fract( shNoise * 13.0 ) ) );
        lc = mix( lc, vec3( 0.36, 0.25, 0.08 ), step( 0.97, fract( shNoise * 37.0 ) ) * 0.6 );
        shCol = mix( shCol, lc * ( 0.7 + 1.5 * shLum ), li * 0.9 );
        shRough = mix( shRough, 0.95, li );
      }
      shCol *= mix( 1.0, 0.4, shA.g );
      shRough = mix( shRough, 0.96, shA.g * 0.5 );
      diffuseColor.rgb = shCol;
    `);
    tail(sh);
  };
  patchMaterial(mat);
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key() + '|shed_wood';
  return mat;
}

// Everything else, by kind: 0 galvanised steel (rusting), 1 black iron, 2 stone, 3 mortar, 4 glass, 5 the window glass
// seen from inside (the daylight through it), 6 the bulbs, 7 enamel, 8 brass, 9 rubber, 10 water.
function hardMaterial(T, U) {
  const mat = new THREE.MeshStandardMaterial({
    name: 'shed_hard', vertexColors: true, map: T.metal, normalMap: T.metalN, normalScale: new THREE.Vector2(1, -1),
    aoMap: T.atlas, roughness: 0.6, metalness: 0, envMapIntensity: 0.6,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uStoneMap, uStoneNormal;\nuniform float uGlow;')
      .replace('#include <map_fragment>', HEAD + /* glsl */ `
      float isStone = step( 1.5, shKind ) * step( shKind, 3.5 );
      vec3 shTex = mix( texture2D( map, vMapUv ).rgb, texture2D( uStoneMap, vMapUv ).rgb, isStone );
      vec4 shN4 = mix( texture2D( normalMap, vNormalMapUv ), texture2D( uStoneNormal, vNormalMapUv ), isStone );
      shNm = shN4.xyz;
      float shNoise = shN4.b;
      float shLum = dot( shTex, vec3( 0.3, 0.59, 0.11 ) );
      vec3 vc = vColor.rgb;
      vec3 shCol = vc;
      vec3 rustC = mix( vec3( 0.19, 0.07, 0.028 ), vec3( 0.36, 0.16, 0.06 ), smoothstep( 0.2, 0.8, fract( shNoise * 7.0 ) ) );
      float rust = ${cover('shA.b', 'shNoise')};
      if ( shKind < 0.5 ) {
        // galvanised: spangled zinc, dulled to chalky white rust, then red rust
        shCol = shTex * vc;
        shMetal = 0.8;
        shRough = 0.34 + 0.3 * ( 1.0 - shLum );
        float white = smoothstep( 0.02, 0.3, shA.b ) * ( 1.0 - rust );
        shCol = mix( shCol, vec3( 0.30, 0.30, 0.29 ), white * 0.4 );
        shRough = mix( shRough, 0.72, white );
        shMetal = mix( shMetal, 0.35, white );
        shCol = mix( shCol, rustC * ( 0.7 + 0.6 * shLum ), rust );
        shMetal = mix( shMetal, 0.04, rust );
        shRough = mix( shRough, 0.9, rust );
        shNS = 0.6 + rust * 0.8;
        shMetal *= mix( 0.3, 1.0, shA.r );     // no sky to reflect in the shed's shadowed corners and under the roof
      } else if ( shKind < 1.5 ) {
        // black iron: forged hinges, straps, the lamp's arm; rusting through
        shCol = vc * ( 0.7 + 0.6 * shLum );
        shMetal = 0.55;
        shRough = 0.55;
        shCol = mix( shCol, rustC * 0.8, rust );
        shMetal = mix( shMetal, 0.05, rust );
        shRough = mix( shRough, 0.9, rust );
      } else if ( shKind < 2.5 ) {
        // stone, with moss cushions and lichen
        shCol = shTex * vc;
        shRough = 0.9;
        shNS = 1.3;
        float m = rust;
        vec3 mc = mix( vec3( 0.055, 0.075, 0.025 ), vec3( 0.24, 0.26, 0.19 ), smoothstep( 0.35, 0.65, fract( shNoise * 11.0 ) ) );
        mc = mix( mc, vec3( 0.36, 0.25, 0.08 ), step( 0.96, fract( shNoise * 31.0 ) ) * 0.6 );
        shCol = mix( shCol, mc * ( 0.8 + shLum ), m * 0.92 );
        shRough = mix( shRough, 0.97, m );
      } else if ( shKind < 3.5 ) {
        // lime mortar: pale and sandy
        shCol = mix( vec3( shLum ), shTex, 0.35 ) * vc * 1.25;
        shRough = 0.96;
        shNS = 0.7;
        shCol = mix( shCol, vec3( 0.07, 0.09, 0.035 ), rust * 0.8 );
      } else if ( shKind < 4.5 ) {
        // old glass, dusty
        shCol = mix( vc, vec3( 0.26, 0.25, 0.22 ), shA.g * 0.55 );
        shRough = 0.06 + shA.g * 0.45;
        shNS = 0.05;
      } else if ( shKind < 5.5 ) {
        // the window from inside: the day through dusty glass
        shCol = vec3( 0.015 );
        shRough = 0.3;
        shNS = 0.0;
        shEmit = ( uHorizonAway * 0.75 + uZenith * 0.35 ) * ( 0.75 - 0.4 * shA.g ) * ( 1.0 - uUnderground );
      } else if ( shKind < 6.5 ) {
        // a bulb
        shCol = vec3( 0.0 );
        shNS = 0.0;
        shEmit = vc * uGlow;
      } else if ( shKind < 7.5 ) {
        // enamel, chipped to rusty iron
        shRough = 0.32;
        shNS = 0.15;
        shCol = mix( shCol, vec3( 0.05, 0.035, 0.025 ) + rustC * 0.3, rust );
        shRough = mix( shRough, 0.85, rust );
      } else if ( shKind < 8.5 ) {
        // brass, tarnished
        shCol = vc * ( 0.7 + 0.8 * shLum );
        shMetal = 0.9;
        shRough = 0.34;
        shNS = 0.3;
        shCol = mix( shCol, vec3( 0.09, 0.1, 0.07 ), rust * 0.8 );
        shRough = mix( shRough, 0.7, rust );
      } else if ( shKind < 9.5 ) {
        shRough = 0.85;
        shNS = 0.4;
      } else {
        // water in the barrel
        shRough = 0.04;
        shNS = 0.0;
      }
      if ( shKind < 4.5 || shKind > 6.5 ) {
        shCol *= mix( 1.0, 0.42, shA.g );
        shRough = mix( shRough, 0.95, shA.g * 0.45 );
      }
      diffuseColor.rgb = shCol;
    `);
    tail(sh);
  };
  patchMaterial(mat);
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key() + '|shed_hard';
  return mat;
}

// Only the attributes both shaders use, so every mesh of a group merges.
const ATTRS = ['position', 'normal', 'uv', 'uv1', 'color'];
function strip(geo) {
  const g = new THREE.BufferGeometry();
  for (const a of ATTRS) if (geo.attributes[a]) g.setAttribute(a, geo.attributes[a].clone());
  g.setIndex(geo.index.clone());
  return g;
}

// Places the shed at `pos` (its footprint's centre on the levelled ground) turned by `rotY` (its door, +z, then faces
// along (sin rotY, cos rotY)). Returns { root, meshes, atlas, on(feet), inside(x, z, margin), empties }.
export function placeShed(ctx, asset, { pos, rotY, parent }) {
  const root = new THREE.Group();
  root.name = 'shed';
  root.position.copy(pos);
  root.rotation.y = rotY;
  parent.add(root);

  const U = { uStoneMap: { value: asset.stone }, uStoneNormal: { value: asset.stoneN }, uGlow: { value: GLOW_OFF } };
  const mats = { w: woodMaterial(asset), h: hardMaterial(asset, U) };
  const groups = { w: [], h: [] };
  const empties = {};
  let colliderGeo = null;
  asset.gltf.scene.updateMatrixWorld(true);
  asset.gltf.scene.traverse((o) => {
    if (o.isMesh) {
      if (o.name === 'COLLIDER') { colliderGeo = o.geometry.clone().applyMatrix4(o.matrixWorld); return; }
      const key = (o.material?.name || '').replace(/^shed_/, '')[0];
      if (groups[key]) groups[key].push(strip(o.geometry).applyMatrix4(o.matrixWorld));
    } else if (o !== asset.gltf.scene) {
      empties[o.name] = o;
    }
  });
  const meshes = [];
  for (const k of ['w', 'h']) {
    if (!groups[k].length) continue;
    const geo = mergeGeometries(groups[k], false);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, mats[k]);
    mesh.name = k === 'w' ? 'shed:wood' : 'shed:hard';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    meshes.push(mesh);
  }
  root.updateMatrixWorld(true);
  const meta = empties.META?.userData ?? {};
  const IX = meta.ix ?? 1.87, FL = meta.floor ?? 0.12, TH = meta.threshold ?? 2.98;
  const [PX, PZ] = meta.plinth ?? [2.03, 2.8];

  // The bulbs light with the Mountain power line, like the elevator's car; after dark the lamp over the door glows.
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(1.0, 0.7, 0.4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    opacity: 0,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.name = 'shed:glow';
  glow.position.copy(empties.LAMP_OUT?.position ?? new THREE.Vector3(0, 2.8, 3.1));
  glow.position.y -= 0.03;
  glow.scale.setScalar(1.1);
  root.add(glow);
  const live = () => !ctx.power || ctx.power.mountain !== false;
  let lit = -1;
  ctx.updaters.push(() => {
    const k = live() ? 1 : 0;
    if (k !== lit) { lit = k; U.uGlow.value = k ? GLOW_ON : GLOW_OFF; }
    const o = k * atmo.uNight.value * 0.55;
    glowMat.opacity = o;
    glow.visible = o > 0.01;
  });

  // Collision: the model's boxes (floor, threshold, walls round the doorway, the open door leaves, barrel, bench). Its
  // own collider: adding to the stack's would reshuffle that one's BVH (see tools/regress).
  if (colliderGeo) ctx.lateCollider('shed').addGeometry(colliderGeo, root.matrixWorld);

  // No grass, flowers or pebbles through the floor, the plinth or the rain barrel.
  addKeepOut(root.matrixWorld, new THREE.Box3(new THREE.Vector3(-PX - 0.06, -1, -PZ - 0.06), new THREE.Vector3(PX + 0.06, 5, TH + 0.04)));
  const barrel = meta.barrel;
  if (barrel) addKeepOut(root.matrixWorld, new THREE.Box3(new THREE.Vector3(barrel[0] - barrel[2], -1, barrel[1] - barrel[2]), new THREE.Vector3(barrel[0] + barrel[2], 1.2, barrel[1] + barrel[2])));

  const inv = root.matrixWorld.clone().invert();
  const _p = new THREE.Vector3();
  const inside = (x, z, margin = 0) => {
    _p.set(x, pos.y, z).applyMatrix4(inv);
    return Math.abs(_p.x) < PX + margin && _p.z > -PZ - margin && _p.z < TH + margin;
  };
  // Footsteps: on the flagstones and the threshold.
  const on = (feet) => {
    _p.copy(feet).applyMatrix4(inv);
    return Math.abs(_p.x) < IX + 0.05 && _p.z > -0.2 && _p.z < TH + 0.02 && _p.y > FL - 0.1 && _p.y < FL + 0.3;
  };
  return { root, meshes, atlas: asset.atlas, on, inside, empties };
}
