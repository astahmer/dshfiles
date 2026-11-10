import { describe, expect, it } from 'vitest'
import { hunkDiffs, hunkTotals } from './file-hunk-diff.js'
import { displayPath, FileToolModels, type FileToolCall } from './file-tool-models.js'

const start = (input: { readonly toolName: string; readonly argsRaw: string; readonly cwd?: string }): FileToolCall => ({
  phase: 'start',
  toolName: input.toolName,
  cwd: input.cwd ?? '/repo',
  block: { argsRaw: input.argsRaw },
})

const result = (input: {
  readonly toolName: string
  readonly argsRaw: string
  readonly text: string
  readonly meta?: unknown
  readonly isError?: boolean
  readonly parentCallId?: string
}): FileToolCall => ({
  phase: 'result',
  toolName: input.toolName,
  cwd: '/repo',
  block: {
    isError: input.isError ?? false,
    content: [{ type: 'text', text: input.text }],
    call: { argsRaw: input.argsRaw },
    meta: input.meta,
    parentCallId: input.parentCallId,
  },
})

const readEnvelope = (lines: readonly (readonly [number, string])[], totalLines: number): string =>
  `<path>/repo/src/cart/pricing.ts</path>\n<type>file</type>\n<content>\n${lines
    .map(([number, text]) => `${number}: ${text}`)
    .join('\n')}\n\n(End of file - total ${totalLines} lines)\n</content>`

const read = (input: { readonly lines: readonly (readonly [number, string])[]; readonly offset: number; readonly totalLines: number }): FileToolCall =>
  result({
    toolName: 'read',
    argsRaw: JSON.stringify({ file_path: '/repo/src/cart/pricing.ts', offset: input.offset }),
    text: readEnvelope(input.lines, input.totalLines),
    meta: {
      path: '/repo/src/cart/pricing.ts',
      offset: input.offset,
      lines: input.lines.map(([number, text]) => ({ number, text })),
      totalLines: input.totalLines,
      lang: 'ts',
    },
  })

describe('readWindow', () => {
  it('numbers a window from the requested offset and relativizes the path to the session root', () => {
    expect(
      FileToolModels.readWindow(
        read({
          lines: [
            [27, 'const unit = 1'],
            [28, 'const price = 2'],
          ],
          offset: 27,
          totalLines: 120,
        }),
      ),
    ).toMatchObject({
      path: 'src/cart/pricing.ts',
      absolutePath: '/repo/src/cart/pricing.ts',
      startLine: 27,
      code: 'const unit = 1\nconst price = 2',
      lineCount: 2,
      totalLines: 120,
      lang: 'ts',
    })
  })

  it('declines a read without the model-facing envelope, and one whose lines are not contiguous', () => {
    expect(FileToolModels.readWindow(result({ toolName: 'read', argsRaw: '{}', text: 'plain text, not a read envelope' }))).toBeUndefined()
    expect(
      FileToolModels.readWindow(
        read({
          lines: [
            [5, 'a'],
            [7, 'b'],
          ],
          offset: 5,
          totalLines: 40,
        }),
      ),
    ).toBeUndefined()
  })

  it('declines the stages the native row keeps: running, failed, and a nested call', () => {
    expect(FileToolModels.readWindow(start({ toolName: 'read', argsRaw: '{"file_path":"/repo/src/a.ts"}' }))).toBeUndefined()
    expect(FileToolModels.readWindow(result({ toolName: 'read', argsRaw: '{}', text: readEnvelope([[1, 'a']], 1), isError: true }))).toBeUndefined()
    expect(FileToolModels.readWindow(result({ toolName: 'read', argsRaw: '{}', text: readEnvelope([[1, 'a']], 1), parentCallId: 'call-0' }))).toBeUndefined()
  })
})

describe('nativeHunks', () => {
  it('reads the applied hunks of an edit, and the whole content of a created file', () => {
    const edit = result({
      toolName: 'edit',
      argsRaw: JSON.stringify({ file_path: 'src/cart/pricing.ts' }),
      text: 'Edited src/cart/pricing.ts',
      meta: { path: '/repo/src/cart/pricing.ts', diffs: [{ path: '/repo/src/cart/pricing.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc' }] },
    })
    expect(FileToolModels.nativeHunks(edit)).toEqual([{ path: 'src/cart/pricing.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc' }])

    const created = result({
      toolName: 'write',
      argsRaw: JSON.stringify({ file_path: 'src/notes.md', content: '# Notes\n\nbody' }),
      text: 'Created src/notes.md',
      meta: { operation: 'create', path: '/repo/src/notes.md', diffs: [] },
    })
    expect(FileToolModels.nativeHunks(created)).toEqual([{ path: 'src/notes.md', oldText: null, newText: '# Notes\n\nbody' }])
  })

  it('declines a running edit and a failed one, which the native card renders', () => {
    expect(FileToolModels.nativeHunks(start({ toolName: 'edit', argsRaw: '{"file_path":"src/a.ts"}' }))).toBeUndefined()
    expect(FileToolModels.nativeHunks(result({ toolName: 'edit', argsRaw: '{"file_path":"src/a.ts"}', text: 'nope', isError: true }))).toBeUndefined()
  })
})

describe('patchCall', () => {
  const patchArgs = (edits: readonly { readonly old: string; readonly new: string }[]): string => JSON.stringify({ path: '/repo/src/a.ts', edits })

  it('keeps the edits that change something, on a running call and a settled one alike', () => {
    const argsRaw = patchArgs([
      { old: 'x', new: 'y' },
      { old: 'same', new: 'same' },
    ])
    expect(FileToolModels.patchCall(start({ toolName: 'apply_patch', argsRaw }))).toEqual({
      status: 'running',
      path: 'src/a.ts',
      hunks: [{ path: 'src/a.ts', oldText: 'x', newText: 'y' }],
    })
    expect(FileToolModels.patchCall(result({ toolName: 'apply_patch', argsRaw, text: 'Applied.' }))).toEqual({
      status: 'passed',
      path: 'src/a.ts',
      hunks: [{ path: 'src/a.ts', oldText: 'x', newText: 'y' }],
    })
  })

  it('keeps the failure text of a rejected patch', () => {
    const failed = result({ toolName: 'apply_patch', argsRaw: patchArgs([{ old: 'x', new: 'y' }]), text: 'old text not found', isError: true })
    expect(FileToolModels.patchCall(failed)).toEqual({ status: 'failed', path: 'src/a.ts', error: 'old text not found' })
  })
})

describe('hunkDiffs', () => {
  it('counts the changed lines only, and renders a created file as an all-addition diff', () => {
    const changed = hunkDiffs([{ path: 'src/a.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc' }])
    expect(changed.map(entry => [entry.added, entry.removed])).toEqual([[1, 1]])
    expect(changed[0]?.diff.hunks).toHaveLength(1)

    const created = hunkDiffs([{ path: 'src/new.ts', oldText: null, newText: 'one\ntwo' }])
    expect([created[0]?.added, created[0]?.removed]).toEqual([2, 0])
    expect(created[0]?.diff.type).toBe('new')

    expect(hunkTotals([...changed, ...created])).toEqual({ added: 3, removed: 1 })
  })
})

describe('displayPath', () => {
  it('strips the workspace root and leaves an outside path absolute', () => {
    expect(displayPath({ path: '/repo/src/a.ts', cwd: '/repo/' })).toBe('src/a.ts')
    expect(displayPath({ path: '/other/a.ts', cwd: '/repo' })).toBe('/other/a.ts')
    expect(displayPath({ path: '/repo/src/a.ts' })).toBe('/repo/src/a.ts')
  })
})
