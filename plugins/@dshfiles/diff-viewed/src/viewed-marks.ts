import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { MAX_VIEWED_MARKS, viewedFileFromKey, viewedKey, type ViewedFile, type ViewedMarksSnapshot } from './marks-api.js'

const VIEWED_MARKS_STORAGE_KEY = 'dshfiles.diffViewed.v1'

/** The browser hands its whole cap over on the first Host snapshot; small batches keep that cheap. */
const MIGRATION_BATCH_SIZE = 20

export { viewedKey, type ViewedFile }

export interface ViewedMarks {
  getSnapshot(): ReadonlySet<string>
  subscribe(listener: () => void): () => void
  reload(): void
  toggle(file: ViewedFile): void
}

export interface SyncedViewedMarks extends ViewedMarks {
  /** Adopt the Host snapshot; the first one also hands over browser-held marks the Host is missing. */
  adopt(snapshot: ViewedMarksSnapshot): void
  /** Route toggles to the Host, once a Host snapshot proved it owns the record. */
  routeTo(send: (file: ViewedFile) => Promise<ViewedMarksSnapshot>): void
}

interface MarkSnapshot {
  readonly marks: readonly string[]
  readonly set: ReadonlySet<string>
}

/**
 * Browser-held marks with the Host as the durable owner. Every mark the browser
 * held before this Host took over moves across on the first snapshot; while the
 * Host is absent (older Host, or the HMR window before a restart) the browser
 * store keeps answering on its own.
 */
export const createViewedMarks = (options: { readonly storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null }): SyncedViewedMarks => {
  const stored = createStoredValue({ key: VIEWED_MARKS_STORAGE_KEY, schema: z.array(z.string()), fallback: [], storage: options.storage })
  const listeners = new Set<() => void>()
  let local: MarkSnapshot | null = null
  let host: (MarkSnapshot & { readonly revision: number }) | null = null
  /** The mark set a click just produced, shown until the Host answers with its own revision. */
  let optimistic: ReadonlySet<string> | null = null
  let send: ((file: ViewedFile) => Promise<ViewedMarksSnapshot>) | null = null
  let migrated = false
  let stopLocal: (() => void) | null = null

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const localSnapshot = (): ReadonlySet<string> => {
    const marks = stored.get()
    if (local?.marks !== marks) local = { marks, set: new Set(marks) }
    return local.set
  }

  // A browser can hold the whole cap, so the handover replays in small batches instead of one burst.
  const replayBrowserMarks = async (invoke: (file: ViewedFile) => Promise<ViewedMarksSnapshot>, files: readonly ViewedFile[]): Promise<boolean> => {
    let complete = true
    for (let index = 0; index < files.length; index += MIGRATION_BATCH_SIZE) {
      const results = await Promise.allSettled(files.slice(index, index + MIGRATION_BATCH_SIZE).map(file => invoke(file)))
      for (const result of results) {
        if (result.status === 'fulfilled') adopt(result.value)
        else complete = false
      }
    }
    return complete
  }

  const adoptBrowserMarks = (invoke: (file: ViewedFile) => Promise<ViewedMarksSnapshot>, adopted: MarkSnapshot): void => {
    const legacy = [...stored.get()]
      .filter(mark => !adopted.set.has(mark))
      .map(viewedFileFromKey)
      .filter((file): file is ViewedFile => file !== null)
    if (legacy.length === 0) {
      stored.remove()
      return
    }
    void replayBrowserMarks(invoke, legacy).then(complete => {
      if (complete) stored.remove()
    })
  }

  const adopt = (next: ViewedMarksSnapshot): void => {
    if (host !== null && next.revision < host.revision) return
    const adopted = { revision: next.revision, marks: next.marks, set: new Set(next.marks) }
    // oxlint-disable-next-line antislop/no-passthrough-variable -- `host` is replaced on the next line; `current` is the snapshot the optimistic check compares against.
    const current = host
    host = adopted
    // A click the Host has not answered yet owns the view; a poll that predates it must not flicker the box back.
    if (optimistic !== null && (current === null || adopted.revision > current.revision)) optimistic = null
    else if (optimistic !== null) return
    notify()
    if (migrated) return
    migrated = true
    if (send === null) return
    adoptBrowserMarks(send, adopted)
  }

  return {
    getSnapshot: () => optimistic ?? (host === null ? localSnapshot() : host.set),
    subscribe: listener => {
      listeners.add(listener)
      stopLocal ??= stored.subscribe(notify)
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        stopLocal?.()
        stopLocal = null
      }
    },
    reload: () => stored.reload(),
    toggle: file => {
      if (host === null || send === null) {
        const key = viewedKey(file)
        const current = localSnapshot()
        const next = [...current].filter(mark => mark !== key)
        if (!current.has(key)) next.push(key)
        stored.set(next.slice(-MAX_VIEWED_MARKS))
        return
      }
      // Flip now and reconcile with the Host response, so a click never waits on the round trip.
      const key = viewedKey(file)
      const next = new Set(host.set)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      optimistic = next
      notify()
      void send(file).then(
        snapshot => {
          optimistic = null
          adopt(snapshot)
        },
        () => {
          optimistic = null
          notify()
        },
      )
    },
    adopt,
    routeTo: next => {
      send = next
    },
  }
}
