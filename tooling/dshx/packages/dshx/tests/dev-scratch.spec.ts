import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { chromium } from 'playwright'
import { runCli } from '../src/cli/run.js'
import { ScratchDriveRuntime } from '../src/scratch/drive.js'
import { StartupDialogs } from '../src/project/startup-dialogs.js'
import { ScratchReaperRuntime } from '../src/scratch/reaper.js'
import { installFakeSecretCli, NEW_THREAD_START_BUTTON_NAME, ScratchSeedRuntime } from '../src/scratch/seed.js'
import { DEFAULT_WARN_MINUTES, ScratchStateRuntime, type ScratchState } from '../src/scratch/state.js'

const run = async (argv: readonly string[]): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let out = ''
  let err = ''
  stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
  stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')))
  const code = await runCli(argv, { io: { stdin: new PassThrough(), stdout, stderr } })
  return { code, stdout: out, stderr: err }
}

const envelope = (stdout: string): { readonly ok: boolean; readonly command: string; readonly error?: { readonly code: string; readonly hint: string } } =>
  JSON.parse(stdout)

const alive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

// `up` sweeps every stale instance under the state root: keep this file's runs away from the real $TMPDIR/dshx-dev.
const isolatedStateRoot = mkdtempSync(join(tmpdir(), 'dshx-dev-spec-state-root-'))
process.env.DSHX_DEV_STATE_ROOT = isolatedStateRoot
afterAll(() => rmSync(isolatedStateRoot, { recursive: true, force: true }))

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** A real detached process whose command line carries `args`, like the dsh and Chromium groups `up` records. */
const startProcess = async (args: readonly string[]): Promise<number> => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', ...args], { detached: true, stdio: 'ignore' })
  await once(child, 'spawn')
  child.unref()
  const pid = child.pid
  if (pid === undefined) throw new Error('process did not start')
  cleanups.push(async () => {
    if (alive(pid)) process.kill(-pid, 'SIGKILL')
  })
  return pid
}

