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

- **No seat above the main panel.** The strip renders from a `shell.overlay` entry through a portal into a node placed right before the `main` slot outlet. The slot renderer wraps every outlet in `<div data-slot="<key>" style="display:contents">`, and only the frame (the `root` occupant) may render `main`, so `[data-slot="main"]` is unique and independent of the frame's own markup (`src/strip-mount.ts`). The node is re-attached when the frame replaces the outlet or its column.
  - _Why not a real seat:_ the frame's `AppFrame` is not exported (`@deepseek-ai/dsh-client-ui-layout` exports `apply`, `inject` and `LayoutController` only), a lower-priority shadow of `root` cannot re-declare `main` (declaring a declared child throws), and a keyed shadow of a `main` entry cannot render the entry it shadows (each entry's props are composed privately by the renderer). Disabling `ui-layout` in `cordis.patch.yml` drops its module from the boot graph, so a wrapper could not reuse its `apply` either; the only plugin-side seat would be a fork of the frame.
  - _Detection:_ if no `[data-slot="main"]` outlet appears within 3 s, the console warns once (`main-tabs: the tab strip cannot mount …`) and the strip stays hidden while tabs keep following the main view. If the strip renders anywhere but directly above the main panel, the console warns too. The e2e journey `main-tabs.strip-mount` fails on either.
- **Settings is not a tab.** Settings is the `ui-settings-general` modal, not a `main` panel, and nothing plugin-side can render its content elsewhere:
  - its pages are `settings.section` entries, a child slot the `sidebar.settings` entry declares; the renderer lets only the declaring entry `renderSlot` a child, so another plugin cannot render them;
  - a shadow `sidebar.settings` registration cannot re-declare those children, and the shell component (`SettingsRoot`) is not exported (the package exports `apply`, `inject` and `SettingsDocumentStore`);
  - disabling `ui-settings-general` in `cordis.patch.yml` removes its client module, so a wrapper cannot call its `apply`; replacing it would mean porting its whole shell (General section, onboarding, desktop update, document action, dictionaries, shortcut), a fork of a core package under a plugin name.

  Opening Settings from the gear, the palette or `Mod+,` keeps showing the native modal over the tabs.

- A panel's own sidebar icon can only be rendered by the `sidebar.panellist` declarer, so tabs use a generic panel or thread icon with the panel's sidebar label.
- With no tab left, the main view keeps showing what it showed: DSH has no way to show "nothing" without creating a blank Session.
