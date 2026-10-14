# @dshfiles/btw

`/btw <question>` asks about the current thread without touching it. The
answer opens in a right-sidebar tab, where follow-ups continue.

- **Fork:** `sessions.fork({ sessionId })` with no `atSeq`, so the Host cuts
  at the latest completed turn, the prefix the provider has already cached.
  A fork gets the default model, so the side chat then selects the source's
  `modelSelection` (`next`, else `lastUsed`: provider, model and effort) and
  renames itself `btw · <question>`.
- **Panel:** a `btwchat` right-sidebar tab type whose body hosts the native
  embedded Conversation for the fork (as subagent chats do), so the reply
  streams and the composer works there. The header shows how much of the
  first request the provider served from its prefix cache:
  `cacheRead / (input + cacheRead + cacheWrite)` of the first
  `assistant/message` after `session/end-seed`, the share `@dshfiles/usage`
  reports.
- **Hidden and archived:** `@dshfiles/thread-sidebar` hides threads titled
  `btw · …`. Closing the tab archives the fork; a failure after the fork
  archives it too, and the composer shows why.
- **State:** one xstate actor per side chat (`side-chat-machine.ts`):
  forking → configuring → asking → open → archiving → closed.

Measured on the scratch DSH with `dsh-our-free-model`'s "Kilo Auto Free"
route: the source thread's first request read 70 of 5,527 input tokens from
cache (1%); the side chat's first request read 5,526 of 5,544 (99.7%).
