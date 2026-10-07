import { describe, expect, it } from 'vitest'
import {
  executeCursorRecoveryCommand,
  type CursorRecoveryInput,
  type CursorRecoveryOperations,
  type CursorRecoveryTarget,
} from '../src/cursor-recovery-command.js'
import type { CursorRecoveryReceipt } from '../src/cursor-session-store.js'

const pendingReceipt = {
  kind: 'prompt' as const,
  sessionId: 'failed-cursor-session',
  instanceId: 'work',
  operation: {
    id: '2fd7516e-73dd-476b-90d6-6075786414db',
    turn: 3,
    step: 2,
    startedAt: 100,
  },
}

const creationReceipt: CursorRecoveryReceipt = {
  kind: 'creation',
  sessionId: 'failed-creation-session',
  instanceId: 'work',
  operationId: 'a4ea0297-01d2-4aa6-8cf6-8dcdb1e5ddcf',
}

const makeOperations = (calls: string[], receipt: CursorRecoveryReceipt = pendingReceipt): CursorRecoveryOperations => ({
  recoveryReceipt: async (sessionId, instanceId) => {
    calls.push(`read:${sessionId}:${instanceId ?? 'unbound'}`)
    return receipt
  },
  recoveryReceipts: async () => {
    calls.push('list')
    return [receipt]
  },
  reconcilePrompt: async (sessionId, operationId, instanceId) => {
    calls.push(`reconcile:${sessionId}:${instanceId ?? 'unbound'}:${operationId}`)
  },
})

const makeInput = (rawInput: string, overrides: Partial<CursorRecoveryInput> = {}): CursorRecoveryInput => ({
  sourceSessionId: 'working-session',
  rawInput,
  commandSignal: new AbortController().signal,
  sourceMaintenanceSignal: new AbortController().signal,
  flushSourceSession: async () => true,
  resolveTarget: () => ({ kind: 'absent' }),
  ...overrides,
})

const makeLiveTarget = (
  calls: string[],
  runtimeBinding: { readonly driverKind: string; readonly instanceId: string } | undefined = {
    driverKind: 'cursor-acp',
    instanceId: 'work',
  },
): CursorRecoveryTarget => ({
  kind: 'agent',
  sessionId: pendingReceipt.sessionId,
  runtimeBinding,
  runMaintenance: async job => {
    calls.push('target-maintenance:start')
    const result = await job(new AbortController().signal)
    calls.push('target-maintenance:end')
    return result
  },
})

