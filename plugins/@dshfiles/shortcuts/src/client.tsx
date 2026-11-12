import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ShortcutCatalogEntry, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Command, CommandKeys, createSettingsClientRuntime, defineClient, runHostCommand, type Subscribable } from '@dshfiles/dshx/client'
import { CheatSheet, CheatSheetState } from './cheat-sheet.js'
import type { HostShortcutRow } from './cheat-sheet-model.js'
import { CommandBindings } from './command-bindings.js'
import { EditableCommands } from './editable-commands.js'
import { ShortcutLayer, type ShortcutBinding } from './keyboard.js'
import { shortcutsSettings } from './settings.js'

/**
 * The layout service surface this plugin drives.
 *
 * `ILayout` is taken from the Host package rather than restated here: `selectPanel` takes the branded `MainPanelId`,
 * so a hand-written `(panelId: string | null)` widens the parameter and the assignment no longer typechecks.
 */
type Layout = ILayout

const NO_ROWS: readonly HostShortcutRow[] = []

/** The Host registry's catalog rows that have keycaps; the registry is absent on a Host without the shortcuts service. */
const hostRows = (shortcuts: Shortcuts | undefined): Subscribable<readonly HostShortcutRow[]> | undefined => {
  if (shortcuts === undefined) return undefined
  let source: readonly ShortcutCatalogEntry[] | undefined
  let rows: readonly HostShortcutRow[] = NO_ROWS
  return {
    get: () => {
      const snapshot = shortcuts.catalog.getSnapshot()
      if (snapshot === source) return rows
      source = snapshot
      rows = snapshot.flatMap(({ id, label, keys }): HostShortcutRow[] => (keys.length === 0 ? [] : [{ id, label, keys }]))
      return rows
    },
    subscribe: listener => shortcuts.catalog.subscribe(listener),
  }
}

/**
 * Keyboard shortcuts that actually take effect, in layers.
 *
 * The Host's shortcut runtime listens in the bubble phase, and on macOS and Windows it skips DOM dispatch entirely in
 * favour of native input that only an Electron shell provides. Neither path can claim a chord the browser also owns,
 * and the Web registry has no single-key, sequence or `⌥`-letter layer. This installs one capture-phase listener that
 * binds every dshx `Command`'s keys by scope (`keyboard.ts`), plus the `?` sheet that lists them.
 *
 * The command palette (⌘K) and thread search (⌘P) chords belong to @dshfiles/thread-sidebar and the palette, which
 * let users rebind them in Settings; claiming them here too would race them.
 */
export default defineClient({
  name: '@dshfiles/shortcuts',
  // Read through the dshx runtime too: api.commands.keys follows this service's catalog for user rebindings.
  inject: ['shortcuts', 'slots'],
  prefixIds: true,
  setup(ctx, decorate, metadata) {
    // Resolved per key press rather than once at setup. The layout service is registered by another client entry, so
    // reading it during setup can observe an empty context — and `layout?.toggleSidebar()` then no-ops behind optional
    // chaining, which looks exactly like a swallowed chord: claimed, prevented, and silently inert.
    const layout = (): Layout | undefined => ctx.get('layout')
    const settings = createSettingsClientRuntime(ctx).binding(shortcutsSettings).scope
    // An old Host without this namespace reads as unavailable: single keys stay on, the documented default.
    const singleKeys = (): boolean => settings.getSnapshot().value?.singleKeys ?? true
    const panelChord = (id: string, spec: string, label: string): ShortcutBinding | undefined => {
      const keys = CommandKeys.parse(spec)
      if (keys === undefined) return undefined
      return {
        id,
        keys,
        scope: 'global',
        label,
        run: () => {
          // Selecting the conversation panel is the closest the layout service comes to "start something new"; the
          // composer takes it from there.
          requireLayout(layout).selectPanel(null)
        },
      }
    }
    // Cmd/Ctrl+N belongs to the browser on the web (it opens a window); New thread is Mod+Shift+O, owned by the palette.
    const fixed = [panelChord('shortcuts.settings', 'Mod+,', 'Settings')].flatMap(binding => (binding === undefined ? [] : [binding]))
    let commandBindings: readonly ShortcutBinding[] = []
    ctx.effect(() => ShortcutLayer.install(window, { bindings: () => [...commandBindings, ...fixed], singleKeys }), 'shortcuts: keyboard')

    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'shortcut-cheat-sheet', order: 110, label: () => 'Keyboard shortcuts' },
        decorate(() =>
          metadata?.plugin === undefined ? null : (
            <CheatSheet
              keys={metadata.plugin.commands.keys}
              host={hostRows(ctx.get('shortcuts'))}
              // The Host's own editor (Settings › Shortcuts) still rebinds keys; ⌘/ now opens this sheet first.
              customize={() => runHostCommand(ctx.get('shortcuts'), 'shortcuts.open')}
            />
          ),
        ),
      ),
    )

    const plugin = metadata?.plugin
    if (plugin === undefined) return
    plugin.add(Command, {
      id: 'toggle-sidebar',
      title: 'Toggle sidebar',
      keywords: ['sidebar', 'hide', 'show'],
      keys: ['Mod+B'],
      slash: 'sidebar',
      suggested: true,
      run: () => {
        requireLayout(layout).toggleSidebar()
      },
    })
    plugin.add(Command, {
      id: 'cheat-sheet',
      title: 'Keyboard shortcuts',
      keywords: ['shortcuts', 'keys', 'keyboard', 'help', 'cheat sheet', 'hotkeys'],
      keys: ['?', 'Mod+/'],
      run: () => CheatSheetState.toggle(),
    })
    plugin.keyed(plugin.commands.keys, keys => {
      commandBindings = CommandBindings.toBindings(plugin.list(Command).get(), keys)
      return () => {
        commandBindings = []
      }
    })
    plugin.keyed(plugin.list(Command), commands => EditableCommands.register({ shortcuts: ctx.get('shortcuts'), commands }))
  },
})

/**
 * The layout service, or a loud failure.
 *
 * Optional chaining here would turn a missing service into a chord that is claimed and then silently does nothing — the
 * exact symptom that made Cmd+B look broken while the matcher was fine. Throwing names the cause instead.
 */
const requireLayout = (resolve: () => Layout | undefined): Layout => {
  const layout = resolve()
  if (layout === undefined) {
    throw new Error(
      'shortcuts: the layout service is unavailable, so this chord cannot act. The sidebar and panel shortcuts need @deepseek-ai/dsh-client-ui-layout mounted.',
    )
  }
  return layout
}
