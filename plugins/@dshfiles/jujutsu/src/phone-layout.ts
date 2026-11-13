import type { GraphMetrics } from '@dshfiles/jj-integration/revision-graph'
import { useSyncExternalStore } from 'react'

/** The phone shell's breakpoint (thread-sidebar, workbench and rich-composer use the same query). */
const PHONE_QUERY = '(max-width: 639.98px)'

const phoneQuery = (): MediaQueryList | null =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia(PHONE_QUERY)

const subscribe = (onChange: () => void): (() => void) => {
  const query = phoneQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

export const usePhoneLayout = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => phoneQuery()?.matches ?? false,
    () => false,
  )

/** Two text lines per revision and a 44 px tap target; the graph density preference keeps desktop rows. */
export const PHONE_GRAPH_METRICS: GraphMetrics = { rowHeight: 52, laneGap: 14 }
