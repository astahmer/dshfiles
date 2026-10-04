#!/usr/bin/env bash
# Print the jj working-copy state before touching history.
#
# `jj abandon` and `jj restore` discard the whole working copy, so a revision
# switch made mid-task silently reverts unrelated edits. Run this first to see
# what would be lost, and confirm the change you are about to describe is still
# the one on disk.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== working copy =="
jj log -r @ --no-graph -T 'change_id.short() ++ "  " ++ description.first_line() ++ "\n"'
echo
echo "== parent =="
jj log -r @- --no-graph -T 'change_id.short() ++ "  " ++ description.first_line() ++ "\n"'
echo
echo "== files changed vs parent =="
jj diff --stat
echo
echo "== untracked additions =="
jj status | sed -n 's/^A /  + /p'