// Diffs two anchor files (or two route files) under the tolerance table and prints a readable report.
//   node tools/regress/compare.mjs <baseline.json> <candidate.json> [--lines N]
// Exit code 1 on any failure: an unlisted change, a relaxed change outside its tolerance, or a failed gate.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FLAGS, INVARIANTS } from './tolerances.mjs';
import { summarize, EYE_MARGIN, EYE_BANDS } from './routes.mjs';

// Flags that move geometry: with any of them on, route traces may differ (outcomes and margins are compared).
const GEOMETRY_FLAGS = ['geo', 'calmSmooth', 'relief', 'shoulder'];

const segMatch = (pat, path) => {
  if (!pat.length) return !path.length;
  if (pat[0] === '**') return segMatch(pat.slice(1), path) || (path.length > 0 && segMatch(pat, path.slice(1)));
  return path.length > 0 && (pat[0] === '*' || pat[0] === path[0]) && segMatch(pat.slice(1), path.slice(1));
};
const matches = (pat, path) => segMatch(pat.split('.'), path.split('.'));

// Leaves of a JSON tree as path -> value (empty arrays/objects are leaves too).
function flatten(o, prefix = '', out = new Map()) {
  if (o !== null && typeof o === 'object' && Object.keys(o).length) {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? prefix + '.' + k : k, out);
  } else out.set(prefix, o);
  return out;
}

// Nodes of `o` matching a pattern, as [path, value].
function select(o, pat, prefix = '') {
  const segs = typeof pat === 'string' ? pat.split('.') : pat;
  if (!segs.length) return [[prefix, o]];
  if (o === null || typeof o !== 'object') return [];
  const [h, ...rest] = segs;
  const join = (k) => (prefix ? prefix + '.' + k : k);
  if (h === '**') return [...select(o, rest, prefix), ...Object.entries(o).flatMap(([k, v]) => select(v, segs, join(k)))];
  if (h === '*') return Object.entries(o).flatMap(([k, v]) => select(v, rest, join(k)));
  return h in o ? select(o[h], rest, join(h)) : [];
}
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (v) => {
  const s = typeof v === 'number' ? String(+v.toPrecision(6)) : JSON.stringify(v);
  return s === undefined ? '(missing)' : s.length > 70 ? s.slice(0, 67) + '...' : s;
};

// A limit, or with orBase the baseline where the baseline already misses it: 'pre' marks a value outside the
// plan's limit but no worse than before, so a pre-existing failure on one stack cannot hide a new one elsewhere.
function bound(c, lim, b, orBase, isMax) {
  if (typeof c !== 'number' || Number.isNaN(c)) return false;
  if (isMax ? c <= lim : c >= lim) return true;
  return orBase && typeof b === 'number' && (isMax ? c <= b : c >= b) ? 'pre' : false;
}

function relaxOk(rule, b, c) {
  if (rule === 'any') return true;
  if (typeof b !== 'number' || typeof c !== 'number') return false;
  if ('abs' in rule) return Math.abs(c - b) <= rule.abs;
  if ('plus' in rule) return c <= b + rule.plus;
  if ('minus' in rule) return c >= b - rule.minus;
  return false;
}

// Rules on a node rather than a leaf, reduced to a leaf rule: [path, rule, base, cand], or null to skip.
function resolveGate(p, rule, b, c) {
  // The row nearest a depth of a rowStats array, then the rest of the rule on one of its keys.
  if ('atDepth' in rule) {
    const { atDepth, key, ...inner } = rule;
    if (!Array.isArray(c) || !c.length) return [p, inner, b, undefined];
    const i = c.reduce((bi, r, k) => (Math.abs(r.depth - atDepth) < Math.abs(c[bi].depth - atDepth) ? k : bi), 0);
    return [`${p}.${i}.${key}`, inner, b?.[i]?.[key], c[i][key]];
  }
  // Two leaves of one node: get(num) / get(den) <= limit (rows shallower than minDepth are skipped).
  if ('ratio' in rule) {
    const { ratio: [num, den, max], minDepth = -Infinity, orBase } = rule;
    if (c?.depth < minDepth) return null;
    const q = (o) => (o ? get(o, num) / get(o, den) : NaN);
    return [`${p} ${num}/${den}`, { max, orBase }, q(b), q(c)];
  }
  return [p, rule, b, c];
}

