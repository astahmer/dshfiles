import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import { cursorSessionRecordForResume, cursorSessionRecordSchema } from '../src/cursor-session-store.js'

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
})
