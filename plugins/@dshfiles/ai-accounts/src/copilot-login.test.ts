import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopilotCredentialModel } from './copilot-credentials.js'
import { createCopilotLoginService } from './copilot-login.js'

const credential = {
  type: 'oauth',
  access: 'copilot-access-token',
  refresh: 'github-refresh-token',
  expires: 1_900_000_000_000,
  availableModelIds: ['gpt-6-luna'],
} as const

const createCredentialProvider = () => {
  const records = new Map<string, CredentialRecord>()
  return {
    records,
    provider: {
      readRecord: async (key: { toString(): string }) => records.get(key.toString()),
      modifyRecord: async (key: { toString(): string }, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
        const next = await mutate(records.get(key.toString()))
        if (next !== undefined) records.set(key.toString(), next)
        return next
      },
      deleteRecord: async (key: { toString(): string }) => {
        records.delete(key.toString())
      },
    },
  }
}

describe('GitHub Copilot device sign-in', () => {
  it('publishes only device-code status and persists the OAuth grant in DSH credentials', async () => {
    const { provider, records } = createCredentialProvider()
    const service = createCopilotLoginService({
      credentials: provider,
      isCopilotAccount: instanceId => instanceId === 'copilot-personal',
      onChange: () => undefined,
      login: async interaction => {
        interaction.notify({ type: 'device_code', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' })
        return credential
      },
    })

    await service.begin('copilot-personal')
    expect(service.state('copilot-personal')).toMatchObject({ status: 'waiting', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(service.state('copilot-personal')).toMatchObject({ status: 'complete', userCode: null, verificationUri: null })
    expect(records.get(String(CopilotCredentialModel.key('copilot-personal')))).toEqual({ kind: 'grant', payload: credential })
    expect(JSON.stringify(service.state('copilot-personal'))).not.toContain('copilot-access-token')
    await service.signOut('copilot-personal')
    expect(service.state('copilot-personal').status).toBe('idle')
    expect(records.has(String(CopilotCredentialModel.key('copilot-personal')))).toBe(false)
    service.dispose()
  })

  it('rejects non-GitHub verification URLs and does not store the grant', async () => {
    const { provider, records } = createCredentialProvider()
    const service = createCopilotLoginService({
      credentials: provider,
      isCopilotAccount: () => true,
      onChange: () => undefined,
      login: async interaction => {
        interaction.notify({ type: 'device_code', userCode: 'ABCD-EFGH', verificationUri: 'https://example.com/device' })
        return credential
      },
    })

    await service.begin('copilot-personal')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(service.state('copilot-personal')).toMatchObject({ status: 'error', message: 'GitHub returned an untrusted verification link.' })
    expect(records.size).toBe(0)
    service.dispose()
  })

  it('cancels a pending device flow without persisting a late result', async () => {
    const { provider, records } = createCredentialProvider()
    let finishLogin = (_value: typeof credential): void => undefined
    const pendingLogin = new Promise<typeof credential>(resolve => {
      finishLogin = resolve
    })
    const service = createCopilotLoginService({
      credentials: provider,
      isCopilotAccount: () => true,
      onChange: () => undefined,
      login: async interaction => {
        interaction.notify({ type: 'device_code', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' })
        return pendingLogin
      },
    })

    await service.begin('copilot-personal')
    expect(service.state('copilot-personal').status).toBe('waiting')
    service.cancel('copilot-personal')
    finishLogin(credential)
    await pendingLogin
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(service.state('copilot-personal')).toMatchObject({ status: 'idle', message: 'GitHub sign-in was cancelled.' })
    expect(records.size).toBe(0)
    service.dispose()
  })

  it('explains Copilot access rejection without exposing OAuth response data', async () => {
    const { provider } = createCredentialProvider()
    const service = createCopilotLoginService({
      credentials: provider,
      isCopilotAccount: () => true,
      onChange: () => undefined,
      login: async interaction => {
        interaction.notify({ type: 'device_code', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' })
        throw new Error('403 Forbidden: bearer sensitive-token')
      },
    })

    await service.begin('copilot-personal')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(service.state('copilot-personal')).toMatchObject({
      status: 'error',
      message: 'GitHub approved the device, but Copilot rejected this account. Check subscription access or organization policy.',
    })
    expect(JSON.stringify(service.state('copilot-personal'))).not.toContain('sensitive-token')
    service.dispose()
  })

  it('distinguishes credential-storage failures after successful GitHub authorization', async () => {
    const { provider } = createCredentialProvider()
    provider.modifyRecord = async () => {
      throw new Error('private storage detail')
    }
    const service = createCopilotLoginService({
      credentials: provider,
      isCopilotAccount: () => true,
      onChange: () => undefined,
      login: async interaction => {
        interaction.notify({ type: 'device_code', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' })
        return credential
      },
    })

    await service.begin('copilot-personal')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(service.state('copilot-personal')).toMatchObject({
      status: 'error',
      message: 'GitHub approved this device, but DSH could not save the Copilot credential.',
    })
    expect(JSON.stringify(service.state('copilot-personal'))).not.toContain('private storage detail')
    service.dispose()
  })

  it('rejects sign-in for a removed or non-Copilot account', async () => {
    const service = createCopilotLoginService({ credentials: undefined, isCopilotAccount: () => false, onChange: () => undefined })
    await expect(service.begin('other-account')).rejects.toThrow('no longer available')
  })
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => vi.useRealTimers())

it('ignores stale notifications and delayed cancellation after a newer setup starts', async () => {
  const { provider, records } = createCredentialProvider()
  const first = deferred<typeof credential>()
  const second = deferred<typeof credential>()
  let lateNotify: (() => void) | undefined
  let calls = 0
  const service = createCopilotLoginService({
    credentials: provider,
    isCopilotAccount: () => true,
    onChange: () => {},
    login: async interaction => {
      calls += 1
      if (calls === 1) lateNotify = () => interaction.notify({ type: 'device_code', userCode: 'OLD1-CODE', verificationUri: 'https://github.com/login/device' })
      return calls === 1 ? first.promise : second.promise
    },
  })
  await service.begin('work', 'old-intent')
  await service.begin('work', 'new-intent')
  service.cancel('work', 'old-intent')
  lateNotify?.()
  expect(service.state('work')).toMatchObject({ status: 'starting', userCode: null })
  first.resolve(credential)
  second.resolve(credential)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(service.state('work').status).toBe('complete')
  expect(records.size).toBe(1)
  service.dispose()
})

it.each(['cancel', 'remove', 'dispose'] as const)('preserves existing credentials when %s wins a queued credential mutation', async action => {
  const { provider, records } = createCredentialProvider()
  const key = String(CopilotCredentialModel.key('work'))
  const original = { ...credential, access: 'previous-fixture-access' }
  records.set(key, { kind: 'grant', payload: original })
  const mutationEntered = deferred<void>()
  const release = deferred<void>()
  const modifyRecord = provider.modifyRecord
  provider.modifyRecord = async (key, mutate) => {
    mutationEntered.resolve()
    await release.promise
    return modifyRecord(key, mutate)
  }
  let available = true
  const service = createCopilotLoginService({ credentials: provider, isCopilotAccount: () => available, onChange: () => {}, login: async () => credential })
  await service.begin('work')
  await mutationEntered.promise
  if (action === 'cancel') service.cancel('work')
  else if (action === 'remove') {
    available = false
    service.reconcile()
  } else service.dispose()
  release.resolve()
  vi.useRealTimers()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(records.get(key)).toEqual({ kind: 'grant', payload: original })
  expect(service.state('work').status).not.toBe('complete')
  service.dispose()
})

it('expires a pending device flow and ignores its late successful grant', async () => {
  vi.useFakeTimers()
  const { provider, records } = createCredentialProvider()
  const pending = deferred<typeof credential>()
  const service = createCopilotLoginService({ credentials: provider, isCopilotAccount: () => true, onChange: () => {}, login: async () => pending.promise })
  await service.begin('work')
  await vi.advanceTimersByTimeAsync(15 * 60_000)
  expect(service.state('work')).toMatchObject({ status: 'error', userCode: null, verificationUri: null })
  pending.resolve(credential)
  await vi.advanceTimersByTimeAsync(0)
  expect(records.size).toBe(0)
  service.dispose()
})

it('preserves a newer credential when the provider completes after an external replacement', async () => {
  const { provider, records } = createCredentialProvider()
  const pending = deferred<typeof credential>()
  const service = createCopilotLoginService({ credentials: provider, isCopilotAccount: () => true, onChange: () => {}, login: async () => pending.promise })
  await service.begin('work')
  await Promise.resolve()
  const newer = { ...credential, access: 'newer-fixture-access' }
  const key = String(CopilotCredentialModel.key('work'))
  records.set(key, { kind: 'grant', payload: newer })
  pending.resolve(credential)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(records.get(key)).toEqual({ kind: 'grant', payload: newer })
  expect(service.state('work').status).toBe('error')
  service.dispose()
})

it('handles synchronous provider failures without reflecting sensitive diagnostics', async () => {
  const service = createCopilotLoginService({
    credentials: undefined,
    isCopilotAccount: () => true,
    onChange: () => {},
    login: () => {
      throw new Error('private-provider-payload')
    },
  })
  await service.begin('work')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(service.state('work')).toMatchObject({ status: 'error', userCode: null, verificationUri: null })
  expect(JSON.stringify(service.state('work'))).not.toContain('private-provider-payload')
  service.dispose()
})
