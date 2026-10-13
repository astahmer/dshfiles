# Plans and test status matrix

Snapshot of `main` at `d8b2b642`, taken 2026-10-13. This was a read-only audit: nothing was run except listings and `features:check`/`features:report`.

> **In progress elsewhere, so treat these rows as moving:**
> - The thread-destination Host picker (`plans/thread-destination-host`). Its WIP is in off-main revisions `kpryyqntkxtr` and `zvvpswmunkpn`.
> - Gherkin browser journeys for the catalog `not-applicable` gaps.
> - The quiet-machine OptMem 100k benchmark.
> - The `~/dev` cleanup audit.
>
> Rows in those areas are marked **in progress**.
>
> During the audit, an untracked `plugins/@dshfiles/shared-streams` appeared on disk. It is not on `main` and is not counted here.

Status words:
- **done**: the evidence is cited.
- **partial**: the missing part is named.
- **not started**
- **obsolete**: superseded, or the machinery was removed.
- **contradicted**: the plan claims done, but the code disagrees.

## Headline

- **Plans:** 11 plans, about 120 tracked items.
  - Done: about 55.
  - Partial or in progress: about 30.
  - Not started: about 25.
  - Obsolete: about 10.
  - Plans whose checkboxes or text disagree with the code: 8.
- **Feature catalogs:** `features:check` passes: 32 catalogs, 102 features, 150 config options, 72 Gherkin scenarios and 343 unit-test links.
  - It passes only because 77 verification entries are `not-applicable`, and most of those say "No browser journey exists yet".
  - The plugin-e2e tracker still says "75 missing tags". That is stale.
- **Step definitions:** all 18 `.feature` files have their step definitions (159 patterns; every step resolves). No `coveredBy` id dangles.
- **Browser runs:**
  - Only listing and generation run in CI (`.github/workflows/plugin-e2e-coverage.yml`). Browser execution is not wired in.
  - Local `output/e2e-evidence` holds 10 `client-plugin-boot` runs: 7 failed, 3 passed.
  - `test-results/.last-run.json` says `interrupted`.
- **Test ratings:**
  - Well tested: 8 (agent-questions, optmem, optmem-sqlite, prompt-stash, settings-search, shortcuts, thread-sidebar, dshx).
  - Partly: 19.
  - Weak: 8.
  - Untested here: 1 (antislop, which is vendored).

## (a) Plans matrix

### multi-host (`plans/multi-host/README.md`, `implementation.md`)

| item | status | evidence | next step |
|---|---|---|---|
| Strategy research A–H, pinned source snapshots, threat review | done | `README.md` comparison/security sections; `source-snapshots.json` | – |
| Proof of concept: two stock runtimes over a loopback tunnel; auth rejection; reconnect; restart | done | `tooling/dshx/scripts/smoke-multi-host.mjs`; `tests/platform-cli.spec.ts` | – |
| DSHX named-argument RPC wire fix | done | `tooling/dshx/packages/dshx/tests/multi-host-channel.spec.ts` | – |
| P1 VPS acceptance: SSH, PTY, filesystem, tunnel loss, restart, MCP | done | `plugins/@dshfiles/multi-host/docs/validation.md:60-75`; `scripts/smoke-multi-host-ssh.mjs` | – |
| P1 LSP gate | not started (blocked) | `validation.md:75` marks it UNSUPPORTED | wait for an official LSP artifact |
| P2 identity, directory and store | done | `multi-host/src/{records,store,identity}.ts`; `tests/{store,records,identity}.test.ts` | – |
| P2 CLI `host`/`runtime`/`workspace`, with ambiguity errors | done | `dshx/src/cli/platform.ts:434-548` | – |
| P3 reliability: protocol pin, host-key rejection, outage isolation, no replay after a lost reply | done | `validation.md` P3; `tests/native-rpc-outcome.test.ts` | – |
| P3 connection reuse (pool) | **in progress** | `gateway-pool.ts` exists only off main (`kpryyqntkxtr`); main opens one tunnel per call | land it with a reuse-latency test |
| P4 Hosts panel (online/stale/last verified) | done (to be replaced) | `multi-host/src/client.tsx:145,374,749` | the destination plan shrinks it |
| P4 RPC latency in the panel | not started | – | after the pool lands |
| P4 runtime-first workspace picker, threads grouped by runtime | not started / **in progress** | main has raw path entry only | the destination plan's Ph3–4 |
| P4 "Open runtime" view (lease actor) | done | `runtime-view-machine.ts` + test (4 cases) | – |
| P4 browser proof of approval, upload, terminal, popup close/reopen | not started | `implementation.md` P4 row | browser journey |
| P4 provider acceptance and one model turn on the Pi | partial | `implementation.md:8`: one probe returned 200, another 401, unreconciled | reconcile the credential, run one turn |
| P5 Pi ARM64 + VPS + local runtimes at once | done | `validation.md` P5 | – |
| P5 daily-profile activation | **contradicted** | the plan says pending; `profiles/web/package.json:18,53` already lists multi-host | update the tracker; verify the live boot |
| P5 durable remote supervision, upgrade, rollback | not started | `validation.md:111` "pending owner choice" | choose nixfiles or Swarm |
| README acceptance boxes 5–6 and the "Next: remote gate" step | **contradicted** | still unticked, though P1–P2 are done | tick them and repoint |

