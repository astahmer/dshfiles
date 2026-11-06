import { assign, fromCallback, fromPromise, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import {
  MAX_WATCHED_DIRECTORIES,
  WorkspaceWalk,
  type Directories,
  type DirectoryListing,
  type ListDirectory,
  type ReadText,
  type WatchFrame,
} from './workspace-walk.js'

export const FRESH_MS = 30_000
export const RELIST_DELAY_MS = 150
/** How long watches outlive the last listener, so reopening ⌘P soon after still gets a live list. */
export const WATCH_IDLE_MS = 30_000
/** Retained walks are a memory budget: this many quiet sessions stay warm, and only for this long. */
export const RETAINED_INDEX_LIMIT = 8
export const RETAINED_INDEX_TTL_MS = 5 * 60_000

export interface WorkspaceIndexInput {
  readonly sessionId: string
  readonly list: ListDirectory
  readonly readText: ReadText | undefined
  readonly watch: ((path: string, signal: AbortSignal) => AsyncIterable<WatchFrame>) | undefined
  readonly now: () => number
  readonly notify: () => void
}

interface WorkspaceIndexContext {
  readonly sessionId: string
  readonly list: ListDirectory
  readonly readText: ReadText | undefined
  readonly watch: ((path: string, signal: AbortSignal) => AsyncIterable<WatchFrame>) | undefined
  readonly now: () => number
  readonly notify: () => void
  readonly directories: Directories
  readonly files: readonly string[]
  readonly truncated: boolean
  readonly indexedAt: number | null
  readonly listenerCount: number
  readonly wantedDirectories: readonly string[]
  readonly watchedDirectories: number
  readonly dirty: ReadonlySet<string>
  readonly controller: AbortController
  readonly watchers: ActorRefFrom<typeof directoryWatcher> | null
}

type WorkspaceIndexEvent =
  | { readonly type: 'attach' }
  | { readonly type: 'detach' }
  | { readonly type: 'release' }
  | { readonly type: 'directory.changed'; readonly path: string }
  | { readonly type: 'walk.progress'; readonly files: readonly string[] }
  | { readonly type: 'walk.done'; readonly directories: Directories; readonly files: readonly string[]; readonly truncated: boolean }
  | { readonly type: 'walk.failed' }
  | { readonly type: 'watch.count'; readonly count: number }

interface WatcherInput {
  readonly watch: ((path: string, signal: AbortSignal) => AsyncIterable<WatchFrame>) | undefined
  readonly signal: AbortSignal
}

type WatcherCommand = { readonly type: 'synchronize'; readonly paths: readonly string[] }
const wantedDirectoriesOf = (directories: Directories): readonly string[] => WorkspaceWalk.breadthFirst(directories).slice(0, MAX_WATCHED_DIRECTORIES)

const isFullyWatched = (context: WorkspaceIndexContext): boolean =>
  !context.truncated && context.directories.size > 0 && context.watchedDirectories === context.directories.size

const isFresh = (context: WorkspaceIndexContext): boolean =>
  context.indexedAt !== null && (isFullyWatched(context) || context.now() - context.indexedAt <= FRESH_MS)

/** One stream per watched directory; it never holds the walk, it only reports changes back to the index machine. */
const directoryWatcher = fromCallback<WatcherCommand, WatcherInput>(({ input, receive, sendBack }) => {
  const controllers = new Map<string, AbortController>()
  const stop = (path: string): void => {
    controllers.get(path)?.abort()
    controllers.delete(path)
  }
  const follow = (path: string): void => {
    const watch = input.watch
    if (watch === undefined) return
    const controller = new AbortController()
    controllers.set(path, controller)
    void (async () => {
      try {
        for await (const frame of watch(path === '' ? '.' : path, AbortSignal.any([controller.signal, input.signal]))) {
          if (frame.kind === 'change') sendBack({ type: 'directory.changed', path })
        }
      } catch {
        // An unsupported or dropped watch leaves this directory to the TTL refresh.
      }
      if (controllers.get(path) !== controller) return
      controllers.delete(path)
      sendBack({ type: 'watch.count', count: controllers.size })
    })()
  }
  receive(event => {
    if (event.type !== 'synchronize') return
    const wanted = new Set(event.paths)
    for (const path of [...controllers.keys()]) if (!wanted.has(path)) stop(path)
    for (const path of event.paths) if (!controllers.has(path)) follow(path)
    sendBack({ type: 'watch.count', count: controllers.size })
  })
  return () => {
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
  }
})

/** One whole-workspace walk, reporting progress so the list grows while it reads. */
const walk = fromCallback<WorkspaceIndexEvent, { readonly list: ListDirectory; readonly readText: ReadText | undefined; readonly signal: AbortSignal }>(
  ({ input, sendBack }) => {
    const directories: Directories = new Map()
    void WorkspaceWalk.walkInto({
      list: input.list,
      readText: input.readText,
      signal: input.signal,
      directories,
      roots: [''],
      onProgress: () => sendBack({ type: 'walk.progress', files: WorkspaceWalk.flatten(directories).files }),
    })
      .then(truncated => {
        const result = WorkspaceWalk.flatten(directories)
        sendBack({ type: 'walk.done', directories, files: result.files, truncated: truncated || result.truncated })
      })
      .catch(() => sendBack({ type: 'walk.failed' }))
  },
)

/** The directories a watch reported changed, relisted shallow-first, then the added ones walked once. */
const relist = fromPromise<
  { readonly files: readonly string[]; readonly truncated: boolean } | null,
  {
    readonly list: ListDirectory
    readonly readText: ReadText | undefined
    readonly directories: Directories
    readonly paths: readonly string[]
    readonly signal: AbortSignal
  }
>(async ({ input, signal }) => {
  if (input.paths.length === 0) return null
  const listings = new Map<string, DirectoryListing | null>()
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < input.paths.length && !signal.aborted) {
      const path = input.paths[next++]
      if (path === undefined) return
      listings.set(path, await WorkspaceWalk.readDirectory({ list: input.list, readText: input.readText, directories: input.directories, path, signal }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, input.paths.length) }, worker))
  if (signal.aborted) return null
  const added: string[] = []
  for (const path of input.paths) {
    // A shallower result of this pass may have removed this directory; do not bring it back.
    if (path !== '' && !input.directories.has(path)) continue
    const listing = listings.get(path) ?? null
    const previous = input.directories.get(path)
    if (listing === null) {
      removeSubtree(input.directories, path)
      continue
    }
    for (const child of previous?.directories ?? []) if (!listing.directories.includes(child)) removeSubtree(input.directories, child)
    input.directories.set(path, listing)
    for (const child of listing.directories) if (!input.directories.has(child)) added.push(child)
  }
  if (added.length > 0) {
    await WorkspaceWalk.walkInto({
      list: input.list,
      readText: input.readText,
      signal,
      directories: input.directories,
      roots: added,
    }).catch(() => undefined)
  }
  if (signal.aborted) return null
  return WorkspaceWalk.flatten(input.directories)
})

