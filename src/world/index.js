import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { materials } from '../render/materials.js';
import { ColliderBuilder } from './builders.js';
import { Forest, Meadow, TallGrass } from './trees.js';
import { makeRockGeometry, scatter } from './features.js';
import { buildTunnels } from './tunnels.js';
import { buildDome } from './stacks/dome.js';
import { buildRocks } from './stacks/rocks.js';
import { buildEnd } from './stacks/end.js';
import { buildTower } from './stacks/tower.js';
import { buildMountain } from './stacks/mountain.js';
import { LightPool } from '../render/lightpool.js';
import { LodSystem, InstancedLod } from '../render/lod.js';
import { createConstellation } from '../render/constellation.js';

class Pebbles {
  constructor() {
    this.geometries = [0, 1, 2].map((i) => makeRockGeometry(300 + i, 1));
    this.items = this.geometries.map(() => []);
    this.rng = new Rng(9);
  }
  // ry: the stone's turn; given, it draws nothing from the shared stream (so the stones added after it keep theirs).
  addAt(x, y, z, s, geo = this.geometries[0], ry = this.rng.float(0, 6.28)) {
    this.items[this.geometries.indexOf(geo)].push({ x, y, z, s, ry });
  }
  // keep(x, z): false drops a stone after its random draws, so the others stay where they were.
  scatter(stack, n, rng, accept, keep = null) {
    for (const p of scatter(stack, n, rng, accept, { margin: 1.5 })) {
      const s = Math.pow(rng.next(), 3) * 0.45 + 0.08;
      const geo = this.geometries[rng.int(0, 2)];
      if (!keep || keep(p.x, p.z)) this.addAt(p.x, p.y + s * 0.2, p.z, s, geo);
      else this.rng.float(0, 6.28);   // (its rotation's draw)
    }
  }
  // Pebbles fade out close by; the big stones (dry-stone walls, river boulders) carry further.
  build(parent, lod) {
    const M = materials();
    const d = new THREE.Object3D();
    this.geometries.forEach((g, gi) => {
      for (const [big, out] of [[false, [45, 60]], [true, [110, 140]]]) {
        const list = this.items[gi].filter((p) => (p.s > 0.26) === big);
        if (!list.length) continue;
        const matrices = new Float32Array(list.length * 16);
        list.forEach((p, i) => {
          d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.ry, 0); d.scale.setScalar(p.s); d.updateMatrix();
          d.matrix.toArray(matrices, i * 16);
        });
        lod.addInstanced(new InstancedLod(parent, {
          name: 'stones' + gi + (big ? ':big' : ''), matrices, step: 5, cell: 32,
          levels: [{ parts: [{ geometry: g, material: M.stone }], out, castShadow: true }],
        }));
      }
    });
  }
}

// Builds every stack, the tunnels, and all colliders. Returns the context used by the game loop.
export function buildWorld(base) {
  const surface = new THREE.Group();
  surface.name = 'surface';
  base.scene.add(surface);
  const deferred = [];
  const ctx = {
    ...base,
    surface,
    lightPool: new LightPool(base.scene, 4),
    lod: new LodSystem(base.camera),
    stacks: {},
    state: {},
    forest: new Forest(),
    meadow: new Meadow(),
    tallGrass: new TallGrass(),
    pebbles: new Pebbles(),
    deferCollider: (builder, zone) => deferred.push({ builder, zone }),
    lateCollider: (name, zone = 'surface') => { const b = new ColliderBuilder(name); deferred.push({ builder: b, zone }); return b; },
  };

  const tunnels = buildTunnels(ctx);
  ctx.tunnels = tunnels;
  ctx.tunnelStation = (name) => ({ ...tunnels.stations[name] });

  buildDome(ctx);
  buildRocks(ctx);
  ctx.constellation = createConstellation(ctx);   // the Rocks star map, for the observatory's telescope
  buildEnd(ctx);
  buildTower(ctx);
  buildMountain(ctx);
  tunnels.lounge?.finish();      // its collision and sound after everything else's (props/lounge.js)

  ctx.forest.build(surface, ctx.lod);
  ctx.meadow.build(surface, ctx.lod);
  ctx.tallGrass.build(surface, ctx.lod);
  ctx.pebbles.build(surface, ctx.lod);
  ctx.stacks.mountain.finish();  // no grass through its spur's pebbles, now that the scatter is built (stacks/mountain.js)
  for (const d of deferred) ctx.physics.addCollider(d.builder.build(), d.zone);
  ctx.observatory?.finish();     // the roof station's deck, last: it is switched on only while its ladders meet
  // The lit interior nearest what's in view: the player's feet, or a cutscene's focus far away (main.js ctx.viewFocus).
  ctx.updaters.push(() => { if (ctx.player) ctx.lightPool.update(ctx.viewFocus ?? ctx.player.feet); });
  return ctx;
}
