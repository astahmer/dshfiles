import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountCredentialHomeWork } from './account-credential-home-work.js'
import { materializeCodexShadowHome, type CodexHomeLayout } from './codex-home.js'
import { createAccountSessionService } from './account-session-service.js'
import { AccountDraftModel } from './account-draft.js'

const deferred = <Value>() => {
  let complete = (_value: Value): void => {
    throw new Error('Uninitialized synthetic gate')
  }
  const promise = new Promise<Value>(resolve => {
    complete = resolve
  })
  return { promise, complete }
}
let root = ''
let layout: CodexHomeLayout
beforeEach(async () => {
  root = await mkdtemp(join(userInfo().homedir, '.dsh-credential-home-work-test-'))
  layout = { mode: 'authOverlay', sharedHomePath: join(root, 'shared'), effectiveHomePath: join(root, 'private') }
  await mkdir(layout.sharedHomePath)
  await mkdir(layout.effectiveHomePath)
  await writeFile(join(layout.sharedHomePath, 'auth.json'), 'synthetic-shared-source', { mode: 0o600 })
})
afterEach(async () => {
  if (resolve(root) !== root || !root.startsWith(join(userInfo().homedir, '.dsh-credential-home-work-test-')))
    throw new Error('Unexpected fixture cleanup target')
  await rm(root, { recursive: true, force: true })
})
describe('canonical credential-home exclusion', () => {
  it('serializes concurrent ordinary materialization instead of failing restored chats', async () => {
    const results = await Promise.allSettled([materializeCodexShadowHome(layout), materializeCodexShadowHome(layout)])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await readFile(join(layout.effectiveHomePath, 'auth.json'), 'utf8')).toBe('synthetic-shared-source')
  })
  it('queues ordinary credential refresh behind an existing refresh and reads the newly persisted token', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    const auth = join(layout.effectiveHomePath, 'auth.json')
    await writeFile(auth, 'synthetic-old')
    const first = AccountCredentialHomeWork.update(layout.effectiveHomePath, {
      read: () => readFile(auth, 'utf8'),
      mutate: async () => {
        started.complete()
        await finish.promise
        return 'synthetic-new'
      },
      persist: next => writeFile(auth, next),
    })
    await started.promise
    const second = AccountCredentialHomeWork.update(layout.effectiveHomePath, {
      read: () => readFile(auth, 'utf8'),
      mutate: async current => current,
      persist: async () => undefined,
    })
    const result = Promise.allSettled([first, second])
    try {
      await expect(AccountCredentialHomeWork.run(layout.effectiveHomePath, async () => undefined)).rejects.toThrow('already in use')
    } finally {
      finish.complete()
    }
    expect(await result).toEqual([
      { status: 'fulfilled', value: 'synthetic-new' },
      { status: 'fulfilled', value: 'synthetic-new' },
    ])
  })
  it('removes aborted and timed-out waiters without cancelling the active owner or poisoning later normal access', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    const owner = AccountCredentialHomeWork.access(layout.effectiveHomePath, async () => {
      started.complete()
      await finish.promise
      return 'active-completed'
    })
    await started.promise
    const controller = new AbortController()
    const cancelledWork = vi.fn(async () => 'should-not-run')
    const cancelled = AccountCredentialHomeWork.access(layout.effectiveHomePath, cancelledWork, { signal: controller.signal })
    const cancellation = expect(cancelled).rejects.toThrow('cancelled')
    controller.abort()
    await cancellation
    const timedOutWork = vi.fn(async () => 'should-not-run')
    await expect(AccountCredentialHomeWork.access(layout.effectiveHomePath, timedOutWork, { timeoutMs: 1 })).rejects.toThrow('timed out')
    expect(await AccountCredentialHomeWork.isBusy(layout.effectiveHomePath)).toBe(true)
    expect(cancelledWork).not.toHaveBeenCalled()
    expect(timedOutWork).not.toHaveBeenCalled()
    finish.complete()
    expect(await owner).toBe('active-completed')
    expect(await AccountCredentialHomeWork.access(layout.effectiveHomePath, async () => 'next')).toBe('next')
  })
  it('runs queued normal work after an owner fails, in FIFO order, without leaking inherited stale ownership', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    const order: string[] = []
    const first = AccountCredentialHomeWork.access(layout.effectiveHomePath, async () => {
      started.complete()
      await finish.promise
      throw new Error('synthetic-owner-failure')
    })
    const failed = expect(first).rejects.toThrow('synthetic-owner-failure')
    await started.promise
    const one = AccountCredentialHomeWork.access(layout.effectiveHomePath, async () => {
      order.push('one')
      return 'one'
    })
    const two = AccountCredentialHomeWork.access(layout.effectiveHomePath, async () => {
      order.push('two')
      return 'two'
    })
    finish.complete()
    await failed
    expect(await Promise.all([one, two])).toEqual(['one', 'two'])
    expect(order).toEqual(['one', 'two'])
    expect(await AccountCredentialHomeWork.isBusy(layout.effectiveHomePath)).toBe(false)
  })
  it('does not transfer a releasing caller’s other-home authority into queued work', async () => {
    const inner = join(root, 'inner')
    const started = deferred<void>()
    const releaseInner = deferred<void>()
    const releaseOuter = deferred<void>()
    const owner = AccountCredentialHomeWork.run(layout.effectiveHomePath, async () => {
      await AccountCredentialHomeWork.access(inner, async () => {
        started.complete()
        await releaseInner.promise
      })
      await releaseOuter.promise
    })
    await started.promise
    const queued = AccountCredentialHomeWork.access(inner, async () => {
      await expect(AccountCredentialHomeWork.access(layout.effectiveHomePath, async () => 'unsafe')).rejects.toThrow('already in use')
      return 'separate-authority'
    })
    try {
      releaseInner.complete()
      expect(await queued).toBe('separate-authority')
    } finally {
      releaseOuter.complete()
      await owner
    }
  })
  it('blocks every real materializer and an alias during logout removal, then keeps the verified unsigned tombstone', async () => {
    const auth = join(layout.effectiveHomePath, 'auth.json')
    await writeFile(auth, JSON.stringify({ tokens: { access_token: 'synthetic', refresh_token: 'synthetic' } }), { mode: 0o600 })
    const alias = join(root, 'alias')
    await symlink(layout.effectiveHomePath, alias)
    const removed = deferred<void>()
    const finish = deferred<void>()
    const account = {
      ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
      instanceId: 'synthetic',
      homePath: layout.sharedHomePath,
      shadowHomePath: layout.effectiveHomePath,
    }
    const service = createAccountSessionService({
      readAccounts: async () => ({ distribution: 'sticky', cooldownMs: 0, shadowRoot: root, accounts: [account] }),
      credentials: undefined,
      copilot: {
        writable: async () => false,
        signOut: async () => {
          throw new Error('Unexpected Copilot call')
        },
      },
      isBusy: () => false,
      onSignedOut: async () => undefined,
      executableAvailable: async () => true,
      run: async () => {
        if (!auth.startsWith(`${root}/`)) throw new Error('Unexpected synthetic credential path')
        await unlink(auth)
        removed.complete()
        await finish.promise
        return 0
      },
    })
    const signOut = service.signOut({ instanceId: 'synthetic', confirm: true })
    await removed.promise
    try {
      await expect(materializeCodexShadowHome(layout)).rejects.toThrow('already in use')
      await expect(materializeCodexShadowHome({ ...layout, effectiveHomePath: alias })).rejects.toThrow('already in use')
      await expect(readFile(auth, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      const other = { ...layout, effectiveHomePath: join(root, 'other') }
      await materializeCodexShadowHome(other)
      expect(await readFile(join(other.effectiveHomePath, 'auth.json'), 'utf8')).toBe('synthetic-shared-source')
    } finally {
      finish.complete()
      await signOut
    }
    expect(await readFile(auth, 'utf8')).toBe('{}\n')
    await materializeCodexShadowHome(layout)
    expect(await readFile(auth, 'utf8')).toBe('{}\n')
    expect(await readFile(join(layout.sharedHomePath, 'auth.json'), 'utf8')).toBe('synthetic-shared-source')
  })
  it('holds read/mutate/persist as one refresh owner, refuses sign-out without cancelling the refresh and permits nested materialization', async () => {
    const started = deferred<void>()
    const finish = deferred<void>()
    const sequence: string[] = []
    const persist = vi.fn(async (next: string) => {
      sequence.push('persist')
      await writeFile(join(layout.effectiveHomePath, 'auth.json'), next)
    })
    const refresh = AccountCredentialHomeWork.update(layout.effectiveHomePath, {
      read: async () => {
        sequence.push('read')
        await materializeCodexShadowHome(layout)
        return 'synthetic-old'
      },
      mutate: async current => {
        expect(current).toBe('synthetic-old')
        sequence.push('mutate')
        started.complete()
        await finish.promise
        return 'synthetic-refreshed'
      },
      persist,
    })
    await started.promise
    expect(await AccountCredentialHomeWork.isBusy(layout.effectiveHomePath)).toBe(true)
    const logout = vi.fn(async () => undefined)
    await expect(AccountCredentialHomeWork.run(layout.effectiveHomePath, logout)).rejects.toThrow('already in use')
    expect(logout).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    finish.complete()
    expect(await refresh).toBe('synthetic-refreshed')
    expect(sequence).toEqual(['read', 'mutate', 'persist'])
    await AccountCredentialHomeWork.run(layout.effectiveHomePath, async () => {
      await writeFile(join(layout.effectiveHomePath, 'auth.json'), '{}\n')
    })
    expect(await readFile(join(layout.effectiveHomePath, 'auth.json'), 'utf8')).toBe('{}\n')
    expect(persist).toHaveBeenCalledOnce()
  })
})
