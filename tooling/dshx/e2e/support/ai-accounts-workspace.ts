import { randomUUID } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

/** Account journeys own a fresh project, never a live workspace or a shared fixture directory. */
export const seedAiAccountsWorkspace = async (homeRoot: string): Promise<void> => {
  const home = await realpath(homeRoot)
  const underTemp = relative(await realpath(tmpdir()), home)
  if (underTemp === '' || underTemp.startsWith('..') || isAbsolute(underTemp)) throw new Error('Account workspace fixture requires a private temporary home.')
  const project = join(home, 'ai-accounts-project')
  await mkdir(project, { recursive: true })
  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  // Released workspace-v2 contract, as used by scratch/up.ts; keep this adapter account-specific.
  const storage = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, defaultWorkspaceId: workspaceId, workspaceIds: [workspaceId], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { [workspaceId]: { path: await realpath(project), title: 'ai-accounts-project', sessionIds: [], createdAt: now, updatedAt: now } } },
  }
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(join(home, 'storages', 'workspace.json'), `${JSON.stringify(storage, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
}