### thread-destination-host (`plans/thread-destination-host/README.md`): **in progress**

| item | status | evidence | next step |
|---|---|---|---|
| Prerequisite: client→client plugin API in DSHX | done | main `prltttvrqktn` | – |
| Ph1 gateway pool (idle TTL, generation) | **in progress** | off-main `multi-host/src/gateway-pool.ts` | test it and land |
| Ph1 launch-file discovery replaces journal scraping | **in progress** | off-main `launch-file.ts`; main still has `connectors/ssh-journal.ts` | check on macOS and Linux |
| Ph1 trim the admin panel | not started | main `client.tsx` is 791 lines, and `client-entry.tsx:21-22` still registers `main` + panellist | shrink it to a "Manage hosts" sheet |
| Ph2 Host chip in the destination bar | partial | `jj-integration/src/destination-bar.tsx:70` shows a static "Local" chip (`hostPlanned` tooltip) | menu, status dot, lock after create |
| Ph3 host-aware pickers (`runtimePluginCall`, `browse.list`) | **in progress** | off-main `api.ts` `runtimePluginCall` with an allow-list | wire into jj-integration |
| Ph4 remote create, thread reference, sidebar badge | **in progress** (early) | off-main `thread-store.ts`; nothing in thread-sidebar | badge, plus an unknown-outcome test |
| Ph5 inline view (iframe or popup) | not started | open questions 2–3 | deep-link spike |
| jj-integration e2e journey | **in progress** | off-main `e2e/features/jj-integration.feature` | land it |
| Remove the "Machine selector" row from `dsh-host-gaps.md` | not started | `dsh-host-gaps.md:17` | after Ph3 |

### desktop-shell (`plans/desktop-shell/README.md`)

| item | status | evidence | next step |
|---|---|---|---|
| Ph0 handshake spike (token URL → cookie) | done | `apps/desktop/src/main.ts:80` | – |
| Ph1 spawn `--port 0`, parse the URL, SIGTERM then SIGKILL after 5 s | done | `apps/desktop/src/host.ts:74,106-116`; `main.ts:110-118` | – |
| `DSH_DESKTOP_PROFILE`; dialog when `dsh` is missing | done | `main.ts:17,87-90`; `host.ts:123-132` | – |
| `preload.ts` contextBridge | obsolete / dropped | no file; `contextIsolation: true` | remove from the plan |
| Ph2 relaunch when the child dies, port taken, second window | not started | only `did-fail-load` (`main.ts:68`) | exit listener plus a relaunch dialog |
| Ph1 proof on the pinned Electron 43.6.0 | partial | proof was on 43.7.7 | rerun the no-orphan check |
| Ph3 unsigned Nix wrapper | done | `flake.nix:63-125` | – |
| Ph3 signed `.app`/`.dmg`/`.deb`; Ph4 auto-update | not started | – | signing identity |
| Tests | not started | no tests in `apps/desktop` | lifecycle test for `host.ts` |

