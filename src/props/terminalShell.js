import { mulberry32 } from '../core/rng.js';

// The bunker terminal's shell: the filesystem, a little bash, the line editor and the screen buffer. Pure (no DOM, no
// three): props/terminal.js draws it on the CRT and feeds it keys, and the headless tests drive it directly.
//
// The screen is COLS x ROWS character cells, each with an attribute byte (see below). The scrollback is a list of
// lines { t, a } (a: one attribute for the whole line, or one per character); screen() wraps them at COLS, adds the line
// being edited (prompt + input) and returns the ROWS rows on view plus where the cursor is. `version` goes up whenever
// anything on screen changes, so the renderer only re-uploads then.
//
// The one program that matters is /opt/survey/bin/rocks.exe. Until the observatory has read the ring off the sky
// (coords()), it refuses (--help aside) and the one run isn't spent. Then it says so, prints "executing rocks" and a
// dot every DOT_TIME s up to four, and calls onRun() (the cutscene). The shell waits, with no prompt, until
// returnFromFeed() prints the garbled tail of the lost camera link; if the blast really went off, the program's own
// verdict follows a beat later (still no prompt: the chair holds you till it's printed), then a fresh prompt.
// state().ran is set the moment it starts and after that running it again prints nothing at all.
//
// And one command nobody lists: REMOTE_TRANSFORM, the word typed on the note in the lounge desk's drawer (in any case,
// whatever follows it ignored; help, ls and Tab know nothing of it). It asks onPicture('mars') for its picture. Taken
// (true), the shell is locked: no prompt, every key swallowed, the rest of the line dropped, until release() gives a
// fresh prompt under the command (nothing else is printed). Not taken, it prints one line: no carrier.

export const COLS = 64, ROWS = 24;
// Attributes: brightness level in the low two bits, bold (the heavier glyphs) in bit 2.
export const DIM = 0, NORM = 1, BRIGHT = 2, HOT = 3, BOLD = 4;
// Every character outside printable ASCII the shell ever prints (the renderer builds glyphs for exactly these).
const MOJI = 'ÃÂ¤¦§¨©«¬®¯°±²³µ¶¸¹º»¼½¾¿ÐÞßðþÿæøåØÆ¡¢£¥à';
export const EXTRA_GLYPHS = '·░▒▓█●▶─│┌┐└┘├┤┬┴┼' + MOJI;

const HOME = '/home/operator';
const DOT_TIME = 0.35;   // s between the dots of "executing rocks...."
const DOTS = 4;
const HOLD = 0.35;       // s the finished line stays up before onRun
const FEED_TIMEOUT = 30; // s: if nobody calls returnFromFeed (no cutscene), come back by ourselves
const NO_RUN_RETURN = 1; // s: ...and much sooner when there's no onRun at all
// After the link is lost: s before each of rocks.exe's closing lines (the first once the screen's glitch has settled).
const TAIL = [1.1, 0.7];
const MAX_LINES = 400;   // scrollback kept

// rocks.exe's words: refused (no coordinates), found, and its verdict once the stones are down.
const NO_COORDS = [['rocks coordinates not found.', BRIGHT], ['Please retrieve coordinates from Observatory.', NORM]];
const FOUND = 'Coordinates found from Observatory! Proceeding with blast.';
const VERDICT = [['Blast coordinates resolution errors detected...', HOT], ['Manually positioning rocks is required', BRIGHT]];
// The lounge note's word, the picture it asks for, and what it says when there's none to show.
const SECRET = 'REMOTE_TRANSFORM', PICTURE = 'mars';
const NO_CARRIER = 'REMOTE_TRANSFORM: no carrier';
const MAX_INPUT = 240;

const HELP = [
  '  ls [-a] [-l] [dir]   list a directory',
  '  cd <dir>             change directory  (cd .. goes up)',
  '  pwd                  where am I',
  '  cat <file>           print a file',
  '  clear                clear the screen',
  '  exit                 leave the terminal',
  '  to run a program, type its path:  ./program',
];

const COMMANDS = ['help', 'ls', 'll', 'cd', 'pwd', 'cat', 'clear', 'exit', 'logout', 'echo', 'whoami', 'hostname', 'date',
  'uname', 'history', 'file', 'head', 'tail', 'less', 'more', 'tree', 'ps', 'kill', 'sudo', 'man', 'rm', 'mv', 'cp',
  'touch', 'mkdir', 'vi', 'vim', 'nano', 'emacs', 'ssh', 'ping', 'curl', 'wget', 'reboot', 'shutdown', 'sh', 'bash',
  'run', 'exec', 'start', 'open', 'wine'];
const RUNNERS = new Set(['sh', 'bash', 'run', 'exec', 'start', 'open', 'wine']);
const WRITERS = new Set(['rm', 'mv', 'cp', 'touch', 'mkdir']);
const EDITORS = new Set(['vi', 'vim', 'nano', 'emacs']);
const NETWORK = new Set(['ssh', 'ping', 'curl', 'wget']);
const ERR = { ENOENT: 'No such file or directory', ENOTDIR: 'Not a directory', EACCES: 'Permission denied', EISDIR: 'Is a directory' };

