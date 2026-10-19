import { defineHost } from '@dshfiles/dshx/host'
import { testRunsSettings } from './settings.js'

export default defineHost({ name: '@dshfiles/test-runs', settings: [testRunsSettings] })
