import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { CommunicationPrincipal, CommunicationService } from '@dshfiles/dshx/communication'

export const communicationWorkspaceTopic = (cwd: string | undefined): string | undefined => {
  if (cwd === undefined || cwd.length === 0) return undefined
  const digest = createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 24)
  return `workspace/${digest}`
}

export const initializeCommunicationAgent = async (input: {
  readonly service: CommunicationService
  readonly agentId: string
  readonly workspaceCwd: string | undefined
}): Promise<void> => {
  const principal: CommunicationPrincipal = { kind: 'agent', id: input.agentId }
  const workspaceTopic = communicationWorkspaceTopic(input.workspaceCwd)
  if (workspaceTopic !== undefined) await input.service.ensureSubscription(principal, { topic: workspaceTopic, delivery: 'passive' })
  await input.service.ensureSubscription(principal, { topic: 'inbox', delivery: 'passive' })
}
