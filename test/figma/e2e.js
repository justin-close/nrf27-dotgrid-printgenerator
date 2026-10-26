// node test/figma/e2e.js idx '{"mode":...}'  → scan → engine → apply inside Figma (scratch page)
const {execFileSync}=require('child_process'), E=require('../../shared/engine.js');
const [idx, sj]=[+process.argv[2], process.argv[3]||'{}'];
const call=expr=>{ const o=JSON.parse(execFileSync(__dirname+'/run.sh',[expr]).toString()); if(o&&o.error&&!o.page&&!o.drawn) throw new Error(JSON.stringify(o)); return o; };
const s=JSON.parse(sj), scan=call(`API.scan(${idx},{shape:${s.knock==='shape'}})`);
const obs=scan.obstacles.map(o=>({rect:o.rect,manual:o.manual,hull:o.pts&&o.pts.length>2?E.hull(o.pts):null}));
const r=E.compute(scan.page,obs,s);
const p={idx,dots:r.dots.map(d=>[+d[0].toFixed(3),+d[1].toFixed(3),+d[2].toFixed(4)]),treatment:r.treatment,settings:r.settings};
const t0=Date.now(), res=call(`API.apply(${JSON.stringify(p)})`);
console.log(JSON.stringify({grid:r.cols+'x'+r.rows,dots:r.dots.length,d:[r.minD.toFixed(2),r.maxD.toFixed(2)],gaps:r.gaps&&Object.fromEntries(Object.entries(r.gaps).map(([k,v])=>[k,v&&+v.toFixed(1)])),res,ms:Date.now()-t0}));
