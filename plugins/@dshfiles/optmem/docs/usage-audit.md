<!-- Snapshot audit run 2026-10-12 against a frozen copy of the live database; numbers describe that snapshot. -->

# OptMem measured-vs-estimated LLM usage and cost audit

Scope: `plugins/@dshfiles/optmem*` in `/Users/astahmer/dev/dshfiles`, measured against the read-only
snapshot `/tmp/optmem-audit/snapshot.db` (frozen copy of `~/.dsh/plugins/optmem/optmem.db`, `quick_check = ok`).
The live DB was opened once, read-only, for schema only. No repository file was modified; nothing was written
to the live DB.

Evidence files produced next to this report: `measurements.json`, `measurements2.json`, `measurements3.json`,
`measurements4b.json`, `measurements5.json` (level-1 sensitivity), `measurements6.json`, `measurements7.json`,
`quota-summary.json`, plus the scripts `measure*.mjs`, `quota.mjs`.

Every figure below is tagged **MEASURED** (read directly out of the snapshot or the code) or **ESTIMATED**
(model applied to measured inputs; the assumption is stated inline).

---

## 1. When a model call happens, and what the model receives

Read from `plugins/@dshfiles/optmem-core/src/engine.ts`, `plugins/@dshfiles/optmem/src/summarizer.ts`,
`plugins/@dshfiles/optmem-core/src/bounded-summary.ts`, `plugins/@dshfiles/optmem/src/settings.ts`.

**Two call sites only** (`createMemoryEngine`):

| Site  | Code                              | Call condition                                                                                                                                                                       | Input                                               | Output budget |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------- |
| Leaf  | `leafText` (engine.ts:422-434)    | `` `${role}: ${text}` `` > `maxNodeBytes` (default 512) **and** no level-0 node already exists for that `event_id` in _any_ stream (`store.findLeafByEvent`, `sqlite-memory.ts:293`) | `[verbatim]` — the single event                     | ≤512 B        |
| Merge | `buildParent` (engine.ts:466-479) | both children exist and `left.text + "\n" + right.text` > 512 B                                                                                                                      | `[left.text, right.text]` — two existing note texts | ≤512 B        |

Everything else is free and makes no call: a leaf ≤512 B is stored `verbatim` (engine.ts:424); a parent join
≤512 B is stored `concat` (engine.ts:474). `maintainView` / `view-math` merge batches re-render existing node
text only — no model calls (`planMergeBatch` reads `store.getNodes`).

**Both sites funnel into `summarize` → `boundedSummary`** (`bounded-summary.ts`), which is where the cost
multiplier lives:

- up to `config.summaryRetries + 1 = 4` calls per node;
- each attempt lowers the requested budget: `maxBytes × (1 − 0.2·attempt)` → **512, 409, 307, 204 bytes**
  (bounded-summary.ts:26);
- an attempt is retried only when the answer exceeds `maxBytes`; the retry tells the model
  `"Your previous answer was N bytes, over the limit. Be shorter."` (summarizer.ts:16);
- if all 4 attempts overshoot, the shortest answer is **deterministically truncated** to 512 B and the node is
  persisted with `model = "clipped:<route>"` (bounded-summary.ts:44-51). Retries therefore cost calls _and_
  degrade the stored note.

**`createLlmSummarizer`** (summarizer.ts:142-186) adds a second, independent multiplier per `summarize`
attempt: `budgets = [initial, min(16384, initial×2)]` with `initial = min(16384, max(2048, maxBytes×4))`
= 2048 then 4096 output tokens. A first attempt that finishes with an output-budget failure
(`/finish_reason=length|output token (limit|budget)|max_tokens…/`) is retried at double the token budget
before the error is surfaced. An `OutputBudgetError` is marked `retryable = false`, so the engine parks that
job instead of re-enqueueing it.

Prompt shape per call (`instructions` + `framedInput`), **MEASURED** byte sizes:

| Component                                                                     | bytes     |
| ----------------------------------------------------------------------------- | --------- |
| System instruction, attempt 0 / attempt 1 (leaf)                              | 639 / 703 |
| System instruction, attempt 0 / attempt 1 (merge)                             | 659 / 723 |
| Frame header `Record (JSON string):\n` / `Notes (JSON array, older first):\n` | 22 / 33   |

