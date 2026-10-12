/* ══════════════════════════════════════════════════════════════════════════
   validate-doc-branchement.mjs — l'import de documents branché, éprouvé.

   Ce contrôle ne dit pas « la colle a l'air juste » : il **exécute** la chaîne
   que le navigateur exécutera, avec le vrai module WebAssembly, et il oppose le
   résultat à celui de la fonction du produit, extraite de `main.js` et lue
   **sans être modifiée**.

   Quatre sections, et chacune répond à une question qu'on se poserait :

     1. LE CONTRAT, EXTRAIT DE `main.js` ET `index.html`. Les trois lignes qui
        font le branchement sont relues dans les fichiers du produit — pas
        recopiées ici. Si l'une bouge là-bas, ce contrôle échoue au lieu de
        mesurer autre chose.

     2. CE QUE LE PRODUIT FAISAIT, CE QUE LE NOYAU FAIT, SUR LES MÊMES OCTETS.
        Un document ODF de synthèse porte les trois constructions qui piègent un
        lecteur au motif : une balise **au milieu d'un mot**, des **entités**
        nommées, et `<text:s text:c="3"/>` — les espaces répétés, que le format
        n'écrit jamais en clair. Le lecteur du produit et celui du noyau sont
        exécutés sur ce document, et les deux textes sont montrés. L'écart n'est
        pas décrit, il est **affiché**.

     3. LA CHAÎNE COMPLÈTE : la colle `superprint-doc.js` est évaluée dans un
        contexte qui imite le navigateur, le module est chargé par `fetch`, et
        l'enveloppe est appelée. On vérifie qu'un `.odt` vient du noyau, qu'un
        `.ods` — que le noyau refuse, ce n'est pas un texte ODF — **retombe sur
        la fonction du produit**, qu'un module indisponible retombe aussi, et
        que `retirer()` rend exactement l'état d'avant.

     4. LE MODULE LIVRÉ : zéro import, ses exports, et sa taille.

   Usage : node scripts/validate-doc-branchement.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');
const cheminMain = join(parent, 'superprint', 'app', 'JS', 'main.js');
const cheminIndex = join(parent, 'superprint', 'app', 'index.html');
const cheminColle = join(racine, 'web', 'superprint-doc.js');
const cheminWasm = join(racine, 'dist', 'superprint_doc.wasm');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'doc_dump.wasm',
);

for (const chemin of [cheminMain, cheminIndex, cheminColle, cheminWasm, cheminExemple]) {
  if (!existsSync(chemin)) {
    console.error(`introuvable : ${chemin}`);
    if (chemin === cheminWasm) {
      console.error('(construire : pwsh -File scripts/build-wasm.ps1)');
    }
    if (chemin === cheminExemple) {
      console.error(
        '(construire : cargo build -p superprint-doc --example doc_dump --target wasm32-wasip1 --release)',
      );
    }
    process.exit(2);
  }
}

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

const main = readFileSync(cheminMain, 'utf8');
const index = readFileSync(cheminIndex, 'utf8');

/* ─────────────────────────── extraction, sans modifier ────────────────────
   On lit `main.js` et on en **sort** les fonctions dont on a besoin, pour les
   exécuter telles quelles. Recopier ici leur logique mesurerait une copie, pas
   le produit — et une copie qui divergerait ne se verrait jamais. */
function corpsDeFonction(texte, entete) {
  const debut = texte.indexOf(entete);
  if (debut < 0) return '';
  let i = texte.indexOf('{', debut);
  if (i < 0) return '';
  let profondeur = 0;
  let dansChaine = null;
  let dansLigne = false;
  let dansBloc = false;
  for (; i < texte.length; i += 1) {
    const c = texte[i];
    const suivant = texte[i + 1];
    if (dansLigne) {
      if (c === '\n') dansLigne = false;
      continue;
    }
    if (dansBloc) {
      if (c === '*' && suivant === '/') {
        dansBloc = false;
        i += 1;
      }
      continue;
    }
    if (dansChaine) {
      if (c === '\\') i += 1;
      else if (c === dansChaine) dansChaine = null;
      continue;
    }
    if (c === '/' && suivant === '/') {
      dansLigne = true;
      i += 1;
      continue;
    }
    if (c === '/' && suivant === '*') {
      dansBloc = true;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      dansChaine = c;
      continue;
    }
    if (c === '{') profondeur += 1;
    else if (c === '}') {
      profondeur -= 1;
      if (profondeur === 0) return texte.slice(debut, i + 1);
    }
  }
  return '';
}