### optmem (`plans/optmem/README.md`)

| item | status | evidence | next step |
|---|---|---|---|
| Stages 1–5: capture, SQLite/FTS5, tools, injection | done | `optmem-core/src/engine.ts`; `optmem-sqlite/src/engine.test.ts`; `optmem/src/*.test.ts` | – |
| In the `web` profile; Settings panel | done | `profiles/web/package.json:19,67`; `optmem/src/settings-panel.tsx`, `settings-draft.test.ts` | user restart |
| Full mode on stock DSH via request-messages | done (scratch only) | `request-messages/src/contract.ts`; `optmem/src/full-mode.test.ts`; `docs/runtime-evidence.md` | one real-provider turn |
| Core-fork compatibility-mode references | obsolete | core fork removed | – |
| Backlog recovery and Workbench Explorer | done | `explorer-panel.tsx`; 2 browser journeys with passing evidence | – |
| Stall fix: clip fallback, catch-up sweep, round-robin, call cap | done in code; live pending | `engine.ts:49-53,272,848,966`; `bounded-summary.test.ts` | user restart, then watch `viewThroughPos` move past 468 |
| Per-call token usage capture | partial (**plan stale**) | the plan says usage is discarded, but `summarizer.ts:247-258` returns it (`summarizer.test.ts:306`); it is never persisted | persist per node, show it in the Explorer and token-meter |
| 100k benchmark on a quiet machine | **in progress** | `docs/benchmarks.md` 2026-10-11 run was on a busy machine | append the quiet run |
| Workspace-wide build, typecheck and e2e gates | partial | the plan cites stale agent-communication blockers | rerun on stock DSH |

### agent-communication-observability (`.md` + tracker)

| item | status | evidence | next step |
|---|---|---|---|
| Read-only `dshx comm report` (JSON/human, bounded) | done | `dshx/src/communication/cli.ts:129`; `tests/communication-cli.spec.ts` | – |
| Unavailable vs empty vs populated, with a non-use caveat | done | `communication/bridge.ts:117-142` | – |
| Tool activity at one boundary, no args or body, call ids | done | `agent-communication/src/host.ts:479-494`; `communication-diagnostics.spec.ts` | – |
| 5,000 events / 30-day retention; v1→v4 read compatibility | done | `communication-diagnostics.spec.ts:88,151` | – |
| Notification-outcome reporting | obsolete | v4 removed replay | remove from the plan |
| Inspector panel with Host queries | done | `client.tsx:27`; panel polls every 30 s | – |
| Metadata-only rows plus an explicit body reveal | **contradicted** | `agent-communication-panel.tsx:142` renders every body; the `revealMessageBody` API is never called | restore the reveal, or amend the plan and README |
| Delivery-mode change / steer allowlist | obsolete | `types.ts:3` makes delivery passive-only | remove |
| Unsubscribe/rejoin with confirmation | done | panel:389-418; `api-operations.test.ts:159` | – |
| Per-message acknowledge in the UI | **contradicted** (partial) | the API is tested (`api-operations.ts:80`), but the panel has no ack button | add it or drop the claim |
| "No send/publish controls" | superseded | the panel posts as a human (panel:372) | update the scope |
| Browser journeys | done | `e2e/features/agent-communication.feature`: 4 scenarios | – |
| Real Agent use verified | not started | the live report is `host-unavailable` | one sanctioned live turn |

### agent-session-history (`.md` + tracker)

| item | status | evidence | next step |
|---|---|---|---|
| Host contract audit | partial | the tracker says in progress | close it or finish it |
| Cold-safe latest-page API; extend `dsh-tool-session-query`; presets; `allowed-once` | **obsolete** for this repo | done only in the out-of-repo core fork (`../dsh-core-agent-session-history`, `445de7b3`), which breaks the stock-DSH rule (`AGENTS.md`) | upstream it, or rewrite the plan |
| Bounded history search inside dshfiles | done (narrower substitute) | `agent-communication/src/session-history.ts`; `host.ts:155` `dshx_comm_history`; `session-history.test.ts` | decide whether it replaces the plan |
| Date/state/group/workspace filters; `parked` | not started | the tool takes only `sessionId` and `query` | – |
| Trajectory, range and attachment reads; mutations under write presets | not started | – | – |
| Scratch-profile verification; 11 acceptance criteria | not started | all unchecked | rewrite against stock DSH |

