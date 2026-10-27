<?php
/**
 * Request guard: decides what is protected and renders the gate.
 *
 * @package VaultGate
 */

namespace VaultGate;

defined( 'ABSPATH' ) || exit;

/**
 * Intercepts front-end, REST, AJAX, XML-RPC and feed requests.
 */
final class Guard {

	/**
	 * Settings.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Token helper.
	 *
	 * @var Token
	 */
	private Token $token;

	/**
	 * Brute-force limiter.
	 *
	 * @var RateLimiter
	 */
	private RateLimiter $limiter;

	/**
	 * Cached visitor IP.
	 *
	 * @var string|null
	 */
	private ?string $ip = null;

	/**
	 * Cached bypass decision.
	 *
	 * @var bool|null
	 */
	private ?bool $bypassed = null;

	/**
	 * Constructor.
	 *
	 * @param Settings $settings Settings instance.
	 */
	public function __construct( Settings $settings ) {
		$this->settings = $settings;
		$this->token    = new Token( $settings );
		$this->limiter  = new RateLimiter(
			(int) $settings->get( 'max_attempts', 5 ),
			(int) $settings->get( 'lockout_minutes', 15 )
		);
	}

	/**
	 * Registers hooks.
	 */
	public function hooks(): void {
		add_action( 'init', array( $this, 'handle_endpoints' ), 1 );
		add_action( 'init', array( $this, 'block_direct_access' ), 99 );
		add_action( 'template_redirect', array( $this, 'maybe_gate' ), 0 );
		add_filter( 'rest_authentication_errors', array( $this, 'rest_authentication_errors' ) );
		add_filter( 'robots_txt', array( $this, 'filter_robots_txt' ), 20, 2 );
	}

	/**
	 * Handles the password form and the logout link before any output.
	 */
	public function handle_endpoints(): void {
		$action = isset( $_GET['vaultgate'] ) && is_string( $_GET['vaultgate'] )
			? sanitize_key( wp_unslash( $_GET['vaultgate'] ) )
			: '';

		if ( 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
			$this->handle_login();
		}

		if ( 'logout' === $action ) {
			$this->handle_logout();
		}
	}

	/**
	 * Verifies the gate form.
	 */
	private function handle_login(): void {
		if ( 'POST' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) || ! $this->settings->is_enabled() ) {
			return;
		}

		$posted_action = isset( $_POST['vaultgate_action'] ) && is_string( $_POST['vaultgate_action'] )
			? sanitize_key( wp_unslash( $_POST['vaultgate_action'] ) )
			: '';

		if ( 'login' !== $posted_action ) {
			return;
		}

		$target = $this->posted_target();
		$ip     = $this->client_ip();

		$honeypot = isset( $_POST['vaultgate_website'] ) && is_string( $_POST['vaultgate_website'] )
			? trim( wp_unslash( $_POST['vaultgate_website'] ) )
			: '';

		if ( '' !== $honeypot ) {
			$this->settings->log( 'honeypot', $ip );
			$this->redirect_with_notice( $target, 'invalid' );
		}

		$form_token = isset( $_POST['vaultgate_form_token'] ) && is_string( $_POST['vaultgate_form_token'] )
			? sanitize_text_field( wp_unslash( $_POST['vaultgate_form_token'] ) )
			: '';

		if ( ! $this->token->verify_form_token( $form_token ) ) {
			$this->settings->log( 'form_expired', $ip );
			$this->redirect_with_notice( $target, 'expired' );
		}

		$remaining = '' !== $ip ? $this->limiter->seconds_remaining( $ip ) : 0;

		if ( $remaining > 0 ) {
			$this->settings->log( 'login_locked', $ip );
			$this->redirect_with_notice( $target, 'locked', $remaining );
		}

		$password = isset( $_POST['vaultgate_password'] ) && is_string( $_POST['vaultgate_password'] )
			? wp_unslash( $_POST['vaultgate_password'] )
			: '';

		if ( '' === $password ) {
			$this->redirect_with_notice( $target, 'missing' );
		}

