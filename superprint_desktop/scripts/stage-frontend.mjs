#!/usr/bin/env node
/**
 * Assemble le dossier embarqué par la fenêtre Tauri.
 *
 * POURQUOI CE SCRIPT EXISTE. Les trois applications vivent dans `superprint/`,
 * mais à des endroits différents : l'éditeur dans `app/`, le Studio IA dans un
 * fichier HTML à la racine, SuperTyPo dans son propre dossier. Tauri, lui,
 * n'embarque qu'UN dossier. Ce script le fabrique, et rien de plus : aucune
 * source n'est modifiée, tout est recopié.
 *
 * Il est écrit en Node — et non en PowerShell — parce que le workflow GitHub
 * l'appelle aussi depuis macOS et Linux.
 *
 * DÉDUPLICATION DES POLICES. `superprint/CSS/fonts/` pèse 19,8 Mo, dont
 * **19,6 Mo sont octet pour octet déjà présents dans `app/CSS/fonts/`** (mesuré
 * le 2026-10-13 : 176 fichiers sur 185). Recopier les deux reviendrait à faire
 * payer deux fois la même police à chaque téléchargement. La feuille copiée est
 * donc réécrite pour pointer sur la copie déjà présente dans `app/`, et seuls
 * les 9 fichiers qui n'y sont pas sont réellement copiés.
 *
 * VÉRIFICATION DES RÉFÉRENCES. À la fin, chaque `src=`/`href=` local des pages
 * embarquées est résolu sur le disque. Un fichier manquant fait ÉCHOUER le
 * build : une image absente dans une application installée est une chose qu'on
 * ne découvre qu'après la livraison.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const product = path.resolve(desktop, '..', 'superprint');
const frontend = path.join(desktop, 'frontend');

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
 * Copie `CSS/fonts.css` en réécrivant chaque police vers la copie identique de
 * `app/CSS/fonts/`. Ce qui n'a pas d'équivalent est copié pour de bon.
 *
 * ⚠️ 27 des 117 polices référencées par cette feuille **n'existent pas** dans
 * `superprint/CSS/fonts/` (mesuré le 2026-10-13 : `bricolage-4..12`,
 * `newsreader-4..12`, `spacegrotesk-4..12` — seuls les rangs 1 à 3 sont
 * présents). Le site les demande donc déjà dans le vide ; ce script ne fait que
 * reproduire ce comportement et le SIGNALE, pour ne pas transformer un défaut
 * existant du site en échec de compilation de l'application de bureau.
 */
