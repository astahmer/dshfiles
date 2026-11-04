import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ProcessViews } from '@dshfiles/background-jobs/process-views'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { DevServersChip } from './dev-servers-chip.js'
import { DevServerViews } from './dev-servers-view.js'

export default defineClient({
  name: '@dshfiles/preview',
  inject: ['slots'],
  setup(ctx, decorate, metadata) {
    // Dev servers are a tab of Observe › Processes and part of the thread panel's Jobs facet (plans/ade-ux §6); the
    // header chip stays the quick view on the thread itself.
    const plugin = metadata?.plugin
    if (plugin !== undefined) {
      const Tab = (props: Parameters<typeof DevServerViews.Tab>[0]): JSX.Element => (
        <PluginQueryProvider>
          <DevServerViews.Tab {...props} />
        </PluginQueryProvider>
      )
      const Thread = (props: Parameters<typeof DevServerViews.Thread>[0]): JSX.Element => (
        <PluginQueryProvider>
          <DevServerViews.Thread {...props} />
        </PluginQueryProvider>
      )
      plugin.add(ProcessViews, { id: 'dev-servers', label: 'Dev servers', order: 10, Page: plugin.bind(Tab), Thread: plugin.bind(Thread) })
    }
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'dshfiles-preview-dev-servers', order: 20 },
        decorate(props => (
          <PluginQueryProvider>
            <DevServersChip sessionId={props.sessionId} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
