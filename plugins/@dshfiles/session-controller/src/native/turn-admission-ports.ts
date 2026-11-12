import type { Context } from '@deepseek-ai/cordis'
import { TurnAdmissionQueue, type TurnAdmissionSnapshot } from '../turn-admission.ts'
import { hasApiSessionSubagentOwner } from './agent.ts'

/**
 * dshfiles: the running-thread limit over the live Agent registry. Running Agents fill slots (subagents only when the
 * policy counts them); a held prompt starts by leaving the inbox and entering it again through a waking delivery;
 * every Agent going idle or leaving pumps the queue.
 * @param ctx - Host context holding the Agent registry.
 * @param changed - told each queue change, and each running-count change while turns wait.
 * @returns the admission queue the prompt command consults.
 */
export const installTurnAdmission = (
  ctx: Context,
  changed: (snapshot: TurnAdmissionSnapshot) => void = () => {},
): TurnAdmissionQueue => {
  const queue = new TurnAdmissionQueue({
    running: countSubagents => ctx.agents.list().filter(agent => agent.status === 'running'
      && (countSubagents || !hasApiSessionSubagentOwner(agent.session))).length,
    release: (held) => {
      const agent = ctx.agents.list().find(candidate => candidate.id === held.sessionId)
      const message = agent?.inbox.nextTurn.find(pending => pending.id === held.messageId)
      if (agent === undefined || message === undefined || !agent.inbox.remove(message.id)) return false
      if (held.mode === 'steer') agent.steer(message)
      else agent.followup(message)
      return true
    },
    changed,
  })
  ctx.on('agent/status', ({ status }) => {
    if (status === 'idle') queue.pump()
    queue.runningChanged()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    queue.drop(agent.id)
    queue.pump()
  })
  return queue
}
