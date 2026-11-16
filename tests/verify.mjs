// Run with: npm test
// Checks the geometry against independent references. No browser needed.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('astronomy-engine');
const A = globalThis.Astronomy;

const { st, R2D, D2R, RM, DAY, HOUR } = await import('../js/state.js');
const { eph, frame, topo } = await import('../js/ephemeris.js');
const T = await import('../js/terrain.js');
const { series, metrics } = await import('../js/analysis.js');

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fails++; };
const latlon = v => { const n = Math.hypot(...v); return [Math.asin(v[2] / n) * R2D, Math.atan2(v[1], v[0]) * R2D]; };

// 1. Sub-Earth point vs astronomy-engine's independent physical libration model (Meeus).
{
  let worst = 0;
  for (let i = 0; i < 60; i++) {
    const ms = Date.UTC(2026, 0, 1) + i * 6.1 * DAY;
    const [lat, lon] = latlon(eph(ms).earth);
    const L = A.Libration(new Date(ms));
    let dlon = lon - L.elon; dlon = ((dlon + 540) % 360) - 180;
    worst = Math.max(worst, Math.abs(lat - L.elat), Math.abs(dlon));
  }
  check('Sub-Earth point matches independent libration model', worst < 0.1, `worst difference ${worst.toFixed(3)}°`);
}

// 2. Sub-solar latitude never exceeds the Moon's 1.54° axial tilt.
{
  let mx = 0;
  for (let i = 0; i < 400; i++) mx = Math.max(mx, Math.abs(latlon(eph(Date.UTC(2026, 0, 1) + i * DAY).sun)[0]));
  check('Sub-solar latitude stays within ±1.6°', mx < 1.6 && mx > 1.4, `max ${mx.toFixed(2)}°`);
}

// 3. Earth from the near-side centre is near the zenith; from far side it is below the horizon.
{
  const ms = Date.UTC(2026, 5, 1);
  const near = topo(frame(0, 0, 0), eph(ms).earth).el;
  const far = topo(frame(0, 180, 0), eph(ms).earth).el;
  check('Earth high in the sky at near-side centre', near > 80, `${near.toFixed(1)}°`);
  check('Earth below horizon on far side', far < -80, `${far.toFixed(1)}°`);
}

// 4. Smooth-Moon mission metrics are sensible at the pole and on the far side.
{
  st.dem = null; st.mast = 2;
  const pole = metrics(series({ lat: -89.45, lon: -137.31 }, Date.UTC(2026, 0, 1), 30));
  const ce4 = metrics(series({ lat: -45.444, lon: 177.588 }, Date.UTC(2026, 0, 1), 30));
  const a11 = metrics(series({ lat: 0.674, lon: 23.473 }, Date.UTC(2026, 0, 1), 30));
  check("Chang'e-4 (far side) never sees Earth", ce4.earth === 0, `${ce4.earth.toFixed(0)}%`);
  check('Apollo 11 always sees Earth', a11.earth === 100, `${a11.earth.toFixed(0)}%`);
  check('Apollo 11 gets about half sunlight', Math.abs(a11.sun - 50) < 8, `${a11.sun.toFixed(0)}%`);
  check('Smooth-Moon pole ridge is mostly sunlit', pole.sun > 60, `${pole.sun.toFixed(0)}%`);
}

// 4b. Power model: a 14-day equatorial night drains a 72 h battery; the
//     battery dies after exactly capacity / load hours of darkness.
{
  st.dem = null; st.mast = 2; st.arrayW = 450; st.loadW = 120; st.battKWh = 8.6;
  const m = metrics(series({ lat: 0.674, lon: 23.473 }, Date.UTC(2026, 0, 1), 30));
  check('Apollo 11 site: battery runs flat during the 14-day lunar night', m.deadH > 200, `${m.deadH} h without power`);
  check('…so the Landing Site Score power part is zero', m.score.power === 0, `score ${m.score.total}`);
  st.arrayW = 0;   // no solar array at all: dies after 8600 Wh / 120 W = 71.7 h
  const z = metrics(series({ lat: 0.674, lon: 23.473 }, Date.UTC(2026, 0, 1), 14));
  check('Battery lasts capacity / load hours', Math.abs(z.firstDeadDay * 24 - 72) <= 1, `${(z.firstDeadDay * 24).toFixed(0)} h (expected 72)`);
  st.arrayW = 450;
}

