// node devserver.js ai|id [port] → http://localhost:PORT  serves ../extension with a mock __adobe_cep__ proxied to the real app
const http=require('http'), fs=require('fs'), path=require('path'), {execFile}=require('child_process');
const APP=process.argv[2]||'ai', PORT=+process.argv[3]||8765, EXT=path.resolve(__dirname,'../extension'), HOST=path.join(EXT,'host/host.jsx');
const F=path.join(__dirname,'.dev-call.jsx');
let q=Promise.resolve();
function run(script){ return q=q.then(()=>new Promise(res=>{
  fs.writeFileSync(F, fs.readFileSync(HOST,'utf8')+'\n'+script);
  const as = APP==='ai' ? `tell application "Adobe Illustrator" to do javascript (read POSIX file "${F}")` : `tell application id "com.adobe.InDesign" to do script (read POSIX file "${F}") language javascript`;
  execFile('osascript',['-e',as],{maxBuffer:1<<26},(e,out,err)=>res(e?JSON.stringify({ok:false,error:String(err||e.message)}):out.replace(/\n$/,'')));
}));}
const MOCK=`<script>window.__adobe_cep__={evalScript:function(s,cb){if(s==='typeof DG')return cb('object');fetch('/eval',{method:'POST',body:s}).then(r=>r.text()).then(cb)},
getSystemPath:function(){return 'file://${EXT}'},getHostEnvironment:function(){return JSON.stringify({appSkinInfo:{panelBackgroundColor:{color:{red:50,green:50,blue:50}}}})},addEventListener:function(){}};</script>`;
http.createServer((req,res)=>{
  if(req.url==='/eval'){let b='';req.on('data',d=>b+=d);req.on('end',()=>run(b).then(o=>{res.end(o)}));return;}
  if(req.url.startsWith('/file/')){const p=decodeURIComponent(req.url.slice(5).split('?')[0]);return fs.createReadStream(p).on('error',()=>{res.statusCode=404;res.end()}).pipe(res);}
  let p=path.join(EXT,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
  if(!fs.existsSync(p)){res.statusCode=404;return res.end();}
  let body=fs.readFileSync(p);
  if(p.endsWith('.html')) body=body.toString().replace('<script src="engine.js">',MOCK+'<script src="engine.js">');
  if(p.endsWith('panel.js')) body=body.toString().replace("im.src = 'file://' + encodeURI(path)","im.src = '/file' + encodeURI(path)");
  res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':'application/octet-stream');
  res.end(body);
}).listen(PORT,()=>console.log('dev panel ('+APP+') http://localhost:'+PORT));
