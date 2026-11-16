// Landing window heatmap, live validation, share links, CSV export and the guided tour.
import { D2R, DAY, HOUR, st } from './state.js';
import { SITES, CUSTOM, siteById, shortName } from './sites.js';
import { series, metrics } from './analysis.js';
import { demLL, llToMap, demH } from './terrain.js';
import { renderAll, getMain, onRenderAll, onRenderNow } from './render.js';
import { fmtDate, fmtUTC, fmtH, pad } from './format.js';
import { shortForecast } from './forecast.js';
import { horizonsChecks } from './horizons.js';

const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- heatmap
const WIN_DAYS = 60;
const winSites = () => SITES.filter(s => s.g === 'South pole');
let win = null;      // {key, base, rows:[{site, cells:[{m}]}]}
let winJob = 0;

function winKey(base) { return [base, st.days, st.arrayW, st.loadW, st.battKWh, st.mast, st.dem ? st.dem.name : 'flat'].join('|'); }

function scheduleWindows() {
  // Keep the 60-day window anchored while the chosen date stays inside it,
  // so clicking a square doesn't shift the whole grid.
  let base = win && st.t0 >= win.base && st.t0 < win.base + WIN_DAYS * DAY ? win.base : st.t0;
  const key = winKey(base);
  if (win && win.key === key) { drawWindows(); return; }
  const job = ++winJob, sites = winSites();
  win = { key, base, rows: sites.map(site => ({ site, cells: [] })) };
  let i = 0;
  const step = () => {
    if (job !== winJob) return;                       // superseded by a newer request
    const row = win.rows[i];
    for (let d = 0; d < WIN_DAYS; d++) { const S = series(row.site, base + d * DAY, st.days); row.cells.push({ m: metrics(S), q0: S.pts[0] }); }
    drawWindows();
    if (++i < win.rows.length) setTimeout(step, 0); else scheduleValidation();
  };
  drawWindows();
  setTimeout(step, 30);
}

function drawWindows() {
  const cv = $('winCv'); if (!cv || !win) return;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = +cv.getAttribute('height');
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const narrow = w < 560, L = narrow ? 92 : 170, T = 4, B = 22, pw = w - L - 6, rh = (h - T - B) / win.rows.length, cw = pw / WIN_DAYS;
  const col = { go: css('--good'), caution: css('--warn'), nogo: css('--bad') };
  c.font = '12px "IBM Plex Sans", sans-serif'; c.textBaseline = 'middle';
  win.rows.forEach((r, ri) => {
    const y = T + ri * rh;
    c.fillStyle = css('--ink-2'); c.textAlign = 'right'; c.fillText(shortName(r.site.name), L - 8, y + rh / 2, L - 12);
    for (let d = 0; d < WIN_DAYS; d++) {
      const x = L + d * cw, cell = r.cells[d];
      if (!cell) { c.fillStyle = css('--line'); c.globalAlpha = 0.5; c.fillRect(x + 0.5, y + 1, cw - 1, rh - 2); c.globalAlpha = 1; continue; }
      const m = cell.m, q = m.score.total / 100;
      c.fillStyle = col[m.verdict.lvl]; c.globalAlpha = 0.3 + 0.7 * q;
      c.fillRect(x + 0.5, y + 1, Math.max(1, cw - 1), rh - 2); c.globalAlpha = 1;
    }
  });
  // current site/day ring
  const ri = win.rows.findIndex(r => r.site === st.site), d = Math.floor((st.t0 - win.base) / DAY);
  if (ri >= 0 && d >= 0 && d < WIN_DAYS) {
    c.strokeStyle = css('--ink'); c.lineWidth = 2;
    c.strokeRect(L + d * cw - 1, T + ri * rh - 1, cw + 1, rh + 1);
  }
  c.fillStyle = css('--muted'); c.font = '11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
  for (let k = 0; k < WIN_DAYS; k += narrow ? 15 : 10) c.fillText(fmtDate(win.base + k * DAY), Math.max(L + 24, L + (k + 0.5) * cw), h - B + 6);

  const hit = e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left - L, y = e.clientY - r.top - T;
    const dd = Math.floor(x / cw), rr = Math.floor(y / rh);
    if (dd < 0 || dd >= WIN_DAYS || rr < 0 || rr >= win.rows.length) return null;
    return { row: win.rows[rr], d: dd, cell: win.rows[rr].cells[dd] };
  };
  const tip = $('tip');
  cv.onmousemove = e => {
    const k = hit(e); if (!k || !k.cell) { tip.style.opacity = 0; return; }
    const m = k.cell.m;
    tip.textContent = `${k.row.site.name}\nLand ${fmtDate(win.base + k.d * DAY)} · ${shortForecast(k.cell.q0, m.verdict)} · score ${m.score.total}\nSunlight ${m.sun.toFixed(0)}% · Earth ${m.earth.toFixed(0)}%\nLowest battery ${Math.round(m.minSoc * 100)}%${m.deadH ? ' (runs flat)' : ''}`;
    tip.style.opacity = 1; tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  };
  cv.onmouseleave = () => { tip.style.opacity = 0; };
  cv.onclick = e => { const k = hit(e); if (!k) return; st.site = k.row.site; st.t0 = win.base + k.d * DAY; st.frac = 0; renderAll(); };
  cv.style.cursor = 'pointer';
  if (kbd) {   // keyboard focus cell
    c.strokeStyle = css('--accent'); c.lineWidth = 2; c.setLineDash([3, 2]);
    c.strokeRect(L + kbd.d * cw + 1, T + kbd.r * rh + 1, cw - 2, rh - 2); c.setLineDash([]);
  }
  announce();
}