		if ( ! $this->settings->verify_password( $password ) ) {
			$remaining = '' !== $ip ? $this->limiter->register_failure( $ip ) : 0;
			$this->settings->log( 'login_failed', $ip );
			$this->redirect_with_notice( $target, $remaining > 0 ? 'locked' : 'invalid', $remaining );
		}

		$days     = (int) $this->settings->get( 'session_days', 7 );
		$remember = ! empty( $_POST['vaultgate_remember'] ) && $this->settings->get( 'remember_enabled' );

		if ( $remember ) {
			$days = (int) $this->settings->get( 'remember_days', 30 );
		}

		$days    = min( 365, max( 1, $days ) );
		$expires = time() + ( $days * DAY_IN_SECONDS );

		if ( ! $this->token->set_cookie( $expires ) ) {
			$this->settings->log( 'cookie_failed', $ip );
			$this->redirect_with_notice( $target, 'cookie' );
		}

		if ( '' !== $ip ) {
			$this->limiter->clear( $ip );
		}

		$this->settings->log( 'login_success', $ip );
		$this->redirect( $target );
	}

	/**
	 * Clears the gate cookie.
	 */
	private function handle_logout(): void {
		$this->token->clear_cookie();
		$this->settings->log( 'logout', $this->client_ip() );

		if ( ! headers_sent() ) {
			nocache_headers();
		}

		wp_safe_redirect( home_url( '/' ), 303 );
		exit;
	}

	/**
	 * Blocks programmatic entry points that WordPress does not route through
	 * `template_redirect`: AJAX and XML-RPC.
	 */
	public function block_direct_access(): void {
		if ( ! $this->settings->is_enabled() ) {
			return;
		}

		if ( ( defined( 'DOING_CRON' ) && DOING_CRON ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
			return;
		}

		$path = AccessRules::request_path();

		/**
		 * Filters the direct PHP endpoints that require an unlocked gate.
		 *
		 * @param array<int, string> $endpoints Paths.
		 */
		$endpoints = (array) apply_filters(
			'vaultgate_blocked_endpoints',
			array(
				'/wp-comments-post.php',
				'/wp-trackback.php',
				'/wp-mail.php',
				'/wp-signup.php',
				'/wp-activate.php',
				'/wp-admin/admin-post.php',
			)
		);

		$blocked = false;

		foreach ( $endpoints as $endpoint ) {
			$endpoint = '/' . ltrim( (string) $endpoint, '/' );

			if ( $path === $endpoint || str_ends_with( $path, $endpoint ) ) {
				$blocked = true;
				break;
			}
		}

		if ( $blocked && ! $this->is_bypassed() ) {
			$this->settings->log( 'endpoint_blocked', $this->client_ip() );
			$this->forbidden();
		}

		if ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) {
			if ( ! $this->is_bypassed() && $this->settings->get( 'protect_ajax' ) ) {
				$this->settings->log( 'ajax_blocked', $this->client_ip() );
				wp_send_json_error(
					array( 'message' => __( 'This site is password protected.', 'vaultgate' ) ),
					401
				);
			}

			return;
		}

		if ( function_exists( 'is_admin' ) && is_admin() ) {
			return;
		}

		if ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST && $this->settings->get( 'protect_xmlrpc' ) && ! $this->is_bypassed() ) {
			$this->settings->log( 'xmlrpc_blocked', $this->client_ip() );
			$this->forbidden();
		}
	}

	/**
	 * Minimal 403 response for non-HTML endpoints.
	 */
	private function forbidden(): void {
		if ( ! headers_sent() ) {
			status_header( 403 );
			header( 'Content-Type: text/plain; charset=utf-8' );
			header( 'X-Robots-Tag: noindex, nofollow' );
			nocache_headers();
		}

		echo 'Forbidden';
		exit;
	}

	/**
	 * Renders the gate on protected front-end requests.
	 */
	public function maybe_gate(): void {
		if ( ! $this->should_gate() ) {
			return;
		}

		$this->render_gate();
	}

	/**
	 * Whether this request must show the gate.
	 */
	public function should_gate(): bool {
		if ( ! $this->settings->is_enabled() ) {
			return false;
		}

		if ( ( defined( 'DOING_CRON' ) && DOING_CRON ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
			return false;
		}

		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
			return false;
		}

		if ( $this->is_bypassed() ) {
			return false;
		}

		if ( function_exists( 'is_admin' ) && is_admin() ) {
			return false;
		}

		if ( function_exists( 'is_feed' ) && is_feed() && ! $this->settings->get( 'protect_feeds' ) ) {
			return false;
		}

		if ( $this->is_sitemap_request() && ! $this->settings->get( 'protect_sitemaps' ) ) {
			return false;
		}

		/**
		 * Last chance to allow a request without the gate.
		 *
		 * @param bool $gate Whether to gate this request.
		 */
		return (bool) apply_filters( 'vaultgate_should_gate', true );
	}

	/**
	 * Shared bypass logic: capability, valid cookie, allowlisted IP, excluded path.
	 */
	public function is_bypassed(): bool {
		if ( null !== $this->bypassed ) {
			return $this->bypassed;
		}

		$bypassed = false;

		if ( defined( 'VAULTGATE_DISABLED' ) && VAULTGATE_DISABLED ) {
			$bypassed = true;
		} elseif ( function_exists( 'is_user_logged_in' ) && is_user_logged_in() ) {
			$capability = (string) $this->settings->get( 'bypass_capability', 'manage_options' );
			$bypassed   = current_user_can( 'manage_options' ) || ( '' !== $capability && current_user_can( $capability ) );
		}

		if ( ! $bypassed && $this->token->is_authenticated() ) {
			$bypassed = true;
		}

		if ( ! $bypassed ) {
			$ip = $this->client_ip();

			if ( '' !== $ip && AccessRules::ip_matches( $ip, (string) $this->settings->get( 'ip_allowlist', '' ) ) ) {
				$bypassed = true;
			}
		}

		if ( ! $bypassed && AccessRules::path_matches( AccessRules::request_path(), (string) $this->settings->get( 'exclude_paths', '' ) ) ) {
			$bypassed = true;
		}

		$this->bypassed = $bypassed;

		return $this->bypassed;
	}

	/**
	 * Resolves and filters the client IP once per request.
	 */
	private function client_ip(): string {
		if ( null === $this->ip ) {
			$ip = AccessRules::client_ip( (bool) $this->settings->get( 'trust_proxy' ) );

			/**
			 * Filters the visitor IP used for allowlisting and rate limiting.
			 *
			 * @param string $ip Detected IP.
			 */
			$ip = (string) apply_filters( 'vaultgate_client_ip', $ip );

			$this->ip = filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '';
		}

		return $this->ip;
	}

	/**
	 * Blocks anonymous REST requests.
	 *
	 * @param mixed $result Existing authentication result.
	 * @return mixed
	 */
	public function rest_authentication_errors( mixed $result ): mixed {
		if ( true === $result || is_wp_error( $result ) ) {
			return $result;
		}

		if ( ! $this->settings->is_enabled() || ! $this->settings->get( 'protect_rest' ) || $this->is_bypassed() ) {
			return $result;
		}

		$this->settings->log( 'rest_blocked', $this->client_ip() );

		return new \WP_Error(
			'vaultgate_rest_locked',
			__( 'This site is password protected. Authenticate on the site before using the REST API.', 'vaultgate' ),
			array( 'status' => 401 )
		);
	}

	/**
	 * Keeps search engines out while the gate is active.
	 *
	 * @param string $output Robots.txt content.
	 * @param bool   $public Whether the site is public.
	 */
	public function filter_robots_txt( string $output, bool $public ): string {
		if ( ! $this->settings->is_enabled() ) {
			return $output;
		}

		return "User-agent: *\nDisallow: /\n";
	}

	/**
	 * Whether the request targets the core sitemap.
	 */
	private function is_sitemap_request(): bool {
		if ( function_exists( 'get_query_var' ) && '' !== (string) get_query_var( 'sitemap' ) ) {
			return true;
		}

		return str_starts_with( AccessRules::request_path(), '/wp-sitemap' );
	}

	/**
	 * Sends security headers and renders the standalone gate page.
	 */
	private function render_gate(): void {
		$settings = $this->settings->all();
		$notice   = $this->notice_message();
		$nonce    = $this->csp_nonce();

		$theme = in_array( $settings['theme'], array( 'auto', 'light', 'dark' ), true ) ? $settings['theme'] : 'auto';
		$title = trim( (string) $settings['gate_title'] );

		if ( '' === $title ) {
			$title = __( 'Private site', 'vaultgate' );
		}

		$message = wp_kses_post( (string) $settings['gate_message'] );
		$logo    = esc_url_raw( (string) $settings['logo_url'] );
		$support = esc_url_raw( (string) $settings['support_url'] );
		$accent  = sanitize_hex_color( (string) $settings['accent'] );
		$accent  = $accent ? $accent : '#4f46e5';

		$site_name = wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES );
		$action    = add_query_arg( 'vaultgate', 'login', home_url( '/' ) );
		$redirect  = $this->requested_url();
		$token     = $this->token->form_token();
		$remember  = ! empty( $settings['remember_enabled'] );
		$days      = (int) $settings['remember_days'];
		$ink       = $this->contrast_ink( $accent );

		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}

		if ( ! defined( 'DONOTCACHEOBJECT' ) ) {
			define( 'DONOTCACHEOBJECT', true );
		}

		if ( ! headers_sent() ) {
			status_header( 401 );
			header( 'Content-Type: text/html; charset=utf-8' );
			header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private' );
			header( 'Pragma: no-cache' );
			header( 'Expires: Wed, 11 Jan 1984 05:00:00 GMT' );
			header( 'X-Robots-Tag: noindex, nofollow, noarchive' );
			header( 'Referrer-Policy: no-referrer' );
			header( 'X-Frame-Options: DENY' );
			header( 'X-Content-Type-Options: nosniff' );
			header( 'Vary: Cookie' );
			header(
				"Content-Security-Policy: default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; "
				. "img-src 'self' data: https:; style-src 'self' 'nonce-" . $nonce . "'; script-src 'self'; font-src 'self'; connect-src 'none'"
			);
		}

		$vg = array(
			'title'         => $title,
			'message'       => $message,
			'logo'          => $logo,
			'support'       => $support,
			'footer'        => (string) $settings['footer_note'],
			'accent'        => $accent,
			'accent_ink'    => $ink,
			'theme'         => $theme,
			'nonce'         => $nonce,
			'action'        => $action,
			'redirect'      => $redirect,
			'form_token'    => $token,
			'remember'      => $remember,
			'remember_days' => $days,
			'notice'        => $notice,
			'site_name'     => $site_name,
			'style_url'     => VAULTGATE_URL . 'assets/css/gate.css',
			'script_url'    => VAULTGATE_URL . 'assets/js/gate.js',
		);

		require VAULTGATE_DIR . 'templates/gate.php';
		exit;
	}

	/**
	 * Human-readable message for the `vaultgate_notice` query argument.
	 */
	private function notice_message(): string {
		$code = isset( $_GET['vaultgate_notice'] ) && is_string( $_GET['vaultgate_notice'] )
			? sanitize_key( wp_unslash( $_GET['vaultgate_notice'] ) )
			: '';

		$wait = isset( $_GET['vaultgate_wait'] ) && is_scalar( $_GET['vaultgate_wait'] ) ? absint( wp_unslash( $_GET['vaultgate_wait'] ) ) : 0;

		switch ( $code ) {
			case 'invalid':
				return __( 'Incorrect password. Please try again.', 'vaultgate' );
			case 'missing':
				return __( 'Please enter the password.', 'vaultgate' );
			case 'locked':
				if ( $wait > 0 ) {
					return 1 === $wait
						? __( 'Too many attempts. Try again in 1 minute.', 'vaultgate' )
						/* translators: %d: number of minutes. */
						: sprintf( __( 'Too many attempts. Try again in %d minutes.', 'vaultgate' ), $wait );
				}

				return __( 'Too many attempts. Please try again later.', 'vaultgate' );
			case 'expired':
				return __( 'Your session expired. Please try again.', 'vaultgate' );
			case 'cookie':
				return __( 'Your browser refused the session cookie. Enable cookies and try again.', 'vaultgate' );
			default:
				return '';
		}
	}

	/**
	 * Picks a readable text colour for the accent button.
	 *
	 * @param string $hex Accent colour, 6-digit hex.
	 */
	private function contrast_ink( string $hex ): string {
		$hex = ltrim( $hex, '#' );

		if ( 6 !== strlen( $hex ) ) {
			return '#ffffff';
		}

		$channels = array(
			hexdec( substr( $hex, 0, 2 ) ) / 255,
			hexdec( substr( $hex, 2, 2 ) ) / 255,
			hexdec( substr( $hex, 4, 2 ) ) / 255,
		);

		$linear = array_map(
			static function ( float $channel ): float {
				return $channel <= 0.04045 ? $channel / 12.92 : ( ( $channel + 0.055 ) / 1.055 ) ** 2.4;
			},
			$channels
		);

		$luminance = 0.2126 * $linear[0] + 0.7152 * $linear[1] + 0.0722 * $linear[2];

		return $luminance > 0.48 ? '#11131a' : '#ffffff';
	}

	/**
	 * Random nonce for the inline CSS variable block.
	 */
	private function csp_nonce(): string {
		try {
			return base64_encode( random_bytes( 18 ) );
		} catch ( \Throwable $e ) {
			return wp_generate_password( 24, false, false );
		}
	}

	/**
	 * Validated redirect target posted by the gate form.
	 */
	private function posted_target(): string {
		$raw = isset( $_POST['vaultgate_redirect'] ) && is_string( $_POST['vaultgate_redirect'] )
			? wp_unslash( $_POST['vaultgate_redirect'] )
			: '';

		$target = wp_validate_redirect( $raw, home_url( '/' ) );

		return remove_query_arg( array( 'vaultgate', 'vaultgate_notice', 'vaultgate_wait' ), $target );
	}

	/**
	 * Absolute URL of the current request, minus VaultGate arguments.
	 */
	private function requested_url(): string {
		$uri       = isset( $_SERVER['REQUEST_URI'] ) && is_string( $_SERVER['REQUEST_URI'] )
			? wp_unslash( $_SERVER['REQUEST_URI'] )
			: '/';
		$raw_path  = wp_parse_url( $uri, PHP_URL_PATH );
		$raw_path  = is_string( $raw_path ) && '' !== $raw_path ? $raw_path : '/';
		$home_path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		$base      = is_string( $home_path ) ? rtrim( $home_path, '/' ) : '';

		if ( '' !== $base && str_starts_with( $raw_path, $base ) ) {
			$raw_path = substr( $raw_path, strlen( $base ) );
		}

		$raw_path = '/' . ltrim( $raw_path, '/' );
		$url      = home_url( $raw_path );

		$query_string = isset( $_SERVER['QUERY_STRING'] ) && is_string( $_SERVER['QUERY_STRING'] )
			? wp_unslash( $_SERVER['QUERY_STRING'] )
			: '';

		if ( '' !== $query_string ) {
			$args = array();
			parse_str( $query_string, $args );

			unset( $args['vaultgate'], $args['vaultgate_notice'], $args['vaultgate_wait'] );

			if ( array() !== $args ) {
				$url = add_query_arg( $args, $url );
			}
		}

		return wp_validate_redirect( $url, home_url( '/' ) );
	}

	/**
	 * Redirects to the protected page with a notice.
	 *
	 * @param string $target  Validated target.
	 * @param string $code    Notice code.
	 * @param int    $seconds Lock-out remaining, in seconds.
	 */
	private function redirect_with_notice( string $target, string $code, int $seconds = 0 ): void {
		$url = add_query_arg( 'vaultgate_notice', $code, $target );

		if ( $seconds > 0 ) {
			$url = add_query_arg( 'vaultgate_wait', max( 1, (int) ceil( $seconds / MINUTE_IN_SECONDS ) ), $url );
		}

		$this->redirect( $url );
	}

	/**
	 * Safe redirect, then stop.
	 *
	 * @param string $url Destination.
	 */
	private function redirect( string $url ): void {
		if ( ! headers_sent() ) {
			nocache_headers();
		}

		wp_safe_redirect( $url, 303 );
		exit;
	}
}
