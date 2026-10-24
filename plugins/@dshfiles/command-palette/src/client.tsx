import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { dshxRegistryApi } from '@dshfiles/dshx/api'
import { createApiClient, createRegisteredApiClient, defineClient, useSettings } from '@dshfiles/dshx/client'
import { PaletteRules } from './palette.js'
import { paletteSettings, type PaletteSettings } from './settings.js'
import { askDsh } from './ask-dsh.js'
import { createThreadContentSearch } from './thread-content-source.js'
import { useMemo, useSyncExternalStore } from 'react'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { CirclePlusIcon, FolderOpenIcon, MoonIcon, SunIcon, SunMoonIcon } from '@dshfiles/plugin-ui/icons'
import { COMMAND_PALETTE_LOCALE_NAMESPACE, commandPaletteLocale } from './locales.js'
import { newThreadShortcutDefaults } from './new-thread-shortcut.js'
import { PaletteApi, PALETTE_EVENT, type PaletteAction, type PaletteActionContext, type PaletteMode, type PaletteWorkspace } from './palette-api.js'
import { ThreadPalette } from './thread-palette.js'

const defaultSettings: PaletteSettings = paletteSettings.schema({})

const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)

interface PaletteOverlayProps extends PropsRuntime<'shell.overlay'>, PropsLocale<typeof COMMAND_PALETTE_LOCALE_NAMESPACE> {
  readonly useSessions: SidebarRootComponentProps['useSessions']
  readonly useWorkspaces: WorkspaceBrowserProps['useWorkspaces']
  readonly themeStore: SnapshotStore<ThemeSnapshot>
  readonly searchContent: (query: string, signal: AbortSignal) => Promise<readonly { readonly sessionId: string; readonly snippet: string }[]>
  readonly openSession: (sessionId: SessionSummary['id']) => void
  readonly openWorkspace: (workspaceId: WorkspaceView['workspaceId']) => Promise<void>
  /** Create a fresh thread for one Ask DSH question, send it, then open the thread. */
  readonly askDsh: (input: { readonly question: string; readonly workspaceId: WorkspaceId | undefined }) => Promise<void>
  readonly translate: TranslateNS<typeof COMMAND_PALETTE_LOCALE_NAMESPACE>
}

/**
 * The palette renders thread summaries, so it selects them by content: the Host
 * rebuilds every summary per projection, and comparing the fields the palette
 * shows keeps a projection that changed none of them from re-rendering it.
 */
const selectPaletteSessions = (state: SessionListState): readonly SessionSummary[] =>
  state.ids.flatMap(id => {
    const session = state.byId[id]
    return session === undefined ? [] : [session]
  })

const samePaletteSession = (left: SessionSummary, right: SessionSummary): boolean =>
  left.id === right.id &&
  left.displayTitle === right.displayTitle &&
  left.cwd === right.cwd &&
  left.parentId === right.parentId &&
  left.origin === right.origin &&
  left.blank === right.blank &&
  left.updatedAt === right.updatedAt &&
  (left.retainedBy.mainView ?? 0) === (right.retainedBy.mainView ?? 0)

const samePaletteSessions = (left: readonly SessionSummary[], right: readonly SessionSummary[]): boolean =>
  left.length === right.length &&
  left.every((session, index) => {
    const candidate = right[index]
    return candidate !== undefined && samePaletteSession(session, candidate)
  })

