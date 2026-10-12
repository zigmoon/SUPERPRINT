/* Contrôle du BRANCHEMENT de l'export imposé par le noyau Rust.

   Le fichier livré est `superprint/app/JS/superprint-montage.js` (copie de
   `superprint_rust/web/`). Ce contrôle fait trois choses, et aucune ne recopie
   ce qu'elle prétend vérifier :

   1. **le contrat est MESURÉ dans le produit.** Les identifiants d'éléments, la
      table des qualités, la liste de ce qui n'est pas à imprimer, les couleurs
      de trait parasite, le décalage de cellule et le motif du nom de fichier
      sont lus dans `main.js` et `index.html`, puis confrontés à ce que la colle
      porte. Une valeur qui bouge d'un côté et pas de l'autre fait échouer le
      contrôle — c'est la seule protection contre la dérive silencieuse d'une
      recopie ;

   2. **les décisions sont éprouvées** sur des réglages et des documents
      fabriqués : ce que la colle accepte, ce qu'elle refuse (et la raison
      qu'elle en donne), et les replis (noyau pas prêt, document hors domaine) ;

   3. **la chaîne complète est exécutée** avec le VRAI noyau WebAssembly : ordre
      d'impression, rendu des quatre faces, assemblage, téléchargement. Le canevas
      Fabric et le contexte 2D sont simulés — Rust ne peut pas posséder un
      canevas, donc ce n'est pas le noyau qui est en cause — et le PDF produit est
      relu par `pdf-lib`, le lecteur du produit.

   Usage : node scripts/validate-montage-branchement.mjs
*/
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const produit = join(racine, '..', 'superprint', 'app');

const require = createRequire(import.meta.url);
let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (texte) => console.log(`\n== ${texte}`);

// ─────────────────────────── le produit, lu sans être modifié ────────────────

const cheminMain = join(produit, 'JS', 'main.js');
const cheminIndex = join(produit, 'index.html');
for (const chemin of [cheminMain, cheminIndex]) {
  if (!existsSync(chemin)) {
    console.error(`introuvable : ${chemin}`);
    process.exit(2);
  }
}
const main = readFileSync(cheminMain, 'utf8');
const index = readFileSync(cheminIndex, 'utf8');
const sourceColle = readFileSync(join(racine, 'web', 'superprint-montage.js'), 'utf8');

/** Le texte entre deux repères, ou `''`. Évite de compter les accolades. */
function extraire(texte, debut, fin, longueurMax = 20000, depuis = 0) {
  const d = texte.indexOf(debut, depuis);
  if (d < 0) return '';
  const f = fin ? texte.indexOf(fin, d + debut.length) : -1;
  return f > d ? texte.slice(d, f) : texte.slice(d, d + longueurMax);
}

/** Le contenu d'un littéral de tableau ou d'objet du fichier de colle. */
function litteral(motif) {
  const m = motif.exec(sourceColle);
  if (!m) return null;
  const propre = m[1]
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/(,)(\s*[\]}])/g, '$2');
  return JSON.parse(propre);
}

// ─────────────────────────── 1. le contrat, mesuré ───────────────────────────

titre('le contrat, mesuré dans main.js et index.html');

const ligneBouton = index.split('\n').find((l) => l.includes('window.exportImposedPDF ||'));
check(
  'le bouton d’export imposé préfère `window.exportImposedPDF`',
  !!ligneBouton && /window\.exportImposedPDF\s*\|\|/.test(ligneBouton) && ligneBouton.includes('_spGuardExport'),
  'c’est la porte d’entrée du branchement',
);
check(
  'et `main.js` pose bien cette fonction sur `window`',
  /window\.exportImposedPDF\s*=\s*exportImposedPDF/.test(main),
);

const blocQualite = extraire(main, 'function getQualityMultiplier(quality) {', 'function getQualityInfo', 2000);
const qualitesProduit = {};
for (const m of blocQualite.matchAll(/case '(\w+)':\s*return\s*([\d.]+)/g)) {
  qualitesProduit[m[1]] = Number(m[2]);
}
const qualitesColle = litteral(/var QUALITES = (\{[^}]*\});/);
check(
  'la table des qualités est celle du produit, valeur par valeur',
  Object.keys(qualitesProduit).length > 0 && JSON.stringify(qualitesProduit) === JSON.stringify(qualitesColle),
  `${JSON.stringify(qualitesProduit)} contre ${JSON.stringify(qualitesColle)}`,
);
const defautProduit = /default:\s*return\s*([\d.]+)/.exec(blocQualite);
const defautColle = Number(/var QUALITE_DEFAUT = ([\d.]+)/.exec(sourceColle)[1]);
check(
  'et sa valeur par défaut aussi',
  defautProduit && Number(defautProduit[1]) === defautColle,
  defautProduit ? `produit ${defautProduit[1]}, colle ${defautColle}` : 'introuvable',
);

