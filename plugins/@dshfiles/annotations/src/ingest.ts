import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { INGEST_RATE_LIMIT, INGEST_RATE_WINDOW_MS, MAX_INGEST_BYTES } from './limits.js'
import { annotationDraftSchema, type AnnotationDraft, type UnassignedAnnotation } from './schema.js'
import { ExtensionHttp } from './http.js'

const ingestBodySchema = z
  .object({
    drafts: z.array(annotationDraftSchema).min(1).max(8),
  })
  .strict()

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-z]{32}$/

const bearerOf = (request: IncomingMessage): string | undefined => {
  const header = request.headers.authorization
  if (header === undefined) return undefined
  const match = /^Bearer (.+)$/.exec(header)
  return match?.[1]
}

const tokenMatches = ({ provided, expected }: { readonly provided: string | undefined; readonly expected: string }): boolean => {
  if (provided === undefined) return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

const readBody = async ({ request, limit }: { readonly request: IncomingMessage; readonly limit: number }): Promise<string | undefined> => {
  const declared = Number.parseInt(request.headers['content-length'] ?? '', 10)
  if (!Number.isNaN(declared) && declared > limit) return undefined
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > limit) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export interface IngestHandlerOptions {
  readonly token: () => Promise<string>
  readonly allowedOrigins: () => readonly string[]
  readonly ingest: (input: { readonly drafts: readonly AnnotationDraft[]; readonly extensionOrigin: string }) => Promise<UnassignedAnnotation[]>
  readonly now?: () => number
}

export const createIngestHandler =
  ({ token, allowedOrigins, ingest, now = Date.now }: IngestHandlerOptions) =>
  async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const remote = request.socket.remoteAddress ?? ''
    if (!LOOPBACK.has(remote)) {
      ExtensionHttp.respond({ response, status: 403, body: { error: 'loopback only' } })
      return
    }
    const allowed = allowedOrigins()
    if (ExtensionHttp.answerPreflight({ request, response, allowed })) return
    if (request.method !== 'POST') {
      ExtensionHttp.respond({ response, status: 405, body: { error: 'method not allowed' } })
      return
    }
    if (!tokenMatches({ provided: bearerOf(request), expected: await token() })) {
      ExtensionHttp.respond({ response, status: 401, body: { error: 'invalid token' } })
      return
    }
    const origin = request.headers.origin
    if (origin === undefined || !EXTENSION_ORIGIN.test(origin)) {
      ExtensionHttp.respond({ response, status: 403, body: { error: 'browser extension origin required' } })
      return
    }
    if (allowed.length > 0 && !allowed.includes(origin)) {
      ExtensionHttp.respond({ response, status: 403, body: { error: 'origin not allowed' } })
      return
    }
    const rate = rateFor(origin, now())
    if (rate === false) {
      ExtensionHttp.respond({ response, status: 429, body: { error: 'too many requests' } })
      return
    }
    const raw = await readBody({ request, limit: MAX_INGEST_BYTES })
    if (raw === undefined) {
      ExtensionHttp.respond({ response, status: 413, body: { error: 'payload too large' } })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      ExtensionHttp.respond({ response, status: 400, body: { error: 'invalid json' } })
      return
    }
    const body = ingestBodySchema.safeParse(parsed)
    if (!body.success) {
      ExtensionHttp.respond({ response, status: 400, body: { error: 'invalid annotation' } })
      return
    }
    const accepted = await ingest({ drafts: body.data.drafts, extensionOrigin: origin })
    ExtensionHttp.respond({ response, status: 202, body: { accepted: accepted.length }, headers: ExtensionHttp.corsFor({ origin, allowed }) })
  }

const windows = new Map<string, { readonly start: number; count: number }>()

const rateFor = (origin: string, timestamp: number): boolean => {
  const current = windows.get(origin)
  if (current === undefined || timestamp - current.start > INGEST_RATE_WINDOW_MS) {
    windows.set(origin, { start: timestamp, count: 1 })
    return true
  }
  if (current.count >= INGEST_RATE_LIMIT) return false
  current.count += 1
  return true
}

export const resetIngestRateLimit = (): void => {
  windows.clear()
}
