import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { projectPathFor } from './project-path.ts'
import { createMemoryRuntime, type Caller, type SessionLog } from './runtime.ts'
import type { MemoryEmbedder } from './embedder.ts'
import { memorySettings, type MemorySettings } from './settings.ts'
import { openMemoryStore } from './store.ts'
import { createThread } from './testing/session-fixture.ts'

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'memory-runtime-')))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JJ_CONFIG: '' },
  })

const settings = (overrides: Partial<MemorySettings> = {}): MemorySettings => ({ ...memorySettings.schema({}), idleMs: 1_000, ...overrides })

/** Stand-in for a local embedding model: texts naming the same concept, in any wording, get the same direction. */
const conceptEmbedder: MemoryEmbedder = {
  model: 'concepts-v1',
  embed: async texts =>
    texts.map(text => {
      const concepts = [/rebalanc|reshuffl/i, /consumer|reader/i, /coordinator|leader/i]
      const vector = Float32Array.from(concepts.map(pattern => (pattern.test(text) ? 1 : 0)))
      const norm = Math.hypot(...vector) || 1
      return vector.map(value => value / norm)
    }),
}

const setup = (overrides: Partial<MemorySettings> = {}, embedder?: MemoryEmbedder) => {
  const logs = new Map<string, SessionLog>()
  const summaries: string[] = []
  const store = openMemoryStore({ path: join(root, 'memory.db') })
  const runtime = createMemoryRuntime({
    store,
    settings: () => settings(overrides),
    logger: { info: () => {}, warn: () => {} },
    services: {
      projectPath: projectPathFor,
      listSessions: async () => [...logs.values()].map(log => ({ header: { ...log.header, createdAt: Date.now() }, live: false })),
      readSession: async id => {
        const log = logs.get(id)
        if (!log) throw new Error(`no session ${id}`)
        return log
      },
      summarize: async request => {
        summaries.push(request.conversationId)
        return {
          text: 'Counted 5xx responses in the gateway log; the worker log shows 312 retries.\nUser asked about logs/api-gateway.log and logs/worker.log.',
        }
      },
      jevKey: () => undefined,
      embedder: async specifier => {
        if (embedder === undefined) throw new Error(`cannot load ${specifier}`)
        return embedder
      },
    },
  })
  const caller = (id: string, cwd = root, origin?: 'subagent'): Caller => ({
    id,
    session: { header: origin === undefined ? { id, cwd } : { id, cwd, origin, parentSession: 'session-parent' } },
  })
  return { logs, summaries, store, runtime, caller }
}

const halyardThread = (id: string) => {
  const thread = createThread({ id, cwd: root })
  thread.exchange(
    'Our biggest customer is Northwind Freight: account ACC-77341, Enterprise tier. The admin API is on port 9644.',
    'Noted: Northwind Freight, ACC-77341, Enterprise; admin API on 9644.',
  )
  thread.exchange(
    'Draft the INC-20931 note for #halyard-ops.',
    'INC-20931: a config push restarted consumer coordinators; delivery was delayed up to 26 minutes, no data loss.',
  )
  return thread
}

