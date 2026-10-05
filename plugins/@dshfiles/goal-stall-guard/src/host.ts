import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { definePlugin } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { DEFAULT_STALL_POLICY, StallDetector } from './stall.js'

const rowConfig = z.object({
  /**
   * Consecutive goal rounds that produced no assistant content before the goal
   * is paused. Two is the floor: one empty round is ordinary provider noise.
   */
  stallThreshold: z.number().int().min(2).max(50).default(DEFAULT_STALL_POLICY.threshold),
})

/**
 * A row with no `config` key resolves to `undefined`, which the bare object
 * schema rejects outright — the entry then fails validation and never
 * activates. Accepting it here means a hand-edited row falls back to the
 * documented defaults instead of half-activating.
 */
export const Config = z.union([rowConfig, z.undefined()]).transform(config => rowConfig.parse(config ?? {}))

interface ContentBlock {
  readonly type: string
  readonly text?: string
}

const promptText = (data: unknown): string => {
  const content = (data as { readonly content?: readonly ContentBlock[] } | undefined)?.content
  if (content === undefined || !Array.isArray(content)) return ''
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
}

/**
 * Whether the model left anything for the conversation.
 *
 * A tool call counts: the round did work, even with no prose. Reasoning counts
 * only when it also carries text, because the recorded failure was a completion
 * whose reasoning never reached the surface as an answer.
 */
const assistantSaidAnything = (data: unknown): boolean => {
  const content = (data as { readonly message?: { readonly content?: readonly ContentBlock[] } } | undefined)?.message?.content
  if (content === undefined || !Array.isArray(content)) return false
  return content.some(block => {
    if (block.type === 'tool-call') return true
    return block.type !== 'text' && block.type !== 'reasoning' ? false : (block.text ?? '').trim().length > 0
  })
}

export default definePlugin({
  id: 'goal-stall-guard',
  name: '@dshfiles/goal-stall-guard',
  Config,
  inject: ['agents', 'goals', 'sessions'],
  setup: api => {
    const ctx: Context = api.raw.ctx
    const { stallThreshold } = Config.parse(api.config)
    const detector = StallDetector({ threshold: stallThreshold })

    ctx.on('session/event', (session, event) => {
      switch (event.type) {
        case 'turn/start':
          detector.turnStarted()
          return
        case 'user/message': {
          const text = promptText(event.data)
          if (text.length > 0) detector.promptEntered(text)
          return
        }
        case 'step/start':
          detector.turnIdentified(event.data.turn)
          return
        case 'assistant/message':
          if (assistantSaidAnything(event.data)) detector.contentProduced()
          return
        case 'turn/end': {
          const decision = detector.turnEnded()
          if (!decision.stalled) return
          const agent = ctx.agents.get(session.id)
          if (agent === undefined || agent.session !== session) return
          const goal = ctx.goals.get(agent)
          if (goal === undefined || goal.phase !== 'active') return
          try {
            ctx.goals.pause(agent, { id: goal.id, revision: goal.revision })
            ctx.logger.warn(
              'goal-stall-guard: paused goal "%s" after %d consecutive rounds produced no output (round %d)',
              goal.id,
              decision.consecutiveEmptyRounds,
              decision.round ?? 0,
            )
          } catch (error) {
            ctx.logger.warn('goal-stall-guard: could not pause stalled goal "%s": %o', goal.id, error)
          }
          return
        }
        default:
          return
      }
    })
  },
})

export { SessionId }
