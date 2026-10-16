import { mkdtemp, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CodexHomeError, CodexHomeModel, describeCodexAuth } from './codex-home.js'

const layoutFor = (homePath: string) => CodexHomeModel.resolveLayout({ homePath })

/** A Codex home must sit inside the user home, so the fixture lives there. */
const homeInUserHome = async (): Promise<string> => mkdtemp(join(homedir(), '.codex-home-test-'))

const idTokenWith = (claims: Record<string, unknown>): string =>
  `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`

const authJsonWith = (claims: Record<string, unknown>): string => JSON.stringify({ tokens: { access_token: 'token', id_token: idTokenWith(claims) } })

describe('resolveCodexHomeLayout', () => {
  it('resolves homes inside the user home', () => {
    expect(CodexHomeModel.resolveLayout({ homePath: '~/.codex', shadowHomePath: '~/.codex-dshx/work' })).toEqual({
      mode: 'authOverlay',
      sharedHomePath: join(homedir(), '.codex'),
      effectiveHomePath: join(homedir(), '.codex-dshx', 'work'),
    })
  })

  it.each(['/etc', '~/../../etc', homedir(), `${homedir()}-sibling/.codex`])('refuses %s', homePath => {
    expect(() => CodexHomeModel.resolveLayout({ homePath })).toThrow(CodexHomeError)
    expect(() => CodexHomeModel.resolveLayout({ shadowHomePath: homePath })).toThrow(CodexHomeError)
  })

  it('keeps the real account home when an isolated host overrides HOME', () => {
    const accountHome = homedir()
    vi.stubEnv('HOME', '/tmp/isolated-dsh-home')
    try {
      expect(CodexHomeModel.resolveLayout({ homePath: join(accountHome, '.codex'), shadowHomePath: '~/.codex-dshx/work' })).toEqual({
        mode: 'authOverlay',
        sharedHomePath: join(accountHome, '.codex'),
        effectiveHomePath: join(accountHome, '.codex-dshx', 'work'),
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('describeCodexAuth', () => {
  it('reports the signed-in email', async () => {
    const home = await homeInUserHome()
    await writeFile(
      join(home, 'auth.json'),
      authJsonWith({
        'https://api.openai.com/profile': { email: 'person@example.com' },
      }),
    )
    const view = await describeCodexAuth(layoutFor(home))
    expect(view.signedIn).toBe(true)
    expect(view.identity).toBe('person@example.com')
  })

  it('never reports an internal account id as the identity', async () => {
    const home = await homeInUserHome()
    await writeFile(
      join(home, 'auth.json'),
      authJsonWith({
        'https://api.openai.com/auth': {
          chatgpt_account_id: '09b65132-578c-4e25-858f-1507116bd1b',
          user_id: 'user-abcdefgh1234',
          chatgpt_plan_type: 'plus',
        },
      }),
    )
    const view = await describeCodexAuth(layoutFor(home))
    expect(view.signedIn).toBe(true)
    expect(view.plan).toBe('plus')
    expect(view.identity).toBe('ChatGPT plus ·1234')
    expect(view.identity).not.toContain('09b65132')
  })

  it('has no identity when the id token identifies nothing', async () => {
    const home = await homeInUserHome()
    await writeFile(join(home, 'auth.json'), authJsonWith({}))
    const view = await describeCodexAuth(layoutFor(home))
    expect(view.signedIn).toBe(true)
    expect(view.identity).toBeUndefined()
  })
})
