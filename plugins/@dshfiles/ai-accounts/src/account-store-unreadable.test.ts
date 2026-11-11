import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openAccountStore } from './fixtures/account-store.js'

const account = {
  instanceId: 'copilot-keep',
  kind: 'github-copilot',
  displayName: 'Keep me',
  enabled: true,
  homePath: '',
  shadowHomePath: '',
  apiKeyEnv: '',
  apiBaseUrl: '',
  badge: 'KM',
  accentColor: '#2563EB',
  providerIcon: 'Bot',
  additionalModelIds: [],
  reasoningDefaults: {},
  hiddenModelIds: [],
  favoriteModelIds: [],
  modelOrder: [],
} as const

const storeFile = (overrides: { readonly distribution?: string; readonly cooldownMs?: string } = {}) =>
  JSON.stringify({ distribution: 'sticky', cooldownMs: 300_000, shadowRoot: '/tmp/unused-shadow', accounts: [account], ...overrides })

const scratchFile = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-accounts-unreadable-'))
  const filePath = join(dir, 'accounts.json')
  writeFileSync(filePath, text)
  return { dir, filePath }
}

const added = { ...account, instanceId: 'copilot-new', displayName: 'New' }

describe('account store with an unreadable file', () => {
  it('refuses to save over a file it could never read and leaves it untouched', async () => {
    const corrupt = storeFile({ cooldownMs: 'forever' })
    const scratch = scratchFile(corrupt)
    const store = await openAccountStore(scratch.filePath)

    await expect(store.upsertAccount(added)).rejects.toMatchObject({ _tag: 'AccountStoreFileUnreadable', path: scratch.filePath })
    await expect(store.setDistribution('priority')).rejects.toMatchObject({ _tag: 'AccountStoreFileUnreadable' })
    expect(readFileSync(scratch.filePath, 'utf8')).toBe(corrupt)
  })

  it('saves over the last good snapshot and backs the unreadable file up first', async () => {
    const scratch = scratchFile(storeFile())
    const store = await openAccountStore(scratch.filePath)
    writeFileSync(scratch.filePath, '{ not json')

    const saved = await store.upsertAccount(added)

    expect(saved.accounts.map(entry => entry.instanceId)).toEqual(['copilot-keep', 'copilot-new'])
    const backups = readdirSync(scratch.dir).filter(name => name.startsWith('accounts.json.unreadable-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(scratch.dir, backups[0] ?? ''), 'utf8')).toBe('{ not json')
  })

  it('keeps every account when the stored distribution was retired', async () => {
    const scratch = scratchFile(storeFile({ distribution: 'weighted' }))
    const store = await openAccountStore(scratch.filePath)

    const file = await store.readAccountFile()

    expect(file.distribution).toBe('sticky')
    expect(file.accounts.map(entry => entry.instanceId)).toEqual(['copilot-keep'])
  })
})
