import { defineClientPlugin } from '@dshfiles/dshx/client'
import PromptStashAction from './prompt-stash-action.js'

export default defineClientPlugin({
  id: 'prompt-stash',
  uses: ['composer'],
  setup(api) {
    api.composer.registerAction({
      id: 'prompt-stash-action',
      placement: 'right',
      order: 60,
      component: PromptStashAction,
    })
  },
})
