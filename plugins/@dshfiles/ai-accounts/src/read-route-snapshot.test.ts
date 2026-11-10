import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountsHostFixture, type AccountsHost } from './accounts-host.fixture.js'
import { accountRuntime } from './account-runtime.js'
import { accountsFileSchema } from './api.js'

/**
 * `ai-accounts/read` refreshes the routes before answering. With an unchanged accounts file it must keep the snapshot it
 * applied instead of rebuilding the pool, profiles and login reconciliation on every read of every open page.
 */
const running: AccountsHost[] = []

afterEach(async () => {
  for (const host of running.splice(0)) await host.dispose()
})

const read = (host: AccountsHost) =>
  AccountsHostFixture.callApi({ host: host.host, apiId: 'ai-accounts', method: 'read', payload: undefined, output: accountsFileSchema })

describe('ai-accounts/read route refresh', () => {
  it('keeps the applied snapshot while the file is unchanged and rebuilds it once the file moves', async () => {
    const host = await AccountsHostFixture.start({ accounts: [{ id: 'cc_a' }, { id: 'cc_b' }, { id: 'cc_c' }], distribution: 'priority' })
    running.push(host)
    // The startup model-catalog refresh changes the inputs once it lands; wait until two reads keep one snapshot.
    let applied = accountRuntime(host.host.ctx)?.accounts
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await read(host)
      const current = accountRuntime(host.host.ctx)?.accounts
      if (current !== undefined && current === applied) break
      applied = current
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(applied).toBeDefined()

    const started = performance.now()
    const reads = 30
    for (let index = 0; index < reads; index += 1) await read(host)
    const perReadMs = (performance.now() - started) / reads
    console.info(`ai-accounts/read: ${perReadMs.toFixed(2)} ms per read over ${String(reads)} reads with an unchanged file`)
    expect(accountRuntime(host.host.ctx)?.accounts).toBe(applied)

    const path = join(process.env.DSH_HOME ?? '', 'plugins', 'ai-accounts', 'accounts.json')
    const stored = await readFile(path, 'utf8')
    expect(stored).toContain('"distribution":"priority"')
    await writeFile(path, stored.replace('"distribution":"priority"', '"distribution":"round-robin"'))
    await read(host)
    expect(accountRuntime(host.host.ctx)?.accounts).not.toBe(applied)
  })
})
