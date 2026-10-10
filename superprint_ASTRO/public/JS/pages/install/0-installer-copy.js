
(function () {
  'use strict';

  // ─── Internationalisation (langue par défaut : EN) ───
  var I18N = {
    en: {
      prefsTitle: 'Preferences',
      prefsLang: 'Language',
      prefsInfo: 'About',
      prefsAboutText: 'SuperPrint — browser-based print layout software + SP213 AI studio.',
      pageTitle: 'SuperPrint — Online DTP Software & AI Layout Studio',
      homeSub: "<span class=\"hl\">Professional DTP</span> right in your browser",
      // 🖊️ Phrase propre au survol de « SuperPrint Editor » (avant : il
      //    retombait sur la phrase par défaut).
      editorBrandSub: "<span class=\"hl\">Editor</span> — compose your documents and layouts",
      // 🎭 Phrase affichee sous le LOGO quand il change au survol.
      //    Le NOM DE L'OUTIL est en clair (.hl) — jamais gris —, la
      //    description reste discrete derriere le tiret.
      studioBrandSub: "<span class=\"hl\">Studio IA</span> — describe a layout, the AI builds it",
      typoBrandSub: "<span class=\"hl\">SuperTyPo</span> — decompose, redraw and export type",
      docBrandSub: "<span class=\"hl\">Documentation</span> — manual, shortcuts, complete guide",
      apiBrandSub: "<span class=\"hl\">API</span> — drive SuperPrint from your own code",
      installTitle: 'Install locally',
      installDesc: 'Copy-paste this line: it downloads, installs and launches SuperPrint.',
      copyCmd: 'Copy the command',
      orLocal: 'or install locally',
      onlineLabel: 'Online',
      editorSub: 'No installation — runs in the browser',
      studioSub: 'AI layout studio',
      typoSub: 'Font editor',
      docSub: 'Manual, shortcuts',
      apiSub: 'Automate your layouts',
      osAuto: 'Detected automatically',
      footerLegal: 'Legal notice',
      footerPrivacy: 'Privacy',
      footerCookies: 'Cookies',
      footerNews: 'News',
      alphaNotice: 'Alpha software — provided as is, no warranty. Always check your document before printing.',
      legalTitle: 'Legal notice',
      privacyTitle: 'Privacy policy',
      cookiesTitle: 'Cookie policy',
      closeLabel: 'Close',
      legalBody: '<h4>1. Publisher and authors</h4><p>SuperPrint is designed, written and published by <b>Simon Dupont-Gellert</b> and <b>Clémence Brunet</b>, who jointly hold the authorship and the exploitation rights of the software, of its source code, of its visual identity and of this website.</p><p>Publisher and publication director: <b>Simon Dupont-Gellert</b>. Contact: <a href="https://x.com/SUPER_PRINT_app" target="_blank" rel="noopener noreferrer">@SUPER_PRINT_app</a>.</p><h4>2. Hosting</h4><p>This site and the online version are hosted by <b>OVH</b> — France, European Union. Data is hosted in France.</p><h4>3. ALPHA / BETA version — IMPORTANT</h4><p><b>SuperPrint is currently released as an ALPHA version.</b> It is under active development and may contain bugs, incomplete features, calculation errors or display defects. It is provided as an experimentation and assistance tool, not as a finished product.</p><h4>4. No warranty</h4><p>The software is provided <b>free of charge and "as is"</b>, without warranty of any kind, express or implied, including but not limited to merchantability, fitness for a particular purpose, or non-infringement of third-party rights. No guarantee is given that the software will operate without interruption or free of errors, or that the results obtained will be accurate or reliable.</p><h4>5. Printing and production — limitation of liability</h4><p>You are <b>solely responsible</b> for verifying your documents before any printing, publishing or industrial use: colours, colour space (RGB/CMYK/Pantone), bleed, margins, resolution, fonts, overprint, transparency flattening, trapping, page geometry and the final result.</p><p>The screen rendering, the soft-proof, the generated PDF and the exported files may differ from the printed result, depending on the press, the substrate, the ink, the RIP and the profile used.</p><p>To the fullest extent permitted by law, the publisher and the authors <b>shall not be liable</b> for any failed print run, any colour deviation, any misregistration, any misfeed or imposition error, any production downtime, any additional cost, or any direct or indirect, material or immaterial damage resulting from the use of the software or of the files it produces — including when the online version, the local installation, an AI-generated layout (SP213) or an AI-assisted function is involved.</p><h4>6. AI-generated content</h4><p>Layouts, texts, translations and images proposed by the artificial intelligence functions are provided <b>as assistance only</b>. They may be inaccurate, incomplete, biased or unsuitable. You remain fully responsible for reviewing, correcting, adapting and validating every element before any use or publication. No AI output may be considered as legal, accounting, medical or professional advice.</p><h4>7. Your responsibility as user</h4><p>You agree not to use the software for unlawful, misleading, defamatory or infringing purposes, and to hold all necessary rights over the contents (texts, images, logos, fonts) that you import or create. You are responsible for keeping a backup of your documents: the publisher cannot be held liable for any data loss, corruption or unavailability.</p><h4>8. Intellectual property</h4><p>All rights reserved. The name, the source code, the interface, the graphic identity and this site are protected by copyright and constitute the joint property of their authors. Any reproduction, distribution, decompilation, reverse engineering or commercial exploitation not expressly authorised is prohibited.</p><h4>9. Updates</h4><p>The publisher may modify, suspend or discontinue all or part of the software at any time, without notice and without liability, particularly during the alpha phase.</p><h4>10. Governing law</h4><p>These terms are governed by French law. In the event of a dispute, and subject to mandatory legal provisions to the contrary, the French courts shall have exclusive jurisdiction.</p><h4>11. Acceptance</h4><p>By using SuperPrint, you acknowledge having read, understood and accepted these terms without reservation. If you do not accept them, you must not use the software.</p>',
      privacyBody: '<p>SuperPrint does not require an account and does not collect any personal data.</p><h4>Processing is 100% local</h4><p>All the work happens in your browser: your documents, images and layouts never leave your machine for rendering.</p><h4>API keys</h4><p>The API keys you optionally provide for the AI features are stored only in your browser (local storage) and are sent only to the provider you explicitly choose. They are never sent to SuperPrint servers.</p><h4>No tracking</h4><p>No analytics, no advertising trackers, no profiling.</p><h4>Hosting</h4><p>This site is hosted in France (OVH), in the European Union, subject to the GDPR.</p><h4>Local storage</h4><p>We use local storage to remember your language and preferences. You can clear it at any time from your browser settings.</p>',
      cookiesBody: '<p>SuperPrint uses only strictly necessary technical cookies and local storage:</p><ul><li>Language preference</li><li>User settings (theme, layout, etc.)</li></ul><p>No advertising cookies.</p><p>No third-party tracking cookies.</p><p>No profiling.</p><p>No cookie is shared with third parties.</p>',
      langAttr: 'en'
    },
    fr: {
      prefsTitle: 'Préférences',
      prefsLang: 'Langue',
      prefsInfo: 'À propos',
      prefsAboutText: 'SuperPrint — logiciel de PAO dans le navigateur + studio IA SP213.',
      pageTitle: 'SuperPrint — PAO en ligne & studio IA SP213',
      homeSub: "<span class=\"hl\">PAO professionnelle</span> dans le navigateur",
      editorBrandSub: "<span class=\"hl\">Éditeur</span> — composez vos documents et vos maquettes",
      studioBrandSub: "<span class=\"hl\">Studio IA</span> — décrivez une maquette, l'IA la compose",
      typoBrandSub: "<span class=\"hl\">SuperTyPo</span> — décomposez, retravaillez et exportez la typo",
      docBrandSub: "<span class=\"hl\">Documentation</span> — manuel, raccourcis, guide complet",
      apiBrandSub: "<span class=\"hl\">API</span> — pilotez SuperPrint depuis votre code",
      installTitle: 'Installer en local',
      installDesc: 'Copiez-collez cette ligne : elle télécharge, installe puis lance SuperPrint.',
      copyCmd: 'Copier la commande',
      orLocal: 'ou installer en local',
      onlineLabel: 'En ligne — aucune installation',
      editorSub: 'Aucune installation — fonctionne dans le navigateur',
      studioSub: 'Studio de maquettes IA',
      typoSub: 'Éditeur de police',
      docSub: 'Manuel, raccourcis',
      apiSub: 'Automatisez vos maquettes',
      osAuto: 'Détecté automatiquement',
      footerLegal: 'Mentions légales',
      footerPrivacy: 'Confidentialité',
      footerCookies: 'Cookies',
      footerNews: 'News',
      alphaNotice: 'Logiciel en version alpha — fourni en l\'état, sans garantie. Vérifiez toujours votre document avant impression.',
      legalTitle: 'Mentions légales',
      privacyTitle: 'Politique de confidentialité',
      cookiesTitle: 'Politique de cookies',
      closeLabel: 'Fermer',
      legalBody: '<h4>1. Éditeur et auteurs</h4><p>SuperPrint est conçu, écrit et édité par <b>Simon Dupont-Gellert</b> et <b>Clémence Brunet</b>, qui détiennent conjointement la qualité d\'auteurs et les droits d\'exploitation du logiciel, de son code source, de son identité visuelle et du présent site.</p><p>Éditeur et directeur de la publication : <b>Simon Dupont-Gellert</b>. Contact : <a href="https://x.com/SUPER_PRINT_app" target="_blank" rel="noopener noreferrer">@SUPER_PRINT_app</a>.</p><h4>2. Hébergement</h4><p>Ce site et la version en ligne sont hébergés par <b>OVH</b> — France, Union européenne. Les données sont hébergées en France.</p><h4>3. Version ALPHA / BETA — IMPORTANT</h4><p><b>SuperPrint est actuellement diffusé en version ALPHA.</b> Il est en cours de développement et peut contenir des anomalies, des fonctions incomplètes, des erreurs de calcul ou des défauts d\'affichage. Il est fourni comme outil d\'expérimentation et d\'assistance, et non comme un produit fini.</p><h4>4. Absence de garantie</h4><p>Le logiciel est fourni <b>gratuitement et « en l\'état »</b>, sans garantie d\'aucune sorte, expresse ou implicite, y compris, sans limitation, la qualité marchande, l\'adéquation à un usage particulier ou l\'absence de contrefaçon de droits de tiers. Aucune garantie n\'est donnée que le logiciel fonctionnera sans interruption ou sans erreur, ni que les résultats obtenus seront exacts ou fiables.</p><h4>5. Impression et fabrication — limitation de responsabilité</h4><p>Vous êtes <b>seul responsable</b> de la vérification de vos documents avant toute impression, publication ou exploitation industrielle : couleurs, espace colorimétrique (RVB/CMJN/Pantone), fonds perdus, marges, résolution, polices, surimpression, aplatissement des transparences, trapping, géométrie des pages et résultat final.</p><p>Le rendu à l\'écran, la simulation, le PDF généré et les fichiers exportés peuvent différer du résultat imprimé, selon la presse, le support, l\'encre, le RIP et le profil utilisés.</p><p>Dans toute la mesure permise par la loi, l\'éditeur et les auteurs <b>ne sauraient être tenus responsables</b> d\'un échec d\'impression, d\'un écart de couleur, d\'un défaut de repérage, d\'une erreur d\'imposition ou d\'alimentation, d\'un arrêt de production, d\'un surcoût, ni d\'aucun dommage direct ou indirect, matériel ou immatériel, résultant de l\'utilisation du logiciel ou des fichiers qu\'il produit — y compris lorsque la version en ligne, l\'installation locale, une maquette générée par IA (SP213) ou une fonction assistée par IA sont en cause.</p><h4>6. Contenus générés par IA</h4><p>Les maquettes, textes, traductions et images proposés par les fonctions d\'intelligence artificielle sont fournis <b>à titre d\'assistance uniquement</b>. Ils peuvent être inexacts, incomplets, biaisés ou inadaptés. Vous demeurez entièrement responsable de la relecture, de la correction, de l\'adaptation et de la validation de chaque élément avant tout usage ou publication. Aucun résultat d\'IA ne peut être considéré comme un conseil juridique, comptable, médical ou professionnel.</p><h4>7. Vos responsabilités d\'utilisateur</h4><p>Vous vous engagez à ne pas utiliser le logiciel à des fins illicites, trompeuses, diffamatoires ou contrefaisantes, et à détenir l\'ensemble des droits nécessaires sur les contenus (textes, images, logos, polices) que vous importez ou créez. Il vous appartient de conserver une sauvegarde de vos documents : l\'éditeur ne peut être tenu responsable d\'une perte, d\'une corruption ou d\'une indisponibilité de données.</p><h4>8. Propriété intellectuelle</h4><p>Tous droits réservés. Le nom, le code source, l\'interface, l\'identité graphique et le présent site sont protégés par le droit d\'auteur et constituent la propriété conjointe de leurs auteurs. Toute reproduction, diffusion, décompilation, ingénierie inverse ou exploitation commerciale non expressément autorisée est interdite.</p><h4>9. Évolutions</h4><p>L\'éditeur peut modifier, suspendre ou interrompre tout ou partie du logiciel à tout moment, sans préavis et sans engager sa responsabilité, particulièrement pendant la phase alpha.</p><h4>10. Droit applicable</h4><p>Les présentes conditions sont soumises au droit français. En cas de litige, et sous réserve des dispositions légales impératives contraires, les tribunaux français seront seuls compétents.</p><h4>11. Acceptation</h4><p>En utilisant SuperPrint, vous reconnaissez avoir lu, compris et accepté sans réserve les présentes conditions. Si vous ne les acceptez pas, vous ne devez pas utiliser le logiciel.</p>',
      privacyBody: '<p>SuperPrint ne nécessite aucun compte et ne collecte aucune donnée personnelle.</p><h4>Traitement 100 % local</h4><p>Tout le travail s\'effectue dans votre navigateur : vos documents, images et maquettes ne quittent jamais votre machine pour le rendu.</p><h4>Clés API</h4><p>Les clés API que vous fournissez éventuellement pour les fonctionnalités IA sont stockées uniquement dans votre navigateur (stockage local) et ne sont envoyées qu\'au fournisseur que vous choisissez explicitement. Elles ne sont jamais envoyées aux serveurs de SuperPrint.</p><h4>Aucun suivi</h4><p>Aucun outil de statistiques, aucun traceur publicitaire, aucun profilage.</p><h4>Hébergement</h4><p>Ce site est hébergé en France (OVH), dans l\'Union européenne, soumis au RGPD.</p><h4>Stockage local</h4><p>Nous utilisons le stockage local pour mémoriser votre langue et vos préférences. Vous pouvez l\'effacer à tout moment depuis les paramètres de votre navigateur.</p>',
      cookiesBody: '<p>SuperPrint n\'utilise que des cookies et stockages locaux strictement techniques et nécessaires :</p><ul><li>Préférence de langue</li><li>Réglages utilisateur (thème, mise en page, etc.)</li></ul><p>Aucun cookie publicitaire.</p><p>Aucun cookie de suivi tiers.</p><p>Aucun profilage.</p><p>Aucun cookie n\'est partagé avec des tiers.</p>',
      langAttr: 'fr'
    },
    ja: {
      prefsTitle: '設定',
      prefsLang: '言語',
      prefsInfo: '情報',
      prefsAboutText: 'SuperPrint — ブラウザで動作する印刷レイアウトソフトウェア + SP213 AIスタジオ。',
      pageTitle: 'SuperPrint — 無料オンラインDTP & SP213 AIスタジオ',
      homeSub: "ブラウザで本格<span class=\"hl\">DTP</span>",
      editorBrandSub: "<span class=\"hl\">エディタ</span> — 文書とレイアウトを作成",
      studioBrandSub: "<span class=\"hl\">Studio IA</span> — 説明するだけでAIがレイアウトを作成",
      typoBrandSub: "<span class=\"hl\">SuperTyPo</span> — 書体を分解・再編集・書き出し",
      docBrandSub: "<span class=\"hl\">Documentation</span> — マニュアル、ショートカット、完全ガイド",
      apiBrandSub: "<span class=\"hl\">API</span> — 自分のコードでSuperPrintを操作",
      installTitle: 'ローカルにインストール',
      installDesc: 'この行をコピー＆ペーストしてください：ダウンロード、インストール、起動まで行います。',
      copyCmd: 'コマンドをコピー',
      orLocal: 'またはローカルにインストール',
      onlineLabel: 'オンライン — インストール不要',
      editorSub: 'インストール不要 — ブラウザで動作',
      studioSub: 'AIレイアウトスタジオ',
      typoSub: 'フォントエディタ',
      docSub: 'マニュアル、ショートカット',
      apiSub: 'レイアウトを自動生成',
      osAuto: '自動検出',
      footerLegal: '法的通知',
      footerPrivacy: 'プライバシー',
      footerCookies: 'クッキー',
      footerNews: 'News',
      alphaNotice: 'アルファ版ソフトウェア — 現状のまま提供、無保証。印刷前に必ず文書を確認してください。',
      legalTitle: '法的通知',
      privacyTitle: 'プライバシーポリシー',
      cookiesTitle: 'クッキーポリシー',
      closeLabel: '閉じる',
      legalBody: '<h4>1. 発行者および著作者</h4><p>SuperPrint は <b>Simon Dupont-Gellert</b> と <b>Clémence Brunet</b> によって設計・制作・発行されています。両名は、本ソフトウェア、そのソースコード、ビジュアルアイデンティティおよび本サイトの著作者としての権利ならびに利用権を共同で保有します。</p><p>発行者および出版責任者：<b>Simon Dupont-Gellert</b>。連絡先：<a href="https://x.com/SUPER_PRINT_app" target="_blank" rel="noopener noreferrer">@SUPER_PRINT_app</a>。</p><h4>2. ホスティング</h4><p>本サイトおよびオンライン版は <b>OVH</b>（フランス、欧州連合）がホストしています。データはフランス国内に保管されます。</p><h4>3. ALPHA／BETA 版 — 重要</h4><p><b>SuperPrint は現在 ALPHA 版として公開されています。</b> 開発中のため、不具合、未完成の機能、計算誤り、表示上の欠陥が含まれる可能性があります。完成品ではなく、実験および支援のためのツールとして提供されます。</p><h4>4. 無保証</h4><p>本ソフトウェアは<b>無償かつ「現状のまま」</b>提供され、明示・黙示を問わずいかなる保証も行いません。商品性、特定目的への適合性、第三者の権利の非侵害を含みますがこれらに限定されません。中断やエラーなく動作すること、得られる結果が正確または信頼できることは保証されません。</p><h4>5. 印刷および製造 — 責任の制限</h4><p>印刷、公開、産業利用の前に文書を確認する責任は<b>すべて利用者にあります</b>：色、色空間（RGB／CMYK／Pantone）、塗り足し、余白、解像度、フォント、オーバープリント、透明の平坦化、トラッピング、ページ形状、最終結果。</p><p>画面表示、ソフトプルーフ、生成された PDF および書き出したファイルは、使用する印刷機、用紙、インキ、RIP、プロファイルによって印刷結果と異なる場合があります。</p><p>法律で認められる最大限の範囲において、発行者および著作者は、印刷の失敗、色のずれ、見当ずれ、面付けや給紙のエラー、生産停止、追加費用、その他直接的・間接的、有形・無形の損害について<b>一切責任を負いません</b>。オンライン版、ローカル版、AI 生成レイアウト（SP213）、AI 支援機能による場合も同様です。</p><h4>6. AI 生成コンテンツ</h4><p>人工知能機能が提案するレイアウト、テキスト、翻訳、画像は<b>支援目的のみ</b>で提供されます。不正確、不完全、偏り、不適切である可能性があります。使用または公開の前に、各要素を確認・修正・調整・検証する責任は利用者にあります。AI の出力は、法的・会計的・医学的・専門的助言とみなされません。</p><h4>7. 利用者の責任</h4><p>違法、誤解を招く、名誉毀損的、または権利侵害的な目的で本ソフトウェアを使用しないこと、および取り込む・作成するコンテンツ（テキスト、画像、ロゴ、フォント）に関する必要な権利をすべて保有することを約束するものとします。文書のバックアップは利用者の責任です。データの損失、破損、利用不能について発行者は責任を負いません。</p><h4>8. 知的財産</h4><p>All rights reserved. 名称、ソースコード、インターフェース、グラフィックアイデンティティおよび本サイトは著作権で保護され、著作者の共同財産です。明示的に許可されていない複製、配布、逆コンパイル、リバースエンジニアリング、商業利用は禁止されます。</p><h4>9. 変更</h4><p>発行者は、特にアルファ段階において、予告なく本ソフトウェアの全部または一部を変更、停止、終了することができ、責任を負いません。</p><h4>10. 準拠法</h4><p>本条件はフランス法に準拠します。紛争が生じた場合、強行的な法規定に反しない限り、フランスの裁判所が専属的管轄権を有します。</p><h4>11. 同意</h4><p>SuperPrint を使用することにより、本条件を読み、理解し、留保なく同意したものとみなされます。同意されない場合は、本ソフトウェアを使用しないでください。</p>',
      privacyBody: '<p>SuperPrint はアカウントを必要とせず、個人データを収集しません。</p><h4>処理は100%ローカル</h4><p>すべての作業はブラウザ内で行われます。ドキュメント、画像、レイアウトがレンダリングのために端末の外に出ることはありません。</p><h4>API キー</h4><p>AI機能のために任意で提供する API キーは、ブラウザ（ローカルストレージ）にのみ保存され、明示的に選択したプロバイダーにのみ送信されます。SuperPrint のサーバーに送信されることはありません。</p><h4>トラッキングなし</h4><p>統計ツール、広告トラッカー、プロファイリングは一切ありません。</p><h4>ホスティング</h4><p>このサイトはフランス（OVH）、欧州連合内でホストされ、GDPR の対象です。</p><h4>ローカルストレージ</h4><p>言語や設定を記憶するためにローカルストレージを使用します。ブラウザの設定からいつでも消去できます。</p>',
      cookiesBody: '<p>SuperPrint は、厳密に必要な技術的クッキーとローカルストレージのみを使用します：</p><ul><li>言語設定</li><li>ユーザー設定（テーマ、レイアウトなど）</li></ul><p>広告クッキーはありません。</p><p>第三者による追跡クッキーはありません。</p><p>プロファイリングはありません。</p><p>クッキーが第三者と共有されることはありません。</p>',
      langAttr: 'ja'
    }
  };
  var DEFAULT_LANG = 'en';
  var LANG_KEY = 'sp_lang'; // clé SHARED avec l'app SuperPrint et le studio SP213
  function getHomeLang() {
    try {
      // Migration depuis l'ancienne clé de la home
      var legacy = localStorage.getItem('sp_home_lang');
      if (legacy === 'en' || legacy === 'fr' || legacy === 'ja') {
        localStorage.setItem(LANG_KEY, legacy);
        localStorage.removeItem('sp_home_lang');
        return legacy;
      }
      var saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en' || saved === 'fr' || saved === 'ja') return saved;
    } catch (e) {}
    return DEFAULT_LANG;
  }
  function applyHomeLang(lang) {
    var dict = I18N[lang] || I18N[DEFAULT_LANG];
    document.documentElement.setAttribute('lang', dict.langAttr || lang);
    if (dict.pageTitle) document.title = dict.pageTitle;
    // 🎭 La phrase sous le logotype suit la couche AFFICHEE : le logotype
    //    dynamique memorise sa cle i18n dans `stack.dataset.subKey`, on la
    //    rejoue ici pour que la traduction reste juste apres un changement
    //    de langue. Les autres elements gardent leur data-i18n statique.
    var _stack = document.getElementById('brandLogoStack');
    if (_stack) {
      var _subEl = document.querySelector('.welcome-brand .sub');
      if (_subEl) _subEl.setAttribute('data-i18n', _stack.dataset.subKey || 'homeSub');
    }
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!dict[key]) return;
      var html = el.getAttribute('data-i18n-html') === '1';
      if (html) el.innerHTML = dict[key]; else el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (dict[key]) el.setAttribute('title', dict[key]);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      if (dict[key]) el.setAttribute('aria-label', dict[key]);
    });
    var sel = document.getElementById('homeLangSelect');
    if (sel) sel.value = lang;
  }
  function setHomeLang(lang) {
    try {
      localStorage.setItem(LANG_KEY, lang); // partagé : home + app + studio
      localStorage.removeItem('sp_home_lang'); // nettoyage ancienne clé
    } catch (e) {}
    applyHomeLang(lang);
    // Rafraîchir le hint d'installation dans la langue choisie
    var activeOs = (document.querySelector('.cmd-tab.active') || {}).getAttribute ? document.querySelector('.cmd-tab.active').getAttribute('data-os') : 'win';
    var hints = INSTALL_HINTS[activeOs] || {};
    var hintEl = $('installHint');
    if (hintEl) hintEl.textContent = hints[lang] || hints.en || '';
  }

  // ─── Pop-in préférences ───
  function openHomeSettings() {
    var overlay = document.getElementById('homeSettingsOverlay');
    if (overlay) overlay.classList.add('open');
    applyHomeLang(getHomeLang());
  }
  function closeHomeSettings() {
    var overlay = document.getElementById('homeSettingsOverlay');
    if (overlay) overlay.classList.remove('open');
  }
  window.openHomeSettings = openHomeSettings;
  window.closeHomeSettings = closeHomeSettings;
  window.setHomeLang = setHomeLang;

  // ─── Pop-ins légaux (footer : mentions légales, confidentialité, cookies) ───
  function openLegal(id) {
    var ov = document.getElementById(id);
    if (ov) ov.classList.add('open');
    applyHomeLang(getHomeLang());
  }
  function closeLegal(id) {
    var ov = document.getElementById(id);
    if (ov) ov.classList.remove('open');
  }
  window.openLegal = openLegal;
  window.closeLegal = closeLegal;

  // Applique la langue au chargement (EN par défaut)
  applyHomeLang(getHomeLang());

  var INSTALL_CMDS = {
    win: 'npx.cmd superprint',
    mac: 'npx superprint',
    linux: 'npx superprint'
  };
  var INSTALL_HINTS = {
    win: {
      en: 'PowerShell · npx.cmd bypasses the script ExecutionPolicy block',
      fr: 'PowerShell · npx.cmd contourne le blocage de scripts (ExecutionPolicy)',
      ja: 'PowerShell · npx.cmd はスクリプト実行ポリシーの制限を回避します'
    },
    mac: {
      en: 'Terminal · installs and launches SuperPrint (requires Node.js)',
      fr: 'Terminal · installe et lance SuperPrint (requiert Node.js)',
      ja: 'ターミナル · SuperPrint をインストールして起動します（Node.js が必要）'
    },
    linux: {
      en: 'Terminal · installs and launches SuperPrint (requires Node.js)',
      fr: 'Terminal · installe et lance SuperPrint (requiert Node.js)',
      ja: 'ターミナル · SuperPrint をインストールして起動します（Node.js が必要）'
    }
  };
  // Icônes SVG par OS — formes géométriques nettes et propres
  var OS_ICONS = {
    win: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><rect x="0" y="0" width="10.5" height="10.5" fill="currentColor"/><rect x="13.5" y="0" width="10.5" height="10.5" fill="currentColor"/><rect x="0" y="13.5" width="10.5" height="10.5" fill="currentColor"/><rect x="13.5" y="13.5" width="10.5" height="10.5" fill="currentColor"/></svg>',
    mac: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702"/></svg>',
    linux: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 12 18.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 12 5 5.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 12 6.2 19.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>'
  };
  var $ = function (id) { return document.getElementById(id); };

  // 🖥️ Détection automatique de l'OS du visiteur → active le bon onglet,
  // affiche la bonne commande et l'icône de sa machine.
  function detectOS() {
    var ua = navigator.userAgent || '';
    if (/Windows/i.test(ua)) return 'win';
    if (/Mac|iPhone|iPad|iPod/i.test(ua)) return 'mac';
    if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
    return 'win';
  }
  function setOsIcon(os) {
    var ic = $('osIcon');
    if (ic && OS_ICONS[os]) ic.innerHTML = OS_ICONS[os];
  }
  function applyOS(os) {
    var tab = document.querySelector('.cmd-tab[data-os="' + os + '"]');
    if (!tab) tab = document.querySelector('.cmd-tab[data-os="win"]');
    document.querySelectorAll('.cmd-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    var key = tab.getAttribute('data-os');
    $('installCmd').textContent = INSTALL_CMDS[key];
    var hints = INSTALL_HINTS[key] || {};
    $('installHint').textContent = hints[getHomeLang()] || hints.en || '';
    setOsIcon(key);
  }

  document.querySelectorAll('.cmd-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.cmd-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var os = tab.getAttribute('data-os');
      $('installCmd').textContent = INSTALL_CMDS[os];
      var hints = INSTALL_HINTS[os] || {};
      $('installHint').textContent = hints[getHomeLang()] || hints.en || '';
      setOsIcon(os);
    });
  });

  // Au chargement : détecter l'OS et présélectionner la bonne commande + icône
  applyOS(detectOS());

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = $('installCmd').textContent.trim();
      var oldHTML = btn.innerHTML;
      var done = function () {
        btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function () { btn.innerHTML = oldHTML; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { fallback(btn, text, done); });
      } else { fallback(btn, text, done); }
    });
  });
  function fallback(btn, text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
    done();
  }

  // ───────────────────────────────────────────────────────────────────────
  // 🎭 Logotype dynamique du header.
  //    Survol (ou focus clavier) d'un CTA → le logotype change ;
  //    la souris quitte le CTA → retour au logo SuperPrint.
  //    Les CTA sans logotype dédié (Editor, Documentation) gardent SuperPrint.
  // ───────────────────────────────────────────────────────────────────────
  (function () {
    var stack = $('brandLogoStack');
    if (!stack) return;

    var layers = {
      'default': stack.querySelector('.ls-default'),
      'studio': stack.querySelector('.ls-studio'),
      'typo': stack.querySelector('.ls-typo'),
      'doc': stack.querySelector('.ls-doc'),
      'api': stack.querySelector('.ls-api')
    };

    // Préchargement : sans ça, le 1er survol afficherait un carré blanc
    // le temps que le SVG arrive du réseau. (Les icônes filaires sont des
    // SVG INLINE : aucun charnement réseau, donc rien à précharger.)
    Object.keys(layers).forEach(function (k) {
      var el = layers[k];
      if (!el) return;
      var src = el.getAttribute('src');
      if (src) { var pre = new Image(); pre.src = src; }
    });

    // Phrase sous le logotype, par couche. `homeSub` = phrase historique
    // « All of SuperPrint — DTP + SP213 AI studio » (libelle « Studio IA »).
    var SUB_KEY = {
      'default': 'homeSub',
      // 🖊️ La ligne Editor a SA phrase (elle partageait le defaut avant).
      editor: 'editorBrandSub',
      studio: 'studioBrandSub',
      typo: 'typoBrandSub',
      doc: 'docBrandSub',
      api: 'apiBrandSub'
    };

    // 🔤 TITRE (h1) : il prend le NOM DE L'OUTIL au survol (demande utilisateur).
    //    Noms propres → identiques dans les 3 langues, aucune traduction requise.
    var TITLE = {
      'default': 'SuperPrint',
      editor: 'SuperPrint',
      studio: 'Studio IA',
      typo: 'SuperTyPo',
      doc: 'Documentation',
      api: 'API'
    };

    // 🖊️ Chaque ligne a desormais SON visuel : logotype pour Studio /
    //    SuperTyPo, icône filaire pour Documentation / API. Plus aucune
    //    ligne ne retombe sur le logo SuperPrint.
    function show(key) {
      var target = layers[key] || layers['default'];
      Object.keys(layers).forEach(function (k) {
        if (layers[k]) layers[k].classList.toggle('is-on', layers[k] === target);
      });
      // 🔤 Le TITRE affiche le nom de l'outil survole.
      var h1 = document.querySelector('.welcome-brand h1');
      if (h1) h1.textContent = TITLE[key] || TITLE['default'];
      // 🔤 La phrase change AVEC le logotype (demande utilisateur).
      var keyName = SUB_KEY[key] || 'homeSub';
      stack.dataset.subKey = keyName;
      var sub = document.querySelector('.welcome-brand .sub');
      if (sub) {
        sub.setAttribute('data-i18n', keyName);
        var dict = I18N[getHomeLang()] || I18N[DEFAULT_LANG];
        if (dict[keyName]) sub.innerHTML = dict[keyName];
      }
    }

    // data-brand de la ligne → nom de la couche. Absent = logo SuperPrint.
    // 'editor' n'a pas de data-brand (la ligne Editor n'a pas de visuel
    // dedie) : on la reconnait a son id, et elle garde le logo SuperPrint
    // tout en prenant SA phrase.
    var BY_BRAND = { editor: 'editor', studio: 'studio', typo: 'typo', doc: 'doc', api: 'api' };

    document.querySelectorAll('.online-row').forEach(function (row) {
      // La ligne Editor est identifiee par son identifiant (pas de data-brand).
      var brand = row.getAttribute('data-brand') || (row.id === 'onlineSpBtn' ? 'editor' : null);
      var layer = BY_BRAND[brand] || 'default';
      var onEnter = function () { show(layer); };
      var onLeave = function () { show('default'); };
      row.addEventListener('mouseenter', onEnter);
      row.addEventListener('mouseleave', onLeave);
      // Accessibilité : même comportement au clavier (Tab), sans souris.
      row.addEventListener('focus', onEnter);
      row.addEventListener('blur', onLeave);
    });
  })();
})();
