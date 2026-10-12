/* ══════════════════════════════════════════════════════════════════════════
   validate-montage.mjs — la planche imposée assemblée, relue par un tiers.

   `superprint-montage` assemble un PDF : deux rendus de page, un plan, des
   repères, un profil de sortie. Ce script ne lui fait pas confiance et ne le
   relit pas lui-même : il **ouvre le PDF avec `pdf-lib`** — le lecteur du
   produit, une bibliothèque tierce — et confronte ce qu'il y trouve à ce que la
   géométrie annonce.

   Il vérifie quatre choses, et chacune a sa raison :

     1. LA GÉOMÉTRIE. Les trois boîtes de page (média, format fini, fond perdu)
        sont recalculées ici à partir de la **définition** — « le format fini,
        élargi du fond perdu imprimé, plus la marge technique » — et non
        recopiées du Rust. Un accord entre le noyau et lui-même ne prouve rien.

     2. LA PLACE ET LE ROGNAGE. Le flux de contenu est relu : la matrice `cm` de
        chaque image donne sa place, les rectangles `re W n` donnent le rognage.
        Les deux sont comparés à la règle de la couture : le fond perdu intérieur
        est coupé au trait quand les deux pages se touchent, et conservé en
        découpe page à page.

     3. LE SENS DES LIGNES. Les pixels des deux images sont lus dans le fichier
        (le banc les écrit sans filtre, exprès). La moitié haute doit être la
        première : un flux d'image PDF se lit de haut en bas, comme un canevas.
        C'est la seule façon de mesurer qu'aucun retournement n'a été fait — et
        une planche retournée est un défaut qui ne se voit qu'au tirage.

     4. LES COULEURS ET LA CONFORMITÉ. L'espace couleur des images dépend du
        mode, et une conformité revendiquée doit s'accompagner d'un profil de
        sortie embarqué : le noyau **refuse** l'inverse, et le refus est mesuré.

   Usage : node scripts/validate-montage.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');
const exemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'montage_dump.wasm',
);
const dossier = join(racine, 'target', 'montage');
mkdirSync(dossier, { recursive: true });

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

if (!existsSync(exemple)) {
  console.error(`introuvable : ${exemple}`);
  console.error(
    '(construire : cargo build -p superprint-montage --example montage_dump --target wasm32-wasip1 --release)',
  );
  process.exit(2);
}

const MM = (pt) => (pt * 25.4) / 72;
const PT = (mm) => (mm * 72) / 25.4;

/**
 * Tolérance des comparaisons de longueur, en millimètres.
 *
 * Elle n'est pas choisie au confort : un PDF écrit ses coordonnées en **points**
 * avec un nombre fini de décimales (quatre ici). Un dixième de micromètre est
 * donc le **plancher** que le fichier peut exprimer — en dessous, on ne
 * comparerait plus la géométrie mais l'arrondi de l'écriture. Et pour situer :
 * une presse offset tient le registre à cinquante micromètres, soit cinq cents
 * fois cette tolérance.
 */
const TOLERANCE_MM = 1e-4;

/** Lance le banc et rend `{ pdf, rapport }`. */
function assembler(nom, spec, mode, fond, filtre, icc) {
  const cheminSpec = join(dossier, `${nom}.txt`);
  const cheminPdf = join(dossier, `${nom}.pdf`);
  writeFileSync(cheminSpec, spec, 'utf8');
  const args = [
    join(racine, 'scripts', 'run-wasi.mjs'),
    exemple,
    `target/montage/${nom}.txt`,
    `target/montage/${nom}.pdf`,
    mode,
    fond ? '1' : '0',
    filtre,
  ];
  if (icc) args.push(icc);
  let rapport = '';
  try {
    rapport = execFileSync(process.execPath, args, { cwd: racine, stdio: 'pipe' }).toString();
  } catch (erreur) {
    return { pdf: null, rapport: '', code: erreur.status ?? 1, sortie: String(erreur.stderr) };
  }
  return { pdf: readFileSync(cheminPdf), rapport, code: 0 };
}

/** La spécification du plan, en texte. */
function spec({ pageW, pageH, bleed, includeBleed, cutApart, marge }) {
  return (
    `!page\t${pageW}\t${pageH}\n` +
    `!fond\t${bleed}\t${includeBleed ? 1 : 0}\n` +
    `!decoupe\t${cutApart ? 1 : 0}\n` +
    `!reperes\t${marge > 0 ? 1 : 0}\t${marge}\t5\t2.5\t0.25\n` +
    `!places\t1\t2\n`
  );
}

