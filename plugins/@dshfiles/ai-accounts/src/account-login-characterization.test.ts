import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostApiClient } from '@dshfiles/dshx/host'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountsHostFixture, type AccountsHost } from './accounts-host.fixture.js'
import { accountLoginStateSchema, aiAccountsLoginApi } from './account-login-api.js'
import { createAccountLoginService } from './account-login-service.js'
import { createCodexLoginFiles } from './codex-login-files.js'
import { createCodexLoginRunner } from './codex-login-process.js'
import type { CodexHomeLayout } from './codex-home.js'

/**
 * Managed Codex sign-in against a real process tree: a `codex` script on PATH prints the official device prompt and
 * owns a grandchild, so cancellation proves the whole process group stops and the staging home outlives the process.
 */
const ACCOUNT = 'codex_work_0123456789abcdef0123456789abcdef'
const AUTH = JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'fixture-only-access', refresh_token: 'fixture-only-refresh' } })
const PROMPT = [
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '',
  '1. Open this link in your browser and sign in to your account',
  '   https://auth.openai.com/codex/device',
  '',
  '2. Enter this one-time code (expires in 15 minutes)',
  '   ABCD-EFGH',
  '',
  '',
].join('\n')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const scratch = async (): Promise<string> => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ai-accounts-login-')))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

