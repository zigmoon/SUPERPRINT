<?php
/**
 * Standalone tests for the pure VaultGate components.
 *
 * Run with: php tests/run.php
 *
 * @package VaultGate
 */

use VaultGate\AccessRules;
use VaultGate\RateLimiter;
use VaultGate\Settings;
use VaultGate\Token;

require_once __DIR__ . '/bootstrap.php';
require_once VAULTGATE_DIR . 'includes/class-settings.php';
require_once VAULTGATE_DIR . 'includes/class-access-rules.php';
require_once VAULTGATE_DIR . 'includes/class-token.php';
require_once VAULTGATE_DIR . 'includes/class-rate-limiter.php';

$GLOBALS['vg_pass'] = 0;
$GLOBALS['vg_fail'] = 0;

/**
 * Asserts a condition.
 *
 * @param bool   $condition Condition.
 * @param string $message   Description.
 */
function vg_assert( bool $condition, string $message ): void {
	if ( $condition ) {
		++$GLOBALS['vg_pass'];
		return;
	}

	++$GLOBALS['vg_fail'];
	echo "FAIL: {$message}\n";
}

/**
 * Asserts strict equality.
 *
 * @param mixed  $expected Expected value.
 * @param mixed  $actual   Actual value.
 * @param string $message  Description.
 */
function vg_same( mixed $expected, mixed $actual, string $message ): void {
	vg_assert(
		$expected === $actual,
		$message . ' (expected ' . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) . ')'
	);
}

/**
 * Resets the fake WordPress state.
 */
function vg_reset(): void {
	$GLOBALS['vg_options']    = array();
	$GLOBALS['vg_transients'] = array();
	$GLOBALS['vg_filters']    = array();
	$_GET                     = array();
	$_POST                    = array();
	$_COOKIE                  = array();
	$_SERVER                  = array(
		'REQUEST_URI'   => '/',
		'REMOTE_ADDR'   => '203.0.113.10',
		'HTTP_HOST'     => 'example.test',
		'REQUEST_METHOD' => 'GET',
	);
}

/**
 * Reproduces Token::sign() for expiry tests.
 *
 * @param string $context  Context.
 * @param int    $expires  Expiry.
 * @param int    $version  Auth version.
 */
function vg_sign_token( string $context, int $expires, int $version = 1 ): string {
	$secret  = hash_hmac( 'sha256', 'vaultgate|https://example.test/', 'test-salt-auth|vaultgate' );
	$payload = implode( '|', array( 'vaultgate-v1', $context, (string) $version, (string) $expires ) );

	return hash_hmac( 'sha256', $payload, $secret );
}

/* -------------------------------------------------------------------------
 * Settings: sanitisation and storage.
 * ---------------------------------------------------------------------- */

vg_reset();

$clean = Settings::sanitize(
	array(
		'enabled'           => '1',
		'gate_title'        => '  <b>Hello</b>  ',
		'gate_message'      => '<script>alert(1)</script><p>Hi</p>',
		'logo_url'          => 'javascript:alert(1)',
		'accent'            => '#abc',
		'theme'             => 'neon',
		'support_url'       => 'mailto:hi@example.test',
		'footer_note'       => '<em>bye</em>',
		'session_days'      => '9999',
		'remember_enabled'  => '0',
		'remember_days'     => '0',
		'bypass_capability' => 'read',
		'ip_allowlist'      => "203.0.113.5\n300.1.1.1\n2001:db8::/32\n10.0.0.0/8\n10.0.0.0/33\n# comment",
		'exclude_paths'     => "api\n/foo bar\n/ok/*\n../etc\n# note",
		'protect_rest'      => '1',
		'protect_feeds'     => '0',
		'protect_sitemaps'  => '1',
		'protect_ajax'      => '1',
		'protect_xmlrpc'    => '0',
		'trust_proxy'       => '0',
		'max_attempts'      => '0',
		'lockout_minutes'   => '99999',
		'log_enabled'       => '1',
		'delete_data'       => '0',
	)
);

vg_same( true, $clean['enabled'], 'enabled flag is boolean true' );
vg_same( false, $clean['protect_feeds'], 'unchecked flag is boolean false' );
vg_same( 'Hello', $clean['gate_title'], 'title is stripped and trimmed' );
vg_same( false, str_contains( $clean['gate_message'], '<script' ), 'message script is removed' );
vg_same( false, str_contains( $clean['gate_message'], 'alert(1)' ), 'message payload is removed' );
vg_same( '', $clean['logo_url'], 'javascript: logo URL is rejected' );
vg_same( 'mailto:hi@example.test', $clean['support_url'], 'mailto support URL is kept' );
vg_same( '#aabbcc', $clean['accent'], '3-digit hex is expanded' );
vg_same( 'auto', $clean['theme'], 'unknown theme falls back to auto' );
vg_same( 365, $clean['session_days'], 'session days are capped' );
vg_same( 1, $clean['remember_days'], 'remember days have a floor' );
vg_same( 1, $clean['max_attempts'], 'attempts have a floor' );
vg_same( 1440, $clean['lockout_minutes'], 'lockout is capped' );
vg_same( 'read', $clean['bypass_capability'], 'known capability is kept' );
vg_same( 'bye', $clean['footer_note'], 'footer tags are stripped' );

