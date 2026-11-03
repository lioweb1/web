(function () {
  'use strict';

  // Mobile sidebar toggle
  document.querySelectorAll('[data-toggle-sidebar]').forEach(function (btn) {
    btn.addEventListener('click', function () { document.body.classList.toggle('sidebar-open'); });
  });

  // Tools list: category pills + search
  var cards = Array.prototype.slice.call(document.querySelectorAll('.tool-card'));
  var search = document.querySelector('[data-tool-search]');
  var noResults = document.querySelector('[data-no-results]');
  var currentCat = 'all';

  function applyFilter() {
    var term = search ? search.value.trim().toLowerCase() : '';
    var shown = 0;
    cards.forEach(function (card) {
      var ok = (currentCat === 'all' || card.dataset.category === currentCat) &&
        (term === '' || card.dataset.name.indexOf(term) !== -1);
      card.hidden = !ok;
      if (ok) shown++;
    });
    if (noResults) noResults.hidden = shown !== 0;
  }

  document.querySelectorAll('.pill[data-cat]').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.pill[data-cat]').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      currentCat = pill.dataset.cat;
      applyFilter();
    });
  });
  if (search) search.addEventListener('input', applyFilter);

  // Copy result
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = document.querySelector(btn.dataset.copy);
      if (!el) return;
      var done = function () { var t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = t; }, 1500); };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(el.value).then(done);
      } else {
        el.select(); document.execCommand('copy'); done();
      }
    });
  });

  // Prevent double submit on tool forms (avoids charging credits twice)
  document.querySelectorAll('[data-busy-form]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var btn = form.querySelector('[data-busy-text]');
      if (btn) {
        setTimeout(function () { btn.disabled = true; btn.textContent = btn.dataset.busyText; }, 0);
      }
    });
  });

  // Confirmation prompts
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
})();
