# Backlog

Open work on `@dshfiles/backlog`. What shipped — capture, feed, board, triage, lifecycle signals, `@b:` mentions, the
SQLite op log, short aliases, providers, multi-host peers, backlinks on threads and revisions, quoting a reply into an
item — is documented in the [plugin README](../../plugins/@dshfiles/backlog/README.md), and the reasoning behind it in
[backlog redesign](../../plugins/@dshfiles/backlog/docs/redesign.md).

Resume here: the items below are either open work or verification that needs a live Host restart, real accounts or a
second machine. The one-off Discord TODO import was dropped on 2026-11-10: the user does not want it.

## Open

| #   | Item                                                                                                                                                    | State |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 7   | Edit item bodies and replies with `@dshfiles/rich-composer` instead of the capture editor (quoting a reply into an item shipped)                        | open  |
| 9   | A settled thread with no linked revision moves its open items back to `todo` (needs thread-sidebar's settled state across plugins)                      | open  |
| 10  | Journeys for feed paging (150 entries a page, needs a seeded store) and Inbox thread rows (Acknowledge, needs thread-sidebar's settled threads)         | open  |
| 11  | `Closes b:<ref>` in a PR description: `@dshfiles/pull-requests` does not expose PR bodies; gate state and automation creation are unit-tested only      | open  |
| 12  | Cross-host calls lose error details: dshx `createDshxApiCaller` keeps only the code                                                                     | open  |
| 13  | Linear delegate stays unmapped (Linear's is an app user, ours an agent session)                                                                         | open  |
| 14  | The README peek screenshot predates the two-lane timeline; the Hosts settings section has no screenshot and does not show peers' automation-Host choice | open  |

## Unverified live

- The landed plugin runs in the live DSH only after a Host restart, which is the user's call.
- Model triage: Jev answers live (about 200 ms a call); the model path needs a provider that accepts calls outside
  OpenCode.
- Notion (`@dshfiles/backlog-notion`) and Jira (`@dshfiles/backlog-jira`) ran only against fakes built from their
  docs; Jira link direction and `update.parent.set.none` are unproven.
- Peer replication ran only as an in-process two-Host test; a real run enables a peer in Backlog settings › Hosts, then
  reads `backlog_peer_status`.
- Pre-existing e2e failures, also on `main`: `workbench.repeated-plugin-views` (a contentEditable read with
  `toHaveValue`) and `main-tabs.backlog-capture-with-thread-tab` (the project dialog never opens).

## Open questions

- Dormant thresholds (14 days for notes, 30 for the rest) are a first guess; tune from use.
- Should triage proposals run on capture or in a batch (cheaper, less noisy)?
- Should the composer's `@b:` menu show the alias or the title first?
- How many `files` provider folders per project (one `backlog/` by default)?
