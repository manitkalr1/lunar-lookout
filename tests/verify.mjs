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

// 4b. Power model: a 14-day equatorial night drains a 72 h battery; the
//     battery dies after exactly capacity / load hours of darkness.
{
  st.dem = null; st.mast = 2; st.arrayW = 450; st.loadW = 120; st.battKWh = 8.6;
  const m = metrics(series({ lat: 0.674, lon: 23.473 }, Date.UTC(2026, 0, 1), 30));
  check('Apollo 11 site: battery runs flat during the 14-day lunar night', m.deadH > 200, `${m.deadH} h without power`);
  check('…so the Landing Site Score power part is zero', m.score.power === 0, `score ${m.score.total}`);
  st.arrayW = 0;   // no solar array at all: dies after 8600 Wh / 120 W = 71.7 h
  const z = metrics(series({ lat: 0.674, lon: 23.473 }, Date.UTC(2026, 0, 1), 14));
  check('Battery lasts capacity / load hours', Math.abs(z.firstDeadDay * 24 - 72) <= 1, `${(z.firstDeadDay * 24).toFixed(0)} h (expected 72)`);
  st.arrayW = 450;
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

// 5b. Regression: on top of a 2 km peak the horizon must dip below level
//     (terrain falls away at the 3.8° slope).
{
  const scale = 240, n = 1001, data = new Int16Array(n * n), off = n / 2 - 0.5;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const X = (c - off) * scale / 1000, Y = (off - r) * scale / 1000, d = Math.hypot(X, Y);
    data[r * n + c] = Math.round(4000 * Math.max(0, 1 - d / 30));   // 2000 m cone, 30 km radius (slope 3.8°)
  }
  T.loadDEM(data.buffer, 'LDEM_75S_240M.IMG');
  st.mast = 0;
  const H = T.horizonFor({ lat: -89.999, lon: 0 });
  const mx = Math.max(...H.hz);
  check('Horizon from a peak dips below level', mx < -0.5, `highest horizon ${mx.toFixed(2)}°`);
  st.dem = null;
}

// 6. Bad file names / sizes are rejected cleanly.
{
  const r = T.loadDEM(new ArrayBuffer(10), 'random.img');
  check('Rejects a non-LOLA file', !r.ok);
}

// 7. Forecast wording rules (spec: sunny ≥ 0.99, partly 0.05–0.99, dark < 0.05)
{
  const F = await import('../js/forecast.js');
  const v = { label: 'GO' }, H = 3600e3;
  const line = F.forecastLine({ frac: 1, eVis: false, eEl: 2 }, { ms: 30 * H, from: 0, now: true }, { ms: 44 * H, from: 0, now: false }, v);
  check('Forecast line reads like a weather report', line === '☀️ Sunny, sunset in 30.0 h · 🌍 Earth hidden behind terrain, Earthrise in 44.0 h · Mission call: GO', line);
  check('Partly sunny shows the visible share', F.sunWord(0.4).text.startsWith('Partly sunny (40%'), F.sunWord(0.4).text);
  check('Below 5% of the disk is Dark', F.sunWord(0.04).text === 'Dark');
  check('Short tooltip forecast', F.shortForecast({ frac: 1, eVis: true }, v) === '☀️ 🌍 GO');
}

// 8. JPL Horizons reference values (hard-coded from the Horizons API)
{
  const { horizonsChecks, TOL_AZ, TOL_EL } = await import('../js/horizons.js');
  for (const h of horizonsChecks())
    check(`${h.label}`, h.ok, `Δaz ${h.dAz.toFixed(4)}° (tol ${TOL_AZ}), Δel ${h.dEl.toFixed(4)}° (tol ${TOL_EL})`);
}

// 9. The single-file build used when index.html is opened from disk is up to date.
{
  const { buildBundle } = await import('../tools/build-local.mjs');
  const { readFileSync } = await import('node:fs');
  let committed = ''; try { committed = readFileSync(new URL('../dist/lunar-lookout.js', import.meta.url), 'utf8'); } catch (e) { /* missing */ }
  check('dist/lunar-lookout.js matches the current source (run `npm run build` if not)', committed === await buildBundle());
}

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
