import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { resolveWorkspaceDestination, sameWorkspaceParent } from './workspace-path.js'

const directories = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'dshfiles-jj-workspace-path-' })
  const repository = path.join(root, 'repository')
  const parent = path.join(root, 'workspaces')
  yield* fileSystem.makeDirectory(repository)
  yield* fileSystem.makeDirectory(parent)
  return { fileSystem, path, root, repository, parent }
})

const messageOf = <E extends Error, R>(effect: Effect.Effect<unknown, E, R>) => Effect.map(Effect.flip(effect), error => error.message)

describe('workspace destination', () => {
  it.layer(NodeServices.layer)(it => {
    it.effect('must be a new sibling outside the registered repository tree', () =>
      Effect.gen(function* () {
        const { fileSystem, path, root, repository, parent } = yield* directories
        const destination = yield* resolveWorkspaceDestination({ repositoryPath: repository, selectedParentPath: parent, name: 'review-branch' })
        const canonicalParent = yield* fileSystem.realPath(parent)
        expect(destination.parentPath).toBe(canonicalParent)
        expect(destination.path).toBe(path.join(canonicalParent, 'review-branch'))
        expect(yield* messageOf(resolveWorkspaceDestination({ repositoryPath: repository, selectedParentPath: repository, name: 'nested-workspace' }))).toMatch(
          /outside the registered repository tree/,
        )
        expect(yield* messageOf(resolveWorkspaceDestination({ repositoryPath: repository, selectedParentPath: root, name: 'repository' }))).toMatch(
          /outside the registered repository tree/,
        )
      }).pipe(Effect.scoped),
    )

    it.effect('detects replacing the selected parent at the same path', () =>
      Effect.gen(function* () {
        const { fileSystem, path, root, repository, parent } = yield* directories
        const previewed = yield* resolveWorkspaceDestination({ repositoryPath: repository, selectedParentPath: parent, name: 'review-branch' })
        yield* fileSystem.rename(parent, path.join(root, 'workspaces-before-replacement'))
        yield* fileSystem.makeDirectory(parent)
        const confirmed = yield* resolveWorkspaceDestination({ repositoryPath: repository, selectedParentPath: parent, name: 'review-branch' })

        expect(previewed.parentPath).toBe(confirmed.parentPath)
        expect(previewed.path).toBe(confirmed.path)
        expect(sameWorkspaceParent(previewed.parentIdentity, confirmed.parentIdentity)).toBe(false)
      }).pipe(Effect.scoped),
    )

    it.effect('rejects unsafe names, filesystem roots, and existing targets', () =>
      Effect.gen(function* () {
        const { fileSystem, path, repository, parent } = yield* directories
        yield* fileSystem.makeDirectory(path.join(parent, 'already-there'))

        expect(yield* messageOf(resolveWorkspaceDestination({ repositoryPath: repository, selectedParentPath: parent, name: '../escape' }))).toMatch(
          /valid Jujutsu workspace name/,
        )
        expect(yield* messageOf(resolveWorkspaceDestination({ repositoryPath: repository, selectedParentPath: '/', name: 'workspace' }))).toMatch(
          /filesystem root/,
        )
        expect(yield* messageOf(resolveWorkspaceDestination({ repositoryPath: repository, selectedParentPath: parent, name: 'already-there' }))).toMatch(
          /already exists/,
        )
      }).pipe(Effect.scoped),
    )
  })
})
