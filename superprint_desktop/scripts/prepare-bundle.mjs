#!/usr/bin/env node
/**
 * Prépare ce que chaque paquet de bureau embarque.
 *
 * POURQUOI CE SCRIPT EXISTE. Les trois applications vivent dans `superprint/`,
 * à des endroits différents : l'éditeur dans `app/`, le Studio IA dans un
 * fichier HTML à la racine, SuperTyPo dans son propre dossier. Tauri, lui,
 * n'embarque qu'UN dossier, et un dossier par application : trois applications,
 * trois paquets, trois installeurs par système. Ce script fabrique ces dossiers,
 * et rien de plus — aucune source n'est modifiée, tout est recopié.
 *
 *     node scripts/prepare-bundle.mjs              # les trois
 *     node scripts/prepare-bundle.mjs studio       # un seul
 *
 * CE QUE CHAQUE PAQUET CONTIENT, ET RIEN DE PLUS. C'est tout l'intérêt de la
 * séparation, et ce n'est pas une intuition : chaque application a été passée
 * au crible de ses propres références (`src=` / `href=`) avant d'écrire ces
 * listes. Mesuré le 2026-10-13 :
 *
 *   · SuperPrint (éditeur) — 57,7 Mo, dont 20 Mo de polices dans `app/CSS/`.
 *     Il lui faut `app/` ENTIER, plus `superprint/icons/`, parce que ses pages
 *     remontent à `../icons/` pour le logotype du Studio et celui de SuperTyPo.
 *     C'est pour cette raison que `app/` n'est PAS aplati à la racine : aplati,
 *     ce `../icons/` sortirait du dossier embarqué et les deux logotypes
 *     disparaîtraient sans bruit.
 *   · Studio IA — `sp213-studio.html` renommé en `index.html`, le moteur de
 *     toile `JS/fabric.min.js` (le seul script externe qu'il charge), le
 *     favicon, deux logotypes, et la feuille de polices du site avec TOUTES ses
 *     polices : le Studio laisse choisir la police du texte, il ne peut donc pas
 *     se contenter d'un sous-ensemble.
 *   · SuperTyPo — 0,82 Mo, entièrement autonome : son dossier, plus son
 *     logotype dans `icons/`. C'est le plus petit des trois, de très loin.
 *
 * AUCUN LIEN ENTRE LES TROIS. Vérifié : ni `app/index.html`, ni
 * `sp213-studio.html`, ni `supertypo/index.html` ne pointent vers une des deux
 * autres applications. Chaque paquet est donc complet et indépendant — aucun
 * lien mort une fois les trois séparés.
 *
 * DÉDUPLICATION DES POLICES. Dans le paquet de l'éditeur, `CSS/fonts.css`
 * pointerait vers des fichiers déjà présents dans `app/CSS/fonts/` : 19,6 Mo
 * sur 19,8 Mo y sont octet pour octet identiques (mesuré le 2026-10-13 : 176
 * fichiers sur 185). On réécrit donc la feuille pour qu'elle réutilise la copie
 * de `app/`, et seuls les 9 fichiers qui n'y sont pas sont réellement copiés.
 *
 * LE JOURNAL DU `.deb`, SEUL FICHIER NON RECOPIÉ. Tauri sait compresser un
 * journal de modifications, mais l'écrit sous le nom BRUT du produit
 * (`SuperPrint/`) alors que le paquet s'appelle `super-print` : il créerait un
 * second dossier de documentation, mal nommé. On préfère tout ranger sous
 * `/usr/share/doc/<paquet>/` avec `deb.files`, qui recopie sans compresser —
 * d'où `compresserJournalDebian`. Idem pour le fichier `copyright`, obligatoire
 * et absent de ce que Tauri produit : `ecrireCopyrightDebian` l'assemble.
 *
 * VÉRIFICATION DES RÉFÉRENCES, À LA FIN. Chaque `src=` / `href=` local des pages
 * embarquées est résolu sur le disque. Un fichier manquant fait ÉCHOUER la
 * construction : une image absente dans une application installée est une chose
 * qu'on ne découvre qu'après la livraison.
 *
 * Le site public n'est jamais touché : tout ceci ne concerne que les copies
 * embarquées.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, constants as zlibConstants } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const product = path.resolve(desktop, '..', 'superprint');
const sortie = path.join(desktop, 'frontend');
const srcTauri = path.join(desktop, 'src-tauri');

const log = (msg) => console.log(`  ${msg}`);

/** Copie récursive, sans jamais suivre un lien symbolique. */
async function copier(src, dst) {
  await fs.cp(src, dst, { recursive: true, dereference: false });
}

