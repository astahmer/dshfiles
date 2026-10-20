# @dshfiles/multi-host

Run new threads on other machines. Each machine runs its own stock DSH 0.2
runtime with this plugin installed; this machine reaches it over SSH and keeps
one tunnel open per host. Works on stock DSH 0.2.0-rc.2, no core patch.

## Using it

The New thread bar (rendered by `@dshfiles/jj-integration`) starts with the
**host chip**:

- **Local ✓** — the default; nothing changes.
- **A host** — each registered host with a status dot (green: connected, with
  the round-trip in ms; grey: not connected yet; red: the last error).
  Opening the menu pings every host once.
- **Add host…** — SSH destination (suggestions from `~/.ssh/config` aliases,
  following `Include`, and plain `known_hosts` names), a name, and the remote
  DSH home. **Find** lists the DSH homes under the remote user's home that
  publish a launch file. **Test connection** shows each step (SSH login, DSH
  runtime, multi-host identity) with its time. **Add host** pins the runtime's
  identity and selects it.
- **Manage hosts…** — edit (re-qualifies the target and home), reconnect, or
  remove a host. Removing keeps remote data and the local record of threads
  started there; they come back if the host is added again.

With a host chosen:

- The folder chip browses **that host's** folders (served by its multi-host,
  because stock headless runtimes refuse `directoryPicker.list`) and lists its
  projects (its jj-integration's projects, else its registered workspaces) and
  folders of earlier threads there.
- When the host runs `@dshfiles/jj-integration` and the folder is a jj
  repository, the bookmark and **workspace** chips come from the host; sending
  creates the isolated workspace there.
- The composer is replaced: the message, and a model picked from the host's
  own catalog, start a Session **on the host**. No local Session is created.
  While the host is unreachable the composer says so and offers **Reconnect**;
  nothing is sent.
- The started thread opens in the main area: transcript (user and assistant
  text, each tool call with its output), **Working** while a turn runs (polled
  every 1.5 s, 8 s when idle), reply, stop, and **Host UI**, which opens the
  host's own DSH in a new tab on a stable loopback origin. If the host drops,
  the last transcript stays on screen under the error.
- The **Remote threads** list shows every thread on every registered host,
  grouped by host and newest first: threads started from here keep their title,
  threads started on the host itself (its own UI or another machine) carry a
  muted **started on host** badge and are titled by their folder. Status is
  polled only while that list is open. An offline host shows one muted
  "unavailable" line and still lists the threads started here.
- While a remote turn waits, the open-thread view says what it waits on:
  **The agent ... is asking a question** when the last tool call is
  `ask_user_question` (or `ask_parent_question`), and **Waiting on <tool>**
  when any other call has stayed open for more than a minute, since the log
  cannot tell a slow command from a pending approval. Both offer **Host UI**;
  answering and approving stay in the host's own DSH.
- The thread sidebar shows a **Remote** section: every thread started from
  here, badged with its host and whether its connection is open.

## Setting up a remote host

1. SSH from this machine must work in BatchMode (agent or key) and the host
   key must already be in `known_hosts`; unknown or changed keys are refused.
2. On the host, run DSH 0.2 on loopback with a profile that includes
   `@dshfiles/multi-host` (and `@dshfiles/jj-integration` for bookmarks and
   isolation), e.g. a systemd user service with linger:
   `dsh --profile <name> --host 127.0.0.1 --port 0 --no-open`.
3. The runtime writes `$DSH_HOME/plugins/multi-host/launch.json` (0600, in a
   0700 directory) with its tokenized loopback URL and removes it when it
   exits. A DSH started through the nixfiles `dsh-web` supervisor also records
   `$DSH_HOME/runtime/web-url`, which is read as a fallback. The current
   supervisor still needs to enforce private permissions on pre-existing paths
   and redact launch URLs from service logs; do not rely on that fallback for a
   durable deployment until its owner fixes and verifies both.
4. Add the host from the chip. Nothing is installed on the host by this
   plugin; provisioning stays with whoever manages that machine.

## How it works

- **Directory** (`plugins/multi-host/directory.json`, 0600): hosts
  `{id, name, sshTarget}` and runtimes `{remoteHome, pinned identity, stable
origin port, lastSeen}`. Launch tokens are not stored; they are read over SSH
  at connect time and exchanged for an HttpOnly cookie held in memory.
- **Connection pool**: one gateway per runtime (`ssh -N -L` to the remote
  loopback port, or a loopback forward for another DSH on this machine), keyed
  by a generation id, closed after 5 idle minutes or when ssh exits. A read
  that fails because the connection dropped retries once on a fresh one; a
  mutation never replays and reports `unknown-mutation-outcome` instead.
- **Identity**: every new connection checks the runtime id, profile, home leaf
  and protocol pinned at registration; a different runtime behind the same
  address is refused.
- **Threads** (`plugins/multi-host/threads.json`): `{runtimeId, sessionId, cwd,
title}` for threads started here, so the sidebar and view can list them.
- **APIs**: `multi-host` v1 is owned by this package, so other plugins' clients
  call it (`@dshfiles/multi-host/destination` exports the contract and the UI
  pieces). Remote plugin calls are allowlisted to jj-integration's
  `projects`, `destination`, `provision` and `noFolder`; native calls to the
  session list/search/create/prompt/page/cancel/rename/fork and archive
  methods.

## Compared with bb and t3code

|                                   | bb (desktop build)                                      | t3code nightly                                             | multi-host                                                         |
| --------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Transport                         | enrolled daemon, WebSocket to server                    | `ssh -L` to `t3 serve`                                     | `ssh -L` to `dsh web` (BatchMode, strict host keys)                |
| Add host                          | enroll key + `curl \| sh` command, poll until connected | Settings → Connections, ssh config/known_hosts suggestions | chip → Add host…, same suggestions, Find + stepwise Test           |
| Provision remote server           | install script                                          | release archive, checksum, lock, `nohup serve`             | not done: the host's DSH is managed separately                     |
| Persistent connection / reconnect | heartbeat 5 s, backoff 1–30 s                           | supervisor, backoff 2 s–5 min                              | pooled tunnel, lazy reconnect, ping on menu open, manual Reconnect |
| Remote folders / branches         | `host.browse_directory`, `list_branch_options`          | env `filesystem.browse`, `vcs.listRefs`                    | host's multi-host listing, host's jj-integration                   |
| Run and follow a thread           | RPC + event upload                                      | per-environment WebSocket                                  | create + prompt over the native API, transcript polled             |
| Sidebar                           | "By machine" grouping                                   | machine icon on foreign threads                            | Remote section with host badges                                    |
| Offline send                      | queued                                                  | blocked with toast                                         | blocked with Reconnect                                             |
| Credentials                       | hostKey file 0600                                       | system ssh + askpass, safeStorage                          | system ssh agent/keys only; no password prompt                     |

## Limits

- A remote thread is a Session of another runtime. The browser client binds to
  one runtime, so the native transcript (tool cards, approvals, attachments,
  terminal, per-token streaming) cannot render it; the remote thread view shows
  text and tool output and links to the host's own UI for the rest.
- The agent preset chip of the New thread row does not apply to remote
  threads; the model is picked in the remote composer.
- No password or keyboard-interactive SSH (BatchMode only), and no remote
  provisioning.
- The sidebar's Remote section still lists only threads started from this
  machine; threads created directly on the host appear in the Remote threads
  list, not the sidebar.
- The remote transcript is polled (1.5 s while a turn runs, 8 s idle), not
  streamed; the conversation is still written and read on the host.
- DSH writes no question-request or approval-request event, so a pending
  question is only visible as an open `tool/call`. That is why a generic tool
  wait is announced after a minute rather than immediately, and why answering
  or approving always happens in the host's own DSH.
- No session handoff between machines, and no answer/approve action from here.
- LSP is not advertised by remote runtimes (unchanged from earlier
  validation).

## Checks

`pnpm build`, `pnpm test`, `pnpm typecheck` from this package. The live SSH
suite runs only when `MULTI_HOST_SSH_TARGET` and `MULTI_HOST_SSH_HOME` point at
a host running DSH with this plugin.

The manual [SSH smoke](../../../tooling/dshx/scripts/smoke-multi-host-ssh.mjs)
creates remote sessions/files and restarts its selected user service. It has no
host defaults and requires `MH_DISPOSABLE_TARGET=1`,
`MH_ALLOW_REMOTE_MUTATIONS=1`, `MH_SSH_TARGET`, private `MH_SSH_KEY`, a
`MH_KNOWN_HOSTS` file not writable by group/other, `MH_UNIT`, `MH_WS`, and
`MH_REMOTE_HOME`; optional `MH_SSH_PORT` is a TCP port from 1 to 65535 and
defaults to 22. It rejects unknown host keys and reads launch metadata from
files, never the journal. It ignores per-user SSH config, so `MH_SSH_TARGET`
must be a literal host/IP that matches the supplied known_hosts entry. Run it
only against a disposable Linux service.
Tests cover fail-closed configuration, individual opt-ins, port bounds,
known_hosts permissions, shell-safe paths, and launch-URL redaction without
starting DSH. A separate test validates the strict SSH options against an
ephemeral high-port loopback-only sshd, always stopping its owned process group;
it does not contact a remote host or prove DSH lifecycle behavior. Runtime evidence is in
[docs/validation.md](docs/validation.md); why runtimes are federated rather
than proxied, and the rules that follow, are in [docs/design.md](docs/design.md).
Durable supervision of a remote host is still open:
[plans/multi-host](../../../plans/multi-host/README.md).
