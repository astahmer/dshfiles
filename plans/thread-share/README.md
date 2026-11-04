# Thread sharing (b:2)

Share a DSH thread with people outside this DSH: read-only first, collaborative later.

**Resume here:** v1 is built in `plugins/@dshfiles/thread-share` (see its [README](../../plugins/@dshfiles/thread-share/README.md)).
Next: decide whether to promote it into a profile (it is not in the `profiles/web` seed on purpose), then start v2 from
the design below only after v1 has been used for real.

| Milestone                                                      | State              |
| -------------------------------------------------------------- | ------------------ |
| Adopt / port / build decision                                  | done (build)       |
| v1: read-only live or snapshot link, passphrase, expiry, revoke | done               |
| v1: static HTML export                                         | done               |
| v1: opt-in publish helper (cloudflared, Tailscale Funnel)      | done               |
| Transport research (Funnel, cloudflared, opentunnel, Pi Durable) | done (below)     |
| v2: collaborative threads                                      | design only (below) |

## Adopt, port or build: build

dshmarket.com (catalog `dsh-plugin-catalog`, 4,481 packages on 2026-11-04) has no plugin that covers the request:

| Candidate                      | What it does                                                                             | Why not adopted                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@zljr/dsh-share` 0.1.1 (MIT)  | Frozen HTML snapshot on a second `node:http` server bound to `0.0.0.0`, token in the URL | No passphrase, no redaction, no view counts, no agent tools, binds every interface, plain file in `~/.dsh`; no Effect/dshx contract. |
| `dsh-share` 0.5.0 (MIT)        | Export selected turns as PNG/Markdown/HTML in the browser                                | Export only, no link; Client-only.                                                                                                     |
| `dsh-local-share` 0.4.1 (MIT)  | Export a session to Markdown or self-contained HTML with redaction                       | Export only; we cover it with Download HTML.                                                                                            |
| `dsh-share-room` 0.3.3         | Single-use guest links into a forked, AI-answering room                                  | Lets guests prompt the model: that is our v2, with risks we do not take in v1.                                                          |
| `dsh-auth-tunnel`, `dsh-pocket`, `dsh-remote-tunnel-easy`, `dsh-service-portal` | Publish the **whole** DSH Web GUI through a tunnel           | Exposes the full app and its agents behind a password; the opposite of a one-thread read-only page.                                    |

`@zljr/dsh-share` validated the shape (separate route, frozen snapshot, token link); nothing was vendored.

## Host boundary

The Host supports what v1 needs, so the static-export fallback is a feature, not a workaround:

- `webServer.register({ kind: 'prefix', path: '/thread-share', handler })` adds a raw route. The web server itself has
  no auth (DSH's cookie check lives in the `/api` route), so the share route is reachable without the DSH cookie and
  only answers `/thread-share/s/<token>`. `@dshfiles/mcp-endpoint` uses the same seam.
- Plugin storage holds shares, the token index and chunked snapshots (values are capped at 256 KiB).
- session-controller's `sessions` API reads the transcript: user and assistant text only, so tool calls, attachments
  and runtime context never reach the page.
- The DSH subprocess service runs the tunnel CLI as a bounded child process.

Residual limits are recorded as row 94 of [the Host gap ledger](../dsh-host-gaps.md) (decision `own`).

## Transports

| Transport                   | How it publishes                                                                                                                      | Account          | Bounded subprocess?                                                                                                                             | v1 decision                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cloudflared quick tunnel** | `cloudflared tunnel --url http://127.0.0.1:<port>` prints a random `https://*.trycloudflare.com` URL                                 | none             | Yes: foreground process; the URL dies with it.                                                                                                   | **Implemented** (opt-in, 15 min / 1 h / 4 h).                                                                                                                     |
| **Tailscale Funnel**        | `tailscale funnel --https=8443 http://127.0.0.1:<port>` publishes `https://<machine>.<tailnet>.ts.net:8443`                            | tailnet; Funnel must be enabled in the ACL policy | Yes in foreground mode (no `--bg`): the serve config is removed when the process exits. Port 8443 leaves the user's own `tailscale serve` on 443 alone. | **Implemented** (opt-in). Failure names the admin-console switch.                                                                                                 |
| **opentunnel** (`anomalyco/opentunnel`, npm 0.6.1) | "Blind" TLS tunnels: the relay forwards encrypted bytes, so it never sees plaintext; `opentunnel route add <port>` gives a stable subdomain | an opentunnel identity per device | No: `route add`/`up` register a launchd/systemd **background service** that persists across reboots; only `opentunnel serve` runs in the foreground, and routes live in its config. | **Documented only.** Its persistent service and stable hostname conflict with "never auto-expose; bounded". Revisit if `serve` with an ephemeral route is enough. |
| **Pi Durable** (`@earendil-works/pi-durable`, experimental) | Not a transport. A durable agent harness (by mitsuhiko/badlogic) that commits conversations, turns and tool calls to storage before showing them and resumes after a crash; `pi-env` runs its tools on a remote machine over SSH; `pi-pocket` builds a multiplayer mobile app on it | n/a | n/a | **Not used.** Relevant to v2 as prior art: its "watching a conversation" and fork model is what a multiplayer thread needs. DSH already persists sessions; we would not swap harnesses. |

