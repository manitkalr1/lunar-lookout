// Lunar Lookout Mission advisor proxy (Cloudflare Worker).
//
// The public site cannot hold a secret, so this Worker keeps the Gemini API key
// (a Cloudflare secret named GEMINI_API_KEY) and forwards chat requests to
// Gemini. It only accepts the Lunar Lookout site as caller, caps request sizes,
// fixes the model and output length, and rate-limits each connection.
// Deploy steps: worker/README.md.

const DEFAULT_ORIGINS = 'https://manitkalr1.github.io,null,http://localhost:8000';
const LIMITS = { systemChars: 40000, turns: 24, turnChars: 4000, maxOutputTokens: 1024 };
const hits = new Map();   // per-connection request times (best effort, per Worker instance)

/** Validate and rebuild the request body so callers cannot change the model's settings. */
export function sanitize(b) {
  if (!b || typeof b !== 'object') return { error: 'Bad request.' };
  const sys = b.systemInstruction && b.systemInstruction.parts && b.systemInstruction.parts[0] && b.systemInstruction.parts[0].text;
  if (typeof sys !== 'string' || sys.length > LIMITS.systemChars) return { error: 'Bad request (instructions missing or too long).' };
  if (!Array.isArray(b.contents) || !b.contents.length || b.contents.length > LIMITS.turns) return { error: 'Bad request (conversation missing or too long).' };
  const contents = [];
  for (const c of b.contents) {
    const text = c && c.parts && c.parts[0] && c.parts[0].text;
    if ((c.role !== 'user' && c.role !== 'model') || typeof text !== 'string' || !text.trim() || text.length > LIMITS.turnChars)
      return { error: 'Bad request (a message is empty or too long).' };
    contents.push({ role: c.role, parts: [{ text }] });
  }
  if (contents[contents.length - 1].role !== 'user') return { error: 'Bad request (last message must be a question).' };
  return { body: { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.4, maxOutputTokens: LIMITS.maxOutputTokens } } };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { lunarLookoutError: 'Use POST.' });
    if (!allowed.includes(origin)) return reply(403, { lunarLookoutError: 'This advisor only answers the Lunar Lookout site.' });
    if (!env.GEMINI_API_KEY) return reply(500, { lunarLookoutError: 'The advisor is not set up yet (the GEMINI_API_KEY secret is missing).' });

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now(), windowMs = 10 * 60e3, limit = Number(env.RATE_LIMIT_PER_10_MIN || 20);
    const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (recent.length >= limit) return reply(429, { lunarLookoutError: 'Too many questions from this connection. Please wait a few minutes.' });
    recent.push(now); hits.set(ip, recent);
    if (hits.size > 5000) hits.clear();

    let raw;
    try { raw = await request.json(); } catch (e) { return reply(400, { lunarLookoutError: 'Bad request.' }); }
    const clean = sanitize(raw);
    if (clean.error) return reply(400, { lunarLookoutError: clean.error });

    const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(clean.body),
      });
    } catch (e) {
      return reply(502, { lunarLookoutError: 'The advisor could not reach Gemini. Please try again.' });
    }
    return new Response(await res.text(), { status: res.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
