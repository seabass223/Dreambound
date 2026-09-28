// Stack wall material (WALLS.shader): the cliff material plus anti-tiling, a macro weathering layer and a macro
// normal, per stack. Used only for each stack's 'cliff' mesh; the tor, piles and hoods keep materials().cliff.
//
// All five stacks share ONE program ('db:n|wall'): three.js keys programs by the cache key, not the source, so
// the GLSL must be byte-identical for every stack and everything per stack is a uniform. Every pattern around the
// stack is periodic in u with the integer tile count of the S1a uvs, so nothing breaks at theta = 0.
// Hard rules (early-z under the opaque cloud sea hides ~750 m of wall per stack): no discard, no transparency or
// alphaTest, no gl_FragDepth, and the wall mesh is never registered with LodSystem.
import * as THREE from 'three';
import { CLOUD_DECK_Y } from '../config.js';
import { materials, patchMaterial } from './materials.js';

// tint is normalised to unit luminance (so gain alone sets brightness; 1.4 reads ~+20 % on screen over 1.0); lichen 0..1; q scales the rib/ledge normal
// and the fine streak octave (0 turns both off without a recompile).
export const WALL_LOOKS = {
  dome: { tint: [1.04, 1.0, 0.94], gain: 1.4, lichen: 0.25, q: 1 },
  rocks: { tint: [0.98, 1.0, 1.01], gain: 1.4, lichen: 0.5, q: 1 },
  mountain: { tint: [1.03, 1.0, 0.95], gain: 1.4, lichen: 0.25, q: 1 },
  tower: { tint: [0.95, 0.99, 1.05], gain: 1.4, lichen: 0.2, q: 1 },
  end: { tint: [1.08, 0.97, 0.9], gain: 1.4, lichen: 0.15, q: 1 },
};

// Texture tiles (4 m) around a wall: the integer u period of the S1a uvs.
export const wallTiles = (r) => Math.round(Math.PI * 2 * r / 4);

// Below this the cloud deck's dissolve is 1 whatever its noise (deck + 90 m, less the noise's 70 m reach).
const DECK_CUT = (CLOUD_DECK_Y + 20).toFixed(1);
// Means of the streak and lichen masks over the coarse streak noise, used where the masks fade out with range.
const STREAK_MEAN = '0.243', LICHEN_MEAN = '0.191';

const PARS_VERT = /* glsl */ `
varying float vWallZoom;`;

// Zoom relative to the normal field of view, as LodSystem and waterfx measure it (1 / tan(34 deg) = 0.6745).
const ZOOM_VERT = /* glsl */ `
vWallZoom = max(projectionMatrix[1][1] * 0.6745, 1e-3);`;

const PARS_FRAG = /* glsl */ `
uniform float uWallU;
uniform float uWallTop;
uniform float uWallSeed;
uniform vec3 uWallTint;
uniform float uWallGain;
uniform float uWallLichen;
uniform float uWallQ;
varying float vWallZoom;
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Lattice hash wrapped every P cells in x (P whole), per stack by uWallSeed.
float wHashP(vec2 i, float P) {
  i.x -= P * floor((i.x + 0.5) / P);
  return wHash(i + uWallSeed * vec2(17.0, 31.0));
}
// Value noise periodic in x with period P: .x the value, .y its x derivative (per cell).
vec2 wNoiseP(vec2 p, float P) {
  vec2 i = floor(p), f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  float a = wHashP(i, P), b = wHashP(i + vec2(1.0, 0.0), P);
  float c = wHashP(i + vec2(0.0, 1.0), P), d = wHashP(i + vec2(1.0, 1.0), P);
  return vec2(mix(mix(a, b, s.x), mix(c, d, s.x), s.y), 6.0 * f.x * (1.0 - f.x) * mix(b - a, d - c, s.y));
}
// Whole cells around the stack for about perTile cells per 4 m tile (at least 3, so End still varies).
float wCells(float perTile) { return max(floor(uWallU * perTile + 0.5), 3.0); }
// Noise over the wall: u around (0..uWallU), y world height; perTile cells per tile around, yScale cells per metre up.
vec2 wNoiseU(float u, float y, float perTile, float yScale) {
  float P = wCells(perTile);
  return wNoiseP(vec2(u * P / uWallU, y * yScale), P);
}`;

