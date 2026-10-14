import { defineHost } from '@dshfiles/dshx/host'
import { toolMetaSettings } from './settings.js'

export default defineHost({
  name: '@dshfiles/tool-meta',
  settings: [toolMetaSettings],
})
