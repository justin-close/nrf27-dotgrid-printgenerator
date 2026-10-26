/* NRF27 Dot Grid — Figma plugin main thread.
 * Same contract as extension/host/host.jsx (info / where / scan / thumb / apply / remove / selectionRects / goTo),
 * so the shared panel UI (extension/panel.js + engine.js) drives both. A "page" here = a top-level frame.
 * Coordinates sent to the UI: px (= pt at 1×), frame-relative, origin top-left, y down.
 */
var GROUP = 'NRF27 dot grid', UV_RE = /spot\s*uv|clear\s*(spot|uv)|varnish/i, KEEP_RE = /keep[\s_-]*clear/i;
var BG_FRAC = 0.85, WRAP_FRAC = 0.35, MAXPTS = 1500, STORE_KEYS = ['nrf27-dotgrid.presets', 'nrf27-dotgrid.last'];
var DOT_HEX = '#F6F5EF', STYLE = 'NRF27/Dot grid';                 // Figma: one fixed colour, no Spot UV / PMS choice
var STYLE_DESC = 'NRF27 dot grid colour (#F6F5EF). Used by the NRF27 Dot Grid plugin.';
var activeId = null;
function PAGE() { return (typeof __DG_PAGE__ !== 'undefined' && __DG_PAGE__) || figma.currentPage; }   // tests target a scratch page

var TEST = typeof __DG_TEST__ !== 'undefined';                     // test/figma/run.sh evaluates this file via the Labor bridge
if (!TEST) figma.showUI(__html__, { width: 320, height: 760, themeColors: true, title: 'NRF27 Dot Grid' });

// ------------------------------------------------------------------ frames ("pages")
function frames() {
  var out = [];
  (function walk(n) {
    for (var i = 0; i < n.children.length; i++) { var c = n.children[i];
      if (c.type === 'SECTION') walk(c);
      else if ((c.type === 'FRAME' || c.type === 'COMPONENT') && c.visible) out.push(c); }
  })(PAGE());
  out.sort(function (a, b) { var A = a.absoluteTransform, B = b.absoluteTransform; return (A[1][2] - B[1][2]) || (A[0][2] - B[0][2]); });
  return out;
}
function topFrameOf(n) {
  while (n && n.parent && n.parent.type !== 'PAGE' && n.parent.type !== 'SECTION') n = n.parent;
  return n && (n.type === 'FRAME' || n.type === 'COMPONENT') ? n : null;
}
function activeIndex(fs) {
  var sel = PAGE().selection, f = sel.length ? topFrameOf(sel[0]) : null;
  if (f) activeId = f.id;
  for (var i = 0; i < fs.length; i++) if (fs[i].id === activeId) return i;
  if (fs.length) { activeId = fs[0].id; return 0; }
  return -1;
}
function frameAt(idx) { var f = frames()[idx]; if (!f) throw new Error('That frame no longer exists. Rescan.'); return f; }
function docName() { return figma.root.name + ' · ' + PAGE().name; }

