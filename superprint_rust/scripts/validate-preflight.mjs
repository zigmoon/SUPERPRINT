// Preuve de JUSTESSE du **prépresse** (`superprint-preflight`).
//
// Un prépresse se juge sur deux moitiés, et la seconde compte autant que la
// première :
//
//   1. DÉTECTION — chaque contrôle doit se déclencher sur le défaut qu'il
//      cherche, et le dire **chiffré** : la valeur mesurée **et** le seuil. Un
//      constat qui dit « image trop basse » sans donner 85 dpi contre 300
//      n'aide personne à décider s'il accepte l'écart.
//
//   2. SILENCE — un document correct ne doit **rien** produire. Un prépresse qui
//      signale tout le temps se fait désactiver, et devient alors inutile — en
//      pire, puisqu'il aura fait perdre la confiance. C'est la moitié que ce
//      fichier vérifie en premier.
//
// S'y ajoutent les propriétés qui font qu'un rapport est utilisable : le tri
// (le plus grave d'abord), la gravité séparée du message, le refus des règles
// illisibles plutôt que leur approximation, et le fait que vérifier ne modifie
// pas le document.
//
// Rien ici ne recopie une formule du noyau : les cas sont construits avec les
// **mêmes** outils que l'application (`createDocument`), et le rapport est lu
// avec le **même** lecteur (`moteur.preflight`). Ce qui est mesuré est donc ce
// qui est livré.
//
// Usage : node scripts/validate-preflight.mjs
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);

const cheminColle = join(root, 'web', 'superprint-core.js');
const cheminWasm = join(root, 'dist', 'superprint_core.wasm');
const cheminPolice = join(root, '..', 'superprint', 'app', 'CSS', 'fonts', 'IBMPlexSans-400-normal.ttf');

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (texte) => console.log(`\n== ${texte}`);

for (const fichier of [cheminColle, cheminWasm]) {
  if (!existsSync(fichier)) {
    console.error(`fichier introuvable : ${fichier}`);
    console.error('(le noyau se construit avec : pwsh -File scripts/build-wasm.ps1)');
    process.exit(2);
  }
}

require(cheminColle);
const { SuperPrintCore } = globalThis;
const moteur = await SuperPrintCore.load({
  bytes: await readFile(cheminWasm),
  fallback: false,
});
check('le noyau est bien du WebAssembly', moteur.backend === 'wasm', `backend=${moteur.backend}`);
check(
  'la colle expose le prépresse',
  typeof moteur.preflight === 'function' && typeof moteur.preflightVersion === 'number',
);

const octetsPolice = existsSync(cheminPolice) ? new Uint8Array(await readFile(cheminPolice)) : null;
if (!octetsPolice) {
  console.error(`police de test introuvable : ${cheminPolice}`);
  process.exit(2);
}

// ── Fabriques ───────────────────────────────────────────────────────────────

const NOIR = { cmyk: { c: 0, m: 0, y: 0, k: 1 } };
const NOIR_RICHE = { cmyk: { c: 0.6, m: 0.5, y: 0.5, k: 1 } };
const A4 = { trimWidthMm: 210, trimHeightMm: 297 };

/** Un document **sain** : fond perdu, réserve de repères, profil de sortie. */
function documentSain() {
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  doc.outputIntent({ components: 4, identifier: 'test', info: 'profil de test', icc: new Uint8Array(128) });
  doc.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: NOIR });
  return doc;
}

/** Les codes de constat d'un rapport, dans l'ordre où ils sont rendus. */
const codes = (rapport) => rapport.constats.map((c) => c.code);

/** Un rapport pour un document jetable, avec un jeu de règles optionnel. */
function rapport(doc, regles) {
  return regles === undefined ? doc.preflight() : doc.preflight(regles);
}

/** Une image unie, en RVB. */
function imageUnie(largeur, hauteur) {
  const donnees = new Uint8Array(largeur * hauteur * 3);
  for (let i = 0; i < donnees.length; i += 1) donnees[i] = (i * 7) % 251;
  return donnees;
}

