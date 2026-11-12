import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { registerScratchWorkspace } from '../../packages/dshx/src/project/scratch-workspace.js'

/** A deterministic setup recipe, not a shared folder or workspace ID; every prepared home owns its own project. */
export const SCRATCH_WORKSPACE_SEED_KEY = 'scratch-workspace-v1'

/**
 * Seed one Workspace in a fresh scratch home before its Host starts, the way `dshx dev up` does.
 *
 * Without it the browser creates the default Workspace itself on first use: on macOS that shells out to `osascript`
 * for the user's Documents folder (bounded by the Host's 10 s lookup deadline) and, because the scratch Host keeps a
 * real HOME for that lookup, it would create the folder inside the developer's own Documents. A journey that clicks
 * during that window cancels the bootstrap through `beginNavigation`, and the client never retries a cancelled
 * restoration (b:kk6n): the booted page then has no Workspace and no composer.
 */
export const seedScratchWorkspace = async (homeRoot: string): Promise<void> => {
  const project = join(homeRoot, 'workspace')
  await mkdir(project, { recursive: true })
  await registerScratchWorkspace(homeRoot, await realpath(project))
}
