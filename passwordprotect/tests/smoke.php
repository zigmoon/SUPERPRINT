<?php
/**
 * Integration smoke test: boots the plugin with WordPress stubs.
 *
 * Run with: php tests/smoke.php
 *
 * @package VaultGate
 */

require_once __DIR__ . '/bootstrap.php';
require_once dirname( __DIR__ ) . '/vaultgate/vaultgate.php';

$GLOBALS['vg_smoke_pass'] = 0;
$GLOBALS['vg_smoke_fail'] = 0;

function vg_smoke_assert( bool $condition, string $message ): void {
	if ( $condition ) {
		++$GLOBALS['vg_smoke_pass'];
		return;
	}

	++$GLOBALS['vg_smoke_fail'];
	echo "FAIL: {$message}\n";
}

$_SERVER = array(
	'REQUEST_URI'    => '/',
	'REMOTE_ADDR'    => '203.0.113.10',
	'HTTP_HOST'      => 'example.test',
	'REQUEST_METHOD' => 'GET',
);

do_action( 'plugins_loaded' );
do_action( 'init' );
do_action( 'template_redirect' );

vg_smoke_assert( true, 'plugin boots without a fatal error' );

VaultGate\Plugin::activate();
vg_smoke_assert( 1 === (int) get_option( 'vaultgate_auth_version' ), 'activation stores the auth version' );

$settings = new VaultGate\Settings();
$settings->set_password( 'a long enough password' );
$settings->update( array( 'enabled' => true ) );

vg_smoke_assert( $settings->is_enabled(), 'enabled + password = active' );

$_SERVER['REQUEST_URI'] = '/private';
$guard                  = new VaultGate\Guard( $settings );
vg_smoke_assert( $guard->should_gate(), 'a normal page is gated' );

$_SERVER['REQUEST_URI'] = '/robots.txt';
$guard                  = new VaultGate\Guard( $settings );
vg_smoke_assert( ! $guard->should_gate(), 'excluded path bypasses the gate' );

$_SERVER['REQUEST_URI'] = '/wp-json/wp/v2/posts';
$guard                  = new VaultGate\Guard( $settings );
vg_smoke_assert( is_wp_error( $guard->rest_authentication_errors( null ) ), 'anonymous REST request is blocked' );

$token                         = new VaultGate\Token( $settings );
$_COOKIE['vaultgate_auth']     = $token->issue( time() + 3600 );
$guard                         = new VaultGate\Guard( $settings );
vg_smoke_assert( ! $guard->should_gate(), 'a valid gate cookie bypasses the gate' );
vg_smoke_assert( null === $guard->rest_authentication_errors( null ), 'a valid gate cookie bypasses REST' );

unset( $_COOKIE['vaultgate_auth'] );

$settings->update( array( 'ip_allowlist' => '203.0.113.10' ) );
$_SERVER['REQUEST_URI'] = '/private';
$guard                  = new VaultGate\Guard( $settings );
vg_smoke_assert( ! $guard->should_gate(), 'an allowlisted IP bypasses the gate' );

$settings->update( array( 'ip_allowlist' => '' ) );
$settings->update( array( 'protect_rest' => false ) );
$_SERVER['REQUEST_URI'] = '/wp-json/wp/v2/posts';
$guard                  = new VaultGate\Guard( $settings );
vg_smoke_assert( null === $guard->rest_authentication_errors( null ), 'REST can be left open' );

$settings->update( array( 'protect_rest' => true ) );

( new VaultGate\Admin( $settings ) )->hooks();
vg_smoke_assert( true, 'admin hooks register without a fatal error' );

$GLOBALS['vg_current_user_can'] = true;
$_GET['page']                   = 'vaultgate';

ob_start();
( new VaultGate\Admin( $settings ) )->render();
$admin_html = (string) ob_get_clean();

vg_smoke_assert( str_contains( $admin_html, 'role="tablist"' ), 'admin tabs render' );
vg_smoke_assert( str_contains( $admin_html, 'name="vaultgate[enabled]"' ), 'master switch renders' );
vg_smoke_assert( str_contains( $admin_html, 'name="vaultgate_new_password"' ), 'password field renders' );
vg_smoke_assert( str_contains( $admin_html, 'name="vaultgate[ip_allowlist]"' ), 'IP allowlist renders' );
vg_smoke_assert( str_contains( $admin_html, 'id="vg-clear-log"' ), 'clear-log form renders' );
vg_smoke_assert( str_contains( $admin_html, 'id="vg-panel-activity"' ), 'activity panel renders' );

$_GET['vg_error'] = 'password_short,password_mismatch';
ob_start();
( new VaultGate\Admin( $settings ) )->notices();
$notices_html = (string) ob_get_clean();

vg_smoke_assert( str_contains( $notices_html, 'at least 8 characters' ), 'password length error is shown' );
vg_smoke_assert( str_contains( $notices_html, 'do not match' ), 'password mismatch error is shown' );

define( 'VAULTGATE_DISABLED', true );
vg_smoke_assert( ! $settings->is_enabled(), 'VAULTGATE_DISABLED disables the gate' );

echo "\n" . $GLOBALS['vg_smoke_pass'] . ' passed, ' . $GLOBALS['vg_smoke_fail'] . " failed\n";

exit( $GLOBALS['vg_smoke_fail'] > 0 ? 1 : 0 );