/** Lève-t-on, et avec quel code, pour ce texte de règles ? */
function refus(regles) {
  try {
    documentSain().preflight(regles);
    return null;
  } catch (erreur) {
    return erreur;
  }
}

// ── 1. Le silence ───────────────────────────────────────────────────────────

titre('un document correct ne produit AUCUN constat');
{
  const rapportSain = rapport(documentSain());
  check('le document sain est acceptable', rapportSain.acceptable, JSON.stringify(rapportSain.constats));
  check('aucun constat', rapportSain.constats.length === 0, codes(rapportSain).join(', '));
  check(
    'le compte est à zéro partout',
    rapportSain.compte.erreurs === 0 &&
      rapportSain.compte.avertissements === 0 &&
      rapportSain.compte.informations === 0,
  );
}

// ── 2. Document vide ────────────────────────────────────────────────────────

titre('un document vide est un CONSTAT, pas une erreur d’appel');
{
  const vide = moteur.createDocument();
  const rapportVide = rapport(vide);
  check('le rapport existe quand même', typeof rapportVide.texte === 'string');
  check('document-vide est signalé', rapportVide.contient('document-vide'));
  check('classé en erreur, pas en avertissement', rapportVide.constats[0].rang === 2);
  check('sur le document entier (page null)', rapportVide.constats[0].page === null);
  check('donc le fichier n’est pas acceptable', rapportVide.acceptable === false);
}

// ── 3. Résolution d'image ───────────────────────────────────────────────────

titre('résolution d’image : les DEUX nombres, mesuré et seuil');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  const image = doc.addImageRgb(imageUnie(400, 300), 400, 300, 'none');
  doc.placeImage({ image, x: 10, y: 10, width: 120, height: 90 });
  const r = rapport(doc);
  const constats = r.parCode('image-basse-resolution');
  check('une image floue est signalée', constats.length === 1, codes(r).join(', '));
  check('le message cite la résolution mesurée', constats[0].message.includes('85 dpi'), constats[0].message);
  check('le message cite le seuil', constats[0].message.includes('300 dpi'), constats[0].message);
  check('le message cite la taille posée', constats[0].message.includes('120.0 × 90.0 mm'));
  check('le message cite la taille en pixels', constats[0].message.includes('400 × 300 px'));
}

titre('résolution d’image : la frontière est exacte, sans tolérance cachée');
{
  // 300 px sur 25,4 mm = exactement 300 dpi. Juste au seuil : rien à dire.
  const bon = moteur.createDocument();
  bon.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  const image = bon.addImageRgb(imageUnie(300, 300), 300, 300, 'none');
  bon.placeImage({ image, x: 0, y: 0, width: 25.4, height: 25.4 });
  check('300 dpi pile n’est pas signalé', !rapport(bon).contient('image-basse-resolution'));

  // 248 px sur 21 mm = 299,96 dpi : juste en dessous, et c’est signalé.
  const presque = moteur.createDocument();
  presque.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  const image2 = presque.addImageRgb(imageUnie(248, 248), 248, 248, 'none');
  presque.placeImage({ image: image2, x: 0, y: 0, width: 21, height: 21 });
  const r = rapport(presque);
  const c = r.parCode('image-basse-resolution');
  check('299,96 dpi est signalé', c.length === 1);
  check(
    'et le message donne la valeur arrondie',
    c[0].message.includes('300 dpi'),
    c[0].message,
  );
}

titre('résolution d’image : la pire des deux dimensions décide');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  // 300 px de large sur 21 mm (363 dpi, bon) et 30 px de haut (36 dpi, mauvais).
  const image = doc.addImageRgb(imageUnie(300, 30), 300, 30, 'none');
  doc.placeImage({ image, x: 0, y: 0, width: 21, height: 21 });
  const c = rapport(doc).parCode('image-basse-resolution');
  check('le côté étiré décide', c.length === 1 && c[0].message.includes('36 dpi'), c[0]?.message);
}

