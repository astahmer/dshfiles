import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import plugin from './host.js'
import { injectAfterHead, SHARED_EVENT_SOURCE_WORKER, SHARED_EVENT_SOURCE_WORKER_PATH, sharedEventSourceScript } from './shim.js'

const INDEX_HTML =
  '<!doctype html><html><head><title>DeepSeek Harness</title><script type="module" src="./assets/index.js"></script></head><body><div id="root"></div></body></html>'

const mountWith = (config: { readonly enabled: boolean } | undefined) =>
  Effect.gen(function* () {
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      testHost => Effect.promise(() => testHost.dispose()),
    )
    const routes = new Set<string>()
    const taps = new Set<(html: string) => string>()
    host.ctx.provide('webServer', {
      register: (route: { readonly path: string }) => {
        routes.add(route.path)
        return () => routes.delete(route.path)
      },
      tapIndex: (tap: (html: string) => string) => {
        taps.add(tap)
        return () => taps.delete(tap)
      },
    })
    const mounted = yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/shared-streams', config }))
    return { routes, taps, mounted }
  })

describe('Host configuration', () => {
  it.effect('serves the worker and injects the shim by default, until the plugin unloads', () =>
    Effect.gen(function* () {
      const { routes, taps, mounted } = yield* mountWith(undefined)
      expect([...routes]).toEqual([`/${SHARED_EVENT_SOURCE_WORKER_PATH}`])
      expect([...taps].map(tap => tap(INDEX_HTML).includes(sharedEventSourceScript()))).toEqual([true])

      yield* Effect.promise(() => mounted.dispose())
      expect(routes.size).toBe(0)
      expect(taps.size).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('installs nothing when the row disables it', () =>
    Effect.gen(function* () {
      const { routes, taps } = yield* mountWith({ enabled: false })
      expect(routes.size).toBe(0)
      expect(taps.size).toBe(0)
    }).pipe(Effect.scoped),
  )
})

describe('shared event source script', () => {
  it('stays safe to inline inside one script element', () => {
    const script = sharedEventSourceScript()
    expect(script).not.toContain('</script')
    expect(script).not.toContain('<!--')
  })

  it('points every tab at one stable worker path', () => {
    const script = sharedEventSourceScript()
    expect(script).toContain(`new SharedWorker(WORKER_PATH)`)
    expect(script).toContain(`const WORKER_PATH = ${JSON.stringify(SHARED_EVENT_SOURCE_WORKER_PATH)}`)
    expect(script).not.toContain('createObjectURL')
  })

  it('parses as a classic script in both halves', () => {
    expect(() => new Function(sharedEventSourceScript())).not.toThrow()
    expect(() => new Function(SHARED_EVENT_SOURCE_WORKER)).not.toThrow()
  })

  it('keeps a native fallback so a failed worker cannot silence streams', () => {
    const script = sharedEventSourceScript()
    expect(script).toContain('falling back to one EventSource per tab')
    expect(script).toContain('__attachNative')
  })

  it('closes a stream once its last subscriber leaves', () => {
    expect(SHARED_EVENT_SOURCE_WORKER).toContain('release(url)')
    expect(SHARED_EVENT_SOURCE_WORKER).toContain('entry.ports.size > 0')
  })

  it('resolves relative stream paths in the page, not in the worker', () => {
    const script = sharedEventSourceScript()
    expect(script).toContain('new URL(String(url), document.baseURI).href')
  })
})

describe('index injection', () => {
  it('places the shim before the app entry module', () => {
    const markup = `<script>${sharedEventSourceScript()}</script>`
    const rendered = injectAfterHead(INDEX_HTML, markup)
    expect(rendered.indexOf(markup)).toBeGreaterThan(rendered.indexOf('<head>'))
    expect(rendered.indexOf(markup)).toBeLessThan(rendered.indexOf('<script type="module"'))
  })

  it('still injects when the document has no head tag', () => {
    expect(injectAfterHead('<html></html>', '<script></script>')).toBe('<script></script><html></html>')
  })
})
