import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/client/index.js'
import { SettingsStatusStrip } from './native/client/StatusStrip.tsx'
import { STATUS_BAR_SECTION_ID } from './status-bar.ts'
import { StatusBarSettings } from './status-bar-settings.tsx'
// Type-only: puts the `shell.dock` seat declaration in this program.
import type {} from './regions.js'

export default defineClient({
  name: '@dshfiles/frame-layout',
  inject,
  setup(ctx, decorate) {
    apply(ctx, decorate(SettingsStatusStrip))
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        { name: 'settings.section', registrant: '@dshfiles/frame-layout', id: STATUS_BAR_SECTION_ID, order: 45, label: () => 'Status bar' },
        decorate(StatusBarSettings),
      ),
    )
  },
})
