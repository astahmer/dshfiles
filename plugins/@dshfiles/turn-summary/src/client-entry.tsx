import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { turnActivityDefinition } from './turn-activity-node.js'
import { TurnSummaryLine } from './turn-summary-line.js'

export default defineClientPlugin({
  id: 'turn-summary',
  uses: ['ui'],
  inject: ['uiConversation'],
  setup(api) {
    api.lifecycle.onDispose(api.raw.ctx.uiConversation.events.register(turnActivityDefinition))
    api.ui.register({ name: 'conversation.chat.turnTail', id: 'dshfiles-turn-summary', order: 50 }, props => <TurnSummaryLine turn={props.turn} />)
  },
})
