#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SUPERPRINT — CONSTRUCTION D'UN E-MAIL « NOUVEAUTÉS »
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Usage :
 *   node tools/marketing/build-email.mjs --lang fr --content ./mail.json --out ./mail.html
 *
 * `mail.json` : { "subject": "…", "preheader": "…", "title": "…", "intro": "…",
 *                 "body": "<p>…</p>", "cta": { "label": "…", "url": "…" } }
 *
 * ── CE QUE CE SCRIPT REFUSE DE FAIRE ─────────────────────────────────────────
 * Il n'écrit AUCUN fichier tant que les obligations légales du pied de message ne
 * sont pas satisfaites. Ce n'est pas de la prudence excessive : un e-mail
 * commercial sans adresse postale physique est irrégulier au regard du CAN-SPAM
 * (15 U.S.C. § 7704(a)(5)(A)(iii)) et, en pratique, c'est le motif de plainte le
 * plus fréquent devant les autorités de contrôle. Un gabarit qui laisserait
 * passer ce cas produirait des messages envoyés « en attendant » — et ils
 * partent tous.
 *
 * Contrôles bloquants :
 *   1. `postal_address` non vide, et suffisamment précise (rue + code postal) ;
 *   2. `unsubscribe_url` absolue et pointant sur le domaine du site ;
 *   3. `unsubscribe_mail` plausible ;
 *   4. sujet et contenu présents ;
 *   5. aucun marqueur {{…}} non remplacé dans la sortie.
 *
 * ── CE QU'IL IMPRIME, ET QU'IL FAUT RECOPIER DANS L'OUTIL D'ENVOI ────────────
 * Les en-têtes `List-Unsubscribe` et `List-Unsubscribe-Post` (RFC 2369 / 8058).
 * Sans eux, Gmail et Outlook n'affichent pas le bouton « Se désabonner » natif,
 * et classent plus volontiers le message en promotion ou en indésirable. Ce
 * script ne peut pas les poser lui-même : ce sont des en-têtes SMTP, ils
 * appartiennent à l'outil qui envoie.
 * ───────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, 'email-marketing.template.html');

/* ── Arguments ────────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const lang = (arg('lang', 'fr') || 'fr').toLowerCase();
const contentPath = arg('content', null);
const outPath = arg('out', null);
/* `--config` existe pour pouvoir ESSAYER le gabarit sans toucher au vrai
   fichier : un test qui obligerait à écrire une fausse adresse dans la
   configuration de production finirait par laisser cette fausse adresse. */
const configPath = arg('config', resolve(HERE, 'email-config.json'));

const fail = (lines) => {
  console.error('\n\x1b[31m✗ ENVOI REFUSÉ — le message ne peut pas être produit.\x1b[0m');
  for (const l of lines) console.error('  • ' + l);
  console.error('\n  Corrigez tools/marketing/email-config.json, puis relancez.\n');
  process.exit(1);
};

/* ── Chargement ───────────────────────────────────────────────────────────── */
let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  fail([configPath + ' illisible : ' + e.message]);
}

if (!cfg.footer || !cfg.footer[lang]) {
  fail([`la langue « ${lang} » n'a pas de bloc "footer" dans email-config.json (disponibles : ${Object.keys(cfg.footer || {}).join(', ')})`]);
}

if (!contentPath) fail(['--content manquant : indiquez le fichier JSON du message.']);
let mail;
try {
  mail = JSON.parse(readFileSync(resolve(process.cwd(), contentPath), 'utf8'));
} catch (e) {
  fail(['fichier de contenu illisible : ' + e.message]);
}

/* ── Contrôles bloquants ──────────────────────────────────────────────────── */
const problems = [];

const postal = String(cfg.postal_address || '').trim();
if (!postal) {
  problems.push(
    'postal_address est VIDE. Une adresse postale physique est obligatoire dans chaque ' +
    'e-mail commercial (CAN-SPAM 15 U.S.C. § 7704(a)(5)(A)(iii)). Une adresse e-mail, une ' +
    'boîte postale seule ou un « contact via le site » ne la remplacent pas.'
  );
} else {
  /* Une adresse sans numéro ni code postal n'est pas une adresse : c'est une ville.
     On exige donc au moins un chiffre (numéro ou code postal) et une longueur
     minimale — le contrôle est grossier, il attrape la faute de frappe évidente. */
  if (!/\d/.test(postal) || postal.length < 15) {
    problems.push(`postal_address (« ${postal} ») ne ressemble pas à une adresse complète : numéro de voie et code postal attendus.`);
  }
}

