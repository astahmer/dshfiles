import { Context, Effect, Layer } from 'effect'
import { HostApiClientModel } from '../api/host-client.js'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiContract, RegistryApiView } from '../api/types.js'
import { client as typedClient, effectClient, type DeclaredError, type EffectApiClient, type TypedApiClient } from './client.js'
import { HostContext } from './host-context.js'

/** Effect clients for the dshx APIs other plugins serve on this Host. */
export class HostApis extends Context.Service<
  HostApis,
  {
    /**
     * A client calling `contract` as this plugin, or as `callerPackageId` when given. Its ApiCallError keeps only the
     * remote code and message; `typed` keeps a declared failure's fields.
     */
    readonly client: <const Methods extends Record<string, AnyApiMethodDefinition>>(
      contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
      callerPackageId?: string,
    ) => EffectApiClient<Methods>
    /**
     * A client calling `contract` with failures typed per kind, as `Api.client` types them: a remote failure whose
     * fields decode into one of `errors` (a `dshxWireCode` class the owner fails with) fails with that class and every
     * field it was sent with, instead of a message-only ApiRemoteError.
     */
    readonly typed: <const Methods extends Record<string, AnyApiMethodDefinition>, const Errors extends ReadonlyArray<DeclaredError> = []>(
      contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
      options?: { readonly errors?: Errors; readonly callerPackageId?: string },
    ) => TypedApiClient<Methods, Errors[number]['Type']>
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
        typed: (contract, options) =>
          typedClient({
            contract,
            api: HostApiClientModel.create(host.ctx, contract, options?.callerPackageId ?? host.packageId),
            ...(options?.errors !== undefined && { errors: options.errors }),
          }),
        isServed: contract => Effect.sync(() => HostApiClientModel.isServed(host.ctx, contract, host.packageId)),
        list: Effect.sync(() => HostApiClientModel.list(host.ctx)),
      })
    }),
  )
}
