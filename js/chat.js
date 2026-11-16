// Mission advisor: a Gemini-powered chat that answers questions about what is
// on screen. Every request carries a compact snapshot of the app's current
// state (site, dates, forecast, score, power simulation, checks), so answers
// use the app's own numbers.
//
// Two ways to reach Gemini:
//   1. CHAT_PROXY_URL (js/config.js): a Cloudflare Worker holds the API key.
//   2. The visitor's own key, kept in their browser only (localStorage).
import { DAY, st } from './state.js';
import { SITES } from './sites.js';
import { getMain } from './render.js';
import { nextChange } from './analysis.js';
import { NASA_ILLUM } from './nasamaps.js';
import { forecastLine } from './forecast.js';
import { CHAT_PROXY_URL, GEMINI_MODEL } from './config.js';

const KEY_STORE = 'lunar-lookout-gemini-key';
const MAX_TURNS = 12;          // history sent with each question (user + model messages)
const MAX_INPUT = 1000;        // characters per question

export const SYSTEM_PROMPT = `You are the Mission advisor inside Lunar Lookout, a web app built for the NASA Space Apps Challenge 2026 (challenge: Lunar Landing Site Navigator). Lunar Lookout is a student project, not an official NASA tool.

What the app does: the user picks a site near the Moon's south pole and a landing date. The app finds where the Sun and Earth are in that site's sky and whether the real terrain (NASA LRO LOLA laser-altimeter elevation data, 240 m per pixel) hides them. It then flies the mission hour by hour:
- Sunlight: the share of the Sun's disk above the terrain horizon. A vertical solar array that turns to face the Sun charges a battery.
- Battery: the lander draws constant power; if the battery runs flat, the lander loses power.
- Earth in view: Earth's centre is above the terrain horizon, meaning a clear line of sight for direct radio to Earth (not a full radio link budget).
- Landing Site Score (0-100) = power survival (40 points x lowest battery level, 0 if it ever runs flat) + communication (35 x share of time Earth is in view) + sunlight (25 x share of time the Sun is up). Calls: GO, CAUTION, NO-GO.
- The app also covers NASA's nine Artemis candidate landing regions (announced October 2024), finds the best landing days over the next 60 days, shows what a launch slip changes, and has a 3D terrain view and a shadow map.
- Validation: Sun and Earth positions agree with NASA JPL Horizons to about 0.003 degrees at four reference points, and the app's 18.6-year averages agree with NASA's official LOLA illumination and Earth-visibility maps at 15 of 15 sites.
Background facts: at the south pole the Sun never rises more than about 1.5-2 degrees above level and circles the horizon once a month; crater floors such as Shackleton's are permanently shadowed, which is why water ice can survive there.

How to answer:
- Use the "Current app state" JSON below for anything about the selected site, dates or results. Quote its numbers and units. Never invent numbers that are not in it.
- If the answer is not in the state, say so briefly and point to the part of the app that shows it (for example the Compare sites table, the launch-slip table, the 3D view or "How we know it's right").
- If "terrain" says the real terrain is not loaded, warn that the numbers assume a smooth Moon.
- Write for a curious student: plain words, short sentences, explain any jargon. Keep answers to about 2-5 sentences or a short list unless the user asks for more.
- Times are UTC. Do not give mission or safety advice beyond what the app's model shows, and do not claim NASA endorses the results.
- Only discuss Lunar Lookout, the Moon, lunar exploration and related science. Politely decline unrelated requests.`;

