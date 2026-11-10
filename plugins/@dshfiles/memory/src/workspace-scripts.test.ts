import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { TestClock } from 'effect/testing'

import { MemoryGuidance } from './guidance.ts'
import { ProjectPaths, projectPathFor } from './project-path.ts'
import { WorkspaceScripts, workspaceScriptsTtl } from './workspace-scripts.ts'
import { platformLayer } from './testing/memory-store.ts'

const scriptsLayer = (root: string) =>
  WorkspaceScripts.layer(root).pipe(
    Layer.provide(
      Layer.effect(
        ProjectPaths,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          return ProjectPaths.of({
            ready: Effect.void,
            of: cwd => projectPathFor(cwd ?? '').pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path)),
          })
        }),
      ),
    ),
  )

describe('workspace scripts', () => {
  it.effect('answers every turn of a project from memory, byte-identical, and rewrites a deleted script only after its time to live', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const base = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'workspace-scripts-' }))
      const project = path.join(base, 'project')
      const workspace = path.join(base, 'project-threads', 'thread-abc123')
      yield* fs.makeDirectory(path.join(project, '.jj', 'repo'), { recursive: true })
      yield* fs.makeDirectory(path.join(workspace, '.jj'), { recursive: true })
      yield* fs.writeFileString(path.join(workspace, '.jj', 'repo'), path.join(project, '.jj', 'repo'))
      yield* fs.writeFileString(path.join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      const root = path.join(base, 'scripts')

      yield* Effect.gen(function* () {
        const scripts = yield* WorkspaceScripts
        const first = yield* scripts.forCwd(workspace)
        if (first === null) return yield* Effect.die(new Error('expected scripts for a pnpm project'))
        expect(first.project).toBe(project)
        yield* fs.remove(first.setup)

        const second = yield* scripts.forCwd(workspace)
        expect(second).toStrictEqual(first)
        expect(MemoryGuidance.workspaceScripts(second ?? first)).toBe(MemoryGuidance.workspaceScripts(first))
        expect(yield* fs.exists(first.setup)).toBe(false)

        yield* TestClock.adjust(workspaceScriptsTtl)
        expect(yield* scripts.forCwd(workspace)).toStrictEqual(first)
        expect(yield* fs.exists(first.setup)).toBe(true)
      }).pipe(Effect.provide(scriptsLayer(root)))
    }).pipe(Effect.scoped, Effect.provide(platformLayer)),
  )

  it.effect('has nothing outside a working directory', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const base = yield* fs.makeTempDirectoryScoped({ prefix: 'workspace-scripts-' })
      expect(yield* WorkspaceScripts.use(scripts => scripts.forCwd(undefined)).pipe(Effect.provide(scriptsLayer(base)))).toBeNull()
    }).pipe(Effect.scoped, Effect.provide(platformLayer)),
  )
})
