import { createServer } from 'node:http'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, FileSystem, Layer, Option } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { ChromeController, chromeArguments, chromeExecutable, defaultProfileDir, freePort } from '../src/chrome-launch.js'
import { SpawnerLive } from './host-fixtures.js'

const scratch = (prefix: string) => FileSystem.FileSystem.use(fileSystem => fileSystem.makeTempDirectoryScoped({ prefix }))

describe('chromeExecutable', () => {
  it.layer(NodeFileSystem.layer)(it => {
    it.effect('honours a configured path that exists and ignores one that does not', () =>
      Effect.gen(function* () {
        const fake = `${yield* scratch('dsh-chrome-')}/chrome`
        yield* FileSystem.FileSystem.use(fileSystem => fileSystem.writeFileString(fake, ''))
        expect(yield* chromeExecutable({ platform: 'darwin', configured: fake })).toEqual(Option.some(fake))
        expect(yield* chromeExecutable({ platform: 'darwin', configured: '/nope/chrome' })).toEqual(Option.none())
      }).pipe(Effect.scoped),
    )

    it.effect('finds a binary on PATH for linux', () =>
      Effect.gen(function* () {
        const directory = yield* scratch('dsh-chrome-path-')
        yield* FileSystem.FileSystem.use(fileSystem => fileSystem.writeFileString(`${directory}/google-chrome`, ''))
        expect(yield* chromeExecutable({ platform: 'linux', pathValue: `${directory}:/nonexistent-bin` })).toEqual(Option.some(`${directory}/google-chrome`))
      }).pipe(Effect.scoped),
    )

    it.effect('returns nothing on an unknown platform without a configured path', () =>
      Effect.gen(function* () {
        expect(yield* chromeExecutable({ platform: 'aix', pathValue: '' })).toEqual(Option.none())
      }),
    )
  })
})

describe('defaultProfileDir', () => {
  it('uses the DSH home when it is set, else the user home', () => {
    expect(defaultProfileDir({ dshHome: '/tmp/dsh-home' })).toBe('/tmp/dsh-home/plugins/annotations/chrome-profile')
    expect(defaultProfileDir({ dshHome: undefined })).toMatch(/plugins\/annotations\/chrome-profile$/)
  })
})

describe('freePort', () => {
  it.live('skips a port that a non-devtools listener already holds', () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.callback<ReturnType<typeof createServer>>(resume => {
          const listening = createServer((_request, response) => {
            response.writeHead(404)
            response.end()
          })
          listening.listen(0, '127.0.0.1', () => resume(Effect.succeed(listening)))
        }),
        listening => Effect.callback<void>(resume => listening.close(() => resume(Effect.void))),
      )
      const address = server.address()
      if (address === null || typeof address === 'string') return yield* Effect.die('The fixture server has no port.')
      expect(yield* freePort({ start: address.port, attempts: 3 })).not.toBe(address.port)
    }).pipe(Effect.scoped),
  )
})

const ControllerLive = ChromeController.layer.pipe(Layer.provideMerge(Layer.mergeAll(SpawnerLive, NodeFileSystem.layer, FetchHttpClient.layer)))

describe.skipIf(process.platform === 'win32')('ChromeController', () => {
  it.live('records the launch span and fails fast when no port opens', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const profileDir = `${yield* scratch('dsh-launch-')}/nested/chrome-profile`
      const controller = yield* ChromeController
      const error = yield* Effect.flip(controller.launch({ executable: '/bin/echo', port: 41_000, profileDir, timeout: Duration.millis(1_500) }))
      expect(['exited', 'no-debugging-port']).toContain(error.reason)
      expect(yield* FileSystem.FileSystem.use(fileSystem => fileSystem.exists(profileDir))).toBe(true)
      expect(yield* controller.launched).toEqual(Option.none())
      expect(recorder.span('annotations launch chrome')).toBeDefined()
    }).pipe(Effect.scoped, Effect.provide(ControllerLive), Effect.provide(DshxEffect.tracerLayer)),
  )
})

describe('chromeArguments', () => {
  it('opens the configured start page or a blank tab', () => {
    const args = chromeArguments({ port: 9222, profileDir: '/tmp/p', startUrl: ' http://localhost:3000/app ' })
    expect(args).toContain('http://localhost:3000/app')
    expect(args).not.toContain('about:blank')
    expect(chromeArguments({ port: 9222, profileDir: '/tmp/p' }).at(-1)).toBe('about:blank')
    expect(chromeArguments({ port: 9222, profileDir: '/tmp/p', startUrl: '  ' }).at(-1)).toBe('about:blank')
  })

  it('always pins the loopback port and the owned profile', () => {
    const args = chromeArguments({ port: 9333, profileDir: '/tmp/owned' })
    expect(args).toContain('--remote-debugging-port=9333')
    expect(args).toContain('--user-data-dir=/tmp/owned')
  })

  it('keeps the OS keychain out of a fresh profile', () => {
    const args = chromeArguments({ port: 9222, profileDir: '/tmp/p' })
    expect(args).toContain('--password-store=basic')
    expect(args).toContain('--use-mock-keychain')
  })

  it('adds headless only when asked', () => {
    expect(chromeArguments({ port: 9222, profileDir: '/tmp/p' })).not.toContain('--headless=new')
    expect(chromeArguments({ port: 9222, profileDir: '/tmp/p', headless: true })).toContain('--headless=new')
  })
})
