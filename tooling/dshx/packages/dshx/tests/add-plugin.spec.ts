import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runAddPluginCli } from '../src/cli/add-plugin.js'
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
    const status = await runAddPluginCli(['@dshfiles/fixture-plugin', '--home', home, ...argv], run.io, { pluginsRoot })
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
    expect(run.output()).toContain('@dshfiles/goal-stall-guard → profile probe (dry run)')
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
})