// Keyboard: arrows move a focus cell, Enter loads it.
let kbd = null;
function announce() {
  if (!win) return;
  const done = win.rows.every(r => r.cells.length === WIN_DAYS);
  const k = kbd || { r: Math.max(0, win.rows.findIndex(r => r.site === st.site)), d: Math.max(0, Math.floor((st.t0 - win.base) / DAY)) };
  const row = win.rows[k.r], cell = row && row.cells[k.d];
  $('winSummary').textContent = !done ? 'Simulating landing windows…' : cell
    ? `${row.site.name}, landing ${fmtDate(win.base + k.d * DAY)}: ${cell.m.verdict.label}, score ${cell.m.score.total}.` : '';
}
function winKeys(e) {
  if (!win) return;
  const move = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
  if (!kbd) kbd = { r: Math.max(0, win.rows.findIndex(r => r.site === st.site)), d: Math.max(0, Math.min(WIN_DAYS - 1, Math.floor((st.t0 - win.base) / DAY))) };
  if (move) {
    e.preventDefault();
    kbd.r = Math.max(0, Math.min(win.rows.length - 1, kbd.r + move[0]));
    kbd.d = Math.max(0, Math.min(WIN_DAYS - 1, kbd.d + move[1]));
    drawWindows();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    st.site = win.rows[kbd.r].site; st.t0 = win.base + kbd.d * DAY; st.frac = 0; renderAll();
  }
}