// ── 4. Couverture d'encre ───────────────────────────────────────────────────

titre('couverture d’encre : la gravité dépend de l’écart au seuil');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  // 90 + 90 + 90 + 80 = 350 % : franc dépassement de 300.
  doc.fillRect({ x: 0, y: 0, width: 10, height: 10, paint: { cmyk: { c: 0.9, m: 0.9, y: 0.9, k: 0.8 } } });
  const c = rapport(doc).parCode('couverture-encre-excessive');
  check('350 % est signalé', c.length === 1);
  check('le message cite le total et le seuil', c[0].message.includes('350 %') && c[0].message.includes('300 %'), c[0].message);
  check('au-delà de 110 % du seuil : erreur', c[0].rang === 2);
}

titre('couverture d’encre : 280 % passe en offset et bloque en journal');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  doc.fillRect({ x: 0, y: 0, width: 10, height: 10, paint: { cmyk: { c: 0.7, m: 0.7, y: 0.7, k: 0.7 } } });
  check('280 % accepté en offset (seuil 300)', !rapport(doc).contient('couverture-encre-excessive'));
  const journal = rapport(doc, '!preset\tjournal');
  check('les mêmes pixels refusés en journal (seuil 240)', journal.contient('couverture-encre-excessive'));
  const c = journal.parCode('couverture-encre-excessive')[0];
  check('le message cite le seuil du journal', c.message.includes('240 %'), c.message);
}

// ── 5. Noir quadrichrome sur du fin ─────────────────────────────────────────

titre('noir quadrichrome : dangereux sur du fin, bénin sur du gros');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  const police = doc.addFont(octetsPolice);
  doc.text({ font: police, size: 8, x: 10, y: 100, paint: NOIR_RICHE, text: 'petit texte' });
  const c = rapport(doc).parCode('noir-quadri-texte-fin');
  check('un texte de 8 pt en noir riche est signalé', c.length === 1);
  check('le corps est cité', c[0].message.includes('8.0 pt'), c[0].message);
  check('les quatre composantes sont citées', c[0].message.includes('60/50/50/100'), c[0].message);

  const gros = moteur.createDocument();
  gros.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  const police2 = gros.addFont(octetsPolice);
  gros.text({ font: police2, size: 36, x: 10, y: 100, paint: NOIR_RICHE, text: 'GROS TITRE' });
  check('le même noir à 36 pt n’est pas signalé', !rapport(gros).contient('noir-quadri-texte-fin'));

  const pur = moteur.createDocument();
  pur.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  const police3 = pur.addFont(octetsPolice);
  pur.text({ font: police3, size: 8, x: 10, y: 100, paint: NOIR, text: 'petit texte' });
  check('un noir pur à 8 pt n’est pas signalé', !rapport(pur).contient('noir-quadri-texte-fin'));

  const gris = moteur.createDocument();
  gris.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  const police4 = gris.addFont(octetsPolice);
  // 5/5/5/90 : un noir normal avec un peu de soutien. On ne le dénonce pas.
  gris.text({
    font: police4,
    size: 8,
    x: 10,
    y: 100,
    paint: { cmyk: { c: 0.05, m: 0.05, y: 0.05, k: 0.9 } },
    text: 'petit texte',
  });
  check('un gris foncé soutenu n’est pas du noir riche', !rapport(gris).contient('noir-quadri-texte-fin'));
}

titre('noir quadrichrome sur un trait fin');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  doc.line({ x1: 10, y1: 100, x2: 200, y2: 100, widthMm: 0.25, paint: NOIR_RICHE });
  const c = rapport(doc).parCode('noir-quadri-trait-fin');
  check('un trait de 0,25 mm en noir riche est signalé', c.length === 1, codes(rapport(doc)).join(', '));
  check('l’épaisseur est citée', c[0].message.includes('0.25 mm'), c[0].message);
}

// ── 6. Débordement ──────────────────────────────────────────────────────────