const unsubUrl = String(cfg.unsubscribe_url || '').trim();
if (!/^https?:\/\/[^\s]+$/i.test(unsubUrl)) {
  problems.push('unsubscribe_url doit être une URL absolue (https://…).');
} else {
  try {
    const host = new URL(unsubUrl).hostname;
    const site = new URL(cfg.site_url).hostname;
    if (host.replace(/^www\./, '') !== site.replace(/^www\./, '')) {
      problems.push(`unsubscribe_url pointe sur « ${host} » alors que le site est « ${site} » : un désabonnement qui change de domaine n'inspire pas confiance, et les filtres antispam le pénalisent.`);
    }
  } catch (_) {
    problems.push('unsubscribe_url n\'est pas une URL valide.');
  }
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(cfg.unsubscribe_mail || ''))) {
  problems.push('unsubscribe_mail n\'est pas une adresse électronique plausible.');
}

for (const k of ['subject', 'title', 'intro', 'body']) {
  if (!mail[k] || !String(mail[k]).trim()) problems.push(`le contenu n'a pas de champ « ${k} ».`);
}
if (!mail.cta || !mail.cta.label || !mail.cta.url) problems.push('le contenu n\'a pas de bouton (cta.label + cta.url).');
else if (!/^https?:\/\//i.test(mail.cta.url)) problems.push('cta.url doit être une URL absolue.');

if (problems.length) fail(problems);

/* ── Remplissage ──────────────────────────────────────────────────────────── */
const f = cfg.footer[lang];
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SITE_LABEL = { fr: 'Logiciel de PAO en ligne', en: 'Online DTP software', ja: 'オンラインDTPソフト' };

const values = {
  LANG: lang,
  TITLE: esc(mail.title),
  PREHEADER: esc(mail.preheader || mail.intro || ''),
  INTRO: esc(mail.intro),
  BODY: String(mail.body),                    // HTML assumé : c'est le corps rédigé
  CTA_LABEL: esc(mail.cta.label),
  CTA_URL: esc(mail.cta.url),
  WHY: esc(f.why),
  UNSUB_LABEL: esc(f.unsub),
  UNSUB_HINT: esc(f.unsub_hint),
  UNSUB_URL: esc(unsubUrl),
  UNSUB_MAIL: esc(cfg.unsubscribe_mail),
  ADDRESS_LABEL: esc(f.address_label),
  POSTAL: esc(postal),
  EDITOR: esc(cfg.editor),
  LEGAL_FORM: esc((cfg.editor_legal_form || {})[lang] || (cfg.editor_legal_form || {}).fr || ''),
  YEAR: String(new Date().getFullYear()),
  SITE_URL: esc(cfg.site_url),
  SITE_LABEL: esc(SITE_LABEL[lang] || SITE_LABEL.fr)
};

let html = readFileSync(TEMPLATE, 'utf8');
for (const [k, v] of Object.entries(values)) {
  html = html.split('{{' + k + '}}').join(v);
}

/* Un marqueur oublié signifie qu'une information manque : on ne l'envoie pas. */
const leftovers = [...new Set((html.match(/\{\{[A-Z_]+\}\}/g) || []))];
if (leftovers.length) {
  fail(['marqueurs non remplacés dans le gabarit : ' + leftovers.join(', ')]);
}

/* ── Sortie ───────────────────────────────────────────────────────────────── */
if (outPath) {
  const out = resolve(process.cwd(), outPath);
  writeFileSync(out, html, 'utf8');
  console.log(`\n\x1b[32m✓\x1b[0m ${out}`);
} else {
  process.stdout.write(html);
}

const listUnsub = `<${unsubUrl}>, <mailto:${cfg.unsubscribe_mail}?subject=Unsubscribe>`;

console.log(`
\x1b[1mObjet\x1b[0m   ${mail.subject}

\x1b[1mEn-têtes à recopier dans l'outil d'envoi\x1b[0m (ce script ne peut pas les poser : ce sont des en-têtes SMTP)
  List-Unsubscribe: ${listUnsub}
  List-Unsubscribe-Post: List-Unsubscribe=One-Click
  List-Id: ${cfg.list_id}

\x1b[1mVérifications faites\x1b[0m
  ✓ adresse postale présente      ${postal}
  ✓ lien de désabonnement         ${unsubUrl}
  ✓ adresse de désabonnement      ${cfg.unsubscribe_mail}
  ✓ aucun marqueur non remplacé

\x1b[33m⚠\x1b[0m Le désabonnement doit être honoré sous 10 jours ouvrables (CAN-SPAM) et
  10 jours (art. L.34-5 CPCE impose la gratuité et la simplicité ; les autorités
  françaises retiennent le même délai). Un message parti ne se rattrape pas.
`);
