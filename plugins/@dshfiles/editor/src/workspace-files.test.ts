import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceFileIndex, RETAINED_INDEX_LIMIT, RETAINED_INDEX_TTL_MS, walkWorkspaceFiles } from './workspace-files.js'
import type { WorkspaceFilesState } from '@dshfiles/dshx/client'

interface Tree {
  [name: string]: Tree | 'file'
}

const lister = (tree: Tree, failing: ReadonlySet<string> = new Set()) => {
  const listed: string[] = []
  const list = async (path: string) => {
    listed.push(path)
    if (failing.has(path)) throw new Error(`cannot list ${path}`)
    let node: Tree | 'file' | undefined = tree
    for (const part of path === '' || path === '.' ? [] : path.split('/')) node = node === 'file' || node === undefined ? undefined : node[part]
    if (node === undefined || node === 'file') throw new Error(`not a directory: ${path}`)
    return { entries: Object.entries(node).map(([name, child]) => ({ name, type: child === 'file' ? 'file' : 'directory' })) }
  }
  return { list, listed }
}

const workspace: Tree = {
  'README.md': 'file',
  src: { 'index.ts': 'file', lib: { 'deep.ts': 'file' } },
  node_modules: { react: { 'index.js': 'file' } },
  '.git': { HEAD: 'file' },
  '.jj': { repo: { store: 'file' } },
  locked: { 'secret.ts': 'file' },
}

describe('walkWorkspaceFiles', () => {
  it('lists files breadth-first, skips .git/.jj/node_modules and directories it cannot list', async () => {
    const { list, listed } = lister(workspace, new Set(['locked']))
    const result = await walkWorkspaceFiles({ list, signal: new AbortController().signal, onProgress: () => undefined })
    expect(result).toEqual({ files: ['README.md', 'src/index.ts', 'src/lib/deep.ts'], truncated: false })
    expect(listed.some(path => path.startsWith('node_modules') || path.startsWith('.git') || path.startsWith('.jj'))).toBe(false)
  })

  it('stops at the file cap and reports truncation', async () => {
    const wide: Tree = Object.fromEntries(
      Array.from({ length: 30 }, (_, directory) => [
        `d${directory}`,
        Object.fromEntries(Array.from({ length: 1000 }, (_, file) => [`f${file}.ts`, 'file' as const])),
      ]),
    )
    const { list } = lister(wide)
    const result = await walkWorkspaceFiles({ list, signal: new AbortController().signal, onProgress: () => undefined })
    expect(result.truncated).toBe(true)
    expect(result.files).toHaveLength(20_000)
  })
})

describe('createWorkspaceFileIndex', () => {
  it('answers indexing, then ready, and serves a fresh index without walking again', async () => {
    const { list, listed } = lister(workspace, new Set(['locked']))
    let clock = 0
    const index = createWorkspaceFileIndex({ list: (_sessionId, path) => list(path), now: () => clock })
    const replies: WorkspaceFilesState[] = []
    const stop = index.request('ses_1', reply => replies.push(reply))
    expect(replies[0]).toMatchObject({ status: 'indexing', files: [] })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(replies.at(-1)).toEqual({ status: 'ready', sessionId: 'ses_1', files: ['README.md', 'src/index.ts', 'src/lib/deep.ts'], truncated: false })
    stop()

    const walksBefore = listed.length
    clock = 10_000
    const again: WorkspaceFilesState[] = []
    index.request('ses_1', reply => again.push(reply))
    expect(again).toEqual([{ status: 'ready', sessionId: 'ses_1', files: ['README.md', 'src/index.ts', 'src/lib/deep.ts'], truncated: false }])
    expect(listed.length).toBe(walksBefore)

    clock = 60_000
    const stale: WorkspaceFilesState[] = []
    index.request('ses_1', reply => stale.push(reply))
    expect(stale[0]).toMatchObject({ status: 'indexing', files: ['README.md', 'src/index.ts', 'src/lib/deep.ts'] })
    index.dispose()
  })
})

