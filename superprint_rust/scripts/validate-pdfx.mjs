/* ══════════════════════════════════════════════════════════════════════════
   validate-pdfx.mjs — la revendication PDF/X, contrôlée sur le fichier produit.

   Un fichier PDF/X « a l'air » d'un PDF : bonnes boîtes, bon profil, et il passe
   pour un PDF d'imprimeur. Ce qui le distingue, c'est la **déclaration** : un
   paquet XMP qui dit ce que le fichier promet, et une clé `/GTS_PDFXVersion` qui
   le répète dans le dictionnaire `/Info`. Ce script vérifie cette déclaration sur
   le fichier réel, et pas sur la structure en mémoire qui l'a produite.

   Il contrôle :

     · que `pdf-lib` (le lecteur emprunté au produit) ouvre le fichier ;
     · que les métadonnées du `/Info` ressortent (titre, auteur, producteur, date) ;
     · que le paquet XMP est là, encadré par ses marqueurs, **bien formé**, et
       qu'il porte `pdfaid:part`, `pdfaid:conformance` et `pdfx:GTS_PDFXVersion` ;
     · que `/GTS_PDFXVersion` est aussi dans le `/Info` ;
     · que l'`OutputIntent` porte `/S /GTS_PDFX`, et que les octets du profil ICC
       embarqués sont **identiques à ceux du fichier de profil** ;
     · que PDF/X sans `OutputIntent` est **refusé à l'écriture** au lieu de
       produire un faux ;
     · qu'un fichier sans PDF/X ne porte ni XMP ni déclaration.

   Usage : node scripts/validate-pdfx.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const produit = join(racine, '..', 'superprint');
const pdfLib = require(join(produit, 'app', 'JS', 'pdf-lib.min.js'));
const profil = join(produit, 'app', 'icc', 'CoatedFOGRA39.icc');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'pdfx_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);
const info = (t) => console.log(`  ${t}`);

if (!existsSync(cheminExemple)) {
  console.error(`introuvable : ${cheminExemple}`);
  console.error('(construire : cargo build -p superprint-pdf --example pdfx_dump --target wasm32-wasip1 --release)');
  process.exit(2);
}

const dossier = join(racine, 'target', 'pdfx');
mkdirSync(dossier, { recursive: true });
const temporaire = (nom) => join(dossier, nom);

/** Lance l'exemple. Rend `{ code, sortie }` au lieu de lever : un refus est un
    résultat attendu pour certains cas, pas une panne du contrôle. */
function lancer(...args) {
  const traduits = args.map((a) =>
    typeof a === 'string' && a.startsWith(dossier)
      ? a.slice(racine.length + 1).split('\\').join('/')
      : a,
  );
  try {
    const sortie = execFileSync(
      process.execPath,
      [join(racine, 'scripts', 'run-wasi.mjs'), cheminExemple, ...traduits],
      { stdio: 'pipe', cwd: racine },
    );
    return { code: 0, sortie: sortie.toString() };
  } catch (e) {
    return {
      code: e.status ?? 1,
      sortie: `${(e.stdout ?? Buffer.alloc(0)).toString()}${(e.stderr ?? Buffer.alloc(0)).toString()}`,
    };
  }
}

const DATE = '2026-10-11T09:30:00Z';

/* Les profils sont COPIÉS dans le dossier de travail : le bac à sable WASI ne
   préouvre que le dépôt, donc un chemin absolu Windows n'y existe pas. */
const profilLocal = temporaire('profil.icc');
writeFileSync(profilLocal, readFileSync(profil));
const profilBrut = readFileSync(profil);

/* Extrait le paquet XMP d'un PDF et vérifie sa **bonne formation** par un
   contrôle d'équilibre des balises. Ce n'est pas un analyseur XML complet :
   c'est un contrôle structurel, et il est dit comme tel. */
function paquetXmp(texte) {
  const debut = texte.indexOf('<?xpacket begin=');
  const fin = texte.indexOf('<?xpacket end=');
  if (debut < 0 || fin < 0) return null;
  return texte.slice(debut, fin + '<?xpacket end="w"?>'.length);
}

function xmlEquilibre(xml) {
  const pile = [];
  const balises = xml.match(/<\/?[A-Za-z_][^>]*?\/?>/g) ?? [];
  for (const brut of balises) {
    if (brut.startsWith('<?') || brut.startsWith('<!')) continue;
    /* Le nom : on retire `<` et un éventuel `/` DE TÊTE, puis on coupe au
       premier espace, `/` ou `>`. Couper naïvement sur `/` donnerait une chaîne
       vide pour toute balise fermante — et ferait échouer ce contrôle sur un
       paquet parfaitement valide. */
    const nom = brut.replace(/^<\/?/, '').split(/[\s/>]/)[0];
    if (brut.endsWith('/>')) continue;
    if (brut.startsWith('</')) {
      if (pile.pop() !== nom) return `</${nom}> ferme autre chose`;
    } else {
      pile.push(nom);
    }
  }
  return pile.length === 0 ? null : `${pile.length} balise(s) non fermée(s) : ${pile.join(', ')}`;
}

