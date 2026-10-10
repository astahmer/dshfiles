import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listPluginBundles, pluginsToBoot, readBootIgnores, validateBootIgnores } from './plugin-inventory.mjs'

const withPlugins = async callback => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-inventory-'))
  try {
    await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const writePlugin = async (root, directory, manifest) => {
  const pluginRoot = join(root, directory)
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, 'package.json'), JSON.stringify(manifest))
}

test('discovers every DSH bundle and excludes libraries without a DSH manifest', async () => {
  await withPlugins(async root => {
    await writePlugin(root, 'zeta', { name: '@dshfiles/zeta', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writePlugin(root, 'alpha', { name: '@dshfiles/alpha', dsh: { bundle: { patch: './cordis.patch.yml' }, client: {} } })
    await writePlugin(root, 'library', { name: '@dshfiles/library' })

    assert.deepEqual(await listPluginBundles(root), [
      { id: '@dshfiles/alpha', dir: join(root, 'alpha'), hasClient: true },
      { id: '@dshfiles/zeta', dir: join(root, 'zeta'), hasClient: false },
    ])
  })
})

test('fails closed on malformed plugin metadata instead of silently skipping a bundle', async () => {
  await withPlugins(async root => {
    await writePlugin(root, 'bad-name', { name: 'other/name', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await assert.rejects(listPluginBundles(root), /must have a scoped @dshfiles package name/)
  })
})

test('fails closed when declared Client metadata is malformed', async () => {
  await withPlugins(async root => {
    await writePlugin(root, 'malformed-client', {
      name: '@dshfiles/malformed-client',
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: true },
    })
    await assert.rejects(listPluginBundles(root), /dsh.client metadata must be an object/)
  })
})

test('validates ignore ownership, expiry and package identity', () => {
  const plugins = [{ id: '@dshfiles/broken' }, { id: '@dshfiles/healthy' }]
  const ignores = [
    {
      packageId: '@dshfiles/broken',
      reason: 'Known isolated boot failure.',
      owner: 'plugin-maintainers',
      removalCondition: 'Remove after the client service declaration is fixed.',
      expiresOn: '2030-01-01',
    },
  ]
  const ignored = validateBootIgnores(ignores, plugins, new Date('2029-01-01T00:00:00.000Z'))
  assert.deepEqual(pluginsToBoot(plugins, ignored), [{ id: '@dshfiles/healthy' }])
  assert.throws(() => validateBootIgnores([{ ...ignores[0], packageId: '@dshfiles/missing' }], plugins), /unknown plugin/)
  assert.throws(() => validateBootIgnores([ignores[0], ignores[0]], plugins), /duplicates/)
  assert.throws(() => validateBootIgnores([{ ...ignores[0], expiresOn: '2020-01-01' }], plugins, new Date('2021-01-01T00:00:00.000Z')), /expired/)
  assert.throws(() => validateBootIgnores([{ ...ignores[0], removalCondition: '' }], plugins), /removalCondition/)
})

test('reads absent ignore file as empty and rejects invalid ignore JSON', async () => {
  await withPlugins(async root => {
    assert.deepEqual(await readBootIgnores(join(root, 'missing.json')), [])
    const invalid = join(root, 'invalid.json')
    await writeFile(invalid, '{')
    await assert.rejects(readBootIgnores(invalid), /not a valid boot ignore list/)
  })
})
