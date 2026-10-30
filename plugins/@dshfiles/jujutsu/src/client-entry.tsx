import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Changes, defineClient, useApi } from '@dshfiles/dshx/client'
// Type-only: `ctx.rightPanel`, the frame's right-column seat.
import type {} from '@dshfiles/frame-layout/regions'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { keepPreviousData, PluginQueryProvider, pluginQueryClient, useQuery } from '@dshfiles/plugin-ui/query'
import type { DirectoryPickerPort, RegisteredProject } from '@dshfiles/project-folder-picker'
import { workbenchPanels, NativeAsideOwners, type WorkbenchPanelProps } from '@dshfiles/workbench/registry'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { ChatReferenceOverlay } from './chat-reference-overlay.js'
import { sessionProjectPath } from './session-project-path.js'
import { JujutsuPanel } from './client.js'
import { ComposerChangesBar, ComposerChips, ConversationHeaderToggle, type ComposerJujutsuServices, type ComposerSlotProps } from './composer-context.js'
import { DEFAULT_PANEL_SCOPE, DOCK_PANEL_SCOPE, PanelScopes, useActiveJujutsuScope } from './panel-scope.js'
import { sidePanelRepository } from './side-panel-repository.js'
import { SurfaceVisibility } from './surface-visibility.js'
import './client.css'

const PANEL_ID = 'dshfiles-jujutsu'
const SOURCE_CONTROL_PANEL_ID = 'dshfiles-jujutsu-source-control'
const RIGHT_PANE_ID = '@dshfiles/jujutsu/revision-graph'
const RIGHT_PANE_KIND = 'dshfiles-jujutsu-revision-graph'
/** The workbench panel id the global dock opens by default. */
const DOCK_PANEL_ID = 'dshfiles-jujutsu.dock'
const SOURCE_CONTROL_DOCK_PANEL_ID = 'dshfiles-jujutsu.source-control'
/** `@dshfiles/main-tabs` asks this for the graph's right-pane view when its main tab is dropped there. */
const PANEL_ASIDE_EVENT = 'dshfiles:move-panel-aside'
const panelAsideRequestSchema = z.object({ panelId: z.string().min(1) }).strict()

