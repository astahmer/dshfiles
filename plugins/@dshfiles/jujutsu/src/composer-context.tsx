import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { useProjectBookmark } from '@dshfiles/jj-integration/project-bookmark'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FileDiffIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import * as Schema from 'effect/Schema'
import { useAutoRefresh } from './auto-refresh.js'
import type { ComposerBase } from './composer-context-api.js'
import { ComposerContextModel, composerBaseSetting } from './composer-context-core.js'
import { composerSessionCwd } from './composer-context-session.js'
import { ChatReferenceLinks } from './chat-reference-links.js'
import { decodePreferences } from './preferences.js'
import { jujutsuSettings } from './settings.js'
import { useComposerContextApi } from './use-jujutsu-api.js'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'

export interface ComposerJujutsuServices {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  /** Open the right panel on the repository holding `path`, or collapse it when it already shows that repository. */
  readonly toggleJujutsu: (path: string) => void
  /** Open the Changes facet on this workspace; false when no Changes owner is active. */
  readonly openWorkspaceReview: (workspacePath: string, sessionId: string) => boolean
  readonly openJujutsuReference: (
    path: string,
    reference: { readonly value: string; readonly kind: 'revision' | 'bookmark'; readonly behavior: 'focus' | 'path' },
  ) => void
}

export interface ComposerSlotProps {
  readonly sessionId: SessionSummary['id']
  readonly jujutsu: ComposerJujutsuServices
}

const noStoredBases: Readonly<Record<string, string>> = {}
const storedBases = createStoredValue({
  key: 'dshfiles.jujutsu.composer-base.v1',
  schema: Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(512))),
  fallback: noStoredBases,
})

const noCwd = (): null => null

type WorkspaceItems = ReturnType<IWorkspaces['list']['getSnapshot']>['items']
const emptyWorkspaceItems: WorkspaceItems = []
const noWorkspaceItems = (): WorkspaceItems => emptyWorkspaceItems

const useWorkspaceItems = (workspaces: IWorkspaces): WorkspaceItems => {
  const subscribe = useCallback((listener: () => void) => workspaces.list.subscribe(listener), [workspaces])
  const read = useCallback(() => workspaces.list.getSnapshot().items, [workspaces])
  return useSyncExternalStore(subscribe, read, noWorkspaceItems)
}

const useSessionCwd = (sessions: ISessions, workspaces: WorkspaceItems, sessionId: SessionSummary['id']): string | null => {
  const subscribe = useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions])
  const read = useCallback(() => {
    const sessionCwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
    return composerSessionCwd(sessionId, sessionCwd, workspaces)
  }, [sessionId, sessions, workspaces])
  const cwd = useSyncExternalStore(subscribe, read, noCwd)
  return cwd === null || cwd.length === 0 ? null : cwd
}

const composerKeys = {
  context: (cwd: string, base: string) => ['jujutsu', 'composer', cwd, base, 'context'] as const,
}

/** Settings, the Session cwd and the chosen base, then the shared context query both composer slots read. */
const useComposerContext = (props: ComposerSlotProps, surface: 'composerBar' | 'composerChips' | 'headerToggle') => {
  const settings = useSettings(jujutsuSettings)
  // Keys added after the Host started are absent until a DSH restart; field-wise defaults keep the slots on.
  const preferences = decodePreferences(settings.value ?? {})
  const workspaces = useWorkspaceItems(props.jujutsu.workspaces)
  const cwd = useSessionCwd(props.jujutsu.sessions, workspaces, props.sessionId)
  const bases = storedBases.useValue()
  // `project` (the default) follows the project's main branch (Settings › Projects, via jj-integration).
  const projectBookmark = useProjectBookmark(cwd, 'main')
  const setting = (cwd === null ? undefined : bases[cwd]) ?? preferences.composerBarBase
  const base: ComposerBase = ComposerContextModel.composerBaseForProject(setting, projectBookmark)
  const baseKey = composerBaseSetting(base)
  // A remote thread's repository is read from its owner (multi-host); a local one from this Host.
  const api = useComposerContextApi(props.sessionId)
  // Chat reference links read the repository's bookmarks to decide which inline code is a link, so the
  // shared context query stays on for them even when this surface's own toggle is off.
  const loaded = (preferences[surface] || preferences.chatReferenceLinks) && cwd !== null
  const refetch = useRef<() => void>(() => undefined)
  const refresh = useAutoRefresh({ preferences, paused: false, surfaceVisible: true, onBecameVisible: () => refetch.current() })
  const query = useQuery({
    queryKey: composerKeys.context(cwd ?? '', baseKey),
    queryFn: ({ signal }) => api.context({ cwd: cwd ?? '', base }, { signal }),
    enabled: loaded,
    retry: false,
    ...refresh.queryOptions,
  })
  // The Changes pill, location chip and header toggle all become visible on the same switch; they join one read.
  refetch.current = () => void query.refetch({ cancelRefetch: false })
  const repository = query.isSuccess ? query.data.repository : null
  return {
    ref: refresh.ref,
    cwd,
    base,
    baseKey,
    repository: preferences[surface] ? repository : null,
    bookmarks: repository?.localBookmarks ?? [],
  }
}

