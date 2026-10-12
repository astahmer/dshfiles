#!/bin/sh
# jj-isolation shim. Installed ahead of the real `jj` on PATH.
#
# Read-only subcommands exec the real jj directly so that interactive reads pay
# nothing. Subcommands that can rewrite history are routed through the isolation
# guard, which refuses to rewrite another live workspace's working-copy revision.
#
# The guard calls jj itself; it sets JJ_ISOLATION_ACTIVE=1 so those nested calls
# bypass this shim instead of recursing.
set -u

if [ "${JJ_ISOLATION_ACTIVE:-}" = "1" ]; then
  exec "$JJ_ISOLATION_REAL_JJ" "$@"
fi

# The real jj path is baked in at install time, so the common path costs one
# shell exec and nothing else. The PATH scan is a fallback only: it needs
# dirname, and dirname is a separate process.
real="${JJ_ISOLATION_REAL_JJ:-@REAL_JJ@}"
if [ ! -x "$real" ]; then
  self_dir=${0%/*}
  old_ifs=$IFS
  IFS=:
  for dir in $PATH; do
    [ -n "$dir" ] || continue
    [ "$dir" = "$self_dir" ] && continue
    [ -x "$dir/jj" ] || continue
    real="$dir/jj"
    break
  done
  IFS=$old_ifs
fi
if [ ! -x "$real" ]; then
  echo "jj-isolation: no real jj executable found; set JJ_ISOLATION_REAL_JJ" >&2
  exit 127
fi

needs_guard=0
case " $* " in
  *" describe "* | *" split "* | *" squash "* | *" rebase "* | *" abandon "* | *" restore "* | *" workspace "* | *" bookmark "* | *" op "* | *" util "*)
    needs_guard=1
    ;;
esac
if [ "$needs_guard" = "0" ]; then
  exec "$real" "$@"
fi

JJ_ISOLATION_REAL_JJ="$real" exec "${JJ_ISOLATION_NODE:-node}" "@GUARD@" run "$@"
