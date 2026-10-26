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

interface CdpMessage {
  readonly id?: number
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly message?: string }
}

export interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  on(method: string, handler: (params: Record<string, unknown>) => void): () => void
  close(): void
}

/** Node 22 ships a browser-shaped `WebSocket`, so CDP needs no dependency. */
export const openCdp = ({ wsUrl, timeoutMs = 5_000 }: { readonly wsUrl: string; readonly timeoutMs?: number }): Promise<Cdp> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    const listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>()
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
        new Promise((resolved, failed) => {
          const id = nextId++
          pending.set(id, { resolve: resolved, reject: failed })
          socket.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }))
        }),
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
      let message: CdpMessage
      try {
        message = JSON.parse(String(event.data)) as CdpMessage
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
      const params = typeof message.params === 'object' && message.params !== null ? (message.params as Record<string, unknown>) : {}
      for (const handler of set) handler(params)
    }
  })

export const listPages = async ({ endpoint }: { readonly endpoint: string }): Promise<CdpPage[]> => {
  const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2_000) }).catch(() => undefined)
  if (response === undefined || !response.ok) return []
  const targets = (await response.json().catch(() => [])) as unknown
  if (!Array.isArray(targets)) return []
  const pages: CdpPage[] = []
  for (const entry of targets) {
    if (typeof entry !== 'object' || entry === null) continue
    const target = entry as Record<string, unknown>
    const wsUrl = target.webSocketDebuggerUrl
    if (target.type !== 'page' || typeof wsUrl !== 'string' || typeof target.id !== 'string') continue
    const url = typeof target.url === 'string' ? target.url : ''
    if (!/^(https?|file):/i.test(url)) continue
    pages.push({
      id: target.id,
      title: typeof target.title === 'string' && target.title.length > 0 ? target.title : url,
      url,
      wsUrl,
    })
  }
  return pages
}

export const endpointOf = ({ port }: { readonly port: number }): string => `http://127.0.0.1:${port}`

/**
 * `/json/list` has no "active" flag, so ask each tab whether it holds focus. A
 * browser window that is behind another app reports nothing focused, and then the
 * first page is the sensible default.
 */
export const focusedPageId = async ({ pages }: { readonly pages: readonly CdpPage[] }): Promise<string | undefined> => {
  for (const page of pages.slice(0, 20)) {
    const focused = await (async () => {
      let cdp: Cdp
      try {
        cdp = await openCdp({ wsUrl: page.wsUrl, timeoutMs: 1_500 })
      } catch {
        return false
      }
      try {
        const result = (await cdp.send('Runtime.evaluate', {
          expression: 'document.hasFocus() && document.visibilityState === "visible"',
          returnByValue: true,
        })) as { readonly result?: { readonly value?: unknown } }
        return result.result?.value === true
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

export const choosePage = ({ pages, focusedId }: { readonly pages: readonly CdpPage[]; readonly focusedId?: string }): CdpPage | undefined => {
  if (focusedId !== undefined) {
    const focused = pages.find(page => page.id === focusedId)
    if (focused !== undefined) return focused
  }
  return pages[0]
}

const parsePick = (payload: unknown): PickOutcome => {
  if (typeof payload !== 'string') return { ok: false, reason: 'unavailable' }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'unavailable' }
  const envelope = parsed as Record<string, unknown>
  if (envelope.ok !== true) return { ok: false, reason: 'cancelled' }
  const target = annotationTargetSchema.safeParse(envelope.target)
  const point = envelope.point
  if (!target.success || typeof point !== 'object' || point === null) return { ok: false, reason: 'unavailable' }
  const coordinates = point as Record<string, unknown>
  const x = typeof coordinates.x === 'number' ? coordinates.x : 0
  const y = typeof coordinates.y === 'number' ? coordinates.y : 0
  return { ok: true, target: target.data, point: { x, y } }
}

/**
 * Arms the injected picker on one page and waits for the binding call. The page owns
 * the interaction, so this resolves only when the user clicks or cancels.
 */
export const pickOnPage = async ({ page, timeoutMs }: { readonly page: CdpPage; readonly timeoutMs: number }): Promise<PickOutcome> => {
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

export const dispatchClick = async ({ cdp, x, y }: { readonly cdp: Cdp; readonly x: number; readonly y: number }): Promise<void> => {
  const base = { x, y, button: 'left', clickCount: 1 }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
}
