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

/**
 * Mission metrics plus an hour-by-hour power simulation.
 *
 * Power model: a vertical solar array that turns to face the Sun (the usual
 * design at the lunar poles, where the Sun is always near the horizon) makes
 * array W × the fraction of the solar disk above the terrain. The lander draws
 * a constant load. The battery starts full; whenever it hits zero the lander
 * is "dead" for that hour.
 */
export function metrics(S) {
  const p = S.pts, n = p.length, stepH = S.step / HOUR;
  const cap = st.battKWh * 1000, soc = new Float32Array(n);
  let sun = 0, ear = 0, both = 0, maxSun = -99, runD = 0, maxD = 0, runE = 0, maxE = 0;
  let e = cap, minSoc = 1, deadH = 0, firstDead = -1;
  for (let i = 0; i < n; i++) {
    const q = p[i];
    sun += q.frac;
    ear += q.eVis ? 1 : 0;
    both += (q.frac > 0.5 && q.eVis) ? 1 : 0;
    maxSun = Math.max(maxSun, q.sEl - q.sHz);
    if (q.frac < 0.05) { runD += stepH; maxD = Math.max(maxD, runD); } else runD = 0;
    if (!q.eVis) { runE += stepH; maxE = Math.max(maxE, runE); } else runE = 0;
    if (i > 0) {
      e += (st.arrayW * q.frac * Math.cos(Math.max(0, q.sEl) * Math.PI / 180) - st.loadW) * stepH;
      if (e > cap) e = cap;
      if (e <= 0) { e = 0; deadH += stepH; if (firstDead < 0) firstDead = i; }
    }
    soc[i] = cap > 0 ? e / cap : 0;
    minSoc = Math.min(minSoc, soc[i]);
  }
  S.soc = soc;
  const m = {
    sun: 100 * sun / n, earth: 100 * ear / n, both: 100 * both / n, maxSun,
    longestDark: maxD, longestNoEarth: maxE, n,
    minSoc, deadH, firstDeadDay: firstDead < 0 ? null : firstDead * stepH / 24,
  };
  m.score = scoreOf(m);
  m.verdict = verdictOf(m);
  return m;
}

/**
 * Landing Site Score, 0-100. Three parts, each easy to explain:
 *   Power survival  40 pts × lowest battery level (0 if the battery ever runs flat)
 *   Communication   35 pts × share of time Earth is in view
 *   Sunlight        25 pts × share of time the Sun is up
 */
export function scoreOf(m) {
  const power = m.deadH > 0 ? 0 : 40 * m.minSoc;
  const comms = 35 * m.earth / 100;
  const light = 25 * m.sun / 100;
  return { total: Math.round(power + comms + light), power, comms, light };
}

export function verdictOf(m) {
  const why = [];
  let lvl = 'go';
  const bump = l => { if (l === 'nogo' || (l === 'caution' && lvl === 'go')) lvl = l; };
  if (m.deadH > 0) { why.push(`Battery runs flat on day ${m.firstDeadDay.toFixed(1)}; lander without power for ${fmtH(m.deadH)}`); bump('nogo'); }
  else if (m.minSoc < 0.3) { why.push(`Battery drops to ${Math.round(m.minSoc * 100)}%, little margin`); bump('caution'); }
  if (m.earth === 0) { why.push('Earth never in view: no direct radio link'); bump('nogo'); }
  else if (m.earth < 40) { why.push(`Earth in view only ${m.earth.toFixed(0)}% of the time`); bump('caution'); }
  if (m.sun < 10 && m.deadH === 0) { why.push(`Only ${m.sun.toFixed(0)}% sunlight`); bump('caution'); }
  if (!why.length) why.push(`Battery never below ${Math.round(m.minSoc * 100)}%`, `Earth in view ${m.earth.toFixed(0)}% of the time`);
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
    res.push({ d, m, score: m.score.total });
  }
  return { res, best: res.reduce((a, b) => (b.score > a.score ? b : a)) };
}
