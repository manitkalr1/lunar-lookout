// Shared constants and app state.
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const RM = 1737.4;            // Moon reference radius, km (LOLA datum)
export const AU = 149597870.7;       // km
export const SUN_R = 0.2666;         // apparent solar radius seen from the Moon, degrees
export const HOUR = 3600e3;
export const DAY = 86400e3;

export const st = {
  site: null,
  t0: Math.floor(Date.now() / HOUR) * HOUR, // landing time, ms UTC
  frac: 0,           // slider position within the mission, 0..1
  days: 30,          // mission length
  mast: 2,           // panel / antenna height above ground, m
  arrayW: 450,       // solar array output in full sunlight, W
  loadW: 120,        // average power draw, W
  battKWh: 8.6,      // usable battery capacity, kWh (8.6 kWh / 120 W = ~72 h of darkness)
  compare: ['ridge', 'malapert', 'mouton', 'degerlache'],
  dem: null,         // loaded LOLA DEM, see terrain.js
  playing: false,
  mapRad: 170,       // lighting map half-width, km
};
