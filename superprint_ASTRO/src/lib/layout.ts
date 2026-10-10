/**
 * Variantes des blocs de la coquille marketing.
 *
 * Le bandeau de marque et le pied de page ont été recopiés d'une page à
 * l'autre avec, à chaque fois, de petites divergences (version publiée,
 * intitulé de colonne, liens légaux, ressources de presse). Ces types
 * rassemblent ces divergences : les composants n'ont plus qu'un seul
 * emplacement à corriger.
 */
import type { Lang } from '../data/site';

/** Bandeau de marque : ROCK v1 a sa promesse et sa version publiée. */
export interface Brand {
  /** Libellé du lien logo, lu par les lecteurs d'écran. */
  ariaLabel?: string;
  /** Version publiée affichée à gauche. */
  version?: string;
  /** Promesse de la marque, en clair (Astro échappe les `&`). */
  tag?: Record<Lang, string>;
}

/** Liens légaux du pied de page. */
export type FooterLegal = 'overlays' | 'anchors';

/** Pied de page. */
export interface Footer {
  /** Cible des liens « Questions fréquentes ». */
  faqHref?: string;
  /** Cible des liens « Fonctions / Features / 機能 ». */
  featuresHref?: string;
  /** Cible des liens « Auteurs ». `null` = liens absents (ROCK v1). */
  authorsHref?: string | null;
  /** Titre de la première colonne. */
  heading?: Record<Lang, string>;
  /** Version du copyright (`SuperPrint v…`). */
  version?: string;
  /** Ajoute la valise logo (ZIP) et le dossier de presse (PDF). */
  pressKit?: boolean;
  /** `anchors` = ancres de l'accueil ; `overlays` = pop-ins de la page. */
  legal?: FooterLegal;
}
