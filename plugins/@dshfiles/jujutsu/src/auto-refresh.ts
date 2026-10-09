import { useEffect, useRef, useState } from 'react'
import type { JujutsuPreferences } from './preferences.js'

type RefreshPreferences = Pick<JujutsuPreferences, 'refreshMode' | 'refreshIntervalSeconds' | 'refreshOnVisible'>

/** TanStack Query options for repository data; `paused` holds refreshes while a confirm or mutation is in flight. */
export const refreshQueryOptions = (input: { readonly preferences: RefreshPreferences; readonly visible: boolean; readonly paused: boolean }) => ({
  refetchInterval: input.preferences.refreshMode === 'interval' && input.visible && !input.paused ? input.preferences.refreshIntervalSeconds * 1000 : (false as const),
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: input.preferences.refreshOnVisible && !input.paused,
})

const documentVisible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible'

/** Tracks whether the panel is on screen (tab visible and element intersecting) and calls `onBecameVisible` when it comes back. */
export const useAutoRefresh = (input: { readonly preferences: RefreshPreferences; readonly paused: boolean; readonly onBecameVisible: () => void }) => {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [pageVisible, setPageVisible] = useState(documentVisible)
  const [intersecting, setIntersecting] = useState(true)
  const visible = pageVisible && intersecting
  const previousVisible = useRef(visible)
  const latest = useRef(input)
  latest.current = input

  useEffect(() => {
    const update = (): void => setPageVisible(documentVisible())
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    if (element === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      const entry = entries.at(-1)
      if (entry !== undefined) setIntersecting(entry.isIntersecting)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  useEffect(() => {
    const becameVisible = visible && !previousVisible.current
    previousVisible.current = visible
    if (becameVisible && latest.current.preferences.refreshOnVisible && !latest.current.paused) latest.current.onBecameVisible()
  }, [visible])

  return { ref: setElement, queryOptions: refreshQueryOptions({ preferences: input.preferences, visible, paused: input.paused }) }
}
