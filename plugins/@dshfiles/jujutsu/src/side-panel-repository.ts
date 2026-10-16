/**
 * The bundle-local link between the toggle buttons and the right-panel Jujutsu
 * page: the page publishes which repository it shows, a toggle asks it to show
 * another. A request made before the page mounts waits for it.
 */

export interface SidePanelRequest {
  readonly path: string
  readonly reference?: { readonly value: string; readonly kind: 'revision' | 'bookmark'; readonly behavior: 'focus' | 'path' }
}

type Listener = (request: SidePanelRequest) => void

/** Whether `path` is the repository root or lies inside it. */
export const containsPath = (root: string, path: string): boolean => {
  const trimmedRoot = root.replace(/\/+$/, '')
  const trimmedPath = path.replace(/\/+$/, '')
  return trimmedRoot.length > 0 && (trimmedPath === trimmedRoot || trimmedPath.startsWith(trimmedRoot + '/'))
}

export const createSidePanelRepository = () => {
  let shownRoot: string | null = null
  let pending: SidePanelRequest | null = null
  const listeners = new Set<Listener>()
  return {
    /** Whether the page currently shows the repository holding `path`. */
    isShowing: (path: string): boolean => shownRoot !== null && containsPath(shownRoot, path),
    /** Publish the shown root; the returned cleanup clears it if nothing replaced it. */
    show: (root: string | null): (() => void) => {
      shownRoot = root
      return () => {
        if (shownRoot === root) shownRoot = null
      }
    },
    request: (request: SidePanelRequest): void => {
      if (listeners.size === 0) {
        pending = request
        return
      }
      pending = null
      for (const listener of listeners) listener(request)
    },
    /** The request made while no page listened, consumed once by the page that mounts next. */
    takePending: (): SidePanelRequest | null => {
      try {
        return pending
      } finally {
        pending = null
      }
    },
    onRequest: (listener: Listener): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const sidePanelRepository = createSidePanelRepository()
