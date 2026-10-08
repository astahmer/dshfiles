import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import PromptLibraryAction from './prompt-stash-action.js'
import { PromptStashAction as PromptDraftsAction } from './prompt-stash.js'
import './client.css'

export default defineClientPlugin({
  id: 'prompt-stash',
  uses: ['composer'],
  setup(api) {
    api.composer.registerAction({
      id: 'prompt-stash-drafts',
      placement: 'left',
      component: PromptDraftsAction,
    })
    api.composer.registerAction({
      id: 'prompt-stash-action',
      placement: 'right',
      order: 60,
      component: PromptLibraryAction,
    })
  },
})
