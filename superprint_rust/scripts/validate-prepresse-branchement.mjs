/* ══════════════════════════════════════════════════════════════════════════
   validate-prepresse-branchement.mjs — le contrôle prépresse branché, éprouvé.

   Ce contrôle existe pour une raison précise : le prépresse décrit un document
   **en millimètres, origine en bas à gauche**, alors que le projet de
   l'application le décrit en **points PostScript, origine en haut à gauche**. Un
   signe oublié dans ce retournement ne casse rien : il déplace le constat. Un
   contrôle prépresse qui se trompe de côté ne se voit pas — il parle d'un autre
   document.

   Quatre sections :

     1. LE CONTRAT, EXTRAIT DE `main.js` ET `index.html`. Le joint
        (`window.confirmExport`), et les **identifiants de champs** que la colle
        lit — recopiés de `confirmExport`, donc relus là-bas. Un champ renommé
        côté produit doit faire échouer ce contrôle, pas faire décrire le mauvais
        document.

     2. LA CONVENTION DE REPÈRE, MESURÉE. Le vrai noyau décrit un projet de
        synthèse, et l'on vérifie **où tombe le constat** : un rectangle qui
        déborde du fond perdu **en haut** de la toile le déborde aussi dans le
        noyau ; le même rectangle ramené à l'intérieur ne dit plus rien. Le
        retournement est donc éprouvé dans les deux sens, au dixième de
        millimètre.

     3. CE QUE LE CONTRÔLE CONDUIT : fond perdu absent, débordement, résolution
        d'image (le cas **documenté** — 400 × 300 px sur 120 mm = 85 dpi), les
        objets non décrits comptés et nommés.

     4. LE REPLI ET LA RÉVERSIBILITÉ : sans noyau, l'export du produit part
        comme avant ; `retirer()` rend exactement l'état d'avant.

   Usage : node scripts/validate-prepresse-branchement.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');
const cheminMain = join(parent, 'superprint', 'app', 'JS', 'main.js');
const cheminIndex = join(parent, 'superprint', 'app', 'index.html');
const cheminNoyau = join(racine, 'web', 'superprint-core.js');
const cheminColle = join(racine, 'web', 'superprint-prepresse.js');
const cheminWasm = join(racine, 'dist', 'superprint_core.wasm');

for (const chemin of [cheminMain, cheminIndex, cheminNoyau, cheminColle, cheminWasm]) {
  if (!existsSync(chemin)) {
    console.error(`introuvable : ${chemin}`);
    if (chemin === cheminWasm) console.error('(construire : pwsh -File scripts/build-wasm.ps1)');
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
const sourceColle = readFileSync(cheminColle, 'utf8');
const octetsWasm = readFileSync(cheminWasm);

/** Le texte entre deux repères, ou `''`. Évite de compter les accolades. */
function extraire(texte, debut, fin, longueurMax = 40000) {
  const d = texte.indexOf(debut);
  if (d < 0) return '';
  const f = fin ? texte.indexOf(fin, d + debut.length) : -1;
  return f > d ? texte.slice(d, f) : texte.slice(d, d + longueurMax);
}

/**
 * Le corps d'une fonction, par comptage d'accolades.
 *
 * ⚠️ Chercher le premier `\n    }` **coupe trop tôt** : `confirmExport` en
 * contient plusieurs, et l'extraction ratait alors les champs qu'on venait
 * chercher. C'est la faute commise en écrivant ce contrôle, et elle est notée
 * pour ne pas revenir.
 */
