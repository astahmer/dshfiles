import type { ApiContract } from '@dshfiles/dshx/api'
import type { EffectApiClient } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Context, Effect, Layer, Option } from 'effect'
import { VcsProviders, type VcsMatch, type VcsProviderMethods } from './index.js'

/** The provider that claims a path, with a client for its other methods. */
export interface VcsResolution {
  readonly owner: string
  readonly match: VcsMatch
  readonly client: EffectApiClient<VcsProviderMethods>
}

const higherPriority = (best: Option.Option<VcsResolution>, candidate: Option.Option<VcsResolution>) =>
  Option.isSome(candidate) && (Option.isNone(best) || candidate.value.match.priority > best.value.match.priority) ? candidate : best

export class VcsProviderService extends Context.Service<
  VcsProviderService,
  {
    readonly contract: (owner: string) => ApiContract<VcsProviderMethods>
    /** Owners of every served version-control provider API. */
    readonly owners: Effect.Effect<readonly string[]>
    /** The highest-priority provider that claims `path`; a provider whose detect fails is skipped and logged. */
    readonly resolve: (input: { readonly path: string; readonly callerPackageId?: string }) => Effect.Effect<Option.Option<VcsResolution>>
  }
>()('@dshfiles/vcs-provider-port/VcsProvider') {
  static readonly layer = Layer.effect(
    VcsProviderService,
    Effect.gen(function* () {
      const apis = yield* HostApis
      const owners = Effect.map(apis.list, listed => listed.filter(api => api.id === VcsProviders.apiId).map(api => api.owner)).pipe(
        Effect.withSpan('vcs providers list'),
      )

      const detect = (path: string, callerPackageId: string | undefined) => (owner: string) => {
        const client = apis.client(VcsProviders.contract(owner), callerPackageId)
        return client.detect({ path }).pipe(
          Effect.map(detected => Option.map(Option.fromNullOr(detected.match), (match): VcsResolution => ({ owner, match, client }))),
          Effect.catch(error => Effect.as(Effect.logDebug('VCS provider detect failed; skipping it', { owner, error }), Option.none<VcsResolution>())),
        )
      }

      const resolve = Effect.fn('vcs provider resolve')(function* (input: { readonly path: string; readonly callerPackageId?: string }) {
        const answers = yield* Effect.forEach(yield* owners, detect(input.path, input.callerPackageId), { concurrency: 'unbounded' })
        return answers.reduce(higherPriority, Option.none<VcsResolution>())
      })

      return VcsProviderService.of({ contract: VcsProviders.contract, owners, resolve })
    }),
  )
}
