import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { annotationsApi } from './api.js'
import { INGEST_PATH, PAIR_PATH } from './limits.js'
import { createIngestHandler } from './ingest.js'
import { classCandidates, createSourceResolver, discoverPluginRoots, type SourceResolver } from './source.js'
import { EXTENSION_ID, extensionOrigins } from './extension.js'
import { createPairHandler, createPairing, type Pairing } from './pairing.js'
import { readPreview } from './preview.js'
import { annotationsSettings } from './settings.js'
import { choosePage, endpointOf, focusedPageId, listPages, pickOnPage } from './chrome-cdp.js'
import { chromeExecutable, defaultProfileDir, launchChrome, launchedChrome, stopChrome } from './chrome-launch.js'
import { annotationsDomain, createAnnotationStore, type AnnotationStore, type StoreResult } from './store.js'
import type { AnnotationDraft, AnnotationOrigin, AnnotationTarget } from './schema.js'

interface OpenedAnnotations {
  readonly store: AnnotationStore
  readonly resolver: SourceResolver
  readonly pairing: Pairing
  readonly roots: readonly string[]
  readonly close: () => Promise<void>
}

let opening: Promise<OpenedAnnotations> | undefined

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
  const launched = launchedChrome()
  const endpoint = launched === undefined ? endpointOf({ port: settings.cdpPort }) : launched.endpoint
  const reachable = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) })
    .then(response => response.ok)
    .catch(() => false)
  const pages = launched === undefined ? [] : await listPages({ endpoint })
  const executable = chromeExecutable({ platform: process.platform, pathValue: process.env.PATH ?? '', configured: settings.chromePath })
  return {
    running: launched !== undefined && reachable,
    endpoint,
    executable: executable ?? '',
    pages: pages.map(page => ({ id: page.id, title: page.title, url: page.url })),
  }
}

const moduleUrl = import.meta.url

const openAnnotations = async (ctx: Context): Promise<OpenedAnnotations> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Annotation storage is unavailable.')
  const domain = await storage.open(annotationsDomain)
  const store = createAnnotationStore({
    annotations: domain.table('annotations'),
    unassigned: domain.table('unassigned'),
    meta: domain.table('meta'),
  })
  await store.flush()
  const roots = await discoverPluginRoots({ start: process.cwd(), env: process.env, ...(moduleUrl === undefined ? {} : { moduleUrl }) })
  const pairing = createPairing({ token: () => store.token() })
  return { store, resolver: createSourceResolver({ roots }), pairing, roots, close: () => domain.close() }
}