// ---- the filesystem ----
// dir: { type 'dir', children, owner, date, denied }; file: { type 'file', kind (text | elf | script | jpeg | core),
// text (a string, or (state) => string for the files that change once rocks.exe has run), exec, size, owner, date }.
// A directory's children have no prototype, so a typed name like `constructor` or `__proto__` finds nothing.
function buildFs() {
  const dir = (children, o = {}) => ({ type: 'dir', owner: 'root', date: 'Sep  1 09:12', ...o, children: Object.assign(Object.create(null), children) });
  const txt = (lines, o = {}) => ({ type: 'file', kind: 'text', owner: 'root', date: 'Sep  1 09:12', ...o, text: typeof lines === 'function' ? lines : lines.join('\n') });
  const op = (lines, date, o = {}) => txt(lines, { owner: 'operator', date, ...o });
  const elf = (size, o = {}) => ({ type: 'file', kind: 'elf', exec: true, size, owner: 'root', date: 'Mar  3 11:20', ...o });
  const jpg = (size, date) => ({ type: 'file', kind: 'jpeg', size, owner: 'operator', date });
  const bin = {};
  [['ls', 11264], ['cat', 5120], ['cd', 2048], ['pwd', 3072], ['sh', 61440], ['echo', 2560], ['clear', 2304]]
    .forEach(([n, s]) => { bin[n] = elf(s, { builtin: n }); });
  return dir({
    bin: dir(bin),
    etc: dir({
      motd: txt(['BUNKER 7 · SURVEY RELAY', 'authorised personnel only', '', "type 'help' for a list of commands."]),
      hostname: txt(['bunker7']),
      passwd: txt(['root:x:0:0:root:/root:/bin/sh', 'operator:x:100:100:operator:/home/operator:/bin/sh', 'c:x:101:100:C.:/home/c:/bin/sh']),
    }),
    home: dir({
      c: dir({}, { owner: 'c', denied: true, date: 'Sep 12 16:24' }),
      operator: dir({
        'notes.txt': op([
          '- radar sweep is drifting again. recalibrate before next shift.',
          '- the lift to the lounge sticks between floors. ride it anyway.',
          '- survey kit moved to /opt/survey. DO NOT run anything in',
          '  its bin/ until the ring is marked out.',
          '- whoever keeps leaving the top door open: close it.',
        ], 'Sep 12 17:52'),
        'todo.txt': op([
          '[x] replace the middle pendant bulb',
          '[ ] radar: recalibrate sweep (+2 deg drift)',
          '[ ] scope probe B is noisy. check the ground.',
          '[ ] order coffee',
          '[ ] order more coffee',
          '[ ] water the plant (which plant?)',
        ], 'Sep 13 06:01'),
        '.bash_history': op(['ls', 'cd mail', 'cat 003-survey.txt', 'cd /opt/survey', 'ls', 'cd bin', './rocks.exe --dry-run', 'cd ~', 'clear'], 'Sep 12 18:29'),
        '.profile': op(["export PS1='\\u@\\h:\\w\\$ '", 'export PATH=/bin:/opt/radar', "alias ll='ls -l'"], 'Jun  4 10:02'),
        mail: dir({
          '001-generator.txt': op(['From: hub', 'Subject: generator', '', 'The hub generator carries four lines. Load it gently.',
            "If the scope goes flat you've asked too much of it."], 'Aug 29 14:10'),
          '002-lamps.txt': op(['From: maintenance', 'Subject: pendants', '', "Bulbs replaced. The middle pendant hums. That's normal.",
            'Please stop hitting it.'], 'Sep  4 09:47'),
          '003-survey.txt': op(['From: C.', 'Subject: the ring', '', 'Charges are set in the tor. Five stones, near enough the same',
            'size, should come off the top clean. rocks.exe arms and fires', 'them in one go. There is no undo.', '',
            'Camera 07 is on the big tree, so we can watch from down here.', "Don't run it until the ring is marked out.", '  - C.'], 'Sep 11 21:16'),
          '004-re-the-ring.txt': op(['From: operator', 'Subject: Re: the ring', '', 'Marked out with what? You took the chalk.'], 'Sep 12 16:58'),
        }, { owner: 'operator', date: 'Sep 12 16:58' }),
        logs: dir({
          'shift-0911.log': op(['06:00  shift start. coffee machine: no.', '06:40  radar: 3 contacts. all gulls.',
            '09:15  lift to the lounge stuck 4 min. walked it off.', '12:00  generator steady.', '18:30  shift end. top door left open (not me).'], 'Sep 11 18:30'),
          'shift-0912.log': op(['06:00  shift start.', '07:10  scope probe B noisy again.', '11:45  you can hear the falls on cam07 if you turn it up.',
            '16:20  C. down for the survey kit. took the chalk.', '18:30  shift end.'], 'Sep 12 18:30'),
          'shift-0913.log': op(['06:00  shift start.'], 'Sep 13 06:00'),
        }, { owner: 'operator', date: 'Sep 13 06:00' }),
        radar: dir({
          'sweep.cfg': op(['# radar sweep', 'rpm        = 12', 'range_km   = 4', 'drift_deg  = +2.1    # FIXME', 'gain       = 0.82'], 'Sep  9 15:33'),
          'contacts.log': op(['T+0012  brg 041  rng 0.6 km  small   gulls', 'T+0340  brg 210  rng 3.9 km  large   cloud',
            'T+0911  brg 133  rng 0.7 km  ---     ???'], 'Sep 13 05:58'),
        }, { owner: 'operator', date: 'Sep 13 05:58' }),
        scope: dir({
          'readme.txt': op(['probe A: generator line', 'probe B: tor spring flow meter (noisy)'], 'Aug 30 11:05'),
          'probe-b.csv': op(['t,v', '0.000,0.41', '0.001,0.77', '0.002,0.52', '0.003,0.95', '0.004,0.38'], 'Sep 12 07:12'),
        }, { owner: 'operator', date: 'Sep 12 07:12' }),
        photos: dir({
          'dome_sunset.jpg': jpg(48211, 'Aug 21 20:14'),
          'cat.jpg': jpg(31877, 'Aug 25 12:40'),
          'cam07_test.jpg': jpg(57302, 'Sep 11 21:30'),
        }, { owner: 'operator', date: 'Sep 11 21:30' }),
        recipes: dir({
          'chili.txt': op(['CHILI (bunker edition)', '  2 tins beans', '  1 tin tomatoes', '  whatever is left', 'simmer until the shift ends.'], 'Jul 17 19:22'),
        }, { owner: 'operator', date: 'Jul 17 19:22' }),
      }, { owner: 'operator', date: 'Sep 13 06:01' }),
    }),
    opt: dir({
      radar: dir({ sweepd: elf(22508, { run: 'sweepd', date: 'Feb 11 16:40' }) }),
      survey: dir({
        README: txt(['SURVEY KIT', '  bin/       field tools', '  charges/   charge layout and log', '  ring/      stone ring notes', '',
          'Five stones from the tor, set in a ring.', 'The ring is drawn in the sky over the island:', 'read it from the observatory.'],
        { owner: 'c', date: 'Sep 11 20:02' }),
        bin: dir({
          'rocks.exe': elf(41216, { run: 'rocks', owner: 'c', date: 'Sep 11 20:40' }),
          'calib.sh': txt(['#!/bin/sh', '# level the theodolite before a survey', 'stty 1200 < /dev/theodolite', 'echo "LV" > /dev/theodolite'],
            { kind: 'script', exec: true, run: 'calib', owner: 'c', date: 'Sep 11 19:58' }),
        }, { owner: 'c', date: 'Sep 11 20:40' }),
        charges: dir({
          'layout.txt': txt(['charge  tier  depth', '  1      2    0.8 m', '  2      2    0.8 m', '  3      3    0.6 m', '  4      cap  0.5 m',
            '  5      cap  0.5 m', '5 charges, in series, on rocks.exe'], { owner: 'c', date: 'Sep 11 20:31' }),
          'log.txt': txt((st) => ['armed: yes', st.ran ? 'fired: yes' : 'fired: no'].join('\n'), { owner: 'c', date: 'Sep 11 20:33', dyn: true }),
        }, { owner: 'c', date: 'Sep 11 20:33' }),
        ring: dir({
          'notes.txt': txt(['five stones, evenly spaced round the middle of the island.', "the creek runs through the ring. that's fine. that's the point."],
            { owner: 'c', date: 'Sep 10 22:47' }),
        }, { owner: 'c', date: 'Sep 10 22:47' }),
      }, { owner: 'c', date: 'Sep 11 20:40' }),
    }),
    tmp: dir({ 'core.1187': { type: 'file', kind: 'core', size: 131072, owner: 'root', date: 'Sep 12 03:14' } }, { date: 'Sep 12 03:14' }),
    var: dir({
      log: dir({
        syslog: txt((st) => ['kernel: bunker7 up', 'sweepd[212]: started', 'scoped[214]: probe B: signal noisy', 'cam07d[230]: link up (sequoia)',
          ...(st.ran ? ['cam07d[230]: link lost'] : [])].join('\n'), { date: 'Sep 13 06:00', dyn: true }),
      }),
    }),
  });
}

