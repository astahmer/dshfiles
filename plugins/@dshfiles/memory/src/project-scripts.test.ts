import { spawnSync } from 'node:child_process'

import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'

import { ensureProjectScripts } from './project-scripts.ts'
import { platformLayer } from './testing/memory-store.ts'

describe('project scripts', () => {
  it.effect('writes a project its scripts once, keeps a hand edit, and cleans a workspace but never the checkout itself', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const base = yield* fs.makeTempDirectoryScoped({ prefix: 'project-scripts-' })
      const project = path.join(base, 'project')
      const workspace = path.join(base, 'project-threads', 'thread-abc123')
      yield* fs.makeDirectory(path.join(project, 'node_modules', 'left-alone'), { recursive: true })
      yield* fs.makeDirectory(path.join(workspace, 'node_modules', 'pkg'), { recursive: true })
      yield* fs.makeDirectory(path.join(workspace, 'packages', 'app', 'node_modules', 'pkg'), { recursive: true })
      yield* fs.writeFileString(path.join(workspace, 'packages', 'app', 'index.ts'), 'kept\n')
      yield* fs.writeFileString(path.join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      const root = path.join(base, 'scripts')

      const scripts = yield* ensureProjectScripts({ root, project })
      if (scripts === null) return yield* Effect.die(new Error('expected scripts for a pnpm project'))
      expect(yield* fs.readFileString(scripts.setup)).toContain('pnpm install --frozen-lockfile --prefer-offline')
      yield* fs.writeFileString(scripts.setup, '#!/bin/sh\necho edited\n')
      yield* ensureProjectScripts({ root, project })
      expect(yield* fs.readFileString(scripts.setup)).toBe('#!/bin/sh\necho edited\n')

      expect(spawnSync(scripts.cleanup, [workspace]).status).toBe(0)
      expect(yield* fs.exists(path.join(workspace, 'node_modules'))).toBe(false)
      expect(yield* fs.exists(path.join(workspace, 'packages', 'app', 'node_modules'))).toBe(false)
      expect(yield* fs.exists(path.join(workspace, 'packages', 'app', 'index.ts'))).toBe(true)

      expect(spawnSync(scripts.cleanup, [project]).status).toBe(1)
      expect(yield* fs.exists(path.join(project, 'node_modules', 'left-alone'))).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(platformLayer)),
  )

  it.effect('writes nothing for a project without a lockfile', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const base = yield* fs.makeTempDirectoryScoped({ prefix: 'project-scripts-' })
      expect(yield* ensureProjectScripts({ root: path.join(base, 'scripts'), project: base })).toBeNull()
      expect(yield* fs.exists(path.join(base, 'scripts'))).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(platformLayer)),
  )
})
