import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli/run.js'
import type { CliIO, CliRuntime } from '../src/cli/run.js'
import { PROTOCOL_2_COMPATIBILITY } from '../src/compat/protocol-2.js'
import type { ResolvedDshxConfig } from '../src/config/types.js'
import { checkPluginBoot, findAnnouncedUrl, parseBootFailures } from '../src/project/boot-check.js'
import type { BootCheckResult } from '../src/project/boot-check.js'
import type { ClientBootCheckResult } from '../src/project/client-boot-check.js'

const inactiveWarning = [
  'dsh: warning: 2 entries did not activate',
  'dshfiles-shortcuts (@dshfiles/shortcuts): apply: Cannot read properties of undefined (reading register)',
  'dshfiles-queue (@dshfiles/queue-reorder): pending (waiting for service: sessionController)',
].join('\n')

describe('boot output parsing', () => {
  it('keeps the inactive-entry summary and every row under it, including pending rows', () => {
    const output = ['Booting web profile', inactiveWarning, '', 'listening on http://127.0.0.1:4100/?token=abc', 'ready'].join('\n')
    expect(parseBootFailures({ output })).toEqual(inactiveWarning.split('\n'))
  })

  it('stops collecting rows at the first line that is not an entry row', () => {
    const output = [inactiveWarning, 'ordinary chatter (not a row)', 'other (pkg): looks like a row but follows chatter'].join('\n')
    expect(parseBootFailures({ output })).toEqual(inactiveWarning.split('\n'))
  })

  it('reports the startup-failure summary and marker lines outside any inactive block', () => {
    const output = [
      'dsh: startup failed: 1 required plugin did not activate',
      '',
      'Failed plugins (1):',
      '  dshfiles-shortcuts (required)',
      '    Error [ERR_MODULE_NOT_FOUND]: Cannot find module "@deepseek-ai/cordis"',
    ].join('\n')
    expect(parseBootFailures({ output })).toEqual([
      'dsh: startup failed: 1 required plugin did not activate',
      'Failed plugins (1):',
      'Error [ERR_MODULE_NOT_FOUND]: Cannot find module "@deepseek-ai/cordis"',
    ])
  })

  it('returns no failures for a clean boot', () => {
    expect(parseBootFailures({ output: 'Booting web profile\nhttp://127.0.0.1:4100/?token=abc\n' })).toEqual([])
    expect(parseBootFailures({ output: '' })).toEqual([])
  })

  it('finds the first tokenized loopback URL the Host announces', () => {
    expect(findAnnouncedUrl({ output: 'open http://127.0.0.1:4100/?token=abc now\nhttp://127.0.0.1:4200/' })).toBe('http://127.0.0.1:4100/?token=abc')
    expect(findAnnouncedUrl({ output: 'listening on http://localhost:4100/' })).toBeUndefined()
  })
})

const scratchRoots: string[] = []

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const fakeDsh = async ({ body }: { readonly body: string }): Promise<{ readonly executable: string; readonly root: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-fake-dsh-'))
  scratchRoots.push(root)
  const executable = join(root, 'dsh')
  await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$*" > "${root}/argv"\nprintf '%s\\n' "$DSHX_BOOT_PROFILE_ROOT" > "${root}/profile-root"\n${body}\n`)
  await chmod(executable, 0o755)
  return { executable, root }
}

