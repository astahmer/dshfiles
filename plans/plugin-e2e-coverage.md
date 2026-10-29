# Plugin E2E coverage: remaining work

The harness, the layering, feature catalogs, the boot smoke and the evidence
receipts are documented in [docs/e2e-testing.md](../docs/e2e-testing.md).
Current state (snapshot 2026-10-21): the report sees 57 plugin packages, 53
linked catalogs, 197 features (183 bundles) and 177 configuration options. Of the
linked bundle features, 151 have a Gherkin reference, 16 have an explicit
`not-applicable` rationale, and 16 have neither. The report currently fails with
45 validation issues, so this is not a clean coverage baseline. Four packages
lack `dshx.features` manifest references and are skipped; one has an existing
catalog file that is not linked.

## Remaining

- [ ] **Run the journeys in CI.** `plugin-e2e-coverage.yml` lists scenarios but
      never executes them. Add a PR smoke (client boot plus one or two journeys)
      and a scheduled full run, and feed the run results into `features:report`
      so it separates failing, unrun and browser-verified features.
- [ ] **Fresh green baseline on stock rc.2.** Run `test:e2e` end to end; most
      journeys landed 2026-10-13 and have not run together since.
- [ ] **Contain Host egress.** Only the browser is restricted; the Host can
      still reach the network during a journey.
- [ ] **Failed-entry boot scenario.** The step "every client entry that failed
      to activate is reported by id" (`e2e/support/steps.ts`) has no scenario;
      add one with a fixture bundle whose `apply` throws, or delete the step.
- [ ] **Scaffold a catalog.** `create-dshx` does not emit a `dshx.features.json`
      for a new plugin, so `features:check` only catches it after the fact.
- [ ] **Review catalogs against the running product** in a scratch profile and
      file discrepancies as bugs instead of trusting source-derived entries.
- [ ] Propose upstream a documented boot-state accessor
      (`window.__DSH_BOOT_STATE__`) so steps stop parsing the localized boot card.

## Open questions

1. Should the full journey suite gate every PR, or run on a schedule with a PR
   smoke only? Either way, reports must not count unrun features as covered.
2. How much evidence to retain in CI: measure the artifact size of a full run
   before raising retention.

## Current uncovered inventory (2026-10-21)

Here, E2E means a catalog-linked Gherkin journey through the real scratch DSH.
The inventory comes from `pnpm --dir tooling/dshx run features:report`, direct
inspection of the skipped package manifests/catalogs, and the current feature
tags. The report exits 1 with 45 validation issues; it is not a green coverage
receipt. Its 53 linked catalogs contain 183 bundle features: 151 have Gherkin
verification, 16 have explicit `not-applicable` rationales, and 16 have neither.
It skips four of the 57 plugin packages because their manifest lacks
`dshx.features`; worktree-memory's existing catalog is therefore outside those
counts.

### Missing Gherkin journeys (16)

These linked bundle features have neither a Gherkin verification nor an explicit
`not-applicable` rationale:

| Package | Feature | Behavior without a browser journey |
| --- | --- | --- |
| `ai-accounts` | `quota-forecast` | Forecast quota depletion, free capacity, and account hand-off. |
| `backlog` | `auto-triage` | Triage captures with Jev/model proposals; accept or dismiss proposals. |
| `backlog` | `lifecycle-signals` | Start/finish items from thread mentions and Jujutsu revisions. |
| `backlog` | `backlog-mentions` | Find and insert backlog items through composer `@` autocomplete. |
| `backlog` | `search-and-views` | Search with operators/reasons and save views. |
| `backlog` | `attention-inbox` | Browse and acknowledge attention across backlog items and threads. |
| `backlog` | `shared-activity` | Publish backlog changes into Activity Timeline. |
| `backlog` | `rich-capture` | Capture text with attachments, references, properties, and voice input. |
| `chat` | `windowed-transcript` | Open thread at latest messages using windowed transcript. |
| `jj-integration` | `thread-integration-attention-view` | Prioritize thread integrations needing attention. |
| `jj-integration` | `thread-integration-row-details` | Inspect per-row integration details. |
| `model-effort-picker` | `account-swap` | Swap to the next account offering the selected model. |
| `session-controller` | `lean-session-follow` | Send the browser only thread content it renders. |
| `test-runs` | `test-run-card` | Show Vitest runs and results in a thread card. |
| `thread-sidebar` | `rename-thread-title` | Rename a thread from its sidebar row menu. |
| `turn-summary` | `turn-summary-line` | Show summary under each completed turn. |

The missing features with declared configuration are: `quota-forecast` (`workHours`),
`account-swap` (`accountSwap`, `accountSwapRoutes`), `test-run-card` (`enabled`,
`runningCard`, `composerActions`, `openFailures`), and `turn-summary-line`
(`enabled`, `includeReads`, `listFailures`).

### Configuration with no Gherkin mapping (15 options in 9 otherwise-covered features)

