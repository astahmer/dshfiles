import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem } from 'effect'
import { loadProjectConfig, PROJECT_CONFIG_FILE } from './project-config.js'

const scratchRoot = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'project-config-')))),
  root => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
)

const withConfig = (input: { readonly text?: string; readonly directory?: boolean }) =>
  Effect.gen(function* () {
    const root = yield* scratchRoot
    if (input.text !== undefined) writeFileSync(join(root, PROJECT_CONFIG_FILE), input.text)
    const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(NodeServices.layer))
    if (input.directory === true) mkdirSync(join(root, PROJECT_CONFIG_FILE))
    return { root, loaded: yield* loadProjectConfig(fs, root) }
  })

describe('project config file', () => {
  it.effect('treats a missing file as absent and never fails', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, loaded } = yield* withConfig({})
        expect(loaded).toEqual({ file: join(root, PROJECT_CONFIG_FILE), config: null, invalid: null })
      }),
    ),
  )

  it.effect('reads the declared settings', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { loaded } = yield* withConfig({
          text: JSON.stringify({
            defaultThreadWorkspace: 'isolated',
            bookmark: 'main',
            checks: ['test'],
            scripts: [{ name: 'setup', command: 'pnpm install', hint: 'Run after cloning' }],
          }),
        })
        expect(loaded.invalid).toBeNull()
        expect(loaded.config).toMatchObject({ defaultThreadWorkspace: 'isolated', bookmark: 'main', checks: ['test'] })
        expect(loaded.config?.scripts?.[0]).toMatchObject({ name: 'setup', command: 'pnpm install' })
      }),
    ),
  )

  it.effect('reports an invalid file instead of throwing or applying half of it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const broken = yield* withConfig({ text: 'not json' })
        expect(broken.loaded.config).toBeNull()
        expect(broken.loaded.invalid).toMatch(/could not be read/u)
        const wrongValue = yield* withConfig({ text: JSON.stringify({ defaultThreadWorkspace: 'sometimes' }) })
        expect(wrongValue.loaded.config).toBeNull()
        expect(wrongValue.loaded.invalid).toMatch(/could not be read/u)
      }),
    ),
  )
})
