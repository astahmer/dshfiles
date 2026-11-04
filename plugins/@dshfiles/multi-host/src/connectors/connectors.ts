import { Context, Effect, Layer, type Scope } from 'effect'
import { HttpClient } from 'effect/http'
import { ConnectorKindMismatch } from '../errors.js'
import type { HostRecord, RuntimeRecord } from '../records.js'
import { Ssh } from '../ssh.js'
import type { Gateway } from './gateway.js'
import { connectLocal } from './local.js'
import { SshConnector } from './ssh.js'

type ConnectError = Effect.Error<ReturnType<typeof connectLocal>> | Effect.Error<ReturnType<typeof SshConnector.connect>> | ConnectorKindMismatch

/** Opens a gateway to a recorded runtime through its host's connector: a loopback forward or an SSH tunnel. */
export class Connectors extends Context.Service<
  Connectors,
  {
    /** `originPort` keeps the browser origin of an opened remote view, and so its cookie, stable across reconnects. */
    readonly connect: (input: {
      readonly host: HostRecord
      readonly runtime: RuntimeRecord
      readonly originPort?: number | undefined
    }) => Effect.Effect<Gateway, ConnectError, Scope.Scope>
  }
>()('@dshfiles/multi-host/Connectors') {
  static readonly layer = Layer.effect(
    Connectors,
    Effect.gen(function* () {
      const ssh = yield* Ssh
      const client = yield* HttpClient.HttpClient
      const connect = Effect.fn('multi-host runtime connect', { kind: 'client' })(function* (input: {
        readonly host: HostRecord
        readonly runtime: RuntimeRecord
        readonly originPort?: number | undefined
      }) {
        const locator = input.runtime.locator
        const connector = input.host.connector
        if (locator.kind === 'local' && connector.kind === 'local') return yield* connectLocal({ launchUrl: locator.launchUrl, originPort: input.originPort })
        if (locator.kind === 'ssh' && connector.kind === 'ssh')
          return yield* SshConnector.connect({ sshTarget: connector.sshTarget, remoteHome: locator.remoteHome, originPort: input.originPort })
        return yield* new ConnectorKindMismatch()
      })
      return Connectors.of({
        connect: input => connect(input).pipe(Effect.provideService(Ssh, ssh), Effect.provideService(HttpClient.HttpClient, client)),
      })
    }),
  )
}
