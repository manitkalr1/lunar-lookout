// "Lunar weather" wording: one plain-language line built only from numbers the
// app already computes (current sample, next Sun/Earth change, verdict).
import { HOUR } from './state.js';
import { fmtDur } from './format.js';

const SUN_FULL = 0.99, SUN_DARK = 0.05;

export function sunWord(frac) {
  if (frac >= SUN_FULL) return { icon: '☀️', text: 'Sunny', state: 'sunny' };
  if (frac >= SUN_DARK) return { icon: '🌤️', text: `Partly sunny (${Math.round(frac * 100)}% of the Sun above the horizon)`, state: 'partly' };
  return { icon: '●', text: 'Dark', state: 'dark' };
}

const later = (chg, onWord, offWord, none) =>
  chg.ms ? `${chg.now ? onWord : offWord} in ${fmtDur(chg.ms - chg.from)}` : none(chg.now);

/** e.g. "☀️ Sunny, sunset in 87.0 h · 🌍 Earth hidden behind terrain, Earthrise in 44.0 h · Mission call: GO" */
export function forecastLine(now, sc, ec, verdict) {
  const s = sunWord(now.frac);
  const sunT = later(sc, 'sunset', 'sunrise', on => (on ? 'no sunset for 120+ days' : 'no sunrise for 120+ days'));
  const earthWhere = now.eVis ? 'Earth in view' : now.eEl > 0 ? 'Earth hidden behind terrain' : 'Earth below the horizon';
  const earthT = later(ec, 'Earthset', 'Earthrise', on => (on ? 'no Earthset for 120+ days' : 'no Earthrise for 120+ days'));
  return `${s.icon} ${s.text}, ${sunT} · 🌍 ${earthWhere}, ${earthT} · Mission call: ${verdict.label}`;
}

const about = ms => {
  const h = ms / HOUR;
  if (h < 1.5) return 'about an hour';
  if (h < 48) return `about ${Math.round(h)} hours`;
  return `about ${Math.round(h / 24)} days`;
};

/** Explain-mode sentence in plain words. */
export function explainLine(now, sc, ec) {
  const s = sunWord(now.frac).state;
  const power = s === 'sunny' ? 'The lander has sunlight for power right now'
    : s === 'partly' ? 'Only part of the Sun is above the horizon, so the solar panels make reduced power'
    : `The lander is in darkness and running on its battery${sc.ms ? `; the Sun returns in ${about(sc.ms - sc.from)}` : ''}`;
  let comms;
  if (now.eVis) comms = `${s === 'dark' ? ', but it' : ', and it'} can talk to Earth directly${ec.ms ? ` for ${about(ec.ms - ec.from)}` : ''}.`;
  else {
    const why = now.eEl > 0 ? 'mountains block the view of Earth' : 'Earth is below the horizon';
    comms = `${s === 'dark' ? ', and' : ', but'} ${why}, so it can't call home${ec.ms ? ` for ${about(ec.ms - ec.from)}` : ''}.`;
  }
  return power + comms;
}

/** Short form for tooltips: "☀️ 🌍 GO" (✕ marks Earth out of view). */
export function shortForecast(q, verdict) {
  return `${sunWord(q.frac).icon} ${q.eVis ? '🌍' : '🌍✕'} ${verdict.label}`;
}