// 5. Terrain ray tracer against an analytic case: synthetic DEM, flat at 0 m
//    with a 2000 m high ring 20 km from the pole. From the pole, the horizon
//    elevation should be atan((2 km - curvature drop) / 20 km).
{
  const scale = 240, n = 1001, data = new Int16Array(n * n);
  const off = n / 2 - 0.5;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const X = (c - off) * scale / 1000, Y = (off - r) * scale / 1000, d = Math.hypot(X, Y);
    data[r * n + c] = d > 19.5 && d < 21.5 ? 4000 : 0;   // 4000 DN × 0.5 = 2000 m
  }
  const name = 'LDEM_75S_240M.IMG';
  const loaded = T.loadDEM(data.buffer, name);
  check('Synthetic DEM loads', loaded.ok, loaded.message.split('.')[0]);
  st.mast = 0;
  const H = T.horizonFor({ lat: -89.999, lon: 0 });
  const d = 19.5, expect = Math.atan2((RM + 2) * Math.cos(d / RM) - RM, (RM + 2) * Math.sin(d / RM)) * R2D;
  let worst = 0;
  for (let k = 0; k < 720; k += 10) worst = Math.max(worst, Math.abs(H.hz[k] - expect));
  check('Horizon from a 2 km wall at 20 km matches geometry', worst < 0.25, `expected ${expect.toFixed(2)}°, worst error ${worst.toFixed(3)}°`);

  // With the wall blocking everything below ~5.7°, the pole site sees no Sun.
  const m = metrics(series({ lat: -89.999, lon: 0 }, Date.UTC(2026, 0, 1), 30));
  check('Walled-in pole site gets no sunlight', m.sun === 0, `${m.sun.toFixed(1)}%`);
  check('…and is called NO-GO', m.verdict.lvl === 'nogo', m.verdict.label);
  st.dem = null;
}

// 5b. Regression: on top of a 2 km peak the horizon must dip below level
//     (terrain falls away at the 3.8° slope).
{
  const scale = 240, n = 1001, data = new Int16Array(n * n), off = n / 2 - 0.5;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const X = (c - off) * scale / 1000, Y = (off - r) * scale / 1000, d = Math.hypot(X, Y);
    data[r * n + c] = Math.round(4000 * Math.max(0, 1 - d / 30));   // 2000 m cone, 30 km radius (slope 3.8°)
  }
  T.loadDEM(data.buffer, 'LDEM_75S_240M.IMG');
  st.mast = 0;
  const H = T.horizonFor({ lat: -89.999, lon: 0 });
  const mx = Math.max(...H.hz);
  check('Horizon from a peak dips below level', mx < -0.5, `highest horizon ${mx.toFixed(2)}°`);
  st.dem = null;
}

// 6. Bad file names / sizes are rejected cleanly.
{
  const r = T.loadDEM(new ArrayBuffer(10), 'random.img');
  check('Rejects a non-LOLA file', !r.ok);
}

// 7. Forecast wording rules (spec: sunny ≥ 0.99, partly 0.05–0.99, dark < 0.05)
{
  const F = await import('../js/forecast.js');
  const v = { label: 'GO' }, H = 3600e3;
  const line = F.forecastLine({ frac: 1, eVis: false, eEl: 2 }, { ms: 30 * H, from: 0, now: true }, { ms: 44 * H, from: 0, now: false }, v);
  check('Forecast line reads like a weather report', line === '☀️ Sunny, sunset in 30.0 h · 🌍 Earth hidden behind terrain, Earthrise in 44.0 h · Mission call: GO', line);
  check('Partly sunny shows the visible share', F.sunWord(0.4).text.startsWith('Partly sunny (40%'), F.sunWord(0.4).text);
  check('Below 5% of the disk is Dark', F.sunWord(0.04).text === 'Dark');
  check('Short tooltip forecast', F.shortForecast({ frac: 1, eVis: true }, v) === '☀️ 🌍 GO');
}

