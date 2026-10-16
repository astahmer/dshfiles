import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionSearchCursor, type SessionEventSearchPage, type SessionEventSearchRequest } from '@deepseek-ai/dsh-session-query'
import { z } from 'zod'

export class SessionHistoryModel {
  private static readonly maxHistoryCursorLength = 4096
  private static readonly maxHistoryPageSize = 10
  private static readonly maxHistorySnippetLength = 280
  private static readonly eventFilters: NonNullable<SessionEventSearchRequest['filters']> = [{ kind: 'type', values: ['user/message', 'assistant/message'] }]

  static readonly searchInputSchema = z
    .object({
      sessionId: z.string().min(1).max(256),
      query: z.string().trim().min(1).max(256),
      limit: z.number().int().min(1).max(10).optional(),
      cursor: z.string().min(1).max(SessionHistoryModel.maxHistoryCursorLength).optional(),
    })
    .strict()

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
