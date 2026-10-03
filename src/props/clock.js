import * as THREE from 'three';
import { GLTFLoader } from '../render/gltf.js';
import { patchMaterial } from '../render/materials.js';

// The ending's alarm clock (tools/blender/alarmclock_design.py: public/models/alarmclock.glb), a modern bedside clock:
// a long black pill in gloss, a thin brushed-gunmetal rim, a black glass face, and behind the glass blue LEDs: four
// seven-segment digits, a colon, AM and PM, and an alarm bell. Every LED carries its id in uv.x (digit k segment j is
// 7k + j, a..g = 0..6; the colon 28, AM 29, PM 30, the bell 31) and one shader lights them from uniforms, so changing
// the time is a few uniform writes (no texture uploads, no new programs). The black well behind them glows round the
// lit ones (distance fields of the same layout, from the model's META), so the digits halo in blue without leaning
// on the bloom: anything bright enough to bloom tone-maps to white, and these should stay blue.
//
// Loaded before the world is built (main.js), like the iris (props/aperture.js): the model is kept here and
// createClock() builds the clock from it synchronously (sequences/ending.js prepares it hidden before the preload).

let CLOCK = null;
export function setAlarmClockAsset(gltf, brushed = null) {
  const geo = {};
  let meta = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      const key = (o.material?.name || o.name).replace(/^clock_/, '');
      if (key !== 'collider') geo[key] = o.geometry.clone().applyMatrix4(o.matrixWorld);
    } else if (o.name === 'META') meta = o.userData;
  });
  CLOCK = { geo, meta, brushed };
  return CLOCK;
}
export async function loadAlarmClock() {
  const base = import.meta.env.BASE_URL + 'models/';
  const [gltf, brushed] = await Promise.all([
    new GLTFLoader().loadAsync(base + 'alarmclock.glb'),
    new THREE.TextureLoader().loadAsync(base + 'alarmclock_brushed.png').catch(() => null),
  ]);
  if (brushed) {
    brushed.flipY = false;
    brushed.wrapS = brushed.wrapT = THREE.RepeatWrapping;   // a seamless tile, streaks along u
    brushed.repeat.set(4, 4);
    brushed.anisotropy = 8;
    brushed.colorSpace = THREE.SRGBColorSpace;
  }
  return setAlarmClockAsset(gltf, brushed);
}

