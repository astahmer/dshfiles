import { useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { ChevronRight, Ellipsis, Expand, ListFilter, RefreshCw, Rows3, Search, TextWrap, TriangleAlert } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { MAX_FILES, pullsReviewApi, type ReviewResult } from './api.js'
import type { FileComparison } from './review-diff.js'
import { EMPTY_COMPARISON, ReviewDiffModel } from './review-diff.js'
import { useReviewComments } from './review-comments.js'
import { threadsAt, type CommentBinding, type DiffLayout } from './review-diffs.js'
import { ReviewFileSection } from './review-file-section.js'
import { useReviewMarks } from './review-marks.js'
import { ReviewModel, type ReviewFile, type ReviewGroup, type ReviewSource } from './review-model.js'
import type { PageReviewContext } from './review-page-context.js'
import { reviewSettings } from './settings.js'

const NO_PREFS: { readonly layout: DiffLayout; readonly wrap: boolean; readonly hideViewed: boolean } = { layout: 'unified', wrap: false, hideViewed: false }
const surfacePrefs = createStoredValue({
  key: 'dshfiles-pulls-review:surface',
  schema: z.object({ layout: z.enum(['unified', 'split']), wrap: z.boolean(), hideViewed: z.boolean() }),
  fallback: NO_PREFS,
})

const NO_COLLAPSED: Record<string, string[]> = {}

const collapsedStore = createStoredValue({
  key: 'dshfiles-pulls-review:collapsed',
  schema: z.record(z.string(), z.array(z.string().max(2048)).max(MAX_FILES)),
  fallback: NO_COLLAPSED,
})

const MAX_COLLAPSED_REVIEWS = 20

const recordCollapsed = (record: Readonly<Record<string, readonly string[]>>, key: string, paths: readonly string[]) => {
  const next: Record<string, string[]> = {}
  for (const [existing, value] of Object.entries(record)) if (existing !== key) next[existing] = [...value]
  next[key] = [...paths]
  const keys = Object.keys(next)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_COLLAPSED_REVIEWS))) delete next[stale]
  return next
}

const comparisonCache = new Map<string, Promise<FileComparison>>()

const turnSummaryUrl = (source: Extract<ReviewSource, { kind: 'turn' }>): string =>
  `api/changes.summary?${new URLSearchParams({ sessionId: source.sessionId, seq: String(source.seq) }).toString()}`

const turnComparisonUrl = (source: Extract<ReviewSource, { kind: 'turn' }>, index: number): string =>
  `api/changes.diff?${new URLSearchParams({ sessionId: source.sessionId, seq: String(source.seq), index: String(index) }).toString()}`

const readTurnComparison = (source: Extract<ReviewSource, { kind: 'turn' }>, index: number, signal: AbortSignal): Promise<FileComparison> => {
  const key = `${ReviewModel.reviewKey(source)}:${String(index)}`
  const cached = comparisonCache.get(key)
  if (cached !== undefined) return cached
  const request = fetch(turnComparisonUrl(source, index), { signal }).then(async response => {
    if (!response.ok) return EMPTY_COMPARISON
    return ReviewDiffModel.comparisonFromTurnDiff(await response.json())
  })
  comparisonCache.set(key, request)
  void request.catch(() => comparisonCache.delete(key))
  return request
}

export interface ReviewSurfaceProps {
  readonly turn?: Extract<ReviewSource, { kind: 'turn' }> | undefined
  readonly workspacePath?: string | undefined
  readonly initialFileIndex?: number | undefined
  readonly initialFile?: string | undefined
  readonly variant: 'tab' | 'page'
  readonly onExpand?: ((context: PageReviewContext) => void) | undefined
  readonly sessionId?: string | undefined
}

