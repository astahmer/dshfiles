import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { accountDraftSchema } from './api.js'

const storedAccounts = z.object({ accounts: z.array(accountDraftSchema) })

/** Satisfy the installed adapter's credential-presence gate, never OAuth or inference.
 * No account_id/id_token: quota refuses locally before any provider fetch.
 */
export const seedInertCodexLogin = async (homeRoot: string, displayName: string): Promise<void> => {
  const home = await realpath(homeRoot)
  const underTemp = relative(await realpath(tmpdir()), home)
  if (underTemp === '' || underTemp.startsWith('..') || isAbsolute(underTemp)) throw new Error('Inert login requires an isolated temporary home.')
  const file = storedAccounts.parse(JSON.parse(await readFile(join(home, 'plugins/ai-accounts/accounts.json'), 'utf8')))
  const account = file.accounts.find(candidate => candidate.kind === 'codex' && candidate.displayName === displayName)
  if (account === undefined || !/^codex_work_[a-f0-9]{32}$/u.test(account.instanceId)) throw new Error('Expected a generated private Codex fixture account.')
  const expected = join(home, 'plugins/ai-accounts/homes', account.instanceId)
  if (account.homePath !== expected || account.shadowHomePath !== expected) throw new Error('Inert login must stay in its generated private home.')
  await mkdir(expected, { recursive: true, mode: 0o700 })
  await writeFile(
    join(expected, 'auth.json'),
    JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'inert-e2e-access', refresh_token: 'inert-e2e-refresh' } }),
    { flag: 'wx', mode: 0o600 },
  )
}
