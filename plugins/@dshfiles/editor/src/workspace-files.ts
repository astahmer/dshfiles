import { z } from 'zod'

/**
 * Cross-plugin file listing for fuzzy open (thread-sidebar ⌘P): dispatch
 * `new CustomEvent('dshfiles:workspace-files', { detail: { respond, signal }, cancelable: true })`.
 * The editor calls `preventDefault()` when it took the request, then calls `respond` with the cached list first and
 * again as the walk of the session on screen progresses. Paths are workspace-relative, ready for `dshfiles:open-file`.
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

type ListDirectory = (path: string, signal: AbortSignal) => Promise<{ readonly entries: readonly { readonly name: string; readonly type: string }[] }>

/** Breadth-first, so a capped walk still holds the shallow files people open most. Unlistable directories are skipped. */
export const walkWorkspaceFiles = async (options: {
  readonly list: ListDirectory
  readonly signal: AbortSignal
  readonly onProgress: (files: readonly string[]) => void
}): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> => {
  const files: string[] = []
  let level = ['']
  let listed = 0
  let truncated = false
  let progressAt = Date.now()
  while (level.length > 0 && !truncated) {
    const next: string[] = []
    for (let start = 0; start < level.length && !truncated; start += PARALLEL_LISTS) {
      const batch = level.slice(start, start + PARALLEL_LISTS)
      const listings = await Promise.all(batch.map(path => options.list(path, options.signal).catch(() => null)))
      options.signal.throwIfAborted()
      listed += batch.length
      listings.forEach((listing, index) => {
        const parent = batch[index] ?? ''
        for (const entry of listing?.entries ?? []) {
          const path = parent === '' ? entry.name : `${parent}/${entry.name}`
          if (entry.type === 'directory' && !IGNORED_DIRECTORIES.has(entry.name)) next.push(path)
          else if (entry.type === 'file') files.push(path)
        }
      })
      if (files.length >= MAX_FILES || listed + next.length > MAX_DIRECTORIES) truncated = true
      if (Date.now() - progressAt < PROGRESS_INTERVAL_MS) continue
      progressAt = Date.now()
      options.onProgress(files.slice(0, MAX_FILES))
    }
    level = next
  }
  return { files: files.slice(0, MAX_FILES), truncated }
}

interface SessionIndex {
  files: readonly string[]
  truncated: boolean
  indexedAt: number | null
  walking: boolean
  readonly listeners: Set<(reply: WorkspaceFilesReply) => void>
}

/** One walk per session at a time; a fresh complete index answers at once, a stale one answers and refreshes. */
export const createWorkspaceFileIndex = <SessionId extends string>(options: {
  readonly list: (sessionId: SessionId, path: string, signal: AbortSignal) => ReturnType<ListDirectory>
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

  const refresh = (sessionId: SessionId, index: SessionIndex): void => {
    index.walking = true
    const publish = (): void => {
      for (const listener of index.listeners) listener(reply(sessionId, index))
    }
    void walkWorkspaceFiles({
      list: (path, signal) => options.list(sessionId, path === '' ? '.' : path, signal),
      signal: disposed.signal,
      onProgress: files => {
        // Progress only grows the list; a stale index keeps answering until the new walk overtakes it.
        if (files.length < index.files.length) return
        index.files = files
        publish()
      },
    })
      .then(result => {
        index.files = result.files
        index.truncated = result.truncated
        index.indexedAt = now()
      })
      .catch(() => undefined)
      .finally(() => {
        index.walking = false
        if (!disposed.signal.aborted) publish()
      })
  }

  const request = (sessionId: SessionId, listener: (reply: WorkspaceFilesReply) => void): (() => void) => {
    const index: SessionIndex = sessions.get(sessionId) ?? { files: [], truncated: false, indexedAt: null, walking: false, listeners: new Set() }
    sessions.set(sessionId, index)
    index.listeners.add(listener)
    if (!index.walking && (index.indexedAt === null || now() - index.indexedAt > FRESH_MS)) refresh(sessionId, index)
    listener(reply(sessionId, index))
    return () => index.listeners.delete(listener)
  }

  return { request, dispose: () => disposed.abort() }
}
