import { z } from 'zod'

/**
 * Another surface (a `@dshfiles/main-tabs` tab's context menu) asks for one thread's aside through this window event.
 * The request is cancelable: a handled dispatch comes back cancelled, so the caller knows no side panel took it.
 */
export const OPEN_THREAD_ASIDE_EVENT = 'dshfiles:open-thread-aside'

const requestSchema = z.object({ sessionId: z.string().min(1) }).strict()

/** The session a `dshfiles:open-thread-aside` request names, or undefined for any other event or shape. */
export const readThreadAsideRequest = (event: Event): string | undefined => {
  if (!(event instanceof CustomEvent)) return undefined
  const request = requestSchema.safeParse(event.detail)
  return request.success ? request.data.sessionId : undefined
}
