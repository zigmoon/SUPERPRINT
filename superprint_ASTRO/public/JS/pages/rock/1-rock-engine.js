
/* ══════════════════════════════════════════════════════════════════════════════════
   ROCK v1 — LA PIERRE EN 3D (three.js, vendu localement : aucun CDN, aucune requête)
   • low poly : icosaèdre peu subdivisé, sommets DÉPLACÉS par un bruit déterministe,
     facettes plates (flatShading) — la pierre n'est pas un modèle importé ;
   • cinq faces marketing : cinq zones de visée INVISIBLES posées sur la surface —
     survol au raycaster, clic : la pierre TOURNE pour présenter cette face ;
   • effets : la pierre se soulève au survol, elle s'assemble à l'arrivée, elle
     tourne d'un tour complet au clic avec une onde de choc et une poussée de
     particules, et l'on peut la faire tourner à la main (glisser-déposer) ;
   • sobriété : le rendu s'arrête quand la scène n'est pas visible, pas de post-traitement,
     et une image vectorielle remplace la 3D si WebGL manque.
   ══════════════════════════════════════════════════════════════════════════════════ */
import * as THREE from './JS/three.module.min.js';

const canvas = document.getElementById('rkCanvas');
const cadre = canvas && canvas.parentElement;
const charge = document.getElementById('rkCharge');
const voile = document.getElementById('rkVoice');
const lesPuces = Array.prototype.slice.call(document.querySelectorAll('.rk-puce'));
const lesBlocs = Array.prototype.slice.call(document.querySelectorAll('.rk-fn'));
const elNum = document.getElementById('rkNum');
const elNom = document.getElementById('rkNom');

/* Les cinq directions des faces marketing (réparties autour de la pierre). */
const FACES = [
  new THREE.Vector3(0.62, 0.34, 0.72),
  new THREE.Vector3(-0.78, 0.16, 0.5),
  new THREE.Vector3(0.06, -0.42, 0.9),
  new THREE.Vector3(-0.4, 0.6, -0.66),
  new THREE.Vector3(0.66, -0.2, -0.78)
];
const ENCRE = 0x14110c, PAPIER = 0xf7f3ec;   /* aucune couleur : tout est à l'encre */

let rendu, scene, camera, groupe, pierre, aretes, halo, ombre, particules, lumiereRasante;
let largeur = 0, hauteur = 0, actif = 0, survol = -1, vise = 0, vitesse = 0;
let cibleLever = 0, lever = 0, onde = null, pointeur = null, dernier = null, ancre = null, horloge = null;
let visible = true, reduit = false, construit = false;
const marqueurs = [];
/* Le FOND des facettes : la teinte au repos, et celle qu'elles prennent au survol. */
const TEINTE_REPOS = new THREE.Color(0x14110c), TEINTE_SURVOL = new THREE.Color(0x000000);
const etatParticules = { v: null, base: null, poussee: null };

function langue() {
  const l = document.documentElement.lang;
  return (l === 'fr' || l === 'ja') ? l : 'en';
}
function nomFace(i) {
  const b = lesBlocs[i];
  if (!b) return '—';
  const h = b.querySelector('h2[data-lang="' + langue() + '"]') || b.querySelector('h2');
  return h ? h.textContent.trim() : '—';
}
function peindre() {
  lesPuces.forEach(function (p, i) {
    p.classList.toggle('is-on', i === actif);
    p.setAttribute('aria-selected', i === actif ? 'true' : 'false');
  });
  lesBlocs.forEach(function (b, i) { b.classList.toggle('is-on', i === actif); });
  if (elNum) elNum.textContent = ('0' + (actif + 1)).slice(-2);
  if (elNom) elNom.textContent = nomFace(actif);
  marqueurs.forEach(function (m, i) {
    if (!m) return;
    m.point.material.emissiveIntensity = (i === actif) ? 2.4 : (i === survol ? 1.8 : 0.5);
    m.point.scale.setScalar(i === actif ? 1.5 : (i === survol ? 1.25 : 1));
  });
}
window.rkLangue = peindre;

