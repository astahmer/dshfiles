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

  it('rejects sign-in for a removed or non-Copilot account', async () => {
    const service = createCopilotLoginService({ credentials: undefined, isCopilotAccount: () => false, onChange: () => undefined })
    await expect(service.begin('other-account')).rejects.toThrow('no longer available')
  })
})
