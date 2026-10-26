/* NRF27 Dot Grid playground — same engine.js as the panel. */
(function () {
  'use strict';
  var E = window.DotGrid, $ = function (id) { return document.getElementById(id); }, COLL = 'nrf27_dotgrid_presets';
  $('ver').textContent = 'v' + E.version; $('ver2').textContent = 'v' + E.version;

  var SIZES = [
    ['Thank-you card · 7×5 in', 7, 5], ['Concierge postcard · 6×4 in', 6, 4], ['Name place card · 3×2 in', 3, 2],
    ['Food menu · 6×8 in', 6, 8], ['Drinks menu · 5×8 in', 5, 8], ['Letter · 8.5×11 in', 8.5, 11], ['Poster · 18×24 in', 18, 24], ['Custom', 0, 0]
  ];
  var BUILTIN = {
    'NRF27 default': {}, 'Thank-you card': { minDot: 0.31, clearance: 4.5 }, 'Postcard': { minDot: 0.37, clearance: 4 },
    'Corner fade': { mode: 'corner', anchor: 'bl', reach: 0.6 }, 'Edge fade': { mode: 'edge', anchor: 'b', reach: 0.45 }
  };
  function defaults() { var o = {}, k; for (k in E.DEFAULTS) o[k] = E.DEFAULTS[k]; return o; }
  var st = { s: defaults(), W: 504, H: 360, boxes: [], img: null, shared: [], res: null };

  // -------------------------------------------------- page size
  SIZES.forEach(function (z, i) { var o = document.createElement('option'); o.value = i; o.textContent = z[0]; $('sizeSel').appendChild(o); });
  function setSize(wIn, hIn, keepBoxes) {
    var oW = st.W, oH = st.H; st.W = wIn * 72; st.H = hIn * 72; $('wIn').value = wIn; $('hIn').value = hIn;
    if (keepBoxes) st.boxes = st.boxes.map(function (b) { return [b[0] / oW * st.W, b[1] / oH * st.H, b[2] / oW * st.W, b[3] / oH * st.H]; });
    render();
  }
  $('sizeSel').addEventListener('change', function () { var z = SIZES[+this.value]; if (z[1]) setSize(z[1], z[2], true); });
  ['wIn', 'hIn'].forEach(function (id) { $(id).addEventListener('change', function () { $('sizeSel').value = SIZES.length - 1; setSize(+$('wIn').value || 1, +$('hIn').value || 1, true); }); });
  $('refIn').addEventListener('change', function () { var f = this.files[0]; if (!f) return; var im = new Image(); im.onload = function () { st.img = im; render(); }; im.src = URL.createObjectURL(f); });
  $('clearRef').addEventListener('click', function () { st.img = null; render(); });
  $('sample').addEventListener('click', function () { var W = st.W, H = st.H, w = Math.min(W, H) * 0.5, h = w * 0.29;
    st.boxes = [[(W - w) / 2, (H - h) / 2, (W + w) / 2, (H + h) / 2]]; render(); });
  $('clearBoxes').addEventListener('click', function () { st.boxes = []; render(); });

  // -------------------------------------------------- render
  var cv = $('cv'), view = { k: 1 }, drag = null;
  function render() {
    var s = st.s; st.res = E.compute({ W: st.W, H: st.H }, st.boxes.map(function (b) { return { rect: b }; }), s);
    var wrap = cv.parentNode, maxW = wrap.clientWidth - 40, maxH = Math.max(320, Math.min(640, window.innerHeight * 0.62));
    var k = Math.min(maxW / st.W, maxH / st.H), w = Math.round(st.W * k), h = Math.round(st.H * k), dpr = window.devicePixelRatio || 1;
    cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = w * dpr; cv.height = h * dpr; view.k = k;
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = s.treatment === 'spot' ? '#0a0a0f' : '#1c3a33'; c.fillRect(0, 0, w, h);
    if (st.img) { var ir = Math.max(w / st.img.width, h / st.img.height); c.drawImage(st.img, (w - st.img.width * ir) / 2, (h - st.img.height * ir) / 2, st.img.width * ir, st.img.height * ir); }
    c.save(); c.scale(k, k);
    var T = E.TREATMENTS[s.treatment]; c.fillStyle = s.treatment === 'spot' ? 'rgba(230,0,126,.92)' : T.display;
    c.beginPath(); st.res.dots.forEach(function (d) { c.moveTo(d[0] + d[2], d[1]); c.arc(d[0], d[1], d[2], 0, 7); }); c.fill();
    c.lineWidth = 1 / k; c.setLineDash([4 / k, 3 / k]); c.strokeStyle = '#4fc3ff'; c.fillStyle = 'rgba(79,195,255,.12)';
    st.boxes.concat(drag && drag.moved ? [norm(drag)] : []).forEach(function (b) { c.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); c.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); });
    c.restore();
    var r = st.res, g = r.gaps, f = function (v) { return v == null ? '—' : v.toFixed(1); };
    $('readout').textContent = r.dots.length + ' dots · ' + r.cols + '×' + r.rows + ' · ' + r.minD.toFixed(2) + '–' + r.maxD.toFixed(2) + ' pt' +
      (g && s.mode === 'page' ? ' · gaps L' + f(g.l) + ' R' + f(g.r) + ' T' + f(g.t) + ' B' + f(g.b) : '');
  }
  function pt(ev) { var b = cv.getBoundingClientRect(); return [(ev.clientX - b.left) / view.k, (ev.clientY - b.top) / view.k]; }
  function norm(d) { return [Math.max(0, Math.min(d.a[0], d.b[0])), Math.max(0, Math.min(d.a[1], d.b[1])), Math.min(st.W, Math.max(d.a[0], d.b[0])), Math.min(st.H, Math.max(d.a[1], d.b[1]))]; }
  cv.addEventListener('mousedown', function (ev) { drag = { a: pt(ev), b: pt(ev), moved: false }; });
  window.addEventListener('mousemove', function (ev) { if (!drag) return; drag.b = pt(ev); if (Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]) * view.k > 4) drag.moved = true; if (drag.moved) render(); });
  window.addEventListener('mouseup', function () { if (!drag) return; var d = drag; drag = null;
    if (d.moved) st.boxes.push(norm(d));
    else for (var i = st.boxes.length - 1; i >= 0; i--) { var b = st.boxes[i]; if (d.a[0] >= b[0] && d.a[0] <= b[2] && d.a[1] >= b[1] && d.a[1] <= b[3]) { st.boxes.splice(i, 1); break; } }
    render(); });
  window.addEventListener('resize', render);

  // -------------------------------------------------- controls
  var SL = { reach: 100, softness: 1, minDot: 100, density: 100, size: 100, clearance: 1, margin: 1 };
  var FMT = { reach: pct, minDot: pct, density: pct, size: pct, softness: function (v) { return v + ' cells'; }, clearance: function (v) { return v == null ? 'auto' : v + ' pt'; }, margin: function (v) { return v + ' pt'; } };
  function pct(v) { return Math.round(v * 100) + '%'; }
  Object.keys(SL).forEach(function (id) { $(id).addEventListener('input', function () { st.s[id] = +this.value / SL[id]; sync(); render(); }); });
  $('clearAuto').addEventListener('change', function () { st.s.clearance = this.checked ? null : +$('clearance').value; sync(); render(); });
  $('balance').addEventListener('change', function () { st.s.balance = this.checked; render(); });
  $('treatSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (b) { st.s.treatment = b.dataset.v; sync(); render(); } });
  $('anchorGrid').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; var a = b.dataset.a;
    if (a === 'page') st.s.mode = 'page'; else { st.s.mode = a.length === 2 ? 'corner' : 'edge'; st.s.anchor = a; } sync(); render(); });
  var NAMES = { tl: 'top-left corner', tr: 'top-right corner', bl: 'bottom-left corner', br: 'bottom-right corner', t: 'top edge', r: 'right edge', b: 'bottom edge', l: 'left edge' };
  function sync() { var s = st.s;
    Object.keys(SL).forEach(function (id) { var v = s[id]; if (id === 'clearance' && v == null) v = 13 * Math.max(st.W, st.H) / 1440; $(id).value = v * SL[id];
      $(id).nextElementSibling.textContent = FMT[id](id === 'clearance' ? (s.clearance == null ? null : +s.clearance.toFixed(1)) : s[id]); });
    $('clearAuto').checked = s.clearance == null; $('balance').checked = !!s.balance;
    document.querySelectorAll('[data-show]').forEach(function (el) { el.hidden = el.dataset.show.split(' ').indexOf(s.mode) < 0; });
    document.querySelectorAll('#anchorGrid button').forEach(function (b) { b.classList.toggle('on', b.dataset.a === 'page' ? s.mode === 'page' : s.mode !== 'page' && b.dataset.a === s.anchor); });
    document.querySelectorAll('#treatSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === s.treatment); });
    $('fadeTitle').textContent = s.mode === 'page' ? 'Full page' : 'From the ' + NAMES[s.anchor];
    $('fadeSub').textContent = s.mode === 'page' ? 'Shrinks around the content' : 'Fades out by the reach';
  }
  function setS(o) { var b = defaults(), k; for (k in o) if (k in b) b[k] = o[k]; st.s = b; sync(); render(); }

  // -------------------------------------------------- SVG export (dots only, page-sized, points)
  $('svgOut').addEventListener('click', function () {
    var T = st.res.treatment, out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + st.W + 'pt" height="' + st.H + 'pt" viewBox="0 0 ' + st.W + ' ' + st.H + '">',
      '<g id="NRF27-dot-grid" fill="' + (st.s.treatment === 'spot' ? '#e6007e' : T.display) + '" data-swatch="' + T.swatch + '">'];
    st.res.dots.forEach(function (d) { out.push('<circle cx="' + d[0].toFixed(3) + '" cy="' + d[1].toFixed(3) + '" r="' + d[2].toFixed(4) + '"/>'); });
    out.push('</g></svg>');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.join('\n')], { type: 'image/svg+xml' }));
    a.download = 'nrf27-dotgrid-' + (st.W / 72) + 'x' + (st.H / 72) + 'in.svg'; a.click();
  });

  // -------------------------------------------------- shared presets (quick.db)
  function waitQuick() { return new Promise(function (res) { var t0 = Date.now(); (function p() { if (window.quick && window.quick.db) return res(true); if (Date.now() - t0 > 3000) return res(false); setTimeout(p, 120); })(); }); }
  var coll = null;
  function msg(t) { $('presetMsg').textContent = t || ''; }
  function loadShared() { return waitQuick().then(function (ok) { if (!ok) { msg('Team-shared presets live on the internal Quick site. Here you can still copy settings for the panel.'); ['savePreset','copyAll','delPreset'].forEach(function (id) { $(id).disabled = true; }); return; }
    coll = window.quick.db.collection(COLL); return coll.getAll().then(function (docs) { st.shared = docs.sort(function (a, b) { return a.name.localeCompare(b.name); }); fill(); }); })
    .catch(function (e) { msg('Could not load shared presets: ' + e.message); }); }
  function fill(sel) { var ps = $('presetSel'); ps.innerHTML = '<option value="">Load a preset…</option>';
    var g1 = document.createElement('optgroup'); g1.label = 'NRF27 kit'; Object.keys(BUILTIN).forEach(function (n) { g1.appendChild(opt('b:' + n, n)); }); ps.appendChild(g1);
    if (st.shared.length) { var g2 = document.createElement('optgroup'); g2.label = 'Shared'; st.shared.forEach(function (d) { g2.appendChild(opt('s:' + d.id, d.name + (d.by ? ' · ' + d.by : ''))); }); ps.appendChild(g2); }
    if (sel) ps.value = sel; }
  function opt(v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; return o; }
  function current() { var v = $('presetSel').value; if (v.charAt(0) === 's') return st.shared.filter(function (d) { return 's:' + d.id === v; })[0]; if (v.charAt(0) === 'b') return { name: v.slice(2), settings: BUILTIN[v.slice(2)] }; return null; }
  $('presetSel').addEventListener('change', function () { var p = current(); if (p) { var o = {}, k; for (k in p.settings) o[k] = p.settings[k]; if (!('treatment' in o)) o.treatment = st.s.treatment; setS(o); } });
  $('savePreset').addEventListener('click', function () { var n = $('presetName').value.trim(); if (!n) return msg('Name the preset first.'); if (!coll) return msg('Shared presets are unavailable here.');
    var by = (window.quick.id && window.quick.id.fullName) || ''; var doc = { name: n, by: by, ts: Date.now(), settings: JSON.parse(JSON.stringify(st.s)) };
    var same = st.shared.filter(function (d) { return d.name === n; })[0];
    (same ? coll.update(same.id, doc).then(function () { return { id: same.id }; }) : coll.create(doc)).then(function (c) { $('presetName').value = ''; msg('Shared "' + n + '" with the team.'); return loadShared().then(function () { fill('s:' + c.id); }); })
      .catch(function (e) { msg('Share failed: ' + e.message); }); });
  $('delPreset').addEventListener('click', function () { var p = current(); if (!p || !p.id) return msg('Pick a shared preset to delete.');
    if (!confirm('Delete the shared preset "' + p.name + '" for everyone?')) return;
    coll.delete(p.id).then(function () { msg('Deleted.'); return loadShared(); }); });
  function copy(t, what) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { msg('Copied ' + what + '. Paste it into the panel: Advanced › Preset name › Save.'); }, function () { window.prompt('Copy this code', t); }); }
  $('copyCode').addEventListener('click', function () { var p = current(), name = p ? p.name : ($('presetName').value.trim() || 'Playground'); copy(JSON.stringify({ name: name, settings: st.s }), '"' + name + '"'); });
  $('copyAll').addEventListener('click', function () { if (!st.shared.length) return msg('No shared presets yet.'); copy(JSON.stringify({ presets: st.shared.map(function (d) { return { name: d.name, settings: d.settings }; }) }), st.shared.length + ' shared presets'); });

  document.querySelectorAll('.copy').forEach(function (b) { b.addEventListener('click', function () { var t = $(b.dataset.copy).textContent; navigator.clipboard.writeText(t).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); }); }); });

  // -------------------------------------------------- boot
  $('sizeSel').value = 0; setSize(7, 5); $('sample').click(); sync(); fill(); loadShared();
})();
