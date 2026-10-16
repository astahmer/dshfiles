import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { SessionSearchCursor, type SessionEventSearchPage } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it } from 'vitest'
import { SessionHistoryModel } from './session-history.js'

describe('Agent session history search', () => {
  it('validates bounded inputs and normalizes literal queries', () => {
    const parsed = SessionHistoryModel.searchInputSchema.parse({
      sessionId: 'child-session',
      query: '  visible result  ',
      limit: 10,
      cursor: 'opaque-cursor',
    })

    expect(parsed.query).toBe('visible result')
    expect(parsed.limit).toBe(10)
    expect(SessionHistoryModel.searchInputSchema.safeParse({ sessionId: 'child-session', query: ' ' }).success).toBe(false)
    expect(SessionHistoryModel.searchInputSchema.safeParse({ sessionId: 'child-session', query: 'x', limit: 11 }).success).toBe(false)
    expect(
      SessionHistoryModel.searchInputSchema.safeParse({
        sessionId: 'child-session',
        query: 'x',
        cursor: 'x'.repeat(4097),
      }).success,
    ).toBe(false)
  })

  it('searches only visible messages with a canonical continuation cursor', () => {
    const request = SessionHistoryModel.createSessionHistorySearchRequest({
      sessionId: SessionId('child-session'),
      query: 'visible result',
      limit: 3,
      cursor: 'opaque-cursor',
    })

    expect(request).toEqual({
      sessionId: 'child-session',
      query: 'visible result',
      filters: [{ kind: 'type', values: ['user/message', 'assistant/message'] }],
      limit: 3,
      cursor: SessionSearchCursor('opaque-cursor'),
    })

    const firstPage = SessionHistoryModel.createSessionHistorySearchRequest({
      sessionId: SessionId('child-session'),
      query: 'visible result',
      limit: 3,
      cursor: undefined,
    })
    expect(firstPage).not.toHaveProperty('cursor')
  })

  it('projects a bounded page without returning the Session header or cwd', () => {
    const sessionId = SessionId('child-session')
    const page: SessionEventSearchPage = {
      session: {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: 100,
        cwd: '/private/child-workspace',
        isSeeded: false,
      },
      items: [
        {
          sessionId,
          seq: SessionSeq(7),
          type: 'assistant/message',
          time: 200,
          surface: 'current',
          snippet: 'visible result '.repeat(40),
        },
      ],
      nextCursor: SessionSearchCursor('opaque-next-page'),
    }

    const projected = SessionHistoryModel.projectSessionHistoryPage({
      page,
      sessionId,
      runtimeOwnerSessionId: SessionId('parent-session'),
    })

    expect(projected).toEqual({
      status: 'results',
      session_id: 'child-session',
      runtime_owner_session_id: 'parent-session',
      matches: [
        {
          sequence: 7,
          type: 'assistant/message',
          time: 200,
          surface: 'current',
          snippet: 'visible result '.repeat(40).slice(0, 280),
        },
      ],
      next_cursor: 'opaque-next-page',
      more_available: true,
      pagination_unavailable: false,
    })
    expect(JSON.stringify(projected)).not.toContain('/private/child-workspace')
  })

  it('caps projected results at ten matches even if the service returns more', () => {
    const sessionId = SessionId('child-session')
    const page: SessionEventSearchPage = {
      session: {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: 100,
        cwd: '/private/child-workspace',
        isSeeded: false,
      },
      items: Array.from(
        { length: 11 },
        (_, index) =>
          ({
            sessionId,
            seq: SessionSeq(index),
            type: 'user/message',
            time: index,
            surface: 'current',
            snippet: `message ${index}`,
          }) satisfies SessionEventSearchPage['items'][number],
      ),
      nextCursor: SessionSearchCursor('next-page'),
    }

    const projected = SessionHistoryModel.projectSessionHistoryPage({
      page,
      sessionId,
      runtimeOwnerSessionId: SessionId('parent-session'),
    })

    expect(projected.matches).toHaveLength(10)
    expect(projected.matches[9]?.sequence).toBe(9)
  })

  it('does not return an oversized provider cursor', () => {
    const sessionId = SessionId('child-session')
    const page: SessionEventSearchPage = {
      session: {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: 100,
        cwd: '/private/child-workspace',
        isSeeded: false,
      },
      items: [],
      nextCursor: SessionSearchCursor('x'.repeat(4097)),
    }

    const projected = SessionHistoryModel.projectSessionHistoryPage({
      page,
      sessionId,
      runtimeOwnerSessionId: SessionId('parent-session'),
    })

    expect(projected.next_cursor).toBeNull()
    expect(projected.more_available).toBe(true)
    expect(projected.pagination_unavailable).toBe(true)
    expect(JSON.stringify(projected)).not.toContain('x'.repeat(4097))
  })

  it('does not return an empty provider cursor as a usable continuation', () => {
    const sessionId = SessionId('child-session')
    const page: SessionEventSearchPage = {
      session: {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: 100,
        cwd: '/private/child-workspace',
        isSeeded: false,
      },
      items: [],
      nextCursor: SessionSearchCursor(''),
    }

    const projected = SessionHistoryModel.projectSessionHistoryPage({
      page,
      sessionId,
      runtimeOwnerSessionId: SessionId('parent-session'),
    })

    expect(projected.next_cursor).toBeNull()
    expect(projected.more_available).toBe(true)
    expect(projected.pagination_unavailable).toBe(true)
  })
})
