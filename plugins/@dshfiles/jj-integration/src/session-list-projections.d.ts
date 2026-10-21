import '@deepseek-ai/dsh-api-session-controller/types'

/**
 * `@dshfiles/session-controller` forks the native controller and adds the
 * optional projection allowlist to `session/list`; the native package's client
 * types still describe the unfiltered request. Augment the one request type
 * this Host reads rather than restating the controller contract.
 */
declare module '@deepseek-ai/dsh-api-session-controller/types' {
  interface SessionListRequest {
    readonly projections?: readonly string[]
  }
}
