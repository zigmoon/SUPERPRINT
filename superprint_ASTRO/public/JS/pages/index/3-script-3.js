
(function () {
  var rail = document.getElementById('tplRail');
  if (!rail) return;
  var toutes = Array.prototype.slice.call(rail.querySelectorAll('.tpl-card'));

  /* ⚠️ v1.7.634 — TIRAGE ALÉATOIRE À CHAQUE CHARGEMENT. Demande utilisateur : « faire un
     random des templates : les templates changent à chaque chargement de la page ».
     On mélange donc les cartes, puis on n'en MONTRE QU'UNE PARTIE — et pas seulement dans
     un autre ordre : sur 46 maquettes, un simple mélange se lit « la même page » d'une
     visite à l'autre, alors qu'une sélection différente se voit tout de suite.
     Les cartes non tirées restent dans le DOCUMENT, retirées du rail et masquées : elles
     restent donc dans le HTML servi, avec leur lien et leur aperçu. On ne cache rien à
     l'indexation, on choisit ce qu'on met en avant.
     Le tirage est enfin CONTRÔLÉ, pas seulement « mélangé » : une permutation de Fisher-Yates
     donne toutes les sélections avec la même probabilité, là où trier sur un nombre
     aléatoire est biaisé et peut laisser des cartes voisines groupées.
     Le nombre affiché n'est donc PAS le nombre de maquettes du site, et le compteur suit
     la sélection réelle — il était écrit en dur (« 1 / 43 ») et ne pouvait pas suivre. */
  var A_MONTRER = 12;
  var melange = toutes.slice();
  for (var i = melange.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = melange[i]; melange[i] = melange[j]; melange[j] = t;
  }
  var choisies = melange.slice(0, Math.min(A_MONTRER, melange.length));
  var ecartees = melange.slice(choisies.length);
  ecartees.forEach(function (c) { c.remove(); });
  choisies.forEach(function (c) { rail.appendChild(c); });

  /* ⚠️ LE RAIL REPART TOUJOURS DE LA PREMIÈRE CARTE. `overflow-anchor: none` sur
     `.tpl-rail` empêche le navigateur de réancrer le défilement, mais un défilement
     hérité (retour arrière, restauration de session) peut encore arriver ici. On le
     remet à zéro SANS animation — sinon `scroll-behavior: smooth` transformerait la
     remise à zéro en glissement visible au chargement. */
  (function remettreAZero() {
    var avant = rail.style.scrollBehavior;
    rail.style.scrollBehavior = 'auto';
    rail.scrollLeft = 0;
    requestAnimationFrame(function () { rail.style.scrollBehavior = avant; });
  })();

  var cartes = choisies;
  var prev = document.querySelector('.tpl-prev'), next = document.querySelector('.tpl-next');
  var compteur = document.getElementById('tplCount');
  var total = cartes.length;

  function pas() {
    if (cartes.length < 2) return 240;
    return Math.max(120, Math.round(cartes[1].offsetLeft - cartes[0].offsetLeft));
  }
  // Origine du défilement : la position de la PREMIÈRE carte. On ne peut pas
  // lire `scroll-padding-left` pour ça — MESURÉ, `getComputedStyle` le renvoie
  // sous sa forme non résolue (« max(24px, 50% - 590px) ») et `parseFloat` y
  // donne NaN, donc 0, ce qui décalait le compteur d'une carte.
  function origine() {
    return cartes.length ? cartes[0].offsetLeft : 0;
  }
  function majEtat() {
    var g = rail.scrollLeft, max = rail.scrollWidth - rail.clientWidth;
    var r = origine(), i = 0, meilleur = Infinity;
    for (var k = 0; k < cartes.length; k++) {
      var d = Math.abs(cartes[k].offsetLeft - r - g);
      if (d < meilleur) { meilleur = d; i = k; }
    }
    // En butée droite les dernières cartes s'arrêtent avant le bord : sans ce
    // garde le compteur restait bloqué sur « 39 / 43 » au bout du rail.
    if (max - g <= 2) i = total - 1;
    if (compteur) compteur.textContent = (i + 1) + ' / ' + total;
    if (prev) prev.disabled = g <= 2;
    if (next) next.disabled = g >= max - 2;
  }
  function aller(d) { rail.scrollBy({ left: d * pas(), behavior: 'smooth' }); }
  if (prev) prev.addEventListener('click', function () { aller(-1); });
  if (next) next.addEventListener('click', function () { aller(1); });
  rail.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { aller(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { aller(-1); e.preventDefault(); }
  });

  // Glisser à la souris (le tactile est déjà géré par le navigateur).
  var actif = false, departX = 0, departScroll = 0, bouge = false;
  rail.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse') return;
    actif = true; bouge = false; departX = e.clientX; departScroll = rail.scrollLeft;
    rail.style.scrollBehavior = 'auto';
  });
  window.addEventListener('pointermove', function (e) {
    if (!actif) return;
    var d = e.clientX - departX;
    if (!bouge && Math.abs(d) > 5) { bouge = true; rail.style.cursor = 'grabbing'; }
    if (bouge) { rail.scrollLeft = departScroll - d; e.preventDefault(); }
  });
  window.addEventListener('pointerup', function () {
    if (!actif) return;
    actif = false; rail.style.scrollBehavior = ''; rail.style.cursor = '';
  });
  rail.addEventListener('click', function (e) { if (bouge) { e.preventDefault(); bouge = false; } }, true);

  var planifie = false;
  rail.addEventListener('scroll', function () {
    if (planifie) return; planifie = true;
    requestAnimationFrame(function () { planifie = false; majEtat(); });
  }, { passive: true });
  window.addEventListener('resize', majEtat);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(majEtat);
  majEtat();
})();
