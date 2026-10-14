# @dshfiles/main-tabs

Browser-like tabs above DSH's main view. Every thread or global panel the main view shows (Plugins, Jujutsu, AI Accounts, Usage analytics, Memory, Thread workspaces, Workbench, …) opens or focuses a tab; picking a tab shows it again.

This is an owned DSH bundle built with dshx (no port: nothing upstream does this). Run `pnpm build`, `pnpm test` and `pnpm typecheck` from this package.

## Use

- **Open**: anything shown in the main view gets a tab. By default it is a _preview_ tab (italic) that the next thing you open replaces, VS Code style; double-click it, pin it or drag it to keep it.
- **Close**: × on the tab, a middle click, or Delete on a focused tab. Closing the active tab shows its right neighbour. The context menu adds _Close other tabs_ and _Close tabs to the right_; pinned tabs survive both.
- **Pin**: from the context menu. Pinned tabs lead the strip and have no ×.
- **Reorder**: drag a tab. Pinned and unpinned tabs stay in their own groups.
- **Overflow**: the strip scrolls (mouse wheel works) and a ▾ button lists every tab once they do not fit.
- **Thread indicators**: a dot for _needs your input_ (an approval or a question), _working_ (pulsing), and _finished, unread_.
- **Keyboard**: Desktop Mod+1…8 / Mod+9 (last), Ctrl+Tab / Ctrl+Shift+Tab (Ctrl+Shift+] / [ on Linux). The browser keeps those keys, so the Web defaults are Mod+Alt+1…9 and Mod+Alt+] / [. All are listed and rebindable in Settings › Shortcuts. Arrow keys, Home/End, Enter and Delete work inside the focused strip.

## Settings (`dshfiles-main-tabs`)

| Key           | Default   | Meaning                                                                                                                                      |
| ------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`     | `true`    | Show the strip and follow the main view.                                                                                                     |
| `maxTabs`     | `12`      | Past it the least recently used unpinned tab closes.                                                                                         |
| `openMode`    | `preview` | Opening from outside the strip: `preview` tab, `new` tab, or `replace` the current one (never a pinned one).                                 |
| `persistence` | `project` | `project` keeps a tab set per project (a jj thread workspace counts as its project; subagents follow their parent); `global` shares one set. |

Tabs, order, pins, the preview flag and the active tab are saved in `localStorage` (`dshfiles.main-tabs.v1`). A reload that lands on the New thread screen reopens the saved active tab. A malformed document is ignored.

## Design

`tabs-machine.ts` (xstate) owns the tab sets, the active tab, order and persistence. The Host's main view stays the truth for what is shown: the client reports it (`host.navigated`, from `layout.panelInfo`, the Session list and Workspaces), and the machine opens or focuses a tab. Picking a tab asks the Host to navigate and ignores its in-between reports until it lands (two-second limit). Settings are only readable from components, so the machine waits in `gate` until the strip reads them.

## Host limits and workarounds

See [`plans/dsh-host-gaps.md`](../../../plans/dsh-host-gaps.md).

- The layout has no seat above the main panel. The strip renders from a `shell.overlay` entry through a portal into a node prepended to the centre column (found next to `[data-rightbar-col]`). If the frame markup changes, the strip disappears rather than breaking the panel.
- Settings is a modal dialog, not a main panel, so it cannot be a tab.
- A panel's own sidebar icon can only be rendered by the `sidebar.panellist` declarer, so tabs use a generic panel or thread icon with the panel's sidebar label.
- With no tab left, the main view keeps showing what it showed: DSH has no way to show "nothing" without creating a blank Session.
