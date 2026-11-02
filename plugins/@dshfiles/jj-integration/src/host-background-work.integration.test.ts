import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JjIntegrationTestHost, type JjIntegrationTestHarness } from './host-test-harness.js'

/**
 * Characterization for the Effect-native rewrite (plans/effect-native/reviews/vcs-multihost.md §4 step 0, jj-int b/c):
 * the Host wiring of deferred integrations (a Session event retries 1.5 s after the thread went quiet, a 30 s
 * fallback catches unannounced idleness, waiting errors keep the entry, other errors settle it) and the checkout sync
 * queue (one sync at a time, later lands of a repository coalesced into one sync of the newest revision).
 *
 * The 1.5 s settle delay runs on real timers; only the 30 s fallback `setInterval` is faked, before the Host mounts.
 */

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const wait = (ms: number) => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

const waitFor = async (condition: () => boolean, timeoutMs = 20_000): Promise<number> => {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('condition not met in time')
    await wait(25)
  }
  return Date.now() - startedAt
}

const deferred = <Value>() => {
  let resolveValue: (value: Value) => void = () => undefined
  const promise = new Promise<Value>(resolvePromise => {
    resolveValue = resolvePromise
  })
  return { promise, resolve: resolveValue }
}

const syncResult = (status: string) =>
  JSON.stringify({ ok: true, data: { status, rebuilt: { plugins: [] }, plugins: [], restart: { needed: false }, conflicts: [], hint: null } })

