<?php
/**
 * Standalone gate page.
 *
 * @package VaultGate
 *
 * @var array<string, mixed> $vg View data prepared by Guard::render_gate().
 */

defined( 'ABSPATH' ) || exit;
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex, nofollow, noarchive">
	<meta name="color-scheme" content="light dark">
	<title><?php echo esc_html( (string) $vg['title'] ); ?> — <?php echo esc_html( (string) $vg['site_name'] ); ?></title>
	<link rel="stylesheet" href="<?php echo esc_url( (string) $vg['style_url'] ); ?>">
	<style nonce="<?php echo esc_attr( (string) $vg['nonce'] ); ?>">
		:root { --vg-accent: <?php echo esc_attr( (string) $vg['accent'] ); ?>; --vg-accent-ink: <?php echo esc_attr( (string) $vg['accent_ink'] ); ?>; }
	</style>
</head>
<body class="vg-gate vg-theme-<?php echo esc_attr( (string) $vg['theme'] ); ?>">
	<a class="vg-skip" href="#vg-password"><?php esc_html_e( 'Skip to the password field', 'vaultgate' ); ?></a>

	<main class="vg-card" aria-labelledby="vg-title">
		<header class="vg-head">
			<?php if ( '' !== (string) $vg['logo'] ) : ?>
				<img class="vg-logo" src="<?php echo esc_url( (string) $vg['logo'] ); ?>" alt="<?php echo esc_attr( (string) $vg['site_name'] ); ?>" decoding="async">
			<?php else : ?>
				<span class="vg-mark" aria-hidden="true">
					<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
						<path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
						<rect x="4.75" y="10" width="14.5" height="10.75" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
						<circle cx="12" cy="15.25" r="1.35" fill="currentColor"/>
						<path d="M12 16.4v1.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
					</svg>
				</span>
			<?php endif; ?>

			<p class="vg-eyebrow"><?php echo esc_html( (string) $vg['site_name'] ); ?></p>
			<h1 id="vg-title"><?php echo esc_html( (string) $vg['title'] ); ?></h1>
		</header>

		<?php if ( '' !== trim( (string) $vg['message'] ) ) : ?>
			<div class="vg-message"><?php echo wp_kses_post( wpautop( (string) $vg['message'] ) ); ?></div>
		<?php endif; ?>

		<?php if ( '' !== (string) $vg['notice'] ) : ?>
			<p class="vg-alert" id="vg-notice" role="alert" aria-live="polite" aria-atomic="true"><?php echo esc_html( (string) $vg['notice'] ); ?></p>
		<?php endif; ?>

		<form class="vg-form" method="post" action="<?php echo esc_url( (string) $vg['action'] ); ?>">
			<input type="hidden" name="vaultgate_action" value="login">
			<input type="hidden" name="vaultgate_form_token" value="<?php echo esc_attr( (string) $vg['form_token'] ); ?>">
			<input type="hidden" name="vaultgate_redirect" value="<?php echo esc_attr( (string) $vg['redirect'] ); ?>">

			<div class="vg-field">
				<label for="vg-password"><?php esc_html_e( 'Password', 'vaultgate' ); ?></label>
				<div class="vg-control">
					<input id="vg-password" name="vaultgate_password" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" required autofocus aria-describedby="vg-password-hint<?php echo '' !== (string) $vg['notice'] ? ' vg-notice' : ''; ?>"<?php echo '' !== (string) $vg['notice'] ? ' aria-invalid="true"' : ''; ?>>
					<button class="vg-reveal" type="button" data-vg-reveal aria-controls="vg-password" aria-pressed="false" data-label-show="<?php echo esc_attr__( 'Show', 'vaultgate' ); ?>" data-label-hide="<?php echo esc_attr__( 'Hide', 'vaultgate' ); ?>">
						<span data-vg-reveal-label><?php esc_html_e( 'Show', 'vaultgate' ); ?></span>
					</button>
				</div>
				<p id="vg-password-hint" class="vg-hint"><?php esc_html_e( 'Enter the password provided by the site owner.', 'vaultgate' ); ?></p>
			</div>

			<?php if ( ! empty( $vg['remember'] ) ) : ?>
				<label class="vg-check">
					<input type="checkbox" name="vaultgate_remember" value="1">
					<span>
						<?php
						printf(
							/* translators: %d: number of days. */
							esc_html__( 'Keep me signed in for %d days', 'vaultgate' ),
							(int) $vg['remember_days']
						);
						?>
					</span>
				</label>
			<?php endif; ?>

			<button class="vg-submit" type="submit">
				<span><?php esc_html_e( 'Enter site', 'vaultgate' ); ?></span>
				<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
					<path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</button>

			<div class="vg-hp" aria-hidden="true" inert>
				<label for="vg-website"><?php esc_html_e( 'Website', 'vaultgate' ); ?></label>
				<input id="vg-website" type="text" name="vaultgate_website" value="" tabindex="-1" autocomplete="off">
			</div>
		</form>

		<?php if ( '' !== (string) $vg['support'] ) : ?>
			<a class="vg-support" href="<?php echo esc_url( (string) $vg['support'] ); ?>">
				<?php esc_html_e( 'Need access? Contact the site owner.', 'vaultgate' ); ?>
			</a>
		<?php endif; ?>
	</main>

	<footer class="vg-footer">
		<?php if ( '' !== (string) $vg['footer'] ) : ?>
			<p><?php echo esc_html( (string) $vg['footer'] ); ?></p>
		<?php else : ?>
			<p><?php echo esc_html( (string) $vg['site_name'] ); ?></p>
		<?php endif; ?>
	</footer>

	<script src="<?php echo esc_url( (string) $vg['script_url'] ); ?>" defer></script>
</body>
</html>