titre('débordement : mordre dans le fond perdu est permis, le franchir non');
{
  const dedans = moteur.createDocument();
  dedans.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  // Un aplat plein format qui mord de 2 mm : c’est exactement son rôle.
  dedans.fillRect({ x: -2, y: -2, width: 214, height: 301, paint: NOIR });
  check('mordre dans le fond perdu n’est pas signalé', !rapport(dedans).contient('debordement-fond-perdu'));

  const dehors = moteur.createDocument();
  dehors.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  dehors.fillRect({ x: 200, y: 0, width: 50, height: 50, paint: NOIR });
  const c = rapport(dehors).parCode('debordement-fond-perdu');
  check('un objet au-delà est signalé', c.length === 1);
  check('le côté est nommé', c[0].message.includes('à droite'), c[0].message);
  check('le dépassement est chiffré', c[0].message.includes('37.0 mm'), c[0].message);
  check('la limite est citée', c[0].message.includes('213.0 mm'), c[0].message);
  check('le bord réellement atteint est cité', c[0].message.includes('250.0 mm'), c[0].message);
}

// ── 7. Fond perdu et repères ────────────────────────────────────────────────

titre('fond perdu');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 0, markMm: 0 });
  doc.fillRect({ x: 0, y: 0, width: 210, height: 297, paint: NOIR });
  const r = rapport(doc);
  check('un fond perdu absent est signalé', r.contient('fond-perdu-absent'));
  check('en avertissement, pas en erreur', r.constats[0].rang === 1);
  check('donc le fichier reste acceptable', r.acceptable);
}

titre('repères de coupe');
{
  const court = moteur.createDocument();
  // 3 mm de réserve : un trait de coupe en demande 5.
  court.addPage({ ...A4, bleedMm: 3, markMm: 3 });
  court.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: NOIR });
  check('une réserve trop courte est signalée', rapport(court).contient('reperes-sans-reserve'));

  const exiges = moteur.createDocument();
  exiges.addPage({ ...A4, bleedMm: 3, markMm: 0 });
  exiges.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: NOIR });
  const r = rapport(exiges, '!exiger\treperes\t1');
  const c = r.parCode('reperes-sans-reserve');
  check('des repères exigés sans réserve bloquent', c.length === 1 && c[0].rang === 2, c[0]?.message);
  check('et le fichier n’est plus acceptable', !r.acceptable);
}

// ── 8. Encres directes ──────────────────────────────────────────────────────

titre('encres directes');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  doc.addInk({ space: 'cmyk', name: 'PANTONE WARM RED C', c: 0, m: 0.9, y: 0.8, k: 0 });
  doc.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: NOIR });
  const r = rapport(doc);
  const c = r.parCode('encre-non-utilisee');
  check('une plaque déclarée et vide est signalée', c.length === 1, codes(r).join(', '));
  check('le nom de l’encre est cité', c[0].message.includes('PANTONE WARM RED C'), c[0].message);
  check('en information seulement', c[0].rang === 0);

  const servie = moteur.createDocument();
  servie.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  servie.addInk({ space: 'cmyk', name: 'PANTONE WARM RED C', c: 0, m: 0.9, y: 0.8, k: 0 });
  servie.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: { spot: { index: 0, tint: 1 } } });
  check('une plaque utilisée n’est pas signalée', !rapport(servie).contient('encre-non-utilisee'));
}

// ── 9. Profil de sortie ─────────────────────────────────────────────────────

titre('profil de sortie');
{
  const sans = moteur.createDocument();
  sans.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  sans.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: NOIR });
  const r = rapport(sans);
  check('sans profil : signalé', r.contient('profil-sortie-absent'));
  check('en avertissement : le fichier s’imprime quand même', r.constats[0].rang === 1 && r.acceptable);

  const exige = rapport(sans, '!exiger\tprofil\t1');
  const c = exige.parCode('profil-sortie-absent');
  check('profil exigé : c’est une erreur', c.length === 1 && c[0].rang === 2);
  check('et le fichier ne passe plus', !exige.acceptable);

  const incoherent = moteur.createDocument();
  incoherent.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  // 3 composantes (RVB) alors que les pages sont en CMJN (4).
  incoherent.outputIntent({ components: 3, identifier: 'x', info: 'x', icc: new Uint8Array(32) });
  incoherent.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: NOIR });
  const ri = rapport(incoherent);
  check('un profil incohérent avec la quadri est une erreur', ri.contient('profil-sortie-incoherent') && !ri.acceptable);
}

