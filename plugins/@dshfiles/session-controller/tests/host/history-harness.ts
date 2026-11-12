import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { HistoryController } from '../../src/native/history/controller.ts'
import { WebController } from '../../src/native/web/controller.ts'
import type { SessionEventsPage, SessionFollowFrame, SessionFollowRequest, SessionPageRequest } from '../../src/native/types.ts'

/** The Session Controller's history Remote surface (`page`, `follow`) over the controllers it delegates to. */
export const historyHarness = (ctx: Context, promote: (observation: SessionObservation) => void): {
  readonly page: (request: SessionPageRequest, signal: AbortSignal) => Promise<SessionEventsPage>
  readonly follow: (request: SessionFollowRequest, signal: AbortSignal) => AsyncIterable<SessionFollowFrame>
  readonly isFollowed: (sessionId: SessionId) => boolean
} => {
  const history = new HistoryController(ctx)
  const web = new WebController(ctx, history, promote)
  return {
    page: (request, signal) => history.events(request, signal),
    follow: (request, signal) => web.follow(request, signal),
    isFollowed: sessionId => web.isFollowed(sessionId),
  }
}
