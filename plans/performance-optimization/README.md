# Performance optimization plan

## Context

Repository-wide audit of the 46 owned package directories, dshx, desktop shell, profile/build/check orchestration, and their supported DSH boundaries. Requested outcome: find practical optimization opportunities and plan their fixes, not implement them in this turn.

- Baseline: stock DSH 0.2.1-rc.2; React 18.3.1; TanStack Query 5.104.1; existing Virtual, XState, shared third-party runtime and one shared stylesheet. Extend the existing owned plugins and dshx, rather than add competing plugins, another authoritative store, or a framework migration.
- Source audit began from the dedicated thread workspace at commit `ecfd5375f823`, based on `6a82b443dfe3`. Performance-sensitive source was reread; grep/lint matches were not accepted as findings by themselves.
- [Earlier ADE audit](../ade-performance/README.md) supplies the short-transcript, non-streaming warm-navigation baseline. Its uncached/sequential JJ inventory hypothesis is superseded by current three-level caching and bounded workers; preserve those optimizations.
- [Evidence and limitations](evidence/README.md), [client work](client.md), [Host/data work](host.md), and [tooling work](tooling.md) form this plan. Findings are deduplicated work packages, not counts of syntax matches.
- Host/core remains outside this repository. Existing [Host gaps](../dsh-host-gaps.md), especially targeted running/question lookup and Host watch ownership, remain hard boundaries. Do not weaken rebase safety, recreate private Host services, or recommend a core patch as a fallback.

## Goal

Make expensive owned work proportional to changed, visible, requested data; bound background CPU, I/O, memory, provider calls, and concurrency; prove improvement against representative workloads without correctness, privacy, freshness, or accessibility regressions.

“Fully optimized” is not a finite or verifiable property. Completion means every accepted work package is measured and fixed or explicitly rejected/deferred with evidence, agreed budgets pass, and regression checks keep them passing. This document does not claim the application is already optimized or that static opportunities are proven causes of user-visible latency.

## What

1. Measure complete-profile startup, correct-content navigation, real token streaming, long histories, large repositories, stored corpora, multi-tab idle work, and development feedback loops.
2. Remove redundant work through narrow subscriptions, indexed projections, lazy activation/evaluation, batching, single-flight, bounded caches, virtualization and rolling concurrency.
3. Preserve existing working optimizations instead of applying the same technique indiscriminately.
4. Ship reversible changes in independent, described JJ revisions, with focused behavioral tests and before/after evidence for each work package.

### Progress

| Milestone | Status | Next action |
|---|---|---|
| Repository and prior-work map | Complete | Coverage and exclusions below |
| Static client/Host/tooling audit | Complete | Execute linked work packages only after their gates |
| Bounded algorithm/planner measurements | Complete | Raw samples and repeatable probes in evidence |
| Small scratch browser smoke | Complete with explicit composition limitation | Activity/Communication clean; Jujutsu owner omission recorded |
| Comprehensive optimization implementation | In progress: **27 register entries implemented with receipts** — client C19, C01, C03, C04, C06, C07, C08, C09, C10 (algorithm half), C11, C12, C13, C14, C16, C17, C20; Host H01, H02, H03, H04, H06 (rolling sweeps), H07 (SQL project scoping), H08 (statement reuse), H09 (overlapped sources), H21 (fingerprint cache); tooling T01, T04. Every receipt names its own remainder. | Next: C02, then C05/C15/C18, T02/T03/T05–T07, and Host H05, H10–H20, H22 |
| Full representative before/after acceptance | Not started | Required before claiming optimized behavior |

