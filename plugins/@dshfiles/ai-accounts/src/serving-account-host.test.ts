import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { definePlugin } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { expect, it } from 'vitest'
import { servingAccountApi } from './serving-account-api.js'
import { servingAccountHostApi } from './serving-account-host.js'

it('validates raw browser calls and rejects a tool caller without a native Agent session', async () => {
  const host = await createTestHost()
  try {
    await host.mount(definePlugin({ id: 'serving-account-test', apis: [servingAccountHostApi] }), { packageId: '@dshfiles/ai-accounts' })
    // oxlint-disable-next-line antislop/no-unknown-parameters -- These raw requests intentionally test rejection of untrusted payloads.
    const request = (input: unknown) =>
      host.connection
        .requestApi({
          packageId: '@dshfiles/ai-accounts',
          apiId: servingAccountApi.id,
          method: 'snapshot',
          version: 1,
          input,
        })
        .then(response => response.json())
    expect(await request({ sessionId: 'chosen' })).toMatchObject({
      result: {
        ok: true,
        value: {
          output: {
            sessionId: 'chosen',
            currentAttempt: null,
            lastSuccessful: null,
          },
        },
      },
    })
    expect(await request({})).toMatchObject({ result: { ok: false } })
    // Caller identity is transport-owned, never a JSON input field.
    expect(await request({ sessionId: 'chosen', caller: { kind: 'client' } })).toMatchObject({ result: { ok: false } })
    const result = await host.tools.execute({
      callId: ToolCallId('serving-test'),
      name: 'ai_accounts_serving_account',
      arguments: { sessionId: 'chosen' },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    // The real dispatcher deliberately redacts thrown handler details at the transport boundary.
    expect(JSON.stringify(result.content)).toContain('API handler failed')
    expect(JSON.stringify(result.content)).not.toContain('lastSuccessful')
    expect(host.tools.schemas().find(tool => tool.name === 'ai_accounts_serving_account')?.parameters).toMatchObject({ additionalProperties: false })
  } finally {
    await host.dispose()
  }
})
