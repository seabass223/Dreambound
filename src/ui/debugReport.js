import * as THREE from 'three';
import { WALLS, TUNNEL_ORIGIN } from '../config.js';

// Debug reports (Escape panel > Debug reports): F8 or a middle click casts a ray from the view's centre and copies a
// JSON snapshot (where you stand and look, what the ray hits, the game state) to the clipboard, for bug reports.
// It only reads the game; nothing here changes what the game does.

const R = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const vec = (v) => (v ? { x: R(v.x), y: R(v.y), z: R(v.z) } : null);
const deg = (r) => R(THREE.MathUtils.radToDeg(r), 2);

// JSON-safe copy of arbitrary state: rounded numbers, no functions or three.js objects, no cycles, short arrays.
function clean(v, depth = 0, seen = new Set()) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return R(v);
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v !== 'object') return undefined;
  if (v.isVector3 || v.isVector2) return v.isVector3 ? vec(v) : { x: R(v.x), y: R(v.y) };
  if (v.isObject3D || v.isMaterial || v.isTexture || v.isBufferGeometry) return `[${v.type}${v.name ? ' ' + v.name : ''}]`;
  if (seen.has(v) || depth > 6) return '[…]';
  seen.add(v);
  let out;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = Array.from(v.length > 64 ? Array.prototype.slice.call(v, -64) : v, (x) => clean(x, depth + 1, seen) ?? null);
    out = v.length > 64 ? { length: v.length, last64: a } : a;
  } else {
    out = {};
    for (const [k, x] of Object.entries(v)) { const c = clean(x, depth + 1, seen); if (c !== undefined) out[k] = c; }
  }
  seen.delete(v);
  return out;
}

const pathOf = (o) => {
  const names = [];
  for (let p = o; p && !p.isScene; p = p.parent) names.unshift(p.name || p.type);
  return names;
};

const CSS = `
#debug-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); padding: 6px 12px; border-radius: 6px;
  background: rgba(18, 20, 26, 0.72); color: #e9e2d2; font: 13px/1.3 Georgia, 'Times New Roman', serif; letter-spacing: 0.02em;
  pointer-events: none; z-index: 6; opacity: 0; transition: opacity 0.25s ease; max-width: calc(100vw - 32px); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
#debug-toast.show { opacity: 1; }
`;