const isDir = (n) => n?.type === 'dir';
// The letter of a Ctrl chord: the one the layout types (Dvorak's Ctrl+C is on the QWERTY I), else the physical key's
// (a Cyrillic layout types a Cyrillic letter there). ui/terminalKeys.js traps the same ones.
export const ctrlLetter = (e) => (/^[a-z]$/i.test(e.key ?? '') ? e.key.toLowerCase() : (e.code || '').replace(/^Key/, '').toLowerCase());
const hidden = (name) => name.startsWith('.');
const words = (s) => s.split(/\s+/).filter(Boolean);

// A deterministic line of garbage for a binary file (seeded by its path), led by its format's magic bytes.
function mojibake(path, kind) {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619);
  const r = mulberry32(h >>> 0);
  const lead = kind === 'jpeg' ? 'ÿØÿà JFIF' : 'ELF¤';
  const pool = MOJI + MOJI + '@^~`{}|<>#$%&*+=?PKH_;:';
  let s = lead;
  const n = 46 + Math.floor(r() * 14);
  while (s.length < n) s += r() < 0.12 ? ' ' : pool[Math.floor(r() * pool.length)];
  return s;
}

// Longest common prefix of a list of strings.
const lcp = (list) => list.reduce((p, s) => { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; return p.slice(0, i); });

// Splits a command line into words: '...' and "..." quote, \ escapes, $VAR / ${VAR} expand outside single quotes.
// Also splits off ; && | and > as their own words (marked { op }).
function tokenize(line, env) {
  const out = [];
  let cur = null, q = null;
  const push = () => { if (cur !== null) { out.push(cur); cur = null; } };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q === "'") { if (ch === "'") q = null; else cur += ch; continue; }
    if (ch === '\\' && i + 1 < line.length) { cur = (cur ?? '') + line[++i]; continue; }
    if (ch === '$' && /[A-Za-z_{]/.test(line[i + 1] ?? '')) {
      const m = /^\$(?:\{(\w+)\}|(\w+))/.exec(line.slice(i));
      if (m) { const v = m[1] ?? m[2]; cur = (cur ?? '') + (Object.hasOwn(env, v) ? env[v] : ''); i += m[0].length - 1; continue; }
    }
    if (q === '"') { if (ch === '"') q = null; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur = cur ?? ''; continue; }
    if (/\s/.test(ch)) { push(); continue; }
    if (ch === ';' || ch === '|' || ch === '>' || (ch === '&' && line[i + 1] === '&')) {
      push();
      let op = ch;
      if (ch === '&' || (ch === '|' && line[i + 1] === '|') || (ch === '>' && line[i + 1] === '>')) { op += line[i + 1]; i++; }
      out.push({ op });
      continue;
    }
    cur = (cur ?? '') + ch;
  }
  push();
  return out;
}