The payload is JSON-encoded, so the byte count sent is larger than the node text:
leaf input 53,712,160 B raw → **55,295,477 B framed** (+2.9 %) for the 16,507 remaining leaf calls; measured on
the 16,711 already-summarised merge calls, 13,079,806 B raw → **13,295,142 B framed** (+1.6 %).

---

## 2. What is in the snapshot (MEASURED)

Totals: 59,804 events, 119,608 `stream_entries`, 113 streams (108 conversation + 5 project), 47,169 nodes,
59,804 rows in `events_fts`. Every event lives in exactly one conversation stream **and** exactly one project
stream (`sharedEvents = 59,804`, `multiReferenced = 59,804`, all with exactly 2 references).

Node inventory by stream type and class (all **MEASURED**):

| Stream type  | Level-0 nodes | Internal nodes | Total      | Free nodes (verbatim + concat) | Model nodes | Clipped   |
| ------------ | ------------- | -------------- | ---------- | ------------------------------ | ----------- | --------- |
| conversation | 18,247        | 16,560         | 34,807     | 16,017 (11,717 + 4,300)        | 18,790      | 2,521     |
| project      | 6,377         | 5,985          | 12,362     | 5,598 (4,064 + 1,534)          | 6,764       | 956       |
| **total**    | **24,624**    | **22,545**     | **47,169** | **21,615**                     | **25,554**  | **3,477** |

Level-0 classification (**MEASURED**): `verbatim` 15,781 · `concat` 0 (concat only exists at level > 0) ·
model-produced non-clipped 22,077 · `clipped:*` 62 · `unresolved` 11 (legacy marker; current code cannot
produce it — `leafText` returns only `verbatim` or a `provider/model` string — it is 0.03 % of nodes and all
pre-dates 2026-10-09).

Node counts by `model` (top rows, **MEASURED**):

| model                                                         | nodes      | role          |
| ------------------------------------------------------------- | ---------- | ------------- |
| `verbatim`                                                    | 15,781     | free          |
| `concat`                                                      | 5,834      | free          |
| `codex-alex2/gpt-6-luna`                                      | 10,675     |               |
| `codex-emialex/gpt-6-luna`                                    | 10,361     |               |
| `clipped:codex-alex2/gpt-6-luna`                              | 2,071      | 4 calls each  |
| `clipped:codex-emialex/gpt-6-luna`                            | 1,404      | 4 calls each  |
| `commandcode/deepseek/deepseek-v4.1-flash`                    | 1,007      |               |
| `commandcode/gpt-6-luna`                                      | 23         |               |
| `unresolved` / `clipped:unresolved` / `clipped:commandcode/…` | 11 / 1 / 1 | legacy/single |

No `.text` any node exceeds 512 B at any level (max `bytes` per level = 512 everywhere), confirming the output
budget is enforced on every persisted node.

### Byte distribution (MEASURED)

Oversized (model-call) leaf inputs, still-missing events:

| Bucket     | events             |
| ---------- | ------------------ |
| ≤1 KB      | 10,281             |
| 1–2 KB     | 9,813              |
| 2–4 KB     | 7,353              |
| 4–8 KB     | 7,731              |
| 8–16 KB    | 3,106              |
| 16–64 KB   | 18                 |
| >64 KB     | 0                  |
| mean / max | 3,331 B / 28,997 B |

Total oversized input text still to summarise: **127,579,589 B**. Overall: 23,573 of 59,804 events (39.4 %) are
oversized; 755 events are `truncated` (head+tail bound at capture).

Parent (merge) inputs are tightly bounded by construction, since every child is ≤512 B — **MEASURED**
histogram over all 16,711 summarised merges: 0 inputs ≤512 B, 3,985 in 513–640, 3,559 in 641–768, 4,351 in
769–896, 4,816 in 897–1,025. Mean input by level rises from 669 B (level 1) to ~950 B (level 8+). Model
leaves average ~380 B, verbatim leaves ~190 B.

---

## 3. Which models were actually used, and how the route is chosen

