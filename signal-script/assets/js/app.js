(function () {
  'use strict';
  var APP = window.APP || {};

  // Countdown timers for active signals
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var now = Date.now();
    document.querySelectorAll('.countdown[data-expires]').forEach(function (el) {
      var t = Date.parse(el.getAttribute('data-expires'));
      if (isNaN(t)) return;
      var s = Math.max(0, Math.floor((t - now) / 1000));
      if (s === 0) { el.textContent = 'Closing…'; el.classList.add('done'); return; }
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      el.textContent = '⏱ ' + (h > 0 ? h + ':' + pad(m) : pad(m)) + ':' + pad(sec);
    });
  }
  tick();
  setInterval(tick, 1000);

  // Copy buttons
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var input = document.querySelector(btn.getAttribute('data-copy'));
    if (!input) return;
    input.select();
    (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.resolve(document.execCommand('copy')))
      .then(function () { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); });
  });

  // AJAX opt-in forms
  document.querySelectorAll('form[data-ajax]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.fetch) return;
      e.preventDefault();
      var msg = form.querySelector('.form-msg');
      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (msg) { msg.textContent = d.message; msg.className = 'form-msg ' + (d.ok ? 'ok' : 'err'); }
          if (d.ok) {
            form.reset();
            try { localStorage.setItem('optin_done', '1'); } catch (x) {}
            var modal = form.closest('.modal');
            if (modal) setTimeout(function () { modal.hidden = true; }, 1500);
          }
        })
        .catch(function () { form.submit(); });
    });
  });

  // Opt-in popup
  var modal = document.getElementById('optin-modal');
  if (modal) {
    var seen = false;
    try { seen = localStorage.getItem('optin_done') || sessionStorage.getItem('optin_seen'); } catch (x) {}
    if (!seen) {
      var show = function () {
        if (!modal.hidden) return;
        modal.hidden = false;
        try { sessionStorage.setItem('optin_seen', '1'); } catch (x) {}
      };
      var delay = parseInt(modal.getAttribute('data-delay') || '15', 10) * 1000;
      var timer = setTimeout(show, delay);
      document.addEventListener('mouseout', function (e) {
        if (!e.relatedTarget && e.clientY < 10) { clearTimeout(timer); show(); }
      });
    }
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.hasAttribute('data-close')) modal.hidden = true;
    });
  }

  // Live signals refresh
  var live = document.getElementById('live-signals');
  if (live && window.fetch) {
    var maxId = parseInt(live.getAttribute('data-max-id') || '0', 10);
    var toast = document.getElementById('toast');
    var poll = function () {
      fetch(APP.base + '/api/signals?since=' + maxId, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.signals && d.signals.length) {
            var s = d.signals[0];
            if (toast) {
              toast.textContent = '🔔 New signal: ' + s.asset + ' ' + s.label + ' — click to refresh';
              toast.hidden = false;
              toast.onclick = function () { location.reload(); };
            }
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('New signal', { body: s.asset + ' ' + s.label });
            }
            maxId = d.maxId;
            setTimeout(function () { location.reload(); }, 8000);
          }
        })
        .catch(function () {});
    };
    setInterval(poll, 30000);
    // Reload when an active signal expires so its result shows up
    setInterval(function () {
      if (document.querySelector('.countdown.done')) location.reload();
    }, 90000);
    if ('Notification' in window && Notification.permission === 'default') {
      live.addEventListener('click', function () { Notification.requestPermission(); }, { once: true });
    }
  }
})();
