// Records every geometry/placement anchor the stack walls rework must keep (see README.md) as one JSON file.
//   node tools/regress/anchors.mjs [--walls <spec>] [--out <file>]
// Numbers are stored exactly (JSON round-trips doubles); big arrays are stored as SHA-256 prefixes. No timings
// or other run-dependent values go into the file, so two runs of the same tree must be byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHeadless } from './world.mjs';
import { sha, stats, CliffSampler, TAU } from './geom.mjs';
import { COUPLINGS } from './couplings.mjs';

const NAMES = ['dome', 'rocks', 'end', 'tower', 'mountain'];
const v3 = (v) => (v ? [v.x, v.y, v.z] : null);

export async function recordAnchors(W) {
  const { THREE, ctx, physics, rec, config } = W;
  const { MeshBVH } = await import('three-mesh-bvh');
  const S = ctx.stacks, STACKS = config.STACKS;
  const samplers = Object.fromEntries(NAMES.map((n) => [n, new CliffSampler(THREE, MeshBVH, S[n])]));
  const nearest = (x, z) => NAMES.reduce((b, n) => (Math.hypot(x - S[n].cx, z - S[n].cz) < Math.hypot(x - S[b].cx, z - S[b].cz) ? n : b), NAMES[0]);
  const calls = (name, stack) => rec.calls.filter((c) => c.name === name && (stack === undefined || c.stack === stack)).map((c) => c.info);
  const ground = (st, x, z) => st.heightAt(x, z) ?? st.heightAtAnalytic(x, z);
  const out = { kind: 'anchors', version: 1, walls: { ...config.WALLS }, stacks: {} };

  // ---------------------------------------------------------------- per stack: mesh contract, colliders, wall
  const matNames = new Map(Object.entries(W.materials).map(([k, m]) => [m, k]));
  const texNames = new Map();
  for (const [k, m] of Object.entries(W.materials)) for (const t of ['map', 'normalMap', 'roughnessMap']) if (m[t] && !texNames.has(m[t])) texNames.set(m[t], `${k}.${t}`);
  const LIB = { MeshStandardMaterial: 'standard', MeshPhysicalMaterial: 'physical', MeshBasicMaterial: 'basic', MeshLambertMaterial: 'lambert' };
  const matInfo = (m) => {
    const tex = (t) => (t ? { name: texNames.get(t) ?? 'other', repeat: [t.repeat.x, t.repeat.y] } : null);
    const info = {
      name: matNames.get(m) ?? (m.name || m.type), type: m.type, key: m.customProgramCacheKey?.() ?? null,
      transparent: m.transparent, alphaTest: m.alphaTest, vertexColors: m.vertexColors, color: m.color?.toArray() ?? null,
      roughness: m.roughness ?? null, normalScale: m.normalScale?.toArray() ?? null, map: tex(m.map), normalMap: tex(m.normalMap),
    };
    // The patched shader source this material would compile to (onBeforeCompile run on the stock chunks).
    const lib = THREE.ShaderLib[LIB[m.type]];
    if (lib) {
      const sh = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {}, defines: {} };
      try {
        m.onBeforeCompile(sh, {});
        Object.assign(info, { vs: sha(sh.vertexShader), fs: sha(sh.fragmentShader), discard: /\bdiscard\b/.test(sh.fragmentShader), fragDepth: /\bgl_FragDepth\b/.test(sh.fragmentShader) });
      } catch (e) {
        info.shaderError = e.message;   // a hook that needs a real renderer; recorded rather than fatal
      }
    }
    return info;
  };
  const geoSha = (g) => Object.fromEntries(['position', 'index', 'color', 'uv', 'normal'].map((k) => [k, sha(k === 'index' ? g.index?.array : g.attributes[k]?.array)]));
  const box = (arr) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); }
    return { min: mn, max: mx };
  };

  for (const n of NAMES) {
    const st = S[n], cfg = STACKS[n];
    const capMesh = st.group.getObjectByName('cap'), cliffMesh = st.group.getObjectByName('cliff');
    const cap = capMesh.geometry, cliff = cliffMesh.geometry;
    const P = cliff.attributes.position.array, N = cliff.attributes.normal.array, CP = cap.attributes.position.array;
    const segs = st.segs, W1 = segs + 1, rows = P.length / 3 / W1;
    const rowsInt = Number.isInteger(rows);
    const R = (i) => Math.hypot(P[i * 3] - st.cx, P[i * 3 + 2] - st.cz);
    let monotonic = true, minRowGap = Infinity, row0Cap = true, seamDup = true;
    for (let j = 0; j <= segs && rowsInt; j++) {
      for (let ri = 0; ri + 1 < rows; ri++) {
        const g = P[(ri * W1 + j) * 3 + 1] - P[((ri + 1) * W1 + j) * 3 + 1];
        if (!(g > 0)) monotonic = false;
        minRowGap = Math.min(minRowGap, g);
      }
    }
    const ring = st.rings * segs;
    for (let j = 0; j <= segs; j++) for (let k = 0; k < 3; k++) if (P[j * 3 + k] !== CP[(ring + (j % segs)) * 3 + k]) row0Cap = false;
    for (let ri = 0; ri < rows && rowsInt; ri++) for (let k = 0; k < 3; k++) if (P[(ri * W1) * 3 + k] !== P[(ri * W1 + segs) * 3 + k]) seamDup = false;
    // Per row: approximate depth, the θ=0 normal seam, radius spread beyond the planform, flare, column steps.
    const window = Math.ceil((35 / st.r) / (TAU / segs));   // the S3 seam cross-fade window (~35 m of arc after θ=0)
    const perRow = [];
    for (let ri = 0; ri < rows && rowsInt; ri++) {
      const depths = [], dev = [], steps = [];
      for (let j = 0; j < segs; j++) {
        const i = ri * W1 + j;
        depths.push(Math.min(P[j * 3 + 1], cfg.top) - P[i * 3 + 1]);
        dev.push(R(i) - R(j));
        steps.push(Math.abs(R(i + 1) - R(i)));
      }
      const a = ri * W1 * 3, b = (ri * W1 + segs) * 3;
      const dot = N[a] * N[b] + N[a + 1] * N[b + 1] + N[a + 2] * N[b + 2];
      const sorted = [...steps].sort((x, y) => x - y);
      const inWin = (j) => j === segs - 1 || j < window;
      perRow.push({
        depth: Math.round(stats(depths).p50 * 10) / 10,
        seamNormalDeg: Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI,
        devSd: stats(dev).sd, devMax: Math.max(...dev),
        step: { median: sorted[segs >> 1], max: sorted[segs - 1], seam: steps[segs - 1], window: Math.max(...steps.filter((_, j) => inWin(j))), rest: Math.max(...steps.filter((_, j) => !inWin(j))) },
      });
    }
    // Steepest upward-facing wall triangle in the top 12 m (walkable is normal.y > 0.6).
    let top12 = -1;
    const idx = cliff.index.array;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      va.fromArray(P, idx[t] * 3); vb.fromArray(P, idx[t + 1] * 3); vc.fromArray(P, idx[t + 2] * 3);
      if ((va.y + vb.y + vc.y) / 3 < cfg.top - 12) continue;
      vb.sub(va); vc.sub(va);
      const nrm = vb.cross(vc).normalize();
      top12 = Math.max(top12, nrm.y);
    }
    const coll = W.stackColliders[n].map((g) => ({ tris: g.attributes.position.count / 3, ...box(g.attributes.position.array) }));
    const cliffColl = W.stackColliders[n][1];
    // Cap height distribution on a 2 m grid (the built mesh); the grid itself is kept for the relief stacks so
    // compare.mjs can measure the relief a stage adds.
    const hs = [];
    for (let x = -st.r * 1.1; x <= st.r * 1.1; x += 2) for (let z = -st.r * 1.1; z <= st.r * 1.1; z += 2) {
      if (st.edgeDist(st.cx + x, st.cz + z) <= 0) continue;
      const h = st.heightAt(st.cx + x, st.cz + z);
      if (h !== null) hs.push(h - cfg.top);
    }
    // Steepest cap slope across the outer 4 m (the rounded lip / S5 shoulder).
    let rimSlope = 0;
    for (let a = 0; a < 720; a++) {
      const th = (a / 720) * TAU, er = st.edgeR(th), c = Math.cos(th), s = Math.sin(th);
      let prev = null;
      for (let d = 4; d >= 0.25 - 1e-9; d -= 0.25) {
        const h = st.heightAt(st.cx + c * (er - d), st.cz + s * (er - d));
        if (h !== null && prev !== null) rimSlope = Math.max(rimSlope, Math.abs(h - prev) / 0.25);
        prev = h;
      }
    }
    const group = [];
    st.group.traverse((o) => { if (o.isMesh && o !== capMesh && o !== cliffMesh) group.push({ name: o.name, material: matNames.get(o.material) ?? (o.material.name || o.material.type), verts: o.geometry.attributes.position.count, position: sha(o.geometry.attributes.position.array) }); });
    out.stacks[n] = {
      cfg: { x: cfg.x, z: cfg.z, top: cfg.top, r: cfg.r, seed: cfg.seed, segs, rings: st.rings, edgeAmp: st.edgeAmp, innerHole: st.innerHole },
      cap: { verts: cap.attributes.position.count, indices: cap.index.count, sha: geoSha(cap) },
      cliff: {
        verts: cliff.attributes.position.count, indices: cliff.index.count, sha: geoSha(cliff), columns: W1, rows, rowsInt,
        monotonic, minRowGap, row0IsCapRing: row0Cap, seamColumnDuplicated: seamDup, top12MaxNy: top12,
        seamNormalMaxDeg: Math.max(...perRow.map((r) => r.seamNormalDeg)), rowStats: perRow,
      },
      colliders: { pieces: coll, cliffRows: cliffColl ? cliffColl.attributes.position.count / 3 / (2 * segs) + 1 : null },
      relief: {
        ...stats(hs), belowTopMinus2p5: hs.filter((h) => h < -2.5).length / hs.length, grid: sha(hs),
        values: n === 'dome' || n === 'rocks' ? hs.map((h) => Math.round(h * 1e4) / 1e4) : undefined,
      },
      rimSlopeMaxDeg: Math.atan(rimSlope) * 180 / Math.PI,
      materials: { cap: matInfo(capMesh.material), cliff: matInfo(cliffMesh.material) },
      group,
      edgeR: sha(Array.from({ length: 720 }, (_, i) => st.edgeR((i / 720) * TAU))),
      cliffPoint: sha(Array.from({ length: 24 }, (_, i) => v3(st.cliffPoint((i % 8) * TAU / 8, [3, 20, 120][i >> 3])))),
    };
  }

  // The materials the wall shares with the tor, piles, hoods and props (and through their maps Textures.rock):
  // never relaxed, so a flag-gated edit of a shared material shows even while the wall's own may change.
  out.sharedMaterials = Object.fromEntries(['cap', 'cliff', 'stone'].map((k) => [k, matInfo(W.materials[k])]));

  // ---------------------------------------------------------------- physics
  out.physics = {
    colliders: physics.colliders.map((c) => ({ name: c.name, zone: c.zone, tris: c.geometry.index ? c.geometry.index.count / 3 : c.geometry.attributes.position.count / 3, min: c.box.min.toArray(), max: c.box.max.toArray() })),
    dynamic: physics.dynamic.map((d) => ({ type: d.type, x: d.x, z: d.z, r: d.r ?? null, y0: d.y0 ?? null, y1: d.y1 ?? null, zone: d.zone ?? null })),
    ladders: physics.ladders.map((L) => ({ stack: nearest(L.base.x, L.base.z), base: v3(L.base), n: v3(L.n), height: L.height, width: L.width, zone: L.zone })),
  };

  // Ladder: wall radius and the mesh wall along it, from the ledge up to the lip.
  const ladderInfo = (n) => {
    const L = physics.ladders.find((l) => nearest(l.base.x, l.base.z) === n);
    if (!L) return null;
    const st = S[n], th = Math.atan2(L.n.z, L.n.x);
    const wallR = Math.hypot(L.base.x - st.cx, L.base.z - st.cz) - 0.05;
    const mesh = [];
    for (let y = L.base.y; y <= L.base.y + L.height + 1e-9; y += 0.25) mesh.push(samplers[n].radiusAt(th, y));
    const valid = mesh.filter((m) => m !== null);
    return { theta: th, wallR, ledgeY: L.base.y, lipY: L.base.y + L.height, height: L.height, meshR: sha(mesh.map((m) => m ?? NaN)), meshMin: Math.min(...valid) - wallR, meshMax: Math.max(...valid) - wallR, rim: samplers[n].rim(th) };
  };
  // Ledge: the samples, the ledge's inner radius and the built wall behind each sample.
  const ledgeInfo = (n) => {
    const L = calls('buildLedge', n)[0];
    if (!L) return null;
    const st = S[n];
    const R = L.samples.map((s) => st.cliffRadius(s.theta, s.depth, st.edgeR(s.theta)) - 0.1);
    const off = L.samples.map((s, i) => (samplers[n].radiusAt(s.theta, st.top - s.depth) ?? NaN) - R[i]);
    return { count: L.samples.length, samples: L.samples, innerR: R, meshMinusLedge: off, worst: Math.max(...off.map(Math.abs)), geometry: sha(L.geometry.attributes.position.array) };
  };
  const caveInfo = (n) => calls('buildCave', n)[0] ?? null;
  const elevator = (id) => calls('createElevator').find((e) => e.id === id) ?? null;
  // Trees near the rim: trunk base (y - 0.5) against the wall at that angle and height.
  const treeMargins = (n) => {
    const st = S[n];
    let worst = { margin: Infinity };
    for (const t of rec.adds) {
      if (t.stack !== n || t.kind !== 'tree') continue;
      const th = Math.atan2(t.z - st.cz, t.x - st.cx), d = Math.hypot(t.x - st.cx, t.z - st.cz);
      const m = samplers[n].wallAt(th, t.y - 0.5) - d;
      if (m < worst.margin) worst = { margin: m, at: [t.x, t.y, t.z] };
    }
    return worst;
  };
  const flatness = (st, cx, cz, r, target) => {
    let m = 0;
    for (let x = -r; x <= r; x += 0.5) for (let z = -r; z <= r; z += 0.5) {
      if (Math.hypot(x, z) >= r) continue;
      const h = st.heightAt(cx + x, cz + z);
      if (h !== null) m = Math.max(m, Math.abs(h - target));
    }
    return m;
  };

  // ---------------------------------------------------------------- Dome
  {
    const st = S.dome, cfg = STACKS.dome;
    const cab = calls('placeCabin')[0];
    let ringSlope = 0;
    for (let a = 0; a < 720; a++) {
      const th = (a / 720) * TAU, c = Math.cos(th), s = Math.sin(th);
      let prev = st.heightAt(st.cx + c * 15, st.cz + s * 15);
      for (let r = 15.25; r <= 22 + 1e-9; r += 0.25) {
        const h = st.heightAt(st.cx + c * r, st.cz + s * r);
        ringSlope = Math.max(ringSlope, Math.abs(h - prev) / 0.25);
        prev = h;
      }
    }
    const wedge = (az) => {
      let best = { h: -Infinity };
      for (let a = az - 15; a <= az + 15; a++) {
        const th = a * Math.PI / 180, er = st.edgeR(th);
        for (let r = 15; r < er - 0.3; r += 1) {
          const h = st.heightAt(st.cx + Math.cos(th) * r, st.cz + Math.sin(th) * r);
          if (h !== null && h - cfg.top > best.h) best = { h: h - cfg.top, az: a, r };
        }
      }
      return best;
    };
    out.dome = {
      cabinOrigin: cab?.origin ?? null,
      wake: ctx.house?.wake ? { stand: v3(ctx.house.wake.stand), standYaw: ctx.house.wake.standYaw } : null,
      padFlatness: flatness(st, st.cx, st.cz, 14.9, cfg.top + 0.15),
      ringSlope15to22: ringSlope,
      ladder: ladderInfo('dome'),
      ledge: ledgeInfo('dome'),
      cave: caveInfo('dome'),
      elevatorTop: elevator('dome'),
      spawnHeight: st.heightAt(config.SPAWN.x, config.SPAWN.z),
      sightline: { rocks150: wedge(150), tower74: wedge(-74) },
      trees: treeMargins('dome'),
      bench: [[11, 2], [46, 12]].map(([x, z]) => st.heightAt(st.cx + x, st.cz + z)),
    };
  }

  // ---------------------------------------------------------------- Tower
  {
    const st = S.tower, cfg = STACKS.tower;
    const pt = calls('buildPowerTower')[0];
    out.tower = {
      ladder: ladderInfo('tower'),
      ledge: ledgeInfo('tower'),
      cave: caveInfo('tower'),
      elevatorTop: elevator('tower'),
      powerTower: pt ?? null,
      apronFlatness: pt ? flatness(st, pt.base[0], pt.base[2], 8, cfg.top + 0.3) : null,
      trees: treeMargins('tower'),
    };
  }

  // ---------------------------------------------------------------- Rocks
  {
    const st = S.rocks;
    const fall = calls('edgeWaterfall', 'rocks')[0];
    const stream = calls('streamGeometry', 'rocks')[0];
    const splash = calls('splashFX', 'rocks')[0];
    const cascadeEm = rec.emitters.find((e) => e.name === 'cascade');
    const tor = calls('buildTor', 'rocks')[0];
    const piles = calls('buildRockPile', 'rocks');
    const seq = calls('buildSequoia', 'rocks')[0];
    const bridge = calls('buildBridge')[0];
    const mov = calls('createMovableRocks', 'rocks')[0];
    const frogs = rec.emitters.find((e) => e.name === 'frogs');
    const groundRange = (x, z, r) => {
      let lo = Infinity, hi = -Infinity;
      for (let dx = -r; dx <= r; dx += 0.5) for (let dz = -r; dz <= r; dz += 0.5) {
        if (Math.hypot(dx, dz) > r) continue;
        const h = ground(st, x + dx, z + dz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      return { lo, hi, range: hi - lo };
    };
    // Below-ground shell vertices must stay inside the wall.
    const buried = (geos) => {
      let min = Infinity, under = 0, n = 0, at = null;
      for (const { geo } of geos ?? []) {
        const p = geo.attributes.position.array;
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          const th = Math.atan2(z - st.cz, x - st.cx), d = Math.hypot(x - st.cx, z - st.cz);
          if (d < st.edgeR(th) - 8) continue;   // deep inside the cap: nowhere near the wall
          if (y >= ground(st, x, z)) continue;
          n++;
          const m = samplers.rocks.wallAt(th, y) - d;
          if (m < 0.3) under++;
          if (m < min) { min = m; at = [x, y, z]; }
        }
      }
      return { vertices: n, minMargin: n ? min : null, under0p3: under, at };
    };
    // The car at the sequoia plate: its floor must clear the ground under the whole car.
    let carRect = null;
    if (seq?.platePos) {
      const { ELEVATOR_DIMS: { CAR } } = await W.imp('props/elevator.js');
      const [px, py, pz] = seq.platePos, c = Math.cos(seq.plateRot), s = Math.sin(seq.plateRot);
      let mx = -Infinity;
      for (let lx = -CAR.hw; lx <= CAR.hw + 1e-9; lx += 0.1) for (let lz = CAR.z1; lz <= CAR.z0 + 1e-9; lz += 0.1) {
        const h = st.heightAt(px + lx * c + lz * s, pz - lx * s + lz * c);
        if (h !== null) mx = Math.max(mx, h);
      }
      carRect = { maxGround: mx, clearance: py - mx };
    }
    const stones = rec.adds.filter((a) => a.stack === 'rocks' && a.kind === 'stone');
    out.rocks = {
      bed: stream ? { n: stream.points.length, waterLine: stream.points.map((p) => p[1]), xz: sha(stream.points.map((p) => [p[0], p[2]])), widths: sha(stream.widths) } : null,
      streamPath: ctx.streamPath ? { n: ctx.streamPath.pts.length, total: ctx.streamPath.total, sha: sha(ctx.streamPath.pts.map((p) => [p.x, p.z])) } : null,
      waterY: splash?.pos?.[1] ?? (cascadeEm ? cascadeEm.pos[1] - 1.5 : null),
      lip: fall?.lip ?? null,
      fall: fall ? { theta: fall.theta, edgeR: st.edgeR(fall.theta), n: fall.path?.length ?? null, path: fall.path, widths: fall.widths, drop: fall.fallDrop } : null,
      tor: tor ? { x: tor.x, z: tor.z, top: tor.top, splash: tor.splash, poolRadius: tor.poolRadius, walls: tor.walls, cascade: sha(tor.cascade), ground: groundRange(tor.x, tor.z, tor.radius + 1.5), buried: buried(tor.geos) } : null,
      piles: piles.map((p) => ({ x: p.x, z: p.z, radius: p.radius, walls: p.walls, ground: groundRange(p.x, p.z, p.radius), buried: buried(p.geos) })),
      sequoia: seq ? { treeY: seq.y, x: seq.x, z: seq.z, platePos: seq.platePos, plateRot: seq.plateRot, footprintR: seq.footprintR, carRect } : null,
      elevatorTop: elevator('rocks'),
      bridgeA: v3(ctx.bridgeA),
      movable: mov ? mov.spots.map((s) => ({ ...s, y: st.heightAt(s.x, s.z), edgeDist: st.edgeDist(s.x, s.z) })) : null,
      frogs: frogs?.spots ?? null,
      steppingStones: stones.filter((a) => a.s < 0.2).length,
      bedStones: stones.filter((a) => a.s >= 0.2).length,
      bench: [[8, 6], [-12, -8], [-19.2, 4.3], [38, -13]].map(([x, z]) => st.heightAt(st.cx + x, st.cz + z)),
    };

    // ---------------------------------------------------------------- End + bridge
    const en = S.end, ap = calls('createAperture')[0];
    let deck = null;
    if (bridge?.deckAt) {
      // Deck underside (plank centre 0.025 below the deck line, 0.05 thick) over the cap where it crosses a lip.
      const lipBand = (s2) => {
        let min = Infinity, at = null;
        for (let t = 0; t <= 1 + 1e-9; t += 0.0005) {
          const p = bridge.deckAt(t), ed = s2.edgeDist(p.x, p.z), h = s2.heightAt(p.x, p.z);
          if (ed < 0 || ed > 0.6 || h === null) continue;
          const c = p.y - 0.05 - h;
          if (c < min) { min = c; at = t; }
        }
        return { min, t: at };
      };
      const posts = [];
      const a = new THREE.Vector3(...bridge.a), b = new THREE.Vector3(...bridge.b);
      const flat = b.clone().sub(a).setY(0).normalize(), side = new THREE.Vector3(-flat.z, 0, flat.x);
      for (const [end, sgn, n] of [[a, 1, 'rocks'], [b, -1, 'end']]) {
        for (const s of [-1, 1]) {
          const p = end.clone().addScaledVector(side, s * (bridge.width / 2 + 0.15)).addScaledVector(flat, -sgn * 0.3);
          const st2 = S[n], th = Math.atan2(p.z - st2.cz, p.x - st2.cx);
          posts.push({ stack: n, pos: v3(p), wallMargin: samplers[n].wallAt(th, p.y - 0.5) - Math.hypot(p.x - st2.cx, p.z - st2.cz) });
        }
      }
      deck = { a: bridge.a, b: bridge.b, endLip: lipBand(en), rocksLip: lipBand(st), posts };
    }
    // Narrowest gap between the Rocks and End walls, above the cloud deck and at any height both reach.
    const gap = { aboveDeck: { min: Infinity }, all: { min: Infinity } };
    {
      const dth = Math.atan2(en.cz - st.cz, en.cx - st.cx), D = Math.hypot(en.cx - st.cx, en.cz - st.cz);
      const ring = (s2, n, th0, y) => {
        const out2 = [];
        for (let k = -24; k <= 24; k++) {
          const th = th0 + k * 0.025, r = samplers[n].radiusAt(th, y);
          if (r !== null) out2.push([s2.cx + Math.cos(th) * r, s2.cz + Math.sin(th) * r]);
        }
        return out2;
      };
      for (let y = en.top - 12; y > -880; y -= 5) {
        const A = ring(st, 'rocks', dth, y), B = ring(en, 'end', dth + Math.PI, y);
        for (const p of A) for (const q of B) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d < gap.all.min) gap.all = { min: d, y };
          if (y > config.CLOUD_DECK_Y && d < gap.aboveDeck.min) gap.aboveDeck = { min: d, y };
        }
      }
      gap.axis = D;
    }
    out.end = {
      landing: bridge?.b ?? null,
      aperture: ap ?? null,
      flatness: flatness(en, en.cx, en.cz, 3.4, en.top),
      deck,
      rocksEndGap: gap,
    };
  }

  // ---------------------------------------------------------------- Mountain
  {
    const st = S.mountain;
    out.mountain = {
      meadow: rec.adds.filter((a) => a.stack === 'mountain' && a.kind === 'meadow').length,
      trail: st.trail ? { n: st.trail.pts.length, total: st.trail.total, sha: sha(st.trail.pts.map((p) => [p.x, p.z, p.y ?? NaN])) } : null,
      observatory: calls('placeObservatory')[0] ?? null,
      shed: st.shed ? { x: st.shed.x, z: st.shed.z, rot: st.shed.rot, platePos: v3(st.shed.platePos) } : null,
      elevatorTop: elevator('mountain'),
    };
  }

  // ---------------------------------------------------------------- placements
  {
    const scat = {};
    rec.calls.filter((c) => c.name === 'scatter').forEach((c) => {
      const k = c.stack ?? c.info.stack;
      (scat[k] ||= []).push({
        count: c.info.count, margin: c.info.opts?.margin ?? null, tries: c.info.opts?.tries ?? null, n: c.info.out.length,
        xz: sha(c.info.out.map((p) => [p[0], p[2]])), y: sha(c.info.out.map((p) => p[1])),
      });
    });
    const adds = {};
    for (const n of NAMES) {
      adds[n] = {};
      for (const kind of ['tree', 'shrub', 'meadow', 'pebble', 'stone', 'flower']) {
        const L = rec.adds.filter((a) => a.stack === n && a.kind === kind);
        if (!L.length) continue;
        adds[n][kind] = { n: L.length, xz: sha(L.map((a) => [a.x, a.z])), y: sha(L.map((a) => a.y)), s: sha(L.map((a) => a.s)), sp: sha(L.map((a) => String(a.sp ?? '')).join(',')) };
      }
    }
    const trails = Object.fromEntries(rec.calls.filter((c) => c.name === 'buildTrail').map((c) => [c.info.stack, { verts: c.info.geometry.attributes.position.count, position: sha(c.info.geometry.attributes.position.array) }]));
    out.placements = { scatter: scat, adds, trails };
  }

  out.emitters = rec.emitters.map((e) => ({ name: e.name, pos: e.pos, zone: e.zone, spots: e.spots ? sha(e.spots) : null }));
  // The wall must never get a LodSystem fade (early-z under the cloud sea hides the wall below it).
  out.lod = {
    entries: ctx.lod.entries.length, instanced: ctx.lod.instanced.length,
    cliffRegistered: ctx.lod.entries.some((e) => e.meshes.some((m) => m.name === 'cliff')),
    names: sha([...ctx.lod.entries.map((e) => e.name)].join('|')),
  };
  out.coverage = coverage(out);
  return out;
}

