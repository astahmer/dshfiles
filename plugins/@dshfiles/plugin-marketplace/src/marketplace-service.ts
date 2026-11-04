import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { HostContext } from '@dshfiles/dshx/effect'
import { satisfies, valid, validRange } from 'semver'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import type { MarketplaceInstallOutput, MarketplaceListOutput } from './api.js'
import { type CatalogListInput, type HubCard, MarketplaceCatalog } from './catalog.js'
import { MarketplaceFiles, type MarketplaceProfileFailed } from './marketplace-files.js'
import { MarketplaceProcesses } from './marketplace-processes.js'
import { MarketplaceSettingsTag } from './settings-tag.js'

const MAX_LOGGED_STDERR_CHARACTERS = 8_000

/** This request failed for a reason the server could not turn into an install outcome. */
export class MarketplaceFailed extends Schema.TaggedError<MarketplaceFailed>()(
  'MarketplaceFailed',
  {
    operation: Schema.Literals(['list', 'install']),
    reason: Schema.Literals(['catalog', 'profile']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'marketplace-operation-error' },
) {
  override get message(): string {
    if (this.reason === 'catalog') return 'The plugin marketplace is unavailable. Check the Framework Hub URL or network connection.'
    return 'The current DSH profile could not be read. Restart DSH, then retry.'
  }
}

const compatibilityOf = (installedVersion: string, range: string): 'compatible' | 'incompatible' | 'unknown' => {
  if (valid(installedVersion) === null || validRange(range) === null) return 'unknown'
  return satisfies(installedVersion, range, { includePrerelease: true }) ? 'compatible' : 'incompatible'
}

const absoluteIconUrl = (baseUrl: string, iconUrl: string | null): string | null => {
  if (iconUrl === null) return null
  try {
    return new URL(iconUrl, `${baseUrl}/`).href
  } catch {
    return null
  }
}

const httpsAvatarUrl = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

const installFailure = (code: Extract<MarketplaceInstallOutput, { status: 'failed' }>['code'], retryable: boolean): MarketplaceInstallOutput => ({
  status: 'failed',
  code,
  retryable,
})

const profileOf = (error: MarketplaceProfileFailed): MarketplaceFailed => new MarketplaceFailed({ operation: 'install', reason: 'profile', cause: error })

/**
 * The marketplace Host service: one catalog read that resolves the current Profile and the installed DSH version, and
 * one single-flight installer over the DSH spawner. Every failure an API caller can see carries a wire code.
 */
export class MarketplaceService extends Context.Service<
  MarketplaceService,
  {
    readonly list: (input: CatalogListInput) => Effect.Effect<MarketplaceListOutput, MarketplaceFailed>
    readonly install: (slug: string) => Effect.Effect<MarketplaceInstallOutput, MarketplaceFailed>
  }
>()('@dshfiles/plugin-marketplace/MarketplaceService') {
  static readonly layer = Layer.effect(
    MarketplaceService,
    Effect.gen(function* () {
      const host = yield* HostContext
      const catalog = yield* MarketplaceCatalog
      const files = yield* MarketplaceFiles
      const processes = yield* MarketplaceProcesses
      const settings = yield* MarketplaceSettingsTag
      const installing = yield* Ref.make(false)
      const baseUrlOf = (): string => (typeof host.ctx.baseUrl === 'string' ? host.ctx.baseUrl : '')

      const list = Effect.fn('marketplace list')(function* (input: CatalogListInput) {
        const baseUrl = baseUrlOf()
        if (baseUrl.length === 0) return yield* new MarketplaceFailed({ operation: 'list', reason: 'profile' })
        const profile = yield* files.currentProfile(baseUrl).pipe(Effect.mapError(profileOf))
        const hubBaseUrl = (yield* settings.get).hubBaseUrl
        const page = yield* catalog
          .list({ hubBaseUrl, input })
          .pipe(Effect.mapError(cause => new MarketplaceFailed({ operation: 'list', reason: 'catalog', cause })))
        const installed = new Set(profile.bundles)
        const installedVersion = yield* files.dshCli.pipe(
          Effect.map(cli => cli.version),
          Effect.catch(error => Effect.as(Effect.logWarning('marketplace: the installed DSH version is unknown', error), '')),
        )
        yield* Effect.annotateCurrentSpan({ 'dshx.marketplace.items': page.items.length })
        return {
          categories: page.categories,
          items: page.items.map((item: HubCard) => ({
            slug: item.slug,
            name: item.name,
            packageName: item.scope,
            description: item.description,
            version: item.version,
            compatibilityRange: item.compat,
            compatibility: compatibilityOf(installedVersion, item.compat),
            category: item.category,
            // Older Hub deployments may still emit `verified`; the marketplace exposes only Official/Community.
            badge: item.badge === 'official' ? 'official' : 'community',
            glyph: item.glyph,
            iconUrl: absoluteIconUrl(hubBaseUrl, item.iconUrl),
            author: item.author === undefined || item.author === null || item.author.length === 0 ? null : item.author,
            avatarUrl: httpsAvatarUrl(item.publisher?.avatarUrl),
            stars: item.stars ?? null,
            updated: item.updated ?? null,
            installed: installed.has(item.scope),
          })),
          nextCursor: page.nextCursor,
          total: page.total ?? null,
        } satisfies MarketplaceListOutput
      })

      const install = Effect.fn('marketplace install')(function* (slug: string) {
        const busy = yield* Ref.modify(installing, current => [current, true] as const)
        if (busy) return installFailure('busy', true)
        return yield* runInstall(slug).pipe(Effect.ensuring(Ref.set(installing, false)))
      })

      const runInstall = Effect.fnUntraced(function* (slug: string) {
        const profile = yield* files
          .currentProfile(baseUrlOf())
          .pipe(Effect.catch(error => Effect.as(Effect.logWarning('marketplace: the current Profile could not be read', error), undefined)))
        if (profile === undefined) return installFailure('profile-unavailable', false)
        const hubBaseUrl = (yield* settings.get).hubBaseUrl
        const detail = yield* catalog
          .detail({ hubBaseUrl, slug })
          .pipe(Effect.catch(error => Effect.as(Effect.logWarning(`marketplace: the install target for ${slug} could not be resolved`, error), undefined)))
        if (detail === undefined) return installFailure('catalog-unavailable', true)
        const target = yield* catalog
          .primaryTarget(detail)
          .pipe(Effect.catch(error => Effect.as(Effect.logWarning(`marketplace: ${slug} has no exact install target`, error), null)))
        if (target === null) return installFailure('target-unavailable', false)
        if (profile.bundles.includes(target.package_name)) {
          return { status: 'already-installed', packageName: target.package_name, version: target.version, restartRequired: true } as const
        }
        const cli = yield* files.dshCli.pipe(
          Effect.catch(error => Effect.as(Effect.logWarning('marketplace: the DSH CLI entry could not be resolved', error), undefined)),
        )
        if (cli === undefined) return installFailure('profile-unavailable', false)
        const result = yield* processes
          .runCli({ cliPath: cli.cliPath, args: ['plugin', '--profile', profile.name, 'add', target.spec], cwd: profile.dir })
          .pipe(
            Effect.catchTag('DshCliUnavailable', error =>
              Effect.as(Effect.logWarning(`marketplace: the DSH CLI for ${slug} could not be started`, error), undefined),
            ),
          )
        if (result === undefined) return installFailure('install-failed', true)
        if (result.timedOut) return installFailure('timeout', true)
        if (result.cancelled) return installFailure('cancelled', true)
        if (result.exitCode !== 0) {
          yield* Effect.logWarning(
            `marketplace: the DSH CLI failed for ${slug} (exit ${String(result.exitCode)})\n${result.stderr.slice(0, MAX_LOGGED_STDERR_CHARACTERS)}`,
          )
          return installFailure('install-failed', true)
        }
        const activated = yield* files
          .bundlesOf(profile.dir)
          .pipe(Effect.catch(error => Effect.as(Effect.logWarning(`marketplace: the Profile activation for ${slug} could not be verified`, error), undefined)))
        if (activated === undefined) return installFailure('activation-missing', true)
        if (!activated.includes(target.package_name)) {
          yield* Effect.logWarning(`marketplace: the DSH CLI exited successfully but ${target.package_name} was not activated`)
          return installFailure('activation-missing', true)
        }
        return { status: 'installed', packageName: target.package_name, version: target.version, restartRequired: true } as const
      })

      return MarketplaceService.of({ list, install })
    }),
  )
}

/** Every marketplace service, as one layer over the platform clients it runs on. */
export const marketplaceLayer = MarketplaceService.layer.pipe(
  Layer.provideMerge(MarketplaceCatalog.layer),
  Layer.provideMerge(MarketplaceFiles.layer),
  Layer.provideMerge(MarketplaceProcesses.layer),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
  Layer.provide(FetchHttpClient.layer),
)
