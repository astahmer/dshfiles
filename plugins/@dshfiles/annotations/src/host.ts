import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { annotationsApi } from './api.js'
import { INGEST_PATH, PAIR_PATH } from './limits.js'
import { createIngestHandler } from './ingest.js'
import { BundleSources, type SourceResolver } from './source.js'
import { EXTENSION_ID, extensionOrigins } from './extension.js'
import { createPairHandler, createPairing, type Pairing } from './pairing.js'
import { readPreview } from './preview.js'
import { annotationsSettings } from './settings.js'
import { ChromeCdp } from './chrome-cdp.js'
import { ChromeLaunch } from './chrome-launch.js'
import { annotationsDomain, createAnnotationStore, type AnnotationStore, type StoreResult } from './store.js'
import type { AnnotationDraft, AnnotationOrigin, AnnotationTarget } from './schema.js'

interface OpenedAnnotations {
  readonly store: AnnotationStore
  readonly resolver: SourceResolver
  readonly pairing: Pairing
  readonly roots: readonly string[]
  readonly close: () => Promise<void>
}

interface AnnotationsHostService {
  readonly annotationsFor: () => Promise<OpenedAnnotations>
  readonly closeAnnotations: () => Promise<void>
  readonly registerRoutes: () => (() => void)[]
}

class AnnotationsHost extends EffectContext.Service<AnnotationsHost, AnnotationsHostService>()('@dshfiles/annotations/Host') {}

class AnnotationsHostError extends Schema.TaggedError<AnnotationsHostError>()('AnnotationsHostError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

const defaultSettings = annotationsSettings.schema({})
let settingsScope: SettingsScope<typeof defaultSettings> | undefined

const currentSettings = () => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

/**
 * Only the browser this Host launched is ours to drive: an unrelated Chrome on the
 * configured port is reported as not running rather than adopted.
 */
const chromeState = async () => {
  const settings = currentSettings()
  const launched = ChromeLaunch.launchedChrome()
  const endpoint = launched === undefined ? ChromeCdp.endpointOf({ port: settings.cdpPort }) : launched.endpoint
  const reachable = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) })
    .then(response => response.ok)
    .catch(() => false)
  const pages = launched === undefined ? [] : await ChromeCdp.listPages({ endpoint })
  const executable = ChromeLaunch.chromeExecutable({ platform: process.platform, pathValue: process.env.PATH ?? '', configured: settings.chromePath })
  return {
    running: launched !== undefined && reachable,
    endpoint,
    executable: executable ?? '',
    pages: pages.map(page => ({ id: page.id, title: page.title, url: page.url })),
  }
}

const moduleUrl = import.meta.url

const openAnnotations = async (storage: NonNullable<ReturnType<Context['get']>>): Promise<OpenedAnnotations> => {
  const domain = await storage.open(annotationsDomain)
  const store = createAnnotationStore({
    annotations: domain.table('annotations'),
    unassigned: domain.table('unassigned'),
    meta: domain.table('meta'),
  })
  await store.flush()
  const roots = await BundleSources.discoverPluginRoots({ start: process.cwd(), env: process.env, ...(moduleUrl !== undefined && { moduleUrl }) })
  const pairing = createPairing({ token: () => store.token() })
  return { store, resolver: BundleSources.createSourceResolver({ roots }), pairing, roots, close: () => domain.close() }
}

const hostLayer = (ctx: Context) => {
  const storage = ctx.get('storageDomain')
  const webServer = ctx.get('webServer')
  if (storage === undefined) throw new Error('Annotation storage is unavailable.')
  let opening: Promise<OpenedAnnotations> | undefined
  const annotationsFor = (): Promise<OpenedAnnotations> => {
    if (opening === undefined) {
      const started = openAnnotations(storage)
      opening = started
      void started.catch(() => {
        if (opening === started) opening = undefined
      })
    }
    return opening
  }
  const closeAnnotations = async (): Promise<void> => {
    if (opening === undefined) return
    const opened = await opening.then(
      value => value,
      () => undefined,
    )
    opening = undefined
    if (opened === undefined) return
    await opened.store.flush()
    await opened.close()
  }
  const registerRoutes = (): (() => void)[] => {
    if (webServer === undefined) return []
    const unregisterIngest = webServer.register({
      kind: 'exact',
      path: INGEST_PATH,
      handler: createIngestHandler({
        token: async () => (await annotationsFor()).store.token(),
        allowedOrigins: () => extensionOrigins({ env: process.env }),
        ingest: async ({ drafts, extensionOrigin }) => {
          const { store, resolver } = await annotationsFor()
          const enriched = await enrich({ resolver, drafts })
          return store.ingest({ drafts: enriched, extensionOrigin })
        },
      }),
    })
    const unregisterPair = webServer.register({
      kind: 'exact',
      path: PAIR_PATH,
      handler: async (request, response) => {
        const { pairing } = await annotationsFor()
        return createPairHandler({ pairing, allowedOrigins: () => extensionOrigins({ env: process.env }) })(request, response)
      },
    })
    return [unregisterIngest, unregisterPair]
  }
  return Layer.succeed(AnnotationsHost, AnnotationsHost.of({ annotationsFor, closeAnnotations, registerRoutes }))
}

