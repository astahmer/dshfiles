/**
 * How often the thread's dev-server and preview reads run.
 *
 * A listening port appears without any Host event, so the dev-server list is
 * polled. A preview page is pushed through `pagesChanged`, so polling its list
 * on the same schedule only repeated work the event already triggers: every
 * round of an idle thread cost two requests instead of one.
 */

/** One interval for a port a thread just started; deliberately slow, it is a discovery net. */
const DEV_SERVERS_POLL_MS = 10_000

export class DevServerPoll {
  /** Shared by the chip and its tests, so the cadence is stated once. */
  static readonly intervalMs = DEV_SERVERS_POLL_MS

  /** Query keys are scoped per thread so two mounted headers never share a read. */
  static serversKey(sessionId: string): readonly ['dshfiles-preview', 'servers', string] {
    return ['dshfiles-preview', 'servers', sessionId]
  }

  static pagesKey(sessionId: string): readonly ['dshfiles-preview', 'pages', string] {
    return ['dshfiles-preview', 'pages', sessionId]
  }

  /**
   * The dev-server list polls until an older Host without the API is detected.
   * @param input - whether this round failed because the Host lacks the plugin API.
   * @returns the poll interval in milliseconds, or false to stop polling.
   */
  static serversIntervalMs(input: { readonly ownerMissing: boolean }): number | false {
    return input.ownerMissing ? false : DEV_SERVERS_POLL_MS
  }

  /**
   * Preview pages never poll: `pagesChanged` invalidates their key, including the
   * initial read on a live connection.
   * @returns always false.
   */
  static readonly pagesIntervalMs = (): false => false
}
