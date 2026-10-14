import assert from 'node:assert/strict'
import test from 'node:test'
import { webProfileContractErrors } from './verify-web-profile-contract.mjs'

const provider = {
  name: '@dshfiles/shared-runtime',
  dsh: { client: { external: [] } },
}
const consumer = {
  name: '@dshfiles/settings-shell',
  dsh: { client: { external: ['@dshfiles/shared-runtime'] } },
}
const profile = {
  dependencies: {
    '@dshfiles/shared-runtime': 'link:../../plugins/@dshfiles/shared-runtime',
    '@dshfiles/settings-shell': 'link:../../plugins/@dshfiles/settings-shell',
  },
  dsh: { profile: { bundles: ['@dshfiles/shared-runtime', '@dshfiles/settings-shell'] } },
}

test('accepts local external providers registered as profile dependencies and bundles', () => {
  assert.deepEqual(webProfileContractErrors(profile, [provider, consumer]), [])
})

test('reports a local external provider missing from profile dependencies', () => {
  const dependencies = { ...profile.dependencies }
  delete dependencies['@dshfiles/shared-runtime']

  assert.deepEqual(webProfileContractErrors({ ...profile, dependencies }, [provider, consumer]), [
    '@dshfiles/shared-runtime: profile bundle has no dependency entry.',
    '@dshfiles/settings-shell: external provider @dshfiles/shared-runtime is missing from profiles/web dependencies.',
  ])
})

test('reports a local external provider missing from profile bundles', () => {
  assert.deepEqual(webProfileContractErrors({ ...profile, dsh: { profile: { bundles: ['@dshfiles/settings-shell'] } } }, [provider, consumer]), [
    '@dshfiles/settings-shell: external provider @dshfiles/shared-runtime is missing from dsh.profile.bundles.',
    '@dshfiles/shared-runtime: profile dependency is not registered in dsh.profile.bundles.',
  ])
})

test('requires web profile bundles to link their local source packages', () => {
  assert.deepEqual(
    webProfileContractErrors({ ...profile, dependencies: { ...profile.dependencies, '@dshfiles/shared-runtime': '^0.1.0' } }, [provider, consumer]),
    ['@dshfiles/shared-runtime: local profile dependency must use a link: source.'],
  )
})