### agent-session-observability (`README.md`)

| item | status | evidence | next step |
|---|---|---|---|
| A. Discovery | done | plan notes | – |
| B. Owned-descendant directory `dshx_comm_agents` | done | `host.ts:49-69`; `live-agent-directory.test.ts:47` | – |
| B/C. `dshx_comm_workspace` (id and title, no path) | done | `host.ts:91-136`; tests :72, :93 | the tracker still says "run tests"; update it |
| C. Session history access | partial | `dshx_comm_history` covers live owned descendants only | follows the session-history decision |
| C. JJ change associations | not started | – | – |
| D. Orchestration writes (prompt, queue, cancel, resume) | not started | – | needs a separate authorization design |
| E. Scratch validation of the workspace tool | partial | unit tests plus an e2e scenario; no scratch receipt | run a scratch verify |
| `integration-spine` / `session-observability-resume` resume notes | obsolete | bookmark deleted, workspace gone | remove |

### async-agent-questions (`.md`)

| item | status | evidence | next step |
|---|---|---|---|
| Phase 0: root timed mode turned on | done (ahead of its gate) | `profiles/web/cordis.patch.yml:167-171` (`timed`, 300 s) | record that it answers open question 1 |
| Phase 0: browser acceptance (card, pending, late answer, cancel, restart) | not started | no e2e covers `ask_user_question` | scratch journey |
| Phase 1: Host parent-scoped question service | done | `agent-questions/src/service.ts`; `service.test.ts:129-277`; `storage.test.ts:97` | – |
| `ask_parent_question`/`answer_parent_question`, inbox only as a wakeup | done | `host.ts:147,241` | – |
| Concurrent isolation; required recommended option; `recommended`/`defer`; v1 rows | done | `service.test.ts:99,129,299`; `storage.test.ts:179` | – |
| Deferred `questions/*.md` (idempotent, symlink-safe) | done | `deferred-question.test.ts:27-98` | decide on pruning (open question 4) |
| Revisioned Markdown feedback (batch of 20, stale receipts) | done | `revisioned-feedback.test.ts:132-257` | – |
| Scratch Host cold-resume | done (synthetic LLM only) | `plugin-journeys.feature:13`; `scripts/verify-scratch.mjs` | run with a real provider |
| Element anchors | not started (blocked) | – | needs an evidence provider |
| Plan header and `plans/README.md` saying the "child flow waits on Host" | **contradicted** | the plugin is shipped and in `profiles/web/package.json:7` | rewrite the header; keep only the open gates |

### dsh-host-gaps (`.md`)

| item | status | evidence | next step |
|---|---|---|---|
| Link a thread as a child / auto-handoff; cascade-archive undo | open; partial | `thread-sidebar/README.md:150`; manual-archive undo only | upstream request |
| Settings jump to a section; highlight | partial; open | `settings-search/README.md:12,46` | keep |
| diff-viewed collapse / unviewed filter / auto-mark | open | `diff-viewed/README.md:29-32` | keep |
| MCP health; SSE transport | open | `mcp-servers/README.md:49` | keep |
| MCP preferences in Settings | **obsolete (resolved)** | `mcp-servers/README.md:94-96` | remove the row |
| "All models" composer picker | **obsolete (resolved)** | `model-effort-picker/README.md:3` | remove the row |
| Machine selector for secrets/accounts | open / **in progress** | `secret-catalog/src/host.ts:28` | after destination Ph3 |
| Unify-branches prefilled prompt; queued edit with attachments; ⌘, / ⌘N | open; partial workaround; placeholder | `queue-reorder/README.md:5`; `shortcuts/src/client.tsx:51-71` | keep |

### dsh-e2e-testing (`.md`)

