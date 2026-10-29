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
