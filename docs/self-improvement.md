# Self-improvement from Session history

`/self-improve` turns DSH's own Session logs into evidence-backed changes to
this repository's harness: its skills, its always-on instructions, its plugins,
its tooling. The skill body is
[`.agents/skills/self-improve/SKILL.md`](../.agents/skills/self-improve/SKILL.md);
the deterministic half is `scripts/self-improve*.ts`.

The design follows one rule: **the miner produces candidates, never verdicts.**
Every signal carries the Session ids, sequence numbers and a redacted excerpt it
came from, and the skill's second step is to open that evidence before proposing
anything. The first real run of this tool is the argument for that rule — see
[the correction-signal defect](#the-correction-signal-defect) below.

## Commands

```sh
node scripts/self-improve.ts mine --since=14d --scope=all   # rank candidate signals
node scripts/self-improve.ts validate                       # deterministic harness findings
node scripts/self-improve.ts ledger list                    # the improvement backlog
```

### `mine`

Walks `$DSH_HOME/sessions/<project>/<session>/session[.vN].jsonl.zstd`, decoding
only the complete Zstandard frames the JSONL backend appended and discarding
each frame's text after folding it into per-Session facts. It never holds a whole
conversation: extraction yields grouped, counted, capped facts, so a Session with
2 300 tool calls contributes a bounded record. Results are cached in
`output/self-improve/cache.json` keyed by path, size, mtime and extractor
version, so a rerun re-reads only changed Sessions.

| Flag | Meaning |
| --- | --- |
| `--scope=all\|tools\|memory\|skills\|ux\|infra\|agent` | keep one signal category |
| `--since=14d\|30d\|7d\|all\|<ISO date>` | window over log mtime |
| `--sessions=<n>`, `--projects=<a,b>` | bound the corpus |
| `--dsh-home=<path>` | analyze another DSH home, or a fixture |
| `--cache=<path>`, `--no-cache` | control the extraction cache |
| `--out=<dir>`, `--top=<n>`, `--json`, `--quiet` | what gets written and printed |

It writes `report-<stamp>.md` and `.json` into `output/self-improve/` (git-ignored)
and nothing else. Codes and definitions live in
[the reference](../.agents/skills/self-improve/REFERENCE.md#signal-catalogue).

### `validate`

Deterministic checks over the parts of the harness this repository owns: skill
frontmatter and invocation policy, dead relative links inside a skill, duplicate
skill names across roots, the always-on instruction budget, and **file paths the
always-on instructions tell an agent to read that do not exist**. No model is
involved, so a finding is a fact about the tree.

### `ledger`

`plans/self-improve/ledger.jsonl` is the durable backlog. `add` is idempotent for
an open entry and refuses a closed one without `--reopen "<new evidence>"`, which
is what stops a later run from re-attempting a known failure. Schema and statuses:
[reference](../.agents/skills/self-improve/REFERENCE.md#ledger-record).

## Verification

```sh
node --test scripts/self-improve.test.mjs          # 17 tests, no network, no live DSH
node --run typecheck:scripts
node --run test:scripts
node scripts/self-improve.ts validate
```

The tests cover the whole pipeline on synthetic Session logs written to a temp
`DSH_HOME`: discovery, zstd frame walking, per-Session extraction, cross-Session
aggregation and ranking, provenance, the cache, scope and window filters,
redaction and excerpt caps, ledger dedup and reopen rules, frontmatter parsing,
and the instruction-path rule.

## The first run, in numbers

`node scripts/self-improve.ts mine --since=14d` over the whole corpus on
2026-10-19:

- 881 Session logs discovered, 810 analyzed (179 project directories), 71
  outside the window, 0 unreadable;
- 175 738 tool calls, 5 055 failed tool calls, 3 394 turns;
- 1 509 candidate signals, of which 879 are `recurring` and 630 `isolated` (one
  Session, few hits). The split is the point: an isolated signal is listed so it
  can be explained, not so it can be fixed.

Ranking is by score, so the triage order is the top of the report; the long tail
exists because recall was preferred over precision at extraction time. A second
pass removed the two kinds that dominated that tail: 2 759 `rework` signals for a
file re-edited inside a single Session (ordinary iteration, now only reported
when the same file is reworked across Sessions) and the duplicate
`repeated-call:skill:*` signals.

## The correction-signal defect

The first full-corpus run (2026-10-19, 806 Sessions over 14 days) ranked "user
pushback" as its top behavioural finding. Reading the evidence killed it: every
sampled hit was text DSH had injected as a `user`-role record — runtime context,
the skill catalogue, compaction checkpoints, background-job notices, peer-agent
messages — or the Session's own opening brief.

Four defects were behind it, all fixed:

1. **Origin was guessed from text.** The log marks it structurally in
   `data.source.kind` (only `user` is human). Classification now reads that field
   and falls back to text matching only for logs written before it existed.
2. **The opening brief scored as pushback.** A Session whose brief arrived first
   as a queue splice made the real prompt the *second* user message. The
   discriminator is now whether the agent has produced output yet, not the
   message index.
3. **Normal turn endings counted as friction.** `turn-end` used a denylist, so
   `completed` — the ordinary case — was reported 2 960 times. It is now an
   allowlist of abnormal endings.
4. **Ordinary iteration read as a pattern.** A file edited three times in one
   Session produced a `rework` signal; 3 477 of them buried the report. `rework`
   now needs the same file reworked across Sessions.

| Signal | Before | After |
| --- | --- | --- |
| `correction:misunderstood-requirement` | 631 Sessions / 1 943 hits | 24 Sessions / 29 hits |
| `correction:process-complaint` | 56 / 103 | 2 / 2 |
| `correction:incomplete-or-unfixed` | 631 / 3 979 | 130 / 188 |
| `correction:unwanted-change` | 70 / 128 | 23 / 23 |
| `turn-end:completed` | 601 / 2 960 | not reported |
| duplicate `repeated-call:skill:*` | 80 / 539 | not reported (one signal per fact) |
| `rework` (one Session only) | 3 477 / 3 477 | not reported; cross-Session rework remains (718) |
| `slow-tool:bash` | 219 / 49 328 | 171 / 1 815 |
| `redundant-skill-load:dsh-plugin-verify` (control) | 80 / 539 | 80 / 539 |
| `turn-end:interrupted` (control) | 100 / 142 | 97 / 136 |
| `coverage.totalCorrections` | 4 095 | 224 |
| total signals | 4 299 | 1 509 |

Conditions: the same corpus and window, extractor version 1 → 4, and 806 Sessions
analyzed before against 810 after — the 14-day window moved while the runs were
going, which is what the two control rows show. Both controls cannot be affected
by these changes (`interrupted` was already kept by the old denylist and is kept
by the new allowlist; `redundant-skill-load` is a different signal from the
deduplicated `repeated-call`). That drift is also why "after" is not exactly
reproducible by re-running today. The surviving `misunderstood-requirement`
evidence was read by hand and is real pushback ("no i mean…", "i meant…",
"thats not ok cause…"); before the fix, every sampled hit was injected text.

The same run also produced a live harness finding, which `validate` now reports
mechanically: every Session is told to read `~/.agents/USER_PREFERENCES.md`, a
file that exists in no checkout. That instruction lives in the nixfiles-managed
`~/.dsh/AGENTS.md`, so the fix is a nixfiles change; it is recorded in the ledger
rather than silently patched here.

## What this deliberately does not do

No new index, database or event store: mining reads the logs DSH already writes,
and the ledger is one append-only file. No LLM judge and no benchmark harness.
Re-running real work to A/B a configuration has no counterfactual, so a change is
verified by a deterministic test or a scenario replay, and the honest verdict is
usually `confounded`. The full reasoning, including what was taken from Harness²
and what was refused, is in
[the reference](../.agents/skills/self-improve/REFERENCE.md#what-came-from-harness).
