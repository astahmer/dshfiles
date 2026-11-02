import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { WorkspaceSessionPath } from './workspace-session-path.js'

const platform = Effect.gen(function* () {
  return { fileSystem: yield* FileSystem.FileSystem, path: yield* Path.Path }
})

describe('WorkspaceSessionPath.includes', () => {
  it.layer(NodeServices.layer)(it => {
    it.effect('matches only absolute cwd paths at or below the workspace root', () =>
      Effect.gen(function* () {
        const workspacePath = '/work/checkout'
        expect(yield* WorkspaceSessionPath.includes({ ...(yield* platform), workspacePath, sessionCwd: '/work/checkout' })).toBe(true)
        expect(yield* WorkspaceSessionPath.includes({ ...(yield* platform), workspacePath, sessionCwd: '/work/checkout/src' })).toBe(true)
        expect(yield* WorkspaceSessionPath.includes({ ...(yield* platform), workspacePath, sessionCwd: '/work/checkout-copy' })).toBe(false)
        expect(yield* WorkspaceSessionPath.includes({ ...(yield* platform), workspacePath, sessionCwd: 'src' })).toBe(false)
        expect(yield* WorkspaceSessionPath.includes({ ...(yield* platform), workspacePath, sessionCwd: undefined })).toBe(false)
      }),
    )

    it.effect('resolves symlinked session cwd paths into the actual workspace', () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.sync(() => mkdtempSync(join(tmpdir(), 'jj-workspace-session-path-'))),
          directory => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
        )
        const workspacePath = join(root, 'workspace')
        const aliasPath = join(root, 'alias')
        mkdirSync(workspacePath)
        symlinkSync(workspacePath, aliasPath, 'dir')
        expect(yield* WorkspaceSessionPath.includes({ ...(yield* platform), workspacePath, sessionCwd: aliasPath })).toBe(true)
      }).pipe(Effect.scoped),
    )
  })
})
