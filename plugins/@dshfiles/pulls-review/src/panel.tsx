import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { PatchView, parsePatchFiles } from '@dshfiles/plugin-ui/diff'
import { Check, ChevronLeft, ChevronRight, RefreshCw, Sparkles } from '@dshfiles/plugin-ui/icons'
import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { z } from 'zod'
import { MAX_FILES, pullsReviewApi } from './api.js'
import { ReviewedMarksModel } from './reviewed.js'
import type { SessionFocus } from './session-focus.js'

const NO_REVIEWED: Record<string, string[]> = {}
const reviewedStore = createStoredValue({
  key: 'dshfiles-pulls-review:reviewed',
  schema: z.record(z.string(), z.array(z.string().max(2048)).max(MAX_FILES)),
  fallback: NO_REVIEWED,
})

export interface PullsReviewPanelProps {
  readonly sessions: ISessions
  readonly focus: SessionFocus
}

const noBody = (): undefined => undefined

const HINT = 'dshx:text-xs dshx:text-muted-foreground'
const SURFACE = 'dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card'

const Stat = (props: { readonly label: string; readonly tone?: 'add' | 'del' }): ReactNode => (
  <span
    className={cn(
      'dshx:font-mono dshx:text-xs',
      props.tone === 'add' ? 'dshx:text-success' : props.tone === 'del' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
    )}
  >
    {props.label}
  </span>
)

