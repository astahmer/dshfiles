# Backlog

Open work on `@dshfiles/backlog`. What shipped — capture, feed, board, triage, lifecycle signals, `@b:` mentions, the
SQLite op log, short aliases, providers, multi-host peers, backlinks on threads and revisions, quoting a reply into an
item — is documented in the [plugin README](../../plugins/@dshfiles/backlog/README.md), and the reasoning behind it in
[backlog redesign](../../plugins/@dshfiles/backlog/docs/redesign.md).

Resume here: nothing open. Item 7 shipped: item bodies and replies use the rich composer's per-occurrence editor
(`@dshfiles/rich-composer/rich-text-editor`), and capture keeps its own. The remaining work is the live verification
below, which needs a Host restart the user owns.

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
