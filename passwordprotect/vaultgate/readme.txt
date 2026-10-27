=== VaultGate ===
Contributors: zigmoon
Tags: password protection, maintenance mode, coming soon, access control, privacy
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 8.2
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Lock an entire WordPress site behind one password, with a polished gate page, signed cookies, CIDR allowlisting and no third-party service.

== Description ==

VaultGate protects a whole WordPress installation while it is being built or kept private. Visitors see a fast, accessible password page instead of the site. Everything else — pages, posts, archives, feeds, sitemaps, the REST API, AJAX and XML-RPC — is closed until the correct password is entered.

**Built for the current stack.** VaultGate targets WordPress 6.5 through 7.1 and PHP 8.2 through 8.5. It uses only maintained WordPress APIs, has no deprecated calls, no Composer/npm build step and no external requests.

**Security first**

* The password is stored with `wp_hash_password()` — never in clear text, never in the database as plain text.
* Access is a stateless HMAC-SHA256 token in an HttpOnly, SameSite=Lax cookie (Secure on HTTPS).
* Changing the password, or clicking “Sign out every visitor”, rotates the signing version and invalidates every cookie instantly.
* Per-IP brute-force throttling, generic error messages and a hidden honeypot field.
* `hash_equals()` for signature checks and `wp_check_password()` for passwords.
* The gate sends `no-store` caching headers, `X-Robots-Tag`, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options` and a strict Content-Security-Policy with a per-request nonce.
* No jQuery, no external fonts, no analytics, no CDN dependency.

**Quality of implementation**

* Strictly escaped output, sanitised input, capability checks and nonces on every admin action.
* Small, single-responsibility classes: settings, access rules, tokens, rate limiter, guard, admin, CLI.
* 130 automated assertions ship in the `tests/` directory (unit tests plus a boot/render smoke test).
* French translation included (`fr_FR`), English source strings, `.pot` catalogue.
* Uninstall cleanup is opt-in and multisite-aware.

**Features**

* Master switch plus password change from Settings → VaultGate.
* Custom gate page: title, message, logo, accent colour, light/dark/auto theme, support link and footer.
* Session duration and an optional “Keep me signed in”.
* Let logged-in users with a chosen capability (administrators, editors, authors or any logged-in user) bypass the gate.
* IP allowlist with IPv4, IPv6 and CIDR ranges.
* Optional reverse-proxy header support (only enable it behind a trusted proxy).
* Path exclusions with `*` wildcards, for health checks or public webhooks.
* Toggles for REST API, feeds, sitemaps, anonymous AJAX and XML-RPC.
* Capped, anonymised activity log.
* WP-CLI commands for emergencies and automation.
* Filters for integration with bespoke workflows.

**Emergency access**

You can always log in through `wp-login.php`. Administrator sessions always bypass the gate. If you need to disable the gate without the dashboard:

`define( 'VAULTGATE_DISABLED', true );` in `wp-config.php`, or:

`wp vaultgate disable`

== Installation ==

1. Upload the `vaultgate` folder to `/wp-content/plugins/`, or upload the ZIP through Plugins → Add New → Upload Plugin.
2. Activate the plugin.
3. Open Settings → VaultGate.
4. Enter a password (minimum 8 characters), confirm it, then tick “Enable password protection” and save.
5. Open the site in a private window to check the gate.

== Frequently Asked Questions ==

= Is the password stored in clear text? =

No. VaultGate stores a one-way hash produced by `wp_hash_password()`. The plain password is never written to the database or the log.

= What happens if I forget the password? =

`wp-login.php` is not gated, and administrator sessions bypass the gate. You can also use the `VAULTGATE_DISABLED` constant or `wp vaultgate password 'new passphrase'` with WP-CLI.

= Does it work with a full-page cache? =

The gate sends `Cache-Control: no-store`, `DONOTCACHEPAGE` and `DONOTCACHEOBJECT`, and the cookie is checked on every request. If you use a reverse proxy or CDN, exclude the site (or at least dynamic HTML) from its cache while the gate is on.

= Are uploaded files protected? =

No. VaultGate protects requests handled by WordPress. Files served directly by the web server (for example `/wp-content/uploads/2024/01/photo.jpg`) are outside WordPress and cannot be gated by a plugin alone. Use server-level authentication or a private-media plugin if those files are sensitive.

= Does it protect the REST API? =

Yes, by default anonymous `/wp-json` requests return 401. Logged-in users above the bypass capability, and visitors with a valid gate cookie, keep access. You can turn REST protection off in the Advanced tab.

= Does it support multisite? =

Yes. Settings are per site. Network activation is supported; uninstall cleanup runs for each site that opted in.

= Which PHP versions are supported? =

PHP 8.2 and newer, including PHP 8.3, 8.4 and 8.5. The code uses typed properties, straightforward control flow and no deprecated APIs. The included test suite is run under PHP 8.3 and PHP 8.5.

= Is the gate page accessible? =

It uses semantic HTML, a skip link, visible focus rings, a properly labelled password field, an `aria-live` error message, reduced-motion support and AA-level colour contrast. The password reveal button is progressive enhancement only.

== Changelog ==

= 1.0.0 =
* Initial release.
* Whole-site gate for pages, feeds, sitemaps, REST, AJAX and XML-RPC.
* HMAC-signed HttpOnly cookies with instant global revocation.
* Per-IP rate limiting and anonymised activity log.
* CIDR/IP allowlist, path exclusions and capability-based bypass.
* Customisable, accessible gate page with light/dark/auto themes.
* French translation, WP-CLI commands and opt-in uninstall cleanup.

== Upgrade Notice ==

= 1.0.0 =
First public release.
