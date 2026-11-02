import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { VcsProviderService } from '@dshfiles/vcs-provider-port/effect'

test('the public port loads built Promise and Effect entrypoints', () => {
  assert.ok(import.meta.resolve('@dshfiles/vcs-provider-port').endsWith('/dist/index.js'))
  assert.equal(VcsProviders.apiId, 'vcs-provider')
  assert.ok(import.meta.resolve('@dshfiles/vcs-provider-port/effect').endsWith('/dist/effect.js'))
  assert.equal(VcsProviderService.key, '@dshfiles/vcs-provider-port/VcsProvider')
})
