import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import type { DirectoryPickerPort, RegisteredProject } from '@dshfiles/project-folder-picker'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { JujutsuPanel } from './client.js'
import { ComposerChangesBar, ComposerChips, ConversationHeaderToggle, type ComposerJujutsuServices, type ComposerSlotProps } from './composer-context.js'
import { sidePanelRepository } from './side-panel-repository.js'
import './client.css'

const PANEL_ID = 'dshfiles-jujutsu'
const RIGHT_PANE_ID = '@dshfiles/jujutsu/revision-graph'
const RIGHT_PANE_KIND = 'dshfiles-jujutsu-revision-graph'

export default defineClient({
  name: '@dshfiles/jujutsu',
  // setup(ctx) reads ctx.slots; declaring it here is what injects that service.
  inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'uiWorkspace', 'workspaces', 'shortcuts'],
  // The panel calls useApi, so the entry must be decorated: a raw component
  // renders outside the API context and its useApi throws while rendering.
  setup(ctx, decorate) {
    const directoryPicker: DirectoryPickerPort = {
      pick: () => ctx.uiWorkspace.pickDirectory(),
      list: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
      createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
    }
    const registerWorkspace = async (canonicalPath: string): Promise<RegisteredProject> => {
      const workspace = await ctx.workspaces.create({ path: canonicalPath })
      return { workspaceId: workspace.workspaceId, title: workspace.title, canonicalPath: workspace.path }
    }
    const panelForSurface = (surface: 'main' | 'side-panel') =>
      decorate(() => (
        <PluginQueryProvider>
          <ProjectsBoundPanel
            workspaces={ctx.workspaces}
            surface={surface}
            directoryPicker={directoryPicker}
            registerWorkspace={registerWorkspace}
            sessions={ctx.sessions}
            openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)}
            pickDirectory={() => ctx.uiWorkspace.pickDirectory()}
            launchSession={async cwd => {
              const sessionId = await ctx.sessions.create({ cwd })
              ctx.uiWorkspace.openSession(sessionId)
            }}
          />
        </PluginQueryProvider>
      ))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: 'Jujutsu' }, PanelGlyph))
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
    // Older Hosts lack active()/isExpanded(); without them the toggle only ever opens.
    const toggleJujutsu = (path: string | null): void => {
      const sidebar = ctx.sidebarRight
      const showingJujutsu =
        typeof sidebar.isExpanded === 'function' &&
        typeof sidebar.active === 'function' &&
        typeof sidebar.toggleExpanded === 'function' &&
        sidebar.isExpanded() &&
        sidebar.active()?.kind === RIGHT_PANE_KIND
      if (showingJujutsu && (path === null || sidePanelRepository.isShowing(path))) {
        sidebar.toggleExpanded()
        return
      }
      if (path !== null) sidePanelRepository.request(path)
      sidebar.openTab(RIGHT_PANE_KIND)
    }
    const composerServices: ComposerJujutsuServices = {
      sessions: ctx.sessions,
      toggleJujutsu,
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
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, panelForSurface('main')))
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID }, panelForSurface('side-panel')))
  },
})

const noProjects = (): null => null

/** Follow the Host workspace registry so the repository picker lists every registered project. */
const useRegisteredProjects = (workspaces: IWorkspaces | undefined): readonly RegisteredProject[] => {
  const source = workspaces?.list
  const subscribe = useCallback((listener: () => void) => source?.subscribe(listener) ?? (() => undefined), [source])
  const getSnapshot = useCallback(() => source?.getSnapshot() ?? null, [source])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, noProjects)
  return useMemo(
    () => snapshot?.items.map(workspace => ({ workspaceId: workspace.workspaceId, title: workspace.title, canonicalPath: workspace.path })) ?? [],
    [snapshot],
  )
}

const ProjectsBoundPanel = (props: Omit<Parameters<typeof JujutsuPanel>[0], 'projects'> & { readonly workspaces: IWorkspaces | undefined }): JSX.Element => {
  const { workspaces, ...panelProps } = props
  return <JujutsuPanel {...panelProps} projects={useRegisteredProjects(workspaces)} />
}

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
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
