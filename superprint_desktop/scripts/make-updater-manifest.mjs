/**
 * Fabrique les manifestes de mise à jour — un par application.
 *
 * POURQUOI CE SCRIPT EXISTE. Le plugin `updater` de Tauri ne lit pas une page
 * HTML : il lit un JSON qui dit, pour chaque plateforme, l'URL du paquet et la
 * **signature** de ce paquet. Ce JSON doit être régénéré à chaque version, sinon
 * les applications installées n'ont plus rien à interroger.
 *
 * OÙ IL EST PUBLIÉ. Sur la release GitHub `desktop-latest`, à côté des
 * installeurs : `latest-superprint.json`, `latest-studio.json`,
 * `latest-supertypo.json`. Chaque application interroge le sien (voir
 * `src-tauri/apps/<app>.json`). Un manifeste unique ne conviendrait pas : les
 * trois applications portent le même numéro de version mais sont trois produits
 * différents, avec trois paquets différents.
 *
 * CE QU'IL REFUSE DE FAIRE. Écrire un manifeste incomplet. Si la signature d'une
 * plateforme manque, le script échoue : un manifeste qui n'annonce que Windows
 * laisserait macOS et Linux sans mise à jour, et cela ne se verrait que des mois
 * plus tard, chez l'utilisateur. Un échec de build se voit tout de suite.
 *
 * Usage :
 *   node scripts/make-updater-manifest.mjs --dossier livraison --version 1.7.701
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest';
const SITE = 'https://superprint.cc/release.html';

/** Nom affiché → nom de fichier stable, tel que le job « Normaliser » les copie. */
const APPLICATIONS = {
  superprint: { prefixe: 'SuperPrint', nom: 'SuperPrint' },
  studio: { prefixe: 'Studio-IA', nom: 'Studio IA' },
  supertypo: { prefixe: 'SuperTyPo', nom: 'SuperTyPo' },
};

/**
 * Une entrée par cible Tauri. La clé est celle que le plugin cherche dans le
 * manifeste : `OS-ARCH`, exactement comme le nomme Tauri (`updater_os()`).
 *
 * Windows pointe le NSIS (`setup.exe`) et non le MSI : c'est le format que
 * l'updater sait exécuter en silence, et c'est celui que le site propose en
 * premier. Linux pointe l'AppImage, seul format qu'une application peut
 * remplacer elle-même sans les droits du gestionnaire de paquets.
 */
const CIBLES = [
  { cle: 'windows-x86_64', fichier: (p) => `${p}-Windows-x64-setup.exe` },
  { cle: 'darwin-aarch64', fichier: (p) => `${p}-macOS-AppleSilicon.app.tar.gz` },
  { cle: 'darwin-x86_64', fichier: (p) => `${p}-macOS-Intel.app.tar.gz` },
  { cle: 'linux-x86_64', fichier: (p) => `${p}-Linux-x86_64.AppImage` },
];

function argument(nom, defaut) {
  const i = process.argv.indexOf('--' + nom);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

const dossier = path.resolve(argument('dossier', 'livraison'));
const version = argument('version', '');

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`⛔ version invalide : « ${version} » (attendu X.Y.Z)`);
  process.exit(1);
}
if (!fs.existsSync(dossier)) {
  console.error(`⛔ dossier introuvable : ${dossier}`);
  process.exit(1);
}

const manquants = [];
const aEcrire = [];

for (const [cle, { prefixe, nom }] of Object.entries(APPLICATIONS)) {
  const platforms = {};

  for (const cible of CIBLES) {
    const fichier = cible.fichier(prefixe);
    const paquet = path.join(dossier, fichier);
    const signature = path.join(dossier, fichier + '.sig');

    if (!fs.existsSync(paquet)) { manquants.push(`${prefixe} / ${cible.cle} : paquet ${fichier}`); continue; }
    if (!fs.existsSync(signature)) { manquants.push(`${prefixe} / ${cible.cle} : signature ${fichier}.sig`); continue; }

    platforms[cible.cle] = {
      // Le contenu du .sig, pas son chemin : le plugin hachaît ce texte pour
      // vérifier le paquet téléchargé. Une URL ou un chemin ne marcheraient pas.
      signature: fs.readFileSync(signature, 'utf8').trim(),
      url: `${BASE_URL}/${encodeURIComponent(fichier)}`,
    };
  }

  if (Object.keys(platforms).length !== CIBLES.length) continue;

  const manifeste = {
    version,
    // Le plugin affiche ces notes dans notre dialogue (`maj.rs` en garde six
    // lignes). Une phrase suffit : la vraie note de version est sur le site.
    notes: `${nom} ${version} — notes : ${SITE}`,
    pub_date: new Date().toISOString(),
    platforms,
  };

  const sortie = path.join(dossier, `latest-${cle}.json`);
  aEcrire.push({ sortie, manifeste, plateformes: Object.keys(platforms) });
}

/* Rien n'est écrit AVANT le contrôle : un manifeste partiel publié vaudrait
   moins qu'aucun manifeste, parce qu'il aurait l'air valide. */
if (manquants.length) {
  console.error('\n⛔ manifeste INCOMPLET — aucun fichier n\'a été écrit :');
  for (const m of manquants) console.error('   · ' + m);
  console.error('\nUn manifeste incomplet laisserait une plateforme sans mise à jour : on échoue ici.');
  process.exit(1);
}

if (aEcrire.length !== Object.keys(APPLICATIONS).length) {
  console.error(`⛔ ${aEcrire.length} application(s) complète(s) sur ${Object.keys(APPLICATIONS).length} attendue(s).`);
  process.exit(1);
}

for (const { sortie, manifeste, plateformes } of aEcrire) {
  fs.writeFileSync(sortie, JSON.stringify(manifeste, null, 2) + '\n', 'utf8');
  console.log(`  ${path.basename(sortie)} : ${plateformes.join(', ')}`);
}

console.log(`\n✅ ${aEcrire.length} manifeste(s) de mise à jour pour la version ${version}`);
