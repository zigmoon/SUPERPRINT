<?php
/**
 * Uninstall routine.
 *
 * Data is only removed when the administrator opted in with the
 * "Delete all plugin data" setting.
 *
 * @package VaultGate
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$vaultgate_options = array(
	'vaultgate_settings',
	'vaultgate_password_hash',
	'vaultgate_auth_version',
	'vaultgate_password_changed',
	'vaultgate_log',
	'vaultgate_version',
);

$vaultgate_cleanup = static function () use ( $vaultgate_options ): void {
	$settings = get_option( 'vaultgate_settings', array() );

	if ( ! is_array( $settings ) || empty( $settings['delete_data'] ) ) {
		return;
	}

	foreach ( $vaultgate_options as $option ) {
		delete_option( $option );
	}
};

if ( is_multisite() && function_exists( 'get_sites' ) ) {
	$sites = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);

	foreach ( $sites as $site_id ) {
		switch_to_blog( (int) $site_id );
		$vaultgate_cleanup();
		restore_current_blog();
	}
} else {
	$vaultgate_cleanup();
}
