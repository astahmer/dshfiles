import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { useEffect } from 'react'
import { diffViewedApi } from './marks-api.js'
import type { SyncedViewedMarks } from './viewed-marks.js'

/**
 * Feed the Host's durable marks into a slot store, leaving the browser copy as
 * the fallback. The Host has no change push, so another tab's toggle arrives on
 * the next poll or when this window is focused again.
 */
export const useViewedMarksSync = (marks: SyncedViewedMarks): void => {
  const api = useApi(diffViewedApi)
  const query = useApiQuery(diffViewedApi, 'state')
  useEffect(() => {
    marks.routeTo(file => api.toggle(file))
  }, [api, marks])
  useEffect(() => {
    if (query.data !== undefined) marks.adopt(query.data)
  }, [marks, query.data])
  const refetch = query.refetch
  useEffect(() => {
    const refresh = (): void => refetch()
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 5_000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [refetch])
}
