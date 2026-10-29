import { z } from 'zod'
import { isIgnored, parseGitignore, type IgnoreRule } from './gitignore.js'

/**
 * Cross-plugin file listing for fuzzy open (command-palette ⌘P): dispatch
 * `new CustomEvent('dshfiles:workspace-files', { detail: { respond, signal }, cancelable: true })`.
 * The editor calls `preventDefault()` when it took the request, then calls `respond` with the cached list first and
 * again as the walk of the session on screen progresses and as watched directories change. Paths are
 * workspace-relative, ready for `dshfiles:open-file`.
 */
export const WORKSPACE_FILES_EVENT = 'dshfiles:workspace-files'

export type WorkspaceFilesReply =
  | { readonly status: 'no-session' }
  | { readonly status: 'indexing' | 'ready'; readonly sessionId: string; readonly files: readonly string[]; readonly truncated: boolean }

export const workspaceFilesRequestSchema = z.object({
  respond: z.custom<(reply: WorkspaceFilesReply) => void>(value => typeof value === 'function'),
  signal: z.instanceof(AbortSignal).optional(),
})

const IGNORED_DIRECTORIES = new Set(['.git', '.jj', 'node_modules'])
const MAX_FILES = 20_000
const MAX_DIRECTORIES = 4_000
const PARALLEL_LISTS = 8
const FRESH_MS = 30_000
const PROGRESS_INTERVAL_MS = 200
/** Host `changes` watches one directory's direct entries, so only the shallowest directories get a stream each. */
const MAX_WATCHED_DIRECTORIES = 64
const RELIST_DELAY_MS = 150
/** How long watches outlive the last listener, so reopening ⌘P soon after still gets a live list. */
const WATCH_IDLE_MS = 30_000
/** Retained walks are a memory budget: this many quiet sessions stay warm, and only for this long. */
export const RETAINED_INDEX_LIMIT = 8
export const RETAINED_INDEX_TTL_MS = 5 * 60_000

interface DirectoryEntry {
  readonly name: string
  readonly type: string
}
type ListDirectory = (path: string, signal: AbortSignal) => Promise<{ readonly entries: readonly DirectoryEntry[] }>
type ReadText = (path: string, signal: AbortSignal) => Promise<string>
type WatchFrame = { readonly kind: 'ready' } | { readonly kind: 'change' }

interface DirectoryListing {
  readonly files: readonly string[]
  readonly directories: readonly string[]
  /** Rules of this directory's own `.gitignore`. */
  readonly rules: readonly IgnoreRule[]
}
type Directories = Map<string, DirectoryListing>

const joinPath = (parent: string, name: string): string => (parent === '' ? name : `${parent}/${name}`)

const ancestorsOf = (path: string): string[] => {
  if (path === '') return []
  const parts = path.split('/')
  return ['', ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))]
}

/** List one directory and keep what neither the fixed skip list nor the `.gitignore` files from the root down drop. */
const readDirectory = async (options: {
  readonly list: ListDirectory
  readonly readText?: ReadText
  readonly directories: Directories
  readonly path: string
  readonly signal: AbortSignal
}): Promise<DirectoryListing | null> => {
  const listing = await options.list(options.path, options.signal).catch(() => null)
  if (listing === null) return null
  const hasGitignore = listing.entries.some(entry => entry.name === '.gitignore' && entry.type === 'file')
  const text =
    hasGitignore && options.readText !== undefined ? await options.readText(joinPath(options.path, '.gitignore'), options.signal).catch(() => '') : ''
  const rules = text === '' ? [] : parseGitignore({ text, base: options.path })
  const chain = [...ancestorsOf(options.path).flatMap(ancestor => options.directories.get(ancestor)?.rules ?? []), ...rules]
  const files: string[] = []
  const directories: string[] = []
  for (const entry of listing.entries) {
    const path = joinPath(options.path, entry.name)
    const directory = entry.type === 'directory'
    if ((!directory && entry.type !== 'file') || (directory && IGNORED_DIRECTORIES.has(entry.name))) continue
    if (chain.length > 0 && isIgnored({ rules: chain, path, directory })) continue
    if (directory) directories.push(path)
    else files.push(path)
  }
  return { files, directories, rules }
}

