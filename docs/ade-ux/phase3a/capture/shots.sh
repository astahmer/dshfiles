#!/usr/bin/env bash
# Phase 3a captures. Usage: shots.sh <desktop|phone> [label-filter]
# Driver: phone.mjs (the Phase 0 WebKit driver; ADE_WS picks the workspace, default ade-shell).
set -u
SP=$(cd "$(dirname "$0")" && pwd)
S=${ADE_STATE:-/var/folders/3k/k0xz2zs57sq25lq8bfg2yg480000gn/T/dshx-dev/ade-shell/state.json}
MODE=$1; FILTER=${2:-}
case $MODE in
  desktop) SIZE=1440x900; SUFFIX=desktop ;;
  phone) SIZE=390x844; SUFFIX=phone ;;
esac
OUT="$SP/../raw"; mkdir -p "$OUT"
shot() { local label=$1; shift; [[ -n $FILTER && $label != *$FILTER* ]] && return; node "$SP/phone.mjs" "$S" "$OUT/$label-$SUFFIX.png" light "$SIZE" "$@" 2>&1 | tail -1 | cut -c1-400; }

if [[ $MODE == desktop ]]; then
  shot 10-threads 'click tab "Threads"' 'wait 1200'
  for d in Inbox Land Work Agents Observe Knowledge Settings; do
    shot "11-$(echo $d | tr A-Z a-z)" "click tab \"$d\"" 'wait 1500'
  done
  shot 12-moved-page 'click tab "Observe"' 'click button "Usage"' 'wait 1500'
  shot 13-moved-to 'click tab "Land"' 'click button "Where did a page go?"' 'wait 800'
  shot 14-collapsed 'click tab "Threads"' 'click button "Collapse sidebar"' 'wait 800'
  shot 15-board 'click tab "Threads"' 'click button "Board"' 'wait 1500'
else
  shot 20-stage 'wait 1500'
  shot 21-threads-list 'click button "Threads"' 'wait 1200'
  shot 22-inbox 'click button "Inbox"' 'wait 1500'
  shot 23-more 'click button "More"' 'wait 800'
  shot 24-observe-index 'click button "More"' 'click button "Observe*"' 'wait 1000'
  shot 25-moved-page 'click button "More"' 'click button "Observe*"' 'click button "Usage"' 'wait 1500'
fi