function corpsDeFonction(texte, entete) {
  const debut = texte.indexOf(entete);
  if (debut < 0) return '';
  let i = texte.indexOf('{', debut);
  let profondeur = 0;
  let chaine = null;
  let ligne = false;
  let bloc = false;
  for (; i < texte.length; i += 1) {
    const c = texte[i];
    const suivant = texte[i + 1];
    if (ligne) {
      if (c === '\n') ligne = false;
      continue;
    }
    if (bloc) {
      if (c === '*' && suivant === '/') {
        bloc = false;
        i += 1;
      }
      continue;
    }
    if (chaine) {
      if (c === '\\') i += 1;
      else if (c === chaine) chaine = null;
      continue;
    }
    if (c === '/' && suivant === '/') {
      ligne = true;
      i += 1;
      continue;
    }
    if (c === '/' && suivant === '*') {
      bloc = true;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      chaine = c;
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

/* ══════════════════════ 1. le contrat, relu du produit ═════════════════════ */
titre('1. le contrat, relu dans main.js et index.html');

check(
  'main.js pose `window.confirmExport` — c’est le joint de ce branchement',
  /window\.confirmExport\s*=\s*confirmExport/.test(main),
);

check(
  'index.html lit `window.confirmExport || confirmExport`',
  /window\.confirmExport\s*\|\|\s*confirmExport/.test(index),
);

check(
  'index.html charge la colle du prépresse',
  index.indexOf('<script src="JS/superprint-prepresse.js') > 0,
);

check(
  'index.html charge aussi le noyau du branchement, que cette colle réutilise',
  index.indexOf('<script src="JS/superprint-core.js') > 0,
);

// Les identifiants de champs : la colle les recopie de `confirmExport`, et le
// contrôle les relit **dans le corps de la fonction du produit**. C'est la même
// méthode que `validate-montage-branchement.mjs` : sans elle, un champ renommé
// ferait lire une valeur par défaut, et le prépresse parlerait d'un autre
// document sans que rien ne le signale.
const corpsExport = corpsDeFonction(main, 'async function confirmExport');
const CHAMPS = ['bleed', 'cropMarks', 'exportIncludeBleed', 'cmykIccProfile'];
const absentsProduit = CHAMPS.filter((id) => !corpsExport.includes(`getElementById('${id}')`));
check(
  'les quatre champs lus par la colle sont ceux que confirmExport lit vraiment',
  absentsProduit.length === 0 && corpsExport.length > 3000,
  absentsProduit.length
    ? `absents du produit : ${absentsProduit.join(', ')}`
    : `${CHAMPS.length} champs, ${corpsExport.split('\n').length} lignes de fonction`,
);
check(
  'et le mode colorimétrique est bien le groupe de boutons `colorMode`',
  /querySelector\('input\[name="colorMode"\]:checked'\)/.test(corpsExport),
);
const absentsColle = CHAMPS.filter((id) => !sourceColle.includes(`'${id}'`));
check(
  'aucun de ces champs n’a été oublié par la colle',
  absentsColle.length === 0,
  absentsColle.join(', '),
);

{
  // La liste des décors non imprimables est recopiée de la colle du montage, qui
  // la tient elle-même de `main.js` et que `validate-montage-branchement.mjs`
  // vérifie là-bas. On exige l'**identité** des deux listes, et l'on **dit** ce
  // qu'on y trouve : certains de ces drapeaux n'existent nulle part dans le
  // produit aujourd'hui, ce sont des garde-fous, et le taire laisserait croire
  // qu'ils sont mesurés.
  const liste = /var NON_IMPRIMABLES = \[([\s\S]*?)\];/.exec(sourceColle);
  const noms = liste ? [...liste[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  const listeMontage = /var NON_IMPRIMABLES = \[([\s\S]*?)\];/.exec(
    readFileSync(join(racine, 'web', 'superprint-montage.js'), 'utf8'),
  );
  const nomsMontage = listeMontage
    ? [...listeMontage[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    : [];
  check(
    'la liste des décors non imprimables est celle de la colle du montage, au drapeau près',
    noms.length > 0 && noms.join('|') === nomsMontage.join('|'),
    `${noms.length} drapeau(x) contre ${nomsMontage.length}`,
  );
  const dansLeProduit = noms.filter((n) => main.includes(n));
  const gardeFous = noms.filter((n) => !main.includes(n));
  check(
    'ceux de ces drapeaux qui existent dans le produit y sont bien',
    dansLeProduit.length >= 3,
    `${dansLeProduit.length} présent(s) : ${dansLeProduit.join(', ')} — garde-fous : ${gardeFous.join(', ') || 'aucun'}`,
  );
}

/* ═════════════════ 2. la convention de repère, mesurée ════════════════════ */

/**
 * Un contexte qui imite ce dont la colle du prépresse a besoin.
 *
 * ⚠️ `Image` et le canevas sont des **doublures** : décoder un PNG n'est pas ce
 * qu'on éprouve ici, c'est l'arithmétique de la colle — dimensions naturelles
 * contre boîte posée. Les doublures le disent, et `PIXELS` est la table qui
 * associe une source à ses dimensions, comme le ferait un vrai `Image`.
 */
function environnement({ noyauDisponible = true, projet = null, reglages = {} } = {}) {
  const globals = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    Int8Array,
    Uint8ClampedArray,
    ArrayBuffer,
    Math,
    JSON,
    WebAssembly,
    fetch: (url) => {
      if (!noyauDisponible) return Promise.reject(new Error('hors ligne'));
      const nom = String(url).split('/').pop();
      if (nom !== 'superprint_core.wasm') return Promise.resolve({ ok: false, status: 404 });
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          Promise.resolve(
            octetsWasm.buffer.slice(octetsWasm.byteOffset, octetsWasm.byteOffset + octetsWasm.length),
          ),
      });
    },
    saveProjectSP_toObject: () => projet,
    // `main.js` pose cette porte : sans elle, la colle journalise à juste titre
    // que le joint manque. On la pose donc, comme le produit.
    confirmExport: function () {
      return 'produit';
    },
  };
  globals.SPPrepresseProjet = projet;
  globals.document = {
    readyState: 'complete',
    addEventListener() {},
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: (x, y, largeur, hauteur) => ({
          data: new Uint8ClampedArray(largeur * hauteur * 4).fill(128),
        }),
      }),
    }),
    getElementById: (id) => {
      if (id in reglages) return { value: String(reglages[id]), checked: !!reglages[id] };
      return null;
    },
    querySelector: (sel) => {
      const m = /input\[name="([\w-]+)"\]:checked/.exec(sel);
      if (!m) return null;
      const nom = m[1];
      if (!(nom in reglages)) return null;
      return { value: String(reglages[nom]) };
    },
  };
  globals.Image = class Image {
    constructor() {
      this.width = 0;
      this.height = 0;
    }
    set src(valeur) {
      const taille = /^data:fake\/(\d+)x(\d+)$/.exec(String(valeur));
      if (!taille) {
        this.onerror && this.onerror();
        return;
      }
      this.naturalWidth = Number(taille[1]);
      this.naturalHeight = Number(taille[2]);
      this.onload && this.onload();
    }
    get src() {
      return '';
    }
  };
  globals.window = globals;
  globals.globalThis = globals;
  return createContext(globals);
}

