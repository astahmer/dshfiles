import { useSyncExternalStore } from 'react'

/** The part of `WakeLockSentinel` this owner drives. */
export interface WakeLockSentinelLike {
  readonly released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

/** What the screen wake lock needs from its page: the platform request, visibility and the platform's support. */
export interface ScreenWakeLockHost {
  readonly available: boolean
  request: () => Promise<WakeLockSentinelLike>
  onVisibility: (listener: () => void) => () => void
  isVisible: () => boolean
}

export interface ScreenWakeLockService {
  readonly available: boolean
  /** Whether the user asked to keep the screen on. */
  get: () => boolean
  subscribe: (listener: () => void) => () => void
  /** Turn the lock on or off; a request the platform refuses turns it back off. */
  toggle: () => Promise<void>
  release: () => Promise<void>
}

/**
 * Screen Wake Lock (plan phone P27): a phone watching a long run can keep its screen on without a setting elsewhere.
 * The browser released the lock while the page is hidden, so becoming visible again re-requests it while the user
 * still wants it. Every failure (unsupported, refused, battery saver) turns the toggle back off instead of leaving a
 * switch that claims to be on.
 */
export const createScreenWakeLock = (host: ScreenWakeLockHost): ScreenWakeLockService => {
  let wanted = false
  let sentinel: WakeLockSentinelLike | undefined
  let stopVisibility: (() => void) | undefined
  const listeners = new Set<() => void>()
  const publish = (): void => {
    for (const listener of listeners) listener()
  }
  const acquire = async (): Promise<void> => {
    if (!wanted || sentinel !== undefined) return
    try {
      const next = await host.request()
      if (!wanted) {
        await next.release()
        return
      }
      sentinel = next
      next.addEventListener('release', () => {
        if (sentinel === next) sentinel = undefined
      })
    } catch {
      wanted = false
      publish()
    }
  }
  const release = async (): Promise<void> => {
    wanted = false
    stopVisibility?.()
    stopVisibility = undefined
    const current = sentinel
    sentinel = undefined
    publish()
    await current?.release()
  }
  return {
    available: host.available,
    get: () => wanted,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    toggle: async () => {
      if (!host.available) return
      if (wanted) {
        await release()
        return
      }
      wanted = true
      stopVisibility = host.onVisibility(() => {
        // Hiding the page releases the platform lock; drop the stale sentinel so becoming visible requests one again.
        if (!host.isVisible()) {
          sentinel = undefined
          return
        }
        if (wanted) void acquire()
      })
      publish()
      await acquire()
    },
    release,
  }
}

const navigatorWakeLock = (): WakeLock | undefined => {
  if (typeof navigator === 'undefined') return undefined
  return navigator.wakeLock
}

/** The page's one lock: the thread menu toggles it, and it outlives that menu. */
export const ScreenWakeLock = createScreenWakeLock({
  get available() {
    return navigatorWakeLock() !== undefined
  },
  request: async () => {
    const wakeLock = navigatorWakeLock()
    if (wakeLock === undefined) throw new Error('Screen Wake Lock is unavailable')
    return wakeLock.request('screen')
  },
  onVisibility: listener => {
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  },
  isVisible: () => document.visibilityState === 'visible',
})

/** React binding for the thread menu's row. */
export const useScreenWakeLock = (): boolean =>
  useSyncExternalStore(ScreenWakeLock.subscribe, ScreenWakeLock.get, ScreenWakeLock.get)
