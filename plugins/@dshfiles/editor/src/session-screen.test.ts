import { constantSource, createSource, type WorkspaceFilesState } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import { createSessionScreen } from './session-screen.js'
import { createWorkspaceFileIndex } from './workspace-files.js'

const workspaces: Record<string, Record<string, readonly { readonly name: string; readonly type: string }[]>> = {
  ses_a: {
    '.': [
      { name: 'a.ts', type: 'file' },
      { name: 'src', type: 'directory' },
    ],
    src: [{ name: 'deep.ts', type: 'file' }],
  },
  ses_b: { '.': [{ name: 'b.ts', type: 'file' }] },
}

const listDirectory = async (sessionId: string, path: string) => {
  const entries = workspaces[sessionId]?.[path === '' ? '.' : path]
  if (entries === undefined) throw new Error(`cannot list ${path}`)
  return { entries }
}

const screenFor = (mountedId: string | undefined) => {
  const mounted = createSource<string | undefined>(mountedId)
  const screen = createSessionScreen({
    current: constantSource(mountedId),
    mounted,
    fileIndex: createWorkspaceFileIndex({ list: listDirectory }),
    asSessionId: id => id,
    list: async (sessionId, path) => {
      const entries = workspaces[sessionId]?.[path]
      return entries === undefined ? { ok: false, error: { code: 'workspace-file/not-found' } } : { ok: true, value: { path, entries, truncated: false } }
    },
    search: async (sessionId, query) =>
      sessionId === 'ses_a' ? { ok: true, value: [{ path: `src/${query}.ts`, kind: 'file' }] } : { ok: false, error: { code: 'session/unknown' } },
  })
  return { screen, mounted }
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

describe('session screen', () => {
  it('indexes the mounted session while followed and moves with it', async () => {
    const { screen, mounted } = screenFor('ses_a')
    const seen: WorkspaceFilesState[] = []
    const stop = screen.files.index.subscribe(() => seen.push(screen.files.index.get()))
    await settled()
    expect(screen.files.index.get()).toMatchObject({ status: 'ready', sessionId: 'ses_a', files: ['a.ts', 'src/deep.ts'] })
    mounted.set('ses_b')
    await settled()
    expect(screen.files.index.get()).toMatchObject({ status: 'ready', sessionId: 'ses_b', files: ['b.ts'] })
    mounted.set(undefined)
    expect(screen.files.index.get()).toEqual({ status: 'no-session' })
    stop()
    expect(seen.length).toBeGreaterThan(2)
  })

  it('lists one tree level with workspace-relative paths, and nothing for a directory the Host refuses', async () => {
    const { screen } = screenFor('ses_a')
    expect(await screen.files.list({ path: 'src' })).toEqual([{ name: 'deep.ts', path: 'src/deep.ts', type: 'file' }])
    expect(await screen.files.list({ path: '' })).toEqual([
      { name: 'a.ts', path: 'a.ts', type: 'file' },
      { name: 'src', path: 'src', type: 'directory' },
    ])
    expect(await screen.files.list({ path: 'missing' })).toBeUndefined()
  })

  it('searches the addressed session and answers no hits when the Host fails or no session is mounted', async () => {
    const { screen } = screenFor('ses_a')
    expect(await screen.files.search({ query: 'retry' })).toEqual([{ path: 'src/retry.ts', kind: 'file' }])
    expect(await screen.files.search({ query: 'retry', sessionId: 'ses_b' })).toEqual([])
    expect(await screenFor(undefined).screen.files.search({ query: 'retry' })).toEqual([])
  })
})
