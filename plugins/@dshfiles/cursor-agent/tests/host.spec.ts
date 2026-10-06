import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import {
  cursorSessionRecordForHumanReconciliation,
  cursorSessionRecordForResume,
  cursorSessionRecordSchema,
} from '../src/cursor-session-store.js'

describe('Cursor Agent config and recovery records', () => {
  it('defaults to no runtime instances and validates explicit credential aliases', () => {
    expect(Config.parse({})).toEqual({ instances: [] })
    expect(
      Config.parse({
        instances: [{ id: 'work', label: 'Work Cursor', credentialRef: 'CURSOR_API_KEY_WORK', credentialKind: 'api-key' }],
      }).instances,
    ).toHaveLength(1)
    expect(() =>
      Config.parse({
        instances: [
          { id: 'work', label: 'First', credentialRef: 'CURSOR_API_KEY_WORK', credentialKind: 'api-key' },
          { id: 'work', label: 'Second', credentialRef: 'CURSOR_API_KEY_OTHER', credentialKind: 'api-key' },
        ],
      }),
    ).toThrow()
    expect(() =>
      Config.parse({
        instances: [{ id: 'work', label: 'Work Cursor', credentialRef: 'secret-value', credentialKind: 'api-key' }],
      }),
    ).toThrow()
  })

  it('requires a provider session id before a sidecar can claim ready state', () => {
    expect(
      cursorSessionRecordSchema.safeParse({
        state: 'creating',
        instanceId: 'work',
        operationId: '2fd7516e-73dd-476b-90d6-6075786414db',
        startedAt: 1,
      }).success,
    ).toBe(true)
    expect(
      cursorSessionRecordSchema.safeParse({
        state: 'ready',
        instanceId: 'work',
        nativeSessionId: 'provider-owned-id',
      }).success,
    ).toBe(true)
    expect(
      cursorSessionRecordSchema.safeParse({
        state: 'ready',
        instanceId: 'work',
      }).success,
    ).toBe(false)
  })

  it('rejects missing and cross-instance provider session records', () => {
    expect(() => cursorSessionRecordForResume(undefined, 'work')).toThrow('record is missing')

    const record = cursorSessionRecordSchema.parse({
      state: 'ready',
      instanceId: 'other-work',
      nativeSessionId: 'provider-owned-id',
    })

    expect(() => cursorSessionRecordForResume(record, 'work')).toThrow('different runtime instance')
    expect(cursorSessionRecordForResume(record, 'other-work')).toEqual(record)
  })

  it('preserves creating receipts as uncertain across restart', () => {
    const record = cursorSessionRecordSchema.parse({
      state: 'creating',
      instanceId: 'work',
      operationId: '2fd7516e-73dd-476b-90d6-6075786414db',
      startedAt: 1,
    })

    expect(() => cursorSessionRecordForResume(record, 'work')).toThrow('creation outcome is uncertain')
  })

  it('resumes only a settled receipt owned by the selected runtime instance', () => {
    const record = cursorSessionRecordSchema.parse({
      state: 'ready',
      instanceId: 'work',
      nativeSessionId: 'provider-owned-id',
    })

    expect(cursorSessionRecordForResume(record, 'work')).toEqual(record)
    expect(() => cursorSessionRecordForResume(record, 'other')).toThrow('different runtime instance')
    expect(() => cursorSessionRecordForResume(undefined, 'work')).toThrow('record is missing')
  })

  it('refuses to replay a persisted prompt receipt after restart', () => {
    const record = cursorSessionRecordSchema.parse({
      state: 'ready',
      instanceId: 'work',
      nativeSessionId: 'provider-owned-id',
      pendingOperation: {
        id: '2fd7516e-73dd-476b-90d6-6075786414db',
        turn: 1,
        step: 1,
        startedAt: 1,
      },
    })

    expect(() => cursorSessionRecordForResume(record, 'work')).toThrow('outcome is uncertain')
  })

  it('clears only the exact user-confirmed prompt receipt', () => {
    const operationId = '2fd7516e-73dd-476b-90d6-6075786414db'
    const record = cursorSessionRecordSchema.parse({
      state: 'ready',
      instanceId: 'work',
      nativeSessionId: 'provider-owned-id',
      pendingOperation: { id: operationId, turn: 3, step: 2, startedAt: 100 },
    })

    const reconciled = cursorSessionRecordForHumanReconciliation(record, 'work', operationId)
    expect(reconciled).toEqual({ state: 'ready', instanceId: 'work', nativeSessionId: 'provider-owned-id' })
    expect(cursorSessionRecordForResume(reconciled, 'work')).toEqual(reconciled)
  })

  it('rejects stale, cross-instance, missing, and creation receipts during prompt reconciliation', () => {
    const operationId = '2fd7516e-73dd-476b-90d6-6075786414db'
    const record = cursorSessionRecordSchema.parse({
      state: 'ready',
      instanceId: 'work',
      nativeSessionId: 'provider-owned-id',
      pendingOperation: {
        id: operationId,
        turn: 3,
        step: 2,
        startedAt: 100,
      },
    })
    const creating = cursorSessionRecordSchema.parse({
      state: 'creating',
      instanceId: 'work',
      operationId: '2fd7516e-73dd-476b-90d6-6075786414db',
      startedAt: 100,
    })
    const settled = cursorSessionRecordSchema.parse({ state: 'ready', instanceId: 'work', nativeSessionId: 'provider-owned-id' })

    expect(() => cursorSessionRecordForHumanReconciliation(undefined, 'work', '2fd7516e-73dd-476b-90d6-6075786414db')).toThrow(
      'record is missing',
    )
    expect(() => cursorSessionRecordForHumanReconciliation(record, 'other', operationId)).toThrow(
      'different runtime instance',
    )
    expect(() => cursorSessionRecordForHumanReconciliation(record, 'work', '94548964-a521-1796-be71-7523f35ac5a4')).toThrow(
      'changed',
    )
    expect(() => cursorSessionRecordForHumanReconciliation(creating, 'work', '2fd7516e-73dd-476b-90d6-6075786414db')).toThrow(
      'prompt reconciliation cannot resolve it',
    )
    expect(() => cursorSessionRecordForHumanReconciliation(settled, 'work', '2fd7516e-73dd-476b-90d6-6075786414db')).toThrow(
      'no uncertain prompt receipt',
    )
  })
})
