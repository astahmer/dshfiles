import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'

import { OptmemSettingsPanel } from './settings-panel.tsx'
import './client.css'

const PACKAGE_NAME = '@dshfiles/optmem'

const SettingsView = (): JSX.Element => (
  <PluginQueryProvider>
    <OptmemSettingsPanel />
  </PluginQueryProvider>
)

/**
 * OptMem's list settings (cheap models, fallbacks) need row editors the generic Plugins-page form renders as raw JSON,
 * so one panel serves both seats: the Settings nav and the bundle's own Plugins page, which skips the generic form once a
 * package registers its own `plugins.bundle.config`.
 */
export default defineClient({
  name: PACKAGE_NAME,
  inject: ['slots'],
  setup(ctx, decorate) {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register({ name: 'settings.section', id: 'dshfiles-optmem', order: 45, label: () => 'Memory' }, decorate(SettingsView)),
    )
    ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register(
        { name: 'plugins.bundle.config', key: PACKAGE_NAME },
        decorate((props: { readonly view: 'summary' | 'page' }) => (props.view === 'page' ? <SettingsView /> : null)),
      ),
    )
  },
})
