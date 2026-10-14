# @dshfiles/tool-meta

Start time and duration on every tool call in the chat transcript: `1.2 s · 14:02:11` at the right of each tool card's header row, for native tools and plugin-owned ones, root calls and PTC children alike. While a call runs the duration counts up every second.

Built with dshx (no port: nothing upstream does this). Its own small plugin rather than a slice of an existing one, because it touches no other plugin's state and has its own fragile seam to watch. Run `pnpm build`, `pnpm test` and `pnpm typecheck` from this package.

## Settings (`dshfiles-tool-meta`)

| Key          | Default    | Meaning                                                                                   |
| ------------ | ---------- | ----------------------------------------------------------------------------------------- |
| `enabled`    | `true`     | Show the timing line on tool cards.                                                       |
| `timeFormat` | `absolute` | `absolute`: clock time, with the day when not today. `relative`: `12 s ago`, `5 min ago`. |

## Where the times come from

DSH already folds them into the blocks it hands every tool view: a dispatched call carries its `tool/call` time, a result carries its `tool/result` time and, while the call is still in the loaded window, the call's time (`callTime`). Nothing is read from the event stream. A result whose call fell outside the loaded window shows only `ended 14:02:12`; a call whose arguments are still streaming shows nothing.

## How it decorates native cards

`tool.call.toolview` is keyed per tool, so a registration replaces a card instead of adding to it. One level up, `@deepseek-ai/dsh-client-ui-tool` renders each tool call through its `conversation.chat.node` `tool-call` entry (`ToolCallTree`), which dispatches every atomic call through its `renderSlot('tool.call.toolview', owner)`. This plugin swaps that ledger entry's component (read through the public `ctx.slots.entriesOfSlot`) for a wrapper that renders the original tree with a `renderSlot` framing each dispatch with the timing line. The tree keeps its slot authorization, keys and memoization, and every card renders exactly as before. It re-wraps when the entry is re-registered (HMR, a plugin taking the key) and puts the original back on dispose. A shadowing registration cannot do this: the tree's `tool.call.toolview` child slot is declared by the native entry, so a shadow could not render the cards.

### Self-detection

The seam depends on three things DSH could change. Each logs one `@dshfiles/tool-meta:` console warning and leaves the cards untouched:

- no `conversation.chat.node` `tool-call` entry 15 s after boot;
- the tree receives no `renderSlot`, or renders without dispatching `tool.call.toolview`;
- the toolview owner stops carrying `phase` and `block.time`/`callTime`.

The `tool-meta` journeys (`tooling/dshx/e2e/features/tool-meta.feature`) and the catalog `reach` fail when the line disappears. The additive route is in [`plans/dsh-host-gaps.md`](../../../plans/dsh-host-gaps.md).