// true, false or 'pre' (see bound).
function gateOk(rule, b, c) {
  if ('equals' in rule) return same(c, rule.equals);
  if ('notEquals' in rule) return c !== undefined && !same(c, rule.notEquals);
  if (typeof rule.addedRms === 'number') {
    if (!Array.isArray(b) || !Array.isArray(c) || b.length !== c.length || !b.length) return false;
    let s = 0;
    for (let i = 0; i < b.length; i++) s += (c[i] - b[i]) ** 2;
    return Math.sqrt(s / b.length) >= rule.addedRms;
  }
  if (typeof c !== 'number') return false;
  if ('max' in rule) return bound(c, rule.max, b, rule.orBase, true);
  if ('min' in rule) return bound(c, rule.min, b, rule.orBase, false);
  if (typeof b !== 'number') return false;
  // Spread added on top of the baseline's, taking the two as independent: sqrt(c^2 - b^2).
  if ('addedSd' in rule) return Math.sqrt(Math.max(0, c * c - b * b)) >= rule.addedSd;
  if ('plus' in rule) return c <= b + rule.plus;
  if ('minus' in rule) return c >= b - rule.minus;
  return false;
}

// Every rule of the table must name something in the baseline: a pattern that matches nothing (a typo, or
// '.min' where the leaves are min.0-min.2) would silently relax or gate nothing.
function deadRules(base, paths) {
  const dead = [];
  for (const [k, f] of Object.entries(FLAGS)) {
    if (f === FLAGS.geo && k !== 'geo') continue;   // calmSmooth shares geo's table
    for (const [pat] of f.relax) if (!paths.some((p) => matches(pat, p))) dead.push(`${k} relax ${pat}`);
    for (const [pat] of f.gates) if (!select(base, pat).length) dead.push(`${k} gate ${pat}`);
  }
  for (const [pat] of INVARIANTS) if (!select(base, pat).length) dead.push(`invariant ${pat}`);
  return dead;
}

export function compareAnchors({ tree = null, ...base }, { tree: _, ...cand }) {   // tree: provenance, not an anchor
  const active = Object.keys(cand.walls || {}).filter((k) => cand.walls[k] && !base.walls?.[k]);
  const relax = [['walls.**', 'any'], ...active.flatMap((k) => FLAGS[k]?.relax ?? [])];
  const gates = [...new Map([...INVARIANTS, ...active.flatMap((k) => FLAGS[k]?.gates ?? [])].map((g) => [JSON.stringify(g), g])).values()];
  const B = flatten(base), C = flatten(cand);
  const fails = deadRules(base, [...B.keys()]).map((d) => ({ path: d, why: 'tolerance rule matches nothing in the baseline' })), relaxed = new Map();
  let exact = 0;
  for (const p of new Set([...B.keys(), ...C.keys()])) {
    const b = B.get(p), c = C.get(p);
    if (same(b, c)) { exact++; continue; }
    const rules = relax.filter(([pat]) => matches(pat, p));
    const ok = rules.find(([, r]) => relaxOk(r, b, c));
    if (ok) relaxed.set(ok[0], (relaxed.get(ok[0]) || 0) + 1);
    else fails.push({ path: p, base: b, cand: c, why: rules.length ? `outside ${JSON.stringify(rules.map((r) => r[1]))}` : !B.has(p) ? 'added' : !C.has(p) ? 'removed' : 'changed (must be exact)' });
  }
  const gateFails = [], gatePre = [];
  let gatePass = 0;
  for (const [pat, rule] of gates) {
    const nodes = select(cand, pat);
    if (!nodes.length) { gateFails.push({ path: pat, why: 'gate matched nothing', rule }); continue; }
    for (const [p0, c0] of nodes) {
      const g = resolveGate(p0, rule, get(base, p0), c0);
      if (!g) continue;
      const [path, r, b, c] = g, v = gateOk(r, b, c);
      if (v === true) gatePass++;
      else (v === 'pre' ? gatePre : gateFails).push({ path, base: b, cand: c, rule: r });
    }
  }
  return { kind: 'anchors', active, tree, exact, relaxed, fails, gateFails, gatePre, gatePass, ok: !fails.length && !gateFails.length };
}

