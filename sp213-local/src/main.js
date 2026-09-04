// ═══════════════════════════════════════════════════════════════
//  SP213 STUDIO — LOCAL (Vite + WebLLM npm)
//  Moteur de mise en page SuperPrint. 100% local en option.
//  - WebLLM : import npm (@mlc-ai/web-llm), pas de CDN.
//  - Groq : fetch direct (CORS autorisé par Groq) — option cloud.
// ═══════════════════════════════════════════════════════════════
import { CreateMLCEngine } from '@mlc-ai/web-llm';
import * as XLSX from '@e965/xlsx';

(function () {
  'use strict';

  // ── Constantes ──────────────────────────────────────────────
  const MM_TO_PX = 72 / 25.4;
  const PT_TO_PX = 4 / 3;

  const GROQ_MODELS = [
    ['qwen/qwen3.8-27b', 'Qwen 3.8 27B — recommended (fast on Groq)'],
    ['qwen/qwen3.6-27b', 'Qwen 3.6 27B — high quality'],
    ['openai/gpt-oss-120b', 'OpenAI GPT-OSS 120B — powerful'],
    ['openai/gpt-oss-20b', 'OpenAI GPT-OSS 20B — lightweight'],
    ['groq/compound', 'Groq Compound — reasoning']
  ];

  // OpenRouter : modèles 100% GRATUITS (:free) — vérifiés le 2026-08-29.
  // Clé sk-or-… sur openrouter.ai.
  // Liste vérifiée par tests réels (2026-08-29) : Nemotron 3 Super 120B et
  // MiniMax M2.7 produisent un JSON valide 8/8 pages.
  // ❌ Retirés (non fiables en test) : Gemma 4 31B, Inkling Small, MiniMax M3, GLM 5.2.
  const OPENROUTER_MODELS = [
    ['nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super 120B — recommended (verified: JSON 8/8 pages)'],
    ['minimax/minimax-m2.7:free', 'MiniMax M2.7 — versatile (verified: JSON 8/8 pages)'],
    ['google/gemma-4-26b-a4b-it:free', 'Gemma 4 26B A4B — fast'],
    ['nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra 550B — very powerful, slower'],
    ['thinkingmachines/inkling:free', 'Inkling 975B — general purpose, long context']
  ];

  const WLLM_MODELS = [
    ['Qwen3-4B-q4f16_1-MLC', 'Qwen3 4B — recommended (3.4 GB VRAM, best balance)'],
    ['Qwen3-8B-q4f16_1-MLC', 'Qwen3 8B — maximum quality (5.7 GB VRAM)'],
    ['Qwen2.5-3B-Instruct-q4f16_1-MLC', 'Qwen2.5 3B — fast (2.5 GB VRAM)'],
    ['Llama-3.2-3B-Instruct-q4f16_1-MLC', 'Llama 3.2 3B — basic (2.3 GB VRAM)'],
    ['Qwen3-1.7B-q4f16_1-MLC', 'Qwen3 1.7B — very lightweight (2.0 GB VRAM)'],
    ['SmolLM2-1.7B-Instruct-q4f16_1-MLC', 'SmolLM2 1.7B — compact alternative (1.8 GB VRAM)'],
    ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Qwen2.5 1.5B — light (1.6 GB VRAM)'],
    ['Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Llama 3.2 1B — light recommended (0.9 GB VRAM)'],
    ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC', 'Qwen2.5 0.5B — ultra-light experimental (0.95 GB VRAM)'],
    ['SmolLM2-360M-Instruct-q4f16_1-MLC', 'SmolLM2 360M — smallest, basic layouts (0.4 GB VRAM)']
  ];

  // 🆕 DeepSeek (cloud) — modèles OpenAI-compatibles. API : api.deepseek.com.
  // V4 (juil./août 2026) : Flash (rapide/économique), Pro (puissant), Flash Vision
  // (expérimental, accepte les images). V3 « deepseek-chat » / « deepseek-reasoner » en repli.
  const DEEPSEEK_MODELS = [
    ['deepseek-v4-flash', 'DeepSeek V4 Flash — recommended (fast, economical, JSON)'],
    ['deepseek-v4-pro', 'DeepSeek V4 Pro — powerful, maximum accuracy'],
    ['deepseek-v4-flash-vision-exp', 'DeepSeek V4 Flash Vision (experimental) — accepts images'],
    ['deepseek-chat', 'DeepSeek V3.2 (chat) — fallback'],
    ['deepseek-reasoner', 'DeepSeek R1 (reasoner) — fallback']
  ];

  // ── État ────────────────────────────────────────────────────
  const LS = {
    key: 'sp213_groq_key',
    model: 'sp213_groq_model',
    orKey: 'sp213_openrouter_key',
    orModel: 'sp213_openrouter_model',
    dsKey: 'sp213_deepseek_key',
    dsModel: 'sp213_deepseek_model',
    wllm: 'sp213_wllm_model',
    chat: 'sp213_chat_v1',
    doc: 'sp213_doc_v1',
    dims: 'sp213_dims_v1',
    engine: 'sp213_engine',
    convs: 'sp213_convs_v1',       // 🆕 index des conversations
    convActive: 'sp213_conv_active_v1' // 🆕 conversation active
  };

  const state = {
    apiKey: '',
    model: GROQ_MODELS[0][0],
    orApiKey: '',
    orModel: OPENROUTER_MODELS[0][0],
    dsApiKey: '',
    dsModel: DEEPSEEK_MODELS[0][0],
    wllmModel: WLLM_MODELS[0][0],
    engine: 'deepseek', // 'deepseek' | 'webllm' | 'groq' | 'openrouter' — DeepSeek par défaut
    pageW: 210, pageH: 297, bleed: 3,
    viewMode: 'single',
    pages: [],
    doc: null,
    chat: [],
    busy: false,
    guidesVisible: true,
    gridVisible: true, // 🆕 visibilité de la grille de composition (à la demande)
    webllm: null,
    webllmLoading: false,
    webllmPromise: null,
    lastPrompt: '',
    attachments: [],
    convs: [],        // 🆕 [{id, title, updated}]
    convActive: null,  // 🆕 id de la conversation active
    undoStack: [],    // 🆕 historique d'annulation
    redoStack: [],     // 🆕 historique de rétablissement
    selectedIds: [],   // 🆕 éléments sélectionnés dans l'aperçu (retravail ciblé)
    pendingDims: null
  };

  const $ = (id) => document.getElementById(id);

  // ── Helpers ─────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function mmToPx(mm) { return mm * MM_TO_PX; }
  function setLS(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function getLS(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

  // ── Pré-home : une ligne à copier (façon Ollama) ──────────
  // ⚠️ En local, le projet est DÉJÀ installé → la commande se limite à LANCER
  //    le serveur (npm run dev). Windows : utiliser npm.cmd pour contourner la
  //    politique d'exécution PowerShell (PSSecurityException sur npm.ps1).
  const INSTALL_CMDS = {
    win: 'npm.cmd run dev',
    mac: 'npm run dev',
    linux: 'npm run dev'
  };
  const INSTALL_HINTS = {
    win: 'PowerShell · npm.cmd bypasses the script ExecutionPolicy restriction',
    mac: 'Terminal · starts the local SuperPrint server',
    linux: 'Terminal · starts the local SuperPrint server'
  };
  // Icônes SVG par OS — formes géométriques nettes et propres (alignées web)
  const OS_ICONS = {
    win: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><rect x="0" y="0" width="10.5" height="10.5" fill="currentColor"/><rect x="13.5" y="0" width="10.5" height="10.5" fill="currentColor"/><rect x="0" y="13.5" width="10.5" height="10.5" fill="currentColor"/><rect x="13.5" y="13.5" width="10.5" height="10.5" fill="currentColor"/></svg>',
    mac: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702"/></svg>',
    linux: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 12 18.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 12 5 5.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 12 6.2 19.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>'
  };

  function initPreHome() {
    // Onglets Windows / macOS / Linux + détection automatique de l'OS
    const applyOS = (os) => {
      let tab = document.querySelector('.cmd-tab[data-os="' + os + '"]');
      if (!tab) tab = document.querySelector('.cmd-tab[data-os="win"]');
      document.querySelectorAll('.cmd-tab').forEach(t => t.classList.remove('active'));
      if (tab) tab.classList.add('active');
      const key = tab ? tab.getAttribute('data-os') : 'win';
      const code = $('installCmd');
      if (code) code.textContent = INSTALL_CMDS[key];
      const hint = $('installHint');
      if (hint) hint.textContent = INSTALL_HINTS[key];
      const ic = $('osIcon');
      if (ic && OS_ICONS[key]) ic.innerHTML = OS_ICONS[key];
    };
    document.querySelectorAll('.cmd-tab').forEach(tab => {
      tab.addEventListener('click', () => applyOS(tab.getAttribute('data-os')));
    });
    // Détection automatique de l'OS du visiteur
    const ua = navigator.userAgent || '';
    const detected = /Windows/i.test(ua) ? 'win' : (/Mac|iPhone|iPad|iPod/i.test(ua) ? 'mac' : (/Linux|X11|CrOS/i.test(ua) ? 'linux' : 'win'));
    applyOS(detected);

    // Copier la commande
    document.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = $(btn.getAttribute('data-copy'));
        if (!target) return;
        const text = target.textContent.trim();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => flashCopy(btn)).catch(() => fallbackCopy(btn, text));
        } else { fallbackCopy(btn, text); }
      });
    });
    // ✕ Croix en haut à droite des réglages → revient sur l'interface studio
    const closeBtn = $('welcomeCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => startStudio('webllm'));
    // Boutons d'ouverture
    // « Démarrer SuperPrint » → l'application PAO complète (superprint/app/index.html)
    $('startLocalBtn').addEventListener('click', () => openSuperPrintLocal());
    // Section « ou en ligne » : SuperPrint (éditeur) en premier, puis Studio,
    // puis Documentation.
    const onlineSp = $('onlineSpBtn');
    if (onlineSp) onlineSp.addEventListener('click', () => openSuperPrintLocal());
    const onlineStudio = $('onlineStudioBtn');
    if (onlineStudio) onlineStudio.addEventListener('click', () => startStudio('webllm'));
    const onlineDoc = $('onlineDocBtn');
    if (onlineDoc) onlineDoc.addEventListener('click', () => openSuperPrintDoc());
  }

  // Ouvre l'application SuperPrint complète (servie par Vite dans /superprint/app/)
  // 🆕 FIX 2026-08-30 : le bouton « Ouvrir dans SuperPrint » (bas de preview) construit
  //   maintenant la maquette courante (buildSPFile) et l'écrit dans sp213_import_sp AVANT
  //   d'ouvrir l'app, afin que l'app s'ouvre DIRECTEMENT en prod avec la maquette chargée
  //   (via ?from=sp213 + _spLoadStudioImport), sans passer par les pop-ins de démarrage.
  function openSuperPrintLocal(spFileToOpen = null) {
    let hasHandoff = false;
    const source = spFileToOpen || (state.pages && state.pages.length && typeof buildSPFile === 'function'
      ? buildSPFile()
      : null);
    if (source) {
      try {
        const spFile = normalizeSPFile(source);
        localStorage.setItem('sp213_import_sp', JSON.stringify(spFile));
        hasHandoff = true;
      } catch (e) {
        try { localStorage.removeItem('sp213_import_sp'); } catch (_) {}
        appendChat('assistant', 'Unable to send the layout to SuperPrint: ' + (e && e.message ? e.message : e));
        return;
      }
    }
    const url = new URL('superprint/app/index.html', window.location.href);
    // Transférer la clé sp213 pour que SuperPrint puisse charger une maquette
    if (hasHandoff) url.searchParams.set('from', 'sp213');
    // Robuste face au bloqueur de popups : on essaie un nouvel onglet, et si la
    // fenêtre est fermée/au point mort (about:blank) après 600ms, on navigue
    // directement dans l'onglet courant.
    let win = null;
    try { win = window.open(url.href, '_blank'); } catch (_) {}
    if (!win) { window.location.href = url.href; return; }
    setTimeout(() => {
      try {
        const bad = win.closed || !win.location || /about:blank/.test(String(win.location.href));
        if (bad) window.location.href = url.href;
      } catch (_) {
        // Accès cross-origin interdit → la fenêtre s'est bien ouverte, rien à faire.
      }
    }, 600);
  }

  // Ouvre la documentation SuperPrint locale (superprint/documentation.html)
  function openSuperPrintDoc() {
    const url = new URL('superprint/documentation.html', window.location.href);
    let win = null;
    try { win = window.open(url.href, '_blank'); } catch (_) {}
    if (!win) { window.location.href = url.href; return; }
    setTimeout(() => {
      try {
        const bad = win.closed || !win.location || /about:blank/.test(String(win.location.href));
        if (bad) window.location.href = url.href;
      } catch (_) {}
    }, 600);
  }

  function flashCopy(btn) {
    const old = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => { btn.innerHTML = old; }, 1600);
  }
  function fallbackCopy(btn, text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); flashCopy(btn); } catch (_) {}
    ta.remove();
  }

  // ── Démarrage studio ────────────────────────────────────────
  function startStudio(engine) {
    // L'engine sauvegardé prime (ex. DeepSeek choisi dans les réglages) ; sinon on
    // garde celui passé en argument.
    const previousEngine = state.engine;
    const savedEngine = getLS(LS.engine);
    state.engine = (savedEngine === 'deepseek' || savedEngine === 'webllm' || savedEngine === 'groq' || savedEngine === 'openrouter') ? savedEngine : engine;
    if (previousEngine === 'webllm' && state.engine !== 'webllm') releaseWebLLM();
    try {
      const d = JSON.parse(getLS(LS.dims) || 'null');
      if (d) { state.pageW = d.w; state.pageH = d.h; }
    } catch (_) {}
    try {
      const wm = getLS(LS.wllm);
      if (wm && WLLM_MODELS.some(x => x[0] === wm)) state.wllmModel = wm;
    } catch (_) {}

    $('welcome').classList.add('hidden');
    $('studio').classList.add('active');
    if (state.engine === 'groq') $('chatTitle').textContent = 'Conversation SP213 × Groq';
    else if (state.engine === 'openrouter') $('chatTitle').textContent = 'Conversation SP213 × OpenRouter';
    else if (state.engine === 'deepseek') $('chatTitle').textContent = 'Conversation SP213 × DeepSeek';
    else $('chatTitle').textContent = 'Conversation SP213 × WLLM (local)';
    if (state.engine === 'groq') {
      state.apiKey = getLS(LS.key) || '';
      state.model = getLS(LS.model) || GROQ_MODELS[0][0];
      $('modelLabel').textContent = state.model;
    } else if (state.engine === 'openrouter') {
      state.orApiKey = getLS(LS.orKey) || '';
      state.orModel = getLS(LS.orModel) || OPENROUTER_MODELS[0][0];
      const orName = (OPENROUTER_MODELS.find(x => x[0] === state.orModel) || [])[1] || state.orModel;
      $('modelLabel').textContent = String(orName).split(' — ')[0] || orName;
    } else if (state.engine === 'deepseek') {
      state.dsApiKey = getLS(LS.dsKey) || '';
      const _dsSaved = getLS(LS.dsModel);
      state.dsModel = (_dsSaved && DEEPSEEK_MODELS.some(x => x[0] === _dsSaved)) ? _dsSaved : DEEPSEEK_MODELS[0][0];
      const dsName = (DEEPSEEK_MODELS.find(x => x[0] === state.dsModel) || [])[1] || state.dsModel;
      $('modelLabel').textContent = String(dsName).split(' — ')[0] || dsName;
    } else {
      const wmName = (WLLM_MODELS.find(x => x[0] === state.wllmModel) || [])[1] || state.wllmModel;
      $('modelLabel').textContent = String(wmName).split(' — ')[0] || wmName;
    }

    //  Conversations multiples : charger l'index + la conversation active.
    initConversations();

    // Reprendre la session ou nouvelle
    let importedFromSP = false;
    const isFromSP = new URLSearchParams(window.location.search).get('from') === 'sp';
    if (isFromSP) {
      try {
        const raw = getLS('sp213_from_sp');
        if (raw) {
          localStorage.removeItem('sp213_from_sp');
          const spFile = JSON.parse(raw);
          importedFromSP = importFromSuperPrint(spFile);
          if (importedFromSP) appendChat('assistant', 'Layout imported from SuperPrint (' + state.doc.pages.length + ' page(s)). You can now refine it with SP213.');
          else appendChat('assistant', 'Unable to import the layout from SuperPrint.');
        }
      } catch (e) { console.warn('[SP213] import error:', e); }
    }
    if (!importedFromSP) {
      try {
        const chat = JSON.parse(getLS(convStorageKey(LS.chat)) || '[]');
        state.chat = Array.isArray(chat) ? chat : [];
      } catch (_) { state.chat = []; }
      // Toujours une page A4 vierge au démarrage (jamais l'ancienne maquette).
      newDocument();
      state.chat.forEach(m => appendChat(m.role, m.text, m.meta));
      // 🎯 Modèle local non pré-chargé : message d'accueil UNIQUEMENT si c'est
      // une nouvelle session (chat vide) — pas de doublon avec la restauration.
      if (state.engine === 'webllm' && !state.chat.some(m => m.role === 'user')) {
        appendChat('assistant', 'SP213 WLLM (local) is ready. Describe your layout; the model will load on the first request and then remain cached.');
      }
    } else {
      // Import depuis SuperPrint : la maquette est déjà chargée.
    }
    $('promptInput').focus();
  }

  let preferencesDraft = null;
  let preferencesEngine = null;

  function getPreferencesConfig(engine) {
    if (engine === 'groq') return { models: GROQ_MODELS, key: LS.key, model: LS.model, keyLabel: 'Groq API key', placeholder: 'gsk_...', hint: 'Cloud inference through Groq.' };
    if (engine === 'openrouter') return { models: OPENROUTER_MODELS, key: LS.orKey, model: LS.orModel, keyLabel: 'OpenRouter API key', placeholder: 'sk-or-...', hint: 'Cloud inference through OpenRouter.' };
    if (engine === 'webllm') return { models: WLLM_MODELS, key: null, model: LS.wllm, keyLabel: '', placeholder: '', hint: 'Runs locally with WebGPU. No API key is required.' };
    return { models: DEEPSEEK_MODELS, key: LS.dsKey, model: LS.dsModel, keyLabel: 'DeepSeek API key', placeholder: 'sk-...', hint: 'Cloud inference through DeepSeek.' };
  }

  function capturePreferencesForm() {
    if (!preferencesDraft || !preferencesEngine) return;
    const config = getPreferencesConfig(preferencesEngine);
    if (config.key) preferencesDraft.keys[preferencesEngine] = $('prefsApiKey').value.trim();
    preferencesDraft.models[preferencesEngine] = $('prefsModel').value;
  }

  function renderPreferencesEngine(engine) {
    preferencesEngine = engine;
    const config = getPreferencesConfig(engine);
    const keyField = $('prefsKeyField');
    keyField.classList.toggle('hidden', !config.key);
    $('prefsKeyLabel').textContent = config.keyLabel;
    $('prefsApiKey').placeholder = config.placeholder;
    $('prefsApiKey').value = config.key ? (preferencesDraft.keys[engine] || '') : '';
    $('prefsModel').innerHTML = '';
    config.models.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      $('prefsModel').appendChild(option);
    });
    const savedModel = preferencesDraft.models[engine];
    $('prefsModel').value = config.models.some(([value]) => value === savedModel) ? savedModel : config.models[0][0];
    $('prefsEngineHint').textContent = config.hint;
  }

  function openLocalSettings() {
    preferencesDraft = {
      keys: {
        deepseek: getLS(LS.dsKey) || state.dsApiKey || '',
        openrouter: getLS(LS.orKey) || state.orApiKey || '',
        groq: getLS(LS.key) || state.apiKey || ''
      },
      models: {
        deepseek: getLS(LS.dsModel) || state.dsModel,
        openrouter: getLS(LS.orModel) || state.orModel,
        groq: getLS(LS.model) || state.model,
        webllm: getLS(LS.wllm) || state.wllmModel
      }
    };
    $('prefsEngine').value = state.engine;
    $('prefsPageWidth').value = state.pendingDims ? state.pendingDims.w : state.pageW;
    $('prefsPageHeight').value = state.pendingDims ? state.pendingDims.h : state.pageH;
    renderPreferencesEngine(state.engine);
    $('localSettingsModal').classList.remove('hidden');
    $('prefsEngine').focus();
  }

  function closeLocalSettings() {
    $('localSettingsModal').classList.add('hidden');
    preferencesDraft = null;
    preferencesEngine = null;
    $('settingsBtn').focus();
  }

  function updateEngineHeader() {
    if (state.engine === 'groq') {
      $('chatTitle').textContent = 'Conversation SP213 × Groq';
      $('modelLabel').textContent = state.model;
    } else if (state.engine === 'openrouter') {
      $('chatTitle').textContent = 'Conversation SP213 × OpenRouter';
      const name = (OPENROUTER_MODELS.find(([value]) => value === state.orModel) || [null, state.orModel])[1];
      $('modelLabel').textContent = String(name).split(' — ')[0];
    } else if (state.engine === 'deepseek') {
      $('chatTitle').textContent = 'Conversation SP213 × DeepSeek';
      const name = (DEEPSEEK_MODELS.find(([value]) => value === state.dsModel) || [null, state.dsModel])[1];
      $('modelLabel').textContent = String(name).split(' — ')[0];
    } else {
      $('chatTitle').textContent = 'Conversation SP213 × WLLM (local)';
      const name = (WLLM_MODELS.find(([value]) => value === state.wllmModel) || [null, state.wllmModel])[1];
      $('modelLabel').textContent = String(name).split(' — ')[0];
    }
  }

  function saveLocalSettings() {
    capturePreferencesForm();
    const nextEngine = $('prefsEngine').value;
    const previousEngine = state.engine;
    state.dsApiKey = preferencesDraft.keys.deepseek;
    state.orApiKey = preferencesDraft.keys.openrouter;
    state.apiKey = preferencesDraft.keys.groq;
    state.dsModel = preferencesDraft.models.deepseek;
    state.orModel = preferencesDraft.models.openrouter;
    state.model = preferencesDraft.models.groq;
    state.wllmModel = preferencesDraft.models.webllm;
    state.engine = nextEngine;
    setLS(LS.dsKey, state.dsApiKey);
    setLS(LS.orKey, state.orApiKey);
    setLS(LS.key, state.apiKey);
    setLS(LS.dsModel, state.dsModel);
    setLS(LS.orModel, state.orModel);
    setLS(LS.model, state.model);
    setLS(LS.wllm, state.wllmModel);
    setLS(LS.engine, state.engine);
    const width = Math.round(Number($('prefsPageWidth').value));
    const height = Math.round(Number($('prefsPageHeight').value));
    if (width >= 20 && width <= 2000 && height >= 20 && height <= 2000) {
      state.pendingDims = { w: width, h: height };
      setLS(LS.dims, JSON.stringify(state.pendingDims));
    }
    if (previousEngine === 'webllm' && nextEngine !== 'webllm') releaseWebLLM();
    updateEngineHeader();
    closeLocalSettings();
  }

  // ── Conversations multiples (auto-save par conversation) ────
  function convStorageKey(base) { return base + '_' + (state.convActive || ''); }

  function initConversations() {
    try { state.convs = JSON.parse(getLS(LS.convs) || '[]') || []; }
    catch (_) { state.convs = []; }
    const active = getLS(LS.convActive) || null;
    if (active && state.convs.some(c => c.id === active)) {
      state.convActive = active;
    } else if (state.convs.length) {
      state.convActive = state.convs[0].id;
    } else {
      state.convActive = 'conv_' + Date.now();
      state.convs.push({ id: state.convActive, title: 'Conversation 1', updated: Date.now() });
      saveConvsIndex();
    }
    setLS(LS.convActive, state.convActive);
    renderConvTabs();
  }

  function saveConvsIndex() { setLS(LS.convs, JSON.stringify(state.convs.slice(-20))); }

  // 🗂️ Barre d'onglets : un onglet par conversation (scroll horizontal).
  function renderConvTabs() {
    const bar = $('convTabs');
    if (!bar) return;
    bar.innerHTML = '';
    const sorted = state.convs.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    sorted.forEach(c => {
      const tab = document.createElement('div');
      tab.className = 'conv-tab' + (c.id === state.convActive ? ' active' : '');
      tab.title = c.title + ' — double-click to rename';
      const label = document.createElement('span');
      label.className = 't-label';
      label.textContent = c.title || 'Conversation';
      tab.appendChild(label);
      const x = document.createElement('span');
      x.className = 't-x';
      x.textContent = '×';
      x.title = 'Delete';
      x.addEventListener('click', (e) => { e.stopPropagation(); deleteConversationById(c.id); });
      tab.appendChild(x);
      tab.addEventListener('click', () => switchConversation(c.id));
      tab.addEventListener('dblclick', () => renameConversation(c.id));
      bar.appendChild(tab);
    });
    const add = document.createElement('button');
    add.className = 'conv-add';
    add.title = 'New conversation';
    add.setAttribute('aria-label', 'New conversation');
    add.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    add.addEventListener('click', newConversation);
    bar.appendChild(add);
  }

  function renameConversation(id) {
    const conv = state.convs.find(c => c.id === id);
    if (!conv) return;
    const name = prompt('Conversation name:', conv.title || 'Conversation');
    if (name === null) return;
    const t = String(name).trim();
    if (!t) return;
    conv.title = t.length > 40 ? t.slice(0, 40) : t;
    saveConvsIndex();
    renderConvTabs();
  }

  function deleteConversationById(id) {
    if (state.convs.length <= 1) {
      appendChat('assistant', 'Unable to delete: at least one conversation is required.');
      return;
    }
    try { localStorage.removeItem(LS.chat + '_' + id); } catch (_) {}
    try { localStorage.removeItem(LS.doc + '_' + id); } catch (_) {}
    state.convs = state.convs.filter(c => c.id !== id);
    saveConvsIndex();
    if (id === state.convActive) {
      const next = state.convs.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
      state.convActive = next ? next.id : null;
      if (state.convActive) {
        setLS(LS.convActive, state.convActive);
        state.chat = [];
        state.doc = null;
        state.pages = [];
        $('chatLog').innerHTML = '';
        try {
          const chat = JSON.parse(getLS(LS.chat + '_' + state.convActive) || '[]');
          const doc = JSON.parse(getLS(LS.doc + '_' + state.convActive) || 'null');
          state.chat = Array.isArray(chat) ? chat : [];
          if (doc && doc.w === state.pageW && doc.h === state.pageH) state.doc = doc;
        } catch (_) { state.chat = []; }
        if (state.doc) {
          renderDocument(state.doc);
          state.chat.forEach(m => appendChat(m.role, m.text, m.meta));
        } else {
          newDocument();
        }
      } else {
        newConversation();
      }
    }
    renderConvTabs();
    appendChat('assistant', 'Conversation deleted.');
  }

  function switchConversation(id) {
    if (id === state.convActive) return;
    saveCurrentConv();
    state.convActive = id;
    setLS(LS.convActive, id);
    state.chat = [];
    state.doc = null;
    state.pages = [];
    $('chatLog').innerHTML = '';
    try {
      const chat = JSON.parse(getLS(LS.chat + '_' + id) || '[]');
      const doc = JSON.parse(getLS(LS.doc + '_' + id) || 'null');
      state.chat = Array.isArray(chat) ? chat : [];
      if (doc && doc.w === state.pageW && doc.h === state.pageH) state.doc = doc;
    } catch (_) { state.chat = []; }
    renderConvTabs();
    if (state.doc) {
      renderDocument(state.doc);
      state.chat.forEach(m => appendChat(m.role, m.text, m.meta));
    } else {
      newDocument();
    }
  }

  function newConversation() {
    saveCurrentConv();
    const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    state.convs.unshift({ id, title: 'Conversation ' + (state.convs.length + 1), updated: Date.now() });
    state.convActive = id;
    setLS(LS.convActive, id);
    saveConvsIndex();
    state.chat = [];
    state.doc = null;
    state.pages = [];
    $('chatLog').innerHTML = '';
    renderConvTabs();
    newDocument();
  }

  function saveCurrentConv() {
    try {
      const ck = LS.chat + '_' + (state.convActive || '');
      const dk = LS.doc + '_' + (state.convActive || '');
      setLS(ck, JSON.stringify(state.chat.slice(-40)));
      if (state.doc) setLS(dk, JSON.stringify(state.doc));
      const conv = state.convs.find(c => c.id === state.convActive);
      if (conv) {
        conv.updated = Date.now();
        const firstUser = state.chat.find(m => m.role === 'user');
        if (firstUser && firstUser.text) {
          const t = String(firstUser.text).replace(/\s+/g, ' ').trim();
          conv.title = t.length > 28 ? t.slice(0, 28) + '…' : t;
        }
        saveConvsIndex();
        renderConvTabs();
      }
    } catch (_) {}
  }

  // 🗑️ Supprime la conversation active (utilisée par l'ancien bouton, gardée
  // pour compatibilité — désormais le × de l'onglet appelle deleteConversationById).
  function deleteConversation() {
    if (state.convActive) deleteConversationById(state.convActive);
  }

  // 🗑️ Supprime une page du document courant.
  function deletePage(pageIndex) {
    if (!state.doc || !state.doc.pages) return;
    if (state.doc.pages.length <= 1) {
      appendChat('assistant', 'Unable to delete: the document must keep at least one page.');
      return;
    }
    const before = state.doc.pages.length;
    state.doc.pages = state.doc.pages.filter(p => p.pageIndex !== pageIndex);
    state.doc.pages.forEach((p, i) => { p.pageIndex = i; });
    if (state.doc.pages.length === before) return;
    renderDocument(state.doc);
    persistDoc();
    appendChat('assistant', 'Page deleted (' + state.doc.pages.length + ' page(s) remaining).');
  }

  // ↩️ Annuler (Ctrl+Z)
  function undoMaquette() {
    if (!state.undoStack.length) { appendChat('assistant', 'Nothing to undo.'); return; }
    try {
      if (state.doc) state.redoStack.push(JSON.parse(JSON.stringify(state.doc)));
      state.doc = state.undoStack.pop();
      renderDocument(state.doc);
      persistDoc();
    } catch (e) { appendChat('assistant', 'Unable to undo.'); }
  }

  // ↪️ Rétablir (Ctrl+Shift+Z / Ctrl+Y)
  function redoMaquette() {
    if (!state.redoStack.length) { appendChat('assistant', 'Nothing to redo.'); return; }
    try {
      if (state.doc) state.undoStack.push(JSON.parse(JSON.stringify(state.doc)));
      state.doc = state.redoStack.pop();
      renderDocument(state.doc);
      persistDoc();
    } catch (e) { appendChat('assistant', 'Unable to redo.'); }
  }

  // Zoom : ajoute la valeur au select si absente (molette)
  function setZoomValue(nz) {
    const sel = $('zoomSelect');
    if (!sel) return;
    nz = Math.max(0.1, Math.min(5, Math.round(nz * 10) / 10));
    if (!Array.from(sel.options).some(o => parseFloat(o.value) === nz)) {
      const o = document.createElement('option');
      o.value = String(nz);
      o.textContent = Math.round(nz * 100) + '%';
      sel.appendChild(o);
    }
    sel.value = String(nz);
    applyZoom();
  }

  // ── Nouveau document / page vierge ──────────────────────────
  function newDocument() {
    if (state.pendingDims) {
      state.pageW = state.pendingDims.w;
      state.pageH = state.pendingDims.h;
      state.pendingDims = null;
    }
    state.doc = null;
    state.pages = [];
    $('pagesStack').innerHTML = '';
    $('formatInfo') && ($('formatInfo').textContent = '');
    $('pageInfo').textContent = '';
    try { localStorage.removeItem(convStorageKey(LS.doc)); } catch (_) {}
    renderBlankPage();
    appendChat('assistant', 'New blank document. Describe the layout you want.', { pages: 0 });
  }

  function renderBlankPage() {
    const stack = $('pagesStack');
    stack.innerHTML = '';
    state.pages = [];
    const bleedPx = mmToPx(state.bleed || 3);
    const pageWpx = mmToPx(state.pageW);
    const pageHpx = mmToPx(state.pageH);
    const effWpx = (state.viewMode === 'spread') ? pageWpx * 2 : pageWpx;

    const card = document.createElement('div');
    card.className = 'page-card';
    const label = document.createElement('div');
    label.className = 'page-label';
    label.textContent = (state.viewMode === 'spread') ? 'Spread 1' : 'Page 1';
    card.appendChild(label);
    const wrap = document.createElement('div');
    wrap.className = 'page-canvas-wrap';
    const canvasEl = document.createElement('canvas');
    canvasEl.width = Math.round(effWpx + bleedPx * 2);
    canvasEl.height = Math.round(pageHpx + bleedPx * 2);
    wrap.appendChild(canvasEl);
    wrap.style.width = (canvasEl.width) + 'px';
    card.appendChild(wrap);
    stack.appendChild(card);

    const c = new fabric.Canvas(canvasEl, { backgroundColor: '#ffffff', selection: false, preserveObjectStacking: true, renderOnAddRemove: false });
    addGuides(c, effWpx, pageHpx, bleedPx);
    c.requestRenderAll();
    state.pages.push({ pageIndex: 0, canvas: c, label: 'Page 1', blank: true });
    $('pageInfo').textContent = '1 page · ' + state.pageW + '×' + state.pageH + ' mm' + (state.viewMode === 'spread' ? ' (spread)' : '') + ' · bleed ' + (state.bleed || 3) + ' mm';
    $('formatInfo') && ($('formatInfo').textContent = '');
  }

  function addGuides(c, pageWpx, pageHpx, bleedPx) {
    const trimBox = new fabric.Rect({ left: bleedPx, top: bleedPx, width: pageWpx, height: pageHpx, fill: 'transparent', stroke: '#2a2a2a', strokeWidth: 2, selectable: false, evented: false, hoverCursor: 'default', hasControls: false, hasBorders: false, lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true, lockScaling: true, excludeFromExport: true, isTrimBox: true });
    const bleedIndicator = new fabric.Rect({ left: 0, top: 0, width: pageWpx + bleedPx * 2, height: pageHpx + bleedPx * 2, fill: 'transparent', stroke: '#cccccc', strokeWidth: 1, strokeDashArray: [5, 5], selectable: false, evented: false, hoverCursor: 'default', hasControls: false, hasBorders: false, lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true, lockScaling: true, excludeFromExport: true, isBleed: true });
    const marginPx = mmToPx(15);
    const marginRect = new fabric.Rect({ left: bleedPx + marginPx, top: bleedPx + marginPx, width: Math.max(0, pageWpx - marginPx * 2), height: Math.max(0, pageHpx - marginPx * 2), fill: 'transparent', stroke: '#ff0000', strokeWidth: 0.5, strokeDashArray: [5, 5], selectable: false, evented: false, hoverCursor: 'default', hasControls: false, hasBorders: false, lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true, lockScaling: true, excludeFromExport: true, isMargin: true });
    [trimBox, bleedIndicator, marginRect].forEach(g => { if (!state.guidesVisible) g.visible = false; c.add(g); });
    try { c.bringToFront(bleedIndicator); c.bringToFront(marginRect); c.bringToFront(trimBox); } catch (_) {}
  }

  // ── Grille & repères à la demande (comme dans l'app SuperPrint) ──
  // Guides NON imprimables (excludeFromExport), DÉPLAÇABLES, supprimables.
  function detectGridSpec(prompt) {
    if (!prompt) return null;
    const p = String(prompt).toLowerCase();
    const wantsGrid = /\b(grille|grid|colonnes?|columns?|baseline|rep[eè]res?|guides?|mise en page|colonne)\b/.test(p);
    if (!wantsGrid) return null;
    let cols = 12, rows = 0, gutter = 4, baseline = false;
    const colMatch = p.match(/(?:grille\s+)?(\d{1,2})\s*colonnes?/);
    if (colMatch) cols = Math.max(1, Math.min(24, parseInt(colMatch[1], 10)));
    else {
      const gridMatch = p.match(/(\d{1,2})\s*[x×]\s*(\d{1,2})/);
      if (gridMatch) { cols = Math.max(1, Math.min(24, parseInt(gridMatch[1], 10))); rows = Math.max(1, Math.min(24, parseInt(gridMatch[2], 10))); }
    }
    const rowMatch = p.match(/(?:grille\s+)?(\d{1,2})\s*lignes?/);
    if (rowMatch) rows = Math.max(1, Math.min(24, parseInt(rowMatch[1], 10)));
    if (/\bbaseline\b/.test(p) || /\bligne de base\b/.test(p)) baseline = true;
    const gutMatch = p.match(/(?:goutti[eè]re|gutter)\s*[: ]?\s*(\d{1,2})/);
    if (gutMatch) gutter = Math.max(0, Math.min(30, parseInt(gutMatch[1], 10)));
    return { cols, rows, gutter, baseline, color: '#2bb7ff', fullPage: /\bpleine page\b|full ?page/.test(p) };
  }

  // 🆕 2026-08-30 : détecte le FORMAT DE PAGE demandé dans le prompt (A4, A5, A3, A6,
  // carte, flyer DL, format libre "L×H mm"…) et l'applique au canvas AVANT la génération,
  // pour que l'IA reçoive le bon format (buildSystemPrompt lit state.pageW/pageH) et que
  // la preview soit au bon format. Formats ISO 216 (série A) + courants du print.
  const PAGE_FORMATS = {
    'a0': [841, 1189], 'a1': [594, 841], 'a2': [420, 594], 'a3': [297, 420],
    'a4': [210, 297], 'a5': [148, 210], 'a6': [105, 148], 'a7': [74, 105], 'a8': [52, 74],
    'carte de visite': [85, 55], 'carte': [85, 55], 'carte visite': [85, 55], 'business card': [85, 55],
    'flyer': [99, 210], 'dépliant': [99, 210], 'dl': [99, 210], 'affiche a4': [210, 297],
    'poster a4': [210, 297], 'poster a3': [297, 420], 'poster a2': [420, 594],
    'brochure a5': [148, 210], 'livret a5': [148, 210], 'carnet': [148, 210],
    'a5 paysage': [210, 148], 'a4 paysage': [297, 210], 'a3 paysage': [420, 297],
    'a5 portrait': [148, 210], 'a4 portrait': [210, 297]
  };
  function detectPageFormat(prompt) {
    if (!prompt) return null;
    const p = String(prompt).toLowerCase();
    // 1) Format libre explicite "L×H mm" / "LxH mm" / "largeur X hauteur Y mm"
    const mmMatch = p.match(/(\d{2,4})\s*[x×]\s*(\d{2,4})\s*(?:mm|cm|centim)/i) ||
                    p.match(/(\d{2,4})\s*mm\s*[x×]\s*(\d{2,4})\s*mm/i);
    if (mmMatch) {
      let w = parseInt(mmMatch[1], 10), h = parseInt(mmMatch[2], 10);
      // Si l'unité est cm, convertir en mm (×10)
      if (/\bcm\b|centim/i.test(p)) { w *= 10; h *= 10; }
      if (w >= 20 && w <= 2000 && h >= 20 && h <= 2000) return { w, h, label: w + '×' + h + ' mm' };
    }
    // 2) Formats ISO / courants (mots-clés)
    for (const key of Object.keys(PAGE_FORMATS)) {
      // Ordre de longueur décroissante pour matcher "carte de visite" avant "carte"
      const sorted = Object.keys(PAGE_FORMATS).sort((a, b) => b.length - a.length);
      for (const k of sorted) {
        if (new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(p)) {
          const [w, h] = PAGE_FORMATS[k];
          return { w, h, label: k.toUpperCase() + ' (' + w + '×' + h + ' mm)' };
        }
      }
    }
    // 3) "format A4" / "en A5" sans le mot page
    const aMatch = p.match(/\ba([0-8])\b/);
    if (aMatch && /format|en |au |taille|grandeur/.test(p)) {
      const key = 'a' + aMatch[1];
      if (PAGE_FORMATS[key]) {
        const [w, h] = PAGE_FORMATS[key];
        return { w, h, label: key.toUpperCase() + ' (' + w + '×' + h + ' mm)' };
      }
    }
    return null;
  }

  // Applique un format détecté : met à jour le canvas + le prompt (via state.pageW/H).
  // Retourne true si un changement a été appliqué (≠ format courant).
  function applyDetectedPageFormat(prompt) {
    const fmt = detectPageFormat(prompt);
    if (!fmt) return false;
    const curW = state.pageW || 210, curH = state.pageH || 297;
    if (curW === fmt.w && curH === fmt.h) return false;
    // 🛡️ Orienter selon "paysage" si le format a une variante paysage (hauteur < largeur)
    let w = fmt.w, h = fmt.h;
    if (/paysage|landscape|horizontal/.test(prompt) && w < h) { const t = w; w = h; h = t; }
    state.pageW = w; state.pageH = h;
    try { setLS(LS.dims, JSON.stringify({ w, h })); } catch (_) {}
    // Re-rendre une page vierge au bon format (la maquette courante est remplacée).
    newDocument();
    // Mettre à jour le titre de la page courante si possible
    try {
      const ph = $('pageInfo');
      if (ph) ph.textContent = '1 page · ' + w + '×' + h + ' mm · bleed ' + (state.bleed || 3) + ' mm';
    } catch (_) {}
    appendChat('assistant', 'Format detected: ' + fmt.label + '. The canvas is now ' + w + ' x ' + h + ' mm. I will generate the layout at this size.');
    state.chat.push({ role: 'assistant', text: 'Format detected: ' + fmt.label + '. Canvas size: ' + w + ' x ' + h + ' mm.' });
    return true;
  }

  function addGuideLine(c, points, opts) {
    const line = new fabric.Line(points, Object.assign({
      stroke: '#2bb7ff', strokeWidth: 0.5, strokeDashArray: [3, 3], opacity: 0.55,
      selectable: true, evented: true, hasControls: false, hasBorders: false,
      hoverCursor: 'move', lockRotation: true, lockScalingX: true, lockScalingY: true,
      excludeFromExport: true
    }, opts));
    c.add(line);
    return line;
  }

  function applyGridToCanvas(c, pageWpx, pageHpx, bleedPx, spec) {
    if (!c || !spec) return;
    c.getObjects().filter(o => o.isGridGuide || o.isBaselineGuide).forEach(o => { try { c.remove(o); } catch (_) {} });
    const inset = spec.fullPage ? 0 : mmToPx(15);
    const x0 = bleedPx + inset, y0 = bleedPx + inset;
    const w = Math.max(0, pageWpx - inset * 2), h = Math.max(0, pageHpx - inset * 2);
    const colGut = mmToPx(spec.gutter);
    const colW = spec.cols > 0 ? (w - (spec.cols - 1) * colGut) / spec.cols : 0;
    if (colW > 0) {
      for (let i = 0; i <= spec.cols; i++) {
        const x = x0 + i * (colW + colGut);
        addGuideLine(c, [x, y0, x, y0 + h], { isGridGuide: true });
      }
    }
    if (spec.rows > 0) {
      const rowGut = colGut;
      const rowH = (h - (spec.rows - 1) * rowGut) / spec.rows;
      for (let i = 0; i <= spec.rows; i++) {
        const y = y0 + i * (rowH + rowGut);
        addGuideLine(c, [x0, y, x0 + w, y], { isGridGuide: true });
      }
    }
    if (spec.baseline) {
      const step = mmToPx(4);
      for (let y = y0; y <= y0 + h; y += step) {
        addGuideLine(c, [x0, y, x0 + w, y], { stroke: '#9b6bff', opacity: 0.35, strokeWidth: 0.4, strokeDashArray: [2, 3], isBaselineGuide: true });
      }
    }
    try { c.requestRenderAll(); } catch (_) {}
  }

  function applyGridToAllPages(spec) {
    if (!spec) return;
    state.pages.forEach(p => {
      if (p.canvas) {
        const bleedPx = mmToPx(state.doc ? (state.doc.bleed || 3) : 3);
        const pageWpx = mmToPx(state.doc ? state.doc.w : state.pageW || 210);
        const pageHpx = mmToPx(state.doc ? state.doc.h : state.pageH || 297);
        applyGridToCanvas(p.canvas, pageWpx, pageHpx, bleedPx, spec);
      }
    });
  }

  function toggleGridVisibility() {
    state.gridVisible = !state.gridVisible;
    state.pages.forEach(p => {
      if (p.canvas) p.canvas.getObjects().forEach(o => {
        if (o.isGridGuide || o.isBaselineGuide) o.visible = state.gridVisible;
      });
      try { p.canvas.requestRenderAll(); } catch (_) {}
    });
    return state.gridVisible;
  }

  // ── Loader typo ─────────────────────────────────────────────
  const FONT_LOAD_HINTS = {
    'Bebas Neue': /bebas/i, 'Playfair Display': /playfair|display\s*fair|fair\s*display/i, 'Montserrat': /montserrat/i,
    'Poppins': /poppins/i, 'Open Sans': /open ?sans/i, 'IBM Plex Sans': /ibm plex sans/i,
    'Roboto': /roboto/i, 'Lato': /lato/i, 'Noto Sans JP': /noto|japonais|japanese/i,
    'IBM Plex Mono': /ibm plex mono/i, 'JetBrains Mono': /jetbrains? mono/i,
    'Fira Code': /fira code/i, 'Space Mono': /space mono/i, 'Inter': /inter/i,
    'Arial': /arial/i, 'Helvetica': /helvetica/i
  };
  function detectRequestedFonts(prompt) {
    if (!prompt) return [];
    const found = [];
    Object.keys(FONT_LOAD_HINTS).forEach(font => {
      const alias = (font === 'Inter' || font === 'Arial' || font === 'Helvetica') ? 'Open Sans' : font;
      if (FONT_LOAD_HINTS[font].test(prompt) && !found.includes(alias)) found.push(alias);
    });
    return found;
  }

  function loadFontsWithFeedback(fontNames) {
    if (!fontNames || !fontNames.length) return Promise.resolve([]);
    const unique = [...new Set(fontNames)];
    const loaderEl = document.createElement('div');
    loaderEl.className = 'msg assistant typo-loader-msg';
    const lb = document.createElement('div');
    lb.className = 'bubble typo-loader';
    lb.innerHTML = '<span class="typing"><span></span><span></span><span></span></span> <span class="typo-loader-label">Loading fonts: ' + unique.join(', ') + '…</span>';
    loaderEl.appendChild(lb);
    const log = $('chatLog');
    log.appendChild(loaderEl);
    log.scrollTop = log.scrollHeight;

    const jobs = unique.map(f => {
      const tryLoad = () => {
        if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
        return Promise.all([
          document.fonts.load('400 72px "' + f + '"', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
          document.fonts.load('700 72px "' + f + '"', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
          document.fonts.load('italic 400 72px "' + f + '"', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
        ]).catch(() => {});
      };
      return tryLoad().then(() => {
        try {
          const div = document.createElement('div');
          div.style.cssText = 'position:fixed;top:-9999px;visibility:hidden;font-size:72px;width:200px;';
          div.style.fontFamily = '"' + f + '", sans-serif';
          div.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          document.body.appendChild(div);
          void div.offsetHeight;
          document.body.removeChild(div);
        } catch (_) {}
        try {
          state.pages.forEach(p => { if (p.canvas && typeof p.canvas.requestRenderAll === 'function') p.canvas.requestRenderAll(); });
        } catch (_) {}
        return f;
      });
    });

    return Promise.all(jobs).then(loaded => {
      lb.innerHTML = 'Fonts loaded: ' + loaded.join(', ');
      setTimeout(() => { try { loaderEl.remove(); } catch (_) {} }, 1800);
      return loaded;
    });
  }

  function ensureMaquetteFonts(doc) {
    const used = [];
    (doc && doc.pages || []).forEach(p => {
      (p.elements || []).forEach(el => {
        if (el && el.fontFamily) {
          const fam = normalizeFontFamily(el.fontFamily) || 'Open Sans';
          if (!used.includes(fam)) used.push(fam);
        }
      });
    });
    if (used.length) loadFontsWithFeedback(used);
    return used;
  }

  // ── Chat ────────────────────────────────────────────────────
  // opts : { pages, rawJson (string|null), truncated (bool), collapsible (bool) }
  function appendChat(role, text, meta, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    el.appendChild(b);

    // 🧾 Si une maquette brute (JSON) est disponible, on propose des actions :
    // télécharger le .sp, replier/déplier le JSON. (Pas de bouton "Ouvrir dans
    // l'app" ici : le bouton "Ouvrir dans SuperPrint" existe déjà sous la preview.)
    if (opts.rawJson) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';

      // Code repliable — masqué PAR DÉFAUT (bouton "+ Afficher le code").
      const codeWrap = document.createElement('div');
      codeWrap.className = 'code-collapse collapsed';
      const codePre = document.createElement('pre');
      codePre.className = 'code-pre';
      codePre.textContent = opts.rawJson;
      codeWrap.appendChild(codePre);
      const toggle = document.createElement('button');
      toggle.className = 'btn btn-ghost btn-sm code-toggle';
      toggle.textContent = '+  Show code (' + opts.rawJson.length + ' characters)';
      toggle.addEventListener('click', () => {
        const collapsed = codeWrap.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '+  Show code (' + opts.rawJson.length + ' characters)' : '−  Hide code';
      });
      actions.appendChild(codeWrap);
      actions.appendChild(toggle);

      // Bouton Télécharger .sp
      const dl = document.createElement('button');
      dl.className = 'btn btn-sm';
      dl.innerHTML = '<svg class="ic ic-sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download .sp';
      dl.title = 'Download this layout as a SuperPrint-compatible .sp file';
      dl.addEventListener('click', () => downloadJSONasSP(opts.rawJson));
      actions.appendChild(dl);

      el.appendChild(actions);
    }

    if (meta) {
      const m = document.createElement('div');
      m.className = 'meta';
      if (meta.pages) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'Layout: ' + meta.pages + ' page' + (meta.pages > 1 ? 's' : '');
        m.appendChild(badge);
      }
      if (opts.truncated) {
        const warn = document.createElement('span');
        warn.className = 'badge badge-warn';
        warn.textContent = 'Truncated';
        m.appendChild(warn);
      }
      el.appendChild(m);
    }
    $('chatLog').appendChild(el);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    return el;
  }

  function normalizeSPFile(input) {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    const spFile = parsed && !parsed._sp && (parsed.pages || parsed.elements)
      ? buildSPFileFromParsed(parsed)
      : parsed;
    const format = spFile && spFile.document && spFile.document.format;
    const width = Number(format && format.width);
    const height = Number(format && format.height);
    const valid = spFile && spFile._sp && spFile._sp.format === 'SuperPrint Document'
      && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
      && Array.isArray(spFile.pages) && spFile.pages.length > 0
      && spFile.pages.every(page => page && Array.isArray(page.objects));
    if (!valid) throw new Error('Invalid SuperPrint document structure.');
    return spFile;
  }

  // ⬇ Télécharge une maquette IA au format natif .sp
  function downloadJSONasSP(jsonStr) {
    try {
      const spFile = normalizeSPFile(jsonStr);
      const blob = new Blob([JSON.stringify(spFile, null, 2)], { type: 'application/x-superprint+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const d = new Date();
      a.download = 'sp213-maquette-' + d.toISOString().slice(0, 10).replace(/-/g, '') + '.sp';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      appendChat('assistant', 'Download error: ' + (err && err.message ? err.message : err));
    }
  }

  // ↗ Ouvre une maquette brute (JSON de l'IA) dans SuperPrint
  function openJSONInApp(jsonStr) {
    try {
      const spFile = normalizeSPFile(jsonStr);
      openSuperPrintLocal(spFile);
    } catch (err) {
      appendChat('assistant', 'Unable to open in the app: ' + (err && err.message ? err.message : err));
    }
  }

  // Construit un fichier .sp complet depuis une maquette brute IA { pages | elements }
  function buildSPFileFromParsed(parsed) {
    const now = new Date();
    const pages = [];
    if (Array.isArray(parsed.pages)) {
      parsed.pages.forEach((p, i) => {
        const idx = (typeof p.pageIndex === 'number') ? p.pageIndex : (typeof p.page === 'number' ? p.page - 1 : i);
        const els = Array.isArray(p.elements) ? p.elements : (Array.isArray(p.content) ? p.content : []);
        pages.push({ index: idx, label: 'Page ' + (idx + 1), masterId: null, objects: elsToSPObjects(els) });
      });
    } else if (Array.isArray(parsed.elements)) {
      pages.push({ index: 0, label: 'Page 1', masterId: null, objects: elsToSPObjects(parsed.elements) });
    }
    if (!pages.length) return null;
    return {
      _sp: { format: 'SuperPrint Document', version: '1.0.0', engine: 'Fabric.js 5.3.0', created: now.toISOString(), modified: now.toISOString(), generator: 'SP213 Studio Local' },
      meta: { title: 'Maquette SP213', author: '', description: 'Généré par SP213 Studio Local', tags: ['sp213'], stats: { pages: pages.length, objects: pages.reduce((n, p) => n + p.objects.length, 0), textBlocks: 0, images: 0, shapes: 0, totalObjects: pages.reduce((n, p) => n + p.objects.length, 0) } },
      document: { format: { width: state.pageW, height: state.pageH, unit: 'mm', orientation: state.pageW > state.pageH ? 'landscape' : 'portrait' }, margin: 20, bleed: state.bleed, viewMode: (state.viewMode === 'spread' ? 'spread' : 'single'), colorMode: 'rgb' },
      resources: { fonts: [], colors: [] },
      textLinks: {}, guides: {}, masters: { templates: {}, assignments: {} },
      numbering: { enabled: false, startAt: 1, position: 'bottom-center', fontFamily: 'Open Sans', fontSize: 10, fontColor: '#333333', prefix: '', suffix: '', style: 'decimal', marginBottom: 15, marginSide: 20 },
      pages
    };
  }

  // Convertit les éléments IA (mm) en objets .sp (px) — même logique que buildSPFile
  function elsToSPObjects(elements) {
    const bleedPx = mmToPx(state.bleed || 3);
    const pageWpx = mmToPx(state.pageW);
    const pageHpx = mmToPx(state.pageH);
    const objects = [];
    elements.forEach(el => {
      const t = String(el.type || '').toLowerCase();
      const op = (el.opacity != null) ? el.opacity : 1;
      const fill = (el.fill && /^#/.test(el.fill)) ? el.fill : '#000000';
      const stroke = (el.stroke && /^#/.test(el.stroke)) ? el.stroke : null;
      const strokeW = (el.strokeWidth != null) ? el.strokeWidth * MM_TO_PX : 0;
      const isFullBleed = (t === 'rectangle' || t === 'rect') && (el.left <= 0 && el.top <= 0 && el.width >= state.pageW - 1 && el.height >= state.pageH - 1);
      let left = (el.left != null ? +el.left : 0) * MM_TO_PX + bleedPx;
      let top = (el.top != null ? +el.top : 0) * MM_TO_PX + bleedPx;
      let width = (+el.width || 50) * MM_TO_PX;
      let height = (+el.height || 50) * MM_TO_PX;
      if (isFullBleed) { left = 0; top = 0; width = pageWpx + bleedPx * 2; height = pageHpx + bleedPx * 2; }
      if (t === 'rectangle' || t === 'rect') {
        objects.push({ type: 'rect', left, top, width, height, fill, opacity: op, scaleX: 1, scaleY: 1, stroke: stroke || '', strokeWidth: strokeW, rx: (el.rx || 0) * MM_TO_PX, ry: (el.ry || 0) * MM_TO_PX });
      } else if (t === 'circle') {
        objects.push({ type: 'circle', left, top, radius: (+el.radius || 25) * MM_TO_PX, fill, opacity: op, scaleX: 1, scaleY: 1, stroke: stroke || '', strokeWidth: strokeW });
      } else if (t === 'ellipse') {
        objects.push({ type: 'ellipse', left, top, rx: (+el.rx || 30) * MM_TO_PX, ry: (+el.ry || 20) * MM_TO_PX, fill, opacity: op, scaleX: 1, scaleY: 1, stroke: stroke || '', strokeWidth: strokeW });
      } else if (t === 'triangle') {
        objects.push({ type: 'triangle', left, top, width, height, fill, opacity: op, scaleX: 1, scaleY: 1, stroke: stroke || '', strokeWidth: strokeW });
      } else if (t === 'line') {
        objects.push({ type: 'line', x1: (+el.x1 || 0) * MM_TO_PX + bleedPx, y1: (+el.y1 || 0) * MM_TO_PX + bleedPx, x2: (+el.x2 || 100) * MM_TO_PX + bleedPx, y2: (+el.y2 || 0) * MM_TO_PX + bleedPx, stroke: el.stroke || '#000000', strokeWidth: Math.max(1, (+el.strokeWidth || 1) * MM_TO_PX), opacity: op, scaleX: 1, scaleY: 1 });
      } else if (t === 'text' || t === 'textbox') {
        const famT = normalizeFontFamily(el.fontFamily) || 'Open Sans';
        // 🛡️ FIX 2026-08-30 : estimer la hauteur (sinon l'app verrouille _fixedHeight=0).
        const _fsPx2 = (+el.fontSize || 14) * PT_TO_PX;
        const _lh2 = el.lineHeight || 1.4;
        const _widthPx2 = (+el.width || 200) * MM_TO_PX;
        const _charW2 = _fsPx2 * 0.55;
        const _perLine2 = Math.max(1, Math.floor(_widthPx2 / _charW2));
        const _lines2 = Math.max(1, Math.ceil(String(el.text || '').length / _perLine2));
        const _heightPx2 = Math.max(_fsPx2, Math.round(_lines2 * _fsPx2 * _lh2));
        objects.push({ type: 'textbox', left, top, width: (+el.width || 200) * MM_TO_PX, height: _heightPx2, text: el.text || '', fontSize: _fsPx2, fill: (el.fill && /^#/.test(el.fill)) ? el.fill : '#000000', fontFamily: famT, fontWeight: el.fontWeight || 'normal', fontStyle: el.fontStyle || 'normal', textAlign: el.textAlign || 'left', lineHeight: _lh2, opacity: op, scaleX: 1, scaleY: 1 });
      } else if (t === 'image' && el.imageUrl) {
        objects.push({ type: 'image', left, top, width, height, opacity: op, scaleX: 1, scaleY: 1, _spAiImageUrl: el.imageUrl, _spAiImageScaleX: 1, _spAiImageScaleY: 1, fill: '#e8e8e8', stroke: 'transparent', strokeWidth: 0, rx: 2, ry: 2 });
      }
    });
    return objects;
  }

  function appendTyping() {
    const el = document.createElement('div');
    el.className = 'msg assistant generation-msg';
    const b = document.createElement('div');
    b.className = 'bubble';
    b.innerHTML = '<div class="generation-loader" role="status" aria-live="polite"><div class="generation-loader-head"><span class="generation-loader-title">SP213 is building your layout</span><span class="generation-loader-step">Analyzing the brief</span></div><div class="generation-loader-track" aria-hidden="true"><span></span></div><small class="generation-loader-note">Your current document remains available while format, hierarchy, typography and print safety are checked.</small></div>';
    el.appendChild(b);
    $('chatLog').appendChild(el);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    const step = b.querySelector('.generation-loader-step');
    const steps = ['Structuring pages', 'Composing the layout', 'Checking print constraints', 'Preparing the preview'];
    let stepIndex = 0;
    const timer = setInterval(() => {
      if (!el.isConnected) { clearInterval(timer); return; }
      step.textContent = steps[stepIndex++ % steps.length];
    }, 2200);
    return el;
  }

  function promptUpdatesCurrentDocument(text) {
    if (/\b(crée(?:r|z)?|création|create|design|génère|generate|make)\s+(?:une?|a|an)?\s*(?:nouveau|nouvelle|new|another|autre)\b|\b(nouveau|nouvelle|new|another)\s+(?:document|maquette|layout|design|brochure|affiche|poster|flyer|catalogue|catalog)\b/i.test(String(text || ''))) return false;
    if (state.selectedIds && state.selectedIds.length) return true;
    return /\b(modif(?:ie|ier|ication)?|change|replace|remplace|ajoute|add|supprime|remove|delete|retouche|corrige|update|mets? à jour|déplace|move|resize|agrand|réduis|couleur|color|police|font|typo|align|rends?|make it)\b/i.test(String(text || ''));
  }

  function protectCurrentDocumentForPrompt(text) {
    const hasLayout = !!(state.doc && state.doc.pages && state.doc.pages.some(page => Array.isArray(page.elements) && page.elements.length));
    if (!hasLayout || promptUpdatesCurrentDocument(text)) return false;
    newConversation();
    appendChat('assistant', 'New brief detected. The previous layout is preserved in its conversation tab; this request starts a new document.');
    return true;
  }

  // ── Pièces jointes ──────────────────────────────────────────
  function handleAttachFiles(files) {
    if (!files || !files.length) return;
    Array.from(files).forEach(f => addAttachment(f));
    $('attachInput').value = '';
  }

  function loadPdfLibrary() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/superprint/app/JS/pdf.min.js';
      script.onload = () => window.pdfjsLib ? resolve(window.pdfjsLib) : reject(new Error('PDF.js unavailable'));
      script.onerror = () => reject(new Error('PDF.js unavailable'));
      document.head.appendChild(script);
    });
  }

  async function extractPdfAttachment(file, id, ext) {
    const pdfjs = await loadPdfLibrary();
    pdfjs.GlobalWorkerOptions.workerSrc = '/superprint/app/JS/pdf.worker.min.js';
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        let text = '';
        content.items.forEach(item => {
          text += String(item.str || '');
          text += item.hasEOL ? '\n' : ' ';
        });
        pages.push('--- PDF PAGE ' + pageNumber + ' / ' + pdf.numPages + ' ---\n' + text.replace(/[ \t]+\n/g, '\n').trim());
        if (typeof page.cleanup === 'function') page.cleanup();
      }
    } finally {
      if (typeof pdf.destroy === 'function') await pdf.destroy();
    }
    state.attachments.push({ id, name: file.name, type: 'text', text: pages.join('\n\n'), ext, pdf: true, pageCount: pages.length });
    renderAttachBar();
  }

  async function extractExcelAttachment(file, id, ext) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheets = workbook.SheetNames.map(name => {
      const rows = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { FS: '\t', RS: '\n', blankrows: false });
      return '--- EXCEL SHEET: ' + name + ' ---\n' + rows.trim();
    });
    state.attachments.push({ id, name: file.name, type: 'text', text: sheets.join('\n\n'), ext, excel: true, sheetCount: sheets.length });
    renderAttachBar();
  }

  function addAttachment(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const id = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const imgExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'];
    const txtExts = ['txt', 'md', 'rtf', 'csv', 'html'];

    if (file.size > 20 * 1024 * 1024) {
      appendChat('assistant', 'File "' + file.name + '" ignored: larger than 20 MB.');
      renderAttachBar();
      return;
    }

    if (imgExts.includes(ext)) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          state.attachments.push({ id, name: file.name, type: 'image', dataURL: e.target.result, width: img.width, height: img.height, ext });
          renderAttachBar();
        };
        img.onerror = function () {
          state.attachments.push({ id, name: file.name, type: 'image', dataURL: e.target.result, width: 0, height: 0, ext });
          renderAttachBar();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } else if (txtExts.includes(ext)) {
      const reader = new FileReader();
      reader.onload = function (e) {
        state.attachments.push({ id, name: file.name, type: 'text', text: String(e.target.result), ext });
        renderAttachBar();
      };
      reader.readAsText(file);
    } else if (ext === 'pdf') {
      extractPdfAttachment(file, id, ext).catch(function (error) {
        appendChat('assistant', 'Unable to read PDF "' + file.name + '": ' + error.message);
      });
    } else if (ext === 'xls' || ext === 'xlsx') {
      extractExcelAttachment(file, id, ext).catch(function (error) {
        appendChat('assistant', 'Unable to read Excel file "' + file.name + '": ' + error.message);
      });
    } else if (ext === 'docx') {
      const reader = new FileReader();
      reader.onload = function (e) {
        const buf = e.target.result;
        const doExtract = function () {
          if (!window.mammoth) {
            state.attachments.push({ id, name: file.name, type: 'text', text: '(Word content unavailable: missing library)', ext });
            renderAttachBar();
            return;
          }
          window.mammoth.extractRawText({ arrayBuffer: buf }).then(function (res) {
            state.attachments.push({ id, name: file.name, type: 'text', text: res.value || '', ext, docx: true });
            renderAttachBar();
          }).catch(function () {
            state.attachments.push({ id, name: file.name, type: 'text', text: '(Word content could not be read)', ext });
            renderAttachBar();
          });
        };
        if (window.mammoth) doExtract();
        else {
          const s = document.createElement('script');
          s.src = 'js/mammoth.min.js';
          s.onload = doExtract;
          s.onerror = function () { state.attachments.push({ id, name: file.name, type: 'text', text: '(Word content unavailable: missing library)', ext }); renderAttachBar(); };
          document.head.appendChild(s);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === 'doc') {
      appendChat('assistant', 'File "' + file.name + '": legacy binary .doc files cannot be read. Convert it to .docx.');
      renderAttachBar();
    } else {
      appendChat('assistant', 'File "' + file.name + '" ignored: unsupported type. Accepted formats: images, TXT/MD/RTF/CSV/HTML, Word (.docx), Excel (.xls/.xlsx) and PDF.');
      renderAttachBar();
    }
  }

  function renderAttachBar() {
    const bar = $('attachBar');
    bar.innerHTML = '';
    if (!state.attachments.length) { bar.classList.remove('visible'); return; }
    bar.classList.add('visible');
    state.attachments.forEach((att, idx) => {
      const chip = document.createElement('span');
      chip.className = 'attach-chip';
      const icon = att.type === 'image'
        ? '<svg class="ic ic-sm" viewBox="0 0 24 24" style="color:var(--muted)"><rect x="3" y="3" width="18" height="18"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
        : '<svg class="ic ic-sm" viewBox="0 0 24 24" style="color:var(--muted)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
      let info = att.type === 'image' ? (att.width ? att.width + '×' + att.height + 'px' : 'img') : (att.ext || 'txt').toUpperCase();
      if (att.type === 'text') {
        const n = String(att.text || '').length;
        info += ' · ' + (n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : n) + ' car.';
      }
      chip.innerHTML = icon + '<span class="name">' + escapeHtml(att.name) + '</span><span class="type">' + info + '</span>';
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.innerHTML = '<svg class="ic ic-sm" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      rm.title = 'Retirer';
      rm.addEventListener('click', () => { state.attachments.splice(idx, 1); renderAttachBar(); });
      chip.appendChild(rm);
      bar.appendChild(chip);
    });
  }

  function attachmentTextLimit() {
    return (state.engine === 'groq' || state.engine === 'openrouter') ? 24000 : 12000;
  }

  function buildAttachmentContext() {
    if (!state.attachments.length) return '';
    const parts = [];
    const limit = attachmentTextLimit();
    state.attachments.forEach((att, i) => {
      if (att.type === 'image') {
        const dataUri = (att.dataURL && att.dataURL.length <= 1500) ? att.dataURL : '';
        parts.push('IMAGE ' + i + ' : "' + att.name + '"' + (att.width ? ' (' + att.width + '×' + att.height + 'px, ratio ' + (att.width / att.height).toFixed(2) + ')' : '') +
          '\nPour placer cette image, renvoie un objet {"type":"image", "imageIndex": ' + i + ', "left":…, "top":…, "width":…, "height":…}. Le studio réinjectera automatiquement la data URI. Ne copie JAMAIS la data URI elle-même dans ta réponse.' +
          (dataUri ? '\nData URI (courte) : ' + dataUri : ''));
      } else {
        const full = String(att.text || '');
        const truncated = full.length > limit;
        let body = full.slice(0, limit);
        if (truncated) body += '\n[… texte tronqué : ' + full.length + ' caractères au total. Si le passage cherché n\'est pas dans cet extrait, formulez une recherche par mots-clés et SP213 l\'analysera.]';
        parts.push('TEXTE ' + i + ' : "' + att.name + '"' + (truncated ? ' (LONG : ' + full.length + ' caractères)' : '') + '\n' + body);
      }
    });
    return '\n\n=== PIÈCES JOINTES UTILISATEUR ===\n' + parts.join('\n\n');
  }

  function searchInAttachments(query) {
    if (!query) return [];
    const keywords = query.toLowerCase()
      .replace(/[’']/g, "'")
      .split(/[^a-z0-9àâäéèêëîïôöùûüçœæ'-]+/i)
      .map(w => w.toLowerCase())
      .filter(w => w.length >= 4);
    if (!keywords.length) return [];
    const results = [];
    state.attachments.forEach((att, i) => {
      if (att.type !== 'text' || !att.text) return;
      const lower = att.text.toLowerCase();
      const hits = new Set();
      keywords.forEach(kw => {
        let idx = lower.indexOf(kw);
        while (idx !== -1) { hits.add(idx); idx = lower.indexOf(kw, idx + 1); }
      });
      if (!hits.size) return;
      const positions = [...hits].sort((a, b) => a - b);
      const passages = [];
      let cur = { start: positions[0], end: positions[0] };
      for (let k = 1; k < positions.length; k++) {
        if (positions[k] - cur.end <= 1200) { cur.end = positions[k]; }
        else { passages.push([cur.start, cur.end]); cur = { start: positions[k], end: positions[k] }; }
      }
      passages.push([cur.start, cur.end]);
      const ctx = passages.slice(0, 6).map(([s, e]) => {
        const from = Math.max(0, s - 250);
        const to = Math.min(att.text.length, e + 350);
        return (from > 0 ? '…' : '') + att.text.slice(from, to) + (to < att.text.length ? '…' : '');
      });
      results.push({ index: i, name: att.name, passages: ctx });
    });
    return results;
  }

  function summarizeAttachments() {
    const limit = attachmentTextLimit();
    const summaries = [];
    state.attachments.forEach((att, i) => {
      if (att.type !== 'text' || !att.text) return;
      const full = String(att.text);
      if (full.length <= limit) return;
      let open = full.slice(0, 2500);
      if (full.length > 2500) open += '\n[…]';
      const heads = [];
      const re = /^\s*((?:[0-9]+[.)\-]?\s*)+)?([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-Þ0-9'’\- ]{2,60})\s*[:\-]?\s*$/gm;
      let mm;
      const seen = new Set();
      while ((mm = re.exec(full)) !== null && heads.length < 30) {
        const h = (mm[1] || '') + mm[2].trim();
        const key = h.toLowerCase();
        if (seen.has(key) || h.length < 3) continue;
        seen.add(key);
        heads.push(h);
      }
      const headText = heads.length ? '\n\nTitres/sections repérés :\n' + heads.join('\n') : '';
      summaries.push({
        index: i, name: att.name, chars: full.length,
        text: 'DOCUMENT LONG — ' + full.length + ' caractères. Résumé automatique (ouvertures + titres) :\n\n' +
          'DÉBUT DU DOCUMENT :\n' + open + '\n' + headText +
          '\n\nIMPORTANT : l\'utilisateur cherche une information précise. Si elle est dans l\'ouverture ou les sections ci-dessus, réponds avec le contenu EXACT trouvé. Sinon, dis honnêtement que l\'information n\'est pas dans le document.'
      });
    });
    return summaries;
  }

  function hydrateUserImages(elements, attachments) {
    if (!Array.isArray(elements)) return elements;
    return elements.map(el => {
      if (el && (el.type === 'userImage' || el.type === 'image') && typeof el.imageIndex === 'number' && attachments[el.imageIndex]) {
        const att = attachments[el.imageIndex];
        let w = el.width, h = el.height;
        if ((!w || !h) && att.width && att.height) {
          const ratio = att.width / att.height;
          if (!w && h) w = Math.round(h * ratio * 10) / 10;
          else if (!h && w) h = Math.round(w / ratio * 10) / 10;
          else { w = 120; h = Math.round(120 / ratio * 10) / 10; }
        }
        return { type: 'image', left: el.left, top: el.top, width: w || 100, height: h || 100, imageUrl: att.dataURL || '', opacity: el.opacity != null ? el.opacity : 1 };
      }
      return el;
    });
  }

  function buildQuickChips() {
    const chips = [
      ['Minimalist poster', 'A4 portrait poster, minimalist style: oversized headline, one accent color and generous white space.'],
      ['Magazine cover', 'A4 magazine cover: bold masthead, full-bleed visual and cover lines near the bottom.'],
      ['4-product catalog', 'A4 catalog page: 2 x 2 product grid with image placeholders, names, descriptions and prices.'],
      ['Corporate report', 'A4 corporate report page: four KPI cards, restrained palette and fine rules.'],
      ['Restaurant menu', 'Elegant A4 restaurant menu: starters, mains and desserts with prices and refined typography.'],
      ['4-page brochure', 'Four-page A4 booklet: cover, editorial, two content pages and strict visual consistency.']
    ];
    const wrap = $('quickChips');
    chips.forEach(([label, prompt]) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = label;
      b.addEventListener('click', () => { $('promptInput').value = prompt; $('promptInput').focus(); });
      wrap.appendChild(b);
    });
  }

  // ── Import depuis SuperPrint ────────────────────────────────
  function importFromSuperPrint(spFile) {
    if (!spFile || !spFile.pages || !spFile.pages.length) return false;
    const docFmt = (spFile.document && spFile.document.format) || {};
    const w = Number(docFmt.width) || 210;
    const h = Number(docFmt.height) || 297;
    const bl = (spFile.document && typeof spFile.document.bleed === 'number') ? spFile.document.bleed : 3;
    const vMode = (spFile.document && spFile.document.viewMode === 'spread') ? 'spread' : 'single';
    const bleedPx = bl * MM_TO_PX;
    const toMm = (px) => Math.round((px - bleedPx) / MM_TO_PX * 10) / 10;

    const pages = spFile.pages.map((spPage, idx) => {
      const objects = (spPage.objects && Array.isArray(spPage.objects)) ? spPage.objects : [];
      const elements = objects.map(o => {
        if (!o || !o.type) return null;
        const t = String(o.type).toLowerCase();
        const base = { left: toMm(o.left || 0), top: toMm(o.top || 0) };
        if (o.opacity != null) base.opacity = o.opacity;
        if (o.fill && /^#/.test(o.fill)) base.fill = o.fill;
        if (o.stroke && /^#/.test(o.stroke)) { base.stroke = o.stroke; base.strokeWidth = Math.round(((o.strokeWidth || 0) / MM_TO_PX) * 10) / 10; }
        if (t === 'rect' || t === 'rectangle') {
          return Object.assign(base, { type: 'rectangle', width: Math.round(((o.width || 0) / MM_TO_PX) * 10) / 10, height: Math.round(((o.height || 0) / MM_TO_PX) * 10) / 10, rx: Math.round(((o.rx || 0) / MM_TO_PX) * 10) / 10, ry: Math.round(((o.ry || 0) / MM_TO_PX) * 10) / 10 });
        }
        if (t === 'circle') return Object.assign(base, { type: 'circle', radius: Math.round(((o.radius || 0) / MM_TO_PX) * 10) / 10 });
        if (t === 'ellipse') return Object.assign(base, { type: 'ellipse', rx: Math.round(((o.rx || 0) / MM_TO_PX) * 10) / 10, ry: Math.round(((o.ry || 0) / MM_TO_PX) * 10) / 10 });
        if (t === 'triangle') return Object.assign(base, { type: 'triangle', width: Math.round(((o.width || 0) / MM_TO_PX) * 10) / 10, height: Math.round(((o.height || 0) / MM_TO_PX) * 10) / 10 });
        if (t === 'line') {
          return { type: 'line', x1: toMm(o.x1 || 0), y1: toMm(o.y1 || 0), x2: toMm(o.x2 || 0), y2: toMm(o.y2 || 0), stroke: (o.stroke && /^#/.test(o.stroke)) ? o.stroke : '#000000', strokeWidth: Math.max(0.5, Math.round(((o.strokeWidth || 1) / MM_TO_PX) * 10) / 10), opacity: o.opacity != null ? o.opacity : 1 };
        }
        if (t === 'textbox' || t === 'text' || t === 'i-text') {
          const el = Object.assign({}, base, { type: 'text', text: o.text || '', width: Math.round(((o.width || 200) / MM_TO_PX) * 10) / 10, fontSize: Math.round((o.fontSize || 14) / PT_TO_PX * 10) / 10, fontFamily: o.fontFamily || 'Open Sans' });
          if (o.fontWeight) el.fontWeight = o.fontWeight;
          if (o.fontStyle) el.fontStyle = o.fontStyle;
          if (o.textAlign) el.textAlign = o.textAlign;
          if (o.lineHeight) el.lineHeight = Math.round(o.lineHeight * 100) / 100;
          return el;
        }
        if (t === 'image' && (o._spAiImageUrl || o.src || o._sp213ImageUrl)) {
          return Object.assign(base, { type: 'image', width: Math.round(((o.width || 100) / MM_TO_PX) * 10) / 10, height: Math.round(((o.height || 100) / MM_TO_PX) * 10) / 10, imageUrl: o._spAiImageUrl || o._sp213ImageUrl || o.src || '' });
        }
        return null;
      }).filter(Boolean);
      return { pageIndex: idx, elements };
    }).filter(p => p.elements.length > 0);

    if (!pages.length) return false;
    state.pageW = w; state.pageH = h; state.bleed = bl; state.viewMode = vMode;
    state.doc = { w, h, effW: vMode === 'spread' ? w * 2 : w, viewMode: vMode, bleed: bl, pages };
    setLS(LS.dims, JSON.stringify({ w, h }));
    setLS(LS.doc, JSON.stringify(state.doc));
    return true;
  }

  // ── System prompt ───────────────────────────────────────────
  const SP213_LAYOUT_SYSTEM = `QUAND SP213 EST ACTIF, CES RÈGLES PRIMENT. Tu es SP213, maître du print et de l'édition.

═══════════════════════════════════════════
0. QU'EST-CE QUE SUPERPRINT ? (contexte applicatif)
═══════════════════════════════════════════
• SuperPrint est un logiciel de PAO (Publication Assistée par Ordinateur) 100% en navigateur,
  comparable à InDesign. Il s'articule en 2 modules :
  1) L'ÉDITEUR SuperPrint : un canvas professionnel (moteur Fabric.js) où l'utilisateur dispose
     de pages, calques, textes, formes, images, repères, fonds perdus, et exporte en PDF.
  2) LE STUDIO SP213 (TOI) : un générateur de maquettes par IA. L'utilisateur décrit sa maquette
     en langage naturel, et tu produis un JSON STRUCTURÉ que le studio transforme en canvas.
• Ton rôle : transformer la description en une maquette RÉELLE et IMPRIMABLE, pas en une suggestion.
• Le format d'échange est le JSON. Ce JSON est ensuite : (a) dessiné dans l'aperçu du studio,
  (b) convertible en fichier .sp (format natif SuperPrint, un ZIP+JSON), (c) importable dans
  l'éditeur SuperPrint pour retouche manuelle.
• Chaque "text" devient une Textbox Fabric (texte éditable, césure, retour à la ligne automatique).
  Chaque "rectangle"/"circle"/"ellipse"/"triangle"/"line"/"star" devient un objet vectoriel Fabric.
• Les polices DISPONIBLES dans SuperPrint (tu DOIS t'y limiter) :
  Display/titres : Bebas Neue, Playfair Display, Montserrat, Poppins.
  Corps : Open Sans, IBM Plex Sans, Roboto, Lato. Mono : IBM Plex Mono, JetBrains Mono, Fira Code, Space Mono.
• L'aperçu du studio reflète EXACTEMENT ce que tu renvoies : une coordonnée fausse, un débord,
  ou une police inconnue = une maquette cassée à l'écran. Sois précis au millimètre.

═══════════════════════════════════════════
A. NATURE DU MÉDIUM — IMPRESSION PAPIER
═══════════════════════════════════════════
• Tu travailles sur du PAPIER, pas du web : chaque page a un FORMAT FERMÉ et FINI.
• Il n'y a NI scroll, NI défilement, NI expansion verticale. Ce qui dépasse est COUPÉ par le massicot.
• Les pages sont des entités SÉPARÉES : le contenu ne "coule" pas d'une page à l'autre tout seul —
  si un texte ne tient pas, tu le RACCOURCIS ou tu passes DÉLIBÉRÉMENT à la page suivante.
• La typographie doit RESPIRER : interligne 1.3-1.6, marges 15 mm min, corps 9-12 pt.
• Tu raisonnes en COMPOSITION FERMÉE : équilibre des masses, pleins/vides, hiérarchie verticale
  qui se lit du haut vers le bas et se termine AVANT le bas de page.
• Le texte dans les 5 mm du bord = risque de massicot. JAMAIS de texte dans le fond perdu.

═══════════════════════════════════════════
B. FORMATS & LIMITES DU DOCUMENT
═══════════════════════════════════════════
• Format courant : largeur × hauteur en mm (ex. A4 = 210×297, A5 = 148×210, A3 = 297×420,
  A6 = 105×148, carte 85×55, flyer DL = 99×210, format libre).
• Orientation : portrait (hauteur > largeur) ou paysage (largeur > hauteur).
• Zone visible imprimée : de 0 à LARGEUR mm en x, de 0 à HAUTEUR mm en y.
• Zone sûre (marge typo 15 mm) : texte lisible entre 15 mm et (LARGEUR-15) / (HAUTEUR-15).
• Fonds perdus (bleed) : 3 mm standard, RÉSERVÉS aux fonds, photos pleine page et formes
  décoratives (coordonnées de -3 à LARGEUR+3). JAMAIS de texte dedans.
• RÈGLE ABSOLUE : top + height ≤ HAUTEUR + 3 ET left + width ≤ LARGEUR + 3. Sinon, raccourcis,
  réduis la typo, ou passe à la page suivante. JAMAIS de bloc qui déborde.

═══════════════════════════════════════════
C. MODES D'AFFICHAGE
═══════════════════════════════════════════
• PAGE SIMPLE : une page unique fermée. Utilise le FORMAT A (clé "elements").
• DOUBLE PAGE (spread) : deux pages côte à côte qui se LISENT ENSEMBLE.
  - La GOUTTIÈRE (reliure) est au CENTRE : largeur sécurisée = 8 à 15 mm de chaque côté du pli.
  - Aucun texte crucial ne doit tomber dans la gouttière.
  - Le texte ne TRAVERSE JAMAIS la gouttière : coupe les paragraphes en 2 blocs indépendants.
  - Les éléments décoratifs PEUVENT traverser (filet, dégradé, fond de couleur).
  - Tu raisonnes en COORDONNÉES PAGE : (0,0) = haut-gauche de CHAQUE page.
  - Largeur totale utile d'une double page = LARGEUR × 2.

═══════════════════════════════════════════
D. MULTIPAGE — LIVRE, MAGAZINE, CATALOGUE, BROCHURE
═══════════════════════════════════════════
• MULTI-PAGES = OBLIGATOIRE avec le FORMAT B : { "targetPages": N, "pages": [ { "pageIndex": i, "elements": [...] }, ... ] }.
  - pageIndex est 0-based (page 1 = pageIndex 0). TU DOIS produire TOUTES les pages demandées.
  - Chaque page : 8 à 20 éléments minimum (titres, textes longs, formes, images, légendes).
  - JAMAIS de "Lorem ipsum" ni de "[ À GÉNÉRER ]" : du VRAI contenu éditorial sur chaque page.
• STRUCTURE D'UN OBJET RELIÉ : pagination (p.1 couverture, p.2 ours/sommaire, p.3-4 édito,
  intérieur, p.N-1 index/contacts, p.N 4e de couverture). RYTHME ÉDITORIAL : alternance pages
  denses / aérées. COHÉRENCE GRAPHIQUE : même palette, mêmes familles, même grille.
• FOLIOS : en bas à 10-15 mm, alignés à l'extérieur ou centrés, 8-10 pt.
• MARGES D'UN LIVRE RELIÉ : intérieure 18-25 mm, extérieure 15-18, haut 15-20, bas 18-25.

═══════════════════════════════════════════
E. GRILLE & LISIBILITÉ PRINT
═══════════════════════════════════════════
• Avant d'écrire le moindre objet, DÉFINIS la grille : colonnes, gouttières, marges, baseline.
• A4 portrait : référence 12 colonnes, gouttière 4 mm, marges 15-18 mm.
• ALIGNE les blocs sur la grille : même colonne = même left, même rangée = même top.
• Largeur de ligne optimale : 60-75 caractères (~80-110 mm en corps 11 pt).
• HIÉRARCHIE TYPO PRINT : titre couverture 60-120 pt, titre intérieur 36-72 pt, sous-titre 18-28 pt,
  chapeau 14-18 pt, corps 9-12 pt (jamais < 8 pt), légende/folio 7-9 pt.
• Interligne : 1.2 titres, 1.4-1.6 corps, 1.6-1.8 textes longs.

═══════════════════════════════════════════
F. CONSTRUCTION DES ÉLÉMENTS (ordre = ordre des calques)
═══════════════════════════════════════════
• TOUJOURS du fond vers le texte : 1) fonds/bandeaux, 2) images/placeholders, 3) filets/formes,
  4) titres, 5) corps, 6) légendes/folios.
• Chaque "text" DOIT avoir : left, top, width, text, fontSize, fill, fontFamily.
• Estime la hauteur de texte : hauteur_mm ≈ lignes × fontSize(pt) × lineHeight × 0.353.
• Fond pleine page = rectangle left:-3, top:-3, width:LARGEUR+6, height:HAUTEUR+6.
• Un seul point focal par page.

═══════════════════════════════════════════
G. PIÈCES JOINTES (IMAGES & TEXTES)
═══════════════════════════════════════════
• IMAGES fournies (section PIÈCES JOINTES) : DÉCORTIQUE-les puis RÉINTÈGRE-les.
  - Lis le nom, les dimensions, la data URI fournie.
  - Place-les avec type "image" + "imageUrl" (data URI) + left/top/width/height en mm respectant leur ratio.
  - Toujours ajouter une LÉGENDE sous l'image. Ne déforme JAMAIS l'image.
  - Si la data URI est trop longue à recopier, renvoie "imageIndex": N (N = numéro de l'image
    dans la section PIÈCES JOINTES). Le studio réinjectera automatiquement la data URI.
• TEXTES fournis : utilise leur contenu comme base RÉELLE des paragraphes (jamais de Lorem).
  - Pour un long texte, si l'utilisateur cherche un passage précis, réponds avec le contenu EXACT trouvé.

═══════════════════════════════════════════
H. FIN DE PAGE & DISCIPLINE DE SORTIE
═══════════════════════════════════════════
• FIN DE PAGE : le bas du dernier bloc de chaque page doit être ≤ HAUTEUR - 10 mm.
  Si ça déborde : réduis la fontSize (≥ 8 pt), raccourcis, ou passe à la page suivante.
• Réponds UNIQUEMENT en JSON valide, aucun texte autour, aucun bloc markdown, aucune balise XML.
• Coordonnées en mm (1 décimale max). Négatif uniquement pour le fond perdu (-3 mm).
• En spread : coordonnées PAGE (0,0 = haut-gauche de chaque page), jamais de texte traversant la gouttière.

Tu restes TOUJOURS un modèle de RÉDACTION : de vrais contenus éditoriaux, jamais de Lorem ipsum.`;

  function buildSystemPrompt() {
    // Mode LOCAL (WLLM) : prompt court et ultra-contraint pour les modèles 3B-8B
    if (state.engine === 'webllm') {
      const p = state.lastPrompt || '';
      const mp = p.match(/(\d{1,3})\s*[- ]?\s*pages?/i);
      const isMulti = (mp && parseInt(mp[1], 10) > 1) || /\b(magazine|catalogue|catalog|livre|brochure|booklet|livret|book|journal)\b/i.test(p);
      const isSpread = state.viewMode === 'spread';
      const spreadNote = isSpread ? `Double page (spread) : largeur totale ${state.pageW * 2} mm, deux pages côte à côte, gouttière au centre à ${state.pageW} mm. Ne fais jamais traverser un texte sur la gouttière.` : `Page simple : format ${state.pageW} × ${state.pageH} mm.`;
      if (isMulti) {
        return `Tu es SP213, un générateur de maquettes print MULTI-PAGES pour SuperPrint.
Réponds UNIQUEMENT par un JSON valide, sans texte autour, sans markdown, sans balises XML.
${spreadNote}
Coordonnées en mm, fontSize en pt, couleurs #RRGGBB. Chaque page : 8 à 15 éléments, pas de débord bas de page (top + hauteur ≤ ${state.pageH} mm).
Types d'objets : rectangle (left,top,width,height,fill), text (left,top,width,text,fontSize,fill,fontFamily), circle (left,top,radius,fill), line (x1,y1,x2,y2,stroke).

EXEMPLE MULTI-PAGES À IMITER (structure exacte) :
{"targetPages":${mp ? parseInt(mp[1], 10) : 4},"pages":[
 {"pageIndex":0,"elements":[{"type":"rectangle","left":0,"top":0,"width":${state.pageW},"height":${state.pageH},"fill":"#0F172A"},{"type":"text","left":15,"top":20,"width":180,"text":"TITRE","fontSize":60,"fill":"#FFFFFF","fontFamily":"Bebas Neue"}]},
 {"pageIndex":1,"elements":[{"type":"text","left":15,"top":20,"width":180,"text":"ÉDITO","fontSize":36,"fill":"#0F172A","fontFamily":"Bebas Neue"},{"type":"text","left":15,"top":60,"width":180,"text":"Texte éditorial complet...","fontSize":11,"fill":"#475569","fontFamily":"Open Sans"}]}
]}
Génère le JSON pour ${mp ? parseInt(mp[1], 10) : 'le nombre de pages demandé'} pages, une entrée "pages" par page : `;
      }
      return `Tu es SP213, un générateur de maquettes print pour le logiciel SuperPrint.
Réponds UNIQUEMENT par un JSON valide, sans texte autour, sans markdown, sans balises XML.

${spreadNote}
Coordonnées en mm, fontSize en pt, couleurs #RRGGBB.
Une page doit contenir 8 à 15 éléments. Ne dépasse jamais le bas de page (top + hauteur ≤ ${state.pageH} mm).

Types d'objets autorisés : rectangle (left,top,width,height,fill), text (left,top,width,text,fontSize,fill,fontFamily), circle (left,top,radius,fill), line (x1,y1,x2,y2,stroke).

EXEMPLE À IMITER (structure exacte) :
{"elements":[
 {"type":"rectangle","left":0,"top":0,"width":${state.pageW},"height":${state.pageH},"fill":"#0F172A"},
 {"type":"text","left":15,"top":20,"width":180,"text":"TITRE","fontSize":60,"fill":"#FFFFFF","fontFamily":"Bebas Neue"},
 {"type":"text","left":15,"top":120,"width":120,"text":"Sous-titre descriptif","fontSize":18,"fill":"#E2E8F0","fontFamily":"Open Sans"},
 {"type":"circle","left":170,"top":250,"radius":8,"fill":"#E11D48"}
]}
Génère le JSON pour cette demande : `;
    }
    // Mode GROQ : prompt complet expert
    return `Tu es SP213, le module LAYOUT & CANEVAS de SUPERPRINT (logiciel de PAO web, moteur Fabric.js 5.3).
Tu génères des maquettes PRINT destinées à l'IMPRESSION PAPIER — pas du web, pas de scroll.
${state.engine === 'openrouter' ? '\nTu es exécuté via OpenRouter (API OpenAI-compatible). Réponds UNIQUEMENT en JSON valide (format json_object), sans texte autour, sans markdown.' : ''}
${SP213_LAYOUT_SYSTEM}

DOCUMENT COURANT
• Format : ${state.pageW} × ${state.pageH} mm, orientation ${state.pageW > state.pageH ? 'paysage' : 'portrait'}
• Mode d'affichage : ${state.viewMode === 'spread' ? 'DOUBLE PAGE (spread) — largeur totale ' + (state.pageW * 2) + ' mm, deux pages côte à côte, gouttière au centre à ' + state.pageW + ' mm. Aucun texte ne doit traverser la gouttière.' : 'PAGE SIMPLE — une page unique fermée.'}
• Zone sûre : 15 mm des bords pour le texte lisible
• Fonds perdus : 3 mm (uniquement pour fonds / photos pleine page / formes décoratives).
  🔴 Fond pleine page = rectangle left:-3, top:-3, width:(largeur+6), height:(hauteur+6).
  Ex. A4 ${state.pageW}×${state.pageH} → left:-3, top:-3, width:${state.pageW + 6}, height:${state.pageH + 6}.
  JAMAIS left:0/top:0 (laisserait 3 mm de blanc au bord après coupe).
• Toutes les coordonnées en MILLIMÈTRES (mm). fontSize en POINTS (pt). Couleurs #RRGGBB.

PIÈCES JOINTES
• Images : si l'utilisateur fournit des images (section PIÈCES JOINTES), place-les avec le type "image"
  et le champ "imageUrl" contenant la data URI fournie. Respecte leurs proportions.
  - Si la data URI est trop longue, renvoie "imageIndex": N. Le studio réinjectera la data URI.
• Textes joints : utilise leur contenu comme base réelle des paragraphes (jamais de Lorem ipsum).

POLICES DISPONIBLES :
• Display/titres : Bebas Neue, Playfair Display, Montserrat, Poppins
• Corps : Open Sans, IBM Plex Sans, Roboto, Lato
• Mono : IBM Plex Mono, JetBrains Mono, Fira Code, Space Mono

TYPES D'OBJETS (champ "type") :
• rectangle : left, top, width, height, fill, opacity, rx, ry, stroke, strokeWidth(mm)
• circle : left, top, radius, fill, opacity
• ellipse : left, top, rx, ry, fill, opacity
• triangle : left, top, width, height, fill, opacity
• line : x1, y1, x2, y2, stroke, strokeWidth(mm)
• star : left, top, radius, points, innerRadius, fill, opacity
• text : left, top, width, text, fontSize(pt), fill, fontFamily, fontWeight, fontStyle, textAlign, lineHeight, charSpacing, underline, linethrough, backgroundColor
• image : left, top, width, height, imageUrl (data URI), opacity

RÈGLES DE RÉDACTION : de VRAIS textes éditoriaux/marketing (jamais de Lorem ipsum).
Placeholders d'images = rectangles gris (#E2E8F0 ou #CBD5E1) avec légende.

FIN DE PAGE OBLIGATOIRE :
• Calcule la hauteur de chaque bloc texte : hauteur_mm ≈ lignes × fontSize × lineHeight × 0.353.
• Chaque page DOIT se terminer avec top + hauteur ≤ hauteur_page (idéalement ≤ hauteur_page - 10 mm).
• Si un texte déborde, réduis la taille de police (≥ 8 pt), raccourcis, ou passe à la page suivante.

${(function () {
      const p = state.lastPrompt || '';
      const mp = p.match(/(\d{1,3})\s*[- ]?\s*pages?/i);
      const isMulti = (mp && parseInt(mp[1], 10) > 1) || /\b(magazine|catalogue|catalog|livre|brochure|booklet|livret|book|journal)\b/i.test(p);
      if (isMulti) {
        const n = mp ? parseInt(mp[1], 10) : 0;
        return '🚨 MULTI-PAGES DÉTECTÉ : utilise le FORMAT B, produis ' + (n || 'le nombre demandé de') + ' entrées "pages" (une par page), contenu COMPLET sur chaque page, cohérence graphique stricte, folios en bas.';
      }
      return state.viewMode === 'spread'
        ? '🚨 DOUBLE PAGE DÉTECTÉE : utilise le FORMAT A ou B en raisonnant en coordonnées PAGE, ne fais JAMAIS traverser un texte sur la gouttière centrale.'
        : 'Document mono-page : utilise le FORMAT A, tout doit tenir sur cette unique page.';
    })()}

FORMAT DE SORTIE — Réponds UNIQUEMENT en JSON valide (pas de markdown) :
Pour UNE page :
{ "reply": "phrase courte à l'utilisateur", "elements": [ ... ] }
Pour PLUSIEURS pages :
{ "reply": "phrase courte", "targetPages": N, "pages": [ { "pageIndex": 0, "elements": [...] }, ... ] }

MODIFICATIONS CHIRURGICALES (si l'utilisateur demande de modifier la maquette actuelle) :
• La section MAQUETTE ACTUELLE (dans le message) fournit des IDs stables : p{page}-b{bloc} pour
  chaque bloc, et -l{ligne} pour chaque ligne d'un texte. Ex. p2-b3 = bloc 3 de la page 2,
  p11-b2-l3 = ligne 3 du bloc 2 de la page 11.
• Pour MODIFIER un bloc existant : renvoie TOUTE la maquette avec le bloc modifié, en CONSERVANT
  les ids des blocs non touchés (id: "p2-b3" inchangé). N'invente pas de nouveaux ids pour les
  blocs existants.
• Pour SUPPRIMER un bloc : retire-le simplement du tableau elements de sa page.
• Pour supprimer/modifier UNE LIGNE d'un texte : réécris le champ "text" de ce bloc SANS la ligne,
  ou avec la ligne corrigée. Conserve l'id du bloc.
• Si la demande est de créer un NOUVEAU bloc, ajoute-le à la fin du tableau elements (l'id sera
  attribué automatiquement).

RÈGLES STRICTES :
• Le champ "reply" DOIT être UNE SEULE PHRASE courte et naturelle. JAMAIS de JSON dans "reply".
• La maquette va UNIQUEMENT dans "elements" (1 page) ou "pages" (multi-pages).
• Chaque page doit contenir 8 à 20 éléments. Respecte strictement : top + height ≤ hauteur + 3 mm ET left + width ≤ largeur + 3 mm.`;
  }

  function buildCurrentDocContext() {
    if (!state.doc || !state.doc.pages.length) return 'MAQUETTE ACTUELLE : aucune (document vide).';
    const sel = state.selectedIds || [];

    // 🆕 RETRAVAIL CIBLÉ : l'utilisateur a sélectionné des éléments dans l'aperçu.
    // On envoie TOUTE la maquette courante (l'IA doit la renvoyer ENTIÈRE) avec une
    // liste claire des éléments sélectionnés à retravailler. Le studio fusionnera
    // ensuite : seuls les éléments sélectionnés sont remplacés par la réponse.
    if (sel.length) {
      const selSet = new Set(sel);
      const compact = state.doc.pages.map(p => ({
        pageIndex: p.pageIndex,
        elements: p.elements.map(e => {
          const c = { type: e.type, id: e.id, selected: selSet.has(e.id) ? true : undefined };
          ['left','top','width','height','radius','rx','ry','x1','y1','x2','y2','fontSize','fill','stroke','strokeWidth','opacity','fontFamily','fontWeight','textAlign','lineHeight','points','innerRadius'].forEach(k => {
            if (e[k] !== undefined && e[k] !== null) c[k] = e[k];
          });
          if (e.type === 'text') c.text = String(e.text).slice(0, 200);
          return c;
        })
      }));
      const selIds = sel.join(', ');
      return '🎯 RETRAVAIL CIBLÉ — l\'utilisateur a sélectionné ces élément(s) dans l\'aperçu : ' + selIds + '.\n' +
        '🚨 RÈGLE ABSOLUE : retravaille UNIQUEMENT les éléments marqués "selected": true ci-dessous.\n' +
        'Tout le reste du document doit être renvoyé STRICTEMENT À L\'IDENTIQUE (mêmes ids, mêmes valeurs).\n' +
        'Renvoie la maquette COMPLÈTE (format B multi-pages, TOUTES les pages, TOUS les éléments) avec\n' +
        'les éléments sélectionnés modifiés selon la demande.\n\n' +
        'MAQUETTE ACTUELLE (les éléments à retravailler ont "selected": true) :\n' + JSON.stringify(compact, null, 1);
    }

    const compact = state.doc.pages.map(p => ({
      pageIndex: p.pageIndex,
      elements: p.elements.map(e => {
        const c = { type: e.type, id: e.id };
        ['left', 'top', 'width', 'height', 'radius', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'fontSize', 'fill', 'stroke', 'strokeWidth', 'opacity', 'fontFamily', 'fontWeight', 'textAlign', 'lineHeight', 'points', 'innerRadius'].forEach(k => {
          if (e[k] !== undefined && e[k] !== null) c[k] = e[k];
        });
        if (e.type === 'text') c.text = String(e.text).slice(0, 200);
        return c;
      })
    }));
    // 📍 Description lisible pour les modifications chirurgicales : chaque bloc et
    // chaque ligne a un ID stable (p{page}-b{bloc}-l{ligne}). L'utilisateur peut
    // dire « supprime p2-b3 » ou « modifie la ligne 3 du bloc p11-b2 ».
    const readable = state.doc.pages.map(p => {
      const blocks = p.elements.map((e, bi) => {
        const t = String(e.type || 'objet').toLowerCase();
        const pos = 'x' + (e.left || 0) + ' y' + (e.top || 0) + ' w' + (e.width || 0) + ' h' + (e.height || 0);
        if (t === 'text' || t === 'textbox') {
          const lines = e._lines && e._lines.length ? e._lines : String(e.text || '').split('\n');
          const lineDescs = lines.map((ln, li) => '      l' + (li + 1) + ' (id ' + e.id.replace(/-l\d+$/, '') + '-l' + (li + 1) + ') : ' + String(ln).slice(0, 60));
          return '  • bloc p' + (p.pageIndex + 1) + '-b' + (bi + 1) + ' (TEXTE, ' + pos + ', font ' + (e.fontFamily || 'Open Sans') + ' ' + (e.fontSize || 14) + 'pt) :\n' + lineDescs.join('\n');
        }
        return '  • bloc p' + (p.pageIndex + 1) + '-b' + (bi + 1) + ' (' + t.toUpperCase() + ', ' + pos + ', fill ' + (e.fill || '#000') + ')';
      });
      return 'Page ' + (p.pageIndex + 1) + ' (' + p.elements.length + ' bloc(s)) :\n' + blocks.join('\n');
    }).join('\n');

    return 'MAQUETTE ACTUELLE (JSON mm, ajuste ces valeurs pour la modifier) :\n' + JSON.stringify(compact) +
      '\n\n📍 RÉFÉRENCES DES BLOCS (ids stables p{page}-b{bloc}, lignes -l{ligne}) :\n' + readable;
  }

  // ── Envoi ───────────────────────────────────────────────────
  function sendMessage() {
    if (state.busy) return;
    const txt = $('promptInput').value.trim();
    const hasAttach = state.attachments.length > 0;
    if (!txt && !hasAttach) return;

    const userText = txt || '(avec pièce(s) jointe(s))';
    protectCurrentDocumentForPrompt(userText);
    $('promptInput').value = '';
    state.lastPrompt = txt;
    appendChat('user', userText);
    state.chat.push({ role: 'user', text: userText });
    // 🆕 Auto-save immédiat : persiste le message utilisateur + titre de conversation.
    try { persistChat(); } catch (_) {}
    try { saveCurrentConv(); } catch (_) {}
    const attachments = state.attachments.slice();

    // 🆕 2026-08-30 : si le prompt demande un format de page (A5, carte, etc.),
    // adapter le canvas AVANT la génération → l'IA reçoit le bon format (buildSystemPrompt)
    // et la preview est au bon format (pageW/pageH mis à jour + page vierge re-rendue).
    try { applyDetectedPageFormat(userText); } catch (_) {}

    state.busy = true;
    $('sendBtn').disabled = true;
    const typingEl = appendTyping();

    // 🆕 Loader typo : si l'utilisateur demande une police précise dans son prompt,
    // on charge la (les) police(s) AVANT la réponse pour une vraie réassurance.
    const requestedFonts = detectRequestedFonts(userText);
    if (requestedFonts.length) {
      loadFontsWithFeedback(requestedFonts);
    }

    const system = buildSystemPrompt();
    const messages = [{ role: 'system', content: system }];
    const recent = state.chat.slice(-12);
    recent.forEach(m => messages.push({ role: m.role, content: m.text }));

    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      let context = '\n\n' + buildCurrentDocContext() + buildAttachmentContext();
      const limit = attachmentTextLimit();
      const hasLongText = state.attachments.some(a => a.type === 'text' && String(a.text || '').length > limit);
      const wantsSearch = /\b(cherche|trouve|recherch|où|ou est|passage|extrait|localise|relève|paragraphe|quel|quelle|combien|trouver|information|info|résumé|resume|synthèse|analyse|donne|dis)\b/i.test(userText);
      if ((wantsSearch || hasLongText) && state.attachments.some(a => a.type === 'text')) {
        const found = searchInAttachments(userText);
        if (found.length) {
          const extra = found.map(f => 'RÉSULTAT RECHERCHE dans "' + f.name + '" :\n' + f.passages.join('\n---\n')).join('\n\n');
          context += '\n\n=== RÉSULTATS DE RECHERCHE DANS LES PIÈCES JOINTES ===\n' + extra;
        } else {
          const summaries = summarizeAttachments();
          if (summaries.length) {
            const extra = summaries.map(s => 'RÉSUMÉ AUTO de "' + s.name + '" :\n' + s.text).join('\n\n');
            context += '\n\n=== RÉSUMÉS AUTO DES DOCUMENTS LONGS ===\n' + extra;
          }
        }
      }
      last.content = last.content + context;
    }

    callAI(messages).then(response => {
      typingEl.remove();
      const parsed = parseAIResponse(response);
      const hasLayout = !!(parsed.elements && parsed.elements.length) || !!(parsed.pages && parsed.pages.length);

      let reply = (parsed.reply || '').trim();
      if (hasLayout) {
        if (/^\s*[\[{<]/.test(reply) || /```|```json|"elements"|"pages"|<text|<rect/.test(reply)) reply = '';
      }

      // Le JSON brut de l'IA (pour boutons télécharger/ouvrir + repli si besoin)
      let rawJson = extractJSONObject(response);
      let rawJsonStr = rawJson ? JSON.stringify(rawJson, null, 2) : null;
      // Si le JSON est tronqué/non parsable mais que des pages ont été récupérées,
      // reconstruire un JSON propre (pages complètes) pour le téléchargement/l'ouverture.
      if (!rawJsonStr && (parsed.pages || parsed.elements)) {
        rawJsonStr = JSON.stringify({ targetPages: parsed.targetPages, pages: parsed.pages || [{ pageIndex: 0, elements: parsed.elements }] }, null, 2);
      }

      if (hasLayout && attachments.length) {
        if (parsed.elements) parsed.elements = hydrateUserImages(parsed.elements, attachments);
        if (parsed.pages) parsed.pages.forEach(p => { if (p.elements) p.elements = hydrateUserImages(p.elements, attachments); });
      }

      if (hasLayout) {
        // 🆕 Undo/redo : pousser l'ancienne maquette avant de la remplacer.
        try {
          if (state.doc && state.doc.pages && state.doc.pages.length) {
            state.undoStack.push(JSON.parse(JSON.stringify(state.doc)));
            if (state.undoStack.length > 30) state.undoStack.shift();
          }
          state.redoStack = [];
        } catch (_) {}
        // 🆕 CORRECTION CIBLÉE : si des éléments étaient sélectionnés, on FUSIONNE
        // la réponse de l'IA avec la maquette courante — seuls les éléments sélectionnés
        // sont remplacés par ceux renvoyés, le reste est conservé à l'identique.
        let doc;
        if (state.selectedIds && state.selectedIds.length && state.doc && state.doc.pages.length) {
          doc = mergeTargetedChanges(state.doc, parsed, state.selectedIds);
        } else {
          doc = buildDocFromParsed(parsed);
        }
        state.doc = doc;
        renderDocument(doc);
        // 🆕 Charger les polices utilisées par la maquette (avec feedback typo)
        ensureMaquetteFonts(doc);
        // 🆕 Grille / repères à la demande : si l'utilisateur a demandé une grille,
        // on la pose dans la preview (non imprimable, déplaçable) en plus de la maquette.
        const gridSpec = detectGridSpec(userText + ' ' + (parsed.reply || ''));
        if (gridSpec) {
          applyGridToAllPages(gridSpec);
          state.gridVisible = true;
          const gridMsg = '📐 Grille posée sur l\'aperçu : ' + gridSpec.cols + ' colonne(s)' +
            (gridSpec.rows > 0 ? ', ' + gridSpec.rows + ' ligne(s)' : '') +
            ' (gouttière ' + gridSpec.gutter + ' mm' + (gridSpec.baseline ? ', baseline activée' : '') + '). ' +
            'Les guides sont non imprimables et déplaçables — vous pouvez les effacer en régénérant.';
          appendChat('assistant', gridMsg);
          state.chat.push({ role: 'assistant', text: gridMsg });
        }
        persistDoc();
        const summary = reply || ('Maquette générée — ' + doc.pages.length + ' page(s). Vous pouvez me demander des ajustements.');
        appendChat('assistant', summary, { pages: doc.pages.length }, { rawJson: rawJsonStr, truncated: parsed.truncated });
        state.chat.push({ role: 'assistant', text: summary });
      } else {
        // Pas de maquette exploitable. Si l'IA a quand même renvoyé un JSON
        // (tronqué ou dans le mauvais format), on propose une carte repliable
        // avec boutons Télécharger .sp / Ouvrir dans l'app.
        if (rawJsonStr && (parsed.truncated || rawJsonStr.length > 300)) {
          const msg = parsed.truncated
            ? "⚠️ La maquette générée est trop grande et a été tronquée par le modèle. J'ai récupéré ce qui était parsable. Vous pouvez télécharger la partie JSON, ouvrir dans l'app (pages complètes), ou reformuler en réduisant le nombre de pages / éléments."
            : "J'ai détecté une maquette au format JSON dans la réponse, mais je n'ai pas pu la dessiner directement dans l'aperçu. Vous pouvez la télécharger en .sp ou l'ouvrir dans SuperPrint :";
          appendChat('assistant', msg, null, { rawJson: rawJsonStr, truncated: parsed.truncated, collapsible: true });
          state.chat.push({ role: 'assistant', text: msg });
        } else {
          const fallbackText = reply || "J'ai reçu votre message, mais je n'ai pas pu en déduire de maquette. Précisez le format, le style et le contenu souhaités.";
          appendChat('assistant', fallbackText, null, { rawJson: rawJsonStr, truncated: parsed.truncated });
          state.chat.push({ role: 'assistant', text: fallbackText });
        }
      }
      persistChat();
      state.busy = false;
      $('sendBtn').disabled = false;
    }).catch(err => {
      typingEl.remove();
      appendChat('assistant', 'Error: ' + (err.message || err));
      state.busy = false;
      $('sendBtn').disabled = false;
    });
  }

  function callAI(messages) {
    if (state.engine === 'webllm') return callWebLLM(messages);
    if (state.engine === 'deepseek') return callDeepSeek(messages);
    if (state.engine === 'openrouter') return callOpenRouter(messages);
    return callGroq(messages);
  }

  // ── DeepSeek direct (API OpenAI-compatible, CORS OK depuis localhost) ──
  function callDeepSeek(messages) {
    const apiKey = state.dsApiKey || getLS(LS.dsKey) || '';
    if (!apiKey) return Promise.reject(new Error('Clé DeepSeek manquante. Revenez à l\'accueil et configurez le mode cloud.'));
    const model = state.dsModel || getLS(LS.dsModel) || DEEPSEEK_MODELS[0][0];
    const body = {
      model,
      messages,
      temperature: 0.4,
      max_tokens: 32768,
      response_format: { type: 'json_object' }
    };
    // 🔴 FIX 2026-08-30 : DeepSeek V4 a un mode THINKING par DÉFAUT qui consomme
    //   une partie du max_tokens (reasoning_content). Pour la maquette SP213 qui
    //   nécessite de grands budgets de sortie JSON, on le désactive pour que tout
    //   le budget serve à produire la maquette (sinon les JSON longs sont tronqués).
    if (/deepseek-v4/.test(model)) {
      body.thinking = { type: 'disabled' };
    }
    return fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body)
    })
      .then(async res => {
        const raw = await res.text().catch(() => '');
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
        if (!data) throw new Error('Réponse invalide (HTTP ' + res.status + ') : ' + raw.slice(0, 200));
        if (!res.ok) {
          const msg = (data.error && (data.error.message || data.error.code)) ? (data.error.message || data.error.code) : ('HTTP ' + res.status);
          throw new Error(msg);
        }
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        if (data.choices && data.choices[0] && data.choices[0].message) {
          const content = data.choices[0].message.content || '';
          const fr = data.choices[0].finish_reason;
          if (fr === 'length') return content + '\n\n__SP213_TRUNCATED__';
          return content;
        }
        throw new Error('Réponse DeepSeek vide');
      });
  }

  // ── OpenRouter direct (API OpenAI-compatible, CORS OK depuis localhost) ──
  function callOpenRouter(messages) {
    const apiKey = state.orApiKey || getLS(LS.orKey) || '';
    if (!apiKey) return Promise.reject(new Error('Clé OpenRouter manquante. Revenez à l\'accueil et configurez le mode cloud.'));
    const model = state.orModel || getLS(LS.orModel) || OPENROUTER_MODELS[0][0];
    const body = {
      model,
      messages,
      temperature: 0.4,
      max_tokens: 32768,
      response_format: { type: 'json_object' }
    };
    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'SuperPrint SP213'
      },
      body: JSON.stringify(body)
    })
      .then(async res => {
        const raw = await res.text().catch(() => '');
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
        if (!data) throw new Error('Réponse invalide (HTTP ' + res.status + ') : ' + raw.slice(0, 200));
        if (!res.ok) {
          const msg = (data.error && (data.error.message || data.error.code)) ? (data.error.message || data.error.code) : ('HTTP ' + res.status);
          throw new Error(msg);
        }
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        if (data.choices && data.choices[0] && data.choices[0].message) {
          const content = data.choices[0].message.content || '';
          const fr = data.choices[0].finish_reason;
          // Marquer la réponse si elle a été tronquée (max_tokens atteint) :
          // le studio pourra afficher un message clair au lieu du JSON brut.
          if (fr === 'length') return content + '\n\n__SP213_TRUNCATED__';
          return content;
        }
        throw new Error('Réponse OpenRouter vide');
      });
  }

  // ── Groq direct (pas de proxy — Groq autorise CORS) ─────────
  function callGroq(messages) {
    const apiKey = state.apiKey || getLS(LS.key) || '';
    if (!apiKey) return Promise.reject(new Error('Clé Groq manquante. Revenez à l\'accueil et configurez le mode Groq.'));
    const model = state.model || getLS(LS.model) || GROQ_MODELS[0][0];
    const body = {
      model,
      messages,
      temperature: 0.4,
      // 🔴 FIX 2026-08-30 (tests réels) : max_tokens 8192 + prompt dépassait le TPM 8000
      //   du tier gratuit Groq → échec systématique. 6000 reste sous 8000 (6000+prompt ≈ 6224)
      //   et permet de produire des maquettes multi-pages (vérifié : 4 pages OK).
      max_tokens: 6000
    };
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body)
    })
      .then(async res => {
        const raw = await res.text().catch(() => '');
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
        if (!data) throw new Error('Réponse invalide (HTTP ' + res.status + ') : ' + raw.slice(0, 200));
        if (!res.ok) {
          const msg = (data.error && (data.error.message || data.error.code)) ? (data.error.message || data.error.code) : ('HTTP ' + res.status);
          if (/tokens per minute|TPM|Request too large/i.test(msg)) {
            throw new Error('Limite du plan GRATUIT Groq dépassée (8 000 tokens/min). Votre demande est trop grosse pour Groq. Réduisez le nombre de pages / la longueur du texte, patientez 1 minute, ou passez au mode OpenRouter.');
          }
          if (/max_tokens/i.test(msg)) {
            throw new Error('Limite Groq atteinte : sortie limitée à 6 000 tokens (TPM 8 000/min du plan gratuit). Réduisez le nombre de pages / éléments demandés.');
          }
          throw new Error(msg);
        }
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        if (data.choices && data.choices[0] && data.choices[0].message) {
          const content = data.choices[0].message.content || '';
          const fr = data.choices[0].finish_reason;
          if (fr === 'length') return content + '\n\n__SP213_TRUNCATED__';
          return content;
        }
        throw new Error('Réponse Groq vide');
      });
  }

  // ── WebLLM (npm) ────────────────────────────────────────────
  const LOADER_QUOTES = [
    'Un bon print commence par une bonne grille.',
    'La typographie, c’est la voix de la page.',
    'Le blanc, c’est aussi de la composition.',
    'Une marge de 15 mm sauve des vies (et des massicots).',
    'SP213 réchauffe sa logique de canevas…',
    'Fonds perdus : 3 mm de courage.',
    'Le folio se range toujours en bas, bien sagement.',
    'Une belle maquette, c’est 80% de rigueur, 20% de magie.',
    'Le papier s’arrête au bord, la créativité non.',
    'SP213 aligne ses colonnes, gouttière comprise.',
    'La césure, ce petit trait qui change tout.',
    'Un titre de 72 pt, et le tour est joué.'
  ];

  function checkWebGPU() {
    if (!navigator.gpu) {
      return Promise.reject(new Error('WebGPU indisponible. Utilisez Chrome, Edge ou un navigateur compatible, puis vérifiez l’accélération matérielle.'));
    }
    return navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (adapter) {
      if (!adapter) throw new Error('Aucun GPU WebGPU compatible détecté. Essayez un modèle plus léger ou un moteur cloud.');
      return adapter;
    });
  }

  function releaseWebLLM() {
    const engine = state.webllm;
    state.webllm = null;
    if (engine && typeof engine.unload === 'function') {
      Promise.resolve(engine.unload()).catch(function (err) { console.warn('[SP213] WebLLM unload:', err); });
    }
  }

  function ensureWebLLM() {
    if (state.webllm) return Promise.resolve(state.webllm);
    if (state.webllmPromise) return state.webllmPromise;
    state.webllmLoading = true;
    state.webllmPromise = checkWebGPU().then(initWebLLM).finally(function () {
      state.webllmLoading = false;
      state.webllmPromise = null;
    });
    return state.webllmPromise;
  }

  function initWebLLM() {
    return new Promise(function (resolve, reject) {
      if (state.webllm) { resolve(state.webllm); return; }
      const modelId = state.wllmModel || WLLM_MODELS[0][0];
      const loader = $('modelLoader');
      const loaderFill = $('loaderFill');
      const loaderPct = $('loaderPct');
      const loaderSub = $('loaderSub');
      const loaderQuote = $('loaderQuote');
      let quoteIdx = -1;
      let quoteTimer = null;
      function nextQuote() {
        if (!loaderQuote) return;
        quoteIdx = (quoteIdx + 1) % LOADER_QUOTES.length;
        loaderQuote.textContent = LOADER_QUOTES[quoteIdx];
        loaderQuote.classList.remove('show');
        void loaderQuote.offsetWidth;
        loaderQuote.classList.add('show');
      }
      function startQuotes() {
        if (!loaderQuote) return;
        nextQuote();
        quoteTimer = setInterval(nextQuote, 3200);
      }
      function stopQuotes() {
        if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
      }
      if (loader) loader.classList.add('active');
      startQuotes();

      CreateMLCEngine(modelId, {
        initProgressCallback: function (p) {
          const prog = Math.round((p.progress || 0) * 100);
          if (loaderFill) loaderFill.style.width = prog + '%';
          if (loaderPct) loaderPct.textContent = prog + ' %';
          if (loaderSub) loaderSub.textContent = (p && p.text) ? p.text : 'Chargement du modèle…';
        }
      }).then(function (engine) {
        stopQuotes();
        if (loader) loader.classList.remove('active');
        state.webllm = engine;
        state.webllmLoading = false;
        if (engine) engine._sp213ModelId = modelId;
        resolve(engine);
      }).catch(function (err) {
        stopQuotes();
        if (loader) loader.classList.remove('active');
        state.webllmLoading = false;
        reject(err);
      });
    });
  }

  function clipWebLLMText(value, maxChars) {
    const text = String(value || '');
    if (text.length <= maxChars) return text;
    const head = Math.ceil(maxChars * 0.58);
    const tail = maxChars - head;
    return text.slice(0, head) + '\n\n[CONTEXTE INTERMÉDIAIRE ABRÉGÉ]\n\n' + text.slice(-tail);
  }

  function webLLMCompletion(engine, messages, maxTokens, temperature) {
    const opts = {
      messages,
      temperature: temperature == null ? 0.2 : temperature,
      max_tokens: maxTokens,
      response_format: {
        type: 'json_object',
        schema: JSON.stringify({ type: 'object', additionalProperties: true })
      }
    };
    const mid = state.wllmModel || '';
    if (/^Qwen3/.test(mid)) {
      opts.enable_thinking = false;
      opts.thinking = { type: 'disabled' };
    }
    return engine.chat.completions.create(opts).then(function (res) {
      const choice = res && res.choices && res.choices[0];
      const content = choice && choice.message && choice.message.content;
      if (!content) throw new Error('Empty WebLLM response');
      return content;
    });
  }

  function getWebLLMPageCount(prompt) {
    const text = String(prompt || '');
    const explicit = text.match(/(\d{1,3})\s*[- ]?\s*pages?/i);
    let count = explicit ? parseInt(explicit[1], 10) : 0;
    if (!count && /\b(brochure|booklet|livret|dépliant)\b/i.test(text)) count = 4;
    if (!count && /\b(magazine|journal|book|livre)\b/i.test(text)) count = 8;
    if (!count && /\b(catalogue|catalog)\b/i.test(text)) count = 6;
    return Math.max(1, Math.min(12, count || 1));
  }

  function getWebLLMDomainPack(prompt) {
    const text = String(prompt || '');
    if (/\b(livre|book|roman|essai|édition|broché|relié)\b/i.test(text)) {
      return 'LIVRE: couverture p1, pages liminaires, chapitres, folios hors couverture, dernière page quatrième. Marges miroir: intérieur 20mm, extérieur 15mm, haut 15mm, bas 20mm. Corps 9-12pt, interligne 1.4-1.6, aucun texte dans la reliure.';
    }
    if (/\b(magazine|journal|revue)\b/i.test(text)) {
      return 'MAGAZINE: couverture forte, sommaire, édito, rubriques, alternance pages denses/aérées, grille cohérente, folios 8-10pt et légendes pour les images.';
    }
    if (/\b(catalogue|catalog)\b/i.test(text)) {
      return 'CATALOGUE: grille produit stable, image non déformée, nom, référence, description et prix; mêmes alignements et styles sur toutes les pages.';
    }
    if (/\b(brochure|booklet|livret|dépliant)\b/i.test(text)) {
      return 'BROCHURE: couverture, proposition de valeur, sections courtes, appel à l’action et dos; rythme visuel cohérent et textes lisibles.';
    }
    return 'PRINT: hiérarchie claire, grille, marges sûres de 15mm, fonds pleine page avec 3mm de fond perdu, textes 8pt minimum.';
  }

  function callWebLLM(messages) {
    return ensureWebLLM().then(function (engine) {
      const lastUser = messages.slice().reverse().find(function (message) { return message.role === 'user'; });
      const brief = clipWebLLMText(lastUser ? lastUser.content : state.lastPrompt, 6200);
      const pageCount = getWebLLMPageCount(state.lastPrompt || brief);
      const isTargetedEdit = !!(state.selectedIds && state.selectedIds.length);

      if (pageCount === 1 || isTargetedEdit) {
        const system = clipWebLLMText(messages[0] && messages[0].content, 1800);
        return webLLMCompletion(engine, [
          { role: 'system', content: system },
          { role: 'user', content: brief }
        ], 1800, 0.2);
      }

      const domainPack = getWebLLMDomainPack(state.lastPrompt || brief);
      const plannerSystem = `Tu es SP213, directeur éditorial print de SuperPrint. Planifie un document avant sa mise en page.
Réponds uniquement en JSON: {"title":"...","direction":"...","palette":["#RRGGBB"],"typography":{"display":"...","body":"..."},"grid":"...","pages":[{"pageIndex":0,"role":"...","objective":"...","content":"..."}]}.
Produis exactement ${pageCount} pages indexées de 0 à ${pageCount - 1}. ${domainPack}`;
      const plannerUser = 'BRIEF:\n' + clipWebLLMText(state.lastPrompt || brief, 3000) +
        `\nFORMAT: ${state.pageW}x${state.pageH} mm; mode ${state.viewMode}; fond perdu ${state.bleed || 3} mm.`;

      return webLLMCompletion(engine, [
        { role: 'system', content: plannerSystem },
        { role: 'user', content: plannerUser }
      ], 900, 0.15).then(function (planText) {
        const parsedPlan = extractJSONObject(planText) || {};
        const suppliedPages = Array.isArray(parsedPlan.pages) ? parsedPlan.pages : [];
        const pageSpecs = Array.from({ length: pageCount }, function (_, index) {
          return suppliedPages[index] || { pageIndex: index, role: index === 0 ? 'couverture' : (index === pageCount - 1 ? 'dernière page' : 'contenu'), objective: 'Développer le brief', content: '' };
        });
        const sharedPlan = {
          title: parsedPlan.title || 'Document',
          direction: parsedPlan.direction || 'Éditorial clair et structuré',
          palette: Array.isArray(parsedPlan.palette) ? parsedPlan.palette.slice(0, 5) : ['#111827', '#FFFFFF', '#E11D48'],
          typography: parsedPlan.typography || { display: 'Bebas Neue', body: 'Open Sans' },
          grid: parsedPlan.grid || 'Grille cohérente, marges 15 mm'
        };
        const generatedPages = [];
        const originalModelLabel = $('modelLabel') ? $('modelLabel').textContent : '';

        function generatePage(index, retry) {
          if ($('modelLabel')) $('modelLabel').textContent = 'SP213 ' + (index + 1) + '/' + pageCount;
          const pageSystem = `Tu es SP213, maquettiste print de SuperPrint. Génère UNE page en JSON valide.
Format: {"pageIndex":${index},"elements":[...]}. Coordonnées en mm, fontSize en pt, couleurs #RRGGBB.
Types: rectangle, text, circle, ellipse, triangle, line, star, image. Chaque texte exige left,top,width,text,fontSize,fill,fontFamily.
Ordre des calques: fonds, images, formes, titres, corps, légendes, folio. Utilise 6 à 14 éléments utiles.
Fond pleine page: left:-3, top:-3, width:${state.pageW + 6}, height:${state.pageH + 6}. Texte dans les marges et jamais sous ${state.pageH - 10}mm. ${domainPack}`;
          const pageUser = 'BRIEF: ' + clipWebLLMText(state.lastPrompt || brief, 1700) +
            '\nDIRECTION COMMUNE: ' + JSON.stringify(sharedPlan) +
            '\nPAGE À PRODUIRE: ' + JSON.stringify(pageSpecs[index]);
          return webLLMCompletion(engine, [
            { role: 'system', content: pageSystem },
            { role: 'user', content: pageUser }
          ], 1500, retry ? 0.05 : 0.18).then(function (pageText) {
            const page = extractJSONObject(pageText);
            if (!page || !Array.isArray(page.elements) || !page.elements.length) {
              if (!retry) return generatePage(index, true);
              throw new Error('SP213 WLLM n’a pas produit une page JSON valide (page ' + (index + 1) + ').');
            }
            generatedPages.push({ pageIndex: index, elements: page.elements });
          });
        }

        let sequence = Promise.resolve();
        pageSpecs.forEach(function (_, index) {
          sequence = sequence.then(function () { return generatePage(index, false); });
        });
        return sequence.then(function () {
          if ($('modelLabel')) $('modelLabel').textContent = originalModelLabel;
          return JSON.stringify({ reply: 'Maquette éditoriale structurée page par page.', targetPages: pageCount, pages: generatedPages });
        }, function (error) {
          if ($('modelLabel')) $('modelLabel').textContent = originalModelLabel;
          throw error;
        });
      });
    });
  }

  // ── Parse réponse IA ────────────────────────────────────────
  function parseAIResponse(text) {
    if (!text) return {};
    // Marqueur de troncature ajouté par callOpenRouter / callGroq (finish_reason === 'length')
    const truncated = text.indexOf('__SP213_TRUNCATED__') !== -1;
    let clean = text.replace(/__SP213_TRUNCATED__/g, '').trim();

    // 1) Tenter d'extraire un bloc JSON (```json ... ``` ou premier { ... dernier })
    let jsonStr = null;
    let m = clean.match(/```json\s*([\s\S]*?)\s*```/i) || clean.match(/```\s*([\s\S]*?)\s*```/i);
    if (m) jsonStr = m[1];
    if (!jsonStr) {
      const idx = clean.indexOf('{');
      if (idx >= 0) {
        const lastIdx = clean.lastIndexOf('}');
        if (lastIdx > idx) jsonStr = clean.slice(idx, lastIdx + 1);
      }
    }

    let data = null;
    if (jsonStr) { try { data = JSON.parse(jsonStr); } catch (_) { data = null; } }
    if (!data) { try { data = JSON.parse(clean); } catch (_) { data = null; } }

    // 2) Si le JSON n'est pas parsable mais qu'il semble tronqué, tenter de
    //    récupérer les pages/éléments COMPLETS avant la coupure.
    if (!data && (truncated || jsonStr)) {
      const partial = recoverPartialJSON(jsonStr || clean);
      if (partial) {
        let pEl = Array.isArray(partial.elements) ? partial.elements : null;
        let pPg = Array.isArray(partial.pages) ? partial.pages : null;
        if (pEl || pPg) {
          return { reply: '', elements: pEl, pages: pPg, targetPages: partial.targetPages, truncated: true };
        }
      }
    }

    if (!data || typeof data !== 'object') return { reply: clean.replace(/```/g, '').trim(), truncated };

    let elements = Array.isArray(data.elements) ? data.elements : null;
    let pages = Array.isArray(data.pages) ? data.pages : null;
    if (!elements && Array.isArray(data.layout)) elements = data.layout;
    if (!pages && Array.isArray(data.maquette)) pages = data.maquette;

    // 3) Certains modèles (Nemotron) mettent le JSON DANS "reply" : on tente de l'extraire.
    if (!elements && !pages && typeof data.reply === 'string') {
      const inner = extractJSONObject(data.reply);
      if (inner) {
        if (Array.isArray(inner.elements)) elements = inner.elements;
        if (Array.isArray(inner.pages)) pages = inner.pages;
        if (Array.isArray(inner.layout) && !elements) elements = inner.layout;
        if (Array.isArray(inner.maquette) && !pages) pages = inner.maquette;
        if (!data.targetPages && inner.targetPages) data.targetPages = inner.targetPages;
      }
    }

    // Normaliser les pages : { pageIndex, elements } à partir de content / page
    if (pages) {
      pages = pages.map(p => {
        if (p && Array.isArray(p.elements)) return p;
        if (p && Array.isArray(p.content)) return { pageIndex: p.pageIndex, elements: p.content };
        if (p && typeof p.page === 'number' && Array.isArray(p.elements)) return { pageIndex: p.page - 1, elements: p.elements };
        return p;
      }).filter(p => p && Array.isArray(p.elements));
    }

    let reply = (typeof data.reply === 'string' && data.reply.trim()) ? data.reply.trim() : '';
    if (/^\s*[\[{<]/.test(reply) || /"elements"|"pages"|```|__SP213/.test(reply)) reply = '';

    return { reply, elements, pages, targetPages: data.targetPages, truncated };
  }

  // Extrait un objet JSON depuis une chaîne (même entourée de texte).
  function extractJSONObject(s) {
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (_) {}
    const idx = s.indexOf('{');
    if (idx < 0) return null;
    const lastIdx = s.lastIndexOf('}');
    if (lastIdx <= idx) return null;
    try { return JSON.parse(s.slice(idx, lastIdx + 1)); } catch (_) { return null; }
  }

  // Tente de récupérer un JSON partiel (tronqué) : on isole les pages complètes
  // (objets {pageIndex, elements} entiers) présents avant la coupure.
  function recoverPartialJSON(s) {
    if (!s) return null;
    const out = {};
    const reTg = /"targetPages"\s*:\s*(\d+)/;
    const tm = s.match(reTg);
    if (tm) out.targetPages = parseInt(tm[1], 10);

    // Extrait un objet JSON complet (accolades équilibrées) à partir de '{'
    function extractBalancedObj(str, openIdx) {
      let depth = 0, inStr = false, esc = false;
      for (let i = openIdx; i < str.length; i++) {
        const ch = str[i];
        if (inStr) {
          if (esc) { esc = false; }
          else if (ch === '\\') { esc = true; }
          else if (ch === '"') { inStr = false; }
          continue;
        }
        if (ch === '"') { inStr = true; }
        else if (ch === '{') { depth++; }
        else if (ch === '}') {
          depth--;
          if (depth === 0) return str.slice(openIdx, i + 1);
        }
      }
      return null; // non fermé (tronqué)
    }

    // Chercher "pages": [ ... — puis chaque objet page individuel dans le tableau
    const mKey = s.match(/"pages"\s*:\s*\[/);
    if (mKey) {
      const pagesStart = mKey.index + mKey[0].length;
      // Itérer sur les objets { ... } au niveau racine du tableau pages
      let i = pagesStart;
      const recovered = [];
      while (i < s.length) {
        const openIdx = s.indexOf('{', i);
        if (openIdx < 0) break;
        const objStr = extractBalancedObj(s, openIdx);
        if (!objStr) break; // plus d'objet complet → tronqué
        try {
          const obj = JSON.parse(objStr);
          if (obj && typeof obj === 'object') recovered.push(obj);
        } catch (_) { break; }
        i = openIdx + objStr.length;
      }
      if (recovered.length) out.pages = recovered;
    }

    // Fallback "elements": [ ... — même logique sur les objets
    if (!out.pages) {
      const mEl = s.match(/"elements"\s*:\s*\[/);
      if (mEl) {
        const elsStart = mEl.index + mEl[0].length;
        let i = elsStart;
        const recovered = [];
        while (i < s.length) {
          const openIdx = s.indexOf('{', i);
          if (openIdx < 0) break;
          const objStr = extractBalancedObj(s, openIdx);
          if (!objStr) break;
          try {
            const obj = JSON.parse(objStr);
            if (obj && typeof obj === 'object') recovered.push(obj);
          } catch (_) { break; }
          i = openIdx + objStr.length;
        }
        if (recovered.length) out.elements = recovered;
      }
    }

    return (out.pages || out.elements) ? out : null;
  }

  // 🆕 2026-08-30 — VALIDATEUR DE FIN DE PAGE (print) avec FLOW VERTICAL.
  // Les IA ont tendance à laisser déborder des blocs après le bas de page au lieu de
  // créer une nouvelle page. Cette fonction garantit que :
  //   • les TEXTES qui dépassent sont d'abord réduits en typo (min 8 pt), puis si
  //     ça ne suffit pas, ils COULENT en cascade sur la (les) page(s) suivante(s) —
  //     chaque bloc reporté est placé SOUS le précédent (jamais superposé).
  //   • les formes décoratives/fonds pleine page (bleed) restent sur leur page.
  //   • jamais de texte coupé par le massicot.
  function _spConstrainDocToPages(doc) {
    if (!doc || !Array.isArray(doc.pages) || !doc.pages.length) return doc;
    const pageH = doc.h || state.pageH || 297;
    const pageW = doc.w || state.pageW || 210;
    const MIN_FS = 8;
    const SAFE_BOTTOM = pageH - 10; // réserve 10 mm d'air en bas (zone folio)
    const TOP_MARGIN = 15;          // marge haute des pages de flux

    function estimateCharWidthMm(fs) {
      if (fs >= 60) return fs * 0.135;
      if (fs >= 36) return fs * 0.145;
      if (fs >= 18) return fs * 0.17;
      if (fs >= 14) return fs * 0.17;
      return fs * 0.168;
    }
    function estimateTextHeightMm(el, fs) {
      const text = (typeof el.text === 'string' && el.text.trim()) ? el.text : ' ';
      const width = (typeof el.width === 'number' && el.width > 10) ? el.width : (pageW - 30);
      const lh = (typeof el.lineHeight === 'number' && el.lineHeight > 0) ? el.lineHeight : 1.4;
      const cw = estimateCharWidthMm(fs);
      const perLine = Math.max(1, Math.floor(width / cw));
      const lines = Math.max(1, Math.ceil(text.length / perLine));
      return lines * fs * lh * 0.353;
    }
    function isText(el) {
      const t = String((el && el.type) || '').toLowerCase();
      return t === 'text' || t === 'textbox';
    }
    function elBottom(el, fs) {
      const top = (typeof el.top === 'number') ? el.top : 0;
      const h = isText(el) ? estimateTextHeightMm(el, fs) : ((typeof el.height === 'number') ? el.height : 0);
      return top + h;
    }
    // Réduit la typo d'un texte pour tenir dans la page si possible ; renvoie {clone, fs, height} ou null.
    function fitText(el) {
      let fs = (typeof el.fontSize === 'number' && el.fontSize > 0) ? el.fontSize : 11;
      let height = estimateTextHeightMm(el, fs);
      let guard = 0;
      while (height > SAFE_BOTTOM - TOP_MARGIN && fs > MIN_FS && guard < 10) {
        fs = Math.max(MIN_FS, Math.round((fs - 1) * 10) / 10);
        height = estimateTextHeightMm(el, fs);
        guard++;
      }
      return { fs, height };
    }

    // 1) Traiter chaque page : formes à leur place, textes qui tiennent à leur place,
    //    textes qui dépassent → mis dans `carry` pour couler sur les pages suivantes.
    const finalPages = [];
    let carry = []; // blocs (clones) à couler, DANS L'ORDRE, avec leur top préservé ou 15
    doc.pages.forEach((pg, pi) => {
      const els = Array.isArray(pg.elements) ? pg.elements.slice() : [];
      const current = { pageIndex: pg.pageIndex, elements: [] };
      // Formes : fonds pleine page restent (bleed), formes trop basses ramenées.
      const shapes = els.filter(e => !isText(e)).map((el) => {
        const b = elBottom(el, null);
        const isFullBleed = (el.left <= 0 && el.top <= 0 && (el.width || 0) >= pageW - 1 && (el.height || 0) >= pageH - 1);
        if (!isFullBleed && b > pageH + 5) {
          const h = (typeof el.height === 'number' && el.height > 0) ? el.height : 0;
          const newTop = Math.max(15, Math.round((pageH - 10 - h) * 10) / 10);
          el = JSON.parse(JSON.stringify(el));
          el.top = newTop;
        }
        return el;
      });
      current.elements = shapes.slice();
      const texts = els.filter(e => isText(e));

      // 2) Préserver la grille : ne couler que les textes qui se chevauchent
      //    réellement dans une même zone horizontale.
      const placedTextBoxes = [];
      // On reprend d'abord les blocs reportés de la page précédente (carry).
      // Si carry non vide, on les coule EN PREMIER sur cette page (avant les textes natifs).
      const toPlace = carry.slice();
      carry = [];
      toPlace.push.apply(toPlace, texts);

      toPlace.forEach((el) => {
        const origTop = (typeof el.top === 'number') ? el.top : 0;
        let top = (origTop >= TOP_MARGIN && origTop <= SAFE_BOTTOM) ? origTop : TOP_MARGIN;
        // Cloner + appliquer la réduction de typo si nécessaire.
        const fitted = fitText(el);
        const left = (typeof el.left === 'number') ? el.left : TOP_MARGIN;
        const right = left + ((typeof el.width === 'number' && el.width > 0) ? el.width : pageW - (TOP_MARGIN * 2));
        const blockers = placedTextBoxes.filter(box => left < box.right && right > box.left && top < box.bottom + 3 && top + fitted.height > box.top);
        if (blockers.length) top = Math.max.apply(null, blockers.map(box => box.bottom + 6));
        const clone = JSON.parse(JSON.stringify(el));
        if (fitted.fs !== (el.fontSize || 11)) clone.fontSize = fitted.fs;
        clone.top = Math.round(top * 10) / 10;
        const bottom = clone.top + fitted.height;
        if (bottom <= SAFE_BOTTOM || (fitted.fs <= MIN_FS && bottom <= pageH + 3)) {
          current.elements.push(clone);
          placedTextBoxes.push({ left, right, top: clone.top, bottom });
        } else {
          // Ne tient pas → couler sur la page suivante.
          const carryClone = JSON.parse(JSON.stringify(clone));
          carryClone.top = TOP_MARGIN;
          carry.push(carryClone);
        }
      });

      finalPages.push(current);
    });

    // 3) Vider le carry restant en créant de nouvelles pages (cascade).
    while (carry.length) {
      const nextPage = { pageIndex: finalPages.length, elements: [] };
      const placedTextBoxes = [];
      const pending = carry.slice();
      carry = [];
      pending.forEach((el) => {
        const fitted = fitText(el);
        const clone = JSON.parse(JSON.stringify(el));
        if (fitted.fs !== (el.fontSize || 11)) clone.fontSize = fitted.fs;
        const left = (typeof clone.left === 'number') ? clone.left : TOP_MARGIN;
        const right = left + ((typeof clone.width === 'number' && clone.width > 0) ? clone.width : pageW - (TOP_MARGIN * 2));
        let top = (typeof clone.top === 'number' && clone.top >= TOP_MARGIN) ? clone.top : TOP_MARGIN;
        const blockers = placedTextBoxes.filter(box => left < box.right && right > box.left && top < box.bottom + 3 && top + fitted.height > box.top);
        if (blockers.length) top = Math.max.apply(null, blockers.map(box => box.bottom + 6));
        clone.top = Math.round(top * 10) / 10;
        const bottom = clone.top + fitted.height;
        if (bottom <= SAFE_BOTTOM || (fitted.fs <= MIN_FS && bottom <= pageH + 3)) {
          nextPage.elements.push(clone);
          placedTextBoxes.push({ left, right, top: clone.top, bottom });
        } else {
          const carryClone = JSON.parse(JSON.stringify(clone));
          carryClone.top = TOP_MARGIN;
          carry.push(carryClone);
        }
      });
      finalPages.push(nextPage);
    }

    doc.pages = finalPages;
    // Re-normaliser les pageIndex (0-based, ordre)
    doc.pages.forEach((p, i) => { p.pageIndex = i; });
    return doc;
  }

  function sanitizeAIElement(element) {
    if (!element || typeof element !== 'object' || Array.isArray(element)) return null;
    const aliases = { rect: 'rectangle', textbox: 'text' };
    const allowedTypes = new Set(['rectangle', 'text', 'circle', 'ellipse', 'triangle', 'line', 'star', 'image']);
    const clone = JSON.parse(JSON.stringify(element));
    clone.type = aliases[String(clone.type || '').toLowerCase()] || String(clone.type || '').toLowerCase();
    if (!allowedTypes.has(clone.type)) return null;

    const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const validColor = value => typeof value === 'string' && (/^#[0-9a-f]{3,8}$/i.test(value) || value.toLowerCase() === 'transparent');
    const bleed = clamp(finite(state.bleed, 3), 0, 20);
    const minX = clone.type === 'text' ? 0 : -bleed;
    const minY = clone.type === 'text' ? 0 : -bleed;
    clone.left = clamp(finite(clone.left, 0), minX, state.pageW);
    clone.top = clamp(finite(clone.top, 0), minY, state.pageH);
    clone.opacity = clamp(finite(clone.opacity, 1), 0, 1);

    ['fill', 'stroke', 'backgroundColor'].forEach(key => {
      if (clone[key] != null && !validColor(clone[key])) delete clone[key];
    });
    ['strokeWidth', 'rx', 'ry', 'innerRadius', 'charSpacing'].forEach(key => {
      if (clone[key] != null) clone[key] = Math.max(0, finite(clone[key], 0));
    });

    if (clone.type === 'line') {
      clone.x1 = clamp(finite(clone.x1, 0), -bleed, state.pageW + bleed);
      clone.x2 = clamp(finite(clone.x2, state.pageW), -bleed, state.pageW + bleed);
      clone.y1 = clamp(finite(clone.y1, 0), -bleed, state.pageH + bleed);
      clone.y2 = clamp(finite(clone.y2, 0), -bleed, state.pageH + bleed);
      clone.stroke = validColor(clone.stroke) ? clone.stroke : '#000000';
      clone.strokeWidth = clamp(finite(clone.strokeWidth, 1), 0.1, 20);
      return clone;
    }

    if (clone.type === 'circle' || clone.type === 'star') {
      clone.radius = clamp(finite(clone.radius, 25), 0.5, Math.max(state.pageW, state.pageH));
      if (clone.type === 'star') clone.points = Math.round(clamp(finite(clone.points, 5), 3, 24));
    } else if (clone.type === 'ellipse') {
      clone.rx = clamp(finite(clone.rx, 30), 0.5, state.pageW + bleed);
      clone.ry = clamp(finite(clone.ry, 20), 0.5, state.pageH + bleed);
    } else {
      clone.width = clamp(finite(clone.width, clone.type === 'text' ? state.pageW - clone.left : 50), 0.5, state.pageW + (bleed * 2));
      clone.height = clamp(finite(clone.height, clone.type === 'image' ? clone.width : 50), 0.5, state.pageH + (bleed * 2));
    }

    if (clone.type === 'text') {
      clone.width = clamp(clone.width, 5, Math.max(5, state.pageW - clone.left));
      clone.text = String(clone.text || '').slice(0, 12000);
      clone.fontSize = clamp(finite(clone.fontSize, 14), 8, 240);
      clone.fontFamily = normalizeFontFamily(clone.fontFamily) || 'Open Sans';
      clone.lineHeight = clamp(finite(clone.lineHeight, 1.4), 0.8, 3);
      if (!['left', 'center', 'right', 'justify'].includes(clone.textAlign)) clone.textAlign = 'left';
    } else if (clone.type === 'image') {
      const availableW = Math.max(1, state.pageW + bleed - clone.left);
      const availableH = Math.max(1, state.pageH + bleed - clone.top);
      const scale = Math.min(1, availableW / clone.width, availableH / clone.height);
      clone.width = Math.round(clone.width * scale * 10) / 10;
      clone.height = Math.round(clone.height * scale * 10) / 10;
    }
    return clone;
  }

  function buildDocFromParsed(parsed) {
    const pages = [];
    if (parsed.pages && parsed.pages.length) {
      parsed.pages.forEach((p, i) => {
        const idx = (typeof p.pageIndex === 'number') ? p.pageIndex : (typeof p.page === 'number' ? p.page - 1 : i);
        const elements = Array.isArray(p.elements) ? p.elements.map(sanitizeAIElement).filter(Boolean) : [];
        pages.push({ pageIndex: idx, elements });
      });
      pages.sort((a, b) => a.pageIndex - b.pageIndex);
    } else if (parsed.elements && parsed.elements.length) {
      pages.push({ pageIndex: 0, elements: parsed.elements.map(sanitizeAIElement).filter(Boolean) });
    }
    const targetPages = Math.round(Math.max(0, Math.min(12, Number(parsed.targetPages) || 0)));
    if (targetPages) {
      const pagesByIndex = new Map(pages.map(page => [page.pageIndex, page]));
      pages.length = 0;
      for (let pageIndex = 0; pageIndex < targetPages; pageIndex++) {
        pages.push(pagesByIndex.get(pageIndex) || { pageIndex, elements: [] });
      }
    }
    // 🆕 Attribuer des IDs stables à chaque élément (p{page}-b{bloc}[-l{ligne}]).
    // Ces IDs permettent à l'utilisateur (et à l'IA) de référencer précisément
    // un bloc ou une ligne : « supprime le bloc p2-b3 », « modifie la ligne 3 du bloc p11-b2 ».
    pages.forEach(p => {
      if (!Array.isArray(p.elements)) return;
      p.elements.forEach((el, bi) => {
        const isText = String(el.type || '').toLowerCase() === 'text' || String(el.type || '').toLowerCase() === 'textbox';
        const baseId = 'p' + (p.pageIndex + 1) + '-b' + (bi + 1);
        if (isText && typeof el.text === 'string') {
          // Découper en lignes visuelles estimées (retours ligne + longueur)
          const lines = el.text.split('\n');
          el._lines = lines;
          el.id = baseId + '-l1';
          // Chaque ligne a un id dérivable : p2-b3-l1, p2-b3-l2…
          lines.forEach((ln, li) => { el['_lineId_' + (li + 1)] = baseId + '-l' + (li + 1); });
        } else {
          el.id = baseId;
        }
      });
    });
    const effW = state.viewMode === 'spread' ? state.pageW * 2 : state.pageW;
    const doc = { w: state.pageW, h: state.pageH, effW, viewMode: state.viewMode, bleed: state.bleed, pages };
    // 🆕 2026-08-30 — Validateur de fin de page : les blocs qui dépassent sont
    //   reportés sur une nouvelle page (ou réduits en typo), jamais coupés.
    try { _spConstrainDocToPages(doc); } catch (_) {}
    return doc;
  }

  // 🆕 CORRECTION CIBLÉE — fusionne la réponse de l'IA avec la maquette courante.
  // Principe : seuls les éléments sélectionnés (par leur id) sont remplacés par la
  // version renvoyée par l'IA. Tous les autres éléments de l'ancienne maquette sont
  // conservés STRICTEMENT à l'identique (position, contenu, styles, ordre).
  function mergeTargetedChanges(oldDoc, parsed, selectedIds) {
    const selSet = new Set(selectedIds || []);
    // Indexer les éléments renvoyés par l'IA : id → élément (avec sa page)
    const newById = {};
    const newPages = Array.isArray(parsed.pages) && parsed.pages.length ? parsed.pages
      : (Array.isArray(parsed.elements) && parsed.elements.length ? [{ pageIndex: 0, elements: parsed.elements }] : []);
    newPages.forEach(p => {
      if (!Array.isArray(p.elements)) return;
      p.elements.forEach(el => {
        if (el && el.id) newById[el.id] = el;
      });
    });

    // Cloner l'ancienne maquette en profondeur
    const merged = {
      w: oldDoc.w, h: oldDoc.h, effW: oldDoc.effW, viewMode: oldDoc.viewMode, bleed: oldDoc.bleed,
      pages: oldDoc.pages.map(p => ({ pageIndex: p.pageIndex, elements: p.elements.map(e => JSON.parse(JSON.stringify(e))) }))
    };

    // Remplacer chaque élément sélectionné par sa version renvoyée (si dispo)
    merged.pages.forEach(p => {
      if (!Array.isArray(p.elements)) return;
      p.elements.forEach((el, i) => {
        if (el.id && selSet.has(el.id) && newById[el.id]) {
          // Conserver l'id + réattacher les infos de lignes si texte
          const replacement = JSON.parse(JSON.stringify(newById[el.id]));
          replacement.id = el.id;
          if (typeof replacement.text === 'string') {
            replacement._lines = replacement.text.split('\n');
            replacement._lineId_1 = el.id;
            replacement._lines.forEach((ln, li) => { replacement['_lineId_' + (li + 1)] = el.id.replace(/-l\d+$/, '') + '-l' + (li + 1); });
          }
          p.elements[i] = replacement;
        }
      });
    });

    // Si l'IA a supprimé un élément sélectionné (ex. « supprime ce bloc »), le retirer
    merged.pages.forEach(p => {
      if (!Array.isArray(p.elements)) return;
      p.elements = p.elements.filter(el => !(el.id && selSet.has(el.id)) || newById[el.id]);
    });

    return merged;
  }

  // ── Rendu Fabric ────────────────────────────────────────────
  function elementToFabric(el, bleedPx) {
    const ox = bleedPx, oy = bleedPx;
    const left = (el.left != null ? +el.left : 0) * MM_TO_PX + ox;
    const top = (el.top != null ? +el.top : 0) * MM_TO_PX + oy;
    const t = String(el.type || 'rectangle').toLowerCase();
    const opacity = (typeof el.opacity === 'number') ? el.opacity : 1;
    try {
      if (t === 'rectangle' || t === 'rect') return new fabric.Rect({ left, top, width: (+el.width || 50) * MM_TO_PX, height: (+el.height || 50) * MM_TO_PX, fill: el.fill || '#000000', stroke: el.stroke || null, strokeWidth: (+el.strokeWidth || 0) * MM_TO_PX, rx: (+el.rx || 0) * MM_TO_PX, ry: (+el.ry || 0) * MM_TO_PX, opacity });
      if (t === 'circle') return new fabric.Circle({ left, top, radius: (+el.radius || 25) * MM_TO_PX, fill: el.fill || '#000000', stroke: el.stroke || null, strokeWidth: (+el.strokeWidth || 0) * MM_TO_PX, opacity });
      if (t === 'ellipse') return new fabric.Ellipse({ left, top, rx: (+el.rx || 30) * MM_TO_PX, ry: (+el.ry || 20) * MM_TO_PX, fill: el.fill || '#000000', stroke: el.stroke || null, strokeWidth: (+el.strokeWidth || 0) * MM_TO_PX, opacity });
      if (t === 'triangle') return new fabric.Triangle({ left, top, width: (+el.width || 50) * MM_TO_PX, height: (+el.height || 50) * MM_TO_PX, fill: el.fill || '#000000', stroke: el.stroke || null, strokeWidth: (+el.strokeWidth || 0) * MM_TO_PX, opacity });
      if (t === 'line') return new fabric.Line([(+el.x1 || 0) * MM_TO_PX + ox, (+el.y1 || 0) * MM_TO_PX + oy, (+el.x2 || 100) * MM_TO_PX + ox, (+el.y2 || 0) * MM_TO_PX + oy], { stroke: el.stroke || '#000000', strokeWidth: (+el.strokeWidth || 1) * MM_TO_PX, opacity });
      if (t === 'star') {
        const numPoints = +el.points || 5;
        const outerR = (+el.radius || 30) * MM_TO_PX;
        const innerR = (+el.innerRadius || 0) * MM_TO_PX || outerR * 0.5;
        const pts = [];
        for (let si = 0; si < numPoints * 2; si++) {
          const r = si % 2 === 0 ? outerR : innerR;
          const a = (Math.PI * si) / numPoints - Math.PI / 2;
          pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
        }
        return new fabric.Polygon(pts, { left, top, fill: el.fill || '#000000', stroke: el.stroke || null, strokeWidth: (+el.strokeWidth || 0) * MM_TO_PX, opacity });
      }
      if (t === 'text' || t === 'textbox') {
        const fam = normalizeFontFamily(el.fontFamily) || 'Open Sans';
        const opts = { left, top, width: (+el.width || 200) * MM_TO_PX, fontSize: (+el.fontSize || 14) * PT_TO_PX, fill: el.fill || '#000000', fontFamily: fam, fontWeight: el.fontWeight || 'normal', fontStyle: el.fontStyle || 'normal', textAlign: el.textAlign || 'left', opacity, splitByGrapheme: false, breakWords: true };
        if (el.lineHeight != null) opts.lineHeight = +el.lineHeight;
        if (el.charSpacing != null) opts.charSpacing = +el.charSpacing;
        if (el.underline) opts.underline = true;
        if (el.linethrough) opts.linethrough = true;
        if (el.overline) opts.overline = true;
        if (el.backgroundColor) opts.backgroundColor = el.backgroundColor;
        return new fabric.Textbox(String(el.text || ''), opts);
      }
      if (t === 'image' && el.imageUrl) {
        const placeholder = new fabric.Rect({ left, top, width: (+el.width || 100) * MM_TO_PX, height: (+el.height || 100) * MM_TO_PX, fill: '#e8e8e8', stroke: 'transparent', strokeWidth: 0, opacity });
        placeholder._sp213ImageUrl = el.imageUrl;
        return placeholder;
      }
    } catch (err) {
      console.warn('[SP213] build object failed:', err, el);
    }
    return null;
  }

  function loadImages(c) {
    c.getObjects().forEach(obj => {
      if (obj._sp213ImageUrl) {
        const imgEl = new Image();
        imgEl.onload = function () {
          try {
            const img = new fabric.Image(imgEl);
            img.set({ left: obj.left, top: obj.top, scaleX: 1, scaleY: 1, opacity: obj.opacity != null ? obj.opacity : 1 });
            img.scaleToWidth(obj.width || 100);
            img.scaleToHeight(obj.height || 100);
            c.remove(obj);
            c.add(img);
            c.requestRenderAll();
          } catch (_) {}
        };
        imgEl.onerror = function () { obj.set({ fill: '#d0d0d0' }); c.requestRenderAll(); };
        imgEl.src = obj._sp213ImageUrl;
      }
    });
  }

  function renderDocument(doc) {
    const stack = $('pagesStack');
    stack.innerHTML = '';
    state.pages = [];
    if (!doc || !doc.pages.length) { $('pageInfo').textContent = ''; return; }
    const bleedPx = mmToPx(doc.bleed || 3);
    const pageWpx = mmToPx(doc.w);
    const pageHpx = mmToPx(doc.h);
    const effWpx = (doc.viewMode === 'spread') ? mmToPx(doc.effW || doc.w * 2) : pageWpx;

    doc.pages.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'page-card';
      card.style.position = 'relative';
      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = (doc.viewMode === 'spread') ? 'Spread ' + (p.pageIndex + 1) : 'Page ' + (p.pageIndex + 1);
      card.appendChild(label);
      // 🗑️ Corbeille : supprime cette page (visible au survol)
      const delBtn = document.createElement('button');
      delBtn.className = 'sp-page-del';
      delBtn.title = 'Delete this page';
      delBtn.setAttribute('aria-label', 'Delete this page');
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      delBtn.addEventListener('click', () => deletePage(p.pageIndex));
      card.appendChild(delBtn);
      const wrap = document.createElement('div');
      wrap.className = 'page-canvas-wrap';
      const canvasEl = document.createElement('canvas');
      canvasEl.width = Math.round(effWpx + bleedPx * 2);
      canvasEl.height = Math.round(pageHpx + bleedPx * 2);
      wrap.appendChild(canvasEl);
      wrap.style.width = (canvasEl.width) + 'px';
      card.appendChild(wrap);
      stack.appendChild(card);
      // Sélection ACTIVE : l'utilisateur peut cliquer/glisser sur les éléments pour
      // les « verrouiller » et demander à l'IA de retravailler UNIQUEMENT ceux-là.
      const c = new fabric.Canvas(canvasEl, { backgroundColor: '#ffffff', selection: true, preserveObjectStacking: true, renderOnAddRemove: false, selectionColor: 'rgba(26,127,55,.10)', selectionBorderColor: '#1a7f37', selectionLineWidth: 1 });
      p.elements.forEach(el => {
        const fo = elementToFabric(el, bleedPx);
        if (fo) {
          fo.id = el.id || ('p' + (p.pageIndex + 1) + '-b' + (p.elements.indexOf(el) + 1));
          fo._sp213Id = fo.id;
          fo.set({ selectable: true, evented: true, hasControls: true, hasBorders: true, borderColor: '#1a7f37', cornerColor: '#1a7f37', cornerSize: 8, transparentCorners: false });
          c.add(fo);
        }
      });
      addGuides(c, effWpx, pageHpx, bleedPx);
      // Éviter de sélectionner les repères (guides)
      c.getObjects().forEach(o => { if (o.isBleed || o.isMargin || o.isTrim) { o.set({ selectable: false, evented: false }); } });
      // Synchroniser state.selectedIds avec la sélection Fabric
      const syncSelection = () => {
        const sel = c.getActiveObjects();
        state.selectedIds = sel.filter(o => o._sp213Id).map(o => o._sp213Id);
        updateSelectionUI();
      };
      c.on('selection:created', syncSelection);
      c.on('selection:updated', syncSelection);
      c.on('selection:cleared', syncSelection);
      c.requestRenderAll();
      loadImages(c);
      state.pages.push({ pageIndex: p.pageIndex, canvas: c, label: 'Page ' + (p.pageIndex + 1) });
    });
    // 🆕 Nettoyer la sélection quand on régénère le document (nouvelle maquette)
    state.selectedIds = [];
    updateSelectionUI();
    rerenderAfterFontsReadyLocal();
    $('pageInfo').textContent = doc.pages.length + ' page(s) · ' + doc.w + '×' + doc.h + ' mm' + (doc.viewMode === 'spread' ? ' (spread)' : '') + ' · bleed ' + (doc.bleed || 3) + ' mm';
    $('formatInfo') && ($('formatInfo').textContent = '');
    if (window.matchMedia('(max-width: 900px)').matches) setMobileView('preview');
  }

  // 🆕 UI de sélection : affiche un bandeau « N élément(s) sélectionné(s) » et
  // permet de vider la sélection. Le prochain prompt ne retravaillera QUE ces éléments.
  function updateSelectionUI() {
    const bar = $('selectionBar');
    const n = (state.selectedIds || []).length;
    if (!bar) return;
    if (n === 0) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    bar.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = n + ' selected element' + (n > 1 ? 's' : '') + '. The next prompt will update only this selection.';
    bar.appendChild(span);
    const btn = document.createElement('button');
    btn.className = 'sel-clear';
    btn.textContent = 'Clear';
    btn.title = 'Clear selection';
    btn.addEventListener('click', clearSelection);
    bar.appendChild(btn);
  }
  function clearSelection() {
    state.selectedIds = [];
    (state.pages || []).forEach(p => { if (p.canvas) try { p.canvas.discardActiveObject(); p.canvas.requestRenderAll(); } catch(_){} });
    updateSelectionUI();
  }

  function applyZoom() {
    const z = parseFloat($('zoomSelect').value) || 1;
    $('pagesStack').style.transform = 'scale(' + z + ')';
    $('pagesStack').style.transformOrigin = 'top center';
  }
  function stepZoom(dir) {
    const sel = $('zoomSelect');
    const idx = sel.selectedIndex + dir;
    if (idx >= 0 && idx < sel.options.length) { sel.selectedIndex = idx; applyZoom(); }
  }

  function fitMobilePreview() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    const canvas = $('pagesStack').querySelector('canvas');
    const scroll = $('previewScroll');
    if (!canvas || !scroll) return;
    const availableWidth = Math.max(1, scroll.clientWidth - 24);
    const requiredScale = availableWidth / canvas.width;
    const scales = [1, 0.75, 0.5, 0.25];
    const scale = scales.find(value => value <= requiredScale) || 0.25;
    $('zoomSelect').value = String(scale);
    applyZoom();
  }

  function setMobileView(view) {
    const preview = view === 'preview';
    document.body.classList.toggle('mobile-view-preview', preview);
    document.body.classList.toggle('mobile-view-chat', !preview);
    $('mobilePreviewBtn').classList.toggle('active', preview);
    $('mobileChatBtn').classList.toggle('active', !preview);
    $('mobilePreviewBtn').setAttribute('aria-current', preview ? 'page' : 'false');
    $('mobileChatBtn').setAttribute('aria-current', preview ? 'false' : 'page');
    if (preview) requestAnimationFrame(fitMobilePreview);
    else requestAnimationFrame(() => $('promptInput').focus());
  }

  function initMobileDock() {
    setMobileView('chat');
    $('mobilePreviewBtn').addEventListener('click', () => setMobileView('preview'));
    $('mobileChatBtn').addEventListener('click', () => setMobileView('chat'));
    $('mobileNewBtn').addEventListener('click', () => { newConversation(); setMobileView('chat'); });
    $('mobileExportBtn').addEventListener('click', exportSP);
    $('mobileSettingsBtn').addEventListener('click', openLocalSettings);
  }
  function initPreviewWheelZoom() {
    const scroll = $('previewScroll');
    if (!scroll) return;
    const onWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const cur = parseFloat($('zoomSelect').value) || 1;
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoomValue(cur + delta);
      }
    };
    scroll.addEventListener('wheel', onWheel, { passive: false });
    const stack = $('pagesStack');
    if (stack) stack.addEventListener('wheel', onWheel, { passive: false });
  }
  // 🖱️ Séparateur draggable preview ↔ conversation (façon VS Code)
  function initSplitResize() {
    const handle = $('splitHandle');
    const split = $('split');
    const previewPane = $('previewPane');
    const chatPane = $('chatPane');
    if (!handle || !split || !previewPane || !chatPane) return;
    let dragging = false;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = split.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(60, Math.min(90, (x / rect.width) * 100));
      previewPane.style.flex = '1 1 ' + pct + '%';
      chatPane.style.flex = '1 1 ' + (100 - pct) + '%';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }
  function toggleGuides() {
    state.guidesVisible = !state.guidesVisible;
    state.pages.forEach(p => {
      if (!p || !p.canvas) return;
      p.canvas.getObjects().forEach(o => { if (o.isTrimBox || o.isBleed || o.isMargin) o.visible = state.guidesVisible; });
      p.canvas.requestRenderAll();
    });
  }

  // ── Persistance ─────────────────────────────────────────────
  function persistChat() { setLS(convStorageKey(LS.chat), JSON.stringify(state.chat.slice(-40))); }
  function persistDoc() { setLS(convStorageKey(LS.doc), JSON.stringify(state.doc)); }

  // ── Export .sp ──────────────────────────────────────────────
  function buildSPFile() {
    if (!state.pages.length) return null;
    const now = new Date();
    const bleedPx = mmToPx(state.bleed || 3);
    const pageWpx = mmToPx(state.pageW);
    const pageHpx = mmToPx(state.pageH);
    const spPages = state.pages.map((p) => {
      let objects = [];
      try {
        const docPage = (state.doc && state.doc.pages && state.doc.pages[p.pageIndex]) || null;
        const elements = (docPage && Array.isArray(docPage.elements)) ? docPage.elements : [];
        elements.forEach(el => {
          const t = String(el.type || '').toLowerCase();
          const op = (el.opacity != null) ? el.opacity : 1;
          const fill = (el.fill && /^#/.test(el.fill)) ? el.fill : '#000000';
          const stroke = (el.stroke && /^#/.test(el.stroke)) ? el.stroke : null;
          const strokeW = (el.strokeWidth != null) ? el.strokeWidth * MM_TO_PX : 0;
          const isFullBleed = (t === 'rectangle' || t === 'rect') && (el.left <= 0 && el.top <= 0 && el.width >= state.pageW - 1 && el.height >= state.pageH - 1);
          let left = (el.left != null ? +el.left : 0) * MM_TO_PX + bleedPx;
          let top = (el.top != null ? +el.top : 0) * MM_TO_PX + bleedPx;
          let width = (+el.width || 50) * MM_TO_PX;
          let height = (+el.height || 50) * MM_TO_PX;
          if (isFullBleed) { left = 0; top = 0; width = pageWpx + bleedPx * 2; height = pageHpx + bleedPx * 2; }
          if (t === 'rectangle' || t === 'rect') {
            objects.push({ type: 'rect', left, top, width, height, fill, opacity: op, scaleX: 1, scaleY: 1, stroke: stroke || '', strokeWidth: strokeW, rx: (el.rx || 0) * MM_TO_PX, ry: (el.ry || 0) * MM_TO_PX });
          } else if (t === 'circle') {
            objects.push({ type: 'circle', left: (el.left != null ? +el.left : 0) * MM_TO_PX + bleedPx, top: (el.top != null ? +el.top : 0) * MM_TO_PX + bleedPx, radius: (+el.radius || 25) * MM_TO_PX, fill, opacity: op, scaleX: 1, scaleY: 1, stroke: stroke || '', strokeWidth: strokeW });
          } else if (t === 'ellipse') {
            objects.push({ type: 'ellipse', left: (el.left != null ? +el.left : 0) * MM_TO_PX + bleedPx, top: (el.top != null ? +el.top : 0) * MM_TO_PX + bleedPx, rx: (+el.rx || 30) * MM_TO_PX, ry: (+el.ry || 20) * MM_TO_PX, fill, opacity: op, scaleX: 1, scaleY: 1, stroke: stroke || '', strokeWidth: strokeW });
          } else if (t === 'triangle') {
            objects.push({ type: 'triangle', left: (el.left != null ? +el.left : 0) * MM_TO_PX + bleedPx, top: (el.top != null ? +el.top : 0) * MM_TO_PX + bleedPx, width: (+el.width || 50) * MM_TO_PX, height: (+el.height || 50) * MM_TO_PX, fill, opacity: op, scaleX: 1, scaleY: 1, stroke: stroke || '', strokeWidth: strokeW });
          } else if (t === 'line') {
            objects.push({ type: 'line', x1: (+el.x1 || 0) * MM_TO_PX + bleedPx, y1: (+el.y1 || 0) * MM_TO_PX + bleedPx, x2: (+el.x2 || 100) * MM_TO_PX + bleedPx, y2: (+el.y2 || 0) * MM_TO_PX + bleedPx, stroke: el.stroke || '#000000', strokeWidth: Math.max(1, (+el.strokeWidth || 1) * MM_TO_PX), opacity: op, scaleX: 1, scaleY: 1 });
          } else if (t === 'text' || t === 'textbox') {
            const famT2 = normalizeFontFamily(el.fontFamily) || 'Open Sans';
            // 🛡️ FIX 2026-08-30 : estimer la HAUTEUR du textbox (sinon l'app SuperPrint
            //   verrouille _fixedHeight à 0 → texte invisible/écrasé). hauteur_px ≈
            //   nb_lignes × fontSize_pt × lineHeight × PT_TO_PX.
            const _fsPx = (+el.fontSize || 14) * PT_TO_PX;
            const _lh = el.lineHeight || 1.4;
            const _widthPx = (+el.width || 200) * MM_TO_PX;
            const _charW = _fsPx * 0.55; // largeur moyenne caractère en px (~pt×1.333×0.55)
            const _perLine = Math.max(1, Math.floor(_widthPx / _charW));
            const _lines = Math.max(1, Math.ceil(String(el.text || '').length / _perLine));
            const _heightPx = Math.max(_fsPx, Math.round(_lines * _fsPx * _lh));
            objects.push({ type: 'textbox', left: (el.left != null ? +el.left : 0) * MM_TO_PX + bleedPx, top: (el.top != null ? +el.top : 0) * MM_TO_PX + bleedPx, width: (+el.width || 200) * MM_TO_PX, height: _heightPx, text: el.text || '', fontSize: _fsPx, fill: (el.fill && /^#/.test(el.fill)) ? el.fill : '#000000', fontFamily: famT2, fontWeight: el.fontWeight || 'normal', fontStyle: el.fontStyle || 'normal', textAlign: el.textAlign || 'left', lineHeight: _lh, opacity: op, scaleX: 1, scaleY: 1 });
          } else if (t === 'image' && el.imageUrl) {
            objects.push({ type: 'image', left: (el.left != null ? +el.left : 0) * MM_TO_PX + bleedPx, top: (el.top != null ? +el.top : 0) * MM_TO_PX + bleedPx, width: (+el.width || 100) * MM_TO_PX, height: (+el.height || 100) * MM_TO_PX, opacity: op, scaleX: 1, scaleY: 1, _spAiImageUrl: el.imageUrl, _spAiImageScaleX: 1, _spAiImageScaleY: 1, fill: '#e8e8e8', stroke: 'transparent', strokeWidth: 0, rx: 2, ry: 2 });
          }
        });
      } catch (_) { objects = []; }
      return { index: p.pageIndex, label: p.label || ('Page ' + (p.pageIndex + 1)), masterId: null, objects };
    });
    const usedFonts = [...new Set(spPages.flatMap(p => p.objects.filter(o => o && o.fontFamily).map(o => o.fontFamily)))];
    const usedColors = [...new Set(spPages.flatMap(p => p.objects.filter(o => o && o.fill).map(o => String(o.fill))))].filter(c => /^#/.test(c));
    const totalObjects = spPages.reduce((n, p) => n + p.objects.length, 0);
    return {
      _sp: { format: 'SuperPrint Document', version: '1.0.0', engine: 'Fabric.js 5.3.0', created: now.toISOString(), modified: now.toISOString(), generator: 'SP213 Studio Local' },
      meta: { title: 'Maquette SP213', author: '', description: 'Généré par SP213 Studio Local', tags: ['sp213'], stats: { pages: spPages.length, objects: totalObjects, textBlocks: 0, images: 0, shapes: 0, totalObjects } },
      document: { format: { width: state.pageW, height: state.pageH, unit: 'mm', orientation: state.pageW > state.pageH ? 'landscape' : 'portrait' }, margin: 20, bleed: state.bleed, viewMode: (state.viewMode === 'spread' ? 'spread' : 'single'), colorMode: 'rgb' },
      resources: { fonts: usedFonts, colors: usedColors },
      textLinks: {}, guides: {}, masters: { templates: {}, assignments: {} },
      numbering: { enabled: false, startAt: 1, position: 'bottom-center', fontFamily: 'Open Sans', fontSize: 10, fontColor: '#333333', prefix: '', suffix: '', style: 'decimal', marginBottom: 15, marginSide: 20 },
      pages: spPages
    };
  }

  function exportSP() {
    const spFile = buildSPFile();
    if (!spFile) { appendChat('assistant', 'There is no layout to export. Describe what you want to create first.'); return; }
    const json = JSON.stringify(spFile, null, 2);
    const blob = new Blob([json], { type: 'application/x-superprint+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    a.download = `sp213-${state.pageW}x${state.pageH}-${state.pages.length}p-${d.toISOString().slice(0, 10).replace(/-/g, '')}.sp`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    appendChat('assistant', '.sp file downloaded (' + state.pages.length + ' page(s)). Import it in SuperPrint using Import > Load JSON / .sp.');
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    initPreHome();
    buildQuickChips();
    initMobileDock();

    $('sendBtn').addEventListener('click', sendMessage);
    $('promptInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    $('exportSpBtn').addEventListener('click', exportSP);
    $('newDocBtn').addEventListener('click', newConversation);
    $('settingsBtn').addEventListener('click', openLocalSettings);
    $('prefsEngine').addEventListener('change', (event) => {
      capturePreferencesForm();
      renderPreferencesEngine(event.target.value);
    });
    $('localSettingsSave').addEventListener('click', saveLocalSettings);
    $('localSettingsCancel').addEventListener('click', closeLocalSettings);
    $('localSettingsClose').addEventListener('click', closeLocalSettings);
    $('localSettingsModal').addEventListener('click', (event) => {
      if (event.target === $('localSettingsModal')) closeLocalSettings();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('localSettingsModal').classList.contains('hidden')) closeLocalSettings();
    });
    $('themeTopBtn').addEventListener('click', toggleTheme);
    // 🆕 Conversations multiples : gérées via les onglets #convTabs (renderConvTabs).
    // 🔘 Ouvrir dans SuperPrint (bas de la preview) → ouvre l'app PAO locale
    const openSpBtn = $('openSpBtn');
    if (openSpBtn) openSpBtn.addEventListener('click', () => openSuperPrintLocal());
    // 🆕 Undo / Redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const t = document.activeElement;
      const inTextarea = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
      if (e.key.toLowerCase() === 'z') {
        if (e.shiftKey) { if (inTextarea) return; e.preventDefault(); redoMaquette(); }
        else { if (inTextarea) return; e.preventDefault(); undoMaquette(); }
      } else if (e.key.toLowerCase() === 'y' && !inTextarea) {
        e.preventDefault(); redoMaquette();
      }
    });
    // Bouton « SuperPrint » dans la topbar du studio → ouvre l'app PAO locale
    const openSpLocal = $('openSpLocalBtn');
    if (openSpLocal) openSpLocal.addEventListener('click', () => openSuperPrintLocal());

    $('zoomSelect').addEventListener('change', applyZoom);
    $('zoomIn').addEventListener('click', () => stepZoom(1));
    $('zoomOut').addEventListener('click', () => stepZoom(-1));
    $('guidesToggle').addEventListener('click', toggleGuides);
    $('undoBtn') && $('undoBtn').addEventListener('click', undoMaquette);
    $('redoBtn') && $('redoBtn').addEventListener('click', redoMaquette);
    initPreviewWheelZoom();
    initSplitResize();

    $('attachBtn').addEventListener('click', () => $('attachInput').click());
    $('attachInput').addEventListener('change', (e) => handleAttachFiles(e.target.files));

    // 🆕 Tooltips : 3 apparitions max par session.
    initTipLimit();

    // 🎙️ Prompt vocal (Web Speech API)
    initVoicePrompt();
  }

  // ── Limitation des tooltips (3 apparitions max par session) ──
  function initTipLimit() {
    const TIP_LS = 'sp213_tips_shown';
    let shown = 0;
    try { shown = parseInt(sessionStorage.getItem(TIP_LS) || '0', 10) || 0; } catch (_) {}
    const tipsEls = Array.from(document.querySelectorAll('.tip-wrap'));
    if (shown >= 3) {
      document.body.classList.add('tips-disabled');
      return;
    }
    tipsEls.forEach(wrap => {
      const onShow = () => {
        shown++;
        try { sessionStorage.setItem(TIP_LS, String(shown)); } catch (_) {}
        if (shown >= 3) document.body.classList.add('tips-disabled');
      };
      wrap.addEventListener('mouseenter', onShow);
      wrap.addEventListener('focus', onShow);
    });
  }

  // ── Prompt vocal (Web Speech API) ──────────────────────────
  let speechRec = null;
  let speechListening = false;
  function initVoicePrompt() {
    const btn = $('micBtn');
    if (!btn) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btn.disabled = true;
      btn.title = 'Prompt vocal non disponible dans ce navigateur (utilisez Chrome ou Edge)';
      return;
    }
    btn.addEventListener('click', () => {
      if (speechListening) { stopVoicePrompt(); return; }
      try {
        speechRec = new SR();
        speechRec.lang = 'fr-FR';
        speechRec.interimResults = true;
        speechRec.continuous = false;
        const input = $('promptInput');
        const base = input.value;
        speechRec.onresult = (e) => {
          let interim = '', final = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t; else interim += t;
          }
          input.value = (base ? base + ' ' : '') + final + interim;
          input.focus();
        };
        speechRec.onend = () => { setVoiceUI(false); speechListening = false; };
        speechRec.onerror = (e) => {
          setVoiceUI(false); speechListening = false;
          if (e.error !== 'aborted') {
            appendChat('assistant', 'Voice prompt unavailable (' + (e.error || 'microphone error') + '). Check the microphone permission.');
          }
        };
        speechRec.start();
        speechListening = true;
        setVoiceUI(true);
      } catch (err) {
        speechListening = false;
        setVoiceUI(false);
        appendChat('assistant', 'Unable to start voice input: ' + (err && err.message ? err.message : err));
      }
    });
  }
  function setVoiceUI(on) {
    const btn = $('micBtn');
    if (!btn) return;
    btn.classList.toggle('listening', on);
    btn.title = on ? 'Arrêter la dictée' : 'Dicter votre prompt (vocal)';
  }
  function stopVoicePrompt() {
    if (speechRec) { try { speechRec.stop(); } catch (_) {} }
    setVoiceUI(false);
    speechListening = false;
  }

  // Thème : BLANC par défaut (DA SuperPrint). Le sombre est un choix utilisateur.
  let themeDark = false;
  function setTheme(dark) {
    themeDark = dark;
    document.body.classList.toggle('theme-dark', dark);
    try { localStorage.setItem('sp213_theme_v1', dark ? '1' : '0'); } catch (_) {}
  }
  function toggleTheme() { setTheme(!themeDark); }

  try {
    const th = localStorage.getItem('sp213_theme_v1');
    if (th !== null) setTheme(th === '1');
  } catch (_) {}

  // ── Polices ─────────────────────────────────────────────────
  // Le studio local réutilise les polices self-hosted de SuperPrint
  // (public/superprint/CSS/fonts.css). Sans elles, les typos Bebas Neue,
  // Playfair Display, Montserrat, Poppins… s'affichent en fallback dans
  // l'aperçu Fabric du studio.
  const SP213_FONTS = {
    display: ['Bebas Neue', 'Playfair Display', 'Montserrat', 'Poppins'],
    body: ['Open Sans', 'IBM Plex Sans', 'Roboto', 'Lato', 'Noto Sans JP'],
    mono: ['IBM Plex Mono', 'JetBrains Mono', 'Fira Code', 'Space Mono']
  };
  const SP213_FONT_NAMES = [...SP213_FONTS.display, ...SP213_FONTS.body, ...SP213_FONTS.mono];

  // 🆕 Normalisation des polices : mappe les variantes / synonymes vers une police
  // self-hosted disponible, et renvoie null si aucune correspondance.
  const SP213_FONT_SYNONYMS = {
    'opensans': 'Open Sans', 'open-sans': 'Open Sans', 'open sans': 'Open Sans',
    'inter': 'Open Sans', 'arial': 'Open Sans', 'helvetica': 'Open Sans',
    'montserrat': 'Montserrat',
    'poppins': 'Poppins', 'pp': 'Poppins',
    'playfair': 'Playfair Display', 'playfairdisplay': 'Playfair Display', 'playfair-display': 'Playfair Display',
    'display fair': 'Playfair Display', 'displayfair': 'Playfair Display', 'fair display': 'Playfair Display',
    'bebas': 'Bebas Neue', 'bebasneue': 'Bebas Neue', 'bebas-neue': 'Bebas Neue',
    'roboto': 'Roboto',
    'lato': 'Lato',
    'ibm plex sans': 'IBM Plex Sans', 'ibmplexsans': 'IBM Plex Sans', 'ibm-plex-sans': 'IBM Plex Sans',
    'ibm plex mono': 'IBM Plex Mono', 'ibmplexmono': 'IBM Plex Mono', 'ibm-plex-mono': 'IBM Plex Mono',
    'jetbrains mono': 'JetBrains Mono', 'jetbrainsmono': 'JetBrains Mono', 'jetbrains-mono': 'JetBrains Mono',
    'fira code': 'Fira Code', 'firacode': 'Fira Code', 'fira-code': 'Fira Code',
    'space mono': 'Space Mono', 'spacemono': 'Space Mono', 'space-mono': 'Space Mono',
    'noto sans jp': 'Noto Sans JP', 'notosansjp': 'Noto Sans JP', 'noto-sans-jp': 'Noto Sans JP', 'noto': 'Noto Sans JP'
  };
  function normalizeFontFamily(f) {
    if (!f) return null;
    const raw = String(f).trim();
    if (SP213_FONT_NAMES.includes(raw)) return raw;
    const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (SP213_FONT_SYNONYMS[key]) return SP213_FONT_SYNONYMS[key];
    // Essayer une correspondance partielle (ex. "OpenSans" → "Open Sans")
    const compact = raw.replace(/\s+/g, '').toLowerCase();
    const hit = SP213_FONT_NAMES.find(n => n.replace(/\s+/g, '').toLowerCase() === compact);
    if (hit) return hit;
    return null;
  }

  function loadStudioFonts() {
    try {
      if (!document.getElementById('sp213-fonts-css')) {
        const link = document.createElement('link');
        link.id = 'sp213-fonts-css';
        link.rel = 'stylesheet';
        link.href = '/superprint/CSS/fonts.css';
        document.head.appendChild(link);
        // ⏳ Précharger les polices UNE FOIS le CSS chargé/appliqué (sinon le
        // navigateur ne connaît pas encore les @font-face → rien ne se charge).
        const doPreload = () => preloadStudioFontsLocal();
        if (link.sheet) doPreload();
        else {
          link.addEventListener('load', doPreload);
          link.addEventListener('error', doPreload);
        }
        return;
      }
    } catch (_) {}
    preloadStudioFontsLocal();
  }

  function preloadStudioFontsLocal() {
    try {
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;top:-9999px;left:-9999px;visibility:hidden;font-size:72px;width:200px;height:100px;overflow:hidden;pointer-events:none;';
      div.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÀÂÉÈÊÎÔÛÇ’“”';
      document.body.appendChild(div);
      SP213_FONT_NAMES.forEach(f => {
        div.style.fontFamily = '"' + f + '", sans-serif';
        div.style.fontWeight = '400';
        div.style.fontStyle = 'normal';
        void div.offsetHeight;
        if (f === 'Open Sans' || f === 'Poppins' || f === 'Playfair Display' || f === 'Montserrat' || f === 'Lato' || f === 'IBM Plex Sans') {
          div.style.fontWeight = '700';
          void div.offsetHeight;
        }
        div.style.fontWeight = '400';
        div.style.fontStyle = 'italic';
        void div.offsetHeight;
      });
      document.body.removeChild(div);
    } catch (_) {}
  }

  function rerenderAfterFontsReadyLocal() {
    try {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          try {
            state.pages.forEach(p => {
              if (p && p.canvas && typeof p.canvas.requestRenderAll === 'function') p.canvas.requestRenderAll();
            });
          } catch (_) {}
        }).catch(() => {});
      }
    } catch (_) {}
  }

  loadStudioFonts();
  preloadStudioFontsLocal();
  rerenderAfterFontsReadyLocal();
  init();
})();
