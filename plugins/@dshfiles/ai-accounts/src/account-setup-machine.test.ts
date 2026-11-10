import { createApiClient } from '@dshfiles/dshx/api/client'
import type { ApiError } from '@dshfiles/dshx/api'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { aiAccountsApi } from './api.js'
import { accountSetupMachine } from './account-setup-machine.js'

const start = (create: () => Promise<string> = async () => 'pending-account') => {
  const actor = createActor(accountSetupMachine, { input: { create } })
  actor.start()
  return actor
}

const arrive = async (actor: ReturnType<typeof start>) => {
  actor.send({ type: 'choose', kind: 'claude' })
  await waitFor(actor, snapshot => snapshot.matches('connecting'))
  return actor
}

const unreadableResult = async (): Promise<ApiError> => {
  const client = createApiClient(undefined, aiAccountsApi)
  const result = await client.safe.getAccountConnection({ operationId: 'synthetic-operation' })
  if (result.ok) throw new Error('Expected the synthetic API boundary to reject')
  return result.error
}

describe('account setup machine', () => {
  it('keeps verification and configuration mutually exclusive', async () => {
    const actor = await arrive(start())

    actor.send({ type: 'verify.begin', failure: 'verify' })
    expect(actor.getSnapshot().matches('verifying')).toBe(true)

    actor.send({ type: 'configure.begin' })
    expect(actor.getSnapshot().matches('verifying')).toBe(true)

    actor.send({ type: 'verify.succeeded' })
    expect(actor.getSnapshot().matches('success')).toBe(true)
    actor.stop()
  })

  it('returns to the connection after a rejected configuration instead of reporting a failed verification', async () => {
    const actor = await arrive(start())

    actor.send({ type: 'configure.begin' })
    expect(actor.getSnapshot().matches('configuring')).toBe(true)

    actor.send({ type: 'verify.begin', failure: 'verify' })
    expect(actor.getSnapshot().matches('configuring')).toBe(true)

    actor.send({ type: 'configure.failed' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.matches('connecting')).toBe(true)
    expect(snapshot.context.failure).toBe('configure')
    actor.stop()
  })

  it('separates an unreadable verification result from a rejected one and keeps retrying possible', async () => {
    const actor = await arrive(start())
    const error = await unreadableResult()

    actor.send({ type: 'verify.begin', failure: 'verify' })
    actor.send({ type: 'verify.failed', error })
    expect(actor.getSnapshot().matches('unknownResult')).toBe(true)
    expect(actor.getSnapshot().can({ type: 'verify.begin', failure: 'verify' })).toBe(false)
    actor.stop()

    const rejected = await arrive(start())
    rejected.send({ type: 'verify.begin', failure: 'verify' })
    rejected.send({ type: 'verify.failed', error: new Error('Synthetic verification rejected') })
    expect(rejected.getSnapshot().matches('failed')).toBe(true)
    expect(rejected.getSnapshot().can({ type: 'verify.begin', failure: 'verify' })).toBe(true)

    rejected.send({ type: 'verify.begin', failure: 'verify' })
    expect(rejected.getSnapshot().matches('verifying')).toBe(true)
    rejected.stop()
  })

  it('keeps the sign-in-another choice through verification and clears it only on a successful configuration', async () => {
    const actor = await arrive(start())

    actor.send({ type: 'signInAnother' })
    expect(actor.getSnapshot().context.connectAnother).toBe(true)

    actor.send({ type: 'verify.begin', failure: 'verify' })
    actor.send({ type: 'verify.failed', error: new Error('Synthetic verification rejected') })
    expect(actor.getSnapshot().context.connectAnother).toBe(true)

    actor.send({ type: 'configure.begin' })
    actor.send({ type: 'configure.succeeded' })
    expect(actor.getSnapshot().matches('connecting')).toBe(true)
    expect(actor.getSnapshot().context.connectAnother).toBe(false)
    actor.stop()
  })

  it('keeps a failed preparation retryable', async () => {
    let attempts = 0
    const actor = start(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Synthetic preparation failure')
      return 'pending-account'
    })
    actor.send({ type: 'choose', kind: 'claude' })
    await waitFor(actor, snapshot => snapshot.matches('error'))
    actor.send({ type: 'retry' })
    await waitFor(actor, snapshot => snapshot.matches('connecting'))
    expect(attempts).toBe(2)
    actor.stop()
  })
})
