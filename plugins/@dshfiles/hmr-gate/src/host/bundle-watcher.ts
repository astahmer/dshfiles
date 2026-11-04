import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

/** The bundle metadata the gate compares. */
export interface BundleStat {
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly size: number
}

/** One finished read of a watched bundle: its metadata, or the error `stat` raised. */
export type BundleRead = { readonly kind: 'stat'; readonly stat: BundleStat } | { readonly kind: 'error'; readonly error: unknown }

export interface BundleWatcherOptions {
  /** Called once per requested bundle after its read, in request order, never concurrently. */
  readonly onRead: (id: string, read: BundleRead) => void
  readonly onWatchError?: (error: unknown) => void
  /** Delay that coalesces the burst of events a build writes. */
  readonly settleMs?: number
  /** Re-reads every bundle in case a watch missed an event (network filesystems, overflow). */
  readonly safetyPollMs?: number
  /** Polling interval for a directory that cannot be watched, or vanished until it reappears. */
  readonly fallbackPollMs?: number
}

export interface BundleWatcher {
  /** Replace the watched set: bundle id → absolute bundle path. */
  sync(rows: ReadonlyMap<string, string>): void
  /** Read these bundles again soon, for example after a failed apply. */
  retry(ids: Iterable<string>): void
  dispose(): void
}

interface DirectoryWatch {
  watcher: FSWatcher | undefined
  /** Watches the parent (the package directory), which survives a clean build that replaces `dist/`. */
  parentWatcher: FSWatcher | undefined
  readonly ids: Set<string>
}

/**
 * Watches the directories holding client bundles instead of `statSync`-polling every bundle every 500 ms on the
 * Host's main thread. A directory event schedules an async `stat` of the matching bundles only. A directory that
 * cannot be watched, or disappears during a clean build, is polled until a watch can be reopened, and a slow
 * safety poll covers events the platform drops.
 */
const createBundleWatcher = (options: BundleWatcherOptions): BundleWatcher => {
  const settleMs = options.settleMs ?? 50
  const safetyPollMs = options.safetyPollMs ?? 10_000
  const fallbackPollMs = options.fallbackPollMs ?? 500
  const paths = new Map<string, string>()
  const directories = new Map<string, DirectoryWatch>()
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let disposed = false

  const schedule = (delayMs: number): void => {
    if (disposed || running || timer !== undefined || pending.size === 0) return
    timer = setTimeout(() => {
      timer = undefined
      void run()
    }, delayMs)
    timer.unref()
  }

  const request = (ids: Iterable<string>, delayMs: number = settleMs): void => {
    for (const id of ids) if (paths.has(id)) pending.add(id)
    schedule(delayMs)
  }

  const closeWatch = (entry: DirectoryWatch): void => {
    entry.watcher?.close()
    entry.watcher = undefined
  }

  const closeAll = (entry: DirectoryWatch): void => {
    closeWatch(entry)
    entry.parentWatcher?.close()
    entry.parentWatcher = undefined
  }

  const openParentWatch = (directory: string, entry: DirectoryWatch): void => {
    if (entry.parentWatcher !== undefined || disposed) return
    const name = basename(directory)
    try {
      const watcher = watch(dirname(directory), { persistent: false }, (_event, filename) => {
        if (filename !== null && String(filename) !== name) return
        // The bundle directory was removed or replaced: its own watch may be dead without an error.
        closeWatch(entry)
        openWatch(directory, entry)
        request(entry.ids)
      })
      watcher.on('error', error => {
        entry.parentWatcher?.close()
        entry.parentWatcher = undefined
        options.onWatchError?.(error)
      })
      entry.parentWatcher = watcher
    } catch {
      entry.parentWatcher = undefined
    }
  }

  const openWatch = (directory: string, entry: DirectoryWatch): void => {
    openParentWatch(directory, entry)
    if (entry.watcher !== undefined || disposed) return
    try {
      const watcher = watch(directory, { persistent: false }, (_event, filename) => {
        const name = filename === null ? undefined : String(filename)
        request([...entry.ids].filter(id => name === undefined || basename(paths.get(id) ?? '') === name))
      })
      watcher.on('error', error => {
        closeWatch(entry)
        options.onWatchError?.(error)
      })
      entry.watcher = watcher
    } catch {
      entry.watcher = undefined
    }
  }

  const run = async (): Promise<void> => {
    running = true
    const ids = [...pending]
    pending.clear()
    try {
      const reads = await Promise.all(
        ids.map(async (id): Promise<readonly [string, BundleRead] | undefined> => {
          const path = paths.get(id)
          if (path === undefined) return undefined
          try {
            const current = await stat(path)
            return [id, { kind: 'stat', stat: { mtimeMs: current.mtimeMs, ctimeMs: current.ctimeMs, size: current.size } }]
          } catch (error) {
            return [id, { kind: 'error', error }]
          }
        }),
      )
      for (const read of reads) {
        if (read === undefined || disposed || !paths.has(read[0])) continue
        // A vanished bundle usually means a clean build removed its directory: drop the dead watch and poll.
        if (read[1].kind === 'error') {
          const entry = directories.get(dirname(paths.get(read[0]) ?? ''))
          if (entry !== undefined) closeWatch(entry)
        }
        options.onRead(read[0], read[1])
      }
    } finally {
      running = false
      schedule(settleMs)
    }
  }

  const pollUnwatched = (): void => {
    for (const [directory, entry] of directories) {
      openParentWatch(directory, entry)
      if (entry.watcher !== undefined) continue
      openWatch(directory, entry)
      request(entry.ids, 0)
    }
  }

  const fallbackTimer = setInterval(pollUnwatched, fallbackPollMs)
  fallbackTimer.unref()
  const safetyTimer = setInterval(() => request(paths.keys()), safetyPollMs)
  safetyTimer.unref()

  return {
    sync: rows => {
      paths.clear()
      for (const [id, path] of rows) paths.set(id, path)
      const wanted = new Map<string, Set<string>>()
      for (const [id, path] of paths) {
        const directory = dirname(path)
        const ids = wanted.get(directory) ?? new Set<string>()
        ids.add(id)
        wanted.set(directory, ids)
      }
      for (const [directory, entry] of directories) {
        if (wanted.has(directory)) continue
        closeAll(entry)
        directories.delete(directory)
      }
      for (const [directory, ids] of wanted) {
        const entry = directories.get(directory) ?? { watcher: undefined, parentWatcher: undefined, ids: new Set<string>() }
        entry.ids.clear()
        for (const id of ids) entry.ids.add(id)
        directories.set(directory, entry)
        openWatch(directory, entry)
      }
    },
    retry: ids => request(ids, fallbackPollMs),
    dispose: () => {
      disposed = true
      clearInterval(fallbackTimer)
      clearInterval(safetyTimer)
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      for (const entry of directories.values()) closeAll(entry)
      directories.clear()
      paths.clear()
      pending.clear()
    },
  }
}

export class BundleWatch {
  static readonly create = createBundleWatcher
}