/* ───────────────────── 1. les trois conformités ───────────────────── */

titre('les trois conformités : déclaration, XMP, profil embarqué');

for (const [etiquette, nom] of [['1a', 'PDF/X-1a:2001'], ['3', 'PDF/X-3:2002'], ['4', 'PDF/X-4']]) {
  const sortie = temporaire(`document-${etiquette}.pdf`);
  const resultat = lancer(etiquette, profilLocal, DATE, sortie);
  if (resultat.code !== 0) {
    check(`${nom} : fichier produit`, false, `code ${resultat.code} ${resultat.sortie}`);
    continue;
  }

  const octets = readFileSync(sortie);
  const texte = octets.toString('latin1');
  info(`${nom} : ${Math.round(octets.length / 1024)} Ko`);

  /* pdf-lib : un lecteur tiers, éprouvé. */
  let document = null;
  let erreurLib = '';
  try {
    document = await pdfLib.PDFDocument.load(octets, { updateMetadata: false });
  } catch (e) {
    erreurLib = String(e.message ?? e);
  }
  check(`${nom} : pdf-lib ouvre le fichier`, document !== null, erreurLib ? erreurLib.slice(0, 80) : `${document?.getPageCount()} page(s)`);

  if (document) {
    check(`${nom} : une page`, document.getPageCount() === 1);
    check(`${nom} : titre relu par pdf-lib`, document.getTitle() === 'Brochure & fond perdu', `${document.getTitle()}`);
    check(`${nom} : auteur relu par pdf-lib`, document.getAuthor() === 'Atelier Dupont', `${document.getAuthor()}`);
    check(`${nom} : producteur relu`, document.getProducer() === 'SuperPrint (noyau Rust)', `${document.getProducer()}`);
    const date = document.getCreationDate();
    check(`${nom} : date de création relue`, date instanceof Date && !Number.isNaN(date.getTime()), `${date}`);
    const page = document.getPage(0);
    check(
      `${nom} : format fini A4 (595 × 842 pt)`,
      Math.abs(page.getTrimBox().width - 595.28) < 0.5 && Math.abs(page.getTrimBox().height - 841.89) < 0.5,
      `${page.getTrimBox().width.toFixed(1)} × ${page.getTrimBox().height.toFixed(1)}`,
    );
  }

  /* La déclaration, dans le texte brut du fichier. */
  check(`${nom} : /GTS_PDFXVersion dans le /Info`, texte.includes('/GTS_PDFXVersion'));
  check(`${nom} : la version exacte y figure`, texte.includes(`(${nom})`), nom);
  check(`${nom} : /OutputIntents avec /S /GTS_PDFX`, texte.includes('/OutputIntents [') && texte.includes('/S /GTS_PDFX'));
  check(`${nom} : /DestOutputProfile présent`, texte.includes('/DestOutputProfile'));
  check(`${nom} : 4 composantes déclarées`, texte.includes('/N 4'));

  /* Le paquet XMP. */
  const paquet = paquetXmp(texte);
  check(`${nom} : paquet XMP présent et encadré`, paquet !== null);
  if (paquet) {
    const desequilibre = xmlEquilibre(paquet);
    check(`${nom} : paquet XMP bien formé (balises équilibrées)`, desequilibre === null, desequilibre ?? '');
    check(`${nom} : pdfx:GTS_PDFXVersion`, paquet.includes(`<pdfx:GTS_PDFXVersion>${nom}</pdfx:GTS_PDFXVersion>`));
    check(`${nom} : pdfxid:GTS_PDFXVersion`, paquet.includes('<pdfxid:GTS_PDFXVersion>'));
    const partie = { 'PDF/X-1a:2001': '1', 'PDF/X-3:2002': '3', 'PDF/X-4': '4' }[nom];
    const conformance = nom.includes('1a') ? 'A' : 'B';
    check(`${nom} : pdfaid:part = ${partie}`, paquet.includes(`<pdfaid:part>${partie}</pdfaid:part>`));
    check(`${nom} : pdfaid:conformance = ${conformance}`, paquet.includes(`<pdfaid:conformance>${conformance}</pdfaid:conformance>`));
    check(`${nom} : le titre du document est dans le XMP`, paquet.includes('Brochure &amp; fond perdu'));
    check(`${nom} : date ISO 8601 dans le XMP`, paquet.includes(DATE));
    check(`${nom} : rembourrage du paquet`, paquet.length >= 2048, `${paquet.length} octets`);
  } else {
    for (let i = 0; i < 6; i += 1) check(`${nom} : propriété XMP ${i}`, false);
  }

  /* Les octets du profil : embarqués **tels quels**. Une ré-écriture, une
     compression ou un décalage d'un octet produirait un PDF/X qui déclare un
     profil et en contient un autre. */
  const aiguille = profilBrut.subarray(1024, 1024 + 64);
  const position = octets.indexOf(aiguille);
  check(
    `${nom} : le profil ICC est embarqué octet pour octet`,
    position > 0,
    position > 0 ? `trouvé à ${position}` : 'séquence témoin introuvable',
  );
  if (position > 0) {
    const debut = position - 1024;
    const identique = Buffer.compare(octets.subarray(debut, debut + profilBrut.length), profilBrut) === 0;
    check(`${nom} : et il l'est sur toute sa longueur (${Math.round(profilBrut.length / 1024)} Ko)`, identique);
  }
}

