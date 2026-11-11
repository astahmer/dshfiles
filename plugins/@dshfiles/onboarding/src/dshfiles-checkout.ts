import { Effect, FileSystem, Path } from 'effect'
import { PluginManagerEdge, type PackManagerSurface } from './plugin-manager-promise.js'

const SELF = '@dshfiles/onboarding'
const PROFILE_SYNC = ['scripts', 'profile-sync.ts'] as const

export type CheckoutLocation = { readonly kind: 'found'; readonly root: string } | { readonly kind: 'missing'; readonly reason: string }

const UNLINKED = 'This profile does not link Getting started from a dshfiles checkout, so the repository and its toolchain are not on this Host.'

/**
 * The dshfiles checkout this bundle is linked from, read off the plugin manager's bundle record; nothing is assumed. A
 * registry install, or a manager without bundle records, has none. The root is for Host commands only, never shown.
 */
const locate = <Id extends string>(input: { readonly manager: PackManagerSurface<Id> | undefined }) =>
  Effect.gen(function* (): Effect.fn.Return<CheckoutLocation, never, FileSystem.FileSystem | Path.Path> {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const bundles = yield* PluginManagerEdge.listBundles(input.manager).pipe(Effect.orElseSucceed(() => []))
    const source = bundles.find(bundle => bundle.name === SELF)?.source?.replace(/^(link|file):/u, '')
    if (source === undefined || !path.isAbsolute(source)) return { kind: 'missing', reason: UNLINKED }
    const root = path.resolve(source, '..', '..', '..')
    const isCheckout = yield* fs.exists(path.join(root, ...PROFILE_SYNC)).pipe(Effect.orElseSucceed(() => false))
    return isCheckout ? { kind: 'found', root } : { kind: 'missing', reason: UNLINKED }
  })

export class DshfilesCheckout {
  static readonly locate = locate
}
