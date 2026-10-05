import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { JujutsuPanel } from './client.js'

const PANEL_ID = 'dshfiles-jujutsu'
const RIGHT_PANE_ID = '@dshfiles/jujutsu/revision-graph'
const RIGHT_PANE_KIND = 'dshfiles-jujutsu-revision-graph'

export default defineClient({
  name: '@dshfiles/jujutsu',
  // setup(ctx) reads ctx.slots; declaring it here is what injects that service.
  inject: ['slots', 'sidebarRightTabs'],
  // The panel calls useApi, so the entry must be decorated: a raw component
  // renders outside the API context and its useApi throws while rendering.
  setup(ctx, decorate) {
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: 'Jujutsu' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(MainJujutsuSlot)))
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: RIGHT_PANE_ID,
          kind: RIGHT_PANE_KIND,
          title: () => 'Jujutsu',
          guide: [
            {
              id: 'revision-graph',
              order: 40,
              title: () => 'Jujutsu',
              description: () => 'Browse the revision graph and working copy.',
              icon: PanelGlyph,
            },
          ],
        }),
      'dshfiles-jujutsu: right pane tab type',
    )
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID }, decorate(JujutsuRightPane)),
    )
  },
})

const MainJujutsuSlot = (): JSX.Element => (
  <PluginQueryProvider>
    <JujutsuPanel surface="main" />
  </PluginQueryProvider>
)

const JujutsuRightPane = (): JSX.Element => (
  <PluginQueryProvider>
    <JujutsuPanel surface="side-panel" />
  </PluginQueryProvider>
)

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <path d="M6 4v16M6 7h7m-7 5h9m-9 5h7" />
    <circle cx="6" cy="4" r="2" fill="currentColor" />
    <circle cx="6" cy="12" r="2" fill="currentColor" />
    <circle cx="6" cy="20" r="2" fill="currentColor" />
  </svg>
)
