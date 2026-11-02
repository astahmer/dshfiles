import { execFileSync, spawnSync } from 'node:child_process'

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Jev, JevStatusRejected, JevVerdict, type JevRequest } from '@dshfiles/jev'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Fiber, FileSystem, Layer, Path } from 'effect'
import { TestClock } from 'effect/testing'

import { AgentScopes } from './agent-scopes.ts'
import { Digester } from './digester.ts'
import { Embedder } from './embedder.ts'
import { SessionLogUnavailable } from './errors.ts'
import { memoryServices } from './memory-layer.ts'
import { MemoryRepo, type NoteInput } from './memory-repo.ts'
import { Recall, type Caller } from './recall.ts'
import { ContentSearchFailed, SessionReads, type SessionLog } from './session-reads-promise.ts'
import { memorySettings, type MemorySettings } from './settings.ts'
import { Summarizer } from './summarizer-promise.ts'
import { createThread } from './testing/session-fixture.ts'
import { platformLayer } from './testing/memory-store.ts'

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
const conceptEmbedderModule = `export default () => ({
  model: 'concepts-v1',
  embed: async texts => texts.map(text => {
    const concepts = [/rebalanc|reshuffl/i, /consumer|reader/i, /coordinator|leader/i]
    const vector = Float32Array.from(concepts.map(pattern => (pattern.test(text) ? 1 : 0)))
    const norm = Math.hypot(...vector) || 1
    return vector.map(value => value / norm)
  }),
})
`

type Fakes = {
  readonly logs: Map<string, SessionLog>
  readonly titles: Map<string, string>
  readonly scopes: Map<string, string>
  readonly summaries: string[]
  readonly jevAsks: JevRequest[]
  readonly content: { hits: { sessionId: string; snippet: string }[]; error: ContentSearchFailed | null; calls: number }
  readonly reads: { count: number }
  readonly titleReads: { started: number; interrupted: number }
}

