import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, PubSub, Ref, Schema, Semaphore, Stream } from 'effect'
import { LinkPairRefused, LinkPeerNotFound, LinkStoreFailed } from './errors.js'
import { MultiHostPaths } from './paths.js'
import { PrivateFile } from './private-file.js'
import { linkSettingsSchema, linkUrlSchema, type LinkSettings } from './records.js'
import { SchemaFields } from './schema.js'

export type { LinkSettings }

const maxPeers = 32
const tokenHashSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))

/** A machine that may reach this one through the link gateway. */
const linkPeerSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  runtimeId: Schema.optional(Schema.String.check(Schema.isUUID())),
  tokenHash: tokenHashSchema,
  createdAt: SchemaFields.dateTimeString,
})

/** What this machine holds to reach a peer's link gateway. */
const linkCredentialSchema = Schema.Struct({
  url: linkUrlSchema,
  credential: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
  createdAt: SchemaFields.dateTimeString,
})

const linkFileSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  settings: linkSettingsSchema,
  peers: Schema.Array(linkPeerSchema).check(Schema.isMaxLength(maxPeers)),
  credentials: Schema.Array(linkCredentialSchema).check(Schema.isMaxLength(128)),
})

export type LinkPeer = Schema.Schema.Type<typeof linkPeerSchema>
type LinkFile = Schema.Schema.Type<typeof linkFileSchema>

const decodeLinkFile = Schema.decodeUnknownEffect(Schema.fromJsonString(linkFileSchema), { onExcessProperty: 'error' })
const encodeLinkFile = Schema.encodeEffect(Schema.fromJsonString(linkFileSchema))

export const defaultLinkSettings: LinkSettings = { enabled: false, listen: 'tailscale', port: 3459 }
const emptyLinkFile: LinkFile = { schemaVersion: 1, settings: defaultLinkSettings, peers: [], credentials: [] }

const offerTtlMs = 10 * 60_000
const maxOffers = 8
const attemptsPerMinute = 10
const codeAlphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const codeLength = 12

/** `ABCD-EFGH-JKMN` from 12 symbols of a 30-letter alphabet without look-alikes: about 59 bits. */
const newCode = (): string => {
  const symbols = Array.from({ length: codeLength }, () => codeAlphabet[randomInt(codeAlphabet.length)] ?? 'A').join('')
  return `${symbols.slice(0, 4)}-${symbols.slice(4, 8)}-${symbols.slice(8)}`
}

/** Case, spaces and dashes do not matter when a person types a code. */
const normalizeLinkCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

const hashLinkToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex')

/** The origin form every lookup uses, so `http://h:1/` and `http://h:1` name the same peer. */
export const linkOrigin = (url: string): string => new URL(url).origin

interface Offer {
  readonly code: string
  readonly expiresAt: number
}

/**
 * This machine's link state, in `plugins/multi-host/links.json` (0600): the gateway settings, the peers allowed in
 * (only a SHA-256 of each credential) and the credentials this machine holds to reach its peers. Pairing codes live in
 * memory only, single use, for ten minutes.
 */
export class LinkStore extends Context.Service<
  LinkStore,
  {
    readonly settings: Effect.Effect<LinkSettings, LinkStoreFailed>
    readonly setSettings: (patch: Partial<LinkSettings> & { readonly clearAdvertiseUrl?: boolean }) => Effect.Effect<LinkSettings, LinkStoreFailed>
    readonly offer: Effect.Effect<{ readonly code: string; readonly expiresAt: number }>
    readonly redeem: (input: {
      readonly code: string
      readonly name: string
      readonly runtimeId?: string | undefined
    }) => Effect.Effect<{ readonly credential: string; readonly peerId: string }, LinkPairRefused | LinkStoreFailed>
    /** Synchronous so the gateway can check every proxied request; reads the last loaded peer list. */
    readonly authenticate: (token: string) => LinkPeer | undefined
    readonly peers: Effect.Effect<readonly LinkPeer[], LinkStoreFailed>
    readonly revoke: (peerId: string) => Effect.Effect<LinkPeer, LinkStoreFailed | LinkPeerNotFound>
    readonly credentialFor: (url: string) => Effect.Effect<string | undefined, LinkStoreFailed>
    readonly saveCredential: (input: { readonly url: string; readonly credential: string }) => Effect.Effect<void, LinkStoreFailed>
    readonly removeCredential: (url: string) => Effect.Effect<void, LinkStoreFailed>
    /** Fires after every write: settings to apply, peers to drop. */
    readonly changes: Stream.Stream<void>
  }
