/* NRF27 Dot Grid — CEP panel (Illustrator + InDesign). Geometry in JS via engine.js; host.jsx reads + draws. */
(function () {
  'use strict';
  var E = window.DotGrid, $ = function (id) { return document.getElementById(id); };
  var CEP = window.__adobe_cep__ || null;
  var LS_PRESETS = 'nrf27-dotgrid.presets', LS_LAST = 'nrf27-dotgrid.last';

  // ---------------------------------------------------------------- presets
  var BUILTIN = {
    'NRF27 default':    {},
    'Thank-you card':   { mode: 'page', minDot: 0.31, clearance: 4.5, softness: 3 },
    'Postcard':         { mode: 'page', minDot: 0.37, clearance: 4,   softness: 3 },
    'Welcome sign':     { mode: 'page', minDot: 0.3,  clearance: null, knock: 'shape', softness: 3 },
    'Name card (uniform)': { mode: 'page', autoDetect: false, minDot: 1 },
    'Corner fade':      { mode: 'corner', anchor: 'bl', reach: 0.6 },
    'Edge fade':        { mode: 'edge', anchor: 'b', reach: 0.45 }
  };
  var PANEL_DEFAULTS = { autoDetect: true };
  function defaults() { var o = {}, k; for (k in E.DEFAULTS) o[k] = E.DEFAULTS[k]; for (k in PANEL_DEFAULTS) o[k] = PANEL_DEFAULTS[k]; return o; }
  function userPresets() { try { return JSON.parse(localStorage.getItem(LS_PRESETS)) || {}; } catch (e) { return {}; } }
  function saveUserPresets(p) { localStorage.setItem(LS_PRESETS, JSON.stringify(p)); }

  // ---------------------------------------------------------------- state
  var st = {
    s: defaults(), info: null, page: null, scan: null, img: null, result: null,
    keep: {}, ignore: {},           // per page key: manual boxes [[l,t,r,b]], ignored obstacle keys {key:true}
    where: '', busy: false, hostReady: false
  };
  function pageKey() { return st.info ? st.info.doc + '#' + st.page : ''; }
  function keepList() { return st.keep[pageKey()] || (st.keep[pageKey()] = []); }
  function ignoreSet() { return st.ignore[pageKey()] || (st.ignore[pageKey()] = {}); }
  function obsKey(o) { return o.rect.map(function (v) { return Math.round(v); }).join(','); }

  // ---------------------------------------------------------------- host bridge
  function evalHost(script) {
    return new Promise(function (resolve, reject) {
      if (!CEP) return reject(new Error('Not running inside Illustrator or InDesign'));
      CEP.evalScript(script, function (res) {
        if (res === 'EvalScript error.' || res === undefined) return reject(new Error('Host script error'));
        var o; try { o = JSON.parse(res); } catch (e) { return reject(new Error(String(res).slice(0, 200))); }
        if (!o.ok) return reject(new Error(o.error)); resolve(o.data);
      });
    });
  }
  function extPath() { var p = decodeURI(CEP.getSystemPath('extension')); return p.replace(/^file:\/{2,3}/, '/').replace(/^\/([A-Za-z]:)/, '$1'); }
  function ensureHost() {
    if (st.hostReady) return Promise.resolve();
    var f = extPath() + '/host/host.jsx';
    return new Promise(function (res) {
      CEP.evalScript('typeof DG', function (t) {
        if (t === 'object') { st.hostReady = true; return res(); }
        CEP.evalScript('$.evalFile(' + JSON.stringify(f) + ')', function () { st.hostReady = true; res(); });
      });
    });
  }
  function call(fn, args) {
    var a = (args || []).map(function (x) { return JSON.stringify(x); }).join(',');
    return ensureHost().then(function () { return evalHost('DG.' + fn + '(' + a + ')'); });
  }

  // ---------------------------------------------------------------- theme
  function applyTheme() {
    if (!CEP) return;
    try { var env = JSON.parse(CEP.getHostEnvironment()), c = env.appSkinInfo.panelBackgroundColor.color;
      var lum = (c.red * 0.299 + c.green * 0.587 + c.blue * 0.114);
      document.body.classList.toggle('light', lum > 140);
      document.documentElement.style.setProperty('--bg', 'rgb(' + [c.red, c.green, c.blue].map(Math.round).join(',') + ')');
    } catch (e) {}
  }

  // ---------------------------------------------------------------- status
  var stT;
  function status(msg, kind) { var el = $('status'); el.textContent = msg || ''; el.className = 'status' + (kind ? ' ' + kind : '');
    clearTimeout(stT); if (kind === 'ok') stT = setTimeout(function () { el.textContent = ''; el.className = 'status'; }, 4000); }
  function busy(on, label) { st.busy = on; $('pvBusy').hidden = !on; if (label) $('pvBusy').textContent = label; $('apply').disabled = on || !st.result; $('remove').disabled = on; }

  // ---------------------------------------------------------------- load document/page
  function loadInfo() {
    return call('info').then(function (info) {
      st.info = info.doc ? info : null;
      $('empty').hidden = !!st.info; $('main').hidden = !st.info; document.querySelector('.bottom').hidden = !st.info;
      $('appBadge').textContent = info.app === 'indesign' ? 'Id' : 'Ai'; $('appBadge').className = 'badge' + (info.app === 'indesign' ? ' id' : '');
      if (!st.info) { $('docName').textContent = 'No document'; st.where = ''; return false; }
      $('docName').textContent = info.doc; $('docName').title = info.path || info.doc;
      var sel = $('pageSel'); sel.innerHTML = '';
      info.pages.forEach(function (p) { var o = document.createElement('option'); o.value = p.i;
        o.textContent = (p.i + 1) + '. ' + p.name + '  ·  ' + fmtSize(p.W, p.H); sel.appendChild(o); });
      st.page = info.active; sel.value = String(st.page);
      var ls = $('layerSel'); ls.innerHTML = '<option value="auto">Auto (by treatment)</option>';
      info.layers.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; ls.appendChild(o); });
      st.where = info.doc + '|' + info.active;
      return true;
    });
  }
  function fmtSize(W, H) { return (W / 72).toFixed(2).replace(/\.?0+$/, '') + '×' + (H / 72).toFixed(2).replace(/\.?0+$/, '') + ' in'; }

  function loadPage() {
    if (!st.info) return Promise.resolve();
    busy(true, 'Reading page…'); status('');
    return call('scan', [st.page, { shape: true }]).then(function (scan) {
      st.scan = scan;
      scan.obstacles.forEach(function (o) { if (!o.manual && o.pts && o.pts.length > 2) o.hull = E.hull(o.pts); delete o.pts; });
      if (scan.existing) {                                     // restore what was used last time on this page
        var ex = scan.existing; if (ex.keep) st.keep[pageKey()] = ex.keep; if (ex.ignore) { var m = {}; ex.ignore.forEach(function (k) { m[k] = true; }); st.ignore[pageKey()] = m; }
        setSettings(ex, true); notice('This page already has a dot grid. Settings restored from it; Apply replaces it.');
      } else notice('');
      if (scan.uvOther) notice(($('notice').textContent ? $('notice').textContent + ' ' : '') + 'The spot UV layer already has ' + scan.uvOther + ' other item' + (scan.uvOther > 1 ? 's' : '') + ' on this page. They are kept; delete them first if this grid replaces them.');
      return call('thumb', [st.page, 900]);
    }).then(function (path) {
      return new Promise(function (res) { var im = new Image(); im.onload = function () { st.img = im; res(); }; im.onerror = function () { st.img = null; res(); };
        im.src = 'file://' + encodeURI(path).replace(/#/g, '%23') + '?' + Date.now(); });
    }).then(function () { busy(false); recompute(); })
      .catch(function (e) { busy(false); status(e.message, 'err'); });
  }
  function refreshAll() { return loadInfo().then(function (has) { if (has) return loadPage(); }).catch(function (e) { status(e.message, 'err'); }); }
  function notice(t) { $('notice').hidden = !t; $('notice').textContent = t || ''; }

  // ---------------------------------------------------------------- compute + preview
  function obstaclesFor() {
    var out = [], ig = ignoreSet();
    if (st.s.autoDetect && st.scan) st.scan.obstacles.forEach(function (o) { if (!o.manual && !ig[obsKey(o)]) out.push({ rect: o.rect, hull: o.hull }); });
    if (st.scan) st.scan.obstacles.forEach(function (o) { if (o.manual) out.push({ rect: o.rect, manual: true }); });
    keepList().forEach(function (r) { out.push({ rect: r, manual: true }); });
    return out;
  }
  var rq;
  function recompute() { cancelAnimationFrame(rq); rq = requestAnimationFrame(function () {
    if (!st.scan) return;
    var s = engineSettings(), t0 = performance.now();
    st.result = E.compute(st.scan.page, obstaclesFor(), s);
    st.result.ms = performance.now() - t0;
    draw(); readout(); $('apply').disabled = st.busy || !st.result.dots.length;
    saveLast();
  }); }
  function engineSettings() { var o = {}, k; for (k in E.DEFAULTS) o[k] = st.s[k]; return o; }

  var view = { k: 1, ox: 0, oy: 0 };
  function draw() {
    var cv = $('pv'), wrap = cv.parentNode, P = st.scan.page, dpr = window.devicePixelRatio || 1;
    var maxW = wrap.clientWidth - 16, maxH = Math.min(420, window.innerHeight * 0.45), k = Math.min(maxW / P.W, maxH / P.H);
    var w = Math.round(P.W * k), h = Math.round(P.H * k);
    cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = w * dpr; cv.height = h * dpr;
    view.k = k; var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    if (st.img) c.drawImage(st.img, 0, 0, w, h);
    c.save(); c.scale(k, k);
    var T = E.TREATMENTS[st.s.treatment], light = st.s.treatment === 'color';
    c.fillStyle = T.display; c.globalAlpha = light ? 1 : 0.9;
    c.beginPath(); st.result.dots.forEach(function (d) { c.moveTo(d[0] + d[2], d[1]); c.arc(d[0], d[1], d[2], 0, Math.PI * 2); }); c.fill();
    if (light) { c.globalAlpha = 0.45; c.lineWidth = 0.6 / k; c.strokeStyle = '#6b665c'; c.stroke(); }
    c.globalAlpha = 1;
    // overlays
    var ig = ignoreSet(); c.lineWidth = 1 / k;
    if (st.s.autoDetect) st.scan.obstacles.forEach(function (o) { if (o.manual) return; var off = ig[obsKey(o)];
      c.setLineDash(off ? [2 / k, 3 / k] : [3 / k, 2 / k]); c.strokeStyle = off ? 'rgba(150,150,150,.9)' : 'rgba(0,170,255,.85)';
      rect(c, o.rect); if (off) { c.beginPath(); c.moveTo(o.rect[0], o.rect[1]); c.lineTo(o.rect[2], o.rect[3]); c.stroke(); }
      if (st.s.knock === 'shape' && o.hull && !off) { c.setLineDash([]); c.strokeStyle = 'rgba(0,170,255,.45)'; c.beginPath(); o.hull.forEach(function (p, i) { i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.closePath(); c.stroke(); } });
    c.setLineDash([4 / k, 2 / k]); c.strokeStyle = '#ff00c8'; c.fillStyle = 'rgba(255,0,200,.10)';
    st.scan.obstacles.forEach(function (o) { if (o.manual) { rect(c, o.rect, true); } });
    keepList().forEach(function (r) { rect(c, r, true); });
    if (drag && drag.moved) { c.setLineDash([2 / k, 2 / k]); rect(c, normRect(drag), true); }
    c.setLineDash([]);
    // trim margin guide
    if (st.s.margin > 0) { c.strokeStyle = 'rgba(255,80,80,.35)'; c.setLineDash([1 / k, 3 / k]); c.strokeRect(st.s.margin, st.s.margin, P.W - 2 * st.s.margin, P.H - 2 * st.s.margin); c.setLineDash([]); }
    c.restore();
  }
  function rect(c, r, fill) { if (fill) c.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); c.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); }

  function readout() {
    var r = st.result, g = r.gaps, f = function (v) { return v === null ? '—' : v.toFixed(1); };
    var line1 = r.dots.length + ' dots  ·  ' + r.cols + '×' + r.rows + ' grid  ·  ' + r.minD.toFixed(2) + '–' + r.maxD.toFixed(2) + ' pt';
    var line2 = 'Pitch ' + r.px.toFixed(1) + '×' + r.py.toFixed(1) + ' pt' + (Math.abs(r.pitchAdjust - 1) > 0.001 ? ' (balanced ' + (r.pitchAdjust > 1 ? '+' : '') + ((r.pitchAdjust - 1) * 100).toFixed(1) + '%)' : '') + '  ·  clearance ' + r.clear.toFixed(1) + ' pt';
    var line3 = g && st.s.mode === 'page' ? 'Gap round main content  L ' + f(g.l) + '  R ' + f(g.r) + '  T ' + f(g.t) + '  B ' + f(g.b) + ' pt' : '';
    $('readout').innerHTML = esc(line1) + '<span class="sub">' + esc(line2) + '</span>' + (line3 ? '<span class="sub">' + esc(line3) + '</span>' : '');
    var w = [];
    if (r.minD < 0.5) w.push('Smallest dot is ' + r.minD.toFixed(2) + ' pt; dots under ~0.5 pt may not hold on press. Raise Smallest dot or Dot size.');
    if (r.clear < 2) w.push('Clearance under 2 pt: dots may touch content after trim/registration shift.');
    if (!r.dots.length) w.push('No dots fit. Reduce clearance, increase reach, or check keep-clear boxes.');
    if (st.scan.skippedBackgrounds) $('keepDesc').textContent = 'Detected ' + st.scan.obstacles.filter(function (o) { return !o.manual; }).length + ' content items; ignored ' + st.scan.skippedBackgrounds + ' full-page background' + (st.scan.skippedBackgrounds > 1 ? 's' : '') + '.';
    else $('keepDesc').textContent = 'Detected ' + st.scan.obstacles.filter(function (o) { return !o.manual; }).length + ' content items.';
    $('warn').hidden = !w.length; $('warn').textContent = w.join(' ');
    var u = Math.max(st.scan.page.W, st.scan.page.H) / 1440;
    $('gridDesc').textContent = 'Scales with the page (u = ' + u.toFixed(3) + ' pt). Base dot ' + (2 * r.R).toFixed(2) + ' pt.';
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ---------------------------------------------------------------- preview interaction
  var drag = null;
  function toPt(ev) { var b = $('pv').getBoundingClientRect(); return [(ev.clientX - b.left) / view.k, (ev.clientY - b.top) / view.k]; }
  function normRect(d) { return [Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.max(d.a[0], d.b[0]), Math.max(d.a[1], d.b[1])]; }
  function inR(p, r) { return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; }
  $('pv').addEventListener('mousedown', function (ev) { if (!st.scan) return; drag = { a: toPt(ev), b: toPt(ev), moved: false }; });
  window.addEventListener('mousemove', function (ev) { if (!drag) return; drag.b = toPt(ev);
    if (Math.abs(drag.b[0] - drag.a[0]) * view.k > 4 || Math.abs(drag.b[1] - drag.a[1]) * view.k > 4) drag.moved = true; if (drag.moved) draw(); });
  window.addEventListener('mouseup', function () { if (!drag) return; var d = drag; drag = null;
    if (d.moved) { var r = normRect(d), P = st.scan.page; r = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(P.W, r[2]), Math.min(P.H, r[3])];
      keepList().push(r.map(function (v) { return Math.round(v * 10) / 10; })); recompute(); return; }
    var p = d.a, L = keepList();
    for (var i = L.length - 1; i >= 0; i--) if (inR(p, L[i])) { L.splice(i, 1); recompute(); return; }
    if (!st.s.autoDetect) return;
    var hits = st.scan.obstacles.filter(function (o) { return !o.manual && inR(p, o.rect); })
      .sort(function (a, b) { return area(a.rect) - area(b.rect); });
    if (hits.length) { var ig = ignoreSet(), k = obsKey(hits[0]); if (ig[k]) delete ig[k]; else ig[k] = true; recompute(); }
  });
  function area(r) { return (r[2] - r[0]) * (r[3] - r[1]); }

  // ---------------------------------------------------------------- controls
  var SL = {
    reach:     { k: 'reach',     f: 100, out: function (v) { return Math.round(v * 100) + '%'; } },
    softness:  { k: 'softness',  f: 1,   out: function (v) { return v.toFixed(2).replace(/0$/, '') + ' cells'; } },
    minDot:    { k: 'minDot',    f: 100, out: function (v) { return Math.round(v * 100) + '%'; } },
    density:   { k: 'density',   f: 100, out: function (v) { return Math.round(v * 100) + '%'; } },
    size:      { k: 'size',      f: 100, out: function (v) { return Math.round(v * 100) + '%'; } },
    clearance: { k: 'clearance', f: 1,   out: function (v) { return v == null ? 'auto' : v.toFixed(1) + ' pt'; } },
    margin:    { k: 'margin',    f: 1,   out: function (v) { return v.toFixed(1) + ' pt'; } }
  };
  Object.keys(SL).forEach(function (id) { var d = SL[id];
    $(id).addEventListener('input', function () { st.s[d.k] = +this.value / d.f; if (id === 'clearance') $('clearAuto').checked = false; syncOutputs(); recompute(); });
  });
  function autoClear() { return st.scan ? 13 * Math.max(st.scan.page.W, st.scan.page.H) / 1440 : 4; }
  $('clearAuto').addEventListener('change', function () { st.s.clearance = this.checked ? null : +(+$('clearance').value).toFixed(1); syncUI(); recompute(); });
  $('balance').addEventListener('change', function () { st.s.balance = this.checked; recompute(); });
  $('autoDetect').addEventListener('change', function () { st.s.autoDetect = this.checked; syncUI(); recompute(); });
  seg('treatSeg', 'treatment'); seg('knockSeg', 'knock');
  function seg(id, key) { $(id).addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; st.s[key] = b.dataset.v; syncUI(); recompute(); }); }
  $('anchorGrid').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; var a = b.dataset.a;
    if (a === 'page') st.s.mode = 'page'; else { st.s.mode = a.length === 2 ? 'corner' : 'edge'; st.s.anchor = a;
      if (st.s.mode === 'edge' && st.s.reach > 1) st.s.reach = 0.6; }
    syncUI(); recompute(); });

  var NAMES = { tl: 'top-left corner', tr: 'top-right corner', bl: 'bottom-left corner', br: 'bottom-right corner', t: 'top edge', r: 'right edge', b: 'bottom edge', l: 'left edge' };
  function syncOutputs() { Object.keys(SL).forEach(function (id) { var d = SL[id]; $(id + 'Out').textContent = d.out(id === 'clearance' && st.s.clearance == null ? null : st.s[d.k]); }); }
  function syncUI() {
    var s = st.s, mode = s.mode;
    Object.keys(SL).forEach(function (id) { var d = SL[id], v = s[d.k]; if (id === 'clearance' && v == null) v = autoClear(); $(id).value = v * d.f; });
    $('clearAuto').checked = s.clearance == null; $('balance').checked = !!s.balance; $('autoDetect').checked = !!s.autoDetect;
    document.querySelectorAll('[data-show]').forEach(function (el) { el.hidden = el.dataset.show.split(' ').indexOf(mode) < 0; });
    document.querySelectorAll('#anchorGrid button').forEach(function (b) { var a = b.dataset.a; b.classList.toggle('on', a === 'page' ? mode === 'page' : (mode !== 'page' && a === s.anchor)); });
    $('fadeTitle').textContent = mode === 'page' ? 'Full page' : 'From the ' + NAMES[s.anchor];
    $('fadeSub').textContent = mode === 'page' ? 'Dots cover the page and shrink around the content.' : 'Dots shrink away from the ' + (mode === 'corner' ? 'corner' : 'edge') + ' and stop at the reach. Content is still kept clear.';
    document.querySelectorAll('#treatSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === s.treatment); });
    document.querySelectorAll('#knockSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === s.knock); });
    var T = E.TREATMENTS[s.treatment];
    $('treatDesc').textContent = s.treatment === 'spot' ? '100% "' + T.swatch + '" spot swatch, overprint, drawn on the document\'s spot UV layer (created if missing). Fades by size only.'
      : 'One "' + T.swatch + '" spot swatch (CMYK ' + T.cmyk.join('/') + ' fallback) on a "' + T.layer + '" layer above the background. Fades by size only.';
    $('knockSeg').style.opacity = s.autoDetect ? 1 : .5;
    syncOutputs();
  }
  function setSettings(o, keepPanelExtras) { var b = defaults(), k; for (k in o) if (k in b) b[k] = o[k]; st.s = b; syncUI(); }

  // presets
  function fillPresets(sel) {
    var ps = $('presetSel'), up = userPresets(); ps.innerHTML = '<option value="">Choose a preset…</option>';
    var g1 = document.createElement('optgroup'); g1.label = 'NRF27 kit'; Object.keys(BUILTIN).forEach(function (n) { g1.appendChild(opt('b:' + n, n)); }); ps.appendChild(g1);
    if (Object.keys(up).length) { var g2 = document.createElement('optgroup'); g2.label = 'Saved'; Object.keys(up).sort().forEach(function (n) { g2.appendChild(opt('u:' + n, n)); }); ps.appendChild(g2); }
    if (sel) ps.value = sel;
  }
  function opt(v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; return o; }
  $('presetSel').addEventListener('change', function () { var v = this.value; if (!v) return;
    var p = v.charAt(0) === 'b' ? BUILTIN[v.slice(2)] : userPresets()[v.slice(2)]; if (!p) return;
    var o = defaults(), k; for (k in p) o[k] = p[k]; o.treatment = st.s.treatment; if (v.charAt(0) === 'u' && p.treatment) o.treatment = p.treatment;
    setSettings(o); recompute(); status('Preset "' + v.slice(2) + '" loaded', 'ok'); });
  $('savePreset').addEventListener('click', function () { var n = $('presetName').value.trim(); if (!n) { status('Name the preset first', 'err'); return; }
    if (n.charAt(0) === '{') {                                  // preset code copied from the web playground
      try { var code = JSON.parse(n), list = code.presets || [code], upx = userPresets();
        list.forEach(function (p) { upx[p.name] = p.settings; }); saveUserPresets(upx); fillPresets(); $('presetName').value = '';
        status('Imported ' + list.length + ' preset' + (list.length > 1 ? 's' : ''), 'ok'); } catch (e) { status('That preset code is not valid', 'err'); }
      return; }
    var up = userPresets(); up[n] = JSON.parse(JSON.stringify(st.s)); saveUserPresets(up); fillPresets('u:' + n); $('presetName').value = ''; status('Saved preset "' + n + '"', 'ok'); });
  $('delPreset').addEventListener('click', function () { var v = $('presetSel').value; if (v.charAt(0) !== 'u') { status('Pick a saved preset to delete', 'err'); return; }
    var up = userPresets(); delete up[v.slice(2)]; saveUserPresets(up); fillPresets(); status('Deleted', 'ok'); });
  $('resetAll').addEventListener('click', function () { setSettings(defaults()); st.keep[pageKey()] = []; st.ignore[pageKey()] = {}; recompute(); status('Reset to NRF27 defaults', 'ok'); });
  function saveLast() { try { localStorage.setItem(LS_LAST, JSON.stringify(st.s)); } catch (e) {} }
  function loadLast() { try { var o = JSON.parse(localStorage.getItem(LS_LAST)); if (o) setSettings(o); else syncUI(); } catch (e) { syncUI(); } }

  // ---------------------------------------------------------------- actions
  $('pageSel').addEventListener('change', function () { st.page = +this.value; call('goTo', [st.page]).catch(function () {});
    st.where = st.info.doc + '|' + st.page; loadPage(); });
  $('rescan').addEventListener('click', function () { refreshAll(); });
  $('addSel').addEventListener('click', function () { call('selectionRects', [st.page]).then(function (rs) {
    rs.forEach(function (r) { keepList().push(r.map(function (v) { return Math.round(v * 10) / 10; })); }); recompute(); status('Added ' + rs.length + ' keep-clear box' + (rs.length > 1 ? 'es' : ''), 'ok');
  }).catch(function (e) { status(e.message, 'err'); }); });
  $('clearBoxes').addEventListener('click', function () { st.keep[pageKey()] = []; st.ignore[pageKey()] = {}; recompute(); });

  $('apply').addEventListener('click', function () {
    if (!st.result || !st.result.dots.length) return;
    var r = st.result, ig = Object.keys(ignoreSet());
    var settings = JSON.parse(JSON.stringify(st.s)); settings.keep = keepList(); settings.ignore = ig; settings.v = E.version;
    var payload = { idx: st.page, dots: r.dots.map(function (d) { return [+d[0].toFixed(3), +d[1].toFixed(3), +d[2].toFixed(4)]; }), treatment: r.treatment, layer: $('layerSel').value, settings: settings };
    busy(true, 'Drawing ' + r.dots.length + ' dots…');
    call('apply', [payload]).then(function (res) { busy(false); notice('');
      status('Drew ' + res.drawn + ' dots on "' + res.layer + '" in ' + res.swatch + '. Undo removes them; Apply again replaces them.', 'ok');
      return loadInfo().then(function () { $('pageSel').value = String(st.page); });
    }).catch(function (e) { busy(false); status(e.message, 'err'); });
  });
  $('remove').addEventListener('click', function () { busy(true, 'Removing…');
    call('remove', [st.page]).then(function (res) { busy(false); notice(''); status(res.removed ? 'Removed the dot grid from this page' : 'No dot grid on this page', res.removed ? 'ok' : ''); })
      .catch(function (e) { busy(false); status(e.message, 'err'); }); });

  // follow the host: document / page switches
  function poll() {
    if (!CEP || st.busy || drag) return;
    call('where').then(function (w) {
      if (w === st.where) return;
      var doc = w.split('|')[0], prevDoc = st.where.split('|')[0];
      if (!w) { st.where = ''; return refreshAll(); }
      if (doc !== prevDoc) return refreshAll();
      st.where = w; st.page = +w.split('|')[1]; $('pageSel').value = String(st.page); return loadPage();
    }).catch(function () {});
  }
  window.addEventListener('resize', function () { if (st.scan && st.result) draw(); });

  // ---------------------------------------------------------------- boot
  applyTheme();
  if (CEP && CEP.addEventListener) try { CEP.addEventListener('com.adobe.csxs.events.ThemeColorChanged', applyTheme); } catch (e) {}
  fillPresets(); loadLast();
  if (!CEP) { $('empty').hidden = false; $('main').hidden = true; $('empty').innerHTML = '<p><b>Open this panel from Illustrator or InDesign</b></p><p>Window › Extensions › NRF27 Dot Grid</p>'; return; }
  refreshAll().then(function () { setInterval(poll, 1500); });
})();
