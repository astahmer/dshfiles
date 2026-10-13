import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { FolderOpenIcon, MoonIcon, SunIcon, SunMoonIcon } from '@dshfiles/plugin-ui/icons'
import { COMMAND_PALETTE_LOCALE_NAMESPACE, commandPaletteLocale } from './locales.js'
import { newThreadShortcutDefaults } from './new-thread-shortcut.js'
import {
  closePalette,
  getPaletteMode,
  getPaletteRecentLimit,
  openPalette,
  PALETTE_EVENT,
  registerPaletteAction,
  subscribePaletteActions,
  type PaletteAction,
  type PaletteActionContext,
} from './palette-api.js'
import { ThreadPalette } from './thread-palette.js'
import './client.css'

const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)

interface PaletteOverlayProps extends PropsRuntime<'shell.overlay'>, PropsLocale<typeof COMMAND_PALETTE_LOCALE_NAMESPACE> {
  readonly useSessions: SidebarRootComponentProps['useSessions']
  readonly useWorkspaces: WorkspaceBrowserProps['useWorkspaces']
  readonly themeStore: SnapshotStore<ThemeSnapshot>
  readonly searchContent: (query: string, signal: AbortSignal) => Promise<readonly { readonly sessionId: string; readonly snippet: string }[]>
  readonly openSession: (sessionId: SessionSummary['id']) => void
  readonly openWorkspace: (workspaceId: WorkspaceView['workspaceId']) => Promise<void>
  readonly translate: TranslateNS<typeof COMMAND_PALETTE_LOCALE_NAMESPACE>
}

const workspaceForSession = (
  session: SessionSummary | undefined,
  byId: Readonly<Record<string, SessionSummary>>,
  workspaceBySession: ReadonlyMap<string, string>,
): string | undefined => {
  let cursor = session?.id
  const visited = new Set<string>()
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor)
    const workspaceId = workspaceBySession.get(cursor)
    if (workspaceId !== undefined) return workspaceId
    cursor = byId[cursor]?.parentId
  }
  return undefined
}