/* ══════════════════════ 1. le contrat, extrait du produit ══════════════════ */
titre('1. le contrat, relu dans main.js et index.html');

const sourceOdf = corpsDeFonction(main, 'function _spTexteOdf(buf)');
const sourceDecode = corpsDeFonction(main, 'function _spDecodeTexte(buf)');
const sourceDocument = corpsDeFonction(main, 'async function _spTexteDocument(');

check(
  'la fonction du produit est extractible de main.js',
  sourceOdf.includes('content.xml') && sourceDecode.includes('TextDecoder') && !!sourceDocument,
  `${sourceOdf.split('\n').length} + ${sourceDecode.split('\n').length} lignes, et _spTexteDocument`,
);

check(
  'main.js pose la porte d’entrée `window._spTexteOdf` (AJOUT du branchement)',
  /window\._spTexteOdf\s*=\s*_spTexteOdf\s*;/.test(main),
);

check(
  'la branche OpenDocument lit `window._spTexteOdf || _spTexteOdf`',
  /var lireOdf = window\._spTexteOdf \|\| _spTexteOdf;/.test(main),
);

// La branche `.idml` est un ajout : elle doit être **gardée** par la présence de
// la colle, sinon elle changerait le comportement d'une application où la colle
// n'est pas chargée.
const brancheIdml = /if \(type === 'idml' \|\| ext === 'idml'\) \{[\s\S]{0,1200}?\n            \}/.exec(main);
check(
  'la branche `.idml` existe, et elle est gardée par `window.SuperPrintDoc`',
  Boolean(brancheIdml) && brancheIdml[0].includes('window.SuperPrintDoc'),
);

