// Mission metrics: sunlight, Earth visibility, longest night, go / no-go call.
import { HOUR, DAY, SUN_R, st } from './state.js';
import { eph, frame, topo } from './ephemeris.js';
import { horizonFor, hzAt, diskFrac } from './terrain.js';
import { fmtH } from './format.js';

export function sample(site, H, f, ms) {
  const e = eph(ms);
  const s = topo(f, e.sun), ea = topo(f, e.earth);
  const hs = hzAt(H.hz, s.az), he = hzAt(H.hz, ea.az);
  return { ms, sAz: s.az, sEl: s.el, sHz: hs, frac: diskFrac(s.el, hs, SUN_R), eAz: ea.az, eEl: ea.el, eHz: he, eVis: ea.el > he };
}

/** Hourly (2-hourly for >30 days) samples across the mission. */
export function series(site, t0, days) {
  const H = horizonFor(site);
  const f = frame(site.lat, site.lon, (H.h0 + st.mast) / 1000);
  const step = days > 30 ? 2 * HOUR : HOUR;
  const n = Math.round(days * DAY / step);
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(sample(site, H, f, t0 + i * step));
  return { site, H, f, step, pts };
}

export function metrics(S) {
  const p = S.pts, n = p.length, stepH = S.step / HOUR;
  let sun = 0, ear = 0, both = 0, maxSun = -99, runD = 0, maxD = 0, runE = 0, maxE = 0;
  for (const q of p) {
    sun += q.frac;
    ear += q.eVis ? 1 : 0;
    both += (q.frac > 0.5 && q.eVis) ? 1 : 0;
    maxSun = Math.max(maxSun, q.sEl - q.sHz);
    if (q.frac < 0.05) { runD += stepH; maxD = Math.max(maxD, runD); } else runD = 0;
    if (!q.eVis) { runE += stepH; maxE = Math.max(maxE, runE); } else runE = 0;
  }
  const m = { sun: 100 * sun / n, earth: 100 * ear / n, both: 100 * both / n, maxSun, longestDark: maxD, longestNoEarth: maxE, n };
  m.verdict = verdictOf(m);
  return m;
}

export function verdictOf(m) {
  const why = [];
  let lvl = 'go';
  if (m.longestDark > st.battery) { why.push(`Longest night ${fmtH(m.longestDark)} exceeds ${st.battery} h battery`); lvl = 'caution'; }
  if (m.sun < 30) { why.push(`Only ${m.sun.toFixed(0)}% sunlight`); lvl = 'caution'; }
  if (m.earth < 40) { why.push(`Earth in view only ${m.earth.toFixed(0)}% of the time`); lvl = lvl === 'caution' ? 'nogo' : 'caution'; }
  if (m.longestDark > 3 * st.battery || m.sun < 10 || m.earth === 0) lvl = 'nogo';
  if (!why.length) why.push(`Night never longer than ${fmtH(m.longestDark)}`, `Earth in view ${m.earth.toFixed(0)}% of the time`);
  return { lvl, why, label: lvl === 'go' ? 'GO' : lvl === 'caution' ? 'CAUTION' : 'NO-GO' };
}

/** Next sunrise/sunset (key 'sun') or Earthrise/Earthset (key 'earth') after ms, within 120 days. */
export function nextChange(S, ms, key) {
  const test = q => (key === 'sun' ? q.frac > 0.5 : q.eVis);
  const at = t => test(sample(S.site, S.H, S.f, t));
  const now = at(ms);
  let a = ms, b = null;
  for (let t = ms + HOUR; t <= ms + 120 * DAY; t += HOUR) { if (at(t) !== now) { b = t; break; } a = t; }
  if (b === null) return { ms: null, now };
  for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (at(m) === now) a = m; else b = m; }
  return { ms: b, now };
}

/** Score each landing day in the next `span` days and return all results plus the best. */
export function scanLandingDays(site, t0, days, span = 60) {
  const res = [];
  for (let d = 0; d < span; d++) {
    const m = metrics(series(site, t0 + d * DAY, days));
    res.push({ d, m, score: m.sun + 0.6 * m.earth - 0.3 * Math.max(0, m.longestDark - st.battery) });
  }
  return { res, best: res.reduce((a, b) => (b.score > a.score ? b : a)) };
}