| item | status | evidence | next step |
|---|---|---|---|
| Pin the browser; a fresh clone needs no manual install | done (**checkbox stale**) | root `package.json` `setup:browser` runs inside `install:all`; `check.yml:40` | tick it |
| Shared boot-card reader with unit tests | done | `dshx/src/project/browser-boot.ts`; `tests/client-boot-check.spec.ts` | – |
| Boot smoke: failed entry reported by id; `pending` counts as a pass | done in code (boxes unticked) | `client-boot-check.spec.ts:22-76`; `steps.ts:264` | tick after one green run |
| Profile smoke (`test:boot`), web profile boots clean | partial | the harness exists; last local evidence 7/10 failed; never in CI | rerun on stock rc.2; add to CI |
| Gherkin via `bddgen`; boot stays a plain spec | done | `e2e/features/client-boot.feature`; `steps.ts` | – |
| Dead step definitions | partial | `steps.ts:240` (external-bundle composition) and `steps.ts:264` (failed entry reported by id) are used by no scenario | add a throwing-fixture scenario or delete them |
| First user journey: send, reply, queue lists the second message | not started | no queue/send scenario; queue-reorder has 5 n/a ids | write it with a fake LLM |
| Bounded evidence reporter (steps, traces, JJ identity, CI URL) | done | `e2e/support/evidence-reporter.ts`; `evidence-reporter.integration.test.ts` | – |
| Both original defects covered (missing `slots`, locale collision) | partial | `locale-ownership.spec.ts`, `slot-occupancy.spec.ts` exist; boot-smoke half unproven | link the tests in the plan |
| Upstream `window.__DSH_BOOT_STATE__` | not started | no reference outside the plan | file the upstream request |

### plugin-e2e-coverage (`.md` + tracker): journeys **in progress**

| item | status | evidence | next step |
|---|---|---|---|
| Dynamic bundle discovery with a validated ignore list | done | `scripts/plugin-inventory.mjs` + test; `boot-ignore.json` is `[]` | – |
| Catalog per package (stable IDs, config, states, failure modes) | done | 32 `dshx.features.json`; `features:check` passes | – |
| Every feature maps to a scenario or a reviewed n/a | partial | 77 `not-applicable` entries; most mean "no journey yet", not real n/a | **in progress**: journeys for the gaps |
| Config options covered by behavior assertions | partial | 150 options; many link to n/a ids (for example every `home.*` → `home.browser-journey`, "verified manually") | – |
| Deterministic external fakes | partial | models.dev pricing and the OptMem summarizer are faked; the others are unproven | provider and MCP fakes |
| Network boundary: browser contained | done | `network-boundary.feature`; `steps.ts:139` route guard | – |
| Network boundary: Host egress contained | not started | the tracker says Host egress is uncontained | – |
| Report separates ignored / failing / unrun / browser-verified | partial | the report shows kinds, but no run status | feed in the evidence manifests |
| CI: inventory, catalog, BDD listing, `features:check` | done | `.github/workflows/plugin-e2e-coverage.yml` | – |
| CI: browser execution | not started | listing only | add a PR smoke plus a scheduled full run |
| Scaffold emits a feature declaration | not started | nothing in `create-dshx/src` or the dshx scaffold | add a template |
| Inventory reviewed against the running product | not started | tracker counts predate the core removal | rerun `test:boot`/`test:e2e` on rc.2 |
| Command-palette content-search journey | **broken** | `command-palette.feature:15` boots `@dshfiles/dsh-core-runtime`, which was deleted, so the scenario cannot pass | recompose it without core-runtime |
| agent-questions journey granularity | partial | 6 `@scenario` tags on one scenario (`plugin-journeys.feature:7-13`) | split it per feature |
| Tracker counts ("75 missing tags", "30 catalogs") | **contradicted** | `features:check` now passes: 32/102/72/343 | refresh the tracker |

### reference-feature-additions (`.md`): research shortlist

