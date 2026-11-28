import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { describe, expect, it, vi } from 'vitest'
import { GoalAutoRetry, RetryInputs, type Config, type HostServices } from './host.js'

const config: Config = { marginMinutes: 3, baseBackoffMinutes: 5, maxBackoffMinutes: 60, maxAttempts: 3 }

/** SAFETY: the fixture supplies every member of the view it overrides; the rest name a plausible goal. */
const goalOf = (overrides: Partial<GoalView> = {}): GoalView =>
  ({
    id: 'goal-1',
    revision: 4,
    objective: 'ship the plugin',
    phase: 'active',
    maxGoalRounds: 256,
    roundsStarted: 3,
    createdAt: 0,
    updatedAt: 0,
    activation: 'armed',
    ...overrides,
  }) as GoalView

/** Only the members these readers touch; the rest of DSH's Agent is not under test here. */
type AgentStub = Pick<Agent, 'id' | 'session'> & { readonly parent?: unknown }

/** SAFETY: `snapshotEvents` is the only Session member these readers call, and the events are the fixture's own objects. */
const sessionOf = (events: readonly unknown[]): AgentStub['session'] => ({ snapshotEvents: () => events }) as unknown as AgentStub['session']

/** SAFETY: the manager only reads `id`, `session.snapshotEvents`, and the parent marks, from this fixture. */
const agentStub = (input: { readonly events?: readonly unknown[]; readonly parent?: unknown }): AgentStub => {
  // SAFETY: the harness is the only caller, and 'session-1' is the id its manager and goal use.
  const stub: AgentStub = { id: 'session-1' as AgentStub['id'], session: sessionOf(input.events ?? []) }
  return input.parent === undefined ? stub : { ...stub, parent: input.parent }
}

/** SAFETY: the manager reads only `id`, `session.snapshotEvents` and the parent marks that the stub provides. */
const asAgent = (stub: AgentStub): Agent => stub as Agent

const harness = (input: { readonly goal?: GoalView | undefined; readonly arm?: { readonly enabled: boolean; readonly delayMinutes: number } } = {}) => {
  const agent = agentStub({})
  const resume = vi.fn((_agent: Agent, _ref: { readonly id: string; readonly revision: number }) => goalOf())
  let goal = 'goal' in input ? input.goal : goalOf()
  /** SAFETY: the manager asks for `goals` and `agents` by name only, and both stubs answer those two reads. */
  const services = (name: string): object | undefined => (name === 'goals' ? { get: () => goal, resume } : name === 'agents' ? { get: () => agent } : undefined)
  const ctx = { get: services, logger: { info: vi.fn(), warn: vi.fn() } }
  const published: string[] = []
  const manager = new GoalAutoRetry(
    // SAFETY: the stub answers every service and logger member the manager reads; the DSH-owned rest of the context is unused.
    ctx as unknown as HostServices,
    () => config,
    sessionId => published.push(sessionId),
  )
  manager.setArming('session-1', input.arm ?? { enabled: true, delayMinutes: 0 })
  const replaceGoal = (next: GoalView | undefined): void => {
    goal = next
  }
  return { agent, manager, resume, published, replaceGoal }
}

