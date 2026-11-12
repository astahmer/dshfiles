import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

/**
 * Shortcut preferences. One switch turns every character-key shortcut off (J, E, ?, G then I), as WCAG 2.1.4 asks:
 * someone using speech input or a single switch would otherwise trigger them by accident. Chords that hold ⌘ or Ctrl
 * stay on. The namespace equals the Loader row id; an agent changes it through `settings_set` (`dshfiles-shortcuts`).
 */
export const shortcutsSettings = defineSettings({
  namespace: 'dshfiles-shortcuts',
  schema: Schema.object({
    singleKeys: Schema.boolean()
      .default(true)
      .description('Single-key shortcuts: keys without ⌘ or Ctrl (J and K to move, E for Done, ? for the shortcut sheet). They never fire while you type.'),
  }),
  applies: 'live',
})

export type ShortcutsSettings = ReturnType<typeof shortcutsSettings.schema>
