/**
 * Constantes du site SuperPrint.
 *
 * Source unique de vérité pour l'URL publique, la version publiée et la carte
 * de navigation : la version était auparavant recopiée à la main dans le
 * bandeau de marque, le pied de page et les données structurées.
 */

export const SITE = 'https://superprint.cc';

/** Version publiée — doit rester synchrone avec `app/index.html` et le CLAUDE.md. */
export const VERSION = '1.7.611';

export const LANGUAGES = ['en', 'fr', 'ja'] as const;
export type Lang = (typeof LANGUAGES)[number];
/** Langue par défaut du `<html lang>` (l'anglais porte la page). */
export const DEFAULT_LANG: Lang = 'en';

/**
 * Ordre des `<span class="inline-xx">` dans le balisage.
 *
 * Le CSS n'affiche qu'une langue à la fois, mais l'ordre du DOM est celui du
 * site d'origine — et il est visible pour qui lit le HTML ou copie du texte.
 */
export const MARKUP_LANG_ORDER: Lang[] = ['fr', 'en', 'ja'];

export interface NavItem {
  href: string;
  /** Un libellé par langue : le CSS affiche le bon `<span class="inline-xx">`. */
  label: Record<Lang, string>;
}

/**
 * Les cinq entrées de la barre de navigation, dans l'ordre affiché.
 *
 * L'ancienne sixième entrée — « Ouvrir l'app » — n'est plus ici : elle a laissé
 * la place au menu « Télécharger » (voir `SiteNav.astro`), qui porte désormais
 * l'entrée dans l'application, un cran plus bas.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: 'index.html#features', label: { fr: 'Fonctions', en: 'Features', ja: '機能' } },
  { href: 'documentation.html', label: { fr: 'Manuel', en: 'Manual', ja: 'マニュアル' } },
  { href: 'faq.html', label: { fr: 'FAQ', en: 'FAQ', ja: 'FAQ' } },
  { href: 'price.html', label: { fr: 'Tarif', en: 'Price', ja: '料金' } },
  { href: 'rock.html', label: { fr: 'ROCK v1', en: 'ROCK v1', ja: 'ROCK v1' } },
];

/**
 * Un morceau de texte du format : tantôt droit, tantôt en gras.
 *
 * Le gras n'est pas décoratif : il désigne l'**extension** (`.exe`, `.dmg`,
 * `.AppImage`) au milieu d'une ligne monospace, et c'est le seul repère qu'on
 * cherche du regard dans un menu de téléchargement. Le modéliser en données
 * évite de reconstruire une chaîne à balises dans le composant.
 */
export type Morceau = { t: string } | { b: string };

/** Une variante du même système — la version Intel, le paquet .deb. */
export interface DownloadVariante {
  /** Ce qui précède le lien, ponctuation comprise. */
  prefixe: Record<Lang, string>;
  href: string;
  label: Record<Lang, string>;
}

/** Une ligne du menu « Télécharger » de la barre. */
export interface DownloadItem {
  /** Le système, qui choisit aussi le pictogramme (voir `SiteNav.astro`). */
  os: 'win' | 'mac' | 'linux';
  href: string;
  /** Nom du système — identique dans les trois langues : c'est un nom propre. */
  nom: string;
  /** Format du fichier principal, en morceaux (voir `Morceau`). */
  format: Morceau[];
  /** Seconde façon d'installer sur ce système, s'il y en a une. */
  variante?: DownloadVariante;
}

/**
 * Les cinq installeurs de l'application de bureau.
 *
 * TROIS LIGNES, CINQ FICHIERS. Un système par ligne — et une seconde façon
 * d'installer sur deux d'entre elles (la version Intel pour macOS, le paquet
 * `.deb` pour Linux). C'est ce qui évite de promettre neuf téléchargements là où
 * il y a trois systèmes.
 *
 * Les trois applications — SuperPrint, Studio IA, SuperTyPo — sont dans le même
 * paquet, et se choisissent à l'ouverture. C'est écrit une fois, en tête du menu.
 *
 * Les adresses portent `desktop-latest` et **aucun numéro de version** : le
 * workflow `.github/workflows/build-desktop.yml` renomme les paquets avant de
 * les publier, précisément pour que ces liens n'aient jamais à être retouchés.
 */
export const DESKTOP_DOWNLOADS: DownloadItem[] = [
  {
    os: 'win',
    href: 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Windows-x64-setup.exe',
    nom: 'PC — Windows',
    format: [{ t: 'Installateur ' }, { b: '.exe' }, { t: ' · 64 bits' }],
  },
  {
    os: 'mac',
    href: 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-macOS-AppleSilicon.dmg',
    nom: 'MAC — macOS',
    format: [{ t: 'Image-disque ' }, { b: '.dmg' }],
    variante: {
      prefixe: { fr: 'Puce Apple · ', en: 'Apple silicon · ', ja: 'Appleシリコン · ' },
      href: 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-macOS-Intel.dmg',
      label: { fr: 'version Intel', en: 'Intel build', ja: 'Intel版' },
    },
  },
  {
    os: 'linux',
    href: 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Linux-x86_64.AppImage',
    nom: 'LINUX',
    format: [{ t: 'Exécutable ' }, { b: '.AppImage' }, { t: ' · x86-64' }],
    variante: {
      prefixe: { fr: 'Alternative : ', en: 'Alternative: ', ja: '別形式：' },
      href: 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Linux-x86_64.deb',
      label: { fr: 'paquet .deb', en: '.deb package', ja: '.deb パッケージ' },
    },
  },
];

/** Les libellés du menu « Télécharger », un par langue. */
export const DOWNLOAD_LABELS = {
  bouton: { fr: 'Télécharger', en: 'Download', ja: 'ダウンロード' },
  titre: { fr: 'Application de bureau', en: 'Desktop application', ja: 'デスクトップアプリ' },
  sous: { fr: 'Les trois applications incluses', en: 'All three apps included', ja: '3つのアプリを同梱' },
  enLigne: { fr: 'Ouvrir en ligne', en: 'Open online', ja: 'オンラインで開く' },
} satisfies Record<string, Record<Lang, string>>;