describe('goal auto retry timing', () => {
  it('resumes exactly the goal it was armed for', () => {
    const f = harness({ goal: goalOf({ phase: 'paused' }) })
    expect(f.manager.schedule({ agent: asAgent(f.agent), failure: { code: 'QUOTA', message: 'usage limit, try again in 10 min' } })).toBe(true)
    const retry = f.manager.pending.get('session-1')
    expect(retry?.source).toBe('reset')
    expect(retry?.delayMs).toBe(13 * 60_000)

    f.manager.fire('session-1', (retry?.at ?? 0) + 1)
    expect(f.resume).toHaveBeenCalledTimes(1)
    expect(f.resume.mock.calls[0]?.[1]).toEqual({ id: 'goal-1', revision: 4 })
    expect(f.manager.pending.has('session-1')).toBe(false)
  })

  it('does nothing before its time', () => {
    const f = harness()
    f.manager.schedule({ agent: asAgent(f.agent), failure: { code: 'QUOTA', message: 'try again in 30 min' } })
    f.manager.fire('session-1', Date.now() + 1_000)
    expect(f.resume).not.toHaveBeenCalled()
    f.manager.dispose()
  })

  it('stops resuming after the configured attempts', () => {
    const f = harness()
    const failure = { code: 'QUOTA', message: 'quota exceeded' }
    expect(f.manager.schedule({ agent: asAgent(f.agent), failure })).toBe(true)
    expect(f.manager.schedule({ agent: asAgent(f.agent), failure })).toBe(true)
    expect(f.manager.schedule({ agent: asAgent(f.agent), failure })).toBe(true)
    expect(f.manager.schedule({ agent: asAgent(f.agent), failure })).toBe(false)
    expect(f.manager.status('session-1')).toMatchObject({ kind: 'failed' })
    f.manager.dispose()
  })

  it('keeps counting refusals across the resumes it fired, so the attempt limit and the backoff still apply', () => {
    const f = harness()
    const failure = { code: 'QUOTA', message: 'quota exceeded' }
    const refuseAndFire = (): boolean => {
      const scheduled = f.manager.schedule({ agent: asAgent(f.agent), failure })
      const retry = f.manager.pending.get('session-1')
      if (retry !== undefined) f.manager.fire('session-1', retry.at + 1)
      return scheduled
    }
    expect(refuseAndFire()).toBe(true)
    expect(refuseAndFire()).toBe(true)
    expect(f.manager.schedule({ agent: asAgent(f.agent), failure })).toBe(true)
    expect(f.manager.pending.get('session-1')?.attempt).toBe(3)
    expect(f.manager.pending.get('session-1')?.delayMs).toBeGreaterThan(5 * 60_000 + 3 * 60_000)
    f.manager.fire('session-1', (f.manager.pending.get('session-1')?.at ?? 0) + 1)
    expect(f.manager.schedule({ agent: asAgent(f.agent), failure })).toBe(false)
    expect(f.manager.status('session-1')).toMatchObject({ kind: 'failed' })
    f.manager.dispose()
  })

  it('its own resume, which DSH reports as a goal resume, does not count as a human one', () => {
    const f = harness()
    f.resume.mockImplementation(agent => {
      f.manager.noteManualResume(agent)
      return goalOf()
    })
    const failure = { code: 'QUOTA', message: 'quota exceeded' }
    f.manager.schedule({ agent: asAgent(f.agent), failure })
    f.manager.fire('session-1', (f.manager.pending.get('session-1')?.at ?? 0) + 1)
    f.manager.schedule({ agent: asAgent(f.agent), failure })
    expect(f.manager.pending.get('session-1')?.attempt).toBe(2)
    f.manager.dispose()
  })

  it('starts counting again once the goal made progress between two refusals', () => {
    const f = harness()
    const failure = { code: 'QUOTA', message: 'quota exceeded' }
    f.manager.schedule({ agent: asAgent(f.agent), failure })
    f.manager.fire('session-1', (f.manager.pending.get('session-1')?.at ?? 0) + 1)
    f.replaceGoal(goalOf({ roundsStarted: 9 }))
    f.manager.schedule({ agent: asAgent(f.agent), failure })
    expect(f.manager.pending.get('session-1')?.attempt).toBe(1)
    f.manager.dispose()
  })

  it('stays paused with a reason when the goal was replaced', () => {
    const f = harness({ goal: goalOf() })
    f.manager.schedule({ agent: asAgent(f.agent), failure: { code: 'QUOTA', message: 'try again in 2 min' } })
    // SAFETY: the harness replaces the live goal with a different one; only the id identity matters to the assertion.
    f.replaceGoal({ ...goalOf(), id: goalOf().id.replace('goal-1', 'goal-2') as GoalView['id'] })
    const at = f.manager.pending.get('session-1')?.at ?? 0
    f.manager.fire('session-1', at + 1)
    expect(f.resume).not.toHaveBeenCalled()
    expect(f.manager.status('session-1')).toMatchObject({ kind: 'failed', reason: 'the goal was cleared or replaced' })
    f.manager.dispose()
  })

  it('does not resume a complete goal', () => {
    const f = harness({ goal: goalOf({ phase: 'complete' }) })
    f.manager.schedule({ agent: asAgent(f.agent), failure: { code: 'QUOTA', message: 'try again in 2 min' } })
    f.manager.fire('session-1', (f.manager.pending.get('session-1')?.at ?? 0) + 1)
    expect(f.resume).not.toHaveBeenCalled()
    expect(f.manager.status('session-1')).toEqual({ kind: 'idle' })
    f.manager.dispose()
  })

  it('honours the thread’s own delay over the provider’s claim', () => {
    const f = harness({ arm: { enabled: true, delayMinutes: 20 } })
    f.manager.schedule({ agent: asAgent(f.agent), failure: { code: 'QUOTA', message: 'try again in 4 hours' } })
    expect(f.manager.pending.get('session-1')).toMatchObject({ delayMs: 20 * 60_000, source: 'override' })
    f.manager.dispose()
  })

  it('drops the pending retry when a human resumes by hand', () => {
    const f = harness()
    f.manager.schedule({ agent: asAgent(f.agent), failure: { code: 'QUOTA', message: 'quota exceeded' } })
    f.manager.noteManualResume(asAgent(f.agent))
    expect(f.manager.pending.has('session-1')).toBe(false)
    f.manager.dispose()
  })
})

