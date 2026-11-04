import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { AgentSessions, AgentSessionsConfig } from './sessions.js'

const FIXTURE_HOME = fileURLToPath(new URL('../fixtures/home', import.meta.url))
const CLAUDE_KEY = 'claude-code:11111111-1111-4111-8111-111111111111'
const CODEX_KEY = 'codex:22222222-2222-4222-8222-222222222222'
const decodeIndex = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ entries: Schema.Array(Schema.Struct({ offset: Schema.Number, path: Schema.String })) })),
)

/** A writable copy of the fixture home, so a test can append to a log as a running CLI would. */
const scratchHome = Effect.acquireRelease(
  Effect.sync(() => {
    const root = mkdtempSync(join(tmpdir(), 'agentsview-'))
    cpSync(FIXTURE_HOME, join(root, 'home'), { recursive: true })
    return root
  }),
  root => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
)

const layerFor = (root: string, overrides: { readonly searchMaxSessions?: number } = {}) =>
  AgentSessions.layer.pipe(
    Layer.provide(
      AgentSessionsConfig.layer({
        roots: AgentSessionsConfig.defaultRoots({ home: join(root, 'home'), env: {}, join }),
        statePath: join(root, 'dsh-home', 'index.json'),
        ...overrides,
      }),
    ),
    Layer.provide([NodeFileSystem.layer, NodePath.layer]),
  )

const withSessions = <A, E>(
  root: string,
  use: (sessions: AgentSessions['Service']) => Effect.Effect<A, E>,
  overrides?: { readonly searchMaxSessions?: number },
) => AgentSessions.use(use).pipe(Effect.provide(layerFor(root, overrides)))

