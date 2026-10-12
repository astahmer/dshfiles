<!-- Snapshot audit run 2026-10-12 against a frozen copy of the live database; numbers describe that snapshot. -->

# OptMem memory-quality and retrieval audit

**Scope.** Read-only evaluation of the frozen OptMem snapshot at
`/tmp/optmem-audit/snapshot.db` (+`-wal`/`-shm`, `quick_check` = `ok`). All work ran against a
private copy `/tmp/optmem-audit/work.db`; the live database
`~/.dsh/plugins/optmem/optmem.db` was never opened, written, or copied over, and no repo file
was modified. Engine: `fnm exec --using=22.23.3 node` with `node:sqlite` (read-only), plus
`sqlite3` 3.51 for spot queries. Scripts: `/tmp/optmem-audit/analyze{,2,3}.mjs`; raw output in
`/tmp/optmem-audit/evidence{,2,3}.txt`.

**Snapshot inventory.** `events` 59,804 · `stream_entries` 119,608 · `nodes` 47,169 · `views` 140 ·
`cursors` 71 · 113 streams (5 `project:`, 108 `conversation:`).

**Code revision caveat (verified).** The repository was being edited by another agent while this
audit ran. `plugins/@dshfiles/optmem-core/src/engine.ts` grew from 887 to 1,053 lines between my
first and second read. Budget rules were read from files whose hashes were stable across the audit:

| file                                 | sha256 (prefix) | lines                         |
| ------------------------------------ | --------------- | ----------------------------- |
| `optmem/src/injection.ts`            | `6cb1b380…`     | 123                           |
| `optmem/src/runtime.ts`              | `397f01c7…`     | 696                           |
| `optmem/src/settings.ts`             | `7f6e75d9…`     | 89                            |
| `optmem/src/explorer-panel.tsx`      | `6733deb3…`     | 465                           |
| `optmem/src/host.ts`                 | `47bde119…`     | 492                           |
| `optmem-core/src/engine.ts`          | `02c49872…`     | **1,053 (changed mid-audit)** |
| `optmem-sqlite/src/sqlite-memory.ts` | `32a4f0a5…`     | —                             |

Anything marked _judgement_ below is my inference; everything else is a query result or a quoted
line of source.

---

## 1. Provenance accuracy

I ran the coverage/resolution checks over **every** node, not just the sample.

| check                                                             | result                 |
| ----------------------------------------------------------------- | ---------------------- |
| `nodes.bytes` ≠ `length(cast(text as blob))`                      | **0**                  |
| level-0 node with `event_id IS NULL`                              | **0**                  |
| internal node with non-NULL `event_id`                            | **0**                  |
| level-0 `idx` ≥ stream length                                     | **0**                  |
| level-0 `event_id` ≠ `stream_entries.event_id` at that position   | **0**                  |
| `verbatim` leaf text ≠ `role                                      |                        | ': ' |     | text` | **0 real** (1 SQL false positive, below) |
| `concat` parent text ≠ left ‖ `\n` ‖ right                        | **0** of 5,834 checked |
| internal node with a missing left or right child                  | **0** / **0**          |
| level-0 node with no parent (expected where a sibling is missing) | 542                    |

The single "verbatim mismatch" is an artifact of SQL text comparison on a truncated binary
`tool_result` (`conversation:2e56149d…`, level 0 idx 151): comparing the two strings in Node
returns `equal? true`, `nodeLen 25`, `expLen 25`, so the bytes agree and the divergence is the
embedded NUL/binary content tripping SQLite's `<>` on `||` concatenation. Provenance of leaves is
therefore exact.

**16-node sample** (addresses are `<start>+<len>`; `coverageExact` = the stream entries found in
`[idx·2^level,(idx+1)·2^level)` equal `2^level` and are contiguous):

