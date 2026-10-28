import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createUsageCache } from './account-usage.js'
import { createClaudeAccountService } from './claude-account.js'

const deferred = <Value>() => {
  let complete = (_value: Value): void => {
    throw new Error('Uninitialized synthetic gate')
  }
  const promise = new Promise<Value>(resolve => {
    complete = resolve
  })
  return { promise, complete }
}
describe('sign-out cache invalidation', () => {
  it('detaches a pre-sign-out sweep and never lets its late result repopulate the cache', async () => {
    const old = deferred<string>()
    const read = vi.fn<() => Promise<string>>().mockReturnValueOnce(old.promise).mockResolvedValue('signed-out')
    const cache = createUsageCache({ ttlMs: 30_000, read })
    const before = cache.get()
    cache.invalidate()
    expect(await cache.get()).toBe('signed-out')
    old.complete('old-authenticated-quota')
    expect(await before).toBe('old-authenticated-quota')
    expect(cache.latest()).toBe('signed-out')
    expect(await cache.get()).toBe('signed-out')
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('invalidates only the selected Claude directory and ignores its pre-logout in-flight quota', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-cache-test-'))
    if (resolve(root) !== root || !root.startsWith(join(tmpdir(), 'dsh-session-cache-test-'))) throw new Error('Unexpected synthetic fixture cleanup target')
    const home = join(root, 'selected')
    const other = join(root, 'other')
    await mkdir(home)
    await mkdir(other)
    const fakeLogin = JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-not-real', expiresAt: 9_999_999_999_999 } })
    await writeFile(join(home, '.credentials.json'), fakeLogin)
    await writeFile(join(other, '.credentials.json'), fakeLogin)
    const old = deferred<Response>()
    const started = deferred<void>()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => {
        started.complete()
        return old.promise
      })
      .mockResolvedValue(new Response(JSON.stringify({ five_hour: { utilization: 25 } })))
    const service = createClaudeAccountService({ readFile, readKeyFromEnv: () => '', readKeychainSecret: async () => undefined, now: () => 1000, fetch })
    try {
      const before = service.readUsage(home)
      await started.promise
      const otherCard = await service.readUsage(other)
      service.invalidateUsage(home)
      await writeFile(join(home, '.credentials.json'), '{}')
      expect((await service.readUsage(home)).status).toBe('unauthenticated')
      old.complete(new Response(JSON.stringify({ five_hour: { utilization: 10 } })))
      expect((await before).status).toBe('ok')
      expect((await service.readUsage(home)).status).toBe('unauthenticated')
      expect(await service.readUsage(other)).toBe(otherCard)
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
