// Candidate landing sites. Coordinates are approximate: verify in LROC Quickmap
// (https://quickmap.lroc.asu.edu/) before quoting them.
export const SITES = [
  { id: 'ridge', g: 'South pole', name: 'Connecting ridge (Shackleton–de Gerlache)', lat: -89.45, lon: -137.31 },
  { id: 'pole', g: 'South pole', name: 'South Pole, Shackleton rim', lat: -89.95, lon: 0 },
  { id: 'malapert', g: 'South pole', name: 'Malapert massif (Artemis III region)', lat: -86.0, lon: 2.9 },
  { id: 'mouton', g: 'South pole', name: 'Mons Mouton, IM-2 landing area', lat: -84.79, lon: 29.19 },
  { id: 'degerlache', g: 'South pole', name: 'de Gerlache crater rim', lat: -89.0, lon: -87.1 },
  { id: 'shackfloor', g: 'South pole', name: 'Shackleton crater floor (permanent shadow)', lat: -89.67, lon: 129.78 },
  { id: 'haworth', g: 'South pole', name: 'Haworth crater floor (permanent shadow)', lat: -87.45, lon: -4.98 },
  { id: 'vikram', g: 'Other missions', name: 'Chandrayaan-3 Vikram', lat: -69.37, lon: 32.32 },
  { id: 'ce4', g: 'Other missions', name: "Chang'e-4 (far side)", lat: -45.444, lon: 177.588 },
  { id: 'ce6', g: 'Other missions', name: "Chang'e-6 (far side)", lat: -41.625, lon: -153.978 },
  { id: 'a11', g: 'Apollo', name: 'Apollo 11', lat: 0.674, lon: 23.473 },
  { id: 'a15', g: 'Apollo', name: 'Apollo 15', lat: 26.132, lon: 3.634 },
];

export const CUSTOM = { id: 'custom', g: 'Custom', name: 'Custom coordinates', lat: -89.0, lon: 0 };

export const siteById = id => (id === 'custom' ? CUSTOM : SITES.find(s => s.id === id));
export const shortName = n => n.split(/[(,]/)[0].trim().slice(0, 22);
