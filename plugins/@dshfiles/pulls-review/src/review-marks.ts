import { diffViewedApi } from '@dshfiles/diff-viewed/marks-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { useEffect, useMemo, useState } from 'react'
import { ReviewedMarksModel } from './reviewed.js'
import { reviewedStore } from './reviewed-store.js'
import { ReviewModel, type ReviewSource } from './review-model.js'

export interface ReviewMarks {
  readonly viewed: ReadonlySet<string>
  /** Host-backed turn marks can be written; false on a Host that does not serve `diff-viewed.mark` yet. */
  readonly writable: boolean
  toggle(path: string): void
  markMany(paths: readonly string[]): void
}

const EMPTY: ReadonlySet<string> = new Set()

/** Review progress for the active source: the Host's turn marks, or the browser's workspace marks. */
export const useReviewMarks = (source: ReviewSource | undefined): ReviewMarks => {
  const api = useApi(diffViewedApi)
  const turn = source?.kind === 'turn' ? source : undefined
  const snapshot = useApiQuery(diffViewedApi, 'state', { enabled: turn !== undefined })
  const reviewed = reviewedStore.useValue()
  const [turnLocal, setTurnLocal] = useState<ReadonlySet<string> | undefined>(undefined)
  const [writable, setWritable] = useState(true)

  const fromHost = useMemo(() => (turn === undefined ? EMPTY : ReviewModel.viewedPathsOf(snapshot.data, turn)), [snapshot.data, turn])
  useEffect(() => {
    setTurnLocal(undefined)
  }, [turn?.sessionId, turn?.seq])

  const turnViewed = turnLocal ?? fromHost
  const viewed = source === undefined ? EMPTY : source.kind === 'turn' ? turnViewed : new Set(reviewed[ReviewModel.workspaceReviewedKeyOf(source)] ?? [])

  const toggle = (path: string): void => {
    if (source === undefined) return
    if (source.kind === 'workspace') {
      const key = ReviewModel.workspaceReviewedKeyOf(source)
      reviewedStore.set(ReviewedMarksModel.record(reviewed, key, ReviewedMarksModel.toggle(reviewed[key] ?? [], path)))
      return
    }
    const next = new Set(turnViewed)
    const viewing = !next.has(path)
    if (viewing) next.add(path)
    else next.delete(path)
    setTurnLocal(next)
    api
      .mark({ sessionId: source.sessionId, seq: source.seq, path, viewed: viewing })
      .then(() => snapshot.refetch())
      .catch(() => {
        setWritable(false)
        setTurnLocal(undefined)
      })
  }

  const markMany = (paths: readonly string[]): void => {
    if (source === undefined || paths.length === 0) return
    if (source.kind === 'workspace') {
      const key = ReviewModel.workspaceReviewedKeyOf(source)
      const next = ReviewedMarksModel.mark(reviewed[key] ?? [], paths)
      reviewedStore.set(ReviewedMarksModel.record(reviewed, key, next))
      return
    }
    const fresh = paths.filter(path => !turnViewed.has(path))
    if (fresh.length === 0) return
    const next = new Set(turnViewed)
    for (const path of fresh) next.add(path)
    setTurnLocal(next)
    void Promise.all(fresh.map(path => api.mark({ sessionId: source.sessionId, seq: source.seq, path, viewed: true })))
      .then(() => snapshot.refetch())
      .catch(() => {
        setWritable(false)
        setTurnLocal(undefined)
      })
  }

  return { viewed, writable: turn === undefined ? true : writable, toggle, markMany }
}
