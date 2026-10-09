# OptMem — Stage 3 runtime evidence (probe profile, 2026-10-09)

Plugin: `plugins/@dshfiles/optmem` (compatibility mode). Runtime: DSH 0.2.0-rc.2 on Node 22.23.3 (fnm), profile `probe`,
port 3097. The `web` profile (port 3080, pid unchanged before and after) was never touched or restarted.

## Steps

1. `pnpm profile:sync --profile probe --bundle @dshfiles/optmem` — added only this bundle to the probe manifest.
2. `fnm exec --using=22.23.3 pnpm profile:boot --profile probe`
   - First boot **failed**: `dshfiles-optmem … Error: Settings entry "dshfiles-optmem" is unavailable` — the settings
     scope throws from `get()` while the Loader is still composing the entry, and setup read it eagerly.
     Fix: settings reads fall back to schema defaults until the entry is readable (`memory_status` says which source
     is in use).
   - Second boot: `profile probe: booted with no activation failures`. (The pre-existing probe patch warning
     `entry "llm-openai-codex" not found` is unrelated.)
3. Manual boot (`dsh --profile probe --port 3097 --no-open`), driven with a headless browser:
   - Plugins page: `@dshfiles/optmem` v0.1.0, component `dshfiles-optmem`, **Running**.
   - Composer: `/optmem-backfill 5` → executed by the Host (no model call).
4. Probe stopped by killing the 3097 listener; 3080 still served by the same pid.

## What the database showed (`~/.dsh/plugins/optmem/optmem.db`, DSH_HOME default)

- File and WAL created mode `0600` in a `0700` directory.
- Backfill read 5 real probe sessions through `ctx.sessionQuery` (real DSH event shapes), 3 with capturable events:
  216 events (9 user, 5 assistant, 101 tool_call, 101 tool_result), 432 stream entries (conversation + project
  stream each).
- `project_id = workspace:7ab07f52-…` — the same workspace id the web client shows for the `dshfiles` workspace,
  so `workspaceRegistry.resolveByPath(realpath(cwd))` works in the live Host.
- Subagent sessions (bare uuid ids) carry `parent_conversation_id = session-…`.
- Bounds hold: tool_call ≤ 2,043 B, tool_result ≤ 16,367 B (cap 16 KiB + marker).
- FTS cursor at 216: the search pipeline indexed everything in the live Host.
- 218 of 432 leaves built (verbatim / concat); the rest need a summary. No summarizer route was available at the time (no
  explicit setting, and the since-removed session-route fallback had seen no turn), so those jobs fail and retry on the
  backoff timer. Views therefore stay empty until a route exists — by design the barrier renders them raw, but the
  compact injected view waits for built leaves.

## Live turns (second pass, same day)

Run with a boot-only overlay (`dsh --profile probe --patch <scratch>/probe-overlay.yml`, nothing written to the
profile): agent default model `codex-emialex` / `gpt-6-luna` / effort `low`; `dshfiles-optmem` summarizer
`codex-emialex` / `gpt-6-luna` / `low`. The backfill database above was moved aside to
`~/.dsh/plugins/optmem.stage3-backfill/` (kept) so the turns started from an empty memory and cost few summaries.
Prompts were entered through the hidden browser pane (DOM input, no files written anywhere).

1. Thread `session-c656ddad…`: "In about 120 words, explain what a SQLite write-ahead log is…".
   - Captured live via `session/event`: user prompt + 773 B assistant reply, project `workspace:7ab07f52…`.
   - **Bug found:** two injected user-role messages were captured too (source kinds `agent-instructions`, 34 KB, and
     `skill-catalog`, 8 KB): the capture skipped only `runtime-context` and `compact-checkpoint`. Fixed by an
     allowlist (`user`, `goal`, `agent-message`, `subagent-settled`); regression test added. The two rows stay in
     this probe DB as legacy data.
   - **Bug found:** nodes stored `model = unresolved` — the engine copied `summarizer.model` once at creation.
     Fixed (getter); regression test added.
   - Real summaries through `ctx.llm`: leaf and merge nodes written by `codex-emialex/gpt-6-luna` (8 nodes, 1 clipped
     after retries; 11 earlier ones labelled `unresolved` by the bug above). Views reached `through_pos 4`.
2. Probe restarted with the fixed bundle; new thread `session-6042b77b…` in the same workspace:
   "according to your persistent memory, what did an earlier conversation in this project ask about? Then call
   memory_status once…".
   - `request/header.tools` contains `memory_context`, `memory_search`, `memory_status`, `memory_zoom`.
   - A `runtime-context` user message carries the block starting `Persistent memory (OptMem): …` with lines
     `0+1 … 3+1` from the first thread only (the reading thread's own lines are absent).
   - The model called `memory_search` (3 project hits) and `memory_status`, which reported
     `captureEvents=yes registerTools=yes injectContext=yes replaceContext=no resetPerTurn=no`, `skipped 5`
     (injected messages now dropped), `summarizer gpt-6-luna (effort low): via codex-emialex`, settings read from the
     `dshfiles-optmem` entry. The answer named the earlier WAL question.
   - Tool calls and results of this turn were captured; no "did not activate" line on either boot.

## Proven / not proven

| Claim | Status | How |
|---|---|---|
| Plugin activates in a real DSH host | proven | profile:boot, plugins page, two overlay boots |
| Live `session/event` capture, idempotent keys, workspace project | proven | rows of both live threads |
| 4 memory tools in the live tool list and callable by the model | proven | `request/header.tools`, captured tool calls/results |
| Compact view injected, own-conversation lines omitted | proven | `runtime-context` message in the second thread |
| Real LLM summaries (leaf + merge) at effort low | proven | nodes with model `codex-emialex/gpt-6-luna` |
| Command registration, backfill through `sessionQuery`, subagent parent links | proven | first pass above |
| Summarizer unavailable path (`[pending summary]`, status message) | tests only | route resolver tests |
| Cross-turn cache-read % / prompt size | not measured | Stage 5 |
