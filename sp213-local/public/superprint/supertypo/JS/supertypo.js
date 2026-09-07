/* ═══════════════════════════════════════════════════════════════════════
   SUPER TYPO — Décomposeur & éditeur de typographie
   ---------------------------------------------------------------------
   Idées directrices (inspiration FontGrapher / FontLab, DA SuperPrint) :
   • Déposer une police (.ttf/.otf/.woff/.woff2) → chaque glyphe est
     « décomposé » en contours vectoriels (nœuds + poignées de Bézier).
   • Grille des caractères : clic → éditeur plein-écran pour retravailler
     la lettre (outils plume, nœud, sélection), puis « refermer ».
   • Export natif .sf (SuperFont, JSON versionné) + ré-export TTF/OTF.
   ---------------------------------------------------------------------
   Convention de coordonnées INTERNE : Y↑ (unité em, upem).
   - Import : glyph.getPath() renvoie Y↓  → on inverse y = -y.
   - Export : on redonne les contours en Y↑ → glyf stocke Y↑ fidèle.
   - Rendu : ctx.scale(z, -z) + translate mappe (0..upem, Y↑) → pixels.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ────────────────────────── ÉTAT GLOBAL ────────────────────────── */
  const ST = {
    opentype: null,            // lib
    font: null,                // police source parseée
    fontName: 'Police',
    fileName: '',
    upem: 1000,
    ascender: 800, descender: -200, capHeight: 700, xHeight: 500,
    glyphs: [],                // [{id,name,unicode,char,advanceWidth,contours,originalContours,dirty}]
    originalBuffer: null,      // buffer source (référence)
    // Vue grille
    gridMode: 'render',        // 'render' | 'outline'
    gridZoom: 1,
    sampleChars: '',
    search: '',
    showEmpty: false,
    // Éditeur
    editing: false,
    editGlyph: null,           // index dans ST.glyphs
    tool: 'select',
    sel: null,                 // {ci, ni} ou {ci} contour ou null
    selHandles: [],            // nœuds/poignées multi-sélection
    boolSel: { a: null, b: null },  // contours A/B pour les booléens
    dirty: false,
    // Undo
    undoStack: [], redoStack: [],
    theme: 'light',
    // i18n minimal
    lang: 'fr'
  };

  const $ = (id) => document.getElementById(id);

  /* ════════════════════════ I18N : fr / en / ja ════════════════════════
     Dictionnaire des textes visibles de l'UI. Le HTML porte déjà les
     attributs data-i18n (textContent) et data-i18n-ph (placeholder).
     applyLang() applique la langue courante (ST.lang, persisté en
     localStorage sous la clé 'st_lang') puis re-rend la grille / l'éditeur.
     t(key) sert aux chaînes générées en dur dans le JS (toasts, étiquettes
     de contour, messages) ; tf(key, vars) permet la substitution {x}. */
  const I18N = {
    fr: {
      // ── Topbar ──
      btnLoadFont: 'Charger une police',
      btnChangeFont: 'Changer de police',
      btnSaveSf: 'Enregistrer .sf',
      btnExportFont: 'Exporter la typo',
      chipPolice: 'Police',
      chipGlyphs: 'Glyphes',
      chipModified: 'Modifié',
      // ── Intro (drop) ──
      dropTitle: 'Décomposez chaque lettre, retravaillez-la, réexportez-la.',
      dropSub: 'Déposez une police ici, ou cliquez pour parcourir vos fichiers. Chaque caractère sera décomposé en contours vectoriels que vous pourrez éditer à la plume, à la manière d\'un FontGrapher.',
      dropPick: 'Choisir un fichier .ttf .otf .woff .woff2',
      dropHint: 'Astuce : vous pouvez aussi ouvrir un fichier .sf (SuperFont) pour continuer un travail.',
      // ── Grille ──
      glyphGridTitle: 'Caractères décomposés',
      searchPlaceholder: 'Rechercher un caractère…',
      samplePh: 'Caractères affichés dans la grille — modifiez puis Entrée.',
      sampleHint: 'Caractères affichés dans la grille — modifiez puis Entrée.',
      optShowAll: 'Afficher tous les glyphes',
      gridEmpty: 'Aucun glyphe à afficher.',
      gridGlyphSing: 'glyphe',
      gridGlyphPlur: 'glyphes',
      gridTotalText: 'au total',
      contourSing: 'contour',
      contourPlur: 'contours',
      glyphDefault: 'glyphe',
      // ── Panneau éditeur ──
      spTransform: 'Transformations',
      spPos: 'Position',
      spAdvance: 'Advance',
      spContours: 'Contours',
      spAddRect: '+ Rectangle',
      spAddEllipse: '+ Ellipse',
      spMirror: 'Symétrie',
      spMirrorH: 'Symétrie H',
      spMirrorV: 'Symétrie V',
      spRot90: 'Rotation 90°',
      spRotate90: 'Rotation 90°',
      spReverse: 'Inverser le sens',
      spNode: 'Nœud sélectionné',
      spNodeType: 'Type de nœud',
      ndCorner: 'Angle (corner)',
      ndSmooth: 'Lisse (smooth)',
      ndSymmetric: 'Symétrique',
      spGuides: 'Repères',
      gGuides: 'Afficher repères (baseline, x-height, cap-height)',
      gGrid: 'Afficher la grille',
      gSnap: 'Magnétisme',
      // ── Métriques ──
      spMetrics: 'Métriques',
      mGlyphName: 'Nom',
      mContours: 'Contours',
      mPoints: 'Points',
      mLSB: 'Déb. gauche',
      mRSB: 'Déb. droite',
      // ── Outils (HUD) ──
      toolSelect: 'Sélection',
      toolPen: 'Plume',
      toolNode: 'Nœud',
      toolShape: 'Forme',
      toolDelete: 'Supprimer',
      handleIn: 'poignée in',
      handleOut: 'poignée out',
      contourClosed: '{n} pts · fermé',
      contourOpen: '{n} pts · ouvert',
      // ── Booléens ──
      spUnion: 'Union',
      spSubtract: 'Soustraction',
      spIntersect: 'Intersection',
      boolNeedTwo: 'Sélectionnez 2 contours (A puis B).',
      boolNoContain: 'v1 : B doit être entièrement dans A (soustraction/intersection).',
      boolStatusBoth: 'A={x} · B={y} — prêt',
      boolStatusA: 'A={x} — cliquez un 2ᵉ contour',
      // ── Divers (toasts, messages JS) ──
      trfNeedContour: 'Sélectionnez d\'abord un contour.',
      toastTypoExported: 'Typo exportée : {name}',
      toastSfSaved: 'Projet SuperFont enregistré (.sf)',
      errExport: 'Erreur export : {msg}',
      toastResync: 'Police re-synchronisée depuis la source.',
      errLoad: 'Impossible de charger « {name} » : {msg}',
      toastRestored: 'Travail restauré depuis l\'autosave.',
      // ── Aide / raccourcis ──
      docTitle: 'SuperTyPo — Décomposeur & éditeur de typographie',
      helpTitle: 'SuperTyPo — Raccourcis',
      helpEdit: 'Éditeur',
      helpGrid: 'Grille / globale',
      hSel: 'Sélection / transformation',
      hPen: 'Plume — poser des points',
      hNode: 'Nœud / courbure',
      hShape: 'Formes (rectangle / ellipse)',
      hAddP: 'Ajouter un point sur une courbe',
      hDel: 'Supprimer la sélection',
      hEsc: 'Fermer l\'éditeur',
      hUndo: 'Annuler / Rétablir',
      hZoom100: 'Zoom 100%',
      hZoom: 'Zoom',
      hFind: 'Chercher un glyphe',
      hExp: 'Exporter la typo',
      hSave: 'Enregistrer .sf',
      hGridZoom: 'Zoom de la grille'
    },

    en: {
      btnLoadFont: 'Load a font',
      btnChangeFont: 'Change font',
      btnSaveSf: 'Save .sf',
      btnExportFont: 'Export typeface',
      chipPolice: 'Font',
      chipGlyphs: 'Glyphs',
      chipModified: 'Modified',
      dropTitle: 'Break down each letter, rework it, export it again.',
      dropSub: 'Drop a font here, or click to browse your files. Every character is decomposed into vector contours you can edit with the pen, FontGrapher-style.',
      dropPick: 'Choose a .ttf .otf .woff .woff2 file',
      dropHint: 'Tip: you can also open a .sf (SuperFont) file to keep working.',
      glyphGridTitle: 'Decomposed characters',
      searchPlaceholder: 'Search for a character…',
      samplePh: 'Characters shown in the grid — edit then press Enter.',
      sampleHint: 'Characters shown in the grid — edit then press Enter.',
      optShowAll: 'Show all glyphs',
      gridEmpty: 'No glyph to display.',
      gridGlyphSing: 'glyph',
      gridGlyphPlur: 'glyphs',
      gridTotalText: 'total',
      contourSing: 'contour',
      contourPlur: 'contours',
      glyphDefault: 'glyph',
      spTransform: 'Transform',
      spPos: 'Position',
      spAdvance: 'Advance',
      spContours: 'Contours',
      spAddRect: '+ Rectangle',
      spAddEllipse: '+ Ellipse',
      spMirror: 'Mirror',
      spMirrorH: 'Mirror H',
      spMirrorV: 'Mirror V',
      spRot90: 'Rotate 90°',
      spRotate90: 'Rotate 90°',
      spReverse: 'Reverse',
      spNode: 'Selected node',
      spNodeType: 'Node type',
      ndCorner: 'Corner',
      ndSmooth: 'Smooth',
      ndSymmetric: 'Symmetric',
      spGuides: 'Guides',
      gGuides: 'Show guides (baseline, x-height, cap-height)',
      gGrid: 'Show grid',
      gSnap: 'Snapping',
      spMetrics: 'Metrics',
      mGlyphName: 'Name',
      mContours: 'Contours',
      mPoints: 'Points',
      mLSB: 'Left bearing',
      mRSB: 'Right bearing',
      toolSelect: 'Select',
      toolPen: 'Pen',
      toolNode: 'Node',
      toolShape: 'Shape',
      toolDelete: 'Delete',
      handleIn: 'in handle',
      handleOut: 'out handle',
      contourClosed: '{n} pts · closed',
      contourOpen: '{n} pts · open',
      spUnion: 'Union',
      spSubtract: 'Subtract',
      spIntersect: 'Intersect',
      boolNeedTwo: 'Select 2 contours (A then B).',
      boolNoContain: 'v1: B must be fully inside A (subtract/intersect).',
      boolStatusBoth: 'A={x} · B={y} — ready',
      boolStatusA: 'A={x} — click a 2nd contour',
      trfNeedContour: 'Select a contour first.',
      toastTypoExported: 'Typeface exported: {name}',
      toastSfSaved: 'SuperFont project saved (.sf)',
      errExport: 'Export error: {msg}',
      toastResync: 'Font re-synced from source.',
      errLoad: 'Unable to load "{name}": {msg}',
      toastRestored: 'Work restored from autosave.',
      docTitle: 'SuperTyPo — Type decomposition & editor',
      helpTitle: 'SuperTyPo — Shortcuts',
      helpEdit: 'Editor',
      helpGrid: 'Grid & global',
      hSel: 'Select / transform',
      hPen: 'Pen — add points',
      hNode: 'Node / curvature',
      hShape: 'Shapes (rectangle / ellipse)',
      hAddP: 'Add a point on a curve',
      hDel: 'Delete selection',
      hEsc: 'Close editor',
      hUndo: 'Undo / Redo',
      hZoom100: 'Zoom 100%',
      hZoom: 'Zoom',
      hFind: 'Find a glyph',
      hExp: 'Export typeface',
      hSave: 'Save .sf',
      hGridZoom: 'Grid zoom'
    },

    ja: {
      btnLoadFont: 'フォントを読み込む',
      btnChangeFont: 'フォントを変更',
      btnSaveSf: '.sf を保存',
      btnExportFont: 'フォントを書き出し',
      chipPolice: 'フォント',
      chipGlyphs: 'グリフ',
      chipModified: '変更あり',
      dropTitle: '文字をパスに分解し、編集し、書き出しましょう。',
      dropSub: 'ここにフォントをドロップするか、クリックしてファイルを選択します。各文字はベクターのパス（アウトライン）に分解され、ペンツールでFontGrapherのように編集できます。',
      dropPick: '.ttf .otf .woff .woff2 を選択',
      dropHint: 'ヒント：.sf（SuperFont）ファイルを開いて作業を続けることもできます。',
      glyphGridTitle: '分解された文字',
      searchPlaceholder: '文字を検索…',
      samplePh: 'グリッドに表示する文字 — 編集してEnter。',
      sampleHint: 'グリッドに表示する文字 — 編集してEnter。',
      optShowAll: 'すべてのグリフを表示',
      gridEmpty: '表示するグリフがありません。',
      gridGlyphSing: 'グリフ',
      gridGlyphPlur: 'グリフ',
      gridTotalText: '合計',
      contourSing: 'パス',
      contourPlur: 'パス',
      glyphDefault: 'グリフ',
      spTransform: '変形',
      spPos: '位置',
      spAdvance: '前進幅',
      spContours: 'パス',
      spAddRect: '+ 長方形',
      spAddEllipse: '+ 楕円',
      spMirror: 'ミラー',
      spMirrorH: '水平ミラー',
      spMirrorV: '垂直ミラー',
      spRot90: '90°回転',
      spRotate90: '90°回転',
      spReverse: '反転',
      spNode: '選択ノード',
      spNodeType: 'ノードの種類',
      ndCorner: '角（コーナー）',
      ndSmooth: 'なめらか（スムース）',
      ndSymmetric: '対称',
      spGuides: 'ガイド',
      gGuides: 'ガイドを表示（ベースライン、x-height、cap-height）',
      gGrid: 'グリッドを表示',
      gSnap: 'スナップ',
      spMetrics: 'メトリクス',
      mGlyphName: '名前',
      mContours: 'パス',
      mPoints: '点',
      mLSB: '左マージン',
      mRSB: '右マージン',
      toolSelect: '選択',
      toolPen: 'ペン',
      toolNode: 'ノード',
      toolShape: '図形',
      toolDelete: '削除',
      handleIn: 'ハンドルin',
      handleOut: 'ハンドルout',
      contourClosed: '{n}点・閉',
      contourOpen: '{n}点・開',
      spUnion: '結合',
      spSubtract: '減算',
      spIntersect: '交差',
      boolNeedTwo: 'パスを2つ選択（A→B）。',
      boolNoContain: 'v1：BはAの内側に完全に入る必要があります（減算・交差）。',
      boolStatusBoth: 'A={x}・B={y} — 準備OK',
      boolStatusA: 'A={x} — 2つ目のパスをクリック',
      trfNeedContour: '先にパスを選択してください。',
      toastTypoExported: 'フォントを書き出しました：{name}',
      toastSfSaved: 'SuperFontプロジェクトを保存しました（.sf）',
      errExport: '書き出しエラー：{msg}',
      toastResync: 'フォントを元データと再同期しました。',
      errLoad: '「{name}」を読み込めません：{msg}',
      toastRestored: 'オートセーブから復元しました。',
      docTitle: 'SuperTyPo — フォント分解・エディター',
      helpTitle: 'SuperTyPo — ショートカット',
      helpEdit: 'エディター',
      helpGrid: 'グリッド・全体',
      hSel: '選択・変形',
      hPen: 'ペン — 点を打つ',
      hNode: 'ノード・曲線',
      hShape: '図形（長方形・楕円）',
      hAddP: '曲線上に点を追加',
      hDel: '選択を削除',
      hEsc: 'エディターを閉じる',
      hUndo: '元に戻す／やり直す',
      hZoom100: 'ズーム100%',
      hZoom: 'ズーム',
      hFind: 'グリフを検索',
      hExp: 'フォントを書き出し',
      hSave: '.sf を保存',
      hGridZoom: 'グリッドのズーム'
    }
  };

  // Traduction simple : clé → texte courant (retombe sur fr puis sur la clé).
  function t(key) {
    const d = I18N[ST.lang] || I18N.fr;
    return (d && d[key] != null) ? d[key] : ((I18N.fr && I18N.fr[key] != null) ? I18N.fr[key] : key);
  }
  // tf(key, vars) : traduction avec substitution {x} → valeur.
  function tf(key, vars) {
    let s = t(key);
    for (const k in (vars || {})) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }

  // Petits helpers d'écriture (silencieux si l'élément n'existe pas).
  function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
  function setInput(id, v) { const e = $(id); if (e) e.value = v; }

  // Applique la langue courante à toute l'UI puis re-rend.
  function applyLang() {
    const lang = (ST.lang in I18N) ? ST.lang : 'fr';
    const sel = $('langSel');
    if (sel) sel.value = lang;
    // textes fixes [data-i18n] → textContent
    document.querySelectorAll('[data-i18n]').forEach((e) => {
      const k = e.getAttribute('data-i18n');
      if (k && t(k) !== k) e.textContent = t(k);
    });
    // placeholders [data-i18n-ph] → placeholder
    document.querySelectorAll('[data-i18n-ph]').forEach((e) => {
      const k = e.getAttribute('data-i18n-ph');
      if (k && t(k) !== k) e.setAttribute('placeholder', t(k));
    });
    // titre de page + langue du document
    try { document.title = t('docTitle'); } catch (e2) {}
    if (document.documentElement) document.documentElement.lang = lang;
    // libellés générés en dur (HUD, étiquettes, métriques, statut booléen)
    updateHud();
    if (ST.editing) { updateSidePanel(); editorRender(); }
    buildGlyphGrid();
  }

  /* ────────────────────────── UI HELPERS ────────────────────────── */
  function toast(msg, isErr) {
    let t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = isErr ? 'err show' : 'show';
    clearTimeout(t._tm);
    t._tm = setTimeout(() => { t.className = ''; }, 2600);
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ────────────────────────── FICHIER ────────────────────────── */
  async function arrayBufferFromFile(file) {
    return await file.arrayBuffer();
  }

  // Initialise le module wawoff2 (Emscripten) pour décompresser les .woff2.
  // On pose onRuntimeInitialized AVANT d'injecter wawoff2.js (sinon le runtime
  // a déjà tourné et le callback n'est jamais appelé).
  let _wawoff2Promise = null;
  function initWawoff2() {
    if (window.wawoff2_decompress && window.SP_Wawoff2Ready) return Promise.resolve(true);
    if (_wawoff2Promise) return _wawoff2Promise;
    _wawoff2Promise = new Promise((resolve) => {
      let resolveReady = null;
      const readyP = new Promise((r) => { resolveReady = r; });
      window.Module = window.Module || {};
      // N'écrase pas un onRuntimeInitialized déjà posé par l'app superprint.
      const prevInit = window.Module.onRuntimeInitialized;
      window.Module.onRuntimeInitialized = function () {
        try { if (prevInit) prevInit(); } catch (e) {}
        window.SP_Wawoff2Ready = true;
        if (resolveReady) resolveReady(true);
      };
      window.wawoff2_decompress = function (buffer) {
        return readyP.then(() => {
          const M = window.Module;
          if (!M || typeof M.decompress !== 'function') throw new Error('wawoff2: decompress() not available');
          const u8 = (buffer instanceof Uint8Array) ? buffer : new Uint8Array(buffer);
          const out = M.decompress(u8);
          return out instanceof Uint8Array ? out : new Uint8Array(out);
        });
      };
      // Injecter le script
      const sc = document.createElement('script');
      sc.src = 'JS/wawoff2.js';
      sc.onload = () => {
        // Si le module a déjà tourné de façon synchrone, onRuntimeInitialized
        // n'a pas pu être appelé → on vérifie directement.
        try {
          if (window.Module && window.Module.calledRun && typeof window.Module.decompress === 'function') {
            window.SP_Wawoff2Ready = true;
            if (resolveReady) resolveReady(true);
            resolve(true);
            return;
          }
        } catch (e) {}
        readyP.then(() => resolve(true)).catch(() => resolve(false));
        // Sécurité timeout
        setTimeout(() => { if (!window.SP_Wawoff2Ready && resolveReady) resolveReady(true); }, 8000);
      };
      sc.onerror = () => { window.wawoff2_decompress = null; resolve(false); };
      document.head.appendChild(sc);
    });
    return _wawoff2Promise;
  }

  // Normalise un buffer de police (woff2/woff → ttf/otf si possible)
  async function normalizeFontBuffer(buf) {
    // opentype.parse gère TTF/OTF/WOFF v1 ; pas WOFF2.
    const bytes = new Uint8Array(buf);
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (tag === 'wOF2') {
      if (!window.wawoff2_decompress) await initWawoff2();
      if (window.wawoff2_decompress) {
        const out = await window.wawoff2_decompress(bytes);
        return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
      }
      throw new Error('WOFF2 : le décompresseur n’est pas disponible.');
    }
    return buf;
  }

  /* ─────────────────── IMPORT : GLYPHES → CONTOURS ─────────────────── */
  // Convertit les commandes opentype (Y↓) en contours Y↑ (nœuds + poignées).
  // Sortie : [{ closed, nodes:[{x,y,type,in:{x,y}|null,out:{x,y}|null}] }]
  function commandsToContours(cmds) {
    // 1) Regrouper en sous-chemins fermés par M..Z, avec conversion Q→C.
    const contours = [];
    let cur = null;
    let curStart = null;
    const closeContour = () => {
      if (cur && cur.length) {
        contours.push({ segments: cur, start: curStart, closed: !!curStart });
        cur = null; curStart = null;
      }
    };
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      if (c.type === 'M') {
        closeContour();
        cur = []; curStart = { x: c.x, y: c.y };
      } else if (c.type === 'L') {
        if (!cur) { cur = []; curStart = { x: c.x, y: c.y }; }
        cur.push({ from: cur.length ? lastEnd(cur) : curStart, to: { x: c.x, y: c.y } });
      } else if (c.type === 'C') {
        if (!cur) { cur = []; curStart = { x: c.x1, y: c.y1 }; }
        cur.push({ from: cur.length ? lastEnd(cur) : curStart, c1: { x: c.x1, y: c.y1 }, c2: { x: c.x2, y: c.y2 }, to: { x: c.x, y: c.y } });
      } else if (c.type === 'Q') {
        if (!cur) { cur = []; curStart = { x: c.x1, y: c.y1 }; }
        // Quadratique → cubique : c1 = q + 2/3(qp - q), c2 = qp + 2/3(qe - qp)
        const from = cur.length ? lastEnd(cur) : curStart;
        const q = { x: c.x1, y: c.y1 };
        const to = { x: c.x, y: c.y };
        const c1 = { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) };
        const c2 = { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) };
        cur.push({ from, c1, c2, to });
      } else if (c.type === 'Z') {
        closeContour();
      }
    }
    closeContour();

    // 2) Convertir en modèle nœuds.
    // Pour chaque contour fermé, on construit une liste de nœuds. Chaque
    // nœud = point de jonction entre deux segments. Les poignées sortantes
    // et entrantes sont conservées.
    const result = [];
    for (const c of contours) {
      if (!c.segments.length) continue;
      if (!c.closed) {
        // Contour ouvert : traiter chaque segment en ligne/courbe isolée.
        // (rare dans les polices) → on garde des nœuds successifs.
        const nodes = [];
        for (const s of c.segments) {
          if (nodes.length === 0) nodes.push({ x: s.from.x, y: s.from.y, type: 'corner', in: null, out: null });
          const prev = nodes[nodes.length - 1];
          if (s.c1 || s.c2) {
            prev.out = { x: s.c1.x, y: s.c1.y };
            nodes.push({ x: s.to.x, y: s.to.y, type: 'corner', in: { x: s.c2.x, y: s.c2.y }, out: null });
          } else {
            prev.out = null;
            nodes.push({ x: s.to.x, y: s.to.y, type: 'corner', in: null, out: null });
          }
        }
        if (nodes.length) result.push({ closed: false, nodes });
        continue;
      }
      // Contour fermé : reconstruire les jonctions entre segments successifs.
      const segs = c.segments;
      const nodes = [];
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const next = segs[(i + 1) % segs.length];
        // Point = s.to (== next.from)
        const pt = { x: s.to.x, y: s.to.y };
        const hasIn = !!s.c2;
        const hasOut = !!next.c1;
        const inCtrl = hasIn ? { x: s.c2.x, y: s.c2.y } : null;
        const outCtrl = hasOut ? { x: next.c1.x, y: next.c1.y } : null;
        // Type estimé : si poignées in/out alignées → lisse.
        let type = 'corner';
        if (inCtrl && outCtrl) {
          const dx1 = pt.x - inCtrl.x, dy1 = pt.y - inCtrl.y;   // direction entrante
          const dx2 = outCtrl.x - pt.x, dy2 = outCtrl.y - pt.y; // direction sortante
          const cross = dx1 * dy2 - dy1 * dx2;
          if (Math.abs(cross) < 0.01) {
            const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
            type = (l1 > 0 && l2 > 0 && Math.abs(l1 - l2) < Math.max(1, l1 * 0.02)) ? 'symmetric' : 'smooth';
          }
        } else if (inCtrl || outCtrl) {
          type = 'smooth';
        }
        nodes.push({ x: pt.x, y: pt.y, type, in: inCtrl, out: outCtrl });
      }
      if (nodes.length) result.push({ closed: true, nodes });
    }
    return result;
  }

  function lastEnd(segs) {
    const l = segs[segs.length - 1];
    return l ? (l.to || l.end) : null;
  }

  function glyphToEditable(opGlyph) {
    let path = null;
    try {
      path = opGlyph.getPath(0, 0, ST.upem); // Y↓
    } catch (e) { path = null; }
    let contours = [];
    if (path && path.commands && path.commands.length) {
      const cmds = path.commands.map(c => Object.assign({}, c, { y: -c.y, y1: c.y1 != null ? -c.y1 : null, y2: c.y2 != null ? -c.y2 : null }));
      contours = commandsToContours(cmds);
    }
    // Ajouter attributs géométriques pour faciliter l'édition
    return {
      name: opGlyph.name || 'glyph',
      unicode: opGlyph.unicode,
      advanceWidth: opGlyph.advanceWidth,
      contours
    };
  }

  function loadFontFromBuffer(buf, fileName) {
    const font = ST.opentype.parse(buf);
    if (!font || !font.glyphs) throw new Error('Police illisible.');
    ST.font = font;
    ST.fileName = fileName || 'police';
    ST.upem = font.unitsPerEm || 1000;
    ST.ascender = font.ascender || 800;
    ST.descender = font.descender || -200;
    try { ST.capHeight = (font.tables && font.tables.os2 && font.tables.os2.sCapHeight) || 700; } catch (e) { ST.capHeight = 700; }
    try { ST.xHeight = (font.tables && font.tables.os2 && font.tables.os2.sxHeight) || 500; } catch (e) { ST.xHeight = 500; }
    // Nom
    try { ST.fontName = font.getEnglishName('fullName') || font.getEnglishName('fontFamily') || fileName.replace(/\.[^.]+$/, ''); }
    catch (e) { ST.fontName = fileName.replace(/\.[^.]+$/, ''); }

    // Décomposer TOUS les glyphes.
    const glyphs = [];
    const seen = new Set();
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = font.glyphs.get(i);
      if (!g) continue;
      let ch = '';
      if (typeof g.unicode === 'number') ch = String.fromCodePoint(g.unicode);
      // éviter doublons d'unicodes vides
      if (!ch) {
        // glyphe nommé sans unicode (ligatures, etc.) — on le garde avec nom
        glyphs.push(Object.assign(glyphToEditable(g), { id: i, char: '', hasUnicode: false }));
      } else {
        if (seen.has(ch)) continue; // dédoublonnage (ex .notdef/cmap multiple)
        seen.add(ch);
        glyphs.push(Object.assign(glyphToEditable(g), { id: i, char: ch, hasUnicode: true }));
      }
    }
    ST.glyphs = glyphs;
    ST.dirty = false;
    ST.originalBuffer = buf;
    return glyphs;
  }

  /* ────────────────────────── GRILLE ────────────────────────── */
  function defaultSample() {
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 .,;:!?\'"&@#()[]{}«»€$£%+-*/=<>°§¶_~^°';
  }

  function renderGlyphToCanvas(canvas, glyph, opts) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.width / dpr;
    const h = canvas.clientHeight || canvas.height / dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const isOutline = opts && opts.outline;
    // Échelle pour tenir dans w×h en préservant les proportions (advance).
    const pad = 4;
    const upem = ST.upem;
    const bounds = glyphBounds(glyph) || { xMin: 0, xMax: (glyph.advanceWidth || upem), yMin: ST.descender, yMax: ST.ascender };
    let bw = Math.max(1, bounds.xMax - bounds.xMin);
    let bh = Math.max(1, bounds.yMax - bounds.yMin);
    const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 10);
    const cx = (bounds.xMin + bounds.xMax) / 2;
    const cy = (bounds.yMin + bounds.yMax) / 2;
    // centre sur canvas, Y↑ → écran
    ctx.translate(w / 2 - cx * scale, h / 2 + cy * scale);
    ctx.scale(scale, -scale);

    if (!isOutline) {
      drawContoursFill(ctx, glyph.contours);
    } else {
      drawContoursStroke(ctx, glyph.contours, Math.max(1.5, 60 / scale));
    }
  }

  function glyphBounds(glyph) {
    let xMin = 1e9, xMax = -1e9, yMin = 1e9, yMax = -1e9;
    let any = false;
    for (const c of glyph.contours) {
      for (const n of c.nodes) {
        any = true;
        if (n.x < xMin) xMin = n.x; if (n.x > xMax) xMax = n.x;
        if (n.y < yMin) yMin = n.y; if (n.y > yMax) yMax = n.y;
        if (n.in) { if (n.in.x < xMin) xMin = n.in.x; if (n.in.x > xMax) xMax = n.in.x; if (n.in.y < yMin) yMin = n.in.y; if (n.in.y > yMax) yMax = n.in.y; }
        if (n.out) { if (n.out.x < xMin) xMin = n.out.x; if (n.out.x > xMax) xMax = n.out.x; if (n.out.y < yMin) yMin = n.out.y; if (n.out.y > yMax) yMax = n.out.y; }
      }
    }
    if (!any) return null;
    return { xMin, xMax, yMin, yMax };
  }

  function traceContourPath(ctx, c) {
    if (!c.nodes.length) return;
    const n0 = c.nodes[0];
    ctx.moveTo(n0.x, n0.y);
    const L = c.closed ? c.nodes.length : c.nodes.length - 1;
    for (let i = 0; i < c.nodes.length; i++) {
      const n = c.nodes[i];
      const next = c.nodes[(i + 1) % c.nodes.length];
      const toX = (c.closed || i < c.nodes.length - 1) ? next.x : n.x;
      const toY = (c.closed || i < c.nodes.length - 1) ? next.y : n.y;
      if (n.out && next.in) {
        ctx.bezierCurveTo(n.out.x, n.out.y, next.in.x, next.in.y, next.x, next.y);
      } else if (n.out) {
        ctx.quadraticCurveTo(n.out.x, n.out.y, next.x, next.y);
      } else if (next.in) {
        ctx.quadraticCurveTo(next.in.x, next.in.y, next.x, next.y);
      } else if (c.closed || i < c.nodes.length - 1) {
        ctx.lineTo(next.x, next.y);
      }
    }
    if (c.closed) ctx.closePath();
  }

  function inkColor() {
    return document.body.classList.contains('theme-dark') ? '#e8e8e8' : '#1a1a1a';
  }

  function drawContoursFill(ctx, contours) {
    ctx.beginPath();
    for (const c of contours) traceContourPath(ctx, c);
    ctx.fillStyle = inkColor();
    ctx.fill('evenodd');
  }

  function drawContoursStroke(ctx, contours, lw) {
    ctx.lineWidth = lw;
    for (const c of contours) {
      ctx.beginPath();
      traceContourPath(ctx, c);
      ctx.strokeStyle = inkColor();
      ctx.stroke();
    }
  }

  function buildGlyphGrid() {
    const grid = $('glyphGrid');
    grid.innerHTML = '';
    // Déterminer les caractères à montrer
    let chars = [];
    if (ST.showEmpty) {
      chars = ST.glyphs.filter(g => g.hasUnicode).map(g => g.char);
    } else {
      const src = ST.sampleChars || defaultSample();
      for (const ch of src) if (!chars.includes(ch)) chars.push(ch);
    }
    if (ST.search) {
      const q = ST.search.toLowerCase();
      chars = chars.filter(ch => {
        const g = ST.glyphs.find(x => x.char === ch);
        return ch.toLowerCase().includes(q) || (g && g.name && g.name.toLowerCase().includes(q));
      });
    }
    let count = 0;
    for (const ch of chars) {
      const g = ST.glyphs.find(x => x.char === ch);
      if (!g) continue;
      const cell = el('div', 'glyph-cell' + (g.dirty ? ' dirty' : ''));
      const cv = el('canvas', 'gcanvas');
      cell.appendChild(cv);
      const label = el('div', 'glabel');
      const gc = el('span', 'gc', ch === ' ' ? '␣' : ch);
      const gn = el('span', 'gn', g.name || '');
      label.appendChild(gc); label.appendChild(gn);
      cell.appendChild(label);
      cell.title = (g.name || ch) + ' — ' + (g.contours ? g.contours.length : 0) + ' ' + ((g.contours && g.contours.length > 1) ? t('contourPlur') : t('contourSing'));
      cell.addEventListener('click', () => openEditor(ch));
      grid.appendChild(cell);
      // rendu après insertion (dimensions connues)
      requestAnimationFrame(() => {
        if (!cv.clientWidth || !cv.clientHeight) return;
        renderGlyphToCanvas(cv, g, { outline: ST.gridMode === 'outline' });
      });
      count++;
    }
    if (!count) grid.appendChild(el('div', 'empty-hint', t('gridEmpty')));
    $('gridSub').textContent = count + ' ' + (count > 1 ? t('gridGlyphPlur') : t('gridGlyphSing')) + ' · ' + ST.glyphs.length + ' ' + t('gridTotalText');
  }

  /* ────────────────────────── ÉDITEUR ────────────────────────── */
  // Transform canvas : pixels ↔ unités
  const ED = {
    ctx: null, canvas: null, dpr: 1,
    scale: 1,        // px par unité
    ox: 0, oy: 0,    // offset en unités (centre)
    drag: null,
    hover: null,
    activeContour: -1,
  };

  function editorToUnits(pxX, pxY) {
    // pxX/pyY sont des coordonnées viewport (CSS px). Le canvas est mis à
    // l'échelle par ED.dpr via setTransform, donc on raisonne en CSS px :
    //   unitX = (cssX - centreX) / scale + ox
    const r = ED.canvas.getBoundingClientRect();
    const cssX = pxX - r.left;
    const cssY = pxY - r.top;
    const centreX = ED.canvas.clientWidth / 2;
    const centreY = ED.canvas.clientHeight / 2;
    return {
      x: (cssX - centreX) / ED.scale + ED.ox,
      y: ED.oy - (cssY - centreY) / ED.scale
    };
  }

  function unitsToEditorPx(x, y) {
    const cx = ED.canvas.width / ED.dpr / 2;
    const cy = ED.canvas.height / ED.dpr / 2;
    return { x: cx + (x - ED.ox) * ED.scale, y: cy - (y - ED.oy) * ED.scale };
  }

  function editorSetTransform() {
    const cv = ED.canvas, ctx = ED.ctx;
    cv.width = Math.max(1, Math.round(cv.clientWidth * ED.dpr));
    cv.height = Math.max(1, Math.round(cv.clientHeight * ED.dpr));
    ctx.setTransform(ED.dpr, 0, 0, ED.dpr, 0, 0);
    ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
    ctx.save();
    ctx.translate(cv.clientWidth / 2, cv.clientHeight / 2);
    ctx.scale(ED.scale, -ED.scale);
    ctx.translate(-ED.ox, -ED.oy);
  }

  function editorRender() {
    if (!ST.editing || !ED.ctx) return;
    const cv = ED.canvas, ctx = ED.ctx;
    const glyph = ST.glyphs[ST.editGlyph];
    if (!glyph) return;
    editorSetTransform();
    const cw = cv.clientWidth, chh = cv.clientHeight;

    // Fond quadrillé (subtile)
    ctx.save();
    ctx.scale(1, 1);
    ctx.restore();

    // Grille (option)
    if ($('optGrid').checked) {
      drawEditorGrid(ctx, cw, chh);
    }
    // Repères (baseline, x-height, cap-height, ascender/descender) & avance
    if ($('optGuides').checked) {
      drawEditorGuides(ctx);
    }

    // Remplissage
    drawContoursFill(ctx, glyph.contours);

    // Sur-lignage des contours actifs & nœuds (mode sélection/plume)
    if (ST.tool !== 'pen' || ST.sel) {
      drawEditorHandles(ctx, glyph);
    }

    ctx.restore();
    // HUD coords
    updateHud();
  }

  function drawEditorGrid(ctx, cw, chh) {
    // grille en unités (pas = upem/20)
    const step = ST.upem / 10;
    const x0 = Math.floor((ED.ox - cw / 2 / ED.scale) / step) * step;
    const x1 = ED.ox + cw / 2 / ED.scale;
    const y0 = Math.floor((ED.oy - chh / 2 / ED.scale) / step) * step;
    const y1 = ED.oy + chh / 2 / ED.scale;
    ctx.save();
    ctx.lineWidth = 1 / ED.scale;
    ctx.strokeStyle = 'rgba(127,127,127,0.12)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.restore();
  }

  function drawEditorGuides(ctx) {
    const drawLine = (y, color, label) => {
      ctx.save();
      ctx.lineWidth = 1 / ED.scale;
      ctx.setLineDash([6 / ED.scale, 4 / ED.scale]);
      ctx.strokeStyle = color;
      ctx.beginPath();
      const x0 = ED.ox - 4000 / ED.scale, x1 = ED.ox + 4000 / ED.scale;
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    };
    const dark = document.body.classList.contains('theme-dark');
    drawLine(0, dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)', 'baseline');  // baseline
    drawLine(ST.xHeight, '#3b82f6', 'x-height');            // x-height
    drawLine(ST.capHeight, '#ef4444', 'cap-height');        // cap-height
    drawLine(ST.ascender, '#3b82f6', 'ascender');
    drawLine(ST.descender, '#ef4444', 'descender');
    // Limite droite (advance)
    const g = ST.glyphs[ST.editGlyph];
    if (g) {
      ctx.save();
      ctx.lineWidth = 1 / ED.scale;
      ctx.setLineDash([6 / ED.scale, 4 / ED.scale]);
      ctx.strokeStyle = 'rgba(200,50,200,0.4)';
      ctx.beginPath();
      const y0 = ST.descender - 200, y1 = ST.ascender + 200;
      ctx.moveTo(g.advanceWidth, y0); ctx.lineTo(g.advanceWidth, y1);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  function drawEditorHandles(ctx, glyph) {
    const r0 = 4 / ED.scale;
    for (let ci = 0; ci < glyph.contours.length; ci++) {
      const c = glyph.contours[ci];
      const active = (ST.sel && ST.sel.ci === ci);
      for (let ni = 0; ni < c.nodes.length; ni++) {
        const n = c.nodes[ni];
        const isSel = active && ST.sel.ni === ni;
        // poignées
        if (n.in) drawHandleLine(ctx, n, n.in, false);
        if (n.out) drawHandleLine(ctx, n, n.out, true);
        // nœud
        ctx.beginPath();
        ctx.arc(n.x, n.y, isSel ? r0 * 1.5 : r0, 0, Math.PI * 2);
        ctx.fillStyle = n.type === 'corner' ? '#fff' : '#fff';
        ctx.strokeStyle = isSel ? '#ffb000' : (active ? '#1a1a1a' : '#666');
        ctx.lineWidth = 1.5 / ED.scale;
        ctx.fill(); ctx.stroke();
        if (n.type !== 'corner') {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r0 * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = active ? '#ffb000' : '#888';
          ctx.fill();
        }
      }
    }
  }

  function drawHandleLine(ctx, n, h, isOut) {
    ctx.save();
    ctx.lineWidth = 1 / ED.scale;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(n.x, n.y); ctx.lineTo(h.x, h.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h.x, h.y, 3 / ED.scale, 0, Math.PI * 2);
    ctx.fillStyle = isOut ? '#ffb000' : '#2f6fdd';
    ctx.fill();
    ctx.restore();
  }

  function updateHud() {
    $('hudTool').textContent = { select: t('toolSelect'), pen: t('toolPen'), node: t('toolNode'), shape: t('toolShape'), delete: t('toolDelete') }[ST.tool] || ST.tool;
    $('edZoomPct').textContent = Math.round(ED.scale / (ST.upem / 1000) * 100 * 2) / 2 + '%';
  }

  // Hit testing
  function findNodeAt(px, py) {
    const g = ST.glyphs[ST.editGlyph];
    if (!g) return null;
    const u = editorToUnits(px, py);
    const tol = 10 / ED.scale;
    for (let ci = 0; ci < g.contours.length; ci++) {
      const c = g.contours[ci];
      for (let ni = 0; ni < c.nodes.length; ni++) {
        const n = c.nodes[ni];
        // Poignées d'abord (si le contour est sélectionné ou nœud proche)
        if (n.in && Math.abs(n.in.x - u.x) < tol && Math.abs(n.in.y - u.y) < tol) return { kind: 'in', ci, ni };
        if (n.out && Math.abs(n.out.x - u.x) < tol && Math.abs(n.out.y - u.y) < tol) return { kind: 'out', ci, ni };
      }
    }
    for (let ci = 0; ci < g.contours.length; ci++) {
      const c = g.contours[ci];
      for (let ni = 0; ni < c.nodes.length; ni++) {
        const n = c.nodes[ni];
        if (Math.abs(n.x - u.x) < tol && Math.abs(n.y - u.y) < tol) return { kind: 'node', ci, ni };
      }
    }
    return null;
  }

  function hitContour(px, py) {
    // renvoie l'index du contour le plus proche (pour ajout point)
    const g = ST.glyphs[ST.editGlyph];
    if (!g) return -1;
    const u = editorToUnits(px, py);
    let best = -1, bestD = 1e9;
    for (let ci = 0; ci < g.contours.length; ci++) {
      const c = g.contours[ci];
      for (let i = 0; i < c.nodes.length; i++) {
        const n = c.nodes[i];
        const next = c.nodes[(i + 1) % c.nodes.length];
        const d = pointSegDist(u.x, u.y, n, next);
        if (d < bestD) { bestD = d; best = ci; }
      }
    }
    return bestD < 12 / ED.scale ? best : -1;
  }

  function pointSegDist(px, py, a, b) {
    // distance point → courbe (approx segment droit)
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  /* Outils éditeur */
  function editorSetTool(t) {
    ST.tool = t;
    document.querySelectorAll('#toolGroup .tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    // désactiver delete qui n'est pas un mode persistant
    if (t === 'delete') { ST.tool = 'select'; }
    editorRender();
  }

  function editorSetSel(ci, ni, kind) {
    if (ci == null) { ST.sel = null; }
    else if (ni == null) { ST.sel = { ci, ni: null }; }
    else { ST.sel = { ci, ni, kind: kind || 'node' }; }
    updateSidePanel();
    editorRender();
  }

  /* Undo/redo */
  function snapshotGlyph(glyph) {
    // Inclut name : permet d'annuler/refaire un renommage de glyphe.
    return JSON.stringify({ name: glyph.name, contours: glyph.contours, advanceWidth: glyph.advanceWidth });
  }
  function pushUndo(glyph) {
    ST.undoStack.push(snapshotGlyph(glyph));
    if (ST.undoStack.length > 60) ST.undoStack.shift();
    ST.redoStack = [];
    markDirty();
  }
  function undo() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g || !ST.undoStack.length) return;
    ST.redoStack.push(snapshotGlyph(g));
    const snap = ST.undoStack.pop();
    applySnap(g, snap);
    markDirty();
    updateSidePanel();
    editorRender();
  }
  function redo() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g || !ST.redoStack.length) return;
    ST.undoStack.push(snapshotGlyph(g));
    const snap = ST.redoStack.pop();
    applySnap(g, snap);
    markDirty();
    updateSidePanel();
    editorRender();
  }
  function applySnap(g, snap) {
    const d = JSON.parse(snap);
    if (d.name != null) g.name = d.name;   // rétro-compatible (snapshots anciens sans name)
    g.contours = d.contours; g.advanceWidth = d.advanceWidth;
  }
  function markDirty() {
    const g = ST.glyphs[ST.editGlyph];
    if (g) { g.dirty = true; ST.dirty = true; }
    $('modifiedChip').style.display = ST.dirty ? 'inline-flex' : 'none';
    scheduleAutoSave();
  }

  /* ────────────────────────── AUTOSAVE (.sf local) ──────────────────────────
     Le projet courant (superfont) est sauvegardé automatiquement et de façon
     différée (debounce) dans IndexedDB (clé 'supertypo_autosave').
     Au démarrage, s'il existe un autosave récent, on propose de le restaurer. */
  const AUTO_KEY = 'supertypo_autosave';
  let _autoTimer = null;
  let _autoInFlight = false;

  function buildSfObject() {
    return {
      sf: 'superfont',
      version: '1.0',
      savedAt: new Date().toISOString(),
      meta: { name: ST.fontName, file: ST.fileName, tool: 'SuperTyPo' },
      font: {
        unitsPerEm: ST.upem, ascender: ST.ascender, descender: ST.descender,
        capHeight: ST.capHeight, xHeight: ST.xHeight
      },
      glyphs: ST.glyphs.map(g => ({
        name: g.name, unicode: g.unicode, char: g.char, advanceWidth: g.advanceWidth,
        contours: g.contours, dirty: !!g.dirty
      }))
    };
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB indisponible'));
      const req = window.indexedDB.open('supertypo', 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, val) {
    try {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => { try { db.close(); } catch (e) {} resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { console.warn('[SuperTyPo] autosave idb:', e); }
  }
  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const rq = tx.objectStore('kv').get(key);
        rq.onsuccess = () => { try { db.close(); } catch (e) {} resolve(rq.result); };
        rq.onerror = () => reject(rq.error);
      });
    } catch (e) { return null; }
  }
  async function idbDel(key) {
    try {
      const db = await idbOpen();
      return new Promise((resolve) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = () => { try { db.close(); } catch (e) {} resolve(); };
        tx.onerror = () => resolve();
      });
    } catch (e) {}
  }

  function scheduleAutoSave() {
    if (!ST.glyphs.length) return;
    if (_autoTimer) clearTimeout(_autoTimer);
    _autoTimer = setTimeout(runAutoSave, 1200);
  }
  async function runAutoSave() {
    if (_autoInFlight) return;
    _autoInFlight = true;
    try {
      const sf = buildSfObject();
      sf.kind = 'autosave';
      await idbSet(AUTO_KEY, sf);
    } catch (e) { console.warn('[SuperTyPo] autosave:', e); }
    _autoInFlight = false;
  }
  async function restoreAutoSave() {
    try {
      const sf = await idbGet(AUTO_KEY);
      if (!sf || sf.sf !== 'superfont') return null;
      // Ne restaurer que si un travail récent existe (< 30 jours)
      const age = Date.now() - new Date(sf.savedAt || 0).getTime();
      if (age > 30 * 24 * 3600 * 1000) return null;
      return sf;
    } catch (e) { return null; }
  }
  function clearAutoSave() { idbDel(AUTO_KEY); }

  // Applique un objet superfont dans l'état (sans recharger un buffer police)
  function applySfObject(sf, sourceName) {
    ST.fontName = (sf.meta && sf.meta.name) || sourceName || 'police';
    ST.fileName = (sf.meta && sf.meta.file) || '';
    ST.upem = (sf.font && sf.font.unitsPerEm) || 1000;
    ST.ascender = (sf.font && sf.font.ascender) || 800;
    ST.descender = (sf.font && sf.font.descender) || -200;
    ST.capHeight = (sf.font && sf.font.capHeight) || 700;
    ST.xHeight = (sf.font && sf.font.xHeight) || 500;
    ST.glyphs = sf.glyphs.map((g, i) => ({
      id: i, name: g.name, unicode: g.unicode, char: g.char || '',
      advanceWidth: g.advanceWidth, contours: g.contours || [],
      hasUnicode: g.char != null && g.char !== '', dirty: !!g.dirty
    }));
    ST.font = null;
    ST.dirty = sf.glyphs.some(g => g.dirty);
    ST.originalBuffer = null;
    $('modifiedChip').style.display = ST.dirty ? 'inline-flex' : 'none';
  }

  /* ── Gestion du panneau latéral ── */
  // Métriques avancées : nom, débordements gauche/droite (LSB/RSB), bbox, points.
  function updateMetricsPanel() {
    const g = ST.glyphs[ST.editGlyph];
    const nameEl = $('mGlyphName');
    const lsbEl = $('mLSB');
    const rsbEl = $('mRSB');
    const bboxEl = $('mBBox');
    const ptsEl = $('mPoints');
    if (!g) return;
    if (nameEl && document.activeElement !== nameEl) nameEl.value = g.name || '';
    const b = glyphBounds(g);
    if (b) {
      const lsb = Math.round(b.xMin * 10) / 10;
      const rsb = Math.round((g.advanceWidth - b.xMax) * 10) / 10;
      if (lsbEl) lsbEl.textContent = lsb;
      if (rsbEl) rsbEl.textContent = rsb;
      if (bboxEl) bboxEl.textContent = Math.round(b.xMin) + '…' + Math.round(b.xMax) + ' × ' + Math.round(b.yMin) + '…' + Math.round(b.yMax);
    } else {
      if (lsbEl) lsbEl.textContent = '—';
      if (rsbEl) rsbEl.textContent = '—';
      if (bboxEl) bboxEl.textContent = '—';
    }
    if (ptsEl) {
      let n = 0, closed = 0;
      (g.contours || []).forEach(c => { n += c.nodes.length; if (c.closed) closed++; });
      ptsEl.textContent = n + ' (' + closed + ' fermés)';
    }
  }

  // Bind du panneau métriques (nom du glyphe + éventuels réglages).
  function bindMetricsPanel() {
    const nameEl = $('mGlyphName');
    if (nameEl) nameEl.addEventListener('change', () => {
      const g = ST.glyphs[ST.editGlyph];
      if (!g) return;
      const v = nameEl.value.trim().replace(/\s+/g, ' ');
      if (v && v !== g.name) {
        pushUndo(g);
        g.name = v;
        markDirty();
        // Mettre à jour la meta de la topbar éditeur + grille.
        const meta = $('edGlyphMeta');
        if (meta) {
          const u = g.unicode != null ? 'U+' + g.unicode.toString(16).toUpperCase().padStart(4, '0') + ' · ' : '';
          meta.textContent = u + 'AV ' + Math.round(g.advanceWidth) + ' · ' + (g.contours ? g.contours.length : 0) + ' contour(s)';
        }
        updateSidePanel();
      }
    });
  }

  function updateSidePanel() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g) return;
    const av = Math.round(g.advanceWidth);
    $('spAdvance').value = av;
    const avEl = $('mAdvanceVal');
    if (avEl) avEl.textContent = av;
    // node
    const ns = $('nodeSection');
    if (ST.sel && ST.sel.ni != null) {
      const c = g.contours[ST.sel.ci], n = c.nodes[ST.sel.ni];
      if (n) {
        ns.style.display = 'block';
        $('spNodeX').value = Math.round(n.x * 10) / 10;
        $('spNodeY').value = Math.round(n.y * 10) / 10;
        $('spNodeType').value = n.type;
        if (ST.sel.kind === 'node') {
          $('spX').value = Math.round(n.x * 10) / 10;
          $('spY').value = Math.round(n.y * 10) / 10;
          $('spPos').textContent = Math.round(n.x) + ', ' + Math.round(n.y);
        } else {
          $('spPos').textContent = ST.sel.kind === 'in' ? t('handleIn') : t('handleOut');
        }
      }
    } else {
      ns.style.display = 'none';
      $('spPos').textContent = '—';
    }
    renderContourList();
    updateMetricsPanel();
  }

  function renderContourList() {
    const g = ST.glyphs[ST.editGlyph];
    const list = $('contourList');
    list.innerHTML = '';
    if (!g) return;
    g.contours.forEach((c, ci) => {
      const item = el('div', 'contour-item' + (ST.sel && ST.sel.ci === ci ? ' active' : ''));
      const badge = el('span', 'ci-badge', String(ci + 1));
      badge.style.background = ['#1a1a1a', '#2f6fdd', '#e5484d', '#c832c8', '#1d8a4a', '#d97706'][ci % 6];
      const name = el('span', 'ci-n', c.closed ? tf('contourClosed', { n: c.nodes.length }) : tf('contourOpen', { n: c.nodes.length }));
      const ab = boolContourBtn(ci);   // bouton A/B pour les booléens
      const del = el('button', 'ci-del', '✕');
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteContour(ci); });
      item.appendChild(badge); item.appendChild(name); item.appendChild(ab); item.appendChild(del);
      item.addEventListener('click', () => { ST.sel = { ci, ni: null }; updateSidePanel(); editorRender(); });
      list.appendChild(item);
    });
    updateBoolStatus();
  }

  function deleteContour(ci) {
    const g = ST.glyphs[ST.editGlyph];
    if (!g) return;
    pushUndo(g);
    g.contours.splice(ci, 1);
    if (ST.sel && ST.sel.ci === ci) ST.sel = null;
    else if (ST.sel && ST.sel.ci > ci) ST.sel.ci--;
    ST.boolSel = { a: null, b: null };
    updateSidePanel(); editorRender();
  }

  /* ───────────────────────── BOOLÉENS (v1) ─────────────────────────
     Opérations « Pathfinder » simplifiées, en combinant les tracés et en
     jouant sur le winding : le rendu du glyphe utilise déjà ctx.fill() en
     mode 'evenodd' (voir drawContoursFill), donc un contour dont le sens
     est inversé devient un « trou » quand il est imbriqué dans un autre.

     - Union       : tous les contours du glyphe dans une même liste (déjà
                     remplis en evenodd). On matérialise juste l'opération.
     - Soustraction: garde A + retourne le winding de B (B devient un trou).
     - Intersection: ne garde que la partie de A couverte par B → en v1, si
                     B est entièrement dans A, A ∩ B ≈ B (on garde B seul).
     Limites v1 (documentées) : pas d'intersection de segments / pas de
     recouvrement partiel ; pour la soustraction/intersection B doit être
     entièrement contenu dans A, sinon on prévient via un toast.

     Le booléen se fait sur les contours A et B sélectionnés via le panneau
     (boutons « A » et « B » à droite de chaque ligne de contour).        */

  // Test point-dans-polygone (winding) : vrai si (px,py) est dans le contour.
  function pointInContour(c, px, py) {
    if (!c || !c.nodes.length) return false;
    let inside = false;
    for (let i = 0, j = c.nodes.length - 1; i < c.nodes.length; j = i++) {
      const a = c.nodes[i], b = c.nodes[j];
      const intersect = ((a.y > py) !== (b.y > py)) &&
        (px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  // Vrai si le contour test est entièrement dans ref (tous ses nœuds dedans).
  function contourInside(ref, test) {
    for (const n of test.nodes) if (!pointInContour(ref, n.x, n.y)) return false;
    return true;
  }
  // Inversion du sens : renverse l'ordre des nœuds et échange in/out de chacun.
  function reverseContourWinding(c) {
    const nodes = c.nodes.map((n) => {
      const nn = { x: n.x, y: n.y, type: n.type, in: n.out, out: n.in };
      return nn;
    }).reverse();
    // Les attributs des nœuds restent bien in/out (échange précédent) ;
    // après reverse, chaque nœud garde sa géométrie, seul l'ordre change.
    return { closed: c.closed, nodes };
  }
  // Petit clone profond d'un contour (sans référence partagée).
  function cloneContour(c) {
    return { closed: c.closed, nodes: c.nodes.map(n => ({
      x: n.x, y: n.y, type: n.type,
      in: n.in ? { x: n.in.x, y: n.in.y } : null,
      out: n.out ? { x: n.out.x, y: n.out.y } : null
    })) };
  }

  // Ajoute/supprime les boutons A/B sur chaque ligne de contour.
  function updateBoolStatus() {
    const st = $('boolStatus');
    if (!st) return;
    const { a, b } = ST.boolSel;
    let msg = t('boolNeedTwo');
    if (a != null && b != null) msg = tf('boolStatusBoth', { x: a + 1, y: b + 1 });
    else if (a != null) msg = tf('boolStatusA', { x: a + 1 });
    st.textContent = msg;
  }
  function boolContourBtn(ci) {
    const btn = el('button', 'ci-ab ' + (ST.boolSel.a === ci ? 'a' : (ST.boolSel.b === ci ? 'b' : '')), ci === ST.boolSel.a ? 'A' : (ci === ST.boolSel.b ? 'B' : 'AB'));
    btn.title = 'A/B';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ST.boolSel.a == null) ST.boolSel.a = ci;
      else if (ST.boolSel.a === ci) ST.boolSel.a = null;
      else if (ST.boolSel.b == null || ST.boolSel.b === ci) {
        // b null → prendre ci ; b === ci → retirer
        if (ST.boolSel.b === ci) ST.boolSel.b = null;
        else ST.boolSel.b = ci;
      }
      updateSidePanel(); editorRender();
    });
    return btn;
  }

  // Cœur : applique l'opération demandée sur les contours a et b.
  // op = 'union' | 'subtract' | 'intersect'
  function boolOperate(a, b, op) {
    const g = ST.glyphs[ST.editGlyph];
    if (!g) return;
    if (a == null || b == null || a === b || a < 0 || b < 0 || a >= g.contours.length || b >= g.contours.length) {
      toast(t('boolNeedTwo'), true);
      return;
    }
    const ca = g.contours[a], cb = g.contours[b];
    if (!ca || !cb) return;
    if (op === 'union') {
      // Union = garder A + ajouter B tel quel (evenodd fusionne les formes).
      pushUndo(g);
      g.contours[a] = cloneContour(ca);
      // B est recréé à part : on le déplace après A dans la liste.
      const bClone = cloneContour(cb);
      g.contours.splice(b, 1);
      // Recalculer l'index de a (si b < a, a a reculé).
      let ai = a < b ? a : a - 1;
      g.contours.splice(ai + 1, 0, bClone);
      // Sélection simple : rien de spécial à faire, contourList se re-rend.
      ST.sel = null;
    } else if (op === 'subtract') {
      // Soustraction : garder A, faire de B un trou (winding inversé).
      if (!contourInside(ca, cb)) { toast(t('boolNoContain'), true); return; }
      pushUndo(g);
      const bHole = reverseContourWinding(cloneContour(cb));
      g.contours[a] = cloneContour(ca);
      g.contours[b] = bHole;
      ST.sel = null;
    } else if (op === 'intersect') {
      // Intersection v1 : si B ⊂ A, A ∩ B ≈ B (on garde le contour B).
      if (!contourInside(ca, cb)) { toast(t('boolNoContain'), true); return; }
      pushUndo(g);
      g.contours[a] = cloneContour(cb);
      g.contours.splice(b, 1);
      ST.sel = null;
    }
    ST.boolSel = { a: null, b: null };
    updateSidePanel(); editorRender();
  }

  // API publique : union / soustraction / intersection.
  function boolUnion() { boolOperate(ST.boolSel.a, ST.boolSel.b, 'union'); }
  function boolSubtract() { boolOperate(ST.boolSel.a, ST.boolSel.b, 'subtract'); }
  function boolIntersect() { boolOperate(ST.boolSel.a, ST.boolSel.b, 'intersect'); }
  function resetBoolSel() { ST.boolSel = { a: null, b: null }; }

  /* ── Transformations géométriques (symétrie / rotation / sens) ── */
  // Cible : le contour sélectionné (ST.sel.ci) si présent, sinon tout le glyphe.
  function transformTargetContours(g) {
    if (ST.sel && ST.sel.ci != null && g.contours[ST.sel.ci]) return [ST.sel.ci];
    return g.contours.map((_, i) => i);
  }
  // Miroir horizontal : x' = 2*axisX - x (poignées comprises). Par défaut l'axe
  // passe par le centre du glyphe (bbox) — axisX = (xMin+xMax)/2.
  function mirrorH() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g || !g.contours.length) return;
    const b = glyphBounds(g);
    const axisX = b ? (b.xMin + b.xMax) / 2 : g.advanceWidth / 2;
    pushUndo(g);
    transformTargetContours(g).forEach(ci => {
      g.contours[ci].nodes.forEach(n => {
        n.x = 2 * axisX - n.x;
        if (n.in) n.in.x = 2 * axisX - n.in.x;
        if (n.out) n.out.x = 2 * axisX - n.out.x;
      });
    });
    markDirty();
    ST.sel = null;
    updateSidePanel(); editorRender();
  }
  // Miroir vertical : y' = 2*axisY - y. Par défaut l'axe est la baseline (y=0).
  function mirrorV() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g || !g.contours.length) return;
    pushUndo(g);
    transformTargetContours(g).forEach(ci => {
      g.contours[ci].nodes.forEach(n => {
        n.y = -n.y;
        if (n.in) n.in.y = -n.in.y;
        if (n.out) n.out.y = -n.out.y;
      });
    });
    markDirty();
    ST.sel = null;
    updateSidePanel(); editorRender();
  }
  // Rotation 90° (sens trigonométrique, autour de l'origine em — en unités Y↑).
  // x' = -y ; y' = x  (rotation +90°). Les poignées suivent la même rotation.
  function rotate90() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g || !g.contours.length) return;
    pushUndo(g);
    transformTargetContours(g).forEach(ci => {
      g.contours[ci].nodes.forEach(n => {
        const ox = n.x, oy = n.y;
        n.x = -oy; n.y = ox;
        if (n.in) { const ix = n.in.x, iy = n.in.y; n.in.x = -iy; n.in.y = ix; }
        if (n.out) { const ux = n.out.x, uy = n.out.y; n.out.x = -uy; n.out.y = ux; }
      });
    });
    markDirty();
    ST.sel = null;
    updateSidePanel(); editorRender();
  }
  // Inverser le sens du contour sélectionné (winding).
  function reverseSelectedContour() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g || ST.sel == null || ST.sel.ci == null || !g.contours[ST.sel.ci]) return;
    pushUndo(g);
    g.contours[ST.sel.ci] = reverseContourWinding(g.contours[ST.sel.ci]);
    markDirty();
    ST.sel = null;
    updateSidePanel(); editorRender();
  }

  /* ── Ouverture / fermeture ── */
  function openEditor(charOrGlyph) {
    let idx = -1;
    if (typeof charOrGlyph === 'number') idx = charOrGlyph;
    else idx = ST.glyphs.findIndex(g => g.char === charOrGlyph);
    if (idx < 0) return;
    ST.editGlyph = idx;
    ST.editing = true;
    ST.undoStack = []; ST.redoStack = [];
    ST.sel = null;
    ST.boolSel = { a: null, b: null };
    $('editorOverlay').style.display = 'block';
    $('fontView').style.display = 'none';
    $('dropArea').style.display = 'none';
    const g = ST.glyphs[idx];
    $('edGlyphChar').textContent = g.char || '?';
    $('edGlyphName').textContent = g.name || g.char || t('glyphDefault');
    $('edGlyphMeta').textContent = (g.unicode != null ? 'U+' + g.unicode.toString(16).toUpperCase().padStart(4, '0') + ' · ' : '') + 'AV ' + Math.round(g.advanceWidth) + ' · ' + (g.contours ? g.contours.length : 0) + ' ' + ((g.contours && g.contours.length > 1) ? t('contourPlur') : t('contourSing'));
    ED._justOpened = true;
    initEditorCanvas();
    updateSidePanel();
    // Fit après que le layout soit stable (sinon le canvas n'a pas sa taille finale)
    setTimeout(editorFit, 40);
  }

  function closeEditor() {
    ST.editing = false;
    $('editorOverlay').style.display = 'none';
    $('fontView').style.display = 'flex';
    // reconstruire grille pour voir dirty
    buildGlyphGrid();
  }

  function initEditorCanvas() {
    ED.canvas = $('editorCanvas');
    ED.ctx = ED.canvas.getContext('2d');
    ED.dpr = window.devicePixelRatio || 1;
    ED.scale = (ST.upem / 1000) * 1.2;
    ED.ox = 0; ED.oy = ST.xHeight * 0.5;
    bindEditorEvents();
    // Re-rendu quand le canvas change de taille (fenêtre / panneau redimensionné)
    if (!ED._ro) {
      ED._ro = new ResizeObserver(() => {
        if (!ST.editing) return;
        // Premier resize juste après l'ouverture → ajuster au contenu.
        if (ED._justOpened) {
          ED._justOpened = false;
          editorFit();
          return;
        }
        // Sinon : conserver le centre & zoom actuels, re-rendre à la bonne taille
        requestAnimationFrame(editorRender);
      });
    }
    try { ED._ro.observe(ED.canvas); } catch (e) {}
    requestAnimationFrame(editorRender);
  }

  function editorFit() {
    const g = ST.glyphs[ST.editGlyph];
    const b = glyphBounds(g) || { xMin: 0, xMax: g.advanceWidth, yMin: ST.descender, yMax: ST.ascender };
    const cw = ED.canvas.clientWidth, chh = ED.canvas.clientHeight;
    const bw = Math.max(1, b.xMax - b.xMin), bh = Math.max(1, b.yMax - b.yMin);
    ED.scale = Math.min((cw - 60) / bw, (chh - 80) / bh);
    ED.scale = Math.max(0.02, Math.min(ED.scale, 8));
    ED.ox = (b.xMin + b.xMax) / 2;
    ED.oy = (b.yMin + b.yMax) / 2;
    editorRender();
  }

  function editorZoom(f) {
    // zoom autour du centre
    ED.scale = Math.max(0.01, Math.min(20, ED.scale * f));
    editorRender();
  }

  function editorZoomPct(pct) {
    // 100% = 1 unité = 1px * (upem/1000)?? Définition : 1em (upem) ≈ 100px à 100%
    ED.scale = (ST.upem / 1000) * (pct / 100);
    editorRender();
  }

  /* ── Événements éditeur ── */
  function bindEditorEvents() {
    const cv = ED.canvas;
    cv.onmousedown = (e) => editorMouseDown(e);
    cv.onmousemove = (e) => editorMouseMove(e);
    cv.onmouseup = (e) => editorMouseUp(e);
    cv.onwheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const f = e.deltaY < 0 ? 1.1 : 0.9;
        editorZoom(f);
      }
    };
    cv.onmouseleave = () => { ST.hover = null; };
  }

  function editorMouseDown(e) {
    const g = ST.glyphs[ST.editGlyph];
    if (!g) return;
    const px = e.clientX, py = e.clientY;
    const hit = findNodeAt(px, py);
    if (ST.tool === 'select') {
      if (hit && (hit.kind === 'node' || hit.kind === 'in' || hit.kind === 'out')) {
        ST.sel = { ci: hit.ci, ni: hit.ni, kind: hit.kind };
        // Snapshot undo AVANT toute modification (drag)
        pushUndo(g);
        updateSidePanel();
        ED.drag = { type: hit.kind, ci: hit.ci, ni: hit.ni, moved: false };
        editorRender();
      } else if (hit && hit.kind === 'contour') {
        ST.sel = { ci: hit.ci, ni: null };
        updateSidePanel(); editorRender();
      } else {
        ST.sel = null;
        updateSidePanel(); editorRender();
        ED.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: ED.ox, oy: ED.oy };
      }
      return;
    }
    if (ST.tool === 'pen') {
      const u = editorToUnits(px, py);
      // Trouver le « contour courant » : le dernier contour ouvert (plume en cours)
      let openCi = -1;
      for (let i = g.contours.length - 1; i >= 0; i--) {
        if (!g.contours[i].closed && g.contours[i].nodes.length > 0) { openCi = i; break; }
      }
      // Si on clique sur le premier point du contour courant → fermer
      if (openCi >= 0) {
        const c0 = g.contours[openCi];
        const first = c0.nodes[0];
        const dist = Math.hypot(u.x - first.x, u.y - first.y);
        const tolPx = 12 / ED.scale;
        if (dist < tolPx && c0.nodes.length >= 2) {
          pushUndo(g);
          c0.closed = true;
          // fermer par une ligne droite vers le premier point : le dernier nœud
          // pointe déjà vers first via la boucle de rendu (closed).
          ST.sel = null;
          updateSidePanel(); editorRender();
          return;
        }
      }
      pushUndo(g);
      // Essayer de prolonger le contour courant
      if (openCi >= 0) {
        const c = g.contours[openCi];
        // Ajouter un nœud. On relie au précédent : si on est passé en « ligne »
        // (pas de contrainte), on pose un point corner.
        c.nodes.push({ x: round1(u.x), y: round1(u.y), type: 'corner', in: null, out: null });
        ST.sel = { ci: openCi, ni: c.nodes.length - 1 };
        updateSidePanel(); editorRender();
        // Permettre de « tirer » la tangente sortante du nouveau point
        ED.drag = { type: 'penhandle', ci: openCi, ni: c.nodes.length - 1, moved: false, pen: true };
        return;
      }
      // Sinon : démarrer un nouveau contour
      g.contours.push({ closed: false, nodes: [{ x: round1(u.x), y: round1(u.y), type: 'corner', in: null, out: null }] });
      const newCi = g.contours.length - 1;
      ST.sel = { ci: newCi, ni: 0 };
      updateSidePanel(); editorRender();
      ED.drag = { type: 'penhandle', ci: newCi, ni: 0, moved: false, pen: true };
      return;
    }
    if (ST.tool === 'node') {
      if (hit && (hit.kind === 'node' || hit.kind === 'in' || hit.kind === 'out')) {
        ST.sel = { ci: hit.ci, ni: hit.ni, kind: hit.kind };
        pushUndo(g);
        updateSidePanel();
        ED.drag = { type: hit.kind, ci: hit.ci, ni: hit.ni, moved: false };
        editorRender();
      }
      return;
    }
    if (ST.tool === 'delete') {
      if (hit && hit.kind === 'node') {
        deleteNode(hit.ci, hit.ni);
      } else if (hit) {
        // delete poignée → remettre à null
        removeHandle(hit);
      }
      return;
    }
  }

  function editorMouseMove(e) {
    if (!ED.drag) {
      const hit = findNodeAt(e.clientX, e.clientY);
      const u = editorToUnits(e.clientX, e.clientY);
      $('hudCoord').textContent = Math.round(u.x) + ', ' + Math.round(u.y);
      return;
    }
    const g = ST.glyphs[ST.editGlyph];
    if (!g) return;
    if (ED.drag.type === 'pan') {
      const dxPx = e.clientX - ED.drag.sx, dyPx = e.clientY - ED.drag.sy;
      ED.ox = ED.drag.ox - dxPx / ED.scale;
      ED.oy = ED.drag.oy + dyPx / ED.scale;
      editorRender();
      return;
    }
    const u = editorToUnits(e.clientX, e.clientY);
    const c = g.contours[ED.drag.ci];
    if (!c) return;
    const n = c.nodes[ED.drag.ni];
    if (!n) return;
    ED.drag.moved = true;
    if (ED.drag.type === 'penhandle') {
      // Tirer la poignée sortante du nœud plume → courbe lisse
      const dx = u.x - n.x, dy = u.y - n.y;
      if (Math.hypot(dx, dy) > 1) {
        n.out = { x: round1(u.x), y: round1(u.y) };
        n.type = 'smooth';
        // Donner une poignée « in » symétrique sur le nœud PRÉCÉDENT pour
        // que le segment précédent devienne une vraie courbe.
        if (c.nodes.length >= 2) {
          const prev = c.nodes[(ED.drag.ni - 1 + c.nodes.length) % c.nodes.length];
          if (prev && !prev.out) {
            prev.out = { x: n.x - dx, y: n.y - dy };
            prev.type = (prev.type === 'corner') ? 'smooth' : prev.type;
          }
        }
      }
    } else if (ED.drag.type === 'node') {
      n.x = round1(u.x); n.y = round1(u.y);
      // maintenir symétrie/smooth
      if (n.out && n.type !== 'corner') {
        const dx = n.x - n.out.x, dy = n.y - n.out.y;
        if (n.in) n.in = { x: n.x - dx, y: n.y - dy };
        else if (n.type === 'symmetric') { /* no in */ }
      }
      if (n.in && n.type === 'symmetric') {
        const dx = n.x - n.in.x, dy = n.y - n.in.y;
        if (n.out) n.out = { x: n.x - dx, y: n.y - dy };
      }
    } else if (ED.drag.type === 'out') {
      n.out = { x: round1(u.x), y: round1(u.y) };
      if (n.type === 'smooth' || n.type === 'symmetric') {
        const dx = n.out.x - n.x, dy = n.out.y - n.y;
        if (n.in) n.in = { x: n.x - dx, y: n.y - dy };
      }
    } else if (ED.drag.type === 'in') {
      n.in = { x: round1(u.x), y: round1(u.y) };
      if (n.type === 'smooth' || n.type === 'symmetric') {
        const dx = n.in.x - n.x, dy = n.in.y - n.y;
        if (n.out) n.out = { x: n.x - dx, y: n.y - dy };
      }
    }
    updateSidePanel();
    editorRender();
  }

  function editorMouseUp() {
    if (ED.drag && ED.drag.type !== 'pan' && ED.drag.moved) {
      markDirty();
      const g = ST.glyphs[ST.editGlyph];
      // push undo après modif (simplifié : on snapshot avant)
    }
    ED.drag = null;
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  function deleteNode(ci, ni) {
    const g = ST.glyphs[ST.editGlyph];
    pushUndo(g);
    const c = g.contours[ci];
    c.nodes.splice(ni, 1);
    if (!c.nodes.length) g.contours.splice(ci, 1);
    ST.sel = null;
    updateSidePanel(); editorRender();
  }

  function removeHandle(hit) {
    const g = ST.glyphs[ST.editGlyph];
    pushUndo(g);
    const c = g.contours[hit.ci];
    const n = c.nodes[hit.ni];
    if (hit.kind === 'in') n.in = null;
    if (hit.kind === 'out') n.out = null;
    if (n.in == null && n.out == null) n.type = 'corner';
    ST.sel = null;
    updateSidePanel(); editorRender();
  }

  function findBestSegment(c, u) {
    // trouve l'index du noeud après lequel insérer (pour insérer un point)
    let best = c.nodes.length, bestD = 1e9;
    for (let i = 0; i < c.nodes.length; i++) {
      const n = c.nodes[i];
      const next = c.nodes[(i + 1) % c.nodes.length];
      const d = pointSegDist(u.x, u.y, n, next);
      if (d < bestD) { bestD = d; best = i + 1; }
    }
    return Math.min(best, c.nodes.length);
  }

  // Ajoute un point sur le milieu d'un segment pour éditer
  function addPointOnContour(ci, segIdx) {
    const g = ST.glyphs[ST.editGlyph];
    pushUndo(g);
    const c = g.contours[ci];
    const a = c.nodes[segIdx % c.nodes.length];
    const b = c.nodes[(segIdx + 1) % c.nodes.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, type: 'corner', in: null, out: null };
    c.nodes.splice((segIdx + 1) % c.nodes.length, 0, mid);
    ST.sel = { ci, ni: (segIdx + 1) % c.nodes.length };
    updateSidePanel(); editorRender();
  }

  /* ── Formes primitives ── */
  function addRectShape() {
    const g = ST.glyphs[ST.editGlyph];
    pushUndo(g);
    const w = 300, h = 400, x = -w / 2 + g.advanceWidth / 2, y = 100;
    const nodes = [
      { x: x, y: y, type: 'corner', in: null, out: null },
      { x: x + w, y: y, type: 'corner', in: null, out: null },
      { x: x + w, y: y + h, type: 'corner', in: null, out: null },
      { x: x, y: y + h, type: 'corner', in: null, out: null }
    ];
    g.contours.push({ closed: true, nodes });
    updateSidePanel(); editorRender();
  }
  function addEllipseShape() {
    const g = ST.glyphs[ST.editGlyph];
    pushUndo(g);
    const cx = g.advanceWidth / 2, cy = 350, rx = 180, ry = 250;
    const k = 0.5523;
    const nodes = [
      { x: cx, y: cy + ry, type: 'smooth', out: { x: cx + rx * k, y: cy + ry }, in: { x: cx - rx * k, y: cy + ry } },
      { x: cx + rx, y: cy, type: 'smooth', out: { x: cx + rx, y: cy + ry * k }, in: { x: cx + rx, y: cy - ry * k } },
      { x: cx, y: cy - ry, type: 'smooth', out: { x: cx - rx * k, y: cy - ry }, in: { x: cx + rx * k, y: cy - ry } },
      { x: cx - rx, y: cy, type: 'smooth', out: { x: cx - rx, y: cy - ry * k }, in: { x: cx - rx, y: cy + ry * k } }
    ];
    g.contours.push({ closed: true, nodes });
    updateSidePanel(); editorRender();
  }

  /* ── Conversion contours → chemin opentype (Y↑) ── */
  function contoursToOpentypePath(contours) {
    const p = new ST.opentype.Path();
    for (const c of contours) {
      if (!c.nodes.length) continue;
      const first = c.nodes[0];
      p.moveTo(round2(first.x), round2(first.y));
      const L = c.closed ? c.nodes.length : c.nodes.length - 1;
      for (let i = 0; i < (c.closed ? c.nodes.length : c.nodes.length - 1); i++) {
        const n = c.nodes[i];
        const next = c.nodes[(i + 1) % c.nodes.length];
        if (c.closed || i < c.nodes.length - 1) {
          if (n.out && next.in) {
            p.curveTo(round2(n.out.x), round2(n.out.y), round2(next.in.x), round2(next.in.y), round2(next.x), round2(next.y));
          } else if (n.out) {
            p.quadraticCurveTo(round2(n.out.x), round2(n.out.y), round2(next.x), round2(next.y));
          } else if (next.in) {
            p.quadraticCurveTo(round2(next.in.x), round2(next.in.y), round2(next.x), round2(next.y));
          } else {
            p.lineTo(round2(next.x), round2(next.y));
          }
        }
      }
      if (c.closed) p.closePath();
    }
    return p;
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  /* ── EXPORT TTF/OTF ── */
  function buildFontFromGlyphs() {
    const O = ST.opentype;
    const newGlyphs = [];
    // .notdef + espace d'abord
    const glyphsToWrite = ST.glyphs.slice();
    // Garde les glyphes sans contours (espaces etc.)
    for (const g of glyphsToWrite) {
      const path = g.contours && g.contours.length ? contoursToOpentypePath(g.contours) : new O.Path();
      let unicode = g.unicode;
      if (unicode == null && g.char) {
        try { unicode = g.char.codePointAt(0); } catch (e) { unicode = null; }
      }
      const ng = new O.Glyph({
        name: g.name || 'glyph' + newGlyphs.length,
        unicode,
        advanceWidth: Math.round(g.advanceWidth),
        path
      });
      newGlyphs.push(ng);
    }
    // Ordre : opentype exige .notdef en premier + cmap par unicode.
    // Trions pour un bon ordre de glyphes (mais .notdef index 0 requis).
    newGlyphs.sort((a, b) => {
      // espaces d'abord, puis par unicode
      const au = a.unicode == null ? -1 : a.unicode;
      const bu = b.unicode == null ? -1 : b.unicode;
      return au - bu;
    });
    // Assurer que .notdef existe
    if (!newGlyphs.length || newGlyphs[0].name !== '.notdef') {
      newGlyphs.unshift(new O.Glyph({ name: '.notdef', unicode: 0, advanceWidth: ST.upem / 2, path: new O.Path() }));
    }
    const newFont = new O.Font({
      familyName: ST.fontName,
      styleName: 'Regular',
      unitsPerEm: ST.upem,
      ascender: ST.ascender,
      descender: ST.descender,
      glyphs: newGlyphs
    });
    // Copier la table OS/2 pour capHeight/xHeight si dispo
    try {
      const os2 = newFont.tables.os2;
      os2.sCapHeight = ST.capHeight;
      os2.sxHeight = ST.xHeight;
    } catch (e) {}
    return newFont;
  }

  function download(buffer, filename) {
    const blob = buffer instanceof Blob ? buffer : new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  function exportFont(format) {
    if (!ST.font && !ST.glyphs.length) return;
    try {
      const newFont = buildFontFromGlyphs();
      const buf = newFont.toArrayBuffer();
      const name = (ST.fontName || 'police').replace(/\s+/g, '-') + (ST.dirty ? '-modifiee' : '') + (format === 'otf' ? '.otf' : '.ttf');
      download(buf, name);
      toast(tf('toastTypoExported', { name: name }));
    } catch (e) {
      console.error(e);
      toast(tf('errExport', { msg: e.message }), true);
    }
  }

  /* ── EXPORT .sf (SuperFont) ── */
  function exportSf() {
    if (!ST.font && !ST.glyphs.length) return;
    const sf = {
      sf: 'superfont',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      meta: {
        name: ST.fontName,
        file: ST.fileName,
        tool: 'SuperTyPo'
      },
      font: {
        unitsPerEm: ST.upem,
        ascender: ST.ascender,
        descender: ST.descender,
        capHeight: ST.capHeight,
        xHeight: ST.xHeight
      },
      glyphs: ST.glyphs.map(g => ({
        name: g.name,
        unicode: g.unicode,
        char: g.char,
        advanceWidth: g.advanceWidth,
        contours: g.contours,
        dirty: !!g.dirty
      }))
    };
    const blob = new Blob([JSON.stringify(sf, null, 2)], { type: 'application/json' });
    download(blob, (ST.fontName || 'police').replace(/\s+/g, '-') + '.sf');
    toast(t('toastSfSaved'));
  }

  function importSfBuffer(buf, fileName) {
    const text = new TextDecoder().decode(buf);
    const sf = JSON.parse(text);
    if (!sf || sf.sf !== 'superfont' || !Array.isArray(sf.glyphs)) throw new Error('Fichier .sf invalide.');
    applySfObject(sf, fileName.replace(/\.[^.]+$/, ''));
    ST.dirty = true;
    $('modifiedChip').style.display = 'inline-flex';
  }

  /* ── Contrôles panneau latéral ── */
  function bindSidePanel() {
    $('spNodeType').addEventListener('change', () => {
      const g = ST.glyphs[ST.editGlyph];
      if (!ST.sel || !g) return;
      const c = g.contours[ST.sel.ci];
      const n = c.nodes[ST.sel.ni];
      pushUndo(g);
      n.type = $('spNodeType').value;
      editorRender();
    });
    $('spNodeX').addEventListener('change', () => {
      const g = ST.glyphs[ST.editGlyph];
      if (!ST.sel || !g) return;
      const c = g.contours[ST.sel.ci];
      const n = c.nodes[ST.sel.ni];
      pushUndo(g);
      n.x = parseFloat($('spNodeX').value) || 0;
      editorRender(); updateSidePanel();
    });
    $('spNodeY').addEventListener('change', () => {
      const g = ST.glyphs[ST.editGlyph];
      if (!ST.sel || !g) return;
      const c = g.contours[ST.sel.ci];
      const n = c.nodes[ST.sel.ni];
      pushUndo(g);
      n.y = parseFloat($('spNodeY').value) || 0;
      editorRender(); updateSidePanel();
    });
    $('spAdvance').addEventListener('change', () => {
      const g = ST.glyphs[ST.editGlyph];
      if (!g) return;
      pushUndo(g);
      g.advanceWidth = Math.max(0, parseFloat($('spAdvance').value) || 0);
      markDirty();
      editorRender(); updateSidePanel();
    });
    $('btnAddRect').addEventListener('click', addRectShape);
    $('btnAddEllipse').addEventListener('click', addEllipseShape);
    // Booléens (union / soustraction / intersection)
    $('btnBoolUnion').addEventListener('click', boolUnion);
    $('btnBoolSubtract').addEventListener('click', boolSubtract);
    $('btnBoolIntersect').addEventListener('click', boolIntersect);
    // Transformations géométriques (symétrie H/V, rotation 90°)
    const bmh = $('btnMirrorH'); if (bmh) bmh.addEventListener('click', mirrorH);
    const bmv = $('btnMirrorV'); if (bmv) bmv.addEventListener('click', mirrorV);
    const br90 = $('btnRotate90'); if (br90) br90.addEventListener('click', rotate90);
  }

  /* ── Clavier ── */
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const editing = ST.editing;
    // Ctrl+S export sf / Ctrl+E export
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && String.fromCharCode(e.keyCode).toLowerCase() === 's') {
      e.preventDefault();
      if (ST.glyphs.length) exportSf();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && String.fromCharCode(e.keyCode).toLowerCase() === 'e') {
      e.preventDefault();
      if (ST.glyphs.length) exportFont('ttf');
      return;
    }
    if (editing && (e.ctrlKey || e.metaKey) && String.fromCharCode(e.keyCode).toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (editing && (e.ctrlKey || e.metaKey) && String.fromCharCode(e.keyCode).toLowerCase() === 'y') {
      e.preventDefault(); redo(); return;
    }
    if (editing && (e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault(); editorZoomPct(100); return;
    }
    if (editing && (e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault(); focusSearch(); return;
    }
    if (!editing) {
      if ((e.ctrlKey || e.metaKey) && String.fromCharCode(e.keyCode).toLowerCase() === 'f') {
        e.preventDefault(); $('glyphSearch').focus(); $('glyphSearch').select(); return;
      }
    }
    if (editing && (e.key === 'Escape')) { closeEditor(); return; }
    if (!editing && e.key === 'Escape' && $('helpOverlay').style.display === 'block') { $('helpOverlay').style.display = 'none'; return; }
    if (editing && tag !== 'input' && tag !== 'textarea') {
      const k = e.key.toLowerCase();
      if (k === 'v') { editorSetTool('select'); e.preventDefault(); }
      else if (k === 'p') { editorSetTool('pen'); e.preventDefault(); }
      else if (k === 'n') { editorSetTool('node'); e.preventDefault(); }
      else if (k === 'a') { e.preventDefault(); addPointOnSelection(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (ST.sel && ST.sel.ni != null) {
          if (ST.sel.kind === 'node') deleteNode(ST.sel.ci, ST.sel.ni);
          else removeHandle(ST.sel);
        } else if (ST.sel && ST.sel.ci != null) {
          deleteContour(ST.sel.ci);
        }
      }
    }
  }

  function addPointOnSelection() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g || !ST.sel || ST.sel.ni == null) return;
    const ci = ST.sel.ci;
    const c = g.contours[ci];
    const segIdx = ST.sel.ni;
    addPointOnContour(ci, segIdx);
  }

  function focusSearch() { $('glyphSearch').focus(); }

  /* ── Raccourcis de zoom global (grille) ── */
  function gridZoom(f) {
    ST.gridZoom = Math.max(0.4, Math.min(3, ST.gridZoom * f));
    applyGridZoom();
  }
  function applyGridZoom() {
    $('zoomPct').textContent = Math.round(ST.gridZoom * 100) + '%';
    const grid = $('glyphGrid');
    // Appliquer l'échelle via la taille minimale de cellule (CSS grid)
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(' + Math.round(96 * ST.gridZoom) + 'px, 1fr))';
    // Re-rendre les canvas (tailles changées)
    requestAnimationFrame(() => {
      document.querySelectorAll('#glyphGrid .glyph-cell').forEach((cell, i) => {
        const cv = cell.querySelector('.gcanvas');
        if (!cv) return;
        const g = ST.glyphs.find(x => x.char === (cell.querySelector('.gc').textContent === '␣' ? ' ' : cell.querySelector('.gc').textContent));
        if (g) renderGlyphToCanvas(cv, g, { outline: ST.gridMode === 'outline' });
      });
    });
  }

  /* ── Bindings UI ── */
  function bindUI() {
    // Fichier
    $('btnLoadFont').addEventListener('click', () => $('fileInput').click());
    $('btnPickFont').addEventListener('click', () => $('fileInput').click());
    $('btnDropzone').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', onFilePicked);
    // drag/drop global
    document.addEventListener('dragover', (e) => { e.preventDefault(); $('dropArea').classList.add('dragover'); });
    document.addEventListener('dragleave', (e) => { if (e.target === document.body) $('dropArea').classList.remove('dragover'); });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      $('dropArea').classList.remove('dragover');
      if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    });
    // Export
    $('btnSaveSf').addEventListener('click', exportSf);
    $('btnExportFont').addEventListener('click', () => exportFont('ttf'));
    // Zoom grille
    $('btnZoomOut').addEventListener('click', () => gridZoom(1 / 1.2));
    $('btnZoomIn').addEventListener('click', () => gridZoom(1.2));
    $('zoomPct').addEventListener('click', () => { ST.gridZoom = 1; applyGridZoom(); });
    // theme
    $('btnTheme').addEventListener('click', toggleTheme);
    $('btnHelp').addEventListener('click', () => $('helpOverlay').style.display = 'flex');
    $('btnCloseHelp').addEventListener('click', () => $('helpOverlay').style.display = 'none');
    // langue
    $('langSel').addEventListener('change', (e) => {
      ST.lang = e.target.value;
      try { localStorage.setItem('st_lang', ST.lang); } catch (err) {}
      applyLang();
    });
    // grille
    $('btnGridView').addEventListener('click', () => { ST.gridMode = 'render'; refreshViewButtons(); buildGlyphGrid(); });
    $('btnOutlineView').addEventListener('click', () => { ST.gridMode = 'outline'; refreshViewButtons(); buildGlyphGrid(); });
    $('btnRefresh').addEventListener('click', () => {
      // re-décomposer depuis source si possible
      if (ST.originalBuffer) { try { loadFontFromBuffer(ST.originalBuffer.slice(0), ST.fileName); buildGlyphGrid(); toast(t('toastResync')); } catch (e) { toast(e.message, true); } }
      else if (ST.font) buildGlyphGrid();
    });
    $('glyphSearch').addEventListener('input', () => { ST.search = $('glyphSearch').value; buildGlyphGrid(); });
    $('sampleInput').addEventListener('change', () => { ST.sampleChars = $('sampleInput').value; buildGlyphGrid(); });
    $('optGridShowEmpty').addEventListener('change', () => { ST.showEmpty = $('optGridShowEmpty').checked; buildGlyphGrid(); });

    // Éditeur
    $('btnCloseEditor').addEventListener('click', closeEditor);
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnZoomOut2').addEventListener('click', () => editorZoom(1 / 1.25));
    $('btnZoomIn2').addEventListener('click', () => editorZoom(1.25));
    $('edZoomPct').addEventListener('click', () => editorZoomPct(100));
    document.querySelectorAll('#toolGroup .tool-btn[data-tool]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.tool === 'delete') { editorDeleteTool(); return; }
        editorSetTool(b.dataset.tool);
      });
    });
    document.querySelectorAll('#toolGroup .tool-btn[data-action]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'cut') cutContourAtSelection();
        if (a === 'fit') editorFit();
      });
    });
    // Options guides
    ['optGuides', 'optGrid', 'optSnap'].forEach(id => { $(id).addEventListener('change', editorRender); });

    // keydown global
    document.addEventListener('keydown', onKey);
  }

  function refreshViewButtons() {
    $('btnGridView').classList.toggle('active', ST.gridMode === 'render');
    $('btnOutlineView').classList.toggle('active', ST.gridMode === 'outline');
  }

  function editorDeleteTool() {
    if (ST.sel && ST.sel.ni != null) {
      if (ST.sel.kind === 'node') deleteNode(ST.sel.ci, ST.sel.ni);
      else removeHandle(ST.sel);
    } else if (ST.sel && ST.sel.ci != null) {
      deleteContour(ST.sel.ci);
    }
  }

  function cutContourAtSelection() {
    const g = ST.glyphs[ST.editGlyph];
    if (!g || !ST.sel || ST.sel.ni == null) return;
    const c = g.contours[ST.sel.ci];
    if (!c.closed) return;
    pushUndo(g);
    // Couper : transformer en contour ouvert en cassant à ce noeud
    const ni = ST.sel.ni;
    const nodes = c.nodes.slice(ni).concat(c.nodes.slice(0, ni + 1));
    c.nodes = nodes;
    c.closed = false;
    // Enlever la poignée entrante du 1er noeud et sortante du dernier
    c.nodes[0].in = null;
    c.nodes[c.nodes.length - 1].out = null;
    ST.sel = null;
    updateSidePanel(); editorRender();
  }

  function onFilePicked(e) {
    const files = e.target.files;
    if (files.length) onFiles(files);
    e.target.value = '';
  }

  async function onFiles(files) {
    const file = files[0];
    if (!file) return;
    try {
      const isSf = /\.sf$/i.test(file.name);
      let buf = await arrayBufferFromFile(file);
      if (isSf) {
        importSfBuffer(buf, file.name);
        showFontView();
      } else {
        buf = await normalizeFontBuffer(buf);
        loadFontFromBuffer(buf, file.name);
        showFontView();
      }
    } catch (e) {
      console.error(e);
      toast(tf('errLoad', { name: file.name, msg: e.message }), true);
    }
  }

  function showFontView() {
    $('fontNameVal').textContent = ST.fontName;
    $('glyphCountVal').textContent = ST.glyphs.length;
    $('fontInfoGroup').style.display = 'flex';
    $('btnLoadFont').style.display = 'none';
    $('btnDropzone').style.display = 'inline-flex';
    $('btnSaveSf').disabled = false;
    $('btnExportFont').disabled = false;
    $('dropArea').style.display = 'none';
    $('fontView').style.display = 'flex';
    $('sampleInput').value = ST.sampleChars || defaultSample();
    ST.sampleChars = $('sampleInput').value;
    buildGlyphGrid();
  }

  function toggleTheme() {
    ST.theme = ST.theme === 'light' ? 'dark' : 'light';
    document.body.classList.toggle('theme-dark', ST.theme === 'dark');
    if (ST.editing) editorRender(); else buildGlyphGrid();
  }

  /* ── Init ── */
  function init() {
    if (!window.opentype) { document.getElementById('dropArea').innerHTML = '<div class="drop-card"><p>Erreur : opentype.js non chargé.</p></div>'; return; }
    ST.opentype = window.opentype;
    // thème persisté
    try { const th = localStorage.getItem('st_theme'); if (th) { ST.theme = th; document.body.classList.toggle('theme-dark', th === 'dark'); } } catch (e) {}
    // langue persistée
    try { const lg = localStorage.getItem('st_lang'); if (lg && lg in I18N) ST.lang = lg; } catch (e) {}
    bindUI();
    bindSidePanel();
    bindMetricsPanel();
    $('sampleInput').value = defaultSample();
    ST.sampleChars = defaultSample();
    applyLang();
    // Restauration autosave (.sf en cours)
    restoreAutoSave().then(sf => {
      if (!sf) return;
      // Afficher une bannière de reprise
      const savedAt = new Date(sf.savedAt || Date.now());
      const label = (sf.meta && sf.meta.name) || 'travail';
      const dirtyCount = (sf.glyphs || []).filter(g => g.dirty).length;
      const bar = document.createElement('div');
      bar.id = 'autosaveBar';
      bar.innerHTML =
        '<div class="asb-text">💾 Travail en cours restauré — <b>' + escapeHtml(label) + '</b>' +
        (dirtyCount ? ' (' + dirtyCount + ' glyphe' + (dirtyCount > 1 ? 's' : '') + ' modifié' + (dirtyCount > 1 ? 's' : '') + ')' : '') +
        ' · sauvé le ' + savedAt.toLocaleString() + '</div>' +
        '<div class="asb-actions">' +
        '<button class="asb-btn primary" id="asbResume">Reprendre</button>' +
        '<button class="asb-btn" id="asbDiscard">Ignorer</button>' +
        '</div>';
      document.body.appendChild(bar);
      $('asbResume').addEventListener('click', () => {
        applySfObject(sf, label);
        bar.remove();
        showFontView();
        toast(t('toastRestored'));
      });
      $('asbDiscard').addEventListener('click', () => {
        clearAutoSave();
        bar.remove();
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', init);
  window.SuperTyPo = {
    loadFontFromBuffer, exportFont, exportSf, ST, ED,
    openEditor, buildGlyphGrid, editorSetTool, editorSetSel,
    editorZoom, editorFit, editorZoomPct, snapshotGlyph,
    markDirty, runAutoSave, scheduleAutoSave, applySfObject,
    exportSfObject: buildSfObject
  };
})();