// Le fait qui justifie la branche : avant elle, aucun test de `_spTexteDocument`
// ne nommait `idml`, donc un `.idml` tombait sur le décodage binaire.
{
  const sansLaBranche = sourceDocument.replace(brancheIdml ? brancheIdml[0] : '', '');
  const tests = [...sansLaBranche.matchAll(/if \(type === '([a-z]+)'/g)].map((m) => m[1]);
  check(
    'avant cette branche, aucun test de _spTexteDocument ne nommait `idml`',
    !tests.includes('idml'),
    `tests présents : ${tests.join(', ')}`,
  );
}

check(
  'index.html charge la colle, après celle du montage',
  index.indexOf('<script src="JS/superprint-doc.js') >
    index.indexOf('<script src="JS/superprint-montage.js'),
);

check(
  'index.html charge main.js APRÈS la colle — c’est ce qui rend l’enveloppe possible',
  index.indexOf('<script src="JS/main.js') > index.indexOf('<script src="JS/superprint-doc.js'),
  `colle à ${index.indexOf('<script src="JS/superprint-doc.js')}, main.js à ${index.indexOf('<script src="JS/main.js')}`,
);

/* ══════════════════ 2. le produit et le noyau, mêmes octets ════════════════
   Un ODF de synthèse, écrit **d'après la spécification** : ce n'est pas un
   fichier du dépôt, c'est un document construit pour porter exactement les trois
   constructions qui séparent un lecteur exact d'un lecteur approximatif. */

const TABLE_CRC = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(octets) {
  let c = -1;
  for (let i = 0; i < octets.length; i += 1) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Fabrique une archive ZIP `stocké` (méthode 0).
 *
 * ⚠️ Le `mimetype` d'un ODF est écrit **non compressé** et en premier, exprès,
 * pour être lisible avant le reste : c'est la seule autorité sur la nature du
 * fichier. On respecte donc la règle du format plutôt que de la contourner.
 */
function fabriquerArchive(entrees) {
  const morceaux = [];
  const annuaire = [];
  let decalage = 0;
  for (const entree of entrees) {
    const contenu = Buffer.from(entree.contenu, 'utf8');
    const nom = Buffer.from(entree.nom, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc32(contenu), 14);
    local.writeUInt32LE(contenu.length, 18);
    local.writeUInt32LE(contenu.length, 22);
    local.writeUInt16LE(nom.length, 26);
    morceaux.push(local, nom, contenu);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc32(contenu), 16);
    central.writeUInt32LE(contenu.length, 20);
    central.writeUInt32LE(contenu.length, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(decalage, 42);
    annuaire.push(central, nom);
    decalage += local.length + nom.length + contenu.length;
  }
  const debut = morceaux.reduce((n, m) => n + m.length, 0);
  const bloc = Buffer.concat(annuaire);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entrees.length, 8);
  eocd.writeUInt16LE(entrees.length, 10);
  eocd.writeUInt32LE(bloc.length, 12);
  eocd.writeUInt32LE(debut, 16);
  return Buffer.concat([...morceaux, bloc, eocd]);
}

const MIME_TEXTE = 'application/vnd.oasis.opendocument.text';
const MIME_CLASSEUR = 'application/vnd.oasis.opendocument.spreadsheet';

/**
 * Le corps d'un texte ODF, écrit pour piéger :
 *   1. `Pa<text:span>pier</text:span>` — une balise **au milieu d'un mot** ;
 *   2. `d&apos;un c&#244;t&#233;` — les cinq entités **XML** prédéfinies, plus
 *      deux **références numériques**, qui sont la forme qu'un écrivain ODF
 *      emploie réellement pour un accent. Pas `&ocirc;` : ce n'est **pas** une
 *      entité XML (le XML n'en prédéfinit que cinq), et la voir acceptée
 *      partout ailleurs ne la rend pas valide. Le cas de l'entité nommée est
 *      éprouvé séparément, plus bas ;
 *   3. `deux<text:s text:c="3"/>espaces` — deux espaces répétés, que le format
 *      n'écrit **jamais** en clair.
 */
const CORPS_TEXTE =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">' +
  '<office:body><office:text>' +
  '<text:p>Pa<text:span>pier</text:span> chiffon</text:p>' +
  "<text:p>d&apos;un c&#244;t&#233;</text:p>" +
  '<text:p>deux<text:s text:c="3"/>espaces</text:p>' +
  '<text:h text:outline-level="1">Titre</text:h>' +
  '</office:text></office:body></office:document-content>';

/**
 * Le même texte, mais avec une entité **nommée** hors des cinq du XML.
 *
 * C'est le seul cas du branchement où le noyau et le produit diffèrent **dans
 * l'autre sens** : le noyau **refuse** le document (il ne devine pas une entité
 * qu'il ne connaît pas), le produit la laisse littérale. C'est le repli de la
 * colle qui rend la différence invisible pour l'utilisateur, et ce contrôle le
 * vérifie au lieu de l'espérer.
 */
const CORPS_ENTITE_NOMMEE = CORPS_TEXTE.replace('c&#244;t&#233;', 'c&ocirc;t');

const CORPS_CLASSEUR =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">' +
  '<office:body><office:spreadsheet><table:table><table:table-row><table:table-cell>' +
  '<text:p>case A1</text:p>' +
  '</table:table-cell></table:table-row></table:table></office:spreadsheet></office:body>' +
  '</office:document-content>';

const archiveOdt = fabriquerArchive([
  { nom: 'mimetype', contenu: MIME_TEXTE },
  { nom: 'content.xml', contenu: CORPS_TEXTE },
]);
const archiveOds = fabriquerArchive([
  { nom: 'mimetype', contenu: MIME_CLASSEUR },
  { nom: 'content.xml', contenu: CORPS_CLASSEUR },
]);
const archiveEntiteNommee = fabriquerArchive([
  { nom: 'mimetype', contenu: MIME_TEXTE },
  { nom: 'content.xml', contenu: CORPS_ENTITE_NOMMEE },
]);

const dossier = join(racine, 'target', 'doc-branchement');
mkdirSync(dossier, { recursive: true });
writeFileSync(join(dossier, 'synthese.odt'), archiveOdt);
writeFileSync(join(dossier, 'synthese.ods'), archiveOds);
writeFileSync(join(dossier, 'entite-nommee.odt'), archiveEntiteNommee);

/* ── la fonction du produit, exécutée telle quelle ─────────────────────────
   Elle a besoin de `ensureDocxLibs` et de `window.JSZip`. On lui donne JSZip
   **stubbé sur le vrai `content.xml` de l'archive qu'on lui passe** : c'est ce
   qui rend la mesure fidèle — un stub figé sur un seul document rendrait le
   même texte pour tous, et le contrôle ne mesurerait plus rien. */
function fabriquerLecteurProduit(source) {
  const contenus = [];
  const bac = {
    TextDecoder,
    Uint8Array,
    Promise,
    ensureDocxLibs: (suite) => suite(),
    JSZip: {
      loadAsync: (buf) => {
        const octets =
          buf instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(buf))
            : Buffer.from(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || undefined);
        const trouve = contenus.find((c) => c.octets.equals(octets));
        return Promise.resolve({
          file: (chemin) =>
            chemin === 'content.xml' && trouve
              ? { async: () => Promise.resolve(trouve.xml) }
              : null,
        });
      },
    },
  };
  bac.window = bac;
  const fabrique = new Function('window', 'ensureDocxLibs', source + '\nreturn _spTexteOdf;');
  return {
    /** Déclare l'archive et le `content.xml` qu'elle porte. */
    inscrire(archive, xml) {
      contenus.push({ octets: Buffer.from(archive), xml });
    },
    lire: fabrique(bac, bac.ensureDocxLibs),
  };
}