describe('createWorkspaceFileIndex retention', () => {
  it('releases an idle session, cancels its walk and never publishes that walk afterwards', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { list } = lister(workspace)
      const signals: AbortSignal[] = []
      const pendingListings: (() => void)[] = []
      const index = createWorkspaceFileIndex({
        list: (_sessionId, path, signal) => {
          signals.push(signal)
          return new Promise(resolve => {
            pendingListings.push(() => void list(path).then(listing => resolve(listing)))
          })
        },
        now: () => 0,
      })
      const replies: WorkspaceFilesState[] = []
      const stop = index.request('ses_1', reply => replies.push(reply))
      expect(index.retainedSessions()).toBe(1)

      stop()
      await vi.advanceTimersByTimeAsync(RETAINED_INDEX_TTL_MS)

      expect(index.retainedSessions()).toBe(0)
      expect(signals.length).toBeGreaterThan(0)
      expect(signals.every(signal => signal.aborted)).toBe(true)

      const before = replies.length
      for (const resolve of pendingListings) resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(replies.length).toBe(before)
      index.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('evicts the least recently used idle session when the retained budget is exceeded', async () => {
    const { list, listed } = lister(workspace)
    const index = createWorkspaceFileIndex({ list: (_sessionId, path) => list(path), now: () => 0 })
    const sessionIds = Array.from({ length: RETAINED_INDEX_LIMIT }, (_unused, position) => `ses_${String(position)}`)
    for (const sessionId of sessionIds) {
      // Each session is retained and then left idle, so the budget is the only thing keeping it.
      const stop = index.request(sessionId, () => undefined)
      stop()
    }
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(index.retainedSessions()).toBe(RETAINED_INDEX_LIMIT)

    const newest = sessionIds.at(-1) ?? ''
    index.request('ses_new', () => undefined)
    expect(index.retainedSessions()).toBe(RETAINED_INDEX_LIMIT)

    // The newest retained session still answers without walking; the evicted oldest walks again.
    const afterEviction = listed.length
    index.request(newest, () => undefined)
    expect(listed.length).toBe(afterEviction)
    index.request(sessionIds[0] ?? '', () => undefined)
    expect(listed.length).toBeGreaterThan(afterEviction)
    index.dispose()
  })
})

/** Host `changes` stand-in: one stream per watched directory; `emit` sends that directory a change frame. */
const watcher = () => {
  const streams = new Map<string, (frame: { kind: 'change' }) => void>()
  const watch = (_sessionId: string, path: string, signal: AbortSignal): AsyncIterable<{ readonly kind: 'ready' | 'change' }> => ({
    [Symbol.asyncIterator]: () => {
      const queue: { kind: 'change' }[] = []
      let wake: (() => void) | null = null
      streams.set(path, frame => {
        queue.push(frame)
        wake?.()
      })
      signal.addEventListener('abort', () => {
        streams.delete(path)
        wake?.()
      })
      return {
        next: async () => {
          while (queue.length === 0 && !signal.aborted) await new Promise<void>(resolve => (wake = resolve))
          const frame = queue.shift()
          return frame === undefined ? { done: true, value: undefined } : { done: false, value: frame }
        },
      }
    },
  })
  return { watch, watched: () => [...streams.keys()].sort(), emit: (path: string) => streams.get(path)?.({ kind: 'change' }) }
}

describe('createWorkspaceFileIndex with Host changes', () => {
  it('relists a watched directory on change, so new and removed files show up before the TTL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const tree: Tree = { 'README.md': 'file', src: { 'index.ts': 'file' } }
      const { list } = lister(tree)
      const { watch, watched, emit } = watcher()
      const index = createWorkspaceFileIndex({ list: (_sessionId, path) => list(path), watch, now: () => 0 })
      const replies: WorkspaceFilesState[] = []
      const stop = index.request('ses_1', reply => replies.push(reply))
      await vi.waitFor(() => expect(replies.at(-1)).toMatchObject({ status: 'ready' }))
      expect(watched()).toEqual(['.', 'src'])

      const src = tree.src
      if (src === undefined || src === 'file') throw new Error('fixture')
      src['new.ts'] = 'file'
      src.lib = { 'deep.ts': 'file' }
      emit('src')
      await vi.advanceTimersByTimeAsync(200)
      await vi.waitFor(() => expect(replies.at(-1)).toMatchObject({ files: ['README.md', 'src/index.ts', 'src/new.ts', 'src/lib/deep.ts'] }))
      expect(watched()).toEqual(['.', 'src', 'src/lib'])

      delete tree.src
      emit('.')
      await vi.advanceTimersByTimeAsync(200)
      await vi.waitFor(() => expect(replies.at(-1)).toMatchObject({ files: ['README.md'] }))
      expect(watched()).toEqual(['.'])

      stop()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(watched()).toEqual([])
      index.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('walkWorkspaceFiles with .gitignore', () => {
  it('drops paths the root and nested .gitignore files ignore, re-including negated ones', async () => {
    const tree: Tree = {
      '.gitignore': 'file',
      'README.md': 'file',
      'debug.log': 'file',
      dist: { 'bundle.js': 'file' },
      packages: {
        app: { '.gitignore': 'file', 'keep.log': 'file', 'index.ts': 'file', generated: { 'types.ts': 'file' } },
      },
    }
    const gitignores = new Map([
      ['.gitignore', '# build output\n/dist/\n*.log\n'],
      ['packages/app/.gitignore', 'generated/\n!keep.log\n'],
    ])
    const { list, listed } = lister(tree)
    const result = await walkWorkspaceFiles({
      list,
      readText: async path => gitignores.get(path) ?? '',
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })
    expect(result.files).toEqual(['.gitignore', 'README.md', 'packages/app/.gitignore', 'packages/app/keep.log', 'packages/app/index.ts'])
    expect(listed).not.toContain('dist')
    expect(listed).not.toContain('packages/app/generated')
  })
})
