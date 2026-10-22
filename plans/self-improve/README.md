# Self-improvement backlog

Durable state for `/self-improve`. The machine-readable records live in
[`ledger.jsonl`](ledger.jsonl); this file is the human view of it.

Read the operating manual first: [`docs/self-improvement.md`](../../docs/self-improvement.md)
and the skill at [`.agents/skills/self-improve/SKILL.md`](../../.agents/skills/self-improve/SKILL.md).

## Resume here

The 2026-10-22 run analysed the 2026-10-15…22 window (935 Sessions, 159,930 tool
calls, 4,530 tool errors) and turned the validated findings into an ordered task
plan: [`plans/self-improve-2026-10/README.md`](../self-improve-2026-10/README.md).
Work that plan; add a ledger entry only when a new finding is not already one of
its tasks.

```sh
node scripts/self-improve.ts ledger list --status=proposed
node scripts/self-improve.ts mine --since=7d --top=25
```

## Open

None.

## Done

| Entry                                                    | Change            | Outcome                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `si-2026-10-18-correction-misunderstood-requirement`     | `jj:vxsrqkounvxs` | `validated` — prompt origin is read from `data.source.kind` and the opening brief is recognised by whether the agent has produced output; false corrections dropped 631 → 24 Sessions and 1 943 → 29 hits                                                    |
| `si-2026-10-18-turn-end-completed`                       | `jj:vxsrqkounvxs` | `validated` — `turn-end` uses an allowlist of abnormal endings; 2 960 phantom hits gone                                                                                                                                                                      |
| `si-2026-10-18-instructions-path-missing-user-preferenc` | nixfiles          | `validated` (2026-10-22) — no `USER_PREFERENCES` reference remains in `~/.dsh/AGENTS.md` or `~/.agents/AGENTS.md`, and `validate` reports no `instructions.path-missing` finding; the referenced file was never created, the instruction was removed instead |

Two more defects in the miner were found and fixed in the same revision without
their own entry, because a fixed gate cannot recur: the opening brief scored as
pushback, and a file re-edited inside one Session read as a pattern (3 477
`rework` signals, 2 284 of them one-Session). Measurements, conditions and the
two control signals are in
[`docs/self-improvement.md`](../../docs/self-improvement.md#the-correction-signal-defect).

## Not a backlog

Mining reports are scratch: they land in the git-ignored
`output/self-improve/` and are not committed. Only the ledger, this file, and the
code changes a run produces belong in version control.
