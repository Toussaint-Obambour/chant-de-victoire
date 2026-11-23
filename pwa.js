/* Complement iPhone/iPad : installation, hors ligne, ecran allume. */
(function () {
  'use strict';

  /* --- Ecran allume en mode culte (Safari 16.4+) --- */
  var lock = null;
  function acquire() {
    if (lock || !navigator.wakeLock || !document.body.classList.contains('projection')) return;
    navigator.wakeLock.request('screen').then(function (l) {
      lock = l;
      l.addEventListener('release', function () { if (lock === l) lock = null; });
    }).catch(function () {});
  }
  function release() {
    if (!lock) return;
    try { lock.release(); } catch (e) {}
    lock = null;
  }
  function syncWake() {
    if (document.body.classList.contains('projection')) acquire(); else release();
  }
  new MutationObserver(syncWake).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') syncWake();
  });
  syncWake();

  /* --- Petite annonce discrete (installation / preparation hors ligne) --- */
  function note(text, ms) {
    if (document.body.classList.contains('projection')) return;
    var el = document.getElementById('pwaNote');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pwaNote';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);max-width:88vw;padding:11px 16px;border-radius:14px;background:rgba(24,16,18,.94);color:#fff3da;font:14px/1.4 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 8px 26px rgba(0,0,0,.4);z-index:200;transition:opacity .3s';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(note.timer);
    note.timer = setTimeout(function () { el.style.opacity = '0'; }, ms || 5200);
  }

  /* --- Service worker : mise hors ligne complete --- */
  if (!('serviceWorker' in navigator) || location.protocol.indexOf('http') !== 0) return;

  var readyNotified = false;
  navigator.serviceWorker.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'precache' && data.done === data.total && !readyNotified) {
      readyNotified = true;
      var key = 'cv_pwa_ready_' + data.total;
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
      } catch (e) {}
      note('Tout est enregistré : l\'application fonctionne sans Internet.', 7000);
    }
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function () {
      var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      var standalone = window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (ios && !standalone) {
        try {
          if (localStorage.getItem('cv_pwa_install_hint')) return;
          localStorage.setItem('cv_pwa_install_hint', '1');
        } catch (e) {}
        setTimeout(function () {
          note('Pour installer : bouton Partager de Safari, puis \u00ab Sur l\'\u00e9cran d\'accueil \u00bb.', 9000);
        }, 1200);
      }
    }).catch(function () {});
  });
})();
