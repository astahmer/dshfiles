# OptMem realistic long-conversation evaluation

Resume here: original child `session-3af7eb81-ce16-4b75-9f0b-21d9634973ad` remains idle after its Plus usage-limit interruption; last five-minute check found no change. Repaired B/C pilots still fail acceptance and drain; see Pilot diagnosis. Production-prompt calibration r1 exposed 2048→4096 max-token exhaustion on a long summary; 4096→8192 completes at about 3× list cost but still loses full owner names. A corrected 2,048→8,192 retry-only pilot also exhausted; retain failures and no production recommendation. Fourth coding lane restored from WIP `29b58dc6` into this thread's integration revision; 65 turns, 54 required-tool packets, typed packet loader, scratch-only fixture, and evidence/report wiring pass focused offline tests. No provider run, long matrix, live-profile change, or raw-log publication.

## Objective

Reduce OptMem summary waste without sacrificing durable recall, then compare native-only, compatibility, and full modes on repeated realistic long conversations using OpenCode Go Alex / DeepSeek V4.1 Flash. Do not edit inspiration projects or restart the live Host.

## Progress

| Milestone                                       | Status          | Evidence                                                                                                                                                                        |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect previous benchmark and current defaults | Complete        | Prior benchmark forced 32k compaction on a 1M model; source mode already defaults to compat.                                                                                    |
| Reproduce summary truncation                    | Complete        | Reliability fix duplicated locally as `7bd0f759`; partial max-tokens output rejected, capped duplicate retries removed; 26 focused tests passed in child.                       |
| Remove duplicate identical merge calls          | Complete        | Integrated as `0458d55b`: exact-prompt single-flight, no persistent cache; real engine+SQLite proof 2 provider calls → 1; parent 40-test/typecheck/build/import checks pass.    |
| Realistic seeded long datasets                  | Integrated      | Three original scenarios plus coding lane restored from `29b58dc6`; new lane is 65 turns / 54 tool-required packets with scratch-only fixture and hidden acceptance. Offline evidence: 5 scenario tests pass; 24/25 prototype acceptance failures; reference 25/25; report-scope regression fails. No provider run. |
| Harden runner and measurements                  | Mostly complete | Stock-policy loader, paired hashes, lifecycle cleanup, retry archives, call-start journal, strict recall provenance, explicit retry caps, typed packet metadata, and tool-call reporting; 37 benchmark tests pass. |
| Direct summary calibration                      | Pilot incomplete | Production-aligned r1 plus retry-only follow-up: 2,048→4,096 and 2,048→8,192 exhaust the long leaf; 4,096→8,192 completes once but costs ~3× and drops full owner names. No variant passes all four quality/completion checks. |
| Pilot and repeated real-window matrix           | Pilot incomplete | Repaired B/C 24-turn infra pilots fail the same combined handoff gate and 600s drain; capped summaries dominate cost. Do not start the long matrix until failure causes are resolved. |
| Validation and measured recommendation          | Pending         | 37 benchmark tests and changed-path checks pass; plugin contract/typecheck/build/import pass. An initial full plugin suite had one project-view failure; isolated and full rerun passed 79/79, cause unconfirmed. No live runtime or long matrix; no recommendation. |

## Evaluation requirements

- Native provider context and stock compaction policy; small-window pressure tests, if any, reported separately.
- At least three repeated runs per mode/scenario after pilots, with seed variation paired across modes.
- Preserve exact scenario/config/source hashes, model metadata, usage coverage, cache tokens, output/reasoning tokens, finishes, and summary health.
- Probe delayed facts, corrections, negative recall, cross-session decisions, and task outcomes. No ground truth in agent-visible files.
- Distinguish subscription token consumption from estimated list-price cost.
- Account for background summary work through a bounded drain rather than a fixed three-second delay; report remaining backlog.
- Failed runs must not be silently treated as completed or averaged into successful-run performance.

## Diagnostic pilots (not benchmark conclusions)

Two compatibility support pilots per effort, on the pre-fix plugin build:

- Default repeats completed 19/19 user turns but left 34 and 42 pending leaves after the 120-second drain deadline. Measured summary calls 28/24, capped 16/13; partial summary output 56,263/48,653 tokens. Output directory `/private/tmp/optmem-realworld-effort-default`.
- Low-effort repeat 1 completed 19/19 turns but left 34 leaves; 23 summary calls, 9 capped, 37,529 output tokens. Repeat 2 failed at turn 15 (provider finish error, reported zero usage); cause unavailable because the old probe did not persist terminal failure fields. Output directory `/private/tmp/optmem-realworld-effort-low`.
- These are **incomplete cost lower bounds**, not evidence that low effort is cheaper at equivalent recall/finished memory. New probe captures failure code/status and unfinished calls; drain also checks absent/stale views and buildable internal nodes.
- Identical concurrent merges across conversation/project scopes were reproduced independently through the real memory engine and SQLite. This justifies single-flight sharing without speculative fact filtering or a new compression policy.
- All scratch homes cleaned; diagnostic output includes synthetic answers and memory databases, so publish only compact summaries, not raw directories.

