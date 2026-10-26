#!/bin/bash
# run.sh ai|id '<js expression using DG>'  → evaluates host.jsx + expression in the app
D="$(cd "$(dirname "$0")" && pwd)"; H="$D/../extension/host/host.jsx"; F="$D/.call.jsx"
{ cat "$H"; echo; echo "$2"; } > "$F"
if [ "$1" = ai ]; then osascript -e "tell application \"Adobe Illustrator\" to do javascript (read POSIX file \"$F\")"
else osascript -e "tell application id \"com.adobe.InDesign\" to do script (read POSIX file \"$F\") language javascript"; fi
