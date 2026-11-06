import type { ApiResourceOptions, ResourceSnapshot } from '@dshfiles/dshx/client'

/**
 * A Backlog panel stays mounted while another main panel is shown; the resource store polls only while it is visible
 * and reads once when it is shown again. The revision read notices any write: the Host's `changed` event re-reads it at
 * once, so while that event is live the poll is only a slow safety net. The AI-activity read drives the working
 * indicator and stops polling after a failure until the panel is shown again.
 */
const revision = { pollInterval: 5_000, livePollInterval: 60_000 } satisfies ApiResourceOptions<number>

const aiActivity = {
  pollInterval: 1_000,
  shouldPoll: (snapshot: ResourceSnapshot<{ readonly active: boolean }>) => snapshot.status !== 'error',
} satisfies ApiResourceOptions<{ readonly active: boolean }>

export class BacklogPanelPoll {
  static readonly revision = revision
  static readonly aiActivity = aiActivity
}
