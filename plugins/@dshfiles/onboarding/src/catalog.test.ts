import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { featureCatalogSchema } from './catalog-model.js'
import { CURATED_BUNDLES } from './curation.js'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { PACKS } from './packs.js'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(pluginRoot, '..', '..', '..')
const pluginsDir = join(repoRoot, 'plugins', '@dshfiles')
const catalogFile = join(pluginRoot, 'src', 'generated', 'feature-catalog.ts')
const generate = (input: { readonly out: string; readonly check?: boolean }) =>
  spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/generate-catalog.ts', '--out', input.out, ...(input.check === true ? ['--check'] : [])], {
    cwd: pluginRoot,
    encoding: 'utf8',
  })

const pluginDirectories = readdirSync(pluginsDir).filter(name => existsSync(join(pluginsDir, name, 'package.json')))

describe('onboarding feature catalog', () => {
  it('is current with the feature catalogs it is generated from', () => {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/generate-catalog.ts', '--check'], {
      cwd: pluginRoot,
      encoding: 'utf8',
    })
    expect(output).toContain('Onboarding catalog is current')
  }, 30_000)

  it('fails the check on a hand-edited catalog and passes again after regenerating', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'onboarding-catalog-'))
    const out = join(scratch, 'feature-catalog.ts')
    try {
      writeFileSync(out, readFileSync(catalogFile, 'utf8').replace('"schemaVersion": 1', '"schemaVersion": 1, "edited": true'))
      const stale = generate({ out, check: true })
      expect(stale.status).toBe(1)
      expect(stale.stderr).toContain('is stale: run `pnpm --dir plugins/@dshfiles/onboarding generate`')
      expect(generate({ out }).status).toBe(0)
      expect(generate({ out, check: true }).status).toBe(0)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 60_000)

  it('decodes with its schema and lists every owned plugin', () => {
    expect(Schema.decodeUnknownSync(featureCatalogSchema)(FEATURE_CATALOG)).toEqual(FEATURE_CATALOG)
    expect(FEATURE_CATALOG.plugins.map(plugin => plugin.name).sort()).toEqual([...pluginDirectories].sort())
    expect(new Set(FEATURE_CATALOG.features.map(feature => feature.key)).size).toBe(FEATURE_CATALOG.features.length)
  })

  it('curates only plugins that exist', () => {
    const known = new Set(FEATURE_CATALOG.plugins.map(plugin => plugin.name))
    expect(CURATED_BUNDLES.filter(bundle => !known.has(bundle.plugin)).map(bundle => bundle.plugin)).toEqual([])
  })
})

/** The `defineSettings` source of a plugin, read as text: tests may not import another plugin's private modules. */
const settingsSources = (plugin: string): string => {
  const sourceDir = join(pluginsDir, plugin, 'src')
  if (!existsSync(sourceDir)) return ''
  return readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
    .filter(file => /\.tsx?$/u.test(file) && !file.includes('.test.'))
    .map(file => readFileSync(join(sourceDir, file), 'utf8'))
    .filter(text => text.includes('defineSettings('))
    .join('\n')
}

describe('packs', () => {
  it('name only plugin directories that exist, with one Core pack', () => {
    const missing = PACKS.flatMap(pack => pack.plugins.filter(name => !pluginDirectories.includes(name)).map(name => `${pack.id}: ${name}`))
    expect(missing).toEqual([])
    expect(PACKS.filter(pack => pack.core).map(pack => pack.id)).toEqual(['core'])
    expect(new Set(PACKS.map(pack => pack.id)).size).toBe(PACKS.length)
  })

  it('point every key setting at a namespace and field a plugin declares', () => {
    const allSettings = pluginDirectories.map(settingsSources).join('\n')
    for (const pack of PACKS)
      for (const setting of pack.keySettings) {
        expect(allSettings, `${pack.id}: ${setting.entryId}`).toContain(`namespace: '${setting.entryId}'`)
        const field = setting.fieldPath[0] ?? ''
        expect(allSettings, `${pack.id}: ${setting.entryId}.${field}`).toMatch(new RegExp(`\\b${field}: Schema\\.`, 'u'))
      }
  }, 30_000)

  it('detects a pack that names a plugin no directory provides', () => {
    const renamed = PACKS.map(pack => (pack.id === 'knowledge' ? { ...pack, plugins: [...pack.plugins, 'memory-v2'] } : pack))
    expect(renamed.flatMap(pack => pack.plugins.filter(name => !pluginDirectories.includes(name)))).toEqual(['memory-v2'])
  })
})
