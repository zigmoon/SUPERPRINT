# VaultGate — protection par mot de passe pour tout un site WordPress

[![WordPress](https://img.shields.io/badge/WordPress-6.5%20→%207.1-21759b?logo=wordpress&logoColor=white)](https://wordpress.org/)
[![PHP](https://img.shields.io/badge/PHP-8.2%20→%208.5-777bb4?logo=php&logoColor=white)](https://www.php.net/)
[![Version](https://img.shields.io/badge/version-1.0.0-4f46e5)](./CHANGELOG.md)
[![Licence](https://img.shields.io/badge/licence-GPL--2.0--or--later-2f855a)](./LICENSE)

VaultGate verrouille **tout** un site WordPress derrière un mot de passe unique, le temps de le construire ou de le garder privé. La page de garde est autonome, accessible, sans dépendance externe, et se pilote entièrement depuis **Réglages → VaultGate**.

> **Qualité et versions récentes.** Le code cible WordPress **6.5 → 7.1** (dernière version stable : 7.1.3 au 27/10/2026) et PHP **8.2 → 8.5** (dernière version stable : 8.5.12). Aucune API dépréciée, aucun build Composer/npm, aucune requête tierce. La suite fournie exécute **130 assertions** (unitaires + démarrage/rendu de l’extension) sous PHP 8.3, et le code n’utilise aucune fonction retirée ou dépréciée en 8.4/8.5.

---

## 1. Ce que fait l’extension

| Protection | Détail |
|---|---|
| Pages, articles, archives | Toute requête publique passe par la page de garde |
| Flux RSS/Atom | Protégés par défaut |
| Sitemaps WordPress | `wp-sitemap.xml` et ses enfants protégés |
| API REST | `/wp-json` renvoie 401 aux visiteurs anonymes |
| AJAX anonyme | `admin-ajax.php` renvoie 401 sans cookie valide |
| XML-RPC | `xmlrpc.php` bloqué |
| Points d’entrée directs | commentaires, trackbacks, mail, inscription, activation |
| `robots.txt` | Réponse `Disallow: /` pendant la protection |

Sont toujours accessibles : `wp-login.php` (pour que l’administrateur puisse entrer), `wp-admin` (déjà authentifié), WP-Cron et WP-CLI.

## 2. Pourquoi c’est plus solide qu’une extension « simple »

| Point | Extensions minimalistes | VaultGate |
|---|---|---|
| Stockage du mot de passe | Parfois en clair ou faiblement haché | `wp_hash_password()` uniquement |
| Session | Cookie non signé ou mot de passe dans le cookie | Jeton HMAC-SHA256 signé, `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS |
| Révocation | Suppression du cookie une par une | Version de session : tous les cookies invalidés d’un coup |
| Force brute | Aucune limite | Limitation par IP + blocage temporaire |
| Périmètre | Pages seulement | Pages, flux, sitemaps, REST, AJAX, XML-RPC, endpoints directs |
| Contournement | Aucun | Capacité WordPress, IP/CIDR, chemins exclus |
| Page de garde | Formulaire brut | Page autonome, responsive, accessible, thème clair/sombre/auto |
| Administration | Un champ texte | Réglages complets, onglets, aperçu des couleurs, journal |
| Internationalisation | Anglaise | Anglais source + traduction française complète |
| Sauvegarde / secours | Non | WP-CLI, constante `VAULTGATE_DISABLED`, désinstallation propre |
| Qualité | Peu de tests | 130 assertions, échappement systématique, nonces, CSP |

## 3. Installation

### Depuis l’archive

1. Télécharger [`dist/vaultgate-1.0.0.zip`](./dist/vaultgate-1.0.0.zip).
2. Dans WordPress : **Extensions → Ajouter → Téléverser une extension**.
3. Activer **VaultGate**.
4. Aller dans **Réglages → VaultGate**.

### Par FTP / SSH

Copier le dossier [`vaultgate/`](./vaultgate/) dans `wp-content/plugins/`, puis activer l’extension.

### WP-CLI

```bash
wp plugin activate vaultgate
wp vaultgate password 'une longue phrase secrète'
wp vaultgate enable
```

## 4. Mise en route en 30 secondes

1. Ouvrir **Réglages → VaultGate → Protection**.
2. Saisir un mot de passe (8 caractères minimum) et le confirmer.
3. Cocher **Activer la protection par mot de passe**.
4. Enregistrer.
5. Tester dans une fenêtre de navigation privée : la page de garde doit apparaître.

> **Important :** l’extension refuse d’activer la protection s’il n’existe aucun mot de passe. C’est volontaire : cela évite de verrouiller le site sans possibilité d’entrer.

## 5. Les réglages

### Protection

- Interrupteur général.
- Nouveau mot de passe + confirmation (laisser vide pour conserver l’actuel).
- **Déconnecter tous les visiteurs** : invalide immédiatement tous les cookies.
- Rappel des procédures de secours.

### Page de garde

- Titre, message (HTML simple autorisé), URL de logo.
- Couleur d’accent (le contraste du texte du bouton est calculé automatiquement).
- Thème automatique, clair ou sombre.
- Lien d’assistance (`https://…` ou `mailto:…`).
- Note de pied de page.

### Accès

- Durée de session (1 à 365 jours).
- « Rester connecté » optionnel (durée séparée).
- Capacité minimale pour contourner la protection : administrateurs, éditeurs, auteurs ou tout utilisateur connecté.
- Liste d’IP / CIDR autorisées (IPv4 et IPv6).
- Confiance aux en-têtes de proxy (`X-Forwarded-For`, `X-Forwarded-Proto`) — à n’activer que derrière un proxy maîtrisé.
- Chemins exclus, avec joker `*` (contrôles de santé, webhooks, API publique…).

### Avancé

- Protection REST, flux, sitemaps, AJAX anonyme, XML-RPC.
- Seuil et durée du blocage anti-force brute.
- Journal d’activité (20 dernières entrées, IP anonymisées).
- Suppression des données à la désinstallation (optionnel).
- Aide d’urgence et commandes WP-CLI.

### Activité

Les 20 derniers événements : connexions réussies/échouées, blocages, changements de mot de passe, réglages enregistrés. **Aucun mot de passe n’est journalisé.** Les IP sont masquées via `wp_privacy_anonymize_ip()`.

## 6. Sécurité : comment ça marche

- **Mot de passe** : `wp_hash_password()` / `wp_check_password()` (bcrypt ou Argon2 selon la configuration WordPress). Comparaison à temps constant assurée par l’API WordPress.
- **Cookie** : valeur `expiration.signature`, signature `HMAC-SHA256` calculée avec `wp_salt('auth')`, l’URL du site, le contexte et la version de session. Toute modification invalide le jeton.
- **Rotation** : changer le mot de passe ou cliquer sur « Déconnecter tous les visiteurs » incrémente `vaultgate_auth_version` ; tous les cookies existants deviennent invalides.
- **Cookie** : `HttpOnly`, `SameSite=Lax`, `Secure` lorsque HTTPS est détecté (ou via proxy de confiance), chemin et domaine WordPress.
- **Force brute** : compteur par IP dans des transients ; la clé du transient est un HMAC de l’IP, jamais l’IP en clair. Blocage après N échecs pendant une fenêtre configurable.
- **Formulaire** : jeton signé avec expiration (12 h), champ honeypot, message d’erreur générique.
- **En-têtes de la page de garde** : `Cache-Control: no-store`, `DONOTCACHEPAGE`, `X-Robots-Tag`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, CSP stricte avec nonce par requête.
- **Administration** : `manage_options`, nonces WordPress sur chaque action, échappement systématique, aucun secret affiché.
- **Vie privée** : aucune ressource externe (police système, CSS/JS locaux), aucun pistage, journal local optionnel et anonymisé.

### Limites assumées

- Les fichiers servis **directement** par le serveur web (ex. `wp-content/uploads/…`) ne passent pas par WordPress et ne peuvent pas être protégés par une extension seule. Utiliser une protection serveur ou un stockage privé si nécessaire.
- Un cache pleine page placé devant WordPress doit être vidé ou configuré pour ignorer les requêtes protégées. L’extension envoie les bons en-têtes, mais ne peut pas contrôler un cache externe.
- `wp-login.php` reste accessible : c’est nécessaire pour que l’administrateur puisse se connecter. La protection est une porte d’entrée publique, pas un remplacement de l’authentification WordPress.
- Un seul mot de passe partagé : ce n’est pas une gestion d’utilisateurs ou de rôles.
- Multisite : réglages par site.

## 7. Accès d’urgence

1. Se connecter via `wp-login.php` : une session administrateur contourne la protection (`manage_options` par défaut).
2. Désactiver sans base de données, dans `wp-config.php` :
   ```php
   define( 'VAULTGATE_DISABLED', true );
   ```
3. Ou en WP-CLI :
   ```bash
   wp vaultgate status
   wp vaultgate disable
   wp vaultgate password 'nouvelle phrase secrète'
   wp vaultgate logout-all
   ```

## 8. Filtres pour les intégrations

| Filtre | Rôle |
|---|---|
| `vaultgate_should_gate` | Autoriser/refuser une requête spécifique |
| `vaultgate_client_ip` | Remplacer l’IP détectée |
| `vaultgate_bypass_capabilities` | Ajouter des capacités de contournement |
| `vaultgate_blocked_endpoints` | Modifier les endpoints directs bloqués |
| `vaultgate_secure_cookie` | Forcer/désactiver l’attribut `Secure` |
| `vaultgate_cookie_name` | Renommer le cookie |
| `vaultgate_throttled_log_events` | Choisir les événements limités à 1 entrée/minute |
| `vaultgate_log_size` | Taille du journal (20 par défaut) |

## 9. Développement et tests

Aucun gestionnaire de dépendances n’est nécessaire : PHP 8.2+ suffit.

```bash
# Tests unitaires (règles d’accès, jetons, hachage, limitation, rendu)
php tests/run.php

# Test d’intégration : démarrage de l’extension, guard, REST, admin
php tests/smoke.php

# Régénération de vaultgate.pot, fr_FR.po et fr_FR.mo
php tools/build-translations.php

# Aperçu local de la page de garde (http://127.0.0.1:8450)
php -S 127.0.0.1:8450 tests/preview-router.php
```

Résultat attendu :

```text
106 passed, 0 failed
20 passed, 0 failed
```

### Construire l’archive

```powershell
Compress-Archive -Path .\vaultgate -DestinationPath .\dist\vaultgate-1.0.0.zip -Force
```

L’archive doit contenir un dossier `vaultgate/` à sa racine, avec `vaultgate.php`, `includes/`, `assets/`, `templates/`, `languages/` et `uninstall.php`.

## 10. Arborescence

```text
passwordprotect/
├── README.md
├── CHANGELOG.md
├── SECURITY.md
├── LICENSE
├── dist/
│   └── vaultgate-1.0.0.zip
├── vaultgate/                  ← dossier à installer
│   ├── vaultgate.php           ← en-tête WordPress + bootstrap
│   ├── uninstall.php
│   ├── readme.txt              ← fiche WordPress.org
│   ├── includes/
│   │   ├── class-settings.php
│   │   ├── class-access-rules.php
│   │   ├── class-token.php
│   │   ├── class-rate-limiter.php
│   │   ├── class-guard.php
│   │   ├── class-admin.php
│   │   ├── class-cli.php
│   │   └── class-plugin.php
│   ├── templates/gate.php
│   ├── assets/css/{gate,admin}.css
│   ├── assets/js/{gate,admin}.js
│   └── languages/{vaultgate.pot,vaultgate-fr_FR.po,vaultgate-fr_FR.mo}
├── tests/
│   ├── bootstrap.php
│   ├── run.php
│   └── smoke.php
└── tools/
    ├── build-translations.php
    └── fr-translations.php
```

## 11. Journal des versions

Voir [CHANGELOG.md](./CHANGELOG.md).

## 12. Licence

GPL-2.0-or-later — voir [LICENSE](./LICENSE).  
Copyright © 2026 zigmoon.

## 13. Sécurité

Pour signaler une vulnérabilité, voir [SECURITY.md](./SECURITY.md) et utiliser les avis de sécurité privés GitHub.