const unwrap = <Value>(result: StoreResult<Value>): Value => {
  if (result.ok) return result.value
  throw new Error(`annotations ${result.error}`)
}

const sourceFor = async ({ resolver, target }: { readonly resolver: SourceResolver; readonly target: AnnotationTarget }): Promise<AnnotationTarget> => {
  if (target.source !== undefined) return target
  try {
    const names = BundleSources.classCandidates(target.selector)
    if (names.length > 0) {
      const hit = (await resolver.resolve(names))[0]
      if (hit !== undefined) {
        return { ...target, source: { file: hit.file, line: hit.line, column: hit.column, confidence: hit.confidence } }
      }
    }
    const text = target.text
    if (text !== undefined && text.length >= 3) {
      const hit = (await resolver.resolveText([text]))[0]
      if (hit !== undefined) {
        return { ...target, source: { file: hit.file, line: hit.line, column: hit.column, confidence: hit.confidence } }
      }
    }
  } catch {
    return target
  }
  return target
}

const enrich = async ({ resolver, drafts }: { readonly resolver: SourceResolver; readonly drafts: readonly AnnotationDraft[] }): Promise<AnnotationDraft[]> => {
  const enriched: AnnotationDraft[] = []
  for (const draft of drafts) {
    enriched.push({ ...draft, target: await sourceFor({ resolver, target: draft.target }) })
  }
  return enriched
}

const tryHost = <Value>(operation: string, run: () => Promise<Value>) =>
  Effect.tryPromise({
    try: run,
    catch: error => new AnnotationsHostError({ operation, message: error instanceof Error ? error.message : String(error) }),
  })

const { hostApi, setup } = DshxEffect.plugin({
  layer: hostLayer,
  setup: () =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      yield* tryHost('initialize', () => host.annotationsFor())
      yield* Effect.addFinalizer(() => Effect.promise(host.closeAnnotations))
      yield* Effect.acquireRelease(
        Effect.sync(() => host.registerRoutes()),
        unregister =>
          Effect.sync(() => {
            for (const remove of unregister) remove()
          }),
      )
    }),
})

