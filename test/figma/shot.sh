#!/bin/bash
# test/figma/shot.sh <out.png> <width>  → exports every frame on the scratch page side by side
node -e '
const js=`const pg=figma.root.children.find(p=>p.name==="dg-plugin-test (temp)"); await pg.loadAsync(); const out=[];
for (const f of pg.children) out.push(figma.base64Encode(await f.exportAsync({format:"PNG",constraint:{type:"HEIGHT",value:${process.argv[1]}}})));
return out;`;
fetch("http://127.0.0.1:3846/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"run_script",params:{code:js},timeout:90000})})
.then(r=>r.json()).then(o=>{ if(!o.result){console.log(JSON.stringify(o).slice(0,400));process.exit(1)} o.result.forEach((b,i)=>require("fs").writeFileSync(`/tmp/dgf-${i}.png`,Buffer.from(b,"base64"))); console.log(o.result.length); });
' "$2"
~/shopify-inter-dotted/.venv/bin/python -c "
import glob,sys; from PIL import Image
ims=[Image.open(p).convert('RGB') for p in sorted(glob.glob('/tmp/dgf-*.png'))]; H=max(i.height for i in ims)
c=Image.new('RGB',(sum(i.width for i in ims)+20*(len(ims)-1),H),'white'); x=0
for i in ims: c.paste(i,(x,(H-i.height)//2)); x+=i.width+20
c.save(sys.argv[1],quality=88)" "$1"; rm -f /tmp/dgf-*.png
