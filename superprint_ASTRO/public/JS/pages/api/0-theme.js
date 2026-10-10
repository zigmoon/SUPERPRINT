
  // Thème (préférence partagée avec documentation.html)
  function setTheme(theme) {
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.getElementById('btnLight').classList.toggle('active', theme === 'light');
    document.getElementById('btnDark').classList.toggle('active', theme === 'dark');
    localStorage.setItem('sp-doc-theme', theme);
  }
  const savedTheme = localStorage.getItem('sp-doc-theme');
  if (savedTheme) setTheme(savedTheme);

  // Langue (préférence partagée avec documentation.html)
  function setLang(lang) {
    document.body.classList.toggle('lang-fr', lang === 'fr');
    document.body.classList.toggle('lang-en', lang === 'en');
    document.querySelectorAll('.lang-toggle button').forEach(function (b) {
      b.classList.toggle('active', b.textContent.trim() === lang.toUpperCase());
    });
    document.title = lang === 'fr'
      ? 'SuperPrint — API (automatisez vos maquettes)'
      : 'SuperPrint — API (automate your layouts)';
    localStorage.setItem('sp-doc-lang', lang);
  }
  setLang(localStorage.getItem('sp-doc-lang') || 'en');