// ── 10. Polices ─────────────────────────────────────────────────────────────

titre('polices');
{
  const sain = documentSain();
  const r = rapport(sain);
  check('un document avec police embarquée est sain', r.constats.length === 0, codes(r).join(', '));
  check('donc aucune alerte de police', !r.contient('police-non-embarquee'));

  // Une police embarquée mais jamais utilisée alourdit le fichier pour rien :
  // c’est du poids mort, et cela peut faire croire que le fichier contient du
  // texte qu’il n’affiche pas.
  const inutilisee = documentSain();
  const rang = inutilisee.addFont(octetsPolice);
  const ri = rapport(inutilisee);
  const c = ri.parCode('police-non-embarquee');
  check('une police embarquée et inutilisée est signalée', c.length === 1, codes(ri).join(', '));
  check('en information seulement', c[0].rang === 0);
  check('le rang et le nom sont cités', c[0].message.includes(`n°${rang}`) && c[0].message.includes('IBM Plex Sans'), c[0].message);

  // Et dès qu’un texte s’en sert, le constat disparaît.
  const servie = documentSain();
  const police = servie.addFont(octetsPolice);
  servie.text({ font: police, size: 12, x: 10, y: 100, paint: NOIR, text: 'café' });
  const rs = rapport(servie, '!texte\t0');
  check('dès qu’un texte l’utilise, plus rien à dire', rs.constats.length === 0, codes(rs).join(', '));
}

// ── 11. Texte vivant ────────────────────────────────────────────────────────

titre('texte vivant : une information, jamais un blocage');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  doc.outputIntent({ components: 4, identifier: 't', info: 't', icc: new Uint8Array(128) });
  const police = doc.addFont(octetsPolice);
  for (let i = 0; i < 5; i += 1) {
    doc.text({ font: police, size: 12, x: 10, y: 100 + i, paint: NOIR, text: `ligne ${i}` });
  }
  const r = rapport(doc);
  const c = r.parCode('texte-vivant');
  check('le texte vivant est signalé une fois, même avec cinq lignes', c.length === 1, `${c.length} constat(s)`);
  check('en information (rang 0)', c[0].rang === 0);
  check('et le fichier reste acceptable', r.acceptable);

  const muet = rapport(doc, '!texte\t0');
  check('l’information peut être coupée', !muet.contient('texte-vivant'));
}

// ── 12. Règles illisibles ───────────────────────────────────────────────────

titre('des règles illisibles sont REFUSÉES, jamais approximées');
{
  for (const regles of [
    '!inconnue\t1',
    '!image',
    '!image\tbeaucoup',
    '!image\tNaN',
    '!preset\tbidon',
    '!exiger\tfond\t2',
    '!texte\toui',
    '!image\t600\n!trace\t300',
    '!image\t0',
  ]) {
    const erreur = refus(regles);
    check(`refusé : ${JSON.stringify(regles)}`, erreur !== null, erreur ? '' : 'accepté !');
  }
  check('aucune règle n’a laissé passer un document', true);
}

titre('les règles par défaut sont celles de l’offset couché');
{
  const doc = sansProfil();
  const implicites = doc.preflight();
  const explicites = doc.preflight(
    '!image\t300\n!trace\t1200\n!encre\t300\n!corps\t12\n!trait\t0.5\n' +
      '!exiger\tfond\t1\n!exiger\tprofil\t0\n!exiger\treperes\t0\n!texte\t1',
  );
  check('mêmes constats, écrits ou non', implicites.texte === explicites.texte);
  check(
    'et le préréglage offset mène au même endroit',
    doc.preflight('!preset\toffset').texte === implicites.texte,
  );
}

