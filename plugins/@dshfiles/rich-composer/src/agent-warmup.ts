import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/composer/first-edit'(sessionId: SessionId): void
  }
}

/**
 * Opening a cold thread leaves its Agent unresumed, so the first send would pay the resume (about 1 s on a long
 * thread). The first edit of a thread's draft announces itself so the client entry can start that resume while the
 * person is still typing. Kept free of dshx imports: the native input graph cannot take the dshx client types.
 */
export class AgentWarmup {
  static onFirstEdit(input: {
    readonly ctx: Context
    readonly sessionId: SessionId
    readonly state: ObservableSnapshot<{ readonly draft: string; readonly draftRev: number }>
  }): () => void {
    const openedAt = input.state.getSnapshot().draftRev
    const unsubscribe = input.state.subscribe(() => {
      const current = input.state.getSnapshot()
      if (current.draftRev === openedAt || current.draft.trim() === '') return
      unsubscribe()
      input.ctx.emit('dshfiles/composer/first-edit', input.sessionId)
    })
    return unsubscribe
  }
}
