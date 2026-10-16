import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reviewResultSchema } from '../src/api.js'
import type { JjRun } from '../src/jj.js'
import { diffArgs, reviewWorkspace, revisionArgs } from '../src/review.js'

const run = promisify(execFile)

const CONFIG = ['--config', 'user.name=Test', '--config', 'user.email=test@example.com']

/**
 * The argv `reviewWorkspace` builds, executed against the real CLI: a wrong flag
 * or range fails this test rather than the browser.
 */
const createRealRunner = (): JjRun => async input => {
  const { stdout } = await run('jj', [...CONFIG, ...input.args], { cwd: input.path, maxBuffer: 8 * 1024 * 1024 })
  return { stdout, truncated: false }
}

const jj = async (cwd: string, args: readonly string[]): Promise<void> => {
  await run('jj', [...CONFIG, ...args], { cwd })
}

let available = true
let workspace = ''

describe('jj diff output', () => {
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pulls-review-jj-'))
    try {
      await jj(workspace, ['git', 'init'])
    } catch {
      available = false
      return
    }
    await writeFile(join(workspace, 'README.md'), '# Title\n')
    await writeFile(join(workspace, 'src-app.ts'), 'export const answer = 1\n')
    await jj(workspace, ['commit', '-m', 'base'])
    await jj(workspace, ['bookmark', 'create', 'main', '-r', '@-'])
    await writeFile(join(workspace, 'src-app.ts'), 'export const answer = 2\n')
    await writeFile(join(workspace, 'src-app.test.ts'), "it('works', () => {})\n")
  })

  afterAll(async () => {
    if (workspace.length > 0) await rm(workspace, { recursive: true, force: true })
  })

  it.skipIf(!available)('reviews a real workspace through the argv the Host builds', async () => {
    const result = await reviewWorkspace({ run: createRealRunner(), path: workspace })
    expect(result).toMatchObject({ status: 'ok', base: 'main', range: 'main..@', fileCount: 2, additions: 2, deletions: 1, truncated: false })
    const parsed = reviewResultSchema.safeParse(result)
    expect(parsed.success ? undefined : parsed.error.issues).toBeUndefined()
    expect(result.status === 'ok' ? result.scopes.map(scope => scope.key).sort() : []).toEqual(['code', 'tests'])
    expect(result.status === 'ok' ? result.head : '').toMatch(/^[a-f0-9]{8,}$/)
  })

  it.skipIf(!available)('builds the revision and diff argv the review passes to jj', () => {
    expect(revisionArgs('@')).toEqual(['log', '-r', '@', '--no-graph', '-T', 'commit_id.short()'])
    expect(diffArgs('main')).toEqual(['diff', '--git', '--from', 'main', '--to', '@'])
  })
})
