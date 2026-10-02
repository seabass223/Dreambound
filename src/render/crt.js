import { UV_VERT } from './rig.js';

// The 70s CRT screens' content, drawn in the fragment shader (the observatory's consoles, props/observatory.js, and the
// bunker's scope and radar, props/bunkerRoom.js). The screen meshes' UVs pack a mode and an id in their integer parts
// (mode + u, id + v; tools/blender/observatory_design.py screen()), un-flipped from glTF by UV_VERT (render/rig.js),
// which also declares what crt() needs: vObsUv, uObsTime, uObsK and the hashes oh() and oh1(). Use it as
//   UV_VERT(shader, SCREEN_FRAG);  ...  diffuseColor.rgb = crt(vObsUv, tint) * uObsK;
// A material may bend the oscilloscope's trace by defining CRT_SCOPE_Y(p, t, y) (a function of the screen point, the
// time and the stock trace's height, returning the height to draw) ahead of SCREEN_FRAG.
export { UV_VERT };

// CRT content by mode: 0 terminal text, 1 oscilloscope, 2 radar sweep, 3 bar graph, 4 guider star field.
export const SCREEN_FRAG = /* glsl */ `
vec3 crt(vec2 u, vec3 tint) {
  float mode = floor(u.x), id = floor(u.y);
  vec2 p = fract(u);
  float t = uObsTime + id * 7.13;
  float v = 0.0;
  if (mode < 0.5) {
    vec2 cell = vec2(40.0, 18.0);
    vec2 g = p * cell;
    float row = floor(g.y), col = floor(g.x);
    float scroll = floor(t * 0.9);
    float line = row - scroll;
    float len = oh(vec2(line, id)) * 34.0 + 4.0;
    vec2 sub = floor(fract(g) * vec2(4.0, 6.0));
    float glyph = step(0.42, oh(vec2(col * 3.1 + line * 17.0, sub.x + sub.y * 4.0))) * step(0.5, sub.y) * step(sub.x, 2.5);
    v = glyph * step(col, len) * step(1.0, col) * step(0.3, oh(vec2(col, line + 91.0)));
    float cursor = step(abs(row - 1.0), 0.1) * step(abs(col - floor(len * 0.4) - 1.0), 0.1) * step(0.5, fract(t * 1.6));
    v = max(v, cursor * step(sub.y, 5.5));
  } else if (mode < 1.5) {
    vec2 grid = abs(fract(p * vec2(10.0, 8.0) + 0.5) - 0.5);
    v = 0.12 * (1.0 - smoothstep(0.0, 0.04, min(grid.x, grid.y)));
    float y = 0.5 + 0.3 * sin(p.x * 13.0 + t * 5.0) * (0.6 + 0.4 * sin(t * 0.7)) + 0.05 * sin(p.x * 61.0 - t * 17.0);
#ifdef CRT_SCOPE_Y
    y = CRT_SCOPE_Y(p, t, y);
#endif
    v += exp(-pow((p.y - y) * 60.0, 2.0)) * 1.2;
  } else if (mode < 2.5) {
    vec2 q = (p - 0.5) * vec2(1.25, 1.0);
    float r = length(q), a = atan(q.y, q.x + 1e-6);
    float sweep = mod(t * 1.3, 6.2831853);
    float lag = mod(sweep - a, 6.2831853);
    v = exp(-lag * 2.5) * 0.9 * step(r, 0.48);
    v += 0.15 * (1.0 - smoothstep(0.0, 0.006, abs(fract(r * 8.0 + 0.5) - 0.5) / 8.0)) * step(r, 0.48);
    for (int k = 0; k < 5; k++) {
      vec2 b = vec2(oh1(float(k) + id * 3.0), oh1(float(k) + 17.0 + id)) * 0.7 - 0.35;
      float ba = atan(b.y, b.x);
      float fresh = exp(-mod(sweep - ba, 6.2831853) * 0.9);
      v += fresh * (1.0 - smoothstep(0.008, 0.02, length(q - b))) * 1.5;
    }
  } else if (mode < 3.5) {
    float bars = 14.0;
    float bi = floor(p.x * bars);
    float h = 0.15 + 0.7 * (0.5 + 0.5 * sin(t * (1.0 + oh1(bi) * 2.0) + bi * 1.7)) * (0.6 + 0.4 * oh(vec2(bi, floor(t * 4.0))));
    float inBar = step(0.15, fract(p.x * bars)) * step(fract(p.x * bars), 0.85);
    v = inBar * step(p.y, h) * (0.7 + 0.3 * step(0.5, fract(p.y * 30.0)));
    v += 0.1 * step(abs(p.y - 0.05), 0.004);
  } else {
    vec2 q = p + vec2(t * 0.004, t * 0.0015);
    vec2 cell = floor(q * 24.0);
    vec2 f = fract(q * 24.0) - 0.5;
    float s = oh(cell);
    vec2 off = vec2(oh(cell + 3.1), oh(cell + 7.7)) - 0.5;
    float big = 0.3 + max(s - 0.82, 0.0) * 5.0;   // star size (guarded: no division by <= 0)
    v = step(0.82, s) * exp(-dot(f - off * 0.6, f - off * 0.6) * 90.0 / big) * 1.4;
    vec2 box = abs(p - vec2(0.5 + 0.02 * sin(t * 0.4), 0.5 + 0.02 * cos(t * 0.3)));
    v += 0.5 * step(max(box.x, box.y), 0.07) * step(0.062, max(box.x, box.y));
    v += 0.25 * step(abs(p.x - 0.5), 0.002) + 0.25 * step(abs(p.y - 0.5), 0.002);
  }
  float scan = 0.82 + 0.18 * sin(p.y * 420.0);
  float corner = smoothstep(0.75, 0.35, length((p - 0.5) * vec2(1.1, 1.2)));
  float flicker = 0.96 + 0.04 * sin(uObsTime * 57.0 + id);
  return tint * (0.05 + v) * scan * corner * flicker;
}
`;
