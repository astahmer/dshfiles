import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planRebuild } from '../src/checkout/rebuild.js'
import { syncCheckout } from '../src/checkout/sync.js'
import { runCli } from '../src/cli/run.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const describeRevision = (cwd: string, revset: string): string =>
  jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'description.first_line() ++ "\\n"').trim()
const commitOf = (cwd: string, revset: string): string => jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'commit_id').trim()

const writeFile = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe.skipIf(!jjAvailable)('dshx checkout sync against real jj', () => {
  let root: string
  let checkout: string
  let lander: string
  const sync = (dryRun = false, revision?: string) => {
    const input = { cwd: lander, workspace: 'default', bookmark: 'main', dryRun }
    if (revision === undefined) return syncCheckout(input)
    return syncCheckout({ ...input, revision })
  }
  /** Another workspace lands work on main, the way jj-integration's Rebase action or an agent does. */
  const land = (file: string, content: string, message: string): void => {
    jj(lander, 'new', 'main')
    writeFile(join(lander, file), content)
    jj(lander, 'commit', '-m', message)
    jj(lander, 'bookmark', 'set', 'main', '-r', '@-')
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'dshx-checkout-')))
    checkout = join(root, 'repo')
    lander = join(root, 'lander')
    // The test's own config, so the user's jj settings never leak in.
    process.env.JJ_CONFIG = join(root, 'jj-config.toml')
    writeFile(process.env.JJ_CONFIG, '[user]\nname = "Test"\nemail = "test@example.com"\n')
    jj(root, 'git', 'init', checkout)
    writeFile(join(checkout, 'shared.txt'), 'one\n')
    jj(checkout, 'commit', '-m', 'base')
    jj(checkout, 'bookmark', 'create', 'main', '-r', '@-')
    jj(checkout, 'workspace', 'add', lander, '--name', 'lander', '-r', 'main')
  })

  afterEach(() => {
    delete process.env.JJ_CONFIG
    rmSync(root, { recursive: true, force: true })
  })

  it('moves local edits onto the new main and keeps them on disk', async () => {
    writeFile(join(checkout, '.secret.json'), '{"token":"local"}\n')
    land('feature.txt', 'feature\n', 'feat: landed elsewhere')

    const result = await sync()
    expect(result).toMatchObject({ status: 'synced', kept: [{ description: '' }], absorbed: [], changedFiles: ['feature.txt'] })
    expect(describeRevision(checkout, '@-')).toBe('feat: landed elsewhere')
    expect(readFileSync(join(checkout, '.secret.json'), 'utf8')).toBe('{"token":"local"}\n')
    expect(readFileSync(join(checkout, 'feature.txt'), 'utf8')).toBe('feature\n')
    expect(jj(checkout, 'status')).toContain('.secret.json')
    expect(await sync()).toMatchObject({ status: 'up-to-date' })
  })

  it('syncs to the exact verified commit without following a bookmark that advanced later', async () => {
    land('verified.txt', 'verified feature\n', 'feat: verified')
    const verifiedCommitId = commitOf(lander, 'main')
    land('later.txt', 'later work\n', 'feat: later work')
    const latestMainCommitId = commitOf(lander, 'main')
    expect(latestMainCommitId).not.toBe(verifiedCommitId)

    const result = await sync(false, verifiedCommitId)

    expect(result).toMatchObject({ status: 'synced', bookmark: 'main', to: verifiedCommitId, changedFiles: ['verified.txt'] })
    expect(commitOf(checkout, '@-')).toBe(verifiedCommitId)
    expect(commitOf(lander, 'main')).toBe(latestMainCommitId)
    expect(readFileSync(join(checkout, 'verified.txt'), 'utf8')).toBe('verified feature\n')
    expect(() => readFileSync(join(checkout, 'later.txt'))).toThrow()
  })

  it('refuses an exact commit that is no longer on the configured bookmark', async () => {
    const originalMainCommitId = commitOf(lander, 'main')
    land('verified.txt', 'verified feature\n', 'feat: verified')
    const verifiedCommitId = commitOf(lander, 'main')
    const checkoutBefore = commitOf(checkout, 'default@')
    jj(lander, 'bookmark', 'set', '--allow-backwards', 'main', '-r', originalMainCommitId)

    await expect(sync(false, verifiedCommitId)).rejects.toMatchObject({ code: 'revision-not-on-bookmark' })
    expect(commitOf(checkout, 'default@')).toBe(checkoutBefore)
  })

  it('repairs missing plugin bundles when the checkout is already on main', async () => {
    const directory = join(checkout, 'plugins/@dshfiles/attachment-gallery')
    writeFile(join(checkout, 'plugins/package.json'), JSON.stringify({ name: 'dshfiles-plugins', private: true }))
    writeFile(join(checkout, 'plugins/pnpm-workspace.yaml'), "packages:\n  - '@dshfiles/*'\n")
    writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name: '@dshfiles/attachment-gallery', scripts: { build: 'node build.mjs' }, dsh: { client: { platform: 'web' } } }),
    )
    writeFile(
      join(directory, 'build.mjs'),
      [
        "import { mkdirSync, writeFileSync } from 'node:fs'",
        "mkdirSync('dist', { recursive: true })",
        "writeFileSync('dist/index.js', 'export {}\\n')",
        "writeFileSync('dist/client.js', 'export {}\\n')",
      ].join('\n'),
    )

    const preview = await sync(true)
    expect(preview).toMatchObject({
      status: 'would-sync',
      changedFiles: [],
      rebuilt: { dshx: false, plugins: ['@dshfiles/attachment-gallery'] },
      plugins: [{ name: '@dshfiles/attachment-gallery', host: true, client: true }],
      restart: { needed: true, reasons: ['@dshfiles/attachment-gallery Host bundle changed'] },
    })
    expect(() => readFileSync(join(directory, 'dist/index.js'))).toThrow()

    const result = await sync()
    expect(result).toMatchObject({
      status: 'synced',
      changedFiles: [],
      rebuilt: { dshx: false, plugins: ['@dshfiles/attachment-gallery'] },
      plugins: [{ name: '@dshfiles/attachment-gallery', host: true, client: true }],
      restart: { needed: true, reasons: ['@dshfiles/attachment-gallery Host bundle changed'] },
    })
    expect(readFileSync(join(directory, 'dist/index.js'), 'utf8')).toBe('export {}\n')
    expect(readFileSync(join(directory, 'dist/client.js'), 'utf8')).toBe('export {}\n')
  })

  it('absorbs described revisions main already holds and keeps the local edits above them', async () => {
    writeFile(join(checkout, 'feature.txt'), 'feature\n')
    jj(checkout, 'commit', '-m', 'feat: drafted here')
    writeFile(join(checkout, '.secret.json'), 'local\n')
    land('feature.txt', 'feature\n', 'feat: landed from a thread')

    const result = await sync()
    expect(result).toMatchObject({ status: 'synced', absorbed: [{ description: 'feat: drafted here' }], kept: [{ description: '' }] })
    expect(describeRevision(checkout, '@-')).toBe('feat: landed from a thread')
    expect(readFileSync(join(checkout, '.secret.json'), 'utf8')).toBe('local\n')
  })

  it('undoes a conflicting rebase, leaves the checkout untouched and names the files', async () => {
    writeFile(join(checkout, 'shared.txt'), 'local\n')
    jj(checkout, 'status')
    land('shared.txt', 'main\n', 'feat: main edit')
    const before = commitOf(checkout, 'default@')

    const result = await sync()
    expect(result).toMatchObject({ status: 'conflicted', conflicts: ['shared.txt'] })
    expect(result.hint).toContain('Nothing changed')
    expect(commitOf(checkout, 'default@')).toBe(before)
    expect(readFileSync(join(checkout, 'shared.txt'), 'utf8')).toBe('local\n')
    expect(jj(checkout, 'log', '--no-graph', '-r', 'conflicts()', '-T', 'change_id')).toBe('')
  })

  it('refuses described work main does not hold yet', async () => {
    writeFile(join(checkout, 'draft.txt'), 'draft\n')
    jj(checkout, 'commit', '-m', 'feat: not landed')
    land('feature.txt', 'feature\n', 'feat: landed elsewhere')
    const before = commitOf(checkout, 'default@')

    const result = await sync()
    expect(result).toMatchObject({ status: 'refused', unlanded: [{ description: 'feat: not landed' }] })
    expect(result.hint).toContain('Rebase it onto main')
    expect(commitOf(checkout, 'default@')).toBe(before)
    expect(describeRevision(checkout, 'default@-')).toBe('feat: not landed')
  })

  it('refuses to rebase revisions another workspace builds on', async () => {
    writeFile(join(checkout, 'draft.txt'), 'draft\n')
    jj(checkout, 'commit', '-m', 'wip')
    jj(checkout, 'workspace', 'add', join(root, 'child'), '--name', 'child', '-r', '@-')
    land('feature.txt', 'feature\n', 'feat: landed elsewhere')

    const result = await sync()
    expect(result.status).toBe('refused')
    expect(result.hint).toContain('child')
  })

  it('checks out a working copy another workspace rewrote before moving it', async () => {
    writeFile(join(checkout, 'local.txt'), 'local\n')
    jj(checkout, 'status')
    writeFile(join(lander, 'moved.txt'), 'moved\n')
    jj(lander, 'squash', '--into', 'default@')
    land('feature.txt', 'feature\n', 'feat: landed elsewhere')

    expect(await sync()).toMatchObject({ status: 'synced', updatedStale: true })
    expect(readFileSync(join(checkout, 'moved.txt'), 'utf8')).toBe('moved\n')
    expect(readFileSync(join(checkout, 'local.txt'), 'utf8')).toBe('local\n')
    expect(describeRevision(checkout, '@-')).toBe('feat: landed elsewhere')
  })

  it('reports a dry run without touching the repository or the files', async () => {
    writeFile(join(checkout, 'local.txt'), 'local\n')
    jj(checkout, 'status')
    land('feature.txt', 'feature\n', 'feat: landed elsewhere')
    const before = commitOf(checkout, 'default@')

    const result = await sync(true)
    expect(result).toMatchObject({ status: 'would-sync', dryRun: true, kept: [{ description: '' }], changedFiles: ['feature.txt'] })
    expect(commitOf(checkout, 'default@')).toBe(before)
    expect(jj(checkout, 'status')).not.toContain('stale')
    expect(() => readFileSync(join(checkout, 'feature.txt'))).toThrow()
  })

  it('reconciles the web profile with the checkout reconciler when the seed changed, unless DSH runs another checkout', async () => {
    land(
      'scripts/profile-sync.ts',
      "process.getBuiltinModule('node:fs').appendFileSync('profile-sync.log', `${process.argv.slice(2).join(' ')}\\n`)\n",
      'feat: reconciler',
    )
    land('profiles/web/package.json', '{}\n', 'feat: seed')
    const running = process.env.DSHFILES_DIR
    try {
      process.env.DSHFILES_DIR = lander
      expect((await sync()).restart.reasons).toEqual([`the profile seed changed here, but DSH runs from ${lander}; its next start syncs from there`])
      expect(() => readFileSync(join(checkout, 'profile-sync.log'))).toThrow()

      land('profiles/web/package.json', '{"changed":true}\n', 'feat: seed again')
      process.env.DSHFILES_DIR = checkout
      expect((await sync()).restart).toEqual({ needed: true, reasons: ['the web profile was synced from the changed seed: restart to apply'] })
      expect(readFileSync(join(checkout, 'profile-sync.log'), 'utf8')).toBe('--profile web\n')
    } finally {
      if (running === undefined) delete process.env.DSHFILES_DIR
      else process.env.DSHFILES_DIR = running
    }
  })

  it('prints a JSON envelope and a usage error from the CLI', async () => {
    land('feature.txt', 'feature\n', 'feat: landed elsewhere')
    const run = async (argv: readonly string[]) => {
      const stdout = new PassThrough()
      let out = ''
      stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
      const code = await runCli(argv, { io: { stdin: new PassThrough(), stdout, stderr: new PassThrough() } })
      return { code, envelope: JSON.parse(out) }
    }
    expect(await run(['checkout', 'sync', '--cwd', lander, '--dry-run', '--json'])).toMatchObject({
      code: 0,
      envelope: { command: 'checkout sync', ok: true, data: { status: 'would-sync' } },
    })
    const revision = commitOf(lander, 'main')
    expect(await run(['checkout', 'sync', '--cwd', lander, '--revision', revision, '--dry-run', '--json'])).toMatchObject({
      code: 0,
      envelope: { command: 'checkout sync', ok: true, data: { status: 'would-sync', to: revision } },
    })
    expect(await run(['checkout', 'sync', '--cwd', lander, '--revision', 'not-a-commit', '--json'])).toMatchObject({
      code: 2,
      envelope: { ok: false, error: { code: 'usage' } },
    })
    expect(await run(['checkout', 'sync', '--cwd', lander, '--workspace', 'missing', '--json'])).toMatchObject({
      code: 1,
      envelope: { ok: false, error: { code: 'no-workspace' } },
    })
  })
})