const lecteurProduit = fabriquerLecteurProduit(sourceOdf);
lecteurProduit.inscrire(archiveOdt, CORPS_TEXTE);
lecteurProduit.inscrire(archiveOds, CORPS_CLASSEUR);
lecteurProduit.inscrire(archiveEntiteNommee, CORPS_ENTITE_NOMMEE);
const texteOdfProduit = lecteurProduit.lire;

/** Le texte du noyau, par le banc `doc_dump`. */
function texteDuNoyau(chemin) {
  const sortie = join(dossier, `${chemin.split('\\').pop().split('/').pop()}.txt`);
  const relatif = (p) => p.slice(racine.length + 1).split('\\').join('/');
  execFileSync(
    process.execPath,
    [join(racine, 'scripts', 'run-wasi.mjs'), cheminExemple, 'texte', relatif(chemin), relatif(sortie)],
    { stdio: 'pipe', cwd: racine },
  );
  return readFileSync(sortie, 'utf8');
}

let produitTexte = '';
{
  // Le banc WASI doit voir le fichier : on le lui donne en chemin relatif à la
  // racine du dépôt, qui est le dossier préouvert.
  produitTexte = texteDuNoyau(join(dossier, 'synthese.odt'));
}

/** La dernière ligne utile d'un message d'erreur (le bruit de WASI en moins). */
const derniereLigne = (texte) =>
  String(texte)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/ExperimentalWarning|trace-warnings/.test(l))
    .pop() || '';

titre('2. le lecteur du produit et celui du noyau, sur les MÊMES octets');

const duProduit = await texteOdfProduit(new Uint8Array(archiveOdt).buffer);
const attenduNoyau = ['Papier chiffon', "d'un côté", 'deux   espaces', 'Titre'];

console.log('   produit : ' + JSON.stringify(duProduit));
console.log('   noyau   : ' + JSON.stringify(produitTexte));

check(
  'le produit coupe un mot en deux quand une balise le traverse',
  duProduit.includes('Pa pier chiffon'),
  `« Pa pier chiffon » attendu, reçu ${JSON.stringify(duProduit.split('\n')[0])}`,
);

check(
  'le produit laisse les entités littérales, référence numérique comprise',
  duProduit.includes('&apos;') && duProduit.includes('&#244;'),
);

check(
  'le produit écrase <text:s text:c="3"/> en une seule espace',
  duProduit.includes('deux espaces') && !duProduit.includes('deux   espaces'),
);

check(
  'le noyau rend les quatre paragraphes exacts, mot, entités et espaces compris',
  produitTexte.split('\n').join('|') === attenduNoyau.join('|'),
  JSON.stringify(produitTexte.split('\n')),
);

