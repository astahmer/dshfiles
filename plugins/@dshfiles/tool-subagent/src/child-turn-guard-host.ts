/**
 * Host wiring for the paused-child guard.
 *
 * The guard listens at the child's own turn boundary (`agent/turn-stopping`),
 * which the loop dispatches before it commits `turn/end`: a listener that steers
 * makes the loop run another step in the same turn, so the parent's completion
 * notice is only sent once the child actually stops. Nothing is awaited and no
 * state is persisted: a child that finishes normally pays one regex test.
 *
 * @module @dshfiles/tool-subagent/child-turn-guard-host
 */

import type { Events } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  CHILD_TURN_GUARD_SOURCE,
  ChildTurnGuard,
  ChildTurnTracker,
  type ChildTurnGuardConfig,
  type ChildTurnGuardPolicy,
  type ChildTurnGuardRow,
} from './child-turn-guard.ts'

/**
 * Continuing messages already steered into one child, shared by every loaded
 * instance: the delegation group mounts this package once per tool name, and a
 * second instance must not spend the same child's budget twice. Keyed by the
 * live Agent, so the count disappears with it.
 */
const resumesSpent = new WeakMap<Agent, number>()

/** Children whose exhausted budget was already reported to their parent. */
const budgetReported = new WeakSet<Agent>()

/** The model-visible text of one assistant message, as its hand-back reads. */
const assistantText = (message: SessionEvent<'assistant/message'>['data']['message']): string =>
  message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')

/** Quote one child's identity for the parent's notice and the Host log. */
const childLabel = (agent: Agent): string => String(agent.id)

/** One `agent/turn-stopping` payload: the child's turn about to close. */
type TurnStopping = Parameters<Events['agent/turn-stopping']>[0]

/**
 * Keep delegated children working when a completed turn hands the task back.
 *
 * @param ctx - context that owns the listeners; scoped to one agent or shared by many.
 * @param config - the row's guard config; omitted fields use the defaults.
 */
export const installChildTurnGuard = (ctx: Context, config: ChildTurnGuardConfig | ChildTurnGuardRow | undefined): void => {
  const policy: ChildTurnGuardPolicy = ChildTurnGuard.normalize(config)
  if (!policy.enabled) return
  const { patterns, rejected } = ChildTurnGuard.compile(policy.handBackPatterns)
  if (rejected.length > 0) {
    ctx.logger.warn(`tool-subagent: ignoring ${rejected.length} invalid child-turn-guard pattern(s): ${rejected.join(', ')}`)
  }
  if (patterns.length === 0) {
    ctx.logger.warn('tool-subagent: child-turn-guard has no usable hand-back pattern; the guard stays idle')
    return
  }

  const workRules = ChildTurnGuard.workRules(policy)
  const trackers = new Map<string, ChildTurnTracker>()
  const trackerFor = (session: Session): ChildTurnTracker => {
    const existing = trackers.get(session.id)
    if (existing !== undefined) return existing
    const created = new ChildTurnTracker(workRules)
    trackers.set(session.id, created)
    return created
  }

  const onSessionEvent = (session: Session, event: SessionEvent): void => {
    // Only a delegated child is guarded: a top-level turn's owner is the human, and
    // the same package is mounted in every agent composition.
    if (session.header.origin !== 'subagent') return
    const tracker = trackerFor(session)
    switch (event.type) {
      case 'turn/start':
        tracker.turnStarted(event.data.turn)
        return
      case 'tool/call':
        tracker.toolCalled(event.data.turn, { name: event.data.name, arguments: event.data.arguments })
        return
      case 'assistant/message':
        tracker.assistantSpoke(event.data.turn, assistantText(event.data.message))
        return
      default:
        return
    }
  }

  /** Tell the child's parent that its budget ran out; once per child, never a dead end. */
  const reportBudget = (agent: Agent, resumes: number): void => {
    if (budgetReported.has(agent)) return
    budgetReported.add(agent)
    const parentId = agent.session.header.parentSession
    const parent = parentId === undefined ? undefined : ctx.get('agents')?.get(parentId)
    ctx.logger.warn(
      'tool-subagent: child %s stopped without implementing after %d resume attempt(s); reporting its completion to the parent',
      childLabel(agent),
      resumes,
    )
    if (parent === undefined) return
    parent.inject(
      createUserMessage({
        content: [
          {
            type: 'text',
            text: `Subagent ${childLabel(agent)} stopped without implementing after ${resumes} resume attempt(s); its closing answer is a hand-back, not a finished task.`,
          },
        ],
        source: CHILD_TURN_GUARD_SOURCE,
      }),
    )
  }

  const onTurnStopping = ({ agent, turn, signal }: TurnStopping): void => {
    const session: Session = agent.session
    if (signal.aborted || session.header.origin !== 'subagent') return
    // A sibling instance (the same package under another tool name) already steered
    // this stop boundary, and the loop only dispatched it because the inbox was empty.
    if (agent.inbox.nextStep.length > 0 || agent.inbox.nextTurn.length > 0) return
    const observation = trackers.get(session.id)?.observation(turn)
    const resumes = resumesSpent.get(agent) ?? 0
    const verdict = ChildTurnGuard.verdict({ policy, observation, patterns, resumesUsed: resumes })
    if (verdict === 'not-hand-back' || verdict === 'worked') return
    if (verdict === 'budget-exhausted') {
      reportBudget(agent, resumes)
      return
    }
    resumesSpent.set(agent, resumes + 1)
    ctx.logger.info(
      'tool-subagent: resuming child %s after a hand-back (turn %d, %d tool call(s), no file change; resume %d of %d)',
      childLabel(agent),
      turn,
      observation?.toolCalls ?? 0,
      resumes + 1,
      policy.maxResumes,
    )
    agent.steer(createUserMessage({ content: [{ type: 'text', text: policy.resumeMessage }], source: CHILD_TURN_GUARD_SOURCE }))
  }

  ctx.on('session/event', onSessionEvent)
  ctx.on('agent/turn-stopping', onTurnStopping)
  ctx.on('agent/disposed', ({ agent }) => {
    trackers.delete(agent.session.id)
  })
}
