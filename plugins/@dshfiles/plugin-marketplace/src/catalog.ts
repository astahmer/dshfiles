import { Cause, Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { isAbsolute } from 'node:path'
import { MarketplaceSettingsTag } from './settings-tag.js'
import { satisfies, valid, validRange } from 'semver'

const PAGE_SIZE = 24
const HUB_TIMEOUT = '15 seconds'
const MAX_LEGACY_SCAN_PAGES = 100

const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const absoluteUrlFilter = Schema.makeFilter((value: string) => (URL.canParse(value) ? undefined : 'Expected an absolute URL.'))

const hubCategorySchema = Schema.Struct({
  slug: boundedString(1, 80),
  name: boundedString(1, 100),
})

const statsSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const hubCardSchema = Schema.Struct({
  slug: boundedString(1, 160),
  name: boundedString(1, 160),
  scope: boundedString(1, 240),
  description: Schema.String.check(Schema.isMaxLength(600)),
  version: boundedString(1, 100),
  compat: boundedString(1, 160),
  category: boundedString(1, 80),
  badge: Schema.Literals(['official', 'verified', 'community']),
  glyph: boundedString(1, 4),
  iconUrl: Schema.NullOr(Schema.String),
  author: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(120)))),
  stars: Schema.optionalKey(Schema.NullOr(statsSchema)),
  updated: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(40)))),
  publisher: Schema.optionalKey(Schema.NullOr(Schema.Struct({ avatarUrl: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_048)))) }))),
})

export const hubListResponseSchema = Schema.Struct({
  items: Schema.Array(hubCardSchema).check(Schema.isMaxLength(PAGE_SIZE)),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
  // Older Framework Hub deployments remain readable during a rolling update.
  categories: Schema.Array(hubCategorySchema)
    .check(Schema.isMaxLength(100))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  total: Schema.optionalKey(statsSchema),
})

const installTargetSchema = Schema.Struct({
  kind: Schema.Literals(['npm', 'github']),
  spec: boundedString(1, 1000),
  package_name: boundedString(1, 240),
  version: boundedString(1, 100),
  integrity: Schema.NullOr(Schema.String),
  is_primary: Schema.Union([Schema.Literal(0), Schema.Literal(1), Schema.Boolean]),
  status: boundedString(1, 40),
})

export const hubDetailResponseSchema = Schema.Struct({
  plugin: hubCardSchema,
  installTargets: Schema.Array(installTargetSchema).check(Schema.isMaxLength(20)),
  repositoryUrl: Schema.optionalKey(Schema.NullOr(Schema.String.check(absoluteUrlFilter, Schema.isMaxLength(2_048)))),
  releases: Schema.Array(
    Schema.Struct({
      version: boundedString(1, 100),
      channel: Schema.Literals(['stable', 'prerelease']),
      git_tag: Schema.NullOr(boundedString(1, 255)),
    }),
  )
    .check(Schema.isMaxLength(20))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
})

export type HubCard = typeof hubCardSchema.Type
export type HubDetail = typeof hubDetailResponseSchema.Type
export type HubListResponse = typeof hubListResponseSchema.Type
export type InstallTarget = typeof installTargetSchema.Type

/** The Hub was reachable but answered something this Host cannot install from. */
export class HubRequestFailed extends Schema.TaggedError<HubRequestFailed>()('HubRequestFailed', {
  reason: Schema.Literals(['request', 'status', 'malformed', 'legacy-pagination', 'repeated-cursor']),
  status: Schema.optional(Schema.Number),
  location: Schema.optional(Schema.NullOr(Schema.String)),
  legacyRouteMiss: Schema.optional(Schema.Boolean),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === 'status') return `Framework Hub returned HTTP ${String(this.status)}. Retry later.`
    if (this.reason === 'malformed') return 'Framework Hub returned a catalog this DSH cannot read. Retry later.'
    if (this.reason === 'legacy-pagination') return 'Framework Hub legacy pagination exceeded the safety limit. Retry later.'
    if (this.reason === 'repeated-cursor') return 'Framework Hub returned a repeated legacy cursor. Retry later.'
    return 'Framework Hub could not be reached. Check the network connection, then retry.'
  }
}

export type HubMarketplaceMode = 'dedicated' | 'legacy'

