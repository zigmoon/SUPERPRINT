
/* ═══ v1.7.606 — FORMULAIRE DE CONTACT (FAQ) : cinq sujets, composition du courrier (aucun serveur) ═══ */
(function () {
  var form = document.getElementById('bugForm');
  if (!form) return;
  var ou = document.getElementById('bugOu');
  var quoi = document.getElementById('bugQuoi');
  var mail = document.getElementById('bugMail');
  var corps = document.getElementById('bugCorps');
  var rangee = form.querySelector('.help-sujet-row');
  var err = document.getElementById('formErr');
  if (!ou || !quoi || !mail || !corps || !rangee) return;
  var pastilles = Array.prototype.slice.call(rangee.querySelectorAll('button[data-sujet]'));

  /* ── LES CINQ SUJETS ──────────────────────────────────────────────────────
     « objet » reste en FRANÇAIS : c'est la langue du destinataire
     (contact@superprint.cc), et l'objet doit être lisible d'un coup d'œil dans
     une boîte de réception. Les étiquettes et les aides, elles, suivent la
     langue de la page : l1 = premier champ, l2 = second, l4 = le message,
     p1/p2/p4 = leur texte grisé. */
  var D = {
    projet: {
      objet: 'Participer au projet',
      fr: { l1: 'Votre profil, ou ce que vous faites', p1: 'ex. traducteur, illustrateur, étudiant, développeur, imprimeur',
            l2: 'Comment vous voulez aider', p2: 'ex. traduire, tester, illustrer, relire la documentation, héberger',
            l4: 'Ce que vous proposez', p4: 'Quelques lignes suffisent : ce que vous aimeriez apporter au projet, et le temps que vous pouvez y mettre.' },
      en: { l1: 'Your background, or what you do', p1: 'e.g. translator, illustrator, student, developer, printer',
            l2: 'How you would like to help', p2: 'e.g. translate, test, illustrate, proofread the manual, host',
            l4: 'What you propose', p4: 'A few lines are enough: what you would like to bring to the project, and how much time you can give.' },
      ja: { l1: 'あなたの立場・お仕事', p1: '例：翻訳者、イラストレーター、学生、開発者、印刷所',
            l2: 'どのように協力できるか', p2: '例：翻訳、テスト、イラスト、マニュアルの校正、サーバー提供',
            l4: 'ご提案の内容', p4: '数行で結構です。プロジェクトに何を加えたいか、どのくらい時間を割けるかをご記入ください。' }
    },
    formation: {
      objet: 'Demande de formation',
      fr: { l1: 'Le logiciel concerné', p1: 'ex. SuperPrint Editor, Studio IA, SuperTyPo, les trois',
            l2: 'Votre niveau aujourd\'hui', p2: 'ex. je débute, je fais déjà des livres, je viens d\'un autre logiciel (InDesign, Scribus)',
            l4: 'Ce que vous voulez apprendre', p4: 'ex. la mise en page, les gabarits, l\'export PDF pour l\'imprimeur, le Studio IA' },
      en: { l1: 'Which software', p1: 'e.g. SuperPrint Editor, AI Studio, SuperTyPo, all three',
            l2: 'Your level today', p2: 'e.g. beginner, I already make books, I come from another tool (InDesign, Scribus)',
            l4: 'What you want to learn', p4: 'e.g. layout, templates, PDF export for the printer, the AI Studio' },
      ja: { l1: '対象のソフト', p1: '例：SuperPrint Editor、AIスタジオ、SuperTyPo、すべて',
            l2: '現在の習熟度', p2: '例：初心者、書籍を制作したことがある、他ソフト（InDesign、Scribus）から移行',
            l4: '学びたいこと', p4: '例：レイアウト、テンプレート、印刷所向けPDF書き出し、AIスタジオ' }
    },
    conseil: {
      objet: 'Demande de conseil',
      fr: { l1: 'Votre projet', p1: 'ex. un roman 14 × 21, un flyer A5, un catalogue, un PDF pour l\'imprimeur',
            l2: 'Où vous en êtes', p2: 'ex. rien n\'est commencé, j\'ai un fichier Word, j\'ai déjà un PDF',
            l4: 'Votre question', p4: 'Décrivez la question en quelques lignes : format, délai, budget, contraintes de l\'imprimeur.' },
      en: { l1: 'Your project', p1: 'e.g. a 14 × 21 novel, an A5 flyer, a catalogue, a print-ready PDF',
            l2: 'Where you stand', p2: 'e.g. nothing started, I have a Word file, I already have a PDF',
            l4: 'Your question', p4: 'Describe your question in a few lines: format, deadline, budget, printer constraints.' },
      ja: { l1: '制作物', p1: '例：14×21の小説、A5チラシ、カタログ、印刷用PDF',
            l2: '現在の状況', p2: '例：未着手、Wordファイルがある、PDFがある',
            l4: 'ご質問', p4: '書式、締切、予算、印刷所の条件などを数行でご記入ください。' }
    },
    bug: {
      objet: 'Rapport de bug',
      fr: { l1: 'Où ? (écran, outil, ou nom du fichier .sp)', p1: 'ex. écran Mise en page, outil Césure, fichier brochure.sp',
            l2: 'Ce que vous faisiez', p2: 'ex. j\'ai exporté en PDF, j\'ai changé la police, j\'ai relancé l\'aperçu',
            l4: 'Ce qui se passe, et ce que vous attendiez', p4: 'ex. le titre reste en gras alors qu\'il est réglé en maigre ; le PDF sort avec une page blanche à la fin.' },
      en: { l1: 'Where? (screen, tool, or .sp file name)', p1: 'e.g. Layout screen, Hyphenation tool, brochure.sp',
            l2: 'What you were doing', p2: 'e.g. I exported to PDF, I changed the font, I reopened the preview',
            l4: 'What happens, and what you expected', p4: 'e.g. the title stays bold although it is set to light; the PDF ends with a blank page.' },
      ja: { l1: 'どこで？（画面、ツール、.sp ファイル名）', p1: '例：レイアウト画面、ハイフネーション、brochure.sp',
            l2: '何をしていたか', p2: '例：PDF書き出し、フォント変更、プレビューの再表示',
            l4: '起きていること、期待していたこと', p4: '例：細字なのにタイトルが太字のまま、PDFの最後に白紙が入る。' }
    },
    presse: {
      objet: 'Presse',
      fr: { l1: 'Votre support', p1: 'ex. magazine, blog, chaîne vidéo, podcast, université, association',
            l2: 'Votre échéance', p2: 'ex. avant vendredi, pour le numéro de novembre, sans urgence',
            l4: 'Votre demande', p4: 'ex. logos haute définition, dossier de presse, captures d\'écran, interview, visuels des auteurs.' },
      en: { l1: 'Your outlet', p1: 'e.g. magazine, blog, video channel, podcast, university, non-profit',
            l2: 'Your deadline', p2: 'e.g. before Friday, for the November issue, no rush',
            l4: 'Your request', p4: 'e.g. high-definition logos, press kit, screenshots, interview, author photos.' },
      ja: { l1: '媒体・チャンネル', p1: '例：雑誌、ブログ、動画、ポッドキャスト、大学、団体',
            l2: '締切', p2: '例：金曜まで、11月号向け、急ぎではない',
            l4: 'ご依頼内容', p4: '例：高解像度ロゴ、プレスキット、画面キャプチャ、インタビュー、著者写真。' }
    }
  };

  var ERREURS = {
    sujet: { fr: 'Choisissez d\'abord votre sujet, puis remplissez le message.',
             en: 'Pick your subject first, then write your message.',
             ja: 'まずご用件を選び、本文をご記入ください。' },
    corps: { fr: 'Ajoutez au moins quelques mots — dans le message, ou dans le premier champ.',
             en: 'Add at least a few words — in the message, or in the first field.',
             ja: '本文（または最初の欄）に数行ご記入ください。' }
  };

  var SUJET = '';
  function langue() { return (document.documentElement.lang || 'en').toLowerCase().slice(0, 2); }
  function sujetCourant() { return SUJET ? D[SUJET] : null; }

  function poserEtiquettes(idChamp, cle) {
    var labs = form.querySelectorAll('label[for="' + idChamp + '"]');
    Array.prototype.forEach.call(labs, function (lab) {
      if (!lab.hasAttribute('data-defaut')) lab.setAttribute('data-defaut', lab.textContent);
      var lg = (lab.getAttribute('data-lang') || 'en');
      var s = sujetCourant();
      lab.textContent = (s && s[lg] && s[lg][cle]) ? s[lg][cle] : lab.getAttribute('data-defaut');
    });
  }
  function poserAide(el, cle) {
    if (!el.hasAttribute('data-defaut')) el.setAttribute('data-defaut', el.getAttribute('placeholder') || '');
    var s = sujetCourant();
    var lg = langue();
    el.setAttribute('placeholder', (s && s[lg] && s[lg][cle]) ? s[lg][cle] : el.getAttribute('data-defaut'));
  }
  function ecrireErreur(cle) {
    if (!err) return;
    err.setAttribute('data-err', cle);
    err.textContent = (ERREURS[cle] || {})[langue()] || (ERREURS[cle] || {}).en || '';
    err.hidden = !err.textContent;
  }
  function effacerErreur() {
    if (err) { err.hidden = true; err.removeAttribute('data-err'); }
    rangee.classList.remove('is-err');
    Array.prototype.forEach.call(form.querySelectorAll('.champ.is-err'), function (c) { c.classList.remove('is-err'); });
  }
  function maj() {
    poserEtiquettes('bugOu', 'l1');
    poserEtiquettes('bugQuoi', 'l2');
    poserEtiquettes('bugCorps', 'l4');
    poserAide(ou, 'p1');
    poserAide(quoi, 'p2');
    poserAide(corps, 'p4');
    if (err && !err.hidden && err.getAttribute('data-err')) ecrireErreur(err.getAttribute('data-err'));
  }

  function choisir(b) {
    SUJET = b.getAttribute('data-sujet') || '';
    pastilles.forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
    effacerErreur();
    maj();
  }
  pastilles.forEach(function (b) {
    b.addEventListener('click', function () {
      choisir(b);
      if (!ou.value) ou.focus();
    });
  });
  rangee.addEventListener('keydown', function (e) {
    var k = e.key, i = pastilles.indexOf(document.activeElement);
    if (i < 0 || ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].indexOf(k) < 0) return;
    e.preventDefault();
    var n = (k === 'ArrowRight' || k === 'ArrowDown') ? (i + 1) % pastilles.length : (i - 1 + pastilles.length) % pastilles.length;
    pastilles[n].focus();
    choisir(pastilles[n]);
  });

  [ou, quoi, mail, corps].forEach(function (el) {
    el.addEventListener('input', function () {
      var c = el.closest ? el.closest('.champ') : null;
      if (c) c.classList.remove('is-err');
      if (err && err.getAttribute('data-err') === 'corps') effacerErreur();
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = function (el) { return el && el.value ? el.value.trim() : ''; };
    var vou = v(ou), vquoi = v(quoi), vmail = v(mail), vcorps = v(corps);
    if (!SUJET) {
      rangee.classList.add('is-err');
      ecrireErreur('sujet');
      if (pastilles[0]) pastilles[0].focus();
      return;
    }
    if (!vcorps && !vou) {
      var champCorps = corps.closest ? corps.closest('.champ') : null;
      if (champCorps) champCorps.classList.add('is-err');
      ecrireErreur('corps');
      corps.focus();
      return;
    }
    var objet = D[SUJET].objet;
    var version = (document.querySelector('.brand-ver') || document.querySelector('.splash-version'));
    var titre = '[SuperPrint] ' + objet + (vou ? ' — ' + vou.slice(0, 60) : '');
    var lignes = [
      'Sujet : ' + objet,
      'De quoi il s\'agit : ' + (vou || '(non précisé)'),
      'Précisions : ' + (vquoi || '(non précisé)'),
      '',
      vcorps || '(à compléter)',
      '',
      'Courriel : ' + (vmail || '(non fourni)'),
      '',
      '—— informations techniques, ajoutées automatiquement ——',
      'Version de SuperPrint : ' + (version ? version.textContent.trim() : 'inconnue'),
      'Langue de la page : ' + langue().toUpperCase(),
      'Navigateur : ' + navigator.userAgent,
      'Page : ' + location.href
    ];
    var lien = 'mailto:contact@superprint.cc'
      + '?subject=' + encodeURIComponent(titre)
      + '&body=' + encodeURIComponent(lignes.join(String.fromCharCode(10)));
    try { document.dispatchEvent(new CustomEvent('sp:mailto', { detail: { href: lien, sujet: objet } })); } catch (x) {}
    window.location.href = lien;
  });

  maj();

  var setLangOrigine = window.setLang;
  if (typeof setLangOrigine === 'function') {
    window.setLang = function (l, explicite) { setLangOrigine(l, explicite); maj(); };
  }
})();
