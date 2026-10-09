import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { createEditorStore } from './editor-store.js'
import { resolveRequestedPath } from './open-file.js'

// SAFETY: test ids only flow back into the fake remote below.
const session = 'ses_1' as SessionId

/** A workspace at `/real/w` whose session cwd is the symlink `/link/w`; files are keyed by real absolute path. */
const fakeRemote = (files: Readonly<Record<string, Uint8Array<ArrayBuffer>>>) => {
  const reads: string[] = []
  const resolve = (path: string): string => {
    if (path.startsWith('/link/w/')) return '/real/w/' + path.slice('/link/w/'.length)
    return path.startsWith('/') ? path : '/real/w/' + path
  }
  const workspaceFiles = {
    readBytes: async (_sessionId: SessionId, path: string) => {
      reads.push(path)
      const absolutePath = resolve(path)
      const data = files[absolutePath]
      if (data === undefined) return { ok: false as const, error: { code: 'workspace-file/not-found', message: 'missing' } }
      return { ok: true as const, value: { absolutePath, version: 'v1', bytes: data.byteLength, offset: 0, data, eof: true } }
    },
    changes: (_sessionId: SessionId, _path: string, signal?: AbortSignal) => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<never>>(resolve => signal?.addEventListener('abort', () => resolve({ done: true, value: undefined }))),
      }),
    }),
  }
  return { remote: { workspaceFiles }, reads }
}

const text = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value)
const loaded = (store: ReturnType<typeof createEditorStore>) =>
  vi.waitFor(() => expect(store.getSnapshot().documents.every(document => document.status !== 'loading')).toBe(true))

describe('resolveRequestedPath', () => {
  it('collapses ./, // and .. and strips a known root', () => {
    expect(resolveRequestedPath({ path: './src//a/../b.ts' })).toBe('src/b.ts')
    expect(resolveRequestedPath({ path: '/link/w/./src/b.ts' }, ['/link/w/'])).toBe('src/b.ts')
    expect(resolveRequestedPath({ path: 'b.ts', cwd: '/link/w/src' }, ['/link/w'])).toBe('src/b.ts')
    expect(resolveRequestedPath({ path: '/elsewhere/b.ts' }, ['/link/w'])).toBe('/elsewhere/b.ts')
    expect(resolveRequestedPath({ path: '/link/wx/b.ts' }, ['/link/w'])).toBe('/link/wx/b.ts')
  })
})

describe('editor store tab identity', () => {
  it('opens one tab for relative, ./ and absolute spellings under the session cwd', async () => {
    const { remote } = fakeRemote({ '/real/w/src/a.ts': text('a') })
    // SAFETY: the fake implements exactly the readBytes/changes calls the store makes.
    const store = createEditorStore({ remote: remote as never, workspaceRoot: () => '/link/w' })
    store.open(session, { path: 'src/a.ts' })
    store.open(session, { path: './src/a.ts' })
    store.open(session, { path: '/link/w/src/a.ts', line: 3 })
    await loaded(store)
    const state = store.getSnapshot()
    expect(state.documents.map(document => document.path)).toEqual(['src/a.ts'])
    expect(state.documents[0]?.reveal?.line).toBe(3)
    store.dispose()
  })

  it('merges a symlink-resolved absolute spelling into the open tab once both are loaded', async () => {
    const { remote } = fakeRemote({ '/real/w/src/a.ts': text('a') })
    // SAFETY: as above.
    const store = createEditorStore({ remote: remote as never })
    store.open(session, { path: '/real/w/src/a.ts' })
    store.open(session, { path: 'src/a.ts', line: 7 })
    expect(store.getSnapshot().documents).toHaveLength(2)
    await vi.waitFor(() => expect(store.getSnapshot().documents).toHaveLength(1))
    await loaded(store)
    let state = store.getSnapshot()
    expect(state.documents.map(document => document.absolutePath)).toEqual(['/real/w/src/a.ts'])
    expect(state.activeBySession[session]).toBe(state.documents[0]?.id)
    expect(state.documents[0]?.reveal?.line).toBe(7)

    // The learnt real root now matches both spellings before anything loads.
    store.open(session, { path: 'src/a.ts' })
    store.open(session, { path: '/real/w/./src/a.ts' })
    state = store.getSnapshot()
    expect(state.documents).toHaveLength(1)
    store.dispose()
  })
})

describe('editor store binary content', () => {
  it('previews images, flags other binary files and keeps both away from the text buffer', async () => {
    const { remote } = fakeRemote({
      '/real/w/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]),
      '/real/w/data.bin': new Uint8Array([0, 1, 2, 3]),
      '/real/w/latin1.txt': new Uint8Array([0xe9, 0x74, 0xe9]),
      '/real/w/notes.md': text('# hi'),
    })
    // SAFETY: as above.
    const store = createEditorStore({ remote: remote as never })
    for (const path of ['logo.png', 'data.bin', 'latin1.txt', 'notes.md']) store.open(session, { path })
    await loaded(store)
    const byPath = Object.fromEntries(store.getSnapshot().documents.map(document => [document.path, document]))
    expect(byPath['logo.png']?.content).toMatchObject({ kind: 'image', bytes: 6 })
    expect(byPath['logo.png']?.content.kind === 'image' && byPath['logo.png'].content.url.startsWith('blob:')).toBe(true)
    expect(byPath['data.bin']?.content).toEqual({ kind: 'binary', bytes: 4 })
    expect(byPath['latin1.txt']?.content).toEqual({ kind: 'binary', bytes: 3 })
    expect(byPath['notes.md']).toMatchObject({ content: { kind: 'text' }, text: '# hi' })
    for (const path of ['logo.png', 'data.bin', 'latin1.txt']) expect(byPath[path]?.text).toBe('')
    store.dispose()
  })
})
