/* =========================================================================
   SUPERPRINT — VIRTUAL PRINT STUDIO  (imprimante virtuelle)
   ------------------------------------------------------------------------
   Pop-in INDÉPENDANTE de la boîte d'export (PDF/PNG/JPG).
   Déclenchée par le bouton 🖨️ de la barre d'outils ou Ctrl+Alt+P.

   DA : ALIGNÉE sur la boîte d'Imposition (flat plan) de SuperPrint :
   - structure : .modal-overlay > .modal.sp-modal-card > .modal-header
     + .modal-body (.modal-section > .modal-section-title + .modal-options
     > .modal-option > input + label + .modal-option-desc) + .modal-footer
     (.modal-btn-primary / .modal-btn-secondary)
   - style : fonds #f8f8f8, inputs 18px accent #000, labels 11px,
     descriptions 9px #666, titres de section 10px uppercase opacity .6,
     boutons IBM Plex Mono, monochrome (peu de couleur).

   Contenu :
   - Pré-flight : format, pages, bleed, marges, résolution images,
     polices, couverture d'encre, espace colorimétrique.
   - Aperçu presse (vignettes AVEC fonds perdus en option, orientation
     portrait/paysage).
   - FONDS PERDUS : toggle + prise en compte dans le PDF.
   - Imposition : lien vers showImposition().
   - Relecture typo (règles EN/FR/JA).
   - Réglages : papier, orientation, qualité, copies (persistés).
   - CTA « Imprimer » → PDF indépendant (pdf-lib, bleed, orientation) +
     dialogue natif.

   Exposes : window.SPPrintStudio
   ========================================================================= */
