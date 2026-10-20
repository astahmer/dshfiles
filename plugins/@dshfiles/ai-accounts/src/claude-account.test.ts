import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeAccountService, createClaudeAccountService } from './claude-account.js'
import { CredentialModel } from './credentials.js'

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
    await expect(claudeAccountService.resolveInferenceToken(request)).rejects.toThrow('Claude Code is signed out on this machine')
    expect(await claudeAccountService.describeAuth(request)).toMatchObject({ signedIn: false, detail: expect.stringContaining('claude auth login') })
  })
})

describe('Claude usage reads', () => {
  it('serves one reading to every caller and backs off after a 429, showing the last reading', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'claude-usage-'))
    writeFileSync(
      join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-test', refreshToken: 'r', expiresAt: 9_999_999_999_999 } }),
    )
    let now = 1_000_000
    const answers: Response[] = []
    let requests = 0
    const service = createClaudeAccountService({
      readFile,
      readKeyFromEnv: CredentialModel.readKeyFromEnv,
      readKeychainSecret: async () => undefined,
      now: () => now,
      fetch: async () => {
        requests += 1
        const answer = answers.shift()
        if (answer === undefined) throw new Error('unexpected usage request')
        return answer
      },
    })
    const usage = new Response(JSON.stringify({ five_hour: { utilization: 31, resets_at: '2026-10-08T15:00:00Z' } }), { status: 200 })

    answers.push(usage)
    const first = await service.readUsage(configDir)
    await service.readUsage(configDir)
    expect(first.status).toBe('ok')
    expect(requests).toBe(1)

    now += 3 * 60_000
    answers.push(new Response('{}', { status: 429, headers: { 'retry-after': '60' } }))
    const limited = await service.readUsage(configDir)
    now += 30_000
    await service.readUsage(configDir)
    expect(requests).toBe(2)
    expect(limited).toMatchObject({ status: 'ok', windows: first.windows, message: expect.stringContaining('min ago') })

    now += 31_000
    answers.push(new Response('{}', { status: 500 }))
    await service.readUsage(configDir)
    expect(requests).toBe(3)
    rmSync(configDir, { recursive: true, force: true })
  })
})