Each option's `coveredBy` IDs below point only to unit/Host tests. Its feature has
some browser journey, but the catalog does not connect that journey to this
setting:

| Package | Feature | Options |
| --- | --- | --- |
| `ai-accounts` | `failure-recovery` | `failureRecovery` |
| `jj-integration` | `thread-destination` | `isolateByDefault`, `bookmark`, `threadsDirectory`, `removeFinishedThreads` |
| `jj-integration` | `rebase` | `askAgentToFixLanding`, `syncWorkspaceAfterLand` |
| `jj-integration` | `thread-workspaces-panel` | `autoIntegrationExcludedRepositories` |
| `jujutsu` | `chat-references` | `chatReferenceLinks`, `chatReferenceClickBehavior` |
| `main-tabs` | `main-view-tabs` | `enabled`, `maxTabs` |
| `main-tabs` | `tab-persistence` | `persistence` |
| `thread-sidebar` | `thread-children-and-links` | `finishedSubagents` |
| `thread-sidebar` | `thread-keyboard-navigation` | `arrowKeysSwitchThread` |

### No direct journey, explicitly marked not applicable (16)

These features lack a package-owned Gherkin journey but have a recorded rationale;
keep them distinct from the unreviewed gaps above:

| Package | Feature | Recorded boundary |
| --- | --- | --- |
| `agent-questions` | `question-card-layout` | Requires a live `ask_user_question` turn; reach steps cannot trigger one. |
| `ai-accounts` | `luna-reserve-routing` | Fixed ChatGPT endpoints; success requires a real Codex account with exhausted weekly quota. |
| `input-trigger` | `command-chip-restore` | Restore flow is exercised by `btw`'s persisted `/btw` journey, not a package-owned command. |
| `jj-integration` | `thread-integration-empty` | Presentation-only empty state; reach checks hidden controls. |
| `mcp-servers` | `registry-catalog` | Fixed public registry endpoint; no network-dependent journey. |
| `memory` | `thread-digests` | Host-side digesting; no UI, separately exercised by scratch DSH check. |
| `memory` | `start-block` | Model-facing prompt text; separately checked through provider requests. |
| `memory` | `memory-tools` | Model-facing tools; separately exercised by scratch thread and panel journey. |
| `multi-host` | `isolated-runtime-views` | Existing SSH journey does not open remote UI or test tunnel recovery. |
| `multi-host` | `waiting-on-host` | Requires an authenticated remote agent turn; not available to headless scratch. |
| `project-checks` | `native-hook-receipts` | Hook bridge is absent from scratch web profile. |
| `pulls-review` | `ai-scope-summaries` | Successful summary needs provider credentials unavailable in scratch. |
| `request-messages` | `dispatch-request-messages` | Host-only bundle with no UI; covered by unit tests. |
| `rich-composer` | `rename-thread-title` | Scratch reach covers header editing; standalone UI harness needs full Conversation runtime. |
| `thread-sidebar` | `client-reload-banner` | Requires old client bundle with HMR blocked; separately checked by scripted scratch run. |
| `thread-sidebar` | `interrupted-turn-threads` | Requires a Host crash mid-turn; no current seed creates that state. |

### Packages omitted or mislinked from the catalog report

| Package | Current evidence | Classification |
| --- | --- | --- |
| `fff-search` | No catalog/reference and no Gherkin journey invokes its Agent `grep`/`glob` tools. | Actual user/Agent-facing E2E gap. |
| `session-search` | No catalog/reference or direct journey. The adjacent command-palette content-search journey configures the stock SQLite backend, not this owned backend. | Backend/infrastructure candidate; add an implementation-specific search journey if we require proof of the owned backend in the user path, otherwise classify with a reason. |
| `subprocess-local` | No catalog/reference or direct journey asserting the owned process-group polling behavior. Background-jobs journey starts a shell job but does not assert this implementation's polling. | Cross-cutting infrastructure candidate; classify as not-applicable or add a focused integrated journey. |
| `worktree-memory` | Catalog and RAM-panel detached-process journey both exist, but the package manifest does not link the catalog. | Catalog-link integrity gap, not a missing journey. |

### Existing journeys not linked to a catalog feature

These four tags are orphaned by the current catalog inventory; the scenarios exist,
but coverage validation cannot attribute them to a feature:

- `ai-accounts.quota-auto-resume` — resume an exhausted turn after reset.
- `thread-sidebar.section-drop` — drag a thread between sections.
- `thread-sidebar.multi-select` — select and archive a batch of threads.
- `worktree-memory.stop-detached-decoy` — inspect and stop a detached process from the RAM panel; this is already declared in its unlinked catalog.

The 45 report issues also include stale unit/Host-test references, wrong package
prefixes, duplicate verification IDs/tags, and these orphaned tags. Fixing that
catalog hygiene is needed before the coverage report can serve as a reliable CI
receipt.