// coords: () => bool, whether the observatory's coordinates are in (rocks.exe won't run without them; a shell made
// without it is a new game's: they aren't).
export function createShell({ state = () => ({ ran: false, cwd: HOME }), cols = COLS, rows = ROWS, random = Math.random, coords = () => false } = {}) {
  const fs = buildFs();
  const st = () => state();
  const lines = [];
  const history = [];
  let buf = '', cur = 0;               // the line being edited and the cursor in it
  let histIdx = 0, draft = '';
  let oldpwd = null;
  let scroll = 0;                      // rows scrolled back from the bottom (PageUp / PageDown)
  // The running program: { t, line, phase: 'dots' | 'feed' | 'tail', wait, timeout, taken (onRun took it), said }.
  let run = null;
  let pic = null;                      // the picture on the tube (REMOTE_TRANSFORM): its name while the shell is locked
  let lastTab = null;                  // the completion list shown by the last Tab (a second Tab doesn't repeat it)
  let sink = null;                     // output captured for a pipe

  const shell = {
    cols, rows, version: 0, pushed: 0, lines, history,
    onRun: null,      // () => bool: the program has finished printing (return false if nothing will call returnFromFeed)
    onExit: null,     // exit / logout
    onPicture: null,  // (name) => bool: REMOTE_TRANSFORM asks for its picture (true: shown, and release() will be called)
    get cwd() { return validCwd(); },
    get busy() { return !!run; },
    get phase() { return run?.phase ?? null; },   // rocks.exe's: 'dots', 'feed' (the cutscene's), 'tail', or null
    get locked() { return !!pic; },               // a picture has the tube: no prompt, no input (not busy: nothing runs)
    get input() { return buf; },
    get cursor() { return cur; },
    key, exec, update, screen, returnFromFeed, release, complete, resolve: lookup, prompt: () => promptSegs(),
    reset,
  };
  const touch = () => { shell.version++; };

  // ---- paths ----
  function validCwd() {
    const s = st();
    const r = lookup(s.cwd || HOME, '/');
    if (!r.node || !isDir(r.node) || r.node.denied) s.cwd = HOME;
    return s.cwd || HOME;
  }
  // The absolute path parts of a path typed at the prompt: ~ is home, . and .. as usual (.. at / stays at /).
  function absParts(path, cwd) {
    let base = cwd;
    if (path === '~' || path.startsWith('~/')) { base = HOME; path = path.slice(1); }
    else if (path.startsWith('/')) base = '/';
    const parts = base.split('/').filter(Boolean);
    for (const s of path.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') parts.pop(); else parts.push(s);
    }
    return parts;
  }
  // { node, abs, err } for a typed path. err: ENOENT, ENOTDIR (through a file, or a file with a trailing /), EACCES
  // (inside a denied directory). A denied directory itself is found (cd / ls refuse to open it).
  function lookup(path, cwd = validCwd()) {
    const parts = absParts(path, cwd);
    let node = fs;
    for (let i = 0; i < parts.length; i++) {
      if (!isDir(node)) return { node: null, abs: null, err: 'ENOTDIR' };
      if (node.denied) return { node: null, abs: null, err: 'EACCES' };
      node = node.children[parts[i]];
      if (!node) return { node: null, abs: null, err: 'ENOENT' };
    }
    const abs = '/' + parts.join('/');
    if (!isDir(node) && /\/\.?$/.test(path)) return { node: null, abs, err: 'ENOTDIR' };
    return { node, abs, err: null };
  }
  const tilde = (p) => (p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p);
  const textOf = (n) => (typeof n.text === 'function' ? n.text(st()) : n.text);
  const sizeOf = (n) => (isDir(n) ? 4096 : n.size ?? textOf(n).length + 1);
  const nameAttr = (name, n) => (isDir(n) ? BRIGHT | BOLD : hidden(name) ? DIM : n.exec ? BRIGHT : NORM);
  const nameShown = (name, n) => (isDir(n) ? name + '/' : name);

  // ---- output ----
  // direct: straight to the screen even inside a pipe (rocks.exe's line, which the dots then animate).
  function pushLine(l, direct = false) {
    if (sink && !direct) { sink.push(l); return; }
    lines.push(l);
    shell.pushed++;
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    touch();
  }
  const out = (t = '', a = NORM) => pushLine({ t, a });
  // A line from [text, attr] pairs. hard: a typed line echoed with its prompt, which wraps as it did while typed.
  function outSegs(segs, hard = false) {
    let t = ''; const a = [];
    for (const [s, at] of segs) { t += s; for (let i = 0; i < s.length; i++) a.push(at); }
    pushLine(hard ? { t, a, hard } : { t, a });
  }
  const outText = (text, a = NORM) => { for (const l of text.split('\n')) out(l, a); };

  function promptSegs() {
    return [['operator@bunker7', BRIGHT | BOLD], [':', NORM], [tilde(validCwd()), BRIGHT | BOLD], ['$ ', NORM]];
  }
  const promptLen = () => promptSegs().reduce((n, s) => n + s[0].length, 0);

  // Names in columns, as ls lays them out (down then across), within the screen width.
  function columns(items) {
    if (!items.length) return;
    const n = items.length;
    let best = 1, widths = [Math.max(...items.map((it) => it.s.length))];
    for (let c = n; c > 1; c--) {
      const r = Math.ceil(n / c);
      const ws = [];
      for (let j = 0; j < c; j++) ws.push(Math.max(0, ...items.slice(j * r, j * r + r).map((it) => it.s.length)));
      if (ws.reduce((a, b) => a + b, 0) + 2 * (c - 1) <= cols) { best = c; widths = ws; break; }
    }
    const r = Math.ceil(n / best);
    for (let i = 0; i < r; i++) {
      const segs = [];
      for (let j = 0; j < best; j++) {
        const it = items[j * r + i];
        if (!it) continue;
        const last = j === best - 1 || !items[(j + 1) * r + i];
        segs.push([last ? it.s : it.s.padEnd(widths[j] + 2), it.a]);
      }
      outSegs(segs);
    }
  }

  // ---- commands ----
  const entries = (dirNode, all) => {
    const names = Object.keys(dirNode.children).filter((k) => all || !hidden(k))
      .sort((a, b) => a.replace(/^\./, '').localeCompare(b.replace(/^\./, '')));
    return names.map((name) => ({ name, node: dirNode.children[name] }));
  };
  const perm = (n) => (isDir(n) ? (n.denied ? 'drwx------' : 'drwxr-xr-x') : n.exec ? '-rwxr-xr-x' : '-rw-r--r--');
  function longLine({ name, node }) {
    const links = isDir(node) ? 2 + Object.values(node.children).filter(isDir).length : 1;
    const meta = `${perm(node)} ${String(links).padStart(2)} ${(node.owner || 'root').padEnd(8)} ${String(sizeOf(node)).padStart(6)} ${node.date} `;
    outSegs([[meta, DIM], [nameShown(name, node), nameAttr(name, node)]]);
  }

  function ls(args) {
    let all = false, long = false;
    const paths = [];
    for (const a of args) {
      if (a === '--all') all = true;
      else if (a.startsWith('--')) { out(`ls: unrecognized option '${a}'`); return; }
      else if (a.startsWith('-') && a.length > 1) {
        for (const ch of a.slice(1)) {
          if (ch === 'a' || ch === 'A') all = true;
          else if (ch === 'l') long = true;
          else if (!'1FhGgs'.includes(ch)) { out(`ls: invalid option -- '${ch}'`); out("Try 'help' for more information."); return; }
        }
      } else paths.push(a);
    }
    const one = !paths.length;
    if (one) paths.push('.');
    const files = [], dirs = [];
    for (const p of paths) {
      const r = lookup(p);
      if (r.err) out(`ls: cannot access '${p}': ${ERR[r.err]}`);
      else if (isDir(r.node)) dirs.push({ p, node: r.node });
      else files.push({ name: p, node: r.node });
    }
    if (files.length) {
      if (long) files.forEach(longLine); else columns(files.map((f) => ({ s: f.name, a: nameAttr(f.name.split('/').pop(), f.node) })));
    }
    dirs.forEach(({ p, node }, i) => {
      if ((files.length || i > 0) && !node.denied) out('');
      if (paths.length > 1 && !node.denied) out(p + ':', NORM);
      if (node.denied) { out(`ls: cannot open directory '${p}': Permission denied`); return; }
      const list = entries(node, all);
      if (all) list.unshift({ name: '.', node }, { name: '..', node: lookup(p.replace(/\/*$/, '') + '/..').node ?? node });
      if (long) {
        out('total ' + list.reduce((s, e) => s + Math.ceil(sizeOf(e.node) / 1024) * 4, 0), DIM);
        list.forEach(longLine);
      } else columns(list.map((e) => ({ s: nameShown(e.name, e.node), a: nameAttr(e.name, e.node) })));
    });
  }

  function cd(args) {
    if (args.length > 1) { out('bash: cd: too many arguments'); return; }
    let p = args[0] ?? '~';
    if (p === '-') {
      if (!oldpwd) { out('bash: cd: OLDPWD not set'); return; }
      p = oldpwd; out(p);
    }
    const r = lookup(p);
    if (r.err) { out(`bash: cd: ${p}: ${ERR[r.err]}`); return; }
    if (!isDir(r.node)) { out(`bash: cd: ${p}: Not a directory`); return; }
    if (r.node.denied) { out(`bash: cd: ${p}: Permission denied`); return; }
    const s = st();
    if (s.cwd !== r.abs) { oldpwd = validCwd(); s.cwd = r.abs; }
    touch();
  }

  // Reads a file for cat & co: its lines, or prints the error and returns null.
  function readFile(cmd, p) {
    const r = lookup(p);
    if (r.err) { out(`${cmd}: ${p}: ${ERR[r.err]}`); return null; }
    if (isDir(r.node)) { out(cmd === 'head' || cmd === 'tail' ? `${cmd}: error reading '${p}': Is a directory` : `${cmd}: ${p}: Is a directory`); return null; }
    const n = r.node;
    if (n.kind === 'text' || n.kind === 'script') return { lines: textOf(n).split('\n'), binary: false };
    return { lines: [mojibake(r.abs, n.kind)], binary: true };
  }
  function cat(cmd, args) {
    const files = args.filter((a) => !/^-./.test(a));
    if (!files.length) { out(`${cmd}: missing file operand`); return; }
    for (const p of files) {
      const f = readFile(cmd, p);
      if (f) f.lines.forEach((l) => out(l, f.binary ? DIM : NORM));
    }
  }
  function headTail(cmd, args, piped) {
    let n = 10;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-n') n = parseInt(args[++i], 10);
      else if (/^-n?\d+$/.test(a)) n = parseInt(a.replace(/^-n?/, ''), 10);
      else files.push(a);
    }
    if (!Number.isFinite(n) || n < 0) { out(`${cmd}: invalid number of lines`); return; }
    const take = (ls_) => (cmd === 'head' ? ls_.slice(0, n) : n ? ls_.slice(-n) : []);
    if (piped) { take(piped).forEach(pushLine); return; }
    if (!files.length) { out(`${cmd}: missing file operand`); return; }
    files.forEach((p, i) => {
      const f = readFile(cmd, p);
      if (!f) return;
      if (files.length > 1) { if (i) out(''); out(`==> ${p} <==`, BRIGHT); }
      take(f.lines).forEach((l) => out(l, f.binary ? DIM : NORM));
    });
  }

  function file(args) {
    if (!args.length) { out('Usage: file <file>'); return; }
    for (const p of args) {
      const r = lookup(p);
      if (r.err) { out(`${p}: cannot open '${p}' (${ERR[r.err]})`); continue; }
      const n = r.node;
      const what = isDir(n) ? 'directory' : n.kind === 'jpeg' ? 'JPEG image data, JFIF standard 1.01'
        : n.kind === 'elf' ? 'ELF 32-bit executable, Motorola m68k' : n.kind === 'core' ? "core file, from 'sweepd'"
          : n.kind === 'script' ? 'POSIX shell script, ASCII text executable' : 'ASCII text';
      out(`${p}: ${what}`);
    }
  }

  function tree(args) {
    const p = args.find((a) => !a.startsWith('-')) ?? '.';
    const r = lookup(p);
    if (r.err || !isDir(r.node)) { out(`${p} [error opening dir]`); return; }
    let nd = 0, nf = 0;
    out(p, BRIGHT | BOLD);
    const walk = (node, pre) => {
      const list = entries(node, false);
      list.forEach(({ name, node: c }, i) => {
        const last = i === list.length - 1;
        const branch = pre + (last ? '└── ' : '├── ');
        if (isDir(c)) {
          nd++;
          if (c.denied) { outSegs([[branch, DIM], [name, BRIGHT | BOLD], ['  [error opening dir]', NORM]]); return; }
          outSegs([[branch, DIM], [name, BRIGHT | BOLD]]);
          walk(c, pre + (last ? '    ' : '│   '));
        } else { nf++; outSegs([[branch, DIM], [name, nameAttr(name, c)]]); }
      });
    };
    if (r.node.denied) out('  [error opening dir]'); else walk(r.node, '');
    out('');
    out(`${nd} director${nd === 1 ? 'y' : 'ies'}, ${nf} file${nf === 1 ? '' : 's'}`);
  }

  // ---- programs ----
  // Runs an executable node (typed as `shown`, for the messages).
  function runNode(node, shown, args) {
    if (node.builtin) { command(node.builtin, args); return; }
    if (node.run === 'sweepd') { out('sweepd: already running (pid 212)'); return; }
    if (node.run === 'calib') { out('calib.sh: line 3: /dev/theodolite: No such device'); return; }
    if (node.run === 'rocks') { rocks(args); return; }
    out(`bash: ${shown}: cannot execute binary file`);
  }
  // A path typed as a command (or given to sh / run / ...): run it, or say why not.
  function runPath(p, args, who = 'bash') {
    const r = lookup(p);
    if (r.err) { out(`${who}: ${p}: ${ERR[r.err]}`); return; }
    if (isDir(r.node)) { out(`${who}: ${p}: Is a directory`); return; }
    if (!r.node.exec) { out(`${who}: ${p}: Permission denied`); return; }
    runNode(r.node, p, args);
  }

  function rocks(args) {
    const s = st();
    if (s.ran) return;   // once only: after that, nothing at all
    if (args.includes('--help') || args.includes('-h')) { out('usage: rocks.exe   (arms and fires. no options.)'); return; }
    // (A dry run needs the coordinates too; neither refusal spends the one run.)
    if (!coords()) { for (const [t, a] of NO_COORDS) out(t, a); return; }
    if (args.includes('--dry-run') || args.includes('-n')) { out('dry run: 5 charges ok. nothing fired.'); return; }
    s.ran = true;
    // (direct, like the dots' line: a pipe never swallows what the program says as it fires)
    pushLine({ t: FOUND, a: BRIGHT }, true);
    run = { t: 0, line: { t: 'executing rocks', a: BRIGHT }, phase: 'dots', wait: 0, taken: false, said: 0 };
    pushLine(run.line, true);
  }

  // REMOTE_TRANSFORM: the picture, if whoever draws the screen has it (the shell locked until release()); else a line.
  function remote() {
    if (shell.onPicture?.(PICTURE) === true) { pic = PICTURE; touch(); return; }
    out(NO_CARRIER);
  }
  // The picture's put away: the prompt's back, under the command that asked for it.
  function release() {
    if (!pic) return;
    pic = null;
    histIdx = history.length;
    touch();
  }

  function command(name, args, piped) {
    switch (name) {
      case 'help': HELP.forEach((l) => out(l)); return;
      case 'ls': ls(args); return;
      case 'll': ls(['-l', ...args]); return;
      case 'cd': cd(args); return;
      case 'pwd': out(validCwd()); return;
      case 'cat': case 'less': case 'more':
        if (piped) { piped.forEach(pushLine); return; }
        cat(name, args); return;
      case 'head': case 'tail': headTail(name, args, piped); return;
      case 'clear': lines.length = 0; scroll = 0; touch(); return;
      case 'exit': case 'logout': out('logout', DIM); shell.onExit?.(); return;
      case 'echo': out(args.filter((a, i) => !(i === 0 && a === '-n')).join(' ')); return;
      case 'whoami': out('operator'); return;
      case 'hostname': out('bunker7'); return;
      case 'date': out('Thu Sep 13 06:02:11 1979'); return;
      case 'uname': {
        const f = args.join('');
        out(/a/.test(f) ? 'BUNKER7 3.1 survey-relay m68k' : /r/.test(f) ? '3.1' : /m/.test(f) ? 'm68k' : /n/.test(f) ? 'bunker7' : 'BUNKER7');
        return;
      }
      case 'history': history.forEach((h, i) => out(`${String(i + 1).padStart(5)}  ${h}`)); return;
      case 'file': file(args); return;
      case 'tree': tree(args); return;
      case 'ps':
        out('  PID TTY      TIME CMD', DIM);
        [['1', '?   ', '00:00:02', 'init'], ['212', '?   ', '00:41:07', 'sweepd'], ['214', '?   ', '00:12:55', 'scoped'],
          ['230', '?   ', '00:03:31', 'cam07d'], ['301', 'tty0', '00:00:00', 'bash'], ['412', 'tty0', '00:00:00', 'ps']]
          .forEach(([pid, tty, time, cmd]) => out(`${pid.padStart(5)} ${tty} ${time} ${cmd}`));
        return;
      case 'kill': out('kill: operation not permitted'); return;
      case 'sudo': out('operator is not in the sudoers file.  This incident will be reported.'); return;
      case 'man': out(args.length ? `No manual entry for ${args[0]}` : 'What manual page do you want?'); return;
      case 'reboot': case 'shutdown': out('must be superuser.'); return;
      default: break;
    }
    if (WRITERS.has(name)) { out(`${name}: cannot write: Read-only file system`); return; }
    if (EDITORS.has(name)) { out(`${name}: no editor on this system (try cat)`); return; }
    if (NETWORK.has(name)) { out(`${name}: network is unreachable`); return; }
    if (RUNNERS.has(name)) {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target) return;
      runPath(target, args.slice(args.indexOf(target) + 1), name === 'sh' ? 'sh' : 'bash');
    }
  }

  // One simple command (its words).
  function simple(argv, piped) {
    const [name, ...args] = argv;
    if (name.toUpperCase() === SECRET) { remote(); return; }   // (the note's word: not in COMMANDS, so never listed or completed)
    if (name.includes('/')) { runPath(name, args); return; }
    if (COMMANDS.includes(name)) { command(name, args, piped); return; }
    // On the PATH (/bin is all builtins): /opt/radar.
    const onPath = fs.children.opt.children.radar.children[name];
    if (onPath) { runNode(onPath, name, args); return; }
    // Lenient: a program in the current directory runs without its ./ (and rocks.exe without its .exe).
    const here = lookup('.').node;
    const local = here.children[name] ?? (name === 'rocks' ? here.children['rocks.exe'] : null);
    if (local?.exec) { runNode(local, name, args); return; }
    out(`bash: ${name}: command not found`);
  }

  // A whole line: ; and && separate commands, | pipes into head / tail / less (others ignore it), > is refused.
  function runLine(line) {
    const env = { HOME, USER: 'operator', LOGNAME: 'operator', PWD: validCwd(), PATH: '/bin:/opt/radar', SHELL: '/bin/sh',
      HOSTNAME: 'bunker7', TERM: 'vt100', PS1: '\\u@\\h:\\w\\$ ' };
    const toks = tokenize(line, env);
    // Split into ; / && groups.
    const groups = [[]];
    for (const t of toks) {
      if (t.op === ';' || t.op === '&&' || t.op === '||') groups.push([]);
      else groups[groups.length - 1].push(t);
    }
    for (const g of groups) {
      if (run || pic) break;   // a program (or the picture) took over: the rest of the line is dropped
      if (!g.length) continue;
      const redir = g.findIndex((t) => t.op === '>' || t.op === '>>');
      if (redir >= 0) {
        const target = typeof g[redir + 1] === 'string' ? g[redir + 1] : null;
        out(target ? `bash: ${target}: Read-only file system` : "bash: syntax error near unexpected token `newline'");
        continue;
      }
      const stages = [[]];
      for (const t of g) { if (t.op === '|') stages.push([]); else if (typeof t === 'string') stages[stages.length - 1].push(t); }
      if (stages.some((s) => !s.length)) { out("bash: syntax error near unexpected token `|'"); continue; }
      if (stages.length === 1) { simple(stages[0]); continue; }
      let piped = null;
      for (let i = 0; i < stages.length; i++) {
        if (i < stages.length - 1) { sink = []; simple(stages[i], piped); piped = sink; sink = null; } else simple(stages[i], piped);
        if (run || pic) break;   // a program took over: the rest of the pipe is dropped too
      }
    }
  }

  // ---- the line editor ----
  function submit() {
    const line = buf;
    outSegs([...promptSegs(), [line, NORM]], true);
    buf = ''; cur = 0; lastTab = null;
    const trimmed = line.trim();
    if (trimmed) {
      if (history[history.length - 1] !== trimmed) history.push(trimmed);
      runLine(trimmed);
    }
    histIdx = history.length; draft = '';
    touch();
  }

  // Tab completion of the word before the cursor: commands in the first word, paths elsewhere (directories only for
  // cd). One match completes it (a / after a directory, a space after anything else); several complete their common
  // part, and when that adds nothing they are listed.
  function complete() {
    const before = buf.slice(0, cur);
    const start = before.search(/\S*$/);
    const word = before.slice(start);
    const seg = before.slice(0, start).split(/;|\||&&/).pop();   // this command's words so far
    const first = !seg.trim();
    const cmd = words(seg)[0];
    let cands = [];   // { name, dir }
    let base = word, prefix = '';
    if (first && !word.includes('/')) {
      const here = lookup('.').node;
      const local = here && !here.denied ? Object.entries(here.children).filter(([, n]) => n.exec).map(([k]) => k) : [];
      cands = [...new Set([...COMMANDS, ...local])].filter((c) => c.startsWith(word)).map((name) => ({ name, dir: false }));
    } else {
      const slash = word.lastIndexOf('/');
      prefix = slash >= 0 ? word.slice(0, slash + 1) : '';
      base = word.slice(slash + 1);
      const r = prefix ? lookup(prefix) : { node: lookup('.').node };
      if (prefix === '' && word === '~') { prefix = ''; base = '~'; cands = [{ name: '~', dir: true }]; }
      else if (r.node && isDir(r.node) && !r.node.denied) {
        cands = Object.entries(r.node.children)
          .filter(([k]) => k.startsWith(base) && (!hidden(k) || base.startsWith('.')))
          .map(([k, n]) => ({ name: k, dir: isDir(n) }));
        if (base === '..' || base === '.') cands.push({ name: '..', dir: true });
        if (cmd === 'cd' || cmd === 'tree') cands = cands.filter((c) => c.dir);
        if (first) cands = cands.filter((c) => c.dir || r.node.children[c.name]?.exec);
      }
    }
    cands.sort((a, b) => a.name.localeCompare(b.name));
    if (!cands.length) { lastTab = null; return false; }
    const insert = (s) => { buf = buf.slice(0, start) + s + buf.slice(cur); cur = start + s.length; touch(); };
    if (cands.length === 1) {
      const c = cands[0];
      insert(prefix + c.name + (c.dir ? '/' : ' '));
      lastTab = null;
      return true;
    }
    const common = lcp(cands.map((c) => c.name));
    if (common.length > base.length) { insert(prefix + common); lastTab = null; return true; }
    const key_ = buf + '|' + cur;
    if (lastTab === key_) return false;
    lastTab = key_;
    outSegs([...promptSegs(), [buf, NORM]], true);
    columns(cands.map((c) => ({ s: c.name + (c.dir ? '/' : ''), a: c.dir ? BRIGHT | BOLD : NORM })));
    return true;
  }

  // A key (a KeyboardEvent-like { key, code, ctrlKey, metaKey, altKey, shiftKey }). Returns the sound to play:
  // 'key', 'keyEnter' or null. While a program runs, or a picture has the tube, every key is ignored (but still clicks).
  function key(e) {
    const k = e.key;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    const sound = k === 'Enter' ? 'keyEnter' : /^(Shift|Control|Alt|Meta|CapsLock)$/.test(k) ? null : 'key';
    if (run || pic) return sound;
    if (k !== 'PageUp' && k !== 'PageDown' && sound && scroll) { scroll = 0; touch(); }
    if (k !== 'Tab') lastTab = null;
    if (ctrl) {
      const c = ctrlLetter(e);
      if (c === 'c') { outSegs([...promptSegs(), [buf + '^C', NORM]], true); buf = ''; cur = 0; histIdx = history.length; touch(); }
      else if (c === 'l') { lines.length = 0; scroll = 0; touch(); }
      else if (c === 'u') { buf = buf.slice(cur); cur = 0; touch(); }
      else if (c === 'a') { cur = 0; touch(); }
      else if (c === 'e') { cur = buf.length; touch(); }
      return sound;
    }
    switch (k) {
      case 'Enter': submit(); return sound;
      case 'Backspace': if (cur > 0) { buf = buf.slice(0, cur - 1) + buf.slice(cur); cur--; touch(); } return sound;
      case 'Delete': if (cur < buf.length) { buf = buf.slice(0, cur) + buf.slice(cur + 1); touch(); } return sound;
      case 'ArrowLeft': if (cur > 0) { cur--; touch(); } return sound;
      case 'ArrowRight': if (cur < buf.length) { cur++; touch(); } return sound;
      case 'Home': cur = 0; touch(); return sound;
      case 'End': cur = buf.length; touch(); return sound;
      case 'ArrowUp':
        if (histIdx > 0) { if (histIdx === history.length) draft = buf; histIdx--; buf = history[histIdx]; cur = buf.length; touch(); }
        return sound;
      case 'ArrowDown':
        if (histIdx < history.length) { histIdx++; buf = histIdx === history.length ? draft : history[histIdx]; cur = buf.length; touch(); }
        return sound;
      case 'Tab': complete(); return sound;
      case 'PageUp': case 'PageDown': {
        const total = visualRows().length;
        const max = Math.max(0, total - rows);
        const s = Math.max(0, Math.min(max, scroll + (k === 'PageUp' ? 1 : -1) * (rows >> 1)));
        if (s !== scroll) { scroll = s; touch(); }
        return sound;
      }
      default: break;
    }
    if (k.length === 1 && k >= ' ' && k <= '~' && buf.length < MAX_INPUT) {
      buf = buf.slice(0, cur) + k + buf.slice(cur); cur++; touch();
    }
    return sound;
  }

  // Runs a line as if typed and Enter pressed (console / tests). Returns the output lines' text.
  function exec(line) {
    if (run || pic) return [];
    buf = String(line); cur = buf.length;
    const n0 = shell.pushed;
    submit();
    // (the first line pushed is the echoed prompt line; a clear may have emptied the rest)
    const n = Math.min(lines.length, shell.pushed - n0 - 1);
    return n > 0 ? lines.slice(-n).map((l) => l.t) : [];
  }

  // The dots, then onRun, then waiting for the feed to come back, then (if it fired) the verdict.
  function update(dt) {
    if (!run) return;
    run.t += dt;
    if (run.phase === 'dots') {
      const dots = Math.min(DOTS, Math.floor(run.t / DOT_TIME + 1e-6));
      const t = 'executing rocks' + '.'.repeat(dots);
      if (run.line.t !== t) { run.line.t = t; touch(); }
      if (run.t >= DOTS * DOT_TIME + HOLD) {
        run.phase = 'feed'; run.wait = 0;
        const taken = shell.onRun ? shell.onRun() !== false : false;
        if (run) { run.taken = taken; run.timeout = taken ? FEED_TIMEOUT : NO_RUN_RETURN; }   // (onRun may already have brought it back)
      }
    } else if (run.phase === 'feed') {
      run.wait += dt;
      if (run.wait >= run.timeout) returnFromFeed();
    } else if (run.phase === 'tail') {
      run.wait += dt;
      while (run && run.said < VERDICT.length && run.wait >= TAIL[run.said]) {
        run.wait -= TAIL[run.said];
        const [t, a] = VERDICT[run.said++];
        out(t, a);
        if (run.said === VERDICT.length) done();
      }
    }
  }

  // Back from the camera: the last of the link, garbled; then, if the blast really went off (the cutscene took the
  // run and kept it: main.js clears state.ran when it couldn't start), the verdict, a line at a time (update); then a
  // prompt.
  function returnFromFeed() {
    if (!run || run.phase === 'tail') return;   // (once per run)
    const blocks = '░▒▓░▒▓█ ';
    const garble = (n) => {
      let s = '';
      for (let i = 0; i < n; i++) s += random() < 0.72 ? blocks[Math.floor(random() * blocks.length)] : MOJI[Math.floor(random() * MOJI.length)];
      return s;
    };
    out(garble(38 + Math.floor(random() * 22)), HOT);
    out(garble(14 + Math.floor(random() * 30)), BRIGHT);
    out('[cam07] link lost', BRIGHT | BOLD);
    if (run.taken && st().ran) { run.phase = 'tail'; run.wait = 0; run.said = 0; touch(); return; }
    done();
  }
  // The program's over: the prompt's back.
  function done() {
    run = null;
    histIdx = history.length;
    touch();
  }

  // Wraps the scrollback (and the line being edited) into screen rows: [{ t, a: number[] }]. Output wraps at a space
  // where it can, and a two-column line (help's) carries on under its second column; the line being edited wraps hard
  // (so the cursor's cell is simple arithmetic).
  function wrapLine(l, outRows, words_ = false) {
    const t = l.t;
    const at = (i) => (typeof l.a === 'number' ? l.a : l.a[i] ?? NORM);
    const row = (from, to, indent = 0) => {
      const a = new Array(indent).fill(NORM);
      for (let j = from; j < to; j++) a.push(at(j));
      outRows.push({ t: ' '.repeat(indent) + t.slice(from, to), a });
    };
    if (!t.length) { outRows.push({ t: '', a: [] }); return; }
    if (!words_ || t.length <= cols) { for (let i = 0; i < t.length; i += cols) row(i, Math.min(t.length, i + cols)); return; }
    const m = /^\s*\S+(?: \S+)* {2,}(?=\S)/.exec(t);
    const hang = m && m[0].length < cols / 2 ? m[0].length : 0;
    let pos = 0, indent = 0;
    while (pos < t.length) {
      const room = cols - indent;
      let end = Math.min(t.length, pos + room);
      if (end < t.length) {
        const sp = t.lastIndexOf(' ', end);
        if (sp > pos + room / 3) end = sp;
      }
      row(pos, end, indent);
      pos = t[end] === ' ' ? end + 1 : end;   // the space it broke at goes
      indent = hang;
    }
  }
  let inputRow0 = 0;
  function visualRows() {
    const vr = [];
    for (const l of lines) wrapLine(l, vr, !l.hard);
    inputRow0 = vr.length;
    if (!run && !pic) {
      const segs = promptSegs();
      let t = '', a = [];
      for (const [s, at] of segs) { t += s; for (let i = 0; i < s.length; i++) a.push(at); }
      t += buf; for (let i = 0; i < buf.length; i++) a.push(NORM);
      wrapLine({ t, a }, vr);
      const pos = promptLen() + cur;
      if (pos > 0 && pos % cols === 0 && pos >= t.length) vr.push({ t: '', a: [] });
    }
    return vr;
  }

  // What's on screen: rows (exactly `rows` of them, top to bottom) and the cursor { col, row, show }.
  function screen() {
    const vr = visualRows();
    let curRow, curCol;
    if (run || pic) {
      const last = vr[vr.length - 1];
      curRow = vr.length - 1; curCol = last ? last.t.length : 0;
      if (curCol >= cols) { vr.push({ t: '', a: [] }); curRow++; curCol = 0; }
    } else {
      const pos = promptLen() + cur;
      curRow = inputRow0 + Math.floor(pos / cols); curCol = pos % cols;
    }
    const maxScroll = Math.max(0, vr.length - rows);
    if (scroll > maxScroll) scroll = maxScroll;
    const top = Math.max(0, vr.length - rows - scroll);
    const view = vr.slice(top, top + rows);
    while (view.length < rows) view.push({ t: '', a: [] });
    const row = curRow - top;
    return { rows: view, cursor: { col: curCol, row, show: row >= 0 && row < rows && scroll === 0 }, scroll };
  }

  // The login screen: the motd, a blank line, the prompt.
  function reset() {
    lines.length = 0;
    outText(textOf(lookup('/etc/motd', '/').node));
    lines[0].a = BRIGHT | BOLD;
    out('');
    buf = ''; cur = 0; run = null; pic = null; scroll = 0; histIdx = history.length;
    touch();
  }
  reset();
  return shell;
}
