import type { ApiClient } from '@dshfiles/dshx/api'
import { secretCatalogApi } from './api.js'
import { SecretInputBinding } from './secret-input-bind.js'

export const JEV_SECRET_ALIAS = 'jev-api-key-optmem'
export const JEV_SECRET_ENVIRONMENT = 'prod'

type SecretCatalogWriter = Pick<ApiClient<typeof secretCatalogApi.methods>, 'create' | 'update'>

export const saveGlobalJevSecret = async (input: {
  readonly api: SecretCatalogWriter
  readonly existing: boolean
  readonly value: string
}): Promise<string> => {
  if (input.existing) {
    await input.api.update({ alias: JEV_SECRET_ALIAS, cwd: null, scope: 'global', environment: JEV_SECRET_ENVIRONMENT, value: input.value })
  } else {
    await input.api.create({
      alias: JEV_SECRET_ALIAS,
      cwd: null,
      scope: 'global',
      environment: JEV_SECRET_ENVIRONMENT,
      valueMode: 'manual',
      value: input.value,
    })
  }
  return SecretInputBinding.referenceText({ alias: JEV_SECRET_ALIAS, environment: JEV_SECRET_ENVIRONMENT })
}
