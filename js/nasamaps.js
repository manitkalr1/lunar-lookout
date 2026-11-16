// NASA's official long-term illumination maps, used as an external check.
//
// Values are read from two LOLA team products on NASA PGDA
// (https://pgda.gsfc.nasa.gov/products/69, Mazarico et al. 2011, updated 2016):
//   AVGVISIB_75S_120M_201608.TIF        average fraction of the Sun visible
//   AVGVISIB_75S_120M_201608_EARTH.TIF  average fraction of time Earth is visible
// Both are averages over an 18.6-year lunar nutation cycle at hourly steps, at
// the surface, polar stereographic at 120 m per pixel (scale 4e-5 per unit).
// For each site: the nearest-pixel value, and the min/max over the 3 x 3 pixels
// around it (±120 m) because values change sharply across ridges and rims.
// All values are percentages.
// Regenerate with: python3 tools/extract-nasa-illumination.py <folder with the two TIFs>
export const NASA_ILLUM = {
  'ridge': { sun: 67.7, sunMin: 51.0, sunMax: 84.7, earth: 52.3, earthMin: 44.3, earthMax: 58.2 },
  'cabeusb': { sun: 56.1, sunMin: 32.5, sunMax: 61.5, earth: 67.3, earthMin: 31.5, earthMax: 99.5 },
  'a-haworth': { sun: 44.6, sunMin: 38.8, sunMax: 59.4, earth: 63.3, earthMin: 59.6, earthMax: 71.9 },
  'malapert': { sun: 60.1, sunMin: 38.9, sunMax: 65.8, earth: 77.8, earthMin: 54.9, earthMax: 100.0 },
  'moutonplat': { sun: 54.2, sunMin: 47.5, sunMax: 54.2, earth: 100.0, earthMin: 92.9, earthMax: 100.0 },
  'mouton': { sun: 39.2, sunMin: 39.2, sunMax: 67.7, earth: 47.0, earthMin: 47.0, earthMax: 72.7 },
  'nobile1': { sun: 70.5, sunMin: 54.6, sunMax: 83.5, earth: 62.3, earthMin: 43.0, earthMax: 70.5 },
  'nobile2': { sun: 50.5, sunMin: 49.0, sunMax: 53.2, earth: 65.2, earthMin: 59.2, earthMax: 79.5 },
  'degerlache2': { sun: 42.0, sunMin: 39.1, sunMax: 45.3, earth: 56.7, earthMin: 56.5, earthMax: 56.9 },
  'slater': { sun: 56.0, sunMin: 52.2, sunMax: 58.6, earth: 29.7, earthMin: 7.6, earthMax: 48.9 },
  'pole': { sun: 37.7, sunMin: 26.1, sunMax: 38.8, earth: 55.2, earthMin: 55.0, earthMax: 55.3 },
  'degerlache': { sun: 17.8, sunMin: 17.8, sunMax: 53.1, earth: 35.2, earthMin: 35.2, earthMax: 58.7 },
  'shackfloor': { sun: 0.0, sunMin: 0.0, sunMax: 0.0, earth: 0.0, earthMin: 0.0, earthMax: 0.0 },
  'haworth': { sun: 0.0, sunMin: 0.0, sunMax: 0.0, earth: 3.5, earthMin: 2.1, earthMax: 5.3 },
  'im2': { sun: 46.4, sunMin: 42.9, sunMax: 47.0, earth: 91.4, earthMin: 79.4, earthMax: 93.3 },
};

// Our side of the comparison: the same 18.6-year span, 6-hour steps, observer at the surface.
export const NASA_SPAN = { start: Date.UTC(2009, 6, 13), years: 18.6, stepHours: 6 };

import { HOUR, st } from './state.js';
import { frame } from './ephemeris.js';
import { horizonFor } from './terrain.js';
import { sample } from './analysis.js';

export const NASA_TOL = 4;   // percentage points outside NASA's ±120 m range still counted as agreeing

/** Our 18.6-year average sunlight and Earth visibility at a site (needs the DEM). */
export function longTermAverages(site) {
  const keep = st.mast; st.mast = 0;
  try {
    const H = horizonFor(site), f = frame(site.lat, site.lon, H.h0 / 1000);
    const step = NASA_SPAN.stepHours * HOUR, n = Math.round(NASA_SPAN.years * 365.25 * 24 / NASA_SPAN.stepHours);
    // NASA counts Earth visible if any part of its disk shows (PGDA product notes);
    // Earth's disk is ~0.95° in radius from the Moon. The rest of the app uses
    // Earth's centre, which is more conservative for radio planning.
    const EARTH_R = 0.95;
    let s = 0, e = 0;
    for (let i = 0; i < n; i++) { const q = sample(site, H, f, NASA_SPAN.start + i * step); s += q.frac; e += q.eEl + EARTH_R > q.eHz ? 1 : 0; }
    return { sun: 100 * s / n, earth: 100 * e / n };
  } finally { st.mast = keep; }
}

/** Compare one site with NASA's maps. */
export function compareWithNasa(site) {
  const ref = NASA_ILLUM[site.id]; if (!ref) return null;
  const ours = longTermAverages(site);
  const within = (v, lo, hi) => v >= lo - NASA_TOL && v <= hi + NASA_TOL;
  return { site, ref, ours, sunOk: within(ours.sun, ref.sunMin, ref.sunMax), earthOk: within(ours.earth, ref.earthMin, ref.earthMax) };
}