export default defineClient({
  name: '@dshfiles/jujutsu',
  // setup(ctx) reads ctx.slots; declaring it here is what injects that service.
  inject: ['slots', 'layout', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'uiWorkspace', 'workspaces', 'shortcuts'],
  // The panel calls useApi, so the entry must be decorated: a raw component
  // renders outside the API context and its useApi throws while rendering.
  setup(ctx, decorate, metadata) {
    const directoryPicker: DirectoryPickerPort = {
      pick: () => ctx.uiWorkspace.pickDirectory(),
      list: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
      createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
    }
    const registerWorkspace = async (canonicalPath: string): Promise<RegisteredProject> => {
      const workspace = await ctx.workspaces.create({ path: canonicalPath })
      return { workspaceId: workspace.workspaceId, title: workspace.title, canonicalPath: workspace.path }
    }
    const panel = (options: SurfacePanelOptions): JSX.Element => (
      <PluginQueryProvider>
        <ProjectsBoundPanel
          workspaces={ctx.workspaces}
          // Remounting per scope is what gives each tab, thread or the dock its own state; the scope's state outlives it.
          key={options.scope}
          scope={options.scope}
          defaultPath={options.defaultPath ?? null}
          surface={options.surface}
          visible={options.visible ?? true}
          {...(options.view === undefined ? {} : { view: options.view })}
          directoryPicker={directoryPicker}
          registerWorkspace={registerWorkspace}
          // A Session whose folder is not a registered workspace lands in "Ungrouped" with its composer locked, so
          // the new JJ workspace is registered and opened the way the native folder picker opens one.
          launchSession={async cwd => {
            const workspace = await ctx.workspaces.create({ path: cwd })
            await ctx.uiWorkspace.openWorkspace(workspace.workspaceId)
          }}
        />
      </PluginQueryProvider>
    )
    const useMountedSession = (): MountedPanelScope => {
      const subscribeMounted = useCallback((listener: () => void) => ctx.sidebarRight.mounted.subscribe(listener), [])
      const subscribeSessions = useCallback((listener: () => void) => ctx.sessions.list.subscribe(listener), [])
      const onScreen = useSyncExternalStore(subscribeMounted, () => ctx.sidebarRight.mounted.getSnapshot(), noSession)
      // A global panel in the main view unsets the on-screen Session; the side panel still belongs to the last thread.
      const lastSession = useRef<SessionId | undefined>(undefined)
      useEffect(() => {
        if (onScreen !== undefined) lastSession.current = onScreen
      }, [onScreen])
      const sessionId = onScreen ?? lastSession.current
      const sessionsById = useSyncExternalStore(
        subscribeSessions,
        () => ctx.sessions.list.getSnapshot().byId,
        () => ({}),
      )
      const subscribeWorkspaces = useCallback((listener: () => void) => ctx.workspaces.list.subscribe(listener), [])
      const workspaces = useSyncExternalStore(
        subscribeWorkspaces,
        () => ctx.workspaces.list.getSnapshot().items,
        () => [],
      )
      const defaultPath = sessionId === undefined ? undefined : sessionProjectPath(sessionId, sessionsById, workspaces)
      return {
        scope: sessionId === undefined ? DEFAULT_PANEL_SCOPE : PanelScopes.thread(sessionId),
        defaultPath: defaultPath === undefined || defaultPath.length === 0 ? null : defaultPath,
      }
    }
    const MainSurfacePanel = decorate((props: PropsRuntime<'main'>) => {
      const scope = useActiveJujutsuScope()
      const visible = SurfaceVisibility.useMainPanelVisible({ usePanelInfo: props.usePanelInfo, panelId: PANEL_ID })
      return panel({ surface: 'main', scope, visible, view: 'graph' })
    })
    const MainSourceControlPanel = decorate((props: PropsRuntime<'main'>) => {
      const visible = SurfaceVisibility.useMainPanelVisible({ usePanelInfo: props.usePanelInfo, panelId: SOURCE_CONTROL_PANEL_ID })
      return panel({ surface: 'main', scope: DEFAULT_PANEL_SCOPE, visible, view: 'source' })
    })
    const SideSurfacePanel = decorate((props: PropsRuntime<'sidebar.right.pane.tab'>) => {
      const target = useMountedSession()
      const visible = SurfaceVisibility.useSideTabVisible(props.useTabInfo)
      return panel({ surface: 'side-panel', scope: target.scope, defaultPath: target.defaultPath, visible })
    })
    const DockSurfacePanel = decorate((props: WorkbenchPanelProps) =>
      panel({ surface: 'dock', scope: DOCK_PANEL_SCOPE, visible: props.visible, view: 'graph' }),
    )
    const DockSourceControlPanel = decorate((props: WorkbenchPanelProps) =>
      panel({ surface: 'dock', scope: DOCK_PANEL_SCOPE, visible: props.visible, view: 'source' }),
    )
    const ScopedWorkbenchPanel = decorate((props: WorkbenchPanelProps & { readonly scope: string }) =>
      panel({ surface: 'main', scope: props.scope, visible: props.visible, view: 'graph' }),
    )
    ctx.effect(() => PanelScopes.listen(), 'dshfiles-jujutsu: the scope each main tab shows')
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: 'Jujutsu: Revision graph' }, PanelGlyph),
    )
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: SOURCE_CONTROL_PANEL_ID, order: 3, label: 'Jujutsu: Source Control' }, SourceControlGlyph),
    )
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
    // Another plugin that rewrote the repository (jj-integration's rebase) announces it, so the changes card and chips do not wait for the next poll.
    ctx.effect(() => {
      const refresh = (): void => void pluginQueryClient().invalidateQueries({ queryKey: ['jujutsu'] })
      window.addEventListener('dshfiles:jj-changed', refresh)
      return () => window.removeEventListener('dshfiles:jj-changed', refresh)
    }, 'dshfiles-jujutsu: refresh after another plugin changes the repository')
    // Older Hosts lack active(); without it the toggle only ever opens.
    const toggleJujutsu = (path: string | null): void => {
      // While the global dock owns the right column, the panel to reveal is the
      // dock's own — the per-thread surface is not drawn, so driving it would
      // land nowhere.
      if (ctx.get('rightPanel')?.mode() === 'dock') {
        if (path !== null) sidePanelRepository.request({ path })
        workbenchPanels().open(DOCK_PANEL_ID)
        return
      }
      const sidebar = ctx.sidebarRight
      const side = metadata?.plugin?.layout.side
      const showingJujutsu = side?.expanded.get() === true && typeof sidebar.active === 'function' && sidebar.active()?.kind === RIGHT_PANE_KIND
      if (showingJujutsu && (path === null || sidePanelRepository.isShowing(path)) && side.hide()) return
      if (path !== null) sidePanelRepository.request({ path })
      sidebar.openTab(RIGHT_PANE_KIND)
    }
    const composerServices: ComposerJujutsuServices = {
      sessions: ctx.sessions,
      workspaces: ctx.workspaces,
      toggleJujutsu,
      openWorkspaceReview: (workspacePath, sessionId) => {
        const changes = metadata?.plugin?.use(Changes).get()
        if (changes?.status === 'active') changes.value.review({ workspacePath, sessionId })
      },
      openJujutsuReference: (path, reference) => {
        sidePanelRepository.request({ path, reference })
        ctx.sidebarRight.openTab(RIGHT_PANE_KIND)
      },
    }
    const composerSlot = (Component: (props: ComposerSlotProps) => JSX.Element | null) =>
      decorate((props: ComposerSlotProps) => (
        <PluginQueryProvider>
          <Component {...props} />
        </PluginQueryProvider>
      ))
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        { name: 'conversation.input.dock', id: 'dshfiles-jujutsu-changes', order: 40, inject: sessionId => ({ sessionId, jujutsu: composerServices }) },
        composerSlot(ComposerChangesBar),
      ),
    )
    ctx.slots.inject('conversation.composer.dock', () =>
      ctx.slots.register(
        { name: 'conversation.composer.dock', id: 'dshfiles-jujutsu-chips', order: 40, inject: sessionId => ({ sessionId, jujutsu: composerServices }) },
        composerSlot(ComposerChips),
      ),
    )
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'dshfiles-jujutsu-toggle',
          order: 40,
          inject: sessionId => ({ sessionId, jujutsu: composerServices }),
        },
        composerSlot(props => <ConversationHeaderToggle {...props} icon={<PanelGlyph size={16} />} />),
      ),
    )
    const currentSessionCwd = (): string | null => {
      const sessionId = ctx.sidebarRight.mounted.getSnapshot()
      const cwd = sessionId === undefined ? undefined : ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      return cwd === undefined || cwd.length === 0 ? null : cwd
    }
    // No default chord: it is listed under Settings › Shortcuts (and the desktop menu) for the user to bind.
    ctx.effect(() => {
      try {
        return ctx.shortcuts.register({
          id: 'jujutsu.toggleSessionRepository',
          label: () => 'Toggle Jujutsu on this thread’s repository',
          aliases: ['jj', 'jujutsu', 'source control', 'revision graph', 'toggle jujutsu panel'],
          defaults: {},
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => {
            const cwd = currentSessionCwd()
            return cwd === null ? { status: 'blocked', reason: 'No thread with a folder is on screen.' } : { status: 'handled', run: () => toggleJujutsu(cwd) }
          },
        })
      } catch (error) {
        console.warn('dshfiles-jujutsu: the toggle command could not be registered', error)
        return () => undefined
      }
    }, 'dshfiles-jujutsu: toggle command')
    const ReferenceOverlay = (): JSX.Element => {
      const subscribeSessions = useCallback((listener: () => void) => ctx.sessions.list.subscribe(listener), [])
      const sessionsById = useSyncExternalStore(
        subscribeSessions,
        () => ctx.sessions.list.getSnapshot().byId,
        () => ({}),
      )
      const subscribeWorkspaces = useCallback((listener: () => void) => ctx.workspaces.list.subscribe(listener), [])
      const workspaces = useSyncExternalStore(
        subscribeWorkspaces,
        () => ctx.workspaces.list.getSnapshot().items,
        () => [],
      )
      return <ChatReferenceOverlay projectPathForSession={sessionId => sessionProjectPath(sessionId, sessionsById, workspaces)} />
    }
    // One overlay serves every message: a chat reference is a native `<code>` node, so the request arrives as an event.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-jujutsu-reference-preview', order: 60 },
        decorate(() => (
          <PluginQueryProvider>
            <ReferenceOverlay />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, MainSurfacePanel))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SOURCE_CONTROL_PANEL_ID }, MainSourceControlPanel))
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID }, SideSurfacePanel))
    // The graph is one panel with two homes: a main tab and a right-pane tab. Moving between them is this plugin's
    // business, so it answers the strip's request and offers the reverse row on its own right-pane tab.
    const isMainPanel = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)
    const openNativeAside = (): boolean => {
      if (ctx.sidebarRight.mounted.getSnapshot() === undefined) return false
      ctx.sidebarRight.openTab(RIGHT_PANE_KIND, { revealIfOpened: true })
      return true
    }
    ctx.effect(() => NativeAsideOwners.register(PANEL_ID, openNativeAside), 'dshfiles-jujutsu: native aside authority')
    ctx.effect(() => {
      const onMovePanelAside = (event: Event): void => {
        if (!(event instanceof CustomEvent) || event.defaultPrevented) return
        const request = panelAsideRequestSchema.safeParse(event.detail)
        if (!request.success || request.data.panelId !== PANEL_ID) return
        if (openNativeAside()) event.preventDefault()
      }
      window.addEventListener(PANEL_ASIDE_EVENT, onMovePanelAside)
      return () => window.removeEventListener(PANEL_ASIDE_EVENT, onMovePanelAside)
    }, 'dshfiles-jujutsu: move the panel into the side panel')
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.tab.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.right.tab.menu.item', id: 'dshfiles-jujutsu-move-to-main', order: 10 },
            (props: PropsRuntime<'sidebar.right.tab.menu.item'>) => {
              if (props.tab.kind !== RIGHT_PANE_KIND) return null
              return (
                <button
                  type="button"
                  role="menuitem"
                  className="dshx:flex dshx:w-full dshx:cursor-pointer dshx:items-center dshx:rounded-(--dsw-radius-md) dshx:border-none dshx:bg-transparent dshx:px-[7px] dshx:py-1 dshx:text-left dshx:text-[length:calc(var(--dsh-content-font-size-secondary,13px)-1px)] dshx:text-(--dsw-alias-label-primary) dshx:hover:bg-(--dsw-alias-interactive-bg-hover)"
                  onClick={() => {
                    props.dismiss()
                    if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) ctx.sidebarRight.close(props.tab.id)
                    if (isMainPanel(PANEL_ID)) ctx.layout.selectPanel(PANEL_ID)
                  }}
                >
                  Move to main area
                </button>
              )
            },
          ),
        ),
      'dshfiles-jujutsu: move the side-panel graph to the main view',
    )
    // The global dock exists to keep this panel on screen across threads, so it
    // leads the dock's default layout. The registry is page-global: registering
    // before the workbench loads is fine, and it is a no-op without it.
    ctx.effect(
      () =>
        workbenchPanels().register({
          id: DOCK_PANEL_ID,
          title: 'Jujutsu: Revision graph',
          dockDefault: true,
          // The same feature's full main-view page, so the workbench offers "Move to main view" for the panel.
          mainPanelId: PANEL_ID,
          component: DockSurfacePanel,
          scopedComponent: ScopedWorkbenchPanel,
        }),
      'dshfiles-jujutsu: dock panel',
    )
    ctx.effect(
      () =>
        workbenchPanels().register({
          id: SOURCE_CONTROL_DOCK_PANEL_ID,
          title: 'Jujutsu: Source Control',
          mainPanelId: SOURCE_CONTROL_PANEL_ID,
          component: DockSourceControlPanel,
        }),
      'dshfiles-jujutsu: source control dock panel',
    )
  },
})

