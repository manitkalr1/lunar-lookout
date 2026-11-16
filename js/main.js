// App entry: builds the controls and wires events.
import { HOUR, st } from './state.js';
import { SITES, CUSTOM, siteById } from './sites.js';
import { loadDEM, cacheDEM, restoreDEM, deleteDEM, clearHorizonCache, mapToLL } from './terrain.js';
import { renderAll, renderNow, renderCompare, renderMap, findBest } from './render.js';
import { initFeatures, applyHash } from './features.js';
import { initIntro } from './intro.js';

const $ = id => document.getElementById(id);

/**
 * Terrain status for the panel and the header chip.
 * state: 'ok' (loaded), 'loading' (pct 0-100), or 'off' (no terrain).
 */
function setDemStatus(text, state, pct) {
  $('demStatus').textContent = text;
  st.demLoading = state === 'loading';
  st.demPct = state === 'loading' ? (pct || 0) : null;
  const chip = state === 'ok' ? `Terrain: LOLA ${st.dem.scale} m` : state === 'loading' ? `Terrain: loading ${Math.round(pct || 0)}%` : 'Terrain: smooth Moon';
  $('terrainChip').innerHTML = `<span class="dot ${state === 'ok' ? 'on' : 'off'}"></span><span>${chip}</span>`;
}

async function handleFile(file) {
  if (!file) return;
  setDemStatus(`Reading ${file.name}…`, 'loading', 0);
  const buf = await file.arrayBuffer();
  const r = loadDEM(buf, file.name);
  setDemStatus(r.message, r.ok ? 'ok' : (st.dem ? 'ok' : 'off'));
  if (r.ok) { renderAll(); cacheDEM(buf, file.name); }
}

function init() {
  st.site = SITES[0];
  applyHash();  // a shared link can preset site, date and settings

  const sel = $('siteSel');
  const groups = {};
  [...SITES, CUSTOM].forEach(s => { (groups[s.g] ||= []).push(s); });
  sel.innerHTML = Object.entries(groups)
    .map(([g, ss]) => `<optgroup label="${g}">${ss.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</optgroup>`).join('');
  sel.onchange = () => { st.site = siteById(sel.value); st.frac = 0; renderAll(); };

  const setCustom = () => {
    const lv = $('latIn').value.trim(), ov = $('lonIn').value.trim();
    const la = Number(lv), lo = Number(ov), msg = $('coordMsg');
    let err = '';
    if (lv === '' || !Number.isFinite(la) || la < -90 || la > 90) err = 'Latitude must be between −90 and 90.';
    else if (ov === '' || !Number.isFinite(lo) || lo < -180 || lo > 360) err = 'Longitude must be between −180 and 180 (or 0 to 360).';
    msg.textContent = err;
    $('latIn').setAttribute('aria-invalid', String(err.startsWith('Lat')));
    $('lonIn').setAttribute('aria-invalid', String(err.startsWith('Lon')));
    if (err) return;
    CUSTOM.lat = Math.max(-89.99, la); CUSTOM.lon = lo > 180 ? lo - 360 : lo;
    st.site = CUSTOM; renderAll();
  };
  $('latIn').onchange = setCustom;
  $('lonIn').onchange = setCustom;

  $('dateIn').onchange = e => {
    const v = e.target.value; if (!v) return;
    const ms = Date.parse(v + ':00Z');
    if (!isNaN(ms)) { st.t0 = Math.floor(ms / HOUR) * HOUR; st.frac = 0; renderAll(); }
  };
  $('durSel').onchange = e => { st.days = +e.target.value; renderAll(); };
  $('mastIn').onchange = e => { st.mast = Math.max(0, Math.min(50, +e.target.value || 0)); clearHorizonCache(); renderAll(); };
  const power = () => {
    st.arrayW = Math.max(0, +$('arrayIn').value || 0);
    st.loadW = Math.max(1, +$('loadIn').value || 1);
    st.battKWh = Math.max(0.1, +$('battIn').value || 0.1);
    renderAll();
  };
  ['arrayIn', 'loadIn', 'battIn'].forEach(id => ($(id).onchange = power));

  $('addCmp').onclick = () => {
    if (st.site === CUSTOM) {
      const id = 'c' + Date.now();
      SITES.push({ id, g: 'Custom', name: `Custom ${CUSTOM.lat.toFixed(2)}°, ${CUSTOM.lon.toFixed(2)}°`, lat: CUSTOM.lat, lon: CUSTOM.lon });
      st.compare.push(id);
    } else if (!st.compare.includes(st.site.id)) st.compare.push(st.site.id);
    if (st.compare.length > 5) st.compare.shift();
    renderCompare();
  };

  $('tSlider').oninput = e => { st.frac = e.target.value / 1000; renderNow(); };
  const play = $('playBtn');
  const loop = () => {
    if (!st.playing) return;
    st.frac += 1 / (st.days * 12); if (st.frac > 1) st.frac = 0;
    renderNow(); requestAnimationFrame(loop);
  };
  play.onclick = () => {
    st.playing = !st.playing;
    play.textContent = st.playing ? 'Pause' : 'Play';
    play.setAttribute('aria-pressed', st.playing);
    if (st.playing) loop();
  };

  $('bestBtn').onclick = findBest;
  const eb = $('explainBtn');
  eb.onclick = () => {
    const on = document.body.classList.toggle('explain-on');
    eb.textContent = on ? 'Hide explanations' : 'Explain'; eb.setAttribute('aria-pressed', on);
  };

  $('mapRad').onchange = e => { st.mapRad = +e.target.value; renderMap(); };
  $('mapCv').onclick = e => {
    if (!st.dem) return;
    const cv = e.currentTarget, r = cv.getBoundingClientRect(), W = cv.width, kpp = 2 * st.mapRad / W;
    const X = ((e.clientX - r.left) / r.width * W - W / 2) * kpp, Y = (W / 2 - (e.clientY - r.top) / r.height * W) * kpp;
    const [la, lo] = mapToLL(X, Y);
    CUSTOM.lat = +la.toFixed(3); CUSTOM.lon = +lo.toFixed(3); st.site = CUSTOM; renderAll();
  };

  const drop = $('drop');
  $('demFile').onchange = e => handleFile(e.target.files[0]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('hot'); };
  drop.ondragleave = () => drop.classList.remove('hot');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('hot'); handleFile(e.dataTransfer.files[0]); };

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 150); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', renderAll);

  initFeatures();

  // Title screen: start, quick-jump buttons, and skip it for shared links.
  const toPlanner = (focus) => {
    $('scenario').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (focus) setTimeout(() => $('siteSel').focus({ preventScroll: true }), 400);
  };
  $('startBtn').onclick = () => toPlanner(true);
  document.querySelectorAll('.quick-b').forEach(b => (b.onclick = () => { st.site = siteById(b.dataset.site); st.frac = 0; renderAll(); toPlanner(false); }));
  if (/=/.test(location.hash)) requestAnimationFrame(() => $('scenario').scrollIntoView({ block: 'start' }));
  initIntro();

  st.demLoading = true;            // terrain download starts right after the first render
  setDemStatus('Loading NASA LOLA terrain…', 'loading', 0);
  renderAll();
  loadInitialTerrain();
}

