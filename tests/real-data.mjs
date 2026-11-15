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
for (const id of ['ridge', 'pole', 'malapert', 'mouton', 'degerlache', 'shackfloor', 'haworth']) {
  out[id] = year(id);
  console.log(`      ${id.padEnd(11)} sunlight ${out[id].sun.toFixed(1).padStart(5)}%   Earth ${out[id].earth.toFixed(1).padStart(5)}%   longest night ${(out[id].longestDark / 24).toFixed(1)} d`);
}
check('Shackleton floor is permanently shadowed (<1% sunlight)', out.shackfloor.sun < 1, out.shackfloor.sun.toFixed(2) + '%');
check('Haworth floor is permanently shadowed (<1% sunlight)', out.haworth.sun < 1, out.haworth.sun.toFixed(2) + '%');
check('Connecting ridge is among the best-lit spots (>60%; Mazarico et al. 2011 report ~80–90% at points near it)', out.ridge.sun > 60, out.ridge.sun.toFixed(1) + '%');
check('Ridge gets far more light than the crater floors', out.ridge.sun > out.shackfloor.sun + 50);
check('Ridge longest night is days, not months (Mazarico et al. 2011)', out.ridge.longestDark < 10 * 24, (out.ridge.longestDark / 24).toFixed(1) + ' d');

console.log(fails ? `\n${fails} check(s) failed` : '\nAll real-data checks passed');
process.exit(fails ? 1 : 0);