describe('Cursor uncertain-prompt reconciliation command', () => {
  it('lists receipt details without exposing provider session identifiers', async () => {
    const calls: string[] = []
    const privateReceipt = { ...pendingReceipt, nativeSessionId: 'provider-private-id' }
    const operations = makeOperations(calls, privateReceipt)
    operations.recoveryReceipts = async () => {
      calls.push('list')
      return [privateReceipt]
    }

    const result = await executeCursorRecoveryCommand(makeInput('list'), operations)

    expect(result.kind).toBe('success')
    expect(result.text).toContain(pendingReceipt.sessionId)
    expect(result.text).toContain(pendingReceipt.operation.id)
    expect(result.text).not.toContain('provider-private-id')
    expect(calls).toEqual(['list'])
  })

  it('surfaces an uncertain provider-session creation and offers a fresh-session recovery path', async () => {
    const calls: string[] = []
    const status = await executeCursorRecoveryCommand(makeInput(`status ${creationReceipt.sessionId}`), makeOperations(calls, creationReceipt))
    expect(status.kind).toBe('success')
    expect(status.text).toContain(creationReceipt.operationId)
    expect(status.text).toContain('create a new Cursor-bound Session')

    const confirm = await executeCursorRecoveryCommand(
      makeInput(`confirm ${creationReceipt.sessionId} ${creationReceipt.operationId} verified`),
      makeOperations(calls, creationReceipt),
    )
    expect(confirm.kind).toBe('error')
    expect(confirm.text).toContain('native session id is unavailable')
    expect(calls).toEqual([`read:${creationReceipt.sessionId}:unbound`, `read:${creationReceipt.sessionId}:unbound`])
  })

  it('reports a failed target Session receipt from a separate working Session', async () => {
    const calls: string[] = []
    const result = await executeCursorRecoveryCommand(makeInput(`status ${pendingReceipt.sessionId}`), makeOperations(calls))

    expect(result.kind).toBe('success')
    expect(result.text).toContain(pendingReceipt.operation.id)
    expect(result.text).toContain('Inspect Cursor and the workspace')
    expect(calls).toEqual([`read:${pendingReceipt.sessionId}:unbound`])
  })

  it('rejects malformed input and unavailable live targets before reading recovery state', async () => {
    const calls: string[] = []
    const operations = makeOperations(calls)

    await expect(executeCursorRecoveryCommand(makeInput('confirm not-a-uuid verified'), operations)).resolves.toMatchObject({
      kind: 'error',
    })
    await expect(
      executeCursorRecoveryCommand(
        makeInput(`status ${pendingReceipt.sessionId}`, {
          resolveTarget: () => ({ kind: 'initializing' }),
        }),
        operations,
      ),
    ).resolves.toMatchObject({ kind: 'error' })
    await expect(
      executeCursorRecoveryCommand(
        makeInput(`status ${pendingReceipt.sessionId}`, {
          resolveTarget: () => makeLiveTarget(calls, { driverKind: 'native', instanceId: 'work' }),
        }),
        operations,
      ),
    ).resolves.toMatchObject({ kind: 'error' })
    expect(calls).toEqual([])
  })

  it('records confirmation in the invoking Session before reconciling an absent target Agent', async () => {
    const calls: string[] = []
    const result = await executeCursorRecoveryCommand(
      makeInput(`confirm ${pendingReceipt.sessionId} ${pendingReceipt.operation.id} verified`, {
        flushSourceSession: async () => {
          calls.push('flush:working-session')
          return true
        },
      }),
      makeOperations(calls),
    )

    expect(result.kind).toBe('success')
    expect(result.text).toContain('durably recorded in the invoking Session')
    expect(result.text).toContain('prior prompt was not replayed')
    expect(calls).toEqual([
      `read:${pendingReceipt.sessionId}:unbound`,
      'flush:working-session',
      `reconcile:${pendingReceipt.sessionId}:unbound:${pendingReceipt.operation.id}`,
    ])
  })

  it('holds a live target idle across the exact-receipt check, source flush, and reconciliation', async () => {
    const calls: string[] = []
    const target = makeLiveTarget(calls)
    const result = await executeCursorRecoveryCommand(
      makeInput(`confirm ${pendingReceipt.sessionId} ${pendingReceipt.operation.id} verified`, {
        resolveTarget: () => target,
        flushSourceSession: async () => {
          calls.push('flush:working-session')
          return true
        },
      }),
      makeOperations(calls),
    )

    expect(result.kind).toBe('success')
    expect(calls).toEqual([
      'target-maintenance:start',
      `read:${pendingReceipt.sessionId}:work`,
      'flush:working-session',
      `reconcile:${pendingReceipt.sessionId}:work:${pendingReceipt.operation.id}`,
      'target-maintenance:end',
    ])
  })

  it('does not nest maintenance when the target is the invoking Session', async () => {
    const calls: string[] = []
    const target = { ...makeLiveTarget(calls), sessionId: 'working-session' }
    const result = await executeCursorRecoveryCommand(makeInput(`status ${target.sessionId}`, { resolveTarget: () => target }), makeOperations(calls))

    expect(result.kind).toBe('success')
    expect(calls).toEqual(['read:working-session:work'])
  })

  it('does not mutate a stale receipt or continue when the source confirmation is not durable', async () => {
    const staleCalls: string[] = []
    const staleResult = await executeCursorRecoveryCommand(
      makeInput(`confirm ${pendingReceipt.sessionId} 94548964-a521-1796-be71-7523f35ac5a4 verified`),
      makeOperations(staleCalls),
    )
    expect(staleResult.kind).toBe('error')
    expect(staleCalls).toEqual([`read:${pendingReceipt.sessionId}:unbound`])

    const flushCalls: string[] = []
    const flushResult = await executeCursorRecoveryCommand(
      makeInput(`confirm ${pendingReceipt.sessionId} ${pendingReceipt.operation.id} verified`, {
        flushSourceSession: async () => {
          flushCalls.push('flush')
          return false
        },
      }),
      makeOperations(flushCalls),
    )
    expect(flushResult.kind).toBe('error')
    expect(flushCalls).toEqual([`read:${pendingReceipt.sessionId}:unbound`, 'flush'])
  })

  it('does not reconcile after command cancellation during the source flush', async () => {
    const calls: string[] = []
    const controller = new AbortController()
    await expect(
      executeCursorRecoveryCommand(
        makeInput(`confirm ${pendingReceipt.sessionId} ${pendingReceipt.operation.id} verified`, {
          commandSignal: controller.signal,
          flushSourceSession: async () => {
            calls.push('flush')
            controller.abort()
            return true
          },
        }),
        makeOperations(calls),
      ),
    ).rejects.toThrow()

    expect(calls).toEqual([`read:${pendingReceipt.sessionId}:unbound`, 'flush'])
  })

  it('does not clear a receipt when a live target is busy', async () => {
    const calls: string[] = []
    const target: CursorRecoveryTarget = {
      kind: 'agent',
      sessionId: pendingReceipt.sessionId,
      runtimeBinding: { driverKind: 'cursor-acp', instanceId: 'work' },
      runMaintenance: () => {
        throw new Error('already has active work')
      },
    }

    const result = await executeCursorRecoveryCommand(
      makeInput(`confirm ${pendingReceipt.sessionId} ${pendingReceipt.operation.id} verified`, {
        resolveTarget: () => target,
      }),
      makeOperations(calls),
    )

    expect(result.kind).toBe('error')
    expect(result.text).toContain('target Session is busy')
    expect(calls).toEqual([])
  })
})
