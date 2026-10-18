# Memory citation preview flake

## Scope and guardrails

Find why the `memory.reference-preview` journey intermittently leaves the inline preview card at
`Loading memory…`. Keep the DSH Host authoritative, verify on a uniquely named scratch DSH
(`dshx dev up --name <topic>`), never touch `127.0.0.1:3080` or `~/.dsh`, never push, and do not
weaken the journey to make it pass — the step already legitimately re-asks while the card is gone
because a scroll closes it by design.

**Resume here:** run `pnpm check:e2e memory` twice (expect `2 passed, 1 failed` in roughly half of
the runs), then instrument the failing run — see *Next instrumentation*. Nothing in the product read
path is known to be broken.

## Progress

| Track                                   | Status   | Evidence / next action                                                                                                              |
| --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Reproduce intermittently                | Complete | Six runs of `pnpm check:e2e memory` on one tree: 4 failed / 2 passed (pass rates seen: 3/0, 2-1, 2-1, 2-1, 3/0, 2-1)                |
| Prove it predates our work              | Complete | Identical failure from the untouched shared checkout (`~/dev/dshfiles`, no local edits)                                             |
| Characterise the failure state          | Complete | Card is open with the right title and `Open in Memory`, text stuck at `Loading memory…` — pending, not errored, not closed          |
| Verify the product path answers         | Complete | Two live scratch runs with a seeded note render the note text; the catalog reach passes                                             |
| Rule out the normalization gate         | Complete | Bounding `projectNormalization` at 2 s did not change the pass rate (fail/pass/fail); change reverted                                |
| Rule out seeding and our card work      | Complete | Seeding immediately after boot reproduces fine live; the flake predates the citation-card revisions                                  |
| Find the unanswered hop                 | Open     | Instrument the RPC (tracing and/or a Host debug log at the `preview` handler), then state one falsifiable root cause                |

## Symptom

Scenario `@scenario:memory.reference-preview` ("Open a cited note inline from a conversation"):
the citation link is clickable and the card opens with `Memory · n:1`, then stays at `Loading memory…`
until the assertion times out. The other two memory scenarios (panel notes, panel usage) pass in the
same run, so the Host, the store and the seeded note are all healthy.

## Evidence

- Failing state, from Playwright diagnostics: `popover-content[data-dshfiles-memory-preview]` is open
  with `unexpected value "Memory · n:1Loading memory…Open in Memory"`; the page snapshot shows the
  conversation with the citation in place.
- `readMemory` for a note id is synchronous (`store.note(id)`), so the read cannot hang by itself; the
  unanswered hop is the API call.
- Product path verified: seed a note into a live scratch profile and hover/click the citation —
  `dshx dev up --plugin @dshfiles/memory --plugin @dshfiles/thread-sidebar --name <topic>`, then
  `openMemoryStore({ path: '<home>/plugins/memory/memory.db' }).addNote({...})` (a second SQLite
  connection, the way the journey seeds it), then `dshx dev open memory/memory-reference-preview`.
  The card renders `n:1 [project, repo, stated] 2026-10-18 Deploys need the ops approval label.`
- The reach `memory/reference-preview` asserts the *no note* branch and the Open-in-Memory button, so
  it cannot be used to assert a seeded note without editing the catalog.

## Ruled out

- **Normalization gate.** `withRuntime`/`withMemory` await `projectNormalization` (the JJ-workspace
  backfill). Bounding that wait at 2 s changed nothing about the pass rate, so it is not the cause.
  It is still a defensible hardening if a read is ever seen hanging on a blocked backfill.
- **Seeding race.** The note is written by a second SQLite connection while the Host has the file open;
  seeding immediately after boot resolved fine twice in a live instance.
- **The citation-card revisions** (anchor follow, whole-token link). The flake reproduces on the
  untouched checkout.

## Next instrumentation

1. Capture a failing run with Playwright tracing so the RPC behind the preview is visible, not just the
   DOM. The e2e harness keeps screenshots and `error-context.md`; a trace needs to be enabled for the
   generated project.
2. Add a temporary debug log at the Host preview boundary (`plugins/@dshfiles/memory/src/host.ts`,
   the `preview:` handler) and *preserve* the scratch host log for a failing run — the harness deletes
   its profile on cleanup, so copy it or reproduce through `dshx dev` with the same sequence.
3. Compare a failing run with a passing one on three questions: did the RPC reach the Host, was the
   memory plugin active at that moment, and was the client query `fetching` (queued/paused) or `idle`.
4. Only then write the falsifiable root cause and fix the source of truth.

## Where the code is

- Journey: `tooling/dshx/e2e/features/memory.feature`, `tooling/dshx/e2e/support/plugin-journeys/memory.steps.ts`
- Client: `plugins/@dshfiles/memory/src/memory-reference-links.ts`, `memory-reference-overlay.tsx`,
  `memory-reference.ts`, `memory-anchor.ts`
- Host: `plugins/@dshfiles/memory/src/host.ts` (`preview` → `withRuntime` → `runtime.preview`),
  `plugins/@dshfiles/memory/src/runtime.ts` (`readMemory`)
