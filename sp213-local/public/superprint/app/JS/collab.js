/* =========================================================================
   SUPERPRINT — Collab P2P (WebRTC)
   ------------------------------------------------------------------------
   Mode collaboration peer-to-peer pour SUPERPRINT.
   - WebRTC RTCPeerConnection + DataChannel reliable
   - Signalisation MANUELLE par copier/coller (offer/answer)  -> aucun serveur
   - Sync des objets Fabric : add / modify / remove / clear
   - Sync de page courante
   - Awareness : curseur distant + nom + couleur
   - Anti-boucle (origin tag), throttle, reconnexion graceful
   - Stockage prefs (pseudo, couleur) en localStorage
   ------------------------------------------------------------------------
   Exposes:  window.SPCollab
   v=20260505-v001
   ========================================================================= */
(function () {
    'use strict';

    const VERSION = '20260507-v015-collab-resilience-disclaimer';
    const DEBUG = true; // verbose console logs for collab debugging
    const STUN = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
    ];
    const CHANNEL_LABEL = 'superprint-collab';
    const CURSOR_THROTTLE_MS = 50;     // ~20 Hz
    const HELLO_INTERVAL_MS = 5000;
    const SYNC_DEBOUNCE_MS = 60;
    // 🛡️ v015 (2026-05-07) : keepalive + watchdog pour fiabilite P2P.
    //   - PING toutes les 3 s : maintient les mappings NAT (cause #1 des coupures
    //     residentielles/4G apres 30-60 s d'inactivite reseau).
    //   - DEAD_AFTER : aucun trafic recu depuis X ms => on bascule en mode
    //     "reconnexion en cours" (status visible + tentative ICE restart cote host).
    //   - GIVEUP_AFTER : si toujours rien => disconnect propre + invite a Regenerer.
    const PING_INTERVAL_MS  = 3000;
    const DEAD_AFTER_MS     = 12000;   // ~4 pings rates
    const GIVEUP_AFTER_MS   = 45000;   // 45 s sans trafic => session morte

    // SUPERPRINT custom Fabric properties to preserve in serialization.
    // 🛡️ FIX 2026-05-05 v005 : SP_CUSTOM_PROPS est déclaré `const` au top-level
    // de main.js (script classique) → partagé entre scripts mais NON attaché
    // à window. On tente window.SP_CUSTOM_PROPS PUIS un eval direct du nom.
    function getCustomProps() {
        let sp = [];
        try {
            if (typeof window !== 'undefined' && Array.isArray(window.SP_CUSTOM_PROPS)) {
                sp = window.SP_CUSTOM_PROPS;
            } else if (typeof SP_CUSTOM_PROPS !== 'undefined' && Array.isArray(SP_CUSTOM_PROPS)) {
                sp = SP_CUSTOM_PROPS;
            }
        } catch (_) { /* SP_CUSTOM_PROPS not yet defined */ }
        // _collabId must always be in the export keys, otherwise IDs are dropped
        return Array.from(new Set([...sp, '_collabId']));
    }

    // --- State -----------------------------------------------------------
    const state = {
        pc: null,
        channel: null,
        role: null,             // 'host' | 'guest'
        connected: false,
        peer: { name: null, color: null },
        me: loadIdentity(),
        suppressEcho: false,    // when applying remote ops, ignore local fabric events
        lastCursorAt: 0,
        helloTimer: null,
        cursorEl: null,
        // v015 resilience
        pingTimer: null,
        watchdogTimer: null,
        lastSeenAt: 0,          // performance.now() of last incoming message
        reconnecting: false,    // visible "trying to recover" state
        iceRestartTried: false  // prevent ICE restart loop
    };

    // --- i18n (bilingual FR/EN, follows window.currentLanguage) ---------
    const I18N = {
        en: {
            connected_with: 'Connected with ',
            channel_open: 'P2P channel open',
            channel_closed: 'Channel closed',
            paste_peer_reply: 'Paste the peer reply',
            reply_accepted: 'Reply accepted — connecting…',
            invalid_reply: 'Invalid reply',
            paste_host_invite: "Paste the host invitation",
            invalid_invite: 'Invalid invitation',
            disconnected: 'Disconnected',
            nothing_to_copy: 'Nothing to copy',
            copied_clipboard: 'Copied to clipboard',
            copied: 'Copied',
            invite_placeholder: 'The invitation/reply will appear here…'
        },
        fr: {
            connected_with: 'Connecté avec ',
            channel_open: 'Canal P2P ouvert',
            channel_closed: 'Canal fermé',
            paste_peer_reply: 'Colle la réponse du pair',
            reply_accepted: 'Réponse acceptée — connexion en cours…',
            invalid_reply: 'Réponse invalide',
            paste_host_invite: "Colle l'invitation de l'hôte",
            invalid_invite: 'Invitation invalide',
            disconnected: 'Déconnecté',
            nothing_to_copy: 'Rien à copier',
            copied_clipboard: 'Copié dans le presse-papiers',
            copied: 'Copié',
            invite_placeholder: "L'invitation/réponse apparaîtra ici…"
        }
    };
    function lang() {
        const l = (typeof window !== 'undefined' && window.currentLanguage) || document.documentElement.lang || 'en';
        return (String(l).toLowerCase().startsWith('fr')) ? 'fr' : 'en';
    }
    function t(key) { return (I18N[lang()] && I18N[lang()][key]) || I18N.en[key] || key; }

    // Apply data-i18n-{fr,en}[-html|-placeholder] attributes inside the collab modal
    function applyI18n() {
        const root = document.getElementById('collabModal');
        if (!root) return;
        const L = lang();
        root.querySelectorAll('[data-i18n-' + L + ']').forEach(el => {
            el.textContent = el.getAttribute('data-i18n-' + L);
        });
        root.querySelectorAll('[data-i18n-' + L + '-html]').forEach(el => {
            el.innerHTML = el.getAttribute('data-i18n-' + L + '-html');
        });
        root.querySelectorAll('[data-i18n-' + L + '-placeholder]').forEach(el => {
            el.setAttribute('placeholder', el.getAttribute('data-i18n-' + L + '-placeholder'));
        });
    }

    // --- Identity --------------------------------------------------------
    function loadIdentity() {
        try {
            const raw = localStorage.getItem('sp_collab_identity');
            if (raw) return JSON.parse(raw);
        } catch (_) {}
        return {
            name: 'User-' + Math.floor(Math.random() * 9000 + 1000),
            color: pickColor()
        };
    }
    function saveIdentity() {
        try { localStorage.setItem('sp_collab_identity', JSON.stringify(state.me)); } catch (_) {}
    }
    function pickColor() {
        const palette = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa',
                         '#007aff', '#5856d6', '#af52de', '#ff2d55', '#00b894'];
        return palette[Math.floor(Math.random() * palette.length)];
    }

    // --- Helpers : canvases ----------------------------------------------
    // 🛡️ FIX 2026-05-06 v007 : main.js declares `let canvases = []` and
    // `let currentPageIndex = 0` at the top level of a CLASSIC script, which
    // makes them visible to other classic scripts BY NAME (script-shared
    // lexical scope) but they are NOT attached to `window`. Trying only
    // `window.canvases` returned an empty list → no Fabric listeners were
    // ever attached, so neither incoming nor outgoing object ops worked
    // (the WebRTC channel was open but the user "saw nothing").
    // We now try window first, then bare-name via try/catch.
    function getCanvases() {
        try {
            if (typeof window !== 'undefined' && Array.isArray(window.canvases) && window.canvases.length) {
                return window.canvases.filter(Boolean);
            }
        } catch (_) {}
        try {
            // eslint-disable-next-line no-undef
            if (typeof canvases !== 'undefined' && Array.isArray(canvases)) {
                // eslint-disable-next-line no-undef
                return canvases.filter(Boolean);
            }
        } catch (_) {}
        try {
            if (typeof window !== 'undefined' && Array.isArray(window.spCanvases) && window.spCanvases.length) {
                return window.spCanvases.filter(Boolean);
            }
        } catch (_) {}
        return [];
    }
    function getActiveCanvasIndex() {
        try {
            if (typeof window !== 'undefined' && typeof window.currentPageIndex === 'number') return window.currentPageIndex;
        } catch (_) {}
        try {
            // eslint-disable-next-line no-undef
            if (typeof currentPageIndex === 'number') return currentPageIndex;
        } catch (_) {}
        const all = getCanvases();
        return all.length ? 0 : -1;
    }
    function getCanvasByIndex(i) {
        const all = getCanvases();
        return all[i] || null;
    }

    // --- Send / recv -----------------------------------------------------
    function send(msg) {
        if (!state.channel || state.channel.readyState !== 'open') {
            if (DEBUG) console.warn('[Collab] send skipped, channel not open. type=', msg && msg.type, 'state=', state.channel && state.channel.readyState);
            return;
        }
        try {
            state.channel.send(JSON.stringify(msg));
            if (DEBUG && msg.type !== 'cursor' && msg.type !== 'hello') console.log('[Collab] → send', msg.type, 'page=', msg.page, 'id=', msg.id);
        } catch (e) { console.warn('[Collab] send fail', e); }
    }

    function handleMessage(raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch (_) { return; }
        if (!msg || !msg.type) return;
        if (DEBUG && msg.type !== 'cursor' && msg.type !== 'hello') console.log('[Collab] ← recv', msg.type, 'page=', msg.page, 'id=', msg.id);
        switch (msg.type) {
            case 'hello':
                state.peer.name = msg.name || 'Peer';
                state.peer.color = msg.color || '#888';
                updateBadge();
                showToast(t('connected_with') + state.peer.name);
                // Update wizard "connected" step with peer name + color
                const peerEl = document.getElementById('cw-peerName');
                if (peerEl) {
                    peerEl.innerHTML = (lang() === 'fr' ? 'avec ' : 'with ')
                        + '<b style="color:' + state.peer.color + '">' + escapeHtml(state.peer.name) + '</b>';
                }
                break;
            case 'cursor':
                showRemoteCursor(msg);
                break;
            case 'obj:add':
            case 'obj:mod':
            case 'obj:rm':
            case 'page:full':
            case 'page:switch':
                applyRemoteOp(msg);
                break;
            case 'doc:replace':
                applyRemoteDocReplace(msg);
                break;
            case 'request:full':
                broadcastFullSnapshot();
                break;
            case 'request:doc':
                broadcastFullDoc();
                break;
            case 'ping':
                // 🛡️ v015 keepalive : reply immediately (NAT mapping refresh both ways)
                try { send({ type: 'pong', t: msg.t }); } catch (_) {}
                break;
            case 'pong':
                // round-trip ack (no-op : lastSeenAt already updated by onmessage)
                break;
            default:
                console.log('[Collab] unknown msg', msg);
        }
    }

    // --- WebRTC plumbing -------------------------------------------------
    function createPeer(role) {
        teardown();
        state.role = role;
        state.pc = new RTCPeerConnection({ iceServers: STUN });

        state.pc.onicecandidate = (ev) => {
            if (!ev.candidate) {
                // ICE gathering complete : the SDP in pc.localDescription is now final
                try { if (state.iceTimeout) { clearTimeout(state.iceTimeout); state.iceTimeout = null; } } catch (_) {}
                const code = btoa(JSON.stringify(state.pc.localDescription));
                if (state.role === 'host') {
                    const link = makeInviteUrl(code);
                    const ta = document.getElementById('collabLocalSDP');
                    if (ta) ta.value = link;
                    // v014 : also fill the visible read-only preview input
                    const preview = document.getElementById('cw-hostLinkPreview');
                    if (preview) preview.value = link;
                    autoCopy(link).then(ok => {
                        const st = document.getElementById('cw-host-status');
                        if (st) {
                            st.textContent = ok
                                ? (lang() === 'fr' ? 'Lien copié dans le presse-papiers. En attente de la réponse de votre invité…' : 'Link copied to clipboard. Waiting for your guest to reply…')
                                : (lang() === 'fr' ? 'Lien prêt — copiez-le manuellement et envoyez-le à votre invité.' : 'Link ready — copy it manually and send it to your guest.');
                            st.style.color = ok ? '#1a8f5e' : '#d97706';
                        }
                    });
                } else {
                    const ta = document.getElementById('cw-myReply');
                    if (ta) ta.value = code;
                    document.getElementById('cw-replyBlock').style.display = 'block';
                    autoCopy(code);
                }
            }
        };
        // 🛡️ v015 : do NOT tear down on transient 'disconnected' (mobile / wifi roam
        //   often recovers in 5-15 s). Only react to 'failed' / 'closed'.
        state.pc.onconnectionstatechange = () => {
            const s = state.pc && state.pc.connectionState;
            if (DEBUG) console.log('[Collab] pc state', s);
            if (s === 'failed' || s === 'closed') {
                state.connected = false;
                updateBadge();
                showReconnectStatus(false, true /* failed */);
            } else if (s === 'connected') {
                // recovery!
                if (state.reconnecting) {
                    state.reconnecting = false;
                    state.iceRestartTried = false;
                    showToast((lang() === 'fr') ? 'Connexion retablie' : 'Connection restored');
                }
                updateBadge();
            }
        };
        state.pc.oniceconnectionstatechange = () => {
            const s = state.pc && state.pc.iceConnectionState;
            if (DEBUG) console.log('[Collab] ice state', s);
            if (s === 'disconnected') {
                showReconnectStatus(true, false);
                tryIceRestart();
            } else if (s === 'connected' || s === 'completed') {
                if (state.reconnecting) {
                    state.reconnecting = false;
                    state.iceRestartTried = false;
                    showReconnectStatus(false, false);
                }
            } else if (s === 'failed') {
                showReconnectStatus(false, true);
            }
        };

        if (role === 'host') {
            state.channel = state.pc.createDataChannel(CHANNEL_LABEL, { ordered: true });
            wireChannel();
        } else {
            state.pc.ondatachannel = (ev) => {
                state.channel = ev.channel;
                wireChannel();
            };
        }
    }

    function wireChannel() {
        state.channel.onopen = () => {
            state.connected = true;
            state.lastSeenAt = performance.now();
            state.reconnecting = false;
            state.iceRestartTried = false;
            updateBadge();
            // Send hello once + start hello loop (peer identity refresh)
            sayHello();
            if (state.helloTimer) clearInterval(state.helloTimer);
            state.helloTimer = setInterval(sayHello, HELLO_INTERVAL_MS);
            // 🛡️ v015 : faster keepalive ping (NAT mapping) + watchdog.
            startKeepalive();
            // Host pushes initial full snapshot ; guest requests one
            if (state.role === 'host') {
                setTimeout(() => {
                    if (typeof window.saveProjectSP_toObject === 'function') {
                        broadcastFullDoc();
                    } else {
                        broadcastFullSnapshot();
                    }
                }, 200);
            } else {
                send({ type: 'request:doc' });
            }
            // Show "connected" wizard step (auto-close after a short delay)
            showStep('ok');
            const modal = document.getElementById('collabModal');
            setTimeout(() => { if (modal) modal.style.display = 'none'; }, 1800);
            showToast(t('channel_open'));
        };
        state.channel.onclose = () => {
            state.connected = false;
            stopKeepalive();
            updateBadge();
            showToast(t('channel_closed'), 'warn');
        };
        state.channel.onmessage = (ev) => {
            state.lastSeenAt = performance.now();
            handleMessage(ev.data);
        };
    }

    // ── v015 : keepalive ping/pong + watchdog ────────────────────────────
    function startKeepalive() {
        stopKeepalive();
        state.pingTimer = setInterval(() => {
            // Send a tiny ping to keep NAT mappings alive even when both users
            // are idle. Failure to send (channel closed / buffered) is silent.
            try { send({ type: 'ping', t: Date.now() }); } catch (_) {}
        }, PING_INTERVAL_MS);
        state.watchdogTimer = setInterval(() => {
            if (!state.connected) return;
            const since = performance.now() - state.lastSeenAt;
            if (since > GIVEUP_AFTER_MS) {
                // Definitive : tear down + tell user to regenerate
                stopKeepalive();
                showToast((lang() === 'fr')
                    ? 'Connexion perdue. Cliquez sur Collab puis Regenerer pour reprendre.'
                    : 'Connection lost. Click Collab then Regenerate to resume.', 'err');
                try { teardown(); } catch (_) {}
                try { showStep('choice'); } catch (_) {}
            } else if (since > DEAD_AFTER_MS) {
                // Soft : show "reconnecting" + try ICE restart on host
                if (!state.reconnecting) {
                    showReconnectStatus(true, false);
                    tryIceRestart();
                }
            }
        }, 2000);
    }
    function stopKeepalive() {
        try { if (state.pingTimer) clearInterval(state.pingTimer); } catch (_) {}
        try { if (state.watchdogTimer) clearInterval(state.watchdogTimer); } catch (_) {}
        state.pingTimer = null;
        state.watchdogTimer = null;
    }

    // ICE restart (host-side only ; guest can't initiate without renegotiation
    //   over our manual signalling channel). For our manual-paste design we just
    //   call pc.restartIce() ; if it recovers (same SDP, fresh candidates) the
    //   data channel keeps working without any user action.
    function tryIceRestart() {
        if (state.iceRestartTried) return;
        if (!state.pc || state.role !== 'host') return;
        state.iceRestartTried = true;
        try {
            if (typeof state.pc.restartIce === 'function') {
                if (DEBUG) console.log('[Collab] ICE restart requested');
                state.pc.restartIce();
            }
        } catch (e) { if (DEBUG) console.warn('[Collab] restartIce fail', e); }
    }

    function showReconnectStatus(on, failed) {
        state.reconnecting = !!on;
        const btn = document.getElementById('openCollabBtn');
        if (btn) {
            btn.classList.toggle('collab-reconnecting', !!on);
            const dot = btn.querySelector('.collab-dot');
            if (dot) dot.style.background = failed ? '#c0392b' : (on ? '#d97706' : (state.connected ? '#34c759' : '#aaa'));
        }
        if (on) {
            showToast((lang() === 'fr') ? 'Reseau instable - tentative de reconnexion...' : 'Unstable network - reconnecting...', 'warn');
        } else if (failed) {
            showToast((lang() === 'fr') ? 'Connexion perdue' : 'Connection lost', 'err');
        }
    }

    async function createOffer() {
        createPeer('host');
        const offer = await state.pc.createOffer();
        await state.pc.setLocalDescription(offer);
        // wait for ICE complete via onicecandidate(null) — already wired
        const ta = document.getElementById('collabLocalSDP');
        if (ta) ta.placeholder = (lang() === 'fr') ? 'Génération en cours… (≤5s)' : 'Generating… (≤5s)';
        // 🛡️ v013 : ICE-completion safety timeout. Some restrictive networks
        //   never fire icecandidate(null). After 8s we tell the user to retry / regenerate.
        try { if (state.iceTimeout) clearTimeout(state.iceTimeout); } catch (_) {}
        state.iceTimeout = setTimeout(() => {
            const st = document.getElementById('cw-host-status');
            const localTa = document.getElementById('collabLocalSDP');
            if (localTa && !localTa.value && st) {
                st.style.color = '#d97706';
                st.textContent = (lang() === 'fr')
                    ? 'Le réseau bloque la génération ICE. Cliquez sur Regénérer ou vérifiez votre connexion.'
                    : 'ICE gathering is blocked by your network. Click Regenerate or check your connection.';
            }
        }, 8000);
    }

    async function acceptAnswer() {
        const ta = document.getElementById('collabRemoteSDP');
        if (!ta || !ta.value.trim()) { showToast(t('paste_peer_reply'), 'warn'); return; }
        // 🛡️ v013 : tolerate URL or whitespace pastes — strip down to the raw base64.
        const code = extractInviteCode(ta.value.trim());
        if (!code) { showToast(t('invalid_reply'), 'err'); return; }
        if (!state.pc) {
            // host pc was torn down (modal closed mid-handshake?) — nothing to apply.
            showToast((lang() === 'fr') ? 'Session expirée — cliquez sur Regénérer' : 'Session expired — click Regenerate', 'err');
            return;
        }
        try {
            const sdp = JSON.parse(atob(code));
            await state.pc.setRemoteDescription(sdp);
            showToast(t('reply_accepted'));
        } catch (e) {
            showToast(t('invalid_reply'), 'err');
            console.error(e);
        }
    }

    async function joinFromOffer() {
        const ta = document.getElementById('collabRemoteSDP');
        if (!ta || !ta.value.trim()) { showToast(t('paste_host_invite'), 'warn'); return; }
        // 🛡️ v013 : tolerate URL or whitespace pastes.
        const code = extractInviteCode(ta.value.trim());
        if (!code) { showToast(t('invalid_invite'), 'err'); return; }
        createPeer('guest');
        try {
            const sdp = JSON.parse(atob(code));
            await state.pc.setRemoteDescription(sdp);
            const answer = await state.pc.createAnswer();
            await state.pc.setLocalDescription(answer);
            const ta2 = document.getElementById('collabLocalSDP');
            if (ta2) ta2.placeholder = (lang() === 'fr') ? 'Génération de la réponse…' : 'Generating reply…';
        } catch (e) {
            showToast(t('invalid_invite'), 'err');
            console.error(e);
        }
    }

    function teardown() {
        try { if (state.helloTimer) clearInterval(state.helloTimer); } catch (_) {}
        try { if (state.iceTimeout) clearTimeout(state.iceTimeout); } catch (_) {}
        try { if (state.rescanTimer) clearInterval(state.rescanTimer); } catch (_) {}
        stopKeepalive();
        try { if (state.channel) state.channel.close(); } catch (_) {}
        try { if (state.pc) state.pc.close(); } catch (_) {}
        state.pc = null;
        state.channel = null;
        state.connected = false;
        state.helloTimer = null;
        state.iceTimeout = null;
        state.rescanTimer = null;
        state.reconnecting = false;
        state.iceRestartTried = false;
        state.peer = { name: null, color: null };
        if (state.cursorEl) { state.cursorEl.remove(); state.cursorEl = null; }
        updateBadge();
    }

    function disconnect() {
        teardown();
        // 🛡️ v013 : reset wizard back to choice so the modal isn't stuck on "Connected".
        try { showStep('choice'); } catch (_) {}
        const local = document.getElementById('collabLocalSDP');
        const preview = document.getElementById('cw-hostLinkPreview');
        const remote = document.getElementById('collabRemoteSDP');
        const ji = document.getElementById('cw-joinInvite');
        const mr = document.getElementById('cw-myReply');
        const rb = document.getElementById('cw-replyBlock');
        if (local)   { local.value  = ''; local.style.display = 'none'; }
        if (preview) { preview.value = ''; }
        if (remote)  { remote.value = ''; }
        if (ji)      { ji.value = ''; }
        if (mr)      { mr.value = ''; mr.style.display = 'none'; }
        if (rb)      { rb.style.display = 'none'; }
        showToast(t('disconnected'));
    }

    function sayHello() {
        send({ type: 'hello', name: state.me.name, color: state.me.color, v: VERSION });
    }

    // --- Canvas sync : outgoing ------------------------------------------
    // 🛡️ FIX 2026-05-06 v008 :
    //   1. Page index was captured in CLOSURE at wire time → became wrong as soon
    //      as the user inserted/deleted a page. We now look it up DYNAMICALLY
    //      via getCanvases().indexOf(canvas) inside each handler.
    //   2. object:modified for multi-selection : e.target is an ActiveSelection
    //      whose _objects[] are the real moved items. We now broadcast each
    //      child individually (with its own _collabId).
    function attachFabricListeners() {
        if (window.__SPCollab_listenersAttached) return;
        window.__SPCollab_listenersAttached = true;

        // We hook on window.canvases dynamically (each new canvas page added)
        const wired = new WeakSet();
        function currentPageIndexOf(canvas) {
            const arr = getCanvases();
            const i = arr.indexOf(canvas);
            return i >= 0 ? i : 0;
        }
        function wireOne(canvas) {
            if (!canvas || wired.has(canvas)) return;
            wired.add(canvas);
            if (DEBUG) console.log('[Collab] wired canvas at idx=', currentPageIndexOf(canvas));

            canvas.on('object:added',    (e) => onLocalObjectChange('add', e, currentPageIndexOf(canvas)));
            canvas.on('object:modified', (e) => onLocalObjectChange('mod', e, currentPageIndexOf(canvas)));
            canvas.on('object:removed',  (e) => onLocalObjectChange('rm',  e, currentPageIndexOf(canvas)));

            // 🛡️ FIX 2026-05-06 v011 : sync EN DIRECT du contenu texte.
            //   Avant, le pair ne recevait l'état du textbox qu'au blur (event
            //   object:modified à la désélection). En cours de frappe rien ne
            //   bougeait → l'invité ne voyait pas le texte taper, et l'overflow
            //   d'un bloc à hauteur fixe ne se mettait pas à jour. On émet désormais
            //   un obj:mod debouncé sur 'text:changed' pour pousser à chaque frappe.
            const _textTimers = new WeakMap();
            canvas.on('text:changed', (e) => {
                const t = e && e.target;
                if (!t || !state.connected || state.suppressEcho || window._spSuppressCollabBroadcast) return;
                if (_textTimers.get(t)) clearTimeout(_textTimers.get(t));
                const handle = setTimeout(() => {
                    _textTimers.delete(t);
                    onLocalObjectChange('mod', { target: t }, currentPageIndexOf(canvas));
                }, 120); // ~8 fps suffisant pour la frappe + economise le DataChannel
                _textTimers.set(t, handle);
            });
            // Edition finiée → force un broadcast final (au cas où le debounce n'a pas fini).
            canvas.on('text:editing:exited', (e) => {
                const t = e && e.target;
                if (!t || !state.connected || window._spSuppressCollabBroadcast) return;
                onLocalObjectChange('mod', { target: t }, currentPageIndexOf(canvas));
            });

            // Cursor tracking
            canvas.on('mouse:move', (opt) => {
                if (!state.connected) return;
                const now = performance.now();
                if (now - state.lastCursorAt < CURSOR_THROTTLE_MS) return;
                state.lastCursorAt = now;
                const p = canvas.getPointer(opt.e);
                send({
                    type: 'cursor',
                    page: currentPageIndexOf(canvas),
                    x: p.x | 0,
                    y: p.y | 0,
                    name: state.me.name,
                    color: state.me.color
                });
            });
        }

        function rescan() {
            const all = getCanvases();
            all.forEach((c) => wireOne(c));
        }
        rescan();
        // Re-scan periodically (cheap) in case new pages are created.
        // 🛡️ FIX 2026-05-08 : on garde la handle dans state pour pouvoir la
        //   clear dans teardown() — sinon le timer tourne tant que l'onglet vit
        //   (memory leak + travail inutile chez les users qui ferment la session).
        try { if (state.rescanTimer) clearInterval(state.rescanTimer); } catch (_) {}
        state.rescanTimer = setInterval(rescan, 1500);
    }

    function onLocalObjectChange(kind, e, pageIdx) {
        if (!state.connected) return;
        if (state.suppressEcho) return;
        // 🛡️ FIX 2026-05-06 v012 : verrou global pose par main.js pendant
        //   les operations massives (chemin de fer apply, renderAllPages, doc
        //   replace) qui chargent plein d'objets via loadFromJSON et feraient
        //   sinon flooder le DataChannel d'object:added → le pair recevait
        //   une avalanche de obj:add desordonnes et la session collab "stoppait"
        //   visuellement (renvoi en boucle, desync). Le bloc qui pose le verrou
        //   doit imperativement faire un SPCollab.broadcastDoc() final pour
        //   resynchroniser le pair.
        if (window._spSuppressCollabBroadcast) return;
        const obj = e && e.target;
        if (!obj || obj.__collabSilent) return;

        // 🛡️ FIX 2026-05-06 v008 : multi-selection move/scale/rotate.
        //   Fabric fires 'object:modified' once with e.target = ActiveSelection,
        //   whose _objects[] are the actual moved children. Each child carries
        //   its own absolute coords AFTER fabric.transform-aware bake-in is done
        //   at deselection. To sync them in real time, we walk the children and
        //   serialize each one with its own _collabId.
        if (kind === 'mod' && obj.type === 'activeSelection' && Array.isArray(obj._objects)) {
            try {
                // Force fabric to bake the selection transform into each child
                // before reading their toObject() (otherwise children carry stale local coords).
                if (typeof obj.toGroup === 'function' && typeof obj.canvas === 'function') {
                    // not used — we just read the live world coords
                }
                obj._objects.forEach((child) => {
                    if (!child || child.__collabSilent) return;
                    if (!child._collabId) {
                        child._collabId = 'o-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
                    }
                    try {
                        // Compute world matrix so peer receives final position
                        const m = child.calcTransformMatrix();
                        const opts = fabric.util.qrDecompose(m);
                        const json = child.toObject(getCustomProps());
                        json.left   = opts.translateX;
                        json.top    = opts.translateY;
                        json.scaleX = opts.scaleX;
                        json.scaleY = opts.scaleY;
                        json.angle  = opts.angle;
                        json.skewX  = opts.skewX;
                        json.skewY  = opts.skewY;
                        send({
                            type: 'obj:mod',
                            page: pageIdx,
                            id: child._collabId,
                            obj: json
                        });
                    } catch (err) { console.warn('[Collab] multi-sel serialize fail', err); }
                });
                return;
            } catch (err) { console.warn('[Collab] multi-sel handler fail', err); }
        }

        // Assign stable id
        if (!obj._collabId) {
            obj._collabId = 'o-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        }
        try {
            const json = obj.toObject ? obj.toObject(getCustomProps()) : null;
            send({
                type: 'obj:' + kind,
                page: pageIdx,
                id: obj._collabId,
                obj: json
            });
        } catch (err) {
            console.warn('[Collab] serialize fail', err);
        }
    }

    function broadcastFullSnapshot() {
        const all = getCanvases();
        const props = getCustomProps();
        all.forEach((c, i) => {
            try {
                const json = c.toJSON(props);
                send({ type: 'page:full', page: i, json });
            } catch (e) {
                console.warn('[Collab] full snapshot fail page', i, e);
            }
        });
    }

    /* ---- Full SUPERPRINT .sp document broadcast/apply ---------------
       Triggered by host on initial connect AND after a local import
       (.sp / .json) so the peer mirrors the entire project, not just
       per-page Fabric snapshots. Falls back to per-page snapshot if
       SUPERPRINT helpers are not present.                              */
    function buildLocalSpDoc() {
        if (typeof window.saveProjectSP_toObject === 'function') {
            try { return window.saveProjectSP_toObject(); } catch (_) {}
        }
        // Fallback: synthesize a minimal SP doc from globals
        try {
            const fmt = window.pageFormat || { width: 210, height: 297 };
            return {
                _sp: { format: 'SuperPrint Document', version: '1.0.0', generator: 'collab' },
                document: { format: fmt, margin: window.margin, bleed: window.bleed, viewMode: window.viewMode },
                pages: (window.pages || []).map((p, idx) => {
                    let objs = [];
                    try {
                        const d = typeof p.objects === 'string' ? JSON.parse(p.objects) : p.objects;
                        objs = (d && d.objects) || d || [];
                    } catch (_) {}
                    return { index: idx, label: p.label || ('Page ' + (idx + 1)), objects: objs };
                })
            };
        } catch (e) { return null; }
    }

    function broadcastFullDoc() {
        const doc = buildLocalSpDoc();
        if (!doc) { broadcastFullSnapshot(); return; }
        send({ type: 'doc:replace', sp: doc });
    }

    function applyRemoteDocReplace(msg) {
        if (!msg || !msg.sp) return;
        if (typeof window.loadProjectSP !== 'function') {
            console.warn('[Collab] loadProjectSP missing on this peer');
            return;
        }
        state.suppressEcho = true;
        try {
            // loadProjectSP accepts string OR object; pass object directly
            window.loadProjectSP(msg.sp);
        } catch (e) {
            console.error('[Collab] doc:replace apply failed', e);
        } finally {
            // Loading is async (renderAllPages) — release flag generously
            setTimeout(() => { state.suppressEcho = false; }, 1500);
        }
    }

    // --- Canvas sync : incoming ------------------------------------------
    function applyRemoteOp(msg) {
        const canvas = getCanvasByIndex(msg.page);
        if (!canvas || !window.fabric) {
            if (DEBUG) console.warn('[Collab] applyRemoteOp: canvas not found page=', msg.page, 'avail=', getCanvases().length);
            return;
        }

        state.suppressEcho = true;
        try {
            switch (msg.type) {
                case 'obj:add':
                    if (findById(canvas, msg.id)) break;
                    fabric.util.enlivenObjects([msg.obj], (objs) => {
                        objs.forEach(o => {
                            o._collabId = msg.id;
                            o.__collabSilent = true;
                            canvas.add(o);
                            o.__collabSilent = false;
                        });
                        canvas.requestRenderAll();
                    });
                    break;
                case 'obj:mod': {
                    const target = findById(canvas, msg.id);
                    if (!target) break;
                    target.set(msg.obj);
                    // 🛡️ FIX 2026-05-06 v011 : recalcule la mise en page du texte.
                    //   Sans ça, un Textbox/IText recevant un changement de contenu
                    //   ou de width/height ne re-wrappait pas ses lignes → le pair
                    //   voyait l'ancienne géométrie (texte qui déborde, pas masqué, ou
                    //   pas refresh tant qu'on ne re-touchait pas l'objet).
                    if (target.type === 'textbox' || target.type === 'i-text' || target.type === 'text') {
                        try {
                            if (typeof target.initDimensions === 'function') target.initDimensions();
                            if (typeof target._clearCache    === 'function') target._clearCache();
                            // Si la box a une hauteur fixe (overflow clip), on la re-impose après initDimensions
                            if (msg.obj && msg.obj._fixedHeight) target.height = msg.obj._fixedHeight;
                            if (msg.obj && msg.obj._fixedWidth)  target.width  = msg.obj._fixedWidth;
                        } catch (_) { /* not critical */ }
                    }
                    target.setCoords();
                    canvas.requestRenderAll();
                    break;
                }
                case 'obj:rm': {
                    const target = findById(canvas, msg.id);
                    if (!target) break;
                    target.__collabSilent = true;
                    canvas.remove(target);
                    break;
                }
                case 'page:full':
                    canvas.loadFromJSON(msg.json, () => {
                        canvas.requestRenderAll();
                    });
                    break;
                case 'page:switch':
                    if (typeof window.switchToPage === 'function') {
                        try { window.switchToPage(msg.page); } catch (_) {}
                    }
                    break;
            }
        } catch (e) {
            console.error('[Collab] apply remote op', msg.type, e);
        } finally {
            // Release on next tick (after enliven async)
            setTimeout(() => { state.suppressEcho = false; }, 80);
        }
    }

    function findById(canvas, id) {
        if (!id) return null;
        return canvas.getObjects().find(o => o._collabId === id) || null;
    }

    // --- Remote cursor overlay -------------------------------------------
    // 🛡️ FIX 2026-05-06 v009 : la pastille du nom était toujours "texte blanc
    // sur fond = couleur du pair". Pour les couleurs claires (#ffcc00, #ff9500,
    // #5ac8fa…) c'était illisible (blanc-sur-jaune). On calcule maintenant
    // l'YIQ de la couleur du pair et on choisit noir/blanc en conséquence,
    // avec en plus un liseré contrasté (blanc en theme clair, noir en theme
    // sombre) pour rester visible quel que soit le fond du canvas.
    function _hexToRgb(hex) {
        if (!hex) return { r: 90, g: 200, b: 250 };
        let h = String(hex).replace('#', '').trim();
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const n = parseInt(h, 16);
        if (isNaN(n)) return { r: 90, g: 200, b: 250 };
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    function _readableTextOn(bgHex) {
        const { r, g, b } = _hexToRgb(bgHex);
        // YIQ luminance ; threshold 150 keeps yellow/cyan/light-green readable in BLACK
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq >= 150 ? '#0b0b0b' : '#ffffff';
    }
    function _isDarkTheme() {
        try {
            return document.documentElement.classList.contains('theme-dark') ||
                   document.body.classList.contains('theme-dark');
        } catch (_) { return false; }
    }

    function ensureCursor() {
        if (state.cursorEl) return state.cursorEl;
        const el = document.createElement('div');
        el.id = 'spCollabRemoteCursor';
        // SVG arrow : fill = peer color (set via currentColor), stroke contrasts with theme
        el.innerHTML =
            '<svg class="cur-arrow" width="20" height="20" viewBox="0 0 20 20" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,.45));">' +
              '<path d="M2 2 L18 9 L10 11 L8 18 Z" fill="currentColor" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>' +
            '</svg>' +
            '<span class="cur-label"></span>';
        Object.assign(el.style, {
            position: 'fixed', left: '0', top: '0',
            pointerEvents: 'none', zIndex: 99999,
            transform: 'translate(-9999px,-9999px)',
            transition: 'transform 60ms linear',
            color: '#5ac8fa'
        });
        const lblStyle = 'display:inline-block;margin-left:4px;background:currentColor;color:#fff;'
                       + 'padding:2px 7px;border-radius:9px;font:600 10px/1.4 system-ui,sans-serif;'
                       + 'letter-spacing:.3px;vertical-align:top;'
                       + 'box-shadow:0 1px 3px rgba(0,0,0,.35);'
                       + 'border:1px solid rgba(255,255,255,.85);';
        el.querySelector('.cur-label').setAttribute('style', lblStyle);
        document.body.appendChild(el);
        state.cursorEl = el;
        return el;
    }

    function showRemoteCursor(msg) {
        const el = ensureCursor();
        const canvas = getCanvasByIndex(msg.page);
        if (!canvas) return;
        // Convert canvas coords -> screen
        const lower = canvas.lowerCanvasEl;
        if (!lower) return;
        const rect = lower.getBoundingClientRect();
        const zoom = canvas.getZoom() || 1;
        const sx = rect.left + msg.x * zoom;
        const sy = rect.top + msg.y * zoom;
        const color = msg.color || '#5ac8fa';
        const dark  = _isDarkTheme();
        el.style.color = color;
        // Arrow stroke : contrast with the theme background, not the fill color.
        const arrow = el.querySelector('.cur-arrow path');
        if (arrow) arrow.setAttribute('stroke', dark ? '#0b0b0b' : '#ffffff');
        // Label : text color computed from peer color (YIQ) so light fills stay readable.
        const label = el.querySelector('.cur-label');
        label.textContent = msg.name || 'peer';
        // 🛡️ FIX 2026-05-06 v010 : on force background-color = couleur du pair.
        // Auparavant le span avait `background:currentColor`, mais comme on
        // override `color` ci-dessous (YIQ), `currentColor` devenait noir/blanc
        // → bulle blanche à texte blanc = invisible. On découple les deux.
        label.style.backgroundColor = color;
        label.style.color = _readableTextOn(color);
        // Outline : invert per theme so the bubble is visible on both white & dark canvases.
        label.style.borderColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.85)';
        label.style.boxShadow   = dark ? '0 1px 3px rgba(0,0,0,.7)' : '0 1px 3px rgba(0,0,0,.35)';
        el.style.transform = 'translate(' + (sx | 0) + 'px, ' + (sy | 0) + 'px)';
    }

    // --- UI : badge + toast ----------------------------------------------
    function updateBadge() {
        const btn = document.getElementById('openCollabBtn');
        if (!btn) return;
        btn.classList.toggle('collab-on', state.connected);
        const dot = btn.querySelector('.collab-dot');
        if (dot) dot.style.background = state.connected ? '#34c759' : '#aaa';
        btn.title = state.connected
            ? `Collab actif — ${state.peer.name || 'pair'} connecté`
            : 'Collab — Mode collaboration P2P (WebRTC)';
    }

    function showToast(text, kind) {
        if (typeof window.spShowToast === 'function') {
            window.spShowToast(text, { kind: kind, duration: 2600 });
        }
    }

    // --- Modal hooks (called from index.html buttons) --------------------
    function openModal(opts) {
        opts = opts || {};
        const m = document.getElementById('collabModal');
        if (!m) return;
        m.style.display = 'flex';
        applyI18n();
        renderColorSwatches();
        // Pre-fill identity
        const n = document.getElementById('collabName');
        const c = document.getElementById('collabColor');
        if (n) n.value = state.me.name;
        if (c) c.value = state.me.color;
        // Reset wizard areas
        const local = document.getElementById('collabLocalSDP');
        const preview = document.getElementById('cw-hostLinkPreview');
        const remote = document.getElementById('collabRemoteSDP');
        const ji = document.getElementById('cw-joinInvite');
        const mr = document.getElementById('cw-myReply');
        if (local) local.value = '';
        if (preview) preview.value = '';
        if (remote) remote.value = '';
        if (ji) ji.value = '';
        if (mr) mr.value = '';
        const rb = document.getElementById('cw-replyBlock');
        if (rb) rb.style.display = 'none';
        // 🛡️ v014 : safety net — if the URL still has a sp-collab hash AND
        //   no explicit autoJoin was passed, switch to join mode automatically.
        //   (Covers the case where the user opens the modal manually after clicking a link.)
        if (!opts.autoJoin) {
            try {
                const hashCode = extractInviteCode(location.hash || '');
                if (hashCode && hashCode.length > 40 && /sp-collab=/.test(location.hash || '')) {
                    opts.autoJoin = hashCode;
                }
            } catch (_) {}
        }
        // Auto-route based on context
        if (opts.autoJoin) {
            showStep('join');
            if (ji) ji.value = opts.autoJoin;
            // Auto-trigger reply generation
            setTimeout(() => generateReply(), 150);
        } else if (state.connected) {
            showStep('ok');
        } else {
            showStep('choice');
        }
    }

    function showStep(name) {
        const m = document.getElementById('collabModal');
        if (!m) return;
        m.querySelectorAll('.cw-step').forEach(s => {
            s.style.display = (s.dataset.step === name) ? 'block' : 'none';
        });
        const back = document.getElementById('cw-backWrap');
        if (back) back.style.display = (name === 'host' || name === 'join') ? 'block' : 'none';
        // Re-apply i18n on the now-visible step
        applyI18n();
    }

    // Build a shareable invite URL with the SDP in the hash (no server)
    // 🛡️ v014 : always emit an ABSOLUTE URL with explicit scheme + host.
    //   - file:// or about:blank → fallback to canonical https://superprint.cc/
    //   - directory pathnames are kept as-is (browsers serve index.html automatically)
    //   - bare domain root → ensure trailing /
    function makeInviteUrl(code) {
        let scheme = location.protocol;
        let host = location.host;
        let path = location.pathname || '/';
        if (!scheme || scheme === 'file:' || scheme === 'about:' || !host) {
            // Local dev or PWA edge case: emit the canonical production URL
            scheme = 'https:';
            host = 'superprint.cc';
            path = '/';
        }
        // Ensure pathname doesn't end on a stray index.html for cleaner share text
        if (/\/index\.html?$/i.test(path)) path = path.replace(/index\.html?$/i, '');
        const base = scheme + '//' + host + path;
        return base + '#sp-collab=' + encodeURIComponent(code);
    }

    // Pull the raw SDP code out of either a URL or a paste-as-text blob
    function extractInviteCode(text) {
        if (!text) return '';
        const s = String(text).trim();
        const m = s.match(/sp-collab=([^&\s#]+)/);
        if (m) {
            try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
        }
        return s;
    }

    function autoCopy(text) {
        if (!text) return Promise.resolve(false);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => true, () => false);
        }
        try {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            const ok = document.execCommand('copy'); ta.remove(); return Promise.resolve(ok);
        } catch (_) { return Promise.resolve(false); }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }

    // ── Wizard actions ──────────────────────────────────────────────────
    async function startInvite() {
        saveIdentityFromUI();
        showStep('host');
        // Reset visible UI state for a fresh invite
        const ta = document.getElementById('collabLocalSDP');
        if (ta) { ta.value = ''; ta.style.display = 'none'; }
        const preview = document.getElementById('cw-hostLinkPreview');
        if (preview) preview.value = '';
        const remote = document.getElementById('collabRemoteSDP');
        if (remote) remote.value = '';
        const st = document.getElementById('cw-host-status');
        if (st) {
            st.style.color = '#888';
            st.textContent = (lang() === 'fr') ? 'Génération du lien en cours…' : 'Generating link…';
        }
        await createOffer();
    }

    // Regenerate a brand-new invite/reply (clears current peer connection,
    // creates a fresh RTCPeerConnection → fresh SDP → fresh URL).
    async function regenerate() {
        // Detect which step is currently visible (host or join) by reading the DOM.
        const hostStep = document.querySelector('.cw-step[data-step="host"]');
        const wasJoin = !hostStep || hostStep.style.display === 'none';
        // teardown wipes pc, channel, helloTimer, iceTimeout, peer
        teardown();
        if (wasJoin) {
            // Reset join UI; user must re-paste invite then click Continue
            const rb = document.getElementById('cw-replyBlock');
            if (rb) rb.style.display = 'none';
            const mr = document.getElementById('cw-myReply');
            if (mr) { mr.value = ''; mr.style.display = 'none'; }
            const ji = document.getElementById('cw-joinInvite');
            if (ji) ji.value = '';
            showToast((lang() === 'fr') ? 'Session réinitialisée — collez à nouveau le lien' : 'Session reset — paste the link again');
        } else {
            await startInvite();
            showToast((lang() === 'fr') ? 'Nouveau lien généré' : 'New link generated');
        }
    }

    function startJoin() {
        saveIdentityFromUI();
        showStep('join');
        // Reset reply block (hidden until Continue is clicked)
        const rb = document.getElementById('cw-replyBlock');
        if (rb) rb.style.display = 'none';
        const mr = document.getElementById('cw-myReply');
        if (mr) { mr.value = ''; mr.style.display = 'none'; }
        // Try to auto-paste from clipboard if it looks like a code/link
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(txt => {
                const code = extractInviteCode(txt);
                if (code && code.length > 40) {
                    const ji = document.getElementById('cw-joinInvite');
                    if (ji && !ji.value) ji.value = code;
                }
            }).catch(() => {});
        }
    }

    async function generateReply() {
        saveIdentityFromUI();
        const ji = document.getElementById('cw-joinInvite');
        const raw = ji ? ji.value.trim() : '';
        if (!raw) { showToast(t('paste_host_invite'), 'warn'); return; }
        const code = extractInviteCode(raw);
        // 🛡️ v014 : sanity-check the code BEFORE creating a peer connection.
        //   If the user pasted random text (or only the URL prefix without the hash),
        //   atob() inside joinFromOffer would throw silently (caught + console.error)
        //   and the user would see "nothing happens". Now we surface a clear error.
        let valid = false;
        try {
            const decoded = atob(code);
            const parsed = JSON.parse(decoded);
            valid = !!(parsed && parsed.type === 'offer' && parsed.sdp);
        } catch (_) { valid = false; }
        if (!valid) {
            showToast((lang() === 'fr')
                ? 'Lien invalide — vérifiez que vous avez collé le lien complet (commençant par http…)'
                : 'Invalid link — make sure you pasted the full link (starting with http…)',
                'err');
            return;
        }
        // Mirror to legacy textarea so joinFromOffer() picks it up
        const remote = document.getElementById('collabRemoteSDP');
        if (remote) remote.value = code;
        await joinFromOffer();
    }

    async function smartPaste(targetId) {
        const el = document.getElementById(targetId);
        if (!el) return;
        try {
            const txt = await navigator.clipboard.readText();
            el.value = extractInviteCode(txt);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            showToast(lang() === 'fr' ? 'Collé depuis le presse-papiers' : 'Pasted from clipboard');
        } catch (e) {
            showToast(lang() === 'fr' ? 'Impossible de lire le presse-papiers — collez manuellement (Ctrl+V)' : 'Cannot read clipboard — paste manually (Ctrl+V)', 'warn');
            el.focus();
        }
    }

    function copyReply() {
        const ta = document.getElementById('cw-myReply');
        if (!ta || !ta.value) { showToast(t('nothing_to_copy'), 'warn'); return; }
        autoCopy(ta.value).then(ok => showToast(ok ? t('copied_clipboard') : t('copied'), ok ? 'info' : 'warn'));
    }

    function shareInvite() {
        const ta = document.getElementById('collabLocalSDP');
        if (!ta || !ta.value) { showToast(t('nothing_to_copy'), 'warn'); return; }
        const subject = encodeURIComponent(lang() === 'fr' ? 'Invitation à collaborer sur SuperPrint' : 'SuperPrint collaboration invite');
        const body = encodeURIComponent((lang() === 'fr'
            ? 'Bonjour,\n\nClique sur ce lien pour rejoindre ma session SuperPrint en pair-à-pair :\n\n'
            : 'Hello,\n\nClick this link to join my SuperPrint peer-to-peer session:\n\n')
            + ta.value + '\n');
        window.open('mailto:?subject=' + subject + '&body=' + body, '_blank');
    }

    function shareReply() {
        const ta = document.getElementById('cw-myReply');
        if (!ta || !ta.value) { showToast(t('nothing_to_copy'), 'warn'); return; }
        const subject = encodeURIComponent(lang() === 'fr' ? 'Réponse SuperPrint' : 'SuperPrint reply');
        const body = encodeURIComponent((lang() === 'fr'
            ? 'Voici mon code de réponse SuperPrint, à coller dans la fenêtre de collaboration :\n\n'
            : 'Here is my SuperPrint reply code, paste it into the collaboration window:\n\n')
            + ta.value + '\n');
        window.open('mailto:?subject=' + subject + '&body=' + body, '_blank');
    }

    // --- Round color swatches -------------------------------------------
    // 🛡️ FIX 2026-05-05 v004 : palette réduite à 5 teintes maxi (lisibilité
    // sur curseurs distants, moins de chevauchement visuel entre pairs).
    const COLOR_PALETTE = [
        '#ff3b30', // rouge
        '#ff9500', // orange
        '#34c759', // vert
        '#007aff', // bleu
        '#af52de'  // violet
    ];
    function renderColorSwatches() {
        const wrap = document.getElementById('collabColorSwatches');
        const hidden = document.getElementById('collabColor');
        if (!wrap) return;
        // Ensure current colour is part of the palette so it can be selected
        const list = COLOR_PALETTE.slice();
        if (state.me.color && !list.map(s => s.toLowerCase()).includes(state.me.color.toLowerCase())) {
            list.unshift(state.me.color);
        }
        wrap.innerHTML = '';
        list.forEach(col => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'collab-swatch';
            sw.setAttribute('role', 'radio');
            sw.setAttribute('aria-label', col);
            sw.dataset.color = col;
            sw.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid transparent;background:' + col + ';cursor:pointer;padding:0;outline:none;box-shadow:0 0 0 1px rgba(0,0,0,0.15);transition:transform .12s,border-color .12s,box-shadow .12s;';
            if (col.toLowerCase() === (state.me.color || '').toLowerCase()) {
                sw.style.borderColor = '#111';
                sw.style.transform = 'scale(1.12)';
                sw.setAttribute('aria-checked', 'true');
            } else {
                sw.setAttribute('aria-checked', 'false');
            }
            sw.addEventListener('mouseenter', () => { sw.style.transform = 'scale(1.18)'; });
            sw.addEventListener('mouseleave', () => {
                sw.style.transform = (col.toLowerCase() === (state.me.color || '').toLowerCase()) ? 'scale(1.12)' : 'scale(1)';
            });
            sw.addEventListener('click', () => selectSwatch(col));
            wrap.appendChild(sw);
        });
        // Custom (eyedropper) chip opens the hidden native colour picker
        const custom = document.createElement('button');
        custom.type = 'button';
        custom.className = 'collab-swatch collab-swatch-custom';
        custom.title = (lang() === 'fr') ? 'Couleur personnalisée' : 'Custom color';
        custom.style.cssText = 'width:22px;height:22px;border-radius:50%;border:1px dashed #888;background:conic-gradient(#ff3b30,#ffcc00,#34c759,#5ac8fa,#5856d6,#ff2d55,#ff3b30);cursor:pointer;padding:0;outline:none;';
        custom.addEventListener('click', () => {
            if (hidden) {
                hidden.value = state.me.color || '#5ac8fa';
                hidden.click();
            }
        });
        wrap.appendChild(custom);
        // Wire native picker change
        if (hidden && !hidden.__bound) {
            hidden.__bound = true;
            hidden.addEventListener('change', () => {
                if (hidden.value) selectSwatch(hidden.value);
            });
        }
    }
    function selectSwatch(col) {
        state.me.color = col;
        const hidden = document.getElementById('collabColor');
        if (hidden) hidden.value = col;
        saveIdentity();
        renderColorSwatches();
    }

    function closeModal() {
        const m = document.getElementById('collabModal');
        if (m) m.style.display = 'none';
        // 🛡️ v013 : if the user closes the modal MID-HANDSHAKE (not yet
        //   connected), tear down the half-built peer to avoid orphan RTCPeerConnections
        //   and dangling ICE timers. If already connected, leave the channel alive.
        if (!state.connected && state.pc) {
            try { teardown(); } catch (_) {}
        }
    }

    function switchTab(which) {
        document.querySelectorAll('.collab-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === which));
        document.querySelectorAll('.collab-pane').forEach(p => p.style.display = (p.dataset.pane === which ? 'block' : 'none'));
    }

    function saveIdentityFromUI() {
        const n = document.getElementById('collabName');
        const c = document.getElementById('collabColor');
        if (n && n.value.trim()) state.me.name = n.value.trim().slice(0, 24);
        if (c && c.value) state.me.color = c.value;
        saveIdentity();
    }

    function copyLocalSDP() {
        const ta = document.getElementById('collabLocalSDP');
        if (!ta || !ta.value) { showToast(t('nothing_to_copy'), 'warn'); return; }
        navigator.clipboard.writeText(ta.value).then(
            () => showToast(t('copied_clipboard')),
            () => { ta.select(); document.execCommand('copy'); showToast(t('copied')); }
        );
    }

    // --- Public API ------------------------------------------------------
    window.SPCollab = {
        version: VERSION,
        open: openModal,
        close: closeModal,
        switchTab,           // legacy (kept for backward compat)
        showStep,
        startInvite,
        startJoin,
        regenerate,
        generateReply,
        smartPaste,
        copyReply,
        shareInvite,
        shareReply,
        host: async () => { saveIdentityFromUI(); await createOffer(); },
        join: async () => { saveIdentityFromUI(); await joinFromOffer(); },
        accept: acceptAnswer,
        copyLocal: copyLocalSDP,
        disconnect,
        isConnected: () => state.connected,
        lang,
        broadcastFull: broadcastFullSnapshot,
        broadcastDoc: broadcastFullDoc
    };

    // Auto-detect #sp-collab=... in URL on first load → open wizard in join mode
    function checkAutoJoinHash() {
        try {
            const m = (location.hash || '').match(/sp-collab=([^&]+)/);
            if (!m) return;
            // Strip from URL so a refresh doesn't re-trigger
            const cleanHash = (location.hash || '').replace(/(?:^|&)sp-collab=[^&]+/, '').replace(/^#&?/, '#');
            try { history.replaceState(null, '', location.pathname + location.search + (cleanHash === '#' ? '' : cleanHash)); } catch (_) {}
            const code = decodeURIComponent(m[1]);
            // Wait until the DOM (modal) is mounted
            const tryOpen = () => {
                if (document.getElementById('collabModal')) {
                    openModal({ autoJoin: code });
                } else {
                    setTimeout(tryOpen, 200);
                }
            };
            tryOpen();
        } catch (_) { /* ignore */ }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAutoJoinHash);
    } else {
        checkAutoJoinHash();
    }
    /* ---- Hook .sp import/load to auto-rebroadcast the new project ---- */
    function installSpHooks() {
        if (window.__SPCollab_hooked) return;
        if (typeof window.loadProjectSP !== 'function') return;
        window.__SPCollab_hooked = true;
        const _origLoad = window.loadProjectSP;
        window.loadProjectSP = function (fileContent) {
            // Suppress local echo storm while loading
            state.suppressEcho = true;
            let r;
            try { r = _origLoad.apply(this, arguments); }
            finally {
                setTimeout(() => { state.suppressEcho = false; }, 1500);
            }
            // After load, re-broadcast as host (no-op if not connected)
            if (state.connected && state.role === 'host') {
                setTimeout(() => {
                    try {
                        if (typeof fileContent === 'string') {
                            send({ type: 'doc:replace', sp: JSON.parse(fileContent) });
                        } else if (fileContent && typeof fileContent === 'object') {
                            send({ type: 'doc:replace', sp: fileContent });
                        } else {
                            broadcastFullDoc();
                        }
                    } catch (e) { broadcastFullDoc(); }
                }, 1700);
            }
            return r;
        };
    }

    // --- Boot ------------------------------------------------------------
    function boot() {
        // Wait for canvases to exist
        const wait = setInterval(() => {
            if (getCanvases().length > 0) {
                clearInterval(wait);
                attachFabricListeners();
                installSpHooks();
                updateBadge();
                console.log('[Collab] ready', VERSION, '— canvases=', getCanvases().length);
            }
        }, 500);
        // Failsafe : attach anyway after 10 s so listeners pick up later canvases
        setTimeout(() => { clearInterval(wait); attachFabricListeners(); installSpHooks(); updateBadge(); console.log('[Collab] boot failsafe', VERSION, 'canvases=', getCanvases().length); }, 10000);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(boot, 0);
    } else {
        document.addEventListener('DOMContentLoaded', boot);
    }
})();