// R6 outcome of a case: clean falls and designed catches pass; the failing ones are ranked, worst last.
const outcome = (c) => (c.landedAt ? (c.pass ? 'caught' : 'landed') : c.pass ? 'fell' : c.breach ? 'breach' : /^never left/.test(c.reason) ? 'never-left' : 'no-fall');
const RANK = { fell: 0, caught: 0, breach: 1, landed: 2, 'no-fall': 2, 'never-left': 2 };
// Worse only where the eye is now within the margin (a clear band getting a little less clear is not a fault).
const eyeWorse = (b, c) => typeof c === 'number' && c < EYE_MARGIN && !(typeof b === 'number' && c >= b - 0.1);

// Why a case got worse, as [kind, text] pairs. A case that already failed must not fail differently or earlier:
// under a geometry flag its trace may change, so what it hit, where and how close are compared instead.
function caseProblems(b, c) {
  if (b.pass && !c.pass) return [['regressed', c.reason]];
  const why = [];
  if (c.group === 'R6') {
    const ob = outcome(b), oc = outcome(c);
    if (oc !== ob && RANK[oc] > 0 && RANK[oc] >= RANK[ob]) why.push(['outcome', `${ob} -> ${oc}: ${c.reason}`]);
    else if (oc === 'landed' && c.landedBy !== b.landedBy) why.push(['landing', `now lands on ${c.landedBy ?? 'the wall'} (was ${b.landedBy ?? 'the wall'}): ${c.reason}`]);
    else if (oc === 'landed' && c.landedAt[1] < b.landedAt[1] - 0.5) why.push(['landing', `lands ${(b.landedAt[1] - c.landedAt[1]).toFixed(1)} m deeper: ${c.reason}`]);
    // Shallower by over 1 m, or 5 % of the depth once the fall's fade has mostly hidden it.
    if (oc === 'breach' && ob === 'breach' && c.breach.depth < b.breach.depth - Math.max(1, 0.05 * b.breach.depth)) why.push(['breach depth', `eye breach starts ${c.breach.depth} m down (was ${b.breach.depth})`]);
    if (!b.pass && !c.pass) {
      EYE_BANDS.forEach((d, k) => {
        const band = `${d}${k + 1 < EYE_BANDS.length ? '-' + EYE_BANDS[k + 1] : '+'} m`;
        if (eyeWorse(b.eyeBands[k], c.eyeBands[k])) why.push(['eye', `eye margin while visible at ${band} down ${b.eyeBands[k]} -> ${c.eyeBands[k]} m`]);
      });
      if (eyeWorse(b.eyeMin, c.eyeMin)) why.push(['eye', `eye margin ${b.eyeMin} -> ${c.eyeMin} m (whole fall)`]);
    }
  }
  // Ledge walks: a snag that only slows the walk, or a bump the walker climbs or drops off.
  if (typeof b.seconds === 'number' && c.seconds > b.seconds * 1.1) why.push(['slower', `${b.seconds} -> ${c.seconds} s (limit +10 %)`]);
  if (b.dy && c.dy && (c.dy[0] < b.dy[0] - 0.25 || c.dy[1] > b.dy[1] + 0.25)) why.push(['dy', `height off the ledge line ${JSON.stringify(b.dy)} -> ${JSON.stringify(c.dy)} m (limit 0.25)`]);
  if (b.sides && c.sides) {
    const out = (L) => L.filter((x) => x.out).length;
    if (out(c.sides) < out(b.sides)) why.push(['creek', `${out(b.sides)} -> ${out(c.sides)} sides get out: ${c.reason}`]);
  }
  return why;
}

export function compareRoutes(base, cand) {
  const active = Object.keys(cand.walls || {}).filter((k) => cand.walls[k] && !base.walls?.[k]);
  const traces = !active.some((k) => GEOMETRY_FLAGS.includes(k));
  const baseById = new Map(base.cases.map((c) => [c.id, c]));
  const byId = new Map(baseById);
  const fails = [], info = [];
  for (const c of cand.cases) {
    const b = byId.get(c.id);
    byId.delete(c.id);
    if (!b) { info.push(`new case ${c.id}: ${c.pass ? 'pass' : 'FAIL ' + c.reason}`); continue; }
    const why = caseProblems(b, c);
    if (traces && b.trace !== c.trace) why.push(['trace', 'trace changed (no geometry flag is on, so the walk must be identical)']);
    for (const [kind, text] of why) fails.push({ path: c.id, kind, why: text });
    if (!why.length && !b.pass && c.pass) info.push(`now passes ${c.id} (was ${b.reason})`);
  }
  for (const id of byId.keys()) fails.push({ path: id, kind: 'missing', why: 'case missing from candidate' });
  const preexisting = cand.cases.filter((c) => !c.pass && baseById.get(c.id)?.pass === false);
  return { kind: 'routes', active, traces, fails, info, preexisting, ok: !fails.length };
}

