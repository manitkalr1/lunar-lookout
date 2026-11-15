// Everything that draws: horizon chart, readiness panel, timeline strips,
// site comparison, launch-slip table, best-day chart and lighting map.
import { D2R, DAY, SUN_R, RM, st } from './state.js';
import { SITES, CUSTOM, siteById, shortName } from './sites.js';
import { eph } from './ephemeris.js';
import { demH, llToMap, mapToLL } from './terrain.js';
import { sample, series, metrics, nextChange, scanLandingDays } from './analysis.js';
import { fmtH, fmtUTC, fmtDate, fmtDur, esc } from './format.js';

const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const tCur = () => st.t0 + st.frac * st.days * DAY;

let MAIN = null;

// ---------- helpers ----------
function prep(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = +cv.getAttribute('height');
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}
const tip = () => $('tip');
function showTip(e, text) {
  const t = tip(); t.textContent = text; t.style.opacity = 1;
  t.style.left = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8) + 'px';
  t.style.top = (e.clientY + 14) + 'px';
}
const hideTip = () => { tip().style.opacity = 0; };

// ---------- entry points ----------
export function renderAll() {
  MAIN = series(st.site, st.t0, st.days);
  MAIN.m = metrics(MAIN);
  renderHorizon(); renderReadiness(); renderStrip(); renderCompare(); renderSlip(); renderMap(); syncInputs();
}
export function renderNow() { renderHorizon(); renderReadiness(); renderStrip(); renderMapThrottled(); syncTime(); }

