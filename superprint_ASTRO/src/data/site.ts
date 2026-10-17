/**
 * Constantes du site SuperPrint.
 *
 * Source unique de vérité pour l'URL publique, la version publiée et la carte
 * de navigation : la version était auparavant recopiée à la main dans le
 * bandeau de marque, le pied de page et les données structurées.
 */

export const SITE = 'https://superprint.cc';

/** Version publiée — doit rester synchrone avec `app/index.html` et le CLAUDE.md. */
export const VERSION = '1.7.659';

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

/** La page des publications, où vivent les vingt et un fichiers. */
export const RELEASE_URL = 'https://github.com/zigmoon/SUPERPRINT/releases/tag/desktop-latest';

export interface ApplicationBureau {
  /** Nom affiché — nom propre, donc identique dans les trois langues. */
  nom: string;
  /** Le sous-titre : ce que fait l'application, en trois mots. */
  role: Record<Lang, string>;
  /** Une phrase de description, la même que celle des trois entrées de l'accueil. */
  resume: Record<Lang, string>;
  /**
   * Le logotype. Ce sont ceux du haut de page : la zone du bas ne présente pas
   * les applications autrement qu'en haut, elle les reprend.
   */
  logo: string;
  /**
   * La plaque du logotype. `true` = plaque blanche (logotype bicolore, on voit
   * sa part sombre) ; `false` = plaque d'encre, exigée par l'icône blanche de
   * l'éditeur, seule de son espèce.
   */
  plaqueClaire: boolean;
  /** Le filet de gauche, repris de l'accent des trois entrées. */
  accent: string;
  /** L'application en ligne, pour le second bouton. */
  enLigne: string;
}

/**
 * Les trois applications, telles que la zone de fin de page les présente.
 *
 * Les versions ne sont pas ici : elles sont toutes les trois dans `VERSION`. Le
 * jour où elles divergeront, c'est ce champ qu'il faudra ouvrir — tant qu'elles
 * sont construites ensemble, un seul numéro suffit et ne peut pas se désunir.
 */
export const APPLICATIONS_BUREAU: ApplicationBureau[] = [
  {
    nom: 'SuperPrint',
    role: { fr: 'Le bureau de PAO', en: 'The DTP desk', ja: 'DTPデスク' },
    resume: {
      fr: 'Le bureau de PAO complet : mise en page, prépresse, export PDF. Tout le poste, hors ligne.',
      en: 'The complete DTP desk: layout, prepress, PDF export. The whole workstation, offline.',
      ja: 'DTPデスクのすべて — 組版、プリプレス、PDF書き出し。オフラインで完結。',
    },
    logo: 'icons/icon-192x192.png',
    plaqueClaire: false,
    accent: '#00A7C7',
    enLigne: 'app/index.html',
  },
  {
    nom: 'Studio IA',
    role: { fr: 'La composition assistée', en: 'Assisted composition', ja: 'アシスト組版' },
    resume: {
      fr: 'Décrivez la maquette : l’IA la compose, vous la corrigez, vous l’exportez.',
      en: 'Describe the layout: the AI composes it, you refine it, you export it.',
      ja: 'レイアウトを言葉に。AIが組み、あなたが直し、書き出す。',
    },
    logo: 'icons/studio_print_logo_blanc.png',
    plaqueClaire: true,
    accent: '#E1237B',
    enLigne: 'sp213-studio.html',
  },
  {
    nom: 'SuperTyPo',
    role: { fr: 'Le moteur typographique', en: 'The type engine', ja: 'タイポグラフィ・エンジン' },
    resume: {
      fr: 'Importez une police, redessinez chaque caractère en courbes, réexportez-la.',
      en: 'Import a typeface, redraw each character as curves, export it again.',
      ja: '書体を読み込み、1文字ずつ曲線で描き直し、書き出す。',
    },
    logo: 'icons/sper_typo.png',
    plaqueClaire: true,
    accent: '#F2B90B',
    enLigne: 'supertypo/index.html',
  },
];

/**
 * Les libellés de la zone « Nos logiciels · Nos versions ».
 *
 * `titre` est découpé en trois parce qu'un mot y passe en italique : une chaîne
 * plate obligerait à injecter du HTML, ce qui rendrait la traduction dépendante
 * du balisage.
 */
export const VERSIONS_LABELS = {
  kicker: {
    fr: 'Applications de bureau · PC, macOS et Linux',
    en: 'Desktop applications · PC, macOS and Linux',
    ja: 'デスクトップ版 · PC・macOS・Linux',
  },
  /* Le titre est celui que la zone annonce, et rien d'autre : « Téléchargement ».
     Une phrase d'accroche n'a pas besoin d'être le titre — elle est juste en
     dessous, et c'est elle qui vend. */
  titre: {
    fr: 'Téléchargement',
    en: 'Download',
    ja: 'ダウンロード',
  },
  chapeau: {
    fr: 'Trois applications natives, un seul numéro de version. Elles s’installent séparément — vous ne téléchargez que ce que vous utilisez — et elles avancent ensemble : la même version les décrit toutes les trois. Gratuit, sans compte, et hors ligne une fois installé.',
    en: 'Three native applications, one single version number. They install separately — you only download what you use — and they move together: the same version describes all three. Free, no account, and offline once installed.',
    ja: '3つのネイティブアプリ、バージョン番号はひとつ。別々にインストールでき — 使うものだけを取得 — 歩みは同じ。同じバージョンが3つすべてを示します。無料、アカウント不要、インストール後はオフラインで動作します。',
  },
  version: { fr: 'Version', en: 'Version', ja: 'バージョン' },
  note: {
    fr: {
      avant: 'Les versions PC, macOS et Linux sont en ',
      gras: 'beta',
      apres: ' : complètes et utilisables, mais encore jeunes. Elles se téléchargent librement, sans compte, depuis le bouton « Télécharger » de la barre — trois applications, trois systèmes, vingt et un fichiers.',
    },
    en: {
      avant: 'The PC, macOS and Linux versions are in ',
      gras: 'beta',
      apres: ': complete and usable, but still young. They download freely, without an account, from the “Download” button in the bar — three applications, three systems, twenty-one files.',
    },
    ja: {
      avant: 'PC・macOS・Linux 版は',
      gras: 'ベータ',
      apres: 'です。完成していて使えますが、まだ若い版です。アカウント不要で、バーの「ダウンロード」から自由に取得できます — 3つのアプリ、3つのシステム、21のファイル。',
    },
  },
  voirVersions: {
    fr: 'Voir toutes les versions',
    en: 'See every version',
    ja: 'すべてのバージョンを見る',
  },
} satisfies Record<string, Record<Lang, unknown>>;

/** Les trois systèmes : le nom lu, et la marque qui le rend lisible sans lire. */
export const SYSTEMES = [
  { nom: 'PC', marque: 'icons/windows.svg' },
  { nom: 'macOS', marque: 'icons/macos.svg' },
  { nom: 'Linux', marque: 'icons/linux.svg' },
] as const;
