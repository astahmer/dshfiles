import type { StreamId } from './types.ts'

export class StreamIds {
  static readonly global: StreamId = 'global'

  static conversation(conversationId: string): StreamId {
    return `conversation:${conversationId}`
  }

  static project(projectId: string): StreamId {
    return `project:${projectId}`
  }

  static parse(value: string): StreamId | undefined {
    if (value === 'global') return 'global'
    if (value.startsWith('conversation:') && value.length > 'conversation:'.length) return `conversation:${value.slice('conversation:'.length)}`
    if (value.startsWith('project:') && value.length > 'project:'.length) return `project:${value.slice('project:'.length)}`
    return undefined
  }

  static forEvent(event: { readonly conversationId: string; readonly projectId: string | null; readonly global: boolean }): readonly StreamId[] {
    return [
      StreamIds.conversation(event.conversationId),
      ...(event.projectId === null ? [] : [StreamIds.project(event.projectId)]),
      ...(event.global ? [StreamIds.global] : []),
    ]
  }
}