| stream                           | addr      | level | model                            | bytes ok | coverageExact | covering event / children                   |
| -------------------------------- | --------- | ----- | -------------------------------- | -------- | ------------- | ------------------------------------------- |
| project                          | 0+1       | 0     | verbatim                         | ✓        | ✓             | event 1 = stream pos 0 ✓                    |
| project                          | 1+1       | 0     | unresolved                       | ✓        | ✓             | event 2 = pos 1 ✓                           |
| project                          | 100+1     | 0     | codex-alex2/gpt-6-luna           | ✓        | ✓             | event 137 = pos 100 ✓                       |
| project                          | 466+1     | 0     | verbatim                         | ✓        | ✓             | event 609 = pos 466 ✓                       |
| project                          | 500+1     | 0     | codex-emialex/gpt-6-luna         | ✓        | ✓             | event 659 = pos 500 ✓                       |
| project                          | 35+1      | 0     | clipped:codex-alex2/gpt-6-luna   | ✓        | ✓             | event 64 = pos 35 ✓                         |
| project                          | 0+2       | 1     | unresolved                       | ✓        | ✓             | children 0+1, 1+1                           |
| project                          | 0+4       | 2     | clipped:unresolved               | ✓        | ✓             | children 0+2, 2+2                           |
| project                          | 0+8       | 3     | clipped:codex-emialex/gpt-6-luna | ✓        | ✓             | children 0+4, 4+4                           |
| project                          | 384+32    | 5     | clipped:codex-emialex/gpt-6-luna | ✓        | ✓             | children 384+16, 400+16                     |
| project                          | 0+256     | 8     | clipped:codex-alex2/gpt-6-luna   | ✓        | ✓             | children 0+128, 128+128                     |
| project                          | 2048+2048 | 11    | clipped:codex-alex2/gpt-6-luna   | ✓        | ✓             | children 2048+1024, 3072+1024               |
| conversation `session-110732e7…` | 0+1       | 0     | verbatim                         | ✓        | ✓             | `verbatimExact` ✓                           |
| conversation `session-110732e7…` | 0+2       | 1     | concat                           | ✓        | ✓             | `concatExact` ✓                             |
| conversation `session-110732e7…` | 0+4       | 2     | codex-alex2/gpt-6-luna           | ✓        | ✓             | children present, recall 0.47 vs child join |

**Verdict — verified:** node↔event linkage, range arithmetic (`TreeMath`), byte accounting, and
child/concat construction are exact. The only "inconsistency" between a node's text and its
events is semantic loss from summarization (section 5), never a wiring error.

One routing note: 11 nodes carry `model = 'unresolved'` (summarizer route not resolved at build
time) and still hold usable text, e.g. project `1+1` (494 B) is a faithful compression of the
34,487 B workspace-instructions event.

---

## 2. Retrieval — do earlier project decisions survive?

8 facts probed; each was located by literal token across `events`, then traced into `nodes` and
into the two persisted views. Project stream: 59,407 entries, but both views stop at
`through_pos = 468`.

| fact                                    | event hits (oldest pos) | smallest committed node with the fact | survives in **injected** (compact) view?                                                  | level of detail                                                                                                     |
| --------------------------------------- | ----------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| F1 SQLite WAL explanation               | 5 (pos 0)               | `0+1` verbatim                        | **no**                                                                                    | tree reaches `4+4` (L2): "explanation of SQLite's write-ahead log (WAL)"; compact line `0+256` dropped WAL entirely |
| F2 `keepContentWhenOpen` edit           | 3 (pos 53)              | `53+1` verbatim                       | **no**                                                                                    | highest node `3988+4`                                                                                               |
| F3 `preferences.test.ts` (9 tests pass) | 447 (pos 11)            | `29+1` verbatim                       | **no** (but main-view line `40+8` has it)                                                 | highest `1280+32`                                                                                                   |
| F4 `jj-rewrite-preflight` rule          | 384 (pos 76)            | `76+1` (clipped summary)              | **yes — line `256+128`**: "…run `jj-rewrite-preflight <full-commit-id>` before rewrites…" | high-level, L7, one line                                                                                            |
| F5 summarizer route note                | 4 (pos 8)               | `9+1` verbatim                        | **no**                                                                                    | single node only                                                                                                    |
| F6 resume workspace path                | 2,088 (pos 10)          | `10+1` verbatim                       | **yes — line `0+256`**                                                                    | L8, one aggregate line                                                                                              |
| F7 "Never restart … DSH" rule           | 11 (pos 1)              | none literal; paraphrase in `0+256`   | **yes, paraphrase** "Never restart live DSH or launch real Cursor"                        | L8                                                                                                                  |
| F8 `WorkspaceMoveInvalidError`          | 16 (pos 530)            | **none** — 0 nodes contain it         | **no** (pos ≥ 468, and summarization dropped it)                                          | lost                                                                                                                |