// Ce qui n'est pas à imprimer : le produit les retire dans `toRemove`, **dans
// `buildImposedSheetCanvas`**. `toRemove` existe ailleurs dans `main.js`, donc on
// part de la fonction et non du premier `const toRemove` du fichier.
const blocPlanche = extraire(main, 'async function buildImposedSheetCanvas(', '', 20000);
const blocRetrait = extraire(blocPlanche, 'const toRemove = [];', 'toRemove.forEach', 5000);
const listeColle = litteral(/var NON_IMPRIMABLES = (\[[\s\S]*?\]);/);
const absents = listeColle.filter((nom) => !new RegExp(`\\b${nom}\\b`).test(blocRetrait));
check(
  'tout ce que la colle retire est retiré par le produit',
  blocRetrait.length > 0 && absents.length === 0,
  absents.length ? `absents de main.js : ${absents.join(', ')}` : `${listeColle.length} noms`,
);

// Les traits parasites.
const blocTrait = extraire(blocPlanche, 'FIX 2026-05-01 (Bug 10)', 'sheetCanvas.add(o);', 5000);
const couleursColle = litteral(/var TRAITS_PARASITES = (\[[^\]]*\]);/);
check(
  'les couleurs de trait parasite sont celles du produit',
  blocTrait.length > 0 && couleursColle.every((c) => blocTrait.includes(c)),
  couleursColle.join(', '),
);

