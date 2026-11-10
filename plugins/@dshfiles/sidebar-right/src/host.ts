import { defineHost } from '@dshfiles/dshx/host'
import { sidebarRightSettings } from './settings.js'

/** The fork adds presentation only; upstream providers retain all Host operations. The Host half registers its settings. */
export default defineHost({ name: '@dshfiles/sidebar-right', settings: [sidebarRightSettings] })
