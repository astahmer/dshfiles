# Persistent agents

Resume here: Phases 1 and 2 shipped in `plugins/@dshfiles/agents` and `@dshfiles/backlog`; Phase 3 is
in progress — see the [Phase 3 task table](#phase-3-tasks) and check off a row only after its
verification commands are green. Research and verified DSH facts live in [research.md](research.md).

## Why

Today every piece of an “agent” lives in a different place and none of it is reusable: the
model/account is a composer picker, the tool profile is an Agent preset chosen when a thread is
created, the task and context are retyped into the first message, and memory belongs to a project
or thread. Starting the same kind of work twice means re-typing the same preamble, and the backlog
item that asked for it (`b:119`) can only link a thread after opening a dialog.

The reference products (Grok Bot, OpenAI Dots — [research.md](research.md)) make the agent the
entry point: a named, persistent configuration you mention. This plan brings that to dshfiles
without a second runtime: an **agent is saved configuration that dispatches an ordinary DSH
Session**.

## Goal

`@handle` anywhere a thread is created (backlog item comments first) starts work with that agent's
identity, instructions, model route and tool preset — and a shipped built-in `@dsh` agent makes
that work with zero setup.

## What an agent is

| Field           | Meaning                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `handle`        | Unique slug, `^[a-z][a-z0-9-]{0,31}$`, mentioned as `@handle`.                                  |
| `name`, `glyph` | Display name and one emoji/character for lists and menus.                                       |
| `description`   | One line for the `@` menu and the panel list.                                                   |
| `instructions`  | Markdown injected into the opening message of every thread the agent starts (max 8 KB).         |
| `preset`        | Agent preset id (`standard`, `ptc`, `minimal`, `cordis`) or `null` for the Host default.        |
| `route`         | `{ provider, model, reasoningEffort? }` or `null` for the catalog default (the harness itself). |
| `enabled`       | Disabled agents stay listed but are not offered or dispatched.                                  |
| `builtIn`       | True only for the seeded `dsh` agent; it can be edited but never deleted.                       |
| `usage`         | `lastUsedAt`, `threadCount` — bumped on dispatch.                                               |

Storage is a Host-owned storage-domain table (`agents`), like prompt-stash and backlog, so every
browser and every agent reads the same rows.

## Decisions

1. **One handle namespace; a model is a property of an agent.** `@reviewer` may pin
   `codex-alex2/gpt-6-luna`; the built-in `@dsh` pins nothing and therefore means “the harness
   itself”. There is no separate raw `@model/:account` mention type — two mention kinds for one
   concept would make the `@` menu ambiguous and double the parsing.
2. **An agent is configuration, not a runtime.** Dispatch creates an ordinary Session and reuses
   the existing create → select model → rename → prompt → link sequence. No new loop, tools or
   storage of conversation state.
3. **Dispatch belongs to thread-creation surfaces.** A preset is chosen only at
   `sessions.create` and nothing can re-compose a live Session (research.md gap 1), and there is no
   send-time routing hook (gap 2). So `@handle` dispatches from backlog comments, the “Start
   thread…” dialog and the Agents panel; inside a running thread the same text stays a mention the
   agent reads.
4. **Instructions ride the opening message.** With no mid-thread system-prompt injection (gap 3),
   a dispatch prompt is `instructions` + the user's text, bounded by the existing 4,000-character
   message limit. The panel warns when an agent over-budget.
5. **One Host contract, imported.** `@dshfiles/agents` publishes `./contract` (schemas, mention
   parsing, opening-message composition) through a dshx `modules` entry so backlog imports the
   same rules instead of restating them.
6. **Every verb is a tool.** `agents_list`/`agents_get` are read-only; `agents_save` says it runs
   only when the user asked; `agents_remove` takes an explicit destructive opt-in with no default.

## Architecture

```mermaid
flowchart LR
  subgraph Host
    A[(agents storage domain)] --> AH[agents API + tools]
    P[agentPresets service] --> AH
  end
  subgraph Client
    AH --> AP[Agents panel<br/>list · edit · start thread]
    AH --> AM[@ mention source<br/>@name · @agent:]
    AM --> CO[chat composer]
    AM --> BC[backlog comment / reply]
  end
  BC -->|@handle + text| D[dispatch]
  AP -->|start thread| D
  D -->|sessions.create(agentPreset)| S[ordinary Session]
  D -->|selectModel(route)| S
  D -->|prompt(instructions + text)| S
  D -->|link item ↔ thread| B[(backlog item)]
```

## Surfaces

| Surface                            | Behavior                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backlog item comment / quick reply | `@handle text` dispatches a thread for the item on that agent; the comment is recorded and the thread linked. Unknown handle → plain comment. |
| Backlog “Start thread…” dialog     | Agent picker preselects its route, preset and opening message.                                                                                |
| Agents panel (sidebar)             | List, create, edit, enable/disable, delete (except built-in) and start a thread from an agent.                                                |
| `@` menu (any composer)            | Agents section; `@agent:`/`@a:` scopes to agents; picking inserts `@handle ` as text.                                                         |
| Agent tools                        | `agents_list`, `agents_get`, `agents_save`, `agents_remove`.                                                                                  |

## Phases

| Phase | Scope                                                                                                                  | State       |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0     | Research: reference products, existing DSH capabilities, gaps                                                          | done        |
| 1     | `@dshfiles/agents`: contract, storage, API, tools, panel UI, seeded `@dsh`, `@` source; mentions scope hand-off; tests | done        |
| 2     | Backlog dispatch from the item comment box, agent fields on the start-thread request, docs, reach steps                | done        |
| 3     | Memory scope, comment-box autocomplete, thread history + durable usage, routines bridge, delegation targets            | in progress |

### Phase 3 tasks

Five independent slices. Each lands as one described revision, and each keeps a rule: no new
runtime, no copied schema, an agent tool for every human verb, and verification in the plugin's
own tests plus its Gherkin journey.

| #   | Task                     | Owner plugins                                       | Scope of the slice                                                                                                                                                                                                                                                 | Verify                                                        | State |
| --- | ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----- |
| 1   | Per-agent memory scope   | `@dshfiles/agents`, `@dshfiles/memory`              | An agent owns a memory scope (`agent:<handle>`); a thread it started renders the project start block **plus** notes filed under that scope. Memory keeps one store and one `notes.scope` column, no new schema; the scope is resolved through the agents contract. | memory + agents unit tests, `memory_start_block` reach step   | done  |
| 2   | Comment-box autocomplete | `@dshfiles/backlog`                                 | Typing `@` in an item's comment box completes agent handles inline, and the capture/reply composer lists agents next to items and threads; `@b:`/`@t:`/`@f:` keep their own scope and picking inserts `@handle `.                                                  | backlog unit tests, the `agents.comment-autocomplete` journey | todo  |
| 3   | Agent history + usage    | `@dshfiles/agents`                                  | A dispatch records its Session in the agent's `threads` table; the panel lists those threads and opens one; usage counters are read from storage so they survive a Host restart.                                                                                   | agents store/API tests, the `agents.thread-history` journey   | todo  |
| 4   | Routines bridge          | `@dshfiles/agents`                                  | An optional routine line per agent is carried into the opening message (the thread's own `schedule_*` tools create the reminder) and the panel lists the Host's session-scoped schedules for that agent's threads. No scheduler, no new timer.                     | agents tests, schedule catalog read in the panel              | todo  |
| 5   | Delegation targets       | `@dshfiles/agents`, `@dshfiles/agent-communication` | Each agent declares which agent handles it may message and whether it may delegate at all; the messaging send path refuses an unlisted target. Subagent-tool enforcement has no Host hook, so it is recorded in `plans/dsh-host-gaps.md`.                          | agents contract tests, agent-communication guard test         | todo  |

### Phase 3 checklist

- [x] `plans/persistent-agents/README.md` carries this table and the resume line (its own revision)
- [x] Task 1: agent `memoryScope` + memory start block scoped to the thread's agent, one store, tests
- [x] Task 2: inline `@` agent completion in the backlog comment box and composer, scope prefixes preserved
- [ ] Task 3: durable `threads` table, `agents_threads` tool, panel history with open, usage after restart
- [x] Task 4: routine field carried into the opening message, panel routine + schedule list
- [x] Task 5: delegation config, enforcement in the messaging send path, Host gap for subagents
- [ ] Rebuild `@dshfiles/ui-styles` and the touched plugins; refresh the `agent-registry` screenshot
- [ ] `DSHX_E2E_ONLY=agents node --run check:e2e` green, then Rebase onto `main`

### Phase 1 checklist

- [x] Plan and research saved under `plans/persistent-agents/`
- [x] `src/agent.ts`: schemas, handle rules, mention parsing, opening-message composition (unit tests)
- [x] `src/store.ts`: storage domain, seed the built-in `dsh` agent, list/save/remove/resolve
- [x] `src/api.ts` + `src/host.ts`: Host methods and their tools
- [x] `src/contract.ts` + dshx `modules` entry, for backlog
- [x] `src/client-entry.tsx` + panel/editor: Agents sidebar page
- [x] `@` source with `@agent:`/`@a:` scope; mentions plugin ignores that scope
- [x] `dshx.features.json` reach steps, `probe` profile sync, unit + boot checks
- [x] `docs/screenshots/agent-registry.png` captured from a scratch DSH (`node --run screenshots -- --only agents`)

### Phase 2 checklist

- [x] `StartThreadRequest` carries an optional agent (preset + route); `provider`/`model` became nullable
- [x] The start-thread dialog picks an agent (`Thread agent`), hiding the account/model fields and composing the task
- [x] Backlog comment box dispatches a leading `@handle`, falling back to a plain comment
- [x] Dispatch records the comment and links the item to the started thread
- [x] Gherkin journeys: `agents.comment-dispatch` (capture item → comment `@dsh look at b:1` → the thread opens with the agent instructions and the item links it) and `agents.create-agent` (create an agent in the panel, keep its instructions across a reselect)
- [x] Plugin READMEs + `docs/agent-tool-parity.md` row + `plans/README.md` entry

## Out of scope (deliberate)

- Re-composing a live Session's preset or system prompt — impossible on stock DSH (gaps 1 and 3).
- Any second agent loop, tool registry or conversation store.
- A scheduler, a cron evaluator or a delivery timer of our own: routines ride DSH's `schedule_*`
  tools and session-scoped schedules.
- A messaging runtime: delegation rules constrain `dshx_comm_*`, they do not replace it.
- Restating memory's schemas or forking its store for an agent: the agent owns a scope name,
  memory still owns every table.

## Acceptance

- `@dsh` in a backlog comment starts a thread on the Host default route with the item linked,
  titled and carrying the comment as its opening prompt; `@reviewer` does the same with that
  agent's instructions, preset and model.
- An unknown handle, a disabled agent or a bare `@` falls back to today's behavior (plain comment).
- Agents panel CRUD persists on the Host, survives reload and is visible from a second browser.
- The built-in `dsh` agent cannot be deleted; `agents_remove` requires its explicit opt-in.
- `@agent:` scopes the `@` menu to agents; `@t:`, `@f:`, `@b:` still list only their own kind.

## Verification

```sh
node --run check:screenshots
node --run screenshots -- --only agents          # refresh docs/screenshots/agent-registry.png
pnpm --dir plugins/@dshfiles/agents test
pnpm --dir plugins/@dshfiles/agents typecheck
pnpm --dir plugins/@dshfiles/agents build
pnpm --dir plugins/@dshfiles/backlog test
node --run check:diff
DSHX_E2E_ONLY=agents node --run check:e2e        # both agents journeys
node tooling/dshx/scripts/browser-tasks.mjs --write   # after feature files change
```

## Decisions log

- 2026-10-21 — One handle namespace for agents; models/accounts are agent properties, not a
  separate mention kind (asked and answered on `b:119`).
- 2026-10-21 — Dispatch is configuration-driven and reuses the backlog start-thread sequence; no
  second runtime (handoff constraint).
- 2026-10-21 — Instructions ride the opening message; agent scope is applied at thread creation
  because DSH cannot re-compose a live Session.