// ---------------------------------------------------------------- validation
let validKey = null;
let terrainRows = null;
function horizonsRows() {
  return horizonsChecks().map(h => [
    h.label,
    `az ${h.appAz.toFixed(2)}°, el ${h.appEl.toFixed(2)}°`,
    `JPL Horizons: az ${h.az.toFixed(2)}°, el ${h.el.toFixed(2)}° (Δaz ${h.dAz >= 0 ? '+' : ''}${h.dAz.toFixed(3)}°, Δel ${h.dEl >= 0 ? '+' : ''}${h.dEl.toFixed(3)}°)`,
    h.ok,
  ]);
}
function drawValidation() {
  const rows = [...horizonsRows(), ...(terrainRows || [])];
  const wait = st.dem ? '' : `<tr><td colspan="4" class="sub">${st.demLoading ? 'Terrain checks run once the NASA LOLA terrain has loaded…' : 'Load LOLA terrain to run the terrain checks.'}</td></tr>`;
  $('validTable').innerHTML = `<thead><tr><th>Check</th><th class="num">Lunar Lookout</th><th>Reference</th><th>Match</th></tr></thead><tbody>` +
    rows.map(([k, v, ref, ok]) => `<tr><td>${k}</td><td class="num">${v}</td><td>${ref}</td><td>${ok ? '<span class="delta-up">✓ agrees</span>' : '<span class="delta-down">✕ check</span>'}</td></tr>`).join('') + wait + '</tbody>';
}
function scheduleValidation() {
  if (!st.dem) { terrainRows = null; validKey = null; drawValidation(); return; }
  if (validKey === st.dem.name) return;
  validKey = st.dem.name;
  setTimeout(() => {
    const keepMast = st.mast; st.mast = 2;
    const year = id => metrics(series(siteById(id), Date.UTC(2026, 0, 1), 365));
    const ridge = year('ridge'), shack = year('shackfloor'), haw = year('haworth');
    st.mast = keepMast;
    // Shackleton depth: rim ring vs floor
    const floor = demLL(-89.67, 129.78), [X0, Y0] = llToMap(-89.67, 129.78);
    let ring = 0, n = 0;
    for (let a = 0; a < 360; a += 20) { const v = demH(X0 + 10.5 * Math.sin(a * D2R), Y0 + 10.5 * Math.cos(a * D2R)); if (!isNaN(v)) { ring += v; n++; } }
    const depth = (ring / n - floor) / 1000;
    let mal = -1e9;
    for (const la of [-85.8, -86, -86.2, -86.4]) for (let lo = 0; lo <= 6; lo++) mal = Math.max(mal, demLL(la, lo));
    const rows = [
      ['Shackleton crater depth', `${depth.toFixed(1)} km`, '~4.2 km (Zuber et al. 2012, Nature)', Math.abs(depth - 4.2) < 0.6],
      ['Malapert massif height', `${(mal / 1000).toFixed(1)} km`, '~5 km above datum', mal > 4000 && mal < 6000],
      ['Shackleton floor sunlight (1 yr)', `${shack.sun.toFixed(1)}%`, 'Permanently shadowed', shack.sun < 1],
      ['Haworth floor sunlight (1 yr)', `${haw.sun.toFixed(1)}%`, 'Permanently shadowed', haw.sun < 1],
      ['Connecting ridge sunlight (1 yr)', `${ridge.sun.toFixed(0)}%`, '~80–90% (Mazarico et al. 2011, Icarus)', ridge.sun > 70 && ridge.sun < 95],
      ['Connecting ridge longest night', fmtH(ridge.longestDark), 'Days, not weeks (Mazarico et al. 2011)', ridge.longestDark < 10 * 24],
    ];
    terrainRows = rows;
    drawValidation();
  }, 50);
}

