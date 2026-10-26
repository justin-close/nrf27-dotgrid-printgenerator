#!/bin/bash
# bash figma/install.sh [--dry-run] — registers figma/manifest.json as a Figma desktop development plugin
# (same result as Plugins › Development › Import plugin from manifest…). Figma rewrites its settings while
# running, so this quits Figma, edits settings.json (backup kept), and reopens it. Files are cloud-saved.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"; MAN="$DIR/manifest.json"
SET="$HOME/Library/Application Support/Figma/settings.json"
DRY=0; [ "$1" = "--dry-run" ] && DRY=1
[ -f "$SET" ] || { echo "Figma desktop settings not found: $SET"; exit 1; }
[ -f "$DIR/ui.html" ] || node "$DIR/build.js"

edit() {  # $1 = settings file to edit in place
python3 - "$1" "$MAN" <<'EOF'
import json, sys, os
p, man = sys.argv[1], sys.argv[2]; d = os.path.dirname(man)
s = json.load(open(p)); L = s.setdefault('localFileExtensions', [])
if any(e.get('manifestPath') == man for e in L):
    print('Already installed:', man); sys.exit(0)
m = json.load(open(man)); n = max([e.get('id', 0) for e in L] + [0])
L.append({'id': n + 1, 'manifestPath': man, 'lastKnownName': m['name'], 'lastKnownPluginId': m['id'],
          'fileMetadata': {'type': 'manifest', 'codeFileId': n + 2, 'uiFileIds': [n + 3]}})
L.append({'id': n + 2, 'manifestPath': os.path.join(d, m['main']), 'fileMetadata': {'type': 'code', 'manifestFileId': n + 1}})
L.append({'id': n + 3, 'manifestPath': os.path.join(d, m['ui']), 'fileMetadata': {'type': 'ui', 'manifestFileId': n + 1}})
json.dump(s, open(p, 'w'), separators=(',', ':'))
print('Added', m['name'], '→', man)
EOF
}

if [ $DRY = 1 ]; then T=$(mktemp); cp "$SET" "$T"; edit "$T"; python3 -c "import json,sys;json.load(open(sys.argv[1]));print('settings still valid JSON')" "$T"; rm -f "$T"; exit 0; fi

if grep -qF "\"$MAN\"" "$SET"; then echo "Already installed — run it from Plugins › Development › NRF27 Dot Grid"; exit 0; fi
RUNNING=0; pgrep -xq Figma && RUNNING=1
if [ $RUNNING = 1 ]; then
  echo "Quitting Figma…"; osascript -e 'tell application "Figma" to quit'
  for i in $(seq 1 30); do pgrep -xq Figma || break; sleep 1; done
  pgrep -xq Figma && { echo "Figma didn't quit (unsaved dialog?). Close it and re-run."; exit 1; }
  sleep 1
fi
cp "$SET" "$SET.bak-dotgrid"; edit "$SET"
[ $RUNNING = 1 ] && open -a Figma && echo "Reopened Figma."
echo "Done: Plugins › Development › NRF27 Dot Grid   (backup: settings.json.bak-dotgrid)"
