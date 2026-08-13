(function () {
  'use strict';

  var cfg = window.HAITUN_ANALYTICS || {};
  if (typeof cfg === 'string') {
    try {
      cfg = JSON.parse(cfg);
    } catch (e) {
      cfg = {};
    }
  }
  if (!cfg.enabled || !cfg.endpoint) return;

  var endpoint = cfg.endpoint;
  var trackScroll = cfg.trackScrollDepth !== false;
  var pageLoadedAt = Date.now();
  var maxDepth = 0;
  var leftSent = false;

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getClientId() {
    try {
      var id = localStorage.getItem('haitun-visitor-id');
      if (!id) {
        id = uuid();
        localStorage.setItem('haitun-visitor-id', id);
      }
      return id;
    } catch (e) {
      return uuid();
    }
  }

  function getSessionId() {
    try {
      var id = sessionStorage.getItem('haitun-session-id');
      if (!id) {
        id = uuid();
        sessionStorage.setItem('haitun-session-id', id);
      }
      return id;
    } catch (e) {
      return uuid();
    }
  }

  // The collector stores this timestamp as-is, so report Beijing time (UTC+8).
  function nowIso() {
    var beijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return beijing.toISOString().replace('Z', '+08:00');
  }

  function detectOS() {
    var ua = navigator.userAgent.toLowerCase();
    if (/windows|win/.test(ua)) return 'windows';
    if (/mac|macintosh/.test(ua)) return 'mac';
    if (/linux|x11|ubuntu/.test(ua)) return 'linux';
    if (/android/.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    return 'other';
  }

  function detectDevice() {
    return /android|iphone|ipad|ipod|mobile|tablet/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  function send(name, props) {
    var payload = {
      name: name,
      page: location.pathname + location.search,
      url: location.href,
      referrer: document.referrer || '',
      lang: document.documentElement.lang || navigator.language || '',
      os: detectOS(),
      device: detectDevice(),
      clientId: getClientId(),
      sessionId: getSessionId(),
      ts: nowIso(),
      props: props || {}
    };
    var body = JSON.stringify(payload);
    if (window.fetch) {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    }
  }

  function propsFrom(el) {
    var props = {};
    if (!el || !el.dataset) return props;
    Object.keys(el.dataset).forEach(function (key) {
      if (key.indexOf('track') !== 0) return;
      var propKey = key.slice(5).toLowerCase();
      if (propKey) props[propKey] = el.dataset[key];
    });
    return props;
  }

  function sourceFor(el) {
    if (!el) return '';
    if (el.id === 'mainDownloadBtn' || el.id === 'hero-download-main') return 'hero_main';
    if (el.classList.contains('download-option')) return 'hero_dropdown';
    if (el.classList.contains('download-more-link')) return 'release_history';
    if (el.classList.contains('platform-item')) return 'platform_icon';
    if (el.closest('.download-card')) return 'download_card';
    if (el.closest('.download-cta-section')) return 'bottom_cta';
    return 'unknown';
  }

  function platformFor(el) {
    if (el && el.dataset && el.dataset.os) return el.dataset.os;
    if (el && el.classList) {
      if (el.classList.contains('platform-windows')) return 'windows';
      if (el.classList.contains('platform-macos')) return 'mac';
      if (el.classList.contains('platform-linux')) return 'linux';
    }
    return detectOS();
  }

  function isDownloadTarget(el) {
    if (!el || !el.href) return false;
    return /\.(exe|zip|dmg)(\?|$)|releases\/download|gh-proxy\.org/i.test(el.href);
  }

  function trackClick(el) {
    var explicit = el.getAttribute && el.getAttribute('data-track');
    if (explicit) {
      send(explicit, Object.assign(propsFrom(el), {
        source: sourceFor(el),
        platform: platformFor(el),
        url: el.href || ''
      }));
      return;
    }

    var isDownloadLink = isDownloadTarget(el);
    var isDownloadButton =
      el.id === 'mainDownloadBtn' ||
      el.id === 'hero-download-main' ||
      el.classList.contains('download-option') ||
      el.classList.contains('platform-item') ||
      el.classList.contains('download-more-link') ||
      !!el.closest('.download-card') ||
      !!el.closest('.download-cta-section');

    if (isDownloadLink || isDownloadButton) {
      send('download_click', {
        source: sourceFor(el),
        platform: platformFor(el),
        url: el.href || ''
      });
      return;
    }

    if (el.id === 'copyCommandBtn') {
      var cmd = document.getElementById('terminal-command');
      send('copy_command', {
        platform: platformFor(el),
        command: cmd ? cmd.textContent.trim() : ''
      });
      return;
    }

    if (el.classList.contains('terminal-tab')) {
      send('terminal_tab_click', {
        platform: (el.dataset.zh || el.textContent.trim())
          .replace('macOS / Linux', 'mac_linux')
          .replace('Windows PowerShell', 'windows')
      });
      return;
    }

    if (el.id === 'langToggle') {
      send('language_switch', { lang: document.documentElement.lang });
      return;
    }

    if (el.id === 'menuToggle') {
      send('menu_open', {});
      return;
    }

    if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href').indexOf('#') === 0) {
      send('anchor_nav', { section: el.getAttribute('href') });
      return;
    }

    if (el.tagName === 'A' && el.target === '_blank' && !isDownloadLink) {
      send('external_link_click', {
        destination: el.hostname,
        url: el.href,
        source: sourceFor(el)
      });
    }
  }

  function onClick(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('a, button, [data-track]') : null;
    if (!el) return;
    trackClick(el);
  }

  function initScrollTracking() {
    if (!trackScroll) return;
    var reported = {};
    function onScroll() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? Math.min(100, Math.round((window.scrollY || doc.scrollTop) / max * 100)) : 100;
      maxDepth = Math.max(maxDepth, ratio);
      [25, 50, 75, 90].forEach(function (level) {
        if (ratio >= level && !reported[level]) {
          reported[level] = true;
          send('scroll_depth', { depth: level });
        }
      });
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        onScroll();
        ticking = false;
      });
    }, { passive: true });
    onScroll();
  }

  function initFaqTracking() {
    document.querySelectorAll('details.faq-item').forEach(function (details) {
      details.addEventListener('toggle', function () {
        if (!details.open) return;
        var summary = details.querySelector('summary');
        send('faq_open', {
          question: summary ? summary.textContent.trim().slice(0, 200) : ''
        });
      });
    });
  }

  function onPageLeave() {
    if (leftSent) return;
    leftSent = true;
    send('page_leave', {
      durationMs: Date.now() - pageLoadedAt,
      scrollDepth: maxDepth
    });
  }

  function init() {
    document.addEventListener('click', onClick, true);
    initScrollTracking();
    initFaqTracking();
    try {
      if (!sessionStorage.getItem('haitun-session-started')) {
        sessionStorage.setItem('haitun-session-started', '1');
        send('session_start', {});
      }
    } catch (e) {
      send('session_start', {});
    }
    send('pageview', {});
    if (document.visibilityState === 'hidden') onPageLeave();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') onPageLeave();
    });
    window.addEventListener('pagehide', onPageLeave);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
