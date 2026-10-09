import { defineHost } from '@dshfiles/dshx/host'
import { threadSidebarRestartApi } from './restart-api.js'
import { createRestartController } from './restart.js'
import { threadSidebarSettings } from './settings.js'

const restartApi = threadSidebarRestartApi.host({
  availability: ({ ctx }) => ({ available: createRestartController(ctx).available }),
  requestRestart: async ({ ctx }) => {
    try {
      return await createRestartController(ctx).request()
    } catch {
      throw new Error('Could not schedule a safe DSH restart.')
    }
  },
})

export default defineHost({
  name: '@dshfiles/thread-sidebar',
  settings: [threadSidebarSettings],
  inject: ['connection'],
  apis: [restartApi],
})
