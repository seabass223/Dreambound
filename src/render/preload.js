import * as THREE from 'three';
import { fadeVariant } from './lod.js';

// The preloader: everything the GPU will ever need is made behind the black screen, before the player wakes, so no
// view in the game compiles a shader or uploads a texture or a buffer the first time it is seen. three.js does all
// of that lazily (programs when a material is first drawn in a new state, geometry and textures on first draw), and
// Windows drivers (ANGLE) finish a shader only on its first real draw.
//
// Phases, each sliced into short tasks so the page stays responsive (the progress line keeps moving):
//   compile   every material, and every LOD fade twin, for the render target the scene renders into, with the
//             scene's lights, fog and environment (compileAsync: the driver compiles in parallel off the main thread)
//   textures  every texture any material or shader uniform holds, uploaded (initTexture)
//   draw      every object made visible (hidden zones, LOD levels and fade twins, far stand-ins, instanced levels,
//             interiors, effects), unculled, drawn once into a small target of the same format, a slice at a time,
//             with the shadow map rendering: geometry uploads, shadow depth programs and the drivers' draw-time work
//   hooks     things that allocate on first use (the cabin's reflection probe, the environment map)
//   states    a real frame (every pass) of each representative state: surface day and night, tunnel, lounge, eyepiece
// Then every object's visibility, culling, instance count and material is put back exactly, and the LOD re-applies.
//
// Browser only: main.js calls it after buildWorld; the headless regression harness never imports it.

// Yield to the event loop (and let the page paint). A MessageChannel, not setTimeout: timers are throttled in
// background tabs, and a page loaded in one would preload at one slice a second.
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const queue = [];
if (channel) channel.port1.onmessage = () => queue.shift()?.();
const tick = () => new Promise((r) => { if (channel) { queue.push(r); channel.port2.postMessage(0); } else setTimeout(r, 0); });

const SLICE_MS = 14;   // work per task before yielding

const materialsOf = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);

