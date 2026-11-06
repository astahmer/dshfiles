import type { WorkspaceFilesState } from '@dshfiles/dshx/client'
import { createActor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { RETAINED_INDEX_LIMIT, workspaceIndexMachine } from './workspace-index-machine.js'
import type { ListDirectory, WatchFrame } from './workspace-walk.js'
import { WorkspaceWalk } from './workspace-walk.js'

export { RETAINED_INDEX_LIMIT, RETAINED_INDEX_TTL_MS } from './workspace-index-machine.js'
export const walkWorkspaceFiles = WorkspaceWalk.walkWorkspaceFiles

type FilesReply = Extract<WorkspaceFilesState, { readonly status: 'indexing' | 'ready' }>

interface SessionEntry {
  readonly actor: ActorRefFrom<typeof workspaceIndexMachine>
  readonly listeners: Set<(reply: WorkspaceFilesState) => void>
  readonly subscription: { unsubscribe: () => void }
  /** The last reply delivered, so a snapshot change that does not change the answer publishes nothing. */
  last: FilesReply | undefined
}

/**
 * One walk per session at a time; a fresh complete index answers at once, a stale one answers and refreshes. After
 * a walk, the shallowest directories are watched through Host `changes` (when `watch` is given and the Host
 * supports it) and relisted on change, so new and deleted files show up without waiting for the TTL. Each session's
 * index machine owns its walk, relist debounce and retention timers; this store only routes requests to it.
 */
export const createWorkspaceFileIndex = <SessionId extends string>(options: {
  readonly list: (sessionId: SessionId, path: string, signal: AbortSignal) => ReturnType<ListDirectory>
  /** Reads `.gitignore` files; without it the walk only skips .git/.jj/node_modules. */
  readonly readText?: (sessionId: SessionId, path: string, signal: AbortSignal) => Promise<string>
  readonly watch?: (sessionId: SessionId, path: string, signal: AbortSignal) => AsyncIterable<WatchFrame>
  readonly now?: () => number
}) => {
  const now = options.now ?? Date.now
  const readText = options.readText
  const watch = options.watch
  const sessions = new Map<SessionId, SessionEntry>()

  const replyOf = (sessionId: SessionId, entry: SessionEntry): FilesReply => {
    const snapshot = entry.actor.getSnapshot()
    return {
      status: snapshot.matches({ active: { flow: 'walking' } }) ? 'indexing' : 'ready',
      sessionId,
      files: snapshot.context.files,
      truncated: snapshot.context.truncated,
    }
  }

  const sameReply = (left: FilesReply | undefined, right: FilesReply): boolean =>
    left !== undefined && left.status === right.status && left.files === right.files && left.truncated === right.truncated

  /** Publish the current answer unless it repeats the last one: a walk, relist or attach is the only change that counts. */
  const publish = (sessionId: SessionId): void => {
    const entry = sessions.get(sessionId)
    if (entry === undefined) return
    const reply = replyOf(sessionId, entry)
    if (sameReply(entry.last, reply)) return
    entry.last = reply
    for (const listener of entry.listeners) listener(reply)
  }

  const drop = (sessionId: SessionId, entry: SessionEntry): void => {
    if (sessions.get(sessionId) !== entry) return
    sessions.delete(sessionId)
    entry.subscription.unsubscribe()
    entry.actor.stop()
  }

  const create = (sessionId: SessionId): SessionEntry => {
    let entry: SessionEntry | undefined
    const actor = createActor(workspaceIndexMachine, {
      input: {
        sessionId,
        now,
        // The machine's actions run before its snapshot commits, so publish on the next microtask.
        notify: () => {
          queueMicrotask(() => {
            if (entry !== undefined) publish(sessionId)
          })
        },
        list: (path, signal) => options.list(sessionId, path === '' ? '.' : path, signal),
        readText: readText === undefined ? undefined : (path, signal) => readText(sessionId, path, signal),
        watch: watch === undefined ? undefined : (path, signal) => watch(sessionId, path, signal),
      },
    })
    const created: SessionEntry = {
      actor,
      listeners: new Set(),
      last: undefined,
      subscription: actor.subscribe(snapshot => {
        if (snapshot.matches('released')) drop(sessionId, created)
      }),
    }
    entry = created
    actor.start()
    sessions.set(sessionId, created)
    return created
  }

  /** Keep the retained walks inside their budget, dropping the least recently used idle ones. */
  const evictIdleOverLimit = (): void => {
    for (const [sessionId, entry] of [...sessions]) {
      if (sessions.size <= RETAINED_INDEX_LIMIT) return
      if (entry.listeners.size > 0) continue
      entry.actor.send({ type: 'release' })
      drop(sessionId, entry)
    }
  }

  const request = (sessionId: SessionId, listener: (reply: WorkspaceFilesState) => void): (() => void) => {
    const existing = sessions.get(sessionId)
    // Re-inserting keeps Map order least-recently-used first, which is what eviction walks.
    if (existing !== undefined) {
      sessions.delete(sessionId)
      sessions.set(sessionId, existing)
    }
    const entry = existing ?? create(sessionId)
    entry.listeners.add(listener)
    entry.actor.send({ type: 'attach' })
    const reply = replyOf(sessionId, entry)
    entry.last = reply
    listener(reply)
    if (existing === undefined) evictIdleOverLimit()
    return () => {
      if (!entry.listeners.delete(listener)) return
      entry.actor.send({ type: 'detach' })
    }
  }

  return {
    request,
    /** Retained walks, the memory this factory is allowed to hold between requests. */
    retainedSessions: (): number => sessions.size,
    dispose: (): void => {
      for (const [sessionId, entry] of [...sessions]) {
        entry.actor.send({ type: 'release' })
        drop(sessionId, entry)
      }
    },
  }
}
