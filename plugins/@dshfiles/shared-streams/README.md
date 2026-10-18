# @dshfiles/shared-streams

One `EventSource` per URL for the whole browser profile instead of one per tab.

## Why

Chrome allows six concurrent HTTP/1.1 sockets per origin. A DSH tab permanently
holds two EventSource streams — `/plugins/events` (client HMR) and any SSE a
plugin opens, e.g. `/api/our-free-model/events` — while the `/api/remote.mux`
WebSocket is exempt from that budget. Two tabs therefore sit exactly on the
limit and three exhaust it: the next tab's bundle and `/api/*` requests queue
forever, which is what "Loading threads…" with dozens of pending requests is.

Measured on a scratch host: one tab = 2 sockets, three tabs = 6 = every HTTP
slot, and a fourth tab never reaches `domcontentloaded`. Blocking only the two
SSE paths makes eight tabs load normally, which is the fix this plugin ships.

## What it does

The Host injects one inline script into `index.html` ahead of the app entry
module (`webServer.tapIndex`). The script replaces `globalThis.EventSource`
with a proxy backed by a `SharedWorker`:

- The worker is created from a Blob URL, so no HTTP route is needed and the
  worker is per-origin: one native `EventSource` per URL, no matter how many
  tabs are open.
- Each tab keeps a normal `EventSource` surface — `addEventListener`, `onopen`,
  `onmessage`, `onerror`, `readyState`, `close()` — and receives frames relayed
  from the worker over its port.
- A page has one worker port, so each subscription carries the union of the
  event types its live instances listen for. The worker attaches exactly those
  types (plus unnamed `message`), and closes a URL once its last subscriber goes
  away, so a stream is not kept open by a tab that has closed.
- Instances of one URL form a group: closing one leaves its siblings subscribed,
  and only the group's last `close()` releases the URL.

## Fallback

The proxy is only installed when `SharedWorker` exists and the Blob worker
starts. If the worker errors, or no `ready` frame arrives within three seconds
of the first subscription, the page tells the worker to disconnect — releasing
every subscription it still held — and each proxied instance takes ownership of
its own per-tab `EventSource`. `close()` then closes that socket, so a fallback
cannot leak a connection, and the global is restored: the behaviour the profile
had before this plugin existed, never silence.

## Configuration

| key       | default | effect                                                   |
| --------- | ------- | -------------------------------------------------------- |
| `enabled` | `true`  | `false` leaves the global untouched (one stream per tab) |

A per-browser kill switch is also available without touching the Host:

```js
localStorage.setItem('dsh:shared-event-source', 'off')
```
