# Security policy

## Versions prises en charge

| Version | Support |
|---|---|
| 1.0.x | Oui |

## Signaler une vulnérabilité

Merci de ne **pas** ouvrir d’issue publique pour une faille de sécurité.

Utilisez les avis de sécurité privés de GitHub :

<https://github.com/zigmoon/SUPERPRINT/security/advisories/new>

Merci d’indiquer :

- la version de VaultGate, WordPress et PHP ;
- une description du problème et de son impact ;
- les étapes de reproduction, si possible avec une requête HTTP ou une capture ;
- toute mesure d’atténuation connue.

Un accusé de réception est visé sous 72 heures. Une correction et une publication coordonnée seront proposées dès que possible.

## Périmètre

Sont dans le périmètre :

- contournement de la page de garde ou du cookie signé ;
- elevation de privilèges dans les actions d’administration ;
- XSS, CSRF, injection d’en-têtes ou redirection ouverte ;
- fuite du mot de passe, du hachage ou des journaux ;
- faille dans la limitation de tentatives ou la révocation de session.

Ne sont pas des vulnérabilités de VaultGate :

- l’accès direct aux fichiers statiques servis par le serveur web (voir les limites du README) ;
- la protection de `wp-login.php` ou de l’authentification WordPress elle-même ;
- une configuration serveur qui met en cache les pages malgré les en-têtes `no-store` ;
- l’activation de `trust_proxy` sur un serveur directement exposé, qui permet l’usurpation d’IP par construction.

## Bonnes pratiques de déploiement

- Utiliser HTTPS.
- Choisir une longue phrase secrète (le minimum technique est de 8 caractères).
- Ne pas activer `trust_proxy` sans proxy de confiance.
- Garder WordPress, PHP et les extensions à jour.
- Configurer le cache plein page pour exclure les réponses protégées.
