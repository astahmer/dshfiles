import type { DraftInitializationResult } from './native/contract/input.ts'
import type { DraftInput } from './native/contract/draft-editor.ts'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'

export type { DraftInitializationOptions, DraftInitializationResult } from './native/contract/input.ts'
export type { DraftInput, DraftReference, DraftSnapshot } from './native/contract/draft-editor.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface SessionInputResolver {
    requestDraftInitialization(
      binding: SessionBinding,
      options: { readonly prompt?: DraftInput; readonly clearPreviousDraft?: boolean },
    ): DraftInitializationResult
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Where the started thread's run summary chip (project · host) continues: an occupant adds its own location
     * reading (a version-control workspace and bookmark) inside that one chip instead of a second chip on the meter line.
     * It renders its own leading separator.
     */
    'conversation.composer.location': { kind: 'list'; scope: 'session' }
  }
}
