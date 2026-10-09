import { MemoryError } from './memory-error.ts'
import { StreamIds } from './stream-ids.ts'
import type { MemoryAccess, MemoryScope, StreamId } from './types.ts'

export class Scopes {
  /** The tree a scope reads; `null` means every stream (all-projects search). */
  static stream(scope: MemoryScope, access: MemoryAccess): StreamId | null {
    if (scope === 'conversation') return StreamIds.conversation(access.conversationId)
    if (scope === 'project') return access.projectId === null ? StreamIds.conversation(access.conversationId) : StreamIds.project(access.projectId)
    if (scope === 'global') return StreamIds.global
    if (!access.allowAllProjects) throw new MemoryError('scope-denied', 'all-projects retrieval is disabled for this conversation')
    return null
  }

  /** Same-project conversations share memory; other projects need `allowAllProjects`. */
  static canRead(stream: StreamId, access: MemoryAccess, conversationProject: string | null | undefined): boolean {
    if (access.allowAllProjects || stream === 'global') return true
    if (stream === StreamIds.conversation(access.conversationId)) return true
    if (access.projectId === null) return false
    if (stream === StreamIds.project(access.projectId)) return true
    return stream.startsWith('conversation:') && conversationProject === access.projectId
  }
}