/** A `codex` executable that prints the device prompt, keeps a grandchild, and on success writes a private auth file. */
const writeFakeCodex = async (input: { readonly reports: string; readonly finishWhen: string }): Promise<string> => {
  const bin = join(input.reports, 'bin')
  await mkdir(bin)
  const script = `#!/bin/sh
umask 077
sleep 300 &
echo $! > ${quote(join(input.reports, 'grandchild.pid'))}
trap 'sleep 0.3; if [ -d "$CODEX_HOME" ]; then echo present > ${quote(join(input.reports, 'home-at-exit'))}; else echo missing > ${quote(join(input.reports, 'home-at-exit'))}; fi; exit 143' TERM
printf '%s' ${quote(PROMPT)}
while [ ! -f ${quote(input.finishWhen)} ]; do sleep 0.05; done
printf '%s' ${quote(AUTH)} > "$CODEX_HOME/auth.json"
kill $! 2>/dev/null
exit 0
`
  await writeFile(join(bin, 'codex'), script)
  await chmod(join(bin, 'codex'), 0o755)
  return bin
}

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const eventually = async <Value>(read: () => Promise<Value>, accept: (value: Value) => boolean): Promise<Value> => {
  for (let attempt = 0; attempt < 800; attempt++) {
    const value = await read()
    if (accept(value)) return value
    await pause(25)
  }
  throw new Error('The expected state never arrived.')
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const stagingEntries = async (home: string): Promise<readonly string[]> => (await readdir(home)).filter(entry => entry.startsWith('.dsh-login-'))

describe('managed Codex sign-in through the login API', { timeout: 30_000 }, () => {
  const previousPath = process.env.PATH

  const startWithFakeCodex = async (account: string) => {
    const reports = await scratch()
    const finishWhen = join(reports, 'finish')
    const bin = await writeFakeCodex({ reports, finishWhen })
    process.env.PATH = `${bin}:${previousPath ?? ''}`
    cleanups.push(async () => {
      process.env.PATH = previousPath
    })
    const host: AccountsHost = await AccountsHostFixture.start({ accounts: [], codexAccounts: [account], distribution: 'sticky' })
    cleanups.push(() => host.dispose())
    const call = (method: 'begin' | 'status' | 'cancel', payload: Schema.Json) =>
      AccountsHostFixture.callApi({ host: host.host, apiId: 'ai-accounts-login', method, payload, output: accountLoginStateSchema })
    const state = async (method: 'begin' | 'status' | 'cancel', payload: Schema.Json) => {
      const result = await call(method, payload)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value.output
    }
    return { host, reports, finishWhen, state, home: AccountsHostFixture.managedCodexHome(account) }
  }

  it('shows the device code only to the browser client and adopts the credential once the CLI saved it', async () => {
    const account = 'codex_work_11111111111111111111111111111111'
    const login = await startWithFakeCodex(account)
    expect(await login.state('begin', { instanceId: account })).toMatchObject({ status: 'starting', errorCode: null, userCode: null })
    const waiting = await eventually(
      () => login.state('status', { instanceId: account }),
      value => value.status === 'waiting',
    )
    expect(waiting).toMatchObject({ verificationUri: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGH', errorCode: null })

    const pluginView = await createHostApiClient(login.host.host.ctx, aiAccountsLoginApi, '@acme/probe').status({ instanceId: account })
    expect(pluginView).toMatchObject({ status: 'waiting', verificationUri: null, userCode: null })
    expect(await readdir(login.home)).not.toContain('auth.json')
    expect(await stagingEntries(login.home)).toHaveLength(1)

    await writeFile(login.finishWhen, '')
    const complete = await eventually(
      () => login.state('status', { instanceId: account }),
      value => value.status === 'complete',
    )
    expect(complete).toMatchObject({ errorCode: null, userCode: null })
    expect(await readFile(join(login.home, 'auth.json'), 'utf8')).toBe(AUTH)
    await eventually(
      () => stagingEntries(login.home),
      entries => entries.length === 0,
    )
  })

  it('cancels the whole CLI process group and removes staging only after the CLI closed', async () => {
    const account = 'codex_work_22222222222222222222222222222222'
    const login = await startWithFakeCodex(account)
    await login.state('begin', { instanceId: account })
    await eventually(
      () => login.state('status', { instanceId: account }),
      value => value.status === 'waiting',
    )
    const grandchild = Number((await readFile(join(login.reports, 'grandchild.pid'), 'utf8')).trim())
    expect(isAlive(grandchild)).toBe(true)

    expect(await login.state('cancel', { instanceId: account, confirm: true })).toMatchObject({
      status: 'cancelled',
      message: 'Sign-in cancelled. The existing account login was not replaced.',
    })
    const homeAtExit = await eventually(
      () => readFile(join(login.reports, 'home-at-exit'), 'utf8').catch(() => ''),
      text => text !== '',
    )
    expect(homeAtExit.trim()).toBe('present')
    await eventually(
      async () => isAlive(grandchild),
      alive => !alive,
    )
    await eventually(
      () => stagingEntries(login.home),
      entries => entries.length === 0,
    )
    expect(await readdir(login.home)).not.toContain('auth.json')
  })
})

describe('managed Codex sign-in while a connection setup owns adoption', { timeout: 30_000 }, () => {
  it('keeps a successful CLI credential staged until the connection commits it', async () => {
    const reports = await scratch()
    const finishWhen = join(reports, 'finish')
    const bin = await writeFakeCodex({ reports, finishWhen })
    const homeRoot = join(reports, 'homes')
    await mkdir(homeRoot)
    const target: CodexHomeLayout = { mode: 'direct', sharedHomePath: join(homeRoot, ACCOUNT), effectiveHomePath: join(homeRoot, ACCOUNT) }
    const completed: string[] = []
    const service = createAccountLoginService({
      account: async instanceId => ({ instanceId, kind: 'codex', layout: target }),
      files: createCodexLoginFiles(path => path === target.sharedHomePath),
      run: createCodexLoginRunner(undefined, { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }),
      deferAdoption: () => true,
      onComplete: async instanceId => {
        completed.push(instanceId)
      },
    })
    cleanups.push(async () => {
      service.dispose()
      await service.settled()
    })
    await service.begin(ACCOUNT)
    await eventually(
      async () => service.state(ACCOUNT).status,
      status => status === 'waiting',
    )
    await writeFile(finishWhen, '')
    await service.settled()

    expect(service.state(ACCOUNT).status).toBe('complete')
    expect(completed).toEqual([ACCOUNT])
    expect(await readdir(target.effectiveHomePath)).not.toContain('auth.json')
    const staged = service.pendingHome(ACCOUNT)
    if (staged === undefined) throw new Error('The successful credential was not kept staged.')
    expect(await readFile(join(staged, 'auth.json'), 'utf8')).toBe(AUTH)

    await service.commitPending(ACCOUNT)
    expect(service.pendingHome(ACCOUNT)).toBeUndefined()
    expect(await readFile(join(target.effectiveHomePath, 'auth.json'), 'utf8')).toBe(AUTH)
    expect(await stagingEntries(target.effectiveHomePath)).toEqual([])
  })

  it('discards the staged credential on cancel without touching the target', async () => {
    const reports = await scratch()
    const finishWhen = join(reports, 'finish')
    await writeFile(finishWhen, '')
    const bin = await writeFakeCodex({ reports, finishWhen })
    const homeRoot = join(reports, 'homes')
    await mkdir(homeRoot)
    const target: CodexHomeLayout = { mode: 'direct', sharedHomePath: join(homeRoot, ACCOUNT), effectiveHomePath: join(homeRoot, ACCOUNT) }
    const service = createAccountLoginService({
      account: async instanceId => ({ instanceId, kind: 'codex', layout: target }),
      files: createCodexLoginFiles(path => path === target.sharedHomePath),
      run: createCodexLoginRunner(undefined, { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }),
      deferAdoption: () => true,
      onComplete: async () => undefined,
    })
    cleanups.push(async () => {
      service.dispose()
      await service.settled()
    })
    await service.begin(ACCOUNT)
    await service.settled()
    expect(service.pendingHome(ACCOUNT)).toBeDefined()

    expect(service.cancel(ACCOUNT)).toMatchObject({ status: 'cancelled', message: 'Sign-in cancelled. The existing account login was not replaced.' })
    await service.settledAccount(ACCOUNT)
    expect(service.pendingHome(ACCOUNT)).toBeUndefined()
    expect(await readdir(target.effectiveHomePath)).toEqual([])
  })
})