**MEASURED** routes: `codex-alex2/gpt-6-luna` (10,675 nodes), `codex-emialex/gpt-6-luna` (10,361),
`commandcode/deepseek/deepseek-v4.1-flash` (1,007), `commandcode/gpt-6-luna` (23), plus the `clipped:` and
`unresolved` variants. No `opencode-go`, `claude`, or deepseek-native route ever appears.

Route selection per call (`selectSummaryRoute`, summarizer.ts:62-102; policy from `settings.ts`):

1. `summarizerPaused` → no call at all; jobs wait and retry forever.
2. `summarizerProvider` + `summarizerModel` set → that override route (if the provider offers the model).
3. Otherwise the **thread's own provider** (`catalog.sessionProvider(conversationId)`), matched against
   `cheapModels` by exact provider id → AI-Accounts kind (`codex`, `claude`, `opencode-go`, `commandcode`,
   `deepseek`) → longest id prefix; the first listed model the provider offers wins (a trailing `*` takes the
   newest match). Defaults (settings.ts:47-53): `codex→gpt-6-luna`, `claude→claude-haiku-*`,
   `opencode-go→deepseek-v4.1-flash…`, `commandcode→deepseek-v4.1-flash…`, `deepseek→deepseek-flash`.
4. Otherwise each `summarizerFallbacks` entry in order.
5. Nothing left → `unavailable`; the summary is skipped and the job is retried later. **The thread's own
   (expensive) model is never used** (summarizer.ts:57-61).
6. Route is cached per conversation for 60 s; the cache key includes the serialised policy, so a live settings
   edit invalidates it.

`maxTokens` is per call: 2048, escalating to 4096 on an output-budget failure. `reasoningEffort` comes from the
matched cheap-model entry (`codex` entries default to `low`; the `commandcode`/`opencode-go` entries set none).
Timeout: `summarizerTimeoutMs` (settings default 60,000 ms) applied as `AbortSignal.timeout` per call.
What the engine records is `model = "<provider>/<model>"`, so `codex-alex2`/`codex-emialex` are the
AI-Accounts instance ids whose kind is `codex`, and `commandcode` is the native provider id.

For a project-stream node the route key is the **newest event's** conversation id (engine.ts:475-477), so a
project merge is routed by whichever session last contributed to that subtree.

---

## 4. Does DSH record real usage/tokens for these calls? — No (token accounting is session-scoped)

Read-only inspection of `~/.dsh` (no secrets printed):

- The only usage store is `~/.dsh/storages/ai_accounts_usage.json` (`unit: ai_accounts_usage`, v1). It has a
  **single table, `quota`** (2,342 entries): periodic snapshots keyed `v2:<instanceId>:<ordinal>` with
  `{at, instanceId, windows:{name: percentLeft}, resetsAt, bankedResets}`. `global` shows
  `intervalMinutes: 5`. The writer is `@dshfiles/ai-accounts` (`USAGE_HISTORY_DOMAIN = "ai_accounts_usage"`,
  `quotaSnapshotSchema`, `usageHistoryPointSchema`, `retentionDays`).
- **There are no token counts, no per-call rows, and no cost fields anywhere in that store.** It cannot
  attribute anything to OptMem, not even indistinguishably — the dimension does not exist.
- DSH _does_ record real per-call tokens, but only inside a session: `@deepseek-ai/dsh-token-meter`
  (`ctx.sessionProjections.register(...)`, fed by `ctx.on("session/event")`) and
  `@deepseek-ai/dsh-session-stats` (folds `assistant/message.usage`) both fold **session-log events only**.
  `token-meter` _is_ loaded (it is part of the `@deepseek-ai/dsh-base` bundle,
  `cordis.patch.yml:338`), and it is what feeds the client's per-session token/cost estimate — so the
  per-session cost the UI shows **excludes every OptMem summary call**.
- OptMem calls `llm.stream(call)` directly (`optmem/src/host.ts:164-171`) with `purpose: 'compaction'`, no
  `sessionId`, and never appends a session event. `@deepseek-ai/dsh-llm` merely exposes `usage` on the
  assembled stream (`BlockAssembler.usage`) and persists nothing; `summarizer.ts` reads only `finish` and
  `blocks()` and **discards `assembler.usage`**.
