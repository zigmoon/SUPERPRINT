<?php
/**
 * Router for tests/preview.php: serves plugin assets, falls back to the preview.
 *
 * @package VaultGate
 */

$vg_path = (string) parse_url( $_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH );
$vg_file = dirname( __DIR__ ) . $vg_path;

if ( str_starts_with( $vg_path, '/vaultgate/assets/' ) && is_file( $vg_file ) ) {
	return false;
}

require __DIR__ . '/preview.php';