// ------------------------------------------------------------------ geometry helpers
function origin(f) { var t = f.absoluteTransform; return [t[0][2], t[1][2]]; }
function boundsOf(n, o) {
  var b = null; try { b = n.absoluteRenderBounds; } catch (e) {}
  if (!b) b = n.absoluteBoundingBox; if (!b) return null;
  return [b.x - o[0], b.y - o[1], b.x + b.width - o[0], b.y + b.height - o[1]];
}
function clip(r, W, H) { return [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(W, r[2]), Math.min(H, r[3])]; }
function area(r) { return Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]); }
function thin(p) { if (p.length <= MAXPTS) return p; var o = [], s = p.length / MAXPTS; for (var i = 0; i < p.length; i += s) o.push(p[Math.floor(i)]); return o; }
function visiblePaints(ps) { if (!ps || ps === figma.mixed) return ps === figma.mixed; for (var i = 0; i < ps.length; i++) if (ps[i].visible !== false && (ps[i].opacity === undefined || ps[i].opacity > 0)) return true; return false; }
function paints(n) { return ('fills' in n && visiblePaints(n.fills)) || ('strokes' in n && visiblePaints(n.strokes) && n.strokeWeight !== 0); }
// All coordinate pairs of a node's fill/stroke geometry (control points included → conservative hull)
function geomPts(n, o, pts) {
  var gs = [];
  try { if (n.fillGeometry) gs = gs.concat(n.fillGeometry); } catch (e) {}
  try { if (n.strokeGeometry) gs = gs.concat(n.strokeGeometry); } catch (e) {}
  if (!gs.length) { var b = boundsOf(n, o); if (b) pts.push([b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]); return; }
  var t = n.absoluteTransform;
  for (var g = 0; g < gs.length; g++) {
    var nums = gs[g].data.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    for (var k = 0; k + 1 < nums.length; k += 2) { var x = +nums[k], y = +nums[k + 1];
      pts.push([t[0][0] * x + t[0][1] * y + t[0][2] - o[0], t[1][0] * x + t[1][1] * y + t[1][2] - o[1]]); }
  }
}
function collectPts(n, o, pts) {
  if (!n.visible) return;
  if ('children' in n && n.type !== 'BOOLEAN_OPERATION') {
    if (paints(n)) { var b = boundsOf(n, o); if (b) pts.push([b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]); }
    if (n.clipsContent) { var cb = boundsOf(n, o); if (cb) { pts.push([cb[0], cb[1]], [cb[2], cb[1]], [cb[2], cb[3]], [cb[0], cb[3]]); return; } }
    for (var i = 0; i < n.children.length; i++) collectPts(n.children[i], o, pts);
  } else geomPts(n, o, pts);
}
// Text → one obstacle per visual line, from the glyph outlines (a 4-line headline shouldn't blank the whole frame)
function textLines(n, o) {
  var gs; try { gs = n.fillGeometry; } catch (e) { return null; }
  if (!gs || !gs.length) return null;
  var t = n.absoluteTransform, boxes = [];
  if (Math.abs(t[0][1]) > 1e-3 || Math.abs(t[1][0]) > 1e-3) return null;   // rotated/skewed text: keep as one shape
  for (var g = 0; g < gs.length; g++) {
    var subs = gs[g].data.split(/(?=M)/);
    for (var k = 0; k < subs.length; k++) {
      var nums = subs[k].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [], pts = [];
      for (var j = 0; j + 1 < nums.length; j += 2) { var x = +nums[j], y = +nums[j + 1];
        pts.push([t[0][0] * x + t[0][1] * y + t[0][2] - o[0], t[1][0] * x + t[1][1] * y + t[1][2] - o[1]]); }
      if (!pts.length) continue;
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      pts.forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); });
      boxes.push({ r: b, pts: pts });
    }
  }
  if (!boxes.length) return null;
  boxes.sort(function (a, b) { return a.r[1] - b.r[1]; });
  var lines = [];
  boxes.forEach(function (bx) {                                       // merge glyphs whose vertical ranges overlap into one line
    var L = null;
    for (var i = 0; i < lines.length; i++) { var lr = lines[i].r; if (bx.r[1] < lr[3] && bx.r[3] > lr[1]) { L = lines[i]; break; } }
    if (!L) { lines.push({ r: bx.r.slice(), pts: bx.pts.slice() }); return; }
    L.r = [Math.min(L.r[0], bx.r[0]), Math.min(L.r[1], bx.r[1]), Math.max(L.r[2], bx.r[2]), Math.max(L.r[3], bx.r[3])]; L.pts = L.pts.concat(bx.pts);
  });
  for (var a = 0; a < lines.length; a++) for (var b2 = lines.length - 1; b2 > a; b2--) {   // a merge can make two lines overlap: fold again
    var A = lines[a].r, B = lines[b2].r;
    if (B[1] < A[3] && B[3] > A[1]) { lines[a].r = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])]; lines[a].pts = lines[a].pts.concat(lines[b2].pts); lines.splice(b2, 1); }
  }
  return lines;
}
function readTag(n) { try { var s = n.getPluginData('dg'); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function ignored(n) { return /dg:ignore/.test(n.name) || n.getPluginData('ignore') === '1'; }

// ------------------------------------------------------------------ API (mirrors host.jsx)
var API = {
  info: function () {
    var fs = frames(), a = activeIndex(fs);
    return { app: 'figma', doc: docName(), path: '', pages: fs.map(function (f, i) { return { i: i, name: f.name, W: f.width, H: f.height }; }), active: a, layers: [] };
  },
  where: function () { var fs = frames(); if (!fs.length) return ''; return docName() + '|' + activeIndex(fs); },

  scan: function (idx, opts) {
    opts = opts || {};
    var f = frameAt(idx), o = origin(f), W = f.width, H = f.height, PA = W * H, obs = [], manual = [], existing = null, skipped = 0, uvOther = 0;
    function add(n, depth) {
      if (!n.visible) return;
      if (n.name === GROUP) { if (existing === null) existing = readTag(n); return; }
      if (ignored(n)) return;
      if (UV_RE.test(n.name)) { uvOther++; return; }
      var r = boundsOf(n, o); if (!r) return;
      if (KEEP_RE.test(n.name)) { manual.push({ rect: r, manual: true, name: 'Keep clear' }); return; }
      if ('opacity' in n && n.opacity === 0) return;
      var rc = clip(r, W, H); if (area(rc) <= 0) return;
      var frac = area(rc) / PA, isParent = 'children' in n && n.type !== 'BOOLEAN_OPERATION' && n.children.length;
      if (isParent && frac > WRAP_FRAC && depth < 8) {                  // big container: its own fill is a background, recurse
        if (paints(n) && frac >= BG_FRAC) skipped++;
        for (var i = 0; i < n.children.length; i++) add(n.children[i], depth + 1);
        return;
      }
      if (frac >= BG_FRAC) { skipped++; return; }
      if (!isParent && n.type !== 'TEXT' && !paints(n) && !('effects' in n && n.effects.length)) return;   // invisible shape
      if (n.type === 'TEXT') { var ls = textLines(n, o);
        if (ls && ls.length) { var label = n.characters.replace(/\s+/g, ' ').slice(0, 28);
          ls.forEach(function (L, li) { obs.push({ rect: L.r, pts: opts.shape ? thin(L.pts) : [], name: label + (ls.length > 1 ? ' \u00b7 ' + (li + 1) : ''), kind: 'TEXT', group: n.id }); });
          return; } }
      var pts = []; if (opts.shape) collectPts(n, o, pts);
      obs.push({ rect: r, pts: thin(pts), name: n.type === 'TEXT' ? n.characters.slice(0, 32) : n.name, kind: n.type });
    }
    for (var i = 0; i < f.children.length; i++) add(f.children[i], 0);
    if (paints(f)) skipped++;
    return { page: { W: W, H: H }, obstacles: obs.concat(manual), skippedBackgrounds: skipped, existing: existing, uvOther: uvOther };
  },

  thumb: function (idx, longPx) {
    var f = frameAt(idx), hide = f.findAll(function (n) { return n.visible && (n.name === GROUP || UV_RE.test(n.name) || KEEP_RE.test(n.name)); });
    hide.forEach(function (n) { n.visible = false; });
    var long = Math.max(f.width, f.height), c = f.width >= f.height ? { type: 'WIDTH', value: Math.round(longPx || 900) } : { type: 'HEIGHT', value: Math.round(longPx || 900) };
    if (long < 4) c = { type: 'SCALE', value: 1 };
    return f.exportAsync({ format: 'PNG', constraint: c }).then(function (bytes) {
      hide.forEach(function (n) { n.visible = true; }); return { __png: bytes };
    }, function (e) { hide.forEach(function (n) { n.visible = true; }); throw e; });
  },

  apply: function (p) {
    var f = frameAt(p.idx);
    removeIn(f);
    return ensureStyle().then(function (style) {
      var dots = p.dots; if (!dots.length) throw new Error('No dots to draw');
      var minX = Infinity, minY = Infinity, K = 0.5522847498, d = [];
      dots.forEach(function (q) { minX = Math.min(minX, q[0] - q[2]); minY = Math.min(minY, q[1] - q[2]); });
      dots.forEach(function (q) {                                  // one closed 4-arc circle per dot, coords relative to (minX, minY)
        var x = q[0] - minX, y = q[1] - minY, r = q[2], k = r * K;
        d.push('M ' + n4(x + r) + ' ' + n4(y) + ' C ' + n4(x + r) + ' ' + n4(y + k) + ' ' + n4(x + k) + ' ' + n4(y + r) + ' ' + n4(x) + ' ' + n4(y + r) +
          ' C ' + n4(x - k) + ' ' + n4(y + r) + ' ' + n4(x - r) + ' ' + n4(y + k) + ' ' + n4(x - r) + ' ' + n4(y) +
          ' C ' + n4(x - r) + ' ' + n4(y - k) + ' ' + n4(x - k) + ' ' + n4(y - r) + ' ' + n4(x) + ' ' + n4(y - r) +
          ' C ' + n4(x + k) + ' ' + n4(y - r) + ' ' + n4(x + r) + ' ' + n4(y - k) + ' ' + n4(x + r) + ' ' + n4(y) + ' Z');
      });
      var v = figma.createVector();
      f.insertChild(backgroundIndex(f), v);                          // just above the full-frame background(s)
      if (f.layoutMode && f.layoutMode !== 'NONE') v.layoutPositioning = 'ABSOLUTE';
      v.vectorPaths = [{ windingRule: 'NONZERO', data: d.join(' ') }];
      v.x = minX; v.y = minY;                                        // paths are origin-relative, so place explicitly
      v.name = GROUP; v.strokes = []; v.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
      v.setPluginData('dg', JSON.stringify(p.settings)); v.setPluginData('color', DOT_HEX);
      return v.setFillStyleIdAsync(style.id).then(function () {
        figma.commitUndo();
        return { drawn: dots.length, layer: f.name, swatch: style.name };
      });
    });
  },
  remove: function (idx) { var n = removeIn(frameAt(idx)); figma.commitUndo(); return { removed: n }; },

  selectionRects: function (idx) {
    var f = frameAt(idx), o = origin(f), sel = PAGE().selection.filter(function (n) { return n.id !== f.id; });
    if (!sel.length) throw new Error('Select something inside the frame first');
    return sel.map(function (n) { return boundsOf(n, o); }).filter(Boolean);
  },
  goTo: function (idx) { var f = frameAt(idx); activeId = f.id; PAGE().selection = [f]; figma.viewport.scrollAndZoomIntoView([f]); return idx; }
};

function n4(v) { return Math.round(v * 10000) / 10000; }
function removeIn(f) { var ns = f.findAll(function (n) { return n.name === GROUP; }); ns.forEach(function (n) { n.remove(); }); return ns.length; }
function backgroundIndex(f) {                                         // colour grid sits just above the full-frame background(s)
  var o = origin(f), PA = f.width * f.height, idx = 0;
  for (var i = 0; i < f.children.length; i++) { var r = boundsOf(f.children[i], o); if (r && area(clip(r, f.width, f.height)) / PA >= BG_FRAC && !('children' in f.children[i] && f.children[i].children.length)) idx = i + 1; }
  return idx;
}
function hexToRgb(h) { h = h.replace('#', ''); return { r: parseInt(h.substr(0, 2), 16) / 255, g: parseInt(h.substr(2, 2), 16) / 255, b: parseInt(h.substr(4, 2), 16) / 255 }; }
function ensureStyle() {
  var want = hexToRgb(DOT_HEX);
  return figma.getLocalPaintStylesAsync().then(function (styles) {
    var s = null;
    for (var i = 0; i < styles.length; i++) if (styles[i].name === STYLE) { s = styles[i]; break; }
    if (!s) { s = figma.createPaintStyle(); s.name = STYLE; }
    s.description = STYLE_DESC;
    var p = s.paints[0], c = p && p.type === 'SOLID' && p.color;     // keep the style locked to #F6F5EF
    if (!c || Math.abs(c.r - want.r) + Math.abs(c.g - want.g) + Math.abs(c.b - want.b) > 0.002 || (p.opacity != null && p.opacity !== 1)) s.paints = [{ type: 'SOLID', color: want }];
    return s;
  });
}

// ------------------------------------------------------------------ messaging
if (!TEST) figma.clientStorage.keysAsync().then(function () {
  return Promise.all(STORE_KEYS.map(function (k) { return figma.clientStorage.getAsync(k); }));
}).then(function (vals) {
  var data = {}; STORE_KEYS.forEach(function (k, i) { if (vals[i] != null) data[k] = vals[i]; });
  figma.ui.postMessage({ type: 'storage', data: data });
}, function () { figma.ui.postMessage({ type: 'storage', data: {} }); });

if (!TEST) figma.ui.onmessage = function (m) {
  if (!m) return;
  if (m.type === 'store') { figma.clientStorage.setAsync(m.key, m.value); return; }
  if (m.type === 'resize') { figma.ui.resize(m.w, m.h); return; }
  var fn = API[m.fn];
  if (!fn) return figma.ui.postMessage({ id: m.id, ok: false, error: 'Unknown call ' + m.fn });
  Promise.resolve().then(function () { return fn.apply(null, m.args || []); })
    .then(function (data) { figma.ui.postMessage({ id: m.id, ok: true, data: data }); },
          function (e) { figma.ui.postMessage({ id: m.id, ok: false, error: String(e && e.message || e) }); });
};
