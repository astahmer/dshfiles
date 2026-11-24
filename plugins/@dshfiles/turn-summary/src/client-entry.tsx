import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ChatTurnTailExtras } from '@dshfiles/chat/chat-focus'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import type { ComponentProps } from 'react'
import { turnActivityDefinition } from './turn-activity-node.js'
import { TurnSummaryLine } from './turn-summary-line.js'
import { TurnWalkthroughModel } from './turn-walkthrough-model.js'

type TurnTailProps = Pick<ComponentProps<typeof TurnSummaryLine>, 'openFile' | 'turn'>

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
    // The Chat fork adds its Conversation View opener to each Turn-tail row's props (`ChatTurnTailExtras`).
    api.ui.register({ name: 'conversation.chat.turnTail', id: 'dshfiles-turn-summary', order: 50 }, (props: TurnTailProps & ChatTurnTailExtras) => (
      <TurnSummaryLine openChanges={openChanges} openFile={props.openFile} openView={props.openView} turn={props.turn} />
    ))
  },
})