| item | status | evidence | next step |
|---|---|---|---|
| F05 prompt stash (multiple drafts) | done | `@dshfiles/prompt-stash`; 5 scenarios | – |
| F06 sent-prompt recall | done | `prompt-stash/src/recent-prompts.ts`; catalog "Browse recent text-only user messages" | – |
| F11/F12 snooze, cross-client attention | partial (browser-local) | `thread-sidebar` snooze durations; Host-first item still open | Host request |
| F15 review progress / viewed files | done (v1) | `diff-viewed/src/viewed-marks.ts`; `jujutsu/src/review-progress.ts` | – |
| F16 invalidate a mark when content changes but line counts don't | partial | the key is `[sessionId, seq, path]` (`viewed-marks.ts:19`), with no content digest | add the acceptance test from the plan |
| F18 inline comments / send hunks | not started | – | – |
| F23 provision a JJ workspace and launch | done | `jj-integration` destination bar isolation; `jujutsu/src/workspace-provisioner.ts` | – |
| F29 child-work dashboard | partial | agent-communication panel; activity-timeline | – |
| F33 async questions | done (child flow); root timed flow unaccepted | `agent-questions` | – |
| I10 usage-limit recovery; I04 anchored feedback | done | `ai-accounts/src/quota-continuation*.ts`; agent-questions revisioned feedback | – |
| I01 dockable workspace | partial (diverged) | `workbench` uses dockview, not Trellis; no named layouts | update the plan |
| Context claim "web manifest includes Queue Reorder" | **contradicted** | `profiles/web/package.json` has no queue-reorder | refresh the context section |
| F66 project actions; F67 verify before completion | partial | `project-checks/src/host.ts:416` (`agent/turn-stopping`) | test it (it is weak) |
| F01/F19/F34/F36/F42/F46/F74–F76/F78 adopt-probe items | not started | no probe receipts | pick 1–2 |
| F20/F22/F24/F39/F40/F41/F44/F83 Host-first items | not started (blocked) | – | upstream asks |
| Acceptance criteria (9) | not started | all unchecked | – |

## (b) Testing matrix

Counts are approximate (`it(`/`test(`). "n/a" means a catalog entry marked `not-applicable`, which here effectively means "no browser journey yet".

