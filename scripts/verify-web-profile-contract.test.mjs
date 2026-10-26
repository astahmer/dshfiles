import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionSearchOwnershipErrors, webProfileContractErrors } from './verify-web-profile-contract.mjs'

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

test('reports an owned plugin dependency missing from the web profile', () => {
  const dependent = { ...consumer, dependencies: { '@dshfiles/review-provider': 'workspace:*' } }
  const reviewProvider = { name: '@dshfiles/review-provider', dsh: { bundle: { patch: './cordis.patch.yml' } } }

  assert.deepEqual(webProfileContractErrors(profile, [provider, dependent, reviewProvider]), [
    '@dshfiles/review-provider: owned DSH bundle is neither included in profiles/web nor marked opt-in.',
    '@dshfiles/settings-shell: owned plugin dependency @dshfiles/review-provider is missing from profiles/web dependencies.',
    '@dshfiles/settings-shell: owned plugin dependency @dshfiles/review-provider is missing from dsh.profile.bundles.',
  ])
})

test('reports an owned plugin omitted from both web-profile lists', () => {
  const omittedBundle = { name: '@dshfiles/omitted-plugin', dsh: { bundle: { patch: './cordis.patch.yml' } } }

  assert.deepEqual(webProfileContractErrors(profile, [provider, consumer, omittedBundle]), [
    '@dshfiles/omitted-plugin: owned DSH bundle is neither included in profiles/web nor marked opt-in.',
  ])
})

test('accepts a declared opt-in bundle omitted from the web profile', () => {
  const optInBundle = { name: '@dshfiles/tool-search', dsh: { bundle: { patch: './cordis.patch.yml' } } }

  assert.deepEqual(webProfileContractErrors(profile, [provider, consumer, optInBundle]), [])
})

test('accepts optional draft-choice, network and goal bundles without activating them', () => {
  const optInBundles = ['@dshfiles/agent-preset', '@dshfiles/model-selection', '@dshfiles/loopback-access', '@dshfiles/goal-tool'].map(name => ({
    name,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))

  assert.deepEqual(webProfileContractErrors(profile, [provider, consumer, ...optInBundles]), [])
})

test('still rejects a one-sided profile dependency for an opt-in goal bundle', () => {
  const goalBundle = { name: '@dshfiles/goal-tool', dsh: { bundle: { patch: './cordis.patch.yml' } } }
  const dependencies = { ...profile.dependencies, '@dshfiles/goal-tool': 'link:../../plugins/@dshfiles/goal-tool' }

  assert.deepEqual(webProfileContractErrors({ ...profile, dependencies }, [provider, consumer, goalBundle]), [
    '@dshfiles/goal-tool: profile dependency is not registered in dsh.profile.bundles.',
  ])
})

const disableInsideRegion = `# BEGIN NIX-MANAGED DSH PLUGINS
- id: session-query-sqlite
  disabled: true
# END NIX-MANAGED DSH PLUGINS
`
const ownedSearch = { seedPatch: disableInsideRegion, bundlePatch: disableInsideRegion, bundles: ['@dshfiles/session-search'] }

test('accepts a seeded owned search backend that disables the stock row in both layers', () => {
  assert.deepEqual(sessionSearchOwnershipErrors(ownedSearch), [])
})

test('ignores the stock row when the owned search backend is not seeded', () => {
  assert.deepEqual(sessionSearchOwnershipErrors({ ...ownedSearch, bundles: [] }), [])
})

test('reports a stock row disabled only above the managed region', () => {
  const seedPatch = `- id: session-query-sqlite
  disabled: true
# BEGIN NIX-MANAGED DSH PLUGINS
- id: our-free-model
# END NIX-MANAGED DSH PLUGINS
`

  assert.deepEqual(sessionSearchOwnershipErrors({ ...ownedSearch, seedPatch }), [
    'profiles/web/cordis.patch.yml must disable session-query-sqlite inside the managed region: an existing profile only reconciles that region.',
  ])
})

test('reports an owned bundle that leaves the stock row enabled', () => {
  assert.deepEqual(sessionSearchOwnershipErrors({ ...ownedSearch, bundlePatch: '- insert:\n    - id: dshfiles-session-search\n' }), [
    '@dshfiles/session-search/cordis.patch.yml must disable session-query-sqlite so its own bundle wins the sessionQuery service.',
  ])
})
