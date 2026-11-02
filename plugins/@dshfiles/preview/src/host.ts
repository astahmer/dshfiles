import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Effect, Layer } from 'effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { previewApi } from './api.js'
import { previewRenderApi, RenderHtmlLimits } from './render-api.js'
import { PreviewInactive, PreviewThreadRefused } from './preview-errors.js'
import { PreviewImages } from './preview-images-promise.js'
import { PreviewPages } from './preview-pages-promise.js'
import { PreviewDevServers } from './preview-dev-servers-promise.js'
import { PreviewJobs, signalProcess } from './preview-jobs.js'
import { previewSettings } from './settings.js'
import { previewSettingsLayer } from './preview-settings.js'
import { previewScreenshotTool } from './preview-tool.js'

const DEFAULT_SNAPSHOT_CHARS = 20_000
/** Base64 grows the JPEG by a third; this keeps the API output under dshx's 1 MB payload cap. */
const MAX_RENDER_IMAGE_BYTES = 700 * 1024

/** Agents act on their own thread only; a Client names the thread it shows. */
const ownThread = (call: { readonly caller: ApiCaller }, requested: string | undefined) =>
  Effect.gen(function* () {
    if (call.caller.kind === 'agent') {
      if (call.caller.sessionId === undefined) return yield* new PreviewThreadRefused({ reason: 'no-thread' })
      if (requested !== undefined && requested !== call.caller.sessionId)
        return yield* new PreviewThreadRefused({ reason: 'other-thread', sessionId: requested })
      return call.caller.sessionId
    }
    if (requested === undefined) return yield* new PreviewThreadRefused({ reason: 'no-thread' })
    return requested
  })

const previewHandlers = Api.handlers(previewApi, {
  open: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      const opened = yield* (pages.open({ sessionId, url: input.url, reveal: input.reveal ?? false }))
      yield* Api.publish({
        contract: previewApi,
        event: 'pagesChanged',
        payload: { sessionId, reveal: opened.revealRequestedAt === null ? null : { pageId: opened.pageId, url: opened.url, requestedAt: opened.revealRequestedAt } },
      }).pipe(Effect.catch(() => Effect.logDebug('preview: the page-change event was not published')))
      return opened
    }),
  navigate: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      const result = yield* (pages.navigate({ sessionId, pageId: input.pageId, url: input.url, action: input.action }))
      yield* Api.publish({ contract: previewApi, event: 'pagesChanged', payload: { sessionId, reveal: null } }).pipe(Effect.catch(() => Effect.logDebug('preview: the page-change event was not published')))
      return result
    }),
  reveal: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      const revealRequestedAt = yield* pages.revealRequest({ sessionId, pageId: input.pageId })
      const page = (yield* (pages.list(sessionId))).find(entry => entry.pageId === input.pageId)
      if (page !== undefined && revealRequestedAt !== null)
        yield* Api.publish({
          contract: previewApi,
          event: 'pagesChanged',
          payload: { sessionId, reveal: { pageId: page.pageId, url: page.url, requestedAt: revealRequestedAt } },
        }).pipe(Effect.catch(() => Effect.logDebug('preview: the page-change event was not published')))
      return { revealRequestedAt }
    }),
  snapshot: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      return yield* (pages.snapshot({ sessionId, pageId: input.pageId, maxChars: input.maxChars ?? DEFAULT_SNAPSHOT_CHARS }))
    }),
  click: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      return yield* pages.click({ sessionId, pageId: input.pageId, target: { ref: input.ref, selector: input.selector }, doubleClick: input.doubleClick ?? false })
    }),
  type: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      return yield* pages.type({ sessionId, pageId: input.pageId, target: { ref: input.ref, selector: input.selector }, text: input.text, submit: input.submit ?? false })
    }),
  evaluate: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      return yield* (pages.evaluate({ sessionId, pageId: input.pageId, expression: input.expression }))
    }),
  close: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      const result = yield* (pages.close({ sessionId, pageId: input.pageId }))
      yield* Api.publish({ contract: previewApi, event: 'pagesChanged', payload: { sessionId, reveal: null } }).pipe(Effect.catch(() => Effect.logDebug('preview: the page-change event was not published')))
      return result
    }),
  list: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const pages = yield* PreviewPages
      return { pages: yield* (pages.list(sessionId)) }
    }),
  devServers: (input, call) =>
    Effect.gen(function* () {
      const sessionId = call.caller.kind === 'agent' && input.sessionId !== undefined ? input.sessionId : yield* ownThread(call, input.sessionId)
      const probe = yield* PreviewDevServers.use(servers => servers.read(false))
      return { supported: probe.supported, servers: probe.servers.filter(server => server.sessionIds.includes(sessionId)) }
    }),
  stopDevServer: (input, call) =>
    Effect.gen(function* () {
      const sessionId = yield* ownThread(call, input.sessionId)
      const servers = yield* PreviewDevServers
      const { servers: listed } = yield* servers.read(true)
      const server = listed.find(candidate => candidate.pid === input.pid && candidate.startedAt === input.startedAt && candidate.sessionIds.includes(sessionId))
      if (server === undefined) return { outcome: 'missing' as const }
      yield* servers.invalidate
      if (server.jobId !== null) {
        const killed = yield* PreviewJobs.use(jobs => jobs.kill({ jobId: server.jobId ?? '', sessionId }))
        return { outcome: killed ? ('stopped-job' as const) : ('missing' as const) }
      }
      const signalled = yield* Effect.sync(() => signalProcess(server.pid, 'SIGTERM'))
      return { outcome: signalled ? ('signalled' as const) : ('missing' as const) }
    }),
})

export default DshxPlugin.make({
  name: '@dshfiles/preview',
  inject: ['subprocess', 'tools', 'attachments', 'jobs'],
  settings: [previewSettings],
  layer: Layer.mergeAll(PreviewPages.layer, PreviewDevServers.layer, PreviewImages.layer, PreviewJobs.layer).pipe(
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
    Layer.provide(DshChildProcessSpawner.layer),
    Layer.provideMerge(previewSettingsLayer),
  ),
  apis: [
    Api.bind(previewApi, previewHandlers),
    Api.bind(previewRenderApi, {
      screenshotHtml: (input, call) =>
        Effect.gen(function* () {
          if (call.caller.kind !== 'plugin') return yield* new PreviewInactive({ reason: 'plugin-only' })
          const pages = yield* PreviewPages
          const shot = yield* pages.renderHtml({
              document: input.document,
              width: input.width ?? RenderHtmlLimits.defaultWidth,
              height: input.height ?? RenderHtmlLimits.defaultHeight,
              fullPage: input.fullPage ?? false,
              colorScheme: input.colorScheme ?? 'light',
              maxImageBytes: MAX_RENDER_IMAGE_BYTES,
              maxFullPageHeight: RenderHtmlLimits.maxFullPageHeight,
            })
          return { image: Buffer.from(shot.image).toString('base64'), mediaType: 'image/jpeg' as const, width: shot.width, height: shot.height }
        }),
    }),
  ],
  tools: [previewScreenshotTool],
})
