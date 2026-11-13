import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Path, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { afterEach, describe, expect, test } from 'vitest'
import { RuntimeIdentity } from '../src/identity.js'
import { LinkGateway } from '../src/link-gateway.js'
import { LinkStore } from '../src/link-store.js'
import { MultiHostPaths } from '../src/paths.js'

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())
      server.close(() => resolve(port))
    })
  })

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const gatewayRuntime = async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'multi-host-link-gateway-'))
  const paths = Layer.effect(
    MultiHostPaths,
    Effect.map(Path.Path, path => MultiHostPaths.make({ dshHome, path })),
  )
  const identity = Layer.succeed(
    RuntimeIdentity,
    RuntimeIdentity.of({
      current: Effect.succeed({
        protocolVersion: 1,
        runtimeId: '6f1f3c0e-1c1a-4f7e-9a4b-2a0c6c4f9d11',
        profile: 'web',
        homeLeaf: 'home',
        dshVersion: '0.2.2-rc.2',
        capabilities: ['workspace', 'session', 'agent'],
      }),
    }),
  )
  const layer = LinkGateway.layer({ nativeLaunchUrl: Effect.succeed('http://127.0.0.1:9/?token=native-token-12345678') }).pipe(
    Layer.provideMerge(LinkStore.layer.pipe(Layer.provideMerge(paths))),
    Layer.provide(identity),
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(NodeServices.layer),
  )
  const runtime = ManagedRuntime.make(layer)
  cleanups.push(async () => {
    await runtime.dispose()
    await rm(dshHome, { recursive: true, force: true })
  })
  return runtime
}

describe('link gateway lifecycle', () => {
  test('turning linking on listens on the configured port with no error', async () => {
    const runtime = await gatewayRuntime()
    const port = await freePort()
    const status = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* LinkStore
        const gateway = yield* LinkGateway
        yield* store.setSettings({ enabled: true, listen: 'loopback', port })
        return yield* gateway.apply
      }),
    )
    expect(status).toMatchObject({ listening: true, urls: [`http://127.0.0.1:${port}`] })
    expect(status.error).toBeUndefined()
  })

  test('turning linking off closes the port and an offer says how to turn it on', async () => {
    const runtime = await gatewayRuntime()
    const port = await freePort()
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* LinkStore
        const gateway = yield* LinkGateway
        yield* store.setSettings({ enabled: true, listen: 'loopback', port })
        yield* gateway.apply
        yield* store.setSettings({ enabled: false })
        const off = yield* gateway.apply
        const offer = yield* Effect.flip(gateway.offer)
        return { off, offer }
      }),
    )
    expect(result.off).toMatchObject({ listening: false, urls: [] })
    expect(result.offer._tag).toBe('LinkGatewayOff')
    expect(await freePort()).toBeGreaterThan(0)
  })
})
