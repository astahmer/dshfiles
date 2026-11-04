import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ShareSection } from './share-section.js'

export default defineClient({
  name: '@dshfiles/thread-share',
  inject: ['slots'],
  setup(ctx, decorate) {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          registrant: '@dshfiles/thread-share',
          id: 'dshfiles-thread-share',
          order: 37,
          label: () => 'Thread sharing',
        },
        decorate(() => (
          <PluginQueryProvider>
            <ShareSection />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
