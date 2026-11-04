import { LlmAdapter, LlmRuntime, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import plugin from './host.js'
import { sessionWarmingSettings } from './settings.js'

class StopAdapter extends LlmAdapter {
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const packageId = '@dshfiles/session-warming'

describe('the session-warming Host', () => {
  it.effect('tracks agent-loop requests from the llm/stream waterfall and reports them through its status API', () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        testHost => Effect.promise(() => testHost.dispose()),
      )
      host.ctx.provide('settings', {
        configure: () => () => undefined,
        describe: () => [{ ns: sessionWarmingSettings.namespace, value: sessionWarmingSettings.schema({ enabled: true }), revision: 1 }],
        update: async () => undefined,
        replace: async () => undefined,
      })
      yield* Effect.promise(() => host.ctx.plugin(LlmRuntime))
      host.ctx.llm.registerAdapter(['anthropic'], new StopAdapter())
      yield* Effect.promise(() => host.mount(plugin, { packageId }))

      const agentRequest = markAgentLoopRequest(Object.freeze({ provider: 'anthropic', model: 'claude', messages: [], sessionId: SessionId('s1') }))
      yield* Effect.promise(async () => {
        for await (const _chunk of host.ctx.llm.stream(agentRequest));
      })
      yield* Effect.promise(async () => {
        for await (const _chunk of host.ctx.llm.stream({ provider: 'anthropic', model: 'claude', messages: [], purpose: 'compaction' }));
      })

      const status = yield* Effect.promise(() =>
        host.connection.requestApi({ packageId, apiId: 'session-warming', method: 'status', version: 1, input: {} }).then(response => response.json()),
      )
      expect(status).toMatchObject({
        result: {
          ok: true,
          value: { output: { enabled: true, warmupsLastHour: 0, sessions: [{ sessionId: 's1', provider: 'anthropic', model: 'claude', warmups: 0 }] } },
        },
      })
    }).pipe(Effect.scoped),
  )
})
