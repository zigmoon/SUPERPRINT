/**
 * Constantes du site SuperPrint.
 *
 * Source unique de vérité pour l'URL publique, la version publiée et la carte
 * de navigation : la version était auparavant recopiée à la main dans le
 * bandeau de marque, le pied de page et les données structurées.
 */

export const SITE = 'https://superprint.cc';

/** Version publiée — doit rester synchrone avec `app/index.html` et le CLAUDE.md. */
export const VERSION = '1.7.609';

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
  cta?: boolean;
}

/** Les six entrées de la barre de navigation, dans l'ordre affiché. */
export const NAV_ITEMS: NavItem[] = [
  { href: 'index.html#features', label: { fr: 'Fonctions', en: 'Features', ja: '機能' } },
  { href: 'documentation.html', label: { fr: 'Manuel', en: 'Manual', ja: 'マニュアル' } },
  { href: 'faq.html', label: { fr: 'FAQ', en: 'FAQ', ja: 'FAQ' } },
  { href: 'price.html', label: { fr: 'Tarif', en: 'Price', ja: '料金' } },
  { href: 'rock.html', label: { fr: 'ROCK v1', en: 'ROCK v1', ja: 'ROCK v1' } },
  {
    href: 'app/index.html',
    cta: true,
    label: { fr: "Ouvrir l'app", en: 'Open app', ja: 'アプリを開く' },
  },
];
