import { HOUR } from './state.js';

export const fmtH = h => (h >= 48 ? (h / 24).toFixed(1) + ' d' : Math.round(h) + ' h');
export const pad = n => String(n).padStart(2, '0');
export const fmtUTC = ms => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
export const fmtDate = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const fmtDur = ms => {
  const h = ms / HOUR;
  return h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h.toFixed(1) + ' h' : (h / 24).toFixed(1) + ' days';
};
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
