import { homedir } from 'node:os'
import { Effect, FileSystem, Path } from 'effect'
import type { DirectoryListing } from './api.js'
import { FolderPathInvalid, FolderUnavailable } from './errors.js'

const maxEntries = 2_000

/** One folder level of this machine for a remote folder picker. Stock DSH only serves `directoryPicker.list` where the
 * composition has an in-app browser; a headless Linux runtime composes the native chooser and refuses it. */
const list = Effect.fn('multi-host directory list')(function* (requested: string | undefined) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  if (requested !== undefined && !path.isAbsolute(requested)) return yield* new FolderPathInvalid()
  const unavailable = (cause: unknown) => new FolderUnavailable({ cause })
  const folder = yield* fileSystem.realPath(requested ?? homedir()).pipe(Effect.mapError(unavailable))
  const children = yield* fileSystem.readDirectoryEntries(folder).pipe(Effect.mapError(unavailable))
  const isFolder = (child: (typeof children)[number]) => {
    if (child.type === 'Directory') return Effect.succeed(true)
    if (child.type !== 'SymbolicLink') return Effect.succeed(false)
    return fileSystem.stat(path.join(folder, child.name)).pipe(
      Effect.map(info => info.type === 'Directory'),
      Effect.orElseSucceed(() => false),
    )
  }
  const folders = yield* Effect.filter(children, isFolder)
  const entries = folders
    .map(child => ({ name: child.name, path: path.join(folder, child.name), hidden: child.name.startsWith('.') }))
    .sort((left, right) => Number(left.hidden) - Number(right.hidden) || left.name.localeCompare(right.name))
  const segments = folder.split(path.sep).filter(Boolean)
  const crumbs = [
    { name: path.sep, path: path.sep, hidden: false },
    ...segments.map((name, index) => ({ name, path: path.sep + segments.slice(0, index + 1).join(path.sep), hidden: name.startsWith('.') })),
  ]
  return {
    path: folder,
    home: homedir(),
    crumbs,
    entries: entries.slice(0, maxEntries),
    truncated: entries.length > maxEntries,
  } satisfies DirectoryListing
})

/** Create one child folder and return its path; a path or name that could escape the parent is refused. */
const createChild = Effect.fn('multi-host directory create')(function* (input: { readonly path: string; readonly name: string }) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const name = input.name.trim()
  if (!path.isAbsolute(input.path) || input.name.includes('/') || input.name.includes('\\') || name === '.' || name === '..' || name === '')
    return yield* new FolderPathInvalid()
  const target = path.join(yield* fileSystem.realPath(input.path).pipe(Effect.mapError(cause => new FolderUnavailable({ cause }))), name)
  yield* fileSystem.makeDirectory(target).pipe(Effect.mapError(cause => new FolderUnavailable({ cause })))
  return target
})

export class DirectoryListingModel {
  static readonly list = list
  static readonly createChild = createChild
}
