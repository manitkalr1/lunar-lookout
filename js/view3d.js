// 3D terrain around the selected site, built from the NASA LOLA DEM, with
// shadows cast from the real Sun position and markers for the Sun and Earth.
// Loaded on demand (dynamic import) so the main page stays light.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { D2R, RM, SUN_R, st } from './state.js';
import { eph, frame, topo } from './ephemeris.js';
import { demH, llToMap, mapToLL, covered } from './terrain.js';

const N = 160;                 // grid cells per side
let renderer, scene, camera, controls, mesh, geo, lander, sunSpr, earthSpr, light, host, msgEl;
let cur = { key: null, R: 15, exag: 2, Xs: 0, Ys: 0, h0: 0 };
let raf = 0;

function glowSprite(color, label, size) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 110, 4, 128, 110, 90);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.18, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 220);
  g.font = '600 46px "IBM Plex Sans", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 6; g.strokeText(label, 128, 246); g.fillText(label, 128, 246);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(size, size, 1);
  return s;
}

function stars() {
  const n = 1500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * 2 * Math.PI, r = 400;
    pos[i * 3] = r * Math.sqrt(1 - u * u) * Math.cos(t); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * Math.sqrt(1 - u * u) * Math.sin(t);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false }));
}

export function init3D(el, status) {
  host = el; msgEl = status;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3D terrain view. Drag to orbit, scroll to zoom.');
  renderer.domElement.setAttribute('role', 'img');
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x05070a);
  scene.add(stars());
  camera = new THREE.PerspectiveCamera(50, 1, 0.002, 1000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;
  scene.add(new THREE.AmbientLight(0x6f7c92, 0.35));            // faint earthshine
  light = new THREE.DirectionalLight(0xfff4e0, 2.2); scene.add(light); scene.add(light.target);
  sunSpr = glowSprite('#ffcf66', 'Sun', 6); earthSpr = glowSprite('#5aa2ec', 'Earth', 6);
  scene.add(sunSpr, earthSpr);
  lander = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  pole.position.y = 0.3;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 16), new THREE.MeshBasicMaterial({ color: 0xff5a3c }));
  head.position.y = 0.75; head.rotation.x = Math.PI;
  lander.add(pole, head); scene.add(lander);
  new ResizeObserver(resize).observe(host);
  resize();
  const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
}

function resize() {
  const w = host.clientWidth, h = Math.max(300, Math.min(520, Math.round(w * 0.6)));
  renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

/** Height (km, curvature included) at offset x,y km from the site, in map coordinates. */
function hAt(x, y) {
  const v = demH(cur.Xs + x, cur.Ys + y);
  return isNaN(v) ? NaN : v / 1000 - (x * x + y * y) / (2 * RM);
}

function build() {
  const R = cur.R, n1 = N + 1, step = 2 * R / N;
  if (mesh) { scene.remove(mesh); geo.dispose(); }
  geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n1 * n1 * 3), col = new Float32Array(n1 * n1 * 3), idx = [];
  for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
    const x = -R + i * step, y = R - j * step, k = (j * n1 + i) * 3;
    let h = hAt(x, y); if (isNaN(h)) h = cur.h0;
    pos[k] = x; pos[k + 1] = (h - cur.h0) * cur.exag; pos[k + 2] = -y;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);
  lander.position.set(0, 0, 0);
  lander.scale.setScalar(R / 15);
  sunSpr.scale.setScalar(R * 0.5); earthSpr.scale.setScalar(R * 0.5);
  camera.position.set(R * 0.9, R * 0.55, R * 0.9);
  controls.target.set(0, 0, 0); controls.update();
}

