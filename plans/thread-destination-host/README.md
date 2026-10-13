# Thread destination — Host chip

Shipped on stock DSH 0.2.0-rc.2. Durable behavior, setup, the bb / t3code
comparison and the limits live in the
[multi-host README](../../plugins/@dshfiles/multi-host/README.md); runtime
evidence in its [validation receipts](../../plugins/@dshfiles/multi-host/docs/validation.md#host-chip-and-remote-threads-2026-10-13).

| Phase | Status |
| --- | --- |
| 1. Trim + pool + launch-file discovery | Done |
| 2. Host chip (Local / hosts with status / Add host… / Manage hosts…) | Done |
| 3. Host-aware folder and bookmark pickers | Done (folders served by the host's multi-host; bookmarks by its jj-integration) |
| 4. Remote create + view | Done (no local Session; unknown outcome reported, never replayed) |
| 5. Inline view | Done as option C: transcript polled from the host, reply, stop, link to the host UI. Native rendering of a remote Session stays impossible on stock DSH (one runtime per browser client). |

Resume here: only [`nixfiles-remote-dsh.patch`](nixfiles-remote-dsh.patch)
remains, a proposed Home Manager user service so a Linux machine managed by
nixfiles can serve as a host (it reuses the supervisor that writes
`runtime/web-url`). The Pi and VPS are not nixfiles-managed today; apply it
and delete this directory once a host uses it.

Answers to the original open questions: the stock composer is replaced through
`conversation.composer.bar` while a remote host is chosen on a blank thread;
stock DSH has no session deep link, so the host UI opens at its home; framing
is not blocked but the inline view does not need it; a host without
jj-integration gets folders only; the sidebar tracks threads started here; a
second DSH on this machine works as a host through the loopback connector.
