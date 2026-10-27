/**
 * VaultGate — gate page behaviour.
 * Progressive enhancement only: the password form works without JavaScript.
 */
(function () {
	'use strict';

	var button = document.querySelector('[data-vg-reveal]');
	var input = document.getElementById('vg-password');

	if (!button || !input) {
		return;
	}

	var label = button.querySelector('[data-vg-reveal-label]');
	var showLabel = button.getAttribute('data-label-show') || 'Show';
	var hideLabel = button.getAttribute('data-label-hide') || 'Hide';

	button.addEventListener('click', function () {
		var show = input.type === 'password';
		input.type = show ? 'text' : 'password';
		button.setAttribute('aria-pressed', show ? 'true' : 'false');

		if (label) {
			label.textContent = show ? hideLabel : showLabel;
		}

		var position = input.value.length;
		input.focus();

		try {
			input.setSelectionRange(position, position);
		} catch (error) {
			// Some input types do not support selection; ignore.
		}
	});
})();
