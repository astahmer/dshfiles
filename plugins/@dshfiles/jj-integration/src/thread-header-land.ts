/**
 * The thread header's Land, for the views that sit beside it. Published as the
 * `@dshfiles/jj-integration/thread-header-land` dshx module: jj-integration provides it, jujutsu puts `PhoneLand` in the
 * phone top bar, and diffs-review's land card reads `shown` so a screen with a header Land has one primary Land.
 */
import { defineContract } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

export interface ThreadHeaderLandService {
  /**
   * The thread's Land for the phone top bar, with the header's confirmation. Renders nothing on a desktop shell (the
   * header control carries Land there) or while the thread has nothing that can land.
   */
  readonly PhoneLand: ComponentType<{ readonly sessionId: string }>
  /** Whether a header Land shows for this thread now. */
  readonly shown: (sessionId: string) => boolean
  readonly subscribe: (listener: () => void) => () => void
}

export const ThreadHeaderLand = defineContract<ThreadHeaderLandService>('@dshfiles/jj-integration.thread-header-land', {
  owner: '@dshfiles/jj-integration',
})
