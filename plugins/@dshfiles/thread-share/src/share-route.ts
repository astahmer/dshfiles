import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TLSSocket } from 'node:tls'
import { Clock, Context, Effect, Layer, Option } from 'effect'
import { RateLimiter } from './rate-limit.js'
import { SharePage, type PageContent } from './share-page.js'
import { PASSPHRASE_MAX } from './share-policy-constants.js'
import { SharePolicy, TOKEN_PATTERN } from './share-policy.js'
import { ShareStore, type ShareRecord, type ShareStorageFailure } from './share-store.js'
import { ShareThreads } from './transcript.js'

/** The plugin's route prefix on the DSH web server; a share page is `/thread-share/s/<token>`. */
export const ROUTE_PATH = '/thread-share'
export const sharePath = (token: string): string => `${ROUTE_PATH}/s/${token}`

const MAX_FORM_BYTES = 4096
const GRANT_COOKIE = 'dshs_grant'
const GRANT_TTL_MS = 12 * 3_600_000
const MAX_GRANTS = 5_000

/** Requests per client per minute across every share page, and wrong passphrases per share per 15 minutes. */
export const REQUEST_LIMIT = { limit: 120, windowMs: 60_000 } as const
export const PASSPHRASE_FAILURE_LIMIT = { limit: 5, windowMs: 15 * 60_000 } as const

const SECURITY_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
}

const UNAVAILABLE = {
  heading: 'This link is not available',
  detail: 'It is wrong, expired or revoked. Ask the person who shared it for a new link.',
} as const

/** In-memory request limits and passphrase grants. A Host restart forgets both: viewers re-enter the passphrase. */
export class ShareGuard extends Context.Service<
  ShareGuard,
  {
    readonly requests: RateLimiter
    readonly failures: RateLimiter
    readonly grants: Map<string, { readonly shareId: string; readonly expiresAt: number }>
  }
>()('@dshfiles/thread-share/ShareGuard') {
  static readonly layer = Layer.sync(ShareGuard, () =>
    ShareGuard.of({ requests: new RateLimiter(REQUEST_LIMIT), failures: new RateLimiter(PASSPHRASE_FAILURE_LIMIT), grants: new Map() }),
  )
}

const LOOPBACK = /^(?:127\.|::1$|::ffff:127\.)/

/**
 * Behind a tunnel or reverse proxy every request arrives from loopback; only then is the first forwarded address
 * trusted, so a direct client cannot pick its own rate-limit bucket.
 */
const clientKey = (request: IncomingMessage): string => {
  const peer = request.socket.remoteAddress ?? 'unknown'
  if (!LOOPBACK.test(peer)) return peer
  const forwarded = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first === undefined || first === '' ? peer : first.slice(0, 64)
}

const isHttps = (request: IncomingMessage): boolean =>
  // SAFETY: an https server hands handlers a TLSSocket; a plain socket has no `encrypted` property.
  (request.socket as Partial<TLSSocket>).encrypted === true || request.headers['x-forwarded-proto'] === 'https'

const send = (input: {
  readonly response: ServerResponse
  readonly status: number
  readonly html: string
  readonly headers?: Record<string, string>
  readonly head?: boolean
}) =>
  Effect.sync(() => {
    input.response.writeHead(input.status, { ...SECURITY_HEADERS, ...input.headers })
    input.response.end(input.head === true ? undefined : input.html)
  })

const outcome = (value: string) => Effect.annotateCurrentSpan('dshx.thread_share.outcome', value)

const tokenOf = (request: IncomingMessage): string | undefined => {
  const pathname = new URL(request.url ?? '/', 'http://share.invalid').pathname
  const match = /^\/thread-share\/s\/([^/]+)$/.exec(pathname)
  const token = match?.[1]
  return token !== undefined && TOKEN_PATTERN.test(token) ? token : undefined
}

const grantOf = (request: IncomingMessage): string | undefined => {
  const cookies = (request.headers.cookie ?? '').split(';').map(part => part.trim())
  const found = cookies.find(part => part.startsWith(`${GRANT_COOKIE}=`))
  return found?.slice(GRANT_COOKIE.length + 1)
}

const readForm = (request: IncomingMessage) =>
  Effect.callback<string | undefined>(resume => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_FORM_BYTES) {
        resume(Effect.succeed(undefined))
        request.destroy()
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      const passphrase = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('passphrase')
      resume(Effect.succeed(passphrase === null || passphrase.length > PASSPHRASE_MAX ? undefined : passphrase))
    }
    const onError = () => resume(Effect.succeed(undefined))
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    return Effect.sync(() => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
    })
  })

/** The transcript a share shows: re-read and redacted for a live share, the frozen copy for a snapshot. */
const contentOf = Effect.fn('thread share content')(function* (
  share: ShareRecord,
): Effect.fn.Return<Option.Option<PageContent>, ShareStorageFailure, ShareStore | ShareThreads> {
  const now = yield* Clock.currentTimeMillis
  if (share.kind === 'snapshot') {
    const store = yield* ShareStore
    const snapshot = yield* store.snapshot(share.id)
    return Option.map(snapshot, (frozen): PageContent => ({
      title: share.title,
      entries: frozen.entries,
      mode: 'snapshot',
      capturedAt: frozen.capturedAt,
      expiresAt: share.expiresAt,
      truncated: frozen.truncated,
    }))
  }
  const threads = yield* ShareThreads
  const transcript = yield* Effect.option(threads.read(share.sessionId))
  return Option.map(transcript, (live): PageContent => ({
    title: live.title,
    entries: live.entries,
    mode: 'live',
    capturedAt: now,
    expiresAt: share.expiresAt,
    truncated: live.truncated,
  }))
})

