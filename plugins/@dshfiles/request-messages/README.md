# Request Messages

Dispatches the `agent/request-messages` waterfall on stock DSH 0.2, so a plugin
can change the messages one agent-loop model request sends without rewriting
the session log. AI Accounts' image offload listens to it.

## The seam

Stock DSH has no event that can change a request's messages. `llm/stream`
listeners see the request, but cordis `next()` takes no arguments, so they
cannot pass a changed one on. The waterfall's innermost callback, though, reads
`LlmRuntime.adapterStream` at call time and hands it the same options. This
bundle wraps that method on the runtime instance:

1. Requests the agent loop did not build (`isAgentLoopRequest` is false) pass
   through unchanged; this includes titles, compaction and plugin-owned calls.
2. For a loop request, it finds the agent by `options.sessionId`, reads the
   turn and step from the latest `step/start`, and runs
   `agent/request-messages` in that agent's scope (agent-scoped `agent.ctx.on`
   listeners receive it, as do unscoped ones).
3. A different list is frozen and sent as `{ ...options, messages }`. Provider,
   model, effort, tools and tool history stay exactly as DSH built them, so the
   prepared-call config check and every `llm/stream` listener still see the
   original request.

Subagent requests are dispatched too; listeners decide whether to act on them.
A listener that throws is logged and
the derived messages are sent, unless the request was cancelled.

`adapterStream` is private in the published types. If a DSH runtime lacks it, the
bundle dispatches nothing and answers `request-messages/status` with
`{ active: false, reason }` — consumers fall back instead of guessing.

## Consuming it

```ts
import type {} from '@dshfiles/request-messages'

ctx.on('agent/request-messages', async (payload, next) => {
  const messages = await next()
  return messages
})

const available = ctx.bail('request-messages/status')?.active === true
```

The package's types entry is `src/contract.ts`: the event augmentation and the
status type. Add `@dshfiles/request-messages: workspace:*` as a dev dependency;
nothing is imported at runtime.

## Lifecycle

The wrap is shared through a `Symbol.for` key on the runtime instance, so two
loaded copies wrap once and dispatch once; the last copy to unload restores the
original method. The Host injects `llm` and `agents`, so cordis re-applies the
bundle when either service is replaced.