const harness = (options: {
  readonly settings?: Partial<MemorySettings>
  readonly embedder?: boolean
  readonly jev?: { readonly probability?: number; readonly status?: number }
  readonly slowTitles?: boolean
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'memory-services-' }))
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      created => Effect.promise(() => created.dispose()),
    )
    const fakes: Fakes = {
      logs: new Map(),
      titles: new Map(),
      scopes: new Map(),
      summaries: [],
      jevAsks: [],
      content: { hits: [], error: null, calls: 0 },
      reads: { count: 0 },
      titleReads: { started: 0, interrupted: 0 },
    }
    const embedderPath = path.join(root, 'concepts.mjs')
    if (options.embedder === true) yield* fs.writeFileString(embedderPath, conceptEmbedderModule)
    const read = (sessionId: string) =>
      Effect.suspend(() => {
        fakes.reads.count += 1
        const log = fakes.logs.get(sessionId)
        return log === undefined ? Effect.fail(new SessionLogUnavailable({ sessionId })) : Effect.succeed(log)
      })
    const sessionReads = SessionReads.of({
      read,
      readRecent: read,
      list: Effect.sync(() =>
        [...fakes.logs.values()].map(log => ({ header: { ...log.header, createdAt: log.header.createdAt ?? 0 }, live: false, persisted: true })),
      ),
      titles: ids =>
        Effect.suspend(() => {
          fakes.titleReads.started += 1
          if (options.slowTitles === true)
            return Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  fakes.titleReads.interrupted += 1
                }),
              ),
            )
          return Effect.succeed(ids.map(id => ({ sessionId: id, title: fakes.titles.get(id), updatedAt: undefined })))
        }),
      searchContent: () =>
        Effect.suspend(() => {
          fakes.content.calls += 1
          return fakes.content.error === null ? Effect.succeed({ hits: fakes.content.hits, hasMore: false }) : Effect.fail(fakes.content.error)
        }),
      parentOf: () => Effect.succeed(undefined),
      providerOf: () => Effect.succeed(undefined),
    })
    const summarizer = Summarizer.of({
      summarize: request =>
        Effect.sync(() => {
          fakes.summaries.push(request.conversationId)
          return {
            text: 'Counted 5xx responses in the gateway log; the worker log shows 312 retries.\nUser asked about logs/api-gateway.log and logs/worker.log.',
            usage: undefined,
          }
        }),
    })
    const jev = Jev.of({
      ask: request =>
        Effect.suspend(() => {
          fakes.jevAsks.push(request)
          const status = options.jev?.status ?? 200
          if (status !== 200) return Effect.fail(new JevStatusRejected({ status }))
          return Effect.succeed(new JevVerdict({ probability: options.jev?.probability ?? 0.8, inputTokens: 42, outputTokens: 3 }))
        }),
    })
    const edges = Layer.mergeAll(
      Layer.succeed(SessionReads, sessionReads),
      Layer.succeed(Summarizer, summarizer),
      Layer.succeed(AgentScopes, AgentScopes.of({ of: sessionId => Effect.succeed(fakes.scopes.get(sessionId) ?? null) })),
      Layer.succeed(Jev, jev),
      Settings.layerTest(memorySettings.namespace, settings({ ...(options.embedder === true && { embeddingProvider: embedderPath }), ...options.settings })),
      SecretReferenceResolver.layerTest(undefined),
      HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/memory' }),
      platformLayer,
    )
    if (options.jev !== undefined) {
      const previous = process.env['TYPESAFE_API_KEY']
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.env['TYPESAFE_API_KEY'] = 'synthetic-memory-key'
        }),
        () =>
          Effect.sync(() => {
            if (previous === undefined) delete process.env['TYPESAFE_API_KEY']
            else process.env['TYPESAFE_API_KEY'] = previous
          }),
      )
    }
    const services = yield* Layer.build(memoryServices(path.join(root, 'memory.db')).pipe(Layer.provideMerge(edges)))
    const caller = (id: string, cwd = root, origin?: 'subagent'): Caller => ({
      id,
      session: { header: origin === undefined ? { id, cwd } : { id, cwd, origin, parentSession: 'session-parent' } },
    })
    // SAFETY: tests emit hand-built Session events; the listener reads only `id` and the event.
    const emit = (sessionId: string, event: SessionEvent) => Effect.sync(() => host.ctx.emit('session/event', { id: sessionId } as never, event))
    return {
      root,
      fakes,
      caller,
      emit,
      recall: Context.get(services, Recall),
      repo: Context.get(services, MemoryRepo),
      digester: Context.get(services, Digester),
      embedder: Context.get(services, Embedder),
    }
  }).pipe(Effect.provide(platformLayer))

const halyardThread = (id: string, cwd: string) => {
  const thread = createThread({ id, cwd })
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

const note = (project: string, text: string, scope = 'repo'): NoteInput => ({
  project,
  text,
  category: 'project',
  scope,
  confidence: 'stated',
  sourceThread: null,
  sourceSeq: null,
  origin: 'agent',
})

const turnEnd = (seq: number): SessionEvent => ({ type: 'turn/end', seq, time: seq, data: { turn: 2, reason: { kind: 'completed' } } }) as never
const reply = (seq: number, text: string): SessionEvent =>
  ({ type: 'assistant/message', seq, time: seq, data: { message: { content: [{ type: 'text', text }] } } }) as never
const ask = (seq: number, text: string): SessionEvent =>
  ({ type: 'user/message', seq, time: seq, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } }) as never

const settle = Effect.gen(function* () {
  for (let round = 0; round < 50; round++) yield* Effect.yieldNow
})

