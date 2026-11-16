// Finds a representative landing point inside each of NASA's nine Artemis
// candidate regions: the best-lit spot on gentle ground near the region centre.
//
//   node tools/find-region-points.mjs
//
// Method: grid every 0.5 km within 4 km of the region centre (regions are about
// 15 km across, so this stays inside them), keep points with local slope ≤ 10°
// on the LOLA 240 m DEM, and pick the one with the most sunlight over 2027
// (2 m mast, Sun disk fraction above the terrain horizon). Ties go to more
// Earth visibility.
//
// Region centres: digitised from NASA's 28 Oct 2024 candidate-region map by
// Team AFUQ (github.com/ziyadell/Lunar-Landing-Site-Navigator, MIT licence,
// stated accuracy ~0.5 km). NASA has not published centre coordinates.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('astronomy-engine');
const { st, D2R } = await import('../js/state.js');
const T = await import('../js/terrain.js');
const { series, metrics } = await import('../js/analysis.js');

const REGIONS = [
  ['Peak near Cabeus B', -83.641, -68.765], ['Haworth', -86.772, -22.815], ['Malapert Massif', -85.992, -0.217],
  ['Mons Mouton Plateau', -84.333, 30.622], ['Mons Mouton', -85.427, 31.713], ['Nobile Rim 1', -85.435, 37.321],
  ['Nobile Rim 2', -83.958, 58.854], ['de Gerlache Rim 2', -88.236, -64.546], ['Slater Plain', -87.163, 125.568],
];
const b = readFileSync(new URL('../data/LDEM_75S_240M.IMG', import.meta.url));
T.loadDEM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'LDEM_75S_240M.IMG');
st.mast = 2;
const slopeDeg = (X, Y) => { const k = 0.24; const gx = (T.demH(X + k, Y) - T.demH(X - k, Y)) / (2 * k * 1000), gy = (T.demH(X, Y + k) - T.demH(X, Y - k)) / (2 * k * 1000); return Math.atan(Math.hypot(gx, gy)) / D2R; };
const t0 = Date.UTC(2027, 0, 1);
const out = [];
for (const [name, la, lo] of REGIONS) {
  const [Xc, Yc] = T.llToMap(la, lo);
  let best = null, n = 0;
  for (let dx = -4; dx <= 4; dx += 0.5) for (let dy = -4; dy <= 4; dy += 0.5) {
    if (Math.hypot(dx, dy) > 4) continue;
    const X = Xc + dx, Y = Yc + dy;
    if (slopeDeg(X, Y) > 10) continue;
    const [pla, plo] = T.mapToLL(X, Y); n++;
    const m = metrics(series({ lat: pla, lon: plo }, t0, 365));
    if (!best || m.sun > best.sun + 0.05 || (Math.abs(m.sun - best.sun) <= 0.05 && m.earth > best.earth)) best = { lat: pla, lon: plo, sun: m.sun, earth: m.earth, night: m.longestDark / 24, h: T.demH(X, Y), slope: slopeDeg(X, Y) };
  }
  out.push({ name, centre: [la, lo], ...best, candidates: n });
  console.log(`${name.padEnd(20)} ${best.lat.toFixed(3)}, ${best.lon.toFixed(3)}  sun ${best.sun.toFixed(1)}%  earth ${best.earth.toFixed(1)}%  night ${best.night.toFixed(1)} d  h ${Math.round(best.h)} m  slope ${best.slope.toFixed(1)}°  (${n} pts)`);
}
console.log(JSON.stringify(out.map(o => ({ name: o.name, lat: +o.lat.toFixed(3), lon: +o.lon.toFixed(3), sun: +o.sun.toFixed(1), earth: +o.earth.toFixed(1) }))));
