import { SearchWorkerFailed } from './protocol.js'

export const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500)

export const indexFailure = (cause: unknown) => new SearchWorkerFailed({ code: 'session-search-index-failed', reason: describeError(cause), cause })