interface SurfacePanelOptions {
  readonly surface: 'main' | 'side-panel' | 'dock'
  readonly scope: string
  readonly defaultPath?: string | null
  readonly visible?: boolean | undefined
  /** Omitted only on the narrow side panel, which switches between both views with tabs. */
  readonly view?: 'graph' | 'source'
}

interface MountedPanelScope {
  readonly scope: string
  readonly defaultPath: string | null
}

const noProjects = (): null => null
const noSession = (): undefined => undefined

/**
 * The repository picker's folders, split by the Host into projects and thread workspaces the way the New thread picker
 * gets them; a registration whose folder is gone is neither. Refetched when the workspace registry changes.
 */
const useRegisteredProjects = (workspaces: IWorkspaces | undefined): readonly RegisteredProject[] => {
  const api = useApi(jjIntegrationApi)
  const source = workspaces?.list
  const subscribe = useCallback((listener: () => void) => source?.subscribe(listener) ?? (() => undefined), [source])
  const getSnapshot = useCallback(() => source?.getSnapshot() ?? null, [source])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, noProjects)
  const workspaceIds = useMemo(() => snapshot?.items.map(workspace => workspace.workspaceId).sort() ?? [], [snapshot])
  const registered = useQuery({
    queryKey: ['jujutsu', 'registered-projects', workspaceIds],
    enabled: workspaceIds.length > 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.projects({}, { signal }),
  })
  return useMemo(
    () => [
      ...(registered.data?.projects ?? []).map(project => ({ workspaceId: project.workspaceId, title: project.title, canonicalPath: project.path })),
      ...(registered.data?.workspaces ?? []).map(workspace => ({
        workspaceId: workspace.workspaceId,
        title: workspace.title,
        canonicalPath: workspace.path,
        isJjWorkspace: true,
      })),
    ],
    [registered.data],
  )
}

const ProjectsBoundPanel = (props: Omit<Parameters<typeof JujutsuPanel>[0], 'projects'> & { readonly workspaces: IWorkspaces | undefined }): JSX.Element => {
  const { workspaces, ...panelProps } = props
  return <JujutsuPanel {...panelProps} projects={useRegisteredProjects(workspaces)} />
}

const SourceControlGlyph = (props: { readonly size?: number | undefined }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </svg>
)

const PanelGlyph = (props: { readonly size?: number | undefined }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M7 7.5v9M7 12.5c0-2.5 2-4 5-4h1.5" />
    <circle cx="7" cy="5" r="2.5" fill="currentColor" />
    <circle cx="7" cy="19" r="2.5" />
    <circle cx="16.5" cy="8.5" r="2.5" />
  </svg>
)