| package | unit | integration (real deps) | browser e2e | runtime-verified | rating | biggest gap |
|---|---|---|---|---|---|---|
| activity-timeline | 1 file / 14 | temp-dir persistence | none (2 n/a) | none | partly | `host.ts` ingest and `panel.tsx` (353) untested |
| agent-communication | 6 / 28 | `integration.test.ts`: the real dshx communication service on temp fs | 4 scenarios, steps defined | no receipt; live report `host-unavailable` | partly | `host.ts` (612) and the panel (824) only via journeys; the body-reveal/ack contradiction is untested |
| agent-questions | 5 / 33 | real fs (storage, deferred files) | 1 combined scenario carrying 6 ids | synthetic-LLM scratch Host | **well tested** | 6 behaviours share one scenario; `host.ts` (492) only reached through it |
| ai-accounts | 46 / ~250 | temp fs, a local HTTP server (commandcode), a real cordis Context | 11 scenarios (3 n/a) | prior workspace 1/1 recovery only | partly | Host wiring of routing, pool failover and luna reserve (n/a); ~45 UI files untested |
| command-palette | 6 / 21 | none | 11 scenarios incl. performance; **content-search is broken** (boots the deleted core-runtime) | prior 6/7, stale | partly | `thread-palette` (672) has 2 tests; content-search journey cannot pass |
| diff-viewed | 2 / 11 | none | none (4 n/a) | none | weak | toggle UI and the content-change invalidation (F16) |
| editor | 5 / 26 | `write-file.test.ts` on real fs | 1 scenario (5 n/a) | none | weak | save conflict, file browse, `editor-panel` (373), `monaco-engine` |
| goal-stall-guard | 2 / 27 | loads the built `dist` with 9 `vi.fn` stubs | none (3 n/a) | README: boot-verified on probe :3199 | partly | never run against real goals/agents services; needs a fresh `dist` |
| home | 1 / 2 | none | none ("verified manually", no receipt) | unbacked claim | weak | branding, recent threads, unlanded count |
| jj-integration | 0 | 6 cases with real jj (`threads.integration.test.ts`), **skipped when jj is missing** | none (2 n/a); journey **in progress** off-main | none | weak | `host.ts` glue (provision, Land hand-off to the agent, sweep) and the destination bar UI |
| jujutsu | 18 / 97 | 4 real-jj integration files (~10 cases) | 2 scenarios (7 n/a) | none | partly | `client.tsx` (1947) and `host.ts` (709) mutations, `workspace-provisioner` |
| mcp-servers | 4 / 43 | none (fetch and subprocess faked) | none (5 n/a) | none | partly | no real stdio or Streamable-HTTP server, no OAuth round-trip; `host.ts` (626) |
| model-effort-picker | 2 / 4 (1 near-tautological) | `createTestHost` mount/unmount only | 1 scenario (empty catalog) | closeout plan deleted | weak | `model-effort-picker.tsx` (257) |
| multi-host | 7 / 24 | real loopback HTTP, real fs | none (8 n/a) | **yes**: `docs/validation.md` VPS/Pi/local P1–P3 | partly | `ssh.ts`, `host.ts` (531), `client.tsx` (791); the catalog maps 0 tests |
| optmem | 6 / 60 | real SQLite plus DSH session fixtures | 2 scenarios, passing evidence | **yes**: `docs/runtime-evidence.md` (10-09, 10-13) | **well tested** | 8 n/a (injection bounds, barrier cancel, summarizer failure) |
| optmem-core | 6 / 30 | – (`engine.ts` is exercised only via optmem-sqlite) | none | indirect | partly | `engine.ts` (1073) has no test of its own |
| optmem-sqlite | 3 / 38 | real `node:sqlite`, temp dir, append worker | none | indirect (optmem) | **well tested** | migration upgrade paths |
| plugin-marketplace | 3 / 29 (18 `vi.fn`) | temp dir; fetch and CLI faked; smoke script | none (4 n/a) | none | partly | install/consent against a real Hub or DSH |
| plugin-ui | 6 / 14 | none | none | none | weak | `diff.tsx`, `shiki-slim`, `chart`, ~45 shadcn wrappers |
| project-checks | 2 / 6 | none | none (4 n/a) | README cites `verify:scratch`, **which does not exist** | weak | `host.ts` (480): trusted runs, receipts, `turn-stopping` retry |
| project-folder-picker | 1 / 5 | none | none | none | weak | `project-folder-picker.tsx` (436) |
| prompt-stash | 3 / 23 | none | 5 scenarios | e2e scratch only | **well tested** | `prompt-stash-action.tsx` (593) only through e2e |
| queue-reorder | 4 / 18 (1 source-regex test) | none | none (5 n/a) | none | partly | reorder and edit never run in a browser; `host.ts`, `session-queue-editor` |
| request-messages | 1 / 4 | none | none (1 n/a) | **yes**: optmem full-mode run (10-13) | partly | `host.ts` and the polyfill wiring proven only manually |
| secret-catalog | 7 / 46 (CLI faked; argv-coupled asserts) | none | none (6 n/a) | none | partly | panel (440), mutation dialog (397), `secret-tools` agent tools |
| settings-search | 2 / 12 | none | 5 scenarios | none | **well tested** | field-editor edge types only via e2e |
| shared-runtime | 0 | – | 1 boot scenario | none | partly | config-only; boot is its only check (fine) |
| shortcuts | 1 / 9 | none | 4 scenarios | none | **well tested** | ⌘, / ⌘N are placeholders |
| sidebar-commands | 1 / 8 | none | none (4 n/a) | none | partly | palette registration |
| thread-sidebar | 18 / 99 (1 source-regex test) | temp dirs (restart, plugin-updates) | 17 scenarios | none | **well tested** | `sidebar-shell.tsx` (1686), `thread-view-manager` only partly covered |
| workbench | 3 / 15 (jsdom) | none | none (5 n/a) | none | partly | real dockview persistence in a browser |
| workspace-folder-picker | 0 | – | 2 scenarios | none | partly | e2e-only, but tiny (48 lines) |
| dshx | 58 / ~477 | temp-dir builds, real Chromium boot, child processes, HTTP bridges | n/a (it is the harness) | none | **well tested** | the profile/dev orchestrators run only against fake `DshCommandRunner`s, never a real `dsh` |
| create-dshx | 2 / 16 (1 all-mock) | scaffolds into temp dirs | n/a | none | partly | `templates.ts` (690): generated templates are not built or booted |
| e2e/support | 2 / 4 (`node --test`) | the evidence reporter spawns Playwright | it is the harness | last run `interrupted`; 7/10 boot runs failed | partly | `evidence-runs.ts` (522), `boot.ts` untested; the suite never runs in CI |
| antislop | 0 | – | n/a | runs in every lint | untested here | vendored bundle; tests live upstream in `emilint` |

