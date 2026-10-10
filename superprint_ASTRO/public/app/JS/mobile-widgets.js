/**
 * Mobile Widgets Reorganization
 * 🛡️ DISABLED 2026-05-06 : la relocation des widgets dans la sidebar
 *   droite cassait le layout sur petits ecrans. Remplace par un override
 *   pur CSS qui les transforme en pastilles rondes 40px en bas-gauche du
 *   canvas (cf. CSS/main.css @media (max-width:768px)). Ce fichier est
 *   conserve mais inactif pour eviter de casser des references externes.
 */
(function () {
    /* 🛡️ 2026-05-06 (v4) : refonte complete.
       En mobile (<=768px) les 4 widgets (Styles / Pathfinder / Nuancier / Filtres)
       sont totalement masques sur le plan de travail. Ils s'ouvrent depuis le
       menu burger en BOTTOM SHEET plein largeur (75vh) avec backdrop, et se
       ferment via la croix dans le header, le backdrop, ou la touche ESC. */
    var WIDGET_IDS = ['typoStylesWidget', 'pathfinderWidget', 'swatchesWidget', 'filtersWidget'];
    var HEADER_SELECTORS = ['.typo-styles-header', '.pathfinder-header', '.swatches-header', '.filters-header'];

    function isMobile() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    function ensureBackdrop() {
        var bd = document.getElementById('spMobileWidgetBackdrop');
        if (!bd) {
            bd = document.createElement('div');
            bd.id = 'spMobileWidgetBackdrop';
            document.body.appendChild(bd);
            bd.addEventListener('click', closeAll);
        }
        return bd;
    }

    function closeAll() {
        WIDGET_IDS.forEach(function (id) {
            var w = document.getElementById(id);
            if (w) w.classList.remove('sp-mobile-sheet-open');
        });
        var bd = document.getElementById('spMobileWidgetBackdrop');
        if (bd) bd.classList.remove('visible');
        document.body.style.overflow = '';
    }

    function openSheet(targetId) {
        if (!isMobile()) return;
        closeAll();
        var w = document.getElementById(targetId);
        if (!w) return;
        ensureBackdrop().classList.add('visible');
        w.classList.add('sp-mobile-sheet-open');
        document.body.style.overflow = 'hidden';
    }

    function closeMobileBurgerMenu() {
        var m = document.getElementById('mobileMenu');
        if (m) m.classList.remove('active');
    }

    document.addEventListener('DOMContentLoaded', function () {
        // Wire les 4 nouveaux items du menu burger
        document.querySelectorAll('.sp-mobile-widget-trigger').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var target = btn.getAttribute('data-target');
                closeMobileBurgerMenu();
                openSheet(target);
            });
        });

        // Croix de fermeture (::after sur le header) -> on detecte un clic
        // dans la zone droite (>= header.width - 50) du header.
        document.addEventListener('click', function (e) {
            if (!isMobile()) return;
            for (var i = 0; i < HEADER_SELECTORS.length; i++) {
                var hd = e.target.closest(HEADER_SELECTORS[i]);
                if (hd && hd.parentElement && hd.parentElement.classList.contains('sp-mobile-sheet-open')) {
                    var rect = hd.getBoundingClientRect();
                    if (e.clientX >= rect.right - 56) {
                        e.preventDefault();
                        e.stopPropagation();
                        closeAll();
                    }
                    return;
                }
            }
        }, true);

        // ESC ferme la sheet
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (document.querySelector('.sp-mobile-sheet-open')) closeAll();
            }
        });

        // Si on bascule de mobile -> desktop, fermer la sheet
        window.matchMedia('(max-width: 768px)').addEventListener('change', function (ev) {
            if (!ev.matches) closeAll();
        });
    });

    // Expose pour eventuel usage externe
    window.SPMobileWidgets = { open: openSheet, close: closeAll };
})();
/* === Legacy code disabled below ===
(function() {
    // Configuration of widgets to move
    const widgets = [
        { 
            id: 'typoStylesWidget', 
            listId: 'typoStylesList', 
            sectionId: 'widget-styles', 
            title: 'Styles', 
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
            </svg>`
        },
        { 
            id: 'pathfinderWidget', 
            listId: null, // No specific list ID, uses class
            listClass: 'pathfinder-list', 
            sectionId: 'widget-pathfinder', 
            title: 'Pathfinder', 
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="11" height="11" rx="2"/><rect x="10" y="10" width="11" height="11" rx="2"/>
            </svg>` 
        },
        { 
            id: 'swatchesWidget', 
            listId: 'swatchesList', 
            sectionId: 'widget-swatches', 
            title: 'Nuancier', 
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 12V2a10 10 0 0 1 0 20 10 10 0 0 1 0-20z"/>
            </svg>`
        },
        { 
            id: 'filtersWidget', 
            listId: 'filtersList', 
            sectionId: 'widget-filters', 
            title: 'Filtres', 
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>`
        }
    ];
    
    // State tracking
    window.isMobileWidgetsMoved = false;
    
    function updateMobileWidgetsLayout() {
        // Mobile detection threshold (can be adjusted)
        const isMobile = (window.innerWidth <= 768);
        const rightSidebar = document.getElementById('rightSidebar');
        const rightIcons = rightSidebar ? rightSidebar.querySelector('.rightbar-icons') : null;
        
        if (!rightSidebar || !rightIcons) return;
        
        // CASE 1: Switch to Mobile Layout
        if (isMobile && !window.isMobileWidgetsMoved) {
            console.log('📱 Switching to Mobile Layout: Docking widgets to sidebar');
            
            widgets.forEach(w => {
                const widgetEl = document.getElementById(w.id);
                // Find content element (either by ID or Class)
                const listEl = w.listId 
                    ? document.getElementById(w.listId) 
                    : (widgetEl ? widgetEl.querySelector('.' + w.listClass) : null);
                
                if (widgetEl && listEl) {
                    // 1. Hide the original floating widget
                    widgetEl.style.display = 'none';
                    widgetEl.classList.add('mobile-hidden-widget');
                    
                    // 2. Create Icon Button in Sidebar (for collapsed state)
                    if (!rightIcons.querySelector(`[data-section="${w.sectionId}"]`)) {
                        const btn = document.createElement('button');
                        btn.className = 'rightbar-icon-btn mobile-widget-icon';
                        btn.dataset.section = w.sectionId;
                        btn.title = w.title;
                        // Use SVG directly, remove text styling spans if any
                        btn.innerHTML = w.icon;
                        btn.onclick = () => {
                            if (window.toggleSidebar) window.toggleSidebar('right');
                            // Scroll to section?
                            const paramSection = rightSidebar.querySelector(`.section[data-section="${w.sectionId}"]`);
                            if (paramSection) paramSection.scrollIntoView({ behavior: 'smooth' });
                        };
                        rightIcons.appendChild(btn);
                    }
                    
                    // 3. Create/Get Section in Sidebar
                    let section = rightSidebar.querySelector(`.section[data-section="${w.sectionId}"]`);
                    if (!section) {
                        section = document.createElement('div');
                        section.className = 'section mobile-widget-section';
                        section.dataset.section = w.sectionId;
                        section.innerHTML = `<div class="section-title">${w.title}</div>`;
                        rightSidebar.appendChild(section);
                    }
                    
                    // 4. Move Content
                    listEl.classList.add('mobile-moved-content');
                    // Store parent to restore later if needed (though we assume ID restoration)
                    listEl.dataset.originalParent = widgetEl.id;
                    
                    // Force display block/flex as needed (resetting potential 'none' from widget toggles)
                    listEl.style.display = ''; 
                    
                    section.appendChild(listEl);
                }
            });
            
            window.isMobileWidgetsMoved = true;
            
        } 
        // CASE 2: Switch back to Desktop Layout
        else if (!isMobile && window.isMobileWidgetsMoved) {
            console.log('💻 Switching to Desktop Layout: Restoring widgets');
            
            widgets.forEach(w => {
                const widgetEl = document.getElementById(w.id);
                const section = rightSidebar.querySelector(`.section[data-section="${w.sectionId}"]`);
                
                if (widgetEl && section) {
                    // Find the moved content
                    const listEl = section.querySelector('.mobile-moved-content');
                    
                    if (listEl) {
                        listEl.classList.remove('mobile-moved-content');
                        
                        // Restore to original location
                        // Note: We append to widgetEl. Usually headers are first, list is second.
                        // Safe to just appendChild as header should be there.
                        widgetEl.appendChild(listEl);
                    }
                    
                    // Show original widget again
                    widgetEl.style.display = '';
                    widgetEl.classList.remove('mobile-hidden-widget');
                }
            });
            
            // Cleanup created elements
            document.querySelectorAll('.mobile-widget-icon').forEach(e => e.remove());
            document.querySelectorAll('.mobile-widget-section').forEach(e => e.remove());
            
            window.isMobileWidgetsMoved = false;
        }
    }
    
    // Initialize
    window.addEventListener('load', updateMobileWidgetsLayout);
    window.addEventListener('resize', updateMobileWidgetsLayout);
    
    // Run immediately in case script loads after window load
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        updateMobileWidgetsLayout();
    }
})();
=== End legacy code === */
