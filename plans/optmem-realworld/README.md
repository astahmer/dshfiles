# OptMem realistic long-conversation evaluation

Resume here: scenario and summarizer agents are working in isolated jj workspaces; parent owns benchmark runner/report hardening and real provider runs. No paid matrix started yet.

## Objective

Reduce OptMem summary waste without sacrificing durable recall, then compare native-only, compatibility, and full modes on repeated realistic long conversations using OpenCode Go Alex / DeepSeek V4.1 Flash. Do not edit inspiration projects or restart the live Host.

## Progress

| Milestone | Status | Evidence |
|---|---|---|
| Inspect previous benchmark and current defaults | Complete | Prior benchmark forced 32k compaction on a 1M model; source mode already defaults to compat. |
| Reproduce summary truncation | In progress | Current summarizer accepts nonempty max-tokens finishes; isolated agent owns regression and fix. |
| Realistic seeded long datasets | In progress | Isolated agent owns fictional infra, ingestion, and product/support scenarios inspired by read-only project structure. |
| Harden runner and measurements | In progress | Parent owns runner/report; failures, resume semantics, complete summary drain, and reproducibility need checks. |
| Pilot and repeated real-window matrix | Pending | Use isolated scratch homes and selected account only. |
| Validation and measured recommendation | Pending | Preserve failures and uncertainty; no live promotion without evidence. |

## Evaluation requirements

- Native provider context and stock compaction policy; small-window pressure tests, if any, reported separately.
- At least three repeated runs per mode/scenario after pilots, with seed variation paired across modes.
- Preserve exact scenario/config/source hashes, model metadata, usage coverage, cache tokens, output/reasoning tokens, finishes, and summary health.
- Probe delayed facts, corrections, negative recall, cross-session decisions, and task outcomes. No ground truth in agent-visible files.
- Distinguish subscription token consumption from estimated list-price cost.
- Account for background summary work through a bounded drain rather than a fixed three-second delay; report remaining backlog.
- Failed runs must not be silently treated as completed or averaged into successful-run performance.

## Boundaries

Build on the owned plugin and existing benchmark harness: memory behavior already exists, so adopting or porting another plugin would not solve its cost and evaluation gaps. Live runtime and source inspiration projects remain unchanged. Compatibility is already the source default; full remains opt-in pending evidence.
