import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatTurnActionExtras } from '@dshfiles/chat/chat-focus'
import { Command, Composer, defineClient, useContract } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ComposerBar, ComposerMoreItems, type ComposerBarPlacement } from '@dshfiles/rich-composer/composer-more'
import { useSyncExternalStore } from 'react'
import { undoRequests, UndoRows, type UndoVerb } from './composer-rows.js'
import { SESSION_UNDO_LOCALE, sessionUndoLocale } from './locales.js'
import { TurnCheckpoint } from './turn-checkpoint.js'
import { UndoControl } from './undo-control.js'

const noSubscription = (): (() => void) => () => undefined
const alwaysPinned = (): boolean => true

/** Pinned (buttons in the bar) unless the composer owner says the user moved them into its More menu. */
const usePinned = (): boolean => {
  const bar = useContract(ComposerBar)
  const placement: ComposerBarPlacement | undefined = bar.status === 'active' ? bar.value : undefined
  return useSyncExternalStore(placement?.subscribe ?? noSubscription, placement?.pinned ?? alwaysPinned, placement?.pinned ?? alwaysPinned)
}

export default defineClient({
  name: '@dshfiles/session-undo',
  locales: [sessionUndoLocale],
  inject: ['slots', 'uiWorkspace'],
  setup(ctx, decorate, metadata) {
    const translate = ctx.locale.bind(SESSION_UNDO_LOCALE)
    const plugin = metadata?.plugin
    // The composer, not the header: a fork cut before the first turn is a blank thread, which shows no header.
    ctx.slots.inject('conversation.input.right', () =>
      ctx.slots.register(
        { name: 'conversation.input.right', id: 'dshfiles-session-undo', order: 54 },
        decorate((props: PropsRuntime<'conversation.input.right'>) => (
          <PluginQueryProvider>
            <UndoControl
              openSession={sessionId => ctx.uiWorkspace.openSession(SessionId(sessionId))}
              pinned={usePinned()}
              sessionId={props.sessionId}
              t={translate}
            />
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
    if (plugin === undefined) return
    // Rows of the composer's More menu (polish pass b:r4et) and the same verbs in the palette for the composer on screen.
    const rows: readonly { readonly verb: UndoVerb; readonly label: string; readonly order: number }[] = [
      { verb: 'undo', label: translate('undo'), order: 10 },
      { verb: 'rewind', label: translate('moreRewind'), order: 11 },
      { verb: 'redo', label: translate('moreRedo'), order: 12 },
    ]
    for (const row of rows) {
      plugin.add(ComposerMoreItems, {
        id: `@dshfiles/session-undo.${row.verb}`,
        group: 'history',
        order: row.order,
        label: row.label,
        available: sessionId => UndoRows.get(sessionId)[row.verb],
        select: sessionId => undoRequests.send(sessionId, row.verb),
      })
    }
    const composer = plugin.use(Composer)
    const onScreen = (): string | undefined => {
      const live = composer.get()
      return live.status === 'active' ? live.value.current.get() : undefined
    }
    for (const row of rows) {
      plugin.add(Command, {
        id: `@dshfiles/session-undo.${row.verb}`,
        title: row.label,
        group: 'Composer',
        run: () => {
          const sessionId = onScreen()
          if (sessionId !== undefined && UndoRows.get(sessionId)[row.verb]) undoRequests.send(sessionId, row.verb)
        },
      })
    }
  },
})