**Resume here (2026-10-18, round 24 of the goal budget):** 27 entries are implemented and verified in this thread workspace with receipts in [client.md](client.md), [host.md](host.md), [tooling.md](tooling.md) and [evidence](evidence/README.md). Every receipt ends with a **Remaining** note: those tails are real work, not disclaimers — the plan is *not* finished. Untouched entries, in the order worth taking next: **C02** (virtualize the sidebar thread list, the last client P1), **C05** (main-tabs subscriptions while disabled), **C15** (memory read cards vs edit actors), **C18** (lazy attachment bytes), **T02** (share one compiler analysis session), **T03** (trustworthy TypeScript reuse), **T05** (CSS scan inputs), **T06** (scratch preparation), **T07** (lazy CLI imports), and Host **H05, H10, H11, H12, H13, H14, H15, H16, H17, H18, H19, H20, H22**. `M01` (the representative streaming/long-history baseline) is still required before any latency claim; a `test(perf)` ADE harness landed on `main` from another thread and can be reused instead of writing a new one.

**Environment facts a next session needs.** (1) Topology is frozen by the user: keep stacking revisions, do not rebase onto `main` while other threads rewrite the shared graph. (2) This workspace's working copy has been re-materialised repeatedly by concurrent `jj` operations, which **discarded edits** made through the editor tool or left unsnapshotted — write files with a script and run one `jj status` immediately after, then verify the content is in `jj:@`. (3) Known flakes, all recorded in the evidence file: the composer accessible-name lookup (`Message or run a task, …`), `workbench.surface-layouts`'s turn-status count (proved pre-existing by a control run), two thread-sidebar journeys (`mention-insertion`, `referenced-by`), and the memory citation-preview journey. (4) `pnpm check:e2e <plugin>` is now scoped to the selected owner's boot closure: 0.35 s of preparation instead of 41 s, and 13 files hashed instead of 192.

Re-run the pre-existing baseline failures noted in the evidence file before attributing any red check to new work.

## Why

Several paths already bound rendering, request volume and background work, but other owners repeatedly materialize whole session collections, rescan unchanged transcript DOM, retain idle file indexes, rewrite durable snapshots for small events, or traverse all repository artifacts. These costs grow with history, open tabs, workspaces and simultaneous agents even when the visible UI changes little.

### Strongest fresh measurements

| Probe | Observed result | Interpretation |
|---|---|---|
| No-change checkout planning | 74 source-map reads; 53,913,303 bytes; first 297 ms, five warm calls median 171 ms | Direct measured redundant parsing; T01 |
| Pure graph layout, linear 1,000 / 2,000 revisions | Seven post-warmup calls each: median 17.43 / 37.12 ms; maxima 20.41 / 75.15 ms | C10 has a measurable algorithm cost; Node timing is not browser/typing latency |
| Pure graph layout, branchy 1,000 / 2,000 revisions | Median 4.43 / 7.04 ms | Topology matters; do not claim every branchy graph is slow |
| Fresh seven-bundle scratch | Doctor: 173 active entries, all selected bundles loaded; Activity and Communication reaches zero errors | Smoke evidence only, not a full-profile performance distribution |

Earlier warm thread-switch p95 was approximately 98–99 ms at 1/5/20 held turns, without token deltas or long transcripts. A later run of the same harness in another thread reported materially worse and more variable numbers on a different scratch (for example agent creation p50/p95 186.1/587.2 ms, AI Accounts 150.8/968.7 ms), so treat single-run warm results as unstable rather than a stable ~100 ms guarantee. That later run also stalled on repeated-turn output; one unproven hypothesis there is fake-provider completion-id reuse, which would invalidate any streaming benchmark built on it.

Therefore: do not extrapolate the g-run numbers to simultaneous streaming, cold reopen, 2,000-row lists, provider calls, or full-profile startup, and do not treat one run as an SLO. M01 must record run-to-run variance and must prove the synthetic stream itself emits distinct, correct tokens before its timings count.

## How

### Conceptual model

Optimize the owner that creates the cost. Every work package must declare:

- input/work identity and scope;
- canonical owner and cache lifetime;
- invalidation/version and stale-result policy;
- bounded fan-out, queue, retained bytes/entries and cancellation;
- durable acknowledgement and failure behavior;
- before/after correctness and performance evidence.

### Operations / behavior