- `GenerateOptions.purpose` is `'compaction' | 'session-title'` (dsh-llm types.d.ts:530) — the _same_ value
  DSH's own compaction uses (`dsh-compaction-basic` sets `purpose: "compaction"`). So even a provider-side or
  DSH-side log keyed by purpose could not separate OptMem summaries from DSH compaction.

**Conclusion:** OptMem's summary calls are locally unrecorded. No token count, no money figure, and no
per-provider attribution for them exists on this machine. The only observable trace is the movement of the
provider quota windows in the 5-minute snapshots.

---

## 5. What the calls consume: subscription quota, not tracked credits

**MEASURED** from `~/.dsh/plugins/ai-accounts/accounts.json` + the quota store:

| Instance                          | Kind              | Quota windows recorded        | Snapshots |
| --------------------------------- | ----------------- | ----------------------------- | --------- |
| `codex-alex2`                     | codex             | Current session, Weekly limit | 787       |
| `codex-emialex`                   | codex             | Current session, Weekly limit | 780       |
| `opencode-go-alex` / `_mathias`   | opencode-go       | session, weekly, monthly      | 315 / 28  |
| `commandcode`, `commandcode_work` | (native provider) | Current session, Weekly limit | 106 / 330 |

- The two routes OptMem actually used are **subscription/quota-metered accounts**: Codex accounts whose
  rolling "Current session" and "Weekly limit" percentages are recorded every 5 minutes. A summary call goes
  through the same `llm.stream` path as an ordinary turn with an explicit provider+model, so it is metered by
  that provider exactly like any other call — i.e. it consumes that account's quota window.
- **Observed quota pressure in the OptMem period** (MEASURED, `quota-summary.json`): `codex-alex2` Weekly
  limit sat at ≤5 % from 2026-10-10T15:18Z to 18:35Z; `codex-emialex` Weekly limit ≤5 % from
  2026-10-09T14:45Z to 2026-10-10T10:20Z; each account's "Current session" window dropped to 0–5 % eight
  times between 2026-10-09 and 2026-10-12. Over the same window OptMem produced 51,085 (ESTIMATED) summary
  calls. The two are consistent but **not causally separable** — the same accounts were serving ordinary
  agent turns.
- No dollar/credit ledger exists locally. `~/.dsh/plugins/ai-accounts/pricing.json` is a models.dev catalogue
  (`source: https://models.dev/api.json`, fetched 2026-10-11T18:26Z) used only for the UI's
  "Estimate from published API prices, not an invoice" label. `~/.dsh/.credentials.yaml` holds API keys for
  DeepSeek and OpenCode Go only; none of the OptMem routes is an API-key route.

**Answer:** the calls consume **subscription quota** on the account that owns the route (Codex session +
weekly windows; CommandCode session + weekly). Whether any of these providers additionally converts overage
into credits or spend is not observable here, and no local artefact records it. Not guessed silently — stated
as unobservable.

---

## 6. Remaining work to drain the backlog (arithmetic)

### 6.1 Leaf work — MEASURED

| Quantity                                                                                | Value                                                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Missing level-0 nodes across all streams                                                | 94,984 (53,427 project + 41,557 conversation)                                                |
| … of which events whose text ≤512 B (free verbatim; second-stream copies included)      | 56,682                                                                                       |
| … of which oversized events (would need a summary per stream)                           | 38,302                                                                                       |
| Unique oversized events with **no** level-0 node anywhere (dedup via `findLeafByEvent`) | **16,507**                                                                                   |
| Unique events already summarised (leaf calls already spent)                             | 8,843                                                                                        |
| Unique events with a leaf in both streams (duplicate nodes, no duplicate call)          | 5,842                                                                                        |
| Free verbatim node writes remaining                                                     | 94,984 − 38,302 = 56,682 (of which 21,795 are the deduped second copy of an oversized event) |

The project stream's stall is **MEASURED**: `project:workspace:7ab07f52…` (59,407 entries) has 6,038 leaves and
11,788 nodes; its last node of any kind was written at 2026-10-11T22:29:41Z and it received **zero** nodes on
2026-10-12, while conversation streams kept building (last conversation node 2026-10-12T13:03Z). The mechanism
is out of scope here; the number is not.

