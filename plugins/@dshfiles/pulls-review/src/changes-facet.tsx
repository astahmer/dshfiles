import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Composer, useApi, useContract } from '@dshfiles/dshx/client'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { PatchView, parsePatchFiles, type PatchLineSelection } from '@dshfiles/plugin-ui/diff'
import { MessageSquarePlus, RefreshCw, X } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { pullsReviewApi } from './api.js'
import { ChangesScopeModel, changesScopeSchema, type ChangesRequest, type ChangesScope } from './changes-scope.js'
import { LandCard } from './land-card.js'
import { TurnChangesModel, type TurnChangesEvent } from './turn-changes.js'
import { useRangeViewedMarks, useTurnViewedMarks, type ViewedMarksView } from './viewed-marks.js'
import { Schema } from 'effect'

export interface ChangesFacetProps {
  readonly sessionId: string | undefined
  /** What the opener asked for (a turn's card, a scope); a new `requestRevision` applies it again. */
  readonly request: ChangesRequest | undefined
  readonly requestRevision: number
  readonly sessions: ISessions
  readonly openHistory: () => void
}

const HINT = 'dshx:text-xs dshx:text-muted-foreground'
/** One turn can list many files; the facet reads at most this many comparisons and says so. */
const MAX_TURN_DIFFS = 150
const noValue = (): undefined => undefined

interface FacetFile {
  readonly path: string
  readonly display: string
  readonly added: number
  readonly deleted: number
}

interface FacetDiff {
  readonly files: readonly FacetFile[]
  readonly patch: string
  readonly truncated: boolean
  readonly label: string
}

interface UserQuestionsProjection {
  readonly userQuestions?: { readonly active: readonly unknown[] }
}

const isScope = Schema.is(changesScopeSchema)

const Stat = (props: { readonly children: ReactNode; readonly tone?: 'add' | 'del' }): JSX.Element => (
  <span
    className={cn(
      'dshx:font-mono dshx:text-xs dshx:tabular-nums',
      props.tone === 'add' ? 'dshx:text-success' : props.tone === 'del' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
    )}
  >
    {props.children}
  </span>
)

const useThreadSummary = (sessions: ISessions, sessionId: string | undefined) => {
  const subscribe = useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions])
  const readCwd = useCallback(() => (sessionId === undefined ? undefined : sessions.list.getSnapshot().byId[SessionId(sessionId)]?.cwd), [sessions, sessionId])
  const readBusy = useCallback(() => {
    if (sessionId === undefined) return false
    const summary = sessions.list.getSnapshot().byId[SessionId(sessionId)]
    if (summary === undefined) return false
    const projection: UserQuestionsProjection | undefined = summary.projectionValues
    return summary.running || (projection?.userQuestions?.active.length ?? 0) > 0
  }, [sessions, sessionId])
  return {
    cwd: useSyncExternalStore(subscribe, readCwd, noValue),
    busy: useSyncExternalStore(subscribe, readBusy, () => false),
  }
}

/** Fetch one document-relative Host route as JSON; a non-2xx answer is an error the facet can show. */
const fetchJson = async (url: string, signal: AbortSignal): Promise<unknown> => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`The Host answered ${String(response.status)} for this turn's changes; it keeps them only while the thread is loaded.`)
  return response.json()
}

const readTurnDiff = async (input: { readonly sessionId: string; readonly seq: number; readonly signal: AbortSignal }): Promise<FacetDiff> => {
  const summary = TurnChangesModel.decodeSummary(await fetchJson(TurnChangesModel.summaryUrl(input.sessionId, input.seq), input.signal))
  if (summary === undefined) throw new Error("This turn's change summary could not be read. Refresh to try again.")
  const listed = summary.files.slice(0, MAX_TURN_DIFFS)
  const patches = await Promise.all(
    listed.map(async (file, index) => {
      if (file.binary === true || file.oversized === true) return ''
      const diff = TurnChangesModel.decodeDiff(await fetchJson(TurnChangesModel.diffUrl(input.sessionId, input.seq, index), input.signal))
      return diff === undefined ? '' : TurnChangesModel.patchOf(diff)
    }),
  )
  return {
    files: listed.map(file => ({ path: file.path, display: file.display, added: file.added, deleted: file.deleted })),
    patch: patches.join(''),
    truncated: summary.files.length > listed.length,
    label: `Turn ${String(summary.turn)}`,
  }
}

