import { SessionId } from '@deepseek-ai/dsh-session/types'
import { runClientTool } from '@dshfiles/dshx/client'
import { describe, expect, it } from 'vitest'
import { EditorClientTools } from './editor-client-tools.js'
import type { EditorState, OpenDocument } from './editor-store.js'
import type { OpenFileRequest } from './open-file.js'

const document = (fields: { readonly id: string; readonly sessionId: string; readonly path: string; readonly dirty?: boolean }): OpenDocument => ({
  id: fields.id,
  sessionId: SessionId(fields.sessionId),
  path: fields.path,
  absolutePath: `/repo/${fields.path}`,
  name: fields.path,
  status: 'ready',
  content: { kind: 'text' },
  text: '',
  sha256: null,
  version: null,
  dirty: fields.dirty ?? false,
  diskChanged: false,
  reveal: null,
})

const state: EditorState = {
  documents: [
    document({ id: 'a', sessionId: 's1', path: 'src/a.ts' }),
    document({ id: 'b', sessionId: 's1', path: 'src/b.ts', dirty: true }),
    document({ id: 'c', sessionId: 's2', path: 'other.ts' }),
  ],
  activeBySession: { s1: 'b' },
}

const fixture = (session: string | undefined) => {
  const opened: OpenFileRequest[] = []
  const tools = EditorClientTools.create({
    currentSession: () => session,
    state: () => state,
    open: request => {
      if (session === undefined) return false
      opened.push(request)
      return true
    },
  })
  const byName = (name: string) => {
    const tool = tools.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error(`missing ${name}`)
    return tool
  }
  return { opened, byName }
}

const signal = new AbortController().signal

describe('editor client tools', () => {
  it('lists the open files of the thread on screen, the active one first', async () => {
    await expect(runClientTool(fixture('s1').byName('editor_files'), {}, { signal })).resolves.toEqual({
      sessionId: 's1',
      active: 'src/b.ts',
      files: [
        { path: 'src/b.ts', absolutePath: '/repo/src/b.ts', active: true, dirty: true, diskChanged: false, status: 'ready' },
        { path: 'src/a.ts', absolutePath: '/repo/src/a.ts', active: false, dirty: false, diskChanged: false, status: 'ready' },
      ],
    })
    await expect(runClientTool(fixture(undefined).byName('editor_files'), {}, { signal })).resolves.toEqual({ sessionId: null, active: null, files: [] })
  })

  it('opens a file at a line through the editor open path, and says what to do without a thread', async () => {
    const { opened, byName } = fixture('s1')
    await expect(runClientTool(byName('editor_open_file'), { path: 'src/a.ts', line: 12 }, { signal })).resolves.toEqual({ opened: 'src/a.ts', line: 12, sessionId: 's1' })
    expect(opened).toEqual([{ path: 'src/a.ts', line: 12 }])
    await expect(runClientTool(fixture(undefined).byName('editor_open_file'), { path: 'x.ts' }, { signal })).rejects.toThrow(/open a thread/u)
    expect(byName('editor_open_file').description).toMatch(/only when the user asked/u)
  })
})
