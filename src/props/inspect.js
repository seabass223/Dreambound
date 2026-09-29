import * as THREE from 'three';

// Something small you pick up to look at closely (the observatory's print, the deck's postcard). Press it and it comes
// up in front of your eyes, square to the view; press again (anywhere: it takes every press while it's up) and it goes
// back where it lay. While it's up you stand still and the view holds; with `turn`, moving the mouse across turns it
// over in your hands, so you can read its back.
//
// object: the thing (its local +z is its face, +y the top of its picture), a child of `parent`.
// rest(outP, outQ): where it lies, in `parent`'s frame, asked every frame (so it can ride in a drawer).
// meshes: what you aim at to pick it up. hold: m in front of the eye. glow: { material, amount }: its emissive
// intensity while held (a print held up to the light); amount may be a function, asked every frame. canLift(): whether it can be picked up now. sound: played
// (at where it lies) as it's lifted and put down.
// Returns { update(dt), mode(), lift(), putDown() }; the caller runs update(dt) every frame.
export function makeInspectable(ctx, { object, parent, rest, meshes, name, range = 2.2, hold = 0.26, drop = 0.01, time = 0.5, glow = null, turn = false, canLift = () => true, sound = 'page' }) {
  let mode = 'rest', t = 0, yaw = 0;
  const fromP = new THREE.Vector3(), fromQ = new THREE.Quaternion();
  const restP = new THREE.Vector3(), restQ = new THREE.Quaternion();
  const handP = new THREE.Vector3(), handQ = new THREE.Quaternion();
  const _p = new THREE.Vector3(), _o = new THREE.Vector3(), _q = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _t = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0), OFF = new THREE.Vector3(0, -drop, -hold);
  // In the hand: `hold` in front of the eye and a little low, square to the view, turned `yaw` about its own up.
  const handPose = (outP, outQ) => {
    ctx.camera.getWorldPosition(_p);
    ctx.camera.getWorldQuaternion(_q);
    _p.add(_o.copy(OFF).applyQuaternion(_q));
    outP.copy(parent.worldToLocal(_p));
    outQ.copy(parent.getWorldQuaternion(_rq).invert().multiply(_q)).multiply(_t.setFromAxisAngle(UP, yaw));
  };
  const play = () => { rest(restP, restQ); ctx.audio?.play(sound, { pos: parent.localToWorld(restP.clone()) }); };
  const item = { name, meshes, range, exact: true };
  const glowAmount = () => (typeof glow.amount === 'function' ? glow.amount() : glow.amount);
  const lift = () => {
    if (!(mode === 'rest' || mode === 'down') || !canLift()) return;
    mode = 'up'; t = 0; yaw = 0;
    fromP.copy(object.position); fromQ.copy(object.quaternion);
    const p = ctx.player;
    p.canMove = false;
    p.lookHandler = turn ? (mx) => { yaw += mx * 0.006; } : () => {};   // the view holds; the mouse turns it over
    ctx.interact.focus = item;
    play();
  };
  const putDown = () => {
    if (!(mode === 'up' || mode === 'held')) return;
    mode = 'down'; t = 0;
    fromP.copy(object.position); fromQ.copy(object.quaternion);
    ctx.player.lookHandler = null;
    if (ctx.interact.focus === item) ctx.interact.focus = null;
    play();
  };
  item.onPress = () => (mode === 'rest' || mode === 'down' ? lift() : putDown());
  ctx.interact.add(item);

  const update = (dt) => {
    rest(restP, restQ);
    if (mode === 'rest') { object.position.copy(restP); object.quaternion.copy(restQ); return; }
    t = Math.min(1, t + dt / time);
    const k = t * t * (3 - 2 * t);
    if (mode === 'up' || mode === 'held') {
      handPose(handP, handQ);
      object.position.lerpVectors(fromP, handP, k);
      object.quaternion.slerpQuaternions(fromQ, handQ, k);
      if (glow) glow.material.emissiveIntensity = glowAmount() * k;
      if (t >= 1) mode = 'held';
    } else {
      object.position.lerpVectors(fromP, restP, k);
      object.quaternion.slerpQuaternions(fromQ, restQ, k);
      if (glow) glow.material.emissiveIntensity = glowAmount() * (1 - k);
      if (t >= 1) {
        mode = 'rest';
        ctx.player.canMove = true;
      }
    }
  };
  return { update, mode: () => mode, lift, putDown, item };
}
