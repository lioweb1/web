(function () {
  'use strict';
  var APP = window.APP || {};

  // Countdown timers for active signals
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var now = Date.now();
    document.querySelectorAll('.countdown[data-expires], .promo-countdown[data-expires]').forEach(function (el) {
      var t = Date.parse(el.getAttribute('data-expires'));
      if (isNaN(t)) return;
      var s = Math.max(0, Math.floor((t - now) / 1000));
      var promo = el.classList.contains('promo-countdown');
      if (s === 0) {
        if (promo) { var bar = el.closest('.announce'); if (bar) bar.remove(); return; }
        el.textContent = 'Closing…'; el.classList.add('done'); return;
      }
      var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      el.textContent = (promo ? 'Ends in ' : '⏱ ') + (d > 0 ? d + 'd ' + pad(h) + ':' : (h > 0 ? h + ':' : '')) + pad(m) + ':' + pad(sec);
    });
  }
  tick();
  setInterval(tick, 1000);

  // Copy buttons
  document.addEventListener('click', function (e) {
    var share = e.target.closest('[data-copy-text]');
    if (share) {
      var txt = share.getAttribute('data-copy-text');
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) { navigator.share({ url: txt }).catch(function () {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { share.textContent = 'Copied!'; setTimeout(function () { share.textContent = 'Copy link'; }, 1500); });
      return;
    }
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

  // Tabs (markets page)
  document.querySelectorAll('[data-tabs]').forEach(function (tabs) {
    var links = tabs.querySelectorAll('a[href^="#"]');
    function show(id) {
      links.forEach(function (a) {
        var on = a.getAttribute('href') === '#' + id;
        a.classList.toggle('active', on);
        var panel = document.getElementById(a.getAttribute('href').slice(1));
        if (panel) panel.hidden = !on;
      });
    }
    links.forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var id = a.getAttribute('href').slice(1); show(id); history.replaceState(null, '', '#' + id); });
    });
    var start = location.hash.slice(1);
    if (start && document.getElementById(start)) show(start);
  });

  // Reveal-on-scroll animations
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal, .signal-card, .plan-card, .feature, .post-card, .broker-card, .stat').forEach(function (el) {
      el.classList.add('reveal'); io.observe(el);
    });
  }

  // Calculators
  function num(form, name) { var el = form.querySelector('[name="' + name + '"]'); return el ? parseFloat(el.value) || 0 : 0; }
  function val(form, name) { var el = form.querySelector('[name="' + name + '"]'); return el ? el.value : ''; }
  function out(tool, name, v) { var el = tool.querySelector('[data-out="' + name + '"]'); if (el) el.innerHTML = v; }
  function usd(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  var calcs = {
    lot: function (t) {
      var bal = num(t, 'balance'), risk = num(t, 'risk'), sl = num(t, 'sl'), pair = val(t, 'pair');
      var jpyRow = t.querySelector('.jpy-row'); if (jpyRow) jpyRow.style.display = pair === 'jpy' ? '' : 'none';
      var pipPerLot = pair === 'jpy' ? 1000 / (num(t, 'jpy') || 150) : (pair === 'gold' ? 10 : 10);
      var riskAmt = bal * risk / 100;
      var lots = sl > 0 ? riskAmt / (sl * pipPerLot) : 0;
      out(t, 'riskAmt', usd(riskAmt));
      out(t, 'lots', lots.toFixed(2) + ' lots');
      out(t, 'mini', (lots * 10).toFixed(1) + ' mini · ' + Math.round(lots * 100) + ' micro');
    },
    rr: function (t) {
      var dir = num(t, 'dir'), en = num(t, 'entry'), sl = num(t, 'sl'), tp = num(t, 'tp');
      var risk = (en - sl) * dir, reward = (tp - en) * dir;
      if (risk <= 0 || reward <= 0) { out(t, 'ratio', '—'); out(t, 'be', '—'); out(t, 'valid', '<span class="down">Check SL/TP side</span>'); return; }
      var r = reward / risk;
      out(t, 'ratio', '1 : ' + r.toFixed(2));
      out(t, 'be', (100 / (1 + r)).toFixed(1) + '%');
      out(t, 'valid', r >= 1.5 ? '<span class="up">Good setup</span>' : (r >= 1 ? 'OK' : '<span class="down">Poor reward</span>'));
    },
    pip: function (t) {
      var lots = num(t, 'lots'), pip = parseFloat(val(t, 'pip')), price = num(t, 'price') || 1;
      var v = lots * 100000 * pip / price;
      out(t, 'value', usd(v)); out(t, 'ten', usd(v * 10)); out(t, 'fifty', usd(v * 50));
    },
    binary: function (t) {
      var st = num(t, 'stake'), p = num(t, 'payout') / 100, n = num(t, 'trades'), wr = num(t, 'wr') / 100;
      var exp = n * (wr * st * p - (1 - wr) * st);
      out(t, 'win', usd(st * p));
      out(t, 'exp', '<span class="' + (exp >= 0 ? 'up' : 'down') + '">' + usd(exp) + '</span>');
      out(t, 'be', p > 0 ? (100 / (1 + p)).toFixed(1) + '%' : '—');
    },
    martingale: function (t) {
      var st = num(t, 'stake'), p = num(t, 'payout') / 100, steps = Math.min(15, Math.max(1, num(t, 'steps')));
      var rows = '', total = 0, stake = st;
      for (var i = 1; i <= steps; i++) {
        if (i > 1) stake = p > 0 ? (total + st * p) / p : stake * 2;
        total += stake;
        rows += '<tr><td>' + i + '</td><td>' + usd(stake) + '</td><td>' + usd(total) + '</td><td class="up">' + usd(stake * p - (total - stake)) + '</td></tr>';
      }
      out(t, 'table', rows);
    },
    compound: function (t) {
      var start = num(t, 'start'), r = num(t, 'rate') / 100, d = Math.min(3650, num(t, 'days'));
      var fin = start * Math.pow(1 + r, d);
      out(t, 'final', usd(fin)); out(t, 'profit', usd(fin - start)); out(t, 'growth', start > 0 ? ((fin / start - 1) * 100).toFixed(0) + '%' : '—');
    }
  };
  document.querySelectorAll('[data-tool]').forEach(function (t) {
    var fn = calcs[t.getAttribute('data-tool')];
    if (!fn) return;
    t.addEventListener('input', function () { fn(t); });
    t.addEventListener('change', function () { fn(t); });
    fn(t);
  });

  // PWA: service worker + install button
  if (APP.pwa && 'serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register(APP.base + '/sw.js').catch(function () {}); });
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferred = e;
      if (document.getElementById('install-app')) return;
      var b = document.createElement('button');
      b.id = 'install-app'; b.className = 'install-app'; b.textContent = '📲 Install app';
      b.onclick = function () { deferred.prompt(); deferred.userChoice.finally(function () { b.remove(); }); };
      document.body.appendChild(b);
    });
  }
})();
