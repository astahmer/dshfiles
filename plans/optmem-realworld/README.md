# OptMem realistic long-conversation evaluation

Resume here: integrate single-flight cost revision `8eebcc68c95b50673a09d7a338ae2f4119dbf541` atop the duplicated reliability fix, then rebuild/import-check before compat/full pilots. Native infra pilot job `bash-62` is running (port 3241, output `/private/tmp/optmem-realworld-pilot-native`). Fourth real coding lane is being authored by scenario child `536e9d5a-4cd8-4d7b-b1a3-1af7ccf73f81`. Summary child `5e8e4792-b466-46d2-b957-188333cbdfb2` is idle with full findings delivered. No long matrix started yet.

## Objective

Reduce OptMem summary waste without sacrificing durable recall, then compare native-only, compatibility, and full modes on repeated realistic long conversations using OpenCode Go Alex / DeepSeek V4.1 Flash. Do not edit inspiration projects or restart the live Host.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Inspect previous benchmark and current defaults | Complete | Prior benchmark forced 32k compaction on a 1M model; source mode already defaults to compat. |
| Reproduce summary truncation | Complete | Reliability fix duplicated locally as `7bd0f759`; partial max-tokens output rejected, capped duplicate retries removed; 26 focused tests passed in child. |
| Remove duplicate identical merge calls | Ready to integrate | Child `8eebcc68` single-flight exact-prompt sharing, no persistent cache; real engine+SQLite proof 2 provider calls → 1; 40 tests pass. |
| Realistic seeded long datasets | Mostly complete | Three 68-turn / ~200k–220k estimated-input-token scenarios integrated as `2a66bcb8`; fourth actual coding/tool-heavy lane in progress. |
| Harden runner and measurements | Mostly complete | Stock-policy loader, paired hashes, lifecycle cleanup, failed/incomplete-run exclusion, retry archives, call-start journal, strict recall tool evidence; 22 offline tests pass. |
| Pilot and repeated real-window matrix | In progress | Pre-fix summary-effort pilots completed but all unsuitable for complete-cost comparison; native realistic infra pilot running. |
| Validation and measured recommendation | Pending | Preserve failures and uncertainty; no live promotion without evidence. |

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

## Boundaries

Build on the owned plugin and existing benchmark harness: memory behavior already exists, so adopting or porting another plugin would not solve its cost and evaluation gaps. Live runtime and source inspiration projects remain unchanged. Compatibility is already the source default; full remains opt-in pending evidence.
