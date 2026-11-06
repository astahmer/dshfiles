import { ApiBatchProtocol } from './batch-protocol.js'
import { ApiChannelModel } from './channel.js'
import { decodeJson } from '../json.js'

type BatchLine = (typeof ApiBatchProtocol.line)['Type']
export type BatchRpcResult = Extract<BatchLine, { readonly result: unknown }>['result']

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** One read call: `send` is today's per-channel call, used when the batch cannot carry it. */
export interface BatchCall {
  readonly endpoint: string
  readonly payload: unknown
  readonly signal: AbortSignal | undefined
  readonly send: (signal: AbortSignal | undefined) => Promise<BatchRpcResult>
}

export interface ApiBatcher {
  readonly call: (call: BatchCall) => Promise<BatchRpcResult>
}

interface BatcherOptions {
  readonly fetch: FetchLike
  readonly windowMs?: number
  readonly maxSize?: number
}

interface Entry {
  readonly id: number
  readonly call: BatchCall
  readonly resolve: (result: BatchRpcResult) => void
  readonly reject: (cause: unknown) => void
  settled: boolean
  sentAlone: boolean
  detach: () => void
}

const BATCH_WINDOW_MS = 8
const BATCH_MAX_SIZE = 32
/** Answers that mean this Host has no batch route: the page stops trying it. */
const UNSUPPORTED = new Set([404, 405, 501])

/**
 * Collect the read calls issued within `windowMs` (or until `maxSize`) into one POST to the leader's batch route and
 * settle each from its own NDJSON line as the Host writes it. A call aborted before the flush leaves the batch; once
 * sent, it stops waiting and the POST is cancelled when no call is left waiting on it. A Host without the route makes
 * every later call take its own per-channel route; a call the stream left unanswered is sent there once.
 */
const createApiBatcher = (options: BatcherOptions): ApiBatcher => {
  const windowMs = options.windowMs ?? BATCH_WINDOW_MS
  const maxSize = Math.min(options.maxSize ?? BATCH_MAX_SIZE, ApiBatchProtocol.maxEntries)
  let supported = true
  let nextId = 0
  const queue: Entry[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const settle = (entry: Entry, outcome: { readonly result: BatchRpcResult } | { readonly cause: unknown }): void => {
    if (entry.settled) return
    entry.settled = true
    entry.detach()
    if ('result' in outcome) entry.resolve(outcome.result)
    else entry.reject(outcome.cause)
  }

  const sendAlone = (entry: Entry): void => {
    if (entry.settled || entry.sentAlone) return
    entry.sentAlone = true
    entry.call.send(entry.call.signal).then(
      result => settle(entry, { result }),
      cause => settle(entry, { cause }),
    )
  }

  const answer = (entry: Entry, line: BatchLine): void => {
    if ('result' in line) return settle(entry, { result: line.result })
    // The per-channel route answers an unregistered owner with HTTP 404; keep that error shape for the caller.
    if (line.status === 404) return settle(entry, { cause: new Error(`transport failure for /api/${entry.call.endpoint}: HTTP 404`) })
    sendAlone(entry)
  }

  const readLines = async (response: Response, onLine: (line: BatchLine) => void): Promise<void> => {
    const reader = response.body?.getReader()
    if (reader === undefined) return
    const decoder = new TextDecoder()
    let buffered = ''
    const consume = (text: string): void => {
      if (text.trim() === '') return
      let line: BatchLine
      try {
        line = decodeJson(ApiBatchProtocol.line, text)
      } catch {
        // An unreadable line leaves its call unanswered; it goes on its own route when the stream ends.
        return
      }
      onLine(line)
    }
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffered += decoder.decode(chunk.value, { stream: true })
      for (let boundary = buffered.indexOf('\n'); boundary !== -1; boundary = buffered.indexOf('\n')) {
        consume(buffered.slice(0, boundary))
        buffered = buffered.slice(boundary + 1)
      }
    }
    consume(buffered + decoder.decode())
  }

  const send = async (entries: readonly Entry[]): Promise<void> => {
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const controller = new AbortController()
    for (const entry of entries) {
      const leave = (): void => {
        settle(entry, { cause: entry.call.signal?.reason })
        if (entries.every(other => other.settled)) controller.abort()
      }
      entry.detach()
      if (entry.call.signal === undefined) continue
      entry.call.signal.addEventListener('abort', leave, { once: true })
      entry.detach = () => entry.call.signal?.removeEventListener('abort', leave)
    }
    try {
      const response = await options.fetch(ApiChannelModel.batchPath.slice(1), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: entries.map(entry => ({ id: entry.id, endpoint: entry.call.endpoint, payload: entry.call.payload })) }),
        signal: controller.signal,
      })
      const streamed = response.ok && response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === ApiBatchProtocol.contentType
      if (!streamed) {
        // A 200 that is not the batch stream is a Host that does not know the route either.
        if (response.ok || UNSUPPORTED.has(response.status)) supported = false
        await response.body?.cancel().catch(() => undefined)
      } else {
        await readLines(response, line => {
          const entry = byId.get(line.id)
          if (entry !== undefined && !entry.settled) answer(entry, line)
        })
      }
    } catch {
      // A failed or cut stream falls through: whatever it left unanswered goes on its own route below.
    }
    for (const entry of entries) sendAlone(entry)
  }

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    const entries = queue.splice(0)
    if (entries.length > 0) void send(entries)
  }

  const call = (batchCall: BatchCall): Promise<BatchRpcResult> => {
    if (!supported) return batchCall.send(batchCall.signal)
    return new Promise<BatchRpcResult>((resolve, reject) => {
      const entry: Entry = { id: nextId++, call: batchCall, resolve, reject, settled: false, sentAlone: false, detach: () => undefined }
      if (batchCall.signal?.aborted === true) return reject(batchCall.signal.reason)
      const leaveQueue = (): void => {
        const index = queue.indexOf(entry)
        if (index !== -1) queue.splice(index, 1)
        settle(entry, { cause: batchCall.signal?.reason })
      }
      batchCall.signal?.addEventListener('abort', leaveQueue, { once: true })
      entry.detach = () => batchCall.signal?.removeEventListener('abort', leaveQueue)
      queue.push(entry)
      if (queue.length >= maxSize) flush()
      else timer ??= setTimeout(flush, windowMs)
    })
  }

  return { call }
}

const BATCHER_KEY = Symbol.for('@dshfiles/dshx.api-batch.v1')
/** `localStorage['dshx:batch'] = 'off'` keeps this page on per-call requests, e.g. to compare request counts. */
const OPT_OUT_KEY = 'dshx:batch'

const optedOut = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(OPT_OUT_KEY) === 'off'
  } catch {
    return false
  }
}

/**
 * The page's one batcher, shared by every bundle's dshx copy; undefined outside a browser page (Host, tests, workers),
 * where every call keeps its own route.
 */
const pageBatcher = (): ApiBatcher | undefined => {
  // SAFETY: only this module writes the versioned symbol, and always an ApiBatcher or null.
  const holder = globalThis as { [BATCHER_KEY]?: ApiBatcher | null }
  const existing = holder[BATCHER_KEY]
  if (existing !== undefined) return existing ?? undefined
  const pageFetch = globalThis.fetch
  const onPage = typeof globalThis.document === 'object' && typeof pageFetch === 'function' && !optedOut()
  holder[BATCHER_KEY] = onPage ? createApiBatcher({ fetch: (input, init) => pageFetch(input, init) }) : null
  return holder[BATCHER_KEY] ?? undefined
}

export class ApiBatchModel {
  static readonly create = createApiBatcher
  static readonly page = pageBatcher
}