/**
 * La géométrie **telle que la règle la définit**, recalculée ici.
 *
 * En millimètres, dans le repère du média : origine au coin haut-gauche, `y` vers
 * le bas — celui de l'application.
 */
function geometrie(cas) {
  const fondImprime = cas.includeBleed ? cas.bleed : 0;
  const marge = cas.marge;
  const gouttiere = cas.cutApart && cas.includeBleed ? cas.bleed * 2 : 0;
  const couture = !cas.cutApart;

  const media = [
    2 * cas.pageW + 2 * fondImprime + gouttiere + 2 * marge,
    cas.pageH + 2 * fondImprime + 2 * marge,
  ];
  const trim = [2 * cas.pageW + gouttiere, cas.pageH];
  // Le format fini commence à la marge **plus** le fond perdu imprimé : sans
  // fond perdu imprimé, la marge technique est seule à séparer le format du
  // bord du papier.
  const trimX0 = marge + fondImprime;
  const trimY0 = marge + fondImprime;
  // Et la zone **chargée** porte le fond perdu DÉCLARÉ, imprimé ou non : c'est
  // le rendu de la page, qui a toujours son fond perdu sur ses quatre côtés.
  const zoneX0 = marge + fondImprime - cas.bleed;
  const zoneY0 = marge + fondImprime - cas.bleed;
  const zone = [cas.pageW + 2 * cas.bleed, cas.pageH + 2 * cas.bleed];

  const milieu = cas.pageW + gouttiere;
  const zones = [
    [
      trimX0 - fondImprime,
      trimY0 - fondImprime,
      trimX0 + cas.pageW + (couture ? 0 : fondImprime),
      trimY0 + cas.pageH + fondImprime,
    ],
    [
      trimX0 + milieu - (couture ? 0 : fondImprime),
      trimY0 - fondImprime,
      trimX0 + milieu + cas.pageW + fondImprime,
      trimY0 + cas.pageH + fondImprime,
    ],
  ];
  const poses = [
    [zoneX0, zoneY0],
    [zoneX0 + milieu, zoneY0],
  ];

  return { media, trim, fondImprime, marge, gouttiere, trimX0, trimY0, zone, zones, poses };
}

/** Le repère PDF : `x` vers la droite, `y` vers le haut, origine au format fini. */
function enPdf(geo, x, y) {
  return [x - geo.trimX0, geo.trimY0 + geo.trim[1] - y];
}

/* ─────────────────────── lecture du PDF, par pdf-lib ────────────────────── */

const libPath = resolve(
  process.env.SP_PDF_LIB ?? join(parent, 'superprint', 'app', 'JS', 'pdf-lib.min.js'),
);
const PDFLib = require(libPath);

/** Les opérandes du flux de contenu, relus tels quels. */
function flux(document, page) {
  const contenu = page.node.Contents();
  const objets = Array.isArray(contenu) ? contenu : [contenu];
  let texte = '';
  for (const reference of objets) {
    const objet = document.context.lookup(reference);
    if (objet && objet.contents) {
      texte += Buffer.from(objet.contents).toString('latin1');
    }
  }
  return texte;
}

/** Toutes les matrices `cm` d'images, avec le nom de la ressource posée. */
function matricesImage(texte) {
  const trouvees = [];
  const motif = /q\n([\d.eE+-]+) 0 0 ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) cm\n\/(\w+) Do\nQ\n/g;
  for (const m of texte.matchAll(motif)) {
    trouvees.push({
      largeur: Number(m[1]),
      hauteur: Number(m[2]),
      x: Number(m[3]),
      y: Number(m[4]),
      nom: m[5],
    });
  }
  return trouvees;
}