function syncInputs() {
  $('siteSel').value = st.site.id;
  $('latIn').value = st.site.lat;
  $('lonIn').value = st.site.lon;
  const d = new Date(st.t0), p = n => String(n).padStart(2, '0');
  $('dateIn').value = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:00`;
  syncTime();
}
function syncTime() {
  $('tSlider').value = Math.round(st.frac * 1000);
  const t = tCur();
  $('tLabel').textContent = `Day ${((t - st.t0) / DAY).toFixed(1)} · ${fmtUTC(t)}`;
}

// ---------- horizon chart ----------
function renderHorizon() {
  const cv = $('horizonCv'); const { c, w, h } = prep(cv);
  const S = MAIN, H = S.H, now = sample(S.site, H, S.f, tCur());
  $('horizonTitle').textContent = 'Sky above ' + S.site.name;
  let lo = Infinity, hi = -Infinity;
  for (const v of H.hz) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (const q of S.pts) { hi = Math.max(hi, q.sEl, q.eEl); lo = Math.min(lo, Math.max(q.sEl, -10), Math.max(q.eEl, -10)); }
  lo = Math.floor(Math.max(lo, -12) - 0.5); hi = Math.ceil(Math.min(hi, 90) + 0.5);
  if (hi - lo < 4) hi = lo + 4;
  const L = 44, Rr = 10, T = 10, B = 26, pw = w - L - Rr, ph = h - T - B;
  const X = az => L + az / 360 * pw, Y = el => T + (hi - el) / (hi - lo) * ph;

  c.font = '11px "IBM Plex Mono", monospace'; c.fillStyle = css('--muted'); c.strokeStyle = css('--line'); c.lineWidth = 1;
  const span = hi - lo, stp = span <= 6 ? 1 : span <= 15 ? 2 : span <= 40 ? 5 : span <= 80 ? 10 : 15;
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let v = Math.ceil(lo / stp) * stp; v <= hi; v += stp) {
    c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(L + pw, Y(v)); c.globalAlpha = v === 0 ? 1 : 0.6; c.stroke(); c.globalAlpha = 1;
    c.fillText(v + '°', L - 6, Y(v));
  }
  c.textBaseline = 'top';
  [['N 0°', 0], ['E 90°', 90], ['S 180°', 180], ['W 270°', 270], ['N', 360]].forEach(([s, a]) => {
    c.textAlign = a === 0 ? 'left' : a === 360 ? 'right' : 'center'; c.fillText(s, X(a), T + ph + 8);
  });

  // terrain
  c.beginPath(); c.moveTo(X(0), Y(lo));
  for (let k = 0; k <= 720; k++) c.lineTo(X(k / 2), Y(H.hz[k % 720]));
  c.lineTo(X(360), Y(lo)); c.closePath();
  c.fillStyle = css('--terrain-fill'); c.fill(); c.strokeStyle = css('--terrain'); c.lineWidth = 1.5; c.stroke();

  // Sun and Earth tracks; faded where hidden behind terrain
  const path = (azk, elk, col) => {
    c.fillStyle = col;
    for (const q of S.pts) {
      const vis = elk === 'sEl' ? q.frac > 0 : q.eVis;
      c.globalAlpha = vis ? 0.9 : 0.25; c.fillRect(X(q[azk]) - 1, Y(q[elk]) - 1, 2, 2);
    }
    c.globalAlpha = 1;
  };
  c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip();
  path('sAz', 'sEl', css('--sun')); path('eAz', 'eEl', css('--earth'));
  const ring = css('--panel');
  const body = (az, el, rDeg, col, lbl) => {
    const rr = Math.max(6, rDeg / (hi - lo) * ph);
    c.beginPath(); c.arc(X(az), Y(el), rr, 0, 7); c.fillStyle = col; c.fill(); c.lineWidth = 2; c.strokeStyle = ring; c.stroke();
    c.fillStyle = css('--ink'); c.font = '600 12px "IBM Plex Sans", sans-serif';
    c.textAlign = X(az) > L + pw - 80 ? 'right' : 'left'; c.textBaseline = 'bottom';
    c.fillText(lbl, X(az) + (c.textAlign === 'left' ? rr + 4 : -rr - 4), Y(el) - 2);
  };
  body(now.eAz, now.eEl, 0.95, css('--earth'), 'Earth');
  body(now.sAz, now.sEl, SUN_R, css('--sun'), 'Sun');
  c.restore();
  c.strokeStyle = css('--line'); c.strokeRect(L, T, pw, ph);

  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect(), az = (e.clientX - r.left - L) / pw * 360;
    if (az < 0 || az > 360) return hideTip();
    const el = hi - (e.clientY - r.top - T) / ph * (hi - lo);
    const hzv = H.hz[Math.round(az * 2) % 720];
    showTip(e, `Azimuth ${az.toFixed(1)}°\nTerrain horizon ${hzv.toFixed(2)}°\nCursor elevation ${el.toFixed(2)}°`);
  };
  cv.onmouseleave = hideTip;
}

// ---------- readiness ----------
function renderReadiness() {
  const S = MAIN, m = S.m, t = tCur(), now = sample(S.site, S.H, S.f, t);
  $('windowLbl').textContent = `${st.days}-day mission from ${fmtDate(st.t0)}`;
  const v = m.verdict;
  $('verdict').className = 'verdict ' + v.lvl;
  $('verdict').innerHTML = `<span class="pill ${v.lvl}">${v.label}</span><ul>${v.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
  const sc = nextChange(S, t, 'sun'), ec = nextChange(S, t, 'earth');
  const sunTxt = sc.ms ? `${sc.now ? 'Sunset' : 'Sunrise'} in ${fmtDur(sc.ms - t)}` : (sc.now ? 'No sunset within 120 days' : 'No sunrise within 120 days');
  const earTxt = ec.ms ? `${ec.now ? 'Earthset' : 'Earthrise'} in ${fmtDur(ec.ms - t)}` : (ec.now ? 'Stays in view 120+ days' : 'Not visible for 120+ days');
  const sgn = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '°';
  $('stats').innerHTML = [
    ['Sun above local horizon', sgn(now.sEl - now.sHz), 'sun', `${Math.round(now.frac * 100)}% of disk visible · ${sunTxt}`],
    ['Earth above local horizon', sgn(now.eEl - now.eHz), 'earth', earTxt],
    ['Sunlight over mission', `${m.sun.toFixed(0)}%`, 'sun', `Longest night ${fmtH(m.longestDark)}`],
    ['Earth in view over mission', `${m.earth.toFixed(0)}%`, 'earth', `Longest blackout ${fmtH(m.longestNoEarth)}`],
    ['Power + comm together', `${m.both.toFixed(0)}%`, '', 'Sunlit and Earth in view'],
    ['Highest Sun over horizon', `${m.maxSun.toFixed(1)}°`, '', `Horizon: ${S.H.terrain ? 'LOLA terrain' : 'smooth Moon'}`],
  ].map(([k, val, cl, n]) => `<div class="stat"><span class="k">${k}</span><span class="v ${cl}">${val}</span><span class="n">${n}</span></div>`).join('');
}

// ---------- timeline strips ----------
function drawStrips(cv, rows, opts) {
  const { c, w, h } = prep(cv);
  const L = opts.labelW, top = 4, axisH = 20, rh = (h - top - axisH) / rows.length, pw = w - L - 6;
  c.font = '12px "IBM Plex Sans", sans-serif'; c.textBaseline = 'middle';
  rows.forEach((r, ri) => {
    const y = top + ri * rh;
    c.fillStyle = css('--ink-2'); c.textAlign = 'right'; c.fillText(r.label, L - 8, y + rh / 2, L - 12);
    const n = r.vals.length, bw = pw / n;
    for (let i = 0; i < n; i++) {
      const v = r.vals[i];
      c.fillStyle = v > 0 ? r.color : css('--shadow'); c.globalAlpha = v > 0 ? 0.35 + 0.65 * v : 0.9;
      c.fillRect(L + i * bw, y + 1, Math.ceil(bw + 0.5), rh - 3);
    }
    c.globalAlpha = 1;
  });
  c.fillStyle = css('--muted'); c.font = '11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
  const days = opts.days, every = days <= 14 ? 2 : days <= 30 ? 5 : days <= 60 ? 10 : 15;
  for (let d = 0; d <= days; d += every) {
    const x = L + d / days * pw; c.fillRect(x, h - axisH, 1, 4);
    c.fillText(d === 0 ? 'Day 0' : `${d}`, Math.min(Math.max(x, L + 20), w - 14), h - axisH + 6);
  }
  if (opts.cursor != null) { const x = L + opts.cursor * pw; c.fillStyle = css('--ink'); c.fillRect(x - 1, top, 2, h - top - axisH); }
  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect(), fx = (e.clientX - r.left - L) / pw;
    if (fx < 0 || fx > 1) return hideTip();
    const ri = Math.min(rows.length - 1, Math.floor((e.clientY - r.top - top) / rh));
    if (ri < 0) return hideTip();
    showTip(e, opts.tipText(fx, ri));
  };
  cv.onmouseleave = hideTip;
  cv.onclick = e => { const r = cv.getBoundingClientRect(), fx = (e.clientX - r.left - L) / pw; if (fx < 0 || fx > 1) return; st.frac = fx; renderNow(); };
  cv.style.cursor = 'pointer';
}

