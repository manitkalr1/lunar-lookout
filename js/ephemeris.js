// Sun and Earth positions in the Moon's body-fixed frame, then converted to
// azimuth / elevation for an observer standing on the surface.
//
// Positions come from astronomy-engine (VSOP87 + ELP-based, ~1 arcminute).
// The Moon's orientation uses the IAU/WGCCRE rotation model, which agrees with
// LOLA's Mean-Earth frame to well under 0.1 degrees.
import { D2R, R2D, RM, AU } from './state.js';

const A = globalThis.Astronomy;
const cache = new Map();

function rz(t, v) { const c = Math.cos(t), s = Math.sin(t); return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]]; }
function rx(t, v) { const c = Math.cos(t), s = Math.sin(t); return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]]; }

/** Moon-centred, Moon-fixed vectors (km) to the Sun and Earth at time ms (UTC). */
export function eph(ms) {
  let e = cache.get(ms);
  if (e) return e;
  const t = A.MakeTime(new Date(ms));
  const m = A.GeoMoon(t);                          // Earth -> Moon, AU, J2000 equatorial
  const s = A.GeoVector(A.Body.Sun, t, true);      // Earth -> Sun
  const ax = A.RotationAxis(A.Body.Moon, t);       // IAU pole (ra, dec) and prime meridian angle (spin)
  const fix = v => rz(ax.spin * D2R, rx((90 - ax.dec) * D2R, rz((90 + ax.ra * 15) * D2R, v)));
  e = {
    sun: fix([(s.x - m.x) * AU, (s.y - m.y) * AU, (s.z - m.z) * AU]),
    earth: fix([-m.x * AU, -m.y * AU, -m.z * AU]),
  };
  if (cache.size > 60000) cache.clear();
  cache.set(ms, e);
  return e;
}

/** Local east/north/up frame at a surface point. hKm is height above the 1737.4 km sphere. */
export function frame(lat, lon, hKm) {
  const la = lat * D2R, lo = lon * D2R, r = RM + (hKm || 0);
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  return {
    pos: up.map(x => x * r),
    up,
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
  };
}

/** Azimuth (deg, from north through east) and elevation (deg) of target v seen from frame f. */
export function topo(f, v) {
  const d = [v[0] - f.pos[0], v[1] - f.pos[1], v[2] - f.pos[2]];
  const n = Math.hypot(d[0], d[1], d[2]);
  const u = (d[0] * f.up[0] + d[1] * f.up[1] + d[2] * f.up[2]) / n;
  const e = d[0] * f.east[0] + d[1] * f.east[1];
  const no = d[0] * f.north[0] + d[1] * f.north[1] + d[2] * f.north[2];
  let az = Math.atan2(e, no) * R2D;
  if (az < 0) az += 360;
  return { az, el: Math.asin(u) * R2D };
}
