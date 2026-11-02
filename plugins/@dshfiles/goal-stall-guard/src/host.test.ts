import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import { createAssistantMessage, createUserMessage, LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { vi } from 'vitest'
import plugin from './host.js'

/**
 * End-to-end wiring check against the recorded livelock, on a real Host with the native agent registry and goal
 * service. `stall.test.ts` proves the detector decides correctly in isolation; this proves the plugin reads the real
 * session-event shapes and reaches the real goals service. The event sequence is the shape taken from
 * session-dbe87c63's durable log: rounds carrying `<goal_round>` prompts, `assistant/message` events whose
 * `message.content` is empty, and `turn/end` with `{ kind: 'completed' }`.
 */

const roundPrompt = (round: number): string => `<goal_round>\nObjective: "restyle the sidebar"\nRound: ${round}/256\n\nContinue working toward the objective.`

const loadPlugin = async () => (process.env.DSH_GOAL_STALL_GUARD_BUILT === '1' ? import(new URL('../dist/index.js', import.meta.url).href) : plugin)

const fixture = (config: { readonly stallThreshold?: number } = {}) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const host = await createTestHost()
      await host.ctx.plugin(SessionStore)
      await host.ctx.plugin(SessionProjectionRegistry)
      await host.ctx.plugin(LlmRuntime)
      await host.ctx.plugin(AgentRegistry)
      await host.ctx.plugin(AgentLoop)
      await host.ctx.plugin(GoalService)
      await host.mount(await loadPlugin(), { packageId: '@dshfiles/goal-stall-guard', native: process.env.DSH_GOAL_STALL_GUARD_BUILT === '1', config })
      const handles: Array<{ readonly dispose: () => Promise<void> }> = []
      const createAgent = async (withGoal: boolean) => {
        const handle = await host.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: tmpdir() } })
        handles.push(handle)
        if (withGoal) host.ctx.goals.create(handle.agent, { objective: 'restyle the sidebar' })
        return handle
      }
      type FixtureAgent = Awaited<ReturnType<typeof createAgent>>['agent']
      const turnStart = (agent: FixtureAgent, turn: number) => agent.session.append('turn/start', { turn })
      const stepStart = (agent: FixtureAgent, turn: number) => agent.session.append('step/start', { turn, step: 1 })
      const prompt = (agent: FixtureAgent, input: { readonly text: string; readonly source?: { readonly kind: string } }) =>
        agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: input.text }], source: input.source ?? { kind: 'user' } }), {
          surfaceOp: 'append',
        })
      const answer = (agent: FixtureAgent, input: { readonly turn: number; readonly content: readonly unknown[] }) =>
        agent.session.append(
          'assistant/message',
          { turn: input.turn, step: 1, message: createAssistantMessage({ content: input.content, provider: 'test', model: 'test' }), stream: [] },
          { surfaceOp: 'append' },
        )
      const turnEnd = (agent: FixtureAgent, input: { readonly turn: number; readonly reason?: unknown }) =>
        agent.session.append('turn/end', { turn: input.turn, reason: input.reason ?? { kind: 'completed' } })
      const rounds = (input: {
        readonly agent: FixtureAgent
        readonly rounds: readonly number[]
        readonly prompt?: (round: number) => string
        readonly content?: readonly unknown[]
      }) => {
        for (const round of input.rounds) {
          turnStart(input.agent, round)
          prompt(input.agent, { text: (input.prompt ?? roundPrompt)(round) })
          stepStart(input.agent, round)
          answer(input.agent, { turn: round, content: input.content ?? [] })
          turnEnd(input.agent, { turn: round })
        }
      }
      const emptyRounds = (input: { readonly agent: FixtureAgent; readonly rounds: readonly number[]; readonly prompt?: (round: number) => string }) =>
        rounds(input)
      return { host, createAgent, turnStart, stepStart, prompt, turnEnd, rounds, emptyRounds, handles }
    }),
    f =>
      Effect.promise(async () => {
        for (const handle of f.handles.reverse()) await handle.dispose().catch(() => undefined)
        await f.host.dispose()
      }),
  )

const phaseOf = (f: Effect.Success<ReturnType<typeof fixture>>, agent: Parameters<typeof f.turnStart>[0]) => f.host.ctx.goals.get(agent)?.phase

const waitForPhase = (input: {
  readonly f: Effect.Success<ReturnType<typeof fixture>>
  readonly agent: Parameters<typeof input.f.turnStart>[0]
  readonly phase: string
}) => Effect.promise(() => vi.waitFor(() => expect(phaseOf(input.f, input.agent)).toBe(input.phase)))

