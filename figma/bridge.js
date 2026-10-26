/* Figma UI-side bridge: lets the shared panel (panel.js) talk to figma/code.js over postMessage. */
window.DGBridge = (function () {
  var seq = 0, pend = {}, cache = {}, readyRes, ready = new Promise(function (r) { readyRes = r; });
  setTimeout(function () { readyRes(); }, 1500);                      // never hang if storage is slow
  window.onmessage = function (e) {
    var m = e.data && e.data.pluginMessage; if (!m) return;
    if (m.type === 'storage') { cache = m.data || {}; readyRes(); return; }
    var p = pend[m.id]; if (!p) return; delete pend[m.id];
    if (!m.ok) return p.rej(new Error(m.error));
    var d = m.data;
    if (d && d.__png) d = URL.createObjectURL(new Blob([d.__png], { type: 'image/png' }));
    p.res(d);
  };
  function post(msg) { parent.postMessage({ pluginMessage: msg }, '*'); }
  return {
    ready: ready,
    call: function (fn, args) { return new Promise(function (res, rej) { var id = ++seq; pend[id] = { res: res, rej: rej }; post({ id: id, fn: fn, args: args }); }); },
    storage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null; },
      setItem: function (k, v) { cache[k] = v; post({ type: 'store', key: k, value: v }); }
    }
  };
})();
