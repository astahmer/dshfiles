import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionSearchCursor, type SessionEventSearchPage, type SessionEventSearchRequest } from '@deepseek-ai/dsh-session-query'
import { Schema } from 'effect'

export class SessionHistoryModel {
  private static readonly maxHistoryCursorLength = 4096
  private static readonly maxHistoryPageSize = 10
  private static readonly maxHistorySnippetLength = 280
  private static readonly eventFilters: NonNullable<SessionEventSearchRequest['filters']> = [{ kind: 'type', values: ['user/message', 'assistant/message'] }]

  static readonly searchInputSchema = Schema.Struct({
    sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    query: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10))),
    cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(SessionHistoryModel.maxHistoryCursorLength))),
  })

  static readonly createSessionHistorySearchRequest = (input: {
    readonly sessionId: SessionId
    readonly query: string
    readonly limit: number
    readonly cursor: string | undefined
  }): SessionEventSearchRequest => {
    const baseRequest = {
      sessionId: input.sessionId,
      query: input.query,
      filters: SessionHistoryModel.eventFilters,
      limit: input.limit,
    }
    if (input.cursor === undefined) return baseRequest
    return { ...baseRequest, cursor: SessionSearchCursor(input.cursor) }
  }

  static readonly projectSessionHistoryPage = (input: {
    readonly page: SessionEventSearchPage
    readonly sessionId: SessionId
    readonly runtimeOwnerSessionId: SessionId
  }) => {
    const nextCursor = input.page.nextCursor
    const cursorFitsLimit = nextCursor !== undefined && nextCursor.length > 0 && nextCursor.length <= SessionHistoryModel.maxHistoryCursorLength
    return {
      status: 'results',
      session_id: input.sessionId,
      runtime_owner_session_id: input.runtimeOwnerSessionId,
      matches: input.page.items.slice(0, SessionHistoryModel.maxHistoryPageSize).map(hit => ({
        sequence: hit.seq,
        type: hit.type,
        time: hit.time,
        surface: hit.surface,
        snippet: hit.snippet.slice(0, SessionHistoryModel.maxHistorySnippetLength),
      })),
      next_cursor: cursorFitsLimit ? nextCursor : null,
      more_available: nextCursor !== undefined,
      pagination_unavailable: nextCursor !== undefined && !cursorFitsLimit,
    }
  }
}
