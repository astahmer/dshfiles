import { diffViewedApi, viewedFileFromKey, type RangeMarks, type ViewedRange, type ViewedTarget } from '@dshfiles/diff-viewed/marks-api'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useMutation, useQueries, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useState } from 'react'

/** An absent store owner is permanent for this page, so its query stops instead of asking every 10 s. */
const useStopWhenOwnerMissing = (error: Error | null, stop: () => void): void => {
  useEffect(() => {
    if (isApiOwnerMissing(error)) stop()
  }, [error, stop])
}

/**
 * Viewed marks live in diff-viewed's one Host store, keyed by revision range or by turn. These hooks read one range or
 * one turn, flip marks at once and reconcile with the Host's answer, so a click never waits on the round trip.
 */
export interface ViewedMarksView {
  readonly viewed: ReadonlySet<string>
  readonly ready: boolean
  readonly error: unknown
  /** diff-viewed, which owns the store, is not loaded: marks cannot be read or saved. */
  readonly unavailable: boolean
  readonly set: (paths: readonly string[], viewed: boolean) => void
}

const POLL_MS = 10_000
const emptyPaths: ReadonlySet<string> = new Set()

const rangeQueryKey = (range: ViewedRange | undefined) => ['pulls-review', 'viewed', 'range', range?.workspacePath, range?.base, range?.head] as const
const turnQueryKey = ['pulls-review', 'viewed', 'turns'] as const

const applyPaths = (current: readonly string[], paths: readonly string[], viewed: boolean): string[] => {
  const changed = new Set(paths)
  const kept = current.filter(path => !changed.has(path))
  return viewed ? [...kept, ...paths] : kept
}

export const useRangeViewedMarks = (range: ViewedRange | undefined): ViewedMarksView => {
  const api = useApi(diffViewedApi)
  const queryClient = useQueryClient()
  const key = rangeQueryKey(range)
  const [ownerMissing, setOwnerMissing] = useState(false)
  const stopPolling = useCallback(() => setOwnerMissing(true), [])
  const query = useQuery({
    queryKey: key,
    enabled: range !== undefined && !ownerMissing,
    refetchInterval: POLL_MS,
    retry: (count, error) => !isApiOwnerMissing(error) && count < 2,
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 30_000,
        request: hostSignal => api.rangeState(range ?? { workspacePath: '-', base: '-', head: '-' }, { signal: hostSignal }),
      }),
  })
  useStopWhenOwnerMissing(query.error, stopPolling)
  const mutation = useMutation({
    mutationFn: (input: { readonly paths: readonly string[]; readonly viewed: boolean }) => {
      if (range === undefined) return Promise.resolve(undefined)
      const targets: ViewedTarget[] = input.paths.map(path => ({ kind: 'range', ...range, path }))
      return runHostRequest({ timeoutMs: 30_000, request: signal => api.set({ targets, viewed: input.viewed }, { signal }) })
    },
    onMutate: async input => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<RangeMarks>(key)
      if (previous !== undefined) queryClient.setQueryData<RangeMarks>(key, { ...previous, paths: applyPaths(previous.paths, input.paths, input.viewed) })
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
  const paths = query.data?.paths
  const viewed = useMemo(() => (paths === undefined ? emptyPaths : new Set(paths)), [paths])
  return {
    viewed,
    ready: query.data !== undefined,
    error: ownerMissing ? null : (mutation.error ?? query.error),
    unavailable: ownerMissing,
    set: (changed, next) => {
      if (changed.length > 0) mutation.mutate({ paths: changed, viewed: next })
    },
  }
}

/** One file of one revision in a combined review. */
export interface RevisionFile {
  readonly commitId: string
  readonly path: string
}

/** Marks of a combined review, per revision: a file two revisions touched is read once in each. */
export interface RevisionsViewedMarksView {
  readonly isViewed: (file: RevisionFile) => boolean
  readonly ready: boolean
  readonly error: unknown
  readonly unavailable: boolean
  readonly set: (files: readonly RevisionFile[], viewed: boolean) => void
}

/** A revision's own change as a viewed range (`<commit>-` to `<commit>`): rewriting it starts it unread again. */
const revisionRange = (workspacePath: string, commitId: string): ViewedRange => ({ workspacePath, base: `${commitId}-`, head: commitId })

export const useRevisionsViewedMarks = (input: { readonly workspacePath: string; readonly commitIds: readonly string[] }): RevisionsViewedMarksView => {
  const api = useApi(diffViewedApi)
  const queryClient = useQueryClient()
  const { workspacePath, commitIds } = input
  const [ownerMissing, setOwnerMissing] = useState(false)
  const stopPolling = useCallback(() => setOwnerMissing(true), [])
  // Read once per revision and after each write, not polled: a selection may hold 30 ranges where the facet holds one.
  const queries = useQueries({
    queries: commitIds.map(commitId => {
      const range = revisionRange(workspacePath, commitId)
      return {
        queryKey: rangeQueryKey(range),
        enabled: !ownerMissing,
        retry: (count: number, error: Error) => !isApiOwnerMissing(error) && count < 2,
        queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
          runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.rangeState(range, { signal: hostSignal }) }),
      }
    }),
  })
  const queryError = queries.find(query => query.error !== null)?.error ?? null
  useStopWhenOwnerMissing(queryError, stopPolling)
  const keyOf = useCallback((commitId: string) => rangeQueryKey(revisionRange(workspacePath, commitId)), [workspacePath])
  const mutation = useMutation({
    mutationFn: (change: { readonly files: readonly RevisionFile[]; readonly viewed: boolean }) => {
      const targets: ViewedTarget[] = change.files.map(file => ({ kind: 'range', ...revisionRange(workspacePath, file.commitId), path: file.path }))
      return runHostRequest({ timeoutMs: 30_000, request: signal => api.set({ targets, viewed: change.viewed }, { signal }) })
    },
    onMutate: async change => {
      const touched = [...new Set(change.files.map(file => file.commitId))]
      const previous = touched.map(commitId => [commitId, queryClient.getQueryData<RangeMarks>(keyOf(commitId))] as const)
      for (const [commitId, marks] of previous) {
        await queryClient.cancelQueries({ queryKey: keyOf(commitId) })
        const paths = change.files.filter(file => file.commitId === commitId).map(file => file.path)
        if (marks !== undefined) queryClient.setQueryData<RangeMarks>(keyOf(commitId), { ...marks, paths: applyPaths(marks.paths, paths, change.viewed) })
      }
      return { previous }
    },
    onError: (_error, _change, context) => {
      for (const [commitId, marks] of context?.previous ?? []) if (marks !== undefined) queryClient.setQueryData(keyOf(commitId), marks)
    },
    onSettled: (_result, _error, change) =>
      Promise.all([...new Set(change.files.map(file => file.commitId))].map(commitId => queryClient.invalidateQueries({ queryKey: keyOf(commitId) }))),
  })
  const viewedByCommit = new Map(commitIds.map((commitId, index) => [commitId, new Set(queries[index]?.data?.paths ?? [])]))
  return {
    isViewed: file => viewedByCommit.get(file.commitId)?.has(file.path) === true,
    ready: queries.length > 0 && queries.every(query => query.data !== undefined),
    error: ownerMissing ? null : (mutation.error ?? queryError),
    unavailable: ownerMissing,
    set: (files, viewed) => {
      if (files.length > 0) mutation.mutate({ files, viewed })
    },
  }
}

