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
 * Un fichier téléchargeable, pour une application et un système donnés.
 *
 * `label` est ce que lit le visiteur : « .exe », « Apple silicon », « .deb ».
 * Aucune traduction n'est nécessaire — ce sont des noms de formats, pas des
 * phrases. Les traduire obligerait à maintenir trois listes pour ne rien dire
 * de plus, et c'est justement le genre de table qui finit par diverger.
 */
export interface DownloadPaquet {
  /** Nom du fichier publié, sans le préfixe de l'application. */
  fichier: string;
  label: string;
}

/** Une des trois applications de bureau. */
export interface DownloadApplication {
  /** Préfixe des noms de fichiers publiés : « SuperPrint », « Studio-IA »… */
  cle: string;
  /** Ce que lit le visiteur — nom propre, donc identique dans les 3 langues. */
  nom: string;
}

/** Un système, et les paquets disponibles pour chacune des trois applications. */
export interface DownloadSysteme {
  os: 'win' | 'mac' | 'linux';
  /** Nom propre, donc identique dans les trois langues. */
  nom: string;
  /**
   * Les fichiers publiés sur ce système.
   * ⚠️ LE PREMIER EST LE TÉLÉCHARGEMENT PAR DÉFAUT : les styles le mettent en
   * avant, et lui seul. C'est ce qui évite de faire lire trois extensions à
   * quelqu'un qui veut simplement installer l'application.
   */
  paquets: DownloadPaquet[];
}

const GITHUB = 'https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest';

/** L'adresse publiée d'un fichier, reconstruite depuis l'application et le système. */
export function urlTelechargement(app: DownloadApplication, paquet: DownloadPaquet): string {
  return `${GITHUB}/${app.cle}-${paquet.fichier}`;
}

/**
 * Les trois applications de bureau.
 *
 * Trois paquets séparés, et non un paquet qui contient tout : mesuré le
 * 2026-10-13, l'éditeur pèse 57,9 Mo, le Studio IA 9,8 Mo et SuperTyPo 1,0 Mo.
 * Un paquet unique en aurait livré 68,7 Mo d'un bloc — et 183,6 Mo si les trois
 * avaient chacun tout embarqué. Les trois applications ne se renvoient pas
 * l'une à l'autre (vérifié) : chacune est complète et indépendante.
 */
export const DESKTOP_APPLICATIONS: DownloadApplication[] = [
  { cle: 'SuperPrint', nom: 'SuperPrint' },
  { cle: 'Studio-IA', nom: 'Studio IA' },
  { cle: 'SuperTyPo', nom: 'SuperTyPo' },
];

/**
 * Les trois systèmes, et pour chacun les fichiers réellement publiés.
 *
 * RIEN DE CE QUE TAURI CONSTRUIT N'EST LAISSÉ DE CÔTÉ. `bundle.targets` vaut
 * « all », donc Windows livre un `.msi` **et** un `.exe`, Linux un `.deb`, un
 * `.rpm` **et** un `.AppImage`, macOS un `.dmg` par architecture. Le `.msi` sert
 * le déploiement en parc (GPO, SCCM) ; le `.rpm` les systèmes Fedora, RHEL et
 * openSUSE, auxquels l'AppImage n'offre aucune intégration avec le gestionnaire
 * de paquets.
 *
 * Les adresses portent `desktop-latest` et **aucun numéro de version** : le
 * workflow `.github/workflows/build-desktop.yml` renomme les paquets avant de
 * les publier, précisément pour que ces liens n'aient jamais à être retouchés.
 */
export const DESKTOP_DOWNLOADS: DownloadSysteme[] = [
  {
    os: 'win',
    nom: 'PC — Windows',
    paquets: [
      { fichier: 'Windows-x64-setup.exe', label: '.exe' },
      { fichier: 'Windows-x64.msi', label: '.msi' },
    ],
  },
  {
    os: 'mac',
    nom: 'MAC — macOS',
    paquets: [
      { fichier: 'macOS-AppleSilicon.dmg', label: 'Apple silicon' },
      { fichier: 'macOS-Intel.dmg', label: 'Intel' },
    ],
  },
  {
    os: 'linux',
    nom: 'LINUX',
    paquets: [
      { fichier: 'Linux-x86_64.AppImage', label: '.AppImage' },
      { fichier: 'Linux-x86_64.deb', label: '.deb' },
      { fichier: 'Linux-x86_64.rpm', label: '.rpm' },
    ],
  },
];

/** Les libellés du menu « Télécharger », un par langue. */
export const DOWNLOAD_LABELS = {
  bouton: { fr: 'Télécharger', en: 'Download', ja: 'ダウンロード' },
  titre: { fr: 'Applications de bureau', en: 'Desktop applications', ja: 'デスクトップアプリ' },
  sous: {
    fr: 'Trois applications · un installeur chacune',
    en: 'Three apps · one installer each',
    ja: '3つのアプリ · それぞれ専用インストーラー',
  },
  enLigne: { fr: 'Ouvrir en ligne', en: 'Open online', ja: 'オンラインで開く' },
} satisfies Record<string, Record<Lang, string>>;
