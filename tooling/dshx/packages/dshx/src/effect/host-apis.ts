import { Context, Effect, Layer } from 'effect'
import { HostApiClientModel } from '../api/host-client.js'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiContract, RegistryApiView } from '../api/types.js'
import { effectClient, type EffectApiClient } from './client.js'
import { HostContext } from './host-context.js'

/** Effect clients for the dshx APIs other plugins serve on this Host. */
export class HostApis extends Context.Service<
  HostApis,
  {
    /** A client calling `contract` as this plugin, or as `callerPackageId` when given. */
    readonly client: <const Methods extends Record<string, AnyApiMethodDefinition>>(
      contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
      callerPackageId?: string,
    ) => EffectApiClient<Methods>
    /** Whether a plugin currently serves `contract`. */
    readonly isServed: (contract: Pick<ApiContract, 'id' | 'owner'>) => Effect.Effect<boolean>
    /** Every API served right now, as the dshx registry lists them. */
    readonly list: Effect.Effect<readonly RegistryApiView[]>
  }
>()('@dshfiles/dshx/HostApis') {
  static readonly layer = Layer.effect(
    HostApis,
    Effect.gen(function* () {
      const host = yield* HostContext
      return HostApis.of({
        client: (contract, callerPackageId = host.packageId) => effectClient(HostApiClientModel.create(host.ctx, contract, callerPackageId)),
        isServed: contract => Effect.sync(() => HostApiClientModel.isServed(host.ctx, contract, host.packageId)),
        list: Effect.sync(() => HostApiClientModel.list(host.ctx)),
      })
    }),
  )
}
