# @dshfiles/btw

`/btw <question>` asks about the current thread without touching it. The
answer opens in a right-sidebar tab, where follow-ups continue.

Three more ways open an **Ask a side question** dialog for a thread, which
forks it exactly as `/btw` does and closes once the side panel opens:

- the command palette action _Ask a side question (btw)_, for the open,
  unarchived thread;
- the `btw.askSideQuestion` shortcut, default `Mod+Alt+/` (Settings ›
  Shortcuts rebinds it), for the thread in the main view. If another command
  already owns the chord, it registers without a default instead of failing;
- an icon-only button in the composer's right toolbar, before Prompts. It
  sits in the composer rather than the thread header because the question is
  typed where the user already writes, and the header already folds Pin into
  its "…" menu when the title is crowded; with no label, it adds nothing to
  the composer's collapse order. It hides on a blank draft.

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
  reports. The conversation sits in a flex column under that header: the
  embedded body sizes itself as a flex item, so a block wrapper would grow it
  past the pane, hide the composer and leave the transcript unscrollable.
- **The command:** the `/btw` source (`btw-source.ts`) answers `matchEnter` for
  `/btw` and `/btw <args>`, and `matchClaim` for a persisted `/btw` chip. The
  claim is answered without acting, so restoring a draft after a reload rebuilds
  the chip and its hint instead of running anything.
- **Hidden and archived:** `@dshfiles/thread-sidebar` hides threads titled
  `btw · …`. Closing the tab archives the fork; a failure after the fork
  archives it too, and the composer shows why.
- **State:** one xstate actor per side chat (`side-chat-machine.ts`):
  forking → configuring → asking → open → archiving → closed.

Measured on the scratch DSH with `dsh-our-free-model`'s "Kilo Auto Free"
route: the source thread's first request read 70 of 5,527 input tokens from
cache (1%); the side chat's first request read 5,526 of 5,544 (99.7%).