{
  const classeurProduit = await texteOdfProduit(new Uint8Array(archiveOds).buffer);
  check(
    'le produit lit AUSSI un classeur .ods par ce chemin',
    classeurProduit.includes('case A1'),
    JSON.stringify(classeurProduit),
  );
  // Le noyau doit le REFUSER : un classeur n'est pas un texte ODF, et inventer
  // son texte serait pire que de le dire. Et le message doit **dire ce que le
  // fichier est** : il portait un temps le type MIME du *texte*, que ce fichier
  // n'écrit nulle part, et affirmait donc qu'un classeur « contient » un texte.
  let refus = null;
  try {
    refus = texteDuNoyau(join(dossier, 'synthese.ods'));
  } catch (e) {
    refus = String((e.stdout || '') + (e.stderr || ''));
  }
  check(
    'le noyau refuse un .ods, en nommant ce que le fichier est vraiment',
    /spreadsheet/i.test(refus) &&
      !/contient «\s*application\/vnd\.oasis\.opendocument\.text/.test(refus),
    derniereLigne(refus).slice(0, 130),
  );
}

{
  // Le seul cas où le noyau refuse ce que le produit accepte : une entité
  // **nommée** hors des cinq du XML. Le refus est le bon comportement — deviner
  // une entité reviendrait à inventer du texte — et c'est le repli de la colle
  // qui rend la différence invisible. On le mesure donc des deux côtés, mais la
  // moitié « colle » est en section 3 : elle a besoin du module chargé.
  let refus = null;
  try {
    refus = texteDuNoyau(join(dossier, 'entite-nommee.odt'));
  } catch (e) {
    refus = String((e.stdout || '') + (e.stderr || ''));
  }
  check(
    'le noyau refuse une entité nommée inconnue, plutôt que de l’inventer',
    /entité inconnue/i.test(refus),
    derniereLigne(refus).slice(0, 110),
  );
}

/* ═════════════════ 3. la colle, avec le vrai module WebAssembly ════════════ */
titre('3. la colle, avec le module livré');

/** Un contexte qui imite ce dont la colle a besoin, et rien de plus. */
function environnement({ wasmDisponible = true, original = null } = {}) {
  const globals = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    ArrayBuffer,
    WebAssembly,
    // La colle lit `JS/superprint_doc.wasm` : on sert le module du dépôt. Un
    // chemin qui divergerait ferait échouer le chargement, et c'est voulu.
    fetch: (url) => {
      if (!wasmDisponible) return Promise.reject(new Error('hors ligne'));
      if (String(url) !== 'JS/superprint_doc.wasm') {
        return Promise.resolve({ ok: false, status: 404 });
      }
      const octets = readFileSync(cheminWasm);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.length)),
      });
    },
    document: {
      readyState: 'complete',
      addEventListener() {},
      getElementById: () => null,
    },
  };
  globals.window = globals;
  globals.globalThis = globals;
  if (original) globals._spTexteOdf = original;
  return createContext(globals);
}

const sandbox = environnement({ original: texteOdfProduit });
runInContext(readFileSync(cheminColle, 'utf8'), sandbox, { filename: 'superprint-doc.js' });
const colle = sandbox.SuperPrintDoc;

check('la colle s’installe et voit la porte d’entrée du produit', colle.etat.jointTrouve);
check(
  'elle a enveloppé `_spTexteOdf` sans la perdre',
  typeof sandbox._spTexteOdf === 'function' &&
    sandbox._spTexteOdf.__spDocNatif === true &&
    sandbox._spTexteOdf.__spDocOriginal === texteOdfProduit &&
    sandbox.__spTexteOdfJs === texteOdfProduit,
);

{
  const texte = await sandbox._spTexteOdf(new Uint8Array(archiveOdt).buffer);
  check(
    'un .odt vient du NOYAU',
    texte === produitTexte,
    `${colle.etat.dernier} · ${colle.etat.servis} servi(s) · ${JSON.stringify(texte.split('\n').slice(0, 2))}`,
  );
  check('le noyau a été chargé à la demande', colle.etat.pret);
}

