import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'

const NAMESPACE = '@dshfiles/mcp-endpoint'
const TOKEN_KEY = 'token'
const LAN_KEY = 'lan-enabled'
const TOKEN_PREFIX = 'dshmcp_'

const storedTokenSchema = Schema.Struct({
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  createdAt: Schema.Number,
})
const decodeStoredToken = Schema.decodeUnknownOption(storedTokenSchema, { onExcessProperty: 'error' })

/** The endpoint's own storage namespace failed; the token and LAN setting are unchanged. */
export class EndpointStorageFailure extends Schema.TaggedError<EndpointStorageFailure>()(
  'EndpointStorageFailure',
  {
    operation: Schema.Literals(['read-token', 'read-lan', 'write-token', 'write-lan', 'revoke-token']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'endpoint-storage-failure' },
) {
  override get message(): string {
    return 'The MCP endpoint storage operation failed.'
  }
}

export type TokenVerdict = 'valid' | 'invalid' | 'missing'

const digest = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest()

const make = Effect.gen(function* () {
  const storage = yield* PluginStorage
  const failed = (operation: EndpointStorageFailure['operation']) => (cause: unknown) => new EndpointStorageFailure({ operation, cause })

  const readToken = storage.get(TOKEN_KEY).pipe(
    Effect.map(stored => Option.flatMap(stored, entry => decodeStoredToken(entry.value))),
    Effect.mapError(failed('read-token')),
  )

  const tokenInfo = Effect.fn('mcp endpoint token read')(function* () {
    const stored = yield* readToken
    return Option.match(stored, { onNone: () => null, onSome: token => ({ createdAt: token.createdAt }) })
  })

  const lanEnabled = Effect.fn('mcp endpoint lan read')(function* () {
    const stored = yield* storage.get(LAN_KEY).pipe(Effect.mapError(failed('read-lan')))
    return Option.exists(stored, entry => entry.value === true)
  })

  const setLanEnabled = Effect.fn('mcp endpoint lan write')(function* (enabled: boolean) {
    yield* storage.set(LAN_KEY, enabled).pipe(Effect.mapError(failed('write-lan')))
  })

  /** Only the token's SHA-256 is stored: the value leaves the Host once, in the rotate response. */
  const rotate = Effect.fn('mcp endpoint token rotate')(function* () {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    const createdAt = yield* Clock.currentTimeMillis
    yield* storage.set(TOKEN_KEY, { sha256: digest(token).toString('hex'), createdAt }).pipe(Effect.mapError(failed('write-token')))
    return token
  })

  const revoke = Effect.fn('mcp endpoint token revoke')(function* () {
    yield* storage.delete(TOKEN_KEY).pipe(Effect.mapError(failed('revoke-token')))
  })

  /** `missing` when no token was ever issued, so the refusal can say where to issue one. */
  const verify = Effect.fn('mcp endpoint token verify')(function* (presented: string) {
    const stored = yield* readToken
    if (Option.isNone(stored)) return 'missing' satisfies TokenVerdict
    const verdict: TokenVerdict = timingSafeEqual(digest(presented), Buffer.from(stored.value.sha256, 'hex')) ? 'valid' : 'invalid'
    return verdict
  })

  return EndpointTokens.of({ tokenInfo: tokenInfo(), lanEnabled: lanEnabled(), setLanEnabled, rotate: rotate(), revoke: revoke(), verify })
})

/** The endpoint's bearer token (stored as a hash) and its LAN access switch, in the plugin's storage namespace. */
export class EndpointTokens extends Context.Service<
  EndpointTokens,
  {
    readonly tokenInfo: Effect.Effect<{ readonly createdAt: number } | null, EndpointStorageFailure>
    readonly lanEnabled: Effect.Effect<boolean, EndpointStorageFailure>
    readonly setLanEnabled: (enabled: boolean) => Effect.Effect<void, EndpointStorageFailure>
    readonly rotate: Effect.Effect<string, EndpointStorageFailure>
    readonly revoke: Effect.Effect<void, EndpointStorageFailure>
    readonly verify: (presented: string) => Effect.Effect<TokenVerdict, EndpointStorageFailure>
  }
>()('@dshfiles/mcp-endpoint/EndpointTokens') {
  static readonly layer = Layer.effect(EndpointTokens, make).pipe(Layer.provide(PluginStorage.layerFor(NAMESPACE)))
}