// Segments lit for each digit (bits a b c d e f g), as on the eyepiece's scales (render/postfx.js SEG7).
const SEG7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
// The LED blue (linear) and its levels at glow 1. Through the game's ACES tone mapping at the night's exposure
// (about 2..3) a lit segment shows about #2fa8ff; much brighter would turn it white. Unlit: a faint ghost.
const BLUE = new THREE.Color(0.0, 0.26, 1.0);
const LIT = 0.45, GHOST = 0.016, HALO = 0.16;
// The model's size and LED layout (its META; these are the design's numbers, for a model exported without them).
const LAYOUT = {
  w: 1, h: 0.3125, d: 0.15, glass_z: 0.069, digit_x: [-0.229, -0.089, 0.089, 0.229], digit_h: 0.215, digit_w: 0.108,
  stroke: 0.0255, slant: 0.12278, colon_y: 0.048, am_x: 0.341, ind_y: 0.032, bell_x: -0.341,
};
const f = (v) => Number(v).toFixed(5);

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// What both LED shaders share: the uniforms, which LEDs are lit, and the glow the lit ones cast on the well behind
// them (distance fields of the model's layout: the segments' centre lines, discs for the colon, AM, PM and the bell).
function common(m) {
  const xs = m.digit_w / 2 - m.stroke / 2, ys = m.digit_h / 2 - m.stroke / 2;
  return /* glsl */ `
uniform vec4 uSeg;     // the four digits' lit segments (bits a..g; 0 blank), left to right
uniform vec4 uInd;     // colon, AM, PM, bell: 0 or 1
uniform float uGlow;
uniform vec3 uBlue;
varying vec2 vUv;
varying vec3 vPos;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
// Distance to the centre lines of a digit's lit segments (mask m), the digit centred on the origin, upright.
float digitD(vec2 p, int m) {
  const float X = ${f(xs)}, Y = ${f(ys)};
  float r = 1e3;
  if ((m & 1) != 0) r = min(r, sdSeg(p, vec2(-X, Y), vec2(X, Y)));
  if ((m & 2) != 0) r = min(r, sdSeg(p, vec2(X, Y), vec2(X, 0.0)));
  if ((m & 4) != 0) r = min(r, sdSeg(p, vec2(X, 0.0), vec2(X, -Y)));
  if ((m & 8) != 0) r = min(r, sdSeg(p, vec2(-X, -Y), vec2(X, -Y)));
  if ((m & 16) != 0) r = min(r, sdSeg(p, vec2(-X, -Y), vec2(-X, 0.0)));
  if ((m & 32) != 0) r = min(r, sdSeg(p, vec2(-X, 0.0), vec2(-X, Y)));
  if ((m & 64) != 0) r = min(r, sdSeg(p, vec2(-X, 0.0), vec2(X, 0.0)));
  return r;
}
// The lit LEDs' glow at xy (the face's plane), 0..1.
float ledGlow(vec2 xy) {
  vec2 p = vec2(xy.x - xy.y * ${f(m.slant)}, xy.y);   // the digits lean: undo it
  float d = 1e3;
  float DX[4] = float[4](${m.digit_x.map(f).join(', ')});
  float S[4] = float[4](uSeg.x, uSeg.y, uSeg.z, uSeg.w);
  for (int k = 0; k < 4; k++) if (S[k] > 0.5) d = min(d, digitD(p - vec2(DX[k], 0.0), int(S[k] + 0.5)));
  d -= ${f(m.stroke / 2)};
  if (uInd.x > 0.5) d = min(d, length(vec2(p.x, abs(p.y) - ${f(m.colon_y)})) - 0.012);
  if (uInd.y > 0.5) d = min(d, length((xy - vec2(${f(m.am_x)}, ${f(m.ind_y)})) * vec2(0.55, 1.0)) - 0.012);
  if (uInd.z > 0.5) d = min(d, length((xy - vec2(${f(m.am_x)}, -${f(m.ind_y)})) * vec2(0.55, 1.0)) - 0.012);
  if (uInd.w > 0.5) d = min(d, length(xy - vec2(${f(m.bell_x)}, 0.0)) - 0.02);
  d = max(d, 0.0);
  return exp(-d / 0.005) * 0.7 + exp(-d / 0.02) * 0.3;
}
`;
}