>()('@dshfiles/multi-host/LinkStore') {
  static readonly layer = Layer.effect(
    LinkStore,
    Effect.gen(function* () {
      const paths = yield* MultiHostPaths
      const file = paths.dataPath('links.json')
      const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>()
      const lock = yield* Semaphore.make(1)
      const changed = yield* PubSub.unbounded<void>()
      const offers = yield* Ref.make<readonly Offer[]>([])
      const spent = yield* Ref.make<ReadonlySet<string>>(new Set())
      const attempts = yield* Ref.make<readonly number[]>([])
      const cache = { peers: new Map<string, LinkPeer>() }

      const remember = (current: LinkFile): LinkFile => {
        cache.peers = new Map(current.peers.map(peer => [peer.tokenHash, peer]))
        return current
      }

      const read = Effect.gen(function* () {
        const secured = yield* PrivateFile.secure(file)
        if (secured === 'invalid') return yield* new LinkStoreFailed({})
        const text = yield* PrivateFile.readIfPresent(file)
        if (text === undefined) return remember(emptyLinkFile)
        return remember(yield* decodeLinkFile(text))
      }).pipe(
        Effect.provide(services),
        Effect.mapError(cause => (cause instanceof LinkStoreFailed ? cause : new LinkStoreFailed({ cause }))),
      )

      const update = <A, E>(change: (current: LinkFile) => Effect.Effect<{ readonly next: LinkFile; readonly result: A }, E>) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* read
            const { next, result } = yield* change(current)
            const body = yield* encodeLinkFile(next).pipe(Effect.mapError(cause => new LinkStoreFailed({ cause })))
            yield* PrivateFile.write({ path: file, body, commit: 'rename' }).pipe(
              Effect.provide(services),
              Effect.mapError(cause => new LinkStoreFailed({ cause })),
            )
            remember(next)
            yield* PubSub.publish(changed, undefined)
            return result
          }),
        )

      // Load the peer list once so the gateway authenticates from the first request.
      yield* read.pipe(Effect.ignore)

      const offer = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const code = newCode()
        const expiresAt = now + offerTtlMs
        yield* Ref.update(offers, current => [...current.filter(item => item.expiresAt > now), { code: normalizeLinkCode(code), expiresAt }].slice(-maxOffers))
        return { code, expiresAt }
      })

      const redeem = Effect.fn('multi-host link redeem')(function* (input: {
        readonly code: string
        readonly name: string
        readonly runtimeId?: string | undefined
      }) {
        const now = yield* Clock.currentTimeMillis
        const recent = (yield* Ref.get(attempts)).filter(at => at > now - 60_000)
        if (recent.length >= attemptsPerMinute) return yield* new LinkPairRefused({ reason: 'rate-limited' })
        yield* Ref.set(attempts, [...recent, now])
        const code = normalizeLinkCode(input.code)
        if (code.length !== codeLength) return yield* new LinkPairRefused({ reason: 'invalid' })
        if ((yield* Ref.get(spent)).has(code)) return yield* new LinkPairRefused({ reason: 'used' })
        const match = (yield* Ref.get(offers)).find(item => item.code === code)
        if (match === undefined) return yield* new LinkPairRefused({ reason: 'unknown' })
        if (match.expiresAt <= now) return yield* new LinkPairRefused({ reason: 'expired' })
        yield* Ref.update(offers, current => current.filter(item => item.code !== code))
        yield* Ref.update(spent, current => new Set([...current, code]))
        const credential = randomBytes(32).toString('base64url')
        const peer: LinkPeer = {
          id: randomUUID(),
          name: input.name.trim().slice(0, 120) || 'Linked machine',
          ...(input.runtimeId !== undefined && { runtimeId: input.runtimeId }),
          tokenHash: hashLinkToken(credential),
          createdAt: new Date(now).toISOString(),
        }
        return yield* update(current => {
          // Pairing the same machine again replaces its older credential instead of piling up peers.
          const peers = current.peers.filter(item => input.runtimeId === undefined || item.runtimeId !== input.runtimeId)
          if (peers.length >= maxPeers) return Effect.fail(new LinkPairRefused({ reason: 'too-many-peers' }))
          return Effect.succeed({ next: { ...current, peers: [...peers, peer] }, result: { credential, peerId: peer.id } })
        })
      })

      return LinkStore.of({
        settings: Effect.map(read, current => current.settings),
        setSettings: patch =>
          update(current => {
            const { clearAdvertiseUrl, ...fields } = patch
            const merged: LinkSettings = { ...current.settings, ...fields }
            const settings: LinkSettings = clearAdvertiseUrl === true ? { enabled: merged.enabled, listen: merged.listen, port: merged.port } : merged
            return Effect.succeed({ next: { ...current, settings }, result: settings })
          }),
        offer,
        redeem,
        authenticate: token => cache.peers.get(hashLinkToken(token)),
        peers: Effect.map(read, current => current.peers),
        revoke: peerId =>
          update(current => {
            const peer = current.peers.find(item => item.id === peerId)
            if (peer === undefined) return Effect.fail(new LinkPeerNotFound({ peerId }))
            return Effect.succeed({ next: { ...current, peers: current.peers.filter(item => item.id !== peerId) }, result: peer })
          }),
        credentialFor: url =>
          Effect.map(read, current => Option.getOrUndefined(Option.fromNullishOr(current.credentials.find(item => item.url === linkOrigin(url))?.credential))),
        saveCredential: input =>
          update(current => {
            const url = linkOrigin(input.url)
            const credentials = [
              ...current.credentials.filter(item => item.url !== url),
              { url, credential: input.credential, createdAt: new Date().toISOString() },
            ]
            return Effect.succeed({ next: { ...current, credentials }, result: undefined })
          }),
        removeCredential: url =>
          update(current =>
            Effect.succeed({ next: { ...current, credentials: current.credentials.filter(item => item.url !== linkOrigin(url)) }, result: undefined }),
          ),
        changes: Stream.fromPubSub(changed),
      })
    }),
  )
}
