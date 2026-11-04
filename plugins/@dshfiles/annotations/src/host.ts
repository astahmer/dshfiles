import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { NodeFileSystem } from '@effect/platform-node'
import { Clock, Duration, Effect, Layer, Option } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { annotationsApi } from './api.js'
import { choosePage, focusedPageId, listPages, pickOnPage, endpointOf } from './chrome-cdp.js'
import { ChromeController, ChromeLaunchFailed, chromeExecutable, defaultProfileDir, devtoolsReachable } from './chrome-launch.js'
import { EXTENSION_ID } from './extension.js'
import { enrichDrafts } from './enrich.js'
import { ExtensionRoutes } from './extension-routes.js'
import { AnnotationsSettings, AnnotationsSettingsLive } from './settings-service.js'
import { readPreview } from './preview.js'
import type { AnnotationOrigin } from './schema.js'
import { SourceResolver } from './source.js'
import { annotationsSettings } from './settings.js'
import { AnnotationStore, type StoreFailure } from './store.js'

const storeCode = {
  AnnotationNotFound: 'missing',
  AnnotationRevisionConflict: 'revision',
  AnnotationLimitReached: 'limit',
  AnnotationClosed: 'status',
} as const satisfies Record<StoreFailure['_tag'], string>

/** A store outcome as the API's `{ ok, error }` union: every store failure is an answer, never an exception. */
const outcome = <A, Key extends string>(key: Key, effect: Effect.Effect<A, StoreFailure>) =>
  effect.pipe(
    Effect.map(value => ({ ok: true as const, ...({ [key]: value } as Record<Key, A>) })),
    Effect.catch(error => Effect.succeed({ ok: false as const, error: storeCode[error._tag] })),
  )

const executableFor = Effect.gen(function* () {
  const settings = yield* AnnotationsSettings.use(service => service.get)
  return yield* chromeExecutable({ platform: process.platform, pathValue: process.env.PATH ?? '', configured: settings.chromePath })
})

/**
 * Only the browser this Host launched is ours to drive: an unrelated Chrome on the
 * configured port is reported as not running rather than adopted.
 */
const chromeState = Effect.fn('annotations chrome state')(function* () {
  const settings = yield* AnnotationsSettings.use(service => service.get)
  const launched = yield* ChromeController.use(controller => controller.launched)
  const endpoint = Option.match(launched, { onNone: () => endpointOf({ port: settings.cdpPort }), onSome: chrome => chrome.endpoint })
  const reachable = yield* devtoolsReachable({ endpoint, timeout: Duration.seconds(1) })
  const pages = Option.isNone(launched) ? [] : yield* listPages({ endpoint })
  return {
    running: Option.isSome(launched) && reachable,
    endpoint,
    executable: Option.getOrElse(yield* executableFor, () => ''),
    pages: pages.map(page => ({ id: page.id, title: page.title, url: page.url })),
  }
})

const AnnotationsLive = ExtensionRoutes.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      AnnotationStore.layer,
      SourceResolver.layer({ moduleUrl: import.meta.url }),
      ChromeController.layer.pipe(Layer.provide(DshChildProcessSpawner.layer)),
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, AnnotationsSettingsLive, NodeFileSystem.layer, FetchHttpClient.layer)),
)

