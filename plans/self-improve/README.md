# Self-improvement backlog

Durable state for `/self-improve`. The machine-readable records live in
[`ledger.jsonl`](ledger.jsonl); this file is the human view of it.

Read the operating manual first: [`docs/self-improvement.md`](../../docs/self-improvement.md)
and the skill at [`.agents/skills/self-improve/SKILL.md`](../../.agents/skills/self-improve/SKILL.md).

## Resume here

Run the miner, read the evidence for the top signals, and work the oldest open
entry before adding another one:

```sh
node scripts/self-improve.ts ledger list --status=proposed
node scripts/self-improve.ts mine --since=14d --top=25
```

## Open

| Entry | What | Why it is still open |
| --- | --- | --- |
| `si-2026-10-18-instructions-path-missing-user-preferenc` | Every Session is told to read `~/.agents/USER_PREFERENCES.md`, which exists in no checkout | The instruction and its missing asset both live in the nixfiles repository (`~/.dsh/AGENTS.md`, `~/.agents/AGENTS.md`, `~/.config/nixfiles/assets/.agents/`), not here. `node scripts/self-improve.ts validate` reports it on every run. Fix it there and reopen this entry with the evidence, or leave it as the standing proof that the validator works. |

## Done

| Entry | Outcome |
| --- | --- |
| `si-2026-10-18-correction-misunderstood-requirement` | `validated` — prompt origin is read from `data.source.kind` instead of guessed from text; false corrections dropped 631 → 25 Sessions |
| `si-2026-10-18-turn-end-completed` | `validated` — `turn-end` uses an allowlist of abnormal endings; 2 960 phantom hits gone |

## Not a backlog

Mining reports are scratch: they land in the git-ignored
`output/self-improve/` and are not committed. Only the ledger, this file, and the
code changes a run produces belong in version control.
