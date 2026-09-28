import * as THREE from 'three';
import { Rng, smoothstep } from '../core/rng.js';
import { materials } from '../render/materials.js';
import { mat4, mergeParts } from './builders.js';

// Descending rope bridge between two points. Deck follows a gentle catenary-like sag.
export function buildBridge(ctx, { a, b, batcher, collider, sag = 2.2, width = 1.3 }) {
  const M = materials();
  const r = new Rng(55);
  const dir = b.clone().sub(a);
  const flat = dir.clone().setY(0);
  const L = flat.length();
  flat.normalize();
  const side = new THREE.Vector3(-flat.z, 0, flat.x);
  const ry = Math.atan2(flat.x, flat.z);
  const naturalY = (t) => THREE.MathUtils.lerp(a.y, b.y, t) - sag * 4 * t * (1 - t);
  // The anchor sits back from the stack's rim (rocks.js), so the natural sag curve dives under the cap's
  // overhanging lip right past `a`: a capsule walking in off the deck meets the cliff face there and never
  // reaches the anchor (measured stop ~1.9 m out, well short of the cap). Ease a short landing onto the cap
  // instead: level for LAND_FLAT past the anchor (clearing the lip), then ramp down to the natural curve over
  // LAND_RAMP. Both are planks like the rest of the deck, so this reuses every draw call already in play.
  const LAND_FLAT = 2, LAND_RAMP = 1.8, LAND_END = LAND_FLAT + LAND_RAMP;
  const landedY = naturalY(LAND_END / L);
  const deckAt = (t) => {
    const alongA = t * L;
    let y;
    if (alongA >= LAND_END) y = naturalY(t);
    else if (alongA <= LAND_FLAT) y = a.y;
    else y = THREE.MathUtils.lerp(a.y, landedY, smoothstep(LAND_FLAT, LAND_END, alongA));
    return a.clone().lerp(b, t).setY(y);
  };

  // Planks
  const plank = new THREE.BoxGeometry(width, 0.05, 0.26);
  const parts = [];
  const n = Math.floor(L / 0.36);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = deckAt(t);
    const q = deckAt(Math.min(1, t + 0.01)), q0 = deckAt(Math.max(0, t - 0.01));
    const pitch = Math.atan2(q.y - q0.y, q.clone().setY(0).distanceTo(q0.clone().setY(0)));
    const m = mat4(p.x, p.y - 0.025, p.z, ry + r.float(-0.03, 0.03), 1, 1, 1, -pitch);
    parts.push({ geo: plank, matrix: m, color: new THREE.Color().setScalar(r.float(0.75, 1.05)) });
  }
  batcher.add(mergeParts(parts), M.wood);

  // Ropes: two deck ropes, two hand ropes, vertical suspenders.
  const ropeCurve = (off, lift, extraSag) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push(deckAt(t).addScaledVector(side, off).setY(deckAt(t).y + lift + extraSag * 4 * t * (1 - t) * -1));
    }
    return new THREE.CatmullRomCurve3(pts);
  };
  const ropes = [
    ropeCurve(width / 2 + 0.02, 0.02, 0), ropeCurve(-width / 2 - 0.02, 0.02, 0),
    ropeCurve(width / 2 + 0.1, 1.05, -0.5), ropeCurve(-width / 2 - 0.1, 1.05, -0.5),
  ];
  for (const c of ropes) batcher.add(new THREE.TubeGeometry(c, 80, 0.03, 5), M.rope);
  for (let t = 0.04; t < 0.98; t += 1.6 / L) {
    for (const s of [-1, 1]) {
      const lo = ropes[s > 0 ? 0 : 1].getPoint(t), hi = ropes[s > 0 ? 2 : 3].getPoint(t);
      const mid = lo.clone().lerp(hi, 0.5);
      batcher.add(new THREE.CylinderGeometry(0.012, 0.012, lo.distanceTo(hi), 4), M.rope, mat4(mid.x, mid.y, mid.z));
    }
  }
  // Posts at both ends
  for (const [end, sgn] of [[a, 1], [b, -1]]) {
    for (const s of [-1, 1]) {
      const p = end.clone().addScaledVector(side, s * (width / 2 + 0.15)).addScaledVector(flat, -sgn * 0.3);
      batcher.add(new THREE.CylinderGeometry(0.09, 0.11, 2.2, 7), M.wood, mat4(p.x, p.y + 0.6, p.z));
    }
  }

  // Collision: deck strip and rope-height side walls.
  const pos = [], idx = [];
  const segs = 40;
  for (let i = 0; i <= segs; i++) {
    const p = deckAt(i / segs);
    for (const [o, dy] of [[-width / 2 - 0.15, 1.1], [-width / 2 - 0.15, -0.05], [width / 2 + 0.15, -0.05], [width / 2 + 0.15, 1.1]]) {
      const v = p.clone().addScaledVector(side, o);
      pos.push(v.x, v.y + dy, v.z);
    }
    if (i) {
      const A = (i - 1) * 4, B = i * 4;
      for (let k = 0; k < 3; k++) idx.push(A + k, B + k, A + k + 1, A + k + 1, B + k, B + k + 1);
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cg.setIndex(idx);
  collider.addGeometry(cg);

  ctx.bridgeSpan = { a: a.clone(), b: b.clone(), side, flat, L, width };
  return { deckAt };
}
