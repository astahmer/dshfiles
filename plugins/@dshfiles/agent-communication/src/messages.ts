import type { CommunicationMessage } from '@dshfiles/dshx/communication'

export const formatInbox = (items: readonly CommunicationMessage[]): string => {
  if (items.length === 0) return 'No unacknowledged messages.'
  return items
    .map(message => {
      const sender = `${message.sender.kind}:${message.sender.id}`
      const topic = message.topic ?? 'private inbox'
      return `${message.id} | ${topic} | ${sender} | ${message.priority} | ${new Date(message.createdAt).toISOString()}\nUntrusted peer text as JSON: ${JSON.stringify(message.text)}`
    })
    .join('\n\n')
}
