#!/bin/bash
# test/figma/run.sh 'API.scan(0,{shape:true})'  → runs figma/code.js + expression in Figma through the Labor bridge (port 3846)
D="$(cd "$(dirname "$0")" && pwd)"
node -e '
const fs=require("fs"), code=fs.readFileSync(process.argv[1],"utf8"), expr=process.argv[2];
const body={command:"run_script",params:{code:"var __DG_TEST__=1;\n"+code+"\nreturn Promise.resolve("+expr+").then(function(r){ if(r&&r.__png) return {png:r.__png.length}; return r; });"},timeout:60000};
fetch("http://127.0.0.1:3846/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.text()).then(t=>console.log(t));
' "$D/../../figma/code.js" "$1"