const PaletteOverlay = (props: PaletteOverlayProps): JSX.Element | null => {
  const [mode, setMode] = useState(getPaletteMode)
  const [recentLimit, setRecentLimit] = useState(getPaletteRecentLimit)
  const sessionState = props.useSessions(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const themeSnapshot = useSyncExternalStore(props.themeStore.subscribe, props.themeStore.getSnapshot, props.themeStore.getSnapshot)
  const sessions = useMemo(
    () => sessionState.ids.flatMap(id => (sessionState.byId[id] === undefined ? [] : [sessionState.byId[id]])),
    [sessionState.byId, sessionState.ids],
  )
  const workspaceBySession = useMemo(
    () => new Map(workspaceState.items.flatMap(workspace => workspace.sessionIds.map(id => [id, workspace.workspaceId] as const))),
    [workspaceState.items],
  )
  const selectedSession = sessions.find(session => (session.retainedBy.mainView ?? 0) > 0)
  const selectedWorkspaceId = workspaceForSession(selectedSession, sessionState.byId, workspaceBySession)
  const workspaces = useMemo(() => workspaceState.items.map(workspace => ({ id: workspace.workspaceId, title: workspace.title })), [workspaceState.items])
  const context = useMemo<PaletteActionContext>(() => {
    const workspace = workspaces.find(candidate => candidate.id === selectedWorkspaceId) ?? null
    const archived = new Set(workspaceState.archivedSessionIds)
    const pinned = new Set(workspaceState.pinnedSessionIds)
    return {
      thread:
        selectedSession === undefined
          ? null
          : {
              id: selectedSession.id,
              title: selectedSession.displayTitle,
              cwd: selectedSession.cwd ?? '',
              workspaceId: selectedWorkspaceId,
              pinned: pinned.has(selectedSession.id),
              archived: archived.has(selectedSession.id),
            },
      workspace,
      workspaces,
      themePreference: themeSnapshot.preference,
    }
  }, [selectedSession, selectedWorkspaceId, themeSnapshot.preference, workspaces, workspaceState.archivedSessionIds, workspaceState.pinnedSessionIds])
  const threads = useMemo(
    () =>
      sessions.flatMap(session => {
        if (session.blank || workspaceState.archivedSessionIds.includes(session.id)) return []
        const workspaceId = workspaceForSession(session, sessionState.byId, workspaceBySession)
        const project = workspaces.find(workspace => workspace.id === workspaceId)?.title ?? ''
        return [{ id: session.id, title: session.displayTitle, project, cwd: session.cwd ?? '', updatedAt: session.updatedAt }]
      }),
    [sessionState.byId, sessions, workspaceBySession, workspaceState.archivedSessionIds, workspaces],
  )
  const workspaceActions = useMemo<readonly PaletteAction[]>(
    () =>
      workspaceState.items.map(workspace => ({
        id: `@dshfiles/command-palette/workspace/${workspace.workspaceId}`,
        label: workspace.title,
        aliases: ['workspace', 'project', workspace.title],
        icon: <FolderOpenIcon className="dshx:size-4" />,
        group: 'destination',
        isSelected: current => current.workspace?.id === workspace.workspaceId,
        run: () => props.openWorkspace(workspace.workspaceId),
      })),
    [props.openWorkspace, workspaceState.items],
  )
  useEffect(
    () =>
      subscribePaletteActions(() => {
        setMode(getPaletteMode())
        setRecentLimit(getPaletteRecentLimit())
      }),
    [],
  )
  if (mode === null) return null
  return (
    <ThreadPalette
      mode={mode}
      threads={threads}
      context={context}
      additionalActions={workspaceActions}
      recentLimit={recentLimit}
      mac={navigator.platform.startsWith('Mac') || navigator.platform === 'macOS'}
      copy={{
        title: props.translate('commandPaletteTitle'),
        threadsPlaceholder: props.translate('commandPaletteThreadsPlaceholder'),
        allPlaceholder: props.translate('commandPaletteAllPlaceholder'),
        filesPlaceholder: props.translate('commandPaletteFilesPlaceholder'),
        recent: props.translate('commandPaletteRecent'),
        threads: props.translate('commandPaletteThreads'),
        destinations: props.translate('commandPaletteDestinations'),
        commands: props.translate('commandPaletteCommands'),
        files: props.translate('commandPaletteFiles'),
        goToFile: props.translate('commandPaletteGoToFile'),
        filesIndexing: props.translate('commandPaletteFilesIndexing'),
        filesTruncated: props.translate('commandPaletteFilesTruncated'),
        filesNoSession: props.translate('commandPaletteFilesNoSession'),
        filesUnavailable: props.translate('commandPaletteFilesUnavailable'),
        empty: props.translate('commandPaletteEmpty'),
        navigate: props.translate('commandPaletteNavigate'),
        open: props.translate('commandPaletteOpen'),
        close: props.translate('commandPaletteClose'),
        clear: props.translate('commandPaletteClear'),
        back: props.translate('commandPaletteBack'),
        searchIn: props.translate('commandPaletteSearchIn'),
        sessionNotFound: props.translate('commandPaletteSessionNotFound'),
        unassigned: props.translate('commandPaletteUnassigned'),
        prefixHint: props.translate('commandPalettePrefixHint'),
        viewAll: props.translate('commandPaletteViewAll'),
        viewCommands: props.translate('commandPaletteCommands'),
        viewContent: props.translate('commandPaletteViewContent'),
        viewLine: props.translate('commandPaletteViewLine'),
        viewHelp: props.translate('commandPaletteViewHelp'),
        commandsPlaceholder: props.translate('commandPaletteCommandsPlaceholder'),
        contentPlaceholder: props.translate('commandPaletteContentPlaceholder'),
        linePlaceholder: props.translate('commandPaletteLinePlaceholder'),
        helpPlaceholder: props.translate('commandPaletteHelpPlaceholder'),
        helpCommands: props.translate('commandPaletteHelpCommands'),
        helpThread: props.translate('commandPaletteHelpThread'),
        helpSession: props.translate('commandPaletteHelpSession'),
        helpContent: props.translate('commandPaletteHelpContent'),
        helpLine: props.translate('commandPaletteHelpLine'),
        helpNone: props.translate('commandPaletteHelpNone'),
        goToLine: props.translate('commandPaletteGoToLine'),
        noEditorFile: props.translate('commandPaletteNoEditorFile'),
        contentSearching: props.translate('commandPaletteContentSearching'),
        contentUnavailable: props.translate('commandPaletteContentUnavailable'),
        actionFailed: props.translate('commandPaletteActionFailed'),
      }}
      searchContent={props.searchContent}
      onOpenThread={sessionId => {
        const session = sessions.find(candidate => candidate.id === sessionId)
        if (session !== undefined) props.openSession(session.id)
      }}
      onClose={closePalette}
    />
  )
}

export default defineClient({
  name: '@dshfiles/command-palette',
  locales: [commandPaletteLocale],
  inject: ['slots', 'shortcuts', 'sessions', 'uiWorkspace', 'theme'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(COMMAND_PALETTE_LOCALE_NAMESPACE)
    const themeStore = createSnapshotStore(ctx.theme.getTheme())
    ctx.on('theme/change', snapshot => themeStore.set(snapshot))
    const searchContent = async (query: string, signal: AbortSignal) => {
      if (typeof ctx.sessions.search !== 'function') throw new Error('Thread content search is unavailable.')
      const result = await ctx.sessions.search(query, signal)
      if (!result.ok) throw new Error('Thread content search failed.')
      return result.value.items.map(item => ({ sessionId: item.sessionId, snippet: item.snippet }))
    }
    ctx.effect(
      () =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'command-palette',
              order: 100,
              label: () => translate('commandPaletteTitle'),
              locale: COMMAND_PALETTE_LOCALE_NAMESPACE,
            },
            decorate(props => (
              <PaletteOverlay
                {...props}
                useSessions={props.useSessions}
                useWorkspaces={props.useWorkspaces}
                themeStore={themeStore}
                searchContent={searchContent}
                openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)}
                openWorkspace={workspaceId => ctx.uiWorkspace.openWorkspace(workspaceId)}
                translate={translate}
              />
            )),
          ),
        ),
      'command-palette: shell overlay',
    )
    ctx.effect(() => {
      const onRequest = (event: Event): void => {
        const detail: unknown = event instanceof CustomEvent ? event.detail : undefined
        const probe = typeof detail === 'object' && detail !== null && Reflect.get(detail, 'probe') === true
        const requestedMode = typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'mode') : undefined
        event.preventDefault()
        if (probe) return
        openPalette(requestedMode === 'threads' || requestedMode === 'files' ? requestedMode : 'all')
      }
      window.addEventListener(PALETTE_EVENT, onRequest)
      return () => window.removeEventListener(PALETTE_EVENT, onRequest)
    }, 'command-palette: open request')
    const shortcutId = 'commandPalette.open'
    if (isShortcutCommandId(shortcutId))
      ctx.effect(
        () =>
          ctx.shortcuts.register({
            id: shortcutId,
            label: () => translate('commandPaletteTitle'),
            aliases: ['command palette', 'go to', 'search threads'],
            defaults: {
              'desktop:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
              'desktop:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
              'desktop:linux': { code: 'KeyP', modifiers: ['primary', 'shift'] },
              'web:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
              'web:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
            },
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: () => openPalette('all') }),
          }),
        'command-palette: shortcut',
      )
    const startNewThread = (): void => ctx.uiWorkspace.startSession()
    const newThreadAction: PaletteAction = {
      id: '@dshfiles/command-palette/new-thread',
      label: () => translate('commandPaletteNewThread'),
      aliases: ['new thread', 'new chat', 'new session'],
      group: 'action',
      run: startNewThread,
    }
    ctx.effect(() => registerPaletteAction(newThreadAction), 'command-palette: new thread action')
    const newThreadShortcutId = 'commandPalette.newThread'
    if (isShortcutCommandId(newThreadShortcutId))
      ctx.effect(
        () =>
          ctx.shortcuts.register({
            id: newThreadShortcutId,
            label: () => translate('commandPaletteNewThread'),
            aliases: ['new thread', 'new chat', 'new session'],
            defaults: newThreadShortcutDefaults,
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: startNewThread }),
          }),
        'command-palette: new thread shortcut',
      )
    const themeActions: readonly PaletteAction[] = [
      {
        id: '@dshfiles/command-palette/theme/light',
        label: () => translate('commandPaletteThemeLight'),
        aliases: ['theme', 'light'],
        icon: <SunIcon className="dshx:size-4" />,
        group: 'action',
        isSelected: context => context.themePreference === 'light',
        run: () => ctx.theme.setTheme('light'),
      },
      {
        id: '@dshfiles/command-palette/theme/dark',
        label: () => translate('commandPaletteThemeDark'),
        aliases: ['theme', 'dark'],
        icon: <MoonIcon className="dshx:size-4" />,
        group: 'action',
        isSelected: context => context.themePreference === 'dark',
        run: () => ctx.theme.setTheme('dark'),
      },
      {
        id: '@dshfiles/command-palette/theme/system',
        label: () => translate('commandPaletteThemeSystem'),
        aliases: ['theme', 'system', 'automatic'],
        icon: <SunMoonIcon className="dshx:size-4" />,
        group: 'action',
        isSelected: context => context.themePreference === 'system',
        run: () => ctx.theme.setTheme('system'),
      },
    ]
    ctx.effect(() => {
      const disposers = themeActions.map(action => registerPaletteAction(action))
      return () => disposers.forEach(dispose => dispose())
    }, 'command-palette: appearance actions')
  },
})
