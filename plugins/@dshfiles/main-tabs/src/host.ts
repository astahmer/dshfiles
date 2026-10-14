import { defineHost } from '@dshfiles/dshx/host'
import { mainTabsSettings } from './settings.js'

export default defineHost({
  name: '@dshfiles/main-tabs',
  settings: [mainTabsSettings],
})
