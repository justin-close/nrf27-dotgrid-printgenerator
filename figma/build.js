// node figma/build.js → figma/ui.html (single file: shared panel markup + css + engine + bridge + panel.js inlined)
const fs = require('fs'), path = require('path'), R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
let html = R('extension/index.html');
html = html.replace('<link rel="stylesheet" href="panel.css">', () => '<style>\n' + R('extension/panel.css') + '\n</style>');
html = html.replace('<script src="engine.js"></script>', () => '<script>\n' + safe(R('shared/engine.js')) + '\n</script>\n<script>\n' + safe(R('figma/bridge.js')) + '\n</script>');
html = html.replace('<script src="panel.js"></script>', () => '<script>\n' + safe(R('extension/panel.js')) + '\n</script>');
if (/src="(engine|panel)\.js"|href="panel\.css"/.test(html)) throw new Error('inline failed');
fs.writeFileSync(path.join(__dirname, 'ui.html'), html);
console.log('figma/ui.html', (html.length / 1024).toFixed(1) + ' KB');