function renderStrip() {
  const p = MAIN.pts;
  drawStrips($('stripCv'), [
    { label: 'Sunlight', color: css('--sun'), vals: p.map(q => q.frac) },
    { label: 'Earth in view', color: css('--earth'), vals: p.map(q => (q.eVis ? 1 : 0)) },
    { label: 'Both', color: css('--good'), vals: p.map(q => (q.frac > 0.5 && q.eVis ? 1 : 0)) },
  ], {
    labelW: 96, days: st.days, cursor: st.frac,
    tipText: fx => {
      const q = p[Math.min(p.length - 1, Math.round(fx * (p.length - 1)))];
      return `${fmtUTC(q.ms)}\nSun ${(q.sEl - q.sHz).toFixed(2)}° over horizon (${Math.round(q.frac * 100)}% disk)\nEarth ${(q.eEl - q.eHz).toFixed(2)}° over horizon`;
    },
  });
}

// ---------- comparison ----------
export function renderCompare() {
  const rows = st.compare.slice(0, 5).map(id => { const s = siteById(id); const S = series(s, st.t0, st.days); return { s, S, m: metrics(S) }; });
  const t = $('cmpTable');
  t.innerHTML = `<thead><tr><th>Site</th><th>Call</th><th class="num">Sunlight</th><th class="num">Earth in view</th><th class="num">Both</th><th class="num">Longest night</th><th class="num">Terrain</th><th></th></tr></thead><tbody>` +
    rows.map(r => `<tr><td><button class="x link" data-go="${r.s.id}" title="Open this site">${esc(r.s.name)}</button></td><td><span class="pill ${r.m.verdict.lvl}">${r.m.verdict.label}</span></td><td class="num">${r.m.sun.toFixed(0)}%</td><td class="num">${r.m.earth.toFixed(0)}%</td><td class="num">${r.m.both.toFixed(0)}%</td><td class="num">${fmtH(r.m.longestDark)}</td><td class="num">${r.S.H.terrain ? 'LOLA' : 'smooth'}</td><td><button class="x" data-rm="${r.s.id}" aria-label="Remove ${esc(r.s.name)}">✕</button></td></tr>`).join('') + '</tbody>';
  t.querySelectorAll('[data-rm]').forEach(b => (b.onclick = () => { st.compare = st.compare.filter(i => i !== b.dataset.rm); renderCompare(); }));
  t.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => { st.site = siteById(b.dataset.go); st.frac = 0; renderAll(); }));

  const strips = [];
  rows.forEach(r => {
    strips.push({ label: shortName(r.s.name) + ' · Sun', color: css('--sun'), vals: r.S.pts.map(q => q.frac), S: r.S });
    strips.push({ label: 'Earth', color: css('--earth'), vals: r.S.pts.map(q => (q.eVis ? 1 : 0)), S: r.S });
  });
  const cv = $('cmpCv'); cv.setAttribute('height', Math.max(80, 26 + strips.length * 15));
  if (!strips.length) { prep(cv); return; }
  drawStrips(cv, strips, {
    labelW: 170, days: st.days, cursor: st.frac,
    tipText: (fx, ri) => {
      const S = strips[ri].S, q = S.pts[Math.min(S.pts.length - 1, Math.round(fx * (S.pts.length - 1)))];
      return `${S.site.name}\n${fmtUTC(q.ms)}\nSun ${Math.round(q.frac * 100)}% visible · Earth ${q.eVis ? 'in view' : 'hidden'}`;
    },
  });
}