**Search index.** `events_fts` holds 59,804 rows; `events not indexed = 0`. FTS matches facts
regardless of node/view state, e.g. `MATCH '"rewrite-preflight"'` → rowids 109/121/300. So
`memory_search` is the working retrieval path for post-freeze memory; a hit's `viewAddress` is the
**main-view** node covering the position (`engine.ts:973-984`, `TreeMath.covering`) and is `null`
for any `pos ≥ 468`.

**Verdict — verified:** the injected compact memory is frozen at 468/59,407 entries (0.8%) and one
L8 line, so of these 8 facts only F4, F6 and F7 are reachable through the injected context; F1,
F2, F3, F5 need `memory_search`/`memory_zoom`, and F8 is not recoverable from any node at all.

---

## 3. Cross-conversation project memory

- Project stream distinct `conversation_id`: **102**.
- Positions covered by _any_ committed node: **21** conversations.
- Positions covered by the **compact and main views** (0..467): **11** conversations.
- Per compact-view line (entries → conversations): `0+256` → **11**, `256+128` → 6, `384+32` → 4,
  `416+16` → 3, `432+8` → 3, `440+8` → 3, `448+8` → 2, `456+8` → 3, `464+4` → 3.
- Largest nodes: project `2048+2048` (level 11) covers **9** conversations; level-10 nodes cover 7.

So project nodes genuinely aggregate many conversations.

**Conversation streams are clean:** over all 108 conversation streams (59,804 entries),
`stream <> 'conversation:' || conversation_id` holds for **0** rows.

**Verdict — verified:** aggregation works as designed (cross-conversation merge into project
memory; conversation streams stay self-contained). The limit is freshness, not mixing: 91 of 102
conversations have no representation in the injected project context.

---

## 4. Injection budget

**Configured values.** `~/.dsh/profiles/web/cordis.patch.yml` sets only
`dshfiles-optmem.config.allowAllProjects: true`; no byte setting is overridden, and no dshx
settings entry exists on disk. Defaults therefore apply (`settings.ts`): `injectUpperBytes` **8192**,
`injectLowerBytes` **4096**, `injectRefreshBytes` **1024**, `viewUpperBytes` 128,000,
`viewLowerBytes` 64,000, `maxNodeBytes` 512. `runtime.engineConfig` maps
`injectUpperBytes → compactUpperBytes`, `min(injectLower, injectUpper) → compactLowerBytes`, so the
compact view is bounded by 8192/4096.

**Persisted views respect the budget (verified).**

- Project compact: `bytes = 4082`, `through_pos = 468`, `version = 485`, `merge_pending = 0` →
  4082 ≤ 8192 and ≤ 4096 lower bound, i.e. a completed merge batch.
- Project main: `bytes = 67,968`, `version = 160` ≤ 128,000.
- Across **all 140 views**: 70 compact, max **8,182** B, 0 over 8192; 70 main, max **121,633** B,
  0 over 128,000. `views.bytes = byteLength(rendered)` for all 140 (0 mismatches).
- Other project streams: `path:864f6226…` 1461 B, `path:8a3e2d78…` 192 B, `path:ce1498e0…` 1372 B,
  `workspace:b148a1bb…` compact 3782 / main 30,005.

**Render-time budget.** `injection.renderView` computes
`available = budgetBytes − byteLength(preamble) − 2` (preamble = **294** B), keeps whole lines from
the newest backwards while `used + lineBytes ≤ available − 64`, and prepends
`(N older lines omitted; use memory_search)` when it truncates. Simulating that against the
persisted project compact view: **9 kept lines, 0 lines dropped for the reading conversation,
0 omitted**, final text **4,377 B ≤ 8,192** (ceiling is `budget − 64 = 8,128`). Same result for
3 real `conversation_id`s in the covered range — no compact line belongs to a single conversation,
so per-conversation filtering removes nothing here.

