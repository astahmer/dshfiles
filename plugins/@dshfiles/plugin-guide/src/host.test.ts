import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import { pluginGuideApi } from './api.js'
import { GUIDE_CATALOG } from './generated/guide-catalog.js'
import pluginGuideHost from './host.js'

describe('plugin-guide Host', () => {
  it('serves the static catalog and a read-only search tool', async () => {
    const host = await createTestHost()
    try {
      await host.mount(pluginGuideHost, { packageId: '@dshfiles/plugin-guide' })
      const client = createHostApiClient(host.ctx, pluginGuideApi, '@test/caller')
      const served = await client.catalog({})
      expect(served.catalog.entries).toHaveLength(GUIDE_CATALOG.entries.length)
      expect(served.freshness.catalogDshVersion).toBe(GUIDE_CATALOG.dshVersion)
      // This workspace resolves the same core the catalog was generated for.
      expect(served.freshness.runtimeDshVersion).toBe(GUIDE_CATALOG.dshVersion)

      const found = await client.search({ query: 'palette', kind: 'registry' })
      expect(found.entries.map(entry => entry.publicSymbol)).toEqual(['PaletteActions'])

      expect(host.tools.get('plugin_guide_search')?.name).toBe('plugin_guide_search')
      const result = await host.tools.execute({
        callId: ToolCallId('call-1'),
        name: 'plugin_guide_search',
        arguments: { query: 'sidebar', kind: 'slot' },
        signal: new AbortController().signal,
      })
      expect(JSON.stringify(result)).toContain('occupancy is never live')
    } finally {
      await host.dispose()
    }
  })
})
