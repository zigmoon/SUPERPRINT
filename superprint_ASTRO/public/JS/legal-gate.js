/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — CONTRÔLE D'ÂGE + CONSENTEMENT D'ABONNEMENT + MENTION DE RENOUVELLEMENT
   ═══════════════════════════════════════════════════════════════════════════════

   POURQUOI CE FICHIER EXISTE
   SuperPrint n'a ni inscription ni compte : rien à vérifier à l'ouverture de
   l'application. Le SEUL engagement durable qu'un visiteur peut prendre est
   l'abonnement « Nouveautés » à 39 €/an, reconduit automatiquement. C'est donc là,
   et seulement là, qu'un contrôle d'âge et un consentement explicite ont un sens —
   et c'est aussi là qu'un manquement se voit (prélèvement récurrent, client
   mineur, contestation).

   CE QUE FAIT CE SCRIPT
     1. Il pose une question d'âge devant TOUT lien d'abonnement PayPal récurrent.
        Un refus (« moins de 18 ans ») n'ouvre rien : le lien reste bloqué.
     2. Il exige une case de consentement portant sur les TERMES DU RENOUVELLEMENT
        (montant, périodicité, date de reconduction, résiliation), pas sur une
        formule vague.
     3. Il affiche cette même mention de renouvellement SOUS le bouton d'abonnement,
        de façon permanente — l'information ne doit pas dépendre d'un clic.
     4. Il conserve la preuve du consentement (date, version du texte) dans le
        stockage local de l'appareil.

   ⚠️ LE STOCKAGE LOCAL EST UN CONFORT, PAS UNE PREUVE OPPOSABLE.
   Il évite de redemander la même chose à chaque visite. La trace réellement
   opposable reste l'horodatage du consentement côté PayPal au moment du paiement.
   On n'envoie donc RIEN à un serveur : le script est autonome, sans requête.

   ⚠️ ON INTERCEPTE EN PHASE DE CAPTURE.
   `price.html` attache son propre gestionnaire directement sur le bouton (pour
   ouvrir la pop-in PayPal). Un écouteur posé sur le bouton s'exécuterait APRÈS.
   Seule la phase de capture, sur `document`, passe avant : c'est la seule façon
   d'empêcher l'ouverture tant que le consentement manque, sans réécrire la page.
   ─────────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ⚠️ INCRÉMENTER À CHAQUE MODIFICATION DU TEXTE CONSENTI.
     Une preuve qui ne dit pas SUR QUEL texte le visiteur a consenti ne prouve rien. */
  var VERSION_TEXTE = '2026-10-24';
  var CLE = 'sp_age_consent_v1';

  var estAbonnement = /billing\/plans\/subscribe|plan_id=/i;

  var TEXTES = {
    fr: {
      kicker: 'Abonnement — 39 € par an',
      titre: 'Avant de vous abonner',
      intro: 'L\'abonnement « Nouveautés » est une <strong>reconduction automatique</strong>. Deux points à confirmer.',
      terms: '<b>39 € par an</b>, prélevés aujourd\'hui puis <b>reconduits automatiquement tous les ans</b> à la même date, jusqu\'à résiliation. <b>Résiliable à tout moment</b>, sans frais, depuis votre compte PayPal (Paiements → Gérer les paiements automatiques) : l\'accès reste actif jusqu\'à la fin de la période payée. Aucun remboursement au prorata.',
      age: 'J\'ai <strong>18 ans ou plus</strong>.',
      cgu: 'J\'ai lu les termes de renouvellement ci-dessus et je les accepte.',
      under: 'J\'ai moins de 18 ans',
      go: 'Continuer vers le paiement',
      no: 'Annuler',
      err: 'Cochez les deux cases pour continuer.',
      refusTitre: 'Abonnement réservé aux majeurs',
      refusTexte: 'L\'abonnement est un contrat à reconduction automatique : il ne peut pas être souscrit par un mineur, même avec l\'accord d\'un parent. Le logiciel SuperPrint, lui, reste entièrement gratuit et ne demande aucun âge — vous pouvez l\'utiliser dès maintenant sans rien payer.',
      refusFermer: 'Fermer',
      rc: 'Ce choix est mémorisé sur cet appareil. Aucune donnée n\'est envoyée à un serveur.',
      renew: '<b>39 € par an, renouvellement automatique.</b> Résiliable à tout moment dans votre compte PayPal (Paiements → Gérer les paiements automatiques), sans frais et sans justification ; l\'accès se poursuit jusqu\'à la fin de la période déjà payée.'
    },
    en: {
      kicker: 'Subscription — €39 per year',
      titre: 'Before you subscribe',
      intro: 'The “What\'s new” subscription <strong>renews automatically</strong>. Two things to confirm.',
      terms: '<b>€39 per year</b>, charged today and then <b>automatically renewed every year</b> on the same date until cancelled. <b>Cancel any time</b>, free of charge, from your PayPal account (Payments → Manage automatic payments): access continues until the end of the period already paid. No pro-rata refund.',
      age: 'I am <strong>18 or older</strong>.',
      cgu: 'I have read the renewal terms above and I accept them.',
      under: 'I am under 18',
      go: 'Continue to payment',
      no: 'Cancel',
      err: 'Please tick both boxes to continue.',
      refusTitre: 'Subscription for adults only',
      refusTexte: 'This subscription is an automatically renewing contract: it cannot be taken out by a minor, even with a parent\'s consent. The SuperPrint software itself stays entirely free and asks for no age — you can use it right now without paying anything.',
      refusFermer: 'Close',
      rc: 'This choice is remembered on this device. No data is sent to any server.',
      renew: '<b>€39 per year, automatic renewal.</b> Cancel any time in your PayPal account (Payments → Manage automatic payments), free of charge and without justification; access continues until the end of the period already paid.'
    },
    ja: {
      kicker: 'サブスクリプション — 年額39ユーロ',
      titre: 'お申し込みの前に',
      intro: '「最新情報」のサブスクリプションは<strong>自動更新</strong>です。2点をご確認ください。',
      terms: '<b>年額39ユーロ</b>。本日決済のうえ、<b>毎年同じ日に自動更新</b>され、解約まで継続します。<b>いつでも無料で解約可能</b>（PayPal アカウント →「支払い」→「自動支払いを管理」）。解約後も支払済み期間の終了まではご利用いただけます。日割りの返金はありません。',
      age: '<strong>18歳以上</strong>です。',
      cgu: '上記の更新条件を読み、同意します。',
      under: '18歳未満です',
      go: '支払いへ進む',
      no: 'キャンセル',
      err: '両方のチェックが必要です。',
      refusTitre: 'サブスクリプションは成人の方のみ',
      refusTexte: '本サブスクリプションは自動更新の契約であり、保護者の同意があっても未成年の方はお申し込みいただけません。SuperPrint 本体は完全に無料で、年齢の確認も不要です。いま無料でお使いいただけます。',
      refusFermer: '閉じる',
      rc: 'この選択はこの端末にのみ保存されます。サーバーには送信されません。',
      renew: '<b>年額39ユーロ、自動更新。</b>PayPal アカウント（「支払い」→「自動支払いを管理」）からいつでも無料で解約できます。解約後も支払済み期間の終了まではご利用いただけます。'
    }
  };

  function langue() {
    var l = '';
    try { l = (document.documentElement.lang || '').toLowerCase().slice(0, 2); } catch (_) {}
    if (TEXTES[l]) return l;
    try {
      l = (localStorage.getItem('sp_lang') || '').toLowerCase().slice(0, 2);
      if (TEXTES[l]) return l;
    } catch (_) {}
    return 'fr';
  }

  function lire() {
    try { return JSON.parse(localStorage.getItem(CLE) || 'null'); } catch (_) { return null; }
  }

  function ecrire(obj) {
    try { localStorage.setItem(CLE, JSON.stringify(obj)); } catch (_) {}
  }

  /* Le consentement n'est valable que pour la version de texte acceptée ET pour
     une personne majeure. Une version antérieure du texte ne vaut plus : le
     visiteur doit relire ce qu'il accepte. */
  function aConsenti() {
    var c = lire();
    return !!(c && c.texte === VERSION_TEXTE && c.adulte === true && c.cgu === true);
  }

  var T = TEXTES[langue()];

  /* ── La mention de renouvellement, posée sous les boutons ─────────────────── */
  function poserMention() {
    var boutons = document.querySelectorAll('a[href]');
    var faits = [];
    for (var i = 0; i < boutons.length; i++) {
      var a = boutons[i];
      if (!estAbonnement.test(a.getAttribute('href') || '')) continue;
      /* Le lien de secours de la pop-in n'est pas un bouton d'offre : il vit dans
         un <p> et n'a pas à recevoir la mention. */
      if (/(^|\s)pay-pop-secours(\s|$)/.test(a.className || '')) continue;
      /* On s'accroche au bloc des boutons, pas au bas de la boîte : la mention doit
         être collée au bouton qu'elle qualifie. */
      var hote = a.parentNode;
      if (!hote || hote.tagName === 'P' || hote.tagName === 'LI') continue;
      if (faits.indexOf(hote) >= 0) continue;
      faits.push(hote);
      if (hote.querySelector(':scope > .sp-renew')) continue;
      var p = document.createElement('p');
      p.className = 'sp-renew';
      p.innerHTML = T.renew;
      /* Après le dernier bouton du bloc, donc juste sous les trois variantes
         FR/EN/JA de la même offre — et avant la note « paiement sécurisé », qui
         reste au bas de la carte. */
      var dernier = null;
      for (var j = 0; j < hote.children.length; j++) {
        var c = hote.children[j];
        if (c.tagName === 'A' && estAbonnement.test(c.getAttribute('href') || '')) dernier = c;
      }
      if (dernier) hote.insertBefore(p, dernier.nextSibling);
      else hote.appendChild(p);
    }
  }

  /* ── La fenêtre ───────────────────────────────────────────────────────────── */
  var gate = null, box = null, cbAge = null, cbCgu = null, btnGo = null, btnNo = null, btnUnder = null, err = null;
  var cible = null, precedant = null, modeRefus = false;

  function construire() {
    if (gate) return;
    gate = document.createElement('div');
    gate.className = 'sp-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.innerHTML =
      '<div class="sp-gate__box">' +
        '<p class="sp-gate__kicker"></p>' +
        '<h2 class="sp-gate__title"></h2>' +
        '<p class="sp-gate__text"></p>' +
        '<p class="sp-gate__terms"></p>' +
        '<label class="sp-gate__check"><input type="checkbox" data-age><span></span></label>' +
        '<label class="sp-gate__check"><input type="checkbox" data-cgu><span></span></label>' +
        '<button type="button" class="sp-gate__under"></button>' +
        '<p class="sp-gate__err" role="alert"></p>' +
        '<div class="sp-gate__actions">' +
          '<button type="button" class="sp-gate__go"></button>' +
          '<button type="button" class="sp-gate__no"></button>' +
        '</div>' +
        '<p class="sp-gate__rc"></p>' +
      '</div>';
    document.body.appendChild(gate);
    box = gate.querySelector('.sp-gate__box');
    cbAge = gate.querySelector('[data-age]');
    cbCgu = gate.querySelector('[data-cgu]');
    btnGo = gate.querySelector('.sp-gate__go');
    btnNo = gate.querySelector('.sp-gate__no');
    btnUnder = gate.querySelector('.sp-gate__under');
    err = gate.querySelector('.sp-gate__err');

    cbAge.addEventListener('change', majBouton);
    cbCgu.addEventListener('change', majBouton);

    /* ⚠️ LE REFUS DOIT ÊTRE UN CHOIX OFFERT, PAS UNE ABSENCE DE CASE.
       Sans ce bouton, « je n'ai pas coché » et « j'ai moins de 18 ans » seraient
       le même état : on ne pourrait pas distinguer une hésitation d'un refus, et
       l'éditeur n'aurait aucune trace de la seconde. C'est aussi ce qui rend le
       contrôle vérifiable — un refus explicite bloque le lien tout de suite. */
    btnUnder.addEventListener('click', function () {
      ecrire({ texte: VERSION_TEXTE, adulte: false, cgu: false, quand: new Date().toISOString() });
      refus = true;
      ouvrir(null, true);
    });

    btnGo.addEventListener('click', function () {
      if (modeRefus) { fermer(); return; }
      if (!cbAge.checked || !cbCgu.checked) { err.classList.add('sp-gate__err--on'); return; }
      ecrire({ texte: VERSION_TEXTE, adulte: true, cgu: true, quand: new Date().toISOString() });
      var el = cible;
      fermer();
      /* On rejoue le clic, cette fois en laissant passer : `permit` est le seul
         jeton qui autorise la traversée du filtre ci-dessous. */
      if (el) { permit = el; el.click(); permit = null; }
    });

    btnNo.addEventListener('click', function () { fermer(); });

    gate.addEventListener('mousedown', function (e) { if (e.target === gate) fermer(); });
    document.addEventListener('keydown', function (e) {
      if (!gate.classList.contains('sp-gate--open')) return;
      if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
      if (e.key !== 'Tab') return;
      var ordre = [cbAge, cbCgu, btnGo, btnNo];
      var k = ordre.indexOf(document.activeElement);
      if (k === -1) return;
      if (e.shiftKey && k === 0) { e.preventDefault(); ordre[ordre.length - 1].focus(); }
      else if (!e.shiftKey && k === ordre.length - 1) { e.preventDefault(); ordre[0].focus(); }
    });
  }

  function majBouton() {
    btnGo.disabled = !modeRefus && !(cbAge.checked && cbCgu.checked);
    if (cbAge.checked && cbCgu.checked) err.classList.remove('sp-gate__err--on');
  }

  function ouvrir(el, refus) {
    construire();
    T = TEXTES[langue()];
    modeRefus = !!refus;
    cible = el || null;
    precedant = document.activeElement;

    box.querySelector('.sp-gate__kicker').textContent = modeRefus ? '' : T.kicker;
    box.querySelector('.sp-gate__title').textContent = modeRefus ? T.refusTitre : T.titre;

    var txt = box.querySelector('.sp-gate__text');
    var trm = box.querySelector('.sp-gate__terms');
    var checks = box.querySelectorAll('.sp-gate__check');
    var rc = box.querySelector('.sp-gate__rc');

    txt.innerHTML = modeRefus ? T.refusTexte : T.intro;
    trm.innerHTML = T.terms;
    trm.style.display = modeRefus ? 'none' : '';
    cbAge.parentNode.style.display = modeRefus ? 'none' : '';
    cbCgu.parentNode.style.display = modeRefus ? 'none' : '';
    rc.textContent = modeRefus ? '' : T.rc;
    rc.style.display = modeRefus ? 'none' : '';

    /* ⚠️ LE <span> EST LE FRÈRE DE L'INPUT, PAS SON ENFANT.
       `cbAge.querySelector('span')` ne trouve rien — un <input> n'a pas de
       descendance — et l'affectation levait « Cannot set properties of null »,
       ce qui interrompait `ouvrir()` juste avant l'affichage : la fenêtre ne
       s'ouvrait jamais. Mesuré, puis corrigé ici. */
    cbAge.parentNode.querySelector('span').innerHTML = T.age;
    cbCgu.parentNode.querySelector('span').textContent = T.cgu;

    btnUnder.textContent = T.under;
    btnUnder.style.display = modeRefus ? 'none' : '';
    cbAge.checked = false;
    cbCgu.checked = false;

    btnGo.textContent = modeRefus ? T.refusFermer : T.go;
    btnNo.textContent = T.no;
    btnNo.style.display = modeRefus ? 'none' : '';
    err.textContent = T.err;
    err.classList.remove('sp-gate__err--on');
    majBouton();

    gate.classList.add('sp-gate--open');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    (modeRefus ? btnGo : cbAge).focus();
  }

  function fermer() {
    if (!gate) return;
    gate.classList.remove('sp-gate--open');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    /* Un refus d'âge laisse un drapeau : le lien reste inerte pour la session. */
    if (modeRefus) refus = true;
    if (precedant && precedant.focus) { try { precedant.focus(); } catch (_) {} }
    precedant = null;
  }

  /* ── Le filtre ─────────────────────────────────────────────────────────────
     Phase de capture : on passe avant le gestionnaire de `price.html` qui, lui,
     ouvre la pop-in PayPal. Sans ce `stopImmediatePropagation`, la pop-in
     s'ouvrirait derrière notre fenêtre. */
  var permit = null;
  var refus = false;

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && !(el.tagName === 'A' && el.getAttribute('href'))) el = el.parentNode;
    if (!el || el === document) return;
    if (!estAbonnement.test(el.getAttribute('href') || '')) return;

    if (permit === el) return;                        // clic rejoué après acceptation
    if (refus) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (aConsenti()) return;                          // déjà validé : on ne redemande rien

    e.preventDefault();
    e.stopImmediatePropagation();
    ouvrir(el, false);
  }, true);

  function demarrer() {
    poserMention();
    /* Un refus antérieur n'est pas mémorisé : la personne peut se tromper de
       bouton. Seule la session en cours reste bloquée après un refus explicite. */
    var c = lire();
    if (c && c.texte === VERSION_TEXTE && c.adulte === false) refus = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();

  /* La langue peut changer sans rechargement (sélecteur FR/EN/JA) : on réécrit la
     mention dans la nouvelle langue si un sélecteur est présent. */
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document && !(t.hasAttribute && t.hasAttribute('data-lang'))) t = t.parentNode;
    if (!t || t === document) return;
    setTimeout(function () {
      var vus = document.querySelectorAll('.sp-renew');
      for (var i = 0; i < vus.length; i++) vus[i].innerHTML = TEXTES[langue()].renew;
    }, 60);
  }, true);

  window.SPLegalGate = { version: VERSION_TEXTE, aConsenti: aConsenti, revoquer: function () { try { localStorage.removeItem(CLE); } catch (_) {} } };
})();
