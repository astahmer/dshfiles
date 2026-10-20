# Remote thread UX: host inventory and "waiting on host" visibility

Owner plugin: `@dshfiles/multi-host` (`plugins/@dshfiles/multi-host`). No core patch, no new plugin, no new transport.
If something cannot be done with the existing Host methods and the remote runtime's supported RPCs, write the gap in
`plans/dsh-host-gaps.md` and stop that slice.

**Resume here:** Task 3, verification.

## Why

The research in "Compare Remote Features Across Projects" found that remote execution is solid but the local view of
remote threads is thin. Two cheap gaps:

1. Threads created directly on a host (in its own UI, or by another machine) never show up here. The Host half already
   fetches them: `runtimeStatus` in [host.ts](../../plugins/@dshfiles/multi-host/src/host.ts) calls the remote
   `session.list` and returns up to 500 `sessions` per runtime, decoded in
   [api.ts](../../plugins/@dshfiles/multi-host/src/api.ts) (`sessionSchema`). No client component renders them.
2. When a remote turn stops on a question or an approval, the local view just shows "Working" forever.
   [transcript.ts](../../plugins/@dshfiles/multi-host/src/transcript.ts) only handles turn, title, header, message and
   tool events.

Out of scope: streaming the transcript instead of polling (measure first), deployment and service ownership
([plans/multi-host](../multi-host/README.md)), session handoff between machines, answering approvals from here.

## Progress

| Task | State |
| ---- | ----- |
| 1.1 Inventory query | done |
| 1.2 Inventory list in the remote threads panel | done |
| 1.3 Tests for inventory merge | done |
| 2.1 Pending detection in `reduceTranscript` | done |
| 2.2 "Waiting on host" banner | done |
| 2.3 Tests for pending detection | done |
| 3 Verification (unit, build, boot, e2e, loopback scratch) | todo |
| 4 Docs + revisions | todo |

## Slice 1: remote inventory

### 1.1 Inventory query

- File: [destination/queries.ts](../../plugins/@dshfiles/multi-host/src/destination/queries.ts). `multiHostQueries.status`
  already exists (keyed per runtime, takes a `refetchInterval`). Reuse it; do not add a Host method.
- Pure helper (new file `src/inventory.ts`, exported only for the view and its test):
  `mergeInventory({ startedHere, statuses })` returns one list of rows
  `{ runtimeId, sessionId, hostName, title?, cwd?, running, updatedAt, startedHere }`.
  - `startedHere` = `api.threadList()` rows (what the view already shows).
  - `statuses` = successful `runtimeStatus` results for every runtime in `directory.data.runtimes`.
  - Dedupe key: `runtimeId + '\u0000' + sessionId`. A thread started here keeps its stored title and `startedHere: true`.
  - Drop `blank: true` sessions (never received a message).
  - Sort by `updatedAt` descending.
- Remote session rows carry no title. Check `sessionRowSchema` in host.ts: if the remote `session.list` item carries a
  title field, add it to `sessionRowSchema`, the Host mapping and `sessionSchema` in api.ts as an **optional** field
  (an old Host still answers without it). Otherwise display the `cwd` basename.

### 1.2 Inventory list in the remote threads panel

- File: [remote-thread-view.tsx](../../plugins/@dshfiles/multi-host/src/remote-thread-view.tsx), the `ref === null`
  branch (the "Remote threads" list).
- Fetch status only while that list is mounted: `useQueries` over the runtimes, `refetchInterval: 30_000`, `retry: false`.
  Never poll status from the open-thread view or the sidebar.
- Group rows by host. Each row: server icon, title (or cwd basename), a "Working" spinner when `running`, relative
  `updatedAt` (`relativeTime` from `@deepseek-ai/dsh-client-ui-primitives`), and a muted "started on host" badge when
  `startedHere` is false. Clicking calls the existing `openRemoteThread({ runtimeId, sessionId })`.
- An offline host (`ok: false`) shows one muted line "<host> unavailable: <message>" and still lists its threads that
  were started here.
- Keep the existing empty-state copy when nothing is listed.
- Follow the `plugin-ui` skill: `dshx:` prefixed static classes, semantic colors, rebuild `@dshfiles/ui-styles` after
  class changes.

### 1.3 Tests