const workspaceForSession = (
  session: SessionSummary | undefined,
  byId: Readonly<Record<string, SessionSummary>>,
  workspaceBySession: ReadonlyMap<string, WorkspaceId>,
): WorkspaceId | undefined => {
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

interface PaletteCatalogProps extends PaletteOverlayProps {
  readonly mode: PaletteMode
  readonly recentLimit: number
}

/** Mounted only while the palette is open, so a closed palette derives nothing at all. */
const PaletteCatalog = (props: PaletteCatalogProps): JSX.Element => {
  const { mode, recentLimit } = props
  const sessions = props.useSessions(selectPaletteSessions, samePaletteSessions)
  const workspaceItems = props.useWorkspaces(state => state.items)
  const archivedWorkspaceSessionIds = props.useWorkspaces(state => state.archivedSessionIds)
  const pinnedWorkspaceSessionIds = props.useWorkspaces(state => state.pinnedSessionIds)
  const themeSnapshot = useSyncExternalStore(props.themeStore.subscribe, props.themeStore.getSnapshot, props.themeStore.getSnapshot)
  const sessionsById = useMemo(() => Object.fromEntries(sessions.map(session => [session.id, session])), [sessions])
  const workspaceBySession = useMemo(
    () => new Map(workspaceItems.flatMap(workspace => workspace.sessionIds.map(id => [id, workspace.workspaceId] as const))),
    [workspaceItems],
  )
  // The New-thread screen holds a blank Session in the main view; it is not a thread, so it gets no thread actions.
  const mainViewSession = sessions.find(session => (session.retainedBy.mainView ?? 0) > 0)
  const selectedSession = mainViewSession?.blank === true ? undefined : mainViewSession
  const selectedWorkspaceId = workspaceForSession(selectedSession, sessionsById, workspaceBySession)
  // Ask DSH still targets the picked project while that blank New-thread Session is in the main view.
  const askWorkspaceId = selectedWorkspaceId ?? workspaceForSession(mainViewSession, sessionsById, workspaceBySession)
  const workspaces = useMemo(() => workspaceItems.map(workspace => ({ id: workspace.workspaceId, title: workspace.title })), [workspaceItems])
  const workspaceById = useMemo<ReadonlyMap<string, PaletteWorkspace>>(
    () => new Map<string, PaletteWorkspace>(workspaces.map(workspace => [String(workspace.id), workspace])),
    [workspaces],
  )
  const workspaceTitleById = useMemo<ReadonlyMap<string, string>>(
    () => new Map<string, string>(workspaces.map(workspace => [String(workspace.id), workspace.title])),
    [workspaces],
  )
  const archivedSessionIds = useMemo(() => new Set(archivedWorkspaceSessionIds), [archivedWorkspaceSessionIds])
  const context = useMemo<PaletteActionContext>(() => {
    const workspace = (selectedWorkspaceId === undefined ? undefined : workspaceById.get(selectedWorkspaceId)) ?? null
    const pinned = new Set(pinnedWorkspaceSessionIds)
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
              archived: archivedSessionIds.has(selectedSession.id),
            },
      workspace,
      workspaces,
      themePreference: themeSnapshot.preference,
    }
  }, [archivedSessionIds, selectedSession, selectedWorkspaceId, themeSnapshot.preference, workspaceById, pinnedWorkspaceSessionIds, workspaces])
  const workspacePathById = useMemo(
    () => new Map<string, string>(workspaceItems.map(workspace => [String(workspace.workspaceId), workspace.path])),
    [workspaceItems],
  )
  const repositoryOf = (workspaceId: WorkspaceId | undefined): string | undefined => {
    const path = workspaceId === undefined ? undefined : workspacePathById.get(workspaceId)
    return path === undefined ? undefined : EntityLabels.repositoryPath(path)
  }
  const threadEntries = useMemo(
    () =>
      sessions.flatMap(session => {
        if (!PaletteRules.isTopLevelThread(session) || session.blank || archivedSessionIds.has(session.id)) return []
        const workspaceId = workspaceForSession(session, sessionsById, workspaceBySession)
        const project = workspaceId === undefined ? '' : (workspaceTitleById.get(workspaceId) ?? '')
        const path = workspaceId === undefined ? undefined : workspacePathById.get(workspaceId)
        return [
          {
            thread: { id: session.id, title: session.displayTitle, project, cwd: session.cwd ?? '', updatedAt: session.updatedAt },
            repository: path === undefined ? undefined : EntityLabels.repositoryPath(path),
          },
        ]
      }),
    [archivedSessionIds, sessions, sessionsById, workspaceBySession, workspacePathById, workspaceTitleById],
  )
  const threads = useMemo(() => threadEntries.map(entry => entry.thread), [threadEntries])
  const threadsScope = (useSettings(paletteSettings).value ?? defaultSettings).threadsScope
  const currentRepository = threadsScope === 'project' ? repositoryOf(askWorkspaceId) : undefined
  const projectThreads = useMemo(
    () => (currentRepository === undefined ? undefined : threadEntries.filter(entry => entry.repository === currentRepository).map(entry => entry.thread)),
    [currentRepository, threadEntries],
  )
  const openWorkspace = props.openWorkspace
  const workspaceActions = useMemo<readonly PaletteAction[]>(
    () =>
      workspaceItems
        .filter(workspace => !EntityLabels.isThreadWorkspace(workspace.path))
        .map(workspace => ({
          id: `@dshfiles/command-palette/workspace/${workspace.workspaceId}`,
          label: workspace.title,
          aliases: ['workspace', 'project', workspace.title],
          icon: <FolderOpenIcon className="dshx:size-4" />,
          group: 'destination',
          isSelected: current => current.workspace?.id === workspace.workspaceId,
          run: () => openWorkspace(workspace.workspaceId),
        })),
    [openWorkspace, workspaceItems],
  )
  return (
    <ThreadPalette
      mode={mode}
      threads={threads}
      {...(projectThreads === undefined ? {} : { projectThreads })}
      context={context}
      additionalActions={workspaceActions}
      recentLimit={recentLimit}
      mac={navigator.platform.startsWith('Mac') || navigator.platform === 'macOS'}
      copy={{
        title: props.translate('commandPaletteTitle'),
        threadsPlaceholder: props.translate('commandPaletteThreadsPlaceholder'),
        allPlaceholder: props.translate('commandPaletteAllPlaceholder'),
        filesPlaceholder: props.translate('commandPaletteFilesPlaceholder'),
        backlog: props.translate('commandPaletteBacklog'),
        backlogPlaceholder: props.translate('commandPaletteBacklogPlaceholder'),
        backlogOpen: props.translate('commandPaletteBacklogOpen'),
        backlogUnavailable: props.translate('commandPaletteBacklogUnavailable'),
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
        searchLabel: props.translate('commandPaletteSearchLabel'),
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
        ask: props.translate('commandPaletteAsk'),
        askPlaceholder: props.translate('commandPaletteAskPlaceholder'),
        askHint: props.translate('commandPaletteAskHint'),
        askEmpty: props.translate('commandPaletteAskEmpty'),
        askPending: props.translate('commandPaletteAskPending'),
        askSend: props.translate('commandPaletteAskSend'),
        askExit: props.translate('commandPaletteAskExit'),
        askFailed: props.translate('commandPaletteAskFailed'),
        contentSearching: props.translate('commandPaletteContentSearching'),
        contentUnavailable: props.translate('commandPaletteContentUnavailable'),
        actionFailed: props.translate('commandPaletteActionFailed'),
      }}
      searchContent={props.searchContent}
      onAsk={question => props.askDsh({ question, workspaceId: askWorkspaceId })}
      onBacklogCapture={text => {
        const event = new CustomEvent('dshfiles:backlog-capture', { detail: { text }, cancelable: true })
        return !window.dispatchEvent(event)
      }}
      onOpenThread={sessionId => {
        const session = sessions.find(candidate => candidate.id === sessionId)
        if (session !== undefined) props.openSession(session.id)
      }}
      onClose={PaletteApi.close}
    />
  )
}

