import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createApiClient, resourceStore } from '@dshfiles/dshx/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { multiHostApi } from './api.js'
import { readSessionRuntime } from './session-runtime-read.js'

const connection = () => {
  const call = vi.fn(async (_channel: string, _endpoint: string, _request: { readonly input?: unknown }) => ({
    ok: true,
    value: { version: multiHostApi.version, output: { ok: true, runtimeId: null } },
  }))
  const service = { rpc: { call } }
  return { call, context: { get: (name: string) => (name === 'connection' ? service : undefined) } }
}

afterEach(() => {
  vi.useRealTimers()
  resourceStore().clear()
})

describe('readSessionRuntime', () => {
  it('answers a second bundle that asks after the first read settled without another request', async () => {
    const fixture = connection()
    const header = createApiClient(fixture.context, multiHostApi, '@dshfiles/multi-host')
    const picker = createApiClient(fixture.context, multiHostApi, '@dshfiles/model-effort-picker')

    expect(await readSessionRuntime({ client: header, sessionId: SessionId('session-a') })).toEqual({ ok: true, runtimeId: null })
    expect(await readSessionRuntime({ client: picker, sessionId: SessionId('session-a') })).toEqual({ ok: true, runtimeId: null })

    expect(fixture.call).toHaveBeenCalledTimes(1)
  })

  it('reads each thread on its own and asks again once the answer is old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fixture = connection()
    const client = createApiClient(fixture.context, multiHostApi, '@dshfiles/multi-host')

    await readSessionRuntime({ client, sessionId: SessionId('session-a') })
    await readSessionRuntime({ client, sessionId: SessionId('session-b') })
    expect(fixture.call).toHaveBeenCalledTimes(2)

    vi.setSystemTime(Date.now() + 31_000)
    await readSessionRuntime({ client, sessionId: SessionId('session-a') })
    expect(fixture.call).toHaveBeenCalledTimes(3)
  })
})