// ---------------------------------------------------------------- share + CSV
export function applyHash() {
  // Any missing or malformed value is ignored and the default kept.
  let q;
  try { q = new URLSearchParams(location.hash.slice(1)); } catch (e) { return; }
  if (![...q.keys()].length) return;
  const num = (k, lo, hi) => {
    if (!q.has(k) || q.get(k).trim() === '') return null;
    const v = Number(q.get(k));
    return Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  };
  const site = q.get('site');
  const la = num('lat', -90, 90), lo = num('lon', -180, 360);
  if (site === 'custom' && la !== null && lo !== null) { CUSTOM.lat = Math.max(-89.99, la); CUSTOM.lon = lo > 180 ? lo - 360 : lo; st.site = CUSTOM; }
  else if (site && site !== 'custom' && siteById(site)) st.site = siteById(site);
  const t = Date.parse(q.get('t') || '');
  if (Number.isFinite(t) && t > Date.UTC(1950, 0, 1) && t < Date.UTC(2100, 0, 1)) st.t0 = Math.floor(t / HOUR) * HOUR;
  const d = num('days', 1, 90); if (d && [14, 30, 60, 90].includes(d)) { st.days = d; $('durSel').value = String(d); }
  const m = num('mast', 0, 50); if (m !== null) { st.mast = m; $('mastIn').value = m; }
  const a = num('array', 0, 20000); if (a !== null) { st.arrayW = a; $('arrayIn').value = a; }
  const l = num('load', 1, 20000); if (l !== null) { st.loadW = l; $('loadIn').value = l; }
  const b = num('batt', 0.1, 1000); if (b !== null) { st.battKWh = b; $('battIn').value = b; }
}
function shareURL() {
  const q = new URLSearchParams({ site: st.site.id, t: new Date(st.t0).toISOString().slice(0, 13) + ':00Z', days: st.days, mast: st.mast, array: st.arrayW, load: st.loadW, batt: st.battKWh });
  if (st.site === CUSTOM) { q.set('lat', CUSTOM.lat); q.set('lon', CUSTOM.lon); }
  return location.origin + location.pathname + '#' + q.toString();
}
function downloadCSV() {
  const S = getMain();
  const head = 'time_utc,sun_azimuth_deg,sun_elevation_deg,terrain_horizon_at_sun_deg,sun_disk_visible_fraction,earth_azimuth_deg,earth_elevation_deg,terrain_horizon_at_earth_deg,earth_in_view';
  const lines = S.pts.map(q => [new Date(q.ms).toISOString(), q.sAz.toFixed(3), q.sEl.toFixed(4), q.sHz.toFixed(4), q.frac.toFixed(3), q.eAz.toFixed(3), q.eEl.toFixed(4), q.eHz.toFixed(4), q.eVis ? 1 : 0].join(','));
  const meta = `# Lunar Lookout export: ${S.site.name} (${S.site.lat}, ${S.site.lon}), ${st.days}-day mission from ${fmtUTC(st.t0)}, mast ${st.mast} m, terrain ${S.H.terrain ? st.dem.name : 'smooth Moon'}`;
  const blob = new Blob([meta + '\n' + head + '\n' + lines.join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  const d = new Date(st.t0);
  a.href = URL.createObjectURL(blob);
  a.download = `lunar-lookout_${S.site.id}_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- guided tour
const TOUR = [
  { el: 'brief', title: 'The problem', text: 'Artemis astronauts and robotic landers are heading for the lunar south pole. There the Sun skims the horizon and mountains can hide Earth. Pick the wrong site or date and a lander loses power, or loses contact with Earth.' },
  { el: 'horizonSec', title: 'The sky above a landing site', text: 'This is the sky above the connecting ridge, a 2 km high ridge beside Shackleton crater. The grey outline is the real horizon, traced from NASA LOLA laser-altimeter terrain. The orange track is the Sun over a 30-day mission and the blue loop is Earth. Press Play to watch them move.', act: () => setSite('ridge') },
  { el: 'readySec', title: 'Is it a GO?', text: 'The app flies the mission hour by hour: the solar array charges the battery in sunlight, the battery carries the lander through each night, and Earth contact is tracked for radio. That gives a Landing Site Score from 0 to 100 and a GO / CAUTION / NO-GO call, plus countdowns to the next sunset and Earthset.' },
  { el: 'slipSec', title: 'What if the launch slips?', text: 'Launches slip. This table reruns the whole mission for a 1-day, 1-week, 2-week and 1-month delay, so planners can see the risk before it happens.' },
  { el: 'windowsSec', title: 'Find the landing window', text: 'Every square is a full mission simulation: 7 south-pole sites × 60 landing days on real terrain. Green means go. Click any square to load that landing.' },
  { el: 'readySec', title: 'Where the ice hides', text: 'Now we are on the floor of Shackleton crater: 0% sunlight. This floor has not seen the Sun in billions of years, which is why water ice survives here. That ice is a big reason everyone is going to the south pole.', act: () => setSite('shackfloor') },
  { el: 'view3dSec', title: 'Stand on the site in 3D', text: 'This is the real terrain around the connecting ridge, rebuilt in 3D from NASA LOLA data, with shadows cast by the true Sun. Press "Lander\'s eye" to see the horizon exactly as the lander would.', act: () => { setSite('ridge'); load3D(); } },
  { el: 'mapSec', title: 'Live shadows across the pole', text: 'The lighting map casts shadows from the real terrain for the current moment. Drag the time slider or press Play and the shadows sweep around the pole. Click anywhere on the map to test your own landing spot.' },
  { el: 'validSec', title: 'Can you trust it?', text: 'Every key number is checked live against published NASA-funded science, using the same data. Thanks for taking the tour!', act: () => setSite('ridge') },
];
let tourI = -1;
function setSite(id) { const s = siteById(id); if (st.site !== s) { st.site = s; st.frac = 0; renderAll(); } }
function showTour(i) {
  document.querySelectorAll('.spot').forEach(n => n.classList.remove('spot'));
  if (i < 0 || i >= TOUR.length) { $('tour').hidden = true; tourI = -1; return; }
  tourI = i; const s = TOUR[i];
  s.act?.();
  $('tour').hidden = false;
  $('tourStep').textContent = `Step ${i + 1} of ${TOUR.length}`;
  $('tourTitle').textContent = s.title; $('tourText').textContent = s.text;
  $('tourBack').disabled = i === 0;
  $('tourNext').textContent = i === TOUR.length - 1 ? 'Finish' : 'Next';
  const el = $(s.el); el.classList.add('spot');
  el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
}

// ---------------------------------------------------------------- wiring
// ---------------------------------------------------------------- 3D view (lazy)
let v3 = null, v3Loading = false, v3Timer = null;
const tNow = () => st.t0 + st.frac * st.days * DAY;
function update3D(force) {
  if (!v3) return;
  clearTimeout(v3Timer);
  v3Timer = setTimeout(() => v3.update3D(tNow(), force), st.playing ? 300 : 40);
}
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
  catch (e) { return false; }
}
async function load3D() {
  if (v3 || v3Loading) return; v3Loading = true;
  if (!hasWebGL()) { $('view3dMsg').textContent = 'The 3D view needs WebGL, which is turned off or unavailable in this browser. Everything else still works.'; return; }
  try {
    $('view3dMsg').textContent = 'Loading 3D view…';
    v3 = await import('./view3d.js');
    v3.init3D($('view3d'), $('view3dMsg'));
    update3D(true);
  } catch (e) {
    $('view3dMsg').textContent = '3D view needs WebGL, which this browser does not provide. Everything else still works.';
  }
}
export const onTimeChange = () => update3D(false);

export function initFeatures() {
  onRenderNow(() => update3D(false));
  new IntersectionObserver((es, o) => { if (es.some(x => x.isIntersecting)) { o.disconnect(); load3D(); } }, { rootMargin: '300px' }).observe($('view3dSec'));
  $('eyeSun').onclick = () => { load3D().then(() => v3?.landerEye('sun')); };
  $('eyeEarth').onclick = () => { load3D().then(() => v3?.landerEye('earth')); };
  $('eyeTop').onclick = () => v3?.overview();
  $('r3d').onchange = e => { v3?.set3D({ R: +e.target.value }); update3D(true); };
  $('x3d').onchange = e => { v3?.set3D({ exag: +e.target.value }); update3D(true); };
  onRenderAll(() => { scheduleWindows(); scheduleValidation(); update3D(false); if (tourI < 0 && location.hash) history.replaceState(null, '', shareURL()); });
  $('shareBtn').onclick = async () => {
    const url = shareURL();
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); $('shareOut').textContent = 'Link copied. Anyone who opens it sees this exact scenario.'; }
    catch (e) { $('shareOut').textContent = url; }
  };
  $('csvBtn').onclick = downloadCSV;
  $('winCv').addEventListener('keydown', winKeys);
  $('winCv').addEventListener('blur', () => { kbd = null; drawWindows(); });
  $('tourBtn').onclick = () => showTour(0);
  $('tourNext').onclick = () => showTour(tourI + 1);
  $('tourBack').onclick = () => showTour(tourI - 1);
  $('tourClose').onclick = () => showTour(-1);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && tourI >= 0) showTour(-1); });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawWindows, 160); });
}
