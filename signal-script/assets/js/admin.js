(function () {
  'use strict';
  var A = window.ADMIN || {};

  // ---- Visual / HTML editor ----
  document.querySelectorAll('[data-editor]').forEach(function (ed) {
    var vis = ed.querySelector('.ed-visual');
    var ta = ed.querySelector('.ed-html');
    vis.innerHTML = ta.value;
    var sync = function () { if (!ed.classList.contains('html-mode')) ta.value = vis.innerHTML; };
    vis.addEventListener('input', sync);
    ed.closest('form').addEventListener('submit', sync);
    ed.querySelectorAll('[data-cmd]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (ed.classList.contains('html-mode')) return;
        vis.focus();
        var cmd = b.getAttribute('data-cmd');
        if (cmd === 'createLink') {
          var u = prompt('Link URL', 'https://');
          if (u) document.execCommand('createLink', false, u);
        } else if (cmd === 'image') {
          openMedia(function (url) { vis.focus(); document.execCommand('insertImage', false, url); sync(); });
          return;
        } else {
          document.execCommand(cmd, false, b.getAttribute('data-val'));
        }
        sync();
      });
    });
    ed.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var html = b.getAttribute('data-mode') === 'html';
        if (html) { ta.value = vis.innerHTML; } else { vis.innerHTML = ta.value; }
        ed.classList.toggle('html-mode', html);
        ed.querySelectorAll('[data-mode]').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    // Start in HTML mode if content has scripts/styles that visual mode would break
    if (/<(script|style|iframe|form)/i.test(ta.value)) ed.querySelector('[data-mode="html"]').click();
  });

  // ---- Media picker ----
  var modal = document.getElementById('media-modal');
  var callback = null;
  function load() {
    var grid = document.getElementById('media-grid');
    grid.innerHTML = '<p>Loading…</p>';
    fetch(A.media, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      grid.innerHTML = '';
      if (!d.files.length) grid.innerHTML = '<p class="muted">No images yet. Upload one above.</p>';
      d.files.forEach(function (f) {
        var el = document.createElement('div');
        el.className = 'media-item pick';
        el.innerHTML = '<img alt="" loading="lazy">';
        el.querySelector('img').src = f.url;
        el.addEventListener('click', function () { if (callback) callback(f.url); modal.hidden = true; });
        grid.appendChild(el);
      });
    });
  }
  function openMedia(cb) {
    if (!modal) return;
    callback = cb;
    modal.hidden = false;
    load();
  }
  if (modal) {
    modal.addEventListener('click', function (e) { if (e.target === modal || e.target.hasAttribute('data-close')) modal.hidden = true; });
    var up = document.getElementById('media-upload');
    up.querySelector('input').addEventListener('change', function () {
      var fd = new FormData(up);
      fd.append('_csrf', A.csrf);
      fetch(A.media, { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) alert(d.error);
        up.reset();
        load();
      });
    });
  }
  document.querySelectorAll('[data-pick]').forEach(function (b) {
    b.addEventListener('click', function () {
      var input = document.querySelector(b.getAttribute('data-pick'));
      openMedia(function (url) { input.value = url; });
    });
  });
})();