const basename = (path: string): string =>
  path
    .replace(/[\\/]+$/u, '')
    .split(/[\\/]/u)
    .at(-1) ?? path

/** Whether this Session has not sent its first message: its run row already says where it will work. */
const useBlankSession = (props: ComposerSlotProps): boolean => {
  const sessions = props.jujutsu.sessions
  const subscribe = useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions])
  const read = useCallback(() => sessions.list.getSnapshot().byId[props.sessionId]?.blank === true, [sessions, props.sessionId])
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * The Changes pill (visual refresh T3.2): one compact `+N −M` reading in the thread header and the phone top bar that
 * opens the Changes facet on this workspace. It replaces the bar that sat above the composer; the facet carries the
 * file list, the diff and the comparison base. A new thread has nothing to compare yet, so it shows no pill.
 */
export const ChangesPill = (props: ComposerSlotProps): JSX.Element | null => (useBlankSession(props) ? null : <ChangesPillContent {...props} />)

const ChangesPillContent = (props: ComposerSlotProps): JSX.Element | null => {
  const context = useComposerContext(props, 'composerBar')
  const repository = context.repository
  if (repository === null) return null
  const fileCount = repository.totals?.files ?? repository.files.length
  const heading = context.base.kind === 'parent' ? 'Working copy' : 'Changes since branching from ' + repository.base.label
  const revisionSummary = ComposerContextModel.revisionSummary({
    baseLabel: repository.base.label,
    baseFound: repository.base.found,
    counts: repository.revisionCounts,
  })
  const files = fileCount === 0 ? 'no file changes' : fileCount + (fileCount === 1 ? ' file' : ' files')
  const totals = repository.totals === null ? '' : ', +' + repository.totals.additions + ' −' + repository.totals.deletions
  // The accessible name is the one the replaced bar's review button had, so journeys and agents keep finding it; the
  // file counts live in the tooltip and the visible text.
  const label = 'Review workspace changes: ' + revisionSummary
  const open = (): void => {
    if (!props.jujutsu.openWorkspaceReview(repository.root, String(props.sessionId))) props.jujutsu.toggleJujutsu(repository.root)
  }
  // b:ark0: one line, never shrunk. The header's utilities group floors its width at its occupants' min-content and
  // clips its start edge past that; a label free to wrap ("No changes") counted only as its longest word there, so the
  // group came out narrower than the pill and cut its first letters off ("o changes").
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={label}
            className={cn(
              'dshx-root dshx:inline-flex dshx:h-6 dshx:shrink-0 dshx:cursor-pointer dshx:whitespace-nowrap dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:bg-transparent dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums dshx:hover:bg-accent dshx:hover:text-foreground dshx:[&_svg]:size-3.5 dshx:[&_svg]:flex-none',
              'dshx:pointer-coarse:h-8 dshx:pointer-coarse:px-2.5 dshx:pointer-coarse:text-sm dshx:pointer-coarse:relative dshx:pointer-coarse:after:absolute dshx:pointer-coarse:after:-inset-y-1.5 dshx:pointer-coarse:after:inset-x-0 dshx:pointer-coarse:after:content-[""]',
            )}
            data-changes-pill=""
            onClick={open}
            ref={context.ref}
            type="button"
          >
            <FileDiffIcon />
            {/* b:czs9: in a header row under 26rem the pill keeps its icon; the counts stay in its name and tooltip. */}
            {fileCount === 0 || repository.totals === null ? (
              <span className="dshx:@max-[26rem]:hidden">{fileCount === 0 ? 'No changes' : files}</span>
            ) : (
              <span className="dshx:font-mono! dshx:flex dshx:gap-1 dshx:@max-[26rem]:hidden">
                <span>+{repository.totals.additions}</span>
                <span>−{repository.totals.deletions}</span>
              </span>
            )}
            {repository.conflict && <span className="dshx:text-destructive">conflict</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent className="dshx:whitespace-pre-line" side="bottom">
          {heading + ' · ' + files + totals + '\n' + revisionSummary}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const Chip = (props: { readonly tooltip: string; readonly onClick: () => void; readonly className?: string; readonly children: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        className={cn(
          'dshx:flex dshx:min-w-0 dshx:cursor-pointer dshx:items-center dshx:gap-1 dshx:whitespace-nowrap dshx:rounded-md dshx:px-1.5 dshx:py-0.5 dshx:hover:bg-accent dshx:hover:text-foreground dshx:[&_svg]:size-3 dshx:[&_svg]:flex-none',
          props.className,
        )}
        onClick={props.onClick}
        type="button"
      >
        {props.children}
      </button>
    </TooltipTrigger>
    <TooltipContent className="dshx:whitespace-pre-line" side="bottom">
      {props.tooltip}
    </TooltipContent>
  </Tooltip>
)

/** One contextual chip below the composer; it opens the Jujutsu panel for this repository. */
export const ComposerChips = (props: ComposerSlotProps): JSX.Element | null => {
  const context = useComposerContext(props, 'composerChips')
  const repository = context.repository
  const workspaces = useWorkspaceItems(props.jujutsu.workspaces)
  const currentWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(props.sessionId))
  const workspaceId = currentWorkspace?.workspaceId
  const api = useApi(jjIntegrationApi)
  const destination = useQuery({
    queryKey: ['jujutsu', 'composer-project', workspaceId ?? ''],
    enabled: repository !== null && workspaceId !== undefined,
    retry: false,
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 15_000,
        request: hostSignal => api.destination({ workspaceId: workspaceId ?? '' }, { signal: hostSignal }),
      }).catch(error => {
        if (isApiOwnerMissing(error)) return null
        throw error
      }),
  })
  if (repository === null) return null
  const toggle = (): void => props.jujutsu.toggleJujutsu(repository.root)

  const ownBookmark = repository.bookmarks[0]
  const nearestBookmark = repository.nearestBookmarks[0]
  const bookmark = ownBookmark ?? nearestBookmark
  const project =
    workspaces.find(workspace => workspace.workspaceId === destination.data?.projectWorkspaceId)?.title ?? currentWorkspace?.title ?? basename(repository.root)
  // Plain words (productivity pass Q5, T5.4; b:212a): "Own workspace · 1 ahead of main", "In the project · on main" rather
  // than the raw "sample (thread-842240 / main+)"; the workspace slug, bookmark and change id stay in the tooltip.
  const ownWorkspace = repository.workspace !== null && repository.workspace !== 'default' && repository.workspace !== project
  // Composer follow-up b:gyk7: the composer's run summary already names the project, so the chip says only where the
  // working copy stands, with the count when the base is that bookmark ("2 ahead of main", "2 behind").
  const counts = bookmark !== undefined && repository.base.label === bookmark ? repository.revisionCounts : undefined
  const ahead = counts === undefined || counts === null || counts.ahead === 0 ? '' : `${String(counts.ahead)} `
  // b:212a: the same two words the workspace picker uses, "Own workspace" or "In the project", never the folder name.
  const location = [
    ownWorkspace ? 'Own workspace' : 'In the project',
    bookmark === undefined ? undefined : ownBookmark === undefined ? `${ahead}ahead of ${bookmark}` : `on ${bookmark}`,
    counts === undefined || counts === null || counts.behind === 0 ? undefined : `${String(counts.behind)} behind`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' · ')
  const label = location.length === 0 ? `@ ${repository.changeId}` : location
  const title = [
    'Toggle Jujutsu on ' + repository.root,
    'Project: ' + project,
    repository.workspace === null ? undefined : 'Workspace: ' + repository.workspace,
    bookmark === undefined ? undefined : 'Bookmark: ' + bookmark + (ownBookmark === undefined ? ' (nearest ancestor)' : ''),
    'Working copy: @ ' + repository.changeId + ' (' + repository.commitId + ')',
    repository.description.length === 0 ? undefined : repository.description,
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n')
  return (
    <TooltipProvider delayDuration={500}>
      <div className="dshx-root dshx:flex dshx:items-center dshx:text-xs dshx:text-muted-foreground" data-composer-meta="location" ref={context.ref}>
        <Chip onClick={toggle} tooltip={title}>
          <span>{label}</span>
          {repository.conflict && <span className="dshx:shrink-0 dshx:text-destructive">conflict</span>}
        </Chip>
      </div>
    </TooltipProvider>
  )
}

/** One click in the conversation header: the Jujutsu side panel on this Session's repository, or closed again. */
export const ConversationHeaderToggle = (props: ComposerSlotProps & { readonly icon: ReactNode }): JSX.Element | null => {
  const context = useComposerContext(props, 'headerToggle')
  const repository = context.repository
  const settings = useSettings(jujutsuSettings)
  const preferences = decodePreferences(settings.value ?? {})

  // The query returns a fresh array whenever it refetches; key on the names so the effect only reinstalls on a real change.
  const bookmarkKey = context.bookmarks.join('\u0000')
  const bookmarks = useMemo(() => (bookmarkKey === '' ? [] : bookmarkKey.split('\u0000')), [bookmarkKey])
  useEffect(() => {
    if (!preferences.chatReferenceLinks || context.cwd === null) return
    const cwd = context.cwd
    const behavior = preferences.chatReferenceClickBehavior
    return ChatReferenceLinks.attach(props.sessionId, {
      cwd,
      bookmarks,
      onOpen: (reference, targetPath) => props.jujutsu.openJujutsuReference(targetPath, { ...reference, behavior }),
    })
  }, [bookmarks, context.cwd, preferences.chatReferenceClickBehavior, preferences.chatReferenceLinks, props.jujutsu, props.sessionId])
  if (repository === null) return null
  const label = 'Toggle Jujutsu on ' + basename(repository.root)
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            className="dshx-root dshx:text-muted-foreground"
            onClick={() => props.jujutsu.toggleJujutsu(repository.root)}
            ref={context.ref}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {props.icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label + ' (' + repository.root + ')'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