// ---------------------------------------------------------------- app state
const r1 = v => Math.round(v * 10) / 10;
const iso = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** Compact, JSON-safe snapshot of what the user is looking at. */
export function buildContext({ getWindowsSummary } = {}) {
  const S = getMain();
  if (!S || !S.m) return { note: 'The app is still starting up.' };
  const m = S.m, t = st.t0 + st.frac * st.days * DAY;
  const i = Math.min(S.pts.length - 1, Math.round(st.frac * (S.pts.length - 1)));
  const now = S.pts[i];
  const sc = nextChange(S, t, 'sun'), ec = nextChange(S, t, 'earth');
  sc.from = ec.from = t;
  const nasa = NASA_ILLUM[S.site.id];
  const ctx = {
    site: { name: S.site.name, latitude: S.site.lat, longitudeEast: S.site.lon, artemisRegion: !!S.site.artemis },
    terrain: S.H.terrain ? `NASA LOLA ${st.dem.scale} m terrain loaded` : (S.site.lat <= -75.3 ? 'real terrain NOT loaded yet: results assume a smooth Moon' : 'site is outside the south-pole terrain file: smooth Moon used'),
    mission: { landing: iso(st.t0), lengthDays: st.days, timeShownOnSlider: iso(t) },
    lander: { solarArrayW: st.arrayW, powerDrawW: st.loadW, batteryKWh: st.battKWh, mastHeightM: st.mast, hoursOnBatteryInDarkness: r1(st.battKWh * 1000 / st.loadW) },
    forecastNow: forecastLine(now, sc, ec, m.verdict),
    now: {
      sunAboveTerrainDeg: Math.round((now.sEl - now.sHz) * 100) / 100, sunDiskVisiblePct: Math.round(now.frac * 100),
      earthAboveTerrainDeg: Math.round((now.eEl - now.eHz) * 100) / 100, earthInView: now.eVis,
      batteryPct: Math.round((S.soc ? S.soc[i] : 0) * 100),
    },
    missionResults: {
      call: m.verdict.label, reasons: m.verdict.why,
      score: { total: m.score.total, powerOf40: r1(m.score.power), communicationOf35: r1(m.score.comms), sunlightOf25: r1(m.score.light) },
      sunlightPct: r1(m.sun), earthInViewPct: r1(m.earth), sunAndEarthTogetherPct: r1(m.both),
      longestNightHours: r1(m.longestDark), longestEarthBlackoutHours: r1(m.longestNoEarth),
      lowestBatteryPct: Math.round(m.minSoc * 100), batteryFlatHours: r1(m.deadH),
      batteryRunsFlatOnDay: m.firstDeadDay == null ? null : r1(m.firstDeadDay),
      highestSunAboveTerrainDeg: Math.round(m.maxSun * 100) / 100,
    },
    nasaLongTermAverageHere: nasa ? { sunlightPct: nasa.sun, earthVisibilityPct: nasa.earth, note: '18.6-year averages from NASA LOLA maps' } : null,
  };
  const w = getWindowsSummary && getWindowsSummary();
  if (w) ctx.bestLandingDaysNext60 = w;
  ctx.sitesInApp = SITES.filter(s => s.g !== 'Custom').map(s => s.name);
  return ctx;
}