export default DshxPlugin.make({
  name: '@dshfiles/annotations',
  inject: ['storageDomain', 'subprocess'],
  settings: [annotationsSettings],
  layer: AnnotationsLive,
  apis: [
    Api.bind(annotationsApi, {
      list: Effect.fn('annotations list')(function* (input) {
        const store = yield* AnnotationStore
        const query = {
          sessionId: input.sessionId,
          ...(input.statuses !== undefined && { statuses: input.statuses }),
          ...(input.limit !== undefined && { limit: input.limit }),
        }
        return { annotations: yield* store.list(query), counts: yield* store.counts(input.sessionId) }
      }),
      create: Effect.fn('annotations create')(function* (input) {
        const store = yield* AnnotationStore
        const drafts = yield* enrichDrafts(input.items)
        const origin: AnnotationOrigin = input.origin ?? 'dsh'
        return { annotations: yield* store.create({ sessionId: input.sessionId, drafts, origin }) }
      }),
      ack: input => AnnotationStore.use(store => outcome('annotations', store.ack({ sessionId: input.sessionId, ids: input.ids }))),
      resolve: input =>
        AnnotationStore.use(store =>
          outcome(
            'annotation',
            store.resolve({
              sessionId: input.sessionId,
              id: input.id,
              revision: input.revision,
              resolvedBy: 'agent',
              ...(input.summary !== undefined && { summary: input.summary }),
            }),
          ),
        ),
      dismiss: input => AnnotationStore.use(store => outcome('annotation', store.dismiss({ sessionId: input.sessionId, id: input.id, reason: input.reason }))),
      reply: input =>
        AnnotationStore.use(store =>
          outcome('annotation', store.reply({ sessionId: input.sessionId, id: input.id, body: input.body, role: input.role ?? 'agent' })),
        ),
      stale: input => AnnotationStore.use(store => outcome('annotation', store.markStale({ sessionId: input.sessionId, id: input.id, reason: input.reason }))),
      setup: Effect.fn('annotations setup')(function* () {
        const settings = yield* AnnotationsSettings.use(service => service.get)
        const root = (yield* SourceResolver.use(resolver => resolver.roots))[0]
        return {
          extensionPath: root === undefined ? '' : `${root}/annotations/extension`,
          extensionId: EXTENSION_ID,
          chromePath: Option.getOrElse(yield* executableFor, () => ''),
          pickActiveTab: settings.pickActiveTab,
          startUrl: settings.startUrl,
        }
      }),
      chromeStatus: () => chromeState(),
      chromeLaunch: Effect.fn('annotations launch chrome')(function* () {
        const settings = yield* AnnotationsSettings.use(service => service.get)
        const executable = yield* executableFor
        if (Option.isNone(executable)) return yield* new ChromeLaunchFailed({ reason: 'no-executable', port: settings.cdpPort })
        yield* ChromeController.use(controller =>
          controller.launch({
            executable: executable.value,
            port: settings.cdpPort,
            profileDir: settings.profileDir.trim().length > 0 ? settings.profileDir : defaultProfileDir({ dshHome: process.env.DSH_HOME }),
            startUrl: settings.startUrl,
            headless: process.env.DSH_ANNOTATIONS_CHROME_HEADLESS === '1',
          }),
        )
        return yield* chromeState()
      }),
      chromeStop: Effect.fn('annotations stop chrome')(function* () {
        yield* ChromeController.use(controller => controller.stop)
        return yield* chromeState()
      }),
      chromePick: Effect.fn('annotations pick chrome element')(function* (input) {
        const settings = yield* AnnotationsSettings.use(service => service.get)
        const launched = yield* ChromeController.use(controller => controller.launched)
        if (Option.isNone(launched)) return { ok: false as const, reason: 'no-page' as const }
        const pages = yield* listPages({ endpoint: launched.value.endpoint })
        const requested = input.pageId === undefined ? undefined : pages.find(candidate => candidate.id === input.pageId)
        const focused = input.pageId === undefined ? Option.getOrUndefined(yield* focusedPageId({ pages })) : undefined
        const page = requested ?? choosePage({ pages, focusedId: focused })
        if (page === undefined) return { ok: false as const, reason: 'no-page' as const }
        const picked = yield* pickOnPage({ page, timeout: Duration.seconds(settings.pickTimeoutSeconds) })
        return picked.ok ? { ok: true as const, target: picked.target, point: picked.point } : { ok: false as const, reason: picked.reason }
      }),
      pair: input => ExtensionRoutes.use(routes => (input.action === 'arm' ? routes.arm : routes.status)),
      preview: Effect.fn('annotations preview')(function* (input) {
        const result = yield* readPreview({ root: process.cwd(), path: input.path })
        return result.ok ? { ok: true as const, ...result.value } : { ok: false as const, error: result.error }
      }),
      source: input => SourceResolver.use(resolver => Effect.map(resolver.resolve(input.names), matches => ({ matches }))),
      intake: input => AnnotationStore.use(store => Effect.map(store.intake, items => ({ items: items.slice(0, input.limit ?? 100) }))),
      attach: input => AnnotationStore.use(store => outcome('annotations', store.attach({ sessionId: input.sessionId, ids: input.ids }))),
      token: Effect.fn('annotations read token')(function* () {
        return { token: yield* AnnotationStore.use(store => store.token), createdAt: yield* Clock.currentTimeMillis }
      }),
    }),
  ],
})