/* ── Le rocher low poly : un icosaèdre dont on DÉPLACE les sommets ── */
function bruit(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
/* ── LES CINQ FORMES : à chaque clic, la pierre en prend une autre ──
   Toutes sont ÉCONOMES (8 à 80 facettes : l'icosaèdre en comptait 320) : un solide low poly dont
   on DÉPLACE les sommets par un bruit déterministe, puis qu'on DRESSE (étroit en x/z, haut en y,
   pied élargi) et qu'on RECENTRE — sinon son centre de gravité part vers le haut et l'ombre reste
   au sol, loin sous elle. */
const FORMES = [
  { nom: 'menhir',  solide: 'ico',   rayon: 1.18, detail: 1, ax: 0.60, ay: 1.62, az: 0.60, seuil: -1.02, ecrase: 0.42, recentre: 0.30, b1: 0.36, b2: 0.13 },
  { nom: 'stele',   solide: 'ico',   rayon: 1.18, detail: 1, ax: 0.42, ay: 1.88, az: 0.50, seuil: -1.20, ecrase: 0.50, recentre: 0.40, b1: 0.30, b2: 0.16 },
  { nom: 'cristal', solide: 'oct',   rayon: 1.30, detail: 1, ax: 0.62, ay: 1.72, az: 0.62, seuil: -1.30, ecrase: 0.55, recentre: 0.34, b1: 0.22, b2: 0.10 },
  { nom: 'bloc',    solide: 'boite', rayon: 1.10, detail: 0, ax: 0.78, ay: 1.46, az: 0.72, seuil: -1.10, ecrase: 0.30, recentre: 0.28, b1: 0.14, b2: 0.06 },
  { nom: 'galet',   solide: 'dodec', rayon: 1.18, detail: 0, ax: 0.86, ay: 1.42, az: 0.86, seuil: -1.05, ecrase: 0.50, recentre: 0.28, b1: 0.28, b2: 0.14 }
];
/* La hauteur VISÉE pour chaque forme et la hauteur de sa base : elles sont donc toutes à la même
   échelle à l'écran, et l'ombre — posée sur la base réelle — les touche toutes. */
const HAUTEUR_FORME = 2.95, BASE_FORME = -1.28;
function solideDe(F) {
  if (F.solide === 'oct') return new THREE.OctahedronGeometry(F.rayon, F.detail);
  if (F.solide === 'dodec') return new THREE.DodecahedronGeometry(F.rayon, F.detail);
  if (F.solide === 'boite') return new THREE.BoxGeometry(F.rayon * 1.5, F.rayon * 2.6, F.rayon * 1.4);
  return new THREE.IcosahedronGeometry(F.rayon, F.detail);
}
function geometriePierre(index) {
  const F = FORMES[index % FORMES.length];
  const g = solideDe(F);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const base = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d = 1
      + (bruit(n.x * 2.15, n.y * 2.15, n.z * 2.15) - 0.5) * F.b1
      + (bruit(n.x * 5.4, n.y * 5.4, n.z * 5.4) - 0.5) * F.b2;
    let x = v.x * d * F.ax, y = v.y * d * F.ay, z = v.z * d * F.az;
    if (y < F.seuil) y = F.seuil - (y - F.seuil) * F.ecrase;   // le pied s'élargit, pierre dressée
    y -= F.recentre;                                           // base et sommet équidistants
    base.push([x, y, z]);
    pos.setXYZ(i, x, y, z);
  }
  g.setAttribute('position', pos);
  /* HARMONISATION — MESURÉ : sans elle la stèle montait à 2,21 (hors cadre quand la pierre se
     soulève) et le galet s'arrêtait à 1,48 (il flottait sous les autres). On mesure la forme, on
     la met à l'échelle pour une MÊME hauteur, et on repose sa base à la MÊME altitude. */
  g.computeBoundingBox();
  const hBrute = g.boundingBox.max.y - g.boundingBox.min.y;
  const ech = hBrute > 0.001 ? (HAUTEUR_FORME / hBrute) : 1;
  const dy = BASE_FORME - g.boundingBox.min.y * ech;
  for (let i = 0; i < pos.count; i++) {
    const b = base[i];
    b[0] *= ech; b[1] = b[1] * ech + dy; b[2] *= ech;
    pos.setXYZ(i, b[0], b[1], b[2]);
  }
  g.setAttribute('position', pos);
  g.computeVertexNormals();
  g.computeBoundingBox();                            // pour POSER l'ombre sur la base réelle
  g.userData.base = base;                            // pour l'assemblage d'arrivée
  return g;
}