/**
 * The overlay gate: it reads nothing but the palette snapshot, so a closed palette runs no
 * subscription, join or projection over the session and workspace stores.
 */
export const PaletteOverlay = (props: PaletteOverlayProps): JSX.Element | null => {
  const paletteSnapshot = useSyncExternalStore(PaletteApi.subscribe, PaletteApi.getSnapshot, PaletteApi.getSnapshot)
  const { mode, recentLimit } = paletteSnapshot
  if (mode === null) return null
  return <PaletteCatalog {...props} mode={mode} recentLimit={recentLimit} />
}

export default defineClient({
  name: '@dshfiles/command-palette',
  locales: [commandPaletteLocale],
  inject: ['slots', 'shortcuts', 'sessions', 'uiWorkspace', 'theme', 'connection', 'remote', 'remote.session'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(COMMAND_PALETTE_LOCALE_NAMESPACE)
    const themeStore = createSnapshotStore(ctx.theme.getTheme())
    ctx.on('theme/change', snapshot => themeStore.set(snapshot))
    const searchContent = createThreadContentSearch({
      listApis: async () => (await createApiClient(ctx, dshxRegistryApi).list({})).apis,
      callFinder: async (api, input, signal) => {
        const client = createRegisteredApiClient(ctx, { ...api, methods: ['findThreads'] })
        return client.findThreads === undefined ? undefined : client.findThreads(input, { signal })
      },
      native: async (query, signal) => {
        if (typeof ctx.sessions.search !== 'function') throw new Error('Thread content search is unavailable.')
        const result = await ctx.sessions.search(query, signal)
        if (!result.ok) throw new Error('Thread content search failed.')
        return result.value.items.map(item => ({ sessionId: item.sessionId, snippet: item.snippet }))
      },
    })
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
                askDsh={async ({ question, workspaceId }) => {
                  await askDsh({
                    question,
                    target: workspaceId === undefined ? {} : { workspaceId },
                    ports: {
                      createSession: input => ctx.sessions.create(input),
                      titleSession: async input => {
                        const renamed = await ctx.remote.session.rename(input)
                        if (!renamed.ok) console.warn(`command-palette: ask thread title not set (${renamed.error.message})`)
                      },
                      prompt: async input => {
                        const reference = ctx.sessions.retain(input.sessionId, { source: 'askDsh' })
                        try {
                          await reference.ready
                          const session = reference.binding.session
                          const handle = session.beginSubmission({ mode: 'queue', text: input.question, attachments: [] })
                          const result = await session.prompt([{ type: 'text', text: input.question }], 'queue', undefined, handle.requestId)
                          if (!result.ok) throw new Error(result.error.message)
                        } finally {
                          reference.release()
                        }
                      },
                      openSession: sessionId => ctx.uiWorkspace.openSession(sessionId),
                    },
                  })
                }}
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
        const probe = typeof detail === 'object' && detail !== null && 'probe' in detail && detail.probe === true
        const requestedMode = typeof detail === 'object' && detail !== null && 'mode' in detail ? detail.mode : undefined
        event.preventDefault()
        if (probe) return
        PaletteApi.open(requestedMode === 'threads' || requestedMode === 'files' ? requestedMode : 'all')
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
            resolve: () => ({ status: 'handled', run: () => PaletteApi.open('all') }),
          }),
        'command-palette: shortcut',
      )
    const startNewThread = (): void => ctx.uiWorkspace.startSession()
    const newThreadAction: PaletteAction = {
      id: '@dshfiles/command-palette/new-thread',
      label: () => translate('commandPaletteNewThread'),
      aliases: ['new thread', 'new chat', 'new session'],
      icon: <CirclePlusIcon className="dshx:size-4" />,
      group: 'action',
      run: startNewThread,
    }
    ctx.effect(() => PaletteApi.registerAction(newThreadAction), 'command-palette: new thread action')
    const newThreadShortcutId = 'commandPalette.newThread'
    if (isShortcutCommandId(newThreadShortcutId))
      ctx.effect(() => {
        const register = (withDefaults: boolean) =>
          ctx.shortcuts.register({
            id: newThreadShortcutId,
            label: () => translate('commandPaletteNewThread'),
            aliases: ['new thread', 'new chat', 'new session'],
            defaults: withDefaults ? newThreadShortcutDefaults : {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: startNewThread }),
          })
        // Another plugin (main-tabs' new tab) may already own the default key; keep the command, unbound.
        try {
          return register(true)
        } catch (error) {
          console.warn(`command-palette: ${newThreadShortcutId} keeps no default binding`, error)
          try {
            return register(false)
          } catch {
            return () => undefined
          }
        }
      }, 'command-palette: new thread shortcut')
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
      const disposers = themeActions.map(action => PaletteApi.registerAction(action))
      return () => disposers.forEach(dispose => dispose())
    }, 'command-palette: appearance actions')
  },
})
