<?php
/**
 * WP-CLI commands, useful when the site is locked out.
 *
 * @package VaultGate
 */

namespace VaultGate;

defined( 'ABSPATH' ) || exit;

/**
 * `wp vaultgate` commands.
 */
final class Cli {

	/**
	 * Settings.
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
	 * Registers the command with WP-CLI.
	 *
	 * @param Settings $settings Settings instance.
	 */
	public static function register( Settings $settings ): void {
		if ( ! class_exists( '\WP_CLI' ) ) {
			return;
		}

		\WP_CLI::add_command( 'vaultgate', new self( $settings ) );
	}

	/**
	 * Shows the current protection status.
	 *
	 * ## EXAMPLES
	 *
	 *     wp vaultgate status
	 */
	public function status(): void {
		$settings = $this->settings->all();
		$rows     = array(
			array( __( 'Protection', 'vaultgate' ), $this->settings->is_enabled() ? __( 'active', 'vaultgate' ) : __( 'inactive', 'vaultgate' ) ),
			array( __( 'Password set', 'vaultgate' ), $this->settings->has_password() ? __( 'yes', 'vaultgate' ) : __( 'no', 'vaultgate' ) ),
			array( __( 'Session version', 'vaultgate' ), (string) $this->settings->auth_version() ),
			array( __( 'Session duration', 'vaultgate' ), sprintf( __( '%d days', 'vaultgate' ), (int) $settings['session_days'] ) ),
			array( __( 'Remember me', 'vaultgate' ), $settings['remember_enabled'] ? sprintf( __( '%d days', 'vaultgate' ), (int) $settings['remember_days'] ) : __( 'disabled', 'vaultgate' ) ),
			array( __( 'REST API', 'vaultgate' ), $settings['protect_rest'] ? __( 'protected', 'vaultgate' ) : __( 'open', 'vaultgate' ) ),
			array( __( 'Feeds', 'vaultgate' ), $settings['protect_feeds'] ? __( 'protected', 'vaultgate' ) : __( 'open', 'vaultgate' ) ),
			array( __( 'Sitemaps', 'vaultgate' ), $settings['protect_sitemaps'] ? __( 'protected', 'vaultgate' ) : __( 'open', 'vaultgate' ) ),
			array( __( 'Bypass capability', 'vaultgate' ), (string) $settings['bypass_capability'] ),
		);

		foreach ( $rows as $row ) {
			\WP_CLI::line( sprintf( '%-20s %s', $row[0], $row[1] ) );
		}
	}

	/**
	 * Turns protection on. A password must already be set.
	 *
	 * ## EXAMPLES
	 *
	 *     wp vaultgate enable
	 */
	public function enable(): void {
		if ( ! $this->settings->has_password() ) {
			\WP_CLI::error( __( 'Set a password first: wp vaultgate password <password>', 'vaultgate' ) );
		}

		$was_enabled = $this->settings->is_enabled();
		$this->settings->update( array( 'enabled' => true ) );

		if ( ! $was_enabled ) {
			$this->settings->bump_auth_version();
		}

		$this->settings->log( 'settings_saved' );
		\WP_CLI::success( __( 'Protection enabled.', 'vaultgate' ) );
	}

	/**
	 * Turns protection off without deleting the password.
	 *
	 * ## EXAMPLES
	 *
	 *     wp vaultgate disable
	 */
	public function disable(): void {
		$was_enabled = $this->settings->is_enabled();
		$this->settings->update( array( 'enabled' => false ) );

		if ( $was_enabled ) {
			$this->settings->bump_auth_version();
		}

		$this->settings->log( 'settings_saved' );
		\WP_CLI::success( __( 'Protection disabled.', 'vaultgate' ) );
	}

	/**
	 * Sets the site password.
	 *
	 * ## OPTIONS
	 *
	 * [<password>]
	 * : The new password (minimum 8 characters).
	 *
	 * [--stdin]
	 * : Read the password from standard input instead of the argument.
	 *
	 * ## EXAMPLES
	 *
	 *     wp vaultgate password 'correct horse battery staple'
	 *     echo 'a long passphrase' | wp vaultgate password --stdin
	 *
	 * @param array<int, string>    $args       Positional arguments.
	 * @param array<string, string> $assoc_args Associative arguments.
	 */
	public function password( array $args, array $assoc_args ): void {
		$password = $args[0] ?? '';

		if ( ! empty( $assoc_args['stdin'] ) ) {
			$password = trim( (string) stream_get_contents( STDIN ) );
		}

		if ( '' === $password ) {
			\WP_CLI::error( __( 'Provide a password, or use --stdin.', 'vaultgate' ) );
		}

		if ( ! Settings::is_password_long_enough( $password ) ) {
			\WP_CLI::error( __( 'The password must be at least 8 characters long.', 'vaultgate' ) );
		}
		if ( ! $this->settings->set_password( $password ) ) {
			\WP_CLI::error( __( 'The password could not be stored.', 'vaultgate' ) );
		}

		$this->settings->log( 'password_changed' );
		\WP_CLI::success( __( 'Password updated. Every existing session has been revoked.', 'vaultgate' ) );
	}

	/**
	 * Revokes every gate cookie.
	 *
	 * ## EXAMPLES
	 *
	 *     wp vaultgate logout-all
	 *
	 * @subcommand logout-all
	 */
	public function logout_all(): void {
		$this->settings->bump_auth_version();
		$this->settings->log( 'logout_all' );
		\WP_CLI::success( __( 'Every existing session has been revoked.', 'vaultgate' ) );
	}

	/**
	 * Shows or clears the activity log.
	 *
	 * ## OPTIONS
	 *
	 * [--clear]
	 * : Clear the log instead of printing it.
	 *
	 * ## EXAMPLES
	 *
	 *     wp vaultgate log
	 *     wp vaultgate log --clear
	 *
	 * @param array<int, string>    $args       Positional arguments.
	 * @param array<string, string> $assoc_args Associative arguments.
	 */
	public function log( array $args, array $assoc_args ): void {
		if ( ! empty( $assoc_args['clear'] ) ) {
			$this->settings->clear_log();
			\WP_CLI::success( __( 'Activity log cleared.', 'vaultgate' ) );

			return;
		}

		$logs = $this->settings->logs();

		if ( array() === $logs ) {
			\WP_CLI::line( __( 'No activity recorded yet.', 'vaultgate' ) );

			return;
		}

		foreach ( $logs as $entry ) {
			\WP_CLI::line(
				sprintf(
					'%s  %-26s %-20s %s',
					wp_date( 'Y-m-d H:i:s', (int) $entry['time'] ),
					(string) $entry['event'],
					'' !== (string) $entry['ip'] ? (string) $entry['ip'] : '—',
					(string) $entry['agent']
				)
			);
		}
	}
}