/* ── Poser une forme : la pierre, ses arêtes vives, son ombre et les cinq pastilles ──
   MESURÉ avant : les pastilles étaient à 0,95 du centre alors que le corps ne fait plus que 0,72
   de rayon — elles flottaient devant la pierre. On les pose donc AU RAYON, sur la surface réelle :
   quelle que soit la forme, chaque face a son point, juste sous la peau de la pierre. */
const rayonForme = new THREE.Raycaster(), invForme = new THREE.Matrix4();
function poserForme(index) {
  if (!pierre || !aretes) return;
  const g = geometriePierre(index);
  pierre.geometry.dispose();
  pierre.geometry = g;
  aretes.geometry.dispose();
  aretes.geometry = new THREE.EdgesGeometry(g, 12);
  const bb = g.boundingBox, cy = (bb.max.y + bb.min.y) / 2;
  if (ombre) { ombre.position.y = bb.min.y + 0.02; ombre.scale.setScalar(1); }
  pierre.updateMatrixWorld(true);
  invForme.copy(pierre.matrixWorld).invert();
  const o = new THREE.Vector3(0, cy, 0).applyMatrix4(invForme);
  marqueurs.forEach(function (m, j) {
    const dir = FACES[j].clone().normalize();
    rayonForme.set(o, dir.clone().transformDirection(invForme));
    const hits = rayonForme.intersectObject(pierre, false);
    const p = hits.length
      ? hits[0].point.clone().addScaledVector(dir, 0.03)
      : new THREE.Vector3(dir.x * bb.max.x, cy + dir.y * (bb.max.y - cy), dir.z * bb.max.z);
    m.point.position.copy(p);
    m.zone.position.copy(p);
  });
}

