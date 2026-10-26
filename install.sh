#!/bin/bash
# NRF27 Dot Grid panel — install for Illustrator + InDesign (macOS). Run: bash install.sh   (uninstall: bash install.sh --remove)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"; EXT="$DIR/extension"; DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.shopify.nrf27.dotgrid"
if [ "$1" = "--remove" ]; then rm -rf "$DEST"; echo "Removed. Restart Illustrator / InDesign."; exit 0; fi
[ -f "$DIR/shared/engine.js" ] && cp "$DIR/shared/engine.js" "$EXT/engine.js"
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done   # allow unsigned panels
mkdir -p "$(dirname "$DEST")"; rm -rf "$DEST"
if [ "$1" = "--dev" ]; then ln -s "$EXT" "$DEST"; else cp -R "$EXT" "$DEST"; rm -f "$DEST/.debug"; fi
echo "Installed to $DEST"; echo "Restart Illustrator / InDesign, then Window > Extensions > NRF27 Dot Grid."
