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

### Search

One field at the top of Settings searches every setting the shell can draw: their titles, descriptions and key paths
(`thread sidebar children` finds `maxChildren` on the Thread Sidebar page), plus the names of native sections. Every
word must match; accents and case are ignored; hidden and secret fields never match. Results replace the section as a
flat list grouped by page, with matches highlighted, editable in place, and a count ("6 Settings Found"). The tree
stays visible with a match count per entry; picking an entry with matches scrolls to its results. `Escape` clears the
query before it closes the dialog. Native sections draw their own rows, so a match on a section's name offers to open
it; the namespaces behind native rows (theme, language, …) are searchable under _More settings_.

This replaces `@dshfiles/settings-search`, which was **folded** in: its popup under the navigation and its separate
search section are gone, and the schema walking and ranking it did now live in `src/schema-form/schema-model.ts` and
`src/settings-search.ts`.

### Plugin settings

Every settings namespace with a visible field gets a page under **Plugins** in the Settings navigation (namespaces
whose plugin draws its own native page sit under **More settings**), titled by its bundle's manifest, then its schema,
then its id. The same renderer draws each dshx plugin's settings on its **Plugins** page detail, through dshx's
settings page renderer seat (`provideSettingsPageRenderer`); without this plugin the built-in dshx form shows.

Fields come from the serialized schemastery schema (`src/schema-form/schema-model.ts`): the title is the field's label
or its humanized key, the description its `.description()` (localized descriptions follow the active language). Hidden
and secret fields never show. Controls by type:

| Schema                                   | Control                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `boolean`                                | switch                                                                          |
| union of constants                       | segmented buttons (≤ 4 short labels) or a select; `"Label: explanation"` splits |
| `number`, `natural`, `percent`           | number input with bounds and a unit read from the key (`…Ms`, `…Minutes`, …, %) |
| `string` (`role('textarea')`: multiline) | text input                                                                      |
| array of scalars                         | list editor (add, edit, remove rows)                                            |
| dict of scalars                          | key/value editor                                                                |
| nested object                            | its fields, under a group heading                                               |
| anything else                            | JSON, saved only when it parses                                                 |

Edits save at once (switches, choices) or on Enter/blur (text, numbers) through the shared `ConfigForm`, the store
native rows and `useSettings` read, so every surface stays in step. A Host write takes seconds (it persists the profile
and reloads the entry), so a row shows the requested value until the write settles; a refused value shows under its
row.

**Modified settings** carry a thin bar on their left, as in VS Code: the field is set in the user layer (an override
equal to the default still counts, as natively). Hovering or focusing the row shows **Reset to default**, which unsets
the override so the field re-inherits the composition default. A deep link to a field scrolls it into view and
highlights it for two seconds.

### Configuration file

On a loopback browser whose Host keeps a settings document (the profile's `cordis.patch.yml`), the header shows
**Open configuration file** as a split button, like the thread header's open-in control. The button keeps the native
action: the Host opens the document in its text editor, creating it if absent. **▾** offers:

- **Open with** each app the desktop associates with the file (icons and the default from the Session Remote's path
  opener, the service behind the native open-in controls; their component is not exported, so the menu is drawn here);
- **Editor (in DSH)** when `@dshfiles/editor` is loaded, through its `dshfiles:open-file` request (it needs a thread
  to open files in);
- **Copy path**, and **Reveal in Finder** (_Show in folder_ elsewhere).

The path comes from this plugin's Host (`settings-shell.documentPath`, the settings provider's `documentPath`,
canonicalized). Until the document exists only the path can be copied. Remote browsers get neither action nor path.

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

- `src/upstream-version.test.ts` fails when the workspace's DSH packages move past that version (or past the welcome
  notice's, below);
- the Host logs `settings-shell: ported from … but DSH ships …` at boot when the running DSH resolves another version,
  and the General section's version row shows the running one.

To refresh: diff the new `lib/client.js` of the native package against 0.2.0-rc.2, port the changes into
`src/native/`, then bump `PORTED_FROM`.

Deliberate differences from upstream:

- Styles are `dshx:` utilities instead of CSS modules (one shared plugin stylesheet).
- Dictionaries live under `dshfiles.settings-shell`; dshx reserves the native `settings` namespace.
- The native welcome notice (`@deepseek-ai/dsh-client-ui-settings-models` 0.2.0-rc.2) keeps its acknowledgement in
  the `ui-settings-general` namespace, which only the switched-off native row serves, and a Loader patch cannot give
  this row that id. So the step is ported too (`src/native/welcome-notice.tsx`): it shadows the `welcome-notice`
  onboarding entry and stores `welcomeNoticeVersion` in `dshfiles-settings-shell`. Someone who acknowledged the native
  notice sees it once more after switching. Its version is checked like the shell's.

## Settings (`dshfiles-settings-shell`)

| Key      | Default | Meaning                                                                           |
| -------- | ------- | --------------------------------------------------------------------------------- |
| `openIn` | `auto`  | Where Settings opens: `auto` (a tab when Main tabs is loaded), `tab`, or `modal`. |

Build, test and typecheck with `pnpm build`, `pnpm test` and `pnpm typecheck` from this package.
