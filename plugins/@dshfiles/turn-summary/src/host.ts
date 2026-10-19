import { defineHost } from '@dshfiles/dshx/host'
import { turnSummarySettings } from './settings.js'

export default defineHost({ name: '@dshfiles/turn-summary', settings: [turnSummarySettings] })
