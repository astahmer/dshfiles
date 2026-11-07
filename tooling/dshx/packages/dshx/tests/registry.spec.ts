import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProfilePluginCli } from '../src/cli/add-plugin.js'
import { runRegistryCli } from '../src/cli/registry.js'
import { runCli } from '../src/cli/run.js'
import type { JsonObject } from '../src/json.js'
import type { DshCommandRunner } from '../src/profile/types.js'
import { RegistryClient } from '../src/registry/client.js'

const writeFile = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

const capture = () => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let out = ''
  let err = ''
  stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
  stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')))
  return { io: { stdin: new PassThrough(), stdout, stderr }, output: () => out, errors: () => err }
}

const sri = (bytes: Buffer): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

describe('dshx registry', () => {
  let root: string
  let home: string
  let profileRoot: string
  let registry: string
  let calls: string[][]
  let dshVersion: string

  /** Stands in for `dsh plugin`, doing what it does to the profile so the plan reads real files. */
  const runDsh: DshCommandRunner = async args => {
    if (args[0] === '--version') return { exitCode: 0, stdout: dshVersion, stderr: '', executable: 'global' }
    calls.push([...args])
    const [, , , verb, spec] = args
    const manifest = JSON.parse(readFileSync(join(profileRoot, 'package.json'), 'utf8'))
    if (verb === 'add' && spec !== undefined) {
      const [name, version] = spec.startsWith('file:')
        ? nameFromTarball(spec.slice('file:'.length))
        : [spec.slice(0, spec.lastIndexOf('@')), spec.slice(spec.lastIndexOf('@') + 1)]
      manifest.dependencies[name!] = spec.startsWith('file:') ? spec : version
      if (!manifest.dsh.profile.bundles.includes(name)) manifest.dsh.profile.bundles.push(name)
      writeFile(
        join(profileRoot, 'node_modules', name!, 'package.json'),
        JSON.stringify({ name, version, main: './dist/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
      )
    }
    if (verb === 'remove' && spec !== undefined) {
      delete manifest.dependencies[spec]
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((bundle: string) => bundle !== spec)
      rmSync(join(profileRoot, 'node_modules', spec), { recursive: true, force: true })
    }
    writeFile(join(profileRoot, 'package.json'), JSON.stringify(manifest, null, 2))
    return { exitCode: 0, stdout: '', stderr: '', executable: 'global' }
  }

  const nameFromTarball = (path: string): readonly [string, string] => {
    const manifest = JSON.parse(execFileSync('tar', ['-xzOf', path, 'package/package.json'], { encoding: 'utf8' }))
    return [manifest.name, manifest.version]
  }

  const profilePlugin = async (command: 'add' | 'update' | 'remove', ...argv: string[]) => {
    const run = capture()
    const status = await runProfilePluginCli(command, [...argv, '--home', home], run.io, { runDsh })
    return { status, output: run.output(), errors: run.errors() }
  }

  const registryCli = async (...argv: string[]) => {
    const run = capture()
    const status = await runRegistryCli([...argv, '--home', home], run.io, { runDsh })
    return { status, output: run.output(), errors: run.errors() }
  }

  const profileManifest = () => JSON.parse(readFileSync(join(profileRoot, 'package.json'), 'utf8'))
  const profileRecords = () => JSON.parse(readFileSync(join(profileRoot, '.dshx-registry/installed.json'), 'utf8'))

  /** A real npm-pack-shaped tarball, so hashing and manifest checks run against real bytes. */
  const packTarball = (name: string, version: string, extra: JsonObject = {}): Buffer => {
    const work = mkdtempSync(join(root, 'pack-'))
    writeFile(join(work, 'package/package.json'), JSON.stringify({ name, version, dsh: { bundle: { patch: './cordis.patch.yml' } }, ...extra }))
    const file = join(work, 'out.tgz')
    execFileSync('tar', ['-czf', file, '-C', work, 'package'])
    return readFileSync(file)
  }

  const publishPlugin = (item: string, packageName: string, version: string, overrides: JsonObject = {}, tarball = packTarball(packageName, version)) => {
    const file = `tarballs/${item}-${version}.tgz`
    writeFile(join(registry, file), '')
    writeFileSync(join(registry, file), tarball)
    writeFile(
      join(registry, `r/${item}.json`),
      JSON.stringify({
        schemaVersion: 1,
        name: item,
        type: 'dsh:plugin',
        version,
        package: packageName,
        source: { type: 'tarball', url: `../${file}`, integrity: sri(tarball) },
        ...overrides,
      }),
    )
    return join(registry, `r/${item}.json`)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dshx-registry-'))
    home = join(root, 'home')
    profileRoot = join(home, 'profiles/probe')
    registry = join(root, 'registry')
    calls = []
    dshVersion = '0.2.1-rc.2'
    writeFile(
      join(profileRoot, 'package.json'),
      JSON.stringify({ name: 'dsh-profile-probe', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }),
    )
    writeFile(join(profileRoot, 'cordis.patch.yml'), '[]\n')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  describe('addresses', () => {
    it('keeps every existing dshx add operand out of the registry path', () => {
      for (const spec of [
        '@acme/mini',
        '@acme/mini@1.2.0',
        'dsh-plugin',
        'dsh-plugin@^1',
        'link:./x',
        'link:/abs/x',
        './plugin',
        '/abs/plugin',
        'npm:foo',
        'file:./x.tgz',
      ])
        expect(RegistryClient.parseAddress(spec, '/cwd')).toBeUndefined()
    })

    it('reads URLs, json paths and aliases as registry addresses', () => {
      expect(RegistryClient.parseAddress('https://x.dev/r/mini.json', '/cwd')).toMatchObject({ kind: 'location', url: 'https://x.dev/r/mini.json' })
      expect(RegistryClient.parseAddress('./r/mini.json', '/cwd')).toMatchObject({ kind: 'location', url: 'file:///cwd/r/mini.json' })
      expect(RegistryClient.parseAddress('acme:mini', '/cwd')).toMatchObject({ kind: 'alias', alias: 'acme', item: 'mini' })
    })
  })

  describe('plugin items', () => {
    it('installs, repeats as a no-op, updates and removes a tarball item', async () => {
      const item = publishPlugin('mini', '@acme/mini', '1.0.0')
      const added = await profilePlugin('add', item, '--option', 'greeting=hi')
      expect(added.status).toBe(0)
      expect(added.output).toContain('registry item')
      const dependency = String(profileManifest().dependencies['@acme/mini'])
      expect(dependency).toMatch(/^file:.*\.dshx-registry\/tarballs\/acme-mini-1\.0\.0-[0-9a-f]{12}\.tgz$/u)
      expect(profileRecords().plugins['@acme/mini']).toMatchObject({ version: '1.0.0', address: item })
      expect(readFileSync(join(profileRoot, 'cordis.patch.yml'), 'utf8')).toContain('greeting: hi')

      const repeated = await profilePlugin('add', item)
      expect(repeated.output).toContain('up to date')
      expect(calls.filter(call => call[3] === 'add')).toHaveLength(1)

      publishPlugin('mini', '@acme/mini', '1.1.0')
      const updated = await profilePlugin('update', '@acme/mini')
      expect(updated.status).toBe(0)
      expect(updated.output).toContain('1.0.0 → 1.1.0')
      expect(existsSync(dependency.slice('file:'.length))).toBe(false)
      expect(readFileSync(join(profileRoot, 'cordis.patch.yml'), 'utf8')).toContain('greeting: hi')

      const removed = await profilePlugin('remove', '@acme/mini')
      expect(removed.status).toBe(0)
      expect(profileManifest().dependencies).toEqual({})
      expect(existsSync(join(profileRoot, '.dshx-registry/installed.json'))).toBe(false)
      expect(readFileSync(join(profileRoot, 'cordis.patch.yml'), 'utf8')).not.toContain('greeting')
    })

    it('refuses a tarball whose bytes do not match, and installs nothing', async () => {
      const item = publishPlugin('mini', '@acme/mini', '1.0.0')
      writeFileSync(join(registry, 'tarballs/mini-1.0.0.tgz'), packTarball('@acme/mini', '1.0.0', { description: 'swapped' }))
      const result = await profilePlugin('add', item)
      expect(result.status).toBe(1)
      expect(result.errors).toContain('does not match the integrity')
      expect(calls).toEqual([])
      expect(profileManifest().dependencies).toEqual({})
    })

    it('refuses a tarball that is another package than the item claims', async () => {
      const item = publishPlugin('mini', '@acme/mini', '1.0.0', {}, packTarball('@evil/other', '1.0.0'))
      const result = await profilePlugin('add', item)
      expect(result.status).toBe(1)
      expect(result.errors).toContain('@evil/other@1.0.0')
      expect(calls).toEqual([])
    })

    it('refuses a tarball without dsh.bundle', async () => {
      const item = publishPlugin('mini', '@acme/mini', '1.0.0', {}, packTarball('@acme/mini', '1.0.0', { dsh: {} }))
      expect((await profilePlugin('add', item)).errors).toContain('no dsh.bundle')
    })

    it('stops when a version changes content in place, until --force', async () => {
      const item = publishPlugin('mini', '@acme/mini', '1.0.0')
      await profilePlugin('add', item)
      publishPlugin('mini', '@acme/mini', '1.0.0', {}, packTarball('@acme/mini', '1.0.0', { description: 'changed' }))
      const refused = await profilePlugin('update', '@acme/mini')
      expect(refused.status).toBe(1)
      expect(refused.errors).toContain('changed content without a new version')
      expect((await profilePlugin('update', '@acme/mini', '--force')).status).toBe(0)
    })

    it('installs an npm item through the same dsh plugin add path as a package', async () => {
      writeFile(
        join(registry, 'r/npm.json'),
        JSON.stringify({
          schemaVersion: 1,
          name: 'npm',
          type: 'dsh:plugin',
          version: '1.2.0',
          package: '@acme/npm',
          source: { type: 'npm', registry: 'https://npm.acme.dev/' },
        }),
      )
      const result = await profilePlugin('add', join(registry, 'r/npm.json'))
      expect(result.status).toBe(0)
      expect(calls).toEqual([['plugin', '--profile', 'probe', 'add', '@acme/npm@1.2.0', '--registry=https://npm.acme.dev/']])
      expect(profileRecords().plugins['@acme/npm']).toMatchObject({ integrity: null, tarball: null })
    })

    it('installs dependencies first and warns instead of cascading on remove', async () => {
      publishPlugin('base', '@acme/base', '1.0.0')
      const item = publishPlugin('top', '@acme/top', '1.0.0', { registryDependencies: ['base'] })
      await profilePlugin('add', item)
      expect(profileManifest().dsh.profile.bundles).toEqual(['@acme/base', '@acme/top'])
      expect((await profilePlugin('remove', '@acme/base')).output).toContain('@acme/top declared @acme/base')
      expect((await profilePlugin('remove', '@acme/top')).output).not.toContain('@acme/base stays')
    })

    it('refuses dependency cycles before installing anything', async () => {
      publishPlugin('a', '@acme/a', '1.0.0', { registryDependencies: ['b'] })
      publishPlugin('b', '@acme/b', '1.0.0', { registryDependencies: ['a'] })
      const result = await profilePlugin('add', join(registry, 'r/a.json'))
      expect(result.errors).toContain('dependency cycle')
      expect(calls).toEqual([])
    })

    it('never shadows an owned bundle', async () => {
      const result = await profilePlugin('add', publishPlugin('owned', '@dshfiles/owned', '1.0.0'))
      expect(result.status).toBe(1)
      expect(result.errors).toContain('owned bundle')
    })

    it('warns about engines but leaves the decision to DSH', async () => {
      const result = await profilePlugin('add', publishPlugin('old', '@acme/old', '1.0.0', { engines: { dsh: '<0.1.0' } }))
      expect(result.output).toContain('excludes DSH 0.2.1-rc.2')
      expect(calls).toHaveLength(1)
    })

    it('leaves no record and no tarball when DSH rejects the package', async () => {
      const failing: DshCommandRunner = async args =>
        args[0] === '--version'
          ? runDsh(args, { cwd: '', env: {}, timeoutMs: 1 })
          : { exitCode: 1, stdout: '', stderr: 'installation rejected', executable: 'global' }
      const run = capture()
      const status = await runProfilePluginCli('add', [publishPlugin('mini', '@acme/mini', '1.0.0'), '--home', home], run.io, { runDsh: failing })
      expect(status).toBe(1)
      expect(run.errors()).toContain('installation rejected')
      expect(existsSync(join(profileRoot, '.dshx-registry/installed.json'))).toBe(false)
      expect(execFileSync('ls', ['-A', join(profileRoot, '.dshx-registry/tarballs')], { encoding: 'utf8' })).toBe('')
    })

    it('makes an add by another route end the registry claim', async () => {
      await profilePlugin('add', publishPlugin('mini', '@acme/mini', '1.0.0'))
      await profilePlugin('add', '@acme/mini@2.0.0')
      expect(existsSync(join(profileRoot, '.dshx-registry/installed.json'))).toBe(false)
    })

    it('rejects a newer format with a way forward', async () => {
      writeFile(join(registry, 'r/next.json'), JSON.stringify({ schemaVersion: 2, name: 'next' }))
      const result = await profilePlugin('add', join(registry, 'r/next.json'))
      expect(result.status).toBe(1)
      expect(result.errors).toContain('update dshx')
    })

    it('still sends a plain npm package down the npm path', async () => {
      expect((await profilePlugin('add', '@acme/plain@1.0.0')).output).toContain('registry package')
      expect(calls).toEqual([['plugin', '--profile', 'probe', 'add', '@acme/plain@1.0.0']])
      await profilePlugin('update', '@acme/plain', '--latest')
      expect(calls.at(-1)).toEqual(['plugin', '--profile', 'probe', 'update', '--latest', '@acme/plain'])
      await profilePlugin('remove', '@acme/plain')
      expect(calls.at(-1)).toEqual(['plugin', '--profile', 'probe', 'remove', '@acme/plain'])
    })
  })

  describe('transport', () => {
    let server: Server
    let base: string
    let requests: string[]

    beforeEach(async () => {
      requests = []
      server = createServer((request, response) => {
        requests.push(request.url ?? '')
        const path = join(registry, request.url ?? '')
        if (!existsSync(path)) {
          response.statusCode = 404
          response.end()
          return
        }
        response.end(readFileSync(path))
      })
      await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
      // SAFETY: a TCP server that is listening reports an AddressInfo, never a pipe path.
      base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
    })

    afterEach(() => new Promise(done => server.close(done)))

    const publishIndex = () =>
      writeFile(
        join(registry, 'registry.json'),
        JSON.stringify({
          schemaVersion: 1,
          name: 'acme',
          items: [{ name: 'mini', type: 'dsh:plugin', version: '1.0.0', description: 'A small plugin', engines: { dsh: '<0.1.0' }, url: 'r/mini.json' }],
        }),
      )

    it('adds an alias, searches it and installs and updates through it', async () => {
      publishPlugin('mini', '@acme/mini', '1.0.0')
      publishIndex()
      expect((await registryCli('add', 'acme', `${base}/registry.json`)).status).toBe(0)
      const found = await registryCli('search', 'small')
      expect(found.output).toContain('acme:mini  1.0.0')
      expect(found.output).toContain('needs DSH <0.1.0')
      expect((await profilePlugin('add', 'acme:mini')).status).toBe(0)
      publishPlugin('mini', '@acme/mini', '1.1.0')
      expect((await profilePlugin('update', 'acme:mini')).output).toContain('1.0.0 → 1.1.0')
      expect((await profilePlugin('remove', 'acme:mini')).status).toBe(0)
      expect((await registryCli('remove', 'acme')).output).toContain('Removed acme')
      expect((await registryCli('search', 'small')).status).toBe(1)
    })

    it('refuses a version on an item, since its registry names the version', async () => {
      publishPlugin('mini', '@acme/mini', '1.0.0')
      await profilePlugin('add', `${base}/r/mini.json`)
      expect((await profilePlugin('update', '@acme/mini@2.0.0')).errors).toContain('names its version')
      expect((await profilePlugin('update', '@acme/mini', '--latest')).errors).toContain('names its version')
    })

    it('never downloads the tarball twice: pnpm installs the verified copy', async () => {
      publishPlugin('mini', '@acme/mini', '1.0.0')
      await profilePlugin('add', `${base}/r/mini.json`)
      expect(requests.filter(request => request.endsWith('.tgz'))).toHaveLength(1)
    })

    it('refuses a remote item that reaches for local files', async () => {
      writeFile(
        join(registry, 'r/mini.json'),
        JSON.stringify({
          schemaVersion: 1,
          name: 'mini',
          type: 'dsh:plugin',
          version: '1.0.0',
          package: '@acme/mini',
          source: { type: 'tarball', url: 'file:///etc/hosts', integrity: `sha512-${'A'.repeat(86)}==` },
        }),
      )
      const result = await profilePlugin('add', `${base}/r/mini.json`)
      expect(result.status).toBe(1)
      expect(result.errors).toContain('cannot read local files')
    })

    it('reports a dropped item and leaves the install alone', async () => {
      const item = `${base}/r/mini.json`
      publishPlugin('mini', '@acme/mini', '1.0.0')
      await profilePlugin('add', item)
      rmSync(join(registry, 'r/mini.json'))
      const result = await profilePlugin('update', '@acme/mini')
      expect(result.status).toBe(1)
      expect(result.errors).toContain('HTTP 404')
      expect(Object.keys(profileManifest().dependencies)).toEqual(['@acme/mini'])
    })

    it('refuses plain http beyond loopback', async () => {
      expect((await profilePlugin('add', 'http://example.com/r/mini.json')).errors).toContain('plain http')
    })
  })

  describe('source items', () => {
    let project: string
    const publishSource = (version: string, files: Record<string, string>, overrides: JsonObject = {}) => {
      const path = join(registry, 'r/hello.json')
      writeFile(
        path,
        JSON.stringify({
          schemaVersion: 1,
          name: 'hello',
          type: 'dsh:source',
          version,
          files: Object.entries(files).map(([target, content]) => ({ target, content })),
          ...overrides,
        }),
      )
      return path
    }
    const source = (command: 'add' | 'update' | 'remove', spec: string, ...argv: string[]) => profilePlugin(command, spec, '--project', project, ...argv)
    const projectFile = (path: string) => readFileSync(join(project, path), 'utf8')

    beforeEach(() => {
      project = join(root, 'project')
      writeFile(join(project, 'dshx.config.ts'), 'export default {}\n')
      writeFile(join(project, 'package.json'), `${JSON.stringify({ name: 'mine', dependencies: { kept: '1.0.0' } }, null, 2)}\n`)
    })

    it('copies, updates and removes files, leaving nothing behind', async () => {
      const item = publishSource(
        '1.0.0',
        { 'src/tools/hello.ts': 'one\n', 'src/tools/old.ts': 'old\n' },
        { dependencies: { zod: '4.4.3' }, docs: 'Register it in src/index.ts.' },
      )
      const added = await source('add', item)
      expect(added.status).toBe(0)
      expect(added.output).toContain('Register it in src/index.ts.')
      expect(added.output).toContain('zod@4.4.3')
      expect(projectFile('src/tools/hello.ts')).toBe('one\n')
      expect(JSON.parse(projectFile('package.json')).dependencies).toEqual({ kept: '1.0.0', zod: '4.4.3' })
      expect((await source('add', item)).output).toContain('up to date')

      publishSource('1.1.0', { 'src/tools/hello.ts': 'two\n' })
      const updated = await source('update', 'hello')
      expect(updated.status).toBe(0)
      expect(updated.output).toContain('1.0.0 → 1.1.0')
      expect(projectFile('src/tools/hello.ts')).toBe('two\n')
      expect(existsSync(join(project, 'src/tools/old.ts'))).toBe(false)

      expect((await source('remove', 'hello')).status).toBe(0)
      expect(existsSync(join(project, 'src'))).toBe(false)
      expect(existsSync(join(project, '.dshx-registry.json'))).toBe(false)
    })

    it('does not overwrite local edits on update without --force', async () => {
      await source('add', publishSource('1.0.0', { 'src/hello.ts': 'one\n' }))
      writeFile(join(project, 'src/hello.ts'), 'mine\n')
      publishSource('1.1.0', { 'src/hello.ts': 'two\n' })
      const refused = await source('update', 'hello')
      expect(refused.status).toBe(1)
      expect(refused.errors).toContain('files it does not own: src/hello.ts')
      expect(projectFile('src/hello.ts')).toBe('mine\n')
      expect((await source('update', 'hello', '--force')).status).toBe(0)
      expect(projectFile('src/hello.ts')).toBe('two\n')
    })

    it('does not adopt a file it never wrote', async () => {
      writeFile(join(project, 'src/hello.ts'), 'mine\n')
      expect((await source('add', publishSource('1.0.0', { 'src/hello.ts': 'one\n' }))).errors).toContain('files it does not own')
      expect(projectFile('src/hello.ts')).toBe('mine\n')
    })

    it('keeps edited files on remove unless --force', async () => {
      await source('add', publishSource('1.0.0', { 'src/hello.ts': 'one\n' }))
      writeFile(join(project, 'src/hello.ts'), 'mine\n')
      expect((await source('remove', 'hello')).output).toContain('holds local edits')
      expect(projectFile('src/hello.ts')).toBe('mine\n')
    })

    it.each([
      ['../escape.ts'],
      ['/etc/passwd'],
      ['package.json'],
      ['cordis.patch.yml'],
      ['dshx.config.ts'],
      ['.github/workflows/x.yml'],
      ['node_modules/x/index.js'],
    ])('refuses the target %s', async target => {
      const result = await source('add', publishSource('1.0.0', { [target]: 'x' }))
      expect(result.status).toBe(1)
      expect(result.errors).toContain('Nothing was written')
    })

    it('refuses a target that escapes through a symlink', async () => {
      mkdirSync(join(root, 'outside'))
      symlinkSync(join(root, 'outside'), join(project, 'src'))
      const result = await source('add', publishSource('1.0.0', { 'src/hello.ts': 'x' }))
      expect(result.errors).toContain('through a symlink')
      expect(existsSync(join(root, 'outside/hello.ts'))).toBe(false)
    })

    it('enforces engines itself, since DSH never sees copied source', async () => {
      const item = publishSource('1.0.0', { 'src/hello.ts': 'x' }, { engines: { dsh: '<0.1.0' } })
      expect((await source('add', item)).errors).toContain('needs DSH <0.1.0')
      expect((await source('add', item, '--force')).status).toBe(0)
    })

    it('refuses a directory that is not a dshx project', async () => {
      rmSync(join(project, 'dshx.config.ts'))
      expect((await source('add', publishSource('1.0.0', { 'src/hello.ts': 'x' }))).errors).toContain('not a dshx plugin project')
    })

    it('sends a plugin item in a source graph back to the right command', async () => {
      publishPlugin('base', '@acme/base', '1.0.0')
      const result = await source('add', publishSource('1.0.0', { 'src/hello.ts': 'x' }, { registryDependencies: ['base'] }))
      expect(result.status).toBe(1)
      expect(result.errors).toContain('one item type')
    })
  })

  describe('build', () => {
    let author: string
    const plugin = (directory: string, manifest: JsonObject = {}) => {
      writeFile(join(author, directory, 'dist/index.js'), 'export const name = "mini"\n')
      writeFile(join(author, directory, 'cordis.patch.yml'), '[]\n')
      writeFile(
        join(author, directory, 'package.json'),
        JSON.stringify({
          name: '@acme/mini',
          version: '1.0.0',
          description: 'Small',
          license: 'MIT',
          main: './dist/index.js',
          files: ['dist', 'cordis.patch.yml'],
          peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0-rc.1 <0.3.0-0' },
          dsh: { bundle: { patch: './cordis.patch.yml' } },
          ...manifest,
        }),
      )
    }
    const build = async () => {
      const run = capture()
      const cwd = process.cwd()
      process.chdir(author)
      try {
        const status = await runRegistryCli(['build', '--out', 'out'], run.io, { runDsh })
        return { status, output: run.output(), errors: run.errors() }
      } finally {
        process.chdir(cwd)
      }
    }

    beforeEach(() => {
      author = join(root, 'author')
      mkdirSync(author)
    })

    it('builds documents an install accepts, with engines from peerDependencies', async () => {
      plugin('plugins/mini', { private: true })
      writeFile(join(author, 'blocks/hello.ts'), 'export const hello = 1\n')
      writeFile(
        join(author, 'dshx.registry.json'),
        JSON.stringify({
          name: 'acme',
          items: [
            { type: 'dsh:plugin', path: 'plugins/mini', distribution: 'tarball' },
            { type: 'dsh:source', name: 'hello', version: '1.0.0', files: [{ path: 'blocks/hello.ts', target: 'src/hello.ts' }] },
          ],
        }),
      )
      const result = await build()
      expect(result.errors).toBe('')
      expect(result.status).toBe(0)
      const item = JSON.parse(readFileSync(join(author, 'out/r/acme-mini.json'), 'utf8'))
      expect(item).toMatchObject({
        package: '@acme/mini',
        engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' },
        source: { type: 'tarball', url: '../tarballs/acme-mini-1.0.0.tgz' },
      })
      expect(item.source.integrity).toBe(sri(readFileSync(join(author, 'out/tarballs/acme-mini-1.0.0.tgz'))))
      const index = JSON.parse(readFileSync(join(author, 'out/registry.json'), 'utf8'))
      expect(index.items.map((entry: { url: string }) => entry.url)).toEqual(['r/acme-mini.json', 'r/hello.json'])
      expect((await profilePlugin('add', join(author, 'out/r/acme-mini.json'))).status).toBe(0)
      expect((await registryCli('search', '--registry', pathToFileURL(join(author, 'out/registry.json')).href)).output).toContain('hello')
    })

    it('refuses a workspace: dependency in a tarball, which no install can resolve', async () => {
      plugin('plugins/mini', { dependencies: { shared: 'workspace:*' } })
      writeFile(
        join(author, 'dshx.registry.json'),
        JSON.stringify({ name: 'acme', items: [{ type: 'dsh:plugin', path: 'plugins/mini', distribution: 'tarball' }] }),
      )
      expect((await build()).errors).toContain('workspace:')
    })

    it('refuses a dependency on an item it does not build', async () => {
      plugin('plugins/mini')
      writeFile(
        join(author, 'dshx.registry.json'),
        JSON.stringify({ name: 'acme', items: [{ type: 'dsh:plugin', path: 'plugins/mini', distribution: 'npm', registryDependencies: ['missing'] }] }),
      )
      const result = await build()
      expect(result.status).toBe(1)
      expect(result.errors).toContain('does not build')
    })

    it('refuses a source target an install would refuse', async () => {
      writeFile(join(author, 'blocks/hello.ts'), 'x')
      writeFile(
        join(author, 'dshx.registry.json'),
        JSON.stringify({
          name: 'acme',
          items: [{ type: 'dsh:source', name: 'hello', version: '1.0.0', files: [{ path: 'blocks/hello.ts', target: 'package.json' }] }],
        }),
      )
      expect((await build()).errors).toContain('not a valid source target')
    })
  })

  it('routes dshx registry from the top-level CLI', async () => {
    const run = capture()
    expect(await runCli(['registry', '--help'], { io: run.io })).toBe(0)
    expect(run.output()).toContain('dshx registry build')
  })
})