/* ───────────────────── 2. les refus ───────────────────── */

titre('les refus : un faux PDF/X ne s’écrit pas');

{
  /* PDF/X exige un OutputIntent : sans lui, le noyau doit REFUSER d'écrire. */
  const sortie = temporaire('sans-sortie.pdf');
  rmSync(sortie, { force: true });
  const resultat = lancer('3', '-', DATE, sortie);
  check(
    'PDF/X sans OutputIntent : refusé à l’écriture',
    resultat.code === 3 && resultat.sortie.includes("PDF/X l'exige"),
    `code ${resultat.code} · ${resultat.sortie.trim().slice(0, 80)}`,
  );
  check('et aucun fichier n’a été écrit', !existsSync(sortie));
}

{
  /* Un profil qui n'est pas un profil : refusé avant d'écrire. */
  const faux = temporaire('faux.icc');
  writeFileSync(faux, Buffer.from('ceci n est pas un profil ICC'));
  const sortie = temporaire('faux.pdf');
  rmSync(sortie, { force: true });
  const resultat = lancer('3', faux, DATE, sortie);
  check(
    'un fichier qui n’est pas un profil ICC est refusé',
    resultat.code === 2 && resultat.sortie.includes('refusé'),
    `code ${resultat.code} · ${resultat.sortie.trim().slice(0, 90)}`,
  );
  check('et aucun PDF n’est écrit', !existsSync(sortie));
}

{
  /* Un profil d'écran : structure valide, et il ne doit pas servir de sortie. */
  const ecran = Buffer.from(profilBrut);
  ecran.write('mntr', 12, 'latin1');
  ecran.write('RGB ', 16, 'latin1');
  const chemin = temporaire('ecran.icc');
  writeFileSync(chemin, ecran);
  const sortie = temporaire('ecran.pdf');
  rmSync(sortie, { force: true });
  const resultat = lancer('3', chemin, DATE, sortie);
  check(
    'un profil d’affichage est refusé comme OutputIntent',
    resultat.code === 2 && resultat.sortie.includes('profil de sortie'),
    `code ${resultat.code} · ${resultat.sortie.trim().slice(0, 90)}`,
  );
  check("et aucun PDF n'est écrit", !existsSync(sortie));
}

/* ───────────────────── 3. le contrôle négatif ───────────────────── */

titre('le contrôle négatif : sans PDF/X, aucune déclaration');

{
  /* Le document témoin : même contenu, même profil, AUCUNE revendication. Il ne
     doit porter ni paquet XMP, ni /GTS_PDFXVersion. Sans ce témoin, la
     vérification ci-dessus ne prouverait rien : elle trouverait ces clés même
     sur un fichier qui ne les mérite pas. */
  const sortie = temporaire('sans-pdfx.pdf');
  const resultat = lancer('-', profilLocal, DATE, sortie);
  check('témoin sans revendication : fichier produit', resultat.code === 0, `code ${resultat.code} ${resultat.sortie.slice(0, 80)}`);
  if (resultat.code === 0) {
    const octets = readFileSync(sortie);
    const texte = octets.toString('latin1');
    check('témoin : aucun paquet XMP', paquetXmp(texte) === null);
    check('témoin : pas de /Metadata', !texte.includes('/Metadata'));
    check('témoin : pas de /GTS_PDFXVersion', !texte.includes('/GTS_PDFXVersion'));
    /* Mais le profil est bien là : un document ordinaire peut porter un
       OutputIntent sans revendiquer PDF/X. */
    check('témoin : l’OutputIntent et le profil sont là', texte.includes('/OutputIntents [') && texte.includes('/DestOutputProfile'));
    /* Et pdf-lib l'ouvre quand même. */
    const document = await pdfLib.PDFDocument.load(octets, { updateMetadata: false });
    check('témoin : pdf-lib ouvre le fichier sans XMP', document.getPageCount() === 1);
  }
}

console.log(`\n${ok ? 'OK : la déclaration PDF/X est écrite, exacte, et refusée quand elle serait un mensonge.' : 'ÉCHEC : voir les lignes \u2717 ci-dessus.'}`);
process.exit(ok ? 0 : 1);
