import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolResult } from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as ToolFs from './native/index.ts'

const root = mkdtempSync(join(tmpdir(), 'dshfiles-tool-fs-'))
let ctx: Context

beforeAll(async () => {
  writeFileSync(join(root, 'five.txt'), 'a\nb\nc\nd\ne\n')
  writeFileSync(join(root, 'README.md'), '# readme\n')
  writeFileSync(join(root, 'conf.yaml'), 'key: value\n')
  writeFileSync(join(root, 'wide.txt'), 'abcd😀xyz\n')
  mkdirSync(join(root, 'src', 'deep'), { recursive: true })
  writeFileSync(join(root, 'src', 'index.ts'), 'export {}\n')
  writeFileSync(join(root, 'src', 'deep', 'nested-note.txt'), 'note\n')
  ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(WorkingDirectory, { defaultDirectory: root })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs, { readMaxLineLength: 5 })
})

afterAll(async () => {
  await ctx.fiber.dispose()
  rmSync(root, { recursive: true, force: true })
})

let calls = 0
const read = async (args: Record<string, string | number>): Promise<{ readonly text: string; readonly result: ToolResult }> => {
  calls += 1
  const result = await ctx.tools.execute({ callId: ToolCallId(`read-${calls}`), name: 'read', arguments: args, signal: new AbortController().signal })
  const block = result.content[0]
  return { text: block?.type === 'text' ? block.text : '', result }
}

describe('read', () => {
  it('reads from the end with a negative offset', async () => {
    const { text, result } = await read({ file_path: 'five.txt', offset: -2 })

    expect(result.isError).toBeFalsy()
    expect(text).toContain('4: d\n5: e')
    expect(text).not.toContain('3: c')
    expect(text).toContain('(End of file - total 5 lines)')
  })

  it('returns the last lines and the line count for an offset past the end', async () => {
    const { text, result } = await read({ file_path: 'five.txt', offset: 9 })

    expect(result.isError).toBeFalsy()
    expect(text).toContain('Offset 9 is past the end of the file (5 lines); showing the last 5 lines.')
    expect(text).toContain('1: a')
    expect(text).toContain('5: e')
  })

  it('suggests close names when the file is missing', async () => {
    expect((await read({ file_path: 'README.markdown' })).text).toMatch(/Did you mean: [^\n]*README\.md/u)
    expect((await read({ file_path: 'conf.yml' })).text).toMatch(/Did you mean: [^\n]*conf\.yaml/u)
    expect((await read({ file_path: 'src/indx.ts' })).text).toMatch(/Did you mean: [^\n]*src\/index\.ts/u)
    expect((await read({ file_path: 'nested-note.txt' })).text).toMatch(/Did you mean: [^\n]*src\/deep\/nested-note\.txt/u)
    expect((await read({ file_path: 'nothing-like-it.bin' })).text).not.toContain('Did you mean')
  })

  it('never cuts a multi-byte character when it shortens a long line', async () => {
    const { text } = await read({ file_path: 'wide.txt' })

    expect(text).toContain('1: abcd... (line truncated to 5 chars)')
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
  })
})