(function () {
    'use strict';

    var VERSION = '20260830-v282-vps';
    var LS_KEY = 'sp_vps_prefs';
    var overlayId = 'vpsOverlay';
    var DEBUG = false;

    // ─── i18n (EN / FR / JA) ───
    function lang() {
        try { if (typeof currentLanguage === 'string' && currentLanguage) return currentLanguage; } catch (_) {}
        try { const s = localStorage.getItem('sp_lang'); if (s === 'en' || s === 'fr' || s === 'ja') return s; } catch (_) {}
        return 'en';
    }
    var I18N = {
        en: {
            title: 'Virtual Print Studio',
            subtitle: 'Pre-flight, bleed & imposition — independent from PDF export',
            preflight: 'Pre-flight',
            printer: 'Printer',
            job: 'Print job',
            format: 'Format', pages: 'Pages', bleed: 'Bleed', margin: 'Margin',
            quality: 'Quality', copies: 'Copies', paper: 'Paper',
            orientation: 'Orientation', orientationP: 'Portrait', orientationL: 'Landscape',
            analyze: 'Analyzing…', ok: 'Ready to print', close: 'Close', print: 'Print',
            resTitle: 'Image resolution', resLow: 'Low-res image', resOk: 'Resolution OK', resNone: 'No images',
            fontsTitle: 'Fonts', fontsNone: 'No text',
            inkTitle: 'Ink coverage', inkLow: 'Light', inkMed: 'Medium', inkHigh: 'Heavy',
            colorTitle: 'Color space', colorRGB: 'RGB', colorGray: 'Grayscale', colorAlpha: 'Transparency',
            warning: 'warning', okBadge: 'OK', empty: 'No page to print', vpThumb: 'Page {n}',
            dragReorder: 'Drag to reorder pages',
            paperA4: 'A4 (210×297 mm)', paperA3: 'A3 (297×420 mm)', paperA5: 'A5 (148×210 mm)',
            paperLetter: 'Letter (216×279 mm)', paperCustom: 'Document format',
            copiesLabel: 'copies',
            qualityStandard: 'Standard (72 dpi)', qualityMedium: 'Medium (150 dpi)',
            qualityHD: 'HD (300 dpi)', qualityUltra: 'ULTRA HD (600 dpi)',
            showBleed: 'Show bleed', showBleedHint: 'Display the bleed zone around each page',
            openImposition: 'Imposition', openImpositionHint: 'Open the imposition layout (booklet / spread) before printing',
            typoCheck: 'Typography check', typoCheckHint: 'Double spaces, spacing before punctuation, non-breaking spaces, etc.',
            typoNone: 'No typography issues found', typoSome: 'typography issue(s) found',
            typoTitle: 'Typography check', typoRun: 'Run check',
            printCta: 'Generate print PDF', printNote: 'The PDF is generated independently (bleed included), then the system dialog opens to choose your printer (network printers included).',
            detected: 'Detected automatically',
            pdfError: 'PDF generation error',
            sectionPrint: 'Print settings', sectionReport: 'Pre-flight report', sectionActions: 'Tools',
            netPrinters: 'Network printers', netPrintersHint: 'Detected on the local network via the local print bridge (sp213-local). Select one to print directly over IPP — no PDF dialog needed.',
            netBridgeOff: 'Local print bridge not detected', netBridgeOffHint: 'Start it with "npm run print:bridge" in sp213-local to enable direct network printing.',
            netScan: 'Scan network', netScanning: 'Scanning…', netNone: 'No network printer found',
            netPrintOn: 'Print to', netColor: 'Color', netBW: 'B&W', netDuplex: 'Duplex', netOneSided: 'One-sided', netPrinting: 'Sending to printer…', netSent: 'Sent to printer', netErr: 'Network print failed', netModel: 'Model', netStatus: 'Status', netReady: 'Ready', netIdle: 'Idle', netBusy: 'Busy', netOffline: 'Offline', netUnknown: 'Unknown',
            colorMode: 'Color mode', colorModeColor: 'Color', colorModeBW: 'B&W',
            pagesToPrint: 'Pages to print', pagesAll: 'All', pagesActive: 'Active', pagesCustom: 'Pages', pagesCustomPh: 'e.g. 1,3-5,7',
            pagesParity: 'Parity', pagesParityAll: 'All', pagesParityEven: 'Even pages', pagesParityOdd: 'Odd pages',
            scaling: 'Page handling', scaleFit: 'Fit', scaleActual: 'Actual size', scaleCustom: 'Custom scale',
            duplex: 'Duplex (two-sided)',
            paperA6: 'A6 (105×148 mm)', paperSRA3: 'SRA3 (320×450 mm)', paperCustomSize: 'Custom size',
            tabSettings: 'Print settings', tabPreflight: 'Pre-flight', tabPreview: 'Preview'
        },
        fr: {
            title: 'Atelier d\'impression virtuel',
            subtitle: 'Pré-vol, fonds perdus & imposition — indépendant de l\'export PDF',
            preflight: 'Pré-vol',
            printer: 'Imprimante',
            job: 'Travail',
            format: 'Format', pages: 'Pages', bleed: 'Fond perdu', margin: 'Marges',
            quality: 'Qualité', copies: 'Copies', paper: 'Papier',
            orientation: 'Orientation', orientationP: 'Portrait', orientationL: 'Paysage',
            analyze: 'Analyse…', ok: 'Prêt à imprimer', close: 'Fermer', print: 'Imprimer',
            resTitle: 'Résolution des images', resLow: 'Image basse résolution', resOk: 'Résolution OK', resNone: 'Aucune image',
            fontsTitle: 'Polices', fontsNone: 'Aucun texte',
            inkTitle: 'Couverture d\'encre', inkLow: 'Faible', inkMed: 'Moyenne', inkHigh: 'Élevée',
            colorTitle: 'Espace colorimétrique', colorRGB: 'RVB', colorGray: 'Niveaux de gris', colorAlpha: 'Transparence',
            warning: 'avertissement', okBadge: 'OK', empty: 'Aucune page à imprimer', vpThumb: 'Page {n}',
            dragReorder: 'Glisser pour réordonner les pages',
            paperA4: 'A4 (210×297 mm)', paperA3: 'A3 (297×420 mm)', paperA5: 'A5 (148×210 mm)',
            paperLetter: 'Lettre (216×279 mm)', paperCustom: 'Format du document',
            copiesLabel: 'copies',
            qualityStandard: 'Standard (72 dpi)', qualityMedium: 'Moyenne (150 dpi)',
            qualityHD: 'HD (300 dpi)', qualityUltra: 'ULTRA HD (600 dpi)',
            showBleed: 'Afficher les fonds perdus', showBleedHint: 'Afficher la zone de fond perdu autour de chaque page',
            openImposition: 'Imposition', openImpositionHint: 'Ouvrir l\'imposition (livret / planche) avant l\'impression',
            typoCheck: 'Relecture typo', typoCheckHint: 'Doubles espaces, espace avant ponctuation, insécables, etc.',
            typoNone: 'Aucun problème typographique', typoSome: 'problème(s) typographique(s) trouvé(s)',
            typoTitle: 'Relecture typo', typoRun: 'Lancer la vérification',
            printCta: 'Générer le PDF d\'impression', printNote: 'Le PDF est généré indépendamment (fonds perdus inclus), puis le dialogue système s\'ouvre pour choisir votre imprimante (imprimantes réseau incluses).',
            detected: 'Détecté automatiquement',
            pdfError: 'Erreur de génération du PDF',
            sectionPrint: 'Réglages d\'impression', sectionReport: 'Rapport pré-vol', sectionActions: 'Outils',
            netPrinters: 'Imprimantes réseau', netPrintersHint: 'Détectées sur le réseau local via le pont local (sp213-local). Sélectionnez-en une pour imprimer directement via IPP — sans dialogue PDF.',
            netBridgeOff: 'Pont local non détecté', netBridgeOffHint: 'Lancez-le avec « npm run print:bridge » dans sp213-local pour activer l\'impression réseau directe.',
            netScan: 'Scanner le réseau', netScanning: 'Scan en cours…', netNone: 'Aucune imprimante réseau trouvée',
            netPrintOn: 'Imprimer sur', netColor: 'Couleur', netBW: 'N&B', netDuplex: 'Recto-verso', netOneSided: 'Recto', netPrinting: 'Envoi à l\'imprimante…', netSent: 'Envoyé à l\'imprimante', netErr: 'Échec de l\'impression réseau', netModel: 'Modèle', netStatus: 'État', netReady: 'Prêt', netIdle: 'Inactive', netBusy: 'Occupée', netOffline: 'Hors ligne', netUnknown: 'Inconnu',
            colorMode: 'Mode couleur', colorModeColor: 'Couleur', colorModeBW: 'N&B',
            pagesToPrint: 'Pages à imprimer', pagesAll: 'Tout', pagesActive: 'Active', pagesCustom: 'Pages', pagesCustomPh: 'ex. 1,3-5,7',
            pagesParity: 'Parité', pagesParityAll: 'Toutes', pagesParityEven: 'Pages paires', pagesParityOdd: 'Pages impaires',
            scaling: 'Gestion des pages', scaleFit: 'Ajuster', scaleActual: 'Taille réelle', scaleCustom: 'Échelle personnalisée',
            duplex: 'Recto verso',
            paperA6: 'A6 (105×148 mm)', paperSRA3: 'SRA3 (320×450 mm)', paperCustomSize: 'Personnalisé',
            tabSettings: 'Réglages d\'impression', tabPreflight: 'Pré-vol', tabPreview: 'Aperçu'
        },
        ja: {
            title: 'バーチャルプリントスタジオ',
            subtitle: 'プリフライト・塗り足し・面付け — PDF書き出しとは独立',
            preflight: 'プリフライト',
            printer: 'プリンター',
            job: 'ジョブ',
            format: 'フォーマット', pages: 'ページ', bleed: '塗り足し', margin: '余白',
            quality: '品質', copies: '部数', paper: '用紙',
            orientation: '向き', orientationP: '縦', orientationL: '横',
            analyze: '解析中…', ok: '印刷準備完了', close: '閉じる', print: '印刷',
            resTitle: '画像解像度', resLow: '低解像度の画像', resOk: '解像度OK', resNone: '画像なし',
            fontsTitle: 'フォント', fontsNone: 'テキストなし',
            inkTitle: 'インク被覆率', inkLow: '低', inkMed: '中', inkHigh: '高',
            colorTitle: 'カラースペース', colorRGB: 'RGB', colorGray: 'グレースケール', colorAlpha: '透過',
            warning: '警告', okBadge: 'OK', empty: '印刷するページがありません', vpThumb: 'ページ {n}',
            dragReorder: 'ドラッグしてページを並べ替え',
            paperA4: 'A4 (210×297mm)', paperA3: 'A3 (297×420mm)', paperA5: 'A5 (148×210mm)',
            paperLetter: 'レター (216×279mm)', paperCustom: 'ドキュメント形式',
            copiesLabel: '部',
            qualityStandard: '標準 (72dpi)', qualityMedium: '中 (150dpi)',
            qualityHD: 'HD (300dpi)', qualityUltra: 'ULTRA HD (600dpi)',
            showBleed: '塗り足しを表示', showBleedHint: '各ページの周囲に塗り足し領域を表示',
            openImposition: '面付け', openImpositionHint: '印刷前に面付け（製本/見開き）を開く',
            typoCheck: 'タイポチェック', typoCheckHint: '二重スペース、句読点前のスペース、ノーブレークスペース等',
            typoNone: 'タイポグラフィの問題はありません', typoSome: 'タイポグラフィの問題が見つかりました',
            typoTitle: 'タイポチェック', typoRun: 'チェックを実行',
            printCta: '印刷用PDFを生成', printNote: 'PDFは独立して生成され（塗り足し込み）、その後システムダイアログでプリンター（ネットワークプリンターを含む）を選択します。',
            detected: '自動検出',
            pdfError: 'PDF生成エラー',
            sectionPrint: '印刷設定', sectionReport: 'プリフライトレポート', sectionActions: 'ツール',
            netPrinters: 'ネットワークプリンター', netPrintersHint: 'ローカルプリントブリッジ（sp213-local）でローカルネットワーク上から検出されます。選択してIPPで直接印刷 — PDFダイアログ不要。',
            netBridgeOff: 'ローカルプリントブリッジが見つかりません', netBridgeOffHint: 'sp213-local で「npm run print:bridge」を実行すると直接ネットワーク印刷が可能になります。',
            netScan: 'ネットワークをスキャン', netScanning: 'スキャン中…', netNone: 'ネットワークプリンターが見つかりません',
            netPrintOn: '印刷先', netColor: 'カラー', netBW: 'モノクロ', netDuplex: '両面', netOneSided: '片面', netPrinting: 'プリンターに送信中…', netSent: 'プリンターに送信しました', netErr: 'ネットワーク印刷に失敗', netModel: 'モデル', netStatus: 'ステータス', netReady: '準備完了', netIdle: '待機中', netBusy: 'ビジー', netOffline: 'オフライン', netUnknown: '不明',
            colorMode: 'カラーモード', colorModeColor: 'カラー', colorModeBW: 'モノクロ',
            pagesToPrint: '印刷するページ', pagesAll: 'すべて', pagesActive: 'アクティブ', pagesCustom: 'カスタム', pagesCustomPh: '例: 1,3-5,7',
            pagesParity: 'パリティ', pagesParityAll: 'すべて', pagesParityEven: '偶数ページ', pagesParityOdd: '奇数ページ',
            scaling: 'ページ処理', scaleFit: '合わせる', scaleActual: '実際のサイズ', scaleCustom: 'カスタムスケール',
            duplex: '両面印刷',
            paperA6: 'A6 (105×148mm)', paperSRA3: 'SRA3 (320×450mm)', paperCustomSize: 'カスタムサイズ',
            tabSettings: '印刷設定', tabPreflight: 'プリフライト', tabPreview: 'プレビュー'
        }
    };
    function t(key) {
        var d = I18N[lang()] || I18N.en;
        return d[key] !== undefined ? d[key] : I18N.en[key];
    }

    // ─── Accès aux données globales (main.js top-level) ───
    function docPages() {
        if (typeof pages !== 'undefined' && Array.isArray(pages)) return pages;
        if (window.pages && Array.isArray(window.pages)) return window.pages;
        return [];
    }
    function docPageFormat() {
        if (typeof pageFormat !== 'undefined' && pageFormat) return pageFormat;
        if (window.pageFormat) return window.pageFormat;
        return { width: 210, height: 297 };
    }
    function docBleed() {
        if (typeof bleed !== 'undefined') return bleed;
        if (typeof window.bleed === 'number') return window.bleed;
        return 3;
    }
    function docMargin() {
        if (typeof margin !== 'undefined') return margin;
        if (typeof window.margin === 'number') return window.margin;
        return 20;
    }
    function docCanvases() {
        if (typeof canvases !== 'undefined' && Array.isArray(canvases)) return canvases;
        if (window.canvases && Array.isArray(window.canvases)) return window.canvases;
        return [];
    }
    function _mmToPxLocal(mm) {
        if (typeof window !== 'undefined' && typeof window.mmToPx === 'function') return window.mmToPx(mm);
        return Math.round((mm * 96) / 25.4);
    }

    function toast(msg, kind) {
        try { if (typeof showToast === 'function') { showToast(msg, kind === 'warn' ? 'warn' : kind); } } catch (_) {}
    }

    // ─── Orientation active (Portrait / Landscape) ───
    function getOrient() {
        try {
            const ov = document.getElementById(overlayId);
            if (!ov) return 'p';
            const active = Array.from(ov.querySelectorAll('.vps-orient')).find(function (b) {
                return b.style.background === 'rgb(26, 26, 26)';
            });
            return active ? active.getAttribute('data-v') : 'p';
        } catch (_) { return 'p'; }
    }

    // ─── Analyse pré-flight ───
    function analyze() {
        const fmt = docPageFormat();
        const pgs = docPages();
        const bd = docBleed();
        const mg = docMargin();
        const report = {
            widthMm: fmt.width, heightMm: fmt.height, count: pgs.length,
            bleed: bd, margin: mg,
            lowRes: 0, totalImages: 0, totalFonts: 0, fonts: [], hasText: false,
            rgbPixels: 0, grayPixels: 0, alphaPixels: 0, inkSum: 0, inkSamples: 0
        };
        pgs.forEach(function (pg, idx) {
            let list = null;
            try {
                if (pg && typeof pg.objects === 'string') list = JSON.parse(pg.objects).objects || [];
                else if (pg && pg.objects && Array.isArray(pg.objects.objects)) list = pg.objects.objects;
                else if (pg && Array.isArray(pg.objects)) list = pg.objects;
                else if (pg && Array.isArray(pg)) list = pg;
            } catch (_) { list = null; }
            if (!Array.isArray(list)) {
                const c = docCanvases()[idx];
                if (c && typeof c.getObjects === 'function') { try { list = c.getObjects(); } catch (_) { list = []; } }
                else { list = []; }
            }
            list.forEach(function (o) {
                if (!o) return;
                if (o.type === 'image' || o._spPdfImport || o._isImageMask) {
                    report.totalImages++;
                    const w = o.width || 0, h = o.height || 0;
                    const scX = Math.abs(o.scaleX || 1), scY = Math.abs(o.scaleY || 1);
                    const printedWpx = (w * scX) || 1, printedHpx = (h * scY) || 1;
                    const printedWmm = (printedWpx / (_mmToPxLocal(1))) || 1, printedHmm = (printedHpx / (_mmToPxLocal(1))) || 1;
                    const dpiX = w / (printedWmm / 25.4), dpiY = h / (printedHmm / 25.4);
                    const dpi = Math.min(dpiX || 0, dpiY || 0);
                    if (dpi > 0 && dpi < 150) report.lowRes++;
                }
                if (o.type === 'textbox' || o.type === 'text' || o.type === 'i-text') {
                    report.hasText = true;
                    if (o.fontFamily) { const f = String(o.fontFamily); if (report.fonts.indexOf(f) === -1) report.fonts.push(f); }
                }
            });
            const c = docCanvases()[idx];
            if (c && c.lowerCanvasEl) {
                try {
                    const ctx = c.lowerCanvasEl.getContext('2d');
                    const cw = c.lowerCanvasEl.width, ch = c.lowerCanvasEl.height;
                    if (ctx && cw > 0 && ch > 0) {
                        const step = Math.max(4, Math.round(Math.max(cw, ch) / 160));
                        const data = ctx.getImageData(0, 0, cw, ch, { willReadFrequently: true }).data;
                        for (let y = 0; y < ch; y += step) {
                            for (let x = 0; x < cw; x += step) {
                                const i = (y * cw + x) * 4;
                                const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                                if (a < 250) report.alphaPixels++;
                                if (r === g && g === b) report.grayPixels++;
                                else report.rgbPixels++;
                                const lum = (r + g + b) / 3;
                                report.inkSum += (255 - lum) / 255;
                                report.inkSamples++;
                            }
                        }
                    }
                } catch (_) {}
            }
        });
        report.totalFonts = report.fonts.length;
        report.inkCoverage = report.inkSamples > 0 ? Math.round((report.inkSum / report.inkSamples) * 100) : 0;
        return report;
    }

    // ─── Relecture typo (règles EN / FR / JA) ───
    function typoRules(lng) {
        if (lng === 'ja') return [
            { re: / {2,}/g, msg: '二重スペース', fix: ' ' },
            { re: /([、。！？])([^\s、。！？])/g, msg: '句読点の後のスペースがない', fix: '$1 $2' },
            { re: /(https?:\/\/[^\s]+) /g, msg: 'URLの後のスペース', fix: '$1\u00A0' }
        ];
        if (lng === 'fr') return [
            { re: / {2,}/g, msg: 'Double espace', fix: ' ' },
            { re: /([?!;:]) /g, msg: 'Espace insécable manquante avant la ponctuation haute', fix: '$1\u00A0' },
            { re: /« /g, msg: 'Espace après guillemet ouvrant', fix: '\u00A0«\u00A0' },
            { re: / »/g, msg: 'Espace avant guillemet fermant', fix: '\u00A0»\u00A0' },
            { re: /( [%€°])/g, msg: 'Espace fine avant symbole', fix: '\u202F$1' }
        ];
        return [
            { re: / {2,}/g, msg: 'Double space', fix: ' ' },
            { re: / ([,.;!?])/g, msg: 'Space before punctuation', fix: '$1' },
            { re: /(\w) ([,.;!?])/g, msg: 'Space before punctuation', fix: '$1$2' },
            { re: /(\w) (['’])/g, msg: 'Space before apostrophe', fix: '$1$2' }
        ];
    }
    function collectTexts() {
        const out = [];
        docPages().forEach(function (pg, idx) {
            let list = null;
            try {
                if (pg && typeof pg.objects === 'string') list = JSON.parse(pg.objects).objects || [];
                else if (pg && pg.objects && Array.isArray(pg.objects.objects)) list = pg.objects.objects;
                else if (pg && Array.isArray(pg.objects)) list = pg.objects;
                else if (pg && Array.isArray(pg)) list = pg;
            } catch (_) { list = null; }
            if (!Array.isArray(list)) {
                const c = docCanvases()[idx];
                if (c && typeof c.getObjects === 'function') { try { list = c.getObjects(); } catch (_) { list = []; } }
                else { list = []; }
            }
            list.forEach(function (o) {
                if (!o) return;
                if (o.type === 'textbox' || o.type === 'text' || o.type === 'i-text') {
                    if (typeof o.text === 'string' && o.text.trim()) out.push({ page: idx + 1, text: o.text });
                }
            });
        });
        return out;
    }
    function runTypoCheck() {
        const rules = typoRules(lang());
        const issues = [];
        collectTexts().forEach(function (tx) {
            rules.forEach(function (r) {
                let m;
                r.re.lastIndex = 0;
                while ((m = r.re.exec(tx.text)) !== null) {
                    issues.push({ page: tx.page, msg: r.msg, snippet: m[0].slice(0, 30) });
                    if (issues.length > 200) break;
                }
            });
        });
        return issues;
    }

    // ─── Aperçu presse (vignettes AVEC fonds perdus en option) ───
    // 🆕 ERGO + PERF (2026-08-30) :
    //   - Grille ADAPTATIVE (flex-wrap + centrée) : 1 page = grande au centre,
    //     8 / 40 pages = vignettes plus petites, tout tient sans scroller en X.
    //   - Doubles pages respectées : si viewMode === 'spread', les spreads sont
    //     rendus comme des vignettes larges (2 pages côte à côte).
    //   - Rendu SÉQUENTIEL différé (un à la fois via setTimeout) : plus de gel
    //     du navigateur avec beaucoup de pages (avant : tout en parallèle).
    // 🛡️ v1.7.283 : ORDRE D'IMPRESSION SÉPARÉ — le drag & drop dans l'aperçu
    //   réordonne _vpsOrder (indices de pages), PAS le tableau pages[] de la
    //   maquette. La maquette d'origine n'est JAMAIS modifiée. L'ordre n'est
    //   utilisé que pour générer le PDF d'impression (doPrint / printToNetwork).
    var _vpsOrder = [];
    function _resetVpsOrder() {
        const pgs = docPages();
        _vpsOrder = [];
        for (let i = 0; i < pgs.length; i++) _vpsOrder.push(i);
    }
    var _thumbQueue = [];
    var _thumbBusy = false;
    var _thumbGeneration = 0;

    function _thumbRenderOne() {
        if (!_thumbQueue.length) { _thumbBusy = false; return; }
        _thumbBusy = true;
        const job = _thumbQueue.shift();
        const finish = function () {
            if (job.generation !== _thumbGeneration) { _thumbBusy = false; return; }
            setTimeout(_thumbRenderOne, 8);
        };
        try {
            const renderer = (job.isSpread && typeof renderSpreadToImageForExport === 'function')
                ? renderSpreadToImageForExport(job.leftIdx, job.rightIdx, 'standard', null, false, { format: 'png', mime: 'image/png', quality: 1.0, pdfFormat: 'PNG', compression: 'NONE' })
                : renderPageToImageWithBleed(job.idx, 'single', 'standard', null, false, { format: 'png', mime: 'image/png', quality: 1.0, pdfFormat: 'PNG', compression: 'NONE' });
            Promise.resolve(renderer).then(function (dataUrl) {
                if (!dataUrl || !dataUrl.length) { finish(); return; }
                const img = new Image();
                img.onload = function () {
                    _thumbPaint(job, img);
                    finish();
                };
                img.onerror = function () { finish(); };
                img.src = dataUrl;
            }).catch(function () { finish(); });
        } catch (_) { finish(); }
    }

    function _thumbPaint(job, img) {
        try {
            if (job.generation !== _thumbGeneration || !job.canvas.isConnected) return;
            const cv = job.canvas;
            const ctx = cv.getContext('2d');
            // Fond de la vignette = gris clair (zone de travail, comme le workspace)
            ctx.fillStyle = '#ececec';
            ctx.fillRect(0, 0, cv.width, cv.height);
            const showBleedEl = document.getElementById('vpsShowBleed');
            const showBleed = showBleedEl ? showBleedEl.checked : false;
            const bd = docBleed();
            const fmt = docPageFormat();
            const bleedFracW = bd / (fmt.width + bd * 2);
            const bleedFracH = bd / (fmt.height + bd * 2);
            let sx = 0, sy = 0, sw = img.width, sh = img.height;
            if (!showBleed) {
                sx = img.width * bleedFracW; sy = img.height * bleedFracH;
                sw = img.width * (1 - bleedFracW * 2); sh = img.height * (1 - bleedFracH * 2);
            }
            const scale = Math.min(cv.width / sw, cv.height / sh);
            const w = sw * scale, h = sh * scale;
            const x = (cv.width - w) / 2, y = (cv.height - h) / 2;
            // Fond de PAGE BLANC : le PNG exporté a un fond transparent,
            // donc on remplit d'abord la zone page en blanc (sinon le
            // gris de travail transparaît à travers la page).
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x, y, w, h);
            // FILLET GRIS qui définit la page (visible même si le fond est blanc)
            ctx.strokeStyle = '#b0b0b0';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);
            ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
            if (showBleed) {
                // Zone de fond perdu : hachures diagonales fines rouges très
                // discrètes + trait rouge vif fin sur la ligne de coupe.
                const bx = x + w * bleedFracW, by = y + h * bleedFracH;
                const bw = w * (1 - bleedFracW * 2), bh = h * (1 - bleedFracH * 2);
                // Les fonds perdus sont TOUJOURS À L'EXTÉRIEUR de la page :
                // les hachures ne doivent couvrir QUE les 4 bandes situées
                // entre le bord extérieur du format et la ligne de coupe (page).
                ctx.save();
                ctx.strokeStyle = 'rgba(224, 38, 46, 0.35)';
                ctx.lineWidth = 1;
                const hatch = 6;
                const tTop = by - y, tBottom = (y + h) - (by + bh);
                const tLeft = bx - x, tRight = (x + w) - (bx + bw);
                const bands = [
                    [x, y, w, tTop],          // haut (pleine largeur)
                    [x, by + bh, w, tBottom], // bas (pleine largeur)
                    [x, by, tLeft, bh],       // gauche (hauteur de page)
                    [bx + bw, by, tRight, bh] // droite (hauteur de page)
                ];
                bands.forEach(function (b) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(b[0], b[1], b[2], b[3]);
                    ctx.clip();
                    ctx.beginPath();
                    for (let gx = b[0] - 10; gx <= b[0] + b[2] + 10; gx += hatch) {
                        ctx.moveTo(gx, b[1] - 10);
                        ctx.lineTo(gx + hatch, b[1] + b[3] + 10);
                    }
                    ctx.stroke();
                    ctx.restore();
                });
                ctx.restore();
                // Trait rouge VIF + fin autour de la page (la ligne de coupe)
                ctx.strokeStyle = '#e0262e';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(bx, by, bw, bh);
            }
        } catch (_) {}
    }

    function buildThumbnails() {
        const wrap = document.getElementById('vpsThumbs');
        if (!wrap) return;
        // Interrompre une éventuelle file en cours
        _thumbGeneration++;
        _thumbQueue = [];
        _thumbBusy = false;
        wrap.innerHTML = '';
        const pgs = docPages();
        if (!pgs.length) { wrap.innerHTML = '<div style="font-size:11px;color:#888;padding:8px;">' + t('empty') + '</div>'; return; }
        // 🛡️ v1.7.283 : garantir un ordre d'impression valide (taille == nb pages)
        if (_vpsOrder.length !== pgs.length) _resetVpsOrder();
        const orient = getOrient();
        const isLand = orient === 'l';
        // Mode double page (spread) : on respecte viewMode du document
        let isSpreadMode = false;
        try { if (typeof viewMode !== 'undefined' && viewMode === 'spread') isSpreadMode = true; } catch (_) {}

        // ─── Ordre d'impression (_vpsOrder) ───
        // Construit la liste d'items DANS l'ordre _vpsOrder. Chaque item garde
        // son index ORIGINAL (pour rendre la bonne page) + sa position d'impression.
        const order = _vpsOrder.slice();
        const items = [];
        if (isSpreadMode) {
            // Mode spread : on respecte la structure des spreads MAIS dans l'ordre
            // d'impression. Page 1 seule + spreads (2,3),(4,5)... Chaque spread est
            // composé de 2 pages consécutives de l'ordre d'impression.
            if (order.length > 0) items.push({ type: 'single', origIdx: order[0], printPos: 0, labelNum: order[0] + 1 });
            for (let i = 1; i < order.length - 1; i += 2) {
                items.push({ type: 'spread', origLeft: order[i], origRight: order[i + 1], printPos: i, labelNum: order[i] + 1 });
            }
            if (order.length > 2 && order.length % 2 === 0) {
                items.push({ type: 'single', origIdx: order[order.length - 1], printPos: order.length - 1, labelNum: order[order.length - 1] + 1 });
            }
        } else {
            order.forEach(function (origIdx, pos) {
                items.push({ type: 'single', origIdx: origIdx, printPos: pos, labelNum: origIdx + 1 });
            });
        }

        // Taille de vignette adaptée au nombre d'items — 🛡️ v1.7.283 : vignettes
        // +25 % (l'onglet Preview a maintenant de la place en pleine largeur).
        //   1 item  → grande (150×212)
        //   2-4     → moyenne (120×170)
        //   5+      → petite grille (90×127) — tout tient à l'écran
        // 🛡️ v1.7.283 : le FORMAT PAPIER choisi dans les réglages change le ratio
        // de la vignette (A6, A3, SRA3, personnalisé…). La hauteur de référence
        // reste celle du nombre de pages ; la largeur suit le ratio du papier.
        const paperMm = _vpsPaperSizeMm();
        const paperRatio = (paperMm.wMm > 0 && paperMm.hMm > 0) ? (paperMm.wMm / paperMm.hMm) : 0.707;
        let THUMB_W, THUMB_H;
        const n = items.length;
        if (n <= 1)      { THUMB_H = 212; }
        else if (n <= 4) { THUMB_H = 170; }
        else             { THUMB_H = 127; }
        THUMB_W = Math.round(THUMB_H * paperRatio);
        // Si paysage, on échange (page horizontale)
        const cellW = isLand ? THUMB_H : THUMB_W;
        const cellH = isLand ? THUMB_W : THUMB_H;
        // En mode spread, une vignette spread = 2 cellules de large
        const spreadW = cellW * 2 + 6;

        // Style conteneur : grille wrap centrée, pas de scroll horizontal
        wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;align-items:flex-start;min-height:150px;padding:4px 0;overflow-y:auto;';

        items.forEach(function (it, itemPos) {
            const isSpread = it.type === 'spread';
            const card = document.createElement('div');
            card.style.cssText = 'flex:0 0 auto;text-align:center;display:flex;flex-direction:column;align-items:center;position:relative;';
            const cap = document.createElement('div');
            cap.style.cssText = 'font-size:9px;color:#666;letter-spacing:0.5px;margin-top:4px;white-space:nowrap;';
            if (isSpread) {
                cap.textContent = t('vpThumb').replace('{n}', (it.origLeft + 1)) + '–' + (it.origRight + 1) + (isLand ? ' · ' + t('orientationL') : '');
            } else {
                cap.textContent = t('vpThumb').replace('{n}', it.labelNum) + (isLand ? ' · ' + t('orientationL') : '');
            }
            const cv = document.createElement('canvas');
            cv.width = isSpread ? spreadW : cellW;
            cv.height = cellH;
            cv.style.width = cv.width + 'px';
            cv.style.height = cv.height + 'px';
            cv.style.background = '#ececec';
            cv.style.border = '1px solid #e0e0e0';
            cv.style.borderRadius = '3px';
            card.appendChild(cv);
            card.appendChild(cap);
            // 🛡️ v1.7.283 : indicateur d'ordre d'impression (petit numéro en haut à gauche)
            const badge = document.createElement('div');
            badge.style.cssText = 'position:absolute;top:2px;left:2px;background:#1a1a1a;color:#fff;font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;letter-spacing:0.5px;z-index:3;pointer-events:none;';
            badge.textContent = '#' + (itemPos + 1);
            card.appendChild(badge);
            wrap.appendChild(card);
            // Enqueu le rendu (séquentiel) — rend l'index ORIGINAL de la page
            const job = { canvas: cv, isSpread: isSpread, printPos: itemPos, labelNum: it.labelNum, generation: _thumbGeneration };
            if (isSpread) { job.leftIdx = it.origLeft; job.rightIdx = it.origRight; }
            else { job.idx = it.origIdx; }
            _thumbQueue.push(job);
            // 🖐️ Drag & drop : réordonner les pages depuis l'aperçu
            _thumbAttachDrag(card, it, items.length);
        });
        // Démarrer la file si elle ne tourne pas déjà
        if (!_thumbBusy) setTimeout(_thumbRenderOne, 10);
    }

    // ─── Drag & drop pour réordonner les pages depuis l'aperçu VPS ───
    // 🛡️ v1.7.283 : le drag réordonne UNIQUEMENT l'ORDRE D'IMPRESSION (_vpsOrder),
    //   jamais la maquette d'origine (pages[]). Ça permet de changer l'ordre juste
    //   pour l'impression avec le VPS, sans toucher au projet.
    // 🛡️ 2026-08-31 : drag souris MANUEL (mousedown/move/up) au lieu du
    //   drag & drop HTML5 natif — plus fiable sur les éléments canvas.
    function _vpsReorderPrint(fromPrintPos, toPrintPos) {
        if (fromPrintPos === toPrintPos || fromPrintPos < 0 || toPrintPos < 0 || fromPrintPos >= _vpsOrder.length || toPrintPos >= _vpsOrder.length) return false;
        try {
            const moved = _vpsOrder.splice(fromPrintPos, 1)[0];
            let insertAt = toPrintPos;
            if (fromPrintPos < toPrintPos) insertAt--;
            _vpsOrder.splice(insertAt, 0, moved);
        } catch (e) { return false; }
        // Reconstruire les vignettes dans le nouvel ordre (sans toucher à la maquette)
        buildThumbnails();
        return true;
    }

    // État du drag manuel
    var _dragCard = null;
    var _dragItemPrintPos = -1;
    var _dragClone = null;
    var _dragStartX = 0, _dragStartY = 0;
    var _dragActive = false;
    var _dragSepEl = null;   // trait de séparation ergo (point 4)

    // 🛡️ 2026-08-31 : un SEUL jeu de listeners globaux (document) pour le drag —
    //   éviter les doublons à chaque buildThumbnails(). _thumbAttachDrag n'attache
    //   que le mousedown par carte ; le mousemove/mouseup sont globaux.
    function _thumbDragIndicator(card) {
        // Retirer l'indicateur précédent
        if (_dragSepEl) {
            try { if (_dragSepEl.parentNode) _dragSepEl.parentNode.removeChild(_dragSepEl); } catch (_) {}
            _dragSepEl = null;
        }
        if (!card) return;
        // Créer un trait vertical entre la carte survolée et la précédente
        const r = card.getBoundingClientRect();
        const wrap = document.getElementById('vpsThumbs');
        const wrapR = wrap ? wrap.getBoundingClientRect() : r;
        const sep = document.createElement('div');
        sep.style.cssText = 'position:fixed;left:' + (r.left - 7) + 'px;top:' + (r.top - 4) + 'px;width:3px;height:' + (r.height + 8) + 'px;background:#1a1a1a;border-radius:2px;box-shadow:0 0 6px rgba(0,0,0,0.4);z-index:999998;pointer-events:none;';
        document.body.appendChild(sep);
        _dragSepEl = sep;
    }
    function _thumbClearIndicator() {
        if (_dragSepEl) {
            try { if (_dragSepEl.parentNode) _dragSepEl.parentNode.removeChild(_dragSepEl); } catch (_) {}
            _dragSepEl = null;
        }
    }
    function _thumbGlobalMove(e) {
        if (!_dragCard) return;
        const dx = e.clientX - _dragStartX;
        const dy = e.clientY - _dragStartY;
        if (!_dragActive && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
            _dragActive = true;
            // Cloner la carte pour le visuel de drag
            try {
                _dragClone = _dragCard.cloneNode(true);
                _dragClone.style.position = 'fixed';
                _dragClone.style.zIndex = '999999';
                _dragClone.style.pointerEvents = 'none';
                _dragClone.style.opacity = '0.75';
                _dragClone.style.width = _dragCard.offsetWidth + 'px';
                _dragClone.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
                _dragClone.style.transform = 'rotate(2deg)';
                _dragClone.style.margin = '0';
                _dragClone.style.top = '0';
                _dragClone.style.left = '0';
                document.body.appendChild(_dragClone);
            } catch (_) { _dragClone = null; }
            if (_dragCard) _dragCard.style.opacity = '0.35';
        }
        if (_dragActive && _dragClone) {
            _dragClone.style.left = (e.clientX - 20) + 'px';
            _dragClone.style.top = (e.clientY - 20) + 'px';
            // 🛡️ Point 4 : montrer le trait de séparation entre les pages au survol
            const wrap = document.getElementById('vpsThumbs');
            if (wrap) {
                const cards = Array.from(wrap.children).filter(function (c) { return c.tagName === 'DIV'; });
                let hoverCard = null;
                for (let i = 0; i < cards.length; i++) {
                    const r = cards[i].getBoundingClientRect();
                    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                        hoverCard = cards[i];
                        break;
                    }
                }
                _thumbDragIndicator(hoverCard);
            }
        }
    }
    function _thumbGlobalUp(e) {
        if (!_dragCard) return;
        const wasActive = _dragActive;
        const dragCard = _dragCard;
        const fromPrintPos = _dragItemPrintPos;
        // Nettoyer le clone
        if (_dragClone) {
            try { if (_dragClone.parentNode) _dragClone.parentNode.removeChild(_dragClone); } catch (_) {}
            _dragClone = null;
        }
        _thumbClearIndicator();
        if (dragCard) dragCard.style.opacity = '';
        // Déterminer la carte cible sous le pointeur (par sa position d'impression)
        if (wasActive && fromPrintPos >= 0) {
            const wrap = document.getElementById('vpsThumbs');
            if (wrap) {
                const cards = Array.from(wrap.children).filter(function (c) { return c.tagName === 'DIV'; });
                for (let i = 0; i < cards.length; i++) {
                    const r = cards[i].getBoundingClientRect();
                    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                        // La position d'impression = position dans _vpsOrder = index de la carte
                        const toPrintPos = i;
                        if (toPrintPos !== fromPrintPos) {
                            _vpsReorderPrint(fromPrintPos, toPrintPos);
                        }
                        break;
                    }
                }
            }
        }
        _dragCard = null;
        _dragItemPrintPos = -1;
        _dragActive = false;
    }
    if (!window.__spVpsDragGlobalAttached) {
        window.__spVpsDragGlobalAttached = true;
        document.addEventListener('mousemove', _thumbGlobalMove, true);
        document.addEventListener('mouseup', _thumbGlobalUp, true);
    }

    function _thumbAttachDrag(card, item, totalItems) {
        // En mode spread, on n'autorise pas le drag (structure dépendante)
        if (item.isSpread) return;
        // On n'autorise que si le document est en pages simples
        try { if (typeof viewMode !== 'undefined' && viewMode === 'spread') return; } catch (_) {}
        card.style.cursor = 'grab';
        card.title = t('dragReorder');
        card.addEventListener('mousedown', function (e) {
            // Ignorer les clics sur la caption / les boutons
            if (e.button !== 0) return;
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
            e.preventDefault();
            _dragCard = card;
            _dragItemPrintPos = item.printPos;
            _dragStartX = e.clientX;
            _dragStartY = e.clientY;
            _dragActive = false;
        });
    }

    // ─── Build UI — DA alignée sur la boîte d'Imposition ───
    function buildHTML() {
        const old = document.getElementById(overlayId);
        if (old) old.parentNode.removeChild(old);
        const ov = document.createElement('div');
        ov.id = overlayId;
        ov.className = 'modal-overlay vps-overlay';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100500;display:none;align-items:center;justify-content:center;padding:24px;';
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        ov.innerHTML =
            // 🛡️ 2026-08-31 — largeur réduite de 920px → 770px (desktop, ~16%) pour
            //   une pop-in VPS moins large, cohérente avec les autres modales.
            '<div class="modal sp-modal-card vps-modal" style="width:min(770px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;max-width:770px;">' +
                // Header
                '<div class="modal-header" style="flex-shrink:0;">' +
                    '<div class="modal-title vps-title">' + t('title') + '</div>' +
                    '<span id="vpsSubtitle" style="font-size:10px;color:#888;margin-left:8px;">' + t('subtitle') + '</span>' +
                    '<div style="flex:1;"></div>' +
                    '<div class="vps-status" style="display:inline-flex;align-items:center;gap:6px;font-size:10px;border:1px solid #e0e0e0;padding:4px 10px;border-radius:999px;color:#555;">' +
                        '<span id="vpsStatusDot" style="width:8px;height:8px;border-radius:50%;background:#f0a020;display:inline-block;"></span>' +
                        '<span id="vpsStatusText">' + t('analyze') + '</span>' +
                    '</div>' +
                    '<button id="vpsClose" style="margin-left:8px;width:28px;height:28px;border:1px solid #e0e0e0;background:#fff;color:#888;font-size:16px;cursor:pointer;line-height:1;border-radius:6px;display:flex;align-items:center;justify-content:center;">✕</button>' +
                '</div>' +
                // Body — 3 onglets : Réglages / Pré-vol / Aperçu
                '<div class="modal-body vps-body" style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:0;">' +
                    // ─── Barre d'onglets ───
                    '<div class="vps-tabs" style="display:flex;border-bottom:1px solid #e0e0e0;flex-shrink:0;background:#fafafa;">' +
                        '<button class="vps-tab vps-tab-active" data-tab="settings" style="flex:1;padding:11px 8px;border:none;border-bottom:2px solid #1a1a1a;background:transparent;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1a1a1a;cursor:pointer;">' + t('tabSettings') + '</button>' +
                        '<button class="vps-tab" data-tab="preview" style="flex:1;padding:11px 8px;border:none;border-bottom:2px solid transparent;background:transparent;font-family:inherit;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#888;cursor:pointer;">' + t('tabPreview') + '</button>' +
                        '<button class="vps-tab" data-tab="preflight" style="flex:1;padding:11px 8px;border:none;border-bottom:2px solid transparent;background:transparent;font-family:inherit;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#888;cursor:pointer;">' + t('tabPreflight') + '</button>' +
                    '</div>' +
                    // ─── Onglet 1 : Réglages d'impression (DÉFAUT) ───
                    '<div class="vps-panel vps-panel-active" data-panel="settings" style="flex:1;min-height:0;overflow-y:auto;padding:16px 20px;">' +
                        '<div class="modal-options" style="gap:10px;">' +
                            '<div class="modal-option" style="align-items:flex-start;">' +
                                '<span style="flex:0 0 80px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:6px;">' + t('paper') + '</span>' +
                                '<div style="display:flex;gap:6px;flex:1;flex-wrap:wrap;">' +
                                    '<select id="vpsPaper" style="flex:1 1 100%;height:30px;font-size:11px;padding:0 6px;border:1px solid #ddd;border-radius:4px;background:#fff;"></select>' +
                                    '<div id="vpsPaperCustom" style="display:none;flex:1 1 100%;gap:6px;align-items:center;">' +
                                        '<input id="vpsPaperW" type="number" min="10" max="1000" value="210" style="flex:1;height:30px;font-size:11px;padding:0 6px;border:1px solid #ddd;border-radius:4px;background:#fff;" title="mm">' +
                                        '<span style="font-size:11px;">×</span>' +
                                        '<input id="vpsPaperH" type="number" min="10" max="1000" value="297" style="flex:1;height:30px;font-size:11px;padding:0 6px;border:1px solid #ddd;border-radius:4px;background:#fff;" title="mm">' +
                                        '<span style="font-size:10px;opacity:0.6;">mm</span>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                            '<div class="modal-option" style="align-items:flex-start;">' +
                                '<span style="flex:0 0 80px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:4px;">' + t('orientation') + '</span>' +
                                '<div style="display:flex;gap:6px;flex:1;">' +
                                    '<button class="vps-orient vps-active" data-v="p" style="flex:1;height:30px;font-size:10px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:4px;cursor:pointer;">' + t('orientationP') + '</button>' +
                                    '<button class="vps-orient" data-v="l" style="flex:1;height:30px;font-size:10px;border:1px solid #ccc;background:#fff;color:#1a1a1a;border-radius:4px;cursor:pointer;">' + t('orientationL') + '</button>' +
                                '</div>' +
                            '</div>' +
                            '<div class="modal-option" style="align-items:flex-start;gap:8px;">' +
                                '<span style="flex:0 0 80px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:6px;">' + t('quality') + '</span>' +
                                '<div style="display:flex;gap:8px;flex:1;">' +
                                    '<select id="vpsQuality" style="flex:1;height:30px;font-size:11px;padding:0 6px;border:1px solid #ddd;border-radius:4px;background:#fff;">' +
                                        '<option value="standard">' + t('qualityStandard') + '</option><option value="medium">' + t('qualityMedium') + '</option><option value="hd" selected>' + t('qualityHD') + '</option><option value="ultrahd">' + t('qualityUltra') + '</option>' +
                                    '</select>' +
                                    '<span style="flex:0 0 60px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:6px;text-align:right;">' + t('copies') + '</span>' +
                                    '<input id="vpsCopies" type="number" min="1" max="99" value="1" style="flex:0 0 52px;height:30px;font-size:11px;padding:0 6px;border:1px solid #ddd;border-radius:4px;background:#fff;">' +
                                '</div>' +
                            '</div>' +
                            '<div class="modal-option" style="align-items:flex-start;">' +
                                '<span style="flex:0 0 80px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:4px;">' + t('colorMode') + '</span>' +
                                '<div style="display:flex;gap:6px;flex:1;">' +
                                    '<button class="vps-cmode vps-active" data-v="color" style="flex:1;height:30px;font-size:10px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:4px;cursor:pointer;">' + t('colorModeColor') + '</button>' +
                                    '<button class="vps-cmode" data-v="bw" style="flex:1;height:30px;font-size:10px;border:1px solid #ccc;background:#fff;color:#1a1a1a;border-radius:4px;cursor:pointer;">' + t('colorModeBW') + '</button>' +
                                '</div>' +
                            '</div>' +
                            '<div class="modal-option" style="align-items:flex-start;">' +
                                '<span style="flex:0 0 80px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:4px;">' + t('pagesToPrint') + '</span>' +
                                '<div style="display:flex;gap:6px;flex:1;flex-wrap:wrap;">' +
                                    '<button class="vps-prange vps-active" data-v="all" style="flex:1;height:30px;font-size:10px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:4px;cursor:pointer;min-width:64px;">' + t('pagesAll') + '</button>' +
                                    '<button class="vps-prange" data-v="active" style="flex:1;height:30px;font-size:10px;border:1px solid #ccc;background:#fff;color:#1a1a1a;border-radius:4px;cursor:pointer;min-width:64px;">' + t('pagesActive') + '</button>' +
                                    '<button class="vps-prange" data-v="custom" style="flex:1;height:30px;font-size:10px;border:1px solid #ccc;background:#fff;color:#1a1a1a;border-radius:4px;cursor:pointer;min-width:64px;">' + t('pagesCustom') + '</button>' +
                                    '<input id="vpsPagesCustom" type="text" placeholder="' + t('pagesCustomPh') + '" style="flex:1 1 100%;height:30px;font-size:11px;padding:0 6px;border:1px solid #ddd;border-radius:4px;background:#fff;display:none;">' +
                                '</div>' +
                            '</div>' +
                            '<div style="display:flex;gap:8px;">' +
                                '<div class="modal-option" style="align-items:flex-start;flex:1;">' +
                                    '<span style="flex:0 0 56px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:4px;">' + t('pagesParity') + '</span>' +
                                    '<select id="vpsParity" style="flex:1;height:30px;font-size:11px;padding:0 6px;border:1px solid #ddd;border-radius:4px;background:#fff;">' +
                                        '<option value="all">' + t('pagesParityAll') + '</option>' +
                                        '<option value="even">' + t('pagesParityEven') + '</option>' +
                                        '<option value="odd">' + t('pagesParityOdd') + '</option>' +
                                    '</select>' +
                                '</div>' +
                                '<div class="modal-option" style="align-items:flex-start;flex:1;">' +
                                    '<span style="flex:0 0 56px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:4px;">' + t('duplex') + '</span>' +
                                    '<label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;flex:1;">' +
                                        '<input id="vpsDuplex" type="checkbox" style="width:15px;height:15px;accent-color:#1a1a1a;">' +
                                        '<span style="white-space:nowrap;">' + t('duplex') + '</span>' +
                                    '</label>' +
                                '</div>' +
                            '</div>' +
                            '<div class="modal-option" style="align-items:flex-start;">' +
                                '<span style="flex:0 0 80px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;padding-top:4px;">' + t('scaling') + '</span>' +
                                '<div style="display:flex;gap:6px;flex:1;flex-wrap:wrap;">' +
                                    '<button class="vps-scale vps-active" data-v="fit" style="flex:1;height:30px;font-size:10px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:4px;cursor:pointer;min-width:64px;">' + t('scaleFit') + '</button>' +
                                    '<button class="vps-scale" data-v="actual" style="flex:1;height:30px;font-size:10px;border:1px solid #ccc;background:#fff;color:#1a1a1a;border-radius:4px;cursor:pointer;min-width:64px;">' + t('scaleActual') + '</button>' +
                                    '<button class="vps-scale" data-v="custom" style="flex:1;height:30px;font-size:10px;border:1px solid #ccc;background:#fff;color:#1a1a1a;border-radius:4px;cursor:pointer;min-width:64px;">' + t('scaleCustom') + '</button>' +
                                    '<input id="vpsScaleCustom" type="number" min="10" max="400" value="100" style="flex:0 0 70px;height:30px;font-size:11px;padding:0 6px;border:1px solid #ddd;border-radius:4px;background:#fff;display:none;" title="%">' +
                                    '<span id="vpsScaleUnit" style="display:none;align-self:center;font-size:10px;opacity:0.6;">%</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    // ─── Onglet 2 : Aperçu (Preview) ───
                    '<div class="vps-panel" data-panel="preview" style="flex:1;min-height:0;overflow-y:auto;padding:16px 20px;display:none;">' +
                        '<div class="modal-section-title">' + t('printer') + ' — ' + t('pages') + '</div>' +
                        '<div id="vpsThumbs" style="display:flex;gap:10px;overflow-x:auto;min-height:200px;padding:4px 0;">' +
                        '</div>' +
                    '</div>' +
                    // ─── Onglet 3 : Pré-vol (Pre-flight) ───
                    '<div class="vps-panel" data-panel="preflight" style="flex:1;min-height:0;overflow-y:auto;padding:16px 20px;display:none;">' +
                        '<div class="modal-section-title">' + t('sectionReport') + '</div>' +
                        '<div id="vpsReport" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">' +
                        '</div>' +
                        '<div class="modal-section-title">' + t('sectionActions') + '</div>' +
                        '<div class="modal-options" style="gap:8px;">' +
                            '<div class="modal-option">' +
                                '<input type="checkbox" id="vpsShowBleed">' +
                                '<label for="vpsShowBleed"><span>' + t('showBleed') + '</span><div class="modal-option-desc">' + t('showBleedHint') + '</div></label>' +
                            '</div>' +
                            '<div class="modal-option">' +
                                '<input type="checkbox" id="vpsTypoCheck">' +
                                '<label for="vpsTypoCheck"><span>' + t('typoCheck') + '</span><div class="modal-option-desc">' + t('typoCheckHint') + '</div></label>' +
                            '</div>' +
                        '</div>' +
                        '<div id="vpsTypoResult" style="display:none;margin-top:8px;padding:10px 12px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;font-size:10px;line-height:1.5;color:#555;max-height:130px;overflow-y:auto;"></div>' +
                        '<button id="vpsImpositionBtn" class="modal-btn modal-btn-secondary" style="width:100%;margin-top:12px;">' +
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>' +
                            t('openImposition') +
                        '</button>' +
                        '<div class="modal-section-title" style="margin-top:16px;">' + t('netPrinters') + '</div>' +
                        '<div id="vpsNetPrinters" style="margin-bottom:8px;">' +
                            '<div id="vpsNetState" style="padding:10px 12px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;font-size:10px;line-height:1.5;color:#555;">' + t('netBridgeOff') + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // Footer
                '<div class="modal-footer" style="flex-shrink:0;">' +
                    '<button id="vpsPrint" class="modal-btn modal-btn-primary">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                        t('print') +
                    '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(ov);

        // events
        ov.querySelector('#vpsClose').addEventListener('click', close);
        ov.querySelector('#vpsPrint').addEventListener('click', doPrint);
        // 🛡️ v1.7.283 : navigation par onglets (Réglages / Pré-vol / Aperçu)
        ov.querySelectorAll('.vps-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                const want = tab.getAttribute('data-tab');
                ov.querySelectorAll('.vps-tab').forEach(function (x) {
                    const active = x.getAttribute('data-tab') === want;
                    x.classList.toggle('vps-tab-active', active);
                    x.style.background = active ? '#fff' : 'transparent';
                    x.style.color = active ? '#1a1a1a' : '#888';
                    x.style.borderBottomColor = active ? '#1a1a1a' : 'transparent';
                    x.style.fontWeight = active ? '700' : '600';
                });
                ov.querySelectorAll('.vps-panel').forEach(function (p) {
                    const active = p.getAttribute('data-panel') === want;
                    p.classList.toggle('vps-panel-active', active);
                    p.style.display = active ? '' : 'none';
                });
                // Re-render l'aperçu quand on l'ouvre
                if (want === 'preview') { try { buildThumbnails(); } catch (_) {} }
                if (want === 'preflight') { try { renderReport(analyze()); } catch (_) {} }
            });
        });
        ov.querySelector('#vpsImpositionBtn').addEventListener('click', function () {
            try { if (typeof showImposition === 'function') { close(); showImposition(); } } catch (_) {}
        });
        ov.querySelector('#vpsShowBleed').addEventListener('change', function () { buildThumbnails(); persistPrefs(); });
        ov.querySelector('#vpsTypoCheck').addEventListener('change', function () { if (this.checked) runTypo(); else { const b = document.getElementById('vpsTypoResult'); if (b) b.style.display = 'none'; } persistPrefs(); });
        ov.querySelectorAll('.vps-orient').forEach(function (b) {
            b.addEventListener('click', function () {
                ov.querySelectorAll('.vps-orient').forEach(function (x) {
                    x.style.background = '#fff'; x.style.color = '#1a1a1a'; x.style.borderColor = '#ccc';
                });
                b.style.background = '#1a1a1a'; b.style.color = '#fff'; b.style.borderColor = '#1a1a1a';
                persistPrefs();
                buildThumbnails();
            });
        });
        const sel = ov.querySelector('#vpsPaper');
        const fmt = docPageFormat();
        const custom = { value: 'custom', label: t('paperCustom') + ' (' + fmt.width + '×' + fmt.height + ' mm)' };
        [custom, { value: 'A6', label: t('paperA6') }, { value: 'A5', label: t('paperA5') }, { value: 'A4', label: t('paperA4') }, { value: 'A3', label: t('paperA3') }, { value: 'SRA3', label: t('paperSRA3') }, { value: 'Letter', label: t('paperLetter') }, { value: 'customsize', label: t('paperCustomSize') }].forEach(function (o) {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (o.value === 'custom') opt.selected = true;
            sel.appendChild(opt);
        });
        // Afficher/masquer les champs de taille personnalisée
        function updatePaperCustom() {
            const pc = ov.querySelector('#vpsPaperCustom');
            if (pc) pc.style.display = sel.value === 'customsize' ? 'flex' : 'none';
        }
        ov.querySelector('#vpsPaper').addEventListener('change', function () { updatePaperCustom(); persistPrefs(); buildThumbnails(); });
        try {
            const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
            if (saved.paper) sel.value = saved.paper;
            if (saved.paperW) ov.querySelector('#vpsPaperW').value = saved.paperW;
            if (saved.paperH) ov.querySelector('#vpsPaperH').value = saved.paperH;
            if (saved.quality) ov.querySelector('#vpsQuality').value = saved.quality;
            if (saved.copies) ov.querySelector('#vpsCopies').value = saved.copies;
            if (saved.showBleed) ov.querySelector('#vpsShowBleed').checked = true;
            if (saved.typo) ov.querySelector('#vpsTypoCheck').checked = true;
            if (saved.colorMode) {
                ov.querySelectorAll('.vps-cmode').forEach(function (b) {
                    const active = b.getAttribute('data-v') === saved.colorMode;
                    b.style.background = active ? '#1a1a1a' : '#fff';
                    b.style.color = active ? '#fff' : '#1a1a1a';
                    b.style.borderColor = active ? '#1a1a1a' : '#ccc';
                });
            }
            if (saved.pageRange) {
                ov.querySelectorAll('.vps-prange').forEach(function (b) {
                    const active = b.getAttribute('data-v') === saved.pageRange;
                    b.style.background = active ? '#1a1a1a' : '#fff';
                    b.style.color = active ? '#fff' : '#1a1a1a';
                    b.style.borderColor = active ? '#1a1a1a' : '#ccc';
                });
                const pc = ov.querySelector('#vpsPagesCustom');
                if (pc) pc.style.display = saved.pageRange === 'custom' ? 'block' : 'none';
                if (saved.pagesCustom) ov.querySelector('#vpsPagesCustom').value = saved.pagesCustom;
            }
            if (saved.parity) ov.querySelector('#vpsParity').value = saved.parity;
            if (saved.scale) {
                ov.querySelectorAll('.vps-scale').forEach(function (b) {
                    const active = b.getAttribute('data-v') === saved.scale;
                    b.style.background = active ? '#1a1a1a' : '#fff';
                    b.style.color = active ? '#fff' : '#1a1a1a';
                    b.style.borderColor = active ? '#1a1a1a' : '#ccc';
                });
                const sc = ov.querySelector('#vpsScaleCustom');
                const su = ov.querySelector('#vpsScaleUnit');
                if (sc) sc.style.display = saved.scale === 'custom' ? 'block' : 'none';
                if (su) su.style.display = saved.scale === 'custom' ? 'block' : 'none';
                if (saved.scaleCustom) ov.querySelector('#vpsScaleCustom').value = saved.scaleCustom;
            }
            if (saved.duplex) ov.querySelector('#vpsDuplex').checked = true;
            if (saved.orient) {
                const want = saved.orient;
                ov.querySelectorAll('.vps-orient').forEach(function (b) {
                    const active = b.getAttribute('data-v') === want;
                    b.style.background = active ? '#1a1a1a' : '#fff';
                    b.style.color = active ? '#fff' : '#1a1a1a';
                    b.style.borderColor = active ? '#1a1a1a' : '#ccc';
                });
            }
        } catch (_) {}
        updatePaperCustom();
        // Handlers boutons radio : mode couleur
        ov.querySelectorAll('.vps-cmode').forEach(function (b) {
            b.addEventListener('click', function () {
                ov.querySelectorAll('.vps-cmode').forEach(function (x) {
                    x.style.background = '#fff'; x.style.color = '#1a1a1a'; x.style.borderColor = '#ccc';
                });
                b.style.background = '#1a1a1a'; b.style.color = '#fff'; b.style.borderColor = '#1a1a1a';
                persistPrefs();
            });
        });
        // Handlers boutons radio : pages à imprimer
        ov.querySelectorAll('.vps-prange').forEach(function (b) {
            b.addEventListener('click', function () {
                ov.querySelectorAll('.vps-prange').forEach(function (x) {
                    x.style.background = '#fff'; x.style.color = '#1a1a1a'; x.style.borderColor = '#ccc';
                });
                b.style.background = '#1a1a1a'; b.style.color = '#fff'; b.style.borderColor = '#1a1a1a';
                const pc = ov.querySelector('#vpsPagesCustom');
                if (pc) pc.style.display = b.getAttribute('data-v') === 'custom' ? 'block' : 'none';
                persistPrefs();
            });
        });
        // Handlers boutons radio : gestion des pages (échelle)
        ov.querySelectorAll('.vps-scale').forEach(function (b) {
            b.addEventListener('click', function () {
                ov.querySelectorAll('.vps-scale').forEach(function (x) {
                    x.style.background = '#fff'; x.style.color = '#1a1a1a'; x.style.borderColor = '#ccc';
                });
                b.style.background = '#1a1a1a'; b.style.color = '#fff'; b.style.borderColor = '#1a1a1a';
                const sc = ov.querySelector('#vpsScaleCustom');
                const su = ov.querySelector('#vpsScaleUnit');
                const show = b.getAttribute('data-v') === 'custom';
                if (sc) sc.style.display = show ? 'block' : 'none';
                if (su) su.style.display = show ? 'block' : 'none';
                persistPrefs();
            });
        });
        ov.querySelector('#vpsParity').addEventListener('change', persistPrefs);
        ov.querySelector('#vpsDuplex').addEventListener('change', persistPrefs);
        ov.querySelector('#vpsPagesCustom').addEventListener('change', persistPrefs);
        ov.querySelector('#vpsScaleCustom').addEventListener('input', persistPrefs);
        // 🛡️ v1.7.283 : les réglages d'impression re-rendent la Preview (format papier)
        ov.querySelector('#vpsPaperW').addEventListener('change', function () { persistPrefs(); buildThumbnails(); });
        ov.querySelector('#vpsPaperH').addEventListener('change', function () { persistPrefs(); buildThumbnails(); });
        ov.querySelector('#vpsQuality').addEventListener('change', function () { persistPrefs(); buildThumbnails(); });
        ov.querySelector('#vpsCopies').addEventListener('change', persistPrefs);
    }

    function persistPrefs() {
        try {
            const ov = document.getElementById(overlayId);
            const orient = Array.from(ov.querySelectorAll('.vps-orient')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; });
            const cmode = Array.from(ov.querySelectorAll('.vps-cmode')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; });
            const prange = Array.from(ov.querySelectorAll('.vps-prange')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; });
            const scale = Array.from(ov.querySelectorAll('.vps-scale')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; });
            localStorage.setItem(LS_KEY, JSON.stringify({
                paper: ov.querySelector('#vpsPaper').value,
                paperW: ov.querySelector('#vpsPaperW').value,
                paperH: ov.querySelector('#vpsPaperH').value,
                quality: ov.querySelector('#vpsQuality').value,
                copies: ov.querySelector('#vpsCopies').value,
                orient: orient ? orient.getAttribute('data-v') : 'p',
                showBleed: ov.querySelector('#vpsShowBleed').checked ? 1 : 0,
                typo: ov.querySelector('#vpsTypoCheck').checked ? 1 : 0,
                colorMode: cmode ? cmode.getAttribute('data-v') : 'color',
                pageRange: prange ? prange.getAttribute('data-v') : 'all',
                pagesCustom: ov.querySelector('#vpsPagesCustom').value,
                parity: ov.querySelector('#vpsParity').value,
                scale: scale ? scale.getAttribute('data-v') : 'fit',
                scaleCustom: ov.querySelector('#vpsScaleCustom').value,
                duplex: ov.querySelector('#vpsDuplex').checked ? 1 : 0
            }));
        } catch (_) {}
    }

    // ─── Imprimantes réseau (pont local sp213-local) ───
    var BRIDGE_URL = 'http://127.0.0.1:8766';
    var _bridgeUp = false;
    var _netPrinters = [];

    function detectPrintBridge() {
        return fetch(BRIDGE_URL + '/api/health', { method: 'GET', mode: 'cors', cache: 'no-store' })
            .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
            .then(function (d) { _bridgeUp = !!(d && d.ok); return _bridgeUp; })
            .catch(function () { _bridgeUp = false; return false; });
    }
    function scanNetworkPrinters() {
        const state = document.getElementById('vpsNetState');
        if (!state) return;
        if (!_bridgeUp) {
            state.innerHTML = '<b>' + t('netBridgeOff') + '</b><br>' + t('netBridgeOffHint');
            return;
        }
        state.innerHTML = '<b>' + t('netScanning') + '</b>';
        fetch(BRIDGE_URL + '/api/printers', { method: 'GET', mode: 'cors', cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _netPrinters = (data && Array.isArray(data.printers)) ? data.printers : [];
                if (!_netPrinters.length) {
                    state.innerHTML = '<b>' + t('netNone') + '</b>';
                    return;
                }
                const items = _netPrinters.map(function (p) {
                    const a = p.attributes || {};
                    const model = a.model || p.name || t('netUnknown');
                    const status = a.state === 3 ? t('netIdle') : (a.state === 4 ? t('netBusy') : t('netReady'));
                    const color = a.color ? t('netColor') : t('netBW');
                    const duplex = (a.sides && a.sides.length > 1) ? t('netDuplex') : t('netOneSided');
                    return '<div class="modal-option" style="gap:10px;margin-bottom:6px;">' +
                        '<input type="radio" name="vpsNetPrinter" id="vpsNetP_' + p.id + '" value="' + p.id + '">' +
                        '<label for="vpsNetP_' + p.id + '" style="flex:1;">' +
                            '<span style="font-weight:600;">' + model + '</span>' +
                            '<div class="modal-option-desc">' + (p.host || '') + ' · ' + color + ' · ' + duplex + ' · ' + status + '</div>' +
                        '</label>' +
                        '<button class="modal-btn modal-btn-secondary" style="height:28px;padding:0 12px;font-size:9px;" data-netprint="' + p.id + '">' + t('netPrintOn') + '</button>' +
                    '</div>';
                }).join('');
                state.innerHTML = items;
                // boutons imprimer
                state.querySelectorAll('[data-netprint]').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const pid = btn.getAttribute('data-netprint');
                        const pr = _netPrinters.find(function (x) { return x.id === pid; });
                        if (pr) printToNetwork(pr);
                    });
                });
            })
            .catch(function () {
                state.innerHTML = '<b>' + t('netErr') + '</b>';
            });
    }
    function printToNetwork(printer) {
        const ov = document.getElementById(overlayId);
        if (!ov) return;
        const copies = Math.max(1, parseInt(ov.querySelector('#vpsCopies').value, 10) || 1);
        const quality = ov.querySelector('#vpsQuality').value;
        const orient = getOrient();
        const pgs = docPages();
        if (!pgs.length) { toast(t('empty'), 'warn'); return; }
        // 🛡️ v1.7.283 : imprimer dans l'ORDRE D'IMPRESSION + filtres (pages à imprimer)
        if (_vpsOrder.length !== pgs.length) _resetVpsOrder();
        const printIdx = _vpsGetPrintPages();
        if (!printIdx.length) { toast(t('empty'), 'warn'); return; }
        toast(t('netPrinting'), 'info');
        // Générer le PDF (même logique que doPrint, sans ouvrir le dialogue)
        if (!window.PDFLib) { toast(t('pdfError'), 'err'); return; }
        // 🛡️ v1.7.283 : format papier + échelle + N&B
        const paperMm = _vpsPaperSizeMm();
        const bd = docBleed();
        const isLand = orient === 'l';
        let pageW = (paperMm.wMm + bd * 2) * 72 / 25.4;
        let pageH = (paperMm.hMm + bd * 2) * 72 / 25.4;
        if (isLand) { const tmp = pageW; pageW = pageH; pageH = tmp; }
        let scaleFactor = 1;
        let scaleBtn = null;
        try { scaleBtn = Array.from(ov.querySelectorAll('.vps-scale')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; }); } catch (_) {}
        const scaleMode = scaleBtn ? scaleBtn.getAttribute('data-v') : 'fit';
        if (scaleMode === 'actual') {
            const fmt = docPageFormat();
            pageW = (fmt.width + bd * 2) * 72 / 25.4;
            pageH = (fmt.height + bd * 2) * 72 / 25.4;
            if (isLand) { const tmp = pageW; pageW = pageH; pageH = tmp; }
        } else if (scaleMode === 'custom') {
            scaleFactor = (parseFloat(ov.querySelector('#vpsScaleCustom').value) || 100) / 100;
        }
        const widthPt = pageW * scaleFactor, heightPt = pageH * scaleFactor;
        let colorMode = 'color';
        try {
            const cm = Array.from(ov.querySelectorAll('.vps-cmode')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; });
            if (cm) colorMode = cm.getAttribute('data-v');
        } catch (_) {}
        const isBW = colorMode === 'bw';
        const duplexOpt = ov.querySelector('#vpsDuplex') && ov.querySelector('#vpsDuplex').checked;
        window.PDFLib.PDFDocument.create().then(function (pdf) {
            const tasks = printIdx.map(function (origIdx) {
                return renderPageToImageWithBleed(origIdx, 'single', quality === 'ultrahd' ? 'ultrahd' : 'standard', null, false, { format: 'png', mime: 'image/png', quality: 1.0, pdfFormat: 'PNG', compression: 'NONE' }).then(function (dataUrl) {
                    if (!dataUrl) return Promise.resolve();
                    return new Promise(function (res2) {
                        const img = new Image();
                        img.onload = function () {
                            const embedPngSafe = function (src) {
                                return new Promise(function (resolve) {
                                    try {
                                        let canvas = src;
                                        if (src && src.nodeName === 'IMG') {
                                            canvas = document.createElement('canvas');
                                            canvas.width = src.naturalWidth || src.width;
                                            canvas.height = src.naturalHeight || src.height;
                                            canvas.getContext('2d').drawImage(src, 0, 0);
                                        }
                                        // 🛡️ v1.7.283 : mode N&B → niveaux de gris
                                        if (isBW && canvas) {
                                            const ctx2 = canvas.getContext('2d');
                                            const imgData = ctx2.getImageData(0, 0, canvas.width, canvas.height);
                                            const dd = imgData.data;
                                            for (let i = 0; i < dd.length; i += 4) {
                                                const g = Math.round(0.299 * dd[i] + 0.587 * dd[i + 1] + 0.114 * dd[i + 2]);
                                                dd[i] = g; dd[i + 1] = g; dd[i + 2] = g;
                                            }
                                            ctx2.putImageData(imgData, 0, 0);
                                        }
                                        const dataUrl = canvas.toDataURL('image/png');
                                        fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
                                            resolve(buf);
                                        }).catch(function () { resolve(null); });
                                    } catch (_) { resolve(null); }
                                });
                            };
                            let src = img;
                            if (isLand) {
                                const rot = document.createElement('canvas');
                                rot.width = Math.round(img.height);
                                rot.height = Math.round(img.width);
                                const rctx = rot.getContext('2d');
                                rctx.translate(rot.width / 2, rot.height / 2);
                                rctx.rotate(Math.PI / 2);
                                rctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
                                src = rot;
                            }
                            embedPngSafe(src).then(function (pngBuf) {
                                try {
                                    if (!pngBuf) { res2(); return; }
                                    const p = pdf.addPage([widthPt, heightPt]);
                                    const png = pdf.embedPng(pngBuf);
                                    p.drawImage(png, { x: 0, y: 0, width: widthPt, height: heightPt });
                                } catch (_) {}
                                res2();
                            });
                        };
                        img.onerror = function () { res2(); };
                        img.src = dataUrl;
                    });
                });
            });
            Promise.all(tasks).then(function () {
                pdf.save().then(function (bytes) {
                    // Envoyer au pont local → IPP
                    const base64 = arrayBufferToBase64(bytes);
                    fetch(BRIDGE_URL + '/api/print', {
                        method: 'POST', mode: 'cors', cache: 'no-store',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            printerId: printer.id,
                            pdfBase64: base64,
                            copies: copies,
                            color: isBW ? 'monochrome' : 'color',
                            duplex: duplexOpt ? 'two-sided-long-edge' : 'one-sided',
                            media: ov.querySelector('#vpsPaper').value === 'A4' ? 'iso_a4_210x297mm' : 'iso_a4_210x297mm',
                            orientation: orient
                        })
                    }).then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (res && res.ok) { toast(t('netSent') + ' → ' + printer.name, 'success'); }
                        else { toast(t('netErr') + ': ' + (res && res.error ? res.error : ''), 'err'); }
                    }).catch(function () { toast(t('netErr'), 'err'); });
                }).catch(function () { toast(t('pdfError'), 'err'); });
            });
        }).catch(function () { toast(t('pdfError'), 'err'); });
    }
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    // ─── Rapport pré-flight ───
    function renderReport(r) {
        const box = document.getElementById('vpsReport');
        if (!box) return;
        const fmtLabel = r.widthMm + ' × ' + r.heightMm + ' mm';
        const items = [
            { label: t('format'), value: fmtLabel, ok: true },
            { label: t('pages'), value: String(r.count), ok: true },
            { label: t('bleed'), value: r.bleed + ' mm', ok: true },
            { label: t('margin'), value: r.margin + ' mm', ok: true },
            { label: t('resTitle'), value: r.totalImages ? (r.lowRes ? r.lowRes + ' ' + t('warning') : r.totalImages + ' ' + t('okBadge')) : t('resNone'), ok: r.totalImages ? r.lowRes === 0 : true },
            { label: t('fontsTitle'), value: r.totalFonts ? r.fonts.slice(0, 3).join(', ') + (r.totalFonts > 3 ? '…' : '') : t('fontsNone'), ok: true },
            { label: t('inkTitle'), value: (r.inkCoverage < 15 ? t('inkLow') : r.inkCoverage < 45 ? t('inkMed') : t('inkHigh')) + ' (' + r.inkCoverage + ' %)', ok: r.inkCoverage <= 85 },
            { label: t('colorTitle'), value: (r.alphaPixels ? t('colorAlpha') + ' ' : '') + (r.grayPixels > r.rgbPixels ? t('colorGray') : t('colorRGB')), ok: true }
        ];
        box.innerHTML = items.map(function (it) {
            return '<div style="background:#f8f8f8;border:1px solid #e0e0e0;padding:10px 12px;">' +
                '<div style="font-size:8.5px;text-transform:uppercase;letter-spacing:0.6px;opacity:0.55;margin-bottom:3px;">' + it.label + '</div>' +
                '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;">' +
                    '<span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' + (it.ok ? '#2fbf71' : '#f0a020') + ';"></span>' +
                    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + it.value + '</span>' +
                '</div></div>';
        }).join('');
        const dot = document.getElementById('vpsStatusDot');
        const txt = document.getElementById('vpsStatusText');
        if (dot) dot.style.background = '#2fbf71';
        if (txt) txt.textContent = t('ok');
        const typoEl = document.getElementById('vpsTypoCheck');
        if (typoEl && typoEl.checked) runTypo();
    }

    function runTypo() {
        const box = document.getElementById('vpsTypoResult');
        if (!box) return;
        const issues = runTypoCheck();
        box.style.display = 'block';
        if (!issues.length) {
            box.style.background = '#eef6ee';
            box.style.borderColor = '#cfe3cf';
            box.style.color = '#1a7f37';
            box.textContent = '✓ ' + t('typoNone');
        } else {
            box.style.background = '#fff8e1';
            box.style.borderColor = '#f0e2a8';
            box.style.color = '#6b5400';
            box.innerHTML = '<b>' + issues.length + ' ' + t('typoSome') + '</b>';
            const ul = document.createElement('div');
            ul.style.marginTop = '4px';
            issues.slice(0, 30).forEach(function (iss) {
                const d = document.createElement('div');
                d.style.fontSize = '9.5px';
                d.style.marginTop = '2px';
                d.textContent = 'P' + iss.page + ' — ' + iss.msg + (iss.snippet ? ' («' + iss.snippet + '») ' : '');
                ul.appendChild(d);
            });
            box.appendChild(ul);
        }
    }

    // ─── Générer le PDF d'impression (indépendant, bleed + orientation) ───
    // 🛡️ v1.7.283 : helper — filtre les pages à imprimer selon les options
    // (Tout / Active / personnalisé + parité). Utilise _vpsOrder (ordre d'impression).
    function _vpsGetPrintPages() {
        const pgs = docPages();
        if (!pgs.length) return [];
        if (_vpsOrder.length !== pgs.length) _resetVpsOrder();
        const order = _vpsOrder.slice();
        const ov = document.getElementById(overlayId);
        if (!ov) return order;
        // Sélection de la plage
        let rangeBtn = null;
        try { rangeBtn = Array.from(ov.querySelectorAll('.vps-prange')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; }); } catch (_) {}
        const range = rangeBtn ? rangeBtn.getAttribute('data-v') : 'all';
        let pages = order.slice();
        if (range === 'active') {
            // Page active = currentPageIndex (index maquette) → position dans l'ordre
            let activeIdx = 0;
            try { if (typeof currentPageIndex === 'number') activeIdx = currentPageIndex; } catch (_) {}
            pages = pages.filter(function (idx) { return idx === activeIdx; });
            if (!pages.length && order.length) pages = [order[0]];
        } else if (range === 'custom') {
            const raw = (ov.querySelector('#vpsPagesCustom') ? ov.querySelector('#vpsPagesCustom').value : '') || '';
            const wanted = new Set();
            const parts = String(raw).split(/[,\s;]+/).filter(function (s) { return s.trim(); });
            parts.forEach(function (part) {
                const m = /^(\d+)\s*-\s*(\d+)$/.exec(part.trim());
                if (m) {
                    let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
                    if (a > b) { const tmp = a; a = b; b = tmp; }
                    for (let i = a; i <= b; i++) wanted.add(i);
                } else {
                    const n = parseInt(part.trim(), 10);
                    if (!isNaN(n)) wanted.add(n);
                }
            });
            // Les numéros saisis = numéros de pages ORIGINAUX (1-based) → filtrage
            pages = pages.filter(function (idx) { return wanted.has(idx + 1); });
        }
        // Parité
        const parity = (ov.querySelector('#vpsParity') ? ov.querySelector('#vpsParity').value : 'all');
        if (parity === 'even') pages = pages.filter(function (idx) { return (idx + 1) % 2 === 0; });
        else if (parity === 'odd') pages = pages.filter(function (idx) { return (idx + 1) % 2 === 1; });
        return pages;
    }

    // 🛡️ v1.7.283 : helper — taille de papier (A6/A5/A4/A3/SRA3/Letter/customsize)
    // Retourne {wMm, hMm} en mm (format du document si 'custom').
    function _vpsPaperSizeMm() {
        const ov = document.getElementById(overlayId);
        const fmt = docPageFormat();
        let paper = 'custom';
        try { if (ov && ov.querySelector('#vpsPaper')) paper = ov.querySelector('#vpsPaper').value; } catch (_) {}
        const sizes = {
            'A6': [105, 148], 'A5': [148, 210], 'A4': [210, 297], 'A3': [297, 420],
            'SRA3': [320, 450], 'Letter': [216, 279]
        };
        if (paper === 'customsize') {
            let w = 210, h = 297;
            try {
                w = parseFloat(ov.querySelector('#vpsPaperW').value) || 210;
                h = parseFloat(ov.querySelector('#vpsPaperH').value) || 297;
            } catch (_) {}
            return { wMm: w, hMm: h };
        }
        if (sizes[paper]) return { wMm: sizes[paper][0], hMm: sizes[paper][1] };
        return { wMm: fmt.width, hMm: fmt.height };
    }

    function doPrint() {
        const ov = document.getElementById(overlayId);
        if (!ov) return;
        const copies = Math.max(1, parseInt(ov.querySelector('#vpsCopies').value, 10) || 1);
        const quality = ov.querySelector('#vpsQuality').value;
        const pgs = docPages();
        if (!pgs.length) { toast(t('empty'), 'warn'); return; }
        // 🛡️ v1.7.283 : imprimer dans l'ORDRE D'IMPRESSION (_vpsOrder), pas l'ordre maquette
        if (_vpsOrder.length !== pgs.length) _resetVpsOrder();
        // 🛡️ v1.7.283 : appliquer les filtres (pages à imprimer)
        let printIdx = _vpsGetPrintPages();
        if (!printIdx.length) { toast(t('empty'), 'warn'); return; }

        const btn = ov.querySelector('#vpsPrint');
        const old = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '⏳ ' + t('analyze');

        const buildPdf = function () {
            return new Promise(function (resolve, reject) {
                if (!window.PDFLib) { reject(new Error('PDFLib missing')); return; }
                // 🛡️ v1.7.283 : format papier (A6/SRA3/customsize...) + fond perdu
                const paperMm = _vpsPaperSizeMm();
                const bd = docBleed();
                const orient = getOrient();
                const isLand = orient === 'l';
                let pageW = (paperMm.wMm + bd * 2) * 72 / 25.4;
                let pageH = (paperMm.hMm + bd * 2) * 72 / 25.4;
                if (isLand) { const tmp = pageW; pageW = pageH; pageH = tmp; }
                // 🛡️ v1.7.283 : échelle (fit / actual / custom)
                let scaleFactor = 1;
                let scaleBtn = null;
                try { scaleBtn = Array.from(ov.querySelectorAll('.vps-scale')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; }); } catch (_) {}
                const scaleMode = scaleBtn ? scaleBtn.getAttribute('data-v') : 'fit';
                if (scaleMode === 'actual') {
                    // Taille réelle : on ignore le format papier, on utilise la taille du document
                    const fmt = docPageFormat();
                    pageW = (fmt.width + bd * 2) * 72 / 25.4;
                    pageH = (fmt.height + bd * 2) * 72 / 25.4;
                    if (isLand) { const tmp = pageW; pageW = pageH; pageH = tmp; }
                } else if (scaleMode === 'custom') {
                    scaleFactor = (parseFloat(ov.querySelector('#vpsScaleCustom').value) || 100) / 100;
                }
                const widthPt = pageW * scaleFactor, heightPt = pageH * scaleFactor;
                // 🛡️ v1.7.283 : mode N&B
                let colorMode = 'color';
                try {
                    const cm = Array.from(ov.querySelectorAll('.vps-cmode')).find(function (b) { return b.style.background === 'rgb(26, 26, 26)'; });
                    if (cm) colorMode = cm.getAttribute('data-v');
                } catch (_) {}
                const isBW = colorMode === 'bw';
                window.PDFLib.PDFDocument.create().then(function (pdf) {
                    const tasks = [];
                    for (let c = 0; c < copies; c++) {
                        printIdx.forEach(function (origIdx) {
                            tasks.push(renderPageToImageWithBleed(origIdx, 'single', quality === 'ultrahd' ? 'ultrahd' : 'standard', null, false, { format: 'png', mime: 'image/png', quality: 1.0, pdfFormat: 'PNG', compression: 'NONE' }).then(function (dataUrl) {
                                if (!dataUrl) return;
                                const img = new Image();
                                return new Promise(function (res2) {
                                    img.onload = function () {
                                        const embedPngSafe = function (src) {
                                            // Convertit une image/canvas en ArrayBuffer PNG pour pdf-lib
                                            return new Promise(function (resolve) {
                                                try {
                                                    let canvas = src;
                                                    if (src && src.nodeName === 'IMG') {
                                                        canvas = document.createElement('canvas');
                                                        canvas.width = src.naturalWidth || src.width;
                                                        canvas.height = src.naturalHeight || src.height;
                                                        canvas.getContext('2d').drawImage(src, 0, 0);
                                                    }
                                                    // 🛡️ v1.7.283 : mode N&B → conversion en niveaux de gris
                                                    if (isBW && canvas) {
                                                        const ctx2 = canvas.getContext('2d');
                                                        const imgData = ctx2.getImageData(0, 0, canvas.width, canvas.height);
                                                        const dd = imgData.data;
                                                        for (let i = 0; i < dd.length; i += 4) {
                                                            const g = Math.round(0.299 * dd[i] + 0.587 * dd[i + 1] + 0.114 * dd[i + 2]);
                                                            dd[i] = g; dd[i + 1] = g; dd[i + 2] = g;
                                                        }
                                                        ctx2.putImageData(imgData, 0, 0);
                                                    }
                                                    const dataUrl = canvas.toDataURL('image/png');
                                                    fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
                                                        resolve(buf);
                                                    }).catch(function () { resolve(null); });
                                                } catch (_) { resolve(null); }
                                            });
                                        };
                                        // Rotation 90° si paysage, puis embed sécurisé
                                        let src = img;
                                        if (isLand) {
                                            const rot = document.createElement('canvas');
                                            rot.width = Math.round(img.height);
                                            rot.height = Math.round(img.width);
                                            const rctx = rot.getContext('2d');
                                            rctx.translate(rot.width / 2, rot.height / 2);
                                            rctx.rotate(Math.PI / 2);
                                            rctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
                                            src = rot;
                                        }
                                        embedPngSafe(src).then(function (pngBuf) {
                                            try {
                                                if (!pngBuf) { res2(); return; }
                                                const p = pdf.addPage([widthPt, heightPt]);
                                                const png = pdf.embedPng(pngBuf);
                                                p.drawImage(png, { x: 0, y: 0, width: widthPt, height: heightPt });
                                            } catch (_) {}
                                            res2();
                                        });
                                    };
                                    img.onerror = function () { res2(); };
                                    img.src = dataUrl;
                                });
                            }).catch(function () {}));
                        });
                    }
                    Promise.all(tasks).then(function () {
                        pdf.save().then(function (bytes) {
                            resolve(new Blob([bytes], { type: 'application/pdf' }));
                        }).catch(reject);
                    });
                }).catch(reject);
            });
        };

        buildPdf().then(function (blob) {
            btn.innerHTML = old;
            btn.disabled = false;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'superprint-print.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            try {
                const ifr = document.createElement('iframe');
                ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
                document.body.appendChild(ifr);
                const idoc = ifr.contentDocument;
                idoc.open(); idoc.write('<html><head><title>' + t('title') + '</title></head><body style="margin:0;padding:0;"></body></html>'); idoc.close();
                const emb = idoc.createElement('embed');
                emb.type = 'application/pdf';
                emb.style.cssText = 'width:100%;height:100%;';
                emb.src = url;
                idoc.body.appendChild(emb);
                setTimeout(function () {
                    try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (_) {}
                }, 700);
                setTimeout(function () {
                    try { if (ifr.parentNode) ifr.parentNode.removeChild(ifr); } catch (_) {}
                }, 3000);
            } catch (_) {}
            toast(t('ok'), 'success');
        }).catch(function (err) {
            btn.innerHTML = old;
            btn.disabled = false;
            if (DEBUG) console.error('[VPS]', err);
            toast(t('pdfError'), 'err');
        });
    }

    // ─── Ouvrir / fermer ───
    function open() {
        buildHTML();
        // 🛡️ v1.7.283 : réinitialiser l'ordre d'impression (== ordre maquette par défaut)
        _resetVpsOrder();
        const ov = document.getElementById(overlayId);
        ov.style.display = 'flex';
        ov.querySelector('.vps-title').textContent = t('title');
        const subEl = document.getElementById('vpsSubtitle');
        if (subEl) subEl.textContent = t('subtitle');
        ov.querySelector('#vpsStatusText').textContent = t('analyze');
        document.getElementById('vpsStatusDot').style.background = '#f0a020';
        // Détecter le pont local + imprimantes réseau
        detectPrintBridge().then(function (up) {
            if (up) scanNetworkPrinters();
            else {
                const st = document.getElementById('vpsNetState');
                if (st) st.innerHTML = '<b>' + t('netBridgeOff') + '</b><br>' + t('netBridgeOffHint');
            }
        });
        setTimeout(function () { try { renderReport(analyze()); } catch (_) {} }, 30);
        setTimeout(buildThumbnails, 60);
    }
    function close() {
        _thumbGeneration++;
        _thumbQueue = [];
        _thumbBusy = false;
        if (_dragClone) {
            try { if (_dragClone.parentNode) _dragClone.parentNode.removeChild(_dragClone); } catch (_) {}
            _dragClone = null;
        }
        _thumbClearIndicator();
        if (_dragCard) _dragCard.style.opacity = '';
        _dragCard = null;
        _dragItemPrintPos = -1;
        _dragActive = false;
        const ov = document.getElementById(overlayId);
        if (ov) ov.style.display = 'none';
    }

    // ─── Raccourci Ctrl+Alt+P ───
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.altKey && (e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            e.stopPropagation();
            open();
        }
    }, true);

    window.SPPrintStudio = { open: open, close: close, analyze: analyze, runTypo: runTypo };
})();
