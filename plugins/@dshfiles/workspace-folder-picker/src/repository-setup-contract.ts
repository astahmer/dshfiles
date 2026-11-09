/**
 * What the add-workspace flow asks the Jujutsu bundle for. `@dshfiles/jujutsu` already depends on this package, so it
 * provides the contract and the picker renders the action only while it is there; without Jujutsu installed the panel
 * keeps the plain add, which works for every folder.
 */
import { defineContract } from '@dshfiles/dshx/client'

export interface RepositorySetupService {
  /** Enable Jujutsu alongside an existing Git checkout, colocated; refuses a plain folder or a broken `.jj`. */
  readonly enableJujutsu: (input: { readonly path: string }) => Promise<{ readonly root: string; readonly initialized: boolean }>
}

export const RepositorySetup = defineContract<RepositorySetupService>('@dshfiles/workspace-folder-picker.repository-setup', {
  owner: '@dshfiles/jujutsu',
})
