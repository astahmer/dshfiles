import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { PendingAuthorizations } from './pending-authorizations.js'

const pending = (state: string) => ({
  serverId: 'oauth-server',
  state,
  verifier: 'verifier',
  redirectUri: 'http://127.0.0.1:3080/api/dshfiles-mcp-servers/oauth/callback',
  clientId: 'client',
  clientSecret: undefined,
  authorizationServer: { issuer: 'http://127.0.0.1:4100' },
  resource: 'http://127.0.0.1:4100/mcp',
})

describe('OAuth pending authorizations', () => {
  it.layer(PendingAuthorizations.layer)(it => {
    it.effect('a state is usable once', () =>
      Effect.gen(function* () {
        const pendings = yield* PendingAuthorizations
        yield* pendings.put(pending('once'))
        expect(Option.isSome(yield* pendings.take('once'))).toBe(true)
        expect(Option.isNone(yield* pendings.take('once'))).toBe(true)
      }),
    )

    it.effect('a pending authorization younger than 10 minutes still completes', () =>
      Effect.gen(function* () {
        const pendings = yield* PendingAuthorizations
        yield* pendings.put(pending('young'))
        yield* TestClock.adjust('599 seconds')
        expect(yield* pendings.take('young')).toMatchObject({ value: { serverId: 'oauth-server', state: 'young' } })
      }),
    )

    it.effect('a pending authorization expires after 10 minutes, swept on the next take', () =>
      Effect.gen(function* () {
        const pendings = yield* PendingAuthorizations
        yield* pendings.put(pending('old'))
        yield* pendings.put(pending('other'))
        yield* TestClock.adjust('600001 millis')
        expect(Option.isNone(yield* pendings.take('old'))).toBe(true)
        expect(Option.isNone(yield* pendings.take('other'))).toBe(true)
      }),
    )
  })
})
