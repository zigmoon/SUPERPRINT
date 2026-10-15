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
 *
 * `binaire` est le nom de l'exécutable — celui de `/usr/bin/`, des icônes et des
 * entrées de bureau. Il est **propre à chaque application** : sans cela Tauri
 * nomme le binaire d'après le projet Cargo (« superprint-desktop ») et les trois
 * paquets installent le même fichier (voir `verifierSurcouches`).
 *
 * `perimetre` et `contenu` alimentent le `copyright` et le journal du `.deb`.
 */
const APPLICATIONS = {
  superprint: {
    nom: 'SuperPrint',
    binaire: 'superprint',
    identifiant: 'cc.superprint.desktop',
    /*
     * L'ÉDITEUR EMBARQUE LES DEUX AUTRES, ET POUR LA MÊME RAISON QUE LE STUDIO.
     * Ses deux boutons — « envoyé au studio SP213 » et l'onglet SuperTyPo du
     * Nouveau Projet — ouvrent des fenêtres sur les deux autres applications. Sans
     * elles dans le paquet, les boutons ouvriraient une page absente.
     *
     * C'est le prix de trois applications qui se parlent. La note
     * `memoire_version.sd`, à la racine du dépôt, décrit la suite : un lanceur dans
     * chaque paquet, et le contenu commun posé une fois.
     */
    pages: ['app/index.html', 'sp213-studio.html'],
    perimetre: "l'éditeur SuperPrint et ses ressources",
    contenu: "l'éditeur SuperPrint, embarqué hors-ligne",
    assembler: async (racine) => {
      await copier(path.join(product, 'app'), path.join(racine, 'app'));
      await copier(path.join(product, 'supertypo'), path.join(racine, 'supertypo'));
      await copier(path.join(product, 'icons'), path.join(racine, 'icons'));
      // Le studio vient à la racine : c'est l'adresse que l'éditeur ouvre depuis
      // `app/index.html` (« ../sp213-studio.html »).
      await fs.copyFile(path.join(product, 'sp213-studio.html'), path.join(racine, 'sp213-studio.html'));
      await fs.copyFile(path.join(product, 'favicon.png'), path.join(racine, 'favicon.png'));
      await copier(path.join(product, 'JS'), path.join(racine, 'JS'));
      // Les polices du studio sont celles de l'éditeur, déjà là : on les réutilise
      // par un chemin relatif au lieu de les recopier une troisième fois (19 Mo).
      await copierFeuilleDePolices(racine, 'app/CSS/fonts');
    }
  },
  studio: {
    nom: 'Studio IA',
    binaire: 'studio-ia',
    identifiant: 'cc.superprint.studio',
    /*
     * LE STUDIO EMBARQUE L'ÉDITEUR, ET C'EST UNE EXCEPTION ASSUMÉE.
     *
     * Les trois paquets sont séparés pour qu'aucun ne porte ce dont il n'a pas
     * besoin. Mais le studio a un bouton ÉDITER qui TRANSFÈRE la maquette à
     * l'éditeur : il dépose le document dans le stockage local, puis ouvre
     * `app/index.html?from=sp213`. Sans l'éditeur dans le paquet, ce bouton n'ouvre
     * rien — le fichier n'existe pas, et le stockage local n'est de toute façon
     * pas partagé entre deux applications distinctes (deux dossiers de profil,
     * donc deux stockages).
     *
     * Deux pages d'entrée, donc : `index.html` (le studio) et `app/index.html`
     * (l'éditeur, ouvert dans une seconde fenêtre par ÉDITER). Les deux reçoivent
     * la purge du service worker.
     */
    pages: ['index.html', 'app/index.html'],
    perimetre: "le studio SP213, l'éditeur SuperPrint et leurs ressources",
    contenu: "le studio SP213 et l'éditeur SuperPrint, embarqués hors-ligne",
    assembler: async (racine) => {
      await fs.copyFile(path.join(product, 'sp213-studio.html'), path.join(racine, 'index.html'));
      await copier(path.join(product, 'JS'), path.join(racine, 'JS'));
      await copier(path.join(product, 'icons'), path.join(racine, 'icons'));
      await copier(path.join(product, 'app'), path.join(racine, 'app'));
      await fs.copyFile(path.join(product, 'favicon.png'), path.join(racine, 'favicon.png'));
      // 176 des 185 polices de la racine sont déjà dans `app/CSS/fonts/` : on
      // les réutilise par un chemin relatif au lieu de les recopier (19 Mo).
      await copierFeuilleDePolices(racine, 'app/CSS/fonts');
    }
  },
  supertypo: {
    nom: 'SuperTyPo',
    binaire: 'supertypo',
    identifiant: 'cc.superprint.supertypo',
    pages: ['supertypo/index.html'],
    perimetre: 'SuperTyPo et ses ressources',
    contenu: 'SuperTyPo, embarqué hors-ligne',
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

async function retirerServiceWorker(racine, entrees) {
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

  // La purge, dans CHAQUE page qu'une fenêtre ouvre réellement. Insérée juste
  // après l'ouverture de `<head>` : avant tout ce qui peut charger.
  //
  // POURQUOI PLUSIEURS PAGES. Le studio en ouvre une seconde — `app/index.html`,
  // par son bouton ÉDITER. Or le service worker fautif vit dans le profil, pas
  // dans le binaire : une page qui ne purge pas peut le réinstaller, et l'écran
  // suivant s'ouvrirait à son tour sans CSS. On purge là où l'on ARRIVE, pas
  // seulement là où l'on démarre.
  const marqueur = `<!-- Purge d'un service worker hérité — voir scripts/prepare-bundle.mjs.
     Doit rester INLINE et AVANT tout le reste : placée dans un fichier séparé,
     elle serait elle-même servie par le cache qu'elle doit supprimer. -->
<script>${PURGE}</script>`;

  for (const entree of entrees) {
    const fichierEntree = path.join(racine, entree);
    const html = await fs.readFile(fichierEntree, 'utf8');
    if (!/<head[^>]*>/i.test(html)) {
      throw new Error(`pas de <head> dans ${entree} : impossible d'y placer la purge`);
    }
    await fs.writeFile(fichierEntree, html.replace(/<head[^>]*>/i, (m) => `${m}\n${marqueur}`), 'utf8');
    log(`purge du service worker posée dans ${entree}`);
  }
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
 * Compresse le journal des modifications du `.deb` en `changelog.gz` (niveau 9),
 * un par application.
 *
 * POURQUOI ICI, ET PAS AVEC L'OPTION `changelog` DE TAURI. Tauri écrit son
 * journal dans `/usr/share/doc/<productName>/changelog.gz` — soit `SuperPrint/`,
 * alors que le paquet s'appelle `super-print` (le nom est le kebab-case de
 * `productName`). Emprunter cette option laisserait donc deux dossiers de
 * documentation dans le paquet, dont un mal nommé. On préfère tout ranger sous
 * `/usr/share/doc/<paquet>/` — ce que fait `deb.files`, qui RECOPIE sans
 * compresser : d'où cette compression en amont.
 *
 * ⚠️ UN JOURNAL PAR PAQUET, ET PAS UN JOURNAL COMMUN. Le premier jet écrivait le
 * même fichier pour les trois paquets, et ce fichier annonçait « super-print »
 * puis décrivait un paquet qui réunissait les trois applications — ce qui était
 * vrai avant, et faux depuis la séparation. Un journal de paquet qui nomme un
 * autre paquet vaut moins que pas de journal du tout.
 *
 * La politique Debian (§12.7) demande le journal « compressé en gzip-9 ».
 */
async function compresserJournauxDebian(versionDuProduit) {
  const gabarit = await fs.readFile(path.join(srcTauri, 'debian-changelog'), 'utf8');

  // `rfc-2822` : « Tue, 13 Oct 2026 18:00:00 +0200 ». Le journal doit porter une
  // date ; celle du jour est la seule qui ne mente pas.
  const date = new Date().toUTCString().replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT$/, '$1, $2 $3 $4 $5 +0000');

  for (const [cle, app] of Object.entries(APPLICATIONS)) {
    const paquet = nomDePaquet(app.nom);
    const texte = gabarit
      .replaceAll('{{PAQUET}}', paquet)
      .replaceAll('{{NOM}}', app.nom)
      .replaceAll('{{VERSION}}', versionDuProduit)
      .replaceAll('{{CONTENU}}', app.contenu)
      .replaceAll('{{DATE}}', date);

    const cible = path.join(srcTauri, `changelog-${cle}.gz`);
    await fs.writeFile(cible, gzipSync(Buffer.from(texte, 'utf8'), { level: zlibConstants.Z_BEST_COMPRESSION }));
    log(`journal ${paquet} : ${texte.length} → ${(await fs.stat(cible)).size} octets`);
  }
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
 * ⚠️ UN FICHIER PAR PAQUET. Le premier jet en écrivait un seul, qui s'annonçait
 * comme accompagnant `super-print` — y compris dans les paquets `studio-ia` et
 * `super-ty-po`. Un lecteur y aurait cherché la licence du mauvais paquet.
 *
 * Le fichier produit reste NON COMPRESSÉ, comme l'exige la politique.
 */
async function ecrireCopyrightsDebian() {
  const gabarit = await fs.readFile(path.join(srcTauri, 'debian-copyright-header'), 'utf8');
  const licence = await fs.readFile(path.join(desktop, '..', 'LICENSE'), 'utf8');

  for (const [cle, app] of Object.entries(APPLICATIONS)) {
    const paquet = nomDePaquet(app.nom);
    const texte = `${gabarit
      .replaceAll('{{PAQUET}}', paquet)
      .replaceAll('{{NOM}}', app.nom)
      .replaceAll('{{PERIMETRE}}', app.perimetre)
      .trimEnd()}\n\n${licence.trimEnd()}\n`;

    const cible = path.join(srcTauri, `copyright-${cle}`);
    await fs.writeFile(cible, texte, 'utf8');
    log(`copyright ${paquet} : ${(await fs.stat(cible)).size} octets (en-tête + LICENSE intégral)`);
  }
}

/**
 * Fabrique les scripts de RETRAIT — un pour Debian, un pour RPM.
 *
 * POURQUOI ILS EXISTENT. Retirer un paquet laissait deux choses derrière lui :
 * l'entrée de menu et l'icône pouvaient rester affichées jusqu'à la prochaine
 * session (le cache du bureau n'était pas rafraîchi), et les données de
 * l'application restaient dans le dossier de chaque utilisateur. Ni le `.deb` ni
 * le `.rpm` ne portaient le moindre script de maintenance — vérifié en
 * DÉCOMPRESSANT les deux : `control.tar.gz` ne contient que `control` et
 * `md5sums`, et la charge utile du `.rpm` cinq entrées, aucune scriptlet.
 *
 * ⚠️ RÈGLE ABSOLUE : CES SCRIPTS NE DOIVENT JAMAIS FAIRE ÉCHOUER UNE
 * DÉSINSTALLATION. `apt` et `dnf` refusent de terminer si un script de retrait
 * rend un code non nul — un nettoyage raté bloquerait alors la désinstallation
 * elle-même, ce qui est bien pire que de laisser un dossier de cache. Chaque
 * commande est donc tolérante à l'échec, et le script sort TOUJOURS par 0.
 *
 * ⚠️ ET ILS NE DOIVENT RIEN FAIRE PENDANT UNE MISE À JOUR. Le premier argument
 * d'un `postrm` Debian vaut `remove`, `purge`, `upgrade`… et celui d'un `postun`
 * RPM est le NOMBRE de paquets restants après l'opération (0 = retrait
 * définitif). On ne touche donc aux données que sur un retrait, jamais sur une
 * mise à jour — sinon installer une nouvelle version effacerait les documents
 * de l'utilisateur.
 */
async function ecrireScriptsDeRetrait() {
  const enTete = (paquet, langue) => `#!/bin/sh
# ${paquet} — nettoyage après retrait (${langue}).
#
# FABRIQUÉ par scripts/prepare-bundle.mjs : ne pas modifier à la main, la
# prochaine construction l'écraserait.
#
# ⚠️ Ce script ne doit JAMAIS faire échouer une désinstallation : toutes les
# commandes sont tolérantes à l'échec et le script sort toujours par 0.
`;

  for (const [cle, app] of Object.entries(APPLICATIONS)) {
    const paquet = nomDePaquet(app.nom);
    const id = app.identifiant;

    const deb = `${enTete(paquet, 'Debian')}
# « upgrade » et « abort-* » : ce n'est pas un retrait, on ne touche à rien.
case "$1" in
  remove|purge) ;;
  *) exit 0 ;;
esac

# Rafraîchir le menu et le cache d'icônes : sans cela, l'entrée supprimée peut
# rester visible jusqu'à la prochaine session.
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

# Les données de chaque utilisateur. On les retire sur « purge », et SEULEMENT
# là : la politique Debian demande de les conserver sur un simple « remove ».
if [ "$1" = "purge" ]; then
  for base in /root /home/*; do
    [ -d "$base" ] || continue
    rm -rf "$base/.local/share/${id}" "$base/.cache/${id}" "$base/.config/${id}" 2>/dev/null || true
  done
fi

exit 0
`;

    const rpm = `${enTete(paquet, 'RPM')}
# Le premier argument d'un « postun » est le nombre de paquets restants : 0
# signifie un retrait définitif. Au-delà, c'est une mise à jour.
case "$1" in
  0) ;;
  *) exit 0 ;;
esac

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

# RPM ne distingue pas « remove » de « purge » : un retrait définitif est le
# seul moment où l'utilisateur a demandé la disparition.
for base in /root /home/*; do
  [ -d "$base" ] || continue
  rm -rf "$base/.local/share/${id}" "$base/.cache/${id}" "$base/.config/${id}" 2>/dev/null || true
done

exit 0
`;

    /* ⚠️ macOS n'a PAS de gestionnaire de paquets : il n'existe aucun script de
       retrait à proprement parler. Ce que l'on fabrique ici est le fichier que
       l'utilisateur trouvera DANS l'image disque, à côté de l'application.

       ⚠️ Un « .command » téléchargé est marqué par Gatekeeper : au premier
       double-clic, macOS demandera une confirmation (clic droit → Ouvrir). Le
       script le dit lui-même à l'écran, plutôt que de laisser l'utilisateur
       croire à une panne. */
    const macos = `#!/bin/bash
# ${app.nom} — désinstallation. Placé dans l'image disque par la construction.
#
# FABRIQUÉ par scripts/prepare-bundle.mjs : ne pas modifier à la main, la
# prochaine construction l'écraserait.
#
# ⚠️ Il ne touche JAMAIS aux documents de l'utilisateur : il retire
# l'application et ses données internes, rien d'autre.

set -u

NOM="${app.nom}"
ID="${id}"

echo "Désinstallation de « $NOM »"
echo ""

# 1. L'application, dans les deux emplacements habituels.
trouve=0
for dossier in /Applications "$HOME/Applications"; do
  cible="$dossier/$NOM.app"
  if [ -d "$cible" ]; then
    trouve=1
    if osascript -e "tell application \\"Finder\\" to delete POSIX file \\"$cible\\"" >/dev/null 2>&1; then
      echo "Application placée dans la Corbeille : $cible"
    elif rm -rf "$cible" 2>/dev/null; then
      echo "Application supprimée : $cible"
    else
      echo "Attention : $cible n'a pas pu être supprimée."
      echo "           Déplacez-la vous-même vers la Corbeille."
    fi
  fi
done
if [ "$trouve" -eq 0 ]; then
  echo "Application introuvable dans /Applications ni dans ~/Applications."
fi

# 2. Les données internes laissées derrière.
for d in \\
  "$HOME/Library/Application Support/$ID" \\
  "$HOME/Library/Caches/$ID" \\
  "$HOME/Library/WebKit/$ID" \\
  "$HOME/Library/HTTPStorages/$ID" \\
  "$HOME/Library/Saved Application State/$ID.savedState" \\
  "$HOME/Library/Preferences/$ID.plist" \\
  "$HOME/Library/Logs/$ID"
do
  if [ -e "$d" ]; then
    rm -rf "$d" 2>/dev/null && echo "Données supprimées : $d"
  fi
done

echo ""
echo "Désinstallation terminée."
echo ""
read -n 1 -s -r -p "Appuyez sur une touche pour fermer..."
echo ""
exit 0
`;

    for (const [nom, texte] of [
      [`postremove-deb-${cle}.sh`, deb],
      [`postremove-rpm-${cle}.sh`, rpm],
      [`desinstaller-macos-${cle}.command`, macos],
    ]) {
      const cible = path.join(srcTauri, nom);
      await fs.writeFile(cible, texte, 'utf8');
      log(`retrait ${paquet} : ${nom} (${(await fs.stat(cible)).size} octets)`);
    }
  }
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
  await retirerServiceWorker(racine, app.pages);
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
  const nomsDeBinaires = new Map();

  for (const cle of Object.keys(APPLICATIONS)) {
    const fichier = `apps/${cle}.json`;
    let sur;
    try {
      sur = await lire(fichier);
    } catch {
      throw new Error(`surcouche introuvable : src-tauri/${fichier}`);
    }

    // ⚠️ LE NOM DU BINAIRE, SANS QUOI LES TROIS PAQUETS SE MARCHENT DESSUS.
    //
    // Sans `mainBinaryName`, Tauri nomme le binaire d'après le projet Cargo —
    // « superprint-desktop » — et les TROIS paquets installent alors le MÊME
    // fichier. Mesuré le 2026-10-13 sur les paquets publiés :
    //   usr/bin/superprint-desktop  dans super-print, studio-ia ET super-ty-po.
    // Sur Debian, le second paquet installé écrase le binaire du premier, et
    // les deux applications deviennent la même. Les icônes
    // (`/usr/share/icons/…/superprint-desktop.png`) et les entrées de bureau
    // (`Exec=`, `Icon=`, `StartupWMClass=`) se marchaient dessus de la même
    // façon. Sur Windows, l'exécutable s'appelait `superprint-desktop.exe` dans
    // les trois, sans collision de chemin mais avec un nom faux partout.
    const binaire = sur.mainBinaryName;
    if (!binaire) {
      throw new Error(
        `${fichier} : mainBinaryName manquant.\n` +
        `      Sans lui, le binaire s'appelle « superprint-desktop » dans les trois\n` +
        `      paquets, et /usr/bin/superprint-desktop devient commun aux trois :\n` +
        `      installer l'un écrase le binaire de l'autre.`
      );
    }
    if (binaire !== APPLICATIONS[cle].binaire) {
      throw new Error(
        `${fichier} : mainBinaryName vaut « ${binaire} », attendu « ${APPLICATIONS[cle].binaire} ».\n` +
        `      Le nom du binaire doit suivre celui de l'application : c'est lui qui\n` +
        `      distingue /usr/bin/<nom>, les icônes et les entrées de bureau.`
      );
    }
    if (nomsDeBinaires.has(binaire)) {
      throw new Error(`${fichier} : binaire « ${binaire} » déjà pris par ${nomsDeBinaires.get(binaire)}`);
    }
    nomsDeBinaires.set(binaire, fichier);

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

    // ⚠️ LE COPYRIGHT ET LE JOURNAL DOIVENT ÊTRE CEUX DE CE PAQUET.
    // Ils sont fabriqués un par application (voir `ecrireCopyrightsDebian`).
    // Un fichier commun annoncerait « super-print » dans les trois — un lecteur
    // y chercherait la licence du mauvais paquet.
    for (const [champ, suffixe] of [['copyright', `copyright-${cle}`], ['changelog.gz', `changelog-${cle}.gz`]]) {
      const cle2 = `/usr/share/doc/${paquet}/${champ}`;
      if (!cles.includes(cle2)) {
        throw new Error(`${fichier} : bundle.linux.deb.files ne déclare pas « ${cle2} »`);
      }
      if (sur.bundle.linux.deb.files[cle2] !== suffixe) {
        throw new Error(
          `${fichier} : ${cle2} vient de « ${sur.bundle.linux.deb.files[cle2]} »,\n` +
          `      attendu « ${suffixe} ». Un fichier commun aux trois paquets\n` +
          `      annoncerait le nom d'un autre paquet.`
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

  // Les fichiers du `.deb` qui ne peuvent pas être recopiés tels quels : les
  // journaux (à compresser) et les copyrights (à assembler). Un par paquet.
  console.log('\nFichiers communs aux paquets');
  /* ⚠️ LA VERSION DU JOURNAL EST CELLE DU PAQUET, PAS CELLE DU WEB — et ce
     n'était pas le cas avant. Cette ligne lisait `superprint/version.txt`, la
     version du SITE, pour écrire le journal du `.deb`. La faute ne se voyait
     pas tant que les deux numéros étaient égaux : elle n'était juste que par
     COÏNCIDENCE. Depuis que la version de bureau vit sa propre vie (1.7.618,
     quand le web reste 1.7.621), le paquet aurait annoncé 1.7.618 dans son nom
     et 1.7.621 dans `/usr/share/doc/<paquet>/changelog.gz`.
     La source juste est celle que ce script IMPOSE déjà partout — « la version
     doit rester dans tauri.conf.json, pas ici » (voir `verifierSurcouches`) :
     c'est la version de l'application empaquetée, donc celle du `.deb`. */
  const versionDuProduit = JSON.parse(
    await fs.readFile(path.join(srcTauri, 'tauri.conf.json'), 'utf8'),
  ).version;
  await compresserJournauxDebian(versionDuProduit);
  await ecrireCopyrightsDebian();
  await ecrireScriptsDeRetrait();
}

await main();