async function copierFeuilleDePolices() {
  const source = path.join(product, 'CSS', 'fonts.css');
  const cible = path.join(frontend, 'CSS', 'fonts.css');
  const chezApp = path.join(frontend, 'app', 'CSS', 'fonts');

  let css = await fs.readFile(source, 'utf8');
  let reutilisees = 0;
  const aCopier = new Set();
  const introuvables = [];

  for (const m of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    const brut = m[2];
    if (/^(https?:|data:|#)/.test(brut)) continue;

    const nom = path.posix.basename(brut.replace(/[?#].*$/, ''));
    const original = path.join(product, 'CSS', 'fonts', nom);
    const hApp = await empreinte(path.join(chezApp, nom));

    if (hApp !== null && hApp === (await empreinte(original))) {
      css = css.replaceAll(`url(${m[1]}${brut}${m[1]})`, `url(../app/CSS/fonts/${nom})`);
      reutilisees += 1;
    } else if (await empreinte(original) === null) {
      introuvables.push(nom);
    } else {
      aCopier.add(nom);
    }
  }

  for (const nom of aCopier) {
    const dst = path.join(frontend, 'CSS', 'fonts', nom);
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
 * Résout chaque référence locale des pages embarquées. Renvoie la liste de ce
 * qui manque — vide, sinon.
 *
 * Deux retraits avant lecture, et ils comptent tous les deux :
 *   · les COMMENTAIRES HTML — `app/index.html` porte
 *     `<!-- script src="JS/app-logic.js" … -->`, une référence éteinte. La
 *     compter ferait échouer le build pour un fichier que personne ne charge ;
 *   · le CORPS des `<script>` — le Studio IA y contient une expression
 *     rationnelle qui ressemble à `src="data:…"`. Le contenu dynamique n'est pas
 *     vérifiable statiquement : seules les balises le sont.
 */
async function verifierReferences(pages) {
  const manquants = [];

  for (const page of pages) {
    const fichier = path.join(frontend, page);
    const html = (await fs.readFile(fichier, 'utf8'))
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2');

    for (const m of html.matchAll(/(?:src|href)=(["'])([^"']+)\1/g)) {
      const ref = m[2];
      if (/^(https?:|\/\/|#|mailto:|data:|javascript:|\/)/i.test(ref)) continue;

      const cible = path.resolve(path.dirname(fichier), ref.replace(/[?#].*$/, ''));
      if (cible !== frontend && !cible.startsWith(frontend + path.sep)) {
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

async function main() {
  console.log('Assemblage du dossier embarqué (frontend/)');

  for (const requis of ['app', 'supertypo', 'icons', 'JS', 'CSS', 'sp213-studio.html', 'version.txt']) {
    try {
      await fs.access(path.join(product, requis));
    } catch {
      throw new Error(`source introuvable : superprint/${requis}`);
    }
  }
  await fs.rm(frontend, { recursive: true, force: true });
  await fs.mkdir(frontend, { recursive: true });

  // 1. Les trois applications.
  await copier(path.join(product, 'app'), path.join(frontend, 'app'));
  await copier(path.join(product, 'supertypo'), path.join(frontend, 'supertypo'));
  await fs.copyFile(path.join(product, 'sp213-studio.html'), path.join(frontend, 'studio.html'));
  log('trois applications copiées (éditeur, Studio IA, SuperTyPo)');

  // 2. Ce que les pages partagent : icônes, favicon, manifeste, le moteur de canevas du Studio.
  await copier(path.join(product, 'icons'), path.join(frontend, 'icons'));
  await fs.copyFile(path.join(product, 'favicon.png'), path.join(frontend, 'favicon.png'));
  await fs.copyFile(path.join(product, 'manifest.webmanifest'), path.join(frontend, 'manifest.webmanifest'));
  await fs.mkdir(path.join(frontend, 'JS'), { recursive: true });
  await fs.copyFile(path.join(product, 'JS', 'fabric.min.js'), path.join(frontend, 'JS', 'fabric.min.js'));
  log('socle partagé copié (icons/, favicon, manifeste, JS/fabric.min.js)');

  // 3. Les polices, dédupliquées contre celles de app/.
  await copierFeuilleDePolices();

  // 4. La page de lancement, avec sa version injectée.
  const version = (await fs.readFile(path.join(product, 'version.txt'), 'utf8')).trim();
  const lanceur = await fs.readFile(path.join(desktop, 'src', 'launcher.html'), 'utf8');
  await fs.writeFile(path.join(frontend, 'index.html'), lanceur.replaceAll('{{VERSION}}', version), 'utf8');
  log(`page de lancement écrite (version ${version})`);

  // 5. Contrôle : rien d'absent, aucun jeton oublié.
  const pages = ['index.html', 'studio.html', 'supertypo/index.html', 'app/index.html'];
  const manquants = await verifierReferences(pages);
  if (manquants.length) {
    console.error('\nRéférences introuvables dans le dossier embarqué :');
    for (const m of manquants) console.error(`  ✗ ${m}`);
    throw new Error(`${manquants.length} référence(s) introuvable(s)`);
  }
  log(`références vérifiées sur ${pages.length} pages`);

  let octets = 0;
  let fichiers = 0;
  const mesurer = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await mesurer(p);
      else if (e.isFile()) { fichiers += 1; octets += (await fs.stat(p)).size; }
    }
  };
  await mesurer(frontend);
  console.log(`\nfrontend/ : ${fichiers} fichiers, ${(octets / 1048576).toFixed(1)} Mo`);
}

main().catch((err) => {
  console.error(`\nÉchec : ${err.message}`);
  process.exit(1);
});
