import assert from 'node:assert/strict'
import test from 'node:test'
import { findWorkspaceCycles } from './workspace-cycles.mjs'

const packages = manifests => new Map(manifests.map(manifest => [manifest.name, manifest]))

test('a cycle closed through a peer dependency is reported', () => {
  const cycles = findWorkspaceCycles(
    packages([
      { name: '@dshfiles/usage', dependencies: { '@dshfiles/ai-accounts': 'workspace:*' } },
      { name: '@dshfiles/ai-accounts', peerDependencies: { '@dshfiles/usage': 'workspace:*' } },
    ]),
  )
  assert.deepEqual(cycles, [['@dshfiles/ai-accounts', '@dshfiles/usage']])
})

test('a one-way chain and external dependencies are not cycles', () => {
  const cycles = findWorkspaceCycles(
    packages([
      { name: '@dshfiles/usage', dependencies: { '@dshfiles/ai-accounts': 'workspace:*', zod: 'catalog:' } },
      { name: '@dshfiles/ai-accounts', devDependencies: { '@dshfiles/dshx': 'workspace:*' } },
      { name: '@dshfiles/dshx' },
    ]),
  )
  assert.deepEqual(cycles, [])
})
