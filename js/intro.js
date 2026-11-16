// Title screen animation: the real horizon at the connecting ridge (NASA LOLA
// terrain) with the Sun and Earth on their true paths, sped up so one lunar
// day takes about a minute. The camera follows the Sun, so the terrain scrolls.
import { DAY, st } from './state.js';
import { eph, frame, topo } from './ephemeris.js';
import { horizonFor, hzAt } from './terrain.js';
import { SITES } from './sites.js';
import { fmtUTC } from './format.js';

const SYNODIC = 29.530589 * DAY;
const LOOP_MS = 60000;                 // one lunar day per minute of animation
const SPEED = SYNODIC / LOOP_MS;       // ≈ 42,500×
const SPAN = 140;                      // degrees of horizon across the screen
const STEP = 10 * 60e3;                // ephemeris quantised to 10 min (keeps the cache small)

let cv, ctx, caption, site, f, hz = null, hzKey = '', running = false, visible = true, t0Real = 0;
let camAz = null;
const stars = [];

function seedStars() {
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 520; i++) stars.push({ az: rnd() * 360, el: 0.3 + rnd() * 22, r: rnd() < 0.08 ? 1.4 : 0.8, a: 0.35 + rnd() * 0.6 });
}

const wrap = d => ((d % 360) + 540) % 360 - 180;

function draw(now) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Terrain horizon appears as soon as NASA LOLA data is loaded.
  if (st.dem && hzKey !== st.dem.name) { hz = horizonFor(site).hz; hzKey = st.dem.name; f = frame(site.lat, site.lon, (horizonFor(site).h0 + st.mast) / 1000); }
  const tSim = Math.floor((st.t0 + ((now - t0Real) * SPEED) % SYNODIC) / STEP) * STEP;
  const e = eph(tSim), sun = topo(f, e.sun), earth = topo(f, e.earth);
  // Smoothly follow the Sun's azimuth.
  if (camAz === null) camAz = sun.az; else camAz += wrap(sun.az - camAz) * 0.08;

  const pxDeg = W / SPAN, k = Math.min(H * 0.07, 44);   // horizontal px/deg, vertical px/deg (exaggerated)
  const y0 = H * 0.66;
  const cx = W > 820 ? W * 0.7 : W * 0.5;            // keep the Sun clear of the text on wide screens
  const X = az => cx + wrap(az - camAz) * pxDeg;
  const Y = el => y0 - el * k;

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#02040a'); sky.addColorStop(1, '#0b1220');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  for (const s of stars) {
    const x = X(s.az); if (x < -2 || x > W + 2) continue;
    ctx.globalAlpha = s.a; ctx.fillStyle = '#dfe6f0';
    ctx.fillRect(x, Y(s.el), s.r, s.r);
  }
  ctx.globalAlpha = 1;

  // Earth: a small blue disk, true size ~1.9°, drawn a little larger to be readable.
  const ex = X(earth.az);
  if (ex > -40 && ex < W + 40) {
    const r = Math.max(9, 0.95 * k * 0.9);
    const g = ctx.createRadialGradient(ex - r * 0.3, Y(earth.el) - r * 0.3, r * 0.1, ex, Y(earth.el), r);
    g.addColorStop(0, '#9cc9f5'); g.addColorStop(0.6, '#2f7fd1'); g.addColorStop(1, '#173a63');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, Y(earth.el), r, 0, 7); ctx.fill();
  }
  // Sun with glare.
  const sx = X(sun.az), sy = Y(sun.el);
  const glare = ctx.createRadialGradient(sx, sy, 2, sx, sy, Math.min(W, H) * 0.35);
  glare.addColorStop(0, 'rgba(255,236,200,0.55)'); glare.addColorStop(0.08, 'rgba(255,214,150,0.22)'); glare.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = glare; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fffaf0'; ctx.shadowColor = 'rgba(255,220,160,.9)'; ctx.shadowBlur = 24;
  ctx.beginPath(); ctx.arc(sx, sy, Math.max(8, 0.27 * k), 0, 7); ctx.fill(); ctx.shadowBlur = 0;

  // Terrain silhouette on top, so it hides the Sun and Earth when they set.
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W + 2; x += 2) {
    const az = camAz + (x - cx) / pxDeg;
    const el = hz ? hzAt(hz, ((az % 360) + 360) % 360) : -0.09;
    ctx.lineTo(x, Y(el));
  }
  ctx.lineTo(W, H); ctx.closePath();
  const ground = ctx.createLinearGradient(0, y0 - 2 * k, 0, H);
  ground.addColorStop(0, '#3a4350'); ground.addColorStop(0.35, '#1c222b'); ground.addColorStop(1, '#0a0d12');
  ctx.fillStyle = ground; ctx.fill();
  // Low sunlight catches the ridgeline: brighter rim on the side facing the Sun.
  const rim = ctx.createLinearGradient(sx - W * 0.6, 0, sx + W * 0.6, 0);
  rim.addColorStop(0, 'rgba(255,214,150,0.15)'); rim.addColorStop(0.5, 'rgba(255,226,180,0.85)'); rim.addColorStop(1, 'rgba(255,214,150,0.15)');
  ctx.strokeStyle = rim; ctx.lineWidth = 1.5; ctx.stroke();

  const lit = sun.el > (hz ? hzAt(hz, sun.az) : -0.09);
  caption.textContent = hz
    ? `Live: the real horizon at the connecting ridge from NASA LOLA terrain. ${fmtUTC(tSim)}, sped up about 40,000×. ${lit ? 'Sun up' : 'Sun behind the hills'} · ${earth.el > hzAt(hz, earth.az) ? 'Earth in view' : 'Earth hidden'}.`
    : `Loading NASA terrain${st.demPct != null ? ` ${Math.round(st.demPct)}%` : ''}…`;
}

function loop(now) {
  if (!running) return;
  draw(now);
  requestAnimationFrame(loop);
}

export function initIntro() {
  cv = document.getElementById('introCv'); caption = document.getElementById('introCaption');
  if (!cv || !cv.getContext) return;
  ctx = cv.getContext('2d');
  site = SITES.find(s => s.id === 'ridge');
  f = frame(site.lat, site.lon, st.mast / 1000);
  seedStars();
  t0Real = performance.now();
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => {
    const want = visible && !still.matches && !document.hidden;
    if (want && !running) { running = true; requestAnimationFrame(loop); }
    if (!want) { running = false; draw(performance.now()); }
  };
  new IntersectionObserver(es => { visible = es.some(x => x.isIntersecting); update(); }).observe(cv);
  document.addEventListener('visibilitychange', update);
  still.addEventListener?.('change', update);
  addEventListener('resize', () => { if (!running) draw(performance.now()); });
  // Redraw once terrain arrives even when not animating.
  const waitDem = setInterval(() => { if (!running) draw(performance.now()); if (st.dem) clearInterval(waitDem); }, 500);
  update();
}
