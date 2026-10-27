<?php
/**
 * Minimal WordPress stubs used by the standalone test suite.
 *
 * @package VaultGate
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'VAULTGATE_VERSION', '1.0.0' );
define( 'VAULTGATE_URL', 'https://example.test/wp-content/plugins/vaultgate/' );
define( 'VAULTGATE_DIR', dirname( __DIR__ ) . '/vaultgate/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );
define( 'YEAR_IN_SECONDS', 31536000 );

$GLOBALS['vg_options']    = array();
$GLOBALS['vg_transients'] = array();
$GLOBALS['vg_filters']    = array();
$GLOBALS['vg_actions']    = array();

function get_option( $name, $default = false ) {
	return array_key_exists( $name, $GLOBALS['vg_options'] ) ? $GLOBALS['vg_options'][ $name ] : $default;
}

function update_option( $name, $value, $autoload = null ) {
	$GLOBALS['vg_options'][ $name ] = $value;

	return true;
}

function add_option( $name, $value = '', $deprecated = '', $autoload = 'yes' ) {
	if ( ! array_key_exists( $name, $GLOBALS['vg_options'] ) ) {
		$GLOBALS['vg_options'][ $name ] = $value;
	}

	return true;
}

function delete_option( $name ) {
	unset( $GLOBALS['vg_options'][ $name ] );

	return true;
}

function get_transient( $name ) {
	if ( ! isset( $GLOBALS['vg_transients'][ $name ] ) ) {
		return false;
	}

	$entry = $GLOBALS['vg_transients'][ $name ];

	if ( $entry['expires'] > 0 && $entry['expires'] < time() ) {
		unset( $GLOBALS['vg_transients'][ $name ] );

		return false;
	}

	return $entry['value'];
}

function set_transient( $name, $value, $ttl = 0 ) {
	$GLOBALS['vg_transients'][ $name ] = array(
		'value'   => $value,
		'expires' => $ttl > 0 ? time() + $ttl : 0,
	);

	return true;
}

function delete_transient( $name ) {
	unset( $GLOBALS['vg_transients'][ $name ] );

	return true;
}

function wp_salt( $scheme = 'auth' ) {
	return 'test-salt-' . $scheme;
}

function wp_hash_password( $password ) {
	return password_hash( $password, PASSWORD_BCRYPT );
}

function wp_check_password( $password, $hash ) {
	return password_verify( $password, $hash );
}

function wp_privacy_anonymize_ip( $ip ) {
	if ( filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 ) ) {
		$parts    = explode( '.', $ip );
		$parts[3] = '0';

		return implode( '.', $parts );
	}

	return $ip;
}

function sanitize_text_field( $value ) {
	return trim( strip_tags( (string) $value ) );
}

function sanitize_key( $value ) {
	return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $value ) );
}

function sanitize_hex_color( $value ) {
	return preg_match( '/^#([0-9a-f]{3}|[0-9a-f]{6})$/i', (string) $value ) ? (string) $value : null;
}

function esc_url_raw( $value ) {
	$value = trim( (string) $value );

	if ( str_starts_with( $value, 'mailto:' ) ) {
		return $value;
	}

	return filter_var( $value, FILTER_VALIDATE_URL ) ? $value : '';
}

function absint( $value ) {
	return abs( (int) $value );
}

function wp_parse_url( $url, $component = -1 ) {
	return -1 === $component ? parse_url( $url ) : parse_url( $url, $component );
}

function wp_unslash( $value ) {
	if ( is_array( $value ) ) {
		return array_map( 'wp_unslash', $value );
	}

	return stripslashes( (string) $value );
}

function wp_json_encode( $value ) {
	return json_encode( $value );
}

function wp_date( $format, $timestamp = null ) {
	return date( $format, $timestamp ?? time() );
}

function current_time( $type ) {
	return 'timestamp' === $type ? time() : date( 'Y-m-d H:i:s' );
}

function is_ssl() {
	return false;
}

function home_url( $path = '' ) {
	return 'https://example.test' . ( '' !== $path ? $path : '/' );
}

function admin_url( $path = '' ) {
	return 'https://example.test/wp-admin/' . ltrim( (string) $path, '/' );
}

function plugin_dir_path( $file ) {
	return rtrim( dirname( $file ), '/\\' ) . '/';
}

function plugin_dir_url( $file ) {
	return VAULTGATE_URL;
}

function plugin_basename( $file ) {
	return 'vaultgate/vaultgate.php';
}

function __( $text, $domain = null ) {
	return $text;
}

function esc_html__( $text, $domain = null ) {
	return esc_html( $text );
}

function esc_attr__( $text, $domain = null ) {
	return esc_attr( $text );
}

function esc_html_e( $text, $domain = null ) {
	echo esc_html( $text );
}

function esc_attr_e( $text, $domain = null ) {
	echo esc_attr( $text );
}

function _e( $text, $domain = null ) {
	echo $text;
}

function _x( $text, $context, $domain = null ) {
	return $text;
}

function _n( $single, $plural, $number, $domain = null ) {
	return 1 === (int) $number ? $single : $plural;
}

function esc_html( $value ) {
	return htmlspecialchars( (string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
}

function esc_attr( $value ) {
	return esc_html( $value );
}

function esc_url( $value ) {
	return htmlspecialchars( (string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
}

function esc_textarea( $value ) {
	return esc_html( $value );
}

function wp_kses_post( $value ) {
	return (string) preg_replace( '#<script\b[^>]*>.*?</script>#is', '', (string) $value );
}

function wpautop( $value ) {
	return '<p>' . nl2br( (string) $value ) . '</p>';
}

function get_bloginfo( $show = '' ) {
	return 'charset' === $show ? 'UTF-8' : 'Test Site';
}

function bloginfo( $show = '' ) {
	echo get_bloginfo( $show );
}

function language_attributes() {
	echo 'lang="fr-FR"';
}

function wp_specialchars_decode( $value, $quote = ENT_NOQUOTES ) {
	return htmlspecialchars_decode( (string) $value, $quote );
}

function wp_generate_password( $length = 12, $special = true, $extra = false ) {
	return substr( str_repeat( 'Ab3xY7z', 20 ), 0, $length );
}

function add_query_arg( ...$args ) {
	if ( is_array( $args[0] ) ) {
		$params = $args[0];
		$url    = $args[1] ?? '';
	} else {
		$params = array( $args[0] => $args[1] );
		$url    = $args[2] ?? '';
	}

	$url      = (string) $url;
	$fragment = '';

	if ( str_contains( $url, '#' ) ) {
		list( $url, $fragment ) = explode( '#', $url, 2 );
		$fragment               = '#' . $fragment;
	}

	return $url . ( str_contains( $url, '?' ) ? '&' : '?' ) . http_build_query( $params ) . $fragment;
}

function remove_query_arg( $keys, $url = false ) {
	$url   = (string) $url;
	$parts = explode( '?', $url, 2 );

	if ( 1 === count( $parts ) ) {
		return $url;
	}

	parse_str( $parts[1], $args );

	foreach ( (array) $keys as $key ) {
		unset( $args[ $key ] );
	}

	return $parts[0] . ( array() !== $args ? '?' . http_build_query( $args ) : '' );
}

function wp_validate_redirect( $location, $fallback = '' ) {
	return '' !== (string) $location ? (string) $location : $fallback;
}

function wp_safe_redirect( $url, $status = 302 ) {
	return true;
}

function add_action( $tag, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['vg_actions'][ $tag ][ $priority ][] = $callback;

	return true;
}

function add_filter( $tag, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['vg_filters'][ $tag ][ $priority ][] = $callback;

	return true;
}

function do_action( $tag, ...$args ) {
	if ( empty( $GLOBALS['vg_actions'][ $tag ] ) ) {
		return;
	}

	ksort( $GLOBALS['vg_actions'][ $tag ] );

	foreach ( $GLOBALS['vg_actions'][ $tag ] as $callbacks ) {
		foreach ( $callbacks as $callback ) {
			call_user_func_array( $callback, $args );
		}
	}
}

function apply_filters( $tag, $value, ...$args ) {
	if ( empty( $GLOBALS['vg_filters'][ $tag ] ) ) {
		return $value;
	}

	ksort( $GLOBALS['vg_filters'][ $tag ] );

	foreach ( $GLOBALS['vg_filters'][ $tag ] as $callbacks ) {
		foreach ( $callbacks as $callback ) {
			$value = call_user_func_array( $callback, array_merge( array( $value ), $args ) );
		}
	}

	return $value;
}

function load_plugin_textdomain( $domain, $deprecated = false, $plugin_rel_path = false ) {
	return true;
}

function register_activation_hook( $file, $callback ) {
	return true;
}

function register_deactivation_hook( $file, $callback ) {
	return true;
}

function is_user_logged_in() {
	return (bool) ( $GLOBALS['vg_is_logged_in'] ?? false );
}

function current_user_can( $capability ) {
	return (bool) ( $GLOBALS['vg_current_user_can'] ?? false );
}

function is_admin() {
	return (bool) ( $GLOBALS['vg_is_admin'] ?? false );
}

function is_feed() {
	return false;
}

function get_query_var( $name ) {
	return '';
}

function wp_doing_ajax() {
	return false;
}

function wp_doing_cron() {
	return false;
}

function is_wp_error( $thing ) {
	return $thing instanceof WP_Error;
}

function status_header( $code ) {
	return true;
}

function nocache_headers() {
	return true;
}

function wp_nonce_field( $action = -1, $name = '_wpnonce', $referer = true, $echo = true ) {
	$html = '<input type="hidden" name="' . esc_attr( $name ) . '" value="test-nonce">';

	if ( $echo ) {
		echo $html;
	}

	return $html;
}

function submit_button( $text = null, $type = 'primary', $name = 'submit', $wrap = true, $other_attributes = null ) {
	echo '<input type="submit" class="button button-' . esc_attr( $type ) . '" name="' . esc_attr( $name ) . '" value="' . esc_attr( (string) $text ) . '">';
}

function checked( $checked, $current = true, $display = true ) {
	$result = (string) $checked === (string) $current ? " checked='checked'" : '';

	if ( $display ) {
		echo $result;
	}

	return $result;
}

function selected( $selected, $current = true, $display = true ) {
	$result = (string) $selected === (string) $current ? " selected='selected'" : '';

	if ( $display ) {
		echo $result;
	}

	return $result;
}

function wp_die( $message = '', $title = '', $args = array() ) {
	throw new RuntimeException( 'wp_die: ' . ( is_string( $message ) ? $message : '' ) );
}

function wp_send_json_error( $data = null, $status_code = null ) {
	throw new RuntimeException( 'JSON error response: ' . wp_json_encode( $data ) );
}

class WP_Error {

	public function __construct( private string $code = '', private string $message = '', private array $data = array() ) {
	}
}
