<?php
/**
 * Local visual preview of the gate page (development only).
 *
 * Usage:
 *   php -S 127.0.0.1:8450 tests/preview-router.php
 *
 * @package VaultGate
 */

require_once __DIR__ . '/bootstrap.php';

$vg = array(
	'title'         => 'Site privé',
	'message'       => 'Ce site est en cours de construction. Saisissez le mot de passe pour continuer.',
	'logo'          => '',
	'support'       => 'mailto:hello@example.test',
	'footer'        => 'VaultGate · aperçu local',
	'accent'        => '#4f46e5',
	'accent_ink'    => '#ffffff',
	'theme'         => 'auto',
	'nonce'         => 'preview-nonce',
	'action'        => 'http://127.0.0.1:8450/?vaultgate=login',
	'redirect'      => 'http://127.0.0.1:8450/',
	'form_token'    => '1234567890.' . str_repeat( 'a', 64 ),
	'remember'      => true,
	'remember_days' => 30,
	'notice'        => 'Mot de passe incorrect. Veuillez réessayer.',
	'site_name'     => 'Studio Zigmoon',
	'style_url'     => 'http://127.0.0.1:8450/vaultgate/assets/css/gate.css',
	'script_url'    => 'http://127.0.0.1:8450/vaultgate/assets/js/gate.js',
);

require VAULTGATE_DIR . 'templates/gate.php';
