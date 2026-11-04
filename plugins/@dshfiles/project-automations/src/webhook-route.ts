import type { IncomingMessage, ServerResponse } from 'node:http'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Clock, Context, Effect, Layer, Option, Result, Schema } from 'effect'
import { AutomationRunner } from './automation-runner.js'
import { AutomationStore } from './automation-store.js'
import { PromptTemplate } from './prompt-template.js'
import { SlidingWindowLimiter } from './rate-limit.js'
import { ReplayGuard, SIGNATURE_HEADER, TIMESTAMP_HEADER, WebhookSignature, type SignatureRejection } from './webhook-signature.js'

/**
 * Webhooks answer under the DSH web server at `/automations/webhook/<automation id>`. The web server matches a prefix
 * route on `path` itself or `path/…`, so the registered prefix carries no trailing slash.
 */
export const WEBHOOK_PATH = '/automations/webhook'
export const MAX_BODY_BYTES = 262_144
/** Requests per minute across every webhook, refused before any lookup so a flood stays cheap. */
export const GLOBAL_RATE_PER_MINUTE = 120

export const webhookPathOf = (id: string): string => `${WEBHOOK_PATH}/${id}`

/** In-memory guards of this Host process: the replay window and the per-minute limits. */
export class WebhookGuards extends Context.Service<WebhookGuards, { readonly replay: ReplayGuard; readonly limiter: SlidingWindowLimiter }>()(
  '@dshfiles/project-automations/WebhookGuards',
) {
  static readonly layer = Layer.sync(WebhookGuards, () => WebhookGuards.of({ replay: new ReplayGuard(), limiter: new SlidingWindowLimiter(60_000) }))
}

class BodyTooLarge extends Schema.TaggedError<BodyTooLarge>()('BodyTooLarge', {}) {}
class BodyUnreadable extends Schema.TaggedError<BodyUnreadable>()('BodyUnreadable', { cause: Schema.optional(Schema.Defect()) }) {}

const readBody = (request: IncomingMessage) =>
  Effect.callback<Buffer, BodyTooLarge | BodyUnreadable>(resume => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resume(Effect.fail(new BodyTooLarge()))
        request.destroy()
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => resume(Effect.succeed(Buffer.concat(chunks)))
    const onError = (cause: Error) => resume(Effect.fail(new BodyUnreadable({ cause })))
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    return Effect.sync(() => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
    })
  })

const reply = (response: ServerResponse, status: number, body: Readonly<Record<string, unknown>>, headers?: Readonly<Record<string, string>>) =>
  Effect.sync(() => {
    if (response.headersSent) return
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    response.end(JSON.stringify(body))
  })

const outcome = (value: string) => Effect.annotateCurrentSpan('dshx.automation.webhook.outcome', value)

const SIGNING_HINT = `Sign each request: put the Unix time in seconds in ${TIMESTAMP_HEADER} and sha256=HMAC-SHA256(secret, "<timestamp>.<raw body>") in hex in ${SIGNATURE_HEADER}.`

const rejectionDetail = {
  'missing-signature': `Refused: the request had no ${SIGNATURE_HEADER} or ${TIMESTAMP_HEADER} header. ${SIGNING_HINT}`,
  'malformed-signature': `Refused: ${SIGNATURE_HEADER} must read sha256=<64 hex digits> and ${TIMESTAMP_HEADER} must be Unix seconds. ${SIGNING_HINT}`,
  'bad-signature':
    'Refused: the signature does not match this automation’s secret. Check that the sender signs with the value behind the referenced secret alias and signs the raw body unchanged.',
  'stale-timestamp': 'Refused: the request timestamp is more than 5 minutes from the DSH Host clock. Sign with the current time and check both clocks.',
  replayed: 'Refused: this exact signed request was already accepted. Send a new request with a fresh timestamp.',
} satisfies Record<SignatureRejection, string>

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * One webhook request: find the automation, apply the limits, read the bounded body, resolve the referenced secret on
 * the Host, verify the HMAC signature and its replay window, then start a thread with the templated prompt. The
 * payload is only ever read as data by PromptTemplate.fill; it is never parsed as code. One server span per request.
 */
