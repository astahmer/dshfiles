import { defineHost } from '@dshfiles/dshx/host'
import { homeSettings } from './settings.js'

export default defineHost({
  name: 'home',
  settings: [homeSettings.host({})],
})
