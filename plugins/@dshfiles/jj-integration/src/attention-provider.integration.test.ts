import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as activityTimeline from '@dshfiles/activity-timeline'
import { attentionApi, type AttentionList } from '@dshfiles/activity-timeline/attention-api'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LAND_BLOCKED_SOURCE, READY_TO_LAND_SOURCE } from './attention-provider.js'
import { JjIntegrationTestHost, type JjIntegrationTestHarness } from './host-test-harness.js'

const jj = JjIntegrationTestHost.jj
const jjAvailable = spawnSync('jj', ['--version']).status === 0

/** The Inbox page calls the inbox as a browser does; a plugin caller is enough for list and act. */
const inboxClient = (harness: JjIntegrationTestHarness) => createHostApiClient(harness.host.ctx, attentionApi, '@test/inbox-page')

/** The real activity-timeline inbox next to the real jj-integration Host half, both on one test Host with real jj. */
describe.skipIf(!jjAvailable)('jj-integration inbox provider', () => {
  let root: string
  let harness: JjIntegrationTestHarness
  let inbox: ReturnType<typeof inboxClient>
  let previousHome: string | undefined

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-attention-')))
    previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, 'home')
    harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '', autoIntegrationScope: 'isolated', askAgentToFixLanding: false } })
    await harness.host.ctx.plugin(Storage)
    await harness.host.ctx.plugin(StorageJson, { root: join(root, 'storage') })
    await harness.host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
    await harness.host.mount(activityTimeline, { packageId: '@dshfiles/activity-timeline', native: true })
    inbox = inboxClient(harness)
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  })

  /** Rescan the repositories the way the Land view's Refresh does, then let the providers reconcile. */
  const rescan = async (): Promise<void> => {
    await harness.api.refreshRepositories({})
    harness.host.ctx.emit('dshfiles/attention/ready', { version: 1 })
  }

  const until = async (view: 'needs-you' | 'other' | 'closed', done: (list: AttentionList) => boolean, poke?: () => Promise<void>): Promise<AttentionList> => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const list = await inbox.list({ view })
      if (done(list)) return list
      if (attempt % 40 === 39) await poke?.()
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
    }
    throw new Error(`inbox view ${view} never reached the expected state`)
  }

  it('lists an idle described thread as Ready to land, lands it on Land, and resolves the item', async () => {
    harness.setSession('session-ready', { running: false, questions: 0 })
    const repo = join(root, 'ready')
    JjIntegrationTestHost.initRepository(repo)
    const path = await harness.provisionThread(repo, { sessionIds: ['session-ready'] })
    await rescan()

    // provision starts a scan before the harness attaches the Session, so a reconcile may still name the workspace until
    // the next one, which only a rescan or the slow safety pass brings.
    const owned = (entry: AttentionList['items'][number]) => entry.source === READY_TO_LAND_SOURCE && entry.subject.kind === 'session'
    const listed = await until('other', list => list.items.some(owned), rescan)
    const item = listed.items.find(owned)
    expect(item).toMatchObject({
      dedupeKey: `${path}:ready`,
      subject: { kind: 'session', id: 'session-ready' },
      severity: 'ready',
      verbs: ['Land', 'Open', 'Done', 'Snooze', 'MuteSource'],
    })
    expect(item?.reason).toMatch(/is ready to land: 1 described revision not on the bookmark yet\.$/u)

    const outcome = await inbox.act({ id: item?.id ?? '', verb: 'Land' })
    expect(outcome).toMatchObject({ ok: true, message: 'Landed 1 revision on main.' })
    expect(jj(repo, 'log', '--no-graph', '-r', 'main', '-T', 'description.first_line()')).toMatch(/^feat: add /u)

    const closed = await until('closed', list => list.items.some(entry => entry.dedupeKey === `${path}:ready` && entry.resolvedAt !== null))
    expect(closed.items.find(entry => entry.dedupeKey === `${path}:ready`)?.source).toBe(READY_TO_LAND_SOURCE)
  }, 180_000)

  it('resolves the Ready to land item as soon as the Changes facet lands through the land method', async () => {
    harness.setSession('session-facet', { running: false, questions: 0 })
    const repo = join(root, 'facet')
    JjIntegrationTestHost.initRepository(repo)
    const path = await harness.provisionThread(repo, { sessionIds: ['session-facet'] })
    await rescan()
    await until('other', list => list.items.some(item => item.dedupeKey === `${path}:ready`))

    // The facet (and the Land view) call `land` directly, not the inbox verb; no rescan or safety tick follows.
    expect(await harness.api.land({ path, sessionId: 'session-facet' })).toMatchObject({ status: 'landed' })
    const closed = await until('closed', list => list.items.some(entry => entry.dedupeKey === `${path}:ready` && entry.resolvedAt !== null))
    expect(closed.items.find(entry => entry.dedupeKey === `${path}:ready`)?.source).toBe(READY_TO_LAND_SOURCE)
  }, 180_000)

  it('lists a conflicted thread as Failed, refuses Retry while it conflicts, and lands and resolves it once fixed', async () => {
    harness.setSession('session-conflict', { running: false, questions: 0 })
    const repo = join(root, 'conflict')
    JjIntegrationTestHost.initRepository(repo)
    const path = await harness.provisionThread(repo, { sessionIds: ['session-conflict'], file: 'shared.txt' })
    writeFileSync(join(path, 'shared.txt'), 'thread side\n')
    writeFileSync(join(repo, 'shared.txt'), 'main side\n')
    jj(repo, 'describe', '-m', 'feat: main side')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@')
    jj(repo, 'new')
    jj(path, 'rebase', '-r', '@', '-d', 'main')
    await rescan()

    const listed = await until('needs-you', list => list.items.some(item => item.source === LAND_BLOCKED_SOURCE))
    const item = listed.items.find(entry => entry.source === LAND_BLOCKED_SOURCE)
    expect(item).toMatchObject({
      dedupeKey: `${path}:conflict`,
      subject: { kind: 'session', id: 'session-conflict' },
      severity: 'failed',
      verbs: ['Retry', 'Open', 'Done', 'Snooze', 'MuteSource'],
    })
    expect(item?.reason).toMatch(/has 1 conflicted revision; Land is blocked\.$/u)

    // Retry while the conflict stands lands nothing and says why.
    expect(await inbox.act({ id: item?.id ?? '', verb: 'Retry' })).toMatchObject({ ok: false })

    // The user resolves the conflict in the workspace and retries: the land goes through and the item closes.
    writeFileSync(join(path, 'shared.txt'), 'resolved\n')
    jj(path, 'status')
    expect(await inbox.act({ id: item?.id ?? '', verb: 'Retry' })).toMatchObject({ ok: true, message: 'Landed 1 revision on main.' })
    await until('needs-you', list => !list.items.some(entry => entry.dedupeKey === `${path}:conflict`))
    const closed = await inbox.list({ view: 'closed' })
    expect(closed.items.find(entry => entry.dedupeKey === `${path}:conflict`)?.resolvedAt).not.toBeNull()
  }, 180_000)
})
