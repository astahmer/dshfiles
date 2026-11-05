import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import { capabilitiesHubApi } from './api.js'
import capabilitiesHubHost from './host.js'
import { CapabilitiesHub } from './hub-model.js'

describe('capabilities-hub Host', () => {
  it('serves the launchpad over its API and as a read-only agent tool', async () => {
    const host = await createTestHost()
    try {
      await host.mount(capabilitiesHubHost, { packageId: '@dshfiles/capabilities-hub' })
      const client = createHostApiClient(host.ctx, capabilitiesHubApi, '@test/caller')
      expect(await client.overview({})).toEqual(CapabilitiesHub.overview())

      expect(host.tools.get('capabilities_hub_overview')?.name).toBe('capabilities_hub_overview')
      const result = await host.tools.execute({
        callId: ToolCallId('call-1'),
        name: 'capabilities_hub_overview',
        arguments: {},
        signal: new AbortController().signal,
      })
      expect(JSON.stringify(result)).toContain('DISABLE_TELEMETRY=1 npx skills@')
    } finally {
      await host.dispose()
    }
  })
})
