import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { MultiHostPanel } from './client.js'
import './client.css'

const panelId = 'dshfiles-multi-host'

const QueryProvidedMultiHostPanel = (): JSX.Element => (
  <PluginQueryProvider>
    <MultiHostPanel />
  </PluginQueryProvider>
)

export default defineClient({
  name: '@dshfiles/multi-host',
  inject: ['slots'],
  setup(ctx, decorate) {
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panelId, order: 3, label: 'Hosts' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId }, decorate(QueryProvidedMultiHostPanel)))
  },
})

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
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="14" width="18" height="6" rx="2" />
    <path d="M7 7.5h.01M7 17h.01m4-9.5h6m-6 9.5h6" />
  </svg>
)
