import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { BookOpenIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { DestinationSections } from '@dshfiles/thread-sidebar/destinations'
import { PluginGuidePanel } from './guide-panel.js'

const PANEL_ID = 'dshfiles-plugin-guide'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => <BookOpenIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />

export default defineClient({
  name: '@dshfiles/plugin-guide',
  inject: ['slots', 'uiWorkspace'],
  setup(ctx, decorate, metadata) {
    // A developer page: Settings lists it after Plugins; without the rail it stays a plain sidebar page.
    metadata?.plugin?.add(DestinationSections, {
      panelId: PANEL_ID,
      destination: 'settings',
      label: 'Plugin guide',
      description: 'Where a plugin can extend DSH, for plugin authors.',
      order: 5,
    })
    // A new thread whose composer holds the guidance; the user reads and sends it, never this page.
    const draftForAgent = (text: string): void => ctx.uiWorkspace.startSession(undefined, { prompt: text })

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 8, label: () => 'Plugin guide' }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <PluginGuidePanel draftForAgent={draftForAgent} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
