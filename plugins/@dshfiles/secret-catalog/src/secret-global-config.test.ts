import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem } from 'effect'
import { inspectGlobalSecretConfig } from './secret-global-config.js'

describe('global secret config inspection', () => {
  it.layer(NodeFileSystem.layer)(it => {
    it.effect('names the target of a symlinked config and nothing for a plain or missing file', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.realPath(yield* fileSystem.makeTempDirectoryScoped({ prefix: 'secret-global-config-' }))
        const target = `${root}/managed.json`
        yield* fileSystem.writeFileString(target, '{}')
        yield* fileSystem.symlink(target, `${root}/linked.json`)
        yield* fileSystem.writeFileString(`${root}/plain.json`, '{}')
        expect(yield* inspectGlobalSecretConfig(`${root}/linked.json`)).toEqual({ path: `${root}/linked.json`, linkedTo: target })
        expect((yield* inspectGlobalSecretConfig(`${root}/plain.json`)).linkedTo).toBeNull()
        expect((yield* inspectGlobalSecretConfig(`${root}/missing.json`)).linkedTo).toBeNull()
      }).pipe(Effect.scoped),
    )
  })
})
