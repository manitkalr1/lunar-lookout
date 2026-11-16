// Cross-check against NASA JPL Horizons.
//
// The app is static, so Horizons is not called from the browser. Reference
// values were fetched once with the Horizons API and are hard-coded here.
// Each entry keeps its exact query so anyone can re-run it.
//
// Query shape (observer table, airless apparent az/el, azimuth clockwise from north):
//   https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'
//     &CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='222.69,-89.45,0'
//     &MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&START_TIME='2027-01-01'
//     &STOP_TIME='2027-01-02'&STEP_SIZE='1d'&QUANTITIES='4'
// COMMAND '10' = Sun, '399' = Earth. SITE_COORD = 'east lon, lat, altitude km'
// on the 1737.4 km reference sphere.
//
// To add a reference: run the query, copy the first row's Azi/Elev, and add an
// entry below with the date it was pulled.
import { frame, topo, eph } from './ephemeris.js';

export const HORIZONS_REFS = [
  {
    label: 'Sun position vs JPL Horizons (Connecting Ridge, 1 Jan 2027)',
    body: 'sun', lat: -89.45, lonE: 222.69, utc: '2027-01-01T00:00:00Z',
    az: 40.433291, el: 1.432576, pulled: '2026-11-14',
    query: "COMMAND='10'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='222.69,-89.45,0'&START_TIME='2027-01-01'&STOP_TIME='2027-01-02'&STEP_SIZE='1d'&QUANTITIES='4'",
  },
  // Still to pull with the same query shape (see README):
  //   Earth (COMMAND='399') at Connecting Ridge, 2027-01-01 00:00 UTC
  //   Sun at Malapert (SITE_COORD='2.9,-86.0,0'), 2027-01-01 00:00 UTC
  //   Sun at Connecting Ridge, 2027-07-01 00:00 UTC
];

export const TOL_AZ = 0.3, TOL_EL = 0.05;   // degrees

/** App az/el for each reference, at height 0 on the smooth sphere (same geometry as Horizons). */
export function horizonsChecks() {
  return HORIZONS_REFS.map(r => {
    const f = frame(r.lat, r.lonE > 180 ? r.lonE - 360 : r.lonE, 0);
    const t = topo(f, eph(Date.parse(r.utc))[r.body]);
    let dAz = t.az - r.az; dAz = ((dAz + 540) % 360) - 180;
    const dEl = t.el - r.el;
    return { ...r, appAz: t.az, appEl: t.el, dAz, dEl, ok: Math.abs(dAz) < TOL_AZ && Math.abs(dEl) < TOL_EL };
  });
}
