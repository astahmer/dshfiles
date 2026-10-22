import { describe, expect, test } from 'vitest'
import type { MirroredSessionSource, SessionSourceRegistry } from '@dshfiles/session-source-port'
import { authorizeRemoteSessionRuntime } from './session-runtime-authorization.js'

const registry = (source?: MirroredSessionSource, onResolve?: () => void): SessionSourceRegistry => ({
  register: () => () => {},
  sources: () => (source === undefined ? [] : [source]),
  claim: () => {},
  ownerOf: () => undefined,
  resolveOwner: async () => {
    onResolve?.()
    return source
  },
})

describe('remote Session runtime authorization', () => {
  test('allows the owning runtime', async () => {
    const source: MirroredSessionSource = {
      id: 'remote',
      label: 'Remote',
      list: async () => [],
      owns: () => true,
      runtimeIdForSession: async () => 'runtime-1',
    }
    await expect(
      authorizeRemoteSessionRuntime({ sessionId: 'session-1', runtimeId: 'runtime-1', recordedSessions: [], sessionSources: registry(source) }),
    ).resolves.toEqual({ ok: true })
  })

  test('rejects a Session owned by another runtime', async () => {
    const source: MirroredSessionSource = {
      id: 'remote',
      label: 'Remote',
      list: async () => [],
      owns: () => true,
      runtimeIdForSession: async () => 'runtime-1',
    }
    await expect(
      authorizeRemoteSessionRuntime({ sessionId: 'session-1', runtimeId: 'runtime-2', recordedSessions: [], sessionSources: registry(source) }),
    ).resolves.toMatchObject({ ok: false, code: 'session/wrong-runtime' })
  })

  test('rejects an unowned Session', async () => {
    let resolved = false
    await expect(
      authorizeRemoteSessionRuntime({
        sessionId: 'unknown',
        runtimeId: 'runtime-1',
        recordedSessions: [],
        sessionSources: registry(undefined, () => {
          resolved = true
        }),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'session/not-remote' })
    expect(resolved).toBe(true)
  })

  test('does not query another runtime when a recorded Session targets the wrong runtime', async () => {
    let resolved = false
    const untrustedSource: MirroredSessionSource = {
      id: 'other',
      label: 'Other',
      list: async () => [],
      owns: () => true,
      runtimeIdForSession: async () => 'runtime-2',
    }
    const result = await authorizeRemoteSessionRuntime({
      sessionId: 'recorded-session',
      runtimeId: 'runtime-2',
      recordedSessions: [{ sessionId: 'recorded-session', runtimeId: 'runtime-1' }],
      sessionSources: registry(untrustedSource, () => {
        resolved = true
      }),
    })
    expect(result).toMatchObject({ ok: false, code: 'session/wrong-runtime' })
    expect(resolved).toBe(false)
  })

  test('finds the owning source when a newer registry has no claim', async () => {
    const owningSource: MirroredSessionSource = {
      id: 'owning',
      label: 'Owning',
      list: async () => [],
      owns: () => true,
      runtimeIdForSession: async () => 'runtime-1',
    }
    await expect(
      authorizeRemoteSessionRuntime({
        sessionId: 'shared-session',
        runtimeId: 'runtime-1',
        recordedSessions: [],
        sessionSources: [registry(owningSource), registry()],
      }),
    ).resolves.toEqual({ ok: true })
  })

  test('treats an unavailable mirror source as an unowned Session', async () => {
    const sessionSources: SessionSourceRegistry = {
      ...registry(),
      resolveOwner: async () => {
        throw new Error('remote runtime unavailable')
      },
    }
    await expect(authorizeRemoteSessionRuntime({ sessionId: 'unknown', runtimeId: 'runtime-1', recordedSessions: [], sessionSources })).resolves.toMatchObject({
      ok: false,
      code: 'session/not-remote',
    })
  })

  test('authorizes a recorded Session without requiring the optional Session source service', async () => {
    await expect(
      authorizeRemoteSessionRuntime({
        sessionId: 'recorded-session',
        runtimeId: 'runtime-1',
        recordedSessions: [{ sessionId: 'recorded-session', runtimeId: 'runtime-1' }],
        sessionSources: undefined,
      }),
    ).resolves.toEqual({ ok: true })
  })

  test('uses recorded ownership for an empty Session before its first mirror-list result', async () => {
    await expect(
      authorizeRemoteSessionRuntime({
        sessionId: 'empty-session',
        runtimeId: 'runtime-1',
        recordedSessions: [{ sessionId: 'empty-session', runtimeId: 'runtime-1' }],
        sessionSources: registry(),
      }),
    ).resolves.toEqual({ ok: true })
  })
})
