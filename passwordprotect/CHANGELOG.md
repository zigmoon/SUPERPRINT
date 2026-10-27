# Journal des modifications

## 1.0.0 — 27 octobre 2026

### Ajouté

- Protection de tout le site par un mot de passe unique, activable depuis **Réglages → VaultGate**.
- Page de garde autonome, responsive et accessible : titre, message, logo, couleur d’accent, thème clair/sombre/automatique, lien d’assistance, note de pied de page.
- Verrouillage des pages, articles, archives, flux RSS/Atom, sitemaps, API REST, AJAX anonyme, XML-RPC et endpoints directs (commentaires, trackbacks, mail, inscription, activation).
- Cookie d’accès signé HMAC-SHA256, `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS, avec révocation globale par version de session.
- Hachage du mot de passe via `wp_hash_password()` ; aucun mot de passe en clair, aucun mot de passe journalisé.
- Limitation par IP et blocage temporaire après plusieurs échecs.
- Liste d’IP autorisées IPv4/IPv6/CIDR et chemins exclus avec joker `*`.
- Contournement pour les utilisateurs connectés selon une capacité configurable (administrateurs par défaut).
- En-têtes de sécurité sur la page de garde : `no-store`, `noindex`, `DENY`, `nosniff`, `Referrer-Policy` et CSP à nonce.
- Journal d’activité limité à 20 entrées, avec adresses IP anonymisées.
- Commandes WP-CLI : `status`, `enable`, `disable`, `password`, `logout-all`, `log`.
- Constante d’urgence `VAULTGATE_DISABLED` et filtres d’intégration.
- Traduction française complète, catalogue `.pot`, fichier `.mo` compilé.
- Nettoyage optionnel à la désinstallation, compatible multisite.
- 130 assertions automatisées (tests unitaires + test de démarrage et de rendu).

### Compatibilité

- WordPress 6.5 à 7.1.
- PHP 8.2 à 8.5.
- Aucune dépendance Composer/npm, aucune ressource externe, aucun appel réseau.