const isLoopbackHttpHub = (baseUrl: string): boolean => {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

export const githubRepositoryFullName = (repositoryUrl: string | null | undefined): string | undefined => {
  if (repositoryUrl === null || repositoryUrl === undefined) return undefined
  try {
    const url = new URL(repositoryUrl)
    if (url.protocol !== 'https:' || url.hostname.toLocaleLowerCase() !== 'github.com') return undefined
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return undefined
    const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    if (segments.length !== 2) return undefined
    const owner = segments[0]
    const repository = segments[1]?.replace(/\.git$/, '')
    if (owner === undefined || repository === undefined || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) return undefined
    return `${owner}/${repository}`
  } catch {
    return undefined
  }
}

/** The one active target that names this exact version and a package-manager-visible, immutable spec. */
export const primaryTargetOf = (detail: HubDetail, hubBaseUrl: string): InstallTarget | undefined => {
  const candidates = detail.installTargets.filter(target => (target.is_primary === true || target.is_primary === 1) && target.status === 'active')
  if (candidates.length !== 1) return undefined
  const target = candidates[0]
  if (target === undefined || target.package_name !== detail.plugin.scope || target.version !== detail.plugin.version) return undefined
  const localArchive = target.kind === 'npm' && isLoopbackHttpHub(hubBaseUrl) && isAbsolute(target.spec) && target.spec.toLocaleLowerCase().endsWith('.tgz')
  if (/[\0\r\n]/.test(target.spec) || target.spec.startsWith('-') || (/\s/.test(target.spec) && !localArchive)) return undefined
  if (target.kind === 'npm') {
    if (!localArchive && target.spec !== `${target.package_name}@${target.version}`) return undefined
    return target
  }
  const repository = githubRepositoryFullName(detail.repositoryUrl)
  const releases = detail.releases.filter(
    release => release.version === detail.plugin.version && release.channel === 'stable' && release.git_tag !== null && release.git_tag.length > 0,
  )
  if (repository === undefined || releases.length !== 1 || target.spec !== `github:${repository}#${releases[0]?.git_tag}`) return undefined
  return target
}

const legacyDiagnostics = Schema.Struct({ error: Schema.Literal('Only HTML requests are supported here') })

const isLegacyRouteMiss = (body: string): boolean =>
  Option.match(Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(body), {
    onNone: () => false,
    onSome: value => Option.isSome(Schema.decodeUnknownOption(legacyDiagnostics)(value)),
  })

const isLegacyMarketplaceRedirect = (location: string, pathname: string): boolean => {
  try {
    const redirected = new URL(location, 'https://framework-hub.invalid')
    const webPath = pathname.replace(/^\/api/, '')
    return redirected.pathname === `/en${webPath}` || redirected.pathname === `/zh${webPath}`
  } catch {
    return false
  }
}

const isLegacyCard = (item: HubCard): boolean => valid(item.version) !== null && validRange(item.compat) !== null

const absoluteIconUrl = (baseUrl: string, iconUrl: string | null): string | null => {
  if (iconUrl === null) return null
  try {
    return new URL(iconUrl, `${baseUrl}/`).href
  } catch {
    return null
  }
}

export interface CatalogListInput {
  readonly locale: 'en' | 'zh'
  readonly category?: string | undefined
  readonly cursor?: string | undefined
  readonly query?: string | undefined
  readonly sort?: 'latest' | 'stars' | undefined
}

const hubUrl = (baseUrl: string, pathname: string, search?: URLSearchParams): URL => {
  const url = new URL(pathname.replace(/^\//, ''), `${baseUrl}/`)
  if (search !== undefined) url.search = search.toString()
  return url
}

/**
 * The Framework Hub catalog: a dedicated marketplace route with a legacy discovery fallback, decoded once at the
 * boundary, and the install-target rules that decide whether one exact target may be installed.
 */
export class MarketplaceCatalog extends Context.Service<
  MarketplaceCatalog,
  {
    readonly list: (input: { readonly hubBaseUrl: string; readonly input: CatalogListInput }) => Effect.Effect<HubListResponse, HubRequestFailed>
    readonly detail: (input: { readonly hubBaseUrl: string; readonly slug: string }) => Effect.Effect<HubDetail, HubRequestFailed>
    readonly primaryTarget: (detail: HubDetail) => Effect.Effect<InstallTarget | null>
  }
>()('@dshfiles/plugin-marketplace/MarketplaceCatalog') {
  static readonly layer = Layer.effect(
    MarketplaceCatalog,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const modes = yield* Ref.make<ReadonlyMap<string, HubMarketplaceMode>>(new Map())
      const settings = yield* MarketplaceSettingsTag

      const readJson = (url: URL) =>
        Effect.gen(function* () {
          const response = yield* client.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders({ accept: 'application/json' }))).pipe(
            // A manual redirect keeps an API miss from becoming a localized HTML page.
            Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
            Effect.timeout(HUB_TIMEOUT),
            Effect.mapError(cause => new HubRequestFailed({ reason: 'request', cause })),
          )
          const body = yield* response.text.pipe(Effect.mapError(cause => new HubRequestFailed({ reason: 'request', cause })))
          if (response.status >= 200 && response.status < 300) return body
          const contentType = response.headers['content-type']?.toLocaleLowerCase() ?? ''
          const legacyRouteMiss = response.status === 500 && contentType.includes('application/json') && isLegacyRouteMiss(body)
          return yield* new HubRequestFailed({ reason: 'status', status: response.status, location: response.headers.location ?? null, legacyRouteMiss })
        }).pipe(Effect.withSpan('marketplace hub request', { kind: 'client', attributes: { 'server.address': url.host } }))

      const decodePage = (body: string) =>
        Schema.decodeUnknownEffect(hubListResponseSchema)(JSON.parse(body)).pipe(Effect.mapError(cause => new HubRequestFailed({ reason: 'malformed', cause })))

      const fetchLegacyPage = Effect.fn('marketplace legacy list page')(function* (input: { readonly hubBaseUrl: string; readonly query: URLSearchParams }) {
        const query = new URLSearchParams(input.query)
        const seenCursors = new Set<string>()
        const initialCursor = query.get('cursor')
        if (initialCursor !== null) seenCursors.add(initialCursor)
        for (let pageNumber = 0; pageNumber < MAX_LEGACY_SCAN_PAGES; pageNumber += 1) {
          const page = yield* readJson(hubUrl(input.hubBaseUrl, '/api/plugins', query)).pipe(Effect.flatMap(decodePage))
          const items = page.items.filter(isLegacyCard)
          if (items.length > 0 || page.nextCursor === null) return { ...page, items }
          if (seenCursors.has(page.nextCursor)) return yield* new HubRequestFailed({ reason: 'repeated-cursor' })
          seenCursors.add(page.nextCursor)
          query.set('cursor', page.nextCursor)
        }
        return yield* new HubRequestFailed({ reason: 'legacy-pagination' })
      })

      const pageOf = Effect.fn('marketplace list page')(function* (input: { readonly hubBaseUrl: string; readonly query: URLSearchParams }) {
        const mode = (yield* Ref.get(modes)).get(input.hubBaseUrl)
        if (mode === 'legacy') return yield* fetchLegacyPage(input)
        const pathname = '/api/marketplace/plugins'
        return yield* readJson(hubUrl(input.hubBaseUrl, pathname, input.query)).pipe(
          Effect.flatMap(decodePage),
          Effect.tap(() => Ref.update(modes, current => new Map(current).set(input.hubBaseUrl, 'dedicated'))),
          Effect.catchTag('HubRequestFailed', error => {
            const missing =
              mode === undefined &&
              (error.reason === 'request' ||
                (error.status === 404 && error.reason === 'status') ||
                (error.legacyRouteMiss === true && error.reason === 'status') ||
                (error.reason === 'status' && error.location != null && isLegacyMarketplaceRedirect(error.location, pathname)))
            if (!missing) return Effect.fail(error)
            return Ref.update(modes, current => new Map(current).set(input.hubBaseUrl, 'legacy')).pipe(Effect.andThen(fetchLegacyPage(input)))
          }),
        )
      })

      const list = Effect.fn('marketplace catalog list')(function* (input: { readonly hubBaseUrl: string; readonly input: CatalogListInput }) {
        const query = new URLSearchParams({ locale: input.input.locale, sort: input.input.sort ?? 'latest', limit: String(PAGE_SIZE) })
        if (input.input.category !== undefined) query.set('category', input.input.category)
        if (input.input.cursor !== undefined) query.set('cursor', input.input.cursor)
        if (input.input.query !== undefined) query.set('q', input.input.query)
        return yield* pageOf({ hubBaseUrl: input.hubBaseUrl, query })
      })

      const detail = Effect.fn('marketplace plugin detail')(function* (input: { readonly hubBaseUrl: string; readonly slug: string }) {
        const mode = (yield* Ref.get(modes)).get(input.hubBaseUrl)
        const encodedSlug = encodeURIComponent(input.slug)
        const query = new URLSearchParams({ locale: 'en' })
        const decode = (body: string) =>
          Schema.decodeUnknownEffect(hubDetailResponseSchema)(JSON.parse(body)).pipe(
            Effect.mapError(cause => new HubRequestFailed({ reason: 'malformed', cause })),
          )
        if (mode === 'legacy') return yield* readJson(hubUrl(input.hubBaseUrl, `/api/plugins/${encodedSlug}`, query)).pipe(Effect.flatMap(decode))
        const pathname = `/api/marketplace/plugins/${encodedSlug}`
        return yield* readJson(hubUrl(input.hubBaseUrl, pathname, query)).pipe(
          Effect.flatMap(decode),
          Effect.tap(() => Ref.update(modes, current => new Map(current).set(input.hubBaseUrl, 'dedicated'))),
          Effect.catchTag('HubRequestFailed', error => {
            // A current Hub may reject an ineligible slug with a detail 404, so only the legacy Web redirect downgrades.
            if (mode !== undefined || error.reason !== 'status' || error.location == null || !isLegacyMarketplaceRedirect(error.location, pathname))
              return Effect.fail(error)
            return Ref.update(modes, current => new Map(current).set(input.hubBaseUrl, 'legacy')).pipe(
              Effect.andThen(readJson(hubUrl(input.hubBaseUrl, `/api/plugins/${encodedSlug}`, query))),
              Effect.flatMap(decode),
            )
          }),
        )
      })

      const primaryTarget = Effect.fn('marketplace primary target')(function* (detail: HubDetail) {
        const hubBaseUrl = yield* settings.get
        return primaryTargetOf(detail, hubBaseUrl.hubBaseUrl) ?? null
      })

      return MarketplaceCatalog.of({ list, detail, primaryTarget })
    }),
  )
}

export { isLegacyCard, absoluteIconUrl, satisfies, Cause }
