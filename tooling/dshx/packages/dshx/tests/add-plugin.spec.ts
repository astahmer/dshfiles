import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProfilePluginCli } from '../src/cli/add-plugin.js'
import type { DshCommandRunner } from '../src/profile/types.js'
import { runCli } from '../src/cli/run.js'

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

const profilePatch = `# local edits stay
- id: session-query-sqlite
  disabled: true
  config:
    path: !!js (process.env.DSH_HOME || process.env.HOME) + '/index.sqlite'
`

describe('dshx add <package>', () => {
  let root: string
  let home: string
  let profileRoot: string
  let pluginsRoot: string
  let fixtureRoot: string
  const manifest = (dependencies: Record<string, string> = {}, bundles: string[] = []): string =>
    `${JSON.stringify({ name: 'dsh-profile-probe', private: true, dependencies, dsh: { profile: { bundles } } }, null, 2)}\n`
  const readProfile = () => ({
    manifest: readFileSync(join(profileRoot, 'package.json'), 'utf8'),
    patch: readFileSync(join(profileRoot, 'cordis.patch.yml'), 'utf8'),
  })
  const addFixture = async (...argv: string[]) => {
    const run = capture()
    const status = await runProfilePluginCli('add', ['@dshfiles/fixture-plugin', '--home', home, ...argv], run.io, { pluginsRoot })
    return { status, output: run.output(), errors: run.errors() }
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dshx-add-'))
    home = join(root, 'home')
    profileRoot = join(home, 'profiles/probe')
    pluginsRoot = join(root, 'plugins/@dshfiles')
    fixtureRoot = join(pluginsRoot, 'fixture-plugin')
    writeFile(join(profileRoot, 'package.json'), manifest())
    writeFile(join(profileRoot, 'cordis.patch.yml'), profilePatch)
    writeFile(
      join(fixtureRoot, 'package.json'),
      JSON.stringify({
        name: '@dshfiles/fixture-plugin',
        main: './dist/index.js',
        dsh: { bundle: { patch: './cordis.patch.yml' }, client: { inject: ['@deepseek-ai/dsh-client-ui-slots'] } },
      }),
    )
    writeFile(
      join(fixtureRoot, 'cordis.patch.yml'),
      "- insert:\n    - id: dshfiles-fixture-plugin\n      name: '@dshfiles/fixture-plugin'\n      config:\n        threshold: 1\n        mode: a\n",
    )
    writeFile(
      join(fixtureRoot, 'dist/index.js'),
      [
        'export const Config = {',
        "  '~standard': {",
        '    version: 1,',
        "    vendor: 'fixture',",
        "    validate: value => (typeof value.threshold === 'number' ? { value } : { issues: [{ message: 'must be a number', path: ['threshold'] }] }),",
        '  },',
        '}',
        '',
      ].join('\n'),
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('prints the plan in a dry run and writes nothing', async () => {
    const before = readProfile()
    const run = capture()
    const status = await runCli(['add', '@dshfiles/goal-stall-guard', '--home', home, '--option', 'stallThreshold=5', '--dry-run'], { io: run.io })
    expect(run.errors()).toBe('')
    expect(status).toBe(0)
    expect(run.output()).toContain('add @dshfiles/goal-stall-guard → profile probe (dry run)')
    expect(run.output()).toContain('row        dshfiles-goal-stall-guard')
    expect(run.output()).toMatch(/run {8}\S+ \S+scripts\/profile-sync\.ts --profile probe --home \S+ --bundle @dshfiles\/goal-stall-guard/)
    expect(run.output()).toContain('config     {"stallThreshold":5}')
    expect(run.output()).toContain('restart    Restart the DSH host process')
    expect(readProfile()).toEqual(before)
  })

  it('prints the dsh plugin add command for a registry package in a dry run', async () => {
    const run = capture()
    const status = await runCli(['add', 'dsh-plugin-example', '--home', home, '--dry-run'], { io: run.io })
    expect(status).toBe(0)
    expect(run.output()).toContain('run        dsh plugin --profile probe add dsh-plugin-example')
    expect(run.output()).toContain('source     registry package')
  })

  it('links and installs an owned bundle, and a second run changes nothing', async () => {
    const first = capture()
    expect(await runCli(['add', '@dshfiles/goal-stall-guard', '--home', home, '--option', 'stallThreshold=5'], { io: first.io })).toBe(0)
    const installed = readProfile()
    expect(JSON.parse(installed.manifest)).toMatchObject({
      dependencies: { '@dshfiles/goal-stall-guard': expect.stringMatching(/^link:.*plugins\/@dshfiles\/goal-stall-guard$/) },
      dsh: { profile: { bundles: ['@dshfiles/goal-stall-guard'] } },
    })
    expect(installed.patch).toContain("- id: dshfiles-goal-stall-guard\n  name: '@dshfiles/goal-stall-guard'\n  config:\n    stallThreshold: 5\n")
    expect(installed.patch.startsWith(profilePatch)).toBe(true)

    const second = capture()
    expect(await runCli(['add', '@dshfiles/goal-stall-guard', '--home', home, '--option', 'stallThreshold=5'], { io: second.io })).toBe(0)
    expect(second.output()).toContain('up to date; nothing to restart')
    expect(second.output()).not.toContain('run ')
    expect(readProfile()).toEqual(installed)
  }, 240_000)

  describe('with an installed bundle', () => {
    beforeEach(() => {
      writeFile(join(profileRoot, 'package.json'), manifest({ '@dshfiles/fixture-plugin': `link:${fixtureRoot}` }, ['@dshfiles/fixture-plugin']))
    })

    it('starts a new override from the bundle row config and keeps the rest of the patch', async () => {
      const result = await addFixture('--option', 'threshold=4')
      expect(result.errors).toBe('')
      expect(result.status).toBe(0)
      expect(result.output).toContain('inject     @deepseek-ai/dsh-client-ui-slots')
      expect(readProfile().patch).toBe(
        `${profilePatch}- id: dshfiles-fixture-plugin\n  name: '@dshfiles/fixture-plugin'\n  config:\n    threshold: 4\n    mode: a\n`,
      )
    })

    it('merges options into an existing override', async () => {
      writeFile(join(profileRoot, 'cordis.patch.yml'), `${profilePatch}- id: dshfiles-fixture-plugin\n  config:\n    mode: b\n    extra: true\n`)
      const result = await addFixture('--option', 'threshold=7', '--option', 'mode=c')
      expect(result.status).toBe(0)
      expect(result.output).toContain('config     {"mode":"c","extra":true,"threshold":7}')
      expect(readProfile().patch).toBe(`${profilePatch}- id: dshfiles-fixture-plugin\n  config:\n    mode: c\n    extra: true\n    threshold: 7\n`)
      const again = await addFixture('--option', 'threshold=7', '--option', 'mode=c')
      expect(again.output).toContain('up to date; nothing to restart')
    })

    it('refuses options the plugin config schema rejects', async () => {
      const before = readProfile()
      const result = await addFixture('--option', 'threshold=many')
      expect(result.status).toBe(1)
      expect(result.errors).toContain('threshold: must be a number')
      expect(readProfile()).toEqual(before)
    })

    it('has nothing to update while the bundle is linked to this checkout', async () => {
      const run = capture()
      expect(await runProfilePluginCli('update', ['@dshfiles/fixture-plugin', '--home', home], run.io, { pluginsRoot })).toBe(0)
      expect(run.output()).toContain('up to date; nothing to restart')
      expect(run.output()).not.toContain('run ')
    })

    it('passes options through with a warning when the schema is unreadable', async () => {
      rmSync(join(fixtureRoot, 'dist'), { recursive: true })
      const result = await addFixture('--option', 'threshold=many')
      expect(result.status).toBe(0)
      expect(result.output).toContain('warning    Options were not validated')
    })
  })

  it('rejects an unknown owned package', async () => {
    const run = capture()
    expect(await runCli(['add', '@dshfiles/does-not-exist', '--home', home], { io: run.io })).toBe(1)
    expect(run.errors()).toContain('Owned plugin bundle @dshfiles/does-not-exist was not found')
  })

  it('refuses a profile that does not exist', async () => {
    const run = capture()
    expect(await runCli(['add', '@dshfiles/goal-stall-guard', '--home', home, '--profile', 'missing'], { io: run.io })).toBe(1)
    expect(run.errors()).toContain('Profile missing does not exist')
  })

  it('rejects a malformed option', async () => {
    const run = capture()
    expect(await runCli(['add', '@dshfiles/goal-stall-guard', '--home', home, '--option', 'novalue'], { io: run.io })).toBe(2)
    expect(run.errors()).toContain('key=value')
  })

  it('keeps scaffold targets on the scaffold command', async () => {
    const run = capture()
    await runCli(['add', 'tool', '--help'], { io: run.io })
    expect(run.output()).not.toContain('install one plugin into a DSH profile')
  })

  describe('versions, local packages, update and remove', () => {
    let calls: string[][]
    /** Stands in for the external `dsh plugin` CLI: applies the pnpm verb to the profile manifest the way DSH reconciles it. */
    const fakeDsh: DshCommandRunner = async args => {
      calls.push([...args])
      const [, , , verb, ...rest] = args
      const profileManifest = JSON.parse(readFileSync(join(profileRoot, 'package.json'), 'utf8'))
      const spec = rest.at(-1) ?? ''
      const versioned = /^((?:@[^/@]+\/)?[^@]+)@(.+)$/u.exec(spec)
      const name = spec.startsWith('link:') ? JSON.parse(readFileSync(join(spec.slice(5), 'package.json'), 'utf8')).name : (versioned?.[1] ?? spec)
      if (verb === 'remove') {
        delete profileManifest.dependencies[name]
        profileManifest.dsh.profile.bundles = profileManifest.dsh.profile.bundles.filter((bundle: string) => bundle !== name)
      } else {
        const version = verb === 'update' ? '1.5.0' : (versioned?.[2] ?? '1.0.0')
        profileManifest.dependencies[name] = spec.startsWith('link:') ? spec : `^${version}`
        if (!profileManifest.dsh.profile.bundles.includes(name)) profileManifest.dsh.profile.bundles.push(name)
        if (!spec.startsWith('link:')) writeFile(join(profileRoot, 'node_modules', name, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }))
      }
      writeFileSync(join(profileRoot, 'package.json'), JSON.stringify(profileManifest, null, 2))
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const run = async (command: 'add' | 'update' | 'remove', ...argv: string[]) => {
      const captured = capture()
      const status = await runProfilePluginCli(command, [...argv, '--home', home], captured.io, {
        pluginsRoot,
        runDsh: fakeDsh,
        seedsRoot: join(root, 'seeds'),
      })
      return { status, output: captured.output(), errors: captured.errors() }
    }

    beforeEach(() => {
      calls = []
    })

    it('installs a registry package at the version named in one spec, then leaves a satisfied range alone', async () => {
      const first = await run('add', 'dsh-plugin-example@1.2.0')
      expect(first.errors).toBe('')
      expect(first.output).toContain('add dsh-plugin-example@1.2.0 → profile probe')
      expect(calls).toEqual([['plugin', '--profile', 'probe', 'add', 'dsh-plugin-example@1.2.0']])
      expect(first.output).toContain('version    none → 1.2.0')
      const again = await run('add', 'dsh-plugin-example@^1')
      expect(again.output).toContain('up to date; nothing to restart')
      expect(calls).toHaveLength(1)
    })

    it('links any plugin directory through dsh plugin add link:, and reports the parts it ships', async () => {
      const external = join(root, 'elsewhere/@acme/notes')
      writeFile(
        join(external, 'package.json'),
        JSON.stringify({
          name: '@acme/notes',
          version: '0.3.0',
          main: './dist/index.js',
          exports: { '.': './dist/index.js', './client': './dist/client.js', './notes-api': './dist/notes-api.js', './package.json': './package.json' },
          dsh: { bundle: { patch: './cordis.patch.yml' }, client: { inject: [] } },
        }),
      )
      writeFile(join(external, 'cordis.patch.yml'), "- insert:\n    - id: acme-notes\n      name: '@acme/notes'\n")
      const added = await run('add', external)
      expect(added.errors).toBe('')
      expect(calls).toEqual([['plugin', '--profile', 'probe', 'add', `link:${external}`]])
      expect(added.output).toContain('source     local package')
      expect(added.output).toContain('row        acme-notes')
      expect(added.output).toContain('parts      host, client, ./notes-api')
      expect((await run('add', external)).output).toContain('up to date; nothing to restart')
      expect(calls).toHaveLength(1)
      const updated = await run('update', '@acme/notes')
      expect(updated.output).toContain('rebuild it in place')
      expect(calls).toHaveLength(1)
    })

    it('refuses a directory that is not a DSH bundle', async () => {
      writeFile(join(root, 'plain/package.json'), JSON.stringify({ name: 'plain' }))
      const result = await run('add', join(root, 'plain'))
      expect(result.status).toBe(1)
      expect(result.errors).toContain('declares no dsh.bundle')
    })

    it('refuses a version on an owned bundle', async () => {
      const result = await run('add', '@dshfiles/fixture-plugin@1.0.0')
      expect(result.status).toBe(1)
      expect(result.errors).toContain('takes no version')
    })

    it('updates a registry package within its range, to the latest, or to a named version', async () => {
      await run('add', 'dsh-plugin-example@1.2.0')
      const inRange = await run('update', 'dsh-plugin-example')
      expect(calls.at(-1)).toEqual(['plugin', '--profile', 'probe', 'update', 'dsh-plugin-example'])
      expect(inRange.output).toContain('version    1.2.0 → 1.5.0')
      expect(inRange.output).toContain('restart    Restart the DSH host process')
      await run('update', 'dsh-plugin-example', '--latest')
      expect(calls.at(-1)).toEqual(['plugin', '--profile', 'probe', 'update', '--latest', 'dsh-plugin-example'])
      const named = await run('update', 'dsh-plugin-example@2.0.0')
      expect(calls.at(-1)).toEqual(['plugin', '--profile', 'probe', 'add', 'dsh-plugin-example@2.0.0'])
      expect(named.output).toContain('version    1.5.0 → 2.0.0')
    })

    it('previews an update without running it', async () => {
      await run('add', 'dsh-plugin-example@1.2.0')
      const before = readProfile()
      const preview = await run('update', 'dsh-plugin-example', '--dry-run')
      expect(preview.output).toContain('run        dsh plugin --profile probe update dsh-plugin-example')
      expect(calls).toHaveLength(1)
      expect(readProfile()).toEqual(before)
    })

    it('refuses to update a plugin the profile does not have', async () => {
      const result = await run('update', 'dsh-plugin-example')
      expect(result.status).toBe(1)
      expect(result.errors).toContain('is not installed in profile probe')
    })

    it('removes a plugin with its row override, keeps the rest of the patch, and is idempotent', async () => {
      await run('add', 'dsh-plugin-example@1.2.0')
      writeFile(join(profileRoot, 'cordis.patch.yml'), `${profilePatch}- id: dsh-plugin-example\n  config:\n    mode: b\n`)
      const removed = await run('remove', 'dsh-plugin-example')
      expect(removed.errors).toBe('')
      expect(calls.at(-1)).toEqual(['plugin', '--profile', 'probe', 'remove', 'dsh-plugin-example'])
      expect(removed.output).toContain('row dsh-plugin-example override removed')
      expect(readProfile().patch).toBe(profilePatch)
      expect(JSON.parse(readProfile().manifest).dependencies).toEqual({})
      const again = await run('remove', 'dsh-plugin-example')
      expect(again.output).toContain('up to date; nothing to restart')
      expect(calls.at(-1)?.[3]).toBe('remove')
      expect(calls.filter(call => call[3] === 'remove')).toHaveLength(1)
    })

    it('warns when the checked-in seed would add a removed plugin back', async () => {
      writeFile(join(profileRoot, 'package.json'), manifest({ '@dshfiles/fixture-plugin': `link:${fixtureRoot}` }, ['@dshfiles/fixture-plugin']))
      writeFile(join(root, 'seeds/probe/package.json'), JSON.stringify({ dependencies: { '@dshfiles/fixture-plugin': 'link:../x' } }))
      const removed = await run('remove', '@dshfiles/fixture-plugin')
      expect(removed.output).toContain('source     owned bundle')
      expect(removed.output).toContain('the next profile-sync adds it back')
    })
  })
})
