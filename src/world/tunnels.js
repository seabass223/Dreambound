import * as THREE from 'three';
import { TUNNEL_ORIGIN } from '../config.js';
import { ColliderBuilder } from './builders.js';
import { placeCave } from '../props/cave.js';
import { placeLounge } from '../props/lounge.js';

const HUB_FLOOR = -3;

// Underground hub cavern + four winding spokes that end at elevator doors, with the generator that powers
// them (modeled in Blender, see props/cave.js).
export function buildTunnels(ctx) {
  const O = new THREE.Vector3(TUNNEL_ORIGIN.x, TUNNEL_ORIGIN.y, TUNNEL_ORIGIN.z);
  const group = new THREE.Group();
  group.name = 'tunnels';
  const collider = new ColliderBuilder('tunnels');
  const cave = placeCave(ctx, ctx.caveAsset, { origin: O.clone().setY(O.y + HUB_FLOOR), group, collider });

  const stations = {};
  for (const [name, st] of Object.entries(cave.stations)) {
    stations[name] = { pos: st.pos, rotY: st.rotY, zone: 'tunnel', parent: group, collider };
  }

  // The Tower elevator's secret stop: the cartographer's lounge, straight below its cave station (props/lounge.js).
  let lounge = null;
  if (ctx.loungeAsset && cave.stations.tower) {
    const lc = new ColliderBuilder('lounge');
    lounge = placeLounge(ctx, ctx.loungeAsset, { below: cave.stations.tower, group, collider: lc, hide: cave.root });
    stations.lounge = { pos: lounge.station.pos, rotY: lounge.station.rotY, callPos: lounge.station.callPos, zone: 'tunnel', parent: group, collider: lc };
  }

  // A light for any standard-material props in the hub (kept so the scene's light count never changes).
  const hubLight = new THREE.PointLight(0xffb070, 0, 30, 1.6);
  hubLight.position.copy(O).setY(O.y + HUB_FLOOR + 6);
  ctx.scene.add(hubLight);
  ctx.hubLight = hubLight;

  ctx.deferCollider(collider, 'tunnel');
  ctx.scene.add(group);
  group.visible = false;
  return { group, stations, center: O, cave, lounge };
}