// Le décalage d'une page posée : `exportBleedPx - bleedPx`, soit 0 quand le fond
// perdu est inclus, −bleedPx quand il ne l'est pas.
check(
  'le décalage d’une page est celui du produit (`exportBleedPx - bleedPx`)',
  /loadOnePage\(pageNum1,\s*exportBleedPx\s*-\s*bleedPx/.test(main) &&
    /decalage:\s*marge\s*-\s*bleedPx/.test(sourceColle),
);

// Le nom du fichier, au caractère près.
check(
  'le nom de fichier suit celui du produit',
  /`superprint-imposed-\$\{imposedColorLabel\}-\$\{dateStr\}\.pdf`/.test(main) &&
    /'superprint-imposed-'\s*\+\s*etiquette\s*\+\s*'-'\s*\+\s*date\s*\+\s*'\.pdf'/.test(sourceColle),
);
check(
  'et sa date est fabriquée de la même façon',
  /slice\(0,\s*16\)\.replace\(\/\[-:\]\/g,\s*''\)\.replace\('T',\s*'-'\)/.test(main) &&
    /slice\(0,\s*16\)[\s\S]{0,140}replace\(\/\[-:\]\/g,\s*''\)[\s\S]{0,60}replace\('T',\s*'-'\)/.test(sourceColle),
);

// Les identifiants d'éléments du modal : la colle lit les mêmes que main.js.
// Le produit les déclare tantôt en `id`, tantôt en `name` (les boutons radio
// d'un groupe n'ont pas d'`id` commun : c'est leur `name` qui compte).
const ids = ['imposedQuality', 'imposedColorMode', 'colorMode', 'imposedIncludeBleed', 'imposedCropMarks', 'imposedCutApart', 'imposedCmykIccProfile', 'cmykIccProfile'];
const inconnus = ids.filter((id) => !main.includes(id) || !(index.includes(`id="${id}"`) || index.includes(`name="${id}"`)));
check(
  'les 8 identifiants d’éléments du modal sont ceux du produit',
  inconnus.length === 0,
  inconnus.length ? `introuvables dans index.html : ${inconnus.join(', ')}` : ids.join(', '),
);
check(
  'les deux sémantiques de case à cocher sont respectées',
  /imposedIncludeBleed'\)\?\.checked === true/.test(main) &&
    /imposedCropMarks'\)\?\.checked !== false/.test(main) &&
    /coche\('imposedIncludeBleed'\) === true/.test(sourceColle) &&
    /coche\('imposedCropMarks'\) !== false/.test(sourceColle),
  '« opt-in strict » d’un côté, « cochée par défaut » de l’autre',
);

// ─────────────────────────── 2. le banc d'essai ──────────────────────────────

/**
 * Un faux navigateur, juste ce qu'il faut pour exécuter la colle.
 *
 * ⚠️ Ce que ce banc **ne mesure pas**, et qui est dit plutôt que tu : le rendu
 * d'une page par Fabric, et le décodage réel d'un PNG. Ce qui est mesuré est la
 * chaîne — décision, ordre, dimensions demandées, faces, assemblage,
 * téléchargement — et elle est mesurée bout en bout avec le vrai noyau.
 */
function fauxNavigateur(options = {}) {
  const journal = { appels: [], canevas: [], images: [], telechargements: [], noms: [] };
  const elements = new Map();
  for (const id of ['imposedQuality', 'imposedColorMode', 'colorMode', 'imposedIncludeBleed', 'imposedCropMarks', 'imposedCutApart', 'imposedCmykIccProfile', 'cmykIccProfile']) {
    elements.set(id, { id, value: '', checked: undefined });
  }
  for (const [id, valeur] of Object.entries(options.elements || {})) {
    if (valeur === null) elements.delete(id);
    else if (typeof valeur === 'boolean') elements.get(id).checked = valeur;
    else elements.get(id).value = valeur;
  }
  const radios = options.radios || {};

  const canevasNu = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect() {},
      drawImage() {},
      getImageData: (x, y, l, h) => ({ data: new Uint8ClampedArray(l * h * 4).fill(255) }),
    }),
  });

  class FauxCanevas {
    constructor(el, opts) {
      this.width = (opts && opts.width) || 0;
      this.height = (opts && opts.height) || 0;
      this.objets = [];
      journal.canevas.push({ width: this.width, height: this.height });
    }
    loadFromJSON(donnees, suite) {
      this.objets = (donnees.objects || []).map((o) =>
        Object.assign({}, o, {
          // Un objet Fabric réel a des méthodes : c'est ce que la colle appelle.
          setCoords() {},
          set(champs) {
            Object.assign(this, champs);
          },
        }),
      );
      if (suite) suite();
    }
    getObjects() {
      return this.objets.slice();
    }
    remove(objet) {
      const i = this.objets.indexOf(objet);
      if (i >= 0) this.objets.splice(i, 1);
    }
    renderAll() {}
    toDataURL({ multiplier }) {
      return `data:image/png;base64,${Math.round(this.width * multiplier)}x${Math.round(this.height * multiplier)}`;
    }
    dispose() {}
  }

  class FausseImage {
    set src(url) {
      const m = /base64,(\d+)x(\d+)/.exec(url);
      this.width = Number(m[1]);
      this.height = Number(m[2]);
      journal.images.push({ width: this.width, height: this.height });
      if (this.onload) this.onload();
    }
  }

  const globals = {
    console: {
      info: (...a) => journal.appels.push('info:' + a.join(' ')),
      warn: (...a) => journal.appels.push('warn:' + a.join(' ')),
      error: (...a) => journal.appels.push('error:' + a.join(' ')),
      log: () => {},
    },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    TextEncoder,
    TextDecoder,
    WebAssembly,
    document: {
      readyState: 'complete',
      body: { appendChild() {}, removeChild() {} },
      addEventListener() {},
      querySelector: (sel) => {
        const m = /^input\[name="([\w-]+)"\]:checked$/.exec(sel);
        const valeur = m ? radios[m[1]] : null;
        return valeur ? { value: valeur } : null;
      },
      querySelectorAll: () => [],
      getElementById: (id) => elements.get(id) || null,
      createElement: (tag) =>
        tag === 'canvas'
          ? canevasNu()
          : {
              style: {},
              setAttribute() {},
              click() {
                journal.noms.push(this.download);
                if (options.surTelechargement) options.surTelechargement(this.download);
              },
              remove() {},
              appendChild() {},
            },
    },
    fabric: { Canvas: FauxCanevas },
    Image: FausseImage,
    Blob: class {
      constructor(parties) {
        this.taille = parties.reduce((n, p) => n + p.length, 0);
        journal.telechargements.push({ taille: this.taille, octets: parties[0] });
      }
    },
    URL: { createObjectURL: () => 'blob:faux', revokeObjectURL: () => {} },
    fetch: options.fetch || (() => Promise.resolve({ ok: false })),
    saveProjectSP_toObject: () => options.projet,
    spLockTextboxDimensions: () => journal.appels.push('spLockTextboxDimensions'),
    injectMasterItemsForExport: () => {
      journal.appels.push('injectMasterItemsForExport');
      return Promise.resolve();
    },
    spExportPaintOpaqueBackground: () => options.opaque !== false,
    closeImpositionModal: () => journal.appels.push('closeImpositionModal'),
    exportImposedPDF: function () {
      journal.appels.push('exportImposedPDF');
      return 'produit';
    },
    requestIdleCallback: (fn) => setTimeout(fn, 0),
  };
  return { globals, journal };
}

