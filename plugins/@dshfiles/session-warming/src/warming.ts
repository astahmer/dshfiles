import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { withSpan } from '@dshfiles/dshx/tracing'
import { z } from 'zod'

export interface WarmingSettings {
  readonly enabled: boolean
  readonly intervalMinutes: number
  readonly maxWarmupsPerIdle: number
  readonly maxWarmupsPerHour: number
  readonly providers: readonly string[]
}

export interface WarmResult {
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
}

const sessionStatusSchema = z
  .object({
    sessionId: z.string(),
    provider: z.string(),
    model: z.string(),
    warmups: z.number().int().nonnegative(),
    nextAt: z.number().int().nullable(),
    lastWarmedAt: z.number().int().nullable(),
    last: z.object({ inputTokens: z.number(), cacheReadTokens: z.number(), cacheWriteTokens: z.number(), outputTokens: z.number() }).strict().nullable(),
    stopped: z.enum(['idle-limit', 'hourly-limit', 'failed', 'disabled']).nullable(),
    error: z.string().nullable(),
  })
  .strict()

export type WarmingSessionStatus = z.infer<typeof sessionStatusSchema>

const HOUR_MS = 60 * 60_000

interface Tracked<Request> {
  /** Dropped once warming stops, so an idle thread's whole conversation is not held for a timer that will not fire. */
  request: Request | null
  readonly provider: string
  readonly model: string
  warmups: number
  timer: ReturnType<typeof setTimeout> | undefined
  nextAt: number | null
  lastWarmedAt: number | null
  last: WarmResult | null
  stopped: WarmingSessionStatus['stopped']
  error: string | null
}

/**
 * Per-thread warm-up timers. A thread's last loop request is re-sent `intervalMinutes` after its turn ended, then
 * again on the same interval, until it used `maxWarmupsPerIdle`, the rolling hourly budget across threads is spent,
 * a warm-up fails, or a new turn starts (which resets its count).
 */
export class SessionWarming {
  static readonly sessionStatusSchema = sessionStatusSchema

  /** One billed request: the thread's exact last prefix with a single output token, so the provider refreshes its cache. */
  static warm(llm: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> }, request: GenerateOptions): Promise<WarmResult> {
    return withSpan(
      'session-warming warm',
      { kind: 'client', attributes: { 'gen_ai.provider.name': request.provider, 'gen_ai.request.model': request.model } },
      async span => {
        let result: WarmResult = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
        for await (const chunk of llm.stream({ ...request, maxTokens: 1, signal: AbortSignal.timeout(60_000) })) {
          if (chunk.type !== 'usage') continue
          result = {
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens,
            cacheReadTokens: chunk.usage.cacheReadTokens ?? 0,
            cacheWriteTokens: chunk.usage.cacheWriteTokens ?? 0,
          }
        }
        span.setAttributes({ 'gen_ai.usage.input_tokens': result.inputTokens, 'session_warming.cache_read_tokens': result.cacheReadTokens })
        return result
      },
    )
  }

  static scheduler<Request extends { readonly provider: string; readonly model: string }>(input: {
    readonly settings: () => WarmingSettings
    readonly warm: (request: Request, sessionId: string) => Promise<WarmResult>
    readonly now?: () => number
  }) {
    const now = input.now ?? Date.now
    const sessions = new Map<string, Tracked<Request>>()
    const recent: number[] = []

    const stop = (tracked: Tracked<Request>, reason: NonNullable<WarmingSessionStatus['stopped']>): void => {
      tracked.stopped = reason
      tracked.request = null
    }

    const clear = (tracked: Tracked<Request>): void => {
      if (tracked.timer !== undefined) clearTimeout(tracked.timer)
      tracked.timer = undefined
      tracked.nextAt = null
    }

    const schedule = (sessionId: string, tracked: Tracked<Request>): void => {
      clear(tracked)
      if (tracked.request === null) return
      const settings = input.settings()
      if (!settings.enabled || (settings.providers.length > 0 && !settings.providers.includes(tracked.provider))) {
        stop(tracked, 'disabled')
        return
      }
      if (tracked.warmups >= settings.maxWarmupsPerIdle) {
        stop(tracked, 'idle-limit')
        return
      }
      const delay = settings.intervalMinutes * 60_000
      tracked.nextAt = now() + delay
      tracked.timer = setTimeout(() => void fire(sessionId, tracked), delay)
    }

    const fire = async (sessionId: string, tracked: Tracked<Request>): Promise<void> => {
      tracked.timer = undefined
      tracked.nextAt = null
      if (sessions.get(sessionId) !== tracked) return
      const settings = input.settings()
      if (!settings.enabled) {
        stop(tracked, 'disabled')
        return
      }
      while (recent.length > 0 && (recent[0] ?? 0) <= now() - HOUR_MS) recent.shift()
      if (recent.length >= settings.maxWarmupsPerHour) {
        stop(tracked, 'hourly-limit')
        return
      }
      recent.push(now())
      const request = tracked.request
      if (request === null) return
      tracked.warmups += 1
      try {
        tracked.last = await input.warm(request, sessionId)
        tracked.lastWarmedAt = now()
        tracked.error = null
      } catch (error) {
        stop(tracked, 'failed')
        tracked.error = error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)
        return
      }
      if (sessions.get(sessionId) === tracked && tracked.timer === undefined) schedule(sessionId, tracked)
    }

    return {
      /** The latest loop request of a thread: the exact prefix a warm-up re-sends. */
      recordRequest: (sessionId: string, request: Request): void => {
        const tracked = sessions.get(sessionId)
        if (tracked !== undefined && tracked.provider === request.provider && tracked.model === request.model) {
          tracked.request = request
          tracked.stopped = null
          return
        }
        if (tracked !== undefined) clear(tracked)
        sessions.set(sessionId, {
          request,
          provider: request.provider,
          model: request.model,
          warmups: 0,
          timer: undefined,
          nextAt: null,
          lastWarmedAt: null,
          last: null,
          stopped: null,
          error: null,
        })
      },
      turnStarted: (sessionId: string): void => {
        const tracked = sessions.get(sessionId)
        if (tracked === undefined) return
        clear(tracked)
        tracked.warmups = 0
        tracked.stopped = null
        tracked.error = null
      },
      turnEnded: (sessionId: string): void => {
        const tracked = sessions.get(sessionId)
        if (tracked !== undefined) schedule(sessionId, tracked)
      },
      forget: (sessionId: string): void => {
        const tracked = sessions.get(sessionId)
        if (tracked !== undefined) clear(tracked)
        sessions.delete(sessionId)
      },
      dispose: (): void => {
        for (const tracked of sessions.values()) clear(tracked)
        sessions.clear()
      },
      status: (): { readonly sessions: WarmingSessionStatus[]; readonly warmupsLastHour: number } => ({
        sessions: [...sessions.entries()].map(([sessionId, tracked]) => ({
          sessionId,
          provider: tracked.provider,
          model: tracked.model,
          warmups: tracked.warmups,
          nextAt: tracked.nextAt,
          lastWarmedAt: tracked.lastWarmedAt,
          last: tracked.last,
          stopped: tracked.stopped,
          error: tracked.error,
        })),
        warmupsLastHour: recent.filter(at => at > now() - HOUR_MS).length,
      }),
    }
  }
}
