import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { describe, expect, it } from 'vitest'
import { closeNames, suggestMissingPaths } from './missing-path.ts'

describe('closeNames', () => {
  it('ranks other case, then other extension, then small typos, and ignores unrelated names', () => {
    expect(
      closeNames({
        wanted: 'Readme.md',
        names: ['README.md', 'readme.txt', 'Readme.mdx', 'Reamde.md', 'package.json', 'Readme.md'],
      }),
    ).toEqual(['README.md', 'Readme.mdx', 'readme.txt', 'Reamde.md'])
  })

  it('allows one edit for short names and none below three characters', () => {
    expect(closeNames({ wanted: 'indx.ts', names: ['index.ts', 'inbox.tsx'] })).toEqual(['index.ts'])
    expect(closeNames({ wanted: 'ab', names: ['ac'] })).toEqual([])
  })
})

describe('suggestMissingPaths', () => {
  it('gives no hint instead of failing when the walk is cut short', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dshfiles-missing-path-'))
    writeFileSync(join(root, 'README.md'), '# readme\n')
    const ctx = new Context()
    try {
      await ctx.plugin(LocalFileSystem, { cwd: root })
      expect(await suggestMissingPaths({ ctx, requestedPath: 'Readme.md', resolveOptions: { cwd: root } })).toEqual(['README.md'])
      expect(await suggestMissingPaths({ ctx, requestedPath: 'Readme.md', resolveOptions: { cwd: root, signal: AbortSignal.abort() } })).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
