import { describe, expect, it } from 'vitest'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { copilotCredentialKey, deleteCopilotCredential, modifyCopilotCredential, readCopilotCredential } from './copilot-credentials.js'

const credential = {
  type: 'oauth',
  access: 'copilot-access-token',
  refresh: 'github-refresh-token',
  expires: 1_900_000_000_000,
  availableModelIds: ['gpt-6-luna'],
} as const

describe('GitHub Copilot credential records', () => {
  it('stores each subscription under an account-scoped DSH credential record', async () => {
    const records = new Map<string, CredentialRecord>()
    const provider = {
      readRecord: async (key: { toString(): string }) => records.get(key.toString()),
      modifyRecord: async (key: { toString(): string }, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
        const next = await mutate(records.get(key.toString()))
        if (next !== undefined) records.set(key.toString(), next)
        return next
      },
      deleteRecord: async (key: { toString(): string }) => {
        records.delete(key.toString())
      },
    }

    const stored = await modifyCopilotCredential(provider, 'copilot-personal', async () => credential)

    expect(stored).toEqual(credential)
    expect(records.get(String(copilotCredentialKey('copilot-personal')))).toEqual({ kind: 'grant', payload: credential })
    expect(await readCopilotCredential(provider, 'copilot-personal')).toEqual(credential)
    expect(await readCopilotCredential(provider, 'copilot-work')).toBeUndefined()
    await deleteCopilotCredential(provider, 'copilot-personal')
    expect(await readCopilotCredential(provider, 'copilot-personal')).toBeUndefined()
  })

  it('fails closed on a malformed grant without exposing it as a login', async () => {
    const records = new Map<string, CredentialRecord>([[String(copilotCredentialKey('copilot-work')), { kind: 'grant', payload: { access: 'partial' } }]])
    const provider = { readRecord: async (key: { toString(): string }) => records.get(key.toString()) }

    expect(await readCopilotCredential(provider, 'copilot-work')).toBeUndefined()
  })
})