// Replaces map_fragment. Declares the main-scope values the later edits share.
const MAP_FRAG = /* glsl */ `
vec2 wuv = vMapUv;
vec2 wdx = dFdx(wuv), wdy = dFdy(wuv);
float wPx = 4.0 * max(length(wdx), length(wdy));   // metres per pixel (one uv unit is 4 m)
float wFd = distance(vFogWorld, cameraPosition);
float wDist = wFd / vWallZoom;                      // zoom-aware: the telescope keeps the near detail
float wy = vFogWorld.y, wd = uWallTop - wy;
// Where the fog (as FOG_FRAG computes it) or the cloud deck hides the wall, skip the extra work.
float wFog = 1.0 - exp(-pow(uFogDensity * (1.0 + uFogLow * smoothstep(-30.0, -300.0, wy)) * wFd, 1.35));
bool wOn = wFog < 0.98 && (wy > ${DECK_CUT} || uUnderground > 0.5);
float wNear = wOn ? 1.0 - smoothstep(110.0, 160.0, wDist) : 0.0;
// ~19 m noise: the anti-tiling regions near, and the bedding's fine warp at every range.
float wNk = wOn ? wNoiseU(wuv.x, wy, 0.21, 1.0 / 19.0).x : 0.5;
// Virtual-pattern anti-tiling (Quilez): ~19 m regions each offset the tile, blended across region edges; offsets
// only, so the normal map's tangent frame still holds. Past the near band, one plain fetch as before.
vec2 woa = vec2(0.0), wob = vec2(0.0);
float wB = 0.0;
vec4 wTex;
if (wNear > 0.0) {
  float wk = wNk * 8.0;
  woa = sin(vec2(3.0, 7.0) * floor(wk));
  wob = sin(vec2(3.0, 7.0) * (floor(wk) + 1.0));
  vec4 wca = textureGrad(map, wuv + woa, wdx, wdy), wcb = textureGrad(map, wuv + wob, wdx, wdy);
  wB = smoothstep(0.2, 0.8, fract(wk) - 0.1 * dot(wca.rgb - wcb.rgb, vec3(1.0)));
  wTex = mix(wca, wcb, wB);
  if (wNear < 1.0) wTex = mix(textureGrad(map, wuv, wdx, wdy), wTex, wNear);
} else {
  wTex = textureGrad(map, wuv, wdx, wdy);
}
diffuseColor *= wTex;`;

