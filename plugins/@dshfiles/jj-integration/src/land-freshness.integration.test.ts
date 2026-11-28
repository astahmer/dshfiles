import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JjIntegrationTestHost, type JjIntegrationTestHarness } from './host-test-harness.js'
import { defaultJjIntegrationSettings } from './settings.js'

const jj = JjIntegrationTestHost.jj
const jjAvailable = spawnSync('jj', ['--version']).status === 0

const eventFrameSchema = Schema.Struct({
  type: Schema.String,
  key: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Struct({ paths: Schema.optional(Schema.Array(Schema.String)) })),
})
type EventFrame = typeof eventFrameSchema.Type
const decodeFrame = Schema.decodeUnknownSync(Schema.fromJsonString(eventFrameSchema))

/** The dshx events stream as a browser reads it: one decoded frame per `data:` line. */
const openEvents = async (harness: JjIntegrationTestHarness, signal: AbortSignal) => {
  const response = await harness.host.connection.fetch('http://localhost/api/dshx-events', { signal })
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('the events route answered without a body')
  const decoder = new TextDecoder()
  const frames: EventFrame[] = []
  let buffer = ''
  void (async () => {
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }))
      if (chunk.done === true || chunk.value === undefined) return
      buffer += decoder.decode(chunk.value, { stream: true })
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (line.startsWith('data: ')) frames.push(decodeFrame(line.slice('data: '.length)))
      }
    }
  })()
  return frames
}

const waitFor = async <T>(read: () => Promise<T | undefined> | T | undefined, timeoutMs: number): Promise<T | undefined> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) return undefined
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
  }
}

/** Round three item 28: after a land the list stops offering Land at once, and new work shows Land without a poll. */
describe.skipIf(!jjAvailable)('jj-integration land freshness', () => {
  let root: string
  let harness: JjIntegrationTestHarness
  let repoCount = 0

  const freshRepository = (): string => {
    repoCount += 1
    const repo = join(root, `repo-${String(repoCount)}`)
    JjIntegrationTestHost.initRepository(repo)
    return repo
  }

  const unlandedAt = async (path: string): Promise<{ readonly refreshing: boolean; readonly unlanded: number | undefined }> => {
    const snapshot = await harness.api.repositories({})
    const thread = snapshot.repositories.flatMap(repository => repository.threads).find(entry => entry.path === path)
    return { refreshing: snapshot.refreshing === true, unlanded: thread?.unlanded.length }
  }

  /** Scan until the inventory, read the way the thread list reads it, settles on the thread's work. */
  const listed = async (path: string): Promise<void> => {
    await harness.api.refreshRepositories({})
    const settled = await waitFor(async () => {
      const current = await unlandedAt(path)
      return !current.refreshing && current.unlanded === 1 ? current : undefined
    }, 60_000)
    if (settled === undefined) throw new Error(`the inventory never listed ${path} with one revision to land`)
  }

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-land-freshness-')))
    harness = await JjIntegrationTestHost.start({
      settings: { syncWorkspaceAfterLand: '', autoCleanup: { ...defaultJjIntegrationSettings.autoCleanup, enabled: false } },
    })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    for (let index = 1; index <= repoCount; index += 1) rmSync(join(root, `repo-${String(index)}-threads`), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('lists a landed thread with nothing to land as soon as the land returns', async () => {
    harness.setSession('session-fresh', { running: false, questions: 0 })
    const path = await harness.provisionThread(freshRepository(), { sessionIds: ['session-fresh'] })
    await listed(path)

    expect(await harness.api.land({ path, sessionId: 'session-fresh' })).toMatchObject({ status: 'landed' })
    // The thread list refetches the inventory the moment the land settles: it must not read the pre-land "1 to land".
    expect((await unlandedAt(path)).unlanded).toBe(0)
  }, 180_000)

  it('tells browsers that a thread workspace gained a revision, without a poll', async () => {
    using recorder = recordSpans()
    const controller = new AbortController()
    try {
      const frames = await openEvents(harness, controller.signal)
      harness.setSession('session-describe', { running: false, questions: 0 })
      const path = await harness.provisionThread(freshRepository(), { sessionIds: ['session-describe'] })
      await listed(path)
      const changed = (since: number) => frames.slice(since).find(frame => frame.type === 'event' && frame.key?.endsWith('repositoryChanged') === true)
      // The watch attaches once the scan names the repository; each try is one `jj describe`, as a user or an agent runs it.
      let event: EventFrame | undefined
      for (let attempt = 0; attempt < 5 && event === undefined; attempt += 1) {
        const since = frames.length
        jj(path, 'describe', '-m', `feat: describe attempt ${String(attempt)}`)
        event = await waitFor(() => changed(since), 2_000)
      }
      expect(event?.data?.paths).toContain(path)
      const published = recorder.named('jj-integration repository changed')
      expect(published.length).toBeGreaterThan(0)
    } finally {
      controller.abort()
    }
  }, 180_000)
})