function init() {
  rendu = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  rendu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  rendu.outputColorSpace = THREE.SRGBColorSpace;
  rendu.toneMapping = THREE.ACESFilmicToneMapping;
  rendu.toneMappingExposure = 1.06;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0.32, 7.55);
  camera.lookAt(0, 0, 0);

  groupe = new THREE.Group();
  scene.add(groupe);

  /* Pierre à l'ENCRE comme le reste de la page (demande : « passe tout en noir ») ;
     l'émissive est NEUTRE (blanc) et très basse, ce qui laisse la place au FOND des polygones
     au survol sans introduire de couleur. */
  pierre = new THREE.Mesh(geometriePierre(0), new THREE.MeshStandardMaterial({
    color: 0x14110c, roughness: 0.72, metalness: 0.06, flatShading: true,
    emissive: 0xffffff, emissiveIntensity: 0.03,
    /* DEMANDE CLIENT : LE MAILLAGE RESTE VISIBLE EN PERMANENCE — les facettes sont un
       voile léger (0,16) qui ne disparaît jamais, et le survol ne fait que le teinter
       un peu plus (voir la boucle). */
    transparent: true, opacity: 0.16
  }));
  groupe.add(pierre);

  aretes = new THREE.LineSegments(
    new THREE.EdgesGeometry(pierre.geometry, 12),
    new THREE.LineBasicMaterial({ color: ENCRE, transparent: true, opacity: 0.45 })
  );
  groupe.add(aretes);

  /* Les cinq faces : une ZONE DE VISÉE INVISIBLE (raycaster au survol, clic pour tourner).
     DEMANDE CLIENT : plus aucun point blanc posé sur la pierre low poly — la sphère
     d'ancrage reste construite (peindre() et poserForme() s'en servent), mais elle
     n'est plus dessinée. */
  FACES.forEach(function (dir, i) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 16),
      new THREE.MeshStandardMaterial({ color: PAPIER, emissive: ENCRE, emissiveIntensity: 0.5, roughness: 0.3 }));
    p.visible = false;
    p.position.set(dir.x * 0.78, dir.y * 1.62 - 0.18, dir.z * 0.78);
    const zone = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 12),
      new THREE.MeshBasicMaterial({ visible: false }));
    zone.position.copy(p.position);
    zone.userData.face = i;
    groupe.add(p); groupe.add(zone);
    marqueurs.push({ point: p, zone: zone, dir: dir.normalize() });
  });

  /* Ombre portée : une tache douce (dégradé dessiné) qui rétrécit quand la pierre monte. */
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 256;
  const c = cnv.getContext('2d');
  const grad = c.createRadialGradient(128, 128, 4, 128, 128, 126);
  grad.addColorStop(0, 'rgba(16,13,9,0.42)');
  grad.addColorStop(0.55, 'rgba(16,13,9,0.14)');
  grad.addColorStop(1, 'rgba(16,13,9,0)');
  c.fillStyle = grad; c.fillRect(0, 0, 256, 256);
  ombre = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 1.55),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cnv), transparent: true, depthWrite: false }));
  ombre.rotation.x = -Math.PI / 2;
  /* L'OMBRE EST POSÉE SUR LA BASE RÉELLE DE LA PIERRE (mesurée) : elle ne peut plus s'en
     détacher. C'est la PIERRE qui monte au survol, pas l'ombre qui descend. */
  ombre.position.y = pierre.geometry.boundingBox.min.y + 0.02;
  scene.add(ombre);

  /* Halo : un anneau fin, tourné, qui respire. */
  halo = new THREE.Mesh(new THREE.RingGeometry(1.40, 1.435, 128),
    new THREE.MeshBasicMaterial({ color: ENCRE, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2.08;
  halo.position.y = -1.14;
  scene.add(halo);

  /* Particules : la poussière de l'atelier, poussée au clic. */
  const N = 150, pos = new Float32Array(N * 3), base = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 1.72 + bruit(i * 1.7, 3.1, 5.3) * 1.05;
    const th = bruit(i * 2.3, 1.1, 7.7) * Math.PI * 2;
    const ph = Math.acos(2 * bruit(i * 3.7, 2.9, 4.1) - 1);
    const x = r * Math.sin(ph) * Math.cos(th), y = r * Math.cos(ph) * 0.6, z = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3] = base[i * 3] = x; pos[i * 3 + 1] = base[i * 3 + 1] = y; pos[i * 3 + 2] = base[i * 3 + 2] = z;
  }
  const gP = new THREE.BufferGeometry();
  gP.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  particules = new THREE.Points(gP, new THREE.PointsMaterial({
    color: ENCRE, size: 0.02, transparent: true, opacity: 0.55, depthWrite: false
  }));
  scene.add(particules);
  etatParticules.v = new Float32Array(N);
  etatParticules.base = base;
  etatParticules.poussee = new Float32Array(N);

  /* Onde de choc du clic : un anneau qui s'ouvre et s'efface. */
  onde = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 96),
    new THREE.MeshBasicMaterial({ color: ENCRE, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  onde.rotation.x = -Math.PI / 2.08;
  onde.position.y = -1.14;
  scene.add(onde);

  /* Lumières : papier chaud devant, lumière NEUTRE derrière (arête), ambiance basse.
     Aucune couleur : la cyan qui teintait l'arête devient un blanc chaud très doux. */
  scene.add(new THREE.HemisphereLight(0xfdf8ef, 0x2a241c, 0.85));
  const cle = new THREE.DirectionalLight(0xfff2dd, 3.0); cle.position.set(2.6, 3.4, 3.2); scene.add(cle);
  lumiereRasante = new THREE.DirectionalLight(0xfff6ea, 0.7); lumiereRasante.position.set(-3.2, 1.2, -2.6); scene.add(lumiereRasante);
  const contre = new THREE.DirectionalLight(0xffffff, 0.5); contre.position.set(-1.5, -2, 2); scene.add(contre);

  poserForme(0);        /* la forme de départ, et les pastilles posées sur SA surface */
  horloge = new THREE.Clock();
  /* Assemblage d'arrivée : les sommets partent éclatés et se posent en 1,1 s. */
  const pos0 = pierre.geometry.attributes.position;
  const mes = function (t) {
    const e = Math.min(1, t / 1.1), k = 1 - Math.pow(1 - e, 3);
    for (let i = 0; i < pos0.count; i++) {
      const b = pierre.geometry.userData.base[i];
      const ex = b[0] * 2.7, ey = b[1] * 2.7, ez = b[2] * 2.7;
      pos0.setXYZ(i, ex + (b[0] - ex) * k, ey + (b[1] - ey) * k, ez + (b[2] - ez) * k);
    }
    pos0.needsUpdate = true;
    if (e < 1) { rendu.render(scene, camera); requestAnimationFrame(function () { mes(t + 16); }); }
    else { pos0.setXYZ(0, pierre.geometry.userData.base[0][0], pierre.geometry.userData.base[0][1], pierre.geometry.userData.base[0][2]); }
  };
  peindre();
  mes(0);

  /* Interactions */
  cadre.addEventListener('pointermove', function (e) {
    const r = canvas.getBoundingClientRect();
    pointeur = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (dernier) {
      const dx = e.clientX - dernier.x;
      /* ⚠️ MESURÉ : l'inertie seule ne faisait presque rien tourner — la rotation glissée
         était aussitôt rappelée vers « vise » (0,008 rad/s constatés, soit 20 fois moins
         que voulu). On tourne donc la pierre SOUS le doigt, et l'inertie prend le relais
         au relâchement. */
      if (e.buttons) { groupe.rotation.y += dx * 0.007; vise = groupe.rotation.y; }
      vitesse += dx * 0.0016;
    }
    dernier = { x: e.clientX, y: e.clientY };
    if (!e.buttons) cibleLever = 0.3;
  });
  cadre.addEventListener('pointerleave', function () { pointeur = null; dernier = null; cibleLever = 0; survol = -1; peindre(); });
  cadre.addEventListener('pointerdown', function (e) {
    dernier = { x: e.clientX, y: e.clientY };
    /* ⚠️ MESURÉ : comparer le relâchement au DERNIER mouvement ne marchait pas — « dernier »
       est réécrit à chaque mouvement, donc l'écart tombait toujours sous 6 px et TOUT
       relâchement changeait de face, même une rotation glissée. On mémorise le point d'appui. */
    ancre = { x: e.clientX, y: e.clientY };
    cadre.setPointerCapture && cadre.setPointerCapture(e.pointerId);
  });
  cadre.addEventListener('pointerup', function (e) {
    const bouge = ancre ? Math.abs(e.clientX - ancre.x) + Math.abs(e.clientY - ancre.y) : 999;
    if (bouge < 6) cliquer();
    dernier = null;
    ancre = null;
  });
  canvas.addEventListener('click', function () { /* le clic est traité au pointerup (pour distinguer le glisser) */ });
  cadre.addEventListener('pointerenter', function () { cibleLever = 0.3; });
  var btn = document.getElementById('rkTourner');
  if (btn) btn.addEventListener('click', cliquer);
  lesPuces.forEach(function (p, i) { p.addEventListener('click', function () { actif = i; peindre(); tournerVers(i, true); }); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { actif = (actif + 1) % 5; peindre(); tournerVers(actif, true); }
    if (e.key === 'ArrowLeft') { actif = (actif + 4) % 5; peindre(); tournerVers(actif, true); }
  });

  const ro = new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0.05 });
  ro.observe(cadre);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) horloge.getDelta(); });
  reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  redimensionner();
  window.addEventListener('resize', redimensionner);
  if (charge) charge.hidden = true;
  if (voile) voile.hidden = true;
  construit = true;
  /* Repère de mesure (aucun effet sur le rendu) : permet de vérifier la scène depuis la
     console ou un banc de test — même esprit que spTestDiag dans l'application. */
  window.__rk = { THREE: THREE, scene: scene, camera: camera, rendu: rendu, pierre: pierre, groupe: groupe, aretes: aretes, ombre: ombre, poserForme: poserForme, FORMES: FORMES };
  apres();
}