export const ReviewSurface = (props: ReviewSurfaceProps): ReactNode => {
  const [mode, setMode] = useState<'turn' | 'workspace'>(props.turn === undefined ? 'workspace' : 'turn')

  const summary = useQuery({
    queryKey: ['pulls-review', 'turn-summary', props.turn?.sessionId ?? '', props.turn?.seq ?? -1],
    enabled: props.turn !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async ({ signal }) => {
      if (props.turn === undefined) return undefined
      const response = await fetch(turnSummaryUrl(props.turn), { signal })
      return response.ok ? ReviewModel.turnSummaryFrom(await response.json()) : undefined
    },
  })

  const api = useApi(pullsReviewApi)
  const workspace = useQuery({
    queryKey: ['pulls-review', props.workspacePath ?? ''],
    enabled: mode === 'workspace' && props.workspacePath !== undefined && props.workspacePath.length > 0,
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 60_000,
        request: hostSignal => {
          const input: { readonly path: string; readonly base?: string } = { path: props.workspacePath ?? '' }
          return api.review(input, { signal: hostSignal })
        },
      }),
  })

  const workspaceResult = workspace.data?.status === 'ok' ? workspace.data : undefined
  const workspaceSource: Extract<ReviewSource, { kind: 'workspace' }> | undefined =
    workspaceResult === undefined
      ? undefined
      : { kind: 'workspace', path: workspaceResult.path, base: workspaceResult.base, head: workspaceResult.head, range: workspaceResult.range }

  const turnSummary = summary.data
  const turnData: readonly ReviewFile[] | undefined = turnSummary === undefined ? undefined : ReviewModel.turnFiles(turnSummary)
  const files = mode === 'turn' ? turnData : workspaceResult === undefined ? undefined : ReviewModel.workspaceFiles(workspaceResult)
  const groups =
    mode === 'turn'
      ? turnData === undefined
        ? []
        : ReviewModel.turnGroups(turnData)
      : workspaceResult === undefined || files === undefined
        ? []
        : ReviewModel.workspaceGroups(workspaceResult, files)
  const source: ReviewSource | undefined = mode === 'turn' ? (props.turn !== undefined && turnSummary !== undefined ? props.turn : undefined) : workspaceSource

  const workspaceMissing = mode === 'workspace' && (props.workspacePath === undefined || props.workspacePath.length === 0)
  const loading = mode === 'turn' ? summary.isPending : !workspaceMissing && workspace.isPending
  const failure =
    mode === 'turn'
      ? summary.error
      : workspaceMissing
        ? null
        : (workspace.error ?? (workspace.data?.status === 'failed' ? new Error(workspace.data.message) : null))
  const retry = (): void => {
    if (mode === 'turn') void summary.refetch()
    else void workspace.refetch()
  }

  const switchMode = (next: 'turn' | 'workspace'): void => {
    setMode(next)
    if (next === 'workspace') void workspace.refetch()
  }

  if (files === undefined || source === undefined) {
    return (
      <div
        className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-2 dshx:p-6 dshx:text-xs dshx:text-muted-foreground"
        data-review-surface=""
      >
        {loading ? (
          <span role="status">Loading review…</span>
        ) : failure !== null && failure !== undefined ? (
          <>
            <span className="dshx:inline-flex dshx:items-center dshx:gap-1">
              <TriangleAlert className="dshx:size-3.5" aria-hidden />
              {errorMessage(failure, 'This review could not be loaded.')}
            </span>
            <Button size="sm" variant="outline" onClick={retry}>
              <RefreshCw aria-hidden /> Retry
            </Button>
          </>
        ) : workspaceMissing ? (
          <span>No thread workspace to review. Open a thread, then open this page again.</span>
        ) : (
          <span>No changes to review yet.</span>
        )}
      </div>
    )
  }

  return (
    <ReviewBody
      source={source}
      files={files}
      groups={groups}
      turn={props.turn}
      workspaceSource={workspaceSource}
      mode={mode}
      onSwitchMode={switchMode}
      turnLoading={summary.isPending}
      workspaceLoading={workspace.isPending}
      workspaceResult={workspaceResult}
      workspacePath={props.workspacePath}
      initialFileIndex={props.initialFileIndex}
      initialFile={props.initialFile}
      variant={props.variant}
      onExpand={props.onExpand}
      sessionId={props.sessionId}
    />
  )
}