// ---------------------------------------------------------------- Gemini
/** Request body for Gemini generateContent. history: [{role:'user'|'model', text}] */
export function buildRequest(history, context) {
  return {
    systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\nCurrent app state (JSON):\n${JSON.stringify(context)}` }] },
    contents: history.slice(-MAX_TURNS).map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
  };
}

/** Pull the reply text out of a Gemini response, or explain why there is none. */
export function readReply(json) {
  if (json && json.promptFeedback && json.promptFeedback.blockReason)
    return { error: `Gemini declined this question (${json.promptFeedback.blockReason}). Try rephrasing it.` };
  const cand = json && json.candidates && json.candidates[0];
  const text = cand && cand.content && Array.isArray(cand.content.parts)
    ? cand.content.parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('') : '';
  if (text.trim()) return { text: text.trim(), truncated: cand.finishReason === 'MAX_TOKENS' };
  if (cand && cand.finishReason && cand.finishReason !== 'STOP') return { error: `Gemini stopped without an answer (${cand.finishReason}). Try rephrasing the question.` };
  return { error: 'Gemini sent an empty answer. Please try again.' };
}

function friendlyHttpError(status, body) {
  const msg = (body && body.error && body.error.message) || '';
  if (status === 400 && /api key/i.test(msg)) return 'That Gemini API key was not accepted. Check it, or use "Change key" to enter it again.';
  if (status === 400) return `Gemini could not process the request (${msg || 'bad request'}).`;
  if (status === 401 || status === 403) return 'The Gemini API key is not allowed to make this request. Check that the Generative Language API is enabled for it.';
  if (status === 404) return `The Gemini model was not found (${msg || 'not found'}). The model name in js/config.js may need updating.`;
  if (status === 429) return 'Too many questions right now (rate limit or daily quota reached). Wait a minute and try again.';
  if (status >= 500) return 'Gemini is having trouble right now. Please try again in a moment.';
  return `Request failed (HTTP ${status}).`;
}

export function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
export function setKey(k) { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch (e) { /* storage blocked */ } }
export const mode = () => (CHAT_PROXY_URL ? 'proxy' : getKey() ? 'key' : 'none');

/** Ask Gemini. Returns {text} or {error}. fetchImpl is injectable for tests. */
export async function ask(history, context, { fetchImpl = fetch, proxyUrl = CHAT_PROXY_URL, key = getKey(), model = GEMINI_MODEL, signal } = {}) {
  const body = JSON.stringify(buildRequest(history, context));
  let url, headers = { 'Content-Type': 'application/json' };
  if (proxyUrl) url = proxyUrl;
  else if (key) url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  else return { error: 'No Gemini connection is set up yet.' };
  let res;
  try { res = await fetchImpl(url, { method: 'POST', headers, body, signal }); }
  catch (e) { return { error: e && e.name === 'AbortError' ? 'Stopped.' : 'Could not reach Gemini. Check your internet connection and try again.' }; }
  let json = null;
  try { json = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) return { error: (json && json.lunarLookoutError) || friendlyHttpError(res.status, json) };
  return readReply(json);
}

// ---------------------------------------------------------------- rendering
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Minimal, safe formatting: escape everything, then allow **bold**, `code` and "- " lists. */
export function formatReply(text) {
  const lines = escapeHtml(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const li = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

// ---------------------------------------------------------------- UI
const SUGGESTIONS = [
  'Why did this site get its call?',
  'When does the Sun set here next?',
  'Which Artemis region looks best right now?',
  'Explain the Landing Site Score simply.',
];

export function initChat({ getWindowsSummary }) {
  const $ = id => document.getElementById(id);
  const panel = $('chatPanel'), launch = $('chatLaunch'), log = $('chatLog'), form = $('chatForm'), input = $('chatInput');
  const setup = $('chatSetup'), sendBtn = $('chatSend');
  if (!panel) return;
  const history = [];
  let busy = null;

  const refreshMode = () => {
    const md = mode();
    setup.hidden = md !== 'none';
    form.hidden = md === 'none';
    $('chatSugg').hidden = md === 'none' || history.length > 0;
    $('chatKeyBtn').hidden = md !== 'key';
    $('chatMode').textContent = md === 'proxy' ? 'Powered by Gemini' : md === 'key' ? 'Powered by Gemini · your key' : 'Powered by Gemini';
  };
  const open = (yes) => {
    panel.hidden = !yes; launch.setAttribute('aria-expanded', String(yes));
    if (yes) { refreshMode(); setTimeout(() => (mode() === 'none' ? $('chatKeyIn') : input).focus(), 50); }
    else launch.focus();
  };
  const add = (role, html, cls = '') => {
    const div = document.createElement('div');
    div.className = `msg ${role} ${cls}`.trim();
    div.innerHTML = html;
    log.appendChild(div); log.scrollTop = log.scrollHeight;
    return div;
  };

  async function send(text) {
    text = text.trim().slice(0, MAX_INPUT);
    if (!text || busy) return;
    $('chatSugg').hidden = true;
    add('user', `<p>${escapeHtml(text)}</p>`);
    history.push({ role: 'user', text });
    const wait = add('model', '<p class="typing" aria-label="Thinking"><span></span><span></span><span></span></p>', 'pending');
    busy = new AbortController(); sendBtn.disabled = true; input.value = '';
    const reply = await ask(history, buildContext({ getWindowsSummary }), { signal: busy.signal });
    busy = null; sendBtn.disabled = false;
    wait.classList.remove('pending');
    if (reply.error) {
      history.pop();   // let the user retry the same question
      wait.classList.add('error'); wait.innerHTML = `<p>${escapeHtml(reply.error)}</p>`;
    } else {
      history.push({ role: 'model', text: reply.text });
      wait.innerHTML = formatReply(reply.text) + (reply.truncated ? '<p class="sub">(Answer cut short.)</p>' : '');
    }
    log.scrollTop = log.scrollHeight;
    input.focus();
  }

  launch.onclick = () => open(panel.hidden);
  $('chatClose').onclick = () => open(false);
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
  form.onsubmit = e => { e.preventDefault(); send(input.value); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
  $('chatSugg').innerHTML = SUGGESTIONS.map(q => `<button type="button" class="sugg">${escapeHtml(q)}</button>`).join('');
  $('chatSugg').querySelectorAll('.sugg').forEach(b => (b.onclick = () => send(b.textContent)));
  $('chatKeyForm').onsubmit = e => {
    e.preventDefault();
    const k = $('chatKeyIn').value.trim();
    if (!k) return;
    setKey(k); $('chatKeyIn').value = ''; refreshMode(); input.focus();
  };
  $('chatKeyBtn').onclick = () => { setKey(''); refreshMode(); $('chatKeyIn').focus(); };
  refreshMode();
}