- `tests/inventory.test.ts` (vitest, no mocks, plain data):
  - the same `runtimeId/sessionId` in both sources appears once, with `startedHere: true` and the stored title;
  - the same `sessionId` on two different runtimes appears twice;
  - blank sessions are dropped;
  - a failed status keeps that host's started-here rows;
  - order is `updatedAt` descending.

## Slice 2: "waiting on host" visibility

Fact checked on 2026-10-20 across 400 local session logs: DSH writes no approval-request or question-request event.
Only `approval/policy` and `permission/preset` exist. A question or approval shows up in the log as a `tool/call` with
no matching `tool/result` yet, while the turn is still running.

### 2.1 Pending detection

- File: [transcript.ts](../../plugins/@dshfiles/multi-host/src/transcript.ts). Extend the return value with optional
  `waiting?: { kind: 'question' | 'tool'; tool: string; since: number }` (seq of the call).
- Rule: after the loop, if `running` is true and the **last** `tool/call` has no `tool/result`:
  - `kind: 'question'` when its name is `ask_user_question` or ends with `__ask_user_question`
    (MCP-prefixed names such as `mcp__dsh__ask_user_question`), or is `ask_parent_question`;
  - otherwise `kind: 'tool'` (a long command or a pending approval: the log cannot tell them apart).
- Add `waiting` to the transcript schema in api.ts as optional, and pass it through in the Host's `threadTranscript`.
  The client must treat a missing field as "not waiting".

### 2.2 Banner

- In the open-thread view, above the composer:
  - `question`: an `Alert` "The agent on <host> is asking a question. Answer it in the host's DSH." plus the existing
    **Host UI** button.
  - `tool`: show it only when the same pending call has lasted more than 60 s (compare the poll time against when the
    view first saw that `since` seq; keep this in component state, not storage): "Waiting on <tool> on <host>. It may
    need an approval there." plus **Host UI**.
- No approve/answer button. Answering stays in the host's own UI.

### 2.3 Tests

- Extend `tests/transcript.test.ts`: an open `ask_user_question` call while running gives `waiting.kind === 'question'`;
  the same call followed by its result gives no `waiting`; an open `bash` call gives `kind: 'tool'`; a `turn/end`
  clears `waiting`.

## 3. Verification

Run from `plugins/@dshfiles/multi-host` unless noted. Never restart or reload the live DSH on `:3080`.

1. `pnpm exec vitest run tests/inventory.test.ts tests/transcript.test.ts`
2. `node --run typecheck`, `node --run build`, then
   `fnm exec --using="$(cat ../../../.node-version)" node -e "import('./dist/index.js')"`.
3. Rebuild `@dshfiles/ui-styles` if any class changed.
4. From the repo root: `node --run check:diff`, then `pnpm run check:e2e multi-host` (headless, scoped; no `--force`).
5. Loopback scratch, following the `verify-dsh` skill: one scratch DSH as "local" and a second scratch DSH on `:3199`
   registered as a host through the existing loopback connector (see `tests/loopback.test.ts` and
   [docs/validation.md](../../plugins/@dshfiles/multi-host/docs/validation.md)). In the remote one, start a thread
   directly; confirm it appears in the local list with the "started on host" badge, opens and accepts a reply. Then ask
   the remote agent something that makes it call `ask_user_question`, and confirm the question banner. Screenshot
   both states with `dshx dev shot`.
6. Add a scenario to `tooling/dshx/e2e/features/multi-host.feature` for the inventory row if the loopback fixture
   supports it, then `node tooling/dshx/scripts/browser-tasks.mjs --write`.

## 4. Docs and revisions

- Update [plugins/@dshfiles/multi-host/README.md](../../plugins/@dshfiles/multi-host/README.md) (what the remote panel
  lists, what the banner means) and the `dshx.features.json` entries if a user path changed.
- Agent-tool parity: no new user verb is added (listing reuses `runtimeStatus`, which already has a tool binding;
  check that it does and note it in `docs/agent-tool-parity.md` if not).
- One `jj` revision per slice, Conventional Commit titles, for example
  `feat(multi-host): list threads started directly on a host` and
  `feat(multi-host): show when a remote turn waits on a question`, each with a why body and the `Co-Authored-By`
  trailer. `jj describe -m …` then `jj new`. Do not push and do not move `main`.
- When everything is verified, run the `complete-plan` skill on this plan.
