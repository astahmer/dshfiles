import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useSettings } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { createWorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { DestinationBar, type DestinationBarServices } from './destination-bar.js'
import { HeroWorkspacePicker } from './hero-workspace-picker.js'
import { LandButton } from './land-button.js'
import { JJ_INTEGRATION_LOCALE_NAMESPACE, jjIntegrationLocale } from './locales.js'
import { ThreadWorkspacesPanel } from './panel.js'
import { jjIntegrationSettings } from './settings.js'
import './client.css'

const PANEL_ID = 'jj-integration'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M6 4v16M18 4v16M6 9h7a4 4 0 0 1 4 4v3" />
    <circle cx="6" cy="4" r="1.6" />
    <circle cx="18" cy="20" r="1.6" />
  </svg>
)

const useBookmark = (): string => useSettings(jjIntegrationSettings).value?.bookmark ?? 'main'

export default defineClient({
  name: '@dshfiles/jj-integration',
  locales: [jjIntegrationLocale],
  inject: ['slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace', 'remote', 'remote.directoryPicker', 'remote.workspace'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(JJ_INTEGRATION_LOCALE_NAMESPACE)
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => translate('title'), locale: JJ_INTEGRATION_LOCALE_NAMESPACE }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: JJ_INTEGRATION_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <ThreadWorkspacesPanel t={props.t} bookmark={useBookmark()} />
          </PluginQueryProvider>
        )),
      ),
    )
    const destinationServices: DestinationBarServices = {
      sessions: ctx.sessions,
      workspaces: ctx.workspaces,
      // SAFETY: every id passed here came back from the Host's workspace registry.
      openWorkspace: workspaceId => ctx.uiWorkspace.openWorkspace(workspaceId as WorkspaceView['workspaceId']),
    }
    const pickerPorts = createWorkspacePickerPorts(ctx.remote)
    ctx.slots.inject('conversation.hero.workspace', () =>
      ctx.slots.register(
        { name: 'conversation.hero.workspace', priority: -1000 },
        decorate((props: EmptyWorkspaceOwnerProps) => (
          <PluginQueryProvider>
            <HeroWorkspacePicker {...props} ports={pickerPorts} t={translate} />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        { name: 'conversation.input.dock', id: 'dshfiles-jj-integration-destination', order: 10, inject: sessionId => ({ sessionId }) },
        decorate((props: { readonly sessionId: Parameters<typeof DestinationBar>[0]['sessionId'] }) => (
          <PluginQueryProvider>
            <DestinationBar sessionId={props.sessionId} services={destinationServices} t={translate} />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'dshfiles-jj-integration-land', order: 39, inject: sessionId => ({ sessionId }) },
        decorate((props: { readonly sessionId: Parameters<typeof LandButton>[0]['sessionId'] }) => (
          <PluginQueryProvider>
            <LandButton sessionId={props.sessionId} sessions={ctx.sessions} t={translate} bookmark={useBookmark()} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
