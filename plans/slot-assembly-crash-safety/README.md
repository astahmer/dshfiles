# Slot assembly crash safety plan

> **Status: proposed (2026-10-19).** Nothing implemented yet; the investigation below is read-only evidence from the
> installed 0.2.1-rc.2 runtime.
> **Resume here:** **S0** (record the Host gap and a reproduction recipe), then **S1** (prove a second `root`
> registration is a legal shadowed survivor). Both are read-only/spike work; no product code until S1 answers
> [Open question 2](#open-questions).
>
> **Handoff (2026-10-19).** Written by the linearization thread (`session-df0bd66d-19c7-465e-864a-a9dabd21f45b`,
> now archived); the owning thread is `session-a40883ce-155a-4b55-9b4a-11f3cff18d6f` ("Complete the slot-assembly
> crash safety plan"). Start with `jj_thread_isolate`, follow `AGENTS.md`, and prefer the touched plugin's own e2e
> script (`pnpm --dir plugins/@dshfiles/<name> run test:e2e`) — the root `node --run check:e2e <plugin>` currently
> expands to every plugin and takes about an hour.

## Progress

| Slice                                              | State       | Evidence |
| -------------------------------------------------- | ----------- | -------- |
| S0 Host-gap row + reproduction recipe              | not started | —        |
| S1 fallback-entry spike (SlotCore semantics)       | not started | —        |
| S2 fallback `root` entry with a recovery card      | not started | —        |
| S3 window error listener for `SlotAssemblyError`   | not started | —        |
| S4 scratch-DSH crash reproduction + survival proof | not started | —        |
| S5 docs (plugin README, native-override note)      | not started | —        |

## Context

- **Symptom.** On 2026-10-18, 22:55–00:40 (+02:00), the live Web UI on `127.0.0.1:3080` went blank repeatedly while
  the linearization rebuilt 46+ `link:`-installed client bundles. The Host stayed healthy the whole time (other
  agents kept working); only the browser application died, and only a manual reload brought it back.
- **Console.** `Uncaught SlotAssemblyError: renderSlot('root') before any 'root' registration (boot order)` at
  `RootOutlet (client.js:1240)`, i.e. a React render throw that unmounted the tree.
- **Mechanism (installed `@deepseek-ai/dsh-client-ui-renderer@0.2.1-rc.2`, `lib/client.js`):**

  | Step | Where                                                                          | What it does                                                                                                                                                                                                                                                        |
  | ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1    | `RootOutlet` (`lib/client.js:1233`)                                            | live `root` entry → render it; registrations exist but none live → render `<div data-slot-error="root">`; **zero registrations → `throw new SlotAssemblyError(...)`**                                                                                               |
  | 2    | `SlotErrorBoundary` (`:631`), `FactoryErrorBoundary` (`:648`)                  | catch per-entry crashes and render `data-slot-error`, but `getDerivedStateFromError` **rethrows `SlotAssemblyError`** ("Renderer assembly failures that must escape component error boundaries")                                                                    |
  | 3    | `SlotCore` (bundled in `@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`) | the `root` record is created **built-in** (`{ kind: 'single', scope: 'root' }`, `declaredBy: '(built-in)'`); `register()` appends an entry and sorts by `priority`; `entriesOfSlot()` elects the first non-abdicated entry, so later entries are shadowed survivors |
  | 4    | shell (`@deepseek-ai/dsh-web-frontend`)                                        | **no application-level error boundary**: the only `getDerivedStateFromError`/`componentDidCatch` in the bundle belong to vendored React; the `Failed to load plugins` card is the _boot_ overlay only                                                               |

- **Why zero registrations is reachable in this profile.** `root` has exactly one owner:
  `plugins/@dshfiles/frame-layout/src/native/client/index.ts:185` registers it, because
  `plugins/@dshfiles/frame-layout/cordis.patch.yml` disables the stock `ui-layout` row ("One owner, not two: both rows
  provide `ctx.layout` and register into the single `root` slot"). Slot registrations are collected through the
  caller's fiber effect, so disposing that one fiber leaves the slot with no registrations at all.
- **Trigger.** The Host's `hmr` entry recomposes the entries whose linked-package files changed on disk (see
  `AGENTS.md`, "Rebuilt plugins reach the browser over HMR"). Every `pnpm build`, `pnpm --dir plugins run check` or
  `node --run fmt` under a live Host rewrites bundles → recomposition → dispose + re-apply of `@dshfiles/frame-layout`
  → a gap with zero registrations → `RootOutlet` re-renders (it subscribes to the `root` slot version) → throw.
- **Boundary.** Stock DSH 0.2.1-rc.2 plus this repo's supported dshx/plugin surfaces. The renderer and the shell are
  core, so their halves of the fix are a **Host gap to record, never a patch**
  ([`plans/dsh-host-gaps.md`](../dsh-host-gaps.md)). Containment that we can build lives in an owned plugin.
- **Related.** `AGENTS.md` ("A reload is not a rollback", old Host under new client);
  [`docs/native-plugin-overrides.md`](../../docs/native-plugin-overrides.md) (we own the frame);
  [`plans/dsh-host-gaps.md`](../dsh-host-gaps.md) (new row for this gap).

## Goal

A recomposition, plugin disable/enable or bundle swap can never blank the Web UI: the page keeps rendering the live
owner, falls back to a recovery card, or reloads itself — with the real UI returning on its own once the owner
re-registers.

## Why

- Rebuilding bundles under a live Host is routine here; the current failure mode turns routine tooling into a dead
  window and a manual reload.
- The window is the only surface a human sees; agents keep running, so the crash is invisible until someone looks.
- The failure is a _transient gap_, not a bad composition: a reload proves the composition is fine. Treating a
  transient gap as fatal is the bug.

## Options

| Option                                                                                                                                                                  | Lives in                                                          | Verdict                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Register a **fallback `root` entry** that stays a shadowed survivor; when the primary is disposed the outlet renders the survivor (a recovery card) instead of throwing | owned plugin (supported)                                          | **primary** — turns "zero registrations" into "one live registration"                |
| Window `error`/`unhandledrejection` listener that recognises `SlotAssemblyError` and shows the card or reloads                                                          | owned plugin (supported; Cordis fibers outlive the React unmount) | **secondary** — belt and braces for a full composition teardown                      |
| Renderer tolerance for a transient gap (keep the last live entry until a replacement registers, or throw only after the composition settles)                            | DSH core                                                          | **gap** — record, do not patch                                                       |
| Shell-level recovery card around the renderer mount                                                                                                                     | DSH core (`dsh-web-frontend`)                                     | **gap** — record, do not patch                                                       |
| Second _frame_ owner (re-enable stock `ui-layout` as a fallback)                                                                                                        | profile composition                                               | **rejected** — "one owner, not two"; two frames is the conflict this profile removed |
| Rebuild discipline (never rebuild under a live Host)                                                                                                                    | docs/ops                                                          | mitigation only; the gap must still be survivable                                    |

## Slices

- [ ] **S0 — record the gap and the reproduction.** Add the `plans/dsh-host-gaps.md` row (renderer throws on zero
      `root` registrations; assembly errors escape every boundary; no shell-level recovery; a recomposition of the sole
      owner has no handover). Write the reproduction recipe next to it: touch
      `plugins/@dshfiles/frame-layout/dist/client.js` under a running scratch DSH, or disable/re-enable the plugin in
      Settings → Plugins, and watch the console.
- [ ] **S1 — spike: is a second `root` registration a legal survivor?** Read the SlotCore paths in the installed
      bundle and prove, in a scratch DSH: (a) a second registration is accepted (the slot is built-in, so no
      `registerFactory` child-declaration throw), (b) `entriesOfSlot('root')` still elects the primary while both are
      live, (c) disposing the primary makes the survivor the live entry, (d) disposing the fallback afterwards does not
      un-declare the primary's `children`, (e) the `priority` ordering that guarantees (b). Record the exact option
      shape in the plan.
- [ ] **S2 — implement the fallback entry.** A small client entry in an owned plugin that boots before/independently of
      the frame and registers `root` with a high `priority` (so it stays shadowed) and a recovery card: wordmark,
      "the layout owner is reloading…", a **Reload** button, and an auto-reload after N seconds if it stays live.
      Decide the owner in [Open question 1](#open-questions). It must not provide `ctx.layout` and must not render a
      frame.
- [ ] **S3 — window error listener.** Same plugin: listen for `error`/`unhandledrejection`, recognise
      `SlotAssemblyError` (name/message match, not `instanceof` across bundles), and route to the same card/reload path
      — covering the case where the fallback registration is gone too.
- [ ] **S4 — verification.** Reproduce the gap in a scratch DSH (`dshx dev up`, `verify-dsh` skill) with and without
      the fallback: without → blank page + console throw; with → recovery card, no blank, real UI back after the owner
      re-registers, and no manual reload. Then `pnpm --dir plugins exec turbo run test:boot --filter=<plugin>`,
      `check:plugin-boot`, and `node --run check:e2e <plugin>`. Re-run the `@smoke` journeys of the plugins whose
      journeys failed on 2026-10-19 (see [Open question 5](#open-questions)) to see whether this class explains them.
- [ ] **S5 — docs.** The owning plugin's README, a note in `docs/native-plugin-overrides.md` ("the sole `root` owner
      ships a shadowed survivor so a recomposition gap cannot blank the page"), and the S0 gap row.

## Done when

- With `@dshfiles/frame-layout` disposed (bundle touch, plugin disable, or recomposition), the page shows the recovery
  card and never blanks.
- When the owner re-registers, the real UI returns by itself; no manual reload.
- While the primary is live, the fallback is never the rendered entry (proved by the priority ordering, not by
  inspection).
- The gap row exists in `plans/dsh-host-gaps.md`, and no core file was patched.

## Acceptance criteria

- [ ] `RootOutlet`'s zero-registration branch is unreachable in the `web` profile: `entries` for `root` is never empty.
- [ ] Blank-page reproduction fails: the console shows no `Uncaught SlotAssemblyError`, the recovery card is visible,
      and the page recovers without a reload.
- [ ] The fallback never renders while the frame is live (screenshot/DOM check for `data-slot="root"` ownership).
- [ ] `check:plugin-boot` green and the owning plugin's `check:e2e` journeys green.
- [ ] Auto-reload (if kept) is bounded and documented; no reload loop.

## Open questions

1. **Who owns the fallback entry?** `@dshfiles/frame-layout` cannot survive itself. Candidates: a new tiny bundle
   (`@dshfiles/shell-fallback`) or an existing early-boot owned plugin (`@dshfiles/ui-styles`, `@dshfiles/shortcuts`).
   A new bundle costs a profile row; an existing one couples two concerns.
2. **Children declarations.** A second `root` registration with the same `children` re-records them
   (`declarationEpoch += 1`, `declaredBy` rewritten). Does disposing the fallback un-declare the primary's children, and
   does that fire `notifyDeclaration` consumers? S1 must answer this before S2 picks a registration shape.
3. **Card only, or card + auto-reload?** A card keeps page state; an auto-reload loses it but needs no human. Both is
   the current proposal (card immediately, reload after N seconds).
4. **Scope.** Only `root`, or every `single`-scope singleton we own (`shell.dock`, `rightbar`, …)? The throw is
   specific to the ctx-level entry today.
5. **Do the failing e2e journeys share this cause?** On 2026-10-19 `check:e2e` was 30/43 tasks green; 13 plugins
   failed, `workbench` 4/5 (one journey times out waiting for a turn to settle). No baseline comparison yet — compare
   against the pre-linearization tip before attributing anything to this plan.

## Decisions log

| Date       | Decision                                                                            | Rationale                                                                          |
| ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 2026-10-19 | Containment stays plugin-side; the renderer/shell halves are recorded as a Host gap | this repo runs stock DSH and carries no core patches                               |
| 2026-10-19 | Keep exactly one live `root` owner                                                  | the composition's "one owner, not two" rule stays; the fallback must stay shadowed |
| 2026-10-19 | Treat the crash as a transient-gap bug, not a bad composition                       | a reload proves the composition is fine                                            |
