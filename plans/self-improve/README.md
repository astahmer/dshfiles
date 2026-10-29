# Self-improvement backlog

Durable state for `/self-improve`. The machine-readable records live in
[`ledger.jsonl`](ledger.jsonl); this file is the human view of it, plus the
open tasks from the last full mining pass.

Read the operating manual first: [`docs/self-improvement.md`](../../docs/self-improvement.md)
and the skill at [`.agents/skills/self-improve/SKILL.md`](../../.agents/skills/self-improve/SKILL.md).

## Resume here

Run the weekly review first: `node scripts/self-improve.ts review --since=7d`.
Its candidate list is the short list; the ledger stops a candidate being opened
twice. The open tasks below come from the 2026-10-15…22 mining window.

```sh
node scripts/self-improve.ts review --since=7d --top=5
node scripts/self-improve.ts ledger list --status=proposed
node scripts/self-improve.ts mine --since=14d --top=25
```

## Decisions (not doing)

- **No computer use for web access.** Most `web_fetch` failures were the fetch
  provider's redirect and content-type policy, and search failures were
  credentials. A browser adds 25–50× latency per page. Fix the provider instead
  (`T6`).
- **No per-action jj tools.** Fix the schema projection that hid `oneOf` instead
  of adding near-duplicate write tools (done: dshx keeps object `oneOf`).
- **No guard-only tool allowlist.** `ctx.tools.guard` denies calls but keeps the
  schema in the request header; `tools.restrict({allow, deny})` shrinks it.
- **No second tool inventory.** The intent-to-tool table lives in
  [`docs/agent-tool-parity.md`](../../docs/agent-tool-parity.md).
- **No read receipts across compaction.** Compaction explained 12 of 616
  not-read edit failures (1.9 %); the larger losses are bash-only inspection and
  plugin recomposition. The `apply-patch` tool reads the file itself and covers
  those classes.
- **ast-outline stays.** It is not the cause of the read-receipt failures, and
  removing it would push inspection back onto bash reads.
- **No core patch.** Every task is an owned plugin, dshx, profile seed, docs or
  instruction. Anything else goes to [`plans/dsh-host-gaps.md`](../dsh-host-gaps.md).

## Open

Each task names its metric; it is done only with a before/after pair from the
same window and the confounders named (provider outage, user interruption,
forked-Session duplication).