export async function preload({ renderer, scene, camera, target, lod, hooks = [], states = [], onProgress = () => {} }) {
  const t0 = performance.now();
  // Yields between slices, keeping the longest stretch the page went without one (for the dev stats).
  let lastYield = t0, longest = 0, longestIn = '', current = 'compile';
  const pause = async () => {
    const d = performance.now() - lastYield;
    if (d > longest) { longest = d; longestIn = current; }
    await tick();
    lastYield = performance.now();
  };
  const times = {};
  let phaseT = t0;
  const phase = (name) => { const t = performance.now(); times[name] = Math.round(t - phaseT); phaseT = t; };
  // Progress: each phase fills its share of the line.
  const W = { compile: 0.4, textures: 0.1, draw: 0.35, hooks: 0.05, states: 0.1 };
  let base = 0;
  const progress = (name, f) => onProgress(Math.min(1, base + W[name] * f));
  const done = (name) => { base += W[name]; onProgress(Math.min(1, base)); phase(name); current = Object.keys(W)[Object.keys(W).indexOf(name) + 1]; };

  const prevTarget = renderer.getRenderTarget();
  // ---- reveal: everything that can ever be drawn, drawn, and not culled ----
  const saved = [];
  scene.traverse((o) => {
    saved.push([o, o.visible, o.frustumCulled, o.isInstancedMesh || o.isBatchedMesh ? o.count : -1, o.material]);
    o.visible = true;
    o.frustumCulled = false;
    if (o.isInstancedMesh && o.count === 0) o.count = 1;   // instanced LOD levels start empty
  });
  // The LOD's dithered twins: attached only while something is fading, so swapped in for a second pass.
  const fades = [];
  for (const e of lod.entries) {
    if (!e.fade) continue;
    e.meshes.forEach((m, i) => fades.push([m, e.base[i], fadeVariant(e.base[i], { in: e.fin, out: e.out })]));
  }
  const useFades = (on) => { for (const [m, b, v] of fades) m.material = on ? v : b; };
  // Visibility, culling, instance counts and materials exactly as they were before the preload.
  const restore = () => {
    renderer.setRenderTarget(prevTarget);
    for (const [o, v, f, c, m] of saved) {
      o.visible = v; o.frustumCulled = f;
      if (c >= 0) o.count = c;
      if (o.material !== m) o.material = m;
    }
  };

  // Slices: subtrees small enough to compile or draw in one task (the scene's top level, split two levels down).
  const slices = [];
  const split = (o, depth) => {
    if (o.isLight) return;
    if (depth < 3 && o.children.length > 1 && !o.material) o.children.forEach((c) => split(c, depth + 1));
    else slices.push(o);
  };
  scene.children.forEach((c) => split(c, 0));

  try {
    // ---- compile ----
    // Shaders are compiled for the target the scene really renders into (linear, not tone-mapped): compiled for the
    // screen, they would all be compiled again on the first frame.
    renderer.setRenderTarget(target);
    const pending = [];
    const compile = (root) => (renderer.compileAsync ? pending.push(renderer.compileAsync(root, camera, scene)) : renderer.compile(root, camera, scene));
    for (const pass of [false, true]) {
      useFades(pass);
      let t = performance.now();
      for (let i = 0; i < slices.length; i++) {
        compile(slices[i]);
        if (performance.now() - t > SLICE_MS) {
          progress('compile', ((pass ? slices.length : 0) + i) / (slices.length * 2) * 0.7);
          renderer.setRenderTarget(prevTarget);
          await pause();
          renderer.setRenderTarget(target);
          t = performance.now();
        }
      }
    }
    useFades(false);
    renderer.setRenderTarget(prevTarget);
    // Wait for the parallel compiles to finish (polled by three.js).
    let ready = 0;
    await Promise.all(pending.map((p) => p.then(() => progress('compile', 0.7 + 0.3 * (++ready / pending.length)))));
    lastYield = performance.now();
    done('compile');

    // ---- textures ----
    const textures = new Set();
    const add = (v) => { if (v && v.isTexture && !v.isRenderTargetTexture) textures.add(v); };
    const scan = (m) => {
      for (const v of Object.values(m)) add(v);
      for (const u of Object.values(m.uniforms || {})) add(u?.value);
      for (const u of Object.values(renderer.properties.get(m).uniforms || {})) add(u?.value);   // onBeforeCompile's
    };
    scene.traverse((o) => materialsOf(o).forEach(scan));
    for (const [, , v] of fades) scan(v);
    let k = 0, t = performance.now();
    for (const tex of textures) {
      renderer.initTexture(tex);
      if (performance.now() - t > SLICE_MS) { progress('textures', ++k / textures.size); await pause(); t = performance.now(); } else k++;
    }
    done('textures');

    // ---- draw ----
    // A small target of the same type as the real one: drivers build shader variants per target format, and a
    // small one keeps the fill cost of drawing the whole world at once low.
    const small = new THREE.WebGLRenderTarget(64, 64, { type: target.texture.type, format: target.texture.format, colorSpace: target.texture.colorSpace });
    const shadowLights = [];
    scene.traverse((o) => { if (o.isLight && o.castShadow) shadowLights.push(o); });
    for (const pass of [false, true]) {
      useFades(pass);
      for (const s of slices) s.visible = false;
      t = performance.now();
      for (let i = 0; i < slices.length; i++) {
        slices[i].visible = true;
        for (const l of shadowLights) l.shadow.needsUpdate = true;   // the depth programs for its casters, too
        renderer.setRenderTarget(small);
        renderer.render(scene, camera);
        slices[i].visible = false;
        if (performance.now() - t > SLICE_MS) {
          progress('draw', ((pass ? slices.length : 0) + i) / (slices.length * 2));
          renderer.setRenderTarget(prevTarget);
          await pause();
          t = performance.now();
        }
      }
      for (const s of slices) s.visible = true;
    }
    useFades(false);
    renderer.setRenderTarget(prevTarget);
    small.dispose();
    done('draw');
  } finally {
    restore();
  }

  // ---- hooks and representative states (real frames, with the game's own visibility) ----
  try {
    for (let i = 0; i < hooks.length; i++) { hooks[i](); progress('hooks', (i + 1) / hooks.length); await pause(); }
    done('hooks');
    for (let i = 0; i < states.length; i++) { states[i](); progress('states', (i + 1) / states.length); await pause(); }
    done('states');
  } finally {
    restore();
    // The LOD and the instanced levels re-apply themselves on the next update, from scratch.
    for (const e of lod.entries) e.state = -1;
    for (const il of lod.instanced) il.at.set(1e9, 0, 0);
  }

  times.total = Math.round(performance.now() - t0);
  return { times, longestTask: Math.round(longest), longestIn, programs: renderer.info.programs?.length ?? 0, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, slices: slices.length };
}
