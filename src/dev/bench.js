// Dev-only performance sweep (?dev): stands in every area of the world, turns through `dirs` headings and reports
// the frame time, draw calls and triangles for each, worst heading first. Run `await bench()` in the console.
// It takes over the frame loop like the capture tool; reload the page afterwards.
//
// avg: frames rendered back to back, one GPU sync at the end (throughput). max: the slowest single frame, each
// synced on its own (includes the occasional reflection-probe or LOD rebuild frame).
export function installBench({ THREE, ctx, player, camera, renderer, clock, capture, hitch }) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const ground = (st, x, z) => V(x, (st.heightAt(x, z) ?? st.top) + 0.05, z);
  const elevatorEnd = (id, key, out = 3) => {
    const el = ctx.elevators.find((e) => e.id === id);
    return el.ends[key].root.localToWorld(V(0.3, 0.05, out));
  };

  function areas() {
    const S = ctx.stacks, h = ctx.house, obs = ctx.observatory.root.position;
    const d = S.dome, r = S.rocks, m = S.mountain, t = S.tower, e = S.end;
    const hub = ctx.tunnels.center.clone(), cave = ctx.tunnels.cave;
    const list = [
      ['cabin: great room', h.wake.stand.clone()],
      ['cabin: garden', ground(d, d.cx + 11, d.cz + 2)],
      ['dome: stack edge', ground(d, d.cx + 46, d.cz + 12)],
      ['dome: ledge cave', elevatorEnd('dome', 'top')],
      ['rocks: meadow', ground(r, r.cx + 8, r.cz + 6)],
      ['rocks: stream', ground(r, r.cx - 12, r.cz - 8)],
      ['rocks: splash pool', ground(r, r.cx - 19.2, r.cz + 4.3)],
      ['rocks: sequoia door', elevatorEnd('rocks', 'top')],
      ['rocks: waterfall lip', ground(r, r.cx + 38, r.cz - 13)],
      ['end: aperture', ground(e, e.cx + 5, e.cz + 3)],
      ['tower: summit', ground(t, t.cx + 8, t.cz + 8)],
      ['mountain: shed', elevatorEnd('mountain', 'top')],
      ['mountain: trail', (() => { const tr = m.trail; const p = tr.pointAt(tr.total * 0.55); return ground(m, p.x, p.z); })()],
      ['observatory: summit', V(obs.x + 7.5, obs.y + 0.05, obs.z)],
      ['observatory: inside', V(obs.x + 2.2, obs.y + 0.33, obs.z + 1.2)],
      ['cave: hub', hub.clone().setY(hub.y - 2.95)],
      ['cave: generator', cave.center.clone().setY(hub.y - 2.95)],
      ['cave: station', (() => { const p = elevatorEnd('mountain', 'bottom', 6); return p; })()],
    ];
    if (ctx.tunnels.lounge) list.push(['lounge: desk', elevatorEnd('tower', 'lounge', 2.2)]);
    // The Tower's bunker room (props/bunkerRoom.js): beside the terminal's chair, and in front of the lift's doors.
    if (ctx.bunker?.spawn) {
      list.push(['tower: bunker room', ctx.bunker.spawn.pos.clone().setY(ctx.bunker.spawn.pos.y + 0.05)]);
      const room = ctx.bunker.room?.group;
      if (room) { room.updateWorldMatrix(true, false); list.push(['tower: bunker lift', room.localToWorld(V(0, 0.05, 2.9))]); }
    }
    if (ctx.bridgeSpan) {
      const b = ctx.bridgeSpan;
      list.push(['bridge: middle', V(b.a.x + b.flat.x * b.L * 0.5, 0, b.a.z + b.flat.z * b.L * 0.5)]);
      // The bridge descends: find its deck height from the collider below the midpoint.
      const p = list[list.length - 1][1];
      p.y = (b.a.y + (b.b?.y ?? b.a.y)) / 2 + 0.1;
    }
    return list;
  }

  async function measure(frames) {
    const dt = 1 / 60;
    for (let i = 0; i < 4; i++) capture.step(dt);
    sync();
    renderer.info.autoReset = false;
    renderer.info.reset();
    capture.step(dt);
    const calls = renderer.info.render.calls, tris = renderer.info.render.triangles;
    renderer.info.autoReset = true;
    let max = 0;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) capture.step(dt);
    sync();
    const avg = (performance.now() - t0) / frames;
    for (let i = 0; i < frames; i++) {
      const t1 = performance.now();
      capture.step(dt);
      sync();
      max = Math.max(max, performance.now() - t1);
    }
    return { avg, max, calls, tris };
  }

  window.bench = async ({ width = 1920, height = 1080, dirs = 8, frames = 12, only = null } = {}) => {
    capture.begin({ width, height });
    // The first few frames after loading are slow wherever you stand (the GPU and driver warming up; in the game
    // they fall inside the wake-up fade from black), so spin those off first.
    for (let i = 0; i < 40; i++) { capture.step(1 / 60); sync(); }
    const rows = [];
    for (const [name, p] of areas()) {
      if (only && !name.includes(only)) continue;
      const zone = p.y < -1500 ? 'tunnel' : 'surface';
      let worst = null;
      for (let k = 0; k < dirs; k++) {
        const yaw = (k / dirs) * Math.PI * 2;
        player.zone = zone;
        player.place(p.x, p.y, p.z, yaw);
        player.pitch = 0;
        const m = await measure(frames);
        if (!worst || m.max > worst.max) worst = { ...m, yaw };
      }
      rows.push({
        area: name, avgMs: +worst.avg.toFixed(2), maxMs: +worst.max.toFixed(2), calls: worst.calls,
        ktris: Math.round(worst.tris / 1000), heading: Math.round((worst.yaw * 180) / Math.PI),
      });
      await new Promise((r) => setTimeout(r, 0));
    }
    // Through the telescope, turning the dome all the way round.
    if (!only || 'telescope'.includes(only)) {
      const o = ctx.observatory, st = o.st;
      const obs = o.root.position;
      player.zone = 'surface';
      player.place(obs.x + 2.5, obs.y + 0.33, obs.z - 2.5, 0);
      capture.step(1 / 60);
      o.controls.viewer.onPress();
      let worst = null;
      for (let k = 0; k < dirs; k++) {
        st.yaw = (k / dirs) * Math.PI * 2;
        st.pitch = 0.12;
        const m = await measure(frames);
        if (!worst || m.max > worst.max) worst = { ...m, yaw: st.yaw };
      }
      rows.push({ area: 'telescope view', avgMs: +worst.avg.toFixed(2), maxMs: +worst.max.toFixed(2), calls: worst.calls, ktris: Math.round(worst.tris / 1000), heading: Math.round((worst.yaw * 180) / Math.PI) });
      // The scope aimed at each stack's wall just below the rim: the wall fills the whole view.
      for (const name of ['dome', 'rocks', 'tower']) {
        const s = ctx.stacks[name], cp = camera.position;
        const tgt = s.cliffPoint(Math.atan2(obs.z - s.cz, obs.x - s.cx), 6);
        st.yaw = Math.atan2(tgt.z - cp.z, tgt.x - cp.x);
        st.pitch = Math.atan2(tgt.y - cp.y, Math.hypot(tgt.x - cp.x, tgt.z - cp.z)) + 0.32;
        const m = await measure(frames);
        rows.push({ area: 'telescope: ' + name + ' wall', avgMs: +m.avg.toFixed(2), maxMs: +m.max.toFixed(2), calls: m.calls, ktris: Math.round(m.tris / 1000), heading: 0 });
      }
      o.controls.viewer.onPress();
    }
    rows.sort((a, b) => b.maxMs - a.maxMs);
    console.table(rows);
    return rows;
  };
  // Hitch tour (with the hitch monitor, dev/hitch.js): `await hitchTour()` visits every area of the game at the window's
  // size, turning through `dirs` headings at each, with the monitor labelling everything by area, and returns
  // hitchReport(). Covers day and night, the eyepiece (and the constellation), the roof station with its iris open,
  // the tower catwalk, every elevator ride (incl. the lounge stop) and, with ending: true, the ending itself.
  window.hitchTour = async ({ dirs = 4, frames = 3, ending = false, rocksExe = true, log = true } = {}) => {
    const dt = 1 / 60;
    capture.begin({ width: 0 });
    const S = ctx.stacks, obs = ctx.observatory;
    // setTimeout, not requestAnimationFrame: the tour must also run in a hidden tab.
    const frame = async () => { capture.step(dt); sync(); await new Promise((r) => setTimeout(r, 0)); };
    const run = async (secs, step = 1 / 30) => { for (let t = 0; t < secs; t += step) { capture.step(step); if ((t / step) % 8 < 1) await new Promise((r) => setTimeout(r, 0)); } };
    const visit = async (label, p, { zone = p.y < -1500 ? 'tunnel' : 'surface', look = null, n = dirs } = {}) => {
      window.hitchLabel = label;
      for (let k = 0; k < n; k++) {
        player.zone = zone;
        player.place(p.x, p.y, p.z, (k / n) * Math.PI * 2);
        player.pitch = 0;
        if (look) window.lookAtPt(look.x, look.y, look.z);
        for (let i = 0; i < frames; i++) await frame();
      }
    };
    const setTime = (phase) => { clock.phase = phase; clock.update(0); };
    const day = clock.phase;

    // Every area of bench(), at the starting time and at night.
    for (const [phase, tag] of [[day, ''], [0.8, ' (night)']]) {
      setTime(phase);
      for (const [name, p] of areas()) await visit(name + tag, p);
    }
    setTime(day);
    // Rim views: from each stack's rim, looking at every other stack.
    for (const [a, sa] of Object.entries(S)) {
      for (const [b, sb] of Object.entries(S)) {
        if (a === b) continue;
        const th = Math.atan2(sb.cz - sa.cz, sb.cx - sa.cx);
        const x = sa.cx + Math.cos(th) * (sa.r - 5), z = sa.cz + Math.sin(th) * (sa.r - 5);
        await visit(`rim: ${a} -> ${b}`, ground(sa, x, z), { look: V(sb.cx, sb.top, sb.cz), n: 1 });
      }
    }
    // The observatory: the eyepiece by day and night, all round, and on the constellation.
    if (obs) {
      const st = obs.st, o = obs.root.position;
      for (const [phase, tag] of [[0.25, 'day'], [0.8, 'night']]) {
        setTime(phase);
        window.hitchLabel = 'eyepiece ' + tag;
        player.zone = 'surface';
        player.place(o.x + 2.5, o.y + 0.33, o.z - 2.5, 0);
        await frame();
        obs.controls.viewer.onPress();
        for (let k = 0; k < 8; k++) {
          st.yaw = (k / 8) * Math.PI * 2;
          for (const pitch of [0.05, 0.5]) { st.pitch = pitch; for (let i = 0; i < frames; i++) await frame(); }
        }
        // The constellation, where the roof station's scales point.
        const { SKY_TARGET } = await import('../world/skyTarget.js');
        window.hitchLabel = 'constellation ' + tag;
        st.yaw = SKY_TARGET.yaw; st.pitch = SKY_TARGET.pitch;
        for (let i = 0; i < frames * 4; i++) await frame();
        obs.controls.viewer.onPress();
        await frame();
      }
      setTime(day);
      // The roof station: ladders aligned, iris opened, standing on its deck.
      if (obs.ladder && obs.station) {
        window.hitchLabel = 'roof station';
        obs.ladder.align();
        await frame();
        obs.station.open();
        await run(4);
        const d = obs.station.deck(0, 0.6);
        await visit('roof station (iris open)', d.setY(d.y + 0.05), { look: obs.station.iris() });
      }
    }
    // The tower catwalk, in front of the switch boxes.
    if (ctx.towerSwitches) {
      for (let b = 0; b < 3; b++) {
        const g = ctx.towerSwitches.gripAt(b, 1);
        const t = S.tower;
        const out = V(g.x - t.cx, 0, g.z - t.cz).normalize();
        await visit('tower catwalk', V(g.x + out.x * 0.1, g.y - 1.2, g.z + out.z * 0.1), { look: g, n: 1 });
        await run(0.5);
      }
    }
    // Every elevator ride, all the way down (via the lounge on the Tower's) and back up, riding in the car.
    ctx.state.switches?.fill(true);
    if (ctx.power) for (const k of Object.keys(ctx.power)) ctx.power[k] = true;
    const { ELEVATOR_DIMS: { CAR } } = await import('../props/elevator.js');
    for (const el of ctx.elevators || []) {
      const stops = ['top', 'bottom', 'lounge'].filter((k) => el.ends[k]);
      const inCar = (key) => el.ends[key].root.localToWorld(V(0, 0.05, (CAR.z0 + CAR.z1) / 2));
      const ride = async (from, to) => {
        window.hitchLabel = `elevator ${el.id}: ${from} -> ${to}`;
        while (el.busy) await run(0.5);
        if (el.at !== from) { el.call(from); while (el.busy || el.at !== from) await run(0.5); }
        await run(2);
        const p = inCar(from);
        player.zone = el.ends[from].def.zone;
        player.place(p.x, p.y, p.z, el.ends[from].root.rotation.y);
        await frame();
        el.press(from, stops.indexOf(to) < stops.indexOf(from) ? 'top' : 'bottom');
        while (el.busy) { await run(0.25); await frame(); }
        await run(2);
        for (let i = 0; i < frames; i++) await frame();
      };
      for (let i = 0; i + 1 < stops.length; i++) await ride(stops[i], stops[i + 1]);
      for (let i = stops.length - 1; i > 0; i--) await ride(stops[i], stops[i - 1]);
    }
    // A fall off the Dome stack's rim (the dream respawn sequence), watched to the end.
    {
      const d = S.dome, th = 0.7;
      const edge = ground(d, d.cx + Math.cos(th) * (d.r - 3), d.cz + Math.sin(th) * (d.r - 3));
      await visit('fall', edge, { n: 1 });
      window.hitchLabel = 'fall';
      player.place(d.cx + Math.cos(th) * (d.r + 6), edge.y, d.cz + Math.sin(th) * (d.r + 6), player.yaw);
      for (let t = 0; t < 12; t += 1 / 30) { capture.step(1 / 30); if (Math.round(t * 30) % 4 === 0) await frame(); }
    }
    // The bunker's terminal and rocks.exe (sequences/rocksExe.js): seated, typing, the cut to CAM 07, the blast, the
    // boulders' flights and landings, the cut back; then the Rocks afterwards. (Once a game: it changes the world.)
    const term = ctx.bunker?.terminal;
    if (rocksExe && term && !term.state.ran) {
      const s = ctx.bunker.seat, sp = ctx.bunker.spawn;
      await visit('bunker terminal', sp.pos.clone().setY(sp.pos.y + 0.05), { look: s.eye, n: 1 });
      window.hitchLabel = 'bunker terminal';
      term.enter();
      await run(1.2);
      for (const line of ['ls', 'cat notes.txt', 'cd /opt/survey/bin']) { term.exec(line); await frame(); }
      term.exec('./rocks.exe');
      window.hitchLabel = 'rocks.exe';
      for (let t = 0; t < 12 && (t < 3 || ctx.inSequence?.()); t += 1 / 30) { capture.step(1 / 30); if (Math.round(t * 30) % 3 === 0) await frame(); }
      term.leave();
      await run(1.2);
      const r = S.rocks, tor = ctx.torBlast?.center;
      if (tor) await visit('rocks: after the blast', ground(r, tor.x + 14, tor.z + 12), { look: tor, n: 2 });
    }
    if (ending && ctx.aperture) {
      const a = ctx.aperture.center;
      await visit('ending', V(a.x + 2.2, a.y + 0.05, a.z + 0.4), { look: a, n: 1 });
      capture.ending();
      window.hitchLabel = 'ending';
      for (let t = 0; t < 22; t += 1 / 30) { capture.step(1 / 30); if (Math.round(t * 30) % 4 === 0) await frame(); }
    }
    window.hitchLabel = null;
    capture.end();
    const r = hitch ? window.hitchReport() : null;
    if (log && r) console.log(JSON.stringify({ programs: r.programs, textures: r.textures, buffers: r.buffers, renderbuffers: r.renderbuffers, reuploads: r.reuploads }));
    return r;
  };
}
