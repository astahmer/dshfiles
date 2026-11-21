# Goal Auto-Retry

A goal that hits a provider usage limit stops until a human resumes it. The
round driver disarms continuation on `agent/error`, and the refusal that caused
it (`You have hit your ChatGPT usage limit (plus plan). Try again in ~246 min.`)
is not something DSH retries: `dsh-llm-retry` never sees it, because the turn
that carried it already ended. So the goal sits paused for four hours while its
week is resetting.

This bundle arms one thread from the composer and resumes its goal at the reset
the provider announced, three minutes later. The timer runs on the Host, so
closing the tab does not cancel it.

## The failure it exists for

`session-a4a72830` ran a 256-round goal. Seven of its fourteen turns ended with
`turn/end { kind: 'error', failure: { code: 'PI_AI_ERROR', message: 'You have hit
your ChatGPT usage limit (plus plan). Try again in ~246 min.' } }`. Each time the
goal went inactive and stayed that way until the user clicked **Resume goal**
after the weekly reset.

## What gets retried

Only the account being made to wait:

| Code                                                                                   | Retried |
| -------------------------------------------------------------------------------------- | ------- |
| `QUOTA`, `RATE_LIMIT`, `ACCOUNT_QUOTA`                                                 | yes     |
| `ACCOUNT_SIGN_IN_REQUIRED`, `ACCOUNT_TOKEN_INVALID`                                    | yes     |
| `PI_AI_ERROR` wording its own wait (`usage limit`, `rate limit`, `quota`, `try again`) | yes     |
| `PI_AI_ERROR` with any other wording                                                   | no      |
| `CONTEXT_WINDOW_EXCEEDED`, `INVALID_REQUEST`, `AUTH`, `TRANSPORT`, `SERVER`, `TIMEOUT` | no      |

A transport blip, a server error and a context overflow are either already
retried by DSH's own request retry or cannot succeed on the next round; a goal
round repeating them spends tokens to learn nothing.

Only a **goal round** is retried. The failing turn's opening prompt has to be a
[`goal`-sourced message](../../../node_modules/@deepseek-ai/dsh-llm/src/types.ts)
with a positive round number, so a human turn that fails on a usage limit leaves
its goal alone. Subagent threads are skipped for the same reason: their goal
belongs to the parent.

## When it retries

The provider's own words decide, then a margin:

1. The adapter's parsed `Retry-After`, when it survived into the live error.
2. Else an instant the message states (`resets at 2026-11-19T20:00:00Z`).
3. Else a duration the message states: `Try again in ~246 min`, `2 hours 30
minutes`, `1h30m`, `45s`. Only the first duration of each unit counts, so
   `slot 3 of 5, retry in 10 minutes` reads as ten minutes.
4. Else exponential backoff: 5, 10, 20, 40, 60, 60… minutes.

The margin (three minutes by default) is added on top, and a one-minute floor
prevents a refusal that claims "2 seconds" from firing immediately. A thread can
override all of it with its own delay in minutes.

Each attempt is a `resume` on the exact goal revision the refusal paused.
`maxAttempts` (12 by default) refusals in a row stop the loop and leave the goal
paused with a reason, so a permanently broken account does not resume forever.

## Safety

- Resume happens on the Host, against the exact goal id and revision. A goal
  that was cleared, replaced, completed or out of rounds is reported as _not
  resumed_ with the reason, and the goal keeps its phase.
- A resume by hand drops the pending automatic retry instead of racing it.
- Retry is off until a thread's chip is turned on. A resumed goal spends tokens
  on its later rounds, so arming is per thread and never machine-wide.

## Install

```sh
dshx add @dshfiles/goal-auto-retry
```

Then open the alarm chip beside Send in a thread that has a goal.

## Settings

Settings › Goal Auto Retry, or the `goal-auto-retry` row in `cordis.patch.yml`:

| Key                  | Default | Meaning                                     |
| -------------------- | ------- | ------------------------------------------- |
| `marginMinutes`      | 3       | Extra wait after the announced reset.       |
| `baseBackoffMinutes` | 5       | First wait when the refusal stated no time. |
| `maxBackoffMinutes`  | 60      | Ceiling for the doubling wait.              |
| `maxAttempts`        | 12      | Give up after this many refused attempts.   |

The chip's own toggle and delay are per thread, kept by the Host beside that
thread's pending retry.

## Agent tools

Each method is also a tool: `goal_auto_retry_status` (read-only),
`goal_auto_retry_arm`, `goal_auto_retry_schedule`, `goal_auto_retry_cancel`.

## Verification

- `pnpm test` — `policy.test.ts` pins the wording, the reset instant, the
  backoff, the floor and the margin; `host.test.ts` pins the timer firing only
  at its instant, only for the armed goal, the give-up count, and the refusal
  reader (including that a human turn is not a goal round).
- `pnpm typecheck`, `oxlint` (0 findings), `oxfmt --check`, `dshx build`.
- Not verified live: no real usage limit was hit while building this. The
  end-to-end path (composer chip → Host timer → `goals.resume`) is covered by
  the unit tests at the timer boundary and by the API being a thin call into
  that same manager.
