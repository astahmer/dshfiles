import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundleCategoryOf } from './bundle-categories.js'

const pluginsDirectory = join(import.meta.dirname, '../..')

const dshfilesBundles = (): readonly string[] =>
  readdirSync(pluginsDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(pluginsDirectory, entry.name, 'cordis.patch.yml')))
    .map(entry => `@dshfiles/${entry.name}`)

describe('bundle categories', () => {
  it('places every bundle under plugins/@dshfiles in a functional area', () => {
    const bundles = dshfilesBundles()
    expect(bundles.length).toBeGreaterThan(50)
    const uncategorized = bundles.filter(name => bundleCategoryOf({ name, origin: 'dshfiles' }) === 'other')
    expect(uncategorized, 'add these bundles to DSHFILES_CATEGORY in src/bundle-categories.ts').toEqual([])
  })

  it('files stock DSH bundles under Core and unknown community bundles under Other', () => {
    expect(bundleCategoryOf({ name: '@deepseek-ai/dsh-agent-loop', origin: 'dsh' })).toBe('core')
    expect(bundleCategoryOf({ name: 'dshmarket', origin: 'community' })).toBe('other')
  })
})
