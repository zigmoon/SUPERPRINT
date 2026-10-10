
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

function setSidebarOpen(open, restoreFocus) {
  document.body.classList.toggle('sidebar-open', open);
  mobileMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  sidebarBackdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (!open && restoreFocus) mobileMenuBtn.focus();
}

mobileMenuBtn.addEventListener('click', () => setSidebarOpen(true));
sidebarCloseBtn.addEventListener('click', () => setSidebarOpen(false, true));
sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false, true));
document.getElementById('sidebar').addEventListener('click', event => {
  if (event.target.closest('a')) setSidebarOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) setSidebarOpen(false, true);
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const t = (event.target || {}).tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || (event.target && event.target.isContentEditable)) return;
    const inp = document.getElementById('docSearch');
    if (inp) { event.preventDefault(); inp.focus(); inp.select(); }
  }
});
document.getElementById('docSearchHint').classList.add('has-shortcut');

/* 1.7.544 — LA MARGE HAUTE DU CONTENU SUIT LA HAUTEUR RÉELLE DE L'EN-TÊTE.
   Mesuré : en-tête de 108 px pour une marge figée à 100 px (et davantage d'en-tête avec une
   encoche) → le premier titre passait sous la barre. En mobile on mesure l'en-tête ; sur
   ordinateur on REND LA MAIN À LA FEUILLE DE STYLES (marge de 52 px d'origine). */
function spAjusterMargeEntete() {
  var tb = document.querySelector('.topbar');
  if (!tb) return;
  var mobile = window.matchMedia('(max-width: 900px)').matches;
  var h = tb.offsetHeight || 0;
  document.querySelectorAll('.main').forEach(function (el) {
    el.style.marginTop = mobile ? (h + 8) + 'px' : '';
  });
  document.querySelectorAll('h1[id], h2[id], h3[id]').forEach(function (el) {
    el.style.scrollMarginTop = mobile ? (h + 20) + 'px' : '';
  });
}
window.addEventListener('load', spAjusterMargeEntete);
window.addEventListener('resize', spAjusterMargeEntete);
window.addEventListener('orientationchange', spAjusterMargeEntete);
document.addEventListener('DOMContentLoaded', spAjusterMargeEntete);
if (document.readyState !== 'loading') spAjusterMargeEntete();

// Tab switching
function setTab(tab) {
  document.getElementById('tab-doc').classList.toggle('active', tab === 'doc');
  document.getElementById('tab-manual').classList.toggle('active', tab === 'manual');
  document.getElementById('sidebar-doc').classList.toggle('active', tab === 'doc');
  document.getElementById('sidebar-manual').classList.toggle('active', tab === 'manual');
  document.querySelectorAll('.tab-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  localStorage.setItem('sp-doc-tab', tab);
  setSidebarOpen(false);
  window.scrollTo(0, 0);
}
// Restore tab preference
const savedTab = localStorage.getItem('sp-doc-tab');
if (savedTab) setTab(savedTab);

// Theme toggle
function setTheme(theme) {
  document.body.classList.toggle('theme-dark', theme === 'dark');
  document.getElementById('btnLight').classList.toggle('active', theme === 'light');
  document.getElementById('btnDark').classList.toggle('active', theme === 'dark');
  localStorage.setItem('sp-doc-theme', theme);
}
// Restore theme preference
const savedTheme = localStorage.getItem('sp-doc-theme');
if (savedTheme) setTheme(savedTheme);

// Language toggle
function setLang(lang) {
  document.body.classList.toggle('lang-fr', lang === 'fr');
  document.querySelectorAll('.lang-toggle button').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === lang.toUpperCase());
  });
  document.title = lang === 'fr'
    ? 'SuperPrint — Documentation technique / Technical Documentation'
    : 'SuperPrint — Technical Documentation / Documentation technique';
  localStorage.setItem('sp-doc-lang', lang);
}
// Restore preference (default: English)
const savedLang = localStorage.getItem('sp-doc-lang');
setLang(savedLang || 'en');

// ═══ GLOBAL SEARCH ═══
// Filtre les sections (h2/h3) du contenu actif + met en évidence + navigue vers la 1re.
function searchDocs(query) {
  query = (query || '').toLowerCase().trim();
  const countEl = document.getElementById('docSearchCount');
  // Déterminer l'onglet actif
  const activeMain = document.querySelector('.main.tab-content.active');
  if (!activeMain) { if (countEl) countEl.textContent = ''; return; }

  // Retirer les marquages précédents
  activeMain.querySelectorAll('mark').forEach(m => {
    const p = m.parentNode;
    p.replaceChild(document.createTextNode(m.textContent), m);
    p.normalize();
  });
  activeMain.querySelectorAll('h2[id].match, h3[id].match, h1[id].match').forEach(s => s.classList.remove('match'));

  if (!query) { if (countEl) countEl.textContent = ''; return; }

  const sections = activeMain.querySelectorAll('h2[id], h3[id], h1[id]');
  let count = 0;
  let firstSection = null;
  const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');

  sections.forEach(sec => {
    // Le texte de la section (titres + contenu suivant jusqu'au prochain heading)
    let text = '';
    let node = sec.nextElementSibling;
    while (node && !/^H[1-4]$/i.test(node.tagName)) {
      text += ' ' + node.textContent;
      node = node.nextElementSibling;
    }
    const full = (sec.textContent + ' ' + text).toLowerCase();
    const match = full.includes(query);

    if (match) {
      sec.classList.add('match');
      if (!firstSection) firstSection = sec;
      count++;
      // Highlight UNIQUEMENT dans les nœuds de texte directs du titre (préserve les spans data-lang)
      highlightTextNodes(sec, re);
    }
  });

  if (countEl) countEl.textContent = count ? count + ' résultat(s)' : '0';
  // Naviguer vers la 1re section trouvée
  if (firstSection) {
    firstSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

// Entoure les occurrences du regex dans les nœuds de texte d'un élément (préserve le HTML)
function highlightTextNodes(el, re) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  targets.forEach(t => {
    if (!re.test(t.nodeValue)) return;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(t.nodeValue)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(t.nodeValue.slice(last, m.index)));
      const mark = document.createElement('mark');
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < t.nodeValue.length) frag.appendChild(document.createTextNode(t.nodeValue.slice(last)));
    t.parentNode.replaceChild(frag, t);
  });
}

// Function search filter
function filterFunctions() {
  const q = document.getElementById('fnSearch').value.toLowerCase().trim();
  document.querySelectorAll('.fn-table tbody tr').forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

// Sidebar active state on scroll
function updateSidebarActive() {
  const allSections = document.querySelectorAll('h2[id], h3[id], h1[id]');
  const activeTabLinks = document.querySelectorAll('.sidebar-section.active a[href^="#"]');
  let current = '';
  allSections.forEach(s => {
    if (s.offsetParent !== null && window.scrollY >= s.offsetTop - 100) current = s.id;
  });
  activeTabLinks.forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + current);
  });
}
window.addEventListener('scroll', updateSidebarActive, { passive: true });
