#!/bin/bash
# test/figma/run.sh 'API.scan(0,{shape:true})' [page name]  → runs figma/code.js + expression in Figma via the Labor bridge (port 3846)
# Targets the page named $2 (default "dg-plugin-test (temp)") without switching the user's view.
D="$(cd "$(dirname "$0")" && pwd)"
node -e '
const fs=require("fs"), code=fs.readFileSync(process.argv[1],"utf8"), expr=process.argv[2], page=process.argv[3];
const js="var __DG_TEST__=1, __DG_PAGE__=figma.root.children.filter(function(p){return p.name==="+JSON.stringify(page)+"})[0];\n"+code+
 "\nreturn __DG_PAGE__.loadAsync().then(function(){ return "+expr+"; }).then(function(r){ if(r&&r.__png) return {png:r.__png.length}; return r; });";
fetch("http://127.0.0.1:3846/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"run_script",params:{code:js},timeout:90000})})
 .then(r=>r.text()).then(t=>{ try{ const o=JSON.parse(t); console.log(JSON.stringify(o.result!==undefined?o.result:o)); }catch(e){ console.log(t); } });
' "$D/../../figma/code.js" "$1" "${2:-dg-plugin-test (temp)}"