| Task                                    | What remains                                                                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2. jj tool hardening                   | Accept 1–64 hex / change-id prefixes and resolve server-side (refuse ambiguous); one message per preview cause, invalidated only on a target-revision change; rebase eligibility always returns `{code, blockers, remedy}`.  |
| T3. Read receipts across recomposition  | 147 edit failures had a fresh read refused after a plugin rebuild or sync. Revisit only if the edit error rate does not drop with `apply-patch`; needs a Host seam or a gap row.                                             |
| T5. Inspection that emits `fs/observed` | An owned `inspect` tool (ast-outline plus a bounded read) that registers the same receipt. Same condition as T3.                                                                                                             |
| T5b. Read-path suggestions              | Of 400 missed reads, a duplicated-prefix collapse plus one suffix-matched candidate recovers about 26 %. Ship in an owned tool; record the native `read` hint as a Host gap.                                                 |
| T5d. Tool profiles                      | Only if `tool-search` is not enough: a preset variant (coding / research / ops) calling `tools.restrict`; measure header bytes, wrong-tool errors and latency.                                                               |
| T6. Owned fetch provider                | Follow cross-origin redirects with per-hop public-address revalidation, widen content types, add readability extraction; select via `web.fetchProvider`. The base `http` provider blocks redirects (`WEB_REDIRECT_BLOCKED`). |
| T8. Playwright MCP spike                | Optional, after T6, for JS-rendered pages only: `--isolated --headless`, a `/tmp` profile, never `browser_run_code_unsafe`.                                                                                                  |
| T10. Checkout-sync fan-out              | One "default@ carries described work" failure fanned out to many `workspace.sync_failed` events. Auto-rebase `default@` when the new tip absorbs its revisions, otherwise dedupe by fingerprint (dshx `checkout/sync.ts`).   |
| T11. Isolation bypass                   | Sessions were still created in the shared checkout with `isolateByDefault: true`. Find the creation path that skips the guard (thread_create, agents, btw, Ask) and route it through the same destination logic.             |
| T12. `workspace_doctor` tool            | One call returning `@`, conflicts, behind-count, busy Sessions, blockers and sync verdict, replacing the multi-call `jj_thread_status` loop.                                                                                 |
| T17. Delegation and comm docs           | Depth limit, child limit, parent-only questions, self-send refusal, and when to use `send_message` vs `dshx_comm_*`.                                                                                                         |
| T19. Skill reload reduction             | 64 % of skill loads came after a compaction. Cap skill bodies and move detail to `REFERENCE.md`; record "pin a tool result across compaction" as a Host gap.                                                                 |
| T20. Compaction measurement             | Prunes outnumber summaries 10:1, so tool output drives pressure. Measure the top result producers before changing anything.                                                                                                  |
| T21. `list_thread_questions`            | TTL, stopped-Session skip and scoped reads landed; single-flighting the whole scan remains. The Host ask is gap #57.                                                                                                         |
| T22. Other store folds                  | `thread_list`, `jj_thread_repositories` and `dshx_comm_history` each took minutes at worst. Measure each owner, then cache or narrow per Session.                                                                            |
| T25. Session corpus prune               | Archive Sessions past a retention window, keep the index healthy, then re-measure T21/T22.                                                                                                                                   |
| T26. `dsh web` EADDRINUSE preflight     | Duplicate launches fill startup logs with `EADDRINUSE 127.0.0.1:3080`. Belongs to the nixfiles supervisor.                                                                                                                   |
| T27. Dead skill link                    | Fixed in `astahmer/AGENTS`; the nixfiles flake input still pins the old commit (`nix flake update agents` + `nixapply`).                                                                                                     |

Done from that pass: dshx schema projection (T1), `apply-patch` beside `edit`
(T4), Definition of done and waiting rules in `AGENTS.md` (T13, T14, T18),
`background_jobs_wait` (T15), the intent-to-tool table (T16), ai-accounts
reset-aware cooldown and the `priority` same-family fallback chain (T23, T24;
Claude never falls back and is never a fallback target), Brave `web_search`
(T7), fff-search path guards (T9), and the stale ledger entry (T28).

The `priority` routing only runs when ai-accounts distribution is `priority`;
switching the live config is the user's call (a restart applies it).

## Validation harness

```sh
node scripts/self-improve.ts mine --since=7d --scope=all --top=60 # candidate errors, week over week
node scripts/self-improve.ts validate                              # deterministic harness checks
```

Pair it with `usage_report` over the same window for cost claims, and the
request header bytes and tool count from the newest Session log for tool-surface
size.

## Ledger entries done

| Entry                                                    | Outcome                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `si-2026-10-18-correction-misunderstood-requirement`     | `validated` — prompt origin is read from `data.source.kind` and the opening brief is recognised by whether the agent has produced output; false corrections dropped 631 → 24 Sessions and 1 943 → 29 hits                                       |
| `si-2026-10-18-turn-end-completed`                       | `validated` — `turn-end` uses an allowlist of abnormal endings; 2 960 phantom hits gone                                                                                                                                                         |
| `si-2026-10-18-instructions-path-missing-user-preferenc` | `validated` — no `USER_PREFERENCES` reference remains in `~/.dsh/AGENTS.md` or `~/.agents/AGENTS.md`, and `validate` reports no `instructions.path-missing` finding; the referenced file was never created, the instruction was removed instead |

Two more defects in the miner were fixed without their own entry, because a
fixed gate cannot recur: the opening brief scored as pushback, and a file
re-edited inside one Session read as a pattern. Measurements, conditions and the
two control signals are in
[`docs/self-improvement.md`](../../docs/self-improvement.md#the-correction-signal-defect).

## Not a backlog

Mining reports are scratch: they land in the git-ignored
`output/self-improve/` and are not committed. Only the ledger, this file, and the
code changes a run produces belong in version control.
