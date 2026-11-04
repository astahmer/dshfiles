#!/usr/bin/env bash
# Phase 0 baseline journeys. Usage: journeys.sh <desktop|phone|dark> [label-filter]
set -u
SP=$(cd "$(dirname "$0")" && pwd)
S=/var/folders/3k/k0xz2zs57sq25lq8bfg2yg480000gn/T/dshx-dev/ade-baseline/state.json
MODE=$1; FILTER=${2:-}
case $MODE in
  desktop) SIZE=1440x900; SCHEME=light; SUFFIX=desktop ;;
  phone) SIZE=390x844; SCHEME=light; SUFFIX=phone ;;
  dark) SIZE=1440x900; SCHEME=dark; SUFFIX=desktop-dark ;;
esac
mkdir -p "$SP/raw"
PICK=('click button "Choose workspace"' 'fill textbox "Search projects or enter a folder path" "sample"' 'expect option "sample*"' 'press Enter' 'wait 800')
shot() { local label=$1; shift; [[ -n $FILTER && $label != *$FILTER* ]] && return; node "$SP/phone.mjs" "$S" "$SP/raw/$label-$SUFFIX.png" "$SCHEME" "$SIZE" "$@" 2>&1 | tail -1 | cut -c1-600; }

shot 01-start-thread 'click button "New thread"' 'wait 1200'
shot 01b-project-picker 'click button "New thread"' 'click button "Choose workspace"' 'expect option "sample*"' 'wait 600'
shot 02-thread-list 'nav button "All threads"' 'wait 500'
shot 02b-thread-board 'nav button "Thread Sidebar: Board"' 'wait 1500'
shot 03-question-attempt 'click text "Fake thread title"' 'wait 1500'
shot 04a-changes 'click text "Seeded thread to rebase"' 'wait 1000' 'click button "Changes since branching from main*"' 'wait 1000'
shot 04b-thread-integration 'nav button "JJ Integration: Thread integration"' 'wait 1500'
shot 04c-jujutsu-graph 'nav button "Jujutsu: Revision graph"' 'click button "Choose repository"' 'fill textbox "Search projects or enter a folder path" "sample"' 'expect option "sample*"' 'press Enter' 'wait 2000'
shot 04d-pulls-review 'nav button "pulls.review: Reviews"' 'wait 2500'
shot 05a-activity 'nav button "Activity Timeline: Activity"' 'wait 1500'
shot 05b-jobs 'nav button "Background Jobs: Jobs"' 'wait 1500'
shot 05c-backlog-inbox 'nav button "Backlog: Items"' 'click button "Inbox"' 'wait 1500'
shot 06-palette-threads 'click button "Open command palette"' 'click tab "Threads"' 'fill combobox "Search the command palette" "thread"' 'wait 1200'
shot 07a-ai-accounts 'nav button "AI Accounts: Accounts"' 'wait 1500'
shot 07b-mcp-servers 'nav button "MCP Servers: Servers"' 'wait 1500'
shot 07c-secret-catalog 'nav button "Secret Catalog: Secrets"' 'wait 1500'
shot 07d-settings 'click button "Account menu"' 'click menuitem "Settings*"' 'wait 1500'
shot 08a-usage 'nav button "Usage: Analytics"' 'wait 2000'
shot 08b-ai-accounts-usage 'nav button "AI Accounts: Usage history"' 'wait 2000'
