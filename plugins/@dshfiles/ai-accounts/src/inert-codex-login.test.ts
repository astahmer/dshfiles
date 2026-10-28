import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { readCodexAccessToken } from './read-codex-token.js'
import { readCodexUsage } from './usage.js'
import { seedInertCodexLogin } from './inert-codex-login.fixture.js'

it('satisfies only credential presence in a private home and refuses quota before any network access', async () => {
  const home = await mkdtemp(join(tmpdir(), 'inert-codex-e2e-'))
  const instanceId = 'codex_work_11111111111141118111111111111111'
  const target = join(home, 'plugins/ai-accounts/homes', instanceId)
  const draft = {
    ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
    instanceId,
    homePath: target,
    shadowHomePath: target,
    displayName: 'Codex 1',
    enabled: false,
  }
  const fetch = vi.fn(() => {
    throw new Error('Provider network is forbidden in this fixture.')
  })
  vi.stubGlobal('fetch', fetch)
  try {
    await mkdir(join(home, 'plugins/ai-accounts'), { recursive: true })
    await writeFile(join(home, 'plugins/ai-accounts/accounts.json'), JSON.stringify({ accounts: [draft] }))
    await seedInertCodexLogin(home, 'Codex 1')
    expect(await readCodexAccessToken(target)).toBe('inert-e2e-access')
    expect(await readCodexUsage(target)).toMatchObject({ status: 'error', message: 'The Codex account identifier was not found in its sign-in data.' })
    expect(fetch).not.toHaveBeenCalled()
    expect((await stat(join(target, 'auth.json'))).mode & 0o777).toBe(0o600)
    const before = await readFile(join(target, 'auth.json'), 'utf8')
    await expect(seedInertCodexLogin(home, 'Codex 1')).rejects.toThrow()
    expect(await readFile(join(target, 'auth.json'), 'utf8')).toBe(before)
  } finally {
    vi.unstubAllGlobals()
    await rm(home, { recursive: true, force: true })
  }
})
