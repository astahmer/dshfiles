# OptMem Stage 5 — historical evaluation runbook

Stages S0–S5 were completed and their dated results are recorded in [benchmarks](benchmarks.md) and
[runtime evidence](runtime-evidence.md). This is a reproduction guide, not a current completion checklist. It creates
scratch profiles and may run real provider turns; never point it at the `web` profile or port 3080.

Tools (in `plugins/@dshfiles/optmem/scripts/`):

- `drive.mjs <out.json> <full|compat> <scenario.json>` — creates a throwaway `optmem-full` scratch profile (fork core +
  ai-accounts + optmem), boots `dsh` on a free port, runs the scenario's conversations turn by turn through the dshx
  platform client, writes per-turn evidence (`usage`, `request/messages-override` counts, tool calls) + host log, then
  kills the host. Env: `REAL_HOME=1` (optional: host on the real `~/.dsh` instead of the isolated scratch home), `STOCK=1` (stock core, no fork → compat only),
  `PROVIDER/MODEL/EFFORT`.
- `summarize.mjs <run.json>…` — per-turn table + totals (input incl. cache, cache read %, output).
- `read-log.mjs <session.v5.jsonl> [type-filter] [width]` — dump events of a session log.
- Scenarios: `scenario-smoke.json` (2 turns), `scenario-long.json` (24-turn build-up with code, an obscure fact, a
  2.5 KB paste, tool use, then a 2-turn recall conversation).

## S0 — prep (once)

```bash
cd /Users/astahmer/dev/dshfiles
fnm use 22.23.3
pnpm --dir tooling/dshx install --frozen-lockfile && pnpm --dir tooling/dshx --filter @dshfiles/dshx build
pnpm --dir plugins/@dshfiles/dsh-core-runtime run build
pnpm --dir plugins/@dshfiles/optmem run build
pnpm --dir plugins/@dshfiles/ai-accounts run build
```

- [x] S0 done

## S1 — long-conversation comparison (stock vs compat vs full)

Smoke first (≈2 cheap turns) to confirm the route answers:

```bash
node plugins/@dshfiles/optmem/scripts/drive.mjs /tmp/optmem-smoke.json full plugins/@dshfiles/optmem/scripts/scenario-smoke.json
node plugins/@dshfiles/optmem/scripts/summarize.mjs /tmp/optmem-smoke.json
```

Then the three long runs (each gets a fresh scratch home, so memory starts empty):

```bash
STOCK=1 node plugins/@dshfiles/optmem/scripts/drive.mjs /tmp/optmem-stock.json compat plugins/@dshfiles/optmem/scripts/scenario-long.json
node plugins/@dshfiles/optmem/scripts/drive.mjs /tmp/optmem-compat.json compat plugins/@dshfiles/optmem/scripts/scenario-long.json
cp -R "$(node -p 'require("/tmp/optmem-compat.json").home')/plugins/optmem" /tmp/optmem-db-compat
node plugins/@dshfiles/optmem/scripts/drive.mjs /tmp/optmem-full.json full plugins/@dshfiles/optmem/scripts/scenario-long.json
cp -R "$(node -p 'require("/tmp/optmem-full.json").home')/plugins/optmem" /tmp/optmem-db-full
node plugins/@dshfiles/optmem/scripts/summarize.mjs /tmp/optmem-stock.json /tmp/optmem-compat.json /tmp/optmem-full.json > /tmp/optmem-s1.md
```