/** One turn's marks: the same keys the native review tab's Viewed toggle writes. */
export const useTurnViewedMarks = (turn: { readonly sessionId: string; readonly seq: number } | undefined): ViewedMarksView => {
  const api = useApi(diffViewedApi)
  const queryClient = useQueryClient()
  const [ownerMissing, setOwnerMissing] = useState(false)
  const stopPolling = useCallback(() => setOwnerMissing(true), [])
  const query = useQuery({
    queryKey: turnQueryKey,
    enabled: turn !== undefined && !ownerMissing,
    refetchInterval: POLL_MS,
    retry: (count, error) => !isApiOwnerMissing(error) && count < 2,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.state(undefined, { signal: hostSignal }) }),
  })
  useStopWhenOwnerMissing(query.error, stopPolling)
  const mutation = useMutation({
    mutationFn: (input: { readonly paths: readonly string[]; readonly viewed: boolean }) => {
      if (turn === undefined) return Promise.resolve(undefined)
      const targets: ViewedTarget[] = input.paths.map(path => ({ kind: 'turn', sessionId: turn.sessionId, seq: turn.seq, path }))
      return runHostRequest({ timeoutMs: 30_000, request: signal => api.set({ targets, viewed: input.viewed }, { signal }) })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: turnQueryKey }),
  })
  const marks = query.data?.marks
  const pending = mutation.isPending ? mutation.variables : undefined
  const viewed = useMemo(() => {
    if (turn === undefined || marks === undefined) return emptyPaths
    const paths = new Set<string>()
    for (const key of marks) {
      const file = viewedFileFromKey(key)
      if (file !== null && file.sessionId === turn.sessionId && file.seq === turn.seq) paths.add(file.path)
    }
    for (const path of pending?.paths ?? []) {
      if (pending?.viewed === true) paths.add(path)
      else paths.delete(path)
    }
    return paths
  }, [marks, pending, turn])
  return {
    viewed,
    ready: query.data !== undefined,
    error: ownerMissing ? null : (mutation.error ?? query.error),
    unavailable: ownerMissing,
    set: (changed, next) => {
      if (changed.length > 0) mutation.mutate({ paths: changed, viewed: next })
    },
  }
}