{
  const avant = colle.etat.delegues;
  const texte = await sandbox._spTexteOdf(new Uint8Array(archiveOds).buffer);
  const attendu = await texteOdfProduit(new Uint8Array(archiveOds).buffer);
  check(
    'un .ods — refusé par le noyau — retombe sur la fonction du produit, à l’identique',
    texte === attendu && colle.etat.delegues === avant + 1,
    `${colle.etat.delegues} délégation(s) · refus : ${String(colle.etat.dernierRefus).slice(0, 60)}`,
  );
}

{
  // Le cas de l'entité **nommée** : le noyau refuse, le produit la laisse
  // littérale, et c'est le repli qui rend la différence invisible.
  const duProduitNommee = await texteOdfProduit(new Uint8Array(archiveEntiteNommee).buffer);
  const avant = colle.etat.delegues;
  const parLaColle = await sandbox._spTexteOdf(new Uint8Array(archiveEntiteNommee).buffer);
  check(
    'une entité nommée inconnue : le noyau refuse, la colle retombe sur le produit',
    parLaColle === duProduitNommee &&
      parLaColle.includes('&ocirc;') &&
      colle.etat.delegues === avant + 1,
    JSON.stringify(parLaColle.split('\n')[1]),
  );
}

{
  const r = await colle.texteNoyau(new Uint8Array(archiveOdt).buffer);
  check('`texteNoyau` rend le texte du noyau seul', r.texte === produitTexte);
  const r2 = await colle.texteNoyau(new Uint8Array(archiveOds).buffer);
  check(
    '`texteNoyau` rend un REFUS explicite pour un .ods, avec sa raison',
    r2.refus === true && typeof r2.raison === 'string' && r2.raison.length > 0,
    String(r2.raison).slice(0, 70),
  );
}

{
  // Un module indisponible : c'est le cas « hors ligne », et le repli doit être
  // total — jamais un texte vide à la place du texte du produit.
  const sans = environnement({ original: texteOdfProduit, wasmDisponible: false });
  runInContext(readFileSync(cheminColle, 'utf8'), sans, { filename: 'superprint-doc.js' });
  const texte = await sans._spTexteOdf(new Uint8Array(archiveOdt).buffer);
  check(
    'noyau indisponible : la fonction du produit sert, et rend le même texte',
    texte === duProduit && sans.SuperPrintDoc.etat.pret === false,
    `dernier : ${sans.SuperPrintDoc.etat.dernier} · raison : ${String(sans.SuperPrintDoc.etat.raison).slice(0, 50)}`,
  );
}

{
  const detache = colle.retirer();
  check(
    '`retirer()` rend exactement l’état d’avant',
    detache === true && sandbox._spTexteOdf === texteOdfProduit,
  );
  colle.installer();
  check('`installer()` la repose', sandbox._spTexteOdf.__spDocNatif === true);
}

/* ═════════════════════════ 4. le module livré ═════════════════════════════ */
titre('4. le module livré');

{
  const octets = readFileSync(cheminWasm);
  const module = new WebAssembly.Module(octets);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module)
    .filter((e) => e.kind === 'function')
    .map((e) => e.name);
  console.log(`   ${octets.length} octets (${(octets.length / 1024).toFixed(1)} Ko)`);
  console.log(`   exports : ${exports.join(', ')}`);
  check('le module ne demande AUCUN import', imports.length === 0, `${imports.length} import(s)`);
  check(
    'il expose ce que la colle appelle, et rien de plus',
    exports.includes('sp_doc_texte') &&
      exports.includes('sp_alloc') &&
      exports.includes('sp_free') &&
      exports.filter((n) => n.startsWith('sp_doc')).length === 1,
    `${exports.filter((n) => n.startsWith('sp_doc')).length} export(s) sp_doc_*`,
  );
  check(
    'la référence du fichier livré est celle du dépôt',
    (() => {
      const livree = join(parent, 'superprint', 'app', 'JS', 'superprint_doc.wasm');
      if (!existsSync(livree)) return false;
      return readFileSync(livree).equals(octets);
    })(),
  );
}

console.log(`\n${ok ? 'OK : le branchement fait ce qu’il dit.' : 'ÉCHEC.'}`);
process.exit(ok ? 0 : 1);
