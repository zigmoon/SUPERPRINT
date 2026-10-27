<?php
/**
 * Admin settings screen, save handler and notices.
 *
 * @package VaultGate
 */

namespace VaultGate;

defined( 'ABSPATH' ) || exit;

/**
 * Everything that runs inside wp-admin.
 */
final class Admin {

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
	 * Registers hooks.
	 */
	public function hooks(): void {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_post_vaultgate_save', array( $this, 'handle_save' ) );
		add_action( 'admin_post_vaultgate_clear_log', array( $this, 'handle_clear_log' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
		add_action( 'admin_bar_menu', array( $this, 'admin_bar' ), 100 );
		add_action( 'admin_notices', array( $this, 'notices' ) );
		add_filter( 'plugin_action_links_' . VAULTGATE_BASENAME, array( $this, 'action_links' ) );
	}

	/**
	 * Adds the settings page under Settings.
	 */
	public function menu(): void {
		add_options_page(
			__( 'VaultGate', 'vaultgate' ),
			__( 'VaultGate', 'vaultgate' ),
			'manage_options',
			'vaultgate',
			array( $this, 'render' )
		);
	}

	/**
	 * Loads assets only on the settings screen.
	 *
	 * @param string $hook Current admin page hook.
	 */
	public function enqueue( string $hook ): void {
		if ( 'settings_page_vaultgate' !== $hook ) {
			return;
		}

		wp_enqueue_style( 'vaultgate-admin', VAULTGATE_URL . 'assets/css/admin.css', array(), VAULTGATE_VERSION );
		wp_enqueue_script( 'vaultgate-admin', VAULTGATE_URL . 'assets/js/admin.js', array(), VAULTGATE_VERSION, true );
	}

	/**
	 * Adds a Settings link on the Plugins screen.
	 *
	 * @param array<int, string> $links Existing links.
	 * @return array<int, string>
	 */
	public function action_links( array $links ): array {
		$links[] = '<a href="' . esc_url( admin_url( 'options-general.php?page=vaultgate' ) ) . '">' . esc_html__( 'Settings', 'vaultgate' ) . '</a>';

		return $links;
	}

	/**
	 * Adds a compact status entry to the admin bar.
	 *
	 * @param \WP_Admin_Bar $bar Admin bar instance.
	 */
	public function admin_bar( $bar ): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$active = $this->settings->is_enabled();

		$bar->add_node(
			array(
				'id'    => 'vaultgate',
				'title' => $active
					? __( 'VaultGate · active', 'vaultgate' )
					: __( 'VaultGate · inactive', 'vaultgate' ),
				'href'  => admin_url( 'options-general.php?page=vaultgate' ),
				'meta'  => array(
					'title' => __( 'Open VaultGate settings', 'vaultgate' ),
				),
			)
		);
	}

	/**
	 * Handles the settings form.
	 */
	public function handle_save(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to change these settings.', 'vaultgate' ), '', array( 'response' => 403 ) );
		}

		check_admin_referer( 'vaultgate_save' );

		$input = isset( $_POST['vaultgate'] ) && is_array( $_POST['vaultgate'] )
			? wp_unslash( $_POST['vaultgate'] )
			: array();

		$was_enabled = $this->settings->is_enabled();
		$clean       = Settings::sanitize( $input );
		$errors      = array();

		$password = isset( $_POST['vaultgate_new_password'] ) && is_string( $_POST['vaultgate_new_password'] )
			? wp_unslash( $_POST['vaultgate_new_password'] )
			: '';
		$confirm  = isset( $_POST['vaultgate_confirm_password'] ) && is_string( $_POST['vaultgate_confirm_password'] )
			? wp_unslash( $_POST['vaultgate_confirm_password'] )
			: '';

		$changed = false;

		if ( '' !== $password || '' !== $confirm ) {
			if ( ! Settings::is_password_long_enough( $password ) ) {
				$errors[] = 'password_short';
			} elseif ( ! hash_equals( $password, $confirm ) ) {
				$errors[] = 'password_mismatch';
			} elseif ( $this->settings->set_password( $password ) ) {
				$changed = true;
			} else {
				$errors[] = 'password_short';
			}
		}

		if ( ! $this->settings->has_password() ) {
			$clean['enabled'] = false;

			if ( ! in_array( 'password_short', $errors, true ) && ! in_array( 'password_mismatch', $errors, true ) ) {
				$errors[] = 'password_required';
			}
		}

		if ( ! empty( $_POST['vaultgate_force_logout'] ) ) {
			$this->settings->bump_auth_version();
			$this->settings->log( 'logout_all' );
		}

		$this->settings->update( $clean );

		if ( $was_enabled !== $this->settings->is_enabled() ) {
			$this->settings->bump_auth_version();
		}

		if ( $changed ) {
			$this->settings->log( 'password_changed' );
		}

		$this->settings->log( 'settings_saved' );

		$args = array( 'page' => 'vaultgate' );

		if ( array() !== $errors ) {
			$args['vg_error'] = implode( ',', array_unique( $errors ) );
		} else {
			$args['vg_saved'] = '1';
		}

		wp_safe_redirect( add_query_arg( $args, admin_url( 'options-general.php' ) ) );
		exit;
	}

