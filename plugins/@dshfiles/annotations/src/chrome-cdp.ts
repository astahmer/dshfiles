import { withSpan } from '@dshfiles/dshx/tracing'
import { z } from 'zod'
import { PICK_BINDING, PICK_SOURCE } from './picker-source.js'
import { annotationTargetSchema, type AnnotationTarget } from './schema.js'

export interface CdpPage {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly wsUrl: string
}

export interface PickedInPage {
  readonly ok: true
  readonly target: AnnotationTarget
  readonly point: { readonly x: number; readonly y: number }
}

export type PickOutcome = PickedInPage | { readonly ok: false; readonly reason: 'cancelled' | 'timeout' | 'unavailable' }

const cdpValueSchema = z.json()
type CdpValue = z.infer<typeof cdpValueSchema>
type CdpParams = Readonly<Record<string, CdpValue>>
const cdpParamsSchema = z.record(z.string(), cdpValueSchema)
const cdpMessageSchema = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  params: cdpValueSchema.optional(),
  result: cdpValueSchema.optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})
const pageEntrySchema = z.object({
  type: z.literal('page'),
  id: z.string(),
  webSocketDebuggerUrl: z.string(),
  url: z.string().catch(''),
  title: z.string().catch(''),
})
const evaluationSchema = z.object({ result: z.object({ value: cdpValueSchema.optional() }).optional() })

interface CdpCommand {
  id: number
  method: string
  params?: CdpParams
}

export interface Cdp {
  send(method: string, params?: CdpParams): Promise<CdpValue | undefined>
  on(method: string, handler: (params: CdpParams) => void): () => void
  close(): void
}

/** Node 22 ships a browser-shaped `WebSocket`, so CDP needs no dependency. */
const openCdp = ({ wsUrl, timeoutMs = 5_000 }: { readonly wsUrl: string; readonly timeoutMs?: number }): Promise<Cdp> =>
  withSpan(
    'annotations open cdp',
    { kind: 'client' },
    () =>
      new Promise<Cdp>((resolve, reject) => {
        const socket = new WebSocket(wsUrl)
        const pending = new Map<number, { resolve: (value: CdpValue | undefined) => void; reject: (error: Error) => void }>()
        const listeners = new Map<string, Set<(params: CdpParams) => void>>()
        let nextId = 1
        let settled = false

        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          socket.close()
          reject(new Error('cdp open timed out'))
        }, timeoutMs)

        const finish = (error?: Error): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error === undefined) resolve(api)
          else reject(error)
        }

        const api: Cdp = {
          send: (method, params) =>
            withSpan(
              'annotations send cdp command',
              { kind: 'client' },
              () =>
                new Promise((resolved, failed) => {
                  const id = nextId++
                  pending.set(id, { resolve: resolved, reject: failed })
                  const command: CdpCommand = { id, method }
                  if (params !== undefined) command.params = params
                  socket.send(JSON.stringify(command))
                }),
            ),
          on: (method, handler) => {
            const set = listeners.get(method) ?? new Set()
            set.add(handler)
            listeners.set(method, set)
            return () => {
              set.delete(handler)
            }
          },
          close: () => {
            socket.close()
          },
        }

        socket.onopen = () => finish()
        socket.onerror = () => finish(new Error('cdp websocket failed'))
        socket.onclose = () => {
          if (!settled) finish(new Error('cdp websocket closed'))
          for (const waiter of pending.values()) waiter.reject(new Error('cdp websocket closed'))
          pending.clear()
        }
        socket.onmessage = event => {
          let message: z.infer<typeof cdpMessageSchema>
          try {
            message = cdpMessageSchema.parse(JSON.parse(String(event.data)))
          } catch {
            return
          }
          if (message.id !== undefined) {
            const waiter = pending.get(message.id)
            if (waiter === undefined) return
            pending.delete(message.id)
            if (message.error !== undefined) waiter.reject(new Error(message.error.message ?? 'cdp command failed'))
            else waiter.resolve(message.result)
            return
          }
          if (message.method === undefined) return
          const set = listeners.get(message.method)
          if (set === undefined) return
          const params = cdpParamsSchema.safeParse(message.params)
          for (const handler of set) handler(params.success ? params.data : {})
        }
      }),
  )