## Repaired infra pilot diagnosis

- Correct report classification: B and C each have **0 provider errors and 2 unfinished summary calls** at the 600-second drain deadline. Both finished 24/24 user turns and failed `long scenario handoff preserves corrected facts, scope, gates, dependency order, and rollback`; saved JSON retains only that aggregate test name, not the failing subassertion.
- Of completed OptMem summaries, B had 45/77 `max-tokens` finishes and C 76/107. Those capped calls consumed 129,024/155,892 (82.8%) and 225,280/249,276 (90.4%) output tokens respectively. Provider usage reported zero reasoning tokens even though the stream recorded 448,656 and 758,494 reasoning-text bytes. Databases contain 13/7 `clipped:*` nodes, 221/135 pending leaves, 8/6 stale or merge-pending views, and 10/14 buildable parents. The pending-view query uses the `(stream,kind)` primary key; no evidence points to an expensive SQL plan. Costs remain lower bounds.
- No long real-window matrix is justified yet. Archived evidence identifies the composite test but not whether state/scope, action order, preflight gates, unsafe rejections, or rollback mismatched. A future diagnostic must preserve the candidate artifact or bounded assertion names before summarizing failure, without storing raw transcripts.

## Production-aligned direct calibration

The earlier `bash-114` three-case, three-repetition run used shorter cases and a non-production prompt, so retain it as exploratory evidence only. The updated scratch run `/private/tmp/optmem-calibration-relay-20261013-prod-prompt-r1` mirrors the production prompt/framing, uses the production 512-byte node ceiling, and adds a 1,784-byte long record (below the B/C p90 event sizes). One repetition produced:

| variant | complete / 4 | quality / 4 | provider calls | max-token finishes | output tokens | streamed reasoning bytes | list-price cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline-default (2,048→4,096) | 3/4 | 3/4 | 5/5 usage | 2 | 7,731 | 23,046 | $0.0049 |
| low-effort (2,048→4,096) | 3/4 | 3/4 | 5/5 usage | 2 | 7,349 | 23,259 | $0.0046 |
| low-effort-larger-cap (4,096→8,192) | 4/4 | 3/4 | 7/7 usage | 2 | 23,617 | 70,944 | $0.0143 |

Both smaller-cap variants exhausted both token budgets on the long leaf and returned no usable summary. The larger-cap variant completed it after two bounded-summary attempts, but still omitted the full surnames of all three named owners/reviewers; this is a real recall failure, not a scorer alias. All short cases passed, and no result was byte-clipped or a provider error. This is one repetition, so it does not establish a policy; it does show that raising the initial cap is expensive without rescuing identity quality. The retry-only follow-up `/private/tmp/optmem-calibration-relay-20261013-retry-8192-r2` actually used 2,048 then 8,192 tokens, exhausted both on the long leaf, and finished only 3/4 cases; it consumed 11,449 output tokens and cost ~$0.0069. Its first attempt had only used 4,096 because the runner capped retries at twice the initial budget; that attempt was excluded, the runner now honors an explicit retry budget with a regression test, and the corrected run still failed. No tested variant passed all four completion/quality checks. Provider-reported reasoning-token counts remained zero; do not change production config or start the long matrix from this evidence.

## Validation checkpoint

- Parent plugin package: 79/79 tests pass, workspace contract passes, build/import/typecheck pass. No previously reported timing-sensitive failure reproduced in this run.
- Benchmark corpus, loader, report, and calibration: 30 Node tests pass, including strict recall-tool and negative-marker regressions plus explicit retry-cap selection.
- Changed-path Oxlint and Oxfmt: `pnpm run check:diff` passes with zero warnings/errors; all changed files formatted.
- Broad benchmark-directory formatting check fails on four untouched baseline files (legacy coding fixture package/money source/money test and the previous benchmark summary). Changed-file formatting passes after formatting this tracker; do not reformat the intentional legacy fixture just to mask baseline noise.
- Sources are local and not landed; web seed/profile/live Host unchanged. Scratch pilots exercise the new Host bundle only. No source project edits or live restart.

## Boundaries

Build on the owned plugin and existing benchmark harness: memory behavior already exists, so adopting or porting another plugin would not solve its cost and evaluation gaps. Live runtime and source inspiration projects remain unchanged. Compatibility is already the source default; full remains opt-in pending evidence.
