// LOLA polar stereographic DEM handling and terrain horizon ray-tracing.
//
// Files: LDEM_75S_240M.IMG, LDEM_85S_40M.IMG, etc. from the LOLA polar GDR archive.
// Format (from the matching .LBL): square grid of 16-bit signed little-endian
// integers, SCALING_FACTOR 0.5 (so height in metres = 0.5 × value) relative to
// the 1737.4 km reference sphere, centred on the south pole, 0° E pointing up.
import { D2R, R2D, RM, st } from './state.js';

const DN_TO_M = 0.5; // LOLA LDEM scaling factor
const hzCache = new Map();
export const clearHorizonCache = () => hzCache.clear();

/** Polar stereographic projection (south pole) used by the LOLA polar products. km. */
export function llToMap(lat, lon) {
  const rho = 2 * RM * Math.tan(Math.PI / 4 + lat * D2R / 2);
  return [rho * Math.sin(lon * D2R), rho * Math.cos(lon * D2R)];
}
export function mapToLL(X, Y) {
  const rho = Math.hypot(X, Y);
  const colat = 2 * Math.atan(rho / (2 * RM));
  return [-(90 - colat * R2D), Math.atan2(X, Y) * R2D];
}

/** Bilinear height in metres at map coords (km), NaN outside the grid. */
export function demH(X, Y) {
  const d = st.dem;
  const c = d.off + X * 1000 / d.scale, r = d.off - Y * 1000 / d.scale;
  if (c < 0 || r < 0 || c >= d.n - 1 || r >= d.n - 1) return NaN;
  const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * d.n + c0, a = d.data;
  return DN_TO_M * ((a[i] * (1 - fc) + a[i + 1] * fc) * (1 - fr) + (a[i + d.n] * (1 - fc) + a[i + d.n + 1] * fc) * fr);
}
export const demLL = (lat, lon) => { const [X, Y] = llToMap(lat, lon); return demH(X, Y); };
export const covered = site => !!st.dem && site.lat <= -st.dem.limit - 0.3;

/**
 * Terrain horizon around a site: elevation angle (deg) of the highest terrain
 * in each of 720 azimuth bins (0.5° apart), out to 150 km, including the
 * curvature of the Moon. Without a DEM, returns the smooth-sphere horizon dip.
 */
export function horizonFor(site) {
  const key = `${site.lat.toFixed(4)},${site.lon.toFixed(4)},${st.mast},${st.dem ? st.dem.name : 'flat'}`;
  if (hzCache.has(key)) return hzCache.get(key);
  const hz = new Float32Array(720);
  let h0 = 0;
  if (covered(site)) {
    h0 = demLL(site.lat, site.lon);
    const ro = RM + (h0 + st.mast) / 1000;          // observer radius
    const p1 = site.lat * D2R, l1 = site.lon * D2R, sp1 = Math.sin(p1), cp1 = Math.cos(p1);
    const stepMin = st.dem.scale / 1000;
    for (let k = 0; k < 720; k++) {
      const th = k * 0.5 * D2R, sth = Math.sin(th), cth = Math.cos(th);
      // Start below anything possible: on a peak the terrain falls away and the
      // true horizon can sit several degrees below level.
      let best = -90;
      // Steps grow with distance (1.5%), never smaller than one DEM pixel.
      for (let d = stepMin; d < 150; d += Math.max(stepMin, d * 0.015)) {
        const del = d / RM, sd = Math.sin(del), cd = Math.cos(del);
        const sp2 = sp1 * cd + cp1 * sd * cth;
        const p2 = Math.asin(sp2);
        const l2 = l1 + Math.atan2(sth * sd * cp1, cd - sp1 * sp2);  // great-circle destination
        const h = demLL(p2 * R2D, l2 * R2D);
        if (isNaN(h)) break;
        const r = RM + h / 1000;
        const el = Math.atan2(r * cd - ro, r * sd) * R2D;
        if (el > best) best = el;
      }
      // Ray left the DEM immediately (site at its edge): fall back to a smooth sphere.
      hz[k] = best > -90 ? best : -Math.acos(Math.min(1, (RM + h0 / 1000) / ro)) * R2D;
    }
  } else {
    hz.fill(-Math.acos(RM / (RM + st.mast / 1000)) * R2D);
  }
  const out = { hz, h0, terrain: covered(site) };
  hzCache.set(key, out);
  return out;
}

export function hzAt(hz, az) {
  const x = az * 2, i = Math.floor(x) % 720, f = x - Math.floor(x);
  return hz[i] * (1 - f) + hz[(i + 1) % 720] * f;
}

/** Fraction of the solar disk (area) above a horizon at height h, Sun centre at el. */
export function diskFrac(el, h, sunR) {
  const x = (el - h) / sunR;
  if (x >= 1) return 1;
  if (x <= -1) return 0;
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

function parseName(name) {
  const m = /(\d{2,3})S_(\d+)M/i.exec(name);
  if (!m) return null;
  const lim = m[1].length === 3 ? +m[1] / 10 : +m[1];
  return { limit: lim, scale: +m[2] };
}

/** Load a LOLA polar IMG. Returns {ok, message}. */
export function loadDEM(buf, name) {
  const info = parseName(name);
  const n = Math.round(Math.sqrt(buf.byteLength / 2));
  if (!info || n * n * 2 !== buf.byteLength) {
    return { ok: false, message: `Could not read “${name}”. Use a south-pole LOLA file named like LDEM_75S_240M.IMG.` };
  }
  st.dem = { data: new Int16Array(buf), n, off: n / 2 - 0.5, scale: info.scale, limit: info.limit, name };
  hzCache.clear();
  // Sanity check: Shackleton crater (89.67°S, 129.78°E, ~21 km wide) is ~4 km deep.
  const floor = demLL(-89.67, 129.78);
  const [X0, Y0] = llToMap(-89.67, 129.78);
  let ring = 0, cnt = 0;
  for (let a = 0; a < 360; a += 20) {
    const h = demH(X0 + 10.5 * Math.sin(a * D2R), Y0 + 10.5 * Math.cos(a * D2R));
    if (!isNaN(h)) { ring += h; cnt++; }
  }
  const depth = (ring / cnt - floor) / 1000;
  return {
    ok: true,
    message: `Loaded ${name} (${info.scale} m/pixel, ${n}×${n}). Check: Shackleton floor sits ${depth.toFixed(1)} km below its rim ${depth > 2 ? '✓' : '(unexpected; check the file)'}.`,
  };
}

// Remember the DEM between visits (IndexedDB, browser only).
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('lunar-lookout', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('dem');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function cacheDEM(buf, name) {
  try { const db = await idb(); db.transaction('dem', 'readwrite').objectStore('dem').put({ buf, name }, 'dem'); } catch (e) { /* storage unavailable */ }
}
export async function restoreDEM() {
  try {
    const db = await idb();
    return await new Promise(res => {
      const q = db.transaction('dem').objectStore('dem').get('dem');
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
export async function deleteDEM() {
  try { const db = await idb(); db.transaction('dem', 'readwrite').objectStore('dem').delete('dem'); } catch (e) { /* storage unavailable */ }
}