describe('checkout rebuild selection', () => {
  let root: string
  const plugin = (
    name: string,
    dependencies: Record<string, string> = {},
    maps: { readonly index?: readonly string[]; readonly client?: readonly string[] } = {},
  ): void => {
    const directory = join(root, 'plugins/@dshfiles', name)
    const hasClientBundle = maps.client !== undefined
    writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: `@dshfiles/${name}`,
        scripts: { build: 'dshx build' },
        dependencies,
        dsh: hasClientBundle ? { client: { platform: 'web' } } : undefined,
      }),
    )
    writeFile(join(directory, 'dist', 'index.js'), 'export {}\n')
    if (hasClientBundle) writeFile(join(directory, 'dist', 'client.js'), 'export {}\n')
    for (const [bundle, sources] of Object.entries(maps)) writeFile(join(directory, 'dist', `${bundle}.js.map`), JSON.stringify({ version: 3, sources }))
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'dshx-rebuild-')))
    plugin('plugin-ui', {}, { client: ['../src/button.tsx'] })
    plugin('panel', { '@dshfiles/plugin-ui': 'workspace:*' }, { index: ['../src/host.ts'], client: ['../src/client.tsx'] })
    plugin('sidebar', { '@dshfiles/panel': 'workspace:*' }, { client: ['../src/client.tsx'] })
    plugin('settings', {}, { index: ['../src/host.ts', '../../../../tooling/dshx/packages/dshx/dist/host/define.js'] })
    plugin('quiet', { zod: '^4.0.0' }, { index: ['../src/host.ts'] })
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('selects missing bundle outputs without rebuilding dependants', () => {
    rmSync(join(root, 'plugins/@dshfiles/panel/dist/client.js'))
    const plan = planRebuild({ root, changedFiles: [] })
    expect(plan.plugins).toEqual([{ name: '@dshfiles/panel', host: false, client: true }])
  })

  it('picks changed plugins, their dependants and plugins bundling changed dshx runtime code', () => {
    const plan = planRebuild({
      root,
      changedFiles: [
        'plugins/@dshfiles/plugin-ui/src/button.tsx',
        'plugins/@dshfiles/quiet/README.md',
        'plugins/@dshfiles/quiet/src/host.test.ts',
        'tooling/dshx/packages/dshx/src/host/define.ts',
        'tooling/dshx/packages/dshx/src/cli/run.ts',
        'plugins/pnpm-lock.yaml',
        'pnpm-lock.yaml',
      ],
    })
    expect(plan.installRoots).toEqual(['.', 'plugins'])
    expect(plan.dshx).toBe(true)
    expect(plan.profileChanged).toBe(false)
    expect(plan.plugins).toEqual([
      { name: '@dshfiles/panel', host: false, client: true },
      { name: '@dshfiles/plugin-ui', host: false, client: true },
      { name: '@dshfiles/settings', host: true, client: false },
      { name: '@dshfiles/sidebar', host: false, client: true },
    ])
  })

  it('predicts a restart for Host sources, manifests and sources the last build never saw', () => {
    const plan = planRebuild({
      root,
      changedFiles: [
        'plugins/@dshfiles/panel/src/host.ts',
        'plugins/@dshfiles/quiet/src/new-file.ts',
        'plugins/@dshfiles/sidebar/cordis.patch.yml',
        'profiles/web/package.json',
      ],
    })
    expect(plan.dshx).toBe(false)
    expect(plan.profileChanged).toBe(true)
    expect(plan.plugins.map(entry => [entry.name, entry.host])).toEqual([
      ['@dshfiles/panel', true],
      ['@dshfiles/quiet', true],
      ['@dshfiles/sidebar', true],
    ])
  })
})