// ---------- launch slip ----------
function renderSlip() {
  $('slipSite').textContent = shortName(st.site.name);
  const slips = [[0, 'As planned'], [1, '+1 day'], [7, '+1 week'], [14, '+2 weeks'], [30, '+1 month']];
  const base = MAIN.m;
  const rows = slips.map(([d, l]) => ({ d, l, m: d === 0 ? base : metrics(series(st.site, st.t0 + d * DAY, st.days)) }));
  const dl = (v, b, goodUp) => {
    if (Math.abs(v - b) < 0.5) return '';
    const up = v > b;
    return ` <span class="${up === goodUp ? 'delta-up' : 'delta-down'}" aria-label="${up === goodUp ? 'better' : 'worse'}">${up ? '▲' : '▼'}</span>`;
  };
  $('slipTable').innerHTML = `<thead><tr><th>Landing</th><th>Call</th><th class="num">Sun</th><th class="num">Earth</th><th class="num">Night</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${r.l}<br><span class="sub mono">${fmtDate(st.t0 + r.d * DAY)}</span></td><td><span class="pill ${r.m.verdict.lvl}">${r.m.verdict.label}</span></td><td class="num">${r.m.sun.toFixed(0)}%${dl(r.m.sun, base.sun, true)}</td><td class="num">${r.m.earth.toFixed(0)}%${dl(r.m.earth, base.earth, true)}</td><td class="num">${fmtH(r.m.longestDark)}${dl(r.m.longestDark, base.longestDark, false)}</td></tr>`).join('') + '</tbody>';
}

