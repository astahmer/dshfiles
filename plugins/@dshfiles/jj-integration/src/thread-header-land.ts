/**
 * The thread header's Land, for the views that sit beside it. Published as the
 * `@dshfiles/jj-integration/thread-header-land` dshx module: jj-integration provides it, and diffs-review's land card
 * reads it so a screen with a header Land has one primary Land.
 */
import { defineContract } from '@dshfiles/dshx/client'

export interface ThreadHeaderLandService {
  /** Whether a header Land shows for this thread now. */
  readonly shown: (sessionId: string) => boolean
  readonly subscribe: (listener: () => void) => () => void
}

export const ThreadHeaderLand = defineContract<ThreadHeaderLandService>('@dshfiles/jj-integration.thread-header-land', {
  owner: '@dshfiles/jj-integration',
})