export const handleWebhook = Effect.fn('automation webhook', { kind: 'server' })(function* (input: {
  readonly request: IncomingMessage
  readonly response: ServerResponse
}) {
  const { request, response } = input
  const guards = yield* WebhookGuards
  const store = yield* AutomationStore
  const runner = yield* AutomationRunner
  const secrets = yield* SecretReferenceResolver
  const now = yield* Clock.currentTimeMillis
  yield* Effect.annotateCurrentSpan('http.request.method', request.method ?? 'unknown')

  if (request.method !== 'POST') {
    yield* outcome('method-not-allowed')
    return yield* reply(response, 405, { ok: false, message: 'Send webhook requests with POST.' }, { allow: 'POST' })
  }
  const global = guards.limiter.take('*', GLOBAL_RATE_PER_MINUTE, now)
  if (!global.allowed) {
    yield* outcome('rate-limited')
    return yield* reply(
      response,
      429,
      { ok: false, message: 'Too many webhook requests. Retry later.' },
      { 'retry-after': String(Math.ceil(global.retryAfterMs / 1000)) },
    )
  }
  const id = (request.url ?? '').split('?')[0]?.slice(WEBHOOK_PATH.length + 1) ?? ''
  const found = /^auto_[A-Za-z0-9_-]{8,40}$/u.test(id) ? yield* store.get(id) : Option.none()
  const automation = Option.getOrUndefined(found)
  if (automation === undefined || automation.trigger.kind !== 'webhook') {
    yield* outcome('not-found')
    return yield* reply(response, 404, { ok: false, message: 'No webhook automation answers at this URL. Copy the URL again from DSH › Automations.' })
  }
  const trigger = automation.trigger
  yield* Effect.annotateCurrentSpan('dshx.automation.id', automation.id)
  const limited = guards.limiter.take(automation.id, trigger.ratePerMinute, now)
  if (!limited.allowed) {
    yield* outcome('rate-limited')
    return yield* reply(
      response,
      429,
      {
        ok: false,
        message: `This automation accepts at most ${String(trigger.ratePerMinute)} requests per minute. Retry later or raise its limit in DSH › Automations.`,
      },
      { 'retry-after': String(Math.ceil(limited.retryAfterMs / 1000)) },
    )
  }
  const body = yield* Effect.result(readBody(request))
  if (Result.isFailure(body)) {
    const tooLarge = body.failure._tag === 'BodyTooLarge'
    yield* outcome(tooLarge ? 'too-large' : 'unreadable')
    return yield* reply(response, tooLarge ? 413 : 400, {
      ok: false,
      message: tooLarge ? `The request body is over ${String(MAX_BODY_BYTES / 1024)} KiB. Send a smaller payload.` : 'The request body could not be read.',
    })
  }
  const secret = yield* secrets.resolve({ referenceText: trigger.secretRef, environmentValue: undefined }).pipe(Effect.result)
  if (Result.isFailure(secret) || Option.isNone(secret.success)) {
    yield* outcome('secret-unavailable')
    yield* runner.reject({
      automation,
      detail: `Refused: the webhook secret ${trigger.secretRef} could not be read on the Host. Open Secrets, check that this global alias exists and has a value, then retry the request.`,
    })
    return yield* reply(response, 503, { ok: false, message: 'This webhook cannot verify requests right now. The DSH owner must fix its secret reference.' })
  }
  const verdict = WebhookSignature.verify({
    secret: secret.success.value,
    body: body.success,
    signature: header(request, SIGNATURE_HEADER),
    timestamp: header(request, TIMESTAMP_HEADER),
    now,
    guard: guards.replay,
  })
  if (!verdict.ok) {
    yield* outcome(verdict.reason)
    yield* runner.reject({ automation, detail: rejectionDetail[verdict.reason] })
    return yield* reply(response, 401, { ok: false, message: rejectionDetail[verdict.reason] })
  }
  if (!automation.enabled) {
    yield* outcome('paused')
    yield* runner.reject({ automation, detail: 'Refused: the automation is paused. Resume it in DSH › Automations to accept requests again.' })
    return yield* reply(response, 409, { ok: false, message: 'This automation is paused in DSH. Resume it to accept requests.' })
  }
  const text = body.success.toString('utf8')
  const prompt = `${PromptTemplate.fill(automation.prompt, { body: PromptTemplate.body(text, header(request, 'content-type')), headers: request.headers })}${PromptTemplate.framing(automation.title, PromptTemplate.fields(automation.prompt))}`
  const run = yield* runner.start({ automation, trigger: 'webhook', prompt })
  yield* outcome(run.outcome)
  return yield* run.outcome === 'started'
    ? reply(response, 202, { ok: true, runId: run.id, sessionId: run.sessionId })
    : reply(response, 502, {
        ok: false,
        runId: run.id,
        message: 'The request was verified but no thread could start. The DSH owner can read why in Automations › Recent runs.',
      })
})