1. **Observe:** record phase timings, counts and bytes at a work-unit boundary using synthetic/redacted IDs.
2. **Avoid:** do not subscribe, scan, poll or mount when no consumer needs the result.
3. **Reduce:** one traversal/read/flush for a batch; precompute stable joins and indexes once.
4. **Bound:** viewport DOM, idle caches, work queues, provider concurrency and total memory.
5. **Reuse:** share in-flight reads and revision-valid results, not stale authorization or secret material.
6. **Schedule:** protect input/rendering and prioritize visible work; move truly restart-sensitive jobs to an explicit durable contract only when required.
7. **Verify:** compare the same fixture and correctness predicates; reject changes that merely move work into startup, another tab, memory, or provider spend.

### Tech choices

| Choice | Decision | Rationale |
|---|---|---|
| Framework/state | Keep React, existing Query and domain actors | No evidence for a rewrite; Host stays authoritative |
| Virtualization | Reuse existing Virtual boundary | Graph/diffs already use it; apply to remaining large owned lists with keyboard/scroll tests |
| Cross-plugin sharing | Domain-owned typed API/projection | Per-plugin Query clients intentionally do not provide a cross-plugin cache |
| Lazy loading | Separate activation, evaluation and transfer | Current dshx emits exactly one client JS chunk; `import()` alone does not reduce transferred bytes |
| Workers/chunks | Conditional, after algorithm and profile evidence | No unsupported chunk output, private loader workarounds or speculative worker framework |
| Caching | Bounded, versioned, owner-local; security checks preserved | TTL alone is insufficient for identity, credential or mutation safety |
| Concurrency | Explicit rolling bounded workers | Avoid unbounded `Promise.all` and fixed-batch head-of-line blocking; keep causally ordered writes serial |
| Database | Existing store/schema and migrations; query-plan-first | No new native vector dependency or blind index migration |
| Observability | Typed, bounded, redacted work-unit counters | Do not log tokens, launch URLs, prompts, message bodies, credentials or full paths unnecessarily |

### Architecture

```text
Host canonical state / providers / filesystem
           |
   versioned owner-local read models
   + bounded queues and durable batch flushes
           |
    supported typed plugin APIs
           |
 plugin Query cache + domain actors
           |
 narrow subscriptions -> stable row models -> visible rows only
```

No global “performance manager” or generic cache dumping ground. Share only stable semantics with multiple actual callers, at the narrowest existing owner.

## What this allows

- Smooth long-history and large-list interactions without discarding history.
- Lower multi-tab idle CPU, duplicate RPC/provider work and filesystem traffic.
- Faster large-repository graph/search/detail paths.
- Bounded memory during long sessions and cancellation that actually releases work.
- Faster scoped validation while retaining standalone build, boot and test guarantees.

## What this does not allow

- Claiming product-wide wins from syntax inspection, empty fixtures, a single timing, or a stale build.
- Disabling safety guards, durability, validation, permission checks, required telemetry or freshness to improve a benchmark.
- Caching answerability, credentials, authorization, mutable JJ state or user data under an incomplete key.
- Restarting/killing the live :3080 instance, syncing its profile, upgrading/installing global tooling, pushing, or landing this work without a separate request.
- Patching DSH core, replacing native conversation ownership, adding a second authoritative store or promising unsupported bulk APIs.

## UI & UX

### Desktop

No intentional redesign. Existing panels, lists, menus, reference links, tabs and composer retain their behavior. Virtualized views preserve group headers, keyboard navigation, selected-row reveal, focus, context-menu anchors, text selection and scroll position. Cached content must identify loading/stale states honestly; correct new content, not a skeleton/title, ends a timing sample.

### Mobile

Use the same bounded data and row models at the existing narrow layout. Validate touch scrolling, variable-height rows, overlays, focus and viewport changes; do not add desktop-only assumptions to a virtualizer or hidden-panel optimization.

### Common interactions

