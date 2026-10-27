<?php
/**
 * Per-IP brute-force throttling backed by transients.
 *
 * @package VaultGate
 */

namespace VaultGate;

defined( 'ABSPATH' ) || exit;

/**
 * Sliding-window limiter. The IP is never stored in clear text in the options
 * table: the transient key contains an HMAC of the address.
 */
final class RateLimiter {

	/**
	 * Maximum failures inside the window.
	 *
	 * @var int
	 */
	private int $max_attempts;

	/**
	 * Lock-out duration, in minutes.
	 *
	 * @var int
	 */
	private int $lockout_minutes;

	/**
	 * Constructor.
	 *
	 * @param int $max_attempts   Failures allowed before lock-out.
	 * @param int $lockout_minutes Lock-out duration in minutes.
	 */
	public function __construct( int $max_attempts, int $lockout_minutes ) {
		$this->max_attempts    = max( 1, $max_attempts );
		$this->lockout_minutes = max( 1, $lockout_minutes );
	}

	/**
	 * Seconds left before another attempt is allowed.
	 *
	 * @param string $ip Visitor IP.
	 */
	public function seconds_remaining( string $ip ): int {
		$data = $this->read( $ip );
		$now  = time();

		if ( ! empty( $data['locked_until'] ) && (int) $data['locked_until'] > $now ) {
			return (int) $data['locked_until'] - $now;
		}

		return 0;
	}

	/**
	 * Records a failed attempt and returns the remaining lock-out, if any.
	 *
	 * @param string $ip Visitor IP.
	 */
	public function register_failure( string $ip ): int {
		$data = $this->read( $ip );
		$now  = time();

		if ( empty( $data['window_started'] ) || ( $now - (int) $data['window_started'] ) > $this->lockout_minutes * MINUTE_IN_SECONDS ) {
			$data = array(
				'attempts'       => 0,
				'window_started' => $now,
				'locked_until'   => 0,
			);
		}

		$data['attempts'] = (int) $data['attempts'] + 1;

		if ( $data['attempts'] >= $this->max_attempts ) {
			$data['locked_until'] = $now + $this->lockout_minutes * MINUTE_IN_SECONDS;
			$data['attempts']     = 0;
			$data['window_started'] = $now;
		}

		$ttl = $this->lockout_minutes * MINUTE_IN_SECONDS * 2;
		set_transient( $this->key( $ip ), $data, $ttl );

		return $this->seconds_remaining( $ip );
	}

	/**
	 * Forgets the failures for an IP (successful login).
	 *
	 * @param string $ip Visitor IP.
	 */
	public function clear( string $ip ): void {
		delete_transient( $this->key( $ip ) );
	}

	/**
	 * Reads the transient payload.
	 *
	 * @param string $ip Visitor IP.
	 * @return array<string, int>
	 */
	private function read( string $ip ): array {
		$data = get_transient( $this->key( $ip ) );

		if ( ! is_array( $data ) ) {
			return array();
		}

		return array(
			'attempts'       => (int) ( $data['attempts'] ?? 0 ),
			'window_started' => (int) ( $data['window_started'] ?? 0 ),
			'locked_until'   => (int) ( $data['locked_until'] ?? 0 ),
		);
	}

	/**
	 * Transient name derived from an HMAC of the IP.
	 *
	 * @param string $ip Visitor IP.
	 */
	private function key( string $ip ): string {
		$salt = function_exists( 'wp_salt' ) ? (string) wp_salt( 'nonce' ) : 'vaultgate';
		$hash = hash_hmac( 'sha256', strtolower( $ip ), $salt . '|vaultgate-rate' );

		return 'vaultgate_rl_' . substr( $hash, 0, 40 );
	}
}
