import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { AZ_SCALE, ALT_SCALE } from '../world/skyTarget.js';

const f = (v) => v.toFixed(6);   // a JS number as a GLSL float

const DreamShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uBlur: { value: 0 },
    uEdgeBlur: { value: 0.25 },
    uFade: { value: 1 },
    uWhite: { value: 0 },
    uShake: { value: new THREE.Vector2() },
    uScope: { value: 0 },
    uScopeAz: { value: 0 },
    uScopeAlt: { value: 0 },
    uGrain: { value: 0.022 },
    uGamma: { value: 1 },
    uGS: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uGM: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uGH: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uGBlend: { value: 1 },
    uGBalance: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect, uTime, uVignette, uBlur, uEdgeBlur, uFade, uWhite, uScope, uScopeAz, uScopeAlt, uGrain, uGamma, uGBlend, uGBalance;
    uniform vec3 uGS, uGM, uGH;
    // Three-way color grade: tints shadows, midtones and highlights; grey means no change.
    vec3 grade(vec3 c) {
      float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float pivot = 0.5 + uGBalance * 0.3;
      float wS = 1.0 - smoothstep(0.0, pivot, L);
      float wH = smoothstep(pivot, 1.0, L);
      float wM = clamp(1.0 - wS - wH, 0.0, 1.0);
      vec3 g = c + (uGS - 0.5) * 0.5 * wS + (uGM - 0.5) * 0.5 * wM + (uGH - 0.5) * 0.5 * wH;
      return mix(c, max(g, 0.0), uGBlend);
    }
    uniform vec2 uRes, uShake;
    varying vec2 vUv;
    const vec2 DISK[12] = vec2[](
      vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
      vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
      vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    // Anti-aliased line of half-width w (in the same units as d).
    float aline(float d, float w, float px) { return 1.0 - smoothstep(w, w + px, abs(d)); }
    // Distance to the nearest mark of a scale with the given spacing.
    float mark(float x, float spacing) { return abs(fract(x / spacing + 0.5) - 0.5) * spacing; }
    const float FIELD = 0.425;
    const float DEG = 57.29578;
    // The scales read like the roof station's (world/skyTarget.js): the ring in compass headings, the altitude scale in
    // degrees of tube elevation.
    const float AZ_MINOR = ${f(AZ_SCALE.minor)}, AZ_MAJOR = ${f(AZ_SCALE.major)};
    const float ALT_MIN = ${f(ALT_SCALE.min)}, ALT_MAX = ${f(ALT_SCALE.max)}, ALT_MINOR = ${f(ALT_SCALE.minor)}, ALT_MAJOR = ${f(ALT_SCALE.major)};
    const float ALT_H = 0.34;                  // the altitude scale's half-height (screen heights), ALT_MIN at the bottom
    const float ALT_K = 2.0 * ALT_H / (ALT_MAX - ALT_MIN);   // screen height per degree on it
    const vec3 GOLD = vec3(1.0, 0.86, 0.22);   // the ring's index and the tube's arrow on the altitude scale
    // Seven-segment digits (bits a b c d e f g), drawn as distance fields so they stay crisp at any angle.
    const int SEG7[10] = int[](0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F);
    float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
    float digitDist(vec2 p, int d) {
      int m = SEG7[d];
      const float X = 0.25, Y = 0.5;
      float r = 1e3;
      if ((m & 1) != 0) r = min(r, sdSeg(p, vec2(-X, Y), vec2(X, Y)));
      if ((m & 2) != 0) r = min(r, sdSeg(p, vec2(X, Y), vec2(X, 0.0)));
      if ((m & 4) != 0) r = min(r, sdSeg(p, vec2(X, 0.0), vec2(X, -Y)));
      if ((m & 8) != 0) r = min(r, sdSeg(p, vec2(-X, -Y), vec2(X, -Y)));
      if ((m & 16) != 0) r = min(r, sdSeg(p, vec2(-X, 0.0), vec2(-X, -Y)));
      if ((m & 32) != 0) r = min(r, sdSeg(p, vec2(-X, Y), vec2(-X, 0.0)));
      if ((m & 64) != 0) r = min(r, sdSeg(p, vec2(-X, 0.0), vec2(X, 0.0)));
      return r;
    }
    // Distance (in glyph heights) to the whole number v written centred on the origin; only the digit under p is tested.
    float numberDist(vec2 p, float v) {
      int iv = int(v + 0.5);
      int n = iv < 10 ? 1 : iv < 100 ? 2 : 3;
      const float ADV = 0.8;
      int i = int(clamp(floor(p.x / ADV + float(n) * 0.5), 0.0, float(n - 1)));
      int div = n - 1 - i == 2 ? 100 : n - 1 - i == 1 ? 10 : 1;
      return digitDist(vec2(p.x - (float(i) - float(n - 1) * 0.5) * ADV, p.y), (iv / div) % 10);
    }
    // A brass pointer like the roof station's: a triangle with its apex at u = 0, widening to half-width hw at u = len
    // (w across it). Returns (coverage, shade), with a darker rim so it stands off the amber marks.
    vec2 pointer(float u, float w, float len, float hw, float px) {
      float s = hw / len;
      float sd = max((abs(w) - u * s) / sqrt(1.0 + s * s), max(u - len, -u));
      float cov = 1.0 - smoothstep(-0.5 * px, 0.5 * px, sd);
      float shade = (0.8 + 0.3 * (1.0 - u / len)) * mix(1.0, 0.5, smoothstep(-1.2 * px, -0.2 * px, sd));
      return vec2(cov, shade);
    }
    // The telescope eyepiece: field stop, etched reticle, and outside it an amber-lit azimuth ring that turns
    // with the dome under a fixed gold index, and a fixed altitude scale with a gold arrow that rides it with the tube,
    // both numbered.
    vec3 eyepiece(vec3 col, vec2 uv) {
      vec2 sc = uv - 0.5; sc.x *= uAspect;
      float sr = length(sc);
      float px = 1.0 / uRes.y;
      float field = smoothstep(FIELD, FIELD - 2.0 * px, sr);
      vec3 inner = col * (1.0 - 0.38 * smoothstep(0.16, FIELD, sr));
      inner += vec3(0.015, 0.04, 0.1) * smoothstep(FIELD - 0.03, FIELD, sr);
      inner *= 1.0 - step(0.9993, hash(floor(uv * uRes / 2.5))) * 0.35;       // dust on the reticle glass
      vec2 a = abs(sc);
      float lw = 0.6 * px;
      float ret = 0.0;
      ret += aline(a.x - 0.0032, lw, px) * step(0.035, a.y);                   // double crosshair
      ret += aline(a.y - 0.0032, lw, px) * step(0.035, a.x);
      ret += aline(sr - 0.055, lw, px);                                        // centring circle
      ret += aline(sr - 0.2, lw, px) * step(0.5, fract(atan(sc.y, sc.x + 1e-6) * 18.0 / 6.2831853));   // dashed ring
      float bigX = step(mark(sc.x, 0.1), 1.5 * px), bigY = step(mark(sc.y, 0.1), 1.5 * px);
      ret += aline(mark(sc.x, 0.025), lw, px) * step(a.y, mix(0.007, 0.016, bigX)) * step(0.07, a.x);
      ret += aline(mark(sc.y, 0.025), lw, px) * step(a.x, mix(0.007, 0.016, bigY)) * step(0.07, a.y);
      inner = mix(inner, vec3(0.01, 0.012, 0.015), clamp(ret, 0.0, 1.0) * 0.9);
      inner += vec3(0.9, 0.12, 0.05) * (1.0 - smoothstep(1.2 * px, 2.4 * px, sr)) * 0.6;   // tiny lit centre dot

      vec3 amber = vec3(1.0, 0.6, 0.22);
      vec3 outer = vec3(0.01) * (1.0 - smoothstep(FIELD, FIELD + 0.2, sr));
      float band = smoothstep(FIELD + 0.012, FIELD + 0.015, sr) * smoothstep(FIELD + 0.052, FIELD + 0.049, sr);
      // Ring: the heading under the index is the compass heading the dome faces (yawToAz: 0 north), growing clockwise
      // as on the station's ring; it slides left as the dome turns right, like the view.
      float ang = atan(sc.x, sc.y + 1e-6) + uScopeAz;
      float arc = sr;
      float t5 = mark(ang, AZ_MINOR / DEG) * arc, t30 = mark(ang, AZ_MAJOR / DEG) * arc;
      float ringTicks = aline(t5, 0.7 * px, px) * smoothstep(FIELD + 0.034, FIELD + 0.037, sr)
        + aline(t30, 1.1 * px, px) * smoothstep(FIELD + 0.029, FIELD + 0.032, sr);
      outer += amber * 0.05 * band;
      outer += amber * 0.55 * ringTicks * band;
      if (sr > FIELD + 0.012 && sr < FIELD + 0.03) {
        // Numbers every 30 deg inside their ticks, upright to the ring's outer edge (as on the station's ring).
        float hd = mod(ang * DEG - 90.0, 360.0);
        float k = floor(hd / AZ_MAJOR + 0.5);
        const float H = 0.012;
        vec2 p = vec2((hd - k * AZ_MAJOR) / DEG * sr, sr - (FIELD + 0.0215)) / H;
        outer += amber * 0.6 * aline(numberDist(p, mod(k * AZ_MAJOR, 360.0)) * H, 0.08 * H, px);
      }
      // Fixed index at the top of the ring: a gold arrow like the altitude scale's, apex down onto the ring, with a
      // hairline across its ticks at the heading the dome faces.
      {
        float y0 = FIELD + 0.047;
        outer += GOLD * 0.6 * aline(sc.x, 0.5 * px, px) * step(FIELD + 0.03, sc.y) * step(sc.y, y0);
        vec2 ga = pointer(sc.y - y0, sc.x, 0.024, 0.012, px);
        outer = mix(outer, GOLD * ga.y * 1.2, ga.x);
      }
      // Altitude scale to the right, fixed: ALT_MIN at the bottom to ALT_MAX at the top. A gold arrow on its left
      // slides up and down it with the tube's elevation.
      vec2 q = sc - vec2(FIELD + 0.09, 0.0);
      if (abs(q.y) < ALT_H + 0.03 && q.x > -0.045 && q.x < 0.045) {
        float v = ALT_MIN + (q.y + ALT_H) / ALT_K;   // the scale's reading at this height
        float onScale = step(ALT_MIN - 0.3, v) * step(v, ALT_MAX + 0.3);
        float big = step(mark(v, ALT_MAJOR) * ALT_K, 1.5 * px);
        float tl = mix(0.012, 0.03, big);
        outer += amber * 0.55 * aline(mark(v, ALT_MINOR) * ALT_K, 0.6 * px, px) * step(-0.012, q.x) * step(q.x, tl - 0.012) * onScale;
        outer += amber * 0.3 * aline(q.x + 0.012, 0.6 * px, px) * step(abs(q.y), ALT_H);   // the scale's spine
        float vv = floor(v / ALT_MAJOR + 0.5) * ALT_MAJOR;
        if (vv >= ALT_MIN && vv <= ALT_MAX && q.x > 0.021) {
          const float H = 0.011;
          vec2 p = vec2(q.x - 0.031, q.y - (-ALT_H + (vv - ALT_MIN) * ALT_K)) / H;
          outer += amber * 0.6 * aline(numberDist(p, vv) * H, 0.08 * H, px);
        }
        // The tube's arrow, apex right, with a hairline across the ticks: where it stands on the scale.
        float yCur = -ALT_H + (clamp(uScopeAlt * DEG, ALT_MIN, ALT_MAX) - ALT_MIN) * ALT_K;
        outer += GOLD * 0.6 * aline(q.y - yCur, 0.5 * px, px) * step(-0.014, q.x) * step(q.x, 0.019);
        vec2 ga = pointer(-0.014 - q.x, q.y - yCur, 0.034, 0.015, px);
        outer = mix(outer, GOLD * ga.y * 1.2, ga.x);
      }
      return mix(outer, inner, field);
    }
    void main() {
      vec2 uv = vUv + uShake;
      vec2 c = uv - 0.5; c.x *= uAspect;
      float r = length(c);
      float b = uBlur + uEdgeBlur * smoothstep(0.35, 0.95, r) * (1.0 - uScope);
      vec3 col;
      if (uScope > 0.5) {
        // Through the eyepiece: gentle barrel distortion and a hint of colour fringing toward the edge.
        vec2 d = uv - 0.5;
        float e = dot(vec2(d.x * uAspect, d.y), vec2(d.x * uAspect, d.y)) / (FIELD * FIELD);
        vec2 base = 0.5 + d * (1.0 - 0.08 * e);
        float ca = 0.004 * e;
        col = vec3(texture2D(tDiffuse, base + d * ca).r, texture2D(tDiffuse, base).g, texture2D(tDiffuse, base - d * ca).b);
      } else if (b > 0.002) {
        float rad = b * 0.022;
        float ang = hash(gl_FragCoord.xy) * 6.2831;
        mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        col = texture2D(tDiffuse, uv).rgb;
        for (int i = 0; i < 12; i++) {
          vec2 o = rot * DISK[i] * rad; o.x /= uAspect;
          col += texture2D(tDiffuse, uv + o).rgb;
        }
        col /= 13.0;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      col = pow(max(col, 0.0), vec3(1.0 / uGamma));
      col = grade(col);
      float vig = smoothstep(1.05, 0.2, r);
      col *= mix(1.0, vig, uVignette);
      col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uGrain;
      if (uScope > 0.0) col = mix(col, eyepiece(col, vUv), uScope);
      col = mix(col, vec3(0.0), uFade);
      col = mix(col, vec3(1.0), uWhite);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPostFX(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.55, 1.35);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const dream = new ShaderPass(DreamShader);
  composer.addPass(dream);

  const u = dream.uniforms;
  const fx = {
    composer, bloom, dream,
    vignette: 0.35, blur: 0, edgeBlur: 0.1, fade: 1, white: 0, scope: 0, scopeAz: 0, scopeAlt: 0,
    bloomStrength: 0.35,
    shake: 0,
    gamma: 1,
    brightness: 1,
    grade: { shadows: u.uGS.value, mids: u.uGM.value, highs: u.uGH.value, blend: 1, balance: 0 },
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.resolution.set(w / 2, h / 2);
      u.uAspect.value = w / h;
      u.uRes.value.set(w, h);
    },
    render(t) {
      u.uTime.value = t;
      u.uVignette.value = fx.vignette;
      u.uBlur.value = fx.blur;
      u.uEdgeBlur.value = fx.edgeBlur;
      u.uFade.value = fx.fade;
      u.uWhite.value = fx.white;
      u.uScope.value = fx.scope;
      u.uScopeAz.value = fx.scopeAz;
      u.uScopeAlt.value = fx.scopeAlt;
      u.uGamma.value = fx.gamma;
      u.uGBlend.value = fx.grade.blend;
      u.uGBalance.value = fx.grade.balance;
      const s = fx.shake * 0.006;
      u.uShake.value.set((Math.sin(t * 47.3) + Math.sin(t * 71.9)) * s, (Math.sin(t * 53.1 + 1.3) + Math.sin(t * 89.7)) * s);
      bloom.strength = fx.bloomStrength;
      composer.render();
    },
  };
  fx.setSize(size.x, size.y);
  return fx;
}