/* ── Le clic : la pierre fait un tour, une onde s'ouvre, les particules partent ── */
let tourRestant = 0;
function cliquer() {
  actif = (actif + 1) % 5;
  /* LE CLIC CHANGE DE FORME : chaque face a la sienne (ménir, stèle, cristal, bloc, galet) ;
     l'ombre comme les pastilles se reposent sur la nouvelle surface. */
  poserForme(actif);
  peindre();
  tournerVers(actif, false);
  vitesse += 0.09;
  if (onde) onde.material.opacity = 0.55;
  for (let i = 0; i < etatParticules.v.length; i++) etatParticules.v[i] = 0.9 + bruit(i, 1.3, 2.7) * 1.4;
  if (pierre) { pierre.material.emissive = new THREE.Color(0xffffff); pierre.material.emissiveIntensity = 0.16; }
}
function tournerVers(i, doux) {
  const d = FACES[i];
  const cible = -Math.atan2(d.x, d.z);
  const delta = ((cible - groupe.rotation.y) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  vise = groupe.rotation.y + delta + (doux ? 0 : (delta >= 0 ? Math.PI * 2 : -Math.PI * 2));
}

function redimensionner() {
  if (!rendu) return;
  const r = cadre.getBoundingClientRect();
  largeur = Math.max(240, Math.round(r.width));
  hauteur = Math.max(240, Math.round(r.height));
  rendu.setSize(largeur, hauteur, false);
  camera.aspect = largeur / hauteur;
  camera.updateProjectionMatrix();
}

/* ── Boucle ── */
function apres() {
  requestAnimationFrame(apres);
  if (!construit) return;
  let dt = Math.min(0.05, horloge.getDelta());
  /* ⚠️ GARDE-FOUS DE FINITUDE — MESURÉ : une seule valeur non finie dans la rotation du
     groupe rend sa matrice de monde NaN, et three.js ne dessine PLUS la pierre du tout
     (le halo et les particules, eux, restent visibles : on croit que la scène est vide).
     On remet donc d'aplomb au lieu de laisser un trou. */
  if (!isFinite(dt)) dt = 0.016;
  if (!isFinite(vitesse)) vitesse = 0;
  if (!isFinite(vise)) vise = 0;
  if (!isFinite(lever)) lever = 0;
  if (!isFinite(groupe.rotation.y)) groupe.rotation.y = 0;
  if (!isFinite(groupe.position.y)) groupe.position.y = 0;
  const t = horloge.elapsedTime;

  /* glisser-déposer + inertie */
  groupe.rotation.y += vitesse;
  vitesse *= 0.94;
  /* rotation automatique vers la face demandée (et retour au repos) */
  const manque = vise - groupe.rotation.y;
  groupe.rotation.y += manque * Math.min(1, dt * 3.4);
  if (Math.abs(manque) < 0.002) vise = groupe.rotation.y + (reduit ? 0 : dt * 0.5);

  if (pointeur && !reduit) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointeur, camera);
    const zones = marqueurs.map(function (m) { return m.zone; });
    const hits = ray.intersectObjects(zones, false);
    const i = hits.length ? hits[0].object.userData.face : -1;
    if (i !== survol) { survol = i; peindre(); }
    if (i >= 0) cibleLever = 0.5;
  }

  /* la pierre se soulève, son ombre s'élargit */
  lever += (cibleLever - lever) * Math.min(1, dt * 5.5);
  const flotte = reduit ? 0 : Math.sin(t * 0.85) * 0.035;
  /* MESURÉ : à 1 pour 1, la pierre sortait du cadre en se soulevant (haut et bas coupés). */
  groupe.position.y = lever * 0.5 + flotte;
  groupe.rotation.x = -lever * 0.06;
  /* ⚠️ MESURÉ : l'ombre était 0,80 SOUS le pied de la pierre — « il est trop loin de l'ombre ».
     Elle reste maintenant AU SOL : c'est la pierre qui s'en détache quand elle se soulève. */
  ombre.scale.setScalar(1 + lever * 0.12);
  ombre.material.opacity = 1 - lever * 0.4;

  if (aretes) {
    /* LES TRAITS D'ENCRE RESTENT ACTIFS : 0,34 au repos, 0,62 au survol (ils s'éteignaient à 0). */
    aretes.material.opacity += ((lever > 0.2 ? 0.72 : 0.45) - aretes.material.opacity) * Math.min(1, dt * 5);
    /* MESURÉ : posées pile sur les facettes, les arêtes ne se voyaient pas (z-fighting).
       On les écarte d'un cheveu, d'autant plus qu'elles s'allument : la pierre s'ouvre. */
    aretes.scale.setScalar(1 + aretes.material.opacity * 0.02);
  }
  if (halo && !reduit) { halo.rotation.z += dt * 0.22; halo.material.opacity = 0.42 + 0.1 * Math.sin(t * 1.1); }
  if (lumiereRasante && !reduit) { lumiereRasante.position.set(Math.cos(t * 0.28) * -3.2, 1.2, Math.sin(t * 0.28) * -3.2); }
  if (pierre && pierre.material.emissiveIntensity > 0) {
    pierre.material.emissiveIntensity = Math.max(0, pierre.material.emissiveIntensity - dt * 0.5);
  }
  /* AU SURVOL, C'EST LE FOND DES POLYGONES QUI PREND SA TEINTE : les facettes s'assombrissent
     et l'émissive neutre monte avec le soulèvement — sans jamais repeindre les arêtes. */
  if (pierre) {
    pierre.material.color.copy(TEINTE_REPOS).lerp(TEINTE_SURVOL, Math.min(1, lever * 2.4));
    pierre.material.emissiveIntensity = Math.max(pierre.material.emissiveIntensity, lever * 0.22);
    /* LE REMPLISSAGE — DEMANDE CLIENT : le maillage est là en permanence (0,16) et le survol
       ne fait que le TEINTER un peu plus, sans jamais l'effacer : plafond 0,34. L'ancien
       0,98 était bien trop fort — la pierre devenait un bloc opaque au passage de la souris. */
    pierre.material.opacity = Math.min(0.34, 0.16 + lever * 0.55);
  }
  if (onde && onde.material.opacity > 0) {
    onde.material.opacity = Math.max(0, onde.material.opacity - dt * 1.5);
    onde.scale.setScalar(1 + (0.55 - onde.material.opacity) * 2.2);
  }
  if (particules && !reduit) {
    const p = particules.geometry.attributes.position, base = etatParticules.base, vv = etatParticules.v;
    for (let i = 0; i < vv.length; i++) {
      if (vv[i] > 0) { vv[i] = Math.max(0, vv[i] - dt * 1.2); etatParticules.poussee[i] = Math.sin(vv[i] * Math.PI) * 0.9; }
      const k = etatParticules.poussee[i];
      p.setXYZ(i, base[i * 3] * (1 + k), base[i * 3 + 1] * (1 + k) + Math.sin(t * 0.6 + i) * 0.02, base[i * 3 + 2] * (1 + k));
    }
    p.needsUpdate = true;
    particules.rotation.y = t * 0.03;
  }

  if (visible && !document.hidden) rendu.render(scene, camera);
}

