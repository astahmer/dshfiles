import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { registerScratchWorkspace } from '../../packages/dshx/src/project/scratch-workspace.js'

/** A deterministic setup recipe, not a shared folder or workspace ID; every prepared home owns its own project. */
export const AI_ACCOUNTS_WORKSPACE_SEED_KEY = 'ai-accounts-workspace-v1'

export const seedAiAccountsWorkspace = async (homeRoot: string): Promise<void> => {
  const project = join(homeRoot, 'ai-accounts-project')
  await mkdir(project, { recursive: true })
  await registerScratchWorkspace(homeRoot, await realpath(project))
}