describe('memory runtime', () => {
  it('digests a thread once it goes idle, never while a turn runs', async () => {
    vi.useFakeTimers()
    const { logs, runtime, store } = setup()
    const thread = halyardThread('session-11111111-0000-4000-8000-000000000000')
    logs.set(thread.header.id, thread.log())
    const session = { id: thread.header.id }
    runtime.onSessionEvent(session, { type: 'turn/end', seq: 1, time: 1, data: { turn: 2, reason: { kind: 'completed' } } } as never)
    runtime.onSessionEvent(session, thread.events.find(event => event.type === 'turn/start') ?? thread.events[0]!)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(store.thread(thread.header.id)).toBeUndefined()
    runtime.onSessionEvent(session, { type: 'turn/end', seq: 2, time: 2, data: { turn: 2, reason: { kind: 'completed' } } } as never)
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.waitFor(() => expect(store.thread(thread.header.id)?.source).toBe('trail'))
    runtime.stop()
  })

  it('gives every thread and subagent of a project the same frozen block until memory changes', async () => {
    const { logs, runtime, store, caller } = setup()
    const first = halyardThread('session-11111111-0000-4000-8000-000000000000')
    logs.set(first.header.id, first.log())
    expect(await runtime.digest(first.header.id)).toBe('new')
    const blockA = await runtime.startBlock(caller('session-aaaaaaaa'))
    const blockSub = await runtime.startBlock(caller('session-subagent', root, 'subagent'))
    expect(blockA).toContain('t:11111111')
    expect(blockA.startsWith('Memory: past threads have digests and notes')).toBe(true)
    expect(blockSub).toBe(blockA)
    store.addNote({
      project: root,
      text: 'Northwind contact is Hannah Okafor.',
      category: 'project',
      scope: 'repo',
      confidence: 'stated',
      sourceThread: null,
      sourceSeq: null,
      origin: 'agent',
    })
    expect(await runtime.startBlock(caller('session-aaaaaaaa'))).toBe(blockA)
    const blockB = await runtime.startBlock(caller('session-bbbbbbbb'))
    expect(blockB).toContain('Hannah Okafor')
    expect(Buffer.byteLength(blockB)).toBeLessThanOrEqual(settings().blockBytes)
  })

  it('previews the block a new thread of the project would get, without freezing one', async () => {
    const { logs, runtime, caller } = setup()
    const first = halyardThread('session-11111111-0000-4000-8000-000000000000')
    logs.set(first.header.id, first.log())
    await runtime.digest(first.header.id)
    const preview = await runtime.previewStartBlock(root)
    expect(preview.project).toBe(root)
    expect(preview.text).toBe(await runtime.startBlock(caller('session-aaaaaaaa')))
    expect((await setup({ enabled: false }).runtime.previewStartBlock(root)).text).toBe('')
  })

  it('asks a cheap model only for a thread without a trail of its own', async () => {
    const { logs, runtime, store, summaries } = setup()
    const thread = createThread({ id: 'session-22222222', cwd: root })
    thread.exchange('Look at the gateway logs.', 'Checking.', [['bash', { command: 'wc -l logs/api-gateway.log' }, '48210']])
    thread.exchange('And the worker log?', 'Ok.', [['bash', { command: 'grep -c retry logs/worker.log' }, '312']])
    logs.set(thread.header.id, thread.log())
    await runtime.digest(thread.header.id)
    expect(summaries).toEqual(['session-22222222'])
    expect(store.thread('session-22222222')?.source).toBe('model')
    expect(store.thread('session-22222222')?.decision).toBe('Counted 5xx responses in the gateway log; the worker log shows 312 retries.')
  })

  it('answers a later thread through search, read and an excerpt, and counts the citation', async () => {
    const { logs, runtime, caller, store } = setup()
    const thread = halyardThread('session-11111111-0000-4000-8000-000000000000')
    logs.set(thread.header.id, thread.log())
    await runtime.digest(thread.header.id)
    const reader = caller('session-reader')
    const found = await runtime.search(reader, { query: 'Northwind account' })
    expect(found).toContain('t:11111111')
    expect(found).toContain('ACC-77341')
    const digest = await runtime.read(reader, { id: 't:11111111' })
    expect(digest).toContain('INC-20931')
    const excerpt = await runtime.read(reader, { id: 't:11111111', range: '0-4' })
    expect(excerpt).toContain('#1 user: Our biggest customer is Northwind Freight')
    runtime.onSessionEvent({ id: 'session-reader' }, {
      type: 'assistant/message',
      seq: 9,
      time: 9,
      data: { message: { content: [{ type: 'text', text: 'ACC-77341 and INC-20931.\nmemory: t:11111111' }] } },
    } as never)
    expect(store.usage().tools.find(tool => tool.tool === 'memory_search')?.used).toBe(1)
    expect(store.thread('11111111')?.uses).toBe(1)
  })

  it.skipIf(!jjAvailable)('shares project notes between a jj checkout and its thread workspace', async () => {
    const repository = join(root, 'repo')
    execFileSync('jj', ['git', 'init', repository], { stdio: 'ignore', env: { ...process.env, JJ_CONFIG: '' } })
    jj(repository, 'config', 'set', '--repo', 'user.name', 'Test')
    jj(repository, 'config', 'set', '--repo', 'user.email', 'test@example.com')
    writeFileSync(join(repository, 'base.txt'), 'base\n')
    jj(repository, 'commit', '-m', 'base')
    jj(repository, 'bookmark', 'create', 'main', '-r', '@-')

    const threadWorkspace = join(`${repository}-threads`, 'thread-c0ffee')
    mkdirSync(dirname(threadWorkspace), { recursive: true })
    jj(repository, 'workspace', 'add', threadWorkspace, '--name', 'thread-c0ffee', '-r', 'main')

    const { runtime, caller } = setup()
    const note = 'Thread workspace preparation: install dependencies only for code changes.'
    await runtime.note(caller('session-writer', repository), { text: note, category: 'project' })
    expect(await runtime.startBlock(caller('session-thread', threadWorkspace))).toContain(note)

    const otherProject = join(root, 'other-project')
    mkdirSync(otherProject)
    expect(await runtime.startBlock(caller('session-other-project', otherProject))).not.toContain(note)
  })

  it('adds, supersedes and forgets notes through memory_note', async () => {
    const { runtime, caller, store } = setup()
    const agent = caller('session-writer')
    runtime.onSessionEvent({ id: 'session-writer' }, {
      type: 'user/message',
      seq: 7,
      time: 7,
      data: { content: [{ type: 'text', text: 'Remember: retention_hours stays snake_case.' }], source: { kind: 'user' } },
    } as never)
    expect(await runtime.note(agent, { text: 'Use retention_hours, never retentionHours: ops scripts parse it.', category: 'feedback' })).toBe(
      'Saved n:1. It appears in the start block of later threads.',
    )
    expect(store.note(1)).toMatchObject({ origin: 'user-requested', sourceThread: 'session-writer', sourceSeq: 7, category: 'feedback' })
    expect(await runtime.note(agent, { action: 'update', id: 'n:1', text: 'Use retention_hours (snake_case) in every CLI flag.' })).toBe(
      'memory_note update needs a reason.',
    )
    expect(
      await runtime.note(agent, { action: 'update', id: 'n:1', text: 'Use retention_hours (snake_case) in every CLI flag.', reason: 'widened by the user' }),
    ).toBe('n:1 is superseded by n:2.')
    expect(await runtime.note(agent, { action: 'forget', id: 'n:2', reason: 'flag removed' })).toBe('Forgot n:2.')
    expect(store.usage().notes).toBe(0)
  })

  it('catches up on sessions it has never seen and skips trivial ones', async () => {
    const { logs, runtime, store } = setup()
    const hello = createThread({ id: 'session-hello', cwd: root })
    hello.exchange('hi', 'Hello!')
    const real = halyardThread('session-33333333')
    logs.set(hello.header.id, hello.log())
    logs.set(real.header.id, real.log())
    expect(await runtime.catchUp(10)).toBe(2)
    expect(store.thread('session-hello')).toBeUndefined()
    expect(store.thread('session-33333333')).toBeDefined()
    expect(await runtime.catchUp(10)).toBe(0)
  })

  it('ranks with BM25 unless hybrid is asked for and an embedding provider loads', async () => {
    const thread = createThread({ id: 'session-44444444', cwd: root })
    thread.exchange(
      'Why did the consumer group rebalance storm happen after the coordinator restart?',
      'Every config push restarted the coordinators, so consumers kept rebalancing; pushes now reload in place.',
    )
    thread.exchange('Ship the fix to staging first.', 'Deployed to staging; the rebalance storm no longer happens on a config push.')
    const query = 'readers were reshuffling whenever the leader bounced'

    const plain = setup({ retrieval: 'hybrid' })
    plain.logs.set(thread.header.id, thread.log())
    await plain.runtime.digest(thread.header.id)
    expect(await plain.runtime.retrievalStatus()).toEqual({ requested: 'hybrid', active: 'bm25', model: null, reason: 'no embeddingProvider is configured' })
    expect(await plain.runtime.search(plain.caller('session-reader'), { query })).toContain('No memory matches')
    plain.store.close()

    const hybrid = setup({ retrieval: 'hybrid', embeddingProvider: '/opt/embedders/concepts.mjs' }, conceptEmbedder)
    hybrid.logs.set(thread.header.id, thread.log())
    await hybrid.runtime.digest(thread.header.id)
    await hybrid.runtime.embedMissing()
    expect(await hybrid.runtime.retrievalStatus()).toEqual({ requested: 'hybrid', active: 'hybrid', model: 'concepts-v1', reason: null })
    expect(await hybrid.runtime.search(hybrid.caller('session-reader'), { query })).toContain('t:44444444')
  })

  it('flags, as heuristics, a citation the user then corrects and one the agent later revises', async () => {
    const { logs, runtime, store } = setup()
    const thread = halyardThread('session-11111111-0000-4000-8000-000000000000')
    logs.set(thread.header.id, thread.log())
    await runtime.digest(thread.header.id)
    const reply = (session: string, seq: number, text: string) =>
      runtime.onSessionEvent({ id: session }, { type: 'assistant/message', seq, time: seq, data: { message: { content: [{ type: 'text', text }] } } } as never)
    const ask = (session: string, seq: number, text: string) =>
      runtime.onSessionEvent({ id: session }, {
        type: 'user/message',
        seq,
        time: seq,
        data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
      } as never)

    reply('session-user', 1, 'Northwind is on the Enterprise tier.\nmemory: t:11111111')
    ask('session-user', 2, "No, that's wrong: they moved to the Scale tier last week.")
    reply('session-agent', 1, 'The admin API listens on 9644.\nmemory: t:11111111')
    reply('session-agent', 2, 'I was wrong: the admin API moved to 9654 in 4.2.0.')
    reply('session-fine', 1, 'INC-20931 delayed delivery by 26 minutes.\nmemory: t:11111111')
    reply('session-fine', 2, 'The incident note is drafted.')

    const flags = Object.fromEntries(store.recentCitations(10).map(citation => [citation.thread, [citation.userCorrected, citation.agentCorrected]]))
    expect(flags).toEqual({ 'session-user': [true, false], 'session-agent': [false, true], 'session-fine': [false, false] })
  })
})
