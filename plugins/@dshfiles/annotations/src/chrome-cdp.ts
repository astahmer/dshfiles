import { Duration, Effect, Option, Queue, Schema, type Scope } from 'effect'
import { HttpClient } from 'effect/http'
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

/** The DevTools socket could not be opened, closed early, or a command failed. */
export class CdpUnavailable extends Schema.TaggedError<CdpUnavailable>()('CdpUnavailable', {
  stage: Schema.Literals(['open', 'command']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.stage === 'open' ? 'The browser DevTools socket could not be opened.' : 'A DevTools command failed.'
  }
}

type CdpParams = Readonly<Record<string, unknown>>

/** One open DevTools connection, closed with its Scope. */
export interface Cdp {
  readonly send: (method: string, params?: CdpParams) => Effect.Effect<unknown, CdpUnavailable>
  /** Every event of `method` from now until the Scope closes. */
  readonly subscribe: (method: string) => Effect.Effect<Queue.Dequeue<CdpParams>, never, Scope.Scope>
}

const CdpMessage = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(Schema.Number),
    method: Schema.optional(Schema.String),
    params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    result: Schema.optional(Schema.Unknown),
    error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
  }),
)
const decodeMessage = Schema.decodeUnknownOption(CdpMessage)

const PickEnvelope = Schema.fromJsonString(
  Schema.Struct({
    ok: Schema.optional(Schema.Unknown),
    target: Schema.optional(Schema.Unknown),
    point: Schema.optional(Schema.Struct({ x: Schema.optional(Schema.Unknown), y: Schema.optional(Schema.Unknown) })),
  }),
)
const decodePickEnvelope = Schema.decodeUnknownOption(PickEnvelope)
const decodeTarget = Schema.decodeUnknownOption(annotationTargetSchema)

const unavailable: PickOutcome = { ok: false, reason: 'unavailable' }

const coordinate = (value: unknown): number => (typeof value === 'number' ? value : 0)

const parsePick = (payload: unknown): PickOutcome => {
  const envelope = decodePickEnvelope(payload)
  if (Option.isNone(envelope)) return unavailable
  if (envelope.value.ok !== true) return { ok: false, reason: 'cancelled' }
  const target = decodeTarget(envelope.value.target)
  const point = envelope.value.point
  if (Option.isNone(target) || point === undefined) return unavailable
  return { ok: true, target: target.value, point: { x: coordinate(point.x), y: coordinate(point.y) } }
}

const PageList = Schema.Array(
  Schema.Struct({
    id: Schema.optional(Schema.Unknown),
    type: Schema.optional(Schema.Unknown),
    url: Schema.optional(Schema.Unknown),
    title: Schema.optional(Schema.Unknown),
    webSocketDebuggerUrl: Schema.optional(Schema.Unknown),
  }),
)
const decodePageList = Schema.decodeUnknownOption(PageList)

const FocusResult = Schema.Struct({ result: Schema.optional(Schema.Struct({ value: Schema.optional(Schema.Unknown) })) })
const decodeFocusResult = Schema.decodeUnknownOption(FocusResult)

export const endpointOf = (input: { readonly port: number }): string => `http://127.0.0.1:${input.port}`

/** Node 22 ships a browser-shaped `WebSocket`, so CDP needs no dependency. */
export const openCdp = Effect.fn('annotations open cdp')(function* (input: { readonly wsUrl: string; readonly timeout?: Duration.Input }) {
  const pending = new Map<number, (outcome: Effect.Effect<unknown, CdpUnavailable>) => void>()
  const listeners = new Map<string, Set<(params: CdpParams) => void>>()
  let nextId = 1
  const socket = yield* Effect.acquireRelease(
    Effect.callback<WebSocket, CdpUnavailable>(resume => {
      const opening = new WebSocket(input.wsUrl)
      opening.onopen = () => resume(Effect.succeed(opening))
      opening.onerror = () => resume(Effect.fail(new CdpUnavailable({ stage: 'open' })))
      opening.onclose = () => {
        resume(Effect.fail(new CdpUnavailable({ stage: 'open' })))
        for (const settle of pending.values()) settle(Effect.fail(new CdpUnavailable({ stage: 'command' })))
        pending.clear()
      }
      opening.onmessage = event => {
        const message = decodeMessage(String(event.data))
        if (Option.isNone(message)) return
        const id = message.value.id
        if (id !== undefined) {
          const settle = pending.get(id)
          pending.delete(id)
          settle?.(message.value.error === undefined ? Effect.succeed(message.value.result) : Effect.fail(new CdpUnavailable({ stage: 'command' })))
          return
        }
        const method = message.value.method
        if (method === undefined) return
        for (const handler of listeners.get(method) ?? []) handler(message.value.params ?? {})
      }
      return Effect.sync(() => opening.close())
    }).pipe(Effect.timeoutOrElse({ duration: input.timeout ?? Duration.seconds(5), orElse: () => Effect.fail(new CdpUnavailable({ stage: 'open' })) })),
    opened => Effect.sync(() => opened.close()),
  )

  const cdp: Cdp = {
    send: (method, params) =>
      Effect.callback<unknown, CdpUnavailable>(resume => {
        const id = nextId
        nextId += 1
        pending.set(id, resume)
        socket.send(JSON.stringify({ id, method, ...(params !== undefined && { params }) }))
        return Effect.sync(() => pending.delete(id))
      }),
    subscribe: method =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<CdpParams>()
        const handler = (params: CdpParams): void => {
          Queue.offerUnsafe(queue, params)
        }
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const handlers = listeners.get(method) ?? new Set()
            handlers.add(handler)
            listeners.set(method, handlers)
          }),
          () =>
            Effect.sync(() => {
              listeners.get(method)?.delete(handler)
            }),
        )
        return queue
      }),
  }
  return cdp
})

