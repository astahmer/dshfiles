import { jjThreadsApiIdentity } from '@dshfiles/multi-host/api'
import { expect, test } from 'vitest'
import { jjIntegrationApi } from './api.js'

test('multi-host reaches the jj threads API under the identity it is declared with', () => {
  expect({ packageId: jjIntegrationApi.owner, apiId: jjIntegrationApi.id, version: jjIntegrationApi.version }).toEqual(jjThreadsApiIdentity)
})