// ---------- best landing day ----------
export function findBest() {
  const out = $('bestOut'); out.textContent = 'Scanning 60 landing days…';
  setTimeout(() => {
    const { res, best } = scanLandingDays(st.site, st.t0, st.days, 60);
    out.innerHTML = `Best day: <strong>${fmtDate(st.t0 + best.d * DAY)}</strong> (day +${best.d}) · ${best.m.sun.toFixed(0)}% sunlight, ${best.m.earth.toFixed(0)}% Earth in view, longest night ${fmtH(best.m.longestDark)}. <button id="useBest">Use this date</button>`;
    $('useBest').onclick = () => { st.t0 += best.d * DAY; st.frac = 0; renderAll(); };
    const cv = $('bestCv'); const { c, w, h } = prep(cv); const L = 40, B = 20, pw = w - L - 8, ph = h - B - 8;
    c.strokeStyle = css('--line'); c.fillStyle = css('--muted'); c.font = '11px "IBM Plex Mono", monospace';
    [0, 50, 100].forEach(v => {
      const y = 8 + ph * (1 - v / 100);
      c.globalAlpha = 0.6; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); c.globalAlpha = 1;
      c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(v + '%', L - 6, y);
    });
    const bw = pw / res.length;
    res.forEach((r, i) => {
      const y = 8 + ph * (1 - r.m.sun / 100);
      c.fillStyle = i === best.d ? css('--ink') : css('--sun');
      c.fillRect(L + i * bw + 1, y, Math.max(1, bw - 2), 8 + ph - y);
    });
    c.fillStyle = css('--muted'); c.textAlign = 'center'; c.textBaseline = 'top';
    [0, 15, 30, 45, 59].forEach(d => c.fillText('+' + d + 'd', L + (d + 0.5) * bw, h - B + 5));
    cv.onmousemove = e => {
      const rr = cv.getBoundingClientRect(), i = Math.floor((e.clientX - rr.left - L) / bw);
      if (i < 0 || i >= res.length) return hideTip();
      const r = res[i];
      showTip(e, `Land ${fmtDate(st.t0 + r.d * DAY)}\nSunlight ${r.m.sun.toFixed(0)}% · Earth ${r.m.earth.toFixed(0)}%\nLongest night ${fmtH(r.m.longestDark)}`);
    };
    cv.onmouseleave = hideTip;
  }, 20);
}

