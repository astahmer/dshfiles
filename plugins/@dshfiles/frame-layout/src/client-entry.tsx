import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Command, defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/client/index.js'
import { SettingsStatusStrip } from './native/client/StatusStrip.tsx'
import { STATUS_BAR_SECTION_ID } from './status-bar.ts'
import { StatusBarSettings } from './status-bar-settings.tsx'
import { ZenMode } from './zen-mode.ts'
// Type-only: puts the `shell.dock` seat declaration in this program.
import type {} from './regions.js'

export default defineClient({
  name: '@dshfiles/frame-layout',
  inject,
  setup(ctx, decorate, metadata) {
    const zen = ZenMode.create()
    apply(ctx, decorate(SettingsStatusStrip), zen)
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        { name: 'settings.section', registrant: '@dshfiles/frame-layout', id: STATUS_BAR_SECTION_ID, order: 45, label: () => 'Status bar' },
        decorate(StatusBarSettings),
      ),
    )
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    plugin.add(Command, {
      id: '@dshfiles/frame-layout.zen-mode',
      title: 'Zen mode',
      description: 'Show only the thread and its composer',
      keywords: ['zen', 'focus', 'distraction free', 'hide sidebar', 'hide panels', 'leave zen'],
      keys: ZenMode.keys,
      run: () => zen.set(!zen.on()),
    })
    // Escape leaves zen only when nothing else wants it: a text field (the composer's stop), a menu or a dialog keeps it.
    plugin.add(Command, {
      id: '@dshfiles/frame-layout.leave-zen',
      title: 'Leave zen mode',
      keys: ['Escape'],
      scope: 'page',
      hidden: true,
      run: () => {
        if (!zen.on()) return false
        zen.set(false)
      },
    })
  },
})
