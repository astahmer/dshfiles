import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { readCopilotUsage } from './copilot-quota.js'
import { providerFetch } from './provider-request.js'

const credential = { type: 'oauth' as const, refresh: 'gho_github', access: 'copilot-api-token', expires: Date.now() + 60_000 }

describe('provider request spans', () => {
  it('records an ai-accounts provider request span with host and status, never the path or credentials', async () => {
    using recorder = recordSpans()
    const card = await readCopilotUsage({ credential, fetch: async () => new Response('{}', { status: 401 }) })
    expect(card.status).toBe('unauthenticated')
    const span = recorder.span('ai-accounts provider request')
    expect(span.kind).toBe('client')
    expect(span.attributes).toEqual({
      'dshx.ai-accounts.provider': 'copilot',
      'dshx.ai-accounts.operation': 'usage',
      'server.address': 'api.github.com',
      'http.response.status_code': 401,
    })
    expect(JSON.stringify(span.attributes)).not.toContain('gho_github')
  })

  it('marks a failed provider request as an error and rethrows', async () => {
    using recorder = recordSpans()
    const failing = providerFetch({
      provider: 'opencode-go',
      operation: 'catalog',
      url: 'https://opencode.ai/zen/go/v1/models',
      init: {},
      fetch: async () => {
        throw new TypeError('network down')
      },
    })
    await expect(failing).rejects.toThrow('network down')
    expect(recorder.span('ai-accounts provider request').status.code).toBe('error')
  })
})