/** Directories in breadth-first order from the listed ones, so caps keep the shallow files people open most. */
const breadthFirst = (directories: Directories): string[] => {
  const order: string[] = []
  let level = directories.has('') ? [''] : []
  while (level.length > 0) {
    order.push(...level)
    level = level.flatMap(path => directories.get(path)?.directories.filter(child => directories.has(child)) ?? [])
  }
  return order
}

const flatten = (directories: Directories): { readonly files: readonly string[]; readonly truncated: boolean } => {
  const files = breadthFirst(directories).flatMap(path => directories.get(path)?.files ?? [])
  return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES }
}

/**
 * Breadth-first listing from `roots` into `directories`; unlistable directories are skipped. Stops at the file and
 * directory caps, counting what `directories` already holds.
 */
const walkInto = async (options: {
  readonly list: ListDirectory
  readonly readText?: ReadText
  readonly signal: AbortSignal
  readonly directories: Directories
  readonly roots: readonly string[]
  readonly onProgress?: () => void
}): Promise<boolean> => {
  let level = [...options.roots]
  let fileCount = [...options.directories.values()].reduce((sum, listing) => sum + listing.files.length, 0)
  let truncated = false
  let progressAt = Date.now()
  while (level.length > 0 && !truncated) {
    const next: string[] = []
    for (let start = 0; start < level.length && !truncated; start += PARALLEL_LISTS) {
      const batch = level.slice(start, start + PARALLEL_LISTS)
      const listings = await Promise.all(batch.map(path => readDirectory({ ...options, path })))
      options.signal.throwIfAborted()
      listings.forEach((listing, index) => {
        if (listing === null) return
        options.directories.set(batch[index] ?? '', listing)
        fileCount += listing.files.length
        next.push(...listing.directories)
      })
      if (fileCount >= MAX_FILES || options.directories.size + next.length > MAX_DIRECTORIES) truncated = true
      if (Date.now() - progressAt < PROGRESS_INTERVAL_MS) continue
      progressAt = Date.now()
      options.onProgress?.()
    }
    level = next
  }
  return truncated
}

export const walkWorkspaceFiles = async (options: {
  readonly list: ListDirectory
  readonly readText?: ReadText
  readonly signal: AbortSignal
  readonly onProgress: (files: readonly string[]) => void
}): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> => {
  const directories: Directories = new Map()
  const truncated = await walkInto({ ...options, directories, roots: [''], onProgress: () => options.onProgress(flatten(directories).files) })
  const result = flatten(directories)
  return { files: result.files, truncated: truncated || result.truncated }
}

interface SessionIndex {
  directories: Directories
  files: readonly string[]
  truncated: boolean
  indexedAt: number | null
  walking: boolean
  /** Every listed directory has a live watch, so the index needs no TTL refresh. */
  fullyWatched: boolean
  /** Cancels this session's own walk, relists and watches when its retained data is released. */
  controller: AbortController
  /** Bumped per walk so a walk that finishes after a release cannot publish or re-watch. */
  generation: number
  readonly listeners: Set<(reply: WorkspaceFilesReply) => void>
  readonly watches: Map<string, AbortController>
  readonly relists: Map<string, ReturnType<typeof setTimeout>>
  idleTimer: ReturnType<typeof setTimeout> | null
  releaseTimer: ReturnType<typeof setTimeout> | null
}

/**
 * One walk per session at a time; a fresh complete index answers at once, a stale one answers and refreshes. After
 * a walk, the shallowest directories are watched through Host `changes` (when `watch` is given and the Host
 * supports it) and relisted on change, so new and deleted files show up without waiting for the TTL.
 */