interface ReviewBodyProps {
  readonly source: ReviewSource
  readonly files: readonly ReviewFile[]
  readonly groups: readonly ReviewGroup[]
  readonly turn: Extract<ReviewSource, { kind: 'turn' }> | undefined
  readonly workspaceSource: Extract<ReviewSource, { kind: 'workspace' }> | undefined
  readonly mode: 'turn' | 'workspace'
  readonly onSwitchMode: (mode: 'turn' | 'workspace') => void
  readonly turnLoading: boolean
  readonly workspaceLoading: boolean
  readonly workspaceResult: Extract<ReviewResult, { status: 'ok' }> | undefined
  readonly workspacePath?: string | undefined
  readonly initialFileIndex?: number | undefined
  readonly initialFile?: string | undefined
  readonly variant: 'tab' | 'page'
  readonly onExpand?: ((context: PageReviewContext) => void) | undefined
  readonly sessionId?: string | undefined
}

const ReviewBody = (props: ReviewBodyProps): ReactNode => {
  const prefs = surfacePrefs.useValue()
  const collapsedRecord = collapsedStore.useValue()
  const key = ReviewModel.reviewKey(props.source)
  const settings = useSettings(reviewSettings)
  const [localAutoMark, setLocalAutoMark] = useState(true)
  const [search, setSearch] = useState('')
  const [railOpen, setRailOpen] = useState(false)
  const [activePath, setActivePath] = useState<string | undefined>(undefined)
  const [activeAnchor, setActiveAnchor] = useState<{ readonly path: string; readonly anchor: NonNullable<CommentBinding['active']> } | undefined>(undefined)
  const scrollRoot = useRef<HTMLDivElement | null>(null)
  const marks = useReviewMarks(props.source)
  const comments = useReviewComments(props.source)
  const reviewApi = useApi(pullsReviewApi)
  const summarize = useMutation({
    mutationFn: () =>
      runHostRequest({
        timeoutMs: 120_000,
        request: signal => {
          const path = props.workspacePath ?? ''
          const input = props.sessionId === undefined ? { path } : { path, sessionId: props.sessionId }
          return reviewApi.summarize(input, { signal })
        },
      }),
  })
  const aiSummaries = summarize.data?.status === 'ok' ? summarize.data.summaries : undefined

  const autoMark = settings.value?.autoMarkViewed ?? localAutoMark
  const toggleAutoMark = (next: boolean): void => {
    if (settings.writable) void settings.set('autoMarkViewed', next)
    else setLocalAutoMark(next)
  }

  const collapsed = useMemo(() => new Set(collapsedRecord[key] ?? []), [collapsedRecord, key])
  const setCollapsed = (next: ReadonlySet<string>): void => {
    collapsedStore.set(recordCollapsed(collapsedRecord, key, [...next]))
  }
  const toggleCollapsed = (path: string): void => {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setCollapsed(next)
  }

  const totals = ReviewModel.reviewTotals(props.files)
  const viewedCount = props.files.filter(file => marks.viewed.has(file.path)).length
  const progress = totals.files === 0 ? 0 : Math.round((viewedCount / totals.files) * 100)

  const visibleGroups = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return props.groups
      .map(group => ({
        ...group,
        files: group.files.filter(file => {
          if (prefs.hideViewed && marks.viewed.has(file.path)) return false
          return needle.length === 0 || file.path.toLowerCase().includes(needle) || file.display.toLowerCase().includes(needle)
        }),
      }))
      .filter(group => group.files.length > 0)
  }, [props.groups, prefs.hideViewed, marks.viewed, search])

  const workspaceComparisons = useMemo(() => {
    if (props.workspaceResult === undefined) return new Map<string, FileComparison>()
    const sections = ReviewDiffModel.splitPatchByFile(props.workspaceResult.patch)
    return new Map([...sections].map(([path, section]) => [path, ReviewDiffModel.comparisonFromPatch(section)]))
  }, [props.workspaceResult])

  const queue = useRef(new Set<string>())
  const flushTimer = useRef<number | undefined>(undefined)
  const markMany = marks.markMany
  const onPassed = useCallback(
    (path: string) => {
      if (!autoMark || marks.viewed.has(path)) return
      queue.current.add(path)
      if (flushTimer.current !== undefined) return
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = undefined
        const paths = [...queue.current]
        queue.current.clear()
        markMany(paths)
      }, 400)
    },
    [autoMark, marks.viewed, markMany],
  )
  useEffect(
    () => () => {
      if (flushTimer.current !== undefined) window.clearTimeout(flushTimer.current)
    },
    [],
  )

  const focusPath = activePath ?? props.initialFile
  useEffect(() => {
    if (props.initialFileIndex === undefined && props.initialFile === undefined) return
    const id = props.initialFile === undefined ? `review-file-${String(props.initialFileIndex ?? 0)}` : undefined
    const timer = window.setTimeout(() => {
      if (id !== undefined) document.getElementById(id)?.scrollIntoView({ block: 'start' })
      else {
        const element = [...document.querySelectorAll<HTMLElement>('[data-review-file]')].find(item => item.dataset.reviewFile === props.initialFile)
        element?.scrollIntoView({ block: 'start' })
      }
    }, 60)
    return () => window.clearTimeout(timer)
  }, [props.initialFileIndex, props.initialFile, props.source])

  const binding = useCallback(
    (path: string): CommentBinding | undefined =>
      comments.available
        ? {
            threads: comments.threads,
            active: activeAnchor?.path === path ? activeAnchor.anchor : undefined,
            onPick: anchor => setActiveAnchor(anchor === undefined ? undefined : { path, anchor }),
            onCreate: (body, anchor) => {
              comments.create(path, anchor, body)
              setActiveAnchor(undefined)
            },
            onReply: comments.reply,
            onResolve: comments.setResolved,
            onDelete: comments.remove,
          }
        : undefined,
    [comments, activeAnchor],
  )

  const markAll = (): void => marks.markMany(props.files.filter(file => !marks.viewed.has(file.path)).map(file => file.path))
  const clearAll = (): void => {
    for (const file of props.files) if (marks.viewed.has(file.path)) marks.toggle(file.path)
  }

  const jumpTo = (path: string): void => {
    setActivePath(path)
    setRailOpen(false)
    document.getElementById(`review-file-${String(props.files.find(file => file.path === path)?.index ?? 0)}`)?.scrollIntoView({ block: 'start' })
  }

  const nextUnviewed = (): void => {
    const index = props.files.findIndex(
      file => !marks.viewed.has(file.path) && (focusPath === undefined || file.index > (props.files.find(f => f.path === focusPath)?.index ?? -1)),
    )
    const file = props.files[index === -1 ? props.files.findIndex(item => !marks.viewed.has(item.path)) : index]
    if (file !== undefined) jumpTo(file.path)
  }

  const rail = (
    <div className="dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-2 dshx:p-2" data-review-rail="">
      <div className="dshx:relative">
        <Search className="dshx:absolute dshx:start-2 dshx:top-1/2 dshx:size-3.5 dshx:-translate-y-1/2 dshx:text-muted-foreground" aria-hidden />
        <Input
          aria-label="Filter changed files"
          className="dshx:h-7 dshx:ps-7 dshx:text-xs"
          placeholder="Filter files…"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>
      <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:overflow-y-auto">
        {visibleGroups.map(group => (
          <div key={group.key} className="dshx:flex dshx:flex-col dshx:gap-0.5">
            <div className="dshx:flex dshx:items-center dshx:gap-1 dshx:px-1 dshx:text-[10px] dshx:font-medium dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">
              <span className="dshx:truncate">{group.label}</span>
              <span className="dshx:ms-auto dshx:tabular-nums">{group.files.length}</span>
            </div>
            {group.key !== 'all' && aiSummaries?.[group.key] !== undefined && (
              <p className="dshx:px-1 dshx:text-[10px] dshx:leading-snug dshx:text-muted-foreground" data-review-scope-summary={group.key}>
                {aiSummaries[group.key]}
              </p>
            )}
            {group.files.map(file => {
              const viewed = marks.viewed.has(file.path)
              const count = threadsAt(comments.threads, file.path).countByPath
              return (
                <div
                  key={file.path}
                  data-review-rail-file={file.path}
                  className={cn(
                    'dshx:group/rail dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded dshx:px-1.5 dshx:py-1 dshx:text-xs dshx:hover:bg-accent',
                    focusPath === file.path && 'dshx:bg-accent',
                    viewed && 'dshx:opacity-60',
                  )}
                >
                  <Checkbox
                    aria-label={`Toggle ${file.display} viewed in the file list`}
                    checked={viewed}
                    className="dshx:size-3.5 dshx:shrink-0 data-[state=checked]:border-success data-[state=checked]:bg-success"
                    onCheckedChange={() => marks.toggle(file.path)}
                  />
                  <button type="button" className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-start" onClick={() => jumpTo(file.path)}>
                    {file.display}
                  </button>
                  {count > 0 && <span className="dshx:shrink-0 dshx:text-[10px] dshx:text-muted-foreground">{count}</span>}
                  <span className="dshx:shrink-0 dshx:font-mono dshx:text-[10px] dshx:text-success">+{file.additions}</span>
                  <span className="dshx:shrink-0 dshx:font-mono dshx:text-[10px] dshx:text-destructive">−{file.deletions}</span>
                </div>
              )
            })}
          </div>
        ))}
        {visibleGroups.length === 0 && <p className="dshx:p-2 dshx:text-xs dshx:text-muted-foreground">No file matches.</p>}
      </div>
    </div>
  )

  return (
    <div
      className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background"
      data-review-surface=""
      data-review-source={props.source.kind}
    >
      <header className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-b dshx:border-border dshx:px-2 dshx:py-1.5">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
          <div
            className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:border dshx:border-border dshx:p-0.5"
            role="group"
            aria-label="Review source"
          >
            <Button
              size="xs"
              variant={props.mode === 'turn' ? 'secondary' : 'ghost'}
              disabled={props.turn === undefined}
              data-review-source-button="turn"
              onClick={() => props.onSwitchMode('turn')}
            >
              This turn
            </Button>
            <Button
              size="xs"
              variant={props.mode === 'workspace' ? 'secondary' : 'ghost'}
              disabled={props.workspacePath === undefined && props.workspaceSource === undefined}
              data-review-source-button="workspace"
              onClick={() => props.onSwitchMode('workspace')}
            >
              Workspace
            </Button>
          </div>
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground" data-review-range="">
            {props.source.kind === 'turn' ? `turn ${String(props.source.turn)}` : props.source.range} · {totals.files} {totals.files === 1 ? 'file' : 'files'} ·
            +{totals.additions} −{totals.deletions}
          </span>
          <span className="dshx:shrink-0 dshx:text-[11px] dshx:tabular-nums dshx:text-muted-foreground" data-review-progress="">
            {viewedCount}/{totals.files} viewed
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Review actions">
                <Ellipsis aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dshx:w-56">
              <DropdownMenuLabel>Review</DropdownMenuLabel>
              <DropdownMenuItem onSelect={markAll}>
                <Checkbox checked={viewedCount === totals.files} aria-hidden className="dshx:size-3.5" /> Mark all viewed
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={clearAll}>
                <Checkbox checked={false} aria-hidden className="dshx:size-3.5" /> Clear viewed
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={nextUnviewed}>
                <ChevronRight aria-hidden /> Next unviewed file
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={autoMark} onCheckedChange={toggleAutoMark} disabled={!marks.writable}>
                Auto-mark viewed on scroll
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.hideViewed} onCheckedChange={next => surfacePrefs.set({ ...prefs, hideViewed: next })}>
                Hide viewed files
              </DropdownMenuCheckboxItem>
              {props.mode === 'workspace' && props.workspacePath !== undefined && (
                <DropdownMenuItem disabled={summarize.isPending} onSelect={() => summarize.mutate()}>
                  <Rows3 aria-hidden /> {summarize.isPending ? 'Summarizing…' : aiSummaries === undefined ? 'Summarize scopes' : 'Re-summarize scopes'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {props.onExpand !== undefined && (
                <DropdownMenuItem onSelect={() => props.onExpand?.({ turn: props.turn, workspacePath: props.workspacePath, sessionId: props.sessionId })}>
                  <Expand aria-hidden /> Open full page
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={!settings.writable}
                onSelect={() => {
                  void settings.set('classicReviewTab', true)
                }}
              >
                <Rows3 aria-hidden /> Use classic tab
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1">
          <Button
            size="xs"
            variant="ghost"
            className="dshx:@min-pane-compact:hidden"
            onClick={() => setRailOpen(open => !open)}
            aria-expanded={railOpen}
            aria-label="Toggle file list"
          >
            <ListFilter aria-hidden /> Files
          </Button>
          <Button size="xs" variant="ghost" aria-label="Jump to next unviewed file" onClick={nextUnviewed}>
            Next unviewed
          </Button>
          <span className="dshx:ms-auto dshx:flex dshx:items-center dshx:gap-1">
            <Button
              size="xs"
              variant={prefs.layout === 'unified' ? 'secondary' : 'ghost'}
              aria-pressed={prefs.layout === 'unified'}
              onClick={() => surfacePrefs.set({ ...prefs, layout: 'unified' })}
            >
              Unified
            </Button>
            <Button
              size="xs"
              variant={prefs.layout === 'split' ? 'secondary' : 'ghost'}
              aria-pressed={prefs.layout === 'split'}
              onClick={() => surfacePrefs.set({ ...prefs, layout: 'split' })}
            >
              Split
            </Button>
            <Button
              size="icon-sm"
              variant={prefs.wrap ? 'secondary' : 'ghost'}
              aria-pressed={prefs.wrap}
              aria-label="Wrap long lines"
              onClick={() => surfacePrefs.set({ ...prefs, wrap: !prefs.wrap })}
            >
              <TextWrap aria-hidden />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Reload review" onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden />
            </Button>
          </span>
        </div>
        <Progress value={progress} aria-label={`${String(progress)}% viewed`} className="dshx:h-0.5" />
        {summarize.data?.status === 'failed' && <p className="dshx:text-[10px] dshx:text-muted-foreground">{summarize.data.message}</p>}
      </header>
      <div className="dshx:relative dshx:flex dshx:min-h-0 dshx:flex-1">
        <aside className="dshx:hidden dshx:w-64 dshx:shrink-0 dshx:border-e dshx:border-border dshx:@min-pane-compact:block" data-review-rail-column="">
          {rail}
        </aside>
        {railOpen && (
          <div className="dshx:absolute dshx:inset-0 dshx:z-20 dshx:bg-background/95 dshx:@min-pane-compact:hidden">
            <div className="dshx:flex dshx:items-center dshx:justify-end dshx:p-1">
              <Button size="xs" variant="ghost" onClick={() => setRailOpen(false)}>
                Close
              </Button>
            </div>
            <div className="dshx:h-[calc(100%-2rem)]">{rail}</div>
          </div>
        )}
        <div ref={scrollRoot} className="dshx:min-w-0 dshx:flex-1 dshx:overflow-y-auto dshx:overscroll-contain" data-review-scroll="">
          {props.files.map(file => (
            <ReviewFileSection
              key={file.path}
              file={file}
              comparison={workspaceComparisons.get(file.path)}
              loadComparison={
                props.source.kind === 'turn'
                  ? signal => readTurnComparison(props.source as Extract<ReviewSource, { kind: 'turn' }>, file.index, signal)
                  : undefined
              }
              collapsed={collapsed.has(file.path)}
              onToggleCollapsed={() => toggleCollapsed(file.path)}
              viewed={marks.viewed.has(file.path)}
              onToggleViewed={() => marks.toggle(file.path)}
              commentCount={threadsAt(comments.threads, file.path).countByPath}
              comments={binding(file.path)}
              layout={prefs.layout}
              wrap={prefs.wrap}
              onPassed={onPassed}
              root={scrollRoot}
            />
          ))}
          {props.files.length === 0 && <p className="dshx:p-4 dshx:text-xs dshx:text-muted-foreground">No changed files.</p>}
        </div>
      </div>
    </div>
  )
}
