import { defineHost } from '@dshfiles/dshx/host'
import { workbenchSettings } from './settings.js'

export default defineHost({
  name: '@dshfiles/workbench',
  settings: [workbenchSettings],
})
