import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { HostContext } from '@dshfiles/dshx/effect'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { hubListResponseSchema, MarketplaceCatalog } from '../src/catalog.js'
import { MarketplaceFiles } from '../src/marketplace-files.js'
import { MarketplaceProcesses, type CliRunResult } from '../src/marketplace-processes.js'
import { MarketplaceService } from '../src/marketplace-service.js'
import { marketplaceSettingsTestLayer } from '../src/settings-tag.js'

const card = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  slug: 'community-tool',
  name: 'Community tool',
  scope: '@fixture/community-tool',
  description: 'A fixture plugin for marketplace tests.',
  version: '1.2.3',
  compat: '>=0.1.0-rc.8 <0.2.0-0',
  category: 'tools',
  badge: 'community',
  glyph: 'C',
  iconUrl: '/api/media/icon',
  ...overrides,
})

const detail = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  plugin: card(),
  installTargets: [
    {
      kind: 'npm',
      spec: '@fixture/community-tool@1.2.3',
      package_name: '@fixture/community-tool',
      version: '1.2.3',
      integrity: null,
      is_primary: 1,
      status: 'active',
    },
  ],
  ...overrides,
})

const jsonResponse = (value: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })

const cliResult = (overrides: Partial<CliRunResult> = {}): CliRunResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  cancelled: false,
  ...overrides,
})

/** The Hub is external to the plugin: each test answers with a fixed sequence of responses. */
const hub = (responses: ReadonlyArray<() => Response>) => {
  const requests: URL[] = []
  const fetcher: typeof fetch = async input => {
    requests.push(new URL(input instanceof Request ? input.url : String(input)))
    const next = responses[Math.min(requests.length, responses.length) - 1]
    return (next ?? (() => jsonResponse({}, 500)))()
  }
  return { requests, fetcher }
}

/** A scratch harness home: `profiles/web` is the current local Profile and its manifest names `bundles`. */
const scratchHome = () =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const home = await mkdtemp(join(tmpdir(), 'dshx-marketplace-home-'))
      const profileDir = join(home, 'profiles', 'web')
      await mkdir(profileDir, { recursive: true })
      return { home, profileDir }
    }),
    created => Effect.promise(() => rm(created.home, { recursive: true, force: true })),
  )

const writeManifestFile = (profileDir: string, bundles: readonly string[]) =>
  writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'web', dsh: { profile: { bundles: [...bundles] } } }))

const writeManifest = (profileDir: string, bundles: readonly string[]) => Effect.promise(() => writeManifestFile(profileDir, bundles))

/**
 * The marketplace over the real catalog and service layers: the Hub is a fixed fetch answer, the CLI a fixed outcome,
 * and the Profile a scratch harness home so no test reads the real `~/.dsh`.
 */
const marketplaceLayer = (input: {
  readonly home: string
  readonly profileDir: string
  readonly bundles: () => readonly string[]
  readonly fetcher: typeof fetch
  readonly hubBaseUrl?: string
  readonly runCli?: () => Effect.Effect<CliResult>
}) =>
  MarketplaceService.layer.pipe(
    Layer.provideMerge(MarketplaceCatalog.layer),
    Layer.provideMerge(
      Layer.effect(
        MarketplaceFiles,
        Effect.map(MarketplaceFiles, files =>
          MarketplaceFiles.of({ ...files, dshCli: Effect.succeed({ cliPath: '/installation/dsh/lib/bin.js', version: '0.1.5' }) }),
        ),
      ).pipe(
        Layer.provide(MarketplaceFiles.makeLayer({ harnessHome: input.home }).pipe(Layer.provide(nodeFileSystemLayer), Layer.provide(nodePathLayer))),
      ),
    ),
    Layer.provideMerge(Layer.succeed(MarketplaceProcesses, MarketplaceProcesses.of({ runCli: () => input.runCli?.() ?? Effect.succeed(cliResult()) }))),
    Layer.provide(marketplaceSettingsTestLayer({ hubBaseUrl: input.hubBaseUrl ?? 'https://hub.example.test' })),
    Layer.provide(HostContext.layer({ ctx: { baseUrl: pathToFileURL(input.profileDir).href } as never, packageId: '@dshfiles/plugin-marketplace' })),
    Layer.provide(FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, input.fetcher)))),
  )

type CliResult = CliRunResult

const serviceIn = <R>(layer: Layer.Layer<MarketplaceService, never, R>) =>
  Effect.map(Layer.build(layer), context => Context.get(context, MarketplaceService))

