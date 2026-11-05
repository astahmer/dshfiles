import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { guideCatalogSchema, PluginGuide } from './catalog-model.js'
import { GUIDE_CATALOG } from './generated/guide-catalog.js'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(pluginRoot, '..', '..', '..')

describe('Plugin Guide catalog', () => {
  it('is current with the public declarations it is generated from', () => {
    // Fails with the regenerate command when a module, slot, surface or SDK export changed without a rebuild.
    const output = execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/generate-catalog.ts', '--check'], {
      cwd: pluginRoot,
      encoding: 'utf8',
    })
    expect(output).toContain('Plugin Guide catalog is current')
  })

  it('matches its schema and the DSH version this package builds against', () => {
    expect(Schema.decodeUnknownSync(guideCatalogSchema)(GUIDE_CATALOG)).toEqual(GUIDE_CATALOG)
    const installed = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
      JSON.parse(readFileSync(join(pluginRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')),
    )
    expect(GUIDE_CATALOG.dshVersion).toBe(installed.version)
  })

  it('links every entry to a source that exists and never claims live occupancy', () => {
    for (const entry of GUIDE_CATALOG.entries) {
      const [path] = entry.source.split(':')
      expect(() => readFileSync(join(repoRoot, path ?? ''), 'utf8'), entry.key).not.toThrow()
      if (entry.docs !== null) expect(() => readFileSync(join(repoRoot, entry.docs ?? ''), 'utf8'), entry.key).not.toThrow()
      expect(['static', 'unavailable']).toContain(entry.occupancy)
    }
  })

  it('covers native slots, owned registries, contracts, APIs and SDK entry points, with the shell slot marked high risk', () => {
    const kinds = new Set(GUIDE_CATALOG.entries.map(entry => entry.kind))
    expect([...kinds].sort()).toEqual(['api', 'contract', 'module', 'registry', 'sdk', 'slot', 'surface'])
    expect(GUIDE_CATALOG.entries.find(entry => entry.key === 'slot:sidebar')?.risk).toBe('shell-owned')
    expect(GUIDE_CATALOG.entries.find(entry => entry.key === 'slot:main')).toMatchObject({
      risk: 'id-reuse-replaces',
      occupancy: 'static',
      occupants: ['conversation'],
    })
    expect(GUIDE_CATALOG.entries.find(entry => entry.key === 'registry:@dshfiles/thread-sidebar.destination-section')).toMatchObject({
      importFrom: '@dshfiles/thread-sidebar/destinations',
      risk: 'additive',
    })
  })
})

describe('PluginGuide', () => {
  it('reports a stale catalog when the running DSH or the slot facts disagree', () => {
    const current = { ...GUIDE_CATALOG, slotFactsCheckedAgainst: GUIDE_CATALOG.dshVersion }
    expect(PluginGuide.freshness(current, GUIDE_CATALOG.dshVersion)).toMatchObject({ stale: false, reasons: [] })
    expect(PluginGuide.freshness(current, null).stale).toBe(false)
    const drifted = PluginGuide.freshness({ ...current, slotFactsCheckedAgainst: '0.1.0' }, '9.9.9')
    expect(drifted.stale).toBe(true)
    expect(drifted.reasons.join('\n')).toContain('this Host runs 9.9.9. Rebuild @dshfiles/plugin-guide.')
    expect(drifted.reasons.join('\n')).toContain('dshx inspect slots --root <slot>')
  })

  it('searches by every word and kind, and bounds the result', () => {
    const result = PluginGuide.search(GUIDE_CATALOG, { query: 'destination sections', kind: 'registry' })
    expect(result.entries.map(entry => entry.publicSymbol)).toEqual(['DestinationSections'])
    expect(PluginGuide.search(GUIDE_CATALOG, { limit: 3 }).entries).toHaveLength(3)
    expect(PluginGuide.search(GUIDE_CATALOG, { limit: 3 }).total).toBe(GUIDE_CATALOG.entries.length)
  })

  it('drafts bounded guidance that states the catalog is static', () => {
    const entry = GUIDE_CATALOG.entries.find(candidate => candidate.key === 'slot:sidebar')
    if (entry === undefined) throw new Error('sidebar slot missing')
    const text = PluginGuide.draft(entry, GUIDE_CATALOG)
    expect(text.length).toBeLessThanOrEqual(4_000)
    expect(text).toContain('Shell-owned · high risk')
    expect(text).toContain('not live')
  })
})
