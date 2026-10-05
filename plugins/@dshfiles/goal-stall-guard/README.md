# Goal Stall Guard

A goal round that produces no assistant content used to complete silently. The
round driver saw an active goal with rounds still in budget, spliced the next
round, and did it again.

This bundle pauses the goal instead, so a human decides what happens next.

## The failure it exists for

`session-dbe87c63` recorded one. Across 164 rounds:

- rounds 1–53 did real work
- rounds 54–164 produced `assistant/message` with `content: []`
- the streak ran 111 rounds and 60.9 hours
- `llm/retry` was never logged, so no retry policy ever saw a failure

Nothing in `dsh-goal-round-driver` looks at what a round produced. It guards
round count, round identity, revision, and phase — never progress. `maxGoalRounds`
is the only ceiling, and 256 rounds of nothing is a fuse, not a guard.

## Why pause and not block

The round produced no output, but the goal may be perfectly good and the
provider may have been the problem. Pausing preserves the goal and its remaining
budget and disarms automatic continuation; blocking is terminal and is what the
driver already uses for a genuinely exhausted budget.

## What counts as no progress

A round counts as empty when its assistant content carries no text, no tool
call, and no reasoning. Only turns whose prompt was a positive `<goal_round>`
continuation are counted — a human prompt, a webhook, or an agent message is
ordinary work and never counts toward the run. Round zero is excluded too: it is
the message that opened the goal, not a continuation of one.

A tool-only round counts as progress. The round did work even without prose.

## Configuration

```yaml
# cordis.patch.yml
config:
  stallThreshold: 3
```

Minimum 2, maximum 50, default 3. One empty round is ordinary provider noise.

## Verification

27 tests. `src/stall.test.ts` covers the detector, including a replay of the
recorded 164-round sequence that stops at round 56. `src/host.test.ts` drives
the built bundle's `apply` against the real session-event shapes, with controls
for a speaking round, a tool-only round, a non-goal empty turn, an agent with no
goal, a goal that is not active, and a `pause` that throws.

Boot-verified on a second instance (`dsh --profile probe --port 3199`), never on
`3080`. `dsh --profile probe --dump-config` shows the row with its config, and
the boot log reports no entry that failed to activate.

## Note on the row

`cordis.patch.yml` supplies `config` explicitly. Cordis resolves a row's config
before the plugin is constructed, so a row with no `config` key fails validation
and the entry never activates — a plugin that silently does nothing is worse
than one that refuses to boot. The schema also accepts `undefined`, so a
hand-edited row degrades to the defaults rather than half-activating.
