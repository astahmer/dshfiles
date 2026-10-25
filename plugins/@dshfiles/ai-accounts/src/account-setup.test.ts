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

describe('Host cancellation ownership', () => {
  it('retains only the latest view registration and discards once when the intent closes', () => {
    const controller = createAccountSetupController()
    controller.open()
    const request = controller.getSnapshot()
    if (request === null) throw new Error('Missing setup')
    const oldView = vi.fn()
    const remountedView = vi.fn()
    controller.registerCancellation(request.id, oldView)
    controller.registerCancellation(request.id, remountedView)
    expect(remountedView).not.toHaveBeenCalled()
    controller.close(request.id)
    controller.close(request.id)
    expect(oldView).not.toHaveBeenCalled()
    expect(remountedView).toHaveBeenCalledTimes(1)
  })
  it('discards the old operation after replacement without closing the new intent', () => {
    const controller = createAccountSetupController()
    controller.open()
    const first = controller.getSnapshot()
    if (first === null) throw new Error('Missing setup')
    const discardFirst = vi.fn(() => {
      expect(first.signal.aborted).toBe(true)
      expect(controller.getSnapshot()?.id).not.toBe(first.id)
    })
    controller.registerCancellation(first.id, discardFirst)
    controller.open()
    const second = controller.getSnapshot()
    expect(discardFirst).toHaveBeenCalledTimes(1)
    const lateRegistration = vi.fn()
    controller.registerCancellation(first.id, lateRegistration)
    expect(lateRegistration).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot()).toBe(second)
  })
})

describe('provisional account connection preparation', () => {
  it('retries the same provider without allocating a new operation', async () => {
    const kinds: (string | null)[] = []
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
  it('prepares a guarded reconnect for the existing account instead of bypassing the Host lifecycle', async () => {
    const prepare = vi.fn(async (kind: string | null) => {
      expect(kind).toBeNull()
      return 'codex-work'
    })
    const actor = createActor(accountSetupMachine, {
      input: { accountId: 'codex-work', create: prepare },
    }).start()
    await waitFor(actor, state => state.matches('connecting'))
    expect(actor.getSnapshot().context.accountId).toBe('codex-work')
    expect(prepare).toHaveBeenCalledTimes(1)
    actor.stop()
  })
  it.each(['codex', 'github-copilot', 'claude', 'opencode-go', 'commandcode', 'cursor'] as const)(
    'cancels %s preparation and ignores a late result after closing',
    async kind => {
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
      actor.send({ type: 'choose', kind })
      actor.stop()
      expect(signal?.aborted).toBe(true)
      complete?.('late')
      await Promise.resolve()
      expect(actor.getSnapshot().context.accountId).toBeNull()
    },
  )
})
