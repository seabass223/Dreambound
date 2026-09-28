// A direction high in the sky for the Mountain observatory's telescope (where a constellation shows at dusk and at
// night). The roof station's scales point it out (src/props/observatoryStation.js); the eyepiece's azimuth ring and
// altitude scale should mark it with the same mappings.
//
// yaw, pitch: telescope values as ctx.state.observatory holds them (like the rear hatch's target): yaw is the world
// heading of the slit and tube, direction (cos yaw, 0, sin yaw), not wrapped; pitch is the tube's elevation, which the
// gears clamp to 0.04..1.15. The eyepiece looks VIEW_DROP below the tube axis, so with the telescope on target the
// star under the crosshair is at altitude pitch - 0.32 (about 39 deg here). North-north-east (heading 30), away from
// the sun's path (it crosses the -Z sky) and the moon's. The Rocks constellation (render/constellation.js) is centred
// there.
export const SKY_TARGET = { yaw: 2.1, pitch: 1.0 };
// How far (rad) the eyepiece looks below the tube axis (props/observatory.js scopeView), so distant cliffs can be reached.
export const VIEW_DROP = 0.32;

const DEG = 180 / Math.PI;

// X: the heading on a compass card, in degrees. 0 is north (+Z, opposite the noon sun), and it grows clockwise seen
// from above, as the dome turns to the right (st.yaw grows). Ticks as on the eyepiece's ring: every 5 deg, heavy and
// numbered every 30.
export const AZ_SCALE = { min: 0, max: 360, minor: 5, major: 30 };
export const yawToAz = (yaw) => (((yaw * DEG - 90) % 360) + 360) % 360;
export const azToYaw = (az) => (az + 90) / DEG;

// Y: the tube's elevation (st.pitch) in degrees, over the gears' whole range; ticks every 2, numbered every 10.
export const ALT_SCALE = { min: 0, max: 70, minor: 2, major: 10 };
export const pitchToAlt = (pitch) => pitch * DEG;
export const altToPitch = (alt) => alt / DEG;