// ---------- lighting map (cast shadows from the DEM) ----------
let mapTimer = null;
function renderMapThrottled() {
  if (mapTimer) return;
  mapTimer = setTimeout(() => { mapTimer = null; renderMap(); }, st.playing ? 400 : 60);
}
export function renderMap() {
  const cv = $('mapCv'), c = cv.getContext('2d'), W = cv.width;
  if (!st.dem) {
    c.fillStyle = css('--bg'); c.fillRect(0, 0, W, W);
    c.fillStyle = css('--muted'); c.font = '14px "IBM Plex Sans", sans-serif'; c.textAlign = 'center';
    c.fillText('Load LOLA terrain to see live shadows', W / 2, W / 2 - 8); c.fillText('at the south pole', W / 2, W / 2 + 12);
    return;
  }
  const rad = st.mapRad, kpp = 2 * rad / W, e = eph(tCur());
  const sn = Math.hypot(...e.sun), s = e.sun.map(v => v / sn);
  let dX = s[1], dY = s[0]; const dn = Math.hypot(dX, dY); dX /= dn; dY /= dn; // Sun direction in map plane
  const img = c.createImageData(W, W), px = img.data;
  const hexRgb = hx => { const m = hx.replace('#', ''); return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16)); };
  const lit = hexRgb(css('--sun-soft') || '#f6d79a'), dark = hexRgb(css('--shadow') || '#2a3442');
  const maxD = Math.min(120, rad * 1.5);
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const X = (i - W / 2 + 0.5) * kpp, Y = (W / 2 - j - 0.5) * kpp, h0 = demH(X, Y), o = (j * W + i) * 4;
      if (isNaN(h0)) { px[o + 3] = 0; continue; }
      const [la, lo] = mapToLL(X, Y), cl = Math.cos(la * D2R);
      const el = Math.asin(cl * Math.cos(lo * D2R) * s[0] + cl * Math.sin(lo * D2R) * s[1] + Math.sin(la * D2R) * s[2]);
      let shadow = el < -SUN_R * D2R;
      if (!shadow) {
        const te = Math.tan(el);
        for (let d = kpp; d < maxD; d += Math.max(kpp, d * 0.06)) {
          const hh = demH(X + dX * d, Y + dY * d);
          if (isNaN(hh)) break;
          if ((hh - h0) / 1000 - d * d / (2 * RM) > d * te) { shadow = true; break; }
        }
      }
      // relief shading so topography reads in both lit and shadowed areas
      const k = kpp * 0.7;
      const gx = (demH(X + k, Y) - demH(X - k, Y)) / (2 * k * 1000), gy = (demH(X, Y + k) - demH(X, Y - k)) / (2 * k * 1000);
      let rel = 0.75 + 0.9 * (-gx * 0.6 + gy * 0.6) / Math.sqrt(1 + gx * gx + gy * gy);
      if (!(rel >= 0)) rel = 0.75;
      rel = Math.max(0.35, Math.min(1.25, rel));
      const col = shadow ? dark : lit, f = shadow ? 0.6 + 0.5 * (rel - 0.35) : rel;
      px[o] = Math.min(255, col[0] * f); px[o + 1] = Math.min(255, col[1] * f); px[o + 2] = Math.min(255, col[2] * f); px[o + 3] = 255;
    }
  }
  c.clearRect(0, 0, W, W); c.putImageData(img, 0, 0);

  c.font = '600 11px "IBM Plex Sans", sans-serif'; c.textBaseline = 'middle';
  const toPx = (lat, lon) => { const [X, Y] = llToMap(lat, lon); return [W / 2 + X / kpp, W / 2 - Y / kpp]; };
  [...SITES, CUSTOM].filter(s2 => s2.lat < -80 && (s2 !== CUSTOM || st.site === CUSTOM)).forEach(s2 => {
    const [x, y] = toPx(s2.lat, s2.lon);
    if (x < 0 || y < 0 || x > W || y > W) return;
    const sel = s2 === st.site;
    c.beginPath(); c.arc(x, y, sel ? 6 : 4, 0, 7); c.fillStyle = sel ? css('--accent') : '#ffffff'; c.fill();
    c.lineWidth = 2; c.strokeStyle = '#000'; c.stroke();
    if (sel || rad >= 80) {
      c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 3;
      const t = shortName(s2.name); c.textAlign = x > W - 120 ? 'right' : 'left';
      const tx = x + (c.textAlign === 'left' ? 9 : -9); c.strokeText(t, tx, y); c.fillText(t, tx, y);
    }
  });
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath();
  c.moveTo(W / 2 + dX * W * 0.42, W / 2 - dY * W * 0.42); c.lineTo(W / 2 + dX * W * 0.48, W / 2 - dY * W * 0.48); c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = '600 12px "IBM Plex Sans", sans-serif'; c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 3;
  const sx = W / 2 + dX * W * 0.44, sy = W / 2 - dY * W * 0.44 - 12;
  c.strokeText('☀ Sun', sx, sy); c.fillText('☀ Sun', sx, sy);
  const sb = rad >= 80 ? 50 : 10;
  c.fillRect(14, W - 20, sb / kpp, 4); c.textAlign = 'left'; c.strokeText(sb + ' km', 14, W - 30); c.fillText(sb + ' km', 14, W - 30);
  c.textAlign = 'center'; c.strokeText('0°', W / 2, 12); c.fillText('0°', W / 2, 12);
}
