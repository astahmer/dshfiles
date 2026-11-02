import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Option, Path } from 'effect'
import { agentToolkitApi } from './api.js'
import agentToolkitHost from './host.js'
import { PackageVersions, packageNameOf, ProfileDirectory } from './package-versions.js'

const platform = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)

const writePackage = Effect.fn(function* (directory: string, name: string, version: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.join(directory, 'node_modules', name), { recursive: true })
  yield* fs.writeFileString(path.join(directory, 'node_modules', name, 'package.json'), JSON.stringify({ name, version, exports: { '.': './index.js' } }))
})

/** A profile whose `@deepseek-ai` bundle is a symlink into an isolated store, as pnpm installs it. */
const profileFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'agent-toolkit-' })
  const profile = path.join(root, 'profile')
  const bundle = path.join(root, 'store', 'node_modules', 'dsh-bundle')
  yield* writePackage(profile, '@dshfiles/btw', '0.1.0')
  yield* writePackage(path.join(root, 'store'), '@deepseek-ai/dsh-tool-fs', '0.2.0-rc.2')
  yield* fs.makeDirectory(bundle, { recursive: true })
  yield* fs.makeDirectory(path.join(profile, 'node_modules', '@deepseek-ai'), { recursive: true })
  yield* fs.symlink(bundle, path.join(profile, 'node_modules', '@deepseek-ai', 'dsh-bundle'))
  return profile
})

const versionsIn = (profile: Option.Option<string>) => PackageVersions.layer.pipe(Layer.provide(Layer.succeed(ProfileDirectory, profile)))

describe('package versions', () => {
  it.layer(platform)(it => {
    it.effect('reads the version of a package and of a subpath entry, searching each base in order', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const profile = yield* profileFixture
          const versions = yield* PackageVersions.use(service => service.read(['@dshfiles/btw/client', '@deepseek-ai/dsh-tool-fs', 'missing'])).pipe(
            Effect.provide(versionsIn(Option.some(profile))),
          )
          expect(versions).toEqual({ '@dshfiles/btw': '0.1.0', '@deepseek-ai/dsh-tool-fs': '0.2.0-rc.2', missing: null })
        }),
      ),
    )

    it.effect('finds nothing when the Host has no file profile', () =>
      Effect.gen(function* () {
        const versions = yield* PackageVersions.use(service => service.read(['@dshfiles/btw'])).pipe(Effect.provide(versionsIn(Option.none())))
        expect(versions).toEqual({ '@dshfiles/btw': null })
      }),
    )
  })

  it('names the package of a module specifier', () => {
    expect([packageNameOf('@scope/name/client'), packageNameOf('plain/sub'), packageNameOf('plain')]).toEqual(['@scope/name', 'plain', 'plain'])
  })

  it.effect('serves versions over the agent-toolkit API', () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const created = await createTestHost()
          await created.mount(agentToolkitHost, { packageId: '@dshfiles/agent-toolkit' })
          return created
        }),
        created => Effect.promise(() => created.dispose()),
      )
      const client = createHostApiClient(host.ctx, agentToolkitApi, '@test/caller')
      const versions = yield* Effect.promise(() => client.versions({ packages: ['definitely-not-installed-package'] }))
      expect(versions).toEqual({ 'definitely-not-installed-package': null })
    }),
  )
})
