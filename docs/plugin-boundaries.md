# Plugin boundaries

Workspace packages depend on each other in one direction. `dshx check repo` enforces it: `--only cycles` fails on any
cycle, peer dependencies included, because turbo orders builds by `dependencies` and `devDependencies` only, so a cycle
that closes through a peer builds against whatever `dist/` the other side left. `pnpm check:cycles`
(`scripts/workspace-cycles.mjs`) runs the same cycle check from the dshx source before anything is built, and
`pnpm check:repo` runs every check after the plugin build; both are part of `pnpm check:green`.

When plugin A shows something that plugin B knows how to produce:

- **A declares a contract or registry, B fills it.** The plugin that owns the screen or slot defines the token
  (`defineContract`, `defineRegistry` from `@dshfiles/dshx/client`, published as a dshx `modules` entry) and renders
  what is provided, or nothing when B is absent. B already depends on A, so the dependency stays one-way. Example:
  `@dshfiles/ai-accounts/account-usage-view` declares `AccountUsageView`; `@dshfiles/usage` provides the dashboard.
- **A third integration plugin** only when the integration is large and both A and B must keep working without it.
  Every plugin is another bundle to build and boot, so do not split for a single component or call.
- **Never** import the other plugin's `dist/` by relative path (`--only boundaries` reports `relative-dist-import`), and
  never add an optional peer dependency to get around the cycle check.
- **A contract module never imports the plugin that fills it**, directly or through a file it imports: the provider
  depends on the contract, not the reverse. `--only boundaries` reports it as `contract-imports-provider`.

## Extend another owner's UI through its seats, not its DOM

A plugin that adds to UI another package renders contributes through a typed seat or registry that owner declares; it
never finds the owner's nodes with selectors or a `MutationObserver` and rewrites them. A markup change in the owner
would silently drop the feature, and a document-wide observer runs on every streamed chunk. When the owner is a package
this repository owns (a fork such as Chat or the frame), add the narrow, domain-specific seat there instead of patching
DSH core or writing a generic DOM-injection helper.

| Owner                      | Seat                                                                      | Contributors                                      | Documented in                                                                                               |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@dshfiles/chat`           | `InlineReferences` registry (assistant Markdown, Referenced-session line) | agents, backlog, memory, jujutsu, mentions        | [Chat: inline references](../plugins/@dshfiles/chat/README.md#render-inline-references-from-another-plugin) |
| `@dshfiles/chat`           | `conversation.composer.usageCost`, `conversation.chat.turnUsageCost`      | ai-accounts (cost estimates)                      | [Chat: usage readouts](../plugins/@dshfiles/chat/README.md#add-a-cost-to-the-usage-readouts)                |
| `@dshfiles/frame-layout`   | `shell.beforeMain` (rows above the main surface, `holdMainHidden`)        | main-tabs (tab strip, Start page)                 | [Frame: the before-main seat](../plugins/@dshfiles/frame-layout/README.md#the-before-main-seat)             |
| `@dshfiles/thread-sidebar` | row state and `uiSession`'s current binding                               | its own rows, sidebar and main-tabs mention menus | [Thread sidebar: keyboard and multi-select, mentions](../plugins/@dshfiles/thread-sidebar/README.md)        |

Decisions that still hold:

- Chat transforms the tree the native `MarkdownText` function returns instead of forking the Markdown renderer, which
  lives in `ui-primitives`; calling it keeps its streaming cache, and caching transformed blocks by identity keeps a
  streaming message's frozen blocks stable.
- Sent user messages belong to rich-composer: references there use its native `conversation.user.text` rules and the
  `conversation.user.text.node` slot, not Chat's registry.
- An entry for a seat an older or stock owner does not declare simply never renders; a feature that must notice says so
  once in the console with the fix (main-tabs warns after 3 s when no frame renders `shell.beforeMain`).

Not targets: React portals for dialogs and menus, DOM reads for focus or geometry, and observers that only measure layout
or theme (a popover reading its own `data-side`, focusing a field once it is visible). A plugin may also read a user
gesture on its own terms — agents opens its card when a native `@handle` file chip is activated, without writing the
transcript.

## What is not a seat yet: the rich-composer editor

`@dshfiles/backlog` wants item bodies and replies to use rich-composer's editor instead of its own capture-derived text
box. Rich-composer cannot offer that today: its editor is session-scoped. `ComposerContentEditable` leases one DOM root
per Lexical editor, and the input facade owns submit, draft persistence, attachments and the conversation, so mounting
a live thread editor in an item would take the thread's root and draft.

A real seat is a public dshx module from rich-composer: a per-occurrence editor instance with the Markdown input and
the node set (mentions, references, images) but injected capabilities instead of thread services, built by `dshx build`
like `conversation-contract`. Backlog would then keep its own Markdown, attachments, autosave, cancel and submit
semantics and render that editor where `BacklogTextBox` is today; it would not import a session composer, and no
plugin was made to depend on rich-composer's private source.
