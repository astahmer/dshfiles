import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { DraftInitializationResult } from './native/contract/input.ts'
import type { DraftInput } from './native/contract/draft-editor.ts'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'

export type { DraftInitializationOptions, DraftInitializationResult } from './native/contract/input.ts'
export type { DraftInput, DraftReference, DraftSnapshot } from './native/contract/draft-editor.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One compact status pill about the thread's work (the jujutsu Changes pill, visual refresh T3.2): before the
     * header utilities on desktop and before `⋯` in the phone top bar, where the utilities fold into the sheet. Only
     * this fork renders it; a provider on the stock conversation row simply does not show.
     */
    'conversation.session.header.changes': {
      kind: 'list'
      scope: 'session'
      owner: {
        /** Marker field: entries receive no owner-specific values. */
        children?: never
      }
    }
    /**
     * The new-thread hero's suggestion cards (visual refresh T3.4): Resume, Review, Inbox, each from the plugin that
     * owns the data. An entry renders null when it has nothing real to suggest, so the row simply shrinks.
     */
    'conversation.hero.suggestions': {
      kind: 'list'
      scope: 'root'
      owner: {
        /** The blank Session the hero belongs to, when there is one: a card never suggests this thread. */
        readonly heroSessionId: string | undefined
      }
    }
  }
}

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
     * Readings inside the composer's context meter panel, under the occupancy breakdown (how far the thread is from
     * automatic compaction), so the meter line carries one context item. An occupant renders one row (a `div`) and
     * `null` when it has nothing to say. Upstream's `conversation.composer.location` seat, which nothing filled in
     * this fork, is gone (b:ysaj).
     */
    'conversation.composer.context': { kind: 'list'; scope: 'session' }
  }
}
