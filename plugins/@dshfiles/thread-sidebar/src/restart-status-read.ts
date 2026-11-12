import type { ApiResourceOptions } from '@dshfiles/dshx/client'
import type { AutoRestartStatusWire } from './restart-api.js'

/**
 * The Host's `autoRestartChanged` event re-reads the status on every change, so it polls only while that event is not
 * live (an older Host, a dropped event stream). A restarted Host is a new connection generation, which re-reads it too.
 */
export const AUTO_RESTART_READ = { pollInterval: 5_000 } satisfies ApiResourceOptions<AutoRestartStatusWire>