describe.skipIf(!jjAvailable)('jj-integration background work', () => {
  let root: string
  let repo: string
  let harness: JjIntegrationTestHarness | undefined

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-background-')))
    repo = join(root, 'repo')
    JjIntegrationTestHost.initRepository(repo)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await harness?.dispose()
    harness = undefined
    rmSync(`${repo}-threads`, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  const eventTypes = (from = 0): readonly string[] => (harness?.events.slice(from) ?? []).map(event => event.type)
  const cancelStatus = async (path: string): Promise<string | undefined> => (await harness?.api.cancelQueuedLand({ path }))?.status

  describe('deferred integration', () => {
    it('keeps a busy thread queued, then lands it 1.5 s after a Session event once it is idle', async () => {
      harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '' } })
      harness.setSession('session-busy', { running: true, questions: 0 })
      const path = await harness.provisionThread(repo, { sessionIds: ['session-busy'] })

      expect(await harness.wire('queueLand', { path, sessionId: 'session-busy' })).toBe('ok')
      await wait(1_000)
      expect(eventTypes()).toContain('workspace.integration_queued')
      expect(eventTypes()).not.toContain('workspace.rebase_landed')

      harness.setSession('session-busy', { running: false, questions: 0 })
      harness.emitSessionEvent('session-busy')
      await wait(1_000)
      expect(eventTypes()).not.toContain('workspace.rebase_landed')
      const elapsed = await waitFor(() => eventTypes().includes('workspace.rebase_landed'))
      expect(elapsed).toBeLessThan(5_000)
      expect(await cancelStatus(path)).toBe('not-queued')
    })

    it('a later Session event restarts the 1.5 s settle delay', async () => {
      harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '' } })
      harness.setSession('session-busy', { running: true, questions: 0 })
      const path = await harness.provisionThread(repo, { sessionIds: ['session-busy'] })
      await harness.api.queueLand({ path, sessionId: 'session-busy' })
      await wait(500)
      harness.setSession('session-busy', { running: false, questions: 0 })

      harness.emitSessionEvent('session-busy')
      await wait(1_000)
      harness.emitSessionEvent('session-busy')
      await wait(1_000)
      expect(eventTypes()).not.toContain('workspace.rebase_landed')
      await waitFor(() => eventTypes().includes('workspace.rebase_landed'))
    })

    it('retries on the 30 s fallback when no Session event announced the idleness', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '' } })
      harness.setSession('session-busy', { running: false, questions: 1 })
      const path = await harness.provisionThread(repo, { sessionIds: ['session-busy'] })
      await harness.api.queueLand({ path, sessionId: 'session-busy' })
      await wait(1_500)
      harness.setSession('session-busy', { running: false, questions: 0 })
      await wait(500)
      expect(eventTypes()).not.toContain('workspace.rebase_landed')

      vi.advanceTimersByTime(29_000)
      await wait(1_000)
      expect(eventTypes()).not.toContain('workspace.rebase_landed')
      vi.advanceTimersByTime(1_000)
      await waitFor(() => eventTypes().includes('workspace.rebase_landed'))
    })

    it('ignores Session events of Sessions outside the queued workspace', async () => {
      harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '' } })
      harness.setSession('session-busy', { running: true, questions: 0 })
      const path = await harness.provisionThread(repo, { sessionIds: ['session-busy'] })
      await harness.api.queueLand({ path, sessionId: 'session-busy' })
      await wait(500)
      harness.setSession('session-busy', { running: false, questions: 0 })
      harness.emitSessionEvent('session-elsewhere')
      await wait(2_500)
      expect(eventTypes()).not.toContain('workspace.rebase_landed')
      expect(await cancelStatus(path)).toBe('cancelled')
    })

    it('settles an entry whose retry fails for a reason other than waiting, and reports it', async () => {
      harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '' } })
      harness.setSession('session-busy', { running: true, questions: 0 })
      const path = await harness.provisionThread(repo, { sessionIds: ['session-busy'] })
      await harness.api.queueLand({ path, sessionId: 'session-busy' })
      await wait(500)
      rmSync(path, { recursive: true, force: true })
      harness.setSession('session-busy', { running: false, questions: 0 })
      harness.emitSessionEvent('session-busy')
      await waitFor(() => eventTypes().includes('workspace.queued_integration_failed'))
      const failure = harness.events.find(event => event.type === 'workspace.queued_integration_failed')
      expect({ level: failure?.level, summary: failure?.summary.replace(/thread-[0-9a-f]{6}/, '<thread>') }).toEqual({
        level: 'attention',
        summary: 'Queued integration of <thread> stopped before rebasing',
      })
      // Which error names the vanished folder depends on whether jj's cached `root` view read is still current.
      expect(['<root>/repo-threads/<thread> is not inside a jj repository.', 'This workspace is not a thread.']).toContain(
        failure?.detail?.replaceAll(root, '<root>').replace(/thread-[0-9a-f]{6}/, '<thread>'),
      )
      expect(await cancelStatus(path)).toBe('not-queued')
    })
  })

  describe('checkout sync after a land', () => {
    it('runs one sync at a time and coalesces the lands of one repository into one sync of the newest revision', async () => {
      const firstSync = deferred<string>()
      harness = await JjIntegrationTestHost.start({
        checkoutSync: call => (call === harness?.checkoutSyncs[0] ? firstSync.promise : Promise.resolve(syncResult('synced'))),
      })
      const first = await harness.provisionThread(repo, { file: 'first.txt' })
      const second = await harness.provisionThread(repo, { file: 'second.txt' })
      const third = await harness.provisionThread(repo, { file: 'third.txt' })

      const land = async (path: string) => {
        if (harness === undefined) throw new Error('harness not started')
        return harness.api.land({ path })
      }
      expect((await land(first)).status).toBe('landed')
      await waitFor(() => harness?.checkoutSyncs.length === 1)
      const running = await harness.api.workspaceSync({})
      expect(running.sync?.state).toBe('running')

      expect((await land(second)).status).toBe('landed')
      const lastLand = await land(third)
      expect(lastLand.status).toBe('landed')
      await wait(300)
      expect(harness.checkoutSyncs).toHaveLength(1)

      firstSync.resolve(syncResult('synced'))
      await waitFor(() => harness?.checkoutSyncs.length === 2)
      await wait(500)
      expect(harness.checkoutSyncs).toHaveLength(2)
      const revisionOf = (argv: readonly string[]) => argv[argv.indexOf('--revision') + 1]
      expect(revisionOf(harness.checkoutSyncs[1]?.argv ?? [])).toBe(lastLand.head?.commitId)
      expect(
        harness.checkoutSyncs.map(call => call.argv.slice(call.argv.indexOf('checkout')).filter(part => !part.startsWith('/') && !/^[0-9a-f]{40}$/.test(part))),
      ).toMatchInlineSnapshot(`
          [
            [
              "checkout",
              "sync",
              "--workspace",
              "default",
              "--bookmark",
              "main",
              "--revision",
              "--cwd",
              "--json",
            ],
            [
              "checkout",
              "sync",
              "--workspace",
              "default",
              "--bookmark",
              "main",
              "--revision",
              "--cwd",
              "--json",
            ],
          ]
        `)

      await waitFor(() => eventTypes().filter(type => type.startsWith('workspace.sync')).length === 2)
      const done = (await harness.api.workspaceSync({})).sync
      expect({ state: done?.state, status: done?.status, workspace: done?.workspace }).toMatchInlineSnapshot(`
        {
          "state": "done",
          "status": "synced",
          "workspace": "default",
        }
      `)
    })

    it('skips the sync when no workspace is configured and reports a sync that printed no result as failed', async () => {
      harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '' } })
      const quiet = await harness.provisionThread(repo, { file: 'quiet.txt' })
      await harness.api.land({ path: quiet })
      await wait(300)
      expect(harness.checkoutSyncs).toHaveLength(0)
      await harness.dispose()

      harness = await JjIntegrationTestHost.start({ checkoutSync: async () => '' })
      const noisy = await harness.provisionThread(repo, { file: 'noisy.txt' })
      const eventStart = harness.events.length
      await harness.api.land({ path: noisy })
      await waitFor(() => eventTypes(eventStart).some(type => type.startsWith('workspace.sync')))
      const syncEvent = harness.events.slice(eventStart).find(event => event.type.startsWith('workspace.sync'))
      expect({ type: syncEvent?.type, level: syncEvent?.level, summary: syncEvent?.summary, detail: syncEvent?.detail }).toMatchInlineSnapshot(`
        {
          "detail": "dshx checkout sync printed no result: ",
          "level": "attention",
          "summary": "default not updated: dshx checkout sync printed no result: ",
          "type": "workspace.sync_failed",
        }
      `)
    })
  })
})
