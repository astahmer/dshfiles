import { defineHost } from '@dshfiles/dshx/host'
import { threadSidebarSettings } from './settings.js'

export default defineHost({
  name: '@dshfiles/thread-sidebar',
  settings: [threadSidebarSettings],
})
