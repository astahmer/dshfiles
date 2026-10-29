import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Command, defineClient, type CommandItem } from '@dshfiles/dshx/client'
import { EditableCommands } from './editable-commands.js'
import { installShortcuts, ShortcutKeyboardModel, type Shortcut } from './keyboard.js'

/**
 * The layout service surface this plugin drives.
 *
 * `ILayout` is taken from the Host package rather than restated here: `selectPanel`
 * takes the branded `MainPanelId`, so a hand-written `(panelId: string | null)`
 * widens the parameter and the assignment no longer typechecks.
 */
type Layout = ILayout

/**
 * Keyboard shortcuts that actually take effect.
 *
 * The Host's shortcut runtime listens in the bubble phase, and on macOS and
 * Windows it skips DOM dispatch entirely in favour of native input that only an
 * Electron shell provides. Neither path can claim a chord the browser also owns,
 * which is why `primary+p` prints instead of searching. This installs one
 * capture-phase listener, which runs first and can.
 *
 * It is a plugin rather than desktop-only code so the same chords work in the
 * browser, in an installed PWA, and in the desktop shell.
 *
 * The command palette (⌘K) and thread search (⌘P) chords belong to
 * @dshfiles/thread-sidebar, which owns the palette and lets users rebind them in
 * Settings › Plugins › Thread sidebar; claiming them here too would race it.
 */
export default defineClient({
  name: '@dshfiles/shortcuts',
  // Read through the dshx runtime too: api.commands.keys follows this service's catalog for user rebindings.
  inject: ['shortcuts'],
  prefixIds: true,
  setup(ctx, _decorate, metadata) {
    // Resolved per key press rather than once at setup. The layout service is
    // registered by another client entry, so reading it during setup can observe
    // an empty context — and `layout?.toggleSidebar()` then no-ops behind optional
    // chaining, which looks exactly like a swallowed chord: claimed, prevented, and
    // silently inert. Looking it up when the chord fires cannot be too early.
    const layout = (): Layout | undefined => ctx.get('layout')
    const shortcuts: Shortcut[] = [
      {
        id: 'shortcuts.newSession',
        key: 'KeyN',
        modifier: 'primary',
        allowInEditable: true,
        label: 'New session',
        run: () => {
          // Selecting the conversation panel is the closest the layout service
          // comes to "start something new"; the composer takes it from there.
          requireLayout(layout).selectPanel(null)
        },
      },
      {
        id: 'shortcuts.settings',
        key: 'Comma',
        modifier: 'primary',
        allowInEditable: true,
        label: 'Settings',
        run: () => {
          requireLayout(layout).selectPanel(null)
        },
      },
    ]

    ctx.effect(() => installShortcuts(window, shortcuts), 'shortcuts: keyboard')

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
    plugin.keyed(plugin.commands.keys, keys => installShortcuts(window, commandShortcuts(plugin.list(Command).get(), keys)))
    plugin.keyed(plugin.list(Command), commands => EditableCommands.register({ shortcuts: ctx.get('shortcuts'), commands }))
  },
})

/**
 * Bind the keys every contributed command answers to now: its defaults, or the user's binding when it is editable.
 *
 * A command's keys stay unbound when they need a modifier other than primary
 * and shift, because only those chords can be claimed safely.
 */
const commandShortcuts = (commands: readonly CommandItem[], keys: ReadonlyMap<string, readonly string[]>): Shortcut[] =>
  commands.flatMap(command =>
    (keys.get(command.id) ?? command.keys ?? []).flatMap(chord => {
      const parsed = ShortcutKeyboardModel.parseChord(chord)
      if (parsed === undefined) {
        console.warn(`shortcuts: ${command.id} keeps ${chord} unbound; only primary (+ shift) chords can be claimed.`)
        return []
      }
      return [
        {
          id: command.id,
          key: parsed.key,
          modifier: 'primary' as const,
          alsoShift: parsed.alsoShift,
          allowInEditable: command.scope !== 'page',
          label: command.title,
          run: () => {
            if (command.enabled === false) return false
            const result = command.run()
            if (result === false) return false
            if (result instanceof Promise) result.catch((error: unknown) => console.error(`shortcuts: ${command.id} failed`, error))
          },
        },
      ]
    }),
  )

/**
 * The layout service, or a loud failure.
 *
 * Optional chaining here would turn a missing service into a chord that is
 * claimed and then silently does nothing — the exact symptom that made Cmd+B look
 * broken while the matcher was fine. Throwing names the cause instead.
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
