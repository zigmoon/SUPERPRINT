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

/** Une ligne du menu « Télécharger » de la barre. */
export interface DownloadItem {
  /** Le système, qui choisit aussi le pictogramme (voir `SiteNav.astro`). */
  os: 'win' | 'mac' | 'linux';
  href: string;
  /** Nom du système — identique dans les trois langues : c'est un nom propre. */
  nom: string;
  /** Format du fichier, en clair — identique dans les trois langues. */
  format: string;
}

/**
 * Les installeurs de l'application de bureau.
 *
 * UN INSTALLATEUR PAR SYSTÈME, PAS PAR APPLICATION. Les trois applications —
 * SuperPrint, Studio IA, SuperTyPo — sont dans le même paquet, et se choisissent
 * à l'ouverture. D'où trois lignes, et non neuf.
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
    format: 'Installateur .exe · 64 bits',
  },
  {
    os: 'mac',
    href: 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-macOS-AppleSilicon.dmg',
    nom: 'MAC — macOS',
    format: 'Image-disque .dmg · puce Apple',
  },
  {
    os: 'linux',
    href: 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Linux-x86_64.AppImage',
    nom: 'LINUX',
    format: 'Exécutable .AppImage · x86-64',
  },
];

/** Les libellés du menu « Télécharger », un par langue. */
export const DOWNLOAD_LABELS = {
  bouton: { fr: 'Télécharger', en: 'Download', ja: 'ダウンロード' },
  titre: { fr: 'Application de bureau', en: 'Desktop application', ja: 'デスクトップアプリ' },
  sous: { fr: 'Les trois applications incluses', en: 'All three apps included', ja: '3つのアプリを同梱' },
  formats: { fr: 'Tous les formats', en: 'All formats', ja: 'すべての形式' },
  enLigne: { fr: 'Ouvrir en ligne', en: 'Open online', ja: 'オンラインで開く' },
} satisfies Record<string, Record<Lang, string>>;
