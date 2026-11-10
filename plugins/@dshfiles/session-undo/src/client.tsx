import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatTurnActionExtras } from '@dshfiles/chat/chat-focus'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { SESSION_UNDO_LOCALE, sessionUndoLocale } from './locales.js'
import { TurnCheckpoint } from './turn-checkpoint.js'
import { UndoControl } from './undo-control.js'

export default defineClient({
  name: '@dshfiles/session-undo',
  locales: [sessionUndoLocale],
  inject: ['slots', 'uiWorkspace'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(SESSION_UNDO_LOCALE)
    // The composer, not the header: a fork cut before the first turn is a blank thread, which shows no header.
    ctx.slots.inject('conversation.input.right', () =>
      ctx.slots.register(
        { name: 'conversation.input.right', id: 'dshfiles-session-undo', order: 54 },
        decorate((props: PropsRuntime<'conversation.input.right'>) => (
          <PluginQueryProvider>
            <UndoControl openSession={sessionId => ctx.uiWorkspace.openSession(SessionId(sessionId))} sessionId={props.sessionId} t={translate} />
          </PluginQueryProvider>
        )),
      ),
    )
    // Beside copy, branch and the turn's trace: the revision this turn's edits left, and a restore to it.
    ctx.slots.inject('conversation.chat.assistant-actions', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.assistant-actions',
          id: 'dshfiles-session-undo-checkpoint',
          order: 80,
          inject: sessionId => ({ sessionId }),
        },
        decorate((props: ChatTurnActionExtras & { readonly sessionId: string }) =>
          props.turn === undefined ? null : (
            <PluginQueryProvider>
              <TurnCheckpoint
                openSession={sessionId => ctx.uiWorkspace.openSession(SessionId(sessionId))}
                sessionId={props.sessionId}
                t={translate}
                turn={props.turn.turn}
              />
            </PluginQueryProvider>
          ),
        ),
      ),
    )
  },
})
