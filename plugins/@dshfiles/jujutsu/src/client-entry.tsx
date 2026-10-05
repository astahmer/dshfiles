import type {} from '@deepseek-ai/dsh-client-locale'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { JujutsuPanel } from './client.js'
import { JUJUTSU_LOCALE_NAMESPACE, jujutsuLocale } from './locales.js'

const PANEL_ID = 'dshfiles-jujutsu'
const RIGHT_PANE_ID = '@dshfiles/jujutsu/revision-graph'
const RIGHT_PANE_KIND = 'dshfiles-jujutsu-revision-graph'

export default defineClientPlugin({
  id: PANEL_ID,
  name: '@dshfiles/jujutsu',
  locales: [jujutsuLocale],
  inject: ['sidebarRightTabs'],
  uses: ['ui'],
  setup(api) {
    const translate = api.raw.ctx.locale.bind(JUJUTSU_LOCALE_NAMESPACE)
    api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: () => translate('title'), locale: JUJUTSU_LOCALE_NAMESPACE }, PanelGlyph)
    api.ui.register({ name: 'main', key: PANEL_ID, locale: JUJUTSU_LOCALE_NAMESPACE }, JujutsuPanel)
    api.raw.ctx.effect(
      () =>
        api.raw.ctx.sidebarRightTabs.register({
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
    api.ui.register({ name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID, inject: () => ({ t: translate }) }, JujutsuRightPane)
  },
})

const JujutsuRightPane = (props: Parameters<typeof JujutsuPanel>[0]): JSX.Element => <JujutsuPanel {...props} surface="side-panel" />

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