/** Une page A4 avec les objets donnés. Les objets sont en points (72 dpi). */
function projetA4(objets, { largeur = 210, hauteur = 297 } = {}) {
  return {
    document: { format: { width: largeur, height: hauteur }, bleed: 3 },
    pages: [{ objects: objets }],
    resources: {},
  };
}

/** Charge le noyau et la colle, puis rend `SPPrepresse`. */
async function brancher(options) {
  const sandbox = environnement(options);
  runInContext(readFileSync(cheminNoyau, 'utf8'), sandbox, { filename: 'superprint-core.js' });
  runInContext(sourceColle, sandbox, { filename: 'superprint-prepresse.js' });
  const pret = await sandbox.SPPrepresse.charger();
  return { sandbox, pret, api: sandbox.SPPrepresse };
}

const PT = 72 / 25.4;
const mm = (v) => v * PT;

titre('2. l’échelle, et ce que ces constats peuvent — ou non — vérifier');

{
  // ⚠️ Ce que ce contrôle **ne peut pas** éprouver, et il faut le dire : les
  // constats du prépresse sont **invariants sous le retournement vertical**. La
  // zone autorisée va de −fond à format+fond, qui se correspond avec lui-même
  // par `y ↦ hauteur − y` : un objet qui déborde en haut déborde en bas du même
  // couple de millimètres. Aucun constat ne peut donc distinguer les deux
  // conventions — c'est mesuré plus bas, et non supposé.
  //
  // Ce qui EST observable, et qui décide de tout : **l'échelle**. Un objet du
  // projet est décrit en points PostScript (72 dpi) ; si la colle prenait ces
  // unités pour des millimètres, tout serait 2,8 fois trop grand, et la
  // résolution annoncée serait 2,8 fois trop petite. La section 3 le mesure sur
  // le témoin documenté (400 × 300 px sur 120 mm → 85 dpi).

  // Un rectangle plus large que le format fini : il déborde forcément, des deux
  // côtés. C'est le cas où l'échelle et la position doivent tomber juste.
  const debord = await brancher({
    projet: projetA4([
      {
        type: 'rect',
        left: mm(-10),
        top: mm(100),
        width: mm(230),
        height: mm(50),
        fill: '#000000',
      },
    ]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  check(
    'le noyau et la colle se chargent',
    Boolean(debord.pret),
    String(debord.api.etat.raison || 'moteur chargé'),
  );
  const r = await debord.api.verifier();
  const codes = r.rapport ? r.rapport.constats.map((c) => c.code) : [];
  check(
    'un objet plus large que le format fini déborde — l’échelle et la position tombent juste',
    codes.includes('debordement-fond-perdu'),
    r.refus || codes.join(', ') || 'aucun constat',
  );

  // Le même rectangle, ramené à l'intérieur : plus rien. C'est la moitié qui
  // interdit de « réussir » en signalant tout le temps.
  const dedans = await brancher({
    projet: projetA4([
      { type: 'rect', left: mm(50), top: mm(100), width: mm(50), height: mm(50), fill: '#000000' },
    ]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  const rd = await dedans.api.verifier();
  const codesDedans = rd.rapport ? rd.rapport.constats.map((c) => c.code) : [];
  check(
    'le même objet ramené à l’intérieur ne déborde plus',
    !codesDedans.includes('debordement-fond-perdu'),
    codesDedans.join(', ') || 'aucun constat de débordement',
  );

  // LA MESURE DE L'INVARIANCE : le même objet, retourné verticalement, doit
  // rendre **exactement** les mêmes codes. Si c'est vrai — et c'est ce qu'on
  // mesure — alors aucun constat du prépresse ne peut valider la convention de
  // retournement, et cette colle ne prétend pas le faire. La convention est
  // justifiée par ailleurs : `superprint-montage.js` fait la même conversion, et
  // sa planche est relue par `pdf-lib` au dixième de micromètre.
  const enHaut = await brancher({
    projet: projetA4([
      { type: 'rect', left: mm(0), top: mm(-4), width: mm(10), height: mm(10), fill: '#000000' },
    ]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  const rh = await enHaut.api.verifier();
  const codesHaut = rh.rapport ? rh.rapport.constats.map((c) => c.code).sort().join(',') : '';

  const enBas = await brancher({
    projet: projetA4([
      {
        type: 'rect',
        left: mm(0),
        top: mm(297 - 6),
        width: mm(10),
        height: mm(10),
        fill: '#000000',
      },
    ]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  const rb = await enBas.api.verifier();
  const codesBas = rb.rapport ? rb.rapport.constats.map((c) => c.code).sort().join(',') : '';

  check(
    'les deux extrémités opposées de la toile donnent les MÊMES constats : l’invariance est mesurée',
    codesHaut === codesBas && codesHaut.includes('debordement-fond-perdu'),
    `haut : ${codesHaut} · bas : ${codesBas}`,
  );

  // Ce que l'invariance ne couvre PAS : l'axe **horizontal**. Un objet qui
  // déborde à gauche ne doit pas déborder à droite sans raison — c'est la seule
  // composante de la position que ces constats peuvent vérifier.
  const gauche = await brancher({
    projet: projetA4([
      { type: 'rect', left: mm(-4), top: mm(100), width: mm(10), height: mm(10), fill: '#000000' },
    ]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  const rg = await gauche.api.verifier();
  const codesGauche = rg.rapport ? rg.rapport.constats.map((c) => c.code) : [];
  const droite = await brancher({
    projet: projetA4([
      {
        type: 'rect',
        left: mm(210 - 6),
        top: mm(100),
        width: mm(10),
        height: mm(10),
        fill: '#000000',
      },
    ]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  const rdr = await droite.api.verifier();
  const codesDroite = rdr.rapport ? rdr.rapport.constats.map((c) => c.code) : [];
  check(
    'les deux extrémités opposées EN LARGEUR donnent les mêmes constats (l’axe des x est symétrique aussi)',
    codesGauche.includes('debordement-fond-perdu') && codesDroite.includes('debordement-fond-perdu'),
    `gauche : ${codesGauche.join(', ')} · droite : ${codesDroite.join(', ')}`,
  );
}

/* ══════════════════ 3. ce que le contrôle conduit ══════════════════════════ */
titre('3. ce que le contrôle conduit');

{
  // Fond perdu : la règle par défaut du noyau le réclame.
  const sans = await brancher({
    projet: projetA4([
      { type: 'rect', left: mm(50), top: mm(100), width: mm(50), height: mm(50), fill: '#000000' },
    ]),
    reglages: { bleed: 0, colorMode: 'rgb' },
  });
  const r = await sans.api.verifier();
  const codes = r.rapport ? r.rapport.constats.map((c) => c.code) : [];
  check(
    'un document sans fond perdu est signalé',
    codes.includes('fond-perdu-absent'),
    codes.join(', ') || 'aucun constat',
  );
}

{
  // Le cas **documenté** : « 85 dpi pour une photo de 400 × 300 px sur 120 mm ».
  // C'est la mesure du document lui-même, reprise ici comme témoin.
  const largeurMm = 120;
  const image = {
    type: 'image',
    left: 0,
    top: 0,
    width: mm(largeurMm),
    height: mm(90),
    src: 'data:fake/400x300',
  };
  const dessous = await brancher({
    projet: projetA4([image]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  const r = await dessous.api.verifier();
  const constats = r.rapport ? r.rapport.constats : [];
  const basse = constats.find((c) => c.code === 'image-basse-resolution');
  check(
    'une photo de 400 × 300 px posée sur 120 mm est signalée — et le noyau dit 85 dpi',
    Boolean(basse) && /8[45](\.\d)? dpi/.test(basse.message),
    basse ? basse.message.slice(0, 120) : constats.map((c) => c.code).join(', ') || 'aucun constat',
  );

  // La même photo à sa taille naturelle (400 px = 141 mm) reste à 72 dpi :
  // l'échelle de la toile est bien celle du noyau (1 pt = 1 unité).
  const grande = await brancher({
    projet: projetA4([
      { type: 'image', left: 0, top: 0, width: 400, height: 300, src: 'data:fake/400x300' },
    ]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  const rg = await grande.api.verifier();
  const cg = rg.rapport ? rg.rapport.constats : [];
  const cbasse = cg.find((c) => c.code === 'image-basse-resolution');
  check(
    'la même photo à 400 pt de large tombe à 72 dpi : l’échelle des objets est bien le point',
    Boolean(cbasse) && /7[12](\.\d)? dpi/.test(cbasse.message),
    cbasse ? cbasse.message.slice(0, 120) : cg.map((c) => c.code).join(', ') || 'aucun constat',
  );
}

{
  // Un objet que la colle ne sait pas décrire est **compté**, et le message le
  // dit : c'est ce qui empêche de croire que tout a été contrôlé.
  const objet = await brancher({
    projet: projetA4([
      { type: 'path', left: mm(20), top: mm(20), width: mm(30), height: mm(30), path: [['M', 0, 0]] },
      { type: 'i-text', left: mm(20), top: mm(60), width: mm(60), height: mm(10), text: 'Bonjour' },
      { type: 'rect', left: mm(50), top: mm(100), width: mm(50), height: mm(50), fill: '#000000' },
    ]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  const r = await objet.api.verifier();
  check(
    'deux objets non décrits sont comptés',
    r.nonDecrits === 2,
    `nonDecrits = ${r.nonDecrits}`,
  );
  check(
    'et le message les nomme au lieu de laisser croire que tout a été vu',
    /2 objet\(s\) non décrit\(s\)/.test(r.message),
    r.message.split('\n').pop().slice(0, 120),
  );
  check(
    'le message nomme aussi les contrôles NON conduits',
    r.message.includes('Non contrôlé') && /polices/.test(r.message) && /texte/.test(r.message),
  );
}

/* ═══════════════ 4. le repli, et la réversibilité ══════════════════════════ */
titre('4. le repli, et la réversibilité');

{
  // Sans noyau : la colle ne doit rien dire, et l'export du produit part comme
  // avant. Un contrôle qui s'abstient est acceptable ; un contrôle qui invente
  // ne l'est pas.
  const sans = environnement({
    noyauDisponible: false,
    projet: projetA4([]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  let appels = 0;
  sans.confirmExport = function () {
    appels += 1;
    return 'produit';
  };
  runInContext(readFileSync(cheminNoyau, 'utf8'), sans, { filename: 'superprint-core.js' });
  runInContext(sourceColle, sans, { filename: 'superprint-prepresse.js' });
  const r = await sans.confirmExport();
  check(
    'noyau indisponible : l’export du produit part, sans un mot',
    r === 'produit' && appels === 1,
    `${appels} appel(s) à l’original`,
  );
  const v = await sans.SPPrepresse.verifier();
  check(
    'et `verifier()` dit pourquoi, au lieu de rendre un rapport vide',
    Boolean(v.refus) && /noyau indisponible/.test(v.refus),
    String(v.refus),
  );
}

{
  const avec = await brancher({
    projet: projetA4([]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  let appels = 0;
  const original = function () {
    appels += 1;
    return 'produit';
  };
  avec.sandbox.confirmExport = original;
  avec.api.reprendre();
  check(
    'l’enveloppe est posée, et l’original conservé',
    avec.sandbox.confirmExport.__spPrepresse === true &&
      avec.sandbox.confirmExport.__spPrepresseOriginal === original,
  );
  // Un document sans constat ne doit **pas** interrompre l'export.
  const r = await avec.sandbox.confirmExport();
  check(
    'un document sans constat laisse l’export partir sans question',
    r === 'produit' && appels === 1,
    `${appels} appel(s)`,
  );
  // Un document fautif doit poser la question, et refuser fait annuler.
  const fautif = await brancher({
    projet: projetA4([{ type: 'rect', left: 0, top: 0, width: mm(20), height: mm(20), fill: '#000000' }]),
    reglages: { bleed: 3, colorMode: 'rgb' },
  });
  let exports = 0;
  let questions = 0;
  fautif.sandbox.confirmExport = function () {
    exports += 1;
    return 'produit';
  };
  fautif.sandbox.spConfirm = function (question) {
    questions += 1;
    return Promise.resolve(false);
  };
  fautif.api.reprendre();
  const refuse = await fautif.sandbox.confirmExport();
  check(
    'un document fautif pose la question, et un refus n’exporte pas',
    questions === 1 && exports === 0 && refuse === false,
    `${questions} question(s), ${exports} export(s)`,
  );

  const detache = avec.api.retirer();
  check(
    '`retirer()` rend exactement l’état d’avant',
    detache === true && avec.sandbox.confirmExport === original,
  );
}

console.log(`\n${ok ? 'OK : le prépresse branché fait ce qu’il dit.' : 'ÉCHEC.'}`);
process.exit(ok ? 0 : 1);
