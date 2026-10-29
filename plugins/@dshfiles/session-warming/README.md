# @dshfiles/session-warming

Keeps an idle thread's provider prompt cache alive between prompts, so the next prompt after a pause reads its
prefix from cache instead of paying for it again. Off by default: every warm-up is a billed request. Host only;
switch it on in **Settings › dshfiles-session-warming**.

How it works: DSH's `llm/stream` waterfall hands every request the agent loop builds to this plugin, which keeps
the thread's latest one. When the turn ends, the same request (system prompt, tools, messages, model and reasoning
effort unchanged) is re-sent with one output token every `intervalMinutes`. A new turn cancels the timer and
resets the count; the answer of a warm-up is discarded and never reaches the thread.

## Cost guard

| Setting             | Default | Meaning                                                          |
| ------------------- | ------- | ---------------------------------------------------------------- |
| `enabled`           | `false` | Off schedules nothing.                                           |
| `intervalMinutes`   | `4`     | Between warm-ups; keep it under the provider's cache lifetime.   |
| `maxWarmupsPerIdle` | `3`     | Per thread between two prompts; then the cache is let go.        |
| `maxWarmupsPerHour` | `30`    | Across every thread in a rolling hour.                           |
| `providers`         | empty   | Provider routes to warm (`anthropic`, …); empty warms every one. |

A thread whose warm-up fails (for example a provider that refuses one output token under a thinking budget) is not
retried until its next turn. Each warm-up costs one cached read of the prefix plus a few uncached tokens; with the
defaults a thread costs at most three of them per pause. `session_warming_status` (read-only agent tool) lists per
thread the warm-ups since its last prompt, the next one, the last cache reads and why warming stopped.

Limits: timers live in Host memory, so a Host restart forgets them until each thread's next turn. Warm-up usage is
not written to the session log, so `@dshfiles/usage` does not count it; the status tool and the
`session-warming warm` span are the record.

## Verify

```sh
pnpm --dir plugins/@dshfiles/session-warming test   # timers, budgets, and the re-sent request
```