/**
 * Charge un fichier de colle **dans l'objet global donné**, et le rend.
 *
 * ⚠️ Le même objet est contextifié pour ce qu'on charge : charger deux colles
 * dans deux objets différents poserait `window.exportImposedPDF` sur l'un et
 * `window.SPMontage` sur l'autre, et le contrôle n'éprouverait alors pas la
 * chaîne que le navigateur exécute.
 */
function charger(environnement, chemin, nom) {
  runInNewContext(readFileSync(chemin, 'utf8'), environnement, { filename: nom });
  return environnement;
}

/** Un document de synthèse, tel que `saveProjectSP_toObject()` le rendrait. */
function documentDeTest({ pages = 4, encres = {}, masque = false, largeur = 210, hauteur = 297 } = {}) {
  const objets = [{ type: 'rect', left: 10, top: 10 }];
  return {
    meta: { title: 'Essai', stats: { pages } },
    document: { format: { width: largeur, height: hauteur, unit: 'mm' }, bleed: 3 },
    resources: { spotInks: encres },
    pages: Array.from({ length: pages }, (_, i) => ({
      index: i,
      objects: masque ? objets.concat([{ type: 'rect', _isImageMask: true, _maskImageSourceURL: 'data:,' }]) : objets,
    })),
  };
}

const profilFactice = () =>
  Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array(700).fill(7).buffer) });

const cheminMontage = join(racine, 'web', 'superprint-montage.js');

// ─────────────────────────── 2a. les réglages ────────────────────────────────

titre('les réglages, lus dans le DOM du produit');
{
  const env = fauxNavigateur({
    elements: { imposedIncludeBleed: true, imposedCropMarks: false, imposedCutApart: true },
    radios: { imposedQuality: 'hd', imposedColorMode: 'cmyk' },
  });
  const sandbox = charger(env.globals, cheminMontage, 'superprint-montage.js');
  const lus = sandbox.SPMontage.lireReglages();
  check('la qualité est lue', lus.qualite === 'hd' && lus.multiplier === 4.17, `×${lus.multiplier}`);
  check('le mode de couleur est lu', lus.mode === 'cmyk');
  check('le fond perdu imprimé est lu', lus.inclureFondPerdu === true);
  check('les repères décochés sont lus comme tels', lus.reperesDeCoupe === false);
  check('la découpe page à page est lue', lus.decoupePageAPage === true);
  check('le profil ICC est lu', lus.profilIcc === 'CoatedFOGRA39');

  const sansCases = fauxNavigateur({ elements: { imposedIncludeBleed: null, imposedCropMarks: null } });
  const lusSans = charger(sansCases.globals, cheminMontage, 'x.js').SPMontage.lireReglages();
  check(
    'une case absente ne coche pas « inclure le fond perdu »',
    lusSans.inclureFondPerdu === false,
    'opt-in strict, comme main.js',
  );
  check(
    'mais laisse les repères de coupe actifs',
    lusSans.reperesDeCoupe === true,
    'cochés par défaut, comme main.js',
  );
  check('et retombe sur la qualité par défaut', lusSans.multiplier === 2.78, `×${lusSans.multiplier}`);
}

// ─────────────────────────── 2b. le domaine ─────────────────────────────────

titre('ce que la colle refuse, et la raison qu’elle en donne');
{
  const env = fauxNavigateur({ projet: documentDeTest() });
  const colle = charger(env.globals, cheminMontage, 'x.js').SPMontage;
  const reglages = { mode: 'cmyk', profilIcc: 'CoatedFOGRA39' };

  check('un document ordinaire est accepté', colle.refus(documentDeTest(), reglages) === null);
  check(
    'un document à tons directs est refusé, et la raison les compte',
    /2 encre\(s\) directe\(s\)/.test(colle.refus(documentDeTest({ encres: { a: {}, b: {} } }), reglages) || ''),
  );
  check(
    'un document à masque d’image est refusé',
    /masque d’image/.test(colle.refus(documentDeTest({ masque: true }), reglages) || ''),
  );
  check(
    'un profil ICC personnalisé est refusé en CMJN',
    /personnalisé/.test(colle.refus(documentDeTest(), { mode: 'cmyk', profilIcc: '__custom__' }) || ''),
  );
  check(
    'mais pas en RVB : il ne servirait à rien',
    colle.refus(documentDeTest(), { mode: 'rvb', profilIcc: '__custom__' }) === null,
  );
  check('un document vide est refusé', colle.refus({ pages: [] }, reglages) === 'aucun document');
}

