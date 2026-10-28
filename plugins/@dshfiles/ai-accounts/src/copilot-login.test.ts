import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'
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

    expect(service.state('copilot-personal')).toMatchObject({ status: 'complete', userCode: 'ABCD-EFGH' })
    expect(records.get(String(CopilotCredentialModel.key('copilot-personal')))).toMatchObject({ kind: 'grant', payload: credential })
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

  it.each(['existing', 'new', 'concurrent'] as const)('rolls back only its own late credential write after cancel (%s)', async scenario => {
    const { provider, records } = createCredentialProvider()
    const key = String(CopilotCredentialModel.key('copilot'))
    const previous = { ...credential, access: 'previous-fixture-access' }
    const concurrent = { ...credential, access: 'concurrent-fixture-access' }
    if (scenario === 'existing') records.set(key, { kind: 'grant', payload: previous })
    let enter = (): void => undefined
    const entered = new Promise<void>(resolve => {
      enter = resolve
    })
    let release = (): void => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const modify = provider.modifyRecord
    let first = true
    provider.modifyRecord = async (address, mutate) => {
      if (!first) return modify(address, mutate)
      first = false
      const next = await mutate(records.get(address.toString()))
      enter()
      await gate
      if (next !== undefined) records.set(address.toString(), next)
      if (scenario === 'concurrent') records.set(address.toString(), { kind: 'grant', payload: concurrent })
      return next
    }
    const service = createCopilotLoginService({ credentials: provider, isCopilotAccount: () => true, onChange: () => undefined, login: async () => credential })
    await service.begin('copilot')
    await entered
    service.cancel('copilot')
    release()
    await new Promise<void>(resolve => setImmediate(resolve))
    if (scenario === 'existing') expect(records.get(key)).toEqual({ kind: 'grant', payload: previous })
    else if (scenario === 'concurrent') expect(records.get(key)).toEqual({ kind: 'grant', payload: concurrent })
    else expect(JSON.stringify(records.get(key))).not.toContain(credential.access)
    expect(service.state('copilot').status).toBe('idle')
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

  it('keeps a pending candidate grant in memory until verified commit, and cancel preserves an existing grant', async () => {
    const { provider, records } = createCredentialProvider()
    const key = String(CopilotCredentialModel.key('pending-copilot'))
    const old = { ...credential, access: 'old-fixture-access' }
    records.set(key, { kind: 'grant', payload: old })
    const service = createCopilotLoginService({
      credentials: provider,
      isCopilotAccount: () => true,
      isPendingAccount: () => true,
      onChange: () => undefined,
      login: async () => credential,
    })
    await service.begin('pending-copilot')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(service.state('pending-copilot').status).toBe('complete')
    expect(service.readPending('pending-copilot')).toEqual(credential)
    expect(records.get(key)).toEqual({ kind: 'grant', payload: old })
    service.cancel('pending-copilot')
    expect(service.readPending('pending-copilot')).toBeUndefined()
    expect(records.get(key)).toEqual({ kind: 'grant', payload: old })
    await service.begin('pending-copilot')
    await new Promise<void>(resolve => setImmediate(resolve))
    await service.commitPending('pending-copilot')
    expect(records.get(key)).toEqual({ kind: 'grant', payload: credential })
    service.dispose()
  })

  it('rejects staged adoption if another writer replaced the saved Copilot grant', async () => {
    const { provider, records } = createCredentialProvider()
    const key = String(CopilotCredentialModel.key('pending-copilot'))
    const service = createCopilotLoginService({
      credentials: provider,
      isCopilotAccount: () => true,
      isPendingAccount: () => true,
      onChange: () => undefined,
      login: async () => credential,
    })
    await service.begin('pending-copilot')
    await new Promise<void>(resolve => setImmediate(resolve))
    const newer = { ...credential, access: 'newer-fixture-access' }
    records.set(key, { kind: 'grant', payload: newer })
    await expect(service.commitPending('pending-copilot')).rejects.toThrow('grant changed')
    expect(records.get(key)).toEqual({ kind: 'grant', payload: newer })
    service.dispose()
  })

  it('ignores late notifications from a cancelled intent after a newer login starts', async () => {
    const { provider } = createCredentialProvider()
    const interactions: Parameters<NonNullable<Parameters<typeof createCopilotLoginService>[0]['login']>>[0][] = []
    const service = createCopilotLoginService({
      credentials: provider,
      isCopilotAccount: () => true,
      onChange: () => undefined,
      login: async interaction => {
        interactions.push(interaction)
        await new Promise<void>(resolve => interaction.signal?.addEventListener('abort', () => resolve(), { once: true }))
        return credential
      },
    })
    await service.begin('copilot')
    await service.begin('copilot')
    interactions[0]?.notify({ type: 'device_code', userCode: 'OLD-CODE', verificationUri: 'https://github.com/login/device' })
    expect(service.state('copilot').status).toBe('starting')
    expect(service.state('copilot').userCode).toBeNull()
    service.dispose()
  })

  it('rejects sign-in for a removed or non-Copilot account', async () => {
    const service = createCopilotLoginService({ credentials: undefined, isCopilotAccount: () => false, onChange: () => undefined })
    await expect(service.begin('other-account')).rejects.toThrow('no longer available')
  })
})