export const createWorkspaceFileIndex = <SessionId extends string>(options: {
  readonly list: (sessionId: SessionId, path: string, signal: AbortSignal) => ReturnType<ListDirectory>
  /** Reads `.gitignore` files; without it the walk only skips .git/.jj/node_modules. */
  readonly readText?: (sessionId: SessionId, path: string, signal: AbortSignal) => Promise<string>
  readonly watch?: (sessionId: SessionId, path: string, signal: AbortSignal) => AsyncIterable<WatchFrame>
  readonly now?: () => number
}) => {
  const now = options.now ?? Date.now
  const sessions = new Map<SessionId, SessionIndex>()
  const disposed = new AbortController()

  const reply = (sessionId: SessionId, index: SessionIndex): WorkspaceFilesReply => ({
    status: index.walking ? 'indexing' : 'ready',
    sessionId,
    files: index.files,
    truncated: index.truncated,
  })
  const publish = (sessionId: SessionId, index: SessionIndex): void => {
    if (disposed.signal.aborted || index.controller.signal.aborted) return
    for (const listener of index.listeners) listener(reply(sessionId, index))
  }
  const walkSource = (sessionId: SessionId): { readonly list: ListDirectory; readonly readText?: ReadText } => {
    const readText = options.readText
    return {
      list: (path, signal) => options.list(sessionId, path === '' ? '.' : path, signal),
      ...(readText !== undefined && { readText: (path: string, signal: AbortSignal) => readText(sessionId, path, signal) }),
    }
  }

  const stopWatches = (index: SessionIndex): void => {
    // A fully watched index was exact until now; the TTL starts counting from here.
    if (index.fullyWatched && index.indexedAt !== null) index.indexedAt = now()
    for (const controller of index.watches.values()) controller.abort()
    index.watches.clear()
    for (const timer of index.relists.values()) clearTimeout(timer)
    index.relists.clear()
    index.fullyWatched = false
  }

  const removeSubtree = (directories: Directories, path: string): void => {
    const listing = directories.get(path)
    directories.delete(path)
    for (const child of listing?.directories ?? []) removeSubtree(directories, child)
  }

  /** Drop one session's retained walk entirely; a later request starts it again from scratch. */
  const release = (sessionId: SessionId, index: SessionIndex): void => {
    index.controller.abort()
    index.walking = false
    if (index.idleTimer !== null) {
      clearTimeout(index.idleTimer)
      index.idleTimer = null
    }
    if (index.releaseTimer !== null) {
      clearTimeout(index.releaseTimer)
      index.releaseTimer = null
    }
    stopWatches(index)
    sessions.delete(sessionId)
  }

  /** Keep the retained walks inside their budget, dropping the least recently used idle ones. */
  const evictIdleOverLimit = (): void => {
    for (const [candidate, candidateIndex] of sessions) {
      if (sessions.size <= RETAINED_INDEX_LIMIT) return
      // A session with a listener is in use, even mid-walk; a quiet one is released, walk included.
      if (candidateIndex.listeners.size > 0) continue
      release(candidate, candidateIndex)
    }
  }

  const relist = async (sessionId: SessionId, index: SessionIndex, path: string): Promise<void> => {
    const next = await readDirectory({ ...walkSource(sessionId), directories: index.directories, path, signal: disposed.signal })
    if (disposed.signal.aborted || index.walking) return
    const previous = index.directories.get(path)
    if (next === null) {
      removeSubtree(index.directories, path)
    } else {
      for (const child of previous?.directories ?? []) if (!next.directories.includes(child)) removeSubtree(index.directories, child)
      index.directories.set(path, next)
      const added = next.directories.filter(child => !index.directories.has(child))
      if (added.length > 0) {
        await walkInto({ ...walkSource(sessionId), signal: disposed.signal, directories: index.directories, roots: added }).catch(() => undefined)
      }
    }
    const result = flatten(index.directories)
    index.files = result.files
    index.truncated = result.truncated
    syncWatches(sessionId, index)
    publish(sessionId, index)
  }

  const scheduleRelist = (sessionId: SessionId, index: SessionIndex, path: string): void => {
    clearTimeout(index.relists.get(path))
    index.relists.set(
      path,
      setTimeout(() => {
        index.relists.delete(path)
        void relist(sessionId, index, path)
      }, RELIST_DELAY_MS),
    )
  }

  const syncWatches = (sessionId: SessionId, index: SessionIndex): void => {
    const watch = options.watch
    if (watch === undefined || disposed.signal.aborted || index.controller.signal.aborted) return
    const wanted = breadthFirst(index.directories).slice(0, MAX_WATCHED_DIRECTORIES)
    const wantedSet = new Set(wanted)
    for (const [path, controller] of index.watches) {
      if (wantedSet.has(path)) continue
      controller.abort()
      index.watches.delete(path)
    }
    for (const path of wanted) {
      if (index.watches.has(path)) continue
      const controller = new AbortController()
      index.watches.set(path, controller)
      void (async () => {
        try {
          for await (const frame of watch(
            sessionId,
            path === '' ? '.' : path,
            AbortSignal.any([controller.signal, disposed.signal, index.controller.signal]),
          )) {
            if (frame.kind === 'change') scheduleRelist(sessionId, index, path)
          }
        } catch {
          // An unsupported or dropped watch leaves this directory to the TTL refresh.
        }
        if (index.watches.get(path) !== controller) return
        index.watches.delete(path)
        index.fullyWatched = false
      })()
    }
    index.fullyWatched = !index.truncated && index.watches.size === index.directories.size
  }

  const refresh = (sessionId: SessionId, index: SessionIndex): void => {
    index.walking = true
    const generation = ++index.generation
    const directories: Directories = new Map()
    // A released index is gone from the map and has aborted its controller, so nothing here may publish.
    const isCurrent = (): boolean => index.generation === generation && sessions.get(sessionId) === index && !index.controller.signal.aborted
    void walkInto({
      ...walkSource(sessionId),
      signal: index.controller.signal,
      directories,
      roots: [''],
      onProgress: () => {
        if (!isCurrent()) return
        const files = flatten(directories).files
        // Progress only grows the list; a stale index keeps answering until the new walk overtakes it.
        if (files.length < index.files.length) return
        index.files = files
        publish(sessionId, index)
      },
    })
      .then(truncated => {
        if (!isCurrent()) return
        const result = flatten(directories)
        index.directories = directories
        index.files = result.files
        index.truncated = truncated || result.truncated
        index.indexedAt = now()
      })
      .catch(() => undefined)
      .finally(() => {
        if (index.generation !== generation) return
        index.walking = false
        if (disposed.signal.aborted || index.controller.signal.aborted) return
        if (index.listeners.size > 0 || index.idleTimer !== null) syncWatches(sessionId, index)
        publish(sessionId, index)
      })
  }

  const request = (sessionId: SessionId, listener: (reply: WorkspaceFilesReply) => void): (() => void) => {
    const existing = sessions.get(sessionId)
    const index: SessionIndex = existing ?? {
      directories: new Map(),
      files: [],
      truncated: false,
      indexedAt: null,
      walking: false,
      fullyWatched: false,
      controller: new AbortController(),
      generation: 0,
      listeners: new Set(),
      watches: new Map(),
      relists: new Map(),
      idleTimer: null,
      releaseTimer: null,
    }
    // Re-inserting keeps Map order least-recently-used first, which is what eviction walks.
    if (existing !== undefined) sessions.delete(sessionId)
    sessions.set(sessionId, index)
    if (index.idleTimer !== null) clearTimeout(index.idleTimer)
    index.idleTimer = null
    if (index.releaseTimer !== null) clearTimeout(index.releaseTimer)
    index.releaseTimer = null
    index.listeners.add(listener)
    const fresh = index.indexedAt !== null && (index.fullyWatched || now() - index.indexedAt <= FRESH_MS)
    if (!index.walking && !fresh) refresh(sessionId, index)
    else if (!index.walking) syncWatches(sessionId, index)
    listener(reply(sessionId, index))
    if (existing === undefined) evictIdleOverLimit()
    return () => {
      index.listeners.delete(listener)
      if (index.listeners.size > 0 || index.idleTimer !== null) return
      index.idleTimer = setTimeout(() => {
        index.idleTimer = null
        if (index.listeners.size === 0 && sessions.get(sessionId) === index) stopWatches(index)
      }, WATCH_IDLE_MS)
      // Watches outlive a brief reopen; the walk's retained paths and listings do not outlive this.
      index.releaseTimer = setTimeout(() => {
        index.releaseTimer = null
        if (index.listeners.size > 0 || sessions.get(sessionId) !== index) return
        release(sessionId, index)
      }, RETAINED_INDEX_TTL_MS)
    }
  }

  return {
    request,
    /** Retained walks, the memory this factory is allowed to hold between requests. */
    retainedSessions: () => sessions.size,
    dispose: () => {
      disposed.abort()
      for (const [sessionId, index] of [...sessions]) release(sessionId, index)
    },
  }
}
