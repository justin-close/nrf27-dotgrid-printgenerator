// node e2e.js ai|id idx '{"mode":"corner",...}'  → scan → engine → apply → thumb (with UV visible)
const {execFileSync}=require('child_process'), E=require('../shared/engine.js');
const [app, idx, sj] = [process.argv[2], +process.argv[3], process.argv[4]||'{}'];
const call = expr => { const o = JSON.parse(execFileSync(__dirname+'/run.sh', [app, expr]).toString()); if(!o.ok) throw new Error(o.error); return o.data; };
const s = Object.assign({}, JSON.parse(sj));
const scan = call(`DG.scan(${idx},{shape:${s.knock==='shape'}})`);
const obs = scan.obstacles.map(o => ({rect:o.rect, manual:o.manual, hull:o.pts&&o.pts.length>2?E.hull(o.pts):null}));
const r = E.compute(scan.page, obs, s);
const t0=Date.now();
const res = call(`DG.apply(${JSON.stringify({idx, dots:r.dots.map(d=>d.map(v=>+v.toFixed(3))), treatment:r.treatment, layer:'auto', settings:r.settings})})`);
console.log(JSON.stringify({grid:r.cols+'x'+r.rows, dots:r.dots.length, d:[r.minD.toFixed(2), r.maxD.toFixed(2)], m:r.pitchAdjust, gaps:r.gaps, res, ms:Date.now()-t0}));