describe('what counts as a retryable refusal', () => {
  it('reads an LlmError’s code and keeps the provider Retry-After', () => {
    const failure = RetryInputs.failure(
      Object.assign(new Error('usage limit'), { code: 'PI_AI_ERROR', failure: { code: 'PI_AI_ERROR', message: 'usage limit', providerRetryAfterMs: 60_000 } }),
    )
    expect(failure?.code).toBe('PI_AI_ERROR')
    expect(failure?.resetAtMs).toBeGreaterThan(Date.now())
  })

  it('reads an LlmError whose provider sent no Retry-After, which is how a usage limit usually arrives', () => {
    const failure = RetryInputs.failure(
      Object.assign(new Error('usage limit'), {
        code: 'PI_AI_ERROR',
        failure: { code: 'PI_AI_ERROR', message: 'You have hit your ChatGPT usage limit (plus plan). Try again in ~246 min.' },
      }),
    )
    expect(failure).toEqual({ code: 'PI_AI_ERROR', message: 'You have hit your ChatGPT usage limit (plus plan). Try again in ~246 min.' })
  })

  it('control: a plain error with no failure code is not retryable', () => {
    expect(RetryInputs.failure(new Error('boom'))).toBeUndefined()
    expect(RetryInputs.failure(undefined)).toBeUndefined()
  })

  it('only counts a goal round, never a human turn', () => {
    expect(
      RetryInputs.failedGoalRound(
        asAgent(agentStub({ events: [{ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'goal', goalId: 'g', round: 2 } } }] })),
      ),
    ).toEqual({
      goalId: 'g',
      round: 2,
    })
    expect(
      RetryInputs.failedGoalRound(asAgent(agentStub({ events: [{ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'user' } } }] }))),
    ).toBeUndefined()
  })

  it('skips a subagent thread', () => {
    // SAFETY: isSubagent only asks the context for `subagents`, which this stub refuses.
    const ctx = { get: () => undefined } as unknown as CordisContext
    expect(RetryInputs.isSubagent(ctx, asAgent(agentStub({ parent: {} })))).toBe(true)
    expect(RetryInputs.isSubagent(ctx, asAgent(agentStub({})))).toBe(false)
  })
})
