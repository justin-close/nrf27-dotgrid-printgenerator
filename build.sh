#!/bin/bash
# bash build.sh [deploy|pages]  — sync engine, zip panel into site/; deploy = Quick site, pages = push site/ to the gh-pages branch
set -e; cd "$(dirname "$0")"
cp shared/engine.js extension/engine.js; cp shared/engine.js site/engine.js
node figma/build.js
F=$(mktemp -d); mkdir -p "$F/nrf27-dotgrid-figma"; cp figma/manifest.json figma/code.js figma/ui.html "$F/nrf27-dotgrid-figma/"
(cd "$F" && zip -qr -X nrf27-dotgrid-figma.zip nrf27-dotgrid-figma); mv "$F/nrf27-dotgrid-figma.zip" site/; rm -rf "$F"
T=$(mktemp -d); P="$T/nrf27-dotgrid-panel"; mkdir -p "$P"
cp -R extension "$P/extension"; rm -f "$P/extension/.debug"; cp install.sh README.md "$P/"
(cd "$T" && rm -f nrf27-dotgrid-panel.zip && zip -qr -X nrf27-dotgrid-panel.zip nrf27-dotgrid-panel -x '*.DS_Store')
mv "$T/nrf27-dotgrid-panel.zip" site/; rm -rf "$T"; ls -la site/nrf27-dotgrid-panel.zip
[ "$1" = "deploy" ] && (cd site && quick deploy . nrf27-dotgrid-printgenerator -f)
if [ "$1" = "pages" ]; then
  W=$(mktemp -d); cp -R site/. "$W/"; touch "$W/.nojekyll"; URL=$(git remote get-url origin)
  (cd "$W" && git init -q -b gh-pages && git add -A && git commit -qm "Publish site from $(cd "$OLDPWD" && git rev-parse --short HEAD)" && git push -qf "$URL" gh-pages)
  rm -rf "$W"; echo "Pushed site/ to gh-pages"
fi
exit 0
