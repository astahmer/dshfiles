import { createAdaptorServer } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { Hono } from 'hono'
import type { Server } from 'node:http'

export interface HubPluginCard {
  readonly slug: string
  readonly name: string
  readonly scope: string
  readonly description: string
  readonly version: string
  readonly compat: string
  readonly category: string
  readonly badge: string
  readonly glyph: string
  readonly iconUrl: null
  readonly stars: number
}

export interface FakeHubState {
  readonly items: readonly HubPluginCard[]
  readonly tarball: string
  readonly queries: URLSearchParams[]
  failList: boolean
  failDetail: boolean
}

export interface FakeHub extends FakeHubState {
  readonly root: string
  readonly baseUrl: string
  close(): Promise<void>
}

export const card = (input: {
  readonly slug: string
  readonly name: string
  readonly scope: string
  readonly compat: string
  readonly stars: number
}): HubPluginCard => ({
  slug: input.slug,
  name: input.name,
  scope: input.scope,
  description: `${input.name} served by the e2e Framework Hub.`,
  version: '1.0.0',
  compat: input.compat,
  category: 'tools',
  badge: 'community',
  glyph: input.name.slice(0, 1),
  iconUrl: null,
  stars: input.stars,
})

export const createFakeHubApp = (state: FakeHubState): Hono => {
  const app = new Hono()
  app.get('/api/marketplace/plugins/:slug', context => {
    if (state.failDetail) return context.json({ error: 'detail unavailable' }, 503)
    const plugin = state.items.find(item => item.slug === context.req.param('slug'))
    if (plugin === undefined) return context.json({ error: 'plugin not found' }, 404)
    return context.json({
      plugin,
      installTargets: [
        { kind: 'npm', spec: state.tarball, package_name: plugin.scope, version: plugin.version, integrity: null, is_primary: 1, status: 'active' },
      ],
    })
  })
  app.get('/api/marketplace/plugins', context => {
    state.queries.push(new URL(context.req.url).searchParams)
    if (state.failList) return context.json({ error: 'catalog unavailable' }, 503)
    const query = context.req.query('q')?.toLocaleLowerCase()
    const matching = state.items.filter(item => query === undefined || item.name.toLocaleLowerCase().includes(query))
    const sorted = context.req.query('sort') === 'stars' ? [...matching].sort((left, right) => right.stars - left.stars) : matching
    return context.json({ categories: [{ slug: 'tools', name: 'Tools' }], items: sorted, nextCursor: null, total: sorted.length })
  })
  app.notFound(context => context.json({ error: 'not found' }, 404))
  return app
}

type ListenableServer = {
  once(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  listen(port: number, host: string, listener: () => void): unknown
  address(): AddressInfo | string | null
  close(listener: () => void): unknown
}

const listen = (server: ListenableServer): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

export const startFakeHub = async (input: { readonly root: string; readonly tarball: string; readonly items: readonly HubPluginCard[] }): Promise<FakeHub> => {
  const state: FakeHubState = { ...input, queries: [], failList: false, failDetail: false }
  const server = createAdaptorServer({ fetch: createFakeHubApp(state).fetch })
  await listen(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The local Framework Hub has no port.')
  return {
    ...state,
    root: input.root,
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    get failList() {
      return state.failList
    },
    set failList(value: boolean) {
      state.failList = value
    },
    get failDetail() {
      return state.failDetail
    },
    set failDetail(value: boolean) {
      state.failDetail = value
    },
    close: async () => {
      if ('closeAllConnections' in server) server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