### 6.2 Internal (merge) work — MEASURED counts, ESTIMATED free/model split

Total internal nodes a fully built tree needs, `Σ_{l≥1} floor(N/2^l)` per stream (MEASURED stream lengths):
project 59,785, conversation 59,381 → **119,166**; already built 22,545 → **missing 96,621** (project 53,800,
conversation 42,821).

Free/model split, two independent estimators:

- Level 1 only, from the actual child texts (16,507 unknown model outputs assumed 380 B — the MEASURED mean
  of a model leaf): 48,055 missing level-1 parents → **19,786 free / 28,269 model**. Sensitivity to the
  assumed summary size (`level1-sensitivity.json`): free ranges 13,317 (assume 512 B) to 38,435 (assume
  128 B), so this split is the least certain number in the report.
- Levels ≥2, from the observed concat rate at each level in the existing tree (level 2: 3.3–5.9 % free;
  level 3: 0.6–0.7 %; level ≥4: ~0): 48,566 missing parents → ~1,170 free / **47,396 model**.

**Remaining model call-sites (nodes needing one summary): 16,507 leaf + 75,665 internal = 92,172.**

### 6.3 Retry multiplier — MEASURED clip rates, ESTIMATED attempt counts

`clipped:` means all 4 `boundedSummary` attempts overshot. Clip rate by level (**MEASURED**):

| Level    | conversation | project |
| -------- | ------------ | ------- |
| 0 (leaf) | 0.67 %       | 0.78 %  |
| 1        | 4.9 %        | 4.2 %   |
| 2        | 15.5 %       | 13.7 %  |
| 3        | 34.8 %       | 40.7 %  |
| 4        | 46.6 %       | 55.8 %  |
| 5        | 60.9 %       | 58.3 %  |
| 6–9      | 59–63 %      | 52–66 % |

