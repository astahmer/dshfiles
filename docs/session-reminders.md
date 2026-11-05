# Session reminders

A reminder is a prompt that comes back to the thread that created it, as a new
user turn, at a chosen time. DSH's official Schedule service delivers it; this
repository adds no plugin for it.

## Where it comes from

DSH 0.2.1 composes the `schedule` service (`@deepseek-ai/dsh-schedule`) in the
base web app and the `tool-schedule` row in the standard preset, next to
`time-context`. The `preset-standard` row in
[`profiles/web/cordis.patch.yml`](../profiles/web/cordis.patch.yml) restates
both, so a profile seeded from it has them. The Schedule UI is the official
**Automation tasks** entry in the sidebar.

The Agent tools are `schedule_create`, `schedule_list`, `schedule_update` and
`schedule_delete`. `schedule_create` takes a title, a prompt and exactly one
timing: `after_seconds`, `at` (RFC 3339 or a local date, time and IANA zone),
`every_seconds` (at least 60), `daily`, `weekly` or a five-field `cron`, each
with an explicit IANA zone.

## Decisions

- **Reuse the official service, build nothing.** It already owns persistence,
  time zones, catch-up and delivery into the original Session; a custom
  scheduler would duplicate all four.
- **Reminders, not automations.** A reminder is a follow-up message in one
  thread. Independent agents, scripts, new threads or worktrees, desktop
  notifications and a run-history dashboard are out of scope; each needs its
  own durable job and safe-executor contract.

## Limits

- The Host must be running at the due time. After downtime a recurring
  reminder delivers only its latest missed occurrence; a failed delivery is not
  retried on a timer, and the tool states that delivery can repeat after a
  crash.
- Local times that do not exist in the zone are skipped; repeated local times
  fire once, at the earlier instant.
- A reminder inherits its thread's account and model; archiving the thread
  drops its reminders.

## Verify

```sh
cd tooling/dshx
DSHX_E2E_PREWARM=0 pnpm exec playwright test --config=playwright.e2e.config.ts --grep "one-shot reminder is delivered"
```

[`session-reminders.feature`](../tooling/dshx/e2e/features/session-reminders.feature)
boots a scratch Host with the fake Command Code provider, has the model call
`schedule_create` with `after_seconds: 5`, and asserts the reminder prompt
reaches the model as a new turn of the same thread. Restart persistence,
recurring catch-up and update/delete are the service's own behavior and are not
journeyed here.
