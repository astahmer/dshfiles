# Self-improvement plan — 2026-10-15 … 22 window

**Resume here:** start with `T1` (dshx schema projection) and `T10` (checkout-sync
fan-out); both are S, both remove failures measured in the thousands of tool
calls. Nothing in this plan touches DSH core.

## Why this plan exists

`/self-improve` over 7 days of Session logs (`node scripts/self-improve.ts mine
--since=7d --scope=all`): 1,292 Sessions found, 935 in window, 287 projects,
159,930 tool calls, 4,530 tool errors, 2,958 turns, 263 corrective prompts.
Eight subagents then re-derived the numbers from the raw logs and from the
installed runtime, so every task below cites either a measured failure count or
a file/line root cause. The mining report itself is scratch (`output/…`); the
plan is the durable artefact.

Counts below are 7-day occurrences, with Sessions in parentheses. Forked
Session copies replay a parent prefix, so raw counts run ~10 % high; the
numbers already say so where it matters.

## Decisions taken (not doing)

- **No computer use.** 133 of 173 `web_fetch` failures are redirect/content-type
  policy in `dsh-web-fetch-http`, and all 177 search failures are credential
  failures. A browser adds 25–50× latency per page. Fix the provider instead
  (`T7`, `T8`).
- **No per-action jj tools.** The tool surface already carries 232 schemas;
  adding ~18 near-duplicate write tools is worse than fixing the projection that
  hides `oneOf` (`T1`).
- **No guard-only tool allowlist.** `ctx.tools.guard` denies calls but keeps the
  schema in the request header; `tools.restrict({allow, deny})` is the verb that
  shrinks the header.
- **No second tool inventory.** `docs/agent-tool-parity.md` already lists owners
  and tools; extend it with intent→tool guidance (`T16`), do not add `tool-map.md`.
- **No read receipts across compaction.** Measured 12 failures (1.9 %). The real
  receipt loss is plugin recomposition (`T2` in `A1` analysis below).
- **No core patch, anywhere.** Every task is an owned plugin, dshx, profile seed,
  docs or instruction. Anything else is recorded in
  [`plans/dsh-host-gaps.md`](../dsh-host-gaps.md).

## Findings that reshaped the first pass

| Earlier claim                                                | What the evidence says                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compaction wipes read receipts, causing most edit failures   | Compaction explains **12/616** (1.9 %). Bash-only inspection explains 270 (43.8 %), ast-outline-only 127 (20.6 %), and **147 (23.9 %) are receipts lost when a plugin rebuild / `profile:sync` / checkout sync recomposes `dsh-observation-policy`** (5.5× enrichment over successful read→edit pairs). |
| `list_thread_questions` is slow because it waits for answers | It never awaits. It lists the whole corpus and cold-reprojects every non-live Session; p50 49 s, p90 195 s, 400 distinct calls. Its 30 s TTL cache records **0 hits** (inter-call gap p50 109 s).                                                                                                       |
| glob/grep timeouts are the fff-search plugin's fault         | The opposite: fff-search is live and shadows the native tools per agent, and glob timeouts stopped when it landed. The remaining timeouts are native `glob` pointed at `$HOME`/`$HOME/dev`, walking ignored+hidden trees with `--sort=modified`.                                                        |
| The fallback chain covers provider exhaustion                | The chain returns `[]` unless distribution is `priority`; live distribution is `sticky`, so the chain is dark. Spent routes cool only 5 min because reset hints are ignored.                                                                                                                            |
| A tool-surface allowlist must be built                       | `tools.restrict` already exists and hides schemas; an unlanded revision (`jj:xvxqxkppwzko`) already ships `tool-search` with progressive disclosure. Coordinate, do not rebuild.                                                                                                                        |

## Workstreams

Check a box only with a receipt (command + number) from the same window.

### W1 — Toolchain correctness

- [ ] **T1. dshx must project the schema subset DSH actually enforces.**
      `tooling/dshx/packages/dshx/src/api/json-schema.ts:39-43` collapses any
      multi-branch `oneOf`/`anyOf` to `{}`, and `:44-61` drops `pattern`, `minimum`,
      `maxLength`, `default`, `examples`. DSH's enforced subset supports exact-one
      `oneOf`, `enum`, `const` (`@deepseek-ai/dsh-tools/lib/types/json-schema.d.ts:4-40`).
      Consequence: `jj_prepare_action.action` reaches the model as `{}`.
      Change: project supported keywords through, keep the deliberate loosening for
      the rest, add an explicit test that a discriminated union survives to
      `parameters.oneOf`. Files: that module, `tooling/dshx/packages/dshx/tests/api-registry.spec.ts:95`.
      Validation: a probe publishing a 2-branch union, and the jj action tool's
      `parameters` in `dshx inspect`; then `jj_prepare_action` schema errors
      (64/7d) should go to ~0.
      Effort S. Risk: low; additive for every dshx plugin.

