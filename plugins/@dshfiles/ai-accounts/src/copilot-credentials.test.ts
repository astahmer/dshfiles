import { describe, expect, it } from 'vitest'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { CopilotCredentialModel, createCopilotCredentialsService } from './copilot-credentials.js'

const credential = {
  type: 'oauth',
  access: 'copilot-access-token',
  refresh: 'github-refresh-token',
  expires: 1_900_000_000_000,
  availableModelIds: ['gpt-6-luna'],
} as const

describe('GitHub Copilot credential records', () => {
  it('encodes route slugs into valid, collision-free DSH credential keys', () => {
    const underscored = CopilotCredentialModel.key('github-copilot_work')
    expect(String(underscored)).toMatch(/^ai-accounts\/github-copilot-[a-f0-9]+$/u)
    expect(underscored).not.toEqual(CopilotCredentialModel.key('github-copilot-work'))
  })

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

    const credentials = createCopilotCredentialsService(provider)
    const stored = await credentials.modify({ instanceId: 'copilot-personal', mutate: async () => credential })

    expect(stored).toEqual(credential)
    expect(records.get(String(CopilotCredentialModel.key('copilot-personal')))).toEqual({ kind: 'grant', payload: credential })
    expect(await credentials.read('copilot-personal')).toEqual(credential)
    expect(await credentials.read('copilot-work')).toBeUndefined()
    await credentials.remove('copilot-personal')
    expect(await credentials.read('copilot-personal')).toBeUndefined()
  })

  it('omits undefined optional SDK fields before writing a JSON-backed grant', async () => {
    const records = new Map<string, CredentialRecord>()
    const provider = {
      readRecord: async (key: { toString(): string }) => records.get(key.toString()),
      modifyRecord: async (key: { toString(): string }, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
        const next = await mutate(records.get(key.toString()))
        if (next !== undefined) records.set(key.toString(), next)
        return next
      },
    }
    const copilotCredential = { ...credential, enterpriseUrl: undefined }

    const credentials = createCopilotCredentialsService(provider)
    const stored = await credentials.modify({ instanceId: 'copilot-personal', mutate: async () => copilotCredential })
    const record = records.get(String(CopilotCredentialModel.key('copilot-personal')))

    expect(stored).toEqual(credential)
    expect(record).toEqual({ kind: 'grant', payload: credential })
    if (stored === undefined) throw new Error('Copilot grant was not stored.')
    expect(Object.hasOwn(stored, 'enterpriseUrl')).toBe(false)
    expect(JSON.stringify(record)).not.toContain('enterpriseUrl')
  })

  it('fails closed on a malformed grant without exposing it as a login', async () => {
    const records = new Map<string, CredentialRecord>([[String(CopilotCredentialModel.key('copilot-work')), { kind: 'grant', payload: { access: 'partial' } }]])
    const provider = { readRecord: async (key: { toString(): string }) => records.get(key.toString()) }
    const credentials = createCopilotCredentialsService(provider)

    expect(await credentials.read('copilot-work')).toBeUndefined()
  })
})
