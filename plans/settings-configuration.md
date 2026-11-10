# Settings and configuration: what remains

The finished part is documented in the [Settings shell README](../plugins/@dshfiles/settings-shell/README.md): each
row's source (override, profile composition, default, unknown) and inherited value, the Modified / `@modified` filter,
the JSON view of a plugin's overrides (Insert setting, line diagnostics, revision-fenced saves that keep the draft on a
conflict or refusal, read-only Defaults and Effective), and the `settings_inspect`, `plugin_inventory` and
`plugin_set_enabled` Agent tools. The Host cannot say which composition layer set a value or confirm that an owner
applied one: [Host gap 103](dsh-host-gaps.md). No live Host restart is authorized by this plan.

## Open

1. **Feature-control audit.** Inventory significant or opinionated features of the owned plugins and record, per
   feature, its control (setting, Loader row, none), safe default, restart consequence and where it is documented.
   Start with the case that motivated the plan: disabling the DeepSeek model provider leaves the separate account UI
   running; its live request suppression is still unverified until a user restart. Add a switch at the real owner only
   where none exists.
2. **Profile rows in Settings.** The native Plugins page already enables and disables entries, and Agents now have the
   same verb. Still open: explaining a row's owner, dependencies and the marked profile-sync region before a change, and
   showing a pending restart in the UI from the manager's `restart-required` verdict rather than only in the tool
   output. Prove that a change survives `pnpm profile:sync` before promising it.
3. **Cross-links between views.** Opening a field from search or a deep link while the JSON view shows should place
   the caret on that field's line; the Form view currently takes over instead.
4. **Phone and keyboard acceptance.** The JSON view is plain kit controls and the e2e journey runs at desktop width;
   walk it at 390 px and keyboard-only, and refresh the screenshot if the layout changes.
5. **Localized type expectations.** JSON diagnostics name the expected type in English in every locale.

## Not planned

Project or thread scopes, VS Code's precedence rules, a JSON projection of the YAML profile patch, automatic migration
of existing YAML or credentials, and bulk reset. Each needs its own design and authorization.