Deep merges fail to fit almost always: two ~500 B notes must be fused into ≤512 B, then into 409, 307, 204 B.
Taking the retry process as geometric with `p(clip) = q⁴`, the expected attempts per call-site is
`(1 − p)/(1 − p^0.25)`, capped at 4 (boundedSummary's hard limit). **ESTIMATED** per level:

| Level     | Sites (leaf+internal) | Est. attempts/site | Est. provider calls |
| --------- | --------------------- | ------------------ | ------------------- |
| leaf 0    | 16,507                | 1.40               | 23,124              |
| 1         | 28,269                | 1.77               | 50,100              |
| 2         | 23,160                | 2.23               | 51,719              |
| 3         | 12,122                | 2.88               | 34,984              |
| 4         | 6,103                 | 3.17               | 19,380              |
| 5         | 3,050                 | 3.32               | 10,145              |
| 6–15      | 2,961                 | ~3.26              | 9,679               |
| **total** | **92,172**            | **2.16**           | **≈199,131**        |

Bounds, with the assumption stated: every non-clipped call-site used at least 1 attempt (and 4 is the cap) →
**lower bound ≈129,778, upper bound ≈368,688** provider calls. The upper bound doubles to ≈737,000 if every
attempt needed the summarizer's output-budget escalation (unobserved; not expected).

**Retries are the dominant cost: (199,131 − 92,172) / 199,131 = 53.7 % of the projected calls exist only
because a 512-byte answer did not fit.** Levels ≥4 alone (clip rate >46 %) contribute ~39,200 calls to build
12,114 nodes — **3.2 calls per node**.

### 6.4 Volume ESTIMATE

| Quantity                        | ESTIMATE                             | Assumption                                                                                                                |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Input bytes remaining           | ~355,100,000 B                       | per-call payload = framed node text + the MEASURED 639–723 B system instruction + frame header; repeated once per attempt |
| Input tokens                    | ≈88,800,000                          | ≈4 bytes/token (±15 % if 3.5 B/token)                                                                                     |
| Output bytes                    | ≈21,900,000 B                        | 110 B mean persisted note                                                                                                 |
| Output tokens                   | ≈5,500,000                           | ≈4 bytes/token                                                                                                            |
| Already spent: model call-sites | 25,554 (MEASURED)                    |                                                                                                                           |
| Already spent: provider calls   | ≈51,085 central, ≥35,985 lower bound | same geometric model; `clipped` nodes are provably 4                                                                      |

No currency figure is offered: the routes are quota-backed and no local store prices them (§4/§5).

---

## 7. Provable cost overheads

1. **Retry cascade inside one node** — `boundedSummary` ×4 attempts × (`summarizer.ts` output-budget
   escalation ×2) = up to **8 provider calls for one node**, all carrying the same input. MEASURED floor:
   3,477 clipped nodes × 4 attempts = 13,908 calls for nodes that then had to be truncated anyway.
2. **Engine-level job retries** (engine.ts:296-325) — `recordFailure` re-enqueues a failed job while
   `attempt < 5` with exponential backoff (1 s → 60 s), and `retryFailures()` (operator/UI action) resets the
   attempt counter, so the 5-attempt budget is per-burst, not per-node. A failed job writes **no node**, so
   **every call it spent is invisible in the DB.** `retryFailed()` also runs on every `append` _and_ on every
   `snapshot` when the view lags the stream length (engine.ts:681), which is permanently true for the stalled
   project stream (view `through_pos` 468 vs 59,407 entries) — so each turn of each session re-enqueues the
   retryable failures.
3. **Terminal failures are parked, not fixed** — an `OutputBudgetError` is `retryable = false`
   (summarizer.ts:129-139), so a node whose summary exceeds 4,096 output tokens stays missing until a manual
   retry, which will fail again. Quota/timeout errors are plain `Error`s, so they _are_ retried 5× each,
   each retry re-running up to 4 summarize attempts.
4. **Same content folded into two trees** — MEASURED: **59,804 of 59,804 events (100 %)** appear in one
   conversation stream **and** one project stream; 23,573 of them are oversized. Leaf calls are deduped by
   event id (`findLeafByEvent` + the in-memory `leafTexts` map), so the duplicate tree costs **zero** extra
   leaf calls (MEASURED: 18,782 unique events produced 24,624 level-0 nodes; 5,842 events have 2 nodes).
   Internal merges are not deduped: MEASURED 16,711 internal model nodes are 65 % of all model nodes, and
   the two trees are the same size (expected internal nodes 59,785 project vs 59,381 conversation, 0.7 %
   apart). So ≈half of all merge work exists only because the same events are re-folded in the second tree —
   with merges at 82 % of remaining call-sites (75,665/92,172), that is **≈41 % of all remaining model calls
   (≈37,800 call-sites, ≈82,000–88,000 provider calls) attributable to the duplicate tree**. Stated as a
   measurement, not a recommendation: ingestion semantics are out of scope.
5. **Payload inflation** — the JSON framing adds 1.6–2.9 % to the text, and the ~640–720 B system
   instruction is resent on every attempt: ≈137 MB of the ≈355 MB remaining input is instruction text, not
   memory content.
6. **Unbounded re-summarisation of the same content** — a project merge and a conversation merge of
   overlapping events are indistinguishable to the provider; with 60 % clip rates at depth, a single event's
   text is re-sent through the merge cascade of two trees, each level up to 4 times.

---

## 8. Open unknowns (stated, not guessed)

- How many calls were lost to timeouts (60 s) and quota errors: **no record exists** (failed jobs write no
  node, and no log line was found — `grep` for the optmem warning strings across `~/.dsh/logs` and
  `~/.dsh/sessions` returns 0 hits; the Cordis logger does not persist to a file here).
- True attempts per non-clipped call-site: only clipped sites reveal their attempt count. The geometric model
  in §6.3 is an assumption; the hard bounds are 1 and 4.
- The free/model split for missing level-1 parents depends on the size of not-yet-produced summaries; the
  measured sensitivity spans 13,317–38,435 free pairs.
- Whether the level-0 dedup holds under concurrent enqueue in all orders is argued from the code
  (`findLeafByEvent` is checked for every unbuilt leaf) but the DB cannot prove no duplicate calls were ever
  made before a leaf was persisted.
- Currency impact: unobservable locally (§4/§5).
