import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'
import { copilotCredentialKey } from './copilot-credentials.js'
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
    expect(records.get(String(copilotCredentialKey('copilot-personal')))).toEqual({ kind: 'grant', payload: credential })
    expect(JSON.stringify(service.state('copilot-personal'))).not.toContain('copilot-access-token')
    await service.signOut('copilot-personal')
    expect(service.state('copilot-personal').status).toBe('idle')
    expect(records.has(String(copilotCredentialKey('copilot-personal')))).toBe(false)
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
