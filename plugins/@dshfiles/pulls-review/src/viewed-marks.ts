import { diffViewedApi, viewedFileFromKey, type RangeMarks, type ViewedRange, type ViewedTarget } from '@dshfiles/diff-viewed/marks-api'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
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
