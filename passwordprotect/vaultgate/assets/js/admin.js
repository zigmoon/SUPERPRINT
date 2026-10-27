/**
 * VaultGate — admin tabs and colour preview.
 * The settings form is fully usable without JavaScript (all panels stay open).
 */
(function () {
	'use strict';

	var root = document.querySelector('[data-vg-admin]');

	if (!root) {
		return;
	}

	root.classList.add('vg-admin--js');

	var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-vg-tab]'));
	var panels = Array.prototype.slice.call(root.querySelectorAll('[data-vg-panel]'));

	if (!tabs.length || !panels.length) {
		return;
	}

	function activate(id, focus) {
		var found = false;

		tabs.forEach(function (tab) {
			var on = tab.getAttribute('data-vg-tab') === id;
			tab.setAttribute('aria-selected', on ? 'true' : 'false');
			tab.tabIndex = on ? 0 : -1;

			if (on && focus) {
				tab.focus();
			}
		});

		panels.forEach(function (panel) {
			var on = panel.getAttribute('data-vg-panel') === id;
			panel.hidden = !on;

			if (on) {
				found = true;
			}
		});

		if (!found) {
			activate(tabs[0].getAttribute('data-vg-tab'), focus);
			return;
		}

		if (window.history && window.history.replaceState) {
			try {
				window.history.replaceState(null, '', '#vg-panel-' + id);
			} catch (error) {
				// Ignore URL restrictions in sandboxed previews.
			}
		}
	}

	tabs.forEach(function (tab, index) {
		tab.addEventListener('click', function () {
			activate(tab.getAttribute('data-vg-tab'), false);
		});

		tab.addEventListener('keydown', function (event) {
			var next = null;

			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				next = tabs[(index + 1) % tabs.length];
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				next = tabs[(index - 1 + tabs.length) % tabs.length];
			} else if (event.key === 'Home') {
				next = tabs[0];
			} else if (event.key === 'End') {
				next = tabs[tabs.length - 1];
			}

			if (next) {
				event.preventDefault();
				activate(next.getAttribute('data-vg-tab'), true);
			}
		});
	});

	var initial = (window.location.hash || '').replace('#vg-panel-', '');
	activate(initial || tabs[0].getAttribute('data-vg-tab'), false);

	var color = document.getElementById('vg-accent');

	if (color) {
		var code = color.parentNode.querySelector('code');

		if (code) {
			color.addEventListener('input', function () {
				code.textContent = color.value;
			});
		}
	}
})();