/** Tous les rectangles de rognage `re … W n`. */
function rognages(texte) {
  const trouvees = [];
  const motif = /([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) re\nW n\n/g;
  for (const m of texte.matchAll(motif)) {
    trouvees.push({
      x: Number(m[1]),
      y: Number(m[2]),
      largeur: Number(m[3]),
      hauteur: Number(m[4]),
    });
  }
  return trouvees;
}

/** Les images XObject d'une page, dans l'ordre du dictionnaire de ressources. */
function images(document, page) {
  const { PDFName } = PDFLib;
  const ressources = page.node.Resources();
  const xobjects = ressources?.lookup(PDFName.of('XObject'));
  if (!xobjects) return [];
  return xobjects.entries().map(([nom, reference]) => {
    const fluxImage = document.context.lookup(reference);
    const dict = fluxImage.dict;
    return {
      nom: nom.asString(),
      objet: fluxImage,
      largeur: Number(dict.lookup(PDFName.of('Width'))?.asNumber() ?? 0),
      hauteur: Number(dict.lookup(PDFName.of('Height'))?.asNumber() ?? 0),
      espace: dict.lookup(PDFName.of('ColorSpace'))?.toString() ?? '',
      filtre: dict.lookup(PDFName.of('Filter'))?.toString() ?? 'aucun',
      donnees: fluxImage.contents,
    };
  });
}

/* ═══════════════════ 1. La géométrie, sur six configurations ═══════════════ */

titre('géométrie : les trois boîtes, recalculées à partir de la règle');

const CONFIGURATIONS = [
  { nom: 'A4 + fond perdu 3 + repères', pageW: 210, pageH: 297, bleed: 3, includeBleed: true, cutApart: false, marge: 10 },
  { nom: 'A4 sans fond perdu imprimé', pageW: 210, pageH: 297, bleed: 3, includeBleed: false, cutApart: false, marge: 10 },
  { nom: 'A4 découpe page à page', pageW: 210, pageH: 297, bleed: 3, includeBleed: true, cutApart: true, marge: 10 },
  { nom: 'A5 + fond perdu 5', pageW: 148, pageH: 210, bleed: 5, includeBleed: true, cutApart: true, marge: 10 },
  { nom: 'A5 sans repères, sans fond perdu', pageW: 148, pageH: 210, bleed: 5, includeBleed: false, cutApart: false, marge: 0 },
  { nom: 'A3 paysage, fond perdu nul', pageW: 420, pageH: 297, bleed: 0, includeBleed: true, cutApart: false, marge: 10 },
];

let geometries = 0;
let ecartsBox = 0;
for (const [rang, cas] of CONFIGURATIONS.entries()) {
  const geo = geometrie(cas);
  const { pdf } = assembler(`geo-${rang}`, spec(cas), 'rvb', true, 'auto');
  if (!pdf) {
    check(`${cas.nom} : PDF produit`, false);
    ecartsBox += 1;
    continue;
  }
  const document = await PDFLib.PDFDocument.load(pdf, { updateMetadata: false });
  const page = document.getPages()[0];
  const boite = (nom) => {
    try {
      const b = page[nom]();
      return [MM(b.x), MM(b.y), MM(b.width), MM(b.height)];
    } catch {
      return null;
    }
  };
  const media = boite('getMediaBox');
  const trim = boite('getTrimBox');
  const fond = boite('getBleedBox');

  // Le média est lu en (0,0) : ses dimensions sont donc ses deux derniers
  // nombres, et le format fini est décalé de `marge + fond perdu imprimé`.
  const attendus = {
    media: geo.media,
    trim: [geo.marge + geo.fondImprime, geo.marge + geo.fondImprime, geo.trim[0], geo.trim[1]],
    fond: [geo.marge, geo.marge, geo.trim[0] + 2 * geo.fondImprime, geo.trim[1] + 2 * geo.fondImprime],
  };
  // Chaque comparaison est nommée : quand une boîte est fausse, on veut savoir
  // **laquelle** et de combien — pas seulement qu'un test a échoué.
  const comparaisons = [
    ['média / largeur', media?.[2], attendus.media[0]],
    ['média / hauteur', media?.[3], attendus.media[1]],
    ['format fini / x', trim?.[0], attendus.trim[0]],
    ['format fini / y', trim?.[1], attendus.trim[1]],
    ['format fini / largeur', trim?.[2], attendus.trim[2]],
    ['format fini / hauteur', trim?.[3], attendus.trim[3]],
    ['fond perdu / x', fond?.[0], attendus.fond[0]],
    ['fond perdu / y', fond?.[1], attendus.fond[1]],
    ['fond perdu / largeur', fond?.[2], attendus.fond[2]],
    ['fond perdu / hauteur', fond?.[3], attendus.fond[3]],
  ];
  const fautives = comparaisons.filter(
    ([, lue, attendue]) => lue === undefined || Math.abs(lue - attendue) > TOLERANCE_MM,
  );
  const justes = fautives.length === 0;
  if (!justes) {
    console.log(
      `    ${cas.nom} :\n` +
        fautives
          .map(
            ([nom, lue, attendue]) =>
              `      ${nom} : attendu ${attendue.toFixed(6)} mm, lu ${
                lue === undefined ? '—' : lue.toFixed(6)
              }`,
          )
          .join('\n'),
    );
    ecartsBox += 1;
  }
  geometries += 1;
}
check(
  `les trois boîtes coïncident sur ${geometries} configurations`,
  ecartsBox === 0,
  ecartsBox ? `${ecartsBox} écart(s)` : 'média, format fini, fond perdu',
);

/* ══════════════ 2. La place, le rognage et les repères, relus ══════════════ */

titre('place et rognage : la matrice cm et les rectangles W n, relus');

let dessinsVerifies = 0;
let ecartsPlace = 0;
for (const [rang, cas] of CONFIGURATIONS.entries()) {
  const geo = geometrie(cas);
  const { pdf } = assembler(`geo-${rang}`, spec(cas), 'rvb', true, 'aucun');
  const document = await PDFLib.PDFDocument.load(pdf, { updateMetadata: false });
  const page = document.getPages()[0];
  const texte = flux(document, page);
  const matrices = matricesImage(texte).sort((a, b) => a.x - b.x);
  const clips = rognages(texte);

  if (matrices.length !== 2 || clips.length !== 2) {
    console.log(`    ${cas.nom} : ${matrices.length} image(s), ${clips.length} rognage(s)`);
    ecartsPlace += 1;
    continue;
  }

  // La place : la matrice doit poser le coin **bas-gauche** de la zone chargée
  // dans le repère du format fini.
  for (const [cote, indice] of [['gauche', 0], ['droite', 1]]) {
    const [x0, y0] = geo.poses[indice];
    const [px, py] = enPdf(geo, x0, y0 + geo.zone[1]);
    const m = matrices[indice];
    const ecart = Math.max(
      Math.abs(MM(m.x) - px),
      Math.abs(MM(m.y) - py),
      Math.abs(MM(m.largeur) - geo.zone[0]),
      Math.abs(MM(m.hauteur) - geo.zone[1]),
    );
    if (ecart > TOLERANCE_MM) {
      console.log(
        `    ${cas.nom} / ${cote} : posé (${MM(m.x).toFixed(4)}, ${MM(m.y).toFixed(4)}) ` +
          `sur ${MM(m.largeur).toFixed(3)}×${MM(m.hauteur).toFixed(3)} mm, ` +
          `attendu (${px.toFixed(4)}, ${py.toFixed(4)}) sur ${geo.zone[0].toFixed(3)}×${geo.zone[1].toFixed(3)} mm`,
      );
      ecartsPlace += 1;
    }
  }

  // Le rognage : la zone autorisée, du coin bas-gauche au coin haut-droit.
  for (const [cote, indice] of [['gauche', 0], ['droite', 1]]) {
    const zone = geo.zones[indice];
    const [bx, by] = enPdf(geo, zone[0], zone[3]);
    const [hx, hy] = enPdf(geo, zone[2], zone[1]);
    const c = clips[indice];
    const ecart = Math.max(
      Math.abs(MM(c.x) - bx),
      Math.abs(MM(c.y) - by),
      Math.abs(MM(c.largeur) - (hx - bx)),
      Math.abs(MM(c.hauteur) - (hy - by)),
    );
    if (ecart > TOLERANCE_MM) {
      console.log(
        `    ${cas.nom} / ${cote} : rognage (${MM(c.x).toFixed(4)}, ${MM(c.y).toFixed(4)}) ` +
          `${MM(c.largeur).toFixed(3)}×${MM(c.hauteur).toFixed(3)} mm, ` +
          `attendu (${bx.toFixed(4)}, ${by.toFixed(4)}) ${(hx - bx).toFixed(3)}×${(hy - by).toFixed(3)} mm`,
      );
      ecartsPlace += 1;
    }
  }

  // Les repères : douze sans gouttière, seize avec — et **zéro** quand aucune
  // marge technique n'est réservée : un repère n'a nulle part où être tracé
  // hors du format, et le produit ne les demande plus dans ce cas.
  const traits = (texte.match(/l\nS\n/g) ?? []).length;
  const attendus = cas.marge <= 0 ? 0 : cas.cutApart ? 16 : 12;
  if (traits !== attendus) {
    console.log(`    ${cas.nom} : ${traits} repère(s) au lieu de ${attendus}`);
    ecartsPlace += 1;
  }
  dessinsVerifies += 1;
}
check(
  `place, rognage et repères coïncident sur ${dessinsVerifies} configurations`,
  ecartsPlace === 0,
  ecartsPlace ? `${ecartsPlace} écart(s)` : 'matrices, rectangles, traits',
);

/* ══════════════ 3. Le sens des lignes, lu dans les pixels ══════════════ */

titre('sens des lignes : les pixels du fichier, pas ceux du banc');

{
  const cas = CONFIGURATIONS[0];
  const geo = geometrie(cas);
  const { pdf } = assembler('pixels', spec(cas), 'rvb', false, 'aucun');
  const document = await PDFLib.PDFDocument.load(pdf, { updateMetadata: false });
  const page = document.getPages()[0];
  const texte = flux(document, page);
  const listes = images(document, page);
  const matrices = matricesImage(texte).sort((a, b) => a.x - b.x);

  check('deux images XObject déclarées', listes.length === 2, `${listes.length} trouvée(s)`);
  check(
    'aucun filtre : les pixels sont lisibles tels quels',
    listes.every((i) => i.filtre === 'aucun'),
    listes.map((i) => i.filtre).join(', '),
  );

  // Chaque image doit faire la taille de la zone chargée, pixel par pixel : le
  // banc écrit un pixel par millimètre.
  const attenduPx = [Math.round(geo.zone[0]), Math.round(geo.zone[1])];
  check(
    `les images font la zone chargée (${attenduPx[0]}×${attenduPx[1]} px)`,
    listes.every((i) => i.largeur === attenduPx[0] && i.hauteur === attenduPx[1]),
    listes.map((i) => `${i.largeur}×${i.hauteur}`).join(', '),
  );

  // On apparie image et place par le dictionnaire de ressources, dans l'ordre du
  // flux : la première matrice posée référence la première image ajoutée.
  const attendues = [
    { haut: [255, 0, 0], bas: [0, 255, 0], cote: 'gauche' },
    { haut: [0, 0, 255], bas: [255, 255, 0], cote: 'droite' },
  ];
  let ecartsPixels = 0;
  for (const [indice, attendu] of attendues.entries()) {
    const nom = matrices[indice].nom;
    // ⚠️ Le nom du flux porte la barre oblique (`/Im0`), celui du dictionnaire de
    // ressources aussi : on compare donc les deux **normalisés**, plutôt que
    // d'imposer une écriture à l'un des deux lecteurs.
    const normaliser = (n) => String(n).replace(/^\//, '');
    const image = listes.find((i) => normaliser(i.nom) === normaliser(nom));
    if (!image) {
      console.log(
        `    ${attendu.cote} : la ressource « ${nom} » est introuvable (présentes : ${listes
          .map((i) => i.nom)
          .join(', ')})`,
      );
      ecartsPixels += 1;
      continue;
    }
    const octets = image.donnees;
    const parPixel = 3;
    const premier = [octets[0], octets[1], octets[2]];
    // Le milieu de la DERNIÈRE ligne : c'est la moitié basse du motif.
    const debutDerniereLigne = (image.hauteur - 1) * image.largeur * parPixel;
    const milieu = debutDerniereLigne + Math.floor(image.largeur / 2) * parPixel;
    const dernier = [octets[milieu], octets[milieu + 1], octets[milieu + 2]];
    const egal = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    if (!egal(premier, attendu.haut) || !egal(dernier, attendu.bas)) {
      console.log(
        `    ${attendu.cote} : premier pixel [${premier}] (attendu [${attendu.haut}]), ` +
          `dernier [${dernier}] (attendu [${attendu.bas}])`,
      );
      ecartsPixels += 1;
    }
  }
  check(
    'la moitié haute est la première, et chaque page est à sa place',
    ecartsPixels === 0,
    ecartsPixels ? `${ecartsPixels} écart(s)` : 'aucun retournement, aucune inversion',
  );
}

/* ══════════════ 4. Les modes couleur et la conformité ══════════════ */

titre('couleurs : l’espace des images, et la conformité revendiquée');

{
  const cas = CONFIGURATIONS[0];
  const espaces = {};
  for (const [mode, attendu] of [
    ['rvb', '/DeviceRGB'],
    ['cmjn', '/DeviceCMYK'],
    ['gris', '/DeviceGray'],
  ]) {
    const { pdf } = assembler(`mode-${mode}`, spec(cas), mode, true, 'flate');
    const document = await PDFLib.PDFDocument.load(pdf, { updateMetadata: false });
    const listes = images(document, document.getPages()[0]);
    espaces[mode] = listes.map((i) => i.espace);
    check(
      `mode ${mode} : ${listes.length} image(s) en ${attendu}`,
      listes.length === 2 && listes.every((i) => i.espace === attendu),
      listes.map((i) => i.espace).join(', '),
    );
  }
  // Et le CMJN pèse exactement quatre tiers du RVB : quatre canaux au lieu de
  // trois, avant compression. C'est la mesure qui dit que la conversion a
  // réellement eu lieu, et pas seulement que l'étiquette a changé.
  const rvb = readFileSync(join(dossier, 'mode-rvb.pdf')).length;
  const cmjn = readFileSync(join(dossier, 'mode-cmjn.pdf')).length;
  check(
    'le fichier CMJN est plus lourd que le RVB (quatre canaux, pas trois)',
    cmjn > rvb,
    `${cmjn} octets contre ${rvb}`,
  );
}

{
  // PDF/X-1a : CMJN, profil de sortie, et la déclaration dans `/Info` **et**
  // dans le paquet XMP.
  const icc = join(parent, '_dev', 'fixtures-396', 'public', 'superprint', 'app', 'icc', 'CoatedFOGRA39.icc');
  const cheminIcc = existsSync(icc)
    ? icc
    : join(parent, 'superprint', 'app', 'icc', 'CoatedFOGRA39.icc');
  if (!existsSync(cheminIcc)) {
    console.log('  (profil ICC absent du dépôt : contrôle de PDF/X ignoré)');
  } else {
    // ⚠️ Le banc tourne en **WebAssembly**, et le bac à sable ne voit que le
    // dossier de travail : le profil est donc **copié dans `target/`** et passé
    // en chemin relatif. Un chemin absolu — ou même traversant `../` — échoue à
    // l'ouverture, et l'échec ressemblerait à un bug du noyau.
    const iccLocal = join(dossier, 'profil.icc');
    writeFileSync(iccLocal, readFileSync(cheminIcc));
    const { pdf, code, sortie } = assembler(
      'pdfx',
      spec(CONFIGURATIONS[0]),
      'cmjn',
      true,
      'flate',
      'target/montage/profil.icc',
    );
    if (!pdf) {
      check('le PDF/X s’assemble', false, `code ${code} — ${sortie.trim().split('\n')[0] ?? ''}`);
    } else {
      const brut = pdf.toString('latin1');
      check('la clé `/GTS_PDFXVersion` est écrite', brut.includes('/GTS_PDFXVersion'));
      check(
        'l’orthographe exacte est respectée',
        brut.includes('PDF/X-1a:2001'),
        'un validateur compare caractère par caractère',
      );
      check('le profil est embarqué comme `/DestOutputProfile`', brut.includes('/DestOutputProfile'));
      check('le paquet XMP est présent', brut.includes('pdfaid:part'));
      const document = await PDFLib.PDFDocument.load(pdf, { updateMetadata: false });
      const listes = images(document, document.getPages()[0]);
      check(
        'et aucune image RVB ne s’y est glissée',
        listes.every((i) => i.espace !== '/DeviceRGB'),
        listes.map((i) => i.espace).join(', '),
      );
    }
  }
}

/* ══════════════ 5. Les refus ══════════════ */

titre('refus explicites');

{
  // Une spécification sans ligne `!page` : refusée, et le code le dit.
  const r = assembler('refus-spec', '!fond\t3\t1\n', 'rvb', true, 'auto');
  check('une spécification sans `!page` est refusée', r.code === 3, `code ${r.code}`);

  // Un mode inconnu : refusé.
  const r2 = assembler('refus-mode', spec(CONFIGURATIONS[0]), 'tsv', true, 'auto');
  check('un mode inconnu est refusé', r2.code === 2, `code ${r2.code}`);

  // Et le refus qui compte le plus : revendiquer PDF/X-1a en RVB. Le banc ne
  // peut pas le provoquer par ses arguments (il n'active la conformité qu'en
  // CMJN) — c'est donc un test unitaire du crate qui le couvre, et il est cité
  // ici pour que le lecteur sache où il est.
  console.log(
    '  ⚠️ `PDF/X-1a` revendiqué en RVB est refusé par le noyau : couvert par\n' +
      '     `crates/superprint-montage/src/lib.rs::revendiquer_pdfx1a_en_rvb_est_refuse`.',
  );
}

console.log(
  ok
    ? '\nOK : la planche imposée est conforme — boîtes, places, rognage, sens, couleurs.'
    : '\n✗ la planche imposée n’est pas conforme.',
);
process.exit(ok ? 0 : 1);