const removeSubtree = (directories: Directories, path: string): void => {
  const listing = directories.get(path)
  directories.delete(path)
  for (const child of listing?.directories ?? []) removeSubtree(directories, child)
}

const withDirty = (dirty: ReadonlySet<string>, path: string): ReadonlySet<string> => new Set([...dirty, path])

/**
 * One session's file index. The machine owns which phase the index is in — walking, relisting after a debounce, or
 * quiet — and the retention timers that stop its watches and release the retained walk, so a released index cannot
 * publish, re-watch or relist afterwards.
 */
export const workspaceIndexMachine = setup({
  // SAFETY: XState uses empty carriers for inference; runtime context comes from input and events are typed above.
  types: {
    context: {} as WorkspaceIndexContext,
    events: {} as WorkspaceIndexEvent,
    input: {} as WorkspaceIndexInput,
  },
  actors: { directoryWatcher, walk, relist },
  guards: {
    needsWalk: ({ context }) => !isFresh(context),
    hasDirty: ({ context }) => context.dirty.size > 0,
    lastListener: ({ context }) => context.listenerCount <= 1,
    grew: ({ context, event }) => event.type === 'walk.progress' && event.files.length > context.files.length,
  },
  actions: {
    addListener: assign(({ context }) => ({ listenerCount: context.listenerCount + 1 })),
    removeListener: assign(({ context }) => ({ listenerCount: Math.max(0, context.listenerCount - 1) })),
    markDirty: assign(({ context, event }) => (event.type === 'directory.changed' ? { dirty: withDirty(context.dirty, event.path) } : {})),
    clearDirty: assign({ dirty: new Set<string>() }),
    applyProgress: assign(({ event }) => (event.type === 'walk.progress' ? { files: event.files } : {})),
    applyWalk: assign(({ context, event }) =>
      event.type === 'walk.done'
        ? {
            directories: event.directories,
            files: event.files,
            truncated: event.truncated,
            indexedAt: context.now(),
            wantedDirectories: wantedDirectoriesOf(event.directories),
          }
        : {},
    ),
    indexStamp: assign(({ context }) => ({ indexedAt: isFullyWatched(context) ? context.now() : context.indexedAt })),
    countWatch: assign(({ event }) => (event.type === 'watch.count' ? { watchedDirectories: event.count } : {})),
    notify: ({ context }) => context.notify(),
    synchronizeWatches: ({ context }) => context.watchers?.send({ type: 'synchronize', paths: context.wantedDirectories }),
    stopWatches: ({ context }) => context.watchers?.send({ type: 'synchronize', paths: [] }),
    abortWork: ({ context }) => context.controller.abort(),
  },
}).createMachine({
  id: 'workspaceIndex',
  context: ({ input }) => ({
    ...input,
    directories: new Map(),
    files: [],
    truncated: false,
    indexedAt: null,
    listenerCount: 0,
    wantedDirectories: [],
    watchedDirectories: 0,
    dirty: new Set<string>(),
    controller: new AbortController(),
    watchers: null,
  }),
  initial: 'active',
  on: { release: { target: '#released' } },
  states: {
    active: {
      type: 'parallel',
      entry: assign(({ context, spawn }) =>
        context.watch === undefined ? {} : { watchers: spawn('directoryWatcher', { input: { watch: context.watch, signal: context.controller.signal } }) },
      ),
      states: {
        flow: {
          initial: 'idle',
          states: {
            idle: {
              always: [{ guard: 'hasDirty', target: 'pending' }],
              on: {
                attach: [{ guard: 'needsWalk', target: 'walking' }, { actions: 'notify' }],
                'directory.changed': { target: 'pending', actions: 'markDirty' },
              },
            },
            pending: {
              after: { [RELIST_DELAY_MS]: 'relisting' },
              on: {
                attach: [{ guard: 'needsWalk', target: 'walking', actions: 'clearDirty' }, { actions: 'notify' }],
                'directory.changed': { actions: 'markDirty' },
              },
            },
            relisting: {
              invoke: {
                id: 'relist',
                src: 'relist',
                input: ({ context }) => ({
                  list: context.list,
                  readText: context.readText,
                  directories: context.directories,
                  paths: WorkspaceWalk.sortedByDepth(context.dirty),
                  signal: context.controller.signal,
                }),
                onDone: [
                  {
                    guard: ({ event }) => event.output !== null,
                    target: 'idle',
                    actions: [
                      assign(({ context, event }) =>
                        event.output === null
                          ? {}
                          : { files: event.output.files, truncated: event.output.truncated, wantedDirectories: wantedDirectoriesOf(context.directories) },
                      ),
                      'clearDirty',
                      'synchronizeWatches',
                      'notify',
                    ],
                  },
                  { target: 'idle', actions: 'clearDirty' },
                ],
              },
              on: {
                attach: [{ guard: 'needsWalk', target: 'walking', actions: 'clearDirty' }, { actions: 'notify' }],
                'directory.changed': { actions: 'markDirty' },
              },
            },
            walking: {
              invoke: {
                src: 'walk',
                input: ({ context }) => ({ list: context.list, readText: context.readText, signal: context.controller.signal }),
              },
              entry: ['clearDirty'],
              on: {
                'walk.progress': [{ guard: 'grew', actions: ['applyProgress', 'notify'] }, {}],
                'walk.done': { target: 'idle', actions: ['applyWalk', 'synchronizeWatches', 'notify'] },
                'walk.failed': { target: 'idle', actions: 'notify' },
                'directory.changed': { actions: 'markDirty' },
              },
            },
          },
        },
        retention: {
          initial: 'attached',
          states: {
            attached: {
              entry: 'synchronizeWatches',
              on: {
                attach: { actions: 'addListener' },
                detach: [{ guard: 'lastListener', target: 'quiet', actions: 'removeListener' }, { actions: 'removeListener' }],
              },
            },
            quiet: {
              after: { [WATCH_IDLE_MS]: { target: 'dormant' }, [RETAINED_INDEX_TTL_MS]: { target: '#released' } },
              on: { attach: { target: 'attached', actions: 'addListener' } },
            },
            dormant: {
              entry: ['indexStamp', 'stopWatches'],
              after: { [RETAINED_INDEX_TTL_MS - WATCH_IDLE_MS]: { target: '#released' } },
              on: { attach: { target: 'attached', actions: 'addListener' } },
            },
          },
        },
      },
    },
    released: {
      id: 'released',
      entry: 'abortWork',
    },
  },
})

export type { WorkspaceIndexContext }