/** Re-light the scene for time ms: cast shadows per vertex and move the Sun, Earth and light. */
function relight(ms) {
  const e = eph(ms);
  const sn = Math.hypot(...e.sun), s = e.sun.map(v => v / sn);
  let dX = s[1], dY = s[0]; const dn = Math.hypot(dX, dY); dX /= dn; dY /= dn;
  const R = cur.R, n1 = N + 1, step = 2 * R / N, col = geo.attributes.color.array, k2 = 2 * R / N;
  for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
    const x = -R + i * step, y = R - j * step, X = cur.Xs + x, Y = cur.Ys + y, k = (j * n1 + i) * 3;
    const h0 = demH(X, Y);
    let lit = 0;
    if (!isNaN(h0)) {
      const [la, lo] = mapToLL(X, Y), cl = Math.cos(la * D2R);
      const el = Math.asin(cl * Math.cos(lo * D2R) * s[0] + cl * Math.sin(lo * D2R) * s[1] + Math.sin(la * D2R) * s[2]);
      if (el > -SUN_R * D2R) {
        lit = 1; const te = Math.tan(el);
        for (let d = k2; d < 100; d += Math.max(k2, d * 0.05)) {
          const hh = demH(X + dX * d, Y + dY * d); if (isNaN(hh)) break;
          if ((hh - h0) / 1000 - d * d / (2 * RM) > d * te) { lit = 0; break; }
        }
      }
    }
    const g = lit ? 0.78 : 0.07;
    col[k] = g * 1.0; col[k + 1] = g * 0.97; col[k + 2] = g * 0.92;
  }
  geo.attributes.color.needsUpdate = true;
  // Sun and Earth directions as seen from the site; vertical exaggeration
  // is applied to the light too so the shadows stay geometrically consistent.
  const f = frame(st.site.lat, st.site.lon, (cur.h0 * 1000 + st.mast) / 1000);
  const place = (vec, spr, dist) => {
    const t = topo(f, vec), u = vec.map(v => v / Math.hypot(...vec));
    let ux = u[1], uy = u[0]; const un = Math.hypot(ux, uy) || 1; ux /= un; uy /= un;
    const dir = new THREE.Vector3(ux, Math.tan(t.el * D2R) * cur.exag, -uy).normalize();
    spr.position.copy(dir.clone().multiplyScalar(dist));
    return dir;
  };
  const sd = place(e.sun, sunSpr, R * 3.2);
  place(e.earth, earthSpr, R * 3.2);
  light.position.copy(sd.multiplyScalar(100)); light.target.position.set(0, 0, 0);
}

export function update3D(ms, force) {
  if (!renderer) return;
  const site = st.site;
  if (!st.dem || !covered(site)) {
    msgEl.textContent = st.dem ? '3D view covers the south pole only (south of 75.3°S). Pick a south-pole site.' : 'Waiting for NASA LOLA terrain…';
    if (mesh) mesh.visible = false; sunSpr.visible = earthSpr.visible = lander.visible = false;
    return;
  }
  const key = [site.lat, site.lon, cur.R, cur.exag, st.dem.name].join('|');
  if (key !== cur.key || force) {
    [cur.Xs, cur.Ys] = llToMap(site.lat, site.lon);
    cur.h0 = demH(cur.Xs, cur.Ys) / 1000; cur.key = key;
    build();
  }
  mesh.visible = sunSpr.visible = earthSpr.visible = lander.visible = true;
  relight(ms);
  msgEl.textContent = `${site.name} · ${cur.R * 2}×${cur.R * 2} km of NASA LOLA terrain · heights ×${cur.exag}`;
}

export function set3D(opts) { Object.assign(cur, opts); }

/** Put the camera at the lander, looking toward the Sun (or Earth). */
export function landerEye(target = 'sun') {
  if (!mesh) return;
  const spr = target === 'sun' ? sunSpr : earthSpr;
  camera.position.set(0, 0.01 * cur.exag + 0.005, 0);   // a few tens of metres up, like a mast camera
  const look = spr.position.clone(); look.y = Math.max(look.y, 0);
  controls.target.copy(look.normalize().multiplyScalar(0.5).add(camera.position));
  controls.update();
}
export function overview() { if (mesh) { const R = cur.R; camera.position.set(R * 0.9, R * 0.55, R * 0.9); controls.target.set(0, 0, 0); controls.update(); } }