Every published byte goes through a plugin-owned loopback listener that answers only `/thread-share/…` and returns 404
for everything else, so even a misconfigured tunnel cannot reach the DSH app, `/api` or `/mcp`.

## v2 design: collaborative threads (not built)

Goal: someone with a link can follow a thread live **and** type into it, without a DSH account.

### Shape

1. **Guest identity.** A share gets a `collaborate` access level. A guest opens the link, picks a display name, and
   the route issues a guest grant (HttpOnly cookie, scoped path, short TTL) bound to that share. No DSH cookie, ever.
2. **Live view.** Replace the 30 s meta refresh with an SSE stream on the plugin route that relays redacted
   `user/message` and `assistant/message` events of that one Session (session-controller would need a `follow`
   method; the native `session/follow` is Client-only today).
3. **Guest input goes to a queue, not the model.** A guest message lands in a plugin-owned review queue. The owner
   approves it in DSH (one click, or an "auto-approve this guest" toggle); approval calls `sessions.message` with the
   plugin as the recorded source, so the transcript says who wrote it. Default: approval required.
4. **Fork, don't share the original.** Collaboration runs in a fork of the thread with a restricted agent preset:
   no `bash`, no file writes, no MCP, no secrets, read-only workspace (or a scratch directory). The owner can merge
   findings back by hand.
5. **Presence and limits.** Show who is watching (names only), cap guests per share, rate-limit messages per guest,
   and cap message size. Revoke ends every guest grant and closes their streams.

### Risks

| Risk                                                                 | Why it matters                                                                                                    | Mitigation in the design                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Prompt injection with the owner's permissions**                    | Any text a guest sends becomes model input; the agent runs tools with DSH's file and shell access.                | Owner approval by default; a forked thread on a tool-less preset; no secrets in that preset's context.           |
| **Secret leakage**                                                   | Redaction is pattern-based; a guest can ask the agent to print environment values or files.                      | Tool-less preset, no workspace read; keep redaction on the stream; document that redaction is best-effort.       |
| **Cost and quota abuse**                                             | Every approved message spends the owner's model quota.                                                            | Per-share and per-guest message caps, approval queue, expiry on every collaborate share.                         |
| **Impersonation and attribution**                                    | Guest names are self-chosen; a transcript could be read as the owner's words.                                    | Record the plugin as message source with the guest label; render guest messages distinctly.                      |
| **Link leakage**                                                     | A forwarded link gives write access, not just read.                                                               | Collaborate shares always require a passphrase, expire (no "never"), and can be revoked; consider one-time invite codes per guest. |
| **Long-lived connections through tunnels**                           | SSE through cloudflared/Funnel holds sockets open; a tunnel left running keeps the thread writable.             | Tunnel deadline already enforced; close streams on revoke and on tunnel stop.                                    |
| **Concurrent editing semantics**                                     | Two people steering one running turn produce interleaved, confusing instructions.                                | Guests only queue (`next-turn`), never steer; one turn at a time.                                                |
| **Host gaps**                                                        | No Host `follow` for plugins, no per-route listener, no per-session tool policy verb.                            | Session-controller grows `follow`; the restricted preset uses existing agent presets; record what remains.       |

### Not in scope for v2

Real-time co-editing of a draft, voice, file uploads from guests, and guest accounts that outlive a share.
