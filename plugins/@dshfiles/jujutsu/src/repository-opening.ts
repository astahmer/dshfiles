import { isApiError, isApiOwnerMissing, type ApiClient } from '@dshfiles/dshx/api'
import type { jujutsuApi } from './api.js'

type RepositoryClient = Pick<ApiClient<typeof jujutsuApi.methods>, 'openRepository' | 'registerRepository'>

/** Opening the graph is a write; old Hosts still support existing JJ repositories. */
export const openGraphRepository = async (api: RepositoryClient, path: string) => {
  try {
    return await api.openRepository({ path })
  } catch (error) {
    if (isApiOwnerMissing(error instanceof Error ? error : undefined) || (isApiError(error) && error.remoteCode === 'bad-request')) {
      return api.registerRepository({ path })
    }
    throw error
  }
}