/* ── Départ : si WebGL manque, on montre une pierre vectorielle (jamais une page vide) ── */
try {
  const test = document.createElement('canvas');
  const ok = !!(window.WebGLRenderingContext && (test.getContext('webgl2') || test.getContext('webgl')));
  if (!ok) throw new Error('webgl absent');
  init();
} catch (e) {
  if (charge) charge.hidden = true;
  if (voile) voile.hidden = false;
  if (canvas) canvas.style.display = 'none';
  const sec = document.querySelector('.rk-cadre');
  if (sec) {
    sec.insertAdjacentHTML('afterbegin',
      '<svg class="rk-svg-secours" viewBox="0 0 320 300" role="img" aria-label="ROCK v1">' +
      '<polygon points="44,214 34,180 48,150 70,124 92,96 124,78 168,74 204,84 234,104 256,136 264,172 256,204 228,232 188,248 140,252 92,244 58,232" fill="#8A8069"/>' +
      '<polygon points="92,96 124,78 112,146" fill="#D2C8B4"/><polygon points="48,150 70,124 112,146" fill="#BFB5A0"/>' +
      '<polygon points="34,180 48,150 112,146" fill="#A79D86"/><polygon points="44,214 34,180 112,146" fill="#8E846E"/>' +
      '<polygon points="264,172 256,136 198,182" fill="#9C927B"/><polygon points="256,204 264,172 198,182" fill="#7B735C"/>' +
      '<polygon points="228,232 256,204 198,182" fill="#5F5945"/><polygon points="188,248 228,232 198,182" fill="#4A4534"/>' +
      '<polygon points="140,252 188,248 198,182" fill="#3A3527"/><polygon points="92,244 140,252 112,146" fill="#6E664F"/>' +
      '</svg>');
  }
}