export const PullsReviewPanel = (props: PullsReviewPanelProps): ReactNode => {
  const api = useApi(pullsReviewApi)
  const reviewed = reviewedStore.useValue()

  const subscribeMounted = useCallback((listener: () => void) => props.focus.subscribe(listener), [props.focus])
  const readMounted = useCallback(() => props.focus.getSnapshot(), [props.focus])
  const sessionId = useSyncExternalStore(subscribeMounted, readMounted, noBody)

  const subscribeSessions = useCallback((listener: () => void) => props.sessions.list.subscribe(listener), [props.sessions])
  const readCwd = useCallback(() => (sessionId === undefined ? undefined : props.sessions.list.getSnapshot().byId[sessionId]?.cwd), [props.sessions, sessionId])
  const cwd = useSyncExternalStore(subscribeSessions, readCwd, noBody)

  const query = useQuery({
    queryKey: ['pulls-review', cwd ?? ''],
    enabled: cwd !== undefined && cwd.length > 0,
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 60_000,
        request: hostSignal => api.review({ path: cwd ?? '' }, { signal: hostSignal }),
      }),
  })

  const result = query.data
  const head = result?.status === 'ok' ? result.head : undefined
  const base = result?.status === 'ok' ? result.base : undefined
  const summarize = useMutation({
    mutationFn: () =>
      runHostRequest({
        timeoutMs: 120_000,
        request: signal => api.summarize(sessionId === undefined ? { path: cwd ?? '' } : { path: cwd ?? '', sessionId: String(sessionId) }, { signal }),
      }),
  })
  const summarized = summarize.data
  const aiSummaries = summarized?.status === 'ok' ? summarized.summaries : undefined
  const scopeKeyOf = cwd !== undefined && head !== undefined ? ReviewedMarksModel.keyOf(cwd, base ?? '', head) : undefined
  const reviewedPaths = useMemo(() => {
    const paths = scopeKeyOf === undefined ? undefined : reviewed[scopeKeyOf]
    return new Set(paths ?? [])
  }, [reviewed, scopeKeyOf])

  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined)
  const [selection, setSelection] = useState<ListSelection<string>>(() => ListSelectionModel.empty())
  useEffect(() => {
    setSelectedKey(undefined)
    setSelection(ListSelectionModel.empty())
  }, [cwd, head])

  const scopes = result?.status === 'ok' ? result.scopes : []
  const scope = scopes.find(candidate => candidate.key === selectedKey) ?? scopes[0]
  const scopeIndex = scope === undefined ? -1 : scopes.indexOf(scope)
  const scopePaths = useMemo(() => scope?.filePaths ?? [], [scope])
  useEffect(() => {
    setSelection(current => {
      const next = ListSelectionModel.prune({ state: current, visibleIds: scopePaths })
      return next.ids.length === current.ids.length && next.anchorId === current.anchorId ? current : next
    })
  }, [scopePaths])

  const resetSummarize = summarize.reset
  useEffect(() => {
    resetSummarize()
  }, [head, resetSummarize])

  const parsed = useMemo(() => (result?.status === 'ok' && result.patch.length > 0 ? parsePatchFiles(result.patch).flatMap(file => file.files) : []), [result])
  const scopeFiles = useMemo(() => {
    if (scope === undefined) return []
    const wanted = new Set(scope.filePaths)
    return parsed.filter(file => wanted.has(file.name))
  }, [parsed, scope])

  const statsByPath = useMemo(() => new Map((result?.status === 'ok' ? result.files : []).map(file => [file.path, file])), [result])

  const totalReviewed =
    result?.status === 'ok' ? result.scopes.reduce((total, item) => total + item.filePaths.filter(path => reviewedPaths.has(path)).length, 0) : 0
  const progress = result !== undefined && result.status === 'ok' && result.fileCount > 0 ? Math.round((totalReviewed / result.fileCount) * 100) : 0

  const markReviewed = (path: string): void => {
    if (scopeKeyOf === undefined) return
    reviewedStore.set(ReviewedMarksModel.record(reviewed, scopeKeyOf, ReviewedMarksModel.toggle(reviewed[scopeKeyOf] ?? [], path)))
  }

  const selectedPaths = useMemo(() => new Set(selection.ids), [selection.ids])
  const clearSelection = (): void => setSelection(ListSelectionModel.empty())
  const togglePath = (path: string): void => setSelection(current => ListSelectionModel.toggle({ state: current, id: path }))
  const extendPath = (path: string): void => setSelection(current => ListSelectionModel.extend({ state: current, orderedIds: scopePaths, id: path }))
  const applyReviewed = (nextReviewed: boolean): void => {
    if (scopeKeyOf === undefined || selection.ids.length === 0) return
    const current = reviewed[scopeKeyOf] ?? []
    const next = nextReviewed ? ReviewedMarksModel.mark(current, selection.ids) : ReviewedMarksModel.unmark(current, selection.ids)
    reviewedStore.set(ReviewedMarksModel.record(reviewed, scopeKeyOf, next))
    clearSelection()
  }

  const selectScope = (next: number): void => {
    const target = scopes[next]
    if (target !== undefined) setSelectedKey(target.key)
  }

  const footer = ((): ReactNode => {
    if (sessionId === undefined) return <p className={HINT}>Open a thread to review its changes.</p>
    if (cwd === undefined || cwd.length === 0) return <p className={HINT}>This thread has no workspace folder.</p>
    if (query.isPending) return <p className={HINT}>Reading the workspace diff…</p>
    if (query.isError) return <p className="dshx:text-xs dshx:text-destructive">{errorMessage(query.error, 'The workspace diff could not be read.')}</p>
    if (result === undefined) return null
    if (result.status === 'failed') return <p className="dshx:text-xs dshx:text-destructive">{result.message}</p>
    if (summarize.isError) return <p className="dshx:text-xs dshx:text-destructive">{errorMessage(summarize.error, 'Summarizing failed.')}</p>
    if (summarized?.status === 'failed') return <p className={HINT}>{summarized.message}</p>
    if (summarize.isPending)
      return (
        <p className={HINT}>
          Summarizing {scopes.length} scope{scopes.length === 1 ? '' : 's'} with the thread model…
        </p>
      )
    if (summarized?.status === 'ok')
      return (
        <p className={HINT}>
          Summaries from {summarized.route.provider} · {summarized.route.model}
        </p>
      )
    return null
  })()

  return (
    <section className="dshx-root dshx:@container dshx:flex dshx:size-full dshx:min-h-0 dshx:flex-col dshx:gap-3 dshx:p-4">
      <header className="dshx:flex dshx:flex-col dshx:gap-2">
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <h2 className="dshx:text-sm dshx:font-semibold">pulls.review</h2>
          {result?.status === 'ok' ? (
            <Badge variant="secondary" className="dshx:font-mono dshx:text-[11px]">
              {result.range}
            </Badge>
          ) : null}
          <span className="dshx:ml-auto" />
          {result?.status === 'ok' && result.fileCount > 0 && scopes.length > 0 ? (
            <Button variant="outline" size="sm" disabled={summarize.isPending} onClick={() => summarize.mutate()} className="dshx:gap-1.5 dshx:shrink">
              <Sparkles aria-hidden className={cn('dshx:size-3.5', summarize.isPending && 'dshx:animate-pulse')} />
              {aiSummaries === undefined ? 'Summarize' : 'Re-summarize'}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" aria-label="Refresh" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden className={cn(query.isFetching && 'dshx:animate-spin')} />
          </Button>
        </div>
        {result?.status === 'ok' ? (
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Stat label={result.fileCount === 1 ? '1 file' : `${result.fileCount} files`} />
            <Stat label={`+${result.additions}`} tone="add" />
            <Stat label={`−${result.deletions}`} tone="del" />
            <Stat label={`${totalReviewed}/${result.fileCount} reviewed`} />
            <Progress value={progress} className="dshx:min-w-24 dshx:flex-1" />
          </div>
        ) : null}
        {result?.status === 'ok' && result.truncated ? (
          <p className={HINT}>The diff was too large for one read and is truncated; refresh after the workspace settles.</p>
        ) : null}
      </header>

      {footer}

      {result?.status === 'ok' && result.fileCount === 0 ? <p className={HINT}>This thread has no changes since {result.base} yet.</p> : null}

      {scopes.length > 0 ? (
        <>
          <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
            {scopes.map(item => {
              const itemReviewed = item.filePaths.filter(path => reviewedPaths.has(path)).length
              const active = item.key === scope?.key
              return (
                <Button
                  key={item.key}
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setSelectedKey(item.key)}
                  title={item.summary}
                  className={cn('dshx:gap-1.5 dshx:font-normal', !active && 'dshx:text-muted-foreground')}
                >
                  {item.label}
                  <span className="dshx:font-mono dshx:text-[11px] dshx:opacity-70">
                    {itemReviewed}/{item.filePaths.length}
                  </span>
                </Button>
              )
            })}
          </div>

          {scope !== undefined ? (
            <div className={cn(SURFACE, 'dshx:flex dshx:flex-col dshx:gap-2 dshx:p-3')}>
              <div className="dshx:flex dshx:items-start dshx:gap-2">
                <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                  <span className="dshx:text-xs dshx:font-medium">{scope.label}</span>
                  <span className={HINT}>{aiSummaries?.[scope.key] ?? scope.summary}</span>
                </div>
                <span className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
                  <Button variant="ghost" size="icon" aria-label="Previous scope" disabled={scopeIndex <= 0} onClick={() => selectScope(scopeIndex - 1)}>
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next scope"
                    disabled={scopeIndex >= scopes.length - 1}
                    onClick={() => selectScope(scopeIndex + 1)}
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </span>
              </div>

              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-[11px]">
                <label className="dshx:flex dshx:items-center dshx:gap-1">
                  <input
                    type="checkbox"
                    aria-label="Select all files in this scope"
                    checked={ListSelectionModel.isComplete({ state: selection, orderedIds: scopePaths })}
                    onChange={() => setSelection(current => ListSelectionModel.toggleAllVisible({ state: current, orderedIds: scopePaths }))}
                    className="dshx:size-3.5 dshx:accent-[var(--color-info)]"
                  />
                  Select all
                </label>
                <span className="dshx:text-muted-foreground">Shift-click extends, Cmd/Ctrl-click toggles</span>
                {selection.ids.length === 0 ? null : (
                  <span className="dshx:ml-auto dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
                    <span className="dshx:mr-1 dshx:tabular-nums">{selection.ids.length} selected</span>
                    <Button size="xs" variant="secondary" onClick={() => applyReviewed(true)}>
                      Mark selected reviewed
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => applyReviewed(false)}>
                      Mark selected unreviewed
                    </Button>
                    <Button size="xs" variant="ghost" onClick={clearSelection}>
                      Clear
                    </Button>
                  </span>
                )}
              </div>

              <ul className="dshx:flex dshx:max-h-40 dshx:flex-col dshx:gap-0.5 dshx:overflow-auto">
                {scope.filePaths.map(path => {
                  const file = statsByPath.get(path)
                  const isReviewed = reviewedPaths.has(path)
                  const isSelected = selectedPaths.has(path)
                  return (
                    <li key={path} className={cn(isSelected && 'dshx:rounded-md dshx:bg-info/8')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Click to mark reviewed; Shift-click selects a range; Cmd/Ctrl-click toggles the selection"
                        className="dshx:w-full dshx:justify-start dshx:gap-2 dshx:font-mono dshx:text-[11px]"
                        onClick={event => {
                          if (event.shiftKey) {
                            extendPath(path)
                            return
                          }
                          if (event.metaKey || event.ctrlKey) {
                            togglePath(path)
                            return
                          }
                          markReviewed(path)
                        }}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'dshx:flex dshx:size-3.5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-sm dshx:border dshx:border-border',
                            isReviewed && 'dshx:border-primary dshx:bg-primary dshx:text-primary-foreground',
                          )}
                        >
                          {isReviewed ? <Check className="dshx:size-3" aria-hidden /> : null}
                        </span>
                        <span className="dshx:min-w-0 dshx:truncate">{path}</span>
                        {file === undefined ? null : (
                          <span className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:gap-1">
                            <Stat label={`+${file.additions}`} tone="add" />
                            <Stat label={`−${file.deletions}`} tone="del" />
                          </span>
                        )}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          <div className={cn(SURFACE, 'dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:overflow-hidden')}>
            <PatchView
              files={scopeFiles}
              className="dshx:flex-1"
              empty={<p className={cn(HINT, 'dshx:p-3')}>This scope renders no diff hunks.</p>}
              renderHeaderMetadata={file => {
                const isReviewed = reviewedPaths.has(file.name)
                return (
                  <Button
                    variant={isReviewed ? 'secondary' : 'ghost'}
                    size="sm"
                    className="dshx:gap-1 dshx:text-[11px]"
                    onClick={() => markReviewed(file.name)}
                  >
                    <Check aria-hidden className="dshx:size-3" />
                    {isReviewed ? 'Reviewed' : 'Mark reviewed'}
                  </Button>
                )
              }}
            />
          </div>
        </>
      ) : null}
    </section>
  )
}
