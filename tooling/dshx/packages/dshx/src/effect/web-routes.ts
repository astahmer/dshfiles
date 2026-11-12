/**
 * Register a Host web-server route for a plugin's lifetime, surviving a Host bundle reload.
 *
 * A reload starts the rebuilt instance of a plugin while the old one still holds its routes: the old Scope closes only
 * after the new activation (see `storage-domain.ts`). The DSH web server refuses a second registration of a
 * (kind, path) with `webserver: duplicate exact route`, so a plugin that registered its route in a scoped layer failed
 * to reactivate, and the failure was fatal to the Host (annotations, composer redesign b:gyk7). Here the server sees
 * one registration per (server, kind, path): it dispatches to the newest holder, an older holder's release only drops
 * it from the list, and the last release removes the route. The registry lives on `globalThis` because each bundle
 * carries its own copy of this module.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Data, Effect, Schedule, type Scope } from 'effect'

/** The `node:http` handler a web-server route takes. */
export type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

/** One route registration, as the DSH web server's `register` takes it. */
export interface Route {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: RouteHandler
}

/** The part of the DSH web server this helper uses. */
export interface RouteServer {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: RouteHandler }): () => void
}

interface Shared {
  /** Holders in registration order; the last one answers. */
  readonly holders: { readonly handler: RouteHandler }[]
  readonly unregister: () => void
}

const SHARED_ROUTES = Symbol.for('@dshfiles/dshx/WebRoutes/shared')

const sharedRoutes = (): WeakMap<RouteServer, Map<string, Shared>> => {
  // SAFETY: the symbol key is private to this module, so only this function ever writes that globalThis slot.
  const holder = globalThis as { [SHARED_ROUTES]?: WeakMap<RouteServer, Map<string, Shared>> }
  holder[SHARED_ROUTES] ??= new WeakMap()
  return holder[SHARED_ROUTES]
}

/**
 * Add one holder of a route; the first holder registers it on the server.
 * @returns the release: drops this holder, and unregisters the route once no holder is left.
 */
export const holdRoute = (server: RouteServer, route: Route): (() => void) => {
  const byServer = sharedRoutes()
  const routes = byServer.get(server) ?? new Map<string, Shared>()
  byServer.set(server, routes)
  const key = `${route.kind} ${route.path}`
  const entry = { handler: route.handler }
  let shared = routes.get(key)
  if (shared === undefined) {
    const holders: { readonly handler: RouteHandler }[] = []
    const dispatch: RouteHandler = (request, response) => {
      const current = holders.at(-1)
      if (current !== undefined) return current.handler(request, response)
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('This route is reloading; retry in a moment.')
    }
    // Throws a duplicate on a path someone else registered without this helper: a real composition conflict.
    const unregister = server.register({ kind: route.kind, path: route.path, handler: dispatch })
    shared = { holders, unregister }
    routes.set(key, shared)
  }
  shared.holders.push(entry)
  // oxlint-disable-next-line antislop/no-passthrough-variable -- `shared` is a `let`; the release closure needs the narrowed entry it joined.
  const owned = shared
  let released = false
  return () => {
    if (released) return
    released = true
    const index = owned.holders.indexOf(entry)
    if (index !== -1) owned.holders.splice(index, 1)
    if (owned.holders.length > 0 || routes.get(key) !== owned) return
    routes.delete(key)
    owned.unregister()
  }
}

/** The web server refused the path: another registration, outside this helper, still holds it. */
export class RouteTaken extends Data.TaggedError('RouteTaken')<{ readonly path: string; readonly cause: unknown }> {}

/**
 * How long a refused route keeps trying in the background (about 10 s): long enough for an older copy of the plugin
 * that registered without this helper to close its Scope after the reload, short enough to give up on a real conflict.
 */
const TAKEN_RETRY = { schedule: Schedule.spaced('250 millis'), times: 40 } as const

/**
 * {@link holdRoute} for the current Scope: the route is held until the Scope closes. When the path is taken by a
 * registration made without this helper (the previous build of the same plugin, during the first reload onto this
 * helper), activation does not fail: the route is retried in the background and the old handler answers meanwhile; a
 * path still taken after the budget is logged, not fatal.
 */
export const register = (server: RouteServer, route: Route): Effect.Effect<void, never, Scope.Scope> => {
  const hold = Effect.acquireRelease(
    Effect.try({ try: () => holdRoute(server, route), catch: cause => new RouteTaken({ path: route.path, cause }) }),
    release => Effect.sync(release),
  )
  return hold.pipe(
    Effect.asVoid,
    Effect.catchTag('RouteTaken', () =>
      Effect.retry(hold, TAKEN_RETRY).pipe(
        Effect.catchTag('RouteTaken', error =>
          Effect.logWarning(`web route ${route.kind} ${route.path} is held by another registration; it is not served by this plugin`, error.cause),
        ),
        Effect.forkScoped,
        Effect.asVoid,
      ),
    ),
  )
}
