import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { recordSpans } from '@dshfiles/dshx/tracing'

import { projectPathFor } from './project-path.ts'
import { createMemoryRuntime, type Caller, type SessionLog } from './runtime.ts'
import type { MemoryEmbedder } from './embedder.ts'
import type { JevUsageRecord } from '@dshfiles/usage/api'
import { openMemoryStore } from './store.ts'
import { memorySettings, type MemorySettings } from './settings.ts'
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

type SessionSearchState = { hits: { sessionId: string; snippet: string }[]; error: Error | null; calls: number }

const setup = (overrides: Partial<MemorySettings> = {}, embedder?: MemoryEmbedder, jev: { readonly key?: string; readonly fetch?: typeof fetch } = {}) => {
  const logs = new Map<string, SessionLog>()
  const summaries: string[] = []
  const titles = new Map<string, string>()
  const titleReadSignals: (AbortSignal | undefined)[] = []
  const scopes = new Map<string, string>()
  const content: SessionSearchState = {
    hits: [],
    error: null,
    calls: 0,
  }
  const jevUsage: JevUsageRecord[] = []
  const store = openMemoryStore({ path: join(root, 'memory.db') })
  const services = {
    projectPath: projectPathFor,
    agentMemoryScope: async (sessionId: string) => scopes.get(sessionId) ?? null,
    listSessions: async () => [...logs.values()].map(log => ({ header: { ...log.header, createdAt: Date.now() }, live: false, persisted: true })),
    readSessionTitles: async (ids: readonly string[], signal?: AbortSignal) => {
      titleReadSignals.push(signal)
      signal?.throwIfAborted()
      return ids.map(id => ({ sessionId: id, title: titles.get(id), updatedAt: undefined }))
    },
    searchSessionContent: async () => {
      content.calls += 1
      if (content.error !== null) throw content.error
      return { hits: content.hits, hasMore: false }
    },
    readSession: async (id: string) => {
      const log = logs.get(id)
      if (!log) throw new Error(`no session ${id}`)
      return log
    },
    summarize: async (request: { readonly conversationId: string }) => {
      summaries.push(request.conversationId)
      return {
        text: 'Counted 5xx responses in the gateway log; the worker log shows 312 retries.\nUser asked about logs/api-gateway.log and logs/worker.log.',
      }
    },
    jevCredential: async () => (jev.key === undefined ? undefined : { value: jev.key, label: 'env:TYPESAFE_API_KEY' }),
    recordJevUsage: async (record: JevUsageRecord) => {
      jevUsage.push(record)
    },
    embedder: async (specifier: string) => {
      if (embedder === undefined) throw new Error(`cannot load ${specifier}`)
      return embedder
    },
  }
  if (jev.fetch !== undefined) Object.assign(services, { fetch: jev.fetch })
  const runtime = createMemoryRuntime({
    store,
    settings: () => settings(overrides),
    logger: { info: () => {}, warn: () => {} },
    services,
  })
  const caller = (id: string, cwd = root, origin?: 'subagent'): Caller => ({
    id,
    session: { header: origin === undefined ? { id, cwd } : { id, cwd, origin, parentSession: 'session-parent' } },
  })
  return { logs, summaries, store, runtime, caller, titles, content, scopes, jevUsage, titleReadSignals }
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

  it('shows an agent its own memory scope, and hides it from the project’s other threads', async () => {
    const { logs, runtime, store, caller, scopes } = setup()
    const first = halyardThread('session-11111111-0000-4000-8000-000000000000')
    logs.set(first.header.id, first.log())
    await runtime.digest(first.header.id)
    const note = (text: string, scope: string): void => {
      store.addNote({ project: root, text, category: 'project', scope, confidence: 'stated', sourceThread: null, sourceSeq: null, origin: 'agent' })
    }
    note('The API is on port 9644.', 'repo')
    note('The reviewer prefers two-line findings.', 'agent:reviewer')
    scopes.set('session-review', 'agent:reviewer')
    const plain = await runtime.startBlock(caller('session-plain'))
    const reviewed = await runtime.startBlock(caller('session-review'))
    expect(plain).toContain('port 9644')
    expect(plain).not.toContain('two-line findings')
    expect(reviewed).toContain('port 9644')
    expect(reviewed).toContain('two-line findings')
    // The preview of a new thread takes the same scope, so the panel can show what an agent's thread would read.
    expect((await runtime.previewStartBlock(root, 'agent:reviewer')).text).toContain('two-line findings')
    expect((await runtime.previewStartBlock(root)).text).not.toContain('two-line findings')
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

  it('records provider-reported Jev usage without the key or request text', async () => {
    const key = 'synthetic-memory-key'
    const text = 'synthetic prompt text'
    const { runtime, caller, jevUsage } = setup({ enabled: true, jevEnabled: true }, undefined, {
      key,
      fetch: async (input, init) => {
        expect(input).toBe('https://api.typesafe.ai/v1/systemone')
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`)
        return new Response(
          JSON.stringify({ model: 'jev-latest', answers: { verdict: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 42, output_tokens: 3 } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    await runtime.startBlock(caller('session-jev-usage'), async () => text)

    expect(jevUsage).toHaveLength(1)
    expect(jevUsage[0]).toMatchObject({ source: 'memory', credential: 'env:TYPESAFE_API_KEY', outcome: 'success', inputTokens: 42, outputTokens: 3 })
    expect(JSON.stringify(jevUsage[0])).not.toContain(key)
    expect(JSON.stringify(jevUsage[0])).not.toContain(text)
  })

  it('reviews saved notes with Jev in bounded pages and never archives automatically', async () => {
    const { runtime, store, jevUsage, caller } = setup({ enabled: true, crossProject: false, jevEnabled: true, jevThreshold: 0.5 }, undefined, {
      key: 'synthetic-memory-key',
      fetch: async () =>
        new Response(JSON.stringify({ model: 'jev-latest', answers: { verdict: { type: 'noul', noul: 0.2 } }, usage: { input_tokens: 8, output_tokens: 1 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    const first = store.addNote({
      project: root,
      text: 'Temporary staging environment is on port 9001.',
      category: 'project',
      scope: 'repo',
      confidence: 'stated',
      sourceThread: null,
      sourceSeq: null,
      origin: 'agent',
    }).note
    store.addNote({
      project: root,
      text: 'Repository uses pnpm for package management.',
      category: 'project',
      scope: 'repo',
      confidence: 'stated',
      sourceThread: null,
      sourceSeq: null,
      origin: 'agent',
    })

    await expect(runtime.reviewNotes(caller('session-agent-review'), { project: '/private/another-project', limit: 1 })).rejects.toThrow(
      'Cross-project memory is disabled for this Agent.',
    )
    expect(jevUsage).toHaveLength(0)
    const firstPage = await runtime.reviewNotes(caller('session-agent-review'), { project: root, limit: 1 })
    expect(firstPage.results).toHaveLength(1)
    expect(firstPage.results[0]).toMatchObject({ probability: 0.2, candidate: true })
    expect(firstPage.nextAfterId).not.toBeNull()
    const secondPage = await runtime.reviewNotes(caller('session-agent-review'), { project: root, afterId: firstPage.nextAfterId ?? undefined, limit: 1 })
    expect(secondPage.results).toHaveLength(1)
    expect(secondPage.nextAfterId).toBeNull()
    expect(store.note(first.id)).toBeDefined()
    expect(jevUsage).toHaveLength(2)
    expect(jevUsage.every(record => record.outcome === 'success')).toBe(true)
  })

  it('keeps failed note reviews unknown and requires Jev to be enabled', async () => {
    const { runtime, caller, store, jevUsage } = setup({ enabled: true, jevEnabled: true }, undefined, {
      key: 'synthetic-memory-key',
      fetch: async () => new Response('synthetic private error body', { status: 503 }),
    })
    const note = store.addNote({
      project: root,
      text: 'The temporary rollout ends Friday.',
      category: 'project',
      scope: 'repo',
      confidence: 'stated',
      sourceThread: null,
      sourceSeq: null,
      origin: 'agent',
    }).note
    const result = await runtime.reviewNotes(caller('session-review'), { project: root, limit: 1 })
    expect(result.results[0]).toMatchObject({ id: note.id, probability: null, candidate: false })
    expect(store.note(note.id)).toBeDefined()
    expect(jevUsage[0]).toMatchObject({ outcome: 'failure', inputTokens: null, outputTokens: null })

    const disabled = setup({ enabled: true, jevEnabled: false })
    await expect(disabled.runtime.reviewNotes(disabled.caller('session-review'), { project: root, limit: 1 })).rejects.toThrow('Enable Jev')
  })

  it('records failed Jev attempts with unknown token usage', async () => {
    const { runtime, caller, jevUsage } = setup({ enabled: true, jevEnabled: true }, undefined, {
      key: 'synthetic-memory-key',
      fetch: async () => new Response('synthetic private error body', { status: 503 }),
    })

    await runtime.startBlock(caller('session-jev-failure'), async () => 'synthetic prompt text')

    expect(jevUsage).toHaveLength(1)
    expect(jevUsage[0]).toMatchObject({ source: 'memory', credential: 'env:TYPESAFE_API_KEY', outcome: 'failure', inputTokens: null, outputTokens: null })
    expect(JSON.stringify(jevUsage[0])).not.toContain('synthetic-memory-key')
    expect(JSON.stringify(jevUsage[0])).not.toContain('synthetic private error body')
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
    const usageBeforePreview = store.usage().tools
    expect(await runtime.preview({ id: 't:11111111' })).toContain('INC-20931')
    expect(store.usage().tools).toEqual(usageBeforePreview)
    runtime.onSessionEvent({ id: 'session-reader' }, {
      type: 'assistant/message',
      seq: 9,
      time: 9,
      data: { message: { content: [{ type: 'text', text: 'ACC-77341 and INC-20931.\nmemory: t:11111111' }] } },
    } as never)
    expect(store.usage().tools.find(tool => tool.tool === 'memory_search')?.used).toBe(1)
    expect(store.thread('11111111')?.uses).toBe(1)
  })

  it('previews a note without recording an agent memory-tool call', async () => {
    const { runtime, store } = setup()
    store.addNote({
      project: root,
      text: 'Deploys need the ops approval label.',
      category: 'project',
      scope: 'repo',
      confidence: 'stated',
      sourceThread: null,
      sourceSeq: null,
      origin: 'agent',
    })

    const usage = store.usage().tools
    expect(await runtime.preview({ id: 'n:1' })).toContain('Deploys need the ops approval label.')
    expect(store.usage().tools).toEqual(usage)
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

    const flags = Object.fromEntries(store.recentCitations({ limit: 10 }).map(citation => [citation.thread, [citation.userCorrected, citation.agentCorrected]]))
    expect(flags).toEqual({ 'session-user': [true, false], 'session-agent': [false, true], 'session-fine': [false, false] })
  })

  it('finds a thread by title and content inside the caller project and records the finder call', async () => {
    const { logs, runtime, store, caller, titles, content } = setup()
    const thread = halyardThread('session-11111111-0000-4000-8000-000000000000')
    logs.set(thread.header.id, thread.log())
    titles.set(thread.header.id, 'Northwind escalation')
    content.hits = [{ sessionId: thread.header.id, snippet: 'Northwind Freight: account ACC-77341' }]
    const page = await runtime.findThreads(caller('session-reader'), { query: 'northwind' })
    expect(page.project).toBe(root)
    expect(page.hits.map(hit => hit.sessionId)).toEqual([thread.header.id])
    expect(page.hits[0]?.sources).toContain('session-content')
    expect(page.degraded).toEqual([])
    expect(store.usage().tools.map(entry => entry.tool)).toContain('find_threads')
  })

  it('records finder phase spans without queries or session identifiers', async () => {
    using recorder = recordSpans()
    const { logs, runtime, caller, titles, content } = setup()
    const thread = halyardThread('session-33333333-0000-4000-8000-000000000000')
    logs.set(thread.header.id, thread.log())
    titles.set(thread.header.id, 'Synthetic finder title')
    content.hits = [{ sessionId: thread.header.id, snippet: 'bounded sample' }]

    const page = await runtime.findThreads(caller('session-reader'), { query: 'synthetic' })

    expect(page.hits.map(hit => hit.sessionId)).toEqual([thread.header.id])
    expect(recorder.span('thread finder resolve caller project').attributes['dshx.memory.finder.caller_project_resolved']).toBe(true)
    expect(recorder.span('thread finder prepare records').attributes['dshx.memory.finder.record_count']).toBe(1)
    expect(recorder.span('thread finder list sessions').attributes['dshx.memory.finder.session_count']).toBe(1)
    expect(recorder.span('thread finder read titles').attributes).toMatchObject({
      'dshx.memory.finder.title_count': 1,
      'dshx.memory.finder.title_read_failed': false,
    })
    expect(recorder.span('thread finder resolve projects').attributes['dshx.memory.finder.project_count']).toBe(1)
    expect(recorder.span('thread finder content search').attributes).toMatchObject({
      'dshx.memory.finder.content_hits': 1,
      'dshx.memory.finder.content_attempts': 1,
      'dshx.memory.finder.content_degraded': false,
    })
    expect(recorder.span('thread finder memory search').attributes['dshx.memory.finder.memory_hits']).toBe(0)

    const attributes = [
      'thread finder resolve caller project',
      'thread finder prepare records',
      'thread finder list sessions',
      'thread finder read titles',
      'thread finder resolve projects',
      'thread finder content search',
      'thread finder memory search',
    ].map(name => JSON.stringify(recorder.span(name).attributes))
    expect(attributes.join(' ')).not.toContain('synthetic')
    expect(attributes.join(' ')).not.toContain(thread.header.id)
    expect(attributes.join(' ')).not.toContain(root)
  })

  it('cancels title loading when a caller aborts thread search', async () => {
    const { logs, runtime, caller, titleReadSignals } = setup()
    const thread = halyardThread('session-cancelled-0000-4000-8000-000000000000')
    logs.set(thread.header.id, thread.log())
    const controller = new AbortController()
    const reason = new Error('search cancelled')
    controller.abort(reason)

    await expect(runtime.findThreads(caller('session-reader'), { query: 'northwind' }, controller.signal)).rejects.toBe(reason)
    expect(titleReadSignals).toEqual([controller.signal])
  })

  it('answers memory message hits from stored excerpts without reading Session logs', async () => {
    const { logs, runtime, store, caller, titles } = setup()
    const thread = halyardThread('session-22222222-0000-4000-8000-000000000000')
    logs.set(thread.header.id, thread.log())
    titles.set(thread.header.id, 'Ops notes')
    store.indexMessages({
      thread: thread.header.id,
      project: root,
      throughSeq: 2,
      messages: [{ seq: 2, role: 'user', text: 'The halyard coordinator restarted during the config push.', at: Date.now() }],
    })
    const logReads = vi.spyOn(logs, 'get')

    const page = await runtime.findThreads(caller('session-reader'), { query: 'coordinator' })

    expect(page.hits.map(hit => hit.sessionId)).toEqual([thread.header.id])
    expect(page.hits[0]?.sources).toContain('memory-message')
    expect(logReads).not.toHaveBeenCalled()
  })

  it('reports a finder that cannot search content as an actionable code, never as an empty page', async () => {
    const { logs, runtime, caller, content } = setup()
    const thread = halyardThread('session-11111111-0000-4000-8000-000000000000')
    logs.set(thread.header.id, thread.log())
    content.error = Object.assign(new Error('session search is disabled: this deployment configures the session-query index with openAt "never"'), {
      code: 'SESSION_QUERY_SEARCH_DISABLED',
    })
    await expect(runtime.findThreads(caller('session-reader'), { query: 'nothing matches this' })).rejects.toMatchObject({
      name: 'PluginApiError',
      code: 'search-unavailable',
    })
  })
})
