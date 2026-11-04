import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { resolveAgentScope, type AgentScopeLookup } from './agent-scope.ts'

const lookupOf = (agents: Record<string, { memoryScope: string | null }>, parents: Record<string, string>): AgentScopeLookup<never> => ({
  threadAgent: sessionId => Effect.succeed(agents[sessionId] ?? null),
  parentOf: sessionId => Effect.succeed(parents[sessionId]),
})

describe('agent scope', () => {
  it.effect('a subagent inherits the scope of the agent whose thread spawned it', () =>
    Effect.gen(function* () {
      const lookup = lookupOf({ 'session-root': { memoryScope: 'agent:reviewer' } }, { 'session-child': 'session-root' })
      expect(yield* resolveAgentScope({ sessionId: 'session-child', lookup })).toBe('agent:reviewer')
    }),
  )

  it.effect('a chain is followed for a bounded number of hops', () =>
    Effect.gen(function* () {
      const parents = {
        'session-3': 'session-2',
        'session-2': 'session-1',
        'session-1': 'session-root',
        'session-root': 'session-above',
      } satisfies Record<string, string>
      const lookup = lookupOf({ 'session-above': { memoryScope: 'agent:planner' } }, parents)
      expect(yield* resolveAgentScope({ sessionId: 'session-3', lookup })).toBe('agent:planner')
      // One hop further than the cap: the scope is not found and the project block serves.
      const capped = yield* resolveAgentScope({
        sessionId: 'session-3',
        lookup: { ...lookup, parentOf: id => Effect.succeed(id === 'session-2' ? 'session-1' : id === 'session-1' ? 'session-root' : undefined) },
      })
      expect(capped).toBeNull()
    }),
  )

  it.effect('an agent thread with no scope stops the walk instead of borrowing its own parent', () =>
    Effect.gen(function* () {
      const lookup = lookupOf(
        { 'session-child': { memoryScope: null }, 'session-root': { memoryScope: 'agent:reviewer' } },
        { 'session-child': 'session-root' },
      )
      expect(yield* resolveAgentScope({ sessionId: 'session-child', lookup })).toBeNull()
    }),
  )

  it.effect('a thread no agent started, or a parent that is gone, reads the project block', () =>
    Effect.gen(function* () {
      expect(yield* resolveAgentScope({ sessionId: 'session-plain', lookup: lookupOf({}, {}) })).toBeNull()
      expect(yield* resolveAgentScope({ sessionId: 'session-orphan', lookup: lookupOf({}, { 'session-orphan': 'session-missing' }) })).toBeNull()
    }),
  )
})
