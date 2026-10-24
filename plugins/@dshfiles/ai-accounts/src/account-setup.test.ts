import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { createAccountSetupController } from './account-setup-controller.js'
import { accountSetupMachine } from './account-setup-machine.js'
import { runSetupStep } from './account-setup-operation.js'

describe('shared account setup intent', () => {
  it('allocates a valid id on HTTP LAN browsers without crypto.randomUUID', () => {
    const webCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: webCrypto.getRandomValues.bind(webCrypto) })
    try {
      const controller = createAccountSetupController()
      controller.open()
      expect(controller.getSnapshot()?.operationId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('opens one replaceable intent, aborts its work, and ignores an old close', () => {
    const controller = createAccountSetupController()
    let notifications = 0
    const off = controller.subscribe(() => {
      notifications += 1
    })
    controller.open()
    const first = controller.getSnapshot()
    controller.open({ accountId: 'codex-work' })
    const second = controller.getSnapshot()
    expect(second?.accountId).toBe('codex-work')
    expect(second?.operationId).not.toBe(first?.operationId)
    expect(first?.signal.aborted).toBe(true)
    controller.close(first?.id)
    expect(controller.getSnapshot()).toBe(second)
    controller.close(second?.id)
    expect(controller.getSnapshot()).toBeNull()
    expect(second?.signal.aborted).toBe(true)
    expect(notifications).toBe(3)
    off()
    controller.open()
    expect(notifications).toBe(3)
  })
  it('does not enable or close a newer setup after a delayed old key write', async () => {
    const controller = createAccountSetupController()
    controller.open()
    const request = controller.getSnapshot()
    if (request === null) throw new Error('Missing setup')
    let resolveWrite: (() => void) | undefined
    let enabled = false
    const work = runSetupStep(
      controller,
      request,
      () =>
        new Promise<void>(resolve => {
          resolveWrite = resolve
        }),
    ).then(() => {
      enabled = true
      controller.close(request.id)
    })
    controller.close(request.id)
    controller.open({ accountId: 'newer' })
    resolveWrite?.()
    await expect(work).rejects.toThrow()
    expect(enabled).toBe(false)
    expect(controller.getSnapshot()?.accountId).toBe('newer')
  })
  it('does not publish a delayed finish result from a replaced intent', async () => {
    const controller = createAccountSetupController()
    controller.open()
    const request = controller.getSnapshot()
    if (request === null) throw new Error('Missing setup')
    let complete: ((value: string) => void) | undefined
    const work = runSetupStep(
      controller,
      request,
      () =>
        new Promise<string>(resolve => {
          complete = resolve
        }),
    )
    controller.open({ accountId: 'newer' })
    complete?.('old account enabled')
    await expect(work).rejects.toThrow()
    expect(controller.getSnapshot()?.accountId).toBe('newer')
  })
})

describe('account setup creation', () => {
  it('retries the same provider without allocating a new operation', async () => {
    const kinds: string[] = []
    const actor = createActor(accountSetupMachine, {
      input: {
        create: async kind => {
          kinds.push(kind)
          if (kinds.length === 1) throw new Error('Lost response')
          return 'stable-account-id'
        },
      },
    }).start()
    actor.send({ type: 'choose', kind: 'commandcode' })
    await waitFor(actor, state => state.matches('error'))
    actor.send({ type: 'retry' })
    await waitFor(actor, state => state.matches('connecting'))
    expect(kinds).toEqual(['commandcode', 'commandcode'])
    expect(actor.getSnapshot().context.accountId).toBe('stable-account-id')
    actor.stop()
  })
  it('reconnects an existing account without creating one', () => {
    let calls = 0
    const actor = createActor(accountSetupMachine, {
      input: {
        accountId: 'codex-work',
        create: async () => {
          calls += 1
          return 'wrong'
        },
      },
    }).start()
    expect(actor.getSnapshot().matches('connecting')).toBe(true)
    expect(actor.getSnapshot().context.accountId).toBe('codex-work')
    expect(calls).toBe(0)
    actor.stop()
  })
  it('cancels replaceable creation and ignores a late result after closing', async () => {
    let signal: AbortSignal | undefined
    let complete: ((id: string) => void) | undefined
    const actor = createActor(accountSetupMachine, {
      input: {
        create: (_kind, currentSignal) => {
          signal = currentSignal
          return new Promise<string>(resolve => {
            complete = resolve
          })
        },
      },
    }).start()
    actor.send({ type: 'choose', kind: 'codex' })
    actor.stop()
    expect(signal?.aborted).toBe(true)
    complete?.('late')
    await Promise.resolve()
    expect(actor.getSnapshot().context.accountId).toBeNull()
  })
})