// After color_fragment: wavy bedding of uneven thickness, varnish streaks, lichen, broad patches and a weathered top.
const MACRO_FRAG = /* glsl */ `
vec3 wMacro = vec3(1.0);
float wBc = 0.0, wBandAmt = 0.0, wLine = 0.0;
// Band edges at least ~1.5 px wide (in band units): the renderer has no AA, so a hard step at each band would be a
// crisp line that crawls in a pan. Main scope, as the ledge in NORMAL_PRE uses it too.
float wEdge = 0.1;
if (wOn) {
  // Broad ~60 m noise: bends the beds (with the ~19 m one), sets how uneven they are here, and the light patches.
  float wPa = wNoiseU(wuv.x, wy, 0.067, 1.0 / 60.0).x;
  float wT = (wy + (wPa - 0.5) * 14.0 + (wNk - 0.5) * 4.0) / 7.5;
  // Uneven beds: a monotonic warp of the band coordinate by a smooth per-band offset (a hash of the 7.5 m base band);
  // wA <= 0.65 keeps dBc/dT > 0.02, so boundaries stay continuous and ordered. Beds ~4-12 m, thinning and
  // thickening around the stack with wPa.
  float wTi = floor(wT), wTf = wT - wTi;
  float wH0 = wHash(vec2(wTi, uWallSeed + 0.5)), wH1 = wHash(vec2(wTi + 1.0, uWallSeed + 0.5));
  float wA = 0.4 + 0.25 * wPa;
  wBc = wT + wA * (mix(wH0, wH1, wTf * wTf * (3.0 - 2.0 * wTf)) - 0.5);
  // The pixel footprint in band units (dBc/dy from the warp's derivative; the bends' own slope is left out).
  float wFoot = wPx * (1.0 + wA * 6.0 * wTf * (1.0 - wTf) * (wH1 - wH0)) / 7.5;
  wEdge = clamp(1.5 * wFoot, 0.02, 0.12);
  float wbf = fract(wBc);
  // The next band's colour blends in over this band's top, wider with the footprint (at most 0.6 of the band, so
  // the blend is complete at the wrap).
  float wbh = mix(wHash(vec2(floor(wBc), uWallSeed)), wHash(vec2(floor(wBc) + 1.0, uWallSeed)),
    smoothstep(1.0 - clamp(1.5 * wFoot, 0.1, 0.6), 1.0, wbf));
  vec3 wBand = mix(vec3(0.95, 0.99, 1.05), vec3(1.05, 1.0, 0.92), wbh) * (0.84 + 0.32 * wbh);
  // Bedding lines (the dark foot here, the ledge in NORMAL_PRE) gone before they would alias, and broken up: each
  // line fades in and out around the stack (~50 m cells, periodic in u), showing over ~60 % of the way round.
  wLine = 1.0 - smoothstep(0.25, 0.7, wPx);
  if (wLine > 0.0) {
    float wLp = wCells(0.08), wLx = wuv.x * wLp / uWallU, wLj = floor(wBc + 0.5) + 0.5;
    float wLi = floor(wLx), wLf = wLx - wLi;
    wLine *= smoothstep(0.3, 0.55, mix(wHashP(vec2(wLi, wLj), wLp), wHashP(vec2(wLi + 1.0, wLj), wLp),
      wLf * wLf * (3.0 - 2.0 * wLf)));
  }
  // The dark bedding line at each band's foot, zero at the wrap on both sides (and at mid-band, where wLj steps).
  wBand *= 1.0 - 0.12 * smoothstep(0.0, wEdge, wbf) * (1.0 - smoothstep(wEdge, wEdge + 0.07, wbf)) * wLine;
  wBandAmt = 1.0 - smoothstep(1.5, 4.0, wPx);
  wMacro = mix(vec3(1.0), wBand, wBandAmt);
  // Varnish streaks ~3.3 m across, 1:15; the fine octave fades out by footprint and with uWallQ.
  float ws = wNoiseU(wuv.x, wy, 1.2, 0.02).x;
  float wFine = uWallQ * (1.0 - smoothstep(0.5, 1.5, wPx));
  if (wFine > 0.0) ws = mix(ws, ws * 0.65 + wNoiseU(wuv.x, wy, 2.4, 0.04).x * 0.35, wFine);
  float wFar = 1.0 - smoothstep(1.5, 3.0, wPx);
  float wSf = 1.0 - smoothstep(25.0, 160.0, wd);
  float wStreak = mix(${STREAK_MEAN}, smoothstep(0.56, 0.78, ws), wFar) * wSf;
  // Over their mean, so the streaks move brightness around rather than take it from the gain.
  wMacro *= (vec3(1.0) - wStreak * vec3(0.34, 0.37, 0.4)) / (1.0 - ${STREAK_MEAN} * 0.37 * wSf);
  wMacro *= (0.86 + 0.28 * wPa) * (1.0 + 0.18 * (1.0 - smoothstep(2.0, 24.0, wd)));
  float wLich = mix(${LICHEN_MEAN}, smoothstep(0.62, 0.8, 1.0 - ws), wFar) * smoothstep(0.3, 0.7, wPa)
    * (1.0 - smoothstep(10.0, 40.0, wd)) * uWallLichen;
  // Hue only (unit luminance): the weathered top already lifts the rim, and the gain the whole wall.
  wMacro = mix(wMacro, wMacro * vec3(1.08, 1.16, 0.92) / 1.1257, wLich);
}
diffuseColor.rgb *= wMacro * uWallTint * uWallGain;`;

