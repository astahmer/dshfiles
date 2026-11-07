import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ComposerTool, defineClientPlugin, type ComposerToolProps } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { AnnotationsAction } from './ui/annotations-action.js'
import { PickerOverlay } from './ui/picker-overlay.js'
import type { JSX } from 'react'

export default defineClientPlugin({
  id: 'annotations',
  uses: ['ui'],
  setup(api) {
    const Tool = (props: ComposerToolProps): JSX.Element => (
      <PluginQueryProvider>
        <AnnotationsAction {...props} />
      </PluginQueryProvider>
    )
    api.add(ComposerTool, { id: 'annotations-pick', order: 40, component: api.bind(Tool) })
    api.ui.register({ name: 'shell.overlay', id: 'dshfiles-annotations-picker', order: 140 }, () => (
      <PluginQueryProvider>
        <PickerOverlay />
      </PluginQueryProvider>
    ))
  },
})
