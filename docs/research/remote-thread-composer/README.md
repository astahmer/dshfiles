# Remote threads in bb, t3code, and Codex

How three products give work on another machine (or in the cloud) the _same_ chat
composer as local work, read to decide how `@dshfiles/multi-host` should replace its
plain-textarea remote composer. The decision and the DSH plan are in
[remote-thread-architecture.md](../../../plugins/@dshfiles/multi-host/docs/remote-thread-architecture.md).

| Note                   | Product                     | Version / revision                                            | Read as                                            |
| ---------------------- | --------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| [bb.md](bb.md)         | bb (get-bb/bb)              | 0.46.1 (`/Applications/bb.app` asar) + public `main`          | shipped app asar and public source                 |
| [t3code.md](t3code.md) | T3 Code                     | full checkout at `~/.references/t3code` (snapshot 2026-10-13) | source and its own `docs/internals`                |
| [codex.md](codex.md)   | Codex (openai/codex + docs) | `17a0e6f6`, `learn.chatgpt.com` docs                          | public source; desktop/IDE UI is doc-verified only |

Verdict in one line: all three keep **one** composer and make the execution target
data on every request — bb fans out inside its server (a host dimension on one API),
t3code and Codex let the client talk to each environment directly. None ships a
reduced composer for remote work, and Codex explicitly keeps the rich composer while
only restricting submission when the connection drops. DSH has one browser-to-Host
boundary, so bb's shape is the one that fits.
