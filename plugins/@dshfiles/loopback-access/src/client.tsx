import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { NETWORK_LOCALE_NAMESPACE, networkLocale, type NetworkTranslate } from './locales.js'
import { NetworkSection } from './network-section.js'

export default defineClient({
  name: '@dshfiles/loopback-access',
  locales: [networkLocale],
  inject: ['slots'],
  setup(ctx, decorate) {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          registrant: '@dshfiles/loopback-access',
          id: 'dshfiles-network-access',
          order: 35,
          label: () => ctx.locale.bind(NETWORK_LOCALE_NAMESPACE)('networkAccess'),
          locale: NETWORK_LOCALE_NAMESPACE,
        },
        decorate(({ t }: { readonly t: NetworkTranslate }) => (
          <PluginQueryProvider>
            <NetworkSection t={t} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
