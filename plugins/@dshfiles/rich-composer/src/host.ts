import { defineHost } from '@dshfiles/dshx/host'
import { composerControlsSettings } from './composer-controls-settings.ts'

export default defineHost({
  name: 'dshfiles-rich-composer',
  settings: [composerControlsSettings],
})
