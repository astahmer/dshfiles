import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { Api, DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { NodeFileSystem } from '@effect/platform-node'
import { Clock, Context, Effect, Layer } from 'effect'
import { threadShareApi } from './share-api.js'
import { SharePage } from './share-page.js'
import type { ExpiryPreset } from './share-policy-constants.js'
import { SharePolicy } from './share-policy.js'
import { ROUTE_PATH, ShareGuard, serveShareRequest, sharePath } from './share-route.js'
import { ShareStore, rowOf } from './share-store.js'
import { ShareSessions, ShareThreads } from './transcript.js'
import { PublishExecutables, SharePublisher } from './tunnel.js'

const PACKAGE_ID = '@dshfiles/thread-share'

/** The Host's web server: the share route is registered on it for the plugin's Scope. */
class ShareWeb extends Context.Service<ShareWeb, { readonly server: WebServer }>()('@dshfiles/thread-share/ShareWeb') {
  static readonly layer = Layer.effect(
    ShareWeb,
    Effect.map(hostService('webServer'), server => ShareWeb.of({ server })),
  )
}

/** The share request handler bound to the plugin's services; the DSH route and a publish listener both call it. */
class ShareHandler extends Context.Service<ShareHandler, (request: IncomingMessage, response: ServerResponse) => void>()(
  '@dshfiles/thread-share/ShareHandler',
) {
  static readonly layer = Layer.effect(
    ShareHandler,
    DshxPlugin.callback((request: IncomingMessage, response: ServerResponse) => serveShareRequest({ request, response })),
  )
}

const ShareSessionsLive = Layer.effect(
  ShareSessions,
  Effect.gen(function* () {
    const host = yield* HostContext
    return Api.client({ contract: sessionsApi, api: createHostApiClient(host.ctx, sessionsApi, PACKAGE_ID) })
  }),
)

/** Serve `/thread-share/...` on the DSH web server while the plugin is active. */
const ShareRouteLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const web = yield* ShareWeb
    const handler = yield* ShareHandler
    yield* Effect.acquireRelease(
      Effect.sync(() => web.server.register({ kind: 'prefix', path: ROUTE_PATH, handler })),
      unregister => Effect.sync(unregister),
    )
  }),
)

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'thread'

const linksFor = Effect.fn('thread share links')(function* (path: string) {
  const web = yield* ShareWeb
  const publisher = yield* SharePublisher
  const status = yield* publisher.status
  const links: Array<{ label: string; url: string }> = []
  if (web.server.port !== undefined) links.push({ label: 'DSH server', url: `${web.server.getOrigin()}${path}` })
  if (status.active?.publicUrl != null && status.active.state === 'published')
    links.push({ label: `Public (${status.active.provider})`, url: `${status.active.publicUrl}${path}` })
  return links
})

const createShare = Effect.fn('thread share create')(function* (input: {
  readonly sessionId: string
  readonly kind: 'live' | 'snapshot'
  readonly access: 'link' | 'protected'
  readonly passphrase?: string | undefined
  readonly expiry: ExpiryPreset
}) {
  yield* Effect.annotateCurrentSpan({
    'dshx.thread_share.kind': input.kind,
    'dshx.thread_share.access': input.access,
    'dshx.thread_share.expiry': input.expiry,
  })
  const threads = yield* ShareThreads
  const store = yield* ShareStore
  const now = yield* Clock.currentTimeMillis
  const transcript = yield* threads.read(input.sessionId)
  const passphrase = input.access === 'protected' && input.passphrase !== undefined ? yield* SharePolicy.hashPassphrase(input.passphrase) : null
  const token = SharePolicy.generateToken()
  const record = yield* store.create({
    sessionId: input.sessionId,
    title: transcript.title,
    kind: input.kind,
    access: input.access,
    passphrase,
    createdAt: now,
    expiresAt: SharePolicy.expiresAt({ preset: input.expiry, now }),
    token,
    snapshot: input.kind === 'snapshot' ? { capturedAt: now, truncated: transcript.truncated, entries: transcript.entries } : null,
  })
  const path = sharePath(token)
  return { share: rowOf(record, now), path, links: yield* linksFor(path) }
})

const revokeShare = Effect.fn('thread share revoke')(function* (id: string) {
  const store = yield* ShareStore
  const guard = yield* ShareGuard
  const record = yield* store.revoke(id)
  for (const [grant, value] of guard.grants) if (value.shareId === id) guard.grants.delete(grant)
  return { share: rowOf(record, yield* Clock.currentTimeMillis) }
})

const exportHtml = Effect.fn('thread share export')(function* (sessionId: string) {
  const threads = yield* ShareThreads
  const transcript = yield* threads.read(sessionId)
  const now = yield* Clock.currentTimeMillis
  const html = SharePage.transcript({
    title: transcript.title,
    entries: transcript.entries,
    mode: 'export',
    capturedAt: now,
    expiresAt: null,
    truncated: transcript.truncated,
  })
  return { fileName: `${slug(transcript.title)}.html`, html }
})

const listShares = Effect.fn('thread share list read')(function* (includeInactive: boolean) {
  const store = yield* ShareStore
  const now = yield* Clock.currentTimeMillis
  const rows = (yield* store.list).map(record => rowOf(record, now))
  return { shares: includeInactive ? rows : rows.filter(row => row.status === 'active'), routePath: `${ROUTE_PATH}/s/` }
})

const ShareLive = ShareRouteLive.pipe(
  Layer.provideMerge(ShareHandler.layer),
  Layer.provideMerge(
    SharePublisher.layer.pipe(Layer.provide(Layer.mergeAll(PublishExecutables.layer.pipe(Layer.provide(NodeFileSystem.layer)), DshChildProcessSpawner.layer))),
  ),
  Layer.provideMerge(ShareThreads.layer.pipe(Layer.provide(ShareSessionsLive))),
  Layer.provideMerge(Layer.mergeAll(ShareStore.layer, ShareGuard.layer, ShareWeb.layer)),
)

export default DshxPlugin.make({
  name: 'dshfiles-thread-share',
  inject: ['webServer', 'subprocess'],
  layer: ShareLive,
  apis: [
    Api.bind(threadShareApi, {
      list: input => listShares(input.includeInactive),
      threads: () => ShareThreads.use(threads => Effect.map(threads.options, list => ({ threads: list }))),
      create: input => createShare(input),
      revoke: input => revokeShare(input.id),
      exportHtml: input => exportHtml(input.sessionId),
      publishStatus: () => SharePublisher.use(publisher => publisher.status),
      publishStart: input =>
        Effect.gen(function* () {
          const handler = yield* ShareHandler
          const publisher = yield* SharePublisher
          return yield* publisher.start({ provider: input.provider, minutes: input.minutes, handler })
        }),
      publishStop: () => SharePublisher.use(publisher => publisher.stop),
    }),
  ],
})
