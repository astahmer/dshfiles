import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.js'
import { installFakeSecretCli, NEW_THREAD_START_BUTTON_NAME } from '../src/scratch/seed.js'
import type { ScratchState } from '../src/scratch/state.js'

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
      for (const action of ['up', 'doctor', 'open', 'shot', 'down']) expect(help.stdout).toMatch(new RegExp(`dshx dev ${action}\\b`))
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

  it('explains each action and names the fix for misuse', async () => {
    const help = await run(['dev', 'open', '--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('dshx dev open <feature>')
    expect(help.stdout).toContain('click <role|text|label|title>')

    const missingFeature = await run(['dev', 'open', '--json'])
    expect(missingFeature.code).toBe(2)
    expect(envelope(missingFeature.stdout).error).toMatchObject({ code: 'usage', hint: 'Run "dshx dev open --help".' })

    const misplaced = await run(['dev', 'doctor', '--dry-run'])
    expect(misplaced.code).toBe(2)
    expect(misplaced.stderr).toContain('--dry-run is not an option of dev doctor')
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

  it('stops the fake model provider a tool-call-thread seed started', async () => {
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
      seeds: [{ seed: 'tool-call-thread' }],
      fakeProvider: { pid: fakeProviderPid, signature: ['fake-provider-main.js', join(stateDir, 'fake-provider.ready')] },
    }
    await writeFile(join(stateDir, 'state.json'), JSON.stringify(state), { mode: 0o600 })

    const dryRun = await run(['dev', 'down', '--dry-run', '--state-dir', stateDir, '--json'])
    expect(dryRun.stdout).toContain(`fake model provider pid ${String(fakeProviderPid)}`)
    expect(alive(fakeProviderPid)).toBe(true)

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
})