- [ ] **T2. jj tool hardening bundle** (after T1):
      `jj_load` `limit` minimum 20 → 1 (`jujutsu/src/api.ts:207`, 56 failures);
      accept 1–64 hex / change-id prefixes and resolve server-side (44+14 failures,
      only for `[a-z0-9]{1,64}`, refuse ambiguous); surface the real `ThreadError`
      text instead of “API handler failed” (`jj-integration/src/host.ts:1267-1274`,
      125 failures); one message per preview cause, invalidate only on target-revision
      change (`jujutsu/src/host.ts:813`, 31); rebase eligibility always returns
      `{code, blockers, remedy}` and an explicit `force` with no default
      (`jj-integration/src/host.ts:658`, 27+13).
      Validation: those five error classes in the next window.
      Effort S–M. Risk: low; widened inputs, same tool names.

- [ ] **T3. Persist read receipts across plugin recomposition** (owned gap, needs
      a Host seam). 147 failures have a read fresher than any compaction but are
      refused after a plugin rebuild/sync. If the observation policy cannot be made
      durable from a plugin, record the gap and lean on `T4` instead.
      Effort S–M. Risk: medium if it needs a policy fork.

### W2 — Editing and inspection

- [ ] **T4. Owned patch tool with auto-read.** Addresses 616 not-read + 304
      changed + 288 old-string failures; realistically 80–95 %. Contract: read the
      file itself (no native receipt needed), whitespace-tolerant context anchors,
      re-read and retry once on mismatch, refuse ambiguous hunks with the candidate
      lines. Do not replace `edit`; ship beside it and point instructions at it.
      Effort L. Risk: medium (new write path) — gate behind tests, never used for
      files it has not read itself.

- [ ] **T5. Inspection that emits fs/observed** (ast-outline wrapper + a
      read-equivalent for `cat`/`sed`/`head`): 397/616 not-read failures (64 %).
      Cheapest version: an owned `inspect` tool that runs ast-outline and a bounded
      read, registering the same receipt. Effort M.

- [ ] **T5b. Read-path suggestions for the residual 400 misses** (149 Sessions):
      35.5 % dead workspaces, 19.5 % regenerated e2e artefacts, 14 % doubled
      prefixes. A duplicated-prefix collapse plus one suffix-matched candidate
      would recover ~26 % (104/400). The native `read` tool is core-owned, so ship
      the recovery in the owned inspect/patch tool and record the native hint in
      [`plans/dsh-host-gaps.md`](../dsh-host-gaps.md). Effort S.

### W2b — Tool surface and progressive discovery

Two layers exist already: `tools.restrict({allow, deny})` hides schemas for the
calling agent, and the unlanded `jj:xvxqxkppwzko` adds a `tool_search` for
progressive disclosure. Do not build a third mechanism.

- [ ] **T5c. Coordinate and land `jj:xvxqxkppwzko` (tool-search)** or decide
      against it with its owner (workspace `thread-8b729e`, Session `0e7f3adb…`
      holds it). Measure the request header before/after: today 232 tools /
      121,845 bytes per request while only 148 tools were used in a week.
      Effort S to evaluate, M to land.

- [ ] **T5d. Tool profiles only if tool-search is not enough**: one preset row
      variant (coding / research / ops) calling `tools.restrict` with an allowlist,
      then measure header bytes, wrong-tool errors and model latency. Do not use
      `ctx.tools.guard` for this — it denies calls but keeps every schema in the
      request. Effort M.

### W3 — Web access

- [ ] **T6. Owned fetch provider**: follow cross-origin redirects with
      per-hop public-address revalidation, widen content types, add readability
      extraction; select via `web.fetchProvider`. Root cause verified in
      `dsh-web-fetch-http` (`WEB_REDIRECT_BLOCKED`, `isSameOrigin`, 30 s default).
      Removes ~133/173 fetch failures. Effort M. Risk: low (SSRF revalidation is the
      security-critical part).

