import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useRef, useState } from 'react'
import { autoRefreshVisibilityMachine } from './auto-refresh-machine.js'
import type { JujutsuPreferences } from './preferences.js'

type RefreshPreferences = Pick<JujutsuPreferences, 'refreshMode' | 'refreshIntervalSeconds' | 'refreshOnVisible'>

/** TanStack Query options for repository data; `paused` holds refreshes while a confirm or mutation is in flight. */
export const refreshQueryOptions = (input: { readonly preferences: RefreshPreferences; readonly visible: boolean; readonly paused: boolean }) => ({
  refetchInterval:
    input.preferences.refreshMode === 'interval' && input.visible && !input.paused ? input.preferences.refreshIntervalSeconds * 1000 : (false as const),
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: input.preferences.refreshOnVisible && input.visible && !input.paused,
})

/** Interval mode skips ticks while hidden, so coming back always catches up at once. */
export const refreshesOnReturn = (input: { readonly preferences: RefreshPreferences; readonly paused: boolean }): boolean =>
  !input.paused && (input.preferences.refreshOnVisible || input.preferences.refreshMode === 'interval')

const documentVisible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible'

/**
 * Tracks whether the panel is on screen (tab visible, its surface showing it, element intersecting and laid out) and
 * catches up when it returns.
 */
export const useAutoRefresh = (input: {
  readonly preferences: RefreshPreferences
  readonly paused: boolean
  readonly surfaceVisible: boolean
  readonly onBecameVisible: () => void
}) => {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [initialPageVisible] = useState(documentVisible)
  const [snapshot, send, actor] = useMachine(autoRefreshVisibilityMachine, {
    input: { pageVisible: initialPageVisible, surfaceVisible: input.surfaceVisible },
  })
  const visible = snapshot.context.pageVisible && snapshot.context.surfaceVisible && snapshot.context.intersecting && snapshot.context.laidOut
  const latest = useRef(input)
  latest.current = input

  useEffect(() => {
    const subscription = actor.on('becameVisible', () => {
      if (refreshesOnReturn(latest.current)) latest.current.onBecameVisible()
    })
    return () => subscription.unsubscribe()
  }, [actor])

  useEffect(() => {
    send({ type: 'surface.visibility', visible: input.surfaceVisible })
  }, [input.surfaceVisible, send])

  useEffect(() => {
    const update = (): void => send({ type: 'document.visibility', visible: documentVisible() })
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [send])

  useEffect(() => {
    if (element === null) return
    const IntersectionObserverConstructor = window.IntersectionObserver
    if (IntersectionObserverConstructor === undefined) return
    const observer = new IntersectionObserverConstructor(entries => {
      const entry = entries.at(-1)
      if (entry !== undefined) send({ type: 'element.intersection', intersecting: entry.isIntersecting })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, send])

  // A collapsed or display:none pane can still report intersecting; a zero-size box means it is closed.
  useEffect(() => {
    if (element === null) return
    const ResizeObserverConstructor = window.ResizeObserver
    if (ResizeObserverConstructor === undefined) return
    const observer = new ResizeObserverConstructor(entries => {
      const entry = entries.at(-1)
      if (entry !== undefined) send({ type: 'element.layout', laidOut: entry.contentRect.width > 0 && entry.contentRect.height > 0 })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, send])

  return { ref: setElement, visible, queryOptions: refreshQueryOptions({ preferences: input.preferences, visible, paused: input.paused }) }
}