export function createDebugReport({ ctx, player, camera, clock, renderer, scene, physics, interact, settings, fx, skip = [], game, pressableAhead }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const toast = document.createElement('div');
  toast.id = 'debug-toast';
  document.body.appendChild(toast);
  let toastTimer = 0;
  const show = (text) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
  };

  const ray = new THREE.Raycaster();
  const center = new THREE.Vector2(0, 0);
  const skipSet = new Set(skip);
  let dtAvg = 1 / 60;

  // Meshes you can actually see: visible all the way up, on the camera's layers, with a visible material.
  const visibleMeshes = () => {
    const out = [];
    const walk = (o) => {
      if (!o.visible || skipSet.has(o)) return;
      if (o.isMesh && o.layers.test(camera.layers)) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.some((m) => m && m.visible !== false)) out.push(o);
      }
      for (const c of o.children) walk(c);
    };
    walk(scene);
    return out;
  };

  const nearestStack = (p) => {
    let best = null, bestD = Infinity;
    for (const [name, st] of Object.entries(ctx.stacks)) {
      const d = Math.hypot(p.x - st.cx, p.z - st.cz) - st.r;
      if (d < bestD) { bestD = d; best = [name, st]; }
    }
    if (!best) return null;
    const [name, st] = best;
    const ground = st.heightAt?.(p.x, p.z);
    return {
      name,
      local: { x: R(p.x - st.cx), y: R(p.y - st.top), z: R(p.z - st.cz) },   // from the stack's centre and top height
      edgeDist: R(st.edgeDist ? st.edgeDist(p.x, p.z) : st.r - Math.hypot(p.x - st.cx, p.z - st.cz)),   // + inside
      groundY: ground == null ? null : R(ground),
    };
  };

  // Where a point is: on (or near) a stack at the surface, or in the tunnel network far below.
  const whereIs = (p, zone) => (zone === 'tunnel'
    ? { tunnel: { local: { x: R(p.x - TUNNEL_ORIGIN.x), y: R(p.y - TUNNEL_ORIGIN.y), z: R(p.z - TUNNEL_ORIGIN.z) }, inLounge: !!ctx.tunnels.lounge?.inside?.(p) } }
    : { stack: nearestStack(p) });

  const castVisible = () => {
    ray.setFromCamera(center, camera);
    ray.far = camera.far;
    const t0 = performance.now();
    const hits = ray.intersectObjects(visibleMeshes(), false);
    const ms = performance.now() - t0;
    const h = hits[0];
    if (!h) return { hit: null, ms };
    const o = h.object;
    let normal = null;
    if (h.face) {
      const m = new THREE.Matrix4().copy(o.matrixWorld);
      if (o.isInstancedMesh && h.instanceId != null) { const im = new THREE.Matrix4(); o.getMatrixAt(h.instanceId, im); m.multiply(im); }
      normal = vec(h.face.normal.clone().transformDirection(m));
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const mat = mats[h.face?.materialIndex ?? 0] ?? mats[0];
    const path = pathOf(o);
    return {
      ms,
      hit: {
        point: vec(h.point),
        distance: R(h.distance),
        normal,
        object: o.name || null,
        type: o.type,
        path,
        instanceId: h.instanceId ?? null,
        material: mat ? { name: mat.name || null, type: mat.type } : null,
        layer: o.userData?.layer ?? null,
        // The outermost named thing below the zone group (a stack, a prop, a batch), for a quick "what is it".
        owner: path.find((n, i) => i > 0 && !/^(Group|Object3D|Mesh|InstancedMesh)$/.test(n)) ?? path[0],
        ...whereIs(h.point, player.zone),
      },
    };
  };

  // The collision world along the same ray (only the player's zone, only what is switched on).
  const castCollision = () => {
    let best = null;
    for (const c of physics.colliders) {
      if (!c.enabled || c.zone !== player.zone || !c.bvh) continue;
      const h = c.bvh.raycastFirst(ray.ray, THREE.DoubleSide, 0, camera.far);
      if (h && (!best || h.distance < best.distance)) best = { collider: c.name ?? null, point: vec(h.point), distance: R(h.distance), normal: vec(h.face?.normal) };
    }
    return best;
  };

  const underReticle = () => {
    const p = interact.pick();
    const held = interact.held;
    return {
      pressable: pressableAhead(),
      item: p ? { name: p.item.name ?? null, mesh: p.hit.object?.name || null, path: pathOf(p.hit.object), range: p.item.range, distance: R(p.hit.distance), point: vec(p.hit.point), viaCone: !p.hit.face } : null,
      held: held ? held.name ?? '[unnamed]' : null,
    };
  };

  const build = () => {
    const g = game();
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const vis = castVisible();
    const info = renderer.info;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    let observatory = null;
    try { observatory = ctx.observatory ? { ladderAligned: ctx.observatory.ladder?.aligned?.() ?? null } : null; } catch { /* optional */ }
    return {
      kind: 'dreambound-debug-report',
      time: new Date().toISOString(),
      url: location.href,
      query: Object.fromEntries(new URLSearchParams(location.search)),
      build: {
        version: typeof __DREAMBOUND_VERSION__ !== 'undefined' ? __DREAMBOUND_VERSION__ : null,   // eslint-disable-line no-undef
        built: typeof __DREAMBOUND_BUILD__ !== 'undefined' ? __DREAMBOUND_BUILD__ : null,          // eslint-disable-line no-undef
        mode: import.meta.env?.MODE ?? null,
        three: THREE.REVISION,
      },
      clock: { phase: R(clock.phase, 4), altDeg: R(clock.altDeg, 2), night: clock.altDeg < 0, speed: R(clock.speed) },
      game: clean(g),
      player: {
        feet: vec(player.feet),
        eye: vec(eye),
        yaw: R(player.yaw, 4), pitch: R(player.pitch, 4),
        yawDeg: deg(player.yaw), pitchDeg: deg(player.pitch),
        zone: player.zone, mode: player.mode, onGround: player.onGround,
        canMove: player.canMove, cameraControlled: player.cameraControlled, lookHandler: !!player.lookHandler,
        riding: !!ctx.riding, indoor: !!ctx.house?.inside?.(player.feet),
        ...whereIs(player.feet, player.zone),
      },
      camera: { position: vec(eye), direction: vec(dir), fov: R(camera.fov), near: camera.near, far: camera.far, aspect: R(camera.aspect) },
      hit: vis.hit,
      collisionHit: castCollision(),
      interactable: underReticle(),
      state: clean(ctx.state),
      power: clean(ctx.power ?? null),
      elevators: (ctx.elevators ?? []).map((e) => ({ id: e.id, at: e.at, busy: e.busy })),
      observatory,
      walls: { ...WALLS },
      settings: clean(settings.values),
      fx: { fade: R(fx.fade), scope: R(fx.scope), gamma: R(fx.gamma), brightness: R(fx.brightness) },
      renderer: {
        fps: R(1 / dtAvg, 1),
        frameMs: R(dtAvg * 1000, 2),
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        pixelRatio: R(renderer.getPixelRatio()),
        drawingBuffer: { w: size.x, h: size.y },
        window: { w: innerWidth, h: innerHeight },
        raycastMs: R(vis.ms, 1),
      },
      userAgent: navigator.userAgent,
    };
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* permissions or insecure context */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) return true;
    } catch { /* fall through to the console */ }
    return false;
  };

  const report = async () => {
    let payload;
    try { payload = build(); } catch (err) { console.error('[debug report] failed', err); show('Report failed (see console)'); return; }
    window.__lastReport = payload;
    const text = JSON.stringify(payload, null, 2);
    const h = payload.hit;
    const what = h ? `${h.object || h.owner || h.type} @ ${h.distance.toFixed(1)} m` : 'no hit';
    if (await copy(text)) show(`Copied report · ${what}`);
    else { console.log(text); show('Report logged to console'); }
  };

  const enabled = () => settings.values.debugReports && game().started && !settings.open;
  addEventListener('keydown', (e) => {
    if (e.code !== 'F8') return;
    e.preventDefault();
    if (!e.repeat && enabled()) report();
  });
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();   // no autoscroll
    // An unlocked click only recaptures the mouse (core/input.js).
    if (document.pointerLockElement === renderer.domElement && enabled()) report();
  });

  return {
    report,
    build,
    tick(dt) { if (dt > 0) dtAvg += (dt - dtAvg) * 0.05; },
  };
}