| Action | Required result |
|---|---|
| Close a palette/panel or disable a feature | Replaceable reads/listeners stop after documented grace; durable jobs follow their explicit contract |
| Reopen cached content | Correct current identity and data; one refresh if stale, not a duplicate poll storm |
| Stream into a long conversation | Decoration work follows changed blocks; offscreen loaded history does not get rescanned every frame |
| Filter/switch repository while a request is pending | Old completion cannot overwrite current results or revive released resources |
| Navigate to an offscreen selected row | Scroll and focus reveal it without losing menu/selection behavior |
| Mutate a repository, credential or stored note | Owner invalidates relevant generations before stale work can publish |

## Data model

No new durable product data is mandated by this plan. Implement only the domain-local structures justified by each package:

| Structure | Owner / key | Required bound and invalidation |
|---|---|---|
| Dirty decoration block set | Conversation decorator / live DOM root | Consume each frame; remove detached nodes; dispose with root |
| Stable visible-row projection | Owning panel / collection+filter+row identities | Reuse unchanged rows; viewport+overscan DOM, pinned focus/menu exceptions |
| Parsed durable read model | Owning Host service / secure file revision | Entry/byte cap, external replacement detection, publish after successful write |
| Shared read flight | Owning domain / full scoped request identity | Independent waiter cancellation; timeout; remove on settle |
| Idle file index | Editor / Session+resolved-root identity | Active entries pinned; idle TTL/LRU and total path/byte budget |
| Batched durable events | Existing service / event/call identity | Queue cap, flush deadline, drain/cancel policy, per-call acknowledgement |
| Provider quota result | AI Accounts / account+credential generation | Explicit fresh mode; bounded positive/negative TTL and auth invalidation |
| Build source dependency manifest | dshx compiler / output+input identity | Derived output; regenerate from compiler, conservatively handle missing/stale manifest |

Any new persistent schema or generated artifact changes its source of truth, regenerates, and receives migration/derived-output tests. Never hand-edit generated output to force a green check.

## Implementation steps

### Priority and sequencing

- **P1:** high-leverage hot/background work or a resource-lifetime defect. Source-confirmed mechanisms still require representative profiling before claiming speedup.
- **P2:** scale/cold-path improvements; implement after measurement or alongside the same owner when cheap and behavior-preserving.
- **Gate:** instrumentation/contract work required before choosing an optimization. No guessed percentage speedups or unmeasured universal SLOs.

| Wave | Work / dependency | Completion evidence |
|---|---|---|
| 0 | M01–M03: representative baseline, budgets and resource accounting | Same-fixture cold/warm distributions, full-profile compatibility, bounded raw evidence |
| 1A | C19 shared-stream lifecycle; C01 decorators; C06 closed palette; C07 composer; C10 graph | Leak reproduction fixed; input/stream frames improve without cold-open or correctness regression |
| 1B | H01 timeline; H02/H03 communication; H04 questions; T01 source-map scans | Count/byte/write reductions and equal durability/authority; no-change planning does not parse full maps |
| 2 | C02/C03 sidebar; C04/C05 shell projections; C12/C13 workspace eligibility | DOM and subscriptions bounded; safety guards remain current and fail closed |
| 3 | H05/H06 accounts; H07/H08/H09/H10 memory | Provider/SQL/scan reductions, scoped recall and cancellation correct |
| 4 | C08/C09 editor; C11/C14/C15/C18/C20 heavy lists and image I/O; C16/C17 idle and drag work | Stable retained-memory/DOM/resource counts during churn and pagination |
| 5 | H11–H22 (usage/JJ/remote/MCP/secrets/marketplace/plugin-updates/titles) and T02–T07 tooling | Owner-specific metrics and focused regression receipts |
| 6 | M04 soak, full affected journeys, benchmark comparison and documentation | Every work item fixed/rejected/deferred with evidence; no critical unknown hidden as complete |

The linked [client](client.md), [Host](host.md) and [tooling](tooling.md) registers specify exact sources, changes, risks and checks. Preserve one described Conventional Commit revision per logical change, with why and a Co-Authored-By trailer; `jj new` before the next logical change. Do not integrate or push during implementation unless requested.

### Work package index

