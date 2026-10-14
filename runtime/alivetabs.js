/* Alive TABs deep-mode runtime.
 * Optional fallback injected into workbench.html by the Alive TABs patcher.
 * Polls the extension-host config server on localhost and paints tab colors
 * directly onto the Monaco tab DOM. Plain script — no modules, no deps.
 */
(function () {
  'use strict';

  var PORTS = [46291, 46292, 46293];
  var POLL_MS = 1500;
  var cfg = { tabStyle: 'tinted', tabs: [] };
  var activePort = null;

  function norm(p) {
    return String(p || '').replace(/\\/g, '/').toLowerCase();
  }

  function openTabTitles() {
    var out = [];
    var labels = document.querySelectorAll('.tabs-container .tab .monaco-icon-label[title]');
    for (var i = 0; i < labels.length; i++) {
      var t = norm(labels[i].getAttribute('title'));
      if (t) out.push(t);
    }
    return out;
  }

  // Multiple IDE windows each run a config server on the next free port.
  // Score every responding config by how many open tab paths live under its
  // workspace roots so a second window never paints another workspace's marks.
  function chooseConfig(results) {
    if (!results.length) {
      activePort = null;
      return;
    }
    var titles = openTabTitles();
    var best = results[0];
    var bestScore = -1;
    for (var i = 0; i < results.length; i++) {
      var roots = (results[i].cfg.roots || []).map(norm);
      var score = 0;
      for (var j = 0; j < titles.length; j++) {
        for (var k = 0; k < roots.length; k++) {
          if (roots[k] && (titles[j] === roots[k] || titles[j].indexOf(roots[k] + '/') === 0)) {
            score++;
            break;
          }
        }
      }
      if (score > bestScore) {
        best = results[i];
        bestScore = score;
      }
    }
    activePort = best.port;
    cfg = best.cfg && best.cfg.tabs ? best.cfg : { tabStyle: 'tinted', tabs: [] };
    apply();
  }

  function poll() {
    var candidates = PORTS.slice();
    if (activePort) candidates.unshift(activePort);
    var results = [];
    var i = 0;
    (function next() {
      if (i >= candidates.length) {
        chooseConfig(results);
        return setTimeout(poll, POLL_MS);
      }
      var port = candidates[i++];
      fetch('http://127.0.0.1:' + port + '/alivetabs', { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (j) {
          results.push({ port: port, cfg: j || {} });
          next();
        })
        .catch(function () {
          next();
        });
    })();
  }

  function baseOf(p) {
    var n = norm(p);
    var idx = n.lastIndexOf('/');
    return idx >= 0 ? n.slice(idx + 1) : n;
  }

  // Glob → RegExp (port of src/pure.ts — this file must stay self-contained).
  function globToRegExp(glob) {
    var re = '';
    var i = 0;
    var n = glob.length;
    while (i < n) {
      var c = glob[i++];
      if (c === '*') {
        if (glob[i] === '*') {
          if (glob[i + 1] === '/') {
            re += '(?:[^/]*/)*';
            i += 2;
          } else {
            re += '.*';
            i += 1;
          }
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else if (c === '{') {
        var end = glob.indexOf('}', i);
        if (end === -1) {
          re += '\\{';
        } else {
          var alts = glob
            .slice(i, end)
            .split(',')
            .map(function (s) {
              return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            });
          re += '(?:' + alts.join('|') + ')';
          i = end + 1;
        }
      } else if (c === '[') {
        var e2 = glob.indexOf(']', i);
        if (e2 === -1) {
          re += '\\[';
        } else {
          re += glob.slice(i - 1, e2 + 1);
          i = e2 + 1;
        }
      } else {
        re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    return new RegExp('^' + re + '$', 'i');
  }

  function globMatch(pattern, p) {
    if (!pattern) return false;
    return globToRegExp(pattern).test(norm(p));
  }

  // `p` matches `title` only on a real path boundary: exact equality, or the
  // title ends with p preceded by '/' — never a raw substring hit, so
  // `/src/app.ts` can no longer match `app.tsx` or `myapp.ts`.
  function pathMatch(title, p) {
    return title === p || (title.length > p.length && title.indexOf(p) === title.length - p.length && title.charAt(title.length - p.length - 1) === '/');
  }

  function matchTab(tab) {
    var list = cfg.tabs || [];
    if (!list.length) return null;

    // 1) Full-path match on the label tooltip (set by VS Code to the file path)
    var iconLabel = tab.querySelector('.monaco-icon-label');
    var title = norm(iconLabel && iconLabel.getAttribute('title'));
    if (title) {
      var found = null;
      var hits = 0;
      for (var i = 0; i < list.length; i++) {
        if (pathMatch(title, norm(list[i].path))) {
          found = list[i];
          hits++;
        }
      }
      if (hits === 1) return found;
    }

    // 2) Exact basename match via data-resource-name — only when unambiguous
    var resName = norm(tab.getAttribute('data-resource-name'));
    if (resName) {
      var byName = null;
      var nHits = 0;
      for (var j = 0; j < list.length; j++) {
        if (norm(list[j].base) === resName) {
          byName = list[j];
          nHits++;
        }
      }
      if (nHits === 1) return byName;
    }

    // 3) Fallback to aria-label before first comma — exact match only
    var al = tab.getAttribute('aria-label') || '';
    var cut = al.indexOf(', ');
    var label = norm((cut > 0 ? al.slice(0, cut) : al).trim().replace(/^[•●]\s*/, ''));
    if (label) {
      var byLabel = null;
      var lHits = 0;
      for (var k = 0; k < list.length; k++) {
        if (label === norm(list[k].base) || label === baseOf(list[k].path)) {
          byLabel = list[k];
          lHits++;
        }
      }
      if (lHits === 1) return byLabel;
    }

    // 4) alivetabs.rules — glob match; first rule wins
    var rules = cfg.rules || [];
    for (var r = 0; r < rules.length; r++) {
      var rule = rules[r] || {};
      var pat = String(rule.pattern || '');
      if (!pat) continue;
      var tgt = pat.indexOf('/') >= 0 ? title : baseOf(title || resName || label);
      if (tgt && globMatch(pat, tgt)) {
        return { flag: rule.flag, color: rule.color };
      }
    }
    return null;
  }

  function setFlagSpan(lbl, flag) {
    var sp = lbl ? lbl.querySelector('span.alivetabs-flag') : null;
    if (!lbl || !flag) {
      if (sp) sp.parentNode.removeChild(sp);
      return;
    }
    var pos = cfg.flagPosition === 'prefix' ? 'prefix' : 'suffix';
    var want = pos === 'prefix' ? flag + ' ' : ' ' + flag;
    if (!sp) {
      sp = document.createElement('span');
      sp.className = 'alivetabs-flag';
    }
    if (sp.textContent !== want) sp.textContent = want;
    var anchor = pos === 'prefix' ? lbl.firstChild : null;
    if (sp.parentNode !== lbl || (pos === 'prefix' ? lbl.firstChild !== sp : lbl.lastChild !== sp)) {
      lbl.insertBefore(sp, anchor);
    }
  }

  function apply() {
    var style = cfg.tabStyle || 'tinted';
    var tabs = document.querySelectorAll('.tabs-container .tab');
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      var m = matchTab(tab);
      var lbl = tab.querySelector('.label-name');
      if (m && (m.color || m.flag)) {
        setFlagSpan(lbl, m.flag);
        if (!m.color) {
          tab.style.removeProperty('background-color');
          tab.style.removeProperty('box-shadow');
          if (lbl) lbl.style.removeProperty('color');
          tab.setAttribute('data-alivetabs', 'flag');
          continue;
        }
        var isActive = tab.classList.contains('active');
        var hex = m.color;
        if (style === 'full') {
          tab.style.setProperty(
            'background-color',
            isActive
              ? hex
              : 'color-mix(in srgb, ' + hex + ' 72%, var(--vscode-tab-inactiveBackground, #1e1e1e))',
            'important',
          );
          tab.style.setProperty('box-shadow', 'inset 0 -2px 0 0 rgba(0,0,0,0.35)', 'important');
          if (lbl) lbl.style.setProperty('color', fgFor(hex), 'important');
        } else if (style === 'border') {
          tab.style.removeProperty('background-color');
          tab.style.setProperty(
            'box-shadow',
            isActive
              ? 'inset 0 2px 0 0 ' + hex + ', inset 0 -2px 0 0 ' + hex
              : 'inset 0 -2px 0 0 ' + hex,
            'important',
          );
          if (lbl) lbl.style.setProperty('color', hex, 'important');
        } else {
          tab.style.setProperty(
            'background-color',
            'color-mix(in srgb, ' + hex + (isActive ? ' 42%' : ' 24%') + ', transparent)',
            'important',
          );
          tab.style.setProperty(
            'box-shadow',
            isActive
              ? 'inset 0 0 0 1px ' + hex + ', inset 0 -2px 0 0 ' + hex
              : 'inset 0 -2px 0 0 ' + hex,
            'important',
          );
          if (lbl) {
            lbl.style.setProperty(
              'color',
              'color-mix(in srgb, ' + hex + ' 35%, var(--vscode-tab-activeForeground, #ffffff))',
              'important',
            );
          }
        }
        tab.setAttribute('data-alivetabs', hex);
      } else if (tab.hasAttribute('data-alivetabs')) {
        tab.style.removeProperty('background-color');
        tab.style.removeProperty('background');
        tab.style.removeProperty('box-shadow');
        if (lbl) lbl.style.removeProperty('color');
        setFlagSpan(lbl, null);
        tab.removeAttribute('data-alivetabs');
      }
    }
  }

  function fgFor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return '#ffffff';
    var n = parseInt(m[1], 16);
    var lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.5 ? '#000000' : '#ffffff';
  }

  var scheduled = false;
  var observer = new MutationObserver(function () {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      apply();
    }, 50);
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-label', 'class', 'data-resource-name'],
  });

  apply();
  poll();
})();
