// Exports the Rocks tor's procedural blocks (src/world/rockpiles.js buildTor) for its Blender resculpt
// (tor_design.py) and its blast (tor_blast_design.py): builds the world headless (tools/regress/world.mjs) with no
// sculpt loaded, and writes tools/blender/tor_src.json:
//   frame    the tor's layout (centre, ground, rim, spill direction, chute lean, pool), as buildTor returns it
//   blocks   each block and fallen boulder as a triangle soup relative to (frame.x, 0, frame.z), with its baked colour
//   ground   the stack's ground heights round it (an occluder for the AO bake)
//   stack    the whole Rocks cap on a coarser grid, same frame (null off the cap), for the blast's rigid-body ground
//   sequoia  the sequoia's foot (relative), a collider for the blast's flying chunks
//
//   node tools/blender/export_tor.mjs            everything
//   node tools/blender/export_tor.mjs --stack    only (re)write `stack` and `sequoia` into the existing tor_src.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHeadless } from '../regress/world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(HERE, 'tor_src.json');
const stackOnly = process.argv.includes('--stack');
const { rec, ctx } = await buildHeadless({ torSculpt: false });
const call = rec.calls.find((c) => c.name === 'buildTor');
if (!call?.info?.frame) throw new Error('export_tor: buildTor was not recorded');
const f = call.info.frame;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const stack = ctx.stacks.rocks;

// The whole cap round the tor, 1 m cells, null where there is no cap (past the rim).
const wide = (() => {
  const s = stack.cfg ?? { x: -300, z: 175, r: 50 };
  const R = (s.r ?? 50) * 1.1, step = 1;
  const x0 = Math.floor(s.x - R - f.x), z0 = Math.floor(s.z - R - f.z), n = Math.ceil((2 * R) / step) + 1;
  const h = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = stack.heightAt(f.x + x0 + i * step, f.z + z0 + j * step);
    h.push(v == null ? null : r4(v));
  }
  return { x0, z0, step, n, h };
})();
const sq = rec.calls.find((c) => c.name === 'buildSequoia')?.info;
const sequoia = sq ? { x: r4(sq.x - f.x), y: r4(sq.y), z: r4(sq.z - f.z), footprintR: r4(sq.footprintR), height: r4(sq.height) } : null;

if (stackOnly) {
  const src = JSON.parse(fs.readFileSync(out, 'utf8'));
  for (const k of ['x', 'z', 'g0', 'yRim', 'spill', 'yW']) {
    if (Math.abs(src.frame[k] - f[k]) > 0.01) throw new Error(`export_tor --stack: tor_src.json is for another layout (${k}); run without --stack`);
  }
  fs.writeFileSync(out, JSON.stringify({ ...src, stack: wide, sequoia }));
  console.log(`export_tor: stack ${wide.n}x${wide.n} (${wide.h.filter((v) => v != null).length} on the cap), sequoia ${JSON.stringify(sequoia)} -> ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}

const blocks = call.info.geos.map(({ geo }, i) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position.array, C = g.attributes.color.array;
  const pos = new Array(P.length), col = new Array(P.length);
  for (let v = 0; v < P.length; v += 3) {
    pos[v] = r4(P[v] - f.x); pos[v + 1] = r4(P[v + 1]); pos[v + 2] = r4(P[v + 2] - f.z);
    col[v] = r4(C[v]); col[v + 1] = r4(C[v + 1]); col[v + 2] = r4(C[v + 2]);
  }
  return { kind: i < f.nBody ? 'body' : 'boulder', pos, col };
});

const half = 26, step = 0.5, n = Math.round((2 * half) / step) + 1;
const h = [];
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const gx = f.x - half + i * step, gz = f.z - half + j * step;
  h.push(r4(stack.heightAt(gx, gz) ?? f.g0 - 5));
}

fs.writeFileSync(out, JSON.stringify({ frame: f, blocks, ground: { x0: -half, z0: -half, step, n, h }, stack: wide, sequoia }));
const tris = blocks.reduce((t, b) => t + b.pos.length / 9, 0);
console.log(`export_tor: ${blocks.length} pieces (${f.nBody} blocks), ${tris} triangles -> ${path.relative(process.cwd(), out)}`);