/**
 * The thread panel's Changes facet: one thread's work in four scopes (this turn, whole thread, uncommitted, vs the
 * target bookmark), its files with viewed marks from diff-viewed's one store, the diff with line comments that queue
 * as composer chips, and the Land card on top.
 */
export const ChangesFacet = (props: ChangesFacetProps): JSX.Element => {
  const review = useApi(pullsReviewApi)
  const jj = useApi(jjIntegrationApi)
  const composer = useContract(Composer)
  const queryClient = useQueryClient()
  const { cwd, busy } = useThreadSummary(props.sessions, props.sessionId)
  const [scope, setScope] = useState<ChangesScope | undefined>(props.request?.scope)
  const [seq, setSeq] = useState<number | undefined>(props.request?.seq)
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [selection, setSelection] = useState<PatchLineSelection | null>(null)
  const [comment, setComment] = useState('')
  const [commentNotice, setCommentNotice] = useState<string | null>(null)

  useEffect(() => {
    if (props.request === undefined) return
    setScope(props.request.scope)
    if (props.request.seq !== undefined) setSeq(props.request.seq)
  }, [props.request, props.requestRevision])
  useEffect(() => {
    setSelection(null)
    setFocusPath(null)
  }, [props.sessionId])

  const status = useQuery({
    queryKey: ['pulls-review', 'land', cwd ?? ''],
    enabled: cwd !== undefined && cwd.length > 0,
    refetchInterval: 15_000,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => jj.threadStatus({ path: cwd ?? '' }, { signal: hostSignal }) }),
  })
  const bookmark = status.data?.bookmark ?? 'main'
  const isolated = status.data?.thread !== null && status.data?.thread !== undefined
  const turns = useQuery({
    queryKey: ['pulls-review', 'turns', props.sessionId],
    enabled: props.sessionId !== undefined,
    refetchInterval: 15_000,
    queryFn: ({ signal }) =>
      props.sessions.using(SessionId(props.sessionId ?? ''), { source: 'controllerOperation', signal }, async reference => {
        const binding = await reference.ready
        return TurnChangesModel.events(binding.eventSource.getSnapshot().entries)
      }),
  })
  const turnList: readonly TurnChangesEvent[] = turns.data ?? []
  const latestTurn = turnList.at(-1)
  const activeScope: ChangesScope = scope ?? ChangesScopeModel.defaultScope({ isolated, hasTurn: latestTurn !== undefined })
  const activeSeq = seq ?? latestTurn?.seq
  const base = ChangesScopeModel.base(activeScope, bookmark)

  const rangeDiff = useQuery({
    queryKey: ['pulls-review', 'facet', cwd ?? '', base ?? ''],
    enabled: activeScope !== 'turn' && base !== undefined && cwd !== undefined && cwd.length > 0 && status.data !== undefined,
    queryFn: ({ signal }) =>
      runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => review.review({ path: cwd ?? '', base }, { signal: hostSignal }) }),
  })
  const turnDiff = useQuery({
    queryKey: ['pulls-review', 'facet-turn', props.sessionId, activeSeq],
    enabled: activeScope === 'turn' && props.sessionId !== undefined && activeSeq !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) => readTurnDiff({ sessionId: props.sessionId ?? '', seq: activeSeq ?? 0, signal }),
  })

  const rangeResult = rangeDiff.data
  const range =
    activeScope !== 'turn' && rangeResult?.status === 'ok' && cwd !== undefined
      ? { workspacePath: cwd, base: rangeResult.base, head: rangeResult.head }
      : undefined
  const rangeMarks = useRangeViewedMarks(range)
  const turnMarks = useTurnViewedMarks(
    activeScope === 'turn' && props.sessionId !== undefined && activeSeq !== undefined ? { sessionId: props.sessionId, seq: activeSeq } : undefined,
  )
  const marks: ViewedMarksView = activeScope === 'turn' ? turnMarks : rangeMarks

  const turnData = turnDiff.data
  const diff = useMemo((): FacetDiff | undefined => {
    if (activeScope === 'turn') return turnData
    if (rangeResult?.status !== 'ok') return undefined
    return {
      files: rangeResult.files.map(file => ({ path: file.path, display: file.path, added: file.additions, deleted: file.deletions })),
      patch: rangeResult.patch,
      truncated: rangeResult.truncated,
      label: rangeResult.range,
    }
  }, [activeScope, rangeResult, turnData])
  const parsedFiles = useMemo(() => (diff === undefined || diff.patch.length === 0 ? [] : parsePatchFiles(diff.patch).flatMap(file => file.files)), [diff])
  const paths = useMemo(() => (diff?.files ?? []).map(file => file.path), [diff])
  const viewedCount = paths.filter(path => marks.viewed.has(path)).length
  const additions = (diff?.files ?? []).reduce((total, file) => total + file.added, 0)
  const deletions = (diff?.files ?? []).reduce((total, file) => total + file.deleted, 0)

  const refreshDiff = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['pulls-review', 'facet'] })
    void queryClient.invalidateQueries({ queryKey: ['pulls-review', 'turns', props.sessionId] })
    void status.refetch()
  }

  const addComment = (): void => {
    if (selection === null || comment.trim().length === 0 || props.sessionId === undefined) return
    if (composer.status !== 'active') {
      setCommentNotice('The composer is not loaded, so the comment cannot be queued. Copy it into your next message instead.')
      return
    }
    const text = selection.side === 'deletions' ? `(on removed lines) ${comment.trim()}` : comment.trim()
    const path = selection.file.name
    // A one-line comment names no end line.
    const added = composer.value.attach({
      sessionId: props.sessionId,
      attachment:
        selection.end === selection.start
          ? { kind: 'comment', path, line: selection.start, text }
          : { kind: 'comment', path, line: selection.start, endLine: selection.end, text },
    })
    if (!added) {
      setCommentNotice("This thread's composer is not on screen. Open the thread, then add the comment again.")
      return
    }
    setCommentNotice('Added to your next message.')
    setComment('')
    setSelection(null)
  }

  if (props.sessionId === undefined)
    return (
      <div className="dshx-root dshx:p-4">
        <EmptyState>Open a thread to review its changes.</EmptyState>
      </div>
    )

  const loading = activeScope === 'turn' ? turnDiff.isPending && activeSeq !== undefined : rangeDiff.isPending || status.isPending
  const readFailure = (): string | undefined => {
    if (activeScope === 'turn') return turnDiff.isError ? errorMessage(turnDiff.error, "This turn's changes could not be read.") : undefined
    if (rangeDiff.isError) return errorMessage(rangeDiff.error, "The workspace's diff could not be read.")
    if (rangeResult?.status !== 'failed') return undefined
    if (rangeResult.reason === 'not-a-repository')
      return `${rangeResult.message} Revision scopes need a Jujutsu workspace; This turn still shows what each turn wrote.`
    return rangeResult.message
  }
  const failure = readFailure()
  /** Which one body the facet shows under its scope picker, in priority order. */
  const readView = (): 'no-turn' | 'loading' | 'failure' | 'none' | 'empty' | 'files' => {
    if (activeScope === 'turn' && latestTurn === undefined && !turns.isPending) return 'no-turn'
    if (loading) return 'loading'
    if (failure !== undefined) return 'failure'
    if (diff === undefined) return 'none'
    return diff.files.length === 0 ? 'empty' : 'files'
  }
  const view = readView()

  return (
    <div
      className="dshx-root dshx:@container dshx:flex dshx:size-full dshx:min-h-0 dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:p-3"
      data-testid="changes-facet"
    >
      {cwd === undefined || cwd.length === 0 ? null : (
        <LandCard cwd={cwd} onLanded={refreshDiff} openHistory={props.openHistory} sessionId={props.sessionId} threadBusy={busy} />
      )}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <ToggleGroup
          aria-label="Changes scope"
          className="dshx:max-w-full dshx:flex-wrap"
          onValueChange={value => {
            if (isScope(value)) {
              setScope(value)
              setSelection(null)
            }
          }}
          size="sm"
          type="single"
          value={activeScope}
          variant="outline"
        >
          {ChangesScopeModel.scopes.map(option => (
            <ToggleGroupItem aria-label={ChangesScopeModel.label(option, bookmark)} className="dshx:px-2 dshx:text-xs" key={option} value={option}>
              {ChangesScopeModel.label(option, bookmark)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {activeScope === 'turn' && turnList.length > 1 ? (
          <Select onValueChange={value => setSeq(Number(value))} value={String(activeSeq ?? latestTurn?.seq ?? '')}>
            <SelectTrigger aria-label="Turn" className="dshx:h-7 dshx:w-auto dshx:text-xs" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...turnList].reverse().map(event => (
                <SelectItem key={event.seq} value={String(event.seq)}>
                  Turn {event.turn}
                  {event.seq === latestTurn?.seq ? ' (latest)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button aria-label="Refresh changes" className="dshx:ml-auto" onClick={refreshDiff} size="icon-xs" type="button" variant="ghost">
          <RefreshCw aria-hidden className="dshx:size-3.5" />
        </Button>
      </div>
      <p className={HINT}>{ChangesScopeModel.hint(activeScope, bookmark)}</p>

      {view === 'no-turn' ? <EmptyState>No turn of this thread changed files yet.</EmptyState> : null}
      {view === 'loading' ? (
        <p className={cn(HINT, 'dshx:flex dshx:items-center dshx:gap-2')}>
          <Spinner /> Reading changes…
        </p>
      ) : null}
      {view === 'failure' ? (
        <p className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive" role="alert">
          <span className="dshx:min-w-0">{failure}</span>
          <Button onClick={refreshDiff} size="xs" variant="outline">
            Try again
          </Button>
        </p>
      ) : null}
      {view === 'empty' ? <EmptyState>No changes in this scope.</EmptyState> : null}
      {view === 'files' && diff !== undefined ? (
        <>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2" data-testid="changes-summary">
            <Stat>{diff.files.length === 1 ? '1 file' : `${String(diff.files.length)} files`}</Stat>
            <Stat tone="add">+{additions}</Stat>
            <Stat tone="del">−{deletions}</Stat>
            <Stat>
              {viewedCount}/{diff.files.length} viewed
            </Stat>
            <Progress className="dshx:min-w-16 dshx:flex-1" value={diff.files.length === 0 ? 0 : Math.round((viewedCount / diff.files.length) * 100)} />
            <Button
              disabled={!marks.ready}
              onClick={() => marks.set(viewedCount === paths.length ? paths : paths.filter(path => !marks.viewed.has(path)), viewedCount !== paths.length)}
              size="xs"
              type="button"
              variant="outline"
            >
              {viewedCount === paths.length ? 'Mark all not viewed' : 'Mark all viewed'}
            </Button>
          </div>
          {diff.truncated ? <p className={HINT}>This diff is too large to show whole; only the first files are listed.</p> : null}
          {marks.unavailable ? (
            <p className={HINT} role="status">
              Viewed marks are kept by the diff-viewed plugin, which is not loaded. Add @dshfiles/diff-viewed to the profile to mark files.
            </p>
          ) : null}
          {marks.error === null || marks.error === undefined ? null : (
            <p className="dshx:text-xs dshx:text-destructive" role="alert">
              {errorMessage(marks.error, 'Viewed marks could not be saved; try again.')}
            </p>
          )}
          <ul aria-label="Changed files" className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border dshx:rounded-md dshx:border dshx:border-border">
            {diff.files.map(file => {
              const viewed = marks.viewed.has(file.path)
              return (
                <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:px-2 dshx:py-1" data-changes-file={file.path} key={file.path}>
                  <Checkbox
                    aria-label={`${viewed ? 'Mark not viewed' : 'Mark viewed'}: ${file.display}`}
                    checked={viewed}
                    className="dshx:size-3.5 dshx:data-[state=checked]:border-success dshx:data-[state=checked]:bg-success"
                    disabled={!marks.ready}
                    onCheckedChange={next => marks.set([file.path], next === true)}
                  />
                  <button
                    className={cn(
                      'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left dshx:font-mono dshx:text-xs dshx:hover:underline',
                      viewed && 'dshx:text-muted-foreground',
                    )}
                    onClick={() => setFocusPath(file.path)}
                    type="button"
                  >
                    {file.display}
                  </button>
                  <Stat tone="add">+{file.added}</Stat>
                  <Stat tone="del">−{file.deleted}</Stat>
                </li>
              )
            })}
          </ul>
          {selection === null ? (
            <p className={HINT}>Select line numbers in a diff to comment on them; comments wait in your next message.</p>
          ) : (
            <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:p-2" data-testid="changes-comment">
              <div className="dshx:flex dshx:items-center dshx:gap-2">
                <MessageSquarePlus aria-hidden className="dshx:size-3.5 dshx:text-muted-foreground" />
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs">
                  {selection.file.name}:{selection.start}
                  {selection.end === selection.start ? '' : `–${String(selection.end)}`}
                  {selection.side === 'deletions' ? ' (removed)' : ''}
                </span>
                <Button aria-label="Discard comment" onClick={() => setSelection(null)} size="icon-xs" type="button" variant="ghost">
                  <X aria-hidden className="dshx:size-3.5" />
                </Button>
              </div>
              <Textarea
                aria-label="Comment on the selected lines"
                className="dshx:min-h-16 dshx:text-xs"
                onChange={event => setComment(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) addComment()
                }}
                placeholder="What should change here?"
                value={comment}
              />
              <Button className="dshx:self-end" disabled={comment.trim().length === 0} onClick={addComment} size="xs" type="button">
                Add to next message
              </Button>
            </div>
          )}
          {commentNotice === null ? null : (
            <p className={HINT} role="status">
              {commentNotice}
            </p>
          )}
          <div
            className="dshx:flex dshx:min-h-64 dshx:flex-1 dshx:flex-col dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-border"
            data-testid="changes-diffs"
          >
            <PatchView
              className="dshx:flex-1"
              empty={<p className={cn(HINT, 'dshx:p-3')}>No diff lines to display (binary or oversized files).</p>}
              files={parsedFiles}
              focusPath={focusPath}
              onLineSelection={next => {
                setSelection(next)
                setCommentNotice(null)
              }}
              renderHeaderMetadata={file => {
                const viewed = marks.viewed.has(file.name)
                return (
                  <Button
                    aria-label={`${viewed ? 'Mark not viewed' : 'Mark viewed'}: ${file.name}`}
                    className="dshx:gap-1 dshx:text-[11px]"
                    disabled={!marks.ready}
                    onClick={() => marks.set([file.name], !viewed)}
                    size="sm"
                    variant={viewed ? 'secondary' : 'ghost'}
                  >
                    {viewed ? 'Viewed' : 'Mark viewed'}
                  </Button>
                )
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
