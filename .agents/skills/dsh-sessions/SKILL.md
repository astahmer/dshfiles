---
name: dsh-sessions
description: Inspect, supervise and debug DSH sessions (threads, conversations — same thing) from a shell with the dshx CLI — find a session, see what its agent is doing, whether it is stuck, what it changed, follow it live, or read its raw events. Use when asked to review, watch, monitor or debug another thread, to check on a sub-agent or relay agent, or when given a DSH URL with ?thread=session-….
---

# DSH sessions

A session, thread and conversation are the same thing. Read-only by default:
`list`, `search`, `show`, `digest`, `tail`, `history` and `export` never change
a session. `prompt`, `cancel`, `rename`, `archive`, `fork` and `create` do —
run them only when the user asked for that action.

## Run dshx

`dshx` is not on PATH. From any dshfiles checkout:

```sh
dshx() { fnm exec --using=22.23.3 node ~/dev/dshfiles/tooling/dshx/packages/dshx/dist/cli/bin.js "$@"; }
```

It reaches the live DSH through, in order: `--url`, `$DSHX_URL`, then
`~/.dsh/runtime/web-url`, which the `dsh web` supervisor writes (mode 600).
Without the supervisor, ask the user for the URL DSH printed at start, pass it
only as `DSHX_URL`, and never write it to a file, log or commit. The URL grants
full control of the user's DSH; treat it as a secret.

## Find the session

- From a browser URL: `…/?thread=session-<uuid>&workspace=<id>` → the id is
  `session-<uuid>`.
- `dshx sessions list --json` (all sessions, with `running` and `cwd`),
  `dshx sessions search "<text>"` (at most 20 snippets),
  `dshx sessions show <id> --json` (one summary).

## Supervise: start with digest

```sh
dshx sessions digest <id>            # ~50 lines: state, goal, todos, actions, edits, revisions, failures
dshx sessions digest <id> --limit 40 # more recent actions
dshx sessions digest <id> --json     # stable schema under .data
```

Read it in this order:

1. `State` and `Attention`: running or idle, idle time, and flags — a tool call
   pending > 2 min, no events for 10 min while running, a failed last turn
   (usage limits show up here), trailing tool failures, the same call repeated,
   turns with no tool call (goal loop), open todos on an idle session.
2. `Cwd … but shell runs in:` — agents often work in another directory through
   per-call `workdir` (a jj thread workspace, a sibling checkout). Inspect that
   directory, not the session cwd.
3. `Goal` and `Todos`: what it is trying to do and where it is.
4. `Thinking:` reasoning headlines. Reasoning bodies are encrypted, and agents
   often write little assistant text, so text alone says nothing — progress
   lives in actions, todos and goals.
5. `Recent actions`, `Files changed`, `Revisions` and `Undescribed edits`:
   what it changed and whether that work is described in jj.

Then verify claims against the working directory it really uses:
`jj --ignore-working-copy log -r '::@ ~ ::main' -R <dir>` (never snapshot
another agent's working copy) and run its tests there if needed.

## Follow or drill down

```sh
dshx sessions tail <id>                          # newest 40 events, one line each, noise hidden
dshx sessions tail <id> --follow                 # live, polls every 2 s (Ctrl-C to stop)
dshx sessions tail <id> --types tool --tail 30   # last 30 tool calls/results
dshx sessions tail <id> --since-seq 3200         # everything after a sequence from digest
dshx sessions export <id> --tail 50 --types todo,goal,tool --json  # raw records, bounded
```

Use the sequence numbers (`#3195`) from digest to cut `--since-seq` windows.
Avoid an unfiltered `export`: one long session is tens of MB.

## Inside DSH (agent tools)

An agent running inside DSH can use `activity_timeline_page` /
`activity_timeline_attention` (activity-timeline plugin) and
`dshx_comm_agents` / `dshx_comm_send` (agent-communication) instead of the CLI.
`@`-mentioning a session in a prompt attaches a read-only snapshot of it.

## Offline (DSH down)

Session logs live at `~/.dsh/sessions/<cwd-slug>/<uuid>/session.v4.jsonl.zstd`
(the slug is the cwd with `/` → `-`). Read with
`nix run nixpkgs#zstd -- -dc <file> | head`; never edit these files or
`session.lock`.

## Reporting

State what the agent is doing, whether it is blocked or waiting for the user
(e.g. `Thinking: … Requesting user input`), what it changed (revisions, files)
and what is unverified. Do not infer "idle" from a `sleep` in its actions —
check the goal, todos and the directory it works in.