const annotationsApiHost = hostApi(annotationsApi, {
  list: Effect.fn('annotations list')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('list', () => host.annotationsFor())
      const query = {
        sessionId: input.sessionId,
        ...(input.statuses !== undefined && { statuses: input.statuses }),
        ...(input.limit !== undefined && { limit: input.limit }),
      }
      return { annotations: store.list(query), counts: store.counts(input.sessionId) }
    }),
  ),
  create: Effect.fn('annotations create')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store, resolver } = yield* tryHost('create', () => host.annotationsFor())
      const drafts = yield* tryHost('create', () => enrich({ resolver, drafts: input.items }))
      const origin: AnnotationOrigin = input.origin ?? 'dsh'
      return { annotations: unwrap(yield* tryHost('create', () => store.create({ sessionId: input.sessionId, drafts, origin }))) }
    }),
  ),
  ack: Effect.fn('annotations acknowledge')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('ack', () => host.annotationsFor())
      const result = yield* tryHost('ack', () => store.ack({ sessionId: input.sessionId, ids: input.ids }))
      if (!result.ok) return { ok: false as const, error: result.error }
      return { ok: true as const, annotations: result.value }
    }),
  ),
  resolve: Effect.fn('annotations resolve')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('resolve', () => host.annotationsFor())
      const result = yield* tryHost('resolve', () =>
        store.resolve({
          sessionId: input.sessionId,
          id: input.id,
          revision: input.revision,
          resolvedBy: 'agent',
          ...(input.summary !== undefined && { summary: input.summary }),
        }),
      )
      if (!result.ok) return { ok: false as const, error: result.error }
      return { ok: true as const, annotation: result.value }
    }),
  ),
  dismiss: Effect.fn('annotations dismiss')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('dismiss', () => host.annotationsFor())
      const result = yield* tryHost('dismiss', () => store.dismiss({ sessionId: input.sessionId, id: input.id, reason: input.reason }))
      if (!result.ok) return { ok: false as const, error: result.error }
      return { ok: true as const, annotation: result.value }
    }),
  ),
  reply: Effect.fn('annotations reply')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('reply', () => host.annotationsFor())
      const result = yield* tryHost('reply', () => store.reply({ sessionId: input.sessionId, id: input.id, body: input.body, role: input.role ?? 'agent' }))
      if (!result.ok) return { ok: false as const, error: result.error }
      return { ok: true as const, annotation: result.value }
    }),
  ),
  stale: Effect.fn('annotations mark stale')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('stale', () => host.annotationsFor())
      const result = yield* tryHost('stale', () => store.markStale({ sessionId: input.sessionId, id: input.id, reason: input.reason }))
      if (!result.ok) return { ok: false as const, error: result.error }
      return { ok: true as const, annotation: result.value }
    }),
  ),
  setup: Effect.fn('annotations setup')(() =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { roots } = yield* tryHost('setup', () => host.annotationsFor())
      const root = roots[0]
      const settings = currentSettings()
      return {
        extensionPath: root === undefined ? '' : `${root}/annotations/extension`,
        extensionId: EXTENSION_ID,
        chromePath: ChromeLaunch.chromeExecutable({ platform: process.platform, pathValue: process.env.PATH ?? '', configured: settings.chromePath }) ?? '',
        pickActiveTab: settings.pickActiveTab,
        startUrl: settings.startUrl,
      }
    }),
  ),
  chromeStatus: Effect.fn('annotations chrome status')(() => tryHost('chrome status', chromeState)),
  chromeLaunch: Effect.fn('annotations launch chrome')(() =>
    Effect.gen(function* () {
      const settings = currentSettings()
      const executable = ChromeLaunch.chromeExecutable({ platform: process.platform, pathValue: process.env.PATH ?? '', configured: settings.chromePath })
      if (executable === undefined)
        return yield* Effect.fail(
          new AnnotationsHostError({ operation: 'chrome launch', message: 'No Chrome or Chromium found. Set its path in the annotations settings.' }),
        )
      yield* tryHost('chrome launch', () =>
        ChromeLaunch.launchChrome({
          executable,
          port: settings.cdpPort,
          profileDir: settings.profileDir.trim().length > 0 ? settings.profileDir : ChromeLaunch.defaultProfileDir({ dshHome: process.env.DSH_HOME }),
          ...(settings.startUrl.trim().length > 0 && { startUrl: settings.startUrl }),
          headless: process.env.DSH_ANNOTATIONS_CHROME_HEADLESS === '1',
        }),
      )
      return yield* tryHost('chrome status', chromeState)
    }),
  ),
  chromeStop: Effect.fn('annotations stop chrome')(() =>
    Effect.gen(function* () {
      ChromeLaunch.stopChrome()
      return yield* tryHost('chrome status', chromeState)
    }),
  ),
  chromePick: Effect.fn('annotations pick chrome element')(({ input }) =>
    tryHost('chrome pick', async () => {
      const settings = currentSettings()
      const launched = ChromeLaunch.launchedChrome()
      if (launched === undefined) return { ok: false as const, reason: 'no-page' as const }
      const pages = await ChromeCdp.listPages({ endpoint: launched.endpoint })
      const requested = input.pageId === undefined ? undefined : pages.find(candidate => candidate.id === input.pageId)
      const focused = input.pageId === undefined ? await ChromeCdp.focusedPageId({ pages }) : undefined
      const page = requested ?? ChromeCdp.choosePage({ pages, ...(focused !== undefined && { focusedId: focused }) })
      if (page === undefined) return { ok: false as const, reason: 'no-page' as const }
      const outcome = await ChromeCdp.pickOnPage({ page, timeoutMs: settings.pickTimeoutSeconds * 1_000 })
      return outcome.ok ? { ok: true as const, target: outcome.target, point: outcome.point } : { ok: false as const, reason: outcome.reason }
    }),
  ),
  pair: Effect.fn('annotations pair extension')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { pairing } = yield* tryHost('pair', () => host.annotationsFor())
      return input.action === 'arm' ? pairing.arm() : pairing.status()
    }),
  ),
  preview: Effect.fn('annotations read preview')(({ input }) =>
    tryHost('preview', async () => {
      const result = await readPreview({ root: process.cwd(), path: input.path })
      return result.ok ? { ok: true as const, ...result.value } : { ok: false as const, error: result.error }
    }),
  ),
  source: Effect.fn('annotations resolve source')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { resolver } = yield* tryHost('source', () => host.annotationsFor())
      return { matches: yield* tryHost('source', () => resolver.resolve(input.names)) }
    }),
  ),
  intake: Effect.fn('annotations list intake')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('intake', () => host.annotationsFor())
      return { items: store.intake().slice(0, input.limit ?? 100) }
    }),
  ),
  attach: Effect.fn('annotations attach')(({ input }) =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('attach', () => host.annotationsFor())
      const result = yield* tryHost('attach', () => store.attach({ sessionId: input.sessionId, ids: input.ids }))
      if (!result.ok) return { ok: false as const, error: result.error }
      return { ok: true as const, annotations: result.value }
    }),
  ),
  token: Effect.fn('annotations read token')(() =>
    Effect.gen(function* () {
      const host = yield* AnnotationsHost
      const { store } = yield* tryHost('token', () => host.annotationsFor())
      return { token: store.token(), createdAt: Date.now() }
    }),
  ),
})

const ownedSettings = annotationsSettings.host({
  setup: scope => {
    settingsScope = scope
    return () => {
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

export default defineHost({
  name: '@dshfiles/annotations',
  inject: ['storageDomain'],
  apis: [annotationsApiHost],
  settings: [ownedSettings],
  setup,
})
