/* NRF27 dot grid engine — shared by the CEP panel (Illustrator/InDesign) and the Quick site playground.
 * Port of ~/ai-postcard/dots.py (the system used on the welcome sign, thank-you cards, postcard, name cards).
 * Coordinates: points, page-relative, origin top-left, y down.
 *
 *   DotGrid.compute(page, obstacles, settings) → { dots: [[x, y, r], …], … }
 *   page      = { W, H }                       trim size in pt
 *   obstacles = [{ rect: [l, t, r, b], hull?: [[x, y], …], manual?: bool }]
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    mode: 'page',        // 'page' = recede around content | 'corner' | 'edge'
    anchor: 'bl',        // corner: tl tr bl br · edge: t r b l
    reach: 0.6,          // corner/edge: fraction of the page diagonal (corner) or depth (edge) the dots cover
    density: 1,          // ×lattice count (pitch ÷ density)
    size: 1,             // ×dot size
    minDot: 0.33,        // smallest dot as a fraction of the largest
    softness: 3,         // fade distance around content, in grid cells
    clearance: null,     // pt of empty space between dots and content; null = auto (13u)
    knock: 'rect',       // 'rect' = content bounding boxes (balanced margins) | 'shape' = convex outline
    margin: 4.5,         // pt: dot edges stay this far inside the trim (cut tolerance)
    balance: true,       // page mode: nudge pitch ±15% so the gap round the main content is even on all sides
    treatment: 'spot'    // 'spot' = 100% Spot UV overprint | 'color' = PMS 9285C spot (CMYK 4/3/7/0)
  };

  var TREATMENTS = {
    spot:  { swatch: 'Spot UV',         cmyk: [0, 100, 0, 0], overprint: true,  layer: 'Spot UV',  display: '#e6007e' },
    color: { swatch: 'PMS 9285C',       cmyk: [4, 3, 7, 0],   overprint: false, layer: 'Dot grid', display: '#f0ede6' }
  };

  function ss(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function rdist(x, y, r) {
    var dx = Math.max(r[0] - x, 0, x - r[2]), dy = Math.max(r[1] - y, 0, y - r[3]);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function expand(r, p) { return [r[0] - p, r[1] - p, r[2] + p, r[3] + p]; }

  function hull(points) {
    var pts = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (pts.length < 3) return pts;
    var cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // 0 inside the convex polygon, else the distance to it (orientation-agnostic)
  function hdist(x, y, H) {
    var n = H.length, pos = 0, neg = 0, md = 1e9;
    for (var k = 0; k < n; k++) {
      var a = H[k], c = H[(k + 1) % n], dx = c[0] - a[0], dy = c[1] - a[1];
      var cr = dx * (y - a[1]) - dy * (x - a[0]); if (cr > 0) pos++; else if (cr < 0) neg++;
      var L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
      var ex = a[0] + t * dx - x, ey = a[1] + t * dy - y; md = Math.min(md, Math.sqrt(ex * ex + ey * ey));
    }
    return (pos === 0 || neg === 0) ? 0 : md;
  }

  function merged(s) { var o = {}, k; for (k in DEFAULTS) o[k] = DEFAULTS[k]; for (k in s || {}) if (s[k] !== undefined) o[k] = s[k]; return o; }

  // Base system: landing-page hero lattice scaled to the page's long side (u = L/1440), card proportions
  // (pitch 42u·1.75 × 41u·1.75, dot r 2.5u·2). Density/size multiply on top.
  function system(page, s) {
    var u = Math.max(page.W, page.H) / 1440;
    var px = 42 * u * 1.75 / s.density, py = 41 * u * 1.75 / s.density;
    var R = Math.min(2.5 * u * 2 * s.size, 0.46 * Math.min(px, py));
    return { u: u, px: px, py: py, R: R, clear: s.clearance == null ? 13 * u : s.clearance, pad: 8 * u };
  }

  function lattice(page, S, margin) {
    var cols = Math.max(2, Math.round(page.W / S.px)), rows = Math.max(2, Math.round(page.H / S.py));
    while (cols > 1 && (page.W - (cols - 1) * S.px) / 2 - S.R < margin) cols--;
    while (rows > 1 && (page.H - (rows - 1) * S.py) / 2 - S.R < margin) rows--;
    return { cols: cols, rows: rows, x0: (page.W - (cols - 1) * S.px) / 2, y0: (page.H - (rows - 1) * S.py) / 2 };
  }

  function anchorFade(x, y, page, s) {
    var W = page.W, H = page.H, a = s.anchor, d, D;
    if (s.mode === 'corner') {
      var cx = a.charAt(1) === 'r' ? W : 0, cy = a.charAt(0) === 'b' ? H : 0;
      d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)); D = Math.sqrt(W * W + H * H);
    } else {
      d = a === 't' ? y : a === 'b' ? H - y : a === 'l' ? x : W - x; D = (a === 't' || a === 'b') ? H : W;
    }
    var t = d / Math.max(1e-6, s.reach * D);
    return t > 1 ? -1 : 1 - (1 - s.minDot) * ss(t);      // −1 = outside the reach → no dot
  }

  function run(page, obstacles, s, S) {
    var G = lattice(page, S, s.margin), F = s.softness * S.px, dots = [], knocked = 0, rec = 0;
    var obs = obstacles.map(function (o) {
      return { rect: o.rect, pad: expand(o.rect, S.pad), hull: (s.knock === 'shape' && !o.manual && o.hull && o.hull.length > 2) ? o.hull : null };
    });
    for (var j = 0; j < G.rows; j++) for (var i = 0; i < G.cols; i++) {
      var x = G.x0 + i * S.px, y = G.y0 + j * S.py, v = 0, k;
      for (k = 0; k < obs.length; k++) v = Math.max(v, 1 - ss(rdist(x, y, obs[k].pad) / F));
      var sc = 1 + (s.minDot - 1) * v;
      if (s.mode !== 'page') { var sa = anchorFade(x, y, page, s); if (sa < 0) continue; sc = Math.min(sc, sa); }
      var r = S.R * sc, hit = false;
      for (k = 0; k < obs.length && !hit; k++)
        hit = (obs[k].hull ? hdist(x, y, obs[k].hull) : rdist(x, y, obs[k].rect)) < r + S.clear;
      if (hit) { knocked++; continue; }
      dots.push([x, y, r]); if (sc < 0.999) rec++;
    }
    return { dots: dots, grid: G, knocked: knocked, receded: rec };
  }

  // Gap from the main content block to the nearest dot edge on each side (null if no dot faces that side)
  function gaps(dots, o) {
    var g = { l: null, r: null, t: null, b: null };
    var r = o.rect;
    for (var i = 0; i < dots.length; i++) {
      var x = dots[i][0], y = dots[i][1], d = dots[i][2], v;
      if (y >= r[1] && y <= r[3]) {
        if (x < r[0]) { v = r[0] - (x + d); if (g.l === null || v < g.l) g.l = v; }
        if (x > r[2]) { v = (x - d) - r[2]; if (g.r === null || v < g.r) g.r = v; }
      }
      if (x >= r[0] && x <= r[2]) {
        if (y < r[1]) { v = r[1] - (y + d); if (g.t === null || v < g.t) g.t = v; }
        if (y > r[3]) { v = (y - d) - r[3]; if (g.b === null || v < g.b) g.b = v; }
      }
    }
    return g;
  }
  function spread(g) {
    var v = [g.l, g.r, g.t, g.b].filter(function (x) { return x !== null; });
    return v.length < 2 ? 0 : Math.max.apply(null, v) - Math.min.apply(null, v);
  }
  function meanGap(g) {
    var v = [g.l, g.r, g.t, g.b].filter(function (x) { return x !== null; });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }
  function mainBlock(obstacles) {
    var best = null, A = -1;
    obstacles.forEach(function (o) { var a = (o.rect[2] - o.rect[0]) * (o.rect[3] - o.rect[1]); if (!o.manual && a > A) { A = a; best = o; } });
    return best;
  }

  function compute(page, obstacles, settings) {
    var s = merged(settings); obstacles = obstacles || [];
    var main = mainBlock(obstacles), m = 1, out, S;
    if (s.balance && s.mode === 'page' && main) {
      var best = null;
      // cost: uneven sides (relative) + gaps that hug the content (< 0.7 pitch) + distance from the requested density
      for (var k = -60; k <= 60; k++) {
        var mk = 1 + k * 0.0025, s2 = merged(s); s2.density = s.density * mk;
        var S2 = system(page, s2), o2 = run(page, obstacles, s2, S2), g = gaps(o2.dots, main), mean = meanGap(g);
        var c = mean === null ? 9 : spread(g) / Math.max(mean, 0.01) + 0.8 * Math.max(0, 0.7 - mean / S2.px) + 0.6 * Math.abs(mk - 1);
        if (!best || c < best.c - 1e-9) best = { c: c, m: mk, S: S2, out: o2 };
      }
      m = best.m; S = best.S; out = best.out;
    } else { S = system(page, s); out = run(page, obstacles, s, S); }
    var rs = out.dots.map(function (d) { return d[2]; });
    return {
      dots: out.dots, cols: out.grid.cols, rows: out.grid.rows, px: S.px, py: S.py, R: S.R, clear: S.clear,
      minD: rs.length ? 2 * Math.min.apply(null, rs) : 0, maxD: rs.length ? 2 * Math.max.apply(null, rs) : 0,
      knocked: out.knocked, receded: out.receded, pitchAdjust: m,
      edge: { x: out.grid.x0 - S.R, y: out.grid.y0 - S.R },
      gaps: main ? gaps(out.dots, main) : null, settings: s, treatment: TREATMENTS[s.treatment]
    };
  }

  var api = { compute: compute, hull: hull, DEFAULTS: DEFAULTS, TREATMENTS: TREATMENTS, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DotGrid = api;
})(typeof window !== 'undefined' ? window : this);
