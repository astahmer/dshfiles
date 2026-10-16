# Session reminders plan

## Context

- User wants reminders, not BB-style independent scheduled jobs.
- DSH's optional `@deepseek-ai/dsh-experimental-schedule-bundle` couples `time-context`, `schedule`, and `ui-schedule`. The checked-in [web profile](../profiles/web/package.json#L44-L84) omits the bundle.
- Fresh Host Inspect reports a live `schedule` Service with create/list/catalog/history/delete/update and a `schedule/changed` event. Config rows are not authoritative bundle inventory; Client Inspect timed out. Resolve actual bundle/UI/tool composition through Plugin Manager `listBundles()` before claiming what is mounted.
- Versioned package docs: [Schedule](https://unpkg.com/@deepseek-ai/dsh-schedule@0.2.0-rc.2/README.md), [experimental bundle](https://unpkg.com/@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.2/README.md), [bundle patch](https://unpkg.com/@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.2/cordis.patch.yml).

## Goal

Let user schedule durable reminders delivered as follow-up messages to the intended DSH Session, reusing the official Schedule bundle without building a new plugin.

## What

Preflight current bundle/service state; probe the official bundle in a scratch profile; if it meets reminder needs and overhead is acceptable, propose selecting the bundle for the web profile. Keep scope to one-shot and recurring same-Session reminders.

## Why

The native Schedule contract already matches reminders. Building a custom scheduler would duplicate persistence, time-zone handling, catch-up, and Session delivery. BB Automations' scripts, independent Sessions, and worktrees are outside current need.

## How

### Conceptual model

A reminder belongs to one selected Session and produces a follow-up user message when due. The Host owns persistence and due delivery; bundle selection owns UI/tools/time context.

### Operations / behavior

- Create one-shot `after_seconds` or `at` reminders and recurring `daily`, `weekly`, or five-field `cron` reminders with explicit IANA zone.
- List/catalog/history; update or delete; deliver into the selected original Session.
- Host availability is required. While down, recurring tasks contribute only the latest missed occurrence; delivery failure has no automatic retry timer.
- Do not promise desktop notifications, new Sessions/worktrees, arbitrary scripts, pause/resume, run-now, or BB-equivalent run history.

### Tech choices

| Choice | Decision | Rationale |
|--------|----------|-----------|
| New plugin vs official bundle | Reuse the official experimental bundle | Schedule service and UI are already shipped. |
| Enable rows individually | No; select bundle as a unit | `time-context`, `schedule`, and `ui-schedule` are coupled patch rows. |
| Target profile | Scratch/probe first; web only after explicit approval | Avoid changing the live profile or `:3080` without proof. |
| Full automation | Defer | Needs separate session-independent durable job and safe-executor contracts. |

### Architecture

```text
Plugin Manager bundle inventory + profile preflight
  -> select official Schedule bundle in scratch profile
  -> Host Schedule service persists reminder
  -> due event restores/enqueues original Session follow-up
  -> Schedule UI shows reminder and receipt history
```

## What this allows

- Durable same-Session reminders with one-shot and recurring schedules.
- Verified timezone, restart, catch-up, update/delete, and history behavior before profile rollout.

## What this does not allow

- Independent agents, scripts, new threads/worktrees, OS notifications, or a general automation dashboard.
- Claiming the bundle is absent based only on Config rows or the checked-in profile; current Host Service is live and bundle inventory remains to verify.

## UI & UX

### Desktop

Use the official Schedule UI in Plugins → Official / Automation tasks. Keep reminders clearly tied to the selected Session and show timezone, next due time, latest receipt, and host/downtime caveat.

### Common interactions

| Action | Result |
|--------|--------|
| Create reminder | Persist a prompt and exactly one time selector for a Session. |
| Update/delete | Change or remove future delivery; confirm deletion. |
| Review history | Show receipt status and missed-occurrence behavior. |

## Data model

Reuse the official bundle's durable task/history model. No DSH plugin-owned scheduler table, client timer, or script payload is added by this plan.

## Implementation steps

1. Read current web profile and query Plugin Manager `listBundles()`; report separately whether Host Schedule Service, bundle, UI rows, tools, and `time-context` are mounted.
2. Create a disposable scratch profile from web; select the official bundle through Plugin Manager or `dsh.profile.bundles`. Do not patch the three row IDs individually.
3. Verify one-shot, daily/weekly with IANA zone, cron, list/catalog/history, update/delete, and delivery to the intended original Session.
4. Restart only scratch Host; verify persistence, cold Session restoration, latest-missed-occurrence catch-up, and failure/retry behavior. Surface that Host must be running.
5. Measure tool/context overhead from `time-context`; confirm reminders are follow-up messages, not notifications.
6. If probe passes, present web-profile bundle selection as a separate approval; only then change profile and follow normal DSH profile sync/restart workflow.

## Open questions

1. Is a follow-up message in the original Session sufficient, or is desktop notification required?
2. What timezone should daily/weekly/cron use by default: browser zone or explicit selection every time?
3. Is Host expected to remain running at reminder time? Is latest-missed-only acceptable?
4. Is added time context and its model/tool-token overhead acceptable for all Sessions in the profile?

## Acceptance criteria

- [ ] Preflight distinguishes live Host Service from selected bundle, UI rows, and Agent tools.
- [ ] Reminder survives scratch Host restart and delivers only to its selected original Session.
- [ ] Daily/weekly/cron display explicit IANA timezone; catch-up and Host-down behavior are visible.
- [ ] Update/delete work; deleted reminder never fires later.
- [ ] No accidental new Session, script execution, or claim of OS notification behavior.
- [ ] Bundle overhead is measured and accepted before web-profile proposal; live `:3080` remains untouched during probe.

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-16 | Reuse optional official Schedule bundle for reminders; no new plugin | Existing Host service and bundle cover the scoped use case. |
| 2026-10-16 | Probe before profile rollout; resolve bundle state through Plugin Manager | Host service is live while selected bundle/UI status is uncertain. |
