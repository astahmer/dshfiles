import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createApiClient, defineClient, useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { hostDestination, multiHostApi, multiHostQueries, REMOTE_THREAD_PANEL, RemoteComposer } from '@dshfiles/multi-host/destination'
import { PluginQueryProvider, pluginQueryClient, useQuery } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { createWorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { startWorkspaceToggle, type DestinationBarServices } from './destination-bar.js'
import { createComposerWorkspaceNavigation } from './composer-workspace-navigation.js'
import { jjIntegrationApi } from './api.js'
import { HeroWorkspacePicker } from './hero-workspace-picker.js'
import { LandButton } from './land-button.js'
import { JJ_INTEGRATION_LOCALE_NAMESPACE, jjIntegrationLocale } from './locales.js'
import { ThreadWorkspacesPanel } from './panel.js'
import { prepareRemoteFolder } from './remote-destination.js'
import { jjIntegrationSettings } from './settings.js'
import './client.css'

const PANEL_ID = 'jj-integration'
const RIGHT_PANE_ID = '@dshfiles/jj-integration/thread-workspaces'
const RIGHT_PANE_KIND = 'dshfiles-jj-integration-thread-workspaces'

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
  inject: [
    'slots',
    'layout',
    'sessions',
    'workspaces',
    'uiWorkspace',
    'sidebarRight',
    'sidebarRightTabs',
    'conversation',
    'remote',
    'remote.directoryPicker',
    'remote.workspace',
  ],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(JJ_INTEGRATION_LOCALE_NAMESPACE)
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => translate('title'), locale: JJ_INTEGRATION_LOCALE_NAMESPACE },
        PanelGlyph,
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: JJ_INTEGRATION_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <ThreadWorkspacesPanel
              t={props.t}
              bookmark={useBookmark()}
              sessions={ctx.sessions}
              openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)}
            />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: RIGHT_PANE_ID,
          kind: RIGHT_PANE_KIND,
          title: () => translate('title'),
          guide: [
            {
              id: 'thread-workspaces',
              order: 47,
              title: () => translate('title'),
              description: () => translate('sidePanelGuide'),
              icon: PanelGlyph,
            },
          ],
        }),
      'jj-integration: right pane tab type',
    )
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID, locale: JJ_INTEGRATION_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <ThreadWorkspacesPanel
              t={props.t}
              bookmark={useBookmark()}
              sessions={ctx.sessions}
              openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)}
            />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'dshfiles-jj-integration-thread-workspaces', order: 38 },
        decorate(() => (
          <span className="dshx-root dshx:inline-flex">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={translate('openSidePanel')}
              title={translate('openSidePanel')}
              onClick={() => ctx.sidebarRight.openTab(RIGHT_PANE_KIND, { revealIfOpened: true })}
            >
              <PanelGlyph size={16} />
            </Button>
          </span>
        )),
      ),
    )
    // SAFETY: The multi-host panel id is registered by @dshfiles/multi-host.
    const openRemoteThreadPanel = (): void => ctx.layout.selectPanel(REMOTE_THREAD_PANEL as MainPanelId)
    const RemoteComposerBar = (): JSX.Element | null => {
      const multiHost = useApi(multiHostApi)
      const destination = hostDestination.useValue()
      const directory = useQuery(multiHostQueries.directory(multiHost))
      if (destination.kind !== 'runtime') return null
      const runtime = directory.data?.runtimes.find(item => item.id === destination.runtimeId)
      return (
        <RemoteComposer
          api={multiHost}
          runtimeId={destination.runtimeId}
          hostName={directory.data?.hosts.find(host => host.id === runtime?.hostId)?.name ?? runtime?.name ?? 'Remote host'}
          cwd={destination.folder}
          prepareCwd={() => prepareRemoteFolder(multiHost, destination)}
          onStarted={openRemoteThreadPanel}
        />
      )
    }
    const composerNavigation = createComposerWorkspaceNavigation({
      selectedWorkspace: () => {
        const sessions = ctx.sessions.list.getSnapshot()
        const current = sessions.ids.find(id => (sessions.byId[id]?.retainedBy.mainView ?? 0) > 0)
        return ctx.workspaces.list.getSnapshot().items.find(workspace => current !== undefined && workspace.sessionIds.includes(current))?.workspaceId
      },
      subscribe: listener => {
        const unsubscribeSessions = ctx.sessions.list.subscribe(listener)
        const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(listener)
        return () => {
          unsubscribeSessions()
          unsubscribeWorkspaces()
        }
      },
    })
    const destinationServices: DestinationBarServices = {
      workspaces: ctx.workspaces,
      sessions: ctx.sessions,
      blocks: ctx.conversation.blocks,
      openWorkspace: composerNavigation.open,
      bindWorkspacePicker: composerNavigation.bind,
      // A blank thread's composer would create a Session on this machine; while a remote host is chosen it sends there.
      takeOverComposer: () =>
        ctx.slots.register(
          { name: 'conversation.composer.bar', priority: -100 },
          decorate(() => (
            <PluginQueryProvider>
              <RemoteComposerBar />
            </PluginQueryProvider>
          )),
        ),
    }
    const jjThreads = createApiClient(ctx, jjIntegrationApi)
    const ThreadRebaseNotice = (props: { readonly sessionId: SessionSummary['id'] }): JSX.Element | null => {
      const api = useApi(jjIntegrationApi)
      const session = ctx.sessions.list.getSnapshot().byId[props.sessionId]
      const path = session?.cwd
      const status = useQuery({
        queryKey: ['jj-integration', 'thread', path],
        enabled: path !== undefined,
        retry: false,
        queryFn: ({ signal }) =>
          path === undefined
            ? Promise.resolve({ thread: null })
            : runHostRequest({ signal, timeoutMs: 15_000, request: hostSignal => api.threadAt({ path }, { signal: hostSignal }) }).catch(() => ({
                thread: null,
              })),
      })
      const bookmark = useBookmark()
      const rebasedAt = status.data?.thread?.rebasedAt
      if (rebasedAt === undefined || rebasedAt === null) return null
      return (
        <div
          data-testid="jj-thread-rebased-notice"
          className="dshx-root dshx:mx-auto dshx:my-3 dshx:flex dshx:max-w-3xl dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:bg-muted/40 dshx:px-3 dshx:py-2 dshx:text-sm dshx:text-muted-foreground"
        >
          <span className="dshx:min-w-0 dshx:flex-1">{translate('rebaseNotice', { bookmark })}</span>
          <time className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums" dateTime={new Date(rebasedAt).toISOString()}>
            {new Date(rebasedAt).toLocaleString()}
          </time>
        </div>
      )
    }
    ctx.slots.inject('conversation.chat.turnTail', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.turnTail',
          id: 'dshfiles-jj-integration-rebased-notice',
          order: 1,
          inject: sessionId => ({ sessionId: SessionId(sessionId) }),
        },
        decorate((props: { readonly sessionId: SessionSummary['id'] }) => (
          <PluginQueryProvider>
            <ThreadRebaseNotice sessionId={props.sessionId} />
          </PluginQueryProvider>
        )),
      ),
    )
    const workspaceToggle = startWorkspaceToggle({
      provision: (input, options) => jjThreads.provision(input, options),
      services: destinationServices,
      t: translate,
      queryClient: pluginQueryClient(),
    })
    ctx.effect(() => () => workspaceToggle.stop(), 'jj-integration: workspace toggle')
    const pickerPorts = createWorkspacePickerPorts(ctx.remote)
    ctx.slots.inject('conversation.hero.workspace', () =>
      ctx.slots.register(
        { name: 'conversation.hero.workspace', priority: -1000 },
        decorate((props: EmptyWorkspaceOwnerProps) => (
          <PluginQueryProvider>
            <HeroWorkspacePicker {...props} ports={pickerPorts} services={destinationServices} toggle={workspaceToggle} t={translate} />
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