describe('dshx dev scratch commands', () => {
  it('lists the scratch actions and the plugin dev session when dev has no action', async () => {
    for (const flag of ['--help', '-h']) {
      const help = await run(['dev', flag])
      expect(help.code).toBe(0)
      for (const action of ['up', 'doctor', 'open', 'shot', 'keep', 'down']) expect(help.stdout).toMatch(new RegExp(`dshx dev ${action}\\b`))
      expect(help.stdout).toContain('dshx dev [--cwd <path>] [--port <port>] [--open]')
    }
  })

  it('matches native and ThreadSidebar start buttons by accessible name', () => {
    expect(NEW_THREAD_START_BUTTON_NAME.test('New thread')).toBe(true)
    expect(NEW_THREAD_START_BUTTON_NAME.test('New session')).toBe(true)
    expect(NEW_THREAD_START_BUTTON_NAME.test('New Session')).toBe(true)
    expect(NEW_THREAD_START_BUTTON_NAME.test('New session in sample')).toBe(false)
    expect(NEW_THREAD_START_BUTTON_NAME.test('Settings')).toBe(false)
  })

  it('attaches scratch fixtures through the composer file input', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`
        <input id="unrelated-file-input" type="file" />
        <div data-composer-card><input id="composer-file-input" type="file" multiple /></div>
      `)
      await ScratchDriveRuntime.composerFileInput(page).setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from('red') })
      const composerFiles = await ScratchDriveRuntime.composerFileInput(page).evaluate(element =>
        element instanceof HTMLInputElement ? Array.from(element.files ?? [], file => file.name) : [],
      )
      const unrelatedFileCount = await page
        .locator('#unrelated-file-input')
        .evaluate(element => (element instanceof HTMLInputElement ? (element.files?.length ?? 0) : 0))
      expect(composerFiles).toEqual(['red.png'])
      expect(unrelatedFileCount).toBe(0)
    } finally {
      await browser.close()
    }
  })

  it('opens AI Accounts through the sidebar or Settings, then selects fake routes', async () => {
    const modelId = 'dshx_fake_commandcode/gpt-6-luna'
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`
        <button aria-label="AI Accounts" onclick="document.querySelector('#accounts').hidden = false">AI Accounts</button>
        <aside id="accounts" role="complementary" aria-label="Provider accounts" hidden>Provider accounts</aside>
        <button aria-label="New session" onclick="const row = document.createElement('div'); row.setAttribute('role', 'treeitem'); row.textContent = 'New Session'; row.onclick = () => { document.querySelector('#composer').hidden = false }; document.body.append(row)"></button>
        <div id="composer" role="textbox" aria-label="Describe what you want to build, / commands, @ files or sessions" contenteditable="true" hidden></div>
        <button aria-label="Select model" onclick="document.querySelector('#models').hidden = false">Select model</button>
        <div id="models" role="menu" aria-label="Model" hidden><div role="menuitemradio" aria-label="${modelId}" aria-checked="false" onclick="this.setAttribute('aria-checked', 'true')">${modelId}</div></div>
      `)

      await ScratchSeedRuntime.openAIAccountsPanel(page, 1_000)
      expect(await page.locator('#accounts').isVisible()).toBe(true)
      const composer = await ScratchSeedRuntime.openSeedThreadComposer(page, 1_000)
      expect(await composer.isVisible()).toBe(true)
      await ScratchSeedRuntime.chooseFakeProviderModel({ page, timeoutMs: 1_000, modelId })
      expect(await page.getByRole('menuitemradio', { name: modelId, exact: true }).getAttribute('aria-checked')).toBe('true')

      await page.setContent(`
        <button aria-label="Account menu" onclick="document.querySelector('#menu').hidden = false">Account</button>
        <div id="menu" role="menu" hidden>
          <button role="menuitem" aria-label="Settings ⌘," onclick="document.querySelector('#settings').hidden = false">Settings</button>
        </div>
        <div id="settings" role="dialog" hidden>
          <button aria-label="AI Accounts" onclick="document.querySelector('#launch').hidden = false">AI Accounts</button>
        </div>
        <button id="launch" aria-label="Open AI Accounts" onclick="document.querySelector('#accounts').hidden = false" hidden>Open AI Accounts</button>
        <aside id="accounts" role="complementary" aria-label="Provider accounts" hidden>Provider accounts</aside>
      `)
      await ScratchSeedRuntime.openAIAccountsPanel(page, 1_000)
      expect(await page.getByRole('complementary', { name: 'Provider accounts', exact: true }).isVisible()).toBe(true)

      await page.setContent(`
        <button id="model-picker" aria-label="deepseek-flash, reasoning Default" onclick="document.querySelector('#models').showModal()">deepseek-flash</button>
        <dialog id="models" aria-label="Models">
          <button aria-label="${modelId}, reasoning Provider default">${modelId} · Provider default</button>
          <div role="list" aria-label="Models grouped by provider">
            <button id="route-option" onclick="this.dataset.selected = 'true'; document.querySelector('#model-picker').setAttribute('aria-label', '${modelId}, reasoning Provider default')">${modelId} gpt-6-luna</button>
          </div>
        </dialog>
      `)
      await ScratchSeedRuntime.chooseFakeProviderModel({ page, timeoutMs: 1_000, modelId })
      expect(await page.locator('#route-option').getAttribute('data-selected')).toBe('true')
      expect(await page.locator('#models').evaluate(element => element.hasAttribute('open'))).toBe(false)
      await page.setContent(`
        <button aria-label="New thread" onclick="setTimeout(() => { document.querySelector('#composer').hidden = false }, 50)">New thread</button>
        <div id="composer" role="textbox" aria-label="Describe what you want to build, / commands, @ files or sessions" contenteditable="true" hidden></div>
      `)
      const delayedComposer = await ScratchSeedRuntime.openSeedThreadComposer(page, 1_000)
      expect(await delayedComposer.isVisible()).toBe(true)
      await page.close()
    } finally {
      await browser.close()
    }
  })

  it('seeds Backlog Jev enabled idempotently through Settings', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`
        <button aria-label="Account menu" onclick="document.querySelector('#menu').hidden = false">Account</button>
        <div id="menu" role="menu" hidden>
          <button role="menuitem" aria-label="Settings" onclick="document.querySelector('#menu').hidden = true; document.querySelector('#settings').hidden = false">Settings</button>
        </div>
        <div id="settings" role="dialog" hidden>
          <input type="search" aria-label="Search settings">
          <button id="jev-enabled" role="switch" aria-label="Jev enabled" aria-checked="false" data-clicks="0" onclick="this.setAttribute('aria-checked', String(this.getAttribute('aria-checked') !== 'true')); this.dataset.clicks = String(Number(this.dataset.clicks) + 1)">Jev enabled</button>
        </div>
        <script>document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelector('#settings').hidden = true })</script>
      `)

      await ScratchSeedRuntime.seedBacklogJevEnabled(page, 1_000)
      await ScratchSeedRuntime.seedBacklogJevEnabled(page, 1_000)

      const jevEnabled = page.locator('#jev-enabled')
      expect(await jevEnabled.getAttribute('aria-checked')).toBe('true')
      expect(await jevEnabled.getAttribute('data-clicks')).toBe('1')
      expect(await page.locator('#settings').isVisible()).toBe(false)
    } finally {
      await browser.close()
    }
  })

  it('explains each action and names the fix for misuse', async () => {
    const help = await run(['dev', 'open', '--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('dshx dev open <feature>')
    expect(help.stdout).toContain('click <role|text|label|title>')
    expect(help.stdout).toContain('provider-setup dialogs')
    expect(help.stdout).toContain('quota-blocked-thread')
    expect(help.stdout).toContain('credential-recovery')

    const missingFeature = await run(['dev', 'open', '--json'])
    expect(missingFeature.code).toBe(2)
    expect(envelope(missingFeature.stdout).error).toMatchObject({ code: 'usage', hint: 'Run "dshx dev open --help".' })

    const misplaced = await run(['dev', 'doctor', '--dry-run'])
    expect(misplaced.code).toBe(2)
    expect(misplaced.stderr).toContain('--dry-run is not an option of dev doctor')
  })

  it('dismisses legacy and current provider setup dialogs on a scratch page', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      for (const dialog of [
        { name: 'Add an API key to get started', button: 'Configure later' },
        { name: 'Get started', button: 'Close' },
      ]) {
        const page = await browser.newPage()
        try {
          await page.setContent(
            `<div role="dialog" aria-label="${dialog.name}"><button aria-label="${dialog.button}" onclick="this.closest('[role=dialog]').remove()"></button></div>`,
          )
          expect(await StartupDialogs.dismissProviderSetupDuringStartup(page, 1_000)).toBe(true)
          expect(await page.getByRole('dialog').count()).toBe(0)
        } finally {
          await page.close()
        }
      }
    } finally {
      await browser.close()
    }
  })

  it('reports a missing instance with the command that starts one', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dshx-dev-spec-'))
    cleanups.push(() => rm(stateDir, { recursive: true, force: true }))
    const result = await run(['dev', 'doctor', '--state-dir', stateDir, '--name', 'probe', '--json'])
    expect(result.code).toBe(1)
    expect(envelope(result.stdout).error).toMatchObject({ code: 'not-up', hint: 'Run "dshx dev up --name probe" first.' })
  })

  it('refuses the live DSH port before building anything', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dshx-dev-spec-'))
    cleanups.push(() => rm(stateDir, { recursive: true, force: true }))
    const result = await run(['dev', 'up', '--port', '3080', '--state-dir', stateDir, '--json'])
    expect(result.code).toBe(1)
    expect(envelope(result.stdout).error?.code).toBe('live-port')
  })

  it('restores the Host entry a pending-restart seed changed, and only on a real down', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dshx-dev-spec-'))
    const home = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-'))
    cleanups.push(
      () => rm(stateDir, { recursive: true, force: true }),
      () => rm(home, { recursive: true, force: true }),
    )
    const hostEntry = join(stateDir, 'index.js')
    await writeFile(hostEntry, 'export default 1\n\n// dshx dev seed: pending restart\n')
    const state: ScratchState = {
      schemaVersion: 1,
      name: 'default',
      createdAt: new Date().toISOString(),
      stateDir,
      home,
      profile: 'dshx-boot',
      port: 45125,
      origin: 'http://127.0.0.1:45125',
      launchUrl: 'http://127.0.0.1:45125/?token=secret',
      bundles: ['@dshfiles/thread-sidebar'],
      expectedClientEntries: ['@dshfiles/thread-sidebar'],
      project: { path: join(home, 'projects/sample'), workspaceId: 'workspace', ownedByScratch: true },
      host: { pid: 999_999, signature: ['--profile dshx-boot', '--port 45125'] },
      browser: { pid: 999_998, signature: ['browser-host.js'], cdpPort: 45126 },
      hostLog: join(stateDir, 'host.log'),
      browserLog: join(stateDir, 'browser.log'),
      browserEvents: join(stateDir, 'browser-events.jsonl'),
      evidenceDir: join(stateDir, 'evidence'),
      seeds: [{ seed: 'pending-restart', changedFile: hostEntry }, { seed: 'rebase-ready-thread' }],
    }
    await writeFile(join(stateDir, 'state.json'), JSON.stringify(state), { mode: 0o600 })

    const dryRun = await run(['dev', 'down', '--dry-run', '--state-dir', stateDir])
    expect(dryRun.stdout).toContain(`would restore ${hostEntry}`)
    expect(await readFile(hostEntry, 'utf8')).toContain('dshx dev seed')

    const down = await run(['dev', 'down', '--state-dir', stateDir, '--json'])
    expect(down.code).toBe(0)
    expect(await readFile(hostEntry, 'utf8')).toBe('export default 1\n')
  })

  it('stops only the processes it started and removes the scratch home, after a dry run that changes nothing', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dshx-dev-spec-'))
    const home = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-'))
    cleanups.push(
      () => rm(stateDir, { recursive: true, force: true }),
      () => rm(home, { recursive: true, force: true }),
    )
    await mkdir(join(home, 'profiles'))
    const hostPid = await startProcess(['--profile', 'dshx-boot', '--port', '45123'])
    const unrelatedPid = await startProcess(['--unrelated'])
    const state: ScratchState = {
      schemaVersion: 1,
      name: 'default',
      createdAt: new Date().toISOString(),
      stateDir,
      home,
      profile: 'dshx-boot',
      port: 45123,
      origin: 'http://127.0.0.1:45123',
      launchUrl: 'http://127.0.0.1:45123/?token=secret',
      bundles: ['@dshfiles/home'],
      expectedClientEntries: ['@dshfiles/home'],
      project: { path: join(home, 'projects/sample'), workspaceId: 'workspace', ownedByScratch: true },
      host: { pid: hostPid, signature: ['--profile dshx-boot', '--port 45123'] },
      // The recorded browser pid now runs something else, as after pid reuse.
      browser: { pid: unrelatedPid, signature: ['browser-host.js'], cdpPort: 45124 },
      hostLog: join(stateDir, 'host.log'),
      browserLog: join(stateDir, 'browser.log'),
      browserEvents: join(stateDir, 'browser-events.jsonl'),
      evidenceDir: join(stateDir, 'evidence'),
    }
    await writeFile(join(stateDir, 'state.json'), JSON.stringify(state), { mode: 0o600 })

    const dryRun = await run(['dev', 'down', '--dry-run', '--state-dir', stateDir, '--json'])
    expect(dryRun.code).toBe(0)
    expect(dryRun.stdout).not.toContain('secret')
    expect(alive(hostPid)).toBe(true)
    expect((await stat(home)).isDirectory()).toBe(true)

    const down = await run(['dev', 'down', '--state-dir', stateDir, '--json'])
    expect(down.code).toBe(0)
    const actions: { readonly action: string; readonly target: string }[] = JSON.parse(down.stdout).data.actions
    expect(actions.find(item => item.target.startsWith('browser'))?.action).toBe('skip')
    expect(alive(hostPid)).toBe(false)
    expect(alive(unrelatedPid)).toBe(true)
    await expect(stat(home)).rejects.toThrow()
    await expect(stat(join(stateDir, 'state.json'))).rejects.toThrow()
  })

  for (const seed of ['tool-call-thread', 'credential-recovery'] as const) {
    it(`tracks and stops the fake model provider during ${seed} setup`, async () => {
      const stateDir = await mkdtemp(join(tmpdir(), 'dshx-dev-spec-'))
      const home = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-'))
      cleanups.push(
        () => rm(stateDir, { recursive: true, force: true }),
        () => rm(home, { recursive: true, force: true }),
      )
      const fakeProviderPid = await startProcess(['fake-provider-main.js', join(stateDir, 'fake-provider.ready')])
      const state: ScratchState = {
        schemaVersion: 1,
        name: 'default',
        createdAt: new Date().toISOString(),
        stateDir,
        home,
        profile: 'dshx-boot',
        port: 45127,
        origin: 'http://127.0.0.1:45127',
        launchUrl: 'http://127.0.0.1:45127/?token=secret',
        bundles: ['@dshfiles/tool-meta', '@dshfiles/ai-accounts'],
        expectedClientEntries: ['@dshfiles/tool-meta', '@dshfiles/ai-accounts'],
        project: { path: join(home, 'projects/sample'), workspaceId: 'workspace', ownedByScratch: true },
        host: { pid: 999_999, signature: ['--profile dshx-boot', '--port 45127'] },
        browser: { pid: 999_998, signature: ['browser-host.js'], cdpPort: 45128 },
        hostLog: join(stateDir, 'host.log'),
        browserLog: join(stateDir, 'browser.log'),
        browserEvents: join(stateDir, 'browser-events.jsonl'),
        evidenceDir: join(stateDir, 'evidence'),
      }
      await ScratchStateRuntime.write(state)
      await ScratchStateRuntime.trackFakeProvider(state, {
        pid: fakeProviderPid,
        signature: ['fake-provider-main.js', join(stateDir, 'fake-provider.ready')],
      })
      expect((await ScratchStateRuntime.read(stateDir, state.name)).fakeProvider?.pid).toBe(fakeProviderPid)

      const dryRun = await run(['dev', 'down', '--dry-run', '--state-dir', stateDir, '--json'])
      expect(dryRun.stdout).toContain(`fake model provider pid ${String(fakeProviderPid)}`)
      expect(alive(fakeProviderPid)).toBe(true)

      const down = await run(['dev', 'down', '--state-dir', stateDir, '--json'])
      expect(down.code).toBe(0)
      expect(alive(fakeProviderPid)).toBe(false)
    })
  }

  it('reuses the running fake model provider when a seed runs again', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dshx-dev-spec-'))
    const home = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-'))
    cleanups.push(
      () => rm(stateDir, { recursive: true, force: true }),
      () => rm(home, { recursive: true, force: true }),
    )
    const state: ScratchState = {
      schemaVersion: 1,
      name: 'default',
      createdAt: new Date().toISOString(),
      stateDir,
      home,
      profile: 'dshx-boot',
      port: 45129,
      origin: 'http://127.0.0.1:45129',
      launchUrl: 'http://127.0.0.1:45129/?token=secret',
      bundles: ['@dshfiles/ai-accounts'],
      expectedClientEntries: ['@dshfiles/ai-accounts'],
      project: { path: join(home, 'projects/sample'), workspaceId: 'workspace', ownedByScratch: true },
      host: { pid: 999_999, signature: ['--profile dshx-boot', '--port 45129'] },
      browser: { pid: 999_998, signature: ['browser-host.js'], cdpPort: 45130 },
      hostLog: join(stateDir, 'host.log'),
      browserLog: join(stateDir, 'browser.log'),
      browserEvents: join(stateDir, 'browser-events.jsonl'),
      evidenceDir: join(stateDir, 'evidence'),
    }
    await ScratchStateRuntime.write(state)
    const readyFile = join(stateDir, 'fake-provider.ready')
    const fakeProviderPid = await startProcess(['fake-provider-main.js', readyFile])
    await ScratchStateRuntime.trackFakeProvider(state, { pid: fakeProviderPid, signature: ['fake-provider-main.js', readyFile] })
    await writeFile(readyFile, 'http://127.0.0.1:45131\n')

    const again = await ScratchSeedRuntime.startFakeProvider(state, 10_000)
    expect(again.process.pid).toBe(fakeProviderPid)
    expect(again.baseUrl).toBe('http://127.0.0.1:45131')

    const down = await run(['dev', 'down', '--state-dir', stateDir, '--json'])
    expect(down.code).toBe(0)
    expect(alive(fakeProviderPid)).toBe(false)
  })

  it('installs a fake secret CLI that serves synthetic aliases scoped to the scratch project', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-'))
    cleanups.push(() => rm(home, { recursive: true, force: true }))
    await mkdir(join(home, 'projects', 'sample'), { recursive: true })
    const project = await realpath(join(home, 'projects', 'sample'))
    const bin = await installFakeSecretCli({ home, project })
    const secret = (args: readonly string[]): string => {
      const result = spawnSync(join(bin, 'secret'), args, { cwd: project, env: { PATH: process.env.PATH ?? '', HOME: home }, encoding: 'utf8' })
      expect(result.status).toBe(0)
      return result.stdout
    }
    const aliases = (output: string): readonly string[] => [...output.matchAll(/"alias":"(\w+)","scope":"(\w+)"/g)].map(match => `${match[1]}/${match[2]}`)
    expect(aliases(secret(['print', 'global', '--json']))).toEqual(['GITHUB_TOKEN/global'])
    expect(aliases(secret(['print', '--all', '--json']))).toEqual(['GITHUB_TOKEN/global', 'DB_PASSWORD/project', 'DB_PASSWORD/project', 'LOCAL_TOKEN/local'])
    expect(secret(['get', 'DB_PASSWORD', '--env', 'dev'])).toBe('scratch-fake-db-dev-value\n')
  })

  describe('auto-stop', () => {
    const watchdogScript = fileURLToPath(new URL('../dist/scratch/watchdog.js', import.meta.url))

    /** A recorded instance whose dsh is a real detached process (or a gone pid), with its own scratch home. */
    const recordInstance = async (options: {
      readonly root: string
      readonly name: string
      readonly port: number
      readonly hostRunning: boolean
      readonly idleTimeoutMinutes?: number
      readonly warnMinutes?: number
      readonly idleMinutes: number
      readonly watched?: boolean
    }): Promise<{ readonly state: ScratchState; readonly hostPid: number; readonly watchdogPid: number }> => {
      const stateDir = join(options.root, options.name)
      const home = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-'))
      cleanups.push(() => rm(home, { recursive: true, force: true }))
      const hostPid = options.hostRunning ? await startProcess(['--profile', 'dshx-boot', '--port', String(options.port)]) : 999_997
      const state: ScratchState = {
        schemaVersion: 1,
        name: options.name,
        createdAt: new Date().toISOString(),
        stateDir,
        home,
        profile: 'dshx-boot',
        port: options.port,
        origin: `http://127.0.0.1:${options.port}`,
        launchUrl: `http://127.0.0.1:${options.port}/?token=secret`,
        bundles: ['@dshfiles/home'],
        expectedClientEntries: ['@dshfiles/home'],
        project: { path: join(home, 'projects/sample'), workspaceId: 'workspace', ownedByScratch: true },
        host: { pid: hostPid, signature: ['--profile dshx-boot', `--port ${options.port}`] },
        browser: { pid: 999_998, signature: ['browser-host.js'], cdpPort: options.port + 1 },
        hostLog: join(stateDir, 'host.log'),
        browserLog: join(stateDir, 'browser.log'),
        browserEvents: join(stateDir, 'browser-events.jsonl'),
        evidenceDir: join(stateDir, 'evidence'),
      }
      if (options.idleTimeoutMinutes !== undefined) state.idleTimeoutMinutes = options.idleTimeoutMinutes
      if (options.warnMinutes !== undefined) state.warnMinutes = options.warnMinutes
      await ScratchStateRuntime.write(state)
      const watchdogPid = options.watched === true ? await startWatchdog(state) : 0
      const lastUsed = new Date(Date.now() - options.idleMinutes * 60_000)
      await utimes(join(stateDir, 'state.json'), lastUsed, lastUsed)
      return { state, hostPid, watchdogPid }
    }

    /** Started and recorded the way `up` does it; recording rewrites the state file, which renews the lease. */
    const startWatchdog = async (state: ScratchState): Promise<number> => {
      if (!existsSync(watchdogScript)) throw new Error(`${watchdogScript} is missing: build @dshfiles/dshx first`)
      const pid = ScratchStateRuntime.spawnDetached(process.execPath, [watchdogScript, '--state-dir', state.stateDir, '--interval-ms', '100'], {
        cwd: state.stateDir,
        env: process.env,
        log: join(state.stateDir, 'watchdog.log'),
      })
      cleanups.push(async () => {
        if (alive(pid)) process.kill(-pid, 'SIGKILL')
      })
      await ScratchStateRuntime.write({ ...state, watchdog: { pid, signature: [watchdogScript, state.stateDir] } })
      return pid
    }

    const stateRoot = async (): Promise<string> => {
      const root = await mkdtemp(join(tmpdir(), 'dshx-dev-spec-root-'))
      cleanups.push(() => rm(root, { recursive: true, force: true }))
      return root
    }

    it('sweeps instances past their warning grace or whose dsh exited, warns the ones just expired, and keeps the ones in use', async () => {
      const root = await stateRoot()
      const fresh = await recordInstance({ root, name: 'fresh', port: 45201, hostRunning: true, idleMinutes: 5 })
      const expired = await recordInstance({ root, name: 'expired', port: 45203, hostRunning: true, idleTimeoutMinutes: 10, warnMinutes: 0, idleMinutes: 11 })
      const legacy = await recordInstance({ root, name: 'legacy', port: 45205, hostRunning: true, warnMinutes: 0, idleMinutes: 31 })
      const forever = await recordInstance({ root, name: 'forever', port: 45207, hostRunning: true, idleTimeoutMinutes: 0, idleMinutes: 600 })
      const waiting = await recordInstance({ root, name: 'waiting', port: 45208, hostRunning: true, idleTimeoutMinutes: 10, idleMinutes: 11 })
      const dead = await recordInstance({ root, name: 'dead', port: 45209, hostRunning: false, idleMinutes: 1 })
      await mkdir(join(root, 'not-a-scratch'))

      const swept = await ScratchReaperRuntime.sweepStaleScratches({ root })
      expect(Object.fromEntries(swept.reaped.map(reaped => [reaped.name, reaped.reason]))).toEqual({
        expired: 'idle 11 min, past its 10 min idle timeout',
        legacy: 'idle 31 min, past its 30 min idle timeout',
        dead: 'dsh pid 999997 exited',
      })
      expect(swept.warned.map(entry => entry.name)).toEqual(['waiting'])
      expect(swept.warned[0]?.warning.minutesLeft).toBeGreaterThan(9.9)
      expect(alive(expired.hostPid)).toBe(false)
      expect(alive(legacy.hostPid)).toBe(false)
      expect(alive(fresh.hostPid)).toBe(true)
      expect(alive(forever.hostPid)).toBe(true)
      expect(alive(waiting.hostPid)).toBe(true)
      await expect(stat(dead.state.home)).rejects.toThrow()
      await expect(stat(join(dead.state.stateDir, 'state.json'))).rejects.toThrow()
      expect((await stat(join(fresh.state.stateDir, 'state.json'))).isFile()).toBe(true)
      const warnedState = await ScratchStateRuntime.read(waiting.state.stateDir, 'waiting')
      expect(warnedState.warnedAt).toBeDefined()
      expect(await readFile(join(waiting.state.stateDir, 'watchdog.log'), 'utf8')).toContain('warning for "waiting"')
    })

    it('renews the lease on every dshx dev command', async () => {
      const root = await stateRoot()
      const used = await recordInstance({ root, name: 'used', port: 45211, hostRunning: true, idleTimeoutMinutes: 10, idleMinutes: 11 })
      await run(['dev', 'doctor', '--state-dir', used.state.stateDir, '--json'])
      const swept = await ScratchReaperRuntime.sweepStaleScratches({ root })
      expect(swept.reaped).toEqual([])
      expect(swept.warned).toEqual([])
      expect(alive(used.hostPid)).toBe(true)
    })

    it('sweeps nothing when up refuses its options', async () => {
      const expired = await recordInstance({ root: isolatedStateRoot, name: 'expired-elsewhere', port: 45219, hostRunning: true, idleMinutes: 45 })
      const refused = await run(['dev', 'up', '--port', '3080', '--json'])
      expect(envelope(refused.stdout).error?.code).toBe('live-port')
      expect(alive(expired.hostPid)).toBe(true)
    })

    it('rejects a negative or fractional idle timeout or warning grace before building anything', async () => {
      const result = await run(['dev', 'up', '--idle-timeout', '1.5', '--json'])
      expect(result.code).toBe(2)
      expect(envelope(result.stdout).error?.code).toBe('usage')
      const grace = await run(['dev', 'up', '--warn-minutes', '1.5', '--json'])
      expect(grace.code).toBe(2)
      expect(envelope(grace.stdout).error?.code).toBe('usage')
      const help = (await run(['dev', 'up', '--help'])).stdout
      expect(help).toContain('--idle-timeout <min>')
      expect(help).toContain('--warn-minutes <min>')
      expect(help).toContain(`${DEFAULT_WARN_MINUTES}`)
    })

    it('runs down from the watchdog process once the lease expires with no warning grace', async () => {
      const root = await stateRoot()
      const instance = await recordInstance({
        root,
        name: 'forgotten',
        port: 45213,
        hostRunning: true,
        idleTimeoutMinutes: 1,
        warnMinutes: 0,
        idleMinutes: 2,
        watched: true,
      })
      const watchdogPid = instance.watchdogPid
      await vi.waitFor(() => expect(alive(watchdogPid)).toBe(false), { timeout: 15_000, interval: 100 })
      expect(alive(instance.hostPid)).toBe(false)
      await expect(stat(instance.state.home)).rejects.toThrow()
      await expect(stat(join(instance.state.stateDir, 'state.json'))).rejects.toThrow()
    })

    it('warns from the watchdog process, keeps the instance running through the grace, then stops it', async () => {
      const root = await stateRoot()
      // A spec-sized grace (3 s) so the real watchdog walks warning -> grace expiry instead of waiting 10 min.
      const instance = await recordInstance({
        root,
        name: 'warn-grace',
        port: 45221,
        hostRunning: true,
        idleTimeoutMinutes: 1,
        warnMinutes: 0.05,
        idleMinutes: 2,
        watched: true,
      })
      const { hostPid, watchdogPid, state } = instance
      const warningLog = () => readFile(join(state.stateDir, 'watchdog.log'), 'utf8')
      await vi.waitFor(async () => expect(await warningLog()).toContain('warning for "warn-grace"'), { timeout: 15_000, interval: 100 })
      expect(alive(hostPid)).toBe(true)
      expect(alive(watchdogPid)).toBe(true)
      expect((await ScratchStateRuntime.read(state.stateDir, 'warn-grace')).warnedAt).toBeDefined()
      await vi.waitFor(() => expect(alive(watchdogPid)).toBe(false), { timeout: 20_000, interval: 100 })
      expect(alive(hostPid)).toBe(false)
      await expect(stat(state.home)).rejects.toThrow()
    })

    it('lets a keep during the grace cancel the stop, clear the warning and renew the lease', async () => {
      const root = await stateRoot()
      const instance = await recordInstance({ root, name: 'kept', port: 45223, hostRunning: true, idleTimeoutMinutes: 10, idleMinutes: 11 })
      const warned = await ScratchReaperRuntime.sweepStaleScratches({ root })
      expect(warned.warned.map(entry => entry.name)).toEqual(['kept'])

      const doctor = await run(['dev', 'doctor', '--state-dir', instance.state.stateDir])
      expect(doctor.stdout).toContain('answered a pending warning')
      expect(doctor.stdout).toContain('dshx dev keep --name kept')
      expect(doctor.stdout).toContain('of its 10 min grace left')
      expect((await ScratchStateRuntime.read(instance.state.stateDir, 'kept')).warnedAt).toBeUndefined()

      const kept = await run(['dev', 'keep', '--state-dir', instance.state.stateDir, '--json'])
      expect(kept.code).toBe(0)
      expect(JSON.parse(kept.stdout).data.cancelledWarning).toBe(false)
      expect(await readFile(join(instance.state.stateDir, 'watchdog.log'), 'utf8')).toContain('keep cancelled the warning for "kept"')

      // Past the old grace, but the keep renewed the lease: the instance must still be here.
      const later = await ScratchReaperRuntime.sweepStaleScratches({ root, now: Date.now() + 11 * 60_000 })
      expect(later.reaped).toEqual([])
      expect(alive(instance.hostPid)).toBe(true)
    })

    it('pins an instance with keep --forever so no idle stop ever runs', async () => {
      const root = await stateRoot()
      const instance = await recordInstance({ root, name: 'pinned', port: 45225, hostRunning: true, idleTimeoutMinutes: 10, idleMinutes: 11 })
      await ScratchReaperRuntime.sweepStaleScratches({ root })
      const keep = await run(['dev', 'keep', '--state-dir', instance.state.stateDir, '--forever', '--json'])
      expect(keep.code).toBe(0)
      expect(JSON.parse(keep.stdout).data.cancelledWarning).toBe(true)
      expect(JSON.parse(keep.stdout).data.kept).toBe(true)
      const swept = await ScratchReaperRuntime.sweepStaleScratches({ root, now: Date.now() + 30 * 24 * 60 * 60_000 })
      expect(swept.reaped).toEqual([])
      expect(swept.warned).toEqual([])
      expect(alive(instance.hostPid)).toBe(true)
    })

    it('stops an instance once its warning grace ends with no keep', async () => {
      const root = await stateRoot()
      const now = Date.now()
      const instance = await recordInstance({ root, name: 'ignored', port: 45227, hostRunning: true, idleTimeoutMinutes: 10, idleMinutes: 11 })
      const warned = await ScratchReaperRuntime.sweepStaleScratches({ root, now })
      expect(warned.warned.map(entry => entry.name)).toEqual(['ignored'])
      const stopped = await ScratchReaperRuntime.sweepStaleScratches({ root, now: now + 11 * 60_000 })
      expect(stopped.reaped.map(entry => entry.name)).toEqual(['ignored'])
      expect(stopped.reaped[0]?.reason).toContain('no keep during its 10 min warning grace')
      expect(alive(instance.hostPid)).toBe(false)
      await expect(stat(instance.state.home)).rejects.toThrow()
    })

    it('cleans up from the watchdog process once dsh is gone', async () => {
      const root = await stateRoot()
      const instance = await recordInstance({ root, name: 'crashed', port: 45215, hostRunning: false, idleTimeoutMinutes: 30, idleMinutes: 0, watched: true })
      const watchdogPid = instance.watchdogPid
      await vi.waitFor(() => expect(alive(watchdogPid)).toBe(false), { timeout: 15_000, interval: 100 })
      await expect(stat(instance.state.home)).rejects.toThrow()
      await expect(stat(join(instance.state.stateDir, 'watchdog.log'))).rejects.toThrow()
    })

    it('keeps watching an instance in use, and down stops the watchdog first', async () => {
      const root = await stateRoot()
      const instance = await recordInstance({ root, name: 'busy', port: 45217, hostRunning: true, idleTimeoutMinutes: 30, idleMinutes: 0, watched: true })
      const watchdogPid = instance.watchdogPid
      const dryRun = await run(['dev', 'down', '--dry-run', '--state-dir', instance.state.stateDir])
      expect(dryRun.stdout).toContain(`would stop watchdog pid ${watchdogPid} (process group)`)
      expect(alive(watchdogPid)).toBe(true)
      expect(alive(instance.hostPid)).toBe(true)

      const down = await run(['dev', 'down', '--state-dir', instance.state.stateDir, '--json'])
      expect(down.code).toBe(0)
      expect(alive(watchdogPid)).toBe(false)
      expect(alive(instance.hostPid)).toBe(false)
    })
  })
})
