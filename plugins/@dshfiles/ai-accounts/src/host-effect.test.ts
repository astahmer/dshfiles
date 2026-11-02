import { Context } from '@deepseek-ai/cordis'
import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { aiAccountsFastModeApi } from './model-fast-mode-api.js'
import { effectHandler } from './host-effect.js'

describe('AI Accounts Effect API bridge', () => {
  it('forwards request interruption to the original Promise handler', async () => {
    const controller = new AbortController()
    let handlerSignal: AbortSignal | undefined
    let markEntered: (() => void) | undefined
    const entered = new Promise<void>(resolve => {
      markEntered = resolve
    })
    const handler = effectHandler(aiAccountsFastModeApi, 'status', ({ signal }) => {
      handlerSignal = signal
      markEntered?.()
      return new Promise<{ available: boolean; enabled: boolean }>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true })
      })
    })
    const running = Effect.runPromiseExit(
      handler({
        ctx: new Context(),
        caller: { kind: 'client' },
        peer: undefined,
        input: { provider: 'codex-primary', model: 'gpt-6-luna' },
        signal: controller.signal,
      }),
      { signal: controller.signal },
    )

    await entered
    controller.abort()
    const exit = await running

    expect(Exit.isFailure(exit)).toBe(true)
    expect(handlerSignal?.aborted).toBe(true)
  })
})
