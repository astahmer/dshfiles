import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'
import { TailLog as LogTail, type LogWindowMetrics } from '@dshfiles/session-log-window'

/** The tail of one cold Session log, as the shared bounded window read serves it. */
export type TailLog = LogTail

/**
 * Open the end of a cold Session log through the shared bounded window read, recording what the window cost.
 * `undefined` sends the caller to the full read: another backend or encoding, a forked or subagent Session, a torn
 * last frame, or a log below the tail threshold.
 */
export const TailLog = {
  open: (input: {
    readonly ctx: Context
    readonly sessionId: SessionId
    readonly signal: AbortSignal
    /** The caller's bag, when it needs to know why the tail was refused (a Session with no stored log at all). */
    readonly metrics?: LogWindowMetrics
  }): Promise<TailLog | undefined> =>
    withSpan('session tail read', { attributes: { 'dsh.session.id': input.sessionId } }, async span => {
      const metrics: LogWindowMetrics = input.metrics ?? {}
      metrics.cache_hit = false
      let tail: TailLog | undefined
      try {
        tail = await LogTail.open({ ...input, metrics })
      } catch (error) {
        metrics.fallback_reason = input.signal.aborted ? 'aborted' : 'error'
        span.setAttributes(pluginAttributes({ plugin: 'session-controller', attributes: { served: false, ...metrics } }))
        throw error
      }
      span.setAttributes(
        pluginAttributes({
          plugin: 'session-controller',
          attributes: {
            served: tail !== undefined,
            bytes: tail?.windowBytes,
            frames: tail?.frameCount,
            windowed: tail?.windowed,
            ...metrics,
          },
        }),
      )
      return tail
    }),
}
