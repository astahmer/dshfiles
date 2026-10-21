# @dshfiles/session-source-port

The Host port through which the Session controller accepts Sessions that live on
another runtime. One side provides it (`@dshfiles/session-controller` as
`sessionSources`), the other registers a source (`@dshfiles/multi-host` today).
It lives in its own package because both sides import it: whichever plugin owned
it would make the other depend on that plugin's whole dependency chain.

A source mirrors the `session/*` endpoints it implements — `list`, `follow`,
`page`, `prompt`, `cancel`, `updateQueue`, `projections` — and the controller
forwards the request it received and returns the answer unchanged. An
unimplemented method keeps that endpoint local-only, so a source can start
read-only and gain writes later.

The registry is the only value here; `createSessionSourceRegistry()` is provided
by the controller, and a source is registered through `ctx.sessionSources`.

```ts
ctx.inject(['sessionSources'], scoped =>
  scoped.sessionSources.register({
    id: runtimeId,
    label: hostName,
    list: async (request, signal) => rows,
    owns: sessionId => known.has(sessionId),
    prompt: (request, signal) => forward('session', 'prompt', request, signal),
  }),
)
```

Ownership is claimed from `list` answers and re-checked through `owns()` only when
a Session id is not cached, so a control flow never walks every source.