// Every coupling in couplings.mjs must resolve to at least one recorded value.
function coverage(out) {
  const get = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), out);
  const missing = [], unrecordable = [];
  for (const c of COUPLINGS) {
    if (c.unrecordable) { unrecordable.push({ id: c.id, why: c.unrecordable }); continue; }
    const bad = c.keys.filter((k) => get(k) === undefined || get(k) === null);
    if (bad.length === c.keys.length) missing.push({ id: c.id, keys: bad });
  }
  return { couplings: COUPLINGS.length, missing, unrecordable };
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const t0 = performance.now();
  const W = await buildHeadless({ walls: arg('--walls') });
  const A = await recordAnchors(W);
  const json = JSON.stringify(A, null, 1) + '\n';
  const file = arg('--out');
  if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, json); }
  else process.stdout.write(json);
  const cov = A.coverage;
  console.error(`anchors: walls=${JSON.stringify(arg('--walls') ?? null)} build ${(W.buildMs / 1000).toFixed(1)} s, total ${((performance.now() - t0) / 1000).toFixed(1)} s; couplings ${cov.couplings}, missing ${cov.missing.length}, unrecordable ${cov.unrecordable.length}${file ? ' -> ' + file : ''}`);
  for (const m of cov.missing) console.error(`  MISSING coupling ${m.id}: ${m.keys.join(', ')}`);
}