vg_assert( str_contains( $clean['ip_allowlist'], '203.0.113.5' ), 'valid IPv4 is kept' );
vg_assert( str_contains( $clean['ip_allowlist'], '2001:db8::/32' ), 'valid IPv6 range is kept' );
vg_assert( str_contains( $clean['ip_allowlist'], '10.0.0.0/8' ), 'valid IPv4 range is kept' );
vg_assert( ! str_contains( $clean['ip_allowlist'], '300.1.1.1' ), 'invalid IPv4 is rejected' );
vg_assert( ! str_contains( $clean['ip_allowlist'], '/33' ), 'invalid IPv4 prefix is rejected' );

vg_assert( str_contains( $clean['exclude_paths'], '/api' ), 'path gets a leading slash' );
vg_assert( str_contains( $clean['exclude_paths'], '/ok/*' ), 'wildcard path is kept' );
vg_assert( ! str_contains( $clean['exclude_paths'], 'foo bar' ), 'paths with spaces are rejected' );
vg_assert( ! str_contains( $clean['exclude_paths'], '..' ), 'parent traversal is rejected' );
vg_assert( ! str_contains( $clean['exclude_paths'], '# note' ), 'comments are rejected' );

vg_same( '#aabbcc', Settings::normalize_hex( '#ABC' ), 'normalize_hex expands case-insensitively' );

vg_reset();

$settings = new Settings();
vg_same( false, $settings->is_enabled(), 'protection is off when there is no password' );
vg_same( false, $settings->set_password( 'short' ), 'short passwords are rejected' );
vg_same( false, Settings::is_password_long_enough( 'éééé' ), 'password length counts characters, not bytes' );
vg_same( true, Settings::is_password_long_enough( 'éééééééé' ), 'eight multibyte characters are accepted' );
vg_same( false, $settings->has_password(), 'no hash is stored for a short password' );
vg_same( true, $settings->set_password( 'correct horse battery staple' ), 'long password is stored' );
vg_same( true, $settings->has_password(), 'hash exists after storing' );
vg_same( true, $settings->verify_password( 'correct horse battery staple' ), 'correct password verifies' );
vg_same( false, $settings->verify_password( 'wrong password' ), 'wrong password fails' );
vg_same( 2, $settings->auth_version(), 'setting a password bumps the auth version' );

$settings->update( array( 'enabled' => true ) );
vg_same( true, $settings->is_enabled(), 'enabled + password activates the gate' );

vg_same( 'manage_options', Settings::sanitize( array( 'bypass_capability' => 'not_a_real_cap' ) )['bypass_capability'], 'unknown capability falls back to manage_options' );

$settings->log( 'login_failed', '203.0.113.10' );
$logs = $settings->logs();
vg_same( 1, count( $logs ), 'log stores one entry' );
vg_same( 'login_failed', $logs[0]['event'], 'log event is stored' );
vg_same( '203.0.113.0', $logs[0]['ip'], 'logged IP is anonymised' );

$settings->clear_log();
vg_same( array(), $settings->logs(), 'clearing removes entries' );

/* -------------------------------------------------------------------------
 * Token: signatures, expiry, version invalidation, filters.
 * ---------------------------------------------------------------------- */

vg_reset();
$settings = new Settings();
$token    = new Token( $settings );

$issued = $token->issue( time() + 3600 );
vg_assert( $token->verify( $issued ), 'fresh cookie token verifies' );
vg_assert( ! $token->verify( $issued . '0' ), 'tampered cookie token fails' );
vg_assert( ! $token->verify( 'not-a-token' ), 'garbage token fails' );
vg_assert( ! $token->verify( '9999999999.' . str_repeat( 'a', 64 ) ), 'forged token fails' );

$expired_expiry = time() - 30;
$expired        = $expired_expiry . '.' . vg_sign_token( 'cookie', $expired_expiry );
vg_assert( ! $token->verify( $expired ), 'expired token fails' );

$form = $token->form_token();
vg_assert( $token->verify_form_token( $form ), 'form token verifies' );
vg_assert( ! $token->verify_form_token( $form . 'f' ), 'tampered form token fails' );
vg_assert( ! $token->verify_form_token( $issued ), 'cookie token is not a form token' );

