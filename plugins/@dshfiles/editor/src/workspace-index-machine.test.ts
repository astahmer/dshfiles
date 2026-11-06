import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { RETAINED_INDEX_TTL_MS, WATCH_IDLE_MS, workspaceIndexMachine } from './workspace-index-machine.js'
import { walkWorkspaceFiles } from './workspace-files.js'

interface Tree {
  [name: string]: Tree | 'file'
}

const lister = (tree: Tree) => {
  const list = async (path: string) => {
    const node =
      path === '' || path === '.'
        ? tree
        : path.split('/').reduce<Tree | 'file' | undefined>((current, part) => (current === 'file' || current === undefined ? undefined : current[part]), tree)
    if (node === undefined || node === 'file') throw new Error(`not a directory: ${path}`)
    return { entries: Object.entries(node).map(([name, child]) => ({ name, type: child === 'file' ? 'file' : 'directory' })) }
  }
  return { list }
}

const start = (tree: Tree, watch?: (path: string, signal: AbortSignal) => AsyncIterable<{ readonly kind: 'ready' | 'change' }>) => {
  const { list } = lister(tree)
  const notices: string[] = []
  const actor = createActor(workspaceIndexMachine, {
    input: {
      sessionId: 'ses_1',
      now: () => 0,
      notify: () => notices.push('notify'),
      list: (path, _signal) => list(path),
      readText: undefined,
      watch,
    },
  })
  actor.start()
  return { actor, notices }
}

describe('workspaceIndexMachine', () => {
  it('walks on attach, answers ready, then answers a fresh index without walking again', async () => {
    const { actor, notices } = start({ 'a.ts': 'file', src: { 'b.ts': 'file' } })
    expect(actor.getSnapshot().value).toMatchObject({ active: { flow: 'idle' } })
    actor.send({ type: 'attach' })
    await vi.waitFor(() => expect(actor.getSnapshot().value).toMatchObject({ active: { flow: 'idle' } }))
    await vi.waitFor(() => expect(actor.getSnapshot().context.files).toEqual(['a.ts', 'src/b.ts']))
    expect(notices.length).toBeGreaterThan(0)

    actor.send({ type: 'detach' })
    actor.send({ type: 'attach' })
    expect(actor.getSnapshot().value).toMatchObject({ active: { flow: 'idle' } })
    actor.stop()
  })

  it('releases a quiet index after the retention TTL and aborts its walk', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { list } = lister({ 'a.ts': 'file' })
      const signals: AbortSignal[] = []
      const actor = createActor(workspaceIndexMachine, {
        input: {
          sessionId: 'ses_1',
          now: () => 0,
          notify: () => undefined,
          list: (path, signal) => {
            signals.push(signal)
            return list(path)
          },
          readText: undefined,
          watch: undefined,
        },
      })
      actor.start()
      actor.send({ type: 'attach' })
      actor.send({ type: 'detach' })
      expect(actor.getSnapshot().value).toMatchObject({ active: { retention: 'quiet' } })

      await vi.advanceTimersByTimeAsync(WATCH_IDLE_MS)
      expect(actor.getSnapshot().value).toMatchObject({ active: { retention: 'dormant' } })
      await vi.advanceTimersByTimeAsync(RETAINED_INDEX_TTL_MS - WATCH_IDLE_MS)
      expect(actor.getSnapshot().matches('released')).toBe(true)
      expect(signals.every(signal => signal.aborted)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('relists a changed directory after the debounce and keeps the last walk when released meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const tree: Tree = { 'README.md': 'file', src: { 'a.ts': 'file' } }
      const emit: ((frame: { kind: 'change' }) => void)[] = []
      const watch = (_path: string, signal: AbortSignal): AsyncIterable<{ readonly kind: 'ready' | 'change' }> => ({
        [Symbol.asyncIterator]: () => {
          const queue: { kind: 'change' }[] = []
          let wake: (() => void) | null = null
          emit.push(frame => {
            queue.push(frame)
            wake?.()
          })
          signal.addEventListener('abort', () => wake?.())
          return {
            next: async () => {
              while (queue.length === 0 && !signal.aborted) await new Promise<void>(resolve => (wake = resolve))
              const frame = queue.shift()
              return frame === undefined ? { done: true, value: undefined } : { done: false, value: frame }
            },
          }
        },
      })
      const { actor } = start(tree, watch)
      actor.send({ type: 'attach' })
      await vi.waitFor(() => expect(actor.getSnapshot().context.files).toEqual(['README.md', 'src/a.ts']))

      const src = tree.src
      if (src === undefined || src === 'file') throw new Error('fixture')
      src['b.ts'] = 'file'
      emit.at(-1)?.({ kind: 'change' })
      await vi.waitFor(() => expect(actor.getSnapshot().value).toMatchObject({ active: { flow: 'pending' } }))
      await vi.advanceTimersByTimeAsync(200)
      await vi.waitFor(() => expect(actor.getSnapshot().context.files).toEqual(['README.md', 'src/a.ts', 'src/b.ts']))
      actor.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('walkWorkspaceFiles', () => {
  it('lists breadth-first and skips the fixed directory list', async () => {
    const { list } = lister({ 'a.ts': 'file', src: { 'b.ts': 'file' }, node_modules: { 'c.ts': 'file' } })
    const result = await walkWorkspaceFiles({ list, signal: new AbortController().signal, onProgress: () => undefined })
    expect(result.files).toEqual(['a.ts', 'src/b.ts'])
  })
})
