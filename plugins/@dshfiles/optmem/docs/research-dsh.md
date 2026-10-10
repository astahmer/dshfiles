# DSH internals for OptMem (condensed from three research passes, 2026-10-09)

Paths: **F** = `tooling/dsh-core` (fork, copied from tag dsh-v0.2.0-rc.2 + runtime-driver additions);
**G/I** = installed rc.2 packages under `~/.local/share/pnpm/global/v11/…/node_modules/@deepseek-ai/<pkg>/lib/`.
[C] confirmed in code, [I] inferred. Full helper reports were not saved; re-derive details from the citations.

## Versions / install
- Installed DSH 0.2.0-rc.2 (global pnpm). Fork session format v5 vs installed v4 (only adds `runtimeBinding`). [C]
- Profiles `~/.dsh/profiles/<name>/{package.json,cordis.patch.yml}`; layers: bundle patches → profile patch →
  `$DSH_HOME/cordis.patch.yml` → `--patch` (dsh profile-boot). `pnpm profile:sync --profile probe` links owned bundles.
  `web` profile is reconciled by nixfiles (only its marked block). Verify in `probe`, never restart `web`. [C]

## Agent loop and context assembly (F/agent-loop/src/agent.ts)
- Per step: `preStep` :278 assembles the system prompt (`systemPrompt.assemble` :283), runs the `agent/pre-step`
  waterfall :287; `step` :593 → `buildRequest` :855 with `messages: session.deriveMessages()` (:927) — the FULL
  session surface every call; only `surfaceOp:'replace'` (compaction) trims it. Requests are deep-frozen. [C]
- System prompt: sections (`definePromptSection`, sorted by order then name; SECTION_ORDERS −1000…10200) render into
  node 0; contexts become a durable user message written only when their text changes. Stable prefix: a changed
  prompt rewrites node 0 unless the route declares `systemPromptUpdate:'in-history'` (deepseek does; pi-ai routes
  don't). [C]
- Caching: deepseek = server-side automatic prefix cache (no cache_control); pi-ai sets `cache_control`
  (anthropic) / `prompt_cache_key` (openai) from `sessionId` + `cacheRetention`. [C]

## Seams (none replaces messages per request)
| Seam | Can do | Cite |
|---|---|---|
| `agent/pre-step` (waterfall) | replace/reject NEW step messages, `startsRequestSeries:true` | F/agent/src/runtime-types.ts:113-120 |
| `agent/request` (waterfall) | config only, cannot mutate messages | runtime-types.ts:322-338 |
| `system-prompt/assemble` | sections/contexts/tools/variables | dsh-system-prompt index.js:355 |
| `llm/stream` (waterfall) | wrap/short-circuit every model call; `next()` ignores args, so must call `ctx.llm.stream({...opts, messages})` itself (log won't reflect sent messages) | dsh-llm index.d.ts:32-46; cordis waterfall index.js:317 |
| `session.append(type, data, {surfaceOp:{op:'replace',startSeq,endSeq}, sourceEventSeqs})` | DURABLE history replacement (compaction pattern) | dsh-compaction-basic index.js:596-662 |
- **Full-mode options:** (a) durable replace via `agent/pre-step` (no fork; persists in log); (b) `llm/stream`
  short-circuit (no fork; log mismatch, loses prepared-call binding); (c) **fork change** (preferred, ~10 lines):
  new waterfall `agent/request-messages` in F/agent/src/runtime-types.ts Events, called in `step()` right after
  `buildRequest` (agent.ts:681), rebuild frozen request if messages changed, optional `request/messages-override`
  log event; watch `toolHistory` (:937). Fork is only active via `dsh-core-runtime` (scratch profiles). [I]
- A proxy LLM route (`registerAdapter(['optmem-proxy'], …)` delegating to a real provider) is another option;
  loses reasoning replay across adapters. [I]

## Tools, prompts, events (plugin side)
- Tools: `defineTool({name, description, parameters: ValueSchemaSpec, output:{schema, render}, execute(args, exec)})`
  in `defineHost({tools})` (global). `exec` has callId, agent?, signal, deferContext, concludeTurn — no session id;
  use `exec.agent.id`, cwd `agent.session.header.cwd`, parent `ctx.sessions.get(id)?.header.parentSession`.
  Example: plugins/@dshfiles/agent-communication/src/host.ts:46-185. [C]
- Prompts: `definePromptSection`/`definePromptContext` in `defineHost({prompts})`; no owned plugin uses them yet. [C]
- Events: `session/event` (every committed append; goal-stall-guard host.ts:66-104 switches on turn/start,
  user/message, assistant/message, turn/end), `agent/created|disposed|pre-step|request-error|turn-stopping`,
  `tools/pre-execute|execute|post-execute|result`, `subagent/start|end`, `llm/stream`. Cancellation = `exec.signal`
  + `turn/end{reason.kind:'aborted'}`. [C]
- Tool permissions: `tools/pre-execute` → allow|deny|ask|cancel; `ask` → approval service. Don't touch. [C]

## Persistence
- One append-only event log per session: `~/.dsh/sessions/<projectKey(cwd)>/<id>/session.v4.jsonl.zstd`,
  header line `{id, createdAt, cwd, parentSession, origin, delegationDepth, agentPreset, isSeeded}`, then events
  `{type, seq (contiguous from 0), time, data, surfaceOp?, sourceEventSeqs?}`. fsync per append batch. zstd is
  multi-frame (split on `28 B5 2F FD`). Subagents have their own logs (`parentSession`, `origin:'subagent'`). [C]
- Read APIs: `ctx.sessionQuery` (listSessions, readSession, listEvents, filterEvents, readSurface, traceSession,
  readEvent window) — preferred; `ctx.sessionPersistence` raw; `ctx.sessionProjections`. [C]
- `dsh-session-query-sqlite` uses **`node:sqlite` DatabaseSync + FTS5** (`persisted_docs` unicode61) but is
  configured `:memory:` / `openAt: never` → search disabled. So node:sqlite with FTS5 works in the DSH runtime. [C]
- Ids: `session-<uuid>` (top level), bare uuid (in-process subagents). Projects: `ctx.workspaceRegistry`
  (`resolveByPath(realpath cwd)`, web bundle only). [C]
- Compaction: `dsh-compaction-basic` at 80% context (`agent/pre-step`) + on overflow; writes
  `compaction/start|summary|end` and a replacing `user/message` (`source: compact-checkpoint`). Replaceable
  `ctx.compaction` service. [C]
- Plugin storage: `ctx.storageDomain` (`defineDomain`, JSON files under `~/.dsh/storages`) or a file under
  `dshHomePath('plugins', '<name>')` (no per-plugin dir API). For SQLite: `dshHomePath('plugins','optmem','optmem.db')`. [C/I]

## Ranked integration seams
- **Compat mode:** host plugin; capture via `session/event` (+ backfill via `sessionQuery`); tools via `defineTool`;
  bounded injection via a `definePromptContext` (changes only when its text changes → cache-friendly) or a tool-only
  approach; SQLite via `node:sqlite`. No fork needed.
- **Full mode:** fork waterfall `agent/request-messages` (runs only under dsh-core-runtime/probe), fallback (a)
  durable `agent/pre-step` replace. Must prove fresh-turn replacement at runtime before claiming support.

## Blockers / unknowns
- Not yet run: `node -e` FTS5 probe with the exact node DSH uses (fnm official build) — likely fine since
  dsh-session-query-sqlite uses it.
- Whether the installed agent-loop matches the fork exactly (not diffed).
- Full mode needs the fork path (dsh-core-runtime) which is scratch-profile only today.
