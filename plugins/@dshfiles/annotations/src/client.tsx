import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { AnnotationsAction } from './ui/annotations-action.js'
import { PickerOverlay } from './ui/picker-overlay.js'

export default defineClientPlugin({
  id: 'annotations',
  uses: ['composer', 'ui'],
  setup(api) {
    api.composer.registerAction({
      id: 'annotations-pick',
      placement: 'left',
      order: 40,
      component: props => (
        <PluginQueryProvider>
          <AnnotationsAction {...props} />
        </PluginQueryProvider>
      ),
    })
    api.ui.register({ name: 'shell.overlay', id: 'dshfiles-annotations-picker', order: 140 }, () => (
      <PluginQueryProvider>
        <PickerOverlay />
      </PluginQueryProvider>
    ))
  },
})