Every checkbox in the three registers is pending implementation. This table is only a map from ID to owner and priority; the register entry is authoritative for behavior, safety and validation.

| ID | Owner / subject | Pri | Register |
|---|---|---|---|
| C01 | Incremental transcript reference decoration (memory, JJ, mentions) | P1 | [client](client.md#c01-incremental-transcript-reference-decoration-p1) |
| C02 | Virtualize the owned thread sidebar | P1 | [client](client.md#c02-virtualize-the-owned-thread-sidebar-p1) |
| C03 | Preserve sidebar row identities | P1 | [client](client.md#c03-preserve-sidebar-row-identities-p1) |
| C04 | Narrow sidebar JJ metadata reads and polling | P1 | [client](client.md#c04-narrow-sidebar-jj-metadata-reads-and-polling-p1) |
| C05 | Narrow main-tabs subscriptions and disabled lifecycle | P2 | [client](client.md#c05-narrow-main-tabs-subscriptions-and-disabled-lifecycle-p2) |
| C06 | Stop catalog derivation while the palette is closed | P1 | [client](client.md#c06-stop-catalog-derivation-while-the-palette-is-closed-p1) |
| C07 | Reuse composer content projection for selection-only updates | P1 | [client](client.md#c07-reuse-composer-content-projection-for-selection-only-updates-p1) |
| C08 | Bound editor file-index retention and cancel abandoned walks | P2 | [client](client.md#c08-bound-editor-file-index-retention-and-cancel-abandoned-walks-p2) |
| C09 | Coalesce editor filesystem-refresh bursts | P2 | [client](client.md#c09-coalesce-editor-filesystem-refresh-bursts-p2) |
| C10 | Reduce graph layout work on the search path (measured algorithm cost) | P1 | [client](client.md#c10-reduce-graph-layout-work-on-the-search-path-p1) |
| C11 | Index and window large changed-file trees | P2 | [client](client.md#c11-index-and-window-large-changed-file-trees-p2) |
| C12 | Index JJ workspace eligibility once per panel snapshot | P1 | [client](client.md#c12-index-jj-workspace-eligibility-once-per-panel-snapshot-p1) |
| C13 | Bound workspace projection-refresh fan-out | P1 | [client](client.md#c13-bound-workspace-projection-refresh-fan-out-p1) |
| C14 | Window accumulated Activity pages | P1 | [client](client.md#c14-window-accumulated-activity-pages-p1) |
| C15 | Separate Memory read cards from editing and window lists | P2 | [client](client.md#c15-separate-memory-read-cards-from-editing-and-window-lists-p2) |
| C16 | Localize quota clocks to displayed precision | P2 | [client](client.md#c16-localize-quota-clocks-to-displayed-precision-p2) |
| C17 | Coalesce drag and layout persistence at the owner | P2 | [client](client.md#c17-coalesce-drag-and-layout-persistence-at-the-owner-p2) |
| C18 | Lazy-load historical attachment bytes | P1 | [client](client.md#c18-lazy-load-historical-attachment-bytes-p1) |
| C19 | Correct shared-stream fallback lifetime and refcounts | P1 | [client](client.md#c19-correct-shared-stream-fallback-lifetime-and-refcounts-p1) |
| C20 | Separate live communication head refresh from loaded history | P1 | [client](client.md#c20-separate-live-communication-head-refresh-from-loaded-history-p1) |
| H01 | Batch Activity Timeline ingestion and cache its read model | P1 | [Host](host.md#h01-batch-activity-timeline-ingestion-and-cache-its-read-model-p1) |
| H02 | Aggregate Agent Communication unread counts once per state revision | P1 | [Host](host.md#h02-aggregate-agent-communication-unread-counts-once-per-state-revision-p1) |
| H03 | Reduce durable communication telemetry write amplification | P1 | [Host](host.md#h03-reduce-durable-communication-telemetry-write-amplification-p1) |
| H04 | Share concurrent native question fact reads without stale authority | P1 | [Host](host.md#h04-share-concurrent-native-question-fact-reads-without-stale-authority-p1) |
| H05 | Make account reads revision-aware and route refreshes no-op when unchanged | P2 | [Host](host.md#h05-make-account-reads-revision-aware-and-route-refreshes-no-op-when-unchanged-p2) |
| H06 | Share per-account quota reads and use rolling bounded workers | P1 | [Host](host.md#h06-share-per-account-quota-reads-and-use-rolling-bounded-workers-p1) |
| H07 | Scope memory retrieval in SQL and bound vector ranking work | P1 | [Host](host.md#h07-scope-memory-retrieval-in-sql-and-bound-vector-ranking-work-p1) |
| H08 | Reuse memory SQL statements and bound large maintenance batches | P2 | [Host](host.md#h08-reuse-memory-sql-statements-and-bound-large-maintenance-batches-p2) |
| H09 | Run independent thread-finder sources concurrently and batch metadata hydration | P2 | [Host](host.md#h09-run-independent-thread-finder-sources-concurrently-and-batch-metadata-hydration-p2) |
| H10 | Incrementalize and globally bound memory digest/classifier work | P1 | [Host](host.md#h10-incrementalize-and-globally-bound-memory-digestclassifier-work-p1) |
| H11 | Avoid full idle usage discovery and enforce index IO/CPU budgets | P1 | [Host](host.md#h11-avoid-full-idle-usage-discovery-and-enforce-index-iocpu-budgets-p1) |
| H12 | Cache or incrementally materialize usage chart projections | P2 | [Host](host.md#h12-cache-or-incrementally-materialize-usage-chart-projections-p2) |
| H13 | Reduce cold JJ integration process fanout (measurement/CLI feasibility gate) | P2 | [Host](host.md#h13-reduce-cold-jj-integration-process-fanout-p2-measurementcli-feasibility-gate) |
| H14 | Parallelize/lazily load immutable Jujutsu detail data | P1 | [Host](host.md#h14-parallelizelazily-load-immutable-jujutsu-detail-data-p1) |
| H15 | Separate Jujutsu mutable snapshots from slow-changing adjunct reads | P1 | [Host](host.md#h15-separate-jujutsu-mutable-snapshots-from-slow-changing-adjunct-reads-p1) |
| H16 | Share remote read snapshots within existing gateway lifetimes | P2 | [Host](host.md#h16-share-remote-read-snapshots-within-existing-gateway-lifetimes-p2) |
| H17 | Coalesce MCP reconciliation and avoid unnecessary credential work | P2 | [Host](host.md#h17-coalesce-mcp-reconciliation-and-avoid-unnecessary-credential-work-p2) |
| H18 | Cache only decoded Secret Catalog metadata | P2 | [Host](host.md#h18-cache-only-decoded-secret-catalog-metadata-p2) |
| H19 | Cache public marketplace pages and bound catalog response bodies | P2 | [Host](host.md#h19-cache-public-marketplace-pages-and-bound-catalog-response-bodies-p2) |
| H20 | Editor file-index lifecycle and relist batching (explicit C08/C09 cross-reference) | P2 | [Host](host.md#h20-editor-file-index-lifecycle-and-relist-batching-cross-reference-only) |
| H21 | Avoid rehashing every plugin Host bundle on every update check | P1 | [Host](host.md#h21-avoid-rehashing-every-plugin-host-bundle-on-every-update-check-p1) |
| H22 | Hydrate thread titles only for emitted unfiltered rows | P2 | [Host](host.md#h22-hydrate-thread-titles-only-for-emitted-unfiltered-rows-p2) |
| T01 | Read compact build dependencies, not complete source maps (measured) | P1 | [tooling](tooling.md#t01-read-compact-build-dependencies-not-complete-source-maps-p1-measured-done) |
| T02 | Share compiler source analysis within a build generation | P2 | [tooling](tooling.md#t02-share-compiler-source-analysis-within-a-build-generation-p2) |
| T03 | Reuse trustworthy TypeScript work without bypassing validation | P2 | [tooling](tooling.md#t03-reuse-trustworthy-typescript-work-without-bypassing-standalone-validation-p2) |
| T04 | Scope browser-check prerequisites and digests to selected owners | P1/P2 | [tooling](tooling.md#t04-scope-browser-check-prerequisites-and-artifact-digests-to-selected-owners-p1p2) |
| T05 | Align shared CSS scanning and cache inputs | P2 | [tooling](tooling.md#t05-align-shared-css-scanning-and-cache-inputs-p2-measurement-gate) |
| T06 | Remove repeated scratch preparation without sharing mutable test state | P2 | [tooling](tooling.md#t06-remove-repeated-scratch-preparation-without-sharing-mutable-test-state-p2) |
| T07 | Lazy CLI command implementation imports | P2 | [tooling](tooling.md#t07-lazy-cli-command-implementation-imports-p2) |

Anchor links resolve against the register headings; a heading rename must update this table.

### M01 — Representative performance matrix (Gate)

0. **Prove the synthetic stream before timing it.** Another thread's long-history run stalled on repeated-turn output while the fake provider reused a fixed completion id (`created: 1`), so turn 2 showed stale turn-1 content. Confirm or reject completion-id reuse and add deterministic regression coverage; add a bounded synthetic streaming directive only if needed. A streaming benchmark built on stale output is worthless. Any change under `tooling/dshx/.../scratch` also runs the maintain-verify-dsh skill.
1. Extend the existing ADE harness instead of creating a competing benchmark authority. Boot an explicitly selected complete supported composition in a uniquely named scratch home; include the actual owner for every exercised API. Do not weaken doctor or silently accept unknown errors. Pass the exact scratch `--state-dir` on every command (an outer-shell `TMPDIR` can differ from the process default), and remember the live composer label can differ from the harness default.
2. Use 1/5/20 simultaneous **streaming** synthetic turns with controlled token rates and stop/cancel behavior, plus 500/2,000-message transcripts, 2,000+ stored sessions, 100/1,000 workspace rows, 100/500/1,000/2,000 loaded revisions, 1,000+ changed files, 20 pages of Activity, 30+ visited editor sessions, and 1/4 tabs. Add database/account/network fixtures from their work packages; these are separate dimensions, not one enormous confounded run.
3. Separate first process startup, cold/released Host reopen, retained warm switch, query/RPC wait, data projection, render and correct-content visibility. Record at least 30 observations per interaction where practical; report sample count, raw values, median, p95, max and environment. Preserve ordered-run/JIT/cache/GC caveats, and report at least two independent runs so run-to-run variance is visible: an earlier thread saw one g-run near 98–99 ms p95 and a later h-run on the same harness reach 186/587 ms and 968.7 ms p95 on individual paths.
4. Count Host calls, subprocesses, provider requests, bytes read/serialized/transferred, SQL statements/rows, open streams/watches, queue depth, React commits, DOM, long tasks, frame gaps and retained heap. Do not infer stable memory from a coarse Chromium heap snapshot.
5. No paid/provider/remote mutation or inspection of private corpora without appropriate scope. Synthetic local fixtures first; read-only representative user data only when explicitly appropriate and redacted.

### M02 — Budgets and causal profiles (Gate)

Proposed acceptance targets, not measured current guarantees:

- Input-critical owned work: aim below an 8 ms per-frame share on the recorded machine; no new >50 ms long task from tested owned work at the agreed scale.
- Warm correct-content navigation: no material regression from the existing ~100 ms thread-switch baseline; set final per-path p95 targets after the full-profile baseline. Report Host, render and two-frame proxy separately.
- Virtual lists: mounted rows scale with viewport+overscan+documented pinned items, not total result count. Use deterministic row-count assertions rather than fragile CPU thresholds in unit CI.
- Closed palette: zero thread-catalog recomputations for unrelated session updates. Incremental decorators: visited blocks proportional to changed blocks, not loaded history.
- Concurrent duplicate reads: one underlying generation/request per complete key. Provider and projection fan-out never exceeds its explicit configured bound.
- Lifecycle: after close/dispose and documented grace, replaceable queued work and owned resource counts return to baseline; retained idle caches respect explicit entry/byte bounds.
- Durable batching: every acknowledged item survives reopen; bounded flush latency and backpressure, no silent dropped attention/audit records.
- Tooling: unchanged scoped checks remain cache hits and no unrelated package is built just to validate one owner, unless a declared shared dependency changed.

Profile only a small number of failing work units deeply. Prefer eliminating work and improving algorithms before adding workers, queues, memoization layers or caches.

### M03 — Regression counters and observability (Gate)

Add typed, opt-in counters/spans at the owners touched by implementation: work ID/correlation, generation, input/output counts, bytes, cache hit/miss/inflight, queue depth, duration and cancellation. Keep payloads bounded/redacted. Reuse existing project-check receipts and the verification harness; no duplicate adapter-level audit stream. Deterministic work-count budgets run in CI; environment-sensitive latency comparisons retain raw samples and tolerance.

### M04 — Rollout and acceptance

For each wave: reproduce → focused behavioral regression → change → same-fixture before/after → source validation → Host import check → affected full plugin journey on scratch → explicit old-Host/new-client compatibility → durable docs. UI class changes rebuild both the plugin and shared stylesheet. Profile/Host changes require a user's later restart; source validation is not proof the live instance updated.

Finish with a full supported profile cold start, 20-stream stress, multi-tab idle/churn soak and the agreed scale matrix. Record deferred/rejected items and concrete public-API gaps separately; no unreachable core optimization is a local TODO. Once implementation truly finishes, use the complete-plan skill to move durable contracts/results into owning docs and retire this plan.

## Open questions

No user decision blocks starting the evidence-first work. User selected the `performance-optimization` name. Remaining engineering questions are answered by the first measurements, not guessed now:

1. Which full-profile owner dominates input and streaming costs after long histories are loaded?
2. Which exact budgets remain useful on the target machine and in CI without flakiness?
3. Can existing supported observations supply narrow incremental state? If not, stop at the documented Host boundary.
4. Do byte/startup profiles justify splitting existing owned bundles or worker evaluation, within the single-chunk protocol?
5. Is any long-running background operation restart-sensitive enough to need a durable job lifecycle rather than a bounded in-process queue?

## Acceptance criteria

### This audit/plan deliverable

- [x] Concrete source locations, workload, fix direction, ownership/invalidation risks and focused checks recorded.
- [x] Measured costs separated from source-confirmed opportunities and unmeasured product impact.
- [x] Prior optimizations, unsupported boundaries and runtime-composition limitations retained explicitly.
- [x] No product fix, core patch, live restart/profile sync, integration or push performed.
- [x] Fresh scratch resources stopped with no owned processes left running.

### Future implementation

- [ ] M01–M04 pass with a complete supported profile and representative workload.
- [ ] Every accepted client/Host/tooling item fixed, or explicitly rejected/deferred with measurement and owner.
- [ ] No stale result, authorization, privacy, durability, rebase-safety, cancellation, accessibility or keyboard regression.
- [ ] Resource budgets and cache/queue caps documented and tested.
- [ ] Narrow tests, affected plugin journeys, baseline comparisons and final repository checks recorded separately from known failures.
- [ ] Durable results moved into owning documentation; plan retired only when actual work is complete.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-18 | User chose `performance-optimization` | One repository-wide master plan |
| 2026-10-18 | Audit and plan only; extend existing owned implementations | User requested a fix plan; avoid unreviewed product changes |
| 2026-10-18 | Keep React, Query and Host authority | Existing integration and no demonstrated case for a migration |
| 2026-10-18 | Preserve JJ/question/communication caches and bounded fan-out already present | Older hypotheses and broad scanner warnings are not current proof |
| 2026-10-18 | Rank measured planner/graph costs separately from static opportunities | Prevent an empty/warm/synthetic result becoming a universal claim |
| 2026-10-18 | Stop at supported Host/core boundaries | Repository contract forbids core patches and unsafe substitutes |
