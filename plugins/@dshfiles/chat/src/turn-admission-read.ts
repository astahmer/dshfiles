import type { ApiResourceOptions } from '@dshfiles/dshx/client'
import type { TurnAdmissionSnapshot } from '@dshfiles/session-controller/turn-admission-api'

/**
 * The waiting-turn dock re-reads the admission snapshot on the Host's `changed` event, so it polls only while that event
 * is not live (a Host older than the event, a dropped event stream). It used to poll every 3 s on every open thread.
 */
export const TURN_ADMISSION_READ = { pollInterval: 30_000 } satisfies ApiResourceOptions<TurnAdmissionSnapshot>