describe('AgentSessions', () => {
  it.effect('lists Claude Code and Codex sessions newest first and leaves subagent logs out', () =>
    Effect.gen(function* () {
      const root = yield* scratchHome
      const listed = yield* withSessions(root, sessions => sessions.list({}))
      expect(listed.indexing).toMatchObject({ totalFiles: 2, indexedFiles: 2, caughtUp: true, lastError: null })
      expect(listed.sessions.map(session => session.key)).toEqual([CODEX_KEY, CLAUDE_KEY])
      expect(listed.sessions[1]).toMatchObject({ title: 'Rename flamingo helper', cwd: '/fixture/agentsview/claude', userMessages: 1 })
      const codexOnly = yield* withSessions(root, sessions => sessions.list({ agent: 'codex' }))
      expect(codexOnly.sessions.map(session => session.key)).toEqual([CODEX_KEY])
      const filtered = yield* withSessions(root, sessions => sessions.list({ filter: 'FLAMINGO' }))
      expect(filtered.total).toBe(1)
      const underCwd = yield* withSessions(root, sessions => sessions.list({ cwd: '/fixture/agentsview/codex' }))
      expect(underCwd.sessions.map(session => session.key)).toEqual([CODEX_KEY])
    }),
  )

  it.effect('reports each source folder and whether it exists', () =>
    Effect.gen(function* () {
      const root = yield* scratchHome
      rmSync(join(root, 'home', '.codex'), { recursive: true })
      const sources = yield* withSessions(root, sessions => sessions.sources)
      expect(sources.sources.map(source => [source.agent, source.available, source.sessions])).toEqual([
        ['claude-code', true, 1],
        ['codex', false, 0],
      ])
    }),
  )

  it.effect('reads a transcript page, filtered by kind', () =>
    Effect.gen(function* () {
      const root = yield* scratchHome
      const full = yield* withSessions(root, sessions => sessions.read({ key: CLAUDE_KEY }))
      expect(full.total).toBe(6)
      expect(full.items.map(entry => entry.index)).toEqual([0, 1, 2, 3, 4, 5])
      const talk = yield* withSessions(root, sessions => sessions.read({ key: CLAUDE_KEY, kinds: ['user', 'assistant'], offset: 1, limit: 1 }))
      expect(talk).toMatchObject({ total: 2, offset: 1, capped: false })
      expect(talk.items).toEqual([expect.objectContaining({ index: 5, kind: 'assistant', text: 'Renamed flamingo to pelican in src/flamingo.ts.' })])
      const missing = yield* withSessions(root, sessions => Effect.flip(sessions.read({ key: 'codex:nope' })))
      expect(missing._tag).toBe('SessionNotFound')
    }),
  )

  it.effect('finds text in titles and messages and names the matching item', () =>
    Effect.gen(function* () {
      const root = yield* scratchHome
      const walrus = yield* withSessions(root, sessions => sessions.search({ query: 'walrus' }))
      expect(walrus.complete).toBe(true)
      expect(walrus.hits.map(hit => [hit.session.key, hit.itemIndex, hit.kind])).toEqual([
        [CODEX_KEY, null, null],
        [CODEX_KEY, 2, 'user'],
        [CODEX_KEY, 4, 'tool-call'],
        [CODEX_KEY, 6, 'assistant'],
      ])
      const pelican = yield* withSessions(root, sessions => sessions.search({ query: 'pelican', agent: 'claude-code' }))
      expect(pelican.hits.map(hit => hit.itemIndex)).toEqual([null, 1, 5])
      expect(pelican.hits[2]?.snippet).toContain('pelican')
    }),
  )

  it.effect('stops a search at its session budget and says it is incomplete', () =>
    Effect.gen(function* () {
      const root = yield* scratchHome
      const result = yield* withSessions(root, sessions => sessions.search({ query: 'pelican' }), { searchMaxSessions: 1 })
      expect(result).toMatchObject({ scannedSessions: 1, totalSessions: 2, complete: false })
    }),
  )

  it.effect('resumes a growing log at its byte offset and persists the index across Hosts', () =>
    Effect.gen(function* () {
      const root = yield* scratchHome
      const claudeLog = join(root, 'home', '.claude', 'projects', '-fixture-agentsview-claude', '11111111-1111-4111-8111-111111111111.jsonl')
      yield* withSessions(root, sessions => sessions.pass)
      const persisted = decodeIndex(readFileSync(join(root, 'dsh-home', 'index.json'), 'utf8'))
      const claudeEntry = persisted.entries.find(entry => entry.path === claudeLog)
      expect(claudeEntry?.offset).toBe(readFileSync(claudeLog).length)

      // A half-written line is left for the next pass; the completed one is counted once.
      const prompt = JSON.stringify({ type: 'user', timestamp: '2026-10-31T08:00:00.000Z', message: { role: 'user', content: 'Now add a pelican test' } })
      appendFileSync(claudeLog, prompt.slice(0, 20))
      const partial = yield* withSessions(root, sessions => Effect.andThen(sessions.pass, sessions.list({ agent: 'claude-code' })))
      expect(partial.sessions[0]?.userMessages).toBe(1)
      appendFileSync(claudeLog, `${prompt.slice(20)}\n`)
      const grown = yield* withSessions(root, sessions => Effect.andThen(sessions.pass, sessions.list({ agent: 'claude-code' })))
      expect(grown.sessions[0]).toMatchObject({ userMessages: 2, updatedAt: Date.parse('2026-10-31T08:00:00.000Z') })
    }),
  )

  it.effect('aggregates sessions, prompts and tokens by agent and model', () =>
    Effect.gen(function* () {
      const root = yield* scratchHome
      const stats = yield* withSessions(root, sessions => sessions.stats({ days: 365 }))
      expect(stats.totals).toMatchObject({ sessions: 2, userMessages: 2, toolCalls: 2 })
      expect(stats.byAgent.map(row => row.name).sort()).toEqual(['Claude Code', 'Codex'])
      expect(stats.byModel.map(row => row.name).sort()).toEqual(['claude-fixture-4', 'gpt-fixture-5'])
      expect(stats.byDay).toEqual([{ day: '2026-10-30', sessions: 2, outputTokens: 115 }])
    }),
  )

  it.effect('records one span per index pass, transcript read and search', () =>
    Effect.gen(function* () {
      const root = yield* scratchHome
      using recorder = recordSpans()
      yield* withSessions(root, sessions => Effect.andThen(sessions.read({ key: CODEX_KEY }), sessions.search({ query: 'walrus' }))).pipe(
        Effect.provide(tracerLayer),
      )
      expect(recorder.span('agentsview index pass').attributes['dshx.agentsview.roots']).toBe(2)
      expect(recorder.span('agentsview session read').attributes['dshx.agentsview.agent']).toBe('codex')
      expect(recorder.span('agentsview search').attributes['dshx.agentsview.agent']).toBe('all')
    }),
  )
})