- [ ] **T7. Free search provider**: Brave Search API free tier or Tavily
      keyless, selected via `web.searchProvider`; also fix the credential path for
      the current provider. Kills both search classes (138 credits + 39 no-key).
      Effort S–M. Decision needed: which key.

- [ ] **T8. Playwright MCP spike (optional, after T6).** Only for JS-rendered or
      anti-bot pages. `--isolated --headless`, `/tmp` profile, never a persistent
      profile (cookies are credentials), and never enable `browser_run_code_unsafe`.
      5 failing URLs, success rate + latency + bytes, then keep or drop.

### W4 — Search tooling

- [ ] **T9. fff-search guards**: reject or narrow out-of-workspace roots instead
      of indexing `$HOME`; precheck that the root exists and answer
      `path does not exist: X` (86 instant errors); default excludes for
      `node_modules`, `.dsh`, `.cache`, `Library`, `.git`. Native `glob` is core-owned,
      so this is the only lever. Effort S–M.

### W5 — Workspace and integration hygiene

- [ ] **T10. Checkout-sync fan-out**: 25 `workspace.sync_failed` attention events
      (10 in a two-minute burst), all “default@ carries described work…”. Auto-rebase
      `default@` when its revisions are absorbed by the new tip, otherwise dedupe by
      fingerprint and downgrade to info. Root: `tooling/dshx/packages/dshx/src/checkout/sync.ts:302`.
      Validation: `workspace.sync_failed` count per landing, and that one failure
      produces one event. Effort M.

- [ ] **T11. Isolation bypass**: live profile sets `isolateByDefault: true`,
      `autoIntegrationScope: all`, yet 20 Sessions were created in the shared
      `~/dev/dshfiles` checkout on 2026-10-20…21 (105 in the whole window). Find the
      creation path that bypasses the guard (thread_create / agents / btw / Ask) and
      route it through the same destination logic. Effort M.

- [ ] **T12. `workspace_doctor` tool**: one call returning `@`, conflicts,
      behind-count, busy Sessions, blockers and sync verdict — replaces the 95
      `jj_thread_status` failures (31 Sessions) and the 5-call inspection loop.
      Effort S–M.

### W6 — Agent conduct

- [ ] **T13. Done contract** (D4): a short “Definition of done” section in
      [AGENTS.md](../../AGENTS.md) — reproduce, root cause, narrowest check, evidence
      line, unverified line — pointing at `focused-validation`. Optionally reinforce
      with a client notice when a turn edited plugin sources and ran no
      `project_checks_run` (turn-summary already renders after a turn; investigate the
      hook before promising it). Target: `incomplete-or-unfixed` pushbacks
      (245 / 119 Sessions) per 100 turns.

- [ ] **T14. Waiting rules** (D5): `job_wait` first (`T15`), then a table in
      AGENTS.md mapping each wait to its replacement (job → `job_wait`, agent →
      end turn/message, user → async question or schedule, CI → background job).
      328 `sleep` calls in 76 Sessions and 293 identical `job_output` polls are the
      baseline.

- [ ] **T15. `job_wait` in background-jobs**: block until a job settles (or
      timeout), default wait on `job_output`, durable ids that survive a Host
      restart. Effort S. Then extend one `wait_for` tool to inbox / question / file /
      thread state (effort M), which is the general answer to polling.

- [ ] **T16. Tool map** (D3): an intent→tool section in
      [docs/agent-tool-parity.md](../../docs/agent-tool-parity.md) — “before you
      inspect, pick the tool” — plus a pointer from the capability-skill path. No new
      inventory. Effort S.

- [ ] **T17. Delegation and comm docs** (D6/A5): depth limit, child limit,
      parent-only questions, self-send refusal, and when to use `send_message` vs
      `dshx_comm_*`. Effort S.

### W7 — Context diet

- [ ] **T18. Trim always-on instructions**: repo `AGENTS.md` is 27,382 chars
      against a 24,000 budget; move detail into the owning docs/skills, then
      `node scripts/self-improve.ts validate` must report no over-budget warning.
      Effort S.

- [ ] **T19. Skill reload reduction**: 1,115 loads in 200 Sessions, 714 after a
      compaction (64 %). Two levers: cap skill bodies (verify-dsh 10,008 chars,
      self-improve 8,721) and move detail into `REFERENCE.md`; optionally shadow the
      `skill` tool so a repeat call returns a 10-line digest instead of the body.
      Target: loads per Session, and tokens per Session from `usage_report`.
      Effort M. Record the “pin a tool result across compaction” ask as a Host gap.

