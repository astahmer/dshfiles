import { randomUUID } from 'node:crypto'
import { formatSecretReference, parseSecretReference, type SecretScope } from '@dshfiles/credential-port'
import { Clock, Context, Deferred, Effect, Layer, PubSub, Ref, Schema, Stream } from 'effect'
import { SecretCatalog, type SecretCatalogFailure } from './secret-catalog.js'

/** Requests one Host keeps waiting at once; a model looping on the tool cannot grow the list without bound. */
export const MAX_PENDING_SECRET_REQUESTS = 16
export const DEFAULT_SECRET_REQUEST_TIMEOUT_MS = 600_000

/** What a waiting `request_secret` call ends with. Only `stored` carries anything, and that is the reference text. */
export type SecretRequestOutcome =
  | { readonly status: 'stored'; readonly reference: string }
  | { readonly status: 'declined' }
  | { readonly status: 'expired' }
  | { readonly status: 'cancelled' }

/** A pending request as the Client sees it: what to store and why, never a value. */
export interface SecretRequestView {
  readonly requestId: string
  readonly sessionId: string | null
  readonly alias: string
  readonly environment: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly purpose: string
  readonly createdAt: number
  readonly expiresAt: number
}

interface PendingRequest {
  readonly view: SecretRequestView
  readonly settled: Deferred.Deferred<SecretRequestOutcome>
}

const refusals = {
  'too-many-pending': `At most ${MAX_PENDING_SECRET_REQUESTS} secret requests can wait at once; answer or decline one first.`,
  'not-pending': 'This secret request was already answered, declined or expired. Ask the agent to request it again.',
  'not-a-reference': 'Store the value in the Secret Catalog first; the request accepts only its secret:ALIAS reference.',
  'alias-missing': 'That alias is not stored for this request’s folder yet. Store the value, then try again.',
  'folder-required': 'A project or local secret needs the thread’s project folder; ask for a global secret instead.',
} as const

/** A secret request the Host refused; the message says what the user or agent can do next. */
export class SecretRequestRefused extends Schema.TaggedError<SecretRequestRefused>()(
  'SecretRequestRefused',
  { reason: Schema.Literals(['too-many-pending', 'not-pending', 'not-a-reference', 'alias-missing', 'folder-required']) },
  { dshxWireCode: 'secret-request-refused' },
) {
  override get message(): string {
    return refusals[this.reason]
  }
}

export interface SecretRequestInput {
  readonly sessionId: string | null
  readonly alias: string
  readonly environment: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly purpose: string
  readonly timeoutMs: number
}

export interface SecretRequestsShape {
  /** Register a request and wait for the user's answer, its deadline or Host shutdown; interrupting the wait cancels it. */
  readonly ask: (input: SecretRequestInput) => Effect.Effect<SecretRequestOutcome, SecretRequestRefused>
  readonly pending: (sessionId: string | null) => Effect.Effect<readonly SecretRequestView[]>
  /** Settle a request with the reference of a value the user already stored; the Host checks the alias exists first. */
  readonly complete: (input: {
    readonly requestId: string
    readonly reference: string
  }) => Effect.Effect<{ readonly reference: string }, SecretRequestRefused | SecretCatalogFailure>
  readonly decline: (requestId: string) => Effect.Effect<{ readonly declined: true }, SecretRequestRefused>
  /** Fires after a request is added or settled, so browsers read the pending list again. */
  readonly changes: Stream.Stream<void>
}

/**
 * Requests an Agent made for a secret it needs. The value never passes through here: the user stores it through the
 * Catalog's own masked form, and the request settles with the resulting `secret:ALIAS` reference only. Requests live
 * as long as the tool call waiting on them, so they are kept in memory and cancelled when the Host stops.
 */