describe('memory services', () => {
  it.effect('digests a thread once it goes idle, never while a turn runs', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = halyardThread('session-11111111-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      yield* memory.emit(thread.header.id, turnEnd(1))
      yield* memory.emit(thread.header.id, thread.events.find(event => event.type === 'turn/start') ?? turnEnd(0))
      yield* TestClock.adjust('5 seconds')
      yield* settle
      expect(yield* memory.repo.thread(thread.header.id)).toBeUndefined()
      yield* memory.emit(thread.header.id, turnEnd(2))
      yield* settle
      expect(yield* memory.digester.pending).toBe(1)
      yield* TestClock.adjust('1500 millis')
      yield* settle
      expect((yield* memory.repo.thread(thread.header.id))?.source).toBe('trail')
    }).pipe(Effect.scoped),
  )

  it.effect('restarts the idle wait on every turn end, so a busy thread is digested once', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = halyardThread('session-12121212-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      for (const seq of [1, 2, 3]) {
        yield* memory.emit(thread.header.id, turnEnd(seq))
        yield* settle
        yield* TestClock.adjust('600 millis')
      }
      expect(yield* memory.repo.thread(thread.header.id)).toBeUndefined()
      yield* TestClock.adjust('1 second')
      yield* settle
      expect(memory.fakes.reads.count).toBe(1)
      expect(yield* memory.repo.thread(thread.header.id)).toBeDefined()
    }).pipe(Effect.scoped),
  )

  it.effect('joins a digest already running for the same thread instead of starting another', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = halyardThread('session-13131313-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      const [first, second] = yield* Effect.all([memory.digester.digest(thread.header.id), memory.digester.digest(thread.header.id)], {
        concurrency: 'unbounded',
      })
      expect([first, second]).toEqual(['new', 'new'])
      expect(memory.fakes.reads.count).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect('gives every thread and subagent of a project the same frozen block until memory changes', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const first = halyardThread('session-11111111-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(first.header.id, first.log())
      expect(yield* memory.digester.digest(first.header.id)).toBe('new')
      const none = Effect.succeed(undefined)
      const blockA = yield* memory.recall.startBlock(memory.caller('session-aaaaaaaa'), none)
      const blockSub = yield* memory.recall.startBlock(memory.caller('session-subagent', memory.root, 'subagent'), none)
      expect(blockA).toContain('t:11111111')
      expect(blockA.startsWith('Memory: past threads have digests and notes')).toBe(true)
      expect(blockSub).toBe(blockA)
      yield* memory.repo.addNote(note(memory.root, 'Northwind contact is Hannah Okafor.'))
      expect(yield* memory.recall.startBlock(memory.caller('session-aaaaaaaa'), none)).toBe(blockA)
      const blockB = yield* memory.recall.startBlock(memory.caller('session-bbbbbbbb'), none)
      expect(blockB).toContain('Hannah Okafor')
      expect(Buffer.byteLength(blockB)).toBeLessThanOrEqual(settings().blockBytes)
    }).pipe(Effect.scoped),
  )

  it.effect('shows an agent its own memory scope, and hides it from the project’s other threads', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const first = halyardThread('session-11111111-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(first.header.id, first.log())
      yield* memory.digester.digest(first.header.id)
      yield* memory.repo.addNote(note(memory.root, 'The API is on port 9644.'))
      yield* memory.repo.addNote(note(memory.root, 'The reviewer prefers two-line findings.', 'agent:reviewer'))
      memory.fakes.scopes.set('session-review', 'agent:reviewer')
      const none = Effect.succeed(undefined)
      const plain = yield* memory.recall.startBlock(memory.caller('session-plain'), none)
      const reviewed = yield* memory.recall.startBlock(memory.caller('session-review'), none)
      expect(plain).toContain('port 9644')
      expect(plain).not.toContain('two-line findings')
      expect(reviewed).toContain('port 9644')
      expect(reviewed).toContain('two-line findings')
      // The preview of a new thread takes the same scope, so the panel can show what an agent's thread would read.
      expect((yield* memory.recall.previewStartBlock(memory.root, 'agent:reviewer')).text).toContain('two-line findings')
      expect((yield* memory.recall.previewStartBlock(memory.root)).text).not.toContain('two-line findings')
    }).pipe(Effect.scoped),
  )

  it.effect('previews the block a new thread of the project would get, without freezing one', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const first = halyardThread('session-11111111-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(first.header.id, first.log())
      yield* memory.digester.digest(first.header.id)
      const preview = yield* memory.recall.previewStartBlock(memory.root)
      expect(preview.project).toBe(memory.root)
      expect(preview.text).toBe(yield* memory.recall.startBlock(memory.caller('session-aaaaaaaa'), Effect.succeed(undefined)))
      const off = yield* harness({ settings: { enabled: false } })
      expect((yield* off.recall.previewStartBlock(off.root)).text).toBe('')
    }).pipe(Effect.scoped),
  )

  it.effect('gates the block on Jev and counts the call without keeping the key or the prompt', () =>
    Effect.gen(function* () {
      const memory = yield* harness({ settings: { jevEnabled: true }, jev: { probability: 0.8 } })
      yield* memory.recall.startBlock(memory.caller('session-jev-usage'), Effect.succeed('synthetic prompt text'))
      expect(memory.fakes.jevAsks).toHaveLength(1)
      expect(memory.fakes.jevAsks[0]).toMatchObject({ source: 'memory', question: { name: 'recall' }, credential: { label: 'env:TYPESAFE_API_KEY' } })
      const usage = yield* memory.repo.usage
      expect(usage.counters).toMatchObject({ 'jev.calls': 1, 'jev.inputTokens': 42 })
      expect(JSON.stringify(usage)).not.toContain('synthetic')
    }).pipe(Effect.scoped),
  )

  it.effect('reviews saved notes with Jev in bounded pages and never archives automatically', () =>
    Effect.gen(function* () {
      const memory = yield* harness({ settings: { crossProject: false, jevEnabled: true, jevThreshold: 0.5 }, jev: { probability: 0.2 } })
      const first = (yield* memory.repo.addNote(note(memory.root, 'Temporary staging environment is on port 9001.'))).note
      yield* memory.repo.addNote(note(memory.root, 'Repository uses pnpm for package management.'))
      const refused = yield* Effect.flip(memory.recall.reviewNotes(memory.caller('session-agent-review'), { project: '/private/another-project', limit: 1 }))
      expect(refused).toMatchObject({ _tag: 'CrossProjectDisabled', message: 'Cross-project memory is disabled for this Agent.' })
      expect(memory.fakes.jevAsks).toHaveLength(0)
      const firstPage = yield* memory.recall.reviewNotes(memory.caller('session-agent-review'), { project: memory.root, limit: 1 })
      expect(firstPage.results).toHaveLength(1)
      expect(firstPage.results[0]).toMatchObject({ probability: 0.2, candidate: true })
      expect(firstPage.nextAfterId).not.toBeNull()
      const secondPage = yield* memory.recall.reviewNotes(memory.caller('session-agent-review'), {
        project: memory.root,
        afterId: firstPage.nextAfterId ?? undefined,
        limit: 1,
      })
      expect(secondPage.results).toHaveLength(1)
      expect(secondPage.nextAfterId).toBeNull()
      expect(yield* memory.repo.note(first.id)).toBeDefined()
      expect(memory.fakes.jevAsks).toHaveLength(2)
    }).pipe(Effect.scoped),
  )

  it.effect('keeps failed note reviews unknown and requires Jev to be enabled', () =>
    Effect.gen(function* () {
      const memory = yield* harness({ settings: { jevEnabled: true }, jev: { status: 503 } })
      const stored = (yield* memory.repo.addNote(note(memory.root, 'The temporary rollout ends Friday.'))).note
      const result = yield* memory.recall.reviewNotes(memory.caller('session-review'), { project: memory.root, limit: 1 })
      expect(result.results[0]).toMatchObject({ id: stored.id, probability: null, candidate: false })
      expect(yield* memory.repo.note(stored.id)).toBeDefined()
      expect((yield* memory.repo.usage).counters['jev.failures']).toBe(1)
      const disabled = yield* harness({ settings: { jevEnabled: false } })
      const failure = yield* Effect.flip(disabled.recall.reviewNotes(disabled.caller('session-review'), { project: disabled.root, limit: 1 }))
      expect(failure.message).toContain('Enable Jev')
    }).pipe(Effect.scoped),
  )

  it.effect('asks a cheap model only for a thread without a trail of its own', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = createThread({ id: 'session-22222222', cwd: memory.root })
      thread.exchange('Look at the gateway logs.', 'Checking.', [['bash', { command: 'wc -l logs/api-gateway.log' }, '48210']])
      thread.exchange('And the worker log?', 'Ok.', [['bash', { command: 'grep -c retry logs/worker.log' }, '312']])
      memory.fakes.logs.set(thread.header.id, thread.log())
      yield* memory.digester.digest(thread.header.id)
      expect(memory.fakes.summaries).toEqual(['session-22222222'])
      const stored = yield* memory.repo.thread('session-22222222')
      expect(stored?.source).toBe('model')
      expect(stored?.decision).toBe('Counted 5xx responses in the gateway log; the worker log shows 312 retries.')
    }).pipe(Effect.scoped),
  )

  it.effect('answers a later thread through search, read and an excerpt, and counts the citation', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = halyardThread('session-11111111-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      yield* memory.digester.digest(thread.header.id)
      const reader = memory.caller('session-reader')
      const found = yield* memory.recall.search(reader, { query: 'Northwind account' })
      expect(found).toContain('t:11111111')
      expect(found).toContain('ACC-77341')
      expect(yield* memory.recall.read({ id: 't:11111111' }, reader)).toContain('INC-20931')
      expect(yield* memory.recall.read({ id: 't:11111111', range: '0-4' }, reader)).toContain('#1 user: Our biggest customer is Northwind Freight')
      const usageBeforePreview = (yield* memory.repo.usage).tools
      expect(yield* memory.recall.read({ id: 't:11111111' })).toContain('INC-20931')
      expect((yield* memory.repo.usage).tools).toEqual(usageBeforePreview)
      yield* memory.emit('session-reader', reply(9, 'ACC-77341 and INC-20931.\nmemory: t:11111111'))
      yield* settle
      expect((yield* memory.repo.usage).tools.find(tool => tool.tool === 'memory_search')?.used).toBe(1)
      expect((yield* memory.repo.thread('11111111'))?.uses).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect('previews a note without recording an agent memory-tool call', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      yield* memory.repo.addNote(note(memory.root, 'Deploys need the ops approval label.'))
      const usage = (yield* memory.repo.usage).tools
      expect(yield* memory.recall.read({ id: 'n:1' })).toContain('Deploys need the ops approval label.')
      expect((yield* memory.repo.usage).tools).toEqual(usage)
    }).pipe(Effect.scoped),
  )

  it.effect.skipIf(!jjAvailable)('shares project notes between a jj checkout and its thread workspace', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const repository = path.join(memory.root, 'repo')
      execFileSync('jj', ['git', 'init', repository], { stdio: 'ignore', env: { ...process.env, JJ_CONFIG: '' } })
      jj(repository, 'config', 'set', '--repo', 'user.name', 'Test')
      jj(repository, 'config', 'set', '--repo', 'user.email', 'test@example.com')
      yield* fs.writeFileString(path.join(repository, 'base.txt'), 'base\n')
      jj(repository, 'commit', '-m', 'base')
      jj(repository, 'bookmark', 'create', 'main', '-r', '@-')
      const threadWorkspace = path.join(`${repository}-threads`, 'thread-c0ffee')
      yield* fs.makeDirectory(path.dirname(threadWorkspace), { recursive: true })
      jj(repository, 'workspace', 'add', threadWorkspace, '--name', 'thread-c0ffee', '-r', 'main')
      const text = 'Thread workspace preparation: install dependencies only for code changes.'
      yield* memory.recall.note(memory.caller('session-writer', repository), { text, category: 'project' })
      expect(yield* memory.recall.startBlock(memory.caller('session-thread', threadWorkspace), Effect.succeed(undefined))).toContain(text)
      const otherProject = path.join(memory.root, 'other-project')
      yield* fs.makeDirectory(otherProject)
      expect(yield* memory.recall.startBlock(memory.caller('session-other-project', otherProject), Effect.succeed(undefined))).not.toContain(text)
    }).pipe(Effect.scoped, Effect.provide(platformLayer)),
  )

  it.effect('adds, supersedes and forgets notes through memory_note', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const agent = memory.caller('session-writer')
      yield* memory.emit('session-writer', ask(7, 'Remember: retention_hours stays snake_case.'))
      yield* settle
      expect(yield* memory.recall.note(agent, { text: 'Use retention_hours, never retentionHours: ops scripts parse it.', category: 'feedback' })).toBe(
        'Saved n:1. It appears in the start block of later threads.',
      )
      expect(yield* memory.repo.note(1)).toMatchObject({ origin: 'user-requested', sourceThread: 'session-writer', sourceSeq: 7, category: 'feedback' })
      expect(yield* memory.recall.note(agent, { action: 'update', id: 'n:1', text: 'Use retention_hours (snake_case) in every CLI flag.' })).toBe(
        'memory_note update needs a reason.',
      )
      expect(
        yield* memory.recall.note(agent, {
          action: 'update',
          id: 'n:1',
          text: 'Use retention_hours (snake_case) in every CLI flag.',
          reason: 'widened by the user',
        }),
      ).toBe('n:1 is superseded by n:2.')
      expect(yield* memory.recall.note(agent, { action: 'forget', id: 'n:2', reason: 'flag removed' })).toBe('Forgot n:2.')
      expect((yield* memory.repo.usage).notes).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('catches up on sessions it has never seen and skips trivial ones', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const hello = createThread({ id: 'session-hello', cwd: memory.root })
      hello.exchange('hi', 'Hello!')
      const real = halyardThread('session-33333333', memory.root)
      memory.fakes.logs.set(hello.header.id, hello.log())
      memory.fakes.logs.set(real.header.id, real.log())
      expect(yield* memory.digester.catchUp(10)).toBe(2)
      expect(yield* memory.repo.thread('session-hello')).toBeUndefined()
      expect(yield* memory.repo.thread('session-33333333')).toBeDefined()
      expect(yield* memory.digester.catchUp(10)).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('ranks with BM25 unless hybrid is asked for and an embedding provider loads', () =>
    Effect.gen(function* () {
      const query = 'readers were reshuffling whenever the leader bounced'
      const seed = (memory: Effect.Success<ReturnType<typeof harness>>) =>
        Effect.gen(function* () {
          const thread = createThread({ id: 'session-44444444', cwd: memory.root })
          thread.exchange(
            'Why did the consumer group rebalance storm happen after the coordinator restart?',
            'Every config push restarted the coordinators, so consumers kept rebalancing; pushes now reload in place.',
          )
          thread.exchange('Ship the fix to staging first.', 'Deployed to staging; the rebalance storm no longer happens on a config push.')
          memory.fakes.logs.set(thread.header.id, thread.log())
          yield* memory.digester.digest(thread.header.id)
        })
      const plain = yield* harness({ settings: { retrieval: 'hybrid' } })
      yield* seed(plain)
      expect(yield* plain.recall.retrievalStatus).toEqual({ requested: 'hybrid', active: 'bm25', model: null, reason: 'no embeddingProvider is configured' })
      expect(yield* plain.recall.search(plain.caller('session-reader'), { query })).toContain('No memory matches')

      const hybrid = yield* harness({ settings: { retrieval: 'hybrid' }, embedder: true })
      yield* seed(hybrid)
      yield* hybrid.embedder.embedMissing
      expect(yield* hybrid.recall.retrievalStatus).toEqual({ requested: 'hybrid', active: 'hybrid', model: 'concepts-v1', reason: null })
      expect(yield* hybrid.recall.search(hybrid.caller('session-reader'), { query })).toContain('t:44444444')
    }).pipe(Effect.scoped),
  )

  it.effect('flags, as heuristics, a citation the user then corrects and one the agent later revises', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = halyardThread('session-11111111-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      yield* memory.digester.digest(thread.header.id)
      yield* memory.emit('session-user', reply(1, 'Northwind is on the Enterprise tier.\nmemory: t:11111111'))
      yield* memory.emit('session-user', ask(2, "No, that's wrong: they moved to the Scale tier last week."))
      yield* memory.emit('session-agent', reply(1, 'The admin API listens on 9644.\nmemory: t:11111111'))
      yield* memory.emit('session-agent', reply(2, 'I was wrong: the admin API moved to 9654 in 4.2.0.'))
      yield* memory.emit('session-fine', reply(1, 'INC-20931 delayed delivery by 26 minutes.\nmemory: t:11111111'))
      yield* memory.emit('session-fine', reply(2, 'The incident note is drafted.'))
      yield* settle
      const flags = Object.fromEntries(
        (yield* memory.repo.recentCitations({ limit: 10 })).map(citation => [citation.thread, [citation.userCorrected, citation.agentCorrected]]),
      )
      expect(flags).toEqual({ 'session-user': [true, false], 'session-agent': [false, true], 'session-fine': [false, false] })
    }).pipe(Effect.scoped),
  )

  it.effect('finds a thread by title and content inside the caller project and records the finder call', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = halyardThread('session-11111111-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      memory.fakes.titles.set(thread.header.id, 'Northwind escalation')
      memory.fakes.content.hits = [{ sessionId: thread.header.id, snippet: 'Northwind Freight: account ACC-77341' }]
      const page = yield* memory.recall.findThreads(memory.caller('session-reader'), { query: 'northwind' })
      expect(page.project).toBe(memory.root)
      expect(page.hits.map(hit => hit.sessionId)).toEqual([thread.header.id])
      expect(page.hits[0]?.sources).toContain('session-content')
      expect(page.degraded).toEqual([])
      expect((yield* memory.repo.usage).tools.map(entry => entry.tool)).toContain('find_threads')
    }).pipe(Effect.scoped),
  )

  it.effect('records finder phase spans without queries or session identifiers', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const attributes = (name: string) => recorder.span(name).attributes
      const memory = yield* harness({})
      const thread = halyardThread('session-33333333-0000-4000-8000-000000000000', memory.root)
      const secondThread = createThread({ id: 'session-44444444-0000-4000-8000-000000000000', cwd: memory.root })
      memory.fakes.logs.set(thread.header.id, thread.log())
      memory.fakes.logs.set(secondThread.header.id, secondThread.log())
      memory.fakes.titles.set(thread.header.id, 'Synthetic finder title')
      memory.fakes.titles.set(secondThread.header.id, 'Second fixture title')
      memory.fakes.content.hits = [{ sessionId: thread.header.id, snippet: 'bounded sample' }]

      const page = yield* memory.recall.findThreads(memory.caller('session-reader'), { query: 'synthetic' })

      expect(page.hits.map(hit => hit.sessionId)).toEqual([thread.header.id])
      expect(attributes('thread finder resolve caller project')['dshx.memory.finder.caller_project_resolved']).toBe(true)
      expect(attributes('thread finder prepare records')['dshx.memory.finder.record_count']).toBe(2)
      expect(attributes('thread finder list sessions')['dshx.memory.finder.session_count']).toBe(2)
      expect(attributes('thread finder read titles')).toMatchObject({ 'dshx.memory.finder.title_count': 2, 'dshx.memory.finder.title_read_failed': false })
      expect(attributes('thread finder resolve projects')).toMatchObject({
        'dshx.memory.finder.project_resolution_count': 2,
        'dshx.memory.finder.unique_cwd_count': 1,
      })
      expect(attributes('thread finder content search')).toMatchObject({
        'dshx.memory.finder.content_hits': 1,
        'dshx.memory.finder.content_attempts': 1,
        'dshx.memory.finder.content_degraded': false,
      })
      expect(attributes('thread finder memory search')['dshx.memory.finder.memory_hits']).toBe(0)
      const all = [
        'thread finder resolve caller project',
        'thread finder prepare records',
        'thread finder list sessions',
        'thread finder read titles',
        'thread finder resolve projects',
        'thread finder content search',
        'thread finder memory search',
      ]
        .map(name => JSON.stringify(attributes(name)))
        .join(' ')
      expect(all).not.toContain('synthetic')
      expect(all).not.toContain(thread.header.id)
      expect(all).not.toContain(secondThread.header.id)
      expect(all).not.toContain(memory.root)
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )

  it.effect('records a memory jev ask span per question without the key or the text', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const memory = yield* harness({ settings: { jevEnabled: true }, jev: { probability: 0.8 } })
      yield* memory.recall.startBlock(memory.caller('session-jev-span'), Effect.succeed('synthetic prompt text'))
      const span = recorder.span('memory jev ask')
      expect(JSON.stringify(span.attributes)).not.toContain('synthetic')
      expect(recorder.span('memory recall gate')).toBeDefined()
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )

  it.effect('stops title loading when the caller interrupts thread search', () =>
    Effect.gen(function* () {
      const memory = yield* harness({ slowTitles: true })
      const thread = halyardThread('session-cancelled-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      const search = yield* Effect.forkChild(memory.recall.findThreads(memory.caller('session-reader'), { query: 'northwind' }))
      yield* settle
      expect(memory.fakes.titleReads.started).toBe(1)
      yield* Fiber.interrupt(search)
      expect(memory.fakes.titleReads.interrupted).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect('answers memory message hits from stored excerpts without reading Session logs', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = halyardThread('session-22222222-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      memory.fakes.titles.set(thread.header.id, 'Ops notes')
      yield* memory.repo.indexMessages({
        thread: thread.header.id,
        project: memory.root,
        throughSeq: 2,
        messages: [{ seq: 2, role: 'user', text: 'The halyard coordinator restarted during the config push.', at: 0 }],
      })
      const page = yield* memory.recall.findThreads(memory.caller('session-reader'), { query: 'coordinator' })
      expect(page.hits.map(hit => hit.sessionId)).toEqual([thread.header.id])
      expect(page.hits[0]?.sources).toContain('memory-message')
      expect(memory.fakes.reads.count).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('reports a finder that cannot search content as an actionable code, never as an empty page', () =>
    Effect.gen(function* () {
      const memory = yield* harness({})
      const thread = halyardThread('session-11111111-0000-4000-8000-000000000000', memory.root)
      memory.fakes.logs.set(thread.header.id, thread.log())
      memory.fakes.content.error = new ContentSearchFailed({
        code: 'SESSION_QUERY_SEARCH_DISABLED',
        reason: 'session search is disabled: this deployment configures the session-query index with openAt "never"',
      })
      const failure = yield* Effect.flip(memory.recall.findThreads(memory.caller('session-reader'), { query: 'nothing matches this' }))
      expect(failure).toMatchObject({ _tag: 'FinderSearchUnavailable', code: 'SESSION_QUERY_SEARCH_DISABLED' })
    }).pipe(Effect.scoped),
  )
})
