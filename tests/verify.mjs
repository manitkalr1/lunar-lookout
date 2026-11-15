// Run with: npm test
// Checks the geometry against independent references. No browser needed.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('astronomy-engine');
const A = globalThis.Astronomy;

const { st, R2D, D2R, RM, DAY, HOUR } = await import('../js/state.js');
const { eph, frame, topo } = await import('../js/ephemeris.js');
const T = await import('../js/terrain.js');
const { series, metrics } = await import('../js/analysis.js');

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fails++; };
const latlon = v => { const n = Math.hypot(...v); return [Math.asin(v[2] / n) * R2D, Math.atan2(v[1], v[0]) * R2D]; };

// 1. Sub-Earth point vs astronomy-engine's independent physical libration model (Meeus).
{
  let worst = 0;
  for (let i = 0; i < 60; i++) {
    const ms = Date.UTC(2026, 0, 1) + i * 6.1 * DAY;
    const [lat, lon] = latlon(eph(ms).earth);
    const L = A.Libration(new Date(ms));
    let dlon = lon - L.elon; dlon = ((dlon + 540) % 360) - 180;
    worst = Math.max(worst, Math.abs(lat - L.elat), Math.abs(dlon));
  }
  check('Sub-Earth point matches independent libration model', worst < 0.1, `worst difference ${worst.toFixed(3)}°`);
}

// 2. Sub-solar latitude never exceeds the Moon's 1.54° axial tilt.
{
  let mx = 0;
  for (let i = 0; i < 400; i++) mx = Math.max(mx, Math.abs(latlon(eph(Date.UTC(2026, 0, 1) + i * DAY).sun)[0]));
  check('Sub-solar latitude stays within ±1.6°', mx < 1.6 && mx > 1.4, `max ${mx.toFixed(2)}°`);
}

// 3. Earth from the near-side centre is near the zenith; from far side it is below the horizon.
{
  const ms = Date.UTC(2026, 5, 1);
  const near = topo(frame(0, 0, 0), eph(ms).earth).el;
  const far = topo(frame(0, 180, 0), eph(ms).earth).el;
  check('Earth high in the sky at near-side centre', near > 80, `${near.toFixed(1)}°`);
  check('Earth below horizon on far side', far < -80, `${far.toFixed(1)}°`);
}

// 4. Smooth-Moon mission metrics are sensible at the pole and on the far side.
{
  st.dem = null; st.mast = 2;
  const pole = metrics(series({ lat: -89.45, lon: -137.31 }, Date.UTC(2026, 0, 1), 30));
  const ce4 = metrics(series({ lat: -45.444, lon: 177.588 }, Date.UTC(2026, 0, 1), 30));
  const a11 = metrics(series({ lat: 0.674, lon: 23.473 }, Date.UTC(2026, 0, 1), 30));
  check("Chang'e-4 (far side) never sees Earth", ce4.earth === 0, `${ce4.earth.toFixed(0)}%`);
  check('Apollo 11 always sees Earth', a11.earth === 100, `${a11.earth.toFixed(0)}%`);
  check('Apollo 11 gets about half sunlight', Math.abs(a11.sun - 50) < 8, `${a11.sun.toFixed(0)}%`);
  check('Smooth-Moon pole ridge is mostly sunlit', pole.sun > 60, `${pole.sun.toFixed(0)}%`);
}

// 5. Terrain ray tracer against an analytic case: synthetic DEM, flat at 0 m
//    with a 2000 m high ring 20 km from the pole. From the pole, the horizon
//    elevation should be atan((2 km - curvature drop) / 20 km).
{
  const scale = 240, n = 1001, data = new Int16Array(n * n);
  const off = n / 2 - 0.5;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const X = (c - off) * scale / 1000, Y = (off - r) * scale / 1000, d = Math.hypot(X, Y);
    data[r * n + c] = d > 19.5 && d < 21.5 ? 4000 : 0;   // 4000 DN × 0.5 = 2000 m
  }
  const name = 'LDEM_75S_240M.IMG';
  const loaded = T.loadDEM(data.buffer, name);
  check('Synthetic DEM loads', loaded.ok, loaded.message.split('.')[0]);
  st.mast = 0;
  const H = T.horizonFor({ lat: -89.999, lon: 0 });
  const d = 19.5, expect = Math.atan2((RM + 2) * Math.cos(d / RM) - RM, (RM + 2) * Math.sin(d / RM)) * R2D;
  let worst = 0;
  for (let k = 0; k < 720; k += 10) worst = Math.max(worst, Math.abs(H.hz[k] - expect));
  check('Horizon from a 2 km wall at 20 km matches geometry', worst < 0.25, `expected ${expect.toFixed(2)}°, worst error ${worst.toFixed(3)}°`);

  // With the wall blocking everything below ~5.7°, the pole site sees no Sun.
  const m = metrics(series({ lat: -89.999, lon: 0 }, Date.UTC(2026, 0, 1), 30));
  check('Walled-in pole site gets no sunlight', m.sun === 0, `${m.sun.toFixed(1)}%`);
  check('…and is called NO-GO', m.verdict.lvl === 'nogo', m.verdict.label);
  st.dem = null;
}

// 6. Bad file names / sizes are rejected cleanly.
{
  const r = T.loadDEM(new ArrayBuffer(10), 'random.img');
  check('Rejects a non-LOLA file', !r.ok);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