/**
 * Serve one share page. Nothing under the prefix but `/thread-share/s/<token>` answers, the token decides which one
 * thread is read, and that thread's user and assistant text is the only content that can come back.
 */
const handleShareRequest = Effect.fn('thread share request', { kind: 'server' })(function* (input: {
  readonly request: IncomingMessage
  readonly response: ServerResponse
}) {
  const { request, response } = input
  const guard = yield* ShareGuard
  const store = yield* ShareStore
  const now = yield* Clock.currentTimeMillis
  const method = request.method ?? 'GET'
  const head = method === 'HEAD'
  yield* Effect.annotateCurrentSpan('http.request.method', method)
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    yield* outcome('method-not-allowed')
    return yield* send({
      response,
      status: 405,
      headers: { allow: 'GET, HEAD, POST' },
      html: SharePage.notice({ heading: 'Method not allowed', detail: 'Open the link in a browser.' }),
    })
  }
  const limited = guard.requests.hit(clientKey(request), now)
  if (!limited.allowed) {
    yield* outcome('rate-limited')
    return yield* send({
      response,
      status: 429,
      head,
      headers: { 'retry-after': String(limited.retryAfterSeconds) },
      html: SharePage.notice({ heading: 'Too many requests', detail: `Wait ${String(limited.retryAfterSeconds)} seconds, then reload the page.` }),
    })
  }
  const token = tokenOf(request)
  const share = token === undefined ? Option.none<ShareRecord>() : yield* store.byToken(token)
  if (Option.isNone(share) || token === undefined || SharePolicy.status({ ...share.value, now }) !== 'active') {
    yield* outcome('not-found')
    return yield* send({ response, status: 404, head, html: SharePage.notice(UNAVAILABLE) })
  }
  const record = share.value
  yield* Effect.annotateCurrentSpan({ 'dshx.thread_share.kind': record.kind, 'dshx.thread_share.access': record.access })
  const path = sharePath(token)
  if (record.access === 'protected') {
    const grant = grantOf(request)
    const granted = grant === undefined ? undefined : guard.grants.get(grant)
    const valid = granted !== undefined && granted.shareId === record.id && granted.expiresAt > now
    if (!valid && method !== 'POST') {
      yield* outcome('passphrase-required')
      return yield* send({ response, status: 200, head, html: SharePage.passphrase({ action: path, failed: false }) })
    }
    if (!valid) {
      const blocked = guard.failures.blocked(record.id, now)
      if (!blocked.allowed) {
        yield* outcome('passphrase-locked')
        return yield* send({
          response,
          status: 429,
          headers: { 'retry-after': String(blocked.retryAfterSeconds) },
          html: SharePage.notice({
            heading: 'Too many wrong passphrases',
            detail: `Wait ${String(Math.ceil(blocked.retryAfterSeconds / 60))} minutes, then try again.`,
          }),
        })
      }
      const presented = yield* readForm(request)
      const accepted = presented !== undefined && record.passphrase !== null && (yield* SharePolicy.verifyPassphrase({ stored: record.passphrase, presented }))
      if (!accepted) {
        guard.failures.hit(record.id, now)
        yield* outcome('passphrase-wrong')
        return yield* send({ response, status: 401, html: SharePage.passphrase({ action: path, failed: true }) })
      }
      const issued = randomBytes(24).toString('base64url')
      const expiresAt = Math.min(now + GRANT_TTL_MS, record.expiresAt ?? Number.POSITIVE_INFINITY)
      if (guard.grants.size >= MAX_GRANTS)
        for (const [key, value] of guard.grants) if (value.expiresAt <= now || guard.grants.size >= MAX_GRANTS) guard.grants.delete(key)
      guard.grants.set(issued, { shareId: record.id, expiresAt })
      const cookie = [
        `${GRANT_COOKIE}=${issued}`,
        `Path=${path}`,
        `Max-Age=${String(Math.max(1, Math.floor((expiresAt - now) / 1000)))}`,
        'HttpOnly',
        'SameSite=Lax',
      ]
      if (isHttps(request)) cookie.push('Secure')
      yield* outcome('passphrase-accepted')
      return yield* send({ response, status: 303, headers: { location: path, 'set-cookie': cookie.join('; ') }, html: '' })
    }
  } else if (method === 'POST') {
    yield* outcome('method-not-allowed')
    return yield* send({
      response,
      status: 405,
      headers: { allow: 'GET, HEAD' },
      html: SharePage.notice({ heading: 'Method not allowed', detail: 'Open the link in a browser.' }),
    })
  }
  const content = yield* contentOf(record)
  if (Option.isNone(content)) {
    yield* outcome('unreadable')
    return yield* send({
      response,
      status: 503,
      head,
      html: SharePage.notice({
        heading: 'This thread cannot be read right now',
        detail: 'Ask the person who shared it to check that DeepSeek Harness is running, then reload.',
      }),
    })
  }
  if (!head) yield* store.recordView(record.id)
  yield* outcome('served')
  yield* send({ response, status: 200, head, html: SharePage.transcript(content.value) })
})

/** A storage failure still ends the response, with a page that says what the viewer can do. */
export const serveShareRequest = (input: { readonly request: IncomingMessage; readonly response: ServerResponse }) =>
  handleShareRequest(input).pipe(
    Effect.catchCause(() =>
      Effect.suspend(() =>
        input.response.headersSent
          ? Effect.sync(() => input.response.end())
          : send({
              response: input.response,
              status: 500,
              html: SharePage.notice({
                heading: 'Something went wrong',
                detail: 'Reload the page in a minute. If it keeps failing, tell the person who shared the link.',
              }),
            }),
      ),
    ),
  )
