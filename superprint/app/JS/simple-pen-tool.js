// ================================================================
// SUPERPRINT – Pro Pen Tool (Bézier)
// Outil plume professionnel – Compatible Fabric.js 5
// Mode DESSIN + Mode ÉDITION avec manipulation des poignées
// ================================================================
(function () {
    'use strict';

    // ── Configuration ─────────────────────────────────────────
    const CLOSE_THRESHOLD  = 14;   // px – distance pour fermer le tracé
    const HANDLE_RADIUS    = 5;    // rayon des poignées de Bézier
    const ANCHOR_RADIUS    = 6;    // rayon des points d'ancrage
    const HIT_RADIUS       = 10;   // rayon de détection des clics sur ancres/handles
    const CURVE_THRESHOLD  = 4;    // px – distance de drag pour créer une courbe
    const PREVIEW_COLOR    = '#0088ff';
    const ANCHOR_FILL      = '#ffffff';
    const ANCHOR_FIRST     = '#0088ff';
    const ANCHOR_SELECTED  = '#ff4444';
    const HANDLE_COLOR     = '#0088ff';
    const HANDLE_FILL      = '#ffffff';

    // ── Mode ──────────────────────────────────────────────────
    const MODE_DRAW = 'draw';      // Placement de nouveaux points
    const MODE_EDIT = 'edit';      // Édition des ancres/poignées existantes

    // ── State ─────────────────────────────────────────────────
    let _canvas         = null;
    let _active         = false;
    let _mode           = MODE_DRAW;
    let _points         = [];      // [{x,y, hInX,hInY, hOutX,hOutY}]
    let _undoStack      = [];      // points retirés (pour redo)
    let _closed         = false;   // tracé fermé ?
    let _dragging       = false;
    let _downPos        = null;
    let _currentPt      = null;    // point en cours de création (drag handle)
    let _editTarget     = null;    // Fabric path in edit mode
    let _tempObjects    = [];      // Fabric helper objects (preview)
    let _previewPath    = null;

    // Édition : quel élément est en cours de drag ?
    let _dragType       = null;    // 'anchor', 'hIn', 'hOut', 'closing', null
    let _dragIndex      = -1;      // index dans _points
    let _selectedIndex  = -1;      // ancre actuellement sélectionnée (rendu rouge), -1 = aucune
    let _shiftPressed   = false;  // Shift = contraindre nouveau point à 0/45/90°
    let _altPressed     = false;   // Alt = casser la symétrie

    // Tolérance pour insérer un point sur un segment existant (mode EDIT)
    const SEGMENT_HIT_DIST = 6;

    // Détection du double-clic sur ancre (toggle des poignées)
    const DBLCLICK_DELAY    = 350;   // ms
    const DEFAULT_HANDLE_LEN = 30;   // px – longueur par défaut quand on ajoute des poignées
    let _lastClickTime  = 0;
    let _lastClickIndex = -1;

    // Sauvegarde pour annulation (Escape en mode édition)
    let _origData       = null;    // { points, closed, stroke, strokeWidth, fill, left, top, ... }

    // Sauvegarde canvas state
    let _savedSelection  = true;
    let _savedCursor     = 'default';
    let _savedSkipTarget = false;

    // ── Bound event refs ──────────────────────────────────────
    let _onMouseDown, _onMouseMove, _onMouseUp, _onKeyDown, _onKeyUp;

    // ══════════════════════════════════════════════════════════
    //  PUBLIC API
    // ══════════════════════════════════════════════════════════

    const api = {
        get active() { return _active; },
        get mode()   { return _mode; },

        /**
         * Activate the pen tool.
         * @param {fabric.Canvas} canvas
         * @param {fabric.Path}  [existingPath] – re-edit existing
         */
        activate(canvas, existingPath) {
            if (_active) api.deactivate();
            if (!canvas) { console.error('[PenTool] No canvas'); return; }

            _canvas = canvas;
            _active = true;
            _points = [];
            _undoStack = [];
            _closed = false;
            _currentPt = null;
            _dragType = null;
            _dragIndex = -1;
            _selectedIndex = -1;
            _editTarget = null;
            _origData = null;
            _altPressed = false;

            // Save canvas state
            _savedSelection  = _canvas.selection;
            _savedCursor     = _canvas.defaultCursor;
            _savedSkipTarget = _canvas.skipTargetFind;
            _canvas.selection = false;
            _canvas.skipTargetFind = true;
            _canvas.defaultCursor = 'crosshair';
            _canvas.discardActiveObject();

            // Block Fabric selection rectangle
            _canvas.__penBlock = () => false;
            _canvas.on('before:selection:created', _canvas.__penBlock);
            _canvas.on('selection:created', _canvas.__penBlock);

            // Lock all existing objects
            _canvas.forEachObject(obj => {
                obj.__penSS = obj.selectable;
                obj.__penSE = obj.evented;
                obj.selectable = false;
                obj.evented    = false;
            });

            // Re-editing existing path
            if (existingPath && existingPath._simplePenData) {
                // 🔧 Bake la transformation actuelle (translate + scale + rotate) dans les points,
                //    afin que le tracé conserve sa taille/position après agrandissement.
                let bakedPoints = JSON.parse(JSON.stringify(existingPath._simplePenData.points));
                let visibleStrokeWidth = existingPath.strokeWidth || 2;
                try {
                    const m  = existingPath.calcTransformMatrix();
                    const ox = (existingPath.pathOffset && typeof existingPath.pathOffset.x === 'number') ? existingPath.pathOffset.x : 0;
                    const oy = (existingPath.pathOffset && typeof existingPath.pathOffset.y === 'number') ? existingPath.pathOffset.y : 0;
                    const tx = (lx, ly) => ({ x: m[0]*lx + m[2]*ly + m[4], y: m[1]*lx + m[3]*ly + m[5] });
                    const td = (dx, dy) => ({ x: m[0]*dx + m[2]*dy,         y: m[1]*dx + m[3]*dy });
                    bakedPoints = existingPath._simplePenData.points.map(p => {
                        const w  = tx(p.x - ox, p.y - oy);
                        const ho = td(p.hOutX || 0, p.hOutY || 0);
                        const hi = td(p.hInX  || 0, p.hInY  || 0);
                        return { x: w.x, y: w.y, hInX: hi.x, hInY: hi.y, hOutX: ho.x, hOutY: ho.y };
                    });
                    // Préserver l'épaisseur visible (Fabric multiplie par scale au rendu si strokeUniform=false)
                    const sAvg = (Math.abs(existingPath.scaleX || 1) + Math.abs(existingPath.scaleY || 1)) / 2;
                    visibleStrokeWidth = (existingPath.strokeWidth || 2) * (existingPath.strokeUniform ? 1 : sAvg);
                } catch(_) {}

                // Sauvegarder pour restauration (Escape) AVEC la position/taille actuelle
                _origData = {
                    points: JSON.parse(JSON.stringify(bakedPoints)),
                    closed: !!existingPath._simplePenData.closed,
                    stroke: existingPath.stroke || '#000000',
                    strokeWidth: visibleStrokeWidth,
                    fill: existingPath.fill
                };
                _editTarget = true; // flag: on édite un tracé existant
                _points = JSON.parse(JSON.stringify(bakedPoints));
                _closed = !!existingPath._simplePenData.closed;
                _undoStack = [];
                _mode = MODE_EDIT;
                _canvas.remove(existingPath);
                _canvas.defaultCursor = 'default';
                _drawPreview();
            } else {
                _mode = MODE_DRAW;
            }

            // Bind events
            _onMouseDown = _handleMouseDown.bind(null);
            _onMouseMove = _handleMouseMove.bind(null);
            _onMouseUp   = _handleMouseUp.bind(null);
            _onKeyDown   = _handleKeyDown.bind(null);
            _onKeyUp     = _handleKeyUp.bind(null);

            _canvas.on('mouse:down', _onMouseDown);
            _canvas.on('mouse:move', _onMouseMove);
            _canvas.on('mouse:up',   _onMouseUp);
            document.addEventListener('keydown', _onKeyDown, true);
            document.addEventListener('keyup',   _onKeyUp,   true);

            _uiSetActive(true);
            if (_mode === MODE_EDIT) {
                console.log('📝 Plume ÉDITION — drag ancres/poignées, Alt+drag=casser symétrie, Entrée=valider');
            } else {
                console.log('✏️ Plume DESSIN — clic: point, drag: courbe, Ctrl+Z: annuler, ⏎: terminer');
            }
        },

        /** Deactivate */
        deactivate() {
            if (!_canvas) return;

            _canvas.off('mouse:down', _onMouseDown);
            _canvas.off('mouse:move', _onMouseMove);
            _canvas.off('mouse:up',   _onMouseUp);
            document.removeEventListener('keydown', _onKeyDown, true);
            document.removeEventListener('keyup',   _onKeyUp,   true);

            _clearTemp();

            if (_canvas.__penBlock) {
                _canvas.off('before:selection:created', _canvas.__penBlock);
                _canvas.off('selection:created', _canvas.__penBlock);
                delete _canvas.__penBlock;
            }

            _canvas.forEachObject(obj => {
                if (obj.__penSS !== undefined) { obj.selectable = obj.__penSS; delete obj.__penSS; }
                if (obj.__penSE !== undefined) { obj.evented    = obj.__penSE; delete obj.__penSE; }
            });

            _canvas.selection      = _savedSelection;
            _canvas.skipTargetFind = _savedSkipTarget;
            _canvas.defaultCursor  = _savedCursor;
            _canvas._groupSelector = null;
            _canvas.requestRenderAll();

            _active = false;
            _mode = MODE_DRAW;
            _points = [];
            _undoStack = [];
            _currentPt = null;
            _closed = false;
            _dragType = null;
            _dragIndex = -1;
            _selectedIndex = -1;
            _editTarget = null;
            _origData = null;
            _canvas = null;

            _uiSetActive(false);
        }
    };

    // ══════════════════════════════════════════════════════════
    //  HIT TESTING – trouver ancre / poignée sous le curseur
    // ══════════════════════════════════════════════════════════

    /**
     * Returns { type: 'anchor'|'hIn'|'hOut', index: N } or null.
     * Priority: handles first (smaller targets), then anchors.
     */
    function _hitTest(ptr) {
        let best = null;
        let bestDist = HIT_RADIUS;

        for (let i = 0; i < _points.length; i++) {
            const pt = _points[i];

            // Handle-in
            if (pt.hInX !== 0 || pt.hInY !== 0) {
                const d = _dist(ptr, { x: pt.x + pt.hInX, y: pt.y + pt.hInY });
                if (d < bestDist) { bestDist = d; best = { type: 'hIn', index: i }; }
            }
            // Handle-out
            if (pt.hOutX !== 0 || pt.hOutY !== 0) {
                const d = _dist(ptr, { x: pt.x + pt.hOutX, y: pt.y + pt.hOutY });
                if (d < bestDist) { bestDist = d; best = { type: 'hOut', index: i }; }
            }
        }
        // Then anchors (after handles, so handles are prioritized if overlapping)
        for (let i = 0; i < _points.length; i++) {
            const pt = _points[i];
            const d = _dist(ptr, pt);
            if (d < bestDist) { bestDist = d; best = { type: 'anchor', index: i }; }
        }
        return best;
    }

    // ══════════════════════════════════════════════════════════
    //  SEGMENT HIT – trouver un segment proche du curseur (insertion)
    // ══════════════════════════════════════════════════════════

    function _bezierAt(p1, p2, t) {
        // Cubic Bézier interpolation (utilise les poignées hOut de p1, hIn de p2)
        const c1x = p1.x + (p1.hOutX || 0), c1y = p1.y + (p1.hOutY || 0);
        const c2x = p2.x + (p2.hInX  || 0), c2y = p2.y + (p2.hInY  || 0);
        const u = 1 - t;
        const b0 = u*u*u, b1 = 3*u*u*t, b2 = 3*u*t*t, b3 = t*t*t;
        return {
            x: b0*p1.x + b1*c1x + b2*c2x + b3*p2.x,
            y: b0*p1.y + b1*c1y + b2*c2y + b3*p2.y
        };
    }

    /**
     * Cherche le segment dont un échantillon est à <= maxDist du curseur.
     * Retourne { insertIndex, point: {x,y} } ou null.
     * insertIndex est l'index où splice() doit insérer le nouveau point.
     */
    function _findSegmentNear(ptr, maxDist) {
        if (_points.length < 2) return null;
        const STEPS = 16;
        let best = null;
        let bestDist = maxDist;
        const segCount = _closed ? _points.length : _points.length - 1;
        for (let i = 0; i < segCount; i++) {
            const p1 = _points[i];
            const p2 = _points[(i + 1) % _points.length];
            for (let s = 1; s < STEPS; s++) {
                const t = s / STEPS;
                const pt = _bezierAt(p1, p2, t);
                const d = _dist(ptr, pt);
                if (d < bestDist) {
                    bestDist = d;
                    best = { insertIndex: i + 1, point: pt };
                }
            }
        }
        return best;
    }

    // ══════════════════════════════════════════════════════════
    //  TOGGLE HANDLES – ajouter/supprimer les poignées d'une ancre
    // ══════════════════════════════════════════════════════════

    function _toggleHandles(index) {
        if (index < 0 || index >= _points.length) return;
        const pt = _points[index];
        const hasHandles = (pt.hInX !== 0 || pt.hInY !== 0 || pt.hOutX !== 0 || pt.hOutY !== 0);

        if (hasHandles) {
            // Supprimer les poignées → corner point
            pt.hInX = pt.hInY = pt.hOutX = pt.hOutY = 0;
            return;
        }

        // Ajouter des poignées symétriques tangentes au tracé
        // Direction par défaut : selon les voisins (prev → next)
        let dx = 1, dy = 0;
        const n = _points.length;
        const hasPrev = _closed || index > 0;
        const hasNext = _closed || index < n - 1;
        if (hasPrev && hasNext) {
            const prev = _points[(index - 1 + n) % n];
            const next = _points[(index + 1) % n];
            dx = next.x - prev.x;
            dy = next.y - prev.y;
        } else if (hasNext) {
            const next = _points[(index + 1) % n];
            dx = next.x - pt.x;
            dy = next.y - pt.y;
        } else if (hasPrev) {
            const prev = _points[(index - 1 + n) % n];
            dx = pt.x - prev.x;
            dy = pt.y - prev.y;
        }
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        pt.hOutX =  ux * DEFAULT_HANDLE_LEN;
        pt.hOutY =  uy * DEFAULT_HANDLE_LEN;
        pt.hInX  = -pt.hOutX;
        pt.hInY  = -pt.hOutY;
    }

    // ══════════════════════════════════════════════════════════
    //  MOUSE EVENTS
    // ══════════════════════════════════════════════════════════

    function _handleMouseDown(opt) {
        if (!_active || !_canvas) return;
        _canvas._groupSelector = null;
        opt.e.preventDefault();
        opt.e.stopPropagation();

        const ptrRaw = _canvas.getPointer(opt.e);
        _altPressed = !!opt.e.altKey;
        _shiftPressed = !!opt.e.shiftKey;
        // En mode DESSIN avec Shift, contraindre le clic à un multiple de 45°
        // par rapport au dernier point posé → segments parfaitement droits/diagonaux.
        let ptr = ptrRaw;
        if (_shiftPressed && _mode === MODE_DRAW && _points.length > 0) {
            ptr = _snap45(_points[_points.length - 1], ptrRaw);
        }
        _downPos = { x: ptr.x, y: ptr.y };

        // ── MODE ÉDITION ──
        if (_mode === MODE_EDIT) {
            const hit = _hitTest(ptr);
            if (hit) {
                // Double-clic sur ancre → toggle des poignées (corner ↔ smooth)
                if (hit.type === 'anchor') {
                    const now = Date.now();
                    if (_lastClickIndex === hit.index && (now - _lastClickTime) < DBLCLICK_DELAY) {
                        _toggleHandles(hit.index);
                        _lastClickTime = 0;
                        _lastClickIndex = -1;
                        _selectedIndex = hit.index;
                        _dragging = false;
                        _dragType = null;
                        _dragIndex = -1;
                        _drawPreview();
                        return;
                    }
                    _lastClickTime  = now;
                    _lastClickIndex = hit.index;
                }
                _dragType  = hit.type;
                _dragIndex = hit.index;
                _dragging  = true;
                // Sélection visible de l'ancre cliquée (rendu rouge)
                if (hit.type === 'anchor') {
                    _selectedIndex = hit.index;
                    _drawPreview();
                }
                return;
            }
            // Clic dans le vide → essayer d'insérer un nouveau point sur un segment
            const seg = _findSegmentNear(ptr, SEGMENT_HIT_DIST);
            if (seg) {
                const newPt = { x: seg.point.x, y: seg.point.y, hInX: 0, hInY: 0, hOutX: 0, hOutY: 0 };
                _points.splice(seg.insertIndex, 0, newPt);
                _selectedIndex = seg.insertIndex;
                _dragType  = 'anchor';
                _dragIndex = seg.insertIndex;
                _dragging  = true;
                _drawPreview();
                return;
            }
            // Clic dans le vide réel → désélectionner ; double-clic dans le vide → finaliser
            if (_selectedIndex !== -1) {
                _selectedIndex = -1;
                _drawPreview();
                return;
            }
            if (_points.length >= 2) {
                _finalize(_closed);
            } else {
                _clearTemp();
                api.deactivate();
            }
            return;
        }

        // ── MODE DESSIN ──

        // 1) Fermer le tracé ? (clic sur le premier point)
        if (_points.length > 2) {
            const fp = _points[0];
            if (_dist(ptr, fp) < CLOSE_THRESHOLD) {
                _dragType = 'closing';
                _dragging = true;
                return;
            }
        }

        // 2) Nouveau point
        _undoStack = [];
        _currentPt = { x: ptr.x, y: ptr.y, hInX: 0, hInY: 0, hOutX: 0, hOutY: 0 };
        _dragging = true;
    }

    function _handleMouseMove(opt) {
        if (!_active || !_canvas) return;
        _canvas._groupSelector = null;
        const ptrRaw = _canvas.getPointer(opt.e);
        _altPressed = !!opt.e.altKey;
        _shiftPressed = !!opt.e.shiftKey;
        // Snap 45° pendant le prévisualisation du prochain point en mode dessin.
        let ptr = ptrRaw;
        if (_shiftPressed && _mode === MODE_DRAW && !_dragging && _points.length > 0) {
            ptr = _snap45(_points[_points.length - 1], ptrRaw);
        }

        if (!_dragging) {
            // ── Curseur contextuel ──
            if (_mode === MODE_EDIT) {
                const hit = _hitTest(ptr);
                _canvas.defaultCursor = hit ? 'move' : 'default';
            } else if (_points.length > 0) {
                // Guide line en mode dessin
                _drawPreview(null, ptr);
            }
            return;
        }

        const dx = ptr.x - _downPos.x;
        const dy = ptr.y - _downPos.y;

        // ── MODE ÉDITION : drag ancre ou poignée ──
        if (_mode === MODE_EDIT && _dragIndex >= 0) {
            const pt = _points[_dragIndex];

            if (_dragType === 'anchor') {
                // Déplacer l'ancre + ses poignées
                pt.x = ptr.x;
                pt.y = ptr.y;
                _drawPreview();
                return;
            }

            if (_dragType === 'hOut') {
                // Déplacer la poignée de sortie
                pt.hOutX = ptr.x - pt.x;
                pt.hOutY = ptr.y - pt.y;
                // Symétrie si pas Alt
                if (!_altPressed) {
                    pt.hInX = -pt.hOutX;
                    pt.hInY = -pt.hOutY;
                }
                _drawPreview();
                return;
            }

            if (_dragType === 'hIn') {
                // Déplacer la poignée d'entrée
                pt.hInX = ptr.x - pt.x;
                pt.hInY = ptr.y - pt.y;
                // Symétrie si pas Alt
                if (!_altPressed) {
                    pt.hOutX = -pt.hInX;
                    pt.hOutY = -pt.hInY;
                }
                _drawPreview();
                return;
            }
        }

        // ── MODE ÉDITION : nouveau point en drag ──
        if (_dragType === 'newpoint' && _currentPt) {
            if (_dist(ptr, _downPos) > CURVE_THRESHOLD) {
                _currentPt.hOutX =  dx;  _currentPt.hOutY =  dy;
                _currentPt.hInX  = -dx;  _currentPt.hInY  = -dy;
            }
            _drawPreview(_currentPt);
            return;
        }

        // ── MODE DESSIN ──

        if (_dragType === 'closing') {
            // Drag pendant fermeture → ajuster UNIQUEMENT la poignée de fermeture (hIn du premier point)
            if (_points.length > 0) {
                const first = _points[0];
                first.hInX  = -dx;  first.hInY  = -dy;
                _drawPreview();
            }
            return;
        }

        if (_currentPt) {
            if (_dist(ptr, _downPos) > CURVE_THRESHOLD) {
                if (_altPressed) {
                    // Alt+drag : seulement la poignée de sortie
                    _currentPt.hOutX = dx; _currentPt.hOutY = dy;
                } else {
                    // Normal : poignées symétriques
                    _currentPt.hOutX =  dx;  _currentPt.hOutY =  dy;
                    _currentPt.hInX  = -dx;  _currentPt.hInY  = -dy;
                }
            }
            _drawPreview(_currentPt);
        }
    }

    function _handleMouseUp(opt) {
        if (!_active || !_canvas) return;

        // ── Fermeture du tracé ──
        if (_dragType === 'closing') {
            _dragging = false;
            _dragType = null;
            _finalize(true);
            return;
        }

        // ── Fin du drag d'édition d'ancre/poignée ──
        if (_mode === MODE_EDIT && (_dragType === 'anchor' || _dragType === 'hIn' || _dragType === 'hOut')) {
            _dragging = false;
            _dragType = null;
            _dragIndex = -1;
            _drawPreview();
            return;
        }

        // ── Ajout d'un nouveau point (draw ou edit/extend) ──
        if (_currentPt) {
            const ptr = _canvas.getPointer(opt.e);
            if (_dist(ptr, _downPos) <= CURVE_THRESHOLD) {
                // Simple clic → corner
                _currentPt.hInX = _currentPt.hInY = _currentPt.hOutX = _currentPt.hOutY = 0;
            }
            _points.push(_currentPt);
            _currentPt = null;
            _drawPreview();
        }

        _dragging = false;
        _downPos  = null;
        _dragType = null;
        _dragIndex = -1;
    }

    // ══════════════════════════════════════════════════════════
    //  KEYBOARD EVENTS (capture phase)
    // ══════════════════════════════════════════════════════════

    function _handleKeyDown(e) {
        if (!_active) return;

        const cmd = e.metaKey || e.ctrlKey;

        // ── Alt / Shift key tracking ──
        if (e.key === 'Alt') { _altPressed = true; return; }
        if (e.key === 'Shift') { _shiftPressed = true; return; }

        // ── Ctrl+Z : Undo ──
        if (cmd && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (_points.length > 0) {
                _undoStack.push(_points.pop());
                if (_closed && _points.length < 3) _closed = false;
                _drawPreview();
            }
            return;
        }

        // ── Ctrl+Shift+Z / Ctrl+Y : Redo ──
        if (cmd && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || (!e.shiftKey && (e.key === 'y' || e.key === 'Y')))) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (_undoStack.length > 0) {
                _points.push(_undoStack.pop());
                _drawPreview();
            }
            return;
        }

        // ── Block other Ctrl combos (except save) ──
        if (cmd) {
            if (e.key === 's' || e.key === 'S') return;
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            return;
        }

        switch (e.key) {
            case 'Escape':
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                if (_mode === MODE_EDIT && _origData) {
                    // Annuler l'édition → recréer le tracé original
                    _clearTemp();
                    try {
                        const dStr = _buildSVG(_origData.points, _origData.closed);
                        if (dStr && _canvas) {
                            const restored = new fabric.Path(dStr, {
                                fill: _origData.closed ? _origData.fill : null,
                                stroke: _origData.stroke,
                                strokeWidth: _origData.strokeWidth,
                                strokeLineCap: 'round', strokeLineJoin: 'round',
                                selectable: true, evented: true, objectCaching: true
                            });
                            if (!_origData.closed) restored.fill = null;
                            restored._simplePenData = {
                                points: _origData.points,
                                closed: _origData.closed
                            };
                            const orig = restored.toObject.bind(restored);
                            restored.toObject = function(p) {
                                return fabric.util.object.extend(orig(p), { _simplePenData: this._simplePenData });
                            };
                            _canvas.add(restored);
                            _canvas.setActiveObject(restored);
                            _canvas.requestRenderAll();
                        }
                    } catch(_) {}
                    _editTarget = null;
                    _origData = null;
                    api.deactivate();
                } else if (_points.length >= 2) {
                    _finalize(_mode === MODE_EDIT ? _closed : false);
                } else {
                    _clearTemp(); api.deactivate();
                }
                break;

            case 'Enter':
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                if (_mode === MODE_EDIT && _points.length >= 2) {
                    _finalize(_closed); // Conserver l'état ouvert/fermé
                } else if (_points.length >= 2) {
                    // 🆕 v1.7.128 : Entrée en création = garder le tracé OUVERT
                    // (pas de fermeture auto, pas de remplissage). L'utilisateur
                    // doit explicitement cliquer sur la 1re ancre pour fermer.
                    _finalize(false);
                } else {
                    _clearTemp(); api.deactivate();
                }
                break;

            case 'Backspace':
            case 'Delete':
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                // En mode EDIT avec une ancre sélectionnée → suppression ciblée
                if (_mode === MODE_EDIT && _selectedIndex >= 0 && _selectedIndex < _points.length && _points.length > 2) {
                    _points.splice(_selectedIndex, 1);
                    _selectedIndex = -1;
                    _drawPreview();
                    break;
                }
                if (_points.length > 0) {
                    _undoStack.push(_points.pop());
                    if (_closed && _points.length < 3) _closed = false;
                    _drawPreview();
                } else {
                    _clearTemp(); api.deactivate();
                }
                break;

            case 'Tab':
                // Tab = basculer entre mode dessin et édition
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                if (_points.length >= 2) {
                    _mode = (_mode === MODE_DRAW) ? MODE_EDIT : MODE_DRAW;
                    _canvas.defaultCursor = (_mode === MODE_EDIT) ? 'default' : 'crosshair';
                    _drawPreview();
                    console.log('🔄 Mode: ' + _mode.toUpperCase());
                }
                break;
        }
    }

    function _handleKeyUp(e) {
        if (e.key === 'Alt') _altPressed = false;
        if (e.key === 'Shift') _shiftPressed = false;
    }

    // ══════════════════════════════════════════════════════════
    //  PATH BUILDING (SVG d attribute)
    // ══════════════════════════════════════════════════════════

    function _buildSVG(pts, close) {
        if (!pts || pts.length < 1) return '';
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
            d += _segment(pts[i], pts[i + 1]);
        }
        if (close && pts.length > 2) {
            d += _segment(pts[pts.length - 1], pts[0]);
            d += ' Z';
        }
        return d;
    }

    function _segment(p1, p2) {
        const h1 = (p1.hOutX !== 0 || p1.hOutY !== 0);
        const h2 = (p2.hInX  !== 0 || p2.hInY  !== 0);
        if (h1 && h2) return ` C ${p1.x+p1.hOutX} ${p1.y+p1.hOutY}, ${p2.x+p2.hInX} ${p2.y+p2.hInY}, ${p2.x} ${p2.y}`;
        if (h1)       return ` Q ${p1.x+p1.hOutX} ${p1.y+p1.hOutY}, ${p2.x} ${p2.y}`;
        if (h2)       return ` Q ${p2.x+p2.hInX} ${p2.y+p2.hInY}, ${p2.x} ${p2.y}`;
        return ` L ${p2.x} ${p2.y}`;
    }

    // ══════════════════════════════════════════════════════════
    //  PREVIEW DRAWING (Fabric temp objects)
    // ══════════════════════════════════════════════════════════

    function _clearTemp() {
        if (!_canvas) return;
        _tempObjects.forEach(o => { try { _canvas.remove(o); } catch(_){} });
        _tempObjects = [];
        if (_previewPath) { try { _canvas.remove(_previewPath); } catch(_){} _previewPath = null; }
    }

    function _drawPreview(pendingPt, cursorPt) {
        _clearTemp();
        if (!_canvas) return;

        const all = pendingPt ? [..._points, pendingPt] : [..._points];
        if (all.length < 1) { _canvas.requestRenderAll(); return; }

        const strokeCol = _getStrokeColor();
        const strokeW   = _getStrokeWidth();
        const isClosed  = _closed || (_dragType === 'closing');

        // ── 1) Path preview ──
        const dStr = _buildSVG(all, isClosed);
        if (dStr) {
            try {
                _previewPath = new fabric.Path(dStr, {
                    fill: null, stroke: strokeCol, strokeWidth: strokeW,
                    strokeLineCap: 'round', strokeLineJoin: 'round',
                    selectable: false, evented: false,
                    excludeFromExport: true, objectCaching: false,
                    opacity: 0.6
                });
                _previewPath.fill = null;
                _canvas.add(_previewPath);
            } catch(_) {}
        }

        // ── 2) Guide line (cursor → last point, mode dessin) ──
        if (cursorPt && !pendingPt && all.length > 0 && _mode === MODE_DRAW && !isClosed) {
            const last = all[all.length - 1];
            const guide = new fabric.Line([last.x, last.y, cursorPt.x, cursorPt.y], {
                stroke: PREVIEW_COLOR, strokeWidth: 1,
                strokeDashArray: [6, 4], opacity: 0.5,
                selectable: false, evented: false, excludeFromExport: true
            });
            guide.__isGuide = true;
            _canvas.add(guide); _tempObjects.push(guide);

            // Close indicator
            if (_points.length > 2 && _dist(cursorPt, _points[0]) < CLOSE_THRESHOLD * 1.5) {
                const fp = _points[0];
                _addTemp(new fabric.Circle({
                    left: fp.x - 12, top: fp.y - 12, radius: 12,
                    fill: 'rgba(0,136,255,0.12)', stroke: ANCHOR_FIRST, strokeWidth: 2,
                    selectable: false, evented: false, excludeFromExport: true
                }));
            }
        }

        // ── 3) Anchors + handles pour chaque point ──
        all.forEach((pt, i) => {
            const isFirst = (i === 0);

            // Handle lines + circles
            _drawHandle(pt, 'hIn');
            _drawHandle(pt, 'hOut');

            // Anchor circle
            const isSelected = (i === _selectedIndex);
            const aFill = isSelected ? ANCHOR_SELECTED : (isFirst ? ANCHOR_FIRST : ANCHOR_FILL);
            const aStroke = isSelected ? ANCHOR_SELECTED : PREVIEW_COLOR;
            _addTemp(new fabric.Circle({
                left: pt.x - ANCHOR_RADIUS, top: pt.y - ANCHOR_RADIUS,
                radius: ANCHOR_RADIUS,
                fill: aFill, stroke: aStroke, strokeWidth: isSelected ? 2.5 : 2,
                selectable: false, evented: false, excludeFromExport: true
            }));

            // Numéro du point (1-indexed) à côté de l'ancre
            try {
                _addTemp(new fabric.Text(String(i + 1), {
                    left: pt.x + ANCHOR_RADIUS + 3,
                    top:  pt.y - ANCHOR_RADIUS - 12,
                    fontSize: 9, fill: PREVIEW_COLOR,
                    fontFamily: 'system-ui, sans-serif',
                    selectable: false, evented: false,
                    excludeFromExport: true, opacity: 0.85
                }));
            } catch(_) {}
        });

        // ── 4) Point count label ──
        if (all.length > 0) {
            const lastPt = all[all.length - 1];
            const modeLabel = _mode === MODE_EDIT ? '✎ EDIT' : '✏ DRAW';
            const label = `${all.length} pt${all.length>1?'s':''} ${modeLabel}${isClosed?' ○':' —'}`;
            try {
                _addTemp(new fabric.Text(label, {
                    left: lastPt.x + 14, top: lastPt.y - 10,
                    fontSize: 10, fill: PREVIEW_COLOR,
                    fontFamily: 'system-ui, sans-serif',
                    selectable: false, evented: false,
                    excludeFromExport: true, opacity: 0.65
                }));
            } catch(_) {}
        }

        _canvas.requestRenderAll();
    }

    function _drawHandle(pt, type) {
        const hx = (type === 'hIn') ? pt.hInX : pt.hOutX;
        const hy = (type === 'hIn') ? pt.hInY : pt.hOutY;
        if (hx === 0 && hy === 0) return;

        const ex = pt.x + hx, ey = pt.y + hy;

        // Line from anchor to handle
        _addTemp(new fabric.Line([pt.x, pt.y, ex, ey], {
            stroke: HANDLE_COLOR, strokeWidth: 1, opacity: 0.7,
            selectable: false, evented: false, excludeFromExport: true
        }));

        // Handle dot (diamond shape for visibility)
        _addTemp(new fabric.Circle({
            left: ex - HANDLE_RADIUS, top: ey - HANDLE_RADIUS,
            radius: HANDLE_RADIUS,
            fill: HANDLE_FILL, stroke: HANDLE_COLOR, strokeWidth: 1.5,
            selectable: false, evented: false, excludeFromExport: true
        }));
    }

    function _addTemp(obj) {
        _canvas.add(obj); _tempObjects.push(obj);
    }

    // ══════════════════════════════════════════════════════════
    //  FINALIZE – create the final Fabric.Path
    // ══════════════════════════════════════════════════════════

    function _finalize(closed) {
        if (_points.length < 2) { _clearTemp(); api.deactivate(); return; }
        _clearTemp();

        const strokeCol = _getStrokeColor();
        const strokeW   = _getStrokeWidth();
        const fillCol   = closed ? _getFillColor() : null;
        const dStr      = _buildSVG(_points, closed);
        if (!dStr) { api.deactivate(); return; }

        try {
            const path = new fabric.Path(dStr, {
                fill: fillCol, stroke: strokeCol, strokeWidth: strokeW,
                strokeLineCap: 'round', strokeLineJoin: 'round',
                selectable: true, evented: true, objectCaching: true
            });
            if (!closed) path.fill = null;

            // Store for re-editing
            path._simplePenData = {
                points: JSON.parse(JSON.stringify(_points)),
                closed: closed
            };

            // Serialize support
            const orig = path.toObject.bind(path);
            path.toObject = function(p) {
                return fabric.util.object.extend(orig(p), { _simplePenData: this._simplePenData });
            };

            _canvas.add(path);
            _canvas.setActiveObject(path);
            _canvas.requestRenderAll();

            if (typeof updateLayersPanel === 'function') updateLayersPanel();
            if (typeof saveState === 'function') saveState(closed ? 'Forme plume fermée' : 'Tracé plume créé');
            console.log('✅ Tracé finalisé (' + _points.length + ' pts, ' + (closed ? 'fermé' : 'ouvert') + ')');
        } catch(err) {
            console.error('[PenTool] Erreur:', err);
        }

        _editTarget = null; // Empêcher Escape de restaurer l'ancien
        _origData = null;
        api.deactivate();
    }

    // ══════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════

    function _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    /**
     * Contraint un point cible à un angle multiple de 45° par rapport à une origine.
     * Utilisé lors du dessin avec Shift maintenu.
     */
    function _snap45(origin, target) {
        if (!origin) return target;
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.001) return target;
        const step = Math.PI / 4; // 45°
        const angle = Math.round(Math.atan2(dy, dx) / step) * step;
        return { x: origin.x + Math.cos(angle) * len, y: origin.y + Math.sin(angle) * len };
    }

    function _uiSetActive(on) {
        const btn = document.getElementById('penTool');
        if (btn) btn.classList.toggle('active', on);
    }

    function _getStrokeColor() {
        const el = document.getElementById('blockStroke');
        return (el && el.value) ? el.value : '#000000';
    }
    function _getStrokeWidth() {
        const el = document.getElementById('strokeWidth');
        return (el && parseFloat(el.value)) ? parseFloat(el.value) : 2;
    }
    function _getFillColor() {
        const el = document.getElementById('blockFill');
        return (el && el.value) ? el.value : 'transparent';
    }

    // ══════════════════════════════════════════════════════════
    //  REGISTER
    // ══════════════════════════════════════════════════════════
    window.simplePenTool = api;

    // ══════════════════════════════════════════════════════════
    //  PENCIL MODE — tracé libre (clic-drag-relâche), résultat
    //  éditable comme la plume (poignées Bézier extraites depuis
    //  les segments quadratiques produits par PencilBrush).
    // ══════════════════════════════════════════════════════════
    let _pencilCanvas = null;
    let _pencilOnCreated = null;
    let _pencilSavedDrawing = null;
    let _pencilSavedSelection = null;
    let _pencilSavedSkip = null;
    let _pencilSavedCursor = null;

    function _pencilGetStrokeColor() {
        const el = document.getElementById('blockStroke');
        return (el && el.value) ? el.value : '#000000';
    }
    function _pencilGetStrokeWidth() {
        const el = document.getElementById('strokeWidth');
        return (el && parseFloat(el.value)) ? parseFloat(el.value) : 2;
    }

    /**
     * Convertit un fabric.Path produit par PencilBrush (commandes M / Q / L)
     * en liste de points {x,y,hInX,hInY,hOutX,hOutY} compatible plume.
     * Les Q (cx,cy,x,y) sont converties en cubique équivalente : poignée
     * sortante de l'ancre courante = (cx-curX, cy-curY), poignée entrante
     * de l'ancre cible = (cx-x, cy-y).
     */
    function _extractPenPointsFromFabricPath(path) {
        const segs = path.path || [];
        const pts = [];
        let curX = 0, curY = 0;
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            const cmd = s[0];
            if (cmd === 'M') {
                curX = s[1]; curY = s[2];
                pts.push({ x: curX, y: curY, hInX: 0, hInY: 0, hOutX: 0, hOutY: 0 });
            } else if (cmd === 'L') {
                const ex = s[1], ey = s[2];
                pts.push({ x: ex, y: ey, hInX: 0, hInY: 0, hOutX: 0, hOutY: 0 });
                curX = ex; curY = ey;
            } else if (cmd === 'Q') {
                const cx = s[1], cy = s[2], ex = s[3], ey = s[4];
                if (pts.length > 0) {
                    const last = pts[pts.length - 1];
                    last.hOutX = cx - last.x;
                    last.hOutY = cy - last.y;
                }
                pts.push({ x: ex, y: ey, hInX: cx - ex, hInY: cy - ey, hOutX: 0, hOutY: 0 });
                curX = ex; curY = ey;
            } else if (cmd === 'C') {
                const c1x = s[1], c1y = s[2], c2x = s[3], c2y = s[4], ex = s[5], ey = s[6];
                if (pts.length > 0) {
                    const last = pts[pts.length - 1];
                    last.hOutX = c1x - last.x;
                    last.hOutY = c1y - last.y;
                }
                pts.push({ x: ex, y: ey, hInX: c2x - ex, hInY: c2y - ey, hOutX: 0, hOutY: 0 });
                curX = ex; curY = ey;
            }
        }
        return pts;
    }

    /**
     * Active le mode crayon : dessin libre. Le tracé devient un fabric.Path
     * "plume-éditable" (avec _simplePenData) au relâchement de la souris.
     */
    function activatePencil(canvas) {
        if (!canvas) { console.error('[PencilTool] No canvas'); return; }
        if (api.active) api.deactivate();
        deactivatePencil(); // sécurité

        _pencilCanvas = canvas;
        _pencilSavedDrawing  = canvas.isDrawingMode;
        _pencilSavedSelection = canvas.selection;
        _pencilSavedSkip     = canvas.skipTargetFind;
        _pencilSavedCursor   = canvas.defaultCursor;

        try {
            if (!canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            }
        } catch(_) {}
        const brush = canvas.freeDrawingBrush;
        if (brush) {
            brush.color = _pencilGetStrokeColor();
            brush.width = _pencilGetStrokeWidth();
        }
        canvas.isDrawingMode = true;
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';

        _pencilOnCreated = (e) => {
            const p = e && e.path;
            if (!p) return;
            try {
                const pts = _extractPenPointsFromFabricPath(p);
                if (pts.length < 2) return;
                p.set({
                    fill: null,
                    stroke: brush.color,
                    strokeWidth: brush.width,
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    strokeUniform: true,
                    selectable: true,
                    evented: true,
                    objectCaching: true
                });
                p._simplePenData = { points: pts, closed: false };
                p._isPencilStroke = true; // distingue le tracé crayon du tracé plume
                const orig = p.toObject.bind(p);
                p.toObject = function(props) {
                    return fabric.util.object.extend(orig(props), {
                        _simplePenData: this._simplePenData,
                        _isPencilStroke: this._isPencilStroke
                    });
                };
                if (typeof updateLayersPanel === 'function') updateLayersPanel();
                if (typeof saveState === 'function') saveState('Tracé crayon');
            } catch (err) {
                console.warn('[PencilTool] extraction échouée:', err);
            }
        };
        canvas.on('path:created', _pencilOnCreated);
        _pencilUiSetActive(true);
        console.log('✏️ Crayon — clic-glisse pour tracer, le tracé devient éditable à la plume');
    }

    function deactivatePencil() {
        if (!_pencilCanvas) return;
        try { _pencilCanvas.off('path:created', _pencilOnCreated); } catch(_) {}
        try {
            _pencilCanvas.isDrawingMode = !!_pencilSavedDrawing;
            _pencilCanvas.selection = (_pencilSavedSelection != null) ? _pencilSavedSelection : true;
            _pencilCanvas.skipTargetFind = !!_pencilSavedSkip;
            _pencilCanvas.defaultCursor = _pencilSavedCursor || 'default';
            _pencilCanvas.requestRenderAll();
        } catch(_) {}
        _pencilCanvas = null;
        _pencilOnCreated = null;
        _pencilUiSetActive(false);
    }

    function _pencilUiSetActive(on) {
        const btn = document.getElementById('pencilTool');
        if (btn) btn.classList.toggle('active', on);
    }

    api.activatePencil = activatePencil;
    api.deactivatePencil = deactivatePencil;
    api.isPencilActive = () => !!_pencilCanvas;

    console.log('✅ ProPenTool chargé – Mode DESSIN + Mode ÉDITION + Crayon');
})();
