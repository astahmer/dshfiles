import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccountSetupService, type SetupVerificationInput } from './account-setup-service.js'
import { accountKindSchema, aiAccountsApi } from './api.js'
import { defineApi, type ApiHandlerContext, type ApiHostInput } from '@dshfiles/dshx/api'
import { definePlugin } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { AccountConnectionMethodModel } from './account-connection-method.js'
import { userInfo } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { activateAccountRuntime, AccountLoginIntentModel } from './account-runtime.js'

const requestId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const roots: string[] = []
const services: ReturnType<typeof createAccountSetupService>[] = []
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.dispose()
    await service.settled()
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
const deferred = () => {
  let resolve = (): void => undefined
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const harness = async (
  verify: (request: SetupVerificationInput) => Promise<unknown> = async () => undefined,
  ttlMs = 60_000,
  settleLogin?: (id: string) => Promise<void>,
) => {
  const root = mkdtempSync(join(tmpdir(), 'account-setup-lifecycle-'))
  roots.push(root)
  mkdirSync(join(root, 'plugins', 'ai-accounts'), { recursive: true })
  vi.stubEnv('DSH_HOME', root)
  vi.resetModules()
  const { accountStoreService: store } = await import('./account-store.js')
  const keys = new Map<string, string>()
  const saveKey = vi.fn(async (ref: string, _owner: string, value: string) => {
    keys.set(ref, value)
  })
  const cleanupCandidate = vi.fn(async (_draft: import('./api.js').AccountDraft) => undefined)
  const onCommit = vi.fn(async () => undefined)
  const cancelLogin = vi.fn()
  const resolveCredential = vi.fn(async (ref: string) => keys.get(ref) ?? '')
  const service = createAccountSetupService({
    store,
    verify,
    ttlMs,
    now: () => Date.now(),
    resolveCredential,
    saveKey,
    cleanupCandidate,
    cancelLogin,
    ...(settleLogin !== undefined && { settleLogin }),
    onCommit,
  })
  services.push(service)
  return { service, store, keys, saveKey, cleanupCandidate, cancelLogin, resolveCredential, onCommit }
}

describe('Host-owned provisional account lifecycle', () => {
  it.each(accountKindSchema.options)('keeps %s absent until verified completion and commits exactly once', async kind => {
    const { service, store, onCommit } = await harness()
    const pending = await service.prepare({ kind, requestId })
    expect(pending.operationId).toBe(requestId)
    expect(pending.account?.enabled).toBe(false)
    expect((await store.readAccountFile()).accounts).toEqual([])
    expect(service.candidate(pending.instanceId)?.kind).toBe(kind)
    const [completed, repeated] = await Promise.all([service.complete(pending.operationId), service.complete(pending.operationId)])
    expect(completed.status).toBe('complete')
    expect(repeated).toEqual(completed)
    expect((await store.readAccountFile()).accounts).toHaveLength(1)
    expect((await store.readAccountFile()).accounts[0]?.enabled).toBe(true)
    expect(onCommit).toHaveBeenCalledTimes(1)
    await expect(service.discard(pending.operationId)).rejects.toThrow('already')
    expect((await store.readAccountFile()).accounts).toHaveLength(1)
  })

  it.each(accountKindSchema.options)('keeps new and reconnected %s snapshots valid at the real JSON wire boundary', async kind => {
    const { service, store, onCommit } = await harness()
    const host = await createTestHost()
    const wireApi = defineApi({
      id: 'account-setup-wire-regression',
      version: 1,
      methods: {
        complete: aiAccountsApi.methods.completeAccountConnection,
        get: aiAccountsApi.methods.getAccountConnection,
      },
    })
    try {
      await host.mount(
        definePlugin({
          id: 'account-setup-wire-regression',
          apis: [
            wireApi.host({
              complete: ({ input }: ApiHandlerContext<ApiHostInput<typeof wireApi.methods.complete>>) => service.complete(input.operationId),
              get: ({ input }: ApiHandlerContext<ApiHostInput<typeof wireApi.methods.get>>) => service.get(input.operationId),
            }),
          ],
        }),
        { packageId: '@dshfiles/ai-accounts' },
      )
      const call = async (method: 'complete' | 'get', operationId: string): Promise<unknown> => {
        const response = await host.connection.requestApi({
          packageId: '@dshfiles/ai-accounts',
          apiId: wireApi.id,
          version: wireApi.version,
          method,
          input: { operationId },
        })
        return response.json()
      }
      const created = await service.prepare({ kind, requestId })
      for (const method of ['complete', 'get', 'complete'] as const)
        expect(await call(method, created.operationId)).toMatchObject({ result: { ok: true, value: { output: { status: 'complete' } } } })
      const file = await store.readAccountFile()
      const saved = file.accounts[0]
      if (saved === undefined) throw new Error('Expected newly committed fixture account')
      const pending = await service.prepare({ kind, requestId: secondId, existingInstanceId: saved.instanceId })
      const edited = {
        ...saved,
        displayName: 'Concurrent saved name',
        badge: 'KEEP',
        accentColor: '#123456',
        providerIcon: 'Bot',
        additionalModelIds: ['fixture-extra'],
        reasoningDefaults: { 'fixture-extra': 'high' },
        hiddenModelIds: ['fixture-hidden'],
        favoriteModelIds: ['fixture-extra'],
        modelOrder: ['fixture-extra'],
      }
      await store.writeAccountFile({ ...file, accounts: [edited] })
      // Exercise the actual Host output-schema + JSON validator, not JSON.stringify,
      // which silently drops the own undefined property that broke reconnect replies.
      const completedReply = await call('complete', pending.operationId)
      const fetchedReply = await call('get', pending.operationId)
      const repeatedReply = await call('complete', pending.operationId)
      // Publication has succeeded even if the following wire assertions fail.
      expect(service.get(pending.operationId).status).toBe('complete')
      expect((await store.readAccountFile()).accounts).toEqual([{ ...edited, enabled: true }])
      expect(onCommit).toHaveBeenCalledTimes(2)
      for (const reply of [completedReply, fetchedReply, repeatedReply])
        expect(reply).toMatchObject({ result: { ok: true, value: { output: { status: 'complete', account: { ...edited, enabled: true } } } } })
      const completed = service.get(pending.operationId)
      expect(completed).toStrictEqual(JSON.parse(JSON.stringify(completed)))
      if (saved.authSource === undefined && (kind === 'codex' || kind === 'claude' || kind === 'github-copilot'))
        expect(Object.hasOwn(completed.account ?? {}, 'authSource')).toBe(false)
      expect((await store.readAccountFile()).accounts).toHaveLength(1)
      expect(onCommit).toHaveBeenCalledTimes(2)
    } finally {
      await host.dispose()
    }
  })

  it('reproduces and prevents the old eager-store publication on prepare/read/usage inputs', async () => {
    const { service, store } = await harness()
    await service.prepare({ kind: 'codex', requestId })
    const file = await store.readAccountFile()
    expect(file.accounts).toEqual([])
    expect((await store.buildAccountsFile(file, [])).accounts).toEqual([])
    expect(store.readAccountFileSync().accounts).toEqual([])
  })

  it('cancels before verification settles and rejects the late success without adopting or publishing', async () => {
    const gate = deferred()
    const entered = deferred()
    const { service, store, saveKey, cleanupCandidate } = await harness(async () => {
      entered.resolve()
      await gate.promise
    })
    const pending = await service.prepare({ kind: 'opencode-go', requestId })
    service.stageKey(pending.operationId, 'fixture-key')
    const completion = service.complete(pending.operationId)
    const rejected = expect(completion).rejects.toThrow('could not be verified')
    await entered.promise
    const discard = service.discard(pending.operationId)
    expect(service.get(pending.operationId).status).toBe('discarded')
    expect(service.candidate(pending.instanceId)).toBeUndefined()
    gate.resolve()
    await Promise.all([discard, rejected])
    expect(saveKey).not.toHaveBeenCalled()
    expect((await store.readAccountFile()).accounts).toEqual([])
    expect(cleanupCandidate).toHaveBeenCalled()
  })

  it('tombstones a cancellation that arrives before prepare, including an in-flight prepare', async () => {
    const { service, store } = await harness()
    await service.discard(requestId)
    await expect(service.prepare({ kind: 'codex', requestId })).rejects.toThrow('cancelled')
    const preparation = service.prepare({ kind: 'claude', requestId: secondId })
    await service.discard(secondId)
    await expect(preparation).rejects.toThrow('cancelled')
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it('cannot revive a cancelled preparation after its tombstone TTL while its read is still pending', async () => {
    const { service, store } = await harness(undefined, 20)
    const gate = deferred()
    const read = store.readAccountFile
    let first = true
    vi.spyOn(store, 'readAccountFile').mockImplementation(async () => {
      if (first) {
        first = false
        await gate.promise
      }
      return read()
    })
    vi.useFakeTimers()
    const preparation = service.prepare({ kind: 'codex', requestId })
    const rejected = expect(preparation).rejects.toThrow('cancelled')
    await service.discard(requestId)
    await vi.advanceTimersByTimeAsync(21)
    await service.prepare({ kind: 'claude', requestId: secondId })
    gate.resolve()
    await rejected
    expect(service.candidates().map(account => account.kind)).toEqual(['claude'])
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it('establishes preparation expiry before the first store read, not after a slow read returns', async () => {
    const { service, store } = await harness(undefined, 20)
    const gate = deferred()
    const read = store.readAccountFile
    vi.spyOn(store, 'readAccountFile').mockImplementationOnce(async () => {
      await gate.promise
      return read()
    })
    vi.useFakeTimers()
    const preparation = service.prepare({ kind: 'codex', requestId })
    const rejected = expect(preparation).rejects.toThrow('expired')
    await vi.advanceTimersByTimeAsync(21)
    gate.resolve()
    await rejected
    expect(service.candidates()).toEqual([])
  })

  it('allows only one live reconnect owner for a saved account even with simultaneous prepares', async () => {
    const { service, store, cancelLogin } = await harness()
    const candidate = await store.createSetupAccount({ kind: 'github-copilot', requestId: secondId })
    await store.upsertAccount(candidate.draft)
    const a = service.prepare({ kind: 'github-copilot', requestId, existingInstanceId: candidate.instanceId })
    const b = service.prepare({ kind: 'github-copilot', requestId: secondId, existingInstanceId: candidate.instanceId })
    await expect(b).rejects.toThrow('already active')
    const owner = await a
    expect(service.candidates()).toHaveLength(1)
    await service.discard(owner.operationId)
    const replacement = await service.prepare({ kind: 'github-copilot', requestId: secondId, existingInstanceId: candidate.instanceId })
    cancelLogin.mockClear()
    await service.discard(owner.operationId)
    expect(cancelLogin).not.toHaveBeenCalled()
    expect(service.get(replacement.operationId).status).toBe('pending')
  })

  it('retains reconnect ownership until cancelled login cleanup has fully settled', async () => {
    const gate = deferred()
    const entered = deferred()
    const settle = vi.fn(async () => {
      entered.resolve()
      await gate.promise
    })
    const { service, store } = await harness(undefined, 60_000, settle)
    const candidate = await store.createSetupAccount({ kind: 'github-copilot', requestId: secondId })
    await store.upsertAccount(candidate.draft)
    const first = await service.prepare({ kind: 'github-copilot', requestId, existingInstanceId: candidate.instanceId })
    const discarding = service.discard(first.operationId)
    await entered.promise
    await expect(service.prepare({ kind: 'github-copilot', requestId: secondId, existingInstanceId: candidate.instanceId })).rejects.toThrow('already active')
    gate.resolve()
    await discarding
    const replacement = await service.prepare({ kind: 'github-copilot', requestId: secondId, existingInstanceId: candidate.instanceId })
    await service.discard(first.operationId)
    expect(settle).toHaveBeenCalledTimes(1)
    expect(service.get(replacement.operationId).status).toBe('pending')
  })

  it('scopes login intent ownership so old begins/cancels and legacy cleanup cannot touch a newer wizard', async () => {
    const { service, store } = await harness()
    const candidate = await store.createSetupAccount({ kind: 'codex', requestId: secondId })
    await store.upsertAccount(candidate.draft)
    const root = new Context()
    const fiber = await root.plugin(ctx => {
      activateAccountRuntime(ctx).accountSetup = service
    })
    try {
      const a = await service.prepare({ kind: 'codex', requestId, existingInstanceId: candidate.instanceId })
      expect(AccountLoginIntentModel.owns(root, candidate.instanceId, a.operationId)).toBe(true)
      expect(AccountLoginIntentModel.owns(root, candidate.instanceId)).toBe(false)
      await service.discard(a.operationId)
      const b = await service.prepare({ kind: 'codex', requestId: secondId, existingInstanceId: candidate.instanceId })
      expect(AccountLoginIntentModel.owns(root, candidate.instanceId, a.operationId)).toBe(false)
      expect(AccountLoginIntentModel.owns(root, candidate.instanceId, a.operationId, true)).toBe(false)
      expect(AccountLoginIntentModel.owns(root, candidate.instanceId)).toBe(false)
      expect(AccountLoginIntentModel.owns(root, candidate.instanceId, b.operationId)).toBe(true)
    } finally {
      await fiber.dispose()
    }
  })

  it('normalizes mixed-case operation UUIDs before cancellation, lookup and staging', async () => {
    const { service, store } = await harness()
    const mixed = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
    await service.discard(mixed.toUpperCase())
    await expect(service.prepare({ kind: 'codex', requestId: mixed })).rejects.toThrow('cancelled')
    const pending = await service.prepare({ kind: 'commandcode', requestId })
    expect(service.get(requestId.toUpperCase()).operationId).toBe(pending.operationId)
    service.stageKey(requestId.toUpperCase(), 'fixture-key')
    await service.discard(requestId.toUpperCase())
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it('stages keys only in memory and uses the candidate resolver for verification', async () => {
    let resolved = ''
    const { service, store, keys, saveKey } = await harness(async request => {
      resolved = await request.resolveCredential(request.account.apiKeyEnv)
    })
    const pending = await service.prepare({ kind: 'commandcode', requestId })
    const staged = service.stageKey(pending.operationId, 'fixture-key')
    expect(JSON.stringify(staged)).not.toContain('fixture-key')
    expect(keys.size).toBe(0)
    expect((await store.readAccountFile()).accounts).toEqual([])
    await service.complete(pending.operationId)
    expect(resolved).toBe('fixture-key')
    expect(saveKey).toHaveBeenCalledTimes(1)
    const account = (await store.readAccountFile()).accounts[0]
    expect(keys.get(account?.apiKeyEnv ?? '')).toBe('fixture-key')
  })

  it('refuses cancellation only after verified commit has been accepted inside the store queue', async () => {
    const { service, store, saveKey, keys } = await harness()
    const gate = deferred()
    const entered = deferred()
    saveKey.mockImplementation(async (ref, _owner, value) => {
      entered.resolve()
      await gate.promise
      keys.set(ref, value)
    })
    const pending = await service.prepare({ kind: 'opencode-go', requestId })
    service.stageKey(pending.operationId, 'fixture-key')
    const completion = service.complete(pending.operationId)
    await entered.promise
    await expect(service.discard(pending.operationId)).rejects.toThrow('accepted commit')
    expect((await store.readAccountFile()).accounts).toEqual([])
    gate.resolve()
    expect((await completion).status).toBe('complete')
    expect((await store.readAccountFile()).accounts).toHaveLength(1)
  })

  it('retries a failed account-file commit using the native reference without overwriting a concurrent key edit', async () => {
    const seen: string[] = []
    const { service, store, saveKey, keys } = await harness(async request => {
      seen.push(await request.resolveCredential(request.account.apiKeyEnv))
    })
    vi.spyOn(store, 'commitConnection').mockImplementationOnce(async request => {
      await request.beforeCommit?.()
      throw new Error('fixture disk failure')
    })
    const pending = await service.prepare({ kind: 'opencode-go', requestId })
    const staged = service.stageKey(pending.operationId, 'fixture-key')
    await expect(service.complete(pending.operationId)).rejects.toThrow('Retry completion')
    expect((await store.readAccountFile()).accounts).toEqual([])
    const reference = staged.account?.apiKeyEnv ?? ''
    keys.set(reference, 'concurrent-native-key')
    await service.complete(pending.operationId)
    expect(seen).toEqual(['fixture-key', 'concurrent-native-key'])
    expect(saveKey).toHaveBeenCalledTimes(1)
    expect(keys.get(reference)).toBe('concurrent-native-key')
    expect((await store.readAccountFile()).accounts).toHaveLength(1)
  })

  it('failed verification scrubs memory and performs no native credential write', async () => {
    const { service, store, saveKey } = await harness(async () => {
      throw new Error('sensitive upstream payload')
    })
    const pending = await service.prepare({ kind: 'cursor', requestId })
    service.stageKey(pending.operationId, 'fixture-key')
    await expect(service.complete(pending.operationId)).rejects.toThrow('no account was saved')
    expect(saveKey).not.toHaveBeenCalled()
    expect((await store.readAccountFile()).accounts).toEqual([])
    expect(service.get(pending.operationId)).toMatchObject({ status: 'discarded', account: null })
  })

  it('expires pending operations and stops their login before cleaning their private candidate', async () => {
    const { service, store, cancelLogin } = await harness(undefined, 20)
    vi.useFakeTimers()
    const pending = await service.prepare({ kind: 'codex', requestId })
    await vi.advanceTimersByTimeAsync(21)
    expect(service.get(pending.operationId).status).toBe('discarded')
    expect(cancelLogin).toHaveBeenCalledWith(pending.instanceId)
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it.each(accountKindSchema.options)('renames provisional %s metadata without touching auth or publishing it', async kind => {
    const settle = vi.fn(async () => undefined)
    const { service, store, cancelLogin, resolveCredential, saveKey, cleanupCandidate } = await harness(undefined, 60_000, settle)
    const prepared = await service.prepare({ kind, requestId })
    const read = vi.spyOn(store, 'readAccountFile')
    const renamed = await service.configure(prepared.operationId, { displayName: '  Work account  ' })
    expect(renamed).toEqual({ ...prepared, account: { ...prepared.account, displayName: 'Work account' } })
    expect(service.get(prepared.operationId)).toEqual(renamed)
    expect(service.canBeginLogin(prepared.operationId, prepared.instanceId)).toBe(prepared.method === 'device')
    expect(read).not.toHaveBeenCalled()
    expect(cancelLogin).not.toHaveBeenCalled()
    expect(settle).not.toHaveBeenCalled()
    expect(resolveCredential).not.toHaveBeenCalled()
    expect(saveKey).not.toHaveBeenCalled()
    expect((await store.readAccountFile()).accounts).toEqual([])
    await service.discard(prepared.operationId)
    expect(cleanupCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: prepared.instanceId,
        displayName: prepared.account?.displayName,
        homePath: prepared.account?.homePath,
        shadowHomePath: prepared.account?.shadowHomePath,
      }),
    )
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it('preserves a renamed account across auth method changes, staged keys and verified completion', async () => {
    const verify = vi.fn(async (request: SetupVerificationInput) => {
      expect(request.account.displayName).toBe('Claude work')
      expect(await request.resolveCredential(request.account.apiKeyEnv)).toBe('fixture-key')
    })
    const settle = vi.fn(async () => undefined)
    const { service, store, cancelLogin, saveKey } = await harness(verify, 60_000, settle)
    const prepared = await service.prepare({ kind: 'claude', requestId })
    await service.configure(prepared.operationId, { displayName: 'Claude work' })
    expect((await service.configure(prepared.operationId, { mode: 'key' })).account?.displayName).toBe('Claude work')
    expect(service.stageKey(prepared.operationId, 'discarded-fixture-key').account?.displayName).toBe('Claude work')
    expect((await service.configure(prepared.operationId, { mode: 'subscription' })).account?.displayName).toBe('Claude work')
    const keyed = await service.configure(prepared.operationId, { mode: 'key', displayName: 'Key account' })
    expect(keyed.account?.displayName).toBe('Key account')
    const staged = service.stageKey(prepared.operationId, 'fixture-key')
    cancelLogin.mockClear()
    settle.mockClear()
    const renamed = await service.configure(prepared.operationId, { displayName: 'Claude work' })
    expect(renamed.account?.apiKeyEnv).toBe(staged.account?.apiKeyEnv)
    expect(cancelLogin).not.toHaveBeenCalled()
    expect(settle).not.toHaveBeenCalled()
    expect(saveKey).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect((await store.readAccountFile()).accounts).toEqual([])
    const completed = await service.complete(prepared.operationId)
    expect(completed.account).toMatchObject({ displayName: 'Claude work', instanceId: prepared.instanceId, homePath: prepared.account?.homePath })
    expect((await store.readAccountFile()).accounts[0]?.displayName).toBe('Claude work')
    expect(saveKey).toHaveBeenCalledTimes(1)
  })

  it.each(['', '   ', 'n'.repeat(121)])('rejects invalid names before touching pending auth', async displayName => {
    const { service, store, cancelLogin } = await harness()
    const prepared = await service.prepare({ kind: 'claude', requestId })
    expect(() => service.configure(prepared.operationId, { displayName })).toThrow()
    expect(service.get(prepared.operationId)).toEqual(prepared)
    expect(cancelLogin).not.toHaveBeenCalled()
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it('rejects reconnect renames explicitly and preserves the latest saved metadata on completion', async () => {
    const { service, store, cancelLogin } = await harness()
    const candidate = await store.createSetupAccount({ kind: 'claude', requestId: secondId })
    await store.upsertAccount(candidate.draft)
    const prepared = await service.prepare({ kind: 'claude', requestId, existingInstanceId: candidate.instanceId })
    expect(() => service.configure(prepared.operationId, { displayName: 'Ignored rename', mode: 'key' })).toThrow('Edit saved account name from settings.')
    expect(service.get(prepared.operationId)).toEqual(prepared)
    expect(cancelLogin).not.toHaveBeenCalled()
    await store.upsertAccount({ ...candidate.draft, displayName: 'Latest settings name', badge: 'keep' })
    await service.complete(prepared.operationId)
    expect((await store.readAccountFile()).accounts[0]).toMatchObject({ displayName: 'Latest settings name', badge: 'keep' })
  })

  it('does not allow renaming during asynchronous auth configuration or after cancellation', async () => {
    const gate = deferred()
    const { service } = await harness(undefined, 60_000, async () => gate.promise)
    const prepared = await service.prepare({ kind: 'claude', requestId })
    const configuring = service.configure(prepared.operationId, { mode: 'key', displayName: 'Key account' })
    expect(() => service.configure(prepared.operationId, { displayName: 'Concurrent rename' })).toThrow('no longer editable')
    await expect(service.complete(prepared.operationId)).rejects.toThrow('configuration is changing')
    gate.resolve()
    expect((await configuring).account?.displayName).toBe('Key account')
    await service.discard(prepared.operationId)
    expect(() => service.configure(prepared.operationId, { displayName: 'Cancelled rename' })).toThrow('no longer editable')
  })

  it('does not allow renaming during verification or after completion', async () => {
    const gate = deferred()
    const { service } = await harness(async () => gate.promise)
    const prepared = await service.prepare({ kind: 'claude', requestId })
    await service.configure(prepared.operationId, { displayName: 'Before verification' })
    const completing = service.complete(prepared.operationId)
    expect(() => service.configure(prepared.operationId, { displayName: 'Late rename' })).toThrow('no longer editable')
    gate.resolve()
    expect((await completing).account?.displayName).toBe('Before verification')
    expect(() => service.configure(prepared.operationId, { displayName: 'Completed rename' })).toThrow('no longer editable')
  })

  it('rejects renaming an expired operation even before its expiry timer runs', async () => {
    const { service, store } = await harness(undefined, 20)
    vi.useFakeTimers()
    const prepared = await service.prepare({ kind: 'claude', requestId })
    vi.setSystemTime(Date.now() + 21)
    expect(() => service.configure(prepared.operationId, { displayName: 'Expired rename' })).toThrow('no longer editable')
    expect(service.get(prepared.operationId).status).toBe('discarded')
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it('uses blank Claude subscription ref, supports key mode, and never writes configuration to saved settings', async () => {
    const { service, store } = await harness()
    const pending = await service.prepare({ kind: 'claude', requestId })
    expect(pending.account?.apiKeyEnv).toBe('')
    const keyed = await service.configure(pending.operationId, { mode: 'key' })
    expect(keyed.account?.apiKeyEnv).toMatch(/_API_KEY$/u)
    const subscription = await service.configure(pending.operationId, { mode: 'subscription' })
    expect(subscription.account?.apiKeyEnv).toBe('')
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it('preserves existing reconnect cancel and merges successful finish into latest settings', async () => {
    const { service, store, keys } = await harness()
    const candidate = await store.createSetupAccount({ kind: 'opencode-go', requestId: secondId })
    const original = { ...candidate.draft, enabled: false, apiKeyEnv: 'ORIGINAL_API_KEY' }
    keys.set(original.apiKeyEnv, 'existing-key')
    await store.upsertAccount(original)
    const cancelled = await service.prepare({ kind: 'opencode-go', requestId, existingInstanceId: original.instanceId })
    await service.configure(cancelled.operationId, { mode: 'key' })
    service.stageKey(cancelled.operationId, 'replacement-key')
    await service.discard(cancelled.operationId)
    expect((await store.readAccountFile()).accounts).toEqual([original])
    expect(keys.get(original.apiKeyEnv)).toBe('existing-key')
    const completed = await service.prepare({ kind: 'opencode-go', requestId: '33333333-3333-4333-8333-333333333333', existingInstanceId: original.instanceId })
    await store.upsertAccount({ ...original, displayName: 'Concurrent user edit', hiddenModelIds: ['keep'] })
    await service.complete(completed.operationId)
    expect((await store.readAccountFile()).accounts[0]).toMatchObject({
      displayName: 'Concurrent user edit',
      hiddenModelIds: ['keep'],
      enabled: true,
      apiKeyEnv: original.apiKeyEnv,
    })
  })

  it.each(['commandcode', 'cursor'] as const)('restores explicit %s CLI linking without a key write or eager publication', async kind => {
    const proof = vi.fn(async (_request: SetupVerificationInput) => undefined)
    const { service, store, saveKey } = await harness(proof)
    const pending = await service.prepare({ kind, requestId, mode: 'cli' })
    expect(pending.method).toBe('cli')
    expect(pending.account?.apiKeyEnv).toBe('')
    expect(pending.account?.loginHint).toBe(kind === 'commandcode' ? 'cmd login' : 'cursor-agent login')
    expect((await store.readAccountFile()).accounts).toEqual([])
    await service.complete(pending.operationId)
    expect(proof).toHaveBeenCalledWith(expect.objectContaining({ method: 'cli', account: expect.objectContaining({ apiKeyEnv: '' }) }))
    expect(saveKey).not.toHaveBeenCalled()
    expect((await store.readAccountFile()).accounts[0]?.apiKeyEnv).toBe('')
  })

  it.each(['claude', 'opencode-go', 'commandcode', 'cursor'] as const)(
    'restores %s existing native/environment reference without reading or writing another credential',
    async kind => {
      const { service, store, keys, saveKey } = await harness(async request => {
        expect(request.method).toBe('reference')
        expect(await request.resolveCredential(request.account.apiKeyEnv)).toBe('existing-fixture-key')
      })
      keys.set('EXISTING_API_KEY', 'existing-fixture-key')
      const pending = await service.prepare({ kind, requestId, mode: 'reference' })
      await service.configure(pending.operationId, { apiKeyEnv: 'EXISTING_API_KEY' })
      await service.complete(pending.operationId)
      expect(saveKey).not.toHaveBeenCalled()
      expect((await store.readAccountFile()).accounts[0]?.apiKeyEnv).toBe('EXISTING_API_KEY')
    },
  )

  it('switches an existing readonly reference to a unique staged key without replacing that reference', async () => {
    const { service, store, keys, saveKey } = await harness()
    const candidate = await store.createSetupAccount({ kind: 'commandcode', requestId: secondId })
    await store.upsertAccount({ ...candidate.draft, apiKeyEnv: 'READONLY_API_KEY' })
    keys.set('READONLY_API_KEY', 'original-readonly-key')
    const pending = await service.prepare({ kind: 'commandcode', requestId, existingInstanceId: candidate.instanceId })
    expect(pending.method).toBe('reference')
    const keyed = await service.configure(pending.operationId, { mode: 'key' })
    expect(keyed.account?.apiKeyEnv).not.toBe('READONLY_API_KEY')
    service.stageKey(pending.operationId, 'replacement-fixture-key')
    await service.complete(pending.operationId)
    expect(keys.get('READONLY_API_KEY')).toBe('original-readonly-key')
    expect(saveKey).toHaveBeenCalledTimes(1)
  })

  it('links a custom Claude CLI home while cleanup still owns only the original generated home', async () => {
    const { service, store, cleanupCandidate } = await harness()
    const pending = await service.prepare({ kind: 'claude', requestId })
    const allocated = service.candidate(pending.instanceId)
    const custom = join(userInfo().homedir, '.claude-compatibility-fixture')
    const configured = await service.configure(pending.operationId, { homePath: custom, mode: 'subscription' })
    expect(configured.account?.homePath).toBe(custom)
    expect(configured.account?.loginHint).toContain(custom)
    await service.discard(pending.operationId)
    expect(cleanupCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: allocated?.instanceId, homePath: allocated?.homePath, shadowHomePath: allocated?.shadowHomePath }),
    )
    expect(cleanupCandidate).not.toHaveBeenCalledWith(expect.objectContaining({ homePath: custom }))
    expect((await store.readAccountFile()).accounts).toEqual([])
  })

  it.each(['complete', 'discard', 'expire'] as const)('never recursively removes an explicitly selected descendant Claude home on %s', async action => {
    const { service, cleanupCandidate } = await harness(undefined, 50)
    cleanupCandidate.mockImplementation(async draft => {
      rmSync(draft.homePath, { recursive: true, force: true })
    })
    vi.useFakeTimers()
    const pending = await service.prepare({ kind: 'claude', requestId })
    const root = pending.account?.homePath
    if (root === undefined) throw new Error('Expected generated home')
    const homePath = join(root, 'explicit-child')
    mkdirSync(homePath, { recursive: true })
    const marker = join(homePath, 'owned-by-user-marker')
    writeFileSync(marker, 'inert fixture')
    await service.configure(pending.operationId, { homePath })
    if (action === 'complete') {
      await service.complete(pending.operationId)
      await expect(service.discard(pending.operationId)).rejects.toThrow('already')
    } else if (action === 'discard') await service.discard(pending.operationId)
    else {
      await vi.advanceTimersByTimeAsync(51)
      await service.settled()
    }
    expect(cleanupCandidate).not.toHaveBeenCalled()
    expect(existsSync(marker)).toBe(true)
  })

  it('links only legacy-valid distinct Codex overlays and keeps an exact effective-home hint', async () => {
    const { service, store } = await harness()
    const pending = await service.prepare({ kind: 'codex', requestId })
    const homePath = join(userInfo().homedir, '.codex-compatibility-shared')
    const shadowHomePath = join(userInfo().homedir, '.codex-compatibility-overlay')
    const configured = await service.configure(pending.operationId, { mode: 'cli', homePath, shadowHomePath })
    expect(configured.account).toMatchObject({ mode: 'authOverlay', homePath, shadowHomePath })
    expect(configured.account?.loginHint).toContain(shadowHomePath)
    expect(service.canBeginLogin(pending.operationId, pending.instanceId)).toBe(false)
    await expect(service.configure(pending.operationId, { homePath, shadowHomePath: homePath })).rejects.toThrow('must differ')
    await expect(service.configure(pending.operationId, { homePath: '/tmp/untrusted', shadowHomePath: '/tmp/untrusted-overlay' })).rejects.toThrow('inside')
    await service.complete(pending.operationId)
    expect((await store.readAccountFile()).accounts[0]).toMatchObject({ homePath, shadowHomePath })
  })

  it('saves changed existing Claude homes alongside latest metadata rather than restoring the old home', async () => {
    const { service, store, cleanupCandidate } = await harness()
    const candidate = await store.createSetupAccount({ kind: 'claude', requestId: secondId })
    const original = { ...candidate.draft, apiKeyEnv: '' }
    await store.upsertAccount(original)
    const pending = await service.prepare({ kind: 'claude', requestId, existingInstanceId: original.instanceId })
    const homePath = join(userInfo().homedir, '.claude-existing-compatibility')
    await service.configure(pending.operationId, { mode: 'subscription', homePath })
    await store.upsertAccount({ ...original, displayName: 'Concurrent display edit' })
    await service.complete(pending.operationId)
    expect((await store.readAccountFile()).accounts[0]).toMatchObject({ homePath, displayName: 'Concurrent display edit' })
    expect(cleanupCandidate).not.toHaveBeenCalled()
  })

  it('invalidates old login before awaiting configuration cleanup, and cancellation wins before the new home applies', async () => {
    const gate = deferred()
    const entered = deferred()
    const { service, cancelLogin } = await harness(undefined, 60_000, async () => {
      entered.resolve()
      await gate.promise
    })
    const pending = await service.prepare({ kind: 'codex', requestId })
    const configuration = service.configure(pending.operationId, { mode: 'cli' })
    const rejected = expect(configuration).rejects.toThrow('cancelled')
    expect(cancelLogin).toHaveBeenCalledWith(pending.instanceId)
    expect(service.canBeginLogin(pending.operationId, pending.instanceId)).toBe(false)
    await expect(service.complete(pending.operationId)).rejects.toThrow('configuration is changing')
    await entered.promise
    const discard = service.discard(pending.operationId)
    gate.resolve()
    await Promise.all([rejected, discard])
    expect(service.get(pending.operationId)).toMatchObject({ status: 'discarded', account: null })
  })

  it.each(accountKindSchema.options)('rejects unsupported %s method choices before store reads or login cancellation', async kind => {
    const { service, store, cancelLogin } = await harness()
    const read = vi.spyOn(store, 'readAccountFile')
    const unsupported = (['device', 'subscription', 'key', 'cli', 'reference'] as const).find(
      method => !AccountConnectionMethodModel.allowedMethods(kind).includes(method),
    )
    if (unsupported === undefined) throw new Error('Fixture needs an unsupported method')
    expect(() => service.prepare({ kind, requestId, mode: unsupported })).toThrow('does not support')
    expect(read).not.toHaveBeenCalled()
    expect(cancelLogin).not.toHaveBeenCalled()
  })

  it('never recreates an account removed during reconnect verification', async () => {
    const { service, store } = await harness()
    const candidate = await store.createSetupAccount({ kind: 'github-copilot', requestId: secondId })
    await store.upsertAccount(candidate.draft)
    const pending = await service.prepare({ kind: 'github-copilot', requestId, existingInstanceId: candidate.instanceId })
    await store.removeAccount(candidate.instanceId)
    await expect(service.complete(pending.operationId)).rejects.toThrow('no account was saved')
    expect((await store.readAccountFile()).accounts).toEqual([])
  })
})