	/**
	 * Clears the activity log.
	 */
	public function handle_clear_log(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to change these settings.', 'vaultgate' ), '', array( 'response' => 403 ) );
		}

		check_admin_referer( 'vaultgate_clear_log' );

		$this->settings->clear_log();

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'     => 'vaultgate',
					'vg_saved' => 'log_cleared',
				),
				admin_url( 'options-general.php' )
			)
		);
		exit;
	}

	/**
	 * Admin notices.
	 */
	public function notices(): void {
		$page        = isset( $_GET['page'] ) && is_string( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
		$saved       = isset( $_GET['vg_saved'] ) && is_string( $_GET['vg_saved'] ) ? sanitize_key( wp_unslash( $_GET['vg_saved'] ) ) : '';
		$error_codes = isset( $_GET['vg_error'] ) && is_string( $_GET['vg_error'] ) ? sanitize_text_field( wp_unslash( $_GET['vg_error'] ) ) : '';

		if ( 'vaultgate' !== $page ) {
			if ( defined( 'VAULTGATE_DISABLED' ) && VAULTGATE_DISABLED ) {
				printf(
					'<div class="notice notice-info"><p>%s</p></div>',
					esc_html__( 'VaultGate is disabled by the VAULTGATE_DISABLED constant in wp-config.php.', 'vaultgate' )
				);
			}

			return;
		}

		if ( '1' === $saved ) {
			printf(
				'<div class="notice notice-success is-dismissible"><p>%s</p></div>',
				esc_html__( 'Settings saved.', 'vaultgate' )
			);
		}

		if ( 'log_cleared' === $saved ) {
			printf(
				'<div class="notice notice-success is-dismissible"><p>%s</p></div>',
				esc_html__( 'Activity log cleared.', 'vaultgate' )
			);
		}

		if ( '' !== $error_codes ) {
			$messages = array(
				'password_short'    => __( 'The password must be at least 8 characters long.', 'vaultgate' ),
				'password_mismatch' => __( 'The two passwords do not match.', 'vaultgate' ),
				'password_required' => __( 'Set a password before enabling protection. Protection has been disabled.', 'vaultgate' ),
			);

			foreach ( array_unique( explode( ',', $error_codes ) ) as $code ) {
				if ( isset( $messages[ $code ] ) ) {
					printf(
						'<div class="notice notice-error"><p>%s</p></div>',
						esc_html( $messages[ $code ] )
					);
				}
			}
		}

		if ( $this->settings->get( 'enabled' ) && ! $this->settings->has_password() ) {
			printf(
				'<div class="notice notice-warning"><p>%s</p></div>',
				esc_html__( 'Protection is enabled but no password is stored, so the site is currently not locked.', 'vaultgate' )
			);
		}

		if ( defined( 'VAULTGATE_DISABLED' ) && VAULTGATE_DISABLED ) {
			printf(
				'<div class="notice notice-info"><p>%s</p></div>',
				esc_html__( 'VaultGate is disabled by the VAULTGATE_DISABLED constant in wp-config.php.', 'vaultgate' )
			);
		}
	}

	/**
	 * Renders the settings screen.
	 */
	public function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings  = $this->settings->all();
		$active    = $this->settings->is_enabled();
		$has_hash  = $this->settings->has_password();
		$changed   = $this->settings->password_changed_at();
		$logs      = $this->settings->logs();
		$date_fmt  = ( get_option( 'date_format' ) ?: 'Y-m-d' ) . ' ' . ( get_option( 'time_format' ) ?: 'H:i' );
		$caps      = Settings::capabilities();
		$themes    = array(
			'auto'  => __( 'Automatic (follows the visitor’s system)', 'vaultgate' ),
			'light' => __( 'Light', 'vaultgate' ),
			'dark'  => __( 'Dark', 'vaultgate' ),
		);
		?>
		<div class="wrap vg-admin" data-vg-admin>
			<div class="vg-admin-head">
				<div>
					<h1>
						VaultGate
						<span class="vg-badge <?php echo $active ? 'vg-badge--on' : 'vg-badge--off'; ?>">
							<?php echo $active ? esc_html__( 'Protection active', 'vaultgate' ) : esc_html__( 'Protection inactive', 'vaultgate' ); ?>
						</span>
					</h1>
					<p class="vg-lead">
						<?php esc_html_e( 'Lock the whole site behind a single password while you build it. No third-party service, no tracking, no external assets.', 'vaultgate' ); ?>
					</p>
				</div>
				<p class="vg-version">
					<?php
					printf(
						/* translators: 1: plugin version, 2: PHP version, 3: WordPress version. */
						esc_html__( 'v%s · PHP %s+ · WordPress %s+', 'vaultgate' ),
						esc_html( VAULTGATE_VERSION ),
						'8.2',
						'6.5'
					);
					?>
				</p>
			</div>

			<nav class="vg-tabs" role="tablist" aria-label="<?php esc_attr_e( 'VaultGate sections', 'vaultgate' ); ?>">
				<button type="button" class="vg-tab" role="tab" id="vg-tab-protection" aria-controls="vg-panel-protection" aria-selected="true" data-vg-tab="protection"><?php esc_html_e( 'Protection', 'vaultgate' ); ?></button>
				<button type="button" class="vg-tab" role="tab" id="vg-tab-appearance" aria-controls="vg-panel-appearance" aria-selected="false" tabindex="-1" data-vg-tab="appearance"><?php esc_html_e( 'Gate page', 'vaultgate' ); ?></button>
				<button type="button" class="vg-tab" role="tab" id="vg-tab-access" aria-controls="vg-panel-access" aria-selected="false" tabindex="-1" data-vg-tab="access"><?php esc_html_e( 'Access', 'vaultgate' ); ?></button>
				<button type="button" class="vg-tab" role="tab" id="vg-tab-advanced" aria-controls="vg-panel-advanced" aria-selected="false" tabindex="-1" data-vg-tab="advanced"><?php esc_html_e( 'Advanced', 'vaultgate' ); ?></button>
				<button type="button" class="vg-tab" role="tab" id="vg-tab-activity" aria-controls="vg-panel-activity" aria-selected="false" tabindex="-1" data-vg-tab="activity"><?php esc_html_e( 'Activity', 'vaultgate' ); ?></button>
			</nav>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="vaultgate_save">
				<?php wp_nonce_field( 'vaultgate_save' ); ?>

				<div class="vg-panel" id="vg-panel-protection" role="tabpanel" aria-labelledby="vg-tab-protection" data-vg-panel="protection">
					<div class="vg-status-card <?php echo $active ? 'is-on' : 'is-off'; ?>">
						<span class="vg-status-dot" aria-hidden="true"></span>
						<div>
							<strong>
								<?php
								echo $active
									? esc_html__( 'The site is locked. Visitors must enter the password.', 'vaultgate' )
									: esc_html__( 'The gate is off. The site is publicly visible.', 'vaultgate' );
								?>
							</strong>
							<p>
								<?php
								if ( $has_hash ) {
									printf(
										/* translators: %s: formatted date. */
										esc_html__( 'Password last changed on %s.', 'vaultgate' ),
										esc_html( $changed ? wp_date( $date_fmt, $changed ) : __( 'never', 'vaultgate' ) )
									);
								} else {
									esc_html_e( 'No password has been set yet.', 'vaultgate' );
								}
								?>
							</p>
						</div>
					</div>

					<?php
					$this->field_checkbox(
						'enabled',
						__( 'Enable password protection', 'vaultgate' ),
						(bool) $settings['enabled'],
						__( 'Every front-end page, feed, sitemap and anonymous REST request will ask for the password.', 'vaultgate' )
					);
					?>

					<hr class="vg-sep">

					<h2><?php esc_html_e( 'Password', 'vaultgate' ); ?></h2>
					<p class="vg-help"><?php esc_html_e( 'Leave both fields empty to keep the current password. The password is stored as a one-way hash, never in clear text.', 'vaultgate' ); ?></p>

					<div class="vg-grid vg-grid--2">
						<div class="vg-field">
							<label for="vg-new-password"><?php esc_html_e( 'New password', 'vaultgate' ); ?></label>
							<input type="password" id="vg-new-password" name="vaultgate_new_password" value="" autocomplete="new-password" minlength="8" aria-describedby="vg-password-desc">
							<p class="vg-help" id="vg-password-desc"><?php esc_html_e( 'Minimum 8 characters. A long passphrase is best.', 'vaultgate' ); ?></p>
						</div>
						<div class="vg-field">
							<label for="vg-confirm-password"><?php esc_html_e( 'Confirm password', 'vaultgate' ); ?></label>
							<input type="password" id="vg-confirm-password" name="vaultgate_confirm_password" value="" autocomplete="new-password" minlength="8">
						</div>
					</div>

					<?php
					$this->field_checkbox(
						'force_logout',
						__( 'Sign out every visitor', 'vaultgate' ),
						false,
						__( 'Invalidates all gate cookies immediately. Your own admin access is not affected.', 'vaultgate' ),
						false
					);
					?>

					<div class="vg-callout">
						<strong><?php esc_html_e( 'Locked out?', 'vaultgate' ); ?></strong>
						<p><?php esc_html_e( 'You can still log in through wp-login.php: administrator sessions always bypass the gate. As a last resort, add the emergency constant or use WP-CLI (see the Advanced tab).', 'vaultgate' ); ?></p>
					</div>
				</div>

				<div class="vg-panel" id="vg-panel-appearance" role="tabpanel" aria-labelledby="vg-tab-appearance" data-vg-panel="appearance">
					<h2><?php esc_html_e( 'What visitors see', 'vaultgate' ); ?></h2>
					<p class="vg-help"><?php esc_html_e( 'The gate is a standalone, accessible page: no theme, no plugin, no external font or script.', 'vaultgate' ); ?></p>

					<?php
					$this->field_text( 'gate_title', __( 'Title', 'vaultgate' ), (string) $settings['gate_title'], __( 'Shown as the main heading and in the browser tab.', 'vaultgate' ) );
					$this->field_textarea( 'gate_message', __( 'Message', 'vaultgate' ), (string) $settings['gate_message'], __( 'Basic HTML is allowed (links, bold, line breaks).', 'vaultgate' ) );
					$this->field_text( 'logo_url', __( 'Logo URL', 'vaultgate' ), (string) $settings['logo_url'], __( 'Optional. HTTPS recommended. Displayed above the title; leave empty for the built-in lock icon.', 'vaultgate' ), 'url', 'https://example.com/logo.svg' );
					$this->field_color( 'accent', __( 'Accent colour', 'vaultgate' ), (string) $settings['accent'], __( 'Used for the button, focus rings and highlights.', 'vaultgate' ) );
					$this->field_select( 'theme', __( 'Colour theme', 'vaultgate' ), (string) $settings['theme'], $themes );
					$this->field_text( 'support_url', __( 'Support link', 'vaultgate' ), (string) $settings['support_url'], __( 'Optional. A “Need access?” link under the form. Accepts http(s) and mailto.', 'vaultgate' ), 'text', 'mailto:hello@example.com' );
					$this->field_text( 'footer_note', __( 'Footer note', 'vaultgate' ), (string) $settings['footer_note'], __( 'Optional small text under the card. The site name is used when empty.', 'vaultgate' ) );
					?>
				</div>

				<div class="vg-panel" id="vg-panel-access" role="tabpanel" aria-labelledby="vg-tab-access" data-vg-panel="access">
					<h2><?php esc_html_e( 'Sessions', 'vaultgate' ); ?></h2>

					<div class="vg-grid vg-grid--2">
						<?php
						$this->field_number( 'session_days', __( 'Session duration (days)', 'vaultgate' ), (int) $settings['session_days'], 1, 365, __( 'How long a visitor stays unlocked without ticking “keep me signed in”.', 'vaultgate' ) );
						$this->field_number( 'remember_days', __( 'Remembered duration (days)', 'vaultgate' ), (int) $settings['remember_days'], 1, 365, __( 'How long the optional “keep me signed in” cookie lasts.', 'vaultgate' ) );
						?>
					</div>

					<?php
					$this->field_checkbox( 'remember_enabled', __( 'Offer “Keep me signed in”', 'vaultgate' ), (bool) $settings['remember_enabled'], __( 'Shows a checkbox on the gate page.', 'vaultgate' ) );
					$this->field_select( 'bypass_capability', __( 'Logged-in users who bypass the gate', 'vaultgate' ), (string) $settings['bypass_capability'], $caps, __( 'Choose the minimum capability. Administrators always bypass.', 'vaultgate' ) );
					?>

					<hr class="vg-sep">

					<h2><?php esc_html_e( 'Network rules', 'vaultgate' ); ?></h2>

					<?php
					$this->field_textarea(
						'ip_allowlist',
						__( 'IP allowlist', 'vaultgate' ),
						(string) $settings['ip_allowlist'],
						__( 'One IP or CIDR range per line. These visitors skip the gate entirely. IPv4 and IPv6 are supported.', 'vaultgate' ),
						"203.0.113.10\n2001:db8::/32"
					);

					$this->field_checkbox(
						'trust_proxy',
						__( 'Trust reverse-proxy headers', 'vaultgate' ),
						(bool) $settings['trust_proxy'],
						__( 'Only enable this behind a trusted proxy or CDN. It reads X-Forwarded-For and X-Forwarded-Proto; enabling it on a directly exposed server lets visitors spoof their IP.', 'vaultgate' )
					);

					$this->field_textarea(
						'exclude_paths',
						__( 'Excluded paths', 'vaultgate' ),
						(string) $settings['exclude_paths'],
						__( 'One path per line. A path also covers its sub-paths; * is a wildcard. Useful for health checks, payment webhooks or a public API.', 'vaultgate' ),
						"/favicon.ico\n/webhooks/*"
					);
					?>
				</div>

				<div class="vg-panel" id="vg-panel-advanced" role="tabpanel" aria-labelledby="vg-tab-advanced" data-vg-panel="advanced">
					<h2><?php esc_html_e( 'What is protected', 'vaultgate' ); ?></h2>

					<?php
					$this->field_checkbox( 'protect_rest', __( 'REST API', 'vaultgate' ), (bool) $settings['protect_rest'], __( 'Anonymous /wp-json requests return 401. Logged-in users above the bypass capability keep access.', 'vaultgate' ) );
					$this->field_checkbox( 'protect_feeds', __( 'Feeds', 'vaultgate' ), (bool) $settings['protect_feeds'], __( 'RSS/Atom feeds are gated like normal pages.', 'vaultgate' ) );
					$this->field_checkbox( 'protect_sitemaps', __( 'Sitemaps', 'vaultgate' ), (bool) $settings['protect_sitemaps'], __( 'wp-sitemap.xml and its children are gated.', 'vaultgate' ) );
					$this->field_checkbox( 'protect_ajax', __( 'Anonymous AJAX', 'vaultgate' ), (bool) $settings['protect_ajax'], __( 'admin-ajax.php requests from visitors without a valid gate cookie return 401.', 'vaultgate' ) );
					$this->field_checkbox( 'protect_xmlrpc', __( 'XML-RPC', 'vaultgate' ), (bool) $settings['protect_xmlrpc'], __( 'Blocks xmlrpc.php until the visitor is authenticated.', 'vaultgate' ) );
					?>

					<hr class="vg-sep">

					<h2><?php esc_html_e( 'Brute force', 'vaultgate' ); ?></h2>

					<div class="vg-grid vg-grid--2">
						<?php
						$this->field_number( 'max_attempts', __( 'Attempts before lock-out', 'vaultgate' ), (int) $settings['max_attempts'], 1, 50, __( 'Per IP address, inside the lock-out window.', 'vaultgate' ) );
						$this->field_number( 'lockout_minutes', __( 'Lock-out duration (minutes)', 'vaultgate' ), (int) $settings['lockout_minutes'], 1, 1440, __( 'The visitor must wait this long after too many failures.', 'vaultgate' ) );
						?>
					</div>

					<hr class="vg-sep">

					<h2><?php esc_html_e( 'Privacy and cleanup', 'vaultgate' ); ?></h2>

					<?php
					$this->field_checkbox( 'log_enabled', __( 'Keep a small activity log', 'vaultgate' ), (bool) $settings['log_enabled'], __( 'The last 20 events, with anonymised IP addresses, shown in the Activity tab.', 'vaultgate' ) );
					$this->field_checkbox( 'delete_data', __( 'Delete all plugin data when the plugin is deleted', 'vaultgate' ), (bool) $settings['delete_data'], __( 'Options, password hash and log are removed. The plugin does nothing until you delete it.', 'vaultgate' ) );
					?>

					<div class="vg-callout vg-callout--code">
						<strong><?php esc_html_e( 'Emergency disable', 'vaultgate' ); ?></strong>
						<p><?php esc_html_e( 'Add this line to wp-config.php to disable the gate without touching the database:', 'vaultgate' ); ?></p>
						<pre><code>define( 'VAULTGATE_DISABLED', true );</code></pre>
						<p><?php esc_html_e( 'Or use WP-CLI:', 'vaultgate' ); ?></p>
						<pre><code>wp vaultgate disable
wp vaultgate password 'a-new-long-passphrase'</code></pre>
					</div>
				</div>

				<div class="vg-panel" id="vg-panel-activity" role="tabpanel" aria-labelledby="vg-tab-activity" data-vg-panel="activity">
					<div class="vg-panel-head">
						<div>
							<h2><?php esc_html_e( 'Recent activity', 'vaultgate' ); ?></h2>
							<p class="vg-help"><?php esc_html_e( 'IP addresses are anonymised. This log never contains passwords.', 'vaultgate' ); ?></p>
						</div>
						<?php if ( array() !== $logs ) : ?>
							<button type="submit" class="button" form="vg-clear-log"><?php esc_html_e( 'Clear log', 'vaultgate' ); ?></button>
						<?php endif; ?>
					</div>

					<?php if ( array() === $logs ) : ?>
						<p class="vg-empty"><?php esc_html_e( 'No activity recorded yet.', 'vaultgate' ); ?></p>
					<?php else : ?>
						<div class="vg-table-wrap">
							<table class="widefat striped vg-table">
								<thead>
									<tr>
										<th scope="col"><?php esc_html_e( 'Date', 'vaultgate' ); ?></th>
										<th scope="col"><?php esc_html_e( 'Event', 'vaultgate' ); ?></th>
										<th scope="col"><?php esc_html_e( 'IP', 'vaultgate' ); ?></th>
										<th scope="col"><?php esc_html_e( 'User agent', 'vaultgate' ); ?></th>
									</tr>
								</thead>
								<tbody>
									<?php foreach ( $logs as $entry ) : ?>
										<tr>
											<td><?php echo esc_html( wp_date( $date_fmt, (int) $entry['time'] ) ); ?></td>
											<td><?php echo esc_html( $this->event_label( (string) $entry['event'] ) ); ?></td>
											<td><code><?php echo esc_html( '' !== (string) $entry['ip'] ? (string) $entry['ip'] : '—' ); ?></code></td>
											<td class="vg-ua"><?php echo esc_html( (string) $entry['agent'] ); ?></td>
										</tr>
									<?php endforeach; ?>
								</tbody>
							</table>
						</div>
					<?php endif; ?>
				</div>

				<div class="vg-savebar">
					<span class="vg-savebar__hint"><?php esc_html_e( 'Changes apply immediately to the whole site.', 'vaultgate' ); ?></span>
					<?php submit_button( __( 'Save changes', 'vaultgate' ), 'primary', 'submit', false ); ?>
				</div>
			</form>

			<form id="vg-clear-log" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="vg-hidden-form">
				<input type="hidden" name="action" value="vaultgate_clear_log">
				<?php wp_nonce_field( 'vaultgate_clear_log' ); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Human label for a log event.
	 *
	 * @param string $event Event key.
	 */
	private function event_label( string $event ): string {
		$labels = array(
			'login_success'   => __( 'Login succeeded', 'vaultgate' ),
			'login_failed'    => __( 'Login failed', 'vaultgate' ),
			'login_locked'    => __( 'Login blocked (rate limit)', 'vaultgate' ),
			'logout'          => __( 'Logged out', 'vaultgate' ),
			'logout_all'      => __( 'All sessions revoked', 'vaultgate' ),
			'password_changed' => __( 'Password changed', 'vaultgate' ),
			'settings_saved'  => __( 'Settings saved', 'vaultgate' ),
			'form_expired'    => __( 'Expired form token', 'vaultgate' ),
			'honeypot'        => __( 'Honeypot triggered', 'vaultgate' ),
			'cookie_failed'   => __( 'Cookie refused by the browser', 'vaultgate' ),
			'ajax_blocked'    => __( 'Anonymous AJAX blocked', 'vaultgate' ),
			'rest_blocked'    => __( 'Anonymous REST request blocked', 'vaultgate' ),
			'xmlrpc_blocked'  => __( 'XML-RPC request blocked', 'vaultgate' ),
			'endpoint_blocked' => __( 'Direct endpoint blocked', 'vaultgate' ),
			'log_cleared'     => __( 'Activity log cleared', 'vaultgate' ),
		);

		return $labels[ $event ] ?? $event;
	}

	/**
	 * Text input field.
	 *
	 * @param string $key         Setting key.
	 * @param string $label       Label.
	 * @param string $value       Current value.
	 * @param string $description Help text.
	 * @param string $type        Input type.
	 * @param string $placeholder Placeholder.
	 */
	private function field_text( string $key, string $label, string $value, string $description = '', string $type = 'text', string $placeholder = '' ): void {
		$id = 'vg-' . $key;
		?>
		<div class="vg-field">
			<label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label>
			<input type="<?php echo esc_attr( $type ); ?>" id="<?php echo esc_attr( $id ); ?>" name="vaultgate[<?php echo esc_attr( $key ); ?>]" value="<?php echo esc_attr( $value ); ?>" placeholder="<?php echo esc_attr( $placeholder ); ?>"<?php echo '' !== $description ? ' aria-describedby="' . esc_attr( $id . '-desc' ) . '"' : ''; ?>>
			<?php if ( '' !== $description ) : ?>
				<p class="vg-help" id="<?php echo esc_attr( $id . '-desc' ); ?>"><?php echo esc_html( $description ); ?></p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Number input field.
	 *
	 * @param string $key         Setting key.
	 * @param string $label       Label.
	 * @param int    $value       Current value.
	 * @param int    $min         Minimum.
	 * @param int    $max         Maximum.
	 * @param string $description Help text.
	 */
	private function field_number( string $key, string $label, int $value, int $min, int $max, string $description = '' ): void {
		$id = 'vg-' . $key;
		?>
		<div class="vg-field">
			<label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label>
			<input type="number" id="<?php echo esc_attr( $id ); ?>" name="vaultgate[<?php echo esc_attr( $key ); ?>]" value="<?php echo esc_attr( (string) $value ); ?>" min="<?php echo esc_attr( (string) $min ); ?>" max="<?php echo esc_attr( (string) $max ); ?>" step="1"<?php echo '' !== $description ? ' aria-describedby="' . esc_attr( $id . '-desc' ) . '"' : ''; ?>>
			<?php if ( '' !== $description ) : ?>
				<p class="vg-help" id="<?php echo esc_attr( $id . '-desc' ); ?>"><?php echo esc_html( $description ); ?></p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Textarea field.
	 *
	 * @param string $key         Setting key.
	 * @param string $label       Label.
	 * @param string $value       Current value.
	 * @param string $description Help text.
	 * @param string $placeholder Placeholder.
	 */
	private function field_textarea( string $key, string $label, string $value, string $description = '', string $placeholder = '' ): void {
		$id = 'vg-' . $key;
		?>
		<div class="vg-field">
			<label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label>
			<textarea id="<?php echo esc_attr( $id ); ?>" name="vaultgate[<?php echo esc_attr( $key ); ?>]" rows="5" placeholder="<?php echo esc_attr( $placeholder ); ?>"<?php echo '' !== $description ? ' aria-describedby="' . esc_attr( $id . '-desc' ) . '"' : ''; ?>><?php echo esc_textarea( $value ); ?></textarea>
			<?php if ( '' !== $description ) : ?>
				<p class="vg-help" id="<?php echo esc_attr( $id . '-desc' ); ?>"><?php echo esc_html( $description ); ?></p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Checkbox field with a hidden 0 so that the option is always submitted.
	 *
	 * @param string $key         Setting key.
	 * @param string $label       Label.
	 * @param bool   $checked     Current state.
	 * @param string $description Help text.
	 * @param bool   $setting     Whether the name belongs to the settings array.
	 */
	private function field_checkbox( string $key, string $label, bool $checked, string $description = '', bool $setting = true ): void {
		$id   = 'vg-' . $key;
		$name = $setting ? 'vaultgate[' . $key . ']' : $key;
		?>
		<div class="vg-checkbox-field">
			<input type="hidden" name="<?php echo esc_attr( $name ); ?>" value="0">
			<label for="<?php echo esc_attr( $id ); ?>">
				<input type="checkbox" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" value="1" <?php checked( $checked ); ?><?php echo '' !== $description ? ' aria-describedby="' . esc_attr( $id . '-desc' ) . '"' : ''; ?>>
				<span><?php echo esc_html( $label ); ?></span>
			</label>
			<?php if ( '' !== $description ) : ?>
				<p class="vg-help" id="<?php echo esc_attr( $id . '-desc' ); ?>"><?php echo esc_html( $description ); ?></p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Select field.
	 *
	 * @param string                $key         Setting key.
	 * @param string                $label       Label.
	 * @param string                $value       Current value.
	 * @param array<string, string> $options     Options.
	 * @param string                $description Help text.
	 */
	private function field_select( string $key, string $label, string $value, array $options, string $description = '' ): void {
		$id = 'vg-' . $key;
		?>
		<div class="vg-field">
			<label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label>
			<select id="<?php echo esc_attr( $id ); ?>" name="vaultgate[<?php echo esc_attr( $key ); ?>]"<?php echo '' !== $description ? ' aria-describedby="' . esc_attr( $id . '-desc' ) . '"' : ''; ?>>
				<?php foreach ( $options as $option_value => $option_label ) : ?>
					<option value="<?php echo esc_attr( (string) $option_value ); ?>" <?php selected( $value, (string) $option_value ); ?>><?php echo esc_html( $option_label ); ?></option>
				<?php endforeach; ?>
			</select>
			<?php if ( '' !== $description ) : ?>
				<p class="vg-help" id="<?php echo esc_attr( $id . '-desc' ); ?>"><?php echo esc_html( $description ); ?></p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Colour picker.
	 *
	 * @param string $key         Setting key.
	 * @param string $label       Label.
	 * @param string $value       Current hex colour.
	 * @param string $description Help text.
	 */
	private function field_color( string $key, string $label, string $value, string $description = '' ): void {
		$id = 'vg-' . $key;
		?>
		<div class="vg-field vg-field--color">
			<label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label>
			<span class="vg-color">
				<input type="color" id="<?php echo esc_attr( $id ); ?>" name="vaultgate[<?php echo esc_attr( $key ); ?>]" value="<?php echo esc_attr( Settings::normalize_hex( $value ) ); ?>"<?php echo '' !== $description ? ' aria-describedby="' . esc_attr( $id . '-desc' ) . '"' : ''; ?>>
				<code><?php echo esc_html( Settings::normalize_hex( $value ) ); ?></code>
			</span>
			<?php if ( '' !== $description ) : ?>
				<p class="vg-help" id="<?php echo esc_attr( $id . '-desc' ); ?>"><?php echo esc_html( $description ); ?></p>
			<?php endif; ?>
		</div>
		<?php
	}
}