**Refresh thresholds.** `injection.ts:113-118`:
`stale = last === undefined || last.text === '' || last.rewrites !== view.rewrites || current.keptBytes − last.keptBytes >= refreshBytes`,
with `budgetBytes = injectUpperBytes` and `refreshBytes = injectRefreshBytes` from
`runtime.promptText`. That matches the documented behaviour ("re-emitted only once it grew by this
many bytes, or when a merge rewrote it"). Observable consequence in the snapshot: because the
project compact view's `version`/`through_pos` are frozen at 485/468, the cache is never
invalidated, so the frozen project emits **zero** context churn — the failure mode is staleness,
not repeated re-injection.

---

## 5. Compression honesty

Model mix over 47,169 nodes: `verbatim` 15,781 · `codex-alex2/gpt-6-luna` 10,675 ·
`codex-emialex/gpt-6-luna` 10,361 · `concat` 5,834 · `clipped:codex-alex2/gpt-6-luna` 2,071 ·
`clipped:codex-emialex/gpt-6-luna` 1,404 · `commandcode/deepseek/deepseek-v4.1-flash` 1,007 ·
`commandcode/gpt-6-luna` 23 · `unresolved` 11 · `clipped:unresolved` 1 ·
`clipped:commandcode/…flash` 1.

**3,477 / 47,169 nodes (7.4%) are clipped** (deterministic `Utf8.clip` at 512 B, head-only plus
"…"); in the project stream 949 / 11,788. No level-0 node exceeds 512 B.

Concrete examples (text truncated here for readability):

- `35+1` — `clipped:codex-alex2/gpt-6-luna`, 512 B from a 2,807 B event
  (`plans/agent-session-history.md` permission model). **Preserves the decision:** "permission
  model: independent of filesystem sandbox; presets default read current workspace, RW current
  workspace, RW all workspaces … Write covers all Session mutations. … Unresolved scope/grant
  fails closed; tool args cannot grant access." Ends mid-word: "…binds exact Agent/Session/operati…".
- `530+1` — `clipped:codex-emialex/gpt-6-luna`, 512 B from a ~5,501 B bash analysis. Preserves the
  API contract ("`Workspace` … uses stable UUID `WorkspaceId`, canonical immutable realpath …;
  reorder via `insertSessionBefore`") but **drops the specific failure symbol**
  `WorkspaceMoveInvalidError` (fact F8) — the tail of the summary, where error types and open
  issues live, is what `clip` discards.
- `1026+1` — `clipped:codex-emialex/gpt-6-luna`. Preserves the resume plan's numbers: "27 catalogs
  (23 bundles, 4 libraries), 86 features, 123 options, 116 Gherkin and 230 unit-test refs …",
  ending "…Comm…".
- `0+256` (project L8, the largest injected compact line) — 512 B summarizing 256 events: "…E2E
  14/23 boot, 9 fail; features:check 89 missing IDs, 3 stale refs. Fix sidebar Active(1) missing
  after New thread, failur…". Clipped mid-word; the WAL, `keepContentWhenOpen` and
  `preferences.test.ts` facts are absent.
- Counter-example (honest at low level): `4+4` (`codex-alex2/gpt-6-luna`, not clipped) keeps the
  fact accurately — "Earlier project conversation asked for an approximately 120-word explanation
  of SQLite's write-ahead log (WAL), described as recording changes in a separate file before
  applying them to the main database." But this node is in neither persisted view.

**Verdict — judgement:** summaries are semantically faithful for their byte budget and the
`clipped:` model flag is good observability; the real loss is (a) head-only clipping discards the
tail of a summary, which is where error names, remaining work and next actions sit, and (b)
re-summarizing already-clipped children at each level (0+4 → 0+8 → … → 0+256) compounds the loss
until high-level lines are topic labels rather than decisions.

---

## 6. Context Preview fidelity

Path: `explorer-panel.tsx` → host `contextPreview` (`host.ts:442`) → `runtime.contextPreview`
(`runtime.ts`). That function reads `readView({ stream, kind: 'compact' })`, builds a **fresh**
`createInjectionCache`, pages `streamConversations(0..throughPos)` in 2048-entry batches, calls
`preview.setView(view)`, then `preview.render({ stream, conversationId, budgetBytes: settings.injectUpperBytes, refreshBytes: 0 })`, and returns `text`, `budgetBytes`,
`estimatedTokens = ⌈bytes/4⌉`, `sourceAddresses`.

**Verified equal to injection in the live configuration (compat mode):** same view kind
(`compact`), same budget (`injectUpperBytes`), same preamble constant, same `ViewMath.line`
wrapping, same `{{`/`}}` neutralization — because both go through `injection.renderView`. The live
profile sets no `mode`, so the default `compat` applies, and an old `memory_status` captured in
this very snapshot reports `replaceContext=no resetPerTurn=no`, i.e. full mode is unsupported here.
So the preview shows a _correct fresh render of what compatibility injection uses_.

**Divergences (all verified from source):**

1. **Staleness policy.** Preview passes `refreshBytes: 0`; live passes `injectRefreshBytes`
   (1024). With 0, `current.keptBytes − last.keptBytes >= 0` is always true, so the preview always
   recomputes, while the live prompt may serve the text cached from a previous turn until the kept
   bytes grow by 1024 or a merge rewrites lines. The preview can therefore differ from the actual
   injected text by up to one refresh threshold (and differs immediately after any re-summarizing
   merge).
2. **Conversation index.** The preview defaults to the synthetic id `optmem-context-preview`, so
   nothing is filtered; with a real session id it drops lines covering only that conversation, as
   live does. But live's index is grown incrementally (`refreshStream` →
   `extendConversations`, which returns unless `fromPos === knownLength`), so the two can drop
   different lines if the index lags.
3. **Full mode is not previewed.** If `mode: 'full'` were enabled, the injected text is
   `viewPreamble` + `engine.snapshot(...).text` — the **main** view plus a raw
   `[pending summary]` tail capped at `pendingTailBytes` (16,384) as of `turnBoundaries` — while
   the preview always shows the persisted **compact** view with the compat preamble and no pending
   tail. Under full mode the preview is an approximation, not the injected text.
4. **Read consistency.** Preview reads through the engine's in-memory view cache; it never waits
   for pending leaves and never applies the next-turn barrier, so it can show a view the current
   turn will not actually receive.

The UI copy is honest — "Simulated · read-only", "This preview is not a recorded injection and
does not resume or modify a session" — but the loading string "Assembling the same compact view
used for injection…" is exactly true only in compat mode on the fresh-render path.

---

## 7. Health numbers worth keeping

- Project injected coverage: **468 / 59,407 entries (0.79%)**, **11 / 102 conversations**.
- Stream entries with no level-0 node anywhere: **94,984 / 119,608 (79.4%)**.
- Events with no level-0 node in any stream: **41,022 / 59,804 (68.6%)**.
- Whole conversation streams with zero leaves: `session-639492a5` (5,016 entries),
  `session-d67ddb20` (3,110), `session-aeedb89c` (3,012), `session-55607baa` (2,572),
  `session-c0a706a7` (2,500), `session-fbd5d0c3` (2,360), plus more — the tree never started for
  them.
- Project level-0 gaps: first missing **468**; also 1238; a cluster from 5354 (5354, 5367, 5370,
  5378 …); 53,369 of 59,407 positions missing; max built leaf index **6157**.
- Timeline: project leaf 467 built `2026-10-10T21:15:27Z` (so the view pinned at
  `through_pos = 468` at that moment, ≈ 42 h before the snapshot); last project leaf built
  `2026-10-11T22:29:41Z`; newest project event `2026-10-12T13:03:20Z`.

---

## 8. Top 3 improvements

1. **Never let one leaf freeze a view.** `maintainView` (`engine.ts`) appends only contiguous
   leaves from `through_pos`, so a single unbuildable position (468) pins both views for the whole
   stream. Emit a deterministic fallback leaf after `leafFallbackAfterAttempts` (the constant
   already exists in the current `engine.ts`, `leafFallbackAfterAttempts: 3`) and make
   `commitView` advance past failed positions, with the fallback marked as such in the line text.
2. **Make coverage observable and bounded.** Put `through_pos / stream length` and
   "conversations represented" in the Explorer and `memory_status`, and drain the leaf backlog with
   the catch-up sweep (`catchUpIntervalMs`, `catchUpBatchPerStream`) rather than only on append.
   Today 79.4% of stream entries have no leaf and eight conversation streams have none at all, and
   nothing in the UI says a project's memory is 0.8% complete.
3. **Clip summaries head _and_ tail, and stop claiming preview equals injection.** `boundedSummary`
   clips head-only; `Utf8.boundHeadTail` already exists and is used for tool results. Tail
   retention would have kept `WorkspaceMoveInvalidError` and the trailing "remaining work" items in
   `0+256`. In parallel, have `contextPreview` use the live refresh semantics (or say "approximate
   render") and add a pending-tail/full-mode preview.

---

## Appendix — evidence commands

```
cp snapshot.db{,-wal,-shm} work.db{,-wal,-shm}    # private copy; live db untouched
fnm exec --using=22.23.3 node /tmp/optmem-audit/analyze.mjs   # provenance sample, retrieval, budget, compression
fnm exec --using=22.23.3 node /tmp/optmem-audit/analyze2.mjs  # fact→node→view survival, coverage, timeline
fnm exec --using=22.23.3 node /tmp/optmem-audit/analyze3.mjs  # full integrity checks, view node lists, paraphrase probes
```
