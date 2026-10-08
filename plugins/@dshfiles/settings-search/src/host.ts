import { defineHost } from '@dshfiles/dshx/host'
import { settingsSearchSettings } from './settings.js'

export default defineHost({ name: '@dshfiles/settings-search', settings: [settingsSearchSettings] })
