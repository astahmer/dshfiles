import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupPatch } from '../src/scopes.js'

const run = promisify(execFile)

/** The argv the Host builds, against the real CLI: a wrong flag or range fails here, not in the browser. */
const jjArgs = (args: readonly string[]): readonly string[] => ['--config', 'user.name=Test', '--config', 'user.email=test@example.com', ...args]

let available = true
let workspace = ''

const jj = async (args: readonly string[]): Promise<string> => {
  const { stdout } = await run('jj', jjArgs(args), { cwd: workspace })
  return stdout
}

describe('jj diff output', () => {
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pulls-review-jj-'))
    try {
      await jj(['git', 'init'])
    } catch {
      available = false
      return
    }
    await writeFile(join(workspace, 'README.md'), '# Title\n')
    await writeFile(join(workspace, 'src-app.ts'), 'export const answer = 1\n')
    await jj(['commit', '-m', 'base'])
    await jj(['bookmark', 'create', 'main', '-r', '@-'])
    await writeFile(join(workspace, 'src-app.ts'), 'export const answer = 2\n')
    await writeFile(join(workspace, 'src-app.test.ts'), "it('works', () => {})\n")
  })

  afterAll(async () => {
    if (workspace.length > 0) await rm(workspace, { recursive: true, force: true })
  })

  it.skipIf(!available)('groups a real `jj diff --git --from main --to @` into scopes', async () => {
    const patch = await jj(['diff', '--git', '--from', 'main', '--to', '@'])
    const grouped = await groupPatch({ patch, title: 'main..@' })
    expect(grouped.fileCount).toBe(2)
    expect(grouped.scopes.map(scope => scope.key).sort()).toEqual(['code', 'tests'])
    expect(
      grouped.scopes
        .map(scope => scope.filePaths)
        .flat()
        .sort(),
    ).toEqual(['src-app.test.ts', 'src-app.ts'])
  })

  it.skipIf(!available)('reads the working-copy revision id the Host reports', async () => {
    const output = await jj(['log', '-r', '@', '--no-graph', '-T', 'commit_id.short()'])
    expect(output.trim()).toMatch(/^[a-f0-9]{8,}$/)
  })
})
