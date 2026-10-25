import type { ThreadIntegrationCategory } from './thread-integration-state.js'

/**
 * The prompt the newest completed Turn renders after its answer: one click lands the thread. It never invents
 * eligibility — the control center's own classification decides whether the workspace is ready, and the Host still
 * re-checks every fact when the integration runs.
 */
export class InlineIntegrateOffer {
  /**
   * Only the newest completed Turn offers it, and only while the workspace is `ready`: described, conflict-free
   * revisions with no Session writing and no question waiting. An older Turn keeps its notices and nothing else,
   * because a second button next to a landing notice would ask for work already integrated.
   */
  static readonly isOffered = (input: {
    readonly category: ThreadIntegrationCategory
    readonly isNewestTurn: boolean
    readonly archived: boolean
    /** An integration already runs for this workspace, so a second trigger would only race it. */
    readonly landing: boolean
    /** A queued integration already waits for the workspace to go idle; its notice offers Undo instead. */
    readonly queued: boolean
    /** Do not show a cached offer while a status refresh may already know it was integrated. */
    readonly statusRefreshing: boolean
  }): boolean => input.category === 'ready' && input.isNewestTurn && !input.archived && !input.landing && !input.queued && !input.statusRefreshing
}
