import { randomUUID } from 'node:crypto'
import { Cache, Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import { JujutsuPathModel } from './core.js'
import { InvalidRepositoryPath, NotAJujutsuRepository, RepositoryMoved, RepositoryNotFound, type JjRunError, type RepositoryInitFailed } from './errors.js'
import { JujutsuCommands, type JjRun } from './jujutsu-commands.js'
import { RepositoryInitializer } from './repository-init.js'
import { RepositoryIdentity, type RegisteredRepo } from './repository-identity.js'

const MAX_REGISTRATIONS = 32
const ROOT_OUTPUT_LIMIT = 16_000

export interface RepositoryWorkspace {
  readonly name: string
  readonly path: string
}

type RegisterError = JjRunError | NotAJujutsuRepository

/**
 * The repositories the browser registered on this Host, by an opaque id. Every use re-proves that the id still
 * names the same directory and that jj still reports it as its root.
 */
export class Repositories extends Context.Service<
  Repositories,
  {
    readonly register: (path: string) => Effect.Effect<RegisteredRepo, RegisterError>
    readonly resolve: (repoId: string) => Effect.Effect<RegisteredRepo, JjRunError | RepositoryNotFound>
    /** Open a folder, initializing a colocated JJ repository in its Git checkout when it has none, and register it. */
    readonly open: (path: string) => Effect.Effect<{ readonly repo: RegisteredRepo; readonly initialized: boolean }, RegisterError | RepositoryInitFailed>
    readonly workspaces: (repo: RegisteredRepo) => Effect.Effect<readonly RepositoryWorkspace[], JjRunError>
    /** jj bound to the registered root and its identity. */
    readonly run: (repo: RegisteredRepo) => JjRun
  }
>()('@dshfiles/jujutsu/Repositories') {
  static readonly layer = Layer.effect(
    Repositories,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const identity = yield* RepositoryIdentity
      const commands = yield* JujutsuCommands
      const initializer = yield* RepositoryInitializer

      // Registrations are only ever `set`; a lookup miss must not evict one, so the lookup is never run.
      const registrations = yield* Cache.make({
        lookup: (repoId: string): Effect.Effect<RegisteredRepo, RepositoryNotFound> => Effect.fail(new RepositoryNotFound({ repoId })),
        capacity: MAX_REGISTRATIONS,
      })

      const run = (repo: RegisteredRepo): JjRun => commands.at({ cwd: repo.root, expectedIdentity: repo.identity })

      const register = Effect.fn('jujutsu repository register')(function* (selectedPath: string) {
        const selected = yield* Effect.fromResult(JujutsuPathModel.validatedRepositoryPath(selectedPath))
        const canonicalSelection = yield* fileSystem.realPath(selected).pipe(Effect.mapError(cause => new InvalidRepositoryPath({ reason: 'missing', cause })))
        if (!path.isAbsolute(canonicalSelection) || path.normalize(canonicalSelection) !== canonicalSelection) {
          return yield* new InvalidRepositoryPath({ reason: 'not-canonical' })
        }
        const selectionIdentity = yield* identity
          .of(canonicalSelection)
          .pipe(Effect.catchTag('PlatformError', cause => Effect.fail(new InvalidRepositoryPath({ reason: 'missing', cause }))))
        const rootOutput = yield* commands.run({ cwd: canonicalSelection, expectedIdentity: selectionIdentity, args: ['root'], outputLimit: ROOT_OUTPUT_LIMIT })
        const rootLine = rootOutput.stdout.trim()
        if (rootOutput.truncated || rootLine.length === 0 || rootLine.includes('\n') || !path.isAbsolute(rootLine)) {
          return yield* new NotAJujutsuRepository({ reason: 'unconfirmed' })
        }
        const root = yield* Effect.fromResult(JujutsuPathModel.validatedRepositoryPath(rootLine)).pipe(
          Effect.flatMap(fileSystem.realPath),
          Effect.mapError(cause => new NotAJujutsuRepository({ reason: 'unavailable-root', cause })),
        )
        const rootIdentity = yield* identity
          .of(root)
          .pipe(Effect.catchTag('PlatformError', cause => Effect.fail(new NotAJujutsuRepository({ reason: 'unavailable-root', cause }))))
        const selectionWithinRoot = path.relative(root, canonicalSelection)
        if (selectionWithinRoot === '..' || selectionWithinRoot.startsWith('../') || path.isAbsolute(selectionWithinRoot)) {
          return yield* new NotAJujutsuRepository({ reason: 'outside-selection' })
        }
        const repo: RegisteredRepo = { id: randomUUID(), root, identity: rootIdentity }
        const confirmed = yield* run(repo)(['root'], { outputLimit: ROOT_OUTPUT_LIMIT })
        const confirmedRoot = yield* fileSystem
          .realPath(confirmed.stdout.trim())
          .pipe(Effect.mapError(cause => new RepositoryMoved({ reason: 'root-changed', cause })))
        if (confirmed.truncated || confirmedRoot !== root) return yield* new RepositoryMoved({ reason: 'root-changed' })
        yield* identity.verify(repo)
        yield* Cache.set(registrations, repo.id, repo)
        return repo
      })

      const resolve = Effect.fn('jujutsu repository resolve')(function* (repoId: string) {
        const registered = yield* Cache.getOption(registrations, repoId)
        if (Option.isNone(registered)) return yield* new RepositoryNotFound({ repoId })
        const repo = registered.value
        yield* identity.verify(repo)
        // A view read: answered again from the same operation head without a jj process; the identity checks around
        // it (before, and in the runner before and after) still prove the directory is the registered one.
        const confirmation = yield* run(repo)(['--ignore-working-copy', 'root'], { outputLimit: ROOT_OUTPUT_LIMIT })
        const reportedRoot = confirmation.stdout.trim()
        const mismatch = new RepositoryMoved({ reason: 'root-mismatch' })
        if (confirmation.truncated || !path.isAbsolute(reportedRoot)) return yield* mismatch
        const canonicalRoot = yield* fileSystem.realPath(reportedRoot).pipe(Effect.mapError(cause => new RepositoryMoved({ reason: 'root-mismatch', cause })))
        if (canonicalRoot !== repo.root) return yield* mismatch
        yield* identity.verify(repo)
        return repo
      })

      const open = Effect.fn('jujutsu repository open')(function* (selectedPath: string) {
        const opened = yield* initializer.ensure({
          path: yield* Effect.fromResult(JujutsuPathModel.validatedRepositoryPath(selectedPath)),
          runJj: (cwd, args) => commands.run({ cwd, args, outputLimit: ROOT_OUTPUT_LIMIT }),
        })
        return { repo: yield* register(opened.root), initialized: opened.initialized }
      })

      const workspaces = Effect.fn('jujutsu workspaces list')(function* (repo: RegisteredRepo) {
        const listing = yield* run(repo)(['workspace', 'list', '-T', 'name ++ "\\t" ++ root ++ "\\n"'], { outputLimit: 64_000 })
        return listing.stdout
          .split('\n')
          .map(line => line.split('\t'))
          .filter(([name = '', folder = '']) => name.length > 0 && folder.length > 0)
          .map(([name = '', folder = '']) => ({ name, path: folder }))
      })

      return Repositories.of({ register, resolve, open, workspaces, run })
    }),
  )
}