const annotationsFor = (ctx: Context): Promise<OpenedAnnotations> => {
  if (opening === undefined) {
    const started = openAnnotations(ctx)
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

const unwrap = <Value>(result: StoreResult<Value>): Value => {
  if (result.ok) return result.value
  throw new Error(`annotations ${result.error}`)
}

const sourceFor = async ({ resolver, target }: { readonly resolver: SourceResolver; readonly target: AnnotationTarget }): Promise<AnnotationTarget> => {
  if (target.source !== undefined) return target
  try {
    const names = classCandidates(target.selector)
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

const annotationsApiHost = annotationsApi.host({
  list: async ({ ctx, input }) => {
    const { store } = await annotationsFor(ctx)
    const query = {
      sessionId: input.sessionId,
      ...(input.statuses === undefined ? {} : { statuses: input.statuses }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }
    return { annotations: store.list(query), counts: store.counts(input.sessionId) }
  },
  create: async ({ ctx, input }) => {
    const { store, resolver } = await annotationsFor(ctx)
    const drafts = await enrich({ resolver, drafts: input.items })
    const origin: AnnotationOrigin = input.origin ?? 'dsh'
    return { annotations: unwrap(await store.create({ sessionId: input.sessionId, drafts, origin })) }
  },
  ack: async ({ ctx, input }) => {
    const { store } = await annotationsFor(ctx)
    const result = await store.ack({ sessionId: input.sessionId, ids: input.ids })
    if (!result.ok) return { ok: false as const, error: result.error }
    return { ok: true as const, annotations: result.value }
  },
  resolve: async ({ ctx, input }) => {
    const { store } = await annotationsFor(ctx)
    const result = await store.resolve({
      sessionId: input.sessionId,
      id: input.id,
      revision: input.revision,
      resolvedBy: 'agent',
      ...(input.summary === undefined ? {} : { summary: input.summary }),
    })
    if (!result.ok) return { ok: false as const, error: result.error }
    return { ok: true as const, annotation: result.value }
  },
  dismiss: async ({ ctx, input }) => {
    const { store } = await annotationsFor(ctx)
    const result = await store.dismiss({ sessionId: input.sessionId, id: input.id, reason: input.reason })
    if (!result.ok) return { ok: false as const, error: result.error }
    return { ok: true as const, annotation: result.value }
  },
  reply: async ({ ctx, input }) => {
    const { store } = await annotationsFor(ctx)
    const result = await store.reply({
      sessionId: input.sessionId,
      id: input.id,
      body: input.body,
      role: input.role ?? 'agent',
    })
    if (!result.ok) return { ok: false as const, error: result.error }
    return { ok: true as const, annotation: result.value }
  },
  stale: async ({ ctx, input }) => {
    const { store } = await annotationsFor(ctx)
    const result = await store.markStale({ sessionId: input.sessionId, id: input.id, reason: input.reason })
    if (!result.ok) return { ok: false as const, error: result.error }
    return { ok: true as const, annotation: result.value }
  },
  setup: async ({ ctx }) => {
    const { roots } = await annotationsFor(ctx)
    const root = roots[0]
    const settings = currentSettings()
    return {
      extensionPath: root === undefined ? '' : `${root}/annotations/extension`,
      extensionId: EXTENSION_ID,
      chromePath: chromeExecutable({ platform: process.platform, pathValue: process.env.PATH ?? '', configured: settings.chromePath }) ?? '',
      pickActiveTab: settings.pickActiveTab,
      startUrl: settings.startUrl,
    }
  },
  chromeStatus: async () => chromeState(),
  chromeLaunch: async () => {
    const settings = currentSettings()
    const executable = chromeExecutable({ platform: process.platform, pathValue: process.env.PATH ?? '', configured: settings.chromePath })
    if (executable === undefined) throw new Error('No Chrome or Chromium found. Set its path in the annotations settings.')
    await launchChrome({
      executable,
      port: settings.cdpPort,
      profileDir: settings.profileDir.trim().length > 0 ? settings.profileDir : defaultProfileDir({ dshHome: process.env.DSH_HOME }),
      ...(settings.startUrl.trim().length > 0 ? { startUrl: settings.startUrl } : {}),
      headless: process.env.DSH_ANNOTATIONS_CHROME_HEADLESS === '1',
    })
    return chromeState()
  },
  chromeStop: async () => {
    stopChrome()
    return chromeState()
  },
  chromePick: async ({ input }) => {
    const settings = currentSettings()
    const launched = launchedChrome()
    if (launched === undefined) return { ok: false as const, reason: 'no-page' as const }
    const pages = await listPages({ endpoint: launched.endpoint })
    const requested = input.pageId === undefined ? undefined : pages.find(candidate => candidate.id === input.pageId)
    const focused = input.pageId === undefined ? await focusedPageId({ pages }) : undefined
    const page = requested ?? choosePage({ pages, ...(focused === undefined ? {} : { focusedId: focused }) })
    if (page === undefined) return { ok: false as const, reason: 'no-page' as const }
    const outcome = await pickOnPage({ page, timeoutMs: settings.pickTimeoutSeconds * 1_000 })
    return outcome.ok ? { ok: true as const, target: outcome.target, point: outcome.point } : { ok: false as const, reason: outcome.reason }
  },
  pair: async ({ ctx, input }) => {
    const { pairing } = await annotationsFor(ctx)
    return input.action === 'arm' ? pairing.arm() : pairing.status()
  },
  preview: async ({ input }) => {
    const result = await readPreview({ root: process.cwd(), path: input.path })
    return result.ok ? { ok: true as const, ...result.value } : { ok: false as const, error: result.error }
  },
  source: async ({ ctx, input }) => {
    const { resolver } = await annotationsFor(ctx)
    return { matches: await resolver.resolve(input.names) }
  },
  intake: async ({ ctx, input }) => {
    const { store } = await annotationsFor(ctx)
    return { items: store.intake().slice(0, input.limit ?? 100) }
  },
  attach: async ({ ctx, input }) => {
    const { store } = await annotationsFor(ctx)
    const result = await store.attach({ sessionId: input.sessionId, ids: input.ids })
    if (!result.ok) return { ok: false as const, error: result.error }
    return { ok: true as const, annotations: result.value }
  },
  token: async ({ ctx }) => {
    const { store } = await annotationsFor(ctx)
    return { token: store.token(), createdAt: Date.now() }
  },
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
  setup: ctx => {
    ctx.effect(() => {
      const started = annotationsFor(ctx)
      void started.catch(() => undefined)
      return closeAnnotations
    }, 'annotations: store')
    ctx.effect(() => {
      const webServer = ctx.get('webServer')
      if (webServer === undefined) return () => undefined
      return webServer.register({
        kind: 'exact',
        path: INGEST_PATH,
        handler: createIngestHandler({
          token: async () => (await annotationsFor(ctx)).store.token(),
          allowedOrigins: () => extensionOrigins({ env: process.env }),
          ingest: async ({ drafts, extensionOrigin }) => {
            const { store, resolver } = await annotationsFor(ctx)
            const enriched = await enrich({ resolver, drafts })
            return store.ingest({ drafts: enriched, extensionOrigin })
          },
        }),
      })
    }, 'annotations: ingest route')
    ctx.effect(() => {
      const webServer = ctx.get('webServer')
      if (webServer === undefined) return () => undefined
      return webServer.register({
        kind: 'exact',
        path: PAIR_PATH,
        handler: async (request, response) => {
          const { pairing } = await annotationsFor(ctx)
          return createPairHandler({ pairing, allowedOrigins: () => extensionOrigins({ env: process.env }) })(request, response)
        },
      })
    }, 'annotations: pair route')
  },
})