// Before the (patched) normal_fragment_maps: the normal map through the same virtual pattern, and the macro slope
// (~8 m joint ribs, bedding ledges) added in tangent space (x around the stack, y up).
const NORMAL_PRE = /* glsl */ `
vec4 wNrm;
if (wNear > 0.0) {
  wNrm = mix(textureGrad(normalMap, wuv + woa, wdx, wdy), textureGrad(normalMap, wuv + wob, wdx, wdy), wB);
  if (wNear < 1.0) wNrm = mix(textureGrad(normalMap, wuv, wdx, wdy), wNrm, wNear);
} else {
  wNrm = textureGrad(normalMap, wuv, wdx, wdy);
}
vec2 wSlope = vec2(0.0);
float wSa = wOn ? uWallQ * (1.0 - 0.6 * smoothstep(60.0, 220.0, wd)) * (1.0 - smoothstep(700.0, 1200.0, wDist)) : 0.0;
if (wSa > 0.0) {
  // Rib relief 2.2 m: slope per metre from the noise's per-cell derivative (a cell is 4 uWallU / wCells m).
  float wRib = -wNoiseU(wuv.x, wy, 0.5, 0.03).y * wCells(0.5) / (uWallU * 4.0) * 2.2;
  // Bedding ledge over each band's top, back to zero at the wrap; broken up and faded with the foot line.
  float wLf2 = fract(wBc);
  float wLedge = smoothstep(0.85, 1.0 - wEdge, wLf2) * (1.0 - smoothstep(1.0 - wEdge, 1.0, wLf2)) * 0.11 * wLine * wBandAmt;
  wSlope = vec2(wRib, wLedge) * wSa;
}`;

// The tangent-space fetch (the chunk's object-space branch has the same texture2D call, so match the whole line).
const NORMAL_FETCH = 'vec3 mapN = texture2D( normalMap, vNormalMapUv )';
const NORMAL_SCALE = 'mapN.xy *= normalScale;';
const TOKENS_VERT = ['#include <common>', '#include <project_vertex>'];
const TOKENS_FRAG = ['#include <common>', '#include <map_fragment>', '#include <color_fragment>', '#include <normal_fragment_maps>'];

let warned = false;
function wallHook(u) {
  return (shader) => {
    const chunk = THREE.ShaderChunk.normal_fragment_maps;
    const missing = [
      ...TOKENS_VERT.filter((t) => !shader.vertexShader.includes(t)),
      ...TOKENS_FRAG.filter((t) => !shader.fragmentShader.includes(t)),
      ...[NORMAL_FETCH, NORMAL_SCALE].filter((t) => !chunk.includes(t)),
    ];
    // A three.js upgrade that moved a token: render as the plain cliff rather than a half-patched shader.
    if (missing.length) {
      if (!warned) console.warn('wallMaterial: shader tokens missing, wall edits skipped:', missing);
      warned = true;
      return;
    }
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>' + PARS_VERT)
      .replace('#include <project_vertex>', '#include <project_vertex>' + ZOOM_VERT);
    // Keeps '#include <common>' first, so patchMaterial's FOG_PARS_FRAG (vFogWorld, fog uniforms) lands above ours.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + PARS_FRAG)
      .replace('#include <map_fragment>', MAP_FRAG)
      .replace('#include <color_fragment>', '#include <color_fragment>' + MACRO_FRAG)
      .replace('#include <normal_fragment_maps>', NORMAL_PRE + '\n' + chunk
        .replace(NORMAL_FETCH, 'vec3 mapN = wNrm')
        .replace(NORMAL_SCALE, NORMAL_SCALE + '\n\tmapN.xy += wSlope;'));
  };
}

// One material per stack (same parameters and shared textures as materials().cliff); its uniforms are also on
// userData.wall for tuning at runtime (e.g. uWallGain 1.2-1.6, uWallQ 0-1).
export function stackWallMaterial(stack, look = WALL_LOOKS[stack.cfg.name]) {
  const c = materials().cliff;
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, map: c.map, normalMap: c.normalMap, normalScale: c.normalScale.clone(),
    roughness: c.roughness, envMapIntensity: c.envMapIntensity,
  });
  m.name = 'wall:' + stack.cfg.name;
  const tint = new THREE.Vector3(...look.tint);
  tint.divideScalar(tint.dot(new THREE.Vector3(0.2126, 0.7152, 0.0722)));
  const u = {
    uWallU: { value: wallTiles(stack.r) }, uWallTop: { value: stack.top }, uWallSeed: { value: stack.seed },
    uWallTint: { value: tint }, uWallGain: { value: look.gain }, uWallLichen: { value: look.lichen }, uWallQ: { value: look.q },
  };
  m.userData.wall = u;
  m.onBeforeCompile = wallHook(u);
  patchMaterial(m);
  // After patchMaterial, which sets its own key: the wall must not share the plain 'db:n' cliff program.
  m.customProgramCacheKey = () => 'db:n|wall';
  return m;
}
