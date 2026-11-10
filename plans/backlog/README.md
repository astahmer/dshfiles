# Backlog

Open work on `@dshfiles/backlog`. What shipped — capture, feed, board, triage, lifecycle signals, `@b:` mentions, the
SQLite op log, short aliases, providers, multi-host peers, backlinks on threads and revisions, quoting a reply into an
item — is documented in the [plugin README](../../plugins/@dshfiles/backlog/README.md), and the reasoning behind it in
[backlog redesign](../../plugins/@dshfiles/backlog/docs/redesign.md).

Resume here: item 7 is the only open work. Pull-request descriptions now close the items they name, and the Hosts
section shows where each peer runs automation (both in the plugin README). The one-off Discord TODO import was
dropped on 2026-11-10: the user does not want it.

## Open

| #   | Item                                                                                                                                                                                                                                                                                           | State |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 7   | Edit item bodies and replies with `@dshfiles/rich-composer` instead of the capture editor: it exposes no embeddable editor yet, so this needs a public per-occurrence editor module (see [plugin boundaries](../../docs/plugin-boundaries.md#what-is-not-a-seat-yet-the-rich-composer-editor)) | open  |

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
- `backlog.jev-secret-setup` fails on the secret setup offer: its value field renders without `type="password"`. The
  offer and catalog belong to `@dshfiles/secret-catalog`, which this plan does not change; rerun after that plugin's
  next fix.

## Open questions

- Dormant thresholds (14 days for notes, 30 for the rest) are a first guess; tune from use.
- Should triage proposals run on capture or in a batch (cheaper, less noisy)?
- Should the composer's `@b:` menu show the alias or the title first?
- How many `files` provider folders per project (one `backlog/` by default)?
