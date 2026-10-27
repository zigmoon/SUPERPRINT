<?php
/**
 * Pure access rules: client IP, CIDR ranges and path matching.
 *
 * @package VaultGate
 */

namespace VaultGate;

defined( 'ABSPATH' ) || exit;

/**
 * Stateless helpers used by the guard and fully unit-testable.
 */
final class AccessRules {

	/**
	 * Resolves the visitor IP address.
	 *
	 * Proxy headers are only read when the administrator explicitly enabled
	 * "trust proxy", because they are client-controlled otherwise.
	 *
	 * @param bool $trust_proxy Whether forwarded headers may be trusted.
	 */
	public static function client_ip( bool $trust_proxy ): string {
		$candidates = array();

		if ( $trust_proxy ) {
			foreach ( array( 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'HTTP_CF_CONNECTING_IP' ) as $header ) {
				if ( empty( $_SERVER[ $header ] ) || ! is_string( $_SERVER[ $header ] ) ) {
					continue;
				}

				foreach ( explode( ',', wp_unslash( $_SERVER[ $header ] ) ) as $candidate ) {
					$candidate = trim( $candidate, " \t\n\r\0\x0B\"" );
					if ( filter_var( $candidate, FILTER_VALIDATE_IP ) ) {
						$candidates[] = $candidate;
						break;
					}
				}
			}
		}

		if ( ! empty( $_SERVER['REMOTE_ADDR'] ) && is_string( $_SERVER['REMOTE_ADDR'] ) ) {
			$candidates[] = trim( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
		}

		foreach ( $candidates as $candidate ) {
			if ( filter_var( $candidate, FILTER_VALIDATE_IP ) ) {
				$binary    = inet_pton( $candidate );
				$canonical = false !== $binary ? inet_ntop( $binary ) : false;

				return false !== $canonical ? $canonical : $candidate;
			}
		}

		return '';
	}

	/**
	 * Whether an IP is present in a newline-separated allowlist.
	 *
	 * @param string $ip    Visitor IP.
	 * @param string $rules Allowlist (IPs and CIDR ranges).
	 */
	public static function ip_matches( string $ip, string $rules ): bool {
		if ( '' === $ip ) {
			return false;
		}

		foreach ( preg_split( '/\r\n|\r|\n/', $rules ) ?: array() as $rule ) {
			$rule = trim( (string) preg_replace( '/\s+#.*$/', '', (string) $rule ) );

			if ( '' === $rule ) {
				continue;
			}

			if ( str_contains( $rule, '/' ) ) {
				if ( self::ip_in_range( $ip, $rule ) ) {
					return true;
				}

				continue;
			}

			$left  = inet_pton( $ip );
			$right = inet_pton( $rule );

			if ( false !== $left && false !== $right && $left === $right ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Whether an IP belongs to a CIDR range (IPv4 or IPv6).
	 *
	 * @param string $ip    Visitor IP.
	 * @param string $range CIDR range.
	 */
	public static function ip_in_range( string $ip, string $range ): bool {
		$parts = explode( '/', $range, 2 );

		if ( 2 !== count( $parts ) || ! ctype_digit( $parts[1] ) ) {
			return false;
		}

		$ip_bin     = inet_pton( $ip );
		$subnet_bin = inet_pton( $parts[0] );

		if ( false === $ip_bin || false === $subnet_bin || strlen( $ip_bin ) !== strlen( $subnet_bin ) ) {
			return false;
		}

		$prefix = (int) $parts[1];
		$bits   = strlen( $ip_bin ) * 8;

		if ( $prefix < 0 || $prefix > $bits ) {
			return false;
		}

		$full_bytes = intdiv( $prefix, 8 );
		$remainder  = $prefix % 8;

		if ( $full_bytes > 0 && substr( $ip_bin, 0, $full_bytes ) !== substr( $subnet_bin, 0, $full_bytes ) ) {
			return false;
		}

		if ( 0 === $remainder ) {
			return true;
		}

		$mask = ( 0xFF << ( 8 - $remainder ) ) & 0xFF;

		return ( ord( $ip_bin[ $full_bytes ] ) & $mask ) === ( ord( $subnet_bin[ $full_bytes ] ) & $mask );
	}

	/**
	 * Path of the current request, decoded and normalised.
	 *
	 * @param string|null $uri Optional URI instead of the current request.
	 */
	public static function request_path( ?string $uri = null ): string {
		if ( null === $uri ) {
			$uri = isset( $_SERVER['REQUEST_URI'] ) && is_string( $_SERVER['REQUEST_URI'] )
				? wp_unslash( $_SERVER['REQUEST_URI'] )
				: '/';
		}

		$path = wp_parse_url( $uri, PHP_URL_PATH );

		if ( ! is_string( $path ) || '' === $path ) {
			return '/';
		}

		$path = rawurldecode( $path );
		$path = preg_replace( '#/+#', '/', $path );
		$path = is_string( $path ) ? $path : '/';

		return '/' . ltrim( $path, '/' );
	}

	/**
	 * Whether the current path is excluded by one of the rules.
	 *
	 * Rules are path prefixes; `*` is accepted as a wildcard. For example:
	 * `/robots.txt`, `/api/*`, `/preview*`.
	 *
	 * @param string $path     Normalised request path.
	 * @param string $patterns Newline-separated rules.
	 */
	public static function path_matches( string $path, string $patterns ): bool {
		$path = '' === $path ? '/' : $path;
		$path = '/' === $path ? '/' : rtrim( $path, '/' );

		foreach ( preg_split( '/\r\n|\r|\n/', $patterns ) ?: array() as $pattern ) {
			$pattern = trim( (string) $pattern );

			if ( '' === $pattern || str_starts_with( $pattern, '#' ) ) {
				continue;
			}

			$pattern = '/' . ltrim( $pattern, '/' );

			if ( str_contains( $pattern, '*' ) ) {
				$regex = '#^' . str_replace( '\*', '.*', preg_quote( $pattern, '#' ) ) . '$#D';

				if ( str_ends_with( $pattern, '/*' ) && $path === substr( $pattern, 0, -2 ) ) {
					return true;
				}

				if ( 1 === preg_match( $regex, $path ) ) {
					return true;
				}

				continue;
			}

			$pattern = '/' === $pattern ? '/' : rtrim( $pattern, '/' );

			if ( $path === $pattern || str_starts_with( $path, $pattern . '/' ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * HTTPS detection, optionally trusting a reverse proxy.
	 *
	 * @param bool $trust_proxy Whether forwarded headers may be trusted.
	 */
	public static function is_https( bool $trust_proxy ): bool {
		if ( function_exists( 'is_ssl' ) && is_ssl() ) {
			return true;
		}

		if ( ! $trust_proxy ) {
			return false;
		}

		$proto = isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && is_string( $_SERVER['HTTP_X_FORWARDED_PROTO'] )
			? strtolower( trim( explode( ',', wp_unslash( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) )[0] ) )
			: '';

		if ( 'https' === $proto ) {
			return true;
		}

		$ssl = isset( $_SERVER['HTTP_X_FORWARDED_SSL'] ) && is_string( $_SERVER['HTTP_X_FORWARDED_SSL'] )
			? strtolower( trim( wp_unslash( $_SERVER['HTTP_X_FORWARDED_SSL'] ) ) )
			: '';

		return 'on' === $ssl;
	}
}