- [ ] **T20. Compaction measurement**: 872 compactions / 936 Sessions, but 8,425
      prunes vs 850 summaries — pressure is dominated by tool output. Measure the top
      result producers before changing anything; then bound them in instructions
      (`| head`, offsets, ast-outline) rather than adding a backend.

### W8 — Performance of owned read paths

- [ ] **T21. `list_thread_questions` fixes** (all plugin-side, stock Host):
      TTL 30 s → 10 min (`agent-questions/src/host.ts:64`); skip non-live Sessions by
      default; when `sessionId` is given, read that target instead of listing the
      corpus (`host.ts:368-369`); single-flight the whole scan. Target: p50 from 49 s
      to <2 s for scoped calls, no >60 s calls. Host ask stays gap #57.

- [ ] **T22. Other store folds**: `thread_list` 165 s, `jj_thread_repositories`
      181 s, `dshx_comm_history` 223 s. Measure each owner, then cache or narrow the
      projection per Session in the fork that owns it. Do not promise numbers before
      the measurement.

### W9 — Providers

- [ ] **T23. ai-accounts health**: reset-aware cooldown floor (parse the reset
      hint; today a 151-min ChatGPT reset cools 5 min), sticky preflight that skips a
      cooling account, classify `SERVER`/`STREAM_CLOSED` as transport, cool after N
      transport failures, preflight no-adapter selections, one attempt budget per
      step. Target: `llm/retry` rows per 1,000 requests, and ≤1 Codex usage-limit row
      per conversation per reset window (199/7d). Effort S each. The 55 % upstream
      bucket cannot be fixed.

- [ ] **T24. Fallback-chain decision**: the chain only runs under
      `distribution: priority`; live is `sticky` with no default chain. Either switch
      and seed a chain, or document that the feature is off. User decision.

### W10 — Housekeeping

- [ ] **T25. Session corpus prune**: 1,698 MB / 1,307 Sessions is the input to
      every fold above. Archive or delete Sessions past a retention window, keep the
      index healthy (`session_search_health`), then re-measure `T21`/`T22`.

- [ ] **T26. `dsh web` EADDRINUSE preflight** (nixfiles supervisor): duplicate
      launches on 2026-10-20 produced startup logs full of `EADDRINUSE 127.0.0.1:3080`.

- [ ] **T27. Dead skill link** (fix it): `~/.agents/skills/write-a-skill/SKILL.md`
      links `REFERENCE.md` that does not exist. The tree is a Nix build of
      `github:astahmer/AGENTS`; the fix belongs in that repo (change the template
      example to a non-link or ship the file), then bump the flake input. Not this
      repository.

- [ ] **T28. Close the stale ledger entry**: `si-2026-10-18-instructions-path-missing-user-preferenc`
      — verified 2026-10-22: no `USER_PREFERENCES` reference in `~/.dsh/AGENTS.md`
      or `~/.agents/AGENTS.md`, and `validate` no longer reports it.

## Order

| Phase | Tasks                                              | Why first                         |
| ----- | -------------------------------------------------- | --------------------------------- |
| P0    | T1, T10, T21 (3 S fixes), T9, T23 (first two), T28 | Small, measured, unblocks others  |
| P1    | T15, T6, T7, T2, T5b, T5c, T13, T14, T16, T17, T18 | User-visible wins and honesty     |
| P2    | T4, T5, T5d, T11, T12, T19, T22, T25               | Larger builds, need design review |
| P3    | T8, T20, T24, T26, T27                             | Optional or user decision         |

## Validation harness

```sh
# candidate errors, week over week
node scripts/self-improve.ts mine --since=7d --scope=all --top=60
# deterministic harness checks
node scripts/self-improve.ts validate
# CPU/latency + cost claims
#   usage_report over the same window, groupBy model, bucket day
# tool-surface size
#   request/header bytes and tools count from the newest Session log
# whatever changes: node --run check:diff, then the plugin's own focused check
```

Every task states its metric above; a task is done only with a before/after pair
from the same window and the confounders named (provider outage, user
interruption, forked-Session duplication).

## Open questions for the human

1. `T7` search provider: Brave free tier (key) or fix the existing provider's key?
2. `T24`: switch ai-accounts to `priority` distribution (makes the fallback chain
   live, changes routing behaviour) or keep sticky and document the chain as off?
3. `T4` patch tool: ship beside `edit` (safe) or aim to replace it in instructions?