const listPages = async ({ endpoint }: { readonly endpoint: string }): Promise<CdpPage[]> =>
  withSpan('annotations list chrome pages', { kind: 'client' }, async span => {
    const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2_000) }).catch(() => {
      span.setStatus('error', 'unavailable')
      return undefined
    })
    if (response === undefined) return []
    span.setAttribute('http.response.status_code', response.status)
    if (!response.ok) {
      span.setStatus('error', 'http-error')
      return []
    }
    const targets: unknown = await response.json().catch(() => {
      span.setStatus('error', 'invalid-response')
      return []
    })
    if (!Array.isArray(targets)) {
      span.setStatus('error', 'invalid-response')
      return []
    }
    const pages: CdpPage[] = []
    for (const entry of targets) {
      const parsed = pageEntrySchema.safeParse(entry)
      if (!parsed.success) continue
      const target = parsed.data
      if (!/^(https?|file):/i.test(target.url)) continue
      pages.push({
        id: target.id,
        title: target.title.length > 0 ? target.title : target.url,
        url: target.url,
        wsUrl: target.webSocketDebuggerUrl,
      })
    }
    span.setAttribute('dshx.annotations.pages', pages.length)
    return pages
  })

const endpointOf = ({ port }: { readonly port: number }): string => `http://127.0.0.1:${port}`

/**
 * `/json/list` has no "active" flag, so ask each tab whether it holds focus. A
 * browser window that is behind another app reports nothing focused, and then the
 * first page is the sensible default.
 */
const focusedPageId = async ({ pages }: { readonly pages: readonly CdpPage[] }): Promise<string | undefined> => {
  for (const page of pages.slice(0, 20)) {
    const focused = await (async () => {
      let cdp: Cdp
      try {
        cdp = await openCdp({ wsUrl: page.wsUrl, timeoutMs: 1_500 })
      } catch {
        return false
      }
      try {
        const result = evaluationSchema.safeParse(
          await cdp.send('Runtime.evaluate', {
            expression: 'document.hasFocus() && document.visibilityState === "visible"',
            returnByValue: true,
          }),
        )
        return result.success && result.data.result?.value === true
      } catch {
        return false
      } finally {
        cdp.close()
      }
    })()
    if (focused) return page.id
  }
  return undefined
}

const choosePage = ({ pages, focusedId }: { readonly pages: readonly CdpPage[]; readonly focusedId?: string }): CdpPage | undefined => {
  if (focusedId !== undefined) {
    const focused = pages.find(page => page.id === focusedId)
    if (focused !== undefined) return focused
  }
  return pages[0]
}

const pickEnvelopeSchema = z.object({ ok: cdpValueSchema.optional() }).passthrough()
const pickedSchema = z.object({
  target: annotationTargetSchema,
  point: z.object({ x: z.number().catch(0), y: z.number().catch(0) }),
})
const parsePick = (payload: CdpValue | undefined): PickOutcome => {
  const text = z.string().safeParse(payload)
  if (!text.success) return { ok: false, reason: 'unavailable' }
  let envelope: z.infer<typeof pickEnvelopeSchema>
  try {
    envelope = pickEnvelopeSchema.parse(JSON.parse(text.data))
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (envelope.ok !== true) return { ok: false, reason: 'cancelled' }
  const picked = pickedSchema.safeParse(envelope)
  return picked.success ? { ok: true, target: picked.data.target, point: picked.data.point } : { ok: false, reason: 'unavailable' }
}

/**
 * Arms the injected picker on one page and waits for the binding call. The page owns
 * the interaction, so this resolves only when the user clicks or cancels.
 */
const pickOnPage = async ({ page, timeoutMs }: { readonly page: CdpPage; readonly timeoutMs: number }): Promise<PickOutcome> => {
  let cdp: Cdp
  try {
    cdp = await openCdp({ wsUrl: page.wsUrl })
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  try {
    await cdp.send('Runtime.enable').catch(() => undefined)
    await cdp.send('Runtime.addBinding', { name: PICK_BINDING })
    const script = PICK_SOURCE.replace('__DSH_BINDING__', PICK_BINDING)
    return await new Promise<PickOutcome>(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs)
      const stop = cdp.on('Runtime.bindingCalled', params => {
        if (params.name !== PICK_BINDING) return
        clearTimeout(timer)
        stop()
        resolve(parsePick(params.payload))
      })
      void cdp.send('Runtime.evaluate', { expression: script, awaitPromise: false }).catch(() => {
        clearTimeout(timer)
        stop()
        resolve({ ok: false, reason: 'unavailable' })
      })
    })
  } catch {
    return { ok: false, reason: 'unavailable' }
  } finally {
    cdp.close()
  }
}

const dispatchClick = async ({ cdp, x, y }: { readonly cdp: Cdp; readonly x: number; readonly y: number }): Promise<void> => {
  const base = { x, y, button: 'left', clickCount: 1 }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
}

export class ChromeCdp {
  static readonly openCdp = openCdp
  static readonly listPages = listPages
  static readonly endpointOf = endpointOf
  static readonly focusedPageId = focusedPageId
  static readonly choosePage = choosePage
  static readonly pickOnPage = pickOnPage
  static readonly dispatchClick = dispatchClick
}
