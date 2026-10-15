/**
 * The bundle-local link between the toggle buttons and the right-panel Jujutsu
 * page: the page publishes which repository it shows, a toggle asks it to show
 * another. A request made before the page mounts waits for it.
 */

type Listener = (path: string) => void

/** Whether `path` is the repository root or lies inside it. */
export const containsPath = (root: string, path: string): boolean => {
  const trimmedRoot = root.replace(/\/+$/, '')
  const trimmedPath = path.replace(/\/+$/, '')
  return trimmedRoot.length > 0 && (trimmedPath === trimmedRoot || trimmedPath.startsWith(trimmedRoot + '/'))
}

export const createSidePanelRepository = () => {
  let shownRoot: string | null = null
  let pending: string | null = null
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
    request: (path: string): void => {
      if (listeners.size === 0) {
        pending = path
        return
      }
      pending = null
      for (const listener of listeners) listener(path)
    },
    /** The request made while no page listened, consumed once by the page that mounts next. */
    takePending: (): string | null => {
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
