<?php
/**
 * Signed authentication and form tokens.
 *
 * @package VaultGate
 */

namespace VaultGate;

defined( 'ABSPATH' ) || exit;

/**
 * Issues and verifies HMAC-signed values. No server-side session is stored:
 * changing the password or bumping the auth version invalidates everything.
 */
final class Token {

	public const COOKIE           = 'vaultgate_auth';
	private const FORM_TTL        = 12 * HOUR_IN_SECONDS;
	private const COOKIE_CONTEXT  = 'cookie';
	private const FORM_CONTEXT    = 'form';

	/**
	 * Settings accessor.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Constructor.
	 *
	 * @param Settings $settings Settings instance.
	 */
	public function __construct( Settings $settings ) {
		$this->settings = $settings;
	}

	/**
	 * Cookie name, filterable for unusual hosting setups.
	 */
	public static function cookie_name(): string {
		$name = apply_filters( 'vaultgate_cookie_name', self::COOKIE );
		$name = is_string( $name ) ? $name : self::COOKIE;
		$name = preg_replace( '/[^A-Za-z0-9_\-]/', '', $name );

		return is_string( $name ) && '' !== $name ? $name : self::COOKIE;
	}

	/**
	 * Creates a signed cookie value valid until `$expires`.
	 *
	 * @param int $expires Unix timestamp.
	 */
	public function issue( int $expires ): string {
		$expires = max( time() + 60, $expires );

		return $expires . '.' . $this->sign( self::COOKIE_CONTEXT, $expires );
	}

	/**
	 * Verifies a cookie value.
	 *
	 * @param string $token Cookie value.
	 */
	public function verify( string $token ): bool {
		return $this->verify_context( self::COOKIE_CONTEXT, $token );
	}

	/**
	 * Whether the current request carries a valid gate cookie.
	 */
	public function is_authenticated(): bool {
		$name  = self::cookie_name();
		$value = $_COOKIE[ $name ] ?? '';

		if ( ! is_string( $value ) || '' === $value || strlen( $value ) > 200 ) {
			return false;
		}

		return $this->verify( $value );
	}

	/**
	 * Token embedded in the gate form. It is stateless so that a cached page
	 * cannot break the login flow.
	 */
	public function form_token(): string {
		$expires = time() + self::FORM_TTL;

		return $expires . '.' . $this->sign( self::FORM_CONTEXT, $expires );
	}

	/**
	 * Verifies a gate-form token.
	 *
	 * @param string $token Submitted value.
	 */
	public function verify_form_token( string $token ): bool {
		return $this->verify_context( self::FORM_CONTEXT, $token );
	}

	/**
	 * Sends the authentication cookie.
	 *
	 * @param int $expires Unix timestamp.
	 */
	public function set_cookie( int $expires ): bool {
		if ( headers_sent() ) {
			return false;
		}

		$name  = self::cookie_name();
		$token = $this->issue( $expires );
		$done  = setcookie( $name, $token, $this->cookie_options( $expires ) );

		if ( $done ) {
			$_COOKIE[ $name ] = $token;
		}

		return $done;
	}

	/**
	 * Deletes the authentication cookie.
	 */
	public function clear_cookie(): void {
		$name = self::cookie_name();

		if ( ! headers_sent() ) {
			setcookie( $name, '', $this->cookie_options( time() - YEAR_IN_SECONDS ) );
		}

		unset( $_COOKIE[ $name ] );
	}

	/**
	 * Cookie attributes.
	 *
	 * @param int $expires Unix timestamp.
	 * @return array<string, mixed>
	 */
	private function cookie_options( int $expires ): array {
		$secure = AccessRules::is_https( (bool) $this->settings->get( 'trust_proxy' ) );

		/**
		 * Filters whether the gate cookie is sent over HTTPS only.
		 *
		 * @param bool $secure Current value.
		 */
		$secure = (bool) apply_filters( 'vaultgate_secure_cookie', $secure );

		return array(
			'expires'  => $expires,
			'path'     => defined( 'COOKIEPATH' ) && COOKIEPATH ? COOKIEPATH : '/',
			'domain'   => defined( 'COOKIE_DOMAIN' ) && COOKIE_DOMAIN ? COOKIE_DOMAIN : '',
			'secure'   => $secure,
			'httponly' => true,
			'samesite' => 'Lax',
		);
	}

	/**
	 * Verifies a token for a given context.
	 *
	 * @param string $context Context name.
	 * @param string $token   Token value.
	 */
	private function verify_context( string $context, string $token ): bool {
		$parts = explode( '.', $token, 2 );

		if ( 2 !== count( $parts ) || ! ctype_digit( $parts[0] ) ) {
			return false;
		}

		$expires = (int) $parts[0];

		if ( $expires < time() || $expires > time() + ( 400 * DAY_IN_SECONDS ) ) {
			return false;
		}

		$signature = $parts[1];

		if ( 64 !== strlen( $signature ) || ! ctype_xdigit( $signature ) ) {
			return false;
		}

		return hash_equals( $this->sign( $context, $expires ), $signature );
	}

	/**
	 * HMAC for a context and expiry.
	 *
	 * @param string $context Context name.
	 * @param int    $expires Unix timestamp.
	 */
	private function sign( string $context, int $expires ): string {
		$payload = implode( '|', array( 'vaultgate-v1', $context, (string) $this->settings->auth_version(), (string) $expires ) );

		return hash_hmac( 'sha256', $payload, $this->secret() );
	}

	/**
	 * Site-specific signing key. COOKIEHASH is stable across languages and
	 * includes the site path on multisite; the home URL is only a fallback.
	 */
	private function secret(): string {
		$salt  = function_exists( 'wp_salt' ) ? (string) wp_salt( 'auth' ) : '';
		$scope = defined( 'COOKIEHASH' ) ? (string) COOKIEHASH : ( function_exists( 'home_url' ) ? (string) home_url( '/' ) : '' );

		return hash_hmac( 'sha256', 'vaultgate|' . $scope, $salt . '|vaultgate' );
	}
}
