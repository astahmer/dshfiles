import { defineClientPlugin } from '@dshfiles/dshx/client'
import { ModelEffortPicker } from './model-effort-picker.js'

export default defineClientPlugin({
  id: 'dshfiles-model-effort-picker',
  uses: ['ui', 'models'],
  setup(api) {
    api.ui.register(
      {
        name: 'conversation.input.model',
        // Lower priority wins, so shadow the native slot at priority 0.
        priority: -1,
        inject: sessionId => {
          const directory = api.models.directoryFor(sessionId)
          const available = api.raw.ctx.sessions.subagentAddress(sessionId) === undefined
          return {
            available,
            directory: directory.store,
            load: () => {
              if (available) directory.load().catch(() => undefined)
            },
            select: selection => (available ? directory.select(selection) : Promise.resolve(undefined)),
          }
        },
      },
      ModelEffortPicker,
    )
  },
})