$issued_before_bump = $token->issue( time() + 3600 );
$settings->bump_auth_version();
vg_assert( ! $token->verify( $issued_before_bump ), 'password/session version invalidates existing tokens' );

$GLOBALS['vg_filters']['vaultgate_cookie_name'] = array(
	10 => array(
		static function ( string $name ): string {
			return 'bad name!';
		},
	),
);
vg_same( 'badname', Token::cookie_name(), 'cookie name filter is sanitised' );
vg_same( 'vaultgate_auth', Token::COOKIE, 'default cookie name is stable' );

/* -------------------------------------------------------------------------
 * Access rules.
 * ---------------------------------------------------------------------- */

vg_assert( AccessRules::ip_matches( '203.0.113.10', '203.0.113.0/24' ), 'IPv4 /24 matches' );
vg_assert( ! AccessRules::ip_matches( '203.0.114.10', '203.0.113.0/24' ), 'IPv4 outside /24 fails' );
vg_assert( AccessRules::ip_matches( '10.0.0.255', '10.0.0.0/24' ), 'IPv4 boundary matches' );
vg_assert( ! AccessRules::ip_matches( '10.0.1.0', '10.0.0.0/24' ), 'IPv4 just outside /24 fails' );
vg_assert( AccessRules::ip_matches( '2001:db8::5', '2001:db8::/32' ), 'IPv6 /32 matches' );
vg_assert( ! AccessRules::ip_matches( '2001:db9::5', '2001:db8::/32' ), 'IPv6 outside /32 fails' );
vg_assert( ! AccessRules::ip_matches( '10.0.0.1', '2001:db8::/32' ), 'mixed families fail' );
vg_assert( AccessRules::ip_matches( '192.0.2.7', "192.0.2.7\n198.51.100.1" ), 'exact IP matches' );
vg_assert( ! AccessRules::ip_matches( '', '0.0.0.0/0' ), 'empty IP never matches' );

vg_assert( AccessRules::ip_in_range( '192.0.2.255', '192.0.2.0/24' ), 'range helper matches' );
vg_assert( ! AccessRules::ip_in_range( '192.0.2.1', '192.0.2.0/33' ), 'invalid prefix fails' );

vg_assert( AccessRules::path_matches( '/robots.txt', '/robots.txt' ), 'exact path matches' );
vg_assert( AccessRules::path_matches( '/robots.txt/extra', '/robots.txt' ), 'path prefix matches' );
vg_assert( ! AccessRules::path_matches( '/robots.txtx', '/robots.txt' ), 'path boundary is respected' );
vg_assert( AccessRules::path_matches( '/api/v1/users', '/api/*' ), 'wildcard matches nested path' );
vg_assert( AccessRules::path_matches( '/api', '/api/*' ), 'wildcard also matches its base path' );
vg_assert( ! AccessRules::path_matches( '/apix', '/api' ), 'prefix requires a slash boundary' );
vg_assert( AccessRules::path_matches( '/foo', '/foo/' ), 'trailing slash is normalised' );
vg_assert( ! AccessRules::path_matches( '/FOO', '/foo' ), 'paths remain case-sensitive' );
vg_assert( AccessRules::path_matches( '/', '/' ), 'root path matches' );

vg_same( '/foo bar/', AccessRules::request_path( '/foo%20bar/?x=1' ), 'request path is decoded' );
vg_same( '/a/b', AccessRules::request_path( '/a//b' ), 'duplicate slashes are collapsed' );
vg_same( '/', AccessRules::request_path( '' ), 'empty URI becomes root' );

$_SERVER['REMOTE_ADDR']                 = '203.0.113.10';
$_SERVER['HTTP_X_FORWARDED_FOR']        = '198.51.100.7, 10.0.0.1';
$_SERVER['HTTP_X_FORWARDED_PROTO']      = 'https';
vg_same( '203.0.113.10', AccessRules::client_ip( false ), 'proxy headers are ignored by default' );
vg_same( '198.51.100.7', AccessRules::client_ip( true ), 'first forwarded IP is used when trusted' );
vg_assert( AccessRules::is_https( true ), 'forwarded https is trusted when enabled' );
vg_assert( ! AccessRules::is_https( false ), 'forwarded https is ignored by default' );

$_SERVER['HTTP_X_FORWARDED_FOR'] = 'not-an-ip';
vg_same( '203.0.113.10', AccessRules::client_ip( true ), 'invalid forwarded IP falls back to REMOTE_ADDR' );

/* -------------------------------------------------------------------------
 * Rate limiter.
 * ---------------------------------------------------------------------- */

vg_reset();
$limiter = new RateLimiter( 3, 10 );

