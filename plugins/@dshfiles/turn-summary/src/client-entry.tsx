import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { turnActivityDefinition } from './turn-activity-node.js'
import { TurnSummaryLine } from './turn-summary-line.js'
import { TurnWalkthroughModel } from './turn-walkthrough-model.js'

export default defineClientPlugin({
  id: 'turn-summary',
  uses: ['ui'],
  inject: ['uiConversation', 'sidebarRight'],
  setup(api) {
    const sidebarRight = api.raw.ctx.sidebarRight
    const openChanges = (input: { readonly seq: number; readonly turn: number }): void => {
      const sessionId = sidebarRight.mounted.getSnapshot()
      if (sessionId === undefined) return
      sidebarRight.openResource(TurnWalkthroughModel.changesAddress({ sessionId: String(sessionId), seq: input.seq, turn: input.turn }))
    }
    api.lifecycle.onDispose(api.raw.ctx.uiConversation.events.register(turnActivityDefinition))
    api.ui.register({ name: 'conversation.chat.turnTail', id: 'dshfiles-turn-summary', order: 50 }, props => (
      <TurnSummaryLine openChanges={openChanges} openFile={props.openFile} turn={props.turn} />
    ))
  },
})