// The LEDs: lit, or a faint ghost (with the glow of their lit neighbours behind them, through the diffuser).
function ledFrag(m) {
  return /* glsl */ `
${common(m)}
void main() {
  int id = int(floor(vUv.x));
  float on;
  if (id < 28) {
    int k = id / 7, j = id - k * 7;
    float m = k == 0 ? uSeg.x : k == 1 ? uSeg.y : k == 2 ? uSeg.z : uSeg.w;
    on = float((int(m + 0.5) >> j) & 1);
  } else {
    int k = id - 28;
    on = k == 0 ? uInd.x : k == 1 ? uInd.y : k == 2 ? uInd.z : uInd.w;
  }
  vec3 col;
  if (on > 0.5) {
    float a = abs(vUv.y * 2.0 - 1.0);   // a little brighter along a segment's middle (the diffuser)
    col = uBlue * (${f(GHOST)} + ${f(LIT)} * (1.12 - 0.3 * a * a) * uGlow);   // (never darker than an unlit one)
  } else {
    col = uBlue * (${f(GHOST)} + ${f(HALO * 0.85)} * uGlow * ledGlow(vPos.xy));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
}

// The black well behind the glass: dark, with the lit LEDs' glow spreading on it.
function wellFrag(m) {
  return /* glsl */ `
${common(m)}
void main() {
  vec3 col = uBlue * ${f(GHOST * 0.25)};
  if (vPos.z > 0.0 && uGlow > 0.0) col += uBlue * ${f(HALO)} * uGlow * ledGlow(vPos.xy);
  gl_FragColor = vec4(col, 1.0);
}
`;
}

// 12-hour display of `m` minutes since midnight: { h, mm, am, text } ("12:00", "1:07", "6:00").
export function clockDisplay(m) {
  const t = Math.floor(Number.isFinite(m) ? m : 0);
  const day = ((t % 1440) + 1440) % 1440;
  const h24 = Math.floor(day / 60), mm = day % 60;
  const h = h24 % 12 || 12;
  return { h, mm, am: h24 < 12, text: `${h}:${String(mm).padStart(2, '0')}` };
}

// The clock: a Group facing +z, centred on the pill's middle, W x H x D = userData.size (metres; the face reads from a
// couple of metres away). Shows 12:00 AM with the colon and the bell lit until told otherwise.
//   clock.setMinutes(m)  minutes since midnight (0 = 12:00 AM, 360 = 6:00 AM), any float (whole minutes shown)
//   clock.setColon(on)   the colon (blink it from outside)
//   clock.setGlow(v)     every LED's brightness: 1 a vivid blue at night, 0 dark; well above 1 they whiten, and from
//                        about 8 the digits reach the bloom
//   clock.setBell(on)    the alarm bell
// userData: size { w, h, d }, face (the glass's centre, local), display (what it shows: { h, mm, am, text }).
export function createClock() {
  const group = new THREE.Group();
  group.name = 'alarm-clock';
  const U = {
    uSeg: { value: new THREE.Vector4() },
    uInd: { value: new THREE.Vector4(1, 1, 0, 1) },
    uGlow: { value: 1 },
    uBlue: { value: BLUE.clone() },
  };
  const C = CLOCK;
  const meta = { ...LAYOUT, ...C?.meta };
  let rim = null;
  if (C) {
    const std = (o) => patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, ...o }));
    rim = std({
      name: 'clock-rim', color: 0x7d838c, metalness: 1, roughness: 0.62, map: C.brushed, roughnessMap: C.brushed,
      envMapIntensity: 1.2, emissive: BLUE, emissiveIntensity: 0.02,
    });
    const M = {
      body: patchMaterial(new THREE.MeshPhysicalMaterial({
        name: 'clock-body', vertexColors: true, color: 0x0b0c0e, roughness: 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.1,
      })),
      rim,
      grille: std({ name: 'clock-grille', color: 0x050506, roughness: 0.8 }),
      // Black glass: its reflections added in full over what is behind, which it darkens a little.
      glass: patchMaterial(new THREE.MeshStandardMaterial({
        name: 'clock-glass', color: 0x000000, roughness: 0.05, metalness: 0, envMapIntensity: 1.0, transparent: true, opacity: 0.15,
        depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      })),
      led: new THREE.ShaderMaterial({ name: 'clock-led', uniforms: U, vertexShader: VERT, fragmentShader: ledFrag(meta) }),
      face: new THREE.ShaderMaterial({ name: 'clock-well', uniforms: U, vertexShader: VERT, fragmentShader: wellFrag(meta) }),
    };
    for (const [key, geo] of Object.entries(C.geo)) {
      const mat = M[key];
      if (!mat) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'clock:' + key;
      mesh.castShadow = key === 'body' || key === 'rim';
      mesh.receiveShadow = key === 'body' || key === 'rim' || key === 'grille';
      if (key === 'glass') mesh.renderOrder = 7;   // after the ending's steam (6), which it sits in front of
      group.add(mesh);
    }
  } else {
    console.warn('clock: alarmclock.glb not loaded (loadAlarmClock)');
  }
  group.userData.size = { w: meta.w, h: meta.h, d: meta.d };
  group.userData.face = new THREE.Vector3(0, 0, meta.glass_z);

  let shown = NaN;
  group.setMinutes = (m) => {
    // (Called every frame through the count: only a new minute does any work.)
    const whole = Math.floor(Number.isFinite(m) ? m : 0);
    if (whole === shown) return;
    shown = whole;
    const d = clockDisplay(whole);
    U.uSeg.value.set(d.h >= 10 ? SEG7[1] : 0, SEG7[d.h % 10], SEG7[Math.floor(d.mm / 10)], SEG7[d.mm % 10]);
    U.uInd.value.y = d.am ? 1 : 0;
    U.uInd.value.z = d.am ? 0 : 1;
    group.userData.display = d;
  };
  group.setColon = (on) => { U.uInd.value.x = on ? 1 : 0; };
  group.setBell = (on) => { U.uInd.value.w = on ? 1 : 0; };
  group.setGlow = (v) => {
    U.uGlow.value = Math.max(0, v);
    if (rim) rim.emissiveIntensity = 0.02 * Math.max(0, v);
  };
  group.setMinutes(0);
  return group;
}
