import * as Schema from 'effect/Schema'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.js'
import { decodeJson } from '../src/json.js'

const capture = () => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let out = ''
  let err = ''
  stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
  stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')))
  return { io: { stdin: new PassThrough(), stdout, stderr }, output: () => out, errors: () => err }
}

const successEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  command: Schema.Literal('init'),
  ok: Schema.Literal(true),
  data: Schema.Struct({
    profile: Schema.String,
    profileRoot: Schema.String,
    packs: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
    plugins: Schema.Array(Schema.String),
    suppliers: Schema.Array(Schema.String),
    kept: Schema.Array(Schema.String),
    created: Schema.Boolean,
    linked: Schema.Array(Schema.String),
    upToDate: Schema.Boolean,
    commands: Schema.Array(Schema.String),
    files: Schema.Array(Schema.Struct({ path: Schema.String, change: Schema.String })),
    restart: Schema.NullOr(Schema.String),
    dryRun: Schema.Boolean,
  }),
})
const failureEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  command: Schema.Literal('init'),
  ok: Schema.Literal(false),
  error: Schema.Struct({ code: Schema.String, message: Schema.String, hint: Schema.String }),
})
const profileManifest = Schema.Struct({
  dependencies: Schema.Record(Schema.String, Schema.String),
  dsh: Schema.Struct({ profile: Schema.Struct({ bundles: Schema.Array(Schema.String) }) }),
})

const CORE = ['thread-sidebar', 'main-tabs', 'chat', 'rich-composer', 'session-controller', 'settings-shell', 'onboarding', 'ai-accounts'].map(
  name => `@dshfiles/${name}`,
)

describe('dshx init', () => {
  let home: string
  const profileRoot = () => join(home, 'profiles/probe-init')
  const init = async (...argv: string[]) => {
    const run = capture()
    const status = await runCli(['init', '--profile', 'probe-init', '--home', home, ...argv], { io: run.io })
    return { status, output: run.output(), errors: run.errors() }
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshx-init-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('prints the composed plugins and the profile-sync command in a dry run and writes nothing', async () => {
    const result = await init('--packs', 'versioning', '--dry-run')
    expect(result.errors).toBe('')
    expect(result.status).toBe(0)
    expect(result.output).toContain('init profile probe-init (dry run)')
    expect(result.output).toContain('packs      core, versioning')
    for (const plugin of [...CORE, '@dshfiles/jj-integration', '@dshfiles/session-undo']) expect(result.output).toContain(`plugin     ${plugin}`)
    expect(result.output).toMatch(/run {8}\S+ \S+scripts\/profile-sync\.ts --profile probe-init --home \S+ --bundle @dshfiles\/thread-sidebar/)
    expect(result.output).toContain('package.json (new profile file)')
    expect(readdirSync(home)).toEqual([])
  })

  it('exits 2 and lists the packs when one is unknown', async () => {
    const result = await init('--packs', 'versioning,nope', '--dry-run')
    expect(result.status).toBe(2)
    expect(result.errors).toContain('Unknown pack: nope.')
    expect(result.errors).toContain('core, transcript, versioning, github, planning, accounts, agents, files, observe, knowledge, develop')
  })

  it('always composes Core, even when it is not named', async () => {
    const result = await init('--packs', 'knowledge', '--dry-run', '--json')
    const envelope = decodeJson(successEnvelope, result.output)
    expect(envelope.data.packs.map(pack => pack.id)).toEqual(['core', 'knowledge'])
    expect(envelope.data.plugins).toEqual(expect.arrayContaining([...CORE, '@dshfiles/memory']))
  })

  it('prints the shared envelope with --json, for a plan and for an error', async () => {
    const plan = decodeJson(successEnvelope, (await init('--packs', 'versioning', '--dry-run', '--json')).output)
    expect(plan.data).toMatchObject({ profile: 'probe-init', created: true, upToDate: false, dryRun: true, kept: [] })
    expect(plan.data.commands).toHaveLength(1)
    const failed = await init('--packs', 'nope', '--json')
    expect(failed.status).toBe(2)
    expect(decodeJson(failureEnvelope, failed.output).error.code).toBe('usage')
  })

  it('refuses to change a profile without --yes when it cannot ask', async () => {
    const result = await init('--packs', 'versioning')
    expect(result.status).toBe(2)
    expect(result.errors).toContain('Pass --yes to apply, or --dry-run to preview.')
    expect(existsSync(profileRoot())).toBe(false)
  })

  it('refuses a profile directory without a manifest, with the dshx add hint', async () => {
    mkdirSync(profileRoot(), { recursive: true })
    const result = await init('--packs', 'versioning', '--dry-run')
    expect(result.status).toBe(1)
    expect(result.errors).toContain('fix: Create it first (dsh --profile probe-init), or pass --profile <name>.')
  })

  it('refuses a profile composed differently unless --extend is passed', async () => {
    mkdirSync(profileRoot(), { recursive: true })
    const manifest = { name: 'dsh-profile-probe-init', private: true, dependencies: {}, dsh: { profile: { bundles: ['@dshfiles/backlog'] } } }
    writeFileSync(join(profileRoot(), 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const refused = await init('--packs', 'versioning', '--dry-run')
    expect(refused.status).toBe(1)
    expect(refused.errors).toContain('1 outside these packs (@dshfiles/backlog)')
    expect(refused.errors).toContain('Pass --extend')
    const extended = await init('--packs', 'versioning', '--dry-run', '--extend')
    expect(extended.status).toBe(0)
    expect(extended.output).toContain('kept       @dshfiles/backlog (outside these packs)')
  })

  it('creates the profile, links the packs once, and reports up to date on a second run', async () => {
    const first = await init('--packs', 'versioning', '--yes')
    expect(first.status, `${first.output}\n${first.errors}`).toBe(0)
    const manifestText = readFileSync(join(profileRoot(), 'package.json'), 'utf8')
    const manifest = decodeJson(profileManifest, manifestText)
    expect(manifest.dsh.profile.bundles).toEqual(expect.arrayContaining(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...CORE, '@dshfiles/jujutsu']))
    expect(manifest.dependencies['@dshfiles/jujutsu']).toMatch(/^link:.*plugins\/@dshfiles\/jujutsu$/u)

    const second = await init('--packs', 'versioning', '--yes')
    expect(second.status).toBe(0)
    expect(second.output).toContain('up to date; nothing to restart')
    expect(second.output).not.toContain('run ')
    expect(readFileSync(join(profileRoot(), 'package.json'), 'utf8')).toBe(manifestText)
  }, 240_000)
})
