# @dshfiles/settings-shell

DSH's Settings, rebuilt as a plugin so it can grow VS Code-style behaviour the native shell has no seat for.

## Use

- **Open**: the sidebar gear, `Mod+,` (Desktop) / `Mod+Alt+,` (Web), the command palette (_Open Settings_, or
  _Settings: <section>_ for each section), or another plugin (below).
- **Tab or dialog**: with `@dshfiles/main-tabs` loaded, Settings fills the main view and gets a tab like any other
  panel; without it, it opens as the native dialog. `openIn` overrides that choice.
- **Expand**: the dialog's expand button fills the window (VS Code's maximize); _Open in a tab_ moves an open dialog
  into the main view, keeping the section.
- Picking the Settings tab, or a reload that lands on it, reopens Settings there; leaving the panel closes it. With no
  other tab left, main-tabs keeps showing Settings (it cannot show an empty main view).

### Open Settings from another plugin

```ts
window.dispatchEvent(
  new CustomEvent('dshfiles:open-settings', {
    detail: { section: 'models' }, // or { setting: { entryId, fieldPath } }, { query }, plus an optional surface: 'modal' | 'tab'
    cancelable: true,
  }),
)
```

`dispatchEvent` returns false when the shell took the request, the contract of `dshfiles:open-file` and
`dshfiles:command-palette`. Settings sections receive `close`, as natively.

## Port

This bundle is a **port** of `@deepseek-ai/dsh-client-ui-settings-general` **0.2.0-rc.2** (MIT, © DeepSeek), the
native Settings shell: the sidebar trigger row with its connection-recovery pill and Desktop update indicator, the
settings surface and its section navigation, the General section (Coding view switch, current version), the
`settings.*` child slots every settings page registers into, the onboarding coordinator and the `settings.open`
shortcut (Desktop `Mod+,`, Web `Mod+Alt+,`). Its `cordis.patch.yml` switches the native `ui-settings-general` row off
and inserts `dshfiles-settings-shell`.

Why a port and not a wrapper: the native sections are `settings.section` entries, child slots that only the declaring
`sidebar.settings` entry may `renderSlot`; a shadow registration cannot re-declare them, `SettingsRoot` is not
exported, and a disabled row's client module never loads, so nothing can reuse its `apply`. The port keeps every slot
name and owner prop, so native and plugin sections register exactly as before.

`src/native/` holds the ported code, one file per upstream module, each naming its source. `src/upstream.ts` records
the version it was taken from:

- `src/upstream-version.test.ts` fails when the workspace's DSH packages move past that version;
- the Host logs `settings-shell: ported from … but DSH ships …` at boot when the running DSH resolves another version,
  and the General section's version row shows the running one.

To refresh: diff the new `lib/client.js` of the native package against 0.2.0-rc.2, port the changes into
`src/native/`, then bump `PORTED_FROM`.

Deliberate differences from upstream:

- Styles are `dshx:` utilities instead of CSS modules (one shared plugin stylesheet).
- Dictionaries live under `dshfiles.settings-shell`; dshx reserves the native `settings` namespace.
- The native welcome notice keeps its acknowledgement in the `ui-settings-general` namespace, which only the native
  row serves. With that row off the namespace is unserved, so the shell skips the `welcome-notice` onboarding step
  instead of showing it with a save error on every empty Hero. A DSH release that bumps the notice will not show it.

## Settings (`dshfiles-settings-shell`)

| Key      | Default | Meaning                                                                           |
| -------- | ------- | --------------------------------------------------------------------------------- |
| `openIn` | `auto`  | Where Settings opens: `auto` (a tab when Main tabs is loaded), `tab`, or `modal`. |

Build, test and typecheck with `pnpm build`, `pnpm test` and `pnpm typecheck` from this package.
