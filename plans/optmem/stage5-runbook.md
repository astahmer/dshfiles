# OptMem Stage 5 — runbook (copy-paste)

Goal: finish evaluation + hardening with the minimum of thinking at run time. Each section is either **commands to
run** or a **prompt to paste to an agent**. Record results in [benchmarks.md](benchmarks.md) /
[runtime-evidence.md](runtime-evidence.md) and tick the boxes here. Cost: real turns on `codex-emialex/gpt-6-luna`
effort low (cheap). Never touch the `web` profile / port 3080.

Tools (in `plans/optmem/tools/`):
- `drive.mjs <out.json> <full|compat> <scenario.json>` — creates a throwaway `optmem-full` scratch profile (fork core +
  ai-accounts + optmem), boots `dsh` on a free port, runs the scenario's conversations turn by turn through the dshx
  platform client, writes per-turn evidence (`usage`, `request/messages-override` counts, tool calls) + host log, then
  kills the host. Env: `REAL_HOME=1` (required for now, see S4), `STOCK=1` (stock core, no fork → compat only),
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
```
Because `REAL_HOME=1` uses `~/.dsh/plugins/optmem/optmem.db` (shared with `probe`), park it before each run:
```bash
mv ~/.dsh/plugins/optmem ~/.dsh/plugins/optmem.parked-$(date +%s) 2>/dev/null; true
```
(Restore the probe DB afterwards by moving the newest `optmem.parked-*` back if you care about it.)

- [ ] S0 done

## S1 — long-conversation comparison (stock vs compat vs full)
Smoke first (≈2 cheap turns) to confirm the route answers:
```bash
REAL_HOME=1 node plans/optmem/tools/drive.mjs /tmp/optmem-smoke.json full plans/optmem/tools/scenario-smoke.json
node plans/optmem/tools/summarize.mjs /tmp/optmem-smoke.json
```
Then the three long runs (park the DB between runs so each starts from empty memory):
```bash
mv ~/.dsh/plugins/optmem ~/.dsh/plugins/optmem.parked-$(date +%s) 2>/dev/null; STOCK=1 REAL_HOME=1 node plans/optmem/tools/drive.mjs /tmp/optmem-stock.json compat plans/optmem/tools/scenario-long.json
mv ~/.dsh/plugins/optmem ~/.dsh/plugins/optmem.parked-$(date +%s) 2>/dev/null; REAL_HOME=1 node plans/optmem/tools/drive.mjs /tmp/optmem-compat.json compat plans/optmem/tools/scenario-long.json
cp -R ~/.dsh/plugins/optmem /tmp/optmem-db-compat
mv ~/.dsh/plugins/optmem ~/.dsh/plugins/optmem.parked-$(date +%s) 2>/dev/null; REAL_HOME=1 node plans/optmem/tools/drive.mjs /tmp/optmem-full.json full plans/optmem/tools/scenario-long.json
cp -R ~/.dsh/plugins/optmem /tmp/optmem-db-full
node plans/optmem/tools/summarize.mjs /tmp/optmem-stock.json /tmp/optmem-compat.json /tmp/optmem-full.json > /tmp/optmem-s1.md
```
Note: "stock" = no fork + optmem compat; for a true no-OptMem baseline, run once more with `STOCK=1` after
temporarily setting `enabled: false` (add `enabled: false` under `dshfiles-optmem.config` in `drive.mjs`'s overlay).
If `usage` fields are empty in the table, check the real field names with
`jq '.turns[0].assistant[0].usage' /tmp/optmem-full.json` and adjust `summarize.mjs`.

What to record in benchmarks.md (paste `/tmp/optmem-s1.md` + a short reading):
- total input tokens, cache-read %, output tokens per mode; per-turn growth curve (stock/compat grow linearly with
  history, full should stay ~flat = system + view + current turn).
- recall answers for turns 21–24 and conversation B (correct / wrong / used tool).
- [ ] S1 done

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
- [ ] S2 done (paste the output into runtime-evidence.md "Stage 5")

## S3 — record actual request bytes (small code change) — paste to an agent
> In /Users/astahmer/dev/dshfiles (jj, shared working copy — touch only these paths), extend the fork event
> `request/messages-override` (tooling/dsh-core/session/src/types.ts + agent-loop/src/agent.ts where it is appended)
> with `originalBytes` and `sentBytes` = UTF-8 byte length of `JSON.stringify(messages)` before/after the
> `agent/request-messages` waterfall; keep the event `ignorable`. Update agent-loop/tests/request-messages.spec.ts,
> rebuild `tooling/dsh-core/session`, `agent-loop` and `plugins/@dshfiles/dsh-core-runtime`. In
> plans/optmem/tools/summarize.mjs add a "bytes orig→sent" column from `turn.overrides`. Also make
> `plugins/@dshfiles/optmem` `memory_status` show the last full-mode request's sent bytes. Run the fork spec, optmem
> tests/typecheck/build, dist import check (node 22.23.3), workspace contract; one path-scoped jj revision
> (`jj split -m "feat(dsh-core): record request bytes in the override event" <paths>`), co-author trailer
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Terse report.

Then re-run only the full long run from S1 to get byte numbers.
- [x] S3 done

## S4 — why the codex route returns empty replies from an isolated DSH_HOME — paste to an agent
> Read-only investigation first, in /Users/astahmer/dev/dshfiles. Context: plans/optmem/runtime-evidence.md (Stage 4,
> "Why DSH_HOME stayed the real one"). With `drive.mjs` without `REAL_HOME=1` (isolated DSH_HOME, accounts.json copied),
> every turn on `codex-emialex/gpt-6-luna` ends `completed` with an empty assistant message and no usage within
> ~30 ms, even on the stock core. Find the cause in plugins/@dshfiles/ai-accounts (codex shadow home resolution,
> `~/.codex-dshx`, keychain/env credentials, `DSH_HOME`-relative paths in account-store.ts / provider-profile.ts) and
> the pi-ai codex provider; reproduce with `ONE_TURN=1 node plans/optmem/tools/drive.mjs /tmp/iso.json full
> plans/optmem/tools/scenario-smoke.json` (no REAL_HOME) and read `/tmp/iso.json.host.log`. Propose the minimal fix
> (likely: resolve the codex auth home from the account config, not from DSH_HOME), implement it with a regression
> test in ai-accounts, verify the isolated run answers, then make REAL_HOME optional in the runbook. One path-scoped
> jj revision. Terse report.
- [ ] S4 done → afterwards drop `REAL_HOME=1` from all S1 commands (isolated runs no longer touch the probe DB).

## S5 — hardening checklist (agent prompt, after S1–S4)
> In /Users/astahmer/dev/dshfiles, for plugins/@dshfiles/optmem{,-core,-sqlite}: (1) run the 100k bench again
> (`pnpm --dir plugins/@dshfiles/optmem-sqlite exec node --experimental-strip-types bench/run.ts` or the script in its
> package.json) and update benchmarks.md; (2) add a test that a session log written in full mode (with the ignorable
> override event) loads on the STOCK session package (tooling/dsh-core vs installed rc.2 — use the installed
> @deepseek-ai/dsh-session from ~/.dsh/profiles/web/node_modules read-only); (3) fix the known gaps from
> plans/optmem/README.md "Known gaps": project id switch path:→workspace: (migrate stream on first workspace
> resolution), backfill ordering (append in original chronological order or mark backfilled events), runtime-context
> accumulation in compat mode (only re-emit when the compact view changed by more than N bytes, setting);
> (4) tests/typecheck/build/contract; path-scoped jj revisions; update README status. Terse report.
- [ ] S5 done

## Report template (append to README when finished)
| Metric | stock | compat | full |
|---|---|---|---|
| total input tokens (24+2 turns) | | | |
| cache-read % | | | |
| input tokens at turn 24 | | | |
| sent bytes at turn 24 (S3) | n/a | n/a | |
| recall correct (turns 21–24, B) | | | |
| summaries written / max node bytes | n/a | | |
