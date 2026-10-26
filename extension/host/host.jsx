/* NRF27 Dot Grid — host side (ExtendScript, ES3). One file for Illustrator + InDesign.
 * The panel does all geometry in JS (engine.js); this file only reads the page and draws.
 * All coordinates exchanged with the panel are points, page-relative, origin top-left, y down.
 */
var DG = (function () {
  var GROUP = 'NRF27 dot grid', KEEP = 'Dot grid \u00b7 keep clear', TAG = 'dg:', IGNORE = 'dg:ignore';
  var UV_RE = /spot\s*uv|clear\s*(spot|uv)|varnish/i, BG_FRAC = 0.85, WRAP_FRAC = 0.35, MAXPTS = 1500;
  var isAI = BridgeTalk.appName === 'illustrator';

  // ---------- tiny JSON (ExtendScript has none) ----------
  function json(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(Math.round(v * 1000) / 1000) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
    if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(json(v[i])); return '[' + a.join(',') + ']'; }
    var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(json(k) + ':' + json(v[k])); return '{' + o.join(',') + '}';
  }
  function ok(data) { return json({ ok: true, data: data }); }
  function fail(e) { return json({ ok: false, error: String(e && e.message ? e.message : e) + (e && e.line ? ' (line ' + e.line + ')' : '') }); }
  function wrap(fn) { return function () { try { return ok(fn.apply(null, arguments)); } catch (e) { return fail(e); } }; }

  function tmpFolder() { var f = new Folder(Folder.userData + '/nrf27-dotgrid'); if (!f.exists) f.create(); return f; }
  function cleanThumbs(f) { var old = f.getFiles('thumb-*.png'); for (var i = 0; i < old.length; i++) try { old[i].remove(); } catch (e) {} }
  function readTag(s) { if (!s || s.indexOf(TAG) !== 0 || s === IGNORE) return null; try { return eval('(' + s.substr(TAG.length) + ')'); } catch (e) { return null; } }
  function hasIgnore(s) { return !!s && s.indexOf(IGNORE) >= 0; }
  function isSkipLayer(name) { return UV_RE.test(name) || name === KEEP || name === 'Dot grid'; }
  function union(a, b) { return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b; }
  function area(r) { return Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]); }
  function clip(r, W, H) { return [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(W, r[2]), Math.min(H, r[3])]; }
  function thin(pts) { if (pts.length <= MAXPTS) return pts; var o = [], st = pts.length / MAXPTS; for (var i = 0; i < pts.length; i += st) o.push(pts[Math.floor(i)]); return o; }

  // =====================================================================================
  // ILLUSTRATOR
  // =====================================================================================
  var AI = {
    doc: function () { if (!app.documents.length) throw new Error('No document open'); return app.activeDocument; },
    pages: function (d) { var o = []; for (var i = 0; i < d.artboards.length; i++) { var r = d.artboards[i].artboardRect; o.push({ i: i, name: d.artboards[i].name, W: r[2] - r[0], H: r[1] - r[3] }); } return o; },
    active: function (d) { return d.artboards.getActiveArtboardIndex(); },
    rect: function (d, i) { return d.artboards[i].artboardRect; },
    // AI bounds [l, t, r, b] y-up → page [l, t, r, b] y-down
    toPage: function (ab, b) { return [b[0] - ab[0], ab[1] - b[1], b[2] - ab[0], ab[1] - b[3]]; },
    allLayers: function (d) { var o = []; function walk(L) { for (var i = 0; i < L.length; i++) { o.push(L[i]); walk(L[i].layers); } } walk(d.layers); return o; },
    layerVisible: function (L) { while (L && L.typename === 'Layer') { if (!L.visible) return false; L = L.parent; } return true; },
    pathPts: function (p, pts, ab) {
      var pp = p.pathPoints;
      for (var i = 0; i < pp.length; i++) { var q = [pp[i].anchor, pp[i].leftDirection, pp[i].rightDirection];
        for (var k = 0; k < 3; k++) pts.push([q[k][0] - ab[0], ab[1] - q[k][1]]); }
    },
    collectPts: function (it, pts, ab) {
      if (it.typename === 'PathItem') AI.pathPts(it, pts, ab);
      else if (it.typename === 'CompoundPathItem') for (var i = 0; i < it.pathItems.length; i++) AI.pathPts(it.pathItems[i], pts, ab);
      else if (it.typename === 'GroupItem') for (var j = 0; j < it.pageItems.length; j++) AI.collectPts(it.pageItems[j], pts, ab);
      else { var b = AI.toPage(ab, it.visibleBounds); pts.push([b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]); }
    },
    clipBounds: function (g) { for (var i = 0; i < g.pageItems.length; i++) { var c = g.pageItems[i];
      if ((c.typename === 'PathItem' && c.clipping) || (c.typename === 'CompoundPathItem' && c.pathItems.length && c.pathItems[0].clipping)) return c.geometricBounds; } return g.visibleBounds; },
    invisible: function (it) { return it.typename === 'PathItem' && !it.filled && !it.stroked && !it.clipping; },
    scan: function (idx, opts) {
      var d = AI.doc(), ab = AI.rect(d, idx), W = ab[2] - ab[0], H = ab[1] - ab[3], PA = W * H, obs = [], manual = [], existing = null, skipped = 0, tmp = null, uvOther = 0;
      var layers = AI.allLayers(d);
      function getTmp() { if (!tmp) { tmp = d.layers.add(); tmp.name = '__dg_tmp'; } return tmp; }
      function add(it, depth) {
        if (it.hidden || it.guides || hasIgnore(it.note) || it.name === GROUP) { if (it.name === GROUP && existing === null) existing = readTag(it.note); return; }
        if (AI.invisible(it)) return;
        var vb = (it.typename === 'GroupItem' && it.clipped) ? AI.clipBounds(it) : it.visibleBounds, r = AI.toPage(ab, vb), rc = clip(r, W, H);
        if (area(rc) <= 0) return;
        var frac = area(rc) / PA;
        if (it.typename === 'GroupItem' && !it.clipped && frac > WRAP_FRAC && depth < 6) { for (var i = 0; i < it.pageItems.length; i++) add(it.pageItems[i], depth + 1); return; }
        if (frac >= BG_FRAC) { skipped++; return; }
        var pts = [], name = it.name || it.typename;
        if (it.typename === 'TextFrame') {
          try { var dup = it.duplicate(getTmp(), ElementPlacement.PLACEATEND), ol = dup.createOutline();
            r = AI.toPage(ab, ol.visibleBounds); if (opts.shape) AI.collectPts(ol, pts, ab); ol.remove();
            name = (it.contents || 'Text').substr(0, 32);
          } catch (e) { /* empty or locked frame → keep frame bounds */ }
        } else if (opts.shape) AI.collectPts(it, pts, ab);
        obs.push({ rect: r, pts: thin(pts), name: name, kind: it.typename });
      }
      try {
        for (var li = 0; li < layers.length; li++) { var L = layers[li];
          if (L.name === '__dg_tmp') continue;
          if (L.name === KEEP) { for (var m = 0; m < L.pathItems.length; m++) { var r2 = AI.toPage(ab, L.pathItems[m].geometricBounds); if (area(clip(r2, W, H)) > 0) manual.push({ rect: r2, manual: true, name: 'Keep clear' }); } continue; }
          for (var gi = 0; gi < L.groupItems.length; gi++) { var g = L.groupItems[gi]; if (g.name === GROUP && g.parent === L && area(clip(AI.toPage(ab, g.geometricBounds), W, H)) > 0 && existing === null) existing = readTag(g.note); }
          if (UV_RE.test(L.name)) { for (var ui = 0; ui < L.pageItems.length; ui++) { var up = L.pageItems[ui]; if (up.parent === L && up.name !== GROUP && area(clip(AI.toPage(ab, up.visibleBounds), W, H)) > 0) uvOther++; } }
          if (isSkipLayer(L.name) || !AI.layerVisible(L)) continue;
          for (var k = 0; k < L.pageItems.length; k++) if (L.pageItems[k].parent === L) add(L.pageItems[k], 0);
        }
      } finally { if (tmp) tmp.remove(); }
      return { page: { W: W, H: H }, obstacles: obs.concat(manual), skippedBackgrounds: skipped, existing: existing, uvOther: uvOther };
    },
    thumb: function (idx, longPx) {
      var d = AI.doc(), ab = AI.rect(d, idx), W = ab[2] - ab[0], H = ab[1] - ab[3], layers = AI.allLayers(d), vis = [], prev = AI.active(d);
      var f = tmpFolder(); cleanThumbs(f); var file = new File(f.fsName + '/thumb-' + (new Date().getTime()) + '.png');
      for (var i = 0; i < layers.length; i++) vis.push(layers[i].visible);
      try {
        for (i = 0; i < layers.length; i++) if (isSkipLayer(layers[i].name)) layers[i].visible = false;
        d.artboards.setActiveArtboardIndex(idx);
        var o = new ExportOptionsPNG24(), s = Math.min(800, longPx / Math.max(W, H) * 100);
        o.artBoardClipping = true; o.horizontalScale = s; o.verticalScale = s; o.transparency = false; o.antiAliasing = true;
        d.exportFile(file, ExportType.PNG24, o);
      } finally { for (i = 0; i < layers.length; i++) if (layers[i].visible !== vis[i]) layers[i].visible = vis[i]; d.artboards.setActiveArtboardIndex(prev); }
      return file.fsName;
    },
    spot: function (d, T) {
      var s; try { s = d.spots.getByName(T.swatch); } catch (e) {
        s = d.spots.add(); s.name = T.swatch; var c = new CMYKColor(); c.cyan = T.cmyk[0]; c.magenta = T.cmyk[1]; c.yellow = T.cmyk[2]; c.black = T.cmyk[3];
        s.color = c; s.colorType = ColorModel.SPOT; }
      return s;
    },
    targetLayer: function (d, T, want) {
      var all = AI.allLayers(d), i;
      if (want && want !== 'auto') for (i = 0; i < all.length; i++) if (all[i].name === want) return all[i];
      if (T.overprint) { for (i = 0; i < d.layers.length; i++) if (UV_RE.test(d.layers[i].name)) return d.layers[i];
        var L = d.layers.add(); L.name = T.layer; return L; }
      for (i = 0; i < d.layers.length; i++) if (d.layers[i].name === T.layer) return d.layers[i];
      var C = d.layers.add(); C.name = T.layer;
      if (d.layers.length > 1) { var ref = d.layers[d.layers.length - 1], lk = ref.locked; ref.locked = false;   // can't move next to a locked layer
        try { C.move(ref, ElementPlacement.PLACEBEFORE); } finally { ref.locked = lk; } }
      return C;
    },
    removeOn: function (d, idx) {
      var ab = AI.rect(d, idx), W = ab[2] - ab[0], H = ab[1] - ab[3], all = AI.allLayers(d), n = 0;
      for (var li = 0; li < all.length; li++) { var L = all[li], g = L.groupItems;
        for (var i = g.length - 1; i >= 0; i--) if (g[i].name === GROUP && g[i].parent === L && area(clip(AI.toPage(ab, g[i].geometricBounds), W, H)) > 0) {
          var lk = L.locked; L.locked = false; g[i].locked = false; g[i].remove(); L.locked = lk; n++; } }
      return n;
    },
    apply: function (p) {
      var d = AI.doc(), ab = AI.rect(d, p.idx), T = p.treatment;
      AI.removeOn(d, p.idx);
      var L = AI.targetLayer(d, T, p.layer), lk = L.locked, vis = L.visible; L.locked = false; L.visible = true;
      var sp = AI.spot(d, T), g = L.groupItems.add(); g.name = GROUP; g.note = TAG + json(p.settings);
      var sc = new SpotColor(); sc.spot = sp; sc.tint = 100;
      for (var k = 0; k < p.dots.length; k++) { var x = p.dots[k][0], y = p.dots[k][1], r = p.dots[k][2];
        var e = g.pathItems.ellipse(ab[1] - (y - r), ab[0] + x - r, 2 * r, 2 * r);
        e.stroked = false; e.filled = true; e.fillColor = sc; e.fillOverprint = !!T.overprint; }
      L.locked = lk; L.visible = vis;
      return { drawn: g.pathItems.length, layer: L.name, swatch: sp.name };
    },
    keepLayer: function (d) {
      for (var i = 0; i < d.layers.length; i++) if (d.layers[i].name === KEEP) return d.layers[i];
      var L = d.layers.add(); L.name = KEEP; L.printable = false; var c = new RGBColor(); c.red = 255; c.green = 0; c.blue = 200; L.color = c; return L;
    },
    keepStyle: function (r) { r.filled = false; r.stroked = true; r.strokeWidth = 1; r.strokeDashes = [4, 3];
      var c = new RGBColor(); c.red = 255; c.green = 0; c.blue = 200; r.strokeColor = c; },
    keepClear: function (idx, mode) {
      var d = AI.doc(), ab = AI.rect(d, idx), W = ab[2] - ab[0], H = ab[1] - ab[3], L, n = 0, i, sel = d.selection;
      if (mode === 'selection') { if (!sel || !sel.length) throw new Error('Select the items to keep clear first');
        var b = []; for (i = 0; i < sel.length; i++) b.push(sel[i].visibleBounds);
        L = AI.keepLayer(d); L.locked = false; L.visible = true;
        for (i = 0; i < b.length; i++) { var r = L.pathItems.rectangle(b[i][1], b[i][0], b[i][2] - b[i][0], b[i][1] - b[i][3]); AI.keepStyle(r); n++; }
        return { added: n };
      }
      L = AI.keepLayer(d); L.locked = false; L.visible = true;
      var w = W * 0.3, h = H * 0.2, box = L.pathItems.rectangle(ab[1] - (H - h) / 2, ab[0] + (W - w) / 2, w, h); AI.keepStyle(box);
      d.selection = null; box.selected = true; return { added: 1 };
    },
    ignore: function () {
      var d = AI.doc(), sel = d.selection, n = 0, on = 0;
      if (!sel || !sel.length) throw new Error('Select the items the grid should ignore');
      for (var i = 0; i < sel.length; i++) { var it = sel[i];
        if (hasIgnore(it.note)) it.note = it.note.replace(IGNORE, ''); else { it.note = IGNORE + (it.note || ''); on++; } n++; }
      return { items: n, ignored: on };
    },
    swatches: function (d) { var o = []; for (var i = 0; i < d.spots.length; i++) o.push(d.spots[i].name); return o; }
  };

  // =====================================================================================
  // INDESIGN
  // =====================================================================================
  function els(c) { try { return c.length ? c.everyItem().getElements() : []; } catch (e) { var o = []; for (var i = 0; i < c.length; i++) o.push(c[i]); return o; } }
  var ID = {
    doc: function () { if (!app.documents.length) throw new Error('No document open'); return app.activeDocument; },
    pts: function (fn) { var u = app.scriptPreferences.measurementUnit; app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS; try { return fn(); } finally { app.scriptPreferences.measurementUnit = u; } },
    pages: function (d) { var o = []; for (var i = 0; i < d.pages.length; i++) { var b = d.pages[i].bounds; o.push({ i: i, name: 'Page ' + d.pages[i].name, W: b[3] - b[1], H: b[2] - b[0] }); } return o; },
    active: function (d) { try { var p = app.activeWindow.activePage; return p.documentOffset; } catch (e) { return 0; } },
    // ID bounds [y1, x1, y2, x2] → page [l, t, r, b]
    toPage: function (pb, b) { return [b[1] - pb[1], b[0] - pb[0], b[3] - pb[1], b[2] - pb[0]]; },
    pathPts: function (it, pts, pb) {
      var paths; try { paths = it.paths; } catch (e) { return; } if (!paths) return;
      for (var i = 0; i < paths.length; i++) { var ep = paths[i].entirePath;
        for (var k = 0; k < ep.length; k++) { var q = ep[k];
          if (q.length === 3 && q[0] instanceof Array) { for (var j = 0; j < 3; j++) pts.push([q[j][0] - pb[1], q[j][1] - pb[0]]); }
          else pts.push([q[0] - pb[1], q[1] - pb[0]]); } }
    },
    collectPts: function (it, pts, pb) {
      if (it.constructor.name === 'Group') { var gk = els(it.pageItems); for (var i = 0; i < gk.length; i++) ID.collectPts(gk[i], pts, pb); return; }
      var n = pts.length; ID.pathPts(it, pts, pb);
      if (pts.length === n) { var b = ID.toPage(pb, it.visibleBounds); pts.push([b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]); }
    },
    invisible: function (it) {
      try { var t = it.constructor.name;
        if (t === 'TextFrame' || t === 'Group') return false;
        var hasContent = (it.allGraphics && it.allGraphics.length) || (it.pageItems && it.pageItems.length);
        var noFill = !it.fillColor || it.fillColor.name === 'None', noStroke = !it.strokeWeight || !it.strokeColor || it.strokeColor.name === 'None';
        return !hasContent && noFill && noStroke;
      } catch (e) { return false; }
    },
    scan: function (idx, opts) { return ID.pts(function () {
      var d = ID.doc(), pg = d.pages[idx], pb = pg.bounds, W = pb[3] - pb[1], H = pb[2] - pb[0], PA = W * H, obs = [], manual = [], existing = null, skipped = 0, uvOther = 0;
      function add(it, depth) {
        var lay; try { lay = it.itemLayer; } catch (e) {}
        if (!it.visible || (lay && (!lay.visible || isSkipLayer(lay.name))) || hasIgnore(it.label)) return;
        if (it.name === GROUP) return;
        if (ID.invisible(it)) return;
        var r = ID.toPage(pb, it.visibleBounds), rc = clip(r, W, H); if (area(rc) <= 0) return;
        var frac = area(rc) / PA, t = it.constructor.name;
        if (t === 'Group' && frac > WRAP_FRAC && depth < 6) { var gk = els(it.pageItems); for (var i = 0; i < gk.length; i++) add(gk[i], depth + 1); return; }
        if (frac >= BG_FRAC) { skipped++; return; }
        var pts = [], name = it.name || t;
        if (t === 'TextFrame') {
          try { var ol = it.createOutlines(false), rr = null;
            for (var o = 0; o < ol.length; o++) { rr = union(rr, ID.toPage(pb, ol[o].visibleBounds)); if (opts.shape) ID.collectPts(ol[o], pts, pb); }
            for (o = ol.length - 1; o >= 0; o--) ol[o].remove();
            if (rr) r = rr; else return;                         // no glyphs (empty frame)
            name = String(it.contents).substr(0, 32);
          } catch (e) { if (String(it.contents) === '') return; }
        } else if (opts.shape) ID.collectPts(it, pts, pb);
        obs.push({ rect: r, pts: thin(pts), name: name, kind: t });
      }
      var items = els(pg.pageItems), i;
      try { var mi = pg.masterPageItems; for (i = 0; i < mi.length; i++) items.push(mi[i].getElements ? mi[i].getElements()[0] : mi[i]); } catch (e) {}
      for (i = 0; i < items.length; i++) { var it = items[i], lay = null; try { lay = it.itemLayer; } catch (e) {}
        if (it.name === GROUP) { if (existing === null) existing = readTag(it.label); continue; }
        if (lay && UV_RE.test(lay.name)) { uvOther++; continue; }
        if (lay && lay.name === KEEP) { manual.push({ rect: ID.toPage(pb, it.geometricBounds), manual: true, name: 'Keep clear' }); continue; }
        add(it, 0); }
      return { page: { W: W, H: H }, obstacles: obs.concat(manual), skippedBackgrounds: skipped, existing: existing, uvOther: uvOther };
    }); },
    thumb: function (idx, longPx) { return ID.pts(function () {
      var d = ID.doc(), pg = d.pages[idx], pb = pg.bounds, W = pb[3] - pb[1], H = pb[2] - pb[0], L = d.layers, vis = [], i;
      var f = tmpFolder(); cleanThumbs(f); var file = new File(f.fsName + '/thumb-' + (new Date().getTime()) + '.png');
      var P = app.pngExportPreferences;
      P.exportResolution = Math.max(36, Math.min(600, longPx / (Math.max(W, H) / 72))); P.antiAlias = true;
      P.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE; P.pageString = '+' + (pg.documentOffset + 1);
      P.useDocumentBleeds = false; P.exportingSpread = false; P.transparentBackground = false; P.simulateOverprint = false;
      for (i = 0; i < L.length; i++) vis.push(L[i].visible);
      try { for (i = 0; i < L.length; i++) if (isSkipLayer(L[i].name)) L[i].visible = false;
        d.exportFile(ExportFormat.PNG_FORMAT, file, false);
      } finally { for (i = 0; i < L.length; i++) if (L[i].visible !== vis[i]) L[i].visible = vis[i]; }
      return file.fsName;
    }); },
    swatch: function (d, T) {
      var c = d.colors.itemByName(T.swatch); if (c.isValid) return c;
      return d.colors.add({ name: T.swatch, model: ColorModel.SPOT, space: ColorSpace.CMYK, colorValue: T.cmyk });
    },
    targetLayer: function (d, T, want) {
      var L = d.layers, i;
      if (want && want !== 'auto') { var w = L.itemByName(want); if (w.isValid) return w; }
      if (T.overprint) { for (i = 0; i < L.length; i++) if (UV_RE.test(L[i].name)) return L[i]; return L.add({ name: T.layer }); }
      var c = L.itemByName(T.layer); if (c.isValid) return c;
      var n = L.add({ name: T.layer }); if (L.length > 1) n.move(LocationOptions.BEFORE, L[L.length - 1]); return n;
    },
    removeOn: function (pg) { var n = 0, it = els(pg.pageItems);
      for (var i = it.length - 1; i >= 0; i--) if (it[i].name === GROUP) { var L = it[i].itemLayer, lk = L.locked; L.locked = false; it[i].locked = false; it[i].remove(); L.locked = lk; n++; }
      return n; },
    apply: function (p) { return ID.pts(function () {
      var d = ID.doc(), pg = d.pages[p.idx], pb = pg.bounds, T = p.treatment, res = {};
      app.doScript(function () {
        ID.removeOn(pg);
        var L = ID.targetLayer(d, T, p.layer), lk = L.locked, vis = L.visible; L.locked = false; L.visible = true;
        var sw = ID.swatch(d, T), none = d.swatches.itemByName('None'), ovs = [];
        for (var k = 0; k < p.dots.length; k++) { var x = p.dots[k][0] + pb[1], y = p.dots[k][1] + pb[0], r = p.dots[k][2];
          ovs.push(pg.ovals.add(L, { geometricBounds: [y - r, x - r, y + r, x + r], fillColor: sw, strokeColor: none, strokeWeight: 0, overprintFill: !!T.overprint })); }
        var g = ovs.length > 1 ? pg.groups.add(ovs, L) : ovs[0]; g.name = GROUP; g.label = TAG + json(p.settings);
        L.locked = lk; L.visible = vis; res = { drawn: ovs.length, layer: L.name, swatch: sw.name };
      }, ScriptLanguage.JAVASCRIPT, [], UndoModes.ENTIRE_SCRIPT, 'Apply NRF27 dot grid');
      return res;
    }); },
    keepLayer: function (d) { var L = d.layers.itemByName(KEEP); if (L.isValid) return L;
      return d.layers.add({ name: KEEP, printable: false, layerColor: UIColors.MAGENTA }); },
    keepStyle: function (d) { var c = d.colors.itemByName('Dot grid keep clear'); if (!c.isValid) c = d.colors.add({ name: 'Dot grid keep clear', model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: [255, 0, 200] });
      return { fillColor: d.swatches.itemByName('None'), strokeColor: c, strokeWeight: 1, strokeType: d.strokeStyles.itemByName('Dashed (4 and 4)') }; },
    keepClear: function (idx, mode) { return ID.pts(function () {
      var d = ID.doc(), pg = d.pages[idx], pb = pg.bounds, W = pb[3] - pb[1], H = pb[2] - pb[0], n = 0, L, st, i;
      if (mode === 'selection') { var sel = app.selection; if (!sel || !sel.length) throw new Error('Select the items to keep clear first');
        var bs = []; for (i = 0; i < sel.length; i++) if (sel[i].visibleBounds) bs.push(sel[i].visibleBounds);
        L = ID.keepLayer(d); L.locked = false; st = ID.keepStyle(d);
        for (i = 0; i < bs.length; i++) { var pr = st; var r = pg.rectangles.add(L, pr); r.geometricBounds = bs[i]; n++; }
        return { added: n }; }
      L = ID.keepLayer(d); L.locked = false; st = ID.keepStyle(d);
      var w = W * 0.3, h = H * 0.2, box = pg.rectangles.add(L, st); box.geometricBounds = [pb[0] + (H - h) / 2, pb[1] + (W - w) / 2, pb[0] + (H + h) / 2, pb[1] + (W + w) / 2];
      app.select(box); return { added: 1 };
    }); },
    ignore: function () { var sel = app.selection, n = 0, on = 0; if (!sel || !sel.length) throw new Error('Select the items the grid should ignore');
      for (var i = 0; i < sel.length; i++) { var it = sel[i]; if (!('label' in it)) continue;
        if (hasIgnore(it.label)) it.label = it.label.replace(IGNORE, ''); else { it.label = IGNORE + (it.label || ''); on++; } n++; }
      return { items: n, ignored: on }; },
    swatches: function (d) { var o = []; for (var i = 0; i < d.colors.length; i++) if (d.colors[i].model === ColorModel.SPOT) o.push(d.colors[i].name); return o; }
  };

  var H = isAI ? AI : ID;
  function layerNames(d) { var o = [], L = isAI ? AI.allLayers(d) : d.layers; for (var i = 0; i < L.length; i++) if (L[i].name !== KEEP && L[i].name !== '__dg_tmp') o.push(L[i].name); return o; }

  return {
    info: wrap(function () {
      if (!app.documents.length) return { app: isAI ? 'illustrator' : 'indesign', doc: null };
      var d = H.doc(), pages = isAI ? AI.pages(d) : ID.pts(function () { return ID.pages(d); });
      return { app: isAI ? 'illustrator' : 'indesign', doc: d.name, path: (function () { try { return d.fullName.fsName; } catch (e) { return ''; } })(), pages: pages, active: H.active(d), layers: layerNames(d) };
    }),
    where: wrap(function () { if (!app.documents.length) return ''; var d = H.doc(); return d.name + '|' + H.active(d); }),
    scan: wrap(function (idx, opts) { return H.scan(idx, opts || {}); }),
    thumb: wrap(function (idx, longPx) { return H.thumb(idx, longPx || 900); }),
    apply: wrap(function (p) { return H.apply(p); }),
    remove: wrap(function (idx) { var d = H.doc(); return { removed: isAI ? AI.removeOn(d, idx) : ID.pts(function () { return ID.removeOn(d.pages[idx]); }) }; }),
    keepClear: wrap(function (idx, mode) { return H.keepClear(idx, mode); }),
    clearKeep: wrap(function () { var d = H.doc(), n = 0;
      if (isAI) { for (var i = 0; i < d.layers.length; i++) if (d.layers[i].name === KEEP) { d.layers[i].locked = false; d.layers[i].remove(); n++; break; } }
      else { var L = d.layers.itemByName(KEEP); if (L.isValid) { L.locked = false; L.remove(); n++; } }
      return { removed: n }; }),
    ignore: wrap(function () { return H.ignore(); }),
    selectionRects: wrap(function (idx) { var d = H.doc(), o = [], sel, i;
      if (isAI) { var ab = AI.rect(d, idx); sel = d.selection; if (!sel || !sel.length) throw new Error('Select something in the document first');
        for (i = 0; i < sel.length; i++) o.push(AI.toPage(ab, sel[i].visibleBounds)); }
      else { o = ID.pts(function () { var pb = d.pages[idx].bounds, r = []; sel = app.selection; if (!sel || !sel.length) throw new Error('Select something in the document first');
        for (var k = 0; k < sel.length; k++) { var b; try { b = sel[k].visibleBounds; } catch (e) { b = null; } if (b) r.push(ID.toPage(pb, b)); } return r; }); }
      return o; }),
    goTo: wrap(function (idx) { var d = H.doc();
      if (isAI) d.artboards.setActiveArtboardIndex(idx); else app.activeWindow.activePage = d.pages[idx];
      return idx; }),
    version: '1.0.0'
  };
})();
