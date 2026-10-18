# Client optimization work register

## Contract and evidence

This is an implementation plan, not implemented work. Extend the existing owned plugin clients, Query caches and domain actors. Keep Host state authoritative; do not patch DSH core, replace its transcript owner, introduce another authoritative store, or invent unsupported batch/watch APIs. Follow the [master plan's measurement and rollout gates](README.md#implementation-steps).

- **Static-confirmed** means the cited current source performs the described work. It does not establish user-visible delay or a speedup.
- **Measured** applies only to C10's pure Node graph-layout probe below. Browser/input/frame impact remains unmeasured.
- **P1** identifies high-leverage input/background work or resource-lifetime defects; **P2** identifies conditional scale/interaction work. Priority is not measured severity.
- All C01–C20 checkboxes remain pending implementation. Establish representative before/after measurements; reject or defer a proposed change if its workload does not demonstrate useful savings.
- Existing dshx client output is exactly one JS chunk. Distinguish lazy activation, evaluation and transfer; `import()` alone is not a supported code-splitting solution.
- Counters must contain bounded counts, generations and synthetic/redacted identities—not prompts, tokens, drafts, secrets, launch URLs or message bodies.

The [earlier ADE baseline](../ade-performance/README.md#measurement-rules-and-caveats) measured short, non-streaming held turns and five selected bundles. Its warm navigation numbers do not measure these full-profile, long-history, streaming, large-corpus or multi-tab workloads. Current JJ caches supersede the earlier uncached-inventory hypothesis.

## Work packages

### C01 — Incremental transcript reference decoration · P1

- [ ] **Pending implementation.** Static-confirmed; streaming impact unmeasured.
- **Sources / behavior:** [Memory decoration:45–54,84–94](../../plugins/@dshfiles/memory/src/memory-reference-links.ts#L45-L94), [JJ decoration:61–90](../../plugins/@dshfiles/jujutsu/src/chat-reference-links.ts#L61-L90), [session mentions:133–152](../../plugins/@dshfiles/mentions/src/client-entry.ts#L133-L152). Body-wide observers discard mutation records and schedule complete eligible-block/code/link scans once per animation frame. Memory reconstructs text through TreeWalker; unrelated DOM updates and the decorators' own writes can schedule work over unchanged history. rAF coalescing limits frequency, not work per frame.
- **Implement:** 1. Track dirty blocks and added subtrees from MutationRecords. 2. Process only affected conversation roots; handle root replacement and detached nodes. 3. Make self-generated decoration mutations idempotent or explicitly recognizable; preserve an initial bounded scan.
- **Ownership / safety:** Each decorator owns its observer, queued nodes and cleanup. Preserve React-owned node identity, inline-markup spans, excluded composer/link/code regions, keyboard activation and JJ prefix restoration. Share only proven common semantics, not a generic DOM-scanning service.
- **Validate:** Regress added/edited/removed references, split inline nodes, multiple conversation surfaces, streaming and HMR disposal. With 500/2,000 loaded messages plus controlled token deltas, count visited blocks and observer passes; unchanged-history visits must not grow with total history. Compare frame p95 and long tasks against the same stream.

### C02 — Virtualize the owned thread sidebar · P1

- [ ] **Pending implementation.** Static-confirmed; large-list impact unmeasured.
- **Sources / behavior:** [Sidebar attention/status/project/date rendering:2985–3078](../../plugins/@dshfiles/thread-sidebar/src/client.tsx#L2985-L3078) maps every root in expanded groups. Child caps and collapsed sections exist, but neither bounds the number of expanded root rows.
- **Implement:** 1. Flatten visible headers, roots and expanded children into one ordered model. 2. Reuse existing Virtual support with measured variable heights and bounded overscan. 3. Pin sticky headers and active focus/menu/drag anchors where necessary; implement selected-child reveal through the row model rather than scanning only mounted DOM.
- **Ownership / safety:** Sidebar owns presentation, not Host history. Preserve all grouping/filter/order/count semantics, child attention, archive undo, context menus, keyboard focus and the focus-thread event. Do not hide records by silently truncating data.
- **Validate:** Exercise 2,000 roots, nested running/finished children, every grouping/filter and an offscreen selected child. Assert mounted rows are bounded by viewport + overscan + documented pins, independent of root count. Compare scroll, selection and one-session-update p95, DOM size and retained heap.

### C03 — Preserve sidebar row identities · P1

- [ ] **Pending implementation.** Static-confirmed; rerender cost unmeasured.
- **Sources / behavior:** [Row derivation:2383–2437](../../plugins/@dshfiles/thread-sidebar/src/client.tsx#L2383-L2437) filters/partitions children on every parent render and passes global unread/attention collections to memoized rows. [Partitioning:119–132](../../plugins/@dshfiles/thread-sidebar/src/thread-children.ts#L119-L132) allocates arrays even for empty children; `show` also creates a fresh empty finished array. These identities defeat default row memoization despite stable actions/style.
- **Implement:** 1. Derive per-root view models outside row creation. 2. Reuse unchanged child slices and canonical empty arrays. 3. Pass per-row/child attention values or structurally stable slices instead of global collection references; retain existing stable actions.
- **Ownership / safety:** Keep derivation pure and invalidate on child membership, status, selection, mute/unread, preferences and locale. A custom comparator must not suppress a changed child, action or translated label.
- **Validate:** Count row renders for unrelated status/selection/unread changes; untouched roots remain stable and affected parent/child rows update. Compare 2,000 roots with 20 changing sessions before/after; verify identical rows, badges and child reveal.

### C04 — Narrow sidebar JJ metadata reads and polling · P1

- [ ] **Pending implementation.** Static-confirmed; subprocess/network impact unmeasured.
- **Sources / behavior:** [Sidebar inventory polling:950–956,1040–1061](../../plugins/@dshfiles/thread-sidebar/src/client.tsx#L950-L1061) requests full repositories and manually refetches every 30 seconds, independently of browser visibility. The result supplies integrated badges as well as rebased autoarchive. [Host caches:233–318](../../plugins/@dshfiles/jj-integration/src/host.ts#L233-L318) already provide location, status and repository-view TTLs, single-flight and generation protection; they must not be proposed again as missing.
- **Implement:** 1. Inventory the exact sidebar metadata requirements. 2. Add a narrow owned jj-integration read model for rebased metadata/session identities if existing APIs cannot provide it cheaply. 3. Use Query-owned polling/focus invalidation, stop repeated unsupported-owner failures and define when inventory refresh is actually needed. Consider the home rebase count in the same metadata contract, not a duplicate work package.
- **Ownership / safety:** JJ owner invalidates after integration/discard/registration and external changes under its documented freshness policy. Do not gate solely on disabled autoarchive and remove badges. Preserve enabled autoarchive's background contract explicitly; visibility throttling is not permission to stop required work.
- **Validate:** Check integrated markers, delayed/immediate archive, cross-tab changes, missing owner and hidden→visible transitions. With 100 workspaces and several tabs, count RPC bytes, cache hits and actual JJ child processes per idle minute; distinguish existing cache reuse from avoided work.

### C05 — Narrow main-tabs subscriptions and disabled lifecycle · P2

- [ ] **Pending implementation.** Static-confirmed; large-session impact unmeasured.
- **Sources / behavior:** [Main-view tracking and overlay joins:140–165,201–208](../../plugins/@dshfiles/main-tabs/src/client.tsx#L140-L208), [workspace resolver:30–67](../../plugins/@dshfiles/main-tabs/src/host-target.ts#L30-L67). Every session-list notification rebuilds session arrays, workspace/parent joins, known-ID sets and missing-tab scans before navigation-key deduplication. The setup subscriptions remain when the tabs machine is off; the overlay rebuilds full maps for a small set of tab identities.
- **Implement:** 1. Separate membership/project indexes from changing titles/status. 2. Cache indexes against narrow membership/root inputs and select summaries for referenced tab IDs. 3. Suspend expensive tracking while disabled and perform one complete resync on enable.
- **Ownership / safety:** Main-tabs owns tab presentation; Host remains canonical for availability and navigation. Preserve missing-thread reconciliation, subagent ancestor fallback, cycle guards and project changes. Do not retain deleted sessions through a stale index.
- **Validate:** Toggle off/on around create/delete/move and subagent navigation. For 2,000 sessions and 20 changing sessions, count full index rebuilds, list traversals, subscriptions and tab renders per emission; compare navigation correctness and p95 separately.

### C06 — Stop catalog derivation while the palette is closed · P1

- [ ] **Pending implementation.** Static-confirmed; idle/open tradeoff unmeasured.
- **Sources / behavior:** [Palette overlay:51–116](../../plugins/@dshfiles/command-palette/src/client.tsx#L51-L116) subscribes to complete session/workspace stores and materializes context/thread projections before returning for `mode === null`. Thread joins use archived-ID `includes` and workspace `find` per session.
- **Implement:** 1. Keep only the small PaletteApi open/close gate mounted. 2. Mount catalog subscriptions/derivation when open. 3. Replace repeated joins with scoped Set/Map indexes. Introduce bounded idle precomputation only if cold-open measurements justify it.
- **Ownership / safety:** Open-body teardown must cancel replaceable searches and file subscriptions. Reopening must use current titles, projects, archives, locale and action registry. Do not improve idle CPU by materially regressing first correct-content open latency.
- **Validate:** Assert zero closed-palette catalog derivations during unrelated session churn, then open and verify latest metadata. Measure closed 2,000-session churn and separate cold/warm opens; retain existing ranking/result bounds and keyboard behavior. This is lazy activation, not unsupported chunk splitting.

### C07 — Reuse composer content projection for selection-only updates · P1

- [ ] **Pending implementation.** Static-confirmed; long-draft input impact unmeasured.
- **Sources / behavior:** [Lexical listener/projection:95–99,150–158](../../plugins/@dshfiles/rich-composer/src/native/input/editor/runtime.ts#L95-L158), [content-change guard:190–209](../../plugins/@dshfiles/rich-composer/src/native/input/facade.ts#L190-L209), [full projection:56–132,200–235](../../plugins/@dshfiles/rich-composer/src/native/input/editor/projection.ts#L56-L235). Every commit walks all content, rebuilds maps/two strings/chip occurrences, then suppresses publication if only selection changed. Existing suppression avoids React updates, not projection work.
- **Implement:** 1. Use installed Lexical update/dirty metadata to distinguish content from selection-only commits. 2. Cache content layout/occurrences for the current valid content identity. 3. Recompute selection offsets against that layout; rebuild on actual content/decoration changes.
- **Ownership / safety:** DraftEditorRuntime owns cache lifetime. Never reuse stale LexicalNode references across incompatible EditorStates. Preserve chip coordinates, draft revision/CAS guards, commands, IME, undo/redo and submit snapshots.
- **Validate:** Use long multi-block/chipped drafts for 100 caret moves, range selections, typing, paste, decoration changes, undo and submit. Assert content walks are absent on selection-only updates and exact projection/offset equivalence on edits. Compare input latency and allocations; do not remove existing publication guards.

### C08 — Bound editor file-index retention and cancel abandoned walks · P2

- [ ] **Pending implementation.** Static-confirmed; long-session retention impact unmeasured.
- **Sources / behavior:** [Index state/lifetime:152–180,278–349](../../plugins/@dshfiles/editor/src/workspace-files.ts#L152-L349). The sessions Map retains every index until plugin disposal. Final subscriber release stops watches after a grace period but does not evict paths/listings; walks use only the global disposal signal. Per-index file/directory caps do not bound the number of retained session indexes.
- **Implement:** 1. Add per-index operation identity/controller. 2. Preserve short reopen grace, then cancel unneeded walks/queued relists. 3. Add idle LRU/TTL and total retained entry/path/byte budgets, pinning active consumers. Mark canceled partial indexes incomplete so reopening resumes or rebuilds honestly.
- **Ownership / safety:** Editor owns Session-scoped authorization/root identity. Do not merge sibling-session caches by cwd alone. Eviction must release timers/watches and prevent late completion from publishing or reattaching resources.
- **Validate:** Close during a walk, reopen inside/outside grace, visit 30+ sessions and dispose mid-read. Assert retained idle indexes respect the configured budget and outstanding work returns to baseline. Measure retained paths/bytes and first useful file results, preserving existing 8-way lists, caps, progress cadence and watch debounce.

### C09 — Coalesce editor filesystem-refresh bursts · P2

- [ ] **Pending implementation.** Static-confirmed; filesystem-burst impact unmeasured.
- **Sources / behavior:** [Directory watch invalidation:26–47](../../plugins/@dshfiles/editor/src/file-tree.tsx#L26-L47) invalidates per change frame. [Open-document watch:192–209](../../plugins/@dshfiles/editor/src/editor-store.ts#L192-L209) reads changed files and hashes dirty-buffer disk contents per observed version. Save/build bursts can repeatedly cancel/refetch directory listings or process obsolete intermediate file versions.
- **Implement:** 1. Coalesce directory invalidations over a short bounded window. 2. Maintain per-document single-flight reload plus a trailing latest-version/dirty marker. 3. Abort replaceable loads and generation-check close/reopen and superseding reads; always process a final pending change.
- **Ownership / safety:** Keep dirty-buffer content and SHA-based save/conflict authority intact. Deletion, final version, manual refresh and writes arriving during reload cannot be dropped. Keep these schedulers at their editor domain owners rather than globally debouncing Query.
- **Validate:** Emit 100 change frames during slow list/read/hash operations, including dirty/saved files and close/reopen of the same ID. Assert exact final disk version/conflict state and bounded active reads. Count list/readBytes/hash executions per coalesced work unit, not only render time.

### C10 — Reduce graph layout work on the search path · P1

- [ ] **Pending implementation.** Static-confirmed and measured algorithm cost; browser/input impact unmeasured.
- **Sources / behavior:** [Host search debounce and local layout dependencies:387–416,501–527](../../plugins/@dshfiles/jujutsu/src/client.tsx#L387-L527). Server graph search is debounced 250 ms, but local filtering/topology layout depends on immediate `textFilter` and can run for each keystroke across all loaded pages.
- **Measurement:** Current-source pure Node layout, one warmup + seven samples per case: linear 1,000 median **17.43 ms**, max **20.41 ms**; linear 2,000 median **37.12 ms**, max **75.15 ms**. Branchy 1,000/2,000 medians **4.43/7.04 ms**. A second run of the same runner minutes later gave linear 1,000 median 15.94 ms and linear 2,000 median 29.23 ms, so treat these as order-of-magnitude and variance evidence, not a threshold. See [first](evidence/graph-results.json) and [second](evidence/graph-results-rerun.json) raw samples. These are algorithm observations, not browser frame, typing or paint measurements; topology matters.
- **Implement:** 1. Profile layout stages and improve repeated traversal/index work identified by the probe. 2. Separate typed input from committed/deferred topology work; avoid layout when visible graph identity is unchanged. 3. Keep any snapshot/layout cache bounded and repository/generation keyed before considering workers or compiler changes.
- **Ownership / safety:** Preserve search request identity, lane/ancestry-gap topology, filters, selection/locate and pinned drag source. Do not present stale results as current while deferring work; repository mutations invalidate relevant layouts.
- **Validate:** Compare exact row/link fixtures and rapid query→repository switches. Repeat the same pure 100/500/1,000/2,000 linear/branchy probe, retaining raw distributions, then measure correct-content browser keypress latency and layout counts. Existing graph row virtualization, initial 100-row page and server debounce remain.

### C11 — Index and window large changed-file trees · P2

- [ ] **Pending implementation.** Static-confirmed; large-revision impact unmeasured.
- **Sources / behavior:** [ChangedFiles:78–81,164–210](../../plugins/@dshfiles/jujutsu/src/changed-files.tsx#L78-L210) recursively gathers each folder's descendant files and selected count on render, including collapsed folders and cases without selection controls. Descendants are revisited at ancestors; every visible file row/context-menu owner mounts.
- **Implement:** 1. Compute descendant paths/counts once per file-tree input. 2. Skip selection work when selection is unavailable and derive selected counts through indexes. 3. Flatten/window large visible file trees while retaining collapsed-folder state.
- **Ownership / safety:** Invalidate on file/stat/status inputs and review/selection changes. Preserve subtree checkbox tri-state, select-all, review hiding, deleted-file editor restrictions and menu/focus anchors. Do not conflate file-list work with the already-virtualized patch viewer.
- **Validate:** Deep 1,000+ file trees, collapse/expand, review updates and directory select-all yield identical results. Count descendant visits and mounted rows; compare selection/toggle p95, including large flat lists.

### C12 — Index JJ workspace eligibility once per panel snapshot · P1

- [ ] **Pending implementation.** Static-confirmed; workspace/session-scale impact unmeasured.
- **Sources / behavior:** [Per-row subscriptions/getters:309–334](../../plugins/@dshfiles/jj-integration/src/panel.tsx#L309-L334) installs three session-list subscriptions per displayed row; two getters traverse all sessions for same-cwd activity. [Classification/counts/groups:746–774,789–798,956–1007](../../plugins/@dshfiles/jj-integration/src/panel.tsx#L746-L1007) repeatedly invokes classification with further whole-session scans. Initial six-row/group display does not bound global classification work.
- **Implement:** 1. Build one panel-owned Session-by-cwd/running/question index from narrow inputs. 2. Derive one workspace category map and group/count output. 3. Pass stable eligibility scalars to rows instead of repeating full-store getter scans.
- **Ownership / safety:** Host eligibility and mutation-time guards remain authoritative and fail closed. Unknown projections cannot become permission to integrate. Include active same-cwd sessions absent from the workspace's explicit session list; refresh on question/running changes without stale memoization.
- **Validate:** Cover same-cwd unlisted running sessions, pending questions, unknown activity, category/count agreement and a safety transition immediately before integration. With 100/1,000 workspaces and 2,000 sessions, assert bounded panel subscriptions and approximately one indexing traversal per relevant snapshot rather than per row/filter.

### C13 — Bound workspace projection-refresh fan-out · P1

- [ ] **Pending implementation.** Static-confirmed; cold-panel RPC impact unmeasured.
- **Sources / behavior:** [Projection refresh:733–745](../../plugins/@dshfiles/jj-integration/src/panel.tsx#L733-L745) starts `refreshProjections` for all sessions in all repository threads, including rows hidden beyond the six/group display, with no client concurrency cap. The requested-ID Set is updated before success and retains failed IDs.
- **Implement:** 1. Use a deduped bounded rolling queue, prioritizing displayed/selected workspaces. 2. Cancel queued/unneeded work on panel/input disposal, subject to the actual public cancellation contract. 3. Track success/failure separately and allow explicit bounded retry/backoff. Use a batch method only if supported; do not invent one.
- **Ownership / safety:** Panel owns replaceable reads; Session identity and operation generation protect late answers. A missing/failed projection stays unknown and integration-disabled. Do not repeatedly refresh already-valid projections or starve offscreen work forever.
- **Validate:** Assert configured peak concurrency, per-ID deduplication, visible-first ordering, failure→retry and disposal. With 1,000 sessions, measure first-visible safe-eligibility time, total RPCs, queue depth and cancellation, not just panel skeleton appearance.

### C14 — Window accumulated Activity pages · P1

- [ ] **Pending implementation.** Static-confirmed; backfill/render impact unmeasured.
- **Sources / behavior:** [Older-page lifecycle, merge and render:129–151,173–204,324–340](../../plugins/@dshfiles/activity-timeline/src/panel.tsx#L129-L340). Pages contain 80 items; loaded older pages accumulate within retained history, are merged/deduped/sorted, and all rows mount. Row date formatting is not memoized; unrelated panel updates reconcile the accumulated list.
- **Implement:** 1. Key paged history by filter identity and reject/cancel stale older-page completion. 2. Maintain ordered ID-based merging with structural reuse. 3. Virtualize variable-height rows and preserve selected/scroll anchors.
- **Ownership / safety:** Do not claim server retention or each latest-page poll is unbounded. Preserve condensed-group/event identity, duplicates, cursor semantics, near-bottom follow, pending-new indication and position on prepend/filter change.
- **Validate:** Load 20 pages, overlap duplicate/condensed events and change filters during an older request. Assert correct content/order and stable scroll anchors. Mounted rows must remain viewport-bounded; compare 1,600-event selection/append/filter p95, date-format counts and DOM.

### C15 — Separate Memory read cards from editing and window lists · P2

- [ ] **Pending implementation.** Static-confirmed; large-corpus impact unmeasured.
- **Sources / behavior:** [Note actors/cards/detail and digest rows:79–88,227–288,321–347](../../plugins/@dshfiles/memory/src/memory-panel.tsx#L79-L347) mounts an editor actor plus MarkdownText for every note, and another editor in selected detail. All digest rows mount. [Host limits:408–421,454–457](../../plugins/@dshfiles/memory/src/host.ts#L408-L457) already cap notes at 500 and digests at 300; this is a substantial bounded list, not unlimited fetching.
- **Implement:** 1. Split lightweight memoized read cards from activated edit actors. 2. Assign selected/dirty draft ownership outside disposable virtual rows. 3. Group once and virtualize variable-height cards/digests. Add cursor pagination through the owned API only if access beyond present caps is a separate accepted requirement.
- **Ownership / safety:** Scrolling must not discard dirty edits; preserve versioned note IDs, save/forget failure recovery, selected detail/history and project transitions. Do not create a second authoritative note store.
- **Validate:** Test 500 long-markdown notes, offscreen editing, selection/detail duplication, save/cancel/forget and project switching. Count actors, Markdown work and mounted rows; compare correct-content opening/search p95 and retained memory.

### C16 — Localize quota clocks to displayed precision · P2

- [ ] **Pending implementation.** Static-confirmed; foreground-idle impact unmeasured.
- **Sources / behavior:** [Compact quota surfaces:182–194,255–264](../../plugins/@dshfiles/ai-accounts/src/quota-footer.tsx#L182-L264) regenerate summary/arrangement/tooltips every second. The disabled strip still calls `useNow` and `useShortNames` before returning. [Clock:16–35](../../plugins/@dshfiles/ai-accounts/src/usage-overview.tsx#L16-L35) already pauses in hidden browser tabs. [Compact formatting:183–208](../../plugins/@dshfiles/ai-accounts/src/usage-overview-model.ts#L183-L208) has minute/reset precision; the open overview's snapshot-age clock deliberately displays seconds.
- **Implement:** 1. Gate disabled strips outside the active body. 2. Memoize usage/layout-derived summaries. 3. Use a minute/reset-boundary clock for closed compact chrome and local seconds only for displayed age readouts; catch up on visibility/focus.
- **Ownership / safety:** Preserve exact reset crossings, exhausted/reserve states and the open second-resolution age display. Hiding a footer must not suppress a separately enabled usage surface or required quota reads.
- **Validate:** Disabled strip owns no unused timer/file query; test impending reset, exhausted quota, popover open/close and visibility return. Compare commits/CPU over 10 foreground-idle minutes with 20 accounts, separately for closed and open detail.

### C17 — Coalesce drag and layout persistence at the owner · P2

- [ ] **Pending implementation.** Static-confirmed; event frequency/drag impact unmeasured.
- **Sources / behavior:** [Workbench persistence:60–76](../../plugins/@dshfiles/workbench/src/workbench-view.tsx#L60-L76) calls `toJSON`→store.set and creates fresh open IDs on every layout event. [Edge widget:87–95,111–134](../../plugins/@dshfiles/ai-accounts/src/edge-usage.tsx#L87-L134) persists React position updates during pointer motion. [Stored-value setter:85–93](../../plugins/@dshfiles/plugin-ui/src/hooks/stored-value.ts#L85-L93) validates, publishes, stringifies and writes localStorage synchronously.
- **Implement:** 1. Measure Dockview layout-event frequency, then coalesce/debounce persistence with a final unmount/pagehide flush. 2. Update open-ID state only when membership changes. 3. rAF-limit edge-widget transient movement and durably commit final drop/cancel/resize position.
- **Ownership / safety:** Workbench/widget own interaction scheduling. Do not globally debounce createStoredValue: other callers require immediate durability. Preserve final pointer sample, cancellation, cross-tab/storage failure behavior and layout roundtrip; clean up pending timers/listeners.
- **Validate:** Drag/resize many split/tab groups, cancel, unmount and restore. Assert final serialized layout/position equality and no lost last change. Count storage writes/serialized bytes per gesture and compare frame p95; do not infer Dockview emits at pointer frequency without tracing it.

### C18 — Lazy-load historical attachment bytes · P1

- [ ] **Pending implementation.** Static-confirmed; image-rich-history impact unmeasured.
- **Sources / behavior:** [MessageImage loading/gallery mounting:62–92,150–183](../../plugins/@dshfiles/attachment-gallery/src/MessageImage.tsx#L62-L183) starts loading every mounted attachment; a live flag only suppresses late UI updates. [Historical cache:36–52,103–129,140–159](../../plugins/@dshfiles/rich-composer/src/native/conversation/historical-images.ts#L36-L159) correctly deduplicates Session-binding/attachment reads and owns blob URLs until Session release, but does not bound simultaneous initial reads.
- **Implement:** 1. Reserve dimensions/aspect ratio and wait for near-viewport intersection before invoking the byte loader. 2. Use a small bounded read/decode queue and prioritize visible images. 3. Prefetch active/nearby lightbox images without loading every historical image. An img `loading` attribute alone cannot prevent the earlier RPC.
- **Ownership / safety:** Preserve Session-authorized cache keys, cached-preview handoff and retry. Leaf components must not revoke borrowed/cache-owned URLs. Cancel queued work on scope disposal; if the public loader cannot abort active reads, document that boundary and still bound queued work.
- **Validate:** Load an older page containing 100 images, switch/dispose sessions, retry failures and navigate the lightbox. Count attachment reads, bytes, concurrent reads/decodes and URLs after release. Compare visible-image-ready time and decoded memory while ensuring stable scroll geometry.

### C19 — Correct shared-stream fallback lifetime and refcounts · P1

- [x] **Implemented and verified** in `qkqlussz` (revision `e219da8c`), 2026-10-18. Live fallback occurrence on a normal page remains unmeasured; the defect itself was reproduced first.
- **Sources / behavior:** [Fallback, subscription and close:111–117,152–186,200–209](../../plugins/@dshfiles/shared-streams/src/shim.ts#L111-L209). Fallback created a native EventSource in a local variable; proxy close could not close it. After fallback, `post` no-oped, so existing worker subscriptions did not receive disconnect. Same-URL proxy instances shared a page group, but each replaced the port's subscription types and each close unsubscribed the entire port/URL despite surviving siblings.
- **Reproduction first:** the four page-half behaviours failed against the current script before the fix (`shim-lifecycle.test.ts` executes the generated page and worker strings in a `node:vm` sandbox with stub `EventSource`/`SharedWorker`/`EventTarget`). The worker-half socket test passed unchanged.
- **Implement:** 1. Retain the native source and bridge/listener disposers on each proxy; attach once and close deterministically. 2. Disconnect worker subscriptions when falling back before enabling native ownership. 3. Publish the union of group event types and unsubscribe only the final member; remove empty groups and obsolete listeners.
- **Ownership / safety:** Keep URL/config/origin identity and native ready/error/message semantics correct. Do not pool credentials/configurations under an incomplete key or introduce duplicate delivery. Preserve native fallback availability and final-subscriber socket release.
- **Validate:** Execute the actual generated page/worker scripts through timeout/error, 10 open→close cycles, two same-URL instances with different event types, close-one-survivor and unload. Assert every native socket closes, surviving subscriptions receive exactly once and resource counts return to baseline. [Old tests:7–35](../../plugins/@dshfiles/shared-streams/src/host.test.ts#L7-L35) only checked strings/parsing. Multi-tab socket count and pending HTTP requests still need a manual supported-scratch measurement; no live-instance action was taken.
- **Receipt:** `pnpm --dir plugins/@dshfiles/shared-streams exec vitest run` → 13/13; `run typecheck`, `run build` and the `dist/index.js` import check pass; `pnpm run check:diff` clean with 0 diagnostics in the changed files. A scratch `dshx dev up --plugin @dshfiles/shared-streams` booted 167 entries with no Host errors, and two real tabs both installed the proxy (`EventSource.name === 'SharedEventSource'`) with zero console/page errors ([receipt](evidence/README.md#c19-implementation-receipt), [screenshot](evidence/c19-shared-streams.png)).

### C20 — Separate live communication head refresh from loaded history · P1

- [ ] **Pending implementation.** Static-confirmed query/render shape; request amplification and UI impact unmeasured.
- **Sources / behavior:** [Infinite query/flattening:375–397](../../plugins/@dshfiles/agent-communication/src/agent-communication-panel.tsx#L375-L397) retains loaded pages with a 30-second refetch interval and no maxPages; [message mounting:635–651](../../plugins/@dshfiles/agent-communication/src/agent-communication-panel.tsx#L635-L651) mounts every loaded message. Verify installed TanStack infinite-refetch behavior/request count rather than assuming only the latest page refreshes.
- **Implement:** 1. Separate refreshed head from stable before-ID history, or use supported page-specific invalidation. 2. Define when receipt/subscription/recipient changes revalidate old data. 3. Window rows and bound retained pages with explicit older navigation/anchor restoration instead of silent history loss; reuse merged arrays when inputs are unchanged.
- **Ownership / safety:** Keep selection/search/cursor identities and cancellation scoped to the active conversation. Preserve last-good content on poll errors, selected recipient context and arrivals during backfill. Do not freeze old receipt state indefinitely to reduce requests.
- **Validate:** Load 20 pages; test arrivals during older fetch, filters, sends, recipient/subscription changes and failures. Count actual RPCs each 30 seconds and mounted rows before/after. Where historical stability permits, periodic head request count should not grow with pages browsed; compare selection/send p95 with exact content assertions.

## Conditional hypotheses — not additional fixes

These four candidates are not counted in C01–C20. Promote only after the named evidence exists.

| ID | Source-confirmed shape | Evidence gate / possible direction |
|---|---|---|
| X01 | [Model picker:121–147](../../plugins/@dshfiles/model-effort-picker/src/model-effort-picker.tsx#L121-L147) mounts all filtered models in ScrollArea | Measure 500+ models and keyboard interaction before adding group-aware virtualization. Loading already starts on open; slider selection already commits on release. |
| X02 | [Usage request rows:168–215](../../plugins/@dshfiles/usage/src/request-log.tsx#L168-L215) mounts up to 200 rows × 10 cells | Measure full-cap selection/filter/open costs before windowing. Existing hard cap, search debounce, previous data and memoized chart definitions may make this low leverage. [Bucket generation:18–23](../../plugins/@dshfiles/usage/src/charts.tsx#L18-L23) is capped at 2,000, not unbounded. |
| X03 | [Monaco registrations:1–7](../../plugins/@dshfiles/editor/src/monaco-engine.ts#L1-L7) include all features/languages; [loadEngine:32–35](../../plugins/@dshfiles/editor/src/client-entry.tsx#L32-L35) defers evaluation within the same chunk | Obtain transfer/parse/evaluation/first-file profiles and an explicit language-support policy before narrowing registrations. Generic import()/React.lazy does not create supported independent chunks. |
| X04 | [Per-bundle Query ownership:8–23](../../plugins/@dshfiles/plugin-ui/src/query.tsx#L8-L23), [main-tabs attention refresh:210–227](../../plugins/@dshfiles/main-tabs/src/client.tsx#L210-L227) and [sidebar refresh:1314–1338](../../plugins/@dshfiles/thread-sidebar/src/client.tsx#L1314-L1338) have separate observers | Measure actual duplicate RPC/provider work across surfaces/tabs. Per-bundle cache reuse and Host caches already mitigate work. Consolidate only through a supported domain-owned projection with correct independent consumer lifetime, not a speculative global cache. |

## Existing optimizations to preserve

| Owner | Deliberate current behavior / source |
|---|---|
| Frame | [Drag rAF and ResizeObserver:58–103,133–158](../../plugins/@dshfiles/frame-layout/src/native/client/AppFrame.tsx#L58-L158); [memoized sidebar/main/overlay seats:242–255](../../plugins/@dshfiles/frame-layout/src/native/client/AppFrame.tsx#L242-L255). Main panel selection is independently subscribed. Do not claim blanket shell rerendering. |
| Sidebar / palette | [Stable row actions:2336–2381](../../plugins/@dshfiles/thread-sidebar/src/client.tsx#L2336-L2381), child caps/selected-child inclusion, boundary timers and bounded three-worker bulk resume; [palette deferred text/indexes/result limits:124–189](../../plugins/@dshfiles/command-palette/src/thread-palette.tsx#L124-L189). Existing [ranking tests:47–85](../../plugins/@dshfiles/command-palette/src/palette-perf.test.ts#L47-L85) use synthetic fastest-of-nine samples, not browser p95 proof. |
| Composer | [Incremental append/prepend handling and three-rAF publication:112–169](../../plugins/@dshfiles/rich-composer/src/native/conversation/assembly.ts#L112-L169), active targets, revision-cached draft snapshots and selection-only publication suppression. [File uploads already use a bounded worker queue:345–415](../../plugins/@dshfiles/rich-composer/src/native/service.ts#L345-L415). |
| Editor | [Index caps/concurrency/grace:22–32](../../plugins/@dshfiles/editor/src/workspace-files.ts#L22-L32), progressive results, gitignore-aware BFS, watch debounce and idle watch release. [Directory children are lazy:18–20,83](../../plugins/@dshfiles/editor/src/file-tree.tsx#L18-L83). [Monaco models are shared/refcounted and dirty state uses version IDs:17–27,78–100](../../plugins/@dshfiles/editor/src/monaco-engine.ts#L17-L100), not full getValue on every keystroke. |
| JJ | [Repository cache/single-flight/generation:233–318](../../plugins/@dshfiles/jj-integration/src/host.ts#L233-L318); [graph virtualization with sticky/drag pinning:593–612](../../plugins/@dshfiles/jujutsu/src/client.tsx#L593-L612); [visibility/intersection/layout-aware refresh:9–69](../../plugins/@dshfiles/jujutsu/src/auto-refresh.ts#L9-L69). Group limits and expanded-only previews intentionally limit initial panel work; integration writes stay ordered. |
| Shared UI/runtime | [Patch parsing memoization + diff virtualizer:53–89](../../plugins/@dshfiles/plugin-ui/src/diff.tsx#L53-L89), slim Shiki, one shared stylesheet, [shared Radix/Query/Form/xstate/zod runtime:15–70](../../plugins/@dshfiles/shared-runtime/dshx.config.ts#L15-L70). The QueryClient is shared within a bundle, not across plugins. |
| Accounts / usage / memory | Last-good quota retention, identity polling that stops on sign-in, quote freshness, hidden-browser clock suspension and bounded history. Usage caps 200 request rows/2,000 buckets/eight breakdown rows; Memory caps 500 notes/300 digests/100 citations. Preserve these bounds rather than proposing them as absent. |
| Images / workbench / streams | Session-scoped image deduplication/blob release and cached preview handoff; lightbox mounts only when open. Workbench keeps panels mounted to preserve editor/model/view state and injects its sheet on first mount. Shared streams already use one stable worker URL and release the final worker subscriber's socket; C19 fixes exceptional ownership, not the pooling premise. |

## Coverage and gaps

This is source coverage, not a claim that the running full GUI was profiled. Mapped-only and unreviewed areas remain explicit; they are not clean bills of health.

| Plugin(s) | Reviewed / result | Remaining gaps |
|---|---|---|
| thread-sidebar | Main rows/derivation, child tree, attention/recovery/JJ polling, autoarchive, shell geometry; C02–C04 | Entry/provenance/settings only structurally mapped; broad browser behavior unmeasured |
| main-tabs | Setup tracking, overlay, resolver; C05 | Machine, strip and start page mapped, not deep-render audited |
| frame-layout | AppFrame and layout store read; existing optimizations recorded | CSS/compositor behavior and full responsive profiling |
| rich-composer | Runtime/projection/facade, assembly cadence, uploads, image cache; C07/C18 | Assembler/location/group algorithms mapped rather than fully audited; full streaming profile |
| command-palette | Overlay/open body/index usage and ranking tests; C06 | Complete browser cold/warm distribution and every action/search lifecycle |
| editor | Entry/store/Monaco/tree/file index; C08/C09 | Real filesystem bursts, first-file evaluation and long-session memory |
| jj-integration | Panel/row eligibility/projection refresh, client and Host cache; C04/C12/C13 | Destination/provisioning mapped only; complete composition and mutation-time safety journeys |
| jujutsu | Main graph/search/query/render path, ChangedFiles, refresh and reference links; C01/C10/C11 | Source-control/full-diff/review write flows partial; browser graph scaling |
| activity-timeline | Client queries/merge/render/details; C14 | Host adapters/service mapped only; ingest batching belongs to Host register |
| usage | Panel/request log/charts; X02 only, existing bounds retained | SQL/indexer/Host deep review and full-cap UI profile |
| ai-accounts | Client/query factories/panel/detail/quota/history/footer/edge/formatting; C16/C17 | Provider/network/durable-store behavior belongs to Host work; actual poll duplication unproven |
| memory | Notes/digests/detail/usage/reference links and Host response caps; C01/C15 | Database, embeddings and finder not deeply reviewed here |
| workbench | Client/view/layout store; C17 | Dockview event cadence and multi-panel drag traces |
| home | Full client read; three recents, settle gate and 60-second query freshness already present | Full-inventory rebase count considered with C04, not another task |
| attachment-gallery | Message/gallery loading, lightbox and attachment rail; C18 | Image-rich history/read/decode profile and supported loader cancellation |
| plugin-ui / shared-runtime / shared-streams | Query/storage/labels/diff/runtime declarations and stream shim/Host/tests; C17/C19 | Bundle evaluation/transfer and executable browser fallback lifecycle |
| agent-communication | Panel queries/derivation/message rendering; C20 | Retained-history polling cost and complete data-owner work |
| mentions / input-trigger | Mention source/link behavior and controller first half plus structure; C01 | Remaining trigger actor internals not fully read; parallel/cancelable lookup and same-hit guards already exist |
| model-effort-picker / multi-host | Picker and remote view/query factories read; X01, no other promoted item | Large catalogs/remote latency; no unsupported streaming replacement inferred from polling |
| agent-questions / request-messages / prompt-stash / project-checks / mcp-servers / secret-catalog / settings-shell | Structural maps, not deep client audits | State/subscription/rendering lifecycles remain unreviewed |
| agent-toolkit / btw / diff-viewed / goal-stall-guard / optmem-core / plugin-marketplace / privacy-controls / project-folder-picker / pulls-review / queue-reorder / send-after-upload / shortcuts / sidebar-commands / tool-meta / ui-styles / workspace-folder-picker | No deep client logic audit; shared-style contract known | All client-specific hot paths and complete-profile interaction remain unreviewed |

## Implementation sequencing and completion

1. Run the master measurement gates on a complete supported scratch composition. Capture deterministic work counts alongside latency/heap; do not restart or reuse the live :3080 instance.
2. Reproduce C19's lifecycle defect. Prioritize C01/C06/C07 and measured C10; pair sidebar C02/C03 and eligibility C12/C13 by owner without merging unrelated lifetimes.
3. Address read/poll/cache ownership in C04/C05/C08/C09/C13, then remaining large-list/image work C11/C14/C15/C18/C20. Refine idle/drag C16/C17 after tracing actual event frequency.
4. For each item: focused regression → smallest implementation → same-fixture before/after → affected plugin build/import/type/lint checks and complete scratch journey → documented old-Host/new-client behavior. Rebuild the shared sheet if classes change. Keep implementation revisions independent and reversible.
5. Mark a checkbox complete only after its safety and measurable validation pass, or replace it with an explicit measured rejection/defer decision and owner. No item is complete merely because an audit or plan was written. Record concrete supported-API gaps in the existing Host-gap process; do not turn a core gap into an unsafe local workaround.