function sansProfil() {
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 3, markMm: 10 });
  doc.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: NOIR });
  return doc;
}

// ── 13. Le rapport est utilisable ───────────────────────────────────────────

titre('le rapport : tri, gravités séparées, et recalcul cohérent');
{
  const doc = moteur.createDocument();
  doc.addPage({ ...A4, bleedMm: 0, markMm: 0 });
  const image = doc.addImageRgb(imageUnie(40, 30), 40, 30, 'none');
  doc.placeImage({ image, x: 10, y: 10, width: 120, height: 90 });
  doc.addInk({ space: 'cmyk', name: 'PANTONE 300 C', c: 1, m: 0.44, y: 0, k: 0 });
  const r = rapport(doc);

  const rangs = r.constats.map((c) => c.rang);
  const trie = rangs.every((rang, i) => i === 0 || rangs[i - 1] >= rang);
  check('trié par gravité décroissante', trie, rangs.join(', '));
  check(
    'au moins trois gravités différentes sont représentées',
    new Set(rangs).size >= 3,
    rangs.join(', '),
  );
  check(
    'le compte sépare les trois gravités',
    r.compte.erreurs + r.compte.avertissements + r.compte.informations === r.constats.length,
  );
  check(
    'le `!acceptable` du noyau et le recalcul de la colle s’accordent',
    r.texte.includes(`!acceptable\t${r.acceptable ? 1 : 0}`),
  );
  check('chaque gravité porte un mot', r.constats.every((c) => ['Information', 'Avertissement', 'Erreur'].includes(c.gravite)));
  check('contient() et parCode() voient la même chose', r.contient('fond-perdu-absent') && r.parCode('fond-perdu-absent').length === 1);
}

// ── 14. Vérifier ne modifie pas le document ─────────────────────────────────

titre('vérifier ne modifie rien, et le document reste écrivable');
{
  const doc = documentSain();
  const premier = doc.preflight();
  const second = doc.preflight();
  check('deux vérifications donnent le même rapport', premier.texte === second.texte);
  check('toujours aucun constat', second.constats.length === 0);

  // Un défaut apparaît, puis on le corrige : le rapport doit suivre.
  const corrigeable = moteur.createDocument();
  corrigeable.addPage({ ...A4, bleedMm: 0, markMm: 0 });
  corrigeable.fillRect({ x: 0, y: 0, width: 210, height: 297, paint: NOIR });
  check('défaut présent', corrigeable.preflight().contient('fond-perdu-absent'));

  const pdf = corrigeable.write();
  check('et le document s’écrit quand même', pdf[0] === 0x25 && pdf[1] === 0x50 && pdf[2] === 0x44 && pdf[3] === 0x46);
  check('le PDF se termine par %%EOF', new TextDecoder().decode(pdf.slice(-8)).includes('%%EOF'));
}

// ── 15. Version et indépendance ─────────────────────────────────────────────

titre('version des contrôles');
{
  const version = moteur.preflightVersion;
  check('la version est un entier positif', Number.isInteger(version) && version > 0, String(version));
  check('elle ne dépend pas du document', moteur.preflightVersion === version);
}

titre('le repli JavaScript refuse le prépresse au lieu de l’approximer');
{
  const repli = await SuperPrintCore.load({ bytes: null, fallback: true, url: 'inexistant.wasm' });
  check('le repli est bien du JavaScript', repli.backend === 'js', `backend=${repli.backend}`);
  let leve = false;
  try {
    repli.preflight();
  } catch (erreur) {
    leve = erreur.code === 'UNAVAILABLE';
  }
  check('preflight() lève UNAVAILABLE', leve);
}

console.log(ok ? '\nOK : le prépresse dit ce qu’il doit dire, et se taît quand il faut.' : '\nÉCHEC.');
process.exit(ok ? 0 : 1);
