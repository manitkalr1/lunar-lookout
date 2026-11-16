// Candidate landing sites. Coordinates are approximate: verify in LROC Quickmap
// (https://quickmap.lroc.im-ldi.com/) before quoting them.
// NASA's nine Artemis candidate landing regions (announced 28 Oct 2024).
// NASA published them only as outlines on a map. Region centres come from
// Team AFUQ's digitisation of that map (github.com/ziyadell/Lunar-Landing-Site-Navigator,
// MIT licence, ~0.5 km accuracy). The point used for each region is our own:
// the best-lit spot with slope ≤ 10° within 4 km of the centre, on NASA LOLA
// terrain over 2027 (tools/find-region-points.mjs). It is a representative
// analysis point, not a NASA-designated landing site.
const ARTEMIS = [
  { id: 'cabeusb', name: 'Peak near Cabeus B', lat: -83.592, lon: -68.46, centre: [-83.641, -68.765] },
  { id: 'a-haworth', name: 'Haworth', lat: -86.769, lon: -20.588, centre: [-86.772, -22.815] },
  { id: 'malapert', name: 'Malapert Massif', lat: -85.992, lon: 0.254, centre: [-85.992, -0.217] },
  { id: 'moutonplat', name: 'Mons Mouton Plateau', lat: -84.279, lon: 29.918, centre: [-84.333, 30.622] },
  { id: 'mouton', name: 'Mons Mouton', lat: -85.481, lon: 31.399, centre: [-85.427, 31.713] },
  { id: 'nobile1', name: 'Nobile Rim 1', lat: -85.543, lon: 37.586, centre: [-85.435, 37.321] },
  { id: 'nobile2', name: 'Nobile Rim 2', lat: -84.043, lon: 59.286, centre: [-83.958, 58.854] },
  { id: 'degerlache2', name: 'de Gerlache Rim 2', lat: -88.31, lon: -62.095, centre: [-88.236, -64.546] },
  { id: 'slater', name: 'Slater Plain', lat: -87.223, lon: 127.309, centre: [-87.163, 125.568] },
].map(s => ({ ...s, g: 'NASA Artemis candidate regions', artemis: true, name: s.name + ' (Artemis region)' }));

export const SITES = [
  { id: 'ridge', g: 'South pole', name: 'Connecting ridge (Shackleton–de Gerlache)', lat: -89.45, lon: -137.31 },
  ...ARTEMIS,
  { id: 'pole', g: 'South pole', name: 'South Pole, Shackleton rim', lat: -89.95, lon: 0 },
  { id: 'degerlache', g: 'South pole', name: 'de Gerlache crater rim', lat: -89.0, lon: -87.1 },
  { id: 'shackfloor', g: 'South pole', name: 'Shackleton crater floor (permanent shadow)', lat: -89.67, lon: 129.78 },
  { id: 'haworth', g: 'South pole', name: 'Haworth crater floor (permanent shadow)', lat: -87.45, lon: -4.98 },
  { id: 'im2', g: 'Other missions', name: 'IM-2 Athena landing area, Mons Mouton', lat: -84.79, lon: 29.19 },
  { id: 'vikram', g: 'Other missions', name: 'Chandrayaan-3 Vikram', lat: -69.37, lon: 32.32 },
  { id: 'ce4', g: 'Other missions', name: "Chang'e-4 (far side)", lat: -45.444, lon: 177.588 },
  { id: 'ce6', g: 'Other missions', name: "Chang'e-6 (far side)", lat: -41.625, lon: -153.978 },
  { id: 'a11', g: 'Apollo', name: 'Apollo 11', lat: 0.674, lon: 23.473 },
  { id: 'a15', g: 'Apollo', name: 'Apollo 15', lat: 26.132, lon: 3.634 },
];

export const CUSTOM = { id: 'custom', g: 'Custom', name: 'Custom coordinates', lat: -89.0, lon: 0 };

export const siteById = id => (id === 'custom' ? CUSTOM : SITES.find(s => s.id === id));
export const shortName = n => n.split(/[(,]/)[0].trim().slice(0, 22);