describe('Framework Hub response validation', () => {
  it.effect('accepts the previous list response shape and rejects more than one page', () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(hubListResponseSchema)({ items: [], nextCursor: null })
      expect(decoded.categories).toEqual([])
      const tooMany = yield* Effect.flip(
        Schema.decodeUnknownEffect(hubListResponseSchema)({ items: Array.from({ length: 25 }, () => card()), nextCursor: null }),
      )
      expect(tooMany._tag).toBe('SchemaError')
    }),
  )
})

describe('MarketplaceService.list', () => {
  it.effect('forwards locale, category and cursor, and returns categories, install state and compatibility', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchHome()
      yield* writeManifest(scratch.profileDir, ['@fixture/community-tool'])
      const github = hub([() => jsonResponse({ items: [card()], categories: [{ slug: 'tools', name: '工具' }], nextCursor: 'next-page' })])
      const service = yield* serviceIn(marketplaceLayer({ ...scratch, bundles: () => ['@fixture/community-tool'], fetcher: github.fetcher })).pipe(Effect.scoped)

      const result = yield* service.list({ locale: 'zh', category: 'tools', cursor: 'cursor-one' })

      expect(result.categories).toEqual([{ slug: 'tools', name: '工具' }])
      expect(result.items[0]).toMatchObject({ installed: true, compatibility: 'compatible' })
      expect(result.items[0]?.iconUrl).toBe('https://hub.example.test/api/media/icon')
      const url = github.requests[0]
      expect(url?.pathname).toBe('/api/marketplace/plugins')
      expect(Object.fromEntries(url?.searchParams ?? new URLSearchParams())).toMatchObject({
        locale: 'zh',
        category: 'tools',
        cursor: 'cursor-one',
        limit: '24',
        sort: 'latest',
      })
    }),
  )

  it.effect('forwards search and sort and exposes author, avatar, stars, update date and total', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchHome()
      yield* writeManifest(scratch.profileDir, ['@fixture/installed'])
      const github = hub([
        () =>
          jsonResponse({
            items: [
              card({ author: 'octo', stars: 42, updated: '2026-10-01', publisher: { login: 'octo', avatarUrl: 'https://avatars.example.test/u/1' } }),
              card({ slug: 'plain', scope: '@fixture/plain', publisher: { avatarUrl: 'http://avatars.example.test/u/2' } }),
            ],
            nextCursor: null,
            total: 442,
          }),
      ])
      const service = yield* serviceIn(marketplaceLayer({ ...scratch, bundles: () => ['@fixture/installed'], fetcher: github.fetcher })).pipe(Effect.scoped)

      const result = yield* service.list({ locale: 'en', query: 'sidebar', sort: 'stars' })

      expect(github.requests[0]?.searchParams.get('q')).toBe('sidebar')
      expect(github.requests[0]?.searchParams.get('sort')).toBe('stars')
      expect(result.total).toBe(442)
      expect(result.items.map(item => [item.author, item.avatarUrl, item.stars, item.updated])).toStrictEqual([
        ['octo', 'https://avatars.example.test/u/1', 42, '2026-10-01'],
        [null, null, null, null],
      ])
    }),
  )

  it.effect('distinguishes an unknown range from a valid unsatisfied range', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchHome()
      yield* writeManifest(scratch.profileDir, ['@fixture/installed'])
      const github = hub([() => jsonResponse({ items: [card({ compat: 'not-semver' }), card({ slug: 'future', compat: '>=9' })], nextCursor: null })])
      const service = yield* serviceIn(marketplaceLayer({ ...scratch, bundles: () => ['@fixture/installed'], fetcher: github.fetcher })).pipe(Effect.scoped)

      const result = yield* service.list({ locale: 'en' })

      expect(result.items).toEqual([
        expect.objectContaining({ slug: 'community-tool', compatibility: 'unknown' }),
        expect.objectContaining({ slug: 'future', compatibility: 'incompatible' }),
      ])
    }),
  )
})

