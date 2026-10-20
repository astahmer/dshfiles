import { definePlugin } from '@dshfiles/dshx/host'
import { paletteSettings } from './settings.js'

export default definePlugin({ id: 'dshfiles-command-palette', settings: [paletteSettings] })
