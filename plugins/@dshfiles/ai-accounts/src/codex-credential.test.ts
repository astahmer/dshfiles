import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { persistCodexOAuthCredential, readCodexOAuthCredential } from './codex-credential.js'

interface CodexAccessClaims {
  readonly exp?: number
  readonly 'https://api.openai.com/auth'?: { readonly chatgpt_account_id: string }
}

const jwt = (claims: CodexAccessClaims): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${header}.${payload}.`
}

const containers: string[] = []
const scratchHome = async (auth: unknown): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), 'codex-credential-'))
  containers.push(home)
  await writeFile(join(home, 'auth.json'), JSON.stringify(auth), 'utf8')
  return home
}

afterAll(async () => {
  await Promise.all(containers.map(home => rm(home, { recursive: true, force: true })))
})

describe('readCodexOAuthCredential', () => {
  it('builds a pi-ai OAuth record from the account login', async () => {
    const home = await scratchHome({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: jwt({ exp: 1900000000, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } }),
        refresh_token: 'refresh-1',
      },
    })
    const credential = await readCodexOAuthCredential(home)
    expect(credential).toEqual({
      type: 'oauth',
      access: expect.stringContaining('.'),
      refresh: 'refresh-1',
      expires: 1_900_000_000_000,
      accountId: 'acct-1',
      persist: false,
    })
  })

  it('signs an undated login so pi-ai refreshes before serving', async () => {
    const home = await scratchHome({ tokens: { access_token: 'not-a-jwt', refresh_token: 'r' } })
    const credential = await readCodexOAuthCredential(home)
    expect(credential?.expires).toBe(0)
  })

  it('reports a missing token pair instead of returning a partial record', async () => {
    const home = await scratchHome({ tokens: { access_token: jwt({}) } })
    await expect(readCodexOAuthCredential(home)).rejects.toThrow(/token pair/)
  })

  it('rejects a home without a login', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codex-credential-empty-'))
    containers.push(home)
    await expect(readCodexOAuthCredential(home)).rejects.toThrow(/No readable Codex login/)
  })
})

describe('persistCodexOAuthCredential', () => {
  it('writes rotated tokens back and preserves the rest of the login', async () => {
    const home = await scratchHome({
      auth_mode: 'chatgpt',
      last_refresh: 'old',
      tokens: { access_token: 'old-access', refresh_token: 'old-refresh', id_token: 'id-1' },
      chatgpt_plan_type: 'plus',
    })
    await persistCodexOAuthCredential(home, { type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 0 })
    const saved = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'))
    expect(saved.tokens.access_token).toBe('new-access')
    expect(saved.tokens.refresh_token).toBe('new-refresh')
    expect(saved.tokens.id_token).toBe('id-1')
    expect(saved.auth_mode).toBe('chatgpt')
    expect(saved.chatgpt_plan_type).toBe('plus')
    expect(saved.last_refresh).not.toBe('old')
  })

  it('keeps an unreadable or invalid login untouched', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codex-credential-bad-'))
    containers.push(home)
    await writeFile(join(home, 'auth.json'), 'not json', 'utf8')
    await persistCodexOAuthCredential(home, { type: 'oauth', access: 'a', refresh: 'r', expires: 0 })
    await expect(readFile(join(home, 'auth.json'), 'utf8')).resolves.toBe('not json')
  })
})
