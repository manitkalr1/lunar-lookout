// App entry: builds the controls and wires events.
import { HOUR, st } from './state.js';
import { SITES, CUSTOM, siteById } from './sites.js';
import { loadDEM, cacheDEM, restoreDEM, clearHorizonCache, mapToLL } from './terrain.js';
import { renderAll, renderNow, renderCompare, renderMap, findBest } from './render.js';
import { initFeatures, applyHash } from './features.js';

const $ = id => document.getElementById(id);

function setDemStatus(text, ok) {
  $('demStatus').textContent = text;
  $('terrainChip').innerHTML = `<span class="dot ${ok ? 'on' : 'off'}"></span><span>Terrain: ${ok ? 'LOLA ' + st.dem.scale + ' m' : 'smooth Moon'}</span>`;
}

async function handleFile(file) {
  if (!file) return;
  setDemStatus(`Reading ${file.name}…`, false);
  const buf = await file.arrayBuffer();
  const r = loadDEM(buf, file.name);
  setDemStatus(r.message, r.ok);
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
    const la = +$('latIn').value, lo = +$('lonIn').value;
    if (isNaN(la) || isNaN(lo) || la < -90 || la > 90) return;
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
    eb.textContent = 'Explain mode: ' + (on ? 'on' : 'off'); eb.setAttribute('aria-pressed', on);
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
  renderAll();
  loadInitialTerrain();
}

// Terrain on startup: a file the user dropped earlier (e.g. the 40 m DEM) wins,
// otherwise the bundled NASA LOLA 240 m south-pole DEM in data/.
const BUNDLED = 'data/LDEM_75S_240M.IMG';
async function loadInitialTerrain() {
  const saved = await restoreDEM();
  if (saved) {
    const r = loadDEM(saved.buf, saved.name);
    setDemStatus(r.message, r.ok);
    if (r.ok) return renderAll();
  }
  try {
    setDemStatus('Loading NASA LOLA terrain (29 MB)…', false);
    const res = await fetch(BUNDLED);
    if (!res.ok) throw new Error(res.status);
    const total = +res.headers.get('content-length') || 29062688;
    const prog = $('demProg'); prog.hidden = false;
    const buf = new Uint8Array(total); let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > buf.length) throw new Error('size');
      buf.set(value, got); got += value.length;
      prog.value = got / total;
      setDemStatus(`Loading NASA LOLA terrain… ${Math.round(100 * got / total)}%`, false);
    }
    prog.hidden = true;
    const r = loadDEM(buf.buffer.slice(0, got), 'LDEM_75S_240M.IMG');
    setDemStatus(r.message, r.ok);
    if (r.ok) renderAll();
  } catch (e) {
    setDemStatus(`Could not load ${BUNDLED}. Drop the LOLA file here instead. Until then, results use a smooth Moon.`, false);
  }
}

if (globalThis.Astronomy) init();
else document.querySelector('.wrap').insertAdjacentHTML('afterbegin', '<div class="panel">The ephemeris library did not load. Reload the page.</div>');