// Terrain on startup: a file the user dropped earlier (e.g. the 40 m DEM) wins,
// otherwise the bundled NASA LOLA 240 m south-pole DEM in data/.
const BUNDLED = 'data/LDEM_75S_240M.IMG';
const BUNDLED_BYTES = 29062688;   // 3812 × 3812 × 2 bytes

/**
 * Download the bundled DEM. Never trusts content-length: GitHub Pages serves the
 * file gzip-compressed, so that header is the compressed size while the browser
 * hands us the decompressed bytes. Chunks are collected and joined at the end.
 */
async function download(onProgress) {
  const res = await fetch(BUNDLED);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress(Math.min(100, 100 * got / BUNDLED_BYTES));
    }
    buf = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
  } else {
    buf = new Uint8Array(await res.arrayBuffer());   // older browsers: no streaming
  }
  if (buf.byteLength !== BUNDLED_BYTES) throw new Error(`got ${buf.byteLength} bytes, expected ${BUNDLED_BYTES}`);
  return buf.buffer;
}

async function loadInitialTerrain() {
  const saved = await restoreDEM();
  if (saved) {
    const r = loadDEM(saved.buf, saved.name);
    if (r.ok) { setDemStatus(r.message, 'ok'); return renderAll(); }
    await deleteDEM();               // stale or corrupt copy: drop it and download fresh
  }
  const prog = $('demProg');
  const onProgress = pct => {
    prog.hidden = false; prog.value = pct / 100;
    setDemStatus(`Loading NASA LOLA terrain… ${Math.round(pct)}%`, 'loading', pct);
  };
  onProgress(0);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {   // one automatic retry
    try {
      const buf = await download(onProgress);
      const r = loadDEM(buf, 'LDEM_75S_240M.IMG');
      prog.hidden = true;
      if (!r.ok) throw new Error(r.message);
      setDemStatus(r.message, 'ok');
      renderAll();
      cacheDEM(buf, 'LDEM_75S_240M.IMG');   // next visit loads instantly
      return;
    } catch (e) { lastErr = e; }
  }
  prog.hidden = true;
  setDemStatus(`Could not load NASA terrain (${lastErr && lastErr.message}). Reload the page to try again, or drop the LOLA file here. Until then, results assume a smooth Moon.`, 'off');
  renderAll();
}

if (globalThis.Astronomy) init();
else document.querySelector('.wrap').insertAdjacentHTML('afterbegin', '<div class="panel">The ephemeris library did not load. Reload the page.</div>');