export class SecretRequests extends Context.Service<SecretRequests, SecretRequestsShape>()('@dshfiles/secret-catalog/SecretRequests') {
  static readonly layer = Layer.effect(
    SecretRequests,
    Effect.gen(function* () {
      const catalog = yield* SecretCatalog
      const requests = yield* Ref.make<ReadonlyMap<string, PendingRequest>>(new Map())
      const changed = yield* PubSub.sliding<void>(1)

      const announce = PubSub.publish(changed, undefined).pipe(Effect.asVoid)

      /** Remove a request and resolve its waiter once; later settlements of the same id do nothing. */
      const settle = Effect.fnUntraced(function* (requestId: string, outcome: SecretRequestOutcome) {
        const entry = yield* Ref.modify(requests, current => {
          const found = current.get(requestId)
          if (found === undefined) return [undefined, current] as const
          const next = new Map(current)
          next.delete(requestId)
          return [found, next] as const
        })
        if (entry === undefined) return false
        yield* Deferred.succeed(entry.settled, outcome)
        yield* announce
        return true
      })

      yield* Effect.addFinalizer(() =>
        Effect.flatMap(Ref.get(requests), current => Effect.forEach([...current.keys()], id => settle(id, { status: 'cancelled' }), { discard: true })),
      )

      const ask = Effect.fn('secret request ask')(function* (input: SecretRequestInput) {
        if (input.scope !== 'global' && input.cwd === null) return yield* new SecretRequestRefused({ reason: 'folder-required' })
        const now = yield* Clock.currentTimeMillis
        const settled = yield* Deferred.make<SecretRequestOutcome>()
        const view: SecretRequestView = {
          requestId: randomUUID(),
          sessionId: input.sessionId,
          alias: input.alias,
          environment: input.environment,
          scope: input.scope,
          cwd: input.scope === 'global' ? null : input.cwd,
          purpose: input.purpose,
          createdAt: now,
          expiresAt: now + input.timeoutMs,
        }
        const admitted = yield* Ref.modify(requests, current =>
          current.size >= MAX_PENDING_SECRET_REQUESTS
            ? ([false, current] as const)
            : ([true, new Map(current).set(view.requestId, { view, settled })] as const),
        )
        if (!admitted) return yield* new SecretRequestRefused({ reason: 'too-many-pending' })
        yield* Effect.annotateCurrentSpan({ 'secret.alias': view.alias, 'secret.environment': view.environment, 'secret.scope': view.scope })
        yield* announce
        const expiry = Effect.sleep(input.timeoutMs).pipe(Effect.andThen(settle(view.requestId, { status: 'expired' })))
        return yield* Deferred.await(settled).pipe(
          Effect.raceFirst(expiry.pipe(Effect.andThen(Deferred.await(settled)))),
          Effect.onInterrupt(() => settle(view.requestId, { status: 'cancelled' })),
          Effect.tap(outcome => Effect.annotateCurrentSpan('secret.request.status', outcome.status)),
        )
      })

      const pending = (sessionId: string | null) =>
        Effect.map(Ref.get(requests), current =>
          [...current.values()].map(entry => entry.view).filter(view => sessionId === null || view.sessionId === sessionId),
        )

      const complete = Effect.fn('secret request complete')(function* (input: { readonly requestId: string; readonly reference: string }) {
        const entry = (yield* Ref.get(requests)).get(input.requestId)
        if (entry === undefined) return yield* new SecretRequestRefused({ reason: 'not-pending' })
        const parsed = parseSecretReference(input.reference)
        if (parsed === null) return yield* new SecretRequestRefused({ reason: 'not-a-reference' })
        // Read the config now: a reference the agent receives must name an alias that exists at this moment.
        const rows = yield* catalog.list(entry.view.cwd, { fresh: true })
        if (!rows.some(row => row.alias === parsed.alias && row.environment === parsed.environment))
          return yield* new SecretRequestRefused({ reason: 'alias-missing' })
        const reference = formatSecretReference(parsed)
        if (!(yield* settle(input.requestId, { status: 'stored', reference }))) return yield* new SecretRequestRefused({ reason: 'not-pending' })
        return { reference }
      })

      const decline = Effect.fn('secret request decline')(function* (requestId: string) {
        if (!(yield* settle(requestId, { status: 'declined' }))) return yield* new SecretRequestRefused({ reason: 'not-pending' })
        return { declined: true } as const
      })

      return SecretRequests.of({ ask, pending, complete, decline, changes: Stream.fromPubSub(changed) })
    }),
  )
}