describe('checkPluginBoot', () => {
  it('reports inactive entries a started Host printed and removes its throwaway profile', async () => {
    const fake = await fakeDsh({ body: `printf '%s\\n' 'http://127.0.0.1:4100/?token=abc' '${inactiveWarning.split('\n').join("' '")}'\nexec sleep 30` })
    const result = await checkPluginBoot({ projectRoot: fake.root, profile: 'dshx-boot', port: 4100, executable: fake.executable, timeoutMs: 5_000 })

    expect(result).toEqual({
      ok: false,
      timedOut: false,
      unsupportedNode: false,
      url: 'http://127.0.0.1:4100/?token=abc',
      failures: inactiveWarning.split('\n'),
    })
    expect((await readFile(join(fake.root, 'argv'), 'utf8')).trim()).toBe('--profile dshx-boot --port 4100 --no-open')
    const profileRoot = (await readFile(join(fake.root, 'profile-root'), 'utf8')).trim()
    expect(profileRoot).not.toBe('')
    await expect(access(profileRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stops the Host the shim started, not only the shim', async () => {
    const fake = await fakeDsh({
      body: `sleep 30 &\nprintf '%s\\n' "$!" > "$(dirname "$0")/host-pid"\nprintf '%s\\n' 'http://127.0.0.1:4100/?token=abc'\nwait`,
    })
    const result = await checkPluginBoot({ projectRoot: fake.root, profile: 'dshx-boot', port: 4100, executable: fake.executable, timeoutMs: 5_000 })
    const hostPid = Number((await readFile(join(fake.root, 'host-pid'), 'utf8')).trim())

    expect(result.ok).toBe(true)
    expect(Number.isInteger(hostPid)).toBe(true)
    expect(() => process.kill(hostPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  })

  it('reports a Host that died on an unsupported Node build', async () => {
    const fake = await fakeDsh({ body: "printf '%s\\n' 'Error: node-addon-require-builtin unsupported: Unsupported/no-getter' >&2\nexit 1" })
    const result = await checkPluginBoot({ projectRoot: fake.root, profile: 'dshx-boot', port: 0, executable: fake.executable, timeoutMs: 5_000 })

    expect(result).toMatchObject({ ok: false, timedOut: true, unsupportedNode: true })
  })

  it('times out when the Host exits without announcing a URL', async () => {
    const fake = await fakeDsh({ body: "printf '%s\\n' 'Error: Cannot find module \"@deepseek-ai/dsh\"'\nexit 1" })
    const result = await checkPluginBoot({ projectRoot: fake.root, profile: 'dshx-boot', port: 0, executable: fake.executable, timeoutMs: 5_000 })

    expect(result).toEqual({ ok: false, timedOut: true, unsupportedNode: false, failures: ['Error: Cannot find module "@deepseek-ai/dsh"'] })
  })
})

const project = (): ResolvedDshxConfig => ({
  root: '/project/plugin',
  packageFile: '/project/plugin/package.json',
  configDependencies: [],
  packageId: '@test/plugin',
  name: '@test/plugin',
  hostEntry: '/project/plugin/src/host.ts',
  outDir: '/project/plugin/dist',
  profile: 'web',
  dev: { hostRestart: 'manual' },
  build: { sourcemap: true },
  compatibility: { allowUnsupported: false },
  manifest: {
    name: '@test/plugin',
    type: 'module',
    devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' },
    peerDependencies: { '@deepseek-ai/dsh': PROTOCOL_2_COMPATIBILITY.dshRange },
  },
})

const passingChecks = ({ manifestErrors = false }: { readonly manifestErrors?: boolean } = {}): CliRuntime => ({
  resolveConfig: async () => project(),
  checkManifest: async () =>
    manifestErrors ? [{ code: 'DSHX1001', severity: 'error', message: 'Broken manifest.', file: '/project/plugin/package.json', hint: 'Fix it.' }] : [],
  checkMigrations: async () => [],
  checkPackageTargets: async () => [],
  typecheckProject: async root => ({ status: 'passed', configFile: `${root}/tsconfig.json`, diagnostics: [] }),
  resolveDsh: async () => ({
    version: '0.2.0-rc.2',
    adapterId: 'protocol-2',
    protocolGeneration: 'protocol-2',
    supportedRange: PROTOCOL_2_COMPATIBILITY.dshRange,
    support: 'verified',
    diagnostics: [],
    compatibility: PROTOCOL_2_COMPATIBILITY,
  }),
  inspectProfile: async () => ({ state: 'linked', profile: 'web', packageId: '@test/plugin', root: '/project/plugin' }),
  inspectRuntimePlugins: () => ({ plugins: [], diagnostics: [] }),
  inspectBridgeStatus: async () => ({ state: 'disabled', diagnostics: [] }),
})

const streams = (): CliIO & { readonly read: () => { readonly stdout: string; readonly stderr: string } } => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let out = ''
  let err = ''
  stdout.on('data', chunk => {
    out += String(chunk)
  })
  stderr.on('data', chunk => {
    err += String(chunk)
  })
  return { stdin, stdout, stderr, read: () => ({ stdout: out, stderr: err }) }
}

const hostBoot = (result: Partial<BootCheckResult>): NonNullable<CliRuntime['checkPluginBoot']> =>
  vi.fn(async () => ({ ok: true, failures: [], timedOut: false, unsupportedNode: false, url: 'http://127.0.0.1:4100/?token=abc', ...result }))

const clientBoot = (result: Partial<ClientBootCheckResult>): NonNullable<CliRuntime['checkClientBoot']> =>
  vi.fn(async () => ({
    ok: true,
    entries: [],
    failures: [],
    slotFailures: [],
    compositionFailures: [],
    timedOut: false,
    url: 'http://127.0.0.1:4100/?token=abc',
    ...result,
  }))

describe('dshx check --boot', () => {
  it('boots the throwaway profile on the requested port once the static check passes', async () => {
    const io = streams()
    const checkPluginBoot = hostBoot({})
    const code = await runCli(['check', '--boot', '--port', '4100'], { io, runtime: { ...passingChecks(), checkPluginBoot } })

    expect(code).toBe(0)
    expect(checkPluginBoot).toHaveBeenCalledWith({ projectRoot: '/project/plugin', profile: 'dshx-boot', port: 4100 })
    expect(io.read().stdout).toContain('Booted cleanly at http://127.0.0.1:4100/?token=abc.')
  })

  it('skips the boot when the static check fails', async () => {
    const io = streams()
    const checkPluginBoot = hostBoot({})
    const code = await runCli(['check', '--boot'], { io, runtime: { ...passingChecks({ manifestErrors: true }), checkPluginBoot } })

    expect(code).toBe(1)
    expect(checkPluginBoot).not.toHaveBeenCalled()
  })

  it('prints every failing Host line under a DSHX4109 diagnostic', async () => {
    const io = streams()
    const failures = inactiveWarning.split('\n')
    const code = await runCli(['check', '--boot'], { io, runtime: { ...passingChecks(), checkPluginBoot: hostBoot({ ok: false, failures }) } })

    expect(code).toBe(1)
    expect(io.read().stderr).toContain('DSHX4109')
    expect(io.read().stderr).toContain('(3 failing line(s))')
    for (const line of failures) expect(io.read().stdout).toContain(`  ${line}\n`)
  })

  it('reports an unsupported Node build as DSHX4112 instead of a timeout', async () => {
    const io = streams()
    const code = await runCli(['check', '--boot'], {
      io,
      runtime: { ...passingChecks(), checkPluginBoot: vi.fn(async () => ({ ok: false, failures: [], timedOut: true, unsupportedNode: true })) },
    })

    expect(code).toBe(1)
    expect(io.read().stderr).toContain('DSHX4112')
    expect(io.read().stderr).toContain('.node-version')
    expect(io.read().stderr).not.toContain('did not start within the boot window')
  })

  it('reports a Host that never announced its URL as a boot timeout', async () => {
    const io = streams()
    const code = await runCli(['check', '--boot'], {
      io,
      runtime: { ...passingChecks(), checkPluginBoot: vi.fn(async () => ({ ok: false, failures: [], timedOut: true, unsupportedNode: false })) },
    })

    expect(code).toBe(1)
    expect(io.read().stderr).toContain('The Host did not start within the boot window.')
  })

  it('runs the browser pass only with --runtime and lists failed client entries', async () => {
    const io = streams()
    const failures = [{ id: '@dshfiles/shortcuts', state: 'failed', detail: 'apply threw' }]
    const checkClientBoot = clientBoot({ ok: false, failures, entries: failures })
    const withoutRuntime = await runCli(['check', '--boot'], { io: streams(), runtime: { ...passingChecks(), checkPluginBoot: hostBoot({}), checkClientBoot } })
    expect(withoutRuntime).toBe(0)
    expect(checkClientBoot).not.toHaveBeenCalled()

    const code = await runCli(['check', '--boot', '--runtime'], { io, runtime: { ...passingChecks(), checkPluginBoot: hostBoot({}), checkClientBoot } })
    expect(code).toBe(1)
    expect(io.read().stderr).toContain('DSHX4111')
    expect(io.read().stdout).toContain('  @dshfiles/shortcuts: failed — apply threw\n')
  })

  it('reports a browser that could not be driven as DSHX4110', async () => {
    const io = streams()
    const code = await runCli(['check', '--boot', '--runtime'], {
      io,
      runtime: { ...passingChecks(), checkPluginBoot: hostBoot({}), checkClientBoot: clientBoot({ ok: false, browserError: 'chromium is not installed' }) },
    })

    expect(code).toBe(1)
    expect(io.read().stderr).toContain('DSHX4110')
    expect(io.read().stderr).toContain('chromium is not installed')
  })

  it('does not run the browser pass when the Host boot already failed', async () => {
    const checkClientBoot = clientBoot({})
    const code = await runCli(['check', '--boot', '--runtime'], {
      io: streams(),
      runtime: { ...passingChecks(), checkPluginBoot: hostBoot({ ok: false, failures: ['failed to import'] }), checkClientBoot },
    })

    expect(code).toBe(1)
    expect(checkClientBoot).not.toHaveBeenCalled()
  })
})
