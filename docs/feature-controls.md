# Feature controls

AGENTS.md asks that significant or opinionated features be configurable or independently switchable. This page is the
audit of that rule: each feature below runs on its own (a background job, a network request, a model call, a changed
default) or imposes a workflow, and the table names its control, its default, what a change needs, and who owns a missing
switch. A feature a person starts by hand (a button, a tool call) needs no switch and is left out.

Every owned plugin is also one Loader row: Settings › Plugins, the plugin's own settings page (its **Plugin enabled** switch,
see the [Settings shell README](../plugins/@dshfiles/settings-shell/README.md#plugin-settings)) and the
`plugin_set_enabled` Agent tool switch a whole row. The table lists a row as the control only when the feature is the
whole plugin.

## Audit (2026-11-10)

| Feature                                                     | Control                                                                                             | Default        | A change needs                                    | Documented in                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| DSH release check (GitHub every few hours, Settings badge)  | `dshfiles-settings-shell.releaseCheck`                                                              | on             | nothing: live                                     | [Settings shell](../plugins/@dshfiles/settings-shell/README.md#dsh-release-notices)  |
| DeepSeek account sign-in, its provider and its account UI   | native rows `deepseek-account`, `llm-deepseek-account`, `account-controller`, `ui-settings-account` | on (stock DSH) | the row switches; the manager reports any restart | this page, below                                                                     |
| Timed `ask_user_question` (the Agent keeps working)         | `tool-ask-user` `mode` in the seed's `preset-standard` row                                          | `timed`        | profile edit, restart                             | [agent-questions](../plugins/@dshfiles/agent-questions/README.md)                    |
| Backlog triage and Memory signal gates (Jev calls)          | each plugin's Jev switches, Settings › Tools & MCP › Jev                                            | per plugin     | nothing: live                                     | [Settings shell](../plugins/@dshfiles/settings-shell/README.md#one-jev-key)          |
| Held-back plugin updates until a restart                    | `dshfiles-hmr-gate` row (it replaces the stock `client-hmr`)                                        | on in `web`    | row switch; restore the stock row with it         | [hmr-gate](../plugins/@dshfiles/hmr-gate/README.md)                                  |
| File snapshot at every turn start (undo and rewind)         | `dshfiles-session-undo` row                                                                         | on             | row switch                                        | [session-undo](../plugins/@dshfiles/session-undo/README.md)                          |
| Goal stall guard                                            | `dshfiles-goal-stall-guard` row                                                                     | on             | row switch                                        | [goal-stall-guard](../plugins/@dshfiles/goal-stall-guard/README.md)                  |
| Usage index over session logs                               | `dshfiles-usage` row; OTLP export: `OTEL_SDK_DISABLED` / `OTEL_METRICS_EXPORTER=none`               | on             | row switch; environment variables at start        | [usage](../plugins/@dshfiles/usage/README.md)                                        |
| Tool search hides `bash` and `ask_user_question`            | opt-in bundle `@dshfiles/tool-search`, not in the `web` seed                                        | off            | profile install                                   | [tool-search](../plugins/@dshfiles/tool-search/README.md)                            |
| First-run setup wizard (a card while no thread is open)     | `dshfiles-onboarding.wizard`                                                                        | on             | nothing: live                                     | [onboarding](../plugins/@dshfiles/onboarding/README.md#settings-dshfiles-onboarding) |
| GitHub sign-in check on Getting started (one `gh` a minute) | `dshfiles-onboarding.githubCheck`; the whole checklist: `dshfiles-onboarding.checklist`             | on             | nothing: live                                     | [onboarding](../plugins/@dshfiles/onboarding/README.md#settings-dshfiles-onboarding) |
| AI review-scope summaries (one model call)                  | none needed: runs only on **Summarize**                                                             | —              | —                                                 | [pulls-review](../plugins/@dshfiles/pulls-review/README.md)                          |

### The DeepSeek account

The account feature is four native rows, not one: the Host platform (`deepseek-account`, from `dsh-base`), the model
provider (`llm-deepseek-account`), the account API (`account-controller`) and the Settings account section
(`ui-settings-account`, from `dsh-web-app`). Turning off only the provider leaves the account section mounted, and it
keeps reading the account (a signed-out profile logs `[deepseek-account] account read failed`). To remove the feature,
switch off all four. Owned forks only read the provider id: `settings-models` hides the account row and
`session-controller` skips it when no route serves it, so they need no switch of their own.

## Open

| Gap                                                                                                                          | Owner                                           | Next step                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| One switch for the DeepSeek account instead of four rows; proof that the account section stops its reads once its row is off | upstream DSH (`dsh-client-ui-settings-account`) | Verify in a scratch DSH with the four rows off and record the request count; an owned fork of the row only if the reads persist. |
| Cordis `inject` dependencies of an entry (what stops with it)                                                                | upstream DSH (plugin manager records)           | The manager lists rows, bundles and overrides but no dependency edges; the entry card shows only what it reports.                |
