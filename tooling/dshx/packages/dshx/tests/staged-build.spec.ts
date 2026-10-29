import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.js'
import type { CliRunOptions } from '../src/cli/run.js'
import { PROTOCOL_2_COMPATIBILITY } from '../src/compat/protocol-2.js'
import type { ResolvedDshxConfig } from '../src/config/types.js'
import { writePluginFixture } from './plugin-fixture.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const temporaryRoot = async (): Promise<string> => {
  // Real path: the compiler resolves symlinks, and sourcemap sources are relative to the real output directory.
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), 'dshx-staged-')))
  temporaryDirectories.push(directory)
  return directory
}

const project = (root: string, build: ResolvedDshxConfig['build'] = { sourcemap: true, declarations: true }): ResolvedDshxConfig => ({
  root,
  packageFile: resolve(root, 'package.json'),
  configDependencies: [],
  packageId: '@dshx/fixture-plugin',
  name: '@dshx/fixture-plugin',
  hostEntry: resolve(root, 'src/host.ts'),
  clientEntry: resolve(root, 'src/client.tsx'),
  outDir: resolve(root, 'dist'),
  profile: 'web',
  dev: { hostRestart: 'manual' },
  build,
  compatibility: { allowUnsupported: false },
  manifest: {
    name: '@dshx/fixture-plugin',
    type: 'module',
    devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' },
    peerDependencies: { '@deepseek-ai/dsh': PROTOCOL_2_COMPATIBILITY.dshRange },
    dsh: { client: { inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-sidebar'], external: [] } },
  },
})

const offlineRuntime = (value: ResolvedDshxConfig): NonNullable<CliRunOptions['runtime']> => ({
  resolveConfig: async () => value,
  checkManifest: async () => [],
  checkMigrations: async () => [],
  checkPackageTargets: async () => [],
  typecheckProject: async (root: string) => ({ status: 'passed' as const, configFile: `${root}/tsconfig.json`, diagnostics: [] }),
})

const runBuild = async (runtime: NonNullable<CliRunOptions['runtime']>): Promise<{ readonly code: number; readonly stderr: string }> => {
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean }
  stdin.isTTY = false
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const chunks: Buffer[] = []
  stderr.on('data', chunk => chunks.push(Buffer.from(chunk)))
  stdout.resume()
  const code = await runCli(['build'], { io: { stdin, stdout, stderr }, runtime })
  return { code, stderr: Buffer.concat(chunks).toString('utf8') }
}

const listing = async (directory: string): Promise<readonly string[]> => (await readdir(directory, { recursive: true })).map(String).sort()

describe('staged dshx build output', () => {
  it('leaves dist untouched until every face finished, then swaps it in whole', async () => {
    const root = await temporaryRoot()
    const dist = resolve(root, 'dist')
    await mkdir(dist)
    await writeFile(resolve(dist, 'client.js'), 'old client')
    await writeFile(resolve(dist, 'retired-module.js'), 'renamed away')
    const seenDuringBuild: string[] = []
    const value = project(root)
    const { code } = await runBuild({
      ...offlineRuntime(value),
      buildHost: async options => {
        await writeFile(resolve(options.outDir, 'index.js'), 'new host')
        seenDuringBuild.push(...(await listing(dist)), await readFile(resolve(dist, 'client.js'), 'utf8'))
        return { output: [{ fileName: 'index.js' }] } as never
      },
      buildClient: async options => {
        await writeFile(resolve(options.outDir, 'client.js'), 'new client')
        return { output: [{ fileName: 'client.js' }] } as never
      },
    })
    expect(code).toBe(0)
    expect(seenDuringBuild).toEqual(['client.js', 'retired-module.js', 'old client'])
    expect(await listing(dist)).toEqual(['client.js', 'index.js'])
    expect(await readFile(resolve(dist, 'client.js'), 'utf8')).toBe('new client')
    expect(await readdir(root)).toEqual(['dist'])
  })

  it('keeps the last good dist and removes its staging directory when a face fails', async () => {
    const root = await temporaryRoot()
    const dist = resolve(root, 'dist')
    await mkdir(dist)
    await writeFile(resolve(dist, 'client.js'), 'last good client')
    const value = project(root)
    const { code, stderr } = await runBuild({
      ...offlineRuntime(value),
      buildHost: async options => {
        await writeFile(resolve(options.outDir, 'index.js'), 'new host')
        return { output: [{ fileName: 'index.js' }] } as never
      },
      buildClient: async () => {
        throw new Error('client face failed')
      },
    })
    expect(code).toBe(1)
    expect(stderr).toContain('client face failed')
    expect(await listing(dist)).toEqual(['client.js'])
    expect(await readFile(resolve(dist, 'client.js'), 'utf8')).toBe('last good client')
    expect(await readdir(root)).toEqual(['dist'])
  })

  it('removes a staging directory an interrupted build left behind', async () => {
    const root = await temporaryRoot()
    const abandoned = resolve(root, '.dist.dshx-999999999-deadbeef')
    await mkdir(abandoned)
    await writeFile(resolve(abandoned, 'client.js'), 'partial')
    const value = project(root)
    const { code } = await runBuild({
      ...offlineRuntime(value),
      buildHost: async options => {
        await writeFile(resolve(options.outDir, 'index.js'), 'host')
        return { output: [{ fileName: 'index.js' }] } as never
      },
      buildClient: async options => {
        await writeFile(resolve(options.outDir, 'client.js'), 'client')
        return { output: [{ fileName: 'client.js' }] } as never
      },
    })
    expect(code).toBe(0)
    expect(await readdir(root)).toEqual(['dist'])
  })

  it('drops declarations, sourcemaps and dependency manifests a rebuild no longer produces', async () => {
    const root = await temporaryRoot()
    await writePluginFixture(root)
    expect((await runBuild(offlineRuntime(project(root)))).code).toBe(0)
    expect(await listing(resolve(root, 'dist'))).toEqual([
      'client.d.ts',
      'client.js',
      'client.js.deps.json',
      'client.js.map',
      'index.d.ts',
      'index.js',
      'index.js.deps.json',
      'index.js.map',
    ])
    const sourcemap = JSON.parse(await readFile(resolve(root, 'dist/client.js.map'), 'utf8')) as { readonly sources: readonly string[] }
    expect(sourcemap.sources).toContain('../src/client.tsx')

    const { clientEntry: _clientEntry, ...hostOnly } = project(root, { sourcemap: false, declarations: false })
    expect((await runBuild(offlineRuntime(hostOnly))).code).toBe(0)
    expect(await listing(resolve(root, 'dist'))).toEqual(['index.js', 'index.js.deps.json'])
  })
})