Note: "stock" = no fork + optmem compat; for a true no-OptMem baseline, run once more with `STOCK=1` after
temporarily setting `enabled: false` (add `enabled: false` under `dshfiles-optmem.config` in `drive.mjs`'s overlay).
If `usage` fields are empty in the table, check the real field names with
`jq '.turns[0].assistant[0].usage' /tmp/optmem-full.json` and adjust `summarize.mjs`.

What to record in benchmarks.md (paste `/tmp/optmem-s1.md` + a short reading):

- total input tokens, cache-read %, output tokens per mode; per-turn growth curve (stock/compat grow linearly with
  history, full should stay ~flat = system + view + current turn).
- recall answers for turns 21–24 and conversation B (correct / wrong / used tool).
- [x] S1 done — tables + reading in benchmarks.md "Long conversation" (incl. the no-OptMem baseline); `cacheReadTokens` is the right field, summarize.mjs unchanged

## S2 — real summaries in full mode (from the S1 full run DB)

```bash
node --no-warnings -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/tmp/optmem-db-full/optmem.db", { readOnly: true });
const q = s => db.prepare(s).all();
console.log("events", q("select count(*) n from events"));
console.log("nodes by model", q("select model, level, count(*) n, max(bytes) maxBytes from nodes group by model, level order by level"));
console.log("views", q("select stream, kind, through_pos, bytes, version from views"));
console.log("cursors", q("select * from cursors"));
'
```

(If `kind` doesn't exist in `views`, drop it — check `select sql from sqlite_master`.) Expect: level-0 nodes with
model `gpt-6-luna` for the 2.5 KB paste and long code answers, some level ≥1 nodes, all `bytes ≤ 512`.

- [x] S2 done — runtime-evidence.md "Stage 5": 54 LLM nodes, levels 0–4, all ≤ 512 bytes

## S3 — record actual request bytes (small code change) — paste to an agent

> In /Users/astahmer/dev/dshfiles (jj, shared working copy — touch only these paths), extend the fork event
> `request/messages-override` (tooling/dsh-core/session/src/types.ts + agent-loop/src/agent.ts where it is appended)
> with `originalBytes` and `sentBytes` = UTF-8 byte length of `JSON.stringify(messages)` before/after the
> `agent/request-messages` waterfall; keep the event `ignorable`. Update agent-loop/tests/request-messages.spec.ts,
> rebuild `tooling/dsh-core/session`, `agent-loop` and `plugins/@dshfiles/dsh-core-runtime`. In
> plugins/@dshfiles/optmem/scripts/summarize.mjs add a "bytes orig→sent" column from `turn.overrides`. Also make
> `plugins/@dshfiles/optmem` `memory_status` show the last full-mode request's sent bytes. Run the fork spec, optmem
> tests/typecheck/build, dist import check (node 22.23.3), workspace contract; one path-scoped jj revision
> (`jj split -m "feat(dsh-core): record request bytes in the override event" <paths>`), co-author trailer
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Terse report.

Then re-run only the full long run from S1 to get byte numbers.

- [x] S3 done

## S4 — why the codex route returns empty replies from an isolated DSH_HOME — paste to an agent

> Read-only investigation first, in /Users/astahmer/dev/dshfiles. Context: plugins/@dshfiles/optmem/docs/runtime-evidence.md (Stage 4,
> "Why DSH_HOME stayed the real one"). With `drive.mjs` without `REAL_HOME=1` (isolated DSH_HOME, accounts.json copied),
> every turn on `codex-emialex/gpt-6-luna` ends `completed` with an empty assistant message and no usage within
> ~30 ms, even on the stock core. Find the cause in plugins/@dshfiles/ai-accounts (codex shadow home resolution,
> `~/.codex-dshx`, keychain/env credentials, `DSH_HOME`-relative paths in account-store.ts / provider-profile.ts) and
> the pi-ai codex provider; reproduce with `ONE_TURN=1 node plugins/@dshfiles/optmem/scripts/drive.mjs /tmp/iso.json full
plugins/@dshfiles/optmem/scripts/scenario-smoke.json` (no REAL_HOME) and read `/tmp/iso.json.host.log`. Propose the minimal fix
> (likely: resolve the codex auth home from the account config, not from DSH_HOME), implement it with a regression
> test in ai-accounts, verify the isolated run answers, then make REAL_HOME optional in the runbook. One path-scoped
> jj revision. Terse report.

- [x] S4 done — cause: `codex-home.ts` anchored the credential guard on `$HOME`; an isolated `HOME` rejected the
      account's real `~/.codex` paths, so the route was dropped and turns ended empty. Now anchored on the OS account home
      (`userInfo().homedir`); `drive.mjs` runs fully isolated by default and `REAL_HOME=1` is optional.

## S5 — recorded outcomes

Hardening outcomes are retained in the code, tests, and [runtime evidence](runtime-evidence.md): stock session logs
accept the ignorable override event; compat context refreshes only after configured growth or a merge; project streams
fold from `path:` into `workspace:` on resolution; backfilled events remain append-only and carry provenance; and
AI Accounts reports routes skipped during provider construction.

A 100k-event run was recorded on a busy machine in [benchmarks](benchmarks.md). It is not a quiet-machine baseline;
repeat it only when load is low and append the result. The remaining gate is tracked in the [OptMem validation plan](../../../../plans/optmem/README.md).
