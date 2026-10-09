import { describe, expect, it } from 'vitest'
import { createWorkspaceFileIndex, walkWorkspaceFiles, type WorkspaceFilesReply } from './workspace-files.js'

type Tree = { readonly [name: string]: Tree | 'file' }

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
    const replies: WorkspaceFilesReply[] = []
    const stop = index.request('ses_1', reply => replies.push(reply))
    expect(replies[0]).toMatchObject({ status: 'indexing', files: [] })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(replies.at(-1)).toEqual({ status: 'ready', sessionId: 'ses_1', files: ['README.md', 'src/index.ts', 'src/lib/deep.ts'], truncated: false })
    stop()

    const walksBefore = listed.length
    clock = 10_000
    const again: WorkspaceFilesReply[] = []
    index.request('ses_1', reply => again.push(reply))
    expect(again).toEqual([{ status: 'ready', sessionId: 'ses_1', files: ['README.md', 'src/index.ts', 'src/lib/deep.ts'], truncated: false }])
    expect(listed.length).toBe(walksBefore)

    clock = 60_000
    const stale: WorkspaceFilesReply[] = []
    index.request('ses_1', reply => stale.push(reply))
    expect(stale[0]).toMatchObject({ status: 'indexing', files: ['README.md', 'src/index.ts', 'src/lib/deep.ts'] })
    index.dispose()
  })
})
