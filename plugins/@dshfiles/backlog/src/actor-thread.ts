import type { ComposerThread } from './composer.js'

export const actorThreadFor = (actorId: string, threads: readonly ComposerThread[]): ComposerThread | undefined => {
  if (!actorId.startsWith('agent:')) return undefined
  const sessionId = actorId.slice('agent:'.length)
  return threads.find(thread => thread.id === sessionId)
}