// 8. JPL Horizons reference values (hard-coded from the Horizons API)
{
  const { horizonsChecks, TOL_AZ, TOL_EL } = await import('../js/horizons.js');
  for (const h of horizonsChecks())
    check(`${h.label}`, h.ok, `Δaz ${h.dAz.toFixed(4)}° (tol ${TOL_AZ}), Δel ${h.dEl.toFixed(4)}° (tol ${TOL_EL})`);
}

// 9. The single-file build used when index.html is opened from disk is up to date.
{
  const { buildBundle } = await import('../tools/build-local.mjs');
  const { readFileSync } = await import('node:fs');
  let committed = ''; try { committed = readFileSync(new URL('../dist/lunar-lookout.js', import.meta.url), 'utf8'); } catch (e) { /* missing */ }
  check('dist/lunar-lookout.js matches the current source (run `npm run build` if not)', committed === await buildBundle());
}

// 10. Mission advisor (Gemini chatbot): request shape, reply parsing, safety, errors
{
  const C = await import('../js/chat.js');
  const ctx = { site: { name: 'Test site' }, missionResults: { call: 'GO' } };
  const req = C.buildRequest([{ role: 'user', text: 'Why GO?' }], ctx);
  check('Chat request carries the system prompt and the current app state', req.systemInstruction.parts[0].text.includes('Mission advisor') && req.systemInstruction.parts[0].text.includes('"Test site"'));
  check('Chat request uses Gemini roles and caps output', req.contents[0].role === 'user' && req.contents[0].parts[0].text === 'Why GO?' && req.generationConfig.maxOutputTokens === 1024);
  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 'm' + i }));
  check('Chat history is trimmed to the last 12 turns', C.buildRequest(long, ctx).contents.length === 12);
  check('Reads a normal Gemini reply', C.readReply({ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'Moon' }] }, finishReason: 'STOP' }] }).text === 'Hello Moon');
  check('Skips Gemini thought parts', C.readReply({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'shown' }] } }] }).text === 'shown');
  check('Explains a blocked prompt', /declined/.test(C.readReply({ promptFeedback: { blockReason: 'SAFETY' } }).error));
  check('Explains a safety stop with no text', /SAFETY/.test(C.readReply({ candidates: [{ finishReason: 'SAFETY' }] }).error));
  const html = C.formatReply('**Bold** and <script>alert(1)</script>\n- item <img src=x onerror=alert(1)>');
  check('Reply formatting escapes HTML (no script injection)', !/<script|<img/.test(html) && html.includes('<strong>Bold</strong>') && html.includes('<li>'));
  const fakeFetch = (status, body) => async (url, opts) => ({ ok: status < 400, status, json: async () => body, _url: url, _opts: opts });
  let seen;
  const spy = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) }; };
  const r1 = await C.ask([{ role: 'user', text: 'hi' }], ctx, { fetchImpl: spy, proxyUrl: '', key: 'TESTKEY', model: 'gemini-3.8-flash' });
  check('Own-key mode calls Gemini generateContent with the key', r1.text === 'ok' && seen.url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=TESTKEY'));
  await C.ask([{ role: 'user', text: 'hi' }], ctx, { fetchImpl: spy, proxyUrl: 'https://proxy.example/chat', key: 'TESTKEY' });
  check('Proxy mode never sends the key from the browser', seen.url === 'https://proxy.example/chat' && !JSON.stringify(seen.opts).includes('TESTKEY'));
  check('Bad key gives a clear message', /not accepted/.test((await C.ask([{ role: 'user', text: 'hi' }], ctx, { fetchImpl: fakeFetch(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }), proxyUrl: '', key: 'x' })).error));
  check('Quota limit gives a clear message', /Too many/.test((await C.ask([{ role: 'user', text: 'hi' }], ctx, { fetchImpl: fakeFetch(429, {}), proxyUrl: '', key: 'x' })).error));
  check('Network failure gives a clear message', /Could not reach/.test((await C.ask([{ role: 'user', text: 'hi' }], ctx, { fetchImpl: async () => { throw new TypeError('fail'); }, proxyUrl: '', key: 'x' })).error));
  check('No key and no proxy asks for setup', /No Gemini connection/.test((await C.ask([{ role: 'user', text: 'hi' }], ctx, { proxyUrl: '', key: '' })).error));
}

