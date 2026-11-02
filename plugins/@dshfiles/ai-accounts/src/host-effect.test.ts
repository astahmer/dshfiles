import { Context } from '@deepseek-ai/cordis'
import { HostContext } from '@dshfiles/dshx/effect'
import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { aiAccountsFastModeApi } from './model-fast-mode-api.js'
import { effectHandler } from './host-effect.js'
import { AccountStorePromiseService } from './account-store-promise.js'
import { openAccountStore } from './fixtures/account-store.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    const store = await openAccountStore(join(mkdtempSync(join(tmpdir(), 'ai-accounts-effect-')), 'accounts.json'))
    const running = Effect.runPromiseExit(
      handler({ provider: 'codex-primary', model: 'gpt-6-luna' }, { caller: { kind: 'client' }, peer: undefined }).pipe(
        Effect.provide(HostContext.layer({ ctx: new Context(), packageId: '@dshfiles/ai-accounts' })),
        Effect.provideService(AccountStorePromiseService, store),
      ),
      { signal: controller.signal },
    )

    await entered
    controller.abort()
    const exit = await running

    expect(Exit.isFailure(exit)).toBe(true)
    expect(handlerSignal?.aborted).toBe(true)
  })
})
