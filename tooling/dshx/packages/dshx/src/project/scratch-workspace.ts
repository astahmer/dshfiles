import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Seed a fresh scratch home's released workspace-v2 storage before its Host starts; never overwrite an existing store. */
export const registerScratchWorkspace = async (home: string, project: string): Promise<string> => {
  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  const storage = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, defaultWorkspaceId: workspaceId, workspaceIds: [workspaceId], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { [workspaceId]: { path: project, title: basename(project), sessionIds: [], createdAt: now, updatedAt: now } } },
  }
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(join(home, 'storages', 'workspace.json'), `${JSON.stringify(storage, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  return workspaceId
}
