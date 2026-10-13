import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeClaudeAuth, resolveClaudeInferenceToken } from './claude-account.js'

describe('Claude Code login', () => {
  let configDir: string
  const login = (accessToken: string): void =>
    writeFileSync(join(configDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: accessToken, expiresAt: 0 } }))

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'claude-config-'))
  })
  afterEach(() => rmSync(configDir, { recursive: true, force: true }))

  it('tells a signed-out Claude Code apart from a missing login', async () => {
    login('')
    const request = { configDir, keyEnv: '', now: Date.now(), resolveCredential: async () => '' }
    await expect(resolveClaudeInferenceToken(request)).rejects.toThrow('Claude Code is signed out on this machine')
    expect(await describeClaudeAuth(request)).toMatchObject({ signedIn: false, detail: expect.stringContaining('claude auth login') })
  })
})
