import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DshUpdateModel } from './dsh-update-model.js'
import { JjIntegrationTestHost, type JjIntegrationTestHarness } from './host-test-harness.js'

/**
 * Update DSH against real jj: an origin and the checkout "DSH runs from" (a colocated clone with its default
 * workspace) in a temporary folder. `dshx checkout sync` is answered by the harness; `dshx checkout plan` runs for real.
 */
const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '', JJ_USER: 'Test', JJ_EMAIL: 'test@example.com' }
const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })
const commitAt = (cwd: string, revset: string): string => jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'commit_id').trim()

const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> => {
  const started = Date.now()
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

const advance = (repo: string, file: string, message: string): void => {
  writeFileSync(join(repo, file), `${message}\n`)
  jj(repo, 'commit', '-m', message)
  jj(repo, 'bookmark', 'set', 'main', '-r', '@-')
}

const synced = (restartNeeded: boolean) =>
  JSON.stringify({
    ok: true,
    data: {
      status: 'synced',
      rebuilt: { plugins: ['@demo/hello'] },
      plugins: [{ name: '@demo/hello', host: restartNeeded, client: true }],
      restart: { needed: restartNeeded },
      conflicts: [],
      hint: null,
    },
  })

describe.skipIf(!jjAvailable)('Update DSH', () => {
  let root: string
  let origin: string
  let checkout: string
  let harness: JjIntegrationTestHarness | undefined

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-dsh-update-')))
    origin = join(root, 'origin')
    checkout = join(root, 'checkout')
    execFileSync('jj', ['git', 'init', '--colocate', origin], { stdio: 'ignore', env })
    advance(origin, 'base.txt', 'chore: base')
    execFileSync('jj', ['git', 'clone', origin, checkout], { stdio: 'ignore', env })
  })

  afterEach(async () => {
    await harness?.host.dispose?.()
    harness = undefined
    rmSync(root, { recursive: true, force: true })
  })

  it('lists What’s new after a fetch, applies it through checkout sync and reports the restart without restarting', async () => {
    harness = await JjIntegrationTestHost.start({ settings: { updateCheckout: checkout }, checkoutSync: async () => synced(true) })
    const before = await harness.api.updateCheck({ fetch: true })
    expect(before).toMatchObject({ origin: 'same', incomingCount: 0, canApply: false, unavailable: null })
    expect(DshUpdateModel.headline(before)).toBe('DSH is up to date')

    advance(origin, 'feature.txt', 'feat: something new')
    const news = await harness.api.updateCheck({ fetch: true })
    expect(news.incoming.map(revision => revision.description)).toEqual(['feat: something new'])
    expect(news).toMatchObject({ incomingCount: 1, canApply: true, blocked: null, planError: null, plan: { changedFiles: 1, restartNeeded: false } })
    expect(news.commands.at(-1)).toContain('checkout sync --workspace default --bookmark main')

    const started = await harness.api.updateApply({ confirm: true })
    expect(started.job?.state).toBe('running')
    await waitFor(async () => (await harness?.api.updateCheck({ fetch: false }))?.job?.state !== 'running')
    const after = await harness.api.updateCheck({ fetch: false })
    expect(after.job).toMatchObject({ state: 'done', phase: 'done', sync: { restartNeeded: true, pluginsRebuilt: ['@demo/hello'] } })
    expect(after.job?.message).toContain('Restart when idle')
    expect(commitAt(checkout, 'main')).toBe(commitAt(origin, 'main'))
    expect(harness.checkoutSyncs).toHaveLength(1)
    expect(harness.events.map(event => event.type)).toContain('workspace.dsh_updated')
  })

  it('refuses diverged history with the commands to fix it, and changes nothing', async () => {
    harness = await JjIntegrationTestHost.start({ settings: { updateCheckout: checkout }, checkoutSync: async () => synced(false) })
    advance(origin, 'remote.txt', 'feat: remote work')
    jj(checkout, 'new', 'main')
    advance(checkout, 'local.txt', 'feat: local work')
    const localMain = commitAt(checkout, 'main')

    const check = await harness.api.updateCheck({ fetch: true })
    expect(check).toMatchObject({ origin: 'diverged', canApply: false })
    expect(check.localOnly).toBeGreaterThan(0)
    expect(check.blocked).toContain('jj rebase -b main -d main@origin')

    await harness.api.updateApply({ confirm: true })
    await waitFor(async () => (await harness?.api.updateCheck({ fetch: false }))?.job?.state !== 'running')
    expect((await harness.api.updateCheck({ fetch: false })).job).toMatchObject({ state: 'refused' })
    expect(jj(checkout, '--ignore-working-copy', 'log', '--no-graph', '-r', 'bookmarks(exact:"main")', '-T', 'commit_id ++ "\\n"')).toContain(localMain)
    expect(harness.checkoutSyncs).toHaveLength(0)
  })

  it('previews what landing a thread would change in the running DSH without landing it', async () => {
    harness = await JjIntegrationTestHost.start({ settings: { updateCheckout: checkout } })
    const thread = join(root, 'thread')
    jj(checkout, 'workspace', 'add', thread, '--name', 'thread-abc123', '-r', 'main')
    writeFileSync(join(thread, 'change.txt'), 'thread change\n')
    jj(thread, 'commit', '-m', 'feat: thread change')
    const mainBefore = commitAt(checkout, 'main')

    const impact = await harness.api.landImpact({ path: thread })
    expect(impact).toMatchObject({ applies: true, reason: null, checkout: { workspace: 'default' }, plan: { changedFiles: 1, restartNeeded: false } })
    expect(impact.head).toBe(commitAt(thread, '@-'))
    expect(DshUpdateModel.renderImpact(impact)).toContain('Nothing changes until the thread lands')
    expect(commitAt(checkout, 'main')).toBe(mainBefore)

    const empty = await harness.api.landImpact({ path: checkout })
    expect(empty).toMatchObject({ applies: false })
    expect(empty.reason).toContain('nothing to land')
  })

  it('says why and what to set when DSH does not run from a jj checkout', async () => {
    harness = await JjIntegrationTestHost.start({ settings: { updateCheckout: root } })
    const check = await harness.api.updateCheck({ fetch: false })
    expect(check.checkout).toBeNull()
    expect(check.unavailable).toContain('Update checkout')
    expect(await harness.runTool('dsh_update_check', { fetch: false }, { sessionId: 'session-agent', cwd: root })).toContain('Update checkout')
  })

  it('needs an explicit confirm to apply', async () => {
    harness = await JjIntegrationTestHost.start({ settings: { updateCheckout: checkout } })
    expect(await harness.wire('updateApply', {})).toMatchObject({ code: expect.any(String) })
  })
})
