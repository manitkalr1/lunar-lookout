# Lunar Lookout

**NASA Space Apps 2026 · Challenge: Lunar Landing Site Navigator**

Pick a lunar landing site and a date. Lunar Lookout shows where the **Sun** (power) and **Earth** (direct communication) sit relative to the site's real terrain horizon. It also tells you how long sunlight and Earth contact last over the mission.

## Features

- **Horizon view**: the 360° terrain outline with the Sun and Earth paths over the whole mission, plus a time slider and Play button
- **Mission readiness**: a GO / CAUTION / NO-GO call based on your lander's battery, % sunlight, % Earth in view, the longest night, and countdowns to the next sunset or Earthset
- **Hour-by-hour timeline** of sunlight, Earth contact, and both together
- **Site comparison**: up to 5 sites side by side for the same landing time
- **Launch-slip analysis**: what a +1 day, +1 week, +2 weeks or +1 month delay changes
- **Best landing day finder**: scans the next 60 days
- **Live south-pole lighting map**: cast shadows from LOLA terrain; click the map to pick any spot
- **Explain mode**: plain-language notes for students and the public

## Run it

It's a static site with no build step. Browsers block ES modules on `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

To deploy, push to GitHub, then go to **Settings → Pages**, choose the `main` branch and the `/ (root)` folder, and click **Save**.

## Real NASA terrain (built in)

The app ships with NASA's **LRO LOLA** south-pole elevation model `data/LDEM_75S_240M.IMG` (240 m/pixel, 3812×3812, 29 MB) and loads it on startup. The status panel confirms it with a built-in check: *Shackleton floor sits 4.0 km below its rim ✓*.

For sharper detail within 5° of the pole, drop `LDEM_85S_40M.IMG` (115 MB, from the [LOLA polar GDR archive](https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/)) onto the terrain panel. Your browser remembers it for next time.

### Results on real terrain vs published science

These are one-year results from 1 Jan 2026, with a 2 m mast. Run `npm run test:real` to reproduce them.

| Site | Sunlight | Earth in view | Longest night | Published reference |
|---|---|---|---|---|
| Connecting ridge | 83% | 51% | 6 days | ~80–90%, nights of days (Mazarico et al. 2011) |
| de Gerlache rim | 54% | 51% | 15 days | |
| Mons Mouton | 46% | 81% | 17 days | |
| Malapert massif | 41% | 66% | 20 days | Malapert peak ~5 km high ✓ |
| Shackleton floor | 0% | 0% | whole year | Permanently shadowed ✓ |
| Haworth floor | 0% | 0% | whole year | Permanently shadowed ✓ |

Shackleton depth from the DEM is 4.0 km (published value: ~4.2 km, Zuber et al. 2012).

## How it works

| Step | Method | Code |
|---|---|---|
| Sun and Earth positions | astronomy-engine (VSOP87 / ELP-based, ~1′ accuracy) | `js/ephemeris.js` |
| Moon orientation | IAU/WGCCRE rotation model, which matches LOLA's Mean-Earth frame to well under 0.1° | `js/ephemeris.js` |
| Azimuth / elevation | Local east-north-up frame at the site, including panel height | `js/ephemeris.js` |
| Terrain horizon | Ray-traced every 0.5° of azimuth out to 150 km on the LOLA polar stereographic DEM, including lunar curvature | `js/terrain.js` |
| Sunlight | Fraction of the 0.53° solar disk above the terrain horizon | `js/terrain.js` |
| Metrics and verdict | Hourly samples across the mission | `js/analysis.js` |
| Charts and map | Canvas 2D | `js/render.js` |

## Tests

```bash
npm install
npm test            # geometry checks against independent models
npm run test:real   # results on the real LOLA terrain vs published facts
```

The tests check:

- the sub-Earth point against astronomy-engine's independent libration model (agrees to within 0.03°)
- the Sun's latitude limit (±1.54° axial tilt)
- near-side and far-side Earth visibility
- the terrain ray tracer against an analytic case (a 2 km wall 20 km away; within 0.1°)

## Data sources

- **LRO LOLA** `LDEM_75S_240M` polar elevation model (NASA PDS Geosciences Node / MIT imbrium mirror), bundled in `data/`
- **astronomy-engine** 2.1.19 (MIT licence), bundled in `vendor/`
- Landing-site coordinates are approximate. Verify them in [LROC Quickmap](https://quickmap.lroc.asu.edu/) before quoting.
- **JPL Horizons** can be used to spot-check Sun and Earth positions for any site and time.

## Limitations

- North of 75°S there is no terrain in the bundled file, so those sites (Apollo, Chang'e) use a smooth Moon.
- The 240 m DEM smooths out features smaller than a few pixels. The 40 m file is better for sites within 5° of the pole.
- Earth visibility uses the centre of Earth's disk, and sunlight ignores reflected light from nearby terrain.

## Team

_Add names and roles._