/** Empreinte du contenu, ou `null` si le fichier n'existe pas. */
async function empreinte(fichier) {
  try {
    return createHash('sha256').update(await fs.readFile(fichier)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Recopie `CSS/fonts.css` dans le paquet, avec les polices qu'il demande.
 *
 * `chezApp` dit où chercher une copie déjà présente, chemin relatif à la racine
 * du paquet (`app/CSS/fonts` pour l'éditeur). Quand elle est là et identique au
 * fichier d'origine, la feuille est RÉÉCRITE pour la réutiliser : sans cela,
 * 19,6 Mo de polices seraient livrées deux fois dans le même paquet. Quand
 * `chezApp` vaut `null` — le Studio n'embarque pas `app/` — toutes les polices
 * sont copiées à côté de la feuille, et aucune réécriture n'a lieu.
 *
 * ⚠️ 27 des 117 polices référencées par cette feuille **n'existent pas** dans
 * `superprint/CSS/fonts/` (mesuré le 2026-10-13 : `bricolage-4..12`,
 * `newsreader-4..12`, `spacegrotesk-4..12` — seuls les rangs 1 à 3 sont
 * présents). Le site les demande donc déjà dans le vide ; ce script ne fait que
 * reproduire ce comportement et le SIGNALE, pour ne pas transformer un défaut
 * existant du site en échec de construction de l'application de bureau.
 */
async function copierFeuilleDePolices(racine, chezApp) {
  const source = path.join(product, 'CSS', 'fonts.css');
  const cible = path.join(racine, 'CSS', 'fonts.css');

  let css = await fs.readFile(source, 'utf8');
  let reutilisees = 0;
  const aCopier = new Set();
  const introuvables = [];

  for (const m of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    const brut = m[2];
    if (/^(https?:|data:|#)/.test(brut)) continue;

    const nom = path.posix.basename(brut.replace(/[?#].*$/, ''));
    const original = path.join(product, 'CSS', 'fonts', nom);
    const hOrigine = await empreinte(original);

    if (hOrigine === null) {
      introuvables.push(nom);
      continue;
    }
    if (chezApp !== null) {
      const hApp = await empreinte(path.join(racine, chezApp, nom));
      if (hApp === hOrigine) {
        css = css.replaceAll(`url(${m[1]}${brut}${m[1]})`, `url(../${chezApp}/${nom})`);
        reutilisees += 1;
        continue;
      }
    }
    aCopier.add(nom);
  }

  for (const nom of aCopier) {
    const dst = path.join(racine, 'CSS', 'fonts', nom);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(path.join(product, 'CSS', 'fonts', nom), dst);
  }

  await fs.mkdir(path.dirname(cible), { recursive: true });
  await fs.writeFile(cible, css, 'utf8');
  log(`polices : ${reutilisees} réutilisées de app/, ${aCopier.size} copiées`);
  if (introuvables.length) {
    log(`⚠️  ${introuvables.length} police(s) absentes de superprint/CSS/fonts/ — DÉFAUT PRÉEXISTANT du site,`);
    log(`    reproduit tel quel : ${introuvables.slice(0, 4).join(', ')}${introuvables.length > 4 ? ', …' : ''}`);
  }
}

/**
 * Les trois applications, et ce qu'il faut copier pour chacune.
 *
 * `pages` liste les pages dont les références sont vérifiées. `chezApp` est le
 * dossier de polices déjà présent dans le paquet, ou `null`.
 */
const APPLICATIONS = {
  superprint: {
    nom: 'SuperPrint',
    pages: ['app/index.html'],
    assembler: async (racine) => {
      await copier(path.join(product, 'app'), path.join(racine, 'app'));
      await copier(path.join(product, 'icons'), path.join(racine, 'icons'));
    }
  },
  studio: {
    nom: 'Studio IA',
    pages: ['index.html'],
    assembler: async (racine) => {
      await fs.copyFile(path.join(product, 'sp213-studio.html'), path.join(racine, 'index.html'));
      await copier(path.join(product, 'JS'), path.join(racine, 'JS'));
      await copier(path.join(product, 'icons'), path.join(racine, 'icons'));
      await fs.copyFile(path.join(product, 'favicon.png'), path.join(racine, 'favicon.png'));
      await copierFeuilleDePolices(racine, null);
    }
  },
  supertypo: {
    nom: 'SuperTyPo',
    pages: ['supertypo/index.html'],
    assembler: async (racine) => {
      await copier(path.join(product, 'supertypo'), path.join(racine, 'supertypo'));
      await copier(path.join(product, 'icons'), path.join(racine, 'icons'));
    }
  }
};

/**
 * Le service worker n'a rien à faire dans une application de bureau.
 *
 * POURQUOI CE NETTOYAGE EXISTE. Le service worker est un mécanisme de site web :
 * il rend une page utilisable hors-ligne en gardant des fichiers en cache. Dans
 * une application de bureau il n'apporte RIEN — les fichiers sont déjà dans le
 * binaire — et il peut faire beaucoup de mal, parce qu'il SURVIT aux mises à
 * jour : il vit dans le profil du navigateur, pas dans l'application.
 *
 * Une version antérieure de cet empaquetage l'a laissé s'installer. Mesuré le
 * 2026-10-13 sur l'application installée : le service worker servait son cache
 * à la place des fichiers réels — `/` et `/index.html` renvoyaient un éditeur de
 * 565 907 octets au lieu de la page attendue, et `/CSS/main.css` renvoyait un
 * fichier qui n'existe pas à cette adresse. Résultat : un écran sans CSS ni
 * JavaScript, et aucune mise à jour possible tant que le cache restait en place.
 *
 * CE QU'ON ÉCRIT, ET POURQUOI. Deux choses, et pas une de moins :
 *
 *   1. La PURGE, INLINE, dans la page d'entrée de chaque application. Elle
 *      désenregistre tout service worker et vide tous les caches. C'est elle qui
 *      RÉPARE les installations déjà abîmées. Elle doit être dans la page
 *      elle-même — pas dans un fichier séparé, qui serait justement le genre de
 *      fichier que le cache empoisonné sait resservir.
 *      La fenêtre ouvre `app/index.html`, absent du cache fautif : la réponse
 *      vient donc du binaire, et la purge s'exécute.
 *
 *   2. Un DÉSINSTALLEUR à l'emplacement du service worker fautif, plus la
 *      neutralisation de `pwa.js` — le fichier qui DÉCLENCHE l'enregistrement.
 *      Sans cette seconde partie, chaque ouverture de l'éditeur en
 *      réinstallerait un et la purge ne servirait à rien.
 *
 * La purge ne peut pas boucler : elle ne recharge la page qu'une fois par
 * session, et renonce si `sessionStorage` n'est pas disponible. Au pire, elle ne
 * recharge pas — le lancement suivant est propre, l'enregistrement et les caches
 * ayant déjà été supprimés.
 */
const PURGE = `(function () {
  var aSW = 'serviceWorker' in navigator;
  var aCaches = typeof caches !== 'undefined';
  if (!aSW && !aCaches) return;
  var travaux = [];
  if (aSW) {
    travaux.push(navigator.serviceWorker.getRegistrations().then(function (enregistrements) {
      return Promise.all(enregistrements.map(function (r) { return r.unregister(); }));
    }));
  }
  if (aCaches) {
    travaux.push(caches.keys().then(function (noms) {
      return Promise.all(noms.map(function (n) { return caches.delete(n); }));
    }));
  }
  Promise.all(travaux).then(function () {
    if (!aSW || !navigator.serviceWorker.controller) return;
    try {
      if (sessionStorage.getItem('spPurgeSW')) return;   // deja recharge
      sessionStorage.setItem('spPurgeSW', '1');
    } catch (e) {
      return;   // pas de sessionStorage : on ne recharge pas, pour ne jamais boucler
    }
    location.reload();
  });
})();`;

async function retirerServiceWorker(racine, entree) {
  const desinstalleur = `/* SuperPrint — application de bureau : ce service worker se désenregistre.
   Le service worker n'apporte rien dans une application de bureau et peut servir
   des fichiers périmés. Ce fichier existe pour REPRENDRE l'enregistrement laissé
   par une version antérieure, vider son cache, puis disparaître.
   Voir scripts/prepare-bundle.mjs. */
self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) await caches.delete(nom);
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
`;
  const nettoyeur = `/* SuperPrint — application de bureau : nettoyage du service worker.
   Ce fichier remplace le démarrage PWA du site (scripts/prepare-bundle.mjs).
   L'application de bureau n'a pas besoin de service worker : ses fichiers sont
   embarqués dans le binaire. L'ancien démarrage en laissait un s'installer, qui
   servait ensuite des fichiers périmés — d'où un écran sans CSS ni JavaScript. */
(function () {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (enregistrements) {
      enregistrements.forEach(function (r) { r.unregister(); });
    });
  }
  if (typeof caches !== 'undefined') {
    caches.keys().then(function (noms) {
      noms.forEach(function (n) { caches.delete(n); });
    });
  }
})();
`;

  const pwa = path.join(racine, 'app', 'JS', 'pwa.js');
  if (await empreinte(pwa) !== null) {
    await fs.writeFile(pwa, nettoyeur, 'utf8');
    await fs.writeFile(path.join(racine, 'app', 'service-worker.js'), desinstalleur, 'utf8');
  }
  await fs.writeFile(path.join(racine, 'service-worker.js'), desinstalleur, 'utf8');

  // La purge, dans la page que la fenêtre ouvre réellement. Insérée juste après
  // l'ouverture de `<head>` : avant tout ce qui peut charger.
  const fichierEntree = path.join(racine, entree);
  const html = await fs.readFile(fichierEntree, 'utf8');
  if (!/<head[^>]*>/i.test(html)) {
    throw new Error(`pas de <head> dans ${entree} : impossible d'y placer la purge`);
  }
  const marqueur = `<!-- Purge d'un service worker hérité — voir scripts/prepare-bundle.mjs.
     Doit rester INLINE et AVANT tout le reste : placée dans un fichier séparé,
     elle serait elle-même servie par le cache qu'elle doit supprimer. -->
<script>${PURGE}</script>`;
  await fs.writeFile(fichierEntree, html.replace(/<head[^>]*>/i, (m) => `${m}\n${marqueur}`), 'utf8');
  log(`purge du service worker posée dans ${entree}`);
}

/**
 * Vérifie qu'aucun fichier embarqué ne peut plus DÉCLENCHER un enregistrement de
 * service worker. C'est la seule protection qui compte : le désinstalleur ne
 * sert à rien si une page en réenregistre un au chargement suivant.
 */
async function verifierAucunEnregistrement(racine) {
  const coupables = [];
  const exclure = new Set([
    path.resolve(racine, 'service-worker.js'),
    path.resolve(racine, 'app', 'service-worker.js')
  ]);

  const parcourir = async (dossier) => {
    for (const e of await fs.readdir(dossier, { withFileTypes: true })) {
      const p = path.join(dossier, e.name);
      if (e.isDirectory()) { await parcourir(p); continue; }
      if (!e.isFile() || !/\.(?:html|js|mjs)$/i.test(e.name)) continue;
      if (exclure.has(path.resolve(p))) continue;
      const texte = await fs.readFile(p, 'utf8');
      if (/serviceWorker\s*\.\s*register\s*\(/.test(texte) ||
          /\.\s*register\s*\(\s*['"`][^'"`]*service-worker/i.test(texte)) {
        coupables.push(path.relative(racine, p).replace(/\\/g, '/'));
      }
    }
  };

  await parcourir(racine);
  if (coupables.length) {
    throw new Error(
      `enregistrement de service worker encore possible dans : ${coupables.join(', ')}`
    );
  }
}

/**
 * Résout chaque référence locale des pages embarquées. Renvoie la liste de ce
 * qui manque — vide, sinon.
 *
 * Deux retraits avant lecture, et ils comptent tous les deux :
 *   · les COMMENTAIRES HTML — `app/index.html` porte
 *     `<!-- script src="JS/app-logic.js" … -->`, une référence éteinte. La
 *     compter ferait échouer la construction pour un fichier que personne ne
 *     charge ;
 *   · le CORPS des `<script>` — le Studio IA y contient une expression
 *     rationnelle qui ressemble à `src="data:…"`. Le contenu dynamique n'est pas
 *     vérifiable statiquement : seules les balises le sont.
 */
async function verifierReferences(racine, pages) {
  const manquants = [];

  for (const page of pages) {
    const fichier = path.join(racine, page);
    const html = (await fs.readFile(fichier, 'utf8'))
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2');

    for (const m of html.matchAll(/(?:src|href)=(["'])([^"']+)\1/g)) {
      const ref = m[2];
      if (/^(https?:|\/\/|#|mailto:|data:|javascript:|\/)/i.test(ref)) continue;

      const cible = path.resolve(path.dirname(fichier), ref.replace(/[?#].*$/, ''));
      if (cible !== racine && !cible.startsWith(racine + path.sep)) {
        manquants.push(`${page} → ${ref} (sort du dossier embarqué)`);
        continue;
      }
      try {
        await fs.access(cible);
      } catch {
        manquants.push(`${page} → ${ref}`);
      }
    }
  }
  return manquants;
}

/**
 * Compresse le journal des modifications du `.deb` en `changelog.gz` (niveau 9).
 *
 * POURQUOI ICI, ET PAS AVEC L'OPTION `changelog` DE TAURI. Tauri écrit son
 * journal dans `/usr/share/doc/<productName>/changelog.gz` — soit `SuperPrint/`,
 * alors que le paquet s'appelle `super-print` (le nom est le kebab-case de
 * `productName`). Emprunter cette option laisserait donc deux dossiers de
 * documentation dans le paquet, dont un mal nommé. On préfère tout ranger sous
 * `/usr/share/doc/<paquet>/` — ce que fait `deb.files`, qui RECOPIE sans
 * compresser : d'où cette compression en amont.
 *
 * La politique Debian (§12.7) demande le journal « compressé en gzip-9 ».
 */
async function compresserJournalDebian() {
  const source = path.join(srcTauri, 'debian-changelog');
  const cible = path.join(srcTauri, 'debian-changelog.gz');
  const texte = await fs.readFile(source);
  await fs.writeFile(cible, gzipSync(texte, { level: zlibConstants.Z_BEST_COMPRESSION }));
  log(`journal Debian compressé : ${texte.length} → ${(await fs.stat(cible)).size} octets`);
}

/**
 * Fabrique `/usr/share/doc/<paquet>/copyright`, obligatoire dans un `.deb`
 * (politique Debian §12.5) : sans lui, le paquet est non conforme.
 *
 * Le fichier est ASSEMBLÉ à la construction, et non recopié, pour une seule
 * raison : le texte de la licence doit être celui du dépôt, mot pour mot. Le
 * recopier à la main dans un second fichier garantirait qu'il finisse par
 * diverger du vrai. Ici la divergence est structurellement impossible.
 *
 * Le fichier produit reste NON COMPRESSÉ, comme l'exige la politique.
 */
async function ecrireCopyrightDebian() {
  const enTete = await fs.readFile(path.join(srcTauri, 'debian-copyright-header'), 'utf8');
  const licence = await fs.readFile(path.join(desktop, '..', 'LICENSE'), 'utf8');
  const cible = path.join(srcTauri, 'copyright');
  await fs.writeFile(cible, `${enTete}${licence.trimEnd()}\n`, 'utf8');
  log(`copyright Debian écrit (${(await fs.stat(cible)).size} octets : en-tête + LICENSE intégral)`);
}

async function mesurer(dossier) {
  let octets = 0;
  let fichiers = 0;
  const parcourir = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await parcourir(p);
      else if (e.isFile()) { fichiers += 1; octets += (await fs.stat(p)).size; }
    }
  };
  await parcourir(dossier);
  return { fichiers, octets };
}

async function construireApplication(cle) {
  const app = APPLICATIONS[cle];
  const racine = path.join(sortie, cle);

  console.log(`\n${app.nom}  →  frontend/${cle}/`);
  await fs.rm(racine, { recursive: true, force: true });
  await fs.mkdir(racine, { recursive: true });

  await app.assembler(racine);
  await retirerServiceWorker(racine, app.pages[0]);
  await verifierAucunEnregistrement(racine);

  const manquants = await verifierReferences(racine, app.pages);
  if (manquants.length) {
    console.error(`\nRéférences introuvables dans le paquet ${app.nom} :`);
    for (const m of manquants) console.error(`  ✗ ${m}`);
    throw new Error(`${manquants.length} référence(s) introuvable(s) dans ${cle}`);
  }
  log(`références vérifiées (${app.pages.length} page(s))`);

  const { fichiers, octets } = await mesurer(racine);
  log(`${fichiers} fichiers, ${(octets / 1024 / 1024).toFixed(1)} Mo`);
}

/**
 * Convertit un nom de produit en nom de paquet, comme le fait Tauri.
 *
 * POURQUOI CE CALCUL EST ICI. Tauri n'offre AUCUNE option pour nommer un paquet
 * `.deb` : il dérive le nom du `productName` en kebab-case. Rien ne vérifie
 * qu'une adresse écrite à la main dans `deb.files` correspond bien à ce nom. Or
 * `copy_custom_files` crée le dossier demandé sans broncher : une adresse
 * fausse ne produit pas d'erreur, elle dépose la documentation dans un dossier
 * que personne ne lit. Ce calcul permet de comparer, et d'échouer si ça diverge.
 *
 * Reproduit `heck::AsKebabCase` : coupure sur les changements de casse, sur les
 * suites de majuscules, et sur tout ce qui n'est ni lettre ni chiffre.
 */
function nomDePaquet(productName) {
  return productName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Contrôle les trois surcouches de `src-tauri/apps/` avant de compiler.
 *
 * POURQUOI. Chaque surcouche doit redonner la fenêtre entière : la
 * configuration passée par `--config` est fusionnée à la manière d'un
 * « merge patch » JSON, où les OBJETS fusionnent mais où les TABLEAUX sont
 * remplacés en bloc. `app.windows` est un tableau — une surcouche qui ne
 * donnerait que le titre effacerait la taille, la taille minimale et le reste.
 *
 * Cette duplication est donc nécessaire, et c'est précisément le genre de chose
 * qui se met à diverger sans que personne ne s'en aperçoive : les trois fenêtres
 * doivent rester identiques, seuls le titre et la page d'entrée ont le droit de
 * différer.
 *
 * On vérifie aussi l'identité de chaque paquet, et surtout l'adresse de la
 * documentation dans le `.deb`, qui doit suivre le nom du paquet et non le nom
 * affiché (voir `nomDePaquet`).
 */
async function verifierSurcouches() {
  const lire = async (nom) =>
    JSON.parse(await fs.readFile(path.join(srcTauri, nom), 'utf8'));

  const base = await lire('tauri.conf.json');
  const fenetre = ({ title, url, ...reste }) => JSON.stringify(reste);
  const reference = fenetre(base.app.windows[0]);

  const identifiants = new Map();
  const nomsDePaquets = new Map();

  for (const cle of Object.keys(APPLICATIONS)) {
    const fichier = `apps/${cle}.json`;
    let sur;
    try {
      sur = await lire(fichier);
    } catch {
      throw new Error(`surcouche introuvable : src-tauri/${fichier}`);
    }

    const attendu = `../frontend/${cle}`;
    if (sur.build?.frontendDist !== attendu) {
      throw new Error(
        `${fichier} : frontendDist vaut « ${sur.build?.frontendDist} », attendu « ${attendu} »`
      );
    }

    // L'assemblage doit nommer CETTE application. Sans ce contrôle, une
    // surcouche copiée d'une autre embarquerait le mauvais dossier — et le
    // paquet s'appellerait « Studio IA » en contenant l'éditeur. Le fichier
    // serait valide, l'installation réussirait, et personne ne le verrait.
    const commande = sur.build?.beforeBuildCommand ?? base.build?.beforeBuildCommand ?? '';
    const cible = commande.match(/prepare-bundle\.mjs(?:\s+([\w-]+))?/);
    if (!cible || cible[1] !== cle) {
      throw new Error(
        `${fichier} : beforeBuildCommand doit assembler « ${cle} ».\n` +
        `      Il vaut « ${commande} ».\n` +
        `      Attendu : « node scripts/prepare-bundle.mjs ${cle} »`
      );
    }

    if (fenetre(sur.app.windows[0]) !== reference) {
      throw new Error(
        `${fichier} : la fenêtre diffère des autres paquets.\n` +
        `      Seuls « title » et « url » peuvent changer ; toute autre\n` +
        `      différence signifie qu'une surcouche a perdu un réglage commun\n` +
        `      (le tableau app.windows est REMPLACÉ en bloc par Tauri).\n` +
        `      de base   : ${reference}\n` +
        `      surcouche : ${fenetre(sur.app.windows[0])}`
      );
    }

    const id = sur.identifier;
    if (!id) throw new Error(`${fichier} : identifier manquant`);
    if (identifiants.has(id)) {
      throw new Error(`${fichier} : identifier « ${id} » déjà pris par ${identifiants.get(id)}`);
    }
    identifiants.set(id, fichier);

    // Le nom du paquet Debian, et l'adresse de sa documentation.
    const paquet = nomDePaquet(sur.productName);
    nomsDePaquets.set(paquet, fichier);
    const dossier = `/usr/share/doc/${paquet}/`;
    const cles = Object.keys(sur.bundle?.linux?.deb?.files ?? {});
    if (!cles.length) throw new Error(`${fichier} : bundle.linux.deb.files est vide`);
    for (const k of cles) {
      if (!k.startsWith(dossier)) {
        throw new Error(
          `${fichier} : la documentation va dans « ${k} » alors que le paquet\n` +
          `      s'appellera « ${paquet} » (kebab-case de « ${sur.productName} »).\n` +
          `      Le dossier attendu est ${dossier}`
        );
      }
    }

    // Les icônes, qui doivent exister pour de bon.
    for (const champ of ['icon', 'windows.nsis.installerIcon']) {
      const valeurs = champ === 'icon'
        ? (sur.bundle?.icon ?? [])
        : [sur.bundle?.windows?.nsis?.installerIcon].filter(Boolean);
      if (!valeurs.length) throw new Error(`${fichier} : bundle.${champ} est vide`);
      for (const v of valeurs) {
        if (!v.startsWith(`icons/${cle}/`)) {
          throw new Error(`${fichier} : bundle.${champ} pointe vers « ${v} », hors de icons/${cle}/`);
        }
        try {
          await fs.access(path.join(srcTauri, v));
        } catch {
          throw new Error(`${fichier} : icône absente du disque : src-tauri/${v}`);
        }
      }
    }

    if (sur.version !== undefined) {
      throw new Error(`${fichier} : la version doit rester dans tauri.conf.json, pas ici`);
    }
  }

  const identites = [...nomsDePaquets.entries()]
    .map(([p, f]) => `${p} (${f})`)
    .join(', ');
  log(`surcouches vérifiées : ${identites}`);
}

async function main() {
  const demandees = process.argv.slice(2);
  const cles = demandees.length ? demandees : Object.keys(APPLICATIONS);

  for (const cle of cles) {
    if (!APPLICATIONS[cle]) {
      throw new Error(
        `application inconnue : « ${cle} ». Attendu : ${Object.keys(APPLICATIONS).join(', ')}`
      );
    }
  }
  for (const requis of ['app', 'supertypo', 'icons', 'JS', 'CSS', 'sp213-studio.html']) {
    try {
      await fs.access(path.join(product, requis));
    } catch {
      throw new Error(`source introuvable : superprint/${requis}`);
    }
  }

  await fs.mkdir(sortie, { recursive: true });
  await verifierSurcouches();
  for (const cle of cles) await construireApplication(cle);

  // Les deux fichiers du `.deb` qui ne peuvent pas être recopiés tels quels :
  // le journal (à compresser) et le copyright (à assembler).
  console.log('\nFichiers communs aux paquets');
  await compresserJournalDebian();
  await ecrireCopyrightDebian();
}

await main();
