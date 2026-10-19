import { definePlugin } from '@dshfiles/dshx/host'
import { modelEffortPickerSettings } from './settings.js'

export default definePlugin({ id: 'dshfiles-model-effort-picker', settings: [modelEffortPickerSettings] })