export function report(r, { lines = 60, label = '' } = {}) {
  const out = [];
  out.push(`== ${r.kind}${label ? ' ' + label : ''}: ${r.ok ? 'PASS' : 'FAIL'}; active flags: ${r.active.length ? r.active.join(', ') : '(none: everything must be exact)'}${r.tree ? `; baseline tree ${r.tree}` : ''}`);
  if (r.kind === 'anchors') {
    out.push(`   ${r.exact} values exact, ${[...r.relaxed.values()].reduce((a, b) => a + b, 0)} relaxed, ${r.fails.length} failed; gates ${r.gatePass} passed, ${r.gateFails.length} failed`);
    for (const [pat, n] of r.relaxed) out.push(`   relaxed ${n} x ${pat}`);
    // One line per array: numeric path segments collapse to '#', the first failing element is shown.
    const groups = new Map();
    for (const f of r.fails) {
      const k = f.path.replace(/\.\d+(?=\.|$)/g, '.#');
      if (!groups.has(k)) groups.set(k, { f, n: 0 });
      groups.get(k).n++;
    }
    for (const [k, { f, n }] of [...groups].slice(0, lines)) {
      if (!('base' in f)) { out.push(`   FAIL ${f.path}  [${f.why}]`); continue; }
      let b = fmt(f.base), c = fmt(f.cand);
      if (b === c) { b = JSON.stringify(f.base); c = JSON.stringify(f.cand); }
      out.push(`   FAIL ${n > 1 ? `${k} (${n} values; first ${f.path})` : f.path}: ${b} -> ${c}  [${f.why}]`);
    }
    if (groups.size > lines) out.push(`   ... ${groups.size - lines} more`);
    for (const g of r.gateFails.slice(0, lines)) out.push(`   GATE ${g.path}: ${g.why ?? `${fmt(g.cand)} (baseline ${fmt(g.base)}) violates ${JSON.stringify(g.rule)}`}`);
    if (r.gatePre.length) out.push(`   ${r.gatePre.length} gate values outside the plan's limit but no worse than the baseline (pre-existing):`);
    for (const g of r.gatePre.slice(0, lines)) out.push(`     ${g.path}: ${fmt(g.cand)} (baseline ${fmt(g.base)}) ${JSON.stringify(g.rule)}`);
  } else {
    const kinds = new Map();
    for (const f of r.fails) kinds.set(f.kind, (kinds.get(f.kind) || 0) + 1);
    out.push(`   ${r.fails.length} failed${kinds.size ? ` (${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}; traces ${r.traces ? 'compared' : 'not compared (geometry flag on)'}; ${r.preexisting.length} failing in both`);
    for (const f of r.fails.slice(0, lines)) out.push(`   FAIL ${f.path}: [${f.kind}] ${f.why}`);
    if (r.preexisting.length) out.push('   failing in both (pre-existing):', ...summarize({ cases: r.preexisting }).split('\n').slice(1).map((s) => ' ' + s));
    for (const s of r.info.slice(0, lines)) out.push(`   ${s}`);
  }
  return out.join('\n');
}

export function compareFiles(baseFile, candFile, opts) {
  const base = JSON.parse(fs.readFileSync(baseFile, 'utf8')), cand = JSON.parse(fs.readFileSync(candFile, 'utf8'));
  if (base.kind !== cand.kind) throw new Error(`cannot compare ${base.kind} with ${cand.kind}`);
  if (base.version !== cand.version) throw new Error(`format version ${base.version} vs ${cand.version}: re-record the baseline`);
  const r = base.kind === 'routes' ? compareRoutes(base, cand) : compareAnchors(base, cand);
  console.log(report(r, { ...opts, label: `${baseFile} -> ${candFile}` }));
  return r.ok;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [a, b] = process.argv.slice(2).filter((s, i, all) => !s.startsWith('--') && all[i - 1] !== '--lines');
  if (!a || !b) { console.error('usage: node tools/regress/compare.mjs <baseline.json> <candidate.json> [--lines N]'); process.exit(2); }
  const i = process.argv.indexOf('--lines');
  process.exit(compareFiles(a, b, { lines: i > 0 ? +process.argv[i + 1] : 60 }) ? 0 : 1);
}
