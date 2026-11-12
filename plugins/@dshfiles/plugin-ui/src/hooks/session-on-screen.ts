import { Composer, useContract } from '@dshfiles/dshx/client'
import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether the main view shows this thread. Main tabs keep every visited thread's composer and header mounted, so a
 * per-thread poll gated on nothing reads once per open tab. Without a composer owner nothing says which thread shows,
 * so every thread counts as shown.
 */
export const useSessionOnScreen = (sessionId: string): boolean => {
  const composer = useContract(Composer)
  const current = composer.status === 'active' ? composer.value.current : undefined
  const subscribe = useCallback((listener: () => void) => current?.subscribe(listener) ?? (() => undefined), [current])
  return useSyncExternalStore(subscribe, () => current === undefined || current.get() === sessionId)
}