// ─────────────────────────── 2c. la reprise et les replis ────────────────────

titre('la reprise du bouton, et les replis');
{
  const env = fauxNavigateur({ projet: documentDeTest() });
  // ⚠️ La colle **s'installe toute seule** au chargement (document déjà prêt) :
  // c'est donc le stub posé avant le chargement qui est l'original, et non ce
  // que l'on trouverait après.
  const original = env.globals.exportImposedPDF;
  const sandbox = charger(env.globals, cheminMontage, 'x.js');
  const colle = sandbox.SPMontage;
  check('la reprise s’installe au chargement', sandbox.exportImposedPDF !== original);
  check('elle ne s’installe pas deux fois', colle.reprendre() === false);
  check('elle garde l’original', sandbox.exportImposedPDF.__spMontageOriginal === original);
  check(
    'noyau pas prêt → export du produit, et aucun clic perdu',
    sandbox.exportImposedPDF() === 'produit' && env.journal.appels.includes('exportImposedPDF'),
  );
  check(
    'et `retirer()` rend l’état d’avant, exactement',
    colle.retirer() === true && sandbox.exportImposedPDF === original,
  );
  check('`retirer()` deux fois ne fait rien', colle.retirer() === false);
}
{
  const env = fauxNavigateur({ projet: documentDeTest({ encres: { pantone: {} } }) });
  const sandbox = charger(env.globals, cheminMontage, 'x.js');
  sandbox.SPMontage.etat.pret = true; // le noyau est là, mais le document est hors domaine
  sandbox.SPMontage.reprendre();
  check(
    'document hors domaine → export du produit, décidé avant d’écrire',
    sandbox.exportImposedPDF() === 'produit',
    'le noyau ne porte pas les encres directes sur une planche',
  );
}

// ─────────────────────────── 3. la chaîne, noyau réel ───────────────────────

