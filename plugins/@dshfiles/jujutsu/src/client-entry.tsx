import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { JujutsuPanel } from './client.js'

const PANEL_ID = 'dshfiles-jujutsu'

export default defineClient({
  name: '@dshfiles/jujutsu',
  // setup(ctx) reads ctx.slots; declaring it here is what injects that service.
  inject: ['slots'],
  // The panel calls useApi, so the entry must be decorated: a raw component
  // renders outside the API context and its useApi throws while rendering.
  setup(ctx, decorate) {
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: 'Jujutsu' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(JujutsuPanel)))
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
    <path d="M6 4v16M6 7h7m-7 5h9m-9 5h7" />
    <circle cx="6" cy="4" r="2" fill="currentColor" />
    <circle cx="6" cy="12" r="2" fill="currentColor" />
    <circle cx="6" cy="20" r="2" fill="currentColor" />
  </svg>
)