vg_same( 0, $limiter->seconds_remaining( '198.51.100.7' ), 'no lock-out initially' );
vg_same( 0, $limiter->register_failure( '198.51.100.7' ), 'first failure does not lock' );
vg_same( 0, $limiter->register_failure( '198.51.100.7' ), 'second failure does not lock' );
$locked = $limiter->register_failure( '198.51.100.7' );
vg_assert( $locked > 0, 'third failure locks the IP' );
vg_assert( $limiter->seconds_remaining( '198.51.100.7' ) > 0, 'lock-out is reported' );
vg_same( 0, $limiter->seconds_remaining( '198.51.100.8' ), 'other IPs are unaffected' );

$keys = array_keys( $GLOBALS['vg_transients'] );
vg_assert( array() !== $keys, 'limiter stores a transient' );
vg_assert( ! str_contains( (string) $keys[0], '198.51.100.7' ), 'transient key never contains the IP' );

$limiter->clear( '198.51.100.7' );
vg_same( 0, $limiter->seconds_remaining( '198.51.100.7' ), 'clear removes the lock-out' );

$limiter = new RateLimiter( 1, 5 );
vg_assert( $limiter->register_failure( '192.0.2.1' ) > 0, 'max_attempts=1 locks immediately' );

/* -------------------------------------------------------------------------
 * Gate template.
 * ---------------------------------------------------------------------- */

vg_reset();

$vg = array(
	'title'         => 'Private <script>alert(1)</script>',
	'message'       => '<script>alert(1)</script><p>Welcome &amp; hello</p>',
	'logo'          => 'https://example.test/logo.png?x=1&y=2',
	'support'       => 'mailto:hi@example.test',
	'footer'        => 'Footer & more',
	'accent'        => '#4f46e5',
	'accent_ink'    => '#ffffff',
	'theme'         => 'auto',
	'nonce'         => 'abc123',
	'action'        => 'https://example.test/?vaultgate=login',
	'redirect'      => 'https://example.test/protected?x=1&y=2',
	'form_token'    => '123.abc',
	'remember'      => true,
	'remember_days' => 30,
	'notice'        => 'Incorrect "password" <b>',
	'site_name'     => 'Test & Site',
	'style_url'     => 'https://example.test/gate.css',
	'script_url'    => 'https://example.test/gate.js',
);

ob_start();
require VAULTGATE_DIR . 'templates/gate.php';
$html = (string) ob_get_clean();

vg_assert( str_contains( $html, '<form' ), 'template renders the form' );
vg_assert( str_contains( $html, 'name="vaultgate_password"' ), 'template renders the password field' );
vg_assert( str_contains( $html, 'name="vaultgate_website"' ), 'template renders the honeypot' );
vg_assert( str_contains( $html, 'name="vaultgate_form_token"' ), 'template renders the signed form token' );
vg_assert( str_contains( $html, '--vg-accent: #4f46e5' ), 'template injects the accent colour' );
vg_assert( str_contains( $html, '--vg-accent-ink: #ffffff' ), 'template injects the contrast colour' );
vg_assert( str_contains( $html, 'nonce="abc123"' ), 'template uses the CSP nonce' );
vg_assert( str_contains( $html, 'href="https://example.test/gate.css"' ), 'template links the local stylesheet' );
vg_assert( str_contains( $html, 'src="https://example.test/gate.js"' ), 'template links the local script' );
vg_assert( str_contains( $html, 'data-label-show="Show"' ), 'template passes translated reveal labels' );
vg_assert( ! str_contains( $html, '<script>alert' ), 'template never echoes unescaped scripts' );
vg_assert( 1 === substr_count( $html, '<script' ), 'template contains only the external script tag' );
vg_assert( str_contains( $html, '&lt;script&gt;' ), 'title is HTML-escaped' );
vg_assert( str_contains( $html, '&quot;password&quot; &lt;b&gt;' ), 'notice is HTML-escaped' );
vg_assert( str_contains( $html, 'Test &amp; Site' ), 'site name is HTML-escaped' );
vg_assert( str_contains( $html, 'https://example.test/logo.png?x=1&amp;y=2' ), 'logo URL is escaped' );
vg_assert( str_contains( $html, 'value="https://example.test/protected?x=1&amp;y=2"' ), 'redirect target is escaped' );
vg_assert( str_contains( $html, 'Keep me signed in for 30 days' ), 'remember-me label is rendered' );

/* -------------------------------------------------------------------------
 * Report.
 * ---------------------------------------------------------------------- */

echo "\n" . $GLOBALS['vg_pass'] . ' passed, ' . $GLOBALS['vg_fail'] . " failed\n";

exit( $GLOBALS['vg_fail'] > 0 ? 1 : 0 );