describe('goal-stall-guard wiring', () => {
  it.effect('registers the supplemental continuation tools', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      expect(['extend_goal_budget', 'complete_blocked_goal'].map(name => f.host.tools.get(name)?.name)).toEqual(['extend_goal_budget', 'complete_blocked_goal'])
      const refused = yield* Effect.promise(() =>
        f.host.tools.execute({
          callId: ToolCallId(randomUUID()),
          name: 'complete_blocked_goal',
          arguments: { evidence: 'every requirement verified' },
          signal: new AbortController().signal,
        }),
      )
      expect(refused).toMatchObject({ isError: true, error: { message: 'Goal continuation requires an active Agent.' } })
    }),
  )

  it.effect('pauses the goal on the third consecutive empty round', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      f.emptyRounds({ agent, rounds: [1, 2, 3] })
      yield* waitForPhase({ f, agent, phase: 'paused' })
    }),
  )

  it.effect('counts a round whose prompt is followed by a runtime-context snapshot and whose turn failed empty', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      // The shape AI Accounts produces: DSH appends its runtime-context snapshot after the round prompt, and an empty
      // completion is retried as EMPTY_RESPONSE until the turn fails, with no assistant/message at all.
      for (const round of [1, 2, 3]) {
        f.turnStart(agent, round)
        f.stepStart(agent, round)
        f.prompt(agent, { text: roundPrompt(round) })
        f.prompt(agent, { text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.', source: { kind: 'runtime-context' } })
        f.turnEnd(agent, { turn: round, reason: { kind: 'error', error: { code: 'EMPTY_RESPONSE', message: 'no content' } } })
      }
      yield* waitForPhase({ f, agent, phase: 'paused' })
    }),
  )

  it.effect('the control: two empty rounds are not enough', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      f.emptyRounds({ agent, rounds: [1, 2] })
      expect(phaseOf(f, agent)).toBe('active')
    }),
  )

  it.effect('the control: a round that spoke never pauses the goal', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      f.rounds({ agent, rounds: [1, 2, 3, 4, 5, 6, 7, 8], content: [{ type: 'text', text: 'progress' }] })
      expect(phaseOf(f, agent)).toBe('active')
    }),
  )

  it.effect('the control: empty turns that are not goal rounds never pause the goal', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      f.emptyRounds({ agent, rounds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], prompt: () => 'a human typed something' })
      expect(phaseOf(f, agent)).toBe('active')
    }),
  )

  it.effect('a tool-only round counts as progress', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      f.rounds({ agent, rounds: [1, 2, 3, 4, 5, 6], content: [{ type: 'tool-call', id: 'call-1', name: 'bash', arguments: {} }] })
      expect(phaseOf(f, agent)).toBe('active')
    }),
  )

  it.effect('honours a configured threshold of two', () =>
    Effect.gen(function* () {
      const f = yield* fixture({ stallThreshold: 2 })
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      f.emptyRounds({ agent, rounds: [1, 2] })
      yield* waitForPhase({ f, agent, phase: 'paused' })
    }),
  )

  it.effect('ignores an agent with no goal', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const { agent } = yield* Effect.promise(() => f.createAgent(false))
      f.emptyRounds({ agent, rounds: [1, 2, 3] })
      expect(phaseOf(f, agent)).toBeUndefined()
    }),
  )

  it.effect('does not pause a goal that is not active', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      const goal = f.host.ctx.goals.get(agent)
      if (goal === undefined) throw new Error('the fixture goal was not created')
      const paused = f.host.ctx.goals.pause(agent, { id: goal.id, revision: goal.revision })
      f.emptyRounds({ agent, rounds: [1, 2, 3, 4] })
      expect(f.host.ctx.goals.get(agent)).toMatchObject({ phase: 'paused', revision: paused.revision })
    }),
  )

  it.effect('a pause rejection is logged, not thrown at the session loop', () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const gone = yield* Effect.promise(() => f.createAgent(true))
      f.emptyRounds({ agent: gone.agent, rounds: [1, 2, 3] })
      // The agent leaves before the queued pause runs, so the goal service refuses it.
      yield* Effect.promise(() => gone.dispose())
      const { agent } = yield* Effect.promise(() => f.createAgent(true))
      f.emptyRounds({ agent, rounds: [1, 2, 3] })
      yield* waitForPhase({ f, agent, phase: 'paused' })
    }),
  )
})
