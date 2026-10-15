import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { apiKeySetupMachineWithWriter } from './api-key-setup-machine.js'

const start = () => {
  const actor = createActor(apiKeySetupMachineWithWriter)
  actor.start()
  return actor
}

const deferred = <Value>() => {
  let resolve = (_value: Value): void => {}
  const promise = new Promise<Value>(onResolve => {
    resolve = onResolve
  })
  return { promise, resolve }
}

describe('API-key setup machine', () => {
  it('waits for explicit confirmation before importing a replacement', async () => {
    let writes = 0
    const actor = start()

    actor.send({
      type: 'catalog.submit',
      requiresConfirmation: true,
      write: async () => {
        writes += 1
        return true
      },
    })

    expect(actor.getSnapshot().matches('confirming')).toBe(true)
    expect(writes).toBe(0)
    actor.send({ type: 'catalog.confirm' })
    await waitFor(actor, snapshot => snapshot.matches('success'))

    expect(writes).toBe(1)
    actor.stop()
  })

  it('starts imports that do not require replacement confirmation', async () => {
    let writes = 0
    const actor = start()

    actor.send({
      type: 'catalog.submit',
      requiresConfirmation: false,
      write: async () => {
        writes += 1
        return true
      },
    })
    await waitFor(actor, snapshot => snapshot.matches('success'))

    expect(writes).toBe(1)
    actor.stop()
  })

  it('recovers from a refused write and retries the manual save', async () => {
    let writes = 0
    const actor = start()
    const write = async (): Promise<boolean> => {
      writes += 1
      return writes > 1
    }

    actor.send({ type: 'manual.submit', write })
    await waitFor(actor, snapshot => snapshot.matches('error'))
    expect(actor.getSnapshot().context.operation).toBe('manual')

    actor.send({ type: 'manual.submit', write })
    await waitFor(actor, snapshot => snapshot.matches('success'))

    expect(writes).toBe(2)
    actor.stop()
  })

  it('recovers from a rejected catalog import on retry', async () => {
    let writes = 0
    const actor = start()
    const write = async (): Promise<boolean> => {
      writes += 1
      if (writes === 1) throw new Error('credential service unavailable')
      return true
    }

    actor.send({ type: 'catalog.submit', requiresConfirmation: false, write })
    await waitFor(actor, snapshot => snapshot.matches('error'))
    actor.send({ type: 'catalog.submit', requiresConfirmation: false, write })
    await waitFor(actor, snapshot => snapshot.matches('success'))

    expect(writes).toBe(2)
    actor.stop()
  })

  it('clears a pending confirmation when the dialog resets', () => {
    let writes = 0
    const actor = start()
    actor.send({
      type: 'catalog.submit',
      requiresConfirmation: true,
      write: async () => {
        writes += 1
        return true
      },
    })

    actor.send({ type: 'reset' })
    actor.send({ type: 'catalog.confirm' })

    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.operation).toBe(null)
    expect(writes).toBe(0)
    actor.stop()
  })

  it('does not launch a competing write while one is pending', () => {
    const request = deferred<boolean>()
    let writes = 0
    const actor = start()
    actor.send({
      type: 'manual.submit',
      write: () => {
        writes += 1
        return request.promise
      },
    })
    actor.send({
      type: 'catalog.submit',
      requiresConfirmation: false,
      write: async () => {
        writes += 1
        return true
      },
    })

    expect(actor.getSnapshot().matches('saving')).toBe(true)
    expect(writes).toBe(1)
    actor.send({ type: 'reset' })
    actor.stop()
  })

  it('aborts its signal and ignores a stale completion after a newer save', async () => {
    const request = deferred<boolean>()
    let aborted = false
    const actor = start()
    actor.send({
      type: 'manual.submit',
      write: signal => {
        signal.addEventListener('abort', () => {
          aborted = true
        })
        return request.promise
      },
    })
    const firstOperationId = actor.getSnapshot().context.operationId
    expect(actor.getSnapshot().matches('saving')).toBe(true)

    actor.send({ type: 'reset' })
    expect(aborted).toBe(true)
    expect(actor.getSnapshot().context.operationId).toBeGreaterThan(firstOperationId)
    actor.send({ type: 'manual.submit', write: async () => true })
    await waitFor(actor, snapshot => snapshot.matches('success'))
    const currentOperationId = actor.getSnapshot().context.operationId

    request.resolve(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(actor.getSnapshot().matches('success')).toBe(true)
    expect(actor.getSnapshot().context.operationId).toBe(currentOperationId)
    actor.stop()
  })
})
