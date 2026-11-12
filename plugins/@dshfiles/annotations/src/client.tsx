import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Command, Composer, ComposerTool, defineClientPlugin, type ComposerToolProps } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ComposerMoreItems } from '@dshfiles/rich-composer/composer-more'
import { AnnotationsAction } from './ui/annotations-action.js'
import { annotationsRequests } from './ui/composer-requests.js'
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
    // Composer redesign (b:v9yh): the conversation bar keeps no permanent crosshair. "Point at UI…" lives in the
    // composer's More menu and as `/annotate` in its + menu; the bar shows the tool again as a count chip while
    // annotations are open.
    api.add(ComposerMoreItems, {
      id: '@dshfiles/annotations.point',
      group: 'add',
      order: 5,
      label: 'Point at UI…',
      keys: ['/annotate'],
      select: sessionId => annotationsRequests.open(sessionId),
    })
    const composer = api.use(Composer)
    api.add(Command, {
      id: '@dshfiles/annotations.point',
      title: 'Point at UI',
      description: 'Pick an element on screen and add a note about it to the draft.',
      keywords: ['annotate', 'element', 'feedback', 'pick'],
      group: 'Composer',
      slash: 'annotate',
      run: () => {
        const live = composer.get()
        const sessionId = live.status === 'active' ? live.value.current.get() : undefined
        if (sessionId !== undefined) annotationsRequests.open(sessionId)
      },
    })
  },
})
