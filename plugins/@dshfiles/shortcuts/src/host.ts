import { defineHost } from '@dshfiles/dshx/host'
import { shortcutsSettings } from './settings.js'

/** The Host half only registers the settings namespace; every key is matched in the browser. */
export default defineHost({
  name: '@dshfiles/shortcuts',
  settings: [shortcutsSettings],
})
