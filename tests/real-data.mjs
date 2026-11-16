// Run with: npm run test:real   (needs data/LDEM_75S_240M.IMG)
// Checks results on real NASA LOLA terrain against published facts about the south pole.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('astronomy-engine');

const { st, HOUR, DAY } = await import('../js/state.js');
const T = await import('../js/terrain.js');
const { series, metrics } = await import('../js/analysis.js');
const { SITES } = await import('../js/sites.js');

const path = new URL('../data/LDEM_75S_240M.IMG', import.meta.url);
if (!existsSync(path)) { console.log('SKIP  data/LDEM_75S_240M.IMG not found'); process.exit(0); }
const b = readFileSync(path);
const r = T.loadDEM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'LDEM_75S_240M.IMG');

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fails++; };
check('LOLA file loads', r.ok, r.message);

// Terrain facts
const km = m => (m / 1000).toFixed(2) + ' km';
const floor = T.demLL(-89.67, 129.78);
check('Shackleton crater is ~4 km deep (Zuber et al. 2012: ~4.2 km)', /sits (\d\.\d)/.test(r.message) && +r.message.match(/sits (\d\.\d)/)[1] > 3, r.message.match(/sits [\d.]+ km/)?.[0]);
const mal = Math.max(...[-86, -86.2, -85.8, -86.4].flatMap(la => [0, 1, 2, 3, 4, 5, 6].map(lo => T.demLL(la, lo))));
check('Malapert massif rises ~5 km above datum', mal > 4000, km(mal));

// Illumination over one full year (covers the seasonal cycle), Sun at 2 m height.
st.mast = 2; st.battery = 72;
const t0 = Date.UTC(2026, 0, 1);
const year = id => metrics(series(SITES.find(s => s.id === id), t0, 365));
const out = {};
for (const id of ['ridge', 'pole', 'nobile1', 'malapert', 'mouton', 'degerlache', 'shackfloor', 'haworth']) {
  out[id] = year(id);
  console.log(`      ${id.padEnd(11)} sunlight ${out[id].sun.toFixed(1).padStart(5)}%   Earth ${out[id].earth.toFixed(1).padStart(5)}%   longest night ${(out[id].longestDark / 24).toFixed(1)} d`);
}
check('Shackleton floor is permanently shadowed (<1% sunlight)', out.shackfloor.sun < 1, out.shackfloor.sun.toFixed(2) + '%');
check('Haworth floor is permanently shadowed (<1% sunlight)', out.haworth.sun < 1, out.haworth.sun.toFixed(2) + '%');
check('Connecting ridge is among the best-lit spots (>60%; Mazarico et al. 2011 report ~80–90% at points near it)', out.ridge.sun > 60, out.ridge.sun.toFixed(1) + '%');
check('Ridge gets far more light than the crater floors', out.ridge.sun > out.shackfloor.sun + 50);
check('Ridge longest night is days, not months (Mazarico et al. 2011)', out.ridge.longestDark < 10 * 24, (out.ridge.longestDark / 24).toFixed(1) + ' d');

// NASA Artemis candidate regions: each analysis point sits within 4 km of its
// region centre on gentle ground and is reasonably lit over 2027.
{
  const R = 1737.4, rad = Math.PI / 180;
  const dist = (a, b) => R * Math.acos(Math.min(1, Math.sin(a[0] * rad) * Math.sin(b[0] * rad) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((a[1] - b[1]) * rad)));
  const arts = SITES.filter(s => s.artemis);
  check('Nine Artemis candidate regions are listed', arts.length === 9, arts.map(s => s.id).join(', '));
  let worst = 0, minSun = 100;
  for (const s of arts) {
    worst = Math.max(worst, dist([s.lat, s.lon], s.centre));
    minSun = Math.min(minSun, metrics(series(s, Date.UTC(2027, 0, 1), 365)).sun);
  }
  check('Each region point is within 4 km of its region centre', worst <= 4.05, worst.toFixed(2) + ' km max');
  check('Each region point gets at least 40% sunlight over 2027', minSun >= 40, minSun.toFixed(1) + '% lowest');
}

// NASA's official 18.6-year illumination and Earth-visibility maps (LOLA team, PGDA)
{
  const { NASA_ILLUM, compareWithNasa } = await import('../js/nasamaps.js');
  const res = Object.keys(NASA_ILLUM).map(id => compareWithNasa(SITES.find(s => s.id === id)));
  for (const r of res) console.log(`      ${r.site.id.padEnd(12)} sun ours ${r.ours.sun.toFixed(1).padStart(5)} NASA ${String(r.ref.sun).padStart(5)} [${r.ref.sunMin}–${r.ref.sunMax}] ${r.sunOk ? 'ok' : 'OUT'} · earth ours ${r.ours.earth.toFixed(1).padStart(5)} NASA ${String(r.ref.earth).padStart(5)} [${r.ref.earthMin}–${r.ref.earthMax}] ${r.earthOk ? 'ok' : 'OUT'}`);
  const sunIn = res.filter(r => r.sunOk).length, earthIn = res.filter(r => r.earthOk).length;
  const mean = k => res.reduce((a, r) => a + Math.abs(r.ours[k] - r.ref[k]), 0) / res.length;
  check('Sunlight agrees with NASA\'s 18.6-year illumination map', sunIn >= 14, `${sunIn}/${res.length} sites within NASA's ±120 m range (±4 pts); mean |diff| ${mean('sun').toFixed(1)} pts`);
  check('Earth visibility agrees with NASA\'s 18.6-year Earth-visibility map', earthIn >= 14, `${earthIn}/${res.length} sites within range; mean |diff| ${mean('earth').toFixed(1)} pts`);
}

// Landing Site Score on real terrain (30-day mission from 15 Nov 2026, default lander)
st.arrayW = 450; st.loadW = 120; st.battKWh = 8.6;
const t1 = Date.UTC(2026, 10, 15);
const ridge30 = metrics(series(SITES.find(s => s.id === 'ridge'), t1, 30));
const floor30 = metrics(series(SITES.find(s => s.id === 'shackfloor'), t1, 30));
check('Ridge scores far higher than the crater floor', ridge30.score.total > 60 && floor30.score.total === 0, `ridge ${ridge30.score.total}, floor ${floor30.score.total}`);

console.log(fails ? `\n${fails} check(s) failed` : '\nAll real-data checks passed');
process.exit(fails ? 1 : 0);
