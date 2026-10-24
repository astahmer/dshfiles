import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { registerScratchWorkspace } from '../src/project/scratch-workspace.js'
import { AI_ACCOUNTS_WORKSPACE_SEED_KEY, seedAiAccountsWorkspace } from '../../../e2e/support/ai-accounts-workspace.js'

const roots: string[] = []
const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-workspace-seed-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('fresh scratch workspace registration', () => {
  it('writes the released workspace-v2 shape with one selected project and restrictive file permissions', async () => {
    const root = await temporaryRoot()
    const home = join(root, 'home')
    const project = join(root, 'project')
    await mkdir(project)
    const id = await registerScratchWorkspace(home, project)
    const file = join(home, 'storages', 'workspace.json')
    const storage: unknown = JSON.parse(await readFile(file, 'utf8'))
    expect(storage).toEqual({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, defaultWorkspaceId: id, workspaceIds: [id], archivedSessionIds: [], pinnedSessionIds: [] },
      tables: {
        workspaces: { [id]: { path: project, title: basename(project), sessionIds: [], createdAt: expect.any(String), updatedAt: expect.any(String) } },
      },
    })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('never overwrites an existing workspace store', async () => {
    const root = await temporaryRoot()
    await registerScratchWorkspace(root, '/synthetic/first-project')
    const file = join(root, 'storages', 'workspace.json')
    const original = await readFile(file, 'utf8')
    await expect(registerScratchWorkspace(root, '/synthetic/second-project')).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(file, 'utf8')).toBe(original)
  })
})

describe('AI Accounts workspace recipe', () => {
  it('seeds each prepared home independently, canonicalizing its own folder without using a native picker', async () => {
    const root = await temporaryRoot()
    const first = join(root, 'first-home')
    const second = join(root, 'second-home')
    await mkdir(first)
    const alias = join(root, 'first-home-alias')
    await symlink(first, alias, 'dir')
    await seedAiAccountsWorkspace(alias)
    await seedAiAccountsWorkspace(second)
    for (const [home, other] of [
      [first, second],
      [second, first],
    ] as const) {
      const project = await realpath(join(home, 'ai-accounts-project'))
      expect((await stat(project)).isDirectory()).toBe(true)
      const source = await readFile(join(home, 'storages', 'workspace.json'), 'utf8')
      expect(source).toContain(`"path": ${JSON.stringify(project)}`)
      expect(source).not.toContain(other)
      const storage: unknown = JSON.parse(source)
      expect(storage).toMatchObject({ unit: { name: 'workspace', version: 2 }, global: { initialized: true, workspaceIds: [expect.any(String)] } })
    }
    expect(AI_ACCOUNTS_WORKSPACE_SEED_KEY).toBe('ai-accounts-workspace-v1')
  })
})