// 11. Mission advisor proxy (Cloudflare Worker), with Gemini mocked
{
  const W = (await import('../worker/src/index.js')).default;
  const env = { GEMINI_API_KEY: 'SECRET-KEY', ALLOWED_ORIGINS: 'https://manitkalr1.github.io,null' };
  const realFetch = globalThis.fetch; let upstream;
  globalThis.fetch = async (url, opts) => { upstream = { url, opts }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] }), { status: 200 }); };
  const good = { systemInstruction: { parts: [{ text: 'sys' }] }, contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 999999, temperature: 2 } };
  const call = (origin, body, extra = {}) => W.fetch(new Request('https://w.example/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': extra.ip || '1.2.3.4' }, body: JSON.stringify(body) }), extra.env || env);
  try {
    const ok = await call('https://manitkalr1.github.io', good);
    const okJson = await ok.json();
    const sent = JSON.parse(upstream.opts.body);
    check('Worker forwards to Gemini with the secret key in a header', ok.status === 200 && okJson.candidates[0].content.parts[0].text === 'from gemini' && upstream.opts.headers['x-goog-api-key'] === 'SECRET-KEY' && !upstream.url.includes('SECRET'));
    check('Worker fixes output length and temperature (caller cannot raise them)', sent.generationConfig.maxOutputTokens === 1024 && sent.generationConfig.temperature === 0.4);
    check('Worker sends CORS for the Lunar Lookout site', ok.headers.get('Access-Control-Allow-Origin') === 'https://manitkalr1.github.io');
    check('Worker refuses other websites', (await call('https://evil.example', good)).status === 403);
    check('Worker allows a downloaded copy (file://, Origin null)', (await call('null', good, { ip: '5.5.5.5' })).status === 200);
    check('Worker rejects oversized messages', (await call('https://manitkalr1.github.io', { ...good, contents: [{ role: 'user', parts: [{ text: 'x'.repeat(5000) }] }] }, { ip: '6.6.6.6' })).status === 400);
    check('Worker rejects a conversation that does not end with a question', (await call('https://manitkalr1.github.io', { ...good, contents: [{ role: 'model', parts: [{ text: 'hi' }] }] }, { ip: '7.7.7.7' })).status === 400);
    check('Worker explains a missing key secret', (await (await call('https://manitkalr1.github.io', good, { env: { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS }, ip: '8.8.8.8' })).json()).lunarLookoutError.includes('GEMINI_API_KEY'));
    let last; for (let i = 0; i < 21; i++) last = await call('https://manitkalr1.github.io', good, { ip: '9.9.9.9' });
    check('Worker rate-limits one connection (20 per 10 minutes)', last.status === 429);
    const pre = await W.fetch(new Request('https://w.example/chat', { method: 'OPTIONS', headers: { Origin: 'https://manitkalr1.github.io' } }), env);
    check('Worker answers the browser preflight', pre.status === 204 && pre.headers.get('Access-Control-Allow-Methods').includes('POST'));
  } finally { globalThis.fetch = realFetch; }
}

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