titre('la chaîne complète, avec le noyau WebAssembly réel');
{
  const cheminWasm = join(racine, 'dist', 'superprint_core.wasm');
  const cheminColle = join(racine, 'web', 'superprint-core.js');
  if (!existsSync(cheminWasm)) {
    console.error('introuvable : ' + cheminWasm + ' (construire : pwsh -File scripts/build-wasm.ps1)');
    process.exit(2);
  }

  // Fond perdu inclus et qualité HD : la cellule et la résolution sont ainsi
  // celles du cas le plus exigeant, et elles sont vérifiées à la fin. Le format
  // de page est petit (50 × 70 mm) pour que les tampons de pixels du banc
  // d'essai restent modestes — c'est la RÈGLE qui est éprouvée, pas la taille.
  const env = fauxNavigateur({
    projet: documentDeTest({ pages: 8, largeur: 50, hauteur: 70 }),
    elements: { imposedIncludeBleed: true },
    radios: { imposedQuality: 'hd', imposedColorMode: 'rgb' },
    fetch: (url) => (String(url).startsWith('icc/') ? profilFactice() : Promise.resolve({ ok: false })),
  });
  const sandboxCore = charger(env.globals, cheminColle, 'superprint-core.js');
  const colle = charger(sandboxCore, cheminMontage, 'superprint-montage.js').SPMontage;
  sandboxCore.SuperPrintCore.load({ bytes: new Uint8Array(readFileSync(cheminWasm)) })
    .then(async (moteur) => {
      // Le chargement planifié par la colle a échoué (le faux `fetch` refuse) :
      // on laisse sa promesse se terminer, puis on installe le moteur à la main.
      // Le chargement par `fetch` demanderait un serveur, et ce n'est pas ce que
      // ce contrôle éprouve.
      await new Promise((r) => setTimeout(r, 30));
      colle.etat.noyau = moteur;
      colle.etat.pret = true;
      colle.etat.chargement = Promise.resolve(moteur);

      // On appelle l'ENVELOPPE installée au chargement — celle que le bouton
      // appellera — et non une fonction posée après coup, qui l'aurait écrasée.
      const resultat = await sandboxCore.exportImposedPDF();

      check(
        'la chaîne Rust a servi',
        !!resultat && resultat.backend === 'rust' && resultat.faces === 4,
        resultat && resultat.rapport ? `${resultat.rapport.faces} face(s), ${resultat.rapport.octets} octets` : String(resultat),
      );
      check(
        'et le repli n’a PAS été appelé',
        !env.journal.appels.includes('exportImposedPDF'),
        env.journal.appels.filter((a) => a.startsWith('warn:')).join(' | ') || 'l’export du produit n’a pas servi',
      );
      check('quatre planches : une par face d’un livret de huit pages', resultat.rapport.planches.length === 4);
      check(
        'chaque face est décrite — format fini, média, repères, deux zones',
        resultat.rapport.planches.every(
          (p) =>
            p.formatFiniMm.largeurMm === 100 &&
            p.formatFiniMm.hauteurMm === 70 &&
            p.mediaMm.largeurMm === 126 &&
            p.mediaMm.hauteurMm === 96 &&
            p.reperes === 12 &&
            p.zonesMm.length === 2,
        ),
        JSON.stringify(resultat.rapport.planches[0]),
      );
      check(
        'les zones sont rognées à la couture (deux pages trim-à-trim)',
        resultat.rapport.planches[0].zonesMm[0][2] <= 66 && resultat.rapport.planches[0].zonesMm[1][0] >= 54,
        JSON.stringify(resultat.rapport.planches[0].zonesMm),
      );
      check('huit rendus : deux par face, quatre faces', env.journal.images.length === 8, `${env.journal.images.length} rendu(s)`);
      const cellule = [Math.round(56 * (72 / 25.4)), Math.round(76 * (72 / 25.4))];
      check(
        'les canevas font la page plus son fond perdu, en points PostScript (1 px = 1 pt)',
        env.journal.canevas.every((c) => c.width === cellule[0] && c.height === cellule[1]),
        `${env.journal.canevas[0].width}×${env.journal.canevas[0].height}, attendu ${cellule.join('×')}`,
      );
      check(
        'et les pixels sont multipliés par la qualité (HD = 4,17 → 300 dpi)',
        env.journal.images[0].width === Math.round(cellule[0] * 4.17),
        `${env.journal.images[0].width} contre ${Math.round(cellule[0] * 4.17)}`,
      );
      check('les gabarits ont été injectés (mode RVB)', env.journal.appels.includes('injectMasterItemsForExport'));
      check('les blocs texte ont été verrouillés', env.journal.appels.includes('spLockTextboxDimensions'));
      check('la modale a été refermée', env.journal.appels.includes('closeImpositionModal'));
      check('un fichier a été téléchargé', env.journal.telechargements.length === 1);
      check(
        'et le nom du fichier est celui du produit',
        /^superprint-imposed-rgb-\d{8}-\d{4}\.pdf$/.test(env.journal.noms[0] || ''),
        env.journal.noms[0] || 'nom introuvable',
      );

      // Le PDF : relu par pdf-lib, le lecteur du produit (celui du dépôt, lu
      // sur place et jamais modifié).
      const octets = Uint8Array.from(env.journal.telechargements[0].octets);
      check('le fichier téléchargé est un PDF', octets[0] === 0x25 && octets[1] === 0x50);
      const PDFLib = require(join(produit, 'JS', 'pdf-lib.min.js'));
      const lu = await PDFLib.PDFDocument.load(octets);
      check('pdf-lib y lit quatre pages', lu.getPageCount() === 4, `${lu.getPageCount()} page(s)`);
      const boite = lu.getPage(0).getMediaBox();
      const mm = 25.4 / 72;
      check(
        'et la première page fait le média du plan (126 × 96 mm)',
        Math.abs(boite.width * mm - 126) < 0.1 && Math.abs(boite.height * mm - 96) < 0.1,
        `${(boite.width * mm).toFixed(2)} × ${(boite.height * mm).toFixed(2)} mm`,
      );
    })
    .then(() => fin())
    .catch((erreur) => {
      check('la chaîne complète s’exécute', false, (erreur && erreur.message) || String(erreur));
      fin();
    });
}

function fin() {
  console.log(ok ? '\n\u2705 le branchement de l’export imposé est conforme.' : '\n\u274c branchement NON conforme.');
  process.exit(ok ? 0 : 1);
}