describe('MarketplaceService.install', () => {
  const installing = (input: {
    readonly hubAnswers: ReadonlyArray<() => Response>
    readonly bundles?: () => readonly string[]
    readonly runCli?: () => Effect.Effect<CliResult>
  }) =>
    Effect.gen(function* () {
      const scratch = yield* scratchHome()
      yield* writeManifest(scratch.profileDir, (input.bundles ?? (() => ['@fixture/installed']))())
      const github = hub(input.hubAnswers)
      const service = yield* serviceIn(marketplaceLayer({ ...scratch, bundles: input.bundles ?? (() => ['@fixture/installed']), fetcher: github.fetcher, ...(input.runCli !== undefined && { runCli: input.runCli }) })).pipe(Effect.scoped)
      return { service, github, scratch }
    })

  it.effect('is idempotent when the exact bundle is already active', () =>
    Effect.gen(function* () {
      const { service } = yield* installing({ hubAnswers: [() => jsonResponse(detail())], bundles: () => ['@fixture/community-tool'] })
      const result = yield* service.install('community-tool')
      expect(result).toMatchObject({ status: 'already-installed', packageName: '@fixture/community-tool', restartRequired: true })
    }),
  )

  it.effect('validates the exact active target before reporting an installed bundle', () =>
    Effect.gen(function* () {
      const { service } = yield* installing({
        hubAnswers: [
          () => jsonResponse(detail({ installTargets: [{ ...detail().installTargets[0], package_name: '@fixture/other' }] })),
        ],
        bundles: () => ['@fixture/community-tool'],
      })
      expect(yield* service.install('community-tool')).toMatchObject({ status: 'failed', code: 'target-unavailable' })
    }),
  )

  it.effect('installs a verified target and verifies activation', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchHome()
      yield* writeManifest(scratch.profileDir, ['@fixture/installed'])
      const github = hub([() => jsonResponse(detail())])
      const service = yield* serviceIn(
        marketplaceLayer({
          ...scratch,
          bundles: () => ['@fixture/installed'],
          fetcher: github.fetcher,
          runCli: () => Effect.promise(async () => {
            await writeManifestFile(scratch.profileDir, ['@fixture/installed', '@fixture/community-tool'])
            return cliResult()
          }),
        }),
      ).pipe(Effect.scoped)
      expect(yield* service.install('community-tool')).toMatchObject({ status: 'installed', version: '1.2.3', restartRequired: true })
    }),
  )

  it.effect('rejects inactive, mismatched, mutable and unverifiable targets', () =>
    Effect.gen(function* () {
      const inactive = yield* installing({ hubAnswers: [() => jsonResponse(detail({ installTargets: [{ ...detail().installTargets[0], status: 'disabled' }] }))] })
      expect(yield* inactive.service.install('community-tool')).toMatchObject({ code: 'target-unavailable' })

      const mutable = yield* installing({ hubAnswers: [() => jsonResponse(detail({ installTargets: [{ ...detail().installTargets[0], spec: '@fixture/community-tool@latest' }] }))] })
      expect(yield* mutable.service.install('community-tool')).toMatchObject({ code: 'target-unavailable' })

      const unactivated = yield* installing({ hubAnswers: [() => jsonResponse(detail())] })
      expect(yield* unactivated.service.install('community-tool')).toMatchObject({ code: 'activation-missing' })
    }),
  )

  const cliFailures = [
    ['timeout', cliResult({ timedOut: true }), 'timeout'],
    ['cancel', cliResult({ cancelled: true }), 'cancelled'],
    ['CLI failure', cliResult({ exitCode: 2, stderr: 'private local path' }), 'install-failed'],
  ] as const

  for (const [label, result, code] of cliFailures) {
    it.effect(`maps ${label} to the ${code} code`, () =>
      Effect.gen(function* () {
        const scratch = yield* scratchHome()
        yield* writeManifest(scratch.profileDir, ['@fixture/installed'])
        const github = hub([() => jsonResponse(detail())])
        const service = yield* serviceIn(
          marketplaceLayer({ ...scratch, bundles: () => ['@fixture/installed'], fetcher: github.fetcher, runCli: () => Effect.succeed(result) }),
        ).pipe(Effect.scoped)
        expect(yield* service.install('community-tool')).toEqual({ status: 'failed', code, retryable: true })
      }),
    )
  }

  it.effect('falls back to the legacy list route when an old Hub reports a list-level 404', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchHome()
      yield* writeManifest(scratch.profileDir, ['@fixture/installed'])
      const github = hub([() => jsonResponse({}, 404), () => jsonResponse({ items: [card()], nextCursor: null })])
      const service = yield* serviceIn(marketplaceLayer({ ...scratch, bundles: () => ['@fixture/installed'], fetcher: github.fetcher })).pipe(Effect.scoped)

      const result = yield* service.list({ locale: 'en' })

      expect(result.items).toHaveLength(1)
      expect(github.requests.map(url => url.pathname)).toEqual(['/api/marketplace/plugins', '/api/plugins'])
    }),
  )

  it.effect('fails closed instead of treating a dedicated API 500 as an old Hub', () =>
    Effect.gen(function* () {
      const scratch = yield* scratchHome()
      yield* writeManifest(scratch.profileDir, ['@fixture/installed'])
      const github = hub([() => jsonResponse({}, 500)])
      const service = yield* serviceIn(marketplaceLayer({ ...scratch, bundles: () => ['@fixture/installed'], fetcher: github.fetcher })).pipe(Effect.scoped)

      const error = yield* Effect.flip(service.list({ locale: 'en' }))

      expect(error._tag).toBe('MarketplaceFailed')
      expect(github.requests).toHaveLength(1)
    }),
  )
})
