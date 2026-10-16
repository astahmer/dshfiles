# Goal Stall Guard

A goal round that produces no assistant content used to complete silently. The
round driver saw an active goal with rounds still in budget, spliced the next
round, and did it again.

This bundle pauses a no-progress goal instead of letting it burn its budget. It
also adds narrowly scoped tools for justified round extension and evidence-based
completion after a round-limit block. Native DSH goal tools remain enabled and
unchanged.

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

## Bounded continuation and completion

The plugin registers two additional Host tools through the public `goals` and
`tools` services; it does not replace or fork `@deepseek-ai/dsh-tool-goal`.

- `extend_goal_budget` works only for the exact active goal round at its current
  final limit. It requires concrete progress, remaining work, and a reason that
  continuation is still within the original human authorization. It adds 1–32
  rounds per call and never raises the total above DSH's standard 256-round
  default. It cannot change the objective. The model must not use it merely to
  poll unchanged work that is waiting on a human.
- `complete_blocked_goal` works only for a goal blocked with `round-limit`, and
  requires evidence that all objective requirements are now satisfied. It does
  not close other blocked states or excuse an unresolved human decision.

The native `update_goal` guard remains authoritative for its own actions. These
tools cover only the two narrow cases above.

## Configuration

```yaml
# cordis.patch.yml
config:
  stallThreshold: 3
```

Minimum 2, maximum 50, default 3. One empty round is ordinary provider noise.

## Two ways it used to miss every stall

- The pause ran inside the `session/event` listener for `turn/end`, and a goal
  change cannot be appended while the session is still publishing that event
  ("session append cannot reenter"). The pause now runs once the publish has
  returned.
- DSH appends a runtime-context snapshot as a second `user/message` after the
  round prompt; reading it as a new prompt dropped the round. It is skipped.

On AI Accounts routes an empty completion is retried as `EMPTY_RESPONSE` and
then fails the turn, which leaves the goal inactive rather than looping; each
resume runs one more empty round, and the third pauses the goal.

## Verification

`src/stall.test.ts` covers the detector, including a replay of the recorded
164-round sequence that stops at round 56. `src/host.test.ts` drives
the built bundle's `apply` against the real session-event shapes (a session
that refuses a reentrant append, a runtime-context snapshot after the round
prompt), with controls for a speaking round, a tool-only round, a non-goal empty
turn, an agent with no goal, a goal that is not active, a `pause` that throws,
and registration of both supplemental tools. `tooling/dshx/e2e/features/goal-stall-guard.feature` drives it in the
browser against a loopback Command Code fake.

Boot-verified on a second instance (`dsh --profile probe --port 3199`), never on
`3080`. `dsh --profile probe --dump-config` shows the row with its config, and
the boot log reports no entry that failed to activate.

## Note on the row

`cordis.patch.yml` supplies `config` explicitly. Cordis resolves a row's config
before the plugin is constructed, so a row with no `config` key fails validation
and the entry never activates — a plugin that silently does nothing is worse
than one that refuses to boot. The schema also accepts `undefined`, so a
hand-edited row degrades to the defaults rather than half-activating.