/** The http(s) and file pages of the browser at `endpoint`; an unreachable browser has none. */
export const listPages = Effect.fn('annotations list cdp pages')(function* (input: { readonly endpoint: string }) {
  const client = yield* HttpClient.HttpClient
  const targets = yield* client.get(`${input.endpoint}/json/list`).pipe(
    Effect.flatMap(response => (response.status >= 200 && response.status < 300 ? response.json : Effect.succeed([]))),
    Effect.timeoutOption(Duration.seconds(2)),
    Effect.map(Option.flatMap(decodePageList)),
    Effect.orElseSucceed(() => Option.none<typeof PageList.Type>()),
  )
  return Option.getOrElse(targets, () => []).flatMap((target): CdpPage[] => {
    const url = typeof target.url === 'string' ? target.url : ''
    if (target.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string' || typeof target.id !== 'string') return []
    if (!/^(https?|file):/i.test(url)) return []
    return [{ id: target.id, title: typeof target.title === 'string' && target.title.length > 0 ? target.title : url, url, wsUrl: target.webSocketDebuggerUrl }]
  })
})

/**
 * `/json/list` has no "active" flag, so ask each tab whether it holds focus. A
 * browser window that is behind another app reports nothing focused, and then the
 * first page is the sensible default.
 */
export const focusedPageId = Effect.fn('annotations find focused page')(function* (input: { readonly pages: readonly CdpPage[] }) {
  for (const page of input.pages.slice(0, 20)) {
    const focused = yield* Effect.scoped(
      Effect.gen(function* () {
        const cdp = yield* openCdp({ wsUrl: page.wsUrl, timeout: Duration.millis(1_500) })
        const result = yield* cdp.send('Runtime.evaluate', { expression: 'document.hasFocus() && document.visibilityState === "visible"', returnByValue: true })
        return Option.exists(decodeFocusResult(result), decoded => decoded.result?.value === true)
      }),
    ).pipe(Effect.orElseSucceed(() => false))
    if (focused) return Option.some(page.id)
  }
  return Option.none<string>()
})

export const choosePage = (input: { readonly pages: readonly CdpPage[]; readonly focusedId?: string | undefined }): CdpPage | undefined => {
  if (input.focusedId !== undefined) {
    const focused = input.pages.find(page => page.id === input.focusedId)
    if (focused !== undefined) return focused
  }
  return input.pages[0]
}

/**
 * Arms the injected picker on one page and waits for the binding call. The page owns
 * the interaction, so this resolves only when the user clicks or cancels.
 */
export const pickOnPage = Effect.fn('annotations pick on page')(function* (input: { readonly page: CdpPage; readonly timeout: Duration.Input }) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const cdp = yield* openCdp({ wsUrl: input.page.wsUrl })
      yield* cdp.send('Runtime.enable').pipe(Effect.ignore)
      yield* cdp.send('Runtime.addBinding', { name: PICK_BINDING })
      const calls = yield* cdp.subscribe('Runtime.bindingCalled')
      const picked = Effect.gen(function* () {
        while (true) {
          const params = yield* Queue.take(calls)
          if (params.name === PICK_BINDING) return parsePick(params.payload)
        }
      })
      const armed = cdp.send('Runtime.evaluate', { expression: PICK_SOURCE.replace('__DSH_BINDING__', PICK_BINDING), awaitPromise: false }).pipe(
        Effect.andThen(Effect.never),
        Effect.orElseSucceed(() => unavailable),
      )
      const outcome = yield* Effect.raceFirst(picked, armed).pipe(Effect.timeoutOption(input.timeout))
      return Option.getOrElse(outcome, (): PickOutcome => ({ ok: false, reason: 'timeout' }))
    }),
  ).pipe(Effect.orElseSucceed(() => unavailable))
})

export const dispatchClick = Effect.fn('annotations dispatch click')(function* (input: { readonly cdp: Cdp; readonly x: number; readonly y: number }) {
  const base = { x: input.x, y: input.y, button: 'left', clickCount: 1 }
  yield* input.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base })
  yield* input.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  yield* input.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
})