Tests that are tautological, check source text, or lean on mocks:
- **Check source text, not behaviour:**
  - `queue-reorder/src/queue-dock-style.test.ts`, the third test in `thread-sidebar/src/restart.test.ts`, and `ai-accounts/src/client-injection.test.ts` regex-match source files.
- **Close to tautological:**
  - `model-effort-picker/tests/host.spec.ts`
  - `command-palette/src/new-thread-shortcut.test.ts` (repeats the defaults)
  - `jujutsu/src/repository-query-cache.test.ts` (repeats key shapes)
  - dshx `api.spec.ts` "does not expose transport helpers"
- **Mock-heavy:**
  - `mcp-servers/src/core.test.ts` (13 `vi.fn`)
  - `secret-catalog/src/secret-operations.test.ts` (asserts argv)
  - `create-dshx/tests/cli-cancel.spec.ts` (all mocks)
  - `goal-stall-guard/src/host.test.ts` (depends on the built `dist`)

## (c) Top 10 missing tests and work, by value

1. **Run browser e2e in CI and get a fresh green baseline on stock rc.2.**
   - First fix the `command-palette.feature:15` journey, which boots the deleted `dsh-core-runtime`.
   - Today CI only lists scenarios. Local evidence shows 7 of 10 boot runs failed, and the last run was interrupted.
   - Add a PR smoke run (`client-boot` plus 1–2 journeys) and a scheduled full run. Refresh the tracker counts.
2. **Turn the 77 `not-applicable` entries into real journeys, highest-risk first** (journeys **in progress**):
   - queue-reorder: reorder and edit.
   - jj-integration: destination bar and Land.
   - multi-host: the 8 n/a entries.
   - diff-viewed, editor save-conflict, secret-catalog.
   - Make `features:check` count "no journey yet" separately from a real n/a, so it stops passing vacuously.
3. **Test jj-integration's `host.ts` glue against real jj** (provision with registry, Land hand-off message, finished-thread sweep). CI installs jj, but local runs still skip silently when jj is missing (`describe.skipIf`).
4. **Test the multi-host `ssh.ts` connector, `host.ts`, and the gateway pool** with a local sshd or loopback fixture: reuse latency, generation change, a lost reply that must not be replayed. The pool is **in progress** off-main.
5. **Write the async root timed-question browser journey.** `cordis.patch.yml` already ships timed mode to `web` without that acceptance: card, pending result, late answer, cancel, restart.
6. **Test project-checks `host.ts`** (trusted run, receipts, `agent/turn-stopping` verify/retry), and add the `verify:scratch` script its README promises or remove the claim.
7. **Resolve the agent-communication contradictions:** body reveal versus showing every body, and the missing ack button. Then add journey assertions for the chosen behaviour, plus one sanctioned live-Agent report.
8. **Persist OptMem per-call token usage and test it:** summarizer usage → node → Explorer/token-meter. Also give `optmem-core/engine.ts` its own tests and cover `optmem-sqlite` migration upgrades. The quiet benchmark is **in progress**.
9. **Run mcp-servers against real deterministic servers** (a stdio fixture and a Streamable-HTTP fixture, plus a local OAuth stub) in place of the `vi.fn` fetch/subprocess. `host.ts` (626) is untested.
10. **Clean up the plans:**
    - Rewrite agent-session-history to fit stock DSH (its core-fork route is obsolete) or retire it in favour of `dshx_comm_history`.
    - Fix the stale async-questions header, multi-host P5 and acceptance boxes, the dsh-host-gaps resolved rows, and the dsh-e2e "fresh clone" box.
    - Add a lifecycle test for `apps/desktop/src/host.ts`.
